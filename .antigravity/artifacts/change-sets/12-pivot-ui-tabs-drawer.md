# Change Request 12 - Pivot UI: Abas + Multi-Provedores + Queue Drawer

**Data:** 2026-05-14
**Etapa:** Pivot de Rota (Redesign do Painel)

### O que foi alterado:
1. **Schema Prisma expandido**: 12 novos campos adicionados para suportar OpenAI, Ollama, OpenRouter, Pexels, ComfyUI e Gemini Images. Incluídos campos `active_llm` e `active_image` para seleção do provedor ativo.
2. **API `/api/settings`**: O endpoint PUT agora aceita payload dinâmico, gravando qualquer campo do Settings.
3. **API `/api/jobs`**: Novo endpoint GET retornando os últimos 50 jobs ordenados por data de criação.
4. **Frontend completamente reescrito**: Navegação por Abas (LLM Providers, Image Providers, Engine), cards de provedor com botão "Activate", e Drawer lateral deslizante com auto-refresh a cada 5 segundos mostrando todos os jobs.

### Impacto:
- O painel agora é uma ferramenta de administração real, não mais um formulário simples.
- Cada provedor tem seu próprio card visual com status "Active" destacado em Indigo.
