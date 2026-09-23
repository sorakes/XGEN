import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from './asyncHandler';
import { loadDeck, updateDeckSlides, joinDeckHtml } from '../services/decks.service';
import { convertToEditablePPTX } from '../pptx/editable';

export const decksRouter = Router();

const EXPORTS_DIR = path.join(__dirname, '..', '..', 'exports');

/** Um export por deck de cada vez (o editor pode clicar "Baixar" duas vezes). */
const exporting = new Map<string, Promise<string>>();

decksRouter.get('/:id', asyncHandler(async (req, res) => {
  const deck = loadDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Apresentação não encontrada' });
  res.json(deck);
}));

decksRouter.put('/:id', asyncHandler(async (req, res) => {
  try {
    const deck = updateDeckSlides(req.params.id, req.body?.slides);
    res.json({ ok: true, updatedAt: deck.updatedAt, slides: deck.slides.length });
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
}));

/** Gera o PPTX editável a partir da versão salva do deck. */
decksRouter.post('/:id/export', asyncHandler(async (req, res) => {
  const deck = loadDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Apresentação não encontrada' });

  let task = exporting.get(deck.id);
  if (!task) {
    task = (async () => {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
      // Nome novo a cada versão: o navegador não reaproveita um download antigo do cache.
      const fileName = `${deck.id}-editado-${Date.now()}.pptx`;
      await convertToEditablePPTX(joinDeckHtml(deck), path.join(EXPORTS_DIR, fileName), deck.title);
      return `/exports/${fileName}`;
    })().finally(() => exporting.delete(deck.id));
    exporting.set(deck.id, task);
  }

  try {
    res.json({ url: await task });
  } catch (error: any) {
    console.error('[Decks] Falha ao exportar PPTX:', error);
    res.status(500).json({ error: 'Falha ao gerar o PPTX' });
  }
}));
