-- Process readiness evidence. One row per singleton runtime role.
CREATE TABLE runtime_heartbeats (
  process_name text PRIMARY KEY CHECK (process_name IN ('worker','scheduler')),
  release_id text,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
