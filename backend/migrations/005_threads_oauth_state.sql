-- Threads uses a distinct Authorization Code + PKCE callback and stores its
-- encrypted user access token in social_accounts with platform = 'threads'.
-- social_accounts already accepts 'threads' from 004_instagram_social_account.sql.

ALTER TABLE oauth_authorization_states DROP CONSTRAINT IF EXISTS oauth_authorization_states_platform_check;
ALTER TABLE oauth_authorization_states
  ADD CONSTRAINT oauth_authorization_states_platform_check CHECK (platform IN ('linkedin', 'facebook', 'threads', 'x'));

ALTER TABLE oauth_authorization_states DROP CONSTRAINT IF EXISTS oauth_authorization_states_callback_route_check;
ALTER TABLE oauth_authorization_states
  ADD CONSTRAINT oauth_authorization_states_callback_route_check CHECK (callback_route IN ('linkedin', 'meta', 'threads', 'x'));
