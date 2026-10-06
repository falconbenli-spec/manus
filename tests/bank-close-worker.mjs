// عاملٌ لسباقَي الحزمة 3 في المطابقة والإقفال (tests/bank-close-race.test.mjs وحدها): عملية مستقلة باتصال DatabaseSync خاص بها على
// الملف نفسه، فيتنافس الكاتبان على قفل الكاتب فعلًا — داخل عملية واحدة يتشاركان الاتصال فلا تنافس أصلًا. تطبع سطر JSON وتخرج.
//
//   node tests/bank-close-worker.mjs <قاعدة> journal <نوع المستند> <معرّفه> <الفترة المحاسبية> <المستخدم> <موعد البدء ms>
//   node tests/bank-close-worker.mjs <قاعدة> approve_reopen <فترة الإقفال> <النسخة> - <المستخدم> <موعد البدء ms>
import { openDb, transaction } from '../app/db.mjs';
import { journalFromSource } from '../app/ledger.mjs';
import { periodAction } from '../app/close-checklist.mjs';

const [path, op, first, second, third, userId, startAtText] = process.argv.slice(2);
// البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الثانية ولا يقع تنافس.
while (Date.now() < Number(startAtText)) { /* انتظار نشط مقصود: النوم يخسر دقة الموعد */ }

const out = { op, user: userId };
let db = null;
try {
  db = openDb(path);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (op === 'journal') out.id = transaction(db, () => journalFromSource(db, user, { source_kind: first, source_id: second, period_id: third }).id);
  else if (op === 'approve_reopen') out.id = transaction(db, () => periodAction(db, user, first, 'approve_reopen', { version: Number(second), note: `قرار فتح مصطنع من ${userId} في سباق العمليتين` }).id);
  else throw new Error(`unknown op ${op}`);
  out.ok = true;
} catch (error) {
  // خطأ SQLite يُطبع نصه ورمزه: «ERR_SQLITE_ERROR» وحده لا يقول أهو قفلٌ انتظر أم قيدٌ رفض.
  out.ok = false; out.error = error.code ?? error.message;
  if (error.code === 'ERR_SQLITE_ERROR') out.detail = `${error.errcode ?? ''} ${error.errstr ?? ''} ${error.message}`.trim();
} finally { db?.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
