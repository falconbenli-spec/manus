# «اسأل عن السياسة»: the policy assistant and the employee's personal guide

Branch `worktree-agent-ac955d9d353cda919`, from `codex/local-foundation` at `9f95cde`. Nothing pushed, `.env` untouched, no applied migration (001–106) edited. New migration: **111**.

The assistant answers from the platform's own text and from the asking employee's own records. It approves nothing, pays nothing, sends nothing. It rides on the existing AI stack in `app/ai.mjs` — same daily limit, same run log, same review flow, same governance inventory and eval machinery. No second AI stack was built.

---

## 1. Which retrieval path is active — plainly

**Active today: lexical only.** Arabic normalisation (`app/arabic-text.mjs`) → a light stemmer → a term index → BM25 → synonym and stem expansion from the `policy_search_terms` table (migration 111). That is what runs in every test and every answer today.

**The semantic layer is off.** `POLICY_EMBEDDING_URL` is not set in this repository, and no embedding provider is configured. `embeddingConfig()` reports `{configured:false}` and the screen says «الطبقة الدلالية: مطفأة» with the reason. When (and only when) an endpoint is configured, `retrieveHybrid` re-ranks the BM25 pool by cosine similarity and the reported path becomes `lexical_bm25+embeddings`, naming the model. If the endpoint is configured but the call fails, the answer is still produced from the lexical path and says so. **The word "semantic" is never shown unless the embedding call actually succeeded.**

Two precision rules keep the lexical path honest (`app/policy-retrieval.mjs`):

- **Unknown subject → no answer.** If a content word of the question (not a number, ≥4 letters, no synonym in the corpus) appears in no paragraph at all, nothing is returned. This is what makes «هل يصرفون بدل انترنت؟» answer «لا يوجد نص» instead of quoting the relocation allowance because both contain «بدل».
- **Coverage, not a single shared word.** A paragraph is returned only if it covers ≥55 % of the rarity-weighted mass of the question's terms (or ≥75 % of the best paragraph's coverage), and matches at least one distinctive term.

## 2. The library adapter — what to rewire at merge

`app/policy-library.mjs` (migration 110) is **not** in this branch. `app/policy-retrieval.mjs` therefore defines a narrow adapter and runs against a local stand-in:

```js
setPolicyLibrary({
  name,
  articles(db, tenantId, today) -> [{ id, code, title, effective_from, in_force, status,
                                     link, source, article_refs:['م65',…], blocked_by,
                                     paragraphs:[{ number, text }] }],
  synonyms(db) -> [[term, variant], …]   // optional; defaults to policy_search_terms
})
```

**At merge: one line** — call `setPolicyLibrary(policyLibrary)` once in `app/server.mjs` (or in the library module's own init). Nothing else in the assistant changes: retrieval, citations, conflicts, the golden set and the UI all read through the adapter.

The stand-in is **not invented text**. It reads the platform's own accepted wording: `hr_policies`, `leave_type_policies` (each leave type rendered from its own `rules_ar` with its articles), `regulation_policies`, `discipline_schedules` (each violation row with its penalties written by `penaltyLabel`, plus a settings paragraph for the caps and grievance windows) and `benefit_catalog`. Anything not accepted is returned marked **not in force** with the decision that is missing, and is never presented as an answer.

## 3. What the assistant does

| Need | Where it comes from |
|---|---|
| Answer + citations | `answerQuestion()` → one or two direct lines, then each paragraph quoted with its policy, effective date, paragraph number and link |
| No text | A plain «لا يوجد نص…» pointing to HR (HR-GRIEVANCE), and the question is logged for the content owners |
| Conflicts | `policy_article_supersedes` (111), seeded with the owner's own pairs: 105 over 101, 126 over 125, the circular over 41 and 65. The maternity paragraph cites both 105 and 101, so the answer states which is in force and links the amendment |
| Calculations | `computePerDiem()` from `app/travel.mjs` — the travel module's own function, with the working shown step by step and the article beside each rule |
| Personal data | Leave balances via `listLeave`, pay lines via `factsOf`, benefits via `myBenefits` — every call made **as the asker, for the asker** |
| How do I submit X | `catalog()` + `serviceCard()` + `MODULE_SERVICES` + `module-routes` — screen, required fields, documents, approval chain, SLA, blockers, and a deep link that opens the form |
| Eligibility dates | The benefits eligibility engine (`evaluateEligibility`), the probation end from the active contract |
| Skills | `skillsPath()` from the employee's own contract, career profile, qualifications, training records and last released appraisal, plus the training articles (م42–م45) and the study benefit as accepted |

**Self-only, enforced in the data layer.** `otherPersonNamed()` runs *before any retrieval*: a full name, two name words one of which is unique in the user directory, a username, or a personal subject beside a third-person marker («زميلي») ends the run with a refusal. Distinctiveness is measured from the directory itself, not from a word list, so «بدل الانتداب لمدير إدارة» is answered while «كم راتب <name>؟» is refused — including when the asker is that person's manager. No function in the module accepts another employee's id.

**Masking.** `FactMask` replaces salary, balances, family/medical eligibility text and appraisal areas with `[[SALARY_1]]`-style tokens *before* the data is assembled, so the provider never receives them; the owner's own answer is restored after the call. On top of that, every provider is now wrapped in `withRedaction` from `app/pii.mjs` (ID, IBAN, mobile, e-mail) — that wrapper existed but had never been connected.

## 4. Guardrails kept

Per-user daily run limit, monthly cost cap, the `ai_runs` log with its instruction version and sources, the one-time review by the run's owner, the objection channel to the first admin, the governance inventory (both new assistants appear in it as un-inventoried until assessed) and the deterministic eval suites. The assistant's output is always an answer or a draft.

## 5. The golden set

`GOLDEN_QUESTIONS` in `app/policy-assistant.mjs`: **28 questions**, including every example the owner gave — إجازة الزواج، عقوبة التأخر 20 دقيقة للمرة الثانية، متى تعتبر الاستقالة مقبولة، كيف أطلب تأمين والدي، بدل الانتداب لمدير إدارة خارج المملكة، وبدل الإنترنت (must answer «لا يوجد نص») — plus three privacy probes, a not-yet-accepted policy, personal balances, a calculation, eligibility dates and the skills path.

`runGoldenSet()` is deterministic and calls **no provider** (the test asserts the stub is never called). It reports, per case, what happened and *what the text still needs*, because a failing case usually means missing content, not a broken assistant. In the synthetic tenant of `tests/policy-assistant.test.mjs` the set scores **28/28 (100 %)**; the test asserts ≥90 % overall and 100 % for the privacy and no-text categories, which must never regress whatever the content says. It is exposed at `GET /api/policy-assistant/golden` for holders of `ai.govern` or the HR policy capabilities, and rendered on the screen.

## 6. The screen

`#policy-assistant` — «اسأل عن السياسة»: the ask box, the owner's suggested questions as chips, the answer with its citations (each a link with the paragraph quoted), the calculation table, the "how to submit" steps, the deep link, «هل كانت الإجابة مفيدة؟» on each of my questions, and — for whoever prepares or accepts policies or manages sources — the log of questions the text did not answer, with a close-out note. Arabic RTL, phone-friendly, no inline styles or scripts, served from the asset allowlist.

Entry points: the employee reaches it from the **Home quick action** «اسأل عن السياسة» (deep link `#policy-assistant/ask` opens the box directly); supervisory accounts also get a menu row. The ordinary employee's sidebar stays at its audited length (≤30 rows), which is why there is no extra row for them.

**At merge with the library (110):** add the same box to the library page by importing `answerView` from `app/static/policy-assistant-ui.mjs` and rendering the `ask_policy` button there — the endpoint and the answer view are already shared.

## 7. What is stubbed, and what needs an owner decision

1. **Embedding provider — owner decision.** Is there to be a semantic layer at all, and on whose endpoint? Where would the text be processed (the question and the retrieved paragraphs would leave the platform)? Until that is answered the assistant runs lexically and says so. Nothing is faked.
2. **Job grades are not recorded anywhere in the platform.** The per-diem answer reads the asker's grade from their own last approved travel decision; with no such decision it refuses to assume one, names the decision-maker, and shows the accepted table. Recording grades on the employee record is a separate decision.
3. **No career ladder exists in the platform.** The skills path says so instead of inventing a "next role": gaps come from the employee's own recorded career interest and the lowest areas of their own last appraisal.
4. **The conflict table holds only the four pairs the owner stated.** Any further "this article supersedes that one" is a written decision, added as a row; the platform does not infer supersession from the text.
5. **The stand-in corpus** is replaced by the library at merge (§2). Paragraph numbering in citations comes from the stand-in's own splitting today; the library's own paragraph numbers take over after the rewire.
6. **PII masking is partial by design** (`app/pii.mjs`): patterns cover ID/Iqama, IBAN, Saudi mobile and e-mail; names are not detected. The assistant's own fact masking covers salary, balances, family/medical and appraisal text. Free-text questions are still written by people, so a question can contain anything — that is why the logged question is redacted before storage.

## 8. Files

| File | What |
|---|---|
| `app/migrations/111-policy-assistant.sql` | `policy_questions` (log + feedback + HR close-out, append-only), `policy_search_terms` (synonyms), `policy_article_supersedes` (which article is in force) |
| `app/policy-retrieval.mjs` | library adapter + stand-in over the platform's own text, index, BM25, synonyms/stems, relevance floor, optional embeddings, conflicts |
| `app/policy-assistant.mjs` | classification, the self-only guard, personal facts, per-diem calculation, "how do I submit X", eligibility, skills path, answer composition, question log, feedback, board, golden set |
| `app/ai.mjs` | two new assistants (`policy_assistant`, `skills_path`), async `prepare`, fact restoration, question logging inside the run transaction, provider wrapped in `withRedaction` |
| `app/server.mjs` | `GET /api/policy-assistant`, `GET /api/policy-assistant/golden`, `POST /api/policy-assistant/questions/:id/(rate|resolve)`, asset entry |
| `app/static/policy-assistant-ui.mjs` | the screen and the answer view |
| `app/static/operations.mjs`, `app/static/app.mjs`, `app/static/deep-links.mjs`, `app/static/home-ui.mjs`, `app/home.mjs` | page registration, menu row, deep link, Home quick action |
| `app/static/ai-ui.mjs` | the two new assistants' forms, and a fix: `after` must return `{title, html}` — it returned a string, so an assistant's output never appeared in the dialog |
| `tests/policy-assistant.test.mjs` | 8 tests (see §5 and below) |
| `tests/employee-ux.test.mjs` | one line: the Home quick actions now include `policy` |

Tests cover: citations and their quotes; the no-text case at both the answer and the retrieval threshold; the conflict case; a calculation compared against `computePerDiem` itself and a refusal when the policy is not accepted; self-only privacy including the manager probe on a named employee; the "how do I submit" steps compared against the catalogue's own fields and approval chain; the skills path from the employee's own record only; masking before the provider call with restoration for the owner; the daily limit; the question log, rating and close-out permissions; and the golden set with the provider stubbed.

`npm test`: **855 tests, 855 pass, 0 fail.** `npm run check`: 418 modules, source hashes match, traceability 220 requirements / 22 domains.
