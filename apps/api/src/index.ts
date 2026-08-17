import { createApp } from './app';
import { startWorker } from './worker';
import { PORT } from './config/env';

startWorker();

const app = createApp();
app.listen(PORT, () => {
  console.log(`🚀 XGEN API (Express & Agent Worker) running on port ${PORT}`);
});
