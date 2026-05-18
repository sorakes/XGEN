import express from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { Worker, Queue } from 'bullmq';
import { runDocumentAgent } from './agent';
import { convertToPDF, convertToDOCX, convertToXLSX } from './converters';
import fs from 'fs';
import path from 'path';

// Resolve a URL publica de API (Prod usará o valor setado no docker-compose, Dev usa o padrão abaixo)
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "http://host.docker.internal:3001";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// --- BULLMQ WORKER (BACKGROUND) ---
const worker = new Worker('DocumentQueue', async job => {
  const { jobId, documentType, instructions } = job.data;
  
  await prisma.documentJob.update({
    where: { id: jobId },
    data: { status: 'processing', current_step: 'Iniciando...' }
  });

  console.log(`[Worker] Started Agentic Generation for Job ${jobId} (${documentType})...`);
  
  try {
    const s = (await prisma.settings.findFirst()) as any;
    if (!s) throw new Error("⚠️ Nenhuma configuração encontrada.");

    let llmKey = '', llmModel = 'gpt-4o', provider = 'openai', llmBaseUrl = '';
    
    if (s.active_llm === 'openai' && s.openai_key) {
      llmKey = s.openai_key; llmModel = s.openai_model || 'gpt-4o'; provider = 'openai';
      llmBaseUrl = s.openai_base_url || 'https://api.openai.com/v1';
    } else if (s.active_llm === 'openrouter' && s.openrouter_key) {
      llmKey = s.openrouter_key; llmModel = s.openrouter_model || 'openai/gpt-4o'; provider = 'openai';
      llmBaseUrl = 'https://openrouter.ai/api/v1';
    } else if (s.active_llm === 'google' && s.google_key) {
      llmKey = s.google_key; llmModel = s.google_model || 'gemini-2.0-flash'; provider = 'google';
    } else if (s.active_llm === 'ollama') {
      llmKey = 'ollama'; llmModel = s.ollama_model || 'llama3'; provider = 'openai';
      llmBaseUrl = s.ollama_url || 'http://localhost:11434/v1';
    } else {
      throw new Error("⚠️ A chave do provedor LLM ativo não está configurada.");
    }

    // Callback de progresso — atualiza current_step no banco em tempo real
    const onProgress = async (step: string) => {
      await prisma.documentJob.update({
        where: { id: jobId },
        data: { current_step: step }
      });
    };

    // 1. Roda a Arquitetura Agentiva (LangGraph)
    const outputData = await runDocumentAgent(
      instructions, documentType, s.max_retries, llmKey, llmModel, provider, llmBaseUrl, onProgress
    );

    // 2. Prepara a pasta de exportação
    const exportPath = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath, { recursive: true });
    
    // 3. Conversão Final
    await onProgress('Convertendo para ' + documentType + '...');
    let finalUrl = '';
    
    if (documentType === 'PDF') {
      const filePath = path.join(exportPath, `${jobId}.pdf`);
      await convertToPDF(outputData, filePath);
      finalUrl = `/exports/${jobId}.pdf`;
    } else if (documentType === 'DOCX') {
      const filePath = path.join(exportPath, `${jobId}.docx`);
      await convertToDOCX(outputData, filePath);
      finalUrl = `/exports/${jobId}.docx`;
    } else if (documentType === 'XLSX') {
      const filePath = path.join(exportPath, `${jobId}.xlsx`);
      await convertToXLSX(outputData, filePath);
      finalUrl = `/exports/${jobId}.xlsx`;
    } else {
      throw new Error("Tipo de documento não suportado.");
    }

    await prisma.documentJob.update({
      where: { id: jobId },
      data: { status: 'completed', file_url: finalUrl, current_step: 'Concluído ✅' }
    });
    console.log(`[Worker] ✅ Job ${jobId} Completed! → ${finalUrl}`);

  } catch (error: any) {
    console.error(`[Worker] ❌ Job ${jobId} Failed:`, error);
    await prisma.documentJob.update({
      where: { id: jobId },
      data: { status: 'failed', error_log: error.message, current_step: 'Falhou ❌' }
    });
  }

}, { connection: { host: 'localhost', port: 6379 } });

// --- STATIC EXPORTS ---
app.use('/exports', express.static(path.join(__dirname, '..', 'exports')));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'xgen-api' }));

// --- SETTINGS CRUD ---
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.settings.findFirst();
    if (!settings) settings = await prisma.settings.create({ data: { max_retries: 3 } });
    res.json(settings);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar configurações' }); }
});

app.put('/api/settings', async (req, res) => {
  try {
    const payload = req.body;
    delete payload.id;
    delete payload.updatedAt;
    delete payload.createdAt;
    
    let settings = await prisma.settings.findFirst();
    if (settings) {
      settings = await prisma.settings.update({ where: { id: settings.id }, data: payload });
    } else {
      settings = await prisma.settings.create({ data: payload });
    }
    res.json(settings);
  } catch (error) { 
    console.error("❌ Erro ao salvar configurações:", error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' }); 
  }
});

// --- JOBS QUEUE ---
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await prisma.documentJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(jobs);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar jobs' }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await prisma.documentJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(job);
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar job' }); }
});

// --- TEST ENDPOINT ---
const documentQueue = new Queue('DocumentQueue', { connection: { host: 'localhost', port: 6379 } });

app.post('/api/generate', async (req, res) => {
  try {
    const { documentType, instructions } = req.body;
    if (!documentType || !instructions) {
      return res.status(400).json({ error: 'Campos: documentType (PDF|DOCX|XLSX) e instructions' });
    }
    const jobRecord = await prisma.documentJob.create({
      data: { status: 'queued', file_type: documentType, prompt: instructions, current_step: 'Na fila' }
    });
    await documentQueue.add('generate', { jobId: jobRecord.id, documentType, instructions }, { jobId: jobRecord.id });

    // --- O BLOQUEIO SÍNCRONO (TRAVA O OPENWEBUI NO CALLING TOOL) ---
    let isDone = false;
    let finalJob: any = jobRecord;
    while (!isDone) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const check = await prisma.documentJob.findUnique({ where: { id: jobRecord.id } });
      if (!check || check.status === 'completed' || check.status === 'failed') {
        isDone = true;
        finalJob = check;
      }
    }

    if (finalJob?.status === 'completed') {
      res.json({
        success: true,
        message: `Relatorio gerado com sucesso. Entregue o link de download no chat para que o usuario consiga baixar o arquivo gerado: [Baixar Relatorio ${documentType}](${PUBLIC_API_URL}${finalJob.file_url})`
      });
    } else {
      res.status(500).json({ error: 'Falha na geracao do documento pelo XGEN.' });
    }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// --- MCP SSE SERVER (OPEN WEBUI INTEGRATION) ---
const mcpServer = new Server({ name: "XGEN-MCP", version: "1.0.0" }, { capabilities: { tools: {} } });

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_premium_document",
        description: "Inicia a geracao assincrona do documento. RETORNA UM JOB_ID. REGRA ABSOLUTA: Apos invocar esta ferramenta, voce NAO DEVE responder ao usuario. Voce DEVE obrigatoriamente chamar a ferramenta 'check_xgen_job_status' passando o jobId para acompanhar a fila.",
        inputSchema: {
          type: "object",
          properties: {
            documentType: { type: "string", enum: ["PDF", "DOCX", "XLSX"] },
            instructions: { type: "string" }
          },
          required: ["documentType", "instructions"]
        }
      },
      {
        name: "check_xgen_job_status",
        description: "Verifica o andamento do documento. Mantenha chamando esta ferramenta ate que o status mude para 'completed'. Quando terminar, devolva o 'file_url' ao usuario em formato de link clicavel para download.",
        inputSchema: {
          type: "object",
          properties: {
            jobId: { type: "string", description: "O ID retornado pela ferramenta de geracao" }
          },
          required: ["jobId"]
        }
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "generate_premium_document") {
    const { documentType, instructions } = request.params.arguments as any;
    const jobRecord = await prisma.documentJob.create({
      data: { status: "queued", file_type: documentType, prompt: instructions, current_step: "Na fila" }
    });
    await documentQueue.add('generate', { jobId: jobRecord.id, documentType, instructions }, { jobId: jobRecord.id });
    return {
      content: [{ type: "text", text: `Job iniciado! ID: ${jobRecord.id}. PARE DE FALAR e chame IMEDIATAMENTE a ferramenta 'check_xgen_job_status' com este ID.` }]
    };
  }
  if (request.params.name === "check_xgen_job_status") {
    const { jobId } = request.params.arguments as any;
    const job = await prisma.documentJob.findUnique({ where: { id: jobId } });
    if (!job) return { content: [{ type: "text", text: "Job nao encontrado" }] };
    return { content: [{ type: "text", text: JSON.stringify({ status: job.status, step: job.current_step, file_url: job.file_url ? `${PUBLIC_API_URL}${job.file_url}` : null }) }] };
  }
  throw new Error(`Tool not found: ${request.params.name}`);
});

let transport: SSEServerTransport | null = null;

app.get('/mcp/sse', async (req, res) => {
  transport = new SSEServerTransport('/mcp/messages', res);
  await mcpServer.connect(transport);
});

// O OpenWebUI faz um POST para verificar a conexão ou enviar mensagens diretamente
app.post('/mcp/sse', async (req, res) => {
  if (!transport) {
    res.status(200).json({ jsonrpc: "2.0", id: req.body?.id || 1, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "XGEN", version: "1.0.0" } } });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.post('/mcp/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(500).send("MCP transport not initialized");
  }
});

// --- OPENAPI INTEGRATION (A Rota Nativa Perfeita) ---
app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: "3.1.0",
    info: { title: "XGEN Enterprise API", version: "1.0.0" },
    servers: [{ url: PUBLIC_API_URL }],
    paths: {
      "/api/generate": {
        post: {
          operationId: "generate_premium_document",
          summary: "Gera relatorios de luxo em PDF, planilhas XLSX ou DOCX.",
          description: "Sempre que o usuario pedir para gerar um relatorio, documento ou planilha, use esta ferramenta informando o tipo do documento e as instrucoes detalhadas. A ferramenta vai demorar cerca de 40 segundos para responder, apenas aguarde. Quando ela responder, entregue o Link de Download gerado ao usuario.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documentType: { type: "string", enum: ["PDF", "DOCX", "XLSX"], description: "Formato do documento." },
                    instructions: { type: "string", description: "Todos os detalhes dos dados que vao no relatorio/planilha." }
                  },
                  required: ["documentType", "instructions"]
                }
              }
            }
          },
          responses: { "200": { description: "Sucesso, retorna a mensagem com o link final do arquivo." } }
        }
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 XGEN API (Express & Agent Worker) running on port ${PORT}`);
});
