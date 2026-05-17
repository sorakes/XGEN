# Change Set: Integração MCP SSE (Open WebUI)

## Arquivos Modificados
1. `apps/api/src/index.ts`

## Descrição da Mudança
- **Refatoração de Protocolo MCP:** Abandonamos a dependência estrita do protocolo `stdio` (linha de comando) para acomodar a versão atual do Open WebUI do usuário, que suporta prioritariamente o `MCP HTTP com streaming`.
- **Injeção no Express:** Instanciamos o `Server` do `@modelcontextprotocol/sdk` diretamente dentro do ciclo de vida da API principal do Express (porta 3001).
- **Criação de Endpoints:** Adicionamos as rotas `/mcp/sse` (para iniciar o Server-Sent Events) e `/mcp/messages` (para o Open WebUI trafegar os parâmetros JSON da ferramenta).

## Impacto no Sistema
O XGEN Enterprise agora é plug-and-play com qualquer interface de chat que suporte conexões MCP HTTP externas. A ferramenta `generate_premium_document` passa a ser listada na rede HTTP, engatilhando a fila nativa do BullMQ de forma assíncrona. O usuário final passa a ter uma IA dentro do chat que consegue encomendar a criação de planilhas complexas e PDFs diagramados sem sair da interface de conversação.
