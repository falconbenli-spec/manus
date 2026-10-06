// بصمة الإصدار لشجرةٍ على القرص — الوجه الآخر لـ`build` في /api/health (app/build-info.mjs).
//
//   node scripts/build-fingerprint.mjs            بصمة الشجرة التي يُشغَّل منها
//   node scripts/build-fingerprint.mjs <مجلد>     بصمة شجرةٍ أخرى (مجلد التشغيل مثلًا)
//
// التحقق من أن العملية الجارية تخدم التزامًا بعينه: استخرج الالتزام في شجرة نظيفة، وشغّل هذا الأمر عليها،
// وقارن source_digest بما تعيده /api/health. التطابق يعني أن ما حُمِّل هو الالتزام حرفًا؛ والاختلاف يعني أن
// في مجلد التشغيل ما ليس في الالتزام (تعديلٌ لم يُلتزم، أو ملفٌّ أُضيف). المخرج JSON بلا مسار.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfo } from '../app/build-info.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
  const { commit, source_digest, files } = buildInfo(root);
  console.log(JSON.stringify({ commit, source_digest, files }, null, 1));
}
