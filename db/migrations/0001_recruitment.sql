-- The same migration is embedded in lib/migrations.ts for standalone deployments.
CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY, slug text NOT NULL UNIQUE, status text NOT NULL CHECK (status IN ('published','draft','closed')), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS applications (id text PRIMARY KEY, job_id text NOT NULL REFERENCES jobs(id), idempotency_key text NOT NULL UNIQUE, request_hash text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS applications_job_idx ON applications(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS applications_reference_unique ON applications ((data->>'reference'));
CREATE TABLE IF NOT EXISTS administrators (id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS admin_sessions (id text PRIMARY KEY, admin_id text NOT NULL REFERENCES administrators(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id text PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL, target_id text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS google_sheets_deliveries (application_id text PRIMARY KEY REFERENCES applications(id), state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','synced')), attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token text, last_error text, synced_at timestamptz, sheet_row integer, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS google_sheets_due_idx ON google_sheets_deliveries(state, next_attempt_at);
