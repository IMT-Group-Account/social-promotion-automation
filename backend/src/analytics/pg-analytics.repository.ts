import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import type { AnalyticsCollectionTarget, AnalyticsRepository, CampaignPlatformAnalytics } from './analytics.repository';
import type { PostAnalytics } from '../publishing/adapters/social-adapter.interface';

@Injectable()
export class PgAnalyticsRepository implements AnalyticsRepository {
  private pool: Pool | undefined;

  async claimCollectionTargets(input: { staleAfterMs: number; leaseMs: number; limit: number }): Promise<readonly AnalyticsCollectionTarget[]> {
    const result = await this.db().query<{
      job_id: string; post_id: string; platform: AnalyticsCollectionTarget['platform']; account_id: string; remote_post_id: string;
    }>(
      `WITH candidates AS (
         SELECT job.id
         FROM social_publish_jobs AS job
         WHERE job.status = 'published'
           AND job.remote_post_id IS NOT NULL
           AND (job.analytics_lease_expires_at IS NULL OR job.analytics_lease_expires_at <= now())
           AND NOT EXISTS (
             SELECT 1
             FROM social_posts AS social_post
             JOIN social_metrics AS metric ON metric.social_post_id = social_post.id
             WHERE social_post.social_publish_job_id = job.id
               AND metric.captured_at > now() - ($1::bigint * interval '1 millisecond')
           )
         ORDER BY job.published_at NULLS LAST, job.id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE social_publish_jobs AS job
       SET analytics_lease_expires_at = now() + ($3::bigint * interval '1 millisecond')
       FROM candidates
       WHERE job.id = candidates.id
       RETURNING job.id AS job_id, job.post_id, job.platform, job.account_id, job.remote_post_id`,
      [input.staleAfterMs, input.limit, input.leaseMs],
    );
    return result.rows.map((row) => ({ jobId: row.job_id, postId: row.post_id, platform: row.platform, accountId: row.account_id, remotePostId: row.remote_post_id }));
  }

  async saveSnapshot(target: AnalyticsCollectionTarget, metrics: PostAnalytics): Promise<void> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO social_metrics (
           social_post_id, impressions, reach, views, likes, comments, shares, reposts, clicks, raw_metrics, captured_at
         )
         SELECT id, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11
         FROM social_posts
         WHERE social_publish_job_id = $1`,
        [
          target.jobId, metrics.impressions ?? null, metrics.reach ?? null, metrics.views ?? null,
          metrics.likes ?? null, metrics.comments ?? null, metrics.shares ?? null, metrics.reposts ?? null,
          metrics.clicks ?? null, JSON.stringify(metrics.rawMetrics ?? {}), metrics.capturedAt,
        ],
      );
      if ((inserted.rowCount ?? 0) !== 1) throw new Error(`Published social post is missing for analytics job ${target.jobId}.`);
      await client.query(
        `UPDATE social_publish_jobs
         SET analytics_lease_expires_at = NULL, analytics_last_collected_at = $2
         WHERE id = $1`, [target.jobId, metrics.capturedAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async releaseCollectionClaim(jobId: string): Promise<void> {
    await this.db().query(`UPDATE social_publish_jobs SET analytics_lease_expires_at = NULL WHERE id = $1`, [jobId]);
  }

  async campaignDashboard(ownerId: string, campaignId: string): Promise<readonly CampaignPlatformAnalytics[] | null> {
    const exists = await this.db().query<{ id: string }>(`SELECT id FROM campaigns WHERE id = $1 AND owner_id = $2`, [campaignId, ownerId]);
    if (!exists.rows[0]) return null;
    const result = await this.db().query<{
      platform: CampaignPlatformAnalytics['platform']; impressions: string | null; reach: string | null; views: string | null; likes: string | null;
      comments: string | null; shares: string | null; reposts: string | null; clicks: string | null; raw_metrics: unknown; captured_at: Date | null;
    }>(
       `WITH latest_metric AS (
         SELECT DISTINCT ON (social_post.social_publish_job_id)
           social_post.social_publish_job_id, metric.impressions, metric.reach, metric.views, metric.likes, metric.comments,
           metric.shares, metric.reposts, metric.clicks, metric.captured_at
         FROM social_posts AS social_post
         JOIN social_metrics AS metric ON metric.social_post_id = social_post.id
         ORDER BY social_post.social_publish_job_id, metric.captured_at DESC, metric.id DESC
       )
       SELECT job.platform,
              sum(latest_metric.impressions)::text AS impressions,
              sum(latest_metric.reach)::text AS reach,
              sum(latest_metric.views)::text AS views,
              sum(latest_metric.likes)::text AS likes,
              sum(latest_metric.comments)::text AS comments,
              sum(latest_metric.shares)::text AS shares,
              sum(latest_metric.reposts)::text AS reposts,
              sum(latest_metric.clicks)::text AS clicks,
              COALESCE(jsonb_agg(latest_metric.raw_metrics) FILTER (WHERE latest_metric.raw_metrics IS NOT NULL), '[]'::jsonb) AS raw_metrics,
              max(latest_metric.captured_at) AS captured_at
       FROM posts
       JOIN social_publish_jobs AS job ON job.post_id = posts.id AND job.status = 'published'
       LEFT JOIN latest_metric ON latest_metric.social_publish_job_id = job.id
       WHERE posts.campaign_id = $1
       GROUP BY job.platform`,
      [campaignId],
    );
    return result.rows.map((row) => ({
      platform: row.platform, ...this.dashboardMetrics(row), capturedAt: row.captured_at,
    }));
  }

  async postDashboard(ownerId: string, postId: string): Promise<readonly CampaignPlatformAnalytics[] | null> {
    const exists = await this.db().query<{ id: string }>(`SELECT id FROM posts WHERE id = $1 AND owner_id = $2`, [postId, ownerId]);
    if (!exists.rows[0]) return null;
    const result = await this.db().query<{
      platform: CampaignPlatformAnalytics['platform']; impressions: string | null; reach: string | null; views: string | null; likes: string | null;
      comments: string | null; shares: string | null; reposts: string | null; clicks: string | null; raw_metrics: unknown; captured_at: Date | null;
    }>(
       `WITH latest_metric AS (
         SELECT DISTINCT ON (social_post.social_publish_job_id)
           social_post.social_publish_job_id, metric.impressions, metric.reach, metric.views, metric.likes, metric.comments,
           metric.shares, metric.reposts, metric.clicks, metric.captured_at
         FROM social_posts AS social_post
         JOIN social_metrics AS metric ON metric.social_post_id = social_post.id
         WHERE social_post.post_id = $1
         ORDER BY social_post.social_publish_job_id, metric.captured_at DESC, metric.id DESC
       )
       SELECT job.platform,
              sum(latest_metric.impressions)::text AS impressions,
              sum(latest_metric.reach)::text AS reach,
              sum(latest_metric.views)::text AS views,
              sum(latest_metric.likes)::text AS likes,
              sum(latest_metric.comments)::text AS comments,
              sum(latest_metric.shares)::text AS shares,
              sum(latest_metric.reposts)::text AS reposts,
              sum(latest_metric.clicks)::text AS clicks,
              COALESCE(jsonb_agg(latest_metric.raw_metrics) FILTER (WHERE latest_metric.raw_metrics IS NOT NULL), '[]'::jsonb) AS raw_metrics,
              max(latest_metric.captured_at) AS captured_at
       FROM social_publish_jobs AS job
       LEFT JOIN latest_metric ON latest_metric.social_publish_job_id = job.id
       WHERE job.post_id = $1 AND job.status = 'published'
       GROUP BY job.platform
       ORDER BY job.platform`,
      [postId],
    );
    return result.rows.map((row) => ({ platform: row.platform, ...this.dashboardMetrics(row), capturedAt: row.captured_at }));
  }

  private dashboardMetrics(row: {
    impressions: string | null; reach: string | null; views: string | null; likes: string | null;
    comments: string | null; shares: string | null; reposts: string | null; clicks: string | null; raw_metrics: unknown;
  }): Omit<CampaignPlatformAnalytics, 'platform' | 'capturedAt'> {
    return { ...this.standardMetrics(row), ...this.rawMetrics(row.raw_metrics) };
  }

  private standardMetrics(row: {
    impressions: string | null; reach: string | null; views: string | null; likes: string | null;
    comments: string | null; shares: string | null; reposts: string | null; clicks: string | null;
  }): Omit<CampaignPlatformAnalytics, 'platform' | 'capturedAt'> {
    return {
      ...(row.impressions === null ? {} : { impressions: Number(row.impressions) }),
      ...(row.reach === null ? {} : { reach: Number(row.reach) }),
      ...(row.views === null ? {} : { views: Number(row.views) }),
      ...(row.likes === null ? {} : { likes: Number(row.likes) }),
      ...(row.comments === null ? {} : { comments: Number(row.comments) }),
      ...(row.shares === null ? {} : { shares: Number(row.shares) }),
      ...(row.reposts === null ? {} : { reposts: Number(row.reposts) }),
      ...(row.clicks === null ? {} : { clicks: Number(row.clicks) }),
    };
  }

  private rawMetrics(value: unknown): Pick<CampaignPlatformAnalytics, 'rawMetrics'> | Record<string, never> {
    const values = Array.isArray(value) ? value : [value];
    const totals: Record<string, number> = {};
    for (const candidate of values) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      for (const [name, metric] of Object.entries(candidate)) {
        if (typeof metric === 'number' && Number.isFinite(metric) && metric >= 0) totals[name] = (totals[name] ?? 0) + metric;
      }
    }
    return Object.keys(totals).length > 0 ? { rawMetrics: totals } : {};
  }

  private db(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ServiceUnavailableException('Analytics database persistence is not configured.');
    this.pool = new Pool({ connectionString, max: 5 });
    return this.pool;
  }
}
