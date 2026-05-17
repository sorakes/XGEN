# Pivot de Rota 01 - Redesign do Painel Web

**Data:** 2026-05-14
**Motivo:** O usuário exigiu que o painel suporte múltiplos provedores de LLM e Imagem, navegação por Abas e um Drawer lateral para monitorar a Queue de Jobs.

### O que foi invalidado:
- A interface atual de Settings é simplista demais (apenas 1 campo de LLM e 1 de Pexels).
- Não existe visualização de Queue no front.

### O que será reaproveitado:
- O backend Express, o BullMQ Worker e o Agent LangGraph permanecem intactos.
- A lógica de Glassmorphism e Dark Theme do `globals.css` será reutilizada.

### Novo Escopo:
1. Prisma Schema expandido com campos para: OpenAI, Ollama, OpenRouter, Pexels, ComfyUI.
2. Frontend com sistema de Abas: "LLM Providers", "Image Providers", "Engine Settings".
3. Drawer lateral deslizante com tabela de Jobs em tempo real.
