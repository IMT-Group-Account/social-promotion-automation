-- Instagram publishing uses a professional Instagram account ID and the
-- server-only Page-derived access token. It is a separate adapter/account.

ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_platform_check CHECK (platform IN ('linkedin', 'instagram', 'facebook', 'threads', 'x'));
