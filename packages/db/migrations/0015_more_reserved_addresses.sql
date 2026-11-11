-- Short portal links (constitutionintel.com/<address> forwards to /o/<address>): an
-- organisation's address now shares the top level with the website's own pages. Reserve the
-- pages that exist today (offline, icons) and the usual pages a public website adds later.
-- Same list as RESERVED_SLUGS in packages/shared/src/portal.ts.
ALTER TABLE organisations DROP CONSTRAINT organisations_slug_not_reserved;
--> statement-breakpoint
ALTER TABLE organisations
  ADD CONSTRAINT organisations_slug_not_reserved CHECK (
    slug NOT IN (
      'about', 'admin', 'api', 'app', 'assets', 'auth', 'blog', 'careers', 'contact',
      'control-centre', 'docs', 'faq', 'forgot-password', 'help', 'icons', 'legal', 'login',
      'logout', 'manage', 'news', 'offline', 'platform', 'portal', 'pricing', 'privacy',
      'reset-password', 'settings', 'sign-in', 'sign-out', 'static', 'status', 'support',
      'terms', 'www'
    )
  );
