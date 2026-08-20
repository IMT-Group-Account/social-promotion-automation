import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsService } from '../src/analytics/analytics.service';
import type { AnalyticsCollectionTarget, AnalyticsRepository, CampaignPlatformAnalytics } from '../src/analytics/analytics.repository';
import type { PostAnalytics, PublishResult, SocialAdapter, SocialPost, SocialPostResult } from '../src/publishing/adapters/social-adapter.interface';
import type { SocialPlatform } from '../src/posts/post.entity';

const linkedinTarget: AnalyticsCollectionTarget = { jobId: 'job-linkedin', postId: 'post-001', platform: 'linkedin', accountId: 'account-linkedin', remotePostId: 'urn:li:share:1' };
const xTarget: AnalyticsCollectionTarget = { jobId: 'job-x', postId: 'post-001', platform: 'x', accountId: 'account-x', remotePostId: 'post-x-1' };

class MemoryAnalyticsRepository implements AnalyticsRepository {
  readonly saved: { target: AnalyticsCollectionTarget; metrics: PostAnalytics }[] = [];
  readonly released: string[] = [];
  constructor(private readonly targets: readonly AnalyticsCollectionTarget[], private readonly dashboard: readonly CampaignPlatformAnalytics[] | null) {}
  async claimCollectionTargets(): Promise<readonly AnalyticsCollectionTarget[]> { return this.targets; }
  async saveSnapshot(target: AnalyticsCollectionTarget, metrics: PostAnalytics): Promise<void> { this.saved.push({ target, metrics }); }
  async releaseCollectionClaim(jobId: string): Promise<void> { this.released.push(jobId); }
  async campaignDashboard(): Promise<readonly CampaignPlatformAnalytics[] | null> { return this.dashboard; }
  async postDashboard(): Promise<readonly CampaignPlatformAnalytics[] | null> { return this.dashboard; }
}

class TestAdapter implements SocialAdapter {
  constructor(readonly platform: SocialPlatform, private readonly analytics: (postId: string, accountId?: string) => Promise<PostAnalytics>) {}
  async publish(_post: SocialPost): Promise<PublishResult> { throw new Error('Not used.'); }
  async getPost(postId: string): Promise<SocialPostResult> { return { remotePostId: postId, status: 'published' }; }
  async getAnalytics(postId: string, accountId?: string): Promise<PostAnalytics> { return this.analytics(postId, accountId); }
}

const metrics: PostAnalytics = { views: 12_200, likes: 241, comments: 31, shares: 18, clicks: 280, capturedAt: new Date('2026-08-20T00:00:00Z') };

test('collects one successful platform snapshot without losing a sibling platform on GET failure', async () => {
  const repository = new MemoryAnalyticsRepository([linkedinTarget, xTarget], []);
  const linkedin = new TestAdapter('linkedin', async (postId, accountId) => { assert.equal(postId, 'urn:li:share:1'); assert.equal(accountId, 'account-linkedin'); return metrics; });
  const x = new TestAdapter('x', async () => { throw new Error('X analytics temporarily unavailable'); });
  const service = new AnalyticsService([linkedin, x], repository);

  const result = await service.collectDue();
  assert.deepEqual(result.collectedJobIds, ['job-linkedin']);
  assert.deepEqual(repository.saved, [{ target: linkedinTarget, metrics }]);
  assert.deepEqual(repository.released, ['job-x']);
  assert.deepEqual(result.failed, [{ jobId: 'job-x', platform: 'x', error: 'X analytics temporarily unavailable' }]);
});

test('returns a five-platform campaign dashboard with the latest known metrics and zero-filled missing platforms', async () => {
  const repository = new MemoryAnalyticsRepository([], [{ platform: 'linkedin', views: 12_200, likes: 241, comments: 31, shares: 18, clicks: 280, capturedAt: metrics.capturedAt }]);
  const service = new AnalyticsService([], repository);
  const dashboard = await service.campaignDashboard('owner-001', 'campaign-001');

  assert.equal(dashboard.campaignId, 'campaign-001');
  assert.deepEqual(dashboard.platforms.find((item) => item.platform === 'linkedin'), {
    platform: 'linkedin', views: 12_200, likes: 241, comments: 31, shares: 18, clicks: 280, capturedAt: metrics.capturedAt,
  });
  assert.deepEqual(dashboard.platforms.find((item) => item.platform === 'instagram'), {
    platform: 'instagram', views: 0, likes: 0, comments: 0, shares: 0, clicks: 0, capturedAt: null,
  });
});
