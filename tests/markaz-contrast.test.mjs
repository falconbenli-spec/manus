import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// «مركز الأثر» (markaz.css): حارسٌ مخصّص للتباين ولقاعدة ألوان الهوية.
//
// لماذا ملفٌّ مستقل: tests/contrast-tokens.test.mjs يقيس التصاميم كلها بمحرّك تتالٍ واحد، لكن قائمة أوراقه لا تضم
// markaz.css، فكان هذا المظهر يُقاس بألوان «الكلاسيكي» (أساسه المشترك) لا بألوانه — وسقط في الفاتح دون أن يُرى
// (تدقيق 30 سبتمبر: الحبر الثالث 4.41، والحدّ القوي 2.22، والصبغة نصًّا 4.37). وذلك الملف مثبّتٌ ببصمته في سجل
// المتطلبات، فالحارس هنا بجانبه لا داخله. و«مركز الأثر» يعيد تعريف كل رمز يقيسه هذا الملف في كتله الثلاث (فاتح،
// داكن، تلقائي على جهاز داكن)، فيكفي أن تُقرأ الكتل نفسها وتُحلّ مراجعها إلى ثوابت الهوية في signature.css.
//
// والقاعدة الثانية من رأس markaz.css: «كل لون من هوية 3,6T». أساسه المشترك (classic.css) يحمل لوحة Apple
// (#007AFF و#34C759 و#FF3B30…) في رموز --blue و--green و--red وأخواتها، فإن لم يعرّفها هذا المظهر تسرّبت إليه.

const STATIC = new URL('../app/static/', import.meta.url);
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const markaz = strip(readFileSync(new URL('markaz.css', STATIC), 'utf8'));
const signature = strip(readFileSync(new URL('signature.css', STATIC), 'utf8'));

// جسم الكتلة التي تلي محدِّدًا بعينه (أول ظهور له)، بموازنة الأقواس.
function blockAfter(css, selector) {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `المحدِّد غائب: ${selector}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`كتلة بلا إغلاق: ${selector}`);
}
const declarations = body => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));

const BRAND = declarations(blockAfter(signature, ':root{'));
const LIGHT = declarations(blockAfter(markaz, ':root[data-design=markaz],\n:root[data-design=markaz]:has(> body > #app > .login){'));
const DARK = declarations(blockAfter(markaz, ':root[data-design=markaz][data-theme=dark],\n:root[data-design=markaz][data-theme=dark]:has(> body > #app > .login){'));
const AUTO_DARK = declarations(blockAfter(markaz, ':root[data-design=markaz][data-theme=auto],\n:root[data-design=markaz][data-theme=auto]:has(> body > #app > .login){'));

/* ---------- حلّ القيمة إلى لون ---------- */
function parse(text, tokens, seen = new Set()) {
  const s = text.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(s);
  if (ref) {
    const name = ref[1];
    assert.ok(!seen.has(name), `مرجع دائري: ${name}`);
    const value = tokens[name] ?? BRAND[name];
    assert.ok(value !== undefined, `رمز غير معرَّف: ${name}`);
    return parse(value, tokens, new Set([...seen, name]));
  }
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+)\)$/i.exec(s);
  if (m) {
    const a = parse(m[1], tokens, seen), b = parse(m[3], tokens, seen), w = Number(m[2]) / 100;
    return [0, 1, 2].map(i => a[i] * w + b[i] * (1 - w)).concat(a[3] * w + b[3] * (1 - w));
  }
  throw new Error(`قيمة لونية لا يفهمها الحارس: ${s}`);
}
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const MODES = [['فاتح', LIGHT, [255, 255, 255, 1]], ['داكن', DARK, [0, 0, 0, 1]], ['تلقائي·جهاز داكن', AUTO_DARK, [0, 0, 0, 1]]];
const SURFACES = ['--canvas', '--bg', '--surface', '--surface-2', '--surface-raised', '--material-thick'];
function ground(tokens, name, root) {
  const canvas = over(parse(tokens['--canvas'], tokens), root);
  return name === '--canvas' ? canvas : over(parse(tokens[name], tokens), canvas);
}
function measure(names, surfaces, floor) {
  const fails = [];
  let measured = 0;
  for (const [mode, tokens, root] of MODES) for (const fg of names) {
    assert.ok(tokens[fg] !== undefined, `${mode}: الرمز ${fg} غير معرَّف في «مركز الأثر» فيتسرّب إليه من الأساس المشترك`);
    for (const bg of surfaces) {
      const back = ground(tokens, bg, root), ratio = contrast(over(parse(tokens[fg], tokens), back), back);
      measured++;
      if (ratio + 1e-9 < floor) fails.push(`${mode}  ${fg} على ${bg} = ${ratio.toFixed(2)}`);
    }
  }
  return { measured, fails };
}

test('«مركز الأثر»: كل حبر نصٍّ يعبر 4.5:1 على كل سطح — في الفاتح والداكن والتلقائي', () => {
  const text = ['--label', '--label-2', '--label-3', '--ink-1', '--ink-2', '--ink-3', '--ink-4', '--ink-5',
    '--tint', '--turn', '--state-late', '--state-wait', '--state-done', '--red-ink', '--orange-ink', '--green-ink', '--blue-ink', '--gray-ink'];
  const { measured, fails } = measure(text, SURFACES, 4.5);
  assert.equal(measured, text.length * SURFACES.length * MODES.length);
  assert.deepEqual(fails, [], `${fails.length} زوجًا تحت 4.5:1:\n  · ${fails.join('\n  · ')}`);
});

test('«مركز الأثر»: مؤشّر البؤرة والحدّ القوي يعبران 3:1 (WCAG 1.4.11)', () => {
  const { fails } = measure(['--focus', '--line-strong'], ['--canvas', '--bg', '--surface', '--surface-2'], 3);
  assert.deepEqual(fails, [], `${fails.length} زوجًا تحت 3:1:\n  · ${fails.join('\n  · ')}`);
});

test('«مركز الأثر»: النص الأبيض على تعبئة الفعل وعلى الأحمر يعبر 4.5:1', () => {
  for (const [mode, tokens, root] of MODES) {
    const white = parse(tokens['--on-tint'], tokens);
    for (const fill of ['--tint-fill', '--red']) {
      const back = over(parse(tokens[fill], tokens), ground(tokens, '--canvas', root));
      const ratio = contrast(over(white, back), back);
      assert.ok(ratio >= 4.5, `${mode}: الأبيض على ${fill} = ${ratio.toFixed(2)}`);
    }
  }
});

test('«مركز الأثر»: ألوان الحالة والتصنيف من الهوية وحدها — لا لون من لوحة Apple يتسرّب من الأساس', () => {
  // المسموح: أحمر الدليل المعمَّق (#C0392B، من الملحق)، وأصفر الدليل (#F1C40F)، وحبرا الحالتين في هذا المظهر، وكل محايد.
  const hues = ['--red', '--orange', '--yellow', '--green', '--blue', '--indigo', '--purple', '--pink', '--teal', '--mint', '--cyan', '--brown', '--gray'];
  const inks = ['--red-ink', '--orange-ink', '--yellow-ink', '--green-ink', '--blue-ink', '--gray-ink', '--purple-ink'];
  for (const [mode, tokens] of MODES) {
    const allowed = ['#C0392B', '#F1C40F', tokens['--state-late'], tokens['--state-wait']].map(v => parse(v, tokens).slice(0, 3).map(Math.round).join(','));
    for (const name of [...hues, ...inks]) {
      assert.ok(tokens[name] !== undefined, `${mode}: ${name} غير معرَّف هنا، فيأخذ قيمة «الكلاسيكي» (لوحة Apple)`);
      const c = parse(tokens[name], tokens), key = c.slice(0, 3).map(Math.round).join(',');
      const neutral = Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3)) <= 6;
      assert.ok(neutral || allowed.includes(key), `${mode}: ${name} = ${tokens[name]} ليس من ألوان الهوية ولا محايدًا`);
    }
  }
});

test('«مركز الأثر»: كتلة الداكن وتوأمها «التلقائي على جهاز داكن» متطابقتان', () => {
  assert.deepEqual(AUTO_DARK, DARK, 'التوأمان افترقا: جهاز داكن على «يتبع الجهاز» يرى غير ما يراه «داكن»');
});

test('«مركز الأثر»: الأيقونات والصورة الرمزية على لوحٍ محايد — لا ألواح ملوّنة من الأساس', () => {
  const layer = markaz.slice(markaz.indexOf('@layer markaz'));
  const rule = /:is\(\.nav-icon,\.service-icon,\.rq-row-icon,\.rq-dept-icon,\.rq-rail-icon,\.rq-pill > span,\.avatar\)[^{]*\{background:var\(--fill-2\);color:var\(--label\)\}/;
  assert.match(layer, rule, 'قاعدة اللوح المحايد للأيقونات غائبة من طبقة markaz');
});
