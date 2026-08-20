import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import { publishQueueConfig, publishingWorkerEnabled } from './publish-queue.config';
import { PublishWorkerProcessor } from './publish-worker.processor';
import { retryDelayForBullMq } from './publish-retry.policy';

@Injectable()
export class BullMqPublishWorker implements OnModuleDestroy {
  private readonly logger = new Logger(BullMqPublishWorker.name);
  private worker: Worker<{ publishJobId: string }> | undefined;

  constructor(private readonly processor: PublishWorkerProcessor) {}

  start(): void {
    if (this.worker) return;
    if (!publishingWorkerEnabled()) {
      throw new Error('PUBLISH_WORKER_ENABLED=true is required before starting the publishing worker.');
    }
    const config = publishQueueConfig();
    this.worker = new Worker<{ publishJobId: string }>(
      config.queueName,
      async (job) => this.processor.process(job.data.publishJobId, config.workerLeaseMs),
      {
        connection: config.redisConnection,
        concurrency: config.workerConcurrency,
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
        settings: {
          backoffStrategy: (attemptsMade, type) => type === 'social-publish-retry' ? retryDelayForBullMq(attemptsMade) : 0,
        },
      },
    );
    this.worker.on('error', (error) => this.logger.error('BullMQ publishing worker error.', error.stack));
  }

  async onModuleDestroy(): Promise<void> { await this.close(); }

  async close(): Promise<void> {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = undefined;
    await worker.close();
  }
}
