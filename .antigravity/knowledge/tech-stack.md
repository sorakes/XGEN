# Tech Stack - XGEN

- **Ambiente Central:** Node.js 20+ / TypeScript
- **Protocolo/Backend:** Express.js + `@modelcontextprotocol/sdk` (Integração direta como servidor HTTP/SSE ou stdio).
- **Frontend (Painel Web):** Next.js (com exportação estática servida pelo Express ou integrado no mesmo app) com **TailwindCSS** (se aprovado, ou Vanilla CSS para controle absoluto de design moderno) focado em **Rich Aesthetics**.
- **Fila de Tarefas:** BullMQ (Fila assíncrona baseada em Redis para acompanhar jobs, gerenciar travamentos e tentativas de recursão).
- **Banco de Dados Local:** SQLite (com Prisma ORM) para salvar chaves de API, logs de execuções e configurações de sistema.
- **Orquestração de IA:** LangChain.js / Vercel AI SDK para criar os fluxos de auto-correção (Reflection/Agentic loop).
- **Conversores de Arquivos:** 
  - *PDF:* Puppeteer (Chrome Headless) renderizando HTML de altíssima qualidade.
  - *DOCX:* html-to-docx ou docx.js nativo mesclado com a lógica de geração.
