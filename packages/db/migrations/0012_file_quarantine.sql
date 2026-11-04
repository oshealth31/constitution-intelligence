-- Quarantining an uploaded file (staff tool, after a suspected virus or other unsafe content).
-- A quarantined file cannot be downloaded or shown by any part of the application; staff can
-- release it again, or remove its stored content for good. The record stays, because
-- constitution versions point at their original document.

ALTER TABLE files
  ADD COLUMN quarantined_at timestamptz,
  ADD COLUMN quarantine_reason text CHECK (char_length(quarantine_reason) <= 500),
  ADD COLUMN quarantined_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN content_removed_at timestamptz,
  ADD CONSTRAINT files_removed_only_when_quarantined
    CHECK (content_removed_at IS NULL OR quarantined_at IS NOT NULL),
  ADD CONSTRAINT files_quarantine_reason_recorded
    CHECK (quarantined_at IS NULL OR quarantine_reason IS NOT NULL);
--> statement-breakpoint

-- Organisation work (the tenant role) can never set, change or clear a quarantine: only the
-- platform staff path, which does not run as app_tenant.
CREATE FUNCTION files_quarantine_staff_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_tenant' AND (
    NEW.quarantined_at IS DISTINCT FROM OLD.quarantined_at
    OR NEW.quarantine_reason IS DISTINCT FROM OLD.quarantine_reason
    OR NEW.quarantined_by_user_id IS DISTINCT FROM OLD.quarantined_by_user_id
    OR NEW.content_removed_at IS DISTINCT FROM OLD.content_removed_at
  ) THEN
    RAISE EXCEPTION 'Only Constitution Intelligence staff can change a file''s quarantine.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER files_quarantine_staff_only
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION files_quarantine_staff_only();
--> statement-breakpoint
CREATE FUNCTION files_quarantine_on_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quarantined_at IS NOT NULL OR NEW.content_removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new file cannot start in quarantine.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER files_quarantine_on_insert
  BEFORE INSERT ON files
  FOR EACH ROW EXECUTE FUNCTION files_quarantine_on_insert();
