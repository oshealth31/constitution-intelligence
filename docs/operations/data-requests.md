# Personal data requests (one person)

A person can ask what personal data is held about them, ask for it to be corrected, or ask for
their account to be deleted. This page is the procedure and the tool for that (Task D11). For a
whole organisation leaving, see [offboarding-and-retention.md](offboarding-and-retention.md).

> **Not legal advice.** Who must answer (the organisation, Constitution Intelligence, or both),
> the deadline, and when a request may be refused or limited must be confirmed with a lawyer
> under the Data Protection Act, 2024 (legal items L1–L6). The tool records a "respond by"
> date that **you** enter; it does not assume a number of days.

## Where

Control Centre → **Data requests** (Super Admins only). Every step is recorded in the audit log
as `data_request.*`. The audit entries name the request, never the person's email.

## 1. Record the request

Confirm who is asking first: call them back on a number you already have, or have their
organisation's Owner confirm in writing. Never act on an email alone.

Record: what they ask for (copy, correction or deletion), their email, the date received, the
date you must respond by, how it arrived, how you confirmed their identity, and any details.
Open requests are listed first, soonest deadline first; late ones are marked **Overdue**.

If no account uses the email, the request page says so: tell the person no account data is
held under that address.

## 2. Copy of their data

On the request page, **Download the copy**: a JSON file (readable in any text editor) with
their account, organisations and roles, two-step sign-in status, sign-ins with IP address and
device, password-reset requests, invitations they received (and how many they sent, without
other people's addresses), AI conversations and feedback, usage totals, records that name them
(files uploaded, versions created, review decisions, clauses edited, answers, payments
reported), and their activity log.

Never included: passwords, two-step secret keys, recovery codes or sign-in tokens (only
scrambled versions are stored), and other people's email addresses. Each download is audited.

Send it securely (for example an encrypted attachment, password given by phone), then
**Mark as answered** with how it was sent.

## 3. Correction

For a correction request: enter the correct name and/or email and the reason. A new email
signs the person out everywhere. People can also change their own name on their profile page.
The request completes with a note of which fields changed (not the values).

## 4. Deletion

For a deletion request: give the reason and type the person's email to confirm.

**Deleted:** the account, memberships, sign-ins, two-step sign-in, password-reset links,
invitations sent to their address, AI conversations and feedback, and their sign-in rate-limit
counter.

**Kept, without their name** (the organisation's records): constitution versions, clauses they
edited, review decisions, approved answers, simple-words texts, uploaded files, payments and
invoices.

**Audit log (decision A1):** entries stay, so the organisation's history is complete, but are
anonymised: the IP address and device of what they did are cleared, a target that was their id
or email becomes `[removed]`, and their email (and "Name (email)") are removed from the
details. The database allows this only inside the deletion procedure, only after the account is
gone, and only for those fields (migration `0013_data_requests.sql`).

**The request record** keeps a SHA-256 fingerprint of the email instead of the address, so a
repeated request can be recognised without keeping the address.

**Refused:** Super Admin accounts (remove the rights on the server first), and the only Owner
of an active organisation (make someone else Owner first). You cannot delete yourself.

**Backups** still contain the data until they expire (35 days by default). Copies already
downloaded or sent cannot be recalled.

Known gap: failed sign-in attempts are logged with a partly hidden email (for example
`th***@sample.test`); these are not matched and stay as they are.

## Server command line (backup)

The request must be recorded in the Control Centre first.

```bash
cd /srv/constitution/infra/production
docker compose run --rm -T api node dist/cli/data-request.js --request <id> --show
docker compose run --rm -T api node dist/cli/data-request.js --request <id> --copy > copy.json
docker compose run --rm -T api node dist/cli/data-request.js --request <id> --delete \
  --confirm <their email> --reason "<why>"
```

Delete `copy.json` from the server once it has been sent.

## Tested

`apps/api/test/data-requests.e2e.spec.ts` (fictional people): Super Admin only; identity check
and dates required; the copy contains every area and no password, token, secret or other
person's email; correction only on correction requests; refusals for a Super Admin and the only
Owner; deletion removes only that person (another member is unchanged), keeps every clause of a
published version without the name, anonymises the audit entries, and the person can no longer
sign in; the audit log still refuses any other change. `packages/db/test/accounts.test.ts`:
the application account still cannot change the audit log outside the procedure. Browser test:
record a request, download the copy, cancel. **Not yet tested on the real server.**
