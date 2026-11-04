-- Two-step sign-in (an authenticator app code after the password). Task D2.
--
-- Required for Platform Super Admins; optional for organisation Owners and Administrators.
-- None of these tables is granted to app_tenant: only the application's own sign-in code reads
-- them, never tenant-scoped queries. See docs/security/authentication.md ("Two-step sign-in").

-- One row per person who has started or finished setting up two-step sign-in.
CREATE TABLE user_two_step (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- The authenticator secret, encrypted with AES-256-GCM under MFA_ENCRYPTION_KEY
  -- ("v1.<iv>.<tag>.<ciphertext>", bound to the user id). Never stored in plain text.
  secret_ciphertext text NOT NULL CHECK (secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- NULL while setup is waiting for the first code; set once a code has proved the app works.
  enabled_at timestamptz,
  -- The 30-second time step of the last accepted code, so a code cannot be used twice.
  last_used_step bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Ten single-use recovery codes per person, for when the phone is lost. Only a keyed hash
-- (HMAC-SHA-256 with a key derived from MFA_ENCRYPTION_KEY) is stored.
CREATE TABLE two_step_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT two_step_recovery_codes_hash_key UNIQUE (user_id, code_hash)
);
--> statement-breakpoint
CREATE INDEX two_step_recovery_codes_user_idx ON two_step_recovery_codes (user_id);
--> statement-breakpoint

-- A sign-in waiting for its second step: created after a correct password, valid for five
-- minutes, used once, and abandoned after five wrong codes. Only the token's hash is stored.
CREATE TABLE two_step_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  used_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT two_step_challenges_token_hash_key UNIQUE (token_hash)
);
--> statement-breakpoint
CREATE INDEX two_step_challenges_user_idx ON two_step_challenges (user_id);
--> statement-breakpoint

-- When this session passed the second step (or finished setting it up). A session without it is
-- refused for anyone who has two-step sign-in turned on.
ALTER TABLE sessions ADD COLUMN two_step_verified_at timestamptz;
