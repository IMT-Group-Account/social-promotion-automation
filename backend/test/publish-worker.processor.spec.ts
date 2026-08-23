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
  return { id: `${platform}_job`, postId: post.id, platform, accountId: `${platform}_account`, status: 'claimed', scheduledAt: post.scheduledAt,
    publishedAt: null, remotePostId: null, remotePostUrl: null, errorCode: null, errorMessage: null, retryCount: 0, leaseExpiresAt: new Date(), nextRetryAt: null,
    remoteRequestKey: null, remoteRequestStartedAt: null };
}

class FakeRepository implements PublishOutboxRepository {
  readonly saved: { execution: PublishExecution; retryPending: boolean; nextRetryAt: Date | null }[] = [];
  readonly released: string[] = [];
  readonly enqueued: string[] = [];
  readonly ambiguous: { job: SocialPublishJob; retryPending: boolean; nextRetryAt: Date | null }[] = [];
  private claimed: { post: Post; job: SocialPublishJob } | null;
  private activeClaim: { post: Post; job: SocialPublishJob } | null = null;
  constructor(claimed: { post: Post; job: SocialPublishJob } | null) { this.claimed = claimed; }
  async claimOutbox(): Promise<readonly PublishQueueRecord[]> { return []; }
  async markOutboxEnqueued(record: PublishQueueRecord): Promise<void> { this.enqueued.push(record.publishJobId); }
  async releaseOutbox(record: PublishQueueRecord): Promise<void> { this.released.push(record.publishJobId); }
  async claimPublishJob(): Promise<{ post: Post; job: SocialPublishJob } | null> {
    this.activeClaim = this.claimed;
    this.claimed = null;
    return this.activeClaim;
  }
  async markRemoteRequesting(jobId: string, idempotencyKey: string): Promise<SocialPublishJob> {
    if (!this.activeClaim || this.activeClaim.job.id !== jobId) throw new Error('Unexpected publish job.');
    return { ...this.activeClaim.job, status: 'remote_requesting', remoteRequestKey: idempotencyKey, remoteRequestStartedAt: new Date() };
  }
  async confirmRemotePublication(job: SocialPublishJob): Promise<SocialPublishJob> { return { ...job, status: 'remote_confirmed' }; }
  async recordAmbiguousRemoteOutcome(job: SocialPublishJob, retryPending: boolean, nextRetryAt: Date | null): Promise<void> { this.ambiguous.push({ job, retryPending, nextRetryAt }); }
  async saveExecution(execution: PublishExecution, retryPending: boolean, nextRetryAt: Date | null): Promise<void> { this.saved.push({ execution, retryPending, nextRetryAt }); }
}

test('a successful worker delivery persists only its claimed social job', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('linkedin') });
  const publishing = { publish: async (): Promise<PublishExecution> => ({ ok: true, job: { ...pendingJob('linkedin'), status: 'remote_confirmed', publishedAt: new Date(), remotePostId: 'li_123', remotePostUrl: null, leaseExpiresAt: null }, result: { remotePostId: 'li_123', publishedAt: new Date() } }) } as unknown as PublishingService;
  const context = await new PublishWorkerProcessor(repository, publishing).process('linkedin_job', 60_000, 2);

  assert.equal(repository.saved.length, 1);
  assert.equal(repository.saved[0]?.execution.job.platform, 'linkedin');
  assert.equal(repository.saved[0]?.retryPending, false);
  assert.deepEqual(context, {
    campaignId: 'campaign_001', postId: 'post_001', publishJobId: 'linkedin_job', platform: 'linkedin',
    socialAccountId: 'linkedin_account', remotePostId: 'li_123', attempt: 2, errorCode: null,
  });
});

test('publishing duplicate delivery acknowledges the second delivery without another remote publish', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('linkedin') });
  let publishCalls = 0;
  const publishing = {
    async publish(): Promise<PublishExecution> {
      publishCalls += 1;
      return { ok: true, job: { ...pendingJob('linkedin'), status: 'remote_confirmed', publishedAt: new Date(), remotePostId: 'li_123', remotePostUrl: null, leaseExpiresAt: null }, result: { remotePostId: 'li_123', publishedAt: new Date() } };
    },
  } as unknown as PublishingService;
  const processor = new PublishWorkerProcessor(repository, publishing);

  await processor.process('linkedin_job', 60_000);
  const duplicateResult = await processor.process('linkedin_job', 60_000);

  assert.equal(publishCalls, 1);
  assert.equal(repository.saved.length, 1);
  assert.equal(duplicateResult, null);
});

test('retryable publishing failure returns only one job to retrying for BullMQ retry', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('x') });
  const failedJob = { ...pendingJob('x'), status: 'failed' as const, retryCount: 1, errorCode: 'PUBLISH_FAILED', errorMessage: 'X unavailable', leaseExpiresAt: null };
  const publishing = { publish: async (): Promise<PublishExecution> => ({ ok: false, job: failedJob, error: new Error('X unavailable'), failure: { code: 'UPSTREAM_SERVER_ERROR', retryable: true, ambiguous: false, message: 'X unavailable' } }) } as unknown as PublishingService;
  const worker = new PublishWorkerProcessor(repository, publishing);

  await assert.rejects(
    () => worker.process('x_job', 60_000, 3),
    (error: unknown) => error instanceof PublishJobFailedError
      && error.context.campaignId === 'campaign_001'
      && error.context.postId === 'post_001'
      && error.context.publishJobId === 'x_job'
      && error.context.platform === 'x'
      && error.context.socialAccountId === 'x_account'
      && error.context.remotePostId === null
      && error.context.attempt === 3
      && error.context.errorCode === 'PUBLISH_FAILED',
  );
  assert.equal(repository.saved.length, 1);
  assert.equal(repository.saved[0]?.execution.job.platform, 'x');
  assert.equal(repository.saved[0]?.retryPending, true);
  const nextRetryAt = repository.saved[0]?.nextRetryAt;
  assert.ok(nextRetryAt && nextRetryAt.getTime() >= Date.now() + 29_000);
});

test('terminal publishing failure does not retry or change other platform records', async () => {
  const repository = new FakeRepository({ post, job: pendingJob('x') });
  const failedJob = { ...pendingJob('x'), status: 'failed' as const, retryCount: 4, errorCode: 'PUBLISH_FAILED', errorMessage: 'X unavailable', leaseExpiresAt: null };
  const publishing = { publish: async (): Promise<PublishExecution> => ({ ok: false, job: failedJob, error: new Error('X unavailable'), failure: { code: 'UPSTREAM_SERVER_ERROR', retryable: true, ambiguous: false, message: 'X unavailable' } }) } as unknown as PublishingService;

  await assert.rejects(() => new PublishWorkerProcessor(repository, publishing).process('x_job', 60_000), PublishJobTerminalError);
  assert.equal(repository.saved[0]?.retryPending, false);
  assert.equal(repository.saved[0]?.execution.job.status, 'failed');
});

test('an ambiguous remote request reconciles before any second adapter publish and remains fail-closed when unsupported', async () => {
  const ambiguousJob = { ...pendingJob('instagram'), remoteRequestKey: 'social-publish:instagram_job', remoteRequestStartedAt: new Date() };
  const repository = new FakeRepository({ post, job: ambiguousJob });
  let reconcileCalls = 0;
  let publishCalls = 0;
  const publishing = {
    async reconcile() { reconcileCalls += 1; return { status: 'unsupported' as const }; },
    canSafelyRepeatRemoteRequest() { return false; },
    async publish(): Promise<PublishExecution> { publishCalls += 1; throw new Error('must not republish'); },
  } as unknown as PublishingService;

  await assert.rejects(() => new PublishWorkerProcessor(repository, publishing).process('instagram_job', 60_000), PublishJobFailedError);
  assert.equal(reconcileCalls, 1);
  assert.equal(publishCalls, 0);
  assert.equal(repository.ambiguous.length, 1);
  assert.equal(repository.ambiguous[0]?.job.status, 'remote_requesting');
  assert.equal(repository.ambiguous[0]?.job.errorCode, 'AMBIGUOUS_REMOTE_OUTCOME');
});

test('a confirmed reconciliation completes the job without another adapter publish', async () => {
  const ambiguousJob = { ...pendingJob('instagram'), remoteRequestKey: 'social-publish:instagram_job', remoteRequestStartedAt: new Date() };
  const repository = new FakeRepository({ post, job: ambiguousJob });
  let publishCalls = 0;
  const publishedAt = new Date('2026-08-21T00:10:00Z');
  const publishing = {
    async reconcile() { return { status: 'confirmed' as const, result: { remotePostId: 'ig_123', publishedAt } }; },
    async publish(): Promise<PublishExecution> { publishCalls += 1; throw new Error('must not republish'); },
  } as unknown as PublishingService;

  const context = await new PublishWorkerProcessor(repository, publishing).process('instagram_job', 60_000, 2);
  assert.equal(publishCalls, 0);
  assert.equal(repository.saved[0]?.execution.job.status, 'remote_confirmed');
  assert.equal(context?.remotePostId, 'ig_123');
});

test('outbox dispatch enqueues independent records and releases only the enqueue failure', async () => {
  const first: PublishQueueRecord = {
    publishJobId: 'linkedin_job', queueJobId: 'publish-linkedin_job', scheduledAt: post.scheduledAt,
    campaignId: post.campaignId, postId: post.id, platform: 'linkedin', socialAccountId: 'linkedin_account', remotePostId: null,
  };
  const second: PublishQueueRecord = {
    publishJobId: 'x_job', queueJobId: 'publish-x_job', scheduledAt: post.scheduledAt,
    campaignId: post.campaignId, postId: post.id, platform: 'x', socialAccountId: 'x_account', remotePostId: null,
  };
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
