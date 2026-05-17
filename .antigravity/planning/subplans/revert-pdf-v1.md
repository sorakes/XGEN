# Subplan: Reversão Absoluta à V1 (Opção 2)

## Objetivo
Desfazer todas as interferências arquiteturais na API do Puppeteer (injeções, paddings virtuais, rodapés nativos) e retornar ao estado original onde o Agente LLM tinha controle total e criava o HTML perfeitamente "Full Bleed" e lindo por conta própria.

## Escopo Atômico
1. **`apps/api/src/converters.ts`**:
   - Reverter a função `convertToPDF` para a versão exata do Dia 1 (sem `setViewport`, sem `addStyleTag`, sem `addScriptTag`, sem paginação do Puppeteer).
   - Manter apenas as margens `0` passadas no argumento `margin` do `page.pdf()`.
2. **`apps/api/src/agent.ts`**:
   - Adicionar uma regra firme no prompt do PDF exigindo que a LLM construa a tag `<head>` importando o Tailwind via CDN, garantindo que o CSS funcione sem a necessidade da injeção forçada do backend.

## Critérios de Aceitação
- O código da API do PDF deve ficar extremamente limpo.
- A responsabilidade de manter o design incrível, cores e bordas será 100% da inteligência da LLM gerando HTML puro estruturado.

## Status
[INVALIDATED - PIVOT]
