// TP2.4 — تجهيز بيئة التجهيز.  node scripts/setup-staging.mjs
//
// تبني `work/staging/` كاملًا: قاعدة نظيفة من الترحيلات وحدها، وحساب أدمن واحد بكلمة مرور مؤقتة،
// ومفتاح حقول خاص بها يُنشأ عند أول استعمال. ولا تلمس التشغيل: المسارات كلها مشتقّة من البيئة المسمّاة،
// و`resolveEnvironment` ترفض أي مسار خارج مجلد التجهيز قبل أن يُفتح شيء.
//
// التشغيل بعدها:  ENV=staging npm start      (المنفذ 3620، ولا يتصادم مع 3600)
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment } from '../app/environment.mjs';
import { initPilot } from './init-pilot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function setupStaging({ root = ROOT, force = false, password = randomBytes(18).toString('base64url') } = {}) {
  // البيئة تُحلّ أولًا: حلُّها هو الحارس. مسارٌ خارج مجلد التجهيز يُرفض هنا قبل أن يُنشأ ملف.
  const env = resolveEnvironment({ ENV: 'staging' }, { root });
  if (existsSync(env.dbPath)) {
    if (!force) throw new Error(
      `قاعدة التجهيز قائمة: ${env.dbPath}\n` +
      '  لن أكتب فوقها. احذفها بنفسك إن أردت بناءها من جديد، أو مرّر --force.');
    rmSync(env.dbPath, { force: true });
    for (const suffix of ['-wal', '-shm']) rmSync(env.dbPath + suffix, { force: true });
  }
  mkdirSync(env.dir, { recursive: true, mode: 0o700 });
  mkdirSync(join(env.dir, 'keys'), { recursive: true, mode: 0o700 });
  // مفتاح الحقول يُنشئه crypto-fields عند أول استعمال في مساره؛ لا يُولَّد هنا ولا يُطبع.
  const summary = initPilot(env.dbPath, password);
  chmodSync(env.dbPath, 0o600);
  const credentials = join(env.dir, 'credentials.txt');
  writeFileSync(credentials,
    `بيئة التجهيز (ENV=staging)\nالقاعدة: ${env.dbPath}\nمفتاح الحقول: ${env.keyPath}\n` +
    `المنفذ: ${env.port}\nالمستخدم: admin\nكلمة المرور المؤقتة: ${password}\n` +
    'تُطلب تغييرها عند أول دخول. احذف هذا الملف بعدها.\nبيانات اصطناعية — ليست بيانات الشركة.\n',
    { mode: 0o600 });
  chmodSync(credentials, 0o600);
  return { ...summary, environment: env.key, dir: env.dir, keyPath: env.keyPath, port: env.port, credentials };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = setupStaging({ force: process.argv.includes('--force') });
  console.log(`بيئة التجهيز جاهزة في ${summary.dir}`);
  console.log(`  ${summary.departments} إدارة · ${summary.services} خدمة · ${summary.active_users} حساب نشط (admin) · سلسلة التدقيق ${summary.audit_ok}`);
  console.log(`  كلمة المرور المؤقتة في ${summary.credentials} بصلاحية 600 — لم تُطبع هنا.`);
  console.log(`\nالتشغيل:  ENV=staging npm start      ← http://127.0.0.1:${summary.port}`);
  console.log('نقل التعريفات من التشغيل إليها:  node scripts/definitions-transfer.mjs export/check/apply');
}
