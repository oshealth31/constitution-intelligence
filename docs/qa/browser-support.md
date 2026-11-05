# Browser support (task T1)

Every change runs the browser tests (real API, real database, fictional data) in five browsers:

| Run (CI job)                   | Engine                      | Screen  | Tests                        |
| ------------------------------ | --------------------------- | ------- | ---------------------------- |
| Browser tests (control centre) | Chromium (Chrome, Edge)     | Desktop | All                          |
| Browser tests (firefox)        | Firefox                     | Desktop | All (one skipped, see below) |
| Browser tests (webkit)         | WebKit (Safari)             | Desktop | All                          |
| Browser tests (mobile-safari)  | WebKit, iPhone 13 emulation | Phone   | Phone tests (`@phone`)       |
| Browser tests (mobile-chrome)  | Chromium, Pixel 7 emulation | Phone   | Phone tests (`@phone`)       |

The phone tests cover sign-in with two-step codes, the phone layout of every main page, the
reader and search on a phone, the Control Centre on a phone, and saving and reading offline.

Run locally with `E2E_BROWSER=<firefox|webkit|mobile-safari|mobile-chrome> pnpm --filter
@constitution/web run test:e2e` (after `playwright install <engine>`).

## Found and fixed by these runs

- **Typed details could end up in the web address.** If a form was sent before the page's code
  had loaded (easy on a slow phone), the browser sent it itself, as a web address containing
  the fields, including the email and password on the sign-in pages. That would put them in
  the browser history and server logs. Now every form posts (`method="post"`, checked by a unit
  test), and submit buttons stay disabled until the page is ready.
- **Safari showed the personal-data copy (D11) on screen instead of saving it.** The link now
  carries the `download` attribute.

## Known limits

- **Offline in Firefox is not tested automatically.** Playwright's offline switch does not reach
  Firefox's service worker, so the "go offline" journey is skipped there (it runs in Chromium,
  desktop Safari/WebKit, iPhone and Android). Real Firefox behaves like the others.
- **WebKit reports an empty style attribute on dropdowns** (`<select>`) as a Content Security
  Policy violation. The attribute is empty, so nothing is blocked from showing; the browser
  test prints it but does not count it.
- **Emulation is not a real phone.** Playwright's iPhone is WebKit on Linux with an iPhone screen
  and user agent; it is not iOS Safari. Real phones: [real-phone-checklist.md](real-phone-checklist.md)
  (task T4).
- Edge is Chromium, so it is covered by the Chromium run; Samsung Internet (Chromium) likewise,
  but neither is run separately.

## Keyboard and screen readers (task T2)

`e2e/keyboard.spec.ts` runs in every browser above: signing in, skipping to the content, using
the main menu, searching and opening a clause with the keyboard only; a visible focus outline at
every stop on the member home page; the Control Centre with the keyboard; form hints announced
as a description (not as part of the field's name); and, on a phone, the reader's Contents
panel keeping the focus inside, closing with Escape and returning the focus. Fixed along the
way: hints inside labels, the Contents panel letting the focus escape and not returning it, and
no "Skip to main content" link in the Control Centre. The person-held check is
[screen-reader-check.md](screen-reader-check.md).
