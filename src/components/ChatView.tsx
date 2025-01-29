import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Message,
  Chat,
  addMessage,
  getMessages,
  createChat,
  updateChatTitle,
} from "../services/chat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput, ChatInputHandle } from "./ChatInput";
import { ErrorMessage } from "./ErrorMessage";
import { streamAssistantResponse, getSummaryTitle } from "../services/ai";
import { useModelTools } from '../contexts/ModelToolsContext';

interface ChatViewProps {
  currentChatId: string | null;
  initialMessages?: Message[];
  onChatCreated: (chat: Chat) => void;
  onChatTitleUpdated: (chatId: string, title: string) => void;
  onMessagesUpdated: (chatId: string, messages: Message[]) => void;
}

interface ErrorItem {
  id: string;
  message: string;
}

export function ChatView({
  currentChatId,
  initialMessages,
  onChatCreated,
  onChatTitleUpdated,
  onMessagesUpdated,
}: ChatViewProps) {
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  // All messages for the current chat
  const [messages, setMessages] = useState<Message[]>(initialMessages || []);

  // If the assistant is currently streaming tokens
  const [isStreaming, setIsStreaming] = useState(false);
  // Show an "assistant is typing" bubble if we haven't received the first token yet
  const [isWaitingForFirstToken, setIsWaitingForFirstToken] = useState(false);

  // Temporary error messages
  const [errors, setErrors] = useState<ErrorItem[]>([]);

  const modelTools = useModelTools();
  
  // Now you can use modelTools.getTools() to list all available tools
  // and modelTools.executeTool(name, args) to execute a specific tool

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const SCROLL_THRESHOLD_PX = 10;

  const handleScroll = useCallback(() => {
    const el = chatWindowRef.current;
    if (!el) return;

    // Are we near the bottom?
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > SCROLL_THRESHOLD_PX) {
      // The user scrolled away from bottom => disable auto-follow
      setIsAutoFollowing(false);
    } else {
      // The user is effectively still at the bottom => keep auto-follow
      setIsAutoFollowing(true);
    }

    if (distanceFromBottom > 100) {
      setShowScrollButton(true);
    } else {
      setShowScrollButton(false);
    }
  }, []);

  // Set up scroll listener
  useEffect(() => {
    const el = chatWindowRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Whenever new messages come in, auto-scroll if needed
  useEffect(() => {
    if (isAutoFollowing) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, isAutoFollowing]);

  // Reset scroll behavior when changing chats
  useEffect(() => {
    setIsAutoFollowing(true);
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [currentChatId]);

  const scrollToBottom = useCallback(() => {
    setIsAutoFollowing(true);
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // -------------------------------------------------------------------------
  // 1) Load messages when currentChatId changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }

    let isMounted = true;
    const loadMessages = async () => {
      try {
        let loaded: Message[];
        if (initialMessages) {
          loaded = initialMessages;
        } else {
          loaded = await getMessages(currentChatId);
        }
        if (!isMounted) return;

        // Only update if messages have actually changed
        setMessages(loaded);
      } catch (error) {
        console.error("Failed to load messages:", error);
      }
    };

    loadMessages();

    return () => {
      isMounted = false;
    };
  }, [currentChatId, initialMessages, onMessagesUpdated]);

  // If initialMessages prop changes while the same chat is active, update local
  useEffect(() => {
    if (currentChatId && initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  // -------------------------------------------------------------------------
  // 2) Sending user messages
  // -------------------------------------------------------------------------
  // Memoize handleAssistantResponse
  const handleAssistantResponse = useCallback(
    async (
      chatId: string,
      userMessage: string,
      attachments?: { content: string; type: string }[],
    ) => {
      setIsStreaming(true);
      setIsWaitingForFirstToken(true);

      let assistantMessage = "";
      const messageId = crypto.randomUUID();

      try {
        // Get available tools
        const availableTools = await modelTools.getTools();

        for await (const chunk of streamAssistantResponse(
          messages.map((msg) => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
            attachments: msg.attachments,
          })),
          userMessage,
          attachments,
          availableTools,
          async (name: string, args: Record<string, unknown>) => {
            return await modelTools.executeTool(name, args);
          }
        )) {
          assistantMessage += chunk;

          if (assistantMessage.length === chunk.length) {
            // First token
            setIsWaitingForFirstToken(false);
            setMessages((prev) => [
              ...prev,
              {
                id: messageId,
                chat_id: chatId,
                content: assistantMessage,
                role: "assistant",
                created_at: new Date().toISOString(),
                attachments: undefined,
              },
            ]);
          } else {
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage.id === messageId) {
                lastMessage.content = assistantMessage;
              }
              return newMessages;
            });
          }
        }

        const finalMsg = await addMessage(chatId, assistantMessage, "assistant");
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (newMessages[lastIdx].id === messageId) {
            newMessages[lastIdx] = finalMsg;
          }
          onMessagesUpdated(chatId, newMessages);
          return newMessages;
        });
      } finally {
        setIsStreaming(false);
        setIsWaitingForFirstToken(false);
      }
    },
    [messages, onMessagesUpdated],
  );

  // Memoize handleSendMessage
  const handleSendMessage = useCallback(
    async (
      content: string,
      attachments?: { content: string; type: string }[],
    ) => {
      // Enable auto-follow when sending a new message
      setIsAutoFollowing(true);
      setShowScrollButton(false);

      try {
        if (!currentChatId) {
          const newChat = await createChat("...");
          onChatCreated(newChat);

          const userMsg = await addMessage(
            newChat.id,
            content,
            "user",
            attachments,
          );
          setMessages([userMsg]);
          onMessagesUpdated(newChat.id, [userMsg]);

          await handleAssistantResponse(newChat.id, content, attachments);

          const title = await getSummaryTitle(content);
          await updateChatTitle(newChat.id, title);
          onChatTitleUpdated(newChat.id, title);
        } else {
          const userMsg = await addMessage(
            currentChatId,
            content,
            "user",
            attachments,
          );
          setMessages((prev) => {
            const updated = [...prev, userMsg];
            onMessagesUpdated(currentChatId, updated);
            return updated;
          });

          const userCountBefore = messages.filter(
            (m) => m.role === "user",
          ).length;
          if (userCountBefore === 0) {
            const title = await getSummaryTitle(content);
            await updateChatTitle(currentChatId, title);
            onChatTitleUpdated(currentChatId, title);
          }

          await handleAssistantResponse(currentChatId, content, attachments);
        }
      } catch (error: unknown) {
        console.error("Error in handleSendMessage:", error);
        setIsStreaming(false);
        const errorMessage =
          error instanceof Error ? error.message : "An error occurred";
        const errorId = crypto.randomUUID();
        setErrors((prev) => [...prev, { id: errorId, message: errorMessage }]);
        setTimeout(() => {
          setErrors((prev) => prev.filter((e) => e.id !== errorId));
        }, 5000);
      }
    },
    [
      currentChatId,
      messages,
      handleAssistantResponse,
      onChatCreated,
      onChatTitleUpdated,
      onMessagesUpdated,
      scrollToBottom,
    ],
  );

  // -------------------------------------------------------------------------
  // 6) Dismiss errors
  // -------------------------------------------------------------------------
  const handleDismissError = useCallback((errorId: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== errorId));
  }, []);

  // Memoize the message list to prevent unnecessary re-renders
  const messageList = useMemo(() => {
    return messages.map((message) => (
      <ChatMessage
        key={message.id}
        content={message.content}
        role={message.role}
        timestamp={new Date(message.created_at)}
        isTyping={false}
        attachments={message.attachments}
      />
    ));
  }, [messages]);

  // Memoize the error list
  const errorList = useMemo(() => {
    return errors.map((error) => (
      <ErrorMessage
        key={error.id}
        message={error.message}
        onDismiss={() => handleDismissError(error.id)}
      />
    ));
  }, [errors, handleDismissError]);

  // Use useEffect to bind drag events
  useEffect(() => {
    const mainContent = document.querySelector(".main-content");
    if (!mainContent) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes("Files")) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer?.types.includes("Files")) {
        dragCounter.current += 1;
        if (dragCounter.current === 1) {
          setIsDragging(true);
        }
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer?.types.includes("Files")) {
        dragCounter.current -= 1;
        if (dragCounter.current === 0) {
          setIsDragging(false);
        }
      }
    };

    const handleDropEvent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      if (e.dataTransfer?.files) {
        const files = Array.from(e.dataTransfer.files);
        const validImageFiles = files.filter(
          (file) =>
            file.type.startsWith("image/") &&
            ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
              file.type,
            ),
        );

        if (validImageFiles.length > 0 && chatInputRef.current) {
          chatInputRef.current.addFiles(validImageFiles).catch(console.error);
        }
      }
    };

    mainContent.addEventListener("dragover", handleDragOver as EventListener);
    mainContent.addEventListener("dragenter", handleDragEnter as EventListener);
    mainContent.addEventListener("dragleave", handleDragLeave as EventListener);
    mainContent.addEventListener("drop", handleDropEvent as EventListener);

    return () => {
      mainContent.removeEventListener(
        "dragover",
        handleDragOver as EventListener,
      );
      mainContent.removeEventListener(
        "dragenter",
        handleDragEnter as EventListener,
      );
      mainContent.removeEventListener(
        "dragleave",
        handleDragLeave as EventListener,
      );
      mainContent.removeEventListener("drop", handleDropEvent as EventListener);
    };
  }, []);

  // Add ref for ChatInput
  const chatInputRef = useRef<ChatInputHandle>(null);

  
  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="main-content flex flex-col h-full">
      <div className="chat-window flex-1 relative" ref={chatWindowRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">Hi, how can I help you?</div>
        ) : (
          <>
            {messageList}
            {isWaitingForFirstToken && (
              <ChatMessage
                content=""
                role="assistant"
                timestamp={new Date()}
                isTyping={true}
              />
            )}
            <div ref={messagesEndRef} />
          </>
        )}

        {/* Floating scroll button */}
        {showScrollButton && (
          <button
            onClick={() => scrollToBottom()}
            className="scroll-to-bottom-button"
            aria-label="Scroll to bottom"
          >
            ↓
          </button>
        )}

        <div className="error-container">{errorList}</div>

        {/* Drag overlay */}
        {isDragging && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <svg
                className="w-12 h-12 text-blue-500 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <div className="text-xl font-medium text-blue-600 dark:text-blue-400 mb-2">
                Drop image to send
              </div>
              <div className="text-sm text-blue-500 dark:text-blue-300">
                Supported formats: JPEG, PNG, GIF, WebP
              </div>
            </div>
          </div>
        )}
      </div>

      <ChatInput ref={chatInputRef} onSendMessage={handleSendMessage} />
    </div>
  );
}
