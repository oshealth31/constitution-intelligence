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
| Sessions, reset links, rate-limit counters            | Days                                                      | Cleaned up monthly                                                                                                             | [maintenance.md](maintenance.md)                       |
| Backups                                               | 35 days locally (`BACKUP_KEEP_DAYS`), off-site per policy | Deleted data disappears from backups when they expire                                                                          | Proposed: 35 days                                      |
| Application and proxy logs                            | Proposed 90 days                                          |                                                                                                                                | [logging-and-monitoring.md](logging-and-monitoring.md) |

These periods are proposals. The data-protection review must confirm them (see the open
requirements in production-readiness.md).

## Deletion: not yet supported by a tool

There is **no deletion tool yet**, and hand-written SQL is deliberately hard: the audit log
cannot be deleted (database triggers), and the tables are linked. Deleting an organisation
safely needs a reviewed, tested procedure that:

1. exports the data first (above) and keeps the export for the agreed period;
2. deletes, in one transaction and in dependency order, the organisation's rows from every
   organisation table except invoices, payments and receipts;
3. handles the audit log by an approved method (for example a controlled function that removes
   one organisation's events, used only by the deletion procedure and itself recorded);
4. removes `tenants/<organisation id>/` from file storage;
5. records the deletion (who, when, which organisation) in the platform audit log;
6. accepts that the data stays in backups until they expire (35 days), and says so to the
   organisation.

Until that tool exists and is tested, the honest answer to a deletion request is: access is
blocked, the data is exported and handed over, and deletion is completed by a manual,
two-person procedure agreed case by case. This is a **go-live requirement** (production-readiness.md).
