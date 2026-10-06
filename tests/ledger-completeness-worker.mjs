// عاملٌ لسباق الترحيل (tests/ledger-completeness.test.mjs وحدها): عملية مستقلة باتصال DatabaseSync خاص بها على الملف نفسه،
// فيتنافس إعداد القيد من المستند نفسه على قفل الكاتب فعلًا — داخل عملية واحدة يتشاركان الاتصال فلا تنافس أصلًا.
// تطبع سطر JSON واحدًا وتخرج.
//
//   node tests/ledger-completeness-worker.mjs <قاعدة> <نوع المستند> <معرّفه> <الفترة> <موعد البدء ms>
import { openDb, transaction } from '../app/db.mjs';
import { journalFromSource } from '../app/ledger.mjs';

const [path, kind, sourceId, periodId, startAtText] = process.argv.slice(2);
// البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الثانية ولا يقع تنافس.
while (Date.now() < Number(startAtText)) { /* انتظار نشط مقصود: النوم يخسر دقة الموعد */ }

const out = { kind, source_id: sourceId };
let db = null;
try {
  db = openDb(path);
  const user = db.prepare("SELECT * FROM users WHERE id='employee'").get();
  out.journal_id = transaction(db, () => journalFromSource(db, user, { source_kind: kind, source_id: sourceId, period_id: periodId }).id);
  out.ok = true;
} catch (error) {
  // خطأ SQLite يُطبع نصه ورمزه: «ERR_SQLITE_ERROR» وحده لا يقول أهو قفلٌ انتظر أم قيدٌ رفض.
  out.ok = false; out.error = error.code ?? error.message;
  if (error.code === 'ERR_SQLITE_ERROR') out.detail = `${error.errcode ?? ''} ${error.errstr ?? ''} ${error.message}`.trim();
} finally { db?.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
