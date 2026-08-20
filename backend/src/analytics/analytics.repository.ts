import type { SocialPlatform } from '../posts/post.entity';
import type { PostAnalytics } from '../publishing/adapters/social-adapter.interface';

export interface AnalyticsCollectionTarget {
  jobId: string;
  postId: string;
  platform: SocialPlatform;
  accountId: string;
  remotePostId: string;
}

export interface CampaignPlatformAnalytics {
  platform: SocialPlatform;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  capturedAt: Date | null;
}

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');

export interface AnalyticsRepository {
  claimCollectionTargets(input: { staleAfterMs: number; leaseMs: number; limit: number }): Promise<readonly AnalyticsCollectionTarget[]>;
  saveSnapshot(target: AnalyticsCollectionTarget, metrics: PostAnalytics): Promise<void>;
  releaseCollectionClaim(jobId: string): Promise<void>;
  campaignDashboard(ownerId: string, campaignId: string): Promise<readonly CampaignPlatformAnalytics[] | null>;
  postDashboard(ownerId: string, postId: string): Promise<readonly CampaignPlatformAnalytics[] | null>;
}
