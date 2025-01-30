import React from 'react';

interface SettingsViewProps {
  onSave: (anthropicKey: string, openAiKey: string, exaKey: string) => void;
  hasAnthropicKey?: boolean;
  hasOpenAiKey?: boolean;
  hasExaKey?: boolean;
}

export function SettingsView({ onSave, hasAnthropicKey, hasOpenAiKey, hasExaKey }: SettingsViewProps) {
  const [anthropicKey, setAnthropicKey] = React.useState('');
  const [openAiKey, setOpenAiKey] = React.useState('');
  const [exaKey, setExaKey] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(anthropicKey, openAiKey, exaKey);
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

        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="exa-key">Exa API Key</label>
            {hasExaKey && (
              <svg className="key-status" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <input
            id="exa-key"
            type="password"
            value={exaKey}
            onChange={(e) => setExaKey(e.target.value)}
            placeholder={hasExaKey ? "API key configured" : "Enter your Exa API key"}
          />
        </div>

        <button type="submit" className="save-settings-button">
          Save Settings
        </button>
      </form>
    </div>
  );
} 