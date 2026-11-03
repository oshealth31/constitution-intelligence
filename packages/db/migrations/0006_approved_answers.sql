-- Approved answers: questions and plain answers written (or imported) by an organisation,
-- linked to the clauses they rely on, and shown to members only once an owner or administrator
-- has approved them. Drafts are never shown to members.

CREATE TABLE approved_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  question text NOT NULL
    CHECK (char_length(question) BETWEEN 3 AND 300 AND question !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  answer text NOT NULL
    CHECK (char_length(answer) BETWEEN 10 AND 4000 AND answer !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  -- draft: being written; approved: shown to members; needs_review: the constitution changed
  -- underneath it (hidden until approved again); retired: no longer shown.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'needs_review', 'retired')),
  -- Where the draft came from: typed in by a person, imported from a file, or drafted by AI.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai')),
  review_reason text CHECK (char_length(review_reason) <= 500),
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', question), 'A') || setweight(to_tsvector('simple', answer), 'B')
  ) STORED,
  CONSTRAINT approved_answers_organisation_id_id_key UNIQUE (organisation_id, id),
  -- An approved answer always records who approved it and when.
  CONSTRAINT approved_answers_approval_recorded
    CHECK (status <> 'approved' OR (approved_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX approved_answers_organisation_idx ON approved_answers (organisation_id, status);
--> statement-breakpoint
CREATE INDEX approved_answers_search_idx ON approved_answers USING gin (search_vector);
--> statement-breakpoint

-- The clauses an answer relies on (in order).
CREATE TABLE approved_answer_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  answer_id uuid NOT NULL,
  section_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  CONSTRAINT approved_answer_sections_unique UNIQUE (answer_id, section_id),
  CONSTRAINT approved_answer_sections_answer_fk FOREIGN KEY (organisation_id, answer_id)
    REFERENCES approved_answers (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT approved_answer_sections_section_fk FOREIGN KEY (organisation_id, section_id)
    REFERENCES sections (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX approved_answer_sections_section_idx ON approved_answer_sections (section_id);
--> statement-breakpoint

DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['approved_answers', 'approved_answer_sections']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO app_tenant '
      'USING (organisation_id = current_tenant_id()) '
      'WITH CHECK (organisation_id = current_tenant_id())',
      tenant_table
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', tenant_table);
  END LOOP;
END
$$;
