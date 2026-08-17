import type { Settings } from '@prisma/client';

export type { Settings };

export interface LlmProviderConfig {
  llmKey: string;
  llmModel: string;
  provider: 'openai' | 'google';
  llmBaseUrl: string;
}

export type DocumentType = 'PDF' | 'DOCX' | 'XLSX';
