-- Stage 4: multi-tenant foundation.
--
-- 1. Every organisation-specific table has a NOT NULL organisation_id.
-- 2. References between tenant tables use COMPOSITE foreign keys (organisation_id, id), so a row
--    can never point at a row that belongs to a different organisation.
-- 3. Row-Level Security (RLS): the API runs tenant work as the restricted role "app_tenant" with
--    the current organisation set for the transaction; PostgreSQL then filters every row.
-- See docs/security/tenant-isolation.md.

-- ---------------------------------------------------------------------------------------------
-- Billing: subscriptions (organisation model gets a reference to its current subscription)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  plan_code text NOT NULL CHECK (plan_code ~ '^[a-z0-9_-]{2,40}$'),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT subscriptions_period_order CHECK (
    current_period_end IS NULL OR current_period_end > current_period_start
  )
);
--> statement-breakpoint
CREATE INDEX subscriptions_organisation_idx ON subscriptions (organisation_id);
--> statement-breakpoint

ALTER TABLE organisations ADD COLUMN current_subscription_id uuid;
--> statement-breakpoint
-- The current subscription must belong to the same organisation.
ALTER TABLE organisations
  ADD CONSTRAINT organisations_current_subscription_fk
  FOREIGN KEY (id, current_subscription_id)
  REFERENCES subscriptions (organisation_id, id)
  ON DELETE SET NULL (current_subscription_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Uploaded files (metadata). The object itself lives in storage under tenants/<organisation_id>/.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 120),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT files_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT files_storage_key_key UNIQUE (storage_key),
  -- A file record can only point at its own organisation's storage folder.
  CONSTRAINT files_storage_key_in_tenant_folder CHECK (
    storage_key LIKE 'tenants/' || organisation_id::text || '/%' AND storage_key !~ '\.\.'
  )
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Branding configuration (one row per organisation)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE organisation_branding (
  organisation_id uuid PRIMARY KEY REFERENCES organisations (id) ON DELETE CASCADE,
  display_name text CHECK (char_length(display_name) BETWEEN 1 AND 200),
  tagline text CHECK (char_length(tagline) <= 300),
  primary_colour text NOT NULL DEFAULT '#0B1F3A' CHECK (primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  accent_colour text NOT NULL DEFAULT '#1BA6A6' CHECK (accent_colour ~ '^#[0-9A-Fa-f]{6}$'),
  logo_file_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisation_branding_logo_fk FOREIGN KEY (organisation_id, logo_file_id)
    REFERENCES files (organisation_id, id) ON DELETE SET NULL (logo_file_id)
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Constitutions, versions, extracted text, sections and clauses
-- ---------------------------------------------------------------------------------------------
CREATE TABLE constitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT constitutions_organisation_id_id_key UNIQUE (organisation_id, id)
);
--> statement-breakpoint

CREATE TABLE constitution_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  constitution_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'superseded', 'archived')),
  source_file_id uuid,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT constitution_versions_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT constitution_versions_number_key UNIQUE (constitution_id, version_number),
  CONSTRAINT constitution_versions_constitution_fk FOREIGN KEY (organisation_id, constitution_id)
    REFERENCES constitutions (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT constitution_versions_source_file_fk FOREIGN KEY (organisation_id, source_file_id)
    REFERENCES files (organisation_id, id) ON DELETE SET NULL (source_file_id)
);
--> statement-breakpoint
-- At most one published version per constitution.
CREATE UNIQUE INDEX constitution_versions_one_published
  ON constitution_versions (constitution_id) WHERE status = 'published';
--> statement-breakpoint

CREATE TABLE extracted_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  file_id uuid,
  content text NOT NULL,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extracted_texts_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT extracted_texts_version_fk FOREIGN KEY (organisation_id, version_id)
    REFERENCES constitution_versions (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT extracted_texts_file_fk FOREIGN KEY (organisation_id, file_id)
    REFERENCES files (organisation_id, id) ON DELETE SET NULL (file_id)
);
--> statement-breakpoint

CREATE TABLE sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  parent_section_id uuid,
  kind text NOT NULL CHECK (kind IN ('part', 'chapter', 'section', 'clause', 'subclause')),
  ref_key text NOT NULL CHECK (ref_key ~ '^[A-Za-z0-9._-]{1,64}$'),
  number text CHECK (char_length(number) <= 40),
  heading text CHECK (char_length(heading) <= 500),
  body text NOT NULL DEFAULT '',
  position integer NOT NULL CHECK (position >= 0),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(number, '') || ' ' || coalesce(heading, '') || ' ' || body)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sections_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT sections_ref_key_key UNIQUE (version_id, ref_key),
  CONSTRAINT sections_version_fk FOREIGN KEY (organisation_id, version_id)
    REFERENCES constitution_versions (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT sections_parent_fk FOREIGN KEY (organisation_id, parent_section_id)
    REFERENCES sections (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX sections_version_position_idx ON sections (version_id, position);
--> statement-breakpoint
CREATE INDEX sections_search_idx ON sections USING gin (search_vector);
--> statement-breakpoint

-- Text chunks used for AI retrieval. Embedding dimension is fixed when the embeddings provider is chosen.
CREATE TABLE section_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  section_id uuid NOT NULL,
  content text NOT NULL,
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT section_chunks_version_fk FOREIGN KEY (organisation_id, version_id)
    REFERENCES constitution_versions (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT section_chunks_section_fk FOREIGN KEY (organisation_id, section_id)
    REFERENCES sections (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Content approvals
-- ---------------------------------------------------------------------------------------------
CREATE TABLE content_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  reviewer_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  comment text CHECK (char_length(comment) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_approvals_version_fk FOREIGN KEY (organisation_id, version_id)
    REFERENCES constitution_versions (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- AI conversations, answers and citations
-- ---------------------------------------------------------------------------------------------
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  version_id uuid,
  title text CHECK (char_length(title) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversations_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT ai_conversations_version_fk FOREIGN KEY (organisation_id, version_id)
    REFERENCES constitution_versions (organisation_id, id) ON DELETE SET NULL (version_id)
);
--> statement-breakpoint
CREATE INDEX ai_conversations_user_idx ON ai_conversations (organisation_id, user_id, created_at DESC);
--> statement-breakpoint

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT ai_messages_conversation_fk FOREIGN KEY (organisation_id, conversation_id)
    REFERENCES ai_conversations (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint

-- A citation can only reference a section of the same organisation as the answer.
CREATE TABLE ai_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  section_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_citations_message_section_key UNIQUE (message_id, section_id),
  CONSTRAINT ai_citations_message_fk FOREIGN KEY (organisation_id, message_id)
    REFERENCES ai_messages (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_citations_section_fk FOREIGN KEY (organisation_id, section_id)
    REFERENCES sections (organisation_id, id) ON DELETE CASCADE
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Usage records (AI questions, storage, etc.) for plan limits and billing
-- ---------------------------------------------------------------------------------------------
CREATE TABLE usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric ~ '^[a-z0-9_.]{2,60}$'),
  quantity integer NOT NULL CHECK (quantity >= 0),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX usage_records_organisation_idx ON usage_records (organisation_id, occurred_at DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
-- The restricted role used for all tenant-scoped work. It cannot log in by itself; the API
-- switches to it inside each tenant transaction (SET LOCAL ROLE app_tenant).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
-- The account running migrations (and the API) must be allowed to switch to app_tenant.
-- Superusers can already do so. On managed databases this grant may need an administrator.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT app_tenant TO %I', current_user);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not grant app_tenant to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint

-- The organisation for the current transaction, or NULL if none is set (which matches no rows).
CREATE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_organisation_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Organisations: a tenant sees only itself.
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organisations TO app_tenant
  USING (id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT ON organisations TO app_tenant;
--> statement-breakpoint

-- Users are global (one account, many organisations). A tenant sees only its own members.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_members_only ON users TO app_tenant
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id AND m.organisation_id = current_tenant_id()
  ));
--> statement-breakpoint
GRANT SELECT (id, email, display_name, status) ON users TO app_tenant;
--> statement-breakpoint

-- Every organisation-specific table: rows must belong to the current organisation, for both
-- reading (USING) and writing (WITH CHECK).
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'memberships', 'invitations', 'subscriptions', 'files', 'organisation_branding',
    'constitutions', 'constitution_versions', 'extracted_texts', 'sections', 'section_chunks',
    'content_approvals', 'ai_conversations', 'ai_messages', 'ai_citations', 'usage_records'
  ]
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
--> statement-breakpoint

-- Audit events: tenants may read and append their own events only (never update or delete).
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_events TO app_tenant
  USING (organisation_id = current_tenant_id())
  WITH CHECK (organisation_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events TO app_tenant;
