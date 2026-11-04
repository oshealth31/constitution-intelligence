-- Deleting an organisation's data (Task D3). See docs/operations/offboarding-and-retention.md.
--
-- The organisation's row is KEPT as a marker ("deleted", status archived, a freed web address),
-- because invoices, payments, receipts and the subscription history are kept as financial
-- records and point at it. Everything else of the organisation is deleted by the application's
-- deletion procedure, in one transaction, after an approved request.

ALTER TABLE organisations ADD COLUMN deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE organisations ADD CONSTRAINT organisations_deleted_is_archived
  CHECK (deleted_at IS NULL OR status = 'archived');
--> statement-breakpoint

-- A request to delete one organisation's data, and its approval. Platform staff only: not
-- granted to app_tenant. Rules (enforced by the API): with two or more active Super Admins,
-- a DIFFERENT Super Admin approves; with only one, the same person may confirm after 24 hours.
-- Requests expire after 7 days.
CREATE TABLE organisation_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'completed')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  export_confirmed boolean NOT NULL CHECK (export_confirmed),
  requested_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  -- 'second_person' or 'waiting_period' (only one Super Admin) or 'command_line'.
  approval_mode text CHECK (approval_mode IN ('second_person', 'waiting_period', 'command_line')),
  completed_at timestamptz,
  cancelled_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  -- How many records of each kind were deleted (no names or contents).
  deleted_counts jsonb,
  -- Set once the organisation's files folder has been removed from storage.
  files_removed_at timestamptz,
  CONSTRAINT organisation_deletion_completed_recorded
    CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND approval_mode IS NOT NULL)),
  CONSTRAINT organisation_deletion_cancelled_recorded
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
--> statement-breakpoint
-- At most one open request per organisation.
CREATE UNIQUE INDEX organisation_deletion_one_pending
  ON organisation_deletion_requests (organisation_id) WHERE status = 'pending';
--> statement-breakpoint

-- The audit log stays append-only, with two narrow exceptions used only by the deletion
-- procedure, inside its transaction:
--   1. the events of an organisation that has ALREADY been marked deleted, when
--      app.deleting_organisation_id names it;
--   2. platform-level events (no organisation) about a person whose account has ALREADY been
--      deleted, when app.deleting_user_id (and app.deleting_user_email) name them.
-- UPDATE and TRUNCATE are always refused. The deletion itself is then recorded as a new event.
CREATE OR REPLACE FUNCTION prevent_audit_event_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  deleting_organisation text := coalesce(current_setting('app.deleting_organisation_id', true), '');
  deleting_user text := coalesce(current_setting('app.deleting_user_id', true), '');
  deleting_email text := coalesce(current_setting('app.deleting_user_email', true), '');
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
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$;
