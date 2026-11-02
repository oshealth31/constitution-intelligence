# Tenant isolation strategy

Constitution Intelligence serves many independent organisations ("tenants") from one shared
application and one shared PostgreSQL database. This document explains how one organisation
is prevented from reaching another's data, and what is still to come.

**Principle: the organisation is never taken from the browser.** It is established on the server
from a verified, active membership. Then it is enforced twice: by the application in every query,
and by PostgreSQL itself.

## The layers

| #   | Layer                    | What it does                                                                                                                                                                                                                                                                                                         | Where                                                  |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | Authentication           | Every non-public route needs a valid server-side session.                                                                                                                                                                                                                                                            | `AuthGuard`                                            |
| 2   | Verified membership      | The organisation ID in the URL is checked against the caller's **active** membership in an **active** organisation. Non-members get 404, so other organisations cannot even be confirmed to exist.                                                                                                                   | `PermissionGuard`                                      |
| 3   | Trusted tenant context   | Only after step 2 does the server create a `TenantScope` (organisation, user, role). Tenant services accept only a `TenantScope`, never a plain ID, so an ID from a body, query string or header cannot be used. Unknown request fields are discarded.                                                               | `tenant-scope.ts`, `@Tenant()`                         |
| 4   | Explicit filters         | Every tenant query also filters by `organisation_id = scope.organisationId`.                                                                                                                                                                                                                                         | every tenant service                                   |
| 5   | Row-Level Security (RLS) | Tenant work runs in a transaction that switches to the restricted database role `app_tenant` and sets the organisation for that transaction. PostgreSQL then hides, and refuses to write, any row of another organisation, even if application code forgets a filter. With no organisation set, no rows are visible. | `TenantDatabase.run`, migration 0002                   |
| 6   | Same-tenant constraints  | Links between tenant records use composite foreign keys `(organisation_id, id)`, so a version, section, citation, file reference or subscription can never point at another organisation's record.                                                                                                                   | migration 0002                                         |
| 7   | File storage paths       | Objects are stored under `tenants/<organisationId>/…`. The storage service refuses any key outside the caller's folder or containing path tricks, and the database refuses a file record whose key is outside its organisation's folder.                                                                             | `StorageService`, `files_storage_key_in_tenant_folder` |
| 8   | Least privilege          | `app_tenant` cannot bypass RLS, cannot read password hashes or session data, and can only read and append (never change or delete) audit events.                                                                                                                                                                     | migration 0002 grants                                  |

## What belongs to a tenant

| Record                                                                     | Table                   | Tenant link                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Organisation (name, unique slug, status, timestamps, current subscription) | `organisations`         | is the tenant                                                                                                                      |
| Branding configuration                                                     | `organisation_branding` | `organisation_id` (primary key)                                                                                                    |
| Subscription records                                                       | `subscriptions`         | `organisation_id`; `organisations.current_subscription_id` must belong to the same organisation                                    |
| Users                                                                      | `users`                 | Global: one account can belong to several organisations. Under RLS a tenant sees only its own members' id, email, name and status. |
| Memberships and roles                                                      | `memberships`           | `organisation_id`                                                                                                                  |
| Invitations                                                                | `invitations`           | `organisation_id`                                                                                                                  |
| Constitutions                                                              | `constitutions`         | `organisation_id`                                                                                                                  |
| Document versions                                                          | `constitution_versions` | `organisation_id` + same-tenant link to constitution and source file                                                               |
| Uploaded files                                                             | `files`                 | `organisation_id` + storage key inside `tenants/<organisation_id>/`                                                                |
| Extracted text                                                             | `extracted_texts`       | `organisation_id` + same-tenant links                                                                                              |
| Sections and clauses                                                       | `sections`              | `organisation_id` + same-tenant links to version and parent section                                                                |
| AI retrieval chunks                                                        | `section_chunks`        | `organisation_id` + same-tenant links                                                                                              |
| AI conversations                                                           | `ai_conversations`      | `organisation_id` + owning user (private to that user)                                                                             |
| AI answers                                                                 | `ai_messages`           | `organisation_id` + same-tenant link to conversation                                                                               |
| AI citations                                                               | `ai_citations`          | `organisation_id`; may only cite a section of the same organisation                                                                |
| Content approvals                                                          | `content_approvals`     | `organisation_id` + same-tenant link to version                                                                                    |
| Usage records                                                              | `usage_records`         | `organisation_id`                                                                                                                  |
| Audit records                                                              | `audit_events`          | `organisation_id` (empty for platform-level events, which tenants never see)                                                       |

Deliberately global tables: `organisations`, `users`, `sessions`, `password_reset_tokens`,
`auth_rate_limits`. An automated **guardrail test** fails if any other table is added without a
NOT NULL `organisation_id`, RLS and a tenant policy.

## Search and AI retrieval

Search and AI retrieval run through `SearchService` inside a tenant transaction, filter by the
caller's organisation, and use **published** versions only. The AI can therefore only ever be given
passages from the asking organisation's approved constitution. AI conversations are additionally
private to the person who started them.

## What runs outside tenant transactions (and why)

Some work happens before a tenant is known, or is platform-wide. It runs as the database owner
with explicit organisation filters and is covered by tests:

- sign-in, sessions, password reset (global accounts);
- the membership lookup in `PermissionGuard` that _establishes_ the tenant;
- invitation creation and acceptance, and member role changes (with organisation filters and row locks);
- Platform Super Admin operations (creating organisations, suspending accounts, the platform audit log);
- writing audit events.

## Deployment requirements

- The API's database account must own the tables (or have `BYPASSRLS`) for the platform-level work
  above, and must be allowed to `SET ROLE app_tenant`. Migration 0002 grants this automatically when
  run by a non-superuser that is allowed to; on some managed databases an administrator must run
  `GRANT app_tenant TO <api account>` once.
- `app_tenant` is a database-cluster-wide role name. If several environments share one database
  server, they share this role (it holds no data; its policies are per database).

## Tests

`apps/api/test/tenancy.e2e.spec.ts` creates two fictional organisations with complete data
(branding, subscription, constitution with published and draft versions, file, extracted text,
sections, AI chunks, a conversation with a cited answer, approval, usage, audit events). It then
deliberately attempts to:

- read organisation B's records through organisation A's URLs, and through B's URLs as A's owner;
- write into organisation B (branding, invitations, AI);
- smuggle B's ID in the request body, query string and headers;
- find B's text through search and AI retrieval;
- download B's files, and read B's storage keys directly through the storage service;
- read B's audit events;
- read or write B's rows inside a tenant transaction, and read password hashes or delete audit events;
- create records that link to B's records (sections, citations, subscriptions, file keys).

Every attempt must fail. A sanity test confirms organisation B can read all the same URLs itself,
so the refusals are real. A guardrail test checks every table's tenant column and RLS policy.

## Known limitations

1. **RLS is defence in depth for tenant data paths, not yet for the whole API.** The platform-level
   paths listed above run as the table owner, which bypasses RLS. A later hardening step can move the
   API to a non-owner account and run platform work through narrowly granted functions.
2. **Cloud object storage** (an S3-compatible service with per-tenant prefixes and short-lived signed
   links) replaces local-disk storage in the deployment stage. The tenant-prefix rule carries over.
3. **Uploads** through the API (with malware scanning) arrive in the secure-upload stage; until then
   files are created only by trusted server code (seed data, tests).
4. **Embeddings / vector search** are not used yet; when added, vector queries go through the same
   tenant transaction and organisation filter as keyword search.
5. **Caches and background jobs** do not exist yet. When added, cache keys must include the
   organisation ID and jobs must carry a `TenantScope` created by trusted code.
