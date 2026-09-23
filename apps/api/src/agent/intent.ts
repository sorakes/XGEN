import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ask, extractJsonObject } from './llm';
import type { GenerationMode } from '../types';

/** Como montar um documento literal (só com o material enviado). */
export interface LiteralLayout {
  imagesPerPage: number;   // 1 a 4
  title: string | null;    // título pedido explicitamente pelo usuário
  captions: boolean;       // legenda descrevendo cada imagem
}

export interface RequestIntent {
  mode: 'literal' | 'criativo';
  layout: LiteralLayout;
  reason: string;
}

const DEFAULT_LAYOUT: LiteralLayout = { imagesPerPage: 1, title: null, captions: false };

const INTENT_SYSTEM = "Você classifica pedidos de geração de documentos. Responde SOMENTE com JSON válido.";

/**
 * Decide se o pedido é LITERAL (organizar o material que o usuário mandou)
 * ou CRIATIVO (produzir um documento com conteúdo). Errar para o literal é
 * o erro mais barato: o usuário pede "mais elaborado" e resolve. O contrário
 * — entregar 4 páginas de texto inventado para quem só queria as imagens
 * num PDF — é o que irrita.
 *
 * O `requested` vem da LLM do chat (que viu a conversa inteira) e, quando
 * explícito, manda no modo; a classificação aqui só extrai o layout.
 */
export async function resolveIntent(
  model: BaseChatModel,
  instructions: string,
  imageCount: number,
  requested: GenerationMode
): Promise<RequestIntent> {
  // Sem imagens não há material para "só organizar": é sempre criativo.
  if (imageCount === 0) {
    return { mode: 'criativo', layout: DEFAULT_LAYOUT, reason: 'sem imagens' };
  }
  if (requested === 'criativo') {
    return { mode: 'criativo', layout: DEFAULT_LAYOUT, reason: 'modo pedido pelo chat' };
  }

  const prompt = `O usuário anexou ${imageCount} imagem(ns) e fez este pedido:
"""
${instructions}
"""

Classifique:
- "literal": ele só quer ORGANIZAR o material enviado num arquivo (juntar imagens num PDF/PPT, uma por página,
  em grade, com um título ou legenda que ELE pediu). Não há um assunto para você desenvolver.
  Exemplos: "coloque essas imagens em um pdf", "junta essas fotos num ppt", "faz um pdf com essas 3 imagens, 2 por página".
- "criativo": ele pede um DOCUMENTO COM CONTEÚDO — um relatório, uma apresentação sobre um tema, um template,
  um manual, um catálogo com textos — e as imagens são insumo para isso.
  Exemplos: "faça uma apresentação da empresa usando esses fundos", "gere um template seguindo essa identidade visual",
  "relatório sobre as vendas com esses gráficos".
Na DÚVIDA, escolha "literal".

Se for literal, extraia também o layout que ele pediu (padrões entre parênteses):
- imagesPerPage: quantas imagens por página (1)
- title: título que ELE pediu explicitamente, com o texto exato, ou null (null)
- captions: true só se ele pediu legenda/descrição nas imagens (false)

Responda SOMENTE com: {"mode":"literal","imagesPerPage":1,"title":null,"captions":false,"reason":"frase curta"}`;

  try {
    const parsed = extractJsonObject<any>(await ask(model, INTENT_SYSTEM, prompt));
    const layout: LiteralLayout = {
      imagesPerPage: Math.min(4, Math.max(1, Math.round(Number(parsed.imagesPerPage) || 1))),
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 140) : null,
      captions: parsed.captions === true,
    };
    const mode = requested === 'literal' ? 'literal' : parsed.mode === 'criativo' ? 'criativo' : 'literal';
    return { mode, layout, reason: String(parsed.reason || '').slice(0, 200) };
  } catch (error: any) {
    // Sem classificação: pedido curto com imagens tende a ser só "monte isso".
    const mode = requested === 'literal' || instructions.length < 140 ? 'literal' : 'criativo';
    console.warn(`[Intent] Falha ao classificar (${error.message}); usando ${mode}.`);
    return { mode, layout: DEFAULT_LAYOUT, reason: 'heurística (classificação falhou)' };
  }
}
