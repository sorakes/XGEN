# Subplan: Correção de Layout PDF (Opção 3 - preferCSSPageSize)

## Objetivo
Resolver o problema do PDF gerado ficar cortado e esticado aplicando a inteligência de paginação por via do CSS nativo.

## Escopo Atômico
1. **`apps/api/src/converters.ts`**:
   - Atualizar a função `convertToPDF`.
   - Adicionar `await page.addStyleTag({...})` injetando `@page { size: A4; margin: 15mm; }` e regras de `page-break-inside: avoid;` para proteger blocos.
   - Modificar os argumentos de `page.pdf()` substituindo `format: 'A4'` e as margens fixas por `preferCSSPageSize: true`.

## Critérios de Aceitação
- Conteúdos do HTML que passam do limite da página devem saltar graciosamente para a próxima folha.
- Margens adequadas nas bordas para evitar que o conteúdo encoste no limite do papel.
- Manutenção do Dark Mode/Estética Rich definida (`printBackground: true`).

## Status
[INVALIDATED - PIVOT]
