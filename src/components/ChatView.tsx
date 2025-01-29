import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useReducer,
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
import { MessageParam } from "@anthropic-ai/sdk/resources/index.mjs";

interface ChatViewProps {
  currentChatId: string | null;
  onChatCreated: (chat: Chat) => void;
  onChatTitleUpdated: (chatId: string, title: string) => void;
}

interface ErrorItem {
  id: string;
  message: string;
}

interface ChatViewState {
  messages: Message[];
  isStreaming: boolean;
  isWaitingForFirstToken: boolean;
  currentStreamingMessage: {
    id: string;
    content: string;
  } | null;
  errors: ErrorItem[];
  isAutoFollowing: boolean;
  showScrollButton: boolean;
}

type ChatViewAction =
  | { type: 'START_STREAMING' }
  | { type: 'RECEIVED_FIRST_TOKEN', content: string, messageId: string, chatId: string }
  | { type: 'UPDATE_STREAMING_MESSAGE', content: string, chatId: string }
  | { type: 'LOAD_MESSAGES', chatId: string }
  | { type: 'MESSAGES_LOADED', messages: Message[] }
  | { type: 'UPDATE_MESSAGE_CONTEXT', messages: MessageParam[] }
  | { type: 'APPEND_MESSAGE', message: Message }
  | { type: 'ADD_USER_MESSAGE', content: MessageParam, chatId: string, attachments?: { content: string; type: string }[] }
  | { type: 'COMPLETE_STREAMING', chatId: MessageParam, messageId: string, content: string, isFinal: boolean }
  | { type: 'ADD_ERROR', error: ErrorItem }
  | { type: 'REMOVE_ERROR', errorId: string }
  | { type: 'SET_AUTO_FOLLOWING', isFollowing: boolean }
  | { type: 'SET_SCROLL_BUTTON', show: boolean };

// Add this before the reducer
function logStateTransition(prevState: ChatViewState, action: ChatViewAction, nextState: ChatViewState) {
  // Only log specific actions related to messages and streaming
  const relevantActions = [
    'START_STREAMING',
    'RECEIVED_FIRST_TOKEN',
    'UPDATE_STREAMING_MESSAGE',
    'UPDATE_MESSAGES',
    'COMPLETE_STREAMING'
  ];

  if (!relevantActions.includes(action.type)) {
    return nextState;
  }

  console.group(`ChatView Update: ${action.type}`);

  // Log message changes
  if (prevState.messages !== nextState.messages) {
    console.log('Messages:', {
      count: `${prevState.messages.length} -> ${nextState.messages.length}`,
      latest: nextState.messages[nextState.messages.length - 1]
    });
  }

  // Log streaming state
  if (prevState.isStreaming !== nextState.isStreaming ||
    prevState.isWaitingForFirstToken !== nextState.isWaitingForFirstToken) {
    console.log('Streaming State:', {
      isStreaming: `${prevState.isStreaming} -> ${nextState.isStreaming}`,
      waitingForToken: `${prevState.isWaitingForFirstToken} -> ${nextState.isWaitingForFirstToken}`
    });
  }

  // Log streaming message updates
  if (prevState.currentStreamingMessage?.content !== nextState.currentStreamingMessage?.content) {
    console.log('Streaming Message:', {
      id: nextState.currentStreamingMessage?.id,
      contentLength: nextState.currentStreamingMessage?.content.length
    });
  }

  console.groupEnd();
  return nextState;
}

// Simplify middleware to not depend on state
async function chatViewMiddleware(action: ChatViewAction, dispatch: React.Dispatch<ChatViewAction>) {
  switch (action.type) {
    case 'LOAD_MESSAGES':
      try {
        const messages = await getMessages(action.chatId);
        dispatch({ type: 'MESSAGES_LOADED', messages });
      } catch (error) {
        console.error("Failed to load messages:", error);
        const errorId = crypto.randomUUID();
        dispatch({
          type: 'ADD_ERROR',
          error: {
            id: errorId,
            message: error instanceof Error ? error.message : "Failed to load messages"
          }
        });
      }
      break;

    case 'ADD_USER_MESSAGE':
      try {
        const message = await addMessage(action.chatId, action.content, "user", action.attachments);
        // Only append the new message instead of reloading all
        dispatch({ type: 'APPEND_MESSAGE', message: message });
      } catch (error) {
        console.error("Failed to add user message:", error);
        const errorId = crypto.randomUUID();
        dispatch({
          type: 'ADD_ERROR',
          error: {
            id: errorId,
            message: error instanceof Error ? error.message : "Failed to add message"
          }
        });
      }
      break;

    case 'COMPLETE_STREAMING':
      try {
        // Use the same ID for both ephemeral and final message
        console.log("adding message", action.chatId, action.content, "assistant");
        const message = await addMessage(action.chatId, action.content, "assistant");
        // Only append the new message instead of reloading all
        dispatch({ type: 'APPEND_MESSAGE', message: message });
      } catch (error) {
        console.error("Failed to save streaming message:", error);
        // Only reload all messages if we failed to save the final message
        dispatch({ type: 'LOAD_MESSAGES', chatId: action.chatId });
      }
      break;
  }
}

// Update the custom dispatch hook to not pass state
function useAsyncDispatch(dispatch: React.Dispatch<ChatViewAction>) {
  return useCallback(
    (action: ChatViewAction) => {
      dispatch(action);
      chatViewMiddleware(action, dispatch).catch(console.error);
    },
    [dispatch]
  );
}

// Update the reducer to handle the new actions
function chatViewReducer(state: ChatViewState, action: ChatViewAction): ChatViewState {
  const nextState = (() => {
    switch (action.type) {
      case 'START_STREAMING':
        return {
          ...state,
          isStreaming: true,
          isWaitingForFirstToken: true
        };

      case 'RECEIVED_FIRST_TOKEN': {
        const newMessage = {
          id: action.messageId,
          chat_id: action.chatId,
          content: action.content,
          role: "assistant",
          created_at: new Date().toISOString(),
          attachments: undefined,
        };
        return {
          ...state,
          isWaitingForFirstToken: false,
          currentStreamingMessage: {
            id: action.messageId,
            content: action.content
          },
          messages: [...state.messages, newMessage]
        };
      }

      case 'UPDATE_STREAMING_MESSAGE': {
        if (!state.currentStreamingMessage) return state;
        const { id, content } = state.currentStreamingMessage;

        console.log("updating message", action.chatId, action.content);
        console.log("current message", content + action.content);

        return {
          ...state,
          currentStreamingMessage: {
            id,
            content: content + action.content
          },
          messages: state.messages.map(msg =>
            msg.id === id
              ? { ...msg, content: content + action.content }
              : msg
          )
        };
      }

      case 'APPEND_MESSAGE':
        return {
          ...state,
          messages: [...state.messages, action.message]
        };

      case 'MESSAGES_LOADED':
        return {
          ...state,
          messages: action.messages
        };

      case 'COMPLETE_STREAMING':
        return {
          ...state,
          isStreaming: false,
          isWaitingForFirstToken: false,
          currentStreamingMessage: null,
        };

      case 'ADD_ERROR':
        return {
          ...state,
          errors: [...state.errors, action.error]
        };

      case 'REMOVE_ERROR':
        return {
          ...state,
          errors: state.errors.filter(e => e.id !== action.errorId)
        };

      case 'SET_AUTO_FOLLOWING':
        return {
          ...state,
          isAutoFollowing: action.isFollowing
        };

      case 'SET_SCROLL_BUTTON':
        return {
          ...state,
          showScrollButton: action.show
        };

      default:
        return state;
    }
  })();

  return logStateTransition(state, action, nextState);
}

export function ChatView({
  currentChatId,
  onChatCreated,
  onChatTitleUpdated,
}: ChatViewProps) {
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);

  const [state, baseDispatch] = useReducer(chatViewReducer, {
    messages: [],
    isStreaming: false,
    isWaitingForFirstToken: false,
    currentStreamingMessage: null,
    errors: [],
    isAutoFollowing: true,
    showScrollButton: false
  });

  const modelTools = useModelTools();

  // Create async dispatch that handles database operations
  const dispatch = useAsyncDispatch(baseDispatch);

  // Load messages when currentChatId changes
  useEffect(() => {
    if (!currentChatId) {
      dispatch({ type: 'MESSAGES_LOADED', messages: [] });
      return;
    }

    // Load messages for the current chat
    dispatch({ type: 'LOAD_MESSAGES', chatId: currentChatId });

    return () => {
      isMountedRef.current = false;
    };
  }, [currentChatId]); // Remove dispatch from dependencies

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
      attachments?: { content: string; type: string }[],
    ) => {
      dispatch({ type: 'START_STREAMING' });

      let assistantMessage = "";
      let currentMessageId = "";
      let isFirstChunk = true;
      let hasReceivedFirstToken = false;

      try {
        const availableTools = await modelTools.getTools();

        let firstTokenReceived = false;

        for await (const chunk of streamAssistantResponse(
          state.messages.map((msg) => msg.message),
          userMessage,
          attachments,
          availableTools,
          async (name: string, args: Record<string, unknown>) => {
            return await modelTools.executeTool(name, args);
          }
        )) {
          console.log("chunk", chunk);
          switch (chunk.type) {
            case 'text_chunk':
              if (isFirstChunk) {
                isFirstChunk = false;
                currentMessageId = crypto.randomUUID();
                dispatch({ type: 'RECEIVED_FIRST_TOKEN', messageId: currentMessageId, chatId: chatId, content: chunk.content });
                continue;
              }

              console.log("updating message", chatId, chunk.content);
              dispatch({ type: 'UPDATE_STREAMING_MESSAGE', chatId: chatId, content: chunk.content });
              break;
            case 'tool_call_complete':
              break;
            case 'tool_result':
              break;
            case 'tool_error':
              break;
            case 'response_complete':
              break;
            case 'new_context_message':
              console.log("new_context_message", chunk.message);
              dispatch({ type: 'APPEND_MESSAGE', chatId: chatId, content: chunk.message.content });
              break;
              
          }
        }
      } catch (error) {
        console.error("Error in handleAssistantResponse:", error);
      } 
    },
    [state.messages, modelTools, dispatch]
  );

  // Handle sending messages
  const handleSendMessage = useCallback(
    async (content: string, attachments?: { content: string; type: string }[]) => {
      dispatch({ type: 'SET_AUTO_FOLLOWING', isFollowing: true });
      dispatch({ type: 'SET_SCROLL_BUTTON', show: false });

      try {
        if (!currentChatId) {
          const newChat = await createChat("...");
          onChatCreated(newChat);

          dispatch({
            type: 'ADD_USER_MESSAGE',
            chatId: newChat.id,
            content,
            attachments
          });

          await handleAssistantResponse(newChat.id, content, attachments);

          const title = await getSummaryTitle(content);
          await updateChatTitle(newChat.id, title);
          onChatTitleUpdated(newChat.id, title);
        } else {
          dispatch({
            type: 'ADD_USER_MESSAGE',
            chatId: currentChatId,
            content,
            attachments
          });

          const userCountBefore = state.messages.filter(m => m.role === "user").length;
          if (userCountBefore === 0) {
            const title = await getSummaryTitle(content);
            await updateChatTitle(currentChatId, title);
            onChatTitleUpdated(currentChatId, title);
          }

          await handleAssistantResponse(currentChatId, content, attachments);
        }
      } catch (error: unknown) {
        console.error("Error in handleSendMessage:", error);
        if (currentChatId && state.currentStreamingMessage) {
          dispatch({
            type: 'COMPLETE_STREAMING',
            chatId: currentChatId,
            messageId: state.currentStreamingMessage.id,
            content: state.currentStreamingMessage.content,
            isFinal: true
          });
        }

        if (currentChatId) {
          dispatch({ type: 'LOAD_MESSAGES', chatId: currentChatId });
        }

        const errorMessage = error instanceof Error ? error.message : "An error occurred";
        const errorId = crypto.randomUUID();
        dispatch({ type: 'ADD_ERROR', error: { id: errorId, message: errorMessage } });
        setTimeout(() => {
          dispatch({ type: 'REMOVE_ERROR', errorId });
        }, 5000);
      }
    },
    [currentChatId, handleAssistantResponse, onChatCreated, onChatTitleUpdated, dispatch]
  );

  // Replace individual state hooks with reducer state
  const { messages, isStreaming, isWaitingForFirstToken, errors, isAutoFollowing, showScrollButton } = state;

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
      dispatch({ type: 'SET_AUTO_FOLLOWING', isFollowing: false });
    } else {
      // The user is effectively still at the bottom => keep auto-follow
      dispatch({ type: 'SET_AUTO_FOLLOWING', isFollowing: true });
    }

    if (distanceFromBottom > 100) {
      dispatch({ type: 'SET_SCROLL_BUTTON', show: true });
    } else {
      dispatch({ type: 'SET_SCROLL_BUTTON', show: false });
    }
  }, [dispatch]);

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
    dispatch({ type: 'SET_AUTO_FOLLOWING', isFollowing: true });
    dispatch({ type: 'SET_SCROLL_BUTTON', show: false });
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [currentChatId, dispatch]);

  const scrollToBottom = useCallback(() => {
    dispatch({ type: 'SET_AUTO_FOLLOWING', isFollowing: true });
    dispatch({ type: 'SET_SCROLL_BUTTON', show: false });
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dispatch]);

  // -------------------------------------------------------------------------
  // 6) Dismiss errors
  // -------------------------------------------------------------------------
  const handleDismissError = useCallback((errorId: string) => {
    dispatch({ type: 'REMOVE_ERROR', errorId });
  }, []);

  
  const combinedMessages = useMemo(() => {
    return messages; 
    /*
    const result: Message[] = [];
    let currentAssistantMessage: Message | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const nextMsg = i < messages.length - 1 ? messages[i + 1] : null;

      if (msg.role === 'assistant') {
        if (!currentAssistantMessage) {
          // Start new assistant message group
          currentAssistantMessage = { ...msg };

          // If next message is a system message (tool result), reconstruct tool use blocks
          if (nextMsg?.role === 'system' && nextMsg.content.startsWith('Tool ')) {
            const match = nextMsg.content.match(/Tool (\w+) returned: (.+)/);
            if (match) {
              const [_, toolName, resultJson] = match;
              const { args, result } = JSON.parse(resultJson);
              // Add both running and complete tool use blocks
              currentAssistantMessage.content += `\n\n%%%tool_use_start%%%${JSON.stringify({
                type: 'executing',
                name: toolName,
                args,
                status: 'running'
              })}%%%tool_use_end%%%\n\n%%%tool_use_start%%%${JSON.stringify({
                type: 'executing',
                name: toolName,
                args,
                result,
                status: 'complete'
              })}%%%tool_use_end%%%\n\n`;
            }
          }
        } else {
          // Combine with previous assistant message
          currentAssistantMessage.content += '\n' + msg.content;
        }
      } else if (msg.role === 'user') {
        // When we hit a user message, save any pending assistant message and add the user message
        if (currentAssistantMessage) {
          result.push(currentAssistantMessage);
          currentAssistantMessage = null;
        }
        result.push(msg);
      }
      // Skip system messages as they're used for reconstruction
    }

    // Add final assistant message if pending
    if (currentAssistantMessage) {
      result.push(currentAssistantMessage);
    }

    return result;
    */
  }, [messages]);
  
  // Then, memoize the message list components
  const messageList = useMemo(() => {
    return combinedMessages.map((message) => (
      <ChatMessage
        key={message.id}
        content={message.message.content}
        role={message.role}
        timestamp={new Date(message.created_at)}
        isTyping={false}
        attachments={message.attachments}
      />
    ));
  }, [combinedMessages]);

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
