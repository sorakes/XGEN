# Subplan: Liberdade Criativa Absoluta (Prompt Reset)

## Objetivo
Apagar todas as diretivas matemáticas, regras de injeção de cores e restrições de dimensões (A4/milímetros) do prompt do PDF no `agent.ts`. A Inteligência Artificial terá 100% de liberdade criativa (Opção 1 expandida), mantendo apenas as instruções puramente funcionais que evitam a quebra mecânica do PDF (como importar o CDN e evitar rasgo de imagens).

## Escopo Atômico
1. **`apps/api/src/agent.ts`**:
   - Deletar todas as menções de `width: 210mm`, `@page { margin: 0 }`, e exigências de "cores escuras com dourado".
   - Refazer o prompt do zero com um texto focado apenas na *permissão para criar*, incentivando a imaginação livre de layouts modernos, mas exigindo a dependência básica do TailwindCSS.

## Critérios de Aceitação
- A IA vai escolher a paleta de cores inteiramente baseada no pedido dinâmico do usuário.
- O HTML gerado não vai mais conter o "container engessado" de tamanho fixo que causava as bordas brancas (escala defeituosa) e destruía a estética.
- O design retornará à organicidade das primeiras gerações (perfeito e sem padrões engessados).

## Status
[DONE]
