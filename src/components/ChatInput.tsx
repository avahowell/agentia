import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { ModelSelect } from './ModelSelect';

interface ChatInputProps {
  onSendMessage: (message: string, attachments?: { content: string; type: string }[]) => void;
  onModelChange?: (model: string) => void;
  isStreaming?: boolean;
  onStopInference?: () => void;
}

export interface ChatInputHandle {
  addFiles: (files: File[]) => Promise<void>;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({
  onSendMessage,
  onModelChange,
  isStreaming = false,
  onStopInference
}, ref) => {
  const [inputValue, setInputValue] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [processedFiles, setProcessedFiles] = useState<{ content: string; type: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
    console.log('Processing files:', files.length);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const results: { content: string; type: string }[] = [];
    
    for (const file of imageFiles) {
      try {
        console.log('Processing file:', file.name);
        const buffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        
        // Process the data in chunks to avoid call stack limits
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        
        const content = btoa(binary);
        results.push({
          content,
          type: file.type
        });
        console.log('Processed file:', file.name);
      } catch (error) {
        console.error('Error processing file:', file.name, error);
        throw error; // Re-throw to handle in the caller
      }
    }
    return results;
  };

  useImperativeHandle(ref, () => ({
    addFiles: async (files: File[]) => {
      console.log('Adding files:', files.length);
      try {
        const processed = await processFiles(files);
        console.log('Files processed:', processed.length);
        setSelectedFiles(prev => [...prev, ...files]);
        setProcessedFiles(prev => [...prev, ...processed]);
      } catch (error) {
        console.error('Error adding files:', error);
      }
    }
  }));

  const handleSend = () => {
    if (inputValue.trim() || processedFiles.length > 0) {
      onSendMessage(inputValue, processedFiles);
      setInputValue('');
      setSelectedFiles([]);
      setProcessedFiles([]);
      // Reset textarea height
      const textarea = document.querySelector('.message-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = '24px';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const processed = await processFiles(files);
    setSelectedFiles(prev => [...prev, ...files]);
    setProcessedFiles(prev => [...prev, ...processed]);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setProcessedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="input-container">
      {selectedFiles.length > 0 && (
        <div className="selected-files">
          {selectedFiles.map((file, index) => (
            <div key={index} className={`selected-file ${file.type.startsWith('image/') ? 'with-preview' : ''}`}>
              {file.type.startsWith('image/') ? (
                <>
                  <img 
                    src={URL.createObjectURL(file)} 
                    alt={file.name}
                    className="preview-image"
                    onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                  />
                  <button onClick={() => handleRemoveFile(index)} className="remove-file" title="Remove file">×</button>
                </>
              ) : (
                <>
                  <span>{file.name}</span>
                  <button onClick={() => handleRemoveFile(index)} className="remove-file">×</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="message-input-group" style={{ position: 'relative' }}>
        <ModelSelect onModelChange={onModelChange} />
        <textarea
          className="message-input"
          placeholder="Type a message..."
          rows={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            if (!target.value) {
              target.style.height = '24px';
            } else {
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }
          }}
        />
        <button
          className="attach-button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          multiple
        />
        <button 
          className="send-button"
          onClick={handleSend}
          disabled={!inputValue.trim() && processedFiles.length === 0}
        >
          <svg
            stroke="currentColor"
            fill="none"
            strokeWidth="2"
            viewBox="0 0 24 24"
            strokeLinecap="round"
            strokeLinejoin="round"
            height="1em"
            width="1em"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  );
}); 