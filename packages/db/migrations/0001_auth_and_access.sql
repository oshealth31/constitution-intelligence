-- Stage 3: authentication and access control.
-- Organisations, users, memberships (roles), invitations, sessions, password resets,
-- brute-force rate limiting, and an append-only audit log.
-- Row-Level Security policies for tenant tables are added in the tenant-isolation stage.

CREATE TABLE organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisations_slug_key UNIQUE (slug)
);
--> statement-breakpoint

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lower-case so "Ann@x.org" and "ann@x.org" are the same account.
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  -- Argon2id hash. NULL means no password has been set yet (e.g. a new super admin).
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  is_platform_super_admin boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email)
);
--> statement-breakpoint

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'content_reviewer', 'member', 'auditor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_organisation_user_key UNIQUE (organisation_id, user_id)
);
--> statement-breakpoint
CREATE INDEX memberships_user_idx ON memberships (user_id);
--> statement-breakpoint

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'content_reviewer', 'member', 'auditor')),
  -- SHA-256 of the one-time token. The token itself is only ever in the invitation email.
  token_hash text NOT NULL,
  invited_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_token_hash_key UNIQUE (token_hash)
);
--> statement-breakpoint
CREATE INDEX invitations_organisation_idx ON invitations (organisation_id, created_at DESC);
--> statement-breakpoint

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the session cookie value. The cookie value itself is never stored.
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  ip_address text,
  user_agent text,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)
);
--> statement-breakpoint
CREATE INDEX sessions_user_idx ON sessions (user_id);
--> statement-breakpoint

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash)
);
--> statement-breakpoint
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
--> statement-breakpoint

-- Fixed-window counters for brute-force protection (shared by all API instances).
CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
--> statement-breakpoint

-- Append-only audit trail. No foreign keys, so audit history survives deletions.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  organisation_id uuid,
  actor_user_id uuid,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  target_type text,
  target_id text,
  ip_address text,
  user_agent text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX audit_events_organisation_idx ON audit_events (organisation_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, occurred_at DESC);
--> statement-breakpoint

CREATE FUNCTION prevent_audit_event_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_changes();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_event_changes();
