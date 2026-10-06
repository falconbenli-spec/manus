// TP2.6 — الرصد الأولي: سطر واحد لكل طلب، ونقطة صحة محلية.
//
// ما يُرصد وما لا يُرصد. السطر يحمل ما يُشخَّص به تباطؤٌ أو عطل: المسار، والرمز، والمدة، وانتظار
// قفل الكتابة. **ولا يحمل حمولة، ولا قيم استعلام، ولا اسمًا، ولا معرّف مستخدم.** والسبب أن السجل
// يُقرأ ويُنسخ ويُرسَل حين يُشخَّص عطل، فما وُضع فيه خرج من حدود المنصة — والسجل لا يُنقَّح كما تُنقَّح
// قاعدة. ومعرّف الطلب يُكتب لأنه معرّف كيان في المنصة لا بيان شخص، وبه تُربط الأسطر بسجل التدقيق.
//
// وحدة طرفية بلا واردات من المنصة.
import { statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// المسار بلا قيم الاستعلام: «?q=اسم الموظف» بيانٌ شخصي يصل السجل من حيث لا يُحتسب.
export const scrubPath = url => String(url ?? '').split('?')[0].slice(0, 300);

export function requestLine({ id, method, path, status, ms, metrics = null, env = 'local', at }) {
  const line = { t: at, id, env, m: method, p: scrubPath(path), s: status, ms: Math.round(ms) };
  if (metrics?.transactions) { line.tx = metrics.transactions; line.lock_ms = metrics.lock_wait_ms; }
  return JSON.stringify(line);
}

// عمر آخر نسخة احتياطية: الرقم الذي يقول إن النسخ توقف، وهو أهم ما في الصحة عمليًا.
export function newestBackupAge(dirs, { now = Date.now() } = {}) {
  let newest = null;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { const inner = newestBackupAge([path], { now }); if (inner.at && (!newest || inner.at > newest)) newest = inner.at; continue; }
      if (!entry.name.endsWith('.sqlite')) continue;
      const at = statSync(path).mtimeMs;
      if (!newest || at > newest) newest = at;
    }
  }
  return { at: newest, hours: newest === null ? null : Math.round((now - newest) / 36e5) };
}

// لقطة الصحة. `auditChecked` يُمرَّر لا يُحسب هنا: التحقق يمشي سجل التدقيق كله، فيُشغَّل عند الإقلاع
// وعند الطلب الصريح، ولا يُعاد في كل نداء صحة — نقطةُ صحةٍ تُثقل المنصة ليست صحة.
// build: بصمة الإصدار المحسوبة عند الإقلاع (app/build-info.mjs) — الالتزام وبصمة الملفات المحمّلة، بلا مسار.
export function healthSnapshot({ migration, schemaDigest, auditChecked, environment, backupDirs = [], now = Date.now(), startedAt, build = null }) {
  const backup = newestBackupAge(backupDirs, { now });
  return {
    environment: environment.key,
    migration,
    schema_digest: schemaDigest ?? null,
    audit_chain: auditChecked ? { ok: auditChecked.ok, checked_at: auditChecked.at } : null,
    backup: { newest_at: backup.at ? new Date(backup.at).toISOString() : null, age_hours: backup.hours },
    uptime_seconds: startedAt ? Math.round((now - startedAt) / 1000) : null,
    node: process.versions.node,
    build: build ? { commit: build.commit ?? null, source_digest: build.source_digest, files: build.files, computed_at: build.computed_at } : null,
  };
}
