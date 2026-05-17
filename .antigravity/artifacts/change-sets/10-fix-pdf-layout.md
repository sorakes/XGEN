# Change Set: Correção de Layout PDF (A4)

## Arquivos Modificados
1. `apps/api/src/converters.ts`

## Descrição da Mudança
- Foi removida a imposição rígida de margem zero e formato `A4` direto nos parâmetros do `page.pdf()`.
- O Puppeteer agora delega a inteligência de layout para o CSS da página usando `preferCSSPageSize: true`.
- Injetamos um estilo global usando `page.addStyleTag()` contendo:
  - `@page { size: A4; margin: 15mm; }` para garantir margens seguras corporativas em todas as bordas.
  - O seletor `-webkit-print-color-adjust: exact;` garantindo a preservação absoluta de fundos e texturas visuais de temas escuros.
  - A propriedade `page-break-inside: avoid;` em tabelas, imagens, e cards para que o sistema empurre o bloco inteiro para a página seguinte ao invés de guilhotiná-lo ao meio.

## Impacto no Sistema
**Alto.** Os PDFs corporativos exportados voltarão a ter aspecto profissional com paginação correta e espaçamentos adequados, sem comprometer a estética moderna (Dark mode e cores de fundo do TailwindCSS permanecem renderizando).
