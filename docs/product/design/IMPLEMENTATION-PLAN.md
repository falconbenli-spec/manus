# IMPLEMENTATION-PLAN — خطة بناء «الفراغ 360»

- التاريخ: 2026-09-18
- الحالة: **خطة. لم يُبنَ شيء، ولم يُشغَّل أي أمر منها.** سكربت التحقق في الحزمة V مكتوب من قراءة `scripts/*.mjs` و`app/server.mjs` ولم يُجرَّب.
- المرجع: `DESIGN-SPEC-36T.md` (المواصفة) و`03-current-ui-map.md` (العقد). عند التعارض تُقدَّم المواصفة في الشكل، والخريطة في العقد. **و`DESIGNS-ADDENDUM.md` يغلب الاثنتين وهذه الخطة** (قرارات المالك المفوَّضة، والتصاميم الثلاثة، وحزمة «المظهر» G، وتصحيحات ما بعد إعادة بناء التنقل). ما عُدِّل هنا بسببه موسوم بـ«[ملحق]».
- الهدف من التقسيم: **سبع حزم (A–G) تعمل بالتوازي ولا تلمس اثنتان منها الملف نفسه** ([ملحق] كانت ستًّا؛ أُضيفت G).
- **[ملحق] الشرط المسبق مستوفى:** شرط §5 «لا بناء قبل توقيع المالك على البنود 1–9 و16» استوفي بالتفويض («انت شف وش الافضل ووافق»)؛ البنود الستة عشر مغلقة في المواصفة §12 والملحق §أ.

---

## 0. القواعد التي تحكم الجميع

1. **ملكية الملف حصرية.** كل ملف له مالك واحد (الجدول أدناه). من يحتاج تغييرًا في ملف غيره يطلبه من مالكه كتابةً.
2. **ملكية المحدِّد حصرية.** كل عائلة أصناف لها ملف واحد (§2). لا يُعرَّف المحدِّد نفسه في ملفين. **الاستثناءات المسماة، ولا استثناء غيرها:**
   - `.page-head::after` و`.empty-symbol` و`.loading` ملك `athar.css` وحده، ولا يعرّف أحد غيره `::after` على `.page-head`.
   - `.dialog-head::before` و`.side-head::before` (مقبض حامل البطاقة) ملك `athar.css` وحده؛ C وB يملكان العنصرين ولا يكتبان `::before` عليهما.
   - **بدائية «سطر الكتابة»** تُعرَّف مرة واحدة عند A (`signature.css`، طبقة `base`) بقائمة محدِّداتها الكاملة من المواصفة §6.6. بقية الحزم تضبط **المقاس والموضع فقط** لمحدِّداتها: B (`#nav-search`، `.sig-cmd-input`)، C (`.sig-filter`، `#journey-search`)، D (`.filters`، `.acc-filter`، `#department-search`، `#benchmark-search`، `.wk-add`)، E (`#login-form`، `#password-form`، `.rq-search`).
   - `.journey-cta`: التعبئة عند C (طبقة `fill`)، والموضع عند E.
   - `.pt-tiles`: الشكل عند C (صيغة البلاطة)، والموضع تحت البطل عند E.
   - `.status-dot`: الشكل عند A (نظام الحالة)، والموضع داخل `.side-note` عند B.
   - `.department-back`: عند B وحده؛ D يملك `.department-*` **عداه**.
3. **لا ملف ثابت باسم جديد** — **[ملحق] عدا اثنين مسمَّيين:** `theme-boot.js` (يكتبه F) و`appearance-ui.mjs` (يكتبه G)، ومدخلاهما في قائمة `server.mjs` البيضاء يكتبهما G. الملفات المتاحة بلا تعديل `server.mjs`: `signature.css` `style.css` `journey.css` `athar.css` `hr-design.css` و`signature.mjs` `motion-cards.mjs` `hr-design.mjs` `app.mjs` و`index.html`.
4. **ملفات مجمَّدة لا يلمسها أحد** (**[ملحق] الاستثناءات المسماة، ولا غيرها:** `operations.mjs` سطر التسجيل لـG؛ `app/server.mjs` ثلاثة مواضع لـG (الملحق §هـ.8)؛ `hr-design.mjs` ثلاث إضافات لـB (§هـ.7)؛ والملفات **الجديدة** `app/preferences.mjs` و`app/migrations/094-appearance.sql` و`tests/preferences.test.mjs` و`app/static/appearance-ui.mjs` لـG. كل اختبار قائم وكل هجرة مطبَّقة تبقى مجمَّدة)**:** كل `*-ui.mjs`، `report-print.css`، `dates.mjs`، `athar.mjs`، `journey.mjs`، `operations.mjs`، `request-picker.mjs`، `brand-logo.mjs`، `app/server.mjs`، كل `tests/`، كل `app/*.mjs` الخادمية، و`.env`.
5. **المحظورات:** `style=""`، `<style>`، `<script>` داخلي، أي مورد خارجي، إعادة تسمية صنف، `import` أو استدعاء دالة مستوردة جديدة في `app.mjs`، إحداثيات فيزيائية (`left/right`) بدل الخصائص المنطقية، إعادة كتابة عقد نصية تنتجها الوحدات.
6. **ترتيب تحميل CSS في `index.html`:** `signature.css` ← `style.css` ← `journey.css` ← `athar.css` ← `hr-design.css`. **الذي يحسم التعارض هو ترتيب الطبقات (العقد 5) لا ترتيب التحميل.** `signature.css` أولًا لأن سطر `@layer` الأول فيها يثبت الترتيب للجميع.
7. **نقطتا انكسار فقط:** `760px` و`1024px`، و`compact()` في `signature.mjs` تبقى `(max-width:1023.98px)`.
8. **الصدق:** لا يدّعي أحد أن شيئًا «يعمل» قبل تشغيل الفحوص وذكر نتيجتها. كل حدّ أو فشل يُكتب في تقرير الحزمة.
9. **المتمرر هو `html`.** لا `overflow` ولا ارتفاع ثابت على `body` أو `.shell` أو `.stage` أو `#main`. عليه يعتمد مشهد `home` واللصق كله و`IntersectionObserver`.
10. **لا منسّق آلي (Prettier وما شابه) على `hr-design.css`.** أي أداة تضيف مسافة بعد `@media` تُسقط `motion-cards.test`. ويُفضَّل ألا يُنسَّق أي من الملفات الخمسة آليًا قبل مرور فحص V.
11. **لا سمة محقونة باسم قائم.** `data-group` (على `details.hr-nav-group`، تقرؤها `signature.mjs`) و`data-index` (خطاف لوحة الأوامر) محجوزتان. المحقون يبدأ بـ`data-sig-` أو يُسمى في العقد 3.

### جدول الملكية

| الحزمة | المهندس | الملفات المملوكة | المسؤولية في جملة |
|---|---|---|---|
| **A** | 1 | `app/static/signature.css` | سطر `@layer` + الرموز **+ كتل التصاميم `field`/`slate` (الملحق §ج)** + الخط ورموز الوزن `--fw-*` + الأساس + الروابط + بدائية «سطر الكتابة» + الطباعة + الأدوات + نظام الحالة |
| **B** | 2 | `app/static/hr-design.css`، `app/static/app.mjs` (**[ملحق] تسعة تعديلات مسمّاة B-1…B-9**، الملحق §هـ.6)، `app/static/hr-design.mjs` (**[ملحق] ثلاث إضافات مسمّاة**، §هـ.7) | الغلاف والتنقل، وأرضية بطل `field` |
| **C** | 3 | `app/static/style.css` | المكونات |
| **D** | 4 | `app/static/journey.css` | أسطح البيانات: القوائم والجداول والنماذج والتفاصيل + عائلات الشاشات |
| **E** | 5 | `app/static/athar.css`، `app/static/motion-cards.mjs` | محرك الحلقة وأنماطها + الدخول + أبطال المسرح + الأفق + العبور |
| **F** | 6 | `app/static/signature.mjs`، `app/static/index.html`، **[ملحق] الجديد `app/static/theme-boot.js`** | سلوك الغلاف، والحقن، ودورة حياة الحلقة، وسكربت الإقلاع، ومراقبة `data-design` |
| **G** | 7 | **[ملحق]** `app/migrations/094-appearance.sql`، `app/preferences.mjs`، `app/static/appearance-ui.mjs`، `tests/preferences.test.mjs`، سطر التسجيل في `app/static/operations.mjs`، وفي `app/server.mjs` **حصرًا**: المسارات الثلاثة + مدخلا القائمة البيضاء (`appearance-ui` و`theme-boot.js`) + حقل `appearance` في حمولة المستخدم | ميزة «المظهر»: اختيار التصميم والوضع، محفوظ على الخادم لكل مستخدم، بافتراضي للشركة وقفل بيد الأدمن الأول |
| **V** | المهندس 1 بعد تجميد A | لا ملفات في `app/` ولا `tests/`؛ فقط `work/design-verify/` | قاعدة التحقق المصطنعة، والخادم المؤقت، وفحوص القبول |

> **لماذا المحرك في `motion-cards.mjs` لا `athar.mjs`؟** التقسيم المطلوب يسنده إليه، وخريطة الواجهة عدّته بديلًا مقبولًا بقيدين يلتزم بهما E: لا لمس لـ`document`/`window` عند مستوى الوحدة (الملف يُستورد في Node داخل `tests/motion-cards.test.mjs`)، وبقاء `mountCards` و`prefersReducedMotion` بسلوكهما الحرفي. `athar.mjs` يبقى بلا لمس و`mountScenes` كما هي.

---

## 1. العقود الخمسة المجمَّدة (اليوم صفر، قبل أي كود)

تُعتمد هذه العقود الخمسة من المواصفة كما هي. أي تغيير فيها بعد التجميد يحتاج موافقة الستة. **[ملحق]** عُدِّل العقدان 1 و2 بقرار المالك المفوَّض قبل التجميد: رموز جديدة وكتل تصاميم (العقد 1)، وسمة `data-design` وافتراضي `dark` (العقد 2). وأُضيف عقد سادس لحزمة G: شكل `me.appearance` والمسارات الثلاثة (الملحق §هـ.3–هـ.4).

### العقد 1 — الرموز
كتلة CSS في `DESIGN-SPEC-36T.md` §2.2 حرفيًا، من سطر `@layer` إلى كتلة `forced-colors`. **أول عمل للمهندس 1:** لصق الكتلة في `signature.css` وتسليمها خلال ساعتين. الحزم الأخرى تكتب ضد الأسماء من المواصفة مباشرة ولا تنتظر. ممنوع على B–E تعريف لون أو مقاس حرفي خارج الرموز **بلا استثناء** ([ملحق] الحرفي `#141414` صار الرمز `--ghost`). **[ملحق] يُضاف إلى العقد 1:** الفيروزي في رمز واحد `--brand-turquoise` (لا `#16A085` حرفيًا في أي كتلة)؛ الرموز `--logo` `--ink-display` `--ghost` `--ring-live` `--fw-display` `--fw-body` `--fw-stage-body` `--fw-label` `--fw-strong`؛ محدِّد كتلة الورق الأولى `:root[data-theme=auto]`؛ وكتل `field`/`slate` من الملحق §ج.1–ج.5 حرفيًا داخل `@media screen` واحد قبل نهاية `@layer tokens`.

مما يُجمَّد فيه صراحةً، لأن حزمًا تعتمد عليه:
- **سلّم اللصق:** `--stick-1` (المرشّحات) · `--stick-2` (ملخص `vn-card[open]` ورأس الجدول الحر) · `--stick-3` (رأس الجدول داخل بطاقة مفتوحة) · `--filter-h` (صفر افتراضيًا، و44px عبر `:root:has(#main :is(.sig-filter,.filters,.acc-filter))`) · `--summary-h:64px`. السلّم فعّال عند ≥ 760 فقط. **لا أحد يكتب `top:var(--sticky-top)` مباشرةً** عدا لوح القرار في A5.
- `--select-arrow` لكل مظهر · `--condolence-block` و`--occasion-condolence-ink` · `--hero-ring-r` · ألوان حلقة الورق الجديدة و`--horizon` الورق `#16A085`.
- كتل `prefers-contrast:more` الأربع وكتلة `forced-colors`.
- `:root[data-tier=ledger][data-density=cozy]{--row-h:52px}`.
- **دلالة `--c`/`--m`:** A وحده يعرّف الخاصيتين من خريطة المواصفة §8 (على `.badge` وقيمها، وعلى أصناف `is-*`). **الرسم موزّع:** A يرسم `::before` لـ`.badge` `.vn-flag` `.ex-flag` `.status-dot`؛ C يرسم البلاطات والمسارات والتنبيهات وعلامة فتح `vn-card`؛ D يرسم صفوف القوائم والجداول وعائلات الشاشات؛ B يرسم `.nav-count` وعلامات الفهرس. لا راسم يعيد تعريف لون.

### العقد 2 — سمات `html` (تكتبها F، ويقرؤها CSS)
| السمة / الصنف | القيم | متى |
|---|---|---|
| `data-theme` | `auto\|light\|dark` | **[ملحق]** يكتبها `/theme-boot.js` قبل أول رسم، ثم `app.mjs` (التعديلات B-3…B-7). **الافتراضي `dark`**؛ `auto` اختيار صريح. غياب السمة = فراغ داكن |
| `data-design` | `void\|field\|slate` | **[ملحق]** الكاتبان نفساهما والتوقيت نفسه. غيابها = `void`. `signature.mjs` تراقبها ولا تكتبها. الحسم: شخصي (إن لم يُقفل) ← افتراضي الشركة ← `void/dark`، على الخادم (الملحق §ب) |
| `data-tier` | `stage\|desk\|ledger` | **متزامنًا** في معالج `hashchange` وعند الإقلاع، من خريطة مسارات ثابتة (المواصفة §1.3 قانون 5 و§5). لا تتبدل بعد وصول البيانات |
| `data-scene` | `login\|home\|index\|off` | من المسار ومن وجود `#app > .login` و`html.is-menu-open` |
| `data-route` | مفتاح المسار (`inbox`، `payroll`…) | متزامنًا مع `data-tier` |
| `data-density` | `cozy\|compact` | `localStorage 36t-density`. **السمة غائبة حتى يختار المستخدم صراحةً**؛ غيابها = افتراضي الطبقة (الدفتر 44px). لو كُتبت `cozy` افتراضيًا لألغت كثافة الدفتر للجميع |
| `data-motion` | `off` أو غائبة | مع زر «إيقاف الحركة» و`localStorage 36t-motion-paused`. يقرؤها CSS (طبقة `kill`) والعدّ التصاعدي، لا المحرك وحده |
| `data-inbox` | عدد نصي، أو غائبة | **تكتبها `app.mjs`** (تعديل B الثاني) داخل `.then` لطلب `/inbox/count`. غيابها = «لم يصل العدّ أو فشل» = `pending:null`. تحذفها F عند ظهور `.login` |
| `dir` | `rtl\|ltr` | تكتبها `app.mjs` اليوم بحسب اللغة. `html[dir=ltr]` يعكس هندسة الدخول (`--ring-x:66vw`) وتمرر F `mirror:true` |
| `.is-searching` | — | **قائم:** تضبطه `signature.mjs` عند فتح لوحة الأوامر (لا عند ترشيح الفهرس). أثره قفل التمرير فقط، وقاعدته عند A |
| `.is-threshold` | — | 400ms عند ظهور `.shell` بعد `.login` |
| `.is-kbd` | — | من `visualViewport`: لوحة المفاتيح مفتوحة |

خريطة الطبقات: `stage` = `home portal departments catalog executive` + الدخول. `ledger` = `payroll finance accounts reports statements requests notifications bank-reconciliation vat-worksheet withholding wps timesheets resourcing requirements`. `desk` = كل ما سواها.

قائمتان أخريان من مفاتيح `data-route` تُجمَّدان هنا وتُكتبان بـ`html:is([data-route=…],…)` (الصيغة `a|b` داخل محدِّد السمة ليست CSS صالحة):
- **المسارات الحساسة** (سكون الحركة والعدّ وتغذية الـcanvas، وشريط 6px بدل كتلة الأفق): `payroll hr-cases compensation security payroll-extras payroll-anomaly wps contracts wage-reconciliation benefits performance`.
- **الفراغ «الجيد»** (فاصلة ممتلئة؛ ما عداها مفرّغ بتسمية `--spark`): `inbox notifications work`.

### العقد 3 — العناصر المحقونة (تنشئها F بـDOM API، ويصممها المالك المذكور)
| العنصر | الموضع | يصممه |
|---|---|---|
| `nav.sig-siblings > button.sig-siblings-group[data-shell=drawer] + a[href][aria-current]* + button.sig-siblings-more[data-shell=drawer]` | بعد `header.topbar` داخل `.stage` | B |
| `button.sig-theme[data-action=theme]` | داخل `header.topbar` | B |
| `ul.sig-recent > li > a` | داخل `.sidebar` بعد `.nav-search-label` | B |
| `button.nav-row[data-sig=motion]` «إيقاف الحركة» و`[data-sig=density]` | داخل `.side-account .hr-nav-rows` | B |
| **`[data-sig-group]`** على `.page-head > div:first-child` (لا `data-group`: محجوزة) | — | B |
| `p.sig-date`، `p.sig-greeting` (الاسم الأول فقط)، `p.sig-census`، `a.sig-eye > b + span` (`b` للرقم وحده أو «—»؛ الجملة العربية في `span`) | داخل `.page-head` في `home` و`portal` | E |
| `details.sig-more > summary + (الأزرار المنقولة)` | داخل `.vn-head .operation-actions` | C |
| `details.sig-older > summary + (عناصر `.timeline-item` المنقولة بعد الخامس)` | داخل `.timeline` | C |
| `[data-num]` على عناصر قائمة العدّ حين يطابق نصها `/^[\d\s.,:%+\-–SAR]+$/` (تُزال إن تغيّر النص) | — | A (`[data-num]{letter-spacing:-.02em}`) |
| `inert` على `.stage` **و`nav.sig-tabs`** عند فتح الفهرس | — | — |
| `td[data-label]`، `table[data-cols]`، `.table-wrap.is-wide`، `aria-label` على `[data-col]` (وفي `template.content`) | — | D |
| `svg.sig-arc` (≤ 3 `<path>`) | داخل `section.panel:has(.journey)` | D |
| `h1.is-long`، `h1.is-xlong` | — | A |
| `nav.sig-tabs`، `.sig-cmd*`، `.topbar.is-condensed` (قائمة اليوم) | — | B |
| `label.sig-filter` (قائم اليوم) | قبل أول `.vn-card` | A للبدائية، وC للمقاس واللصق عند `--stick-1` |

كل حقن **وكل نقل عقد** (`sig-more`، `sig-older`): داخل `enhance()` المربوطة بالمراقب القائم، **متكرر الأمان (idempotent)** بوسم العقد المعالَجة، وملفوف بـ`try/catch`، وله علم تعطيل في `localStorage 36t-enhance-off`. **لا خريطة أسماء لاتينية للمجموعات** في `signature.mjs`: القفل اللاتيني في الفهرس `content:"INDEX"` في CSS والأرقام 01–08 بـ`counter-increment`.

### العقد 4 — واجهة المحرك (ينفذها E، وتستهلكها F)
```js
// app/static/motion-cards.mjs — new exports; existing two stay untouched
export function ringField(opts)   // pure, Node-testable
export function commaField(opts)  // pure, Node-testable
export function mountBackdrop(canvas,{view=globalThis,reduced}={})
// → { setScene(name /* 'login'|'home'|'index'|'off' */, {cx,cy,R,mirror} /* CSS px relative to the canvas box */),
//     setData({pending:Number|null /* null = count not received or failed */, late:Boolean, progress:Number /*0..1*/, closed:Boolean}),
//     setExclusions([{x,y,w,h}]),  // CSS px relative to the canvas box
//     dim(level /*0..1*/), pulse(), pause(), resume(), destroy() }
// Geometry is ALWAYS passed by F. login: F reads --ring-x/--ring-y/--ring-r with getComputedStyle (mirror=true when html[dir=ltr]).
// home: F measures the a.sig-eye box once per render and on ResizeObserver; R = box width / 2.24. The engine never reads the DOM for geometry.
// closed is honoured only with pending===0; pending===null keeps the gap open and draws no moons.
// resume(): also called by F on setData with a changed value, on visibilitychange, and on ONE passive pointerdown after an idle freeze.
// reduced motion: the static frame is redrawn on resize, theme change, every setData with a changed value, and by a 60 s setTimeout (no rAF).
```
F تستورد: `import { mountBackdrop } from './motion-cards.mjs';` (سطر واحد؛ الملف مخدوم فيمر `static-modules`). إلى أن يسلّم E، تعمل F ضد بديل يعيد كائنًا بدوال فارغة، **والبديل دالة داخل `signature.mjs` نفسها** (أي ملف مستقل له يصير ملفًا ثابتًا باسم جديد فيكسر `static-modules`)، ويُحذف عند الدمج.

### العقد 5 — طبقات الشلال
أول سطر في `signature.css`: `@layer tokens,base,state,components,surfaces,stage,shell,fill,kill;` (المواصفة §2.4). كل حزمة تكتب **كل** قواعدها داخل طبقتها:

| الطبقة | يكتبها | الملف |
|---|---|---|
| `tokens` `base` `state` | A | `signature.css` |
| `components` و**`fill`** | C | `style.css` |
| `surfaces` | D | `journey.css` |
| `stage` | E | `athar.css` |
| `shell` و**`kill`** | B | `hr-design.css` |

لماذا: الترميز الفعلي `button.btn.outline.small[data-operation=punch_in]` داخل `.vn-head .operation-actions`؛ قاعدة الفعل النصي هناك (0,3,0) وقواعد D لأفعال الصفوف كانت ستغلب القائمة البيضاء (0,1,0)، و`hr-design.css` المحمَّل أخيرًا كان سيغلب قواعد E داخل `.page-head`. مع الطبقات: `fill` تغلب الجميع، و`kill` فوقها. القيود: لا قاعدة خارج طبقة عدا الكتلة المجمَّدة في رأس `hr-design.css` و`@font-face` و`@keyframes`؛ `!important` يعكس ترتيب الطبقات فيُمنع خارج `kill` ومخفيات الجولة الثلاث؛ لا `outline:none` في أي طبقة. الدعم Safari ≥ 15.4 (الحد المفترض في الخريطة 15.5).

---

## 2. الحزم

### الحزمة A — الرموز والأساس والطباعة ونظام الحالة

**الملف:** `signature.css` (يُعاد كتابته كاملًا؛ الهدف ≤ **24KB** — [ملحق] كان 18؛ كتل التصاميم ≈ 6KB).

**[ملحق] يُضاف إلى النطاق:** كتل الملحق §ج.0–ج.5 حرفيًا بترتيبها (ج.1 ← ج.2 ← ج.3 ← كتلتا ج.5 الأوليان ← ج.4 ← نظيرة المسرح)؛ `.sig-eye::before` في قائمة `forced-colors`؛ الأوزان بالرموز `--fw-*` لا بأرقام حرفية؛ لا `@font-face` لوزن بلا ملف. **ويُضاف إلى القبول:** توائم الفاتح الثلاثة متطابقة؛ `node work/design-verify/contrast-designs.mjs` يمر؛ `grep -c '#16A085' app/static/signature.css` = 1؛ لا `:root:not([data-theme=dark])` في الملف.

**النطاق:**
- سطر `@layer` الأول (العقد 5)، ثم كتلة الرموز (العقد 1) مع آلية المظهر: `:root` فراغ، كتلتا «الورق» المتطابقتان، كتلة `:root:has(> body > #app > .login)`، الطبقات، الكثافة (ومنها `ledger`+`cozy`)، سلّم اللصق، كتل `prefers-contrast:more` الأربع، كتلة `forced-colors` (`forced-color-adjust:none; background-color:CanvasText` على كل راسم قناع، بقائمة يجمعها A من C وD وB وE).
- أربع قواعد `@font-face` مع `unicode-range` و`font-display:swap`؛ `html{font-family:var(--font); font-synthesis:none}`.
- الأساس: `html{background:var(--canvas)}`، `body{background:transparent; color:var(--ink-2); font:400 var(--fs-body)/var(--lh-body) var(--font)}`، `#app{position:relative; z-index:var(--z-app)}`، العناوين الافتراضية، **الرابط العام** (`a{color:var(--ink-1); text-decoration:underline 1px; text-underline-offset:5px}` و`a:hover{text-decoration-thickness:2px}`)، `::selection`، شريط التمرير، `:focus-visible` العام، `letter-spacing:0`، `text-wrap`، وقفل التمرير `html:is(.is-menu-open,.is-searching),html:has(dialog[open]){overflow:hidden}`.
- **بدائية «سطر الكتابة»** بقائمة محدِّداتها الكاملة (القاعدة 0.2).
- إعادة الكتابة الكاملة تُسقط `--spring` (9 مواضع اليوم) و`.journey-enter{animation:none}`؛ الأخير يصير ملك C.
- الأصناف: `h1.is-long` `h1.is-xlong` · `.subtle` `.muted` `.eyebrow` `.mt` `.ltr` `.sr-only` `.full` `.skip` `.glyph` · `kbd` `code` `pre[dir=ltr]` `bdi` · الأرقام: tabular على محدِّداتها، و**التتبّع السالب بقاعدة واحدة `[data-num]`** (لا قائمة أصناف: `.vn-tile strong` قد يحمل عربية).
- **نظام الحالة كاملًا (المواصفة §8):** `.badge` وقيمها الثمانون في المجموعات الخمس، `.vn-flag` `.ex-flag` `.pill` `.status-dot` (الشكل؛ موضعها عند B)، وخريطة `is-*` إلى الخاصيتين المحليتين `--c` و`--m` (يستهلكهما C وD وB رسمًا دون إعادة تعريف الألوان). علامة `--spark` تأخذ `var(--spark)` في المظهرين بلا استثناء.
- `@media print`: إخفاء الغلاف و`.sig-aurora`، وفرض قيم الورق.

**الأصناف المغطاة:** المذكورة أعلاه فقط.

**القبول:**
- كتلتا الورق متطابقتان حرفيًا (فحص نصي).
- سكربت التباين (الحزمة V) يمر على كل أزواج المواصفة §2.3.
- صفر `letter-spacing` غير صفري خارج `[data-num]` و`:lang(en)` بأحجام العرض.
- لا قاعدة خارج `@layer` في الملف عدا `@font-face`.
- مع `forced-colors` المحاكاة: علامات الحالة مرئية.
- الخط يُحمَّل فعلًا: في المتصفح `document.fonts.check('700 16px Alexandria')` صحيح، والأرقام تأتي من ملف latin.
- `badge subtle` و`badge` المجردة متمايزتان (اختبار `resourcing` يبقى أخضر لأنه يطابق الترميز).
- لا `http(s)://` عدا `xmlns` داخل `data:`.

**التبعيات:** لا شيء. **يسلّم أولًا** (ساعتان لكتلة الرموز، ثم يومان للباقي).

---

### الحزمة B — الغلاف والتنقل

**الملفات:** `hr-design.css`، `app.mjs` ([ملحق] المواضع التسعة المسمّاة فقط)، `hr-design.mjs` ([ملحق] الإضافات الثلاث المسمّاة فقط).

**النطاق في `hr-design.css`:**
- **كتلة مجمَّدة في رأس الملف لا تُمس حرفيًا ولا يُضاف داخلها شيء:** `@media(prefers-reduced-motion:reduce)` (بلا مسافات)، `@keyframes rq-beam`، `@keyframes rq-sheen`. **قاتل الحركة يُكتب في كتلة ثانية تحتها** داخل `@layer kill`: `@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important; transition-duration:.01ms!important}}`، **ويُكرَّر بالمضمون نفسه تحت `:root[data-motion=off]`**. مضمون الـkeyframes يُنسَّق مع E (مسحة خط `rq-search`، ومسح مؤشر التحميل) ويكتبه B؛ E مستهلك لهما. **لا منسّق آلي على هذا الملف.**
- الغلاف: `.shell` `.stage` `.page` (بلا `overflow`، القاعدة 0.9) `.topbar` `.topbar-title` (**مخفي عند ≥ 1024**) `.top-btn` `.top-avatar` `.top-index-label` `.top-search` `.top-search-text` (**ينطوي إلى أيقونة 44px بين 1024 و1279**) `.brand` (`a.brand{padding:16px}` و`:focus-visible{outline-offset:0}`) `.brand-svg` `.avatar` `.sig-theme` `.sig-siblings*` `.sig-tabs` (مكتب: داخل صف الشريط؛ جوال: شريط سفلي مسطح) `.nav-count` (+`.is-late`، ويرسم علامته) `html.is-kbd`.
- مشهد الفهرس: `.sidebar` (**≥ 1024 `background:transparent` مع `html.is-menu-open :is(.stage,.sig-tabs){visibility:hidden}`** حتى تُرى الفاصلة العملاقة؛ دونها `--canvas` معتم) `.side-head` (عدا `::before`) `.side-title` (+`::before{content:"INDEX" / ""}`) `.side-done` `.side-profile` `.side-account` `.side-note` `.status-dot` (موضعها فقط) `.side-scrim` `.nav-search-label` `.nav-search` (المقاس والموضع) `.nav` `.hr-nav-group` `.hr-nav-label` (رقم الفهرس بـ`counter-increment` **حصرًا**، وشَرطته 32×4 بلون `--horizon`) `.hr-nav-total` `.hr-nav-rows` `.hr-nav-section` `.hr-nav-sublabel` `.nav-row` `.nav-icon` `.nav-label` `.nav-value` `.tint-*` (13 ⇒ `currentColor`) `.active` `.is-destructive` `.sig-recent`. **حالة الترشيح:** `.nav :is(a,.hr-nav-section,.hr-nav-group)[hidden]{display:none}`، و`.sidebar:has(#nav-search:not(:placeholder-shown)) :is(.hr-nav-total,.sig-recent){display:none}`.
- لوحة الأوامر: `.sig-cmd` `.sig-cmd-box` `.sig-cmd-input` (المقاس) `.sig-cmd-cancel` `.sig-cmd-list` `.sig-cmd-group` `.sig-cmd-rows` `.sig-cmd-item` (`b` بحجم 13px) `.is-active` `.sig-cmd-empty` `.sig-cmd-foot`. تحت 760: `margin-block-start:calc(var(--safe-t) + 8px)` وارتفاع القائمة الأقصى `calc(100dvh - 64px - var(--safe-t))`.
- رأس الصفحة: `.page-head` (**بلا `::after`**) و`[data-sig-group]` `.page-actions` `.department-back`، ومتغيرات الطبقة، وصيغة الرئيسية/البوابة حيث `h1` تسمية.
- طبقات z-index كما في العقد؛ `scroll-padding-block`.

**النطاق في `app.mjs` — [ملحق] تسعة تعديلات مسمّاة، ولا عاشر.** الاثنان أدناه هما B-1 وB-2؛ والسبعة الباقية (B-3 الإقلاع بافتراضي `dark` و`data-design`، B-4 تطبيق `me.appearance` عند وصول الحمولة، B-5 زر الوضع يحفظ على الخادم ويحترم القفل، B-6 تطبيق `saved.appearance` بعد الحفظ، B-7 المعاينة الحية، B-8 مدخل `appearance` في `nav.push`، B-9 نصوص `shell()` الثلاثة) نصوصها الحرفية في الملحق §هـ.6:
1. داخل قالب `shell()`: لفّ `${brandLogo}` في `a.brand[href="#home"]` داخل `header.topbar`، وإضافة `<span class="top-index-label">${tr('الفهرس','Index')}</span>` داخل `button.top-avatar`.
2. داخل `.then` القائم لطلب `/inbox/count` (السطر ~207): إسناد واحد `document.documentElement.dataset.inbox=String(c.total);`. لا يُمس `.catch`. السبب: `.nav-count` يُحذف قبل وصول العدّ ولا يُضاف إلا إذا `total>0`، فغيابه يحتمل صفرًا أو انتظارًا أو فشلًا، والحلقة كانت ستدّعي «اكتمل» في الثلاث. (آمن في صندوق `vm` قراءةً: `tests/ui-race.test.mjs` يعرّف `documentElement:{dataset:{}}`؛ **يُشغَّل الاختبار بعد التعديل**.)

**لا شيء غير ذلك:** لا `import`، لا استدعاء جديد، لا مساس بقالب تفاصيل الطلب ولا `loginView()` ولا `pageHead()`، وتبقى `<form id=` أول سمة و`data-id` تليها `data-version`، وكل `import` سطرًا واحدًا.

**النطاق في `hr-design.mjs`:** **[ملحق] ثلاث إضافات مسمّاة لمدخل `appearance` ولا رابعة** (في مصفوفة «حسابي» داخل `navGroups`، وفي المصفوفة الأولى من `allowed()`، و`appearance:['sliders','indigo']` في `navGlyphs` — الملحق §هـ.7). ما عدا ذلك لا تغيير: بنية `navGroups` ومخرجات `groupedNavigation()` و`workFrames` و`departmentDirectory` تبقى كما هي (`class="department-card"` صنف وحيد). أرقام الفهرس بعدّاد CSS؛ **لا سمة `data-index`** (خطاف قائم للوحة الأوامر).

**القبول:**
- `tests/ui-race.test.mjs` و`tests/dialog-races.test.mjs` و`tests/departments.test.mjs` و`tests/service-catalog.test.mjs` و`tests/motion-cards.test.mjs` (سلاسل `hr-design.css` الثلاث) خضراء.
- حساب كامل الصلاحيات عند 1024 و1280 و1440: لا فيضان في الشريط ولا في `sig-siblings`. **[ملحق]** يُختبر بحسابين: الأدمن الأول، وحساب موظف واسع التصاريح (`hr` أو `manager`)؛ الأدمن محجوب عن نحو 30 مدخلًا بشرط `staff` في `nav.push`، فليس «كامل الصلاحيات» وحده.
- **[ملحق]** مشهد الفهرس يحمل حتى 114 مدخلًا و21 عنوانًا فرعيًا (≈ 143 سطرًا مقابل سعة 76): عمود العمل يتمرر (`overflow-y:auto; overscroll-behavior:contain` على `.sidebar`)، وعمود البيان لاصق، و`.side-done` ظاهر دائمًا، وآخر مدخل يُبلغ بالتمرير وبلوحة المفاتيح عند 1440×900.
- **[ملحق]** في `field`: أرضية بطل الرئيسية/البوابة فيروزية بحواف `--gutter` بلا تمرير أفقي عند 375 و1440، والنص فيها أسود (القاعدة في الملحق §د). `node --check app/static/app.mjs app/static/hr-design.mjs` و`node --test tests/ui-race.test.mjs tests/dialog-races.test.mjs tests/departments.test.mjs` بعد التعديلات المسمّاة.
- الفهرس حوار في كل المقاسات: `Esc` يغلق، التركيز يعود، `.stage` و`.sig-tabs` خاملتان (`inert`)؛ وعند ≥ 1024 الفاصلة العملاقة **مرئية فعلًا** خلف الفهرس.
- حساب كامل الصلاحيات عند 1024 بالضبط: البحث أيقونة، ولا `.topbar-title`، ولا فيضان.
- مع `html[data-motion=off]`: صفر حركة CSS. `grep -c` للسلاسل الثلاث المجمَّدة يبقى كما كان.
- 375px: لا تمرير أفقي؛ أهداف التبويب ≥ 48px؛ `sig-tabs` يختفي مع `html.is-kbd`.
- لا `backdrop-filter` ولا ظل؛ الشعار بلا hover ولا حركة، ومساحة أمانه 0.675× ارتفاعه خالية.
- الوصول لأي شاشة مدرجة بتفاعلين.

**التبعيات:** العقد 1 و2 و3. لا ينتظر أحدًا للبدء.

---

### الحزمة C — المكونات

**الملف:** `style.css` (الهدف ≤ 24KB).

**الأصناف المغطاة:** `.operations` `.panel` `.panel-head` `.panel-body` · `.vn-head` `.sig-more` · `.vn-board` `.vn-tiles` `.vn-tile` `.stats` `.stat` `.stat-label` `.stat-number` `.counts` `.hr-focus` `.figure` `.pt-tiles` (الشكل؛ موضعها عند E) `.pt-tile` `.acc-stats` · `.vn-grid` `.split` · `.vn-block` (وطيّ الفراغ بالمحدِّد `:not(:has(ul,ol,table,dl,.vn-tiles))`) · `.vn-group` `.vn-card` `.vn-code` `.vn-name` `.vn-flags` `.vn-body` (الملخص اللاصق عند `--stick-2` بارتفاع `--summary-h` ثابت؛ وشبكة الملخص من سطرين عند 375؛ وأفعال `.vn-body` بصيغة A2: الأول حبّة بحافة والبقية نصية) `.sig-filter` (المقاس واللصق عند `--stick-1`) `.vn-reqs` `.vn-req` `.vn-chips` · `.vn-alert` `.notice` `.error` · `.vn-pipeline` `.vn-step` `.vn-days` `.journey` `.journey-step` `.step-no` `.journey-path` `.journey-stop` `.ex-flow` `.ex-step` `.ex-arrow` · `.vn-bars` `.vn-bar` `.ex-bar` · `.btn` `.primary` `.dark` `.outline` `.danger` `.small` `.text-button` **والقائمة البيضاء للتعبئة داخل `@layer fill`** (المواصفة §6.5، ومنها `.journey-cta` وبديل `claim`/`complete` حين يغيب `approve`/`submit`) · `dialog#dialog` `.drawer` `.launcher` `.dialog-head` (عدا `::before`) — **نافذة وسطية بلا انحناء من 760، وصفيحة بزاويتين علويتين تحتها** — `.dialog-body` `.sheet-close` `.form-actions` `#dialog-error` · `#main.journey-enter` (ثلاث قيم بحسب `data-tier`) · `.journey-dialog` `.journey-tool` `#journey-search` (المقاس) `.journey-results` `.journey-help` `.journey-empty` `.journey-tour-counter` `.journey-tour-copy` `.journey-tour-controls` والمخفيات الثلاث · `#toast` · `.empty` (التخطيط والنص ونوعاه بالمسار من العقد 2؛ **لا** `.empty-symbol`) و`#main > .error:only-child` بصيغتها · `.timeline` `.timeline-item` `details.sig-older` `.file` `.ai-output`.

**القبول:**
- ≤ 1 زر ممتلئ ظاهر في أي شاشة (سكربت V)؛ لا محدِّد `:first-child` يمنح تعبئة.
- الحوار بحافة `--line-strong` و`::backdrop` بـ`--scrim`؛ لا `opacity` على `#app`.
- `#dialog-error` يظهر أعلى الصفيحة؛ `tests/dialog-races` أخضر.
- `summary` اللاصق لا يتراكب مع `th` ولا مع المرشّح (سلّم `--stick-*` من A)، ولا يترك فراغًا فوقه في شاشة بلا مرشّح.
- زر الحضور `[data-operation=punch_in]` ممتلئ فعلًا رغم أصنافه `btn outline small` وموضعه داخل `.vn-head .operation-actions` (اختبار الطبقات).
- كل فعل ≥ 44px هدفًا؛ `:focus-visible` مرئي على كل متغيرات `.btn` في المظهرين.
- 375px: لا فيضان في `vn-head` (الأفعال تلتف، و`sig-more` يحوي الزائد)، والمسارات رأسية.
- لا ظل ولا خلفية ولا انحناء خارج الاستثناءات المسماة.

**التبعيات:** العقد 1 (الرموز و`--stick-*`)، وخاصيتا `--c/--m` من A، والعقد 2 (قائمة الفراغ «الجيد» و`data-tier`)، والعقد 3 (`sig-more`، `sig-older`)، والعقد 5.

---

### الحزمة D — أسطح البيانات وعائلات الشاشات

**الملف:** `journey.css` (الهدف ≤ 30KB).

**الأصناف المغطاة:**
- القوائم: `.vn-list` وورثتها `.pt-rows` `.pt-row` `.pt-row-main` `.pt-due` `.ex-rows` `.ex-row` `.notification-row` `.req-card` `.task-list` `.task-row` `.task-row-end` · **شاشة `#projects` الحية** (المواصفة §6.13): `.project-card` `.project-top` `.task.open|.completed` `.task-info` `.square` (مربع 22px، و«✓» مخفي بـ`font-size:0`) `.service-row` `.compact-services` `.requirements-list` · **أفعال الصفوف:** `.operation-actions` داخل `li`/`td`/`.vn-body`، `.acc-actions`.
- الجداول: `.table-wrap` (+`.is-wide`) `table` `th` `td` `tfoot` `tr.is-inactive` `.operations-table` `.ex-table` `#accounts-table` `table[data-cols]` `td[data-label]`، والرأس اللاصق (`--stick-2`، وداخل البطاقة `--stick-3`، و**`#dialog th{top:0}` مع `#dialog .table-wrap{overflow-x:auto}` دائمًا**)، والكثافة، و**صيغة السجل تحت 760** (عنوان 16/700، ثم أزواج «`data-label`: قيمة» ملتفة تفصلها علامة، ثم خلية الفعل بعرض كامل؛ بلا قصّ).
- النماذج: `label` `input` `select` (السهم `var(--select-arrow)`) `textarea` `.required` `small.subtle` (التلميح) `.form-grid` `.full` `.filters` (لاصقة عند `--stick-1`) `.check` `.checks` `.checks-field` `.builder-field` `.rows-field` `.rows-remove` `[data-action=row-add]`. **«سطر الكتابة»: المقاس والموضع فقط** لمحدِّدات D المسماة في القاعدة 0.2؛ البدائية عند A. **`.password-form` ليست هنا:** مالكها E وحده.
- التفاصيل: `.vn-facts` `.detail-data` `.details-grid` (ترتيب A5 بـ`order`؛ **اللصق على `section.panel:has([data-transition])` وحده** لا على العمود؛ وشريط القرار اللاصق على الجوال بصفوفه: `danger` أعلى، ثم الممتلئ + أول `outline`، ثم بقية `outline` ملتفة، `max-height:40dvh; overflow-y:auto`) `.sig-arc`.
- العائلات: `rq-*` كلها **عدا** `.rq-hero` `.rq-hero-copy` `.rq-kicker` `.rq-search` `.rq-search-icon` (لـE) — مع بقاء `.rq-row` صنفًا وحيدًا وتحييد `tone-1…8` وإخفاء رموز اليونيكود · `rq-card` `rq-enter` `rq-shown` `is-live` (الانتقالات فقط؛ الـkeyframes عند B) · الإدارات: `.department-*` **عدا `.department-back`** (B) `.service-grid` `.service` `.service-icon` `.more` · `wk-*` · `org-*` · `acc-*` · `.ex-grid` `.ex-attention` `.ex-note` · `.pt-grid` `.pt-quicks` `.pt-quick` `.pt-label` `.pt-chips` `.pt-chip` `.pt-empty` `.wk-empty` `.rq-empty` · `.journey-heading` · الرئيسية القديمة `.hr-hero` `.hr-hero-copy` `.departments-entry`.

**القبول:**
- `th` يلتصق فعلًا بالصفحة عند ≥ 1024 (إصلاح `overflow-x:auto` القائم)، وداخل `vn-card[open]` تحت الملخص؛ وعند `.is-wide` يعود التمرير.
- الدفتر عند 1440: مسيّر الرواتب (10 أعمدة) بلا تمرير أفقي.
- 375px على **كل** مسار: لا فيضان أفقي للصفحة؛ `rows-field` كتل رأسية بتسمية مرئية دائمة (لا `placeholder`)؛ جداول ≤ 6 أعمدة سجلات من سطرين؛ الأعرض بعمود أول لاصق.
- مؤشر الصف ≥ 3:1 بلا غسلة؛ التلميحات ظاهرة دائمًا؛ مربع الاختيار المحدَّد بتعبئة `--ink-1` لا فيروزي.
- الأعمدة الرقمية بمحاذاة طبيعية (لا `text-align:end`)، وتُفحص تراصف الخانات العشرية في `payroll` و`finance`.
- تفاصيل الطلب: ترتيب Tab منطقي رغم `order`؛ شريط القرار يختفي مع `html.is-kbd`؛ «رفض» بعيد عن الإبهام.
- `tests/company-scale` و`tests/structured-fields` و`tests/workspace` و`tests/procurement` خضراء (لا تغيير ترميز، فالمتوقع بقاؤها).

**التبعيات:** العقد 1 و3 و5، و`--c/--m` من A، و`--stick-*` و`--select-arrow` من A.

---

### الحزمة E — الحلقة، والدخول، وأبطال المسرح

**الملفات:** `athar.css` (≤ 14KB)، `motion-cards.mjs` (الإضافة ≤ 10KB).

**النطاق في `motion-cards.mjs`:** العقد 4 والمواصفة §4: `ringField` و`commaField` (دالتان خالصتان)، و`mountBackdrop` (الشبكة المقنَّعة، قانون الحبر، الفجوة، المرآة، مستطيلات الحظر، الأقمار، الافتتاح مرة في الجلسة، «الحبر يجف»، السكون بدوران درجة/ثانية، المؤشر في الدخول فقط، الحاكم على فاصل rAF، سلّم الخمول، `canvas.width=0` خارج المسرح، الإطار الثابت عند `reduced`، قراءة الألوان من الرموز، **والهندسة من وسيط `setScene` دائمًا**؛ `mirror` يعكس علم العقد واتجاه `t` وجهة تلاشي الأفق؛ `pending:null` بلا أقمار ولا إغلاق؛ الإطار الثابت يُعاد عند `setData` وبمؤقت 60s بلا rAF). **ممنوع** لمس `document`/`window` عند مستوى الوحدة، وممنوع تغيير `mountCards`/`prefersReducedMotion`.

**النطاق في `athar.css`:**
- `.sig-aurora` لكل مشهد (`login`/`index`: `fixed; inset:0` · `home`: `absolute` بارتفاع `.page-head` يتمرر مع الصفحة · `off`: `display:none`)، `z-index:var(--z-canvas)`، `pointer-events:none`. قيم `--ring-x/y/r` **للدخول وحده** لكل مقاس: مكتب ≥ 1024 (عمودان)، **لوحي 760–1023 تركيب الجوال مع `--ring-r:min(190px,28vw)`**، جوال، و**`html[dir=ltr]{--ring-x:66vw}`**، و`@media (max-height:600px)` بلا حلقة.
- الدخول: `.login` `.login-story` `.story-copy` (`.eyebrow` فيها **تسمية عربية 13/700 بتتبّع صفر**) `.hr-values` `.hr-frames` `.hr-frame*` `.hr-orbit` `.hr-city` `.hr-beams` `.login-form` `.login-masthead` `.login-wordmark` `.login-card` (`.eyebrow` فيها **القفل اللاتيني** 12/700 `+.08em`، ظاهر) `.login-mobile-tagline` (**حذف `::after` الذي يكتب «3,6T»**) `.login-note` `.login-footer` (**13px**) `.password-gate` **`.password-form`/`#password-form` (المالك الوحيد)** `.athar-scene` `.athar-motion`، ومقاسات `#login-form` و`#password-form` فوق بدائية سطر الكتابة، وطيّ OTP، و`#login-error`.
- لحظة العبور: `html.is-threshold::before/::after`؛ مع إيقاف الحركة إطار ساكن 400ms بقطع (بلا `transition`، فلا يمسه القاتل).
- أبطال المسرح: `.sig-date` `.sig-greeting` `.sig-census` `.sig-eye` (مربع `2.24 × --hero-ring-r`؛ هو مرجع قياس F) وتركيب بطل الجوال (صف الحلقة + التاريخ + الجملة، ثم التحية بعرض كامل؛ `min-height`) · `.journey-hero` `.journey-greeting` `.journey-copy` `.journey-cta` (الموضع فقط؛ التعبئة عند C) · `.rq-hero` `.rq-hero-copy` `.rq-kicker` `.rq-search` `.rq-search-icon` · `.ex-hero` `.ex-hero-copy` `.ex-figures` `.ex-figure` `.ex-figure-label` · `.pt-tiles` موضعها تحت البطل.
- المشتقات الساكنة: **`.page-head::after`** (الأفق، شريط الدفتر، و**شريط 6px في المسارات الحساسة بدل الإخفاء**، بقائمة العقد 2 وبصيغة `:is()`) · `.empty-symbol` (ممتلئة/مفرّغة بحسب قائمة العقد 2) · `.loading` (يستهلك `@keyframes rq-sheen` من B) · `.rq-search` عند التركيز (يستهلك `rq-beam` من B) · `.dialog-head::before` و`.side-head::before` (مقبض حامل البطاقة؛ استثناء مسمّى في القاعدة 0.2).

**القبول:**
- `tests/motion-cards.test.mjs` أخضر بلا تعديل (العقد الحرفي: التأخيرات `0/34/68ms`، `--mx/--my/--tilt-*`، التنظيف، `mountCards(null)`).
- `node --check app/static/motion-cards.mjs`، ولا `eval(`.
- خارج المسرح: `canvas.width===0` وصفر rAF. مع `reduced-motion`/`36t-motion-paused`/`document.hidden`: صفر rAF وإطار ثابت.
- لا علامة خلف أي حقل أو نص < 40px أو داخل مساحة أمان الشعار عند 1440×900 و1280×720 و375×812 و820×1180، **وبالإنجليزية `dir=ltr`**، ومع `html.is-kbd` على الجوال (`dim(0)`)؛ خطأ الدخول وتوسّع OTP لا يغيّران ذلك.
- صفر استجابة لأي `keydown/input`. الحلقة تخفت عند حقل كلمة المرور.
- ميزانية الإطار ≤ 3.5ms مكتب و≤ 6ms جوال (قياس يدوي في لوحة الأداء؛ تُذكر الأرقام الفعلية في التقرير).
- فشل `getContext` (محاكى) ⇒ الدخول يعمل كاملًا.
- `.sig-aurora{display:none}` لا يُفقد معلومة.
- العلامات بلا دوران، والإطار الثابت شبكة متعامدة 1:1.13.

**التبعيات:** العقد 1 و2 و4 و5، و**`@keyframes rq-sheen` و`rq-beam` من B** (يكتب E الاستهلاك ضد الاسمين ولا ينتظر المضمون). لا ينتظر F: يختبر المحرك بصفحة HTML مؤقتة في `work/design-verify/` (لا تُضاف إلى `app/static`).

---

### الحزمة F — سلوك الغلاف و`index.html`

**الملفات:** `signature.mjs`، `index.html`، **[ملحق] `theme-boot.js` (جديد؛ نصه الكامل في الملحق §ب.2)**.

**[ملحق] تصحيحات وإضافات (الملحق §و.2–و.3):** `<script src="/theme-boot.js"></script>` أول سكربت في `<head>` وقبل روابط CSS، كلاسيكي حاجب · وسم `theme-color` واحد بلا `media` و`<meta name="color-scheme" content="dark">` · `MutationObserver` على `<html>` لـ`data-theme` و`data-design` و`data-scene` يعيد قراءة ألوان الحلقة ويكتب `theme-color` من `--canvas` المحسوبة · `--ring-live:0` ⇒ `setScene('off')` في مشهد `home` · لا فرع في JS يذكر اسم تصميم · `tabNames` توحَّد مع عناوين `nav.push` الحالية («الرئيسية»، «ملخصي») · `sig-siblings` بلا `a.active` (`#search`، `#request/<id>`) يخفي محتواه ويحجز ارتفاعه · سطر «بحث شامل عن …» في لوحة الأوامر بعد التحقق المذكور في الملحق · `node --check app/static/theme-boot.js` يدويًا.

**النطاق في `index.html`:** إبقاء `lang="ar"` و`dir="rtl"`؛ **[ملحق] `theme-boot.js` قبل** روابط CSS الخمسة بالترتيب المعتمد؛ `preload` لملفَّي `alexandria-arabic-400/700` مع `crossorigin`؛ **[ملحق] وسم `theme-color` واحد `#000000` بلا `media`** (كان وسمين بحسب إعداد الجهاز)؛ `<canvas class="sig-aurora" aria-hidden="true"></canvas>` أول ابن لـ`body` قبل `.skip`؛ لا سكربت جديد **عدا `theme-boot.js`**.

**النطاق في `signature.mjs`:**
- معالج `hashchange` متزامن + إقلاع: `data-tier` و`data-route` و`data-scene` من الخريطة الثابتة (العقد 2)؛ و`data-motion` و`data-density` (الأخيرة عند اختيار صريح فقط)؛ وحذف `data-inbox` عند ظهور `.login`.
- الفهرس حوارًا في كل المقاسات (`role/aria-modal/Esc/إعادة التركيز`، و**`inert` على `.stage` و`nav.sig-tabs` معًا**)؛ فتح كل `details.hr-nav-group` عند ≥ 1024؛ بقاء منطق السحب للجوال (معطَّل للحوار من 760).
- الحقن (العقد 3): `sig-siblings` (مع طيّ بقياس `ResizeObserver`)، `sig-theme`، `sig-recent` (لقطة عند بدء الجلسة)، زرّا الحركة والكثافة، **`data-sig-group`**، `is-long/is-xlong`، `sig-more`، **`sig-older`**، `data-label`/`data-cols`/`aria-label` (وداخل `template.content`)، `.is-wide`، `sig-arc`، **`data-num`** (على عناصر قائمة العدّ فقط، بالتعبير النمطي في العقد 3)، وعناصر بطل الرئيسية (التحية **بالاسم الأول**: أول كلمة من نص `.side-profile strong`، والتاريخان عبر `Intl` بتوقيت `Asia/Riyadh`، و`sig-census`/`sig-eye` من **`html[data-inbox]`** و`.nav-count.is-late`؛ مع غياب السمة: العين «—» والجملة فارغة).
- دورة حياة الحلقة: `mountBackdrop` مرة عند الإقلاع؛ `setScene(name,{cx,cy,R,mirror})` من `data-scene` — **الدخول** من `--ring-*` بـ`getComputedStyle`، **والرئيسية بقياس صندوق `a.sig-eye`** مرة عند الرسم ومع `ResizeObserver` (الاستثناء الثاني المسمّى في المواصفة §4.4)؛ `setData` من `data-inbox` (أو `null`) و`.is-late` والساعة؛ `setExclusions` (عمود النص/النموذج، صندوق `h1` الدخول بعد `document.fonts.ready` ومع `ResizeObserver`، مساحة أمان الشعار)؛ `dim(.35)` عند `focusin` على `input[name=password]`؛ **`dim(0)` ما دامت `html.is-kbd` في الدخول**؛ `closed` عند `submit` على `#login-form`؛ مراقبة `#login-error`؛ `.is-threshold` عند ظهور `.shell` بعد `.login` (**وتُعرض ساكنةً مع إيقاف الحركة**)؛ `pulse()` عند `#toast.show` في مشهد حي؛ `pause()` عند `focusin` على الجوال و`document.hidden`؛ **`resume()` عند `setData` بقيمة مختلفة، أو `visibilitychange`، أو `pointerdown` واحد (`{passive:true, once:true}`) يُسجَّل عند كل تجميد في مشاهد المسرح فقط.**
- `html.is-kbd` من `visualViewport`؛ تحديث `theme-color` عند تغيّر `data-theme`.
- الاختصار `⌘K`/`Ctrl+K` فقط؛ يُزال اختصار «/» القائم (`signature.mjs:223`).
- العدّ التصاعدي: ≤ 400ms، مرة لكل مسار في الجلسة، معطّل في `ledger` والمسارات الحساسة ومع `data-motion=off` و`reduced-motion`.
- **لا** تقسيم « · »، **لا** وسم `is-num`، **لا** عدّ DOM للشاشات، **لا** `innerHTML` فيه `style=`.

**القبول:**
- `tests/static-modules.test.mjs` أخضر (كل `href/src/import` مخدوم).
- `node --check`؛ `scripts/check.mjs` أخضر (`lang`/`dir`، لا `eval(`).
- `enhance()` متكررة الأمان: استدعاؤها عشر مرات متتالية لا يكرر عنصرًا ولا يعيد جدولة نفسها بلا نهاية (المراقب على `#app` بـ`subtree`).
- لا قفز تخطيط بعد الرسم: `data-tier` مضبوط قبل أول رسم للمسار، وارتفاع `sig-siblings` محجوز.
- مع `36t-enhance-off=1` تعمل المنصة كاملة بلا محقونات.
- لا مستمع `scroll`/`pointermove` خارج مشهد الدخول. المستمع الوحيد الإضافي المسموح: `pointerdown` السلبي لمرة واحدة للاستئناف.
- بديل المحرك المؤقت دالة داخل `signature.mjs`، لا ملف.
- قبل وصول `/inbox/count` وعند فشله: لا «لا شيء ينتظر قرارك الآن.» ولا إغلاق للحلقة.
- `data-num` لا تقع على «يوم 25» ولا على أي نص فيه حرف عربي.
- النصوص المحقونة بـ`textContent` وثنائية اللغة بحسب `documentElement.lang`.

**التبعيات:** العقد 2 و3 و4. يعمل ضد بديل المحرك حتى تسليم E.

---

### الحزمة G — ميزة «المظهر» **[ملحق]**

**الملفات:** `app/migrations/094-appearance.sql`، `app/preferences.mjs`، `app/static/appearance-ui.mjs`، `tests/preferences.test.mjs`، سطر التسجيل في `app/static/operations.mjs`، وثلاثة مواضع مسمّاة في `app/server.mjs`.

**النطاق:** كله في الملحق §هـ حرفيًا: الجدولان `appearance_settings` و`user_appearance` (هـ.1)؛ تواقيع `companyAppearance` `effectiveAppearance` `appearanceView` `setPersonalAppearance` `setCompanyAppearance` (هـ.2)؛ المسارات `GET /api/appearance` و`POST /api/account/appearance` و`POST /api/admin/appearance` (هـ.3)؛ الحقل `appearance:{design,theme,locked,source}` في `userView` (هـ.4)؛ الشاشة بعقد `{title,description,load,render,form}` ومعايناتها SVG بسمات عرض فقط وبأصناف قائمة فقط (هـ.5)؛ التسجيل والقائمة البيضاء (هـ.8).

**القبول:** `tests/preferences.test.mjs` بحالاته في الملحق §هـ.9 أخضر · `npm test` و`npm run check` خضراوان قبل وبعد · `tests/static-modules.test.mjs` أخضر (يلتقط `appearance-ui.mjs`؛ **ولا يلتقط `theme-boot.js`** لأن تعبيره النمطي `.mjs|css` فقط، فاختبار G هو الذي يتحقق من أن `GET /theme-boot.js` يعيد 200) · لا `style=` ولا `<style` ولا `<script` في ناتج `render` · لا اسم عملية يطابق تعبير `destructive` في `app.mjs:267` (وفيه `void`) · لا لمس لأي اختبار قائم ولا لأي هجرة مطبَّقة ولا لـ`.env` ولا لـ`work/`.

**التبعيات:** لا ينتظر أحدًا. يسلّم شكل الحمولة إلى B، ومدخل القائمة البيضاء لـ`theme-boot.js` إلى F. ترتيب الدمج: G ← B ← F.

---

## 3. التبعيات والتسلسل

```
اليوم 0   تجميد العقود الخمسة (الستة معًا، نصف يوم)
          A يسلّم كتلة الرموز في signature.css خلال ساعتين
الأيام 1–5  B · C · D · E · F بالتوازي الكامل، وA يكمل الأساس ونظام الحالة ثم ينتقل إلى V
اليوم 3   نقطة دمج أولى: الخمسة ملفات + index.html على الخادم المؤقت (V)؛ جولة 375 و1440 على الشاشات العشر
الأيام 6–7  الدمج الكامل، جولة كل المسارات، إصلاحات داخل حدود الملكية
اليوم 8+  الاختبارات البشرية (المسح، النموذج، أضعف شاشة، العربية بحجم العرض)
```

| الحزمة | تحتاج من | تسلّم إلى |
|---|---|---|
| A | — | الجميع (سطر `@layer`، الرموز، `--c/--m`، `--stick-*`، `--select-arrow`، بدائية سطر الكتابة) |
| B | العقد 1–3 و5 | F (مواضع الحقن، و`data-inbox`)، **E (`@keyframes rq-sheen` و`rq-beam`)**، الجميع (الهيكل، وطبقة `kill`) |
| C | A (**`--stick-*`**، `--c/--m`)، العقد 2 و3 و5 | E (`.journey-cta` التعبئة، و`.pt-tiles` الشكل)، الجميع (طبقة `fill`) |
| D | A (**`--stick-*`**، `--select-arrow`، `--c/--m`)، العقد 3 و5 | — |
| E | العقد 1، 2، 4، 5؛ **B (`rq-sheen`، `rq-beam`)**؛ C (شكل `.pt-tiles`، تعبئة `.journey-cta`) | F (المحرك) |
| F | العقد 2–4، بديل المحرك (داخل `signature.mjs`)، B (`data-inbox` في `app.mjs`) | A/B/C/D/E (العناصر والسمات المحقونة) |
| G **[ملحق]** | العقد السادس (الملحق §هـ) | B (شكل `me.appearance` و`{appearance}` في رد الحفظ)، F (مدخل `theme-boot.js` في القائمة البيضاء) |
| V | A مجمَّدة | الجميع (التقارير) |

**قاعدة فض التعارض:** إن ظهر محدِّد في ملفين، يبقى في ملف مالكه بحسب §2 والقاعدة 0.2 ويُحذف من الآخر. إن احتاج مكوّن رمزًا جديدًا، يضيفه A وحده. إن تعارضت قاعدتان من حزمتين، يُحسم بترتيب الطبقات لا برفع النوعية ولا بـ`!important`.

---

## 4. الحزمة V — التحقق

### 4.1 قاعدة تحقق مصطنعة وخادم مؤقت على منفذ احتياطي

المبادئ: **لا تُلمس `work/local.sqlite`، ولا يُقرأ `.env`** (يُستعمل `createApp(db)` مباشرة؛ `npm start` هو الذي يحمّل `.env` فلا يُستعمل). القاعدة في مجلد مؤقت يُحذف بعد الجولة. كلمة المرور عشوائية وتُكتب في ملف بصلاحية `600` داخل المجلد نفسه. الاستماع على `127.0.0.1` فقط.

ملف مؤقت `work/design-verify/verify-server.mjs` (خارج `app/` و`tests/`، ولا يُخدَم). **غير مجرَّب؛ ترتيب سكربتات البذر مأخوذ من README وSTATUS، وأي خطوة تفشل تُسجَّل وتُتخطى:**

```js
// work/design-verify/verify-server.mjs — throwaway; run from the project root:
//   node work/design-verify/verify-server.mjs 3790
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../../app/db.mjs';
import { createApp } from '../../app/server.mjs';
import { installServiceCatalog } from '../../app/service-catalog.mjs';
import { seed } from '../../scripts/seed.mjs';
import { expandDemo, expandPeopleDemo, expandFinanceDemo } from '../../scripts/expand-demo.mjs';
import { seedHrDemo } from '../../scripts/seed-hr-demo.mjs';
import { seedFinanceDemo } from '../../scripts/seed-finance-demo.mjs';
import { seedOperationsDemo } from '../../scripts/seed-operations-demo.mjs';
import { seedPayrollDemo } from '../../scripts/seed-payroll-demo.mjs';
import { seedVendorsDemo } from '../../scripts/seed-vendors-demo.mjs';
import { setDemoPassword } from '../../scripts/set-demo-password.mjs';

if(process.env.NODE_ENV==='production') throw new Error('Verification only');
const port=Number(process.argv[2]??3790);
if(!Number.isInteger(port)||port<1024||port>65535||port===3600||port===3601) throw new Error('Pick a spare port');
const dir=resolve('work/design-verify/run');
rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true,mode:0o700});
const db=openDb(resolve(dir,'verify.sqlite'));
seed(db,randomBytes(24).toString('base64url'));
for(const [name,step] of Object.entries({expandDemo,expandPeopleDemo,expandFinanceDemo,installServiceCatalog,seedHrDemo,seedFinanceDemo,seedOperationsDemo,seedPayrollDemo,seedVendorsDemo}))
  try{step(db);console.log('ok',name);}catch(error){console.error('skipped',name,error.message);}
const password=randomBytes(12).toString('base64url');
setDemoPassword(db,password);                      // refuses any non-synthetic tenant
writeFileSync(resolve(dir,'access.json'),JSON.stringify({url:`http://127.0.0.1:${port}`,users:['employee','manager','hr','it','admin'],password}),{mode:0o600});
const app=createApp(db);app.requestTimeout=15000;app.headersTimeout=10000;
app.listen(port,'127.0.0.1',()=>console.log(`verify: http://127.0.0.1:${port} — credentials in ${dir}/access.json`));
const stop=()=>app.close(()=>{db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);});
setTimeout(stop,4*60*60*1000).unref();
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,stop);
```

تنبيهات: بعض سكربتات البذر تحرس نفسها عند التشغيل المباشر فقط، فاستيراد دوالها آمن؛ إن اشترط أحدها ترتيبًا آخر يُعدَّل الترتيب هنا لا في `scripts/`. عند الإيقاف يُحذف المجلد. لا تُنسخ كلمة المرور إلى أي مستند.

### 4.2 جولة الشاشات

لكل حساب من (`employee`، `manager`، `hr`، `admin`) وفي **أربع حالات**: 375×812 و1440×900 × المظهرين (يُبدَّل بزر الوضع؛ و`auto` يُختبر بمحاكاة `prefers-color-scheme`). **[ملحق]** تُعاد الجولة **للتصاميم الثلاثة** (`void` `field` `slate`) من شاشة «المظهر»: الشاشات العشر والدخول لكل تصميم × وضع، وكل المسارات لـ`void` كاملةً ولـ`field` و`slate` عند 375 و1440. ويُضاف: الحفظ من جهاز يظهر على جهاز ثانٍ بعد الدخول · قفل الأدمن الأول يعطّل زر الوضع وأزرار الاختيار · إغلاق حوار الاختيار بلا حفظ يعيد الشكل المحفوظ · مسح `localStorage` على جهاز فاتح الإعداد يعطي دخولًا أسود · دخول `field` فيروزي بلا وميض أسود بعد أول حفظ.

1. **الشاشات العشر + الدخول** (المواصفة §7.2): لقطة لكل حالة، ومقارنتها بالمواصفة بندًا بندًا.
2. **كل المسارات:** من وحدة التحكم في المتصفح (ليست خاضعة لـCSP الصفحة):
```js
const routes=[...new Set([...document.querySelectorAll('.nav a[href^="#"]')].map(a=>a.getAttribute('href')))];
const report=[];
for(const hash of routes){location.hash=hash;await new Promise(r=>setTimeout(r,900));
  report.push({hash,overflow:document.documentElement.scrollWidth>innerWidth,
    fills:[...document.querySelectorAll('#main .btn, #dialog .btn')].filter(b=>b.offsetParent&&getComputedStyle(b).backgroundColor!=='rgba(0, 0, 0, 0)').length,
    h1:document.querySelectorAll('#main h1').length,
    canvas:document.querySelector('.sig-aurora')?.width??0,tier:document.documentElement.dataset.tier});}
console.table(report.filter(r=>r.overflow||r.fills>1||r.h1!==1||(r.tier!=='stage'&&r.canvas!==0)));
```
   المتوقع: جدول فارغ. يُعاد عند 375 و1024 و1280 و1440.
3. **الحركة:** مع `prefers-reduced-motion` المحاكاة، ومع `36t-motion-paused`، ومع تبويب مخفي: لوحة الأداء لا تُظهر إطارات rAF.
4. **اختبار التوأم النصي:** إضافة `.sig-aurora{display:none}` من أدوات المطوّر؛ لا معلومة ولا فعل يُفقد في الدخول والرئيسية.
5. **لوحة المفاتيح:** Tab عبر الشريط، والفهرس، ولوحة الأوامر، وتفاصيل الطلب (ترتيب منطقي رغم `order`)، وحوار بنموذج؛ مؤشر التركيز مرئي في المظهرين.
6. **الصدق في البطل:** بقطع طلب `/inbox/count` من أدوات المطوّر (Block request URL): العين «—»، ولا جملة، والحلقة بفجوتها. وبإبطائه: الحالة نفسها حتى يصل.
7. **الدخول بالإنجليزية (`dir=ltr`)**، وعلى لوحي 820×1180، وعرضي قصير 812×375، ومع لوحة المفاتيح على الجوال: لا علامة خلف حقل.
8. **مشهد الفهرس ≥ 1024:** الفاصلة العملاقة مرئية؛ Tab لا يصل إلى `.sig-tabs`.
9. **سلّم اللصق:** شاشة فيها مرشّح وبطاقة مفتوحة وجدول (مثل `payroll`)، وأخرى بلا مرشّح: لا تراكب ولا فراغ.
10. **`forced-colors`** (محاكاة Chromium) و**`prefers-contrast:more`** في المظهرين وفي الدخول.
11. **العربية بحجم العرض:** الدخول عند 1440 و375؛ وعنوان طويل («مسيّر رواتب سبتمبر 2026») في `payroll`: لا قصّ ولا كسر داخل كلمة.

### 4.3 الفحوص الآلية (سكربتات مؤقتة في `work/design-verify/`، لا تُضاف إلى `tests/`)

| الفحص | الطريقة |
|---|---|
| التباين AA | **[ملحق]** `node work/design-verify/contrast-designs.mjs` (موجود ومشغَّل: أراضي `field`/`slate` الأربع + الفراغ والورق مرجعًا؛ يخرج برمز 1 عند أي سقوط) — ويُستكمل بـ: سكربت Node بصيغة WCAG على أزواج المواصفة §2.3 مقروءةً من `signature.css`؛ يفشل عند أي نص < 4.5 أو حد تحكم < 3. **يشمل:** علامة `--spark` وسهم `--select-arrow` و«تعزية» في المظهرين، وعلامات حلقة الورق (≥ 3)، وكتل التباين الأعلى |
| تطابق كتلتي الورق **وتوأمَي `field` الفاتح وتوأمَي `slate` الفاتح [ملحق]** | مقارنة نصية بعد إزالة الفراغات **والتعليقات** (الكتلتان في المواصفة تختلفان في التعليقات والتفاف الأسطر فقط) |
| المحظورات في CSS | `grep -nE 'box-shadow|backdrop-filter|(^|[^-])gradient\(' app/static/{signature,style,journey,athar,hr-design}.css` — المسموح فقط `linear-gradient` داخل `mask` و`--shadow-*:none` |
| `letter-spacing` | `grep -n 'letter-spacing'` ومراجعة كل موضع مقابل القائمة المسموحة |
| لا `style=` ولا موارد خارجية | `grep -nE 'style=|<style|https?://' app/static/signature.mjs app/static/motion-cards.mjs app/static/index.html` (المسموح: لا شيء) و`grep -n 'https\?://' app/static/*.css` (المسموح: `xmlns` داخل `data:` فقط) |
| السلاسل المجمَّدة | `grep -c` للثلاث في `hr-design.css`، قبل وبعد. **لا منسّق آلي على الملف** (القاعدة 0.10) |
| الطبقات | كل قاعدة في الملفات الخمسة داخل `@layer` عدا الكتلة المجمَّدة و`@font-face` و`@keyframes`؛ `grep -n '!important'` لا يُظهر إلا طبقة `kill` ومخفيات الجولة الثلاث؛ `grep -nE 'outline:(none\|0)'` فارغ |
| هندسة الشعار | مقارنة سلاسل `d=` في قناع `html.is-threshold::after` (`athar.css`) بمسارات `brand-logo.mjs` المجمَّد: مصدران لهندسة واحدة، فيُفحص تطابقهما |
| السمات المحجوزة | `grep -nE "dataset\.(group\|index) *=\|setAttribute\('data-(group\|index)'" app/static/signature.mjs` لا يُظهر كتابةً جديدة |
| الأصناف الوحيدة | `grep -n 'class="department-card"' app/static/hr-design.mjs` و`'class="rq-row"'` في `request-picker.mjs` بلا تغيير |
| الحجم | `wc -c` : CSS الكلي ≤ **101KB** ([ملحق] كان 95)؛ `motion-cards.mjs` ≤ 12.5KB |
| الفيروزي برمز واحد **[ملحق]** | `grep -c '#16A085' app/static/*.css` = 1 (في `signature.css`)، و`grep -n '16A085\|22,160,133' app/static/*.mjs app/static/theme-boot.js` فارغ |
| المحظورات في CSS — استثناء **[ملحق]** | `radial-gradient` داخل `mask` مسموح لقاعدة واحدة: `.sig-eye::before` تحت `[data-design=field]` في `athar.css` |
| مجموعة المشروع | `npm test` و`npm run check` **قبل أي تعديل** (خط الأساس، تُحفظ النتيجة) و**بعد كل دمج**. يجب أن تبقى خضراء خصوصًا: `static-modules` `motion-cards` `ui-race` `dialog-races` `departments` `service-catalog` `company-scale` `structured-fields` `workspace` `resourcing` `procurement` `ui-render` `dates` والـ23 اختبارًا التي تحظر `style=`/`<script` |

### 4.4 معايير القبول المشتركة لكل حزمة

- لا تمرير أفقي عند 375px على **كل** مسار، ولا عند 1024/1280/1440.
- تباين AA للنص (≥ 4.5) وحدود التحكم ومؤشرات التركيز (≥ 3)، في المظهرين.
- الاختبارات المسماة خضراء؛ `npm run check` أخضر.
- لا `style=`، لا `<style>`، لا `<script>` داخلي، لا عنوان خارجي.
- لا صنف أعيدت تسميته، ولا ملف ثابت جديد، ولا لمس للملفات المجمَّدة.
- كل هدف لمس ≥ 44px؛ لا قصّ بلا كشف؛ لا معلومة مخفية على الجوال.
- تقرير الحزمة يذكر: ما بُني، وما اختُبر فعلًا وبأي أمر ونتيجته، وما لم يُختبر، وكل حدّ معروف.

---

## 5. ما هو خارج هذه الخطة (لا يُدَّعى)

- أي تعديل على `*-ui.mjs`: الصف المنظَّم بدل « · »، صفحة السجل، صفحة التقرير، فعل أساسي لكل شاشة، قالب التعاميم الرباعي، توحيد التواريخ، زر «طلب إجازة» البارز.
- **[ملحق]** ~~إدراج الشاشات الـ64 الغائبة في `nav`~~ — أُغلق: التنقل أُعيد بناؤه خارج هذه الخطة (113 مدخلًا؛ `docs/implementation/handoff/navigation.md`).
- صفحات الطباعة `report-print.css` (مسار تالٍ ملزم قبل إعلان اكتمال الهوية).
- النسخة ثنائية اللون من الشعار (`brand-logo.mjs`)، وأوزان Alexandria الإضافية (`server.mjs`)، وتخزين `/fonts/` مؤقتًا.
- **[ملحق]** بنود المواصفة §12 كلها أُغلقت بالتفويض، **وشرط «لا بناء قبل توقيعه على البنود 1–9 و16» مستوفى به**؛ يبقى بيد المالك: تأكيد HEX الرسمي (سطر واحد)، وملف النمط المتجهي، وتفعيل ملفات الخط. النص الأصلي: كل ما ينتظر المالك في المواصفة §12؛ ولا بناء قبل توقيعه على البنود 1–9 و16 منها. كلٌّ منها رمز أو ثابت أو سطر واحد يُبدَّل دون إعادة تصميم، **عدا البند 3**: تبديل الأرضية إلى الفحمي كتلة رموز كاملة (مرفقة في المواصفة §12) — **[ملحق]** وقد صارت تصميمًا قائمًا بذاته (`slate`) يختاره المستخدم، لا بديلًا عن الفراغ.
