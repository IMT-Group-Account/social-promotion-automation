import { Inject, Injectable } from '@nestjs/common';
import { type Post, type SocialPublishJob } from '../posts/post.entity';
import { FormatterService } from './formatter.service';
import { type PublishReconciliation, type PublishResult, type SocialAdapter, SOCIAL_ADAPTERS } from './adapters/social-adapter.interface';
import { classifyPublishFailure, type PublishFailure } from './publish-failure';

export type PublishExecution =
  | { ok: true; job: SocialPublishJob; result: PublishResult }
  | { ok: false; job: SocialPublishJob; error: unknown; failure: PublishFailure };

@Injectable()
export class PublishingService {
  private readonly adaptersByPlatform: ReadonlyMap<string, SocialAdapter>;

  constructor(
    @Inject(SOCIAL_ADAPTERS) adapters: readonly SocialAdapter[],
    private readonly formatter: FormatterService,
  ) {
    this.adaptersByPlatform = new Map(adapters.map((adapter) => [adapter.platform, adapter]));
  }

  /** Executes and returns a replacement for this one job only. It never mutates sibling jobs. */
  async publish(post: Post, job: SocialPublishJob): Promise<PublishExecution> {
    if (job.status !== 'remote_requesting' || !job.remoteRequestKey) {
      const error = new Error('Only a remote-requesting job with a stable request key may be published.');
      return { ok: false, job, error, failure: { code: 'INVALID_REQUEST', retryable: false, ambiguous: false, message: error.message } };
    }
    const adapter = this.adaptersByPlatform.get(job.platform);
    if (!adapter) {
      const error = new Error('No platform adapter is registered.');
      return { ok: false, job: this.fail(job, 'INVALID_REQUEST', error.message), error, failure: { code: 'INVALID_REQUEST', retryable: false, ambiguous: false, message: error.message } };
    }
    try {
      const result = await adapter.publish(this.formatter.format(post, job), { idempotencyKey: job.remoteRequestKey });
      if (!result.remotePostId) throw new Error('Adapter returned no remotePostId.');
      return { ok: true, result, job: {
        ...job, status: 'remote_confirmed', publishedAt: result.publishedAt, remotePostId: result.remotePostId,
        remotePostUrl: result.remotePostUrl ?? null, errorCode: null, errorMessage: null, leaseExpiresAt: null,
      } };
    } catch (error: unknown) {
      const failure = classifyPublishFailure(error);
      return { ok: false, job: this.fail(job, failure.code, failure.message), error, failure };
    }
  }

  /**
   * Reconciliation always precedes a second external write for a job that has
   * already entered REMOTE_REQUESTING. A provider-specific adapter may look up
   * the stable request key; a persisted remote post ID can use getPost().
   */
  async reconcile(post: Post, job: SocialPublishJob): Promise<PublishReconciliation> {
    const adapter = this.adaptersByPlatform.get(job.platform);
    if (!adapter || !job.remoteRequestKey) return { status: 'unsupported' };
    const formatted = this.formatter.format(post, job);
    if (job.remotePostId) {
      try {
        const remote = await adapter.getPost(job.remotePostId, job.accountId);
        if (remote.status === 'published') {
          return { status: 'confirmed', result: {
            remotePostId: remote.remotePostId,
            ...(remote.remotePostUrl ? { remotePostUrl: remote.remotePostUrl } : {}),
            publishedAt: job.publishedAt ?? new Date(),
          } };
        }
        return remote.status === 'not_found' || remote.status === 'deleted' ? { status: 'not_found' } : { status: 'unknown' };
      } catch { return { status: 'unknown' }; }
    }
    if (!adapter.reconcilePublish) return { status: 'unsupported' };
    try { return await adapter.reconcilePublish(formatted, { idempotencyKey: job.remoteRequestKey }); }
    catch { return { status: 'unknown' }; }
  }

  canSafelyRepeatRemoteRequest(platform: SocialPublishJob['platform']): boolean {
    return this.adaptersByPlatform.get(platform)?.supportsIdempotentPublish === true;
  }

  private fail(job: SocialPublishJob, errorCode: string, errorMessage: string): SocialPublishJob {
    return { ...job, status: 'failed', errorCode, errorMessage, retryCount: job.retryCount + 1, leaseExpiresAt: null, nextRetryAt: null };
  }
}
