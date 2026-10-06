# تسليم depth-C — «عُمق 360» (`data-design=depth`): طبقة CSS

- التاريخ: 2026-09-19. لا commit ولا push.
- الملفات الملموسة: `app/static/depth.css` (جديد، 457 سطرًا) · السطر الأول وحده من `app/static/signature.css` · `app/static/index.html` (رابطان فقط) · `work/design-verify/contrast-designs.mjs` (أزواج depth) · وهذا الملف.
- لم يُلمس: `app.mjs` `signature.mjs` `hr-design.css` `server.mjs` `depth-scene.mjs` `motion-cards.mjs` `preferences*` `classic.css`، ولا المنفذ 3600، ولا قاعدة البيانات الحية.

## التعديلات خارج depth.css (حرفيًا)
- `signature.css` السطر 1: `@layer tokens,base,state,components,surfaces,stage,shell,depth,classic,fill,kill;` (أُضيف `classic` بطلب المنسّق).
- `index.html`: بعد `hr-design.css` مباشرة `<link rel="stylesheet" href="/depth.css">` ثم `<link rel="stylesheet" href="/classic.css">`. الخادم يخدم الملفين (`server.mjs` السطران 124–125، من وكيل آخر)؛ `classic.css` موجود الآن من وكيل آخر.

## بنية depth.css
1. `@property`: `--orbit` (`<angle>`، يُورَّث) و`--tilt-x` `--tilt-y` (`<angle>`، لا يُورَّثان) و`--z` (`<length>`). الأربعة قابلة للانتقال السلس.
2. `@keyframes` خارج الطبقات: `depth-enter` `depth-rise` `depth-dialog` `depth-vt-out` `depth-vt-in` `depth-vt-fade`. كلها تنتهي عند الحالة الطبيعية للعنصر.
3. `@layer tokens { @media screen { … } }`: كتلة الليل، وتوأما النهار المتطابقان (`auto` داخل `prefers-color-scheme:light`، و`light`)، ثم التباين العالي، ثم تقليل الشفافية، ثم `@supports not (backdrop-filter)` (سطوح مصمتة).
   - **النوعية:** كل كتلة مكتوبة `html:root[data-design=depth]…:not(#_)`. الليل (1,2,1) يساوي كتلة «الدخول دائمًا فراغ» `:root:has(> body > #app > .login)` ويغلبها بترتيب المصدر. النهار (1,3,1). فيتبع الدخول رموز depth في الوضعين بلا `:has()` داخل قائمة محددات (متصفح بلا `:has` كان سيُسقط الكتلة كلها). كتلتا تقليل الشفافية وغياب الـblur لهما توأم `[data-theme]` بنوعية (1,3,1) فتغلبان النهار أيضًا.
   - رموز جديدة: `--scene-3d:1` · `--glass` (الليل .74، النهار .78) · `--glass-strong` (.90 / .92) · `--glass-solid` · `--glass-raise` · `--glass-edge` `--edge-hi` `--edge-lo` · `--specular` `--specular-live` · `--glass-blur` (28px، و16px مع `pointer:coarse`) · `--well` `--well-shadow` · `--veil` `--veil-edge` · `--fog-a` `--fog-b` (`color-mix` من رموز العلامة) · `--ground-top` `--ground-bottom` · `--btn-glass` `--btn-hi` `--btn-lo` · `--lift-1/2/3` · `--text-depth` · `--depth-persp:1400px` · `--r-card` `--r-slab` `--r-field` · `--bar-m`. ويُعاد تعريف `--sticky-top` (الشريط العلوي نزل s2).
   - كل رمز ملوَّن تعرّفه كتل field/slate معرَّف هنا. الفيروزي لا يُكتب: `var(--brand-turquoise)` و`var(--brand-turquoise-deep)` فقط.
   - الليل: الأرض `#041311`، والتدرج `#03100E→#061A18` مع ضباب فيروزي. الأحبار أبيض مائل إلى الفيروزي (`#F4FBFA`…`#AAC3BE`). `--turn:#3CCDB0` لأن الفيروزي الأصلي 3.17 على أسوأ لوح. `--action-press:#19AD90` لأن `#15987E` = 2.88 تعبئةً على أسوأ لوح.
   - النهار: سماء باهتة `#E7EDF2` (= سماء العلامة 70 % + أبيض)، وزجاج لؤلؤي، وأحبار فحمية مائلة إلى الفيروزي. الفعل `--brand-turquoise-deep` مع تسمية بيضاء (4.85). رموز الحلقة ظلال فيروزي داكنة: `#12806B` `#0E6B59` `#0B5A4B` `#5E4700`.
4. `@layer depth { @media screen { … } }`، وخارجه سطر الطباعة الوحيد `@media print{.sig-depth{display:none}}`. كل محدد يبدأ بـ`:root[data-design=depth]`، إلا حارسًا واحدًا: `:root:not([data-design=depth]) .sig-depth{display:none}`.

## نموذج التباين (المشهد حيّ فلا تُعرف الأرضية مسبقًا)
- `#app::before` حجاب ثابت داخل سياق تكديس `#app` (z 1). فهو بين المشهد وكل سطح دائمًا، أيًّا كان ما يرسمه WebGL. أرضيته `--veil` (.30) في كل مكان، والتظليل عند الحواف يرتفع إلى .80.
- **أسوأ حالة:** البكسل الأسطع الممكن (`#FFFFFF`) ليلًا، والأعتم (`#000000`) نهارًا، تحت الحجاب ثم الزجاج. التمويه يُهمَل عمدًا في النموذج.
  - اللوح الأشفّ `--glass`: ليلًا = `#334341`، نهارًا = `#D2D4D5`.
  - `--glass-strong`: يُحسب فوق الأبيض أو الأسود مباشرة بلا حجاب، لأن الشريط والحوار واللوحة والتوست تطفو فوق المحتوى نفسه.
  - الصفيحة: لوح + `--glass-raise` + اللمعة في أقصاها.
  - الزر: لوح + `--btn-glass` + اللمعة عند بداية سطر الحروف.
- الشرط العملي: **كل كلمة على زجاج.**
  - شاشات العمل: لوح واحد `#main.page::before` يحمل الشاشة كلها.
  - مشهد الرئيسية والبوابة: لوحة البطل عنصر شبكي `::before` داخل `.page-head` / `.journey-hero` تغطي عمود النص فقط من 1024 (عمود العين يبقى مكشوفًا للحلقة)، ولكل كتلة بعد البطل لوح خاص.
  - العين `.sig-eye::before`: عدسة زجاجية فوق ثقب الحلقة.
  - الدخول: البطاقة، وعدسة دائرية تحت العنوان `.story-copy::before`، وحبوب زجاجية لـ`.hr-values` و`.login-footer` و`.story-copy p`.
  - الفهرس: لوح بيان وبطاقات مجموعات.
- الصفائح فوق اللوح بلا `backdrop-filter` (اللوح تحتها مموَّه أصلًا). `--glass-raise` ليلًا أغمق من اللوح، فلا تُنقص التباين أبدًا.

## ما بُني (مختصر)
- **المشهد:** `.sig-depth` ثابتة، `inset:0`، `z-index:var(--z-canvas)`، بلا pointer-events. `.sig-aurora` تُخفى **فقط** حين توجد `canvas.sig-depth` (`:has`)، فتبقى الحلقة ثنائية الأبعاد إن لم تُركَّب ثلاثية الأبعاد.
- **الكاميرا:** `perspective` على `.stage`. دخول `#main.journey-enter` يتحرك بـ`translate` في Z فقط، لأن منحنى الشفافية على `#main` يُفقد اللوح تمويهه. لا دخول في الدفتر والمسارات الحساسة.
- **الصفائح:** `.panel .vn-block .vn-card .rq-dept .rq-card .department-card .service .org-unit` الخارجية فقط (حارس `:not(… *)`)، و`.vn-tile .pt-tile`. حافة مضيئة بحلقة `::after` مقصوصة بقناع (`mask-composite:exclude` / `-webkit-mask-composite:xor`) داخل `@supports`، وبديلها حد 1px `--glass-edge`. لمعة `radial-gradient` عند `var(--mx) var(--my)` خلفيةً (تحت النص دائمًا). ظلال بالارتفاع. `isolation:isolate` كي تبقى الفاصلة الشبحية ‎`z:-1`‎ داخل صفيحتها.
- **الإمالة:** `.vn-tile .pt-tile .rq-card .rq-dept .department-card .journey-stop` تُكتب `perspective(900px) rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg)) translateZ(var(--z,0px))` مع `preserve-3d`. عند المرور أو `.is-live`: `--z:18px` ورقم البلاطة `translateZ(24px)`. تعمل بلا المتغيرات (سكون مسطح). دخول `rq-enter` صار يصعد من العمق.
- **الأزرار:** حبوب زجاجية مرفوعة (خط ضوء علوي، وظل سفلي، وظل إسقاط)، و`:active` = `translate:0 1px` بظل أصغر. أفعال الصفوف والأفعال الثانوية في الأشرطة تبقى نصًّا (قائمة `:not(:where(…))` تطابق قواعد surfaces/components). طبقة fill فوق depth فيبقى الفعل الوحيد المعبأ معبأً ويكسب لمعة فقط.
- **الحقول:** آبار غائرة (`--well` + ظل داخلي + `--r-field`). والصفوف اللاصقة (`th` `.filters` `.sig-filter` ملخص البطاقة المفتوحة، شريط القرار) تأخذ `--glass-solid` بدل `--canvas`.
- **الكثافة:** `[data-tier=ledger]` = لوح `--glass-strong` والصفائح شفافة بحد `--line` حاد، بلا إمالة ولا Z ولا لمعة ولا حافة مضيئة. وكذلك أي صفيحة تحوي `table` أو `form`.
- **الأشرطة:** الشريط العلوي حبة زجاجية منفصلة عن الحواف بـ`--bar-m`، وحشوته تعوّض الإزاحة فتبقى `.sig-tabs` الثابتة من 1024 في مكانها. تحت 1024 شريط التبويب «مرسى» عائم. شريط الإخوة من 1024 حبة زجاجية تحت الشريط.
- **الفهرس:**
  - تحت 1024: صفيحة زجاجية تحمل «سطح أوراق» ثلاثي الأبعاد (المجموعة المغلقة مائلة `rotateX(5deg) translateZ(-8px)`، والمفتوحة أو المركَّز عليها مسطحة).
  - من 1024: لوح بيان خلف العمود 1 (عنصر شبكي `::before`، `rotateY(-3deg)` نحو العمل في RTL و`+3deg` في LTR، والكلمات لا تدور)، وزر «إغلاق» حبة زجاجية، والمجموعات بطاقات زجاجية في عمود (البديل).
  - **المدار** يعمل فقط حين تحمل المجموعات `--i` (يُقرأ من سمة style المنعكسة `[style*="--i"]`) ولا يُطلب تقليل الحركة: كل بطاقة `translateZ(-r) rotateY(i·360/n + --orbit) translateZ(r)`، و`r = w/2 / tan(180°/n)`، و`backface-visibility:hidden`، والشفافية من `cos` (0° = 1، 20° = .74، ≥ 40° = 0)، و`z-index` من `round(cos·100)`.
- **الطافيات:** الحوار (`--glass-strong` + تمويه + حافة، وزوايا `--r-slab` من 760، ودخول `depth-dialog` من العمق)، و`dialog::backdrop` بتمويه 6px، واللوحة `.sig-cmd` ثم `.sig-cmd-box`، والتوست، و`#design-menu`.
- **حديث:** دخول بـ`animation-timeline:view()` داخل `@supports` و`no-preference` فقط؛ الحالة الساكنة هي الطبيعية، ولا شيء يبدأ مخفيًّا خارج الخط الزمني. انتقالات العرض `::view-transition-old/new(root)` بدفعة كاميرا (القديم يرتد `translateZ(-120px) rotateY(4deg)` ويبهت، والجديد يأتي من `translateZ(80px)`، ويُعكس الدوران في LTR، ويصير خفوتًا قصيرًا في الدفتر). استعلام حاوية على `.vn-tiles`: بلاطتان في الصف تحت 520px. `color-mix` للمشتقات الزخرفية فقط.
- **الحركة المخفَّضة و`data-motion=off`:** لا إمالة ولا ميل للأوراق ولا مدار ولا دخول ولا كاميرا. **الألوان القسرية:** تسقط كل المؤثرات (الحجاب، اللوح، الحواف، العدسات، الـblur، الظلال، التحويلات) ويُخفى المشهد.

## مطلوب من الآخرين (عقد)
- **signature.mjs:** يقرأ `--scene-3d` لاختيار المحرك، ويركّب `canvas.sig-depth` ابنًا لـ`body` خارج `#app`، وإلا فقد الحجاب ضمانه.
- **المشهد:** يرسم بألوان `--ring-a..d` وحدها. أي بكسل أسطع من الأبيض ليلًا أو أعتم من الأسود نهارًا غير ممكن أصلًا، فالنموذج صامد أيًّا كان ما يُرسم.
- **المدمج:**
  1. يوسّع محدد `mountCards` ليشمل `.vn-tile` `.pt-tile` `.department-card` `.journey-stop` (الـCSS جاهز لها).
  2. للمدار: يضع `--i` على كل `.nav > .hr-nav-group` عبر CSSOM، و`--n` (الافتراضي 8) و`--orbit` على `.nav`، ويُسكِن `--orbit` عند `-(i·360deg/n)` تمامًا، ويدير المدار عند `focusin` إلى المجموعة المركَّز عليها. البطاقة الساكنة بشفافية 1 شرطٌ للتباين.
  3. `document.startViewTransition` اختياري. الأنماط جاهزة.

## التحقق البصري (حدود صريحة)
- الدخول الحقيقي شوهد على نسخة رمي (`LOCAL_DB_PATH=work/design-verify/depth-verify.sqlite PORT=3621`) بمقاسي 1440 و375، في الليل والنهار. لم أسجّل الدخول (لا أُدخل كلمات مرور)، و`canvas.sig-depth` لم تكن مركَّبة بعد، فرُسمت الحلقة ثنائية الأبعاد.
- شاشات الغلاف (الرئيسية، الموردون، مسير الرواتب بمستوى الدفتر، الفهرس بالعمود وبالمدار، ورقة الفهرس على الجوال، الحوار) فُحصت على صفحة تجريبية في `scratchpad` تحمّل ملفات CSS الحقيقية بترميز منسوخ من قوالب `app.mjs` و`home-ui.mjs`، فوق لوحة ثنائية الأبعاد ترسم فواصل بيضاء وفيروزية (أسوأ حالة)، على المقاسات 1440 و820 و375 في الوضعين.
- ما أُصلح بعد النظر:
  - لوحة البطل انهارت إلى 2px (`align-items:end` في shell) ← `align-self:stretch`.
  - `translateZ(%)` في المدار أسقط التحويل كله ← `min(520px,36vw)`.
  - قصّ المدار بـ`clip-path` جعل `.nav` جذر خلفية فضاعت ضبابية البطاقات ← أزيل القص واستُبدل بالخفوت الزاوي.
  - الشعار فوق حافة لوح البيان ← حشوة أعلى.
  - تماس لوحة البطل ولوح الكتل ← هوامش.
  - Chrome حلّل كل القواعد: 136 قاعدة نمط في CSSOM من 136 في المصدر.
- الخادمان أُوقفا، ونسخة القاعدة حُذفت. المجلد `work/design-verify/depth/` ليس مني ولم يُلمس.

## الفحوص (مخرجات حرفية)
```
$ node work/design-verify/contrast-designs.mjs   (exit 0)
All pairs with a floor pass.
$ node work/design-verify/duplicate-selectors.mjs
selectors parsed: 1561 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5
# the same script with depth.css added to its file list (a scratchpad copy; the script itself lists five files and was not edited):
selectors parsed: 1719 · defined in more than one file: 35 (of which set the same property twice: 18) · under a named exception: 5
$ npm run check
Syntax checked: 365 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.
Checks cover syntax, source integrity and traceability. No TypeScript compiler or production bundle is configured for this JavaScript build.
$ npm test
ℹ tests 700
ℹ pass 700
ℹ fail 0
```
أول تشغيل للتباين أسقط 3 أزواج: الضغط `#15987E` تعبئةً على اللوح 2.88، و`--stop` على الحبة 2.84، وحافة الحبة على داخلها 2.39. عولجت كلها: الضغط صار `#19AD90`، والحبة أغمق من اللوح ولمعتها تنتهي فوق سطر الحروف، وحافة الحبة تُقاس على اللوح حولها. ثم مرّت.

## مخاطر معروفة
- `duplicate-selectors.mjs` لا يقرأ `depth.css` (قائمته خمسة ملفات). يستحق إضافته.
- المدار يعتمد `tan()` و`cos()` و`round()` و`clamp()` في CSS. إن سقطت الشفافية في متصفح قديم تبقى 1 وتتراكب البطاقات، ولذلك يبقى المدار مشروطًا بـ`--i`.
- `@property --tilt-x/--tilt-y` تسجيل عام (لا يُحصر بتصميم). لا شيء آخر يقرؤهما.
