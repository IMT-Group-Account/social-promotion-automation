-- Durable, lease-based delivery for terminal publication failure alerts.
ALTER TABLE social_publish_failure_alerts DROP CONSTRAINT social_publish_failure_alerts_status_check;
ALTER TABLE social_publish_failure_alerts
  ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  ADD COLUMN next_delivery_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_delivery_error text,
  ADD CONSTRAINT social_publish_failure_alerts_status_check
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed'));

DROP INDEX social_publish_failure_alerts_pending_idx;
CREATE INDEX social_publish_failure_alerts_delivery_idx
  ON social_publish_failure_alerts (next_delivery_at, created_at, id)
  WHERE status IN ('pending', 'failed', 'processing');
