// EX-06 · EX-07 · EX-08 · EX-09 · EX-16 — من القاعدة الحية، قراءةً فقط.
//
// **لا تُفتح القاعدة الحية.** تُنسخ بـVACUUM INTO من اتصال readOnly، ويُقرأ من النسخة — لأن فتح
// قاعدة بـopenDb يطبّق عليها الترحيلات، وهو كتابة. والنسخة تُحذف بعد القراءة.
//
//   node docs/extraction/scripts/build-ex-live.mjs [--db <مسار>] [--check]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'docs/extraction');
const dbArg = process.argv.indexOf('--db');
const LIVE = dbArg > 0 ? resolve(process.argv[dbArg + 1])
  : resolve(ROOT, '../../work/hr-design-preview-20260914.sqlite');

const esc = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
const table = (head, rows) => rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
  : '_لا صفوف._';

const dir = mkdtempSync(join(tmpdir(), '36t-ex-'));
const copy = join(dir, 'read.sqlite');
try {
  const src = new DatabaseSync(LIVE, { readOnly: true });
  src.prepare('VACUUM INTO ?').run(copy); src.close();
} catch (error) {
  console.error(`تعذّر نسخ القاعدة من ${LIVE}: ${error.message}`); process.exit(2);
}
const db = new DatabaseSync(copy, { readOnly: true });
const all = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch { return null; } };
const one = (sql, ...args) => { try { return db.prepare(sql).get(...args); } catch { return null; } };
const stamp = `> مقروء من نسخة من قاعدة التشغيل عند الترحيل **${one('SELECT MAX(version) v FROM schema_migrations')?.v ?? '؟'}**. لم تُفتح القاعدة الحية.\n> أعد التوليد: \`node docs/extraction/scripts/build-ex-live.mjs\``;

/* ───── EX-06: الإدارات ───── */
function ex06() {
  const departments = all("SELECT id,name,active,sector FROM departments WHERE tenant_id='36t' ORDER BY name") ?? [];
  const rows = departments.map(d => {
    const roles = all("SELECT role,COUNT(*) n FROM users WHERE tenant_id='36t' AND department_id=? AND active=1 GROUP BY role", d.id) ?? [];
    const total = roles.reduce((n, r) => n + r.n, 0);
    const heads = one("SELECT COUNT(*) n FROM users WHERE tenant_id='36t' AND department_id=? AND active=1 AND role='manager'", d.id)?.n ?? 0;
    const escalation = one('SELECT COUNT(*) n FROM department_escalations WHERE tenant_id=? AND department_id=?', '36t', d.id)?.n;
    const noManager = one("SELECT COUNT(*) n FROM users WHERE tenant_id='36t' AND department_id=? AND active=1 AND (manager_id IS NULL OR manager_id='')", d.id)?.n ?? 0;
    return [esc(d.name), esc(d.sector) || '—', d.active ? 'نشطة' : '**موقوفة**', total,
      roles.map(r => `${r.role} ${r.n}`).join('، ') || '—', heads,
      escalation === null ? '—' : escalation, noManager];
  });
  const totals = one("SELECT COUNT(*) n FROM users WHERE tenant_id='36t' AND active=1");
  const orphan = one("SELECT COUNT(*) n FROM users WHERE tenant_id='36t' AND active=1 AND (manager_id IS NULL OR manager_id='')");
  return `# EX-06 · الإدارات وحساباتها

${stamp}

**${departments.length} إدارة · ${totals?.n ?? '؟'} حسابًا نشطًا · ${orphan?.n ?? '؟'} منها بلا مدير مسجَّل.**

${table(['الإدارة', 'القطاع', 'الحال', 'حسابات نشطة', 'بالأدوار', 'مديرون', 'مراجع تصعيد', 'بلا مدير'], rows)}

## ما يُقرأ من هذا الجدول

- **«بلا مدير»** يعني أن إشعار «يحتاج قرارك» لا يجد مستلمًا في مسار المدير المباشر.
- **«مراجع تصعيد»** صفر يعني أن الإشعار الذي لا يجد مستلمًا لا يجد سُلّمًا يصعد فيه.
- إدارة بحساب واحد نشط هي إدارة **مديرها منفّذها**، فلا يقوم فيها فصل مهام بشخصين.
`;
}

/* ───── EX-07: سياسات اللائحة ───── */
function ex07() {
  const rows = (all("SELECT kind,title,status,effective_from,based_on,decided_at FROM regulation_policies WHERE tenant_id='36t' ORDER BY kind,status") ?? [])
    .map(p => [esc(p.kind), esc(p.title), esc(p.status), esc(p.effective_from) || '—', esc(p.based_on) || '—', p.decided_at ? esc(p.decided_at).slice(0, 10) : '—']);
  const counts = all("SELECT status,COUNT(*) n FROM regulation_policies WHERE tenant_id='36t' GROUP BY status") ?? [];
  return `# EX-07 · سياسات لائحة تنظيم العمل: أنواعها وحالتها

${stamp}

**بلا قيم.** هذا التقرير يقول ما هو مسجَّل وما حالته، لا ما تقوله السياسة — القيم في المنصة نفسها، وهي المرجع.

${table(['الحال', 'العدد'], counts.map(c => [esc(c.status), c.n]))}

${table(['النوع', 'العنوان', 'الحال', 'يسري من', 'مبني على', 'قُرّر في'], rows)}

## ما يترتب على «مسودة»

سياسةٌ في حال «مسودة» **ليست قاعدةً نافذة**. والوحدات تنقسم في التعامل معها: منها ما يرفض ويسمّي السياسة الناقصة، ومنها ما يمضي بقيمة من الكود. وتمييز الاثنتين يحتاج قراءة كل وحدة على حدة، ولم يُجرَ في هذا التقرير — **فلا يُقرأ هذا الجدول على أنه يقول أي خدمة تتعطل.**
`;
}

/* ───── EX-08 + EX-09: المهل ───── */
function ex08() {
  const timers = all('SELECT timer_key,unit,value,status,basis,adopted_at FROM workflow_timer_settings ORDER BY timer_key,status') ?? [];
  const adopted = timers.filter(t => t.status === 'adopted');
  const holidays = all("SELECT status,COUNT(*) n FROM public_holidays WHERE tenant_id='36t' GROUP BY status") ?? [];
  return `# EX-08 و EX-09 · مفاتيح المهل، وحدودها

${stamp}

**${timers.length} صفًّا في \`workflow_timer_settings\`، منها ${adopted.length} متبنّى.**

${table(['المفتاح', 'الوحدة', 'القيمة', 'الحال', 'السند', 'تُبنّي في'],
  timers.map(t => [esc(t.timer_key), esc(t.unit), t.value, esc(t.status), esc(t.basis) || '—', t.adopted_at ? esc(t.adopted_at).slice(0, 10) : '—']))}

## تقويم العطل

${table(['الحال', 'العدد'], holidays.map(h => [esc(h.status), h.n]))}

## وما يعنيه هذا عمليًا

المهل تُعدّ **بأيام العمل**، وأيام العمل تُقرأ من تقويم العطل. فما لم يُعتمد التقويم، لا يقوم عدٌّ صحيح للتأخر — وهذا يسبق كل مفتاح مهلة ولا يُعوَّض عنه بتبنّي المفاتيح وحدها.

و**المفتاح المقترح لا يعمل**: السلوك يبقى كما هو حتى يُتبنّى. فعددُ المقترحات ليس قياسًا لما تفعله المنصة، بل لما ينتظر قرارًا.
`;
}

/* ───── EX-16: أعلام الميزات ───── */
function ex16() {
  const flags = all('SELECT key,description,scope,enabled,status,expires_on,retired_at FROM feature_flags ORDER BY key') ?? [];
  return `# EX-16 · أعلام الميزات

${stamp}

**${flags.length} علمًا.**

${table(['المفتاح', 'النطاق', 'مفعّل', 'الحال', 'ينتهي في', 'أُوقف في', 'الوصف'],
  flags.map(f => [esc(f.key), esc(f.scope), f.enabled ? '**نعم**' : 'لا', esc(f.status), esc(f.expires_on) || '—', f.retired_at ? esc(f.retired_at).slice(0, 10) : '—', esc(f.description).slice(0, 80)]))}

## لماذا يهمّ تاريخ الانتهاء

علمُ ميزةٍ بلا تاريخ انتهاء يصير فرعًا دائمًا في الكود: مسارَان يُصانان إلى الأبد، ويُختبر أحدهما ويُنسى الآخر. والتاريخ ليس تذكيرًا — هو التزامٌ بأن أحد المسارين سيُحذف.
`;
}

const files = [
  ['EX-06-departments.md', ex06()],
  ['EX-07-regulation-policies.md', ex07()],
  ['EX-08-09-timers.md', ex08()],
  ['EX-16-feature-flags.md', ex16()],
];
db.close(); rmSync(dir, { recursive: true, force: true });

let stale = false;
for (const [name, text] of files) {
  const path = resolve(OUT, name);
  if (process.argv.includes('--check')) {
    let current = null; try { current = readFileSync(path, 'utf8'); } catch { /* غير موجود */ }
    if (current !== text) { console.error('قديم: ' + name); stale = true; }
  } else writeFileSync(path, text);
}
if (process.argv.includes('--check')) { console.log(stale ? 'stale' : 'up to date'); process.exit(stale ? 1 : 0); }
console.log('كُتب: ' + files.map(f => f[0]).join('، '));
