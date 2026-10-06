# 03 — خريطة الواجهة الحالية (عقد إعادة التصميم)

التاريخ: 2026-09-18 · قراءة فقط، لم يُعدَّل أي ملف تطبيق أو اختبار.
الغرض: أن يُستبدل **شكل** المنصة كاملًا دون كسر **عقدها**: أسماء الأصناف، ونقاط ربط JavaScript، وسياسة أمن المحتوى، والاختبارات.

المصادر المقروءة: `app/static/index.html`، `signature.css` (939 سطرًا، فيه كل التصميم)، `hr-design.css` (8 أسطر، حركة فقط)، `style.css` و`athar.css` و`journey.css` (سطر تعليق واحد لكل منها)، `signature.mjs`، `hr-design.mjs`، `app.mjs`، `motion-cards.mjs`، `athar.mjs`، `journey.mjs`، `operations.mjs`، `request-picker.mjs`، `brand-logo.mjs`، `report-print.css`، `app/server.mjs` (الأسطر 112–145)، `docs/implementation/handoff/apple-redesign.md`، ومجلد `tests/` (139 ملفًا).

---

## 0. أهم خمس حقائق قبل أي تصميم

1. **كل الشكل في ملف واحد:** `signature.css`. الشاشات (73 ملف `*-ui.mjs`، منها 104 وحدات مسجلة في `operationModules` وست شاشات تُرسم مباشرة: `portal` `work` `executive` `org` `service-benchmark` `integrations`) لا تحمل أي تنسيق؛ تكتب أصنافًا مشتركة فقط. تغيير `signature.css` يغيّر المنصة كلها.
2. **`#app` يُعاد رسمه بالكامل مع كل تنقل.** `render()` في `app.mjs` تستدعي `shell()` التي تكتب `root.innerHTML` من جديد (الشريط الجانبي والشريط العلوي و`#main`). أي عنصر حي (مثل `<canvas>`) داخل `#app` يموت ويولد مع كل شاشة. العناصر الدائمة تعيش **أشقاء لـ`#app` داخل `body`** (كما يفعل `#toast` و`#dialog` و`.sig-cmd` و`.journey-dialog`).
3. **`app.mjs` يُنفَّذ داخل صندوق `vm` في اختبارين** (`ui-race` و`dialog-races`) بعد حذف أسطر `import`، مع `document` وهمي فقير جدًا. أي استدعاء جديد في `app.mjs` لدالة مستوردة غير موجودة في الصندوق يكسر الاختبارين. لذلك **سلوك التصميم الجديد مكانه `signature.mjs`** (لا يلمسه أي اختبار)، لا `app.mjs`.
4. **لا ملف ثابت جديد دون تعديل `server.mjs`.** الخادم يخدم قائمة بيضاء حرفية، واختبار `static-modules` يفشل إن استُورد ملف غير مخدوم. المتاح للتقسيم: ستة ملفات CSS وعشر وحدات JS غير شاشية (القسم هـ).
5. **الخطوط المستضافة غير مستعملة في التطبيق حاليًا.** `signature.css` يعتمد خط النظام (`-apple-system … "SF Arabic"`) ولا يحوي `@font-face`. خط Alexandria (400 و700، عربي ولاتيني) مخدوم من `/fonts/` لكن لا يستعمله إلا `report-print.css` للمستندات المطبوعة. هوية الشركة الخطية غائبة عن الواجهة اليوم.

---

## أ. هيكل DOM الذي ينتجه الغلاف

### أ.1 الصفحة الثابتة (`index.html`)

```
html[lang=ar][dir=rtl][data-theme=auto|light|dark]     ← حالات: .is-menu-open ، .is-searching
└ body
  ├ a.skip[href="#main"]
  ├ div#app                         ← app.mjs يستبدل محتواه كاملًا مع كل تنقل
  │  └ main.loading                 (قبل الإقلاع فقط)
  ├ div#toast[role=status][aria-live=polite]          ← .show لمدة 4.5 ثانية، textContent فقط
  ├ dialog#dialog[aria-labelledby=dialog-title]       ← .drawer دائمًا (بلا قاعدة CSS)، .launcher للعريض، .is-dragging
  ├ noscript
  ├ dialog.journey-dialog#journey-dialog              ← يضيفه journey.mjs عند التحميل
  └ div.sig-cmd[hidden][role=dialog][aria-modal]      ← يضيفه signature.mjs عند أول بحث
```

`<head>`: `viewport-fit=cover`، `color-scheme: light dark`، وسمان `theme-color` (`#f2f2f7` فاتح، `#000000` داكن — يجب تحديثهما مع الألوان الجديدة)، وسوم تطبيق iOS، ثم `signature.css` ثم `hr-design.css`، ثم ثلاث وحدات: `journey.mjs` و`app.mjs` و`signature.mjs`.

### أ.2 شاشة الدخول (`loginView()` في `app.mjs`)

```
main.login#main
├ section.login-story                       ← display:none تحت 1024px
│  ├ div.brand > svg.brand-svg              (brandLogo: viewBox 0 0 58 24، fill=currentColor)
│  ├ div.hr-frames[aria-hidden]             ← display:none حاليًا (بقايا تصميم سابق)
│  │  └ div.hr-frame.hr-frame-one|two|three > div.hr-orbit|hr-city|hr-beams + span
│  ├ div.story-copy > div.eyebrow + h1 + p
│  └ div.hr-values > span ×5                (الإنجاز، الشمولية، الإبداع، الجودة، الاعتزاز)
└ section.login-form
   ├ header.login-masthead
   │  ├ div.login-wordmark > svg.brand-svg + span
   │  └ button.text-button[data-action=theme]
   ├ div.login-card
   │  ├ div.login-mobile-tagline            ← اليوم مربع أخضر فيه "3,6T" عبر ::after، ونصه مخفي
   │  ├ div.eyebrow                          (مخفي في .login-card)
   │  ├ h2 ، p
   │  ├ form#login-form
   │  │  ├ label > span + input[name=username]
   │  │  ├ label > span + input[name=password][type=password]
   │  │  ├ label > span + input[name=otp]
   │  │  ├ div#login-error[role=alert]      ← يُحقن فيه div.error
   │  │  └ button.btn.dark[type=submit]
   │  ├ p.login-note
   │  └ button.text-button.mt[data-action=language]
   └ footer.login-footer
```

بوابة تغيير كلمة المرور الإجبارية: `main.login.password-gate#main > section.login-form > div.login-card > div.eyebrow + h2 + p + form#password-form.password-form` (ثلاثة `label`، `div#login-error`، `button.btn.primary`، `button.text-button[data-action=logout]`).

### أ.3 غلاف التطبيق (`shell()` في `app.mjs` + `mountTabs()` في `signature.mjs`)

```
div.shell                                    ← ≥1024px: grid 288px + 1fr
├ aside.sidebar#app-sidebar[aria-label]      ← جوال: صفيحة من الأسفل · مكتب: شريط جانبي لاصق
│  │                                           signature.mjs تضبط: role=dialog/aria-modal/inert تحت 1024px،
│  │                                           .is-dragging و--drag أثناء السحب، data-sig-nav
│  ├ div.side-head                           ← مقبض السحب (::before)
│  │  ├ div.brand > svg.brand-svg
│  │  ├ h2.side-title
│  │  └ button.side-done[data-shell=drawer-close]
│  ├ div.side-profile > span.avatar + div > strong + small
│  ├ label.nav-search-label > svg.glyph + input.nav-search#nav-search[type=search]
│  ├ nav.nav[aria-label]                     ← groupedNavigation() من hr-design.mjs
│  │  └ details.hr-nav-group[data-group][open?]          (7 مجموعات + «أخرى» عند الحاجة)
│  │     ├ summary.hr-nav-label > span + small.hr-nav-total
│  │     └ div.hr-nav-rows
│  │        └ div.hr-nav-section > [p.hr-nav-sublabel] +
│  │           a[href="#key"](.active)[aria-current=page]
│  │              ├ span.nav-icon.tint-{blue|green|indigo|orange|pink|purple|red|teal|yellow|mint|cyan|brown|gray} > svg.glyph
│  │              ├ span.nav-label
│  │              └ [span.nav-count(.is-late)]          ← يضيفه render() على a[href="#inbox"]
│  ├ section.side-account[aria-label]
│  │  ├ p.hr-nav-label
│  │  └ div.hr-nav-rows > button.nav-row(.is-destructive)[data-action=theme|language|change-password|logout]
│  │        > span.nav-icon.tint-* > svg.glyph ، span.nav-label ، [span.nav-value]
│  └ p.side-note > span.status-dot
├ div.side-scrim[data-shell=drawer-close][aria-hidden]
├ div.stage                                  ← inert عند فتح القائمة
│  ├ header.topbar (.is-condensed عند مرور h1 تحته)
│  │  ├ button.top-btn.top-avatar[data-shell=drawer][aria-controls=app-sidebar][aria-expanded] > span.avatar
│  │  ├ div.topbar-title[aria-hidden]
│  │  └ button.top-btn.top-search[data-shell=search] > svg.glyph + span.top-search-text + kbd
│  └ main#main.page[tabindex=-1] (.journey-enter يضيفها journey.mjs)
│     └ div.loading  →  يُستبدل بمحتوى الشاشة
└ nav.sig-tabs[aria-label]                   ← تضيفها signature.mjs بعد الرسم (آخر ابن لـ.shell)
   ├ a[href="#key"](.active)[aria-current] ×≤4 > svg.glyph + [span.nav-count] + span
   └ button[data-shell=drawer](.active)[aria-controls=app-sidebar] > svg.glyph + span   («المزيد»)
```

ترتيب التبويبات: أول أربعة متاحة من `portal, home, work, inbox, notifications, requests, leave`.

### أ.4 رأس الشاشة ومحتواها

```
div.page-head
├ div > h1 + [p]
└ [div.page-actions > button.btn.primary … | span.badge …]

[a.department-back]                           ← قبل page-head في شاشة الدليل
div.operations > {module.render()}            ← لكل شاشات operationModules
div.error + button.btn[data-action=reload]    ← عند الفشل
div.empty > div.empty-symbol + strong + p     ← الحالة الفارغة
```

`signature.mjs` تقرأ `#main h1` لتملأ `.topbar-title` وتراقبه بـ`IntersectionObserver`. **كل شاشة يجب أن تبقي `h1` واحدًا داخل `#main`.**

الهيكل النموذجي لشاشة تشغيلية حديثة (عائلة `vn-*`، 57 ملفًا من 73):

```
div.operations
├ section.panel.panel-body.vn-head > p + [div.operation-actions > button.btn.outline.small[data-action=operation]…]
├ section.panel.panel-body.vn-board > div.vn-tiles > div.vn-tile(.is-late|.is-due|.is-ok|.is-old|.is-block|.is-warn) > strong + span
├ [div.vn-alert(.is-ok|.is-late|.is-block) > strong + ul|p]
├ [label.sig-filter > svg.glyph + input + output]      ← تحقنه signature.mjs قبل أول .vn-group إذا زادت البطاقات عن 6
├ section.vn-group > h2 (نص + span|small) + [p] + details.vn-card(.is-{status}) ×n
│    details.vn-card
│    ├ summary > span.vn-code + span.vn-name > (strong + small) + span.vn-flags > (span.vn-flag(.is-*) | span.badge.{status})
│    └ div.vn-body > dl.vn-facts > div > (dt + dd)
│                  + div.vn-block > h3 + ul.vn-list > li(.is-*) > strong + span + small + span.badge + div.operation-actions
│                  + ol.vn-pipeline > li.vn-step(.is-*) > span + small
│                  + div.operation-actions
├ section.panel.panel-body.vn-block > h3 + [p.subtle] + (ul.vn-list | div.table-wrap > table)
└ div.vn-grid > (أقسام متجاورة)
```

الشاشات الأقدم (16 ملفًا بلا `vn-`): `section.panel > div.panel-head > (div > h2 + p | h2) + (div.panel-body | div.table-wrap > table)`، و`dl.detail-data > div > dt + dd`، و`div.stats > article.stat > div.stat-label + strong.stat-number + small`، و`div.file`، و`div.timeline > div.timeline-item`، و`div.notice`.

### أ.5 نافذة الحوار/الصفيحة (`showDialog()`)

```
dialog#dialog.drawer[.launcher]
├ div.dialog-head                            ← مقبض السحب (::before)
│  ├ h2#dialog-title
│  └ button.sheet-close[data-action=close] > svg.glyph
└ div.dialog-body
   ├ {المحتوى}  عادةً: form#{id} > div.form-grid > label… + div.form-actions
   └ div#dialog-error[role=alert]
div.form-actions > button.btn.outline[type=button][data-action=close] + button.btn.dark|danger[type=submit]
```

حقول النماذج (`operationFields` في `operations.mjs`):

```
label[.full] > span (نص + span.required) + input|select|textarea + [small.subtle]
div.full.rows-field[data-rows][data-min][data-max]
  > span + div.table-wrap > table > thead + tbody > tr[data-row] > td > input|select[data-col] … + td.rows-remove > button.btn.outline.small[data-action=row-remove]
  + button.btn.outline.small[data-action=row-add] + template > tr[data-row] + [small.subtle]
fieldset.full.checks-field[data-checks] > legend + div.checks > label > input[type=checkbox][data-check] + span + [small.subtle]
label.check > input[type=checkbox] + span                      (في app.mjs)
fieldset.builder-field > legend + div.form-grid                (منشئ الخدمات)
```

على الجوال صفيحة من الأسفل (`inset:auto 0 0 0`)، ومن 760px نافذة وسطية بعرض 640px (`.launcher`: 1040px).

### أ.6 البحث الشامل (`signature.mjs`) ونافذة الجولة (`journey.mjs`)

```
div.sig-cmd > div.sig-cmd-box
  ├ label.sig-cmd-input > svg.glyph + input[type=search] + button.sig-cmd-cancel
  ├ div.sig-cmd-list[role=listbox] > p.sig-cmd-group + div.sig-cmd-rows > button.sig-cmd-item(.is-active)[role=option][data-index]
  │      > span.nav-icon.tint-* + span > (strong + small) + b        |  p.sig-cmd-empty
  └ div.sig-cmd-foot > span > kbd

dialog.journey-dialog > header > h2#journey-title + button.journey-tool[data-journey-action=close]
  + input#journey-search + div.journey-results > a[data-journey-link] + p.journey-help | p.journey-empty
  | span.journey-tour-counter + p.journey-tour-copy + div.journey-tour-controls > .btn…
```

### أ.7 نقاط ربط JavaScript التي لا يجوز كسرها

| النوع | القيم |
|---|---|
| معرّفات | `#app` `#main` `#toast` `#dialog` `#dialog-title` `#dialog-error` `#login-error` `#app-sidebar` `#nav-search` `#launcher-search` `#launcher-dynamic` `#department-search` `#department-search-status` `#benchmark-search` `#benchmark-search-status` `#request-results` `#scope-results` `#service-fields` `#builder-fields` `#accounts-table` `#journey-dialog` `#journey-search` ومعرّفات النماذج (`login-form` `password-form` `request-form` `operation-form` `transition-form` `attachment-form` `transfer-form` `task-assign-form` `task-settle-form` `task-form` `task-complete-form` `project-form` `service-form` `service-feedback-form` `work-task-form` `request-filter` `scope-filter`) |
| سمات `data-` | `data-action` (49 موضعًا) `data-shell`=`drawer|drawer-close|search` `data-id` `data-version` `data-module` `data-operation` `data-transition` `data-mode` `data-rows` `data-min` `data-max` `data-col` `data-checks` `data-check` `data-row` `data-width` `data-filter` `data-filter-text` `data-group` `data-index` `data-launcher` `data-department-search` `data-benchmark-search` `data-journey-action` `data-journey-link` `data-athar-scene` |
| محددات تقرؤها JS | `.nav a[href^="#"]` `.nav-label` `.nav-icon` `.nav-icon svg` `.nav-count` `.hr-nav-group` `.hr-nav-section` `.sidebar` `.side-head` `.side-done` `.shell` `.stage` `.sig-tabs` `.topbar` `.topbar-title` `#main h1` `#main .loading` `.vn-card` `.vn-group` `.sig-filter` `.dialog-head,header` (داخل dialog) `.builder-field` `.rq-card:not(.is-static),.rq-dept` `a[href="#inbox"]` `.topbar-actions` (لم يعد موجودًا؛ `journey.mjs` يتجاهله) |
| عدّ الأرقام | `.vn-tile strong, .stat-number, .pt-tile strong, .ex-figure strong, .ex-step strong, .acc-stats strong, .hr-focus strong, .figure b` |
| متغيرات CSS تضبطها JS عبر CSSOM | `--drag` (سحب الصفائح) · `--rq-delay` `--mx` `--my` `--tilt-x` `--tilt-y` (`motion-cards`) · الخاصية `width` على كل `[data-width]` (`paintBars`: `.vn-bar` و`.ex-bar i`) |
| التخزين | `localStorage`: `36t-lang` `36t-theme` `36t-motion-paused` · `sessionStorage`: `36t-nav-open` |
| نقاط الانكسار | CSS: `760px` و`1024px` (و`max-width:759px`) · JS: `compact()` = `(max-width: 1023.98px)` — **يجب أن تبقى JS وCSS متطابقتين** |
| طبقات z-index | `.topbar` 30 · `.sig-tabs` 35 · `.side-scrim` 39 · `.sidebar` 40 · `.skip` 100 · `.sig-cmd` 110 · `#toast` 120 · `dialog` في الطبقة العليا |
| ميزات متصفح مفترضة | `:has()` `dvh` `color-mix()` `inert` `backdrop-filter` `text-wrap:balance` الخصائص المنطقية (Safari ≥ 15.5) |

---

## ب. جرد الأصناف المشتركة (العقد)

الأمر المنفَّذ: `grep -oh 'class="[^"]*"' app/static/*.mjs | tr '"' ' ' | tr ' ' '\n' | grep -v '^class=$' | sort | uniq -c | sort -rn | head -150`.
الحصيلة: **311 اسم صنف حرفيًا** في الترميز، يقابلها 432 محدِّد صنف في CSS. الأرقام بين قوسين عدد مرات الورود الحرفي (الورود داخل دوال مساعدة مثل `tile()` يُحسب مرة واحدة، فالاستعمال الفعلي أعلى).

### ب.1 الأعلى استعمالًا (كل الملفات)

| # | الصنف | العدد | | # | الصنف | العدد |
|---|---|---|---|---|---|---|
| 1 | `subtle` | 516 | | 21 | `vn-name` | 34 |
| 2 | `panel` | 285 | | 22 | `vn-flags` | 34 |
| 3 | `panel-body` | 274 | | 23 | `vn-card` | 34 |
| 4 | `vn-list` | 254 | | 24 | `vn-body` | 34 |
| 5 | `operation-actions` | 252 | | 25 | `vn-group` | 32 |
| 6 | `vn-block` | 243 | | 26 | `detail-data` | 28 |
| 7 | `badge` | 123 | | 27 | `vn-grid` | 21 |
| 8 | `vn-head` | 102 | | 28 | `is-block` | 20 |
| 9 | `vn-alert` | 85 | | 29 | `is-late` | 16 (+عشرات ديناميكية) |
| 10 | `vn-tiles` | 79 | | 30 | `form-actions` | 16 |
| 11 | `vn-board` | 79 | | 31 | `is-due` | 13 (+ديناميكية) |
| 12 | `btn` | 79 | | 32 | `vn-facts` | 12 |
| 13 | `panel-head` | 73 | | 33 | `is-ok` | 12 (+ديناميكية) |
| 14 | `outline` | 60 | | 34 | `mt` | 10 |
| 15 | `vn-tile` | 58 | | 35 | `primary` | 9 |
| 16 | `muted` | 54 | | 36 | `is-warn` | 7 |
| 17 | `table-wrap` | 41 | | 37 | `dark` | 7 |
| 18 | `small` | 38 | | 38 | `text-button` `notice` `form-grid` `file` | 6 لكل منها |
| 19 | `vn-flag` | 37 | | 39 | `required` | 5 |
| 20 | `vn-code` | 35 | | 40 | `is-old` | 3 (+نحو 60 ديناميكية) |

بقية أعلى 150 (العدد 4): `wk-stack` `wk-empty` `status` `sr-only` `service-grid` `rq-results-head` `pt-rows` `pt-row-main` `pt-row` `page-head` `nav-icon` `journey-tool` `eyebrow` `acc-actions`.
(العدد 3): `wk-card` `vn-step` `vn-pipeline` `timeline-item` `timeline` `service` `rq-list` `rq-dept-icon` `rejected` `pt-due` `journey-stop` `hr-hero` `hr-frame` `full` `empty` `department-back` `avatar` `approved`.
(العدد 2): `wk-meta` `vn-req` `top-btn` `task-info` `task` `step-no` `stats` `stat` `service-icon` `rq-search-icon` `rq-search` `rq-row` `rq-rail-item` `rq-rail-icon` `rq-pill` `rq-kicker` `rq-hero-copy` `rq-hero` `rq-empty` `rq-crumbs` `rq-chip` `rq-body` `rq` `returned` `pt-empty` `pending` `org-sector` `org-grid` `nav-label` `login-form` `login-card` `login` `journey-step` `journey-help` `journey-heading` `journey` `hr-nav-rows` `hr-nav-label` `glyph` `filters` `ex-flag` `error` `department-summary` `check` `brand`.

### ب.2 الأصناف في ملفات `*-ui.mjs` وحدها (ما تكتبه الشاشات فعلًا)

`subtle`(494) `panel`(268) `panel-body`(266) `vn-list`(254) `operation-actions`(251) `vn-block`(243) `badge`(112) `vn-head`(102) `vn-alert`(85) `vn-tiles`(79) `vn-board`(79) `panel-head`(62) `vn-tile`(58) `muted`(48) `btn`(40) `table-wrap`(39) `vn-flag`(37) `vn-code`(35) `outline`(35) `vn-name`(34) `vn-flags`(34) `vn-card`(34) `vn-body`(34) `vn-group`(32) `detail-data`(26) `small`(22) `vn-grid`(21) `is-block`(20) `is-late`(16) `form-actions`(14) `is-due`(13) `vn-facts`(12) `is-ok`(12) `is-warn`(7) `notice`(5) `wk-stack` `wk-empty` `status` `pt-rows` `pt-row-main` `pt-row` `file` `acc-actions`(4) `wk-card` `vn-step` `vn-pipeline` `rejected` `pt-due` `journey-stop` `is-old` `form-grid` `dark` `approved`(3) `wk-meta` `vn-req` `timeline-item` `timeline` `returned` `pt-empty` `primary` `pending` `page-head` `org-sector` `org-grid` `journey-heading` `ex-flag`(2)
ومرة واحدة: `wk-x` `wk-top` `wk-title` `wk-done` `wk-column` `wk-check` `wk-board` `wk-add` `vn-reqs` `vn-days` `vn-chips` `vn-bars` `vn-bar` `stats` `stat` `sr-only` `pt-tiles` `pt-tile` `pt-quicks` `pt-quick` `pt-label` `pt-grid` `pt-chips` `pt-chip` `org-top` `org-exec-role` `org-exec` `operations-table` `mt` `journey-path` `journey-hero` `journey-greeting` `journey-cta` `journey-copy` `is-warn-text` `is-personal` `is-late-text` `eyebrow` `ex-table` `ex-step` `ex-rows` `ex-row` `ex-note` `ex-hero-copy` `ex-hero` `ex-grid` `ex-flow` `ex-figures` `ex-figure-label` `ex-figure` `ex-bar` `ex-attention` `ex-arrow` `ai-output` `acc-stats` `acc-gaps` `acc-gap-list` `acc-gap` `acc-filter`.

### ب.3 العائلات (كلها يجب أن تبقى مصممة)

| العائلة | المالك | الأصناف |
|---|---|---|
| الغلاف | `app.mjs` + `signature.mjs` | `shell` `sidebar` `side-head` `side-title` `side-done` `side-profile` `side-account` `side-note` `side-scrim` `stage` `topbar` `topbar-title` `top-btn` `top-avatar` `top-search` `top-search-text` `page` `page-head` `page-actions` `loading` `brand` `brand-svg` `avatar` `status-dot` `skip` `glyph` `sig-tabs` `sig-filter` `sig-cmd*` (9) |
| التنقل | `hr-design.mjs` | `nav` `nav-search-label` `nav-search` `hr-nav-group` `hr-nav-label` `hr-nav-total` `hr-nav-rows` `hr-nav-section` `hr-nav-sublabel` `nav-row` `nav-icon` `nav-label` `nav-value` `nav-count` `tint-*` (13 لونًا) `active` `is-destructive` |
| البطاقات والقوائم | كل الشاشات | `panel` `panel-head` `panel-body` `vn-head` `vn-board` `vn-tiles` `vn-tile` `vn-group` `vn-card` `vn-code` `vn-name` `vn-flags` `vn-flag` `vn-body` `vn-block` `vn-list` `vn-facts` `vn-grid` `vn-alert` `vn-pipeline` `vn-step` `vn-days` `vn-chips` `vn-reqs` `vn-req` `vn-bars` `vn-bar` `detail-data` `table-wrap` `operations` `operations-table` `split` `details-grid` `stats` `stat` `stat-label` `stat-number` `counts` `notice` `error` `empty` `empty-symbol` `ai-output` `file` `timeline` `timeline-item` |
| الحالة (دلالية، أغلبها ديناميكي) | كل الشاشات | `is-late` `is-due` `is-warn` `warn` `is-ok` `is-old` `is-block` `is-inactive` `is-active` `is-now` `is-mine` `is-personal` `is-decision` `is-needs_info` `is-passed` `is-failed` `is-met` `is-verified` `is-missing` `is-expired` `is-expiring` `is-pending` `is-late-text` `is-warn-text` + `is-${status}` على `.vn-card` |
| قيم `badge` (نحو 80 قيمة حالة تُكتب صنفًا) | كل الشاشات | أخضر: `approved completed passed active paid executed done signed published released fulfilled received confirmed matched cleared obtained qualified filed remitted issued answered no_conflict reviewed quote_approved shot accepted verified met` · برتقالي: `pending pending_hr pending_manager due_soon proposed needs_info returned brief_returned reshoot lost_review written_exception submitted awaiting expiring` · أحمر: `rejected failed overdue expired contract_expired declined refused lost stopped different missing blocked` · أزرق: `in_progress open in-progress scheduled running` · رمادي: `withdrawn locked draft cancelled suspended closed archived retired superseded ended unused none out inactive subtle` |
| الأزرار والحقول | الكل | `btn` + `primary` `dark` `outline` `danger` `small` · `text-button` · `form-grid` `form-actions` `full` `required` `check` `checks` `checks-field` `rows-field` `rows-remove` `builder-field` `filters` `password-form` `mt` `muted` `subtle` `ltr` `sr-only` `eyebrow` `pill` |
| الحوار | `app.mjs` | `dialog-head` `dialog-body` `sheet-close` `drawer` `launcher` |
| الدخول | `app.mjs` | `login` `password-gate` `login-story` `story-copy` `hr-values` `hr-frames` `hr-frame*` `hr-orbit` `hr-city` `hr-beams` `login-form` `login-masthead` `login-wordmark` `login-card` `login-mobile-tagline` `login-note` `login-footer` `athar-scene` `athar-motion` |
| الرئيسية القديمة | `app.mjs` + `hr-design.mjs` | `hr-hero` `hr-hero-copy` `hr-focus` `departments-entry` `compact-services` `service-row` `service-icon` `journey` `journey-step` `step-no` `task` `task-info` `task-list` `task-row` `task-row-end` `square` `project-card` `project-top` `notification-row` `req-card` `requirements-list` |
| الإدارات | `hr-design.mjs` | `department-back` `department-summary` `department-search` `department-grid` `department-card` `department-card-top` `department-number` `department-section` `department-section-title` `service-grid` `service` `more` |
| مُطلق الطلب | `request-picker.mjs` | `rq` `rq-page` `rq-hero` `rq-hero-copy` `rq-kicker` `rq-search` `rq-search-icon` `rq-body` `rq-rail` `rq-rail-group` `rq-rail-label` `rq-rail-item` `rq-rail-icon` `rq-results` `rq-results-head` `rq-list` `rq-row` `rq-row-icon` `rq-row-text` `rq-row-meta` `rq-chip` `rq-go` `rq-found` `rq-found-dept` `rq-popular` `rq-pill` `rq-dept-grid` `rq-dept` `rq-dept-tag` `rq-dept-sections` `rq-dept-count` `rq-dept-head` `rq-dept-icon` `rq-crumbs` `rq-section` `rq-section-no` `rq-workspaces` `rq-workspaces-label` `rq-workspace` `rq-empty` `rq-compose*` (6) `rq-fields` `rq-trail` `rq-tip` `rq-back` `is-all` `is-static` `is-time` `tone-1…8` + حركة: `rq-card` `rq-enter` `rq-shown` `is-live` |
| بوابتي | `portal-ui` | `journey-hero` `journey-greeting` `journey-copy` `journey-cta` `journey-heading` `journey-path` `journey-stop` `pt-grid` `pt-tiles` `pt-tile` `pt-rows` `pt-row` `pt-row-main` `pt-due` `pt-empty` `pt-quicks` `pt-quick` `pt-label` `pt-chips` `pt-chip` |
| اللوحة التنفيذية | `executive-ui` | `ex-hero` `ex-hero-copy` `ex-attention` `ex-flag` `ex-figures` `ex-figure` `ex-figure-label` `ex-grid` `ex-flow` `ex-step` `ex-arrow` `ex-rows` `ex-row` `ex-note` `ex-table` `ex-bar` |
| العمل اليومي | `work-ui` | `wk-top` `wk-title` `wk-stack` `wk-card` `wk-meta` `wk-empty` `wk-board` `wk-column` `wk-check` `wk-x` `wk-add` `wk-done` |
| الهيكل والحسابات | `org-ui` `accounts-ui` | `org-top` `org-exec` `org-exec-role` `org-sector` `org-grid` `org-unit` · `acc-stats` `acc-gaps` `acc-gap-list` `acc-gap` `acc-filter` `acc-actions` |
| الجولة | `journey.mjs` | `journey-dialog` `journey-tool` `journey-results` `journey-help` `journey-empty` `journey-tour-counter` `journey-tour-copy` `journey-tour-controls` `journey-enter` (`journey-tools` `journey-mobile-menu` `journey-sidebar-close` مخفية بـ`display:none!important`) |

أصناف في الترميز **بلا قاعدة CSS** اليوم (فرصة أو إهمال): `hr-frame` `hr-frame-one|two|three` `hr-orbit` `hr-city` `hr-beams` `is-all` `is-static` `nav-search` `operations-table` `rq-hero-copy` `status` `drawer`.
أصناف مخفية عمدًا بـ`display:none`: `.hr-frames` `.athar-scene` `.athar-motion` `.sig-aurora` `.login-story` (تحت 1024px) `.rq-go` `.sig-cmd-foot` (جوال).

---

## ج. رموز التصميم الحالية على `:root`

آلية الوضع الداكن ثلاثية: `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){…}}` ثم `:root[data-theme=dark]{…}` (الكتلتان متطابقتان ويجب أن تبقيا كذلك)، و`:root[data-theme=light]{color-scheme:light}`. القيمة تُكتب من `app.mjs`: `document.documentElement.dataset.theme = auto|light|dark`.

### ج.1 الألوان (لها قيمة داكنة)

| الرمز | الفاتح | الداكن |
|---|---|---|
| `--tint` | `#0a7560` | `#3fcfa9` |
| `--tint-fill` | `#0a7560` | `#11806a` |
| `--on-tint` | `#fff` | `#fff` |
| `--brand-deep` | `#123f37` | `#0c2b26` |
| `--bg` | `#f2f2f7` | `#000` |
| `--surface` | `#fff` | `#1c1c1e` |
| `--surface-2` | `#f2f2f7` | `#2c2c2e` |
| `--surface-raised` | `#fff` | `#2c2c2e` |
| `--label` | `#000` | `#fff` |
| `--label-2` | `rgba(60,60,67,.62)` | `rgba(235,235,245,.62)` |
| `--label-3` | `rgba(60,60,67,.36)` | `rgba(235,235,245,.32)` |
| `--label-4` | `rgba(60,60,67,.18)` | `rgba(235,235,245,.18)` |
| `--fill` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` |
| `--fill-2` | `rgba(118,118,128,.16)` | `rgba(118,118,128,.32)` |
| `--fill-3` | `rgba(118,118,128,.08)` | `rgba(118,118,128,.14)` |
| `--separator` | `rgba(60,60,67,.24)` | `rgba(84,84,88,.62)` |
| `--separator-opaque` | `#c6c6c8` | `#38383a` |
| `--material` | `rgba(250,250,252,.72)` | `rgba(30,30,32,.66)` |
| `--material-thick` | `rgba(250,250,252,.88)` | `rgba(30,30,32,.86)` |
| `--material-edge` | `rgba(255,255,255,.6)` | `rgba(255,255,255,.08)` |
| `--blue` | `#007aff` | `#0a84ff` |
| `--green` | `#34c759` | `#30d158` |
| `--indigo` | `#5856d6` | `#5e5ce6` |
| `--orange` | `#ff9500` | `#ff9f0a` |
| `--pink` | `#ff2d55` | `#ff375f` |
| `--purple` | `#af52de` | `#bf5af2` |
| `--red` | `#ff3b30` | `#ff453a` |
| `--teal` | `#30b0c7` | `#40c8e0` |
| `--yellow` | `#ffcc00` | `#ffd60a` |
| `--mint` | `#00c7be` | `#63e6e2` |
| `--cyan` | `#32ade6` | `#64d2ff` |
| `--brown` | `#a2845e` | `#ac8e68` |
| `--gray` | `#8e8e93` | `#8e8e93` |
| `--green-ink` | `#1f7a35` | `#30d158` |
| `--orange-ink` | `#a84a00` | `#ff9f0a` |
| `--red-ink` | `#c41a12` | `#ff6961` |
| `--blue-ink` | `#0058c9` | `#409cff` |
| `--gray-ink` | `#5f5f66` | `#aeaeb2` |
| `--purple-ink` | `#7d2fa6` | `#da8fff` |
| `--scrim` | `rgba(0,0,0,.32)` | `rgba(0,0,0,.5)` |
| `--shadow-float` | `0 12px 40px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06)` | `0 12px 40px rgba(0,0,0,.5),0 0 0 .5px rgba(255,255,255,.08)` |
| `--shadow-bar` | `0 6px 24px rgba(0,0,0,.10),0 1px 3px rgba(0,0,0,.06)` | `0 6px 24px rgba(0,0,0,.45),0 0 0 .5px rgba(255,255,255,.08)` |

ألوان خارج الرموز (مكتوبة حرفيًا في القواعد): `.tint-yellow #f5b800`، `.tint-mint #00b3a9`، `.tone-1 #0a7560`، `.avatar linear-gradient(#a5abb6,#858994)`، `.login-mobile-tagline linear-gradient(160deg,#138a70,var(--brand-deep))`، `.login-story` ثلاثة تدرجات خضراء (`#1d9a7e #0f5c4d #0f6c59 #0b2f29`)، وسهم `select` بلون `%238e8e93` داخل `data:` URI.

### ج.2 رموز بلا قيمة داكنة

| المجموعة | الرموز |
|---|---|
| الخط | `--font` (خط النظام: `-apple-system, BlinkMacSystemFont, "SF Arabic", "SF Pro Text", "Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif`) · `--font-rounded` (`ui-rounded, "SF Pro Rounded", …`) · `--font-mono` |
| السلّم | `--fs-large 34` `--fs-title1 28` `--fs-title2 22` `--fs-title3 20` `--fs-headline 17` `--fs-body 17` `--fs-callout 16` `--fs-sub 15` `--fs-foot 13` `--fs-cap 12` `--fs-cap2 11` · `--lh-body 1.6` `--lh-head 1.3` |
| سلّم ≥1024px | `large 32` `title1 26` `title2 21` `title3 18` `headline 15` `body 15` `callout 15` `sub 14` `foot 12.5` `cap 12` · `--gutter 40px` · `--tap 36px` |
| المسافات | `--s1 4` `--s2 8` `--s3 12` `--s4 16` `--s5 20` `--s6 24` `--s8 32` `--s10 40` `--s12 48` · `--gutter 16px` · `--row-inset 16px` |
| الانحناءات | `--r-xs 6` `--r-sm 10` `--r-md 14` `--r-lg 20` `--r-xl 26` `--r-pill 999px` |
| الخطوط الرقيقة واللمس | `--hair 1px` (`.5px` عند `min-resolution:2dppx`) · `--tap 44px` |
| الحركة | `--ease cubic-bezier(.32,.72,0,1)` · `--ease-out cubic-bezier(.22,1,.36,1)` · `--spring cubic-bezier(.34,1.36,.64,1)` · `--d1 .16s` `--d2 .26s` `--d3 .42s` |
| الأبعاد | `--topbar-h 52px` · `--tabbar-h 64px` · `--safe-t/-b/-l/-r` = `env(safe-area-inset-*)` |

رموز محلية على المكونات (ليست على `:root`): `--state` و`--dot` (البلاطات والقوائم)، `--c` و`--ink` (الشارات والأزرار والمراحل)، `--icon` (أيقونة التنقل)، `--tone` (مُطلق الطلب).
كتل ختامية: `prefers-reduced-motion` يوقف كل حركة، `prefers-reduced-transparency` يلغي `backdrop-filter` عن (`.topbar::before .sig-tabs .sidebar #toast .sig-cmd-box .form-actions .top-search`)، و`@media print` يخفي الغلاف.

---

## د. سياسة أمن المحتوى بالنص وما تسمح به

من `app/server.mjs` السطر 143 (تُرسل مع كل استجابة، ومنها الملفات الثابتة):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

رؤوس مرافقة: `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` · `Cache-Control: no-store` (كل ملف ثابت يُعاد تنزيله مع كل تحميل صفحة) · `Cross-Origin-Resource-Policy: same-origin` · `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

| السؤال | الجواب | السبب |
|---|---|---|
| رسم `<canvas>` ثنائي الأبعاد؟ | **مسموح** | CSP لا تقيّد Canvas. `athar.mjs` يفعل ذلك اليوم. |
| WebGL على `<canvas>`؟ | **مسموح** | نصوص shaders ليست `eval`. كانت في `signature.mjs` خلفية WebGL وأُزيلت لسبب تصميمي لا أمني. |
| عناصر SVG داخل الترميز؟ | **مسموح** | عناصر DOM عادية. سمات العرض (`fill` `stroke` `transform` `opacity`) ليست `style`. المنصة تعتمد على ذلك (`glyph` و`brandLogo`). و`<use href="#id">` داخل المستند مسموح. |
| `<style>` داخل SVG أو HTML، أو سمة `style=""`؟ | **ممنوع** | `style-src 'self'` بلا `'unsafe-inline'`. يشمل `setAttribute('style',…)` و`innerHTML` فيه `style=`، و`document.createElement('style')`. |
| تغيير التنسيق من JS؟ | **مسموح عبر CSSOM** | `el.style.setProperty('--x',…)` و`el.style.width=…` و`classList` و`el.animate()` (Web Animations). هكذا تعمل `--drag` و`--mx` و`data-width`. |
| صور `data:` في `<img>`؟ | **مسموح** | `img-src 'self' data:`. |
| `background-image:url("data:…")` في CSS؟ | **مسموح** | يخضع لـ`img-src`. مستعمل اليوم في سهم `select` (السطر 478). ومثله `mask-image` و`border-image` و`cursor`. هذا هو الطريق الوحيد لإدخال نقوش أو حبيبات (noise/grain) أو زخارف: SVG مرمَّز داخل `data:` في ملف CSS. |
| خطوط `data:` داخل `@font-face`؟ | **ممنوع** | لا يوجد `font-src`، فيرجع إلى `default-src 'self'`. الخطوط من `/fonts/…woff2` فقط. |
| صور `blob:`؟ | **ممنوع** | غير مدرجة في `img-src`. |
| صور أو خطوط أو سكربتات خارجية (Google Fonts، CDN)؟ | **ممنوع** | كل شيء `'self'`. |
| ملفات صور مستضافة ذاتيًا (`.png` `.svg` `.webp`)؟ | **مسموحة بالسياسة لكن لا يوجد ما يخدمها** | القائمة البيضاء لا تحوي أي صورة، و`app/static/brand/` فارغ. يحتاج تعديل `server.mjs`. |
| فيديو/صوت؟ | من `'self'` فقط ولا ملف مخدوم | `media-src` يرجع إلى `default-src`. |
| `eval` / `new Function` / WASM / Worker من `blob:`؟ | **ممنوع** | `script-src 'self'`. و`scripts/check.mjs` يرفض وجود النص `eval(` في أي ملف تحت `app/`. Worker يحتاج ملفًا مخدومًا، ولا يوجد اسم متاح له. |
| معالجات أحداث داخل الترميز (`onclick=`) أو `<script>` داخلي؟ | **ممنوع** | وعشرات الاختبارات ترفض `<script` في مخرجات الشاشات. |
| `fetch` خارج المنشأ؟ | **ممنوع** | `connect-src 'self'`. |

خلاصة للمصمم: **كل التأثيرات البصرية الجريئة متاحة** (Canvas 2D، WebGL، SVG حي، تدرجات، `backdrop-filter`، `mask`، `clip-path`، `@property`، `view-transition`، خطوط Alexandria) بشرط أن يأتي كل شيء من ملفات CSS/JS المخدومة، وأن تُضبط القيم المتغيرة عبر CSSOM لا عبر سمة `style`.

---

## هـ. القائمة البيضاء للملفات الثابتة

الخادم يخدم خريطة حرفية (`assets`، الأسطر 112–139). **94 مدخلًا، وكل ملف على القرص مدرج، ولا مدخل بلا ملف.** لا يوجد مسار عام للمجلد.

| النوع | الملفات | ملاحظات |
|---|---|---|
| HTML | `/` ← `index.html` | الوحيد |
| CSS (6) | `signature.css` · `hr-design.css` · **`style.css`** · **`athar.css`** · **`journey.css`** · `report-print.css` | الثلاثة الغامقة أصبحت سطر تعليق واحدًا ولا يحمّلها `index.html`: **ثلاث خانات فارغة جاهزة للتقسيم دون لمس `server.mjs`**. `report-print.css` تستعمله المستندات المطبوعة التي يولدها الخادم (`letters` `reports` `print-documents` `production` `client-reports`) — **لا يُعاد توظيفه**. |
| JS غير الشاشات (10) | `app.mjs` `athar.mjs` `brand-logo.mjs` `signature.mjs` `journey.mjs` `operations.mjs` `dates.mjs` `hr-design.mjs` `request-picker.mjs` `motion-cards.mjs` | `dates.mjs` يجب أن يبقى مطابقًا حرفيًا لـ`app/dates.mjs` (اختبار). |
| JS الشاشات (73) | كل `*-ui.mjs` | خارج نطاق إعادة التصميم. |
| الخطوط (4) | `/fonts/alexandria-{arabic,latin}-{400,700}-normal.woff2` بنوع `font/woff2` | الوزنان 400 و700 فقط. لا وزن متوسط ولا خط عرض ثانٍ دون تعديل الخادم. `OFL.txt` موجود على القرص وغير مخدوم. |

تقسيم مقترح بلا تعديل للخادم (يُحمَّل بإضافة `<link>` في `index.html`، وهو مسموح؛ `@import` داخل CSS مسموح أيضًا لكنه أبطأ مع `no-store`):

| الملف | المحتوى المقترح |
|---|---|
| `signature.css` | الرموز (`:root` والداكن) + `@font-face` لـAlexandria + الأساس + الغلاف والتنقل |
| `style.css` | المكونات المشتركة: `panel` `vn-*` `badge` `btn` الحقول والجداول والحوار |
| `journey.css` | شاشات العائلات: `rq-*` `pt-*` `ex-*` `wk-*` `org-*` `acc-*` `journey-*` والرئيسية والإدارات |
| `athar.css` | الدخول والخلفية الحية (`canvas`) والمشاهد الحركية |
| `hr-design.css` | **يبقى كما هو في جوهره**: يجب أن يحتفظ بـ`@media(prefers-reduced-motion:reduce)` (بلا مسافة بعد `@media` وبلا مسافات حول النقطتين) و`@keyframes rq-beam` و`@keyframes rq-sheen` (اختبار `motion-cards`). يمكن الإضافة إليه لا الحذف منه. |

أي ملف باسم جديد (CSS أو JS أو صورة أو خط) = تعديل `server.mjs` + وإلا فشل `tests/static-modules.test.mjs`.

---

## و. كل اختبار يقيّد الواجهة (بالنص)

### و.1 `tests/static-modules.test.mjs` — كل ما يُستورد يجب أن يُخدَم

```js
for(const m of source.matchAll(/(?:from|import)\s*\(?['"]\.\/([\w.-]+\.(?:mjs|css))['"]/g))wanted.add(m[1]);
for(const m of readFileSync(new URL('index.html',dir),'utf8').matchAll(/(?:href|src)="\/?([\w.-]+\.(?:mjs|css))"/g))wanted.add(m[1]);
assert.ok(wanted.size>20,'the scan found the interface modules');
…
assert.deepEqual(missing,[]);
```

الأثر: كل `href`/`src` في `index.html` وكل `import './x.mjs'` في أي وحدة ثابتة يجب أن يعيد 200 من الخادم الحقيقي.

### و.2 `tests/motion-cards.test.mjs` — حركة البطاقات و`hr-design.css`

```js
const css=readFileSync(new URL('../app/static/hr-design.css',import.meta.url),'utf8');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(css,/@keyframes rq-beam/);
assert.match(css,/@keyframes rq-sheen/);
assert.doesNotMatch(html,/ style="/,'inline style attributes would be blocked by the content security policy');
assert.match(html,/class="rq-row"/,'services render as compact rows');
assert.match(html,/rq-row-meta/);
```

وعقد `mountCards(root,{view,reduced})` و`prefersReducedMotion(view)`:

```js
assert.ok(cards.every(c=>c.classes.has('rq-enter')));
assert.deepEqual(cards.map(c=>c.properties.get('--rq-delay')),['0ms','34ms','68ms']);
assert.ok(!cards[0].classes.has('rq-shown'),'the reveal waits for the next frame');
assert.equal(cards[1].properties.get('--mx'),'75.0%');
assert.equal(cards[1].properties.get('--my'),'25.0%');
assert.equal(cards[1].properties.get('--tilt-x'),'1.00deg');
assert.equal(cards[1].properties.get('--tilt-y'),'1.25deg');
assert.ok(cards[1].classes.has('is-live'));
assert.equal(cards[1].properties.get('--tilt-x'),'0deg');
assert.equal(container.listeners.size,0,'cleanup removes every listener');
assert.equal(container.listeners.size,0,'no pointer tracking when motion is reduced');
assert.equal(typeof mountCards(null),'function');
assert.equal(prefersReducedMotion({}),false);
```

الأثر: `motion-cards.mjs` يُستورد في Node بلا DOM، فـ**لا يجوز أن يلمس `document` أو `window` عند مستوى الوحدة**، ويجب أن تبقى الدالتان بسلوكهما الحرفي. إضافة تصديرات جديدة مسموحة.

### و.3 `tests/ui-race.test.mjs` و`tests/dialog-races.test.mjs` — `app.mjs` داخل صندوق `vm`

```js
const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8').replace(/^import .+;$/gm,'');
Object.assign(sandbox,{feedbackPanel,workFrames,groupedNavigation,dashboardHero,departmentDirectory});sandbox.brandLogo='';sandbox.mountScenes=()=>()=>{};sandbox.operationModules={};sandbox.operationFields=()=>'';sandbox.money=String;
await runInNewContext('(async()=>{'+source+';globalThis.ui={render,getDetail:()=>requestDetail,setDetail:r=>requestDetail=r};})()',sandbox);
…
assert.match(node('#main').innerHTML,/TITLE-B/);
assert.match(node('#dialog').innerHTML,/data-id="B" data-version="3"/);
assert.equal(calls[0].path,'/api/requests/B/approve');
```

```js
// dialog-races: العقدة الوهمية تستخرج النموذج هكذا
set(html){this.html=html;if(id==='#dialog')currentForm={id:html.match(/<form id="([^"]+)/)?.[1], …};}
assert.match(node('#dialog').innerHTML,/FORM-B/);assert.equal(node('#dialog').open,true);
```

القيود الناتجة على `app.mjs`:

1. كل `import` في `app.mjs` **سطر واحد ينتهي بـ`;`** (التعبير `^import .+;$`). استيراد متعدد الأسطر يكسر الاختبارين.
2. الصندوق يوفر فقط: `feedbackPanel workFrames groupedNavigation dashboardHero departmentDirectory brandLogo mountScenes operationModules operationFields money` + `console URL Intl Date Uint8Array location localStorage crypto setTimeout btoa FormData fetch`. **أي دالة مستوردة جديدة تُستدعى في `shell()` أو `render()` أو `showDialog()` أو معالجات `click`/`submit` أو عند مستوى الوحدة تُسبب `ReferenceError`** ما لم تُحرس بـ`typeof fn==='function'` أو `try{}catch{}` (كما تفعل `paintMotion`).
3. `document` الوهمي: `querySelector` يعيد دائمًا عقدة فيها `innerHTML textContent open classList{add,remove} querySelectorAll showModal close` فقط. `document.documentElement` = `{dataset:{}}` فقط (لا `classList`). لا `document.body` ولا `createElement` ولا `matchMedia` ولا `requestAnimationFrame` ولا `IntersectionObserver`. `window.addEventListener` لا تفعل شيئًا.
4. مخرجات يجب أن تبقى: `h1` يحمل عنوان الطلب في `#main`؛ وفي الحوار **`<form id="…"` مع `id` أول سمة**، و**`data-id="…" data-version="…"` متجاورتان بهذا الترتيب**، وعنوان النموذج نصًا داخل `#dialog`.
5. تصدير `workFrames` من `hr-design.mjs` يجب أن يبقى (يستورده الاختباران) حتى لو لم يُستعمل.

### و.4 اختبارات ترميز الوحدات المشتركة

```js
// tests/departments.test.mjs
assert.equal((home.match(/class="department-card"/g)||[]).length,4);assert.match(home,/data-department-search=/);assert.match(home,/الإدارات وخدماتها/);assert.doesNotMatch(home,/href="#finance"/);
assert.match(hr,new RegExp(`data-id="${service.id}"`));assert.match(hr,/href="#leave"/);assert.match(hr,/href="#people"/);
assert.match(render('ops'),/لم تُهيأ خدمات طلب/);assert.match(render('other'),/الإدارة غير متاحة/);
assert.doesNotMatch(render('hr',{me:{...me,role:'admin'}}),/data-action="new-request"|href="#people"/);
assert.doesNotMatch(malicious,/<img/);assert.match(malicious,/&lt;img/);
// tests/service-catalog.test.mjs
assert.equal((home.match(/class="department-card"/g)||[]).length,companyDepartments.length);
```

الأثر: في `departmentDirectory` يجب أن يبقى `class="department-card"` **صنفًا وحيدًا حرفيًا** على البطاقة (إضافة صنف ثانٍ تكسر العدّ).

```js
// tests/company-scale.test.mjs
assert.match(launcher,/id="launcher-search"/);assert.match(launcher,/data-action="pick-department" data-id="grc"/);assert.match(launcher,/rq-rail-group/,'departments are grouped by sector in the rail');assert.match(launcher,/الأكثر طلبًا/);
assert.match(legal,/class="rq-row"/,'services render as compact rows');
assert.match(form,/id="request-form"/);assert.match(form,/data-action="launcher-back"/);
assert.doesNotMatch(adminPage,/data-action="pick-service"/);
assert.match(html,/data-filter="#accounts-table"/);assert.match(html,/data-operation="import"/);
```

الأثر: `class="rq-row"` صنف وحيد حرفي كذلك.

```js
// tests/structured-fields.test.mjs  (operations.mjs)
assert.match(html,/data-rows="targets"/);assert.match(html,/data-action="row-add"/);assert.match(html,/<template><tr data-row>/);assert.match(html,/value="400"/);
assert.doesNotMatch(html,/name="metric"|name="target"/,'cells stay out of FormData');
assert.match(html,/value="x" checked/);assert.doesNotMatch(html,/style=/);
// tests/workspace.test.mjs
assert.match(html,/data-width="/);assert.doesNotMatch(html,/ style="/,'no inline styles, the content policy blocks them');
assert.match(html,/data-action="finish-task"/);assert.doesNotMatch(html,/ style="/);
// tests/resourcing.test.mjs
assert.match(html,/class="badge subtle">مبدئي/,'tentative is marked by an existing class, not a colour');
assert.match(html,/class="badge">مؤكد/);
// tests/procurement.test.mjs
assert.ok(!html.includes('<table class="detail-data"'));
// tests/approval-engine.test.mjs
assert.match(html,/data-action="adopt_proposal"/);
// tests/dates.test.mjs
assert.equal(readFileSync(new URL('../app/dates.mjs',import.meta.url),'utf8'),readFileSync(new URL('../app/static/dates.mjs',import.meta.url),'utf8'));
```

### و.5 حظر `style=` و`<script` والموارد الخارجية في مخرجات الشاشات (23 اختبارًا، عدا `motion-cards` و`workspace` و`structured-fields` المذكورة أعلاه)

النمط نفسه في: `accruals` `benefits` `cash-forecast` `client-reports` `close-checklist` `contracts-register` `equipment` `expiry` `governance` `home` `leave-accrual` `lifecycle-bundles` `media-spend` `print-documents` `privacy` `production` `qr` `request-quality` `request-transparency-ui` `resourcing` `search` `tax-returns` `timesheets`. أمثلة حرفية:

```js
assert.ok(!/style=|<script/.test(html),'no inline style and no script: the page runs under a strict content policy');
if(/style=|<script|https?:\/\//i.test(html))problems.push(`${key}: render breaks the content policy`);          // privacy
assert.doesNotMatch(html,/<script|\sstyle=|https?:\/\//,`${who}/${q}: لا سكربت ولا تنسيق داخلي ولا مورد خارجي`);   // search
assert.equal(/style=|<script|https?:\/\//.test(source),false,'no inline style, script, or external resource');  // مصدر request-transparency-ui.mjs
assert.ok(!/<img|style=|<script/i.test(html),'no raw user markup, inline style or script');                     // lifecycle-bundles
assert.equal(qr.svg.includes('style='),false,'the strict content policy allows no inline style');              // equipment
```

### و.6 `tests/ui-render.test.mjs` و`scripts/check.mjs`

```js
const html=module.render(data,{e,button,money});          // توقيع render ثابت: (data,{e,button,money})
if(/\bundefined\b|\bNaN\b|\[object /.test(text))problems.push(…);
if(!spec||typeof spec.title!=='string'||!Array.isArray(spec.fields)||typeof spec.toPayload!=='function'||(!spec.endpoint&&!spec.dynamicEndpoint))problems.push(…);
assert.ok(rendered>60&&forms>120,…);
```

```js
// scripts/check.mjs  (npm run check)
const result=spawnSync(process.execPath,['--check',file],…);                       // كل .mjs يجب أن يجتاز فحص الصياغة
if(path.startsWith('app/')) assert.ok(!source.includes('eval('),'Unexpected dynamic evaluation: '+path);
assert.ok(html.includes('lang="ar"')&&html.includes('dir="rtl"'));                // index.html
```

**ما لا يقيّده أي اختبار (حرية كاملة):** محتوى `signature.css` و`style.css` و`athar.css` و`journey.css` كله، و`signature.mjs` و`athar.mjs` و`journey.mjs` و`brand-logo.mjs` كلها، وقوالب `shell()` و`loginView()` و`pageHead()` في `app.mjs` (ما دامت قيود و.3 محفوظة)، وبقية `index.html` عدا `lang`/`dir` والروابط المخدومة.

---

## ز. أين تُركَّب خلفية `<canvas>` حية بملء الشاشة، ومن يملكها

### ز.1 الموضع: شقيق لـ`#app` داخل `body`، لا داخل الغلاف

- داخل `.shell` أو `.login` **مرفوض**: `#app.innerHTML` يُكتب من جديد مع كل `hashchange` وكل تبديل مظهر أو لغة، فتُهدم اللوحة وتبدأ الحركة من الصفر عند كل تنقل.
- الموضع الصحيح: `<canvas class="sig-aurora" aria-hidden="true">` **أول ابن لـ`body`** قبل `#app`. لوحة واحدة تخدم الدخول والتطبيق معًا وتستمر عبر التنقل. الصنف `.sig-aurora` موجود أصلًا في `signature.css` (`display:none`) من الخلفية السابقة، فلا اسم جديد.
- طريقتان للإنشاء، وكلتاهما بلا تعديل للخادم:
  1. ثابتًا في `index.html` (يظهر قبل إقلاع JS، ويُصمَّم بـCSS فورًا).
  2. أو تنشئه الوحدة المالكة بـ`document.createElement('canvas')` ثم `document.body.prepend()` (كما تضيف `signature.mjs` لوحة البحث و`journey.mjs` نافذتها).
- CSS المطلوب: `position:fixed; inset:0; width:100%; height:100dvh; z-index:0; pointer-events:none`، ومعه `#app{position:relative; z-index:1}`.
- **فخ الرسم:** `body{background:var(--bg)}` و`.login{background:var(--bg)}` اليوم خلفيتان معتمتان. لوحة بـ`z-index:-1` ستختفي خلف خلفية `body` (خلفيات الكتل تُرسم بعد الطبقات السالبة). الحل: إبقاء اللون الأساس على `html` وحده، وجعل `body` و`.login` شفافين، واللوحة عند `z-index:0`.
- أسطح معتمة تحجب الخلفية اليوم ويجب أن يقرر التصميم شفافيتها: `.sidebar` على الجوال (`background:var(--bg)`)، `.side-head`، `#dialog` و`.dialog-head`، `.sig-cmd-box`، `.panel`/`.vn-card` (`--surface`). الشريط الجانبي على المكتب والشريط العلوي وشريط التبويب زجاجية أصلًا (`--material` + `backdrop-filter`) فتُظهر الحركة خلفها مباشرة.
- تمييز المشهد: اللوحة تعرف حالها من DOM دون لمس `app.mjs`: وجود `#app .login` = مشهد الدخول (كثافة كاملة)، ووجود `#app .shell` = مشهد العمل (هادئ خلف المحتوى). تكتب الوحدة المالكة `document.documentElement.dataset.scene='login'|'app'` ليستجيب CSS أيضًا.

### ز.2 الدخول: خياران

| الخيار | الموضع | ما يلزم |
|---|---|---|
| **(موصى به) اللوحة العامة نفسها** | خلف `main.login` كاملًا، والجوال يستفيد أيضًا (اليوم `.login-story` مخفي تحت 1024px فلا يرى الجوال أي هوية) | جعل `.login` و`.login-story` شفافين أو نصف شفافين في CSS. لا تغيير في `app.mjs`. |
| مشهد موضعي داخل `.login-story` | الخطاف جاهز: في `app.mjs` دالة `scene(controls)` تولّد `div.athar-scene[data-athar-scene] > canvas[aria-hidden] + button.athar-motion` لكنها **غير مستدعاة اليوم**، و`loginView()` تستدعي `mountScenes(root)` من `athar.mjs` بعد الرسم (وكذلك `render()`)، مع تنظيف عبر `clearScenes()` | إضافة `${scene(true)}` داخل قالب `.login-story` (آمن في صندوق الاختبار لأن `scene` معرّفة داخل `app.mjs` و`mountScenes` مستبدلة بدالة فارغة)، وإلغاء `display:none` عن `.athar-scene`/`.athar-motion`. عيبه: لا يظهر على الجوال ويُعاد إنشاؤه عند تبديل اللغة/المظهر. |

### ز.3 المالك الموصى به

**المحرك في `athar.mjs`، ودورة الحياة في `signature.mjs`. لا استدعاء من `app.mjs`.**

| الوحدة | الحكم | السبب |
|---|---|---|
| `athar.mjs` — **محرك الرسم** | موصى به | مدرج في القائمة البيضاء، وهو أصلًا وحدة Canvas، ولا يستورده أي اختبار (الاختباران يستبدلان `mountScenes` بدالة فارغة)، فيمكن إعادة كتابته بالكامل. فيه اليوم كل ما تحتاجه خلفية مسؤولة: احترام `prefers-reduced-motion`، إيقاف عند `document.hidden`، `IntersectionObserver`، `ResizeObserver`، سقف `devicePixelRatio` عند 1.75، زر إيقاف يحفظ `36t-motion-paused`، ودالة تنظيف. العقد الوحيد: **يبقى التصدير `mountScenes(container)` ويعيد دالة تنظيف** لأن `app.mjs` يستورده. يُضاف إليه تصدير جديد مثل `mountBackdrop(canvas)`. |
| `signature.mjs` — **المالك التشغيلي** | موصى به | يُحمَّل مباشرة من `index.html` مرة واحدة، ولا يمسه أي اختبار، وهو بتعريفه «طبقة السلوك التي تراقب ما يرسمه `app.mjs`» عبر `MutationObserver` على `#app`، ويملك أصلًا عناصر على مستوى `body`. يستورد `./athar.mjs` (مخدوم، فيمر اختبار `static-modules`) ويركّب اللوحة مرة واحدة عند الإقلاع، ويبدّل المشهد داخل `enhance()`. |
| `motion-cards.mjs` | بديل مقبول بقيود | مدرج ومستورد من `app.mjs`، لكن `tests/motion-cards.test.mjs` يستورده في Node بلا DOM: ممنوع لمس `document` عند مستوى الوحدة، ويجب بقاء `mountCards` و`prefersReducedMotion` بسلوكهما الحرفي. يصلح إن أُريد جمع كل الحركة في ملف واحد، بإضافة تصدير `mountBackdrop` دفاعي. |
| `app.mjs` | **لا** | أي استدعاء لدالة مستوردة جديدة يكسر `ui-race` و`dialog-races` (القسم و.3). |

متطلبات على المحرك أيًا كان مالكه:

1. **الألوان من الرموز:** يقرأ `getComputedStyle(document.documentElement).getPropertyValue('--tint')` وأخواتها، ويعيد القراءة عند تغيّر `data-theme` (`MutationObserver` على سمات `html`) وعند تغيّر `prefers-color-scheme`. لا ألوان مكتوبة في JS.
2. **الحركة المسؤولة:** إطار ثابت واحد عند `prefers-reduced-motion`، وتوقف عند `document.hidden`، واحترام `36t-motion-paused`، وسقف DPR، وتخفيض الكثافة تحت 1024px حفظًا للبطارية.
3. **بلا `style=`:** المقاسات عبر `canvas.width/height` وCSSOM فقط.
4. **الطبقات:** `pointer-events:none` و`aria-hidden="true"`، وإخفاء في `@media print`، وإضافة `.sig-aurora` إلى كتلة `prefers-reduced-transparency` إن لزم.
5. **التكلفة:** `Cache-Control:no-store` يعني إعادة تنزيل الوحدة مع كل تحميل صفحة؛ يُفضَّل محرك صغير مكتوب يدويًا (لا مكتبات، فالمشروع بلا تبعيات وبلا خطوة بناء).

---

## ح. ملخص «ما يجوز وما لا يجوز» لمن سينفّذ التصميم

| يجوز بحرية | يجوز بحذر | لا يجوز |
|---|---|---|
| إعادة كتابة `signature.css` كاملًا وملء `style.css` و`athar.css` و`journey.css` | تعديل قوالب `shell()` و`loginView()` و`pageHead()` و`showDialog()` في `app.mjs` مع حفظ المعرّفات وسمات `data-` وقيود و.3 | حذف أو إعادة تسمية أي صنف من القسم ب |
| إضافة `@font-face` لـAlexandria (400/700) واعتماده خطًا للواجهة | الإضافة إلى `hr-design.css` مع إبقاء سلاسله الثلاث | ملف ثابت باسم جديد دون تعديل `server.mjs` |
| إعادة كتابة `signature.mjs` و`athar.mjs` و`journey.mjs` | إضافة تصديرات إلى `motion-cards.mjs` و`hr-design.mjs` دون تغيير الموجود | سمة `style=` أو `<style>` أو `<script>` داخلي أو مورد خارجي |
| Canvas/WebGL/SVG حي، و`data:` في `background-image`/`mask-image` | إضافة `<link>`/`<canvas>` إلى `index.html` (مع بقاء `lang="ar"` و`dir="rtl"`) | استدعاء دالة مستوردة جديدة من `app.mjs` بلا حراسة، أو `import` متعدد الأسطر فيه |
| تغيير كل الرموز والألوان والانحناءات والحركة | تغيير نقاط الانكسار (مع مزامنة `compact()` في `signature.mjs`) | تعديل `*-ui.mjs` أو `report-print.css` أو `dates.mjs` لأغراض الشكل |
