-- Simple words: a plain-language version of a clause for people who find legal wording hard.
-- Written (or imported) by the organisation and approved by an owner or administrator before
-- members see it, always under the original wording, which is what counts.

CREATE TABLE simplified_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  section_id uuid NOT NULL,
  text text NOT NULL
    CHECK (char_length(text) BETWEEN 10 AND 3000 AND text !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  -- draft: members cannot see it; approved: shown in the reader; needs_review: copied from an
  -- earlier version whose wording was different (hidden until approved again).
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'needs_review')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai')),
  review_reason text CHECK (char_length(review_reason) <= 500),
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One simple-words version per clause (each version of the constitution has its own clauses).
  CONSTRAINT simplified_sections_one_per_section UNIQUE (section_id),
  CONSTRAINT simplified_sections_section_fk FOREIGN KEY (organisation_id, section_id)
    REFERENCES sections (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT simplified_sections_approval_recorded
    CHECK (status <> 'approved' OR approved_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX simplified_sections_organisation_idx ON simplified_sections (organisation_id, status);
--> statement-breakpoint
ALTER TABLE simplified_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON simplified_sections TO app_tenant
  USING (organisation_id = current_tenant_id())
  WITH CHECK (organisation_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON simplified_sections TO app_tenant;
