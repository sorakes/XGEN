import { Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { redisConnection, DOCUMENT_QUEUE_NAME } from './config/env';
import { prisma } from './lib/prisma';
import { getOrCreateSettings, resolveLlmProvider } from './services/settings.service';
import { runDocumentAgent } from './agent';
import { convertToPDF, convertToDOCX, convertToXLSX } from './converters';

export function startWorker() {
  return new Worker(DOCUMENT_QUEUE_NAME, async job => {
    const { jobId, documentType, instructions } = job.data;

    await prisma.documentJob.update({
      where: { id: jobId },
      data: { status: 'processing', current_step: 'Iniciando...' },
    });

    console.log(`[Worker] Started Agentic Generation for Job ${jobId} (${documentType})...`);

    try {
      const settings = await getOrCreateSettings();
      const { llmKey, llmModel, provider, llmBaseUrl } = resolveLlmProvider(settings);

      const onProgress = async (step: string) => {
        await prisma.documentJob.update({ where: { id: jobId }, data: { current_step: step } });
      };

      const outputData = await runDocumentAgent(
        instructions, documentType, settings.max_retries, llmKey, llmModel, provider, llmBaseUrl, onProgress
      );

      const exportPath = path.join(__dirname, '..', 'exports');
      if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath, { recursive: true });

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
        data: { status: 'completed', file_url: finalUrl, current_step: 'Concluído ✅' },
      });
      console.log(`[Worker] ✅ Job ${jobId} Completed! → ${finalUrl}`);
    } catch (error: any) {
      console.error(`[Worker] ❌ Job ${jobId} Failed:`, error);
      await prisma.documentJob.update({
        where: { id: jobId },
        data: { status: 'failed', error_log: error.message, current_step: 'Falhou ❌' },
      });
    }
  }, { connection: redisConnection });
}
