# Subscriptions, entitlements and billing

Constitution Intelligence is a managed service. Each organisation has one **subscription** to a
**plan**. The plan decides which features the organisation gets and how much it may use; the
subscription's state decides whether it may use the portal at all. **All of this is enforced by
the API on every request** — the web app only explains it.

**There is no payment provider.** No card details are taken or stored. Invoices are issued by
Constitution Intelligence staff, organisations report payments they made (bank transfer, mobile
money …), and a payment only counts once a Platform Super Admin has **verified it by hand**
against the bank or mobile-money statement. Integrating a payment provider is a separate decision
that needs approval first.

## Plans

Configured by Platform Super Admins in the control centre (**Plans**). Each plan has:

| Setting                | Meaning                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Monthly / annual price | In BWP. Empty = not offered (or not decided yet).                                                                             |
| Grace period           | Days of full access after a period ends or an invoice falls due (0–90).                                                       |
| Features               | AI answers, approved answers, simple words, custom branding. Reading, search and "find relevant clauses" are always included. |
| Limits                 | Members (incl. pending invitations), documents, AI questions per month, storage. Empty = no limit.                            |
| Pilot                  | A pilot plan is not billed.                                                                                                   |
| Offered                | Inactive plans stay valid for existing subscriptions but cannot be chosen for new ones.                                       |

Migration `0008_subscriptions.sql` creates three starting plans — **Pilot** (`trial`), **Standard**
and **Premium** — **without prices**: prices are a business decision to be entered in the control
centre. Plan codes already used by existing subscriptions are kept as inactive "legacy" plans with
every feature.

## Subscription states (what the API allows)

Worked out on every request from the subscription, its plan, its invoices and the date
(`apps/api/src/modules/subscriptions/access.ts`). There is no background job that could fall behind.

| State          | When                                                                              | Who can do what                                                                                               |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Pilot**      | Status "trialing", period not ended                                               | Everything in the plan                                                                                        |
| **Active**     | Paid plan, period not ended, no overdue invoice                                   | Everything in the plan                                                                                        |
| **Grace**      | The period ended, or an invoice is past due, but the grace period has not run out | Everything in the plan, with a warning                                                                        |
| **Restricted** | The grace period has run out                                                      | Owners and administrators can **read** (content and billing); nothing can be changed; other roles are refused |
| **Suspended**  | Suspended by a Super Admin (with a reason)                                        | Only the billing page (Owners, Administrators, Auditors) and the portal's notice                              |
| **None**       | No subscription                                                                   | As suspended                                                                                                  |

- A subscription **lapses** at the earliest of: the end of its period, the due date of its oldest
  unpaid invoice, or (for a cancellation with no period end) the cancellation time.
- A payment that has been **reported but not verified does not stop the clock**.
- **Cancellation** is either at the end of the period (access continues until then, then grace)
  or immediate (grace starts now). Both need a reason.
- Refusals carry a machine-readable `reason`: `SUBSCRIPTION_INACTIVE`, `SUBSCRIPTION_READ_ONLY`,
  `FEATURE_NOT_IN_PLAN` or `PLAN_LIMIT_REACHED`.

### How it is enforced

- `PermissionGuard` (which already checks membership and role for every organisation route) loads
  the access state and refuses requests the state does not allow. Routes that must work anyway are
  marked `@AllowInactiveSubscription()`: the billing endpoints and the portal home (so members are
  told why the portal is unavailable).
- `@RequireFeature('ai_answers' | 'approved_answers' | 'simple_words' | 'custom_branding')` on
  routes and controllers refuses features the plan does not include.
- `LimitsService.assertWithinLimit` is called before inviting a member, creating a document,
  uploading a file and asking an AI question.
- The web app hides what the plan does not include, but that is only for convenience.

## Billing: invoices, payments and receipts

| Step             | Who                                            | What happens                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue an invoice | Super Admin                                    | Invoice `INV-YYYY-NNNN` with amount, due date and description. **Renewing** a subscription issues the invoice for the new period automatically when the plan has a price for that interval.                  |
| Report a payment | Organisation **Owner** (Manage → Subscription) | Amount, method (bank transfer, mobile money, cash, cheque, other), reference and date. Status: _waiting for verification_. The invoice stays unpaid.                                                         |
| Record a payment | Super Admin                                    | Same, for a payment they were told about. Still needs verifying.                                                                                                                                             |
| **Verify**       | Super Admin                                    | Must tick _"I have checked the bank or mobile-money statement and this payment has arrived."_ The payment gets a receipt number `RCP-YYYY-NNNN`; the invoice is marked paid once verified payments cover it. |
| Not verified     | Super Admin                                    | With a reason. The invoice stays unpaid.                                                                                                                                                                     |
| Void             | Super Admin                                    | With a reason; not possible once a payment on it has been verified.                                                                                                                                          |

Safeguards:

- Text that looks like a payment card number (13–19 digits passing the Luhn check) is refused in
  payment references and notes, in the browser and on the server.
- The organisation's database role can only insert a payment report's own fields: it cannot set
  the status, the verifier or the receipt number. A database check also requires every _verified_
  payment to have a verifier, a verification time and a receipt number.
- Invoices, payments and the billing history are tenant tables with Row-Level Security; an
  organisation can only read its own.
- Every step is written to the organisation's **billing history** (shown to the organisation) and
  to the **audit log** (`invoice.issued`, `payment.reported`, `payment.verified`, …).

## Super Admin controls

Control centre → an organisation:

- **Subscription**: plan, pilot or active, monthly/annual billing, period end, renews or not.
- **Billing**: the access state and why; usage against limits; **Renew for the next period**;
  **Suspend** / **Reactivate** / **Cancel subscription** (each with a reason); invoices; payment
  verification; full billing history.

Control centre → **Billing**: payments waiting for verification, overdue invoices, periods ending in
the next 14 days, and restricted or suspended organisations with their data-retention dates.

Control centre → **Plans**: create and edit plans.

Nothing renews by itself: a Super Admin renews a subscription (the list of periods ending soon is
the reminder). This avoids charging anyone automatically while there is no payment provider.

## Data retention after expiry or cancellation

1. While the subscription is active, in a pilot, or in its grace period, everything works.
2. When the grace period runs out, access is **restricted**. **Nothing is deleted.**
3. The organisation's data is kept **unchanged for `SUBSCRIPTION_DATA_RETENTION_DAYS` (default 90)
   days** from that moment, so it can renew or ask for a copy of its documents. The date is shown on
   its billing page and in the control centre.
4. After that, the organisation appears as **"due for deletion review"** in the control centre.
   A Super Admin contacts the owner before anything is deleted. **There is no automatic deletion.**
5. Invoices, payments and receipts are financial records and are kept even if the rest of the data
   is deleted. (Deleting an organisation's data is not built yet; it will be a separate, deliberate
   step.)

**To confirm with the business and a legal/data-protection adviser:** the length of the retention
period, how long financial records must be kept, and how a data copy is provided on request.

## API

Organisations (`/api/v1/organisations/:id`):

| Method & path                                | Permission                                     | Notes                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /billing`                               | `billing.read` (Owner, Administrator, Auditor) | Access state, plan, usage, invoices with payments and receipts, billing history, payment instructions, retention policy |
| `POST /billing/invoices/:invoiceId/payments` | `billing.manage` (Owner)                       | Report a payment. 409 if one is already waiting                                                                         |
| `GET /portal`                                | `organisation.read`                            | Now includes `subscription` (state, message, features)                                                                  |

Platform (`/api/v1/platform`, Super Admins only): `GET/POST /plans`, `PATCH /plans/:code`,
`GET /billing/attention`, `GET /organisations/:id/billing`, `PUT /organisations/:id/subscription`,
`POST /organisations/:id/subscription/{suspend,reactivate,cancel,renew}`,
`POST /organisations/:id/invoices`, `POST /organisations/:id/invoices/:invoiceId/{void,payments}`,
`POST /organisations/:id/payments/:paymentId/{verify,reject}`.

## Tests

- `apps/api/src/modules/subscriptions/access.spec.ts` — every state and the rules between them.
- `packages/shared/test/subscriptions.test.ts` — card-number detection, money formatting.
- `apps/api/test/subscriptions.e2e.spec.ts` — access restrictions per state and role, suspension
  and reactivation, cancellation, no subscription, plan features refused on the server, usage
  limits, the whole manual payment flow (including refusing card numbers, unverified payments not
  counting, rejected payments, a forged "verified" row refused by the database), organisation
  separation, Super Admin-only controls, renewal with invoicing, validation, and retention.
- `apps/web/e2e/billing.spec.ts` — invoice → owner reports a payment → Super Admin verifies →
  receipt; members of a suspended organisation see the notice and the API refuses the content.

## Known limitations

- Usage counts are checked when something is added; lowering a plan's limit does not remove
  anything already there.
- AI questions are counted per calendar month in UTC.
- The "attention" list works out each organisation's state one by one; fine for hundreds of
  organisations, to be optimised later if needed.
- Invoices are records, not formatted documents (no PDF yet).
