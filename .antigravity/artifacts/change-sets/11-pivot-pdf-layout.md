# Pivot de Rota: Layout PDF Edge-to-Edge

## Motivo do Pivot
O usuário relatou que a adoção de margens fixas corporativas (`15mm`) no `@page` gerou uma borda branca indesejada, limitando o design estético que antes utilizava toda a largura da página (Full Bleed / Edge-to-Edge).

## Estado Atual
A função `convertToPDF` está usando `preferCSSPageSize: true` com `@page { size: A4; margin: 15mm; }` e injetando regras de quebra de página (`page-break-inside: avoid`).

## Novo Objetivo
Atingir uma renderização A4 que vá de ponta a ponta (sem bordas brancas), mantendo o `printBackground: true`, mas solucionando o problema original de cortes do conteúdo entre as quebras de página.
