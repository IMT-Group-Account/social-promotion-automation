import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BullMqPublishWorker } from './bullmq-publish.worker';
import { publishQueueConfig } from './publish-queue.config';
import { PublishingQueue } from './publishing.queue';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  const worker = app.get(BullMqPublishWorker);
  const dispatcher = app.get(PublishingQueue);
  const config = publishQueueConfig();
  worker.start();

  let dispatching = false;
  const dispatch = async (): Promise<void> => {
    if (dispatching) return;
    dispatching = true;
    try { await dispatcher.dispatchPending(100, config.workerLeaseMs); }
    finally { dispatching = false; }
  };
  await dispatch();
  const timer = setInterval(() => { void dispatch(); }, config.outboxPollIntervalMs);
  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

void bootstrap();
