// بابٌ واحد للإغلاق، وأزمنةٌ تقول من قطعها — 21 سبتمبر 2026.
//
// المسح الكامل للـ142 خدمة رصد عطبين يقفان في الطريق نفسه بين الإدارة وصاحب الطلب:
//   (1) **بابان للإغلاق**: `POST /api/requests/:id/complete` كان يُغلق الطلب بملاحظة من ثلاثة أحرف ولا يكتب سطرًا
//       في `request_closures`، ثم يُرفض على صاحب الطلب أن يعيد فتحه بـ`no_closure_record` — فخٌّ نصبته المنصة على نفسها.
//   (2) **زمنٌ بلا صاحب**: الـ142 كلها أخذت زمنها من `defaultTargetDays` بمطابقة بادئة الرمز، و`service_target_adoptions`
//       فارغ تمامًا، ومع ذلك يُعرض الرقم للموظف عاريًا — «المدة يوما عمل» — فيقرؤه وعدًا قطعته إدارة. لم تقطعه.
//
// كل اختبار هنا يمشي واحدة من الواقعتين بنصها: الإغلاق لا يصير إلا بدليل يُكتب ويُقرأ، والزمن لا يصل إنسانًا
// إلا ومعه من اشتقّه ومن تبنّاه — أو أن أحدًا لم يتبنَّه. البيانات كلها مصطنعة من البذرة التجريبية وعلى قاعدة بالذاكرة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, approvalSettings, decideServiceTarget } from '../app/service-catalog.mjs';
import { closuresOf, closureView, setReopenWindow } from '../app/request-closure.mjs';
import { serviceCard } from '../app/service-cards.mjs';
import { timeline, myTimelineBoard } from '../app/request-timeline.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { homeBoard } from '../app/home.mjs';
import { obligations } from '../app/obligations.mjs';
import { runReport } from '../app/reports.mjs';
import { DERIVED_MARK, targetProvenance } from '../app/service-target.mjs';
import { approvalSettingsUI } from '../app/static/approval-settings-ui.mjs';
import { routePreview } from '../app/static/request-picker.mjs';

const PASSWORD='synthetic-targets-closure';
const code=value=>error=>error.code===value;
const DELIVERED='تجريبي: أُعيد ضبط حساب البريد على الجوال وجُرّب الدخول مع صاحبة الطلب بنجاح';
const BASIS='تجريبي: قرار مدير الإدارة في اجتماعها الأسبوعي 2026-09-21، محضر رقم 4 المحفوظ لدى سكرتارية الإدارة';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uiContext={e,button:(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`};

// الدليل الكامل مثبَّت: الأزمنة الـ142 كلها مكتوبة بـ`defaultTargetDays` باسم مسؤول المنصة، فتُقرأ هنا كما يقرؤها الموظف.
// مديرة الفريق (`manager`) هي مديرة «إدارة الخدمات الإبداعية» بحكم دورها، و`head-it` مديرُ «تقنية المعلومات» بعد التثبيت.
async function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);installServiceCatalog(db);
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['employee','manager','it','admin','head-it']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:PASSWORD})});
    assert.equal(response.status,200,username);
    const body=await response.json();sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.csrf};
  }
  const call=async(who,path,input,expected=200)=>{
    const auth=sessions[who];
    const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json',cookie:auth.cookie,'x-csrf-token':auth.csrf,'Idempotency-Key':randomUUID()},
      ...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();
    assert.equal(response.status,expected,JSON.stringify(body));
    return body;
  };
  const version=id=>db.prepare('SELECT version FROM requests WHERE id=?').get(id).version;
  const service=c=>wf.catalog(db,users.employee).find(s=>s.code===c);
  // طلب دعم تقني مصطنع يمشي إلى «قيد التنفيذ» وبيد منفّذ الدعم، جاهزًا لبابِ الإغلاق.
  const inProgress=async()=>{
    const created=await call('employee','/requests',{service_id:service('IT-SUPPORT').id,title:'تجريبي: تعذر الدخول إلى البريد',
      payload:{issue:'تجريبي: تعذر الدخول إلى البريد من الجوال',impact:'يؤخر العمل'}},201);
    await call('employee',`/requests/${created.id}/submit`,{version:version(created.id)},201);
    await call('manager',`/requests/${created.id}/approve`,{version:version(created.id),note:'تجريبي: موافقة المديرة'},201);
    await call('it',`/requests/${created.id}/claim`,{version:version(created.id)},201);
    return created.id;
  };
  return {db,users,tx,call,version,service,inProgress};
}

// ── (1) بابٌ واحد: لا إغلاق بلا دليل، ولا إغلاق بلا سجل ───────────────────────
test('الإغلاق: الباب العام يرفض الإغلاق بلا وصفِ ما سُلِّم، ويسمّي الناقص بحد أدنى مقروء',async t=>{
  const {db,call,version,inProgress}=await fixture(t);
  const id=await inProgress();
  // «تم الحل» كانت تكفي لإغلاق الطلب من هذا الباب نفسه. لم تعد: الوصف هو ما سيقرؤه صاحب الطلب وما سيُحتج به بعد شهر.
  const refused=await call('it',`/requests/${id}/complete`,{version:version(id),note:'تم الحل'},400);
  assert.equal(refused.error.code,'invalid_text');
  assert.match(refused.error.message,/وصف ما سُلِّم فعلًا/,'الرفض يسمّي الحقل الناقص بلفظه لا برمزه');
  assert.match(refused.error.message,/على الأقل/,'ويقول كم ينقصه');
  assert.equal(db.prepare('SELECT status FROM requests WHERE id=?').get(id).status,'in_progress','الرفض لا يترك أثرًا');
  assert.equal(closuresOf(db,id).length,0);

  const closed=await call('it',`/requests/${id}/complete`,{version:version(id),delivered:DELIVERED},201);
  assert.equal(closed.status,'completed');
  const closures=closuresOf(db,id);
  assert.equal(closures.length,1,'كل إغلاق يكتب سجلًا، بلا استثناء');
  assert.equal(closures[0].delivered,DELIVERED);
  assert.equal(closures[0].closed_by,'it');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE request_id=? AND user_id='employee' AND kind='execution_completed'").get(id),'ولا إغلاق صامت');
  // لا طلب واحد في القاعدة صار «مكتملًا» بلا سجل إغلاق: هذا هو الباب الواحد مقيسًا لا موصوفًا.
  const orphans=db.prepare("SELECT COUNT(*) AS n FROM requests r WHERE r.status='completed' AND NOT EXISTS(SELECT 1 FROM request_closures c WHERE c.request_id=r.id)").get().n;
  assert.equal(orphans,0);
  assert.ok(verifyAudit(db));
});

test('الإغلاق: الطلب المغلق بدليل يُعاد فتحه ضمن مهلته، والجولة الثانية مرتبطة بإغلاقها الأول',async t=>{
  const {db,users,tx,call,version,inProgress}=await fixture(t);
  const id=await inProgress();
  await call('it',`/requests/${id}/complete`,{version:version(id),delivered:DELIVERED},201);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
  tx(()=>setReopenWindow(db,users.admin,{scope_code:'*',window_days:5,basis:'تجريبي: قرار مالك الإجراء على مهلة إعادة الفتح العامة',confirmed_on:today}));
  const before=closureView(db,users.employee,id);
  assert.equal(before.reopen.available,true,'الإغلاق بدليل يفتح باب إعادة الفتح بدل أن يسدّه');
  assert.equal(before.reopen.refusal,null);

  const reopened=await call('employee',`/request-closure/${id}/reopen`,{version:version(id),reason:'تجريبي: عاد تعذر الدخول بعد يومين من الإغلاق'},201);
  assert.equal(reopened.request.status,'in_progress');
  assert.equal(reopened.closures.length,1,'الإغلاق الأول يبقى كما هو');
  assert.equal(reopened.reopenings[0].closure_id,reopened.closures[0].id);
  assert.equal(reopened.first_time_right,false,'وجولة ثانية ليست إنجازًا من أول مرة');
  assert.ok(verifyAudit(db));
});

test('الإغلاق: الطلب القديم الذي أُغلق قبل الباب الواحد يشرح نفسه — رفضٌ يسمّي الناقص ومالكه والخطوة التالية',async t=>{
  const {db,users,tx,call,version,inProgress}=await fixture(t);
  const id=await inProgress();
  // تاريخٌ لا يُردَم: هذا الطلب يُغلق بالانتقال المباشر كما كان الباب العام يفعل قبل 21 سبتمبر — ولا تُخترع له أدلة
  // تسليم لم يكتبها أحد. المطلوب أن يشرح الطلبُ نفسَه لصاحبه، لا أن يقف أمامه بجملة واحدة مسدودة.
  tx(()=>wf.transition(db,users.it,id,'complete',{version:version(id),note:'تم'.padEnd(3,'.')}));
  assert.equal(closuresOf(db,id).length,0,'الباب القديم لم يكن يكتب سجلًا — وهذه هي الحالة التاريخية بعينها');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
  tx(()=>setReopenWindow(db,users.admin,{scope_code:'*',window_days:5,basis:'تجريبي: قرار مالك الإجراء على مهلة إعادة الفتح العامة',confirmed_on:today}));

  const refused=await call('employee',`/request-closure/${id}/reopen`,{version:version(id),reason:'تجريبي: ما زال الدخول متعذرًا من الجوال'},409);
  assert.equal(refused.error.code,'no_closure_record');
  const refusal=refused.error.details.refusal;
  assert.match(refusal.what,/سجل إغلاق/,'يقول ما الذي رُفض');
  assert.equal(refusal.missing.length,1);
  assert.ok(refusal.missing[0].document&&refusal.missing[0].why,'ويسمّي الناقص وسببه');
  assert.equal(refusal.missing[0].owner,users.it.name,'ومالكه شخصٌ يُسأل بالاسم، لا «الجهة المختصة»');
  assert.ok(refusal.next.length>20,'وخطوةً تالية يقدر عليها صاحب الطلب');
  // الشاشة تقرأ الشكل نفسه، فلا تُعاد صياغة الرفض في الواجهة.
  const view=closureView(db,users.employee,id);
  assert.deepEqual(view.reopen.refusal,refusal);
  assert.match(view.reopen.why,new RegExp(refusal.missing[0].document));
  assert.ok(verifyAudit(db));
});

// ── (2) الزمن المستهدف يقول من قطعه ───────────────────────────────────────────
test('الزمن: ما لم يتبنَّه أحد يُوسَم «مشتق من عائلة رمز الخدمة» في كل موضع يصل فيه إلى إنسان',async t=>{
  const {db,users,call,version,service,inProgress}=await fixture(t);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_target_adoptions').get().n,0,'الدليل كما يُسلَّم: لا تبنٍّ واحدًا');
  const target=targetProvenance(db,'36t','IT-SUPPORT');
  assert.equal(target.kind,'derived');assert.equal(target.adopted,false);
  assert.equal(target.days,target.derived_days,'الرقم هو ما تشتقه البادئة بعينه');

  const id=await inProgress();
  // كل موضع يصل فيه الرقم إلى إنسان يأخذ عبارته من المصدر الواحد. لا يُستثنى موضع «لأنه صغير».
  const card=await call('employee','/service-cards/IT-SUPPORT/view',{},201);
  const catalogue=(await call('employee','/catalog')).find(s=>s.code==='IT-SUPPORT');
  const mine=(await call('employee','/my-requests')).items.find(i=>i.id===id);
  const story=timeline(db,users.employee,id);
  const board=myTimelineBoard(db,users.employee).rows.find(r=>r.id===id);
  const home=JSON.stringify(homeBoard(db,users.employee));
  // «ما عليّ» يُقرأ من مصدره: obligations هو ما تبنيه الرئيسية والصندوق ومساحة العمل جميعًا.
  const duty=obligations(db,users.it).items.find(i=>i.id===id);
  const report=runReport(db,users['head-it'],'R07',{from:'2026-01-01',to:'2026-12-31'});
  const screen=approvalSettingsUI.render(approvalSettings(db,users.manager),uiContext);
  // «سيمر طلبك على… خلال كذا» أقرب جملة إلى الوعد في المنصة كلها: تُقال قبل الضغط على «تقديم».
  const preview=routePreview(catalogue,await call('employee','/departments'));
  const surfaces=[
    ['بطاقة الخدمة',card.service.target.label],
    ['دليل الخدمات',catalogue.target.label],
    ['«طلباتي»',mine.due_note],
    ['التاريخ المتوقع في الخط الزمني',story.next_step.expectation_note],
    ['لوحة «أين طلباتي»',board.expectation_note],
    ['الرئيسية',home],
    ['صندوق «ما عليّ»',duty.due_basis_name],
    ['تقرير أداء الخدمات',report.notes.join(' ')],
    ['شاشة إعداد الاعتماد',screen],
    ['معاينة المسار قبل التقديم',preview]
  ];
  for(const [where,text] of surfaces)
    assert.ok(String(text).includes(DERIVED_MARK),`${where}: الرقم يصل بلا مصدره — «${String(text).slice(0,120)}»`);
  // ولا موضع يقدّم الرقم وعدًا: العبارة نفسها تنفي أن يكون أحدٌ قطعه.
  assert.match(card.service.target.label,/ليس وعدًا قطعه أحد/);
  assert.match(mine.due_note,/ليس وعدًا قطعه أحد/);
  // ومسار الخدمة معروض على البطاقة نفسها: من يعتمدها، ومن ينفّذها، وهل يكونان شخصًا واحدًا.
  assert.ok(card.service.workflow.approves.length);
  assert.ok(card.service.workflow.executes);
  assert.ok(card.service.workflow.execution_basis.includes('مرجع تصعيد الإدارة'));
  assert.equal(card.service.workflow.same_person_allowed,!card.service.workflow.separation_of_duties);
  const detail=await call('employee',`/requests/${id}`);
  assert.ok(detail.workflow.same_person_note.length>40,'وشاشة الطلب تقول الجواب نصًّا لا رمزًا');
  assert.equal(typeof detail.workflow.decider_is_executor,'boolean');
  assert.equal(version(id),detail.version);
  assert.equal(service('IT-SUPPORT').code,'IT-SUPPORT');
});

test('الزمن: تبنّي مدير الإدارة يكتب قرارًا في service_target_adoptions ويقلب الوسم من «مشتق» إلى التزام باسمه',async t=>{
  const {db,users,tx,call}=await fixture(t);
  const before=approvalSettings(db,users.manager);
  assert.equal(before.my_department.id,'creative','مديرة الفريق تدخل الشاشة لبابٍ واحد: أزمنة خدمات إدارتها');
  const row=before.my_service_targets.find(s=>s.code==='CREATIVE-BRIEF');
  assert.equal(row.target.kind,'derived');
  assert.deepEqual(row.actions,['adopt_service_target']);
  assert.match(approvalSettingsUI.render(before,uiContext),/أزمنة خدمات/);

  const decided=tx(()=>decideServiceTarget(db,users.manager,'CREATIVE-BRIEF',{decision:'adopt',basis:BASIS}));
  assert.deepEqual(decided,{code:'CREATIVE-BRIEF',decision:'adopted'});
  const adoption=db.prepare("SELECT * FROM service_target_adoptions WHERE service_code='CREATIVE-BRIEF'").get();
  assert.ok(adoption,'القرار مكتوب في سجله الإلحاقي');
  assert.equal(adoption.decision,'adopted');assert.equal(adoption.decided_by,'manager');assert.equal(adoption.basis,BASIS);
  assert.equal(adoption.target_days,row.target.days,'وبالقيمة التي تبنّاها بعينها');

  const after=targetProvenance(db,'36t','CREATIVE-BRIEF');
  assert.equal(after.kind,'adopted');assert.equal(after.adopted,true);
  assert.equal(after.days,row.target.days,'التبني لا يغيّر الرقم، بل يعطيه صاحبًا');
  assert.equal(after.adopted_by_name,users.manager.name);
  assert.ok(!after.label.includes(DERIVED_MARK),'ولم يعد يُقال عنه إنه مشتق لم يتبنَّه أحد');
  assert.match(after.label,new RegExp(users.manager.name),'بل يُنسب الوعد إلى قائله بالاسم');
  const card=await call('employee','/service-cards/CREATIVE-BRIEF/view',{},201);
  assert.equal(card.service.target.label,after.label,'والبطاقة تقرأ المصدر نفسه');
  const reopened=approvalSettings(db,users.manager).my_service_targets.find(s=>s.code==='CREATIVE-BRIEF');
  assert.deepEqual(reopened.actions,['withdraw_service_target'],'وللقرار رجوعٌ مسجَّل، لا محو');
  assert.ok(verifyAudit(db));
});

test('الزمن: مدير الإدارة لا يتبنّى زمن خدمة إدارة أخرى، والرفض يسمّي الإدارة المالكة',async t=>{
  const {db,users,tx}=await fixture(t);
  assert.equal(db.prepare("SELECT department_id FROM services WHERE code='IT-SUPPORT' AND tenant_id='36t' ORDER BY version DESC LIMIT 1").get().department_id,'it');
  let caught=null;
  try{tx(()=>decideServiceTarget(db,users.manager,'IT-SUPPORT',{decision:'adopt',basis:BASIS}));}catch(error){caught=error;}
  assert.ok(caught&&code('not_permitted')(caught),'زمن خدمة إدارة أخرى ليس التزامًا تقطعه عنها');
  const refusal=caught.details.refusal;
  assert.match(refusal.what,/تقنية المعلومات/,'الرفض يسمّي الإدارة المالكة');
  assert.equal(refusal.missing[0].owner_role,'department_manager');
  assert.ok(refusal.next.includes('مدير الإدارة المالكة'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_target_adoptions').get().n,0,'ولا يُكتب شيء');
  // وما يملكه كل مدير محصورٌ بإدارته: قائمة «أزمنة خدماتي» لا تحمل خدمة من إدارة أخرى.
  const forManager=approvalSettings(db,users.manager).my_service_targets.map(s=>s.code);
  assert.ok(forManager.includes('CREATIVE-BRIEF'));
  assert.ok(!forManager.includes('IT-SUPPORT'));
  const forHeadIt=approvalSettings(db,users['head-it']);
  assert.equal(forHeadIt.my_department.id,'it');
  assert.ok(forHeadIt.my_service_targets.some(s=>s.code==='IT-SUPPORT'));
  assert.ok(!forHeadIt.my_service_targets.some(s=>s.code==='CREATIVE-BRIEF'));
  // ومن سجّل الرقم في الدليل لا يتبنّاه: التبني قرار شخص ثانٍ، ومسؤول المنصة هو من كتب الأزمنة الـ142.
  let selfAdopt=null;
  try{tx(()=>decideServiceTarget(db,users.admin,'CREATIVE-BRIEF',{decision:'adopt',basis:BASIS}));}catch(error){selfAdopt=error;}
  assert.ok(selfAdopt,'مسؤول المنصة لا يتبنّى زمنًا كتبه بنفسه');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_target_adoptions').get().n,0);
  assert.ok(verifyAudit(db));
});
