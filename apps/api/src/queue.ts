import { Queue } from 'bullmq';
import { DOCUMENT_QUEUE_NAME, redisConnection } from './config/env';

export const documentQueue = new Queue(DOCUMENT_QUEUE_NAME, { connection: redisConnection });
