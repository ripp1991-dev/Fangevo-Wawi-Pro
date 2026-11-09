/**
 * Hintergrund-Prozess: stellt fachliche Ereignisse zu (Benachrichtigungen, später Webhooks/Workflows).
 * Mehrere Instanzen können parallel laufen.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { EventDispatcher } from './core/events/dispatcher.service';
import { JobQueue } from './core/jobs/job-queue.service';
import { WorkflowsService } from './modules/automation/workflows.service';
import { Logger as PinoLogger } from 'nestjs-pino';
import { BillingService } from './modules/billing/billing.service';
import { installProcessGuards } from './process-guards';

const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
  bufferLogs: true,
});
// Gepufferte Logs an den strukturierten Logger übergeben (sonst gingen Worker-Logs verloren)
app.useLogger(app.get(PinoLogger));
installProcessGuards(app.get(PinoLogger), 'Worker');
app.enableShutdownHooks();
app.get(EventDispatcher).start();
app.get(JobQueue).start();
app.get(WorkflowsService).startScheduler();
app.get(BillingService).startScheduler();
