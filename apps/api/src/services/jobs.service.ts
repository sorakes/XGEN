import { prisma } from '../lib/prisma';
import { documentQueue } from '../queue';
import { JOB_DEDUP_WINDOW_MS } from '../config/env';
import type { DocumentType, GenerationMode, ImageAsset } from '../types';

// Serializa criações concorrentes com a MESMA chave (tipo+instruções+imagens) dentro
// deste processo, fechando a race condition entre "checar se existe" e
// "criar": duas chamadas simultâneas do mesmo pedido só criam 1 job.
const inFlight = new Map<string, Promise<any>>();

function dedupKey(documentType: DocumentType, instructions: string, imagesJson: string | null, mode: GenerationMode) {
  return `${documentType}::${mode}::${instructions}::${imagesJson ?? ''}`;
}

/**
 * Cria um novo job, ou reaproveita um job idêntico (mesmo tipo + instruções)
 * ainda em andamento dentro da janela de deduplicação. Evita gerar 2 arquivos
 * quando o mesmo pedido chega duas vezes (retry de client, dupla chamada, etc).
 */
export async function createOrReuseJob(
  documentType: DocumentType,
  instructions: string,
  images: ImageAsset[] = [],
  mode: GenerationMode = 'auto'
) {
  const imagesJson = images.length ? JSON.stringify(images) : null;
  const key = dedupKey(documentType, instructions, imagesJson, mode);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = createOrReuseJobUnsafe(documentType, instructions, imagesJson, mode).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function createOrReuseJobUnsafe(
  documentType: DocumentType,
  instructions: string,
  imagesJson: string | null,
  mode: GenerationMode
) {
  const existing = await prisma.documentJob.findFirst({
    where: {
      file_type: documentType,
      prompt: instructions,
      images: imagesJson,
      mode,
      status: { in: ['queued', 'processing'] },
      createdAt: { gte: new Date(Date.now() - JOB_DEDUP_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    console.log(`[Jobs] ♻️ Reaproveitando job ${existing.id} (pedido duplicado)`);
    return existing;
  }

  const job = await prisma.documentJob.create({
    data: { status: 'queued', file_type: documentType, prompt: instructions, images: imagesJson, mode, current_step: 'Na fila' },
  });
  // Instruções e imagens ficam no registro do job; a fila só carrega a referência.
  await documentQueue.add('generate', { jobId: job.id, documentType }, { jobId: job.id });
  return job;
}

export function getJobs() {
  return prisma.documentJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
}

export function getJobById(id: string) {
  return prisma.documentJob.findUnique({ where: { id } });
}

export function updateJobStatus(id: string, data: Record<string, any>) {
  return prisma.documentJob.update({ where: { id }, data });
}
