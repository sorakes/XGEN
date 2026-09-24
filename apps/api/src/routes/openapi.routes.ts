import { Router } from 'express';
import { PUBLIC_API_URL } from '../config/env';
import { TOOL_DESCRIPTION } from '../services/generation.service';

export const openapiRouter = Router();

// --- OPENAPI INTEGRATION (A Rota Nativa Perfeita) ---
openapiRouter.get('/', (req, res) => {
  res.json({
    openapi: "3.1.0",
    info: { title: "XGEN Enterprise API", version: "2.0.0" },
    servers: [{ url: PUBLIC_API_URL }],
    paths: {
      "/api/generate": {
        post: {
          operationId: "generate_premium_document",
          summary: "Gera relatorios e documentos premium em PDF, apresentacoes PPTX, documentos DOCX ou planilhas XLSX.",
          description: TOOL_DESCRIPTION,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documentType: { type: "string", enum: ["PDF", "PPTX", "DOCX", "XLSX"], description: "Formato do arquivo." },
                    instructions: {
                      type: "string",
                      description: "Todos os detalhes do conteudo, estilo desejado e como usar as imagens anexadas (se houver).",
                    },
                    mode: {
                      type: "string",
                      enum: ["auto", "literal", "criativo"],
                      description: "'literal' = so organizar o material enviado (ex: juntar imagens num PDF); 'criativo' = criar o documento com conteudo; 'auto' = o XGEN decide.",
                    },
                    detailLevel: {
                      type: "string",
                      enum: ["simples", "avancado"],
                      description: "Nivel do documento escolhido pelo usuario: 'simples' (curto) ou 'avancado' (completo).",
                    },
                    imageSource: {
                      type: "string",
                      enum: ["nenhuma", "enviadas", "banco", "ia"],
                      description: "Imagens: 'nenhuma', 'enviadas' (so as anexadas), 'banco' (fotos reais do Pexels) ou 'ia' (geradas por IA).",
                    },
                    extraImages: {
                      type: "integer",
                      minimum: 0,
                      maximum: 8,
                      description: "Quantas imagens buscar/gerar ALEM das anexadas (0 a 8).",
                    },
                    previousDocumentId: {
                      type: "string",
                      description: "Para ALTERAR um documento ja gerado nesta conversa: o codigo (UUID) que aparece nos links Baixar/Editar. Em instructions, descreva so a mudanca.",
                    },
                    images: {
                      type: "array",
                      items: { type: "string" },
                      description: "Opcional. URLs publicas (http/https) de imagens extras para usar no documento. Imagens anexadas no chat NAO precisam ser listadas aqui.",
                    },
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
