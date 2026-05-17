# Subplan: Sanitização Absoluta e Deploy (V1)

## Objetivo
Preparar o código para o primeiro Release Público no GitHub, garantindo que nenhum dado confidencial (chaves de API OpenAI/Anthropic/Supabase), lixo de logs ou históricos do SQLite subam para o repositório público. 

## Escopo Atômico
1. **Limpeza Local**:
   - Deletar fisicamente o arquivo `.db` (banco de dados local que guarda as configurações e chaves da API).
   - Deletar arquivos `.pdf` temporários usados para debug.
   - Deletar pastas `.git` aninhadas quebradas (ex: `apps/web/.git`) para formar um MonoRepo limpo.
2. **Escudos do `.gitignore`**:
   - Criar um `.gitignore` raiz protegendo pastas críticas (`exports/`, `node_modules/`, `*.db`, `.env`).
3. **Comandos Git**:
   - Inicializar repositório vazio na raiz.
   - Forçar Push (`--force`) para a URL remota: `https://github.com/sorakes/XGEN`.

## Critérios de Aceitação
- Nenhum arquivo sensível será incluído no Payload do Git.
- O repositório Github receberá o código-fonte limpo com a arquitetura `agent.ts` consertada.

## Status
[DONE]
