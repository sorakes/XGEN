import { Router } from 'express';
import { getJobs, getJobById } from '../services/jobs.service';
import { asyncHandler } from './asyncHandler';

export const jobsRouter = Router();

jobsRouter.get('/', asyncHandler(async (req, res) => {
  try {
    const jobs = await getJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar jobs' });
  }
}));

jobsRouter.get('/:id', asyncHandler(async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar job' });
  }
}));
