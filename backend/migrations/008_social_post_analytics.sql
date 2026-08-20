-- Periodic platform analytics. Each snapshot belongs to exactly one successful
-- publish job so a collection failure never affects sibling platform results.

ALTER TABLE social_publish_jobs
  ADD COLUMN analytics_lease_expires_at timestamptz,
  ADD COLUMN analytics_last_collected_at timestamptz;

CREATE TABLE social_post_analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_publish_job_id uuid NOT NULL REFERENCES social_publish_jobs(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'instagram', 'threads', 'x')),
  account_id uuid NOT NULL,
  remote_post_id text NOT NULL,
  views bigint NOT NULL CHECK (views >= 0),
  likes bigint NOT NULL CHECK (likes >= 0),
  comments bigint NOT NULL CHECK (comments >= 0),
  shares bigint NOT NULL CHECK (shares >= 0),
  clicks bigint NOT NULL CHECK (clicks >= 0),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX social_post_analytics_snapshots_job_captured_idx
  ON social_post_analytics_snapshots (social_publish_job_id, captured_at DESC);
CREATE INDEX social_post_analytics_snapshots_post_platform_captured_idx
  ON social_post_analytics_snapshots (post_id, platform, captured_at DESC);
CREATE INDEX social_publish_jobs_analytics_due_idx
  ON social_publish_jobs (analytics_lease_expires_at, analytics_last_collected_at)
  WHERE status = 'succeeded' AND remote_post_id IS NOT NULL;
