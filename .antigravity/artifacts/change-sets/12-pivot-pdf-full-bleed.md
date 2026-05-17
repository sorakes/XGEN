# Change Set: PDF Full Bleed com Viewport Control (Pivot V2)

## Arquivos Modificados
1. `apps/api/src/converters.ts`

## Descrição da Mudança
- O CSS do `@page` foi modificado para usar `margin: 0`, permitindo que os elementos do DOM alcancem as extremidades completas do arquivo gerado (remoção do envelope branco que limitava o design).
- Uma instrução rígida de `page.setViewport({ width: 794, height: 1122, deviceScaleFactor: 2 })` foi introduzida no boot da instância do Puppeteer.

## Impacto no Sistema
**Crítico para Design Premium.**
1. O motor do navegador base agora enxerga a tela exatamente no tamanho físico de um papel A4 a 96DPI, antes do render ocorrer. Isso faz com que todo o CSS de caixas e grids do TailwindCSS saibam o seu limite máximo.
2. Com o `deviceScaleFactor: 2`, as imagens Pexels e gráficos QuickChart inseridos via HTML não ficarão embaçados quando espremidos na impressão.
3. As quebras de página nativas injetadas no passo anterior continuarão segurando tabelas textuais de serem rasgadas no limite, pois agora o navegador sabe a medida matemática exata onde a quebra vai ocorrer e fará o wrap corretamente.
