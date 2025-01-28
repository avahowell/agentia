import React, {
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    useCallback,
    useMemo
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
import { ChatInput, ChatInputHandle } from './ChatInput';
import { ErrorMessage } from './ErrorMessage';
import {
    streamAssistantResponse,
    getSummaryTitle
} from '../services/ai';
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from '@tauri-apps/api/core';
import type { Event } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-fs';
import { getCurrentWebview } from "@tauri-apps/api/webview";

type FileDropPayload = {
    type: 'over' | 'drop' | 'cancel';
    paths: string[];
    position?: { x: number; y: number };
};

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

    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);

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

                // Only update if messages have actually changed
                setMessages(loaded);

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
    const handleAssistantResponse = useCallback(async (chatId: string, userMessage: string, attachments?: { content: string; type: string }[]) => {
        console.log('handleAssistantResponse called with chatId:', chatId, 'userMessage:', userMessage, 'attachments:', attachments);
        setIsStreaming(true);
        setIsWaitingForFirstToken(true);

        let assistantMessage = '';
        const messageId = crypto.randomUUID();
        let isFirstToken = true;

        console.log('Messages before streaming:', messages);

        try {
            // Pass the current messages array directly to streamAssistantResponse
            for await (const chunk of streamAssistantResponse(
                messages.map(msg => ({ 
                    role: msg.role as 'user' | 'assistant', 
                    content: msg.content,
                    attachments: msg.attachments // Include attachments in message context
                })),
                userMessage,
                attachments
            )) {
                console.log('Received chunk:', chunk);
                assistantMessage += chunk;
                
                if (isFirstToken) {
                    console.log('Creating new message');
                    // First token - create the message
                    setIsWaitingForFirstToken(false);
                    isFirstToken = false;
                    setMessages(prev => [...prev, {
                        id: messageId,
                        chat_id: chatId,
                        content: assistantMessage,
                        role: 'assistant',
                        created_at: new Date().toISOString(),
                        attachments: undefined
                    }]);
                } else {
                    // Update existing message
                    setMessages(prev => {
                        const newMessages = [...prev];
                        const lastMessage = newMessages[newMessages.length - 1];
                        if (lastMessage.id === messageId) {
                            lastMessage.content = assistantMessage;
                        }
                        return newMessages;
                    });
                }
            }

            // Save the final message to the database
            const finalMsg = await addMessage(chatId, assistantMessage, 'assistant');
            
            // Replace our temporary message with the saved one
            setMessages(prev => {
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
    }, [messages, onMessagesUpdated]);

    // Memoize handleSendMessage
    const handleSendMessage = useCallback(async (content: string, attachments?: { content: string; type: string }[]) => {
        try {
            if (!currentChatId) {
                // Create a new chat
                console.log('Creating new chat...');
                const newChat = await createChat('...');
                onChatCreated(newChat);

                // Insert user message from server
                console.log('Adding user message to new chat...');
                const userMsg = await addMessage(newChat.id, content, 'user', attachments);
                setMessages([userMsg]); // Initialize with just the user message
                onMessagesUpdated(newChat.id, [userMsg]);

                console.log('Getting assistant response...');
                await handleAssistantResponse(newChat.id, content, attachments);

                // Title
                console.log('Updating chat title...');
                const title = await getSummaryTitle(content);
                await updateChatTitle(newChat.id, title);
                onChatTitleUpdated(newChat.id, title);

            } else {
                // Existing chat
                console.log('Adding message to existing chat:', currentChatId);
                const userMsg = await addMessage(currentChatId, content, 'user', attachments);
                setMessages((prev) => {
                    const updated = [...prev, userMsg];
                    onMessagesUpdated(currentChatId, updated);
                    return updated;
                });

                // If first user message, set title
                const userCountBefore = messages.filter((m) => m.role === 'user').length;
                if (userCountBefore === 0) {
                    console.log('Setting initial chat title...');
                    const title = await getSummaryTitle(content);
                    await updateChatTitle(currentChatId, title);
                    onChatTitleUpdated(currentChatId, title);
                }

                console.log('Getting assistant response...');
                await handleAssistantResponse(currentChatId, content, attachments);
            }
        } catch (error: unknown) {
            console.error('Error in handleSendMessage:', error);
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace available');
            setIsStreaming(false);
            const errorMessage =
                error instanceof Error ? error.message : 'An error occurred';
            const errorId = crypto.randomUUID();
            setErrors((prev) => [...prev, { id: errorId, message: errorMessage }]);
            setTimeout(() => {
                setErrors((prev) => prev.filter((e) => e.id !== errorId));
            }, 5000);
        }
    }, [currentChatId, messages, handleAssistantResponse, onChatCreated, onChatTitleUpdated, onMessagesUpdated]);

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
        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer?.types.includes('Files')) {
                e.dataTransfer.dropEffect = 'copy';
            }
        };

        const handleDragEnter = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (e.dataTransfer?.types.includes('Files')) {
                dragCounter.current += 1;
                if (dragCounter.current === 1) {
                    setIsDragging(true);
                }
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (e.dataTransfer?.types.includes('Files')) {
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
                const validImageFiles = files.filter(file => 
                    file.type.startsWith('image/') && 
                    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)
                );

                if (validImageFiles.length > 0 && chatInputRef.current) {
                    chatInputRef.current.addFiles(validImageFiles).catch(console.error);
                }
            }
        };

        mainContent.addEventListener('dragover', handleDragOver as EventListener);
        mainContent.addEventListener('dragenter', handleDragEnter as EventListener);
        mainContent.addEventListener('dragleave', handleDragLeave as EventListener);
        mainContent.addEventListener('drop', handleDropEvent as EventListener);

        return () => {
            mainContent.removeEventListener('dragover', handleDragOver as EventListener);
            mainContent.removeEventListener('dragenter', handleDragEnter as EventListener);
            mainContent.removeEventListener('dragleave', handleDragLeave as EventListener);
            mainContent.removeEventListener('drop', handleDropEvent as EventListener);
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

                <div className="error-container">
                    {errorList}
                </div>

                {/* Drag overlay */}
                {isDragging && (
                    <div className="drag-overlay">
                        <div className="drag-overlay-content">
                            <svg className="w-12 h-12 text-blue-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
            />
        </div>
    );
}