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
import { ModelToolsProvider } from './contexts/ModelToolsContext';

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
        
        // Don't preload any messages - we'll load them on-demand when chats are selected
        setMessageCache({});
      } catch (error) {
        console.error('Failed to load chats:', error);
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
      // Get the chat IDs in order of most recently used
      const recentChatIds = [
        currentChatId, // Keep current chat's messages
        ...chats
          .filter(chat => chat.id !== currentChatId)
          .map(chat => chat.id)
      ].filter(Boolean) as string[];
      
      // Create new cache with only recent chats
      const newCache: Record<string, Message[]> = {};
      recentChatIds.slice(0, MAX_CACHED_CHATS).forEach(id => {
        if (messageCache[id]) {
          newCache[id] = messageCache[id];
        }
      });
      
      setMessageCache(newCache);
    }
  }, [chats, messageCache, currentChatId]);

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
        return (
          <>
            <Sidebar
              chats={chats}
              onNewChat={handleNewChat}
              onSelectChat={handleSelectChat}
              selectedChatId={currentChatId ?? undefined}
            />
            <ChatView
              currentChatId={currentChatId}
              initialMessages={currentChatId ? messageCache[currentChatId] : undefined}
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
    <ModelToolsProvider>
      <div className="app-container">
        <ToolSidebar
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          isDark={isDark}
          onToggleTheme={() => setIsDark(!isDark)}
        />
        {renderMainView()}
      </div>
    </ModelToolsProvider>
  );
}

export default App;
