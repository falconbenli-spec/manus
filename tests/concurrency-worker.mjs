// عاملٌ لحزام التزامن (TP2.2): عملية مستقلة، اتصال `DatabaseSync` خاص بها، على الملف نفسه.
// تُنادى من tests/concurrency.test.mjs وحدها. تطبع سطر JSON واحدًا وتخرج.
//
//   node tests/concurrency-worker.mjs <قاعدة> <المهمة> <الرقم> <متى يبدأ (ms منذ الحقبة)>
import { openDb, transaction } from '../app/db.mjs';

const [path, job, indexText, startAtText] = process.argv.slice(2);
const index = Number(indexText), startAt = Number(startAtText);

// البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
while (Date.now() < startAt) { /* انتظار نشط، وهو هنا مقصود: النوم يخسر دقة الموعد */ }

const db = openDb(path);
const out = { index, job };
try {
  if (job === 'client-code') {
    out.value = transaction(db, () => {
      const next = db.prepare("SELECT COALESCE(MAX(CAST(substr(code,3) AS INTEGER)),0)+1 AS n FROM clients WHERE tenant_id='36t'").get().n;
      const code = 'C-' + String(next).padStart(4, '0');
      db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,sector,status,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(`client-${index}`, '36t', code, `عميل تجريبي ${index}`, 'other', 'active', 'admin', new Date().toISOString(), new Date().toISOString());
      return code;
    });
  } else if (job === 'no-transaction') {
    // النسخة بلا معاملة: تُبيّن أن الحماية من `BEGIN IMMEDIATE` لا من `MAX+1` وحدها.
    const next = db.prepare("SELECT COALESCE(MAX(CAST(substr(code,3) AS INTEGER)),0)+1 AS n FROM clients WHERE tenant_id='36t'").get().n;
    const code = 'C-' + String(next).padStart(4, '0');
    // مهلة مقصودة بين القراءة والكتابة: تفتح النافذة التي يغلقها القفل.
    const until = Date.now() + 40; while (Date.now() < until);
    db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,sector,status,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(`client-${index}`, '36t', code, `عميل تجريبي ${index}`, 'other', 'active', 'admin', new Date().toISOString(), new Date().toISOString());
    out.value = code;
  } else throw new Error('مهمة غير معروفة: ' + job);
  out.ok = true;
} catch (error) {
  out.ok = false; out.error = error.code ?? error.message;
} finally { db.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
