// عاملٌ لسباق أمر المباشرة (tests/supplier-commencement.test.mjs وحدها): عملية مستقلة باتصال DatabaseSync خاص بها
// على الملف نفسه، فيتنافس الاستلام والسحب على قفل الكاتب فعلًا — داخل عملية واحدة يتشاركان الاتصال فلا تنافس أصلًا.
// تطبع سطر JSON واحدًا وتخرج.
//
//   node tests/supplier-commencement-worker.mjs <قاعدة> <receive|withdraw> <طلب الشراء> <موعد البدء ms> <fresh|same> <النسخة>
//
// fresh: تقرأ نسخة الطلب داخل المعاملة نفسها — أسوأ الحالات للبوابة، لأن قفل النسخة لا يحميها، فتبقى البوابة وحدها.
// same : تستعمل النسخة التي قُرئت قبل السباق — شاشتان فُتحتا على النسخة نفسها.
import { openDb, transaction } from '../app/db.mjs';
import { procurementAction } from '../app/procurement.mjs';

const [path, job, purchaseId, startAtText, mode, versionText] = process.argv.slice(2);
// البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
while (Date.now() < Number(startAtText)) { /* انتظار نشط مقصود: النوم يخسر دقة الموعد */ }

const out = { job, purchase_id: purchaseId };
let db = null;
try {
  db = openDb(path);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(job === 'withdraw' ? 'manager' : 'employee');
  out.version = transaction(db, () => {
    const version = mode === 'fresh' ? db.prepare('SELECT version FROM procurement_purchases WHERE id=?').get(purchaseId).version : Number(versionText);
    const input = job === 'withdraw'
      ? { version, reason: 'أوقفنا المورد لمراجعة النطاق قبل أي تسليم جديد', evidence: 'خطاب إيقاف مصطنع مرسل للمورد في السباق' }
      : { version, quantity: 1, reference: 'RACE-' + purchaseId.slice(0, 8), evidence: 'محضر استلام مصطنع في السباق' };
    return procurementAction(db, user, purchaseId, job === 'withdraw' ? 'withdraw_commencement' : 'receive', input).version;
  });
  out.ok = true;
} catch (error) {
  // خطأ SQLite يُطبع نصه ورمزه: «ERR_SQLITE_ERROR» وحده لا يقول أهو قفلٌ انتظر أم مُطلِقٌ رفض.
  out.ok = false; out.error = error.code ?? error.message;
  if (error.code === 'ERR_SQLITE_ERROR') out.detail = `${error.errcode ?? ''} ${error.errstr ?? ''} ${error.message}`.trim();
} finally { db?.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
