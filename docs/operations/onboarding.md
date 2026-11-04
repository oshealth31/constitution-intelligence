# Onboarding an organisation

Who does what when a new organisation (for example RBPC) joins. Steps 1–4 are Constitution
Intelligence staff in the **Control Centre**; the rest is the organisation in its **portal**.
More detail on each screen: [control-centre.md](../control-centre.md), [documents.md](../documents.md),
[approved-answers.md](../approved-answers.md), [simple-words.md](../simple-words.md),
[subscriptions.md](../subscriptions.md).

**Before starting:** a signed agreement with the organisation covering the service, fees and
data protection (who is the controller and who the processor of members' data). The template
is still to be written (open requirement in production-readiness.md).

| #   | Who              | Step                                                                                                                                                                 | Checks                                                                                               |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Super Admin      | Control Centre → Organisations → **New organisation**: name and portal address (for example `rbpc`). It starts on a pilot subscription with an onboarding checklist. | Address is short, lower-case, not taken                                                              |
| 2   | Super Admin      | **Subscription**: choose the plan, monthly/annual, dates. Issue the first invoice if not a free pilot.                                                               | Plan limits fit the organisation's size                                                              |
| 3   | Super Admin      | **Branding**: name, colours, welcome message (or leave to the owner).                                                                                                | The contrast warnings are clear                                                                      |
| 4   | Super Admin      | **Invite the owner**: their email address. They get a one-time link (7 days).                                                                                        | **Needs a working email provider**, which is not integrated yet (blocker in production-readiness.md) |
| 5   | Owner            | Accept the invitation, choose a password, sign in at `/o/<address>`.                                                                                                 |                                                                                                      |
| 6   | Owner/Admin      | Manage → Documents → upload the registered constitution (PDF or Word).                                                                                               | The original is kept unchanged                                                                       |
| 7   | Content Reviewer | Check the extracted text section by section against the paper copy; correct and confirm every flagged section; send for approval.                                    | Clause numbers, sub-clauses, schedules                                                               |
| 8   | Owner/Admin      | Approve, then **Publish**. Members see only published versions.                                                                                                      | Publishing is a separate, confirmed step                                                             |
| 9   | Owner/Admin      | Optional: import or write **approved answers** and **simple words**; read each against the clause; approve.                                                          | The "not legal advice" note shows                                                                    |
| 10  | Owner/Admin      | Invite members (or reviewers, auditors), in batches. Limits: plan member limit; 50 invitations per hour.                                                             | Roles: least privilege                                                                               |
| 11  | Owner            | Manage → Subscription: check plan, invoice, payment instructions; report payments with their reference.                                                              | Super Admin verifies against the bank or mobile-money statement                                      |
| 12  | Super Admin      | Onboarding checklist complete; note the go-live date in the change log.                                                                                              |                                                                                                      |

**RBPC specifically:** the typed constitution (`RBPC-Constitution-typed.docx`), 25 draft answers
and 56 draft simple-words items were prepared earlier. They are drafts: the RBPC
administrator must read and approve each one. Clause 14.1.3 needs a manual check in step 7
(known parser limitation).
