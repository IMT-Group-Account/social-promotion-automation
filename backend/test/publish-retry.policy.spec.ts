import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { classifyPublishFailure, SocialApiHttpError } from '../src/publishing/publish-failure';
import { PUBLISH_MAX_ATTEMPTS, PUBLISH_RETRY_DELAYS_MS, retryDelayForBullMq, retryDelayForFailure, shouldRetryPublish } from '../src/publishing/publish-retry.policy';

test('publishing retries follow 30 seconds, 2 minutes, then 10 minutes', () => {
  assert.deepEqual(PUBLISH_RETRY_DELAYS_MS, [30_000, 120_000, 600_000]);
  assert.equal(PUBLISH_MAX_ATTEMPTS, 4);
  assert.equal(retryDelayForFailure(1), 30_000);
  assert.equal(retryDelayForFailure(2), 120_000);
  assert.equal(retryDelayForFailure(3), 600_000);
  assert.equal(retryDelayForBullMq(1), 30_000);
  assert.equal(retryDelayForBullMq(2), 120_000);
  assert.equal(retryDelayForBullMq(3), 600_000);
});

test('401 and 403 are terminal, while 429 and provider 500 are retryable', () => {
  const expired = classifyPublishFailure(new UnauthorizedException('expired'));
  const forbidden = classifyPublishFailure(new ForbiddenException('scope missing'));
  const rateLimited = classifyPublishFailure(new SocialApiHttpError('X', 429));
  const upstreamFailure = classifyPublishFailure(new SocialApiHttpError('LinkedIn', 500));

  assert.deepEqual(expired.code, 'TOKEN_EXPIRED');
  assert.equal(expired.retryable, false);
  assert.deepEqual(forbidden.code, 'PERMISSION_DENIED');
  assert.equal(forbidden.retryable, false);
  assert.deepEqual(rateLimited.code, 'RATE_LIMITED');
  assert.equal(rateLimited.retryable, true);
  assert.deepEqual(upstreamFailure.code, 'UPSTREAM_SERVER_ERROR');
  assert.equal(upstreamFailure.retryable, true);
  assert.equal(shouldRetryPublish(rateLimited, 3), true);
  assert.equal(shouldRetryPublish(rateLimited, 4), false);
});
