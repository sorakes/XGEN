# Change Request 06 - Servidor MCP Stdio e Integração BullMQ

**Data:** 2026-05-14
**Etapa:** Fase 3 (Engine Agentivo)

### O que foi alterado:
1. Instalado e implementado o `@modelcontextprotocol/sdk` em `/apps/api/src/mcp-server.ts`.
2. O Servidor MCP agora declara oficialmente a ferramenta `generate_premium_document` para o OpenWebUI.
3. Ao ser chamada, a tool não processa o documento na hora; ela insere o `DocumentJob` no SQLite e despacha a requisição para a fila Redis do BullMQ.
4. O servidor principal HTTP (`index.ts`) foi modificado para ser simultaneamente um `Worker` do BullMQ, monitorando a fila e gerenciando o status da geração.

### Por que foi alterado:
O usuário aprovou a arquitetura stdio + BullMQ. Essa é uma solução extremamente resiliente. Impede que o OpenWebUI desconecte por timeout, isola o fluxo de chamadas e prepara a fundação em branco ("TO-DO") onde nosso agente de LangChain.js vai rodar durante vários minutos sem derrubar a API REST do Painel.

### Impacto no Sistema:
- O ecossistema está "costurado". OpenWebUI chama o MCP -> O MCP empurra na Queue e salva no DB -> O Worker detecta e inicia a geração pesada no background.
- É possível iniciar o MCP via comando: `npx ts-node src/mcp-server.ts` dentro de `apps/api`.
- O caminho está livre para iniciar o código da "Magia": A construção do loop da LLM.
