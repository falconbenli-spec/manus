// عاملٌ لسباق التحصيل (tests/receivables-settlement.test.mjs وحدها): عملية مستقلة باتصال خاص بها على ملف القاعدة نفسه،
// فيتنافس طلبا العكس أو قرارا الاعتماد أو تخصيصان من القبض نفسه على قفل الكاتب فعلًا — داخل عملية واحدة يتشاركان
// الاتصال فلا تنافس أصلًا. تطبع سطر JSON واحدًا وتخرج. كل البيانات مصطنعة في قاعدة مؤقتة.
//
//   node tests/receivables-settlement-worker.mjs <قاعدة> <الفعل> <الحساب> <وسائط JSON> <موعد البدء ms>
import { openDb, transaction } from '../app/db.mjs';
import * as receivables from '../app/receivables.mjs';

const [path, operation, userId, argsText, startAtText] = process.argv.slice(2);
const args = JSON.parse(argsText);
// البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الثانية ولا يقع تنافس.
while (Date.now() < Number(startAtText)) { /* انتظار نشط مقصود: النوم يخسر دقة الموعد */ }

const out = { operation, user: userId };
let db = null;
try {
  db = openDb(path);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const run = {
    request_reversal: () => receivables.requestReceiptReversal(db, user, args.claim_id, args.receipt_id, args.input),
    approve_reversal: () => receivables.decideAdjustment(db, user, args.claim_id, args.adjustment_id, 'approve', args.input),
    allocate: () => receivables.allocateReceipt(db, user, args.account_receipt_id, args.input)
  }[operation];
  if (!run) throw Object.assign(new Error('unknown operation'), { code: 'unknown_operation' });
  const result = transaction(db, run);
  out.ok = true; out.id = result?.id ?? null;
} catch (error) {
  // خطأ SQLite يُطبع نصه: «ERR_SQLITE_ERROR» وحده لا يقول أهو قفلٌ انتظر أم قيدٌ رفض.
  out.ok = false; out.error = error.code ?? error.message;
  if (error.code === 'ERR_SQLITE_ERROR') out.detail = `${error.errcode ?? ''} ${error.errstr ?? ''} ${error.message}`.trim();
} finally { db?.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
