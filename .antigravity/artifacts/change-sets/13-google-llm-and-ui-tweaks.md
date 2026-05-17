# Change Request 13 - Google LLM, Progresso da Fila e Extração HTML Pura

**Data:** 2026-05-14
**Etapa:** Melhorias UI e Agente

### O que foi alterado:
1. **Schema Prisma**: Adicionado `google_key` e `google_model`. Adicionado `current_step` ao `DocumentJob` para acompanhar a etapa exata em que a geração se encontra.
2. **Frontend (`page.tsx`)**: 
   - Incluído card do Google Gemini na aba de LLMs.
   - O Drawer da Queue agora exibe o progresso em tempo real (ex: "Gerando Design (1/3)", "Revisão QA (2/3)") com um spinner animado enquanto o job está `processing`.
3. **Backend (`agent.ts` e `index.ts`)**:
   - Integração do modelo `@langchain/google-genai` para usar o Gemini.
   - Implementado um **Regex agressivo para limpeza** do conteúdo recebido da LLM. Remove completamente blocos de código Markdown (````html`), notas explanatórias e "pensamentos", extraindo estritamente da tag `<html>` à `</html>` (ou array JSON).
   - O `agent.ts` agora envia callbacks de progresso para o `index.ts`, que atualiza a coluna `current_step` em tempo real.

### Impacto:
- Resolvido o problema de LLMs incluírem diálogos ao longo do documento.
- Visibilidade muito maior na Queue: o usuário pode acompanhar o vai-e-vem da IA no loop de auto-correção.
- Expandido ecossistema com suporte ao Gemini.
