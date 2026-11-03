-- Stage 9: AI question answering.
-- Answers keep their outcome and the exact quotes they cite; members can rate answers.
-- No prompts, provider responses or source passages are stored here.

ALTER TABLE ai_messages
  ADD COLUMN status text CHECK (status IN ('answered', 'insufficient', 'unavailable'));
--> statement-breakpoint

-- The exact words quoted from the cited section (always a verbatim part of its stored text).
ALTER TABLE ai_citations
  ADD COLUMN quote text CHECK (char_length(quote) <= 2000),
  ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK (position >= 0);
--> statement-breakpoint

CREATE TABLE ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  helpful boolean NOT NULL,
  comment text CHECK (char_length(comment) <= 1000 AND comment !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_feedback_one_per_person UNIQUE (message_id, user_id),
  CONSTRAINT ai_feedback_message_fk FOREIGN KEY (organisation_id, message_id)
    REFERENCES ai_messages (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_feedback TO app_tenant
  USING (organisation_id = current_tenant_id())
  WITH CHECK (organisation_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_feedback TO app_tenant;
