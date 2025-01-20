import { useState } from 'react';
import { ModelSelect } from './ModelSelect';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onModelChange?: (model: string) => void;
}

export function ChatInput({ onSendMessage, onModelChange }: ChatInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleSend = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue('');
      // Reset textarea height
      const textarea = document.querySelector('.message-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = '24px';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-container">
      <div className="message-input-group">
        <ModelSelect onModelChange={onModelChange} />
        <textarea
          className="message-input"
          placeholder="Type a message..."
          rows={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            if (!target.value) {
              target.style.height = '24px';
            } else {
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }
          }}
        />
        <button 
          className="send-button"
          onClick={handleSend}
          disabled={!inputValue.trim()}
        >
          <svg
            stroke="currentColor"
            fill="none"
            strokeWidth="2"
            viewBox="0 0 24 24"
            strokeLinecap="round"
            strokeLinejoin="round"
            height="1em"
            width="1em"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  );
} 