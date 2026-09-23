import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { SocialPlatform } from '../posts/post.entity';

interface FailureAlert {
  id:string; jobId:string; postId:string; platform:SocialPlatform; errorCode:string; retryCount:number; createdAt:Date;
}

@Injectable()
export class FailureAlertService {
  private readonly logger=new Logger(FailureAlertService.name);
  constructor(private readonly database:DatabaseService){}

  async dispatchPending(limit=20):Promise<{delivered:number;failed:number;disabled:boolean}>{
    const endpoint=process.env.FAILURE_ALERT_WEBHOOK_URL;
    if(!endpoint)return {delivered:0,failed:0,disabled:true};
    let url:URL;
    try{url=new URL(endpoint);}catch{throw new Error('FAILURE_ALERT_WEBHOOK_URL must be a valid URL.');}
    if(url.protocol!=='https:')throw new Error('FAILURE_ALERT_WEBHOOK_URL must use HTTPS.');
    const alerts=await this.claim(limit);
    let delivered=0,failed=0;
    for(const alert of alerts)try{
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(process.env.FAILURE_ALERT_WEBHOOK_TOKEN?{authorization:`Bearer ${process.env.FAILURE_ALERT_WEBHOOK_TOKEN}`}:{})},body:JSON.stringify({event:'social_publish.failed',alertId:alert.id,jobId:alert.jobId,postId:alert.postId,platform:alert.platform,errorCode:alert.errorCode,retryCount:alert.retryCount,createdAt:alert.createdAt.toISOString()}),redirect:'error',signal:AbortSignal.timeout(10_000)});
      if(!response.ok)throw new Error(`Webhook returned HTTP ${response.status}.`);
      await this.markDelivered(alert.id);delivered++;
    }catch(reason){await this.markFailed(alert.id,this.safeError(reason));failed++;this.logger.warn(`Failure alert delivery failed for ${alert.id}.`);}
    return {delivered,failed,disabled:false};
  }

  private async claim(limit:number):Promise<FailureAlert[]>{
    const bounded=Math.max(1,Math.min(100,Math.trunc(limit)));
    const result=await this.database.db().query<{
      id:string;social_publish_job_id:string;post_id:string;platform:SocialPlatform;error_code:string;retry_count:number;created_at:Date;
    }>(`WITH candidates AS (
         SELECT id FROM social_publish_failure_alerts
         WHERE (status IN ('pending','failed') AND next_delivery_at <= now())
            OR (status='processing' AND lease_expires_at < now())
         ORDER BY next_delivery_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE social_publish_failure_alerts AS alert
       SET status='processing',delivery_attempts=delivery_attempts+1,lease_expires_at=now()+interval '30 seconds',last_delivery_error=NULL
       FROM candidates WHERE alert.id=candidates.id
       RETURNING alert.id,alert.social_publish_job_id,alert.post_id,alert.platform,alert.error_code,alert.retry_count,alert.created_at`,[bounded]);
    return result.rows.map(row=>({id:row.id,jobId:row.social_publish_job_id,postId:row.post_id,platform:row.platform,errorCode:row.error_code,retryCount:row.retry_count,createdAt:row.created_at}));
  }
  private async markDelivered(id:string):Promise<void>{await this.database.db().query("UPDATE social_publish_failure_alerts SET status='delivered',delivered_at=now(),lease_expires_at=NULL WHERE id=$1 AND status='processing'",[id]);}
  private async markFailed(id:string,error:string):Promise<void>{await this.database.db().query("UPDATE social_publish_failure_alerts SET status='failed',next_delivery_at=now()+interval '5 minutes',lease_expires_at=NULL,last_delivery_error=$2 WHERE id=$1 AND status='processing'",[id,error]);}
  private safeError(reason:unknown):string{return reason instanceof Error?reason.message.slice(0,300):'Failure alert delivery failed.';}
}
