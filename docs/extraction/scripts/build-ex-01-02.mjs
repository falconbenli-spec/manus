// EX-01 وEX-02: جرد المتطلبات، وتوزيع التتبع. مولَّدان من المصدرين مباشرةً، لا من ذاكرة.
//   node docs/extraction/scripts/build-ex-01-02.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'docs/extraction');
const read = path => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const esc = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
const cut = (value, n) => { const t = esc(value); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const catalog = read('sources/requirements.catalog.json');
const trace = read('docs/traceability.json');
const byId = new Map(trace.requirements.map(r => [r.id, r]));
const tally = (rows, pick) => rows.reduce((m, r) => { const k = pick(r) ?? '—'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

/* ───── EX-01 ───── */
function ex01() {
  const rows = catalog.map(r => [
    r.id, esc(r.domain), cut(r.title, 70), r.priority, esc(r.phase),
    cut(r.acceptance, 160) || '—',
    r.existing_evidence ? cut(r.existing_evidence, 60) : '—',
    r.reference_url ? `[${esc(r.reference)}](${r.reference_url})` : esc(r.reference) || '—',
    `${esc(r.source_sheet)}:${r.source_row}`,
  ]);
  return `# EX-01 · جرد المتطلبات كما وردت في مصدرها

> مولَّد من \`sources/requirements.catalog.json\` — وهو المستخرَج من \`360_Integrated_System_Requirements.xlsx\`، وبصمته محفوظة في \`sources/manifest.json\` و\`npm run check\` يتحقق منها.
> **نص \`acceptance\` منقول كما هو، مقصوصًا عند 160 حرفًا للعرض.** النص الكامل في المصدر.
> أعد التوليد: \`node docs/extraction/scripts/build-ex-01-02.mjs\`

**${catalog.length} متطلبًا · ${new Set(catalog.map(r => r.domain)).size} مجالًا**

## التوزيع

${table(['البند', 'العدد'], [
  ...Object.entries(tally(catalog, r => r.priority)).sort().map(([k, v]) => [`الأولوية ${k}`, v]),
  ...Object.entries(tally(catalog, r => r.phase)).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`المرحلة ${k}`, v]),
  ...Object.entries(tally(catalog, r => r.sensitivity)).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`الحساسية ${k}`, v]),
])}

## الجدول

${table(['المعرّف', 'المجال', 'العنوان', 'الأولوية', 'المرحلة', 'معيار القبول (كما ورد)', 'الدليل القائم', 'المرجع', 'المصدر'], rows)}
`;
}

/* ───── EX-02 ───── */
function ex02() {
  const rows = trace.requirements.map(r => {
    const s = r.implementation;
    return [r.id, esc(r.domain), esc(s.status), esc(s.coverage),
      s.code_files.length, s.tests.length, s.evidence.length, s.blockers.length,
      esc(s.last_result?.status) || '—', s.owner_acceptance ? 'نعم' : 'لا'];
  });
  const withTests = trace.requirements.filter(r => r.implementation.tests.length);
  const testResults = tally(withTests.flatMap(r => r.implementation.tests), t => t.result?.status);
  return `# EX-02 · توزيع التتبع، ومعنى كل حالة

> مولَّد من \`docs/traceability.json\` (آخر تحديث للملف: \`${trace.updated_at}\`) وقواعده في \`scripts/trace.mjs\`.

## سُلّم الحالة الست، وما تشترطه كل درجة

القواعد مأخوذة من \`scripts/trace.mjs\` — وهي **مفروضة** لا موصوفة: \`npm run check\` يفشل عند مخالفتها.

${table(['الحالة', 'العدد', 'ما تشترطه'], [
  ['لم يبدأ', trace.summary.status_counts['لم يبدأ'], 'لا شيء. والنص الأصلي محفوظ'],
  ['قيد التنفيذ', trace.summary.status_counts['قيد التنفيذ'], 'تغطية «جزئي» أو «لم ينفذ»، **ومعها فجوات مسمّاة** (`blockers` غير فارغة)'],
  ['منفذ غير متحقق', trace.summary.status_counts['منفذ غير متحقق'], 'كود بلا اختبار مسجَّل ناجح'],
  ['متحقق تقنيًا', trace.summary.status_counts['متحقق تقنيًا'], '**تغطية «كامل»، وكود، واختبارات كلها «نجح»، ودليل محفوظ** — وبصمة الاختبار ومخرجه مثبَّتتان، فتغيّر الاختبار بعد التسجيل يُكتشف'],
  ['متعطل بقرار أو وصول', trace.summary.status_counts['متعطل بقرار أو وصول'], 'موقوف على قرار أو وصول خارج المنصة'],
  ['مقبول من مالك الإجراء', trace.summary.status_counts['مقبول من مالك الإجراء'], 'تغطية «كامل»، **ومعها قبول باسم مالكه وتاريخه ودليله**'],
])}

**${trace.summary.technically_verified_complete} متحققًا تقنيًا بتغطية كاملة، و${trace.summary.accepted_by_owner} مقبولًا من مالك إجراء.** والثاني عند صفر لسبب ليس تقنيًا: لم يُسمَّ مالك إجراء بعد.

## التغطية

${table(['التغطية', 'العدد'], Object.entries(tally(trace.requirements, r => r.implementation.coverage)).sort((a, b) => b[1] - a[1]))}

## الأدلة المسجَّلة

- **${withTests.length}** متطلبًا له اختبار مسجَّل، بإجمالي **${withTests.reduce((n, r) => n + r.implementation.tests.length, 0)}** اختبارًا.
- نتائج الاختبارات المسجَّلة: ${Object.entries(testResults).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}.
- **${trace.requirements.filter(r => r.implementation.code_files.length).length}** متطلبًا يشير إلى ملف كود واحد على الأقل.

## بحسب المجال

${table(['المجال', 'الكل', 'قيد التنفيذ', 'لم يبدأ', 'متعطل', 'ملفات كود', 'اختبارات'],
  Object.entries(trace.requirements.reduce((m, r) => {
    const d = (m[r.domain] ??= { all: 0, going: 0, none: 0, blocked: 0, files: 0, tests: 0 });
    d.all++; const s = r.implementation;
    if (s.status === 'قيد التنفيذ') d.going++;
    if (s.status === 'لم يبدأ') d.none++;
    if (s.status === 'متعطل بقرار أو وصول') d.blocked++;
    d.files += s.code_files.length; d.tests += s.tests.length;
    return m;
  }, {})).sort((a, b) => b[1].going - a[1].going)
    .map(([domain, d]) => [esc(domain), d.all, d.going, d.none, d.blocked, d.files, d.tests]))}

## الجدول لكل متطلب

${table(['المعرّف', 'المجال', 'الحالة', 'التغطية', 'ملفات', 'اختبارات', 'أدلة', 'فجوات', 'آخر تشغيل', 'قبول المالك'], rows)}

## ما لا يقوله هذا التقرير

- **الملف أقدم من الكود.** آخر تحديث له \`${trace.updated_at}\`، وبعده جرى عمل لم يُسجَّل فيه. يُحدَّث بـ\`npm run trace -- --record-results\`.
- **«قيد التنفيذ» ليست درجة إنجاز.** ${trace.summary.status_counts['قيد التنفيذ']} متطلبًا فيها، وتعني أن شيئًا بُني ولم يكتمل — لا أكثر.
`;
}

const files = [['EX-01-requirements-inventory.md', ex01()], ['EX-02-traceability-distribution.md', ex02()]];
let stale = false;
for (const [name, text] of files) {
  const path = resolve(OUT, name);
  if (process.argv.includes('--check')) {
    let current = null; try { current = readFileSync(path, 'utf8'); } catch { /* غير موجود */ }
    if (current !== text) { console.error('قديم: ' + name); stale = true; }
  } else writeFileSync(path, text);
}
if (process.argv.includes('--check')) { console.log(stale ? 'stale' : 'up to date'); process.exit(stale ? 1 : 0); }
console.log(`EX-01: ${catalog.length} متطلبًا · EX-02: ${trace.requirements.length} صفًّا`);
