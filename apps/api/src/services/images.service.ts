import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  OPENWEBUI_URL, OPENWEBUI_API_KEY,
  MAX_IMAGES_PER_JOB, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE_PX,
} from '../config/env';
import type { ImageAsset, Settings } from '../types';

/**
 * As imagens ficam FORA da pasta /exports (que é pública): são insumo do job,
 * não entregável. O arquivo final já sai com elas embutidas.
 */
export const ASSETS_DIR = path.join(__dirname, '..', '..', 'storage', 'assets');

/** Assets mais velhos que isso são apagados na limpeza periódica. */
const ASSET_TTL_MS = 6 * 60 * 60 * 1000;

interface OpenWebUIConfig {
  url: string;
  apiKey: string;
}

/** Headers que o OpenWebUI manda para a ferramenta (ver README). */
export interface OpenWebUIContext {
  chatId?: string;
  messageId?: string;
  userMessageId?: string;
}

export function readOpenWebUIContext(headers: Record<string, any>): OpenWebUIContext {
  const pick = (name: string) => {
    const value = headers[name.toLowerCase()];
    const str = Array.isArray(value) ? value[0] : value;
    // Template não substituído ('{{CHAT_ID}}') ou vazio = header ausente.
    return typeof str === 'string' && str && !str.includes('{{') ? str : undefined;
  };
  return {
    chatId: pick('X-OpenWebUI-Chat-Id'),
    messageId: pick('X-OpenWebUI-Message-Id'),
    userMessageId: pick('X-OpenWebUI-User-Message-Id'),
  };
}

function resolveOpenWebUIConfig(settings: Settings): OpenWebUIConfig | null {
  const url = (settings.openwebui_url || OPENWEBUI_URL).trim().replace(/\/+$/, '');
  const apiKey = (settings.openwebui_api_key || OPENWEBUI_API_KEY).trim();
  return url && apiKey ? { url, apiKey } : null;
}

/**
 * Reúne as imagens do pedido: as passadas explicitamente no body e, quando
 * a chamada vem do OpenWebUI, as anexadas na última mensagem do usuário.
 * Tudo é normalizado e salvo em disco antes de o job entrar na fila.
 */
export async function collectImages(
  bodyImages: unknown,
  context: OpenWebUIContext,
  settings: Settings
): Promise<ImageAsset[]> {
  const owui = resolveOpenWebUIConfig(settings);
  const buffers: Buffer[] = [];

  if (Array.isArray(bodyImages)) {
    for (const ref of bodyImages.slice(0, MAX_IMAGES_PER_JOB)) {
      if (typeof ref !== 'string' || !ref.trim()) continue;
      const buffer = await loadImageRef(ref.trim(), owui).catch(error => {
        console.warn(`[Images] Ignorando imagem do body: ${error.message}`);
        return null;
      });
      if (buffer) buffers.push(buffer);
    }
  }

  if (context.chatId) {
    if (!owui) {
      console.warn('[Images] Chamada do OpenWebUI, mas URL/API key do OpenWebUI não estão configuradas — imagens do chat ignoradas.');
    } else {
      const fromChat = await imagesFromOpenWebUIChat(context, owui).catch(error => {
        console.warn(`[Images] Falha ao buscar imagens do chat ${context.chatId}: ${error.message}`);
        return [] as Buffer[];
      });
      buffers.push(...fromChat);
    }
  }

  const assets: ImageAsset[] = [];
  const seen = new Set<string>();
  for (const buffer of buffers) {
    if (assets.length >= MAX_IMAGES_PER_JOB) break;
    try {
      const asset = await normalizeImage(buffer, assets.length + 1);
      if (seen.has(asset.hash)) continue; // mesma imagem mandada duas vezes
      seen.add(asset.hash);
      assets.push(asset);
    } catch (error: any) {
      console.warn(`[Images] Imagem inválida ignorada: ${error.message}`);
    }
  }

  // Renumera depois do dedup para os ids ficarem contínuos (img-1, img-2...).
  return assets.map((asset, i) => ({ ...asset, id: `img-${i + 1}` }));
}

async function loadImageRef(ref: string, owui: OpenWebUIConfig | null): Promise<Buffer> {
  if (ref.startsWith('data:')) return decodeDataUrl(ref);

  if (/^https?:\/\//i.test(ref)) {
    // Só manda a API key se a URL for do próprio OpenWebUI.
    const auth = owui && ref.startsWith(owui.url) ? owui.apiKey : undefined;
    return download(ref, auth);
  }

  if (owui && ref.startsWith('/')) return download(`${owui.url}${ref}`, owui.apiKey);

  throw new Error(`referência de imagem não suportada (${ref.slice(0, 40)}...)`);
}

function decodeDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('data URL inválida');
  const buffer = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('imagem maior que o limite');
  return buffer;
}

async function download(url: string, bearer?: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('imagem maior que o limite');
  return buffer;
}

/**
 * Lê o chat pela API do OpenWebUI e devolve as imagens da mensagem do
 * usuário que originou a chamada (ou da mais recente acima dela que tenha
 * imagens — o usuário pode ter mandado as fotos e pedido o documento depois).
 */
async function imagesFromOpenWebUIChat(context: OpenWebUIContext, owui: OpenWebUIConfig): Promise<Buffer[]> {
  // O OpenWebUI pode chamar a ferramenta antes de terminar de persistir a
  // mensagem nova; duas tentativas curtas cobrem essa janela.
  let files: any[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const chat = await fetchJson(`${owui.url}/api/v1/chats/${encodeURIComponent(context.chatId!)}`, owui.apiKey);
    files = findImageFiles(chat, context);
    if (files.length > 0) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const buffers: Buffer[] = [];
  for (const file of files.slice(0, MAX_IMAGES_PER_JOB)) {
    try {
      buffers.push(await loadChatFile(file, owui));
    } catch (error: any) {
      console.warn(`[Images] Não consegui baixar um anexo do chat: ${error.message}`);
    }
  }
  console.log(`[Images] ${buffers.length} imagem(ns) recuperada(s) do chat ${context.chatId}`);
  return buffers;
}

async function fetchJson(url: string, apiKey: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return response.json();
}

function isImageFile(file: any): boolean {
  if (!file || typeof file !== 'object') return false;
  const contentType =
    file.content_type || file.file?.meta?.content_type || file.meta?.content_type || '';
  return file.type === 'image' || String(contentType).startsWith('image/');
}

function findImageFiles(chat: any, context: OpenWebUIContext): any[] {
  const history = chat?.chat?.history;
  const messages: Record<string, any> = history?.messages || {};

  // Ponto de partida: a mensagem do usuário que disparou a ferramenta.
  let startId: string | undefined =
    context.userMessageId ||
    (context.messageId ? messages[context.messageId]?.parentId : undefined) ||
    history?.currentId;

  // Sobe pela árvore da conversa até achar uma mensagem de usuário com imagens.
  const visited = new Set<string>();
  let current = startId ? messages[startId] : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.role === 'user') {
      const images = (current.files || []).filter(isImageFile);
      if (images.length) return images;
    }
    current = current.parentId ? messages[current.parentId] : undefined;
  }

  // Formato antigo: lista linear em chat.messages.
  const linear: any[] = chat?.chat?.messages || [];
  for (let i = linear.length - 1; i >= 0; i--) {
    const message = linear[i];
    if (message?.role !== 'user') continue;
    const images = (message.files || []).filter(isImageFile);
    if (images.length) return images;
  }
  return [];
}

async function loadChatFile(file: any, owui: OpenWebUIConfig): Promise<Buffer> {
  const url: string = file.url || '';
  if (url.startsWith('data:')) return decodeDataUrl(url);
  if (/^https?:\/\//i.test(url)) return loadImageRef(url, owui);
  if (url.startsWith('/')) return download(`${owui.url}${url}`, owui.apiKey);

  // Upload normal do OpenWebUI: a url é só o id do arquivo.
  const id = file.id || file.file?.id || url;
  if (!id) throw new Error('anexo sem id nem url');
  return download(`${owui.url}/api/v1/files/${encodeURIComponent(id)}/content`, owui.apiKey);
}

/**
 * Corrige a rotação EXIF (foto de celular deitada), remove metadados, limita
 * o lado maior e salva como JPEG (ou PNG quando há transparência — logos).
 */
async function normalizeImage(input: Buffer, index: number): Promise<ImageAsset> {
  const pipeline = sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: MAX_IMAGE_SIDE_PX, height: MAX_IMAGE_SIDE_PX, fit: 'inside', withoutEnlargement: true });

  const meta = await sharp(input).metadata();
  const hasAlpha = !!meta.hasAlpha && (await hasRealTransparency(input));

  const { data, info } = hasAlpha
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  const stats = await sharp(data).stats();
  const { r, g, b } = stats.dominant;
  const dominant = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

  const hash = crypto.createHash('sha1').update(data).digest('hex');
  const ext = hasAlpha ? 'png' : 'jpg';
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const file = path.join(ASSETS_DIR, `${hash}.${ext}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, data);

  return {
    id: `img-${index}`,
    hash,
    file,
    mime: hasAlpha ? 'image/png' : 'image/jpeg',
    width: info.width,
    height: info.height,
    hasAlpha,
    dominant,
  };
}

/** PNG com canal alfa todo opaco não é "logo transparente": vira JPEG. */
async function hasRealTransparency(input: Buffer): Promise<boolean> {
  const stats = await sharp(input).stats();
  const alpha = stats.channels[3];
  return !!alpha && alpha.min < 250;
}

/** Lê o asset do disco como data URL (usado no HTML renderizado e na visão). */
export function assetToDataUrl(asset: ImageAsset): string {
  return `data:${asset.mime};base64,${fs.readFileSync(asset.file).toString('base64')}`;
}

/** Versão reduzida para mandar à LLM de visão (economiza tokens). */
export async function assetPreviewDataUrl(asset: ImageAsset, maxSide = 1024): Promise<string> {
  const buffer = await sharp(asset.file)
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/** Remove assets antigos: o arquivo final já leva as imagens embutidas. */
export function cleanupOldAssets() {
  if (!fs.existsSync(ASSETS_DIR)) return;
  const now = Date.now();
  for (const name of fs.readdirSync(ASSETS_DIR)) {
    const file = path.join(ASSETS_DIR, name);
    try {
      if (now - fs.statSync(file).mtimeMs > ASSET_TTL_MS) fs.unlinkSync(file);
    } catch { /* arquivo já removido por outro job */ }
  }
}
