# Change Set: Desativação do QuickChart.io

## Arquivos Modificados
1. `apps/api/src/agent.ts`

## Descrição da Mudança
- **Bloqueio de API de Imagens:** O uso da API `quickchart.io` via URL de imagem foi explicitamente proibido no prompt do agente.
- **Força Bruta do Canvas:** O LLM agora é treinado a incluir a biblioteca `Chart.js` nativa no HTML e instanciar gráficos com tags `<canvas>`.
- **Prevenção de Falhas Sintáticas:** Isso tira a pressão da LLM de ter que fazer o "URL Encoding" perfeito em um string JSON dentro da tag de imagem, trocando pela escrita de blocos padrão `<script>` que a LLM executa com excelência.

## Impacto no Sistema
As imagens temporárias brancas com a mensagem vermelha de "Invalid Token" desaparecerão definitivamente dos PDFs. Em seu lugar, veremos gráficos dinâmicos de alta qualidade renderizados pela engine do próprio Puppeteer sem depender da rede externa do quickchart.
