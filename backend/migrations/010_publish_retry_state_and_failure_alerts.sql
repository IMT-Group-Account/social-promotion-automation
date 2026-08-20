-- Canonical per-platform publishing state machine and durable final-failure
-- notification outbox. Existing data is migrated without touching siblings.

ALTER TABLE social_publish_jobs DROP CONSTRAINT social_publish_jobs_status_check;
ALTER TABLE social_publish_jobs DROP CONSTRAINT social_publish_jobs_success_has_remote_reference;

UPDATE social_publish_jobs
SET status = CASE status
  WHEN 'pending' THEN 'waiting'
  WHEN 'leased' THEN 'retrying'
  WHEN 'publishing' THEN 'retrying'
  WHEN 'succeeded' THEN 'published'
  ELSE status
END;

ALTER TABLE social_publish_jobs
  ALTER COLUMN status SET DEFAULT 'waiting',
  ADD COLUMN next_retry_at timestamptz,
  ADD CONSTRAINT social_publish_jobs_status_check
    CHECK (status IN ('waiting', 'processing', 'published', 'failed', 'retrying', 'cancelled')),
  ADD CONSTRAINT social_publish_jobs_published_has_remote_reference
    CHECK (status <> 'published' OR (published_at IS NOT NULL AND remote_post_id IS NOT NULL));

DROP INDEX social_publish_jobs_due_idx;
CREATE INDEX social_publish_jobs_waiting_idx
  ON social_publish_jobs (scheduled_at, id)
  WHERE status = 'waiting';
CREATE INDEX social_publish_jobs_retrying_idx
  ON social_publish_jobs (next_retry_at, id)
  WHERE status = 'retrying';

DROP INDEX social_publish_jobs_analytics_due_idx;
CREATE INDEX social_publish_jobs_analytics_due_idx
  ON social_publish_jobs (analytics_lease_expires_at, analytics_last_collected_at)
  WHERE status = 'published' AND remote_post_id IS NOT NULL;

CREATE TABLE social_publish_failure_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_publish_job_id uuid NOT NULL UNIQUE REFERENCES social_publish_jobs(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'instagram', 'threads', 'x')),
  error_code text NOT NULL,
  error_message text NOT NULL,
  retry_count integer NOT NULL CHECK (retry_count >= 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX social_publish_failure_alerts_pending_idx
  ON social_publish_failure_alerts (created_at, id)
  WHERE status = 'pending';
