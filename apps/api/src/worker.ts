import { Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { redisConnection, DOCUMENT_QUEUE_NAME } from './config/env';
import { prisma } from './lib/prisma';
import { getOrCreateSettings, resolveLlmProvider } from './services/settings.service';
import { cleanupOldAssets } from './services/images.service';
import { runDocumentAgent } from './agent';
import { createModel } from './agent/llm';
import { describeImages, knownImageInsight } from './agent/vision';
import { planImageRequests } from './agent/imageplan';
import { sourceImages } from './services/imagegen.service';
import { resolveIntent } from './agent/intent';
import { buildLiteralHtml, buildLiteralDocxHtml, literalFormat } from './agent/literal';
import { convertToPDF, convertToPPTX, convertToDOCX, convertToXLSX } from './converters';
import { convertToEditablePPTX } from './pptx/editable';
import { saveDeckFromHtml } from './services/decks.service';
import type { DetailLevel, DocumentType, GenerationMode, ImageAsset, ImageSource, PageFormat } from './types';

const EXTENSIONS: Record<DocumentType, string> = { PDF: 'pdf', PPTX: 'pptx', DOCX: 'docx', XLSX: 'xlsx' };

function parseImages(raw: string | null | undefined): ImageAsset[] {
  if (!raw) return [];
  try {
    // Asset apagado do disco (ex: container reiniciado) não derruba o job.
    return (JSON.parse(raw) as ImageAsset[]).filter(asset => fs.existsSync(asset.file));
  } catch {
    return [];
  }
}

export function startWorker() {
  return new Worker(DOCUMENT_QUEUE_NAME, async job => {
    const { jobId } = job.data;
    const documentType = job.data.documentType as DocumentType;

    const record = await prisma.documentJob.update({
      where: { id: jobId },
      data: { status: 'processing', current_step: 'Iniciando...' },
    });
    const instructions = record.prompt;

    console.log(`[Worker] Started Agentic Generation for Job ${jobId} (${documentType})...`);

    try {
      const settings = await getOrCreateSettings();
      const { llmKey, llmModel, provider, llmBaseUrl } = resolveLlmProvider(settings);
      const model = createModel({ llmKey, modelName: llmModel, provider, baseUrl: llmBaseUrl });

      const onProgress = async (step: string) => {
        await prisma.documentJob.update({ where: { id: jobId }, data: { current_step: step } });
      };

      const assets = parseImages(record.images);

      // Literal ("coloque essas imagens num PDF") ou criativo (documento com conteúdo)?
      const intent = await resolveIntent(model, instructions, assets.length, (record.mode || 'auto') as GenerationMode);
      console.log(`[Worker] Modo ${intent.mode} (${intent.reason})`);

      // Literal sem legenda não precisa entender as imagens: pula a chamada de visão.
      const needsVision = intent.mode === 'criativo' || intent.layout.captions;
      let images: Awaited<ReturnType<typeof describeImages>> = [];
      if (assets.length) {
        await onProgress(`Analisando ${assets.length} imagem(ns)...`);
        images = await describeImages(model, assets, instructions, settings.vision_enabled && needsVision);
      }

      // Imagens extras pedidas pelo usuário: fotos do banco (Pexels) ou geradas por IA.
      // Entram DEPOIS das anexadas (img-N continua a numeração).
      const imageSource = record.image_source as ImageSource | null;
      const detailLevel = record.detail_level as DetailLevel | null;
      if ((imageSource === 'banco' || imageSource === 'ia') && record.extra_images > 0) {
        await onProgress(imageSource === 'banco' ? 'Escolhendo fotos...' : 'Planejando imagens...');
        const requests = await planImageRequests(model, instructions, record.extra_images, imageSource, images);
        const sourced = await sourceImages(requests, imageSource, settings, images.length, onProgress);
        const firstExtra = images.length;
        images = images.concat(sourced.map((s, i) => knownImageInsight(
          { ...s.asset, id: `img-${firstExtra + i + 1}` },
          s.credit ? `${s.description} (${s.credit})` : s.description,
          imageSource === 'banco' ? 'foto' : 'ilustracao',
          firstExtra === 0 && i === 0
        )));
        console.log(`[Worker] ${sourced.length}/${requests.length} imagem(ns) ${imageSource === 'banco' ? 'do banco' : 'gerada(s) por IA'}`);
      }
      if (images.length) console.log(`[Worker] Imagens: ${images.map(i => `${i.id}=${i.kind}/${i.suggestedRole}`).join(' ')}`);

      let outputData: string;
      let pageFormat: PageFormat = documentType === 'PPTX' ? 'SLIDE' : 'A4';
      if (intent.mode === 'literal') {
        await onProgress('Montando o arquivo com as imagens enviadas...');
        if (documentType === 'DOCX') {
          outputData = buildLiteralDocxHtml(images, intent.layout);
        } else if (documentType === 'XLSX') {
          outputData = JSON.stringify({ sheets: [] }); // só a aba de imagens
        } else {
          pageFormat = literalFormat(documentType, images, intent.layout);
          outputData = buildLiteralHtml(images, pageFormat, intent.layout);
        }
      } else {
        outputData = await runDocumentAgent({
          model,
          instructions,
          documentType,
          maxRetries: settings.max_retries,
          images,
          detailLevel,
          visualReview: settings.visual_review,
          onProgress,
        });
      }

      const exportPath = path.join(__dirname, '..', 'exports');
      if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath, { recursive: true });

      await onProgress('Convertendo para ' + documentType + '...');
      const extension = EXTENSIONS[documentType];
      if (!extension) throw new Error("Tipo de documento não suportado.");
      const filePath = path.join(exportPath, `${jobId}.${extension}`);

      if (documentType === 'PDF') {
        await convertToPDF(outputData, filePath, pageFormat);
      } else if (documentType === 'PPTX') {
        const title = instructions.slice(0, 120);
        // Guarda os slides para o editor web (link "Editar" na resposta do chat).
        saveDeckFromHtml(jobId, title, outputData);
        try {
          await convertToEditablePPTX(outputData, filePath, title);
        } catch (error) {
          // O PPTX editável é o padrão; se a extração falhar, entrega o de imagens.
          console.error('[Worker] PPTX editável falhou, gerando versão em imagem:', error);
          await convertToPPTX(outputData, filePath, title);
        }
      } else if (documentType === 'DOCX') {
        await convertToDOCX(outputData, filePath, images);
      } else {
        await convertToXLSX(outputData, filePath, images);
      }
      const finalUrl = `/exports/${jobId}.${extension}`;

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
    } finally {
      cleanupOldAssets();
    }
  }, { connection: redisConnection });
}
