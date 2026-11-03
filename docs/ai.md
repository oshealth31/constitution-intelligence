# AI question answering

Members ask questions in their own words at **Ask** (`/o/<address>/ask`). Answers come only from
their organisation's approved, current constitution and always show the original text they rely
on. **The answers can be wrong.** No AI system is perfectly accurate, which is why the original
text and links are always shown next to the explanation, and why every answer is checked on the
server before anyone sees it.

## Without AI: "Find relevant clauses" (the default)

AI answers are **off by default** (`AI_PROVIDER=disabled`), and the plan is to launch that way
until an AI model hosted in Botswana is in place (see "Data protection" below). With AI off:

- The **Ask** menu item becomes **Find clauses** and the home tile becomes **Find relevant
  clauses**. It is the same page (`/o/<address>/ask`).
- Members type a question in their own words. The API (`POST …/ai/find-clauses`) runs the same
  retrieval the AI would use — published versions of the member's own organisation only — and
  returns the matching clauses **exactly as stored**, with the matching words marked and a link to
  each clause in the reader.
- **No AI provider is ever called** for this, whatever `AI_PROVIDER` says, and the question is
  not stored: only a count (`clauses.searches`) goes into the usage records. It is limited to 120
  searches per person per hour.
- The page says plainly that no AI is used and that the clauses may not fully answer the
  question. If nothing matches, it says so ("No matching clauses were found in the approved
  constitution") and points to Search and the committee.

The menu label is only a display choice: the API decides what is available.

## Data protection (Botswana)

With `AI_PROVIDER=anthropic`, questions and constitution passages are sent to Anthropic in the
United States. Botswana's Data Protection Act 18 of 2024 restricts transfers of personal data
outside Botswana, so this mode should not be switched on without legal advice. The intended path
is a self-hosted open-weight model on servers in Botswana, added as another provider behind the
same `AiProvider` interface; every server-side check below would still apply. This is not legal
advice: confirm with a data-protection adviser or the Information and Data Protection Commission.

## How an answer is produced (retrieval-augmented generation)

1. **Retrieval:** we find up to 8 relevant passages. They come only from the **published**
   versions of the caller's own organisation (Row-Level Security plus an organisation filter).
   Drafts, versions in review, approved-but-unpublished, superseded and archived versions are
   never used. Clause numbers in the question ("what does clause 7(a) say?") are matched first,
   then keywords. A passage must share at least a third of the question's meaningful words, or a
   title word. A clause that only introduces its sub-items brings those sub-items with it.
2. **Nothing relevant → no AI call.** The answer is: _"I could not find sufficient information
   in the approved constitution to answer this question."_
3. **Prompt** (`apps/api/src/modules/ai/ai-prompt.ts`): the rules are in the system message. The
   passages and the question are wrapped in markers carrying a **random boundary** for this request
   and are labelled as data. The model must reply in a fixed JSON shape, with a citation (source id
   plus exact quote) for what it says.
4. **Checking** (`answer-validation.ts`), on the server, before anyone sees the answer:
   - only passages that were given can be cited, and each quote must be an **exact part of the
     stored text**; the stored wording is shown, never the model's copy;
   - the explanation may not mention any clause, section or part number that is not in the
     passages (**no invented clause numbers**);
   - if the hidden "canary" word or the boundary appears in the reply, the instructions leaked and
     the answer is discarded;
   - anything that is not the agreed JSON, or that has no valid citation, becomes the standard
     "could not find sufficient information" reply.
5. **What the member sees:**
   - the **AI explanation**, labelled "Written by AI · check the original text below";
   - the disclaimer: not legal advice, no decisions made;
   - then, separately, **"Original text from the approved constitution"**. Each source shows the
     document, version number, label and date, where it sits, its reference (for example
     "Clause 7"), the section's full original text with the quoted words marked, the page of the
     original document when known, and **Open this section in the constitution**.
6. **Feedback:** "Was this helpful? Yes / No", with an optional comment.

**Suggested questions** are built from the titles of the organisation's current constitution
("What does the constitution say about quorum?"). They use no AI, so they only mention topics that
really are in the document.

## The AI rules and how each is enforced

| Rule                                                      | Enforcement                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–2. Never invent clauses or clause numbers               | Quotes must match stored text; explanations naming unknown references are rejected; references come only from stored numbers.                                                                    |
| 3. Cite the exact source                                  | Each citation is a stored section plus an exact quote, linked to the section, version and original page.                                                                                         |
| 4. Original text separate from AI explanation             | Separate panels with labels; the original is always the stored text.                                                                                                                             |
| 5. State when evidence is insufficient                    | No relevant passages, the model says so, or the checks fail → the fixed message.                                                                                                                 |
| 6–7. No legal advice, no binding decisions                | System instructions, plus a disclaimer on every answer.                                                                                                                                          |
| 8. Only approved constitutions                            | Retrieval reads published versions only (tested).                                                                                                                                                |
| 9. No other tenant's documents                            | Retrieval runs under Row-Level Security and filters by organisation (tested).                                                                                                                    |
| 10–11. Uploaded content is data; prompt-injection defence | Random boundaries, data-not-instructions rules, fixed JSON output, server-side checks, canary leak detection. No tools, browsing or follow-up actions are given to the model.                    |
| 12. Keys server-side                                      | `ANTHROPIC_API_KEY` is read by the API only and sent only in the request header to Anthropic. The browser talks only to our API. Never logged (log redaction) and never put in prompts (tested). |
| 13. Usage and errors without sensitive content            | See below.                                                                                                                                                                                       |

## Privacy: what is stored

- The question and answer are kept in the **asking person's own conversation** (private to them,
  even inside the organisation), with the cited sections and quotes, so they can see them again and
  give feedback.
- **Audit events** (`ai.question_answered`, `ai.feedback_given`) and **usage records**
  (`ai.questions`, `ai.tokens_in`, `ai.tokens_out`) contain counts and outcomes only. That means
  status, number of passages and citations, which checks failed, provider and time taken; never the
  question, answer, passages or feedback comment.
- Prompts and provider responses are **not stored or logged**. A failing provider call is logged
  with a short reason code only (for example `http_429` or `timeout`). Provider error bodies are
  dropped because they can echo the request.
- Per-person limit: `AI_MAX_QUESTIONS_PER_USER_PER_HOUR` (default 30).

## Providers and configuration

| `AI_PROVIDER`        | What happens                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled` (default) | No AI. The page offers "Find relevant clauses" instead (see above).                                                                                     |
| `anthropic`          | Anthropic's Claude (`AI_MODEL`, default `claude-sonnet-5-5`) with temperature 0. Needs `ANTHROPIC_API_KEY`.                                             |
| `offline`            | **Local development and tests only** (refused in staging and production). No AI model: it quotes the best-matching passage and says it is in test mode. |

To switch on real answers: set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=<your key>` in the
API's secret settings (never in the web app). Anthropic's own data-handling terms apply to the
passages and questions sent to it.

## API

| Method & path (under `/api/v1/organisations/:id/ai`)         | Notes                                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /status`                                                | Whether answers are available, the mode, the disclaimer                                                                                                         |
| `POST /ask` `{ question }` (3–500 characters)                | Returns `status` (`answered` / `insufficient` / `unavailable`), `explanation`, `message`, `citations[]` (reference, quote, sourceText, version …), `disclaimer` |
| `POST /find-clauses` `{ question }` (3–500 characters)       | No AI. Returns `terms`, `results[]` (reference, heading, original `text`, version …), `message` when nothing matched, `notice`                                   |
| `GET /suggested-questions`                                   | Built from current titles                                                                                                                                       |
| `POST /messages/:messageId/feedback` `{ helpful, comment? }` | Own answers only                                                                                                                                                |
| `GET /conversations`, `GET /conversations/:id`               | Own conversations only                                                                                                                                          |

All require `constitution.read`, which every role has.

## Tests

- `apps/api/src/modules/ai/ai-units.spec.ts`:
  - the answer checks: exact quotes, original wording kept, invented quotes and sources, unknown
    clause numbers, instruction leaks, bad formats;
  - the prompt layout with boundaries;
  - question terms and references;
  - the offline mode;
  - the Anthropic client: the key goes in the header only and error details are hidden.
- `apps/api/test/ai.e2e.spec.ts`, using a test provider that records every prompt and can act like
  a misbehaving or manipulated model:
  - **correct citations**: exact quotes, full original text, version, sub-clause references;
  - **unsupported questions**: no AI call when nothing matches, the model saying "insufficient",
    invented clauses or quotes;
  - **prompt injection**: a question asking for the system prompt, and instructions hidden in a
    published constitution, both contained and rejected;
  - **cross-tenant retrieval**: another organisation's words never reach the prompt;
    conversations and feedback are refused;
  - **version correctness**: never drafts; the new version is used the moment it is published;
  - **sensitive information**: no keys, emails or password hashes in prompts; no question text in
    audit; provider errors hidden; questions private to each person;
  - feedback, permissions and the hourly limit.
- `apps/web/e2e/ask.spec.ts`: asking in a browser (offline mode), sources and links, the
  unsupported message, feedback and suggested questions.

## Known limitations

- **Accuracy is not guaranteed.** The checks stop invented quotes and clause numbers, but cannot
  prove an explanation is a fair summary. That is why the original text is always shown and the
  disclaimer says the original decides.
- Retrieval is keyword-based, without embeddings yet. A question that uses different words from
  the constitution (for example "kick out" vs "terminate membership") may get the "could not find"
  answer. Vector search (pgvector) is planned.
- Clause numbers written in words ("clause seven") are not checked by the reference filter.
- The model is told not to give legal advice or make decisions, but this cannot be fully
  enforced. The disclaimer is always shown.
- Real-model behaviour has not been measured yet with the organisation's documents: CI has no AI
  account and uses the test and offline providers. Before go-live, run an evaluation set of
  real questions with `AI_PROVIDER=anthropic`.
- Questions are stored in the asker's private conversation history with no automatic expiry yet.
