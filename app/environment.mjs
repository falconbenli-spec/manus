// TP2.4 — البيئة المسمّاة: التشغيل والتجهيز.
//
// قبل هذا كانت البيئة أربعة متغيرات منفصلة (القاعدة، والمفتاح، والمنفذ، والمجلد) يضبطها من يشغّل واحدًا
// واحدًا. ونصفُ تبديلٍ أسوأ من لا تبديل: تجهيزٌ يكتب في قاعدة التشغيل، أو تجهيزٌ يفكّ حقولًا بمفتاح التشغيل
// فيصير المفتاح الحيّ في يد بيئة تجريبية. هنا تُسمّى البيئة مرة، ويُشتقّ منها الباقي، ويُرفض أي عبورٍ بينهما.
//
// وحدة طرفية بلا واردات من المنصة، فتُحمَّل وحدها ولا تدخل في دورة استيراد.
import { existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';

export class EnvironmentError extends Error {
  constructor(message){super(message);this.name='EnvironmentError';}
}

export const ENVIRONMENTS = {
  // التشغيل بلا قاعدة افتراضية عمدًا: على جهاز المالك ملفُّ `work/local.sqlite` قائمٌ بجانب قاعدة التشغيل،
  // فاشتقاق مسارٍ هنا يعيد بعينه العطب الذي أُغلق في م1 — إقلاعٌ ناجح على القاعدة الخطأ. يُسمّى المسار صراحةً.
  local:   { name: 'التشغيل', dir: 'work',         db: null,                         port: 3600 },
  // والتجهيز قاعدته من صنع هذه الأدوات وملكها، فاشتقاقها صريحٌ لا صامت.
  staging: { name: 'التجهيز', dir: 'work/staging', db: 'work/staging/staging.sqlite', port: 3620 },
};

export const DEFAULT_ENV = 'local';

// قاعدة التشغيل الحية ومجلدها: لا تُفتح من التجهيز بحال. (فتح قاعدة يطبّق عليها الترحيلات، فهو كتابة دائمًا.)
export const isLivePath = path =>
  /^hr-design-preview-.*\.sqlite$/.test(basename(path)) || resolve(path).split('/').includes('3-6t-live');

export function resolveEnvironment(env = process.env, { root = process.cwd() } = {}) {
  const key = String(env.ENV ?? '').trim() || DEFAULT_ENV;
  const spec = ENVIRONMENTS[key];
  if (!spec) throw new EnvironmentError(
    `ENV=${key} ليست بيئة معروفة. المعروف: ${Object.keys(ENVIRONMENTS).join('، ')}.`);

  const dir = resolve(root, spec.dir);
  // الفارغ — ولو كان فراغات — يعني «غير مضبوط» لا مسارًا اسمه فراغ، كما في LOCAL_BIND_HOST وPORT.
  const given = name => String(env[name] ?? '').trim() || null;
  const dbPath = given('LOCAL_DB_PATH') ? resolve(root, given('LOCAL_DB_PATH')) : (spec.db ? resolve(root, spec.db) : null);
  // المفتاح يتبع البيانات التي يختمها، لا الكود الذي يقرؤها.
  //
  // كان يُشتقّ من مجلد الكود (`<نسخة العمل>/work/keys/field.key`). وهذا صحيح ما دام الكود والقاعدة في
  // مجلد واحد، ويكذب حين يفترقان — وهما مفترقان في التشغيل: الخدمة تعمل من `3-6t-live` والقاعدة في
  // المجلد الرئيسي. فكانت الخدمة تبحث عن المفتاح في مجلدها ولا تجده، والقيمة المختومة في القاعدة
  // مختومةٌ بمفتاح المجلد الرئيسي — فلا تُفكّ، وأول ختم جديد كان سيُنشئ مفتاحًا ثانيًا لقاعدة واحدة.
  // والاشتقاق من مجلد القاعدة صحيحٌ في الحالين: يتطابق مع القديم حين يجتمعان، ويصيب حين يفترقان.
  const keyPath = given('FIELD_KEY_PATH') ? resolve(root, given('FIELD_KEY_PATH'))
    : dbPath ? resolve(dirname(dbPath), 'keys/field.key')
    : resolve(dir, 'keys/field.key');
  const port = Number(String(env.PORT ?? '').trim() || spec.port);

  if (key === 'staging') {
    // العبور يُرفض في الاتجاهين المهمّين: قاعدةٌ أو مفتاحٌ خارج مجلد التجهيز ليس تجهيزًا.
    const inside = path => resolve(path).startsWith(dir + '/');
    if (dbPath && (isLivePath(dbPath) || !inside(dbPath))) throw new EnvironmentError(
      `التجهيز لا يفتح قاعدة خارج ${spec.dir}: ${dbPath}\n` +
      '  فتحُ قاعدة يطبّق عليها الترحيلات، فهو كتابة. انسخ القاعدة إلى مجلد التجهيز واعمل على النسخة.');
    if (isLivePath(keyPath) || !inside(keyPath)) throw new EnvironmentError(
      `التجهيز لا يستعمل مفتاح حقول خارج ${spec.dir}: ${keyPath}\n` +
      '  مفتاح التشغيل في يد بيئة تجريبية يعني أن الحقول المشفّرة الحية تُفكّ منها.');
  }

  const besideCode = resolve(dir, 'keys/field.key');
  return { key, name: spec.name, dir, dbPath, keyPath, port, isStaging: key === 'staging',
    keyPresent: existsSync(keyPath),
    strayKeyPath: besideCode !== keyPath && existsSync(besideCode) ? besideCode : null,
    ready: key === 'local' || Boolean(dbPath && existsSync(dbPath)) };
}

// الاسم كما يُعرض للقارئ. التشغيل لا يحمل وسمًا (هو الأصل)، والتجهيز يحمله في كل شاشة فلا يُظنّ تشغيلًا.
export const environmentBadge = resolved =>
  resolved.isStaging ? { key: resolved.key, name: resolved.name, warn: 'بيئة تجهيز ببيانات اصطناعية — ليست بيانات الشركة.' }
    : { key: resolved.key, name: resolved.name, warn: null };

// غياب ملف المفتاح ليس خطأ إقلاع — قاعدةٌ بلا حقل مشفّر تعمل بلا مفتاح — لكنه لا يجوز أن يمرّ صامتًا:
// crypto-fields يُنشئ مفتاحًا جديدًا عند أول ختم، فتُختم القيم الجديدة بمفتاح، وتبقى القديمة بمفتاح آخر،
// في قاعدة واحدة بلا ما يقول أيّها بأيّ. وقع هذا فعلًا: سرّ تحقق بخطوتين في القاعدة الحية مختومٌ بمفتاح
// المجلد الرئيسي، ومجلد التشغيل بلا مفتاح ولا ‎.env — فالخدمة لا تفكّه، وأول ختم جديد يُنشئ ثالثًا.
export function keyNotice(resolved) {
  // مفتاحان في مكانين: أيّهما خُتم به؟ لا يُخمَّن ولا يُبدَّل صامتًا — يُقال ويُترك القرار لمن يعرف.
  if (resolved.keyPresent && resolved.strayKeyPath) return (
    `[مفتاح الحقول] يُستعمل ${resolved.keyPath}\n` +
    `  ويوجد ملف مفتاح آخر بجانب الكود: ${resolved.strayKeyPath}\n` +
    '  إن كانت في القاعدة قيمٌ خُتمت بالثاني فلن تُفكّ. اضبط FIELD_KEY_PATH على الصحيح، واحذف الآخر.');
  if (resolved.keyPresent) return null;
  return `[مفتاح الحقول] لا ملف في ${resolved.keyPath}\n` +
    '  الحقول المشفّرة (حسابات الموردين البنكية، وأسرار التحقق بخطوتين) لا تُقرأ بلا مفتاحها،\n' +
    '  وأول قيمة تُختم بعد الآن ستُنشئ مفتاحًا جديدًا — فتصير في القاعدة قيمٌ بمفتاحين.\n' +
    '  إن كانت في القاعدة قيمٌ مختومة فمفتاحها في مكان آخر: اضبط FIELD_KEY_PATH عليه قبل أي ختم جديد.';
}
