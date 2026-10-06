// مستويات الصلاحية على الإدارة (ترحيل 130) — قرار المالك 20 سبتمبر 2026:
// «ابيك تحط صلاحيات على كل اداره مدير الادارة - موظف - ادمن و اقدر احدد الصلاحيات انا وانا يكون عندي سوبر ادمن».
//
// ثلاثة مستويات، وقالب شركة واحد يضبطه المالك مرة، واستثناء للإدارة حين يريده — لا سبعة عشر جدولًا.
// المستوى **يضيف ولا يسحب**: التصريح الفعلي = افتراضات الدور ∪ ما يحمله المستوى ∪ المنح الفردية
// (الاتحاد نفسه مكتوب في app/access.mjs: capabilitiesFor وcan وholds، فمكان القرار واحد).
//
// ما يحكم هذا الملف كله:
//   (1) المرحلة (أ) وحدها هنا: المستوى يحكم القائمة وبوابات المسارات فورًا. المرحلة (ب) — أن يصير
//       ما بقي من التصاريح محصورًا بإدارة فعلًا — عملٌ عائلةً عائلةً بترتيب الاستعمال، وليس في هذه الموجة.
//   (2) لا تُعرض على أحد إمكانية حصر ما لا يحصره الكود: «الإضافة لإدارة» مرفوضة على كل مفتاح ليس في
//       access.CONFINED_IN_CODE — وهو اليوم مفتاح واحد، وهو الرقم المعروض على الشاشة بعينه.
//   (3) **لا تصريح حساس في مستوى، بأي مستوى من الثلاثة.** الحساس يُمنح لشخص بعينه بمنح مسجَّل ينبّه صاحبه
//       وكل مسؤول منصة، ويدخل حملة مراجعة الصلاحيات، ويُسحب بسحبه — والمستوى لا يفعل شيئًا من ذلك.
//       ومفاتيح الراتب السبعة تُرفض باسمها قبل الفحص العام، فيقول الرفض «راتب» لا «حساس».
//   (4) أدمن الإدارة تعريفه ما يفرضه الكود أدناه لا ما تقوله الشاشة: إدارته وحدها (بهوية الإدارتين لا
//       بـcan وحدها)، ولا مستوى نفسه، ولا يسلّم سلطة ضبط المستويات لأحد مهما كان اسم المستوى الذي تحملها.
//       والمالك — الأدمن الأول — يملك المصفوفة، ومنحُه نفسَه تصريحًا حساسًا يبقى ظاهرًا ومنبِّهًا كما هو
//       اليوم (app/access.mjs grantAccess وsensitiveGrantAlert)، لم يُمس.
import { audit, now } from './db.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import * as v from './validation.mjs';
import * as access from './access.mjs';
// مرجع تصعيد الإدارة: لوحُه يُعرض داخل هذه الشاشة نفسها، فالبيانات تصل مع بقية نموذجها.
import { escalationBoard, escalationSummary, escalationCandidates } from './department-escalation.mjs';

const LEVEL_KEYS=access.LEVELS.map(l=>l.key);
const MODES=['add','remove','follow'];

/* ───── البذرة المرآة ─────
   القالب المزروع مرآةٌ لما تقوله أدوار المنصة اليوم لا سياسة جديدة: مستوى «مدير الإدارة» يحمل تصاريح
   دور manager الثمانية عشر كما هي، ومستوى «موظف» فارغ (دور الموظف لا يحمل إلا تصاريح «الجميع» وهي ليست
   مما يُمنح)، ومستوى «أدمن الإدارة» يحمل تصريحه الجديد وحده ولا يُسنَد لأحد. فاتحاد الثلاثة مع الأدوار
   يساوي الأدوار بالضبط — وهو ما يثبته shadowCompare أدناه لا ما يُدّعى هنا.
   الترحيل 130 يكتب هذه الصفوف نفسها للكيانات القائمة عند ترقيته. وهذه الدالة للكيان الذي يُنشأ **بعد**
   الترحيل (وأولها البذرة التجريبية scripts/seed.mjs: تُنشئ كياناتها بعد أن تكون الترحيلات قد جرت على
   قاعدة فارغة). النصّان يجب أن يتطابقا، وtests/permission-shadow.test.mjs يقارنهما صفًّا بصف. */
export const COMPANY_TEMPLATE=Object.freeze({
  department_manager:Object.freeze(access.CAPABILITIES.filter(c=>c.roles?.includes('manager')).map(c=>c.key)),
  employee:Object.freeze([]),
  department_admin:Object.freeze(['department.levels.manage'])
});
const SEED_STAMP='2026-09-22T00:00:00.000Z';
export function installLevelDefaults(db,tenantId){
  db.prepare('INSERT INTO permission_level_settings(tenant_id) VALUES(?) ON CONFLICT(tenant_id) DO NOTHING').run(tenantId);
  const row=db.prepare('INSERT INTO permission_level_template(tenant_id,level,capability,decided_by,decided_at) VALUES(?,?,?,NULL,?) ON CONFLICT DO NOTHING');
  for(const [level,keys] of Object.entries(COMPANY_TEMPLATE))for(const key of keys)row.run(tenantId,level,key,SEED_STAMP);
  const level=db.prepare(`INSERT INTO user_permission_levels(tenant_id,user_id,level,assigned_by,assigned_at)
    SELECT tenant_id,id,CASE WHEN role='manager' THEN 'department_manager' ELSE 'employee' END,NULL,?
    FROM users WHERE tenant_id=? AND role<>'admin' ON CONFLICT DO NOTHING`);
  level.run(SEED_STAMP,tenantId);
}

// ما لا يبلغه **أيُّ مستوى** مهما وضعه المالك في قالبه. «لا يرى الرواتب» ليست عبارة على شاشة:
// هذه المفاتيح تُرفض عند الكتابة باسمها (رمز الرفض `salary`)، ومعها كل تصريح حساس (رمز `sensitive`).
// السبعة كلها حساسة أصلًا، وتُسمّى هنا صراحةً ليقول الرفض «راتب» لا «حساس» — فالسبب الذي يُقرأ هو الذي يُفهم.
export const SALARY_CAPABILITIES=Object.freeze(['payroll.prepare','payroll.review','payroll.approve','hr.compensation.review','hr.contracts.manage','costing.manage','profitability.view']);

const settings=(db,tenantId)=>db.prepare('SELECT * FROM permission_level_settings WHERE tenant_id=?').get(tenantId)
  ??{tenant_id:tenantId,enabled:0,enabled_by:null,enabled_at:null,first_enabled_at:null,basis:'',
     shadow_ran_at:null,shadow_ran_by:null,shadow_json:'',shadow_dirty:1};
const person=(db,tenantId,userId)=>db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId);
const capability=key=>access.CAPABILITIES.find(c=>c.key===key)??null;
const superAdminName=(db,tenantId)=>db.prepare("SELECT name FROM users WHERE tenant_id=? AND role='admin' AND admin_level='super' AND active=1 ORDER BY name").get(tenantId)?.name
  ??'الأدمن الأول';

/* ───── من يملك ماذا ───── */
// الأدمن الأول يملك المصفوفة كلها. أدمن الإدارة يملك مستويات أعضاء إدارته وحدها ولا يملك شيئًا آخر منها.
function owner(db,supplied){
  const u=actorOrRefuse(db,supplied);
  return {u,isSuper:access.isSuperAdmin(u),isDepartmentAdmin:access.can(db,u,'department.levels.manage',u.department_id)};
}
function requireOwner(db,supplied,what){
  const {u,isSuper}=owner(db,supplied);
  if(!isSuper)refuse(403,'forbidden',{what,
    missing:[{document:'امتياز الأدمن الأول (سوبر ادمن)',why:'قالب الصلاحيات واستثناءات الإدارات ومفتاح التشغيل قرار صاحب المنصة وحده',owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'اطلب من الأدمن الأول أن يجري التغيير من «مصفوفة الصلاحيات»، أو أن يمنحك امتياز الأدمن الأول'});
  return u;
}

/* ───── نموذج القراءة الذي ترسمه الشاشة ───── */
export function matrix(db,supplied){
  const {u,isSuper,isDepartmentAdmin}=owner(db,supplied);
  if(!isSuper&&!isDepartmentAdmin)refuse(403,'not_permitted',{what:'لا يُفتح ضبط مستويات الصلاحية بحسابك',
    missing:[{document:'تصريح «ضبط مستويات صلاحية أعضاء إدارتي» أو امتياز الأدمن الأول',why:'المصفوفة تغيّر ما يراه الموظفون ويفعلونه',owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'اطلب التصريح من الأدمن الأول من شاشة «الموظفون والصلاحيات»'});
  const tenantId=u.tenant_id;
  const departments=db.prepare('SELECT id,name,active FROM departments WHERE tenant_id=? ORDER BY name').all(tenantId).map(d=>({...d,active:!!d.active}));
  const template=db.prepare('SELECT level,capability FROM permission_level_template WHERE tenant_id=?').all(tenantId);
  // اسم من قرّر كل استثناء. الأدمن الأول وحده يكتب الاستثناءات (requireOwner)، وقائمة users أدناه تستثني
  // role='admin'، فكان العمود «قرّره» يطبع معرّف الحساب خامًا في كل صف. الاسم يأتي من هنا لا من تلك القائمة.
  const nameOf=new Map(db.prepare('SELECT id,name FROM users WHERE tenant_id=?').all(tenantId).map(r=>[r.id,r.name]));
  const exceptions=db.prepare('SELECT * FROM permission_level_exceptions WHERE tenant_id=? ORDER BY department_id,level,capability').all(tenantId)
    .map(x=>({...x,decided_by_name:nameOf.get(x.decided_by)??x.decided_by}));
  const assigned=db.prepare('SELECT user_id,level,assigned_by,assigned_at FROM user_permission_levels WHERE tenant_id=?').all(tenantId);
  const levelOf=new Map(assigned.map(r=>[r.user_id,r]));
  const users=db.prepare("SELECT id,name,username,role,department_id,active FROM users WHERE tenant_id=? AND role<>'admin' ORDER BY active DESC,name").all(tenantId)
    .filter(p=>isSuper||p.department_id===u.department_id)
    .map(p=>{
      const row=levelOf.get(p.id),level=row?.level??access.derivedLevel(p);
      // مصدر المستوى يُحسب بالمقارنة لا بـassigned_by وحدها: الترحيل وinstallLevelDefaults يكتبان NULL
      // لكل حساب، فكان كل صف يُقال عنه «مشتق من دوره» ولو خالف دورَه. الحالات ثلاث:
      //   assigned — قرّره شخص باسمه.   derived — لم يقرره أحد، وهو نفسه ما يشتقه الدور.
      //   stale    — لم يقرره أحد ولا يطابق الدور: صفٌّ من دور سابق. يُقال على الشاشة كما هو.
      return {id:p.id,name:p.name,username:p.username,role:p.role,department_id:p.department_id,active:!!p.active,level,
        level_source:row?.assigned_by?'assigned':level===access.derivedLevel(p)?'derived':'stale',
        derived_level:access.derivedLevel(p)};
    });
  // كل تصريح بصنف نطاقه ومرحلته، ومن يحمله اليوم حين يكون على مستوى الشركة (فيُعرض للقراءة باسم حامله لا بمنتقي إدارة).
  const capabilities=access.CAPABILITIES.map(c=>{
    const scope=access.scopeClass(c.key);
    return {key:c.key,name:c.name,group:c.group,scope,stage:access.scopeStage(c.key),
      sensitive:!!c.sensitive,admin:!!c.admin,super:!!c.super,everyone:!!c.everyone,
      grantable:!c.everyone&&!c.super,
      confined_in_code:access.CONFINED_IN_CODE.includes(c.key),
      levels:LEVEL_KEYS.filter(level=>template.some(r=>r.level===level&&r.capability===c.key)),
      holders:scope==='company'&&isSuper?access.capabilityHolders(db,tenantId,c.key).map(h=>h.name):[]};
  });
  const state=settings(db,tenantId);
  const escalation=isSuper?escalationBoard(db,tenantId):[];
  return {
    can_edit_template:isSuper,can_edit_levels:isSuper||isDepartmentAdmin,
    my_department:u.department_id,
    levels:access.LEVELS.map(l=>({...l,capabilities:template.filter(r=>r.level===l.key).map(r=>r.capability)})),
    summary:access.scopeSummary(),
    confined_in_code:access.CONFINED_IN_CODE,
    salary_capabilities:SALARY_CAPABILITIES,
    switch:{enabled:!!state.enabled,enabled_at:state.enabled_at,first_enabled_at:state.first_enabled_at,basis:state.basis},
    shadow:shadowView(db,tenantId,{withNames:isSuper}),
    // لوح مرجع التصعيد للأدمن الأول وحده: يسمّي حسابات الكيان كله ومن يقف فوق كل مدير إدارة، وأدمن
    // الإدارة لا يبلغ غير إدارته — القاعدة نفسها المطبَّقة على أسماء المقارنة الظلية وحاملي التصاريح أعلاه.
    can_edit_escalation:isSuper,
    escalation,
    escalation_summary:isSuper?escalationSummary(escalation):null,
    escalation_candidates:isSuper?escalationCandidates(db,tenantId):[],
    departments,capabilities,exceptions,users
  };
}

/* ───── المقارنة الظلية: الجواب القديم والجواب الجديد على كل حساب نشط وكل تصريح ─────
   ليست تقديرًا ولا عينة: تُستدعى can نفسها مرتين — بالمستويات مطفأة وبها مشتعلة — على كل حساب نشط
   في الكيان وكل تصريح من المئة، وعلى كل إدارة أيضًا للتصاريح التي تقبل نطاق إدارة. أي اختلاف يُسمّى
   بصاحبه وتصريحه واتجاهه (كسبٌ أم فقدان)، ولا يُشغَّل المفتاح وفيها اختلاف واحد. */
export function shadowCompare(db,tenantId){
  const users=db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1").all(tenantId);
  const departments=db.prepare('SELECT id FROM departments WHERE tenant_id=? AND active=1').all(tenantId).map(d=>d.id);
  const differences=[];
  let checks=0;
  for(const u of users){
    for(const c of access.CAPABILITIES){
      const scopes=c.scoped?[null,...departments]:[null];
      for(const scope of scopes){
        const before=access.can(db,u,c.key,scope,{levels:false});
        const after=access.can(db,u,c.key,scope,{levels:true});
        checks++;
        if(before!==after)differences.push({user_id:u.id,user_name:u.name,capability:c.key,capability_name:access.capabilityName(c.key),
          department_id:scope,direction:after?'gained':'lost'});
      }
    }
  }
  return {clean:differences.length===0,users:users.length,capabilities:access.CAPABILITIES.length,checks,
    gained:differences.filter(d=>d.direction==='gained').length,lost:differences.filter(d=>d.direction==='lost').length,
    differences:differences.slice(0,200)};
}

/* ───── المقارنة محفوظة لا محسوبة عند كل فتح ─────
   المقارنة تمرّ على كل حساب نشط × كل تصريح × كل إدارة نشطة للمحصور، وكل نداء can يقرأ أربعة جداول.
   على مقاس القاعدة الحية (٢٨ حسابًا نشطًا، ١٧ إدارة) هذه آلاف الاستعلامات ومئات المللي ثانية، والخادم
   raw node:http بخيط واحد وnode:sqlite متزامن — فحسابها عند كل فتح للشاشة يحجب كل طلب آخر على المنصة،
   ويبلغ المسارَ أدمنُ الإدارة لا المالك وحده. فتُحفظ نتيجة آخر تشغيل، وتُعرض كما هي بختمها ومن شغّلها،
   وتُوسم «لم تعد تصف الحال» عند أول كتابة في القالب أو الاستثناءات أو مستويات الحسابات.
   وsetSwitch تعيد الحساب لحظةَ التشغيل مهما كان المحفوظ: البوابة لا تُبنى على نتيجة قديمة. */
function markShadowDirty(db,tenantId){
  db.prepare('INSERT INTO permission_level_settings(tenant_id,shadow_dirty) VALUES(?,1) ON CONFLICT(tenant_id) DO UPDATE SET shadow_dirty=1').run(tenantId);
}
function saveShadow(db,tenantId,result,userId){
  db.prepare(`INSERT INTO permission_level_settings(tenant_id,shadow_ran_at,shadow_ran_by,shadow_json,shadow_dirty) VALUES(?,?,?,?,0)
    ON CONFLICT(tenant_id) DO UPDATE SET shadow_ran_at=excluded.shadow_ran_at,shadow_ran_by=excluded.shadow_ran_by,shadow_json=excluded.shadow_json,shadow_dirty=0`)
    .run(tenantId,now(),userId,JSON.stringify(result));
  return result;
}
// ما تعرضه الشاشة. لأدمن الإدارة **الحكم والأرقام بلا أسماء**: الاختلافات تسمّي حسابات الكيان كله
// وتصاريحها، وهو لا يرى في الجدول تحتها إلا أعضاء إدارته — فإرسالها إليه إفشاءٌ في لوحة تقول له
// «أعضاء إدارتك وحدهم». والمفتاح ليس من شأنه أصلًا: يشغّله الأدمن الأول ويقرأ هو نتيجته.
function shadowView(db,tenantId,{withNames}){
  const state=settings(db,tenantId);
  const stored=state.shadow_json?JSON.parse(state.shadow_json):null;
  const base={ran_at:state.shadow_ran_at??null,ran_by:state.shadow_ran_by?person(db,tenantId,state.shadow_ran_by)?.name??null:null,
    dirty:!!state.shadow_dirty,never_run:!stored,names_withheld:!withNames};
  if(!stored)return {...base,clean:null,users:0,capabilities:access.CAPABILITIES.length,checks:0,gained:0,lost:0,differences:[]};
  return {...base,...stored,differences:withNames?stored.differences:[]};
}

// تشغيل المقارنة بطلب صريح من الأدمن الأول، لا عند كل فتح للشاشة. ليست قرارًا يُسجَّل في سلسلة التدقيق
// (لا تكتب في القالب ولا في المستويات ولا في المفتاح): هي قراءةٌ تُحفظ نتيجتها بختمها وباسم من شغّلها.
export function runShadow(db,supplied){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم تُحفظ نتيجة المقارنة',next:'أعد المحاولة؛ تُحفظ النتيجة داخل معاملة واحدة'});
  const u=requireOwner(db,supplied,'لا تُشغَّل المقارنة الظلية بحسابك');
  saveShadow(db,u.tenant_id,shadowCompare(db,u.tenant_id),u.id);
  return shadowView(db,u.tenant_id,{withNames:true});
}

/* ───── قالب الشركة ───── */
export function setTemplate(db,supplied,input){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم يُحفظ تغيير القالب',next:'أعد المحاولة؛ يُنفَّذ التغيير داخل معاملة واحدة'});
  const u=requireOwner(db,supplied,'لا يُعدَّل قالب مستويات الشركة بحسابك');
  v.object(input,['level','capability','included']);
  const level=String(input.level??''),key=String(input.capability??''),included=input.included===true||input.included==='true';
  if(!LEVEL_KEYS.includes(level))refuse(400,'level',{what:'المستوى غير معروف',next:`اختر أحد المستويات الثلاثة: ${access.LEVELS.map(l=>l.name).join('، ')}`});
  const c=capability(key);
  if(!c)refuse(404,'capability',{what:`لا تصريح بالمفتاح «${key}» في المنصة`,next:'اختر تصريحًا من قائمة المصفوفة'});
  guardTemplateCapability(c,level);
  const existing=db.prepare('SELECT 1 FROM permission_level_template WHERE tenant_id=? AND level=? AND capability=?').get(u.tenant_id,level,key);
  if(included&&!existing)db.prepare('INSERT INTO permission_level_template(tenant_id,level,capability,decided_by,decided_at) VALUES(?,?,?,?,?)').run(u.tenant_id,level,key,u.id,now());
  else if(!included&&existing)db.prepare('DELETE FROM permission_level_template WHERE tenant_id=? AND level=? AND capability=?').run(u.tenant_id,level,key);
  else return {level,capability:key,included};
  markShadowDirty(db,u.tenant_id);
  audit(db,u,'access',level,'access.level_template',{capability:key,included:!included},{capability:key,included});
  return {level,capability:key,included};
}
// ما لا يدخل قالبًا أبدًا، بأي مستوى ومن أي حساب: تصريح يحمله الجميع أصلًا (فوضعه يوحي بقرار ليس بقرار)،
// وتصريح الأدمن الأول (لا يُمنح ولا يُورَّث، إنما يُستنتج من admin_level)، وتصريح إدارة المنصة (لحساب إداري
// وحده، ولا حساب إداري يحمل مستوى إدارة). والمستوى لا يحصر: تصريح على مستوى الشركة يبقى على مستوى الشركة
// حيثما وُضع، فلا يوضع في مستوى إدارة بإيحاء أنه صار محصورًا بها.
//
// و**التصريح الحساس مرفوض في المستويات الثلاثة لا في واحد منها.** كان الرفض على مستوى أدمن الإدارة وحده،
// فكان مسير الرواتب يُوضع في مستوى «مدير الإدارة» أو «موظف» فيبلغ كل من هو عليه: بلا صفٍّ في access_grants
// (فلا يعمل عليه access.revokeAccess)، وبلا sensitiveGrantAlert (فلا يُنبَّه صاحبه ولا مسؤولو المنصة)،
// وخارج حملات مراجعة الصلاحيات (access_review_items.source محكوم بثلاث قيم ليس فيها المستوى). والفرق الذي
// تبيعه الشاشة هو هذا بعينه: «الحساس يُمنح لشخص بعينه بمنح مسجَّل ينبّه صاحبه وكل مسؤول منصة». فلا طريق
// للحساس عبر المستوى أصلًا — ودفاعًا بالعمق يُسقطه المرشِّح عند القراءة أيضًا (access.capabilitiesOfLevel).
function guardTemplateCapability(c,level){
  if(c.everyone)refuse(400,'capability',{what:`«${c.name}» يحمله كل موظف أصلًا`,next:'لا حاجة لوضعه في مستوى؛ اختر تصريحًا يُمنح'});
  if(c.super)refuse(400,'capability',{what:`«${c.name}» امتياز الأدمن الأول ولا يُمنح ولا يُوضع في مستوى`,next:'يُعيَّن الأدمن الأول من «الموظفون والصلاحيات» بتغيير مستوى الإدارة'});
  if(c.admin)refuse(400,'capability',{what:`«${c.name}» من تصاريح إدارة المنصة ولا يحمله إلا حساب إداري`,
    missing:[{document:'حساب بدور «مسؤول المنصة»',why:'مستوى الإدارة يُسنَد لموظفي الإدارات لا لحسابات إدارة المنصة',owner:'الأدمن الأول',owner_role:'admin'}],
    next:'امنح هذا التصريح لحساب إداري بعينه من «الموظفون والصلاحيات» بدل وضعه في مستوى'});
  if(SALARY_CAPABILITIES.includes(c.key))refuse(400,'salary',{what:`«${c.name}» من مفاتيح الراتب والتعويضات والتكلفة والربحية، ولا يحمله مستوى ${access.levelName(level)} ولا غيره من المستويات`,
    missing:[{document:'منح مسجَّل باسم شخص بعينه',why:'مفاتيح الراتب تُمنح فردًا فردًا بمنح يُنبَّه به صاحبه وكل مسؤول منصة، ويدخل حملة مراجعة الصلاحيات، ويُسحب بسحبه',owner:'الأدمن الأول',owner_role:'admin'}],
    next:'امنحه لشخص بعينه من «الموظفون والصلاحيات»؛ المستوى ليس طريقًا للرواتب'});
  if(c.sensitive)refuse(400,'sensitive',{what:`«${c.name}» تصريح حساس، ولا يحمله مستوى ${access.levelName(level)} ولا غيره من المستويات`,
    missing:[{document:'منح مسجَّل باسم شخص بعينه',why:'التصريح الحساس ينبّه صاحبه وكل مسؤول منصة عند منحه، ويدخل حملة مراجعة الصلاحيات، ويُسحب بسحب منحه — والمستوى لا يفعل شيئًا من ذلك',owner:'الأدمن الأول',owner_role:'admin'}],
    next:'امنحه لشخص بعينه بمنح مسجَّل من «الموظفون والصلاحيات»، فيظهر في مراجعة الصلاحيات وينبّه صاحبه'});
}

/* ───── استثناء الإدارة ───── */
export function setException(db,supplied,input){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم يُحفظ استثناء الإدارة',next:'أعد المحاولة؛ يُنفَّذ التغيير داخل معاملة واحدة'});
  const u=requireOwner(db,supplied,'لا تُعدَّل استثناءات الإدارات بحسابك');
  v.object(input,['department_id','level','capability','mode','basis']);
  const level=String(input.level??''),key=String(input.capability??''),mode=String(input.mode??'');
  if(!LEVEL_KEYS.includes(level))refuse(400,'level',{what:'المستوى غير معروف',next:`اختر أحد المستويات الثلاثة: ${access.LEVELS.map(l=>l.name).join('، ')}`});
  if(!MODES.includes(mode))refuse(400,'mode',{what:'وضع الاستثناء غير معروف',next:'اختر: إضافة لهذه الإدارة، أو حجب عنها، أو رجوع إلى قالب الشركة'});
  const c=capability(key);
  if(!c)refuse(404,'capability',{what:`لا تصريح بالمفتاح «${key}» في المنصة`,next:'اختر تصريحًا من قائمة المصفوفة'});
  // الحجب والرجوع إلى القالب جائزان على أي تصريح: التضييق صادق دائمًا. أما **الإضافة لإدارة واحدة**
  // فلا تجوز إلا على تصريح يحصره الكود بإدارة فعلًا — وإلا كان السطر يقول «لهذه الإدارة» بينما حامله
  // يفتح به الشركة كلها. هذه هي القاعدة التي تمنع الشاشة من أن تعد بحصر لا يفعله الكود.
  //
  // والقياس على **العضوية في access.CONFINED_IN_CODE** لا على صنف النطاق. كان الفحص `scopeClass!=='department'`،
  // وscopeClass تعيد 'department' لكل ما يحمل scoped:true وهي سبعة مفاتيح، بينما الذي يحصره الكود فعلًا
  // واحد — فكان الحارس أوسع من القاعدة بستة مفاتيح، تُضاف «لهذه الإدارة وحدها» وحاملها يبلغ بها الشركة كلها
  // (can بلا نطاق تعود true، والمستهلكون يعزلون بعضوية فريق العميل أو بإدارة الفاعل، لا بإدارة الاستثناء).
  // والرقم الآن واحدٌ واحد مع البلاطة المعروضة على الشاشة: «منها يحصره الكود فعلًا اليوم».
  if(mode==='add'){
    guardTemplateCapability(c,level);
    if(!access.CONFINED_IN_CODE.includes(c.key))refuse(400,'scope_not_confined',{
      what:`«${c.name}» لا يحصره الكود بإدارة، فإضافته لإدارة واحدة تعطي حامليها سلطته على الشركة كلها لا على إدارتهم`,
      missing:[{document:'حصرٌ مطبَّق في الشيفرة لهذا التصريح',why:'المرحلة (ب): تصفية صفوفه بإدارة، وهي ليست في هذه الموجة',owner:'فريق المنصة',owner_role:'admin'}],
      next:'ضعه في قالب الشركة إن أردته لكل من هو على هذا المستوى، أو امنحه لشخص بعينه من «الموظفون والصلاحيات»'});
  }
  const department=db.prepare('SELECT id,name,active FROM departments WHERE id=? AND tenant_id=?').get(input.department_id,u.tenant_id);
  if(!department)refuse(404,'department',{what:'الإدارة غير موجودة في هذا الكيان',next:'اختر إدارة من القائمة'});
  if(!department.active)refuse(409,'department',{what:`إدارة «${department.name}» مؤرشفة، فلا يُكتب لها استثناء جديد`,
    next:'أعد تفعيل الإدارة من «الإدارات والهيكل» إن كانت ما تزال عاملة، أو انقل موظفيها إلى إدارة قائمة'});
  const basis=v.text(input.basis,'سبب الاستثناء',500,10);
  const before=db.prepare('SELECT mode FROM permission_level_exceptions WHERE tenant_id=? AND department_id=? AND level=? AND capability=?').get(u.tenant_id,department.id,level,key);
  db.prepare(`INSERT INTO permission_level_exceptions(tenant_id,department_id,level,capability,mode,basis,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,department_id,level,capability) DO UPDATE SET mode=excluded.mode,basis=excluded.basis,decided_by=excluded.decided_by,decided_at=excluded.decided_at`)
    .run(u.tenant_id,department.id,level,key,mode,basis,u.id,now());
  markShadowDirty(db,u.tenant_id);
  audit(db,u,'access',department.id,'access.level_exception',{level,capability:key,mode:before?.mode??null},{level,capability:key,mode},basis);
  return {department_id:department.id,level,capability:key,mode};
}

/* ───── مستوى الحساب ───── */
export function setUserLevel(db,supplied,input){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم يُحفظ تغيير المستوى',next:'أعد المحاولة؛ يُنفَّذ التغيير داخل معاملة واحدة'});
  const {u,isSuper}=owner(db,supplied);
  v.object(input,['user_id','level','reason']);
  const target=person(db,u.tenant_id,input.user_id);
  if(!target||!target.active)refuse(404,'not_found',{what:'الحساب غير متاح في هذا الكيان',next:'اختر حسابًا نشطًا من القائمة'});
  // لا «بلا مستوى»: كل موظف على أحد الثلاثة. من لم يُضبط له مستوى بعدُ يحمل ما اشتقه الترحيل من دوره.
  const level=String(input.level??'');
  if(!LEVEL_KEYS.includes(level))refuse(400,'level',{what:'المستوى غير معروف',next:`اختر أحد المستويات الثلاثة: ${access.LEVELS.map(l=>l.name).join('، ')}`});
  if(target.role==='admin')refuse(409,'role',{what:'حساب إدارة المنصة لا يحمل مستوى إدارة',
    next:'مستوى هذا الحساب يُضبط من «الموظفون والصلاحيات» بتغيير مستوى الإدارة (أدمن أول أو أدمن محدد)'});
  if(!isSuper){
    // أدمن الإدارة: إدارته وحدها، ولا يرفع نفسه، ولا يصنع من يضبط المستويات. القيود مفروضة هنا لا مرسومة على الشاشة.
    //
    // (1) الإدارة تُقاس بهوية الإدارتين لا بـcan() وحدها. can() ليست موضعًا صالحًا للحصر: منحٌ بلا نطاق
    //     يرضيها في كل إدارة (`if(!departmentId)return true`)، فكان منحٌ واحد غير محصور يجعل حامله أدمن
    //     مستويات على الكيان كله بينما اسم التصريح والشاشة يقولان «أعضاء إدارتي وحدهم». المنح بلا نطاق
    //     صار مرفوضًا في grantAccess أيضًا (department_required)، وهذا الفحص هو الحارس الثاني.
    if(u.department_id!==target.department_id||!access.can(db,u,'department.levels.manage',target.department_id))refuse(403,'department',{what:'لا يُضبط مستوى حساب خارج إدارتك',
      missing:[{document:`تصريح ضبط المستويات في إدارة هذا الحساب`,why:'أدمن الإدارة يضبط أعضاء إدارته وحدهم',owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اطلب من الأدمن الأول ضبط هذا الحساب، أو من أدمن إدارته'});
    if(target.id===u.id)refuse(409,'self',{what:'لا ترفع مستوى نفسك ولا تخفضه',
      missing:[{document:'قرار شخص آخر',why:'من يضبط المستويات لا يضبط مستواه هو؛ هذا هو فصل المهام نفسه',owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اطلب من الأدمن الأول تغيير مستواك'});
    // (2) القياس على **ما يحمله المستوى** لا على اسمه. كان الرفض على الاسم `department_admin` وحده،
    //     فكان المالك إن وضع department.levels.manage في مستوى «مدير الإدارة» (أو أضافه لإدارة باستثناء)
    //     صار أدمن الإدارة يصنع أدمن إدارة آخر باسم آخر، ثم يرفعه ذاك — فتسقط قاعدة «لا ترفع نفسك»
    //     بخطوتين متواطئتين. الممنوع هو **تسليم سلطة التسليم**، أيًّا كان اسم المستوى الذي تحملها.
    //     وما عدا ذلك يبقى جائزًا عمدًا: القالب قرار المالك، وأدمن الإدارة يختار من يجلس على أي مستوى
    //     منه — ولو حمل المستوى تصاريح لا يحملها هو، فتلك سياسة المالك لا ترقيةٌ لنفسه.
    const gains=access.capabilitiesOfLevel(db,u.tenant_id,level,target.department_id,target.role);
    if(level==='department_admin'||gains.has('department.levels.manage'))refuse(403,'level',{what:`تسمية من يضبط مستويات الصلاحية قرار الأدمن الأول${level==='department_admin'?'':`، ومستوى «${access.levelName(level)}» يحمل اليوم «ضبط مستويات صلاحية أعضاء إدارتي»`}`,
      missing:[{document:'قرار الأدمن الأول',why:'أدمن الإدارة يضبط مستويات أعضائه ولا يسلّم سلطة التسليم لأحد',owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اطلب من الأدمن الأول تسمية أدمن إدارة إضافي'});
  }
  const previous=access.userLevel(db,target);
  const reason=input.reason?v.text(input.reason,'السبب',500,3):'';
  db.prepare(`INSERT INTO user_permission_levels(tenant_id,user_id,level,assigned_by,assigned_at) VALUES(?,?,?,?,?)
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET level=excluded.level,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at`)
    .run(u.tenant_id,target.id,level,u.id,now());
  // الجلسات تُنهى كما تُنهى عند سحب منح (app/access.mjs revokeAccess): التغيير يسري الآن لا عند الدخول التالي.
  if(previous!==level)db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  markShadowDirty(db,u.tenant_id);
  audit(db,u,'access',target.id,'access.level_assigned',{level:previous},{level},reason);
  return {user_id:target.id,level};
}

/* ───── المفتاح ───── */
// **الانتقال الأول** وحده مشروط بمقارنة نظيفة، لا كل تشغيل. المقارنة تجيب سؤالًا واحدًا: «هل يغيّر الانتقالُ
// من نظام الأدوار إلى نظام المستويات جوابَ أحد؟» — وهو سؤال الانتقال الأول. بعده يسند المالك مستوى عن قصد
// (وهو غرض الميزة) فتصير المقارنة غير نظيفة بالضرورة، ولو بقي الشرط على كل تشغيل لصار الإطفاء بابًا لا رجعة
// منه: يطفئه المالك في حادثة ثم لا يعيده إلا بمحو كل إسناد وكل صف قالب أضافه. فبعد أول تشغيل يُعاد التشغيل
// وتُحفظ نتيجة المقارنة ويُكتب في الحدث ما ستغيّره، ولا يُرفض. الرفض يحمل الرقم نفسه الذي تعرضه الشاشة.
export function setSwitch(db,supplied,input){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم يُحفظ تغيير المفتاح',next:'أعد المحاولة؛ يُنفَّذ التغيير داخل معاملة واحدة'});
  const u=requireOwner(db,supplied,'لا يُشغَّل حساب المستويات ولا يُطفأ بحسابك');
  v.object(input,['enabled','basis']);
  const enabled=input.enabled===true||input.enabled==='true';
  const state=settings(db,u.tenant_id);
  const basis=v.text(input.basis,'الأساس',500,10);
  let shadow=null;
  if(enabled){
    // تُحسب لحظةَ التشغيل لا تُقرأ من المحفوظ: البوابة لا تُبنى على نتيجة قديمة.
    shadow=saveShadow(db,u.tenant_id,shadowCompare(db,u.tenant_id),u.id);
    if(!shadow.clean&&!state.first_enabled_at)refuse(409,'shadow_not_clean',{
      what:`المقارنة الظلية ليست نظيفة: ${shadow.differences.length} اختلافًا بين الجواب القديم والجديد (${shadow.gained} كسبًا و${shadow.lost} فقدانًا) على ${shadow.users} حسابًا نشطًا`,
      missing:shadow.differences.slice(0,5).map(d=>({document:`${d.user_name} — ${d.capability_name}`,
        why:d.direction==='gained'?'يكسب تصريحًا لا يحمله اليوم':'يفقد تصريحًا يحمله اليوم',owner:superAdminName(db,u.tenant_id),owner_role:'admin'})),
      next:'صحّح القالب أو استثناءات الإدارات حتى تصير المقارنة صفرًا، ثم شغّل المفتاح؛ وبعد أول تشغيل ناجح يجوز الإطفاء والإعادة بلا هذا الشرط'});
  }
  db.prepare(`INSERT INTO permission_level_settings(tenant_id,enabled,enabled_by,enabled_at,first_enabled_at,basis) VALUES(?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,enabled_by=excluded.enabled_by,enabled_at=excluded.enabled_at,
      first_enabled_at=coalesce(permission_level_settings.first_enabled_at,excluded.first_enabled_at),basis=excluded.basis`)
    .run(u.tenant_id,enabled?1:0,enabled?u.id:null,enabled?now():null,enabled?now():null,basis);
  audit(db,u,'access',u.tenant_id,'access.levels_switch',{enabled:!!state.enabled},
    {enabled,...(shadow?{shadow_clean:shadow.clean,shadow_gained:shadow.gained,shadow_lost:shadow.lost}:{})},basis);
  return {enabled,shadow_clean:shadow?shadow.clean:null};
}
