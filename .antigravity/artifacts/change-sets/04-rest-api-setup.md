# Change Request 04 - API REST para Configurações

**Data:** 2026-05-14
**Etapa:** Fase 2 (Integração de DB)

### O que foi alterado:
1. Atualizado o arquivo `index.ts` do backend para instanciar o `PrismaClient`.
2. Criada a rota `GET /api/settings` que retorna as chaves do sistema (e injeta um registro padrão caso o banco esteja limpo).
3. Criada a rota `PUT /api/settings` para receber cargas úteis (JSON) e atualizar as chaves de LLM, Pexels e limite de recursividade.

### Por que foi alterado:
Atendendo à seleção da Opção 1 (REST Clássico), os endpoints garantirão que as interações do Painel Web não acessem diretamente o SQLite. O banco fica seguro e centralizado atrás do Express. Isso protege contra corrupção de banco caso tenhamos centenas de execuções simultâneas e mantém a arquitetura limpa.

### Impacto no Sistema:
- A camada de dados da API está 100% funcional.
- Agora a porta principal de tráfego de dados para a Fase 2 está aberta.
- Passaremos para a integração Front-End.

### Como testar:
Rodando a API (`npm run dev` na pasta `apps/api`), realize uma chamada GET via cURL ou Postman para `http://localhost:3001/api/settings`. O primeiro retorno gerará o perfil padrão automaticamente.
