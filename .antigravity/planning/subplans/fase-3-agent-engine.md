# Subplan: Fase 3 - Engine de Geração Agentiva

**Objetivo Específico:** Implementar o fluxo assíncrono usando BullMQ. Quando uma requisição MCP for acionada pelo OpenWebUI, ela cairá numa fila, e um Worker iniciará um loop agentivo (usando LLM) para rascunhar o HTML base do PDF/DOCX, injetar imagens Pexels, e iterar sobre o design.

## Etapas Lógicas
1. Setup e conexão real do BullMQ no Express (`Queue` e `Worker`).
2. Criação do SDK do MCP (`@modelcontextprotocol/sdk`) e do endpoint/stdio handler para captar solicitações do OpenWebUI.
3. Criação da State Machine/Agent (LLM) que tentará gerar o HTML, revisar e aplicar auto-correções estéticas baseado no limite de recursividade (max_retries).
4. Preparação da persistência de Jobs gerados no banco SQLite para monitoramento futuro no painel.

**Status Atual:** Iniciando (Definindo estrutura base da Fila e Protocolo).
