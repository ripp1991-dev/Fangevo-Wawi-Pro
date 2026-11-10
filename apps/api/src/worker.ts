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

const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
  bufferLogs: true,
});
app.enableShutdownHooks();
app.get(EventDispatcher).start();
app.get(JobQueue).start();
app.get(WorkflowsService).startScheduler();
