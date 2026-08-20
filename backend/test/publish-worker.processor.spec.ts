import assert from 'node:assert/strict';
import test from 'node:test';
import { type Post, type SocialPublishJob } from '../src/posts/post.entity';
import { type PublishOutboxRepository } from '../src/publishing/publish-outbox.repository';
import { type PublishQueuePort, type PublishQueueRecord } from '../src/publishing/publish-queue.port';
import { PublishingQueue } from '../src/publishing/publishing.queue';
import { type PublishExecution, PublishingService } from '../src/publishing/publishing.service';
import { PublishJobFailedError, PublishJobTerminalError, PublishWorkerProcessor } from '../src/publishing/publish-worker.processor';

const post: Post = {
  id: 'post_001', campaignId: 'campaign_001', ownerId: 'owner_001', status: 'scheduled', scheduledAt: new Date('2026-08-21T00:00:00Z'),
  content: { title: 'Support', body: 'Support our campaign.', url: null, media: [] },
};

function pendingJob(platform: SocialPublishJob['platform']): SocialPublishJob {
  return { id: `${platform}_job`, postId: post.id, platform, accountId: `${platform}_account`, status: 'processing', scheduledAt: post.scheduledAt,
    publishedAt: null, remotePostId: null, remotePostUrl: null, errorCode: null, errorMessage: null, retryCount: 0, leaseExpiresAt: new Date(), nextRetryAt: null };
}

class FakeRepository implements PublishOutboxRepository {
  readonly saved: { execution: PublishExecution; retryPending: boolean; nextRetryAt: Date | null }[] = [];
  readonly released: string[] = [];
  readonly enqueued: string[] = [];
  constructor(private readonly claimed: { post: Post; job: SocialPublishJob } | null) {}
  async claimOutbox(): Promise<readonly PublishQueueRecord[]> { return []; }
  async markOutboxEnqueued(record: PublishQueueRecord): Promise<void> { this.enqueued.push(record.publishJobId); }
  async releaseOutbox(record: PublishQueueRecord): Promise<void> { this.released.push(record.publishJobId); }
  async claimPublishJob(): Promise<{ post: Post; job: SocialPublishJob } | null> { return this.claimed; }
  async saveExecution(execution: PublishExecution, retryPending: boolean, nextRetryAt: Date | null): Promise<void> { this.saved.push({ execution, retryPending, nextRetryAt }); }
}

test('a successful worker delivery persists only its claimed social job', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('linkedin') });
  const publishing = { publish: async (): Promise<PublishExecution> => ({ ok: true, job: { ...pendingJob('linkedin'), status: 'published', publishedAt: new Date(), remotePostId: 'li_123', remotePostUrl: null, leaseExpiresAt: null }, result: { remotePostId: 'li_123', publishedAt: new Date() } }) } as unknown as PublishingService;
  await new PublishWorkerProcessor(repository, publishing).process('linkedin_job', 60_000);

  assert.equal(repository.saved.length, 1);
  assert.equal(repository.saved[0]?.execution.job.platform, 'linkedin');
  assert.equal(repository.saved[0]?.retryPending, false);
});

test('a transient X failure returns only X to retrying for BullMQ retry', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('x') });
  const failedJob = { ...pendingJob('x'), status: 'failed' as const, retryCount: 1, errorCode: 'PUBLISH_FAILED', errorMessage: 'X unavailable', leaseExpiresAt: null };
  const publishing = { publish: async (): Promise<PublishExecution> => ({ ok: false, job: failedJob, error: new Error('X unavailable'), failure: { code: 'UPSTREAM_SERVER_ERROR', retryable: true, message: 'X unavailable' } }) } as unknown as PublishingService;
  const worker = new PublishWorkerProcessor(repository, publishing);

  await assert.rejects(() => worker.process('x_job', 60_000), PublishJobFailedError);
  assert.equal(repository.saved.length, 1);
  assert.equal(repository.saved[0]?.execution.job.platform, 'x');
  assert.equal(repository.saved[0]?.retryPending, true);
  const nextRetryAt = repository.saved[0]?.nextRetryAt;
  assert.ok(nextRetryAt && nextRetryAt.getTime() >= Date.now() + 29_000);
});

test('the final failed X attempt is terminal without changing other platform records', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('x') });
  const failedJob = { ...pendingJob('x'), status: 'failed' as const, retryCount: 4, errorCode: 'PUBLISH_FAILED', errorMessage: 'X unavailable', leaseExpiresAt: null };
  const publishing = { publish: async (): Promise<PublishExecution> => ({ ok: false, job: failedJob, error: new Error('X unavailable'), failure: { code: 'UPSTREAM_SERVER_ERROR', retryable: true, message: 'X unavailable' } }) } as unknown as PublishingService;

  await assert.rejects(() => new PublishWorkerProcessor(repository, publishing).process('x_job', 60_000), PublishJobTerminalError);
  assert.equal(repository.saved[0]?.retryPending, false);
  assert.equal(repository.saved[0]?.execution.job.status, 'failed');
});

test('outbox dispatch enqueues independent records and releases only the enqueue failure', async () => {
  const first: PublishQueueRecord = { publishJobId: 'linkedin_job', queueJobId: 'publish-linkedin_job', scheduledAt: post.scheduledAt };
  const second: PublishQueueRecord = { publishJobId: 'x_job', queueJobId: 'publish-x_job', scheduledAt: post.scheduledAt };
  class OutboxRepository extends FakeRepository {
    override async claimOutbox(): Promise<readonly PublishQueueRecord[]> { return [first, second]; }
  }
  const repository = new OutboxRepository(null);
  const queue: PublishQueuePort = {
    async enqueue(record): Promise<void> { if (record.publishJobId === 'x_job') throw new Error('Redis unavailable'); },
  };
  const result = await new PublishingQueue(repository, queue).dispatchPending();

  assert.deepEqual(result, { enqueued: 1, failed: 1 });
  assert.deepEqual(repository.enqueued, ['linkedin_job']);
  assert.deepEqual(repository.released, ['x_job']);
});
