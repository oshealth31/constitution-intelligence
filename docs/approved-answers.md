# Approved answers

An organisation can answer common questions about its constitution **in everyday words**, link
each answer to the clauses it comes from, and approve it before members see it. This works with
AI switched off (the default): answers are written by people, or imported from a file — for
example drafts prepared with AI outside the platform — and an owner or administrator studies and
approves every one.

**Approved answers are not legal advice** and are not decisions of the organisation. Members
always see that note, and the original wording of the clauses, next to every answer.

## Who can do what

| Role                                 | Write, edit, import drafts | Approve, retire | See approved answers |
| ------------------------------------ | -------------------------- | --------------- | -------------------- |
| Owner, Administrator                 | Yes                        | Yes             | Yes                  |
| Content reviewer                     | Yes                        | No              | Yes                  |
| Member, Auditor and other read roles | No                         | No              | Yes                  |

The same person may write and approve an answer (small organisations often have one
administrator). Who approved it, and when, is recorded, and the audit log notes whether the
approver also wrote it.

## The workflow

```
 write / import ──► Draft ──(checks pass + "I have read this" ticked)──► Approved ──► members see it
                      ▲                                                      │
                      └──────────────── editing returns it to Draft ─────────┘
 Approved ──(new constitution version changes a linked clause)──► Needs review (hidden)
 any ──► Retired (hidden) ──► Restore as draft        Delete: drafts, needs review, retired only
```

- **Draft** — being written. Members never see drafts.
- **Approved** — shown to members, but only while every linked clause is part of a current
  published version (checked again every time an answer is shown).
- **Needs review** — the constitution was updated and a linked clause changed or disappeared.
  Hidden from members until someone re-links the clause, checks the wording and approves it again.
- **Retired** — no longer shown. An approved answer must be retired before it can be deleted.

### Automatic checks

Run every time an answer is shown to someone managing it, and again on approval:

| Check                                              | Effect                     |
| -------------------------------------------------- | -------------------------- |
| No clause linked                                   | Blocks approval            |
| A linked clause is not in the current published version | Blocks approval       |
| The answer mentions a clause number that is not linked (e.g. "Clause 12") | Blocks approval |
| The answer contains an amount not in the linked clauses ("14 days", "half", "two-thirds") | Warning for the approver |

Amounts are compared in one form: "fourteen" and "14", "two thirds" and "2/3", "half" and "50%"
count as the same. The checks catch mechanical mistakes only; **they cannot tell whether an answer
is a fair reading of the clauses**. That is what the person approving it is for, which is why they
must tick: *"I have read this answer against the original clauses. It says nothing the clauses do
not say, and it is not legal advice."*

### When a new version is published

Inside the same database transaction that publishes the new version, every answer linked to the
replaced version is looked at clause by clause:

- a clause with the **same reference and exactly the same wording** (heading and text) in the new
  version: the link moves to the new clause and the answer stays approved;
- otherwise: the answer becomes **Needs review**, with a note naming the clauses to check.

Nothing is rewritten automatically. The publish audit event records how many answers were carried
over and how many need review.

## Importing drafts

Manage → Approved answers → *Import drafts from a file*. A `.json` file, at most 200 answers:

```json
{
  "answers": [
    {
      "question": "How much notice is needed for the annual general meeting?",
      "answer": "Members must get at least 21 days' written notice.",
      "clauses": ["6"],
      "draftedBy": "ai"
    }
  ]
}
```

- `clauses` are references as shown in the reader: `"7"`, `"7(a)"`, `"Clause 10"`, `"Part 2"`.
  They are matched to the **current published** constitution. A reference that cannot be found
  (or appears in more than one published document) is listed on the draft, which then cannot be
  approved until it is fixed.
- `"draftedBy": "ai"` labels the draft *"Drafted by AI – check every word against the original"*;
  the review page also shows a warning. Anything else is labelled *Imported*.
- Importing never approves anything.

**Data protection:** if drafts are prepared with an AI service outside Botswana, the text given to
it leaves the country. Constitutions are usually organisational documents rather than personal
data, but remove any personal details (names, phone numbers, addresses) before sharing one. See
the data protection note in [ai.md](ai.md).

## What members see

On **Ask** (or **Find clauses** when AI is off):

- when they type a question, matching approved answers come first, under *"Answered by
  [organisation]"* — each with the label *"Approved by [organisation]"*, the answer, the
  not-legal-advice note, the original clauses word for word, and links to read them in the
  constitution;
- before they type anything, a **Common questions** list of every approved answer.

Matching uses the words of the stored question (at least 40% of the meaningful words in the
member's question must appear in it), so a question in different words may not find an answer
that exists; the clause search or AI answer is still shown underneath.

## API

Members (`constitution.read`), under `/api/v1/organisations/:id`:

| Method & path                     | Notes                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `GET /answers`                    | `{ disclaimer, answers[] }` — approved and current only     |
| `GET /answers/match?question=...` | Up to 3 matching approved answers                           |

Managing, under `/api/v1/organisations/:id/manage/answers`:

| Method & path                         | Permission        | Notes                                                    |
| ------------------------------------- | ----------------- | -------------------------------------------------------- |
| `GET /`                               | `content.edit`    | All answers with linked clauses, check results, status   |
| `POST /` `{ question, answer, clauses[] }` | `content.edit` | Creates a draft; unknown clauses are refused (400)     |
| `POST /import` `{ answers[] }`        | `content.edit`    | Creates drafts; returns unresolved references per row    |
| `GET /:id`, `PATCH /:id`              | `content.edit`    | Editing returns the answer to draft                      |
| `DELETE /:id`                         | `content.edit`    | Not for approved answers (retire first)                  |
| `POST /:id/approve` `{ confirmed }`   | `content.approve` | 409 while a blocking check fails; 400 without confirmation |
| `POST /:id/retire`                    | `content.approve` |                                                          |
| `POST /:id/restore`                   | `content.edit`    | Retired → draft                                          |

Every change is recorded in the audit log (`answer.created`, `answer.updated`, `answer.imported`,
`answer.approved`, `answer.retired`, `answer.restored`, `answer.deleted`) with ids and counts only,
never the question or answer text.

## Data

Migration `0006_approved_answers.sql`: `approved_answers` and `approved_answer_sections`, both with
Row-Level Security (an organisation can only read and write its own rows) and composite foreign
keys that make it impossible to link another organisation's clause.

## Tests

- `apps/api/src/modules/answers/answer-checks.spec.ts` — the checks.
- `apps/api/test/approved-answers.e2e.spec.ts` — drafting, checks, permissions, approval and what
  members see, editing, retiring and deleting, importing, organisation separation, and carrying
  answers over (or holding them back) when a new version is published.
- `apps/web/e2e/approved-answers.spec.ts` — in a browser: write → study → approve → a member sees
  it with the disclaimer; imported AI drafts are labelled and hidden from members; content
  reviewers cannot approve.

## Known limitations

- Matching a member's question to an approved answer is by words, not meaning.
- The checks are mechanical. An answer can pass them and still be misleading; only the approver's
  reading prevents that.
- Clauses are linked by number. Clauses with no number cannot be linked yet.
