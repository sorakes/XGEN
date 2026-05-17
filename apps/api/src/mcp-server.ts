import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
// Conecta ao Redis embutido no Docker
const documentQueue = new Queue('DocumentQueue', { connection: { host: 'localhost', port: 6379 } });

const server = new Server({
  name: "XGEN-MCP",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_premium_document",
        description: "Envia instruções para a IA interna do XGEN gerar um PDF ou DOCX de luxo, altamente refinado. Por ser agentivo, a resposta será apenas o ID da fila. Você DEVE avisar ao usuário que o XGEN está trabalhando assincronamente e que ele pode checar o status no Painel.",
        inputSchema: {
          type: "object",
          properties: {
            documentType: {
              type: "string",
              description: "Formato de saída: 'PDF', 'DOCX' ou 'XLSX'.",
              enum: ["PDF", "DOCX", "XLSX"]
            },
            instructions: {
              type: "string",
              description: "Os dados, texto, diretrizes estéticas e layout do que deverá ser colocado no documento."
            }
          },
          required: ["documentType", "instructions"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "generate_premium_document") {
    const { documentType, instructions } = request.params.arguments as any;
    
    // Persistindo na Base SQLite
    const jobRecord = await prisma.documentJob.create({
      data: {
        status: "queued",
        file_type: documentType,
        prompt: instructions
      }
    });

    // Despachando na Fila Redis
    await documentQueue.add('generate', {
      jobId: jobRecord.id,
      documentType,
      instructions
    }, { jobId: jobRecord.id });

    return {
      content: [{
        type: "text",
        text: `Sucesso! O pedido foi enfileirado na Engine do XGEN. Job ID: ${jobRecord.id}. Avise ao usuário que a IA interna está executando ciclos de auto-correção estética, e o status pode ser acompanhado no XGEN Dashboard.`
      }]
    };
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 XGEN MCP Protocol Server escutando via stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
