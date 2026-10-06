// بصمة الإصدار — عقد تنفيذ 30 سبتمبر 2026، الحزمة 1 البند 5: «أضف بصمة إصدار آمنة إلى استجابة الصحة
// حتى تُثبت العمليةُ الجارية الالتزامَ الذي تخدمه، بلا مسارات ولا أسرار ولا قيم بيئة».
//
// لماذا شيئان لا شيء واحد:
//   commit          ما يقوله git عن مجلد التشغيل: التزامٌ بعينه (40 حرفًا ستّ‌عشريًا لا غير).
//   source_digest   ما حُمِّل فعلًا: SHA-256 على مسارات ملفات app/ النسبية ومحتواها، بترتيبٍ ثابت.
// الالتزام وحده يكذب حين في المجلد تعديلٌ لم يُلتزم — والمالك يعدّل مجلد التشغيل نفسه من Codex أحيانًا،
// فرقمُ الالتزام يبقى كما هو والكود الجاري غيره. والبصمة تكشف ذلك: تُحسب للالتزام نفسه على شجرةٍ نظيفة
// بـ`node scripts/build-fingerprint.mjs`، فإن طابقت بصمةَ العملية الجارية فالعملية تخدم الالتزام حرفًا،
// وإن خالفتها ففي المجلد ما ليس في الالتزام. لا ادّعاء «نظيف» يُبنى على قراءة git وحدها.
//
// بلا تبعيات ولا تشغيل عمليات: git لا يُستدعى. تُقرأ ملفات .git نفسها (HEAD، ثم المرجع السائب أو packed-refs،
// عبر commondir في شجرة العمل)، وأي تعذّر يعيد commit:null لا خطأً — نقطة الصحة لا تسقط لأن .git غاب.
// ولا يخرج من هنا مسار: المخرجات حروف ستّ‌عشرية وعدد ووقت، وtests/build-fingerprint.test.mjs يحرس ذلك.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';

const SHA = /^[0-9a-f]{40}$/;
// الملفات التي يحمّلها الخادم أو يخدمها للمتصفح: الكود والترحيلات والأنماط والصفحة وما يُقرأ من JSON.
const SERVED = /\.(?:mjs|js|sql|css|html|json|svg|webmanifest)$/;

const readText = path => { try { return readFileSync(path, 'utf8'); } catch { return null; } };

// دليل git لشجرة العمل: `.git` مجلدٌ في المستودع الرئيسي، وملفٌّ فيه «gitdir: …» في شجرة عمل مضافة.
function gitDirOf(root) {
  const dotGit = join(root, '.git');
  let stat;
  try { stat = statSync(dotGit); } catch { return null; }
  if (stat.isDirectory()) return dotGit;
  const pointer = readText(dotGit)?.match(/^gitdir:\s*(.+)\s*$/m)?.[1];
  if (!pointer) return null;
  return isAbsolute(pointer) ? pointer : resolve(root, pointer);
}

// المراجع في شجرة عمل مضافة تسكن الدليل المشترك (commondir)، وHEAD وحده في دليل الشجرة.
function commonDirOf(gitDir) {
  const pointer = readText(join(gitDir, 'commondir'))?.trim();
  if (!pointer) return gitDir;
  return isAbsolute(pointer) ? pointer : resolve(gitDir, pointer);
}

function resolveRef(gitDir, ref) {
  // المرجع اسمٌ تحت refs/ لا غير: لا يُتبع مسارٌ يخرج من دليل git.
  if (!/^refs\/[A-Za-z0-9._\/-]+$/.test(ref) || ref.includes('..')) return null;
  for (const dir of [gitDir, commonDirOf(gitDir)]) {
    const loose = readText(join(dir, ...ref.split('/')))?.trim();
    if (loose && SHA.test(loose)) return loose;
  }
  const packed = readText(join(commonDirOf(gitDir), 'packed-refs'));
  if (packed) for (const line of packed.split('\n')) {
    const [sha, name] = line.trim().split(' ');
    if (name === ref && SHA.test(sha ?? '')) return sha;
  }
  return null;
}

export function readCommit(root) {
  const gitDir = gitDirOf(root);
  if (!gitDir) return null;
  const head = readText(join(gitDir, 'HEAD'))?.trim();
  if (!head) return null;
  if (SHA.test(head)) return head; // HEAD منفصل: الالتزام نفسه مكتوب فيه
  const ref = head.match(/^ref:\s*(\S+)$/)?.[1];
  return ref ? resolveRef(gitDir, ref) : null;
}

function servedFiles(dir, base, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) servedFiles(path, base, out);
    else if (entry.isFile() && SERVED.test(entry.name)) out.push(relative(base, path).split(sep).join('/'));
  }
  return out;
}

// SHA-256 على «المسار النسبي، صفر، المحتوى، صفر» لكل ملف بترتيب المسارات. المسار داخلٌ في البصمة
// فنقلُ ملف أو إعادة تسميته يغيّرها، والصفر فاصلٌ لا يقع في مسار فلا يلتبس ملفان بملف.
export function sourceDigest(root) {
  const files = servedFiles(join(root, 'app'), root, []).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file); hash.update('\0');
    hash.update(readFileSync(join(root, ...file.split('/')))); hash.update('\0');
  }
  return { digest: hash.digest('hex'), files: files.length };
}

// تُحسب مرة عند الإقلاع: الملفات لا تتغير تحت عملية جارية إلا بإعادة تشغيل، وحسابها لكل طلب ثقلٌ بلا فائدة.
export function buildInfo(root, { now = () => new Date() } = {}) {
  const { digest, files } = sourceDigest(root);
  return { commit: readCommit(root), source_digest: digest, files, computed_at: now().toISOString() };
}
