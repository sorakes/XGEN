# Subplan: Fase 1 - Setup da Base e Infraestrutura Node

**Objetivo Específico:** Estruturar o monorepo em Node.js (TypeScript), configurando os serviços isolados de API (Express), Frontend (Next.js) e Fila (BullMQ), finalizando com a preparação do container que hospedará tudo com um Redis embutido.

## Etapas Lógicas

1. Inicializar o ecossistema base (`package.json`, `tsconfig.json`).
2. Implementar a estrutura de pastas do Monorepo ou estrutura de pastas modular unificada (`/src/api`, `/src/web`, `/src/workers`).
3. Criar a base do servidor Express.
4. Criar a base do Painel Web Next.js.
5. Elaborar o `Dockerfile` e o `entrypoint.sh` para rodar Node e Redis em conjunto de forma silenciosa e eficaz.

**Status Atual:** Iniciando planejamento estrutural (Etapa 1 e 2).
