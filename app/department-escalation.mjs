// مرجع تصعيد الإدارة: البابُ الذي لم يكن له باب — 23 سبتمبر 2026.
//
// القياس على القاعدة الحية قبل هذا العمل: جدول department_escalation يحمل السبع عشرة إدارة النشطة،
// وأربع عشرة منها تشير إلى حسابين مصطنعين لا يحملهما أحد — vp-corporate (سبع إدارات) وvp-growth (سبع).
// وثلاث وحدها تشير إلى شخص حقيقي (ceo). فكل تصعيد اليوم يقف عند حساب لا إنسان خلفه.
//
// والسبب أن الجدول كان يُكتب في موضع واحد: installServiceCatalog (app/service-catalog.mjs) تكتب
// escalationFor(d) — نائبَ القطاع — عند تثبيت دليل الخدمات. لا شاشة، لا دالة، لا تدقيق: المالك لا يملك
// موضعًا يسمّي فيه من يغطّي إدارةً. وأثرُ ذلك يتعدّى التصعيد: canApproveThresholds (app/workflow.mjs)
// تسأل هذا الجدول بعينه، فمن ليس مرجعَ تصعيدِ إدارةٍ ولا الرئيسَ التنفيذي لا يعتمد حدًّا ولا يتبنى مهلة.
//
// هذا الملف هو الباب. قواعده الأربع:
//   (1) صاحب المنصة وحده — الأدمن الأول. تسمية من يقف فوق مدير الإدارة قرارُ صاحبها لا قرار من يدير الحسابات.
//   (2) داخل معاملة واحدة، وبسند مكتوب يُقرأ بجوار الاسم بعد سنة.
//   (3) الحساب المسمّى: نشطٌ، في هذا الكيان، بدور «مدير». الثلاثة مقيسة لا مفترضة — الدور لأن
//       escalationApprover تستثني role='admin' وcanApproveThresholds تشترط 'manager'، فحسابٌ بدور آخر
//       يُكتب في الجدول ثم لا يعمل: سطرٌ يبدو مملوءًا وهو فارغ.
//   (4) كل تسمية حدثُ تدقيق باسم من سمّى ومن كان قبله.
//
// وما لا يفعله هذا الملف عمدًا: لا يمنع أن يكون المرجع من داخل الإدارة نفسها (ومنه مديرها). المالك قد
// يحتاجها — إدارةٌ فيها شخص واحد، أو أن يسمّي نفسه مرجعَ إدارته ليستأنف قرارًا متوقفًا — والمنع يقفل
// عليه بابًا لا بديل له اليوم. لكنها تُعلَّم على الشاشة وفي حدث التدقيق باسمها («المرجع من داخل الإدارة»)
// فلا تمرّ صامتة: مرجعٌ من داخل الإدارة يعني أن طلب مديرها قد يعود إليه هو، وذلك قرارٌ يُرى لا يُخفى.
import { audit, now } from './db.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { isSuperAdmin } from './access.mjs';

// الحساب المصطنع يُعرف بعلامته المكتوبة في اسمه: كل ما بذرته المنصة يحمل «تجريبي» بالنص (installServiceCatalog).
// فلا قائمة معرّفات محفوظة هنا تشيخ حين يُسمّى نائبٌ ثالث: العلامة نفسها هي القياس.
export const SYNTHETIC_MARK='تجريبي';
export const isSyntheticHolder=name=>typeof name==='string'&&name.includes(SYNTHETIC_MARK);
// دور واحد يصلح لحمل الوقفة: «مدير». وهو القياس نفسه الذي تطبقه workflow.escalationApprover
// وworkflow.canApproveThresholds، مكتوبًا هنا مرة ليقوله الرفض قبل الكتابة لا بعدها.
export const ESCALATION_ROLE='manager';
const ROLE_NAMES={employee:'موظف',manager:'مدير',hr:'موارد بشرية',it:'تقنية معلومات',pm:'مدير مشروع',admin:'مسؤول المنصة'};

const superAdminName=(db,tenantId)=>db.prepare("SELECT name FROM users WHERE tenant_id=? AND role='admin' AND admin_level='super' AND active=1 ORDER BY name").get(tenantId)?.name
  ??'الأدمن الأول';

/* ───── نموذج القراءة: من يغطّي كل إدارة اليوم ───── */
// صفٌّ لكل إدارة نشطة، ومعه حال مرجعها الأربع التي تُعرض على الشاشة كما هي:
//   missing   لا صف تصعيد أصلًا — الطلب الصاعد من مدير الإدارة لا يجد فوقه أحدًا.
//   synthetic الحساب مصطنع («تجريبي») لا يحمله إنسان — وهذه حال أربع عشرة إدارة اليوم.
//   inactive  الحساب موقوف أو حُذف من الكيان.
//   internal  المرجع من داخل الإدارة نفسها — جائز ومُعلَّم.
export function escalationBoard(db,tenantId){
  const rows=db.prepare(`SELECT d.id,d.name,d.sector,
      e.user_id,e.note,e.assigned_by,e.assigned_at,
      u.name AS holder_name,u.role AS holder_role,u.active AS holder_active,u.department_id AS holder_department,
      a.name AS assigned_by_name
    FROM departments d
    LEFT JOIN department_escalation e ON e.department_id=d.id AND e.tenant_id=d.tenant_id
    LEFT JOIN users u ON u.id=e.user_id AND u.tenant_id=d.tenant_id
    LEFT JOIN users a ON a.id=e.assigned_by AND a.tenant_id=d.tenant_id
    WHERE d.tenant_id=? AND d.active=1 ORDER BY d.name`).all(tenantId);
  return rows.map(r=>{
    const named=!!r.user_id,synthetic=named&&isSyntheticHolder(r.holder_name);
    return {department_id:r.id,department_name:r.name,sector:r.sector??'',
      user_id:r.user_id??null,holder_name:r.holder_name??null,
      holder_role:r.holder_role??null,holder_role_name:r.holder_role?ROLE_NAMES[r.holder_role]??r.holder_role:null,
      holder_department:r.holder_department??null,
      note:r.note??'',assigned_by:r.assigned_by??null,assigned_by_name:r.assigned_by_name??r.assigned_by??null,assigned_at:r.assigned_at??null,
      missing:!named,
      synthetic,
      inactive:named&&(r.holder_name===null||!r.holder_active),
      internal:named&&r.holder_department===r.id,
      healthy:named&&!synthetic&&r.holder_active===1&&r.holder_role===ESCALATION_ROLE};
  });
}
export function escalationSummary(board){
  return {departments:board.length,
    missing:board.filter(x=>x.missing).length,
    synthetic:board.filter(x=>x.synthetic).length,
    inactive:board.filter(x=>x.inactive).length,
    internal:board.filter(x=>x.internal).length,
    healthy:board.filter(x=>x.healthy).length};
}
// من يصلح أن يُسمّى: نشط، في هذا الكيان، بدور «مدير». القائمة هي عينها ما يقبله assignDepartmentEscalation،
// فلا تعرض الشاشة اسمًا يُرفض بعد الإرسال.
export function escalationCandidates(db,tenantId){
  return db.prepare(`SELECT u.id,u.name,u.department_id,d.name AS department_name
    FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id
    WHERE u.tenant_id=? AND u.active=1 AND u.role=? ORDER BY u.name`).all(tenantId,ESCALATION_ROLE)
    .map(c=>({...c,department_name:c.department_name??c.department_id,synthetic:isSyntheticHolder(c.name)}));
}

/* ───── التسمية ───── */
function requireOwner(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!isSuperAdmin(u))refuse(403,'forbidden',{what:'لا يُسمّى مرجع تصعيد إدارة بحسابك',
    missing:[{document:'امتياز الأدمن الأول (سوبر ادمن)',
      why:'من يقف فوق مدير الإدارة يقرره صاحب المنصة: التسمية تفتح اعتماد الحدود وتبنّي المهل وسُلَّم التصعيد كله',
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'اطلب من الأدمن الأول تسمية المرجع من «مصفوفة الصلاحيات»، أو أن يمنحك امتياز الأدمن الأول',
    link:'#permissions-matrix'});
  return u;
}
export function assignDepartmentEscalation(db,supplied,input){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم تُحفظ تسمية مرجع التصعيد',
    next:'أعد المحاولة؛ تُكتب التسمية وحدثُ تدقيقها داخل معاملة واحدة'});
  const u=requireOwner(db,supplied);
  v.object(input,['department_id','user_id','basis']);
  const department=db.prepare('SELECT id,name,active FROM departments WHERE id=? AND tenant_id=?').get(input.department_id,u.tenant_id);
  if(!department)refuse(404,'department',{what:'الإدارة غير موجودة في هذا الكيان',
    next:'اختر إدارة من قائمة الإدارات في المصفوفة'});
  if(!department.active)refuse(409,'department_archived',{what:`إدارة «${department.name}» مؤرشفة، فلا يُسمّى لها مرجع تصعيد`,
    next:'أعد تفعيل الإدارة من «الإدارات والهيكل» إن كانت ما تزال عاملة، أو انقل موظفيها إلى إدارة قائمة'});
  // الحساب يُقرأ بمعرّفه وحده ثم تُقارن هويته: لو قُرئ بالمعرّف والكيان معًا لصار «حساب كيان آخر»
  // و«حساب غير موجود» رفضًا واحدًا، ولا يعرف المالك أيّهما أصاب.
  const person=typeof input.user_id==='string'?db.prepare('SELECT id,tenant_id,name,role,active,department_id FROM users WHERE id=?').get(input.user_id):null;
  if(!person)refuse(404,'escalation_user',{what:'لا حساب بهذا المعرّف في المنصة',
    next:'اختر الحساب من قائمة المرشحين في الشاشة؛ القائمة تعرض الحسابات النشطة بدور «مدير» في كيانك'});
  if(person.tenant_id!==u.tenant_id)refuse(409,'escalation_foreign_tenant',{what:`الحساب «${input.user_id}» مسجَّل في كيان آخر، فلا يقف فوق مدير «${department.name}»`,
    missing:[{document:`حساب مسجَّل في كيانك`,why:'مرجع التصعيد يقرأ طلبات الإدارة ويقرر فيها، وحساب كيان آخر لا يرى منها شيئًا',
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'اختر مرجعًا من حسابات كيانك، أو أنشئ له حسابًا فيه من «الموظفون والصلاحيات»'});
  if(!person.active)refuse(409,'escalation_inactive',{what:`حساب «${person.name}» موقوف، فلا يُسمّى مرجع تصعيد لـ«${department.name}»`,
    missing:[{document:'حساب نشط في المنصة',why:'الطلب الصاعد إلى حساب موقوف يقف عنده ولا يصل إلى أحد',
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'أعد تفعيل الحساب من «الموظفون والصلاحيات» ثم سمِّه، أو اختر مرجعًا نشطًا'});
  if(person.role!==ESCALATION_ROLE)refuse(409,'escalation_role',{what:`دور «${ROLE_NAMES[person.role]??person.role}» لا يحمل وقفة مرجع التصعيد`,
    missing:[{document:`حساب بدور «${ROLE_NAMES[ESCALATION_ROLE]}»`,
      why:'محرك العمل يقرأ مرجع التصعيد بدور «مدير» وحده، ويستثني حساب إدارة المنصة؛ فحسابٌ بدور آخر يُكتب في الجدول ولا يُسأل عن شيء',
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'غيّر دور الحساب إلى «مدير» من «الموظفون والصلاحيات» إن كان هذا موقعه، أو سمِّ حسابًا بدور مدير'});
  const basis=v.text(input.basis,'سند التسمية (من قررها ومتى ولماذا)',1000,10);
  const previous=db.prepare(`SELECT e.user_id,u.name AS holder_name FROM department_escalation e
    LEFT JOIN users u ON u.id=e.user_id AND u.tenant_id=e.tenant_id
    WHERE e.department_id=? AND e.tenant_id=?`).get(department.id,u.tenant_id)??null;
  const internal=person.department_id===department.id;
  db.prepare(`INSERT INTO department_escalation(department_id,tenant_id,user_id,note,assigned_by,assigned_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(department_id) DO UPDATE SET user_id=excluded.user_id,note=excluded.note,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at`)
    .run(department.id,u.tenant_id,person.id,basis,u.id,now());
  // «استُبدل حسابٌ مصطنع» يُكتب في الحدث لا يُحسب لاحقًا: بعد الكتابة لا يبقى في القاعدة أثرٌ لمن كان قبله.
  audit(db,u,'department',department.id,'escalation.assigned',
    previous?{user_id:previous.user_id,synthetic:isSyntheticHolder(previous.holder_name)}:{},
    {user_id:person.id,internal,synthetic:isSyntheticHolder(person.name)},
    basis);
  return {department_id:department.id,user_id:person.id,internal,
    board:escalationBoard(db,u.tenant_id).find(x=>x.department_id===department.id)??null};
}
