import React, { useState, useEffect } from 'react';
import { runNpxMcpServer, ModelToolHandle } from '../services/tools';
import { useModelTools } from '../contexts/ModelToolsContext';

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
      const handle = await runNpxMcpServer(tool.command!, {});
      modelTools.addTool(tool.id, handle);
      setTools(tools => tools.map(t => 
        t.id === tool.id ? { ...t, enabled: true, handle } : t
      ));
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
          >
            <div className="tool-icon">{tool.icon}</div>
            <span className="tool-name">{tool.name}</span>
            <div className={`tool-status ${tool.enabled ? 'enabled' : ''}`}>
              <div className="tool-status-indicator" />
            </div>
          </button>
        ))}
      </div>

      {tools.find(t => t.id === 'filesystem')?.enabled && (
        <div className="filesystem-config">
          <label htmlFor="filesystem-path">Filesystem Directory</label>
          <input
            id="filesystem-path"
            type="text"
            value={filesystemPath}
            onChange={(e) => setFilesystemPath(e.target.value)}
            placeholder="Enter directory path"
          />
        </div>
      )}
    </div>
  );
} 