import { Inject, Injectable } from '@nestjs/common';
import { type Post, type SocialPublishJob } from '../posts/post.entity';
import { FormatterService } from './formatter.service';
import { type PublishResult, type SocialAdapter, SOCIAL_ADAPTERS } from './adapters/social-adapter.interface';
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
    if (job.status !== 'processing') {
      const error = new Error('Only a processing job may be published.');
      return { ok: false, job, error, failure: { code: 'INVALID_REQUEST', retryable: false, message: error.message } };
    }
    const adapter = this.adaptersByPlatform.get(job.platform);
    if (!adapter) {
      const error = new Error('No platform adapter is registered.');
      return { ok: false, job: this.fail(job, 'INVALID_REQUEST', error.message), error, failure: { code: 'INVALID_REQUEST', retryable: false, message: error.message } };
    }
    try {
      const result = await adapter.publish(this.formatter.format(post, job));
      if (!result.remotePostId) throw new Error('Adapter returned no remotePostId.');
      return { ok: true, result, job: {
        ...job, status: 'published', publishedAt: result.publishedAt, remotePostId: result.remotePostId,
        remotePostUrl: result.remotePostUrl ?? null, errorCode: null, errorMessage: null, leaseExpiresAt: null,
      } };
    } catch (error: unknown) {
      const failure = classifyPublishFailure(error);
      return { ok: false, job: this.fail(job, failure.code, failure.message), error, failure };
    }
  }

  private fail(job: SocialPublishJob, errorCode: string, errorMessage: string): SocialPublishJob {
    return { ...job, status: 'failed', errorCode, errorMessage, retryCount: job.retryCount + 1, leaseExpiresAt: null, nextRetryAt: null };
  }
}
