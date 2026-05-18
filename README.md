<div align="center">
  <img src="assets/XGEN.gif" alt="XGEN Enterprise Demo" width="100%">
</div>

# XGEN Enterprise

**XGEN Enterprise** é um motor assíncrono de geração de documentos de alto padrão. Projetado para atuar como um *Agente Especializado*, o XGEN é capaz de transformar instruções de linguagem natural em relatórios premium (PDF), documentos de texto estilizados (DOCX) e planilhas complexas formatadas (XLSX).

Ele opera integrado a plataformas de Chat IA (como o **OpenWebUI**) através do protocolo OpenAPI. O XGEN utiliza uma arquitetura inteligente de bloqueio síncrono na rota HTTP principal, garantindo que a IA do chat espere toda a renderização do arquivo terminar e entregue apenas o Link final de download na tela para o usuário.

## 🚀 Funcionalidades
- **Suporte Multi-Modelos:** Conecte-se com OpenAI (GPT-4o), Anthropic (Claude via OpenRouter), Google (Gemini) e Ollama local através do Dashboard.
- **Integração OpenWebUI Final:** Conexão Plug & Play extremamente estável usando a rota OpenAPI oficial (`openapi.json`).
- **Geração Assíncrona e Filas (BullMQ):** Nunca perca um documento. O sistema de filas baseado em Redis com interface via terminal e via Dashboard garante a escalabilidade das requisições e reinício das tarefas falhas.
- **Relatórios Premium em Alta Qualidade:** PDFs desenhados via HTML/CSS moderno (*Tailwind* e layouts de design ricos) acoplados ao *Chart.js* via headless *Puppeteer*, focando em "estética rica" e layouts *dark mode* dinâmicos.
- **Planilhas Inteligentes (XLSX):** Motor `ExcelJS` integrado que estrutura colunas, adiciona coloração em cabeçalhos (Indigo) e impõe formatação condicional (ex: números negativos em vermelho).

## 🛠️ Tecnologias Utilizadas
- **Backend:** Node.js, Express, TypeScript
- **Banco de Dados:** SQLite (Prisma ORM), Redis (Filas)
- **Renderização de Engine:** Puppeteer (Chromium Engine), ExcelJS, HTML-to-DOCX
- **Orquestração de Prompt/Agent:** LangChain, LangGraph

## ⚙️ Instalação e Execução

O XGEN utiliza uma arquitetura baseada em contêineres Docker robusta (o App, a API e o Redis sobem todos amarrados e monitorados pelo Supervisord). O setup inicial leva poucos segundos.

1. Clone o repositório na sua máquina de uso principal.
2. Inicie a infraestrutura:
```bash
docker-compose up -d --build
```
3. O Backend (motor de geração) estará ouvindo na porta `3001` (por padrão).
4. O Dashboard e a tela de configurações e filas web estarão disponíveis na porta `3000`.

## 🔌 Como Integrar no OpenWebUI

A integração é feita usando o protocolo nativo **OpenAPI** do XGEN, o que força a sua IA do OpenWebUI a aguardar pacientemente a renderização final do arquivo antes de entregar a resposta do chat.

1. Abra o **OpenWebUI** e vá em `Configurações > Configurações de Admin > Integrações`.
2. Adicione uma nova conexão no menu lateral.
3. No campo **Tipo** (canto superior), altere de `MCP` para **OpenAPI**.
4. No campo **URL Base da API**, digite exatamente isto:
   `http://host.docker.internal:3001`
   *(Nota: Se estiver rodando no Linux ou em ambientes onde o internal host é ignorado, utilize o IP do host da rede local, ex: `http://192.168.0.x:3001`)*
5. Clique no botão verde de atualizar 🔄 para carregar as instruções da ferramenta.
6. Clique em **Salvar**.

### Testando a Ferramenta no Chat
Ative a chavinha de Ferramentas (`Tools / +`) no seu chat, certifique-se de usar um modelo com suporte robusto a *Tool Calling* (como `GPT-4o` ou `Claude 3.5 Sonnet`) e mande um prompt como:

> *"Você agora está conectada ao gerador XGEN Enterprise. Gere para mim um relatório tático de projeção do mercado imobiliário para os próximos 3 anos. Entregue em formato PDF usando a ferramenta de geração do XGEN."*

O OpenWebUI mostrará a bolinha "Calling Tool / Chamando Ferramenta..." rodando na tela. Ele vai esperar aproximadamente 40 segundos. Assim que o motor interno do Docker finalizar o layout e salvar o arquivo estático na pasta `/exports`, o chat receberá a resposta 200 OK e soltará o texto para você com o **Link Markdown** direto e clicável.
