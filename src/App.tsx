import { useState, useEffect } from "react";
import "./App.css";
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ToolSidebar } from './components/ToolSidebar';
import { SettingsView } from './components/SettingsView';
import { ToolsView } from './components/ToolsView';
import { Chat, createChat, getChats } from './services/chat';
import { ModelToolsProvider } from './contexts/ModelToolsContext';

function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
  const [selectedTool, setSelectedTool] = useState('chat');
  const [showSettings, setShowSettings] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);

  // Load chats on mount
  useEffect(() => {
    const loadChats = async () => {
      try {
        const loadedChats = await getChats();
        setChats(loadedChats);
      } catch (error) {
        console.error('Failed to load chats:', error);
      }
    };
    
    loadChats();
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

  const handleSelectChat = (id: string) => {
    setCurrentChatId(id);
  };

  const handleNewChat = async () => {
    try {
      const newChat = await createChat('New Chat');
      setChats(prev => [newChat, ...prev]);
      setCurrentChatId(newChat.id);
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
              onChatCreated={(chat) => {
                setChats(prev => [chat, ...prev]);
                setCurrentChatId(chat.id);
              }}
              onChatTitleUpdated={(chatId, title) => {
                setChats(prev => prev.map(c =>
                  c.id === chatId ? { ...c, title } : c
                ));
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
