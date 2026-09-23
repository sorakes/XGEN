import { PUBLIC_API_URL, PUBLIC_WEB_URL, GENERATE_WAIT_TIMEOUT_MS, GENERATE_POLL_INTERVAL_MS } from '../config/env';
import { createOrReuseJob, getJobById } from './jobs.service';
import { getOrCreateSettings, resolveLlmProvider } from './settings.service';
import { collectImages, readOpenWebUIContext } from './images.service';
import { createModel } from '../agent/llm';
import { resolveIntent } from '../agent/intent';
import type { DetailLevel, DocumentType, GenerationBrief, GenerationMode, ImageSource, Settings } from '../types';

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
  "PREFERENCIAS: antes de gerar um documento com conteudo, o usuario precisa ter dito o NIVEL (detailLevel: 'simples' ou 'avancado') " +
  "e as IMAGENS (imageSource: 'nenhuma', 'enviadas' = so as anexadas, 'banco' = fotos reais do Pexels, 'ia' = geradas por IA; " +
  "extraImages = quantas buscar/gerar ALEM das anexadas). Se ele nao disse, a ferramenta devolve as perguntas: faca-as ao usuario " +
  "e chame de novo com as respostas. Se ele anexou imagens e pediu 'gere mais 5', use imageSource 'ia' e extraImages 5. " +
  "A ferramenta demora de alguns segundos (literal) a 5 minutos (criativo). Quando responder com links, entregue-os ao usuario.";

const MAX_EXTRA_IMAGES = 8;

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Lê as preferências do documento, aceitando variações que as LLMs costumam mandar. */
export function parseBrief(request: { detailLevel?: unknown; imageSource?: unknown; extraImages?: unknown }): GenerationBrief {
  const d = normalize(request.detailLevel);
  const detailLevel: DetailLevel | null =
    /^(simples|simple|basico|basic|curto|resumido)/.test(d) ? 'simples'
    : /^(avancado|advanced|completo|detalhado|elaborado)/.test(d) ? 'avancado'
    : null;

  const s = normalize(request.imageSource);
  const imageSource: ImageSource | null =
    /^(nenhuma|none|sem|no)/.test(s) ? 'nenhuma'
    : /^(enviadas|anexadas|user|minhas|proprias)/.test(s) ? 'enviadas'
    : /^(banco|pexels|stock|fotos)/.test(s) ? 'banco'
    : /^(ia|ai|gerar|geradas|generated)/.test(s) ? 'ia'
    : null;

  let extraImages = Math.round(Number(request.extraImages) || 0);
  extraImages = Math.max(0, Math.min(MAX_EXTRA_IMAGES, extraImages));
  if (imageSource === 'banco' || imageSource === 'ia') {
    if (extraImages === 0) extraImages = 4; // pediu imagens mas não disse quantas
  } else {
    extraImages = 0;
  }
  return { detailLevel, imageSource, extraImages };
}

function aiImagesAvailable(settings: Settings): boolean {
  if (settings.active_image === 'gemini') return !!settings.gemini_img_key;
  if (settings.active_image === 'comfyui') return !!(settings.comfyui_url && settings.comfyui_workflow);
  return !!settings.openrouter_key;
}

/**
 * Texto devolvido ao chat quando faltam preferências: o modelo do chat faz
 * as perguntas ao usuário e chama a ferramenta de novo com as respostas.
 */
function questionsFor(documentType: DocumentType, userImages: number, brief: GenerationBrief, settings: Settings): string {
  const unit = documentType === 'PPTX' ? 'slides' : 'páginas';
  const questions: string[] = [];
  if (!brief.detailLevel) {
    questions.push(
      `**Nível:** simples (cerca de 4 a 5 ${unit}, direto ao ponto) ou avançado (cerca de 8 a 12 ${unit}, com mais dados, gráficos e detalhes)?`
    );
  }
  if (!brief.imageSource) {
    const sources: string[] = [];
    if (settings.pexels_key) sources.push('fotos reais de um banco de imagens');
    if (aiImagesAvailable(settings)) sources.push('imagens geradas por IA');
    const from = sources.length ? ` e de onde: ${sources.join(' ou ')}` : '';
    questions.push(userImages
      ? `**Imagens:** recebi ${userImages} imagem(ns) anexada(s). Usar só elas, ou acrescentar mais? Se quiser mais, quantas (até ${MAX_EXTRA_IMAGES})${from}?`
      : `**Imagens:** quer imagens no documento? Pode ser sem imagens${sources.length ? `, ${sources.join(', ')}` : ''} — e, se quiser, quantas (até ${MAX_EXTRA_IMAGES})? Também dá para anexar suas próprias imagens na conversa.`);
  }
  return (
    `ANTES DE GERAR, pergunte ao usuário (de forma curta e amigável, em uma única mensagem) e NÃO chame generate_document de novo até ele responder:\n\n` +
    questions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
    `\n\nQuando ele responder, chame generate_document novamente com o MESMO documentType e instructions, preenchendo ` +
    `detailLevel ("simples" ou "avancado"), imageSource ("nenhuma", "enviadas", "banco" ou "ia") e extraImages ` +
    `(quantas imagens buscar/gerar além das anexadas; 0 se nenhuma).`
  );
}

export interface GenerateRequest {
  documentType: unknown;
  instructions: unknown;
  mode?: unknown;
  images?: unknown;
  detailLevel?: unknown;
  imageSource?: unknown;
  extraImages?: unknown;
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

  // Preferências do documento. Se faltarem, o chat pergunta ao usuário antes
  // de gerar — exceto em planilhas e em pedidos literais ("coloque essas
  // imagens num PDF"), que não têm nível nem escolha de imagens a fazer.
  const brief = parseBrief(request);
  let effectiveMode = mode;
  if (documentType !== 'XLSX' && mode !== 'literal' && (!brief.detailLevel || !brief.imageSource)) {
    let literal = false;
    if (mode === 'auto' && assets.length) {
      try {
        const { llmKey, llmModel, provider, llmBaseUrl } = resolveLlmProvider(settings);
        const model = createModel({ llmKey, modelName: llmModel, provider, baseUrl: llmBaseUrl });
        literal = (await resolveIntent(model, instructions, assets.length, 'auto')).mode === 'literal';
      } catch { /* sem LLM configurada: pergunta mesmo assim */ }
    }
    if (!literal) {
      console.log(`[Generate] Faltam preferências (nível=${brief.detailLevel}, imagens=${brief.imageSource}): devolvendo perguntas ao chat`);
      return { ok: true, url: '', message: questionsFor(documentType, assets.length, brief, settings) };
    }
    effectiveMode = 'literal';
  }

  const jobRecord = await createOrReuseJob(documentType, instructions, assets, effectiveMode, brief);

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
  const imageNotes: string[] = [];
  if (assets.length) imageNotes.push(`${assets.length} imagem(ns) enviada(s) pelo usuario`);
  if (brief.extraImages && (brief.imageSource === 'banco' || brief.imageSource === 'ia')) {
    imageNotes.push(`${brief.extraImages} imagem(ns) ${brief.imageSource === 'banco' ? 'de banco de fotos' : 'gerada(s) por IA'} pedida(s)`);
  }
  const done = `Arquivo ${documentType} gerado com sucesso` + (imageNotes.length ? ` (${imageNotes.join(' + ')})` : '');

  if (documentType === 'PPTX') {
    const editorUrl = `${PUBLIC_WEB_URL}/editor/${finalJob.id}`;
    return {
      ok: true,
      url,
      message:
        `${done}. Entregue os DOIS links abaixo no chat, exatamente assim, para o usuario baixar ou editar a apresentacao:
` +
        `[Baixar ${documentType}](${url}) · [Editar apresentacao](${editorUrl})`,
    };
  }

  return {
    ok: true,
    url,
    message: `${done}. Entregue o link de download no chat para que o usuario consiga baixar o arquivo gerado: [Baixar ${documentType}](${url})`,
  };
}
