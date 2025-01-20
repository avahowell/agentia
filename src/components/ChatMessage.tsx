import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface ChatMessageProps {
  content: string;
  role: string;
  timestamp: Date;
  isTyping?: boolean;
}

export function ChatMessage({ content, role, timestamp, isTyping }: ChatMessageProps) {
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
  };

  return (
    <div className={`chat-message ${role}`}>
      <div className="message-content">
        <div className={`message-bubble ${isTyping ? 'typing' : ''}`}>
          {isTyping ? null : (
            role === 'assistant' ? (
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={components}
              >
                {content}
              </ReactMarkdown>
            ) : (
              content
            )
          )}
        </div>
        <div className="message-timestamp">
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
} 