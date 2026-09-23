import { Router } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { generateAndWait, TOOL_DESCRIPTION } from '../services/generation.service';

export const mcpRouter = Router();

/**
 * Um servidor MCP por requisição (modo stateless do Streamable HTTP).
 * Assim cada chamada enxerga os PRÓPRIOS headers do OpenWebUI
 * (X-OpenWebUI-Chat-Id...), que é de onde vêm as imagens do chat.
 */
function buildServer(headers: Record<string, any>): McpServer {
  const server = new McpServer({ name: 'XGEN', version: '2.0.0' });

  server.registerTool(
    'generate_document',
    {
      title: 'Gerar documento (PDF, PPTX, DOCX, XLSX)',
      description: TOOL_DESCRIPTION,
      inputSchema: {
        documentType: z.enum(['PDF', 'PPTX', 'DOCX', 'XLSX']).describe('Formato do arquivo.'),
        instructions: z.string().describe('O pedido do usuario com todos os detalhes, e como usar as imagens anexadas (se houver).'),
        mode: z.enum(['auto', 'literal', 'criativo']).optional()
          .describe("'literal' = so organizar o material enviado; 'criativo' = criar o documento com conteudo; 'auto' = o XGEN decide."),
        images: z.array(z.string()).optional()
          .describe('Opcional. URLs publicas (http/https) de imagens extras. Imagens anexadas no chat NAO precisam ser listadas.'),
        detailLevel: z.enum(['simples', 'avancado']).optional()
          .describe("Nivel do documento escolhido pelo usuario: 'simples' (curto) ou 'avancado' (completo)."),
        imageSource: z.enum(['nenhuma', 'enviadas', 'banco', 'ia']).optional()
          .describe("Imagens: 'nenhuma', 'enviadas' (so as anexadas), 'banco' (fotos reais do Pexels) ou 'ia' (geradas por IA)."),
        extraImages: z.number().int().min(0).max(8).optional()
          .describe('Quantas imagens buscar/gerar ALEM das anexadas (0 a 8).'),
      },
    },
    async ({ documentType, instructions, mode, images, detailLevel, imageSource, extraImages }) => {
      const result = await generateAndWait({ documentType, instructions, mode, images, detailLevel, imageSource, extraImages, headers });
      return result.ok
        ? { content: [{ type: 'text' as const, text: result.message }] }
        : { content: [{ type: 'text' as const, text: result.error }], isError: true };
    }
  );

  return server;
}

mcpRouter.post('/', async (req, res) => {
  const server = buildServer(req.headers);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP] Erro ao processar requisição:', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno do XGEN' }, id: null });
    }
  }
});

// Stateless: não há sessão para abrir stream (GET) nem para encerrar (DELETE).
const methodNotAllowed = (_req: any, res: any) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método não permitido.' }, id: null });
mcpRouter.get('/', methodNotAllowed);
mcpRouter.delete('/', methodNotAllowed);
