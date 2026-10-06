# NAV-PLAN — خطة تنقل الشاشات الجديدة (للتطبيق بعد وكيل التصميم)

**هذه خطة لا تنفيذ.** لم أعدّل `app/static/hr-design.mjs` ولا `nav.push` في `app/static/app.mjs`. يطبقها المنسّق بعد استقرار ملفات التصميم.

**المصادر:** شجرة التنقل المقترحة في `docs/product/audits/UX-COPY-AUDIT.md` §2.3، و§1.5/§1.6/§9.8 من `docs/implementation/WIRING-SPEC.md`، وما سُجّل فعلًا في `app/static/operations.mjs` (104 مفاتيح، منها 65 جديدًا).

## 0. قرار الشجرة

مصدران متعارضان شكلًا: المواصفة تبقي المجموعات السبع القائمة، والتدقيق يقترح ثمانيًا بعناوين فرعية. **الجدول أدناه مكتوب على شجرة التدقيق** (المجموعة + العنوان الفرعي + الترتيب)، لأنها الأحدث ولأن «التشغيل» يتجاوز 33 مدخلًا بلا تقسيم. من يطبق الشجرة القديمة يقرأ العمود «المجموعة» فقط ويسقط عمود «العنوان الفرعي»: المجموعتان 4 و5 تعودان «التشغيل»، والمجموعة 7 تعود «القيادة».

تنبيهان من المواصفة §1.5 يبقيان ساريين:
- `groupedNavigation` يرتّب **بترتيب `nav.push`** لا بترتيب مصفوفة المجموعة؛ المصفوفة تحدد المجموعة فقط. فعمود «الترتيب» أدناه هو ترتيب `nav.push` المطلوب داخل المجموعة.
- مفتاح لا يرد في أي مجموعة **يسقط صامتًا** من القائمة.

## 1. المفاتيح الجديدة: المجموعة والترتيب والعنوان القصير

الترتيب رقمٌ داخل مجموعته، ويُترك فراغ بين المداخل القائمة والجديدة عند الدمج. «شرط الظهور» مقترح من التصريح الذي ترفض به اللوحة (المواصفة §2) ما لم يذكره التسليم حرفيًا.

### المجموعة 1: مساحتي

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 3 | `my-request-timeline` | أين طلباتي | اليوم | `has('requests.use')` |
| 6 | `announcements` | الإعلانات | اليوم | `has('portal.use')` |
| 11 | `letters` | خطاباتي | شؤوني | `me.role!=='admin'` |
| 14 | `hr-cases` | الشكاوى والاستفسارات | شؤوني | `me.role!=='admin'` |
| 15 | `policy-acknowledgements` | السياسات المطلوب إقرارها | شؤوني | `has('portal.use')` |
| 16 | `pulse` | استبيان النبض | شؤوني | `has('portal.use')` |
| 17 | `recognition` | التقدير | شؤوني | `has('portal.use')` |
| 20 | `one-to-ones` | اللقاءات الفردية | شؤوني | `has('portal.use')` |
| 21 | `feedback` | الملاحظات | شؤوني | `has('portal.use')` |

(`home` مسجَّل الآن وحدةً في `operationModules` بعد أن كان فرعًا يدويًا في `app.mjs` — انظر §3.)

### المجموعة 2: الطلبات والخدمات

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 6 | `intake-settings` | أولويات الطلبات | إعداد الخدمات | `has('catalog.manage')` |
| 7 | `catalog-quality` | نواقص دليل الخدمات | إعداد الخدمات | `has('requests.use')` |
| 8 | `service-insight` | قياس الخدمات | إعداد الخدمات | `has('executive.view')||has('catalog.manage')` |
| 9 | `knowledge` | مراجعة المصادر | إعداد الخدمات | `has('portal.use')` |
| 11 | `approval-settings` | إعداد مسارات الاعتماد | إعداد الخدمات | `has('catalog.manage')||has('structure.manage')||canApproveThresholds` |

### المجموعة 3: الموارد البشرية

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 3 | `lifecycle` | التعيين والمغادرة | الموظفون | `has('people.manage')` |
| 4 | `clearance` | إخلاء الطرف | الموظفون | `has('people.manage')` |
| 5 | `expiry` | انتهاء الوثائق | الموظفون | بلا شرط (نص التسليم) |
| 6 | `letter-templates` | قوالب الخطابات | الموظفون | `['hr.letters.prepare','hr.letters.issue'].some(has)` |
| 7 | `workforce` | تركيبة الموظفين | الموظفون | `has('hr.workforce.view')` |
| 11 | `leave-accrual` | استحقاق الإجازات | الوقت والإجازات | `['hr.policy.prepare','hr.policy.accept'].some(has)` |
| 12 | `benefits` | التأمين والمزايا | الوقت والإجازات | `has('hr.benefits.manage')` |
| 16 | `payroll-anomaly` | فحص المسير | الرواتب | `['payroll.prepare','payroll.review','payroll.approve'].some(has)` |
| 17 | `wage-reconciliation` | مطابقة الأجور | الرواتب | الشرط نفسه |
| 18 | `wps` | ملف حماية الأجور | الرواتب | الشرط نفسه |
| 19 | `compensation` | مراجعة الرواتب | الرواتب | `me.role!=='admin'` (اللوحة تصفّي بنفسها) |
| 21 | `review-360` | تقييم 360 | الأداء والتطوير | `has('portal.use')` |

(مداخل «الارتباط» الإدارية `pulse`/`recognition`/`announcements` تظهر مرة واحدة فقط — في «مساحتي» — ما لم يُبنَ الوجه الإداري المنفصل.)

### المجموعة 4: العملاء والحملات

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 2 | `pipeline` | خط الفرص | العملاء والمبيعات | `has('commercial.use')` |
| 3 | `estimates` | التقديرات والأسعار | العملاء والمبيعات | `has('commercial.use')` |
| 7 | `client-reports` | تقارير العملاء | العملاء والمبيعات | `has('commercial.use')` |
| 10 | `media-spend` | الصرف الإعلامي | الحملات والإعلام | `has('commercial.use')` |
| 11 | `influencers` | المؤثرون | الحملات والإعلام | `has('influencers.manage')` |
| 12 | `influencer-campaigns` | ارتباطات المؤثرين | الحملات والإعلام | `has('influencers.manage')` |
| 13 | `pr` | العلاقات العامة | الحملات والإعلام | `has('pr.manage')` |
| 14 | `media-contacts` | جهات الإعلام | الحملات والإعلام | `has('pr.manage')` |

### المجموعة 5: المشاريع والإنتاج

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 4 | `resourcing` | خطة الموارد | المشاريع | `has('resourcing.view')` |
| 5 | `timesheets` | اعتماد الساعات | المشاريع | `has('portal.use')` |
| 7 | `review-rounds` | جولات المراجعة | الاستوديو والإنتاج | `has('review.manage')` |
| 8 | `productions` | الإنتاج والتصوير | الاستوديو والإنتاج | `has('production.manage')` |
| 9 | `call-sheets` | أوراق الاستدعاء | الاستوديو والإنتاج | `me.role!=='admin'` |
| 10 | `equipment` | المعدات والعهد | الاستوديو والإنتاج | `me.role!=='admin'` |

### المجموعة 6: المالية

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 4 | `contracts-register` | سجل العقود | المشتريات والموردون | `['contracts.register.view','contracts.register.manage'].some(has)` |
| 7 | `billing-schedules` | الفوترة الدورية | الإيرادات والتحصيل | `has('billing.recurring.manage')` |
| 8 | `retainers` | اتفاقات الاشتراك | الإيرادات والتحصيل | `has('billing.recurring.manage')` |
| 9 | `einvoice` | الفوترة الإلكترونية | الإيرادات والتحصيل | `has('einvoice.manage')` |
| 11 | `bank-reconciliation` | المطابقة البنكية | المدفوعات والنقد | `['bank.reconcile','bank.reconcile.approve'].some(has)` |
| 12 | `cash-forecast` | التنبؤ النقدي | المدفوعات والنقد | `has('finance.forecast.view')` |
| 15 | `accruals` | الإطفاء والاستحقاقات | الدفتر والإقفال | `has('finance.close.manage')` |
| 16 | `close-checklist` | الإقفال الشهري | الدفتر والإقفال | `has('finance.close.manage')` |
| 19 | `vat-worksheet` | القيمة المضافة والزكاة | الضرائب والربحية | `['tax.returns.prepare','tax.returns.review'].some(has)` |
| 20 | `withholding` | ضريبة الاستقطاع | الضرائب والربحية | الشرط نفسه |
| 21 | `profitability` | الربحية | الضرائب والربحية | `has('profitability.view')` |
| 22 | `cost-rates` | معدلات التكلفة | الضرائب والربحية | `has('costing.manage')` |

### المجموعة 7: القيادة والحوكمة

| # | المفتاح | العنوان القصير | العنوان الفرعي | شرط الظهور |
|---|---|---|---|---|
| 3 | `objectives` | الأهداف والمبادرات | القيادة | `['governance.objectives.manage','governance.risks.manage','governance.decisions.record','executive.view'].some(has)` |
| 4 | `decisions` | القرارات والمحاضر | القيادة | الشرط نفسه |
| 7 | `risks` | سجل المخاطر | المخاطر والامتثال | الشرط نفسه |
| 9 | `privacy` | حماية البيانات | المخاطر والامتثال | `has('privacy.manage')` |
| 10 | `subject-requests` | طلبات أصحاب البيانات | المخاطر والامتثال | `has('privacy.manage')` |

### المجموعة 8: إدارة المنصة

| # | المفتاح | العنوان القصير | شرط الظهور |
|---|---|---|---|
| 2 | `access-reviews` | مراجعة الصلاحيات | `has('access.manage')||has('accounts.manage')||me.role==='manager'` |
| 4 | `ai-governance` | حوكمة المساعدين | `has('ai.govern')` |
| 5 | `jobs` | المهام الخلفية | `has('platform.flags')` |
| 6 | `feature-flags` | مفاتيح الميزات | `has('platform.flags')` |

### مفاتيح مسجَّلة لا تظهر في القائمة (قرار التدقيق §2.2)

| المفتاح | لماذا |
|---|---|
| `annotations` | تبويب داخل «جولات المراجعة»؛ يحمّل المسار نفسه |
| `einvoice-selfcheck` | تبويب داخل «الفوترة الإلكترونية» |
| `search` | حقل في الشريط العلوي (المواصفة §2.18 تضعه أول «مساحتي» إن بقي مدخلًا) |
| `home` | مدخل قائم في «مساحتي»؛ صار وحدة مسجلة لا فرعًا يدويًا |

## 2. `allowed()` في `hr-design.mjs`

كل المفاتيح الجديدة تُضاف إلى **المصفوفة الأولى (التي تعيد `false`)**، وإلا ظهرت كلها بطاقات «مساحات تشغيل مشتركة» لكل غير أدمن، لأن الفرع الافتراضي `me.role!=='admin'`:

```js
'bank-reconciliation','billing-schedules','retainers','cash-forecast','close-checklist','accruals','contracts-register','pulse','recognition','announcements','one-to-ones','feedback','review-360','objectives','risks','decisions','home','expiry','influencers','influencer-campaigns','leave-accrual','benefits','letters','letter-templates','pr','media-contacts','equipment','privacy','subject-requests','productions','call-sheets','cost-rates','profitability','timesheets','resourcing','review-rounds','annotations','search','vat-worksheet','withholding','wps','wage-reconciliation','payroll-anomaly','lifecycle','clearance','einvoice','einvoice-selfcheck','intake-settings',
'my-request-timeline','service-insight','knowledge','policy-acknowledgements','access-reviews','pipeline','estimates','jobs','feature-flags','ai-governance','catalog-quality','hr-cases','compensation','workforce','media-spend','client-reports','approval-settings'
```

65 مفتاحًا (48 من §1.4 + 16 من §9.8 + `approval-settings` من تسليم محرك الاعتماد). المواصفة كتبت «49» و«65» في العد سهوًا؛ الأرقام هنا من الكود المسجَّل فعلًا.

## 3. ما ينتبه له من يطبق

1. **`home`:** تسجيله وحدةً يطغى على الفرع اليدوي `else if(['home','requests'].includes(view))` في `app.mjs` لأن `operationModules[view]` يُفحص أولًا، و`#home` هو المسار الافتراضي. يبقى الفرع حيًا لـ`requests` وحدها؛ ويُنظَّف كود `home` الميت، ويوحَّد الاسم («الرئيسية» لا «يومي»).
2. **اسمان لشاشة واحدة:** التدقيق يطلب `navTitle` في كل وحدة يُقرأ منه اسم القائمة ومسار الشريط العلوي. العناوين القصيرة أعلاه هي المرشَّحة لـ`navTitle`.
3. **تكرار المعنى لا الكود:** `retainers` (اتفاقات اشتراك جديدة) بجوار «اشتراكات» الوكالة القائمة، و`timesheets` بجوار `time`، و`feedback` بجوار تقييم جودة الخدمة. ثلاثة أزواج تحتاج قرار تسمية من المالك قبل أن يراها الموظف (المواصفة §5.1).
4. **الأيقونات:** `◷` مكرر في `home` و`time` و`compliance`، و`▦` في `departments` و`content` و`procurement` و`assets`، وتزيد الوحدات الجديدة التكرار. يُعطى كل مدخل داخل المجموعة الواحدة رمزًا مختلفًا.
5. **الصندوق يدل على الشاشة:** كل مفتاح مصدر في `app/inbox.mjs` هو مفتاح شاشة مسجَّل، فرابط البند `#<key>` يفتحها. من يغيّر مفتاح شاشة يغيّر معه سطر المصدر.
