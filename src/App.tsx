import { useState, useEffect } from "react";
import "./App.css";
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ToolSidebar } from './components/ToolSidebar';
import { SettingsView } from './components/SettingsView';
import { ToolsView } from './components/ToolsView';
import { Chat, Message, createChat, addMessage, getChats, getMessages, updateChatTitle } from './services/chat';
import { streamAssistantResponse, clearChatContext, initializeChatContext, getSummaryTitle } from './services/ai';

function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messageCache, setMessageCache] = useState<Record<string, Message[]>>({});
  const MAX_CACHED_CHATS = 20; // Only keep messages for the 20 most recent chats
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
  const [selectedTool, setSelectedTool] = useState('chat');
  const [showSettings, setShowSettings] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);

  // Load chats and their messages on mount
  useEffect(() => {
    const loadChatsAndMessages = async () => {
      try {
        const loadedChats = await getChats();
        setChats(loadedChats);

        // Load messages for the 10 most recent chats
        const recentChats = loadedChats.slice(0, 10);
        const messagesPromises = recentChats.map(chat => 
          getMessages(chat.id).then(messages => [chat.id, messages] as const)
        );
        
        const messagesResults = await Promise.all(messagesPromises);
        const newMessageCache = Object.fromEntries(messagesResults);
        setMessageCache(newMessageCache);
      } catch (error) {
        console.error('Failed to load chats and messages:', error);
      }
    };
    
    loadChatsAndMessages();
  }, []);

  // Check for API keys on mount
  useEffect(() => {
    const checkApiKeys = async () => {
      try {
        const keys = await invoke<{ anthropic?: string; openai?: string }>('get_api_keys');
        setHasAnthropicKey(!!keys.anthropic);
        setHasOpenAiKey(!!keys.openai);
      } catch (error) {
        console.error('Failed to check API keys:', error);
      }
    };
    
    checkApiKeys();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Add effect to clean up message cache when chats change
  useEffect(() => {
    if (Object.keys(messageCache).length > MAX_CACHED_CHATS) {
      // Get the most recent chat IDs
      const recentChatIds = chats.slice(0, MAX_CACHED_CHATS).map(chat => chat.id);
      
      // Create new cache with only recent chats
      const newCache: Record<string, Message[]> = {};
      recentChatIds.forEach(id => {
        if (messageCache[id]) {
          newCache[id] = messageCache[id];
        }
      });
      
      setMessageCache(newCache);
    }
  }, [chats, messageCache]);

  const handleSelectChat = async (id: string) => {
    setCurrentChatId(id);
    
    // Load messages if not in cache
    if (!messageCache[id]) {
      try {
        const messages = await getMessages(id);
        setMessageCache(prev => {
          const newCache = { ...prev, [id]: messages };
          // If cache is too large, remove oldest entries
          const cacheIds = Object.keys(newCache);
          if (cacheIds.length > MAX_CACHED_CHATS) {
            const recentChatIds = chats.slice(0, MAX_CACHED_CHATS).map(chat => chat.id);
            return Object.fromEntries(
              Object.entries(newCache).filter(([id]) => recentChatIds.includes(id))
            );
          }
          return newCache;
        });
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    }
  };

  const handleNewChat = async () => {
    try {
      const newChat = await createChat('New Chat');
      setChats(prev => [newChat, ...prev]);
      setCurrentChatId(newChat.id);
      setMessageCache(prev => ({ ...prev, [newChat.id]: [] }));
    } catch (error) {
      console.error('Failed to create new chat:', error);
    }
  };

  const handleSaveSettings = async (anthropicKey: string, openAiKey: string) => {
    try {
      if (anthropicKey) {
        await invoke('save_api_key', { keyType: 'anthropic', keyValue: anthropicKey });
        setHasAnthropicKey(true);
      }
      if (openAiKey) {
        await invoke('save_api_key', { keyType: 'openai', keyValue: openAiKey });
        setHasOpenAiKey(true);
      }
    } catch (error) {
      console.error('Failed to save API keys:', error);
    }
  };

  const renderMainView = () => {
    switch (selectedTool) {
      case 'chat':
        const WINDOW_SIZE = 3; // Keep 3 chats rendered at a time
        const currentIndex = chats.findIndex(chat => chat.id === currentChatId);
        const start = Math.max(0, currentIndex - Math.floor(WINDOW_SIZE / 2));
        const visibleChats = chats.slice(start, start + WINDOW_SIZE);
        
        return (
          <>
            <Sidebar
              chats={chats}
              onNewChat={handleNewChat}
              onSelectChat={handleSelectChat}
              selectedChatId={currentChatId ?? undefined}
            />
            <div className="chat-views-container">
              {visibleChats.map(chat => (
                <div 
                  key={chat.id}
                  style={{ 
                    display: currentChatId === chat.id ? 'flex' : 'none',
                    width: '100%',
                    height: '100%'
                  }}
                >
                  <ChatView
                    currentChatId={chat.id}
                    initialMessages={messageCache[chat.id]}
                    onChatCreated={(chat) => {
                      setChats(prev => [chat, ...prev]);
                      setCurrentChatId(chat.id);
                    }}
                    onChatTitleUpdated={(chatId, title) => {
                      setChats(prev => prev.map(c =>
                        c.id === chatId ? { ...c, title } : c
                      ));
                    }}
                    onMessagesUpdated={(chatId, messages) => {
                      setMessageCache(prev => ({ ...prev, [chatId]: messages }));
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        );
      case 'tools':
        return <ToolsView />;
      case 'settings':
        return (
          <SettingsView 
            onSave={handleSaveSettings}
            hasAnthropicKey={hasAnthropicKey}
            hasOpenAiKey={hasOpenAiKey}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      <ToolSidebar
        selectedTool={selectedTool}
        onSelectTool={setSelectedTool}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
      />
      {renderMainView()}
    </div>
  );
}

export default App;
