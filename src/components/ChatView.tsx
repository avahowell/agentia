import React, { useState, useRef, useEffect } from 'react';
import { Message, Chat, addMessage, getMessages, createChat, updateChatTitle } from '../services/chat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ErrorMessage } from './ErrorMessage';
import { streamAssistantResponse, getSummaryTitle, initializeChatContext } from '../services/ai';

interface ChatViewProps {
  currentChatId: string | null;
  onChatCreated: (chat: Chat) => void;
  onChatTitleUpdated: (chatId: string, title: string) => void;
}

interface ErrorItem {
  id: string;
  message: string;
}

export function ChatView({ currentChatId, onChatCreated, onChatTitleUpdated }: ChatViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [isWaitingForFirstToken, setIsWaitingForFirstToken] = useState(false);

  // Load messages when chat changes
  useEffect(() => {
    if (currentChatId) {
      const loadMessages = async () => {
        try {
          const chatMessages = await getMessages(currentChatId);
          setMessages(chatMessages);
          // Initialize the chat context with existing messages
          initializeChatContext(currentChatId, chatMessages);
        } catch (error) {
          console.error('Failed to load messages:', error);
        }
      };
      loadMessages();
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (content: string) => {
    try {
      if (!currentChatId) {
        // Create a new chat if none is selected
        const newChat = await createChat('...');
        onChatCreated(newChat);
        
        // Add the message
        await addMessage(newChat.id, content, 'user');
        const updatedMessages = await getMessages(newChat.id);
        setMessages(updatedMessages);

        // Show waiting indicator
        setIsWaitingForFirstToken(true);
        
        // Stream the assistant's response
        let assistantMessage = '';
        const tempMessageId = crypto.randomUUID();
        for await (const chunk of streamAssistantResponse(newChat.id, content)) {
          setIsWaitingForFirstToken(false);
          assistantMessage += chunk;
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.id === tempMessageId) {
              return [...prev.slice(0, -1), { ...lastMessage, content: assistantMessage }];
            } else {
              return [...prev, { id: tempMessageId, chat_id: newChat.id, content: chunk, role: 'assistant', created_at: new Date().toISOString() }];
            }
          });
        }
        await addMessage(newChat.id, assistantMessage, 'assistant');
        setMessages(await getMessages(newChat.id));
        
        // Update chat title
        const title = await getSummaryTitle(content);
        await updateChatTitle(newChat.id, title);
        onChatTitleUpdated(newChat.id, title);
      } else {
        // Add message to existing chat
        await addMessage(currentChatId, content, 'user');
        const updatedMessages = await getMessages(currentChatId);
        setMessages(updatedMessages);

        // If this is the first message, update the chat title
        if (updatedMessages.length === 1) {
          const title = await getSummaryTitle(content);
          await updateChatTitle(currentChatId, title);
          onChatTitleUpdated(currentChatId, title);
        }
        
        // Show waiting indicator
        setIsWaitingForFirstToken(true);
        
        // Stream the assistant's response
        let assistantMessage = '';
        const tempMessageId = crypto.randomUUID();
        for await (const chunk of streamAssistantResponse(currentChatId, content)) {
          setIsWaitingForFirstToken(false);
          assistantMessage += chunk;
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.id === tempMessageId) {
              return [...prev.slice(0, -1), { ...lastMessage, content: assistantMessage }];
            } else {
              return [...prev, { id: tempMessageId, chat_id: currentChatId, content: chunk, role: 'assistant', created_at: new Date().toISOString() }];
            }
          });
        }
        await addMessage(currentChatId, assistantMessage, 'assistant');
        setMessages(await getMessages(currentChatId));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      const errorId = crypto.randomUUID();
      setErrors(prev => [...prev, { id: errorId, message: errorMessage }]);
      
      setTimeout(() => {
        setErrors(prev => prev.filter(e => e.id !== errorId));
      }, 5000);
    }
  };

  const handleDismissError = (errorId: string) => {
    setErrors(prev => prev.filter(e => e.id !== errorId));
  };

  return (
    <div className="main-content">
      <div className="chat-window">
        {messages.length === 0 ? (
          <div className="welcome-message">
            Hi, how can I help you?
          </div>
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
          </>
        )}
        
        <div className="error-container">
          {errors.map(error => (
            <ErrorMessage
              key={error.id}
              message={error.message}
              onDismiss={() => handleDismissError(error.id)}
            />
          ))}
        </div>
        
        <div ref={messagesEndRef} />
      </div>
      
      <ChatInput onSendMessage={handleSendMessage} />
    </div>
  );
} 