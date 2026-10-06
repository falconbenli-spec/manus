# design-G — ميزة «المظهر» (الحزمة G)

- التاريخ: 2026-09-18 · تشغيل مُستأنف بعد انقطاع بحدّ الاستخدام.
- ما وجدته عند الاستئناف: لا شيء من ملفات G كان موجودًا (لا الهجرة ولا الوحدة ولا الشاشة ولا الاختبار ولا تعديلات `server.mjs`/`operations.mjs`). الموجود كان عمل حزم أخرى: `app/static/theme-boot.js` (F) وتعديلات B-3…B-9 في `app.mjs` والإضافات الثلاث في `hr-design.mjs` وسطر `<script src="/theme-boot.js">` في `index.html`. لم ألمس أيًّا منها. المشروع ليس مستودع Git فلا `git diff`؛ اعتمدت على قراءة الملفات.
- المرجع: `docs/product/design/DESIGNS-ADDENDUM.md` §هـ (وقرارات المالك 4 و17 و18).

## الملفات

| الملف | الحال |
|---|---|
| `app/migrations/094-user-preferences.sql` | جديد. جدولا `appearance_settings` (صف لكل كيان) و`user_appearance` (صف لكل مستخدم) + فهرس `user_appearance_tenant`. لا بذر |
| `app/preferences.mjs` | جديد. `DESIGNS` `THEMES` `FALLBACK` `companyAppearance` `effectiveAppearance` `appearanceView` `setPersonalAppearance` `setCompanyAppearance` |
| `app/static/appearance-ui.mjs` | جديد. `appearanceUI={title,description,load,render,form}` |
| `tests/preferences.test.mjs` | جديد. 8 اختبارات |
| `app/static/operations.mjs` | سطر `import` واحد + مدخل `appearance:appearanceUI` في `operationModules`. لا شيء غيرهما |
| `app/server.mjs` | ستة مواضع فقط: `import * as preferences`؛ `/theme-boot.js` في خريطة `assets`؛ `'appearance-ui'` في قائمة الوحدات؛ حقل `appearance` في `userView`؛ `GET /api/appearance`؛ و`POST /api/account/appearance` + `POST /api/admin/appearance` داخل `transaction(db,…)` القائمة |
| `docs/implementation/handoff/design-G.md` | هذا الملف |

## ما أُنجز

- **الحسم على الخادم:** اختيار شخصي (إن لم يُقفل) ← افتراضي الشركة ← `void/dark`. `auto` اختيار صريح فقط، وليس افتراضيًا في أي مسار. `effectiveAppearance` قراءة خالصة باستعلامين على مفتاحين أساسيين، وتصل مع `/api/me` و`/api/login` بالشكل `{design,theme,locked,source}`.
- **الاختيار الشخصي:** `{design,theme}` بالضبط أو `{reset:true}` بالضبط؛ غير ذلك 400 `invalid_fields`. عند القفل 409 `appearance_locked` برسالة «المظهر موحّد من إدارة المنصة». القفل يتجاهل الصف الشخصي ولا يحذفه، فيعود حين يُرفع.
- **افتراضي الشركة:** للأدمن الأول وحده (`isSuperAdmin`)، بسبب مكتوب (10–1000 حرف بعد القص)، داخل معاملة، وبسطر تدقيق `appearance.company_default` يحمل ما كان وما صار. تغيير بلا فرق يُرفض 409 `no_change` حتى لا يُكتب سطر تدقيق فارغ.
- **كل كتابة** تؤكد `db.isTransaction` (الشخصية والإدارية)، وكل استعلام مقيَّد بـ`tenant_id`.
- **الشاشة:** جملة الحال ومصدرها، تنبيه القفل، ثلاث كتل تصميم لكل منها معاينتان SVG (داكن ثم فاتح) بسمات عرض فقط، شارة «الحالي» على التصميم الفعّال وإطار فيروزي على المعاينة المطابقة للوضع الفعّال، كتلة «الوضع» بثلاثة أزرار، وكتلة «افتراضي الشركة» للأدمن الأول. أصناف قائمة فقط (`panel panel-body vn-head vn-alert vn-grid vn-block badge ltr subtle operation-actions`). الفيروزي يُكتب `var(--brand-turquoise)` ولا يظهر HEX له في الملف (القرار 1).
- **التطبيق الفوري والتخزين المحلي** تقوم بهما تعديلات B القائمة في `app.mjs` (B-6 بعد الحفظ، B-7 للمعاينة الحية عند تغيير أي من الحقلين `design`/`theme`، و`paintAppearance` عند إغلاق الحوار). المساران يعيدان `{appearance}` كما تتوقع B-6، واسما الحقلين محفوظان كعقد.

## قرارات اتخذتها حيث اختلفت المصادر (لا تُعاد فتحها دون سبب)

1. **اسم الهجرة:** نص المهمة يملّكني `094-user-preferences.sql` والملحق يسميها `094-appearance.sql`. كتبت الاسم الذي أملكه. أسماء الجداول كما في الملحق.
2. **الحفظ الشخصي لا يُدقَّق.** نص المهمة يقول «audit() لكل تغيير»، والملحق §هـ.2 و§هـ.9 ينصان صراحة على ألا يُكتب سطر تدقيق للحفظ الشخصي لأن زر «الوضع» في الفهرس يحفظ مع كل ضغطة فيُغرق السلسلة. اتبعت الملحق (هو المقدَّم عند التعارض). افتراضي الشركة وقفله يُدقَّقان دائمًا. إن أراد المالك تدقيق الشخصي فهو سطر `audit(...)` واحد في `setPersonalAppearance` وتعديل توقّع واحد في الاختبار.
3. **الرقم التفاؤلي:** أضفت عمود `version` للجدولين (ليس في نص الملحق). افتراضي الشركة: `version` حقل **اختياري** في الجسم؛ إن أُرسل ولم يطابق رُفض 409 `stale_version` (0 قبل أول حفظ). الشاشة ترسله دائمًا. أبقيته اختياريًا حتى يبقى الجسم `{design,theme,locked,reason}` الذي في الملحق صالحًا. الصف الشخصي: آخر كتابة تغلب (زر الوضع في `app.mjs` يرسل بلا رقم، و`app.mjs` ليس ملفي)، ورقمه يزيد للتتبع فقط.
4. **`updated_by` و`updated_at` في `appearance_settings` صارا `NOT NULL`** (الملحق تركهما قابلين للفراغ على نمط 035): لا بذر، فكل صف يكتبه أدمن معروف.
5. **`company.updated_by_name`** يُعاد `null` لغير الأدمن الأول: الموظف يكفيه التصميم والوضع والقفل.
6. **زيادة على الملحق في الشاشة:** كتلة «الوضع» بأزرار `choose` يحمل `id` فيها الصيغة `design:theme` (مثل `void:light`) فتفتح النموذج نفسه مضبوطًا على الوضع. `form('choose','void',data)` كما في الملحق ما زالت تعمل. أي `id` خارج القائمتين يرمي «الإجراء غير متاح».

## ما لم يُفعل

- لم أشغّل المنصة الحقيقية في متصفح ولم أسجّل دخولًا (قاعدة الأمان تمنعني من إدخال كلمات المرور). تحققت بصريًا من ناتج `appearanceUI.render` وحده عبر خادم تجريبي مؤقت خارج المشروع على المنفذ 3917 (قاعدة في الذاكرة، CSP نفسها، أوراق الأنماط الخمس) في `void/dark` و`slate/light`: المعاينات الست ترسم، و`fill="var(--brand-turquoise)"` يعمل في Chromium، ولا أخطاء في وحدة التحكم. **لم أختبر Safari ولا Firefox**، ولم أختبر الحوار ولا المعاينة الحية ولا التخزين المحلي في المتصفح (منطقها في `app.mjs` عند B).
- ملاحظة سلوك لمن يملك `app.mjs`: المعاينة الحية تعمل عند حدث `change` فقط؛ فتح حوار «اختيار هذا التصميم» لتصميم غير الحالي لا يبدّل الصفحة حتى يغيّر المستخدم أحد الحقلين أو يحفظ. إن أُريد التبديل فور الفتح فهو تعديل في `app.mjs` لا عندي.
- لا مسار غير موثَّق يكشف افتراضي الشركة قبل الدخول (قرار الملحق §ب.3): أول دخول على جهاز جديد يبدأ من `void/dark` ثم تصححه الحمولة.
- لم ألمس المنفذ 3600 ولا `work/` ولا `.env`، ولم أودِع ولم أنشر. لم تُطبَّق الهجرة على أي قاعدة ملفية من عندي (الاختبارات كلها `:memory:`).
- لم أحدّث `STATUS.md` ولا `docs/traceability.json`: ليسا من ملفاتي في هذه الحزمة.

## الفحوص ونتائجها الحرفية

| الأمر | النتيجة |
|---|---|
| `node --check` على `app/preferences.mjs` و`app/server.mjs` و`app/static/appearance-ui.mjs` و`app/static/operations.mjs` | نجح (`OK`) |
| `node --test tests/preferences.test.mjs` | `tests 8 · pass 8 · fail 0` |
| `node --test tests/preferences.test.mjs tests/static-modules.test.mjs tests/ui-render.test.mjs tests/ui-race.test.mjs tests/dialog-races.test.mjs tests/migrations.test.mjs tests/privacy.test.mjs tests/totp.test.mjs` | `tests 29 · pass 29 · fail 0` |
| `npm run check` | `Syntax checked: 363 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.` |
| `npm test` (مرة واحدة في النهاية) | `tests 684 · pass 684 · fail 0 · cancelled 0 · skipped 0` |
| `grep` في `appearance-ui.mjs` عن `style=` و`<style` و`<script` و`left`/`right` وأرقام هندية | 0 مطابقات |

ما تغطيه `tests/preferences.test.mjs`: الافتراضات · الحسم الثلاثي والعودة · القفل (يتجاهل ولا يحذف، 409 بالعربية، يعود بعد الرفع) · القيم غير الصالحة والمفاتيح الزائدة والسبب القصير والرقم القديم و`no_change` وقيود CHECK في القاعدة · 403 لغير الأدمن الأول (ومنهم أدمن `scoped`) · `transaction_required` · سطور التدقيق بما قبل وما بعد و`verifyAudit` سليمة، ولا سطر للحفظ الشخصي، ولا أثر بعد معاملة فاشلة · عزل المستأجر (افتراضي وقفل واختيار، وصف شخصي بكيان مخالف لا يُقرأ) · HTTP: المسارات الثلاثة وCSRF و401 و`appearance` في `/api/login` و`/api/me` واتباع الاختيار للحساب عبر دخول جديد · `GET /theme-boot.js` و`GET /appearance-ui.mjs` = 200 `text/javascript` · ناتج الشاشة للموظف وللأدمن مقفلًا وغير مقفل بلا `style=`/`<script`/`<style`/`href`/صنف جديد، وست معاينات و36 فاصلة، ولا HEX للفيروزي، وكل زر يفتح نموذجًا صالحًا لا يطابق تعبير `destructive`.
