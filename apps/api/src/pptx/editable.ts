/**
 * HTML renderizado → PPTX EDITÁVEL.
 *
 * Mesma ideia do "pptx_from_rendered" do huashu-design
 * (github.com/alchaincyf/huashu-design, MIT): em vez de exigir que o HTML
 * siga regras de estrutura, lemos o slide JÁ RENDERIZADO no Chromium — flex,
 * grid e quebras de linha já viraram coordenadas absolutas — e reconstruímos:
 *
 *   1. imagem de fundo (xgen-bg)          → imagem do PowerPoint (trocável)
 *   2. decoração (cards, fios, gradientes, → uma camada PNG transparente por slide
 *      ícones SVG) — tudo sem texto
 *   3. imagens do conteúdo e gráficos      → imagens do PowerPoint (móveis)
 *   4. textos                              → caixas de texto nativas (editáveis)
 *
 * O que o PowerPoint não sabe desenhar (gradiente, sombra, SVG) continua
 * idêntico porque vai na camada de decoração; o que o usuário quer mexer
 * (texto e imagens) vira objeto de verdade.
 */
import puppeteer from 'puppeteer';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import fs from 'fs';
import { SHEETS } from '../agent/format';
import { openRestrictedPage, RESTRICTED_LAUNCH_ARGS } from '../converters';

/** 1920px de slide = 13,333 pol (LAYOUT_WIDE): 1px = 1/144 pol = 0,5 pt. */
const PX_PER_IN = 144;
const PT_PER_PX = 0.5;

interface Run {
  text: string;
  br?: boolean;
  color: string;
  alpha: number;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  font: string;
  spacing: number;
}

interface TextBlock {
  kind: 'text';
  x: number; y: number; w: number; h: number;
  lines: number;
  align: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number | null;
  runs: Run[];
}

interface ImageItem {
  kind: 'image';
  x: number; y: number; w: number; h: number;
  src: string;
  fit: 'cover' | 'contain' | 'fill';
  posX: number; posY: number; // object-position em %
  natW: number; natH: number;
  opacity: number;
  radius: number;
}

/** Forma criada no editor (retângulo, círculo, linha): vira forma nativa do PowerPoint. */
interface ShapeItem {
  kind: 'shape';
  x: number; y: number; w: number; h: number;
  shape: 'rect' | 'rounded' | 'circle' | 'line';
  fill: string;
  alpha: number;
  radius: number;
  line?: { color: string; width: number };
}

type SlideItem = (TextBlock | ImageItem | ShapeItem) & { order?: number };

interface SlideData {
  background: ImageItem | null;
  items: SlideItem[];
}

/** Roda DENTRO do browser: mede cada slide e marca o que vai virar objeto. */
function extractSlides(): SlideData[] {
  const INLINE = new Set(['inline', 'contents']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG']);

  const toHex = (css: string): { hex: string; alpha: number } => {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return { hex: '000000', alpha: 1 };
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const hex = parts.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: parts.length > 3 ? parts[3] : 1 };
  };
  const firstFont = (family: string) => family.split(',')[0].replace(/["']/g, '').trim() || 'Arial';
  const collapse = (s: string) => s.replace(/[\s ]+/g, ' ');
  const isVisible = (el: Element) => {
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.02;
  };

  return Array.from(document.querySelectorAll('.xgen-page')).map(sectionNode => {
    const section = sectionNode as HTMLElement;
    const box = section.getBoundingClientRect();
    const rel = (r: DOMRect) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
    // Opacidade real = a do elemento vezes a de todos os ancestrais (o editor
    // permite opacidade em qualquer bloco, inclusive num card com textos dentro).
    const effOpacity = (el: Element | null) => {
      let o = 1;
      for (let n = el; n && n !== section.parentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    };
    const items: SlideItem[] = [];
    // Ordem de desenho ≈ ordem no DOM (os objetos soltos do editor ficam no fim,
    // do fundo para a frente): os objetos do PPTX são empilhados nessa ordem.
    const domOrder = new Map<Element, number>();
    section.querySelectorAll('*').forEach((n, i) => domOrder.set(n, i));

    const imageItem = (img: HTMLImageElement): ImageItem => {
      const style = getComputedStyle(img);
      const pos = style.objectPosition.split(' ').map(v => parseFloat(v));
      const fit = style.objectFit === 'cover' ? 'cover' : style.objectFit === 'contain' ? 'contain' : 'fill';
      return {
        kind: 'image',
        ...rel(img.getBoundingClientRect()),
        src: img.currentSrc || img.src,
        fit,
        posX: Number.isFinite(pos[0]) ? pos[0] : 50,
        posY: Number.isFinite(pos[1]) ? pos[1] : 50,
        natW: img.naturalWidth,
        natH: img.naturalHeight,
        opacity: effOpacity(img),
        radius: parseFloat(style.borderTopLeftRadius) || 0,
      };
    };

    // 1. Fundo de página inteira
    const bgImg = section.querySelector(':scope > img.xgen-bg') as HTMLImageElement | null;
    const background = bgImg && isVisible(bgImg) && bgImg.naturalWidth ? imageItem(bgImg) : null;
    if (bgImg) bgImg.setAttribute('data-xe-hide', '');

    // 2. Imagens do conteúdo e gráficos (canvas) — viram objetos móveis
    section.querySelectorAll('img:not(.xgen-bg), canvas').forEach(node => {
      const el = node as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !isVisible(el) || effOpacity(el) < 0.02) return;
      if (el.tagName === 'IMG') {
        const img = el as HTMLImageElement;
        if (!img.naturalWidth) return;
        items.push({ ...imageItem(img), order: domOrder.get(img) });
      } else {
        let src = '';
        try { src = (el as HTMLCanvasElement).toDataURL('image/png'); } catch { return; }
        items.push({
          kind: 'image', ...rel(r), src, fit: 'fill', posX: 50, posY: 50,
          natW: (el as HTMLCanvasElement).width, natH: (el as HTMLCanvasElement).height,
          opacity: effOpacity(el), radius: 0, order: domOrder.get(el),
        });
      }
      el.setAttribute('data-xe-hide', '');
    });

    // 2b. Formas do editor → formas nativas (cor e tamanho editáveis no PowerPoint)
    section.querySelectorAll('[data-xgen-shape]').forEach(node => {
      const el = node as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || !isVisible(el)) return;
      const style = getComputedStyle(el);
      const { hex, alpha } = toHex(style.backgroundColor);
      const kind = el.getAttribute('data-xgen-shape') as ShapeItem['shape'];
      items.push({
        kind: 'shape', ...rel(r),
        shape: ['rect', 'rounded', 'circle', 'line'].includes(kind) ? kind : 'rect',
        fill: hex,
        alpha: alpha * effOpacity(el),
        radius: parseFloat(style.borderTopLeftRadius) || 0,
        order: domOrder.get(el),
      });
      el.setAttribute('data-xe-hide', '');
    });

    // 2c. Blocos soltos (cards movidos na ordem de camadas do editor) com fundo
    // sólido: viram retângulos nativos NA POSIÇÃO DA PILHA. Na camada de
    // decoração eles ficariam embaixo de tudo e a ordem do editor se perderia.
    section.querySelectorAll('[data-xgen-float]:not([data-xgen-shape]):not(img):not(canvas)').forEach(node => {
      const el = node as HTMLElement;
      const style = getComputedStyle(el);
      if (style.backgroundImage !== 'none' || !isVisible(el)) return;
      const { hex, alpha } = toHex(style.backgroundColor);
      const borderW = parseFloat(style.borderTopWidth) || 0;
      const border = toHex(style.borderTopColor);
      const hasBorder = borderW > 0 && border.alpha > 0;
      if (alpha <= 0 && !hasBorder) return;
      const r = el.getBoundingClientRect();
      items.push({
        kind: 'shape', ...rel(r),
        shape: (parseFloat(style.borderTopLeftRadius) || 0) > 0 ? 'rounded' : 'rect',
        fill: hex,
        alpha: alpha * effOpacity(el),
        radius: parseFloat(style.borderTopLeftRadius) || 0,
        line: hasBorder ? { color: border.hex, width: borderW } : undefined,
        order: domOrder.get(el),
      });
      el.setAttribute('data-xe-strip', '');
    });

    // 3. Textos: cada nó de texto pertence ao bloco (não-inline) mais próximo.
    const blocks = new Map<Element, Text[]>();
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (!text.textContent || !text.textContent.trim()) continue;
      let parent = text.parentElement;
      if (!parent || parent.closest('script,style,noscript,svg,template')) continue;
      if (!isVisible(parent) || effOpacity(parent) < 0.02) continue;
      // Texto com gradiente (background-clip: text) não tem equivalente: fica na decoração.
      const fill = getComputedStyle(parent).webkitTextFillColor;
      if (fill && /rgba\(0, 0, 0, 0\)|transparent/.test(fill)) continue;
      let block: Element = parent;
      while (block !== section && INLINE.has(getComputedStyle(block).display) && block.parentElement) {
        block = block.parentElement;
      }
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block)!.push(text);
    }

    blocks.forEach((texts, block) => {
      const blockStyle = getComputedStyle(block);
      const runs: Run[] = [];
      const rects: DOMRect[] = [];

      // Percorre o bloco em ordem para intercalar <br> com os textos.
      const ordered: Node[] = [];
      const collect = (node: Node) => {
        node.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            if (texts.includes(child as Text)) ordered.push(child);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element;
            if (SKIP.has(el.tagName)) return;
            if (el.tagName === 'BR') { ordered.push(el); return; }
            // Sub-bloco (não-inline) é outro bloco: não entra aqui.
            if (!INLINE.has(getComputedStyle(el).display)) return;
            collect(el);
          }
        });
      };
      collect(block);

      ordered.forEach((node, i) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (runs.length) runs[runs.length - 1].br = true;
          return;
        }
        const text = node as Text;
        const style = getComputedStyle(text.parentElement!);
        let value = collapse(text.textContent || '');
        if (style.textTransform === 'uppercase') value = value.toUpperCase();
        else if (style.textTransform === 'lowercase') value = value.toLowerCase();
        else if (style.textTransform === 'capitalize') value = value.replace(/\b\p{L}/gu, c => c.toUpperCase());
        // Espaço no começo de linha/bloco não existe no render: descarta.
        const prev = runs[runs.length - 1];
        if (!prev || prev.br) value = value.replace(/^ /, '');
        if (i === ordered.length - 1 || ordered[i + 1]?.nodeType === Node.ELEMENT_NODE) value = value.replace(/ $/, '');
        if (!value) return;

        const range = document.createRange();
        range.selectNodeContents(text);
        Array.from(range.getClientRects()).forEach(r => { if (r.width > 0 && r.height > 0) rects.push(r); });

        const { hex, alpha: colorAlpha } = toHex(style.color);
        const alpha = colorAlpha * effOpacity(text.parentElement);
        const weight = Number(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
        runs.push({
          text: value,
          color: hex,
          alpha,
          size: parseFloat(style.fontSize),
          bold: weight >= 600,
          italic: style.fontStyle === 'italic',
          underline: style.textDecorationLine.includes('underline'),
          font: firstFont(style.fontFamily),
          spacing: parseFloat(style.letterSpacing) || 0,
        });
      });
      if (!runs.length || !rects.length) return;

      // Caixa justa em volta do texto renderizado e número real de linhas
      // (agrupando retângulos que se sobrepõem na vertical — runs de tamanhos
      // diferentes na mesma linha dão retângulos com topos diferentes).
      const left = Math.min(...rects.map(r => r.left));
      const top = Math.min(...rects.map(r => r.top));
      const right = Math.max(...rects.map(r => r.right));
      const bottom = Math.max(...rects.map(r => r.bottom));
      const lines: { t: number; b: number }[] = [];
      rects.sort((a, b) => a.top - b.top).forEach(r => {
        const line = lines.find(l => r.top < l.b - 2 && r.bottom > l.t + 2);
        if (line) { line.t = Math.min(line.t, r.top); line.b = Math.max(line.b, r.bottom); }
        else lines.push({ t: r.top, b: r.bottom });
      });

      const align = (() => {
        const a = blockStyle.textAlign;
        if (a === 'center' || a === 'right' || a === 'justify') return a;
        if (a === 'end') return 'right';
        return 'left';
      })() as TextBlock['align'];
      const lh = parseFloat(blockStyle.lineHeight);

      items.push({
        kind: 'text',
        x: left - box.left, y: top - box.top, w: right - left, h: bottom - top,
        lines: lines.length,
        align,
        lineHeight: Number.isFinite(lh) ? lh : null,
        runs,
        order: domOrder.get(block),
      });
      block.setAttribute('data-xe-text', '');
    });

    // Marcadores de lista (•, 1.) herdam a cor do texto, que a camada de
    // decoração deixa transparente: guarda a cor original para eles.
    section.querySelectorAll('li').forEach(li => {
      (li as HTMLElement).style.setProperty('--xe-marker', getComputedStyle(li).color);
    });

    items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return { background, items };
  });
}

/** Recorta/posiciona a imagem como o object-fit fez no browser. */
async function placeImage(item: ImageItem): Promise<{ data: string; x: number; y: number; w: number; h: number } | null> {
  // Só imagens embutidas (data URL): é assim que o XGEN e o editor gravam as
  // imagens. Baixar URLs aqui, pelo Node, furaria o bloqueio de rede do
  // Chromium (o HTML do editor vem de fora).
  if (!item.src.startsWith('data:')) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(item.src.split(',')[1], 'base64');
  } catch {
    return null;
  }

  let { x, y, w, h } = item;
  let image = sharp(buffer).rotate();
  const meta = await image.metadata();
  const natW = meta.width || item.natW;
  const natH = meta.height || item.natH;

  if (item.fit === 'cover' && natW && natH) {
    // Mesmo corte do browser, respeitando o object-position.
    const scale = Math.max(w / natW, h / natH);
    const cropW = Math.min(natW, Math.round(w / scale));
    const cropH = Math.min(natH, Math.round(h / scale));
    const left = Math.round((natW - cropW) * (item.posX / 100));
    const top = Math.round((natH - cropH) * (item.posY / 100));
    image = image.extract({ left, top, width: cropW, height: cropH });
  } else if (item.fit === 'contain' && natW && natH) {
    // A imagem ocupa só parte da caixa: posiciona o retângulo real dela.
    const scale = Math.min(w / natW, h / natH);
    const realW = natW * scale;
    const realH = natH * scale;
    x += (w - realW) * (item.posX / 100);
    y += (h - realH) * (item.posY / 100);
    w = realW;
    h = realH;
  }

  // Limita a resolução ao necessário para o tamanho no slide (2x para nitidez).
  const maxW = Math.max(64, Math.round(w * 2));
  const out = await image
    .resize({ width: maxW, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const isOpaque = !(await sharp(out).metadata()).hasAlpha;
  const final = isOpaque ? await sharp(out).jpeg({ quality: 90 }).toBuffer() : out;
  const mime = isOpaque ? 'image/jpeg' : 'image/png';
  return { data: `${mime};base64,${final.toString('base64')}`, x, y, w, h };
}

const inch = (px: number) => px / PX_PER_IN;

export async function convertToEditablePPTX(htmlContent: string, outputPath: string, title = 'XGEN') {
  const sheet = SHEETS.SLIDE;
  const browser = await puppeteer.launch({ headless: true, args: RESTRICTED_LAUNCH_ARGS });
  try {
    const page = await openRestrictedPage(browser, htmlContent, 'SLIDE', 1);
    const slides = await page.evaluate(extractSlides);

    // Camada de decoração: o mesmo slide sem textos, sem imagens e sem fundo.
    await page.addStyleTag({
      content: `
        [data-xe-text], [data-xe-text] * {
          color: transparent !important; -webkit-text-fill-color: transparent !important;
          text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important;
        }
        li::marker { color: var(--xe-marker) !important; -webkit-text-fill-color: var(--xe-marker) !important; }
        [data-xe-hide] { visibility: hidden !important; }
        [data-xe-strip] { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
        .xgen-page { background: transparent !important; }
      `,
    });
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const sections = await page.$$('.xgen-page');
    const layers: Buffer[] = [];
    for (const section of sections) {
      layers.push(Buffer.from(await section.screenshot({ type: 'png', omitBackground: true })));
    }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = title;
    pptx.company = 'XGEN Enterprise';

    for (let i = 0; i < slides.length; i++) {
      const data = slides[i];
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };

      if (data.background) {
        const placed = await placeImage({ ...data.background, x: 0, y: 0, w: sheet.widthPx, h: sheet.heightPx });
        if (placed) {
          const bgOpacity = data.background.opacity;
          slide.addImage({
            data: placed.data, x: 0, y: 0, w: inch(sheet.widthPx), h: inch(sheet.heightPx),
            transparency: bgOpacity < 1 ? Math.round((1 - bgOpacity) * 100) : undefined,
          });
        }
      }

      // Decoração só entra se tiver algo desenhado (PNG todo transparente é descartado).
      const layer = layers[i];
      if (layer) {
        const stats = await sharp(layer).stats();
        const alpha = stats.channels[3];
        if (!alpha || alpha.max > 0) {
          const compact = await sharp(layer).png({ compressionLevel: 9, palette: false }).toBuffer();
          slide.addImage({ data: `image/png;base64,${compact.toString('base64')}`, x: 0, y: 0, w: inch(sheet.widthPx), h: inch(sheet.heightPx) });
        }
      }

      for (const item of data.items) {
        if (item.kind === 'shape') {
          const type = item.shape === 'circle' ? pptx.ShapeType.ellipse
            : item.shape === 'rounded' ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
          slide.addShape(type, {
            x: inch(item.x), y: inch(item.y), w: inch(item.w), h: inch(item.h),
            fill: item.alpha > 0
              ? { color: item.fill, transparency: item.alpha < 1 ? Math.round((1 - item.alpha) * 100) : 0 }
              : { type: 'none' },
            line: item.line ? { color: item.line.color, width: item.line.width * PT_PER_PX } : { type: 'none' },
            rectRadius: item.shape === 'rounded' ? Math.min(1, item.radius / (Math.min(item.w, item.h) / 2)) : undefined,
          });
          continue;
        }
        if (item.kind === 'image') {
          const placed = await placeImage(item);
          if (!placed) continue;
          slide.addImage({
            data: placed.data,
            x: inch(placed.x), y: inch(placed.y), w: inch(placed.w), h: inch(placed.h),
            transparency: item.opacity < 1 ? Math.round((1 - item.opacity) * 100) : undefined,
            rounding: item.radius > Math.min(item.w, item.h) / 2 - 1 ? true : undefined,
          });
          continue;
        }

        const singleLine = item.lines <= 1;
        const maxSize = Math.max(...item.runs.map(r => r.size));
        // Folga para diferenças de métrica de fonte entre Chromium e PowerPoint.
        // Linha única: sem quebra automática, então a folga nunca derruba palavra.
        const slack = singleLine ? Math.max(8, item.w * 0.06) : Math.max(6, item.w * 0.03);
        let x = item.x;
        if (item.align === 'center') x -= slack / 2;
        else if (item.align === 'right') x -= slack;
        const w = item.w + slack;
        const h = item.h + Math.max(4, maxSize * 0.15);

        slide.addText(
          item.runs.map(run => ({
            text: run.text,
            options: {
              fontFace: run.font,
              fontSize: Math.max(1, Math.round(run.size * PT_PER_PX * 10) / 10),
              color: run.color,
              transparency: run.alpha < 1 ? Math.round((1 - run.alpha) * 100) : undefined,
              bold: run.bold,
              italic: run.italic,
              underline: run.underline ? { style: 'sng' as const } : undefined,
              charSpacing: run.spacing ? Math.round(run.spacing * PT_PER_PX * 10) / 10 : undefined,
              breakLine: run.br || undefined,
            },
          })),
          {
            x: inch(x), y: inch(item.y), w: inch(w), h: inch(h),
            margin: 0,
            valign: 'top',
            align: item.align,
            wrap: !singleLine,
            fit: 'none',
            paraSpaceBefore: 0,
            paraSpaceAfter: 0,
            // Só quem quebrou linha no HTML recebe entrelinha exata (ver huashu, armadilha 6).
            lineSpacing: !singleLine && item.lineHeight ? Math.round(item.lineHeight * PT_PER_PX * 10) / 10 : undefined,
          }
        );
      }
    }

    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    fs.writeFileSync(outputPath, buffer);
  } finally {
    await browser.close();
  }
}
