# Subplan: Correção Layout PDF Pivot (Opção 1)

## Objetivo
Aplicar a arquitetura de "Full Bleed Estrito" para os relatórios do XGEN, garantindo a estética moderna do TailwindCSS de ponta-a-ponta, mas impedindo cortes agressivos nos componentes internos.

## Escopo Atômico
1. **`apps/api/src/converters.ts`**:
   - Inserir `await page.setViewport({ width: 794, height: 1122, deviceScaleFactor: 2 });` no início da renderização do Puppeteer para forçar o navegador virtual a assumir as proporções exatas de um A4 em alta densidade (HD).
   - Alterar o CSS injetado de `@page { margin: 15mm; }` para `@page { margin: 0; }`.
   - Manter as restrições mecânicas de `page-break-inside: avoid;` para proteção de blocos de texto/tabelas no limite da folha.

## Critérios de Aceitação
- Elementos com background ou largura 100% (como cabeçalhos) encostarão sem bordas brancas na lateral e no topo do papel.
- Elementos no meio da folha que passem o limite do fim do A4 pularão para a página 2 (graças ao page-break), em vez de serem "rasgados" ao meio.

## Status
[DONE]
