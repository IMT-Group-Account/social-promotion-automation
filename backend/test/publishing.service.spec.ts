import assert from 'node:assert/strict';
import test from 'node:test';
import { FormatterService } from '../src/publishing/formatter.service';
import { PublishingService } from '../src/publishing/publishing.service';
import { type SocialAdapter, type SocialPost } from '../src/publishing/adapters/social-adapter.interface';
import { type Post, type SocialPublishJob } from '../src/posts/post.entity';

const post: Post = {
  id: 'post_001', campaignId: 'campaign_001', ownerId: 'owner_001', status: 'scheduled', scheduledAt: new Date('2026-08-21T00:00:00Z'),
  content: { title: 'Support our campaign', body: 'Help us reach our goal.', url: null, media: [] },
};

function job(platform: SocialPublishJob['platform']): SocialPublishJob {
  return {
    id: `${platform}_job`, postId: post.id, platform, accountId: `${platform}_account`, status: 'processing', scheduledAt: post.scheduledAt,
    publishedAt: null, remotePostId: null, remotePostUrl: null, errorCode: null, errorMessage: null, retryCount: 0, leaseExpiresAt: new Date(), nextRetryAt: null,
  };
}

test('a failed X adapter changes only the X job result', async () => {
  const xAdapter: SocialAdapter = {
    platform: 'x',
    async publish(_post: SocialPost) { throw new Error('X upstream unavailable'); },
    async getPost() { return { remotePostId: 'unused', status: 'unknown' as const }; },
  };
  const publishing = new PublishingService([xAdapter], new FormatterService());
  const linkedinBefore = job('linkedin');
  const linkedinSnapshot = { ...linkedinBefore };
  const xBefore = job('x');
  const result = await publishing.publish(post, xBefore);

  assert.equal(result.ok, false);
  assert.equal(result.job.platform, 'x');
  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.retryCount, 1);
  assert.deepEqual(linkedinBefore, linkedinSnapshot);
});

test('adapter selection is platform-agnostic to the publishing service', async () => {
  const linkedinAdapter: SocialAdapter = {
    platform: 'linkedin',
    async publish() { return { remotePostId: 'linkedin_123', remotePostUrl: 'https://linkedin.example/post/123', publishedAt: new Date('2026-08-21T00:05:00Z') }; },
    async getPost() { return { remotePostId: 'linkedin_123', status: 'published' as const }; },
  };
  const result = await new PublishingService([linkedinAdapter], new FormatterService()).publish(post, job('linkedin'));

  assert.equal(result.ok, true);
  assert.equal(result.job.status, 'published');
  assert.equal(result.job.remotePostId, 'linkedin_123');
});
