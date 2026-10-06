// عاملٌ لسباق تحويل الفرصة إلى صفقة: عملية مستقلة، باتصال DatabaseSync خاص بها، على ملف القاعدة نفسه.
// يُنادى من tests/crm-won-to-project.test.mjs وحده. يطبع سطر JSON واحدًا ويخرج.
//
// لماذا عمليات لا نداءات في عملية واحدة: الاتصال الواحد لا يتنافس مع نفسه على قفل الكاتب، فيمرّ اختبار لا يقيس شيئًا
// (السبب نفسه في tests/payment-release-worker.mjs). والنسخة تُقرأ قبل الموعد المشترك كما يقرؤها متصفح حقيقي.
//
//   node tests/crm-conversion-worker.mjs <قاعدة> <متى يبدأ (ms منذ الحقبة)> <JSON: user,opportunity_id,version,key?>
import { openDb, transaction } from '../app/db.mjs';
import { createOnce } from '../app/idempotency.mjs';
import * as commercial from '../app/commercial.mjs';

const [path, startAtText, jobText] = process.argv.slice(2);
const job = JSON.parse(jobText), startAt = Number(startAtText);
const db = openDb(path);
const out = { index: job.index };
try {
  const user = db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t'").get(job.user);
  const input = { version: job.version };
  while (Date.now() < startAt) { /* انتظار نشط مقصود: النوم يخسر دقة الموعد المشترك */ }
  const result = transaction(db, () => {
    const create = () => commercial.createCaseFromOpportunity(db, user, job.opportunity_id, input);
    // بمفتاح التكرار: ما يفعله الخادم بالضبط (createOnce بمسار الطلب عملية). بلاه: نداءان مستقلان من شاشتين.
    return job.key ? createOnce(db, user, `/api/pipeline/opportunities/${job.opportunity_id}/open_case`, job.key, input, create, id => ({ id })) : create();
  });
  out.ok = true; out.id = result.id;
} catch (error) {
  out.ok = false; out.error = error.code ?? error.message;
} finally { db.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
