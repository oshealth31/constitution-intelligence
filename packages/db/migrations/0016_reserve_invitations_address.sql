-- The invitation page lives at /invitations/accept, so "invitations" cannot be an
-- organisation's portal address (its short link would clash). Same list as RESERVED_SLUGS in
-- packages/shared/src/portal.ts.
ALTER TABLE organisations DROP CONSTRAINT organisations_slug_not_reserved;
--> statement-breakpoint
ALTER TABLE organisations
  ADD CONSTRAINT organisations_slug_not_reserved CHECK (
    slug NOT IN (
      'about', 'admin', 'api', 'app', 'assets', 'auth', 'blog', 'careers', 'contact',
      'control-centre', 'docs', 'faq', 'forgot-password', 'help', 'icons', 'invitations', 'legal',
      'login', 'logout', 'manage', 'news', 'offline', 'platform', 'portal', 'pricing', 'privacy',
      'reset-password', 'settings', 'sign-in', 'sign-out', 'static', 'status', 'support',
      'terms', 'www'
    )
  );
