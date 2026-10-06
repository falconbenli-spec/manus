# تسليم وحدة `bank-reconciliation` — المطابقة البنكية

## 1. الملفات

أنشأت (ولم أعدّل أي ملف قائم):

- `app/migrations/050-bank-reconciliation.sql` — هجرتي المحجوزة.
- `app/bank-reconciliation.mjs` — وحدة الخلفية.
- `app/static/bank-reconciliation-ui.mjs` — شاشة واحدة: `bankReconciliationUI`.
- `tests/bank-reconciliation.test.mjs` — ثمانية اختبارات.

لم ألمس `app/server.mjs` ولا `app/static/operations.mjs` ولا `app/access.mjs` ولا `app/reports.mjs` ولا `app/inbox.mjs` ولا أي اختبار قائم ولا أي هجرة أخرى. لم أضف صنف CSS جديدًا؛ استخدمت الأصناف القائمة فقط.

## 2. الهجرة 050 وجداولها

| الجدول | ما فيه | ما يحميه |
|---|---|---|
| `bank_accounts` | حساب بنكي للمنشأة: اسم، بنك، **آخر أربعة أرقام فقط**، وربط إلزامي بحساب البنك في الدفتر (`finance_accounts`). لا آيبان كامل ولا بيانات دخول في المنصة. | `CHECK` على أربعة أرقام صرفة، `TRIGGER` يمنع تغيير الهوية أو حساب الدفتر أو الحذف. الكود يشترط حساب أصول نشطًا وواحدًا لكل حساب دفتر. |
| `bank_import_profiles` | تعيين أعمدة الكشف لكل حساب بنكي: الفاصل، صيغة التاريخ، عدد أسطر الترويسة، و`columns` JSON (تاريخ، وصف، مرجع، مدين، دائن، أو عمود مبلغ واحد بإشارة، ورصيد). يُحفظ مرة ويُعاد استخدامه. | `CHECK` على قيم الفاصل وصيغة التاريخ و`json_valid(columns)`. `TRIGGER` يمنع نقل الملف إلى حساب آخر أو حذفه (يُوقف فقط). |
| `bank_statement_imports` | دفعة استيراد: اسم الملف، **بصمة SHA-256 لمحتواه**، نطاق التواريخ، الرصيدان الافتتاحي والختامي كما في الكشف، عدد الأسطر، وحالة `active`/`cancelled`. | `UNIQUE(tenant_id,file_digest)` يمنع استيراد الملف نفسه مرتين. `TRIGGER bank_import_cancel_only` يسمح بالانتقال `active → cancelled` فقط ويرفض أي تعديل آخر. `TRIGGER bank_import_cancel_guard` يرفض إلغاء دفعة عليها مطابقة **معتمدة**. |
| `bank_transactions` | حركة الكشف: تاريخ، وصف، مرجع، مدين/دائن، رصيد اختياري، ورقم سطر فريد داخل الدفعة. | `TRIGGER bank_transactions_immutable` يرفض **كل** `UPDATE`، و`TRIGGER` يرفض كل `DELETE`. التصحيح بإلغاء الدفعة كاملة لا بتعديل سطر. `CHECK` أن المبلغ في جانب واحد فقط. |
| `bank_matches` | مطابقة الحركة: إما `record` بسجل في المنصة (`source_kind` + `source_id`)، أو `unmatched` بسبب (رسوم بنكية، فائدة، تحويل بين الحسابات، غير معروف). تحمل `rationale` نص المُعِدّ و`suggested_score` درجة النظام. | **`CHECK(decided_by<>prepared_by)`** — من يُعِدّ لا يعتمد ولا يرفض. فهرسان جزئيان: حركة واحدة لا تحمل مطابقتين قائمتين، وسجل واحد في المنصة لا يُطابَق بحركتين. `TRIGGER bank_match_live_batch` يشترط دفعة سارية ومبلغًا مساويًا لمبلغ الحركة. `TRIGGER bank_match_decided_once` يقفل المطابقة بعد القرار. |
| `bank_rules` | نمط في الوصف ← حساب أو مشروع مقترح، بـ`note` و**مالك** و**تاريخ**. | `CHECK` يشترط اقتراحًا واحدًا على الأقل، `UNIQUE(tenant_id,pattern)`، `TRIGGER` يمنع تغيير النمط أو المالك أو الحذف. لا علاقة لها بأي ترحيل. |
| `bank_reconciliations` | تسوية الفترة بمكوناتها الخمسة: الرصيد الختامي، الحركات غير المطابقة، سجلات الدفتر غير الظاهرة في البنك، رصيد الدفتر المتوقع، رصيد الدفتر الفعلي، والفرق، مع `snapshot` و`explanation`. | **`CHECK(approved_by<>prepared_by)`**. `CHECK` يفرض المعادلة حسابيًا في SQL نفسه. **`CHECK(difference_minor=0 OR length(trim(explanation))>=20)`** — لا فرق غير صفري بلا تفسير مسجّل. `TRIGGER bank_reconciliation_locked` يقفل المعتمدة نهائيًا. فهرس جزئي: تسوية قائمة واحدة لكل حساب وفترة. |

## 3. المسارات التي يحتاجها المنسّق في `app/server.mjs`

استيراد: `import * as bank from './bank-reconciliation.mjs';`

### قراءة (GET، خارج المعاملة)

| الطريقة | المسار | الدالة | ملاحظة |
|---|---|---|---|
| GET | `/api/bank-reconciliation` | `bank.bankBoard(db,u,query)` | `query` = `{bank_account_id?}`. ترمي 403 `not_permitted` لمن لا يحمل أيًا من التصريحين. هذه دالة `load` للشاشة. |
| GET | `/api/bank-reconciliation/transactions/:txnId/suggestions` | `bank.suggestMatches(db,u,txnId,query)` | `query` = `{window_days?}` عدد صحيح 0–30. تحتاج `bank.reconcile`. اختيارية: اللوحة تعيد الاقتراحات مضمّنة. |
| GET | `/api/bank-reconciliation/statement` | `bank.reconciliationStatement(db,u,query)` | `query` = `{bank_account_id,period_start,period_end}` (الثلاثة مطلوبة). معاينة التسوية قبل حفظها. |

### كتابة (POST، داخل `transaction`)

| المسار | الدالة | `Idempotency-Key` |
|---|---|---|
| `/api/bank-reconciliation/accounts` | `bank.createBankAccount(db,u,input)` | نعم |
| `/api/bank-reconciliation/profiles` | `bank.saveImportProfile(db,u,input)` | نعم |
| `/api/bank-reconciliation/profiles/:id/deactivate` | `bank.deactivateProfile(db,u,id,input)` | لا (`version`) |
| `/api/bank-reconciliation/imports` | `bank.importStatement(db,u,input)` | نعم |
| `/api/bank-reconciliation/imports/:id/cancel` | `bank.cancelImport(db,u,id,input)` | لا (`version`) |
| `/api/bank-reconciliation/matches` | `bank.proposeMatch(db,u,input)` | نعم |
| `/api/bank-reconciliation/matches/:id/approve` | `bank.decideMatch(db,u,id,'approve',input)` | لا (`version`) |
| `/api/bank-reconciliation/matches/:id/reject` | `bank.decideMatch(db,u,id,'reject',input)` | لا (`version`) |
| `/api/bank-reconciliation/rules` | `bank.createRule(db,u,input)` | نعم |
| `/api/bank-reconciliation/rules/:id/deactivate` | `bank.deactivateRule(db,u,id,input)` | لا (`version`) |
| `/api/bank-reconciliation/reconciliations` | `bank.prepareReconciliation(db,u,input)` | نعم |
| `/api/bank-reconciliation/reconciliations/:id/approve` | `bank.approveReconciliation(db,u,id,input)` | لا (`version`) |
| `/api/bank-reconciliation/reconciliations/:id/cancel` | `bank.cancelReconciliation(db,u,id,input)` | لا (`version`) |

المعرفات كلها `randomUUID` بنمط `[a-f0-9-]{36}`. كل دوال الكتابة تبدأ بفحص `db.isTransaction` وترمي 500 `transaction_required` خارج المعاملة.

**حجم الطلب:** `importStatement` يستقبل محتوى الملف نصًا في `content` (حد 2,000,000 حرف و5000 سطر). إن كان حد جسم الطلب في الخادم أقل من ذلك فهذا قرار المنسّق: إما رفع الحد لهذا المسار وحده، أو تقصير فترة الكشف — والرسالة للمستخدم موجودة (`file_too_large`).

## 4. مفتاح الوحدة في `operationModules`

- المفتاح: `bank-reconciliation`
- الثابت المصدَّر: `bankReconciliationUI` من `app/static/bank-reconciliation-ui.mjs`
- الاستيراد: `import { bankReconciliationUI } from './bank-reconciliation-ui.mjs';`
- اسم الملف للقائمة البيضاء: `bank-reconciliation-ui.mjs`
- مجموعة التنقّل: **المالية** (بجوار `finance` و`payables` و`receivables` و`statements`).
- الشاشة تستورد `./dates.mjs` فقط (مُقدَّم أصلًا). لا CSS جديد ولا `style=""` ولا `<script>`.

## 5. صندوق «بانتظار قراري»

`bankBoard(...).inbox` يعيد جاهزًا عنصرين من نوعين، لحامل `bank.reconcile.approve` ولمن ليس مُعِدّ السجل:

| المفتاح المقترح | العنصر | الفعل |
|---|---|---|
| `bank_match` | مطابقة مقترحة على حركة بنكية | `approve_match` |
| `bank_reconciliation` | تسوية فترة بحالة مسودة | `approve_reconciliation` |

كل عنصر يحمل `{id,title,due_date,created_at,actions}` بالشكل الذي يستهلكه `inbox.mjs`. المُعِدّ لا يرى مقترحه في صندوقه إطلاقًا.

## 6. ما لم أبنه ولماذا

- **لا اتصال بأي بنك ولا مصرفية مفتوحة ولا تغذية تلقائية.** الاستيراد ملف CSV يرفعه المحاسب ويلصق محتواه. هذا مذكور حرفيًا في `description` الشاشة وفي `note` اللوحة وفي نص حقل الرفع.
- **لا قيد محاسبي آلي.** الحركة بلا سجل مقابل تُصنَّف بسبب وتنتظر قيدًا يُعِدّه المحاسب في الدفتر ويمر باعتماده وترحيله المستقلين. لم أكتب حرفًا في `finance_journals`.
- **المطابقة الجزئية غير مدعومة** (حركة واحدة ↔ سجل واحد بالمبلغ نفسه). دفعة بنكية واحدة تغطي عدة فواتير، أو فاتورة مقسّطة على تحويلين، تحتاج نموذج تخصيص مبالغ — **قرار المالك**: أبنيه في مرحلة لاحقة أم يبقى التصنيف اليدوي كافيًا.
- **أنواع السجلات المطابَق بها ستة فقط**: `supplier_payment` (أمر دفع منفذ)، `ar_receipt` (قبض مؤكد)، `payroll_payment` (دفع مسير منفذ)، `expense_reimbursement` (تعويض مصروف)، `custody_issue`، `custody_return`. هذه وحدها السجلات التي تمس النقد وتبلغ حالة نهائية في المنصة اليوم.
- **رصيد الدفتر من القيود المرحّلة فقط** على حساب البنك في الدفتر. مستند صدر ولم يُرحّل قيده ليس في الدفتر ولا يدخل الفرق — وهذا مذكور في `book_basis` على الشاشة.
- **نافذة فرق التاريخ 5 أيام افتراضيًا** (0–30 قابلة للتمرير). هذا تفاوت تشغيلي بين تاريخ السجل وتاريخ ظهوره في البنك، **ليس مهلة نظامية**، ولا يوجد في الوحدة أي نسبة أو سعر أو موعد حكومي.
- **آخر أربعة أرقام فقط** من رقم الحساب. لم أضف عمودًا لرقم حساب كامل ولا لآيبان، ولا حقلًا لأي بيانات دخول بنكية.
- **تقارير `reports.mjs`**: لم ألمسه. إن أراد المالك «تقرير التسويات البنكية» في مكتبة التقارير فهو عمل المنسّق أو وكيل التقارير على `reconciliationStatement`.
- **يحتاج مالك إجراء:** من يحمل `bank.reconcile` ومن يحمل `bank.reconcile.approve` — يجب أن يكونا شخصين مختلفين فعليًا. التصريحان حساسان (`sensitive`) ويخضعان لإلزام التحقق بخطوتين عند تفعيله.

## 7. نتيجة تشغيل الاختبارات

```
$ node --test tests/bank-reconciliation.test.mjs
✔ csv reader: quoted fields, thousands separators and a trailing row survive the bank export format
✔ statement import: the file is the only source, its content digest blocks a second import, and a file that does not add up is refused
✔ an imported bank line is never edited: correction is cancelling the whole batch, and only before a match on it is approved
✔ suggestion explains itself in words and stays a suggestion: nothing is matched without a human, and the preparer never approves
✔ tenant isolation and capability: a user of another entity and a user without the capability see and touch nothing
✔ a bank rule only suggests: it names an account and an owner and posts nothing
✔ period reconciliation: every line is decided first, the difference is shown, and an approved reconciliation is locked
✔ a non-zero difference is never stored or approved without a written explanation
ℹ tests 8  ℹ pass 8  ℹ fail 0  ℹ duration_ms 2067
```

الاختبارات القريبة، بعد تغييري، كلها خضراء:

```
$ node --test tests/migrations.test.mjs tests/ledger.test.mjs tests/finance.test.mjs \
    tests/payables.test.mjs tests/receivables.test.mjs tests/expenses-assets.test.mjs
ℹ tests 28  ℹ pass 28  ℹ fail 0

$ node --test tests/static-modules.test.mjs tests/ui-render.test.mjs tests/access.test.mjs \
    tests/security-regressions.test.mjs tests/traceability.test.mjs tests/compliance.test.mjs
ℹ tests 18  ℹ pass 18  ℹ fail 0

$ node scripts/check.mjs
Syntax checked: … JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
```

(عدد الوحدات يتغير بين لحظة وأخرى لأن وكلاء آخرين يضيفون ملفات الآن؛ المهم أن الفحص يمر بلا خطأ.)

كما تحققت يدويًا من أن `render` لا ينتج `style=` ولا `<script>`، وأن **كل** زر تعرضه الشاشة يفتح نموذجًا صالحًا، لكل من: حامل الإعداد وحده، وحامل الاعتماد وحده، وحامل التصريحين معًا.

`tests/ui-render.test.mjs` لا يغطي شاشتي بعد لأنها ليست في `operationModules` حتى يضيفها المنسّق؛ بعد إضافتها ستدخل تلقائيًا في تلك الجولة. لم أشغّل `npm test` كاملًا كما ينص عقد العمل.
