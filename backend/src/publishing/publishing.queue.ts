import { Inject, Injectable, Logger } from '@nestjs/common';
import { PUBLISH_OUTBOX_REPOSITORY, type PublishOutboxRepository } from './publish-outbox.repository';
import { PUBLISH_QUEUE_PORT, type PublishQueuePort } from './publish-queue.port';

@Injectable()
export class PublishingQueue {
  private readonly logger = new Logger(PublishingQueue.name);

  constructor(
    @Inject(PUBLISH_OUTBOX_REPOSITORY) private readonly outbox: PublishOutboxRepository,
    @Inject(PUBLISH_QUEUE_PORT) private readonly queue: PublishQueuePort,
  ) {}

  /**
   * Transfers persisted per-platform jobs to BullMQ. It intentionally does not
   * publish anything itself; a separate worker owns the external API call.
   */
  async dispatchPending(limit = 100, leaseMs = 60_000): Promise<{ enqueued: number; failed: number }> {
    const records = await this.outbox.claimOutbox(limit, leaseMs);
    let enqueued = 0;
    let failed = 0;
    for (const record of records) {
      try {
        await this.queue.enqueue(record);
        await this.outbox.markOutboxEnqueued(record);
        enqueued += 1;
      } catch (error: unknown) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Queue enqueue failed.';
        await this.outbox.releaseOutbox(record, message);
        this.logger.warn(`Could not enqueue social publish job ${record.publishJobId}.`);
      }
    }
    return { enqueued, failed };
  }
}
