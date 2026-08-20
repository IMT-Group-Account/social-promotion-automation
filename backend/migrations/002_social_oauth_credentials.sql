-- OAuth authorization-code state and encrypted, server-only social credentials.
-- Apply after 001_social_publishing_core.sql through the reviewed migration runner.

ALTER TABLE social_accounts RENAME COLUMN owner_id TO user_id;
ALTER TABLE social_accounts RENAME COLUMN external_account_id TO platform_account_id;
ALTER TABLE social_accounts DROP COLUMN credential_reference;
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_external_account_id_key;
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_status_check;
ALTER TABLE social_accounts
  ADD COLUMN account_name text,
  ADD COLUMN access_token_encrypted text,
  ADD COLUMN refresh_token_encrypted text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN scope text[] NOT NULL DEFAULT '{}',
  ADD COLUMN token_key_version text,
  ADD CONSTRAINT social_accounts_status_check CHECK (status IN ('active', 'expired', 'revoked', 'disabled')),
  ADD CONSTRAINT social_accounts_user_platform_account_key UNIQUE (user_id, platform, platform_account_id);

-- Existing pre-OAuth accounts have no encrypted credential. Keep them disabled
-- rather than treating them as publishable until they reconnect through OAuth.
UPDATE social_accounts
SET status = 'disabled'
WHERE status = 'active' AND access_token_encrypted IS NULL;

-- Tokens are versioned AES-256-GCM ciphertext strings, never plaintext values.
ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_active_requires_access_token CHECK (
    status <> 'active' OR access_token_encrypted IS NOT NULL
  );

CREATE TABLE oauth_authorization_states (
  state_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'x')),
  callback_route text NOT NULL CHECK (callback_route IN ('linkedin', 'meta', 'x')),
  code_verifier_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_authorization_states_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX oauth_authorization_states_expiry_idx
  ON oauth_authorization_states (expires_at)
  WHERE consumed_at IS NULL;
