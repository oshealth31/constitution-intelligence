-- Tamper-evident audit log (Task D12). See docs/operations/audit-seal.md.
--
-- Every audit entry gets a running number. A daily job seals new entries into signed batches
-- (fingerprints only, no personal data) that are copied off-site; a daily check compares the
-- database with the sealed copy, so a changed, missing or added entry is detected.
--
-- GENERATED ALWAYS: the application cannot choose or change the number. Existing entries are
-- numbered now, in the order they happened.
ALTER TABLE audit_events ADD COLUMN seq bigint;
--> statement-breakpoint
-- Number existing rows in time order. The append-only trigger refuses UPDATE, so it is paused
-- for this one statement inside the migration (run by the owner of the table).
ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update_or_delete;
--> statement-breakpoint
UPDATE audit_events a SET seq = numbered.n
FROM (SELECT id, row_number() OVER (ORDER BY occurred_at, id) AS n FROM audit_events) numbered
WHERE a.id = numbered.id;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update_or_delete;
--> statement-breakpoint
ALTER TABLE audit_events ALTER COLUMN seq SET NOT NULL;
--> statement-breakpoint
ALTER TABLE audit_events ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('audit_events', 'seq'),
              coalesce((SELECT max(seq) FROM audit_events), 0) + 1, false);
--> statement-breakpoint
CREATE UNIQUE INDEX audit_events_seq_key ON audit_events (seq);
--> statement-breakpoint

-- Results of the sealing job and the daily check, shown on System health. Platform staff only:
-- not granted to app_tenant.
CREATE TABLE audit_seal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('seal', 'check')),
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX audit_seal_runs_latest ON audit_seal_runs (kind, ran_at DESC);
