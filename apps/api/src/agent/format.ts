import type { ImageAsset, PageFormat } from '../types';

/** Dimensões e parâmetros de cada tipo de folha do fluxo paginado. */
export interface SheetSpec {
  format: PageFormat;
  widthPx: number;
  heightPx: number;
  cssWidth: string;
  cssHeight: string;
  /** Como a folha é descrita para a LLM. */
  label: string;
  /** Unidade "natural" para paddings/alturas nos prompts. */
  unit: 'mm' | 'px';
  minPadding: string;
  /** Ocupação mínima da altura numa página de conteúdo (abaixo = vazio demais). */
  minFillRatio: number;
  /**
   * Quantos pixels do arquivo final cada px CSS precisa ter para a imagem
   * não parecer pixelada: PDF é impresso (~150dpi => 1.56x), slide é tela (1x).
   */
  requiredDensity: number;
}

export const SHEETS: Record<PageFormat, SheetSpec> = {
  A4: {
    format: 'A4',
    widthPx: Math.round((210 / 25.4) * 96),  // 794
    heightPx: Math.round((297 / 25.4) * 96), // 1123
    cssWidth: '210mm',
    cssHeight: '297mm',
    label: 'folha A4 retrato — EXATAMENTE 210mm x 297mm (794px x 1123px)',
    unit: 'mm',
    minPadding: '14mm',
    minFillRatio: 0.72,
    requiredDensity: 150 / 96,
  },
  A4L: {
    format: 'A4L',
    widthPx: Math.round((297 / 25.4) * 96),  // 1123
    heightPx: Math.round((210 / 25.4) * 96), // 794
    cssWidth: '297mm',
    cssHeight: '210mm',
    label: 'folha A4 paisagem — EXATAMENTE 297mm x 210mm (1123px x 794px)',
    unit: 'mm',
    minPadding: '12mm',
    minFillRatio: 0.65,
    requiredDensity: 150 / 96,
  },
  SLIDE: {
    format: 'SLIDE',
    widthPx: 1920,
    heightPx: 1080,
    cssWidth: '1920px',
    cssHeight: '1080px',
    label: 'slide 16:9 — EXATAMENTE 1920px x 1080px',
    unit: 'px',
    minPadding: '96px',
    // Slides são naturalmente mais arejados que páginas de relatório.
    minFillRatio: 0.5,
    requiredDensity: 1,
  },
};

/**
 * A imagem tem a mesma proporção da folha? Então ela é um "fundo pronto"
 * (ex: fundo de slide 1920x1080 com logo e grafismos) e pode cobrir a folha
 * inteira sem cortar nada — mesmo tendo texto ou logo desenhados nela.
 */
export function fitsSheet(image: Pick<ImageAsset, 'width' | 'height'>, format: PageFormat): boolean {
  const sheet = SHEETS[format];
  const sheetRatio = sheet.widthPx / sheet.heightPx;
  const imageRatio = image.width / image.height;
  return Math.abs(imageRatio - sheetRatio) / sheetRatio < 0.04;
}
