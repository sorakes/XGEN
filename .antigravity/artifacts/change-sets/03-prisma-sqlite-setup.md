# Change Request 03 - Configuração Prisma ORM + SQLite

**Data:** 2026-05-14
**Etapa:** Fase 2 (Integração de DB)

### O que foi alterado:
1. Instalado `@prisma/client` e `prisma` no backend (`apps/api`).
2. Criado o arquivo `schema.prisma` definindo os modelos:
   - `Settings`: Para salvar chaves Pexels/LLM e configurações de recursividade (max retries).
   - `DocumentJob`: Para persistir na interface web o histórico de documentos gerados (PDF, DOCX) enviados pelo BullMQ.
3. Banco de dados SQLite inicializado localmente via `prisma db push`.

### Por que foi alterado:
Atendendo à seleção da Opção 1 (Prisma ORM + SQLite), este setup nos garante forte tipagem via TypeScript, prevenindo erros de sintaxe quando integrarmos as configurações no Painel Web. A adição da tabela `DocumentJob` visa satisfazer a premissa de um dashboard funcional para acompanhar travamentos e erros conforme as diretrizes do usuário.

### Impacto no Sistema:
- O backend Express agora possui acesso nativo e tipado ao banco local (`dev.db`).
- Adiciona um passo de compilação extra (necessidade do `prisma generate`) mas garante estabilidade na tipagem.

### Como testar:
No diretório `apps/api`, o desenvolvedor pode rodar `npx prisma studio` para abrir um painel visual e ver o banco de dados e as tabelas recém-criadas.
