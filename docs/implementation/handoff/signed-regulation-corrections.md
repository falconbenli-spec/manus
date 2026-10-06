# Handoff: corrections against the signed work regulation (approval certificate 351743, 25-10-1446H)

Every item below cites the signed page it comes from, read from the page image. The shared-penalty cell of the penalty schedule has its own file: `discipline-shared-penalty-cell.md`.

Migration **128** (`app/migrations/128-signed-regulation-corrections.sql`) carries the data corrections. It runs the first time the app opens the database, like any other migration; nothing is typed by hand. It touches no schema — it drops a fixed-row trigger, writes the corrected value, and puts the trigger back exactly as migration 112 wrote it.

---

## 1. The kilometre rate is in the regulation, not in a circular (Art. 41(h), p017)

**Signed text, p017:** «في حال عدم وجود سيارة خاصة للمنشأة وعدم وجود مطار بالمدينة المنتدب إليها العامل، فإن المنشأة تصرف له **ريالًا واحدًا عن الكيلو متر الواحد**، وذلك من مقر المنشأة أو من أقرب مطار للمدينة المنتدب إليها حتى وصوله للمدينة المنتدب إليها، ذهابًا وإيابًا.»

**What was wrong.** Migration 112 seeded the Art. 65 regulation version (`secondment_allowance_versions`, `36t-sec-reg` and `isolated-sec-reg`) with `mileage_rate_minor = 0` and put the rate on the circular version only. A mileage claim was refused with «النسخة السارية لا تحدد معدل الكيلومتر؛ معدل م41 يسري مع التعميم» — attributing to a circular what the regulation itself states. Since the circular has no effective date and cannot be activated, the rate the regulation grants was unreachable.

**The correction.**
- Migration 128 sets `mileage_rate_minor = 100` (one riyal) on the `regulation_art65` **template** — so every tenant created later inherits it — and on every tenant's `regulation_art65` **version** row, and appends the Art. 41(h) citation to the version body. Grades, rounding, effective date and status are untouched, so no existing calculation moves.
- `app/secondment-benefits.mjs`: the refusal now fires only when the version in force genuinely carries no rate, names that version, and says who fixes it (`hr.policy.accept`). It no longer mentions a circular.

**What the lead runs on the live database.** Nothing by hand: start the platform once on this branch and migration 128 applies. Then verify:

```sql
SELECT id, code, status, mileage_rate_minor FROM secondment_allowance_versions WHERE code='regulation_art65';
-- expect mileage_rate_minor = 100 for 36t-sec-reg and isolated-sec-reg
```

The guard in the migration is `WHERE ... mileage_rate_minor=0`, so it is a no-op if someone has already set the rate.

---

## 2. The regulation's rounding rule now reaches the secondment allowance (Art. 50(5), p020)

**Signed text, p020:** «عند حساب كل من الأجور، والبدلات، والمكافآت، والتعويضات، والحسميات المنصوص عليها في هذه اللائحة؛ تُقرّب القيمة إلى أقرب ريال بالزيادة.»

**What was wrong.** The owner accepted that rule (`regulation_policies`, kind `pay_rules`, `rounding = 'riyal_up'`, in force 22 September 2026), but the secondment allowance and the Art. 41 ticket rounded by the **version's own** `rounding` field, which is `halala` on the Art. 65 version. So a rule the owner had accepted did not reach a payment the regulation itself names.

**The correction.** `secondmentRounding(db, tenant, date, version)` in `app/secondment-benefits.mjs` reads the accepted pay-rules policy in force **on the secondment's start date**; the version's own value stays only as the fallback for a date on which no pay-rules policy had been accepted, so no past decision changes. `app/travel.mjs` and `recordTicket` both use it, the basis records `rounding_source` and a one-line note, and the displayed articles gain `م50/5` when the rule is what applied.

**No migration, no database change.** A secondment approved before this branch keeps the rounding recorded in its own `basis`; the new rule applies from the next approval.

---

## 3. A resignation may be filed during an investigation; only its acceptance is blocked (Art. 37/5, p016)

**Signed text, p016:** «لا يجوز **قبول** استقالة العامل المُحال إلى التحقيق، أو الموقوف عن العمل؛ حتى يُبتَّ في أمره.»

**What was wrong.** `app/resignations.mjs` refused the **submission** outright, so the letter was never recorded, its date never existed, and the 30-day deemed-acceptance clock of Art. 34(1) never started. An employee under an investigation that is later closed as unfounded lost time the regulation gives them.

**The correction.** Submission is recorded with its date and marked «موقوف قبولها حتى يُبتَّ في التحقيق (م37/5)». The block moved to where the article puts it: the acceptance path and the deemed-acceptance timer. The acceptance refusal now names the open matter and who decides it, and states that the submission date stands. The deemed-acceptance job already held instead of firing; it is now covered by a test. No database change.

### One recorded test contradicts the signed article — **not touched**

`tests/payroll-rules.test.mjs`, the test titled *"resignation: an open investigation or suspension blocks submission and holds acceptance until it is decided (Art. 37/5)"*, asserts at its third line:

```js
assert.throws(()=>tx(()=>submitResignation(db,users.employee,{letter_date:d0,proposed_last_day:addDays(d0,30)})),code('investigation_open'));
```

That assertion records the behaviour the signed م37/5 contradicts, so it now fails, and the rest of that test body does not run. **This branch does not edit it**, because editing a recorded test is outside what this work may do. The owner of that file has to decide. The minimal change, if the reading here is accepted:

- delete that `assert.throws` line and the `UPDATE hr_cases SET status='closed'` line that follows it (it only existed to get past the block), and take `id` from the submission that is already made two lines below;
- change the title from *"blocks submission and holds acceptance"* to *"holds acceptance"*;
- keep every other assertion in that test unchanged — they all still pass, because the acceptance block, the confidentiality of the case details and the deemed-acceptance hold are all unchanged behaviour.

Until that is done, `npm test` reports **1 failing test** for this reason and no other.

## 4. Two article texts an employee reads were wrong (Arts. 65 and 76, p024 and p028)

The policy library (migration 110) was seeded with 127 automatically extracted articles. Two of them carry an error that changes the meaning, not the look:

- **Art. 65, p024.** The stored body had the per-diem table's column headings and **none of its eight amounts**, so an employee read «بدل انتداب — خارج المملكة» with no figure. The signed table prints, outside the Kingdom **2500 / 1500 / 900 / 500** and inside it **2100 / 1000 / 600 / 400** (columns right to left: الرئيس التنفيذي، نواب الرئيس، مدراء العموم، للعاملين), under the note «المبالغ المذكورة تصرف عن اليوم الواحد».
- **Art. 76, p028.** The 50% rate was split across the two paragraphs — «... من% أجره الأساسي. (» at the end of the first and «مضافًا (إليه 50» at the end of the second — so the sentence read as nonsense. The signed text is «تدفع المنشأة للعامل عن ساعات العمل الإضافية أجرا إضافيا يوازي أجر الساعة مضافًا إليه (50%) من أجره الأساسي».

**The correction** (migration 128, section 2) goes through the library's own path, the one HR's own editor uses (`curatorAction` / `edit_article`): a new `revision` on `policy_articles`, and the new text kept in `policy_article_versions` with a note that cites the signed page. The first revision — the extracted text — was already seeded by migration 110 and is untouched, so «مقارنة النسختين» works line by line and a reader sees exactly what changed.

Three things the migration deliberately does **not** change:
- `verification` stays `extracted`, so the caveat «مستخرج — يحتاج مطابقة مع الأصل الموقّع» stays on both articles. Matching is a person's attestation under their own name (`verify_article`), never a migration's.
- `title_source` stays as it was — nobody here approves a title.
- `edited_by` is left null, because the editor is not a person.

The `clause_reflow` artifact is cleared on these two, because the text it describes is no longer what is stored.

**What the lead runs on the live database.** Nothing by hand; migration 128 applies on the next start. Then:

```sql
SELECT number, revision, verification, artifacts FROM policy_articles WHERE number IN (65,76);
-- expect revision 2, verification 'extracted', artifacts '[]'
```

Every statement in that section is guarded with `AND revision=1`. If HR has already edited either article by hand on the live database, the migration leaves it alone rather than writing over a person's work — and then the correction belongs in the screen, made by a curator with the same two texts above. After the run, an article still at `revision 1` means exactly that, and is worth a look.

## 5. What is *not* corrected here

`app/leave-types.mjs`, `app/attendance-extras.mjs`, `app/overtime-rules.mjs` and `app/payroll-extras.mjs` belong to four other teams building on the same repository right now. The differences found in them are listed at the end of the branch report so the lead can hand each one to the team that owns the file. Nothing in this branch touches those files.
