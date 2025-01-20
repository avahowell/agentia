import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { Message } from '../services/chat';

interface ChatViewProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
}

export function ChatView({ messages, onSendMessage }: ChatViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="main-content">
      <div className="chat-window">
        {messages.length === 0 ? (
          <div className="welcome-message">
            Hi, how can I help you?
          </div>
        ) : (
          messages.map((message) => (
            <ChatMessage
              key={message.id}
              content={message.content}
              role={message.role}
              timestamp={new Date(message.created_at)}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput onSendMessage={onSendMessage} />
    </div>
  );
} 