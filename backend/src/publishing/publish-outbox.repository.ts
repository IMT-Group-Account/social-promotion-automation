import { type Post, type SocialPublishJob } from '../posts/post.entity';
import type { PublishExecution } from './publishing.service';
import type { PublishQueueRecord } from './publish-queue.port';

export interface ClaimedPublishJob {
  post: Post;
  job: SocialPublishJob;
}

export interface PublishOutboxRepository {
  claimOutbox(limit: number, leaseMs: number): Promise<readonly PublishQueueRecord[]>;
  markOutboxEnqueued(record: PublishQueueRecord): Promise<void>;
  releaseOutbox(record: PublishQueueRecord, errorMessage: string): Promise<void>;
  claimPublishJob(jobId: string, leaseMs: number, queueJobId?: string): Promise<ClaimedPublishJob | null>;
  markRemoteRequesting(jobId: string, idempotencyKey: string, leaseMs: number): Promise<SocialPublishJob>;
  confirmRemotePublication(job: SocialPublishJob): Promise<SocialPublishJob>;
  recordAmbiguousRemoteOutcome(job: SocialPublishJob, retryPending: boolean, nextRetryAt: Date | null): Promise<void>;
  saveExecution(execution: PublishExecution, retryPending: boolean, nextRetryAt: Date | null): Promise<void>;
}

export const PUBLISH_OUTBOX_REPOSITORY = Symbol('PUBLISH_OUTBOX_REPOSITORY');
