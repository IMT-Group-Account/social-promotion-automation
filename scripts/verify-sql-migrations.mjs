import { readFile } from 'node:fs/promises';

const publishingMigration = await readFile(new URL('../backend/migrations/001_social_publishing_core.sql', import.meta.url), 'utf8');
const oauthMigration = await readFile(new URL('../backend/migrations/002_social_oauth_credentials.sql', import.meta.url), 'utf8');
const facebookMigration = await readFile(new URL('../backend/migrations/003_facebook_page_selection.sql', import.meta.url), 'utf8');
const instagramMigration = await readFile(new URL('../backend/migrations/004_instagram_social_account.sql', import.meta.url), 'utf8');
const threadsMigration = await readFile(new URL('../backend/migrations/005_threads_oauth_state.sql', import.meta.url), 'utf8');
const xUsageMigration = await readFile(new URL('../backend/migrations/006_x_api_usage_ledger.sql', import.meta.url), 'utf8');
const kakaoChannelMigration = await readFile(new URL('../backend/migrations/007_kakao_channel_inbound_consultations.sql', import.meta.url), 'utf8');
const analyticsMigration = await readFile(new URL('../backend/migrations/008_social_post_analytics.sql', import.meta.url), 'utf8');
const queueOutboxMigration = await readFile(new URL('../backend/migrations/009_bullmq_publish_outbox.sql', import.meta.url), 'utf8');
const retryMigration = await readFile(new URL('../backend/migrations/010_publish_retry_state_and_failure_alerts.sql', import.meta.url), 'utf8');
const canonicalModelMigration = await readFile(new URL('../backend/migrations/011_postgresql_canonical_social_model.sql', import.meta.url), 'utf8');
for (const requiredText of [
  'CREATE TABLE posts',
  'CREATE TABLE social_publish_jobs',
  'UNIQUE (post_id, platform, account_id)',
  "status IN ('pending', 'leased', 'publishing', 'succeeded', 'failed', 'cancelled')",
]) {
  if (!publishingMigration.includes(requiredText)) {
    throw new Error(`Migration is missing required publishing invariant: ${requiredText}`);
  }
}
for (const requiredText of [
  'access_token_encrypted',
  'refresh_token_encrypted',
  'CREATE TABLE oauth_authorization_states',
  'code_verifier_encrypted',
  'consumed_at IS NULL',
]) {
  if (!oauthMigration.includes(requiredText)) {
    throw new Error(`Migration is missing required OAuth invariant: ${requiredText}`);
  }
}
for (const requiredText of ['CREATE TABLE facebook_page_selections', 'CREATE TABLE facebook_page_selection_items', 'page_access_token_encrypted', 'consumed_at IS NULL']) {
  if (!facebookMigration.includes(requiredText)) throw new Error(`Migration is missing required Facebook Page-selection invariant: ${requiredText}`);
}
if (!instagramMigration.includes("'instagram'")) throw new Error('Migration is missing Instagram social-account support.');
for (const requiredText of ["'threads'", 'oauth_authorization_states_platform_check', 'oauth_authorization_states_callback_route_check']) {
  if (!threadsMigration.includes(requiredText)) throw new Error(`Migration is missing Threads OAuth invariant: ${requiredText}`);
}
for (const requiredText of ['CREATE TABLE x_api_usage_ledger', 'estimated_cost_microusd bigint', "outcome IN ('reserved', 'succeeded', 'failed')"]) {
  if (!xUsageMigration.includes(requiredText)) throw new Error(`Migration is missing X API usage invariant: ${requiredText}`);
}
for (const requiredText of ['CREATE TABLE kakao_channels', 'CREATE TABLE kakao_channel_inbound_events', 'CREATE TABLE kakao_channel_consultations', "source IN ('linkedin', 'facebook', 'instagram', 'threads', 'x', 'direct')"]) {
  if (!kakaoChannelMigration.includes(requiredText)) throw new Error(`Migration is missing Kakao Channel funnel invariant: ${requiredText}`);
}
for (const requiredText of ['CREATE TABLE social_post_analytics_snapshots', 'analytics_lease_expires_at', 'views bigint', 'clicks bigint']) {
  if (!analyticsMigration.includes(requiredText)) throw new Error(`Migration is missing analytics snapshot invariant: ${requiredText}`);
}
for (const requiredText of ['CREATE TABLE social_publish_queue_outbox', 'create_social_publish_queue_outbox', 'social_publish_jobs_enqueue_outbox_trigger', "'publish-' || NEW.id::text"]) {
  if (!queueOutboxMigration.includes(requiredText)) throw new Error(`Migration is missing BullMQ outbox invariant: ${requiredText}`);
}
for (const requiredText of ["'waiting', 'processing', 'published', 'failed', 'retrying', 'cancelled'", 'next_retry_at timestamptz', 'CREATE TABLE social_publish_failure_alerts', "social_publish_job_id uuid NOT NULL UNIQUE"]) {
  if (!retryMigration.includes(requiredText)) throw new Error(`Migration is missing publishing retry invariant: ${requiredText}`);
}
for (const requiredText of ['CREATE TABLE users', 'CREATE TABLE social_posts', 'CREATE TABLE social_metrics', 'RENAME TO oauth_states', 'CREATE TABLE audit_logs', 'social_publish_job_id uuid NOT NULL UNIQUE']) {
  if (!canonicalModelMigration.includes(requiredText)) throw new Error(`Migration is missing canonical PostgreSQL model invariant: ${requiredText}`);
}
console.log('SQL publishing and OAuth migration structure verified.');
