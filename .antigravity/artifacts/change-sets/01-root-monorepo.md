# Change Request 01 - Setup Base do Monorepo

**Data:** 2026-05-14
**Etapa:** Fase 1 (Setup da Base e Infraestrutura)

### O que foi alterado:
1. Criado o arquivo `package.json` na raiz configurando **npm workspaces** (`apps/*` e `packages/*`).
2. Instalado o `turbo` (Turborepo) globalmente no projeto para orquestração de scripts (`build`, `dev`, `lint`).
3. Criado o `turbo.json` mapeando as pipelines de compilação.
4. Criadas as pastas físicas `/apps` e `/packages`.

### Por que foi alterado:
O usuário aprovou a **Opção 2** (Monorepo Real com Turborepo). Esta base permite que o Painel Web (Next.js) e a API MCP (Express/TypeScript) compartilhem código e processos de forma modular, mas sem estarem espaguetados. Essa escolha eleva a qualidade de software do XGEN.

### Impacto no Sistema:
- O diretório raiz agora se comporta como um orquestrador.
- Novos projetos devem ser criados obrigatoriamente dentro de `/apps/`.
- Permite futuramente rodar `npm run dev` na raiz e iniciar todos os serviços simultaneamente.
- **Riscos:** Maior complexidade para o arquivo Docker final, que exigirá a cópia isolada de workspaces (Multistage Docker com turbo-prune).

### Como testar:
Execute `npm run build` ou `npm run dev` na raiz (atualmente não fará nada pois os apps não existem, mas o Turbo deve ser acionado sem erros de sistema).
