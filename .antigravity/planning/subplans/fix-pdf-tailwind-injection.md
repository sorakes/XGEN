# Subplan: Injeção Bruta Tailwind + Paginação Nativa (Opção 3)

## Objetivo
Resolver de forma definitiva o problema de CSS (design xoxo) e reativar a paginação que existia no início do projeto, mantendo o visual Full Bleed onde importa (laterais e topo).

## Escopo Atômico
1. **`apps/api/src/converters.ts`**:
   - Remover as restrições rígidas de Viewport que estavam espremendo o Tailwind.
   - Adicionar `await page.addScriptTag({ url: 'https://cdn.tailwindcss.com' })` para injetar compulsoriamente a engine de estilos e sobrepujar falhas do LLM.
   - Alterar parâmetros da geração PDF do Puppeteer:
     - Voltar para `format: 'A4'`.
     - Ativar `displayHeaderFooter: true`.
     - Rodapé com fundo dinâmico `#020617` contendo a numeração.
     - Margens zeradas no topo e laterais, e `15mm` no bottom para comportar a paginação.

## Critérios de Aceitação
- PDF deve exibir os estilos visuais ricos (cores, bordas, padding) corretamente, sem ficar "xoxo".
- O layout não deve ficar espremido com margens brancas limitantes.
- Todo arquivo deve exibir "Página X de Y" com fundo combinando com o template Dark.

## Status
[DONE]
