import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { askWithImages, extractJsonObject } from './llm';
import { assetPreviewDataUrl } from '../services/images.service';
import { fitsSheet } from './format';
import type { ImageAsset, ImageInsight, ImageKind, ImageRole, ImageZone, PageFormat } from '../types';

const VISION_SYSTEM =
  "Você é um Diretor de Arte analisando imagens enviadas por um cliente. Responde SOMENTE com JSON válido.";

const KINDS: ImageKind[] = ['foto', 'logo', 'print', 'grafico', 'ilustracao', 'textura'];
const ROLES: ImageRole[] = ['background', 'hero', 'inline', 'logo'];

/**
 * Olha as imagens UMA vez, antes do planejamento, e descreve cada uma:
 * o que mostra, que tipo de imagem é e onde ela funcionaria melhor.
 * O planner usa essa descrição para decidir em que página cada uma entra.
 *
 * Se o modelo não enxerga imagens (ou a visão está desligada), cai para
 * uma análise só por metadados — o documento sai mesmo assim.
 */
export async function describeImages(
  model: BaseChatModel,
  assets: ImageAsset[],
  instructions: string,
  visionEnabled: boolean
): Promise<ImageInsight[]> {
  if (assets.length === 0) return [];
  const fallback = assets.map(heuristicInsight);
  if (!visionEnabled) return fallback;

  const catalog = assets
    .map(a => `- ${a.id}: ${a.width}x${a.height}px (${orientation(a)}), ${a.hasAlpha ? 'com transparência' : 'sem transparência'}`)
    .join('\n');

  const prompt = `O cliente enviou ${assets.length} imagem(ns), anexadas NA ORDEM abaixo, para usar num documento.

PEDIDO DO CLIENTE:
"""
${instructions}
"""

IMAGENS (mesma ordem dos anexos):
${catalog}

Para CADA imagem, responda:
- description: o que a imagem mostra, em uma frase objetiva (pessoas, produto, lugar, texto visível...).
- kind: um de ${KINDS.join(' | ')}.
- suggestedRole: onde ela funciona melhor —
    "background" (foto/textura boa para cobrir uma página inteira com texto por cima),
    "hero" (imagem de destaque grande dentro do conteúdo),
    "inline" (ilustra um trecho, tamanho médio),
    "logo" (marca, pequena, nunca cortada).
  Se o PEDIDO disser onde a imagem vai (ex: "use a foto de fundo na capa"), siga o pedido.
- focalX, focalY: o ponto mais importante da imagem em % (0-100), para cortar sem perder o assunto.
- colors: até 4 cores marcantes em hex.
- hasText: true se a imagem contém texto importante (print, gráfico, cartaz) — essas NUNCA podem ser cortadas.
- zones: retângulos (em % da largura/altura da imagem, 0-100) onde a imagem JÁ TEM elementos desenhados que não
  podem ser cobertos por texto: logos, selos, textos, blocos sólidos. IGNORE linhas finas decorativas, molduras
  finas e o fundo liso. Seja justo com a margem (inclua o elemento inteiro). Lista vazia se não houver.

Responda SOMENTE com: {"images":[{"id":"img-1","description":"...","kind":"foto","suggestedRole":"background","focalX":50,"focalY":40,"colors":["#112233"],"hasText":false,"zones":[{"x":4,"y":8,"w":16,"h":28}]}]}`;

  try {
    const previews = await Promise.all(assets.map(a => assetPreviewDataUrl(a)));
    const raw = await askWithImages(model, VISION_SYSTEM, prompt, previews);
    const parsed = extractJsonObject<{ images: any[] }>(raw);
    const byId = new Map((parsed.images || []).map((item: any) => [String(item.id), item]));

    return fallback.map((base, i) => {
      const item = byId.get(base.id) ?? parsed.images?.[i];
      if (!item) return base;
      const kind = KINDS.includes(item.kind) ? item.kind : base.kind;
      const hasText = typeof item.hasText === 'boolean' ? item.hasText : base.hasText;
      return {
        ...base,
        description: String(item.description || base.description).slice(0, 300),
        kind,
        suggestedRole: ROLES.includes(item.suggestedRole) ? item.suggestedRole : base.suggestedRole,
        focalX: clampPercent(item.focalX, base.focalX),
        focalY: clampPercent(item.focalY, base.focalY),
        colors: Array.isArray(item.colors)
          ? item.colors.filter((c: any) => /^#[0-9a-f]{3,8}$/i.test(String(c))).slice(0, 4)
          : base.colors,
        hasText: hasText || kind === 'print' || kind === 'grafico',
        zones: parseZones(item.zones),
      };
    });
  } catch (error: any) {
    console.warn(`[Vision] Modelo não conseguiu analisar as imagens (${error.message}). Usando metadados.`);
    return fallback;
  }
}

function parseZones(raw: unknown): ImageZone[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((z: any) => ({
      x: clampPercent(z?.x, NaN),
      y: clampPercent(z?.y, NaN),
      w: clampPercent(z?.w, NaN),
      h: clampPercent(z?.h, NaN),
    }))
    .filter(z => [z.x, z.y, z.w, z.h].every(Number.isFinite) && z.w > 0 && z.h > 0 && z.w * z.h < 6000)
    .slice(0, 6);
}

function orientation(a: ImageAsset): string {
  const ratio = a.width / a.height;
  if (ratio > 1.15) return 'paisagem';
  if (ratio < 0.87) return 'retrato';
  return 'quadrada';
}

function clampPercent(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

/** Palpite só com metadados, usado sem visão ou se a visão falhar. */
function heuristicInsight(a: ImageAsset): ImageInsight {
  const ratio = a.width / a.height;
  const small = Math.max(a.width, a.height) < 500;
  const isLogo = a.hasAlpha || small;
  const canCover = !isLogo && Math.max(a.width, a.height) >= 1200;
  return {
    ...a,
    description: `imagem ${a.id} (${orientation(a)}, ${a.width}x${a.height}px) enviada pelo usuário`,
    kind: isLogo ? 'logo' : 'foto',
    suggestedRole: isLogo ? 'logo' : canCover && ratio >= 1 ? 'background' : 'inline',
    focalX: 50,
    focalY: 50,
    colors: [a.dominant],
    hasText: false,
    zones: [],
  };
}

/** Maneira de recortar a imagem sem estragar o conteúdo dela. */
export function fitFor(image: ImageInsight, role: ImageRole): 'cover' | 'contain' {
  if (role === 'logo' || image.kind === 'logo' || image.hasText) return 'contain';
  return 'cover';
}

/** Catálogo em texto para os prompts do planner e das páginas. */
export function renderImageCatalog(images: ImageInsight[], format?: PageFormat): string {
  return images
    .map(img => {
      const readyBackground = !!format && fitsSheet(img, format);
      return `- ${img.id}: ${img.description} | tipo: ${img.kind} | ${img.width}x${img.height}px ` +
        `(proporção ${(img.width / img.height).toFixed(2)}) | uso sugerido: ${readyBackground ? 'background' : img.suggestedRole}` +
        `${readyBackground ? ' | FUNDO PRONTO: mesma proporção da folha, cobre a página inteira sem cortar nada' : ''}` +
        `${img.hasText && !readyBackground ? ' | CONTÉM TEXTO — nunca cortar' : ''} | cores: ${img.colors.join(', ')}`;
    })
    .join('\n');
}
