import type { SocialPlatform } from '../posts/post.entity';
import type { PostAnalytics } from '../publishing/adapters/social-adapter.interface';

export interface AnalyticsCollectionTarget {
  jobId: string;
  postId: string;
  platform: SocialPlatform;
  accountId: string;
  remotePostId: string;
}

export interface CampaignPlatformAnalytics extends Omit<PostAnalytics, 'capturedAt' | 'rawMetrics'> {
  platform: SocialPlatform;
  capturedAt: Date | null;
}

export interface RawMetricsCursor {
  capturedAt: Date;
  metricId: string;
}

export interface RawMetricSnapshot {
  metricId: string;
  platform: SocialPlatform;
  remotePostId: string;
  capturedAt: Date;
  rawMetrics: Readonly<Record<string, number>>;
}

export interface CampaignRawMetricsPage {
  items: readonly RawMetricSnapshot[];
  hasMore: boolean;
}

export interface CampaignRawMetricsQuery {
  cursor: RawMetricsCursor | undefined;
  limit: number;
  platform: SocialPlatform | undefined;
}

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');

export interface AnalyticsRepository {
  claimCollectionTargets(input: { staleAfterMs: number; leaseMs: number; limit: number }): Promise<readonly AnalyticsCollectionTarget[]>;
  saveSnapshot(target: AnalyticsCollectionTarget, metrics: PostAnalytics): Promise<void>;
  releaseCollectionClaim(jobId: string): Promise<void>;
  campaignDashboard(ownerId: string, campaignId: string): Promise<readonly CampaignPlatformAnalytics[] | null>;
  postDashboard(ownerId: string, postId: string): Promise<readonly CampaignPlatformAnalytics[] | null>;
  campaignRawMetrics(ownerId: string, campaignId: string, query: CampaignRawMetricsQuery): Promise<CampaignRawMetricsPage | null>;
}
