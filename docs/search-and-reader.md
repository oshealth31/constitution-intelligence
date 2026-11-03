# Search and the constitution reader

Members find rules in three ways from **Search** (`/o/<address>/search`) and read them in the
**reader** (`/o/<address>/read/<document>`).

## What can be searched

| Type of search  | Examples                                                                    | How it works                                                                                      |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Clause number   | `7`, `clause 7`, `section 7`, `cl. 7`, `§7`, `7(a)`, `2a`, `4.2`, `7(a)(i)` | The query is read as a reference and compared with each section's reference (below). Shown first. |
| Part or chapter | `Part 3`, `part III`, `part three`, `Chapter 2`                             | Compared with the stored part/chapter number.                                                     |
| Section title   | `Quorum`, `general meeting`                                                 | An exact title comes first, then titles containing the words.                                     |
| Keyword         | `one third`, `two-thirds majority`, `"general meeting" -fees`               | PostgreSQL full-text search over the number, heading and text (quotes, `OR` and `-word` work).    |

Results are listed in that order, without duplicates (up to 30). Each result shows:

- the document and its **version**: label, version number and date it became current;
- where the section sits, for example "Part 3 · Meetings and decisions";
- its title, plus a reference badge such as "Clause 2(a)";
- a short **excerpt of the original wording** with the search words highlighted;
- the page of the original document, when known.

When nothing is found, the page explains why:

- a clause number that does not exist: "There is no clause 99 in the current constitution";
- similar section titles for misspellings ("Did you mean: Quorum?"), using trigram similarity
  over the organisation's own current headings;
- practical tips, and a link to browse the whole document.

## Rules

- **Only approved, current content:** search covers only the _published_ version of each
  document, whatever the person's role. Drafts, versions in review, approved but not yet published
  versions, and superseded or archived versions are never searched. Reviewers open drafts from
  Manage → Documents, not through search.
- **Only the organisation's own content:** every query runs in the organisation's database scope
  (Row-Level Security) **and** filters by organisation. The optional `constitutionId` filter must
  belong to the organisation (otherwise "not found").
- **Original wording is never rewritten:** results and the reader show numbers, headings and text
  exactly as stored. An excerpt is an exact slice of the text, with "…" where text was left out.
  Highlighting only adds `<mark>` around matching words, shown as plain text, never HTML.
- **No invented titles or numbers:** references are worked out only from the numbers stored for a
  section and its parents (`apps/api/src/modules/constitutions/references.ts`). For example, "(a)"
  inside clause 7 is "Clause 7(a)", and "5.1" stays "5.1". A section without a stored number has
  no reference. No AI is used anywhere in search or reading.

## The reader

- The whole document in reading order, with a **Contents** list: a sidebar on large screens and a
  pop-up sheet on phones.
- A **section bar**: Previous / Next buttons that step through parts and clauses, and "where am I"
  ("Clause 7 · Quorum (10 of 14)"), which follows scrolling.
- **Version shown** at the top, e.g. "Current approved version · Version 1: Registered
  constitution · published 2 Nov 2026". Reviewers can switch versions and see a warning on
  unpublished ones.
- Arriving from a search result: the section is outlined, the search words are highlighted, a
  "Back to search results" link appears, and highlighting can be cleared.
- A **reference card** under the selected section. For example: "Constitution of …, Registered
  constitution (version 1), Clause 2(a)". It also gives the page of the original document when
  known, and has **Copy reference** and **Open the original document** buttons.
- **Download the original document** at the top, saying that the original is the official text.
- Text size buttons (A− / A+), big touch targets and the phone bottom navigation from Stage 6.

## API

`GET /api/v1/organisations/:id/search?q=…[&constitutionId=…]` (permission `constitution.read`).
`q` must be 1–200 characters, and a single character only when it is a digit.

```json
{
  "query": "clause 2(a)",
  "interpretedAs": { "type": "clause", "display": "Clause 2(a)" },
  "terms": ["clause", "2"],
  "results": [{
    "refKey": "objectives-a", "number": "(a)", "heading": null,
    "reference": "2(a)", "referenceLabel": "Clause 2(a)",
    "path": [{ "refKey": "part-1", "number": "Part 1", "heading": "Name and objectives" }, …],
    "excerpt": "to promote choral singing in the community;", "matchedBy": "reference",
    "sourcePage": null, "constitutionId": "…", "constitutionTitle": "…",
    "versionId": "…", "versionNumber": 1, "versionLabel": "Registered constitution", "publishedAt": "…"
  }],
  "suggestions": []
}
```

`GET /versions/:versionId/sections` now also returns each section's `reference`,
`referenceLabel` and `sourcePage`.

## Tests

- `apps/api/src/modules/constitutions/references.spec.ts`: references from stored numbers, query
  parsing (clause, sub-clause, part; what is _not_ a reference), terms, and that excerpts are exact
  slices.
- `apps/api/test/search.e2e.spec.ts`:
  - search accuracy by title, keyword, clause number in many spellings, sub-clause and part;
  - ranking, misspelling suggestions and no-results answers;
  - excerpts that are verbatim slices, and correct references in the reader data;
  - permissions and query checks, and tenant isolation (text, numbers and document filter);
  - version correctness: drafts, in-review and approved-but-unpublished versions are never
    searched, and search switches to the new wording and numbers the moment a new version is
    published.
- `apps/web/src/lib/portal.test.ts`: highlighting never changes text, and citations.
- `apps/web/e2e/search-reader.spec.ts`:
  - clause-number search with the reference and version shown, and previous/next navigation;
  - sub-clause search;
  - helpful no-results messages and suggestions;
  - the phone layout.

## Known limitations

- Keyword search matches whole words without stemming, so "meeting" does not find "meetings". The
  tips suggest trying another form; language-aware stemming can come with the AI stage.
- Words are highlighted wherever they start a word, which can include words the search engine did
  not use to rank (for example after `-word`).
- The original document opens as a download. The reader gives the page number, but cannot jump
  to that page inside the PDF.
