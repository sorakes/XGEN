import { Router } from 'express';
import { getOrCreateSettings, updateSettings } from '../services/settings.service';
import { asyncHandler } from './asyncHandler';

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
