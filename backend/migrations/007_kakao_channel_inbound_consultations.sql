-- Kakao Channel is a customer-inbound and consultation funnel, not a social
-- publishing target. Do not store customer messages or Kakao account IDs here.

CREATE TABLE kakao_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  public_id text NOT NULL CHECK (public_id ~ '^[_A-Za-z0-9-]{1,100}$'),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  consultation_url text NOT NULL CHECK (consultation_url LIKE 'https://pf.kakao.com/%'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, public_id)
);

CREATE TABLE kakao_channel_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES kakao_channels(id) ON DELETE RESTRICT,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('linkedin', 'facebook', 'instagram', 'threads', 'x', 'direct')),
  tracking_code uuid NOT NULL UNIQUE,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kakao_channel_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES kakao_channels(id) ON DELETE RESTRICT,
  inbound_event_id uuid REFERENCES kakao_channel_inbound_events(id) ON DELETE SET NULL,
  external_conversation_ref text NOT NULL CHECK (char_length(trim(external_conversation_ref)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('started', 'assigned', 'resolved', 'closed')),
  started_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, external_conversation_ref)
);

CREATE INDEX kakao_channel_inbound_events_channel_created_idx ON kakao_channel_inbound_events (channel_id, created_at DESC);
CREATE INDEX kakao_channel_consultations_channel_status_idx ON kakao_channel_consultations (channel_id, status, created_at DESC);
