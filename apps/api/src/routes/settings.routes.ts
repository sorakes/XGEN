import { Router } from 'express';
import { getOrCreateSettings, updateSettings } from '../services/settings.service';
import { asyncHandler } from './asyncHandler';
import { testImageProvider } from '../services/imagegen.service';

export const settingsRouter = Router();

settingsRouter.get('/', asyncHandler(async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
}));

settingsRouter.put('/', asyncHandler(async (req, res) => {
  try {
    const settings = await updateSettings(req.body);
    res.json(settings);
  } catch (error) {
    console.error("❌ Erro ao salvar configurações:", error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
}));

/** Busca (Pexels) ou gera (IA) UMA imagem com as configurações salvas, para conferir. */
settingsRouter.post('/test-image', asyncHandler(async (req, res) => {
  const source = req.body?.source === 'banco' ? 'banco' : 'ia';
  try {
    const settings = await getOrCreateSettings();
    res.json({ ok: true, ...(await testImageProvider(source, settings)) });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message });
  }
}));
