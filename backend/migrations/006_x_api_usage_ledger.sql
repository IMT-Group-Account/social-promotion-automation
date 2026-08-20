-- Estimated X API pay-per-use activity. Amounts are integer micro-USD, never
-- floating point. A reservation precedes the external call for auditability.

CREATE TABLE x_api_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id uuid NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('post_create', 'post_create_with_url', 'media_upload', 'post_read', 'post_delete')),
  estimated_cost_microusd bigint NOT NULL CHECK (estimated_cost_microusd >= 0),
  pricing_version text NOT NULL CHECK (char_length(trim(pricing_version)) BETWEEN 1 AND 100),
  outcome text NOT NULL CHECK (outcome IN ('reserved', 'succeeded', 'failed')),
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX x_api_usage_ledger_account_created_idx ON x_api_usage_ledger (social_account_id, created_at DESC);
CREATE INDEX x_api_usage_ledger_outcome_created_idx ON x_api_usage_ledger (outcome, created_at);
