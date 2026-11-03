-- Stage 10: subscriptions and entitlements.
--
-- Plans are configured by Constitution Intelligence staff (Platform Super Admins). Each
-- organisation has one current subscription to a plan. Invoices and payments are recorded by
-- hand: no payment provider is connected, card details are never stored, and a payment only
-- counts once a Super Admin has verified it against the bank or mobile-money statement.
-- What an organisation may do is worked out on every request from these tables and the date
-- (see apps/api/src/modules/subscriptions/access.ts).

-- ---------------------------------------------------------------------------------------------
-- Plans (global: they describe the product, not any organisation's data)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE plans (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description text CHECK (char_length(description) <= 500),
  is_pilot boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  currency text NOT NULL DEFAULT 'BWP' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Prices in the smallest unit (thebe). NULL = not offered / not set yet.
  monthly_price_minor integer CHECK (monthly_price_minor >= 0),
  annual_price_minor integer CHECK (annual_price_minor >= 0),
  -- Days of full access after a period ends or an invoice falls due, before access is restricted.
  grace_days integer NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 90),
  features text[] NOT NULL DEFAULT '{}' CHECK (
    features <@ ARRAY['ai_answers', 'approved_answers', 'simple_words', 'custom_branding']::text[]
  ),
  -- Usage limits. NULL = no limit.
  max_members integer CHECK (max_members > 0),
  max_constitutions integer CHECK (max_constitutions > 0),
  max_ai_questions_per_month integer CHECK (max_ai_questions_per_month >= 0),
  max_storage_mb integer CHECK (max_storage_mb > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Starting plans. PRICES ARE DELIBERATELY NOT SET: they are a business decision, made in the
-- control centre. "trial" is kept as the pilot plan's code because existing subscriptions use it.
INSERT INTO plans (code, name, description, is_pilot, grace_days, features,
                   max_members, max_constitutions, max_ai_questions_per_month, max_storage_mb)
VALUES
  ('trial', 'Pilot', 'A free pilot for a limited time, with every feature.', true, 7,
   ARRAY['ai_answers', 'approved_answers', 'simple_words', 'custom_branding'], 100, 3, 200, 200),
  ('standard', 'Standard', 'Reading, search, approved answers, simple words and branding.', false, 14,
   ARRAY['approved_answers', 'simple_words', 'custom_branding'], 500, 5, 0, 500),
  ('premium', 'Premium', 'Everything in Standard, plus AI answers.', false, 14,
   ARRAY['ai_answers', 'approved_answers', 'simple_words', 'custom_branding'], NULL, NULL, 1000, 2000);
--> statement-breakpoint

-- Any plan code already in use keeps working: it becomes an inactive "legacy" plan with every
-- feature and no limits, until a Super Admin moves the organisation to a current plan.
INSERT INTO plans (code, name, description, active, features)
SELECT DISTINCT s.plan_code, s.plan_code || ' (legacy)', 'Created automatically for an existing subscription.',
       false, ARRAY['ai_answers', 'approved_answers', 'simple_words', 'custom_branding']
FROM subscriptions s
WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.code = s.plan_code);
--> statement-breakpoint
GRANT SELECT ON plans TO app_tenant;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Subscriptions: billing interval, renewal, suspension and cancellation
-- ---------------------------------------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN billing_interval text NOT NULL DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly', 'annual', 'none')),
  ADD COLUMN auto_renew boolean NOT NULL DEFAULT true,
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspension_reason text CHECK (char_length(suspension_reason) <= 500),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text CHECK (char_length(cancellation_reason) <= 500),
  ADD CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_code) REFERENCES plans (code)
    ON UPDATE CASCADE,
  ADD CONSTRAINT subscriptions_suspension_recorded
    CHECK (status <> 'suspended' OR suspended_at IS NOT NULL),
  ADD CONSTRAINT subscriptions_cancellation_recorded
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL);
--> statement-breakpoint
-- Pilots ("trialing") are not billed.
UPDATE subscriptions SET billing_interval = 'none' WHERE status = 'trialing';
--> statement-breakpoint
UPDATE subscriptions SET suspended_at = updated_at WHERE status = 'suspended' AND suspended_at IS NULL;
--> statement-breakpoint
UPDATE subscriptions SET cancelled_at = updated_at WHERE status = 'cancelled' AND cancelled_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Invoices, payments (with receipts) and the billing history
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE invoice_number_seq;
--> statement-breakpoint
CREATE SEQUENCE receipt_number_seq;
--> statement-breakpoint

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL,
  number text NOT NULL UNIQUE CHECK (number ~ '^INV-[0-9]{4}-[0-9]{4,8}$'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 300),
  period_start timestamptz,
  period_end timestamptz,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text CHECK (char_length(void_reason) <= 500),
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT invoices_organisation_id_id_key UNIQUE (organisation_id, id),
  CONSTRAINT invoices_subscription_fk FOREIGN KEY (organisation_id, subscription_id)
    REFERENCES subscriptions (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT invoices_paid_recorded CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CONSTRAINT invoices_void_recorded CHECK (status <> 'void' OR voided_at IS NOT NULL),
  CONSTRAINT invoices_period_order CHECK (period_end IS NULL OR period_start IS NULL OR period_end > period_start)
);
--> statement-breakpoint
CREATE INDEX invoices_organisation_idx ON invoices (organisation_id, status, due_at);
--> statement-breakpoint

-- A payment is a RECORD that someone says money was paid. It only counts once verified.
-- There are no card fields, and nothing here comes from a payment provider.
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  method text NOT NULL CHECK (method IN ('bank_transfer', 'mobile_money', 'cash', 'cheque', 'other')),
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 2 AND 100
    AND reference !~ '[\x01-\x1F\x7F]'),
  paid_on date NOT NULL,
  notes text CHECK (char_length(notes) <= 500 AND notes !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'rejected')),
  reported_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  verified_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  verified_at timestamptz,
  verification_note text CHECK (char_length(verification_note) <= 500),
  rejection_reason text CHECK (char_length(rejection_reason) <= 500),
  receipt_number text UNIQUE CHECK (receipt_number ~ '^RCP-[0-9]{4}-[0-9]{4,8}$'),
  CONSTRAINT payments_invoice_fk FOREIGN KEY (organisation_id, invoice_id)
    REFERENCES invoices (organisation_id, id) ON DELETE CASCADE,
  -- A receipt exists exactly when a person verified the payment.
  CONSTRAINT payments_verification_recorded CHECK (
    (status = 'verified') = (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL AND receipt_number IS NOT NULL)
  ),
  CONSTRAINT payments_rejection_recorded CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX payments_organisation_idx ON payments (organisation_id, status);
--> statement-breakpoint

CREATE TABLE subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  subscription_id uuid,
  kind text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
  summary text NOT NULL CHECK (char_length(summary) <= 500),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX subscription_events_organisation_idx ON subscription_events (organisation_id, created_at DESC);
--> statement-breakpoint

DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['invoices', 'payments', 'subscription_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO app_tenant '
      'USING (organisation_id = current_tenant_id()) '
      'WITH CHECK (organisation_id = current_tenant_id())',
      tenant_table
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- Organisations can read their own billing records, and report a payment. Only the platform
-- (which does not use this role) can create invoices, verify payments or change subscriptions.
GRANT SELECT ON invoices, subscription_events TO app_tenant;
--> statement-breakpoint
GRANT SELECT ON payments TO app_tenant;
--> statement-breakpoint
-- Reporting a payment can only fill in what the organisation knows. The status, verifier and
-- receipt number can only be set by the platform, so a report can never mark itself verified.
GRANT INSERT (organisation_id, invoice_id, amount_minor, currency, method, reference, paid_on,
              notes, reported_by_user_id) ON payments TO app_tenant;
