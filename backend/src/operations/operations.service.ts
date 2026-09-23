import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class OperationsService {
  constructor(private readonly database:DatabaseService){}
  async audit(ownerId:string){
    return (await this.database.db().query(`SELECT id,action,entity_type AS "entityType",entity_id AS "entityId",metadata,created_at AS "createdAt"
      FROM audit_logs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[ownerId])).rows;
  }
  async failures(ownerId:string){
    return (await this.database.db().query(`SELECT alert.id,alert.social_publish_job_id AS "jobId",alert.post_id AS "postId",alert.platform,
      alert.error_code AS "errorCode",alert.error_message AS "errorMessage",alert.retry_count AS "retryCount",alert.status,
      alert.delivery_attempts AS "deliveryAttempts",alert.next_delivery_at AS "nextDeliveryAt",alert.created_at AS "createdAt",alert.delivered_at AS "deliveredAt"
      FROM social_publish_failure_alerts alert JOIN posts ON posts.id=alert.post_id
      WHERE posts.owner_id=$1 ORDER BY alert.created_at DESC,alert.id DESC LIMIT 100`,[ownerId])).rows;
  }
}
