# Organisation portals

Every organisation gets its own branded portal on the shared platform at:

```
/o/<portal address>        e.g. /o/sample-community-choir
```

There is one code base for all organisations. A portal's look comes entirely from the
organisation's saved settings, loaded each time a page opens. No organisation has separate code.

## What members see

| Page            | Address                   | Who                                                                              |
| --------------- | ------------------------- | -------------------------------------------------------------------------------- |
| Branded sign-in | `/o/<address>/sign-in`    | Anyone (shows only name, tagline, colours, logo)                                 |
| Home            | `/o/<address>`            | Members of that organisation                                                     |
| Read (library)  | `/o/<address>/library`    | Members                                                                          |
| Reading view    | `/o/<address>/read/<id>`  | Members (published version); reviewers can choose drafts                         |
| Search          | `/o/<address>/search?q=…` | Members (published text only)                                                    |
| My profile      | `/o/<address>/profile`    | Members (own name, password, sign out)                                           |
| Manage          | `/o/<address>/manage`     | Owners, administrators, content reviewers, auditors (each sees only their parts) |

Navigation on phones and small tablets is a bar at the bottom of the screen with large icons and
labels (Home, Read, Search, Manage for administrators, Profile). Wider screens show the same items in
the top bar. The reading view has a **Contents** list (a sheet on phones and a sidebar on desktops),
**A− / A+** text-size buttons, and links that jump to a section (used by search results).

## Branding settings

| Setting           | Where it is used                               | Rules                                                                |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Organisation name | Top bar, sign-in page, welcome heading         | Plain text, one line, up to 200 characters                           |
| Tagline           | Sign-in page                                   | Plain text, one line, up to 300 characters                           |
| Welcome message   | Home page after sign-in (not shown publicly)   | Plain text, up to 1,000 characters, line breaks allowed              |
| Primary colour    | Top bar, main buttons                          | Exact `#RRGGBB` code                                                 |
| Secondary colour  | Welcome panel, part headings                   | Exact `#RRGGBB` code                                                 |
| Accent colour     | Highlights, selected menu item, search matches | Exact `#RRGGBB` code                                                 |
| Logo              | Top bar, sign-in page                          | PNG, JPEG or WebP, up to 512 KB                                      |
| Portal address    | The link members use                           | 3–50 lower-case letters, numbers or hyphens; platform words reserved |

Who can change what (enforced by the API):

- **Branding** (name, tagline, welcome message, colours, logo): Owners and Administrators
  (`branding.manage`). Platform Super Admins can also change it from the control centre.
- **Portal address**: Owners only (`organisation.settings.manage`), because changing it breaks the
  old link. Platform Super Admins can also change it.
- **Members and invitations**: as before (Stage 3).
- **Content approval status**: Owners, Administrators and Content Reviewers (`content.review`).

Text colours are chosen automatically (white or near-black) so writing on a branded background stays
readable. The branding page warns administrators about hard-to-read colour choices, and links fall
back to navy if the primary colour is too light to read on white.

## Safety rules

- **Colours** are exact 6-digit hex codes, checked by the API, the database and again in the browser
  before they are used. A stored value can never add other CSS (no keywords, `url()`, `;` etc.).
- **Text** (name, tagline, welcome message) is stored and shown as plain text. React escapes it, so
  `<script>` or `<img onerror>` appear as ordinary characters and never run. Hidden control characters
  are refused. A browser test checks this end to end.
- **Logos** are checked from their actual bytes ("magic numbers"), not their name or the type the
  browser claims. Only PNG, JPEG and WebP are accepted. SVG is refused because SVG can contain
  scripts. Rejected uploads are recorded in the audit log (`organisation.logo_rejected`).
- Logos are stored under the organisation's own storage folder (`tenants/<id>/branding/…`) and
  served by `GET /api/v1/portal/<address>/logo` with the stored image type,
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. The
  bytes are checked again before serving. The portal shows logos only in `<img>` tags.
- The **public** portal endpoint (`GET /api/v1/portal/<address>`) reveals only the display name,
  tagline, colours, logo link and whether the portal is available. It does not reveal the
  organisation's ID, members, documents or welcome message. Archived organisations return "not
  found"; suspended ones show a "temporarily unavailable" page.

## Tenant permissions

The portal pages decide only what to _show_. All data comes from the API, which checks for every
request that the signed-in person is an active member of the organisation **in the URL** and that
their role has the right permission (see [security/tenant-isolation.md](security/tenant-isolation.md)).
The portal address in the browser only selects which of _your own_ memberships to use: the
organisation ID comes from your verified membership, never from the address.

Someone signed in to another organisation who opens a portal sees "You are not a member of …", and
every API request for that organisation returns "not found".

## API endpoints added in Stage 6

| Method & path                                               | Permission                     |
| ----------------------------------------------------------- | ------------------------------ |
| `GET /api/v1/portal/:slug`                                  | Public                         |
| `GET /api/v1/portal/:slug/logo`                             | Public                         |
| `GET /api/v1/organisations/:id/portal`                      | `organisation.read`            |
| `GET /api/v1/organisations/:id/library`                     | `constitution.read`            |
| `GET /api/v1/organisations/:id/constitutions/:cid`          | `constitution.read`            |
| `GET /api/v1/organisations/:id/content-status`              | `content.review`               |
| `PATCH /api/v1/organisations/:id/branding` (more fields)    | `branding.manage`              |
| `PUT /api/v1/organisations/:id/branding/logo`               | `branding.manage`              |
| `DELETE /api/v1/organisations/:id/branding/logo`            | `branding.manage`              |
| `PATCH /api/v1/organisations/:id/settings` (portal address) | `organisation.settings.manage` |
| `PATCH /api/v1/auth/me` (own display name)                  | Signed in                      |

Search results now also include the constitution's ID and title, so results link to the right page.

## Test organisations

`pnpm seed:dev` creates two fictional organisations with clearly different branding:

| Portal                      | Colours (primary / secondary / accent)              | Logo                |
| --------------------------- | --------------------------------------------------- | ------------------- |
| `/o/sample-community-choir` | plum `#4A2B6B` / cream `#F6EEDC` / gold `#D9A21B`   | Generated ring logo |
| `/o/sample-netball-club`    | green `#0E5A3A` / mint `#E7F4EC` / orange `#F28C28` | Generated ring logo |

Each has a constitution in four parts with clauses and sub-clauses, a published version and a draft.
The seed prints one-time random passwords for every account. All data is fictional.

## Tests

- `apps/api/test/portal.e2e.spec.ts` — public branding exposure, suspended/archived portals, branding
  per organisation, role checks for every change, unsafe colours and text, logo type and size checks
  and safe serving, library/reading/search visibility, content status permissions, portal address
  rules (owner only, reserved words, duplicates, audit), profile updates, and cross-organisation
  attempts.
- `apps/api/test/tenancy.e2e.spec.ts` — the new endpoints are included in the cross-tenant attack
  lists.
- `apps/web/src/lib/branding.test.ts`, `portal.test.ts` — colour safety and contrast, search
  highlighting as text, section tree and contents.
- `apps/web/e2e/portal.spec.ts` — in a real browser: different branding per organisation, reading,
  contents navigation and search, refusal of another organisation's portal (page and API), members
  without the manage area, an administrator saving branding with HTML-like text that stays harmless,
  logo upload checks, content approval status, and phone navigation.

## Known limitations

- The public portal endpoints are not rate-limited separately yet (planned with the security
  hardening stage, together with a Content Security Policy for the web app).
- Portal addresses are paths (`/o/<address>`), not separate domains or sub-domains. Custom domains
  can be added later without changing portal code.
- Logos are not resized or re-encoded on upload; size is limited to 512 KB and display size is fixed
  by the page.
- Changing the portal address does not keep a redirect from the old address.
- "Ask a question" (AI answers) is not part of the portal yet; it arrives with the AI stage.
