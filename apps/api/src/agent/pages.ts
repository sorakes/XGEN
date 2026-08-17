import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ask, extractHtmlFragment } from './llm';
import { isFreeformPage, type DocumentPlan, type PagePlan } from './planner';
import { renderDigests, type PageDigest } from './digest';

const PAGE_SYSTEM =
  "Você gera APENAS código HTML. Nunca explique, nunca comente, nunca converse. Saída pura.";

/**
 * Gera o miolo de UMA página. A página é uma caixa A4 fechada — o designer
 * desenha dentro de limites conhecidos, em vez de escrever um documento
 * corrido e torcer para a quebra de página cair num lugar bom.
 *
 * `previous` traz o que as páginas anteriores REALMENTE imprimiram, para a
 * página nova continuar o documento em vez de recomeçá-lo.
 */
export async function generatePage(
  model: BaseChatModel,
  plan: DocumentPlan,
  page: PagePlan,
  previous: PageDigest[] = [],
  repairNote?: string
): Promise<string> {
  const total = plan.pages.length;
  const neighbours = plan.pages
    .map(p => `  - Página ${p.n}: ${p.role} — ${p.title}`)
    .join('\n');
  const footer = plan.footer
    .replace(/\{n\}/g, String(page.n))
    .replace(/\{total\}/g, String(total));
  const freeform = isFreeformPage(page);

  let prompt = `Você é um Designer Editorial Sênior desenhando UMA ÚNICA PÁGINA de uma revista de luxo.

TEMA DO DOCUMENTO: ${plan.theme}

DESIGN SYSTEM OBRIGATÓRIO (idêntico em todas as páginas, é o que dá unidade à edição):
${plan.designSystem}

MAPA DA EDIÇÃO (${total} páginas no total):
${neighbours}

═══ O QUE JÁ FOI IMPRESSO NAS PÁGINAS ANTERIORES ═══
${renderDigests(previous)}
═══════════════════════════════════════════════════

CONTINUIDADE (REGRAS OBRIGATÓRIAS):
- NÃO repita conteúdo, títulos, números, frases ou blocos que já apareceram acima. O documento AVANÇA.
- Mantenha o MESMO idioma, o MESMO tom e a MESMA linguagem visual das páginas anteriores.
- CÓDIGO DO DOCUMENTO: use exatamente "${plan.docRef}" — é o mesmo em todas as páginas, nunca invente outro.
${freeform
  ? `- RODAPÉ: esta é uma página de abertura/capa — NÃO desenhe rodapé, NÃO escreva numeração de página
  e NÃO repita o código do documento no pé. Deixe o pé da página limpo.`
  : `- RODAPÉ: desenhe UM ÚNICO rodapé no pé da página, com EXATAMENTE este texto e nada mais:
  "${footer}"
  NÃO acrescente uma segunda linha de rodapé, nem outra numeração, nem outro código além desse.`}

VOCÊ ESTÁ DESENHANDO A PÁGINA ${page.n} DE ${total} — "${page.title}" (${page.role}).
CONTEÚDO DESTA PÁGINA:
${page.brief}
${page.chart ? `\nGRÁFICO DESTA PÁGINA: ${page.chart}` : ''}

REGRAS TÉCNICAS INVIOLÁVEIS:
1. FORMATO DA SAÍDA: devolva SOMENTE as tags HTML do MIOLO da página. NÃO escreva <html>, <head>, <body>,
   nem a <section class="xgen-page"> — o sistema já embrulha o seu conteúdo nela. Comece direto no conteúdo.
2. CAIXA FECHADA: a página é EXATAMENTE 210mm x 297mm (794px x 1123px) e o que passar disso — em QUALQUER
   direção — É CORTADO FORA e perdido. O conteúdo TEM que caber. Prefira sobrar espaço a estourar.
3. RESPIRO: use padding generoso nas bordas da página (no mínimo 14mm de cada lado). Nada de texto colado na borda.
4. TAILWIND: as classes do TailwindCSS estão disponíveis (o sistema já carrega o CDN). NÃO inclua a tag de script.
5. DIMENSÕES — REGRA CRÍTICA: seu bloco raiz DEVE ser \`w-full h-full\`.
   É PROIBIDO usar unidades de viewport ou larguras fixas maiores que a folha:
   nada de \`w-screen\`, \`h-screen\`, \`min-h-screen\`, \`100vw\`, \`100vh\`, \`vw\`, \`vh\`,
   e nada de larguras fixas em px (ex: width: 900px) — elas estouram a lateral da página e o texto é cortado.
   Use SEMPRE larguras relativas (w-full, %, flex, grid) e margens/paddings em mm ou rem.
   NUNCA use margens negativas para "furar" a borda da página.
6. GRÁFICOS: se esta página tem gráfico, use Chart.js (o sistema já carrega o CDN — não inclua a tag de script).
   Crie <canvas id="chart-p${page.n}"></canvas> dentro de um contêiner com ALTURA FIXA em mm ou px
   (ex: style="height: 70mm") e instancie logo abaixo com <script>new Chart(document.getElementById('chart-p${page.n}'), {...})</script>.
   Use dados reais e concretos. É PROIBIDO usar quickchart.io ou qualquer imagem externa de gráfico.
7. SEM IMAGENS EXTERNAS: nada de Unsplash, Pexels ou URLs de foto. Componha com tipografia, cor e forma.
8. RODAPÉ: siga exatamente o que a seção CONTINUIDADE acima determinou sobre o rodapé desta página.
${freeform
  ? `9. COMPOSIÇÃO: por ser uma abertura, o espaço vazio é bem-vindo — use-o como elemento de design.`
  : `9. OCUPAÇÃO: o conteúdo deve descer até perto do pé da página (ocupando no mínimo 75% da altura útil).
   Sobrar um vazio enorme embaixo é tão ruim quanto estourar. Se o conteúdo for curto, aumente
   espaçamentos, tamanhos de fonte, altura de gráficos e cards até a página ficar visualmente equilibrada.`}`;

  if (repairNote) {
    prompt += `\n\n⚠️ CORREÇÃO OBRIGATÓRIA: ${repairNote}`;
  }

  const raw = await ask(model, PAGE_SYSTEM, prompt);
  return extractHtmlFragment(raw);
}
