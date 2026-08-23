import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { publishQueueConfig } from './publish-queue.config';
import { type PublishQueueMessage, type PublishQueuePort, type PublishQueueRecord } from './publish-queue.port';

@Injectable()
export class BullMqPublishQueue implements PublishQueuePort, OnModuleDestroy {
  private queue: Queue<PublishQueueMessage> | undefined;

  async enqueue(record: PublishQueueRecord): Promise<void> {
    const config = publishQueueConfig();
    const delay = Math.max(0, record.scheduledAt.getTime() - Date.now());
    const message: PublishQueueMessage = {
      publishJobId: record.publishJobId, campaignId: record.campaignId, postId: record.postId,
      platform: record.platform, socialAccountId: record.socialAccountId, remotePostId: record.remotePostId,
    };
    await this.client().add('publish-social-job', message, {
      jobId: record.queueJobId,
      delay,
      attempts: config.attempts,
      backoff: { type: 'social-publish-retry' },
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
      removeOnFail: { age: 30 * 24 * 60 * 60 },
    });
  }

  async onModuleDestroy(): Promise<void> { await this.close(); }

  async close(): Promise<void> {
    if (!this.queue) return;
    const queue = this.queue;
    this.queue = undefined;
    await queue.close();
  }

  private client(): Queue<PublishQueueMessage> {
    if (this.queue) return this.queue;
    const config = publishQueueConfig();
    this.queue = new Queue<PublishQueueMessage>(config.queueName, { connection: config.redisConnection });
    return this.queue;
  }
}
