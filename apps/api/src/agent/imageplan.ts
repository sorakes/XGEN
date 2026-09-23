import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ask, extractJsonObject } from './llm';
import type { ImageRequest } from '../services/imagegen.service';
import type { ImageInsight, ImageSource } from '../types';

const SYSTEM = "Você é um editor de fotografia. Responde SOMENTE com JSON válido.";

/**
 * Decide QUAIS imagens buscar/gerar para o documento: uma lista variada que
 * cubra os momentos principais do tema (capa, seções), sem repetir o que as
 * imagens do próprio usuário já mostram.
 */
export async function planImageRequests(
  model: BaseChatModel,
  instructions: string,
  count: number,
  source: ImageSource,
  userImages: ImageInsight[]
): Promise<ImageRequest[]> {
  if (count <= 0) return [];
  const already = userImages.length
    ? `\nO usuário JÁ enviou estas imagens (não repita o mesmo assunto):\n${userImages.map(i => `- ${i.description}`).join('\n')}\n`
    : '';
  const prompt = `Pedido do documento:
"""
${instructions}
"""
${already}
Escolha ${count} imagem(ns) para ilustrar esse documento, ${source === 'banco' ? 'que serão BUSCADAS num banco de fotos reais (Pexels)' : 'que serão GERADAS por IA'}.
Cubra assuntos diferentes e importantes do tema (a primeira deve servir de capa/abertura).

Para cada uma:
- query: 2 a 5 palavras EM INGLÊS para busca no banco de fotos (lugares, objetos, paisagens — termos concretos).
- prompt: descrição visual detalhada EM INGLÊS para gerar a imagem (assunto, cenário, luz, estilo). Sem texto na imagem.
- description: o que a imagem mostra, em português, uma frase.
- orientation: "landscape", "portrait" ou "square" (capa e fundos: landscape).
${source === 'banco' ? 'Evite pessoas identificáveis e eventos históricos específicos (bancos de fotos não têm). Prefira lugares, paisagens, arquitetura, objetos.' : 'Para temas históricos, peça ilustrações/pinturas de época em vez de "fotos" de eventos que não foram fotografados.'}

Responda SOMENTE com: {"images":[{"query":"...","prompt":"...","description":"...","orientation":"landscape"}]}`;

  try {
    const parsed = extractJsonObject<{ images: any[] }>(await ask(model, SYSTEM, prompt));
    return (parsed.images || [])
      .filter(i => i && (i.query || i.prompt))
      .slice(0, count)
      .map(i => ({
        query: String(i.query || i.description || '').slice(0, 80),
        prompt: String(i.prompt || i.query || '').slice(0, 800),
        description: String(i.description || i.query || '').slice(0, 200),
        orientation: ['landscape', 'portrait', 'square'].includes(i.orientation) ? i.orientation : 'landscape',
      }));
  } catch (error: any) {
    console.warn(`[ImagePlan] Falha ao planejar imagens (${error.message}).`);
    return [];
  }
}
