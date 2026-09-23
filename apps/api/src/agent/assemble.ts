import type { DocumentPlan, PagePlan } from './planner';
import { SHEETS } from './format';
import { fitFor } from './vision';
import { assetToDataUrl } from '../services/images.service';
import type { ImageInsight } from '../types';

export const PAGE_CLASS = 'xgen-page';

/** Delimitam os slides no HTML final: o editor web separa/junta os slides por eles. */
export const SLIDES_START = '<!--xgen:slides-->';
export const SLIDES_END = '<!--/xgen:slides-->';

const PLACEHOLDER_RE = /<img\b[^>]*\bdata-xgen-img\s*=\s*["']?([\w-]+)["']?[^>]*>/gi;

/**
 * Junta os fragmentos num único documento onde CADA .xgen-page tem
 * exatamente o tamanho de uma folha (A4 ou slide). Como a altura é fixa, o
 * Puppeteer não precisa "decidir" onde quebrar: cada seção vira uma página
 * inteira, na ordem planejada.
 */
export function assembleDocument(plan: DocumentPlan, pageHtmls: string[], images: ImageInsight[] = []): string {
  const sheet = SHEETS[plan.format || 'A4'];
  const dataUrls = new Map<string, string>();
  const srcOf = (img: ImageInsight) => {
    if (!dataUrls.has(img.id)) dataUrls.set(img.id, assetToDataUrl(img));
    return dataUrls.get(img.id)!;
  };

  const pages = pageHtmls
    .map((html, i) => renderPage(plan.pages[i], html, images, srcOf))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(plan.theme)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  @page { size: ${sheet.cssWidth} ${sheet.cssHeight}; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }

  /* Cada página é uma caixa fechada. O que passar disso é cortado —
     por isso o agente mede o transbordo e regenera a página que estourar. */
  .${PAGE_CLASS} {
    position: relative;
    width: ${sheet.cssWidth};
    height: ${sheet.cssHeight};
    overflow: hidden;
    /* Sem isso a página "vazia" é transparente e o screenshot JPEG do PPTX sai preto. */
    background: #ffffff;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .${PAGE_CLASS}:last-of-type { break-after: auto; page-break-after: auto; }

  /* Trava de largura garantida por código: qualquer bloco de primeiro nível
     mais largo que a folha seria cortado nas laterais. Não dá para depender
     da LLM lembrar de não usar w-screen/100vw/larguras fixas em px. */
  .${PAGE_CLASS} > * { max-width: 100% !important; }

  /* Tabelas e blocos de texto longo são os que mais estouram a largura. */
  .${PAGE_CLASS} table { max-width: 100% !important; table-layout: fixed; }
  .${PAGE_CLASS} img, .${PAGE_CLASS} canvas, .${PAGE_CLASS} svg { max-width: 100% !important; }
  .${PAGE_CLASS} pre, .${PAGE_CLASS} code { white-space: pre-wrap; word-break: break-word; }

  /* Imagens do usuário: a LLM escolhe o tamanho do contêiner, o sistema
     garante que a imagem NUNCA distorce (object-fit) e nunca vaza da caixa. */
  .${PAGE_CLASS} img[data-xgen-img] { display: block; max-height: 100%; }
  .${PAGE_CLASS} img[data-fit="cover"] { object-fit: cover !important; }
  .${PAGE_CLASS} img[data-fit="contain"] { object-fit: contain !important; }

  /* Fundo de página inteira: posto pelo sistema, atrás do conteúdo. */
  .${PAGE_CLASS} > img.xgen-bg {
    position: absolute; inset: 0; width: 100%; height: 100%;
    max-width: none !important; object-fit: cover; z-index: 0;
  }
  .${PAGE_CLASS} > .xgen-content { position: relative; z-index: 1; width: 100%; height: 100%; }
</style>
</head>
<body>
${SLIDES_START}
${pages}
${SLIDES_END}
<script>
  // Gráficos precisam estar estáticos e no tamanho do contêiner no momento
  // da captura — animação em curso vira gráfico pela metade no PDF.
  if (window.Chart) {
    Chart.defaults.animation = false;
    Chart.defaults.responsive = false;
    Chart.defaults.maintainAspectRatio = false;
  }
</script>
</body>
</html>`;
}

function renderPage(
  page: PagePlan | undefined,
  html: string,
  images: ImageInsight[],
  srcOf: (img: ImageInsight) => string
): string {
  const byId = new Map(images.map(img => [img.id, img]));
  const planned = new Map((page?.images || []).map(item => [item.id, item]));
  const background = (page?.images || []).find(item => item.role === 'background');
  const bgInfo = background ? byId.get(background.id) : undefined;

  const body = html.replace(PLACEHOLDER_RE, (tag, id: string) => {
    const info = byId.get(id);
    // Marcador de imagem inexistente ou do fundo (que o sistema já desenha): some.
    if (!info || (bgInfo && id === bgInfo.id)) return '';
    const role = planned.get(id)?.role ?? info.suggestedRole;
    const requestedFit = tag.match(/\bdata-fit\s*=\s*["']?(cover|contain)/i)?.[1];
    const fit = info.hasText || info.kind === 'logo' ? 'contain' : requestedFit ?? fitFor(info, role);
    const cleaned = tag
      .replace(/\s(src|srcset|data-fit|data-role)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/^<img\b/i, '')
      .replace(/\/?>$/, '');
    const existingStyle = cleaned.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
    const baseStyle = existingStyle ? (existingStyle[2] ?? existingStyle[3] ?? '') : '';
    const attrs = cleaned.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, '');
    const style = `${baseStyle}${baseStyle && !baseStyle.trim().endsWith(';') ? ';' : ''}object-position:${info.focalX}% ${info.focalY}%`;
    const sensitive = info.hasText || info.kind !== 'foto' ? '1' : '0';
    return `<img${attrs} src="${srcOf(info)}" data-fit="${fit}" data-role="${role}" data-sensitive="${sensitive}" style="${escapeAttr(style)}">`;
  });

  if (!bgInfo) return `<section class="${PAGE_CLASS}">${body}</section>`;

  return `<section class="${PAGE_CLASS}">` +
    `<img class="xgen-bg" data-xgen-bg="${bgInfo.id}" data-zones="${escapeAttr(JSON.stringify(bgInfo.zones || []))}" alt="" src="${srcOf(bgInfo)}" ` +
    `style="object-position:${bgInfo.focalX}% ${bgInfo.focalY}%">` +
    `<div class="xgen-content">${body}</div></section>`;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}
