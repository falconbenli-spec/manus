import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { viewingAs, noteLockWait} from './request-context.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();

// خطة الترحيل: الملفات كما ستُطبَّق، ورفضُ ما لا يُطبَّق بصمت.
//
// كان الاختيار مرشّحًا داخل حلقة openDb، فترتّب عليه صمتان (قِيسا لا استُنتجا —
// docs/testing/migration-plan-20260929.json): ملفٌ لا يطابق المرشّح لا يُطبَّق أبدًا ولا يقول أحد ذلك
// (جرّبناه بـ«003b-hotfix.sql»: جلس ولم يُطبَّق ولم يُذكر)؛ ورقمٌ مكرَّر يُطبَّق أوّلُه ويُسجَّل ثم يُرمى
// «Applied migration changed» باسم الملف الثاني — فتبقى القاعدة مُرحَّلة نصفَ ترحيل ولا تقلع،
// والرسالة تسمّي السبب الخطأ: لم يتغيّر ترحيلٌ مطبَّق، بل تقاسم ملفان رقمًا.
//
// فالخطة تُبنى كاملةً وتُرفض كاملةً **قبل** أن يُطبَّق ترحيل واحد، فلا حالة نصفية. وتُجمع كل العلل في
// رسالة واحدة ليصلحها القارئ دفعةً لا واحدةً في كل إقلاع.
//
// والحدّ: ملفُ .sql في مجلد الترحيلات يُقصد به أن يُطبَّق، فتعذّر قراءته خطأ؛ وما ليس .sql ليس ترحيلًا
// أصلًا فلا يُسأل عنه — وإلا لأسقط ملفٌ مثل .DS_Store الخدمةَ على جهاز المالك.
export function migrationPlan(names){
  const plan=[],seen=new Map(),problems=[];
  for(const file of [...names].sort()){
    if(!file.endsWith('.sql'))continue;
    const parsed=/^(\d{3})-(.+)\.sql$/.exec(file);
    if(!parsed){problems.push(`unreadable migration name: ${file} — a migration must be NNN-name.sql with exactly three digits, or it is never applied`);continue;}
    const version=Number(parsed[1]),earlier=seen.get(version);
    if(earlier!==undefined){problems.push(`duplicate migration number ${parsed[1]}: ${earlier} and ${file} — renumber one of them above the highest number already applied`);continue;}
    seen.set(version,file);plan.push({version,file});
  }
  if(problems.length)throw new Error('Migrations cannot be applied; nothing was migrated:\n  '+problems.join('\n  '));
  return plan.sort((a,b)=>a.version-b.version);
}

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // مهلة الانتظار تُضبط مع الاتصال نفسه، قبل أي عبارة: كان journal_mode=WAL يسبق busy_timeout، فالفتح أثناء قفل عمليةٍ
  // أخرى أو استعادتها فهرس السجل يسقط فورًا بـ«database is locked» (SQLITE_BUSY_RECOVERY) بدل أن ينتظر.
  // tests/db-open-busy.test.mjs يعيد إنتاجه بلا حظ.
  const db = new DatabaseSync(path, { timeout: 5000 });
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  const applied = db.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get();
  if (applied && applied.checksum !== hash(schema)) throw new Error('Schema changed. Add a migration; do not rewrite an applied schema.');
  if (!applied) transaction(db, () => {
    db.exec(schema);
    db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  });
  for(const {version,file} of migrationPlan(readdirSync(new URL('./migrations/',import.meta.url)))) {
    const sql=readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8');
    const migration=db.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(version);
    if(migration&&migration.checksum!==hash(sql)) throw new Error('Applied migration changed: '+file);
    if(!migration) transaction(db,()=>{
      db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));
    });
  }
  return db;
}

export function transaction(db, run) {
  // زمن الحجز وحده يُقاس، لا زمن العمل: هو انتظار كاتبٍ آخر، وهو ما يسبق كل تباطؤ في قاعدة بملف واحد.
  const waited = Date.now();
  db.exec('BEGIN IMMEDIATE');
  noteLockWait(Date.now() - waited);
  try { const value = run(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function audit(db, user, type, id, action, before = {}, after = {}, reason = '') {
  // «جرّب كمستخدم»: حدثٌ يُكتب أثناء التجربة (تنزيل، تصدير، بدء التجربة وإنهاؤها) يبقى باسم صاحبه الحقيقي ويحمل الدور الذي كان يجرّبه.
  const run = viewingAs(user);
  if (run && after && typeof after === 'object' && !Array.isArray(after)) after = {...after, view_as: run.persona};
  const previous = db.prepare('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1').get()?.hash ?? '';
  const values = [user.tenant_id, user.id, type, id, action, JSON.stringify(before), JSON.stringify(after), reason, now(), 'local-policy-v1', previous];
  db.prepare('INSERT INTO audit_events(tenant_id,actor_id,entity_type,entity_id,action,before_json,after_json,reason,created_at,policy_version,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...values, hash(JSON.stringify(values)));
}

export function verifyAudit(db) {
  let previous = '';
  for (const r of db.prepare('SELECT * FROM audit_events ORDER BY seq').all()) {
    const values = [r.tenant_id,r.actor_id,r.entity_type,r.entity_id,r.action,r.before_json,r.after_json,r.reason,r.created_at,r.policy_version,r.previous_hash];
    if (r.previous_hash !== previous || hash(JSON.stringify(values)) !== r.hash) return false;
    previous = r.hash;
  }
  return true;
}
