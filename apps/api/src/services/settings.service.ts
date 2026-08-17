import { prisma } from '../lib/prisma';
import type { Settings, LlmProviderConfig } from '../types';

export async function getOrCreateSettings(): Promise<Settings> {
  let settings = await prisma.settings.findFirst();
  if (!settings) settings = await prisma.settings.create({ data: { max_retries: 3 } });
  return settings;
}

export async function updateSettings(payload: Record<string, any>): Promise<Settings> {
  delete payload.id;
  delete payload.updatedAt;
  delete payload.createdAt;

  const existing = await prisma.settings.findFirst();
  if (existing) {
    return prisma.settings.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.settings.create({ data: payload });
}

export function resolveLlmProvider(settings: Settings): LlmProviderConfig {
  if (settings.active_llm === 'openai' && settings.openai_key) {
    return {
      llmKey: settings.openai_key,
      llmModel: settings.openai_model || 'gpt-4o',
      provider: 'openai',
      llmBaseUrl: settings.openai_base_url || 'https://api.openai.com/v1',
    };
  }
  if (settings.active_llm === 'openrouter' && settings.openrouter_key) {
    return {
      llmKey: settings.openrouter_key,
      llmModel: settings.openrouter_model || 'openai/gpt-4o',
      provider: 'openai',
      llmBaseUrl: 'https://openrouter.ai/api/v1',
    };
  }
  if (settings.active_llm === 'google' && settings.google_key) {
    return {
      llmKey: settings.google_key,
      llmModel: settings.google_model || 'gemini-2.0-flash',
      provider: 'google',
      llmBaseUrl: '',
    };
  }
  if (settings.active_llm === 'ollama') {
    return {
      llmKey: 'ollama',
      llmModel: settings.ollama_model || 'llama3',
      provider: 'openai',
      llmBaseUrl: settings.ollama_url || 'http://localhost:11434/v1',
    };
  }
  throw new Error("⚠️ A chave do provedor LLM ativo não está configurada.");
}
