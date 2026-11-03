# Simple words

Some members find legal wording hard. An organisation can write each clause again in **simple,
everyday words**. Members switch on **Simple words** in the reader and see the simple version
**under** the original clause — never instead of it.

Simple words are **not legal advice**, and **the original wording is what counts**. The reader
says so above the text whenever simple words are switched on, and each simple-words box is
labelled _"Simple words · the original wording above is what counts"_.

## Who can do what

| Role                 | Write, edit, import | Approve, withdraw | See approved simple words |
| -------------------- | ------------------- | ----------------- | ------------------------- |
| Owner, Administrator | Yes                 | Yes               | Yes                       |
| Content reviewer     | Yes                 | No                | Yes                       |
| Other roles          | No                  | No                | Yes                       |

As with approved answers, the same person may write and approve; who approved and when is
recorded.

## The workflow

Manage → **Simple words** lists every clause (with text) of the current published constitution,
with filters: all, no simple words yet, waiting for approval, approved.

- **Write simple words** → saved as a **Draft**. Members never see drafts.
- The same **automatic checks** as approved answers run against the one clause: mentioning
  another clause number blocks approval; an amount not in the clause ("half", "14 days") is a
  warning. They cannot judge whether the words are a fair rewording — the approver does.
- An owner or administrator ticks _"I have read these simple words against the original clause.
  They say nothing the clause does not say."_ and approves. AI drafts carry an extra warning.
- **Editing** approved simple words makes them a draft again (hidden until re-approved).
- **Withdraw** turns approved simple words back into a draft. Approved ones must be withdrawn
  before they can be deleted.
- Headings with no text of their own (for example a Part title) cannot have simple words.
- Only clauses of the **current published** version can be given simple words.

### When a new version is published

In the same transaction that publishes the new version, each clause that had simple words gets a
copy on the matching clause of the new version (same kind and reference):

- **exactly the same wording** (heading and text): the copy keeps its status, so approved simple
  words stay approved;
- **changed wording**: the copy is **Needs review** — hidden from members, with a note saying
  which clause changed — until someone checks it against the new wording and approves it.

The replaced version keeps its own simple words unchanged, for the record. Members are only ever
shown simple words for the current published version.

## Importing

Manage → Simple words → _Import simple words from a file_. A `.json` file, at most 500 items:

```json
{
  "items": [
    {
      "clause": "7",
      "text": "At least one third of members must be there for a general meeting to make decisions.",
      "draftedBy": "ai"
    }
  ]
}
```

Items are matched to clauses of the current published constitution by reference. An item is
**skipped** (and listed) when the clause cannot be found, is found in more than one published
document, is a heading with no text, or already has **approved** simple words (importing never
replaces approved text). Everything imported is a draft. `"draftedBy": "ai"` labels it as drafted
by AI.

See the data protection note in [ai.md](ai.md) before sharing a constitution with an AI service
outside Botswana.

## API

| Method & path (under `/api/v1/organisations/:id`)                       | Permission          | Notes                                                              |
| ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `GET /simple-words?versionId=`                                          | `constitution.read` | `{ disclaimer, items[] }` — approved only, published versions only |
| `GET /manage/simple-words`                                              | `content.edit`      | Every clause of the published versions with its simple words       |
| `PUT /manage/simple-words/sections/:sectionId` `{ text }`               | `content.edit`      | Creates or replaces; always a draft afterwards                     |
| `DELETE /manage/simple-words/sections/:sectionId`                       | `content.edit`      | Not for approved ones (withdraw first)                             |
| `POST /manage/simple-words/sections/:sectionId/approve` `{ confirmed }` | `content.approve`   | 409 while a blocking check fails                                   |
| `POST /manage/simple-words/sections/:sectionId/withdraw`                | `content.approve`   | Approved → draft                                                   |
| `POST /manage/simple-words/import` `{ items[] }`                        | `content.edit`      | Returns `saved[]` and `skipped[]` with reasons                     |

Audit events: `simple_words.saved`, `.imported`, `.approved`, `.withdrawn`, `.deleted` — ids and
counts only, never the text.

## Data

Migration `0007_simple_words.sql`: `simplified_sections`, one row per clause, with Row-Level
Security and a composite foreign key to the organisation's own clause.

## Tests

- `apps/api/test/simple-words.e2e.spec.ts` — published clauses only, drafts hidden, checks,
  approval roles and confirmation, editing and withdrawing, headings/draft versions/other
  organisations refused, importing (AI label, skipped items), organisation separation, and the
  carry-over on publishing.
- `apps/web/e2e/simple-words.spec.ts` — write → check warning → tick → approve; a member switches
  on Simple words in the reader and sees them under the original with the notice.

## Known limitations

- The checks are mechanical; only the approver can judge whether the simple words are faithful.
- A clause is matched across versions by its number; if clauses are renumbered, simple words are
  not carried over and need writing again.
