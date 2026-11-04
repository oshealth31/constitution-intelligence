# Offboarding, data export, retention and deletion

## Offboarding an organisation

| #   | Who         | Step                                                                                                                                                                                                                                                                              |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner       | Asks to leave, in writing (email is enough), or the subscription is not renewed.                                                                                                                                                                                                  |
| 2   | Super Admin | Control Centre → organisation → Subscription → **Cancel** (at period end or now). Access continues until the period end plus the grace period (plan's grace days), then becomes **restricted**: members are blocked, Owners and Administrators can only read. Nothing is deleted. |
| 3   | Super Admin | **Export** the organisation's data (below) if the Owner asks for it, and send it securely.                                                                                                                                                                                        |
| 4   | Super Admin | After the retention period (`SUBSCRIPTION_DATA_RETENTION_DAYS`, default **90 days** after access became restricted), the organisation appears under Billing → "Restricted or suspended". Contact the Owner once more, then delete (below).                                        |
| 5   | Super Admin | Record the export, the confirmation and the deletion in the change log.                                                                                                                                                                                                           |

## Data export

```bash
cd /srv/constitution/infra/production
docker compose exec -T postgres psql -U constitution_owner -d constitution -Atc \
  "SELECT id FROM organisations WHERE slug = '<address>'"
docker compose --profile ops run --rm ops /ops/export-organisation.sh <organisation id>
# -> exports/<address>-<time>.tar.gz.gpg (encrypted with the backup passphrase)
```

The export contains that organisation's records as JSON (constitutions, every version and
section, approvals, approved answers, simple words, members' names, emails and roles,
invitations, subscription, invoices, payments, audit log, usage counts) and the original
uploaded files, plus a checksum file and a README. It **leaves out** passwords and their
hashes, sessions, one-time link tokens, rate-limit counters, search indexes and members'
private AI questions. Before sending it, decrypt it on a trusted computer and re-encrypt it for
the recipient (for example a password-protected archive, with the password sent separately).
The deployment check workflow tests the export on fictional data: it contains the
organisation's sections and people, and nothing of the other organisation.

Individual people asking for their own data (data-subject requests): their account details
(name, email, memberships) and their own AI questions, by SQL query. A tool for this is not
built yet.

## Retention

| Data                                                  | Kept while active                                         | After the subscription ends                                                                                                    | Notes                                                  |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Constitutions, versions, files, answers, simple words | Yes                                                       | Unchanged for the retention period (90 days after restriction), then deleted on request/after contact                          | The organisation's own records                         |
| Members and invitations                               | Yes                                                       | Same as above                                                                                                                  |                                                        |
| Audit log                                             | Yes                                                       | Same as the organisation's data                                                                                                | Append-only; deleted only with the organisation        |
| Invoices, payments, receipts                          | Yes                                                       | **Kept** as financial records even after the rest is deleted (period to be confirmed by an accountant; commonly several years) | Stated on the subscription page                        |
| AI questions (if AI is ever on)                       | Each person's own                                         | Deleted with the organisation                                                                                                  | Not used for training                                  |
| Sessions, reset links, rate-limit counters, two-step challenges | Until they end | Removed automatically 30 days after they end (counters and challenges after a day) | [maintenance.md](maintenance.md) (Task D6) |
| Backups                                               | 35 days locally (`BACKUP_KEEP_DAYS`), off-site per policy | Deleted data disappears from backups when they expire                                                                          | Proposed: 35 days                                      |
| Application and proxy logs                            | Proposed 90 days                                          |                                                                                                                                | [logging-and-monitoring.md](logging-and-monitoring.md) |

These periods are proposals. The data-protection review must confirm them (see the open
requirements in production-readiness.md).

## Deletion (Task D3)

Deletion is permanent. It is done in the Control Centre: **Organisations → the organisation →
"Delete this organisation's data"** (at the bottom of the page).

**Before you start**

1. The organisation's access has ended: it is **suspended**, or its subscription was cancelled
   and access is **restricted**. An active organisation cannot be deleted.
2. The data was **exported** and handed over (above), or the Owner declined an export in
   writing. Keep the Owner's written request.
3. Take a **backup** (`docker compose --profile ops run --rm ops`).

**Who approves**

| Super Admins on the platform | Rule                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Two or more                  | One requests; a **different** Super Admin approves. The requester cannot approve their own request.              |
| Only one                     | The same person may confirm **24 hours** after requesting, and may cancel before then.                           |
| Either (server backup)       | `delete-organisation.js --approve` on the server command line, also only 24 hours after the request (see below). |

Every request needs a reason (no members' names, please), the tick that the data was exported,
and the organisation's web address typed exactly. Requests expire after **7 days**. Any Super
Admin can cancel a waiting request.

**What is deleted**, in one database transaction (if anything fails, nothing is deleted):
constitutions with every version, clause, extracted text and search index; uploaded files'
records; approved answers; simple words; AI conversations, answers and feedback; approvals;
branding and logo; usage records; invitations; memberships; **the organisation's audit log**;
and the **accounts** of people who belong to no other organisation and are not staff, together
with their platform-level sign-in records. After the transaction, the organisation's folder in
file storage (`tenants/<id>/`) is removed; if that fails, use **Remove files again** (or
`--remove-files`).

**What is kept**: invoices, payments, receipts, the subscription and its history, as financial
records (period to be confirmed by an accountant). The deletion **ends the subscription**
(cancelled, no renewal, with a history entry "Cancelled because the organisation's data was
deleted"). Afterwards its subscription cannot be renewed, reactivated, suspended or changed and
no new invoice can be issued; existing invoices can still be settled (payments recorded and
verified) or voided. The organisation's row stays as a marker:
its name, "Deleted" status and the date, with its web address freed for reuse. Links from
payments to the people who reported or verified them become empty when those accounts are
deleted. People who belong to another organisation keep their account; only their membership
here is removed.

**The record of the deletion**: an `organisation.deleted` audit event and the request itself,
with who requested and approved it, the reason and **counts only** (no names, emails or
content). The audit log stays append-only: the database lets the deletion procedure remove
only the events of an organisation already marked deleted, or the platform-level events of an
account already deleted (migration `0010_organisation_deletion.sql`).

**Backups**: the deleted data stays inside encrypted backups until they expire (35 days by
default), then it is gone. Tell the organisation this. A restore from an older backup would
bring it back: if you ever restore, delete the organisation again before reopening the site.

**Afterwards**: send the confirmation letter
([template](../pilot/templates/deletion-confirmation.md)) to the Owner and record the deletion
in the change log.

**Server command line** (when the Control Centre cannot be used; a request must already exist):

```bash
cd /srv/constitution/infra/production
docker compose run --rm -T api node dist/cli/delete-organisation.js --organisation <id> --preview
docker compose run --rm -T api node dist/cli/delete-organisation.js --organisation <id> \
  --approve --confirm <web address>
docker compose run --rm -T api node dist/cli/delete-organisation.js --organisation <id> --remove-files
```

**Tested**: API tests with two fictional organisations (one deleted, the other compared before
and after: unchanged), the approval rules, the audit-log rule, and every table with an
organisation column is accounted for; the deployment check deletes a fictional organisation
with the command line on the production stack and checks the other is untouched; a browser test
requests and cancels a deletion. **Not yet tested on the real server.**

Not covered: a single person's request to delete their own data while their organisation
stays (Task D11).
