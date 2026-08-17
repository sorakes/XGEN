import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface LlmOptions {
  llmKey: string;
  modelName: string;
  provider: string;
  baseUrl?: string;
}

export function createModel({ llmKey, modelName, provider, baseUrl }: LlmOptions): BaseChatModel {
  if (provider === 'google') {
    return new ChatGoogleGenerativeAI({ apiKey: llmKey, model: modelName, temperature: 0.7 });
  }
  return new ChatOpenAI({
    apiKey: llmKey,
    temperature: 0.7,
    model: modelName,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
  });
}

export async function ask(model: BaseChatModel, system: string, user: string): Promise<string> {
  const response = await model.invoke([new SystemMessage(system), new HumanMessage(user)]);
  return response.content as string;
}

function stripFences(raw: string): string {
  return raw.replace(/```html/gi, "").replace(/```json/gi, "").replace(/```/g, "");
}

/**
 * Extrai SOMENTE o código HTML puro, removendo qualquer "pensamento",
 * explicação ou texto conversacional que a LLM colocar antes/depois.
 */
export function extractPureHtml(raw: string): string {
  const clean = stripFences(raw);

  const doctypeMatch = clean.match(/(<!DOCTYPE[\s\S]*?<\/html>)/i);
  if (doctypeMatch) return doctypeMatch[1].trim();

  const htmlMatch = clean.match(/(<html[\s\S]*?<\/html>)/i);
  if (htmlMatch) return htmlMatch[1].trim();

  const lines = clean.split('\n');
  const htmlLines: string[] = [];
  let insideHtml = false;
  for (const line of lines) {
    if (line.trim().startsWith('<') || insideHtml) {
      insideHtml = true;
      htmlLines.push(line);
    }
    if (line.includes('</html>')) break;
  }

  return htmlLines.length > 0 ? htmlLines.join('\n').trim() : clean.trim();
}

/**
 * Extrai um fragmento HTML solto (sem <html>/<body>), usado nas páginas
 * individuais — a LLM devolve só o miolo de uma página.
 */
export function extractHtmlFragment(raw: string): string {
  let clean = stripFences(raw).trim();

  // Se veio um documento completo, aproveita só o conteúdo do body.
  const bodyMatch = clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) clean = bodyMatch[1];

  // Remove qualquer prosa antes da primeira tag.
  const firstTag = clean.indexOf('<');
  if (firstTag > 0) clean = clean.slice(firstTag);

  const lastTag = clean.lastIndexOf('>');
  if (lastTag !== -1 && lastTag < clean.length - 1) clean = clean.slice(0, lastTag + 1);

  return clean.trim();
}

/** Extrai um ARRAY JSON (usado no fluxo XLSX). */
export function extractPureJson(raw: string): string {
  const clean = stripFences(raw);
  const match = clean.match(/(\[[\s\S]*\])/);
  if (match) return match[1].trim();
  return clean.trim();
}

/**
 * LLMs frequentemente quebram linha DENTRO de uma string JSON, o que é
 * sintaticamente inválido ("Bad control character in string literal").
 * Aqui escapamos esses caracteres de controle preservando a estrutura.
 */
function escapeControlCharsInStrings(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (const ch of json) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }

    const code = ch.charCodeAt(0);
    if (inString && code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  }

  return out;
}

/** Extrai um OBJETO JSON (usado no planner). */
export function extractJsonObject<T>(raw: string): T {
  const clean = stripFences(raw);
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("A LLM não retornou um objeto JSON válido no plano do documento.");

  try {
    return JSON.parse(match[0]) as T;
  } catch {
    // Segunda tentativa: corrige quebras de linha cruas dentro das strings.
    return JSON.parse(escapeControlCharsInStrings(match[0])) as T;
  }
}

/** Executa tarefas assíncronas com um teto de concorrência. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
