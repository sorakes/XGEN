# Change Request 07 - Core Agentivo (LangGraph) e Recursividade

**Data:** 2026-05-14
**Etapa:** Fase 3 (Engine de Geração)

### O que foi alterado:
1. Instalados os pacotes `@langchain/core`, `@langchain/openai`, `@langchain/langgraph` e `zod`.
2. Criada a arquitetura de Agente Autônomo em `apps/api/src/agent.ts`, contendo dois nós vitais:
   - `generateNode`: Assume o papel de *Designer Premium*, gerando código HTML complexo (Tailwind).
   - `reviewNode`: Assume o papel de *Diretor de Arte Rigoroso*, analisando o código gerado em busca de defeitos estéticos ou amadorismos.
3. Configurado um laço condicional (*Conditional Edge*): Se o crítico não disser "APROVADO", o código volta para o designer com as críticas incluídas no novo prompt, batendo o `max_retries` que o usuário escolher no Painel.
4. O `Worker` do BullMQ agora executa o agente real e salva a saída final validada em `/apps/api/exports/ID.html`.

### Por que foi alterado:
Atendendo à promessa arquitetural de **Recursividade**. Para entregarmos os melhores PDF/DOCX do mercado às empresas, o modelo LLM não pode ter uma resposta "one-shot" simples. O workflow em grafo garante que o arquivo sofra pressão de qualidade *antes* de ser enviado ao usuário, criando documentos realmente diferenciados e impressionantes.

### Impacto no Sistema:
- O backend agora tem plena capacidade de raciocínio crítico.
- O tempo de processamento por documento aumentará, mas a qualidade disparará.
- Falta apenas o estágio físico: Pegar esse arquivo `.html` gerado de forma majestosa e convertê-lo matematicamente num `.pdf` ou `.docx`.
