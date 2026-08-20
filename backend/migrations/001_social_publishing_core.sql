-- Social promotion automation core schema.
-- Apply through the project's reviewed PostgreSQL migration runner; do not execute ad hoc in production.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'instagram', 'facebook', 'threads', 'x')),
  external_account_id text NOT NULL,
  display_name text,
  credential_reference text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_account_id),
  UNIQUE (id, platform)
);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 300),
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 10000),
  destination_url text,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'publishing', 'completed', 'partially_failed', 'failed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, sort_order)
);

CREATE TABLE social_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'instagram', 'facebook', 'threads', 'x')),
  account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'publishing', 'succeeded', 'failed', 'cancelled')),
  scheduled_at timestamptz NOT NULL,
  published_at timestamptz,
  remote_post_id text,
  remote_post_url text,
  error_code text,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 10),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_publish_jobs_platform_account_matches CHECK (platform <> ''),
  CONSTRAINT social_publish_jobs_success_has_remote_reference CHECK (
    status <> 'succeeded' OR (published_at IS NOT NULL AND remote_post_id IS NOT NULL)
  ),
  CONSTRAINT social_publish_jobs_failure_has_error CHECK (
    status <> 'failed' OR error_code IS NOT NULL
  ),
  CONSTRAINT social_publish_jobs_account_platform_matches
    FOREIGN KEY (account_id, platform) REFERENCES social_accounts(id, platform) ON DELETE RESTRICT,
  CONSTRAINT social_publish_jobs_one_target_per_account UNIQUE (post_id, platform, account_id)
);

CREATE INDEX social_publish_jobs_due_idx
  ON social_publish_jobs (scheduled_at, id)
  WHERE status = 'pending';

CREATE INDEX social_publish_jobs_post_idx ON social_publish_jobs (post_id, created_at);
CREATE INDEX posts_campaign_scheduled_idx ON posts (campaign_id, scheduled_at DESC);

-- A post's displayed aggregate status must be calculated from its jobs or updated
-- transactionally by the application. Never bulk-update sibling jobs after one adapter fails.
