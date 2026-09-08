import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { SocialPublishJob } from '../posts/post.entity';
import { PUBLISH_OUTBOX_REPOSITORY, type PublishOutboxRepository } from './publish-outbox.repository';
import { type PublishExecution, PublishingService } from './publishing.service';
import { retryDelayForFailure, shouldRetryPublish } from './publish-retry.policy';
import type { PublishWorkerLogContext } from './publish-queue.port';

/** Transient failure deliberately reaches BullMQ so its retry/backoff policy applies. */
export class PublishJobFailedError extends Error {
  constructor(public readonly context: PublishWorkerLogContext, message: string) { super(message); }
}

export class PublishJobTerminalError extends UnrecoverableError {
  constructor(public readonly context: PublishWorkerLogContext, message: string) { super(message); }
}

@Injectable()
export class PublishWorkerProcessor {
  constructor(
    @Inject(PUBLISH_OUTBOX_REPOSITORY) private readonly repository: PublishOutboxRepository,
    private readonly publishing: PublishingService,
  ) {}

  async process(publishJobId: string, leaseMs: number, attempt = 1, queueJobId?: string): Promise<PublishWorkerLogContext | null> {
    const claimed = await this.repository.claimPublishJob(publishJobId, leaseMs, queueJobId);
    // A duplicate BullMQ delivery or cancelled/previously completed job is safe
    // to acknowledge because the database state is the source of truth.
    if (!claimed) return null;
    let job = claimed.job;
    // A crash after durable remote confirmation must only finish local persistence.
    if (job.status === 'remote_confirmed' && job.remotePostId && job.publishedAt) {
      await this.repository.saveExecution({ok:true,job,result:{remotePostId:job.remotePostId,publishedAt:job.publishedAt,remotePostUrl:job.remotePostUrl??undefined}},false,null);
      return this.logContext(claimed.post.campaignId,job,attempt,null);
    }
    if (job.remoteRequestKey) {
      const reconciliation = await this.publishing.reconcile(claimed.post, job);
      if (reconciliation.status === 'confirmed') {
        job = await this.repository.markRemoteRequesting(job.id, job.remoteRequestKey, leaseMs);
        return this.persistSuccess(claimed.post.campaignId, {
          ok: true,
          job: { ...job, status: 'remote_confirmed', publishedAt: reconciliation.result.publishedAt, remotePostId: reconciliation.result.remotePostId, remotePostUrl: reconciliation.result.remotePostUrl ?? null, errorCode: null, errorMessage: null, leaseExpiresAt: null },
          result: reconciliation.result,
        }, attempt);
      }
      if (!this.publishing.canSafelyRepeatRemoteRequest(job.platform)) {
        return this.deferAmbiguousRemoteOutcome(claimed.post.campaignId, job, attempt);
      }
    }
    job = await this.repository.markRemoteRequesting(job.id, job.remoteRequestKey ?? `social-publish:${job.id}`, leaseMs);
    const execution = await this.publishing.publish(claimed.post, job);
    if (execution.ok) {
      return this.persistSuccess(claimed.post.campaignId, execution, attempt);
    }
    if (execution.failure.ambiguous) {
      const reconciliation = await this.publishing.reconcile(claimed.post, job);
      if (reconciliation.status === 'confirmed') return this.persistSuccess(claimed.post.campaignId, {
        ok: true,
        job: { ...job, status: 'remote_confirmed', publishedAt: reconciliation.result.publishedAt, remotePostId: reconciliation.result.remotePostId, remotePostUrl: reconciliation.result.remotePostUrl ?? null, errorCode: null, errorMessage: null, leaseExpiresAt: null },
        result: reconciliation.result,
      }, attempt);
      return this.deferAmbiguousRemoteOutcome(claimed.post.campaignId, execution.job, attempt);
    }
    const failureCount = execution.job.retryCount;
    const retryPending = shouldRetryPublish(execution.failure, failureCount);
    const nextRetryAt = retryPending ? new Date(Date.now() + retryDelayForFailure(failureCount)) : null;
    await this.repository.saveExecution(execution, retryPending, nextRetryAt);
    const context = this.logContext(claimed.post.campaignId, execution.job, attempt, execution.job.errorCode ?? 'UNKNOWN_ERROR');
    if (retryPending) throw new PublishJobFailedError(context, executionMessage(execution));
    throw new PublishJobTerminalError(context, executionMessage(execution));
  }

  private async persistSuccess(campaignId: string, execution: Extract<PublishExecution, { ok: true }>, attempt: number): Promise<PublishWorkerLogContext> {
    const confirmedJob = await this.repository.confirmRemotePublication(execution.job);
    await this.repository.saveExecution({ ...execution, job: confirmedJob }, false, null);
    return this.logContext(campaignId, confirmedJob, attempt, null);
  }

  private async deferAmbiguousRemoteOutcome(campaignId: string, job: SocialPublishJob, attempt: number): Promise<PublishWorkerLogContext> {
    const deferredJob: SocialPublishJob = {
      ...job, status: 'remote_requesting', errorCode: 'AMBIGUOUS_REMOTE_OUTCOME',
      errorMessage: 'Remote publish outcome could not be confirmed; reconciliation is required before another write.',
      retryCount: job.retryCount + (job.status === 'failed' ? 0 : 1), leaseExpiresAt: null,
    };
    const retryPending = deferredJob.retryCount <= 3;
    const nextRetryAt = retryPending ? new Date(Date.now() + retryDelayForFailure(deferredJob.retryCount)) : null;
    await this.repository.recordAmbiguousRemoteOutcome(deferredJob, retryPending, nextRetryAt);
    const context = this.logContext(campaignId, deferredJob, attempt, 'AMBIGUOUS_REMOTE_OUTCOME');
    if (retryPending) throw new PublishJobFailedError(context, deferredJob.errorMessage ?? 'Remote outcome is ambiguous.');
    throw new PublishJobTerminalError(context, deferredJob.errorMessage ?? 'Remote outcome is ambiguous.');
  }

  private logContext(campaignId: string, job: PublishExecution['job'], attempt: number, errorCode: string | null): PublishWorkerLogContext {
    return {
      campaignId, postId: job.postId, publishJobId: job.id, platform: job.platform,
      socialAccountId: job.accountId, remotePostId: job.remotePostId, attempt, errorCode,
    };
  }
}

function executionMessage(execution: Extract<PublishExecution, { ok: false }>): string {
  return execution.job.errorMessage ?? (execution.error instanceof Error ? execution.error.message : 'Social publishing failed.');
}
