import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
// canonical وحده من سجل التعريفات: JSON بمفاتيح مرتبة، مصدرٌ واحد لكل بصمة في المنصة. لا دورة — تلك الوحدة لا تستورد هذه.
import { canonical } from './definitions.mjs';
import * as v from './validation.mjs';
import { currentUser,delegationFor } from './delegations.mjs';
import { can } from './access.mjs';
// escalationFor يُستدعى داخل الدوال فقط؛ الاستيراد الدائري مع service-catalog.mjs آمن لأن أيًّا من الوحدتين لا يستدعي الأخرى عند التحميل.
import { escalationFor } from './service-catalog.mjs';
import { requestNotice, SUBJECT_LINKS, categoryOf } from './notices.mjs';
import { catalogAttendanceRoute } from './attendance-policy.mjs';
import { catalogCrmRoute } from './crm-front-door.mjs';
import { afterTransition, beforeComplete } from './service-routes.mjs';
import { serviceOutputView, outputContract } from './service-outputs.mjs';
import { activeDepartmentPeople } from './people-read.mjs';
// مفتاح تفعيل الخدمة (ترحيل 129): وحدة ورقية لا تستورد هذه، فلا دورة.
import { visibleSql, isHidden, refuseHidden, audiencesFor, gatesFor, currentGates, refuseGated } from './service-availability.mjs';

const id=()=>randomUUID();
const editable=r=>['draft','returned'].includes(r.status);
const unpack=s=>({...s,fields:JSON.parse(s.fields),approval_policy:JSON.parse(s.approval_policy)});
const snapshot=r=>({title:r.title,payload:JSON.parse(r.payload),status:r.status,version:r.version,revision:r.revision,assigned_to:r.assigned_to});
// ── ما يُنسخ من اللقطة إلى سجل التدقيق وإلى سجل التذكير ───────────────────────────────
// اللقطة كاملةً تبقى للنسخة المقدَّمة وحدها (request_versions): هي التي تُثبت ما قُدِّم بحرفه، ولا تُمسّ.
// أما نسخها إلى سجل التدقيق وسجل التذكير فكانت تحمل معها الحمولة كلها، والحمولة كلامُ الموظف نفسه: رقم حسابه،
// وجواله، وسبب حالته الصحية، وما يكتبه في حقل حر. وسجل التدقيق إلحاقي لا يُنقَّح ولا يُحذف منه صف
// (مشغّلا audit_no_update وaudit_no_delete في app/schema.sql)، فما دخله لا يخرج منه أبدًا.
//
// الشكل المختار قائمةٌ مسموحة صريحة لا حجبٌ بالأنماط. السبب أن حجب app/pii.mjs يعلن عن نفسه أنه جزئي بحرفه:
// يمسك الآيبان والجوال والبريد ورقم الهوية بأنماط، ولا يمسك اسمًا ولا عنوانًا ولا حسابًا غير سعودي ولا وصفًا حرًّا
// يعرّف صاحبه بلا رقم. حجبٌ جزئي في سجل لا يُنقَّح يترك ما فاته فيه إلى الأبد. والقائمة المسموحة مغلقة بطبعها:
// حقلٌ يُضاف إلى اللقطة غدًا لا يبدأ بالسيلان إلى السجل من تلقائه، بل يُضاف هنا بقرار مكتوب.
// وهذا هو عُرف المنصة نفسه لا اختراعًا: سجل حالات الموارد البشرية لا يحمل الصنف ولا المشكو في حقه،
// وسجل العقود لا يحمل الراتب، وسجل الخطابات لا يحمل المبلغ، وسجل النبض يقول «شارك» لا ماذا قال.
//
// فالقاعدة: سجل التدقيق يحمل **حالة** الطلب لا **محتواه**. العنوان والحمولة محتوى، فيبقيان في النسخة المقدَّمة
// وفي صف الطلب نفسه، ويقرأهما من يملك رؤية الطلب. وما تغيّر في الحمولة يُثبته الآن ختمُ النسخة (ترحيل 146).
const AUDIT_SNAPSHOT_FIELDS=Object.freeze(['status','version','revision','assigned_to']);
const auditSnapshot=r=>Object.fromEntries(AUDIT_SNAPSHOT_FIELDS.map(key=>[key,r?.[key]??null]));

// ── ختم النسخة المقدَّمة (ترحيل 146) ───────────────────────────────────────────────────
// القاعدة تمنع تعديل النسخة المقدَّمة وحذفها بمشغّلَي version_no_update وversion_no_delete، وهذا يكفي داخل المنصة.
// لكنه لا يقول شيئًا لمن يسأل من خارجها: ملف SQLite على القرص يُفتح بأي أداة، والمشغّل نفسه يُسقَط بسطر واحد.
// فالختم هو الجواب: بصمة الصف تُعاد حسابًا من الصف نفسه، فصفٌّ بُدِّل أو دُسّ من خارج المنصة لا تطابق بصمتُه ما فيه.
// النموذج rowDigest/verifyChain في app/definitions.mjs، وcanonical منه نفسه لا نسخة ثانية منه:
// JSON بمفاتيح مرتبة، فالوثيقة نفسها تعطي البصمة نفسها في أي بيئة ومن أي ترتيب كتابة.
//
// ما يغطيه الختم: الصف كاملًا — الطلب، ورقم النسخة، ولحظة تقديمها، واللقطة بحرفها. فتبديل أيٍّ منها يكسره:
// نقل لقطة من طلب إلى طلب، أو تقديم رقم نسخة على أخرى، أو تأخير لحظة التقديم، أو تغيير قيمة في الحمولة.
// وليس سلسلةً بين الصفوف كسلسلة التعريفات عمدًا: لا عمود ترتيب عام في الجدول، ونسخ الطلب الواحد متتابعة
// من 1 بلا فجوة أصلًا (requests.revision يُزاد واحدًا عند كل تقديم)، فالصف الناقص يُرى من تتابعها لا من سلسلة بصمات.
const VERSION_SEAL='request_version';
export const versionDigest=(requestId,revision,createdAt,snapshotValue)=>
  hash(`${VERSION_SEAL}\n${requestId}\n${revision}\n${createdAt}\n${canonical(snapshotValue)}`);
// ثلاث إجابات لا اثنتان. «ما نقدر نتحقق» ليست «سليمة»: صفٌّ بلا ختم لا يُقال عنه إنه مطابق لما قُدِّم،
// لأن لا شيء يُقارن به. صفوف ما قبل الترحيل 146 كلها هنا، وسببها مكتوب في الترحيل نفسه.
export const VERSION_STATES=Object.freeze({
  valid:'مطابقة لما قُدِّم',
  altered:'تغيّرت بعد تقديمها',
  not_verifiable:'ما نقدر نتأكد منها',
  none:'ما فيه نسخة مقدَّمة بعد'
});
const NOT_VERIFIABLE_WHY='هذي النسخة انحفظت قبل ما تدخل الأختام (ترحيل 146)، فما لها ختم يُقارن به. ما نقول إنها سليمة وما نقول إنها تغيّرت — نقول ما نقدر نتأكد.';
// سلامة نسخ طلب واحد: كل صف يُعاد حساب بصمته من محتواه ويُقارن بالمخزون.
// الجواب العام أسوأ ما في الصفوف: صفٌّ واحد تغيّر يجعل الطلب كله «تغيّرت»، وصفٌّ واحد بلا ختم يمنع قول «سليمة».
export function verifyRequestVersions(db,requestId){
  const request=db.prepare('SELECT id FROM requests WHERE id=?').get(requestId);
  if(!request)refuse(404,'not_found',{what:`ما فيه طلب بهذا الرقم (${requestId}) عشان نتحقق من نسخه`,
    next:'تأكد من رقم الطلب من شاشة الطلب نفسها، وإذا كان الطلب انحذف من خارج المنصة فهذا اللي يتبلّغ لمسؤول المنصة'});
  const versions=db.prepare('SELECT request_id,revision,snapshot,created_at,digest FROM request_versions WHERE request_id=? ORDER BY revision').all(requestId)
    .map(row=>{
      const state=!row.digest?'not_verifiable'
        :versionDigest(row.request_id,row.revision,row.created_at,JSON.parse(row.snapshot))===row.digest?'valid':'altered';
      return {revision:row.revision,created_at:row.created_at,digest:row.digest??null,state,state_name:VERSION_STATES[state],
        ...(state==='not_verifiable'?{why:NOT_VERIFIABLE_WHY}:{}),
        ...(state==='altered'?{why:'ختم هذي النسخة ما يطابق اللي فيها الحين. يعني إما اللقطة تغيّرت أو الختم تغيّر من خارج المنصة.'}:{})};
    });
  const counts={valid:0,altered:0,not_verifiable:0};
  for(const version of versions)counts[version.state]++;
  const state=!versions.length?'none':counts.altered?'altered':counts.not_verifiable?'not_verifiable':'valid';
  return {request_id:requestId,state,state_name:VERSION_STATES[state],ok:state==='valid',
    valid:counts.valid,altered:counts.altered,not_verifiable:counts.not_verifiable,versions};
}
// الدليل: أحدث نسخة نشطة من كل رمز. تسعة عشر سطحًا من عشرين يمرّ من هنا، فمرشّح المفتاح هنا يغطيها دفعةً واحدة.
// includeHidden للفحص وحده (catalogHealth ولوح المفاتيح): الخدمة الموقوفة لها طلبات مفتوحة، فلو سقطت من الفحص
// لصار «لا ملاحظات» يعني «لم نَنظر» — ولذلك تبقى مفحوصة ومعلَّمة، ولا تُعرض للموظف في أي شاشة طلب.
const CATALOG_SQL=`SELECT s.*,d.section,d.sort_order AS section_order,d.target_days FROM services s
  LEFT JOIN service_directory d ON d.tenant_id=s.tenant_id AND d.service_code=s.code
  WHERE s.tenant_id=? AND s.active=1 AND s.version=(SELECT MAX(version) FROM services newer WHERE newer.tenant_id=s.tenant_id AND newer.code=s.code)`;
// شرط الظهور يحمل الآن جمهور الحساب أيضًا (131)، فلا يمكن أن يبقى نصًّا واحدًا يُبنى مرة عند التحميل:
// الجملة تُركَّب لكل قراءة من الدالة نفسها التي تحكم المسارات الأربعة، فلا ينشطر المرشّح بينها.
// وشرط الأهلية (138) يدخل الجملة نفسها بسياق هذا الحساب: خدمةٌ شرطُها تصريحٌ لا يحمله أو إدارةٌ ليست
// إدارته تسقط من الدليل ومن نافذة الطلب الجديد معًا، لأن الاثنتين تقرآن من هنا.
const visibleCatalogSql=(db,u)=>`${CATALOG_SQL} AND ${visibleSql('s','code','service',audiencesFor(u),gatesFor(db,u))} ORDER BY s.code`;
const ALL_CATALOG_SQL=`${CATALOG_SQL} ORDER BY s.code`;
export const catalog=(db,u,{includeHidden=false}={})=>db.prepare(includeHidden?ALL_CATALOG_SQL:visibleCatalogSql(db,u)).all(u.tenant_id).map(unpack);
// بالمعرّف وبلا مرشّح المفتاح عمدًا: كل طلب مفتوح على خدمة أُوقفت يبقى يحلّ خدمته، فتعمل شاشته وأفعاله
// وخطوات اعتماده وتنفيذه كما كانت. الإخفاء يمنع طلبًا جديدًا، ولا يقطع طلبًا قائمًا.
const getService=(db,u,sid)=>{
  const s=db.prepare('SELECT * FROM services WHERE id=? AND tenant_id=?').get(sid,u.tenant_id);
  if(!s) fail(404,'not_found','الخدمة غير موجودة');
  return unpack(s);
};

// ── نموذج الخطوة ──────────────────────────────────────────────────────────────
// الخطوة إما نص (الشكل القديم: manager | department_manager | hr | it | pm) أو كائن:
//   {role:'department_manager', department:'finance'}   مدير إدارة بعينها غير المالكة
//   {role:'executive', department?:'<id>'}              نائب القطاع أو الرئيس التنفيذي عبر escalationFor
//   {role:'executive', scope:'sector'|'ceo'}            خانة النائب وخانة الرئيس التنفيذي، كلٌّ على حدة
//   {role:<أي دور>, when:{field:'amount', gte_setting:'fin.payment.finance_review'}}  تُضاف إذا بلغ المبلغ حدًا معرّفًا
//   {role:<أي دور>, when:{field:'action', not_in:['بدل فاقد']}} أو {in:[...]}      تُضاف بحسب قيمة حقل اختيار
// الشكل النصي يُحل ويُعتمد حرفًا بحرف كما كان قبل هذا التعديل.
export const LEGACY_STEP_ROLES=['manager','department_manager','hr','it','pm'];
export const STEP_ROLES=[...LEGACY_STEP_ROLES,'executive'];
// ── نطاق خطوة الرئاسة (فجوة سلاسل نماذج درايف، 30 سبتمبر) ─────────────────────
// نماذج درايف توقّع «نائب الرئيس للخدمات المؤسسية» ثم «الرئيس التنفيذي» في خانتين متتاليتين، وهما
// شخصان لا شخص واحد. والدور `executive` وحده لا يفرّق بينهما، فالقاعدة التي تمنع تكرار الدور في
// السياسة كانت تمنع معها تمثيل السلسلة كما في النموذج — فبقيت ثلاث سلاسل غير ممثَّلة.
// والقاعدة لا تُضعَّف لأنها ليست شكلية: هي التي تمنع أن يُحسب قرارُ شخصٍ واحد اعتمادين. فالنطاق
// يميّز الخانتين بدل أن يرفع القاعدة: مفتاح التمييز يصير (الدور، الإدارة، النطاق)، وخطوتان بنطاق
// واحد تبقيان مرفوضتين كما كانتا. وخطوة بلا نطاق سلوكها حرفًا بحرف كما كان: النائب، وإلا الرئاسة.
// ولا يُخزَّن النطاق في سند الخطوة: `approval_step_basis.step_role` مقيَّد بستة أدوار في الترحيل 093،
// والقرار يقرأ النطاق من نسخة السياسة المخزَّنة (كما يقرأ `department` و`when`)، فلا يلزمه عمود.
export const EXECUTIVE_SCOPES=['sector','ceo'];
export const HANDLER_ROLES=['hr','it','manager','pm','member'];
export const MAX_STEPS=5;
export const normalizeStep=step=>typeof step==='string'?{role:step}:(step&&typeof step==='object'&&!Array.isArray(step)?step:null);
const stepRole=step=>{const role=typeof step==='string'?step:step?.role;return role==='department_manager'||role==='executive'?'manager':role;};
const isDirect=policy=>policy.mode==='direct';
// member = أي عضو نشط في الإدارة المنفذة، عدا حساب إدارة المنصة الذي لا ينشئ معاملات أعمال.
function handler(u,s,departmentId=s.department_id) {
  if(u.department_id!==departmentId)return false;
  return s.approval_policy.handler_role==='member'?u.role!=='admin':u.role===s.approval_policy.handler_role;
}
export const serviceOf=(db,r)=>getService(db,{tenant_id:r.tenant_id},r.service_id);
// حساب إدارة المنصة لا يعتمد معاملة أعمال ولا ينفّذها، فيُستثنى هنا كما يُستثنى في departmentTeam وdeputiesFor.
// كان الاستثناء ناقصًا في هذا الموضع وحده، فلو سجّل أحد حساب المنصة مرجعَ تصعيد لإدارة لصار معتمِدًا ومنفّذًا معًا.
export const escalationApprover=(db,tenantId,departmentId)=>db.prepare("SELECT u.id,u.role FROM department_escalation e JOIN users u ON u.id=e.user_id WHERE e.tenant_id=? AND e.department_id=? AND u.active=1 AND u.role<>'admin'").get(tenantId,departmentId)??null;
export const handlingDepartmentId=(db,r)=>r.handling_department_id??serviceOf(db,r).department_id;
const openTasks=(db,rid)=>db.prepare("SELECT COUNT(*) AS n FROM request_tasks WHERE request_id=? AND status='open'").get(rid).n;
// B7: المستفيد المسجّل في بيانات الاستقبال. يُقرأ بالـSQL مباشرة؛ request-intake.mjs يستورد هذه الوحدة.
export const beneficiaryOf=(db,r)=>db.prepare('SELECT beneficiary_id FROM request_intake WHERE request_id=? AND tenant_id=?').get(r.id,r.tenant_id)?.beneficiary_id??null;
export const stepBasis=(db,stepId)=>db.prepare('SELECT * FROM approval_step_basis WHERE step_id=?').get(stepId)??null;
const activeManager=(db,tenantId,userId)=>userId?db.prepare("SELECT id,role FROM users WHERE id=? AND tenant_id=? AND active=1 AND role='manager'").get(userId,tenantId)??null:null;
// B1: الرئاسة لإدارة = نائب قطاعها أو الرئيس التنفيذي كما يحدده escalationFor، ثم مرجع التصعيد المسجل إن غاب الحساب.
export function executiveFor(db,tenantId,departmentId){
  const department=db.prepare('SELECT id,sector FROM departments WHERE id=? AND tenant_id=?').get(departmentId,tenantId);
  if(!department)return null;
  return activeManager(db,tenantId,escalationFor(department))??escalationApprover(db,tenantId,departmentId);
}
const topExecutive=(db,tenantId)=>activeManager(db,tenantId,escalationFor({sector:''}));
export const approvalFallback=(db,tenantId,departmentId,role)=>db.prepare('SELECT u.id,u.role FROM approval_fallbacks f JOIN users u ON u.id=f.fallback_user_id AND u.tenant_id=f.tenant_id WHERE f.tenant_id=? AND f.department_id=? AND f.step_role=? AND u.active=1').get(tenantId,departmentId,role)??null;
// مدير الإدارة كما يعرفه محرك الطلبات: يحترم department_routing. (service-catalog.headsDepartment أوسع: أي مدير في الإدارة.)
export const isDepartmentHead=(db,u,departmentId)=>departmentHead(db,u,departmentId);
function departmentHead(db,u,departmentId){
  if(u.role!=='manager'||u.department_id!==departmentId)return false;
  const routed=db.prepare("SELECT user_id FROM department_routing WHERE tenant_id=? AND department_id=? AND step_role='department_manager'").get(u.tenant_id,departmentId);
  return routed?routed.user_id===u.id:true;
}
// المنفذون المحتملون لخدمة في إدارة: لإشعار المسار المباشر ولفحص الإعداد. في السرية: مدير الإدارة المنفذة وحده يُشعَر.
// من يحق له التنفيذ في طلب بعينه يُقرأ من executionChain لا من هنا: هذه القائمة قبل فصل المهام وقبل الاحتياط.
const departmentTeam=(db,departmentId,tenantId)=>db.prepare("SELECT * FROM users WHERE tenant_id=? AND department_id=? AND active=1 AND role<>'admin' ORDER BY id").all(tenantId,departmentId);
export function executorsFor(db,s,departmentId,tenantId){
  return departmentTeam(db,departmentId,tenantId).filter(p=>s.approval_policy.confidential?departmentHead(db,p,departmentId):handler(p,s,departmentId));
}
// من يملك التنفيذ فعلًا داخل الإدارة: دور المنفذ، ويضاف في الخدمة السرية مدير الإدارة المنفذة لأن الرؤية تضيق عن بقية الفريق.
// أوسع من executorsFor عمدًا: الإشعار في السرية للمدير وحده، والتنفيذ يبقى لمن يملكه كما كان قبل السلسلة.
export function nativeExecutors(db,s,departmentId,tenantId){
  return departmentTeam(db,departmentId,tenantId).filter(p=>handler(p,s,departmentId)||(!!s.approval_policy.confidential&&departmentHead(db,p,departmentId)));
}
// ── سلسلة التنفيذ التي لا تترك خدمة بلا منفذ (قرار 21 سبتمبر، بعد مسح الـ142) ──────
// المسح أثبت أن تبنّي «فصل المهام» يترك 13 خدمة مال وصلاحيات بلا منفذ: 12 إدارة من 17 فيها حساب واحد
// غير إداري، وهو من اعتمد الطلب. فلا تُترك الخدمة تقف صامتة عند «معتمد»: التنفيذ يمر بثلاث حلقات بالترتيب،
// وإن خلت الثلاث فرفضٌ يسمّي من يُسأل — لا صمت.
//   (1) منفذو الإدارة المنفذة أنفسهم، كما كانوا.
//   (2) النواب المسمّون المقبولون بالرتبة (ترحيل 122): تسميةٌ فعلُ شخصين، والمقترح وحده لا ينفّذ.
//   (3) مرجع تصعيد الإدارة المسجل في department_escalation — موجود للسبع عشرة كلها، وهو بالتعريف
//       شخص آخر غير من قرر، وعلاقته بالإدارة قائمة أصلًا فلا يُسمّى أحد جديد.
// الحلقتان (2) و(3) احتياطٌ ظاهر لا ضمني: شاشة الطلب تقول من ينفّذه وبأي سند، ومن وصله يُخبَر لماذا وصله.
//
// إعادة القياس المستقلة (21 سبتمبر) أثبتت أن الحلقة (3) درجةٌ واحدة لا تكفي: حين يكون صاحب الطلب من داخل
// الإدارة المنفذة، تُصعَّد خطوةُ الاعتماد المكررة إلى مرجع تصعيد الإدارة نفسه، فيصير المرجعُ معتمِدًا في الطلب
// ويسقط بمانع الاحتياط، فتقف أربع خدمات مال ومشتريات عند «معتمد» بلا منفذ. فصارت الحلقة (3) سُلَّمًا:
// مرجع الإدارة، فمرجعُ إدارتِه، حتى الرئيس التنفيذي. كل درجة علاقة مسجلة أصلًا في department_escalation،
// فلا يُسمّى إنسان جديد، وكل درجة إنسان آخر غير من قرر — وهو مقصود السلسلة كلها.
export const EXECUTION_BASIS={native:'منفذ الإدارة المنفذة',deputy:'نائب مسمّى',escalation:'مرجع تصعيد الإدارة'};
// سُلَّم التصعيد لإدارة، بالترتيب ومن غير تكرار: مرجعها المسجل، ثم مرجع إدارة ذلك المرجع، حتى الرئيس التنفيذي.
// الحد ثماني درجات حارسًا من حلقة مغلقة في بيانات مُدخلة يدويًا، والهيكل الحقيقي ثلاث درجات على أكثر تقدير.
export function escalationLadder(db,tenantId,departmentId){
  const rungs=[],seen=new Set();
  let current=departmentId;
  for(let depth=0;depth<8&&current;depth++){
    const above=escalationApprover(db,tenantId,current);
    if(!above||seen.has(above.id))break;
    const person=db.prepare('SELECT id,name,department_id FROM users WHERE id=? AND tenant_id=? AND active=1').get(above.id,tenantId);
    if(!person)break;
    seen.add(person.id);rungs.push({...person,depth});
    current=person.department_id===current?null:person.department_id;
  }
  const top=topExecutive(db,tenantId);
  if(top&&!seen.has(top.id)){
    const person=db.prepare('SELECT id,name,department_id FROM users WHERE id=? AND tenant_id=? AND active=1').get(top.id,tenantId);
    if(person)rungs.push({...person,depth:rungs.length});
  }
  return rungs;
}
// اعتمادان لا يوقعهما شخص واحد. يبدأ البديل بسُلّم الإدارة المسجل، ثم بقية طبقة الرئاسة
// النشطة؛ وهذا يغطي طلبات مدير مكتب الرئيس نفسه حيث يكون الرئيس أول معتمد ولا توجد درجة
// تنظيمية أعلى. ترتيب الحسابات ثابت حتى تبقى لقطة المسار قابلة للتدقيق وإعادة الاختبار.
function distinctApprovalCandidates(db,tenantId,departmentId){
  const candidates=escalationLadder(db,tenantId,departmentId),seen=new Set(candidates.map(person=>person.id));
  const referenced=new Set(db.prepare('SELECT DISTINCT user_id FROM department_escalation WHERE tenant_id=?').all(tenantId).map(row=>row.user_id));
  const executives=activeDepartmentPeople(db,tenantId,'ceo-office').filter(person=>person.role==='manager'&&referenced.has(person.id))
    .sort((a,b)=>(a.id==='ceo'?-1:b.id==='ceo'?1:a.id.localeCompare(b.id)));
  for(const person of executives){
    if(seen.has(person.id))continue;seen.add(person.id);candidates.push({...person,depth:candidates.length});
  }
  return candidates;
}
// لماذا وصل التنفيذ إلى هذه الدرجة بعينها. الدرجة الأولى مرجع الإدارة، وما فوقها يقول صراحةً إن من تحته طرفٌ في الطلب.
const escalationWhy=(depth,department)=>depth===0
  ?`مرجع تصعيد «${department}» المسجل؛ وصله الطلب لأن منفذي الإدارة كلهم أصحابُ قرار فيه أو أصحابُه`
  :`مرجع تصعيد «${department}» نفسه قرر خطوة في هذا الطلب أو هو صاحبه، فصعد التنفيذ درجةً أعلى في سُلَّم التصعيد المسجل`;
// سند وصول خطوة الاعتماد إلى صاحبها، كما يكتبه approval_step_basis عند التقديم. تُقرأ في شاشة الطلب
// فيعرف صاحبه لماذا وصلت الخطوة إلى هذا الشخص بعينه، لا إلى غيره.
// لماذا نُقل قرار خطوة إلى غير معتمدها (approval_step_escalations.basis). «requester_followup» محجوز في القيد ولا كاتب له.
export const ESCALATION_BASIS={timeout:'انقضت مهلة التصعيد المعتمدة ولم يُتخذ القرار',unqualified:'صاحب القرار السابق لم يعد حسابه نشطًا',
  admin_override:'نقله من يدير الهيكل والتصعيد بسبب مكتوب',requester_followup:'متابعة صاحب الطلب'};
export const APPROVAL_BASIS={standard:'المسار المعتمد للخدمة',duplicate_escalation:'صُعّدت لأن الخطوة حُلّت إلى معتمِد سابق في الطلب نفسه',
  fallback:'المعتمد البديل المعيّن للدور في هذه الإدارة',escalation:'مرجع تصعيد الإدارة'};
// النواب المقبولون لخدمة، بالرتبة. «مقترح» لا يُحتسب: لم يقبله ثانٍ بعد.
export const deputiesFor=(db,tenantId,serviceCode)=>db.prepare("SELECT d.*,u.name AS deputy_name,u.department_id FROM execution_deputies d JOIN users u ON u.id=d.user_id AND u.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.service_code=? AND d.status='accepted' AND u.active=1 AND u.role<>'admin' ORDER BY d.rank").all(tenantId,serviceCode);
export const deputyFor=(db,tenantId,serviceCode)=>deputiesFor(db,tenantId,serviceCode)[0]??null;
// من ينفّذ هذا الطلب الآن ولماذا. تُستدعى من قرار الفعل ومن الرؤية ومن الإشعار، فلا ترمي أبدًا:
// العجز يُرجَع وصفًا مقروءًا في refusal يرسمه من يعرضه أو يرميه من يحتاج رميه.
export function executionChain(db,s,r,departmentId=handlingDepartmentId(db,r)){
  const tenantId=r.tenant_id,beneficiary=beneficiaryOf(db,r),sod=!!s.approval_policy.sod;
  // منفذ الإدارة يُمنع بصاحب الطلب والمستفيد دائمًا، وبمن اعتمد حين تمنع الخدمة الجمع (sod).
  const nativeBarred=p=>p===r.requester_id||p===beneficiary||(sod&&approvedInRevision(db,r,p));
  // الاحتياط أضيق: من قرر خطوة في هذه النسخة لا ينفّذ ولو لم تكن الخدمة معلّمة sod، لأن الاحتياط
  // إنما وُجد ليأتي بشخص ثانٍ لا ليعيد الأول من باب آخر.
  const fallbackBarred=p=>p===r.requester_id||p===beneficiary||approvedInRevision(db,r,p);
  const base={department_id:departmentId,refusal:null};
  const own=nativeExecutors(db,s,departmentId,tenantId).filter(p=>!nativeBarred(p.id));
  // من يُشعَر في الحلقة الأولى أضيق ممن يملك التنفيذ في الخدمة السرية: المدير وحده يُبلَّغ، والفريق كما كان.
  if(own.length)return {...base,basis:'native',label:EXECUTION_BASIS.native,people:own.map(p=>({id:p.id,name:p.name,why:''})),
    told:executorsFor(db,s,departmentId,tenantId).filter(p=>!nativeBarred(p.id)).map(p=>p.id)};
  const deputies=deputiesFor(db,tenantId,s.code).filter(d=>!fallbackBarred(d.user_id));
  if(deputies.length)return {...base,basis:'deputy',label:EXECUTION_BASIS.deputy,
    people:deputies.map(d=>({id:d.user_id,name:d.deputy_name,rank:d.rank,why:d.basis}))};
  // ── الدائرة المغلقة تقف هنا (إعادة القياس، العطب 6) ──────────────────────────
  // التظلّم وبلاغ المخالفة لا تتسع دائرة قارئيهما بعلاقة تنظيمية عامة: مرجع تصعيد الإدارة مرجعٌ في كل شيء
  // ولم يسمّه أحد لهذه الخدمة بعينها، وقد يكون هو موضوع البلاغ. النائب المسمّى يبقى طريقًا لأن تسميته فعل
  // شخصين مكتوب يقول بالاسم من يقرأ هذا النوع. وإن لم يكن نائب، فرفضٌ يسمّي من يُسأل — لا توسعةٌ صامتة.
  const closedCircle=!!s.approval_policy.closed_circle;
  const ladder=closedCircle?[]:escalationLadder(db,tenantId,departmentId);
  const department=departmentName(db,tenantId,departmentId);
  const rung=ladder.find(p=>!fallbackBarred(p.id));
  if(rung)return {...base,basis:'escalation',label:EXECUTION_BASIS.escalation,
    people:[{id:rung.id,name:rung.name,why:escalationWhy(rung.depth,department)}]};
  return {...base,basis:'none',label:'',people:[],refusal:executionGap(db,r,s,departmentId,closedCircle,ladder)};
}
export const departmentName=(db,tenantId,departmentId)=>db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(departmentId,tenantId)?.name??departmentId;
// وصف العجز كما يقرؤه إنسان: ما الناقص، ومن يملكه، وما الخطوة التالية. يُعرض في شاشة الطلب ويُرمى عند الاعتماد.
// الدائرة المغلقة تُقال سببًا لا تُخفى: من يقرأ الرفض يعرف أن سُلَّم التصعيد لم يُستعمل عمدًا، فلا يظنه عطلًا.
function executionGap(db,r,s,departmentId,closedCircle,ladder){
  const department=departmentName(db,r.tenant_id,departmentId);
  const owner=db.prepare('SELECT u.id,u.name FROM department_escalation e JOIN users u ON u.id=e.user_id WHERE e.tenant_id=? AND e.department_id=?').get(r.tenant_id,departmentId);
  const who=owner?.name?`${owner.name} أو من يدير الهيكل والتصعيد`:'من يدير الهيكل والتصعيد';
  const why=closedCircle
    ?'الخدمة بلاغٌ سري عن شخص، فلا يصلها مرجع تصعيد الإدارة لمجرد أنه مرجعها — وقد يكون هو موضوعها؛ من ينفّذها يُسمّى لها بعينها ويقبله ثانٍ'
    :(ladder.length?'كل درجة في سُلَّم تصعيد الإدارة — حتى الرئيس التنفيذي — صاحبُ هذا الطلب أو المستفيد منه أو من قرر خطوة فيه'
      :'لا مرجع تصعيد مسجلًا لهذه الإدارة، ولا منفذ فيها غير أصحاب القرار');
  return {what:`لا أحد يملك تنفيذ هذا الطلب في «${department}» الآن`,
    missing:[{document:closedCircle?`نائب منفّذ مقبول لخدمة ${s.code} السرية`:`نائب منفّذ مقبول لخدمة ${s.code}، أو درجة في سُلَّم تصعيد «${department}» ليست طرفًا في هذا الطلب`,
      why,owner:owner?.name??'من يدير الهيكل والتصعيد',owner_role:'structure.manage'}],
    next:`اطلب من ${who} أن يسمّي نائبًا منفّذًا لهذه الخدمة من «إعداد الاعتماد»، ويقبله شخص ثانٍ قبل أن ينفّذ`,
    link:'#approval-settings'};
}
// لحظة صيرورة الطلب «معتمدًا»: لا يُسلَّم إلى الفراغ. تُحسب السلسلة، فإن خلت رُفض الاعتماد برفض يسمّي
// من يُسأل بدل أن يقف الطلب صامتًا عند «معتمد» بلا نهاية — وهو ما كان يحدث في 13 خدمة مال وصلاحيات.
// ومن وصله الطلب بالحلقة الاحتياطية يُخبَر لماذا وصله، فلا يصل إشعارٌ بلا سبب مقروء.
function handOverToExecutors(db,r,s,departmentId,actorId){
  const chain=executionChain(db,s,r,departmentId);
  if(chain.basis==='none')refuse(409,'no_executor',chain.refusal);
  const told=new Set(chain.told??chain.people.map(p=>p.id));
  for(const person of chain.people)
    if(person.id!==actorId&&told.has(person.id))notify(db,person.id,r.id,chain.basis==='native'?'ready_for_execution':'ready_for_execution_fallback',{basis:chain.label,why:person.why});
  return chain;
}
// التوافق مع ما كُتب قبل السلسلة: هل هذا الحساب منفّذ بسند احتياطي في هذا الطلب؟
function deputyExecutor(db,u,s,r,departmentId){
  if(!u)return null;
  const chain=executionChain(db,s,r,departmentId);
  if(chain.basis==='native'||chain.basis==='none')return null;
  const person=chain.people.find(p=>p.id===u.id);
  return person?{...person,basis:chain.basis,label:chain.label}:null;
}
export function isHandler(db,supplied,r){
  const u=currentUser(db,supplied);if(!u||u.id===r.requester_id||beneficiaryOf(db,r)===u.id)return false;
  return handler(u,serviceOf(db,r),handlingDepartmentId(db,r));
}
// B3: من اعتمد أي خطوة في النسخة الحالية (أصالةً أو بالتفويض) لا يستلم ولا يغلق خدمة معلّمة sod.
// ومن حمل قرارها: التصعيد الحقيقي ينقل القرار في جدول جانبي ولا يمس approver_id، فمن وصله القرار — وكل من مرّ به —
// كان يسقط من هذا الحكم كله حين يقرر عنه مفوَّضه (decided_by المفوَّض، وapprover_id المعتمد الأصلي). الحكم يقرأ
// الخطوة وسُلَّم تصعيدها معًا: حامل القرار طرفٌ في الاعتماد سواء قرر بنفسه أو قرر عنه مفوَّضه.
const approvedInRevision=(db,r,userId)=>!!db.prepare(`SELECT 1 FROM approval_steps s WHERE s.request_id=? AND s.revision=? AND s.status='approved'
  AND (s.decided_by=? OR s.approver_id=? OR EXISTS(SELECT 1 FROM approval_step_escalations e WHERE e.step_id=s.id AND ? IN (e.from_user_id,e.to_user_id)))`).get(r.id,r.revision,userId,userId,userId);
function legacyScope(db,r,service,expected,principal,departmentId){
  if(principal.role!==stepRole(expected.role))return false;
  const requester=db.prepare('SELECT manager_id,department_id FROM users WHERE id=? AND tenant_id=?').get(r.requester_id,r.tenant_id);
  const escalated=principal.role==='manager'&&((expected.role==='department_manager'&&principal.id===escalationApprover(db,r.tenant_id,departmentId)?.id)||(expected.role==='manager'&&!requester?.manager_id&&principal.id===escalationApprover(db,r.tenant_id,requester?.department_id)?.id));
  return escalated||(expected.role==='manager'?requester?.manager_id===principal.id&&requester.department_id===principal.department_id:principal.department_id===departmentId);
}
// ── من يملك قرار خطوة (الموجة 2، العطب 6) ──────────────────────────────────────
// authorizedStepBase هو الحكم كما كان قبل التصعيد الحقيقي، حرفًا بحرف: لا يُعدَّل. يُصدَّر لاختبار التكافؤ وحده
// (tests/escalation-equivalence.test.mjs يثبّت بصمة نصه ويقارن به كل (مستخدم، طلب، خطوة) حين لا صف تصعيد).
export function authorizedStepBase(db,u,r,step) {
  u=currentUser(db,u);
  if(!step||!u||u.tenant_id!==r.tenant_id||u.id===r.requester_id) return false;
  const service=getService(db,u,r.service_id);
  const expected=normalizeStep(service.approval_policy.steps[step.position]);
  const principal=currentUser(db,{id:step.approver_id,tenant_id:r.tenant_id});
  if(!expected||!principal||principal.id===r.requester_id) return false;
  const beneficiary=beneficiaryOf(db,r);
  if(beneficiary&&(beneficiary===u.id||beneficiary===principal.id))return false;
  const basis=stepBasis(db,step.id),departmentId=basis?.department_id??expected.department??service.department_id;
  let inScope;
  if(!basis||basis.basis==='standard')inScope=legacyScope(db,r,service,expected,principal,departmentId);
  else if(basis.basis==='fallback')inScope=principal.id===approvalFallback(db,r.tenant_id,departmentId,basis.step_role)?.id;
  else if(basis.basis==='escalation'||basis.basis==='duplicate_escalation'){const above=escalationApprover(db,r.tenant_id,departmentId);inScope=principal.role==='manager'&&principal.id===above?.id;}
  else if(basis.basis==='executive')inScope=principal.role==='manager'&&(principal.id===executiveFor(db,r.tenant_id,departmentId)?.id||principal.id===topExecutive(db,r.tenant_id)?.id);
  else inScope=false;
  return inScope&&(principal.id===u.id||!!delegationFor(db,u,principal,service.code));
}
// التصعيد الحقيقي ينقل القرار ولا يلمس الخطوة: approver_id لا يُعدَّل (مشغّل 002)، فمن يملك القرار الآن يُقرأ من الجدول
// الجانبي approval_step_escalations (ترحيل 126) — أعلى درجة فيه — كما يُقرأ التفويض من جدوله. بلا صف: الحكم القديم بعينه.
// مع صف: من وصله القرار (أو مفوَّضه) يقرر، والمعتمد الأصلي وكل من مرّ به القرار قبله لا يقرر. نطاق من وصله القرار
// لا يُعاد فحصه بدور الخطوة: سنده صف التصعيد نفسه، وكاتبه (app/step-escalation.mjs) لا يكتبه إلا لدرجة في السُلَّم المسجل.
export const escalationOf=(db,stepId)=>db.prepare('SELECT * FROM approval_step_escalations WHERE step_id=? ORDER BY level DESC LIMIT 1').get(stepId)??null;
export const deciderOf=(db,step)=>escalationOf(db,step.id)?.to_user_id??step.approver_id;
function authorizedStep(db,u,r,step) {
  const moved=step?escalationOf(db,step.id):null;
  if(!moved){
    // المسار القديم يبقى حرفيًا لكل خطوة عادية. الاستثناء الوحيد خطوة تكررت هوية
    // معتمدها ثم نُقلت صراحةً إلى شخص مستقل من سُلّم التصعيد أو طبقة الرئاسة.
    const basis=step?stepBasis(db,step.id):null;
    if(basis?.basis!=='duplicate_escalation')return authorizedStepBase(db,u,r,step);
    u=currentUser(db,u);
    if(!u||u.tenant_id!==r.tenant_id||u.id===r.requester_id)return false;
    const principal=currentUser(db,{id:step.approver_id,tenant_id:r.tenant_id});
    if(!principal||principal.id===r.requester_id)return false;
    const beneficiary=beneficiaryOf(db,r);
    if(beneficiary&&(beneficiary===u.id||beneficiary===principal.id))return false;
    const service=getService(db,u,r.service_id),departmentId=basis.department_id??service.department_id;
    const inScope=principal.role==='manager'&&distinctApprovalCandidates(db,r.tenant_id,departmentId).some(person=>person.id===principal.id);
    return inScope&&(principal.id===u.id||!!delegationFor(db,u,principal,service.code));
  }
  u=currentUser(db,u);
  if(!u||u.tenant_id!==r.tenant_id||u.id===r.requester_id) return false;
  const principal=currentUser(db,{id:moved.to_user_id,tenant_id:r.tenant_id});
  if(!principal||principal.id===r.requester_id) return false;
  const beneficiary=beneficiaryOf(db,r);
  if(beneficiary&&(beneficiary===u.id||beneficiary===principal.id))return false;
  return principal.id===u.id||!!delegationFor(db,u,principal,getService(db,u,r.service_id).code);
}
// للاختبار وللكاتب: الحكم الساري على خطوة بعينها.
export const mayDecideStep=(db,u,r,step)=>authorizedStep(db,u,r,step);
function visible(db,u,r) {
  u=currentUser(db,u);
  if(!u||r.tenant_id!==u.tenant_id) return false;
  if(r.requester_id===u.id) return true;
  const steps=db.prepare('SELECT * FROM approval_steps WHERE request_id=? AND revision=?').all(r.id,r.revision);
  if(steps.some(step=>authorizedStep(db,u,r,step))) return true;
  // من نُقل القرار عنه يبقى قارئًا لهذه النسخة: إشعار «انتقل القرار» يفتح الطلب، وnoticeView يحجب إشعار طلب لا يراه صاحبه.
  // قراءة لا قرار: actions لا تعطيه اعتمادًا ولا إعادة ولا رفضًا. لا يُبلغ هذا السطر إلا بوجود صف تصعيد.
  if(db.prepare('SELECT 1 FROM approval_step_escalations e JOIN approval_steps s ON s.id=e.step_id WHERE e.request_id=? AND s.revision=? AND e.from_user_id=?').get(r.id,r.revision,u.id)) return true;
  if(db.prepare('SELECT 1 FROM request_tasks WHERE request_id=? AND assignee_id=?').get(r.id,u.id)) return true;
  if(!['approved','in_progress','completed'].includes(r.status))return false;
  const service=getService(db,u,r.service_id),departmentId=handlingDepartmentId(db,r);
  // من وصله الطلب بالحلقة الاحتياطية — نائب مسمّى أو مرجع تصعيد الإدارة — يراه، وهو وحده ما يراه منه.
  if(deputyExecutor(db,u,service,r,departmentId))return true;
  // B6: الخدمة السرية لا تُفتح لكل فريق الإدارة المنفذة؛ للمسند إليه ومدير الإدارة المنفذة فقط (ومن سبق أعلاه).
  if(service.approval_policy.confidential)return (r.assigned_to===u.id&&u.department_id===departmentId)||departmentHead(db,u,departmentId);
  return handler(u,service,departmentId);
}
export function getRequest(db,u,rid) {
  const r=db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(rid,u.tenant_id);
  if(!r||!visible(db,u,r)) fail(404,'not_found','الطلب غير موجود أو غير متاح لك');
  return r;
}
function currentStep(db,r) {
  return db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
}
// الخطوات السارية الآن: كل المعلقة في المسار المتوازي، وأولاها في المتسلسل. تُصدَّر لكاتب التصعيد وللتشغيل اليومي.
export const currentPendingSteps=(db,r)=>r.status==='pending'?pendingSteps(db,r):[];
function pendingSteps(db,r){
  const steps=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position").all(r.id,r.revision);
  const service=getService(db,{tenant_id:r.tenant_id},r.service_id);
  return service.approval_policy.mode==='parallel'?steps:steps.slice(0,1);
}
function isApprover(db,u,r) {
  return r.status==='pending'&&pendingSteps(db,r).some(step=>authorizedStep(db,u,r,step));
}
// متى وصلت الخطوة إلى صاحبها فعلًا: في المسار المتسلسل عند قرار آخر خطوة قبلها في النسخة نفسها، وفي المتوازي
// (وفي الخطوة الأولى) عند تقديم النسخة. لا تُقرأ من requests.updated_at أبدًا: المتابعة والمرفق والمهمة كلها تغيّره،
// فكان الضغط على «متابعة» يصفّر العمر الذي يقيسه التذكير اليومي — مطاردة الاعتماد تلغي مطاردته الآلية.
export function stepArrivedAt(db,r,step){
  // خطوة نُقل قرارها: وصلت صاحب قرارها الحالي لحظة نُقلت إليه، فلا يُحمَّل انتظار من سبقه.
  const moved=escalationOf(db,step.id);if(moved)return moved.created_at;
  const submitted=db.prepare('SELECT created_at FROM request_versions WHERE request_id=? AND revision=?').get(r.id,r.revision)?.created_at;
  const policy=getService(db,{tenant_id:r.tenant_id},r.service_id).approval_policy;
  const previous=policy.mode==='parallel'?null:db.prepare('SELECT MAX(decided_at) AS at FROM approval_steps WHERE request_id=? AND revision=? AND position<?').get(r.id,r.revision,step.position)?.at;
  return previous||submitted||r.created_at;
}
// الخطوات المعلقة التي يملك هذا الشخص قرارها الآن (أصالةً أو بتفويض)، ومعها لحظة وصول كل منها إليه.
export function pendingStepsFor(db,supplied,r){
  const u=currentUser(db,supplied);if(!u||r.status!=='pending')return [];
  return pendingSteps(db,r).filter(step=>authorizedStep(db,u,r,step)).map(step=>({...step,arrived_at:stepArrivedAt(db,r,step)}));
}
// ── «تذكير المعتمد» (كان اسمه «متابعة اعتماد متأخر» ويُسجَّل «تصعيدًا») ────────────────
// هذا الفعل تذكير لا تصعيد: يصل صاحبَ القرار نفسه، ولا ينقل القرار إلى أحد (authority_changed:false). سُمّي بما يفعله.
// مفاتيحه الداخلية تبقى كما هي — الفعل 'escalate'، وسجل التدقيق 'escalate'، ونوع الإشعار 'approval_escalated'، والرمز
// 'escalation_unavailable' — لأن اختبارات مسجلة وصفوفًا قديمة تقرؤها؛ وكل نص يقرؤه إنسان يقول «تذكير».
// نقل القرار فعلًا في app/step-escalation.mjs (escalateStep): جدول جانبي، وإشعاران، وauthority_changed:true.
// الخطوة التي نُقل قرارها تُذكَّر عند من وصله القرار: approval_followups يشترط أن المستلم معتمد الخطوة المسجل (مشغّل 013)،
// فتذكير الخطوة المصعَّدة يُمنع تكراره بمفتاح في reminder_log لكل درجة، وعمره من لحظة وصول القرار إلى صاحبه الحالي.
const reminderKey=(step,moved)=>`step-reminder:${step.id}:${moved.level}`;
function escalatableSteps(db,u,r) {
  if(r.status!=='pending')return [];
  return pendingSteps(db,r).filter(step=>{
    if(r.requester_id!==u.id&&!authorizedStep(db,u,r,step))return false;
    const moved=escalationOf(db,step.id);
    const principal=currentUser(db,{id:moved?.to_user_id??step.approver_id,tenant_id:r.tenant_id});
    if(!principal||!authorizedStep(db,principal,r,step))return false;
    if(moved?db.prepare('SELECT 1 FROM reminder_log WHERE tenant_id=? AND reminder_key=?').get(r.tenant_id,reminderKey(step,moved))
      :db.prepare('SELECT 1 FROM approval_followups WHERE step_id=?').get(step.id))return false;
    return Date.now()-Date.parse(stepArrivedAt(db,r,step))>=86400000;
  });
}
export const remindApprover=(db,supplied,rid,input)=>escalateApproval(db,supplied,rid,input);
export function escalateApproval(db,supplied,rid,input) {
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ المتابعة داخل معاملة');
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');
  v.object(input,['version','note']);const r=getRequest(db,u,rid);v.version(input.version,r.version);
  const steps=escalatableSteps(db,u,r);if(!steps.length)fail(409,'escalation_unavailable','تذكير المعتمد متاح مرة واحدة للخطوة المعلقة بعد 24 ساعة من وصولها إليه، بصلاحيات سارية');
  const note=v.text(input.note,'سبب تذكير المعتمد',3000,3),recipients=[];
  for(const step of steps){
    const moved=escalationOf(db,step.id),recipient=moved?.to_user_id??step.approver_id;
    if(moved)db.prepare('INSERT INTO reminder_log(tenant_id,reminder_key,created_at) VALUES(?,?,?)').run(r.tenant_id,reminderKey(step,moved),now());
    else db.prepare('INSERT INTO approval_followups VALUES(?,?,?,?,?,?,?)').run(id(),step.id,r.id,u.id,step.approver_id,note,now());
    notify(db,recipient,r.id,'approval_escalated');recipients.push(recipient);
  }
  // updated_at يتغير هنا ولا يقيس به أحدٌ عمرًا: عمر الانتظار من stepArrivedAt وحدها (الموجة 1، العطب 7).
  db.prepare('UPDATE requests SET version=version+1,updated_at=? WHERE id=?').run(now(),rid);
  audit(db,u,'request',rid,'escalate',auditSnapshot(r),{step_ids:steps.map(s=>s.id),recipients,authority_changed:false,kind:'reminder'},note);
  return detail(db,u,rid);
}
export function actions(db,u,r) {
  u=currentUser(db,u);if(!u)return [];
  const result=[];
  if(r.requester_id===u.id) {
    if(editable(r)) result.push('edit','attach','submit');
    if(['draft','returned','pending','approved'].includes(r.status)) result.push('cancel');
    // الموجة 2 (المراجعة): الطلب المنقضي لعدم الرد أُغلق بقرار لم يتخذه صاحبه، فله وحده أن يعيد تقديمه من بياناته
    // (returned-requests.resubmitLapsed تنشئ مسودة جديدة ولا تفتح المنقضي). الاستعلام مباشر لا باستيراد: تلك الوحدة تستورد هذه.
    if(r.status==='cancelled'&&db.prepare('SELECT 1 FROM request_lapses WHERE request_id=?').get(r.id)) result.push('resubmit');
  }
  if(isApprover(db,u,r)) result.push('approve','return','reject');
  if(escalatableSteps(db,u,r).length)result.push('escalate');
  if(!['approved','in_progress'].includes(r.status))return result;
  const s=getService(db,u,r.service_id),departmentId=handlingDepartmentId(db,r);
  // B7: المستفيد لا ينفّذ طلبًا يخصه، كما لا يعتمده.
  if(r.requester_id===u.id||beneficiaryOf(db,r)===u.id)return result;
  // سلسلة التنفيذ هي القرار الواحد: منفذو الإدارة، فالنواب المقبولون، فمرجع التصعيد. من ليس فيها لا ينفّذ،
  // ومن فيها نفّذ بسند مسمّى. فصل المهام مطبَّق داخلها، فلا حاجة إلى منعٍ ثانٍ هنا.
  const executing=executionChain(db,s,r,departmentId).people.some(p=>p.id===u.id);
  // التحويل وإسناد المهام يفحصهما routing.mjs بدور المنفذ حرفيًا؛ لا يُعرضان إلا لمن سيقبله ذلك الفحص.
  const routes=handler(u,s,departmentId);
  if(executing&&r.status==='approved') result.push('claim');
  if(routes) result.push('transfer','assign_task');
  // بعض عقود المخرج تعتمد ملفًا فعليًا على الطلب. منفذ الطلب المسمى يرفع هذا
  // الملف أثناء التنفيذ، ثم يبقى قبول المخرج بيد صاحب الطلب قبل الإغلاق.
  if(executing&&r.status==='in_progress'&&r.assigned_to===u.id&&outputContract(s.code)?.requires_attachment) result.push('attach');
  if(executing&&r.status==='in_progress'&&r.assigned_to===u.id&&!openTasks(db,r.id)) result.push('complete');
  // الموجة 2، العطب 8: من يباشر الطلب يملك إعادته إلى طابور إدارته بسبب مكتوب (app/request-assignment.mjs)، ولو خرج من سلسلة التنفيذ.
  if(r.status==='in_progress'&&r.assigned_to===u.id) result.push('release');
  return result;
}
// من ينفّذ هذا الطلب وبأي سند، كما يُعرض في شاشته. الاحتياط ظاهر لا ضمني: «نائب مسمّى» أو «مرجع تصعيد الإدارة»
// يُكتبان باسمهما، والعجز يُكتب رفضًا يسمّي من يُسأل. قبل الاعتماد لا سؤال بعد، فتبقى القيمة فارغة.
export function executionView(db,u,r){
  if(!['approved','in_progress','completed'].includes(r.status))return null;
  const service=getService(db,{tenant_id:r.tenant_id},r.service_id);
  const chain=executionChain(db,service,r);
  return {basis:chain.basis,label:chain.label,department_id:chain.department_id,refusal:chain.refusal,
    fallback:chain.basis==='deputy'||chain.basis==='escalation',mine:chain.people.some(p=>p.id===u.id),
    people:chain.people.map(p=>({id:p.id,name:p.name,rank:p.rank??null,why:p.why??''}))};
}
// «من يعتمد هذا الطلب، ومن ينفّذه، وبأي سند، وهل يجوز أن يكونا شخصًا واحدًا» — على الطلب نفسه، بلا قراءة كود.
// السؤال الأخير ليس نظريًا: المسح وجد 115 طلبًا من 142 نفّذه الحسابُ الذي اعتمده. حين يجوز الجمع يُقال إنه جائز،
// وحين يقع فعلًا يُقال إنه وقع — الجمع في الخدمة العادية مُسجَّل ومعروض لا ممنوع، وفي الحسّاسة ممنوع أصلًا.
export function workflowView(db,u,r){
  const service=getService(db,{tenant_id:r.tenant_id},r.service_id),sod=!!service.approval_policy.sod;
  const approvers=db.prepare(`SELECT s.id AS step_id,s.position,s.status,s.approver_id,s.decided_by,x.name AS approver_name,d.name AS decided_by_name,b.step_role,b.basis,b.note
    FROM approval_steps s JOIN users x ON x.id=s.approver_id LEFT JOIN users d ON d.id=s.decided_by
    LEFT JOIN approval_step_basis b ON b.step_id=s.id WHERE s.request_id=? AND s.revision=? ORDER BY s.position`).all(r.id,r.revision)
    .map(row=>{const moved=escalationOf(db,row.step_id);
      return {position:row.position,status:row.status,name:row.approver_name,decided_by_name:row.decided_by_name,
      role:row.step_role??'',basis:row.basis??'standard',basis_label:APPROVAL_BASIS[row.basis??'standard']??APPROVAL_BASIS.standard,note:row.note??'',
      // القرار نُقل: اسم المعتمد الأصلي يبقى (الخطوة لا تُعدَّل)، ومعه من يملك القرار الآن ولماذا وصله.
      ...(moved?{decider_name:db.prepare('SELECT name FROM users WHERE id=?').get(moved.to_user_id)?.name??'',escalation_level:moved.level,escalation_basis:moved.basis,
        escalation_label:ESCALATION_BASIS[moved.basis]??moved.basis,escalation_reason:moved.reason,escalated_at:moved.created_at}:{})};});
  const chain=['approved','in_progress','completed'].includes(r.status)?executionChain(db,service,r):null;
  const deciders=new Set(approvers.filter(a=>a.status==='approved').map(a=>a.decided_by_name).filter(Boolean));
  // ومن حمل القرار بالتصعيد يُسمّى معهم ولو قرر عنه مفوَّضه: الشاشة تقول من ملك القرار فعلًا، لا من ضغط الزر وحده.
  for(const held of db.prepare(`SELECT u.name FROM approval_step_escalations e JOIN approval_steps s ON s.id=e.step_id JOIN users u ON u.id=e.to_user_id
    WHERE s.request_id=? AND s.revision=? AND s.status='approved'`).all(r.id,r.revision))deciders.add(held.name);
  // الجمع الواقع: من أغلق الطلب أو يباشره هو نفسه من قرر خطوة فيه.
  const executor=r.assigned_to?db.prepare('SELECT id,name FROM users WHERE id=?').get(r.assigned_to):null;
  const deciderIsExecutor=!!executor&&approvedInRevision(db,r,executor.id);
  return {
    approves:approvers,
    executes:chain?{basis:chain.basis,label:chain.label,people:chain.people.map(p=>({id:p.id,name:p.name,why:p.why??''}))}:null,
    claimed_by:executor?{id:executor.id,name:executor.name}:null,
    separation_of_duties:sod,same_person_allowed:!sod,
    same_person_note:sod
      ?'فصل المهام مُشغَّل على هذه الخدمة: من اعتمد خطوة فيها لا يستلمها ولا يغلقها. إن لم يبقَ في الإدارة المنفذة منفذ غير من اعتمد، وصل الطلبُ نائبًا منفّذًا مسمًّى، فإن لم يوجد فمرجعَ تصعيد الإدارة.'
      :'فصل المهام غير مُشغَّل على هذه الخدمة: يجوز أن يكون المعتمِد هو المنفّذ نفسه. الجمع لا يُمنع هنا، لكنه يُسجَّل ويظهر هنا وفي فحص الكتالوج.',
    decider_is_executor:deciderIsExecutor,
    decider_is_executor_note:deciderIsExecutor?`نفّذ هذا الطلبَ من قرر فيه خطوة: ${executor.name}. مسموح في هذه الخدمة، ومذكور هنا حتى لا يمر بلا أثر.`:'',
    deciders:[...deciders]};
}
export function detail(db,u,rid) {
  const r=getRequest(db,u,rid);
  const current=db.prepare('SELECT snapshot FROM request_versions WHERE request_id=? AND revision=?').get(r.id,r.revision);
  return {...r,payload:JSON.parse(r.payload),service:getService(db,u,r.service_id),actions:actions(db,u,r),execution:executionView(db,currentUser(db,u)??u,r),workflow:workflowView(db,currentUser(db,u)??u,r),delivery_outputs:serviceOutputView(db,u,r.id),
    approval_notes:current?JSON.parse(current.snapshot).approval_notes??[]:[],
    requester_name:db.prepare('SELECT name FROM users WHERE id=?').get(r.requester_id).name,
    approvals:db.prepare('SELECT a.*,u.name AS approver_name,d.name AS decided_by_name FROM approval_steps a JOIN users u ON u.id=a.approver_id LEFT JOIN users d ON d.id=a.decided_by WHERE request_id=? ORDER BY revision,position').all(r.id),
    followups:db.prepare('SELECT * FROM approval_followups WHERE request_id=? ORDER BY created_at').all(r.id),
    // نقل القرار: صفوفه كلها (السُلَّم قد يعلو أكثر من درجة)، بأسماء من نُقل عنه ومن وصله.
    escalations:db.prepare('SELECT e.id,e.step_id,e.level,e.basis,e.reason,e.created_at,e.from_user_id,e.to_user_id,f.name AS from_name,t.name AS to_name FROM approval_step_escalations e JOIN users f ON f.id=e.from_user_id JOIN users t ON t.id=e.to_user_id WHERE e.request_id=? ORDER BY e.created_at,e.level').all(r.id)
      .map(row=>({...row,basis_label:ESCALATION_BASIS[row.basis]??row.basis})),
    attachments:db.prepare('SELECT id,filename,media_type,size,digest,created_at FROM attachments WHERE request_id=? ORDER BY created_at').all(r.id),
    versions:db.prepare('SELECT * FROM request_versions WHERE request_id=? ORDER BY revision').all(r.id).map(x=>({...x,snapshot:JSON.parse(x.snapshot)})),
    audit:db.prepare("SELECT a.seq,a.action,a.reason,a.created_at,a.policy_version,a.hash,u.name AS actor_name FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=? AND a.entity_type='request' AND a.entity_id=? ORDER BY a.seq").all(u.tenant_id,r.id)
  };
}
export function listRequests(db,u,query='',status='') {
  // SQL narrows to possible matches; visible() remains the authorization decision.
  const result=db.prepare(`SELECT r.* FROM requests r JOIN services s ON s.id=r.service_id WHERE r.tenant_id=? AND (r.requester_id=?
    OR EXISTS(SELECT 1 FROM approval_steps a WHERE a.request_id=r.id AND a.revision=r.revision AND (a.approver_id=? OR a.approver_id IN (SELECT grantor_id FROM approval_delegations WHERE delegate_id=? AND revoked_at IS NULL)))
    OR EXISTS(SELECT 1 FROM approval_step_escalations e JOIN approval_steps a ON a.id=e.step_id WHERE e.request_id=r.id AND a.revision=r.revision AND (e.to_user_id=? OR e.from_user_id=? OR e.to_user_id IN (SELECT grantor_id FROM approval_delegations WHERE delegate_id=? AND revoked_at IS NULL)))
    OR EXISTS(SELECT 1 FROM request_tasks t WHERE t.request_id=r.id AND t.assignee_id=?)
    OR (r.status IN ('approved','in_progress','completed') AND COALESCE(r.handling_department_id,s.department_id)=? AND (json_extract(s.approval_policy,'$.handler_role') IN (?,'member') OR ?='manager'))
    OR (r.status IN ('approved','in_progress') AND EXISTS(SELECT 1 FROM execution_deputies d WHERE d.tenant_id=r.tenant_id AND d.service_code=s.code AND d.user_id=? AND d.status='accepted'))
    OR (r.status IN ('approved','in_progress') AND EXISTS(SELECT 1 FROM department_escalation x WHERE x.tenant_id=r.tenant_id AND x.department_id=COALESCE(r.handling_department_id,s.department_id) AND x.user_id=?)))
    ORDER BY r.updated_at DESC,r.id`).all(u.tenant_id,u.id,u.id,u.id,u.id,u.id,u.id,u.id,u.department_id,u.role,u.role,u.id,u.id).filter(r=>visible(db,u,r));
  const q=String(query).toLocaleLowerCase();
  // handling_department_id (ت1): الإدارة المنفّذة للصفّ نفسه الذي يراه الحساب أصلًا — تقرؤه «الطلبات الواردة» في صفحة الإدارة. حقلٌ لا وصول.
  return result.filter(r=>(!status||r.status===status)&&(!q||r.title.toLocaleLowerCase().includes(q)||r.id.includes(q))).map(r=>{const service=getService(db,u,r.service_id);
    return {id:r.id,title:r.title,status:r.status,version:r.version,revision:r.revision,created_at:r.created_at,updated_at:r.updated_at,requester_id:r.requester_id,service_name:service.name_ar,
      handling_department_id:r.handling_department_id??service.department_id,needs_me:isApprover(db,u,r)};});
}
// الإشعار يحمل عنوان الطلب وما حدث له لحظة الحدث (B7): «اعتُمد طلبك «...»» لا «تحديث على طلبك».
function notify(db,userId,rid,kind,detail={}) {
  const text=requestNotice(kind,db.prepare('SELECT title FROM requests WHERE id=?').get(rid)?.title??'',detail);
  db.prepare("INSERT INTO notifications(id,user_id,request_id,kind,created_at,subject_kind,subject_id,title,body,category) VALUES(?,?,?,?,?,'request',?,?,?,?)").run(id(),userId,rid,kind,now(),rid,text.title,text.body,categoryOf({kind,subject_kind:'request'}));
}
const SETTING_KEY=/^[a-z][a-z0-9_.]{2,59}$/;
// سياسة الاعتماد المخزنة مع نسخة الخدمة. الشكل القديم ({steps:[نصوص 1–3], handler_role, mode?}) يُقبل ويُخزن كما هو.
// الإضافات كلها اختيارية: خطوات كائنية، شروط، حتى 5 خطوات، mode:'direct'، handler_role:'member'، sod،
// confidential، وclosed_circle (بلاغٌ عن شخص: لا يصعد تنفيذه في سُلَّم التصعيد).
export function validatePolicy(db,u,input,fields){
  const policy=v.object(input,['steps','handler_role','mode','sod','confidential','closed_circle']);
  const bad=message=>fail(400,'policy',message);
  if(!Array.isArray(policy.steps)||policy.steps.length>MAX_STEPS||!HANDLER_ROLES.includes(policy.handler_role))bad('سياسة الاعتماد غير صالحة');
  if(policy.mode!==undefined&&!['parallel','sequential','direct'].includes(policy.mode))bad('يلزم دور مختلف لكل خطوة ونمط متسلسل أو متوازٍ أو مباشر');
  for(const flag of ['sod','confidential','closed_circle'])if(policy[flag]!==undefined&&typeof policy[flag]!=='boolean')bad('أعلام السياسة قيم منطقية');
  // المسار المباشر وحده يقبل خدمة بلا خطوات، وأي خدمة غير مباشرة تلزمها خطوة واحدة على الأقل لا شرط عليها.
  if(!isDirect(policy)&&(!policy.steps.length||policy.steps.every(s=>normalizeStep(s)?.when)))bad('الخدمة غير المباشرة تلزمها خطوة اعتماد واحدة على الأقل بلا شرط');
  const seen=new Set();
  for(const raw of policy.steps){
    const step=normalizeStep(raw);
    if(!step)bad('سياسة الاعتماد غير صالحة');
    if(typeof raw==='string'){if(!LEGACY_STEP_ROLES.includes(raw))bad('سياسة الاعتماد غير صالحة');}
    else{
      v.object(step,['role','department','when','scope']);
      if(!STEP_ROLES.includes(step.role))bad('دور الخطوة غير معروف');
      // النطاق يخصّ الرئاسة وحدها: بقية الأدوار تُخصَّص بإدارتها لا بنطاقها، فنطاقٌ عليها يعني أن كاتب
      // السياسة قصد شيئًا آخر ولا تخمّنه المنصة له.
      if(step.scope!==undefined){
        if(step.role!=='executive')bad('النطاق لخطوة الرئاسة وحدها؛ وبقية الأدوار تُحدَّد بإدارتها لا بنطاقها');
        if(!EXECUTIVE_SCOPES.includes(step.scope))bad('نطاق خطوة الرئاسة: «sector» لنائب القطاع أو «ceo» للرئيس التنفيذي');
      }
      if(step.department!==undefined){
        if(step.role==='manager')bad('المدير المباشر يتبع صاحب الطلب ولا يحدد بإدارة');
        if(typeof step.department!=='string'||!db.prepare('SELECT 1 FROM departments WHERE id=? AND tenant_id=? AND active=1').get(step.department,u.tenant_id))bad('إدارة الخطوة غير صالحة');
      }
      if(step.when!==undefined){
        const when=step.when,field=fields.find(f=>f.key===when?.field);
        if(!when||typeof when!=='object'||!field)bad('شرط الخطوة يشير إلى حقل غير موجود');
        if(when.gte_setting!==undefined){
          v.object(when,['field','gte_setting']);
          if(field.type!=='number'||typeof when.gte_setting!=='string'||!SETTING_KEY.test(when.gte_setting))bad('شرط المبلغ يلزمه حقل رقمي ومفتاح حد صالح؛ الحد نفسه لا يُكتب في الخدمة');
        }else{
          const list=when.in??when.not_in;
          v.object(when,['field',when.in!==undefined?'in':'not_in']);
          if(field.type!=='select'||!Array.isArray(list)||!list.length||list.some(x=>!field.options.includes(x)))bad('شرط الاختيار يلزمه حقل اختيار وقيم من خياراته');
        }
      }
    }
    // المفتاح يحمل النطاق كما يحمل الإدارة: خانتا النموذج للنائب وللرئيس التنفيذي تتمايزان، وخطوتان
    // بالدور والإدارة والنطاق نفسها تبقيان مرفوضتين — فالقاعدة قائمة وأدقّ، لا مرفوعة.
    const key=`${step.role}|${step.department??''}|${step.scope??''}`;
    if(seen.has(key))bad('يلزم دور مختلف لكل خطوة ونمط متسلسل أو متوازٍ');
    seen.add(key);
  }
  return policy;
}
// ── عقد الحقل المخزَّن (مسح الكتالوج 20 سبتمبر، العطبان 2 و3) ────────────────────
// validatePayload لا يقرأ إلا نسخة الخدمة المخزَّنة، فما لا يُخزَّن لا يُفرض. قواعد الحقل الثلاث
// — حدّ الطول، وصيغته، وشرط ظهوره — تُخزَّن معه وتُفرض على الخادم. الإرشاد (لماذا يُسأل، وتلميحه،
// ومثاله) عرضٌ لا قاعدة، فيبقى في تعريف الكتالوج ويُدمج عند القراءة (enrichFields).
export const FIELD_KEYS=['key','label','type','required','options',...v.FIELD_RULE_KEYS];
const TEXTUAL=['text','textarea'];
// `fields` هنا الحقول المبنية قبل هذا الحقل: شرط الظهور لا يشير إلا إلى حقل اختيار سبقه، فلا يدور الشرط على نفسه.
function fieldRules(f,fields){
  const bad=message=>fail(400,'field_rule',`${f.key}: ${message}`),rules={};
  for(const key of ['min_length','max_length']){
    if(f[key]===undefined)continue;
    if(!TEXTUAL.includes(f.type))bad('حدّ الطول لحقل نصي أو نص طويل');
    if(!Number.isInteger(f[key])||f[key]<1||f[key]>3000)bad('حدّ الطول عدد صحيح من 1 إلى 3000');
    rules[key]=f[key];
  }
  if(rules.min_length>rules.max_length)bad('أقل طول مقبول أكبر من أكثره');
  if(f.pattern!==undefined){
    if(!TEXTUAL.includes(f.type))bad('الصيغة تُفرض على حقل نصي');
    if(typeof f.pattern!=='string'||!f.pattern.length||f.pattern.length>200)bad('الصيغة نص من حرف إلى 200 حرف');
    try{new RegExp(f.pattern);}catch{bad('الصيغة غير صالحة');}
    // الرفض يقول ما الصواب لا ما الخطأ، فلا تُقبل صيغة بلا رسالة عربية تصفها.
    if(typeof f.pattern_message!=='string')bad('الصيغة تلزمها رسالة تقول ما المقبول');
    rules.pattern=f.pattern;rules.pattern_message=v.text(f.pattern_message,'رسالة الصيغة',300,5);
  }else if(f.pattern_message!==undefined)bad('رسالة صيغة بلا صيغة');
  if(f.show_when!==undefined){
    const rule=f.show_when;
    if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).some(k=>!['field','equals'].includes(k)))bad('شرط الظهور: حقل وقيمه فقط');
    const source=fields.find(x=>x.key===rule.field);
    if(!source)bad('شرط الظهور يشير إلى حقل غير موجود قبله');
    if(source.type!=='select')bad('شرط الظهور يُقرأ من حقل اختيار');
    if(source.show_when)bad('الحقل المشروط لا يَشرط غيره');
    if(!Array.isArray(rule.equals)||!rule.equals.length||rule.equals.length>20||rule.equals.some(x=>!source.options.includes(x)))bad('قيم الشرط من خيارات الحقل المشروط به');
    rules.show_when={field:rule.field,equals:[...rule.equals]};
  }
  return rules;
}
export function createService(db,u,input) {
  if(u.role!=='admin') fail(403,'forbidden','إعداد الكتالوج متاح لمسؤول المنصة');
  v.object(input,['code','name_ar','name_en','department_id','description','fields','approval_policy','section']);
  const code=v.text(input.code,'رمز الخدمة',40);
  if(!/^[A-Z][A-Z0-9_-]{2,39}$/.test(code)) fail(400,'invalid_code','رمز الخدمة غير صالح');
  if(!db.prepare('SELECT 1 FROM departments WHERE id=? AND tenant_id=?').get(input.department_id,u.tenant_id)) fail(400,'department','الإدارة غير صالحة');
  if(!Array.isArray(input.fields)||!input.fields.length||input.fields.length>12) fail(400,'fields','يلزم حقل واحد إلى 12 حقلًا');
  const seen=new Set(),fields=[];
  for(const f of input.fields){
    v.object(f,FIELD_KEYS);
    if(typeof f.key!=='string'||!/^[a-z][a-z0-9_]{1,39}$/.test(f.key)||['__proto__','prototype','constructor'].includes(f.key)||seen.has(f.key)) fail(400,'field_key','معرف الحقل مكرر أو غير صالح');
    seen.add(f.key);
    if(!['text','textarea','date','select','number'].includes(f.type)||typeof f.required!=='boolean') fail(400,'field_type','نوع الحقل غير صالح');
    // أدلة الجهات (مثل السفارات في تعريف الراتب) أطول من القوائم التشغيلية الصغيرة؛ تبقى محدودة لمنع حمولة غير منضبطة.
    if(f.type==='select'&&(!Array.isArray(f.options)||!f.options.length||f.options.length>100)) fail(400,'options','قائمة الخيارات غير صالحة');
    fields.push({key:f.key,label:v.text(f.label,'اسم الحقل',100),type:f.type,required:f.required,...(f.type==='select'?{options:f.options.map(x=>v.text(x,'خيار',100))}:{}),...fieldRules(f,fields)});
  }
  const policy=validatePolicy(db,u,input.approval_policy,fields);
  const next=(db.prepare('SELECT MAX(version) AS v FROM services WHERE tenant_id=? AND code=?').get(u.tenant_id,code).v??0)+1;
  const sid=id();
  db.prepare('INSERT INTO services(id,tenant_id,code,name_ar,name_en,department_id,description,fields,approval_policy,version) VALUES(?,?,?,?,?,?,?,?,?,?)').run(sid,u.tenant_id,code,v.text(input.name_ar,'اسم الخدمة',150),v.text(input.name_en,'اسم الخدمة',150),input.department_id,v.text(input.description,'الوصف',1000),JSON.stringify(fields),JSON.stringify(policy),next);
  audit(db,u,'service',sid,'service.version_created',{}, {code,version:next});
  if(input.section!==undefined&&input.section!=='')setServiceSection(db,u,code,input.section);
  return getService(db,u,sid);
}
export function projectAccess(db,u,pid) {
  const p=db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(pid,u.tenant_id,u.id);
  if(!p) fail(404,'project_not_found','المشروع غير متاح لك');
  return p;
}
export function createRequest(db,u,input) {
  v.object(input,['service_id','title','payload','project_id']);
  if(u.role==='admin') fail(403,'forbidden','حساب إدارة المنصة لا ينشئ معاملات أعمال');
  const s=getService(db,u,v.text(input.service_id,'الخدمة',100));
  // الموقوفة قبل القديمة: رفضٌ واحد كان يغطي حالين مختلفين، فكان من يفتح رابطًا لخدمة أوقفها المالك يُقال له
  // «توجد نسخة أحدث» — نسخة لا وجود لها — بدل أن يُقال له من أوقفها ولماذا ومن يعيد تفعيلها.
  if(isHidden(db,u.tenant_id,'service',s.code))refuseHidden(db,u.tenant_id,'service',s.code,s.name_ar);
  // والمشروطة قبل القديمة كذلك (ترحيل 138)، للسبب نفسه بالضبط: من سقطت عنه الخدمة بشرطها كان يُقال له
  // «توجد نسخة أحدث» — لا نسخة أحدث ولا شيء — بدل أن يُقال له ما الشرط ومن يملك منحه أو رفعه.
  const gate=currentGates(db,u.tenant_id).get(s.code);
  if(gate&&!catalog(db,u).some(x=>x.code===s.code))refuseGated(db,u.tenant_id,s.code,s.name_ar,gate);
  if(!catalog(db,u).some(x=>x.id===s.id)) fail(409,'service_outdated','توجد نسخة أحدث من الخدمة');
  const projectId=input.project_id||null;
  if(projectId) projectAccess(db,u,projectId);
  const rid=id(),time=now(),payload=v.validatePayload(s.fields,input.payload??{},false);
  catalogAttendanceRoute(s.code,payload); // الاستئذان ونسيان البصمة صارا سجلات حضور (قواعد الحضور 099)
  catalogCrmRoute(db,u,s.code,payload); // الفرصة والخسارة والتسليم صارت سجلاتها المهيكلة (الحزمة 4، P4-CRM-3)
  db.prepare("INSERT INTO requests(id,tenant_id,requester_id,service_id,project_id,title,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?)").run(rid,u.tenant_id,u.id,s.id,projectId,v.text(input.title,'عنوان الطلب',180),JSON.stringify(payload),time,time);
  audit(db,u,'request',rid,'created',{}, {status:'draft',version:1});
  return detail(db,u,rid);
}
export function editRequest(db,u,rid,input) {
  v.object(input,['version','title','payload']);
  const r=getRequest(db,u,rid); v.version(input.version,r.version);
  if(!actions(db,u,r).includes('edit')) fail(403,'immutable_request','لا يمكن تعديل هذه النسخة');
  const payload=v.validatePayload(getService(db,u,r.service_id).fields,input.payload??{},false);
  db.prepare('UPDATE requests SET title=?,payload=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.title,'عنوان الطلب',180),JSON.stringify(payload),now(),rid);
  audit(db,u,'request',rid,'edited',auditSnapshot(r),auditSnapshot(getRequest(db,u,rid)));
  return detail(db,u,rid);
}
export function setServiceSection(db,u,code,section,order=100) {
  if(u.role!=='admin') fail(403,'forbidden','تنظيم الكتالوج متاح لمسؤول المنصة');
  const value=v.text(section,'القسم',60,2);
  if(!Number.isInteger(order)||order<0||order>10000) fail(400,'order','ترتيب القسم غير صالح');
  db.prepare('INSERT INTO service_directory(tenant_id,service_code,section,sort_order,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,service_code) DO UPDATE SET section=excluded.section,sort_order=excluded.sort_order,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(u.tenant_id,code,value,order,u.id,now());
  audit(db,u,'service',code,'service.section_set',{}, {section:value,sort_order:order});
}
// زمن الخدمة بأيام العمل كما كان، ومعه — منذ ترحيل 115 — زمن بالساعات لخدمة لا تحتمل التأجيل
// (مسح 20 سبتمبر، العطب 9). `hours` غير معرّف يُبقي ما هو مسجل؛ و`null` يمحو الساعات ويعيدها إلى الأيام.
export function setServiceTarget(db,u,code,days,hours) {
  if(u.role!=='admin') fail(403,'forbidden','تحديد زمن الخدمة متاح لمسؤول المنصة');
  if(!Number.isInteger(days)||days<0||days>120) fail(400,'target_days','زمن الخدمة بالأيام من 0 إلى 120');
  if(hours!==undefined&&hours!==null&&(!Number.isInteger(hours)||hours<1||hours>240)) fail(400,'target_hours','زمن الخدمة بالساعات من 1 إلى 240 ساعة عمل');
  const row=db.prepare('SELECT 1 FROM service_directory WHERE tenant_id=? AND service_code=?').get(u.tenant_id,code);
  if(!row) fail(404,'not_found','الخدمة غير مسجلة في الدليل');
  if(hours===undefined)db.prepare('UPDATE service_directory SET target_days=?,updated_by=?,updated_at=? WHERE tenant_id=? AND service_code=?').run(days,u.id,now(),u.tenant_id,code);
  else db.prepare('UPDATE service_directory SET target_days=?,target_hours=?,updated_by=?,updated_at=? WHERE tenant_id=? AND service_code=?').run(days,hours,u.id,now(),u.tenant_id,code);
  audit(db,u,'service',code,'service.target_set',{}, {target_days:days,...(hours===undefined?{}:{target_hours:hours})});
}
// ── حدود الاعتماد (B1) ────────────────────────────────────────────────────────
const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()));
// الحد الساري: آخر حد معتمد بلغ تاريخ سريانه. لا قيمة افتراضية في الكود.
export function thresholdFor(db,tenantId,key,asOf=riyadhToday()){
  return db.prepare("SELECT * FROM approval_thresholds WHERE tenant_id=? AND setting_key=? AND status='approved' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC,id DESC LIMIT 1").get(tenantId,key,asOf)??null;
}
// حقل الرقم في النموذج يُكتب بالريال بخانتين عشريتين كحد أقصى (validatePayload)، والحد مخزن بالهللات.
export function toMinor(value){
  if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');
  return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
// نتيجة الشرط: met/not_met تحدد الخطوة، وthreshold_unset/value_missing يطلبان الخطوة احتياطًا مع ملاحظة.
function evaluateCondition(db,tenantId,when,payload){
  if(when.gte_setting!==undefined){
    const threshold=thresholdFor(db,tenantId,when.gte_setting),value=toMinor(payload?.[when.field]);
    const base={field:when.field,setting:when.gte_setting,threshold_minor:threshold?.amount_minor??null,threshold_id:threshold?.id??null,value_minor:value};
    if(!threshold)return {...base,outcome:'threshold_unset',note:`حد الاعتماد غير معرّف (${when.gte_setting}): طُلبت الخطوة احتياطًا حتى يُعرَّف الحد ويُعتمد`};
    if(value===null)return {...base,outcome:'value_missing',note:`المبلغ في «${when.field}» غير مذكور: طُلبت الخطوة احتياطًا`};
    return {...base,outcome:value>=threshold.amount_minor?'met':'not_met'};
  }
  const value=payload?.[when.field],list=when.in??when.not_in,inList=list.includes(value);
  if(value===undefined||value==='')return {field:when.field,outcome:'value_missing',note:`الحقل «${when.field}» فارغ: طُلبت الخطوة احتياطًا`};
  return {field:when.field,value,outcome:(when.in!==undefined?inList:!inList)?'met':'not_met'};
}

// ── حل المعتمدين ─────────────────────────────────────────────────────────────
const selfFail=()=>fail(403,'self_approval','لا يمكن إحالة الطلب لاعتماد صاحبه');
// B5 (ومعه B7): المعتمد المعيّن هو صاحب الطلب أو المستفيد: المعتمد البديل المسجل، وإلا مرجع تصعيد الإدارة.
function substitute(db,u,departmentId,role,replacedId,beneficiaryId){
  const excluded=id=>id===u.id||id===beneficiaryId;
  const fallback=role==='executive'?null:approvalFallback(db,u.tenant_id,departmentId,role);
  if(fallback&&!excluded(fallback.id))return {id:fallback.id,basis:'fallback',department_id:departmentId,replaced:replacedId,note:'المعتمد المعيّن هو صاحب الطلب أو المستفيد؛ أحيلت الخطوة إلى المعتمد البديل المسجل'};
  const above=escalationApprover(db,u.tenant_id,departmentId);
  if(above&&above.role==='manager'&&!excluded(above.id))return {id:above.id,basis:'escalation',department_id:departmentId,replaced:replacedId,note:'المعتمد المعيّن هو صاحب الطلب أو المستفيد ولا بديل مسجلًا؛ أحيلت الخطوة إلى مرجع تصعيد الإدارة'};
  if(replacedId===u.id)selfFail();
  fail(409,'beneficiary_approval','المعتمد المعيّن هو المستفيد من الطلب ولا يوجد معتمد بديل ولا مرجع تصعيد؛ عيّن أحدهما');
}
function resolveStep(db,u,s,step,beneficiaryId){
  const role=step.role;
  if(role==='manager'){
    // المدير المباشر: المنطق القديم حرفيًا، ثم يُستبدل إن كان هو المستفيد.
    let approver;
    if(!u.manager_id){
      // مديرو الإدارات بلا مدير مباشر: يعتمد طلبهم مرجع التصعيد (نائب القطاع أو الرئيس التنفيذي).
      const above=escalationApprover(db,u.tenant_id,u.department_id);
      if(!above) fail(409,'escalation_missing','لا يوجد مدير مباشر ولا مرجع تصعيد لهذا الحساب؛ عيّن أحدهما قبل الطلب');
      if(above.id===u.id) selfFail();
      if(above.role!=='manager') fail(409,'escalation_role','مرجع التصعيد يجب أن يكون بدور مدير');
      approver={id:above.id,basis:'standard',department_id:u.department_id};
    }else{
      const rows=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND department_id=? AND active=1 AND role=?').all(u.manager_id,u.tenant_id,u.department_id,role);
      if(rows.length!==1) fail(409,'routing_unavailable','مسار الاعتماد غير مهيأ أو يحتمل أكثر من معتمد');
      if(rows[0].id===u.id) selfFail();
      approver={id:rows[0].id,basis:'standard',department_id:u.department_id};
    }
    if(approver.id!==beneficiaryId)return approver;
    const above=escalationApprover(db,u.tenant_id,u.department_id);
    if(above&&above.role==='manager'&&above.id!==u.id&&above.id!==beneficiaryId)return {id:above.id,basis:'escalation',department_id:u.department_id,replaced:approver.id,note:'المدير المباشر هو المستفيد من الطلب؛ أحيلت الخطوة إلى مرجع التصعيد'};
    fail(409,'beneficiary_approval','المدير المباشر هو المستفيد من الطلب ولا يوجد مرجع تصعيد لإدارته');
  }
  const departmentId=step.department??s.department_id;
  if(role==='executive'){
    const top=topExecutive(db,u.tenant_id),deputy=executiveFor(db,u.tenant_id,departmentId);
    // النطاق يقصر المرشّح على خانة النموذج نفسها: خانة النائب لا يوقّعها الرئيس التنفيذي، وخانته لا
    // يوقّعها النائب — وإلا صار التوقيعان في الورق توقيعًا واحدًا في المنصة. وبلا نطاق يبقى التدرّج
    // كما كان: نائب القطاع، وإلا الرئاسة. وحين يحلّ النطاقان إلى الشخص نفسه (قطاعٌ مرجعه الرئيس
    // التنفيذي) يتولّاها مانع التكرار في planApprovals كما يتولّى أي خطوتين حُلّتا إلى شخص واحد.
    const candidates=step.scope==='ceo'?[top]:step.scope==='sector'?[deputy]:[deputy,top];
    for(const candidate of candidates)
      if(candidate&&candidate.id!==u.id&&candidate.id!==beneficiaryId)return {id:candidate.id,basis:'executive',department_id:departmentId,note:candidate.id===top?.id?'اعتماد الرئاسة':'اعتماد نائب القطاع'};
    if(!candidates.some(Boolean))fail(409,'executive_missing','لا يوجد في الرئاسة حساب نشط يعتمد هذه الخطوة');
    selfFail();
  }
  const assigned=db.prepare('SELECT u.id FROM department_routing r JOIN users u ON u.id=r.user_id WHERE r.tenant_id=? AND r.department_id=? AND r.step_role=? AND u.active=1 AND u.department_id=r.department_id AND u.role=?').get(u.tenant_id,departmentId,role,stepRole(role));
  if(assigned&&assigned.id!==u.id&&assigned.id!==beneficiaryId)return {id:assigned.id,basis:'standard',department_id:departmentId};
  if(role==='department_manager'){
    const candidates=assigned?[assigned]:db.prepare("SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role='manager' AND active=1").all(u.tenant_id,departmentId);
    if(candidates.length===1&&candidates[0].id===u.id){
      const above=escalationApprover(db,u.tenant_id,departmentId);
      if(!above) fail(409,'escalation_missing','طلب مدير الإدارة يحتاج معتمدًا أعلى؛ عيّن مرجع التصعيد للإدارة');
      if(above.id===u.id) selfFail();
      if(above.role!=='manager') fail(409,'escalation_role','مرجع التصعيد يجب أن يكون بدور مدير');
      if(above.id===beneficiaryId)fail(409,'beneficiary_approval','مرجع التصعيد هو المستفيد من الطلب');
      return {id:above.id,basis:'standard',department_id:departmentId};
    }
  }
  if(assigned)return substitute(db,u,departmentId,role,assigned.id,beneficiaryId);
  const rows=db.prepare('SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role=? AND active=1').all(u.tenant_id,departmentId,stepRole(role));
  if(rows.length!==1) fail(409,'routing_unavailable','مسار الاعتماد غير مهيأ أو يحتمل أكثر من معتمد');
  if(rows[0].id===u.id||rows[0].id===beneficiaryId)return substitute(db,u,departmentId,role,rows[0].id,beneficiaryId);
  return {id:rows[0].id,basis:'standard',department_id:departmentId};
}
// خطة الاعتماد: لكل خطوة سارية معتمدها وأساس إسنادها ونتيجة شرطها. تُحفظ في لقطة النسخة وفي approval_step_basis.
export function planApprovals(db,u,s,payload,beneficiaryId=null){
  const plan=[],notes=[];
  s.approval_policy.steps.forEach((raw,position)=>{
    const step=normalizeStep(raw);
    const condition=step.when?evaluateCondition(db,u.tenant_id,step.when,payload):null;
    if(condition?.outcome==='not_met')return;
    if(condition?.note)notes.push(condition.note);
    const resolved=resolveStep(db,u,s,step,beneficiaryId);
    if(resolved.note&&resolved.basis!=='standard'&&resolved.basis!=='executive')notes.push(resolved.note);
    plan.push({position,role:step.role,department_id:resolved.department_id??null,approver_id:resolved.id,basis:resolved.basis,replaced_user_id:resolved.replaced??null,condition,note:resolved.note??''});
  });
  // B4: خطوتان حُلّتا إلى الشخص نفسه = قرار واحد يظهر اعتمادين. الثانية تُصعَّد ولا تُحذف.
  const seen=new Set();
  for(const item of plan){
    if(seen.has(item.approver_id)){
      const departmentId=item.department_id??s.department_id;
      const above=distinctApprovalCandidates(db,u.tenant_id,departmentId).find(person=>person.id!==u.id&&person.id!==beneficiaryId&&!seen.has(person.id));
      if(above){
        const note='الخطوة حُلّت إلى من يعتمد خطوة سابقة في الطلب نفسه؛ صُعّدت إلى مرجع تصعيد الإدارة بدل أن يُحسب القرار الواحد اعتمادين';
        Object.assign(item,{replaced_user_id:item.approver_id,approver_id:above.id,basis:'duplicate_escalation',note});notes.push(note);
      }else{
        fail(409,'approval_route_not_distinct','مسار الاعتماد يعيّن الشخص نفسه لأكثر من خطوة ولا يوجد معتمد أعلى مختلف؛ عيّن معتمدًا بديلًا أو مرجع تصعيد آخر قبل تقديم الطلب');
      }
    }
    seen.add(item.approver_id);
  }
  return {plan,notes};
}
// انتقال الحالة أكثر كتابة في المنصة يمسّ صفوفًا في نَفَس واحد: صف الطلب، ونسخته المقدَّمة، وخطوات اعتمادها وأسانيدها،
// والإشعارات، وصندوق الصادر، وسجل التدقيق — ومعها ما تفتحه afterTransition من سجلات الوحدات. بلا معاملة يُطبَّق نصفها
// ويسقط نصفها، فيبقى طلبٌ «معتمد» بلا خطوة اعتماد، أو نسخةٌ مقدَّمة لطلب ما زال مسودة — ولا تُصلَّح واحدة منها
// لاحقًا لأن request_versions وaudit_events لا يُعدَّلان ولا يُحذف منهما (مشغّلات app/schema.sql).
// الحارس نفسه الذي يحرس بقية الوحدات (writing في accruals وassets وbenefits وغيرها) ونفسه الذي يحرس المتابعة أعلاه.
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ انتقال الطلب داخل معاملة');}
export function transition(db,u,rid,action,input) {
  writing(db);
  v.object(input,['version','note']);
  const r=getRequest(db,u,rid);v.version(input.version,r.version);
  if(!actions(db,u,r).includes(action)) fail(403,'transition_denied','الفعل غير مسموح لدورك أو لحالة الطلب');
  const note=v.text(input.note??'','الملاحظة',3000,['return','reject','complete'].includes(action)?3:0);
  let status=r.status,revision=r.revision,assigned=r.assigned_to;
  const time=now();
  if(action==='submit') {
    const s=getService(db,u,r.service_id);
    v.validatePayload(s.fields,JSON.parse(r.payload),true);
    if(r.project_id) projectAccess(db,u,r.project_id);
    const beneficiary=beneficiaryOf(db,r);
    const {plan,notes}=planApprovals(db,u,s,JSON.parse(r.payload),beneficiary);
    const approvers=plan.map(p=>p.approver_id);
    revision++;status='pending';assigned=null;
    // B2: المسار المباشر — لا خطوة سارية، فيدخل الطلب «معتمد» عند تقديمه ويُشعَر المنفذون فورًا.
    if(!plan.length){
      if(!isDirect(s.approval_policy))fail(409,'routing_unavailable','مسار الاعتماد غير مهيأ أو يحتمل أكثر من معتمد');
      status='approved';notes.push('مسار مباشر: الخدمة لا تحتاج اعتمادًا قبل التنفيذ، ووصلت المنفذين عند التقديم');
    }
    const files=db.prepare('SELECT id,digest,filename FROM attachments WHERE request_id=? ORDER BY id').all(rid);
    const engine=plan.some(p=>p.basis!=='standard'||p.condition||p.duplicate_unresolved)||notes.length||s.approval_policy.steps.some(x=>typeof x!=='string');
    // الشكل القديم للّقطة يبقى كما هو؛ خطة الاعتماد تضاف حين يتدخل المحرك الجديد (شرط، بديل، تصعيد، دمج، مسار مباشر).
    const submitted={...snapshot(r),revision,service_version:s.version,approval_policy:s.approval_policy,attachments:files,...(engine?{approval_plan:plan,approval_notes:notes,beneficiary_id:beneficiary}:{})};
    // الأعمدة مسمّاة لا بالترتيب: العمود الخامس (digest) دخل بالترحيل 146، وVALUES بأربع قيم كان يسقط بلا ذلك.
    db.prepare('INSERT INTO request_versions(request_id,revision,snapshot,created_at,digest) VALUES(?,?,?,?,?)')
      .run(rid,revision,JSON.stringify(submitted),time,versionDigest(rid,revision,time,submitted));
    for(const p of plan){
      const stepId=id();
      db.prepare("INSERT INTO approval_steps(id,request_id,revision,position,approver_id,status) VALUES(?,?,?,?,?,'pending')").run(stepId,rid,revision,p.position,p.approver_id);
      db.prepare('INSERT INTO approval_step_basis(step_id,tenant_id,request_id,revision,position,step_role,department_id,basis,replaced_user_id,condition,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(stepId,r.tenant_id,rid,revision,p.position,p.role,p.department_id,p.basis,p.replaced_user_id,p.condition?JSON.stringify(p.condition):null,p.note,time);
    }
    (s.approval_policy.mode==='parallel'?approvers:approvers.slice(0,1)).forEach(a=>notify(db,a,rid,'approval_needed'));
    if(status==='approved')handOverToExecutors(db,r,s,s.department_id,u.id);
    // إيصال التقديم لصاحب الطلب (B7): يعرف أن الطلب وصل وإلى أين ذهب، ولو قدّمه غيره نيابة عنه.
    notify(db,r.requester_id,rid,'request_submitted',{status});
  } else if(['approve','return','reject'].includes(action)) {
    const step=pendingSteps(db,r).find(step=>authorizedStep(db,u,r,step));
    // التفويض يُبحث عنه عند صاحب القرار الحالي: معتمد الخطوة، أو من صُعِّدت إليه (deciderOf). بلا تصعيد هو approver_id كما كان.
    const holder=deciderOf(db,step);
    const delegation=holder===u.id?null:delegationFor(db,u,{id:holder,tenant_id:r.tenant_id},getService(db,u,r.service_id).code);
    const decision={approve:'approved',return:'returned',reject:'rejected'}[action];
    db.prepare('UPDATE approval_steps SET status=?,note=?,decided_at=?,decided_by=?,delegation_id=? WHERE id=?').run(decision,note,time,u.id,delegation?.id??null,step.id);
    if(action==='approve') {
      const next=currentStep(db,r);
      if(next) notify(db,deciderOf(db,next),rid,'approval_needed');
      else {
        status='approved';
        // B21: بعد آخر خطوة في مسار متعدد يُبلَّغ المنفذون أن الطلب جاهز، كما في المسار المباشر.
        handOverToExecutors(db,r,getService(db,u,r.service_id),handlingDepartmentId(db,r),u.id);
      }
    } else status=decision;
    notify(db,r.requester_id,rid,'decision_updated',{decision,final:status==='approved'});
  } else if(action==='cancel') {status='cancelled';if(r.requester_id!==u.id)notify(db,r.requester_id,rid,'request_updated');}
  else if(action==='claim') {
    status='in_progress';assigned=u.id;notify(db,r.requester_id,rid,'execution_started');
    // التنفيذ بالحلقة الاحتياطية يُسجَّل بسنده، فلا يظهر في السجل كأنه تنفيذ عادي من الإدارة المنفذة.
    const acting=deputyExecutor(db,currentUser(db,u),getService(db,u,r.service_id),r,handlingDepartmentId(db,r));
    if(acting)audit(db,u,'request',rid,'execution.fallback_claimed',{},{executor_id:acting.id,execution_basis:acting.basis,basis_label:acting.label,handling_department_id:handlingDepartmentId(db,r)},acting.why||acting.label);
  }
  else if(action==='complete') {if(openTasks(db,rid))fail(409,'open_tasks','أغلق المهام المسندة قبل إغلاق الطلب');beforeComplete(db,r,u);status='completed';notify(db,r.requester_id,rid,'execution_completed');}
  db.prepare('UPDATE requests SET status=?,revision=?,assigned_to=?,version=version+1,updated_at=? WHERE id=?').run(status,revision,assigned,time,rid);
  // خدمات لها وحدة تنفذها (خطاب، استقالة، انتداب): تُفتح سجلاتها من هنا (service-routes.mjs).
  afterTransition(db,u,r,action,status);
  if(status==='approved'&&r.status!=='approved') db.prepare("INSERT INTO outbox(id,tenant_id,request_id,event_key,event_type,reason,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING").run(id(),u.tenant_id,rid,`${rid}:${revision}:approved`,'request.approved','لا يوجد موصل تشغيل معتمد؛ لم يرسل الحدث خارج المنصة',time);
  audit(db,u,'request',rid,action,auditSnapshot(r),auditSnapshot(getRequest(db,u,rid)),note);
  return detail(db,u,rid);
}
export function addAttachment(db,u,rid,input) {
  v.object(input,['version','filename','content']);
  const r=getRequest(db,u,rid);v.version(input.version,r.version);
  if(!actions(db,u,r).includes('attach')) fail(403,'immutable_attachment','إضافة المرفق غير متاحة في حالة الطلب الحالية');
  const filename=v.text(input.filename,'اسم الملف',120);
  if(/[\x00-\x1f\x7f/\\]/.test(filename)||filename.includes('..')) fail(400,'filename','اسم الملف غير صالح');
  if(typeof input.content!=='string'||input.content.length>2800000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) fail(400,'content','ترميز الملف غير صالح');
  const data=Buffer.from(input.content,'base64');
  if(data.length<1||data.length>2097152) fail(413,'file_size','الحد الأقصى للملف 2 ميغابايت');
  let media;
  if(filename.toLowerCase().endsWith('.txt')) {
    try {new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail(400,'file_type','ملف النص يجب أن يكون UTF-8');}
    if(data.includes(0)) fail(400,'file_type','محتوى النص غير صالح');
    media='text/plain';
  } else if(filename.toLowerCase().endsWith('.pdf')&&data.subarray(0,5).toString()==='%PDF-') media='application/pdf';
  else if(filename.toLowerCase().endsWith('.png')&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) media='image/png';
  else fail(400,'file_type','الأنواع المسموحة: TXT وPDF وPNG بتوقيع مطابق');
  const total=db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE request_id=?').get(rid).n;
  if(total>=10) fail(400,'file_count','الحد الأقصى عشرة مرفقات للطلب');
  const aid=id();
  db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)').run(aid,rid,u.id,filename,media,data.length,hash(data),data,now());
  db.prepare('UPDATE requests SET version=version+1,updated_at=? WHERE id=?').run(now(),rid);
  audit(db,u,'request',rid,'attachment_added',{version:r.version},{version:r.version+1,attachment_id:aid,filename,digest:hash(data)});
  return detail(db,u,rid);
}
export function downloadAttachment(db,u,aid) {
  const a=db.prepare('SELECT a.* FROM attachments a JOIN requests r ON r.id=a.request_id WHERE a.id=? AND r.tenant_id=?').get(aid,u.tenant_id);
  if(!a) fail(404,'not_found','الملف غير متاح');
  getRequest(db,u,a.request_id);
  audit(db,u,'request',a.request_id,'attachment_downloaded',{}, {attachment_id:aid});
  return a;
}
export const notifyUser=notify;
// إشعار طلب الخدمة يظهر ما دام صاحبه يرى الطلب اليوم. إشعار سجل آخر (إجازة، مطالبة، خطاب، تصحيح حضور) مكتوب
// لصاحبه وحده بنص لا يكشف غير ما يخصه، ويفتح شاشة ذلك السجل. الصفوف القديمة بلا عنوان تُقرأ بقالب نوعها.
// الصفحة: حتى limit إشعارًا (الافتراضي 200، الأقصى 500) أقدم من before إن أُعطي. unread=true لغير المقروء فقط.
function noticeView(db,current,n){
  if(!n.request_id)return {...n,category:categoryOf(n),link:SUBJECT_LINKS[n.subject_kind]??'#notifications',body:n.body??''};
  let r;try{r=getRequest(db,current,n.request_id);}catch{return null;}
  const text=n.title?{title:n.title,body:n.body??''}:requestNotice(n.kind,r.title);
  return {...n,...text,category:categoryOf({...n,subject_kind:'request'}),link:`#request/${n.request_id}`};
}
export function notifications(db,u,{limit=200,before=null,unread=false}={}) {
  const current=currentUser(db,u);if(!current)return [];
  const size=Math.max(1,Math.min(500,Number.isInteger(limit)?limit:200)),cursor=typeof before==='string'&&before.length<=40?before:null;
  return db.prepare(`SELECT * FROM notifications WHERE user_id=? ${cursor?'AND created_at<?':''} ${unread?'AND read_at IS NULL':''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(current.id,...(cursor?[cursor]:[]),size)
    .map(n=>noticeView(db,current,n)).filter(Boolean);
}
export function markNotification(db,u,nid) {
  const current=currentUser(db,u);
  const row=current&&typeof nid==='string'&&db.prepare('SELECT * FROM notifications WHERE id=? AND user_id=?').get(nid,current.id);
  if(!row||!noticeView(db,current,row)) fail(404,'not_found','الإشعار غير متاح');
  db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(now(),nid,current.id);
  return {read:true};
}
// «تعليم الكل كمقروء»: إشعارات صاحب الحساب وحده. ما حُجب عنه (طلب لم يعد يراه) يُعلَّم أيضًا فلا يبقى عدادًا خفيًا.
export function markAllNotifications(db,u) {
  const current=currentUser(db,u);if(!current)fail(403,'forbidden','الحساب غير متاح');
  const result=db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(),current.id);
  return {marked:Number(result.changes)};
}
// مصدر شارة «غير مقروء»: العدد نفسه الذي تعرضه صفحة الإشعارات، لا يُحسب فيه إشعار طلب لم يعد صاحبه يراه.
export function unreadCount(db,u) {
  const current=currentUser(db,u);if(!current)return {unread:0};
  const rows=db.prepare('SELECT * FROM notifications WHERE user_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 1000').all(current.id);
  const byCategory={};let unread=0;
  for(const n of rows){const view=noticeView(db,current,n);if(!view)continue;unread++;byCategory[view.category]=(byCategory[view.category]??0)+1;}
  return {unread,by_category:byCategory,capped:rows.length>=1000};
}

// ── إعدادات محرك الاعتماد: حدود المبالغ والمعتمد البديل (B1 وB5) ─────────────────
function settingsActor(db,supplied){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;
}
// من يعتمد الحد: الرئاسة (مرجع تصعيد مسجل لإدارة ما، أو الرئيس التنفيذي كما يحدده escalationFor).
// مصفوفة الصلاحيات المالية قرار الرئاسة؛ المنصة تسجل قرارها ولا تقترح رقمًا.
export const canApproveThresholds=(db,u)=>u?.role==='manager'&&(!!db.prepare('SELECT 1 FROM department_escalation WHERE tenant_id=? AND user_id=?').get(u.tenant_id,u.id)||topExecutive(db,u.tenant_id)?.id===u.id);
export function proposeThreshold(db,supplied,input){
  const u=settingsActor(db,supplied);
  if(!can(db,u,'catalog.manage'))fail(403,'not_permitted','إدخال حدود الاعتماد لمن يدير دليل الخدمات');
  v.object(input,['setting_key','amount_minor','basis','effective_from']);
  if(typeof input.setting_key!=='string'||!SETTING_KEY.test(input.setting_key))fail(400,'setting_key','مفتاح الحد: حروف إنجليزية صغيرة وأرقام ونقطة وشرطة سفلية');
  if(!Number.isSafeInteger(input.amount_minor)||input.amount_minor<0||input.amount_minor>100000000000000)fail(400,'amount_minor','الحد بالهللات عدد صحيح موجب');
  const basis=v.text(input.basis,'سند الحد (القرار أو المصفوفة المعتمدة ورقمها)',1000,10),effective=v.date(input.effective_from);
  const tid=id(),time=now();
  db.prepare('INSERT INTO approval_thresholds(id,tenant_id,setting_key,amount_minor,basis,effective_from,proposed_by,proposed_at) VALUES(?,?,?,?,?,?,?,?)').run(tid,u.tenant_id,input.setting_key,input.amount_minor,basis,effective,u.id,time);
  audit(db,u,'approval_threshold',tid,'threshold.proposed',{}, {setting_key:input.setting_key,amount_minor:input.amount_minor,effective_from:effective},basis);
  return db.prepare('SELECT * FROM approval_thresholds WHERE id=?').get(tid);
}
export function decideThreshold(db,supplied,thresholdId,input){
  const u=settingsActor(db,supplied);
  v.object(input,['version','decision','note']);
  const row=db.prepare('SELECT * FROM approval_thresholds WHERE id=? AND tenant_id=?').get(thresholdId,u.tenant_id);
  if(!row)fail(404,'not_found','الحد غير موجود');
  v.version(input.version,row.version);
  if(row.status!=='proposed')fail(409,'decided','حُسم هذا الحد؛ اقترح حدًا جديدًا لتغييره');
  if(row.proposed_by===u.id)fail(409,'separation_of_duties','من أدخل الحد لا يعتمده');
  if(!canApproveThresholds(db,u))fail(403,'not_permitted','اعتماد حدود الاعتماد للرئاسة');
  if(!['approve','reject'].includes(input.decision))fail(400,'decision','القرار اعتماد أو رفض');
  const note=v.text(input.note,'ملاحظة القرار',1000,input.decision==='reject'?3:0),time=now(),status=input.decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE approval_thresholds SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=?').run(status,u.id,time,note,row.id);
  audit(db,u,'approval_threshold',row.id,`threshold.${status}`,{status:row.status},{status,setting_key:row.setting_key,amount_minor:row.amount_minor},note);
  return db.prepare('SELECT * FROM approval_thresholds WHERE id=?').get(row.id);
}
// ── تسمية النائب المنفذ: فعل شخصين (ترحيل 122) ─────────────────────────────────
// يقترحه من يدير الهيكل والتصعيد بسند مكتوب وبرتبة (1–3)، ولا يصير منفذًا حتى يقبله شخص ثانٍ ليس هو النائب
// نفسه: من يقبل التسمية لا يكسب بها حقًّا (إعادة القياس، العطب 7). المقترح وحده لا يرى طلبًا ولا ينفّذه.
// وللنائب شرطان في مجاله (إعادة القياس، العطب 3): قطاعُ إدارته قطاعُ الإدارة المنفذة نفسه — فهو تحت نائب
// الرئيس نفسه الذي إليه تُصعَّد الإدارتان — ودورُه دورٌ ينفّذ هذه الخدمة. بلا هذين كان «أي حساب في أي إدارة»
// يكفي، فوضع القياسُ أمرَ صرفٍ ماليًّا في يد «إدارة الحسابات».
const DEPUTY_RANKS=[1,2,3];
const deputyRow=(db,tenantId,code,rank)=>db.prepare('SELECT * FROM execution_deputies WHERE tenant_id=? AND service_code=? AND rank=?').get(tenantId,code,rank)??null;
function deputyService(db,u,code){
  const service=db.prepare("SELECT * FROM services s WHERE tenant_id=? AND code=? AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").get(u.tenant_id,code);
  if(!service)fail(400,'service','الخدمة غير موجودة في دليل الخدمات');
  return service;
}
function deputyRank(value){
  if(!DEPUTY_RANKS.includes(value))fail(400,'rank','رتبة النائب من 1 إلى 3: يُسأل الأول ثم الذي يليه');
  return value;
}
const ROLE_NAME={manager:'مدير',hr:'موارد بشرية',it:'تقنية معلومات',pm:'مدير مشروع',member:'أي عضو نشط',employee:'موظف'};
// مجال النائب: القطاع والدور. القطاع هو تقسيم الشركة لعملها، ومرجع تصعيد الإدارتين واحد، فالنائب من دائرة
// العمل نفسها لا من إدارة لا تمسّ هذا العمل. والدور: خدمة منفّذها «موارد بشرية» لا ينفّذها من ليس كذلك.
// الرفض يسمّي الإدارات المؤهَّلة بأسمائها، فمن يسمّي النائب يقرأ من بين يديه لا يخمّن.
export function deputyEligibleDepartments(db,tenantId,serviceDepartmentId){
  const served=db.prepare('SELECT id,name,sector FROM departments WHERE id=? AND tenant_id=?').get(serviceDepartmentId,tenantId);
  if(!served)return [];
  return db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND sector=? AND active=1 AND id<>? ORDER BY name').all(tenantId,served.sector,served.id);
}
function deputyFitsService(db,tenantId,service,person){
  const served=db.prepare('SELECT id,name,sector FROM departments WHERE id=? AND tenant_id=?').get(service.department_id,tenantId);
  const home=db.prepare('SELECT id,name,sector FROM departments WHERE id=? AND tenant_id=? AND active=1').get(person.department_id,tenantId);
  const eligible=deputyEligibleDepartments(db,tenantId,service.department_id);
  if(!served||!home||home.sector!==served.sector)
    refuse(409,'deputy_out_of_sector',{what:`«${home?.name??person.department_id}» ليست من قطاع «${served?.name??service.department_id}»، فلا ينوب عنها في تنفيذ ${service.code}`,
      missing:[{document:`نائب من إدارة في قطاع «${served?.name??service.department_id}» نفسه${eligible.length?`: ${eligible.map(d=>d.name).join('، ')}`:''}`,
        why:'النائب يقرأ عمل الإدارة المنفذة ويقرر فيه؛ قطاعٌ آخر عملٌ آخر، ومرجع تصعيده غير مرجعها',
        owner:'من يدير الهيكل والتصعيد',owner_role:'structure.manage'}],
      next:eligible.length?'اختر النائب من إحدى هذه الإدارات، أو اترك التنفيذ يصعد في سُلَّم تصعيد الإدارة':'لا إدارة أخرى في هذا القطاع؛ يبقى التنفيذ صاعدًا في سُلَّم تصعيد الإدارة',
      link:'#approval-settings'});
  // الدور: إما دور منفّذ الخدمة نفسه، وإما مدير إدارة — ومدير الإدارة يحمل عمل إدارته كما يحمله مرجع
  // التصعيد حين يصل إليه التنفيذ، فلا يُشترط عليه ما لا يُشترط على الدرجة التي فوقه.
  const handlerRole=JSON.parse(service.approval_policy).handler_role;
  if(handlerRole!=='member'&&person.role!==handlerRole&&!departmentHead(db,person,person.department_id))
    refuse(409,'deputy_role',{what:`دور «${ROLE_NAME[person.role]??person.role}» لا ينفّذ ${service.code}`,
      missing:[{document:`نائب بدور «${ROLE_NAME[handlerRole]??handlerRole}» أو مدير إدارة في «${home.name}»`,
        why:'منفّذ هذه الخدمة في إدارتها بهذا الدور، والنائب ينوب عنه لا عن غيره',
        owner:'من يدير الهيكل والتصعيد',owner_role:'structure.manage'}],
      next:`اختر حسابًا بدور «${ROLE_NAME[handlerRole]??handlerRole}» أو مديرَ إدارة من قطاع الإدارة المنفذة`,
      link:'#approval-settings'});
}
export function proposeExecutionDeputy(db,supplied,input){
  const u=settingsActor(db,supplied);
  if(!can(db,u,'structure.manage'))fail(403,'not_permitted','تسمية النائب المنفذ لمن يدير الهيكل والتصعيد');
  v.object(input,['service_code','rank','user_id','basis']);
  const service=deputyService(db,u,input.service_code),rank=deputyRank(input.rank),time=now();
  const before=deputyRow(db,u.tenant_id,service.code,rank)??{};
  if(before.status==='proposed'||before.status==='accepted')fail(409,'deputy_named','لهذه الرتبة نائب مسمّى؛ اسحبه أولًا أو سمِّ رتبة أخرى');
  const basis=v.text(input.basis,'سند التسمية (من قررها ومتى ولماذا)',1000,10);
  const person=db.prepare("SELECT id,tenant_id,department_id,role FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(400,'deputy_user','النائب حساب نشط لا يدير المنصة');
  // النائب من إدارة أخرى: نائب من الإدارة نفسها لا يحل المشكلة، فهو إما منفذ أصلًا أو ممنوع بفصل المهام نفسه.
  if(person.department_id===service.department_id)fail(409,'same_department','النائب المنفذ من إدارة غير الإدارة المنفذة؛ عضو الإدارة نفسها منفذ أصلًا أو يمنعه فصل المهام نفسه');
  if(person.id===u.id)fail(409,'separation_of_duties','من يسمّي النائب لا يسمّي نفسه');
  deputyFitsService(db,u.tenant_id,service,person);
  if(db.prepare("SELECT 1 FROM execution_deputies WHERE tenant_id=? AND service_code=? AND user_id=? AND status IN ('proposed','accepted')").get(u.tenant_id,service.code,person.id))
    fail(409,'deputy_duplicate','هذا الشخص مسمّى لهذه الخدمة في رتبة أخرى؛ الرتب ثلاثة أشخاص لا شخص واحد');
  if(before.status==='withdrawn')
    db.prepare("UPDATE execution_deputies SET user_id=?,basis=?,status='proposed',proposed_by=?,proposed_at=?,accepted_by=NULL,accepted_at=NULL,withdrawn_by=NULL,withdrawn_at=NULL WHERE tenant_id=? AND service_code=? AND rank=?")
      .run(person.id,basis,u.id,time,u.tenant_id,service.code,rank);
  else db.prepare("INSERT INTO execution_deputies(tenant_id,service_code,rank,user_id,basis,status,proposed_by,proposed_at) VALUES(?,?,?,?,?,'proposed',?,?)")
    .run(u.tenant_id,service.code,rank,person.id,basis,u.id,time);
  audit(db,u,'service',service.code,'deputy.proposed',before,{service_code:service.code,rank,user_id:person.id,deputy_department_id:person.department_id},basis);
  return deputyRow(db,u.tenant_id,service.code,rank);
}
// من يقبل التسمية غير من يدير الهيكل: مدير إدارة النائب — وهو من يُعير وقت موظفه — أو مدير الإدارة المنفذة
// التي سينوب عنها. كلاهما طرف في القرار ولا يكسب به حق تنفيذ، فيصح أن يكون هو الشخص الثاني.
export function deputyAcceptHead(db,u,service,row){
  const deputy=db.prepare('SELECT department_id FROM users WHERE id=? AND tenant_id=?').get(row.user_id,u.tenant_id);
  return (!!deputy&&departmentHead(db,u,deputy.department_id))||departmentHead(db,u,service.department_id);
}
function deputyAcceptRefusal(db,u,service,row,kind){
  const deputy=db.prepare('SELECT name,department_id FROM users WHERE id=? AND tenant_id=?').get(row.user_id,u.tenant_id);
  const home=deputy?departmentName(db,u.tenant_id,deputy.department_id):'إدارته';
  const served=departmentName(db,u.tenant_id,service.department_id);
  refuse(403,kind==='self'?'deputy_self_accept':'not_permitted',{
    what:kind==='self'?`لا تقبل تسميتك نائبًا منفّذًا لـ${service.code} بنفسك`:`لا تُقبَل تسمية النائب المنفّذ لـ${service.code} بحسابك`,
    missing:[{document:`قبولٌ من مدير «${home}» أو مدير «${served}» أو ممن يدير الهيكل والتصعيد، غير من سمّى النائب`,
      why:kind==='self'?'القبول هو ما يمنح حق التنفيذ؛ فمن يقبل لا يكون هو من يكسبه، وإلا صارت التسمية فعل شخص واحد':'قبول التسمية قرارٌ على إدارةٍ بعينها، يملكه مديرها أو من يدير الهيكل والتصعيد',
      owner:`مدير «${home}»`,owner_role:'structure.manage'}],
    next:`اطلب من مدير «${home}» أو مدير «${served}» أن يفتح «إعداد الاعتماد» ويقبل التسمية بسند مكتوب`,
    link:'#approval-settings'});
}
export function acceptExecutionDeputy(db,supplied,input){
  const u=settingsActor(db,supplied);
  v.object(input,['service_code','rank','note']);
  const service=deputyService(db,u,input.service_code),rank=deputyRank(input.rank);
  const row=deputyRow(db,u.tenant_id,service.code,rank);
  if(!row||row.status!=='proposed')fail(404,'not_found','لا تسمية نائب معلّقة في هذه الرتبة لهذه الخدمة');
  if(row.proposed_by===u.id)fail(409,'separation_of_duties','من سمّى النائب لا يقبل تسميته؛ يقبلها ثالثٌ غيره وغير النائب');
  // من يقبل التسمية لا يكسب بها شيئًا (إعادة القياس، العطب 7): النائب كان يقبل تسمية نفسه، فيكون الشخص
  // الثاني هو من ملك حق التنفيذ — وهذا ليس فعل شخصين، بل فعل شخص وقّع له آخرُ ورقةً.
  if(row.user_id===u.id)deputyAcceptRefusal(db,u,service,row,'self');
  if(!can(db,u,'structure.manage')&&!deputyAcceptHead(db,u,service,row))deputyAcceptRefusal(db,u,service,row,'not_permitted');
  const note=v.text(input.note,'سند القبول: من قبل ومتى',1000,10),time=now();
  db.prepare("UPDATE execution_deputies SET status='accepted',accepted_by=?,accepted_at=? WHERE tenant_id=? AND service_code=? AND rank=?").run(u.id,time,u.tenant_id,service.code,rank);
  audit(db,u,'service',service.code,'deputy.accepted',{status:row.status},{service_code:service.code,rank,user_id:row.user_id,accepted_by:u.id},note);
  return deputyRow(db,u.tenant_id,service.code,rank);
}
export function withdrawExecutionDeputy(db,supplied,input){
  const u=settingsActor(db,supplied);
  if(!can(db,u,'structure.manage'))fail(403,'not_permitted','سحب تسمية النائب لمن يدير الهيكل والتصعيد');
  v.object(input,['service_code','rank','basis']);
  const service=deputyService(db,u,input.service_code),rank=deputyRank(input.rank);
  const row=deputyRow(db,u.tenant_id,service.code,rank);
  if(!row||row.status==='withdrawn')fail(404,'not_found','لا تسمية نائب سارية في هذه الرتبة لهذه الخدمة');
  const basis=v.text(input.basis,'سبب السحب ومن قرره',1000,10),time=now();
  db.prepare("UPDATE execution_deputies SET status='withdrawn',withdrawn_by=?,withdrawn_at=? WHERE tenant_id=? AND service_code=? AND rank=?").run(u.id,time,u.tenant_id,service.code,rank);
  audit(db,u,'service',service.code,'deputy.withdrawn',{status:row.status,user_id:row.user_id},{service_code:service.code,rank},basis);
  return deputyRow(db,u.tenant_id,service.code,rank);
}
export function setApprovalFallback(db,supplied,input){
  const u=settingsActor(db,supplied);
  if(!can(db,u,'structure.manage'))fail(403,'not_permitted','تعيين المعتمد البديل لمن يدير الهيكل والتصعيد');
  v.object(input,['department_id','step_role','fallback_user_id','note']);
  const department=db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id);
  if(!department)fail(400,'department','الإدارة غير صالحة');
  if(!['department_manager','hr','it','pm'].includes(input.step_role))fail(400,'step_role','الدور غير صالح');
  const before=db.prepare('SELECT * FROM approval_fallbacks WHERE department_id=? AND step_role=?').get(department.id,input.step_role)??{};
  const note=v.text(input.note,'سبب التعيين',600,3),time=now();
  if(input.fallback_user_id===null){
    db.prepare('DELETE FROM approval_fallbacks WHERE tenant_id=? AND department_id=? AND step_role=?').run(u.tenant_id,department.id,input.step_role);
    audit(db,u,'department',department.id,'fallback.removed',before,{step_role:input.step_role},note);
    return null;
  }
  const person=db.prepare("SELECT id,role FROM users WHERE id=? AND tenant_id=? AND active=1 AND role IN ('manager','hr','it','pm')").get(input.fallback_user_id,u.tenant_id);
  if(!person)fail(400,'fallback_user','المعتمد البديل حساب نشط بدور اعتماد');
  const routed=db.prepare('SELECT user_id FROM department_routing WHERE tenant_id=? AND department_id=? AND step_role=?').get(u.tenant_id,department.id,input.step_role);
  if(routed?.user_id===person.id)fail(409,'same_person','البديل هو المعتمد المعيّن نفسه');
  db.prepare('INSERT INTO approval_fallbacks(tenant_id,department_id,step_role,fallback_user_id,note,assigned_by,assigned_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(department_id,step_role) DO UPDATE SET fallback_user_id=excluded.fallback_user_id,note=excluded.note,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at')
    .run(u.tenant_id,department.id,input.step_role,person.id,note,u.id,time);
  audit(db,u,'department',department.id,'fallback.assigned',before,{step_role:input.step_role,fallback_user_id:person.id},note);
  return db.prepare('SELECT * FROM approval_fallbacks WHERE department_id=? AND step_role=?').get(department.id,input.step_role);
}
