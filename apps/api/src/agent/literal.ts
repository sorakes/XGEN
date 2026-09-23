import type { LiteralLayout } from './intent';
import { SHEETS } from './format';
import { SLIDES_START, SLIDES_END } from './assemble';
import { assetToDataUrl } from '../services/images.service';
import type { DocumentType, ImageInsight, PageFormat } from '../types';

/**
 * Modo LITERAL: monta o arquivo só com o material enviado, direto por código.
 * Nada de LLM desenhando página nem inventando texto — a imagem entra inteira
 * (object-fit: contain), na ordem enviada, no maior tamanho que cabe.
 */

/** Folha que melhor aproveita as imagens: paisagem se a maioria é horizontal. */
export function literalFormat(documentType: DocumentType, images: ImageInsight[], layout: LiteralLayout): PageFormat {
  if (documentType === 'PPTX') return 'SLIDE';
  const horizontal = images.filter(img => img.width > img.height * 1.1).length;
  // 2 imagens horizontais por página empilham bem numa folha em pé.
  if (layout.imagesPerPage === 2) return horizontal > images.length / 2 ? 'A4' : 'A4L';
  return horizontal > images.length / 2 ? 'A4L' : 'A4';
}

export function buildLiteralHtml(images: ImageInsight[], format: PageFormat, layout: LiteralLayout): string {
  const sheet = SHEETS[format];
  const isSlide = format === 'SLIDE';
  const perPage = layout.imagesPerPage;
  // Slide com uma imagem e sem título: a imagem ocupa o slide inteiro.
  const margin = isSlide ? (perPage === 1 && !layout.title ? '0px' : '64px') : '10mm';
  const gap = isSlide ? '32px' : '6mm';

  // Grade por quantidade de imagens na página.
  const grid = (count: number) => {
    if (count <= 1) return 'grid-template-columns: 1fr; grid-template-rows: 1fr;';
    if (count === 2) {
      return sheet.widthPx > sheet.heightPx
        ? 'grid-template-columns: 1fr 1fr; grid-template-rows: 1fr;'
        : 'grid-template-columns: 1fr; grid-template-rows: 1fr 1fr;';
    }
    return 'grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;';
  };

  const pages: string[] = [];
  for (let i = 0; i < images.length; i += perPage) {
    const chunk = images.slice(i, i + perPage);
    const isFirst = i === 0;
    // Slide com uma imagem só: o fundo do slide acompanha a imagem (sem faixa branca).
    const background = isSlide && chunk.length === 1 ? chunk[0].dominant : '#ffffff';
    const title = isFirst && layout.title
      ? `<h1 style="margin:0 0 ${gap};font:600 ${isSlide ? '56px' : '20pt'}/1.2 'Helvetica Neue',Arial,sans-serif;color:#111;text-align:center">${escapeHtml(layout.title)}</h1>`
      : '';
    const cells = chunk.map(img => {
      const caption = layout.captions
        ? `<figcaption style="margin-top:2mm;font:${isSlide ? '24px' : '9pt'}/1.35 'Helvetica Neue',Arial,sans-serif;color:#444;text-align:center">${escapeHtml(img.description)}</figcaption>`
        : '';
      return `<figure style="margin:0;min-height:0;display:flex;flex-direction:column">
  <div style="flex:1;min-height:0"><img src="${assetToDataUrl(img)}" data-xgen-img="${img.id}" data-fit="contain" alt="${escapeHtml(img.description)}" style="width:100%;height:100%;object-fit:contain;display:block"></div>${caption}
</figure>`;
    }).join('');

    pages.push(`<section class="xgen-page" style="background:${background}">
<div style="position:absolute;inset:${margin};display:flex;flex-direction:column">${title}
<div style="flex:1;min-height:0;display:grid;gap:${gap};${grid(chunk.length)}">${cells}</div></div></section>`);
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @page { size: ${sheet.cssWidth} ${sheet.cssHeight}; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  .xgen-page {
    position: relative; overflow: hidden;
    width: ${sheet.cssWidth}; height: ${sheet.cssHeight};
    break-after: page; page-break-after: always;
  }
  .xgen-page:last-of-type { break-after: auto; page-break-after: auto; }
</style>
</head>
<body>
${SLIDES_START}
${pages.join('\n')}
${SLIDES_END}
</body>
</html>`;
}

/** DOCX literal: as imagens em sequência, uma por página, na largura útil. */
export function buildLiteralDocxHtml(images: ImageInsight[], layout: LiteralLayout): string {
  const blocks = images.map((img, i) => {
    const pageBreak = i > 0 && i % layout.imagesPerPage === 0 ? '<p style="page-break-before: always"></p>' : '';
    const caption = layout.captions ? `<p style="text-align:center;color:#555555;font-size:10pt">${escapeHtml(img.description)}</p>` : '';
    return `${pageBreak}<p style="text-align:center"><img data-xgen-img="${img.id}" data-size="large" alt="${escapeHtml(img.description)}" /></p>${caption}`;
  }).join('\n');
  const title = layout.title ? `<h1 style="text-align:center">${escapeHtml(layout.title)}</h1>` : '';
  return `<!DOCTYPE html><html><body>${title}${blocks}</body></html>`;
}

function escapeHtml(value: string): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
