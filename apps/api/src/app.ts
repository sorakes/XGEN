import express from 'express';
import cors from 'cors';
import path from 'path';
import { settingsRouter } from './routes/settings.routes';
import { jobsRouter } from './routes/jobs.routes';
import { generateRouter } from './routes/generate.routes';
import { openapiRouter } from './routes/openapi.routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/exports', express.static(path.join(__dirname, '..', 'exports')));

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'xgen-api' }));

  app.use('/api/settings', settingsRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/generate', generateRouter);
  app.use('/openapi.json', openapiRouter);

  return app;
}
