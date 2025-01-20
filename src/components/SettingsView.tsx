import React from 'react';

interface SettingsViewProps {
  onSave: (anthropicKey: string, openAiKey: string) => void;
  hasAnthropicKey?: boolean;
  hasOpenAiKey?: boolean;
}

export function SettingsView({ onSave, hasAnthropicKey, hasOpenAiKey }: SettingsViewProps) {
  const [anthropicKey, setAnthropicKey] = React.useState('');
  const [openAiKey, setOpenAiKey] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(anthropicKey, openAiKey);
  };

  return (
    <div className="settings-view">
      <h2>Settings</h2>
      <form onSubmit={handleSubmit} className="settings-content">
        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="anthropic-key">Anthropic API Key</label>
            {hasAnthropicKey && (
              <svg className="key-status" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <input
            id="anthropic-key"
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder={hasAnthropicKey ? "API key configured" : "Enter your Anthropic API key"}
          />
        </div>

        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="openai-key">OpenAI API Key</label>
            {hasOpenAiKey && (
              <svg className="key-status" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <input
            id="openai-key"
            type="password"
            value={openAiKey}
            onChange={(e) => setOpenAiKey(e.target.value)}
            placeholder={hasOpenAiKey ? "API key configured" : "Enter your OpenAI API key"}
          />
        </div>

        <button type="submit" className="save-settings-button">
          Save Settings
        </button>
      </form>
    </div>
  );
} 