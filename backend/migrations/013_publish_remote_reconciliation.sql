-- Persist the boundary before an irreversible provider write. A worker may
-- retry reconciliation, but it must not blindly repeat an ambiguous request.

ALTER TABLE social_publish_jobs DROP CONSTRAINT social_publish_jobs_status_check;

UPDATE social_publish_jobs
SET status = 'claimed'
WHERE status = 'processing';

ALTER TABLE social_publish_jobs
  ADD COLUMN remote_request_key text,
  ADD COLUMN remote_request_started_at timestamptz;

UPDATE social_publish_jobs
SET remote_request_key = 'legacy:' || id::text
WHERE status = 'published' AND remote_request_key IS NULL;

ALTER TABLE social_publish_jobs
  ADD CONSTRAINT social_publish_jobs_status_check
    CHECK (status IN ('waiting', 'claimed', 'remote_requesting', 'remote_confirmed', 'published', 'failed', 'retrying', 'cancelled')),
  ADD CONSTRAINT social_publish_jobs_remote_request_key_check
    CHECK (status NOT IN ('remote_requesting', 'remote_confirmed', 'published') OR remote_request_key IS NOT NULL),
  ADD CONSTRAINT social_publish_jobs_remote_confirmed_has_remote_reference
    CHECK (status <> 'remote_confirmed' OR (published_at IS NOT NULL AND remote_post_id IS NOT NULL));

CREATE INDEX social_publish_jobs_remote_reconciliation_idx
  ON social_publish_jobs (next_retry_at, id)
  WHERE status = 'remote_requesting';
