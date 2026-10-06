/* قراءة بيانات الأشخاص من موضع واحد — الخطوة الأولى من هدف D3 (TP2.7).
 *
 * جداول الأشخاص الثلاثة (users, employee_profiles, employment_contracts) تُقرأ اليوم مباشرةً من
 * 147 وحدة في 738 موضعًا، فيُعاد الحكم على النطاق والحجب في كل استعلام على حدة. والهدف أن تمرّ
 * القراءة بمساعدٍ واحد يفرض ذلك في موضع واحد. ومسنّنة الجودة في scripts/quality-ratchet.mjs تسمّي
 * هذا الملف بعينه وتستثنيه من العدّ، فالهجرة إليه هي ما ينزل به السقف.
 *
 * وما هذا الملف اليوم وما ليس هو: هو **موضع القراءة الواحد**، وليس بعدُ حارس النطاق والحجب.
 * الدالتان أدناه تعيدان ما كانت الوحدات تقرؤه بحروفه، فالهجرة إليهما لا تغيّر سلوكًا ولا تُخفي
 * فرقًا. ونقل قواعد النطاق والحجب إلى هنا دفعةٌ تالية تُقاس وحدها — ولا يُقال إنها تمّت وهي لم تتمّ.
 *
 * ولا يُضاف إلى هذا الملف ما يقرأ غير جداول الأشخاص: استثناؤه من العدّ يخصّ قراءتها وحدها.
 */

/** اسم الشخص كما يُعرض، أو null إن لم يوجد الصف أو لم يُمرَّر معرّف. */
export const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

/** إدارة الشخص. users.department_id غير قابل للعدم، فـnull هنا تعني «لا صفّ لهذا المعرّف» لا «بلا إدارة». */
export const personDepartment=(db,userId)=>userId?db.prepare('SELECT department_id FROM users WHERE id=?').get(userId)?.department_id??null:null;

/** بيانات الإسناد الأساسية ضمن الكيان؛ لا تعيد كلمة مرور أو تفاصيل وظيفية حساسة. */

/** موضع الشخص في الهيكل ضمن كيانه: الإدارة والمدير المباشر والدور وحالة الحساب، أو null خارج الكيان. */
export const personPlacement=(db,tenantId,userId)=>userId&&tenantId?db.prepare('SELECT id,tenant_id,department_id,manager_id,role,active FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId)??null:null;

/** الملف الوظيفي كما هو الآن (المسمى ونوع التعاقد والمباشرة ونهاية العقد والحالة)، أو null إن لم يُنشأ. */
export const personProfile=(db,userId)=>userId?db.prepare('SELECT * FROM employee_profiles WHERE user_id=?').get(userId)??null:null;

/** عقد ضمن الكيان: صاحبه وحالته وتواريخه وحدها — بلا بنود الراتب ولا مبالغه. */
export const personContract=(db,tenantId,contractId)=>typeof contractId==='string'&&tenantId?db.prepare('SELECT id,tenant_id,user_id,status,start_date,end_date,ended_on FROM employment_contracts WHERE id=? AND tenant_id=?').get(contractId,tenantId)??null:null;

/** عقود الكيان القائمة (مسودة أو بانتظار الاعتماد أو سارية): صاحبها وحالتها وتواريخها وحدها — بلا بنود الراتب ولا مبالغه.
 *  يقرؤها رابط التوظيف (app/people.mjs) ليعرض لمن يربط عقودَ الحساب الذي اختاره، وهي الحالات نفسها التي يقبلها الربط. */
export const openContracts=(db,tenantId)=>tenantId?db.prepare("SELECT id,user_id,status,start_date,end_date FROM employment_contracts WHERE tenant_id=? AND status IN ('draft','pending','active') ORDER BY start_date DESC,id").all(tenantId):[];

/** صاحب اسم الدخول داخل الكيان: المعرّف والاسم والدور وحالة الحساب، أو null. يقرؤه استيراد دفعة النظام السابق في المسير الموازي
 *  (app/payroll-parallel.mjs): عمود «employee» في ملفاته اسم دخول الموظف في المنصة، لأن معرّف المنصة لا يعرفه النظام السابق. */
export const personByUsername=(db,tenantId,username)=>typeof username==='string'&&username&&tenantId?db.prepare("SELECT id,name,role,active FROM users WHERE tenant_id=? AND username=? AND role<>'admin'").get(tenantId,username)??null:null;
export const personAssignment=(db,tenantId,userId)=>db.prepare('SELECT id,name,role,active,tenant_id,department_id FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId);

/** بيانات الموظف النشط اللازمة لمسارات المدير المباشر، دون حقول الدخول أو التعويضات. */
export const activeEmployeeAssignment=(db,tenantId,userId)=>db.prepare("SELECT id,name,department_id,manager_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,tenantId);

/** هل الشخص موظف نشط يتبع هذا المدير مباشرة داخل الكيان نفسه؟ */
export const isDirectManager=(db,tenantId,managerId,userId)=>!!db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1 AND role<>'admin'").get(userId,tenantId,managerId);

/** عدد حسابات الموظفين النشطة في الكيان، مع استبعاد حسابات إدارة المنصة. */
export const activeEmployeeCount=(db,tenantId)=>db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").get(tenantId).n;

/** العقد القائم أولًا ثم أحدث حالة لبناء دلائل الملف؛ لا تعيد مرجع المستند ولا بنود الأجر ولا قيمته. */
export const latestEmploymentContractMeta=(db,tenantId,userId)=>db.prepare(`SELECT id,status,created_at,updated_at
  FROM employment_contracts WHERE tenant_id=? AND user_id=?
  ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,created_at DESC LIMIT 1`).get(tenantId,userId)??null;

/** صفحة أسماء الموظفين لمن اجتاز تصريح الوحدة الأصلية قبل استدعاء هذا المساعد. */
export const activeEmployeePage=(db,tenantId,{limit=51,offset=0}={})=>db.prepare(`SELECT id,name,role,department_id FROM users
  WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name,id LIMIT ? OFFSET ?`).all(tenantId,limit,offset);

/** أعضاء إدارة نشطون يصلحون لعضوية مساحة داخلية؛ حساب إدارة المنصة ليس عضو أعمال. */
export const activeDepartmentPeople=(db,tenantId,departmentId)=>db.prepare(`SELECT id,name,role,department_id FROM users
  WHERE tenant_id=? AND department_id=? AND active=1 AND role<>'admin' ORDER BY id`).all(tenantId,departmentId);

/** أعضاء مشروع نشطون داخل الكيان نفسه؛ الفصل بالكيان يبقى في موضع قراءة الأشخاص. */
export const activeProjectPeople=(db,tenantId,projectId)=>db.prepare(`SELECT u.id,u.name,u.role,u.department_id
  FROM users u JOIN project_members m ON m.user_id=u.id JOIN projects p ON p.id=m.project_id
  WHERE p.id=? AND p.tenant_id=? AND u.tenant_id=? AND u.active=1 AND u.role<>'admin' ORDER BY u.id`).all(projectId,tenantId,tenantId);

/** شخص داخلي نشط يصلح لإضافته إلى مساحة الإدارة أو المشروع المحدد. */
export function eligibleSpacePerson(db,tenantId,targetKind,targetId,userId){
  if(targetKind==='project')return db.prepare(`SELECT u.id,u.name,u.role,u.department_id FROM users u
    JOIN project_members m ON m.user_id=u.id JOIN projects p ON p.id=m.project_id
    WHERE u.id=? AND u.tenant_id=? AND u.active=1 AND u.role<>'admin' AND p.id=? AND p.tenant_id=?`).get(userId,tenantId,targetId,tenantId);
  if(targetKind==='department')return db.prepare(`SELECT id,name,role,department_id FROM users
    WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin' AND department_id=?`).get(userId,tenantId,targetId);
  if(targetKind==='initiative')return db.prepare(`SELECT u.id,u.name,u.role,u.department_id FROM users u
    JOIN governance_initiatives i ON i.tenant_id=u.tenant_id AND (i.owner_id=u.id OR i.proposed_by=u.id)
    WHERE u.id=? AND u.tenant_id=? AND u.active=1 AND u.role<>'admin' AND i.id=?`).get(userId,tenantId,targetId);
  return null;
}
