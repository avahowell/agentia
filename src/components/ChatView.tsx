import React, {
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    useCallback
} from 'react';
import {
    Message,
    Chat,
    addMessage,
    getMessages,
    createChat,
    updateChatTitle
} from '../services/chat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ErrorMessage } from './ErrorMessage';
import {
    streamAssistantResponse,
    getSummaryTitle,
    initializeChatContext
} from '../services/ai';

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

const STORAGE_KEY = 'chat-scroll-positions';

// A tiny debounce to reduce localStorage writes
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number) {
    let timer: number | undefined;
    return (...args: Parameters<T>) => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delay);
    };
}

function isNearBottom(el: HTMLElement) {
    // Check if we're exactly at the bottom (accounting for floating point precision)
    const diff = el.scrollHeight - (el.scrollTop + el.clientHeight);
    return diff < 1;
}

export function ChatView({
    currentChatId,
    initialMessages,
    onChatCreated,
    onChatTitleUpdated,
    onMessagesUpdated
}: ChatViewProps) {
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const userHasScrolled = useRef(false);

    // Store scroll positions by chat ID
    const [scrollPositions, setScrollPositions] = useState<Record<string, number>>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    // Save scroll position with debounce
    const saveScrollPosition = useCallback((top: number) => {
        if (!currentChatId) return;
        setScrollPositions(prev => {
            const updated = { ...prev };
            if (isNearBottom(chatWindowRef.current!)) {
                delete updated[currentChatId]; // Remove position if at bottom
            } else {
                updated[currentChatId] = top;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            return updated;
        });
    }, [currentChatId]);

    const debouncedSaveScroll = useCallback(debounce(saveScrollPosition, 200), [saveScrollPosition]);

    // Handle user scroll
    const handleScroll = useCallback(() => {
        const el = chatWindowRef.current;
        if (!el) return;

        if (isNearBottom(el)) {
            userHasScrolled.current = false;
        } else {
            userHasScrolled.current = true;
        }
        debouncedSaveScroll(el.scrollTop);
    }, [debouncedSaveScroll]);

    // Load saved scroll position when chat changes
    useEffect(() => {
        if (!currentChatId || !chatWindowRef.current) return;
        
        const savedPos = scrollPositions[currentChatId];
        if (typeof savedPos === 'number') {
            chatWindowRef.current.scrollTop = savedPos;
            userHasScrolled.current = true;
        } else {
            userHasScrolled.current = false;
        }
    }, [currentChatId, scrollPositions]);

    // Set up scroll listener
    useEffect(() => {
        const el = chatWindowRef.current;
        if (!el) return;
        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    // All messages for the current chat
    const [messages, setMessages] = useState<Message[]>(initialMessages || []);

    // If the assistant is currently streaming tokens
    const [isStreaming, setIsStreaming] = useState(false);
    // Show an "assistant is typing" bubble if we haven't received the first token yet
    const [isWaitingForFirstToken, setIsWaitingForFirstToken] = useState(false);

    // Temporary error messages
    const [errors, setErrors] = useState<ErrorItem[]>([]);

    const scrollToBottom = () => {
        if (!userHasScrolled.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Reset scroll override when changing chats
    useEffect(() => {
        userHasScrolled.current = false;
    }, [currentChatId]);

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

                setMessages(loaded);
                onMessagesUpdated(currentChatId, loaded);

                // Initialize the AI context
                initializeChatContext(currentChatId, loaded);

                // Reset scroll state for new chat
                userHasScrolled.current = false;
            } catch (error) {
                console.error('Failed to load messages:', error);
            }
        };

        loadMessages();

        return () => {
            isMounted = false;
        };
    }, [currentChatId, initialMessages]);

    // If initialMessages prop changes while the same chat is active, update local
    useEffect(() => {
        if (currentChatId && initialMessages) {
            setMessages(initialMessages);
        }
    }, [initialMessages]);

    // -------------------------------------------------------------------------
    // 2) Sending user messages
    // -------------------------------------------------------------------------
    const handleSendMessage = async (content: string) => {
        try {
            if (!currentChatId) {
                // Create a new chat
                const newChat = await createChat('...');
                onChatCreated(newChat);

                // Insert user message from server
                const userMsg = await addMessage(newChat.id, content, 'user');
                setMessages((prev) => {
                    const updated = [...prev, userMsg];
                    onMessagesUpdated(newChat.id, updated);
                    return updated;
                });

                await handleAssistantResponse(newChat.id, content);

                // Title
                const title = await getSummaryTitle(content);
                await updateChatTitle(newChat.id, title);
                onChatTitleUpdated(newChat.id, title);

            } else {
                // Existing chat
                const userMsg = await addMessage(currentChatId, content, 'user');
                setMessages((prev) => {
                    const updated = [...prev, userMsg];
                    onMessagesUpdated(currentChatId, updated);
                    return updated;
                });

                // If first user message, set title
                const userCountBefore = messages.filter((m) => m.role === 'user').length;
                if (userCountBefore === 0) {
                    const title = await getSummaryTitle(content);
                    await updateChatTitle(currentChatId, title);
                    onChatTitleUpdated(currentChatId, title);
                }

                await handleAssistantResponse(currentChatId, content);
            }
        } catch (error) {
            setIsStreaming(false);
            const errorMessage =
                error instanceof Error ? error.message : 'An error occurred';
            const errorId = crypto.randomUUID();
            setErrors((prev) => [...prev, { id: errorId, message: errorMessage }]);
            setTimeout(() => {
                setErrors((prev) => prev.filter((e) => e.id !== errorId));
            }, 5000);
        }
    };

    // -------------------------------------------------------------------------
    // 5) Streaming the assistant's response token by token
    // -------------------------------------------------------------------------
    const handleAssistantResponse = async (chatId: string, userMessage: string) => {
        setIsStreaming(true);
        setIsWaitingForFirstToken(true);

        let assistantMessage = '';
        const tempId = crypto.randomUUID();
        let placeholderInserted = false;

        // Read tokens
        for await (const chunk of streamAssistantResponse(chatId, userMessage)) {
            setIsWaitingForFirstToken(false);
            assistantMessage += chunk;

            if (!placeholderInserted) {
                // Insert a placeholder message on the first chunk
                placeholderInserted = true;
                setMessages((prev) => {
                    const placeholder: Message = {
                        id: tempId,
                        chat_id: chatId,
                        content: assistantMessage,
                        role: 'assistant',
                        created_at: new Date().toISOString()
                    };
                    return [...prev, placeholder];
                });
            } else {
                // Update existing placeholder
                setMessages((prev) => {
                    const idx = prev.findIndex((m) => m.id === tempId);
                    if (idx < 0) return prev;
                    const updatedMsg = { ...prev[idx], content: assistantMessage };
                    const newList = [...prev];
                    newList[idx] = updatedMsg;
                    return newList;
                });
            }
        }

        setIsStreaming(false);

        // Save the final assistant message once
        const finalMsg = await addMessage(chatId, assistantMessage, 'assistant');

        // Replace the placeholder
        setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === tempId);
            if (idx < 0) {
                // If lost placeholder, just append
                const newList = [...prev, finalMsg];
                onMessagesUpdated(chatId, newList);
                return newList;
            }
            const newList = [
                ...prev.slice(0, idx),
                finalMsg,
                ...prev.slice(idx + 1)
            ];
            onMessagesUpdated(chatId, newList);
            return newList;
        });
    };

    // -------------------------------------------------------------------------
    // 6) Dismiss errors
    // -------------------------------------------------------------------------
    const handleDismissError = (errorId: string) => {
        setErrors((prev) => prev.filter((e) => e.id !== errorId));
    };

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    return (
        <div className="main-content">
            <div className="chat-window" ref={chatWindowRef}>
                {messages.length === 0 ? (
                    <div className="welcome-message">Hi, how can I help you?</div>
                ) : (
                    <>
                        {messages.map((message) => (
                            <ChatMessage
                                key={message.id}
                                content={message.content}
                                role={message.role}
                                timestamp={new Date(message.created_at)}
                                isTyping={false}
                            />
                        ))}
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

                <div className="error-container">
                    {errors.map((error) => (
                        <ErrorMessage
                            key={error.id}
                            message={error.message}
                            onDismiss={() => handleDismissError(error.id)}
                        />
                    ))}
                </div>
            </div>

            <ChatInput onSendMessage={handleSendMessage} />
        </div>
    );
}