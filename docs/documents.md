# Constitution document management

Organisations upload their constitution as a **PDF** or **Word (.docx)** file. The platform reads
the text and works out its structure: parts, clauses, sub-clauses and their numbers. Anything it is
unsure about is flagged for a person to check. The organisation then checks and corrects the text
and approves it. Members see it only after it is published as the current version.

Where to find it: **Manage → Documents** in the organisation portal (`/o/<address>/manage/content`).

## The version workflow

```
upload ──► Draft ──► In review ──► Approved ──► Published (current) ──► Superseded
             ▲           │                                                   │
             └─ changes ─┘                 any non-current version ──► Archived
                requested
```

| Step                   | Who                                    | Rules                                                                                                                                     |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Upload                 | Owner, Administrator, Content Reviewer | Always creates a new **draft** version. Never published automatically.                                                                    |
| Check and correct      | Owner, Administrator, Content Reviewer | Drafts only. Edit number, heading, text and type; add or remove sections; mark flagged sections as checked.                               |
| Send for approval      | Owner, Administrator, Content Reviewer | Refused while any section is still flagged, if the text could not be read, or without confirming the text was compared with the original. |
| Approve / send back    | **Owner, Administrator**               | "Send back" needs a reason and returns the version to draft.                                                                              |
| Make current (publish) | **Owner, Administrator**               | Only an approved version, with explicit confirmation. The previous current version becomes **superseded**, unchanged.                     |
| Archive                | **Owner, Administrator**               | Any version except the current one, with a reason.                                                                                        |

Members and Auditors can read only the published (current) version, and download its original.

**Change from Stage 3:** approval is now the organisation administrator's decision.
Administrators gained `content.approve`. Content Reviewers lost it, but gained `content.edit`, so
they can correct extracted text and send it for approval. Owners keep every permission.

### Approved content cannot be overwritten

Apart from the API checks, the **database itself** enforces these rules (migration 0004):

- new versions must start as drafts;
- a version can only move along the arrows above (for example, published → draft is refused);
- once a version has left draft, its label, number, source file and extraction results are fixed;
- sections can only be added, changed or removed while their version is a draft;
- a file that is the original of any version cannot be deleted.

To change an approved or published constitution, upload (or create) a new version and take it
through the same steps.

## Upload checks

Each check runs before anything is stored or opened:

- **Type:** only `.pdf` and `.docx`. Old `.doc` and macro-enabled `.docm` files are refused, as is
  every other type.
- **Contents must match the name:** a `.pdf` must really be a PDF (`%PDF-`) and a `.docx` must be a
  Word package. The type the browser claims is ignored.
- **Size:** at most `DOCUMENT_MAX_BYTES` (default 10 MB). Empty files are refused.
- **PDFs** containing scripts (`/JavaScript`) or launch actions are refused, as are
  password-protected or damaged PDFs and PDFs over 500 pages.
- **Word files** with macros are refused. Encrypted or unusual ZIP formats, archives with too many
  parts, and archives that would expand to an unreasonable size ("zip bombs") are also refused.
- **Read in a sealed-off worker (Task D8).** The text is read in a separate worker thread for each
  document, never in the main server: with a memory limit (`DOCUMENT_PARSE_MEMORY_MB`, default
  256 MB) and a hard time limit (`DOCUMENT_PARSE_TIMEOUT_SECONDS`, default 60) after which the
  worker is stopped outright, even in the middle of one page. The worker gets no settings or
  secrets from the server. At most `DOCUMENT_PARSE_CONCURRENCY` (default 2) documents are read at
  once per copy of the API and 10 more may wait; beyond that the upload is refused with "The
  system is busy reading other documents. Please try again in a minute." (HTTP 429, reason `BUSY`).
  Too slow → `too_slow`; too much memory → `too_complex`, both asking for a re-saved copy.
- Every refusal is recorded in the audit log (`document.rejected`) with the reason code.

## Private storage and the original document

- The original file is stored in the organisation's own private folder
  (`tenants/<organisation id>/documents/<file id>`), recorded with its name, type, size, SHA-256
  fingerprint, uploader and time, and marked as a `constitution_source`.
- It is never served publicly. Downloads go through the API
  (`GET /organisations/:id/versions/:versionId/source`), which checks membership and role.
  Members can download the original of the current version only; reviewers and administrators
  can download any version's original. The file is always sent as a download with `nosniff` and a
  sandbox Content Security Policy.
- The original is the **authoritative source**. The reading view shows a "Download the original
  document" link and says that the original wins if anything differs.

## Text extraction

| Format | How                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PDF    | Mozilla PDF.js (version 6.2.108 or later, which fixes a known script-execution flaw) reads the text layer. JavaScript evaluation, fonts and rendering are all switched off. Lines are rebuilt from positions; repeated headers, footers and page numbers are removed; larger text counts as a heading. |
| DOCX   | Our own small reader: paragraphs, heading styles (Title, Heading 1–2 and outline levels) and Word's automatic numbering ("1.", "(a)", "i."). Text inside deleted tracked changes is left out.                                                                                                          |

The structure reader then recognises:

- parts and chapters ("PART 2 – MEETINGS", "Chapter III");
- numbered clauses ("4.", "Article 4", "Section 4");
- decimal sub-clauses ("4.2", "4.2.1");
- lettered and roman items ("(a)", "a)", "(iv)");
- headings: "4. Quorum. The quorum is…", or a short line after the number;
- unnumbered headings in capitals or a heading style.

### What gets flagged for a person to check

| Flag (on a section)                                                              | Issue (whole document)                                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Numbering gap ("Clause 4 follows 2")                                             | No text could be read (for example a scanned image). Status **failed**, so it cannot be submitted. |
| The same number twice, or numbers out of order                                   | Very little text found                                                                             |
| A list that does not start at its first item, or an item without a parent clause | No structure recognised: the text is kept as one block to divide by hand                           |
| Unreadable characters (replacement characters or `(cid:…)` codes)                | Pages without text (probably scanned pages)                                                        |
| Very long sections (possibly several clauses merged)                             | Word tracked changes present                                                                       |
| Headings with no text under them, or parts with no clauses                       |                                                                                                    |

Extraction status is **Text read** when nothing was flagged, **Needs checking** when anything was,
and **Could not be read** when no text was found or reading failed unexpectedly. In the last case
the original is still stored.

## Audit events

`constitution.created`, `document.uploaded`, `document.rejected`, `content.extracted`,
`content.section_edited`, `content.section_added`, `content.section_removed`,
`content.flag_resolved`, `version.submitted`, `version.approved`, `version.changes_requested`,
`version.published`, `version.archived`.

Each version also has its own history (sent for approval, approved, sent back, made current,
superseded, archived), with who did it, when, and any comment.

## API endpoints (Stage 7)

| Method & path (under `/api/v1/organisations/:id`)                                                                                                        | Permission                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `POST /constitutions` `{ title }`                                                                                                                        | `content.edit`                                         |
| `POST /constitutions/:cid/versions?label=…`: the file as the request body, name in `X-File-Name`                                                         | `content.edit`                                         |
| `GET /constitutions/:cid/history`                                                                                                                        | `content.review`                                       |
| `GET /versions/:vid/review`                                                                                                                              | `content.review`                                       |
| `PATCH /versions/:vid/sections/:sid`, `POST /versions/:vid/sections`, `DELETE /versions/:vid/sections/:sid`, `POST /versions/:vid/sections/:sid/resolve` | `content.edit`                                         |
| `POST /versions/:vid/submit` `{ confirmed: true, comment? }`                                                                                             | `content.edit`                                         |
| `POST /versions/:vid/approve`, `/request-changes`, `/publish` `{ confirmed: true }`, `/archive`                                                          | `content.approve`                                      |
| `GET /versions/:vid/source`                                                                                                                              | `constitution.read` (current version only for members) |

## Tests

- `apps/api/src/modules/documents/documents-units.spec.ts`: file validation, Word reading
  (styles, numbering, tracked changes, macros, zip bombs), PDF reading (pages, scanned pages,
  damaged files), structure detection and every kind of flag, and a check that no text is lost.
- `apps/api/test/documents.e2e.spec.ts`:
  - every kind of refused upload;
  - private storage, and drafts hidden from members;
  - flags and failed extraction;
  - corrections, the submit rules and approval permissions;
  - approved content locked in the API and in the database;
  - publishing and superseding, history, original downloads and archiving;
  - cross-organisation attempts on every endpoint.
- `apps/web/e2e/documents.spec.ts`: the whole journey in a browser (reviewer uploads and checks,
  administrator approves and publishes, member reads and downloads), plus refused files.

## Known limitations

- **No OCR:** scanned PDFs are stored and flagged as unreadable, but their text is not recognised.
- **No malware scanning** (decided for the pilot, Task D8 option A): uploads come only from
  organisation administrators, are checked for type, structure and active content, are read only
  by the text readers inside a limited worker, and are only ever downloaded as attachments. A
  virus scanner (for example ClamAV) can be added later.
- Extraction runs during the upload request. Large documents may take a few seconds. A
  background job queue comes later.
- The structure reader uses patterns, so unusual layouts (tables, two columns, numbering written
  in words) may need more manual correction. Such cases are flagged where they can be detected.
- The person who uploads can also approve, if they are an administrator. Separate people are not
  required, because many small organisations have only one administrator.
- If saving to the database fails after the file was stored, the stored file is left behind
  unused. A clean-up job comes later.
- Through the web app, uploads pass via its `/api/v1` forwarding. Very large files may hit hosting
  limits before the 10 MB application limit.
