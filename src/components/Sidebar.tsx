import { Chat } from '../services/chat';

interface SidebarProps {
  chats: Chat[];
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  selectedChatId?: string;
}

export function Sidebar({ chats, onNewChat, onSelectChat, selectedChatId }: SidebarProps) {
  return (
    <div className="sidebar">
      <button className="new-chat-button" onClick={onNewChat}>
        New Chat
      </button>
      
      <div className="chat-list">
        {chats.map(chat => (
          <div
            key={chat.id}
            className={`chat-item ${chat.id === selectedChatId ? 'selected' : ''}`}
            onClick={() => onSelectChat(chat.id)}
          >
            {chat.title}
          </div>
        ))}
      </div>
    </div>
  );
} 