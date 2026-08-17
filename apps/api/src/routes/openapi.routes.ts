import { Router } from 'express';
import { PUBLIC_API_URL } from '../config/env';

export const openapiRouter = Router();

// --- OPENAPI INTEGRATION (A Rota Nativa Perfeita) ---
openapiRouter.get('/', (req, res) => {
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
