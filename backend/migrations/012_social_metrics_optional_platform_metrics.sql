-- Preserve existing snapshots while allowing platforms to report only metrics
-- whose provider definitions are actually available.
ALTER TABLE social_metrics
  ALTER COLUMN views DROP NOT NULL,
  ALTER COLUMN likes DROP NOT NULL,
  ALTER COLUMN comments DROP NOT NULL,
  ALTER COLUMN shares DROP NOT NULL,
  ALTER COLUMN clicks DROP NOT NULL,
  ADD COLUMN impressions bigint CHECK (impressions >= 0),
  ADD COLUMN reach bigint CHECK (reach >= 0),
  ADD COLUMN reposts bigint CHECK (reposts >= 0),
  ADD COLUMN raw_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT social_metrics_raw_metrics_object_check CHECK (jsonb_typeof(raw_metrics) = 'object');
