import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/* الأساس المشترك (الدفعة الثالثة): ما تبني عليه شاشات الأسطول. مهارات better-* (colors، typography، layout، ui، accessibility)
 * مطبّقة على الطبقة المشتركة، وهذا الملف يحرس ما لا تحرسه البصمات: قيم الرموز وأسماؤها وقواعد الحركة والطباعة.
 * كل قيمة هنا من المهارة حرفيًا («0.96 ليست 0.95»)، وكل لون من الدليل (قاعدة المالك تتقدّم على المهارة).
 */

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SIGNATURE = read('../app/static/signature.css');
const CSS_FILES = readdirSync(new URL('../app/static/', import.meta.url)).filter(f => f.endsWith('.css') && f !== 'report-print.css');
const CSS = Object.fromEntries(CSS_FILES.map(f => [f, stripComments(read('../app/static/' + f))]));
const APP = read('../app/static/app.mjs');

/* ---------- OKLCH → sRGB, the same math the browser uses ---------- */
function oklchToHex(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  const gamut = lin.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  const enc = v => { const c = Math.max(0, Math.min(1, v)); return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255); };
  return { hex: '#' + lin.map(enc).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(), gamut };
}

// كل مُعرّف أساسي: --{hue}-{step}: القيمة، وتعليقه (الـHEX المثبّت إن وُجد).
const PRIMITIVE = /^\s*--(turquoise|slate|neutral|red|yellow|blue)-(\d+):([^;]+);\s*(?:\/\*([^*]*)\*\/)?/gm;
const primitives = [...SIGNATURE.matchAll(PRIMITIVE)].map(m => ({ hue: m[1], step: +m[2], value: m[3].trim(), note: m[4] ?? '' }));

test('الأساسيات: ألوان الدليل وحدها بـOKLCH، كل مثبّت يرجع إلى HEX الدليل نفسه، وكلها داخل sRGB', () => {
  assert.ok(primitives.length >= 40, `وُجد ${primitives.length} فقط`);
  const guide = new Set(['#FFFFFF', '#000000']);
  for (const doc of ['../docs/product/design/01-brand-brief.md', '../docs/product/design/DESIGNS-ADDENDUM.md'])
    for (const m of read(doc).matchAll(/#[0-9A-Fa-f]{6}\b/g)) guide.add(m[0].toUpperCase());
  const brand = { '--brand-turquoise': '#16A085', '--brand-turquoise-deep': '#12806B', '--brand-charcoal': '#353535', '--brand-sky': '#DDE6ED', '--occasion-urgent': '#E74C3C', '--occasion-reminder': '#F1C40F', '--occasion-baby-boy': '#5DADE2' };
  for (const p of primitives) {
    const name = `--${p.hue}-${p.step}`;
    const ref = /^var\((--[a-z-]+)\)$/.exec(p.value);
    if (ref) { assert.ok(brand[ref[1]], `${name} يشير إلى ثابتٍ من الهوية لا إلى ${ref[1]}`); continue; }
    const o = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(p.value);
    assert.ok(o, `${name}: OKLCH بصيغة oklch(L C H) — وُجد ${p.value}`);
    const { hex, gamut } = oklchToHex(+o[1], +o[2], +o[3]);
    assert.ok(gamut, `${name} خارج sRGB`);
    const pinned = /#([0-9A-F]{6})/i.exec(p.note)?.[0]?.toUpperCase();
    if (pinned) {
      assert.equal(hex, pinned, `${name} مثبّت على ${pinned} ويرجع ${hex}`);
      // الملوّن من الدليل حرفًا؛ والرمادي درجةٌ بين الأسود والأبيض بلا صبغة (R=G=B) — ظلال الفحمي التي تبني بها التصاميم عمقها.
      if (p.hue === 'neutral') assert.ok(pinned.slice(1, 3) === pinned.slice(3, 5) && pinned.slice(3, 5) === pinned.slice(5, 7), `${name} ${pinned} ليس رماديًا خالصًا`);
      else assert.ok(guide.has(pinned), `${pinned} ليس في الدليل`);
    }
    else assert.match(p.note, /gen/, `${name} بلا HEX مثبّت فيجب أن يُعلَّم مولَّدًا (gen)`);
  }
});

test('الأساسيات: الصبغة ثابتة على طول السلّم — الفيروزي ±8° من 174.8، والرمادي بلا صبغة', () => {
  for (const p of primitives) {
    const o = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(p.value); if (!o) continue;
    if (p.hue === 'neutral') assert.equal(+o[2], 0, `--neutral-${p.step} يحمل صبغة (C=${o[2]})`);
    if (p.hue === 'turquoise') assert.ok(Math.abs(+o[3] - 174.8) <= 8, `--turquoise-${p.step} على ${o[3]}°`);
  }
  // الخطوات تنزل في الإضاءة المدرَكة مع الرقم.
  for (const hue of ['turquoise', 'neutral', 'slate', 'red', 'yellow']) {
    const Ls = primitives.filter(p => p.hue === hue).map(p => [p.step, +(/^oklch\(([\d.]+)/.exec(p.value)?.[1] ?? NaN)]).filter(([, L]) => !Number.isNaN(L)).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < Ls.length; i++) assert.ok(Ls[i][1] < Ls[i - 1][1], `${hue}-${Ls[i][0]} (${Ls[i][1]}) ليس أغمق من ${hue}-${Ls[i - 1][0]} (${Ls[i - 1][1]})`);
  }
});

test('الأدوار: رمزٌ واحد لكل دور باسم --color-{role}-{variant}، وكل دورٍ تقرؤه ورقةٌ معرَّف', () => {
  const defined = new Set([...SIGNATURE.matchAll(/(--color-[a-z-]+):/g)].map(m => m[1]));
  for (const role of ['--color-bg-page', '--color-bg-surface', '--color-bg-raised', '--color-bg-sunken', '--color-bg-overlay',
    '--color-text-primary', '--color-text-body', '--color-text-secondary', '--color-text-tertiary', '--color-text-disabled', '--color-text-inverse', '--color-text-on-accent',
    '--color-border-separator', '--color-border-default', '--color-border-focus',
    '--color-accent-solid', '--color-accent-solid-hover', '--color-accent-solid-active', '--color-accent-text', '--color-accent-bg-subtle', '--color-accent-border',
    '--color-danger-text', '--color-danger-solid', '--color-warning-text', '--color-success-text', '--color-info-text'])
    assert.ok(defined.has(role), `${role} غير معرَّف`);
  const used = new Set(); for (const css of Object.values(CSS)) for (const m of css.matchAll(/var\((--color-[a-z-]+)/g)) used.add(m[1]);
  for (const m of APP.matchAll(/var\((--color-[a-z-]+)/g)) used.add(m[1]);
  const missing = [...used].filter(name => !defined.has(name));
  assert.deepEqual(missing, [], 'أدوار تُقرأ ولا تُعرَّف');
  // لا يُطبَّق مُعرّفٌ أساسي في مكوّن: الأساسيات تُقرأ من طبقة الرموز وحدها.
  const leaks = [];
  for (const [file, css] of Object.entries(CSS)) for (const m of css.matchAll(/var\(--(turquoise|slate|neutral|red|yellow|blue)-\d+\)/g)) {
    if (file === 'signature.css') continue;
    leaks.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(leaks, [], 'مكوّنات تقرأ الأساسيات مباشرة');
});

test('الحركة: الضغط 0.96 بالضبط على scale بـ150ms ease-out، ولا transition: all، ولا ارتداد في ردّ الضغط', () => {
  assert.match(SIGNATURE, /--press-scale:\.96;/);
  assert.match(SIGNATURE, /--d-press:150ms; --ease-press:ease-out;/);
  assert.match(SIGNATURE, /--d-swap:300ms; --ease-swap:cubic-bezier\(\.2,0,0,1\);/);
  const off = [];
  for (const [file, css] of Object.entries(CSS)) {
    for (const m of css.matchAll(/:active[^{]*\{[^}]*transform:\s*scale\(([\d.]+)\)/g)) off.push(`${file}: :active scale(${m[1]})`);
    for (const m of css.matchAll(/:active[^{]*\{[^}]*[;{]scale:\s*([\d.]+)/g)) if (m[1] !== '.96' && file !== 'depth.css') off.push(`${file}: :active scale:${m[1]}`);
    if (/transition(?:-property)?:\s*all\b/.test(css)) off.push(`${file}: transition: all`);
  }
  assert.deepEqual(off, [], 'ضغطٌ بغير --press-scale');
});

test('لا حركة في الرسم الأول، وتبديل المظهر لا يذوب', () => {
  assert.match(APP, /document\.documentElement\.dataset\.firstPaint='';let drawn=0;/);
  for (const fn of ['async function render(){', 'function loginView(){', 'function passwordView(forced){'])
    assert.ok(new RegExp(fn.replace(/[()[\]{}]/g, '\\$&') + '[\\s\\S]{0,260}leaveFirstPaint\\(\\)').test(APP), `${fn} لا يرفع حراسة الرسم الأول`);
  assert.match(SIGNATURE, /@layer kill\{[\s\S]*:root\[data-first-paint\] :is\([^)]*\.page > \*[\s\S]*animation:none!important/);
  // دخول المحتوى يُحجب (ومنه صعود صفوف «كوكبة» الزمني)، ودخول الصفحة المقصود يبقى: كشف عنوان عتبة الدخول. المرتفعة بالتمرير
  // (animation-timeline:view()) ليست حركة تحميل فلا تدخل الحراسة.
  const gate = /:root\[data-first-paint\] :is\(([\s\S]*?)\)\{animation:none!important\}/.exec(SIGNATURE)?.[1] ?? '';
  assert.ok(gate.includes('#main [style*="--ix-i"]'), 'صعود صفوف «كوكبة» غير محجوب في الرسم الأول');
  assert.ok(!gate.includes('.story-copy h1'), 'كشف عنوان عتبة الدخول دخولٌ مقصود للصفحة: لا يُحجب');
  assert.match(SIGNATURE, /:root\.is-theme-swap \*[^{]*\{transition:none!important\}/);
  assert.match(APP, /const paintAppearance=\(\)=>swapLook\(/);
});

test('الطباعة: لا تباعد أحرف ولا حروف كبيرة على العربية، ولا نص عربي تحت 12px', () => {
  const offenders = [];
  for (const [file, css] of Object.entries(CSS)) {
    for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const [, selector, body] = m;
      const ls = /letter-spacing:\s*(-?[\d.]+)(em|px)/.exec(body);
      if (ls && +ls[1] !== 0 && !/:lang\(en\)|\[dir=ltr\]|\[data-num\]|\.eu-mask|side-title::before/.test(selector)) offenders.push(`${file}: ${selector.trim().slice(-80)} letter-spacing:${ls[1]}${ls[2]}`);
      if (/text-transform:\s*uppercase/.test(body) && !/:lang\(en\)|\[dir=ltr\]/.test(selector)) offenders.push(`${file}: ${selector.trim().slice(-80)} uppercase`);
      const fs = /font-size:\s*([\d.]+)px/.exec(body);
      if (fs && +fs[1] < 12 && !/rq-rail-icon/.test(selector)) offenders.push(`${file}: ${selector.trim().slice(-80)} font-size:${fs[1]}px`);
    }
    for (const m of css.matchAll(/--fs-[a-z0-9-]+:\s*([\d.]+)px/g)) if (+m[1] < 12) offenders.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('اللمس: التحويم لا يعلق بعد النقر في بطاقات «الكلاسيكي»، وأداة مساحة النقر للأسطول موجودة', () => {
  const classic = CSS['classic.css'];
  for (const rule of ['.hm-strip > :is(.hm-strip-new,.hm-strip-card):hover{transform:translateY(-2px)', '.hm-strip > .hm-strip-new:hover::after{animation:k-sheen'])
    assert.ok(classic.includes('@media (hover:hover){& ' + rule), `${rule} خارج (hover:hover)`);
  assert.match(SIGNATURE, /\.hit-area::after\{content:"";position:absolute;top:50%;left:50%;inline-size:max\(100%,var\(--hit-min\)\);block-size:max\(100%,var\(--hit-min\)\)/);
  assert.match(SIGNATURE, /@media \(pointer:fine\) and \(hover:hover\)\{:root\{--hit-min:40px;\}\}/);
});
