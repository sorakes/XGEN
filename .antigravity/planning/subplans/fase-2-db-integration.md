# Subplan: Fase 2 - Banco de Dados e Chaves de API

**Objetivo Específico:** Preparar o armazenamento local usando SQLite e o Prisma ORM para salvar as chaves de API necessárias (LLM e Geração de Imagens), e criar os endpoints básicos da API para interagir com essas chaves e visualizá-las no Painel Web.

## Etapas Lógicas
1. Inicializar o Prisma no diretório `/apps/api` para SQLite.
2. Criar a tabela (Model) `Settings` no `schema.prisma` contendo colunas como `openai_key`, `pexels_key`, `max_retries`, etc.
3. Criar os endpoints CRUD (`GET /settings`, `POST /settings`) na API Express.
4. Conectar o Next.js (Painel Web) a essa API para leitura e gravação destas chaves.

**Status Atual:** Iniciando planejamento (Etapa 1).
