# WIRING-SPEC — مواصفة ربط الوحدات الجديدة

المصدر: 29 ملف تسليم في `docs/implementation/handoff/` (22 في §2، و7 وصلت أثناء الكتابة في الملحق §9) + وحدة المنسّق `app/request-intake.mjs` / `app/static/intake-settings-ui.mjs`.
كل اسم دالة وترتيب معاملاتها **تحقّقتُ منه بـ`grep "^export"` على ملف الوحدة نفسه**، وكل مسار ومفتاح `Idempotency-Key` تحقّقتُ منه من ملف الواجهة (`endpoint` و`idempotent`). حيث خالف الكودُ التسليمَ، اتُّبع الكود ووُسم الخلاف بـ⚠.

## 0. قواعد عامة (تسري على كل الأقسام)

1. **مواضع الإدراج في `app/server.mjs`** (أرقام الأسطر للنسخة الحالية، 541 سطرًا):
   - الاستيرادات: بعد السطر 56.
   - المسار العام بلا مصادقة (خطاب التحقق فقط): بين السطر 125 (`/api/login`) والسطر 126 (`auth=authenticate(...)`).
   - كتلة GET: قبل السطر 222 (`const match=p.match(...)`) وبعد السطر 221 (`/api/integrations`).
   - المسارات غير المتزامنة (الفوترة الإلكترونية فقط): بعد السطر 234 (`assistantRun`) وقبل السطر 235 (`const result=transaction(...)`).
   - كتلة POST: داخل `transaction(db,()=>{…})` **قبل السطر 501** (`if(match) {`) كتلةً واحدة.
   - مؤقّت الفوترة الدورية: بعد السطر 534.
2. **الجدول ملخّص، والكتلة البرمجية تحته هي النص الحرفي.** في الجداول: «معاملة» = داخل `transaction`؛ «once» = يُلف بـ`once(create,read)`.
3. **قاعدة `once` الحرجة** (من `app/idempotency.mjs`): `createOnce` يرمي 400 `idempotency_required` إن غاب المفتاح، ويُدخل `result.id` في `idempotency_keys.resource_id` وهو `NOT NULL`. لذلك:
   - مسار ترسل واجهته `idempotent:true` ⇒ **يجب** `once`. مسار لا ترسله ⇒ **ممنوع** `once`.
   - دالة إنشاء لا تعيد `id` ⇒ تُلف بكائن يضيف `id` (موسومة ⚠ حيث تلزم).
4. **أسماء المتغيرات:** كل `const` جديد داخل كتلة المعاملة يشترك في نطاق واحد مع الموجود. الأسماء أدناه مختارة ألا تصطدم بالقائمة القائمة (`obligationStep` `cycleStep` `reviewStep` `planStep` `scope` `budget` `task` `transfer` `document` `profile` `change` `journal` `operation` …). لا تعدّلها إلى أسماء أقصر.
5. **الاستيراد بالمساحة (`import * as`) إلزامي** للوحدات: أسماء `createSchedule` و`scheduleAction` (الفوترة والإطفاء)، و`createBooking` (الموارد والمعدات)، و`requestAction` (التغذية الراجعة والخصوصية)، و`createCycle` (النبض و`talent`) مكررة بين وحدات.

## 1. التعديلات المشتركة دفعة واحدة

### 1.1 الاستيرادات في `app/server.mjs` (بعد السطر 56)

```js
import * as bank from './bank-reconciliation.mjs';
import * as billingRecurring from './billing-recurring.mjs';
import * as cashForecast from './cash-forecast.mjs';
import * as closeChecklist from './close-checklist.mjs';
import * as accruals from './accruals.mjs';
import * as contractsRegister from './contracts-register.mjs';
import * as engagement from './engagement.mjs';
import * as feedback from './feedback.mjs';
import * as governance from './governance.mjs';
import * as home from './home.mjs';
import * as expiry from './expiry.mjs';
import * as influencers from './influencers.mjs';
import * as leaveAccrual from './leave-accrual.mjs';
import * as benefits from './benefits.mjs';
import * as letters from './letters.mjs';
import * as pr from './pr.mjs';
import * as equipment from './equipment.mjs';
import * as privacy from './privacy.mjs';
import * as production from './production.mjs';
import * as profitability from './profitability.mjs';
import * as timesheets from './timesheets.mjs';
import * as resourcing from './resourcing.mjs';
import * as reviewRounds from './review-rounds.mjs';
import * as search from './search.mjs';
import * as taxReturns from './tax-returns.mjs';
import * as wps from './wage-protection.mjs';
import * as wageRecon from './wage-reconciliation.mjs';
import * as anomaly from './payroll-anomaly.mjs';
import * as lifecycle from './lifecycle.mjs';
import * as einvoice from './einvoice-gateway.mjs';
import { einvoiceSelfcheck } from './einvoice-selfcheck.mjs';
import * as requestIntake from './request-intake.mjs';
```

(`reviewRounds` و`requestIntake` اسمان من المواصفة؛ التسليم الأول لم يسمِّ مساحة، والثاني بلا تسليم.)

### 1.2 القائمة البيضاء (السطر 73) — تُضاف هذه الأسماء الـ25 داخل المصفوفة

```js
'bank-reconciliation-ui','billing-recurring-ui','cash-close-ui','contracts-register-ui','engagement-ui','feedback-ui','governance-ui','home-ui','expiry-ui','influencers-ui','leave-benefits-ui','letters-ui','pr-ui','equipment-ui','privacy-ui','production-ui','profitability-ui','resourcing-ui','review-rounds-ui','search-ui','tax-returns-ui','wage-protection-ui','lifecycle-ui','einvoice-ui','intake-settings-ui'
```

كل هذه الملفات موجودة فعلًا في `app/static/`. استيراداتها الداخلية الوحيدة `./dates.mjs` (مخدوم أصلًا).

### 1.3 `app/static/operations.mjs` — الاستيرادات (بعد السطر 33)

```js
import { bankReconciliationUI } from './bank-reconciliation-ui.mjs';
import { billingSchedulesUI, retainersUI } from './billing-recurring-ui.mjs';
import { cashForecastUI, closeChecklistUI, accrualsUI } from './cash-close-ui.mjs';
import { contractsRegisterUI } from './contracts-register-ui.mjs';
import { pulseUI, recognitionUI, announcementsUI } from './engagement-ui.mjs';
import { oneToOnesUI, feedbackUI, review360UI } from './feedback-ui.mjs';
import { objectivesUI, risksUI, decisionsUI } from './governance-ui.mjs';
import { homeUI } from './home-ui.mjs';
import { expiryUI } from './expiry-ui.mjs';
import { influencersUI, influencerCampaignsUI } from './influencers-ui.mjs';
import { leaveAccrualUI, benefitsUI } from './leave-benefits-ui.mjs';
import { lettersUI, letterTemplatesUI } from './letters-ui.mjs';
import { prUI, mediaContactsUI } from './pr-ui.mjs';
import { equipmentUI } from './equipment-ui.mjs';
import { privacyUI, subjectRequestsUI } from './privacy-ui.mjs';
import { productionsUI, callSheetsUI } from './production-ui.mjs';
import { costRatesUI, profitabilityUI } from './profitability-ui.mjs';
import { timesheetsUI, resourcingUI } from './resourcing-ui.mjs';
import { reviewRoundsUI, annotationsUI } from './review-rounds-ui.mjs';
import { searchUI } from './search-ui.mjs';
import { vatWorksheetUI, withholdingUI } from './tax-returns-ui.mjs';
import { wpsUI, wageReconciliationUI, payrollAnomalyUI } from './wage-protection-ui.mjs';
import { lifecycleUI, clearanceUI } from './lifecycle-ui.mjs';
import { einvoiceUI, einvoiceSelfcheckUI } from './einvoice-ui.mjs';
import { intakeSettingsUI } from './intake-settings-ui.mjs';
```

### 1.4 `operationModules` — 49 مفتاحًا تُلحق بآخر الكائن (بعد `accounts:accountsUI`)

```js
'bank-reconciliation':bankReconciliationUI,'billing-schedules':billingSchedulesUI,retainers:retainersUI,'cash-forecast':cashForecastUI,'close-checklist':closeChecklistUI,accruals:accrualsUI,'contracts-register':contractsRegisterUI,pulse:pulseUI,recognition:recognitionUI,announcements:announcementsUI,'one-to-ones':oneToOnesUI,feedback:feedbackUI,'review-360':review360UI,objectives:objectivesUI,risks:risksUI,decisions:decisionsUI,home:homeUI,expiry:expiryUI,influencers:influencersUI,'influencer-campaigns':influencerCampaignsUI,'leave-accrual':leaveAccrualUI,benefits:benefitsUI,letters:lettersUI,'letter-templates':letterTemplatesUI,pr:prUI,'media-contacts':mediaContactsUI,equipment:equipmentUI,privacy:privacyUI,'subject-requests':subjectRequestsUI,productions:productionsUI,'call-sheets':callSheetsUI,'cost-rates':costRatesUI,profitability:profitabilityUI,timesheets:timesheetsUI,resourcing:resourcingUI,'review-rounds':reviewRoundsUI,annotations:annotationsUI,search:searchUI,'vat-worksheet':vatWorksheetUI,withholding:withholdingUI,wps:wpsUI,'wage-reconciliation':wageReconciliationUI,'payroll-anomaly':payrollAnomalyUI,lifecycle:lifecycleUI,clearance:clearanceUI,einvoice:einvoiceUI,'einvoice-selfcheck':einvoiceSelfcheckUI,'intake-settings':intakeSettingsUI
```

لا مفتاح منها يكرر مفتاحًا قائمًا في `operationModules` (تحقّقت). لكن ⚠ `home` يحل محل الفرع اليدوي في `app.mjs` — انظر §5.

### 1.5 `groupedNavigation` في `app/static/hr-design.mjs` — السطر 5 كاملًا

التسليمات ذكرت مجموعتين **غير موجودتين** («خدمات الموظف» و«الأساس»). حُوّلتا بجوار المفتاح الذي ذكره التسليم: «خدمات الموظف» ← `الموارد البشرية` (أو `مساحتي` حين كان الجار `leave`/`attendance`)، و«الأساس» ← `مساحتي`.

```js
 const groups=[['مساحتي',['inbox','search','portal','work','home','expiry','announcements','one-to-ones','feedback','letters','attendance','leave','contracts','payroll','expenses','notifications','assistants','security']],['الطلبات والخدمات',['departments','catalog','requests','service-cards','intake-settings']],['الموارد البشرية',['employees','performance','review-360','growth','pulse','recognition','people','lifecycle','clearance','leave-accrual','benefits','letter-templates','payroll-extras','wps','wage-reconciliation','payroll-anomaly']],['التشغيل',['clients','campaigns','content','scope','influencers','influencer-campaigns','pr','media-contacts','productions','call-sheets','equipment','offerings','project-templates','time','timesheets','resourcing','projects','commercial','approvals','studio','review-rounds','annotations','procurement','procurement-extras','vendors','contracts-register','delegations']],['المالية',['budgets','finance','receivables','invoices','einvoice','einvoice-selfcheck','billing-schedules','retainers','payables','bank-reconciliation','cash-forecast','close-checklist','accruals','cost-rates','profitability','vat-worksheet','withholding','assets','statements']],['القيادة',['reports','executive','org','centres','objectives','risks','decisions','compliance','privacy','subject-requests','requirements','service-benchmark','integrations']],['إدارة المنصة',['accounts']]];
```

تنبيه: `groupedNavigation` يرتّب داخل المجموعة **بترتيب `nav.push`** لا بترتيب المصفوفة؛ المصفوفة تحدد المجموعة فقط. مفتاح لا يرد في أي مجموعة يسقط صامتًا.

### 1.6 `allowed()` في `hr-design.mjs` (السطر 17)

أضف المفاتيح الجديدة كلها إلى المصفوفة الأولى (التي تعيد `false`)، وإلا ظهرت كلها بطاقات «مساحات تشغيل مشتركة» لكل غير أدمن لأن الفرع الافتراضي `me.role!=='admin'`:

```js
'bank-reconciliation','billing-schedules','retainers','cash-forecast','close-checklist','accruals','contracts-register','pulse','recognition','announcements','one-to-ones','feedback','review-360','objectives','risks','decisions','home','expiry','influencers','influencer-campaigns','leave-accrual','benefits','letters','letter-templates','pr','media-contacts','equipment','privacy','subject-requests','productions','call-sheets','cost-rates','profitability','timesheets','resourcing','review-rounds','annotations','search','vat-worksheet','withholding','wps','wage-reconciliation','payroll-anomaly','lifecycle','clearance','einvoice','einvoice-selfcheck','intake-settings'
```

ملاحظة: `departmentDirectory` مستورد في `app.mjs` لكنه **لا يُستدعى** (الصفحة الحية تستعمل `workspaceLinks` في `request-picker.mjs` بخريطته `workspaceBindings`)؛ فهذا التعديل يحمي `tests/departments.test.mjs` و`tests/service-catalog.test.mjs` والاتساق، لا الشاشة الحية.

### 1.7 `app/inbox.mjs` — ما يُضاف مجمّعًا

الاستيرادات (بعد السطر 31):

```js
import { bankBoard } from './bank-reconciliation.mjs';
import { schedulesBoard, retainersBoard } from './billing-recurring.mjs';
import { closeBoard } from './close-checklist.mjs';
import { accrualsBoard } from './accruals.mjs';
import { contractAlerts } from './contracts-register.mjs';
import { announcementsBoard } from './engagement.mjs';
import { oneToOnesBoard, feedbackBoard, review360Board } from './feedback.mjs';
import { objectivesBoard, risksBoard, decisionsBoard } from './governance.mjs';
import { expirySources } from './expiry.mjs';
import { influencerCampaignsBoard } from './influencers.mjs';
import { accrualBoard } from './leave-accrual.mjs';
import { lettersBoard, templatesBoard as letterTemplatesBoard } from './letters.mjs';
import { prBoard } from './pr.mjs';
import { equipmentBoard } from './equipment.mjs';
import { privacyBoard, subjectRequestsBoard } from './privacy.mjs';
import { productionsBoard, callSheetsBoard } from './production.mjs';
import { costRatesBoard } from './profitability.mjs';
import { timesheetsBoard } from './timesheets.mjs';
import { resourcingBoard } from './resourcing.mjs';
import { reviewBoard } from './review-rounds.mjs';
import { vatBoard, withholdingBoard } from './tax-returns.mjs';
import { wpsBoard } from './wage-protection.mjs';
import { wageReconciliation } from './wage-reconciliation.mjs';
import { lifecycleBoard } from './lifecycle.mjs';
```

(`templatesBoard` يُعاد تسميته لأن `agency.mjs` يصدّر اسمًا مطابقًا.)

إضافات `DECISIONS` (تُفحص قبل `NOT_DECISIONS`؛ كل واحد منها تحقّقتُ بمحاكاة `labelFor` أنه يسقط اليوم):

```js
mark_issued:'إصدار فاتورة الفترة',close_period:'إقفال فترة الاشتراك',complete_task:'مهمة إقفال عليك',complete_item:'بند متابعة عليك',answer_request:'رد مطلوب',submit_360:'تقييمك مطلوب',prepare_letter:'إعداد الخطاب',lock_list:'قفل القائمة',close_check:'إقفال الجرد',record_check:'مراجعة احتفاظ مستحقة',update_incident:'حادثة مفتوحة عليك',record_filing:'توثيق التقديم',record_remittance:'توثيق التوريد',record_upload:'توثيق الرفع',record_difference:'قرار في فرق الأجر'
```

إضافات `KINDS` (مفاتيح جديدة لا تصطدم؛ انظر §6.2 لماذا لا تُستعمل مفاتيح التسليمات `entries`/`items`/`records`/`templates`):

```js
bank_items:'مطابقة بنكية',drafts:'مسودة فاتورة',advances:'دفعة مقدمة',installments:'قسط إطفاء',follow_ups:'بند متابعة',feedback_requests:'طلب تغذية راجعة',reviews_360:'تقييم 360',initiatives:'مبادرة',risks:'خطر',governance_items:'محضر أو التزام',letters:'خطاب موظف',letter_templates:'قالب خطاب',privacy_items:'حماية البيانات',subject_requests:'طلب صاحب بيانات',worksheets:'ورقة عمل ضريبية',withholding_items:'استقطاع',wps_formats:'مواصفة ملف أجور',wps_exports:'ملف أجور',wage_gaps:'فرق أجر',bundles:'حزمة موظف',steps:'خطوة رحلة',clearance:'بند إخلاء طرف'
```

أسطر `SOURCES` لكل وحدة في قسمها أدناه، ومجمّعة في §6.5.

## 2. الوحدات

صيغة كل قسم: (1) المسارات جدولًا ثم كتلًا حرفية · (2) الاستيراد · (3) الملف الثابت · (4) `operationModules` · (5) التنقل · (6) الصندوق · (7) الترتيب.

---

### 2.1 bank-reconciliation — المطابقة البنكية

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/bank-reconciliation` | `bank.bankBoard(db,u,{bank_account_id?})` | لا / لا |
| GET | `/api/bank-reconciliation/statement` | `bank.reconciliationStatement(db,u,{bank_account_id,period_start,period_end})` | لا / لا |
| GET | `/api/bank-reconciliation/transactions/:id/suggestions` | `bank.suggestMatches(db,u,id,{window_days?})` | لا / لا |
| POST | `/api/bank-reconciliation/accounts` | `bank.createBankAccount(db,u,input)` | نعم / نعم |
| POST | `/api/bank-reconciliation/profiles` | `bank.saveImportProfile(db,u,input)` | نعم / نعم |
| POST | `/api/bank-reconciliation/profiles/:id/deactivate` | `bank.deactivateProfile(db,u,id,input)` | نعم / لا |
| POST | `/api/bank-reconciliation/imports` | `bank.importStatement(db,u,input)` | نعم / نعم |
| POST | `/api/bank-reconciliation/imports/:id/cancel` | `bank.cancelImport(db,u,id,input)` | نعم / لا |
| POST | `/api/bank-reconciliation/matches` | `bank.proposeMatch(db,u,input)` | نعم / نعم |
| POST | `/api/bank-reconciliation/matches/:id/(approve\|reject)` | `bank.decideMatch(db,u,id,decision,input)` | نعم / لا |
| POST | `/api/bank-reconciliation/rules` | `bank.createRule(db,u,input)` | نعم / نعم |
| POST | `/api/bank-reconciliation/rules/:id/deactivate` | `bank.deactivateRule(db,u,id,input)` | نعم / لا |
| POST | `/api/bank-reconciliation/reconciliations` | `bank.prepareReconciliation(db,u,input)` | نعم / نعم |
| POST | `/api/bank-reconciliation/reconciliations/:id/approve` | `bank.approveReconciliation(db,u,id,input)` | نعم / لا |
| POST | `/api/bank-reconciliation/reconciliations/:id/cancel` | `bank.cancelReconciliation(db,u,id,input)` | نعم / لا |

GET:
```js
      if(p==='/api/bank-reconciliation'&&req.method==='GET') {send(200,bank.bankBoard(db,u,url.searchParams.has('bank_account_id')?{bank_account_id:url.searchParams.get('bank_account_id')}:{}));return;}
      if(p==='/api/bank-reconciliation/statement'&&req.method==='GET') {send(200,bank.reconciliationStatement(db,u,{bank_account_id:url.searchParams.get('bank_account_id')??'',period_start:url.searchParams.get('period_start')??'',period_end:url.searchParams.get('period_end')??''}));return;}
      const bankSuggest=p.match(/^\/api\/bank-reconciliation\/transactions\/([a-f0-9-]{36})\/suggestions$/);
      if(bankSuggest&&req.method==='GET') {send(200,bank.suggestMatches(db,u,bankSuggest[1],url.searchParams.has('window_days')?{window_days:Number(url.searchParams.get('window_days'))}:{}));return;}
```
(الدوال الثلاث تفحص الحقول بـ`v.object`، فلا يُمرَّر مفتاح قيمته `undefined` إلا حيث قُبل؛ و`window_days` يجب أن يكون عددًا صحيحًا فحُوِّل بـ`Number`.)

POST:
```js
        if(p==='/api/bank-reconciliation/accounts'&&req.method==='POST') return once(()=>bank.createBankAccount(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/profiles'&&req.method==='POST') return once(()=>bank.saveImportProfile(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/imports'&&req.method==='POST') return once(()=>bank.importStatement(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/matches'&&req.method==='POST') return once(()=>bank.proposeMatch(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/rules'&&req.method==='POST') return once(()=>bank.createRule(db,u,input),id=>({id}));
        if(p==='/api/bank-reconciliation/reconciliations'&&req.method==='POST') return once(()=>bank.prepareReconciliation(db,u,input),id=>({id}));
        const bankProfileStep=p.match(/^\/api\/bank-reconciliation\/profiles\/([a-f0-9-]{36})\/deactivate$/);
        if(bankProfileStep&&req.method==='POST') return bank.deactivateProfile(db,u,bankProfileStep[1],input);
        const bankImportStep=p.match(/^\/api\/bank-reconciliation\/imports\/([a-f0-9-]{36})\/cancel$/);
        if(bankImportStep&&req.method==='POST') return bank.cancelImport(db,u,bankImportStep[1],input);
        const bankMatchStep=p.match(/^\/api\/bank-reconciliation\/matches\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(bankMatchStep&&req.method==='POST') return bank.decideMatch(db,u,bankMatchStep[1],bankMatchStep[2],input);
        const bankRuleStep=p.match(/^\/api\/bank-reconciliation\/rules\/([a-f0-9-]{36})\/deactivate$/);
        if(bankRuleStep&&req.method==='POST') return bank.deactivateRule(db,u,bankRuleStep[1],input);
        const bankReconStep=p.match(/^\/api\/bank-reconciliation\/reconciliations\/([a-f0-9-]{36})\/(approve|cancel)$/);
        if(bankReconStep&&req.method==='POST') return bankReconStep[2]==='approve'?bank.approveReconciliation(db,u,bankReconStep[1],input):bank.cancelReconciliation(db,u,bankReconStep[1],input);
```
- الاستيراد: `import * as bank from './bank-reconciliation.mjs';` · الملف الثابت: `bank-reconciliation-ui` · المفتاح: `'bank-reconciliation':bankReconciliationUI` ← `import { bankReconciliationUI } from './bank-reconciliation-ui.mjs';`
- التنقل: المالية — `if(['bank.reconcile','bank.reconcile.approve'].some(has))nav.push(['bank-reconciliation','▥','المطابقة البنكية','Bank reconciliation']);` (الشرط من رفض اللوحة 403؛ التسليم لم يقترح سطرًا.)
- الصندوق: `['bank-reconciliation','المطابقة البنكية',(db,u)=>({bank_items:bankBoard(db,u).inbox})],` — الفعلان `approve_match` و`approve_reconciliation` ← «اعتماد» بلا تعديل `DECISIONS`.
- الترتيب: لا تداخل. ⚠ حجم الطلب: `importStatement` يقبل حتى 2,000,000 حرف، وحد `body()` 2,900,000 بايت؛ نص عربي UTF-8 قد يتجاوزه فيُرفض بـ`too_large` قبل رسالة الوحدة.

---

### 2.2 billing-recurring — الفوترة الدورية والاشتراكات

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/billing-schedules` | `billingRecurring.schedulesBoard(db,u)` | لا / لا |
| GET | `/api/retainers` | `billingRecurring.retainersBoard(db,u)` | لا / لا |
| GET | `/api/deferred-revenue` | `billingRecurring.deferredRevenue(db,u,asOf)` | لا / لا |
| POST | `/api/billing-schedules` | `billingRecurring.createSchedule(db,u,input)` | نعم / نعم |
| POST | `/api/billing-schedules/:id/(pause_schedule\|resume_schedule\|end_schedule)` | `billingRecurring.scheduleAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/billing-drafts/:id/(mark_issued\|dismiss_draft)` | `billingRecurring.draftAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/advances` | `billingRecurring.recordAdvance(db,u,input)` | نعم / نعم |
| POST | `/api/advances/:id/confirm` | `billingRecurring.confirmAdvance(db,u,id,input)` | نعم / لا |
| POST | `/api/advances/:id/draws` | `billingRecurring.planDraw(db,u,id,input)` | نعم / نعم |
| POST | `/api/advance-draws/:id/apply` | `billingRecurring.applyDraw(db,u,id,input)` | نعم / لا |
| POST | `/api/retainer-agreements` | `billingRecurring.createAgreement(db,u,input)` | نعم / نعم |
| POST | `/api/retainer-agreements/:id/carry-rules` | `billingRecurring.setCarryRules(db,u,id,input)` | نعم / لا |
| POST | `/api/retainer-agreements/:id/threshold` | `billingRecurring.setThreshold(db,u,id,input)` | نعم / لا |
| POST | `/api/retainer-periods` | `billingRecurring.openPeriod(db,u,input)` | نعم / نعم |
| POST | `/api/retainer-periods/:id/consumption` | `billingRecurring.recordConsumption(db,u,id,input)` | نعم / نعم |
| POST | `/api/retainer-periods/:id/close` | `billingRecurring.closePeriod(db,u,id,input)` | نعم / لا |

GET:
```js
      if(p==='/api/billing-schedules'&&req.method==='GET') {send(200,billingRecurring.schedulesBoard(db,u));return;}
      if(p==='/api/retainers'&&req.method==='GET') {send(200,billingRecurring.retainersBoard(db,u));return;}
      if(p==='/api/deferred-revenue'&&req.method==='GET') {send(200,billingRecurring.deferredRevenue(db,u,url.searchParams.get('as_of')??undefined));return;}
```
POST:
```js
        if(p==='/api/billing-schedules'&&req.method==='POST') return once(()=>billingRecurring.createSchedule(db,u,input),id=>({id}));
        const billingScheduleStep=p.match(/^\/api\/billing-schedules\/([a-f0-9-]{36})\/(pause_schedule|resume_schedule|end_schedule)$/);
        if(billingScheduleStep&&req.method==='POST') return billingRecurring.scheduleAction(db,u,billingScheduleStep[1],billingScheduleStep[2],input);
        const billingDraftStep=p.match(/^\/api\/billing-drafts\/([a-f0-9-]{36})\/(mark_issued|dismiss_draft)$/);
        if(billingDraftStep&&req.method==='POST') return billingRecurring.draftAction(db,u,billingDraftStep[1],billingDraftStep[2],input);
        if(p==='/api/advances'&&req.method==='POST') return once(()=>billingRecurring.recordAdvance(db,u,input),id=>({id}));
        const advanceConfirm=p.match(/^\/api\/advances\/([a-f0-9-]{36})\/confirm$/);
        if(advanceConfirm&&req.method==='POST') return billingRecurring.confirmAdvance(db,u,advanceConfirm[1],input);
        const advanceDraw=p.match(/^\/api\/advances\/([a-f0-9-]{36})\/draws$/);
        if(advanceDraw&&req.method==='POST') return once(()=>billingRecurring.planDraw(db,u,advanceDraw[1],input),id=>({id}));
        const drawApply=p.match(/^\/api\/advance-draws\/([a-f0-9-]{36})\/apply$/);
        if(drawApply&&req.method==='POST') return billingRecurring.applyDraw(db,u,drawApply[1],input);
        if(p==='/api/retainer-agreements'&&req.method==='POST') return once(()=>billingRecurring.createAgreement(db,u,input),id=>({id}));
        const agreementStep=p.match(/^\/api\/retainer-agreements\/([a-f0-9-]{36})\/(carry-rules|threshold)$/);
        if(agreementStep&&req.method==='POST') return agreementStep[2]==='carry-rules'?billingRecurring.setCarryRules(db,u,agreementStep[1],input):billingRecurring.setThreshold(db,u,agreementStep[1],input);
        if(p==='/api/retainer-periods'&&req.method==='POST') return once(()=>billingRecurring.openPeriod(db,u,input),id=>({id}));
        const retainerPeriodConsume=p.match(/^\/api\/retainer-periods\/([a-f0-9-]{36})\/consumption$/);
        if(retainerPeriodConsume&&req.method==='POST') return once(()=>billingRecurring.recordConsumption(db,u,retainerPeriodConsume[1],input),id=>({id}));
        const retainerPeriodClose=p.match(/^\/api\/retainer-periods\/([a-f0-9-]{36})\/close$/);
        if(retainerPeriodClose&&req.method==='POST') return billingRecurring.closePeriod(db,u,retainerPeriodClose[1],input);
```
المؤقّت (بعد السطر 534، **خارج أي معاملة** — الدالة تفتح معاملتها لكل فترة):
```js
  const billingRuns=()=>{try{billingRecurring.runDueSchedules(db);}catch(error){console.error('Recurring billing failed:',error.message);}};
  billingRuns();setInterval(billingRuns,15*60*1000).unref();
```
- الاستيراد: `import * as billingRecurring from './billing-recurring.mjs';` · الملف: `billing-recurring-ui` · المفاتيح: `'billing-schedules':billingSchedulesUI` و`retainers:retainersUI` ← `import { billingSchedulesUI, retainersUI } from './billing-recurring-ui.mjs';`
- التنقل: المالية — `if(has('billing.recurring.manage'))nav.push(['billing-schedules','▣','الفوترة الدورية','Recurring billing'],['retainers','◩','اتفاقات الاشتراك','Retainer agreements']);`
- الصندوق (التسليم أعطى استعلامات SQL لا شكل لوحة؛ المشتق من اللوحة الفعلية):
  `['billing-schedules','الفوترة الدورية',schedulesBoard],['retainers','اتفاقات الاشتراك',retainersBoard],`
  ينتج: `confirm_advance` ← «تأكيد»، `dismiss_draft` ← «قرار»، و`mark_issued` و`close_period` بعد إضافتهما إلى `DECISIONS` (§1.7). `apply_draw` يبقى خارج الصندوق (عمل جارٍ).
- الترتيب: لا تداخل. `once` في `consumption` يخزّن `period.id` معرّفًا للمورد (الدالة تعيده هكذا) — صحيح لأن المفتاح مقيد بالمسار.

---

### 2.3 cash-close — التنبؤ النقدي، الإقفال الشهري، الإطفاء

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/cash-forecast` | `cashForecast.cashForecastBoard(db,u)` | لا / لا |
| POST | `/api/cash-forecast/project` | `cashForecast.cashForecastBoard(db,u,input)` — قراءة محضة | نعم (لا ضرر) / **لا** |
| GET | `/api/close-checklist` | `closeChecklist.closeBoard(db,u)` | لا / لا |
| GET | `/api/close-checklist/periods/:id` | `closeChecklist.getClosePeriod(db,u,id)` | لا / لا |
| POST | `/api/close-checklist/templates` | `closeChecklist.createTemplate(db,u,input)` | نعم / نعم |
| POST | `/api/close-checklist/templates/:id/(activate_template\|deactivate_template)` | `closeChecklist.templateAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/close-checklist/periods` | `closeChecklist.openClosePeriod(db,u,input)` | نعم / نعم |
| POST | `/api/close-checklist/periods/:id/(add_task\|approve_close\|request_reopen\|approve_reopen\|reject_reopen)` | `closeChecklist.periodAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/close-checklist/tasks/:id/(complete_task\|reassign_task)` | `closeChecklist.taskAction(db,u,id,action,input)` | نعم / لا |
| GET | `/api/accruals` | `accruals.accrualsBoard(db,u)` | لا / لا |
| GET | `/api/accruals/:id` | `accruals.getSchedule(db,u,id)` | لا / لا |
| POST | `/api/accruals` | `accruals.createSchedule(db,u,input)` | نعم / نعم |
| POST | `/api/accruals/:id/cancel_schedule` | `accruals.scheduleAction(db,u,id,'cancel_schedule',input)` | نعم / لا |
| POST | `/api/accruals/entries/:id/(approve_entry\|cancel_entry)` | `accruals.entryAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/cash-forecast'&&req.method==='GET') {send(200,cashForecast.cashForecastBoard(db,u));return;}
      if(p==='/api/close-checklist'&&req.method==='GET') {send(200,closeChecklist.closeBoard(db,u));return;}
      const closePeriodView=p.match(/^\/api\/close-checklist\/periods\/([a-f0-9-]{36})$/);
      if(closePeriodView&&req.method==='GET') {send(200,closeChecklist.getClosePeriod(db,u,closePeriodView[1]));return;}
      if(p==='/api/accruals'&&req.method==='GET') {send(200,accruals.accrualsBoard(db,u));return;}
      const accrualView=p.match(/^\/api\/accruals\/([a-f0-9-]{36})$/);
      if(accrualView&&req.method==='GET') {send(200,accruals.getSchedule(db,u,accrualView[1]));return;}
```
POST:
```js
        if(p==='/api/cash-forecast/project'&&req.method==='POST') return cashForecast.cashForecastBoard(db,u,input);
        if(p==='/api/close-checklist/templates'&&req.method==='POST') return once(()=>closeChecklist.createTemplate(db,u,input),id=>({id}));
        const closeTemplateStep=p.match(/^\/api\/close-checklist\/templates\/([a-f0-9-]{36})\/(activate_template|deactivate_template)$/);
        if(closeTemplateStep&&req.method==='POST') return closeChecklist.templateAction(db,u,closeTemplateStep[1],closeTemplateStep[2],input);
        if(p==='/api/close-checklist/periods'&&req.method==='POST') return once(()=>closeChecklist.openClosePeriod(db,u,input),id=>({id}));
        const closePeriodStep=p.match(/^\/api\/close-checklist\/periods\/([a-f0-9-]{36})\/(add_task|approve_close|request_reopen|approve_reopen|reject_reopen)$/);
        if(closePeriodStep&&req.method==='POST') return closeChecklist.periodAction(db,u,closePeriodStep[1],closePeriodStep[2],input);
        const closeTaskStep=p.match(/^\/api\/close-checklist\/tasks\/([a-f0-9-]{36})\/(complete_task|reassign_task)$/);
        if(closeTaskStep&&req.method==='POST') return closeChecklist.taskAction(db,u,closeTaskStep[1],closeTaskStep[2],input);
        if(p==='/api/accruals'&&req.method==='POST') return once(()=>accruals.createSchedule(db,u,input),id=>({id}));
        const accrualEntryStep=p.match(/^\/api\/accruals\/entries\/([a-f0-9-]{36})\/(approve_entry|cancel_entry)$/);
        if(accrualEntryStep&&req.method==='POST') return accruals.entryAction(db,u,accrualEntryStep[1],accrualEntryStep[2],input);
        const accrualCancel=p.match(/^\/api\/accruals\/([a-f0-9-]{36})\/cancel_schedule$/);
        if(accrualCancel&&req.method==='POST') return accruals.scheduleAction(db,u,accrualCancel[1],'cancel_schedule',input);
```
- الاستيراد: الثلاثة في §1.1 · الملف: `cash-close-ui` (واحد للمفاتيح الثلاثة) · المفاتيح: `'cash-forecast':cashForecastUI,'close-checklist':closeChecklistUI,accruals:accrualsUI` ← `import { cashForecastUI, closeChecklistUI, accrualsUI } from './cash-close-ui.mjs';`
- التنقل: المالية —
  `if(has('finance.forecast.view'))nav.push(['cash-forecast','◫','التنبؤ النقدي','Cash forecast']);`
  `if(has('finance.close.manage'))nav.push(['close-checklist','◷','الإقفال الشهري','Month-end close'],['accruals','◒','الإطفاء والاستحقاقات','Prepayments & accruals']);`
  (مالك مهمة إقفال بلا التصريح يصلها من «بانتظار قراري».)
- الصندوق:
  `['close-checklist','الإقفال الشهري',(db,u)=>({periods:closeBoard(db,u).inbox})],`
  `['accruals','الإطفاء والاستحقاقات',(db,u)=>({installments:accrualsBoard(db,u).inbox})],`
  ⚠ التسليم اقترح المفتاح `entries` وهو في `KINDS` = «ساعات عمل»؛ بُدّل إلى `installments`. `complete_task` يحتاج `DECISIONS` (§1.7)؛ `approve_close` و`approve_reopen` و`approve_entry` تعمل.
- الترتيب: ضع `accrualEntryStep` قبل `accrualCancel` (كلاهما مثبت بالنمط، لكن `entries` بادئة نصية).

---

### 2.4 contracts-register — سجل العقود

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/contracts-register` | `contractsRegister.contractsRegisterBoard(db,u)` | لا / لا |
| POST | `/api/contracts-register` | `contractsRegister.createContract(db,u,input)` | نعم / نعم |
| POST | `/api/contracts-register/settings` | `contractsRegister.setAlertSettings(db,u,input)` | نعم / لا |
| POST | `/api/contracts-register/amendments/:id/confirm_amendment` | `contractsRegister.amendmentAction(db,u,id,'confirm_amendment',input)` | نعم / لا |
| POST | `/api/contracts-register/obligations/:id/(complete_obligation\|verify_obligation\|deactivate_obligation\|activate_obligation)` | `contractsRegister.obligationAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/contracts-register/:id/edit_contract` | `contractsRegister.updateContract(db,u,id,input)` | نعم / لا |
| POST | `/api/contracts-register/:id/record_amendment` | `contractsRegister.recordAmendment(db,u,id,input)` | نعم / نعم |
| POST | `/api/contracts-register/:id/add_obligation` | `contractsRegister.addObligation(db,u,id,input)` | نعم / نعم |
| POST | `/api/contracts-register/:id/(activate_contract\|cancel_contract\|terminate_contract\|decide_renewal)` | `contractsRegister.contractAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/contracts-register'&&req.method==='GET') {send(200,contractsRegister.contractsRegisterBoard(db,u));return;}
```
POST:
```js
        if(p==='/api/contracts-register'&&req.method==='POST') return once(()=>contractsRegister.createContract(db,u,input),id=>({id}));
        if(p==='/api/contracts-register/settings'&&req.method==='POST') return contractsRegister.setAlertSettings(db,u,input);
        const contractAmendmentStep=p.match(/^\/api\/contracts-register\/amendments\/([a-f0-9-]{36})\/confirm_amendment$/);
        if(contractAmendmentStep&&req.method==='POST') return contractsRegister.amendmentAction(db,u,contractAmendmentStep[1],'confirm_amendment',input);
        const contractObligationStep=p.match(/^\/api\/contracts-register\/obligations\/([a-f0-9-]{36})\/(complete_obligation|verify_obligation|deactivate_obligation|activate_obligation)$/);
        if(contractObligationStep&&req.method==='POST') return contractsRegister.obligationAction(db,u,contractObligationStep[1],contractObligationStep[2],input);
        const contractRecordStep=p.match(/^\/api\/contracts-register\/([a-f0-9-]{36})\/(edit_contract|record_amendment|add_obligation|activate_contract|cancel_contract|terminate_contract|decide_renewal)$/);
        if(contractRecordStep&&req.method==='POST'){
          const [,contractId,contractStepName]=contractRecordStep;
          if(contractStepName==='edit_contract')return contractsRegister.updateContract(db,u,contractId,input);
          if(contractStepName==='record_amendment')return once(()=>contractsRegister.recordAmendment(db,u,contractId,input),id=>({id}));
          if(contractStepName==='add_obligation')return once(()=>contractsRegister.addObligation(db,u,contractId,input),id=>({id}));
          return contractsRegister.contractAction(db,u,contractId,contractStepName,input);
        }
```
- الاستيراد: `import * as contractsRegister from './contracts-register.mjs';` · الملف: `contracts-register-ui` · المفتاح: `'contracts-register':contractsRegisterUI` ← `import { contractsRegisterUI } from './contracts-register-ui.mjs';`
- التنقل: التشغيل، بعد سطر `vendors` (السطر 74 في `app.mjs`) — من التسليم حرفيًا:
  `if(['contracts.register.view','contracts.register.manage'].some(has))nav.push(['contracts-register','▤','سجل العقود','Contract register']);`
- الصندوق (من التسليم): `['contracts-register','سجل العقود والتجديدات',contractAlerts],` — لا تعديل `DECISIONS`.
- الترتيب: ⚠ **لا تسمِّ المتغير `obligationStep`** — موجود للسطر 239 (`compliance`). المساران `amendments/` و`obligations/` قبل `contractRecordStep` (التسليم أوصى بذلك).

---

### 2.5 engagement — النبض والتقدير والإعلانات

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/engagement/pulse` | `engagement.pulseBoard(db,u)` | لا / لا |
| GET | `/api/engagement/recognition` | `engagement.recognitionBoard(db,u)` | لا / لا |
| GET | `/api/engagement/announcements` | `engagement.announcementsBoard(db,u)` | لا / لا |
| GET | `/api/engagement/announcements/files/:id` | `engagement.downloadAnnouncementFile(db,u,id)` — رد خام | **نعم** (تكتب تدقيقًا) / لا |
| POST | `/api/engagement/pulse/privacy` | `engagement.setSurveyPrivacy(db,u,input)` | نعم / نعم |
| POST | `/api/engagement/pulse/cycles` | `engagement.createCycle(db,u,input)` | نعم / نعم |
| POST | `/api/engagement/pulse/cycles/:id` | `engagement.editCycle(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/pulse/cycles/:id/approve` | `engagement.approveCycle(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/pulse/cycles/:id/close` | `engagement.closeCycle(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/pulse/cycles/:id/respond` | `engagement.submitPulse(db,u,id,input)` | نعم / نعم |
| POST | `/api/engagement/recognition/values` | `engagement.defineValue(db,u,input)` | نعم / نعم |
| POST | `/api/engagement/recognition/values/:id/retire` | `engagement.retireValue(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/recognition/cards` | `engagement.sendRecognition(db,u,input)` | نعم / نعم |
| POST | `/api/engagement/announcements` | `engagement.draftAnnouncement(db,u,input)` | نعم / نعم |
| POST | `/api/engagement/announcements/events` | `engagement.createEvent(db,u,input)` | نعم / نعم |
| POST | `/api/engagement/announcements/events/:id/cancel` | `engagement.cancelEvent(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/announcements/:id` | `engagement.editAnnouncement(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/announcements/:id/attachments` | `engagement.attachToAnnouncement(db,u,id,input)` | نعم / نعم |
| POST | `/api/engagement/announcements/:id/approve` | `engagement.approveAnnouncement(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/announcements/:id/withdraw` | `engagement.withdrawAnnouncement(db,u,id,input)` | نعم / لا |
| POST | `/api/engagement/announcements/:id/acknowledge` | `engagement.acknowledgeAnnouncement(db,u,id)` — **بلا `input`** | نعم / لا |

GET:
```js
      if(p==='/api/engagement/pulse'&&req.method==='GET') {send(200,engagement.pulseBoard(db,u));return;}
      if(p==='/api/engagement/recognition'&&req.method==='GET') {send(200,engagement.recognitionBoard(db,u));return;}
      if(p==='/api/engagement/announcements'&&req.method==='GET') {send(200,engagement.announcementsBoard(db,u));return;}
      const announcementFile=p.match(/^\/api\/engagement\/announcements\/files\/([a-f0-9-]{36})$/);
      if(announcementFile&&req.method==='GET') {
        const f=transaction(db,()=>engagement.downloadAnnouncementFile(db,u,announcementFile[1]));
        res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'Content-Length':f.content.length});res.end(f.content);return;
      }
```
POST:
```js
        if(p==='/api/engagement/pulse/privacy'&&req.method==='POST') return once(()=>engagement.setSurveyPrivacy(db,u,input),id=>({id}));
        if(p==='/api/engagement/pulse/cycles'&&req.method==='POST') return once(()=>engagement.createCycle(db,u,input),id=>({id}));
        const pulseCycleEdit=p.match(/^\/api\/engagement\/pulse\/cycles\/([a-f0-9-]{36})$/);
        if(pulseCycleEdit&&req.method==='POST') return engagement.editCycle(db,u,pulseCycleEdit[1],input);
        const pulseCycleStep=p.match(/^\/api\/engagement\/pulse\/cycles\/([a-f0-9-]{36})\/(approve|close|respond)$/);
        if(pulseCycleStep&&req.method==='POST'){
          if(pulseCycleStep[2]==='respond')return once(()=>engagement.submitPulse(db,u,pulseCycleStep[1],input),id=>({id}));
          return pulseCycleStep[2]==='approve'?engagement.approveCycle(db,u,pulseCycleStep[1],input):engagement.closeCycle(db,u,pulseCycleStep[1],input);
        }
        if(p==='/api/engagement/recognition/values'&&req.method==='POST') return once(()=>engagement.defineValue(db,u,input),id=>({id}));
        const recognitionValueRetire=p.match(/^\/api\/engagement\/recognition\/values\/([a-f0-9-]{36})\/retire$/);
        if(recognitionValueRetire&&req.method==='POST') return engagement.retireValue(db,u,recognitionValueRetire[1],input);
        if(p==='/api/engagement/recognition/cards'&&req.method==='POST') return once(()=>engagement.sendRecognition(db,u,input),id=>({id}));
        if(p==='/api/engagement/announcements/events'&&req.method==='POST') return once(()=>engagement.createEvent(db,u,input),id=>({id}));
        const announcementEventCancel=p.match(/^\/api\/engagement\/announcements\/events\/([a-f0-9-]{36})\/cancel$/);
        if(announcementEventCancel&&req.method==='POST') return engagement.cancelEvent(db,u,announcementEventCancel[1],input);
        if(p==='/api/engagement/announcements'&&req.method==='POST') return once(()=>engagement.draftAnnouncement(db,u,input),id=>({id}));
        const announcementEdit=p.match(/^\/api\/engagement\/announcements\/([a-f0-9-]{36})$/);
        if(announcementEdit&&req.method==='POST') return engagement.editAnnouncement(db,u,announcementEdit[1],input);
        const announcementStep=p.match(/^\/api\/engagement\/announcements\/([a-f0-9-]{36})\/(attachments|approve|withdraw|acknowledge)$/);
        if(announcementStep&&req.method==='POST'){
          const [,announcementId,announcementAction]=announcementStep;
          if(announcementAction==='attachments')return once(()=>engagement.attachToAnnouncement(db,u,announcementId,input),id=>({id}));
          if(announcementAction==='approve')return engagement.approveAnnouncement(db,u,announcementId,input);
          if(announcementAction==='withdraw')return engagement.withdrawAnnouncement(db,u,announcementId,input);
          return engagement.acknowledgeAnnouncement(db,u,announcementId);
        }
```
- الاستيراد: `import * as engagement from './engagement.mjs';` · الملف: `engagement-ui` · المفاتيح: `pulse:pulseUI,recognition:recognitionUI,announcements:announcementsUI` ← `import { pulseUI, recognitionUI, announcementsUI } from './engagement-ui.mjs';`
- التنقل: `pulse` و`recognition` ← الموارد البشرية؛ `announcements` ← مساحتي. التسليم لم يحدد شرطًا؛ المقترح:
  `if(has('portal.use'))nav.push(['announcements','◉','الإعلانات الداخلية','Announcements'],['pulse','◌','نبض الموظفين','Pulse survey'],['recognition','✦','التقدير','Recognition']);`
- الصندوق (من التسليم): `['announcements','الإعلانات الداخلية',(db,u)=>({announcements:announcementsBoard(db,u).awaiting_me})],` — `acknowledge` و`approve_announcement` يعملان. النبض خارج الصندوق عمدًا.
- الترتيب: `events` قبل `announcementEdit` (نصي لا UUID فلا التقاط، لكن اجعله قبله). ⚠ الواجهة ترسل `Idempotency-Key` فقط عند `create_cycle` و`draft_announcement` — والتحرير على مسار مختلف، فلا تعارض. ⚠ `announcementStep` اسم جديد (لا تستعمل `cycleStep` — موجود للسطر 251).

---

### 2.6 feedback — اللقاءات الفردية، التغذية الراجعة، تقييم 360

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/one-to-ones` | `feedback.oneToOnesBoard(db,u)` | لا / لا |
| GET | `/api/feedback` | `feedback.feedbackBoard(db,u)` | لا / لا |
| GET | `/api/review-360` | `feedback.review360Board(db,u)` | لا / لا |
| GET | `/api/feedback/evidence/:reviewId` | `feedback.feedbackEvidence(db,u,reviewId)` | لا / لا |
| POST | `/api/one-to-ones` | `feedback.scheduleOneToOne(db,u,input)` | نعم / نعم |
| POST | `/api/one-to-ones/items/:id/(complete_item\|drop_item)` | `feedback.followUpAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/one-to-ones/:id/(add_agenda\|add_follow_up\|save_private_note\|record_held\|cancel_meeting)` | `feedback.meetingAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/feedback/notes` | `feedback.writeFeedback(db,u,input)` | نعم / نعم |
| POST | `/api/feedback/notes/:id/withdraw_note` | `feedback.noteAction(db,u,id,'withdraw_note',input)` | نعم / لا |
| POST | `/api/feedback/requests` | `feedback.requestFeedback(db,u,input)` | نعم / نعم |
| POST | `/api/feedback/requests/:id/(answer_request\|decline_request)` | `feedback.requestAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/review-360/threshold` | `feedback.setUpwardThreshold(db,u,input)` | نعم / لا |
| POST | `/api/review-360/nominations` | `feedback.nominate(db,u,input)` | نعم / نعم |
| POST | `/api/review-360/nominations/:id/(approve_nomination\|reject_nomination)` | `feedback.nominationAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/review-360/nominations/:id/submit` | `feedback.submit360(db,u,id,input)` | نعم / لا |

GET (من التسليم حرفيًا، تحقّقت):
```js
      if(p==='/api/one-to-ones'&&req.method==='GET') {send(200,feedback.oneToOnesBoard(db,u));return;}
      if(p==='/api/feedback'&&req.method==='GET') {send(200,feedback.feedbackBoard(db,u));return;}
      if(p==='/api/review-360'&&req.method==='GET') {send(200,feedback.review360Board(db,u));return;}
      const feedbackEvidence=p.match(/^\/api\/feedback\/evidence\/([a-f0-9-]{36})$/);
      if(feedbackEvidence&&req.method==='GET') {send(200,feedback.feedbackEvidence(db,u,feedbackEvidence[1]));return;}
```
POST (من التسليم، مع إعادة تسمية `requestStep` ← `feedbackRequestStep` لتفادي اصطدام مع الخصوصية):
```js
        if(p==='/api/one-to-ones'&&req.method==='POST') return once(()=>feedback.scheduleOneToOne(db,u,input),id=>({id}));
        const followUpStep=p.match(/^\/api\/one-to-ones\/items\/([a-f0-9-]{36})\/(complete_item|drop_item)$/);
        if(followUpStep&&req.method==='POST') return feedback.followUpAction(db,u,followUpStep[1],followUpStep[2],input);
        const meetingStep=p.match(/^\/api\/one-to-ones\/([a-f0-9-]{36})\/(add_agenda|add_follow_up|save_private_note|record_held|cancel_meeting)$/);
        if(meetingStep&&req.method==='POST') return feedback.meetingAction(db,u,meetingStep[1],meetingStep[2],input);
        if(p==='/api/feedback/notes'&&req.method==='POST') return once(()=>feedback.writeFeedback(db,u,input),id=>({id}));
        const noteStep=p.match(/^\/api\/feedback\/notes\/([a-f0-9-]{36})\/withdraw_note$/);
        if(noteStep&&req.method==='POST') return feedback.noteAction(db,u,noteStep[1],'withdraw_note',input);
        if(p==='/api/feedback/requests'&&req.method==='POST') return once(()=>feedback.requestFeedback(db,u,input),id=>({id}));
        const feedbackRequestStep=p.match(/^\/api\/feedback\/requests\/([a-f0-9-]{36})\/(answer_request|decline_request)$/);
        if(feedbackRequestStep&&req.method==='POST') return feedback.requestAction(db,u,feedbackRequestStep[1],feedbackRequestStep[2],input);
        if(p==='/api/review-360/threshold'&&req.method==='POST') return feedback.setUpwardThreshold(db,u,input);
        if(p==='/api/review-360/nominations'&&req.method==='POST') return once(()=>feedback.nominate(db,u,input),id=>({id}));
        const nominationStep=p.match(/^\/api\/review-360\/nominations\/([a-f0-9-]{36})\/(approve_nomination|reject_nomination)$/);
        if(nominationStep&&req.method==='POST') return feedback.nominationAction(db,u,nominationStep[1],nominationStep[2],input);
        const submit360=p.match(/^\/api\/review-360\/nominations\/([a-f0-9-]{36})\/submit$/);
        if(submit360&&req.method==='POST') return feedback.submit360(db,u,submit360[1],input);
```
- الاستيراد: `import * as feedback from './feedback.mjs';` (لا يصطدم بـ`feedbackView` و`recordFeedback` من `service-feedback.mjs` ولا بـ`feedbackPath`) · الملف: `feedback-ui` · المفاتيح: `'one-to-ones':oneToOnesUI,feedback:feedbackUI,'review-360':review360UI` ← `import { oneToOnesUI, feedbackUI, review360UI } from './feedback-ui.mjs';`
- التنقل: `one-to-ones` و`feedback` ← مساحتي؛ `review-360` ← الموارد البشرية. التسليم ذكر `portal.use` حدًّا أدنى:
  `if(has('portal.use'))nav.push(['one-to-ones','⇆','اللقاءات الفردية','One-to-ones'],['feedback','✎','التغذية الراجعة','Feedback'],['review-360','◎','تقييم 360','360 review']);`
- الصندوق (من التسليم مع تبديل المفاتيح المصطدمة `items`/`records`/`reviews`):
  ```js
  ['one-to-ones','اللقاءات الفردية',(db,u)=>({follow_ups:oneToOnesBoard(db,u).my_open_items.map(i=>({...i,actions:['complete_item']}))})],
  ['feedback','التغذية الراجعة',(db,u)=>({feedback_requests:feedbackBoard(db,u).requests_to_me.filter(r=>r.status==='open')})],
  ['review-360','تقييم 360',(db,u)=>({reviews_360:review360Board(db,u).cycles.flatMap(c=>[...c.my_tasks,...c.panels.flatMap(p=>p.nominations.filter(n=>n.actions.length))])})],
  ```
  يحتاج `DECISIONS`: `complete_item` و`answer_request` و`submit_360` (§1.7). `approve_nomination` يعمل. **لا تمرّر `meetings`** (خصوصية المحضر).
- الترتيب: `items/` قبل `/:id/` (التقاط مستحيل مع UUID لكن أبقه). `submit` منفصل عن مسار القرار.

---

### 2.7 governance — الأهداف والمخاطر والقرارات

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/governance/objectives` · `/risks` · `/decisions` | `governance.objectivesBoard(db,u)` · `risksBoard` · `decisionsBoard` | لا / لا |
| POST | `/api/governance/objectives` | `governance.createObjective(db,u,input)` | نعم / نعم |
| POST | `/api/governance/objectives/:id/(edit_objective\|close_objective)` | `governance.objectiveAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/governance/initiatives` | `governance.createInitiative(db,u,input)` | نعم / نعم |
| POST | `/api/governance/initiatives/:id/(edit_initiative\|approve_initiative\|start_initiative\|complete_initiative\|stop_initiative\|cancel_initiative)` | `governance.initiativeAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/governance/indicators` | `governance.createIndicator(db,u,input)` | نعم / نعم |
| POST | `/api/governance/indicators/:id/record_measurement` | `governance.recordMeasurement(db,u,id,input)` — بلا `action` | نعم / لا |
| POST | `/api/governance/risk-scale` | `governance.saveRiskScale(db,u,input)` | نعم / لا |
| POST | `/api/governance/risks` | `governance.createRisk(db,u,input)` | نعم / نعم |
| POST | `/api/governance/risks/:id/(edit_risk\|review_risk\|accept_risk\|close_risk)` | `governance.riskAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/governance/decisions` | `governance.recordDecision(db,u,input)` | نعم / نعم |
| POST | `/api/governance/minutes` | `governance.createMinute(db,u,input)` | نعم / نعم |
| POST | `/api/governance/minutes/:id/(edit_minute\|approve_minute)` | `governance.minuteAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/governance/commitments` | `governance.createCommitment(db,u,input)` | نعم / نعم |
| POST | `/api/governance/commitments/:id/(record_execution\|cancel_commitment)` | `governance.commitmentAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/governance/objectives'&&req.method==='GET') {send(200,governance.objectivesBoard(db,u));return;}
      if(p==='/api/governance/risks'&&req.method==='GET') {send(200,governance.risksBoard(db,u));return;}
      if(p==='/api/governance/decisions'&&req.method==='GET') {send(200,governance.decisionsBoard(db,u));return;}
```
POST:
```js
        if(p==='/api/governance/objectives'&&req.method==='POST') return once(()=>governance.createObjective(db,u,input),id=>({id}));
        const objectiveStep=p.match(/^\/api\/governance\/objectives\/([a-f0-9-]{36})\/(edit_objective|close_objective)$/);
        if(objectiveStep&&req.method==='POST') return governance.objectiveAction(db,u,objectiveStep[1],objectiveStep[2],input);
        if(p==='/api/governance/initiatives'&&req.method==='POST') return once(()=>governance.createInitiative(db,u,input),id=>({id}));
        const initiativeStep=p.match(/^\/api\/governance\/initiatives\/([a-f0-9-]{36})\/(edit_initiative|approve_initiative|start_initiative|complete_initiative|stop_initiative|cancel_initiative)$/);
        if(initiativeStep&&req.method==='POST') return governance.initiativeAction(db,u,initiativeStep[1],initiativeStep[2],input);
        if(p==='/api/governance/indicators'&&req.method==='POST') return once(()=>governance.createIndicator(db,u,input),id=>({id}));
        const indicatorMeasure=p.match(/^\/api\/governance\/indicators\/([a-f0-9-]{36})\/record_measurement$/);
        if(indicatorMeasure&&req.method==='POST') return governance.recordMeasurement(db,u,indicatorMeasure[1],input);
        if(p==='/api/governance/risk-scale'&&req.method==='POST') return governance.saveRiskScale(db,u,input);
        if(p==='/api/governance/risks'&&req.method==='POST') return once(()=>governance.createRisk(db,u,input),id=>({id}));
        const riskStep=p.match(/^\/api\/governance\/risks\/([a-f0-9-]{36})\/(edit_risk|review_risk|accept_risk|close_risk)$/);
        if(riskStep&&req.method==='POST') return governance.riskAction(db,u,riskStep[1],riskStep[2],input);
        if(p==='/api/governance/decisions'&&req.method==='POST') return once(()=>governance.recordDecision(db,u,input),id=>({id}));
        if(p==='/api/governance/minutes'&&req.method==='POST') return once(()=>governance.createMinute(db,u,input),id=>({id}));
        const minuteStep=p.match(/^\/api\/governance\/minutes\/([a-f0-9-]{36})\/(edit_minute|approve_minute)$/);
        if(minuteStep&&req.method==='POST') return governance.minuteAction(db,u,minuteStep[1],minuteStep[2],input);
        if(p==='/api/governance/commitments'&&req.method==='POST') return once(()=>governance.createCommitment(db,u,input),id=>({id}));
        const commitmentStep=p.match(/^\/api\/governance\/commitments\/([a-f0-9-]{36})\/(record_execution|cancel_commitment)$/);
        if(commitmentStep&&req.method==='POST') return governance.commitmentAction(db,u,commitmentStep[1],commitmentStep[2],input);
```
- الاستيراد: `import * as governance from './governance.mjs';` · الملف: `governance-ui` · المفاتيح: `objectives:objectivesUI,risks:risksUI,decisions:decisionsUI` ← `import { objectivesUI, risksUI, decisionsUI } from './governance-ui.mjs';`
- التقارير (خارج `server.mjs`): في `app/reports.mjs` `import { GOVERNANCE_REPORTS } from './reports-governance.mjs';` وإلحاقها في السطر الذي يدفع `MORE_REPORTS`: `REPORTS.push(...MORE_REPORTS,...GOVERNANCE_REPORTS);` (R02 وR03 وR05).
- التنقل: القيادة. التسليم لم يحدد شرطًا؛ المقترح من تصاريحه:
  `if(['governance.objectives.manage','governance.risks.manage','governance.decisions.record','executive.view'].some(has))nav.push(['objectives','◎','الأهداف والمبادرات','Objectives'],['risks','⚠','سجل المخاطر','Risk register'],['decisions','⚖','القرارات والالتزامات','Decisions']);`
- الصندوق (من التسليم مع تبديل `items` المصطدم):
  `['objectives','الأهداف والمبادرات',(db,u)=>({initiatives:objectivesBoard(db,u).inbox})],['risks','سجل المخاطر',(db,u)=>({risks:risksBoard(db,u).inbox})],['decisions','القرارات والالتزامات',(db,u)=>({governance_items:decisionsBoard(db,u).inbox})],`
- الترتيب: لا تداخل (كل الأفعال بتناوب صريح).

---

### 2.8 home-expiry — الصفحة الرئيسية ومراقبة الانتهاء

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/home` | `home.homeBoard(db,u)` | لا / لا |
| GET | `/api/expiry` | `expiry.expiryBoard(db,u)` | لا / لا |
| POST | `/api/expiry/settings/:doc_kind` | `expiry.saveExpiryWatch(db,u,docKind,input)` | نعم / **شرطي** ⚠ |

GET:
```js
      if(p==='/api/home'&&req.method==='GET') {send(200,home.homeBoard(db,u));return;}
      if(p==='/api/expiry'&&req.method==='GET') {send(200,expiry.expiryBoard(db,u));return;}
```
POST — ⚠ **يخالف التسليم عمدًا**: (أ) الواجهة ترسل المفتاح عند الإدخال الأول فقط (`idempotent:!s`)، فـ`once` غير المشروط يرفض كل تعديل بـ400؛ (ب) `saveExpiryWatch` يعيد `{doc_kind}` بلا `id`، فيفشل إدراج `resource_id NOT NULL`:
```js
        const expirySetting=p.match(/^\/api\/expiry\/settings\/([a-z][a-z_]*(?:\.[a-z_]+)?)$/);
        if(expirySetting&&req.method==='POST') return req.headers['idempotency-key']?once(()=>({id:expirySetting[1],...expiry.saveExpiryWatch(db,u,expirySetting[1],input)}),key=>({doc_kind:key})):expiry.saveExpiryWatch(db,u,expirySetting[1],input);
```
- الاستيراد: `import * as home from './home.mjs';` و`import * as expiry from './expiry.mjs';` · الملفات: `home-ui` و`expiry-ui` · المفاتيح: `home:homeUI` ← `import { homeUI } from './home-ui.mjs';` · `expiry:expiryUI` ← `import { expiryUI } from './expiry-ui.mjs';`
- التنقل: مساحتي. `home` موجود أصلًا (السطر 65). لـ`expiry` من التسليم حرفيًا: `nav.push(['expiry','◷','مراقبة انتهاء الوثائق','Document expiry']);` بلا شرط.
- الصندوق (من التسليم): `['expiry','انتهاء الوثائق',expirySources],` — `review_expiry` ← «مراجعة».
- ⚠ تسجيل `home` يُسقط الفرع اليدوي لـ`home` في `app.mjs` (السطر 129–138) — انظر §5.

---

### 2.9 influencers — المؤثرون

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/influencers` | `influencers.influencersBoard(db,u)` | لا / لا |
| GET | `/api/influencer-campaigns` | `influencers.influencerCampaignsBoard(db,u)` | لا / لا |
| POST | `/api/influencers` | `influencers.createInfluencer(db,u,input)` | نعم / نعم |
| POST | `/api/influencers/:id/(edit_influencer\|add_account\|retire_account\|record_snapshot\|set_licence\|link_vendor\|set_status)` | `influencers.influencerAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/influencer-engagements` | `influencers.createEngagement(db,u,input)` | نعم / نعم |
| POST | `/api/influencer-engagements/:id/content` | `influencers.addContent(db,u,id,input)` | نعم / نعم |
| POST | `/api/influencer-engagements/:id/(edit_engagement\|request_review\|approve_engagement\|return_engagement\|complete_engagement\|cancel_engagement\|link_payment)` | `influencers.engagementAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/influencer-content/:id/(edit_content\|submit_content\|approve_content\|return_content\|record_client_approval\|record_proof\|cancel_content)` | `influencers.contentAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/influencer-proofs/:id/verify` | `influencers.verifyProof(db,u,id,input)` | نعم / لا |

GET:
```js
      if(p==='/api/influencers'&&req.method==='GET') {send(200,influencers.influencersBoard(db,u));return;}
      if(p==='/api/influencer-campaigns'&&req.method==='GET') {send(200,influencers.influencerCampaignsBoard(db,u));return;}
```
POST:
```js
        if(p==='/api/influencers'&&req.method==='POST') return once(()=>influencers.createInfluencer(db,u,input),id=>({id}));
        const influencerStep=p.match(/^\/api\/influencers\/([a-f0-9-]{36})\/(edit_influencer|add_account|retire_account|record_snapshot|set_licence|link_vendor|set_status)$/);
        if(influencerStep&&req.method==='POST') return influencers.influencerAction(db,u,influencerStep[1],influencerStep[2],input);
        if(p==='/api/influencer-engagements'&&req.method==='POST') return once(()=>influencers.createEngagement(db,u,input),id=>({id}));
        const influencerContentAdd=p.match(/^\/api\/influencer-engagements\/([a-f0-9-]{36})\/content$/);
        if(influencerContentAdd&&req.method==='POST') return once(()=>influencers.addContent(db,u,influencerContentAdd[1],input),id=>({id}));
        const influencerEngagementStep=p.match(/^\/api\/influencer-engagements\/([a-f0-9-]{36})\/(edit_engagement|request_review|approve_engagement|return_engagement|complete_engagement|cancel_engagement|link_payment)$/);
        if(influencerEngagementStep&&req.method==='POST') return influencers.engagementAction(db,u,influencerEngagementStep[1],influencerEngagementStep[2],input);
        const influencerContentStep=p.match(/^\/api\/influencer-content\/([a-f0-9-]{36})\/(edit_content|submit_content|approve_content|return_content|record_client_approval|record_proof|cancel_content)$/);
        if(influencerContentStep&&req.method==='POST') return influencers.contentAction(db,u,influencerContentStep[1],influencerContentStep[2],input);
        const influencerProofVerify=p.match(/^\/api\/influencer-proofs\/([a-f0-9-]{36})\/verify$/);
        if(influencerProofVerify&&req.method==='POST') return influencers.verifyProof(db,u,influencerProofVerify[1],input);
```
- الاستيراد: `import * as influencers from './influencers.mjs';` · الملف: `influencers-ui` · المفاتيح: `influencers:influencersUI,'influencer-campaigns':influencerCampaignsUI` ← `import { influencersUI, influencerCampaignsUI } from './influencers-ui.mjs';`
- التنقل: التشغيل — من التسليم حرفيًا: `if(has('influencers.manage'))nav.push(['influencers','◐','المؤثرون','Influencers'],['influencer-campaigns','◑','ارتباطات المؤثرين','Influencer engagements']);`
- الصندوق: `['influencer-campaigns','ارتباطات المؤثرين',influencerCampaignsBoard],` (اللوحة الأولى لا تنتج قرارات؛ حذفتها). الأفعال الستة تعمل بلا تعديل (تحقّقت: `verify_proof`←«تحقق»، `record_client_approval`←«توثيق موافقة العميل»).
- الترتيب: `content` قبل `influencerEngagementStep` (التناوب الصريح يمنع الالتقاط أصلًا).

---

### 2.10 leave-benefits — استحقاق الإجازات والمزايا

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/leave-accrual` | `leaveAccrual.accrualBoard(db,u)` | لا / لا |
| GET | `/api/leave-accrual/settlement/:employeeId` | `leaveAccrual.accrualSettlementView(db,u,employeeId)` | لا / لا |
| POST | `/api/leave-accrual/policies` | `leaveAccrual.prepareAccrualPolicy(db,u,input)` | نعم / نعم |
| POST | `/api/leave-accrual/policies/:id` | `leaveAccrual.updateAccrualPolicyDraft(db,u,id,input)` | نعم / لا |
| POST | `/api/leave-accrual/policies/:id/(accept\|reject)` | `leaveAccrual.decideAccrualPolicy(db,u,id,decision,input)` | نعم / لا |
| POST | `/api/leave-accrual/runs` | `leaveAccrual.runAccrualCycle(db,u,input)` | نعم / نعم |
| POST | `/api/leave-accrual/adjustments` | `leaveAccrual.recordAccrualAdjustment(db,u,input)` | نعم / نعم ⚠ |
| GET | `/api/benefits` | `benefits.benefitsBoard(db,u)` | لا / لا |
| POST | `/api/benefits/policies` | `benefits.recordMedicalPolicy(db,u,input)` | نعم / نعم |
| POST | `/api/benefits/policies/:id` | `benefits.updateMedicalPolicy(db,u,id,input)` | نعم / لا |
| POST | `/api/benefits/enrolments` | `benefits.recordEnrolment(db,u,input)` | نعم / نعم |
| POST | `/api/benefits/enrolments/:id/confirm` | `benefits.enrolmentAction(db,u,id,'confirm_enrolment',input)` | نعم / لا |
| POST | `/api/benefits/enrolments/:id/remove` | `benefits.enrolmentAction(db,u,id,'remove_enrolment',input)` | نعم / لا |
| POST | `/api/benefits/enrolments/:id/dependants` | `benefits.addDependant(db,u,input)` — المعرّف في `input.enrolment_id` | نعم / نعم |
| POST | `/api/benefits/dependants/:id/remove` | `benefits.removeDependant(db,u,id,input)` | نعم / لا |

GET:
```js
      if(p==='/api/leave-accrual'&&req.method==='GET') {send(200,leaveAccrual.accrualBoard(db,u));return;}
      const accrualSettlement=p.match(/^\/api\/leave-accrual\/settlement\/([a-z0-9._-]+)$/);
      if(accrualSettlement&&req.method==='GET') {send(200,leaveAccrual.accrualSettlementView(db,u,accrualSettlement[1]));return;}
      if(p==='/api/benefits'&&req.method==='GET') {send(200,benefits.benefitsBoard(db,u));return;}
```
POST — ⚠ `recordAccrualAdjustment` يعيد رصيدًا (`accrualBalance`) بلا `id`، فيُلف:
```js
        if(p==='/api/leave-accrual/policies'&&req.method==='POST') return once(()=>leaveAccrual.prepareAccrualPolicy(db,u,input),id=>({id}));
        const accrualPolicyStep=p.match(/^\/api\/leave-accrual\/policies\/([0-9a-f-]{36})(?:\/(accept|reject))?$/);
        if(accrualPolicyStep&&req.method==='POST') return accrualPolicyStep[2]?leaveAccrual.decideAccrualPolicy(db,u,accrualPolicyStep[1],accrualPolicyStep[2],input):leaveAccrual.updateAccrualPolicyDraft(db,u,accrualPolicyStep[1],input);
        if(p==='/api/leave-accrual/runs'&&req.method==='POST') return once(()=>leaveAccrual.runAccrualCycle(db,u,input),id=>({id}));
        if(p==='/api/leave-accrual/adjustments'&&req.method==='POST') return once(()=>{const balance=leaveAccrual.recordAccrualAdjustment(db,u,input);return {...balance,id:balance.employee_id};},id=>({id}));
        if(p==='/api/benefits/policies'&&req.method==='POST') return once(()=>benefits.recordMedicalPolicy(db,u,input),id=>({id}));
        const medicalPolicyEdit=p.match(/^\/api\/benefits\/policies\/([a-f0-9-]{36})$/);
        if(medicalPolicyEdit&&req.method==='POST') return benefits.updateMedicalPolicy(db,u,medicalPolicyEdit[1],input);
        if(p==='/api/benefits/enrolments'&&req.method==='POST') return once(()=>benefits.recordEnrolment(db,u,input),id=>({id}));
        const enrolmentStep=p.match(/^\/api\/benefits\/enrolments\/([a-f0-9-]{36})\/(confirm|remove|dependants)$/);
        if(enrolmentStep&&req.method==='POST'){
          if(enrolmentStep[2]==='dependants')return once(()=>benefits.addDependant(db,u,input),id=>({id}));
          return benefits.enrolmentAction(db,u,enrolmentStep[1],enrolmentStep[2]==='confirm'?'confirm_enrolment':'remove_enrolment',input);
        }
        const dependantRemove=p.match(/^\/api\/benefits\/dependants\/([a-f0-9-]{36})\/remove$/);
        if(dependantRemove&&req.method==='POST') return benefits.removeDependant(db,u,dependantRemove[1],input);
```
- الاستيراد: `import * as leaveAccrual from './leave-accrual.mjs';` و`import * as benefits from './benefits.mjs';` · الملف: `leave-benefits-ui` · المفاتيح: `'leave-accrual':leaveAccrualUI,benefits:benefitsUI` ← `import { leaveAccrualUI, benefitsUI } from './leave-benefits-ui.mjs';`
- التنقل: الموارد البشرية للاثنين (التسليم قال «خدمات الموظف» غير الموجودة). المقترح (التسليم لم يحدد شرطًا):
  `if(['hr.policy.prepare','hr.policy.accept'].some(has))nav.push(['leave-accrual','◴','استحقاق الإجازات','Leave accrual']);`
  `if(has('hr.benefits.manage'))nav.push(['benefits','✚','التأمين الطبي والمزايا','Medical & benefits']);`
- الصندوق (مشتق — التسليم لم يعطِ سطرًا): `['leave-accrual','استحقاق الإجازات',accrualBoard],` — `accept_accrual_policy`←«اعتماد»، `reject_accrual_policy`←«قرار». المزايا خارج الصندوق (قرار التسليم).
- الترتيب: `dependants` داخل `enrolmentStep` بتناوب صريح. معرّف الموظف بنمط `[a-z0-9._-]+` كمسار `/api/employees/:id` القائم.

---

### 2.11 letters — الخطابات

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET عام | `/verify/letter/:code` | `letters.verifyLetter(db,code)` — **بلا مصادقة** | لا / لا |
| GET | `/api/letters` | `letters.lettersBoard(db,u)` | لا / لا |
| GET | `/api/letters/templates` | `letters.templatesBoard(db,u)` | لا / لا |
| GET | `/api/letters/:id/print` | `letters.letterPrintable(letters.letterDocument(db,u,id))` — HTML | لا / لا |
| POST | `/api/letters` | `letters.requestLetter(db,u,input)` | نعم / نعم |
| POST | `/api/letters/types` | `letters.addLetterType(db,u,input)` | نعم / نعم |
| POST | `/api/letters/types/:code/(retire_letter_type\|activate_letter_type)` | `letters.letterTypeAction(db,u,code,action,input)` | نعم / لا |
| POST | `/api/letters/templates/:code` | `letters.saveTemplate(db,u,code,input)` | نعم / لا |
| POST | `/api/letters/templates/:code/approve` | `letters.approveTemplate(db,u,code,input)` | نعم / لا |
| POST | `/api/letters/:id/(prepare_letter\|reject_letter\|cancel_request\|issue_letter\|cancel_letter)` | `letters.letterAction(db,u,id,action,input)` | نعم / لا |

المسار العام (بين السطرين 125 و126 — قبل `authenticate`):
```js
      const letterVerify=p.match(/^\/verify\/letter\/([23456789A-HJ-NP-Z]{12})$/);
      if(letterVerify&&req.method==='GET') {send(200,letters.verifyLetter(db,letterVerify[1]));return;}
```
(نمط الرمز من `ALPHABET` و`verifyCode()` في `letters.mjs`: 12 حرفًا.)

GET:
```js
      if(p==='/api/letters'&&req.method==='GET') {send(200,letters.lettersBoard(db,u));return;}
      if(p==='/api/letters/templates'&&req.method==='GET') {send(200,letters.templatesBoard(db,u));return;}
      const letterPrint=p.match(/^\/api\/letters\/([a-f0-9-]{36})\/print$/);
      if(letterPrint&&req.method==='GET') {const html=letters.letterPrintable(letters.letterDocument(db,u,letterPrint[1]));res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
```
POST:
```js
        if(p==='/api/letters'&&req.method==='POST') return once(()=>letters.requestLetter(db,u,input),id=>({id}));
        if(p==='/api/letters/types'&&req.method==='POST') return once(()=>letters.addLetterType(db,u,input),id=>({id}));
        const letterTypeStep=p.match(/^\/api\/letters\/types\/([a-z][a-z0-9_-]{2,39})\/(retire_letter_type|activate_letter_type)$/);
        if(letterTypeStep&&req.method==='POST') return letters.letterTypeAction(db,u,letterTypeStep[1],letterTypeStep[2],input);
        const letterTemplateStep=p.match(/^\/api\/letters\/templates\/([a-z][a-z0-9_-]{2,39})(?:\/(approve))?$/);
        if(letterTemplateStep&&req.method==='POST') return letterTemplateStep[2]?letters.approveTemplate(db,u,letterTemplateStep[1],input):letters.saveTemplate(db,u,letterTemplateStep[1],input);
        const letterStep=p.match(/^\/api\/letters\/([a-f0-9-]{36})\/(prepare_letter|reject_letter|cancel_request|issue_letter|cancel_letter)$/);
        if(letterStep&&req.method==='POST') return letters.letterAction(db,u,letterStep[1],letterStep[2],input);
```
- الاستيراد: `import * as letters from './letters.mjs';` · الملف: `letters-ui` · المفاتيح: `letters:lettersUI,'letter-templates':letterTemplatesUI` ← `import { lettersUI, letterTemplatesUI } from './letters-ui.mjs';`
- التنقل: `letters` ← مساحتي؛ `letter-templates` ← الموارد البشرية:
  `if(me.role!=='admin')nav.push(['letters','✉','خطاباتي','My letters']);`
  `if(['hr.letters.prepare','hr.letters.issue'].some(has))nav.push(['letter-templates','▧','قوالب الخطابات','Letter templates']);`
- الصندوق:
  `['letters','خطابات الموظفين',(db,u)=>({letters:lettersBoard(db,u).awaiting_me})],['letter-templates','قوالب الخطابات',(db,u)=>({letter_templates:letterTemplatesBoard(db,u).awaiting_me})],`
  لا حاجة لـ`try` الذي اقترحه التسليم: حلقة `inbox()` تتخطى صامتةً كل خطأ يحمل `status`. `prepare_letter` يحتاج `DECISIONS` (§1.7). ⚠ لا تضف `templates` إلى `KINDS` كما اقترح التسليم — استعمل `letter_templates`.
- الترتيب: `types` و`templates` قبل `letterStep` (لا التقاط بالـUUID لكن أبقه).

---

### 2.12 pr-equipment — العلاقات العامة والمعدات

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/pr` | `pr.prBoard(db,u,{client_id,campaign_id})` | لا / لا |
| GET | `/api/media-contacts` | `pr.mediaContactsBoard(db,u)` | لا / لا |
| GET | `/api/pr/report` | `pr.coverageReport(db,u,{client_id,campaign_id})` | لا / لا |
| POST | `/api/media-contacts` | `pr.createContact(db,u,input)` | نعم / نعم |
| POST | `/api/media-contacts/:id/(edit\|archive\|restore)` | `pr.contactAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/pr/lists` | `pr.createList(db,u,input)` | نعم / نعم |
| POST | `/api/pr/lists/:id/(add\|remove\|lock)` | `pr.listAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/pr/pitches` | `pr.createPitch(db,u,input)` | نعم / نعم |
| POST | `/api/pr/pitches/:id/(reply\|decline\|published)` | `pr.pitchAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/pr/coverage` | `pr.createCoverage(db,u,input)` | نعم / نعم |
| POST | `/api/pr/coverage/:id/edit` | `pr.coverageAction(db,u,id,'edit',input)` | نعم / لا |
| GET | `/api/equipment` | `equipment.equipmentBoard(db,u,{days})` | لا / لا |
| GET | `/api/equipment/items/:id/qr` | `equipment.itemQr(db,u,id)` — SVG أو JSON | لا / لا |
| GET | `/api/equipment/photos/:id` | `equipment.movementPhoto(db,u,id)` — رد خام | لا / لا |
| POST | `/api/equipment/items` · `/kits` · `/bookings` · `/work-orders` · `/inventory` | `equipment.createItem` · `createKit` · `createBooking` · `openWorkOrder` · `startCheck` — كلها `(db,u,input)` | نعم / نعم |
| POST | `/api/equipment/items/:id/(edit\|report_lost\|confirm_lost\|reject_lost\|retire\|return_to_service)` | `equipment.itemAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/equipment/kits/:id/(add_item\|remove_item\|archive)` | `equipment.kitAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/equipment/bookings/:id/(hand_out\|hand_in\|cancel)` | `equipment.bookingAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/equipment/work-orders/:id/(start\|complete\|cancel)` | `equipment.workOrderAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/equipment/inventory/:id/(scan\|close)` | `equipment.checkAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/pr'&&req.method==='GET') {send(200,pr.prBoard(db,u,{client_id:url.searchParams.get('client_id')??undefined,campaign_id:url.searchParams.get('campaign_id')??undefined}));return;}
      if(p==='/api/media-contacts'&&req.method==='GET') {send(200,pr.mediaContactsBoard(db,u));return;}
      if(p==='/api/pr/report'&&req.method==='GET') {send(200,pr.coverageReport(db,u,{client_id:url.searchParams.get('client_id')??undefined,campaign_id:url.searchParams.get('campaign_id')??undefined}));return;}
      if(p==='/api/equipment'&&req.method==='GET') {send(200,equipment.equipmentBoard(db,u,{days:Number(url.searchParams.get('days'))||undefined}));return;}
      const equipmentQr=p.match(/^\/api\/equipment\/items\/([a-f0-9-]{36})\/qr$/);
      if(equipmentQr&&req.method==='GET') {const qr=equipment.itemQr(db,u,equipmentQr[1]);if(url.searchParams.get('format')==='svg'){res.writeHead(200,{...headers,'Content-Type':'image/svg+xml; charset=utf-8'});res.end(qr.svg);return;}send(200,qr);return;}
      const equipmentPhoto=p.match(/^\/api\/equipment\/photos\/([a-f0-9-]{36})$/);
      if(equipmentPhoto&&req.method==='GET') {const f=equipment.movementPhoto(db,u,equipmentPhoto[1]);const bytes=Buffer.from(f.content);res.writeHead(200,{...headers,'Content-Type':f.media_type,'Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${encodeURIComponent(f.label??'photo')}`,'Content-Length':bytes.length});res.end(bytes);return;}
```
POST:
```js
        if(p==='/api/media-contacts'&&req.method==='POST') return once(()=>pr.createContact(db,u,input),id=>({id}));
        const mediaContactStep=p.match(/^\/api\/media-contacts\/([a-f0-9-]{36})\/(edit|archive|restore)$/);
        if(mediaContactStep&&req.method==='POST') return pr.contactAction(db,u,mediaContactStep[1],mediaContactStep[2],input);
        if(p==='/api/pr/lists'&&req.method==='POST') return once(()=>pr.createList(db,u,input),id=>({id}));
        const prListStep=p.match(/^\/api\/pr\/lists\/([a-f0-9-]{36})\/(add|remove|lock)$/);
        if(prListStep&&req.method==='POST') return pr.listAction(db,u,prListStep[1],prListStep[2],input);
        if(p==='/api/pr/pitches'&&req.method==='POST') return once(()=>pr.createPitch(db,u,input),id=>({id}));
        const prPitchStep=p.match(/^\/api\/pr\/pitches\/([a-f0-9-]{36})\/(reply|decline|published)$/);
        if(prPitchStep&&req.method==='POST') return pr.pitchAction(db,u,prPitchStep[1],prPitchStep[2],input);
        if(p==='/api/pr/coverage'&&req.method==='POST') return once(()=>pr.createCoverage(db,u,input),id=>({id}));
        const prCoverageEdit=p.match(/^\/api\/pr\/coverage\/([a-f0-9-]{36})\/edit$/);
        if(prCoverageEdit&&req.method==='POST') return pr.coverageAction(db,u,prCoverageEdit[1],'edit',input);
        if(p==='/api/equipment/items'&&req.method==='POST') return once(()=>equipment.createItem(db,u,input),id=>({id}));
        if(p==='/api/equipment/kits'&&req.method==='POST') return once(()=>equipment.createKit(db,u,input),id=>({id}));
        if(p==='/api/equipment/bookings'&&req.method==='POST') return once(()=>equipment.createBooking(db,u,input),id=>({id}));
        if(p==='/api/equipment/work-orders'&&req.method==='POST') return once(()=>equipment.openWorkOrder(db,u,input),id=>({id}));
        if(p==='/api/equipment/inventory'&&req.method==='POST') return once(()=>equipment.startCheck(db,u,input),id=>({id}));
        const equipmentItemStep=p.match(/^\/api\/equipment\/items\/([a-f0-9-]{36})\/(edit|report_lost|confirm_lost|reject_lost|retire|return_to_service)$/);
        if(equipmentItemStep&&req.method==='POST') return equipment.itemAction(db,u,equipmentItemStep[1],equipmentItemStep[2],input);
        const equipmentKitStep=p.match(/^\/api\/equipment\/kits\/([a-f0-9-]{36})\/(add_item|remove_item|archive)$/);
        if(equipmentKitStep&&req.method==='POST') return equipment.kitAction(db,u,equipmentKitStep[1],equipmentKitStep[2],input);
        const equipmentBookingStep=p.match(/^\/api\/equipment\/bookings\/([a-f0-9-]{36})\/(hand_out|hand_in|cancel)$/);
        if(equipmentBookingStep&&req.method==='POST') return equipment.bookingAction(db,u,equipmentBookingStep[1],equipmentBookingStep[2],input);
        const equipmentOrderStep=p.match(/^\/api\/equipment\/work-orders\/([a-f0-9-]{36})\/(start|complete|cancel)$/);
        if(equipmentOrderStep&&req.method==='POST') return equipment.workOrderAction(db,u,equipmentOrderStep[1],equipmentOrderStep[2],input);
        const equipmentCheckStep=p.match(/^\/api\/equipment\/inventory\/([a-f0-9-]{36})\/(scan|close)$/);
        if(equipmentCheckStep&&req.method==='POST') return equipment.checkAction(db,u,equipmentCheckStep[1],equipmentCheckStep[2],input);
```
- الاستيراد: `import * as pr from './pr.mjs';` و`import * as equipment from './equipment.mjs';` · الملفات: `pr-ui` و`equipment-ui` · المفاتيح: `pr:prUI,'media-contacts':mediaContactsUI` ← `import { prUI, mediaContactsUI } from './pr-ui.mjs';` · `equipment:equipmentUI` ← `import { equipmentUI } from './equipment-ui.mjs';`
- التنقل: التشغيل (التسليم لم يعطِ سطرًا):
  `if(has('pr.manage'))nav.push(['pr','◎','العلاقات العامة','Public relations'],['media-contacts','☏','دليل جهات الإعلام','Media contacts']);`
  `if(me.role!=='admin')nav.push(['equipment','▦','المعدات والعهد','Equipment & custody']);` (الشاشة تعرض «عهدي» لمن لا يحمل `equipment.manage`.)
- الصندوق (مشتق — التسليم أعطى استعلامات SQL لا أسطرًا): `['pr','العلاقات العامة',prBoard],['equipment','المعدات والعهد',equipmentBoard],` + `DECISIONS`: `lock_list`، `close_check`. `confirm_lost`←«تأكيد» و`reject_lost`←«قرار» يعملان. **الحجز المتأخر لا يظهر** (لا فعل قرار عليه) — §8.
- الترتيب: `/api/pr/report` قبل أي نمط تحت `/api/pr/` في GET. مسارات الإنشاء الخمسة المطابقة الحرفية قبل الأنماط.
- ⚠ `createBooking` في المعدات قد يعيد `{id:created[0],group_id,bookings}` لحجز طقم — `id` موجود فيعمل `once`.

---

### 2.13 privacy — حماية البيانات الشخصية

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/privacy` | `privacy.privacyBoard(db,u)` | لا / لا |
| GET | `/api/subject-requests` | `privacy.subjectRequestsBoard(db,u)` | لا / لا |
| POST | `/api/privacy/activities/suggest` | `privacy.draftSuggestedActivities(db,u,input)` | نعم / نعم ⚠ |
| POST | `/api/privacy/activities` | `privacy.saveActivity(db,u,input)` | نعم / **شرطي** ⚠ |
| POST | `/api/privacy/activities/:id/(approve_activity\|supersede_activity)` | `privacy.activityAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/privacy/transfers` | `privacy.recordTransfer(db,u,input)` | نعم / نعم |
| POST | `/api/privacy/transfers/:id/(assess_transfer\|approve_transfer\|stop_transfer)` | `privacy.transferAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/privacy/retention` | `privacy.saveRetentionRule(db,u,input)` | نعم / **شرطي** ⚠ |
| POST | `/api/privacy/retention/:id/(record_check\|deactivate_rule\|activate_rule)` | `privacy.retentionAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/privacy/incidents` | `privacy.recordIncident(db,u,input)` | نعم / نعم |
| POST | `/api/privacy/incidents/:id/(update_incident\|close_incident)` | `privacy.incidentAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/subject-requests` | `privacy.createSubjectRequest(db,u,input)` | نعم / نعم |
| POST | `/api/subject-requests/:id/(verify_identity\|set_due_date\|answer_request\|refuse_request\|close_request)` | `privacy.requestAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/privacy'&&req.method==='GET') {send(200,privacy.privacyBoard(db,u));return;}
      if(p==='/api/subject-requests'&&req.method==='GET') {send(200,privacy.subjectRequestsBoard(db,u));return;}
```
POST — ⚠ (أ) الواجهة ترسل المفتاح لإنشاء النشاط والقاعدة فقط، وتحريرهما على **المسار نفسه** بلا مفتاح (`edit_activity`/`edit_rule` مع `input.id`)، فيُفرَّع؛ (ب) `draftSuggestedActivities` يعيد `{created,skipped}` بلا `id`، فيُلف:
```js
        if(p==='/api/privacy/activities/suggest'&&req.method==='POST') return once(()=>({id:u.tenant_id,...privacy.draftSuggestedActivities(db,u,input)}),id=>({id}));
        if(p==='/api/privacy/activities'&&req.method==='POST') return input?.id?privacy.saveActivity(db,u,input):once(()=>privacy.saveActivity(db,u,input),id=>({id}));
        const privacyActivityStep=p.match(/^\/api\/privacy\/activities\/([a-f0-9-]{36})\/(approve_activity|supersede_activity)$/);
        if(privacyActivityStep&&req.method==='POST') return privacy.activityAction(db,u,privacyActivityStep[1],privacyActivityStep[2],input);
        if(p==='/api/privacy/transfers'&&req.method==='POST') return once(()=>privacy.recordTransfer(db,u,input),id=>({id}));
        const privacyTransferStep=p.match(/^\/api\/privacy\/transfers\/([a-f0-9-]{36})\/(assess_transfer|approve_transfer|stop_transfer)$/);
        if(privacyTransferStep&&req.method==='POST') return privacy.transferAction(db,u,privacyTransferStep[1],privacyTransferStep[2],input);
        if(p==='/api/privacy/retention'&&req.method==='POST') return input?.id?privacy.saveRetentionRule(db,u,input):once(()=>privacy.saveRetentionRule(db,u,input),id=>({id}));
        const privacyRetentionStep=p.match(/^\/api\/privacy\/retention\/([a-f0-9-]{36})\/(record_check|deactivate_rule|activate_rule)$/);
        if(privacyRetentionStep&&req.method==='POST') return privacy.retentionAction(db,u,privacyRetentionStep[1],privacyRetentionStep[2],input);
        if(p==='/api/privacy/incidents'&&req.method==='POST') return once(()=>privacy.recordIncident(db,u,input),id=>({id}));
        const privacyIncidentStep=p.match(/^\/api\/privacy\/incidents\/([a-f0-9-]{36})\/(update_incident|close_incident)$/);
        if(privacyIncidentStep&&req.method==='POST') return privacy.incidentAction(db,u,privacyIncidentStep[1],privacyIncidentStep[2],input);
        if(p==='/api/subject-requests'&&req.method==='POST') return once(()=>privacy.createSubjectRequest(db,u,input),id=>({id}));
        const subjectRequestStep=p.match(/^\/api\/subject-requests\/([a-f0-9-]{36})\/(verify_identity|set_due_date|answer_request|refuse_request|close_request)$/);
        if(subjectRequestStep&&req.method==='POST') return privacy.requestAction(db,u,subjectRequestStep[1],subjectRequestStep[2],input);
```
- الاستيراد: `import * as privacy from './privacy.mjs';` · الملف: `privacy-ui` · المفاتيح: `privacy:privacyUI,'subject-requests':subjectRequestsUI` ← `import { privacyUI, subjectRequestsUI } from './privacy-ui.mjs';`
- التنقل: القيادة، بعد سطر `compliance` (السطر 94) — من التسليم حرفيًا:
  `if(has('privacy.manage'))nav.push(['privacy','⛨','حماية البيانات الشخصية','Personal data protection'],['subject-requests','✉','طلبات أصحاب البيانات','Data subject requests']);`
- الصندوق (التسليم سمّى المجموعتين دون سطر؛ المشتق):
  `['privacy','حماية البيانات',(db,u)=>({privacy_items:privacyBoard(db,u).inbox})],['subject-requests','طلبات أصحاب البيانات',(db,u)=>({subject_requests:subjectRequestsBoard(db,u).inbox})],`
  يعمل: `approve_activity` `approve_transfer` `verify_identity`. يحتاج `DECISIONS`: `record_check` و`update_incident` و`answer_request` (§1.7). **مرّر `.inbox` وحده** — تمرير اللوحة كاملة مع `record_check` في `DECISIONS` يُدخل كل قاعدة احتفاظ نشطة.
- الترتيب: `activities/suggest` قبل `privacyActivityStep` (نصي، لكنه أول).

---

### 2.14 production — الإنتاج وأوراق الاستدعاء

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/productions` | `production.productionsBoard(db,u)` | لا / لا |
| GET | `/api/call-sheets` | `production.callSheetsBoard(db,u)` | لا / لا |
| GET | `/api/call-sheets/:id/print` | `production.callSheetPrintable(production.getCallSheet(db,u,id))` — HTML | لا / لا |
| POST | `/api/productions` | `production.createProduction(db,u,input)` | نعم / نعم |
| POST | `/api/productions/:id/(edit\|start\|wrap\|close\|cancel)` | `production.productionAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/productions/:id/crew` · `talent` · `locations` · `shots` | `production.addCrew` · `addTalent` · `addLocation` · `addShot` — كلها `(db,u,id,input)` | نعم / نعم |
| POST | `/api/productions/:id/schedule` | `production.saveSchedule(db,u,id,input)` | نعم / لا |
| POST | `/api/production-crew/:id/(edit\|remove)` | `production.crewAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/production-talent/:id/(edit\|release\|remove)` | `production.talentAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/production-locations/:id/(edit\|permit\|remove)` | `production.locationAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/shots/:id/(edit\|status)` | `production.shotAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/call-sheets` | `production.createCallSheet(db,u,input)` | نعم / نعم |
| POST | `/api/call-sheets/invitees/:id/respond` | `production.respondToCallSheet(db,u,id,input)` | نعم / لا |
| POST | `/api/call-sheets/:id/(edit\|add_invitee\|remove_invitee\|issue\|revise\|cancel)` | `production.callSheetAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/productions'&&req.method==='GET') {send(200,production.productionsBoard(db,u));return;}
      if(p==='/api/call-sheets'&&req.method==='GET') {send(200,production.callSheetsBoard(db,u));return;}
      const callSheetPrint=p.match(/^\/api\/call-sheets\/([a-f0-9-]{36})\/print$/);
      if(callSheetPrint&&req.method==='GET') {const html=production.callSheetPrintable(production.getCallSheet(db,u,callSheetPrint[1]));res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
```
POST:
```js
        if(p==='/api/productions'&&req.method==='POST') return once(()=>production.createProduction(db,u,input),id=>({id}));
        const productionStep=p.match(/^\/api\/productions\/([a-f0-9-]{36})\/(edit|start|wrap|close|cancel|crew|talent|locations|schedule|shots)$/);
        if(productionStep&&req.method==='POST'){
          const [,productionId,productionPart]=productionStep;
          if(productionPart==='crew')return once(()=>production.addCrew(db,u,productionId,input),id=>({id}));
          if(productionPart==='talent')return once(()=>production.addTalent(db,u,productionId,input),id=>({id}));
          if(productionPart==='locations')return once(()=>production.addLocation(db,u,productionId,input),id=>({id}));
          if(productionPart==='shots')return once(()=>production.addShot(db,u,productionId,input),id=>({id}));
          if(productionPart==='schedule')return production.saveSchedule(db,u,productionId,input);
          return production.productionAction(db,u,productionId,productionPart,input);
        }
        const productionCrewStep=p.match(/^\/api\/production-crew\/([a-f0-9-]{36})\/(edit|remove)$/);
        if(productionCrewStep&&req.method==='POST') return production.crewAction(db,u,productionCrewStep[1],productionCrewStep[2],input);
        const productionTalentStep=p.match(/^\/api\/production-talent\/([a-f0-9-]{36})\/(edit|release|remove)$/);
        if(productionTalentStep&&req.method==='POST') return production.talentAction(db,u,productionTalentStep[1],productionTalentStep[2],input);
        const productionLocationStep=p.match(/^\/api\/production-locations\/([a-f0-9-]{36})\/(edit|permit|remove)$/);
        if(productionLocationStep&&req.method==='POST') return production.locationAction(db,u,productionLocationStep[1],productionLocationStep[2],input);
        const shotStep=p.match(/^\/api\/shots\/([a-f0-9-]{36})\/(edit|status)$/);
        if(shotStep&&req.method==='POST') return production.shotAction(db,u,shotStep[1],shotStep[2],input);
        if(p==='/api/call-sheets'&&req.method==='POST') return once(()=>production.createCallSheet(db,u,input),id=>({id}));
        const callSheetRespond=p.match(/^\/api\/call-sheets\/invitees\/([a-f0-9-]{36})\/respond$/);
        if(callSheetRespond&&req.method==='POST') return production.respondToCallSheet(db,u,callSheetRespond[1],input);
        const callSheetStep=p.match(/^\/api\/call-sheets\/([a-f0-9-]{36})\/(edit|add_invitee|remove_invitee|issue|revise|cancel)$/);
        if(callSheetStep&&req.method==='POST') return production.callSheetAction(db,u,callSheetStep[1],callSheetStep[2],input);
```
- الاستيراد: `import * as production from './production.mjs';` · الملف: `production-ui` · المفاتيح: `productions:productionsUI,'call-sheets':callSheetsUI` ← `import { productionsUI, callSheetsUI } from './production-ui.mjs';`
- التنقل: التشغيل (التسليم حدد الشرطين دون سطر):
  `if(has('production.manage'))nav.push(['productions','◈','الإنتاج والتصوير','Productions']);`
  `if(me.role!=='admin')nav.push(['call-sheets','▤','أوراق الاستدعاء','Call sheets']);`
- الصندوق (من التسليم): `['productions','الإنتاج والتصوير',productionsBoard],['call-sheets','أوراق الاستدعاء',callSheetsBoard],` — `issue_sheet` و`accept_close` و`confirm` تعمل.
- الترتيب: ⚠ **لا تكتب `productionStep` بنمط `([a-z_]+)`** — يلتقط `crew`/`talent`/… ويرسلها إلى `productionAction`. `invitees/` قبل `callSheetStep`. الواجهة تحوّل أسماء الأفعال عبر `sheetRoutes` (`issue_sheet`→`issue`…) فالمسار يستقبل الأسماء القصيرة.

---

### 2.15 profitability — معدلات التكلفة والربحية

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/cost-rates` | `profitability.costRatesBoard(db,u)` | لا / لا |
| GET | `/api/profitability` | `profitability.profitabilityBoard(db,u,query)` | لا / لا |
| POST | `/api/cost-rates/categories` | `profitability.createCategory(db,u,input)` | نعم / نعم |
| POST | `/api/cost-rates/categories/:id/(activate_category\|deactivate_category)` | `profitability.categoryAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/cost-rates/rates` | `profitability.prepareCostRate(db,u,input)` | نعم / نعم |
| POST | `/api/cost-rates/rates/:id/(approve_rate\|reject_rate)` | `profitability.costRateAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/cost-rates/assignments` | `profitability.assignCategory(db,u,input)` | نعم / نعم |
| POST | `/api/cost-rates/overhead` | `profitability.prepareOverheadRate(db,u,input)` | نعم / نعم |
| POST | `/api/cost-rates/overhead/:id/(approve_overhead\|reject_overhead)` | `profitability.overheadRateAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/profitability/tags` | `profitability.tagProjectService(db,u,input)` | نعم / نعم ⚠ |

GET (`profitabilityBoard` يرفض أي مفتاح خارج الأربعة، فلا يُمرَّر إلا الموجود):
```js
      if(p==='/api/cost-rates'&&req.method==='GET') {send(200,profitability.costRatesBoard(db,u));return;}
      if(p==='/api/profitability'&&req.method==='GET') {send(200,profitability.profitabilityBoard(db,u,Object.fromEntries(['project_id','client_id','from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
```
POST — ⚠ `tagProjectService` يعيد `{project_id,family}` بلا `id`:
```js
        if(p==='/api/cost-rates/categories'&&req.method==='POST') return once(()=>profitability.createCategory(db,u,input),id=>({id}));
        const costCategoryStep=p.match(/^\/api\/cost-rates\/categories\/([a-f0-9-]{36})\/(activate_category|deactivate_category)$/);
        if(costCategoryStep&&req.method==='POST') return profitability.categoryAction(db,u,costCategoryStep[1],costCategoryStep[2],input);
        if(p==='/api/cost-rates/rates'&&req.method==='POST') return once(()=>profitability.prepareCostRate(db,u,input),id=>({id}));
        const costRateStep=p.match(/^\/api\/cost-rates\/rates\/([a-f0-9-]{36})\/(approve_rate|reject_rate)$/);
        if(costRateStep&&req.method==='POST') return profitability.costRateAction(db,u,costRateStep[1],costRateStep[2],input);
        if(p==='/api/cost-rates/assignments'&&req.method==='POST') return once(()=>profitability.assignCategory(db,u,input),id=>({id}));
        if(p==='/api/cost-rates/overhead'&&req.method==='POST') return once(()=>profitability.prepareOverheadRate(db,u,input),id=>({id}));
        const overheadRateStep=p.match(/^\/api\/cost-rates\/overhead\/([a-f0-9-]{36})\/(approve_overhead|reject_overhead)$/);
        if(overheadRateStep&&req.method==='POST') return profitability.overheadRateAction(db,u,overheadRateStep[1],overheadRateStep[2],input);
        if(p==='/api/profitability/tags'&&req.method==='POST') return once(()=>{const tag=profitability.tagProjectService(db,u,input);return {...tag,id:tag.project_id};},id=>({id}));
```
- الاستيراد: `import * as profitability from './profitability.mjs';` · الملف: `profitability-ui` · المفاتيح: `'cost-rates':costRatesUI,profitability:profitabilityUI` ← `import { costRatesUI, profitabilityUI } from './profitability-ui.mjs';`
- التنقل: المالية (التصريحان منفصلان عمدًا):
  `if(has('costing.manage'))nav.push(['cost-rates','◧','معدلات التكلفة','Cost rates']);`
  `if(has('profitability.view'))nav.push(['profitability','◨','ربحية المشاريع والعملاء','Profitability']);`
- الصندوق (مشتق من `awaiting_me`؛ التسليم لم يعطِ سطرًا): `['cost-rates','معدلات التكلفة',(db,u)=>({rates:costRatesBoard(db,u).awaiting_me})],` — `approve_rate` و`approve_overhead` يعملان.
- ⚠ نماذج `set_period`/`view_project`/`view_client` في `profitability-ui.mjs` تعلن `method:'GET'` وتعيد `toPayload` كائنًا، و`api()` في `app.mjs` يضع جسمًا لأي `data!==undefined` ⇒ `fetch` يرمي (GET بجسم). §8.

---

### 2.16 resourcing — كشوف الوقت وتخطيط الموارد

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/timesheets` | `timesheets.timesheetsBoard(db,u,weekDate)` | لا / لا |
| GET | `/api/timesheets/:id` | `timesheets.getPeriod(db,u,id)` | لا / لا |
| GET | `/api/resourcing` | `resourcing.resourcingBoard(db,u,{from,to})` | لا / لا |
| GET | `/api/resourcing/capacity` | `resourcing.capacityBoard(db,u,{from,to})` | لا / لا |
| GET | `/api/resourcing/bookings/:id` | `resourcing.getBooking(db,u,id)` | لا / لا |
| POST | `/api/timesheets/submit` | `timesheets.submitTimesheet(db,u,input)` | نعم / نعم |
| POST | `/api/timesheets/:id/(approve\|return)` | `timesheets.decideTimesheet(db,u,id,decision,input)` | نعم / لا |
| POST | `/api/timesheets/correction` | `timesheets.logCorrection(db,u,input)` | نعم / نعم |
| POST | `/api/timesheets/lock-window` | `timesheets.setLockWindow(db,u,input)` | نعم / لا |
| POST | `/api/timesheets/lock` | `timesheets.lockDuePeriods(db,u,input)` | نعم / نعم ⚠ |
| POST | `/api/timesheets/remind` | `timesheets.remindMissing(db,u,input)` | نعم / نعم ⚠ |
| POST | `/api/timesheets/reminders/:id/read` | `timesheets.markReminderRead(db,u,id)` — بلا `input` | نعم / لا |
| POST | `/api/resourcing/capacity` | `resourcing.setCapacity(db,u,input)` | نعم / نعم |
| POST | `/api/resourcing/bookings` | `resourcing.createBooking(db,u,input)` | نعم / نعم |
| POST | `/api/resourcing/bookings/:id/confirm` · `release` | `resourcing.confirmBooking(db,u,id,input)` · `releaseBooking` | نعم / لا |
| POST | `/api/resourcing/placeholders` | `resourcing.createPlaceholder(db,u,input)` | نعم / نعم |
| POST | `/api/resourcing/placeholders/:id/fill` · `cancel` | `resourcing.fillPlaceholder(db,u,id,input)` · `cancelPlaceholder` | نعم / لا |

GET:
```js
      if(p==='/api/timesheets'&&req.method==='GET') {send(200,timesheets.timesheetsBoard(db,u,url.searchParams.get('week')??undefined));return;}
      const timesheetView=p.match(/^\/api\/timesheets\/([a-f0-9-]{36})$/);
      if(timesheetView&&req.method==='GET') {send(200,timesheets.getPeriod(db,u,timesheetView[1]));return;}
      if(p==='/api/resourcing'&&req.method==='GET') {send(200,resourcing.resourcingBoard(db,u,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));return;}
      if(p==='/api/resourcing/capacity'&&req.method==='GET') {send(200,resourcing.capacityBoard(db,u,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));return;}
      const resourcingBookingView=p.match(/^\/api\/resourcing\/bookings\/([a-f0-9-]{36})$/);
      if(resourcingBookingView&&req.method==='GET') {send(200,resourcing.getBooking(db,u,resourcingBookingView[1]));return;}
```
POST — ⚠ `lockDuePeriods` و`remindMissing` يعيدان أعدادًا بلا `id`:
```js
        if(p==='/api/timesheets/submit'&&req.method==='POST') return once(()=>timesheets.submitTimesheet(db,u,input),id=>timesheets.getPeriod(db,u,id));
        if(p==='/api/timesheets/correction'&&req.method==='POST') return once(()=>timesheets.logCorrection(db,u,input),id=>({id}));
        if(p==='/api/timesheets/lock-window'&&req.method==='POST') return timesheets.setLockWindow(db,u,input);
        if(p==='/api/timesheets/lock'&&req.method==='POST') return once(()=>({id:u.tenant_id,...timesheets.lockDuePeriods(db,u,input)}),id=>({id}));
        if(p==='/api/timesheets/remind'&&req.method==='POST') return once(()=>({id:u.tenant_id,...timesheets.remindMissing(db,u,input)}),id=>({id}));
        const timesheetReminderRead=p.match(/^\/api\/timesheets\/reminders\/([a-f0-9-]{36})\/read$/);
        if(timesheetReminderRead&&req.method==='POST') return timesheets.markReminderRead(db,u,timesheetReminderRead[1]);
        const timesheetDecision=p.match(/^\/api\/timesheets\/([a-f0-9-]{36})\/(approve|return)$/);
        if(timesheetDecision&&req.method==='POST') return timesheets.decideTimesheet(db,u,timesheetDecision[1],timesheetDecision[2],input);
        if(p==='/api/resourcing/capacity'&&req.method==='POST') return once(()=>resourcing.setCapacity(db,u,input),id=>({id}));
        if(p==='/api/resourcing/bookings'&&req.method==='POST') return once(()=>resourcing.createBooking(db,u,input),id=>resourcing.getBooking(db,u,id));
        const resourcingBookingStep=p.match(/^\/api\/resourcing\/bookings\/([a-f0-9-]{36})\/(confirm|release)$/);
        if(resourcingBookingStep&&req.method==='POST') return resourcingBookingStep[2]==='confirm'?resourcing.confirmBooking(db,u,resourcingBookingStep[1],input):resourcing.releaseBooking(db,u,resourcingBookingStep[1],input);
        if(p==='/api/resourcing/placeholders'&&req.method==='POST') return once(()=>resourcing.createPlaceholder(db,u,input),id=>({id}));
        const placeholderStep=p.match(/^\/api\/resourcing\/placeholders\/([a-f0-9-]{36})\/(fill|cancel)$/);
        if(placeholderStep&&req.method==='POST') return placeholderStep[2]==='fill'?resourcing.fillPlaceholder(db,u,placeholderStep[1],input):resourcing.cancelPlaceholder(db,u,placeholderStep[1],input);
```
- الاستيراد: `import * as timesheets from './timesheets.mjs';` و`import * as resourcing from './resourcing.mjs';` · الملف: `resourcing-ui` · المفاتيح: `timesheets:timesheetsUI,resourcing:resourcingUI` ← `import { timesheetsUI, resourcingUI } from './resourcing-ui.mjs';`
- التنقل: التشغيل، بجوار `time`:
  `if(has('portal.use'))nav.push(['timesheets','◷','كشوف الوقت الأسبوعية','Weekly timesheets']);`
  `if(has('resourcing.view'))nav.push(['resourcing','▦','تخطيط الموارد والسعة','Resourcing & capacity']);`
- الصندوق (التسليم أعطى جدول شروط لا أسطرًا؛ المشتق):
  `['timesheets','كشوف الوقت',timesheetsBoard],['resourcing','تخطيط الموارد',(db,u)=>({bookings:resourcingBoard(db,u).bookings.filter(b=>b.status==='tentative'&&b.user_id!==u.id).map(b=>({...b,actions:['confirm_booking']}))})],`
  `approve_timesheet`←«اعتماد». ⚠ **لا تمرّر `resourcingBoard` كاملة**: `release_booking` يُقرأ «إصدار» (رأسه `release` في `DECISIONS` من تقييم الأداء) ويظهر على كل حجز مؤكَّد. الأسبوع المُعاد والتذكير لا يظهران (الفعلان `submit_timesheet` و`read_reminder` يسقطان) — §8.
- الترتيب: `reminders/…/read` و`lock-window` و`lock` مطابقات حرفية قبل `timesheetDecision`. ⚠ اسم `placeholderStep` جديد؛ لا تستعمل `planStep` (موجود).

---

### 2.17 review-rounds — المراجعة الإبداعية

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/review-rounds` | `reviewRounds.reviewBoard(db,u)` | لا / لا |
| GET | `/api/review-rounds/media/:id` | `reviewRounds.previewMedia(db,u,id)` — رد خام **inline** | لا / لا |
| POST | `/api/review-rounds` | `reviewRounds.createRoute(db,u,input)` | نعم / نعم |
| POST | `/api/review-rounds/annotations/:id/(address\|wont_fix)` | `reviewRounds.annotationAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/review-rounds/notices/:id/read` | `reviewRounds.markReviewNotice(db,u,id)` — بلا `input` | نعم / لا |
| POST | `/api/review-rounds/:id/client-pack` | `reviewRounds.clientPack(db,u,id)` — قراءة | نعم (لا ضرر) / لا |
| POST | `/api/review-rounds/:id/(add_media\|annotate\|save_template)` | `reviewRounds.reviewAction(db,u,id,action,input)` | نعم / نعم |
| POST | `/api/review-rounds/:id/(decide\|cancel\|notify)` | `reviewRounds.reviewAction(db,u,id,action,input)` | نعم / لا |

GET — ⚠ ترويسات `headers` العامة تحمل `X-Frame-Options: DENY` و`frame-ancestors 'none'`، فتمنع ملف PDF في `<iframe>` الذي تبنيه الواجهة؛ يُتجاوزان لهذا الرد وحده:
```js
      const reviewMediaFile=p.match(/^\/api\/review-rounds\/media\/([a-f0-9-]{36})$/);
      if(reviewMediaFile&&req.method==='GET') {const f=reviewRounds.previewMedia(db,u,reviewMediaFile[1]);res.writeHead(200,{...headers,'Content-Type':f.media_type,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'",'Content-Length':f.content.length});res.end(f.content);return;}
      if(p==='/api/review-rounds'&&req.method==='GET') {send(200,reviewRounds.reviewBoard(db,u));return;}
```
POST:
```js
        if(p==='/api/review-rounds'&&req.method==='POST') return once(()=>reviewRounds.createRoute(db,u,input),id=>({id}));
        const reviewAnnotationStep=p.match(/^\/api\/review-rounds\/annotations\/([a-f0-9-]{36})\/(address|wont_fix)$/);
        if(reviewAnnotationStep&&req.method==='POST') return reviewRounds.annotationAction(db,u,reviewAnnotationStep[1],reviewAnnotationStep[2],input);
        const reviewNoticeRead=p.match(/^\/api\/review-rounds\/notices\/([a-f0-9-]{36})\/read$/);
        if(reviewNoticeRead&&req.method==='POST') return reviewRounds.markReviewNotice(db,u,reviewNoticeRead[1]);
        const reviewClientPack=p.match(/^\/api\/review-rounds\/([a-f0-9-]{36})\/client-pack$/);
        if(reviewClientPack&&req.method==='POST') return reviewRounds.clientPack(db,u,reviewClientPack[1]);
        const reviewRouteStep=p.match(/^\/api\/review-rounds\/([a-f0-9-]{36})\/(add_media|annotate|decide|save_template|cancel|notify)$/);
        if(reviewRouteStep&&req.method==='POST'){
          const [,routeId,routeAction]=reviewRouteStep;
          if(['add_media','annotate','save_template'].includes(routeAction))return once(()=>reviewRounds.reviewAction(db,u,routeId,routeAction,input),id=>reviewRounds.getRoute(db,u,id));
          return reviewRounds.reviewAction(db,u,routeId,routeAction,input);
        }
```
(`reviewAction` يعيد `getRoute(...)` وفيه `id` المسار، فيصلح مع `once`؛ والواجهة ترسل المفتاح لهذه الثلاثة فقط.)
- الاستيراد: `import * as reviewRounds from './review-rounds.mjs';` · الملف: `review-rounds-ui` · المفاتيح: `'review-rounds':reviewRoundsUI,annotations:annotationsUI` ← `import { reviewRoundsUI, annotationsUI } from './review-rounds-ui.mjs';`
- التنقل: التشغيل، بعد `studio`: `if(has('review.manage'))nav.push(['review-rounds','◉','جولات المراجعة','Review rounds'],['annotations','✎','تعليقات المادة','Annotations']);`
- الصندوق (من التسليم): `['review-rounds','جولات المراجعة',reviewBoard],` — `decide` ← «قرار».
- الترتيب: ⚠ **`annotations/` و`notices/` و`media/` قبل `/:id/`** (نص التسليم). ⚠ اسم `reviewRouteStep` جديد؛ `reviewStep` موجود (السطر 253). حجم المادة: الوحدة تقبل حتى 2,800,000 بايت نصًا، وحد `body()` 2,900,000 بايت شاملًا غلاف JSON — هامش ضيق.

---

### 2.18 search — البحث الشامل

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/search?q=` | `search.refreshIndex(db,u)` ثم `search.searchAll(db,u,q)` | إعادة البناء نعم / لا |
| POST | `/api/search/reindex` | `search.refreshIndex(db,u,{explicit:true,maxAgeMs:0})` | نعم / لا |

GET (من التسليم حرفيًا):
```js
      if(p==='/api/search'&&req.method==='GET'){transaction(db,()=>search.refreshIndex(db,u));send(200,search.searchAll(db,u,url.searchParams.get('q')??''));return;}
```
POST — داخل المعاملة القائمة بدل صيغة التسليم (`send(200,transaction(...))`)، لأن كتلة POST كلها داخل `transaction` أصلًا:
```js
        if(p==='/api/search/reindex'&&req.method==='POST') return search.refreshIndex(db,u,{explicit:true,maxAgeMs:0});
```
- الاستيراد: `import * as search from './search.mjs';` · الملف: `search-ui` · المفتاح: `search:searchUI` ← `import { searchUI } from './search-ui.mjs';`
- التنقل: مساحتي، **أول سطر بعد `nav=[]`** ليظهر أعلى القائمة — من التسليم: `if(has('search.use'))nav.push(['search','⌕','البحث الشامل','Search']);`
- الصندوق: لا شيء.
- ملاحظة: الواجهة تستعمل `dynamicEndpoint` و`toPayload:()=>undefined` مع `method:'GET'` فتعمل مع `api()` الحالي (بخلاف الربحية).

---

### 2.19 tax-returns — أوراق العمل الضريبية

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/tax-returns/vat` | `taxReturns.vatBoard(db,u)` | لا / لا |
| GET | `/api/tax-returns/withholding` | `taxReturns.withholdingBoard(db,u)` | لا / لا |
| GET | `/api/tax-returns/vat/:id/export.csv` | `taxReturns.exportVatWorksheet(db,u,id)` + `audit` | لا / لا |
| POST | `/api/tax-returns/rates` | `taxReturns.recordRateSetting(db,u,input)` | نعم / نعم |
| POST | `/api/tax-returns/rates/:id/confirm` | `taxReturns.confirmRateSetting(db,u,id,input)` | نعم / لا |
| POST | `/api/tax-returns/vat/boxes` | `taxReturns.nameExportBoxes(db,u,input)` | نعم / لا |
| POST | `/api/tax-returns/vat` | `taxReturns.createVatWorksheet(db,u,input)` | نعم / نعم |
| POST | `/api/tax-returns/vat/:id` | `taxReturns.saveVatWorksheet(db,u,id,input)` | نعم / لا |
| POST | `/api/tax-returns/vat/:id/open` | `taxReturns.getVatWorksheet(db,u,id)` — قراءة | نعم / لا |
| POST | `/api/tax-returns/vat/:id/(review_worksheet\|record_filing)` | `taxReturns.vatWorksheetAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/tax-returns/vat/:id/revise_worksheet` | `taxReturns.vatWorksheetAction(db,u,id,'revise_worksheet',input)` | نعم / **نعم** |
| POST | `/api/tax-returns/withholding` | `taxReturns.recordWithholding(db,u,input)` | نعم / نعم |
| POST | `/api/tax-returns/withholding/:id/(record_remittance\|cancel_entry)` | `taxReturns.withholdingAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/tax-returns/zakat` | `taxReturns.createZakatWorksheet(db,u,input)` | نعم / نعم |
| POST | `/api/tax-returns/zakat/:id/lines` | `taxReturns.saveZakatLines(db,u,id,input)` | نعم / لا |
| POST | `/api/tax-returns/zakat/:id/review_zakat` | `taxReturns.zakatAction(db,u,id,'review_zakat',input)` | نعم / لا |
| POST | `/api/tax-returns/zakat/:id/revise_zakat` | `taxReturns.zakatAction(db,u,id,'revise_zakat',input)` | نعم / **نعم** |

GET:
```js
      if(p==='/api/tax-returns/vat'&&req.method==='GET') {send(200,taxReturns.vatBoard(db,u));return;}
      if(p==='/api/tax-returns/withholding'&&req.method==='GET') {send(200,taxReturns.withholdingBoard(db,u));return;}
      const vatExport=p.match(/^\/api\/tax-returns\/vat\/([a-f0-9-]{36})\/export\.csv$/);
      if(vatExport&&req.method==='GET') {
        const file=taxReturns.exportVatWorksheet(db,u,vatExport[1]);
        audit(db,u,'vat_worksheet',vatExport[1],'vat_worksheet.exported',{}, {format:'csv'});
        res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':file.content.length});res.end(file.content);return;
      }
```
POST — ⚠ الواجهة ترسل المفتاح لـ`revise_*` وحدهما من بين أفعال الورقتين، فيُفرَّعان:
```js
        if(p==='/api/tax-returns/rates'&&req.method==='POST') return once(()=>taxReturns.recordRateSetting(db,u,input),id=>({id}));
        const taxRateConfirm=p.match(/^\/api\/tax-returns\/rates\/([a-f0-9-]{36})\/confirm$/);
        if(taxRateConfirm&&req.method==='POST') return taxReturns.confirmRateSetting(db,u,taxRateConfirm[1],input);
        if(p==='/api/tax-returns/vat/boxes'&&req.method==='POST') return taxReturns.nameExportBoxes(db,u,input);
        if(p==='/api/tax-returns/vat'&&req.method==='POST') return once(()=>taxReturns.createVatWorksheet(db,u,input),id=>({id}));
        const vatWorksheetSave=p.match(/^\/api\/tax-returns\/vat\/([a-f0-9-]{36})$/);
        if(vatWorksheetSave&&req.method==='POST') return taxReturns.saveVatWorksheet(db,u,vatWorksheetSave[1],input);
        const vatWorksheetStep=p.match(/^\/api\/tax-returns\/vat\/([a-f0-9-]{36})\/(open|review_worksheet|record_filing|revise_worksheet)$/);
        if(vatWorksheetStep&&req.method==='POST'){
          const [,worksheetId,worksheetAction]=vatWorksheetStep;
          if(worksheetAction==='open')return taxReturns.getVatWorksheet(db,u,worksheetId);
          if(worksheetAction==='revise_worksheet')return once(()=>taxReturns.vatWorksheetAction(db,u,worksheetId,'revise_worksheet',input),id=>({id}));
          return taxReturns.vatWorksheetAction(db,u,worksheetId,worksheetAction,input);
        }
        if(p==='/api/tax-returns/withholding'&&req.method==='POST') return once(()=>taxReturns.recordWithholding(db,u,input),id=>({id}));
        const withholdingStep=p.match(/^\/api\/tax-returns\/withholding\/([a-f0-9-]{36})\/(record_remittance|cancel_entry)$/);
        if(withholdingStep&&req.method==='POST') return taxReturns.withholdingAction(db,u,withholdingStep[1],withholdingStep[2],input);
        if(p==='/api/tax-returns/zakat'&&req.method==='POST') return once(()=>taxReturns.createZakatWorksheet(db,u,input),id=>({id}));
        const zakatLines=p.match(/^\/api\/tax-returns\/zakat\/([a-f0-9-]{36})\/lines$/);
        if(zakatLines&&req.method==='POST') return taxReturns.saveZakatLines(db,u,zakatLines[1],input);
        const zakatStep=p.match(/^\/api\/tax-returns\/zakat\/([a-f0-9-]{36})\/(review_zakat|revise_zakat)$/);
        if(zakatStep&&req.method==='POST') return zakatStep[2]==='revise_zakat'?once(()=>taxReturns.zakatAction(db,u,zakatStep[1],'revise_zakat',input),id=>({id})):taxReturns.zakatAction(db,u,zakatStep[1],'review_zakat',input);
```
- الاستيراد: `import * as taxReturns from './tax-returns.mjs';` · الملف: `tax-returns-ui` · المفاتيح: `'vat-worksheet':vatWorksheetUI,withholding:withholdingUI` ← `import { vatWorksheetUI, withholdingUI } from './tax-returns-ui.mjs';`
- التنقل: المالية: `if(['tax.returns.prepare','tax.returns.review'].some(has))nav.push(['vat-worksheet','▤','ورقة القيمة المضافة والزكاة','VAT & zakat worksheets'],['withholding','▥','ضريبة الاستقطاع','Withholding tax']);`
- الصندوق (من التسليم مع تبديل `entries` المصطدم): `['tax-returns','أوراق العمل الضريبية',(db,u)=>({worksheets:vatBoard(db,u).inbox,withholding_items:withholdingBoard(db,u).inbox})],` + `DECISIONS`: `record_filing` و`record_remittance`. ⚠ إن رمت `vatBoard` 403 لمستخدم يرى الاستقطاع وحده سقط المصدر كله؛ الأسلم سطران منفصلان بمفتاحين (`tax-vat` و`tax-withholding`) إن كان التصريحان يُمنحان منفصلين.
- الترتيب: ⚠ **`vat/boxes` قبل `vatWorksheetSave`**. تسمية `taxRateConfirm` جديدة؛ `taxDecision` موجود (السطر 378).

---

### 2.20 wage-protection — حماية الأجور والمطابقة والشذوذ

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/wps` | `wps.wpsBoard(db,u)` | لا / لا |
| GET | `/api/wps/runs/:runId/checks` | `wps.preExportChecks(db,u,runId)` | لا / لا |
| GET | `/api/wps/exports/:id/file` | `wps.wageFileContent(db,u,id)` — تنزيل | **نعم** / لا |
| POST | `/api/wps/formats` | `wps.recordFileFormat(db,u,input)` | نعم / نعم |
| POST | `/api/wps/formats/:id/(confirm\|reject\|retire\|withdraw)` | `wps.decideFileFormat(db,u,id,decision,input)` | نعم / لا |
| POST | `/api/wps/exports` | `wps.prepareWageFile(db,u,input)` | نعم / نعم |
| POST | `/api/wps/exports/:id/record_upload` | `wps.recordManualUpload(db,u,id,input)` | نعم / لا |
| GET | `/api/wage-reconciliation?month=` | `wageRecon.wageReconciliation(db,u,month)` | لا / لا |
| POST | `/api/wage-reconciliation/registrations` | `wageRecon.recordWageRegistration(db,u,input)` | نعم / نعم |
| POST | `/api/wage-reconciliation/notes` | `wageRecon.recordWageDifferenceNote(db,u,input)` | نعم / نعم |
| GET | `/api/payroll-anomaly` | `anomaly.anomalyBoard(db,u)` | لا / لا |
| GET | `/api/payroll-anomaly/runs/:runId` | `anomaly.runAnomalyReport(db,u,runId)` | لا / لا |
| POST | `/api/payroll-anomaly/thresholds` | `anomaly.saveAnomalySettings(db,u,input)` | نعم / لا |

GET:
```js
      if(p==='/api/wps'&&req.method==='GET') {send(200,wps.wpsBoard(db,u));return;}
      const wpsChecks=p.match(/^\/api\/wps\/runs\/([a-f0-9-]+)\/checks$/);
      if(wpsChecks&&req.method==='GET') {send(200,wps.preExportChecks(db,u,wpsChecks[1]));return;}
      const wpsFile=p.match(/^\/api\/wps\/exports\/([a-f0-9-]{36})\/file$/);
      if(wpsFile&&req.method==='GET') {const file=transaction(db,()=>wps.wageFileContent(db,u,wpsFile[1]));res.writeHead(200,{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${file.filename}"`});res.end(file.content);return;}
      if(p==='/api/wage-reconciliation'&&req.method==='GET') {send(200,wageRecon.wageReconciliation(db,u,url.searchParams.get('month')??null));return;}
      if(p==='/api/payroll-anomaly'&&req.method==='GET') {send(200,anomaly.anomalyBoard(db,u));return;}
      const anomalyRun=p.match(/^\/api\/payroll-anomaly\/runs\/([a-f0-9-]+)$/);
      if(anomalyRun&&req.method==='GET') {send(200,anomaly.runAnomalyReport(db,u,anomalyRun[1]));return;}
```
(معرّف المسير بنمط `[a-f0-9-]+` كمسار `payrollStep` القائم.)

POST:
```js
        if(p==='/api/wps/formats'&&req.method==='POST') return once(()=>wps.recordFileFormat(db,u,input),id=>({id}));
        const wpsFormatStep=p.match(/^\/api\/wps\/formats\/([a-f0-9-]{36})\/(confirm|reject|retire|withdraw)$/);
        if(wpsFormatStep&&req.method==='POST') return wps.decideFileFormat(db,u,wpsFormatStep[1],wpsFormatStep[2],input);
        if(p==='/api/wps/exports'&&req.method==='POST') return once(()=>wps.prepareWageFile(db,u,input),id=>({id}));
        const wpsUpload=p.match(/^\/api\/wps\/exports\/([a-f0-9-]{36})\/record_upload$/);
        if(wpsUpload&&req.method==='POST') return wps.recordManualUpload(db,u,wpsUpload[1],input);
        if(p==='/api/wage-reconciliation/registrations'&&req.method==='POST') return once(()=>wageRecon.recordWageRegistration(db,u,input),id=>({id}));
        if(p==='/api/wage-reconciliation/notes'&&req.method==='POST') return once(()=>wageRecon.recordWageDifferenceNote(db,u,input),id=>({id}));
        if(p==='/api/payroll-anomaly/thresholds'&&req.method==='POST') return anomaly.saveAnomalySettings(db,u,input);
```
دمج اختياري من التسليم (في سطر `/api/payroll` القائم، السطر 193):
```js
      if(p==='/api/payroll'&&req.method==='GET') {const board=payroll.listPayroll(db,u);send(200,{...board,runs:board.runs.map(r=>({...r,checks:preRunChecks(db,u,r),anomalies:anomaly.runAnomalies(db,u.tenant_id,r)}))});return;}
```
- الاستيراد: الثلاثة في §1.1 · الملف: `wage-protection-ui` · المفاتيح: `wps:wpsUI,'wage-reconciliation':wageReconciliationUI,'payroll-anomaly':payrollAnomalyUI` ← `import { wpsUI, wageReconciliationUI, payrollAnomalyUI } from './wage-protection-ui.mjs';`
- التنقل: الموارد البشرية، بجوار `payroll-extras` (السطر 83 في `app.mjs`، بالشرط نفسه):
  `if(['payroll.prepare','payroll.review','payroll.approve'].some(has))nav.push(['wps','◓','ملف حماية الأجور','Wage protection file'],['wage-reconciliation','⇄','مطابقة الأجور','Wage reconciliation'],['payroll-anomaly','⚠','كشف شذوذ المسير','Payroll anomalies']);`
- الصندوق (مشتق من وصف التسليم):
  ```js
  ['wps','ملف حماية الأجور',(db,u)=>{const board=wpsBoard(db,u);return {wps_formats:board.formats.filter(f=>f.actions.includes('confirm_format')),wps_exports:board.exports.filter(x=>x.actions.includes('record_upload'))};}],
  ['wage-reconciliation','مطابقة الأجور',(db,u)=>({wage_gaps:wageReconciliation(db,u).rows.filter(r=>r.state==='different'&&r.notes.length===0&&r.actions.includes('record_difference'))})],
  ```
  `confirm_format`←«تأكيد». يحتاج `DECISIONS`: `record_upload` و`record_difference`. الشذوذ خارج الصندوق (قرار التسليم).
- ⚠ أسماء الأفعال في اللوحة (`confirm_format`…) تختلف عن مقاطع المسار (`confirm`…) — المسار يأخذ القصيرة كما ترسلها الواجهة.

---

### 2.21 lifecycle — حِزم التعيين والمغادرة وإخلاء الطرف

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/lifecycle` | `lifecycle.lifecycleBoard(db,u)` | لا / لا |
| GET | `/api/clearance` | `lifecycle.clearanceBoard(db,u)` | لا / لا |
| POST | `/api/lifecycle/templates` | `lifecycle.saveStepTemplate(db,u,input)` | نعم / نعم |
| POST | `/api/lifecycle/templates/:id` | `lifecycle.updateStepTemplate(db,u,id,input)` | نعم / لا |
| POST | `/api/lifecycle/bundles` | `lifecycle.openBundle(db,u,input)` | نعم / نعم |
| POST | `/api/lifecycle/bundles/:id/(close_bundle\|cancel_bundle\|refresh_clearance)` | `lifecycle.bundleAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/lifecycle/steps/:id/(close_step\|cancel_step\|decide_late_step)` | `lifecycle.stepAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/clearance/items/:id` | `lifecycle.clearItem(db,u,id,input)` | نعم / لا |

GET:
```js
      if(p==='/api/lifecycle'&&req.method==='GET') {send(200,lifecycle.lifecycleBoard(db,u));return;}
      if(p==='/api/clearance'&&req.method==='GET') {send(200,lifecycle.clearanceBoard(db,u));return;}
```
POST:
```js
        if(p==='/api/lifecycle/templates'&&req.method==='POST') return once(()=>lifecycle.saveStepTemplate(db,u,input),id=>({id}));
        const lifecycleTemplateEdit=p.match(/^\/api\/lifecycle\/templates\/([a-f0-9-]{36})$/);
        if(lifecycleTemplateEdit&&req.method==='POST') return lifecycle.updateStepTemplate(db,u,lifecycleTemplateEdit[1],input);
        if(p==='/api/lifecycle/bundles'&&req.method==='POST') return once(()=>lifecycle.openBundle(db,u,input),id=>({id}));
        const lifecycleBundleStep=p.match(/^\/api\/lifecycle\/bundles\/([a-f0-9-]{36})\/(close_bundle|cancel_bundle|refresh_clearance)$/);
        if(lifecycleBundleStep&&req.method==='POST') return lifecycle.bundleAction(db,u,lifecycleBundleStep[1],lifecycleBundleStep[2],input);
        const lifecycleStepAction=p.match(/^\/api\/lifecycle\/steps\/([a-f0-9-]{36})\/(close_step|cancel_step|decide_late_step)$/);
        if(lifecycleStepAction&&req.method==='POST') return lifecycle.stepAction(db,u,lifecycleStepAction[1],lifecycleStepAction[2],input);
        const clearanceItem=p.match(/^\/api\/clearance\/items\/([a-f0-9-]{36})$/);
        if(clearanceItem&&req.method==='POST') return lifecycle.clearItem(db,u,clearanceItem[1],input);
```
**بوابة التسوية النهائية** — البديل الذي ذكره التسليم ويتفادى الاستيراد الدائري (`lifecycle.mjs` يستورد `outstandingAdvances` من `payroll-extras.mjs`): في `server.mjs` داخل فرع `extrasDecision` (السطر 365)، **أول سطر بعد** `const [,kind,rowId,decision]=extrasDecision;`:
```js
          if(kind==='settlements'&&decision==='approve'){const settled=db.prepare('SELECT user_id FROM service_settlements WHERE id=? AND tenant_id=?').get(rowId,u.tenant_id);if(settled){const clearance=lifecycle.clearanceBlockers(db,u,settled.user_id);if(clearance.blocked)fail(409,'clearance_open',`${clearance.note} (${clearance.blockers.map(b=>b.title).join('، ')})`);}}
```
(`service_settlements` يحمل `tenant_id` و`user_id` — الهجرة 031. ⚠ يكسر `PAY-09` في `tests/payroll-extras.test.mjs` ما لم يفتح الاختبار حزمة مغادرة أولًا — §7.)
- الاستيراد: `import * as lifecycle from './lifecycle.mjs';` · الملف: `lifecycle-ui` · المفاتيح: `lifecycle:lifecycleUI,clearance:clearanceUI` ← `import { lifecycleUI, clearanceUI } from './lifecycle-ui.mjs';`
- التنقل: الموارد البشرية، بجوار `people`: `if(has('people.manage'))nav.push(['lifecycle','⇢','حزم التعيين والمغادرة','Joiner & leaver bundles'],['clearance','✓','إخلاء الطرف','Clearance']);`
- الصندوق (من التسليم): `['lifecycle','حزم التعيين والمغادرة',lifecycleBoard],` + `KINDS`: `bundles` و`steps` و`clearance`. `decide_late_step`←«قرار»، `verify_clearance`←«تحقق».
- الترتيب: لا تداخل. ⚠ اسم الاختبار `tests/lifecycle-bundles.test.mjs` (`tests/lifecycle.test.mjs` قائم لغرض آخر).

---

### 2.22 einvoice-gateway — طبقة الفوترة الإلكترونية (غير موصولة)

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/einvoice` | `einvoice.einvoiceBoard(db,u)` | لا / لا |
| GET | `/api/einvoice/selfcheck` | `einvoiceSelfcheck(db,u)` | لا / لا |
| GET | `/api/einvoice/buyers/:caseId` | `einvoice.buyerReadiness(db,u,caseId)` — اختياري | لا / لا |
| POST | `/api/einvoice/submissions/:id/channel` | `einvoice.assignChannel(db,u,id,input)` | نعم / لا |
| POST | `/api/einvoice/buyer-overrides` | `einvoice.recordBuyerOverride(db,u,input)` | نعم / نعم |
| POST | `/api/einvoice/submissions/:id/attempt` | `await einvoice.attemptSubmission(db,u,id,input,transaction)` | **لا تُغلَّف** / لا |
| POST | `/api/einvoice/submissions/:id/status` | `await einvoice.refreshSubmissionStatus(db,u,id,input,transaction)` | **لا تُغلَّف** / لا |

GET:
```js
      if(p==='/api/einvoice'&&req.method==='GET') {send(200,einvoice.einvoiceBoard(db,u));return;}
      if(p==='/api/einvoice/selfcheck'&&req.method==='GET') {send(200,einvoiceSelfcheck(db,u));return;}
      const einvoiceBuyer=p.match(/^\/api\/einvoice\/buyers\/([a-f0-9-]{36})$/);
      if(einvoiceBuyer&&req.method==='GET') {send(200,einvoice.buyerReadiness(db,u,einvoiceBuyer[1]));return;}
```
غير متزامن (بعد السطر 234، على نمط `assistantRun`):
```js
      const einvoiceCall=p.match(/^\/api\/einvoice\/submissions\/([a-f0-9-]{36})\/(attempt|status)$/);
      if(einvoiceCall&&req.method==='POST') {send(201,einvoiceCall[2]==='attempt'?await einvoice.attemptSubmission(db,u,einvoiceCall[1],input,transaction):await einvoice.refreshSubmissionStatus(db,u,einvoiceCall[1],input,transaction));return;}
```
POST (داخل المعاملة):
```js
        const einvoiceChannel=p.match(/^\/api\/einvoice\/submissions\/([a-f0-9-]{36})\/channel$/);
        if(einvoiceChannel&&req.method==='POST') return einvoice.assignChannel(db,u,einvoiceChannel[1],input);
        if(p==='/api/einvoice/buyer-overrides'&&req.method==='POST') return once(()=>einvoice.recordBuyerOverride(db,u,input),id=>({id}));
```
- الاستيراد: السطران في §1.1 · الملف: `einvoice-ui` · المفاتيح: `einvoice:einvoiceUI,'einvoice-selfcheck':einvoiceSelfcheckUI` ← `import { einvoiceUI, einvoiceSelfcheckUI } from './einvoice-ui.mjs';`
- التنقل: المالية، بجوار `invoices`: `if(has('einvoice.manage'))nav.push(['einvoice','⇪','طابور الفوترة الإلكترونية','E-invoice queue'],['einvoice-selfcheck','☑','المراجعة الذاتية للفوترة','E-invoice self-check']);`
- الصندوق: لا شيء اليوم (قرار التسليم).
- الترتيب: `einvoiceCall` قبل `const result=transaction(...)`؛ `channel` لا يلتقطه نمطه.

---

### 2.23 request-intake — استقبال الطلب (وحدة المنسّق، بلا تسليم)

الصادرات الفعلية من `app/request-intake.mjs`: `matrixConfigured(db,tenantId)` · `derivePriority(db,tenantId,impactCode,urgencyCode)` · `defineScale(db,supplied,input)` · `setMatrixCell(db,supplied,input)` · `intakeSettings(db,supplied)` · `intakeFor(db,requestId)` · `saveIntake(db,supplied,requestId,input)` · `freezeIntake(db,supplied,requestId)` · `thawIntake(db,requestId)` · `duplicateCandidates(db,u,requestId)` · `earliestDelivery(db,r,service)` · `submissionGate(db,supplied,requestId)` · `requestIntakeView(db,supplied,requestId)`. الواجهة `intakeSettingsUI` تستدعي `GET /intake/settings` و`POST /intake/scales` و`POST /intake/matrix` (كلاهما `idempotent:true`).

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/intake/settings` | `requestIntake.intakeSettings(db,u)` | لا / لا |
| POST | `/api/intake/scales` | `requestIntake.defineScale(db,u,input)` | نعم / نعم ⚠ |
| POST | `/api/intake/matrix` | `requestIntake.setMatrixCell(db,u,input)` | نعم / نعم ⚠ |
| GET | `/api/requests/:id/intake` | `requestIntake.requestIntakeView(db,u,id)` | لا / لا |
| POST | `/api/requests/:id/intake` | `requestIntake.saveIntake(db,u,id,input)` | نعم / لا |

GET:
```js
      if(p==='/api/intake/settings'&&req.method==='GET') {send(200,requestIntake.intakeSettings(db,u));return;}
      const requestIntakeRead=p.match(/^\/api\/requests\/([a-f0-9-]+)\/intake$/);
      if(requestIntakeRead&&req.method==='GET') {send(200,requestIntake.requestIntakeView(db,u,requestIntakeRead[1]));return;}
```
POST — ⚠ `defineScale` و`setMatrixCell` يعيدان `intakeSettings(...)` بلا `id`:
```js
        if(p==='/api/intake/scales'&&req.method==='POST') return once(()=>({...requestIntake.defineScale(db,u,input),id:u.tenant_id}),()=>requestIntake.intakeSettings(db,u));
        if(p==='/api/intake/matrix'&&req.method==='POST') return once(()=>({...requestIntake.setMatrixCell(db,u,input),id:u.tenant_id}),()=>requestIntake.intakeSettings(db,u));
        const requestIntakeSave=p.match(/^\/api\/requests\/([a-f0-9-]+)\/intake$/);
        if(requestIntakeSave&&req.method==='POST') return requestIntake.saveIntake(db,u,requestIntakeSave[1],input);
```
- الاستيراد: `import * as requestIntake from './request-intake.mjs';` · الملف: `intake-settings-ui` · المفتاح: `'intake-settings':intakeSettingsUI` ← `import { intakeSettingsUI } from './intake-settings-ui.mjs';`
- التنقل: الطلبات والخدمات (بجوار `catalog`): `if(has('catalog.manage'))nav.push(['intake-settings','⚖','مقاييس استقبال الطلبات','Request intake scales']);`
- الصندوق: لا شيء.
- الترتيب: ⚠ `requestIntakeRead` يجب أن يكون في كتلة GET **قبل السطر 229** (`fail(404)` لغير POST/PATCH). السطر 223 لا يلتقطه (يشترط `!match[2]`). `requestIntakeSave` قبل السطر 501؛ فرع `if(match)` لا يلتقط `intake` لكنه لا يمرّ إلى ما بعده إلا لـ`fail`.

---

## 3. أصناف CSS الجديدة

- **لا وحدة تحتاج صنفًا لتعمل.** فحصتُ كل `class="…"` ثابت في ملفات الواجهة الـ25 مقابل `app/static/*.css`: كلها موجودة (بما فيها `is-warn` `is-block` `vn-group` `vn-card` `detail-data` التي استعملها الإنتاج).
- **طلب اختياري واحد — review-rounds** (للطبقة المرئية فوق المادة، غير مبنية):
  - `review-canvas` — حاوية `position:relative` للمادة.
  - `review-pin` — علامة مرقّمة `position:absolute` تُوضع بـ`left`/`top` من متغيرين مخصصين.
  - `review-media` — `max-width:100%` و`height:auto` للصورة والفيديو، و`min-height` للإطار.
  - `review-text` — `white-space:pre-wrap` للمادة النصية.

## 4. الاعتماديات بين الوحدات (ما يصله المنسّق خارج §2)

| من | إلى | أين بالضبط | الحالة |
|---|---|---|---|
| cash-forecast | billing-recurring | `cash-forecast.mjs` يستورد `duePeriods` من `billing-recurring.mjs` | موصول؛ لا يُغيَّر توقيع `duePeriods(schedule,today)` |
| cash-forecast | bank-reconciliation | الرصيد الافتتاحي: آخر `bank_reconciliations` بحالة `approved`، العمود `statement_closing_minor` (مع `period_end` و`bank_account_id`) ⇒ `opening_balance` و`opening_source='bank_reconciliation'` | غير موصول |
| cash-forecast | contracts-register | المصروفات المتكررة: `contract_records.value_minor` بلا دورية — لا يُشتق | قرار §7 |
| close-checklist | finance | `approve_close` يستدعي `finance.financeReferenceAction(db,u,'periods',id,'close',…)` | موصول؛ المعتمد يلزمه تفويض `configure` المالي |
| profitability | resourcing | يُمرَّر كائن `forecast` إلى `projectProfitability(db,u,{project_id,from,to,forecast})`/`clientProfitability`: `{budget_minor,committed_future_minor,remaining_cost_minor\|remaining_minutes,expected_revenue_minor}` من حجوزات `resource_bookings` المؤكدة | غير موصول |
| profitability | timesheets | `timeCost()` في `profitability.mjs` يقرأ `time_entries.status='approved'`؛ اعتماد الأسبوع في `timesheets.mjs` يختم الإدخالات بنفسه | متوافق اليوم |
| timesheets | agency | محفّزات 058 على `time_entries` تمنع `agency.decideTime`/الحذف في أسبوع مُرسَل/معتمد/مقفل | ساري فور تطبيق الهجرة |
| feedback | home | `import { openFollowUps } from './feedback.mjs';` في `app/home.mjs` + `const followUps=read('بنود اللقاءات الفردية',()=>openFollowUps(db,u))??[]; home.follow_ups=followUps;` + بطاقة `card('follow_ups','بنود متابعة عليّ',followUps.length,'#one-to-ones',followUps.some(i=>i.overdue)?'is-late':followUps.length?'is-due':'')` | غير موصول |
| feedback | talent-ui | `GET /api/feedback/evidence/:reviewId` يُستدعى من `app/static/talent-ui.mjs` عند فتح تقييم | غير موصول (المسار مربوط في §2.6) |
| lifecycle | payroll-extras | بوابة `clearanceBlockers` قبل `decideSettlement(…,'approve')` — §2.21 | يوصل مع §2.21 |
| leave-accrual | payroll-extras | `accrualSettlementView(db,u,employeeId)` تُعرض بجوار نموذج التسوية في شاشة الرواتب | غير موصول (اقتراح) |
| leave-accrual | leave | الحجز من الرصيد الافتتاحي في `leave.mjs` لا من الاستحقاق | قرار §7 |
| payroll-anomaly | payroll | `anomalies:anomaly.runAnomalies(db,u.tenant_id,r)` في `GET /api/payroll` — §2.20 | اختياري |
| governance | reports | `GOVERNANCE_REPORTS` إلى `REPORTS` في `app/reports.mjs` — §2.7 | غير موصول |
| influencers | payables | `paymentGate(db,engagementRow,influencerRow,contentViews,date)` تُستدعى في `payables.mjs` قبل اعتماد أمر دفع لمورد مؤثر | قرار §7 |
| influencers | files | `proofFileAccess(db,u,proofId)` تُسجَّل في `ENTITIES` في `app/files.mjs` بنوع `influencer_proof` | غير موصول |
| letters | service-cards | `'HR-LETTER':'letters'` في `SERVICE_MODULES` داخل `app/service-cards.mjs` | غير موصول |
| pr | privacy | نشاط معالجة «دليل جهات الإعلام» في `processing_activities` | غير موصول (بيانات، لا كود) |
| pr / equipment | production | `equipment_bookings.production_ref` نص حر ⇒ `production_id` بقيد مرجعي بهجرة لاحقة | غير موصول |
| equipment | app.mjs | `qrTarget` = `/#equipment/item/<id>`؛ الموجّه اليوم يأخذ `view=route.split('/')[0]` فيفتح الشاشة لا القطعة | ناقص |
| tax-returns | payables | يستورد `verifiedInputVat` | موصول |
| tax-returns | compliance | `filing_reference` يُكتب في `evidence_reference` عند `complete_obligation`؛ ربط أقوى عبر `currentPeriod(o,date)` | يدوي |
| einvoice | invoices | `assertBuyerReady(db,u,caseId)` قبل `prepareInvoice` | قرار §7 |
| expiry | contracts-register | `contract_records` (057) يحمل الآن تاريخ انتهاء؛ `expiry.mjs` صرّح أن العقود التجارية لا تُراقَب لأن `commercial_contracts` بلا تاريخ | فرصة ربط، غير موصول |
| search | كل الوحدات | `indexEntity(db,{…})` عند الكتابة بدل إعادة البناء كل 15 ثانية | غير موصول |
| review-rounds | studio / client-approvals | يقرأ `studio_output_versions` و`external_approvals` | موصول بالقراءة |
| contracts-register | campaigns | ربط اختياري بـ`scope_baselines` | موصول |
| billing-recurring | invoices | `mark_issued` يتطلب `tax_invoices.status='issued'` | موصول (توثيقي) |
| request-intake | workflow | `submissionGate` و`freezeIntake` و`thawIntake` لا يستدعيها `workflow.mjs` (لا استيراد لـ`request-intake` خارج اختباره) | **غير موصول** — §8 |

## 5. تعارضات

### 5.1 مفاتيح الوحدات والشاشات
1. **`home`**: مفتاح `operationModules` الجديد يطغى على الفرع اليدوي `else if(['home','requests'].includes(view))` في `app.mjs` (السطر 129) لأن `operationModules[view]` يُفحص أولًا (السطر 112). و`#home` هو المسار الافتراضي (`location.hash.slice(1)||'home'`). الفرع يبقى حيًا لـ`requests` فقط. قرار: تنظيف كود `home` الميت، وإبقاء «يومي» أو تغييرها إلى «الرئيسية».
2. **`retainers`** (مفتاح جديد لـ`retainer_agreements`) مقابل «اشتراكات» الوكالة القائمة (`/api/clients/retainers`، جدولا `retainers` و`retainer_usage`، `agency.createRetainer`). لا اصطدام في الكود، لكن مفهومان باسم واحد في شاشتين.
3. **`timesheets`** (جديد) مقابل **`time`** القائم (`agency.timeBoard`): شاشتا وقت؛ `time` يفترض 40 ساعة و`resourcing` يرفض الافتراض؛ واعتماد الأسبوع يعطّل اعتماد الإدخال المفرد.
4. **`feedback`** (مفتاح ومسار `/api/feedback`) مقابل «تقييم جودة الخدمة» القائم (`/api/requests/:id/feedback`، `service-feedback.mjs`، `feedbackPanel`): لا اصطدام مسار، اسمان متقاربان لمعنيين.
5. **`contracts`** (عقدي وراتبي) · **`contracts-register`** (عقود الوكالة) · `/api/hr/contracts`: مقصود ومفصول بالاسم.
6. **`decisions`** مفتاح شاشة؛ لا يصطدم بثابت `DECISIONS` ولا بـ`overview.decisions`.

### 5.2 أسماء الدوال المكررة بين الوحدات (خطر عند الاستيراد المسمّى)
`createSchedule` (billing-recurring · accruals) · `scheduleAction` (billing-recurring · accruals) · `createBooking` (resourcing · equipment) · `requestAction` (feedback · privacy) · `createCycle` (engagement · talent) · `templatesBoard` (letters · agency) · `KINDS` (accruals · production · lifecycle · inbox) · `SOURCES` (feedback · inbox) · `DECISIONS` (review-rounds · inbox) · `CADENCES` (billing-recurring · contracts-register) · `VISIBILITY` (engagement · feedback) · `STATUS_NAMES` (letters · einvoice-gateway · einvoice-selfcheck). ⇒ `import * as` في `server.mjs` إلزامي، والاسم المستعار `letterTemplatesBoard` في `inbox.mjs`.

### 5.3 متغيرات `const` في `server.mjs`
مقترحات التسليمات التي كانت ستصطدم: `obligationStep` (contracts-register ← موجود لـ`compliance`)، `requestStep` (feedback وprivacy معًا)، `reviewStep`/`cycleStep`/`planStep` (موجودة لـ`talent`). كلها أُعيدت تسميتها في §2.

### 5.4 أسماء الأفعال المشتركة
- `answer_request`: feedback (رد على طلب تغذية راجعة) وprivacy (رد على صاحب بيانات). مفتاح `DECISIONS` واحد يسمّي الاثنين «رد مطلوب».
- `release_booking` (resourcing) يُقرأ «إصدار» لأن رأسه `release` في `DECISIONS` لإصدار دورات الأداء — عولج بالتصفية في §2.16.
- `complete_task` (close-checklist) يُضاف إلى `DECISIONS`؛ `people-ui.mjs` يعرف الاسم نفسه لكن `people.mjs` لا يصدره في `actions` (تحقّقت) فلا أثر جانبي.

### 5.5 الملفات والجداول والهجرات
- لا اسم ملف ثابت مكرر، ولا رقم هجرة مكرر، ولا اسم جدول/محفّز مكرر بين الهجرات الجديدة (047–072، 090). التكرارات الموجودة في المخطط (`finance_account_mappings` و`finance_source_links` و`payslip_views` و`procurement_award_guard` و`payroll_lines_locked_*`) سابقة في 005/027/028/030/031/039 وخارج هذه الدفعة.
- `tests/lifecycle.test.mjs` قائم لغرض آخر؛ اختبار الوحدة `tests/lifecycle-bundles.test.mjs`.
- `app/migrations/076-request-transparency.sql` موجود بلا تسليم (مستبعد بتوجيه المنسّق).

### 5.6 بنى متوازية لنفس الحاجة (تعارض تصميم لا كود)
- **إشعارات بديلة** عن `notifications` (الذي يشترط `request_id`): `review_notices` · `timesheet_reminders` · سطور `call_sheet_invitees` · اعتماد `lifecycle` والإعلانات على الصندوق. خمسة وحدات، خمسة حلول.
- **مخازن ملفات بديلة** عن `stored_files` (المقيّد بـ`CHECK` على أربعة أنواع): `announcement_attachments` · `equipment_photos` · `review_media` · (المؤثرون ينتظرون نوع `influencer_proof`) · (الإنتاج ترك المرجع نصًا).

## 6. «بانتظار قراري» مجمّعًا

### 6.1 ما تحقّقتُ منه بمحاكاة `labelFor` الفعلية
- يعمل بلا تعديل: `approve_match` `approve_reconciliation` `confirm_advance` `dismiss_draft` `approve_close` `approve_reopen` `approve_entry` `decide_renewal` `confirm_amendment` `complete_obligation` `verify_obligation` `acknowledge` `approve_announcement` `approve_nomination` `approve_initiative` `review_risk` `accept_risk` `approve_minute` `record_execution` `review_expiry` `approve_engagement` `return_engagement` `approve_content` `return_content` `record_client_approval` `verify_proof` `accept_accrual_policy` `issue_letter` `approve_template` `approve_activity` `approve_transfer` `verify_identity` `issue_sheet` `accept_close` `confirm` `approve_rate` `approve_overhead` `approve_timesheet` `confirm_booking` `decide` `confirm_rate` `review_worksheet` `review_zakat` `confirm_format` `decide_late_step` `verify_clearance` `confirm_lost` `reject_lost`.
- يسقط اليوم ويحتاج `DECISIONS` (§1.7): `mark_issued` `close_period` `complete_task` `complete_item` `answer_request` `submit_360` `prepare_letter` `lock_list` `close_check` `record_check` `update_incident` `record_filing` `record_remittance` `record_upload` `record_difference`.

### 6.2 مفاتيح `KINDS` المصطدمة في مقترحات التسليمات
| المقترح | في `KINDS` اليوم | صار |
|---|---|---|
| accruals `entries` | «ساعات عمل» | `installments` |
| tax-returns `entries` | «ساعات عمل» | `withholding_items` |
| feedback `items` | «محتوى» | `follow_ups` |
| governance `items` | «محتوى» | `governance_items` |
| feedback `records` | «موافقة عميل» | `feedback_requests` |
| feedback `reviews` | «تقييم أداء» | `reviews_360` |
| letters `templates` (إضافة عامة) | — لكن `templates` مفتاح في لوحات أخرى (close-checklist، lifecycle) | `letter_templates` |

`KINDS` يُطابَق باسم المفتاح في **كل** لوحة تُمشى، فإضافة اسم عام تغيّر وسم وحدات أخرى.

### 6.3 مصادر لا تُمرَّر كاملة
`privacyBoard` (مع `record_check` في `DECISIONS` تظهر كل قاعدة نشطة) · `resourcingBoard` (`release_booking`) · `oneToOnesBoard` (خصوصية المحضر) · `wpsBoard` و`wageReconciliation` (تصفية بالشروط).

### 6.4 سلوك الحلقة
`inbox()` يلتقط كل خطأ يحمل `status` ويتخطى المصدر صامتًا؛ فلا حاجة لـ`try` داخل الأسطر. خطأ بلا `status` يضع اسم المصدر في `unavailable`.

### 6.5 أسطر `SOURCES` كاملة (تُلحق بآخر المصفوفة، السطر 56)
```js
  ['bank-reconciliation','المطابقة البنكية',(db,u)=>({bank_items:bankBoard(db,u).inbox})],
  ['billing-schedules','الفوترة الدورية',schedulesBoard],['retainers','اتفاقات الاشتراك',retainersBoard],
  ['close-checklist','الإقفال الشهري',(db,u)=>({periods:closeBoard(db,u).inbox})],
  ['accruals','الإطفاء والاستحقاقات',(db,u)=>({installments:accrualsBoard(db,u).inbox})],
  ['contracts-register','سجل العقود والتجديدات',contractAlerts],
  ['announcements','الإعلانات الداخلية',(db,u)=>({announcements:announcementsBoard(db,u).awaiting_me})],
  ['one-to-ones','اللقاءات الفردية',(db,u)=>({follow_ups:oneToOnesBoard(db,u).my_open_items.map(i=>({...i,actions:['complete_item']}))})],
  ['feedback','التغذية الراجعة',(db,u)=>({feedback_requests:feedbackBoard(db,u).requests_to_me.filter(r=>r.status==='open')})],
  ['review-360','تقييم 360',(db,u)=>({reviews_360:review360Board(db,u).cycles.flatMap(c=>[...c.my_tasks,...c.panels.flatMap(p=>p.nominations.filter(n=>n.actions.length))])})],
  ['objectives','الأهداف والمبادرات',(db,u)=>({initiatives:objectivesBoard(db,u).inbox})],
  ['risks','سجل المخاطر',(db,u)=>({risks:risksBoard(db,u).inbox})],
  ['decisions','القرارات والالتزامات',(db,u)=>({governance_items:decisionsBoard(db,u).inbox})],
  ['expiry','انتهاء الوثائق',expirySources],
  ['influencer-campaigns','ارتباطات المؤثرين',influencerCampaignsBoard],
  ['leave-accrual','استحقاق الإجازات',accrualBoard],
  ['letters','خطابات الموظفين',(db,u)=>({letters:lettersBoard(db,u).awaiting_me})],
  ['letter-templates','قوالب الخطابات',(db,u)=>({letter_templates:letterTemplatesBoard(db,u).awaiting_me})],
  ['pr','العلاقات العامة',prBoard],['equipment','المعدات والعهد',equipmentBoard],
  ['privacy','حماية البيانات',(db,u)=>({privacy_items:privacyBoard(db,u).inbox})],
  ['subject-requests','طلبات أصحاب البيانات',(db,u)=>({subject_requests:subjectRequestsBoard(db,u).inbox})],
  ['productions','الإنتاج والتصوير',productionsBoard],['call-sheets','أوراق الاستدعاء',callSheetsBoard],
  ['cost-rates','معدلات التكلفة',(db,u)=>({rates:costRatesBoard(db,u).awaiting_me})],
  ['timesheets','كشوف الوقت',timesheetsBoard],
  ['resourcing','تخطيط الموارد',(db,u)=>({bookings:resourcingBoard(db,u).bookings.filter(b=>b.status==='tentative'&&b.user_id!==u.id).map(b=>({...b,actions:['confirm_booking']}))})],
  ['review-rounds','جولات المراجعة',reviewBoard],
  ['tax-returns','أوراق العمل الضريبية',(db,u)=>({worksheets:vatBoard(db,u).inbox,withholding_items:withholdingBoard(db,u).inbox})],
  ['wps','ملف حماية الأجور',(db,u)=>{const board=wpsBoard(db,u);return {wps_formats:board.formats.filter(f=>f.actions.includes('confirm_format')),wps_exports:board.exports.filter(x=>x.actions.includes('record_upload'))};}],
  ['wage-reconciliation','مطابقة الأجور',(db,u)=>({wage_gaps:wageReconciliation(db,u).rows.filter(r=>r.state==='different'&&r.notes.length===0&&r.actions.includes('record_difference'))})],
  ['lifecycle','حزم التعيين والمغادرة',lifecycleBoard]
```
الوحدات بلا مصدر عمدًا: cash-forecast · home · search · einvoice · request-intake · pulse/recognition · influencers (السجل) · benefits · payroll-anomaly · media-contacts.

## 7. قرارات المالك المعلّقة (مجمّعة، بلا تكرار)

**عابرة للوحدات**
1. توسيع جدول `notifications` لكيانات غير الطلب (`request_id` قابل للفراغ + `entity_type/entity_id`) أو قبول البدائل الخمسة (§5.6). — engagement · production · resourcing · review-rounds · lifecycle
2. توحيد مخزن الملفات: توسيع `stored_files.entity_type` و`ENTITIES` في `files.mjs` (إعلانات، صور معدات، مادة مراجعة، إثبات مؤثر، مرجع لقطة). — engagement · equipment · review-rounds · influencers · production
3. منح كل تصريح فصلِ مهام لشخصين مختلفين على الأقل (وثلاثة حيث يلزم): `bank.reconcile`/`bank.reconcile.approve` · `finance.close.manage` (منفّذ/معتمد/ثالث للفتح) · `finance.forecast.view` · `hr.survey.manage` · `hr.feedback.manage` · `privacy.manage` · `tax.returns.prepare`/`review` · `timesheets.approve` · `resourcing.plan` · `costing.manage`/`profitability.view` · `payroll.*` · `einvoice.manage`.
4. العملات الأجنبية وأسعار الصرف المؤرّخة على مستوى المنصة، أم نص حر. — contracts-register (وأثره على billing وinvoices)
5. هل تُدوَّن القراءة والطباعة والتصدير في سجل التدقيق؟ الفحص الذاتي للفوترة وجدها فجوة حقيقية؛ والبحث لا يدوّن إلا إعادة البناء الصريحة. — einvoice · search
6. إرسال بريد/رسائل خارج المنصة: لا مزوّد في أي وحدة.

**المالية**
7. مطابقة بنكية جزئية (دفعة لعدة فواتير) أم التصنيف اليدوي. — bank-reconciliation
8. توليد `ar_claims` بـ`basis='advance'` للفوترة الدورية أم ربط توثيقي. — billing-recurring
9. تأكيد المختص الضريبي لمعالجة الدفعات المقدمة في الفاتورة الإلكترونية (نص `ZATCA_ADVANCE_WARNING` يبقى). — billing-recurring
10. سجل التزامات متكررة (إيجار، اشتراكات) للتنبؤ النقدي أم أوامر شراء. — cash-forecast
11. حصة المنشأة في التأمينات ومكافأة نهاية الخدمة كمعامل سياسة؛ وشهر صرف الرواتب (نفس الشهر أم التالي). — cash-forecast
12. تطبيق وسيط التحصيل التاريخي على التنبؤ صراحةً أم لا. — cash-forecast
13. إعادة فتح فترة محاسبية مقفلة: مسار موثّق أم قيد عكس فقط؛ وإنشاء فترات محاسبية شهرية. — close-checklist
14. زر «رحّل» يستدعي `createJournal` من قسط الإطفاء المعتمد؛ وأتمتة عكس الاستحقاق عند وصول الفاتورة. — accruals
15. اعتماد الفئات الوظيفية ومعدلاتها بمصدرها؛ ومخصص تكلفة كامل للمشروع بدل مخصصات المشتريات. — profitability
16. أساس الإيراد في الربحية (تاريخ التوريد صافيًا من الضريبة، أم تاريخ الإصدار). — profitability
17. المختص الضريبي المعتمد؛ مواعيد التقديم والتوريد؛ تعيين البنود على خانات النموذج؛ صلاحية إلغاء سجل استقطاع. — tax-returns
18. هل يبقى رقم المستند المرفوض من الجهة مستهلكًا (مقترح `REJECTION_POLICY`)؛ واستدعاء `assertBuyerReady` قبل `prepareInvoice`؛ وإضافة الإشعار المدين. — einvoice
19. منع اعتماد أمر دفع لمورد مؤثر غير مربوط (`paymentGate` في `payables`). — influencers
20. ربط `payables`/`invoices` بسجل العقود. — contracts-register
21. ترحيل تكلفة صيانة المعدات إلى المصروفات. — equipment
22. هل يلزم أن يكون المورد «معتمدًا» قبل تكليفه في الإنتاج. — production

**الموارد البشرية والرواتب**
23. هل غياب حزمة مغادرة يمنع التسوية النهائية (الحالي: نعم، ويكسر `PAY-09`)؛ ومن يغلق بند الإخلاء (مالك الحزمة أم مالك إجراء المصدر). — lifecycle
24. رقم الهوية الكامل مشفّرًا لملف حماية الأجور، أم إكماله خارج المنصة. — wage-protection
25. السماح بتبرير سطر مسير صافيه صفر أثناء المراجعة (`payroll.mjs`). — wage-protection
26. قواعد استحقاق الإجازات (من يدخلها ومن يراجعها نظاميًا)؛ وهل يصبح رصيد الاستحقاق مصدر الحجز في `leave.mjs`. — leave-accrual
27. نصوص قوالب الخطابات الخمسة واعتمادها؛ إيقاف نوع أساسي لكل كيان؛ حد معدّل وأثر تدقيقي لمسار التحقق العام. — letters
28. من يرى نتائج 360 ومتى؛ ومدّ حد المستجيبين إلى الأقران. — feedback
29. إدراج دعوة النبض في الصندوق (الحالي: لا)؛ ومالك إجراء القيم المؤسسية. — engagement
30. مدد تذكير انتهاء الوثائق: يكفي مالك الإجراء أم اعتماد ثانٍ؛ و`vendors.view` أم `vendors.manage` لوثائق الموردين؛ وتاريخ انتهاء للاتفاق التجاري. — expiry
31. مهل تنبيه العقود الثلاث (إشعار عدم التجديد، الانتهاء، استحقاق البند). — contracts-register
32. مدة قفل كشوف الوقت؛ السعة الأسبوعية لكل شخص؛ من يحمل `timesheets.approve`/`resourcing.plan`؛ نطاق رؤية لوحة السعة. — resourcing
33. مقياس المخاطر ونطاقاته؛ قياس أثر القرار. — governance
34. مالك كل نشاط معالجة وأساسه ومدة احتفاظه؛ مهلة الرد على صاحب البيانات؛ مهلة الإبلاغ عن الحادثة؛ بلد مزوّد النموذج وضمانته. — privacy
35. مدة احتفاظ دليل جهات الإعلام ومن يبت في طلب الحذف (حذف أم طمس). — pr
36. كفاية إقرار العهدة داخل المنصة للمطالبة بقيمة المفقود. — equipment
37. تأكيد المختص القانوني لمتطلب رخصة المؤثر وتحويله إلى منع. — influencers
38. حصر وحدة الإنتاج بإدارة. — production
39. فتح بوابة مراجعة للعميل؛ ترحيل التعليقات المفتوحة تلقائيًا إلى النسخة التالية. — review-rounds
40. فهرسة البحث التزايدية (`indexEntity`) أو ضبط `maxAgeMs`؛ بحث المدير في فريقه بلا `employees.view`؛ حجب بطاقات الخدمة «السرية». — search

## 8. ما نقص من التسليمات أو بقي غامضًا

1. **request-intake (بلا تسليم):** `submissionGate` و`freezeIntake` و`thawIntake` لا يستدعيها `workflow.mjs`، ولا واجهة تستدعي `GET/POST /api/requests/:id/intake` (لا ذكر لـ`intake` في `app.mjs`). الربط في §2.23 يفتح المسارات فقط؛ بوابة التقديم والتجميد غير فاعلة.
2. **home-expiry:** سطر `once` المقترح خاطئ في أمرين (مفتاح مشروط، ولا `id`) — صُحّح في §2.8.
3. **leave-benefits:** وصف `adjustments` بأنه `once` دون ذكر أن الدالة لا تعيد `id` — صُحّح. مسار `/benefits/enrolments/:id/dependants` يتجاهل `:id`؛ `addDependant(db,u,input)` تأخذ `input.enrolment_id` من الجسم، فلا ضمان تطابق المسار والجسم. لا سطر `SOURCES` ولا شرط تنقل.
4. **privacy:** الجدول وصف `/privacy/activities` بـ«نعم» مطلقًا بينما التحرير يمرّ بالمسار نفسه بلا مفتاح؛ و`/activities/suggest` بلا `id` — صُحّحا. لم يذكر نص تسميات `record_check`/`update_incident`/`answer_request` في الصندوق. ⚠ لم أتحقق من أن `toPayload` لـ`edit_rule` يرسل `id` (تحققتُ لـ`edit_activity` فقط).
5. **resourcing:** `lock`/`remind` بلا `id` — صُحّح. جدول الصندوق يطلب «أسبوعك أُعيد» و«تذكير غير مقروء» ولا فعل قرار يحملهما.
6. **profitability:** `tags` بلا `id` — صُحّح. نماذج `method:'GET'` الثلاث تعيد جسمًا فتنكسر في `api()`، ولو عملت لما أعاد `render()` تحميل الفلتر (يستدعي `load` بلا معاملات). لا سطر `SOURCES`.
7. **tax-returns:** لم يذكر أن `revise_*` وحدها ترسل المفتاح ضمن مسار مشترك — عولج بالتفريع.
8. **review-rounds:** لا اسم مساحة استيراد (اخترتُ `reviewRounds`). مسار المعاينة يحتاج تجاوز `X-Frame-Options`، **ولم يُختبر في متصفح** عرضُ PDF داخل `<iframe>`.
9. **pr-equipment:** «بانتظار قراري» جاء استعلامات SQL لا لوحات؛ «الحجز المتأخر» لا يُعبَّر عنه بفعل فلا يظهر. أسماء التنقل والأيقونات من المواصفة. المسار `#equipment/item/<id>` في QR لا يفهمه الموجّه.
10. **billing-recurring:** «بانتظار قراري» استعلامات SQL لا لوحة؛ لم أتحقق أن `close_period` في `retainersBoard` محصور بصاحب العقد كما يقول النص.
11. **einvoice:** صيغة `caseId` في `/api/einvoice/buyers/:caseId` لم تُذكر؛ اعتمدتُ UUID (المسار اختياري).
12. **engagement / feedback / governance / production / leave-benefits / bank / cost-rates / wps:** لم يعطِ أيٌّ منها سطر `nav.push` كاملًا؛ الشروط في §2 مشتقة من التصريح الذي ترفض به اللوحة، والأيقونات والتسميات من المواصفة.
13. **engagement، home-expiry، search، leave-benefits، lifecycle، wage-protection:** ذكرت مجموعات «خدمات الموظف»/«الأساس»/«الرواتب» غير الموجودة في `groupedNavigation` — حُوّلت في §1.5.
14. **letters:** مسار `/verify/letter/:code` محصور عمليًا بـ`hostPattern` (localhost أو عنوان واحد صريح)، فرمز QR لن يفتح من خارج الجهاز في هذه النسخة؛ وحد المعدّل غير مبني.
15. **wage-protection:** لا منتقي شهر في الواجهة لـ`?month=`؛ يحتاج دعمًا في `app.mjs`.
16. **production:** رابط الطباعة في «استدعاءاتي» يمرر `i.id` من `my_invitations`؛ لم أتحقق أهو معرّف الورقة أم سطر الاستدعاء.
17. **بلا تسليم ومستبعدة بتوجيه المنسّق:** الهجرة `076-request-transparency.sql` والوحدات `request-timeline.mjs` و`request-closure.mjs` وغيرها مما لا ملف تسليم له.

---

## 9. ملحق — سبعة تسليمات وصلت أثناء الكتابة (15:45–15:54)

`request-transparency` · `knowledge-access` · `pipeline-estimates` · `platform-ops` · `request-quality` · `hr-cases-comp` · `media-spend`. الصيغة والقواعد (§0) نفسها؛ الإضافات إلى قوائم §1 مجمّعة في §9.8.

### 9.1 request-transparency — الخط الزمني والإغلاق والتجربة والقياس

الصادرات المتحقَّق منها: `request-timeline.mjs`: `timeline(db,supplied,requestId)` · `myTimelineBoard(db,supplied)`؛ `request-closure.mjs`: `setReopenWindow(db,supplied,input)` · `closeWithEvidence(db,supplied,requestId,input)` · `requestReopen(db,supplied,requestId,input)` · `closureView(db,supplied,requestId)`؛ `service-experience.mjs`: `setExperienceThreshold(db,supplied,input)` · `experienceQuestion(db,supplied,requestId)` · `answerExperience(db,supplied,requestId,input)`؛ `process-insight.mjs`: `serviceInsightScreen(db,supplied,query={})`.

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/my-request-timeline` | `requestTimeline.myTimelineBoard(db,u)` | لا / لا |
| GET | `/api/request-timeline/:id` | `requestTimeline.timeline(db,u,id)` | لا / لا |
| POST | `/api/request-timeline/:id/view` | `requestTimeline.timeline(db,u,id)` — قراءة | نعم (لا ضرر) / لا |
| GET | `/api/service-insight` | `processInsight.serviceInsightScreen(db,u,{service_code?})` | لا / لا |
| GET | `/api/request-closure/:id` | `requestClosure.closureView(db,u,id)` | لا / لا |
| POST | `/api/request-closure/:id/close` | `requestClosure.closeWithEvidence(db,u,id,input)` | نعم / نعم ⚠ |
| POST | `/api/request-closure/:id/reopen` | `requestClosure.requestReopen(db,u,id,input)` | نعم / نعم ⚠ |
| POST | `/api/request-closure/window` | `requestClosure.setReopenWindow(db,u,input)` | نعم / نعم ⚠ |
| GET | `/api/service-experience/:id` | `serviceExperience.experienceQuestion(db,u,id)` | لا / لا |
| POST | `/api/service-experience/:id/answer` | `serviceExperience.answerExperience(db,u,id,input)` | نعم / نعم ⚠ |
| POST | `/api/service-experience/threshold` | `serviceExperience.setExperienceThreshold(db,u,input)` | نعم / نعم ⚠ |

⚠ **الدوال الخمس لا تعيد `id` في المستوى الأعلى** (`closureView` يعيد `{request:{id},…}`؛ `setReopenWindow` يعيد `closureBoard`؛ `setExperienceThreshold` يعيد `{min_responses,confirmed_on}`؛ `answerExperience` يعيد `experienceQuestion`) والواجهة ترسل المفتاح لها كلها، فتُلف.

GET:
```js
      if(p==='/api/my-request-timeline'&&req.method==='GET') {send(200,requestTimeline.myTimelineBoard(db,u));return;}
      if(p==='/api/service-insight'&&req.method==='GET') {send(200,processInsight.serviceInsightScreen(db,u,url.searchParams.has('service_code')?{service_code:url.searchParams.get('service_code')}:{}));return;}
      const timelineRead=p.match(/^\/api\/request-timeline\/([a-f0-9-]+)$/);
      if(timelineRead&&req.method==='GET') {send(200,requestTimeline.timeline(db,u,timelineRead[1]));return;}
      const closureRead=p.match(/^\/api\/request-closure\/([a-f0-9-]+)$/);
      if(closureRead&&req.method==='GET') {send(200,requestClosure.closureView(db,u,closureRead[1]));return;}
      const experienceRead=p.match(/^\/api\/service-experience\/([a-f0-9-]+)$/);
      if(experienceRead&&req.method==='GET') {send(200,serviceExperience.experienceQuestion(db,u,experienceRead[1]));return;}
```
POST:
```js
        if(p==='/api/request-closure/window'&&req.method==='POST') return once(()=>({id:u.tenant_id,...requestClosure.setReopenWindow(db,u,input)}),()=>requestClosure.closureBoard(db,u));
        if(p==='/api/service-experience/threshold'&&req.method==='POST') return once(()=>({id:u.tenant_id,...serviceExperience.setExperienceThreshold(db,u,input)}),id=>({id}));
        const timelineView=p.match(/^\/api\/request-timeline\/([a-f0-9-]+)\/view$/);
        if(timelineView&&req.method==='POST') return requestTimeline.timeline(db,u,timelineView[1]);
        const closureStep=p.match(/^\/api\/request-closure\/([a-f0-9-]+)\/(close|reopen)$/);
        if(closureStep&&req.method==='POST') return once(()=>({id:closureStep[1],...(closureStep[2]==='close'?requestClosure.closeWithEvidence(db,u,closureStep[1],input):requestClosure.requestReopen(db,u,closureStep[1],input))}),id=>requestClosure.closureView(db,u,id));
        const experienceAnswer=p.match(/^\/api\/service-experience\/([a-f0-9-]+)\/answer$/);
        if(experienceAnswer&&req.method==='POST') return once(()=>({id:experienceAnswer[1],...serviceExperience.answerExperience(db,u,experienceAnswer[1],input)}),id=>serviceExperience.experienceQuestion(db,u,id));
```
- الاستيراد: `import * as requestTimeline from './request-timeline.mjs'; import * as requestClosure from './request-closure.mjs'; import * as serviceExperience from './service-experience.mjs'; import * as processInsight from './process-insight.mjs';`
- الملف: `request-transparency-ui` · المفاتيح: `'my-request-timeline':myRequestTimelineUI,'service-insight':serviceInsightUI` ← `import { myRequestTimelineUI, serviceInsightUI } from './request-transparency-ui.mjs';`
- التنقل: `my-request-timeline` ← الطلبات والخدمات (التسليم: «الأساس / طلباتي»)؛ `service-insight` ← القيادة:
  `if(has('requests.use'))nav.push(['my-request-timeline','⇢','أين طلباتي','Where are my requests']);`
  `if(has('executive.view')||has('catalog.manage'))nav.push(['service-insight','◭','قياس الخدمات','Service insight']);`
- الصندوق (مشتق — التسليم وصف المصدر دون سطر):
  `['my-request-timeline','طلباتي',(db,u)=>{const board=myTimelineBoard(db,u);return {timeline_rows:board.rows.filter(r=>r.actions.some(a=>['answer','reopen'].includes(a))),closable:board.closable};}],`
  يحتاج `DECISIONS`: `answer:'سؤال التجربة',reopen:'إعادة الفتح متاحة',close_with_evidence:'إغلاق بدليل'` (الثلاثة تسقط اليوم؛ `view_timeline` يسقط بـ`view_` وهو المطلوب).
- الترتيب: `request-closure/window` و`service-experience/threshold` مطابقتان حرفيتان **قبل** `closureStep`/`experienceAnswer` (نمط `[a-f0-9-]+` لا يلتقط `window` لكن `threshold`… لا يلتقطه أيضًا؛ أبقِ الترتيب). معرّف الطلب بنمط `[a-f0-9-]+` كمسار `/api/requests/:id` القائم.
- ⚠ توصية التسليم: توجيه زر «إكمال» العام (`transition(...,'complete')`) إلى `/api/request-closure/:id/close`، وإلا لا يُعاد فتح الطلب (`no_closure_record`). تعديل في `app.mjs` (السطر 229/261).

### 9.2 knowledge-access — المعرفة وإقرار السياسات ومراجعة الصلاحيات

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/knowledge` | `knowledge.knowledgeBoard(db,u)` | لا / لا |
| POST | `/api/knowledge/sources` | `knowledge.registerSource(db,u,input)` | نعم / نعم |
| POST | `/api/knowledge/sources/:id/(verify_source\|request_update\|edit_source\|retire_source)` | `knowledge.sourceAction(db,u,id,action,input)` | نعم / لا |
| GET | `/api/policy-acknowledgements` | `policyAck.acknowledgementsBoard(db,u)` | لا / لا |
| POST | `/api/policy-acknowledgements/rounds` | `policyAck.openRound(db,u,input)` | نعم / نعم |
| POST | `/api/policy-acknowledgements/rounds/:id/(remind_round\|sync_recipients\|close_round)` | `policyAck.roundAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/policy-acknowledgements/rounds/:id/acknowledge` | `policyAck.acknowledgePolicy(db,u,id,input)` | نعم / لا |
| GET | `/api/access-reviews` | `accessReviews.accessReviewBoard(db,u)` | لا / لا |
| POST | `/api/access-reviews/campaigns` | `accessReviews.openCampaign(db,u,input)` | نعم / نعم |
| POST | `/api/access-reviews/campaigns/:id/close` | `accessReviews.closeCampaign(db,u,id,input)` | نعم / لا |
| POST | `/api/access-reviews/items/:id/decide` | `accessReviews.decideItem(db,u,id,input)` | نعم / لا |
| POST | `/api/access-reviews/revocations/:id/(execute_revocation\|decline_revocation)` | `accessReviews.revocationAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/knowledge'&&req.method==='GET') {send(200,knowledge.knowledgeBoard(db,u));return;}
      if(p==='/api/policy-acknowledgements'&&req.method==='GET') {send(200,policyAck.acknowledgementsBoard(db,u));return;}
      if(p==='/api/access-reviews'&&req.method==='GET') {send(200,accessReviews.accessReviewBoard(db,u));return;}
```
POST:
```js
        if(p==='/api/knowledge/sources'&&req.method==='POST') return once(()=>knowledge.registerSource(db,u,input),id=>({id}));
        const knowledgeSourceStep=p.match(/^\/api\/knowledge\/sources\/([a-f0-9-]{36})\/(verify_source|request_update|edit_source|retire_source)$/);
        if(knowledgeSourceStep&&req.method==='POST') return knowledge.sourceAction(db,u,knowledgeSourceStep[1],knowledgeSourceStep[2],input);
        if(p==='/api/policy-acknowledgements/rounds'&&req.method==='POST') return once(()=>policyAck.openRound(db,u,input),id=>({id}));
        const policyRoundStep=p.match(/^\/api\/policy-acknowledgements\/rounds\/([a-f0-9-]{36})\/(remind_round|sync_recipients|close_round|acknowledge)$/);
        if(policyRoundStep&&req.method==='POST') return policyRoundStep[2]==='acknowledge'?policyAck.acknowledgePolicy(db,u,policyRoundStep[1],input):policyAck.roundAction(db,u,policyRoundStep[1],policyRoundStep[2],input);
        if(p==='/api/access-reviews/campaigns'&&req.method==='POST') return once(()=>accessReviews.openCampaign(db,u,input),id=>({id}));
        const accessCampaignClose=p.match(/^\/api\/access-reviews\/campaigns\/([a-f0-9-]{36})\/close$/);
        if(accessCampaignClose&&req.method==='POST') return accessReviews.closeCampaign(db,u,accessCampaignClose[1],input);
        const accessItemDecide=p.match(/^\/api\/access-reviews\/items\/([a-f0-9-]{36})\/decide$/);
        if(accessItemDecide&&req.method==='POST') return accessReviews.decideItem(db,u,accessItemDecide[1],input);
        const accessRevocationStep=p.match(/^\/api\/access-reviews\/revocations\/([a-f0-9-]{36})\/(execute_revocation|decline_revocation)$/);
        if(accessRevocationStep&&req.method==='POST') return accessReviews.revocationAction(db,u,accessRevocationStep[1],accessRevocationStep[2],input);
```
- الاستيراد: `import * as knowledge from './knowledge.mjs'; import * as policyAck from './policy-acknowledgements.mjs'; import * as accessReviews from './access-reviews.mjs';`
- الملف: `knowledge-access-ui` · المفاتيح: `knowledge:knowledgeUI,'policy-acknowledgements':policyAcknowledgementsUI,'access-reviews':accessReviewsUI` ← `import { knowledgeUI, policyAcknowledgementsUI, accessReviewsUI } from './knowledge-access-ui.mjs';`
- التنقل: `knowledge` و`policy-acknowledgements` ← مساحتي (التسليم: «الأساس»، لكل موظف)؛ `access-reviews` ← إدارة المنصة (والمدير يراها لأن بنوده فيها):
  `if(has('portal.use'))nav.push(['policy-acknowledgements','✓','إقرار السياسات','Policy acknowledgements'],['knowledge','❏','صدق قاعدة المعرفة','Knowledge freshness']);`
  `if(has('access.manage')||has('accounts.manage')||me.role==='manager')nav.push(['access-reviews','⛨','مراجعة الصلاحيات','Access reviews']);`
- الصندوق (من التسليم مع تبديل `items` المصطدم):
  `['knowledge','قاعدة المعرفة',(db,u)=>({knowledge_items:knowledgeBoard(db,u).awaiting_me})],['policy-acknowledgements','إقرار السياسات',(db,u)=>({policy_acks:acknowledgementsBoard(db,u).awaiting_me})],['access-reviews','مراجعة الصلاحيات',(db,u)=>({access_items:accessReviewBoard(db,u).awaiting_me})],`
  الأفعال الأربعة تعمل بلا تعديل (تحقّقت): `verify_source`←«تحقق»، `acknowledge_policy`←«إقرارك مطلوب»، `review_access`←«مراجعة»، `decide_revocation`←«قرار». **`awaiting_me` وحدها** (نص التسليم).
- نقطة وصل في `app/ai.mjs` (داخل `runAssistant` بعد تحديد `output`):
  `const warnings=status==='completed'?knowledgeWarnings(db,u,prepared.sources):[];if(warnings.length)output=`${output}\n\n${warnings.join('\n')}`;` مع `import { knowledgeWarnings } from './knowledge.mjs';`.

### 9.3 pipeline-estimates — الفرص البيعية والتقديرات

الصادرات المتحقَّق منها: `pipeline-estimates.mjs`: `prepareStage` `stageAction` `addLossReason` `lossReasonAction` `createOpportunity` `opportunityAction` `pipelineBoard(db,supplied,query={})`؛ `estimates.mjs`: `preparePriceCard(db,supplied,input)` · `priceCardAction(db,supplied,cardId,action,input)` · `saveEstimate(db,supplied,input,{costRate}={})` · `estimateAction(db,supplied,estimateId,action,input,{costRate}={})` · `commercialPayload(db,supplied,estimateId,input)` · `estimatesBoard(db,supplied,{costRate}={})`.

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/pipeline?from=&to=` | `pipeline.pipelineBoard(db,u,{from,to})` | لا / لا |
| POST | `/api/pipeline/stages` | `pipeline.prepareStage(db,u,input)` | نعم / نعم |
| POST | `/api/pipeline/stages/:id/(approve_stage\|reject_stage\|retire_stage)` | `pipeline.stageAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/pipeline/loss-reasons` | `pipeline.addLossReason(db,u,input)` | نعم / نعم |
| POST | `/api/pipeline/loss-reasons/:id/(deactivate_reason\|activate_reason)` | `pipeline.lossReasonAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/pipeline/opportunities` | `pipeline.createOpportunity(db,u,input)` | نعم / نعم |
| POST | `/api/pipeline/opportunities/:id/(edit\|activity\|move\|win\|lose)` | `pipeline.opportunityAction(db,u,id,action,input)` | نعم / لا |
| GET | `/api/estimates` | `estimates.estimatesBoard(db,u,{costRate})` | لا / لا |
| POST | `/api/estimates/price-cards` | `estimates.preparePriceCard(db,u,input)` | نعم / نعم |
| POST | `/api/estimates/price-cards/:id/(approve_card\|reject_card)` | `estimates.priceCardAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/estimates` | `estimates.saveEstimate(db,u,input,{costRate})` | نعم / نعم |
| POST | `/api/estimates/:id/(edit\|submit\|withdraw\|approve\|reject\|handoff)` | `estimates.estimateAction(db,u,id,action,input,{costRate})` | نعم / لا |
| POST | `/api/estimates/:id/to-quote` | `estimates.commercialPayload(...)` ثم `commercial.commercialAction(...)` | نعم / لا |

محلِّل التكلفة — يُعرَّف **مرة واحدة بعد السطر 129** (بعد فحص كلمة المرور المؤقتة، وقبل كتلة GET لأن `GET /api/estimates` يحتاجه). النص من التسليم، ملفوفًا بحارس `profitability.view` الذي أوصى به التسليم نفسه حتى لا يرى كل حامل `commercial.use` معدلات الفئات:
```js
      const costRate=access.can(db,u,'profitability.view')?({tenant_id,category_code,date})=>{const r=db.prepare("SELECT r.rate_minor,r.effective_from,c.name FROM category_cost_rates r JOIN job_categories c ON c.id=r.category_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=? AND c.code=? AND r.status='approved' AND r.effective_from<=? ORDER BY r.effective_from DESC LIMIT 1").get(tenant_id,category_code,date);return r?{rate_minor:r.rate_minor,source:`معدل فئة ${r.name} المعتمد من ${r.effective_from}`}:null;}:undefined;
```
(إعادة المصادقة في السطر 231 تعيد الهوية نفسها، فلا يُعاد حسابه. بلا المحلِّل تبقى الأسطر «غير مكلَّفة» وتقول الشاشة ذلك.)

GET:
```js
      if(p==='/api/pipeline'&&req.method==='GET') {send(200,pipeline.pipelineBoard(db,u,Object.fromEntries(['from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
      if(p==='/api/estimates'&&req.method==='GET') {send(200,estimates.estimatesBoard(db,u,{costRate}));return;}
```
POST:
```js
        if(p==='/api/pipeline/stages'&&req.method==='POST') return once(()=>pipeline.prepareStage(db,u,input),id=>({id}));
        const pipelineStageStep=p.match(/^\/api\/pipeline\/stages\/([a-f0-9-]{36})\/(approve_stage|reject_stage|retire_stage)$/);
        if(pipelineStageStep&&req.method==='POST') return pipeline.stageAction(db,u,pipelineStageStep[1],pipelineStageStep[2],input);
        if(p==='/api/pipeline/loss-reasons'&&req.method==='POST') return once(()=>pipeline.addLossReason(db,u,input),id=>({id}));
        const lossReasonStep=p.match(/^\/api\/pipeline\/loss-reasons\/([a-f0-9-]{36})\/(deactivate_reason|activate_reason)$/);
        if(lossReasonStep&&req.method==='POST') return pipeline.lossReasonAction(db,u,lossReasonStep[1],lossReasonStep[2],input);
        if(p==='/api/pipeline/opportunities'&&req.method==='POST') return once(()=>pipeline.createOpportunity(db,u,input),id=>({id}));
        const opportunityStep=p.match(/^\/api\/pipeline\/opportunities\/([a-f0-9-]{36})\/(edit|activity|move|win|lose)$/);
        if(opportunityStep&&req.method==='POST') return pipeline.opportunityAction(db,u,opportunityStep[1],opportunityStep[2],input);
        if(p==='/api/estimates/price-cards'&&req.method==='POST') return once(()=>estimates.preparePriceCard(db,u,input),id=>({id}));
        const priceCardStep=p.match(/^\/api\/estimates\/price-cards\/([a-f0-9-]{36})\/(approve_card|reject_card)$/);
        if(priceCardStep&&req.method==='POST') return estimates.priceCardAction(db,u,priceCardStep[1],priceCardStep[2],input);
        if(p==='/api/estimates'&&req.method==='POST') return once(()=>estimates.saveEstimate(db,u,input,{costRate}),id=>({id}));
        const estimateToQuote=p.match(/^\/api\/estimates\/([a-f0-9-]{36})\/to-quote$/);
        if(estimateToQuote&&req.method==='POST'){
          const h=estimates.commercialPayload(db,u,estimateToQuote[1],input);
          if(!h.case_id)fail(409,'handoff_required','اربط التقدير بملف تجاري أولًا');
          return commercial.commercialAction(db,u,h.case_id,h.action,{version:h.case_version,...h.payload});
        }
        const estimateStep=p.match(/^\/api\/estimates\/([a-f0-9-]{36})\/(edit|submit|withdraw|approve|reject|handoff)$/);
        if(estimateStep&&req.method==='POST') return estimates.estimateAction(db,u,estimateStep[1],estimateStep[2],input,{costRate});
```
- الاستيراد: `import * as pipeline from './pipeline-estimates.mjs'; import * as estimates from './estimates.mjs';` (`commercial` و`access` مستوردان أصلًا).
- الملف: `pipeline-estimates-ui` · المفاتيح: `pipeline:pipelineUI,estimates:estimatesUI` ← `import { pipelineUI, estimatesUI } from './pipeline-estimates-ui.mjs';`
- التنقل: التشغيل، بجوار `commercial`: `if(has('commercial.use'))nav.push(['pipeline','◇','الفرص البيعية','Pipeline'],['estimates','▦','التقديرات وأوامر التغيير','Estimates']);`
- الصندوق (مشتق من `awaiting_me` كما وصفه التسليم): `['pipeline','الفرص البيعية',(db,u)=>({stage_revisions:pipelineBoard(db,u).awaiting_me})],['estimates','التقديرات',(db,u)=>({estimate_items:estimatesBoard(db,u).awaiting_me})],` — `approve_stage` و`approve_estimate` و`approve_card` ← «اعتماد».
- الترتيب: `price-cards` و`to-quote` قبل `estimateStep`. الواجهة تحوّل أسماء الأفعال (`oppRoutes`: `close_won`→`win`… و`estRoutes`: `approve_estimate`→`approve`…) فالمسار يستقبل القصيرة.
- ⚠ `app/estimates.mjs` يحوي **بايت NUL خامًا** داخل قالب نصي بعد `${l.role_name}` (نحو الإزاحة 4350). يعمل في Node، لكن `grep` يعامل الملف ثنائيًا ويخفي صادراته. يُستبدل بهروب صريح.

### 9.4 platform-ops — الطابور، الأعلام، حوكمة المساعدين، التقييمات

الصادرات المتحقَّق منها: `jobs.mjs`: `jobsBoard(db,supplied)` · `runDue(db,options={})` · `retryJob` و`cancelJob` (ثابتان: `(db,supplied,jobId,input)`)؛ `feature-flags.mjs`: `flagsBoard(db,supplied,today)` · `createFlag(db,supplied,input,today)` · `updateFlag(db,supplied,flagId,input,today)` · `retireFlag(db,supplied,flagId,input)` · `flagOn(db,u,key,today)`؛ `ai-governance.mjs`: `aiGovernanceBoard(db,supplied,today)` · `seedInventory(db,supplied)` · `submitAssessment(db,supplied,assetId,input)` · `decideAssessment(db,supplied,assessmentId,input,today)` · `activateAsset(db,supplied,assetId,input,today)` · `suspendAsset(db,supplied,assetId,input)` · `assetGate(db,tenantId,assistantKey,today)`؛ `ai-evals.mjs`: `evalsBoard(db,supplied)` · `createSuite(db,supplied,input)` · `addCase(db,supplied,suiteId,input)` · `retireCase(db,supplied,caseId,input)` · `async runSuite(db,supplied,suiteId,input={})`. الوسيط `today` يُحذف من الخادم.

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/jobs` | `jobs.jobsBoard(db,u)` | لا / لا |
| POST | `/api/jobs/:id/(retry\|cancel)` | `jobs.retryJob(db,u,id,input)` · `jobs.cancelJob(db,u,id,input)` | نعم / لا |
| GET | `/api/feature-flags` | `flags.flagsBoard(db,u)` | لا / لا |
| POST | `/api/feature-flags` | `flags.createFlag(db,u,input)` | نعم / نعم |
| POST | `/api/feature-flags/:id` | `flags.updateFlag(db,u,id,input)` | نعم / لا |
| POST | `/api/feature-flags/:id/retire` | `flags.retireFlag(db,u,id,input)` | نعم / لا |
| GET | `/api/ai-governance` | `gov.aiGovernanceBoard(db,u)` | لا / لا |
| POST | `/api/ai-governance/seed` | `gov.seedInventory(db,u)` | نعم / لا |
| POST | `/api/ai-governance/assets/:id/assessments` | `gov.submitAssessment(db,u,id,input)` | نعم / لا |
| POST | `/api/ai-governance/assessments/:id/decide` | `gov.decideAssessment(db,u,id,input)` | نعم / لا |
| POST | `/api/ai-governance/assets/:id/(activate\|suspend)` | `gov.activateAsset(db,u,id,input)` · `gov.suspendAsset(db,u,id,input)` | نعم / لا |
| GET | `/api/ai-evals` | `evals.evalsBoard(db,u)` | لا / لا |
| POST | `/api/ai-evals/suites` | `evals.createSuite(db,u,input)` | نعم / نعم |
| POST | `/api/ai-evals/suites/:id/cases` | `evals.addCase(db,u,id,input)` | نعم / لا |
| POST | `/api/ai-evals/cases/:id/retire` | `evals.retireCase(db,u,id,input)` | نعم / لا |
| POST | `/api/ai-evals/suites/:id/run` | `await evals.runSuite(db,u,id,input)` | **لا تُغلَّف** / لا |

GET:
```js
      if(p==='/api/jobs'&&req.method==='GET') {send(200,jobs.jobsBoard(db,u));return;}
      if(p==='/api/feature-flags'&&req.method==='GET') {send(200,flags.flagsBoard(db,u));return;}
      if(p==='/api/ai-governance'&&req.method==='GET') {send(200,gov.aiGovernanceBoard(db,u));return;}
      if(p==='/api/ai-evals'&&req.method==='GET') {send(200,evals.evalsBoard(db,u));return;}
```
غير متزامن (بعد السطر 234، بجوار `einvoiceCall`):
```js
      const evalRun=p.match(/^\/api\/ai-evals\/suites\/([a-f0-9-]{36})\/run$/);
      if(evalRun&&req.method==='POST') {send(201,await evals.runSuite(db,u,evalRun[1],input));return;}
```
POST:
```js
        const jobStep=p.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(retry|cancel)$/);
        if(jobStep&&req.method==='POST') return jobStep[2]==='retry'?jobs.retryJob(db,u,jobStep[1],input):jobs.cancelJob(db,u,jobStep[1],input);
        if(p==='/api/feature-flags'&&req.method==='POST') return once(()=>flags.createFlag(db,u,input),id=>({id}));
        const flagRetire=p.match(/^\/api\/feature-flags\/([a-f0-9-]{36})\/retire$/);
        if(flagRetire&&req.method==='POST') return flags.retireFlag(db,u,flagRetire[1],input);
        const flagUpdate=p.match(/^\/api\/feature-flags\/([a-f0-9-]{36})$/);
        if(flagUpdate&&req.method==='POST') return flags.updateFlag(db,u,flagUpdate[1],input);
        if(p==='/api/ai-governance/seed'&&req.method==='POST') return gov.seedInventory(db,u);
        const assetAssessment=p.match(/^\/api\/ai-governance\/assets\/([a-f0-9-]{36})\/assessments$/);
        if(assetAssessment&&req.method==='POST') return gov.submitAssessment(db,u,assetAssessment[1],input);
        const assessmentDecide=p.match(/^\/api\/ai-governance\/assessments\/([a-f0-9-]{36})\/decide$/);
        if(assessmentDecide&&req.method==='POST') return gov.decideAssessment(db,u,assessmentDecide[1],input);
        const assetState=p.match(/^\/api\/ai-governance\/assets\/([a-f0-9-]{36})\/(activate|suspend)$/);
        if(assetState&&req.method==='POST') return assetState[2]==='activate'?gov.activateAsset(db,u,assetState[1],input):gov.suspendAsset(db,u,assetState[1],input);
        if(p==='/api/ai-evals/suites'&&req.method==='POST') return once(()=>evals.createSuite(db,u,input),id=>({id}));
        const evalCaseAdd=p.match(/^\/api\/ai-evals\/suites\/([a-f0-9-]{36})\/cases$/);
        if(evalCaseAdd&&req.method==='POST') return evals.addCase(db,u,evalCaseAdd[1],input);
        const evalCaseRetire=p.match(/^\/api\/ai-evals\/cases\/([a-f0-9-]{36})\/retire$/);
        if(evalCaseRetire&&req.method==='POST') return evals.retireCase(db,u,evalCaseRetire[1],input);
```
مؤقّت الطابور (بعد السطر 534، خارج أي معاملة؛ الدقيقة من اقتراح التسليم):
```js
  const drain=()=>{try{const r=jobs.runDue(db,{worker:`server-${process.pid}`});if(r.length)console.log(`Jobs: ${r.length}`);}catch(error){console.error('Jobs failed:',error.message);}};
  drain();setInterval(drain,60*1000).unref();
```
- الاستيراد: `import * as jobs from './jobs.mjs'; import * as flags from './feature-flags.mjs'; import * as gov from './ai-governance.mjs'; import * as evals from './ai-evals.mjs';` (`gov` لا يصطدم بـ`governance` من §2.7).
- الملف: `platform-ops-ui` · المفاتيح: `jobs:jobsUI,'feature-flags':featureFlagsUI,'ai-governance':aiGovernanceUI` ← `import { jobsUI, featureFlagsUI, aiGovernanceUI } from './platform-ops-ui.mjs';` (لا مفتاح مستقل للتقييمات: `aiGovernanceUI` يحمّل `/ai-governance` و`/ai-evals` معًا.)
- التنقل: إدارة المنصة:
  `if(has('platform.flags'))nav.push(['jobs','⚙','طابور المهام','Job queue'],['feature-flags','⚑','أعلام الميزات','Feature flags']);`
  `if(has('ai.govern'))nav.push(['ai-governance','✺','حوكمة المساعدين','AI governance']);` (مالك مساعد مجرود بلا التصريح لا يُعبَّر عنه بتصريح — §9.9.)
- الصندوق (من التسليم): `['ai-governance','حوكمة المساعدين',(db,u)=>({assessments:aiGovernanceBoard(db,u).awaiting_me})],` — `decide_assessment` ← «قرار».
- نقطتا وصل في `app/ai.mjs` (من التسليم، لم تُعدَّل): (1) في `runAssistant` بعد `if(!assistant)…`: `const gate=assetGate(db,u.tenant_id,key);if(flagOn(db,u,'ai.asset_gate')&&!gate.allowed)fail(503,'ai_not_inventoried',gate.reason);` (2) في `provider()` لفّ المزوّدين بـ`withRedaction(...)` من `app/pii.mjs`.
- الترتيب: `flagRetire` قبل `flagUpdate`. `/api/ai-evals` و`/api/ai-governance` لا يلتقطهما `assistantRun` (`^\/api\/ai\/run\/`).

### 9.5 request-quality — جودة حقول الخدمة

⚠ **هذا التسليم عدّل ملفين مشتركين** بإذن استثنائي: `app/validation.mjs` (`fieldVisible` و`visibleFields` وفرض `show_when`/`min_length`/`max_length`/`pattern` في `validatePayload`) و`app/service-catalog.mjs` (إرشاد الحقول لـ139 خدمة، `enrichFields`، `FIELD_GUIDANCE_KEYS`). يراجعهما المنسّق قبل الدمج.

الصادرات المتحقَّق منها: `catalog-quality.mjs`: `catalogQualityBoard(db,supplied)` · `reportFieldGap(db,supplied,requestId,input)` (تعيد اللوحة، **بلا `id`**).

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/catalog-quality` | `catalogQuality.catalogQualityBoard(db,u)` | لا / لا |
| POST | `/api/catalog-quality/requests/:id/field-gap` | `catalogQuality.reportFieldGap(db,u,id,input)` | نعم / نعم ⚠ |

```js
      if(p==='/api/catalog-quality'&&req.method==='GET') {send(200,catalogQuality.catalogQualityBoard(db,u));return;}
```
```js
        const fieldGap=p.match(/^\/api\/catalog-quality\/requests\/([a-f0-9-]+)\/field-gap$/);
        if(fieldGap&&req.method==='POST') return once(()=>({...catalogQuality.reportFieldGap(db,u,fieldGap[1],input),id:fieldGap[1]}),()=>catalogQuality.catalogQualityBoard(db,u));
```
- الاستيراد: `import * as catalogQuality from './catalog-quality.mjs';` · الملف: `catalog-quality-ui` · المفتاح: `'catalog-quality':catalogQualityUI` ← `import { catalogQualityUI } from './catalog-quality-ui.mjs';`
- التنقل: التسليم قال «إدارة المنصة (بجوار بطاقات الخدمات)» و`service-cards` في «الطلبات والخدمات» — وُضع في **الطلبات والخدمات**. كل من يعيد طلبًا يسجّل سببه، والتقرير الكامل لـ`catalog.manage`: `if(has('requests.use'))nav.push(['catalog-quality','✎','جودة حقول الخدمات','Service field quality']);`
- الصندوق: لا سطر (التسليم: اختياري منخفض الأولوية؛ `report_field_gap` يسقط اليوم).
- ما يحتاجه خارج `server.mjs` (من التسليم): (1) `enrichFields(s.code,s.fields)` على حقول كل خدمة في مسار `GET /api/catalog` (السطر 132) أو في `wf.catalog`؛ (2) عرض `hint`/`example`/`why` وقيود الطول والنمط في `fieldInput` بـ`app.mjs` (السطر 175)، وحاوية `data-show-field` للحقول المشروطة، والإظهار في مستمع `change` (السطر 189) بالكتلة التي في التسليم؛ (3) قبول `FIELD_GUIDANCE_KEYS` في `createService` بـ`workflow.mjs` ثم إعادة `required:f.required` في `coreField` — **وسيكسر ذلك `tests/service-catalog.test.mjs`** («every service accepts a complete request») لحقول الصيغة المسماة في التسليم.

### 9.6 hr-cases-comp — حالات الموارد البشرية والتعويضات والقوى العاملة

الصادرات المتحقَّق منها: `hr-cases.mjs`: `setCaseTarget` `getCase(db,supplied,caseId)` `hrCasesBoard` `fileCase` `caseAction(db,supplied,caseId,action,input)` `submitAnonymousReport` `followAnonymousReport` `replyAnonymousReport` `reportAction(db,supplied,reportId,action,input)`؛ `compensation.mjs`: `prepareBand` `decideBand(db,supplied,bandId,decision,input)` `createCompCycle` `compCycleAction(db,supplied,cycleId,action,input)` `proposeIncrease` `proposalAction(db,supplied,proposalId,action,input)` `recommendationAction(db,supplied,recId,action,input)` `setGapPrivacy` `compensationBoard`؛ `workforce.mjs`: `workforceBoard(db,supplied,query={})` `simulateSaudization(db,supplied,input)` `recordDemographics(db,supplied,userId,input)`.

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/hr-cases` | `hrCases.hrCasesBoard(db,u)` | لا / لا |
| GET | `/api/hr-cases/:id` | `hrCases.getCase(db,u,id)` | لا / لا |
| POST | `/api/hr-cases` | `hrCases.fileCase(db,u,input)` | نعم / نعم |
| POST | `/api/hr-cases/targets` | `hrCases.setCaseTarget(db,u,input)` | نعم / نعم |
| POST | `/api/hr-cases/:id/(take_case\|add_info\|withdraw_case\|note_case\|reply_case\|decide_case\|reassign_case\|close_case)` | `hrCases.caseAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/hr-cases/anonymous` | `hrCases.submitAnonymousReport(db,u,input)` | نعم / **ممنوع** |
| POST | `/api/hr-cases/anonymous/follow` | `hrCases.followAnonymousReport(db,u,input)` — قراءة | نعم (لا ضرر) / **ممنوع** |
| POST | `/api/hr-cases/anonymous/reply` | `hrCases.replyAnonymousReport(db,u,input)` | نعم / **ممنوع** |
| POST | `/api/hr-cases/anonymous/:id/(take_report\|reply_report\|handover_report\|close_report)` | `hrCases.reportAction(db,u,id,action,input)` | نعم / لا |
| GET | `/api/compensation` | `compensation.compensationBoard(db,u)` | لا / لا |
| POST | `/api/compensation/bands` · `cycles` · `proposals` · `privacy` | `compensation.prepareBand` · `createCompCycle` · `proposeIncrease` · `setGapPrivacy` — كلها `(db,u,input)` | نعم / نعم |
| POST | `/api/compensation/bands/:id/(approve\|reject)` | `compensation.decideBand(db,u,id,decision,input)` | نعم / لا |
| POST | `/api/compensation/cycles/:id/(open\|close)` | `compensation.compCycleAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/compensation/proposals/:id/(assess\|approve\|reject\|withdraw)` | `compensation.proposalAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/compensation/recommendations/:id/(link\|drop)` | `compensation.recommendationAction(db,u,id,action,input)` | نعم / لا |
| GET | `/api/workforce?from=&to=` | `workforce.workforceBoard(db,u,{from,to})` | لا / لا |
| POST | `/api/workforce/simulate` | `workforce.simulateSaudization(db,u,input)` — قراءة | نعم (لا ضرر) / لا |
| POST | `/api/workforce/demographics/:userId` | `workforce.recordDemographics(db,u,userId,input)` | نعم / لا |

GET:
```js
      if(p==='/api/hr-cases'&&req.method==='GET') {send(200,hrCases.hrCasesBoard(db,u));return;}
      const hrCaseRead=p.match(/^\/api\/hr-cases\/([a-f0-9-]{36})$/);
      if(hrCaseRead&&req.method==='GET') {send(200,hrCases.getCase(db,u,hrCaseRead[1]));return;}
      if(p==='/api/compensation'&&req.method==='GET') {send(200,compensation.compensationBoard(db,u));return;}
      if(p==='/api/workforce'&&req.method==='GET') {send(200,workforce.workforceBoard(db,u,Object.fromEntries(['from','to'].filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))));return;}
```
POST — مسارات البلاغ المجهول **أولًا، وبلا `once`** (جدول `idempotency_keys` يحفظ `user_id` بجوار معرّف السجل فيربط المُبلِّغ ببلاغه):
```js
        if(p==='/api/hr-cases/anonymous'&&req.method==='POST') return hrCases.submitAnonymousReport(db,u,input);
        if(p==='/api/hr-cases/anonymous/follow'&&req.method==='POST') return hrCases.followAnonymousReport(db,u,input);
        if(p==='/api/hr-cases/anonymous/reply'&&req.method==='POST') return hrCases.replyAnonymousReport(db,u,input);
        const anonymousReportStep=p.match(/^\/api\/hr-cases\/anonymous\/([a-f0-9-]{36})\/(take_report|reply_report|handover_report|close_report)$/);
        if(anonymousReportStep&&req.method==='POST') return hrCases.reportAction(db,u,anonymousReportStep[1],anonymousReportStep[2],input);
        if(p==='/api/hr-cases/targets'&&req.method==='POST') return once(()=>hrCases.setCaseTarget(db,u,input),id=>({id}));
        if(p==='/api/hr-cases'&&req.method==='POST') return once(()=>hrCases.fileCase(db,u,input),id=>({id}));
        const hrCaseStep=p.match(/^\/api\/hr-cases\/([a-f0-9-]{36})\/(take_case|add_info|withdraw_case|note_case|reply_case|decide_case|reassign_case|close_case)$/);
        if(hrCaseStep&&req.method==='POST') return hrCases.caseAction(db,u,hrCaseStep[1],hrCaseStep[2],input);
        if(p==='/api/compensation/bands'&&req.method==='POST') return once(()=>compensation.prepareBand(db,u,input),id=>({id}));
        const compBandStep=p.match(/^\/api\/compensation\/bands\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(compBandStep&&req.method==='POST') return compensation.decideBand(db,u,compBandStep[1],compBandStep[2],input);
        if(p==='/api/compensation/cycles'&&req.method==='POST') return once(()=>compensation.createCompCycle(db,u,input),id=>({id}));
        const compCycleStep=p.match(/^\/api\/compensation\/cycles\/([a-f0-9-]{36})\/(open|close)$/);
        if(compCycleStep&&req.method==='POST') return compensation.compCycleAction(db,u,compCycleStep[1],compCycleStep[2],input);
        if(p==='/api/compensation/proposals'&&req.method==='POST') return once(()=>compensation.proposeIncrease(db,u,input),id=>({id}));
        const compProposalStep=p.match(/^\/api\/compensation\/proposals\/([a-f0-9-]{36})\/(assess|approve|reject|withdraw)$/);
        if(compProposalStep&&req.method==='POST') return compensation.proposalAction(db,u,compProposalStep[1],compProposalStep[2],input);
        const compRecommendationStep=p.match(/^\/api\/compensation\/recommendations\/([a-f0-9-]{36})\/(link|drop)$/);
        if(compRecommendationStep&&req.method==='POST') return compensation.recommendationAction(db,u,compRecommendationStep[1],compRecommendationStep[2],input);
        if(p==='/api/compensation/privacy'&&req.method==='POST') return once(()=>compensation.setGapPrivacy(db,u,input),id=>({id}));
        if(p==='/api/workforce/simulate'&&req.method==='POST') return workforce.simulateSaudization(db,u,input);
        const demographicsSave=p.match(/^\/api\/workforce\/demographics\/([a-z0-9._-]+)$/);
        if(demographicsSave&&req.method==='POST') return workforce.recordDemographics(db,u,demographicsSave[1],input);
```
- الاستيراد: `import * as hrCases from './hr-cases.mjs'; import * as compensation from './compensation.mjs'; import * as workforce from './workforce.mjs';`
- الملف: `hr-cases-comp-ui` · المفاتيح: `'hr-cases':hrCasesUI,compensation:compensationUI,workforce:workforceUI` ← `import { hrCasesUI, compensationUI, workforceUI } from './hr-cases-comp-ui.mjs';`
- التنقل: «خدمات الموظف» غير موجودة ⇒ `hr-cases` ← مساحتي (لكل موظف)، `compensation` و`workforce` ← الموارد البشرية:
  `if(me.role!=='admin')nav.push(['hr-cases','⚐','حالات الموارد البشرية','HR cases'],['compensation','◈','مراجعة التعويضات','Compensation review']);`
  `if(has('hr.workforce.view'))nav.push(['workforce','♙','تركيبة القوى العاملة','Workforce composition']);`
- الصندوق: **`hr-cases` لا يُربط الآن** — اللوحة بلا `awaiting_me`، والتسليم يشترط ألا يظهر وصف ولا اسم صاحب الحالة، و`describe` في `inbox.mjs` يلتقط `title`/`name` تلقائيًا (§9.9). `compensation` مشتق: `['compensation','مراجعة التعويضات',compensationBoard],` + `DECISIONS`: `assess_proposal:'تقييم مقترح زيادة',open_cycle:'فتح دورة التعويضات',link_contract:'ربط نسخة العقد'` (`approve_band` و`approve_proposal` تعمل؛ `drop_*` و`withdraw_*` تسقط).
- الترتيب: ⚠ **`anonymous*` و`targets` قبل `hrCaseStep`** (نص التسليم). ⚠ لا يُسجَّل جسم طلب البلاغ ولا الرمز في أي سجل خادم؛ `console.error` الحالي (السطر 519) يطبع `error.name` فقط — لا تغيّره.

### 9.7 media-spend — الصرف الإعلامي وتقارير العملاء

الصادرات المتحقَّق منها: `media-spend.mjs`: `mediaSpendBoard` `prepareMediaPlan` `mediaPlanAction(db,supplied,planId,action,input)` `recordMediaSpend(db,supplied,campaignId,input)` `correctMediaSpend(db,supplied,entryId,input)` `saveMediaProfile` `deactivateMediaProfile(db,supplied,profileId,input)` `importMediaSpend(db,supplied,campaignId,input)` `cancelMediaImport(db,supplied,importId,input)` `setThreshold(db,supplied,campaignId,input)` `retireThreshold(db,supplied,thresholdId,input)` `acknowledgeSpend(db,supplied,campaignId,input)` `linkCommitment(db,supplied,entryId,input)` `recordBilling(db,supplied,campaignId,input)`؛ `client-reports.mjs`: `createTemplate` `templateAction(db,supplied,templateId,action,input)` `generateReport` `reportAction(db,supplied,reportId,action,input)` `readClientReport(db,supplied,reportId)` `clientReportsBoard` `clientReportPrintable(report)`.

| الطريقة | المسار | الاستدعاء | معاملة / once |
|---|---|---|---|
| GET | `/api/media-spend` | `mediaSpend.mediaSpendBoard(db,u)` | لا / لا |
| POST | `/api/media-spend/plans` | `mediaSpend.prepareMediaPlan(db,u,input)` | نعم / نعم |
| POST | `/api/media-spend/plans/:id/(edit_plan\|approve_plan\|discard_plan)` | `mediaSpend.mediaPlanAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/media-spend/campaigns/:id/(spend\|imports\|thresholds\|billings)` | `recordMediaSpend` · `importMediaSpend` · `setThreshold` · `recordBilling` — كلها `(db,u,id,input)` | نعم / نعم |
| POST | `/api/media-spend/campaigns/:id/acknowledge` | `mediaSpend.acknowledgeSpend(db,u,id,input)` | نعم / لا |
| POST | `/api/media-spend/entries/:id/(correct\|commitment)` | `mediaSpend.correctMediaSpend(db,u,id,input)` · `mediaSpend.linkCommitment(db,u,id,input)` | نعم / لا |
| POST | `/api/media-spend/imports/:id/cancel` | `mediaSpend.cancelMediaImport(db,u,id,input)` | نعم / لا |
| POST | `/api/media-spend/thresholds/:id/retire` | `mediaSpend.retireThreshold(db,u,id,input)` | نعم / لا |
| POST | `/api/media-spend/profiles` | `mediaSpend.saveMediaProfile(db,u,input)` | نعم / نعم |
| POST | `/api/media-spend/profiles/:id/deactivate` | `mediaSpend.deactivateMediaProfile(db,u,id,input)` | نعم / لا |
| GET | `/api/client-reports` | `clientReports.clientReportsBoard(db,u)` | لا / لا |
| GET | `/api/client-reports/:id/print` | `clientReports.clientReportPrintable(clientReports.readClientReport(db,u,id))` + `audit` | لا / لا |
| POST | `/api/client-reports/templates` | `clientReports.createTemplate(db,u,input)` | نعم / نعم |
| POST | `/api/client-reports/templates/:id/(edit_template\|deactivate_template)` | `clientReports.templateAction(db,u,id,action,input)` | نعم / لا |
| POST | `/api/client-reports` | `clientReports.generateReport(db,u,input)` | نعم / نعم |
| POST | `/api/client-reports/:id/(write_commentary\|sign_report\|discard_report)` | `clientReports.reportAction(db,u,id,action,input)` | نعم / لا |

GET:
```js
      if(p==='/api/media-spend'&&req.method==='GET') {send(200,mediaSpend.mediaSpendBoard(db,u));return;}
      if(p==='/api/client-reports'&&req.method==='GET') {send(200,clientReports.clientReportsBoard(db,u));return;}
      const clientReportPrint=p.match(/^\/api\/client-reports\/([a-f0-9-]{36})\/print$/);
      if(clientReportPrint&&req.method==='GET') {
        const html=clientReports.clientReportPrintable(clientReports.readClientReport(db,u,clientReportPrint[1]));
        audit(db,u,'client_report',clientReportPrint[1],'client_report.printed',{}, {});
        res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
      }
```
POST:
```js
        if(p==='/api/media-spend/plans'&&req.method==='POST') return once(()=>mediaSpend.prepareMediaPlan(db,u,input),id=>({id}));
        const mediaPlanStep=p.match(/^\/api\/media-spend\/plans\/([a-f0-9-]{36})\/(edit_plan|approve_plan|discard_plan)$/);
        if(mediaPlanStep&&req.method==='POST') return mediaSpend.mediaPlanAction(db,u,mediaPlanStep[1],mediaPlanStep[2],input);
        const mediaCampaignStep=p.match(/^\/api\/media-spend\/campaigns\/([a-f0-9-]{36})\/(spend|imports|thresholds|billings|acknowledge)$/);
        if(mediaCampaignStep&&req.method==='POST'){
          const [,mediaCampaignId,mediaCampaignAction]=mediaCampaignStep;
          if(mediaCampaignAction==='acknowledge')return mediaSpend.acknowledgeSpend(db,u,mediaCampaignId,input);
          const mediaWrite={spend:mediaSpend.recordMediaSpend,imports:mediaSpend.importMediaSpend,thresholds:mediaSpend.setThreshold,billings:mediaSpend.recordBilling}[mediaCampaignAction];
          return once(()=>mediaWrite(db,u,mediaCampaignId,input),id=>({id}));
        }
        const mediaEntryStep=p.match(/^\/api\/media-spend\/entries\/([a-f0-9-]{36})\/(correct|commitment)$/);
        if(mediaEntryStep&&req.method==='POST') return mediaEntryStep[2]==='correct'?mediaSpend.correctMediaSpend(db,u,mediaEntryStep[1],input):mediaSpend.linkCommitment(db,u,mediaEntryStep[1],input);
        const mediaImportCancel=p.match(/^\/api\/media-spend\/imports\/([a-f0-9-]{36})\/cancel$/);
        if(mediaImportCancel&&req.method==='POST') return mediaSpend.cancelMediaImport(db,u,mediaImportCancel[1],input);
        const mediaThresholdRetire=p.match(/^\/api\/media-spend\/thresholds\/([a-f0-9-]{36})\/retire$/);
        if(mediaThresholdRetire&&req.method==='POST') return mediaSpend.retireThreshold(db,u,mediaThresholdRetire[1],input);
        if(p==='/api/media-spend/profiles'&&req.method==='POST') return once(()=>mediaSpend.saveMediaProfile(db,u,input),id=>({id}));
        const mediaProfileDeactivate=p.match(/^\/api\/media-spend\/profiles\/([a-f0-9-]{36})\/deactivate$/);
        if(mediaProfileDeactivate&&req.method==='POST') return mediaSpend.deactivateMediaProfile(db,u,mediaProfileDeactivate[1],input);
        if(p==='/api/client-reports/templates'&&req.method==='POST') return once(()=>clientReports.createTemplate(db,u,input),id=>({id}));
        const clientTemplateStep=p.match(/^\/api\/client-reports\/templates\/([a-f0-9-]{36})\/(edit_template|deactivate_template)$/);
        if(clientTemplateStep&&req.method==='POST') return clientReports.templateAction(db,u,clientTemplateStep[1],clientTemplateStep[2],input);
        if(p==='/api/client-reports'&&req.method==='POST') return once(()=>clientReports.generateReport(db,u,input),id=>({id}));
        const clientReportStep=p.match(/^\/api\/client-reports\/([a-f0-9-]{36})\/(write_commentary|sign_report|discard_report)$/);
        if(clientReportStep&&req.method==='POST') return clientReports.reportAction(db,u,clientReportStep[1],clientReportStep[2],input);
```
(`mediaWrite` يُستدعى بالتوقيع الموحّد `(db,u,campaignId,input)` — تحقّقت أن الأربع تشترك فيه.)
- الاستيراد: `import * as mediaSpend from './media-spend.mjs'; import * as clientReports from './client-reports.mjs';`
- الملف: `media-spend-ui` · المفاتيح: `'media-spend':mediaSpendUI,'client-reports':clientReportsUI` ← `import { mediaSpendUI, clientReportsUI } from './media-spend-ui.mjs';`
- التنقل: التشغيل — من التسليم حرفيًا: `if(has('commercial.use'))nav.push(['media-spend','◔','الصرف الإعلامي','Media spend'],['client-reports','▤','تقارير العملاء','Client reports']);`
- الصندوق (من التسليم): `['media-spend','الصرف الإعلامي',mediaSpendBoard],['client-reports','تقارير العملاء',clientReportsBoard],` + `DECISIONS`: `sign_report:'توقيع تقرير عميل'`. لا حاجة لتغليف 403 (§6.4).
- الترتيب: `client-reports/templates` قبل `clientReportStep`. ⚠ الاستيراد بالمساحة إلزامي: `setThreshold` (مع billing-recurring) و`createTemplate`/`templateAction` (مع close-checklist) و`reportAction` (مع hr-cases).

### 9.8 إضافات الملحق إلى قوائم §1 (تُضم إليها، لا تحل محلها)

**استيرادات `server.mjs`** (بعد كتلة §1.1):
```js
import * as requestTimeline from './request-timeline.mjs';
import * as requestClosure from './request-closure.mjs';
import * as serviceExperience from './service-experience.mjs';
import * as processInsight from './process-insight.mjs';
import * as knowledge from './knowledge.mjs';
import * as policyAck from './policy-acknowledgements.mjs';
import * as accessReviews from './access-reviews.mjs';
import * as pipeline from './pipeline-estimates.mjs';
import * as estimates from './estimates.mjs';
import * as jobs from './jobs.mjs';
import * as flags from './feature-flags.mjs';
import * as gov from './ai-governance.mjs';
import * as evals from './ai-evals.mjs';
import * as catalogQuality from './catalog-quality.mjs';
import * as hrCases from './hr-cases.mjs';
import * as compensation from './compensation.mjs';
import * as workforce from './workforce.mjs';
import * as mediaSpend from './media-spend.mjs';
import * as clientReports from './client-reports.mjs';
```

**القائمة البيضاء** (7): `'request-transparency-ui','knowledge-access-ui','pipeline-estimates-ui','platform-ops-ui','catalog-quality-ui','hr-cases-comp-ui','media-spend-ui'` — الملفات موجودة؛ استيرادها الداخلي الوحيد `./dates.mjs` (knowledge-access).

**`operations.mjs`**:
```js
import { myRequestTimelineUI, serviceInsightUI } from './request-transparency-ui.mjs';
import { knowledgeUI, policyAcknowledgementsUI, accessReviewsUI } from './knowledge-access-ui.mjs';
import { pipelineUI, estimatesUI } from './pipeline-estimates-ui.mjs';
import { jobsUI, featureFlagsUI, aiGovernanceUI } from './platform-ops-ui.mjs';
import { catalogQualityUI } from './catalog-quality-ui.mjs';
import { hrCasesUI, compensationUI, workforceUI } from './hr-cases-comp-ui.mjs';
import { mediaSpendUI, clientReportsUI } from './media-spend-ui.mjs';
```
```js
'my-request-timeline':myRequestTimelineUI,'service-insight':serviceInsightUI,knowledge:knowledgeUI,'policy-acknowledgements':policyAcknowledgementsUI,'access-reviews':accessReviewsUI,pipeline:pipelineUI,estimates:estimatesUI,jobs:jobsUI,'feature-flags':featureFlagsUI,'ai-governance':aiGovernanceUI,'catalog-quality':catalogQualityUI,'hr-cases':hrCasesUI,compensation:compensationUI,workforce:workforceUI,'media-spend':mediaSpendUI,'client-reports':clientReportsUI
```
(16 مفتاحًا؛ لا تكرار مع القائم ولا مع §1.4 — تحقّقت. المجموع الجديد 65 مفتاحًا.)

**`groupedNavigation` — السطر 5 كاملًا (يحل محل نسخة §1.5):**
```js
 const groups=[['مساحتي',['inbox','search','portal','work','home','expiry','announcements','policy-acknowledgements','knowledge','one-to-ones','feedback','letters','hr-cases','attendance','leave','contracts','payroll','expenses','notifications','assistants','security']],['الطلبات والخدمات',['departments','catalog','requests','my-request-timeline','service-cards','intake-settings','catalog-quality']],['الموارد البشرية',['employees','performance','review-360','growth','pulse','recognition','people','lifecycle','clearance','leave-accrual','benefits','letter-templates','compensation','workforce','payroll-extras','wps','wage-reconciliation','payroll-anomaly']],['التشغيل',['clients','campaigns','content','scope','media-spend','client-reports','influencers','influencer-campaigns','pr','media-contacts','productions','call-sheets','equipment','offerings','project-templates','time','timesheets','resourcing','projects','commercial','pipeline','estimates','approvals','studio','review-rounds','annotations','procurement','procurement-extras','vendors','contracts-register','delegations']],['المالية',['budgets','finance','receivables','invoices','einvoice','einvoice-selfcheck','billing-schedules','retainers','payables','bank-reconciliation','cash-forecast','close-checklist','accruals','cost-rates','profitability','vat-worksheet','withholding','assets','statements']],['القيادة',['reports','executive','org','centres','service-insight','objectives','risks','decisions','compliance','privacy','subject-requests','requirements','service-benchmark','integrations']],['إدارة المنصة',['accounts','access-reviews','jobs','feature-flags','ai-governance']]];
```

**`allowed()`** — أضف إلى مصفوفة `false` أيضًا: `'my-request-timeline','service-insight','knowledge','policy-acknowledgements','access-reviews','pipeline','estimates','jobs','feature-flags','ai-governance','catalog-quality','hr-cases','compensation','workforce','media-spend','client-reports'`.

**`inbox.mjs`** — استيرادات:
```js
import { myTimelineBoard } from './request-timeline.mjs';
import { knowledgeBoard } from './knowledge.mjs';
import { acknowledgementsBoard } from './policy-acknowledgements.mjs';
import { accessReviewBoard } from './access-reviews.mjs';
import { pipelineBoard } from './pipeline-estimates.mjs';
import { estimatesBoard } from './estimates.mjs';
import { aiGovernanceBoard } from './ai-governance.mjs';
import { compensationBoard } from './compensation.mjs';
import { mediaSpendBoard } from './media-spend.mjs';
import { clientReportsBoard } from './client-reports.mjs';
```
`DECISIONS` (تسقط اليوم، تحقّقت بالمحاكاة): `answer:'سؤال التجربة',reopen:'إعادة الفتح متاحة',close_with_evidence:'إغلاق بدليل',sign_report:'توقيع تقرير عميل',assess_proposal:'تقييم مقترح زيادة',open_cycle:'فتح دورة التعويضات',link_contract:'ربط نسخة العقد'`
`KINDS`: `timeline_rows:'طلبي',closable:'طلب جاهز للإغلاق',knowledge_items:'مصدر معرفة',policy_acks:'إقرار سياسة',access_items:'مراجعة صلاحية',stage_revisions:'مرحلة بيع',estimate_items:'تقدير أو بطاقة أسعار',assessments:'تقييم مخاطر مساعد'`
`SOURCES` (تُلحق بكتلة §6.5):
```js
  ['my-request-timeline','طلباتي',(db,u)=>{const board=myTimelineBoard(db,u);return {timeline_rows:board.rows.filter(r=>r.actions.some(a=>['answer','reopen'].includes(a))),closable:board.closable};}],
  ['knowledge','قاعدة المعرفة',(db,u)=>({knowledge_items:knowledgeBoard(db,u).awaiting_me})],
  ['policy-acknowledgements','إقرار السياسات',(db,u)=>({policy_acks:acknowledgementsBoard(db,u).awaiting_me})],
  ['access-reviews','مراجعة الصلاحيات',(db,u)=>({access_items:accessReviewBoard(db,u).awaiting_me})],
  ['pipeline','الفرص البيعية',(db,u)=>({stage_revisions:pipelineBoard(db,u).awaiting_me})],
  ['estimates','التقديرات',(db,u)=>({estimate_items:estimatesBoard(db,u).awaiting_me})],
  ['ai-governance','حوكمة المساعدين',(db,u)=>({assessments:aiGovernanceBoard(db,u).awaiting_me})],
  ['compensation','مراجعة التعويضات',compensationBoard],
  ['media-spend','الصرف الإعلامي',mediaSpendBoard],['client-reports','تقارير العملاء',clientReportsBoard],
```

**المؤقّتات** (بعد السطر 534): `billingRuns` (§2.2) و`drain` (§9.4) بجوار `schedules` القائم.

### 9.9 تعارضات واعتماديات وقرارات ونواقص الملحق

**تعارضات**
1. **سؤال التجربة يكتب في جدول التقييم القائم** `request_feedback` (مفتاحه `request_id`) الذي يكتب فيه `/api/requests/:id/feedback` من `service-feedback.mjs` بمقياس 1–5. واجهتان على جدول واحد، وإجابة واحدة للطلب لا للجولة.
2. **إغلاق الطلب مساران**: `transition(...,'complete')` العام و`closeWithEvidence`. الطلب المغلق بالعام لا يُعاد فتحه (`no_closure_record`).
3. **سجلّان لحقيقة واحدة — خروج بيانات المساعدين من المملكة**: `data_transfers` بـ`slug='ai_model_provider'` (privacy) و`ai_asset_assessments.data_leaves_kingdom` (platform-ops). بلا ربط بينهما.
4. **ملفان مشتركان عُدّلا** (`validation.mjs` و`service-catalog.mjs`) من request-quality؛ كل التسليمات الأخرى امتنعت.
5. **أسماء دوال مكررة إضافية** (تُضم إلى §5.2): `setThreshold` (billing-recurring · media-spend) · `createTemplate` و`templateAction` (close-checklist · client-reports) · `reportAction` (hr-cases · client-reports).
6. **مؤقّتان منفصلان** للجدولة (`report-schedules` و`jobs`)؛ التسليم لم ينقل الأول إلى الطابور.
7. **مجموعات تنقل غير موجودة مرة أخرى**: «الأساس» (request-transparency، knowledge-access) و«خدمات الموظف» (hr-cases-comp)؛ وcatalog-quality ذكر «إدارة المنصة بجوار بطاقات الخدمات» والبطاقات في «الطلبات والخدمات». حُوّلت في §9.8.
8. **§5.5 و§8.17 أعلاه** قالا إن `076-request-transparency.sql` بلا تسليم — **تجاوزهما هذا الملحق** (§9.1).

**اعتماديات**
| من | إلى | أين | الحالة |
|---|---|---|---|
| estimates | profitability | محلِّل `costRate` في `server.mjs` يقرأ `category_cost_rates`/`job_categories` (053) — §9.3 | يوصل مع §9.3 |
| estimates | commercial | `/to-quote` يستدعي `commercial.commercialAction(...,'save_quote'\|'create_change',…)` | يوصل مع §9.3 |
| estimates | campaigns (scope) | `scope_candidates` من `scope_events`؛ زر في `scopeUI` نحو `#estimates` اختياري | غير موصول |
| media-spend | bank-reconciliation · procurement · finance · agency · campaigns | يستورد `parseCsv` و`purchaseFor` و`financeCapabilities` و`clientFor`/`memberClients` و`CHANNELS` | موصول |
| media-spend | receivables | `media_spend_billings` يشير إلى `ar_claims` معتمد | موصول بالمخطط، غير مختبر متكاملًا |
| compensation | hr-contracts | الاعتماد يُنشئ توصية؛ النسخة تُعد في `POST /api/hr/contracts/:id/amend` ثم تُربط بـ`/recommendations/:id/link` | يدوي |
| compensation | profitability (053) | النطاقات على `job_categories` و`employee_job_categories` | موصول |
| knowledge | ai | `knowledgeWarnings` في `runAssistant` — §9.2 | غير موصول |
| policy-acknowledgements | hr-contracts | فتح جولة الإقرار عند اعتماد سياسة | غير موصول (قرار) |
| access-reviews | access | تنفيذ السحب يستدعي `revokeAccess` | موصول |
| platform-ops | ai | `assetGate` خلف العلم `ai.asset_gate`، و`withRedaction` في `provider()` — §9.4 | غير موصول |
| request-quality | workflow · app.mjs · catalog | §9.5 (ثلاثة مواضع) | غير موصول |
| request-transparency | routing · service-feedback · request-intake | يقرأ `serviceClock`/`feedbackView`؛ الالتزام بالمدة على `service_directory.target_days` لا على أولوية الاستقبال | موصول بالقراءة |

**قرارات المالك (تكملة §7)**
41. هل يرى مدير كل إدارة أرقام إدارته في «قياس الخدمات» (منح مقيّد بالإدارة أو مفتاح جديد)؛ إجابة التجربة لكل طلب أم لكل جولة، وواجهة تقييم واحدة أم اثنتان؛ توجيه «إكمال» العام إلى الإغلاق بدليل. — request-transparency
42. مراجعة خريطة `USAGE_TRACES`؛ تسجيل الاطلاع في التدقيق؛ مراجعة تصاريح الأدوار نفسها؛ فتح جولة الإقرار آليًا عند اعتماد سياسة. — knowledge-access
43. مالك إجراء المراحل وبطاقات الأسعار (مفتاح جديد)؛ خط اعتماد التقدير؛ إدخال التحميل العام في تكلفة السطر؛ إظهار معدلات الفئات لمندوبي البيع. — pipeline-estimates
44. نقل `report-schedules` إلى الطابور؛ تفعيل `ai.asset_gate`؛ حفظ ناتج المساعد قبل استعادة القيم المحجوبة أم بعدها؛ حساب تقييم مخصص؛ منح `ai.govern` لأدمن ثانٍ؛ إيقاف المساعد المتأخرة مراجعته؛ مقر معالجة بيانات المزوّد. — platform-ops
45. تفعيل فرض `show_when`/`pattern` في `createService` (يكسر اختبارًا قائمًا)؛ اعتماد مالكي الإجراءات للإرشاد؛ الملاحظات العشر على مسارات الاعتماد (تعديل الأجر بلا مدير، تغيير الحساب البنكي بخطوة واحدة، `vendors.bank` خارج مسار `PRC-VENDOR-BANK`، شكاوى ضد الإدارة المستقبِلة، اعتماد يؤخر البلاغات العاجلة، الإبداعي بلا رئيس، حقوق الأصل، خطوة خصوصية، التزامات بأجر بلا مالية، ثقل تصريح الزائر). — request-quality
46. المستوى الأعلى لاعتماد المقترح خارج النطاق؛ تصريح كتابة لتسجيل الجنسية؛ إشعارات الحالات دون كشف الأطراف. — hr-cases-comp
47. منع تداخل الاستيراد مع الإدخال اليدوي؛ إلزام صرف `agency_on_behalf` بأمر شراء؛ قيد «المولِّد لا يوقّع» للحسابات الفردية؛ مسودة تعليق من نموذج لغوي. — media-spend

**نواقص الملحق**
1. **request-transparency:** خمس دوال كتابة معلَّمة بـ`Idempotency-Key` في التسليم لا تعيد `id` — لُفّت (§9.1). لم يعطِ سطر تنقل ولا `SOURCES`.
2. **knowledge-access:** أسطر `SOURCES` المقترحة تستعمل المفتاح `items` (= «محتوى» في `KINDS`) — بُدّل.
3. **pipeline-estimates:** بايت NUL في `app/estimates.mjs`؛ موضع تعريف `costRate` لم يُحدد — حُدد بعد السطر 129.
4. **platform-ops:** لا مفتاح مستقل لشاشة التقييمات (مدمجة في `ai-governance`)؛ «مالك مساعد مجرود» يرى الشاشة بحسب التسليم ولا يُعبَّر عنه بشرط `has()` — يحتاج علمًا من `/api/me` أو شرطًا أعم.
5. **request-quality:** `reportFieldGap` بلا `id` — لُفّ. تفعيل الإرشاد في نموذج الطلب يحتاج تعديلات في `app.mjs` و`workflow.mjs` ومسار الكتالوج لم تُنفَّذ.
6. **hr-cases-comp:** اللوحتان بلا `awaiting_me`؛ التسليم وصف شروط الصندوق نصًا. `hr-cases` تُرك خارج الصندوق حتى تُبنى مصفوفة لا تحمل وصفًا ولا اسمًا؛ سطر `compensation` مشتق ولم أتحقق أن أفعال اللوحة تستثني المقترِح وصاحب الزيادة كما يقول النص.
7. **media-spend:** لا نقص جوهري؛ تسجيل الطباعة في التدقيق أُضيف كما أوصى التسليم.
