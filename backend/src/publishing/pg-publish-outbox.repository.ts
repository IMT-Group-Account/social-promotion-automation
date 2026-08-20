import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { type Post, type SocialPlatform, type SocialPublishJob } from '../posts/post.entity';
import type { PublishExecution } from './publishing.service';
import type { PublishOutboxRepository, ClaimedPublishJob } from './publish-outbox.repository';
import type { PublishQueueRecord } from './publish-queue.port';

@Injectable()
export class PgPublishOutboxRepository implements PublishOutboxRepository {
  private pool: Pool | undefined;

  async claimOutbox(limit: number, leaseMs: number): Promise<readonly PublishQueueRecord[]> {
    const result = await this.db().query<{ publish_job_id: string; queue_job_id: string; scheduled_at: Date }>(
      `WITH candidates AS (
         SELECT publish_job_id
         FROM social_publish_queue_outbox
         WHERE enqueued_at IS NULL
           AND (dispatch_lease_expires_at IS NULL OR dispatch_lease_expires_at <= now())
         ORDER BY scheduled_at, publish_job_id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE social_publish_queue_outbox AS outbox
       SET dispatch_lease_expires_at = now() + ($2::bigint * interval '1 millisecond'),
           dispatch_attempt_count = dispatch_attempt_count + 1,
           updated_at = now()
       FROM candidates
       WHERE outbox.publish_job_id = candidates.publish_job_id
       RETURNING outbox.publish_job_id, outbox.queue_job_id, outbox.scheduled_at`,
      [limit, leaseMs],
    );
    return result.rows.map((row) => ({ publishJobId: row.publish_job_id, queueJobId: row.queue_job_id, scheduledAt: row.scheduled_at }));
  }

  async markOutboxEnqueued(record: PublishQueueRecord): Promise<void> {
    await this.db().query(
      `UPDATE social_publish_queue_outbox
       SET enqueued_at = now(), dispatch_lease_expires_at = NULL, last_dispatch_error = NULL, updated_at = now()
       WHERE publish_job_id = $1 AND queue_job_id = $2`,
      [record.publishJobId, record.queueJobId],
    );
  }

  async releaseOutbox(record: PublishQueueRecord, errorMessage: string): Promise<void> {
    await this.db().query(
      `UPDATE social_publish_queue_outbox
       SET dispatch_lease_expires_at = NULL, last_dispatch_error = $3, updated_at = now()
       WHERE publish_job_id = $1 AND queue_job_id = $2`,
      [record.publishJobId, record.queueJobId, errorMessage.slice(0, 500)],
    );
  }

  async claimPublishJob(jobId: string, leaseMs: number): Promise<ClaimedPublishJob | null> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query<JobRow>(
        `UPDATE social_publish_jobs
         SET status = 'processing', lease_expires_at = now() + ($2::bigint * interval '1 millisecond'), next_retry_at = NULL, updated_at = now()
         WHERE id = $1
           AND scheduled_at <= now()
           AND (status = 'waiting' OR (status = 'retrying' AND next_retry_at <= now()) OR (status = 'processing' AND lease_expires_at <= now()))
         RETURNING id, post_id, platform, account_id, status, scheduled_at, published_at, remote_post_id, remote_post_url,
                   error_code, error_message, retry_count, lease_expires_at, next_retry_at`,
        [jobId, leaseMs],
      );
      const jobRow = claimed.rows[0];
      if (!jobRow) { await client.query('COMMIT'); return null; }
      const post = await client.query<PostRow>(
        `SELECT id, campaign_id, owner_id, title, body, destination_url, scheduled_at, status
         FROM posts WHERE id = $1`, [jobRow.post_id],
      );
      const postRow = post.rows[0];
      if (!postRow) throw new Error(`Publish job ${jobId} has no post.`);
      const media = await client.query<MediaRow>(
        `SELECT media_type, storage_url FROM post_media WHERE post_id = $1 ORDER BY sort_order ASC`, [postRow.id],
      );
      await client.query('COMMIT');
      return { post: toPost(postRow, media.rows), job: toJob(jobRow) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async saveExecution(execution: PublishExecution, retryPending: boolean, nextRetryAt: Date | null): Promise<void> {
    const job = execution.job;
    if (execution.ok) {
      const client = await this.db().connect();
      try {
        await client.query('BEGIN');
        const update = await client.query<{ post_id: string; account_id: string; platform: SocialPlatform; remote_post_id: string; remote_post_url: string | null; published_at: Date }>(
          `UPDATE social_publish_jobs
           SET status = 'published', published_at = $2, remote_post_id = $3, remote_post_url = $4,
               error_code = NULL, error_message = NULL, lease_expires_at = NULL, updated_at = now()
           WHERE id = $1 AND status = 'processing'
           RETURNING post_id, account_id, platform, remote_post_id, remote_post_url, published_at`,
          [job.id, job.publishedAt, job.remotePostId, job.remotePostUrl],
        );
        const row = update.rows[0];
        if (row) {
          await client.query(
            `INSERT INTO social_posts (
               social_publish_job_id, post_id, social_account_id, platform, remote_post_id, remote_post_url, published_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (social_publish_job_id) DO UPDATE SET
               remote_post_id = EXCLUDED.remote_post_id, remote_post_url = EXCLUDED.remote_post_url,
               published_at = EXCLUDED.published_at, updated_at = now()`,
            [job.id, row.post_id, row.account_id, row.platform, row.remote_post_id, row.remote_post_url, row.published_at],
          );
          await client.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
             SELECT owner_id, 'social_post.published', 'social_publish_job', $1, jsonb_build_object('platform', $2)
             FROM posts WHERE id = $3`,
            [job.id, row.platform, row.post_id],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      return;
    }
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const update = await client.query<{ post_id: string; platform: SocialPlatform; error_code: string; error_message: string; retry_count: number }>(
        `UPDATE social_publish_jobs
         SET status = $2, error_code = $3, error_message = $4, retry_count = $5,
             next_retry_at = $6, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'processing'
         RETURNING post_id, platform, error_code, error_message, retry_count`,
        [job.id, retryPending ? 'retrying' : 'failed', job.errorCode ?? 'UNKNOWN_ERROR', job.errorMessage ?? 'Publishing failed.', job.retryCount, nextRetryAt],
      );
      const row = update.rows[0];
      if (row && !retryPending) {
        await client.query(
          `INSERT INTO social_publish_failure_alerts (
             social_publish_job_id, post_id, platform, error_code, error_message, retry_count
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (social_publish_job_id) DO NOTHING`,
          [job.id, row.post_id, row.platform, row.error_code, row.error_message, row.retry_count],
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
           SELECT owner_id, 'social_publish_job.failed', 'social_publish_job', $1,
                  jsonb_build_object('platform', $2, 'errorCode', $3, 'retryCount', $4)
           FROM posts WHERE id = $5`,
          [job.id, row.platform, row.error_code, row.retry_count, row.post_id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private db(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ServiceUnavailableException('Publishing database persistence is not configured.');
    this.pool = new Pool({ connectionString, max: 5 });
    return this.pool;
  }
}

interface JobRow {
  id: string; post_id: string; platform: SocialPlatform; account_id: string; status: SocialPublishJob['status']; scheduled_at: Date;
  published_at: Date | null; remote_post_id: string | null; remote_post_url: string | null; error_code: string | null;
  error_message: string | null; retry_count: number; lease_expires_at: Date | null; next_retry_at: Date | null;
}
interface PostRow { id: string; campaign_id: string; owner_id: string; title: string; body: string; destination_url: string | null; scheduled_at: Date; status: Post['status']; }
interface MediaRow { media_type: 'image' | 'video'; storage_url: string; }

function toJob(row: JobRow): SocialPublishJob {
  return { id: row.id, postId: row.post_id, platform: row.platform, accountId: row.account_id, status: row.status, scheduledAt: row.scheduled_at,
    publishedAt: row.published_at, remotePostId: row.remote_post_id, remotePostUrl: row.remote_post_url, errorCode: row.error_code,
    errorMessage: row.error_message, retryCount: row.retry_count, leaseExpiresAt: row.lease_expires_at, nextRetryAt: row.next_retry_at };
}
function toPost(row: PostRow, media: readonly MediaRow[]): Post {
  return { id: row.id, campaignId: row.campaign_id, ownerId: row.owner_id, scheduledAt: row.scheduled_at, status: row.status,
    content: { title: row.title, body: row.body, url: row.destination_url, media: media.map((item) => ({ type: item.media_type, url: item.storage_url })) } };
}
