# Change Request 02 - Scaffold Total Frontend e Backend

**Data:** 2026-05-14
**Etapa:** Fase 1 (Setup da Base e Infraestrutura) -> Concluída

### O que foi alterado:
1. Criada a aplicação Next.js em `/apps/web` com TailwindCSS integrado (para UI Premium).
2. Criado o backend Express em `/apps/api` com configurações de TypeScript, bibliotecas do BullMQ, IORedis e rota de health check inicial (`/health`).
3. Adicionado o arquivo `docker-compose.yml` na raiz para o desenvolvedor simular e subir o Redis localmente durante a construção do app.
4. Executado o link das dependências no diretório root.

### Por que foi alterado:
O usuário solicitou que eu decidisse o melhor caminho para estruturação. Optei pelo **Scaffold Total + Redis Local**, pois adianta o ambiente de forma consistente para ambas as pontas. Agora, a monorepo funciona com duas aplicações independentes mas conectadas por tipos em TypeScript (via Workspace), e um banco Redis em background.

### Impacto no Sistema:
- Fim da arquitetura inicial vazia.
- A aplicação API pode ser executada por `npm run dev` dentro de `/apps/api`.
- A aplicação WEB pode ser executada por `npm run dev` dentro de `/apps/web`.
- Podemos iniciar e planejar a Fase 2 (Integração de DB e API Keys).

### Como testar:
No terminal, execute `docker compose up -d` para o Redis e, após, teste `turbo run dev` para validar o inicio simultâneo.
