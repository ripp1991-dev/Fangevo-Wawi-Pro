import { loadConfig } from './config';
import { createApp } from './bootstrap';
import { EventDispatcher } from './core/events/dispatcher.service';
import { JobQueue } from './core/jobs/job-queue.service';

const config = loadConfig();
const app = await createApp(config);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
if (config.dispatchInline) {
  app.get(EventDispatcher).start();
  app.get(JobQueue).start();
}
