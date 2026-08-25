import { BadRequestException, Inject, Injectable, Logger, NotFoundException, NotImplementedException } from '@nestjs/common';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '../posts/post.entity';
import { SOCIAL_ADAPTERS, type SocialAdapter } from '../publishing/adapters/social-adapter.interface';
import {
  ANALYTICS_REPOSITORY,
  type AnalyticsRepository,
  type CampaignPlatformAnalytics,
  type CampaignRawMetricsQuery,
  type RawMetricsCursor,
} from './analytics.repository';

export interface AnalyticsCollectionResult {
  collectedJobIds: readonly string[];
  failed: readonly { jobId: string; platform: SocialPlatform; error: string }[];
}

export interface CampaignAnalyticsDashboard {
  campaignId: string;
  platforms: readonly CampaignPlatformAnalytics[];
}

export interface CampaignRawMetricsResponse {
  campaignId: string;
  rawMetrics: readonly {
    platform: SocialPlatform;
    remotePostId: string;
    capturedAt: Date;
    rawMetrics: Readonly<Record<string, number>>;
  }[];
  nextCursor: string | null;
}

@Injectable()
export class AnalyticsService {
  private readonly adaptersByPlatform: ReadonlyMap<SocialPlatform, SocialAdapter>;
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(SOCIAL_ADAPTERS) adapters: readonly SocialAdapter[],
    @Inject(ANALYTICS_REPOSITORY) private readonly repository: AnalyticsRepository,
  ) {
    this.adaptersByPlatform = new Map(adapters.map((adapter) => [adapter.platform, adapter]));
  }

  async getPostAnalytics(platform: SocialPlatform, remotePostId: string, socialAccountId: string) {
    const adapter = this.adaptersByPlatform.get(platform);
    if (!adapter?.getAnalytics) throw new NotImplementedException(`${platform} analytics is not configured.`);
    return adapter.getAnalytics(remotePostId, socialAccountId);
  }

  async collectDue(): Promise<AnalyticsCollectionResult> {
    const targets = await this.repository.claimCollectionTargets({
      staleAfterMs: this.positiveIntegerEnv('ANALYTICS_COLLECTION_STALE_AFTER_MS', 60 * 60 * 1000, 24 * 60 * 60 * 1000),
      leaseMs: this.positiveIntegerEnv('ANALYTICS_COLLECTION_LEASE_MS', 5 * 60 * 1000, 60 * 60 * 1000),
      limit: this.positiveIntegerEnv('ANALYTICS_COLLECTION_BATCH_SIZE', 50, 500),
    });
    const collectedJobIds: string[] = [];
    const failed: { jobId: string; platform: SocialPlatform; error: string }[] = [];
    for (const target of targets) {
      try {
        const metrics = await this.getPostAnalytics(target.platform, target.remotePostId, target.accountId);
        await this.repository.saveSnapshot(target, metrics);
        collectedJobIds.push(target.jobId);
      } catch (error) {
        try { await this.repository.releaseCollectionClaim(target.jobId); }
        catch { this.logger.warn(`Analytics claim release failed for job ${target.jobId}; the bounded lease expiry will recover it.`); }
        failed.push({ jobId: target.jobId, platform: target.platform, error: this.safeError(error) });
      }
    }
    return { collectedJobIds, failed };
  }

  async campaignDashboard(ownerId: string, campaignId: string): Promise<CampaignAnalyticsDashboard> {
    const current = await this.repository.campaignDashboard(ownerId, campaignId);
    if (!current) throw new NotFoundException('Campaign not found.');
    const byPlatform = new Map(current.map((item) => [item.platform, item]));
    const platforms = SOCIAL_PLATFORMS.map((platform) => byPlatform.get(platform) ?? {
      platform, capturedAt: null,
    });
    return { campaignId, platforms };
  }

  async postDashboard(ownerId: string, postId: string): Promise<{ postId: string; platforms: readonly CampaignPlatformAnalytics[] }> {
    const current = await this.repository.postDashboard(ownerId, postId);
    if (!current) throw new NotFoundException('Post not found.');
    const byPlatform = new Map(current.map((item) => [item.platform, item]));
    const platforms = SOCIAL_PLATFORMS.map((platform) => byPlatform.get(platform) ?? {
      platform, capturedAt: null,
    });
    return { postId, platforms };
  }

  async campaignRawMetrics(
    ownerId: string,
    campaignId: string,
    input: { platform?: string; limit?: string; cursor?: string },
  ): Promise<CampaignRawMetricsResponse> {
    const query = this.parseRawMetricsQuery(input);
    const page = await this.repository.campaignRawMetrics(ownerId, campaignId, query);
    if (!page) throw new NotFoundException('Campaign not found.');
    const last = page.items.at(-1);
    return {
      campaignId,
      rawMetrics: page.items.map(({ metricId: _metricId, ...snapshot }) => snapshot),
      nextCursor: page.hasMore && last ? this.encodeCursor({ capturedAt: last.capturedAt, metricId: last.metricId }) : null,
    };
  }

  private parseRawMetricsQuery(input: { platform?: string; limit?: string; cursor?: string }): CampaignRawMetricsQuery {
    const platform = input.platform === undefined || input.platform.length === 0 ? undefined : input.platform;
    if (platform !== undefined && !SOCIAL_PLATFORMS.includes(platform as SocialPlatform)) {
      throw new BadRequestException('platform must be a supported social platform.');
    }
    const limit = input.limit === undefined || input.limit.length === 0 ? 50 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100.');
    }
    return {
      platform: platform as SocialPlatform | undefined,
      limit,
      cursor: input.cursor === undefined || input.cursor.length === 0 ? undefined : this.decodeCursor(input.cursor),
    };
  }

  private encodeCursor(cursor: RawMetricsCursor): string {
    return Buffer.from(JSON.stringify({ capturedAt: cursor.capturedAt.toISOString(), metricId: cursor.metricId })).toString('base64url');
  }

  private decodeCursor(value: string): RawMetricsCursor {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      const { capturedAt, metricId } = parsed as { capturedAt?: unknown; metricId?: unknown };
      const parsedDate = typeof capturedAt === 'string' ? new Date(capturedAt) : undefined;
      if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || typeof metricId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metricId)) {
        throw new Error();
      }
      return { capturedAt: parsedDate, metricId };
    } catch {
      throw new BadRequestException('cursor is invalid.');
    }
  }

  private positiveIntegerEnv(name: string, fallback: number, maximum: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0 || value > maximum) throw new RangeError(`${name} must be a positive integer no greater than ${maximum}.`);
    return value;
  }
  private safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 300) : 'Analytics collection failed.'; }
}
