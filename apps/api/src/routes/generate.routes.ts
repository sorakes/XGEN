import { Router } from 'express';
import { generateAndWait } from '../services/generation.service';
import { asyncHandler } from './asyncHandler';

export const generateRouter = Router();

// --- O BLOQUEIO SÍNCRONO (TRAVA O OPENWEBUI NO CALLING TOOL) ---
generateRouter.post('/', asyncHandler(async (req, res) => {
  const { documentType, instructions, mode, images, detailLevel, imageSource, extraImages } = req.body;
  const result = await generateAndWait({
    documentType, instructions, mode, images, detailLevel, imageSource, extraImages, headers: req.headers,
  });

  if (result.ok) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(result.status).json({ error: result.error });
  }
}));
