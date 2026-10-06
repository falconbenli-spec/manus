import { transaction } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { seedInventory, submitAssessment, decideAssessment, activateAsset } from '../app/ai-governance.mjs';

/* تجهيز جرد مساعدي الذكاء الاصطناعي لبيانات الاختبار.
 *
 * بعد وصل `assetGate` بمسار التشغيل صار «غير مجرود» = «لا يعمل». فكل اختبار يشغّل مساعدًا صار يحتاج
 * أن يمرّ بخطوات الحوكمة نفسها التي يمرّ بها الأصل في التشغيل — وهذا هو المقصود: الاختبار الذي يشغّل
 * مساعدًا بلا جرد كان يختبر حالة لا يجوز أن توجد.
 *
 * ولا اختصار هنا: لا كتابة مباشرة في `ai_assets` لجعل الحالة `active`. القاعدة نفسها ترفض ذلك
 * (تفعيلٌ بلا تقييم معتمد، واعتمادٌ من مُعِدّه)، والالتفاف عليها يجعل الاختبار يثبت شيئًا غير الذي
 * يجري في التشغيل. فتمرّ هذه الدالة بالمسار كاملًا: إدخالٌ في الجرد، ثم تقييم مخاطر يسمّي مالكًا
 * بشريًا، ثم اعتمادٌ من ثالثٍ غير مُعِدّه وغير مالكه، ثم تفعيل.
 */

const GOVERNOR = 'ai-governor-fixture';

// يُنشئ مراجعًا مستقلًا يحمل تصريح حوكمة الذكاء الاصطناعي. لازمٌ لأن فصل المهام يمنع
// من أعدّ التقييم ومن يملك المساعد من اعتماده، فيلزم شخص ثالث.
function governor(db, users) {
  if (db.prepare('SELECT 1 FROM users WHERE id=?').get(GOVERNOR)) return db.prepare('SELECT * FROM users WHERE id=?').get(GOVERNOR);
  const { tenant_id, department_id } = users.admin;
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,admin_level) VALUES(?,?,?,?,'مراجع حوكمة مصطنع','x','admin','scoped')")
    .run(GOVERNOR, tenant_id, department_id, GOVERNOR);
  transaction(db, () => grantAccess(db, users.admin, { user_id: GOVERNOR, capability: 'ai.govern', note: 'اعتماد تقييمات المساعدين — بيانات اختبار مصطنعة' }));
  return db.prepare('SELECT * FROM users WHERE id=?').get(GOVERNOR);
}

/** يُدخل كل مساعد في الجرد، ثم يُفعّل المفاتيح المطلوبة وحدها (أو الكل إن لم تُحدَّد).
 *  `owner` موظف نشط غير أدمن يصير المالك البشري المسؤول عن المساعد. */
export function activateAssistants(db, users, keys = null, { owner = 'manager' } = {}) {
  const reviewer = governor(db, users);
  transaction(db, () => seedInventory(db, users.admin));
  const wanted = keys === null
    ? db.prepare('SELECT assistant_key FROM ai_assets WHERE tenant_id=?').all(users.admin.tenant_id).map(r => r.assistant_key)
    : keys;
  for (const key of wanted) {
    let asset = db.prepare('SELECT * FROM ai_assets WHERE tenant_id=? AND assistant_key=?').get(users.admin.tenant_id, key);
    if (!asset) throw new Error(`لا مساعد بالمفتاح ${key} في الجرد`);
    const { id } = transaction(db, () => submitAssessment(db, users.admin, asset.id, {
      version: asset.version, owner_id: owner, data_categories: ['pasted_text'], data_leaves_kingdom: false,
      transfer_note: '', risk_level: 'low',
      risk_notes: 'بيانات مصطنعة داخل الاختبار وحده، ولا تتصل بمزود خارجي حقيقي.',
      mitigations: 'مراجعة بشرية للمسودة، ومصادر محصورة بما يراه صاحب التشغيل.' }));
    transaction(db, () => decideAssessment(db, reviewer, id, {
      decision: 'approve', note: 'مراجعة مستقلة لبيانات اختبار مصطنعة', next_review_on: '2099-01-01' }));
    asset = db.prepare('SELECT * FROM ai_assets WHERE tenant_id=? AND assistant_key=?').get(users.admin.tenant_id, key);
    transaction(db, () => activateAsset(db, users.admin, asset.id, { version: asset.version, reason: 'تفعيل داخل الاختبار المصطنع وحده' }));
  }
  return reviewer;
}
