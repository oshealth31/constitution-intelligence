-- One person's request about their own personal data (Task D11): a copy, a correction or a
-- deletion. See docs/operations/data-requests.md. Platform staff only: not granted to
-- app_tenant. The rules (Super Admin only, a reason, typing the person's email to delete,
-- refusals for Super Admins and the last Owner) are enforced by the API.
CREATE TABLE data_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('copy', 'correction', 'deletion')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  -- The person's email as given. Replaced by '[removed]' once their account is deleted;
  -- the SHA-256 of the lower-cased address stays, so a repeated request can be recognised.
  subject_email text NOT NULL CHECK (char_length(subject_email) <= 320),
  subject_email_sha256 text NOT NULL CHECK (subject_email_sha256 ~ '^[0-9a-f]{64}$'),
  subject_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  received_on date NOT NULL,
  respond_by date NOT NULL,
  received_via text NOT NULL CHECK (char_length(received_via) BETWEEN 3 AND 200),
  identity_check text NOT NULL CHECK (char_length(identity_check) BETWEEN 10 AND 500),
  details text CHECK (char_length(details) <= 2000),
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  -- What was done (counts, or the fields corrected), never the person's data itself.
  outcome jsonb,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  cancel_reason text CHECK (char_length(cancel_reason) <= 500),
  CONSTRAINT data_requests_respond_after_received CHECK (respond_by >= received_on),
  CONSTRAINT data_requests_completed_recorded
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT data_requests_cancelled_recorded
    CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX data_requests_open ON data_requests (respond_by) WHERE status = 'open';
--> statement-breakpoint

-- Deleting a person sets "edited by" / "reviewed by" on their sections to NULL. Sections of a
-- version that has left draft cannot change, except for exactly that: removing a name.
CREATE OR REPLACE FUNCTION sections_draft_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  version_status text;
  row_organisation uuid;
  row_version uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_organisation := OLD.organisation_id;
    row_version := OLD.version_id;
  ELSE
    row_organisation := NEW.organisation_id;
    row_version := NEW.version_id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'A section cannot be moved to another version.' USING ERRCODE = 'check_violation';
  END IF;
  -- Only a person's name being removed (their account was deleted): always allowed.
  -- (search_vector is a generated column: not yet computed in NEW inside this trigger.)
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'edited_by_user_id' - 'reviewed_by_user_id' - 'search_vector')
         = (to_jsonb(OLD) - 'edited_by_user_id' - 'reviewed_by_user_id' - 'search_vector')
     AND (NEW.edited_by_user_id IS NULL OR NEW.edited_by_user_id = OLD.edited_by_user_id)
     AND (NEW.reviewed_by_user_id IS NULL OR NEW.reviewed_by_user_id = OLD.reviewed_by_user_id) THEN
    RETURN NEW;
  END IF;
  -- Looked up within the same organisation; a link to another organisation's version is left
  -- for the foreign key to refuse. A missing version means it is being deleted (cascade).
  SELECT status INTO version_status FROM constitution_versions
    WHERE id = row_version AND organisation_id = row_organisation;
  IF version_status IS NOT NULL AND version_status <> 'draft' THEN
    RAISE EXCEPTION 'Sections cannot be changed because this version is %. Create a new version instead.', version_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- The audit log stays append-only. Exceptions (inside the application's procedures only):
--   1. and 2. as in 0010 (deleting a deleted organisation's events, and the platform-level
--      events of a deleted account during an organisation deletion);
--   3. (Task D11, decision A1) ANONYMISING the events about a person whose account has ALREADY
--      been deleted, when app.anonymising_user_id (and app.anonymising_user_email) name them:
--      only the IP address and device are cleared, a target equal to their id or email becomes
--      '[removed]', and their details are removed from the metadata. What happened, when, and
--      in which organisation stay. Nothing else can change.
CREATE OR REPLACE FUNCTION prevent_audit_event_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  deleting_organisation text := coalesce(current_setting('app.deleting_organisation_id', true), '');
  deleting_user text := coalesce(current_setting('app.deleting_user_id', true), '');
  deleting_email text := coalesce(current_setting('app.deleting_user_email', true), '');
  anonymising_user text := coalesce(current_setting('app.anonymising_user_id', true), '');
  anonymising_email text := coalesce(current_setting('app.anonymising_user_email', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF deleting_organisation <> ''
       AND OLD.organisation_id IS NOT NULL
       AND OLD.organisation_id::text = deleting_organisation
       AND EXISTS (
         SELECT 1 FROM organisations o
         WHERE o.id = OLD.organisation_id AND o.deleted_at IS NOT NULL
       ) THEN
      RETURN OLD;
    END IF;
    IF deleting_user <> ''
       AND OLD.organisation_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id::text = deleting_user)
       AND (OLD.actor_user_id::text = deleting_user
            OR OLD.target_id = deleting_user
            OR (deleting_email <> '' AND OLD.target_id = deleting_email)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE'
     AND anonymising_user <> ''
     AND anonymising_email <> ''
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id::text = anonymising_user)
     AND (OLD.actor_user_id::text = anonymising_user
          OR OLD.target_id = anonymising_user
          OR lower(OLD.target_id) = lower(anonymising_email)
          OR position(lower(anonymising_email) IN lower(OLD.metadata::text)) > 0)
     AND NEW.id = OLD.id
     AND NEW.occurred_at = OLD.occurred_at
     AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id
     AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
     AND NEW.action = OLD.action
     AND NEW.outcome = OLD.outcome
     AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
     AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
     AND (NEW.target_id IS NOT DISTINCT FROM OLD.target_id OR NEW.target_id = '[removed]')
     AND (NEW.ip_address IS NULL OR (NEW.ip_address = OLD.ip_address
          AND OLD.actor_user_id::text IS DISTINCT FROM anonymising_user))
     AND (NEW.user_agent IS NULL OR (NEW.user_agent = OLD.user_agent
          AND OLD.actor_user_id::text IS DISTINCT FROM anonymising_user))
     AND position(lower(anonymising_email) IN lower(NEW.metadata::text)) = 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint

-- The runtime account may update only these four columns, and the trigger above decides when.
-- Changing what happened (action, outcome, time, actor) stays impossible.
GRANT UPDATE (ip_address, user_agent, target_id, metadata) ON audit_events TO app_runtime;
