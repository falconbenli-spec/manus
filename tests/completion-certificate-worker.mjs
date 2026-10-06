// عاملٌ لسباق ترقيم شهادة الإنجاز: عملية مستقلة، اتصال DatabaseSync خاص بها، على الملف نفسه.
// يُنادى من tests/completion-certificate.test.mjs وحده. يطبع سطر JSON واحدًا ويخرج.
//
// لماذا عمليات لا نداءات في عملية واحدة: الاتصال الواحد لا يتنافس مع نفسه على قفل الكاتب، فيمرّ اختبارٌ لا يقيس شيئًا
// (السبب نفسه في tests/concurrency.test.mjs). وملف عامل مستقل حتى لا يُمسّ عامل الحزام المشترك.
//
//   node tests/completion-certificate-worker.mjs <قاعدة> <المشروع> <المفوّض> <الرقم> <متى يبدأ (ms منذ الحقبة)>
import { openDb, transaction } from '../app/db.mjs';
import { issueCompletionCertificate } from '../app/completion-certificates.mjs';

const [path, projectId, approverId, indexText, startAtText] = process.argv.slice(2);
const index = Number(indexText), startAt = Number(startAtText);

// البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
const db = openDb(path);
while (Date.now() < startAt) { /* انتظار نشط مقصود: النوم يخسر دقة الموعد */ }
const out = { index, project_id: projectId };
try {
  const issuer = db.prepare("SELECT * FROM users WHERE id='manager' AND tenant_id='36t'").get();
  const certificate = transaction(db, () => issueCompletionCertificate(db, issuer, projectId, {
    scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود اتفاق السباق', approver_id: approverId, evidence: 'تقرير إنجاز مصطنع لسباق الترقيم' }));
  out.ok = true; out.number = certificate.number; out.sequence = certificate.sequence;
} catch (error) {
  out.ok = false; out.error = error.code ?? error.message;
} finally { db.close(); }
process.stdout.write(JSON.stringify(out) + '\n');
