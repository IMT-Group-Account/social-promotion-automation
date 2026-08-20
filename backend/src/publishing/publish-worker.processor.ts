import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { PUBLISH_OUTBOX_REPOSITORY, type PublishOutboxRepository } from './publish-outbox.repository';
import { type PublishExecution, PublishingService } from './publishing.service';
import { retryDelayForFailure, shouldRetryPublish } from './publish-retry.policy';

/** Transient failure deliberately reaches BullMQ so its retry/backoff policy applies. */
export class PublishJobFailedError extends Error {
  constructor(public readonly publishJobId: string, message: string) { super(message); }
}

export class PublishJobTerminalError extends UnrecoverableError {
  constructor(public readonly publishJobId: string, message: string) { super(message); }
}

@Injectable()
export class PublishWorkerProcessor {
  constructor(
    @Inject(PUBLISH_OUTBOX_REPOSITORY) private readonly repository: PublishOutboxRepository,
    private readonly publishing: PublishingService,
  ) {}

  async process(publishJobId: string, leaseMs: number): Promise<void> {
    const claimed = await this.repository.claimPublishJob(publishJobId, leaseMs);
    // A duplicate BullMQ delivery or cancelled/previously completed job is safe
    // to acknowledge because the database state is the source of truth.
    if (!claimed) return;
    const execution = await this.publishing.publish(claimed.post, claimed.job);
    if (execution.ok) {
      await this.repository.saveExecution(execution, false, null);
      return;
    }
    const failureCount = execution.job.retryCount;
    const retryPending = shouldRetryPublish(execution.failure, failureCount);
    const nextRetryAt = retryPending ? new Date(Date.now() + retryDelayForFailure(failureCount)) : null;
    await this.repository.saveExecution(execution, retryPending, nextRetryAt);
    if (retryPending) throw new PublishJobFailedError(publishJobId, executionMessage(execution));
    throw new PublishJobTerminalError(publishJobId, executionMessage(execution));
  }
}

function executionMessage(execution: Extract<PublishExecution, { ok: false }>): string {
  return execution.job.errorMessage ?? (execution.error instanceof Error ? execution.error.message : 'Social publishing failed.');
}
