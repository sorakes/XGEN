# XGEN - MCP Document Generator

## Objetivo Final
Criar um servidor MCP corporativo unificado (Single Docker) que atenda requisições do OpenWebUI para gerar arquivos premium (PDF, DOCX). O sistema usará uma arquitetura agentiva de loop de feedback contínuo (recursividade) para garantir qualidade e design incomparáveis. Contará com um Painel Web de gerenciamento de chaves e visualização de filas/jobs.

## RoadMap de Alto Nível (Milestones)

- [DONE] Fase 1: Setup da Base e Infraestrutura (Node.js, Express, Next.js, Redis, BullMQ).
- [DONE] Fase 2: Integração de Chaves de API e Configurações Dinâmicas (SQLite/Painel Web).
- [DONE] Fase 3: Engine de Geração Agentiva e Recursividade (Fluxo de Auto-avaliação LLM).
- [DONE] Fase 4: Conversores Nativos de Geração e Exportação (HTML para PDF via Puppeteer e DOCX).
- [DONE] Fase 5: Dockerização Unificada e Módulos de Expansão.
- [DONE] Fase 6: Correção de Persistência de Dados no Docker (SQLite e Redis).
- [DOING] Fase 7: Correção do Layout e Estabilidade do PDF (A4).
