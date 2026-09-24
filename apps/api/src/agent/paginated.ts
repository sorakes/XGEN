import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { mapLimit } from './llm';
import { planDocument, isFreeformPage, type DocumentPlan } from './planner';
import { generatePage } from './pages';
import { assembleDocument } from './assemble';
import { digestPage, type PageDigest } from './digest';
import { SHEETS } from './format';
import { reviewPagesVisually } from './review';
import { measurePageOverflow, type PageOverflow } from '../converters';
import type { DetailLevel, ImageInsight, PageFormat } from '../types';

export type ProgressCallback = (step: string) => Promise<void>;

/** Concorrência usada só nos REPAROS (a geração inicial é sequencial). */
const REPAIR_CONCURRENCY = 3;

/** Tolerância de transbordo em px — abaixo disso não vale regerar a página. */
const OVERFLOW_TOLERANCE_PX = 4;

export interface PaginatedOptions {
  format: PageFormat;
  images?: ImageInsight[];
  detailLevel?: DetailLevel | null;
  visualReview?: boolean;
  onProgress?: ProgressCallback;
}

/**
 * Fluxo paginado do PDF (folhas A4) e do PPTX (slides 16:9).
 *
 * Em vez de gerar um HTML corrido e deixar o Puppeteer decidir onde cortar
 * (o que fazia blocos e gráficos serem partidos ao meio), aqui cada página é
 * uma caixa fechada, desenhada individualmente. Depois medimos o transbordo
 * real de cada uma no browser — e se as imagens ficaram nítidas e visíveis —
 * e regeneramos SÓ as que têm defeito.
 *
 * A geração é SEQUENCIAL de propósito: cada página recebe o resumo do que as
 * anteriores realmente imprimiram. Gerando em paralelo, as páginas não se
 * enxergavam e o documento saía com rodapés divergentes e conteúdo repetido.
 */
export async function runPaginatedAgent(
  model: BaseChatModel,
  instructions: string,
  maxRetries: number,
  options: PaginatedOptions
): Promise<string> {
  const { format, images = [], detailLevel = null, visualReview = false, onProgress } = options;
  const sheet = SHEETS[format];
  const noun = format === 'SLIDE' ? 'slide' : 'página';

  const report = async (step: string) => {
    console.log(`[Agent] ${step}`);
    if (onProgress) await onProgress(step);
  };

  await report(format === 'SLIDE' ? 'Planejando os slides...' : 'Planejando as páginas...');
  const plan = await planDocument(model, instructions, format, images, detailLevel);
  const total = plan.pages.length;
  await report(`Plano pronto: ${total} ${noun}s. Desenhando...`);

  // Sequencial: a página N enxerga o que as páginas 1..N-1 imprimiram.
  const pageHtmls: string[] = [];
  const digests: PageDigest[] = [];
  for (const page of plan.pages) {
    await report(`Desenhando ${noun} ${page.n}/${total} — ${page.title}`);
    const pageHtml = await generatePage(model, plan, page, digests, undefined, images);
    pageHtmls.push(pageHtml);
    digests.push(digestPage(page.n, page.title, pageHtml));
  }

  const redraw = async (index: number, repairNote: string) => {
    const pagePlan = plan.pages[index - 1];
    if (!pagePlan) return;
    // O reparo enxerga as páginas ANTERIORES (não a si mesma), para a
    // correção não quebrar a continuidade já estabelecida.
    const context = digests.filter(d => d.n < index);
    const fixed = await generatePage(model, plan, pagePlan, context, repairNote, images);
    pageHtmls[index - 1] = fixed;
    digests[index - 1] = digestPage(pagePlan.n, pagePlan.title, fixed);
  };

  let html = await validateAndRepair({ plan, pageHtmls, images, maxRetries, report, redraw });

  // --- Crítica visual opcional (olha o render de verdade) ---
  if (visualReview) {
    await report('Revisão visual das páginas...');
    try {
      const critiques = await reviewPagesVisually(model, html, plan);
      if (critiques.length) {
        await report(`Refinando ${critiques.length} ${noun}(s) após revisão visual`);
        await mapLimit(critiques, REPAIR_CONCURRENCY, async c => {
          const before = pageHtmls[c.index - 1];
          await redraw(c.index, `Um diretor de arte olhou a ${noun} renderizada e apontou: ${c.critique}. Corrija esses pontos.`);
          // Só aceita o refinamento se ele não criar transbordo.
          const check = await measurePageOverflow(assembleDocument(plan, pageHtmls, images), format).catch(() => null);
          const page = check?.[c.index - 1];
          if (page && (page.overflowY > OVERFLOW_TOLERANCE_PX || page.overflowX > OVERFLOW_TOLERANCE_PX)) {
            pageHtmls[c.index - 1] = before;
          }
        });
        html = assembleDocument(plan, pageHtmls, images);
      }
    } catch (error: any) {
      console.warn(`[Agent] Revisão visual falhou (${error.message}), seguindo sem ela.`);
    }
  }

  return html;
}

export interface RepairOptions {
  plan: DocumentPlan;
  pageHtmls: string[];
  images: ImageInsight[];
  maxRetries: number;
  report: (step: string) => Promise<void>;
  /** Redesenha a página `index` (1-based) aplicando a nota de correção. */
  redraw: (index: number, repairNote: string) => Promise<void>;
  /** Só estas páginas podem ser redesenhadas (revisão: as que o usuário mandou mudar). */
  onlyPages?: Set<number>;
}

/**
 * Ciclo de correção guiado por MEDIÇÃO, não por opinião: mede cada página no
 * browser e redesenha só as que têm defeito. Usado na geração e na revisão.
 */
export async function validateAndRepair(options: RepairOptions): Promise<string> {
  const { plan, pageHtmls, images, maxRetries, report, redraw, onlyPages } = options;
  const format = plan.format;
  const sheet = SHEETS[format];
  const noun = format === 'SLIDE' ? 'slide' : 'página';
  let html = assembleDocument(plan, pageHtmls, images);

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
    await report(`Validando diagramação (${attempt}/${maxRetries})`);

    let overflows: PageOverflow[];
    try {
      overflows = await measurePageOverflow(html, format);
    } catch (error) {
      console.error('[Agent] Falha ao medir transbordo, seguindo com o layout atual:', error);
      break;
    }

    console.log(
      '[Agent] Métricas:',
      overflows
        .map(o =>
          `p${o.index}(y:${o.overflowY} x:${o.overflowX} fill:${Math.round(o.fillRatio * 100)}%` +
          `${o.zoneOverlaps.length ? ` sobre-fundo:${o.zoneOverlaps.length}` : ''}` +
          `${o.imageIssues.length ? ` img:${o.imageIssues.map(i => `${i.id}=${i.problem}`).join(',')}` : ''})`
        )
        .join(' ')
    );

    const problemsByPage = overflows
      .filter(o => !onlyPages || onlyPages.has(o.index))
      .map(o => ({ o, problems: describeProblems(o, plan, sheet.minFillRatio) }))
      .filter(x => x.problems.length > 0);

    if (problemsByPage.length === 0) {
      await report('Diagramação aprovada ✅');
      break;
    }

    if (attempt === maxRetries) {
      console.log(`[Agent] ⚠️ Limite de correções atingido. ${problemsByPage.length} ${noun}(s) ainda com defeito.`);
      break;
    }

    await report(`Ajustando ${problemsByPage.length} ${noun}(s) fora do padrão`);

    await mapLimit(problemsByPage, REPAIR_CONCURRENCY, async ({ o, problems }) => {
      const repairNote =
        `Na versão anterior desta ${noun}: ${problems.join('; e ')}. ` +
        `Redesenhe a ${noun} inteira corrigindo isso, mantendo o mesmo design system e o mesmo assunto.`;
      await redraw(o.index, repairNote);
    });

    html = assembleDocument(plan, pageHtmls, images);
  }
  return html;
}

/** Traduz as medições de uma página em instruções concretas de correção. */
function describeProblems(info: PageOverflow, plan: DocumentPlan, minFillRatio: number): string[] {
  const pagePlan = plan.pages[info.index - 1];
  if (!pagePlan) return [];
  const u = SHEETS[plan.format].unit;
  const problems: string[] = [];

  if (info.overflowY > OVERFLOW_TOLERANCE_PX) {
    const excess = Math.ceil((info.overflowY / info.pageHeight) * 100);
    problems.push(
      `o conteúdo passou ${info.overflowY}px da ALTURA (cerca de ${excess}% a mais que o disponível). ` +
      `Corrija com MENOS conteúdo: reduza textos, tamanhos de fonte, paddings verticais ` +
      `e a altura de gráficos/cards/imagens`
    );
  }

  if (info.overflowX > OVERFLOW_TOLERANCE_PX) {
    problems.push(
      `o conteúdo passou ${info.overflowX}px da LARGURA (a área tem ${info.pageWidth}px), ` +
      `então foi CORTADO NAS LATERAIS. Isso quase sempre vem de largura fixa em px, ` +
      `w-screen/100vw, margem negativa, grid com colunas largas demais ou tabela larga. ` +
      `Refaça usando APENAS larguras relativas (w-full, %, flex, grid) dentro de um raiz \`w-full h-full\``
    );
  }

  if (
    !isFreeformPage(pagePlan) &&
    info.fillRatio < minFillRatio &&
    info.overflowY <= OVERFLOW_TOLERANCE_PX
  ) {
    const used = Math.round(info.fillRatio * 100);
    problems.push(
      `o conteúdo ocupou apenas ${used}% da altura, deixando um VAZIO GRANDE embaixo. ` +
      `Preencha melhor (alvo: o conteúdo descer até cerca de 90% da altura): ` +
      `aumente espaçamentos entre seções, tamanhos de fonte, altura de gráficos, imagens e cards, ` +
      `ou desenvolva mais o conteúdo previsto. ATENÇÃO: mesmo preenchendo mais, NÃO pode ultrapassar a área`
    );
  }

  if (info.zoneOverlaps?.length) {
    const hits = info.zoneOverlaps.map(o => `"${o.text}" (área ${o.zone})`).join(', ');
    problems.push(
      `textos ficaram EM CIMA do logo/elementos já desenhados na imagem de fundo: ${hits}. ` +
      `Mova esses textos para fora dessas áreas (abaixo ou ao lado delas) — o fundo deve continuar visível`
    );
  }

  // Imagens planejadas para esta página que não apareceram no render.
  for (const planned of pagePlan.images || []) {
    if (!info.imagesPresent.includes(planned.id)) {
      problems.push(
        planned.role === 'background'
          ? `a imagem de fundo ${planned.id} ficou escondida — o bloco raiz não pode ter fundo opaco, deixe-o transparente e use um véu semitransparente para o texto`
          : `a imagem ${planned.id} NÃO apareceu — inclua <img data-xgen-img="${planned.id}"> num contêiner com largura e altura definidas`
      );
    }
  }

  for (const issue of info.imageIssues) {
    if (issue.problem === 'pixelated') {
      problems.push(
        `a imagem ${issue.id} foi ampliada demais e vai ficar PIXELADA (desenhada com ${issue.renderedWidth}x${issue.renderedHeight}px, ` +
        `mas o arquivo só tem ${issue.naturalWidth}x${issue.naturalHeight}px). Reduza o contêiner dela para no máximo ` +
        `~${issue.maxSharpWidth}px de largura (e altura proporcional), usando o espaço liberado para texto ou respiro`
      );
    } else if (issue.problem === 'too_small') {
      problems.push(
        `a imagem ${issue.id} ficou pequena demais (${issue.renderedWidth}x${issue.renderedHeight}px) para ser vista — ` +
        `dê a ela um contêiner maior, com altura definida em ${u}`
      );
    } else if (issue.problem === 'clipped') {
      problems.push(
        `a imagem ${issue.id} ficou parcialmente FORA da área visível — posicione-a inteira dentro da página`
      );
    } else if (issue.problem === 'cropped') {
      const ratio = (issue.naturalWidth / issue.naturalHeight).toFixed(2);
      problems.push(
        `a imagem ${issue.id} teve ${Math.round((issue.cropRatio ?? 0) * 100)}% do conteúdo CORTADO porque o contêiner dela ` +
        `(${issue.renderedWidth}x${issue.renderedHeight}px) tem proporção diferente da imagem (${ratio}). ` +
        `Dê ao contêiner a MESMA proporção da imagem (largura/altura ≈ ${ratio}), ex: style="aspect-ratio: ${issue.naturalWidth} / ${issue.naturalHeight}"`
      );
    } else if (issue.problem === 'not_loaded') {
      problems.push(`a imagem ${issue.id} não carregou — use exatamente <img data-xgen-img="${issue.id}"> sem src`);
    }
  }

  return problems;
}
