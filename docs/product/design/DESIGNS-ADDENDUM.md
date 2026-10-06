# DESIGNS-ADDENDUM — ملحق التصاميم القابلة للاختيار وقرارات المالك المفوَّضة

- التاريخ: 2026-09-18
- الحالة: **مواصفة. لم يُبنَ شيء منها.** الذي شُغِّل فعلًا شيء واحد: سكربت التباين `work/design-verify/contrast-designs.mjs` (نتيجته الحرفية في §ج.6). لم يُشغَّل `npm test` ولا `npm run check` ولا أي متصفح.
- المرتبة: **عند تعارض هذا الملحق مع `IMPLEMENTATION-PLAN.md` أو `DESIGN-SPEC-36T.md` يُقدَّم الملحق.** عُدِّلت الوثيقتان في مواضعهما لتوافقاه، وما بقي فيهما مخالفًا فهو سهو يُحسم بهذا الملف.
- مصدر القرارات: قال المالك حرفيًا «انت شف وش الافضل ووافق»، فحسم المنسّق البنود أدناه بالتفويض. **التفويض يغلق بنود المواصفة §12 ولا يجعل قيم HEX رسمية:** هي ما زالت تقديرات حتى يؤكدها المالك من دليل الهوية.
- ما قرأته من الكود لكتابة هذا الملحق (قراءة فقط): `app/static/app.mjs` (394 سطرًا) و`app/static/hr-design.mjs` (173) و`app/static/signature.mjs` و`app/static/operations.mjs` و`app/static/index.html` و`app/static/security-ui.mjs` و`app/server.mjs` (الأسطر 108–143 و196–206 و487–522) و`app/totp.mjs` و`app/db.mjs` و`app/migrations/` و`tests/static-modules.test.mjs` و`tests/ui-race.test.mjs` و`scripts/check.mjs` و`docs/implementation/handoff/navigation.md`.

---

## أ. القرارات المغلقة وأثر كل منها

| # | القرار (مغلق، لا يُعاد فتحه) | أثره على المواصفة والخطة |
|---|---|---|
| 1 | الفيروزي `#16A085` الآن، **في رمز واحد** | `--brand-turquoise` هو الموضع الوحيد الذي يُكتب فيه الـHEX في CSS. كل ما كان `#16A085` حرفيًا في §2.2 (`--action` `--turn` `--ring-a` `--horizon` في الكتل الأربع) صار `var(--brand-turquoise)`. **حدّ صريح:** الدرجات المشتقة (`#1BB899` `#138D75` `#15987E` `#12806B` `#0E6B59` `#0B5A4B` `#3CCDB0`) لا تُشتق آليًا (`color-mix()` يحتاج Safari 16.2 والحد الأدنى 15.5)؛ انزياح ±2 مثل `#16A086` لا يمسها، وانزياح أكبر يستلزم إعادة ضبطها بالسكربت. الثابت `TURQUOISE` في رأس `contrast-designs.mjs` هو الموضع الثاني الوحيد، ويُبدَّل معه. الفحمي والسماوي وألوان المناسبات تقديرات المواصفة كما هي |
| 2 | علامة النمط فاصلة الشعار الرباعية | الثابت `MARK` والأقنعة الستة كما في المواصفة. يُعاد النظر عند تسليم ملف النمط المتجهي فقط |
| 3 | `#000` أرضية دائمة للتصميم الافتراضي | لا ألواح رمادية داكنة في «الفراغ». الفحمي لم يُحذف: صار تصميمًا مستقلًا يختاره المستخدم (`slate`) |
| 4 | «الورق» باقٍ، **والافتراضي للجميع هو الفراغ الداكن مهما كان إعداد الجهاز**؛ `auto` اختيار صريح | يُلغى حسم §1.4 بند 8. **تصحيح CSS لازم:** محدِّد كتلة الورق الأولى يصير `@media (prefers-color-scheme:light){:root[data-theme=auto]{…}}` بدل `:root:not([data-theme=dark])`، ومثله كتلة التباين الأعلى النظيرة. بهذا يكون غياب السمة (فشل سكربت الإقلاع) = فراغ داكن، لا ورقًا على جهاز فاتح. في `app.mjs` الافتراضي `'dark'` لا `'auto'` (§هـ.6). وسم `color-scheme` في `index.html` يصير `dark`، ووسم `theme-color` واحدًا بلا `media` (§و.3) |
| 5 | عناوين العرض بوزن 400، و700 للتأكيد والتسميات الصغيرة | «مخالفة معلنة للدليل» في §3.2 صارت قرارًا. حتى بعد تفعيل وزن 300 تبقى عناوين العرض 400 |
| 6 | المثبَّت Alexandria 400 و700 فقط. ملفات `.part` الثمانية نزّلها المنسّق من fontsource ولم تُفعَّل (أوقفته بوابة أمان) | يُبنى بـ400/700. **رموز وزن جديدة عند A:** `--fw-display:400` `--fw-body:400` `--fw-stage-body:300` `--fw-label:600` `--fw-strong:700`. مع `font-synthesis:none` ووجهَي 400/700 فقط يختار المتصفح 700 لطلب 600، و400 لطلب 300 (خوارزمية مطابقة الوزن)، فالشكل اليوم كما في المواصفة. إن فعّل المالك الملفات لاحقًا (إعادة تسمية + أربع قواعد `@font-face` + أربعة مداخل في `server.mjs`) تحسّن الشكل بلا تعديل أي قاعدة. **ممنوع الآن:** الإشارة إلى `.part`، أو `@font-face` لوزن بلا ملف. `--fw-label` لـ`--fs-label` و`--fs-cap` و`--fs-title`؛ `--fw-stage-body` لـ`--fs-body-l` وحدها |
| 7 | الانحناءات كما في المواصفة | `--r-pill:999px`؛ `--r-float:24px` لزاويتي صفيحة الجوال العلويتين؛ حوار المكتب مربع |
| 8 | للأصفر دور واحد: الوقت والانتباه | كما في §1.3 قانون 6 و§1.4 بند 3. على الأرض الفيروزية في تصميم `field` يسقط الأصفر (1.98:1) وتحمل العلامةُ والكلمةُ المعنى (§ج.4) |
| 9 | «تعزية» معكوسة | `--condolence-block`/`--occasion-condolence-ink`: أبيض بحبر أسود على الأراضي الداكنة، وأسود بحبر أبيض على الأراضي الفاتحة، في التصاميم الثلاثة |
| 10 | شعار «الورق» أسود كامل الآن | رمز جديد `--logo:var(--ink-1)` يستهلكه B (`.brand-svg`) وE (الدخول)؛ يصير أبيض على الأرض الفيروزية وحدها. لا تعديل على `brand-logo.mjs` |
| 11 | التنقل أُعيد بناؤه بعد كتابة الخريطة: 113 مدخلًا في ثماني مجموعات بعناوين فرعية | بند «الشاشات الـ64» مغلق. التصحيحات في §و |
| 12 | ترتيب `#inbox` والعودة بعد القرار **لا يتغيران** | الحبّة الفيروزية على أول صف في `#inbox` (§7.2 بند 4) تبقى مشروطة بتحقق الترتيب؛ إن لم يتحقق C منه قراءةً يكتب روابط الصفوف كلها نصية ويذكر ذلك في تسليمه |
| 13 | لا صور موظفين، ولا تغيير على نصوص الخادم | الأفاتار حرف أول كما اليوم |
| 14 | المرحلة الثانية ومسار الطباعة خارج النطاق | شاشة «المظهر» وحدة **جديدة** لا تعديل وحدة قائمة، فلا تخالف هذا البند |
| 15 | سطر القفل اللاتيني 12px مقبول | بلا تغيير |
| 16 | `app.mjs` تكتب `data-inbox` داخل معالج `/inbox/count` | تعديل B الثاني كما في الخطة؛ السطر ما زال 207 |
| 17 | ثلاثة تصاميم قابلة للاختيار داخل نظام VOID 360 الواحد | §ب و§ج و§د |
| 18 | شاشة «المظهر» (`appearance`) وتفضيل محفوظ على الخادم | §هـ (حزمة جديدة G) |

**شرط الخطة «لا بناء قبل توقيع المالك على البنود 1–9 و16» مستوفى بالتفويض.** الذي يبقى بيد المالك وحده: تأكيد قيم HEX الرسمية، وتسليم ملف النمط المتجهي، وتفعيل ملفات الخط.

---

## ب. عقد `data-design`

### ب.1 القيم
| القيمة | الاسم | الوضع الداكن | الوضع الفاتح | مشاهد المسرح |
|---|---|---|---|---|
| `void` (الافتراضي، وغياب السمة يساويه) | الفراغ | `#000` | «الورق» `#FFF` | كما في المواصفة |
| `field` | الحقل 77 | فحمي `#353535` | ورق الهوية `#FAF9FF` | **أرض فيروزية** في الدخول ومشهد الفهرس وبطل الرئيسية/البوابة، في الوضعين معًا |
| `slate` | الفحمي | فحمي `#353535` | الرمادي السماوي `#DDE6ED` | كما في «الفراغ»: الدخول أسود دائمًا |

`data-theme` تبقى `auto|dark|light` بمعناها. التصميم × الوضع = ست تركيبات، وكلها **DOM واحد وJS واحد وعقد أصناف واحد**.

### ب.2 من يكتب السمتين ومتى
1. **`/theme-boot.js`** (ملف جديد، مالكه F): سكربت كلاسيكي حاجب للرسم، **أول عنصر `<script>` في `<head>` وقبل روابط CSS**. مسموح بـCSP الحالية (`script-src 'self'`). يقرأ `localStorage` ويكتب `data-design` و`data-theme` على `<html>` قبل أول رسم. النص الكامل:
```js
/* /theme-boot.js — classic script, render-blocking, first script in <head>, before the stylesheets. No import, no network, no DOM read beyond <html>. */
(function(){
  var D=['void','field','slate'],T=['auto','dark','light'],d='void',t='dark';
  try{var a=localStorage.getItem('36t-design'),b=localStorage.getItem('36t-theme');if(D.indexOf(a)>-1)d=a;if(T.indexOf(b)>-1)t=b;}catch(e){}
  var h=document.documentElement;h.setAttribute('data-design',d);h.setAttribute('data-theme',t);
})();
```
2. **`app.mjs` عند الإقلاع** (تعديل B-3): القراءة نفسها بالتحقق نفسه، فتبقى المنصة صحيحة لو لم يُحمَّل `theme-boot.js`.
3. **`app.mjs` عند وصول حمولة المستخدم** (تعديل B-4، بعد `/api/me` وبعد `/api/login`): `applyAppearance(me.appearance)` تكتب السمتين وتحدّث مفتاحَي `localStorage`.
4. **`app.mjs` عند الحفظ** (B-5 وB-6) وعند المعاينة الحية (B-7).

لا يكتب `signature.mjs` أيًّا من السمتين؛ **يراقبهما** (§و.3).

### ب.3 ترتيب الحسم
`اختيار المستخدم الشخصي (إن لم يُقفل) ← افتراضي الشركة ← void/dark`. الحسم **على الخادم** (`effectiveAppearance`)، والواجهة تطبّق `me.appearance` كما وصل ولا تعيد الحساب. قبل الدخول لا حمولة، فيحكم `localStorage` وحده؛ وعلى جهاز لم يُدخَل منه قط: `void/dark`. لا مسار غير موثَّق يكشف افتراضي الشركة قبل الدخول (قرار مقصود: لا سطح هجوم جديد، والثمن أن أول دخول على جهاز جديد يبدأ من الفراغ).

### ب.4 `localStorage`
| المفتاح | القيم | المعنى |
|---|---|---|
| `36t-design` | `void\|field\|slate` | **مرآة آخر حسم فعّال** على هذا الجهاز (لا «اختيار شخصي» بالضرورة). أي قيمة أخرى تُهمل وتُعامل `void` |
| `36t-theme` | `auto\|dark\|light` | المفتاح القائم نفسه. القيمة المخزنة `auto` اليوم اختيار صريح (الكود الحالي لا يخزنها إلا بعد ضغط الزر)، فتُحترم. غياب المفتاح = `dark` |

لا يُمسحان عند الخروج: صفحة الدخول تحتفظ بشكل آخر مستخدم على الجهاز، ثم تصحح الحمولةُ الشكلَ بعد الدخول. كل قراءة وكتابة داخل `try/catch`.

### ب.5 التركيب مع بقية السمات
- **`data-theme`:** كتل التصميم تُكتب بمحدِّدات المواصفة نفسها مضافًا إليها `[data-design=…]`: الداكن على `:root[data-design=…]`، والفاتح توأمان متطابقان `@media screen and (prefers-color-scheme:light){:root[data-design=…][data-theme=auto]{…}}` و`:root[data-design=…][data-theme=light]{…}`. فحص V لتطابق التوأمين يشمل الأزواج الثلاثة.
- **`data-tier` و`data-density`:** رموز مسافة وكثافة فقط؛ متعامدة مع التصميم، لا تفاعل.
- **`prefers-contrast:more`:** لكل أرض جديدة كتلتها (§ج.5)، وتأتي **بعد** كتل التصميم العادية وقبل كتلة المسرح الفيروزي، ولكتلة المسرح نظيرتها بعدها.
- **`forced-colors:active`:** المتصفح يفرض ألوانه فتختفي الأرض الفيروزية وتبقى البنية؛ لا `forced-color-adjust:none` على أي أرضية. راسم القناع الجديد الوحيد (`.sig-eye::before` في `field`) يُضاف إلى قائمة A في كتلة `forced-colors`.
- **الطباعة:** كل كتل التصاميم داخل `@media screen`، فلا يراها `@media print` ويبقى الورق.
- **النوعية (محسوبة):** كتلة الدخول `:root:has(> body > #app > .login)` = (1,2,1) تغلب `:root[data-design=slate][data-theme=light]` = (0,3,0)، فيبقى دخول `slate` و`void` أسود بلا قاعدة جديدة. كتلة مسرح `field` على الدخول = (1,3,1) تغلب كتلة الدخول. محدِّدا `.is-menu-open` وكتل الفاتح كلها (0,3,0) فيحسمها **ترتيب المصدر**: كتلة المسرح آخرًا.

### ب.6 قاعدة صفحة الدخول
«الدخول فراغ دائمًا» تبقى لتصميمَي `void` و`slate` في الوضعين. في `field` الدخول هو **المسرح الفيروزي** في الوضعين (الكتلة ج.4). لحظة العبور (`html.is-threshold`) بلا تغيير في الثلاثة: في `field` تتصل الأرض الفيروزية بحقل العبور ثم تنكشف أرض العمل.

---

## ج. كتل الرموز الجاهزة للصق

### ج.0 رموز جديدة في كتلة `:root` الأساسية (العقد 1، عند A)
```css
  /* addendum — added to the base :root block */
  --logo:var(--ink-1);              /* brand mark colour; white only on the turquoise stage */
  --ink-display:var(--ink-1);       /* display type >= 36px (login h1, .sig-greeting, .side-title); white on the turquoise stage */
  --ghost:#141414;                  /* giant decorative comma; replaces the literal #141414 */
  --ring-live:1;                    /* 0 = F passes 'off' to the engine for the home scene (field paints an opaque hero band over the canvas) */
  --fw-display:400; --fw-body:400; --fw-stage-body:300; --fw-label:600; --fw-strong:700;   /* 300 -> 400 and 600 -> 700 until the owner activates the font files */
```
ويُضاف `--ghost:#DDE6ED` إلى توأمَي الورق، و`--ghost:#141414` إلى كتلة الدخول. `--logo` و`--ink-display` لا يُكرَّران هناك: الكتل الأربع على `:root` نفسه فيُعاد حل `var(--ink-1)` تلقائيًا.

**مستهلكو `--ink-display` (لا غيرهم):** `h1` الدخول (E)، `p.sig-greeting` (E)، `h2.side-title` (B). كلها ≥ 36px بوزن 400 في كل المقاسات، فتستوفي حد النص الكبير 3:1. **رقم عين الحلقة `.sig-eye b` يبقى `--ink-1`:** ينزل إلى 24px على الجوال وهو معلومة لا عنوان.

### ج.1 الأرض الفحمية — `field` الداكن و`slate` الداكن (كتلة واحدة مشتركة)
توضع كل كتل §ج داخل `@layer tokens`، **بعد** كتل `prefers-contrast:more` الأربع الخاصة بالفراغ، وداخل `@media screen{ … }` واحد.
```css
/* ===== selectable designs (DESIGNS-ADDENDUM §C). All HEX values are estimates. Screen only: print never sees a design. ===== */
@media screen{

/* --- C1 charcoal work surface: field·dark + slate·dark — contrast on #353535 in comments --- */
:root:is([data-design=field],[data-design=slate]){
  color-scheme:dark;
  --canvas:var(--brand-charcoal);
  --ink-1:#FFFFFF;                  /* 12.27 */
  --ink-2:#EBEBEB;                  /* 10.29 */
  --ink-3:#CFCFCF;                  /*  7.87 */
  --ink-4:#B4B4B4;                  /*  5.92 */
  --ink-5:#A3A3A3;                  /*  4.86 floor */
  --line:rgba(255,255,255,.22);     /* = #616161, 1.98 separator */
  --line-strong:rgba(255,255,255,.45); /* = #909090, 3.84 */
  --focus:#FFFFFF;
  --action:var(--brand-turquoise);  /* fill 3.74; label #000 6.40 */
  --on-action:#000000;
  --action-hover:#1BB899;           /* fill 4.88; label 8.36 */
  --action-press:#15987E;           /* fill 3.40; label 5.82 — the void value #138D75 is 2.98 on charcoal and is rejected */
  --turn:#3CCDB0;                   /*  6.16 lightened: not a guideline colour, the price of a charcoal ground */
  --spark:#F1C40F;                  /*  7.38 */
  --stop:#FF9C8F;                   /*  6.08 lightened, same price */
  --ok:var(--ink-2);
  --scrim:rgba(53,53,53,.94);
  --select-bg:#FFFFFF; --select-ink:#000000;
  --ring-a:var(--brand-turquoise); --ring-b:var(--brand-sky); --ring-c:#FFFFFF; --ring-d:#F1C40F; /* 3.74 / 9.71 / 12.27 / 7.38 */
  --horizon:var(--brand-turquoise); /* 3.74 */
  --ghost:#404040;
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%23B4B4B4'/%3E%3C/svg%3E"); /* 5.92 */
  --condolence-block:#FFFFFF; --occasion-condolence-ink:#000000;
}
```

### ج.2 `field` الفاتح — ورق الهوية `#FAF9FF` (توأمان متطابقان)
```css
/* --- C2 field·light: block 1 of 2 (must stay identical to block 2) — contrast on #FAF9FF: ink 20.06/11.72/6.75/5.14/4.78 --- */
@media (prefers-color-scheme:light){:root[data-design=field][data-theme=auto]{
  color-scheme:light;
  --canvas:var(--brand-paper); --ink-1:#000000; --ink-2:#353535; --ink-3:#55595D; --ink-4:#666B70; --ink-5:#6B7075;
  --line:rgba(0,0,0,.26); --line-strong:rgba(0,0,0,.55); --focus:#000000;
  --action:var(--brand-turquoise); --on-action:#000000; --action-hover:#138D75; --action-press:#138D75;
  --turn:#0E6B59; --spark:#7A5C00; --stop:#C0392B; --ok:var(--ink-2);
  --scrim:rgba(250,249,255,.94); --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:var(--brand-turquoise); --ring-b:#353535; --ring-c:#12806B; --ring-d:#7A5C00; --horizon:var(--brand-turquoise); --ghost:#DDE6ED;
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%23666B70'/%3E%3C/svg%3E");
  --condolence-block:#000000; --occasion-condolence-ink:#FFFFFF;
}}
/* --- C2 field·light: block 2 of 2 --- */
:root[data-design=field][data-theme=light]{
  color-scheme:light;
  --canvas:var(--brand-paper); --ink-1:#000000; --ink-2:#353535; --ink-3:#55595D; --ink-4:#666B70; --ink-5:#6B7075;
  --line:rgba(0,0,0,.26); --line-strong:rgba(0,0,0,.55); --focus:#000000;
  --action:var(--brand-turquoise); --on-action:#000000; --action-hover:#138D75; --action-press:#138D75;
  --turn:#0E6B59; --spark:#7A5C00; --stop:#C0392B; --ok:var(--ink-2);
  --scrim:rgba(250,249,255,.94); --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:var(--brand-turquoise); --ring-b:#353535; --ring-c:#12806B; --ring-d:#7A5C00; --horizon:var(--brand-turquoise); --ghost:#DDE6ED;
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%23666B70'/%3E%3C/svg%3E");
  --condolence-block:#000000; --occasion-condolence-ink:#FFFFFF;
}
```
`--ink-4`/`--ink-5` أغمق من «الورق» (`#6B7075`/`#70757A`): قيمة الورق `#70757A` تنزل على `#FAF9FF` إلى 4.44 ✗. **هامش ضيق معلن:** تعبئة الفيروزي على `#FAF9FF` = 3.13 (الحد 3.0). إن أكد المالك فيروزيًا أفتح وسقطت عن 3.0 يُبدَّل `--canvas` هنا إلى `#FFFFFF` (3.28) في سطرين.

### ج.3 `slate` الفاتح — الرمادي السماوي `#DDE6ED` (توأمان متطابقان)
```css
/* --- C3 slate·light: block 1 of 2 — contrast on #DDE6ED: ink 16.62/11.20/7.89/6.25/5.43 --- */
@media (prefers-color-scheme:light){:root[data-design=slate][data-theme=auto]{
  color-scheme:light;
  --canvas:var(--brand-sky); --ink-1:#000000; --ink-2:#2B2B2B; --ink-3:#3F4347; --ink-4:#4D5257; --ink-5:#565B60;
  --line:rgba(0,0,0,.28); --line-strong:rgba(0,0,0,.58); --focus:#000000;
  --action:var(--brand-turquoise-deep); --on-action:#FFFFFF; --action-hover:#0E6B59; --action-press:#0B5A4B;
  --turn:#0B5A4B; --spark:#5E4700; --stop:#A5281B; --ok:var(--ink-2);
  --scrim:rgba(221,230,237,.94); --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:var(--brand-turquoise-deep); --ring-b:#353535; --ring-c:#000000; --ring-d:#5E4700; --horizon:var(--brand-turquoise-deep); --ghost:#C9D6E0;
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%234D5257'/%3E%3C/svg%3E");
  --condolence-block:#000000; --occasion-condolence-ink:#FFFFFF;
}}
/* --- C3 slate·light: block 2 of 2 --- */
:root[data-design=slate][data-theme=light]{
  color-scheme:light;
  --canvas:var(--brand-sky); --ink-1:#000000; --ink-2:#2B2B2B; --ink-3:#3F4347; --ink-4:#4D5257; --ink-5:#565B60;
  --line:rgba(0,0,0,.28); --line-strong:rgba(0,0,0,.58); --focus:#000000;
  --action:var(--brand-turquoise-deep); --on-action:#FFFFFF; --action-hover:#0E6B59; --action-press:#0B5A4B;
  --turn:#0B5A4B; --spark:#5E4700; --stop:#A5281B; --ok:var(--ink-2);
  --scrim:rgba(221,230,237,.94); --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:var(--brand-turquoise-deep); --ring-b:#353535; --ring-c:#000000; --ring-d:#5E4700; --horizon:var(--brand-turquoise-deep); --ghost:#C9D6E0;
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%234D5257'/%3E%3C/svg%3E");
  --condolence-block:#000000; --occasion-condolence-ink:#FFFFFF;
}
```
**استثناء معلن من القانون 3 («نص الزر أسود»):** على `#DDE6ED` فيروزي الهوية تعبئةً = 2.60 ✗، فالتعبئة `--brand-turquoise-deep` (3.84)، والأسود عليها 4.33 ✗، فنص الزر **أبيض** (4.85). لهذا وُجد الرمز `--on-action` أصلًا؛ C لا يكتب لون نص الزر حرفيًا.

### ج.4 مسرح `field` — الأرض الفيروزية (كتلة واحدة للوضعين)
```css
/* --- C4 field stage: login, index scene, home/portal hero — the SAME block in dark and light. Must come AFTER C1–C3 and their contrast blocks (C5). --- */
:root[data-design=field]:has(> body > #app > .login),
:root[data-design=field].is-menu-open,
:root[data-design=field][data-scene=home] #main > .page-head{
  color-scheme:light;
  --canvas:var(--brand-turquoise);
  --ink-1:#000000; --ink-2:#000000; /* 6.40 */
  --ink-3:#0D0D0D;                  /* 5.92 */
  --ink-4:#161616;                  /* 5.52 */
  --ink-5:#1E1E1E;                  /* 5.08 floor; #2A2A2A is already 4.48 */
  --ink-display:#FFFFFF;            /* 3.28 — LARGE TEXT ONLY (>= 36px / 400) */
  --logo:#FFFFFF;                   /* 3.28 graphic */
  --line:rgba(0,0,0,.30);           /* = #0F705D, 1.83 separator */
  --line-strong:rgba(0,0,0,.64);    /* = #083A30, 3.86 */
  --focus:#000000;                  /* 6.40 */
  --action:#000000; --on-action:#FFFFFF;          /* fill 6.40; label 21.00 */
  --action-hover:var(--brand-charcoal);           /* fill 3.74; label 12.27 */
  --action-press:#1A1A1A;                         /* fill 5.31; label 17.40 */
  --turn:#000000; --spark:#000000; --stop:#000000; --ok:#000000;   /* colour collapses to ink: yellow 1.98, red 1.16 on turquoise. Shape + word carry the state */
  --scrim:rgba(0,0,0,.94);
  --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:#FFFFFF; --ring-b:var(--brand-charcoal); --ring-c:#000000; --ring-d:#FFFFFF; /* 3.28 / 3.74 / 6.40 / 3.28 */
  --horizon:#FFFFFF;                /* 3.28 */
  --ghost:var(--brand-turquoise-deep);
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%23000000'/%3E%3C/svg%3E");
}
:root[data-design=field][data-scene=home]{--ring-live:0;}
```
**حسم الأبيض على الفيروزي (صريح):** `#FFF` على `#16A085` = 3.28. فهو **ممنوع نصًّا عاديًا**، ومحجوز لثلاثة: (1) عناوين العرض عبر `--ink-display` (≥ 36px/400، حد النص الكبير 3:1)، (2) الشعار عبر `--logo` (رسم، ≥ 3)، (3) علامات الحلقة والأفق وشَرطة الفهرس (غير نصية، ≥ 3). كل نص آخر على الفيروزي أسود أو شبه أسود ضمن `#000…#1E1E1E` (6.40 إلى 5.08). التسلسل على المسرح الفيروزي بالحجم والوزن لا بدرجة الحبر، وهو القانون 2 نفسه. **والضوء الواحد ينقلب:** الزر الممتلئ الوحيد حبّة سوداء بنص أبيض (21.00)، والفيروزي هو المسرح لا الزر.

**قيدان على من يكتب قواعد داخل `.page-head`:** (1) الرموز أُعيد تعريفها على العنصر لا على `:root`، فالأسماء القديمة (`--bg` `--label` `--tint`…) **لا يُعاد حلها** هناك؛ تُستعمل الأسماء الأصلية فقط. (2) `color` الموروث من `body` قيمة محسوبة لا تتبع الرمز المحلي، فقاعدة B أدناه تعيد `color:var(--ink-2)` على العنصر.

### ج.5 كتل التباين الأعلى للتصاميم
```css
/* --- C5 more contrast: after C1–C3, before C4; the stage twin comes after C4 --- */
@media (prefers-contrast:more){
  :root:is([data-design=field],[data-design=slate]){--line:rgba(255,255,255,.45); --line-strong:rgba(255,255,255,.80); --ink-3:#EBEBEB; --ink-4:#EBEBEB;}   /* 3.84 / 8.52 / 10.29 */
  :root[data-design=field][data-theme=light]{--line:rgba(0,0,0,.55); --line-strong:rgba(0,0,0,.80); --ink-3:#353535; --ink-4:#353535;}                    /* 4.72 / 12.23 / 11.72 */
  :root[data-design=slate][data-theme=light]{--line:rgba(0,0,0,.58); --line-strong:rgba(0,0,0,.82); --ink-3:#2B2B2B; --ink-4:#2B2B2B;}                    /* 4.95 / 11.52 / 11.20 */
}
@media (prefers-contrast:more) and (prefers-color-scheme:light){
  :root[data-design=field][data-theme=auto]{--line:rgba(0,0,0,.55); --line-strong:rgba(0,0,0,.80); --ink-3:#353535; --ink-4:#353535;}
  :root[data-design=slate][data-theme=auto]{--line:rgba(0,0,0,.58); --line-strong:rgba(0,0,0,.82); --ink-3:#2B2B2B; --ink-4:#2B2B2B;}
}
/* …C4 goes here… */
@media (prefers-contrast:more){
  :root[data-design=field]:has(> body > #app > .login),
  :root[data-design=field].is-menu-open,
  :root[data-design=field][data-scene=home] #main > .page-head{--line:rgba(0,0,0,.64); --line-strong:#000000; --ink-3:#000000; --ink-4:#000000; --ink-5:#000000;}   /* 3.86 / 6.40 */
}
} /* end @media screen */
```
ترتيب اللصق النهائي داخل `@media screen`: ج.1 ← ج.2 ← ج.3 ← ج.5 (الكتلتان الأوليان) ← ج.4 ← ج.5 (نظيرة المسرح).

### ج.6 جدول التباين — محسوب اليوم بالسكربت
الأمر: `node work/design-verify/contrast-designs.mjs` ← آخر سطر حرفيًا: **`All pairs with a floor pass.`** ورمز الخروج `0`. (في التشغيل الأول سقط زوج واحد: `--action-press:#138D75` تعبئةً على الفحمي = 2.98؛ استُبدل بـ`#15987E` = 3.40 وأُعيد التشغيل.) السكربت يعيد أيضًا حساب كتلتي «الفراغ» و«الورق» مرجعًا، وأرقامه طابقت §2.3.

| الأرض | أحبار 1→5 | `--turn` / `--spark` / `--stop` | `--line` / `--line-strong` | تعبئة الفعل ← نصها (عادي · مرور · ضغط) | الحلقة a/b/c/d · الأفق | سهم `select` | تباين أعلى (خط / خط قوي / حبر 3–4) |
|---|---|---|---|---|---|---|---|
| فحمي `#353535` (`field`+`slate` داكن) | 12.27 / 10.29 / 7.87 / 5.92 / 4.86 | 6.16 / 7.38 / 6.08 | 1.98 / 3.84 | 3.74←6.40 · 4.88←8.36 · 3.40←5.82 | 3.74 / 9.71 / 12.27 / 7.38 · 3.74 | 5.92 | 3.84 / 8.52 / 10.29 |
| `#FAF9FF` (`field` فاتح) | 20.06 / 11.72 / 6.75 / 5.14 / 4.78 | 6.14 / 5.97 / 5.19 | 1.88 / 4.72 | 3.13←6.40 · 3.94←5.09 · = المرور | 3.13 / 11.72 / 4.64 / 5.97 · 3.13 | 5.14 | 4.72 / 12.23 / 11.72 |
| `#DDE6ED` (`slate` فاتح) | 16.62 / 11.20 / 7.89 / 6.25 / 5.43 | 6.44 / 6.99 / 5.69 | 1.95 / 4.95 | 3.84←4.85 (أبيض) · 5.09←6.43 · 6.44←8.14 | 3.84 / 9.71 / 16.62 / 6.99 · 3.84 | 6.25 | 4.95 / 11.52 / 11.20 |
| فيروزي `#16A085` (مسرح `field`) | 6.40 / 6.40 / 5.92 / 5.52 / 5.08 | 6.40 (كلها حبر) | 1.83 / 3.86 | 6.40←21.00 · 3.74←12.27 · 5.31←17.40 | 3.28 / 3.74 / 6.40 / 3.28 · 3.28 | 6.40 | 3.86 / 6.40 / 6.40 |

الحدود: نص ≥ 4.5 · نص كبير وغير نصي ≥ 3.0 · `--line` فاصل قراءة بلا حد · `--ghost` زخرفة بلا حد (1.18 / 1.21 / 1.17 / 1.48). «تعزية» 21.00 في الأربع.

**مرفوضات محسوبة (مذكورة في السكربت):** `#FFF` نصًّا عاديًا على الفيروزي 3.28 · `#F1C40F` على الفيروزي 1.98 · `#E74C3C` على الفيروزي 1.16 · `#DDE6ED` علامةً على الفيروزي 2.60 · فيروزي الهوية تعبئةً على `#DDE6ED` 2.60 · أسود على `#12806B` 4.33 · `#138D75` تعبئةً على الفحمي 2.98 · `#70757A` على `#FAF9FF` 4.44.

### ج.7 مزيج الحلقة والكوكبة لكل تصميم (77 / 10 / 10 / 3)
| التصميم · الوضع | `--ring-a` 77% | `--ring-b` 10% | `--ring-c` 10% | `--ring-d` 3% (يبدَّل إلى `--stop` عند التأخر) | الفاصلة العملاقة `--ghost` |
|---|---|---|---|---|---|
| `void` داكن · وكل دخول غير `field` | فيروزي | `#DDE6ED` | `#FFFFFF` | `#F1C40F` | `#141414` |
| `void` فاتح | فيروزي | `#353535` | `#12806B` | `#7A5C00` | `#DDE6ED` |
| `field`/`slate` داكن (عمل فحمي) | فيروزي | `#DDE6ED` | `#FFFFFF` | `#F1C40F` | `#404040` |
| `field` فاتح (عمل) | فيروزي | `#353535` | `#12806B` | `#7A5C00` | `#DDE6ED` |
| `slate` فاتح | `#12806B` | `#353535` | `#000000` | `#5E4700` | `#C9D6E0` |
| **مسرح `field`** (دخول، فهرس، بطل) | **`#FFFFFF`** | `#353535` | `#000000` | `#FFFFFF` (والتأخر `#000`) | `#12806B` |

مسرح `field` يعكس النسبة كما تفعل بطاقة العمل والملف: الفيروزي هو الحقل (الـ77 في المساحة)، والعلامات بيضاء وفحمية. المحرك لا يعرف التصاميم: يقرأ الرموز الأربعة بـ`getComputedStyle` كما في المواصفة §4.2، **ويعيد قراءتها عند تغيّر `data-design` كما عند `data-theme`** (§و.3).

---

## د. من يملك كل قاعدة جديدة

| القاعدة | المالك | الملف · الطبقة |
|---|---|---|
| كتل §ج كلها (ج.0–ج.5)، ومنها رموز المسرح على `#main > .page-head` و`--ring-live` | **A** | `signature.css` · `tokens` |
| إضافة `.sig-eye::before` إلى قائمة `forced-colors` | **A** | `signature.css` · `state` |
| `.brand-svg{color:var(--logo)}` و`h2.side-title{color:var(--ink-display)}` | **B** | `hr-design.css` · `shell` |
| أرضية بطل `field` (القاعدة الهيكلية الأولى، أدناه) | **B** (مالك `.page-head`) | `hr-design.css` · `shell` |
| `h1` الدخول و`p.sig-greeting` بـ`var(--ink-display)`، وشعار الدخول بـ`var(--logo)` | **E** | `athar.css` · `stage` |
| الحلقة الساكنة في بطل `field` (القاعدة الهيكلية الثانية، أدناه) | **E** (مالك `.sig-eye`) | `athar.css` · `stage` |
| الفاصلة العملاقة في `.empty` بـ`var(--ghost)` بدل `#141414` | **C** (تخطيط `.empty`) وE (`.empty-symbol`) | كلٌّ في طبقته |
| لا قاعدة لـ`slate`، ولا لـD | — | `slate` رموز فقط |

**القاعدتان الهيكليتان الوحيدتان المقيَّدتان بتصميم** (كلتاهما لـ`field`، وكلتاهما داخل `@media screen`):
```css
/* B — hr-design.css, @layer shell */
@media screen{
:root[data-design=field][data-scene=home] #main > .page-head{
  background-color:var(--canvas); color:var(--ink-2);
  margin-inline:calc(var(--gutter) * -1); padding-inline:var(--gutter);   /* bleeds to the gutter edge; #main already pads by --gutter, so no overflow */
}}
/* E — athar.css, @layer stage: the static ring, because the opaque band hides the canvas (z-index 0, under #app) */
@media screen{
:root[data-design=field][data-scene=home] .sig-eye{position:relative;}
:root[data-design=field][data-scene=home] .sig-eye::before{
  content:""; position:absolute; inset:0; pointer-events:none; background-color:var(--ring-a);
  -webkit-mask:var(--m-tile) 0 0/12px 13.6px repeat, radial-gradient(closest-side,transparent 64%,#000 64.5%,#000 89%,transparent 89.5%);
  -webkit-mask-composite:source-in;
  mask:var(--m-tile) 0 0/12px 13.6px repeat, radial-gradient(closest-side,transparent 64%,#000 64.5%,#000 89%,transparent 89.5%);
  mask-composite:intersect;
}}
```
- **لماذا الأرضية على `.page-head` لا على الـcanvas:** مقروئية النص لا يجوز أن تتوقف على مطابقة صندوق الـcanvas لارتفاع البطل (على الجوال `--hero-h` حد أدنى لا ارتفاع). أسود على فحمي = 1.71.
- **ثمنه:** الـcanvas تحت `#app` فتحجبه الأرضية المعتمة. لذلك `--ring-live:0`: تمرر F المشهد `off` للمحرك (صفر rAF)، ويرسم E الحلقة ساكنةً بقناع CSS: شبكة `--m-tile` نفسها مقنَّعةً بحلقة نصف قطرها الخارجي 89% (= R من مربع 2.24R) وفراغها 64% (= 0.72R)، وهي «الإطار الثابت = نمط الدليل» في المواصفة §1.3 قانون 4. **الفجوة والأقمار لا تُرسم في `field`**؛ لا معلومة تضيع لأن الرقم والجملة في DOM (القانون 7). هذا حدّ معلن لتصميم `field`.
- **استثناءان معلنان:** (1) هذه الأرضية هي «السطح» الوحيد في النظام، وفي `field` وحده (القانون 1). (2) `radial-gradient` داخل `mask` مسموح لهذه القاعدة وحدها إلى جانب `linear-gradient` (فحص V للمحظورات يستثنيها بالاسم).
- قيم القناع وصفة ابتدائية يضبطها E على العين؛ الملكية والمحدِّد والرموز هي الملزمة.

---

## هـ. ميزة «المظهر» — الحزمة G

### هـ.1 الهجرة `app/migrations/094-appearance.sql`
```sql
-- المظهر: افتراضي الشركة وقفله، واختيار كل مستخدم. لا تُعدَّل هجرة قائمة.
CREATE TABLE appearance_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  design TEXT NOT NULL DEFAULT 'void' CHECK(design IN ('void','field','slate')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('auto','dark','light')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT
) STRICT;
CREATE TABLE user_appearance (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  design TEXT NOT NULL CHECK(design IN ('void','field','slate')),
  theme TEXT NOT NULL CHECK(theme IN ('auto','dark','light')),
  updated_at TEXT NOT NULL
) STRICT;
```
لا بذر: غياب الصف = `void/dark` غير مقفل. الصف الشخصي **لا يُحذف عند القفل** (يُتجاهل)، فيعود اختيار المستخدم حين يُرفع القفل. النمط مطابق لـ`security_settings` في الهجرة 035.

### هـ.2 الوحدة `app/preferences.mjs`
```js
export const DESIGNS=['void','field','slate'];
export const THEMES=['auto','dark','light'];
export const FALLBACK=Object.freeze({design:'void',theme:'dark'});

export function companyAppearance(db,tenantId)
// → {design,theme,locked:Boolean,updated_at:String|null,updated_by_name:String|null}; FALLBACK + locked:false when no row.

export function effectiveAppearance(db,u)
// → {design,theme,locked:Boolean,source:'personal'|'company'|'default'}
//   personal row AND company not locked → source 'personal'; else company row → 'company'; else FALLBACK → 'default'.
//   Pure read; called from userView on every /api/me and /api/login, so: two indexed single-row SELECTs, nothing else.

export function appearanceView(db,u)
// → {appearance:effectiveAppearance(db,u), personal:{design,theme,updated_at}|null, company:companyAppearance(db,u.tenant_id),
//    can_manage:isSuperAdmin(u),
//    designs:[{key:'void',name:'الفراغ',latin:'VOID',description},{key:'field',name:'الحقل 77',latin:'FIELD 77',description},{key:'slate',name:'الفحمي',latin:'SLATE',description}],
//    themes:[{key:'dark',name:'داكن'},{key:'light',name:'فاتح'},{key:'auto',name:'يتبع الجهاز'}]}

export function setPersonalAppearance(db,u,input)
// input: exactly {design,theme}  OR exactly {reset:true}. Any other key or value → fail(400,'invalid_fields',…).
// company locked → fail(409,'appearance_locked','المظهر موحّد من إدارة المنصة').
// {reset:true} deletes the caller's row. Upsert otherwise. NOT audited (a mode toggle would flood the audit chain).
// → {appearance:effectiveAppearance(db,u)}

export function setCompanyAppearance(db,admin,input)
// input: exactly {design,theme,locked:Boolean,reason:String (trimmed length >= 10)}.
// !db.isTransaction → fail(500,'transaction_required',…); !isSuperAdmin(admin) → fail(403,'forbidden','افتراضي المظهر للأدمن الأول فقط').
// Upsert appearance_settings; audit(db,admin,'appearance',admin.tenant_id,'appearance.company_default',before,after,reason).
// → {appearance:effectiveAppearance(db,admin)}      // the ADMIN'S OWN effective look, so app.mjs can apply it at once
```
`isSuperAdmin` من `app/access.mjs`، و`audit`/`now`/`fail` من حيث تستوردها `app/totp.mjs` (النمط المرجعي: `setSecurityPolicy`). كل استعلام مقيَّد بـ`tenant_id`.

### هـ.3 المسارات الثلاثة (في `app/server.mjs`، داخل الأقسام القائمة للمسارات الموثَّقة)
| المسار | الصلاحية | الجسم | الرد |
|---|---|---|---|
| `GET /api/appearance` | أي مستخدم موثَّق | — | `appearanceView(db,u)` |
| `POST /api/account/appearance` | أي مستخدم موثَّق + CSRF | `{design,theme}` أو `{reset:true}` | `{appearance}` · 400 · 409 |
| `POST /api/admin/appearance` | الأدمن الأول + CSRF، داخل معاملة كسائر POST | `{design,theme,locked,reason}` | `{appearance}` · 400 · 403 |

بوابة `must_change_password` القائمة (السطر 203) تحجب الثلاثة، وهو المطلوب: الحمولة تحمل المظهر على أي حال.

### هـ.4 الحقل المضاف إلى حمولة المستخدم
في `userView` (السطر 136) حقل واحد: `appearance:preferences.effectiveAppearance(db,u)`. فيصل مع `/api/me` ومع `/api/login` معًا:
```json
"appearance":{"design":"void","theme":"dark","locked":false,"source":"default"}
```

### هـ.5 الشاشة `app/static/appearance-ui.mjs`
عقد وحدات المنصة كما في `security-ui.mjs`: `export const appearanceUI={title,description,load,render,form}`.
- `title:'المظهر'` · `description:'اختر تصميم المنصة ووضعها. يُحفظ اختيارك في حسابك ويتبعك على كل جهاز.'` · `load:api=>api('/appearance')`.
- `render(data,{e,button})` — **أصناف قائمة فقط، لا صنف جديد:**
  1. `section.panel.panel-body.vn-head`: جملة الحال («تصميمك الآن: الفراغ · داكن») ومصدرها (`personal` ← «اختيارك» · `company` ← «افتراضي الشركة» · `default` ← «افتراضي المنصة»)، و`.operation-actions` فيها `button('reset','','العودة إلى افتراضي الشركة')` حين `source==='personal'` فقط.
  2. عند `data.appearance.locked`: `div.vn-alert` «المظهر موحّد من إدارة المنصة.»، وتُحذف أزرار الاختيار الشخصي كلها.
  3. `div.vn-grid` فيها ثلاثة `section.vn-block`، لكل تصميم: `h3` الاسم و`span.badge` «الحالي» على الفعّال، سطر `bdi.ltr` بالاسم اللاتيني، `p` الوصف، **معاينتان SVG** (داكن ثم فاتح)، ثم `.operation-actions` فيها `button('choose',key,'اختيار هذا التصميم')`.
  4. حين `data.can_manage`: `section.vn-block` «افتراضي الشركة» بحاله الحالي وقفله، و`button('company','','تغيير افتراضي الشركة')`.
- **المعاينات:** `<svg role="img" aria-label="…" viewBox="0 0 156 104" width="156" height="104">`، كل لون بسمة عرض (`fill`، `stroke`): مستطيل الأرض، شريط عنوان، أربعة خطوط صفوف، حبّة فعل (`rx="6"`)، وست فواصل بمسار `M5.11 0h8.62L7.4 10H0z` مزاحة بـ`transform`. معاينة `field` يعلوها حقل فيروزي بعنوان أبيض. **الفيروزي يُكتب `fill="var(--brand-turquoise)"`** (الثابت غير الموضوعي، فيبقى القرار 1 برمز واحد)، وبقية ألوان المعاينات حرفية لأنها تصف تصاميم غير الفعّال. **ممنوع:** `style=`، `<style>`، `<script`، `class` جديد، `href`، `<image>`، `<foreignObject>`. 156×2 + فجوة = 320px فتتسع المعاينتان في 343px على الجوال، وإلا التفّتا.
- `form(action,id,data)` — أسماء العمليات الثلاث فقط، **ولا يُسمّى أي منها بكلمة من تعبير `destructive` في `app.mjs:267`، وفيه `void`** (عملية باسم `choose_void` كانت ستأخذ زر «خطر» أحمر؛ لذلك التصميم في `id` لا في اسم العملية):
  - `choose`: `{title:'اختيار التصميم',endpoint:'/account/appearance',submit:'حفظ المظهر',fields:[{name:'design',label:'التصميم',type:'select',value:id,options:data.designs→{value:key,label:name}},{name:'theme',label:'الوضع',type:'select',value:data.appearance.theme,options:data.themes→…,hint:'«يتبع الجهاز» يبدّل بين الداكن والفاتح مع إعداد جهازك.'}],toPayload:v=>({design:v.design,theme:v.theme})}`
  - `reset`: `{title:'العودة إلى افتراضي الشركة',endpoint:'/account/appearance',submit:'العودة إلى الافتراضي',fields:[],toPayload:()=>({reset:true})}`
  - `company` (حين `data.can_manage`): الحقلان نفساهما بقيم `data.company` + `{name:'locked',label:'اختيار الموظفين',type:'select',value:data.company.locked?'1':'0',options:[{value:'0',label:'مسموح: لكل موظف اختياره'},{value:'1',label:'موحّد: الجميع على افتراضي الشركة'}]}` + `{name:'reason',label:'سبب القرار',type:'textarea',hint:'يُسجَّل في سجل التدقيق.'}`؛ `endpoint:'/admin/appearance'`؛ `toPayload:v=>({design:v.design,theme:v.theme,locked:v.locked==='1',reason:v.reason})`.
  - غير ذلك: `throw Error('الإجراء غير متاح. أعد تحميل الصفحة.')`.
- **اسما الحقلين `design` و`theme` عقد:** المعاينة الحية في `app.mjs` (B-7) تقرؤهما بالاسم.

### هـ.6 التعديلات المسمّاة في `app.mjs` (مالكها B؛ **مضمَّنة، بلا أي `import` جديد**)
مع التعديلين القائمين في الخطة (B-1 قالب `shell()`، وB-2 `data-inbox`) تصير التعديلات المسمّاة تسعة، ولا عاشر:

- **B-3 — الإقلاع (السطران 18–19).** يُستبدل السطران بـ:
```js
const DESIGNS=['void','field','slate'],THEMES=['auto','dark','light'];
let theme=localStorage.getItem('36t-theme'),design=localStorage.getItem('36t-design'),clearScenes=()=>{};
if(!THEMES.includes(theme))theme='dark';if(!DESIGNS.includes(design))design='void';
const paintAppearance=()=>{const d=document.documentElement.dataset;d.theme=theme;d.design=design;};
const applyAppearance=a=>{if(!a||!DESIGNS.includes(a.design)||!THEMES.includes(a.theme))return;design=a.design;theme=a.theme;try{localStorage.setItem('36t-design',design);localStorage.setItem('36t-theme',theme);}catch{}paintAppearance();};
paintAppearance();
```
  التحقق من القيم لازم لا تجميل: صندوقا `tests/ui-race.test.mjs:15` و`tests/dialog-races.test.mjs:23` يعيدان `'ar'` من `localStorage.getItem` لكل مفتاح؛ بلا تحقق كانت `data-design="ar"`.
- **B-4 — وصول الحمولة.** بعد `me=auth.user;` في الموضعين (السطر 349 بعد `/login`، والسطر 394 بعد `/me`) وقبل `render()`: `applyAppearance(me.appearance);`
- **B-5 — زر الوضع (السطر 286).** يبقى تبديلًا بتفاعل واحد، ويُحفظ على الخادم:
```js
if(action==='theme'){if(me?.appearance?.locked){toast(tr('المظهر موحّد من إدارة المنصة.','Appearance is set by the platform administrator.'));return;}theme=theme==='light'?'dark':theme==='dark'?'auto':'light';applyAppearance({design,theme});if(me){me.appearance={...me.appearance,design,theme,source:'personal'};api('/account/appearance','POST',{design,theme}).catch(()=>{});}if(dialog.open)dialog.close();me?await render():loginView();}
```
- **B-6 — بعد حفظ نموذج عملية (السطر 377، بعد `const saved=await api(…)`):** `if(saved?.appearance){me.appearance=saved.appearance;applyAppearance(saved.appearance);}` — عام لا يذكر اسم الوحدة؛ المساران يعيدان `{appearance}`.
- **B-7 — المعاينة الحية.** داخل مستمع `change` القائم (السطر 281) فرع جديد: `if(operationView==='appearance'&&ev.target.form?.id==='operation-form'&&['design','theme'].includes(ev.target.name)){const f=ev.target.form,d=document.documentElement.dataset;if(DESIGNS.includes(f.elements.design?.value))d.design=f.elements.design.value;if(THEMES.includes(f.elements.theme?.value))d.theme=f.elements.theme.value;}` وداخل مستمع `close` القائم على الحوار (السطر 392): `paintAppearance();` فيعود الشكل المحفوظ إن أُغلق الحوار بلا حفظ، ويثبت الجديد إن حُفظ (B-6 تسبق الإغلاق). المعاينة تكتب السمتين فقط ولا تلمس `localStorage`.
- **B-8 — مدخل التنقل (بعد السطر 99، تحت «حسابي»، بلا شرط):** `nav.push(['appearance','◑','المظهر','Appearance']);`
- **B-9 — نصوص `shell()` فقط:** تسمية صف الحساب `accountRow('theme',…)` من «المظهر» إلى `tr('الوضع','Mode')` حتى لا يحمل الفهرس صفين باسم «المظهر» (الصف يبدّل الوضع، والشاشة تختار التصميم)؛ و`h2.side-title` من «القائمة» إلى `tr('الفهرس','Index')` و`button.side-done` من «تم» إلى `tr('إغلاق','Close')` كما تنص المواصفة §5.3 (تعارض قائم بين المواصفة والخطة، §ز). نصوص واجهة لا نصوص خادم.

**بعد التعديلات يشغّل B حرفيًا:** `node --check app/static/app.mjs` و`node --test tests/ui-race.test.mjs tests/dialog-races.test.mjs`. لم أشغّل شيئًا منها: لم أعدّل كودًا.

### هـ.7 التعديلات المسمّاة في `hr-design.mjs` (مالكها B)
ثلاث إضافات، ولا رابعة: (1) `'appearance'` في مصفوفة «حسابي» داخل `navGroups` (السطر 118) ← `['حسابي',['security','assistants','appearance']]`؛ بدونها يقع المدخل في مجموعة «أخرى». (2) `'appearance'` في **المصفوفة الأولى** من `allowed()` (السطر 154) حتى لا تظهر «المظهر» خدمةً مشتركة في دليل الإدارات. (3) `appearance:['sliders','indigo']` في `navGlyphs` تحت «1. مساحتي»؛ الرمز `sliders` معرَّف في `glyphs` وغير مستعمل في أي مدخل اليوم (تحققت بالبحث)، فلا تكرار داخل المجموعة.

### هـ.8 التسجيل والقائمة البيضاء (مالكها G)
- `app/static/operations.mjs`: سطر `import { appearanceUI } from './appearance-ui.mjs';` ومدخل `appearance:appearanceUI` في كائن `operationModules` (السطر 68). لا شيء غيرهما.
- `app/server.mjs`، ثلاثة مواضع فقط: (1) `import * as preferences from './preferences.mjs';` والمسارات الثلاثة؛ (2) `'appearance-ui'` في قائمة الوحدات (الأسطر 126–128) و`['/theme-boot.js',['theme-boot.js','text/javascript; charset=utf-8']]` في خريطة `assets`؛ (3) حقل `appearance` في `userView`.
- **تنسيق:** الملف `theme-boot.js` يكتبه F، ومدخله في القائمة البيضاء يكتبه G. `tests/static-modules.test.mjs` **لا يلتقط** غياب المدخل: تعبيره النمطي يطابق `.mjs|css` فقط و`theme-boot.js` ينتهي بـ`.js`. لذلك يتحقق منه اختبار G.

### هـ.9 `tests/preferences.test.mjs` (جديد، مالكه G) — الحد الأدنى
الحسم بترتيبه الثلاثي · القفل يتجاهل الصف الشخصي ولا يحذفه ويعود بعد رفعه · 409 عند الحفظ الشخصي مع القفل · 403 لغير الأدمن الأول على `/api/admin/appearance` · 400 لقيمة خارج القائمتين ولمفتاح زائد ولسبب أقصر من 10 · سطر تدقيق `appearance.company_default` يُكتب، ولا سطر تدقيق للحفظ الشخصي · عزل المستأجر · `/api/me` و`/api/login` يحملان `appearance` بالشكل الرباعي · `GET /theme-boot.js` و`GET /appearance-ui.mjs` يعيدان 200 بنوع `text/javascript` · ناتج `appearanceUI.render` للأدمن وللموظف، مقفلًا وغير مقفل، لا يحوي `style=` ولا `<script` ولا `<style` · `form('choose','void',data)` لا يطابق عنوانه ولا اسم عمليته تعبير `destructive`.

---

## و. تصحيحات الخطة بعد إعادة بناء التنقل (القرار 11)

قرأت `app/static/app.mjs` و`app/static/hr-design.mjs` كما هما اليوم.

### و.1 الواقع الآن
`shell()` تدفع حتى 113 مدخلًا (ويصير 114 مع `appearance`) بشروط تصاريح لكل مدخل. `navGroups` ثماني مجموعات: سبع منها بعناوين فرعية (4 + 2 + 4 + 2 + 2 + 5 + 2 = **21 عنوانًا فرعيًا**) والثامنة «إدارة المنصة» مسطحة. `groupedNavigation()` تلف كل قسم في `div.hr-nav-section` حتى في المجموعة المسطحة (بلا `p.hr-nav-sublabel`). مجموعة تاسعة «أخرى» تظهر لأي مفتاح خارج `navGroups`. ثلاث شاشات مسجلة بلا مدخل: `annotations` و`einvoice-selfcheck` (يعلّم `navView` مدخل الشاشة الأم `review-rounds`/`einvoice` نشطًا) و`search` (لا مدخل نشط له إطلاقًا).

### و.2 مواضع افترضت البنية القديمة، وتصحيحها
| # | الموضع | ما افترضه | التعليمة المصحَّحة |
|---|---|---|---|
| 1 | الخطة، الحزمة B: «`hr-design.mjs`: لا تغيير إطلاقًا» وجدول الملكية «(بلا تغيير)» | ملف مجمَّد | ثلاث إضافات مسمّاة (§هـ.7) ولا غيرها. بنية `navGroups` ومخرجات `groupedNavigation()` و`class="department-card"` الوحيد تبقى حرفيًا |
| 2 | الخطة، الحزمة B: «`app.mjs` — تعديلان مسمّيان، ولا ثالث» | تعديلان | تسعة مسمّاة (§هـ.6). يبقى حرفيًا: لا `import`، لا استدعاء دالة مستوردة جديدة، لا مساس بـ`loginView()` ولا `pageHead()` ولا قالب تفاصيل الطلب، و`<form id=` أول سمة |
| 3 | المواصفة §5.3: «4 أعمدة × 19 سطرًا = 76 مدخلًا بلا تمرير»، و«التصميم يعمل بالمداخل الـ53» | 53 مدخلًا | حساب كامل الصلاحيات يرى نحو 114 مدخلًا + 21 عنوانًا فرعيًا + 8 رؤوس ≈ 143 سطرًا، أي ضعف السعة. **عمود العمل في مشهد الفهرس يتمرر:** B يضع `overflow-y:auto` و`overscroll-behavior:contain` على `.sidebar` (مسموح: القاعدة 0.9 تمنع `overflow` على `body` و`.shell` و`.stage` و`#main` فقط)، ويبقى عمود البيان لاصقًا. قبول B يضيف: حساب الأدمن الأول عند 1440×900 يصل إلى آخر مدخل بالتمرير وبلوحة المفاتيح، و`.side-done` ظاهر دائمًا |
| 4 | الخطة، قبول B: الاختبار بحساب `admin` «كامل الصلاحيات» | الأدمن يرى كل شيء | غير صحيح اليوم: `staff = me.role!=='admin'` يحجب عن الأدمن نحو 30 مدخلًا. فيضان الشريط و`sig-siblings` يُختبر **بحسابين**: الأدمن الأول، وحساب موظف واسع التصاريح (`hr` أو `manager`). قاعدة V فيها خمسة حسابات (admin · hr · employee · manager · accountant)، ولا `it` ولا `pm` |
| 5 | الخطة، F: `sig-siblings` «≤ 7 روابط من `.hr-nav-section` التي تحوي `a.active`» | قسم واحد صغير | يصح بنيويًا. لكن أربعة أقسام تبلغ 7 مداخل بالضبط («اليوم»، «شؤوني»، «الموظفون»، «العملاء والمبيعات») ومعها النشط؛ طيّ `ResizeObserver` إلزامي لا احتياط. وحين **لا `a.active`** (`#search`، `#request/<id>`): يُخفى محتوى الصف ويبقى ارتفاعه `--siblings-h` محجوزًا، بلا خطأ |
| 6 | الخطة، F: `data-sig-group` وزر `sig-siblings-group` يقرآن اسم المجموعة | اسم من `data-group` | يصح: `details.hr-nav-group[data-group]` قائم. يُضاف: المجموعة «أخرى» اسم صالح، والمجموعة المسطحة لا `p.hr-nav-sublabel` فيها فلا يُفترض وجوده |
| 7 | `signature.mjs:112` الخريطة `tabNames` (F) | أسماء التنقل القديمة | التنقل صار `home`=«الرئيسية» و`portal`=«ملخصي» و`work`=«مهامي»، و`tabNames` ما زالت «يومي» و«بوابتي». F يوحّد `tabNames` مع عناوين `nav.push` الحالية (ملفه هو) |
| 8 | الخطة، F: لوحة الأوامر تبني قائمتها من `.nav a` | 53 مدخلًا | تعمل مع 114 بلا تغيير، وتلتقط «المظهر» تلقائيًا. `search` مسجلة بلا مدخل فلا تظهر في اللوحة؛ تسليم التنقل (`navigation.md` §2.4) طلب من مالك `signature.mjs` سطرًا أخيرًا «بحث شامل عن …» ينقل إلى `#search/<الكلمة>` حين لا تطابق شاشة. يضيفه F بـ`textContent`. التسليم نفسه يذكر أن `#search` تفتح لكل الأدوار؛ **لم أتحقق من ذلك على الخادم**، فيتحقق F قبل إظهار السطر للجميع، وإلا يتركه ويذكر ذلك |
| 9 | العقد 2: خرائط `stage`/`ledger`/الحساسة/الفراغ «الجيد» | مفاتيح قد لا توجد | تحققتُ: كل مفتاح في القوائم الأربع موجود في `nav.push` اليوم. `appearance` في `desk` (كل ما سواها)، وليست حساسة |
| 10 | الخطة §5: «إدراج الشاشات الـ64 الغائبة في `nav`» والمواصفة §12 بند 11 | معلّق | مغلق؛ حُذف من «خارج الخطة» |
| 11 | الخطة، B-2: «السطر ~207» | — | ما زال 207 بعد إعادة البناء؛ بعد B-3 (يضيف 4 أسطر) يصير ~211 |

### و.3 إضافات الحزمة F بسبب التصاميم
- `index.html`: `<script src="/theme-boot.js"></script>` **أول سكربت في `<head>` وقبل روابط CSS** (بلا `type=module` ولا `defer` ولا `async`: الحجب مقصود). يُستبدل وسما `theme-color` بوسم واحد `<meta name="theme-color" content="#000000">` بلا `media`، ويصير `<meta name="color-scheme" content="dark">` (حتى لا يرسم المتصفح أرضًا بيضاء قبل وصول CSS على جهاز فاتح؛ خاصية `color-scheme` في الكتل تتولى الباقي).
- `signature.mjs`: `MutationObserver` واحد على `<html>` بـ`attributeFilter:['data-theme','data-design','data-scene']` ← يعيد قراءة ألوان الحلقة ويرسم إطارًا، ويكتب `theme-color` من `getComputedStyle(documentElement).getPropertyValue('--canvas')` (لا لون حرفي في JS؛ في دخول `field` يصير فيروزيًا تلقائيًا). وعند `setScene('home',…)`: إن كانت `--ring-live` تساوي `0` يُمرَّر `'off'`. **لا فرع في JS يذكر اسم تصميم.**
- `node --check app/static/theme-boot.js` يدويًا: `scripts/check.mjs` يفحص `.mjs` فقط.

### و.4 مدخل «المظهر» في خطة التنقل
المفتاح `appearance` · العنوان «المظهر» / `Appearance` · المجموعة «مساحتي» ← العنوان الفرعي «حسابي» بعد `assistants` · ظاهر للجميع بلا شرط (كل الأدوار ومنها الأدمن) · الطبقة `desk`. يلزمه في `hr-design.mjs`: المفتاح في `navGroups`، وفي المصفوفة الأولى من `allowed()`، ورمز في `navGlyphs` (§هـ.7). ويصل إليه المستخدم أيضًا من لوحة الأوامر تلقائيًا.

---

## ز. جدول الملكية المحدَّث

| الحزمة | الملفات المملوكة | المسؤولية |
|---|---|---|
| **A** | `app/static/signature.css` | سطر `@layer` + الرموز **وكتل التصاميم §ج** + الخط ورموز الوزن + الأساس + بدائية سطر الكتابة + الطباعة + نظام الحالة. الهدف ≤ **24KB** (كان 18؛ كتل التصاميم ≈ 6KB) |
| **B** | `app/static/hr-design.css` + **التعديلات التسعة المسمّاة في `app.mjs`** (§هـ.6) + **الإضافات الثلاث المسمّاة في `hr-design.mjs`** (§هـ.7) | الغلاف والتنقل، وأرضية بطل `field` |
| **C** | `app/static/style.css` | المكونات؛ `var(--ghost)` و`var(--on-action)` بلا ألوان حرفية |
| **D** | `app/static/journey.css` | أسطح البيانات؛ لا قاعدة خاصة بتصميم |
| **E** | `app/static/athar.css` + `app/static/motion-cards.mjs` | الحلقة والدخول وأبطال المسرح، والحلقة الساكنة لبطل `field`، و`--ink-display`/`--logo` في الدخول |
| **F** | `app/static/signature.mjs` + `app/static/index.html` + **الجديد `app/static/theme-boot.js`** | سلوك الغلاف والحقن ودورة حياة الحلقة، وسكربت الإقلاع، ومراقبة `data-design` |
| **G** | `app/migrations/094-appearance.sql` + `app/preferences.mjs` + `app/static/appearance-ui.mjs` + `tests/preferences.test.mjs` + **سطر التسجيل في `app/static/operations.mjs`** + **في `app/server.mjs` حصرًا:** المسارات الثلاثة، ومدخلا القائمة البيضاء (`appearance-ui` و`theme-boot.js`)، وحقل `appearance` في حمولة المستخدم | ميزة «المظهر» |
| **V** | `work/design-verify/` فقط | التحقق؛ يضاف `contrast-designs.mjs` (موجود ومشغَّل) وجولة التصاميم الثلاثة |

الاستثناءات التي يفتحها هذا الجدول في قواعد الخطة: القاعدة 0.3 (ملفان ثابتان جديدان: `theme-boot.js` و`appearance-ui.mjs`، بمدخليهما عند G)، والقاعدة 0.4 (`operations.mjs` و`server.mjs` و`hr-design.mjs` تُمس في المواضع المسمّاة فقط، و`tests/preferences.test.mjs` ملف **جديد**؛ كل اختبار قائم يبقى مجمَّدًا). حجم CSS الكلي ≤ **101KB** (كان 95).

**تبعيات G:** لا ينتظر أحدًا. B يكتب ضد شكل الحمولة في §هـ.4، وF ضد اسم الملف، وA ضد §ج. ترتيب الدمج: G (الخادم والهجرة) ← B (`app.mjs`/`hr-design.mjs`) ← F (`index.html`)؛ قبل دمج G تبقى `me.appearance` غائبة و`applyAppearance(undefined)` تعود بلا أثر، فلا ينكسر شيء في الطريق.

---

## ح. تناقضات وجدتها بين المواصفة والخطة والكود

1. **الافتراضي.** المواصفة §1.4 بند 8 و§2.1 («`auto` يتبع النظام») و`app.mjs:18` (`||'auto'`) ضد القرار 4. حُسم: `dark`، مع تصحيح محدِّد كتلة الورق الأولى (§أ بند 4). بدون تصحيح المحدِّد كان غياب السمة على جهاز فاتح يعطي ورقًا.
2. **وسما `theme-color` و`color-scheme` في `index.html`** مبنيان على إعداد الجهاز، فيتعارضان مع افتراضي داكن للجميع. حُسم في §و.3.
3. **عنوان مشهد الفهرس.** المواصفة §5.3 تصممه «الفهرس» و«إغلاق»، و`app.mjs:199` تكتب «القائمة» و«تم»، والخطة تمنع أي تعديل ثالث في `app.mjs`. حُسم بـB-9.
4. **«64 شاشة بلا مدخل» و«53 مدخلًا» وسعة 76 سطرًا** في المواصفة §5.3 و§12 والخطة §5: تقادمت كلها (§و.2 بند 3 و10). و`03-current-ui-map.md` ما زال يحمل الأعداد القديمة ولم أعدّله (ليس من ملفاتي).
5. **`hr-design.mjs` «بلا تغيير»** في الخطة ضد حاجة مدخل `appearance` إلى ثلاث إضافات فيه.
6. **«حساب `admin` كامل الصلاحيات»** في قبول B ضد الكود: الأدمن محجوب عن شاشات `staff`.
7. **`tabNames` في `signature.mjs`** تسمي `home` «يومي» و`portal` «بوابتي»، والتنقل يسميهما «الرئيسية» و«ملخصي».
8. **مصدر ملفات `.part`.** المواصفة §3.5 تقول «مجهولة المصدر»؛ القرار 6 يحدده (fontsource، نزّلها المنسّق، غير مفعَّلة). صُحّح النص.
9. **اللون الحرفي `#141414`** استثناء مسمّى في العقد 1 ضد مبدأ «التصاميم تختلف بالرموز». صار `--ghost`.
10. **الفيروزي في رمز واحد** ضد كتلة §2.2 التي كتبت `#16A085` قيمةً حرفية في 14 موضعًا. صُحّحت إلى `var(--brand-turquoise)`.
11. **`tests/static-modules.test.mjs` لا يرى ملفات `.js`**، فقول الخطة إن الاختبار «يفشل إن استُورد ملف غير مخدوم» لا يشمل `theme-boot.js`. غُطّي باختبار G.
12. **قاعدة الطباعة ونوعية كتل التصاميم:** كتلة `@media print` على `:root` (0,1,0) كانت ستخسر أمام `:root[data-design=…]` (0,2,0). حُسم بوضع كتل التصاميم كلها داخل `@media screen`.
13. **تناقض داخل تكليفي نفسه:** القواعد العامة تقول «لا تلمس `work/`» والتكليف يطلب السكربت تحت `work/design-verify/`. أنشأت هذا المجلد الجديد وحده وملفًا واحدًا فيه، ولم أقرأ أو ألمس أي شيء آخر في `work/`.

## ط. ما لم يُفعل وما لم يُتحقق منه
- لم يُرَ أي من التصاميم الثلاثة في متصفح. أرقام التباين حساب على القيم المكتوبة، لا قياس على شاشة.
- دعم `var()` داخل سمات عرض SVG (`fill="var(--brand-turquoise)"`) و`mask-composite`/`-webkit-mask-composite` على Safari 15.5 **مفترض من المعرفة العامة ولم يُختبر**. إن خذل الأول: يُكتب الفيروزي في المعاينات حرفيًا ويُسجَّل موضعًا ثالثًا للقرار 1. وإن خذل الثاني: تُخفى الحلقة الساكنة في بطل `field` ويبقى الرقم.
- سلوك مطابقة الوزن (600←700، 300←400) مع `font-synthesis:none` من مواصفة CSS Fonts، ولم يُختبر على الخط الفعلي.
- لم أحدّث `STATUS.md` ولا `docs/traceability.json` (خارج ملفاتي).
