-- Stage 6: organisation portals.
-- Adds the remaining branding settings (secondary colour, welcome message) and protects
-- portal addresses (slugs) that the platform itself needs.

-- ---------------------------------------------------------------------------------------------
-- Branding: secondary colour and welcome message
-- ---------------------------------------------------------------------------------------------
ALTER TABLE organisation_branding
  ADD COLUMN secondary_colour text NOT NULL DEFAULT '#F5EFE2'
    CHECK (secondary_colour ~ '^#[0-9A-Fa-f]{6}$');
--> statement-breakpoint
-- Plain text only. The portal always displays it as text (never as HTML); the database also
-- refuses invisible control characters (new lines and tabs are allowed).
ALTER TABLE organisation_branding
  ADD COLUMN welcome_message text
    CHECK (char_length(welcome_message) <= 1000 AND welcome_message !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]');
--> statement-breakpoint
ALTER TABLE organisation_branding
  ADD CONSTRAINT organisation_branding_display_name_plain
    CHECK (display_name !~ '[\x01-\x1F\x7F]');
--> statement-breakpoint
ALTER TABLE organisation_branding
  ADD CONSTRAINT organisation_branding_tagline_plain
    CHECK (tagline !~ '[\x01-\x1F\x7F]');
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Portal addresses: words reserved for the platform cannot be used as an organisation slug.
-- Keep in sync with RESERVED_SLUGS in packages/shared/src/portal.ts.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE organisations
  ADD CONSTRAINT organisations_slug_not_reserved CHECK (
    slug NOT IN (
      'admin', 'api', 'app', 'assets', 'auth', 'control-centre', 'forgot-password', 'help',
      'login', 'logout', 'manage', 'platform', 'portal', 'reset-password', 'settings',
      'sign-in', 'sign-out', 'static', 'status', 'support', 'www'
    )
  );
