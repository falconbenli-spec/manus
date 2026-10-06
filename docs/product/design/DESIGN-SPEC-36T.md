# DESIGN-SPEC-36T — المواصفة النهائية لتصميم منصة 3,6T

- التاريخ: 2026-09-18
- الحالة: **مواصفة مقترحة. لم يُبنَ شيء، ولم يُشغَّل `npm test` ولا `npm run check`.** كل ما فيها التزام تصميمي، لا نتيجة مفحوصة.
- المصادر: الوثائق 01–05 في هذا المجلد، والاتجاهات الأربعة، وأحكام الحكّام الثلاثة (الهوية والإبداع، الاستعمال والعربية، قابلية التنفيذ)، وقراءة مباشرة لـ`index.html` و`signature.mjs` و`attendance-ui.mjs` و`hr-design.mjs` و`server.mjs` وسكربتات `scripts/`.
- حدود الثقة: **كل قيمة HEX للهوية تقديرية** حتى يؤكدها المالك من صفحة الألوان في الدليل. نسب التباين أدناه حسبتُها اليوم بسكربت بصيغة WCAG 2.x على القيم المكتوبة هنا، وتُعاد آليًا عند التأكيد. مقاسات اللقطات البطلة محسوبة على الورق، وعرض حروف Alexandria الفعلي لم يُقَس (لا أداة لقراءة الخط)، فتُراجع في أول نموذج.
- المرجع الحاكم عند التعارض: **`DESIGNS-ADDENDUM.md` أولًا** (قرارات المالك المفوَّضة، والتصاميم الثلاثة القابلة للاختيار، وميزة «المظهر»، وتصحيحات ما بعد إعادة بناء التنقل)، ثم هذه الوثيقة، ثم `03-current-ui-map.md` (العقد الهندسي). ما عُدِّل هنا بسبب الملحق موسوم بـ«[ملحق]».
- المراجعة: طُبّق نقد الاكتمال (45 بندًا) داخل الأقسام نفسها. ما عُدِّل منه أو رُفض مذكور بسببه في §14 «ملاحظات المراجعة».

---

## 1. الفكرة واسم النظام

### 1.1 الاسم

**«الفراغ 360» — VOID 360.**

### 1.2 الفكرة في فقرة

المنصة كواليس مسرح مطفأ الأنوار: فراغ أسود واحد `#000` لا جدران فيه ولا ألواح، يطفو فيه ثلاثة أشياء فقط. **قولٌ واحد كبير** (عنوان أو رقم بوزن 400)، و**العمل نفسه** (صفوف يفصلها خط شعري)، و**بقعة ضوء فيروزية واحدة** على الموضع الذي عليك أن تترك فيه أثرك الآن. توقيع النظام **«الحلقة»**: حلقة 360° مقنَّعة على شبكة نمط 3,6T المتعامدة نفسها، مصنوعة من فاصلة الشعار، يتلاشى حبرها بقانون الدليل المقيس، وتنغلق حين يكتمل العمل. الدراما كلها في **العتبات** (الدخول، بطل الرئيسية، مشهد الفهرس، الفراغ، لحظة العبور)، و**سطح العمل صامت**: لا canvas ولا حركة محيطية فوق أي جدول أو نموذج، وخيط الهوية فيه «أفق» ساكن من الفواصل بـCSS خالص. هكذا يكون التصميم «مثل Dala» بلا لبس (فراغ، حجم، لون فعل واحد، كوكبة هي الهوية) و«3,6T» بلا لبس (الفاصلة، الشبكة المتعامدة، الفيروزي، Alexandria، نسبة 77/10/10/3).

### 1.3 القوانين السبعة

1. **أرضية واحدة.** `--canvas` وحدها في كل شاشة: `#000` في «الفراغ» و`#FFF` في «الورق». لا `surface`، لا بطاقة، لا ظل، لا `backdrop-filter`، لا تدرج، لا zebra، لا غسلة مرور.
2. **الحجم هو التسلسل.** «ما كبُر خفّ، وما صغُر ثقُل»: كل ما هو ≥ 26px بوزن 400، وكل عنوان أو تسمية ≤ 24px بوزن 700، والمتن 400. خط واحد: Alexandria.
3. **الفيروزي له أربعة أدوار فقط:** (أ) الزر الممتلئ الوحيد في المشهد ونصّه أسود، (ب) علامة «دورك» وعدّادها، (ج) الحلقة وأفقها، (د) شَرطة الفهرس تحت الأرقام الكبيرة بلون `--horizon` (مفردة الدليل: «أرقام كبيرة وتحتها شَرطة فيروزية»). ليس رابطًا ولا أيقونة ولا عنوانًا ولا «معتمد» ولا شريط رسم.
4. **العلامة لا تُمال ولا تُبعثر.** كل جسيم فاصلة الشعار بميلها الأصلي، على شبكة متعامدة خطوتها العمودية = 1.13 × الأفقية. النصف الأيسر معكوس الميل كما في حامل البطاقة. حالة السكون هي الشبكة المقنَّعة نفسها، والإطار الثابت هو نمط الدليل.
5. **ثلاث طبقات كثافة، تُقرَّر من خريطة مسارات ثابتة قبل الرسم:** المسرح `stage`، المكتب `desk`، الدفتر `ledger`. لا يتبدل سلّم الخط بعد أول رسم أبدًا.
6. **الاستثناء وحده ملوّن، والحالة شكل + كلمة + لون.** أربعة ألوان في الواجهة كلها: حبر، فيروزي (فعل/دورك)، أصفر (وقت وانتباه)، أحمر (تأخر ومنع ورفض). لا أخضر ولا أزرق ولا برتقالي في حالات التشغيل.
7. **لا معلومة تعيش في الـcanvas وحده.** اختبار القبول: `.sig-aurora{display:none}` لا يُفقد أي شاشة معلومة أو فعلًا.

### 1.4 حسم خلافات الحكّام

| # | الخلاف | القرار | السبب |
|---|---|---|---|
| 1 | حكم الهوية أشاد بـ`h1` 72px في شاشات العمل؛ حكم الاستعمال اشترط ≤ 44px (دفتر ≤ 32px) وبطلًا ثابتًا ≤ 380/200px | **`h1` المكتب 44/30، الدفتر 32/26، بطل الرئيسية 380/200 ثابت.** الدراما تنتقل كاملة إلى العتبات: الدخول 112px وحلقة قطرها 900px، تحية الرئيسية 72px في سطر واحد بالاسم الأول، مشهد الفهرس 72px مع فاصلة عملاقة من 1,500 فاصلة، والفراغ 72px | مطالب الاستعمال غير قابلة للتفاوض. والعتبات كلفتها صفر على المهمة، فتُرفع فيها الجرأة فوق ما اقترحه الاتجاه الفائز بدل توزيعها رقيقةً على مئة شاشة |
| 2 | «لا شاشة بلا هوية» (الهوية) مقابل «لا أفق ولا canvas على المكتب والدفتر» (التنفيذ) | **الأفق بـCSS خالص:** `.page-head::after` بقناع `data:` مكرر (كتلة 17×7 في المكتب، شريط 6px في الدفتر). صفر JS وصفر DOM وصفر `requestAnimationFrame` | يحقق المطلبين معًا، وينجو من إعادة كتابة `#app` مع كل تنقل |
| 3 | الأصفر: «وقت وانتباه» (الهوية) أم «دورك/ينتظرك» (الاستعمال) | **الأصفر = وقت وانتباه فقط. «دورك» فيروزي.** يُحذف البرتقالي والأزرق من حالات التشغيل | حكم الاستعمال اعترض على لونين بمعنيين عند تباين 1.32؛ بحذف البرتقالي يبقى لون انتباه واحد بمعنى واحد. و«دورك» فيروزي يتسق مع الاستعارة ويعالج ندرة الفيروزي |
| 4 | لغة الحالة: ميل الفاصلة «/ \» (الهوية) مقابل «أربعة أشكال فقط تُميَّز عند 10px، والميل وحده فارق ضعيف» (الاستعمال) | **أربعة أشكال مشتقة كلها من الفاصلة ومختلفة في الكتلة لا في الميل:** فاصلة كاملة ممتلئة (اكتمل)، نصف فاصلة مفرّغ (جارٍ/منتظر)، فاصلتان متقابلتان «\/» بشكل V (توقف/رُفض/تأخر)، شَرطة (خامل). والكلمة حاضرة دائمًا | يحفظ اكتشاف «نصفان يلتحمان فيكتملان»، ويحفظ انعكاس الصيغة C، ويبقى مقروءًا عند 10px |
| 5 | «سطر الكتابة» في كل مكان (الفائز) مقابل حقل صندوقي للنماذج (الاستعمال) | **«إطار الكتابة» لكل نماذج العمل:** شفاف بلا تعبئة، حد 1px `--line-strong` (4.43:1)، بلا انحناء، وتركيز بحد 2px + `outline`. **«سطر الكتابة»** للبحث ولوحة الأوامر والدخول والفهرس فقط | عشرون إطارًا شعريًا شفافًا على الأسود ليست «مستطيلات رمادية»، وتحفظ تمييز الحقل في نموذج العشرين حقلًا |
| 6 | الخط الشعري `.14` (نقاء الفراغ) مقابل ≥ `.22` ومؤشر صف ≥ 3:1 (الاستعمال) | `--line` = `.22` (1.79:1)، ومؤشر الصف: الخط نفسه يصير `--line-strong` (4.43:1) مع مسطرة بادئة 2px عند `focus-within`. بلا غسلة | `.14` تقع في منطقة سحق الأسود لشاشات المكتب الرخيصة. الخط الأقوى ما زال خطًّا لا سطحًا |
| 7 | الحوار «بلا صندوق» (الفائز) مقابل حافة مرئية ≥ 3:1 (الاستعمال) وتكلفة `#app{opacity:.06}` (التنفيذ) | **تغيير المشهد عبر `::backdrop` بعتامة `.94`،** والحوار على `--canvas` بحافة 1px `--line-strong` **بلا انحناء على المكتب**؛ الزاويتان العلويتان 24px لصفيحة الجوال وحدها (§12 بند 7) | الأثر البصري نفسه (الصفحة تخفت إلى ~6%) بلا ترقية شجرة `#app` إلى طبقة تركيب، وحدود الحوار مرئية |
| 8 | الداكن للجميع دائمًا (الفائز) مقابل احترام إعداد النظام (الاستعمال) | **[ملحق — نُقض بقرار المالك المفوَّض 4: الافتراضي للجميع الفراغ الداكن مهما كان إعداد الجهاز، و`auto` اختيار صريح في شاشة «المظهر» وزر الوضع؛ كتلة الورق الأولى صارت على `:root[data-theme=auto]`.]** النص الأصلي: **`auto` يتبع النظام.** «الفراغ» هو الأساس في `:root`، و«الورق» عبر `prefers-color-scheme:light` أو `data-theme=light`. **الدخول فراغ دائمًا** بقاعدة CSS لا بـJS. ومفتاح المظهر في الشريط العلوي بتفاعل واحد | يطابق آلية العقد، ولا وميض، والجميع يعبر من الليل نفسه. البديل (الفراغ للجميع) قرار للمالك في §12 |
| 9 | أسماء المجموعات الثماني في الشريط (الاستعمال) مقابل فيضان الشريط لحساب كامل الصلاحيات (التنفيذ) | الشريط: شعار + زر «الفهرس» نصي دائم + `nav.sig-tabs` القائمة (وجهات اليوم، ترتيب ثابت) + بحث + مظهر + حساب. **صف ثانٍ `nav.sig-siblings`**: اسم المجموعة الحالية + ≤ 7 شاشات شقيقة. المجموعات الثماني كلها في مشهد الفهرس | يحفظ التنقل الجانبي بنقرة لموظف الرواتب، ولا يفيض عند 1024/1280/1440، ولا عناصر يتبدل ترتيبها داخل الجلسة |
| 10 | النموذج في «عين الحلقة» (الهوية) مقابل حساب التنفيذ أن بطاقة الدخول الفعلية ≈ 540px فلا تتسع | **على المكتب لا شيء تفاعلي داخل الحلقة.** في العين عنوان العرض وحده (≥ 40px) بحارس قياس، والنموذج في عمود مستقل محمي بمستطيل حظر | لا يعتمد التصميم على اتساع العين، ولا يدفع خطأ الدخول أو توسّع OTP نصًّا إلى نطاق الجسيمات |
| 11 | المحرك في `athar.mjs` (الاتجاهات) مقابل إسناد الخطة المطلوبة `motion-cards.mjs` للمحرك | **المحرك تصديرات جديدة دفاعية في `motion-cards.mjs`**، و`athar.mjs` يبقى بلا لمس | يطابق تقسيم الملفات المطلوب، وخريطة الواجهة عدّته «بديلًا مقبولًا بقيود». القيود: لا لمس لـ`document` عند مستوى الوحدة، وبقاء `mountCards` و`prefersReducedMotion` حرفيًا |
| 12 | تقسيم « · » وكشف `is-num` نصيًّا (الفائز) مقابل رفضه (الحكّام الثلاثة بدرجات) | **لا إعادة كتابة لعقد نصية تنتجها `*-ui.mjs` في المرحلة الأولى.** المعالجة طباعية: سطر عنوان + سطر بيان | صف مكسور أمام مصممين أسوأ من جملة طويلة. العلاج البنيوي مرحلة ثانية تمس `*-ui.mjs` بقرار المالك |
| 13 | زر ＋ دائري في شريط الجوال (الاستعمال، بشرط) مقابل رفضه (الهوية) | **لا FAB.** الفعل الأساسي للشاشة على الجوال زر بعرض كامل تحت العنوان، غير مثبّت | يخفض الكروم السفلي إلى شريط التبويب وحده، ولا تعبئتان متجاورتان تحت الإبهام. الاستثناء الوحيد اللاصق: شريط القرار في تفاصيل الطلب |

---

## 2. Design tokens

### 2.1 آلية المظهر

- `:root` يحمل «الفراغ». «الورق» يُكتب في كتلتين **متطابقتين** (بعد إزالة الفراغات والتعليقات): `@media (prefers-color-scheme:light){:root[data-theme=auto]{…}}` و`:root[data-theme=light]{…}`. فحص آلي يقارن الكتلتين. **[ملحق]** المحدِّد الأول كان `:root:not([data-theme=dark])`؛ صار `[data-theme=auto]` لأن الافتراضي للجميع هو الفراغ الداكن (القرار 4): غياب السمة = فراغ، و`auto` اختيار صريح.
- **[ملحق] التصاميم الثلاثة:** السمة `data-design = void|field|slate` على `<html>` تختار التصميم، و`data-theme` تختار وضعه. `void` هو هذه المواصفة كما هي. كتل `field` و`slate` وقواعد تركيبها وجدول تباينها في `DESIGNS-ADDENDUM.md` §ب و§ج، وكلها داخل `@media screen` بعد كتل هذا القسم.
- القيمة تكتبها `app.mjs`: `document.documentElement.dataset.theme = auto|light|dark` (`localStorage 36t-theme`)، **والافتراضي `dark`**. **[ملحق]** يسبقها `/theme-boot.js` (سكربت كلاسيكي حاجب في `<head>` قبل روابط CSS) فيكتب `data-theme` و`data-design` قبل أول رسم، ثم تصححهما `app.mjs` من `me.appearance` بعد وصول حمولة المستخدم (الملحق §ب.2 و§هـ.6).
- **الدخول فراغ دائمًا بلا وميض** (في `void` و`slate`؛ وفي `field` الدخول مسرح فيروزي — الملحق §ب.6): `:root:has(> body > #app > .login){…قيم الفراغ…}`. نوعيتها (1,2,1) تغلب كتلتي الورق وكتل `slate`.
- `index.html`: **[ملحق]** وسم `theme-color` واحد بلا `media` قيمته `#000000`، و`<meta name="color-scheme" content="dark">`؛ و`signature.mjs` تكتب `theme-color` من قيمة `--canvas` المحسوبة عند تغيّر `data-theme` أو `data-design` أو `data-scene` (الملحق §و.3). الصيغة السابقة (وسمان بحسب إعداد الجهاز) تناقض الافتراضي الداكن للجميع.
- الطباعة دائمًا ورق (`@media print`).
- **التباين الأعلى** (`prefers-contrast:more`) أربع كتل صريحة مكتوبة في §2.2: الفراغ، وكتلتا الورق (لا يصح تعشيشها داخل كتلتي الورق المتطابقتين)، ونظيرة محدِّد الدخول (نوعيته (1,2,1) تلغي ما سواها، فتُكرَّر قيم التباين بالمحدِّد نفسه بعده).
- **طبقات الشلال:** أول سطر في `signature.css` هو `@layer tokens,base,state,components,surfaces,stage,shell,fill,kill;`، وكل قاعدة في الملفات الخمسة تُكتب داخل طبقتها (§2.4). ترتيب الطبقات هو الذي يحسم التعارض، لا ترتيب تحميل الملفات ولا النوعية.

### 2.2 كتلة CSS الجاهزة للصق (`signature.css`)

```css
/* ===== VOID 360 — tokens. All brand HEX values are ESTIMATES until the owner confirms them. ===== */
@layer tokens,base,state,components,surfaces,stage,shell,fill,kill;   /* contract 5 — must stay the first statement */
@layer tokens{
:root{
  color-scheme:dark;

  /* --- brand constants (never themed) --- */
  --brand-turquoise:#16A085;        /* THE ONLY place this HEX is written (owner decision 1). Estimate; measured #16A086. Derived shades below are re-tuned by script only if it moves more than +-2 */
  --brand-turquoise-deep:#12806B;
  --brand-charcoal:#353535;
  --brand-sky:#DDE6ED;
  --brand-paper:#FAF9FF;
  --occasion-reminder:#F1C40F;      /* تذكير */
  --occasion-urgent:#E74C3C;        /* عاجل */
  --occasion-congrats:#F39C12;      /* مبروك — announcements only */
  --occasion-baby-boy:#5DADE2;      /* مولود — announcements only */
  --occasion-baby-girl:#F7C6D9;     /* مولودة — announcements only */
  --occasion-condolence:#000000;    /* تعزية — brand constant; the rendered block uses the themed pair --condolence-block / --occasion-condolence-ink */
  --occasion-circular:var(--brand-turquoise);

  /* --- void (default) — contrast on #000 in comments --- */
  --canvas:#000000;
  --ink-1:#FFFFFF;                  /* 21.00 display, figures, active row */
  --ink-2:#EBEBEB;                  /* 17.62 reading text, table cells */
  --ink-3:#BDBDBD;                  /* 11.18 secondary, .muted */
  --ink-4:#9A9A9A;                  /*  7.46 labels, th, .subtle */
  --ink-5:#7A7A7A;                  /*  4.89 floor: placeholder, disabled, UUID */
  --line:rgba(255,255,255,.22);     /* = #383838, 1.79 reading separator only */
  --line-strong:rgba(255,255,255,.45); /* = #737373, 4.43 control edges, floating edges, row indicator */
  --focus:#FFFFFF;                  /* 21.00 */
  --action:var(--brand-turquoise);                 /*  6.40 vs canvas; label #000 on it = 6.40 */
  --on-action:#000000;
  --action-hover:#1BB899;           /* #000 on it 8.36 */
  --action-press:#138D75;           /* #000 on it 5.09 */
  --turn:var(--brand-turquoise);                   /*  6.40 "your turn" mark + count, as text on void */
  --spark:#F1C40F;                  /* 12.64 time/attention + stage eyebrow */
  --stop:#E74C3C;                   /*  5.50 late, blocked, rejected — text and marks, never a fill */
  --ok:var(--ink-2);                /* approved/paid/done stay quiet */
  --scrim:rgba(0,0,0,.94);
  --select-bg:#FFFFFF; --select-ink:#000000;
  --ring-a:var(--brand-turquoise); --ring-b:#DDE6ED; --ring-c:#FFFFFF; /* 77 / 10 / 10 */
  --ring-d:#F1C40F;                 /* 3 % slot; engine swaps to --stop when late */
  --horizon:var(--brand-turquoise);                /* horizon lattice + index dash */
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%239A9A9A'/%3E%3C/svg%3E"); /* 7.46 */
  --condolence-block:#FFFFFF; --occasion-condolence-ink:#000000; /* 21.00 — inverted on the void (owner decision 9, closed) */
  /* addendum C.0 — tokens the selectable designs need */
  --logo:var(--ink-1);              /* brand mark; white only on the field design's turquoise stage */
  --ink-display:var(--ink-1);       /* display type >= 36px: login h1, .sig-greeting, .side-title */
  --ghost:#141414;                  /* giant decorative comma; replaces the literal #141414 */
  --ring-live:1;                    /* 0 = F passes 'off' to the engine for the home scene */
  --fw-display:400; --fw-body:400; --fw-stage-body:300; --fw-label:600; --fw-strong:700;   /* 300 -> 400 and 600 -> 700 until the extra font files are activated */

  /* --- type: one family, two weights --- */
  --font:"Alexandria","SF Arabic","Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,monospace; /* pre[dir=ltr] only */
  --fs-display-xl:clamp(44px,6.4vw + 20px,112px);   /* 44 → 112  login h1 */
  --fs-display-l:clamp(36px,3.38vw + 23.3px,72px);  /* 36 → 72   home greeting, index, stage empty */
  --fs-display-m:clamp(30px,1.31vw + 25.1px,44px);  /* 30 → 44   desk h1, dialog title, rq question */
  --fs-display-s:clamp(26px,.56vw + 23.9px,32px);   /* 26 → 32   ledger h1 */
  --fs-figure-xl:clamp(40px,4.1vw + 24.6px,84px);   /* 40 → 84   ring eye, ex-figure */
  --fs-figure-l:clamp(36px,1.88vw + 29px,56px);     /* 36 → 56   focal tile */
  --fs-figure-m:clamp(28px,1.13vw + 23.8px,40px);   /* 28 → 40   other tiles */
  --fs-figure-s:clamp(24px,.38vw + 22.6px,28px);    /* 24 → 28   tfoot total, in-card, step-no */
  --fs-title:clamp(20px,.19vw + 19.3px,22px);       /* 700 */
  --fs-body-l:clamp(18px,.19vw + 17.3px,20px);      /* stage paragraphs only */
  --fs-body:16px;                                   /* never below 16: fields, iOS zoom */
  --fs-row:16px;                                    /* 700 row title */
  --fs-table:15px;
  --fs-meta:14px;
  --fs-label:13px;                                  /* 700 — smallest meaningful Arabic */
  --fs-cap:12px;                                    /* 700 — Latin only: kbd, UUID, 360.sa */
  --lh-display:1.25;  /* may be tightened to 1.15 only after the Arabic clipping test passes */
  --lh-title:1.4; --lh-body:1.75; --lh-body-l:1.8; --lh-table:1.5; --lh-figure:1.05;

  /* --- space --- */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s6:24px; --s8:32px; --s10:40px;
  --s14:56px; --s18:72px; --s24:96px; --s30:120px;
  --gutter:16px; --content-max:1280px; --ledger-max:1600px;
  --gap-section:40px;               /* tier + breakpoint overrides below */
  --row-h:52px;                     /* compact density: 44px */
  --tap:44px;

  /* --- radii: almost nothing is round --- */
  --r-0:0; --r-check:4px; --r-float:24px; --r-pill:999px;   /* --r-float: top corners of the phone sheet only; the desktop dialog is square */

  /* --- motion: glide, no bounce --- */
  --ease:cubic-bezier(.2,.8,.2,1);
  --d-micro:120ms; --d-state:200ms; --d-scene:320ms; --d-ring:700ms; --d-threshold:400ms;

  /* --- layout constants --- */
  --topbar-h:52px; --siblings-h:0px; --tabbar-h:64px; --hero-h:200px;   /* --hero-h is a min-height below 1024 */
  --sticky-top:calc(var(--topbar-h) + var(--siblings-h));
  /* sticky ladder (>= 760px only): 1 = filters, 2 = open vn-card summary and page-level th, 3 = th inside an open card */
  --filter-h:0px; --summary-h:64px;
  --stick-1:var(--sticky-top);
  --stick-2:calc(var(--stick-1) + var(--filter-h));
  --stick-3:calc(var(--stick-2) + var(--summary-h));
  --safe-t:env(safe-area-inset-top); --safe-b:env(safe-area-inset-bottom);
  --safe-l:env(safe-area-inset-left); --safe-r:env(safe-area-inset-right);
  --ring-x:50%; --ring-y:150px; --ring-r:190px;   /* LOGIN ONLY, phone; other sizes in athar.css. Home geometry is measured from a.sig-eye (contract 4) */
  --hero-ring-r:60px;               /* home ring radius; a.sig-eye is a square of 2.24 x this (ring + 1.12 halo) */

  /* --- z-index ladder (unchanged contract) --- */
  --z-canvas:0; --z-app:1; --z-topbar:30; --z-tabs:35; --z-scrim:39; --z-index:40;
  --z-skip:100; --z-cmd:110; --z-toast:120; --z-threshold:130;

  /* --- status marks: comma-derived masks, coloured with background-color --- */
  --m-done:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 13.73 10'%3E%3Cpath d='M5.11 0h8.62L7.4 10H0z'/%3E%3C/svg%3E");
  --m-wait:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-1 -1 10.7 12'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='none' stroke='%23000' stroke-width='1.3'/%3E%3C/svg%3E");
  --m-turn:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z'/%3E%3C/svg%3E");
  --m-stop:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 10'%3E%3Cpath d='M0 0h4.6L8 10H5.2zM16 0h-4.6L8 10h2.8z'/%3E%3C/svg%3E");
  --m-idle:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 13.73 10'%3E%3Cpath d='M0 4h13.73v2H0z'/%3E%3C/svg%3E");
  --m-tile:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='13.6' viewBox='0 0 12 13.6'%3E%3Cpath d='M4.7 4.2h4.5L6.6 9.4H2z'/%3E%3C/svg%3E"); /* horizon lattice cell, pitch 12 x 13.6 = 1 : 1.13 */

  /* --- legacy aliases: nothing that reads the old names breaks --- */
  --bg:var(--canvas); --surface:transparent; --surface-2:transparent; --surface-raised:transparent;
  --material:var(--canvas); --material-thick:var(--canvas); --material-edge:transparent;
  --shadow-float:none; --shadow-bar:none;
  --label:var(--ink-1); --label-2:var(--ink-3); --label-3:var(--ink-4); --label-4:var(--ink-5);
  --separator:var(--line); --separator-opaque:var(--line);
  --tint:var(--action); --tint-fill:var(--action); --on-tint:var(--on-action); --brand-deep:var(--brand-turquoise-deep);
}

/* --- paper: block 1 of 2 (must stay byte-identical to block 2) — contrast on #FFF --- */
@media (prefers-color-scheme:light){:root[data-theme=auto]{   /* addendum: was :root:not([data-theme=dark]); the default for everyone is the dark void, auto is an explicit choice */
  color-scheme:light;
  --canvas:#FFFFFF;
  --ink-1:#000000;                  /* 21.00 */
  --ink-2:#353535;                  /* 12.27 brand charcoal is the reading ink */
  --ink-3:#55595D;                  /*  7.06 */
  --ink-4:#6B7075;                  /*  5.00 */
  --ink-5:#70757A;                  /*  4.65 */
  --line:rgba(0,0,0,.26);           /* = #BDBDBD, 1.88 */
  --line-strong:rgba(0,0,0,.55);    /* = #737373, 4.74 */
  --focus:#000000;
  --action:var(--brand-turquoise);                 /* fill vs canvas 3.28 (non-text ≥3); label #000 = 6.40 */
  --action-hover:#138D75;           /* darken on paper: vs canvas 4.12, #000 on it 5.09 */
  --action-press:#138D75;
  --turn:#0E6B59;                   /*  6.43 turquoise text is never #16A085 on white */
  --spark:#7A5C00;                  /*  6.25 text AND marks: a #F1C40F mark on white is 1.66 and would erase half the status system */
  --stop:#C0392B;                   /*  5.44 */
  --scrim:rgba(255,255,255,.94);
  --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:var(--brand-turquoise); --ring-b:#353535; --ring-c:#12806B; --ring-d:#7A5C00; /* decorative marks: 3.28 / 12.27 / 4.85 / 6.25 — all visible, no occasion orange */
  --horizon:var(--brand-turquoise);                /* 3.28 decorative (non-text >= 3): identity turquoise, not the x0.8 shade */
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%236B7075'/%3E%3C/svg%3E"); /* 5.00 */
  --condolence-block:#000000; --occasion-condolence-ink:#FFFFFF; /* 21.00 */
  --ghost:#DDE6ED;
}}
/* --- paper: block 2 of 2 --- */
:root[data-theme=light]{
  color-scheme:light;
  --canvas:#FFFFFF; --ink-1:#000000; --ink-2:#353535; --ink-3:#55595D; --ink-4:#6B7075; --ink-5:#70757A;
  --line:rgba(0,0,0,.26); --line-strong:rgba(0,0,0,.55); --focus:#000000;
  --action:var(--brand-turquoise); --action-hover:#138D75; --action-press:#138D75;
  --turn:#0E6B59; --spark:#7A5C00; --stop:#C0392B;
  --scrim:rgba(255,255,255,.94); --select-bg:#000000; --select-ink:#FFFFFF;
  --ring-a:var(--brand-turquoise); --ring-b:#353535; --ring-c:#12806B; --ring-d:#7A5C00; --horizon:var(--brand-turquoise);
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%236B7075'/%3E%3C/svg%3E");
  --condolence-block:#000000; --occasion-condolence-ink:#FFFFFF;
  --ghost:#DDE6ED;
}
/* --- login is always the void (designs void and slate; the field design overrides it, addendum C.4), decided in CSS so there is no white first frame --- */
:root:has(> body > #app > .login){
  color-scheme:dark;
  --canvas:#000000; --ink-1:#FFFFFF; --ink-2:#EBEBEB; --ink-3:#BDBDBD; --ink-4:#9A9A9A; --ink-5:#7A7A7A;
  --line:rgba(255,255,255,.22); --line-strong:rgba(255,255,255,.45); --focus:#FFFFFF;
  --action:var(--brand-turquoise); --action-hover:#1BB899; --action-press:#138D75;
  --turn:var(--brand-turquoise); --spark:#F1C40F; --stop:#E74C3C;
  --scrim:rgba(0,0,0,.94); --select-bg:#FFFFFF; --select-ink:#000000;
  --ring-a:var(--brand-turquoise); --ring-b:#DDE6ED; --ring-c:#FFFFFF; --ring-d:#F1C40F; --horizon:var(--brand-turquoise);
  --select-arrow:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.62 10'%3E%3Cpath d='M0 0h8.62L2.29 10z' fill='%239A9A9A'/%3E%3C/svg%3E");
  --ghost:#141414;
}

/* --- breakpoints: 760px and 1024px only; JS compact() = (max-width:1023.98px) must match --- */
@media (min-width:760px){:root{--gutter:32px; --gap-section:56px; --hero-ring-r:96px;}}
@media (min-width:1024px){:root{
  --gutter:64px; --gap-section:64px; --topbar-h:64px; --siblings-h:44px; --hero-h:380px;
  --hero-ring-r:min(176px,calc((var(--hero-h) - 48px)/2.24));   /* = 148px at 380 */
}}
/* --- density tiers: set synchronously from a static route map, never after data arrives --- */
:root[data-tier=stage]{--gap-section:56px;}
:root[data-tier=ledger]{--gap-section:24px; --row-h:44px;}
@media (min-width:1024px){
  :root[data-tier=stage]{--gap-section:96px;}
  :root[data-tier=ledger]{--gap-section:36px; --gutter:40px; --content-max:var(--ledger-max);}
}
:root[data-density=compact]{--row-h:44px;}
:root[data-tier=ledger][data-density=cozy]{--row-h:52px;}   /* an explicit "cozy" choice wins over the ledger default (04 §24); the attribute is absent until the user chooses */
/* --- the filter rung exists only where a filter exists, otherwise the summary would stick 44px too low --- */
:root:has(#main :is(.sig-filter,.filters,.acc-filter)){--filter-h:44px;}

/* --- more contrast on request: four explicit blocks (they cannot be nested inside the two identical paper blocks) --- */
@media (prefers-contrast:more){:root{
  --line:rgba(255,255,255,.45); --line-strong:rgba(255,255,255,.75); --ink-3:#EBEBEB; --ink-4:#EBEBEB;   /* 4.43 / 11.42 */
}}
@media (prefers-contrast:more) and (prefers-color-scheme:light){:root[data-theme=auto]{
  --line:rgba(0,0,0,.55); --line-strong:rgba(0,0,0,.80); --ink-3:#353535; --ink-4:#353535;               /* 4.74 / 12.63 */
}}
@media (prefers-contrast:more){:root[data-theme=light]{
  --line:rgba(0,0,0,.55); --line-strong:rgba(0,0,0,.80); --ink-3:#353535; --ink-4:#353535;
}}
@media (prefers-contrast:more){:root:has(> body > #app > .login){   /* same (1,2,1) selector, later in source, so it wins over the login block */
  --line:rgba(255,255,255,.45); --line-strong:rgba(255,255,255,.75); --ink-3:#EBEBEB; --ink-4:#EBEBEB;
}}
/* addendum: the field and slate design blocks (DESIGNS-ADDENDUM §C.1–C.5) are pasted HERE, inside one @media screen{…} */
} /* end @layer tokens */

/* --- forced colours: masks are painted with background-color, which the UA overrides, so opt the marks out --- */
@layer state{@media (forced-colors:active){
  :is(.badge,.vn-flag,.ex-flag,.status-dot,[class*="is-"],.vn-step,.journey-step,.ex-step,.vn-days > *)::before,
  .page-head::after,.empty-symbol::before,.loading::before{forced-color-adjust:none; background-color:CanvasText;}
  .btn{border:1px solid CanvasText;}
}}
```

ملاحظات على الكتلة:
- **[ملحق]** الفيروزي يُكتب مرة واحدة في `--brand-turquoise` وتشير إليه `--action` و`--turn` و`--ring-a` و`--horizon` بـ`var()`. كتلتا الورق ما زالتا متطابقتين بعد التعديل (أُضيف `--ghost` إلى كلتيهما).
- السلسلة `xmlns='http://www.w3.org/2000/svg'` داخل `data:` ليست طلبًا شبكيًا، وهي مستعملة اليوم في سهم `select`. فحص «لا موارد خارجية» يستثنيها نصًّا.
- كتل `prefers-contrast:more` الأربع مكتوبة أعلاه صراحةً. نظيرة الدخول تكرر محدِّد `:has()` نفسه وتأتي بعده في المصدر، وإلا ألغتها نوعية كتلة الدخول.
- `forced-colors:active`: الحالة تبقى مقروءة لأنها شكل + كلمة، **بشرط** أن تُستثنى العلامات من الفرض: `forced-color-adjust:none; background-color:CanvasText` على كل عنصر يرسم بقناع (الوصفة السابقة `auto` كانت تفرض `background-color` فتُخفي كل العلامات). الأزرار بحد `1px solid CanvasText`. قائمة المحدِّدات في الكتلة أعلاه يكمّلها A من جدول مالكي العلامات (§6.4).
- **علامة `--spark` تأخذ `var(--spark)` دائمًا**، في الفراغ والورق. لا استثناء «زخرفي» للعلامة الصفراء على الأبيض (1.66:1): الشكل يحمل المعنى.
- سهم `select` رمز `--select-arrow` لكل مظهر (الفراغ 7.46، الورق 5.00). لا لون مكتوب داخل `data:` في قاعدة المكوّن.
- `--filter-h` يساوي صفرًا ما لم تحمل الشاشة مرشّحًا لاصقًا؛ بذلك لا يترك الملخص اللاصق فراغًا فوقه في الشاشات التي لا مرشّح فيها.

### 2.3 جدول التباين (محسوب اليوم)

| الزوج | النسبة | الحكم |
|---|---|---|
| `#EBEBEB` / `#BDBDBD` / `#9A9A9A` / `#7A7A7A` على `#000` | 17.62 / 11.18 / 7.46 / 4.89 | نص ✓ |
| `#16A085` على `#000` (علامة «دورك» وعدّادها) | 6.40 | نص ✓ |
| `#000` على `#16A085` / `#1BB899` / `#138D75` (نص الزر) | 6.40 / 8.36 / 5.09 | ✓ |
| `#FFF` على `#16A085` | 3.28 | **ممنوع دون 24px/400 أو 19px/700**؛ يظهر فقط في لحظة العبور (الشعار) |
| `#F1C40F` / `#E74C3C` على `#000` | 12.64 / 5.50 | نص ✓ |
| `--line` `.22` على `#000` / `.26` على `#FFF` | 1.79 / 1.88 | فاصل قراءة، لا يحمل معنى |
| `--line-strong` `.45` على `#000` / `.55` على `#FFF` | 4.43 / 4.74 | حدود تحكم ومؤشر صف ✓ (≥ 3:1) |
| الورق: `#353535` / `#55595D` / `#6B7075` / `#70757A` على `#FFF` | 12.27 / 7.06 / 5.00 / 4.65 | نص ✓ |
| الورق: `#0E6B59` / `#12806B` / `#7A5C00` / `#C0392B` على `#FFF` | 6.43 / 4.85 / 6.25 / 5.44 | نص ✓ |
| الورق: تعبئة `#16A085` مقابل `#FFF` | 3.28 | غير نصي ✓؛ نصها `#000` = 6.40 |
| الورق: علامات الحلقة `#16A085` / `#353535` / `#12806B` / `#7A5C00`، والأفق وشَرطة الفهرس `#16A085` | 3.28 / 12.27 / 4.85 / 6.25 | زخرفية، وكلها مرئية (≥ 3). استُبعد `#DDE6ED` (1.26) والبرتقالي `#F39C12` (محظور خارج التعاميم) |
| سهم `select`: `#9A9A9A` على `#000` / `#6B7075` على `#FFF` | 7.46 / 5.00 | عنصر تحكم ✓ (كان `#9A9A9A` على الأبيض 2.81 ✗) |
| علامة `--spark` على الورق: `#7A5C00` (بدل `#F1C40F` = 1.66 ✗) | 6.25 | علامة حالة ✓ |
| «تعزية»: `#FFF` على كتلة `#000` (الورق) / `#000` على كتلة `#FFF` (الفراغ) | 21.00 / 21.00 | نص ✓ (الفحمي `#353535` على `#000` = 1.71 ✗) |
| تباين أعلى: `--line` / `--line-strong` — الفراغ `.45`/`.75`، الورق `.55`/`.80` | 4.43 / 11.42 — 4.74 / 12.63 | ✓ |
| `#353535` على `#000` | 1.71 | **لا يُستعمل حبرًا للجسيمات** (استُبدل بالأبيض) |
| فحمي `#353535` على أصفر / برتقالي / أزرق / وردي المناسبات | 7.38 / 5.59 / 4.99 / 8.20 | وحدة التعاميم ✓ |
| `#000` على `#E74C3C` | 5.50 | وحدة التعاميم «عاجل» ✓ |

### 2.4 طبقات الشلال (`@layer`) — العقد الخامس

`@layer tokens,base,state,components,surfaces,stage,shell,fill,kill;` هو أول سطر في `signature.css`، وهو الملف الأول تحميلًا، فيثبت الترتيب للملفات الخمسة. الطبقة اللاحقة تغلب السابقة مهما كانت النوعية.

| الطبقة | الملف | ما فيها |
|---|---|---|
| `tokens` `base` `state` | `signature.css` | الرموز، والأساس والخط والروابط وبدائية «سطر الكتابة»، ونظام الحالة |
| `components` | `style.css` | المكونات |
| `surfaces` | `journey.css` | القوائم والجداول والنماذج وعائلات الشاشات |
| `stage` | `athar.css` | الدخول والأبطال والأفق والعبور |
| `shell` | `hr-design.css` | الغلاف والتنقل |
| `fill` | `style.css` | **القائمة البيضاء للتعبئة وحدها** (§6.5). تغلب قواعد «أفعال الصفوف» في `surfaces` وقواعد `.page-head` في `shell` بلا سباق نوعية |
| `kill` | `hr-design.css` | قاتل الحركة (`prefers-reduced-motion` و`:root[data-motion=off]`) |

قيود: (1) لا قاعدة خارج طبقة، عدا الكتلة المجمَّدة في رأس `hr-design.css` (§9) وقواعد `@font-face` و`@keyframes`. القاعدة غير المطبَّقة تغلب كل الطبقات، فوجودها خطأ. (2) `!important` يعكس ترتيب الطبقات، فيُمنع خارج `kill` وخارج مخفيات الجولة الثلاث. (3) لا حزمة تكتب `outline:none` أو `outline:0`: حلقة التركيز معرّفة في `base` وأي طبقة لاحقة تلغيها. (4) الدعم: Safari 15.4 فما فوق، والحد الأدنى المفترض في خريطة الواجهة 15.5.

---

## 3. قواعد الخط

### 3.1 التحميل

- أربع قواعد `@font-face` فقط في `signature.css`: `/fonts/alexandria-{arabic,latin}-{400,700}-normal.woff2`، لكل منها `unicode-range` و`font-display:swap`. **الأرقام 0–9 تعيش في ملف latin.**
- `font-synthesis:none` على `html`. لا وزن مصطنع ولا مائل.
- `index.html`: `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/alexandria-arabic-400-normal.woff2">` ومثله لـ700. السمة `crossorigin` لازمة وإلا نُزِّل الملف مرتين.
- خطوط النظام احتياط تحميل فقط. `-webkit-font-smoothing:antialiased` في الفراغ.
- استثناء واحد: `pre[dir=ltr]` (حمولات JSON في `platform-ops`) بـ`--font-mono` لأن المحاذاة فيه وظيفة. `code` و`kbd` بـAlexandria.

### 3.2 السلّم وأدواره

| الرمز | 375 | 1440 | الوزن | ارتفاع السطر | الحبر | الاستعمال |
|---|---|---|---|---|---|---|
| `--fs-display-xl` | 44 | 112 | 400 | 1.25 | ink-1 | `h1` الدخول فقط |
| `--fs-display-l` | 36 | 72 | 400 | 1.25 | ink-1 | تحية الرئيسية، عنوان مشهد الفهرس، عنوان الفراغ على مستوى الصفحة، `journey-copy`، `ex-hero-copy` |
| `--fs-display-m` | 30 | 44 | 400 | 1.25 | ink-1 | `#main h1` في المكتب، `#dialog-title`، سؤال `rq-hero`، حقل لوحة الأوامر |
| `--fs-display-s` | 26 | 32 | 400 | 1.3 | ink-1 | `h1` الدفتر |
| `--fs-figure-xl` | 40 | 84 | 400 | 1.05 | ink-1 | رقم عين الحلقة، `ex-figure strong` |
| `--fs-figure-l` | 36 | 56 | 400 | 1.05 | ink-1 | **البؤرة الواحدة:** أول `.vn-tile strong` في الشاشة |
| `--fs-figure-m` | 28 | 40 | 400 | 1.05 | ink-1 | بقية أرقام البلاطات |
| `--fs-figure-s` | 24 | 28 | 400 | 1.1 | ink-1 | إجمالي `tfoot`، أرقام داخل بطاقة، `step-no`، `rq-section-no`، أرقام الفهرس 01–08 على الجوال |
| `--fs-title` | 20 | 22 | 700 | 1.4 | ink-1 | `panel-head h2`، `vn-group h2`، أسماء الإدارات |
| `--fs-body-l` | 18 | 20 | 400 | 1.8 | ink-3 | فقرات المسرح، ≤ 30em |
| `--fs-body` | 16 | 16 | 400 | 1.75 | ink-2 | الافتراضي، قيم الحقول، `dd` |
| `--fs-row` | 16 | 16 | 700 | 1.5 | ink-1 | عنوان الصف |
| `--fs-table` | 15 | 15 | 400 | 1.5 | ink-2 | خلايا الجداول |
| `--fs-meta` | 14 | 14 | 400 | 1.6 | ink-3 | سطر البيان في الصف (جملة « · »)، ≤ 72ch |
| `--fs-label` | 13 | 13 | 700 | 1.4 | ink-4 | تسمية القسم، `dt`، تسمية الحقل، `th`، `badge`، أفعال الصفوف، تسميات التبويب |
| `--fs-cap` | 12 | 12 | 700 | 1.4 | ink-4/5 | لاتيني خالص فقط: `kbd`، UUID، `360.sa`، القفل اللاتيني («WORKSPACE ACCESS»، «INDEX»). أي عنصر قد يحمل عربية يأخذ 13px (ومنه `.login-footer` و`.sig-cmd-item b`) |

- نسبة عنوان الشاشة إلى المتن: 7× في الدخول، 4.5× في عتبات المسرح، 2.75× في المكتب، 2.1× في الدفتر.
- نسب الدليل الصغيرة محفوظة: تسمية ثقيلة 13، متن عادي 15–16، عنوان فرعي 22/700 ≈ 1.4× المتن.
- **مخالفة معلنة للدليل:** عناوين العرض بوزن 400 لا Bold. **[ملحق] أُقرّت بالتفويض (القرار 5).** الأوزان تُكتب برموز `--fw-*` (الملحق §أ بند 6): `--fw-label:600` و`--fw-stage-body:300` ينزلان اليوم إلى 700 و400 ويتحسنان تلقائيًا إن فُعّلت ملفات الخط.

### 3.3 العربية

- `letter-spacing:0` على كل عنصر قد يحوي عربية، بلا استثناء. فحص آلي.
- الشدّ البصري من: قفزة الحجم، وعنوان ≤ 3 كلمات/3 أسطر، و`text-wrap:balance` للعناوين و`pretty` للمتن.
- ممنوع: `overflow-wrap:anywhere`، `hyphens`، الكشيدة، `italic/oblique`، الوزن المصطنع.
- **`--lh-display` = 1.25 افتراضيًا.** لا يُضيَّق إلى 1.15 إلا بعد اجتياز اختبار القصّ (§13) على «هنا يبدأ الأثر.» و«مسيّر رواتب سبتمبر 2026» عند 375 و1440.
- العناوين الديناميكية: تضيف `signature.mjs` على `#main h1` الصنف `is-long` فوق 24 حرفًا (ينزل درجة) و`is-xlong` فوق 48 (درجتين). تعمل داخل `schedule()` قبل الرسم، فلا قفز.
- لا نص عربي تحت 13px. `--fs-cap` للاتيني الخالص وحده. موضعان صُحّحا: `.login-footer` («3,6T © 2026 · بيئة تطوير محلية») و`.sig-cmd-item b` («طلب»/«شاشة») كلاهما 13px.

### 3.4 اللاتيني والأرقام داخل العربي

- أرقام 0–9 في كل مكان. `font-variant-numeric:tabular-nums lining-nums` على `td` و`.vn-code` و`.ltr` ومحددات الأرقام. **دعم `tnum` في ملفات Alexandria غير متحقق منه**؛ إن غاب: ثبات الخانتين العشريتين + عرض عمود بوحدة `ch`.
- المحاذاة: في RTL المحاذاة الافتراضية (يمين) تراصف الخانات العشرية ما دامت الخانتان واللاحقة (`SAR`) ثابتتين. **لا `text-align:end` على الأعمدة الرقمية** (تعني يسارًا في RTL)، ولا كشف نصي للخلايا.
- التتبّع السالب `-0.02em` له قاعدة واحدة: `[data-num]{letter-spacing:-.02em}`، ومعها `:lang(en)` في أحجام العرض. **لا قائمة أصناف:** `.vn-tile strong` ليس رقميًا دائمًا (`tile(`يوم ${p.pay_day}`)` يضع فيه عربية). تضع `signature.mjs` السمة `data-num` على عناصر قائمة العدّ فقط (`.vn-tile strong, .stat-number, .pt-tile strong, .ex-figure strong, .ex-step strong, .acc-stats strong, .figure b, .sig-eye b`، وهي تمرّ عليها أصلًا للعدّ التصاعدي) حين يطابق نصها `/^[\d\s.,:%+\-–SAR]+$/`، وتزيلها إن تغيّر النص. ما لا يطابق يبقى بتتبّع صفر.
- `.ltr` و`bdi` و`code` و`kbd`: `direction:ltr; unicode-bidi:isolate`. UUID: 12/400 ink-5 في ذيل الصفحة.
- **القفل ثنائي اللغة** (من فواصل الدليل): سطر لاتيني UPPERCASE بحجم 12/700 وتتبّع `+.08em`، **على نص لاتيني فعلًا في الترميز أو في CSS فقط**. له موضعان: `.login-card .eyebrow` («WORKSPACE ACCESS»، لاتيني في `loginView()` و`passwordView()`) فوق `h2` البطاقة، و`.side-title::before{content:"INDEX" / ""}` في مشهد الفهرس. **`.story-copy .eyebrow` ليس قفلًا:** نصه عربي («معًا، نصنع ما نفخر به.») فيأخذ صيغة التسمية العربية 13/700 بتتبّع صفر. أسماء المجموعات اللاتينية («03 — PEOPLE») حُذفت: `tr()` تعطي لغة واحدة ولا أصل لها في DOM؛ يبقى رقم الفهرس 01–08 وحده. تقارب حجمي السطرين في الدليل قرار للمالك (§12 بند 15).
- «التسمية» العربية: 13/700 تسبقها علامة `--m-done` بعرض 8px. **لونها ink-4 في المكتب والدفتر**، و`--spark` في الدخول ومشهد الفهرس والفراغ فقط. تسمية واحدة لكل قسم.

### 3.5 ترقية اختيارية (تحتاج موافقة المالك)

| الوزن | أين يحسّن | الكلفة |
|---|---|---|
| **600 SemiBold** (arabic + latin) | `--fs-label` و`--fs-cap` و`--fs-title` كما ينص الدليل حرفيًا («Subheads 20pt SemiBold، Captions 12pt SemiBold»)؛ يخفف ثقل 700 في 40 صفًا متتاليًا | ملفان ≈ 26KB، مدخلان في قائمة `server.mjs` البيضاء، ومرور `static-modules.test` |
| **300 Light** (arabic + latin) | فقرات المسرح ≥ 20px وعناوين العرض ≥ 72px فقط؛ أقرب إلى خفة Dala | ملفان، مدخلان في `server.mjs` |
| 200 | **مرفوض في كل الأحوال** للعربية على الأسود: النقاط تذوب | — |

النظام كامل بـ400/700. **[ملحق]** ملفات `*.woff2.part` الثمانية في `app/static/fonts` (أوزان 200/300/500/600، بتاريخ 18 سبتمبر) نزّلها المنسّق من fontsource **ولم تُفعَّل** (أوقفته بوابة أمان)؛ تفعيلها بيد المالك. **لا يُشار إليها، ولا تُكتب `@font-face` لوزن بلا ملف مخدوم.**

---

## 4. التوقيع البصري: «الحلقة»

### 4.1 ما هي

حلقة 360° **مقنَّعة على شبكة الدليل المتعامدة**: لا توزيع قطري ولا غاوسي ولا دوران لأي علامة. العلامة فاصلة الشعار `COMMA=[[.372,0],[1,0],[.539,1],[0,1]]` في صندوق 1.373:1. تحت 5px عرضًا تُرسم نصفَ فاصلة (مثلث ABC: `(0,0) (.862,0) (.229,1)`) فتُقرأ رأس سهم كما في الدليل وكما في مثلثات Dala؛ عند 5px فأكثر تُرسم رباعيًا كاملًا. ثابت واحد `MARK` يبدّل الشكل إن قرر المالك أن علامة النمط مثلث صِرف.

### 4.2 المحرك (`motion-cards.mjs`، تصديرات جديدة)

```js
// New exports only. mountCards / prefersReducedMotion stay byte-for-byte in behaviour.
// No document/window access at module top level: the file is imported under Node by tests/motion-cards.test.mjs.
export function ringField({width,height,cx,cy,R,band=.28,pitch,exclude=[],feather=48}){ /* pure: returns Float32Array + count; testable in Node */ }
export function commaField({x,y,w,h,pitch,axis='x'}){ /* pure: Form A block / giant comma (Form D built from Form A) */ }
export function mountBackdrop(canvas,{view=globalThis,reduced=prefersReducedMotion(view)}={}){
  /* returns {setScene(name,{cx,cy,R,mirror}), setData({pending /* Number|null */,late,progress,closed}), setExclusions(rects),
             dim(level), pulse(), pause(), resume(), destroy()} — every method is a no-op if getContext fails.
     geometry is in CSS px relative to the canvas box; mirror=true when html[dir=ltr] */
}
```

**بنية الجسيم** — `Float32Array` واحدة، 10 قيم لكل جسيم، بلا تخصيص ذاكرة داخل الإطار:

| الحقل | المعنى |
|---|---|
| `x, y` | الموضع الحالي |
| `hx, hy` | عقدة الشبكة المستهدفة في المشهد الحالي (البيت) |
| `t` | الموضع الزاوي المطبَّع على قوس الـ300° (0 عند الساعة 12، **عكس عقارب الساعة** = «الأمام» في RTL؛ ومع `mirror=true` في `dir=ltr` ينعكس الاتجاه إلى مع عقارب الساعة، وتنعكس معه جهة تلاشي الأفق وعلم `mirror` لكل عقدة)؛ `-1` لعقد الفجوة |
| `k` | الحبر الحالي (0.15…1) |
| `c` | فهرس اللون (0..3) |
| `f` | أعلام: `mirror` (x < cx)، `moon`، `drifter` |
| `d` | تأخير الطيران (ms) بحسب الزاوية |
| `ph` | طور التنفس |

**التوليد (spawn من شبكة نمط 3,6T):**
1. شبكة متعامدة بخطوة `pitch × 1.13·pitch` تغطي صندوق الحلقة. عرض العلامة = `0.6 × pitch`.
2. تُحفظ العقد التي تحقق `R(1−band) ≤ r ≤ R`. عقد الحافة `R < r ≤ 1.12R` تُحفظ باحتمال يتناقص خطيًا عبر تجزئة حتمية لإحداثيات العقدة (تبقى **على الشبكة**، فالمستقر شبكة لا بعثرة).
3. **مستطيلات الحظر:** أي عقدة داخل مستطيل محظور تُحذف؛ وضمن `feather` بكسل منه يُضرب حبرها بمعامل يهبط إلى 0. المستطيلات: عمود النص/النموذج، صندوق عنوان العرض إن لم يكن في العين، ومساحة أمان الشعار (0.675 × ارتفاعه من كل جهة).
4. `mirror` لكل عقدة يسار المركز: تُرسم بالفاصلة المعكوسة «\» (الصيغة C).
5. **اللون** بتجزئة حتمية: 77% `--ring-a`، 10% `--ring-b`، 10% `--ring-c`، 3% `--ring-d`. الألوان تُقرأ بـ`getComputedStyle(documentElement)` وتُعاد قراءتها عند تغيّر `data-theme`. لا لون مكتوب في JS.

**قانون الحبر (تلاشي الدليل المقيس) مع التقدم `p` والفجوة:**
- القوس 300° والفجوة 60° بين الرأس الكثيف والذيل الشبحي.
- `k(t) = 1` إذا `t ≤ p`؛ وإلا `k = max(0.15, 1 − 1.06·u)` حيث `u = (t−p)/(1−p)`. عند `p=0` هو قانون الدليل حرفيًا.
- الحجم halftone: `scale = 0.45 + 0.55·k`. الشفافية = `k` مكمَّمة إلى 8 دلاء.
- عقد الفجوة مخفية (`k=0`)؛ عند `closed=true` تظهر عند الأرضية 0.15 ثم تتبع القانون: **الدائرة تكتمل**.
- تغيّر `p` أو `closed` يتحرك على `--d-ring` (700ms).

**الأهداف (target shapes):**

| المشهد | الشكل | حالة الـcanvas |
|---|---|---|
| `login` | الافتتاح: كتلة الصيغة A (شبكة مستطيلة بتلاشٍ أفقي، كما في صفحة 15) ← الحلقة | `position:fixed; inset:0` |
| `home` (المساران `home` و`portal`) | حلقة الدوام في شريط البطل | `position:absolute`؛ أعلاه `--sticky-top`، ارتفاعه ارتفاع `.page-head` الفعلي (≥ `--hero-h`)؛ **يتمرر مع الصفحة** فلا يظهر خلف القوائم. شرطه أن يكون المتمرر هو `html` (§5.2) |
| `index` (مشهد الفهرس، ≥ 1024 فقط) | **الفاصلة العملاقة مصنوعة من ≈ 1,500 فاصلة** (الصيغة D من الصيغة A): صندوق 760×554، خطوة 12×13.6، كثيفة عند الحافة الخارجية وتتلاشى نحو النص | `fixed; inset:0`، ثابت: يُرسم مرة واحدة بلا `requestAnimationFrame`. **يُرى لأن `aside.sidebar` شفاف عند ≥ 1024 و`.stage` مخفية** (§5.3) |
| `off` (كل ما عداها) | — | `canvas.width = canvas.height = 0` و`display:none` |

**الحركة:**
- **الافتتاح مرة واحدة في الجلسة** (`sessionStorage 36t-ring-intro`): تثبت العلامات 300ms على كتلة الصيغة A، ثم تطير إلى عقدها 1,400ms بتأخير `d` بحسب الزاوية ومنحنى `1−(1−u)³`. **بمعدل rAF الكامل على كل الأجهزة** (≤ 700 علامة على الجوال)؛ التخفيض للسكون فقط.
- **«الحبر يجف»:** العلامة أثناء الطيران مفرّغة بخط 1px (لغة Dala)، وعند استقرارها على الشبكة ممتلئة (لغة الدليل).
- **السكون:** المواضع ثابتة على الشبكة. الذي يتحرك هو الحبر: دالة الكثافة تدور **درجة في الثانية** (دورة كل 360 ثانية)، وتنفس شفافية ±0.10 بدور 7s. تُعاد الدلاء كل 30 إطارًا فقط.
- **المؤشر (مكتب، الدخول فقط):** تنافر ضمن 120px بإزاحة قصوى 14px وعودة بنابض مخمَّد؛ العلامة المزاحة تُرسم مفرّغة حتى تعود.
- **«الأثر»** `pulse()`: 6 أشباح تتلاشى في 900ms لعلامة واحدة؛ تُطلق عند ظهور `#toast.show` في مشهد حي فقط، وعند إغلاق فجوة الحلقة.

**تقنية الرسم:**
- Canvas 2D. **السكون:** تعبئات مجمّعة — مسار واحد + `fill()` واحد لكل (لون × دلو) ⇒ ≤ 32 عملية في الإطار. **الطيران:** `drawImage` من أطلس sprites مرسوم مسبقًا (لون × مرآة × مفرّغ)؛ ممكن لأن العلامات لا تدور.
- `setTransform(dpr,0,0,dpr,0,0)` مرة، و`clearRect` لكل إطار. جدول `sin` بـ256 قيمة.
- حجم الإضافة إلى `motion-cards.mjs` ≤ 10KB بلا تبعيات (`Cache-Control:no-store` يعيد تنزيله مع كل تحميل).

### 4.3 الميزانيات

| الجهاز | الدخول | الرئيسية | الفهرس | DPR | السكون |
|---|---|---|---|---|---|
| مكتب ≥ 1024 | ≈ 2,200 علامة + 40 هائمة (R=450، خطوة 11) | ≈ 600 (R=148، خطوة 7) | ≈ 1,500 ثابتة | ≤ 2 | 30fps ← 12fps بعد 20s ← توقف بعد 60s |
| لوحي 760–1023 | ≈ 1,300 | ≈ 250 (R=96، خطوة 7) | — | ≤ 1.5 | كذلك |
| جوال < 760 | ≈ 670 + 12 (R=190، خطوة 8.5) | ≈ 190 (R=60، خطوة 5) | — | ≤ 1.5 | تجميد بعد 12s؛ الاستئناف بشروط §4.7 |

- ميزانية الإطار: ≤ 3.5ms مكتب، ≤ 6ms جوال.
- **الحاكم يقيس الفاصل بين إطاري rAF** (الإطارات الساقطة)، لا `performance.now()` حول الرسم، لأن تنقيط Canvas غير متزامن. إن تجاوز 20ms (مكتب) أو 40ms (جوال) في 30 من آخر 60 إطارًا: تُحذف الهائمة ← يُحذف 35% (عقد الحافة أولًا) ← إطار ثابت لبقية الجلسة.

### 4.4 مقاس الـcanvas تحت DPR

- المقاس CSS من قواعد المشهد؛ الدعامة `width = round(cssW × dpr)` و`height = round(cssH × dpr)` حيث `dpr = min(devicePixelRatio, 2)` (و1.5 تحت 1024px).
- `ResizeObserver` على الـcanvas يعيد التوليد (بتأخير 120ms). تغيّر `data-theme` **أو `data-design` [ملحق]** يعيد قراءة الألوان ويرسم إطارًا.
- خارج المسرح تُصفَّر الدعامة (`width=0`)؛ `display:none` وحدها لا تحرر ~20MB على مكتب DPR 2.
- **هندسة الدخول** منسوبة إلى النافذة بخصائص CSS (`--ring-x`, `--ring-y`, `--ring-r`) تقرؤها `signature.mjs` بـ`getComputedStyle` وتمررها إلى `setScene('login',{cx,cy,R,mirror})`. الدخول لا يتمرر، فلا أثر لشريط التمرير على `vw`. مع `html[dir=ltr]` تصير `--ring-x:66vw` (§5.1).
- **هندسة الرئيسية لا تصح بخصائص CSS وحدها:** `a.sig-eye` داخل `.page-head` المحدود بـ`--content-max` والمتوسّط، والـcanvas بإحداثيات أخرى، والقاعدة تمنع `left/right`. لذلك تقيس `signature.mjs` صندوق `a.sig-eye` (مربع ضلعه `2.24 × --hero-ring-r`) **مرة عند الرسم ومع `ResizeObserver`**، وتمرر `{cx,cy,R = العرض ÷ 2.24}` منسوبة إلى صندوق الـcanvas.
- القياسات المسموحة اثنان مسمّيان، لا ثالث لهما: صندوق عنوان العرض في الدخول (بعد `document.fonts.ready` ومع `ResizeObserver`)، وصندوق `a.sig-eye` في مشهد `home`. لا قياس أثناء التمرير ولا داخل الإطار.

### 4.5 ربط البيانات (كله من DOM عبر `signature.mjs`، بلا لمس `app.mjs`)

| الإشارة | المصدر | الأثر |
|---|---|---|
| `pending` | **السمة `html[data-inbox]`** التي تكتبها `app.mjs` داخل `.then` لطلب `/inbox/count` (إسناد واحد: `document.documentElement.dataset.inbox=String(c.total)`). غياب السمة = `pending:null` (لم يصل العدّ بعد، أو فشل الطلب). `signature.mjs` تحذف السمة عند ظهور `.login` | N «قمرًا» (حد 12): علامات بيضاء ممتلئة بحجم 1.6× عند رأس القوس. مع `null`: لا أقمار |
| `late` | الصنف `.is-late` على `a[href="#inbox"] .nav-count` (يوجد متى كان العدّ > 0) | الأقمار بلون `--stop`، وشريحة الـ3% تصير `--stop`: **«77/10/10/3 هي سماء اليوم الجيد، وانحرافها هو الخبر»** |
| `progress` | الساعة: ما مضى من 09:00–17:00 بتوقيت `Asia/Riyadh`، الأحد–الخميس؛ خارج الدوام `p=0` | طول القوس الكثيف |
| `closed` | `pending === 0` **صراحةً** (السمة موجودة وقيمتها `"0"`)؛ `submit` على `#login-form` (الدخول) | تنغلق فجوة الـ60°. **`null` لا يغلق شيئًا:** غياب `.nav-count` يحتمل صفرًا أو انتظارًا أو فشلًا، والحلقة لا تدّعي اكتمالًا لم يثبت |
| خطأ الدخول | `MutationObserver` على `#login-error` | تُفتح الفجوة، وتصير شريحة الـ3% `--stop` لمدة 900ms. بلا رجّة |
| كلمة المرور | `focusin` على `input[name=password]` | الحلقة تخفت إلى 35% خلال 200ms. **صفر تفاعل مع أي ضغطة مفتاح في أي حقل** |
| لوحة المفاتيح على الجوال | `html.is-kbd` في مشهد الدخول | `dim(0)` ما دامت مضبوطة: الصفحة تتمرر فتصعد الحقول فوق حلقة `fixed`، فتغيب الحلقة حتى لا تمر علامة خلف حقل |
| نجاح الدخول | ظهور `#app > .shell` بعد `.login` | لحظة العبور (§5.1)، ثم تعيد العلامات نفسها التشكل حلقةَ دوام: انتقال متصل |

- **لا عدّ من DOM للشاشات، ولا أقواس متعددة، ولا نقر على خلفية الحلقة.**
- **شاشات الراتب والتظلمات والجزاءات والأمان لا تغذّي الـcanvas أبدًا.**

### 4.6 التوأم النصي (إلزامي)

- `a.sig-eye[href="#inbox"]` في عين حلقة الرئيسية: `<b>` **للرقم وحده** بحجم `--fs-figure-xl` (جوال: `--fs-figure-s`) + `<span>` 13/700. الحالات الثلاث: عدد > 0 ⇒ `<b>3</b>` + «بانتظار قرارك»؛ صفر مؤكد ⇒ `<b>0</b>` + «لا شيء ينتظرك» (الجملة العربية في `span` لا في `b`، فلا يقع عليها تتبّع سالب)؛ `null` ⇒ `<b>—</b>` + «بانتظار قرارك» بلا رقم مدّعى.
- `p.sig-census`: «3 بانتظار قرارك، ومنها متأخر.» تُبنى من الإشارتين أعلاه فقط؛ لا تدّعي عمرًا ولا اسمًا لا يملكه الـDOM. **مع `pending:null` تبقى فارغة** (ارتفاعها محجوز): جملة «لا شيء ينتظر قرارك الآن.» لا تُكتب إلا بعد وصول صفر من الخادم.
- `<canvas class="sig-aurora" aria-hidden="true">` و`pointer-events:none`.

### 4.7 الحركة المسؤولة

- `prefers-reduced-motion:reduce`: **إطار ثابت واحد هو الحلقة المستقرة على شبكتها** (أي نمط الدليل مقنَّعًا)، يعكس حالة البيانات. يُعاد رسمه عند تغيّر الحجم أو المظهر، **وعند كل `setData` بقيمة مختلفة، وبمؤقت `setTimeout` كل 60 ثانية** يرسم إطارًا واحدًا بلا rAF حتى لا يتقادم `progress`. لا افتتاح ولا تنفس ولا مؤشر. لحظة العبور تُعرض إطارًا ساكنًا بقطع لا بحركة (§5.1).
- `localStorage 36t-motion-paused` محترم؛ زر «إيقاف الحركة» تضيفه `signature.mjs` إلى `.side-account`، **وتكتب معه `html[data-motion=off]`** لأن المحرك ليس الحركة الوحيدة: مسح التحميل، وكشف `clip-path`، ونقاط تحميل الزر، والعدّ التصاعدي كلها CSS أو JS خارج المحرك. قاتل الحركة يُكرَّر تحت `:root[data-motion=off]` (§9)، والعدّ التصاعدي يُلغى معه.
- `document.hidden` ⇒ `cancelAnimationFrame`. خروج شريط البطل من الشاشة (`IntersectionObserver`) ⇒ توقف.
- **الاستئناف بعد سلّم الخمول** (توقف المكتب بعد 60s، وتجميد الجوال بعد 12s): عند `setData` بقيمة مختلفة، أو `visibilitychange` إلى ظاهر، أو **`pointerdown` واحد** على `document` (`{passive:true, once:true}`، يُعاد تسجيله عند كل تجميد، وفي مشاهد المسرح فقط). لا مستمع دائمًا.
- الجوال: `focusin` في أي حقل ⇒ إطار ثابت؛ و`html.is-kbd` في الدخول ⇒ `dim(0)`.
- **لا `requestAnimationFrame` ولا مستمع تمرير أو مؤشر في طبقتي المكتب والدفتر، ولا أثناء تبديل المسار في شاشات العمل.**
- فشل `getContext` ⇒ الصفحة كاملة على `--canvas` بلا حلقة.
- `@media print{.sig-aurora{display:none}}`.

### 4.8 المشتقات الساكنة (CSS خالص، صفر JS)

| المشتق | التنفيذ | الموضع |
|---|---|---|
| **الأفق** | `.page-head::after`: `background:var(--horizon)` + `mask-image:var(--m-tile),linear-gradient(to left,#000,transparent 85%)` + `mask-composite:intersect` + `mask-repeat:repeat,no-repeat`. كتلة 204×95px (17×7) في الزاوية السفلية من جهة النهاية، كثيفة عند الحافة الخارجية وتتلاشى نحو النص. تتدهور بأمان إلى كتلة بلا تلاشٍ | كل شاشة مكتب. **مملوك لـ`athar.css` وحده** |
| شريط الدفتر | الشيء نفسه بصف واحد: `6px × min(320px,40%)` | كل شاشة دفتر |
| سكون الحساس | **الأفق لا يُخفى:** هو ساكن ولا يحمل بيانات، وإخفاؤه يجعل الحبر الملوَّن كله أصفر وأحمر، عكس «الفيروزي الغالب بفارق كبير». في المسارات الحساسة يُعرض **شريط الدفتر 6px** أيًّا كانت الطبقة. السكون يخص الحركة والعدّ التصاعدي وتغذية الـcanvas فقط | `html:is([data-route=payroll],[data-route=hr-cases],[data-route=compensation],[data-route=security],[data-route=payroll-extras],[data-route=payroll-anomaly],[data-route=wps],[data-route=contracts],[data-route=wage-reconciliation],[data-route=benefits],[data-route=performance])` — الصيغة `a\|b` داخل محدِّد السمة ليست CSS صالحة |
| الفاصلة العملاقة (الصيغة D) | `--m-done` بارتفاع 1.4× سطر العنوان خلف أول كلمة، بلون `var(--ghost)` (**[ملحق]** رمز بدل الحرفي: `#141414` في الفراغ، `#DDE6ED` في الورق، وقيمه في `field`/`slate` في الملحق §ج.7) — زخرفة لا تحمل معنى. ممتلئة في الفراغ «الجيد»، ومفرّغة (حد 1.3px) في الافتراضي (§6.11) | `.empty` على مستوى الصفحة |
| مؤشر التحميل ومقبض السحب | **صيغة حامل البطاقة:** 9 فاصلات مرآتية تكبر نحو المركز؛ التحميل بمسح شفافية 1.2s يبدأ بعد 400ms | `.loading`، `.dialog-head::before`، `.side-head::before` |
| قوس الطلب | `svg.sig-arc` تبنيه `signature.mjs` بـ`createElementNS` من `.journey-step`: ≤ 3 عناصر `<path>` (واحد لكل حالة)، 24 فاصلة، بسمات عرض لا `style` | تفاصيل الطلب |

---

## 5. الغلاف (Shell)

المبدأ: **لا شريط جانبي دائم.** الـDOM يبقى كما هو بكل معرّفاته وسمات `data-shell`؛ `aside.sidebar` يصير «مشهد الفهرس» في كل المقاسات.

### 5.1 الدخول `main.login` — فراغ دائمًا

> **[ملحق]** «فراغ دائمًا» تصح في تصميمَي `void` و`slate`. في `field` الدخول مسرح فيروزي بالتركيب نفسه والـDOM نفسه: النص أسود، وعنوان العرض والشعار أبيضان عبر `--ink-display` و`--logo`، والحبّة سوداء بنص أبيض، وعلامات الحلقة بيضاء وفحمية (الملحق §ج.4 و§ج.7).

**1440×900.** `.login{display:grid; grid-template-columns:repeat(12,1fr); background:transparent}`، الحاشية 64px. `.login-story` و`.story-copy` بـ`display:contents` فتصير أبناؤهما عناصر شبكة؛ يُلغى `display:none` عن القصة في كل المقاسات.

| العنصر (hook) | الموضع | المواصفة |
|---|---|---|
| `.login-story .brand > svg.brand-svg` | الزاوية العليا من جهة البداية (يمين)، y=48 | أبيض، ارتفاع 28px، مساحة أمان 19px تُمرَّر حظرًا للمحرك. **الشعار في الزاوية في كل المقاسات** |
| `.login-wordmark`، `[data-action=theme]`، `.hr-frames`، `.login-mobile-tagline`، `.athar-scene` | — | `display:none`. **يُحذف `::after{content:"3,6T"}`** (كتابة الشعار بخط مخالفة قائمة اليوم في `signature.css`) |
| الحلقة | 7 أعمدة يسارًا | `--ring-x:34vw; --ring-y:42vh; --ring-r:min(50vh,32vw)` ⇒ R=450 عند 1440×900. الوسط الفارغ 0.72R = 324 ⇒ قطر العين 648px |
| `.story-copy .eyebrow` + `h1` | **في عين الحلقة** | `.eyebrow` هنا **تسمية عربية** («معًا، نصنع ما نفخر به.»): 13/700 بلون `--spark` وتتبّع صفر، تسبقها علامة `--m-done` 8px. ثم `h1` «هنا يبدأ الأثر.» بحجم `--fs-display-xl` على سطرين. الصندوق المقدَّر 500×300 ⇒ قطره 583 < 648 ✓. **حارس:** تقيس `signature.mjs` صندوق `h1` بعد `fonts.ready`؛ إن تجاوز قطرُه (قطر العين − 48px) يأخذ `is-long` وينزل درجة |
| `.story-copy p` | أسفل العمود الأيسر (y ≥ 840، تحت نهاية الحلقة 828) | `--fs-body-l`، ink-3، ≤ 30em، ومستطيل حظر |
| `.login-form` › `.login-card` | 5 أعمدة من جهة النهاية، عرض 400px، متوسطة رأسيًا | بلا بطاقة. **`.login-card .eyebrow` ظاهر:** هو القفل اللاتيني «WORKSPACE ACCESS» 12/700 `+.08em` ink-4 فوق `h2` 22/700. **مستطيل حظر بحافة ناعمة 48px**: الحلقة تغيب خلف عمود القول |
| `form#login-form label` ×3 | — | **سطر كتابة** 56px. حقل الرمز ينطوي وهو فارغ: `label:has(input[name=otp]:placeholder-shown):not(:focus-within)` يعرض التسمية + خطًا بطول 120px (يبقى شكله حقلًا)، ويفتحه التركيز |
| `#login-error` | فوق الزر | صيغة المانع (§6.7)؛ له ارتفاع محجوز 0 ← يتمدد داخل عمود النموذج المحظور أصلًا |
| `button.btn.dark[type=submit]` | — | الحبّة الفيروزية 56px بعرض 400. **الفيروزي الوحيد على الشاشة عدا الحلقة** |
| `.hr-values`، `.login-note`، `[data-action=language]`، `.login-footer` | أسفل العمود الأيمن | القيم الخمس 13/700 ink-4 تفصلها علامة `--m-done` بلون `--spark`؛ `.login-note` وزر اللغة 13 ink-4؛ **`.login-footer` 13/400 ink-5** (نصه عربي: «بيئة تطوير محلية») |

**375×812.** عمود واحد. الشعار 24px في الزاوية (محظور حوله). الحلقة أفق علوي: `--ring-x:50%; --ring-y:150px; --ring-r:190px` (تنقطع عند الحافتين)، قطر العين 274px. `h1` 44px على سطرين في العين (≈ 200×110 ⇒ قطر 228 < 274 ✓). من y=340: حقلان 56px، الرمز مطوي 44px، الحبّة 56px بعرض كامل، زر اللغة، التذييل ⇒ ≈ 732px < 812 بلا تمرير. `.story-copy p` و`.hr-values` مخفيتان. عند `focusin` تتجمد الحلقة.

**اللوحي 760–1023:** تركيب الجوال (عمود واحد، الحلقة أفق علوي) مع `--ring-r:min(190px,28vw)`. **العمودان عند ≥ 1024 فقط.**

**الوضع العرضي القصير `@media (max-height:600px)`:** تُخفى الحلقة (`setScene('off')` عبر `data-scene`)، وتبقى التسمية والعنوان والنموذج في عمود واحد يتمرر.

**`html.is-kbd` على الجوال:** `dim(0)` ما دامت مضبوطة (§4.5)، فلا تمر علامة خلف حقل حين تتمرر الصفحة تحت حلقة `fixed`.

**الإنجليزية `html[dir=ltr]`:** `loginView()` تضبط `dir=ltr` فينتقل عمود النموذج إلى اليمين البصري. لذلك `html[dir=ltr]{--ring-x:66vw}`، ويمرَّر `mirror:true` إلى المحرك: ينعكس علم `mirror` للعقد، واتجاه `t` (مع عقارب الساعة)، وجهة تلاشي الأفق. بدون ذلك يمسح مستطيل الحظر معظم الحلقة.

**`.password-gate` و`#password-form`:** التركيب نفسه، حلقة ساكنة عند 35%، **ثلاثة أسطر كتابة** (هي عتبة لا نموذج عمل)، و`.btn.primary` هي الحبّة. المالك `athar.css` وحده؛ حين يُفتح `#password-form` داخل `#dialog` من الحساب يبقى بسطر الكتابة نفسه.

**لحظة العبور (صفحة الفاصل، مرة واحدة كعتبة):** عند ظهور `.shell` بعد `.login` تضيف `signature.mjs` الصنف `html.is-threshold` لمدة 400ms: `html.is-threshold::before` يملأ الشاشة بـ`--brand-turquoise` عند `z-index:130`، و`::after` الشعار الأبيض (قناع `data:` من مسارات `brand-logo.mjs`) في زاويته. تحته تعيد الحلقة تشكيل نفسها حلقةَ دوام. هذا هو الموضع الوحيد الذي يُرى فيه فيروزي الهوية حقلًا كاملًا كما في الدليل. مع `reduced-motion` أو `data-motion=off`: **إطار ساكن مدته 400ms بقطع لا بحركة** (الصنف يُضاف ويُزال بمؤقت، بلا `transition`)؛ حقل الهوية الكامل هو توقيع الدليل الأول، فيراه كل موظف مرة في الجلسة ولا يُحرم منه من أوقف الحركة. فحص V: شعار `::after` قناع `data:` منسوخ من مسارات `brand-logo.mjs` المجمَّد، فتُقارن سلاسل `d=` بين الملفين آليًا.

### 5.2 إطار التطبيق على المكتب ≥ 1024

`.shell{display:block}` — يُلغى عمود 288px فتكسبه الجداول. `#app{position:relative; z-index:1}`، واللون الأساس على `html` وحده، و`body` و`.shell` و`.login` شفافة. **المتمرر هو `html`:** لا `overflow` ولا `height` ثابت على `body` أو `.shell` أو `.stage` أو `#main`. عليه يعتمد مشهد `home` المتمرر، ولصق `summary` و`th` والمرشّحات، و`IntersectionObserver` للبطل.

**`header.topbar`** — 64px، لاصق، شفاف؛ مع `.is-condensed`: `background:var(--canvas)` معتم + خط سفلي `--line`. بلا `backdrop-filter`. من جهة البداية (يمين):

| # | العنصر | المصدر | المواصفة |
|---|---|---|---|
| 1 | `a.brand[href="#home"] > svg.brand-svg` | **تعديل `shell()` النصي** (`${brandLogo}` = `''` في صندوق `vm`) | 24px، أبيض (الورق: أسود كامل). بلا hover ولا حركة. **`a.brand{padding:16px}`** فتصير مساحة الأمان (16px) داخل الرابط، و**`a.brand:focus-visible{outline-offset:0}`** فتقع حافة التركيز خارج مساحة الأمان لا داخلها. المقاس 24+32 = 56 ≤ 64؛ الجوال 20+27 = 47 ≤ 52 |
| 2 | `button.top-btn.top-avatar[data-shell=drawer]` + `span.top-index-label` «الفهرس» | الزر قائم؛ الـ`span` ضمن التعديل النصي نفسه | نص 14/700 ink-2 + أفاتار 28px بحافة `--line-strong`. **ليس همبرغر:** كلمة ظاهرة دائمًا |
| 3 | `nav.sig-tabs` | تحقنها `mountTabs()` اليوم؛ يُعاد تموضعها بـCSS داخل صف الشريط (`position:fixed; top:0`) | وجهات اليوم الأربع نصًّا 14/700 ink-4 بفجوة 32px؛ النشط ink-1 + خط `--ink-1` 2px. **ترتيب `tabOrder` الثابت**، بلا إدراج آلي. `.nav-count` رقم 13/700 بلون `--turn` تسبقه `--m-turn`؛ `.is-late` بلون `--stop` و`--m-stop`. زر «المزيد» فيها مخفي على المكتب |
| 4 | `.topbar-title` | قائم | **مخفي على المكتب** (`display:none` عند ≥ 1024): صف `sig-siblings` يدل على الموضع، والشريط لا يتسع له. يبقى للجوال (§5.5) |
| 5 | `button.top-search[data-shell=search]` | قائم | ≥ 1280: سطر كتابة 240×40: «بحث» ink-4 + `kbd ⌘K`، خط سفلي `--line-strong`. **بين 1024 و1279 ينطوي إلى أيقونة 44px** (`.top-search-text` و`kbd` مخفيان بصريًا): حسابي التقديري عند 1024 أن شعار 56 + الفهرس ~81 + تبويبات ~396 + بحث 240 + مظهر 44 + فجوات 96 ≈ 913px والمتاح 896px |
| 6 | `button.sig-theme[data-action=theme]` | تحقنه `signature.mjs`؛ التفويض على `document` قائم | أيقونة 20px ink-3، هدف 44px، `aria-label` بحالة المظهر. **المظهر بتفاعل واحد** |

**`nav.sig-siblings`** (تحقنها `signature.mjs`؛ ارتفاعها 44px **محجوز في CSS** عبر `--siblings-h` فلا إزاحة تخطيط): `button.sig-siblings-group[data-shell=drawer]` اسم المجموعة الحالية 13/700 ink-4 مع علامة ← ثم ≤ 7 روابط `a[href]` للشاشات الشقيقة (من `.hr-nav-section` التي تحوي `a.active`) 14/400 ink-3، النشط ink-1/700 + خط 2px و`aria-current=page` ← ثم `button.sig-siblings-more[data-shell=drawer]` «المزيد». خط سفلي `--line`. تنطوي الروابط بقياس العرض الفعلي (`ResizeObserver`) لا بـbreakpoint.

**`.stage` و`#main.page`:** `max-width:var(--content-max)`، حشو `--gutter`، `scroll-padding-block-start:calc(var(--sticky-top) + 16px)`.

### 5.3 مشهد الفهرس (`aside.sidebar#app-sidebar` عند `html.is-menu-open`)

- `position:fixed; inset:0; z-index:40`. الخلفية: **< 1024 `var(--canvas)` معتم؛ ≥ 1024 `transparent`** ومعها `html.is-menu-open :is(.stage,.sig-tabs){visibility:hidden}`. السبب: الـcanvas عند `z-index:0` تحت `#app`، فخلفية معتمة بملء الشاشة كانت تحجب الفاصلة العملاقة كليًا. ظهور بـ`opacity` على `--d-scene`. `.side-scrim` بلا دور بصري.
- **تعديل `signature.mjs`:** سلوك الحوار (`role=dialog`، `aria-modal`، `inert` على `.stage` **وعلى `nav.sig-tabs`** (هي خارج `.stage`)، `Esc`، إعادة التركيز) في **كل** المقاسات. `compact()` تبقى `(max-width:1023.98px)` للتبويب السفلي والسحب فقط. عند ≥ 1024 تُضبط السمة `open` على كل `details.hr-nav-group` ويُعطَّل الطي.
- المشهد `index` للـcanvas (≥ 1024): الفاصلة العملاقة الثابتة في 3 أعمدة من جهة النهاية، ومستطيل حظر على عمودي النص.
- **حالتان لا تُخلطان:** `html.is-searching` تضبطها `signature.mjs` عند فتح **لوحة الأوامر** (لا عند ترشيح الفهرس)، وأثرها الوحيد قفل التمرير: `html:is(.is-menu-open,.is-searching),html:has(dialog[open]){overflow:hidden}`. أما **ترشيح الفهرس** فحالته من CSS خالص: `.sidebar:has(#nav-search:not(:placeholder-shown))` ⇒ يُخفى `small.hr-nav-total` و`ul.sig-recent`. و`app.mjs` تفتح أثناء الترشيح كل مجموعة فيها نتيجة وتضع `hidden` على الرابط والقسم والمجموعة التي لا نتيجة فيها؛ فتُكتب صراحةً `.nav :is(a,.hr-nav-section,.hr-nav-group)[hidden]{display:none}` لأن قواعد `display` في الفهرس تلغي سلوك `hidden` الافتراضي.

| العنصر | المواصفة |
|---|---|
| عمود البيان (4/12، بداية، لاصق) | `.side-head`: `h2.side-title` «الفهرس» بـ`--fs-display-l`، فوقه القفل اللاتيني عبر `.side-title::before{content:"INDEX" / ""}` (نص بديل فارغ فلا يقرؤه القارئ الآلي)؛ `button.side-done` نص «إغلاق» + `Esc`. `label.nav-search-label > #nav-search`: سطر كتابة 28px مركَّز فورًا، يرشّح بالتطبيع العربي القائم، و`Enter` يفتح أول نتيجة. **«الأخيرة»:** قائمة `ul.sig-recent` بآخر 5 شاشات (`localStorage 36t-recent`، تُثبَّت لقطتها عند بدء الجلسة فلا يتبدل ترتيبها). `.side-profile`: أفاتار 48px، اسم 20/700، دور 13/700 ink-4. `.side-account`: `button.nav-row` أسطر نصية 15 (المظهر + `.nav-value`، اللغة، كلمة المرور، إيقاف الحركة، الكثافة)، و`.is-destructive` بلون `--stop`. `.side-note` + `.status-dot` (علامة 6px) 13 ink-4 |
| عمود العمل (8/12) | `nav.nav{columns:240px; column-gap:56px}`؛ `details.hr-nav-group{break-inside:avoid}`. `summary.hr-nav-label`: **رقم الفهرس 01–08** بـ`--fs-figure-s` ink-4 عبر `counter-increment` و`counter(…,decimal-leading-zero)` **حصرًا** (لا سمة `data-index`: هي خطاف قائم للوحة الأوامر)، وتحته **شَرطة 32×4 بلون `--horizon`** (مفردة فهرس الدليل: الشرطة فيروزية)، ثم الاسم 22/700، و`small.hr-nav-total` ink-4. `p.hr-nav-sublabel` 13/700 ink-4. `a`: سطر 40px، 16/400 ink-3؛ hover ⇒ ink-1 وتنزلق علامة 8px من جهة البداية 120ms؛ `a.active` ⇒ ink-1/700 + `--m-done` ثابتة. **`.nav-icon` مخفية على المكتب** (تبقى في DOM لأن `sig-tabs` تستنسخها)، وكل `.tint-*{--icon:currentColor}`. `.nav-count` رقم بلون `--turn` بلا فقاعة |

السعة: 4 أعمدة × 19 سطرًا = 76 مدخلًا بلا تمرير عند ارتفاع 900. **الوصول:** أي شاشة مدرجة بتفاعلين (الفهرس ← الشاشة)، أو بواحد (شقيقة، وجهة يومية، ⌘K). **[ملحق — تقادم السطر السابق]** التنقل أُعيد بناؤه بعد كتابة هذه المواصفة: `app.mjs` تدفع حتى 113 مدخلًا (114 مع «المظهر») في ثماني مجموعات بـ21 عنوانًا فرعيًا، فسعة 76 سطرًا لا تكفي حساب كامل الصلاحيات (≈ 143 سطرًا): **عمود العمل يتمرر** (`overflow-y:auto` على `.sidebar`) وعمود البيان لاصق. بند «64 شاشة بلا مدخل» مغلق. التفصيل في الملحق §و.

### 5.4 لوحة الأوامر `.sig-cmd`

`div.sig-cmd{position:fixed; inset:0; background:var(--scrim); z-index:110}`. `.sig-cmd-box`: بلا خلفية ولا حد، `width:min(760px,100% - 32px)`، `margin-block-start:18vh`. **تحت 760:** `margin-block-start:calc(var(--safe-t) + 8px)` وارتفاع `.sig-cmd-list` الأقصى `calc(100dvh - 64px - var(--safe-t))` بتمرير داخلي، وإلا خنقت لوحة المفاتيح النتائج. `label.sig-cmd-input`: سطر كتابة 64px بحجم `--fs-display-m` (جوال 22px)، خط سفلي `--line-strong` يصير `--focus` 2px. `p.sig-cmd-group`: تسمية 13/700 ink-4. `button.sig-cmd-item`: سطر 56px بخط `--line`؛ `strong` 16/700، `small` 13 ink-4، `b` **13/700** ink-4 (نصه عربي: «طلب»/«شاشة»)، `.nav-icon` أحادية 20px. **`.is-active`:** ink-1 + الخط `--line-strong` + مسطرة بادئة 2px `--ink-1` + `--m-done` (مؤشر ≥ 3:1، بلا غسلة). `.sig-cmd-foot`: تلميحات `kbd` نصية؛ مخفية على الجوال. `.sig-cmd-cancel`: زر نصي. `p.sig-cmd-empty`: سطر ink-4 يسبقه «—». **الاختصار: `⌘K` / `Ctrl+K` فقط.** لا اختصارات حرف واحد (WCAG 2.1.4).

### 5.5 الجوال < 1024 (مرجع 375)

- `.topbar` 52px: الشعار 20px من جهة البداية، `.topbar-title` وسطًا عند التقلص، ثم `sig-theme` و`top-search` أيقونتين 44px. `top-avatar` يبقى ويفتح الفهرس.
- **`nav.sig-tabs`:** شريط **مسطح** `--canvas` معتم بعرض الشاشة، `64px + --safe-b`، خط علوي `--line`. بلا طفو ولا blur. خمسة عناصر بهدف 48px: أيقونة 22px `stroke:currentColor` ink-4 + تسمية 13/700؛ النشط ink-1 + خط 2px×24px أعلاه. `.nav-count` كما في المكتب. زر «الفهرس» (`data-shell=drawer` القائم).
- **`html.is-kbd`** (تضبطها `signature.mjs` من `visualViewport`): يختفي `sig-tabs` وشريط القرار عند فتح لوحة المفاتيح. `#main{scroll-padding-block-end:calc(var(--tabbar-h) + var(--safe-b) + 16px)}`.
- **الفهرس:** صفيحة بملء الشاشة من الأسفل؛ عقد السحب `--drag` و`.is-dragging` كما هو. `.side-head::before` مقبض حامل البطاقة. المجموعات أكورديون فعلي: `summary` 56px (رقم 24 + اسم 20/700 + العدد)، الروابط 48px 16/400 بخط `--line`، الأيقونات ظاهرة ink-4. `.nav-search-label` لاصق.
- لا `sig-siblings` على الجوال.

### 5.6 رأس الصفحة `div.page-head`

- شبكة 12 عمودًا. `div:first-child` (7/12 من جهة البداية): تسمية المجموعة `::before{content:attr(data-sig-group)}` 13/700 ink-4 مع علامة (تكتب `signature.mjs` السمة **`data-sig-group`**؛ الاسم `data-group` محجوز: هو سمة قائمة على `details.hr-nav-group` وتقرؤها `signature.mjs` اليوم)، ثم **`h1` واحد** بحجم الطبقة، ثم `p` **كاملًا بلا قصّ**: 16/400 ink-3، ≤ 52ch.
- `.page-actions` (5/12 من جهة النهاية، محاذاة سفلية): أول `.btn.primary` هو الحبّة (48px)؛ أي `.btn.primary` لاحق يُنزَّل إلى حبّة بحافة عبر `~`. `.badge` فيها بصيغة الحالة.
- `::after` = الأفق (مملوك لـ`athar.css`). شريط 6px في الدفتر **وفي كل مسار حساس** (§4.8).
- الحشو العلوي/السفلي: مكتب 56/40، دفتر 32/24، جوال 24/24. الجوال: عمود واحد، و`.page-actions` تحت العنوان، والحبّة 52px بعرض كامل **غير مثبّتة**.
- `a.department-back`: رابط نصي 14/700 ink-3 تسبقه علامة خلفية، فوق التسمية.
- **الرئيسية والبوابة (مسرح):** `h1` يُعرض بصيغة التسمية (13/700 ink-4) ويبقى العنوان الدلالي الوحيد و`topbar-title` يقرؤه كما هو. تحقن `signature.mjs` في `page-head`: `p.sig-date` (هجري + ميلادي، 13/700 ink-4)، `p.sig-greeting` «صباح الخير، {الاسم الأول}.» بـ`--fs-display-l` **في سطر واحد** (الاسم الأول = أول كلمة من نص `.side-profile strong`)، `p.sig-census`، و`a.sig-eye`. `min-height:var(--hero-h)`. **حساب الاتساع عند 380px:** سطر 72×1.25 = 90 + تاريخ 18 + جملة 36 + حبّة 56 + ثلاث فجوات 48 + حشو 96 = 344 ≤ 380 ✓؛ وهالة الحلقة `2.24 × 148 = 332` ≤ 380 − 48 ✓ (R يُشتق من `--hero-h` في الرمز `--hero-ring-r`).

### 5.7 الحوار والصفيحة `dialog#dialog.drawer[.launcher]`

- **تغيير مشهد:** `dialog::backdrop{background:var(--scrim)}` (الصفحة تخفت إلى ~6% بلا لمس `#app`). `dialog{background:var(--canvas); color:var(--ink-2); border:1px solid var(--line-strong); border-radius:0; box-shadow:none}`. `--r-float` للزاويتين العلويتين في صفيحة الجوال وحدها.
- **من 760 فما فوق نافذة وسطية** 640px (`.launcher` 1040px أو `100% - 64px`) بلا انحناء، **والسحب معطَّل فيها**؛ **تحت 760 صفيحة سفلية**. هذه هي القاعدة القائمة اليوم وتُثبَّت. `.dialog-head`: `h2#dialog-title` بـ`--fs-display-m`؛ `button.sheet-close` 44px، أيقونة ink-3 بلا دائرة.
- `.dialog-body{display:flex; flex-direction:column}`؛ **`#dialog-error{order:-1; position:sticky; top:0; background:var(--canvas)}`** بصيغة المانع: الخطأ أعلى الصفيحة لا تحت الأزرار.
- **الجداول داخل الحوار:** الحوار حاوية تمرير، فلا يرث رأس الجدول `top:var(--stick-2)` (≥ 108px): `#dialog th{top:0}` و`#dialog .table-wrap{overflow-x:auto}` دائمًا.
- `.form-actions`: لاصقة أسفل، `--canvas` معتم، خط علوي `--line`. `.btn.dark|.danger[type=submit]` هو الفعل؛ `.btn.outline[data-action=close]` حبّة بحافة. الجوال: `column-reverse` وعرض كامل.
- تحت 760: صفيحة سفلية `100dvh − 12px`، زاويتان علويتان 24px، حافة علوية `--line-strong`، و`.dialog-head::before` مقبض حامل البطاقة. `--drag` و`.is-dragging` محفوظان.
- **لا يُمس:** `<form id="…"` أول سمة، و`data-id="…" data-version="…"` متجاورتان.
- `dialog.journey-dialog`: المعاملة نفسها؛ `.journey-tool` زر نصي، `#journey-search` سطر كتابة، `.journey-results a` أسطر 52px، `.journey-tour-counter` بـ`--fs-figure-s`، `.journey-tour-copy` 16/1.75، `.journey-tour-controls .btn` حبّات، `.journey-help` و`.journey-empty` ink-4.

### 5.8 `#toast`

حبّة طافية: `background:var(--canvas); border:1px solid var(--line-strong); border-radius:var(--r-pill)`، 15/700 ink-1، تسبقها `--m-done` بلون `--ink-1`. أسفل الوسط (32px)، وعلى الجوال فوق التبويب بـ12px. ظهور `opacity` + 8px على 200ms، يبقى 4.5s. `role=status` و`textContent` كما هما. `z-index:120`.

---

## 6. مواصفات المكونات

قاعدة عامة لكل العائلات: `background:transparent; border:0; box-shadow:none; border-radius:0` ما لم يُذكر استثناء. **لا صنف يُحذف أو يُعاد تسميته.** حالات كل عنصر تفاعلي: hover (مؤشر دقيق فقط عبر `@media (hover:hover)`)، `:focus-visible` = `outline:2px solid var(--focus); outline-offset:3px`، active، disabled، loading.

### 6.1 الألواح والبنية

| العائلة | المواصفة | الحالات | الجوال | إستراتيجية CSS |
|---|---|---|---|---|
| `.operations` | عمود بفجوة `--gap-section` | — | كذلك | `display:flex; flex-direction:column; gap` |
| `.panel` `.panel-body` `.panel-head` | شفافة بلا حشو. `.panel-head`: صف baseline؛ `h2` بـ`--fs-title`/700، `p` 14 ink-3، أزراره من جهة النهاية، هامش سفلي 16px. التعشيش يُعبَّر عنه بإزاحة بادئة 24px وسلّم الخط، لا بلون | — | إزاحة 0 | ألواح الجيل الأول الفارغة تصير عناوين أقسام طبيعية |
| `.vn-head` | **عكس الترتيب:** `.operation-actions{order:1}` ثم `> p{order:2}` 13/400 ink-4 ≤ 72ch، **كاملًا بلا قصّ**: شرح النظام و«بيانات تجريبية» ينزل تحت الأفعال بصوت خافت | — | — | flex عمودي. الأفعال: §6.5 |
| `.vn-board` `.vn-tiles` `.vn-tile` (+ `.stats` `.stat` `.stat-label` `.stat-number` `.counts` `.pt-tiles` `.pt-tile` `.acc-stats` `.hr-focus` `.figure`) | أرقام طافية بلا صندوق. `strong` بـ`--fs-figure-m`، و**أول بلاطة في الشاشة `--fs-figure-l`** (`.vn-tiles > .vn-tile:first-child strong`). `span` 13/700 ink-4 **فوق** الرقم (`column-reverse`) تسبقه علامة الحالة. ≤ 6 في الصف | `.is-late/.is-block`: الرقم والتسمية `--stop` + `--m-stop`. `.is-due/.is-warn`: التسمية `--spark` + `--m-wait`، الرقم ink-1. `.is-ok`: ink-2. `.is-old`: ink-4 + `--m-idle`. البلاطة-الرابط: hover ⇒ خط 2px تحت الرقم | عمودان، فجوة 24×32 | `grid auto-fit minmax(160px,1fr)`، فجوة 56px. العدّ التصاعدي ≤ 400ms، مرة لكل مسار في الجلسة، ملغى في الدفتر والحساس |
| `.vn-grid` `.split` `.details-grid` | عمودان 7/5 بفجوة 64px ≥ 1024 | — | عمود واحد | `.details-grid`: §7 (A5) |
| `.vn-block` `.department-section` | `h3` تسمية 13/700 ink-4 + علامة، هامش 12px. `p.subtle` 14 ink-4 | **طيّ الفراغ:** `.vn-block:not(:has(ul,ol,table,dl,.vn-tiles))` ينطوي إلى سطر 40px (العنوان في البداية، جملة «لا …» في النهاية) بخط `--line` | كذلك | المحدِّد مختبَر على ترميز `home-ui` الفعلي (`div.panel-head` يسبق `p`) |
| `.vn-group` | `h2` بـ`--fs-title`؛ العدّاد `span`/`small` بوزن 400 ink-4 | — | — | — |

### 6.2 بطاقة السجل `details.vn-card`

- `summary`: صف بخط سفلي `--line`، ارتفاعه الأدنى `--summary-h` (64px)، شبكة: `.vn-code` (13/700 ink-4، `ltr` معزول، tabular، عرض ≥ 72px) | `.vn-name` (`strong` 16/700 ink-1 + `small` 14 ink-3) | `.vn-flags` (≤ شارتين) | علامة الفتح `--m-wait` 8px ink-4 تتبدل إلى `--m-done` عند الفتح (200ms). **`small` يلتف حين تكون البطاقة مغلقة فقط.**
- **375:** شبكة من سطرين: [`.vn-code` + علامة الفتح في الطرف] ثم [`.vn-name` بعرض كامل]، و`.vn-flags` سطر ثالث ملتف. لا قصّ.
- hover / `focus-within`: الخط ⇒ `--line-strong`، النص ⇒ ink-1. `:focus-visible` على `summary`.
- `[open]` عند ≥ 760: **`summary` لاصق** عند `top:var(--stick-2)` بخلفية `--canvas` فلا يضيع المشغّل مكانه؛ **وهو لاصقًا سطر واحد بارتفاع ثابت `--summary-h`** (`small` بسطر واحد و`text-overflow:ellipsis`، ونصه الكامل ظاهر في الجسم تحته)، لأن `th` داخل البطاقة يلتصق عند `--stick-3` المحسوب منه. تحت 760 لا لصق للملخص (هو ثلاثة أسطر). مسطرة بادئة 2px `--line-strong` بطول الجسم (الحاوية الوحيدة المسموحة). `.vn-body`: حشو 24/40، إزاحة بادئة 72px (جوال 0). الترتيب: التنبيهات ← `.vn-pipeline` ← `.vn-facts` ← الكتل ← الأفعال.
- `.vn-card.is-late|.is-block`: علامة الملخص `--m-stop` بلون `--stop`؛ بقية `is-${status}` تتبع جدول §8.
- `dl.vn-facts` و`dl.detail-data`: `grid repeat(auto-fit,minmax(180px,1fr))` فجوة 24×40 (جوال `minmax(140px,1fr)`)؛ `dt` 13/700 ink-4، `dd` 16/400 ink-2. بلا خطوط. `detail-data` تبقى `dl` لا `table` (اختبار `procurement`).
- `label.sig-filter` (تحقنه `signature.mjs` بعد 6 بطاقات): سطر كتابة بارتفاع `--filter-h` (44px) لاصق عند `--stick-1` (≥ 760)، `output` 13 ink-4. **سلّم اللصق يمنع التراكب:** المرشّح عند `--stick-1`، والملخص المفتوح ورأس الجدول الحر عند `--stick-2`، ورأس الجدول داخل البطاقة المفتوحة عند `--stick-3`.
- `.vn-reqs`/`.vn-req`: صف المتطلب بصيغة §6.3: علامة `--m` + `strong` 15/700 + `small` 13 ink-4، بخط `--line`. `.vn-chips`: صيغة §6.4 غير التفاعلية (نص 13/700 ink-3 تفصله علامة).

### 6.3 القوائم `ul.vn-list` وما يرثها

- يرث الصيغة: `.pt-rows/.pt-row/.pt-row-main`، `.ex-rows/.ex-row`، `.notification-row`، `.req-card`، `.task-row/.task-row-end/.task/.task-info/.task-list`، `.project-card/.project-top`، `.service-row/.compact-services`، `.requirements-list`، `.acc-gap-list/.acc-gap`، `.journey-results a`.
- `li`: شبكة `[محتوى | أفعال]`، `min-height:var(--row-h)`، `padding-block:12px`، خط سفلي `--line`. `strong` 16/700 ink-1 في سطر مستقل؛ `span` 14/400 ink-3 (جملة « · » كما هي، `line-height:1.6`، ≤ 72ch، `text-wrap:pretty`)؛ `small` 13 ink-4؛ `.badge` ثم `.operation-actions` من جهة النهاية.
- **مؤشر الصف:** hover/`focus-within` ⇒ الخط السفلي `--line-strong` + النص ink-1؛ و`focus-within` يضيف مسطرة بادئة 2px `--ink-1`. بلا غسلة.
- الحالات: `li.is-late/.is-block` ⇒ `--m-stop` بلون `--stop` قبل `strong` + مسطرة بادئة 2px `--stop`؛ `li.is-due/.is-warn` ⇒ `--m-wait` بلون `--spark`؛ `li.is-mine/.is-now/.is-decision` ⇒ `--m-turn` بلون `--turn`؛ `li.is-ok` ink-2؛ `li.is-old/.is-inactive` ink-4 + `--m-idle`. `.is-late-text` `--stop`، `.is-warn-text` `--spark`.
- القوائم المتداخلة: إزاحة 24px وصفوف 44px.
- الجوال: `.operation-actions` تنزل سطرًا تحت النص. **لا إخفاء لأي نص:** `small` يبقى ظاهرًا.
- `a.btn` الوحيد في الصف (مثل `inbox-ui`): `li{position:relative}` و`a.btn::after{content:"";position:absolute;inset:0}` ⇒ الصف كله هدف.

### 6.4 الحالة: `.badge` `.vn-flag` `.ex-flag` `.pill` `.status-dot` — التفصيل في §8

**من يرسم `::before`؟** الخاصيتان المحليتان `--c` (اللون) و`--m` (القناع) يعرّفهما A وحده من خريطة §8. الرسم موزّع بلا تكرار: A يرسم `.badge` و`.vn-flag` و`.ex-flag` و`.status-dot`؛ C يرسم البلاطات والمسارات والتنبيهات وعلامة فتح `vn-card`؛ D يرسم صفوف القوائم والجداول وعائلات الشاشات (`wk-*`، `rq-*`…)؛ B يرسم `.nav-count` وعلامات الفهرس. كل راسم يكتب `background:var(--c); mask:var(--m) center/contain no-repeat` ولا يعيد تعريف لون.

`.badge{display:inline-flex; gap:6px; align-items:center; font:700 13px/1.4 var(--font); background:none; padding:0}` و`::before{width:12px; aspect-ratio:1.373; background:var(--c); mask:var(--m) center/contain no-repeat}`. الجمل الطويلة داخل `badge` (كما في `procurement`) تلتف نصًّا عاديًا. `.badge.subtle` = ink-4 + `--m-wait`، و`.badge` المجردة = ink-2 + `--m-done` (يبقى اختبار «مبدئي/مؤكد» صحيحًا لأنه يطابق الترميز). `.pill` `.vn-chips` `.pt-chip` `.rq-chip` غير التفاعلية: نص 13/700 ink-3 تفصله علامة. التفاعلية (`.rq-pill`، `.pt-chip` الرابط، `.pt-quick`): حبّة بحافة `--line-strong` **بارتفاع 44px**.

### 6.5 الأزرار `.btn`

| الصنف | المواصفة | hover | active | disabled | loading |
|---|---|---|---|---|---|
| الأساس `.btn` `.btn.outline` | حبّة `--r-pill`، 44px، 15/700، حشو أفقي 24px، حد 1px `--line-strong`، ink-1، بلا خلفية | الحد ⇒ `--ink-1` | `scale(.98)` 80ms | حد `--line`، نص ink-5 | 3 علامات تتعاقب شفافيتها 900ms |
| **الممتلئ** (قائمة بيضاء فقط، أدناه) | `background:var(--action); color:var(--on-action); border:0`؛ 48px، 56px في المسرح، 52px بعرض كامل على الجوال | `--action-hover` | `--action-press` + `scale(.98)` | **يفقد التعبئة:** حبّة بحد `--line` ونص ink-5 (الفيروزي لا يظهر إلا والفعل ممكن) | كذلك بالأسود |
| `.btn.danger` | نص وحد `--stop`. **لا يُملأ أبدًا** | الحد 2px | — | ink-5 | — |
| `.btn.small` | 36px بصريًا، 13/700؛ الهدف 44px عبر `::after{inset:-4px 0}` | — | — | — | — |
| `.text-button` | 14/700 ink-3، خط سفلي 1px بإزاحة 5px دائمًا، هدف 44px | ink-1 | — | ink-5 | — |

**القائمة البيضاء للتعبئة (محددات سمات، لا ترقية `:first-child` إطلاقًا):**
تُكتب كلها داخل `@layer fill` في `style.css` (§2.4)، فتغلب قواعد «أفعال الصفوف» و`.page-head` بلا سباق نوعية — الترميز الفعلي للحضور `button.btn.outline.small[data-operation=punch_in]` داخل `.vn-head .operation-actions`، وقاعدة الفعل النصي هناك نوعيتها (0,3,0) كانت ستغلب (0,1,0).
`.page-actions .btn.primary` · `.journey-cta` · `[data-operation="punch_in"]` · `[data-operation="punch_out"]` (كلاهما مشروط في `attendance-ui` بـ`can_check_in/out`) · `[data-transition=approve]` · `[data-transition=submit]` · **حين يغيبان:** `.panel-body:not(:has([data-transition=approve],[data-transition=submit])) > :is([data-transition=claim],[data-transition=complete])` (الانتقالات ثمانية؛ منفّذ لا يملك إلا «استلام» أو «إكمال» يرى فعله مضاءً، ويبقى الضوء واحدًا) · `.form-actions .btn.dark[type=submit]` و`.form-actions .btn.primary[type=submit]` · `.login-card .btn.dark` · `.password-form .btn.primary` · `html[data-route=inbox] .vn-group:first-of-type li:first-child a.btn` (مشروط بتحقق ترتيب الخادم، §12). أي `.btn.primary/.dark` آخر داخل `#main` يُرسم حبّةً بحافة. **الشاشة التي لا يُعرف فعلها تبقى بلا تعبئة، وهذا مقصود: لا فعل مُلِحّ، فلا ضوء.**

**أفعال الصفوف:** `li .operation-actions .btn`، `td .btn`، `.acc-actions .btn` ⇒ أفعال نصية 13/700 ink-3، خط سفلي دائم، فجوة 20px، هدف 44px عبر `::after`؛ ink-1 عند مرور الصف. `.btn.danger` في الصف: نص `--stop` مدفوع إلى الطرف بـ`margin-inline-start:auto` (بعيدًا عن الفعل الأول). **`.vn-head` و`.vn-body` بصيغة واحدة (A2):** أول زر حبّة بحافة 44px، والبقية نصية، والهدّام أحمر في الطرف. في `.vn-head`: **ما بعد الثالث تنقله `signature.mjs` إلى `details.sig-more` «المزيد»** (نقل عقد لا إعادة كتابة؛ سمات `data-` تبقى فيعمل التفويض؛ خلف علم تعطيل و`try/catch`).

### 6.6 الحقول والنماذج

**«إطار الكتابة» — لكل نماذج العمل** (`#dialog form`، `#main form` عدا المرشّحات):

- `label`: عمودي. `> span` 13/700 ink-3 فوق الحقل (ink-1 عند `:focus-within`). `.required`: علامة `--m-turn` 6px بلون `--spark` + نص `sr-only` «إلزامي».
- `input, select, textarea`: `background:transparent; border:1px solid var(--line-strong); border-radius:0; min-height:48px` (جوال 52px)؛ 16px ink-1؛ حشو أفقي 14px؛ `caret-color:var(--ink-1)`.
- hover: الحد ⇒ `--ink-3`. **`:focus-visible`: حد 2px `--focus` + `outline:2px solid var(--focus); outline-offset:2px`.** disabled: حد `--line`، نص ink-5. `::placeholder` ink-5.
- الخطأ (`:user-invalid` و`.error` المجاورة): حد 2px `--stop` + `--m-stop` + رسالة 13/700 `--stop`.
- `select`: سهم = نصف الفاصلة عبر `background-image:var(--select-arrow)` (رمز لكل مظهر: 7.46 في الفراغ و5.00 في الورق؛ لا لون مكتوب في القاعدة). `textarea{min-height:120px}`.
- `small.subtle` (التلميح): 13/400 ink-4، **ظاهر دائمًا** (قد يحمل شرط صيغة، WCAG 3.3.2).
- `.form-grid`: `repeat(auto-fit,minmax(260px,1fr))`، فجوة 28×40، `max-width:720px` (في `.launcher` بلا حد)؛ `.full` يمتد. الجوال عمود واحد بفجوة 24px.
- `fieldset.builder-field`: بلا إطار، خط علوي `--line`، `legend` 20/700، 56px بين المجموعات.
- `label.check`، `fieldset.checks-field` › `.checks`: `legend` تسمية 13/700؛ كل `label` صف 48px؛ مربع 22px بحد 1.5px `--line-strong` وانحناء `--r-check`؛ **المحدَّد تعبئة `--ink-1` بعلامة `--canvas`** (لا فيروزي)؛ عمودان على المكتب.
- `.password-form` **ليست هنا:** هي عتبة، فتأخذ سطر الكتابة أدناه، ومالكها `athar.css`.

**«سطر الكتابة» — للبحث والعتبات فقط:** `background:none; border:0; border-bottom:1px solid var(--line-strong)`؛ التركيز: خط 2px `--focus` + `outline` كما أعلاه. **البدائية معرّفة مرة واحدة** في `signature.css` (طبقة `base`) بقائمة المحدِّدات هذه؛ بقية الحزم تضبط المقاس والموضع فقط ولا تعيد تعريف الحد أو التركيز. المواضع: `#login-form`، `#password-form`، `#nav-search`، `.sig-cmd-input`، `.rq-search/#launcher-search`، `.sig-filter`، `.filters` (`#request-filter`، `#scope-filter`)، `.acc-filter`، `#department-search`، `#benchmark-search`، `#journey-search`، `.wk-add`. زر «بحث» في `.filters` نصي. `#department-search-status` و`#benchmark-search-status` 13 ink-4.

**`.rows-field`:**
- المكتب: جدول بلا حدود خلايا، رؤوس 13/700 ink-4، خلايا بإطار كتابة 44px، خط `--line` بين الصفوف. `.rows-remove button`: «✕» ink-4 **بهدف 44px**. `[data-action=row-add]`: فعل نصي «+ إضافة صف» 44px.
- < 760px: `table{min-width:0}`؛ كل `tr[data-row]` كتلة `display:grid; gap:16px; padding-block:20px` بخط `--line`؛ `thead` مخفي بصريًا. **تسمية مرئية دائمة:** `td::before{content:attr(data-label)}` 13/700 ink-4. تنسخ `signature.mjs` نص كل `th` إلى `data-label` على الخلايا و`aria-label` على `[data-col]`، **وداخل `template.content` أيضًا** فترثه الصفوف الجديدة بلا مراقب إضافي. لا `placeholder` بديلًا عن التسمية. لا تمرير أفقي داخل الصفيحة.

### 6.7 التنبيهات: `.vn-alert` `.notice` `.error` — ثلاث درجات بلا خلفية

| الدرجة | الأصناف | المسطرة البادئة 2px | العلامة | `strong` 15/700 | المتن |
|---|---|---|---|---|---|
| مانع | `.vn-alert.is-block`، `.error`، `#dialog-error .error`، `#login-error .error` | `--stop` | `--m-stop` | `--stop` | 14 ink-2 |
| تحذير | `.vn-alert.is-late`، `.vn-alert.is-due` | `--spark` | `--m-wait` | `--spark` | 14 ink-2 |
| معلومة | `.vn-alert.is-ok`، `.vn-alert` بلا معدِّل، `.notice`، `.ex-note`، `.rq-tip` | بلا | `--m-done` ink-4 | ink-2 | 14 ink-3 |

حشو بادئ 16px. `.error` على مستوى الصفحة يتبعه `.btn[data-action=reload]` حبّة بحافة. `.notice` المستعملة بطاقةً في الجيل الأول تصير كتلة بخط علوي `--line`. الجوال: المانع سطران ثم يتمدد عبر `details` إن كان الترميز يوفره، وإلا كاملًا.

### 6.8 المسارات: `.vn-pipeline/.vn-step` `.journey/.journey-step/.step-no` `.rq-trail` `.ex-flow/.ex-step/.ex-arrow` `.journey-path/.journey-stop`

لغة واحدة للأشكال الخمسة: علامة + اسم 14/700 + `small` 13 ink-4، يصلها خط `--line` (و`--line-strong` لما اجتُز). `is-passed` ⇒ `--m-done` ink-2. **الحالي** (`is-now`، أول pending، `is-waiting` عندك) ⇒ `--m-turn` بلون `--turn` بحجم 16px وصف مكبّر 16/700 باسم الشخص. القادم ⇒ `--m-wait` ink-5. `is-failed` ⇒ `--m-stop` `--stop`. `is-needs_info` ⇒ `--m-wait` `--spark`. `.step-no`، أرقام `.ex-step strong`: `--fs-figure-s` ink-4 (الحالي ink-1). `.ex-arrow`: `--m-turn` ink-4. أفقي ≥ 760، و**رأسي دائمًا دونها بلا تمرير أفقي**. `.journey-stop`: أرقام «01 02 03» بـ`--fs-display-m` ink-4 وتحتها شَرطة 24×2 `--horizon` (مفردة الفهرس نفسها، القانون 3-د). **بلا نبض.**

`.vn-days`: صف علامات بخلية 28px مع رقم اليوم 13/700: حضر `--m-done` ink-1، ناقص/متأخر `--m-wait` `--spark`، غياب `--m-stop` `--stop`، عطلة `--m-idle` ink-5، اليوم محاط بحد 1px `--line-strong`. الجوال: تمرير أفقي بـ`scroll-snap` مع تلاشي حافة بـmask.

### 6.9 الأشرطة `.vn-bars/.vn-bar[data-width]` `.ex-bar i`

خط 2px `--ink-1` فوق مجرى `--line`، **نهايته مقطوعة بزاوية الفاصلة 63°** (`clip-path` على العنصر الداخلي فقط مع `:dir(ltr)` معكوسة). التسمية 13/700 فوقه، والقيمة `--fs-figure-s` عند نهايته. المتجاوز `--stop`. السلسلة المميزة وحدها `--spark`. لا فيروزي في الرسوم. العرض عبر CSSOM كما اليوم، ينمو 320ms مرة واحدة.

### 6.10 الجداول `.table-wrap` `table` `.operations-table` `.ex-table` `#accounts-table`

- بلا غلاف ولا zebra ولا خطوط عمودية. `th`: 13/700 ink-4، خط سفلي `--line-strong`. `td`: 15/400 ink-2، tabular، حشو 0×16، ارتفاع `--row-h`، خط `--line`. العمود الأول 15/700 ink-1. `td a strong small`: هوية من سطرين.
- hover/`focus-within` للصف: الخط ⇒ `--line-strong`، النص ⇒ ink-1. `tr.is-inactive` ink-4. `tfoot`: خط علوي `--line-strong`، الإجمالي `--fs-figure-s`. `td[colspan]` الفارغ: سطر ink-4 يسبقه «—».
- **الرأس اللاصق (إصلاح خلل قائم):** اليوم `.table-wrap{overflow-x:auto}` يجعل الحاوية مرجع sticky فلا يلتصق الرأس بالصفحة. عند ≥ 1024: `.table-wrap{overflow:visible}` و`th{position:sticky; top:var(--stick-2); background:var(--canvas)}` (تحت المرشّح إن وُجد)؛ وداخل `vn-card[open]`: `top:var(--stick-3)`؛ وداخل `#dialog`: `top:0` مع `overflow-x:auto` دائمًا. صمام: تضيف `signature.mjs` الصنف `.is-wide` على أي `.table-wrap` يتجاوز `scrollWidth` عرضه ⇒ يعود `overflow-x:auto` ويُلغى اللصق.
- < 760: الجداول ≤ 6 أعمدة (`table[data-cols]` تضبطها `signature.mjs` مع `td[data-label]` من `th`) ⇒ **كل صف سجل:** `tr{display:grid; padding-block:14px}` بخط `--line`، و`thead` مخفي بصريًا. الخلية الأولى سطر عنوان 16/700 ink-1 بعرض كامل. بقية الخلايا أزواج «`data-label`: قيمة» (`td::before{content:attr(data-label)}` 13/700 ink-4 ثم القيمة 15 ink-2) في صف `flex-wrap` تفصل بينها علامة `--m-done` 6px ink-5. خلية الفعل آخرًا بعرض كامل وهدف 44px. **يُسمح بأكثر من سطرين ولا يُقصّ شيء.** الخلايا الفارغة تُطوى (`td:empty{display:none}`). الأعرض من 6 ⇒ تمرير أفقي داخل الحاوية مع عمود أول لاصق (`inset-inline-start:0; background:var(--canvas)`) وتلاشي حافة بـmask.
- `[data-filter]` + `data-filter-text` كما هي.
- المكسب: الدفتر بحاشية 40px عند 1440 ⇒ 1360px ÷ 10 أعمدة = 136px: مسيّر الرواتب بلا تمرير.

### 6.11 الحالات الفارغة والتحميل

- `.empty` (مستوى الصفحة): محاذاة البداية. `.empty-symbol{font-size:0}` (يخفي ⌑) و`::before` الفاصلة العملاقة الساكنة. `strong` بـ`--fs-display-l`، `p` 16 ink-3 ≤ 30em، ثم فعل واحد حبّة بحافة. **لا صنف في الترميز يفرّق «الجيد» عن «الناقص»، فالآلية بالمسار:** الافتراضي هو **الناقص** (فاصلة مفرّغة + تسمية `--spark`)، لأن أغلب الفراغات «لم يُعرَّف بعد». **الممتلئ حصرًا** عبر `html:is([data-route=inbox],[data-route=notifications],[data-route=work]) .empty` («لا شيء ينتظر قرارك الآن.»). القائمة جزء من العقد 2.
- **المسار المجهول وانقطاع الاتصال** لحظتا مسرح لا تنبيهان: `#main > .error:only-child` يُعامل كحالة `.empty` على مستوى الصفحة: عنوان `--fs-display-l`، فاصلة مفرّغة، علامة `--m-stop`، وحبّة بحافة «إعادة المحاولة» (`.btn[data-action=reload]` حيث يوفرها الترميز). `div.error` المصاحب لمحتوى آخر يبقى بدرجة المانع (§6.7).
- الفراغات الداخلية (`.wk-empty` `.pt-empty` `.rq-empty` `p.subtle` «لا …» `td[colspan]`): سطر 14 ink-4 يسبقه «—».
- `.loading` و`#main .loading`: مؤشر حامل البطاقة بعد 400ms؛ مع `reduced-motion` ساكن ونص «جارٍ التحميل». لا هياكل رمادية.

### 6.12 بقية المشتركات

`.timeline/.timeline-item`: خط رأسي `--line` من جهة البداية وعلامة 8px لكل حدث؛ الوقت 13 ink-4 tabular، النص 15؛ الأقدم من خمسة تنقله `signature.mjs` إلى `details.sig-older > summary` («الأقدم ({n})») **نقلَ عقد** بشروط العقد 3 نفسها (متكرر الأمان، `try/catch`، علم التعطيل)؛ بدونها تبقى القائمة كاملة. · `.file`: سطر 48px بخط `--line`، اسم 15/700 بخط سفلي، الحجم 13 ink-4. · `.avatar`: دائرة (شكل الأشخاص في الهوية) بحد `--line-strong`، حرف 13/700، بلا تدرج. · `.ai-output` والنص الطويل: قارئ 17/1.9 ink-2 ≤ 36em بمسطرة بادئة `--line-strong`. · **الرابط العام `a`:** `color:var(--ink-1); text-decoration:underline 1px; text-underline-offset:5px`، و`a:hover{text-decoration-thickness:2px}`، و`:focus-visible` العام. الفيروزي ليس لون رابط. روابط الغلاف والصفوف التي لها صيغتها تلغي الخط صراحةً. · `.muted` = ink-3، `.subtle` = ink-4، `.eyebrow` تسمية، `.mt` 24px، `.ltr`، `.sr-only`، `.full`. · `.skip`: حبّة `--ink-1` بنص `--canvas` عند التركيز، `z-index:100`. · `kbd`: 12/700 بحد `--line`، انحناء `--r-check`. · `::selection{background:var(--select-bg); color:var(--select-ink)}`. · شريط التمرير نحيف بلون `--line-strong` بلا مسار. · `.glyph`: `stroke:currentColor`. · `.counts`: صيغة البلاطات.

### 6.13 عائلات الشاشات

| العائلة | المواصفة |
|---|---|
| **`rq-*`** (المُطلِق) | `.rq/.rq-page`. `.rq-hero`: مسرح؛ `.rq-kicker` تسمية، السؤال بـ`--fs-display-m`، `.rq-search` سطر كتابة 56px بنص 24px. `.rq-body`: سكة + نتائج. `.rq-rail`: قائمة نصية 240px؛ `.rq-rail-group/.rq-rail-label` تسميات 13/700؛ `.rq-rail-item` 15/400، النشط 700 + علامة؛ `.is-all`. **`tone-1…8` ⇒ `currentColor`.** رموز اليونيكود `.rq-rail-icon .rq-dept-icon .rq-row-icon .service-icon` مخفية (`font-size:0; width:0`). `.rq-results/.rq-results-head/.rq-found/.rq-found-dept/.rq-popular`. **`.rq-row` (صنف وحيد حرفي لا يُمس):** سطر 64px بخط `--line`؛ `.rq-row-text strong` 16/700 و`small` 14 ink-3 سطر واحد؛ `.rq-row-meta` 13/700 ink-4 و`.is-time` tabular؛ `.rq-go` ظاهر: علامة تنزاح 4px. `.rq-dept-grid/.rq-dept/.rq-dept-head/.rq-dept-tag/.rq-dept-sections/.rq-dept-count`: فهرس طباعي بثلاثة أعمدة بخط علوي `--line` (اسم 20/700، أقسام 13، العدد `--fs-figure-s`). `.rq-crumbs` نص 13. `.rq-section/.rq-section-no`. `.rq-workspaces/.rq-workspaces-label/.rq-workspace`: أسطر. `.rq-compose*` (6): 7/5؛ `.rq-compose-side` لاصق يحوي `.rq-trail` رأسيًا و`.rq-tip` بدرجة المعلومة. `.rq-fields`: إطار الكتابة. `.rq-back`: رابط نصي. `.is-static`. **الحركة:** `rq-card/rq-enter/rq-shown/is-live` بتعاقب شفافية + 8px و`--rq-delay`؛ `--tilt-*` و`--mx/--my` تُضبط من JS كما يشترط الاختبار **ولا يستهلكها CSS** |
| **الإدارات** | **`.department-card` (صنف وحيد حرفي):** بلا صندوق، خط علوي `--line`؛ `.department-card-top`، `.department-number` `--fs-figure-s` ink-4 («01»)، الاسم 20/700، `.more` رابط نصي. `.department-grid` ثلاثة أعمدة. `.department-summary`، `.department-search`، `.department-section-title`، `.service-grid/.service`: فهرس طباعي بلا بطاقات |
| **`pt-*` / `journey-*`** (البوابة) | `.journey-hero`: بطل مسرح بلا خلفية؛ `.journey-greeting` تسمية؛ `.journey-copy` `--fs-display-l`؛ `.journey-cta` الحبّة. `.journey-heading` عنوان قسم. `.pt-grid` 7/5. `.pt-due`: 13/700 (`--spark` قرب الاستحقاق، `--stop` بعده). `.pt-quicks/.pt-quick`: حبّات 44px. `.pt-label` تسمية. `.pt-chips/.pt-chip` |
| **`ex-*`** | `.ex-hero/.ex-hero-copy`: جملة بـ`--fs-display-l`. `.ex-figures/.ex-figure/.ex-figure-label`: أربعة أرقام `--fs-figure-xl` (جوال 2×2). `.ex-attention/.ex-flag`: صفوف استثناء بأشكال. `.ex-grid`. `.ex-table`: دفتر. `.ex-note` معلومة |
| **`wk-*`** | `.wk-top/.wk-title`. `.wk-board`: ثلاثة أعمدة بفجوة 48px بلا خلفية (`.wk-column`، `.wk-stack`). `.wk-card`: كتلة بخط علوي `--line`؛ `.is-decision` ⇒ `--m-turn` `--turn`؛ `.is-late` ⇒ مسطرة `--stop`؛ `.is-personal` ⇒ `--m-wait` ink-3. `.wk-meta` 13 ink-4. `.wk-check`: مربع 22px (المحدَّد `--ink-1`)؛ `.wk-done` مشطوب ink-4؛ `.wk-add` سطر كتابة 44px؛ `.wk-x` «✕» بهدف 44px. الجوال: `grid-auto-columns:88%` مع `scroll-snap` |
| **`org-*` / `acc-*`** | `.org-top/.org-exec`: اسم `--fs-display-s`/400، `.org-exec-role` تسمية؛ `.org-sector` ثلاثة أعمدة بعناوين 22/700 مرقّمة 01–03؛ `.org-grid/.org-unit` مداخل طباعية بخط علوي، واصلات `--line`. `.acc-stats` بلاطات؛ `.acc-gaps/.acc-gap-list/.acc-gap` صيغة التحذير؛ `.acc-filter` سطر كتابة لاصق؛ `.acc-actions` أفعال نصية |
| **المشاريع `#projects` (شاشة حية)** | ترسمها `app.mjs`: `article.panel.project-card` كتلة بخط علوي `--line`، و`.project-top` صف baseline، و`h2` بـ`--fs-title`. **`.task.open\|.completed`:** شبكة `[.square 22px \| .task-info \| الفعل]` بارتفاع `--row-h` وخط سفلي `--line`. **`.square`:** مربع §6.6 (حد 1.5px `--line-strong`، انحناء `--r-check`)؛ المكتمل بتعبئة `--ink-1` وعلامة `--canvas`، و**حرف «✓» يُخفى بـ`font-size:0`** (لا يونيكود أيقونةً). `.task-info strong` 16/700 و`small` 13 ink-4؛ `.task.completed strong` ink-4. زر «إكمال» فعل نصي. **الجوال:** الفعل ينزل سطرًا تحت النص بعرض كامل |
| **الرئيسية القديمة** | `.hr-hero/.hr-hero-copy/.hr-focus/.departments-entry/.compact-services/.service-row/.requirements-list`: أسطر بخط `--line`؛ غير المقروء `--m-turn` ink-1. (الأرجح غير قابلة للوصول اليوم؛ تُصمَّم احتياطًا) |
| **الجولة** | `#main.journey-enter` انتقال الشاشة بقيمه الثلاث (§9)، مالكه `style.css`. `.journey-tools/.journey-mobile-menu/.journey-sidebar-close` تبقى `display:none!important` |

---

## 7. معالجة الأنماط (Archetypes) والإخراج الخاص

### 7.1 الأنماط

| النمط | الطبقة | كيف يركّبه النظام |
|---|---|---|
| **A1 لوحة الملخص** | مكتب | `page-head` (تسمية + `h1` 44 + أفق) ← `.vn-head` (الأفعال أولًا: حبّة بحافة + فعلان نصيان + «المزيد»، والشرح تحتها همسًا) ← `.vn-board` ببؤرة واحدة 56px ← `.vn-grid` 7/5 من `.vn-block`. الكتل الفارغة مطوية. صف القائمة: عنوان 16/700 + سطر بيان 14 + أفعال نصية. القوائم المتداخلة (مرشحو التسوية) بإزاحة 24px |
| **A2 بطاقات قابلة للطي** | مكتب | `.vn-group` ← `details.vn-card`. الملخص اللاصق يحل ضياع المكان. داخل الجسم: التنبيهات ← المسار ← الحقائق ← الكتل ← شريط أفعال: الأول حبّة بحافة، البقية نصية، الهدّام أحمر في الطرف. الجداول الداخلية (10 أعمدة في المسير) برأس لاصق تحت الملخص. **حدّ المرحلة الأولى:** لا رابط عميق للسجل ولا صفحة تفاصيل؛ علاجهما مرحلة ثانية تمس `*-ui.mjs` |
| **A3 كومة الألواح (دَين)** | مكتب | يرث A1/A2 بصريًا: الألواح بلا صناديق، `notice` المستعملة بطاقةً تصير كتلة بخط علوي، و`form-actions` المستعملة شريطَ أزرار تصير صف أفعال نصية خارج الحوار (`#main .form-actions{position:static}`). الترحيل البنيوي خارج النطاق |
| **A4 قائمة/جدول طويل** | دفتر | `h1` 32، شريط 6px، `.filters` أسطر كتابة لاصقة، جدول بصف 44px ورأس لاصق. `acc-actions` نصية تسطع عند مرور الصف. الجوال: سجل من سطرين (≤ 6 أعمدة) أو عمود أول لاصق. `req-card` (220 متطلبًا) و`notification-row` أسطر |
| **A5 صفحة التفاصيل** | مكتب | **CSS خالص بلا لمس قالب `app.mjs`:** `.details-grid > div:nth-child(2){order:-1; display:flex; flex-direction:column}` **بلا لصق للعمود كله** (يحمل في الترميز أربعة ألواح — التقييم، التحويل، الخطوة التالية، المسار — ومعها `sig-arc`، فإن طال عن النافذة صار أسفله بعيد المنال). **اللاصق لوح القرار وحده:** `section.panel:has([data-transition]){order:-2; position:sticky; top:calc(var(--sticky-top) + 24px); background:var(--canvas)}`، وبقية العمود تتمرر؛ `section.panel:has(.journey){order:-1}`. الجوال: `.details-grid{display:flex; flex-direction:column}` و`> div{display:contents}`. التفصيل في §7.2 (6). **ترتيب التركيز يُفحص يدويًا هنا** لأن `order` يفصل الترتيب البصري عن ترتيب Tab؛ ويُحصر استعمال `order` في هذه الشاشة و`vn-head` و`#dialog-error` |
| **A6 مسار القرار** | عابر | اللغة الموحدة في §6.8. «دورك» فيروزي باسم الشخص؛ فصل المهام يظهر تنبيهًا بدرجة المعلومة بلغة بشرية. القرار الثنائي عبر `select` يبقى في المرحلة الأولى (تغييره يمس الوحدات) |
| **A7 مصفوفة الإعدادات** | مكتب | صيغة A1. شارات الصحة في `.vn-head` بلغة الحالة. **حدّ:** المصفوفة المسطّحة إلى 16 صفًا تبقى قائمة؛ الشبكة الحقيقية والمفاتيح المباشرة مرحلة ثانية |
| **A8 التقرير والتصدير** | دفتر | بطاقات التعريف A2. النتيجة داخل `#dialog.launcher` (1040px) برأس جدول لاصق داخل الحوار (`#dialog th{top:0}`، و`#dialog .table-wrap{overflow-x:auto}` دائمًا، §5.7) وروابط التصدير أفعالًا نصية في `.form-actions`. صفحة تقرير كاملة مرحلة ثانية |
| **A9 صفيحة النموذج** | عابر | §5.7 + §6.6 (والجداول داخلها بقاعدة `#dialog th{top:0}`): خطأ في الأعلى، إطار الكتابة، تلميح ظاهر، صفوف مكررة كتلًا رأسية على الجوال، حبّة واحدة تحمل اسم الفعل |
| **A10 المُطلِق والدليل** | مسرح (الرأس) | §6.13 `rq-*`. البحث أولًا بسطر كتابة كبير؛ السكة على الجوال شريط نصي أفقي بـsnap مع تلاشي حافة؛ المسار `rq-trail` مطوي أعلى الحقول على الجوال |
| **A11 الواجهات الشخصية** | مسرح ← مكتب | بطل 380 (وحدّ أدنى 200 على الجوال) بالحلقة والتحية بالاسم الأول والتوأم النصي، ثم مكتب هادئ. العائلات الثلاث (`journey-*`، `vn-*`، `wk-*`) تتوحد بصريًا بصيغة الصف والبلاطة. دمج الشاشات الأربع قرار منتج لا قرار شكل |
| **A12 الزمني** | مكتب | `.vn-days` شريط علامات؛ كتل التواريخ في `.vn-grid` بعنوان يوم 13/700 لاصق على الجوال. التواريخ كما يعطيها الترميز (ISO في الوحدات)؛ التوحيد مرحلة ثانية |
| **A13 النص الطويل** | مكتب | `.ai-output` قارئ 17/1.9. **حدّ:** نص الخطاب داخل `li > small` يبقى 13px في المرحلة الأولى إلا حيث يمكن استهدافه بمسار (`html[data-route=letters] .vn-list small{font-size:15px; color:var(--ink-2)}`) |
| **A14 الفراغ** | مسرح/عابر | §6.11: نوعان يُفرَّق بينهما بالمسار لا بصنف، و`#main > .error:only-child` (مسار مجهول، انقطاع اتصال) بالصيغة نفسها، وطيّ «أعمدة النفي» |
| **A15 التنبيه والحالة** | عابر | §6.7 و§8. إخلاءات «بيانات تجريبية» همس تحت الأفعال، فيستعيد التنبيه الحقيقي قيمته |
| **A16 الطباعة** | — | **خارج هذه المرحلة، ومسار تالٍ ملزم.** `report-print.css` يكتب الشعار اليوم بـ`font:700 22px Arial` (مخالفة حية للدليل على مستندات تخرج للبنوك والعملاء). لا يُعلَن اكتمال الهوية قبل معالجته بلغة «الورق» |
| **A17 الغلاف** | — | §5 |
| **A18 الدخول** | مسرح | §5.1 |

### 7.2 الإخراج الخاص للشاشات العشر (+ الدخول)

**0) الدخول** — §5.1.

**1) بوابتي `#portal` و2) الرئيسية `#home` (مسرح ← مكتب).**
- 1440: شريط بطل 380px. من جهة البداية (7/12): `p.sig-date` ← `p.sig-greeting` 72/400 **سطر واحد بالاسم الأول** ← `p.sig-census` 20/1.8 ink-3 ← الحبّة الوحيدة إن وُجدت (`.journey-cta` أو `.page-actions .btn.primary`) 56px. من جهة النهاية (5/12): `a.sig-eye` مربع `2.24 × 148 = 332px` تتطابق عليه حلقة الدوام (R=148، تقيسه `signature.mjs`، §4.4)، وفي وسطه الرقم 84/400 + «بانتظار قرارك». eyebrow البطل **ink-4** لا أصفر، لأن البطل يحمل حالات وقت حقيقية.
- تحت البطل: `.vn-tiles`/`.pt-tiles` (البؤرة 56px) ← `.vn-grid`/`.pt-grid` 7/5، «ما ينتظرك» أولًا كما يعطيه الترميز. الكتل الفارغة سطر 40px.
- 375: **`--hero-h` حدّ أدنى (`min-height:200px`) لا ارتفاع ثابت.** صف أول: `a.sig-eye` مربع 134px (R=60) من جهة النهاية وفي عينه الرقم `--fs-figure-s` وحده (تسميته مخفية بصريًا `sr-only` هنا لأن `sig-census` بجواره تقول الجملة نفسها، وقطر العين 86px لا يتسع لها)، وبجواره `p.sig-date` ثم `p.sig-census` 14/1.6 في العمود الباقي (~190px). صف ثانٍ: `p.sig-greeting` 36/400 **بعرض كامل** وسطر واحد (كلمة مثل «عبدالعزيز.» ≈ 180px كانت تفيض عن 159px بجوار الحلقة). المجموع التقديري 134 + 8 + 45 + حشو 24 ≈ 211px. ثم **أول قائمة مباشرة** (جواب «وش ينتظرني» في الشاشة الأولى). الحلقة تتجمد بعد 12s. الحلقة لا تمر خلف أي نص أصغر من 40px (مستطيل حظر على عمود النص).

**3) العمل اليومي `#work` (مكتب).** `wk-top` برأس 44px؛ `.wk-card.is-decision` بعلامة «دورك» الفيروزية أولًا؛ أعمدة `wk-board` بلا خلفيات؛ `wk-add` سطر كتابة مباشر بلا صفيحة. الجوال: الأعمدة snap أفقي 88%.

**4) بانتظار قراري `#inbox` (مكتب).** عمود البيان (5/12، لاصق): تسمية «مساحتي»، `h1` 44/400، الرقم البؤري 56px وتحته تسميته؛ يحمرّ مع `is-late`. عمود العمل (7/12): صفوف 72px؛ **الصف كله هدف** (`a.btn::after`)؛ علامة «دورك» فيروزية قبل كل عنوان، و`--m-stop` حمراء للمتأخر. **قانون الضوء الواحد:** رابط أول صف وحده حبّة فيروزية 44px «فتح الشاشة»، والبقية نص (مشروط بتحقق أن الخادم يرتّب الأقدم أولًا). **يُصمَّم ما في الترميز فقط:** رابط واحد لكل صف، لا أفعال صف مخترعة. الفراغ: «لا شيء ينتظر قرارك الآن.» 72/36 + الفاصلة العملاقة الممتلئة. 375: `h1` 30، الرقم 36 بجوار تسميته، الحبّة في أول صف تحت نصه بعرض كامل 52px.

**5) طلب جديد (المُطلِق + المحرر).** `#dialog.launcher`: `rq-hero` بسؤال 44/400 «وش تحتاج اليوم؟» وسطر كتابة 56px مركَّز؛ «الأكثر طلبًا» حبّات 44px؛ السكة نصية مجمّعة بالقطاعات (`rq-rail-group`)؛ صف الخدمة 64px يعرض المسار والزمن في `rq-row-meta`. المحرر 7/5: اسم الخدمة 22/700 ← الحقول بإطار الكتابة ← `rq-tip` «يُحفظ مسودة ثم تقدّمه من صفحة الطلب» بدرجة المعلومة **أعلى** الأزرار لا في الهامش؛ والعمود اللاصق `rq-trail` رأسيًا: من سيعتمد وكم يستغرق.

**6) تفاصيل الطلب `#request/:id` (مكتب).**
- `page-head`: «العودة للطلبات» (`.page-actions a.btn.outline`) تُنزَّل رابطًا نصيًا فوق التسمية؛ `h1` 44 (`is-long` ← 32)؛ `clockChip` رقم `--fs-figure-s` (`--spark` قرب الاستحقاق، `--stop` بعده) مع كلمته.
- عمود البيان (5/12؛ **اللاصق فيه لوح «الخطوة التالية» وحده**، A5): **(أ) «الخطوة التالية»** أولًا: `[data-transition=approve]` أو `submit` الحبّة 56px بعرض العمود — **الوحيدة**؛ وحين يغيبان معًا يضيء `claim` أو `complete` بدلًا منهما (§6.5)؛ تحتها `.btn.outline` «إعادة للتعديل» و`.btn.danger` «رفض» بنص وحد `--stop`. إن لم يكن للمستخدم فعل: سطر ink-3 ولا فيروزي. **(ب) «مسار الاعتماد»:** `svg.sig-arc` قطره 112px (24 فاصلة: المنجز ink-2، الحالي `--turn`، القادم ink-5) بجوار الخطوات رأسيًا بالأسماء — «عند من طلبي؟» يُجاب باسم في أعلى الشاشة. عند الإغلاق يكتمل القوس مرة واحدة (20ms لكل علامة) ويُقرأ «أُغلق في 3 أيام من 5» حيث يوفر الترميز الرقمين.
- عمود العمل (7/12): `dl.detail-data` ← المهام ← `.file` ← `.timeline` مطوي بعد 5 ← `details` النسخ ← UUID 12 ink-5.
- 375: الترتيب بـ`order`: البيان ← المسار ← البيانات ← المرفقات ← السجل. **شريط القرار:** `section.panel:has([data-transition]){order:99; position:sticky; bottom:calc(var(--tabbar-h) + var(--safe-b)); background:var(--canvas); border-top:1px solid var(--line-strong)}`، `panel-head` و`subtle` مخفيان بصريًا؛ صف: [الممتلئ 52px `flex:2`] [أول `outline` حبّة بحافة `flex:1`]، و`danger` (`reject`/`cancel`) نص أحمر في **صف أعلى** من جهة النهاية، بعيدًا عن الإبهام. **لأكثر من ثلاثة أزرار** (الانتقالات ثمانية): بقية أزرار `outline` في صف ثانٍ ملتف تحت الأول، والشريط `max-height:40dvh; overflow-y:auto`. يختفي مع `html.is-kbd`. حوار الانتقال (`#transition-form`): عنوان = اسم الفعل، `textarea` بإطار، حبّة واحدة باسم الفعل (`.btn.danger` في حوار الرفض تبقى نصًّا وحدًّا أحمر).

**7) الطلبات `#requests` والإشعارات `#notifications` (دفتر).** `h1` 32، `#request-filter` أسطر كتابة لاصقة، جدول بصف 44px، الصف رابط، وعمود «فتح» المكرر يُخفى بصريًا (`td:last-child .btn` يبقى للقارئ الآلي). الحالة شكل + كلمة. الإشعارات: أسطر 56px، غير المقروء `--m-turn` ink-1.

**8) الحضور `#attendance` (مكتب).** `[data-operation="punch_in"|"punch_out"]` هو الحبّة 56px (واحد منهما ظاهر بحسب `can_check_in/out`)، وأول الأفعال؛ بقية الأفعال الستة: فعلان نصيان + «المزيد». بعد البصمة toast «سجّلنا حضورك 8:57.». `.vn-days` شريط العلامات؛ اليوم الناقص `--m-wait` أصفر وكلمة «يحتاج توضيحًا» (حيث يعطيها الترميز). الجدول الشهري 7 أعمدة بصيغة الدفتر داخل المكتب.

**9) الإجازات `#leave` (مكتب، جيل أول).** الأرصدة `detail-data` بأرقام `--fs-figure-s`؛ الجملة التوضيحية المكررة 13 ink-4؛ الطلبات ألواح بلا صناديق بخط علوي؛ دفتر الحركات جدول دفتري. **حدّ صريح:** زر «طلب إجازة» يبقى حيث يضعه الترميز؛ ترقيته إلى فعل أساسي تحتاج لمس `leave-ui.mjs`.

**10) قسائم راتبي `#payroll` (دفتر، حساس).** سكون تام في الحركة: بلا عدّ تصاعدي، بلا تغذية للـcanvas، بلا حركة عدا التركيز. **شريط الدفتر 6px يبقى** (ساكن، لا يحمل بيانات، وهو حبر الهوية الوحيد في الشاشة). الجدول 10 أعمدة برأس لاصق تحت ملخص البطاقة (`--stick-3`). المبالغ tabular بمحاذاة طبيعية. سطر الخصوصية («تظهر لك وحدك، ويُسجَّل كل اطلاع عليها») بدرجة المعلومة حيث يوفره الترميز.

---

## 8. نظام الحالة والدلالة اللونية

**المبدأ:** الحالة دائمًا **شكل + كلمة + لون**، والكلمة لا تغيب أبدًا. أربعة أشكال فقط، كلها من الفاصلة، ومختلفة في الكتلة فتُميَّز عند 10px وفي `forced-colors` وعند عمى الألوان:

| الشكل | القناع | المعنى |
|---|---|---|
| فاصلة كاملة ممتلئة | `--m-done` | اكتمل، ساري، مؤكد |
| نصف فاصلة مفرّغ | `--m-wait` | جارٍ أو منتظر عند غيرك؛ وبالأصفر: وقته يقترب |
| نصف فاصلة ممتلئ | `--m-turn` | **دورك** (فيروزي دائمًا، أكبر بدرجة) |
| فاصلتان متقابلتان «\/» | `--m-stop` | توقف: متأخر، ممنوع، مرفوض، فاشل (أحمر دائمًا) |
| شَرطة | `--m-idle` | خامل: مسودة، مغلق، مؤرشف |

**مجموعات `badge` الخمس (~80 قيمة):**

| المجموعة | القيم | الشكل | لون الشكل | الكلمة |
|---|---|---|---|---|
| الخضراء سابقًا | `approved completed passed active paid executed done signed published released fulfilled received confirmed matched cleared obtained qualified filed remitted issued answered no_conflict reviewed quote_approved shot accepted verified met` | `--m-done` | ink-2 | ink-2 — **هادئة بلا أخضر: الطبيعي صامت** |
| البرتقالية الهادئة | `pending pending_hr pending_manager proposed submitted awaiting` | `--m-wait` | ink-4 | ink-3 |
| البرتقالية المنبِّهة | `due_soon expiring needs_info returned brief_returned reshoot lost_review written_exception` | `--m-wait` | `--spark` | `--spark` |
| الحمراء | `rejected failed overdue expired contract_expired declined refused lost stopped different missing blocked` | `--m-stop` | `--stop` | `--stop` |
| الزرقاء سابقًا | `in_progress open in-progress scheduled running` | `--m-wait` | ink-1 | ink-2 — بلا أزرق |
| الرمادية | `withdrawn locked draft cancelled suspended closed archived retired superseded ended unused none out inactive subtle` | `--m-idle` | ink-5 | ink-4 |

**أصناف `is-*`:** `is-mine is-now is-decision is-active` ⇒ `--m-turn` `--turn`. `is-late is-block is-failed is-expired is-missing` ⇒ `--m-stop` `--stop`. `is-due is-warn warn is-expiring is-needs_info is-pending` ⇒ `--m-wait` (`--spark` للوقتية، ink-4 لـ`is-pending`). `is-ok is-passed is-met is-verified` ⇒ `--m-done` ink-2. `is-old is-inactive` ⇒ `--m-idle` ink-4. `is-personal` ⇒ `--m-wait` ink-3.

**ألوان المناسبات** تظهر في وحدة التعاميم فقط، بقالب الدليل الرباعي (Logo ← شريط النوع المتلاشي الطرف ← رسم ← محتوى)، كتلًا بنص فحمي `#353535` (و`#000` على «عاجل» و«تعميم»). «تعميم» **فيروزي** كما في صفحة 22. «تعزية» **لا تأخذ النص الفحمي** (`#353535` على `#000` = 1.71): كتلتها `--condolence-block` ونصها `--occasion-condolence-ink` — على الورق كتلة سوداء بنص أبيض، وعلى الفراغ تنعكس بيضاء بنص أسود (21:1 في الحالين) مع سكون تام — **الانعكاس يحتاج موافقة المالك**. **حدّ صدق:** هذا القالب يتطلب أن يوفر ترميز `announcements` نوع الإعلان صنفًا أو سمة؛ لم أتحقق من ذلك، فإن غاب فهو مرحلة ثانية.

---

## 9. الحركة

| الحركة | المواصفة |
|---|---|
| انتقال الشاشة `#main.journey-enter` (المالك `style.css`) | ثلاث قيم بحسب `data-tier`: **المسرح** `opacity` 0→1 + `translateY(8px)` على 200ms؛ **المكتب** الشيء نفسه؛ **الدفتر والمسارات الحساسة** `opacity` 120ms فقط. لا كشف عند التمرير في شاشات العمل. (اليوم `signature.css` تكتب `.journey-enter{animation:none}`؛ يزول مع إعادة كتابة الملف) |
| عنوان المسرح | كشف سطري `clip-path:inset(0 0 100% 0)` → `inset(0)` على 420ms، مرة لكل مسار في الجلسة |
| الصف | الخط `--line` → `--line-strong` والنص → ink-1 على 120ms |
| الحبّة | hover لون؛ active `scale(.98)` 80ms |
| الحوار / الفهرس / الأوامر | `::backdrop` 200ms؛ المحتوى `opacity` + 8px على 240ms؛ صفيحة الجوال 320ms مع `--drag` |
| العدّ التصاعدي | ≤ 400ms، مرة لكل مسار في الجلسة؛ ملغى في الدفتر والحساس |
| `[data-width]` | نمو 320ms مرة واحدة |
| `rq-enter → rq-shown` | شفافية + 8px على 160ms بتعاقب `--rq-delay` (0/34/68ms). **`hr-design.css` يحتفظ حرفيًا بـ`@media(prefers-reduced-motion:reduce)` و`@keyframes rq-beam` و`@keyframes rq-sheen`**؛ `rq-beam` يُعاد توظيفه مسحة ضوء على خط `rq-search` عند التركيز، و`rq-sheen` لمسح مؤشر التحميل |
| لحظة العبور | حقل فيروزي 400ms مرة عند نجاح الدخول؛ مع إيقاف الحركة إطار ساكن بقطع (§5.1) |
| الإنجاز | قوس الطلب يكتمل ≈ 500ms مرة واحدة؛ toast نصّه حقيقة |
| الحلقة | §4 |

`@media (prefers-reduced-motion:reduce)` **و`:root[data-motion=off]`** (طبقة `kill`): كل `transition` و`animation` ⇒ `0.01ms`؛ الحلقة إطار ثابت؛ لا عدّ، لا كشف؛ العبور إطار ساكن؛ التحميل ساكن بنص. **الكتلة المجمَّدة في رأس `hr-design.css` لا تُمس حرفيًا**؛ القاتل يُكتب في كتلة ثانية تحتها (بمسافة بعد `@media`، فلا تصطدم بالسلسلة المفحوصة). لا ارتداد (`--spring` يزول من `signature.css` مع إعادة كتابتها). لا View Transitions (لأن `render()` يكتب `innerHTML` ولا يُلفّ دون مساس بالاختبارين). `prefers-reduced-transparency` لا عمل له: النظام بلا شفافية مواد.

---

## 10. نبرة النص في الواجهة

مطابقة لتحليل صوت الشركة (`02-company-and-users.md` §7): **صوت العلامة منضبطًا بدقة اللائحة.**

1. فصحى مبسطة بضمير المخاطب: «طلبك عند المدير المباشر» لا «تم تحويل الطلب».
2. الفعل أولًا وجمل قصيرة: سطر يقول ما حدث، وسطر يقول ما تفعله الآن.
3. واثقة غير اعتذارية: لا «عذرًا» ولا «للأسف» ولا علامات تعجب.
4. الاعتزاز بالأرقام لا بالصفات: «أُغلق الطلب. 3 أيام من 5.»
5. تسمّي الأشخاص والمدد: «عند مديرك المباشر منذ يومين. يستحق الرد قبل الخميس.»
6. صادقة فيما ليست عليه بوسم قصير ثابت: «غير متصل بالبنك · إدخال يدوي».
7. لا تشرح كيف بُنيت.
8. لا تفترض جنس المخاطب: الأزرار بالمصدر («اعتماد الطلب»)، والتحية «صباح الخير، {الاسم}.»
9. مصطلح واحد لكل مفهوم من قاموس `UX-COPY-AUDIT.md`: «اعتماد» داخليًا، «موافقة» للعميل والمورد، «إقرار» للاطلاع، «طلب»، «دليل الخدمات»، «صلاحية».
10. لمسة سعودية بيضاء في ثلاث عتبات فقط (سؤال الطلب «وش تحتاج اليوم؟»، تحية الرئيسية، بعض الفراغات)؛ وفصحى دقيقة في المال والراتب والجزاءات والأخطاء والأمان. **اختيار يؤكده المالك.**

نصوص يضيفها هذا التصميم (في `signature.mjs` فقط، بـ`textContent`): التحية (صباح/مساء الخير بحسب ساعة الرياض)، `sig-census` («{n} بانتظار قرارك.» / «{n} بانتظار قرارك، ومنها متأخر.» / «لا شيء ينتظر قرارك الآن.»)، «الفهرس»، «الأخيرة»، «المزيد»، «إغلاق»، «إيقاف الحركة»، «جارٍ التحميل». العدد والمعدود عبر `Intl.PluralRules('ar')`. أرقام 0–9. التاريخ هجري وميلادي بتوقيت الرياض. **حدّ:** الوحدات الـ104 عربية فقط؛ النصوص المحقونة ثنائية اللغة بحسب `document.documentElement.lang`.

---

## 11. ما لا نفعله عمدًا

- **أسطح:** لا سطح ثانٍ، لا لوح رمادي، لا بطاقة، لا غسلة مرور، لا zebra، لا غلاف جدول، لا skeleton رمادي.
- **مؤثرات:** لا `box-shadow`، لا `backdrop-filter`، لا تدرج، لا توهج. «التدرج» الوحيد تلاشي حبر العلامات.
- **الفيروزي:** ليس رابطًا ولا أيقونة ولا عنوانًا ولا «معتمد» ولا شريط رسم ولا مؤشر كتابة ولا `::selection`. لا تعبئتان في مشهد. لا أبيض صغير عليه، ولا `#16A085` نصًّا على الأبيض. لا فيروزي مخفَّف.
- **التعبئة:** لا ترقية `:first-child`، لا FAB، لا زر ممتلئ داخل صف، لا تعبئة حمراء لزر الحذف.
- **الحالة:** لا رقاقات ملوّنة الخلفية، لا حالة باللون وحده، لا أخضر ولا أزرق ولا برتقالي للتشغيل، لا ألوان مناسبات زينةً أو تصنيفًا، لا 13 لونًا لـ`tint-*` ولا `tone-1…8`، لا يونيكود أيقوناتٍ.
- **التنقل:** لا شريط جانبي دائم، لا همبرغر وحيد، لا شريط تبويب زجاجي عائم، لا عناصر تنقل يتبدل ترتيبها داخل الجلسة، لا اختصارات حرف واحد.
- **الحلقة:** لا جسيم خلف جدول أو نموذج أو نص < 40px أو في حوار فيه إدخال أو في الدفتر أو تحت الشريط العلوي؛ لا دوران ولا بعثرة؛ لا افتتاح يتكرر؛ لا تفاعل مع ضغطات المفاتيح؛ لا نبض لانهائي؛ لا غوص ولا تكبير في الانتقالات؛ لا عدّ من DOM؛ لا راتب ولا حالة سرية في السماء؛ لا معلومة في الـcanvas وحده.
- **الشعار:** لا يُرسم بالجسيمات، لا يُكتب بخط، لا يُطوَّق بالنمط، لا يوضع في عين الحلقة، لا hover ولا حركة ولا شفافية، ولا شيء داخل مساحة أمانه.
- **الطباعة والخط:** لا وزن 200، لا `letter-spacing` على العربية، لا كشيدة ولا مائل ولا `overflow-wrap:anywhere`، لا خط ثانٍ خارج `pre`، لا أوزان مصطنعة، لا عربي تحت 13px، لا تتبّع سالب إلا على `[data-num]`، لا قفل لاتيني على نص عربي.
- **الإتاحة:** لا قصّ بلا كشف، لا فتح بـhover، لا إخفاء معلومات على الجوال، لا `placeholder` بديلًا عن التسمية، لا أهداف لمس دون 44px، لا `text-align:end` للأرقام.
- **الهندسة:** لا `style=` ولا `<style>` ولا `<script>` داخلي ولا مورد خارجي؛ لا ملف ثابت باسم جديد؛ لا `import` ولا استدعاء جديد في `app.mjs`؛ لا لمس `*-ui.mjs` و`report-print.css` و`dates.mjs` و`athar.mjs`؛ لا إعادة تسمية صنف؛ لا إعادة كتابة عقد نصية للوحدات؛ لا قاعدة CSS خارج `@layer` (عدا الكتلة المجمَّدة)، لا `!important` خارج `kill`، لا منسّق آلي على `hr-design.css`، لا سمة محقونة باسم قائم (`data-group`، `data-index`)؛ لا إحداثيات فيزيائية (`left/right`) — خصائص منطقية و`:dir()`.
- **المزاج:** لا كثافة صفحة هبوط في الدفتر، لا «وضع داكن عادي»، لا رسوم شخصيات، لا قصاصات احتفالية، لا نكات في الأخطاء.

---

## 12. قرارات المالك — أُغلقت بالتفويض في 2026-09-18

> **[ملحق]** قال المالك حرفيًا «انت شف وش الافضل ووافق»، فحسم المنسّق البنود الستة عشر كلها. العمود الأخير هو الحسم، وتفصيل أثره في `DESIGNS-ADDENDUM.md` §أ. الذي يبقى بيد المالك وحده: تأكيد قيم HEX الرسمية (البند 1 يُصحَّح حينها بسطر واحد)، وملف النمط المتجهي (البند 2)، وتفعيل ملفات الخط (البند 6).

| # | القرار | التوصية | أثر التبديل | الحسم |
|---|---|---|---|---|
| 1 | **قيم HEX الرسمية** من صفحة الألوان (9) وصفحة المناسبات (10): هل الفيروزي `#16A085` أم `#16A086`؟ والفحمي والسماوي والمناسبات السبع، وربط الأصفر = تذكير والبرتقالي = مبروك | اعتماد `#16A085` مبدئيًا | رمز واحد لكل لون؛ يُعاد سكربت التباين. نص الزر الأسود يتحمل انزياحًا واسعًا (6.40 اليوم) | **مغلق:** `#16A085` في رمز واحد `--brand-turquoise`؛ البقية تقديرات موسومة |
| 2 | **شكل علامة النمط:** فاصلة رباعية أم مثلث؟ ومعه طلب ملف النمط المتجهي وصفحة الأيقونات (25) | فاصلة، مع مثلث تحت 5px | ثابت `MARK` واحد + ستة أقنعة `data:` | **مغلق:** فاصلة الشعار؛ يُراجع عند تسليم ملف النمط |
| 3 | **الأسود `#000` أرضيةً دائمة** رغم استنتاج الموجز حجزه للتعزية | نعم (الدليل يجيز الشعار الأبيض على الأسود، والطلب الحرفي «مثل Dala») | **ليس رمزًا واحدًا.** على الفحمي `#353535` ترسب نصًّا: `--turn` 3.74، `--stop` 3.21، `--ink-5` 2.86، `--ink-4` 4.36. التبديل يتطلب **كتلة رموز فحمية كاملة** (مرفقة محسوبة تحت الجدول)، وثمنها فيروزي وأحمر مخفَّفان للنص خلافًا لقاعدة «لا فيروزي مخفَّف» | **مغلق:** `#000` دائم في التصميم الافتراضي. الفحمي صار تصميمًا مستقلًا يختاره المستخدم (`slate`) |
| 4 | **هل يبقى «الورق»؟ وهل `auto` يتبع النظام؟** | يبقى، و`auto` يتبع النظام، والدخول فراغ دائمًا. البديل: الفراغ للجميع و«الورق» بنقرة | حذف كتلة `@media` الورقية | **مغلق بخلاف التوصية:** الورق باقٍ، والافتراضي للجميع الفراغ الداكن مهما كان الجهاز، و`auto` اختيار صريح |
| 5 | **وزن 400 لعناوين العرض** خلافًا لـ«30pt Bold» | نعم فوق 26px؛ الدليل محترم في ما دونه | رمز وزن واحد | **مغلق:** نعم، 400 للعرض و700 للتأكيد والتسميات |
| 6 | **أوزان Alexandria إضافية:** 600 (التسميات كما ينص الدليل) و300 (فقرات المسرح)؟ ومصدر ملفات `.part` الثمانية؟ | 600 نعم إن توفرت ملفات كاملة موثوقة؛ 300 اختياري؛ 200 لا | 2–4 مداخل في `server.mjs` | **مغلق:** يُبنى بـ400/700؛ رموز `--fw-*` تتحسن تلقائيًا إن فعّل المالك الملفات |
| 7 | **الانحناءان الوحيدان:** الحبّة 999px، والزاويتان العلويتان 24px لصفيحة الجوال — مقابل هندسة الدليل الحادة (01 §7.11) | نعم: الحبّة محجوزة للفعل وtoast، والصفيحة شيء يُسحب بالإبهام؛ **حوار المكتب بلا انحناء**، وكل ما عداها حاد. ندرتهما معناهما | `--r-pill` و`--r-float` | **مغلق:** كما في المواصفة |
| 8 | **دور الأصفر:** وقت وانتباه + eyebrow العتبات (الدخول، الفهرس، الفراغ) | نعم. البديل: eyebrow العتبات بالسماوي `#DDE6ED` | قاعدتان | **مغلق:** للأصفر دور واحد |
| 9 | **«تعزية» معكوسة بيضاء** على الفراغ (وسوداء بنص أبيض على الورق) | نعم مع سكون تام | الرمزان `--condolence-block` و`--occasion-condolence-ink` | **مغلق:** نعم، معكوسة |
| 10 | **شعار «الورق»:** أسود كامل الآن، أم النسخة الرسمية ثنائية اللون (تتطلب `fill` منفصلًا لمسارات `brand-logo.mjs`)؟ | أسود كامل في المرحلة الأولى | تعديل `brand-logo.mjs` | **مغلق:** أسود كامل الآن، عبر `--logo` |
| 11 | **الشاشات الـ64 بلا مدخل تنقل:** إدراجها بصلاحياتها في `nav` | قرار منتج منفصل؛ التصميم يتسع لها (فهرس 120 مدخلًا) | بيانات في `app.mjs` و`hr-design.mjs` | **مغلق خارج هذا العمل:** التنقل أُعيد بناؤه (113 مدخلًا، ثماني مجموعات) |
| 12 | **ترتيب `#inbox` الأقدم أولًا** (شرط الحبّة على أول صف)، و**العودة إلى الصندوق بعد القرار مع التركيز على التالي** | التحقق ثم التفعيل؛ الثاني سلوك لا شكل | محدِّد واحد / منطق في `app.mjs` | **مغلق:** لا يتغير الترتيب ولا العودة في هذا العمل |
| 13 | اللمسة السعودية في النص، وأرقام 0–9 في كل مكان، وصور الموظفين | كما في `02` §9 | نصوص | **مغلق:** لا صور موظفين، ولا تغيير على نصوص الخادم |
| 14 | **المرحلة الثانية** (تمس `*-ui.mjs`): صف منظَّم بدل « · »، صفحة سجل، صفحة تقرير، فعل أساسي لكل شاشة، قالب التعاميم، توحيد التواريخ؛ و**مسار الطباعة** | بعد اعتماد المرحلة الأولى | — | **مغلق:** خارج النطاق |
| 15 | **القفل ثنائي اللغة:** في الدليل السطران «بالحجم نفسه تقريبًا»؛ هنا اللاتيني 12px فوق عنوان 22–72px | كما هو: في واجهة عربية اللاتيني توقيع صغير لا عنوان ثانٍ. البديل: رفعه إلى `--fs-title` في الدخول والفهرس | قاعدتان | **مغلق:** 12px مقبول |
| 16 | **إسناد `data-inbox` في `app.mjs`** (سطر واحد داخل `.then` القائم) حتى لا تدّعي الحلقة «اكتمل» والعدّ لم يصل أو فشل | نعم؛ بدونه تُعطَّل حالة الإغلاق وجملة «لا شيء ينتظر قرارك الآن.» في البطل كليًا | سطر واحد؛ يُشغَّل `ui-race` بعده | **مغلق:** نعم، سطر واحد في معالج `/inbox/count` |

**كتلة الفحمي (صارت أساس تصميمَي `slate` و`field` الداكنين؛ النسخة الكاملة المصحَّحة في الملحق §ج.1، وفيها `--action-press:#15987E` لأن `#138D75` تعبئةً على الفحمي = 2.98) — النص الأصلي:** `--canvas:#353535` · `--ink-1:#FFFFFF` 12.27 · `--ink-2:#EBEBEB` 10.29 · `--ink-3:#CFCFCF` 7.87 · `--ink-4:#B4B4B4` 5.92 · `--ink-5:#A3A3A3` 4.86 · `--line:rgba(255,255,255,.22)` 1.98 · `--line-strong:rgba(255,255,255,.45)` 3.84 · `--action:#16A085` (تعبئة 3.74 غير نصية، ونصها `#000` 6.40) · `--turn:#3CCDB0` 6.16 · `--spark:#F1C40F` 7.38 · `--stop:#FF9C8F` 6.08 · `--ring-b:#DDE6ED` 9.71 · `--scrim:rgba(53,53,53,.94)`. لون الفاصلة العملاقة الزخرفي يصير `#404040`. `#3CCDB0` و`#FF9C8F` ليسا من ألوان الدليل؛ هما كلفة هذا الخيار.

---

## 13. معايير القبول

**آلية (تُكتب فحوصًا):**
- صفر `box-shadow` و`backdrop-filter` و`gradient` لوني في ملفات CSS الخمسة (عدا `linear-gradient` داخل `mask`).
- صفر `letter-spacing` غير صفري خارج `[data-num]` و`:lang(en)` والقفل اللاتيني المسمّى (`.login-card .eyebrow`، `.side-title::before`).
- كتلتا «الورق» متطابقتان بعد إزالة الفراغات والتعليقات؛ كل أزواج التباين في §2.3 ≥ حدودها (سكربت التباين)، ومنها علامة `--spark` وسهم `select` و«تعزية» في المظهرين.
- لا قاعدة خارج `@layer` عدا الكتلة المجمَّدة و`@font-face` و`@keyframes`؛ لا `!important` خارج `kill` ومخفيات الجولة.
- مع `forced-colors:active` (محاكاة): كل علامات الحالة مرئية.
- مع `html[data-motion=off]`: صفر حركة CSS وصفر عدّ تصاعدي، لا في المحرك وحده.
- قبل وصول `/inbox/count` وعند فشله (محاكاة بقطع الطلب): الحلقة بفجوتها، والعين «—»، ولا جملة «لا شيء ينتظر قرارك الآن.».
- سلاسل `d=` في قناع شعار العبور تطابق `brand-logo.mjs`.
- عدد الأزرار الممتلئة الظاهرة في أي شاشة ≤ 1.
- لا `scrollWidth > innerWidth` على أي مسار عند 375 و1024 و1280 و1440، في المظهرين، ولحساب كامل الصلاحيات.
- خارج المسرح: `canvas.width === 0` وصفر استدعاء `requestAnimationFrame`؛ ومع `reduced-motion` و`36t-motion-paused` و`document.hidden` كذلك.
- `.sig-aurora{display:none}` لا يُفقد أي شاشة معلومة أو فعلًا.
- لا `style=` ولا `<script` في أي ترميز محقون؛ لا `http(s)://` في الملفات عدا `xmlns` داخل `data:`.
- `npm test` و`npm run check` خضراوان **قبل وبعد**؛ خصوصًا `static-modules` و`motion-cards` و`ui-race` و`dialog-races` و`departments` و`company-scale` و`resourcing`.
- حجم CSS الكلي ≤ **101KB** ([ملحق] كان 95؛ كتل التصاميم ≈ 6KB)، وإضافة المحرك ≤ 10KB.
- **[ملحق]** `node work/design-verify/contrast-designs.mjs` ينتهي بـ`All pairs with a floor pass.`؛ أزواج التوائم الثلاثة (الورق، `field` الفاتح، `slate` الفاتح) متطابقة؛ والجولة تُعاد للتصاميم الثلاثة × الوضعين؛ وغياب `data-design` و`data-theme` معًا يعطي الفراغ الداكن على جهاز فاتح.

**بشرية (قبل التعميم):**
- **المسح:** 5 موظفين، جدول 40 صفًا، تحديد المتأخر والمرفوض خلال 5 ثوانٍ، في المظهرين.
- **النموذج:** 5 موظفين يملؤون نموذج 16–20 حقلًا دون أن يفوتهم إلزامي.
- **أضعف شاشة في المكتب:** `--line` مرئي في المظهرين، وإلا يُرفع برمز واحد.
- **العربية بحجم العرض:** «هنا يبدأ الأثر.» عند 112px/1440 و44px/375، و«مسيّر رواتب سبتمبر 2026» مع `is-long`: لا قصّ لتنوين أو ذيل، لا كسر داخل كلمة، ≤ 3 أسطر.
- **الوصول:** أي شاشة مدرجة بتفاعلين على الأكثر؛ ترتيب Tab في تفاصيل الطلب منطقي؛ كل هدف لمس ≥ 44px.
- **هندسة الدخول:** قطر صندوق `h1` الفعلي < قطر العين − 48px عند 1440×900 و1280×720 و375×812، **وبالإنجليزية `dir=ltr`** (الحلقة معكوسة إلى 66vw)، وعند 820×1180 (لوحي) و812×375 (عرضي قصير: بلا حلقة)؛ لا علامة خلف أي حقل أو نص < 40px؛ خطأ الدخول وتوسّع OTP لا يدفعان نصًّا إلى نطاق الجسيمات.
- **مشهد الفهرس:** الفاصلة العملاقة مرئية فعلًا عند ≥ 1024 (الشريط الجانبي شفاف و`.stage` مخفية)، و`.sig-tabs` خاملة.
- **سلّم اللصق:** في شاشة فيها مرشّح وبطاقة مفتوحة وجدول: لا تراكب بين المرشّح والملخص ورأس الجدول؛ وفي شاشة بلا مرشّح لا فراغ فوق الملخص.

---

## 14. ملاحظات المراجعة

طُبّقت بنود نقد الاكتمال الـ45 في مواضعها. البنود التالية عُدِّلت أو رُفضت جزئيًا، بسببها:

| البند | القرار | السبب |
|---|---|---|
| 3 `html.is-searching` | **رُفض الوصف، وطُبّق القصد** | قرأت `signature.mjs:82–85`: الصنف يُضبط عند فتح **لوحة الأوامر** لا عند ترشيح الفهرس، وأثره قفل التمرير فقط. وترشيح الفهرس تتولاه `app.mjs` أصلًا: تفتح المجموعات وتضع `hidden` على ما لا نتيجة فيه. فاكتفيت بقاعدة `[hidden]{display:none}` صريحة وبحالة CSS `:has(#nav-search:not(:placeholder-shown))` لإخفاء العدّ و«الأخيرة» (§5.3) |
| 4 حذف `--spring` | **المالك A لا C** | الرمز يعيش في `signature.css` (9 مواضع) وهي ملف A ويُعاد كتابته كاملًا. `.journey-enter` أُسند إلى C كما طُلب |
| 17 الفحمي | **طُبّق الخياران معًا** | صُحّح السطر وأُرفقت كتلة محسوبة، مع التصريح بأن ثمنها فيروزي وأحمر مخفَّفان |
| 26 السطر اللاتيني في الفهرس | **حُذفت أسماء المجموعات اللاتينية** | خريطة ثابتة في `signature.mjs` مصدر ثانٍ لأسماء المجموعات يتقادم مع `navGroups`؛ يكفي «INDEX» والأرقام |
| 30-أ سلّم اللصق | **عُدِّل** | بقيمة `--filter-h:44px` الثابتة يلتصق الملخص 44px تحت موضعه في كل شاشة بلا مرشّح، فيظهر المحتوى متمررًا فوقه. جعلته `0px` افتراضيًا و`44px` عبر `:root:has(#main :is(.sig-filter,.filters,.acc-filter))`. وحُصر السلّم في ≥ 760 لأن ملخص الجوال ثلاثة أسطر (43-أ) فلا ارتفاع ثابت له |
| 30-هـ `cozy` في الدفتر | **طُبّق بشرط** | لو كُتبت `data-density=cozy` افتراضيًا لألغت كثافة الدفتر للجميع. السمة تغيب حتى يختار المستخدم صراحةً (العقد 2) |
| 42-أ `--hero-h:440px` | **رُفض الرقم، وطُبّق العلاج** | سقف 380px شرط حكم الاستعمال غير القابل للتفاوض (§1.4 بند 1). الاتساع تحقق بالتحية سطرًا واحدًا بالاسم الأول (344px) وبحلقة R=148 مشتقة من `--hero-h`. على الجوال صُغّرت الحلقة إلى R=60 ليبقى جواب «وش ينتظرني» في الشاشة الأولى مع نقل التحية تحتها (43-ز) |
| 44-ب حلقة الورق | **طُبّق ووُسّع** | نُقل `--horizon` في الورق أيضًا إلى `#16A085` (3.28، زخرفي ≥ 3) لأن شَرطة الفهرس صارت تستعمله، والدليل يريدها بفيروزي الهوية |
| 44-د `--r-float` | **اعتُمد 0 على المكتب** | مع إبقاء زاويتي صفيحة الجوال وإدراجهما في قرار المالك 7 |
| 44-و حجم القفل | **أُدرج قرارًا للمالك (15)** | الأثر طفيف كما قال الناقد |
| 45 العبور مع إيقاف الحركة | **قُبل** | إطار ساكن واحد بقطع ليس حركة ولا وميضًا متكررًا، ويبقى داخل القوانين السبعة |

**حدود هذه المراجعة:** لم أشغّل شيئًا. الأرقام الجديدة في §2.3 وكتلة الفحمي حسبتُها بسكربت WCAG اليوم. مقاسات البطل (344px، 211px) والشريط العلوي (913px) تقديرات على الورق لا قياس للخط. قول الناقد إن إسناد `data-inbox` آمن في صندوق `vm` تحققتُ من سببه قراءةً (`tests/ui-race.test.mjs:16` يعرّف `documentElement:{dataset:{}}`)، ولم يُشغَّل الاختبار.
