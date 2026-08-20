-- Facebook Login returns a user token first. Page access tokens are stored only
-- after the authenticated user selects one of the managed Pages.

CREATE TABLE facebook_page_selections (
  selection_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL,
  scope text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facebook_page_selections_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE facebook_page_selection_items (
  selection_hash char(64) NOT NULL REFERENCES facebook_page_selections(selection_hash) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text NOT NULL,
  page_access_token_encrypted text NOT NULL,
  PRIMARY KEY (selection_hash, page_id)
);

CREATE INDEX facebook_page_selections_expiry_idx
  ON facebook_page_selections (expires_at)
  WHERE consumed_at IS NULL;
