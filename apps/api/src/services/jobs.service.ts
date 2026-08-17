import { prisma } from '../lib/prisma';
import { documentQueue } from '../queue';
import { JOB_DEDUP_WINDOW_MS } from '../config/env';
import type { DocumentType } from '../types';

// Serializa criações concorrentes com a MESMA chave (tipo+instruções) dentro
// deste processo, fechando a race condition entre "checar se existe" e
// "criar": duas chamadas simultâneas do mesmo pedido só criam 1 job.
const inFlight = new Map<string, Promise<any>>();

function dedupKey(documentType: DocumentType, instructions: string) {
  return `${documentType}::${instructions}`;
}

/**
 * Cria um novo job, ou reaproveita um job idêntico (mesmo tipo + instruções)
 * ainda em andamento dentro da janela de deduplicação. Evita gerar 2 arquivos
 * quando o mesmo pedido chega duas vezes (retry de client, dupla chamada, etc).
 */
export async function createOrReuseJob(documentType: DocumentType, instructions: string) {
  const key = dedupKey(documentType, instructions);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = createOrReuseJobUnsafe(documentType, instructions).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function createOrReuseJobUnsafe(documentType: DocumentType, instructions: string) {
  const existing = await prisma.documentJob.findFirst({
    where: {
      file_type: documentType,
      prompt: instructions,
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
    data: { status: 'queued', file_type: documentType, prompt: instructions, current_step: 'Na fila' },
  });
  await documentQueue.add('generate', { jobId: job.id, documentType, instructions }, { jobId: job.id });
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
