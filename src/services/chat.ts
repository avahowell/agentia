import { invoke } from '@tauri-apps/api/core';

export interface FileAttachment {
  name: string;
  type: string;
  content: string; // Base64 encoded content
  size: number;
}

export interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  content: string;
  role: string;
  created_at: string;
  attachments?: FileAttachment[];
}

export async function createChat(title: string): Promise<Chat> {
  return invoke('create_chat', { title });
}

export async function addMessage(
  chatId: string,
  content: string,
  role: string,
  files?: File[] | { content: string; type: string; name?: string; size?: number }[]
): Promise<Message> {
  let attachments: FileAttachment[] | undefined;
  
  if (files && files.length > 0) {
    attachments = await Promise.all(files.map(async (file) => {
      if ('content' in file) {
        // Handle pre-processed attachment
        return {
          name: file.name || 'attachment',
          type: file.type,
          content: file.content,
          size: file.size || file.content.length * 0.75 // Estimate size from base64 length
        };
      } else {
        // Handle File object
        const buffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        return {
          name: file.name,
          type: file.type,
          content: base64,
          size: file.size
        };
      }
    }));
  }

  return invoke('add_message', {
    chatId,
    content,
    role,
    attachments
  });
}

export async function getChats(): Promise<Chat[]> {
  return invoke('get_chats');
}

export async function getMessages(chatId: string): Promise<Message[]> {
  return invoke('get_messages', { chatId });
}

export async function saveApiKey(keyType: 'anthropic' | 'openai', keyValue: string): Promise<void> {
  await invoke('save_api_key', { keyType, keyValue });
}

export async function getApiKeys(): Promise<{ anthropic?: string; openai?: string }> {
  const keys = await invoke<Record<string, string>>('get_api_keys');
  return {
    anthropic: keys['anthropic'],
    openai: keys['openai']
  };
}

export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  return invoke('update_chat_title', { chatId, title });
} 