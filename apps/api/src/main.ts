import { loadConfig } from './config';
import { createApp } from './bootstrap';
import { EventDispatcher } from './core/events/dispatcher.service';
import { JobQueue } from './core/jobs/job-queue.service';
import { WorkflowsService } from './modules/automation/workflows.service';
import { Logger as PinoLogger } from 'nestjs-pino';
import { BillingService } from './modules/billing/billing.service';
import { installProcessGuards } from './process-guards';

const config = loadConfig();
const app = await createApp(config);
installProcessGuards(app.get(PinoLogger), 'API');
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
if (config.dispatchInline) {
  app.get(EventDispatcher).start();
  app.get(JobQueue).start();
  app.get(WorkflowsService).startScheduler();
  app.get(BillingService).startScheduler();
}
