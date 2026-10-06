// مستويات الصلاحية على الإدارة (ترحيل 130). كل اختبار هنا يقيس قاعدة **يفرضها الكود**، لا جملة تُكتب على شاشة:
// أدمن الإدارة يبلغ إدارته وحدها ولا يرفع نفسه ولا يسلّم سلطة التسليم، ولا مستوى يحمل تصريحًا حساسًا ولا راتبًا،
// والتصريح الذي لا يحصره الكود لا يُعرض حصره على أحد، والمستوى لا يعيش بعد الدور الذي اشتُق منه،
// والمستوى يضيف ولا يسحب، وكل تغيير يترك حدثًا في السلسلة المبصومة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as access from '../app/access.mjs';
import * as levels from '../app/department-levels.mjs';
import * as admin from '../app/admin.mjs';
import { holdsSensitive } from '../app/session-policy.mjs';

const PASSWORD='synthetic-department-levels';
const code=c=>error=>error.code===c;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function setup(t){const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());return db;}
// أدمن إدارة حقيقي: منحٌ مسجَّل للتصريح الجديد محصورًا بإدارة «creative»، يكتبه الأدمن الأول.
// «manager» و«employee» و«outsider» كلهم في creative، و«hr» خارجها — فالحدود قابلة للقياس.
function departmentAdmin(db){
  transaction(db,()=>access.grantAccess(db,user(db,'admin'),
    {user_id:'manager',capability:'department.levels.manage',department_id:'creative',note:'أدمن الإدارة الإبداعية التجريبية'}));
  return user(db,'manager');
}
const enable=(db,first)=>transaction(db,()=>levels.setSwitch(db,first,{enabled:true,basis:'المقارنة الظلية نظيفة على البيانات المصطنعة'}));

test('LEVELS: أدمن الإدارة يبلغ إدارته وحدها، ولا يرفع مستوى نفسه، ولا يسمّي من يضبط المستويات',t=>{
  const db=setup(t),boss=departmentAdmin(db);
  assert.equal(access.can(db,boss,'department.levels.manage','creative'),true);
  assert.equal(access.can(db,boss,'department.levels.manage','hr'),false,'المنح المحصور لا يتسرب إلى إدارة أخرى');
  // داخل إدارته: يجوز.
  transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'employee',level:'department_manager',reason:'تقود فريق التسليم'}));
  assert.equal(access.userLevel(db,user(db,'employee')),'department_manager');
  // خارج إدارته: مرفوض بالإدارة لا بالصدفة.
  assert.throws(()=>transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'hr',level:'department_manager',reason:'خارج إدارته'})),code('department'));
  assert.equal(access.userLevel(db,user(db,'hr')),'employee','الحساب خارج الإدارة لم يتغير مستواه');
  // نفسه: مرفوض.
  assert.throws(()=>transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'manager',level:'department_admin',reason:'أرفع نفسي'})),code('self'));
  // أدمن إدارة جديد: قرار الأدمن الأول وحده.
  assert.throws(()=>transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'outsider',level:'department_admin',reason:'نائبي'})),code('level'));
  transaction(db,()=>levels.setUserLevel(db,user(db,'admin'),{user_id:'outsider',level:'department_admin',reason:'قرار المالك'}));
  assert.equal(access.userLevel(db,user(db,'outsider')),'department_admin');
});

test('LEVELS: منحٌ بلا إدارة لا يصنع أدمن مستويات على الكيان كله — لا عند المنح ولا عند القراءة',t=>{
  const db=setup(t),first=user(db,'admin');
  // (1) المنح نفسه مرفوض: التصريح الذي يحصره الكود بإدارة لا يُمنح بلا إدارة.
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,
    {user_id:'it',capability:'department.levels.manage',department_id:null,note:'بلا إدارة'})),code('department_required'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM access_grants WHERE capability='department.levels.manage'").get().n,0);
  // (2) ولو وُجد صفٌّ بلا إدارة (قاعدة رُقِّيت قبل هذه القاعدة، أو كتابةٌ مباشرة): can ترضى به في كل إدارة
  //     — وهذا بعينه سبب ألا تكون can موضع الحصر — لكن setUserLevel تقيس هوية الإدارتين فترفض.
  transaction(db,()=>db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES('legacy-unscoped','36t','it','department.levels.manage',NULL,'صفّ قديم بلا نطاق','admin','2026-09-01T00:00:00.000Z')").run());
  const wide=user(db,'it');
  assert.equal(wide.department_id,'it');
  assert.equal(access.can(db,wide,'department.levels.manage','creative'),true,'can ترضى: منحٌ بلا نطاق يرضيها في كل إدارة');
  assert.throws(()=>transaction(db,()=>levels.setUserLevel(db,wide,{user_id:'employee',level:'department_manager',reason:'من إدارة أخرى'})),code('department'));
  assert.equal(access.userLevel(db,user(db,'employee')),'employee','لم يتغير مستوى حساب في إدارة أخرى');
  // وداخل إدارته هو يبقى الضبط جائزًا: الحارس على الإدارة لا على الحساب.
  transaction(db,()=>db.prepare("UPDATE users SET department_id='it',manager_id=NULL WHERE id='outsider'").run());
  transaction(db,()=>levels.setUserLevel(db,wide,{user_id:'outsider',level:'department_manager',reason:'عضو إدارته'}));
  assert.equal(access.userLevel(db,user(db,'outsider')),'department_manager');
});

test('LEVELS: لا تصريح حساس ولا راتب في أي مستوى من الثلاثة، والرفض يسمّي «راتب» حين يكون راتبًا',t=>{
  const db=setup(t),first=user(db,'admin');
  // «لا يرى الرواتب» قاعدة مفروضة لا عبارة، وعلى **المستويات الثلاثة** لا على مستوى واحد منها.
  for(const level of ['department_admin','department_manager','employee']){
    for(const key of levels.SALARY_CAPABILITIES)
      assert.throws(()=>transaction(db,()=>levels.setTemplate(db,first,{level,capability:key,included:true})),code('salary'),`${level}/${key}`);
    for(const key of ['hr.cases.handle','privacy.manage','bank.reconcile','definitions.publish'])
      assert.throws(()=>transaction(db,()=>levels.setTemplate(db,first,{level,capability:key,included:true})),code('sensitive'),`${level}/${key}`);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM permission_level_template WHERE level='department_admin'").get().n,2,
    'قالب أدمن الإدارة بقي على تصريحه الواحد في كل كيان');
  assert.ok(levels.SALARY_CAPABILITIES.every(key=>access.CAPABILITIES.find(c=>c.key===key)?.sensitive),'كل مفتاح راتب حساس أيضًا، فالحارسان يتفقان');
  // ولا يدخل قالبًا: تصريح الجميع، ولا امتياز الأدمن الأول، ولا تصاريح إدارة المنصة.
  for(const [key,expected] of [['portal.use','capability'],['access.manage','capability'],['accounts.manage','capability']])
    assert.throws(()=>transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:key,included:true})),code(expected),key);
});

test('LEVELS: الحساس مرفوض عند القراءة أيضًا، فصفٌّ مزروع في الجدول لا يفتح بابًا ولا يغيّر مهلة الجلسة',t=>{
  const db=setup(t),first=user(db,'admin');
  enable(db,first);
  // دفاع بالعمق: صف يُكتب في القالب مباشرةً بلا مرور بـsetTemplate يسقط في مرشِّح القراءة.
  transaction(db,()=>db.prepare("INSERT INTO permission_level_template(tenant_id,level,capability,decided_by,decided_at) VALUES('36t','employee','payroll.approve',NULL,'2026-09-22T00:00:00.000Z')").run());
  const employee=user(db,'employee');
  assert.equal(access.can(db,employee,'payroll.approve'),false,'الحساس لا يصل بالمستوى مهما كان في الجدول');
  assert.equal(access.holds(db,employee,'payroll.approve'),false);
  assert.equal(access.capabilitiesFor(db,employee).list.includes('payroll.approve'),false);
  // ولهذا لا تفترق مهلة الخمول عن حقيقة ما يحمله: لا حساس بالمستوى، فلا جلسة «عادية» تحمل حساسًا.
  assert.equal(holdsSensitive(db,employee),false);
  // والمسار المسجَّل يعمل كما كان: منحٌ صريح ينبّه ويجعل الجلسة حساسة.
  transaction(db,()=>access.grantAccess(db,first,{user_id:'outsider',capability:'payroll.approve',note:'منح مسجَّل في التجربة'}));
  const outsider=user(db,'outsider');
  assert.equal(access.holds(db,outsider,'payroll.approve'),true);
  assert.equal(holdsSensitive(db,outsider),true);
  assert.ok(db.prepare("SELECT count(*) AS n FROM notifications WHERE user_id='outsider'").get().n>0,'المنح الحساس ما زال ينبّه صاحبه');
});

test('LEVELS: «الإضافة لإدارة» لا تجوز إلا على ما يحصره الكود فعلًا، والحجب جائز على الكل',t=>{
  const db=setup(t),first=user(db,'admin');
  assert.equal(access.scopeClass('payroll.approve'),'company');
  assert.equal(access.scopeClass('commercial.use'),'department');
  assert.equal(access.scopeClass('leave.use'),'personal');
  // القائمة تُشتق من التعريف فلا تتخلّف حين يتغير: كل ما صنفه «إدارة» وليس في CONFINED_IN_CODE.
  const acceptsScope=access.CAPABILITIES.filter(c=>access.scopeClass(c.key)==='department');
  const notConfined=acceptsScope.filter(c=>!access.CONFINED_IN_CODE.includes(c.key));
  assert.ok(notConfined.length>=6,'أكثر ما يقبل النطاق لا يحصره الكود، وهذا هو الفرق الذي يحرسه الاختبار');
  for(const c of notConfined)
    assert.throws(()=>transaction(db,()=>levels.setException(db,first,
      {department_id:'creative',level:'employee',capability:c.key,mode:'add',basis:'أريدها لهذه الإدارة وحدها'})),code('scope_not_confined'),c.key);
  // وما هو على مستوى الشركة كذلك.
  assert.throws(()=>transaction(db,()=>levels.setException(db,first,
    {department_id:'creative',level:'department_manager',capability:'payroll.approve',mode:'add',basis:'أريدها للإبداع وحدها'})),code('salary'));
  assert.throws(()=>transaction(db,()=>levels.setException(db,first,
    {department_id:'creative',level:'department_manager',capability:'review.manage',mode:'add',basis:'أريدها للإبداع وحدها'})),code('scope_not_confined'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM permission_level_exceptions WHERE mode='add'").get().n,0,'لم يُكتب استثناء إضافة واحد');
  // والمحصور فعلًا يجوز: وهو المفتاح الوحيد الذي يقارن فيه الكود إدارة الصف بإدارة الفاعل.
  for(const key of access.CONFINED_IN_CODE)
    transaction(db,()=>levels.setException(db,first,{department_id:'creative',level:'employee',capability:key,mode:'add',basis:'أدمن إدارة إضافي للفريق الإبداعي التجريبي'}));
  // الحجب تضييق، والتضييق صادق دائمًا — على ما يقبل النطاق وعلى ما لا يقبله.
  for(const [key,level] of [['budgets.use','department_manager'],['commercial.use','employee'],['payroll.approve','employee']])
    transaction(db,()=>levels.setException(db,first,{department_id:'creative',level,capability:key,mode:'remove',basis:'يُدار مركزيًا في التجربة لا في الإدارة'}));
  assert.equal(db.prepare("SELECT mode FROM permission_level_exceptions WHERE department_id='creative' AND capability='budgets.use'").get().mode,'remove');
  // الرجوع عن الاستثناء سطرٌ بوضع «يتبع قالب الشركة»، لا محوٌ لصفه.
  assert.throws(()=>db.prepare("DELETE FROM permission_level_exceptions WHERE department_id='creative'").run(),/append-only|recorded decision/);
  transaction(db,()=>levels.setException(db,first,
    {department_id:'creative',level:'department_manager',capability:'budgets.use',mode:'follow',basis:'رجوع إلى قالب الشركة بقرار المالك'}));
  assert.equal(db.prepare("SELECT mode FROM permission_level_exceptions WHERE department_id='creative' AND capability='budgets.use'").get().mode,'follow');
});

test('LEVELS: أدمن الإدارة لا يسلّم سلطة ضبط المستويات مهما كان اسم المستوى الذي تحملها',t=>{
  const db=setup(t),first=user(db,'admin'),boss=departmentAdmin(db);
  enable(db,first);
  // المالك يضع ضبط المستويات في مستوى «مدير الإدارة» — وهو قراره وله أن يفعل.
  transaction(db,()=>levels.setTemplate(db,first,{level:'department_manager',capability:'department.levels.manage',included:true}));
  // وأدمن الإدارة لا يستطيع ترقية أحد إليه: القياس على ما يحمله المستوى لا على اسمه.
  assert.throws(()=>transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'employee',level:'department_manager',reason:'نائبي'})),code('level'));
  assert.equal(access.holds(db,user(db,'employee'),'department.levels.manage'),false,'ولم تصل السلطة لأحد');
  // ولا من باب استثناء الإدارة: الاستثناء داخلٌ في الحساب نفسه.
  transaction(db,()=>levels.setTemplate(db,first,{level:'department_manager',capability:'department.levels.manage',included:false}));
  transaction(db,()=>levels.setException(db,first,{department_id:'creative',level:'employee',capability:'department.levels.manage',mode:'add',basis:'أضفتها لمستوى موظف في الإبداع'}));
  assert.throws(()=>transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'outsider',level:'employee',reason:'مستوى موظف لا غير'})),code('level'));
  // وما لا يحمل السلطة يبقى جائزًا: القالب قرار المالك، وأدمن الإدارة يختار من يجلس عليه.
  transaction(db,()=>levels.setException(db,first,{department_id:'creative',level:'employee',capability:'department.levels.manage',mode:'follow',basis:'رجوع عن الاستثناء بقرار المالك'}));
  transaction(db,()=>levels.setUserLevel(db,boss,{user_id:'outsider',level:'department_manager',reason:'يقود فريق التسليم'}));
  assert.equal(access.userLevel(db,user(db,'outsider')),'department_manager');
});

test('LEVELS: المستوى لا يعيش بعد الدور الذي اشتُق منه',t=>{
  const db=setup(t),first=user(db,'admin');
  enable(db,first);
  transaction(db,()=>db.prepare("UPDATE users SET manager_id=NULL WHERE manager_id='manager'").run());
  const before=access.can(db,user(db,'manager'),'budgets.use');
  assert.equal(before,true);
  transaction(db,()=>admin.updateAccount(db,first,'manager',{role:'employee'}));
  const demoted=user(db,'manager');
  assert.equal(demoted.role,'employee');
  assert.equal(access.assignedLevel(db,demoted),'employee','أُعيد اشتقاق الصف من الدور الجديد');
  assert.equal(access.can(db,demoted,'budgets.use'),false,'ولا يبقى له ما كان يحمله بمستوى مديره السابق');
  const kept=access.CAPABILITIES.filter(c=>access.can(db,demoted,c.key,null,{levels:true})&&!access.can(db,demoted,c.key,null,{levels:false}));
  assert.deepEqual(kept,[],'لا تصريح يبقى بصفٍّ لا يطابق الدور');
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='access.level_rederived'").get().n,1,'وإعادة الاشتقاق حدثٌ يُقرأ لا صمت');
  assert.equal(verifyAudit(db),true);
  // والترقية كذلك: العودة إلى مدير تعيد المستوى معها.
  transaction(db,()=>admin.updateAccount(db,first,'manager',{role:'manager'}));
  assert.equal(access.assignedLevel(db,user(db,'manager')),'department_manager');
  // وحساب إدارة المنصة بلا مستوى مهما قال الجدول.
  transaction(db,()=>db.prepare("INSERT INTO user_permission_levels(tenant_id,user_id,level,assigned_by,assigned_at) VALUES('36t','admin','department_manager',NULL,'2026-09-22T00:00:00.000Z')").run());
  assert.equal(access.userLevel(db,first),null);
  assert.deepEqual([...access.levelCapabilities(db,first)],[]);
});

test('LEVELS: المالك يعدّل القالب، والمستوى يضيف ولا يسحب، ويتحد مع المنح الفردية',t=>{
  const db=setup(t),first=user(db,'admin');
  // المفتاح يُشغَّل أولًا والمقارنة نظيفة، ثم يغيّر المالك القالب — فما يتغير بعدها تغيّرٌ مقصود.
  enable(db,first);
  const before=access.capabilitiesFor(db,user(db,'employee')).list;
  assert.equal(before.includes('review.manage'),false);
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:true}));
  const after=access.capabilitiesFor(db,user(db,'employee'));
  assert.equal(after.list.includes('review.manage'),true,'ما وُضع في المستوى وصل من هو على المستوى');
  for(const key of before)assert.ok(after.list.includes(key),'المستوى يضيف ولا يسحب: '+key);
  assert.equal(access.can(db,user(db,'employee'),'review.manage'),true);
  assert.equal(access.holds(db,user(db,'employee'),'review.manage'),true,'holds ترى المستوى، فقوائم «من يستطيع» لا تخالف الشاشات');
  // الاتحاد مع منح فردي: الاثنان معًا، ولا يمحو أحدهما الآخر.
  transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'vendors.manage',note:'تسجيل موردي التجربة'}));
  const both=access.capabilitiesFor(db,user(db,'employee')).list;
  assert.ok(both.includes('review.manage')&&both.includes('vendors.manage'));
  // استثناء الإدارة يحجب عن إدارتها وحدها: «employee» و«outsider» في creative، و«hr» خارجها.
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'influencers.manage',included:true}));
  assert.equal(access.can(db,user(db,'hr'),'influencers.manage'),true);
  transaction(db,()=>levels.setException(db,first,
    {department_id:'creative',level:'employee',capability:'influencers.manage',mode:'remove',basis:'الحملات المدفوعة خارج نطاق الفريق الإبداعي التجريبي'}));
  assert.equal(access.can(db,user(db,'employee'),'influencers.manage'),false,'الحجب أصاب إدارته');
  assert.equal(access.can(db,user(db,'hr'),'influencers.manage'),true,'ولم يصب غيرها');
});

test('LEVELS: ما يصل بالمستوى يصل محصورًا بإدارة صاحبه حين يكون التصريح مما يقبل الحصر',t=>{
  const db=setup(t),first=user(db,'admin');
  enable(db,first);
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'commercial.use',included:true}));
  const employee=user(db,'employee');
  assert.equal(employee.department_id,'creative');
  assert.equal(access.can(db,employee,'commercial.use','creative'),true);
  assert.equal(access.can(db,employee,'commercial.use','hr'),false,'المستوى مستوى في إدارة، فلا يمد حامله إلى إدارة أخرى');
  assert.deepEqual(access.capabilitiesFor(db,employee).scopes['commercial.use'],['creative']);
});

test('LEVELS: كل تغيير يترك حدثًا في سلسلة التدقيق، والسلسلة تبقى سليمة',t=>{
  const db=setup(t),first=user(db,'admin');
  const count=action=>db.prepare('SELECT count(*) AS n FROM audit_events WHERE action=?').get(action).n;
  enable(db,first);
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:true}));
  transaction(db,()=>levels.setException(db,first,{department_id:'hr',level:'employee',capability:'review.manage',mode:'remove',basis:'خدمات الموظف لا تدير مسارات المراجعة الإبداعية'}));
  transaction(db,()=>levels.setUserLevel(db,first,{user_id:'employee',level:'department_manager',reason:'قرار المالك'}));
  assert.equal(count('access.levels_switch'),1);
  assert.equal(count('access.level_template'),1);
  assert.equal(count('access.level_exception'),1);
  assert.equal(count('access.level_assigned'),1);
  assert.equal(verifyAudit(db),true,'السلسلة المبصومة سليمة بعد أربعة تغييرات');
  // تغيير المستوى ينهي جلسات صاحبه كما ينهيها سحب منح: التغيير يسري الآن لا عند الدخول التالي.
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='employee'").get().n,0);
});

test('LEVELS: من لا يملك المصفوفة لا يفتحها ولا يعدّلها، والرفض يسمّي الناقص ومالكه',t=>{
  const db=setup(t),employee=user(db,'employee');
  assert.throws(()=>levels.matrix(db,employee),error=>{
    assert.equal(error.code,'not_permitted');
    assert.ok(error.details.refusal.missing[0].owner,'الرفض يسمّي من يملك فتحه');
    assert.ok(error.details.refusal.next,'ويسمّي الخطوة التالية');
    return true;
  });
  assert.throws(()=>transaction(db,()=>levels.setTemplate(db,employee,{level:'employee',capability:'review.manage',included:true})),code('forbidden'));
  assert.throws(()=>transaction(db,()=>levels.setSwitch(db,employee,{enabled:true,basis:'أشغّله بنفسي بلا صلاحية'})),code('forbidden'));
  // «أدمن محدد» يحمل accounts.manage ولا تفتح له المصفوفة — ومدخل القائمة مضبوط على هذا الحارس نفسه.
  db.prepare("UPDATE users SET role='admin',admin_level='scoped' WHERE id='it'").run();
  const scoped=user(db,'it');
  transaction(db,()=>access.grantAccess(db,user(db,'admin'),{user_id:'it',capability:'accounts.manage',note:'أدمن محدد في التجربة'}));
  assert.equal(access.can(db,scoped,'accounts.manage'),true);
  assert.throws(()=>levels.matrix(db,scoped),code('not_permitted'));
  // أدمن الإدارة يفتح المصفوفة ويرى أعضاء إدارته وحدهم، ولا يعدّل القالب ولا الاستثناءات ولا يشغّل المقارنة.
  const boss=departmentAdmin(db),view=levels.matrix(db,boss);
  assert.equal(view.can_edit_template,false);
  assert.equal(view.can_edit_levels,true);
  assert.deepEqual([...new Set(view.users.map(p=>p.department_id))],['creative'],'لا يرى حسابًا خارج إدارته');
  assert.throws(()=>transaction(db,()=>levels.setException(db,boss,{department_id:'creative',level:'employee',capability:'commercial.use',mode:'add',basis:'أكتب استثناء لإدارتي'})),code('forbidden'));
  assert.throws(()=>transaction(db,()=>levels.runShadow(db,boss)),code('forbidden'));
});

test('MATRIX: المقارنة محفوظة لا محسوبة عند كل فتح، ولا تُسمّى أسماؤها لمن لا يبلغ أصحابها',t=>{
  const db=setup(t),first=user(db,'admin'),boss=departmentAdmin(db);
  // فتح الشاشة لا يحسب شيئًا: لم تُشغَّل بعد، فالحكم «لم تُشغَّل» لا رقمٌ مختلَق.
  const fresh=levels.matrix(db,first);
  assert.equal(fresh.shadow.never_run,true);
  assert.equal(fresh.shadow.checks,0);
  assert.equal(db.prepare("SELECT shadow_ran_at FROM permission_level_settings WHERE tenant_id='36t'").get().shadow_ran_at,null,'فتح الشاشة لا يكتب نتيجة');
  // يشغّلها الأدمن الأول بطلب صريح، فتُحفظ بختمها وباسمه.
  const ran=transaction(db,()=>levels.runShadow(db,first));
  assert.equal(ran.clean,true);
  assert.ok(ran.checks>0);
  assert.equal(ran.dirty,false);
  const saved=levels.matrix(db,first).shadow;
  assert.equal(saved.checks,ran.checks,'الشاشة تعرض المحفوظ لا حسابًا جديدًا');
  assert.equal(saved.ran_by,user(db,'admin').name);
  // وأي كتابة بعدها توسمها «لم تعد تصف الحال».
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:true}));
  assert.equal(levels.matrix(db,first).shadow.dirty,true);
  transaction(db,()=>levels.runShadow(db,first));
  const dirtyRun=levels.matrix(db,first).shadow;
  assert.equal(dirtyRun.clean,false);
  assert.ok(dirtyRun.differences.length>0,'الأدمن الأول يقرأ الأسماء');
  // وأدمن الإدارة يقرأ الحكم والأرقام بلا أسماء: الاختلافات تسمّي حسابات الكيان كله وهو لا يبلغ غير إدارته.
  const bossView=levels.matrix(db,boss).shadow;
  assert.equal(bossView.clean,false);
  assert.equal(bossView.names_withheld,true);
  assert.deepEqual(bossView.differences,[]);
});

test('MATRIX: «قرّره» اسمٌ يُقرأ، ومصدر المستوى يُحسب بالمقارنة لا بحقل فارغ',t=>{
  const db=setup(t),first=user(db,'admin');
  transaction(db,()=>levels.setException(db,first,{department_id:'creative',level:'employee',capability:'budgets.use',mode:'remove',basis:'مخصصات المشاريع تُدار مركزيًا في التجربة'}));
  const view=levels.matrix(db,first);
  assert.equal(view.exceptions[0].decided_by,'admin');
  assert.equal(view.exceptions[0].decided_by_name,first.name,'العمود يحمل اسمًا، والأدمن الأول ليس في قائمة users أصلًا');
  assert.equal(view.users.some(p=>p.id==='admin'),false);
  // الحالات الثلاث لمصدر المستوى.
  const row=id=>levels.matrix(db,first).users.find(p=>p.id===id);
  assert.equal(row('employee').level_source,'derived','صفٌّ زرعه الترحيل ويطابق الدور');
  transaction(db,()=>levels.setUserLevel(db,first,{user_id:'employee',level:'department_manager',reason:'قرار المالك'}));
  assert.equal(row('employee').level_source,'assigned','قرّره شخص باسمه');
  // صفٌّ باقٍ من دور سابق (قاعدة رُقِّيت قبل إعادة الاشتقاق): يُقال عنه «باقٍ» لا «مشتق».
  transaction(db,()=>db.prepare("UPDATE user_permission_levels SET assigned_by=NULL WHERE user_id='employee'").run());
  assert.equal(row('employee').level_source,'stale');
  assert.equal(row('employee').derived_level,'employee','وتقول الشاشة ما يشتقه دوره اليوم');
});

test('SWITCH: شرط «صفر اختلاف» بوابةُ التشغيل الأول، فلا يصير الإطفاء بابًا لا رجعة منه',t=>{
  const db=setup(t),first=user(db,'admin');
  // (1) أول تشغيل: مشروط، ويرفض حين لا تنظف.
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:true}));
  assert.throws(()=>transaction(db,()=>levels.setSwitch(db,first,{enabled:true,basis:'أشغّله رغم الفرق'})),code('shadow_not_clean'));
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:false}));
  enable(db,first);
  assert.equal(access.levelsEnabled(db,'36t'),true);
  // (2) إسناد مستوى — وهو غرض الميزة — يجعل المقارنة غير نظيفة بالضرورة.
  transaction(db,()=>levels.setUserLevel(db,first,{user_id:'manager',level:'department_admin',reason:'أدمن الإدارة الإبداعية'}));
  assert.equal(levels.shadowCompare(db,'36t').clean,false);
  // (3) إطفاء لتحقيق، ثم إعادة تشغيل: تجوز، وتُحفظ نتيجة المقارنة في الحدث بدل أن تُقفل الباب.
  transaction(db,()=>levels.setSwitch(db,first,{enabled:false,basis:'إطفاء أثناء تحقيق أمني'}));
  assert.equal(access.levelsEnabled(db,'36t'),false);
  const back=transaction(db,()=>levels.setSwitch(db,first,{enabled:true,basis:'انتهى التحقيق، يعود المفتاح كما كان'}));
  assert.equal(access.levelsEnabled(db,'36t'),true);
  assert.equal(back.shadow_clean,false,'ويُقال إن المقارنة ليست نظيفة بدل أن يُرفض التشغيل');
  const event=db.prepare("SELECT after_json FROM audit_events WHERE action='access.levels_switch' ORDER BY seq DESC LIMIT 1").get();
  assert.equal(JSON.parse(event.after_json).shadow_clean,false,'والحدث يحمل ما كانت عليه لحظة التشغيل');
  assert.equal(verifyAudit(db),true);
});

test('LEVELS: صنف النطاق يقسم المئة قسمةً تامة، والرقم المعروض هو ما يحصره الكود لا ما نتمناه',t=>{
  const s=access.scopeSummary();
  assert.equal(s.department+s.personal+s.company,s.total);
  assert.equal(s.total,access.CAPABILITIES.length);
  for(const c of access.CAPABILITIES)assert.ok(['department','personal','company'].includes(access.scopeClass(c.key)),c.key);
  // «يُحصر بإدارة» صنفٌ يعني أن grantAccess يقبل نطاقًا؛ والمحصور في الكود فعلًا رقمٌ أصغر، ويُقال كما هو.
  assert.equal(s.confined_in_code,access.CONFINED_IN_CODE.length);
  assert.ok(s.confined_in_code<s.department,'ما يقبل النطاق أكثر مما يحصره الكود، والفرق معلن لا مطموس');
  for(const key of access.CONFINED_IN_CODE)assert.equal(access.scopeClass(key),'department',key);
});
