# Change Request 10 - Refatoração do Compose para Single-Container

**Data:** 2026-05-14
**Etapa:** Finalização de Ambiente

### O que foi alterado:
1. O arquivo `docker-compose.yml` que continha apenas o Redis (para testes em desenvolvimento) foi completamente reescrito.
2. Ele agora orquestra o build do `Dockerfile` oficial criado na Fase 5.
3. Foi criado um mapeamento de volume físico (`./exports:/app/exports`), garantindo que os PDFs e DOCXs gerados pela IA não fiquem "presos" dentro do container, aparecendo na sua pasta de projetos real.

### Por que foi alterado:
O usuário solicitou para ele mesmo rodar o `docker compose up` da versão final no ambiente dele. Para que isso funcionasse obedecendo à lei magna de "1 único container para o projeto todo", o compose agora serve unicamente como um atalho elegante para compilar e iniciar o `xgen_enterprise` sem precisar digitar comandos longos no docker CLI.

### Impacto no Sistema:
- Quando o usuário rodar o comando, o container instalará seu próprio Redis em background (via `supervisord`), compilará a UI e a API, e ativará as portas 3000 e 3001. Tudo unificado.
