<div align="center">
  <img src="assets/XGEN.gif" alt="XGEN Enterprise Demo" width="100%">
</div>

# XGEN Enterprise

**XGEN Enterprise** é um motor assíncrono de geração de documentos de alto padrão. Projetado para atuar como um *Agente Especializado*, o XGEN é capaz de transformar instruções de linguagem natural — e as **imagens que o usuário manda no chat** — em relatórios premium (PDF), apresentações (PPTX), documentos de texto estilizados (DOCX) e planilhas complexas formatadas (XLSX).

Ele opera integrado a plataformas de Chat IA (como o **OpenWebUI**) através do protocolo OpenAPI. O XGEN utiliza uma arquitetura inteligente de bloqueio síncrono na rota HTTP principal, garantindo que a IA do chat espere toda a renderização do arquivo terminar e entregue apenas o Link final de download na tela para o usuário.

## 🚀 Funcionalidades
- **Suporte Multi-Modelos:** Conecte-se com OpenAI (GPT-4o), Anthropic (Claude via OpenRouter), Google (Gemini) e Ollama local através do Dashboard.
- **Integração OpenWebUI Final:** Conexão Plug & Play extremamente estável usando a rota OpenAPI oficial (`openapi.json`).
- **Geração Assíncrona e Filas (BullMQ):** Nunca perca um documento. O sistema de filas baseado em Redis com interface via terminal e via Dashboard garante a escalabilidade das requisições e reinício das tarefas falhas.
- **Apresentações PPTX:** slides 16:9 desenhados e medidos como as páginas do PDF, entregues prontos para apresentar (cada slide é uma imagem em alta resolução; o texto vai nas anotações do apresentador).
- **Imagens do chat:** o usuário anexa fotos, logos ou prints no OpenWebUI e o XGEN lê cada imagem (visão), decide se ela vira fundo de página/slide inteiro, destaque, ilustração ou logo — ou segue o que o usuário pediu — e a encaixa no tamanho certo: sem distorcer, sem pixelar e sem estourar a página (tudo medido no browser).
- **Layout livre:** a LLM continua criando o layout sozinha. O XGEN só traz orientação de design (anti "cara de IA", inspirada no [huashu-design](https://github.com/alchaincyf/huashu-design)) e regras duras de dimensão.
- **Relatórios Premium em Alta Qualidade:** PDFs desenhados via HTML/CSS moderno (*Tailwind* e layouts de design ricos) acoplados ao *Chart.js* via headless *Puppeteer*, focando em "estética rica" e layouts *dark mode* dinâmicos.
- **Planilhas Inteligentes (XLSX):** Motor `ExcelJS` integrado que estrutura colunas, adiciona coloração em cabeçalhos (Indigo) e impõe formatação condicional (ex: números negativos em vermelho).

## 🛠️ Tecnologias Utilizadas
- **Backend:** Node.js, Express, TypeScript
- **Banco de Dados:** SQLite (Prisma ORM), Redis (Filas)
- **Renderização de Engine:** Puppeteer (Chromium Engine), PptxGenJS, ExcelJS, HTML-to-DOCX, Sharp (imagens)
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

O XGEN oferece a **mesma ferramenta** (`generate_document`) de duas formas. Escolha **UMA** delas:

> ⚠️ **Importante:** não cadastre o XGEN como MCP **e** OpenAPI ao mesmo tempo. Com as duas ativas, o modelo pode chamar a ferramenta duas vezes. (O XGEN ainda deduplica pedidos idênticos, mas é melhor não depender disso.)

### Opção A — MCP (recomendado)
1. No **OpenWebUI**, vá em `Configurações > Configurações de Admin > Integrações` e adicione uma conexão.
2. **Tipo:** `MCP (Streamable HTTP)`.
3. **URL:** `http://host.docker.internal:3001/mcp`
   *(No Linux, use o IP do host na rede local, ex: `http://192.168.0.x:3001/mcp`.)*
4. **Headers** (para as imagens do chat chegarem ao XGEN):
   ```json
   {"X-OpenWebUI-Chat-Id": "{{CHAT_ID}}", "X-OpenWebUI-Message-Id": "{{MESSAGE_ID}}"}
   ```
5. Salve.

### Opção B — OpenAPI
1. Mesma tela, **Tipo:** `OpenAPI`.
2. **URL Base da API:** `http://host.docker.internal:3001` (o XGEN serve a especificação em `/openapi.json`).
3. **Headers:** os mesmos da opção A.
4. Clique no botão 🔄 para carregar a ferramenta e salve.

### Modo literal × criativo
A ferramenta tem um campo `mode`, que a LLM do chat preenche com base na conversa:
- **`literal`**: só organizar o material enviado. Ex: *"coloque essas imagens em um PDF"* sai com uma imagem por página, inteira, sem texto inventado, em segundos.
- **`criativo`**: criar o documento com conteúdo (relatório, apresentação, template), usando as imagens como insumo.
- **`auto`** (padrão): o próprio XGEN classifica o pedido. Na dúvida, escolhe o literal, que é o erro mais fácil de corrigir ("agora deixa mais elaborado").

### Testando a Ferramenta no Chat
Ative a chavinha de Ferramentas (`Tools / +`) no seu chat, certifique-se de usar um modelo com suporte robusto a *Tool Calling* (como `GPT-4o` ou `Claude 3.5 Sonnet`) e mande um prompt como:

> *"Você agora está conectada ao gerador XGEN Enterprise. Gere para mim um relatório tático de projeção do mercado imobiliário para os próximos 3 anos. Entregue em formato PDF usando a ferramenta de geração do XGEN."*

O OpenWebUI mostrará a bolinha "Calling Tool / Chamando Ferramenta..." rodando na tela. Ele vai esperar de 1 a 5 minutos (depende do modelo e do número de páginas). Assim que o motor interno do Docker finalizar o layout e salvar o arquivo estático na pasta `/exports`, o chat receberá a resposta 200 OK e soltará o texto para você com o **Link Markdown** direto e clicável.

## 🖼️ Imagens anexadas no chat do OpenWebUI

O XGEN busca as imagens da conversa direto na API do OpenWebUI. Configure uma vez:

1. **No OpenWebUI**, gere uma API key de um usuário **admin** (`Configurações > Conta > Chaves de API`).
2. **No painel do XGEN** (porta `3000`), aba **OpenWebUI**, preencha a URL do OpenWebUI (ex: `http://host.docker.internal:8080`) e a API key. Salve.
   *(Alternativa: variáveis `OPENWEBUI_URL` e `OPENWEBUI_API_KEY` no `.env`.)*
3. **Na conexão do XGEN** (MCP ou OpenAPI) dentro do OpenWebUI, preencha o campo **Headers** com:
   ```json
   {"X-OpenWebUI-Chat-Id": "{{CHAT_ID}}", "X-OpenWebUI-Message-Id": "{{MESSAGE_ID}}"}
   ```
   *(Ou ative `ENABLE_FORWARD_USER_INFO_HEADERS=true` no OpenWebUI, que envia esses headers automaticamente.)*
4. Use no XGEN um modelo **com visão** (GPT-4o, Claude, Gemini...) para ele entender o conteúdo das imagens. Sem visão, as imagens ainda entram no documento, posicionadas pelas dimensões e pelo que o usuário escreveu.

Exemplo no chat (com 3 imagens anexadas):

> *"Gere uma apresentação PPTX sobre o lançamento do nosso produto. Use a primeira foto de fundo na capa, o logo no canto de todos os slides e o print do dashboard no slide de resultados."*

Também é possível mandar imagens por URL no campo opcional `images` do `POST /api/generate`.

No painel (aba **Engine**) existem duas chaves: **Visão** (liga/desliga a leitura das imagens) e **Revisão visual** (a LLM olha o render de cada página e refaz as fracas — mais lento, desligado por padrão).

## 🌐 Acesso Externo & Proxy Reverso (Nginx)

### Passo a Passo de Configuração

#### 1. Configurando o Nginx
No servidor onde está o Nginx que gerencia o seu domínio público, abra a configuração do seu site e adicione a regra abaixo para redirecionar os downloads para o container do XGEN internamente:

```nginx
# Rota para downloads de relatórios gerados pelo XGEN
location /exports/ {
    proxy_pass http://192.168.1.100:3001/exports/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
*(Substitua `192.168.1.100` pelo IP privado local do servidor da sua rede).*

Após alterar a configuração do Nginx, teste e reinicie o serviço:
```bash
nginx -t
systemctl reload nginx
```

#### 2. Configurando o XGEN via Variável de Ambiente
Para que os links gerados no chat usem o seu domínio público, adicione a variável `PUBLIC_API_URL` ao seu ambiente.

1. No diretório do projeto, crie um arquivo `.env` (ou adicione as variáveis no seu `docker-compose.yml` de produção):
   ```env
   PUBLIC_API_URL=https://chat.suaempresa.com
   ```
   *(Substitua `https://chat.suaempresa.com` pelo seu endereço público de acesso externo).*

2. Reinicie os containers com o comando de rebuild para aplicar a nova variável:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

A partir desse momento, todo relatório gerado virá com um link público pronto para download seguro de qualquer lugar do mundo!
