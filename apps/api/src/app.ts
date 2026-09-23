import express from 'express';
import cors from 'cors';
import path from 'path';
import { settingsRouter } from './routes/settings.routes';
import { jobsRouter } from './routes/jobs.routes';
import { generateRouter } from './routes/generate.routes';
import { openapiRouter } from './routes/openapi.routes';
import { mcpRouter } from './routes/mcp.routes';
import { decksRouter } from './routes/decks.routes';

export function createApp() {
  const app = express();

  app.use(cors());
  // Limite alto: o body pode trazer imagens em data URL (base64).
  app.use(express.json({ limit: '80mb' }));

  app.use('/exports', express.static(path.join(__dirname, '..', 'exports')));

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'xgen-api' }));

  app.use('/api/settings', settingsRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/generate', generateRouter);
  app.use('/api/decks', decksRouter);
  app.use('/openapi.json', openapiRouter);
  // MCP (Streamable HTTP). Use OU esta conexão OU a OpenAPI no OpenWebUI, não as duas.
  app.use('/mcp', mcpRouter);

  return app;
}
