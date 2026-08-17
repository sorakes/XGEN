import type { DocumentPlan } from './planner';

export const PAGE_CLASS = 'xgen-page';

/**
 * Junta os fragmentos num único documento onde CADA .xgen-page tem
 * exatamente o tamanho de uma folha A4. Como a altura é fixa, o Puppeteer
 * não precisa "decidir" onde quebrar: cada seção vira uma página inteira,
 * na ordem planejada.
 */
export function assembleDocument(plan: DocumentPlan, pageHtmls: string[]): string {
  const pages = pageHtmls
    .map(html => `<section class="${PAGE_CLASS}">${html}</section>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(plan.theme)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  @page { size: A4; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }

  /* Cada página é uma caixa A4 fechada. O que passar disso é cortado —
     por isso o agente mede o transbordo e regenera a página que estourar. */
  .${PAGE_CLASS} {
    position: relative;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
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
</style>
</head>
<body>
${pages}
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

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
