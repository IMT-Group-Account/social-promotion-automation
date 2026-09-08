import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { Post, SocialPublishJob } from './post.entity';
import type { PostRecord, PostRepository } from './post.repository';
import { toJob, toPost, type JobRow, type PostRow, type MediaRow } from '../publishing/pg-publish-outbox.repository';
import { missingPublishingScopes } from '../publishing/publishing-permissions';

@Injectable()
export class PgPostRepository implements PostRepository {
  constructor(private readonly database: DatabaseService) {}
  async save(post: Post, jobs: readonly SocialPublishJob[]): Promise<void> {
    await this.database.transaction(async client => {
      const campaign = await client.query('SELECT id FROM campaigns WHERE id=$1 AND owner_id=$2 FOR SHARE', [post.campaignId, post.ownerId]);
      if (!campaign.rowCount) throw new NotFoundException('Campaign not found.');
      await this.checkAccounts(client, post.ownerId, jobs);
      await client.query(`INSERT INTO posts(id,campaign_id,owner_id,title,body,destination_url,scheduled_at,status,platform_bodies)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [post.id,post.campaignId,post.ownerId,post.content.title,post.content.body,post.content.url,post.scheduledAt,post.status,JSON.stringify(post.content.platformBodies ?? {})]);
      await this.media(client, post);
      for (const job of jobs) await client.query(`INSERT INTO social_publish_jobs(id,post_id,platform,account_id,status,scheduled_at)
        VALUES($1,$2,$3,$4,$5,$6)`, [job.id,post.id,job.platform,job.accountId,job.status,job.scheduledAt]);
    });
  }
  async findOwned(id: string, ownerId: string): Promise<PostRecord> {
    return this.database.transaction(client => this.read(client, id, ownerId, false));
  }
  async list(ownerId: string, offset: number): Promise<readonly PostRecord[]> {
    return this.database.transaction(async client => {
      const ids = await client.query<{id:string}>('SELECT id FROM posts WHERE owner_id=$1 ORDER BY scheduled_at DESC,id LIMIT 50 OFFSET $2', [ownerId, offset]);
      const records: PostRecord[] = [];
      for (const {id} of ids.rows) records.push(await this.read(client,id,ownerId,false));
      return records;
    });
  }
  async mutate(id: string, ownerId: string, work: (record: PostRecord) => PostRecord): Promise<PostRecord> {
    return this.database.transaction(async client => {
      const current = await this.read(client,id,ownerId,true);
      const next = work(structuredClone(current));
      if (next.post.status === 'scheduled') await this.checkAccounts(client,ownerId,next.jobs.filter(j => j.status === 'waiting'),true);
      const p = next.post;
      await client.query(`UPDATE posts SET title=$2,body=$3,destination_url=$4,scheduled_at=$5,status=$6,
        revision=revision+1,platform_bodies=$7,updated_at=now() WHERE id=$1`, [id,p.content.title,p.content.body,p.content.url,p.scheduledAt,p.status,JSON.stringify(p.content.platformBodies ?? {})]);
      await this.media(client,p);
      for (const job of next.jobs) {
        const old = current.jobs.find(j => j.id === job.id);
        if (JSON.stringify(old) === JSON.stringify(job)) continue;
        await client.query(`UPDATE social_publish_jobs SET status=$2,scheduled_at=$3,next_retry_at=$4,error_code=$5,error_message=$6,
          retry_count=$7,updated_at=now() WHERE id=$1`, [job.id,job.status,job.scheduledAt,job.nextRetryAt,job.errorCode,job.errorMessage,job.retryCount]);
      }
      if (current.post.status === 'draft' && p.status === 'scheduled') await client.query(`INSERT INTO social_publish_queue_outbox(publish_job_id,scheduled_at,queue_job_id)
        SELECT id,scheduled_at,'publish-'||id::text||'-'||gen_random_uuid()::text FROM social_publish_jobs WHERE post_id=$1 AND status='waiting'
        ON CONFLICT(publish_job_id) DO NOTHING`,[id]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata) VALUES($1,'post.updated','post',$2,$3)`, [ownerId,id,JSON.stringify({status:p.status,revision:(p.revision ?? 1)+1})]);
      return {...next,post:{...p,revision:(p.revision ?? 1)+1}};
    });
  }
  private async read(client: PoolClient,id:string,ownerId:string,lock:boolean): Promise<PostRecord> {
    const posts = await client.query<PostRow>(`SELECT * FROM posts WHERE id=$1 AND owner_id=$2${lock?' FOR UPDATE':''}`, [id,ownerId]);
    if (!posts.rows[0]) throw new NotFoundException('Post not found.');
    const jobs = await client.query<JobRow>(`SELECT * FROM social_publish_jobs WHERE post_id=$1 ORDER BY id${lock?' FOR UPDATE':''}`, [id]);
    const media = await client.query<MediaRow>('SELECT media_type,storage_url FROM post_media WHERE post_id=$1 ORDER BY sort_order',[id]);
    return {post:toPost(posts.rows[0],media.rows),jobs:jobs.rows.map(toJob)};
  }
  private async media(client:PoolClient,post:Post):Promise<void> {
    await client.query('DELETE FROM post_media WHERE post_id=$1',[post.id]);
    for (const [i,m] of post.content.media.entries()) await client.query('INSERT INTO post_media(post_id,media_type,storage_url,sort_order) VALUES($1,$2,$3,$4)',[post.id,m.type,m.url,i]);
  }
  private async checkAccounts(client:PoolClient,ownerId:string,jobs:readonly SocialPublishJob[],publishing=false):Promise<void> {
    for (const job of jobs) {
      const account = await client.query<{scope:string[];platform_account_id:string}>(`SELECT scope,platform_account_id FROM social_accounts WHERE id=$1 AND user_id=$2 AND platform=$3
        AND status='active' AND access_token_encrypted IS NOT NULL AND (expires_at IS NULL OR expires_at > now()) FOR SHARE`,[job.accountId,ownerId,job.platform]);
      if (!account.rowCount) throw new ConflictException('Selected account is unavailable. Reconnect the account.');
      if(publishing){const row=account.rows[0];const missing=missingPublishingScopes(job.platform,row.scope,row.platform_account_id);
        if(missing.length)throw new ConflictException(`${job.platform}: 게시 권한이 부족합니다. 계정을 다시 연결하세요. (${missing.join(', ')})`);}
    }
  }
}
