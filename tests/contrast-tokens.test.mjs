import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESIGNS } from '../app/preferences.mjs';
import { PALETTES } from '../app/static/appearance-ui.mjs';

// تباين الرموز (WCAG 2.2 — 1.4.3 نص عادي 4.5:1، و1.4.11 مكوّنات الواجهة ومؤشّر البؤرة 3:1).
//
// لماذا يُقاس من CSS لا من لقطات: ألوان المنصة كلها رموز مخصّصة في :root، وكل تصميم يعيد وضع ما يخصه.
// فالعيب لا يظهر في شاشة واحدة بل في زوج (رمز نص / رمز خلفية) داخل تصميم ووضع، ويتكرر في كل شاشة تستعمله.
// لذلك يبني هذا الملف محرّك تتالٍ صغيرًا يقرأ ملفات التصاميم نفسها، ويحسب قيمة كل رمز في كل سياق
// (تصميم × وضع)، ثم يقيس كل زوج. بلا هذا الاختبار تعود القيم الساقطة مع أول تصميم مستورد جديد.
//
// نطاق القياس المقصود: شاشة عمل عادية — لا شاشة دخول (:has(.login))، ولا حالة prefers-contrast:more
// (تحسين فوق الأساس، والأساس هو ما يجب أن يعبر)، ولا سمات المشهد (data-scene/data-tier/data-route).

// CONTRAST_CSS_DIR يوجّه المحرّك إلى نسخة أخرى من ملفات التصاميم (مقارنة «قبل/بعد» على نسخة سابقة).
const CSS_DIR = process.env.CONTRAST_CSS_DIR
  ? process.env.CONTRAST_CSS_DIR.replace(/\/?$/, '/')
  : fileURLToPath(new URL('../app/static/', import.meta.url));
// ترتيب الوسوم في app/static/index.html: ترتيب المصدر جزء من التتالي، فلا يُبدَّل هنا.
// markaz.css أُلحق (تدقيق 1 أكتوبر): كان «مركز الأثر» في DESIGNS ويُقاس بلا ورقته — أي بألوان «الكلاسيكي» — فلا يرى المحرّك لوحه أبدًا.
const SHEETS = ['signature.css', 'style.css', 'journey.css', 'athar.css', 'hr-design.css',
  'depth.css', 'classic.css', 'classic-plus.css', 'riwaq.css', 'yawm.css', 'markaz.css', 'studio.css', 'page-editor.css'];
// ترتيب الطبقات من أول عبارة في signature.css (العقد 5)، ثم ما يُلحق بترتيب أول ظهور: policy-library (style.css) ثم yawm ثم markaz.
// كانت الثلاث تُعطى رتبة واحدة بعد القائمة، فيُحسم التعادل بينها بترتيب المصدر وحده.
const LAYERS = ['tokens', 'base', 'state', 'components', 'surfaces', 'stage', 'shell', 'depth',
  'classic', 'studio', 'riwaq', 'fill', 'kill', 'policy-library', 'yawm', 'markaz'];

/* ---------- 1. المحلّل: يفكّ @layer و@media والتداخل بـ& ---------- */
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// يوازن الأقواس متجاهلًا ما داخل علامات الاقتباس (روابط data: في --select-arrow).
function closeBrace(css, open) {
  let depth = 0, quote = '';
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === quote && css[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return css.length;
}

// تقسيم على فاصلة المستوى الأعلى وحدها: :is(a,b) قائمة واحدة لا اثنتان.
function splitTop(text, sep = ',') {
  const out = []; let depth = 0, quote = '', buf = '';
  for (const c of text) {
    if (quote) { buf += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

// دمج محدِّد متداخل مع أبيه. الشكل الوحيد المستعمل هنا يبدأ بـ& صراحةً.
function nest(parent, child) {
  if (!parent) return child;
  const parents = splitTop(parent);
  const wrapped = parents.length > 1 ? `:is(${parents.join(',')})` : parents[0];
  return splitTop(child)
    .map(part => (part.includes('&') ? part.replace(/&/g, wrapped) : `${wrapped} ${part}`))
    .join(',');
}

// كل تصريح رمز مخصّص في الورقة، مع محدِّده وشروط @media وطبقته وترتيب مصدره.
function collect(css, file, fileIndex, emit) {
  let order = 0;
  const walk = (text, base, selector, conditions, layer) => {
    let i = 0, buf = '';
    while (i < text.length) {
      const c = text[i];
      if (c === '{') {
        const head = buf.trim(); buf = '';
        const end = closeBrace(text, i);
        const body = text.slice(i + 1, end);
        if (head.startsWith('@')) {
          const name = /^@([a-z-]+)/.exec(head)[1];
          const prelude = head.slice(name.length + 1).trim();
          if (name === 'media') walk(body, base, selector, conditions.concat(splitTop(prelude)), layer);
          else if (name === 'supports' || name === 'starting-style') walk(body, base, selector, conditions, layer);
          else if (name === 'layer') walk(body, base, selector, conditions, prelude || layer);
          // @font-face و@keyframes و@property لا تحمل رموزًا على :root
        } else walk(body, base, nest(selector, head), conditions, layer);
        i = end + 1;
      } else if (c === ';') {
        const decl = buf.trim(); buf = '';
        const at = decl.indexOf(':');
        if (selector && at > 0 && decl.startsWith('--')) {
          emit({
            selector, conditions, layer,
            prop: decl.slice(0, at).trim(),
            value: decl.slice(at + 1).trim(),
            file, fileIndex, order: order++,
          });
        }
        i++;
      } else { buf += c; i++; }
    }
  };
  walk(css, '', '', [], '');
}

/* ---------- 2. المطابقة والوزن ---------- */
// عنصر الجذر المحاكى: html مع data-design وdata-theme. لا شاشة دخول ولا سمات مشهد.
const matchSimple = (part, el) => {
  if (part === ':root' || part === 'html' || part === '*') return true;
  const attr = /^\[([a-z-]+)(?:([~^|$*]?=)"?'?([^\]"']*)"?'?)?\]$/.exec(part);
  if (attr) {
    const have = el[attr[1]];
    if (attr[2] === undefined) return have !== undefined;
    return attr[2] === '=' && have === attr[3];
  }
  const fn = /^:(is|matches|where|not|has)\(([\s\S]*)\)$/.exec(part);
  if (fn) {
    if (fn[1] === 'has') return false;             // :has(> body > #app > .login) — شاشة الدخول خارج النطاق
    const any = splitTop(fn[2]).some(arg => matchCompound(arg, el));
    return fn[1] === 'not' ? !any : any;
  }
  return false;                                    // #id و.class و:hover وview-transition لا تطابق الجذر
};

// تفكيك محدِّد مركّب (بلا رابط) إلى أجزائه البسيطة.
function compoundParts(sel) {
  const parts = []; let buf = '', depth = 0;
  for (const c of sel) {
    if (c === ')' || c === ']') { depth--; buf += c; continue; }
    // الفصل قبل فتح القوس، وإلا التصق [data-theme=dark] بـ:is(...) قبله ولم يطابق شيء.
    if (depth === 0 && (c === '.' || c === '#' || c === '[' || c === ':') && buf && !buf.endsWith(':')) {
      parts.push(buf); buf = '';
    }
    if (c === '(' || c === '[') depth++;
    buf += c;
  }
  if (buf) parts.push(buf);
  return parts;
}
const matchCompound = (sel, el) => compoundParts(sel.trim()).every(p => matchSimple(p, el));

const hasCombinator = sel => {
  let depth = 0;
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) return true;
  }
  return false;
};

function specificity(sel) {
  let a = 0, b = 0, c = 0;
  for (const part of compoundParts(sel.trim())) {
    const fn = /^:(is|matches|not|has)\(([\s\S]*)\)$/.exec(part);
    if (fn) {
      let best = [0, 0, 0];
      for (const arg of splitTop(fn[2])) {
        const s = specificity(arg);
        if (s[0] !== best[0] ? s[0] > best[0] : s[1] !== best[1] ? s[1] > best[1] : s[2] > best[2]) best = s;
      }
      a += best[0]; b += best[1]; c += best[2];
    } else if (/^:where\(/.test(part)) continue;
    else if (part.startsWith('#')) a++;
    else if (part.startsWith('.') || part.startsWith('[') || /^:[a-z-]+/.test(part)) b++;
    else if (/^[a-z]/i.test(part)) c++;
  }
  return [a, b, c];
}
const cmpSpec = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
const cmpRank = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const layerRank = name => {
  if (!name) return Number.MAX_SAFE_INTEGER;        // خارج الطبقات يعلو كل طبقة
  const i = LAYERS.indexOf(name.trim());
  return i >= 0 ? i : LAYERS.length + 1;
};

/* ---------- 3. شروط @media ---------- */
// سياق الجهاز: شاشة، سطح مكتب، كثافة مضاعفة، بلا تفضيل تباين أو حركة.
function mediaApplies(condition, device) {
  const cond = condition.toLowerCase().trim();
  if (cond === 'print') return false;
  if (cond === 'screen' || cond === 'all' || cond === '') return true;
  return cond.split(/\s+and\s+/).every(term => {
    const t = term.trim();
    if (t === 'screen' || t === 'all') return true;
    if (t === 'print') return false;
    const m = /^\((min-|max-)?([a-z-]+)\s*:\s*([^)]+)\)$/.exec(t);
    if (!m) throw new Error(`شرط @media غير معروف: ${term}`);
    const [, range, feature, raw] = m;
    const value = raw.trim();
    const num = parseFloat(value);
    switch (feature) {
      case 'prefers-color-scheme': return value === device.scheme;
      case 'prefers-contrast': return value === 'no-preference';
      case 'prefers-reduced-motion': return value === 'no-preference';
      case 'prefers-reduced-transparency': return value === 'no-preference';
      case 'forced-colors': return value === 'none';
      case 'hover': return value === 'hover';
      case 'pointer': return value === 'fine';
      case 'width': return range === 'min-' ? device.width >= num : device.width <= num;
      case 'height': return range === 'min-' ? device.height >= num : device.height <= num;
      case 'resolution': return range === 'min-' ? device.dppx >= num : device.dppx <= num;
      default: throw new Error(`خاصية @media غير معروفة: ${feature}`);
    }
  });
}

/* ---------- 4. بناء خريطة الرموز لسياق واحد ---------- */
const SHEET_RULES = SHEETS.flatMap((file, fileIndex) => {
  const rules = [];
  collect(stripComments(readFileSync(CSS_DIR + file, 'utf8')), file, fileIndex, r => rules.push(r));
  return rules;
});

function tokensFor(design, theme, scheme) {
  const el = { 'data-design': design, 'data-theme': theme, dir: 'rtl' };
  const device = { scheme, width: 1280, height: 900, dppx: 2 };
  const winners = new Map();                        // prop -> {spec, layer, fileIndex, order, value}
  for (const rule of SHEET_RULES) {
    if (!rule.conditions.every(c => mediaApplies(c, device))) continue;
    let best = null;
    for (const sel of splitTop(rule.selector)) {
      if (hasCombinator(sel) || !matchCompound(sel, el)) continue;
      const spec = specificity(sel);
      if (!best || cmpSpec(spec, best) > 0) best = spec;
    }
    if (!best) continue;
    // ترتيب الغلبة: الطبقة، ثم الوزن، ثم ترتيب المصدر (الورقة فالتصريح داخلها).
    const rank = [layerRank(rule.layer), best[0], best[1], best[2], rule.fileIndex, rule.order];
    const prev = winners.get(rule.prop);
    if (!prev || cmpRank(rank, prev.rank) > 0) winners.set(rule.prop, { rank, value: rule.value });
  }
  const map = new Map();
  for (const [prop, { value }] of winners) map.set(prop, value);
  return map;
}

/* ---------- 5. حلّ القيمة إلى لون ---------- */
function expand(value, tokens, seen = new Set()) {
  let out = value, guard = 0;
  while (out.includes('var(') && guard++ < 60) {
    const at = out.indexOf('var(');
    let depth = 0, stop = -1;
    for (let i = at + 3; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') { depth--; if (depth === 0) { stop = i; break; } }
    }
    if (stop < 0) break;
    const args = splitTop(out.slice(at + 4, stop));
    const name = args[0].trim();
    const fallback = args.slice(1).join(',').trim();
    let replacement = fallback;
    if (!seen.has(name) && tokens.has(name)) {
      seen.add(name);
      replacement = expand(tokens.get(name), tokens, seen);
      seen.delete(name);
    }
    out = out.slice(0, at) + replacement + out.slice(stop + 1);
  }
  return out.trim();
}

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
function parseColor(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (NAMED[s.toLowerCase()]) return NAMED[s.toLowerCase()].slice();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const h = m[1];
    const pick = (i, n) => parseInt(n === 1 ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2), 16);
    if (h.length === 3 || h.length === 4) return [pick(0, 1), pick(1, 1), pick(2, 1), h.length === 4 ? pick(3, 1) / 255 : 1];
    if (h.length === 6 || h.length === 8) return [pick(0, 2), pick(1, 2), pick(2, 2), h.length === 8 ? pick(3, 2) / 255 : 1];
    return null;
  }
  m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (m) {
    const p = splitTop(m[1].replace(/\//g, ',')).map(v => v.trim());
    if (p.length < 3) return null;
    const ch = v => (v.endsWith('%') ? Math.round(parseFloat(v) * 2.55) : parseFloat(v));
    const al = p[3] === undefined ? 1 : (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]));
    return [ch(p[0]), ch(p[1]), ch(p[2]), al];
  }
  m = /^color-mix\(([\s\S]*)\)$/i.exec(s);
  if (m) {
    const parts = splitTop(m[1]);
    if (parts.length < 3 || !/^in\s+srgb$/i.test(parts[0].trim())) return null;
    const read = part => {
      const pc = /\s(\d+(?:\.\d+)?)%$/.exec(part);
      return { color: parseColor(pc ? part.slice(0, pc.index).trim() : part.trim()), pct: pc ? parseFloat(pc[1]) / 100 : null };
    };
    const a = read(parts[1]), b = read(parts[2]);
    if (!a.color || !b.color) return null;
    const wa = a.pct ?? (b.pct !== null ? 1 - b.pct : 0.5);
    const wb = 1 - wa;
    // خلط sRGB مع مراعاة ألفا (كما تعرّفه CSS Color 5)
    const alpha = a.color[3] * wa + b.color[3] * wb;
    const mixCh = i => (alpha === 0 ? 0 : (a.color[i] * a.color[3] * wa + b.color[i] * b.color[3] * wb) / alpha);
    return [mixCh(0), mixCh(1), mixCh(2), alpha];
  }
  return null;
}

const over = (fg, bg) => {
  if (!fg) return bg;
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
};
const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (x, y) => {
  const a = luminance(x), b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/* ---------- 6. السياقات والأزواج ---------- */
// الأوضاع الأربعة: الصريحان، و«يتبع الجهاز» على جهازين. كتلتا auto نسخةٌ من dark/light،
// والنسخ يفترق بمرور الوقت — فيُقاس ولا يُفترض.
const MODES = [
  { key: 'light', theme: 'light', scheme: 'light', dark: false },
  { key: 'dark', theme: 'dark', scheme: 'dark', dark: true },
  { key: 'auto·جهاز فاتح', theme: 'auto', scheme: 'light', dark: false },
  { key: 'auto·جهاز داكن', theme: 'auto', scheme: 'dark', dark: true },
];
const TEXT = ['--label', '--label-2', '--label-3', '--ink-1', '--ink-2', '--ink-3', '--ink-4', '--ink-5'];
const SURFACE = ['--canvas', '--bg', '--surface', '--surface-2', '--surface-raised', '--material-thick'];
// 1.4.11: حدود المكوّنات ومؤشّر البؤرة. --line فاصل قراءة لا حدّ مكوّن (موثّق في signature.css) فهو خارج القياس.
const NON_TEXT = ['--focus', '--line-strong'];
const NON_TEXT_SURFACE = ['--canvas', '--bg', '--surface', '--surface-2'];

function context(design, mode) {
  const tokens = tokensFor(design, mode.theme, mode.scheme);
  const root = mode.dark ? [0, 0, 0, 1] : [255, 255, 255, 1];
  const colorOf = name => parseColor(expand(tokens.get(name) ?? '', tokens));
  const canvas = over(colorOf('--canvas'), root);
  const backdrop = name => (name === '--canvas' || name === '--bg' ? over(colorOf(name), root) : over(colorOf(name), canvas));
  return { tokens, colorOf, backdrop, has: name => tokens.has(name) };
}

const round = n => Math.round(n * 100) / 100;
function audit(pairs, threshold) {
  const fails = [];
  let measured = 0;
  for (const design of DESIGNS) for (const mode of MODES) {
    const ctx = context(design, mode);
    for (const [fg, bgs] of pairs) {
      if (!ctx.has(fg)) continue;
      for (const bg of bgs) {
        if (!ctx.has(bg)) continue;
        const back = ctx.backdrop(bg);
        const front = ctx.colorOf(fg);
        if (!back || !front) continue;
        measured++;
        const ratio = contrast(over(front, back), back);
        if (ratio + 1e-9 < threshold) fails.push(`${design}/${mode.key}  ${fg} على ${bg} = ${round(ratio).toFixed(2)}`);
      }
    }
  }
  return { measured, fails };
}
const report = (fails, measured, threshold) =>
  `${fails.length} من ${measured} زوجًا تحت ${threshold}:1\n` + fails.map(f => '  · ' + f).join('\n');

// تُصدَّر ليقيس بها سكربت مقارنة أو تقرير خارج الاختبار نفسه.
export { context, contrast, over, audit, MODES, TEXT, SURFACE, NON_TEXT, NON_TEXT_SURFACE };

/* ---------- 7. الاختبارات ---------- */
test('المحرّك يقرأ الرموز فعلًا قبل أن يحكم — لا خريطة فارغة تمرّ صامتة', () => {
  for (const design of DESIGNS) for (const mode of MODES) {
    const ctx = context(design, mode);
    assert.ok(ctx.has('--canvas'), `${design}/${mode.key}: --canvas غير محلول`);
    assert.ok(ctx.colorOf('--canvas'), `${design}/${mode.key}: --canvas ليس لونًا`);
    assert.ok(ctx.has('--label') || ctx.has('--ink-1'), `${design}/${mode.key}: لا رمز حبر`);
  }
});

test('كل زوج نص/خلفية يعبر 4.5:1 — في التصاميم الثمانية والأوضاع الأربعة', () => {
  const { measured, fails } = audit(TEXT.map(t => [t, SURFACE]), 4.5);
  assert.ok(measured >= 1000, `قيست ${measured} أزواج فقط — المحرّك لم يجد الرموز`);
  assert.deepEqual(fails, [], report(fails, measured, 4.5));
});

test('مؤشّر البؤرة وحدود المكوّنات تعبر 3:1 (WCAG 1.4.11)', () => {
  const { measured, fails } = audit(NON_TEXT.map(t => [t, NON_TEXT_SURFACE]), 3);
  assert.deepEqual(fails, [], report(fails, measured, 3));
});

// حبر الفيروزي والحالات نصًّا: --accent-ink (نص الفيروزي في كل تصميم) وأحبار الحالات في عائلة «الكلاسيكي» (الشارات وسطور التنبيه).
// --tint و--turn ليسا هنا: في عائلة الفراغ هما تعبئة الفعل لا حبر نص، وتدقيق 30 سبتمبر نقل كل نص بالصبغة إلى --accent-ink.
const ACCENT_TEXT = ['--accent-ink', '--red-ink', '--orange-ink', '--green-ink', '--blue-ink', '--gray-ink'];
test('حبر الفيروزي وأحبار الحالات تعبر 4.5:1 على كل سطح — في التصاميم التسعة والأوضاع الأربعة', () => {
  const { measured, fails } = audit(ACCENT_TEXT.map(t => [t, SURFACE]), 4.5);
  assert.ok(measured >= 500, `قيست ${measured} أزواج فقط — المحرّك لم يجد الرموز`);
  assert.deepEqual(fails, [], report(fails, measured, 4.5));
});

// الأدوار (الدفعة الثالثة): طبقة --color-* هي ما تقرؤه الشاشات، فتُقاس في كل تصميم ووضع كما تُقاس الرموز التي تشير إليها —
// دورٌ يعبر في «كوكبة» ويسقط في «الحقل» عيبٌ في الأساس لا في الشاشة.
const ROLE_TEXT = ['--color-text-primary', '--color-text-body', '--color-text-secondary', '--color-text-tertiary', '--color-text-disabled',
  '--color-accent-text', '--color-danger-text', '--color-warning-text', '--color-success-text', '--color-info-text'];
const ROLE_BG = ['--color-bg-page', '--color-bg-surface', '--color-bg-raised'];
test('الأدوار --color-*: كل نصٍّ على كل خلفية يعبر 4.5:1، والحدّ والبؤرة 3:1 — في التصاميم التسعة والأوضاع الأربعة', () => {
  const text = audit(ROLE_TEXT.map(t => [t, ROLE_BG]), 4.5);
  const edges = audit(['--color-border-default', '--color-border-focus'].map(t => [t, ['--color-bg-page', '--color-bg-surface']]), 3);
  assert.ok(text.measured >= 900, `قيست ${text.measured} أزواج فقط — الأدوار لم تُحلّ`);
  assert.deepEqual([...text.fails, ...edges.fails], [], report([...text.fails, ...edges.fails], text.measured + edges.measured, '4.5 / 3'));
});

test('مؤشّر البؤرة مصمت لا شفاف — الشفافية تُذيبه في الخلفية مهما كانت نسبته', () => {
  const translucent = [];
  for (const design of DESIGNS) for (const mode of MODES) {
    const ctx = context(design, mode);
    const focus = ctx.colorOf('--focus');
    if (focus && focus[3] < 1) translucent.push(`${design}/${mode.key}  --focus ألفا ${focus[3]}`);
  }
  assert.deepEqual(translucent, [], 'رموز بؤرة شفافة:\n' + translucent.map(t => '  · ' + t).join('\n'));
});

test('لكل تصميم لوحة معاينة خاصة به في شاشة المظهر — لا تصميم يستعير صورة غيره', () => {
  const missing = DESIGNS.filter(d => !PALETTES[d]);
  assert.deepEqual(missing, [], `تصاميم بلا لوحة معاينة (تسقط على لوحة تصميم آخر): ${missing.join('، ')}`);
  const extra = Object.keys(PALETTES).filter(k => !DESIGNS.includes(k));
  assert.deepEqual(extra, [], `لوحات لتصاميم غير موجودة: ${extra.join('، ')}`);
  for (const [key, set] of Object.entries(PALETTES)) {
    for (const mode of ['dark', 'light']) {
      const c = set[mode];
      assert.ok(c, `${key}/${mode}: لا لوحة`);
      for (const field of ['ground', 'ink', 'soft', 'line', 'action', 'onAction', 'marks']) {
        assert.ok(c[field] !== undefined, `${key}/${mode}: ينقصها ${field}`);
      }
      assert.equal(c.marks.length, 6, `${key}/${mode}: علامات الكوكبة ست`);
    }
  }
});
