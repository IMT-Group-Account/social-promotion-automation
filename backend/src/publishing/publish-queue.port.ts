import type { SocialPlatform } from '../posts/post.entity';

export interface PublishQueueMessage {
  publishJobId: string;
  campaignId: string;
  postId: string;
  platform: SocialPlatform;
  socialAccountId: string;
  remotePostId: string | null;
}

export interface PublishQueueRecord extends PublishQueueMessage {
  queueJobId: string;
  scheduledAt: Date;
}

export interface PublishWorkerLogContext extends PublishQueueMessage {
  attempt: number;
  errorCode: string | null;
}

export interface PublishQueuePort {
  enqueue(record: PublishQueueRecord): Promise<void>;
  close?(): Promise<void>;
}

export const PUBLISH_QUEUE_PORT = Symbol('PUBLISH_QUEUE_PORT');
