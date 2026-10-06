// يفحص حزمة تدقيق فترة مالية نزلت من المنصة (رابط «حزمة تدقيق الفترة» في شاشة «الاستثناءات المالية»، أو GET /api/audit-export) بلا المنصة
// ولا قاعدتها: بصمة الحزمة كلها، وتسلسل أحداث سجل التدقيق واتصال بصماتها، وبصمة كل حدث محمول بمحتواه، وتوازن كل قيد وميزان
// المراجعة. القواعد نفسها التي يفحص بها اختبار tests/audit-export.test.mjs (verifyAuditPackage في app/audit-export.mjs).
//
//   node scripts/verify-audit-package.mjs audit-36t-2026-09-01-2026-09-30.json
//
// يخرج بصفر إن سلمت الحزمة، وبواحد مع سطر لكل مشكلة إن ما سلمت، وباثنين إن ما انقرأ الملف.
import { readFileSync } from 'node:fs';
import { verifyAuditPackage } from '../app/audit-export.mjs';

const file = process.argv[2];
let pkg;
try {
  if (!file) throw new Error('no file given');
  pkg = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`ما انقرأت الحزمة: ${error.message}\nUsage: node scripts/verify-audit-package.mjs <audit-package.json>`);
  process.exit(2);
}
const { ok, problems, checked } = verifyAuditPackage(pkg);
const scope = pkg.scope ? ` للفترة ${pkg.scope.from} ← ${pkg.scope.to}` : '';
if (ok) {
  console.log(`الحزمة سليمة${scope}: ${checked.events} حدث في السلسلة (${checked.full_events} بمحتواه)، و${checked.journals} قيد متوازن، و${checked.documents} مستند، والبصمة تطابق.`);
  console.log(`Package verified: ${checked.events} chain events (${checked.full_events} carried in full), ${checked.journals} balanced journals, ${checked.documents} documents, digest ${pkg.digest}.`);
  process.exit(0);
}
console.log(`الحزمة ما سلمت${scope} — ${problems.length} مشكلة:`);
for (const problem of problems) console.log(`  ✖ ${problem}`);
process.exit(1);
