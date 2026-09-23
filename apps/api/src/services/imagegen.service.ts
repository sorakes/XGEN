import { normalizeImage } from './images.service';
import type { ImageAsset, ImageSource, Settings } from '../types';

/** O que buscar/gerar para UMA imagem (vem do planejamento de imagens). */
export interface ImageRequest {
  query: string;        // termos de busca em inglês (banco de fotos)
  prompt: string;       // descrição detalhada (geração por IA)
  description: string;  // o que a imagem mostra, em português (vai para o catálogo)
  orientation: 'landscape' | 'portrait' | 'square';
}

export interface SourcedImage {
  asset: ImageAsset;
  description: string;
  credit?: string;
}

const ASPECT: Record<ImageRequest['orientation'], string> = { landscape: '16:9', portrait: '3:4', square: '1:1' };

async function fetchBuffer(url: string, init?: RequestInit, timeoutMs = 60_000): Promise<Buffer> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 120_000): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const dataUrlToBuffer = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

// ---------------------------------------------------------------------------
// Banco de fotos: Pexels
// ---------------------------------------------------------------------------
async function fromPexels(req: ImageRequest, settings: Settings, used: Set<number>): Promise<{ buffer: Buffer; credit: string }> {
  if (!settings.pexels_key) throw new Error('chave do Pexels não configurada');
  const params = new URLSearchParams({ query: req.query, per_page: '10', orientation: req.orientation });
  const data = await fetchJson(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: settings.pexels_key },
  }, 20_000);
  // Não repete a mesma foto em dois pedidos parecidos do mesmo documento.
  const photo = (data.photos || []).find((p: any) => !used.has(p.id));
  if (!photo) throw new Error(`nenhuma foto no Pexels para "${req.query}"`);
  used.add(photo.id);
  const buffer = await fetchBuffer(photo.src?.large2x || photo.src?.large || photo.src?.original);
  return { buffer, credit: `Foto: ${photo.photographer} / Pexels` };
}

// ---------------------------------------------------------------------------
// Geração por IA
// ---------------------------------------------------------------------------
const aiPrompt = (req: ImageRequest) =>
  `${req.prompt}\n\nPhotorealistic or high-quality editorial illustration as appropriate. ` +
  `No text, no letters, no watermarks, no logos. Aspect ratio ${ASPECT[req.orientation]}.`;

/** OpenRouter (usa a mesma chave do LLM): modelos com saída de imagem. */
async function fromOpenRouter(req: ImageRequest, settings: Settings): Promise<Buffer> {
  if (!settings.openrouter_key) throw new Error('chave do OpenRouter não configurada');
  const data = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.openrouter_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.openrouter_img_model || 'google/gemini-3.1-flash-image',
      messages: [{ role: 'user', content: aiPrompt(req) }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: ASPECT[req.orientation] },
    }),
  });
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error('o modelo não devolveu imagem');
  return url.startsWith('data:') ? dataUrlToBuffer(url) : fetchBuffer(url);
}

/** Google Gemini direto (chave própria de imagem). */
async function fromGemini(req: ImageRequest, settings: Settings): Promise<Buffer> {
  if (!settings.gemini_img_key) throw new Error('chave do Gemini (imagens) não configurada');
  const model = settings.gemini_img_model || 'gemini-2.5-flash-image';
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': settings.gemini_img_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: aiPrompt(req) }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ASPECT[req.orientation] } },
    }),
  });
  const part = (data.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
  if (!part) throw new Error('o Gemini não devolveu imagem');
  return Buffer.from(part.inlineData.data, 'base64');
}

/**
 * ComfyUI local. O workflow (JSON no formato "API" do ComfyUI) vem das
 * configurações e deve ter {{PROMPT}} onde entra o texto; opcionalmente
 * {{WIDTH}} e {{HEIGHT}}.
 */
async function fromComfyUI(req: ImageRequest, settings: Settings): Promise<Buffer> {
  const base = (settings.comfyui_url || '').replace(/\/+$/, '');
  if (!base || !settings.comfyui_workflow) throw new Error('URL ou workflow do ComfyUI não configurados');
  const [w, h] = req.orientation === 'portrait' ? [896, 1152] : req.orientation === 'square' ? [1024, 1024] : [1344, 768];
  const workflow = settings.comfyui_workflow
    .replace(/\{\{PROMPT\}\}/g, JSON.stringify(aiPrompt(req)).slice(1, -1))
    .replace(/"?\{\{WIDTH\}\}"?/g, String(w))
    .replace(/"?\{\{HEIGHT\}\}"?/g, String(h));
  const queued = await fetchJson(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: JSON.parse(workflow) }),
  }, 30_000);
  const id = queued.prompt_id;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const history = await fetchJson(`${base}/history/${id}`, undefined, 15_000);
    const outputs = history?.[id]?.outputs;
    if (!outputs) continue;
    for (const node of Object.values<any>(outputs)) {
      const img = node.images?.[0];
      if (img) {
        const params = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
        return fetchBuffer(`${base}/view?${params}`);
      }
    }
  }
  throw new Error('o ComfyUI não terminou a imagem em 5 minutos');
}

async function generateAI(req: ImageRequest, settings: Settings): Promise<Buffer> {
  const provider = settings.active_image === 'pexels' ? 'openrouter' : settings.active_image;
  if (provider === 'gemini') return fromGemini(req, settings);
  if (provider === 'comfyui') return fromComfyUI(req, settings);
  return fromOpenRouter(req, settings);
}

export function aiProviderLabel(settings: Settings): string {
  const provider = settings.active_image === 'pexels' ? 'openrouter' : settings.active_image;
  if (provider === 'gemini') return `Gemini (${settings.gemini_img_model || 'gemini-2.5-flash-image'})`;
  if (provider === 'comfyui') return 'ComfyUI';
  return `OpenRouter (${settings.openrouter_img_model || 'google/gemini-3.1-flash-image'})`;
}

/**
 * Busca (banco) ou gera (ia) as imagens pedidas. Falhas individuais não
 * derrubam o documento: a imagem que não veio simplesmente fica de fora.
 * `startIndex` continua a numeração depois das imagens do usuário.
 */
export async function sourceImages(
  requests: ImageRequest[],
  source: ImageSource,
  settings: Settings,
  startIndex: number,
  onProgress?: (step: string) => Promise<void>
): Promise<SourcedImage[]> {
  const out: SourcedImage[] = [];
  const usedPhotos = new Set<number>();
  for (const [i, req] of requests.entries()) {
    const label = source === 'banco' ? 'Buscando foto' : 'Gerando imagem';
    if (onProgress) await onProgress(`${label} ${i + 1}/${requests.length}: ${req.description.slice(0, 60)}`);
    try {
      let buffer: Buffer;
      let credit: string | undefined;
      if (source === 'banco') {
        ({ buffer, credit } = await fromPexels(req, settings, usedPhotos));
      } else {
        buffer = await generateAI(req, settings);
        credit = `Imagem gerada por IA — ${aiProviderLabel(settings)}`;
      }
      const asset = await normalizeImage(buffer, startIndex + out.length + 1);
      out.push({ asset, description: req.description, credit });
    } catch (error: any) {
      console.warn(`[ImageGen] ${source} falhou para "${req.query}": ${error.message}`);
    }
  }
  return out;
}

/** Usado pelo botão "Testar" do painel: uma imagem só, para conferir a configuração. */
export async function testImageProvider(source: 'banco' | 'ia', settings: Settings): Promise<{ dataUrl: string; credit: string }> {
  const req: ImageRequest = {
    query: 'mountains lake sunrise',
    prompt: 'A calm mountain lake at sunrise, soft golden light, mist over the water',
    description: 'teste',
    orientation: 'landscape',
  };
  let buffer: Buffer;
  let credit: string;
  if (source === 'banco') ({ buffer, credit } = await fromPexels(req, settings, new Set()));
  else { buffer = await generateAI(req, settings); credit = aiProviderLabel(settings); }
  const sharp = (await import('sharp')).default;
  const preview = await sharp(buffer).resize({ width: 480 }).jpeg({ quality: 80 }).toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${preview.toString('base64')}`, credit };
}
