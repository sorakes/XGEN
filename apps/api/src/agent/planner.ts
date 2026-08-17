import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ask, extractJsonObject } from './llm';

export interface PagePlan {
  n: number;
  role: string;   // 'capa' | 'sumario' | 'capitulo' | 'dados' | 'encerramento' | ...
  title: string;
  brief: string;  // o que EXATAMENTE vai nesta página
  chart?: string; // descrição do gráfico, se esta página tiver um
}

export interface DocumentPlan {
  theme: string;
  designSystem: string; // paleta, fontes e regras visuais compartilhadas por TODAS as páginas
  docRef: string;       // código/identificação do documento, IDÊNTICO em todas as páginas
  footer: string;       // formato do rodapé, reproduzido igual em todas as páginas
  pages: PagePlan[];
}

const PLANNER_SYSTEM =
  "Você é um Diretor de Arte editorial. Responde SOMENTE com JSON válido, sem comentários, sem markdown, sem explicações.";

/**
 * Capas e páginas divisórias têm layout deliberadamente livre: não levam
 * rodapé numerado e podem ter muito espaço vazio por decisão de design.
 * Aplicar as regras de rodapé e de ocupação nelas seria errado.
 */
export function isFreeformPage(page: PagePlan): boolean {
  const role = `${page.role} ${page.title}`.toLowerCase();
  return /capa|cover|abertura|divisor|separador|contracapa|folha de rosto/.test(role);
}

export async function planDocument(model: BaseChatModel, instructions: string): Promise<DocumentPlan> {
  const prompt = `Você é o Diretor de Arte de uma revista de luxo. Vai planejar um documento A4 PÁGINA POR PÁGINA.

PEDIDO DO USUÁRIO:
"""
${instructions}
"""

TAREFA:
1. Leia o pedido e RESPEITE RIGOROSAMENTE toda exigência explícita do usuário:
   - Se ele pediu um número de páginas, o array "pages" DEVE ter EXATAMENTE esse número.
   - Se ele pediu algo numa página específica (ex: "gráfico na página 3", "conclusão na última página"),
     essa exigência DEVE aparecer no brief daquela página exata.
   - Se ele pediu capítulos nomeados, distribua-os pelas páginas na ordem pedida.
2. Se o usuário NÃO disse quantas páginas, escolha entre 4 e 8 conforme o volume de conteúdo.
3. Defina um DESIGN SYSTEM único que todas as páginas vão seguir (é o que dá coesão visual à revista).

CADA PÁGINA É UMA FOLHA A4 FECHADA (210mm x 297mm). O conteúdo do brief precisa CABER confortavelmente
nessa folha — seja realista: uma folha comporta aproximadamente 400 a 600 palavras SE não houver gráficos
ou cards. Com um gráfico grande, comporta bem menos. NÃO empilhe conteúdo demais numa página só.

Responda SOMENTE com este objeto JSON:
{
  "theme": "resumo do tema em uma linha",
  "designSystem": "Descrição precisa e AUTOSSUFICIENTE do sistema visual, que outro designer vai seguir sem ver as outras páginas. Inclua: paleta com códigos hex exatos (fundo, texto, destaque, acento), famílias tipográficas (use fontes web seguras ou Google Fonts), tratamento de títulos, estilo de cabeçalho e rodapé de página, e o estilo dos cards/blocos. Seja específico com valores.",
  "docRef": "código curto e fixo de identificação do documento, ex: 'REL-2025-001' ou 'DOC-XGEN-01'. Será repetido IDÊNTICO em todas as páginas — escolha um só.",
  "footer": "o texto EXATO do rodapé que TODAS as páginas vão reproduzir, sem variação, usando o marcador {n} para o número da página e {total} para o total. MÁXIMO DE 60 CARACTERES — precisa caber em UMA linha. Ex: 'REL-2025-001 · {n}/{total}'",
  "pages": [
    {
      "n": 1,
      "role": "capa",
      "title": "título curto desta página",
      "brief": "descrição DETALHADA do que vai nesta página: textos, números, seções, blocos. Escreva o conteúdo real, não instruções vagas.",
      "chart": "opcional — descreva o gráfico desta página (tipo, rótulos e valores reais). Omita o campo se a página não tiver gráfico."
    }
  ]
}`;

  // O plano é o alicerce do documento: se ele falhar, nada é gerado. Vale uma
  // segunda tentativa reforçando o formato antes de desistir do job inteiro.
  let plan: DocumentPlan;
  try {
    plan = extractJsonObject<DocumentPlan>(await ask(model, PLANNER_SYSTEM, prompt));
  } catch (error: any) {
    console.warn(`[Planner] JSON inválido (${error.message}). Tentando novamente...`);
    const retryPrompt =
      `${prompt}\n\n⚠️ ATENÇÃO: a resposta anterior não era JSON válido. ` +
      `Responda com JSON ESTRITO: sem markdown, sem comentários e SEM QUEBRAS DE LINHA ` +
      `dentro dos valores de texto (escreva cada valor em uma única linha).`;
    plan = extractJsonObject<DocumentPlan>(await ask(model, PLANNER_SYSTEM, retryPrompt));
  }

  if (!plan.pages?.length) throw new Error("O planner não retornou nenhuma página.");

  // Rodapé e código do documento precisam existir mesmo se a LLM omitir —
  // é o que impede cada página de inventar a própria identificação.
  plan.docRef = (plan.docRef || 'DOC-XGEN-01').trim();
  plan.footer = (plan.footer || `${plan.docRef} · {n}/{total}`).trim();

  // Rodapé longo demais quebra em duas linhas e suja o pé da página.
  // Se a LLM ignorar o limite, cai para um formato curto garantido.
  if (plan.footer.replace(/\{n\}|\{total\}/g, '00').length > 70) {
    plan.footer = `${plan.docRef} · {n}/{total}`;
  }

  // Normaliza a numeração para bater com a ordem real do array.
  plan.pages = plan.pages.map((page, index) => ({ ...page, n: index + 1 }));

  return plan;
}
