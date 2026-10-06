// TP2.1 — بوابة التحقق بأمر واحد.  node scripts/gate.mjs
//
// تسعة فحوص في أمر واحد، بلا تبعيات. لماذا واحد: كان التحقق موزَّعًا على أوامر يتذكّرها من يشغّلها،
// فمرّ نشران بلا نسخة احتياطية طازجة، ومرّت 38 اختبار HTTP شهرًا بلا تشغيل لأن بيئة الجلسة تمنع فتح منفذ،
// ومرّ ادّعاء «صفر إخفاق» مبنيًّا على `grep '^not ok'` بينما المُبلِّغ الافتراضي يكتب ✖ — فالعدّ كان أعمى.
// ولهذا تقرأ البوابة مُبلِّغ TAP بعينه (`--test-reporter=tap`)، حيث «not ok» و«# fail» صيغة موثَّقة لا أثر شكلي.
//
// كل فحص يطبع سطرًا واحدًا: اسمه، ونتيجته، والرقم الذي قيست به. والخروج غير صفري عند أول إخفاق مُحصًى،
// ولا تتوقف البوابة عند الفحص الفاشل بل تكملها كلها، فيُرى العطل كاملًا لا أوّله وحده.
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync, statSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = join(ROOT, 'scripts/gate-baseline.json');
const read = path => readFileSync(join(ROOT, path), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex');

/* ───── (٦) بصمة المخطط — تُستعمل في الفحص السادس وتُثبَّت في خط الأساس ───── */
// كل ما في sqlite_master بعد الترحيلات: الجداول والفهارس والمحفّزات والمنظورات، بأسمائها ونصّها.
// الفهارس التلقائية (sqlite_autoindex_*) داخلة: اختفاء أحدها يعني اختفاء قيد فريد.
export function schemaFingerprint(db) {
  const rows = db.prepare("SELECT type,name,tbl_name,COALESCE(sql,'') sql FROM sqlite_master ORDER BY type,name").all();
  const counts = {};
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return { digest: hash(rows.map(r => `${r.type}|${r.name}|${r.tbl_name}|${r.sql}`).join('\n')), counts, objects: rows.length };
}

// تُستدعى من البوابة ومن سطر الأوامر معًا، فتُحمِّل openDb بنفسها إن لم تكن مُحمَّلة —
// دالةٌ مُصدَّرة لا تعمل إلا من داخل نداءٍ آخر عيبٌ في الواجهة لا خصوصيةٌ فيها.
export async function migrateFresh() {
  if (!openDbCached) ({ openDb: openDbCached } = await import('../app/db.mjs'));
  const dir = mkdtempSync(join(tmpdir(), '36t-gate-fresh-'));
  try {
    const path = join(dir, 'fresh.sqlite');
    const start = Date.now();
    const db = openPlatformDb(path);
    const version = db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
    const fingerprint = schemaFingerprint(db);
    db.close();
    return { version, fingerprint, ms: Date.now() - start };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// openDb يطبّق المخطط والترحيلات، وهو مصدر الحقيقة. يُستورد كسولًا فلا يحمّل الخادم كله عند قراءة هذا الملف.
let openDbCached = null;
function openPlatformDb(path) {
  if (!openDbCached) throw new Error('openDb was not loaded');
  return openDbCached(path);
}

// `work/` مستثنى من git، فلكل شجرة عمل نسخته. والنسخ الاحتياطية الحقيقية في المجلد الرئيسي وحده،
// فبحثٌ في جذر هذه الشجرة كان سيتخطّى أهمّ فحص بصمت — وهو بعينه العمى الذي بُنيت البوابة لمنعه.
export function checkoutRoots() {
  const roots = [ROOT];
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' });
  if (common.status === 0) {
    const main = dirname(common.stdout.trim());
    if (main && main !== ROOT && existsSync(main)) roots.push(main);
  }
  if (process.env.BACKUP_DIR) roots.push(process.env.BACKUP_DIR);
  return roots;
}

export function newestBackup() {
  const roots = checkoutRoots()
    .flatMap(base => base === process.env.BACKUP_DIR ? [base] : ['work/backups', 'work/backups/auto'].map(d => join(base, d)))
    .filter(existsSync);
  let best = null;
  for (const dir of roots) for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const inner = join(dir, entry.name);
      for (const file of readdirSync(inner).filter(f => f.endsWith('.sqlite')))
        best = pick(best, join(inner, file));
      continue;
    }
    if (entry.name.endsWith('.sqlite')) best = pick(best, join(dir, entry.name));
  }
  return best;
  function pick(current, path) {
    const at = statSync(path).mtimeMs;
    return !current || at > current.at ? { path, at } : current;
  }
}

/* ───── قراءة ملخّص الحزمة — خالصة، فتُختبر بنص TAP بلا تشغيل ───── */
export function readSuiteSummary(text, baseline = {}) {
  const n = key => Number(text.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
  const tests = n('tests'), pass = n('pass'), fail = n('fail'), skipped = n('skipped');
  if (!Number.isFinite(tests)) return { ok: false, note: 'لم يُقرأ ملخّص TAP — الحزمة لم تكتمل' };
  // بيئة محجوبة عن المنافذ تُسقط اختبارات HTTP بـEPERM. بلا تسميةٍ لذلك تُقرأ «38 فاشلًا» عطلًا في الكود،
  // أو — وهو الأسوأ وقد وقع شهرًا — تُشغَّل الحزمة في بيئة كهذه ويُعلَن «صفر إخفاق» لأن العدّ لم يرَ الفشل أصلًا.
  const blocked = (text.match(/listen EPERM: operation not permitted/g) ?? []).length;
  const floor = baseline.tests_floor;
  const ok = fail === 0 && (floor === undefined || tests >= floor);
  const head = `${tests} اختبارًا · ${pass} ناجحًا · ${fail} فاشلًا · ${skipped} متخطًّى`;
  const failedNames=[...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(match=>match[1].trim());
  const failedNote=failedNames.length?` — الفاشل: ${failedNames.slice(0,5).join(' | ')}${failedNames.length>5?` | و${failedNames.length-5} أخرى`:''}`:'';
  if (!ok && blocked && blocked >= fail) return { ok: false, value: { tests, pass, fail, skipped, blocked },
    note: `${head} — وكلّها من نوع واحد: البيئة تمنع فتح منفذ محلي (listen EPERM). اختبارات HTTP لم تُشغَّل، ` +
      'وهذا ليس نجاحًا ولا عطلًا في الكود. شغّل البوابة في طرفية خارج أي صندوق حماية.' };
  return { ok, value: { tests, pass, fail, skipped, ...(blocked ? { blocked } : {}) },
    note: head + failedNote + (blocked ? ` (منها ${blocked} بسبب منع المنفذ)` : '') +
      (floor === undefined ? ' (قياس: لا خط أساس بعد)' : ` (الحد الأدنى ${floor})`) +
      (floor !== undefined && tests < floor ? ' — العدد نزل عن خط الأساس' : '') };
}

/* ───── الفحوص ───── */
const CHECKS = [];
const check = (id, title, run) => CHECKS.push({ id, title, run });

check(1, 'الحزمة كاملة', ({ baseline }) => {
  const files = readdirSync(join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).sort().map(f => 'tests/' + f);
  // المخرج إلى ملف لا إلى أنبوب: مُبلِّغ TAP يكتب عشرات الميغابايت، وspawnSync كان يحتجزها كلها في ذاكرة الأب
  // ويحتاج maxBuffer مرفوعًا يدويًا. (ظننتُ أول الأمر أن هذا سبب البطء؛ القياس نفاه — الحزمة تأخذ نحو الثلاثين
  // دقيقة في الحالين لأن node يعزل كل ملف اختبار في عملية. التغيير يبقى لأنه يزيل سقف الذاكرة، لا لأنه أسرع.)
  // والملف يُحذف بعد قراءته.
  const dir = mkdtempSync(join(tmpdir(), '36t-gate-suite-'));
  const log = join(dir, 'tap.log');
  let text = '';
  try {
    const out = openSync(log, 'w');
    try { spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: ROOT, stdio: ['ignore', out, out] }); }
    finally { closeSync(out); }
    text = readFileSync(log, 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return readSuiteSummary(text, baseline);
});

check(2, 'فحوص المصدر (check.mjs)', () => {
  const result = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, note: (result.stdout.trim().split('\n')[0] ?? result.stderr.trim().split('\n')[0] ?? '').slice(0, 150) };
});

check(3, 'المسنّنة', async () => {
  const { runRatchet } = await import('./quality-ratchet.mjs');
  const ratchet = await runRatchet();
  return { ok: ratchet.ok, note: (ratchet.lines?.[0] ?? '').replace(/^Quality ratchet: /, '').slice(0, 180) };
});

check(4, 'الترحيلات من قاعدة فارغة', async ({ baseline }) => {
  const fresh = await migrateFresh();
  const ok = baseline.migration === undefined || fresh.version === baseline.migration;
  return { ok, value: fresh.version,
    note: `بلغت الترحيل ${fresh.version} في ${fresh.ms} مللي` +
      (baseline.migration === undefined ? ' (قياس)' : ok ? '' : ` — خط الأساس ${baseline.migration}`) };
});

check(5, 'الترحيلات على نسخة من آخر نسخة احتياطية', async () => {
  const backup = newestBackup();
  // كان هذا الفرع يعيد ok:true ونصّه يقول «لم يُجرَّب شيء، وهذا ليس نجاحًا» — فالنصّ صادق والقيمة تناقضه،
  // وتُصدر البوابة أخضر على نظام بلا شبكة أمان. والقاعدة: skipped ليس نجاحًا. وليست الحالة فرضية: قياس
  // 29 سبتمبر 2026 وجد آخر اختبار استعادة مسجَّلًا على الترحيل 104 والقاعدة على 149، وخدمة النسخ الدورية
  // غير مثبَّتة. فغياب النسخة سبب لوقف البوابة لا لتخطّيها.
  if (!backup) return { ok: false, note: `لا نسخة احتياطية في: ${checkoutRoots().join('، ')} — لم تُجرَّب استعادة، فلا دليل على أن الرجوع ممكن. خذ نسخة (scripts/backup.mjs) وأعد التشغيل.` };
  const dir = mkdtempSync(join(tmpdir(), '36t-gate-backup-'));
  try {
    const copy = join(dir, 'restored.sqlite');
    // VACUUM INTO لا cp: النسخة متسقة، والأصل يُفتح للقراءة وحدها فلا يُمسّ.
    const src = new DatabaseSync(backup.path, { readOnly: true });
    src.prepare('VACUUM INTO ?').run(copy); src.close();
    const { verifyAudit } = await import('../app/db.mjs');
    const db = openPlatformDb(copy);
    const version = db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const fk = db.prepare('PRAGMA foreign_key_check').all().length;
    const chain = verifyAudit(db);
    db.close();
    const ok = integrity === 'ok' && fk === 0 && chain;
    return { ok, value: { version, integrity, fk, chain },
      note: `${backup.path.replace(ROOT + '/', '')} → الترحيل ${version} · سلامة ${integrity} · مراجع ${fk} · سلسلة التدقيق ${chain}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check(6, 'بصمة المخطط', async ({ baseline }) => {
  const { fingerprint } = await migrateFresh();
  const ok = !baseline.schema_digest || fingerprint.digest === baseline.schema_digest;
  const shape = Object.entries(fingerprint.counts).map(([k, v]) => `${k} ${v}`).join(' · ');
  return { ok, value: fingerprint.digest,
    note: `${fingerprint.digest.slice(0, 16)}… · ${shape}` +
      (!baseline.schema_digest ? ' (قياس)' : ok ? '' : ` — خط الأساس ${baseline.schema_digest.slice(0, 16)}…`) };
});

check(7, 'لا تبعيات في package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  const found = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].filter(k => pkg[k] && Object.keys(pkg[k]).length);
  return { ok: found.length === 0, note: found.length ? `وُجدت: ${found.join('، ')}` : 'صفر تبعية، كما هو مشترط' };
});

check(8, 'إصدار Node', () => {
  const want = JSON.parse(read('package.json')).engines?.node ?? '';
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = major === 24 && minor >= 14;
  return { ok, value: process.versions.node, note: `${process.versions.node} مقابل ${want}` + (ok ? '' : ' — المحرك المثبَّت في work/node24/bin/node') };
});

check(9, 'سقف الاختبارات المتخطّاة', ({ baseline, results }) => {
  const skipped = results.get(1)?.value?.skipped;
  if (skipped === undefined) return { ok: false, note: 'لم يُقرأ عدد المتخطَّى لأن الحزمة لم تكتمل' };
  const ceiling = baseline.skipped_ceiling;
  return { ok: ceiling === undefined || skipped <= ceiling, value: skipped,
    note: ceiling === undefined ? `${skipped} متخطًّى (قياس: لا سقف بعد)` : `${skipped} متخطًّى، والسقف ${ceiling}` };
});

/* ───── التشغيل ───── */
// `only` للتشخيص وحده: البوابة بأمر واحد هي الوعد، و«سريع» ليس بديلًا عنها — وتقول ذلك في سطرها الأخير.
export async function runGate({ baseline = loadBaseline(), only = null } = {}) {
  ({ openDb: openDbCached } = await import('../app/db.mjs'));
  const results = new Map(), lines = [];
  let failed = 0;
  for (const { id, title, run } of CHECKS.filter(c => !only || only.includes(c.id))) {
    const started = Date.now();
    let outcome;
    try { outcome = await run({ baseline, results }); }
    catch (error) { outcome = { ok: false, note: `${error.name}: ${String(error.message).slice(0, 160)}` }; }
    results.set(id, outcome);
    if (!outcome.ok) failed++;
    const mark = outcome.skipped ? '–' : outcome.ok ? '✔' : '✖';
    lines.push(`${mark} ${id}. ${title}: ${outcome.note ?? ''} (${Math.round((Date.now() - started) / 100) / 10}s)`);
  }
  return { ok: failed === 0, failed, results, lines,
    measured: { tests_floor: results.get(1)?.value?.tests, skipped_ceiling: results.get(1)?.value?.skipped,
      migration: results.get(4)?.value, schema_digest: results.get(6)?.value } };
}

export const loadBaseline = () => existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rebaseline = process.argv.includes('--rebaseline');
  // الحزمة تأخذ دقائق. --quick يشغّل ما عداها للتشخيص السريع، ولا يُعتدّ به بديلًا.
  const quick = process.argv.includes('--quick');
  const gate = await runGate({ baseline: rebaseline ? {} : loadBaseline(), only: quick ? [2, 3, 4, 5, 6, 7, 8] : null });
  if (quick && rebaseline) { console.error('--quick و--rebaseline لا يجتمعان: خط الأساس يُقاس بالحزمة كاملة.'); process.exit(2); }
  console.log('\n' + gate.lines.join('\n'));
  if (rebaseline) {
    const { writeFileSync } = await import('node:fs');
    const next = { ...gate.measured, recorded_at: new Date().toISOString().slice(0, 10),
      note: 'خط أساس بوابة التحقق (TP2.1). tests_floor لا ينزل، وskipped_ceiling لا يصعد، وschema_digest لا يتغير إلا بترحيل.' };
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 1) + '\n');
    console.log('\nخط الأساس كُتب: ' + JSON.stringify(gate.measured));
    process.exit(gate.ok ? 0 : 1);
  }
  if (quick) console.log(gate.ok ? '\nسريع: سبعة فحوص مرّت — والحزمة لم تُشغَّل، فهذه ليست البوابة.' : `\nسريع: ${gate.failed} فحصًا لم يمرّ.`);
  else console.log(gate.ok ? '\nالبوابة: تسعة فحوص، كلها مرّت.' : `\nالبوابة: ${gate.failed} فحصًا لم يمرّ. لا تُنشر ولا تُدفع حتى يُصلَح.`);
  process.exit(gate.ok ? 0 : 1);
}
