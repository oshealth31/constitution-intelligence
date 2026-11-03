# Online and offline use

Members can keep a copy of their organisation's **approved constitution** on their phone or
computer and read and search it **without an internet connection**. The portal is a
**Progressive Web App** (PWA): it has a web app manifest (it can be added to the home screen) and a
service worker that lets the offline reader open without a network.

## What works where

|                                                       | Online                                                | Offline                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Signing in, portal access                             | Yes (checked by the server on every request)          | No — the saved copy is opened instead                                         |
| Current approved constitution                         | Yes                                                   | **The saved copy** (the version current when it was last synchronised)        |
| Navigating sections                                   | Yes                                                   | Yes (contents list)                                                           |
| Search                                                | Server search (Stage 8)                               | **Keyword search on the device**: words and clause numbers                    |
| Simple words                                          | Yes                                                   | Yes, if they were approved when the copy was saved and the plan includes them |
| AI answers, "find relevant clauses", approved answers | Yes                                                   | **No** — the app says so                                                      |
| Version shown                                         | Yes                                                   | Yes ("Version 2: Amended 2026 · published …")                                 |
| Last synchronisation                                  | —                                                     | Always shown                                                                  |
| Synchronisation                                       | On opening the portal and when the connection returns | Waits for the connection                                                      |

## How it works

1. A member chooses **Save for offline reading** (home page or My profile). It is a deliberate
   choice per device, with a warning not to use it on shared or public computers.
2. The web app downloads `GET /api/v1/organisations/:id/offline/bundle` and stores it in the
   browser's **IndexedDB**. The service worker keeps the offline reader page (`/offline/<portal>`)
   and the app's static files.
3. While online, every visit (and every time the connection returns) calls the small
   `GET …/offline/status`. If the content changed — a new version was published, simple words were
   approved — the copy is downloaded again; otherwise it is confirmed as current.
4. Offline, opening any portal page sends the person to `/offline/<portal>`, which works entirely
   from the device.

### Status is always visible

- On portal pages: a banner **"You are offline"** as soon as the connection drops, with a link to
  the saved copy.
- In the offline reader: an **Online / Offline** label, **Last synchronised: …**, and:
  - _"Checking for a newer version…"_, _"A newer version was downloaded"_ or _"The saved copy is up
    to date"_ when online;
  - _"This copy may be out of date"_ when it has not been synchronised for **7 days**;
  - _"You are online but signed out, so the saved copy could not be checked"_ when relevant.
- On the Ask page: _"Live AI answers and 'find relevant clauses' need an internet connection"_.

## What is stored on the device — and what is not

**Stored** (IndexedDB, per portal): the organisation's name and colours; for each constitution its
title and the **published version** (number, label, date), its sections exactly as approved, and
approved simple words; when it was synchronised; until when it may be shown; and the signed-in
person's user id (a random identifier, to tie the copy to them).

**Never stored:** drafts or other versions; members, names, e-mail addresses or contact details;
questions, AI answers or approved answers; billing; audit data; passwords, session cookies or
tokens. (The session cookie is HttpOnly: scripts, including the service worker, cannot read it.)

**Service worker cache:** only `/_next/static/…` files, icons, the manifest, a static
"you are offline" page and the offline reader page shells (`/offline/<portal>`), which contain no
content. It **never caches** anything under `/api/`, the **control centre (`/admin`)**, sign-in
pages, or any non-GET request. The browser test checks this.

## Removing local data

- **Remove from this device** (home page, My profile, or the offline reader) deletes that portal's
  copy and its cached reader page. It asks for confirmation.
- **Signing out** removes every saved copy and cached reader page on the device.
- The copy is **removed automatically** the next time the device is online if the server says the
  person may no longer read it: the subscription is suspended or restricted, or they are no longer a
  member.
- A copy that has not synchronised for **`OFFLINE_COPY_MAX_AGE_DAYS` (default 30) days** is no
  longer shown ("This saved copy has expired"); a successful check online renews this.

## Limitations (please read)

- **Downloaded content cannot be taken back while a device stays offline.** If an organisation's
  subscription is suspended, a member is removed, or a new version is published, a device that does
  not come online keeps showing its saved copy — until it expires after
  `OFFLINE_COPY_MAX_AGE_DAYS`, or the person removes it or signs out. A determined person can also
  copy text out of the browser; that is true of anything shown on a screen. The protection is that
  the server refuses to send new content, the copy is removed as soon as the device is online, and
  it stops being shown after the maximum age.
- The saved copy may be **out of date**. The reader always shows the last synchronisation date and
  warns after 7 days. **The approved original document is what counts.**
- Offline search is simple keyword matching on the device (every word must appear); it does not
  understand meaning, and it is not the same ranking as the online search.
- **AI answers, "find relevant clauses", approved answers and the original PDF/Word download are
  online only.**
- Only one person's copy per portal per device is kept; if someone else signs in on the same device
  and saves a copy, it replaces the first.
- Browsers may delete stored data when the device is short of space, and private/incognito windows
  delete it when closed. The browser decides; the app cannot prevent it.
- Service workers need HTTPS (or `localhost`/`127.0.0.1` in development). Some older browsers do not
  support them; the portal then works online only.

## API

| Method & path (under `/api/v1/organisations/:id`) | Permission          | Notes                                                                                                  |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /offline/status`                             | `constitution.read` | `{ format, contentHash, checkedAt, usableUntil }`. `Cache-Control: no-store`                           |
| `GET /offline/bundle`                             | `constitution.read` | The content described above. `Cache-Control: no-store`. Counted in usage records (`offline.downloads`) |

Both follow every online rule (membership, role and subscription, enforced by `PermissionGuard`):
suspended or restricted organisations' members are refused with `SUBSCRIPTION_INACTIVE` /
`SUBSCRIPTION_READ_ONLY`, and the device then deletes its copy.

## Files

- `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/*`: PWA manifest and icons.
- `apps/web/public/sw.js`: the service worker (narrow caching rules, described at its top).
- `apps/web/src/lib/offline.ts` (pure: format check, freshness, local search),
  `offline-store.ts` (IndexedDB, clearing), `offline-sync.ts` (synchronisation rules).
- `apps/web/src/components/offline-ui.tsx`: banner, "Read without internet" card, background sync.
- `apps/web/src/app/offline/[slug]/page.tsx`: the offline reader.
- `apps/api/src/modules/offline/`: the two endpoints.

## Tests

- `apps/web/src/lib/offline.test.ts`: format check, freshness (fresh/stale/expired), local search,
  excerpts.
- `apps/api/test/offline.e2e.spec.ts`: published content only, no personal data, no-store headers,
  simple words (approved only), the status changing on new content, organisation separation,
  sign-in required, suspended and restricted subscriptions refused.
- `apps/web/e2e/offline.spec.ts` (Chromium with the real service worker, switching the browser
  offline and online): save → offline banner → the portal opens the saved copy offline → version,
  last synchronisation, AI notice, contents navigation, local search → back online and checked →
  remove; nothing from `/api`, `/admin` or sign-in in the cache; the Ask page offline; signing out
  clears the copy.
