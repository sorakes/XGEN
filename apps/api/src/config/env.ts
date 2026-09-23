// Resolve a URL publica de API (Prod usará o valor setado no docker-compose, Dev usa o padrão abaixo)
export const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "http://host.docker.internal:3001";

export const PORT = process.env.PORT || 3001;

// URL pública do painel web (Next.js, porta 3000), onde fica o editor de PPTX.
// Sem configuração, assume o mesmo host da API trocando a porta 3001 pela 3000.
export const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL || PUBLIC_API_URL.replace(/:3001(?=\/|$)/, ':3000')).replace(/\/+$/, '');

export const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
};

export const DOCUMENT_QUEUE_NAME = 'DocumentQueue';

// Tempo máximo que /api/generate aguarda pelo job antes de responder com erro
// (ciclos de revisão + modelos mais lentos podem passar de 5min facilmente)
export const GENERATE_WAIT_TIMEOUT_MS = Number(process.env.GENERATE_WAIT_TIMEOUT_MS) || 15 * 60 * 1000; // 15 minutos
export const GENERATE_POLL_INTERVAL_MS = 3000;

// Janela de deduplicação: chamadas idênticas (mesmo tipo + instruções) dentro
// desse intervalo reaproveitam o job existente em vez de criar um novo.
export const JOB_DEDUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutos

// OpenWebUI: de onde buscar as imagens anexadas no chat. As settings do painel
// têm prioridade; estas variáveis são o fallback para quem configura via compose.
export const OPENWEBUI_URL = process.env.OPENWEBUI_URL || '';
export const OPENWEBUI_API_KEY = process.env.OPENWEBUI_API_KEY || '';

// Limites das imagens de entrada
export const MAX_IMAGES_PER_JOB = 12;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SIDE_PX = 2400;
