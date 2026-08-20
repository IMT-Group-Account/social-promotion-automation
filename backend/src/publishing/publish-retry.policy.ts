import type { PublishFailure } from './publish-failure';

/** Delay after failure #1, #2, and #3. Failure #4 is terminal. */
export const PUBLISH_RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;
export const PUBLISH_MAX_ATTEMPTS = PUBLISH_RETRY_DELAYS_MS.length + 1;

export function retryDelayForFailure(failureCount: number): number {
  const delay = PUBLISH_RETRY_DELAYS_MS[failureCount - 1];
  if (delay === undefined) throw new RangeError('No retry delay exists for a terminal publish failure.');
  return delay;
}

export function retryDelayForBullMq(attemptsMade: number): number {
  return retryDelayForFailure(Math.min(Math.max(attemptsMade, 1), PUBLISH_RETRY_DELAYS_MS.length));
}

export function shouldRetryPublish(failure: PublishFailure, failureCount: number): boolean {
  return failure.retryable && failureCount <= PUBLISH_RETRY_DELAYS_MS.length;
}
