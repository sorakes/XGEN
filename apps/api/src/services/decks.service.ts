import fs from 'fs';
import path from 'path';
import { SLIDES_START, SLIDES_END } from '../agent/assemble';

/**
 * Deck = o HTML de uma apresentação separado em slides, guardado para o
 * editor web. O editor altera os slides; na exportação eles são juntados de
 * volta com o mesmo <head> (Tailwind, fontes, CSS da folha) e o mesmo rodapé
 * de scripts (Chart.js) do documento original.
 *
 * Fica fora de /exports (pública): quem tem o link do editor acessa pela API.
 */
export const DECKS_DIR = path.join(__dirname, '..', '..', 'storage', 'decks');

/** Limite de um deck salvo (imagens entram como data URL). */
const MAX_DECK_BYTES = 60 * 1024 * 1024;
const MAX_SLIDES = 60;

export interface Deck {
  id: string;
  title: string;
  before: string;   // tudo até o marcador de início dos slides
  slides: string[]; // um <section class="xgen-page"> por item
  after: string;    // tudo depois do marcador de fim
  updatedAt: string;
}

const ID_RE = /^[0-9a-f-]{36}$/i;

function deckFile(id: string): string {
  if (!ID_RE.test(id)) throw new Error('id de deck inválido');
  return path.join(DECKS_DIR, `${id}.json`);
}

/** Separa o HTML gerado em cabeçalho, slides e rodapé. */
export function splitDeckHtml(html: string): Pick<Deck, 'before' | 'slides' | 'after'> {
  const start = html.indexOf(SLIDES_START);
  const end = html.indexOf(SLIDES_END);
  if (start === -1 || end === -1 || end < start) throw new Error('HTML sem os marcadores de slides');

  const middle = html.slice(start + SLIDES_START.length, end);
  const opening = '<section class="xgen-page"';
  const slides: string[] = [];
  let cursor = middle.indexOf(opening);
  while (cursor !== -1) {
    const next = middle.indexOf(opening, cursor + opening.length);
    slides.push(middle.slice(cursor, next === -1 ? undefined : next).trim());
    cursor = next;
  }
  return {
    before: html.slice(0, start + SLIDES_START.length),
    slides,
    after: html.slice(end),
  };
}

export function joinDeckHtml(deck: Pick<Deck, 'before' | 'slides' | 'after'>): string {
  return `${deck.before}\n${deck.slides.join('\n')}\n${deck.after}`;
}

export function saveDeckFromHtml(id: string, title: string, html: string): Deck {
  const deck: Deck = { id, title, ...splitDeckHtml(html), updatedAt: new Date().toISOString() };
  fs.mkdirSync(DECKS_DIR, { recursive: true });
  fs.writeFileSync(deckFile(id), JSON.stringify(deck));
  return deck;
}

export function loadDeck(id: string): Deck | null {
  let file: string;
  try {
    file = deckFile(id);
  } catch {
    return null;
  }
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Deck;
}

/** Salva os slides editados. Valida o formato para o editor não corromper o deck. */
export function updateDeckSlides(id: string, slides: unknown): Deck {
  const deck = loadDeck(id);
  if (!deck) throw Object.assign(new Error('Deck não encontrado'), { status: 404 });
  if (!Array.isArray(slides) || slides.length === 0 || slides.length > MAX_SLIDES) {
    throw Object.assign(new Error(`Envie de 1 a ${MAX_SLIDES} slides`), { status: 400 });
  }
  const clean = slides.map((slide, i) => {
    if (typeof slide !== 'string' || !slide.trimStart().startsWith('<section class="xgen-page"')) {
      throw Object.assign(new Error(`Slide ${i + 1} inválido`), { status: 400 });
    }
    return slide.trim();
  });
  const updated: Deck = { ...deck, slides: clean, updatedAt: new Date().toISOString() };
  const json = JSON.stringify(updated);
  if (Buffer.byteLength(json) > MAX_DECK_BYTES) {
    throw Object.assign(new Error('Apresentação grande demais (imagens pesadas demais?)'), { status: 413 });
  }
  fs.writeFileSync(deckFile(id), json);
  return updated;
}
