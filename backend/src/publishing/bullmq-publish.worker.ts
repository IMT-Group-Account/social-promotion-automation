import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { publishQueueConfig, publishingWorkerEnabled } from './publish-queue.config';
import { PublishJobFailedError, PublishJobTerminalError, PublishWorkerProcessor } from './publish-worker.processor';
import { type PublishQueueMessage, type PublishWorkerLogContext } from './publish-queue.port';
import { retryDelayForBullMq } from './publish-retry.policy';

@Injectable()
export class BullMqPublishWorker implements OnModuleDestroy {
  private readonly logger = new Logger(BullMqPublishWorker.name);
  private worker: Worker<PublishQueueMessage, PublishWorkerLogContext | null> | undefined;
  private queue: Queue<PublishQueueMessage> | undefined;

  constructor(private readonly processor: PublishWorkerProcessor) {}

  start(): void {
    if (this.worker) return;
    if (!publishingWorkerEnabled()) {
      throw new Error('PUBLISH_WORKER_ENABLED=true is required before starting the publishing worker.');
    }
    const config = publishQueueConfig();
    this.queue = new Queue<PublishQueueMessage>(config.queueName, { connection: config.redisConnection });
    this.worker = new Worker<PublishQueueMessage, PublishWorkerLogContext | null>(
      config.queueName,
      async (job) => this.processor.process(job.data.publishJobId, config.workerLeaseMs, job.attemptsMade + 1, job.id),
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
    this.worker.on('completed', (job, result) => {
      this.logOperational('completed', result ?? this.contextFromMessage(job.data, job.attemptsMade + 1, null), job.id ?? null);
    });
    this.worker.on('failed', (job, error) => {
      const context = error instanceof PublishJobFailedError || error instanceof PublishJobTerminalError
        ? error.context
        : job
          ? this.contextFromMessage(job.data, job.attemptsMade, 'BULLMQ_JOB_FAILED')
          : this.emptyContext('BULLMQ_JOB_FAILED');
      this.logOperational('failed', context, job?.id ?? null);
    });
    this.worker.on('stalled', (jobId) => { void this.logStalled(jobId); });
    this.worker.on('error', () => this.logOperational('error', this.emptyContext('BULLMQ_WORKER_ERROR'), null));
  }

  async onModuleDestroy(): Promise<void> { await this.close(); }

  async close(): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = undefined;
    this.queue = undefined;
    await Promise.all([worker?.close(), queue?.close()]);
  }

  private async logStalled(jobId: string): Promise<void> {
    try {
      const job = await this.queue?.getJob(jobId);
      const context = job
        ? this.contextFromMessage(job.data, job.attemptsMade + 1, 'BULLMQ_JOB_STALLED')
        : this.emptyContext('BULLMQ_JOB_STALLED', jobId);
      this.logOperational('stalled', context, jobId);
    } catch {
      this.logOperational('stalled', this.emptyContext('BULLMQ_JOB_STALLED', jobId), jobId);
    }
  }

  private contextFromMessage(message: PublishQueueMessage, attempt: number, errorCode: string | null): PublishWorkerLogContext {
    return { ...message, attempt, errorCode };
  }

  private emptyContext(errorCode: string, publishJobId = 'unknown'): PublishWorkerLogContext {
    return {
      campaignId: 'unknown', postId: 'unknown', publishJobId, platform: 'unknown' as PublishWorkerLogContext['platform'],
      socialAccountId: 'unknown', remotePostId: null, attempt: 0, errorCode,
    };
  }

  private logOperational(event: 'completed' | 'failed' | 'stalled' | 'error', context: PublishWorkerLogContext, bullMqJobId: string | null): void {
    const entry = { event: `social_publish_worker.${event}`, bullMqJobId, ...context };
    if (event === 'completed') this.logger.log(entry);
    else if (event === 'error') this.logger.error(entry);
    else this.logger.warn(entry);
  }
}
