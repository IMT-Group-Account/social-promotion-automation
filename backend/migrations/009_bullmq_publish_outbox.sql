-- Transactional hand-off from PostgreSQL publish jobs to the Redis/BullMQ
-- scheduler. The trigger makes every newly persisted platform job eligible for
-- dispatch without relying on an in-process timer.

CREATE TABLE social_publish_queue_outbox (
  publish_job_id uuid PRIMARY KEY REFERENCES social_publish_jobs(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  queue_job_id text NOT NULL UNIQUE,
  enqueued_at timestamptz,
  dispatch_attempt_count integer NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
  dispatch_lease_expires_at timestamptz,
  last_dispatch_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX social_publish_queue_outbox_due_idx
  ON social_publish_queue_outbox (scheduled_at, publish_job_id)
  WHERE enqueued_at IS NULL;

CREATE OR REPLACE FUNCTION create_social_publish_queue_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO social_publish_queue_outbox (publish_job_id, scheduled_at, queue_job_id)
  VALUES (NEW.id, NEW.scheduled_at, 'publish-' || NEW.id::text)
  ON CONFLICT (publish_job_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_publish_jobs_enqueue_outbox_trigger
AFTER INSERT ON social_publish_jobs
FOR EACH ROW EXECUTE FUNCTION create_social_publish_queue_outbox();

-- Existing scheduled rows are safe to backfill. Queue job IDs are deterministic
-- and contain no colon, which keeps BullMQ duplicate protection usable.
INSERT INTO social_publish_queue_outbox (publish_job_id, scheduled_at, queue_job_id)
SELECT id, scheduled_at, 'publish-' || id::text
FROM social_publish_jobs
WHERE status = 'pending'
ON CONFLICT (publish_job_id) DO NOTHING;
