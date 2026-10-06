import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* «الكلاسيكي» و«مدار 360»: كل لون من دليل 3,6T لا من لوحة المرجع — العيب الذي أوجب هذا الملف (تدقيق 30 سبتمبر):
 *
 * الأساس المشترك لعائلة «الكلاسيكي» حمل لوحة Apple كما هي: ثلاثة عشر لونًا للحالات والأيقونات (#007AFF و#34C759
 * و#FF3B30 وأخواتها)، ورماديات iOS المزرقّة (60,60,67 و118,118,128 و#F2F2F7 و#1C1C1E)، وتدرّج الصورة الرمزية.
 * «الرواق» و«اليوم» و«مركز الأثر» يعيدون تعريفها في طبقاتهم، أما «الكلاسيكي» و«مدار 360» فكانا يرسمانها كما هي.
 * قاعدة المالك: المرجع يعطي التركيب، واللون من الدليل وحده (الفيروزي ودرجاته، والسماوي، والورقي، والفحمي، وألوان
 * المناسبات لمعانيها). يقرأ هذا الملف القيم الحرفية في الورقتين ويطابقها على قائمة الدليل نفسها في المستودع.
 */

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SHEETS = { classic: stripComments(read('../app/static/classic.css')), studio: stripComments(read('../app/static/studio.css')) };

// الدليل: كل HEX في موجز الهوية وفي ملحق التصاميم، ومعهما الأبيض والأسود.
const GUIDE = new Set(['#FFFFFF', '#000000']);
for (const doc of ['../docs/product/design/01-brand-brief.md', '../docs/product/design/DESIGNS-ADDENDUM.md'])
  for (const m of read(doc).matchAll(/#[0-9A-Fa-f]{6}\b/g)) GUIDE.add(m[0].toUpperCase());
// مشتقّات مكتوبة بطريقة اشتقاقها — لا تُضاف قيمة هنا بلا سطر يقول من أين جاءت.
const DERIVED = {
  '#F2F6F9': 'سماوي الدليل #DDE6ED ممزوجًا بالأبيض — أرض «الكلاسيكي» (والقيمة نفسها في «الرواق»)',
  // «مدار 360»: محايدات مشوبة بالفيروزي — «درجات ألوان الدليل وأصباغها» التي تسمح بها قاعدة المالك؛ هوية التصميم نفسه.
  '#EDF3F2': 'مدار 360 — أرض فاتحة مشوبة بالفيروزي', '#E5EEEB': 'مدار 360 — سطح ثانٍ', '#102B27': 'مدار 360 — حبر فيروزي داكن',
  '#526762': 'مدار 360 — حبر ثانوي', '#D3DFDC': 'مدار 360 — فاصل', '#0C1716': 'مدار 360 — أرض داكنة', '#152522': 'مدار 360 — سطح داكن',
  '#1D302C': 'مدار 360 — سطح داكن ثانٍ', '#EEF7F4': 'مدار 360 — حبر فاتح', '#B3C8C1': 'مدار 360 — حبر ثانوي داكن',
  '#9DB6AD': 'مدار 360 — حبر ثالث داكن', '#30483F': 'مدار 360 — فاصل داكن',
};
const hex6 = h => { const x = h.slice(1); return '#' + (x.length === 3 ? [...x].map(c => c + c).join('') : x).toUpperCase(); };
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();

function literals(css) {
  const out = [];
  for (const m of css.matchAll(/#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b(?![-\w])/g)) out.push({ at: m.index, value: m[0], hex: hex6(m[0]) });
  for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) out.push({ at: m.index, value: m[0], hex: rgbHex(m[1], m[2], m[3]) });
  // داخل روابط data: (سهم القائمة) يُكتب اللون %23XXXXXX
  for (const m of css.matchAll(/%23([0-9A-Fa-f]{6})/g)) out.push({ at: m.index, value: m[0], hex: '#' + m[1].toUpperCase() });
  return out;
}

test('«الكلاسيكي» و«مدار 360»: كل قيمة لونية حرفية من الدليل أو مشتقّة منه باسمها', () => {
  const stray = [];
  for (const [name, css] of Object.entries(SHEETS))
    for (const l of literals(css)) if (!GUIDE.has(l.hex) && !DERIVED[l.hex]) stray.push(`${name}.css: ${l.value} → ${l.hex}`);
  assert.deepEqual(stray, [], `ألوان من خارج الدليل:\n  ${stray.join('\n  ')}`);
});

test('«الكلاسيكي»: لا لون من لوحة Apple ولا من رماديات iOS — ولا من «الأخضر» القديم الذي لم يكن في الدليل', () => {
  const APPLE = ['#007AFF', '#34C759', '#FF3B30', '#FF9500', '#5856D6', '#AF52DE', '#FF2D55', '#30B0C7', '#00C7BE', '#32ADE6', '#A2845E', '#8E8E93', '#FFCC00',
    '#0A84FF', '#30D158', '#FF453A', '#FF9F0A', '#5E5CE6', '#BF5AF2', '#FF375F', '#40C8E0', '#63E6E2', '#64D2FF', '#AC8E68', '#FFD60A',
    '#F2F2F7', '#1C1C1E', '#2C2C2E', '#C6C6C8', '#38383A', '#3C3C43', '#767680', '#EBEBF5', '#545458', '#A5ABB6', '#858994', '#F5B800', '#00B3A9',
    '#0A7560', '#087762', '#3FCFA9', '#11806A', '#08251E'];
  const found = [];
  for (const [name, css] of Object.entries(SHEETS)) for (const l of literals(css)) if (APPLE.includes(l.hex)) found.push(`${name}.css: ${l.value}`);
  assert.deepEqual(found, []);
});

test('«الكلاسيكي»: الصورة الرمزية محايدة، والمربّعات الزخرفية لا تأخذ ألوان المناسبات، والحالات تبقى بمعانيها', () => {
  const css = SHEETS.classic;
  assert.match(css, /& \.avatar\{[^}]*background:var\(--fill-2\);color:var\(--label\)/, 'الصورة الرمزية لوحٌ محايد بحبر النص');
  assert.doesNotMatch(css, /\.avatar\{[^}]*gradient/);
  // الأيقونات الزخرفية: الأزرق والبرتقالي والأصفر خانات حالة، فلا تُرسم بها مربّعات الفهرس.
  for (const tint of ['blue', 'orange', 'yellow']) assert.doesNotMatch(css, new RegExp(`\\.tint-${tint}\\{--icon:var\\(--(blue|orange|yellow)\\)\\}`), `.tint-${tint}`);
  assert.doesNotMatch(css, /\.tone-\d\{--tone:var\(--(blue|orange|yellow|red)\)\}/, 'أقراص الإدارات لا تأخذ ألوان الحالة');
  // الحالات: «جارٍ» أزرق الدليل، و«بانتظار» أصفره، و«عاجل» أحمره المعمّق.
  const light = css.slice(css.indexOf('color-scheme:light'), css.indexOf('color-scheme:dark'));
  assert.match(light, /--blue:#5DADE2;/); assert.match(light, /--orange:#F1C40F;/); assert.match(light, /--red:#C0392B;/);
});

test('رمز القائمة بلون قرصه في كل تصميم — لا أبيض ثابتًا يختفي على أقراص الإخوة الفاتحة', () => {
  // كان .nav-icon .glyph{color:#fff} في الأساس المشترك: «الرواق» و«اليوم» و«مركز الأثر» و«مدار 360» يرسمون أقراصًا فاتحة
  // فكان كل رمز في الفهرس أبيض على قرص فاتح — 1.19–1.24:1 (قيس 1 أكتوبر في المتصفح على الأربعة).
  assert.match(SHEETS.classic, /& \.nav-icon \.glyph\{[^}]*color:inherit/);
  assert.match(stripComments(read('../app/static/riwaq.css')), /& \.nav-icon\{[^}]*color:var\(--icon,var\(--label-2\)\)/, '«الرواق» يلوّن قرصه ورمزه بالخانة نفسها');
});
