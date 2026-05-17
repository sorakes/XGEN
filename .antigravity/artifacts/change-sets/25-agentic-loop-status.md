# Change Set: O Loop Agentivo de Fila (OpenAPI)

## Arquivos Modificados
1. `apps/api/src/index.ts`

## Descrição da Mudança
- **Nova Rota de Consulta REST:** Adicionamos a rota GET `/api/jobs/:id` que expõe a telemetria ao vivo de um Job na fila (status atual, passos de execução e url do arquivo final).
- **Injeção de Ferramenta Secundária:** O OpenAPI `openapi.json` foi atualizado para expor uma **segunda ferramenta** ao modelo de linguagem (`check_xgen_job_status`).
- **Prompt Engineering no Manifesto:** As instruções da ferramenta base foram severamente alteradas. A IA agora é instruída de forma dogmática a NÃO responder imediatamente após iniciar a geração, mas sim ativar um *Loop Interno*, chamando a ferramenta de checagem sucessivamente até que o backend avise que terminou.

## Impacto no Sistema
Transformamos a IA do Open WebUI de um mero "disparador de requisições" em um **Agente Monitorador Autônomo**. O usuário terá uma experiência contínua no chat. A IA fará a requisição, perceberá que a máquina está rodando nos fundos, e só vai enviar a mensagem final para o usuário quando extrair com sucesso o `file_url`, entregando um link formatado em Markdown pronto para clique e download. O arquivo final vive na pasta estática `/exports` servida pelo Express.
