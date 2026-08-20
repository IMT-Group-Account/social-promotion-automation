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
  claimPublishJob(jobId: string, leaseMs: number): Promise<ClaimedPublishJob | null>;
  saveExecution(execution: PublishExecution, retryPending: boolean, nextRetryAt: Date | null): Promise<void>;
}

export const PUBLISH_OUTBOX_REPOSITORY = Symbol('PUBLISH_OUTBOX_REPOSITORY');
