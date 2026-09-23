import type { Settings } from '@prisma/client';

export type { Settings };

export interface LlmProviderConfig {
  llmKey: string;
  llmModel: string;
  provider: 'openai' | 'google';
  llmBaseUrl: string;
}

export type DocumentType = 'PDF' | 'PPTX' | 'DOCX' | 'XLSX';

/** Folha usada pelo fluxo paginado: A4 retrato/paisagem (PDF) ou slide 16:9 (PPTX). */
export type PageFormat = 'A4' | 'A4L' | 'SLIDE';

/**
 * literal: só organizar o material enviado (ex: "coloque essas imagens num PDF").
 * criativo: criar o documento com conteúdo. auto: o XGEN decide pelo pedido.
 */
export type GenerationMode = 'auto' | 'literal' | 'criativo';

/** Nível de elaboração pedido pelo usuário (perguntado pelo chat antes de gerar). */
export type DetailLevel = 'simples' | 'avancado';

/**
 * De onde vêm as imagens do documento:
 * nenhuma  → sem imagens (tipografia e gráficos);
 * enviadas → só as que o usuário anexou;
 * banco    → fotos reais buscadas no Pexels;
 * ia       → imagens geradas por IA (OpenRouter/Gemini/ComfyUI).
 * As anexadas pelo usuário entram SEMPRE; banco/ia só acrescentam.
 */
export type ImageSource = 'nenhuma' | 'enviadas' | 'banco' | 'ia';

/** Preferências do documento vindas da conversa com o usuário. */
export interface GenerationBrief {
  detailLevel: DetailLevel | null;
  imageSource: ImageSource | null;
  extraImages: number;
}

/** Imagem enviada pelo usuário, já normalizada e salva em disco. */
export interface ImageAsset {
  id: string;        // 'img-1', 'img-2'... na ordem em que o usuário enviou
  hash: string;      // sha1 do conteúdo normalizado (dedup de jobs)
  file: string;      // caminho absoluto no disco
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  hasAlpha: boolean;
  dominant: string;  // cor dominante em hex, calculada pelo sharp
}

export type ImageKind = 'foto' | 'logo' | 'print' | 'grafico' | 'ilustracao' | 'textura';
export type ImageRole = 'background' | 'hero' | 'inline' | 'logo';

/** Retângulo em % da imagem (0-100): onde ela já tem logo/texto desenhado. */
export interface ImageZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** O que o XGEN entendeu de cada imagem (visão + metadados). */
export interface ImageInsight extends ImageAsset {
  description: string;
  kind: ImageKind;
  suggestedRole: ImageRole;
  focalX: number; // 0..100 (%), usado no object-position quando a imagem é cortada
  focalY: number;
  colors: string[];
  hasText: boolean;
  /** Áreas ocupadas por logo/texto/blocos — o conteúdo por cima deve evitá-las. */
  zones: ImageZone[];
}
