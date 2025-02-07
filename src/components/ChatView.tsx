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
  FileAttachment,
} from "../services/chat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput, ChatInputHandle } from "./ChatInput";
import { ErrorMessage } from "./ErrorMessage";
import { streamAssistantResponse, getSummaryTitle } from "../services/ai";
import { useModelTools } from "../contexts/ModelToolsContext";
import {
  MessageParam,
  ContentBlockParam,
  ImageBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";

interface ChatViewProps {
  currentChatId: string | null;
  onChatCreated: (chat: Chat) => void;
  onChatTitleUpdated: (chatId: string, title: string) => void;
}

interface ErrorItem {
  id: string;
  message: string;
}

export function ChatView({
  currentChatId,
  onChatCreated,
  onChatTitleUpdated,
}: ChatViewProps) {
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const dragCounter = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);

  // State management
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [cancelStreaming, setCancelStreaming] = useState(false);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const modelTools = useModelTools().modelTools;

  // Load messages when currentChatId changes
  useEffect(() => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      try {
        const loadedMessages = await getMessages(currentChatId);
        setMessages(loadedMessages);
      } catch (error) {
        console.error("Failed to load messages:", error);
        const errorId = crypto.randomUUID();
        setErrors((prev) => [
          ...prev,
          {
            id: errorId,
            message:
              error instanceof Error
                ? error.message
                : "Failed to load messages",
          },
        ]);
      }
    };

    loadMessages();

    return () => {
      isMountedRef.current = false;
    };
  }, [currentChatId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Handle assistant responses
  const handleAssistantResponse = useCallback(
    async (
      chatId: string,
      userMessage: string,
      attachments?: FileAttachment[],
    ) => {
      setIsStreaming(true);

      try {
        const availableTools = await modelTools.getTools();
        const imageBlocks: ImageBlockParam[] =
          attachments?.map((att) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: att.type.startsWith("image/")
                ? (att.type as
                    | "image/jpeg"
                    | "image/png"
                    | "image/gif"
                    | "image/webp")
                : "image/jpeg",
              data: att.content,
            },
          })) || [];

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          chat_id: chatId,
          content: [
            {
              role: "assistant",
              content: "...",
            },
          ],
          role: "assistant",
          created_at: new Date().toISOString(),
          attachments: [],
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Accumulate context blocks as they arrive
        const contextBlocks: MessageParam[] = [];
        let streamingText = ""; // Track streaming text separately
        let streamingToolInput = "";

        for await (const chunk of streamAssistantResponse(
          messages
            .filter((msg) => msg.content?.length > 0)
            .flatMap((msg) => msg.content)
            .filter((block) => {
              if (Array.isArray(block.content)) {
                return block.content.some(
                  (b) => b.type === "text",
                  // elide tool results, images, and documents in context to
                  // save tokens
                );
              }
              return true;
            }),
          userMessage,
          imageBlocks,
          availableTools,
          async (name: string, args: Record<string, unknown>) => {
            return await modelTools.executeTool(name, args);
          },
        )) {
          if (cancelStreaming) {
            console.log("Inference cancelled by user.");
            break;
          }
          switch (chunk.type) {
            case "text_chunk":
              streamingText += chunk.content;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? {
                        ...msg,
                        content:
                          contextBlocks.length > 0
                            ? [
                                ...contextBlocks,
                                {
                                  role: "assistant",
                                  content: [
                                    { type: "text", text: streamingText },
                                  ],
                                },
                              ]
                            : [
                                {
                                  role: "assistant",
                                  content: streamingText,
                                },
                              ],
                      }
                    : msg,
                ),
              );
              break;

            case "tool_call_start":
              streamingToolInput = "";
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? {
                        ...msg,
                        content:
                          contextBlocks.length > 0
                            ? [
                                ...contextBlocks,
                                {
                                  role: "assistant",
                                  content: [
                                    {
                                      type: "tool_use",
                                      id: chunk.tool_use_id,
                                      name: chunk.name,
                                      input: "",
                                    },
                                  ],
                                },
                              ]
                            : [
                                {
                                  role: "assistant",
                                  content: [
                                    {
                                      type: "tool_use",
                                      id: chunk.tool_use_id,
                                      name: chunk.name,
                                      input: "",
                                    },
                                  ],
                                },
                              ],
                      }
                    : msg,
                ),
              );
              break;

            case "tool_call_update":
              streamingToolInput += chunk.partialInput;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? {
                        ...msg,
                        content:
                          contextBlocks.length > 0
                            ? [
                                ...contextBlocks,
                                {
                                  role: "assistant",
                                  content: [
                                    {
                                      type: "tool_use",
                                      id: chunk.tool_use_id,
                                      name: chunk.name,
                                      input: streamingToolInput,
                                    },
                                  ],
                                },
                              ]
                            : [
                                {
                                  role: "assistant",
                                  content: [
                                    {
                                      type: "tool_use",
                                      id: chunk.tool_use_id,
                                      name: chunk.name,
                                      input: streamingToolInput,
                                    },
                                  ],
                                },
                              ],
                      }
                    : msg,
                ),
              );

              break;
            case "new_context_message":
              contextBlocks.push(chunk.message);
              streamingText = ""; // Reset streaming text when we get new context
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? {
                        ...msg,
                        content: contextBlocks,
                      }
                    : msg,
                ),
              );
              break;
            case "response_complete":
              // Save the assistant message to the database
              await addMessage(chatId, contextBlocks, "assistant");
              break;
          }
        }
      } catch (error) {
        console.error("Error in handleAssistantResponse:", error);
        const errorId = crypto.randomUUID();
        setErrors((prev) => [
          ...prev,
          {
            id: errorId,
            message:
              error instanceof Error
                ? error.message
                : "An error occurred during assistant response",
          },
        ]);
      } finally {
        setIsStreaming(false);
        setCancelStreaming(false);
      }
    },
    [messages, modelTools, cancelStreaming],
  );

  // Handle sending messages
  const handleSendMessage = useCallback(
    async (
      content: string,
      attachments?: { content: string; type: string }[],
    ) => {
      setIsAutoFollowing(true);
      setShowScrollButton(false);

      try {
        if (!currentChatId) {
          const newChat = await createChat("...");
          onChatCreated(newChat);

          const contentBlocks: ContentBlockParam[] = [
            { type: "text", text: content },
          ];
          const message = await addMessage(
            newChat.id,
            [{ role: "user", content: contentBlocks }],
            "user",
            attachments,
          );
          setMessages((prev) => [...prev, message]);

          await handleAssistantResponse(
            newChat.id,
            content,
            attachments?.map((att) => ({
              ...att,
              name: "attachment",
              size: att.content.length * 0.75,
            })),
          );

          const title = await getSummaryTitle(content);
          await updateChatTitle(newChat.id, title);
          onChatTitleUpdated(newChat.id, title);
        } else {
          const contentBlocks: ContentBlockParam[] = [
            { type: "text", text: content },
          ];
          const message = await addMessage(
            currentChatId,
            [{ role: "user", content: contentBlocks }],
            "user",
            attachments,
          );
          setMessages((prev) => [...prev, message]);

          const userMessages = messages.filter(
            (m) => m.content[0].role === "user",
          );
          if (userMessages.length === 0) {
            const title = await getSummaryTitle(content);
            await updateChatTitle(currentChatId, title);
            onChatTitleUpdated(currentChatId, title);
          }

          await handleAssistantResponse(
            currentChatId,
            content,
            attachments?.map((att) => ({
              ...att,
              name: "attachment",
              size: att.content.length * 0.75,
            })),
          );
        }
      } catch (error: unknown) {
        console.error("Error in handleSendMessage:", error);
        if (currentChatId) {
          const loadedMessages = await getMessages(currentChatId);
          setMessages(loadedMessages);
        }

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
      handleAssistantResponse,
      onChatCreated,
      onChatTitleUpdated,
      messages,
    ],
  );

  const SCROLL_THRESHOLD_PX = 10;

  const handleScroll = useCallback(() => {
    const el = chatWindowRef.current;
    if (!el) return;

    // Are we near the bottom?
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > SCROLL_THRESHOLD_PX) {
      setIsAutoFollowing(false);
    } else {
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

  const handleDismissError = useCallback((errorId: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== errorId));
  }, []);

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

  // Then, memoize the message list components
  const messageList = useMemo(() => {
    return messages.map((message, index) => {
      const isLastMessage = index === messages.length - 1;
      const isAssistantMessage = message.role === "assistant";
      const isStreaming =
        isLastMessage &&
        isAssistantMessage &&
        message.content[0].content === "...";

      let displayContent = "";

      if (isStreaming) {
        displayContent = "...";
      } else if (
        message.content.length === 1 &&
        typeof message.content[0].content === "string"
      ) {
        // Simple text content during streaming
        displayContent = message.content[0].content;
      } else if (Array.isArray(message.content[0].content)) {
        // Process content blocks (both during streaming and completed)
        displayContent = message.content
          .map((param) => {
            if (typeof param.content === "string") {
              return param.content;
            }
            return param.content
              .map((block) => {
                if (block.type === "text") {
                  return block.text;
                } else if (block.type === "tool_use") {
                  // Find if there's a corresponding result for this tool use
                  const toolResult = message.content
                    .flatMap((p) => (Array.isArray(p.content) ? p.content : []))
                    .find(
                      (b) =>
                        b.type === "tool_result" && b.tool_use_id === block.id,
                    ) as { type: "tool_result"; content: string } | undefined;

                  // Try to parse and pretty print the result if it's JSON
                  let formattedResult = toolResult?.content;
                  if (formattedResult) {
                    try {
                      const parsed = JSON.parse(formattedResult);
                      formattedResult = JSON.stringify(parsed, null, 2);
                    } catch {
                      // If it's not valid JSON, leave it as is
                    }
                  }

                  return `\n%%%tool_use_start%%%${JSON.stringify(
                    {
                      type: "executing",
                      name: block.name,
                      args: block.input || {},
                      result: formattedResult,
                      status: toolResult ? "complete" : "running",
                    },
                    null,
                    2,
                  )}%%%tool_use_end%%%\n`;
                } else if (block.type === "tool_result") {
                  // Skip tool results as they're handled in the tool_use block
                  return "";
                }
                return "";
              })
              .join("");
          })
          .join("\n");
      }

      return (
        <ChatMessage
          key={message.id}
          content={displayContent}
          role={message.role}
          timestamp={new Date(message.created_at)}
          isTyping={isStreaming}
          attachments={message.attachments}
        />
      );
    });
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

  return (
    <div className="main-content flex flex-col h-full">
      <div className="chat-window flex-1 relative" ref={chatWindowRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">Hi, how can I help you?</div>
        ) : (
          <>
            {messageList}
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

      <ChatInput
        ref={chatInputRef}
        onSendMessage={handleSendMessage}
        isStreaming={isStreaming}
        onStopInference={() => setCancelStreaming(true)}
      />
    </div>
  );
}