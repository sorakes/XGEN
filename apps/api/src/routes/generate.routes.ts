import { Router } from 'express';
import { PUBLIC_API_URL, GENERATE_WAIT_TIMEOUT_MS, GENERATE_POLL_INTERVAL_MS } from '../config/env';
import { createOrReuseJob, getJobById } from '../services/jobs.service';
import { asyncHandler } from './asyncHandler';
import type { DocumentType } from '../types';

export const generateRouter = Router();

const VALID_TYPES: DocumentType[] = ['PDF', 'DOCX', 'XLSX'];

// --- O BLOQUEIO SÍNCRONO (TRAVA O OPENWEBUI NO CALLING TOOL) ---
generateRouter.post('/', asyncHandler(async (req, res) => {
  const { documentType, instructions } = req.body;
  if (!documentType || !instructions || !VALID_TYPES.includes(documentType)) {
    return res.status(400).json({ error: 'Campos: documentType (PDF|DOCX|XLSX) e instructions' });
  }

  const jobRecord = await createOrReuseJob(documentType, instructions);

  const deadline = Date.now() + GENERATE_WAIT_TIMEOUT_MS;
  let finalJob: typeof jobRecord | null = jobRecord;
  while (finalJob && finalJob.status !== 'completed' && finalJob.status !== 'failed') {
    if (Date.now() > deadline) {
      return res.status(504).json({ error: 'Tempo limite excedido aguardando a geração do documento.' });
    }
    await new Promise(resolve => setTimeout(resolve, GENERATE_POLL_INTERVAL_MS));
    finalJob = await getJobById(jobRecord.id);
  }

  if (finalJob?.status === 'completed') {
    res.json({
      success: true,
      message: `Relatorio gerado com sucesso. Entregue o link de download no chat para que o usuario consiga baixar o arquivo gerado: [Baixar Relatorio ${documentType}](${PUBLIC_API_URL}${finalJob.file_url})`,
    });
  } else {
    res.status(500).json({ error: 'Falha na geracao do documento pelo XGEN.' });
  }
}));
