# Change Request 08 - Conversores Nativos (Puppeteer e DOCX)

**Data:** 2026-05-14
**Etapa:** Fase 4 (Conversão e Exportação)

### O que foi alterado:
1. Instaladas as dependências `puppeteer` e `html-to-docx`.
2. Criado o módulo em `apps/api/src/converters.ts` encapsulando as duas funções primordiais de exportação:
   - `convertToPDF`: Abre o Chrome em modo Headless, injeta o CSS/HTML, e aguarda as conexões externas de CDN estabilizarem para "imprimir" com alta fidelidade de background-color.
   - `convertToDOCX`: Lida com o mapeamento matemático das tags geradas pela IA e exporta em Buffer binário nativo para .docx.
3. O `index.ts` foi refatorado para servir a pasta `/exports` estaticamente (permitindo downloads do Front) e agora o Worker aciona a função de conversão exata baseada na intenção do usuário (`documentType`).

### Por que foi alterado:
Selecionada a Opção 1 pelo usuário. Essa é a base do software XGEN: a promessa de converter rascunhos estéticos agentivos em arquivos reais e baixáveis que o OpenWebUI solicitou.

### Impacto no Sistema:
- O ciclo vital do software está completo. A requisição vai do MCP -> Fila -> Agente Criticador -> HTML -> Conversor -> Link de Download.
- Prepara o terreno para o último desafio da infraestrutura de deploy corporativa: Dockerizar tudo isso.
