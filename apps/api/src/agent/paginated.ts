import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { mapLimit } from './llm';
import { planDocument, isFreeformPage } from './planner';
import { generatePage } from './pages';
import { assembleDocument } from './assemble';
import { digestPage, type PageDigest } from './digest';
import { measurePageOverflow } from '../converters';

export type ProgressCallback = (step: string) => Promise<void>;

/** Concorrência usada só nos REPAROS (a geração inicial é sequencial). */
const REPAIR_CONCURRENCY = 3;

/** Tolerância de transbordo em px — abaixo disso não vale regerar a página. */
const OVERFLOW_TOLERANCE_PX = 4;

/**
 * Ocupação mínima da altura da folha para uma página de conteúdo.
 * Abaixo disso a página ficou com um vazio grande no pé e merece ser refeita.
 * Capas e divisórias são isentas (ver isFreeformPage).
 */
const MIN_FILL_RATIO = 0.72;

/**
 * Fluxo paginado do PDF.
 *
 * Em vez de gerar um HTML corrido e deixar o Puppeteer decidir onde cortar
 * (o que fazia blocos e gráficos serem partidos ao meio), aqui cada página é
 * uma caixa A4 fechada, desenhada individualmente. Depois medimos o transbordo
 * real de cada uma no browser e regeneramos SÓ as que estouraram.
 *
 * A geração é SEQUENCIAL de propósito: cada página recebe o resumo do que as
 * anteriores realmente imprimiram. Gerando em paralelo, as páginas não se
 * enxergavam e o documento saía com rodapés divergentes e conteúdo repetido.
 */
export async function runPaginatedPdfAgent(
  model: BaseChatModel,
  instructions: string,
  maxRetries: number,
  onProgress?: ProgressCallback
): Promise<string> {
  const report = async (step: string) => {
    console.log(`[Agent] ${step}`);
    if (onProgress) await onProgress(step);
  };

  await report('Planejando as páginas...');
  const plan = await planDocument(model, instructions);
  const total = plan.pages.length;
  await report(`Plano pronto: ${total} páginas. Desenhando...`);

  // Sequencial: a página N enxerga o que as páginas 1..N-1 imprimiram.
  const pageHtmls: string[] = [];
  const digests: PageDigest[] = [];
  for (const page of plan.pages) {
    await report(`Desenhando página ${page.n}/${total} — ${page.title}`);
    const pageHtml = await generatePage(model, plan, page, digests);
    pageHtmls.push(pageHtml);
    digests.push(digestPage(page.n, page.title, pageHtml));
  }

  let html = assembleDocument(plan, pageHtmls);

  // --- Ciclo de correção guiado por MEDIÇÃO, não por opinião ---
  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
    await report(`Validando diagramação (${attempt}/${maxRetries})`);

    let overflows;
    try {
      overflows = await measurePageOverflow(html);
    } catch (error) {
      console.error('[Agent] Falha ao medir transbordo, seguindo com o layout atual:', error);
      break;
    }

    console.log(
      '[Agent] Métricas:',
      overflows
        .map(o => `p${o.index}(y:${o.overflowY} x:${o.overflowX} fill:${Math.round(o.fillRatio * 100)}%)`)
        .join(' ')
    );

    const broken = overflows.filter(o => {
      const pagePlan = plan.pages[o.index - 1];
      const overflowed =
        o.overflowY > OVERFLOW_TOLERANCE_PX || o.overflowX > OVERFLOW_TOLERANCE_PX;
      // Vazio excessivo só é defeito em página de conteúdo: numa capa o
      // espaço em branco é decisão de design, não erro.
      const underfilled =
        !!pagePlan && !isFreeformPage(pagePlan) && o.fillRatio < MIN_FILL_RATIO;
      return overflowed || underfilled;
    });
    if (broken.length === 0) {
      await report('Diagramação aprovada ✅');
      break;
    }

    if (attempt === maxRetries) {
      console.log(`[Agent] ⚠️ Limite de correções atingido. ${broken.length} página(s) ainda transbordam.`);
      break;
    }

    await report(`Ajustando ${broken.length} página(s) fora do padrão`);

    await mapLimit(broken, REPAIR_CONCURRENCY, async info => {
      const pagePlan = plan.pages[info.index - 1];
      if (!pagePlan) return;

      const problems: string[] = [];

      if (info.overflowY > OVERFLOW_TOLERANCE_PX) {
        const excess = Math.ceil((info.overflowY / info.pageHeight) * 100);
        problems.push(
          `passou ${info.overflowY}px da ALTURA da folha (cerca de ${excess}% a mais que o disponível). ` +
          `Corrija com MENOS conteúdo: reduza textos, tamanhos de fonte, paddings verticais ` +
          `e a altura de gráficos/cards`
        );
      }

      if (info.overflowX > OVERFLOW_TOLERANCE_PX) {
        problems.push(
          `passou ${info.overflowX}px da LARGURA da folha (a folha tem ${info.pageWidth}px), ` +
          `então o conteúdo foi CORTADO NAS LATERAIS. Isso quase sempre vem de largura fixa em px, ` +
          `w-screen/100vw, margem negativa, grid com colunas largas demais ou tabela larga. ` +
          `Refaça usando APENAS larguras relativas (w-full, %, flex, grid) dentro de um raiz \`w-full h-full\`, ` +
          `com padding lateral de no mínimo 14mm`
        );
      }

      if (
        !isFreeformPage(pagePlan) &&
        info.fillRatio < MIN_FILL_RATIO &&
        info.overflowY <= OVERFLOW_TOLERANCE_PX
      ) {
        const used = Math.round(info.fillRatio * 100);
        problems.push(
          `ocupou apenas ${used}% da altura da folha, deixando um VAZIO GRANDE no pé da página. ` +
          `Refaça preenchendo melhor a folha (alvo: o conteúdo descer até cerca de 90% da altura): ` +
          `aumente espaçamentos entre seções, tamanhos de fonte, altura de gráficos e cards, ` +
          `ou desenvolva mais o conteúdo previsto para esta página. ` +
          `ATENÇÃO: mesmo preenchendo mais, o conteúdo NÃO pode ultrapassar a folha`
        );
      }

      if (problems.length === 0) return;

      const repairNote =
        `Na versão anterior desta página o conteúdo ${problems.join('; e ')}. ` +
        `Redesenhe a página inteira corrigindo isso, mantendo o mesmo design system e o mesmo assunto.`;

      // O reparo enxerga as páginas ANTERIORES (não a si mesma), para a
      // correção não quebrar a continuidade já estabelecida.
      const context = digests.filter(d => d.n < info.index);
      const fixed = await generatePage(model, plan, pagePlan, context, repairNote);

      pageHtmls[info.index - 1] = fixed;
      digests[info.index - 1] = digestPage(pagePlan.n, pagePlan.title, fixed);
    });

    html = assembleDocument(plan, pageHtmls);
  }

  return html;
}
