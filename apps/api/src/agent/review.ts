import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import sharp from 'sharp';
import { askWithImages, extractJsonObject } from './llm';
import { screenshotPages } from '../converters';
import type { DocumentPlan } from './planner';

export interface PageCritique {
  index: number;
  score: number;
  critique: string;
}

/** Abaixo desta nota (0-10) a página é redesenhada. */
const MIN_SCORE = 6;

const REVIEW_SYSTEM =
  "Você é um Diretor de Arte exigente revisando páginas renderizadas. Responde SOMENTE com JSON válido.";

/**
 * Crítica visual (inspirada na crítica em 5 dimensões do huashu-design):
 * a LLM de visão OLHA o render de cada página e dá nota. Só as páginas com
 * nota baixa voltam para o designer, com os pontos concretos a corrigir.
 *
 * É opcional (setting visual_review) porque custa uma chamada de visão a
 * mais e alguns segundos de screenshot.
 */
export async function reviewPagesVisually(
  model: BaseChatModel,
  html: string,
  plan: DocumentPlan
): Promise<PageCritique[]> {
  const shots = await screenshotPages(html, plan.format, 1, 'jpeg');
  const previews = await Promise.all(
    shots.map(async shot => {
      const small = await sharp(shot.image).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      return `data:image/jpeg;base64,${small.toString('base64')}`;
    })
  );

  const prompt = `Estas são as ${shots.length} ${plan.format === 'SLIDE' ? 'telas de uma apresentação' : 'páginas de um documento'} sobre "${plan.theme}", na ordem.

Avalie cada uma de 0 a 10 considerando:
1. Coerência com o design system do documento (${plan.designSystem.slice(0, 400)})
2. Hierarquia visual (dá para saber o que ler primeiro?)
3. Execução (alinhamentos, espaçamentos, texto legível sobre imagens, nada sobreposto ou cortado)
4. Uso das imagens (bem enquadradas, no tamanho certo, integradas ao layout)
5. Aparência profissional (sem cara de template genérico)

Seja criterioso mas justo: nota 7+ é uma página boa. Para notas abaixo de ${MIN_SCORE}, escreva em "critique"
até 3 correções CONCRETAS e acionáveis (ex: "o título se sobrepõe à foto no canto superior; mova o bloco de texto para a esquerda").

Responda SOMENTE com: {"pages":[{"n":1,"score":8,"critique":""}]}`;

  const raw = await askWithImages(model, REVIEW_SYSTEM, prompt, previews);
  const parsed = extractJsonObject<{ pages: any[] }>(raw);

  const critiques = (parsed.pages || [])
    .map((p: any) => ({ index: Number(p.n), score: Number(p.score), critique: String(p.critique || '').trim() }))
    .filter(c => c.index >= 1 && c.index <= shots.length && c.score < MIN_SCORE && c.critique);

  console.log(`[Review] Notas: ${(parsed.pages || []).map((p: any) => `p${p.n}=${p.score}`).join(' ')}`);
  return critiques;
}
