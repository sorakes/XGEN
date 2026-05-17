# Change Request 09 - Dockerização Single-Container Unificada

**Data:** 2026-05-14
**Etapa:** Fase 5 (Dockerização Unificada)

### O que foi alterado:
1. Criado o `Dockerfile` absoluto de produção utilizando `node:20-bullseye`. Ele instala as dependências pesadas do sistema operacional (Redis nativo, Supervisord e Chromium para a renderização do PDF).
2. Criado o orquestrador `supervisord.conf` garantindo que:
   - Redis suba primeiro (Priority 1)
   - Servidor Express/Worker do BullMQ suba em seguida (Priority 2)
   - Painel Web Next.js suba por último (Priority 3)
3. Todas as instâncias são monitoradas nativamente pelo container e falhas em um script reiniciam isoladamente seu processo.

### Por que foi alterado:
O usuário escolheu a Opção 1, seguindo o padrão ouro corporativo. Como a comunicação stdio do MCP não pode conflitar com os logs do Docker, essa arquitetura abre uma porta perfeita: O usuário rodará a imagem Docker em background (Daemon), e quando o OpenWebUI precisar acionar o MCP, ele usará um comando pass-through como `docker exec -i xgen-container node apps/api/dist/mcp-server.js`. O container agora roda múltiplas instâncias como um micro-servidor.

### Impacto no Sistema:
- O projeto pode ser implantado em qualquer máquina corporativa sem vazamento de dependências.
- O painel ficará permanentemente online na porta 3000 e o banco Redis interno não conflitará com outros bancos da empresa.
- **Toda a codificação primária e a arquitetura foram dadas como concluídas.**
