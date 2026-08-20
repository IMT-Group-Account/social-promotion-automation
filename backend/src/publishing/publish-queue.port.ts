export interface PublishQueueMessage {
  publishJobId: string;
}

export interface PublishQueueRecord extends PublishQueueMessage {
  queueJobId: string;
  scheduledAt: Date;
}

export interface PublishQueuePort {
  enqueue(record: PublishQueueRecord): Promise<void>;
  close?(): Promise<void>;
}

export const PUBLISH_QUEUE_PORT = Symbol('PUBLISH_QUEUE_PORT');
