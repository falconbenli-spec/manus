# تسليم الحزمة F — سلوك الغلاف و`index.html` و`theme-boot.js`

- التاريخ: 2026-09-18 (تشغيل مستأنف: المحاولة الأولى قُطعت بحد الاستخدام؛ فُحص ما تركته، أُبقي الصحيح، وأُصلح الناقص).
- الملفات الملموسة (ثلاثة، ولا رابع): `app/static/signature.mjs` · `app/static/index.html` · `app/static/theme-boot.js` (جديد). وهذا الملف.
- لم يُلمس: `work/`، المنفذ 3600، أي اختبار، أي `*-ui.mjs`، `server.mjs`. لا commit ولا نشر.

## قرارات المالك المفوَّضة (مسجَّلة، لا تُفتح)
القرارات 1–18 في `DESIGNS-ADDENDUM.md` §أ معتمدة كما هي. ما يخص F منها: الافتراضي `void` + `dark` مهما كان إعداد الجهاز و`auto` اختيار صريح (4)؛ التصاميم الثلاثة بسمة `data-design` (17)؛ `app.mjs` هي التي تكتب `data-inbox` (16)؛ ترتيب `#inbox` لا يتغير (12)؛ لا نصوص خادم (13).

## ما أُنجز
**`theme-boot.js`** — سكربت كلاسيكي حاجب، نص الملحق §ب.2 مع لفّ كتابة السمتين في `try/catch` ثانٍ. يتحقق من القيمتين ضد القائمتين، الافتراضي `void`/`dark`، ولا يرمي.

**`index.html`** — `viewport-fit=cover`؛ `<script src="/theme-boot.js">` أول سكربت وقبل روابط CSS؛ `color-scheme: dark`؛ وسم `theme-color` واحد `#000000` بلا `media`؛ `preload` لملفَّي Alexandria العربي 400/700 مع `crossorigin`؛ ترتيب CSS: `signature` ← `style` ← `journey` ← `athar` ← `hr-design`؛ `canvas.sig-aurora` أول ابن لـ`body`؛ `lang="ar"` و`dir="rtl"` باقيان.

**`signature.mjs`** — يستورد `mountBackdrop` من `./motion-cards.mjs` (لا بديل مؤقت في الملف).
- العقد 2: `data-tier`/`data-route`/`data-scene` من الخرائط المجمَّدة، عند الإقلاع وداخل معالج `hashchange` وداخل رد مراقب `#app`؛ `data-motion` و`data-density` (الأخيرة عند اختيار صريح فقط)؛ حذف `data-inbox` عند ظهور `.login`؛ `.is-threshold` 400ms؛ `.is-kbd` من `visualViewport`؛ `.is-searching` للوحة الأوامر فقط.
- الفهرس حوار في كل المقاسات (`role=dialog`، `aria-modal`، `Esc`، إعادة التركيز، `inert` على `.stage` و`.sig-tabs` و`.skip`)؛ كل المجموعات مفتوحة عند ≥ 1024 والطي معطَّل؛ السحب للإغلاق تحت 1024 للفهرس وتحت 760 للحوار.
- العقد 3: `sig-siblings` (طيّ بـ`ResizeObserver`؛ بلا `a.active` يُفرَّغ ويبقى ارتفاعه المحجوز)، `sig-theme`، `sig-recent` (لقطة الجلسة)، زرّا الحركة والكثافة، `data-sig-group`، `is-long`/`is-xlong`، `sig-more`، `sig-older` (شاشة `request` فقط)، `data-label`/`data-cols`/`aria-label` (وداخل `template.content`)، `.is-wide`، `svg.sig-arc` (≤ 3 مسارات، سمات عرض فقط)، `data-num`، وعناصر بطل الرئيسية/البوابة.
- العقد 4: `mountBackdrop` مرة؛ `setScene` بهندسة يمررها F (الدخول من `--ring-*` بمسبار CSSOM، والرئيسية من صندوق `a.sig-eye` مع `ResizeObserver`)؛ `--ring-live:0` ⇒ `off`؛ `setData`/`setExclusions`/`dim(.35)`/`dim(0)`/`pulse`/`pause`/`resume`؛ `pointerdown` سلبي لمرة واحدة بعد الخمول؛ `closed` عند إرسال `#login-form`؛ مراقبة `#login-error`.
- مراقب واحد على `<html>` (`data-theme`/`data-design`/`data-scene`/`data-inbox`/`dir`/`lang`): يعيد المشهد قسرًا ويكتب `theme-color` من `--canvas` المحسوبة. **لا فرع يذكر اسم تصميم.**
- `⌘K`/`Ctrl+K` فقط؛ اختصار «/» أزيل. `tabNames` موحَّدة مع `nav.push`. سطر «بحث شامل عن …» يظهر لمن يملك `search.use` فقط (يُقرأ من `/api/me`؛ الخادم يرفض `/api/search` بدونه).

## ما أصلحته في هذا التشغيل (فوق ما وجدته)
1. **حلقة لا نهائية في طيّ `sig-siblings`:** كان الطي يحذف العقد ويعيدها في كل `enhance()`، ومراقب `#app` يرى `childList` فيعيد الجدولة بلا نهاية متى فاض الصف. صار الطي بسمة `hidden` (CSS الحزمة B يحمل `.sig-siblings [hidden]{display:none}`)، و`reset` من `ResizeObserver` وحده.
2. `span.nav-count` التي تضيفها `app.mjs` لكل `a[href="#inbox"]` كانت تقع على روابط محقونة (الصف الشقيق، «الأخيرة») بحسب سباق الوصول؛ تُزال منها ومن العين دائمًا (`stripCounts`). العدّ يبقى في الفهرس وشريط التبويب.
3. كتابات سمات بالقيمة نفسها في كل `enhance()` (`aria-expanded`، `role`، `aria-modal`، `inert`، `tabindex`) صارت محروسة.
4. أزيل مستمع `scroll` على `.sidebar`؛ موضع التمرير يُلتقط عند النقر داخل الفهرس.
5. زر «إيقاف الحركة»: التسمية ثابتة والحالة في `aria-pressed` والقيمة المرئية (كان يبدّل التسمية و`aria-pressed` معًا).

## الفحوص التي شُغّلت ونتائجها الحرفية
- `node --check app/static/signature.mjs` و`node --check app/static/theme-boot.js` ← بلا خطأ.
- `node --test tests/static-modules.test.mjs tests/ui-race.test.mjs tests/dialog-races.test.mjs tests/motion-cards.test.mjs` ← `tests 6 · pass 6 · fail 0`.
- `npm run check` ← `Syntax checked: 360 JavaScript modules. Source hashes match. Traceability: 220 requirements / 22 domains.`
- `npm test` (مرة واحدة في الآخر) ← `tests 676 · pass 676 · fail 0`.
- `theme-boot.js` في صندوق `vm`: مخزن فارغ، قيم صالحة (`field`/`auto`)، قيمة دخيلة (`'ar'`)، `getItem` يرمي، لا `localStorage`، لا `document` ← `void`/`dark` في الكل عدا الصالحة، ولا رمي في أي حالة.
- `grep` في ملفاتي الثلاثة: صفر `style=` و`<style` و`eval(`؛ لا اسم تصميم في `signature.mjs`.
- **متصفح حقيقي** على خادم مؤقت (قاعدة مصطنعة في الذاكرة، المنفذ 3777، أُوقف بعد الفحص)، حسابا `hr` و`admin`:
  - الإقلاع: `data-design=void` `data-theme=dark` `data-tier=stage` `data-route=login`؛ بعد الدخول `is-threshold` ثم تُزال، و`data-inbox=0`.
  - `enhance()` عشر مرات متتالية: `innerHTML` مطابق، عنصر واحد من كل محقون، **صفر سجل تغيّر** (عقد وسمات)؛ وفي السكون صفر تغيّر خلال 1.5s.
  - الفهرس: `inert` على `.stage` و`.sig-tabs`، `role=dialog`، `aria-modal=true`، التركيز على `#nav-search` (مكتب) و`.side-done` (375)، `Esc` يغلق ويعيد التركيز، كل المجموعات مفتوحة على المكتب، آخر رابط يقبل التركيز.
  - «/» لا يفتح شيئًا؛ `Ctrl+K` يفتح اللوحة (`is-searching`)؛ كلمة بلا مطابقة تعطي سطر «بحث شامل عن «…»»؛ `Esc` يغلق.
  - `hashchange` إلى `payroll`: `ledger/payroll/off`. الخروج: `data-inbox` تُحذف و`scene=login`.
  - 1024×800: لا فيضان في الصف ولا الشريط ولا الصفحة؛ الطي مُختبر بتضييق الصف إلى 520px عبر CSSOM: أربعة روابط `hidden` والنشط باقٍ، صفر تغيّر `childList`، ويعود عند التوسيع.
  - 375×812: لا `sig-siblings`، التبويبات «ملخصي · الرئيسية · مهامي · قراراتي · الفهرس»، لا تمرير أفقي.
  - `36t-enhance-off=1`: الشاشة تعمل، والسمات والتبويبات باقية، ولا محقونات؛ تعود بإزالة العلم.
  - `theme-color` يتبع `--canvas`: `#000000` ← `#FFFFFF` (ورق) ← `#DDE6ED` (`slate` فاتح) ← `#353535` (`field` داكن)؛ وفي `field` على الرئيسية `--ring-live=0` و`canvas.width=0`.
  - جدول ومسار وبلاطات مزروعة للفحص: `data-cols=3`، `data-label` على الخلايا (لا على `colspan`)، `aria-label` على `[data-col]`، قوس بثلاثة مسارات بلا `style`، و`data-num` تقع على `1,250.50 SAR` ولا تقع على «يوم 25».
  - زرّا الحركة والكثافة: `data-motion=off` يُكتب ويُزال؛ الكثافة `cozy` ← `compact` ← غياب السمة والمفتاح.
  - لا تحذير `[signature]` في وحدة التحكم.

## ما لم يُفعل وما لم يُتحقق منه
- **`/theme-boot.js` غير مخدوم بعد:** مدخله في قائمة `server.mjs` البيضاء ملك G ولم يكن موجودًا وقت الفحص (خادمي المؤقت خدمه بنفسه). إلى أن يدمج G يعيد الطلب 404 بصمت، و`app.mjs` (B-3) تكتب السمتين عند الإقلاع فلا ينكسر شيء، لكن أول رسم قد يسبق السمتين. `static-modules` لا يلتقط ذلك (يطابق `.mjs|css` فقط).
- **`athar.css` كان فارغًا (234 بايت) وقت الفحص** (E لم يسلّم CSS بعد): صفحة الدخول وبطل الرئيسية ظهرا بلا تنسيق، و`.sig-aurora` بلا قواعد. المحرك يأخذ مقاسه من صندوق الـcanvas عبر `ResizeObserver`، فدورة الحلقة فُحصت بورقة أنماط مؤقتة عبر CSSOM في المتصفح (رسم فعلي 2880×1800 في الدخول). **لم تُفحص** مع CSS الحقيقي: مستطيلات الحظر، وحارس عنوان الدخول، و`dim` عند كلمة المرور، ولحظة العبور بصريًا.
- لم تُقَس ميزانية الإطار، ولم يُختبر `dir=ltr`/الإنجليزية، ولا `prefers-reduced-motion`، ولا لوحة مفاتيح جوال حقيقية (`is-kbd`)، ولا Safari.
- `sig-older` لم يُفحص في المتصفح (لا طلب بأكثر من خمسة أحداث في القاعدة المصطنعة)؛ منطقه مقروء فقط. ولا جدول حقيقي في البذرة، ففحص الجداول بترميز مزروع.
- **انحراف معلن عن حرف القبول:** `pointermove` واحد باقٍ على مقبض الصفيحة أثناء السحب فقط (منطق السحب القائم الذي طلبت الخطة إبقاءه)؛ لا مستمع `scroll` ولا `pointermove` على المستند.
- مشهد `index` لا يُفعَّل تحت 1024 (الفهرس هناك معتم يحجب الـcanvas)، فيبقى `data-scene` على قيمته وتُوقف الحلقة مؤقتًا.
- لم أحدّث `STATUS.md` ولا `docs/traceability.json` (خارج ملفاتي).
- ملاحظة تشغيلية: مجلد المسودات ولوحة المتصفح مشتركان بين الحزم المتوازية؛ استُبدل ملفي المؤقت `serve.mjs` بملف حزمة أخرى فشغّلتُ خادمها (3671) لثوانٍ ثم أوقفته، وانتقلت إلى مجلد `pkg-f/` بأسماء خاصة.
