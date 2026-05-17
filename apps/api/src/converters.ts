import puppeteer from 'puppeteer';
// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import ExcelJS from 'exceljs';
import fs from 'fs';

export async function convertToPDF(htmlContent: string, outputPath: string) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  
  await page.emulateMediaType('screen'); // Volta para 'screen' para manter a qualidade premium (Dark Mode, Gradientes) do TailwindCSS
  await page.setContent(htmlContent, { waitUntil: 'load' });
  // Espera até 5 segundos para garantir que todas as imagens (Pexels, QuickChart) terminem de baixar
  await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
  await browser.close();
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
