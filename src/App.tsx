import { useState, useEffect } from "react";
import "./App.css";
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { Chat, Message, createChat, addMessage, getChats, getMessages, updateChatTitle } from './services/chat';
import { streamAssistantResponse, clearChatContext, initializeChatContext, getSummaryTitle } from './services/ai';

function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const [showSettings, setShowSettings] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const handleSendMessage = async (content: string) => {
    try {
      let chatId = currentChatId;
      
      // If no chat is selected, create a new one
      if (!chatId) {
        const newChat = await createChat('...');
        chatId = newChat.id;
        setChats(prev => [newChat, ...prev]);
        setCurrentChatId(chatId);
      }

      // Get chat from state to check if it needs a title
      const chat = chats.find(c => c.id === chatId);
      const needsTitle = !chat || chat.title === '...' || chat.title === 'New Chat';

      // Generate title if needed
      if (needsTitle) {
        try {
          const title = await getSummaryTitle(content);
          await updateChatTitle(chatId, title);
          setChats(prev => prev.map(c => 
            c.id === chatId ? { ...c, title } : c
          ));
        } catch (error) {
          console.error('Failed to generate chat title:', error);
        }
      }

      // Add user message
      const userMessage = await addMessage(chatId, content, 'user');
      setMessages(prev => [...prev, userMessage]);

      // Create a placeholder for the assistant's message
      const assistantMessageId = crypto.randomUUID();
      const placeholderMessage: Message = {
        id: assistantMessageId,
        chat_id: chatId,
        content: '',
        role: 'assistant',
        created_at: new Date().toISOString(),
      };
      
      setMessages(prev => [...prev, placeholderMessage]);

      try {
        // Stream the assistant's response
        let fullResponse = '';
        for await (const chunk of streamAssistantResponse(chatId, content)) {
          fullResponse += chunk;
          setMessages(prev => 
            prev.map(msg => 
              msg.id === assistantMessageId
                ? { ...msg, content: fullResponse }
                : msg
            )
          );
        }

        // Save the complete response to the database
        const savedMessage = await addMessage(chatId, fullResponse, 'assistant');
        setMessages(prev => 
          prev.map(msg => 
            msg.id === assistantMessageId ? savedMessage : msg
          )
        );
      } catch (error) {
        console.error('Failed to get AI response:', error);
        // Remove the placeholder message if there was an error
        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleSelectChat = async (id: string) => {
    setCurrentChatId(id);
    try {
      const chatMessages = await getMessages(id);
      setMessages(chatMessages);
      // Initialize the chat context with existing messages
      initializeChatContext(id, chatMessages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const handleNewChat = async () => {
    try {
      const newChat = await createChat('New Chat');
      setChats(prev => [newChat, ...prev]);
      setCurrentChatId(newChat.id);
      setMessages([]);
      // Initialize an empty context for the new chat
      initializeChatContext(newChat.id, []);
    } catch (error) {
      console.error('Failed to create new chat:', error);
    }
  };

  return (
    <div className="app-container">
      <Sidebar
        chats={chats}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onOpenSettings={() => setShowSettings(true)}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
        selectedChatId={currentChatId ?? undefined}
      />

      <ChatView
        messages={messages}
        onSendMessage={handleSendMessage}
      />

      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}

export default App;
