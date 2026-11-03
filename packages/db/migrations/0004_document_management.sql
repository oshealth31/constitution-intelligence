-- Stage 7: constitution document management.
-- Uploaded documents, extraction results that need checking, and a controlled version workflow:
--   draft -> in_review -> approved -> published (the current version) -> superseded
-- with "archived" for versions that are withdrawn. The rules are enforced here as well as in
-- the API, so approved or published content cannot be overwritten by any code path.

-- ---------------------------------------------------------------------------------------------
-- Files: what each file is for
-- ---------------------------------------------------------------------------------------------
ALTER TABLE files
  ADD COLUMN purpose text NOT NULL DEFAULT 'other'
    CHECK (purpose IN ('constitution_source', 'branding_logo', 'other'));
--> statement-breakpoint
UPDATE files SET purpose = 'branding_logo' WHERE storage_key LIKE 'tenants/%/branding/%';
--> statement-breakpoint
UPDATE files f SET purpose = 'constitution_source'
  WHERE EXISTS (
    SELECT 1 FROM constitution_versions v
    WHERE v.source_file_id = f.id AND v.organisation_id = f.organisation_id
  );
--> statement-breakpoint

-- The original document is the authoritative source: it cannot be deleted while a version uses it.
CREATE FUNCTION files_keep_constitution_sources() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM constitution_versions v
    WHERE v.source_file_id = OLD.id AND v.organisation_id = OLD.organisation_id
  ) THEN
    RAISE EXCEPTION 'This file is the original document of a constitution version and cannot be deleted.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER files_keep_constitution_sources
  BEFORE DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION files_keep_constitution_sources();
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Versions: extraction results
-- ---------------------------------------------------------------------------------------------
ALTER TABLE constitution_versions
  ADD COLUMN extraction_status text NOT NULL DEFAULT 'not_started'
    CHECK (extraction_status IN ('not_started', 'succeeded', 'needs_review', 'failed')),
  ADD COLUMN extraction_issues jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(extraction_issues) = 'array'),
  ADD COLUMN extraction_meta jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(extraction_meta) = 'object');
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Sections: review flags and edit tracking
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sections
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN review_reason text CHECK (char_length(review_reason) <= 1000),
  ADD COLUMN source_page integer CHECK (source_page > 0),
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN edited_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Version history: content_approvals now records every workflow step, not only decisions.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE content_approvals DROP CONSTRAINT content_approvals_decision_check;
--> statement-breakpoint
ALTER TABLE content_approvals
  ADD CONSTRAINT content_approvals_decision_check CHECK (
    decision IN ('submitted', 'approved', 'changes_requested', 'published', 'superseded', 'archived')
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Workflow rules for versions
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION constitution_versions_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'A new constitution version must start as a draft, not %.', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft'      AND NEW.status IN ('in_review', 'archived'))
    OR (OLD.status = 'in_review'  AND NEW.status IN ('draft', 'approved', 'archived'))
    OR (OLD.status = 'approved'   AND NEW.status IN ('published', 'archived'))
    OR (OLD.status = 'published'  AND NEW.status = 'superseded')
    OR (OLD.status = 'superseded' AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'A constitution version cannot move from % to %.', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Once a version has left "draft", what it is and where it came from are fixed.
  IF OLD.status <> 'draft' AND (
       NEW.constitution_id IS DISTINCT FROM OLD.constitution_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
    OR NEW.extraction_status IS DISTINCT FROM OLD.extraction_status
    OR NEW.extraction_issues IS DISTINCT FROM OLD.extraction_issues
  ) THEN
    RAISE EXCEPTION 'This version is % and cannot be changed. Create a new version instead.', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER constitution_versions_guard
  BEFORE INSERT OR UPDATE ON constitution_versions
  FOR EACH ROW EXECUTE FUNCTION constitution_versions_guard();
--> statement-breakpoint

-- Sections can only be added, changed or removed while their version is a draft.
CREATE FUNCTION sections_draft_only() RETURNS trigger
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
CREATE TRIGGER sections_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON sections
  FOR EACH ROW EXECUTE FUNCTION sections_draft_only();
