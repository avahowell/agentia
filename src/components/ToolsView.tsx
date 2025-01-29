import React, { useState, useEffect } from 'react';
import { runNpxMcpServer, ModelToolHandle } from '../services/tools';
import { useModelTools } from '../contexts/ModelToolsContext';
import { open } from '@tauri-apps/plugin-dialog';

interface Tool {
  id: string;
  name: string;
  icon: JSX.Element;
  enabled: boolean;
  command?: string;
  handle?: ModelToolHandle;
}

export function ToolsView() {
  const modelTools = useModelTools();

  // Initialize tools with enabled state from context
  const [tools, setTools] = useState<Tool[]>(() => {
    const baseTools = [
      {
        id: 'memory',
        name: 'Memory',
        command: 'npx -y @modelcontextprotocol/server-memory',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('memory')
      },
      {
        id: 'filesystem',
        name: 'Filesystem',
        command: 'npx -y @modelcontextprotocol/server-filesystem',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h18v18H3z" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('filesystem')
      },
      {
        id: 'database',
        name: 'Database',
        command: 'npx -y @modelcontextprotocol/server-database',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('database')
      },
      {
        id: 'web',
        name: 'Web Browsing',
        command: 'npx -y @modelcontextprotocol/server-web',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('web')
      },
      {
        id: 'search',
        name: 'Search',
        command: 'npx -y @modelcontextprotocol/server-search',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('search')
      },
      {
        id: 'code',
        name: 'Code Interpreter',
        command: 'npx -y @modelcontextprotocol/server-code',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('code')
      },
      {
        id: 'scheduler',
        name: 'Scheduler',
        command: 'npx -y @modelcontextprotocol/server-scheduler',
        icon: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ),
        enabled: modelTools.isToolEnabled('scheduler')
      }
    ];

    // For any enabled tools, we need to track their handles
    return baseTools.map(tool => ({
      ...tool,
      enabled: modelTools.isToolEnabled(tool.id)
    }));
  });

  // Keep tools in sync with context
  useEffect(() => {
    setTools(tools => tools.map(tool => ({
      ...tool,
      enabled: modelTools.isToolEnabled(tool.id)
    })));
  }, [modelTools]);

  const handleToolEnable = async (tool: Tool) => {
    try {
      // Special handling for filesystem tool
      if (tool.id === 'filesystem') {
        if (!filesystemPath.trim()) {
          alert('Please enter a filesystem directory path first');
          return;
        }
        const command = `${tool.command} ${filesystemPath}`;
        const handle = await runNpxMcpServer(command, {});
        modelTools.addTool(tool.id, handle);
        setTools(tools => tools.map(t => 
          t.id === tool.id ? { ...t, enabled: true, handle } : t
        ));
      } else {
        const handle = await runNpxMcpServer(tool.command!, {});
        modelTools.addTool(tool.id, handle);
        setTools(tools => tools.map(t => 
          t.id === tool.id ? { ...t, enabled: true, handle } : t
        ));
      }
    } catch (error) {
      console.error(`Failed to enable tool ${tool.id}:`, error);
    }
  };

  const handleToolDisable = async (tool: Tool) => {
    try {
      modelTools.removeTool(tool.id);
      setTools(tools => tools.map(t =>
        t.id === tool.id ? { ...t, enabled: false, handle: undefined } : t
      ));
    } catch (error) {
      console.error(`Failed to disable tool ${tool.id}:`, error);
    }
  };

  const [filesystemPath, setFilesystemPath] = useState('');

  const handleDirectorySelect = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Directory for Filesystem Access'
      });
      
      if (selected && typeof selected === 'string') {
        setFilesystemPath(selected);
      }
    } catch (error) {
      console.error('Failed to open directory picker:', error);
      if (error instanceof Error && error.message !== 'User cancelled the selection') {
        alert('Failed to open directory picker. Please try again.');
      }
    }
  };

  const toggleTool = async (tool: Tool) => {
    if (!tool.enabled) {
      await handleToolEnable(tool);
    } else {
      await handleToolDisable(tool);
    }
  };

  return (
    <div className="tools-view">
      <h2>Tool Configuration</h2>
      <div className="tools-grid">
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`tool-config-button ${tool.enabled ? 'enabled' : ''}`}
            onClick={() => toggleTool(tool)}
            disabled={tool.id === 'filesystem' && !tool.enabled && !filesystemPath.trim()}
          >
            <div className="tool-icon">{tool.icon}</div>
            <span className="tool-name">{tool.name}</span>
            <div className={`tool-status ${tool.enabled ? 'enabled' : ''}`}>
              <div className="tool-status-indicator" />
            </div>
          </button>
        ))}
      </div>

      <div className="filesystem-config" style={{ marginBottom: '1rem', maxWidth: '600px' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            Select a directory that the AI assistant will be allowed to access. For security, the assistant will only be able to read and write files within this directory.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            id="filesystem-path"
            type="text"
            value={filesystemPath}
            readOnly
            placeholder="No directory selected"
            style={{ flex: 1 }}
          />
          <button 
            onClick={handleDirectorySelect}
            style={{
              padding: '0.5rem 1rem',
              whiteSpace: 'nowrap',
              backgroundColor: 'var(--color-background-light)',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Choose Directory
          </button>
        </div>
      </div>
    </div>
  );
} 