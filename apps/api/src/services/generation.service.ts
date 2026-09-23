import { PUBLIC_API_URL, GENERATE_WAIT_TIMEOUT_MS, GENERATE_POLL_INTERVAL_MS } from '../config/env';
import { createOrReuseJob, getJobById } from './jobs.service';
import { getOrCreateSettings } from './settings.service';
import { collectImages, readOpenWebUIContext } from './images.service';
import type { DocumentType, GenerationMode } from '../types';

export const VALID_TYPES: DocumentType[] = ['PDF', 'PPTX', 'DOCX', 'XLSX'];
export const VALID_MODES: GenerationMode[] = ['auto', 'literal', 'criativo'];

/** Texto da ferramenta, compartilhado pela OpenAPI e pelo MCP. */
export const TOOL_DESCRIPTION =
  "Gera arquivos: relatorios em PDF, apresentacoes PPTX, documentos DOCX ou planilhas XLSX. " +
  "Use PPTX para apresentacoes/slides, PDF para relatorios ou para juntar imagens, DOCX para Word e XLSX para planilhas. " +
  "IMAGENS: as imagens que o usuario anexou no chat sao enviadas automaticamente — NAO coloque base64 nas instrucoes. " +
  "Repasse nas instrucoes o que o usuario disse sobre cada imagem, na ordem em que foram anexadas " +
  "(ex: 'imagem 1: fundo da capa; imagem 2: logo'). " +
  "MODO: use 'literal' quando o usuario so quer organizar o material que mandou (ex: 'coloque essas imagens num PDF', " +
  "'junte essas fotos num PPT') — nada de conteudo inventado; use 'criativo' quando ele pede um documento com conteudo " +
  "(relatorio, apresentacao sobre um tema, template). Na duvida, 'auto'. " +
  "A ferramenta demora de alguns segundos (literal) a 5 minutos (criativo). Quando responder, entregue o link de download ao usuario.";

export interface GenerateRequest {
  documentType: unknown;
  instructions: unknown;
  mode?: unknown;
  images?: unknown;
  headers: Record<string, any>;
}

export type GenerateResult =
  | { ok: true; message: string; url: string }
  | { ok: false; status: number; error: string };

/**
 * Cria (ou reaproveita) o job e ESPERA ele terminar. Esse bloqueio é o que
 * faz o chat aguardar o arquivo pronto e entregar só o link final.
 * Usado igual pela rota OpenAPI e pela ferramenta MCP — as duas passam
 * pela mesma deduplicação, então um pedido nunca vira dois arquivos.
 */
export async function generateAndWait(request: GenerateRequest): Promise<GenerateResult> {
  const documentType = String(request.documentType || '').toUpperCase() as DocumentType;
  const instructions = typeof request.instructions === 'string' ? request.instructions.trim() : '';
  const rawMode = String(request.mode || 'auto').toLowerCase() as GenerationMode;
  const mode: GenerationMode = VALID_MODES.includes(rawMode) ? rawMode : 'auto';

  if (!instructions || !VALID_TYPES.includes(documentType)) {
    return { ok: false, status: 400, error: 'Campos: documentType (PDF|PPTX|DOCX|XLSX) e instructions' };
  }

  // Imagens: as do body + as anexadas no chat do OpenWebUI (via headers).
  const settings = await getOrCreateSettings();
  const assets = await collectImages(request.images, readOpenWebUIContext(request.headers), settings);
  if (assets.length) console.log(`[Generate] ${assets.length} imagem(ns) recebida(s) para o ${documentType} (modo ${mode})`);

  const jobRecord = await createOrReuseJob(documentType, instructions, assets, mode);

  const deadline = Date.now() + GENERATE_WAIT_TIMEOUT_MS;
  let finalJob: typeof jobRecord | null = jobRecord;
  while (finalJob && finalJob.status !== 'completed' && finalJob.status !== 'failed') {
    if (Date.now() > deadline) {
      return { ok: false, status: 504, error: 'Tempo limite excedido aguardando a geração do documento.' };
    }
    await new Promise(resolve => setTimeout(resolve, GENERATE_POLL_INTERVAL_MS));
    finalJob = await getJobById(jobRecord.id);
  }

  if (finalJob?.status !== 'completed' || !finalJob.file_url) {
    return { ok: false, status: 500, error: `Falha na geracao do documento pelo XGEN: ${finalJob?.error_log || 'erro desconhecido'}` };
  }

  const url = `${PUBLIC_API_URL}${finalJob.file_url}`;
  return {
    ok: true,
    url,
    message:
      `Arquivo ${documentType} gerado com sucesso` +
      (assets.length ? ` (usando ${assets.length} imagem(ns) enviada(s) pelo usuario)` : '') +
      `. Entregue o link de download no chat para que o usuario consiga baixar o arquivo gerado: ` +
      `[Baixar ${documentType}](${url})`,
  };
}
