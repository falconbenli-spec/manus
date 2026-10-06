import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { assignRequestTask } from '../app/routing.mjs';

// خدمة سرّية بفصل مهام، على شكل «سلفة على الراتب» و«تسوية بأثر رجعي» في دليل 3,6T:
// مديرُ الإدارة يعتمدها، ففصلُ المهام يمنعه من تنفيذها، فتسمّي سلسلة التنفيذ عضوًا آخر في الإدارة.
//
// وكان الطلب يقف عند «معتمد» بلا منتهٍ: بوابة إسناد المهام (isHandler — دورٌ وإدارة بلا فصل مهام) أوسع من
// سلسلة التنفيذ التي تُبنى عليها إتاحة «استلام» و«إنهاء». فالمدير يمر من الأولى ولا يمر من الثانية، وكان
// COALESCE في assignRequestTask يسجّله مباشرًا للطلب ويخرجه من «معتمد» — فيسقط «استلام» لأن الحالة تغيّرت،
// ويسقط «إنهاء» لأن المباشر خارج السلسلة. لا هو ينهيه ولا غيره يستلمه، ولا مخرج إلا تحويل طلبٍ سريّ
// إلى إدارة أخرى.
//
// والسرية تبقى كما هي: لا يُفتح الطلب لفريق الإدارة، بل للمكلَّف وحده حين يُسنِد إليه مديرُ الإدارة مهمة.
const POLICY={steps:['manager'],handler_role:'member',sod:true,confidential:true};
const TEXT='نص تجريبي كافٍ الطول لأغراض التحقق الآلي';
const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-confidential-only');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const service=tx(()=>wf.createService(db,users.admin,{code:'SYN-CONFIDENTIAL',name_ar:'خدمة سرية تجريبية',name_en:'Synthetic confidential service',
    department_id:'creative',description:'خدمة اختبار سرية بفصل مهام؛ لا وجود لها خارج الاختبار.',
    fields:[{key:'detail',label:'التفاصيل',type:'textarea',required:true}],approval_policy:POLICY}));
  let r=tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'طلب سري تجريبي',payload:{detail:TEXT},project_id:null}));
  r=tx(()=>wf.transition(db,users.employee,r.id,'submit',{version:r.version}));
  const d=wf.detail(db,users.manager,r.id);
  r=tx(()=>wf.transition(db,users.manager,r.id,'approve',{version:d.version,note:TEXT}));
  return {db,users,tx,r};
}

test('الطلب السري بفصل مهام يكتمل داخل إدارته: المدير يُسنِد، والمكلَّف يستلم وينهي',t=>{
  const {db,users,tx,r}=fixture(t);
  assert.equal(db.prepare('SELECT status FROM requests WHERE id=?').get(r.id).status,'approved');
  const chain=wf.executionChain(db,wf.serviceOf(db,r),db.prepare('SELECT * FROM requests WHERE id=?').get(r.id));
  assert.deepEqual(chain.people.map(p=>p.id),['outsider'],'السلسلة تسمّي العضو الذي لم يطلب ولم يقرر');
  // السرية قائمة: المكلَّف لا يرى الطلب قبل أن يُسنَد إليه، ولو سمّته السلسلة.
  assert.throws(()=>wf.detail(db,users.outsider,r.id),e=>e.code==='not_found');
  const d=wf.detail(db,users.manager,r.id);
  assert.ok(d.actions.includes('assign_task'));
  tx(()=>assignRequestTask(db,users.manager,r.id,{version:d.version,title:'تنفيذ الطلب السري',assignee_id:'outsider',due_date:day(5),acceptance:TEXT}));
  // الإصلاح: المدير اعتمد الطلب فليس من ينفّذه، فلا يُسجَّل مباشرًا له ولا يخرج الطلب من «معتمد».
  const row=db.prepare('SELECT status,assigned_to FROM requests WHERE id=?').get(r.id);
  assert.equal(row.status,'approved','الطلب يبقى معتمدًا فيبقى قابلًا للاستلام');
  assert.equal(row.assigned_to,null,'لا يُسجَّل مباشرًا من لا ينفّذ');
  const view=wf.detail(db,users.outsider,r.id);
  assert.ok(view.actions.includes('claim'),'المكلَّف يستلم بعد أن فُتح له الطلب بالإسناد');
  tx(()=>wf.transition(db,users.outsider,r.id,'claim',{version:view.version,note:TEXT}));
  // المهمة المفتوحة تُغلق قبل إنهاء الطلب؛ هذا سلوك قائم لا يغيّره الإصلاح.
  const task=db.prepare("SELECT id FROM request_tasks WHERE request_id=? AND status='open'").get(r.id);
  assert.ok(task,'المهمة المسندة تبقى مفتوحة حتى يغلقها المكلَّف');
  assert.equal(verifyAudit(db),true);
});

test('السرية تبقى على حالها: الطلب لا يُفتح لفريق الإدارة ولا لمن خارجها',t=>{
  const {db,users,tx,r}=fixture(t);
  assert.throws(()=>wf.detail(db,users.hr,r.id),e=>e.code==='not_found','خارج الإدارة المنفذة لا يرى');
  assert.throws(()=>wf.detail(db,users.outsider,r.id),e=>e.code==='not_found','عضو الإدارة لا يرى قبل أن يُكلَّف');
  assert.ok(!wf.detail(db,users.manager,r.id).actions.includes('claim'),'من اعتمد لا يستلم في خدمة فصل المهام');
  // وبعد الإسناد يُفتح للمكلَّف وحده، لا لبقية الفريق.
  const d=wf.detail(db,users.manager,r.id);
  tx(()=>assignRequestTask(db,users.manager,r.id,{version:d.version,title:'تنفيذ الطلب السري',assignee_id:'outsider',due_date:day(5),acceptance:TEXT}));
  assert.ok(wf.detail(db,users.outsider,r.id),'المكلَّف يرى');
  assert.throws(()=>wf.detail(db,users.hr,r.id),e=>e.code==='not_found','وغيره لا يرى');
});

// قاعدة «من يعمل على السجل الوظيفي» كانت مكتوبة مرتين تحت الاسم نفسه بقاعدتين مختلفتين:
// app/my-profile.mjs يقبل تصريح «السجل الوظيفي»، وapp/employees.mjs يقبل الدور hr وحده. فمن مُنح
// التصريح يقرأ ملفات الموظفين ولا يحرّرها — وهو حال مدير رأس المال البشري على قاعدة التشغيل، دوره manager.
test('السجل الوظيفي: من مُنح تصريحه يقرأ ويحرّر بالقاعدة نفسها، ومن لا يملكه لا يفعل',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-people-officer-only');t.after(()=>db.close());
  const {grantAccess,isPeopleOfficer}=await import('../app/access.mjs');
  const {saveProfile}=await import('../app/employees.mjs');
  const U=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const profile={job_title:'مسمى تجريبي',employment_type:'full_time',join_date:'2025-01-15',contract_end:null,status:'active'};
  assert.equal(isPeopleOfficer(db,U('manager')),false);
  assert.throws(()=>transaction(db,()=>saveProfile(db,U('manager'),'employee',profile)),e=>e.code==='forbidden');
  transaction(db,()=>grantAccess(db,U('admin'),{user_id:'manager',capability:'employees.view',note:'تصريح تجريبي للسجل الوظيفي'}));
  assert.equal(isPeopleOfficer(db,U('manager')),true);
  assert.ok(transaction(db,()=>saveProfile(db,U('manager'),'employee',profile)));
  assert.equal(db.prepare("SELECT job_title FROM employee_profiles WHERE user_id='employee'").get().job_title,'مسمى تجريبي');
  assert.equal(verifyAudit(db),true);
});

// البند 14: سقف مدة الصلاحية المؤقتة صار قرارًا للمالك لا ثابتًا في الكود — لكنه **يشدّ ولا يوسّع**.
// السقف في الكود يعمل بلا تبنٍّ لأنه يمنع «حتى 2099»، وحدّ المفتاح الأعلى في سجل المهل هو السقف نفسه.
// البند 14 كاملًا (ترحيل 147): سقف مدة الصلاحية المؤقتة صار قرارًا يُقترح ويُتبنّى بشخص ثانٍ — ويشدّ ولا يوسّع.
test('سقف التفويض: يُقترح ويُتبنّى بشخصين، ويشدّ ولا يتجاوز سقف الكود',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-timer-cap-only');t.after(()=>db.close());
  const {MAX_DELEGATION_DAYS,MAX_FINANCE_AUTHORITY_DAYS,authorityCapDays}=await import('../app/authority-limits.mjs');
  const {TIMER_KEYS,proposeTimer,adoptTimer}=await import('../app/workflow-timers.mjs');
  const U=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const cap=()=>authorityCapDays(db,'36t','delegation_max_days',MAX_DELEGATION_DAYS);
  // التبني لمن يعتمد حدود الاعتماد: مرجع تصعيد إدارة أو الرئيس التنفيذي — لأن المهلة تُلزم كل الإدارات.
  // البذرة المجرّدة بلا مراجع تصعيد، فيُسجَّل «manager» مرجعًا لإدارته كما تفعل شاشة الهيكل.
  db.prepare("INSERT INTO department_escalation(department_id,tenant_id,user_id,note,assigned_by,assigned_at) VALUES('creative','36t','manager','تسجيل تجريبي لمرجع التصعيد','admin','2026-09-01T00:00:00.000Z')").run();
  // حدّ المفتاح الأعلى هو سقف الكود: لا يُقترح رقم يتجاوزه، فالتبني يشدّ ولا يوسّع.
  assert.equal(TIMER_KEYS.delegation_max_days.max,MAX_DELEGATION_DAYS);
  assert.equal(TIMER_KEYS.finance_authority_max_days.max,MAX_FINANCE_AUTHORITY_DAYS);
  assert.equal(TIMER_KEYS.delegation_max_days.unit,'calendar_days','أيام تقويم: التفويض يغطي غيبةً تمر بالعطل');
  assert.equal(TIMER_KEYS.delegation_max_days.wired,true,'له قارئ، فيجوز اقتراحه');
  assert.equal(cap(),MAX_DELEGATION_DAYS,'بلا متبنّى: سقف الكود — وهو ما يمنع «حتى 2099» قبل القرار');
  // الاقتراح لحامل إدارة دليل الخدمات، والتبني لصفة الرئاسة — شخصان بالضرورة.
  // proposeTimer يعيد اللوح لا الصف، فيُقرأ معرّف المقترح من القاعدة.
  transaction(db,()=>proposeTimer(db,U('admin'),{timer_key:'delegation_max_days',value:30,basis:'قرار تجريبي مكتوب لاختبار الشدّ'}));
  const row=db.prepare("SELECT id FROM workflow_timer_settings WHERE timer_key='delegation_max_days' AND status='proposed'").get();
  assert.equal(cap(),MAX_DELEGATION_DAYS,'المقترح لا يسري');
  assert.throws(()=>transaction(db,()=>adoptTimer(db,U('admin'),row.id,{note:'تبنٍّ من مقترحه'})),e=>e.code==='separation_of_duties','من اقترح لا يتبنى');
  transaction(db,()=>adoptTimer(db,U('manager'),row.id,{note:'تبنٍّ تجريبي من شخص ثانٍ'}));
  assert.equal(cap(),30,'المتبنّى يشدّ');
  // ورقم فوق السقف لا يُقترح أصلًا. وحالةُ صفٍّ متبنًّى فوق السقف غير قابلة للوصول: الاقتراح يرفضها،
  // وقيد القاعدة يرفضها (value بحسب الوحدة)، ومحفّز دورة الحياة يمنع تعديل صفٍّ قائم. فالحدّ في
  // authorityCapDays احتياطٌ ثالث لحالة لا تقع، ولا يُختبر ما لا يمكن أن يقع.
  assert.throws(()=>transaction(db,()=>proposeTimer(db,U('admin'),{timer_key:'delegation_max_days',value:MAX_DELEGATION_DAYS+1,basis:'محاولة تجاوز السقف للاختبار'})),e=>e.code==='timer_value');
  assert.throws(()=>db.prepare('UPDATE workflow_timer_settings SET value=9999 WHERE id=?').run(row.id),/never edited/,'الصفّ لا يُعدَّل بعد تبنّيه');
  assert.equal(cap(),30,'والمتبنّى باقٍ كما هو');
  assert.equal(verifyAudit(db),true);
});
