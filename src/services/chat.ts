import { invoke } from '@tauri-apps/api/core';

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
}

export async function createChat(title: string): Promise<Chat> {
  return invoke('create_chat', { title });
}

export async function addMessage(
  chatId: string,
  content: string,
  role: string
): Promise<Message> {
  return invoke('add_message', {
    chatId,
    content,
    role,
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