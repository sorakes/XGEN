import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ask, extractHtmlFragment } from './llm';
import { isFreeformPage, type DocumentPlan, type PagePlan } from './planner';
import { renderDigests, type PageDigest } from './digest';
import { SHEETS, fitsSheet } from './format';
import { fitFor } from './vision';
import type { ImageInsight } from '../types';

const PAGE_SYSTEM =
  "Você gera APENAS código HTML. Nunca explique, nunca comente, nunca converse. Saída pura.";

/**
 * Gera o miolo de UMA página. A página é uma caixa fechada (A4 ou slide) — o
 * designer desenha dentro de limites conhecidos, em vez de escrever um
 * documento corrido e torcer para a quebra de página cair num lugar bom.
 *
 * `previous` traz o que as páginas anteriores REALMENTE imprimiram, para a
 * página nova continuar o documento em vez de recomeçá-lo.
 */
export async function generatePage(
  model: BaseChatModel,
  plan: DocumentPlan,
  page: PagePlan,
  previous: PageDigest[] = [],
  repairNote?: string,
  images: ImageInsight[] = []
): Promise<string> {
  const sheet = SHEETS[plan.format];
  const isSlide = plan.format === 'SLIDE';
  const noun = isSlide ? 'SLIDE' : 'PÁGINA';
  const total = plan.pages.length;
  const neighbours = plan.pages
    .map(p => `  - ${isSlide ? 'Slide' : 'Página'} ${p.n}: ${p.role} — ${p.title}`)
    .join('\n');
  const footer = plan.footer
    .replace(/\{n\}/g, String(page.n))
    .replace(/\{total\}/g, String(total));
  const freeform = isFreeformPage(page);
  const u = sheet.unit;

  let prompt = `Você é um Designer Editorial Sênior desenhando ${isSlide ? 'UM ÚNICO SLIDE de uma apresentação premium' : 'UMA ÚNICA PÁGINA de uma revista de luxo'}.

TEMA DO DOCUMENTO: ${plan.theme}

DESIGN SYSTEM OBRIGATÓRIO (idêntico em todas as ${isSlide ? 'telas' : 'páginas'}, é o que dá unidade à edição):
${plan.designSystem}

MAPA DA EDIÇÃO (${total} no total):
${neighbours}

═══ O QUE JÁ FOI IMPRESSO ANTES ═══
${renderDigests(previous)}
═══════════════════════════════════

CONTINUIDADE (REGRAS OBRIGATÓRIAS):
- NÃO repita conteúdo, títulos, números, frases ou blocos que já apareceram acima. O documento AVANÇA.
- IDIOMA: escreva tudo em ${plan.language}.
- Mantenha o MESMO tom e a MESMA linguagem visual das anteriores.
- NÃO invente dados específicos (métricas, clientes, preços, nomes, e-mails, telefones): use marcadores entre colchetes, ex: [00%].
- CÓDIGO DO DOCUMENTO: use exatamente "${plan.docRef}" — é o mesmo em todas, nunca invente outro.
${freeform
  ? `- RODAPÉ: esta é uma abertura/capa — NÃO desenhe rodapé, NÃO escreva numeração
  e NÃO repita o código do documento no pé. Deixe o pé limpo.`
  : `- RODAPÉ: desenhe UM ÚNICO rodapé discreto no pé, com EXATAMENTE este texto e nada mais:
  "${footer}"
  NÃO acrescente uma segunda linha de rodapé, nem outra numeração, nem outro código além desse.`}

VOCÊ ESTÁ DESENHANDO ${isSlide ? 'O SLIDE' : 'A PÁGINA'} ${page.n} DE ${total} — "${page.title}" (${page.role}).
CONTEÚDO:
${page.brief}
${page.chart ? `\nGRÁFICO: ${page.chart}` : ''}
${renderImageRules(page, images, plan)}
REGRAS TÉCNICAS INVIOLÁVEIS:
1. FORMATO DA SAÍDA: devolva SOMENTE as tags HTML do MIOLO. NÃO escreva <html>, <head>, <body>,
   nem a <section class="xgen-page"> — o sistema já embrulha o seu conteúdo nela. Comece direto no conteúdo.
2. CAIXA FECHADA: ${sheet.label}. O que passar disso — em QUALQUER direção — É CORTADO FORA e perdido.
   O conteúdo TEM que caber. Prefira sobrar espaço a estourar.
3. RESPIRO: padding generoso nas bordas (no mínimo ${sheet.minPadding} de cada lado). Nada colado na borda.
4. TAILWIND: as classes do TailwindCSS estão disponíveis (o sistema já carrega o CDN). NÃO inclua a tag de script.
   Google Fonts: pode incluir <link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet"> no início.
5. DIMENSÕES — REGRA CRÍTICA: seu bloco raiz DEVE ser \`w-full h-full\`.
   É PROIBIDO usar unidades de viewport ou larguras fixas maiores que a ${isSlide ? 'tela' : 'folha'}:
   nada de \`w-screen\`, \`h-screen\`, \`min-h-screen\`, \`100vw\`, \`100vh\`, \`vw\`, \`vh\`,
   e nada de larguras fixas grandes em px. Use larguras relativas (w-full, %, flex, grid) e margens/paddings em ${u} ou rem.
   NUNCA use margens negativas para "furar" a borda.
6. GRÁFICOS: se houver gráfico, use Chart.js (o sistema já carrega o CDN — não inclua a tag de script).
   Crie <canvas id="chart-p${page.n}"></canvas> dentro de um contêiner com ALTURA FIXA em ${u}
   (ex: style="height: ${isSlide ? '520px' : '70mm'}") e instancie logo abaixo com <script>new Chart(document.getElementById('chart-p${page.n}'), {...})</script>.
   Use dados reais e concretos. É PROIBIDO usar quickchart.io ou qualquer imagem externa de gráfico.
7. SEM IMAGENS EXTERNAS: nada de Unsplash, Pexels ou URLs de foto${images.length ? ' — só as imagens do usuário, pelos marcadores indicados acima' : '. Componha com tipografia, cor e forma'}.
8. RODAPÉ: siga exatamente o que a seção CONTINUIDADE determinou.
${freeform
  ? `9. COMPOSIÇÃO: por ser uma abertura, o espaço vazio é bem-vindo — use-o como elemento de design.`
  : isSlide
    ? `9. COMPOSIÇÃO: distribua o conteúdo pela tela inteira com equilíbrio — nada de tudo espremido no topo
   com metade da tela vazia embaixo. Tipografia grande (título ≥ 56px, texto ≥ 26px).`
    : `9. OCUPAÇÃO: o conteúdo deve descer até perto do pé da página (ocupando no mínimo 75% da altura útil).
   Sobrar um vazio enorme embaixo é tão ruim quanto estourar. Se o conteúdo for curto, aumente
   espaçamentos, tamanhos de fonte, altura de gráficos, imagens e cards até a página ficar equilibrada.`}`;

  if (repairNote) {
    prompt += `\n\n⚠️ CORREÇÃO OBRIGATÓRIA: ${repairNote}`;
  }

  const raw = await ask(model, PAGE_SYSTEM, prompt);
  return extractHtmlFragment(raw);
}

/** Áreas ocupadas do fundo, em px da folha (o fundo pronto tem a mesma proporção). */
function renderZones(info: ImageInsight, plan: DocumentPlan): string[] {
  if (!info.zones?.length) return [];
  const sheet = SHEETS[plan.format];
  const px = (pct: number, total: number) => Math.round((pct / 100) * total);
  return [
    `  • ÁREAS OCUPADAS pelo fundo — NENHUM texto, card ou elemento seu pode ficar dentro delas`,
    `    (coordenadas em px a partir do canto superior esquerdo da folha ${sheet.widthPx}x${sheet.heightPx}):`,
    ...info.zones.map(z =>
      `    - x ${px(z.x, sheet.widthPx)} a ${px(z.x + z.w, sheet.widthPx)}, y ${px(z.y, sheet.heightPx)} a ${px(z.y + z.h, sheet.heightPx)}`
    ),
    `    Ex: se há um logo no canto superior esquerdo, comece seu título ABAIXO dele ou à direita dele.`,
  ];
}

/**
 * Instruções das imagens desta página. A LLM decide ONDE e em que tamanho a
 * imagem entra no layout; o sistema cuida de COMO ela é desenhada (arquivo,
 * recorte sem distorção, ponto focal) — por isso ela só escreve um marcador.
 */
function renderImageRules(page: PagePlan, images: ImageInsight[], plan: DocumentPlan): string {
  const pageImages = (page.images || [])
    .map(item => ({ item, info: images.find(img => img.id === item.id) }))
    .filter((x): x is { item: typeof x.item; info: ImageInsight } => !!x.info);
  if (pageImages.length === 0) return '';

  const isSlide = plan.format === 'SLIDE';
  const u = SHEETS[plan.format].unit;
  const lines: string[] = ['', `IMAGENS DESTA ${isSlide ? 'TELA' : 'PÁGINA'} (enviadas pelo usuário — use TODAS as listadas):`];

  for (const { item, info } of pageImages) {
    const ratio = (info.width / info.height).toFixed(2);
    const desc = `${info.description} — ${item.note}`;
    if (item.role === 'background' && (fitsSheet(info, plan.format) || info.hasText || info.kind !== 'foto')) {
      // Fundo pronto de identidade visual: já tem logo/grafismos desenhados.
      lines.push(
        `- ${item.id} é o FUNDO da ${isSlide ? 'tela' : 'página'} inteira: ${desc}.`,
        `  O SISTEMA já coloca essa imagem cobrindo tudo, atrás do seu conteúdo — NÃO escreva <img> para ela.`,
        `  Ela é um fundo PRONTO de identidade visual: já tem elementos desenhados (logo, linhas, textos, molduras).`,
        `  • NÃO cubra esses elementos: posicione seu conteúdo nas ÁREAS LIVRES da imagem;`,
        ...renderZones(info, plan),
        `  • NÃO coloque véu, gradiente ou painel sobre a imagem inteira — ela deve aparecer como foi desenhada;`,
        `  • seu bloco raiz fica TRANSPARENTE; use as cores da imagem (${info.colors.join(', ')}) no texto e nos destaques,`,
        `    com contraste suficiente para leitura;`,
        `  • não repita no seu conteúdo o logo ou os textos que a imagem já mostra.`
      );
      continue;
    }
    if (item.role === 'background') {
      lines.push(
        `- ${item.id} é o FUNDO da ${isSlide ? 'tela' : 'página'} inteira (${desc}). O SISTEMA já coloca essa imagem cobrindo tudo,`,
        `  atrás do seu conteúdo — NÃO escreva <img> para ela. Consequências para o seu layout:`,
        `  • seu bloco raiz NÃO pode ter cor de fundo opaca (senão esconde a foto) — deixe-o transparente;`,
        `  • garanta leitura do texto: use um véu/gradiente semitransparente por cima da foto (ex: bg-black/50,`,
        `    bg-gradient-to-t from-black/80) ou um painel sólido só atrás do bloco de texto;`,
        `  • o assunto principal da foto fica em ${info.focalX}% horizontal / ${info.focalY}% vertical — não cubra essa área com texto;`,
        `  • cores marcantes da foto: ${info.colors.join(', ')} — use-as nos destaques.`
      );
      continue;
    }

    const fit = fitFor(info, item.role);
    const sizeHint = item.role === 'logo'
      ? `pequena (altura entre ${isSlide ? '60px e 120px' : '12mm e 22mm'})`
      : item.role === 'hero'
        ? `grande (ocupando algo como 40-60% da área útil)`
        : `média (algo como 25-45% da área útil)`;
    lines.push(
      `- ${item.id} (${item.role}): ${desc}. Proporção ${ratio} (largura/altura).`,
      `  Escreva EXATAMENTE <img data-xgen-img="${item.id}" alt="..."> dentro de um contêiner seu com LARGURA e ALTURA`,
      `  definidas (em ${u}, %, ou flex/grid), ex: <div style="height:${isSlide ? '480px' : '80mm'}"><img data-xgen-img="${item.id}" class="w-full h-full"></div>.`,
      `  Tamanho sugerido: ${sizeHint}. ${fit === 'contain'
        ? 'Esta imagem NUNCA é cortada (o sistema a encaixa inteira) — dê ao contêiner uma proporção próxima de ' + ratio + ' para não sobrar faixa vazia.'
        : 'O sistema recorta a imagem para preencher o contêiner sem distorcer, preservando o assunto principal.'}`,
      `  NÃO escreva src — o sistema preenche. NÃO aplique filtros que escondam a imagem.`
    );
    if (item.role === 'logo' || info.kind === 'logo') {
      lines.push(
        `  CONTRASTE: as cores do logo são ${info.colors.join(', ')}${info.hasAlpha ? ' (fundo transparente)' : ''}. Se o fundo onde ele fica`,
        `  for parecido com essas cores (logo escuro em fundo escuro, ou claro em claro), ponha o logo sobre uma plaquinha de cor contrastante.`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
