import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaService } from '../src/media/media.service';
import { InMemoryPostRepository } from '../src/posts/post.repository';
import { PostService } from '../src/posts/post.service';
import { type PublishJobStatus, type SocialPublishJob } from '../src/posts/post.entity';

test('creates one waiting job per selected platform account', () => {
  const service = new PostService(new InMemoryPostRepository(), new MediaService());
  const { post, jobs } = service.create('owner_001', {
    campaignId: 'campaign_001',
    content: { title: 'Support', body: 'Help us reach our goal.', url: 'https://example.com/campaign/123', media: [{ type: 'image', url: 'https://cdn.example.com/image.jpg' }] },
    targets: [{ platform: 'linkedin', accountId: 'linkedin_001' }, { platform: 'facebook', accountId: 'facebook_001' }, { platform: 'x', accountId: 'x_001' }],
    scheduledAt: '2026-08-21T09:00:00+09:00',
  });

  assert.equal(post.status, 'scheduled');
  assert.deepEqual(jobs.map((job) => job.status), ['waiting', 'waiting', 'waiting']);
  assert.ok(jobs.every((job) => job.postId === post.id));
});

test('summarizes one failure without failing waiting sibling jobs', () => {
  const service = new PostService(new InMemoryPostRepository(), new MediaService());
  const statuses: readonly PublishJobStatus[] = ['waiting', 'failed', 'published'];
  const results: readonly SocialPublishJob[] = statuses.map((status, index) => ({
    id: `job_${index}`, postId: 'post_001', platform: 'x' as const, accountId: 'account_001', status,
    scheduledAt: new Date(), publishedAt: null, remotePostId: null, remotePostUrl: null,
    errorCode: null, errorMessage: null, retryCount: 0, leaseExpiresAt: null, nextRetryAt: null,
  }));
  assert.equal(service.summarizeStatus(results), 'partially_failed');
});
