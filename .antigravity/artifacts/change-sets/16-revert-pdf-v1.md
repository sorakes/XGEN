# Change Set: Reversão Absoluta para PDF V1 (Opção 2)

## Arquivos Modificados
1. `apps/api/src/converters.ts`
2. `apps/api/src/agent.ts`

## Descrição da Mudança
- **Motor do PDF:** A função `convertToPDF` foi totalmente limpa. Foram removidos o `addScriptTag`, o `addStyleTag`, as configurações de `setViewport` e a injeção nativa de cabeçalhos/rodapés do Puppeteer. O motor agora apenas abre a página, escuta a rede, e gera um PDF A4 com margens zero.
- **Engenharia de Prompt:** O "Cérebro" do PDF no LangGraph (`agent.ts`) foi reescrito para incluir novas "Regras Absolutas". O modelo agora é intimado a incluir manualmente a tag `<script>` do TailwindCDN e também a desenhar os rodapés com paginação ou textos premium no fundo de suas seções em HTML.

## Impacto no Sistema
O design visual retorna exatamente para o formato incrível que gerou o arquivo de testes inicial (A 1). O sistema perde um pouco de previsibilidade (se a IA "alucinar", o design quebra), mas ganha o controle estético 100% focado no LLM (fundo Full Bleed perfeito, sombras e estilos intactos).
