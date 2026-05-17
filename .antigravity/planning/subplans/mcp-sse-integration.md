# Subplan: Integração MCP SSE

## Objetivo
Mudar o protocolo de comunicação do servidor MCP de `stdio` para HTTP SSE (Server-Sent Events) para permitir a conexão nativa com o Open WebUI.

## Escopo Atômico
1. **`apps/api/src/index.ts`**:
   - Injetar o servidor MCP (`@modelcontextprotocol/sdk`) diretamente dentro da API do Express que já existe na porta 3001.
   - Criar os endpoints `/mcp/sse` e `/mcp/messages`.
   - Adicionar o manipulador das ferramentas (`ListToolsRequestSchema` e `CallToolRequestSchema`).

## Critérios de Aceitação
- O Open WebUI conseguirá conectar no endpoint `/mcp/sse` e listar a ferramenta de geração.
- A ferramenta, ao ser invocada pela IA do chat, criará um Job na fila (Redis) do XGEN.

## Status
[DONE]
