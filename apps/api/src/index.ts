import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { Worker, Queue } from 'bullmq';
import { runDocumentAgent } from './agent';
import { convertToPDF, convertToDOCX, convertToXLSX } from './converters';
import fs from 'fs';
import path from 'path';

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// --- BULLMQ WORKER (BACKGROUND) ---
const worker = new Worker('DocumentQueue', async job => {
  const { jobId, documentType, instructions } = job.data;
  
  await prisma.documentJob.update({
    where: { id: jobId },
    data: { status: 'processing', current_step: 'Iniciando...' }
  });

  console.log(`[Worker] Started Agentic Generation for Job ${jobId} (${documentType})...`);
  
  try {
    const s = (await prisma.settings.findFirst()) as any;
    if (!s) throw new Error("⚠️ Nenhuma configuração encontrada.");

    let llmKey = '', llmModel = 'gpt-4o', provider = 'openai', llmBaseUrl = '';
    
    if (s.active_llm === 'openai' && s.openai_key) {
      llmKey = s.openai_key; llmModel = s.openai_model || 'gpt-4o'; provider = 'openai';
      llmBaseUrl = s.openai_base_url || 'https://api.openai.com/v1';
    } else if (s.active_llm === 'openrouter' && s.openrouter_key) {
      llmKey = s.openrouter_key; llmModel = s.openrouter_model || 'openai/gpt-4o'; provider = 'openai';
      llmBaseUrl = 'https://openrouter.ai/api/v1';
    } else if (s.active_llm === 'google' && s.google_key) {
      llmKey = s.google_key; llmModel = s.google_model || 'gemini-2.0-flash'; provider = 'google';
    } else if (s.active_llm === 'ollama') {
      llmKey = 'ollama'; llmModel = s.ollama_model || 'llama3'; provider = 'openai';
      llmBaseUrl = s.ollama_url || 'http://localhost:11434/v1';
    } else {
      throw new Error("⚠️ A chave do provedor LLM ativo não está configurada.");
    }

    // Callback de progresso — atualiza current_step no banco em tempo real
    const onProgress = async (step: string) => {
      await prisma.documentJob.update({
        where: { id: jobId },
        data: { current_step: step }
      });
    };

    // 1. Roda a Arquitetura Agentiva (LangGraph)
    const outputData = await runDocumentAgent(
      instructions, documentType, s.max_retries, llmKey, llmModel, provider, llmBaseUrl, onProgress
    );

    // 2. Prepara a pasta de exportação
    const exportPath = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath, { recursive: true });
    
    // 3. Conversão Final
    await onProgress('Convertendo para ' + documentType + '...');
    let finalUrl = '';
    
    if (documentType === 'PDF') {
      const filePath = path.join(exportPath, `${jobId}.pdf`);
      await convertToPDF(outputData, filePath);
      finalUrl = `/exports/${jobId}.pdf`;
    } else if (documentType === 'DOCX') {
      const filePath = path.join(exportPath, `${jobId}.docx`);
      await convertToDOCX(outputData, filePath);
      finalUrl = `/exports/${jobId}.docx`;
    } else if (documentType === 'XLSX') {
      const filePath = path.join(exportPath, `${jobId}.xlsx`);
      await convertToXLSX(outputData, filePath);
      finalUrl = `/exports/${jobId}.xlsx`;
    } else {
      throw new Error("Tipo de documento não suportado.");
    }

    await prisma.documentJob.update({
      where: { id: jobId },
      data: { status: 'completed', file_url: finalUrl, current_step: 'Concluído ✅' }
    });
    console.log(`[Worker] ✅ Job ${jobId} Completed! → ${finalUrl}`);

  } catch (error: any) {
    console.error(`[Worker] ❌ Job ${jobId} Failed:`, error);
    await prisma.documentJob.update({
      where: { id: jobId },
      data: { status: 'failed', error_log: error.message, current_step: 'Falhou ❌' }
    });
  }

}, { connection: { host: 'localhost', port: 6379 } });

// --- STATIC EXPORTS ---
app.use('/exports', express.static(path.join(__dirname, '..', 'exports')));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'xgen-api' }));

// --- SETTINGS CRUD ---
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findFirst();
    if (!settings) settings = await prisma.settings.create({ data: { max_retries: 3 } });
    res.json(settings);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar configurações' }); }
});

app.put('/api/settings', async (req, res) => {
  try {
    const payload = req.body;
    let settings = await prisma.settings.findFirst();
    if (settings) {
      settings = await prisma.settings.update({ where: { id: settings.id }, data: payload });
    } else {
      settings = await prisma.settings.create({ data: payload });
    }
    res.json(settings);
  } catch (error) { res.status(500).json({ error: 'Erro ao atualizar configurações' }); }
});

// --- JOBS QUEUE ---
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await prisma.documentJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(jobs);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar jobs' }); }
});

// --- TEST ENDPOINT ---
const documentQueue = new Queue('DocumentQueue', { connection: { host: 'localhost', port: 6379 } });

app.post('/api/generate', async (req, res) => {
  try {
    const { documentType, instructions } = req.body;
    if (!documentType || !instructions) {
      return res.status(400).json({ error: 'Campos: documentType (PDF|DOCX|XLSX) e instructions' });
    }
    const jobRecord = await prisma.documentJob.create({
      data: { status: 'queued', file_type: documentType, prompt: instructions, current_step: 'Na fila' }
    });
    await documentQueue.add('generate', { jobId: jobRecord.id, documentType, instructions }, { jobId: jobRecord.id });
    res.json({ success: true, jobId: jobRecord.id, message: 'Job enfileirado!' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, () => {
  console.log(`🚀 XGEN API (Express & Agent Worker) running on port ${PORT}`);
});
