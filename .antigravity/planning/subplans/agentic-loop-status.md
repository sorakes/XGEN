# Subplan: Loop Agentivo e Entrega de Arquivos

## Objetivo
Criar uma arquitetura de polling agentivo no Open WebUI. A IA deve ser capaz de monitorar ativamente a fila de processamento do XGEN (BullMQ/Redis) e, ao detectar a conclusão, gerar e entregar o link de download final do arquivo diretamente na interface do chat para o usuário.

## Escopo Atômico
1. **`apps/api/src/index.ts` (API Core)**:
   - Adicionar a rota GET `/api/jobs/:id` para permitir consulta unitária de status.
2. **`apps/api/src/index.ts` (OpenAPI)**:
   - Adicionar a definição da ferramenta secundária `check_xgen_job_status`.
   - Modificar a descrição da ferramenta de geração principal para instruir o LLM a engatilhar um loop de status até receber a string 'completed', convertendo o `file_url` final em um link Markdown de download.

## Critérios de Aceitação
- A IA assumirá um comportamento autônomo. Ao iniciar um job, ela verificará a ferramenta de status.
- O usuário não precisará mais abrir o Dashboard para baixar o arquivo; o link de download `http://host.../exports/...` aparecerá clicável na mensagem final da IA.

## Status
[DONE]
