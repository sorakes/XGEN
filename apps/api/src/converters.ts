import puppeteer, { Browser, Page } from 'puppeteer';
// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import { SHEETS } from './agent/format';
import { assetToDataUrl } from './services/images.service';
import type { ImageInsight, PageFormat } from './types';

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

// A4 em pixels CSS a 96dpi (210mm x 297mm). O viewport PRECISA bater com a
// folha: no viewport padrão (800px) qualquer 100vw/w-screen já vaza alguns
// pixels para fora da página e o conteúdo aparece cortado nas laterais.
export const A4_WIDTH_PX = SHEETS.A4.widthPx;   // 794
export const A4_HEIGHT_PX = SHEETS.A4.heightPx; // 1123

/** Carrega o HTML e espera CDNs (Tailwind/Chart.js), fontes, imagens e layout estabilizarem. */
async function loadPage(browser: Browser, htmlContent: string, format: PageFormat = 'A4', scale = 2): Promise<Page> {
  const sheet = SHEETS[format];
  const page = await browser.newPage();
  await page.setViewport({ width: sheet.widthPx, height: sheet.heightPx, deviceScaleFactor: scale });
  // 'screen' mantém a qualidade premium (dark mode, gradientes) do TailwindCSS
  await page.emulateMediaType('screen');
  await page.setContent(htmlContent, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
  await page.evaluate(async () => {
    // Fontes do Google e imagens grandes (data URL) terminam de decodificar aqui.
    await (document as any).fonts?.ready;
    await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {})));
  });
  // Tailwind CDN gera as classes em runtime; Chart.js desenha no canvas.
  // Dois frames garantem que o layout final já está aplicado antes de medir/capturar.
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  return page;
}

/** Problema medido numa imagem do usuário dentro de uma página. */
export interface ImageIssue {
  id: string;
  problem: 'not_loaded' | 'pixelated' | 'too_small' | 'clipped' | 'cropped';
  /** Fração da imagem cortada pelo object-fit: cover (0 a 1). */
  cropRatio?: number;
  /** Largura/altura renderizadas em px CSS e a resolução natural, para a nota de correção. */
  renderedWidth: number;
  renderedHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  /** Largura máxima (px CSS) em que a imagem ainda fica nítida. */
  maxSharpWidth: number;
}

export interface PageOverflow {
  /** 1-indexed, na mesma ordem das seções .xgen-page */
  index: number;
  /** Pixels que o conteúdo passou da ALTURA da folha (<= 0 significa que coube) */
  overflowY: number;
  /** Pixels que o conteúdo passou da LARGURA da folha, somando os dois lados */
  overflowX: number;
  /** Fração da altura da folha até onde o conteúdo VISÍVEL desce (0 a 1) */
  fillRatio: number;
  /** Dimensões úteis da folha, em px, para dar contexto à LLM na correção */
  pageHeight: number;
  pageWidth: number;
  /** Ids das imagens que de fato aparecem na página */
  imagesPresent: string[];
  /** Textos que ficaram em cima de logo/texto já desenhado no fundo */
  zoneOverlaps: { text: string; zone: string }[];
  imageIssues: ImageIssue[];
}

/**
 * Mede, DENTRO DO BROWSER, quanto o conteúdo de cada página transbordou a
 * caixa — na vertical E na horizontal — e se as imagens do usuário ficaram
 * nítidas e visíveis. É uma verificação determinística — substitui
 * perguntar à LLM se "ficou bonito", coisa que ela não tem como saber sem
 * ver o render.
 */
export async function measurePageOverflow(htmlContent: string, format: PageFormat = 'A4'): Promise<PageOverflow[]> {
  const sheet = SHEETS[format];
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const page = await loadPage(browser, htmlContent, format, 1);
    return await page.evaluate((requiredDensity: number) => {
      const sections = Array.from(document.querySelectorAll('.xgen-page'));
      return sections.map((section, i) => {
        const el = section as HTMLElement;
        const box = el.getBoundingClientRect();
        let maxBottom = 0;
        let maxRight = 0;
        let minLeft = 0;
        el.querySelectorAll('*').forEach(child => {
          if ((child as HTMLElement).classList?.contains('xgen-bg')) return;
          const rect = child.getBoundingClientRect();
          // Ignora elementos sem caixa (scripts, nós vazios)
          if (rect.width > 0 || rect.height > 0) {
            maxBottom = Math.max(maxBottom, rect.bottom - box.top);
            maxRight = Math.max(maxRight, rect.right - box.left);
            minLeft = Math.min(minLeft, rect.left - box.left);
          }
        });

        // Para saber se a página ficou VAZIA embaixo não dá para usar as caixas:
        // o bloco raiz é h-full e sempre encosta no pé. Medimos então onde o
        // conteúdo realmente visível (texto e mídia) termina.
        let contentBottom = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.textContent && node.textContent.trim()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (r.height > 0) contentBottom = Math.max(contentBottom, r.bottom - box.top);
          }
          node = walker.nextNode();
        }
        el.querySelectorAll('canvas, img:not(.xgen-bg), svg, table, hr').forEach(media => {
          const r = media.getBoundingClientRect();
          if (r.height > 0) contentBottom = Math.max(contentBottom, r.bottom - box.top);
        });

        // --- Imagens do usuário ---
        const imagesPresent: string[] = [];
        const imageIssues: any[] = [];
        el.querySelectorAll('img[data-xgen-img], img.xgen-bg').forEach(node => {
          const img = node as HTMLImageElement;
          const id = img.getAttribute('data-xgen-img') || img.getAttribute('data-xgen-bg') || '';
          const isBg = img.classList.contains('xgen-bg');
          const role = img.getAttribute('data-role') || (isBg ? 'background' : 'inline');
          const r = img.getBoundingClientRect();
          const base = {
            id,
            renderedWidth: Math.round(r.width),
            renderedHeight: Math.round(r.height),
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            maxSharpWidth: Math.floor(img.naturalWidth / requiredDensity),
          };
          if (r.width < 2 || r.height < 2 || getComputedStyle(img).display === 'none' || getComputedStyle(img).visibility === 'hidden') {
            return; // não conta como presente
          }
          if (isBg) {
            // O fundo está sempre lá, mas some se a LLM pintar por cima um bloco
            // OPACO do tamanho da página (ex: raiz com bg-slate-900).
            const pageArea = el.clientWidth * el.clientHeight;
            const covered = Array.from(el.querySelectorAll('.xgen-content *')).some(child => {
              const cr = child.getBoundingClientRect();
              if (cr.width * cr.height < pageArea * 0.8) return false;
              const style = getComputedStyle(child);
              const alpha = style.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(',')[3];
              const opaqueColor = style.backgroundColor !== 'transparent' &&
                !style.backgroundColor.endsWith(', 0)') && (alpha === undefined || Number(alpha) >= 0.95);
              return opaqueColor && Number(style.opacity) >= 0.95;
            });
            if (covered) return;
          }
          imagesPresent.push(id);
          if (!img.complete || img.naturalWidth === 0) {
            imageIssues.push({ ...base, problem: 'not_loaded' });
            return;
          }
          if (isBg) return; // o fundo sempre cobre a folha; resolução dele não é corrigível pela LLM

          // Escala com que a imagem é desenhada: 'cover' amplia até cobrir,
          // 'contain' até caber. Acima da densidade exigida, ela pixela.
          const fit = img.getAttribute('data-fit') === 'contain' ? 'contain' : 'cover';
          const sx = r.width / img.naturalWidth;
          const sy = r.height / img.naturalHeight;
          const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
          if (scale * requiredDensity > 1.35) {
            imageIssues.push({ ...base, problem: 'pixelated' });
          }

          // Logo de canto pode ser discreto; ilustração precisa ser vista.
          // Recorte: com 'cover', a parte da imagem que fica fora do contêiner some.
          // Foto aguenta um corte moderado; arte com texto/logo quase nenhum.
          if (fit === 'cover') {
            const cropRatio = 1 - Math.min(sx, sy) / Math.max(sx, sy);
            const limit = img.getAttribute('data-sensitive') === '1' ? 0.06 : 0.25;
            if (cropRatio > limit) imageIssues.push({ ...base, problem: 'cropped', cropRatio: Number(cropRatio.toFixed(2)) });
          }

          const minWidth = role === 'logo' ? 0.035 : 0.14;
          if (r.width < el.clientWidth * minWidth && r.height < el.clientHeight * minWidth) {
            imageIssues.push({ ...base, problem: 'too_small' });
          }

          // Imagem que ficou para fora da folha (em parte ou toda).
          const visibleW = Math.min(r.right, box.right) - Math.max(r.left, box.left);
          const visibleH = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
          if (visibleW * visibleH < r.width * r.height * 0.9) {
            imageIssues.push({ ...base, problem: 'clipped' });
          }
        });

        // Texto por cima das áreas ocupadas do fundo pronto (logo, selo, textos da arte).
        const zoneOverlaps: { text: string; zone: string }[] = [];
        const bg = el.querySelector('img.xgen-bg') as HTMLImageElement | null;
        let zones: { x: number; y: number; w: number; h: number }[] = [];
        try { zones = JSON.parse(bg?.getAttribute('data-zones') || '[]'); } catch { zones = []; }
        if (zones.length) {
          const W = el.clientWidth, H = el.clientHeight;
          const rects = zones.map(z => ({
            l: (z.x / 100) * W, t: (z.y / 100) * H, r: ((z.x + z.w) / 100) * W, b: ((z.y + z.h) / 100) * H,
            label: `x ${Math.round((z.x / 100) * W)}-${Math.round(((z.x + z.w) / 100) * W)}, y ${Math.round((z.y / 100) * H)}-${Math.round(((z.y + z.h) / 100) * H)}`,
          }));
          const content = el.querySelector('.xgen-content');
          if (content) {
            const tw = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
            let tn = tw.nextNode();
            while (tn && zoneOverlaps.length < 5) {
              const text = (tn.textContent || '').trim();
              if (text) {
                const range = document.createRange();
                range.selectNodeContents(tn);
                for (const tr of Array.from(range.getClientRects())) {
                  const l = tr.left - box.left, t = tr.top - box.top, r = tr.right - box.left, b = tr.bottom - box.top;
                  const hit = rects.find(z => Math.min(r, z.r) - Math.max(l, z.l) > 4 && Math.min(b, z.b) - Math.max(t, z.t) > 4);
                  if (hit) { zoneOverlaps.push({ text: text.slice(0, 40), zone: hit.label }); break; }
                }
              }
              tn = tw.nextNode();
            }
          }
        }

        // Vazamento pela direita e pela esquerda contam os dois.
        const bleedRight = maxRight - el.clientWidth;
        const bleedLeft = -minLeft;
        return {
          index: i + 1,
          overflowY: Math.round(maxBottom - el.clientHeight),
          overflowX: Math.round(Math.max(bleedRight, bleedLeft)),
          fillRatio: Number((contentBottom / el.clientHeight).toFixed(3)),
          pageHeight: Math.round(el.clientHeight),
          pageWidth: Math.round(el.clientWidth),
          imagesPresent,
          imageIssues,
          zoneOverlaps,
        };
      });
    }, sheet.requiredDensity);
  } finally {
    await browser.close();
  }
}

/** Screenshot de cada .xgen-page (usado no PPTX e na crítica visual). */
export async function screenshotPages(
  htmlContent: string,
  format: PageFormat,
  scale = 1.5,
  type: 'jpeg' | 'png' = 'jpeg'
): Promise<{ image: Buffer; text: string }[]> {
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const page = await loadPage(browser, htmlContent, format, scale);
    const sections = await page.$$('.xgen-page');
    const shots: { image: Buffer; text: string }[] = [];
    for (const section of sections) {
      const image = await section.screenshot({ type, ...(type === 'jpeg' ? { quality: 90 } : {}) });
      const text = await section.evaluate(el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
      shots.push({ image: Buffer.from(image), text });
    }
    return shots;
  } finally {
    await browser.close();
  }
}

export async function convertToPDF(htmlContent: string, outputPath: string, format: PageFormat = 'A4') {
  const sheet = SHEETS[format];
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const page = await loadPage(browser, htmlContent, format);
    await page.pdf({
      path: outputPath,
      width: sheet.cssWidth,
      height: sheet.cssHeight,
      printBackground: true,
      // Margem ZERO é obrigatória: cada .xgen-page já tem exatamente o tamanho da folha
      // e cuida do próprio respiro interno. Qualquer margem aqui empurraria o
      // conteúdo para uma página extra em branco.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

/**
 * PPTX a partir dos slides renderizados: cada .xgen-page vira uma imagem
 * 16:9 ocupando o slide inteiro. O arquivo é para ser APRESENTADO, não
 * editado — assim o resultado fica idêntico ao que foi desenhado e medido
 * (fontes, gráficos, fundos), em qualquer PowerPoint/Keynote/LibreOffice.
 * O texto de cada slide vai nas anotações do apresentador.
 */
export async function convertToPPTX(htmlContent: string, outputPath: string, title = 'XGEN') {
  const shots = await screenshotPages(htmlContent, 'SLIDE', 1.5, 'jpeg');
  if (shots.length === 0) throw new Error('Nenhum slide foi renderizado.');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 pol = 16:9
  pptx.title = title;
  pptx.company = 'XGEN Enterprise';

  for (const shot of shots) {
    const slide = pptx.addSlide();
    slide.addImage({
      data: `data:image/jpeg;base64,${shot.image.toString('base64')}`,
      x: 0, y: 0, w: 13.333, h: 7.5,
    });
    if (shot.text) slide.addNotes(shot.text.slice(0, 5000));
  }

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  fs.writeFileSync(outputPath, buffer);
}

/** Largura útil de uma página A4 do Word com margens padrão, em px (96dpi). */
const DOCX_CONTENT_WIDTH_PX = 600;
const DOCX_MAX_IMAGE_HEIGHT_PX = 760;

export async function convertToDOCX(htmlContent: string, outputPath: string, images: ImageInsight[] = []) {
  // O html-to-docx é MUITO sensível a atributos ou CSS que parecem XML inválido.
  // Vamos fazer um regex agressivo para remover blocos <style> e propriedades inválidas:
  let safeHtml = htmlContent
    .replace(/<style[\s\S]*?<\/style>/gi, '') // Remove <style> blocks inteiros (força a usar só inline)
    .replace(/@(media|page|font-face|keyframes|webkit-[\w-]+)/gi, '') // Remove media queries
    .replace(/\bxmlns:w="[^"]*"/g, ''); // Remove namespaces do word se a IA tentar forçar

  // Imagens do usuário: o marcador vira a imagem embutida, com largura e
  // altura calculadas pela proporção real (o Word não tem object-fit —
  // qualquer par width/height fora da proporção distorce a foto).
  const byId = new Map(images.map(img => [img.id, img]));
  safeHtml = safeHtml.replace(/<img\b[^>]*\bdata-xgen-img\s*=\s*["']?([\w-]+)["']?[^>]*>/gi, (tag, id: string) => {
    const info = byId.get(id);
    if (!info) return '';
    const size = tag.match(/\bdata-size\s*=\s*["']?(small|medium|large|full)/i)?.[1]?.toLowerCase();
    const isLogo = info.kind === 'logo' || info.suggestedRole === 'logo';
    const targetWidth =
      size === 'small' ? 180 :
      size === 'medium' ? 380 :
      size === 'large' || size === 'full' ? DOCX_CONTENT_WIDTH_PX :
      isLogo ? 160 : DOCX_CONTENT_WIDTH_PX;
    // Nunca amplia além da resolução real (evita pixelar) nem passa da altura útil.
    let width = Math.min(targetWidth, info.width);
    let height = Math.round(width * (info.height / info.width));
    if (height > DOCX_MAX_IMAGE_HEIGHT_PX) {
      height = DOCX_MAX_IMAGE_HEIGHT_PX;
      width = Math.round(height * (info.width / info.height));
    }
    const alt = tag.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ?? info.description;
    // O html-to-docx só respeita o tamanho vindo do style (em px), não os atributos.
    return `<img src="${assetToDataUrl(info)}" style="width:${width}px;height:${height}px" alt="${alt.replace(/"/g, '&quot;')}" />`;
  });

  // Converter todas as imagens remotas (QuickChart) para Base64.
  // O Word (e o conversor) falha frequentemente em puxar URLs dinâmicas.
  // Regex suporta tanto src="..." quanto src='...'
  const imgRegex = /<img[^>]+src=(["'])(http[^"']+)\1/gi;
  let match;
  const matches = [];
  while ((match = imgRegex.exec(safeHtml)) !== null) {
    matches.push(match[2]); // match[2] é a URL
  }

  for (const url of matches) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      const mimeType = response.headers.get('content-type') || 'image/png';
      safeHtml = safeHtml.replace(url, `data:${mimeType};base64,${base64}`);
    } catch (e) {
      console.error(`[Agent] Aviso: Falha ao baixar imagem para DOCX (${url})`);
    }
  }

  const fileBuffer = await HTMLtoDOCX(safeHtml, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  });
  fs.writeFileSync(outputPath, fileBuffer as Buffer);
}

interface SheetSpecJson {
  name?: string;
  rows?: Record<string, any>[];
}

/** Aceita o formato antigo (array de linhas) e o novo ({sheets:[{name, rows}]}). */
function parseWorkbookJson(jsonStringData: string): SheetSpecJson[] {
  try {
    const parsed = JSON.parse(jsonStringData);
    if (Array.isArray(parsed)) return [{ name: 'Relatório XGEN', rows: parsed }];
    if (parsed && Array.isArray(parsed.sheets)) return parsed.sheets;
    if (parsed && Array.isArray(parsed.rows)) return [parsed];
  } catch { /* cai no fallback */ }
  // Fallback de segurança se a IA forçar texto puro ao invés de JSON
  return [{ name: 'Relatório XGEN', rows: [{ Status: "Erro de Validação LLM", Dados: "O formato retornado não era JSON estruturado." }] }];
}

function safeSheetName(name: string, used: Set<string>): string {
  let base = (name || 'Planilha').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Planilha';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) {
    candidate = `${base.slice(0, 28)} ${i}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function convertToXLSX(jsonStringData: string, outputPath: string, images: ImageInsight[] = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'XGEN Enterprise';
  const usedNames = new Set<string>();

  for (const spec of parseWorkbookJson(jsonStringData)) {
    const rows = Array.isArray(spec.rows) ? spec.rows.filter(r => r && typeof r === 'object') : [];
    const sheet = workbook.addWorksheet(safeSheetName(spec.name || 'Relatório XGEN', usedNames), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    if (rows.length === 0) continue;

    // Une as chaves de todas as linhas (a LLM às vezes omite campos em algumas).
    const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    sheet.columns = keys.map(key => ({ header: key.toUpperCase(), key }));

    // Design Estético Premium do Cabeçalho Excel
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; // Indigo-600
    headerRow.alignment = { vertical: 'middle' };
    headerRow.height = 22;

    // Insere dados e formata inteligentemente as células baseadas no valor
    rows.forEach((row: any, index) => {
      const addedRow = sheet.addRow(row);
      if (index % 2 === 1) {
        addedRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5FA' } };
      }
      addedRow.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          cell.numFmt = Number.isInteger(cell.value) ? '#,##0' : '#,##0.00';
          // Formatação Condicional Inteligente (Vermelho = Negativo, Verde = Positivo)
          if (cell.value < 0) {
            cell.font = { color: { argb: 'FFDC2626' } };
          } else {
            cell.font = { color: { argb: 'FF16A34A' } };
          }
        }
      });
    });

    // Largura de cada coluna pelo conteúdo real (entre 10 e 60 caracteres).
    sheet.columns.forEach(column => {
      let width = String(column.header ?? '').length;
      column.eachCell?.({ includeEmpty: false }, cell => {
        width = Math.max(width, String(cell.value ?? '').length);
      });
      column.width = Math.min(60, Math.max(10, width + 2));
    });

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  }

  // Imagens do usuário numa aba própria, cada uma na proporção real.
  if (images.length) {
    const sheet = workbook.addWorksheet(safeSheetName('Imagens', usedNames));
    sheet.getColumn(1).width = 4;
    let row = 1;
    for (const img of images) {
      const width = Math.min(640, img.width);
      const height = Math.round(width * (img.height / img.width));
      sheet.getCell(row, 2).value = `${img.id} — ${img.description}`;
      sheet.getCell(row, 2).font = { bold: true };
      const imageId = workbook.addImage({
        base64: assetToDataUrl(img),
        extension: img.mime === 'image/png' ? 'png' : 'jpeg',
      });
      sheet.addImage(imageId, { tl: { col: 1, row }, ext: { width, height } });
      // Linhas padrão têm 20px: pula o espaço ocupado pela imagem + folga.
      row += Math.ceil(height / 20) + 3;
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}
