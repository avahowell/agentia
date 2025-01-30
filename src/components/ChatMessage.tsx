import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { FileAttachment } from '../services/chat';
import { openUrl } from '@tauri-apps/plugin-opener';

interface ChatMessageProps {
  content: string;
  role: string;
  timestamp: Date;
  isTyping?: boolean;
  attachments?: FileAttachment[];
}

interface ToolUseData {
  type: 'executing';
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'running' | 'complete' | 'error';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  const mb = kb / 1024;
  if (mb < 1024) return mb.toFixed(1) + ' MB';
  const gb = mb / 1024;
  return gb.toFixed(1) + ' GB';
}

function FileAttachmentView({ attachment }: { attachment: FileAttachment }) {
  const isImage = attachment.type.startsWith('image/');

  if (isImage) {
    return (
      <div className="image-attachment">
        <img 
          src={`data:${attachment.type};base64,${attachment.content}`}
          alt={attachment.name}
          className="message-image"
          loading="lazy"
        />
      </div>
    );
  }

  const handleDownload = () => {
    const blob = new Blob([Uint8Array.from(atob(attachment.content), c => c.charCodeAt(0))], { type: attachment.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="file-attachment" onClick={handleDownload}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline>
      </svg>
      <span className="file-name">{attachment.name}</span>
      <span className="file-size">({formatFileSize(attachment.size)})</span>
    </div>
  );
}

function ToolUseBlock({ data }: { data: ToolUseData }) {
  const getTitle = () => {
    switch (data.status) {
      case 'running':
        return `Executing Tool: ${data.name}...`;
      case 'complete':
        return `Tool Execution Complete: ${data.name}`;
      case 'error':
        return `Tool Execution Failed: ${data.name}`;
    }
  };

  return (
    <details className="tool-use-block" open={data.status === 'error'}>
      <summary className={`tool-use-summary status-${data.status}`}>
        {getTitle()}
      </summary>
      <div className="tool-use-content">
        {data.args && (
          <pre className="tool-use-args">
            <code>Arguments: {JSON.stringify(data.args, null, 2)}</code>
          </pre>
        )}
        {data.status === 'complete' && data.result && (
          <pre className="tool-use-result">
            <code>Result: {String(typeof data.result === 'object' ? JSON.stringify(data.result, null, 2) : data.result)}</code>
          </pre>
        )}
        {data.status === 'error' && data.error && (
          <pre className="tool-use-error">
            <code>{data.error}</code>
          </pre>
        )}
      </div>
    </details>
  );
}

function ChatMessageComponent({ content, role, timestamp, isTyping, attachments }: ChatMessageProps) {
  const components: Components = {
    code({ className, children, node, ...props }) {
      const isInline = node?.position?.start.line === node?.position?.end.line;
      return (
        <code
          className={`${className} ${isInline ? 'inline-code' : 'code-block'}`}
          {...props}
        >
          {children}
        </code>
      );
    },
    a(props) {
      const { href, children } = props;
      return (
        <a
          {...props}
          onClick={async (e) => {
            e.preventDefault();
            if (href) {
              try {
                await openUrl(href);
              } catch (error) {
                console.error('Failed to open link:', error);
              }
            }
          }}
        >
          {children}
        </a>
      );
    }
  };

  // Split content by tool use markers and render appropriately
  const renderContent = () => {
    if (!content) return null;
    
    const parts = content.split(/(%%%tool_use_start%%%.*?%%%tool_use_end%%%)/s);
    return parts.map((part, index) => {
      if (part.startsWith('%%%tool_use_start%%%')) {
        const jsonStr = part.replace('%%%tool_use_start%%%', '').replace('%%%tool_use_end%%%', '');
        try {
          const data = JSON.parse(jsonStr);
          return <ToolUseBlock key={index} data={data} />;
        } catch (e) {
          return part;
        }
      }
      return role === 'assistant' ? (
        <ReactMarkdown 
          key={index}
          remarkPlugins={[remarkGfm]}
          components={components}
        >
          {part}
        </ReactMarkdown>
      ) : part;
    });
  };

  return (
    <div className={`chat-message ${role}`}>
      <div className="message-content">
        <div className={`message-bubble ${isTyping ? 'typing' : ''}`}>
          {isTyping ? null : (
            <>
              {role === 'assistant' ? (
                renderContent()
              ) : (
                <>
                  {attachments && attachments.length > 0 && (
                    <div className="attachments">
                      {attachments.map((attachment, index) => (
                        <FileAttachmentView key={index} attachment={attachment} />
                      ))}
                    </div>
                  )}
                  {content}
                </>
              )}
            </>
          )}
        </div>
        <div className="message-timestamp">
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

export const ChatMessage = React.memo(ChatMessageComponent, (prevProps, nextProps) => {
  return prevProps.content === nextProps.content &&
         prevProps.role === nextProps.role &&
         prevProps.isTyping === nextProps.isTyping &&
         prevProps.timestamp.getTime() === nextProps.timestamp.getTime() &&
         JSON.stringify(prevProps.attachments) === JSON.stringify(nextProps.attachments);
}); 