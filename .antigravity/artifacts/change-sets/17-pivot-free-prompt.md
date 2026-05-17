# Pivot de Rota: Restauração da Liberdade Criativa (Prompt)

## Motivo do Pivot
Após removermos as travas do Puppeteer (Voltando à V1 do `converters.ts`), o PDF gerado ainda ficou "podre" (com bordas brancas enormes e design xoxo). A análise concluiu que o problema real está no **Prompt do Agente (`agent.ts`)**. O usuário "mexeu bastante no código" antes de pedir ajuda e encheu o prompt de regras matemáticas rígidas (`width: 210mm`, `min-h-[297mm]`, `@page { margin: 0 }`). Essas regras artificiais estão matando a criatividade natural da IA e quebrando o grid do Tailwind, causando as bordas brancas (escala incorreta) e o design feio.

## Estado Atual
O `converters.ts` está limpo (`format: 'A4', margin: 0`). Mas o `agent.ts` ainda possui as restrições mecânicas injetadas pelo usuário tentando consertar o A4 no passado.

## Novo Objetivo
Apagar as "gambiarras matemáticas" do prompt do PDF no `agent.ts` e devolver o poder criativo livre para a LLM, exigindo apenas estética premium e injeção do TailwindCDN, sem engessar as dimensões no HTML.
