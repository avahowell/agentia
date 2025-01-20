import { useEffect, useState } from 'react';
import { saveApiKey, getApiKeys } from '../services/chat';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openAIKey, setOpenAIKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Load saved API keys when the modal opens
    if (isOpen) {
      loadApiKeys();
    }
  }, [isOpen]);

  const loadApiKeys = async () => {
    try {
      const keys = await getApiKeys();
      if (keys.anthropic) setAnthropicKey(keys.anthropic);
      if (keys.openai) setOpenAIKey(keys.openai);
    } catch (error) {
      console.error('Failed to load API keys:', error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (anthropicKey) {
        await saveApiKey('anthropic', anthropicKey);
      }
      if (openAIKey) {
        await saveApiKey('openai', openAIKey);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save API keys:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-settings" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="settings-content">
          <div className="setting-item">
            <label htmlFor="anthropic-key">Anthropic API Key</label>
            <input
              id="anthropic-key"
              type="password"
              value={anthropicKey}
              onChange={e => setAnthropicKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <div className="setting-item">
            <label htmlFor="openai-key">OpenAI API Key</label>
            <input
              id="openai-key"
              type="password"
              value={openAIKey}
              onChange={e => setOpenAIKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <button 
            className="new-chat-button" 
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
} 