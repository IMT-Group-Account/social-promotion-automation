-- Canonical PostgreSQL model for the application. This migration preserves the
-- previous schema data while introducing the requested physical table names.

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format_check CHECK (email IS NULL OR position('@' IN email) > 1)
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email)) WHERE email IS NOT NULL;

-- Backfill opaque legacy user IDs before adding validated ownership FKs. Email
-- and display name intentionally remain null until the application identity
-- provider supplies them.
INSERT INTO users (id)
SELECT user_id FROM social_accounts
UNION SELECT owner_id FROM campaigns
UNION SELECT owner_id FROM posts
UNION SELECT user_id FROM oauth_authorization_states
UNION SELECT user_id FROM facebook_page_selections
ON CONFLICT (id) DO NOTHING;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_owner_user_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE posts
  ADD CONSTRAINT posts_owner_user_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE oauth_authorization_states
  ADD CONSTRAINT oauth_authorization_states_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE facebook_page_selections
  ADD CONSTRAINT facebook_page_selections_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE oauth_authorization_states RENAME TO oauth_states;
ALTER TABLE oauth_states RENAME CONSTRAINT oauth_authorization_states_expiry_check TO oauth_states_expiry_check;
ALTER TABLE oauth_states RENAME CONSTRAINT oauth_authorization_states_platform_check TO oauth_states_platform_check;
ALTER TABLE oauth_states RENAME CONSTRAINT oauth_authorization_states_callback_route_check TO oauth_states_callback_route_check;
ALTER TABLE oauth_states RENAME CONSTRAINT oauth_authorization_states_user_fk TO oauth_states_user_fk;
ALTER INDEX oauth_authorization_states_expiry_idx RENAME TO oauth_states_expiry_idx;

ALTER TABLE social_publish_jobs
  ADD CONSTRAINT social_publish_jobs_id_platform_account_unique UNIQUE (id, platform, account_id);

CREATE TABLE social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_publish_job_id uuid NOT NULL UNIQUE REFERENCES social_publish_jobs(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'instagram', 'threads', 'x')),
  remote_post_id text NOT NULL,
  remote_post_url text,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_posts_job_platform_account_fk
    FOREIGN KEY (social_publish_job_id, platform, social_account_id)
    REFERENCES social_publish_jobs(id, platform, account_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX social_posts_platform_remote_post_unique_idx ON social_posts (platform, remote_post_id);
CREATE INDEX social_posts_post_platform_idx ON social_posts (post_id, platform, published_at DESC);

INSERT INTO social_posts (social_publish_job_id, post_id, social_account_id, platform, remote_post_id, remote_post_url, published_at)
SELECT id, post_id, account_id, platform, remote_post_id, remote_post_url, published_at
FROM social_publish_jobs
WHERE status = 'published' AND remote_post_id IS NOT NULL AND published_at IS NOT NULL
ON CONFLICT (social_publish_job_id) DO NOTHING;

CREATE TABLE social_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  views bigint NOT NULL CHECK (views >= 0),
  likes bigint NOT NULL CHECK (likes >= 0),
  comments bigint NOT NULL CHECK (comments >= 0),
  shares bigint NOT NULL CHECK (shares >= 0),
  clicks bigint NOT NULL CHECK (clicks >= 0),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX social_metrics_post_captured_idx ON social_metrics (social_post_id, captured_at DESC);

INSERT INTO social_metrics (social_post_id, views, likes, comments, shares, clicks, captured_at, created_at)
SELECT social_post.id, snapshot.views, snapshot.likes, snapshot.comments, snapshot.shares, snapshot.clicks, snapshot.captured_at, snapshot.created_at
FROM social_post_analytics_snapshots AS snapshot
JOIN social_posts AS social_post ON social_post.social_publish_job_id = snapshot.social_publish_job_id;

-- The copy above runs before this drop in the same reviewed migration. Runtime
-- analytics queries use social_metrics after migration 011.
DROP TABLE social_post_analytics_snapshots;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(trim(action)) BETWEEN 1 AND 100),
  entity_type text NOT NULL CHECK (char_length(trim(entity_type)) BETWEEN 1 AND 80),
  entity_id uuid,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_logs_user_created_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_entity_created_idx ON audit_logs (entity_type, entity_id, created_at DESC);

-- Never add OAuth access/refresh tokens, raw authorization codes, or social
-- provider response bodies to audit_logs.metadata.
