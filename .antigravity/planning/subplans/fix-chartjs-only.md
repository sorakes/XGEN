# Subplan: Renderização de Gráficos Local (Chart.js)

## Objetivo
Eliminar de forma permanente os erros "Invalid Token" do QuickChart instruindo a IA a renderizar os gráficos puramente no cliente (Puppeteer) usando `<canvas>` e instanciando o Chart.js, proibindo requisições HTTP mal formatadas.

## Escopo Atômico
1. **`apps/api/src/agent.ts`**:
   - Alterar o trecho do prompt do LLM que permitia o uso de "quickchart.io".
   - Inserir proibição explícita contra APIs de geração de imagens baseadas em URL.
   - Obrar a importação do CDN do Chart.js e a codificação do script gráfico inline.

## Critérios de Aceitação
- A IA nunca gerará tags `<img src="https://quickchart.io...">` que quebram facilmente.
- Gráficos continuarão sendo renderizados com sucesso através da execução de JavaScript local.

## Status
[DONE]
