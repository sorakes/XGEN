# Subplan: Pivot - Redesign Completo do Painel Web

**Objetivo:** Refatorar o frontend e o schema para suportar múltiplos provedores e navegação por abas com drawer lateral.

## Etapas
1. Atualizar `schema.prisma` com novos campos de provedores.
2. Regenerar Prisma Client e aplicar migração.
3. Atualizar endpoints `GET/PUT /api/settings` + criar `GET /api/jobs`.
4. Reescrever `page.tsx` com sistema de Abas e Drawer.

**Status:** Iniciando implementação.
