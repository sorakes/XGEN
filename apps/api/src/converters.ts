import puppeteer, { Browser, Page } from 'puppeteer';
// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import ExcelJS from 'exceljs';
import fs from 'fs';

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

// A4 em pixels CSS a 96dpi (210mm x 297mm). O viewport PRECISA bater com a
// folha: no viewport padrão (800px) qualquer 100vw/w-screen já vaza alguns
// pixels para fora da página e o conteúdo aparece cortado nas laterais.
export const A4_WIDTH_PX = Math.round((210 / 25.4) * 96);  // 794
export const A4_HEIGHT_PX = Math.round((297 / 25.4) * 96); // 1123

/** Carrega o HTML e espera CDNs (Tailwind/Chart.js) e layout estabilizarem. */
async function loadPage(browser: Browser, htmlContent: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, deviceScaleFactor: 2 });
  // 'screen' mantém a qualidade premium (dark mode, gradientes) do TailwindCSS
  await page.emulateMediaType('screen');
  await page.setContent(htmlContent, { waitUntil: 'load' });
  await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
  // Tailwind CDN gera as classes em runtime; Chart.js desenha no canvas.
  // Dois frames garantem que o layout final já está aplicado antes de medir/capturar.
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  return page;
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
}

/**
 * Mede, DENTRO DO BROWSER, quanto o conteúdo de cada página transbordou a
 * caixa A4 — na vertical E na horizontal. É uma verificação determinística —
 * substitui perguntar à LLM se "ficou bonito", coisa que ela não tem como
 * saber sem ver o render.
 */
export async function measurePageOverflow(htmlContent: string): Promise<PageOverflow[]> {
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const page = await loadPage(browser, htmlContent);
    return await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('.xgen-page'));
      return sections.map((section, i) => {
        const el = section as HTMLElement;
        const box = el.getBoundingClientRect();
        let maxBottom = 0;
        let maxRight = 0;
        let minLeft = 0;
        el.querySelectorAll('*').forEach(child => {
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
        el.querySelectorAll('canvas, img, svg, table, hr').forEach(media => {
          const r = media.getBoundingClientRect();
          if (r.height > 0) contentBottom = Math.max(contentBottom, r.bottom - box.top);
        });

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
        };
      });
    });
  } finally {
    await browser.close();
  }
}

export async function convertToPDF(htmlContent: string, outputPath: string) {
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const page = await loadPage(browser, htmlContent);
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      // Margem ZERO é obrigatória: cada .xgen-page já tem exatamente 210x297mm
      // e cuida do próprio respiro interno. Qualquer margem aqui empurraria o
      // conteúdo para uma página extra em branco.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

export async function convertToDOCX(htmlContent: string, outputPath: string) {
  // O html-to-docx é MUITO sensível a atributos ou CSS que parecem XML inválido.
  // Vamos fazer um regex agressivo para remover blocos <style> e propriedades inválidas:
  let safeHtml = htmlContent
    .replace(/<style[\s\S]*?<\/style>/gi, '') // Remove <style> blocks inteiros (força a usar só inline)
    .replace(/@(media|page|font-face|keyframes|webkit-[\w-]+)/gi, '') // Remove media queries
    .replace(/\bxmlns:w="[^"]*"/g, ''); // Remove namespaces do word se a IA tentar forçar

  // Converter todas as imagens remotas (Pexels, QuickChart) para Base64.
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

export async function convertToXLSX(jsonStringData: string, outputPath: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Relatório XGEN');

  let rows = [];
  try {
    rows = JSON.parse(jsonStringData);
  } catch (e) {
    // Fallback de segurança se a IA forçar texto puro ao invés de JSON
    rows = [{ Status: "Erro de Validação LLM", Dados: "O formato retornado não era JSON estruturado." }];
  }

  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    // Configura o cabeçalho dinâmico
    sheet.columns = keys.map(key => ({ header: key.toUpperCase(), key: key, width: 25 }));
    
    // Design Estético Premium do Cabeçalho Excel
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; // Indigo-600
    
    // Insere dados e formata inteligentemente as células baseadas no valor
    rows.forEach((row: any) => {
      const addedRow = sheet.addRow(row);
      
      addedRow.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          // Formatação Condicional Inteligente (Vermelho = Negativo, Verde = Positivo)
          if (cell.value < 0) {
            cell.font = { color: { argb: 'FFDC2626' } }; 
          } else {
            cell.font = { color: { argb: 'FF16A34A' } }; 
          }
        }
      });
    });
  }

  await workbook.xlsx.writeFile(outputPath);
}
