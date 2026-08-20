import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SchedulerService } from './scheduler.service';

function schedulerEnabled(): boolean {
  return process.env.SCHEDULER_ENABLED === 'true';
}

async function bootstrap(): Promise<void> {
  if (!schedulerEnabled()) {
    throw new Error('SCHEDULER_ENABLED=true is required to run the scheduler process.');
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  app.get(SchedulerService).start();
}

void bootstrap();
