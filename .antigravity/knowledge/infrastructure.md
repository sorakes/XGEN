# Infrastructure - XGEN

- **Arquitetura de Container:** Single Container (1 único Dockerfile unificado).
- **Processos Internos (via entrypoint shell script):**
  1. `redis-server`: Processo leve rodando no background para suportar a fila do BullMQ.
  2. `node server.js`: Processo principal da aplicação Node que levanta a API, serve o Painel Web, atende as chamadas MCP e aciona os workers do BullMQ.
- **Dependências do OS no Container:**
  - Bibliotecas base para rodar o Puppeteer/Chromium sem sandbox (`libnss3`, `libxss1`, `libasound2`, `fonts-liberation`, etc).
  - Ambiente para manipulação de arquivos estáticos.
- **Armazenamento (Volumes):**
  - Diretório para persistir a base SQLite (`/app/data`).
  - Diretório para arquivos gerados temporariamente (`/app/exports`).
