# depth-A — «عُمق 360» الافتراضي و«الكلاسيكي» خيارًا، ومنتقي التصميم

- التاريخ: 2026-09-19. الفرع `codex/local-foundation` فوق `8e0ccdf`. لا commit ولا push، ولم يُلمس `.env` ولا أي هجرة مطبَّقة (001–094).
- النطاق: الحزمة A وحدها. `depth.css` و`depth-scene.mjs` و`classic.css` و`server.mjs` و`index.html` و`signature.css` و`motion-cards.mjs` ملك وكلاء آخرين ولم أعدّلها.
- تغيّر النطاق أثناء العمل: أُضيف تصميم خامس `classic` (التصميم السابق بطابع أبل) في كل موضع أُضيف فيه `depth`. الترتيب: `['depth','classic','void','field','slate']`. الافتراضي `depth`.

## الملفات

| الملف | التغيير |
|---|---|
| `app/migrations/095-appearance-depth.sql` (جديد) | يعيد بناء `appearance_settings` و`user_appearance` على نمط 030: `RENAME TO …_v1` ← `CREATE` ← `INSERT … SELECT` بأعمدة مسماة ← `DROP`. `CHECK(design IN ('depth','classic','void','field','slate'))` في الجدولين، و`appearance_settings.design DEFAULT 'depth'`. يعيد إنشاء الفهرس الوحيد الذي أنشأته 094 (`user_appearance_tenant`) بعد إسقاط الجدول القديم. 094 لم تُنشئ مشغّلات، ولا جدول آخر يشير إلى الجدولين. |
| `app/preferences.mjs:8,10,13-14` | `DESIGNS` خمسة، `FALLBACK={design:'depth',theme:'dark'}`، مدخلا `depth` («عُمق 360» / `Depth 360`) و`classic` («الكلاسيكي» / `Classic`) في رأس `DESIGN_LIST`. حُذفت من وصف `void` جملة «هذا هو التصميم الأساسي للمنصة» لأنها لم تعد صحيحة. |
| `app/static/theme-boot.js:5` | `D` خمسة، والافتراضي `d='depth'`. |
| `app/static/app.mjs` | انظر أدناه. |
| `app/static/signature.mjs` | انظر أدناه. |
| `app/static/appearance-ui.mjs:12-19,37-40` | لوحتا `depth` و`classic` في `PALETTES` (الفيروزي عبر `var(--brand-turquoise)`، لأن الاختبار يمنع كتابته HEX). حقل اختياري `surface` (+`panel` لنصف القطر) يرسم لوحًا تحت الصفوف: زجاج «عُمق» بلون مصمت تقريبي وبطاقة «الكلاسيكي» المستديرة. `preview()` لا ينهار أمام تصميم أو وضع مجهول: يرسم بلوحة `depth`. |
| `app/static/hr-design.css:23-25,128,221-247,252-253` | داخل `@layer shell`: قواعد `.sig-theme` صارت `.sig-appearance > button` (الأزرار الثلاثة)، وكتلة المنتقي، وسطرا `forced-colors`. |
| `tests/preferences.test.mjs` | تغيير مواصفة مقصود: القوائم والافتراضي (`void`→`depth`، ثلاثة→خمسة، 6→10 معاينات، 36→60 فاصلة، أزرار `choose:`). بقيت كل حالات رفض `neon` وفحوص CSP/الملفات الثابتة. اختباران جديدان (السطران 244 و275). |

### app.mjs
- `:18-19` `DESIGNS` خمسة، والرجوع إلى `depth`.
- `:29-31` `designNames` و`designName()` و`designButton()` (`data-action="design"`, `aria-haspopup="menu"`, `aria-expanded`).
- `:33` رمز `design` (طبقات مكدّسة) في `glyphPaths`.
- `:208-209` `accountRow` يقبل وسيطًا سابعًا للسمات؛ صف «التصميم» بين «الوضع» و«اللغة» (`tint-teal`).
- `:273` شاشة الدخول: أُزيل `themeButton()` من `.login-masthead` المخفية، واستُبدل زر اللغة المنفرد بـ`<div class="login-appearance">` فيه: التصميم، الوضع، اللغة. أسماء `data-action` كما هي.
- `:291-335` القائمة: عنصر واحد `#design-menu[popover=auto][role=menu]` يُلحق بـ`<body>` عند أول فتح فقط. بلا Popover API: سمة `hidden` ومستمع `pointerdown` خارجي يُضاف عند الفتح ويُزال عند الإغلاق. الموضع `top/left` بـCSSOM (بداية القائمة عند حافة بداية الزر، وتنقلب فوقه إن ضاق الأسفل). عناصرها `button[role=menuitemradio][aria-checked][data-action=pick-design][data-value=…]` مع `span.design-swatch.swatch-<key>`. الأسهم/Home/End تنقل التركيز، وEsc/Tab تغلق وتعيد التركيز إلى الزر. الإغلاق يمر بـ`beforetoggle` (متزامن) فيُعاد التركيز قبل أن تختفي القائمة.
- `:350-362` `design`: يفتح/يغلق؛ نقرة الفأرة التي أغلقت القائمة بالنقر خارجها لا تعيد فتحها (`ev.detail>0` خلال 400ms)، وEnter/Space يفتحها دائمًا؛ المقفل ⇒ toast. `pick-design`: يغلق القائمة، المقفل ⇒ toast نفسه بلا تغيير، وإلا `applyAppearance` و`POST /account/appearance` عند الدخول فقط (شاشة الدخول: محليًا/`localStorage`)، ثم إعادة الرسم كفعل `theme`.
- `:472` `hashchange` يغلق القائمة.
- تعبير `destructive` (`:277`) يحوي `void`؛ الفعلان `design` و`pick-design` لا يطابقانه، ومفتاح التصميم في `data-value` وحده. مثبت في اختبار.
- لا شيء جديد يعمل عند تحميل الوحدة: `HTMLElement` و`document.createElement/body` داخل دوال تُستدعى بالنقر فقط، فيبقى صندوق VM في `dialog-races`/`ui-race` سليمًا. لم يُضف أي `document.addEventListener` على المستوى الأعلى (الصندوق يحفظ مستمعًا واحدًا لكل حدث).

### signature.mjs
- `:35` رمز `design`؛ `:340` `designNames` للتسمية فقط (لا فرع سلوك على اسم تصميم، ولا كتابة لـ`data-design`).
- `:349-353` `themeTargets` صار `{theme|design|language:{side,bar,login}}`.
- `:366-370` `rememberAppearanceFocus()` في مرحلة الالتقاط (`:826`): للأزرار الثلاثة، ولـ`pick-design` يُنسب إلى زر التصميم الذي عليه `aria-expanded="true"`.
- `:372-387` `mountAppearanceCluster()` بدل `mountThemeButton()`: `.topbar > .sig-appearance` فيه `.sig-design` (أيقونة) ثم `.sig-theme` ثم `.sig-language` (`EN` / `ع`، مع `lang` و`aria-label`). يُستدعى من `enhance()` (`:786`) ومن مراقب `<html>` (`:898`).
- `:842` Esc داخل `#design-menu` لا يغلق الفهرس الذي فُتحت منه القائمة.

### hr-design.css (المنتقي، لكل التصاميم)
`.sig-appearance` inline-flex بأهداف 44px؛ `#design-menu`: `--canvas`، `--r-float`، حافة `--line`، عرض أدنى 220px، صفوف `--tap`، علامة الاختيار قناع `--m-done` بلون `--action`؛ الدوائر 18px: `swatch-depth` شعاعي فيروزي على شبه أسود، `swatch-classic` أبيض رمادي ناعم بحلقة `--line`، `swatch-void` أسود بحلقة `--line-strong`، `swatch-field` فيروزي، `swatch-slate` `--brand-sky`. لا `display` على القائمة (يبقى `display:none` للمنبثقة المغلقة من المتصفح، و`[hidden]` للبديل). ظهور خفيف بـ`@starting-style` داخل `prefers-reduced-motion:no-preference` فقط. خصائص منطقية، ولا HEX.

## التحقق
- `node --check` على كل ملف معدَّل: سليم. `npm run check`: `Syntax checked: 365 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `tests/preferences.test.mjs`: 10/10.
- الحزمة كاملة **عدا** `tests/static-modules.test.mjs`: `tests 699 · pass 699 · fail 0`.
- `tests/static-modules.test.mjs` يفشل الآن لسبب خارج الحزمة: `index.html` (وكيل آخر) يربط `/depth.css` و`/classic.css` ولم يُكتبا بعد؛ والخادم عند ملف ثابت مفقود في القائمة البيضاء يرمي `ERR_HTTP_HEADERS_SENT` (`server.mjs` في `send`) فيسقط العملية ويعلق الاختبار حتى مهلته. يجب أن يمر حين يصل الملفان؛ ويستحق صاحب `server.mjs` أن يعالج الإرسال المزدوج.
- في متصفح (خادم بقاعدة في الذاكرة، ومحتوى فارغ مؤقت لـ`depth.css`/`classic.css` داخل سكربت المعاينة لا في المستودع): الدخول: الفتح، الأسهم، Esc يعيد التركيز، الاختيار بالفأرة يطبّق ويحفظ في `localStorage` ويعيد التركيز إلى زر التصميم الجديد. بعد الدخول: عنقود الشريط العلوي، الفتح والإغلاق من الزر نفسه، الاختيار يحفظ في الحساب (`/api/me` ⇒ `source:'personal'`) ويعيد التركيز إلى `.sig-design` الجديد. جوال 375: صف «التصميم» في الفهرس، Esc يغلق القائمة ويبقي الفهرس مفتوحًا، الاختيار يبقي الفهرس ويعيد التركيز إلى الصف. زر اللغة في الشريط يبدّل ويرجع.

## ما لم يُتحقق منه / مفتوح
- تفعيل عنصر القائمة بـEnter/Space لم يُختبر آليًا: أداة المتصفح ترسل `keydown` بلا `click` لأي زر (حتى الأزرار القائمة). السلوك هو سلوك `<button>` الأصلي.
- مسار البديل بلا Popover API (سمة `hidden`) لم يُشغَّل في متصفح قديم.
- القائمة لا تتبع الزر عند التمرير أو تغيير المقاس وهي مفتوحة (موضع ثابت لحظة الفتح).
- ألوان `PALETTES` لـ`depth`/`classic` تقديرات من الموجز؛ `soft` و`line` و`marks` اخترتها أنا بما يتسق مع اللوحات القائمة.
- `appearance-ui.mjs` ما زال يقول «زر «الوضع» في الفهرس يبدّل بين الثلاثة»؛ صحيح، ولم أضف ذكرًا لزر التصميم في تلك الشاشة.
- الهجرة 095 تُطبَّق على أي قاعدة محلية عند أول تشغيل للخادم، ولا تُعدَّل بعدها؛ القائمة `('depth','classic','void','field','slate')` نهائية من تلك اللحظة.
