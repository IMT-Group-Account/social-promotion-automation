import type { ConnectionOptions } from 'bullmq';
import { PUBLISH_MAX_ATTEMPTS } from './publish-retry.policy';

export interface PublishQueueConfig {
  redisConnection: ConnectionOptions;
  queueName: string;
  attempts: number;
  workerConcurrency: number;
  workerLeaseMs: number;
  outboxPollIntervalMs: number;
}

function positiveInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/** Reads server-only Redis settings only when a queue or worker is started. */
export function publishQueueConfig(): PublishQueueConfig {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for social publishing queue execution.');
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new TypeError('REDIS_URL must use redis:// or rediss://.');
  }
  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('REDIS_URL contains an invalid port.');
  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  return {
    redisConnection: {
      host: parsed.hostname,
      port,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
      // BullMQ Workers need an indefinitely retryable blocking connection.
      maxRetriesPerRequest: null,
    },
    queueName: process.env.BULLMQ_PUBLISH_QUEUE_NAME?.trim() || 'social-publish',
    attempts: PUBLISH_MAX_ATTEMPTS,
    workerConcurrency: positiveInteger('PUBLISH_WORKER_CONCURRENCY', 5, 1, 50),
    workerLeaseMs: positiveInteger('PUBLISH_WORKER_LEASE_MS', 30_000, 10_000, 3_600_000),
    outboxPollIntervalMs: positiveInteger('PUBLISH_OUTBOX_POLL_INTERVAL_MS', 5_000, 1_000, 60_000),
  };
}

export function publishingWorkerEnabled(): boolean {
  return process.env.PUBLISH_WORKER_ENABLED === 'true';
}
