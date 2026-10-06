// عشرة عطوب قاسها فريق مستقل على fix/services-workflow عند ccccda13، لكل واحد اختبار يمشيه بنصه.
// كل اختبار هنا كان يخفق قبل إصلاحه: ليس وصفًا لما صار، بل الحالة التي أثبتت الخلل.
//   1  صاحب الطلب من داخل الإدارة المنفذة يترك أربع خدمات مال ومشتريات عند no_executor
//   2  فحص الكتالوج أعمى عن خطوة «مديرك»، فمرّت خمس خدمات إبداعية نفّذها من قرر فيها
//   3  النائب كان أي حساب في أي إدارة أخرى، فوُضع أمر صرف في يد إدارة الحسابات
//   4  فصل المهام شُحن مُطفأً على الاثنتين والعشرين كلها، فاستلم المعتمِد طلبه بـ201
//   5  مدير الإدارة كان يقرأ لوح الاعتماد كله لا إدارته
//   6  الطلب السري كان يصل مرجع تصعيد الإدارة فيراه ويُشعَر به
//   7  النائب كان يقبل تسمية نفسه، فيكون هو الشخص الثاني
//   8  فصل المهام في إدارة بحساب واحد كان يقف عند no_executor بلا درجة أعلى
//   9  escalationApprover لم يكن يستثني حساب إدارة المنصة
//  10  زر «قبول التسمية» كان لمن يدير الهيكل وحده، والخادم يقبله من النائب نفسه
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, catalogHealth, approvalSettings, separationOfDutiesState,
  proposalImpact, policyProposals, SOD_SERVICES, fieldModel } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';

const code=value=>error=>error.code===value;
const BASIS='قرار الرئاسة رقم 14 بتاريخ 2026-09-21 بتسمية نائب منفّذ، محضر تجريبي';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-services-workflow');t.after(()=>db.close());
  installServiceCatalog(db);
  const tx=f=>transaction(db,f);
  const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=c=>wf.catalog(db,user('admin')).find(s=>s.code===c);
  // موظف داخل الإدارة المنفذة يتبع مديرها: هذا ما لم يمشِه المسح قط، وهو ما كشف العطب الأول.
  const insider=(id,department,boss)=>{
    db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,active) VALUES(?,'36t',?,?,?,'x','employee',?,1)")
      .run(id,department,id,`موظف تجريبي في ${department}`,boss);
    return user(id);
  };
  // القيم مولَّدة من تعريف الحقول نفسه، كما يولّدها المسح، فلا يُكتب نموذج بعينه هنا ويشيخ مع الخدمة.
  const create=(c,who='employee')=>{const definition=service(c);
    return tx(()=>wf.createRequest(db,user(who),{service_id:definition.id,
      title:`طلب تجريبي — ${definition.name_ar}`,payload:payloadForStored(definition.fields,fieldModel(c))}));};
  const move=(who,r,action,note='دليل اختبار مصطنع')=>tx(()=>wf.transition(db,user(who),r.id,action,{version:wf.getRequest(db,user(who),r.id).version,note}));
  // صف الطلب كما هو في القاعدة: هذه الاختبارات تفحص السلسلة لا الرؤية، فلا تمر بحارس getRequest.
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  // يمشي مسار الاعتماد بحساب كل معتمد كما يحلّه المحرك، ويُرجع آخر حال أو الخطأ الذي أوقفه.
  const approveAll=r=>{
    let guard=0;
    while(r.status==='pending'&&guard++<8){
      const step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
      if(!step)break;
      r=move(step.approver_id,r,'approve');
    }
    return r;
  };
  return {db,tx,user,service,insider,create,move,approveAll,row};
}

// ── (1) صاحب الطلب من داخل الإدارة المنفذة ─────────────────────────────────────
// قبل الإصلاح: تُصعَّد الخطوة المكررة إلى مرجع تصعيد الإدارة، فيصير المرجع معتمِدًا، فتسقط الحلقة الثالثة
// كلها ويُرفض الاعتماد بـ409 no_executor في FIN-PAYMENT-REQUEST وFIN-REFUND وFIN-CUSTODY وPRC-PURCHASE-REQUEST.
test('العطب 1: طلبٌ من داخل الإدارة المنفذة يجد منفّذًا في سُلَّم التصعيد، ولا يقف عند «لا منفذ»',t=>{
  const {db,service,insider,create,move,approveAll,row}=fixture(t);
  insider('qa-finance','finance','head-finance');
  insider('qa-procurement','procurement','head-procurement');
  const cases=[['FIN-PAYMENT-REQUEST','qa-finance'],['FIN-REFUND','qa-finance'],['FIN-CUSTODY','qa-finance'],['PRC-PURCHASE-REQUEST','qa-procurement']];
  for(const [serviceCode,requester] of cases){
    const definition=service(serviceCode);
    let r=create(serviceCode,requester);
    r=approveAll(move(requester,r,'submit'));
    assert.equal(r.status,'approved',`${serviceCode}: بلغ «معتمد» ولم يقف عند no_executor`);
    const chain=wf.executionChain(db,definition,row(r.id));
    assert.notEqual(chain.basis,'none',`${serviceCode}: للطلب منفّذ`);
    assert.ok(chain.people.length,`${serviceCode}: والمنفّذ إنسان مسمّى`);
    // والمنفّذ ليس صاحب الطلب ولا من قرر فيه خطوة.
    const deciders=db.prepare("SELECT decided_by FROM approval_steps WHERE request_id=? AND revision=? AND status='approved'").all(r.id,r.revision).map(x=>x.decided_by);
    for(const person of chain.people){
      assert.notEqual(person.id,requester,`${serviceCode}: صاحب الطلب لا ينفّذه`);
      assert.ok(!deciders.includes(person.id),`${serviceCode}: ومن قرر لا ينفّذ`);
    }
  }
});

test('العطب 1: سُلَّم التصعيد درجاتٌ مسجّلة لا أشخاص جدد، ويقول لمن وصله لماذا وصله',t=>{
  const {db}=fixture(t);
  const ladder=wf.escalationLadder(db,'36t','finance');
  assert.deepEqual(ladder.map(p=>p.id),['vp-corporate','ceo'],'مرجع الإدارة ثم مرجع إدارته');
  // كل درجة حساب نشط مسجّل في department_escalation أو رئاسة الشركة، لا اسم يخترعه المحرك.
  for(const person of ladder)assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(person.id).active,1,person.id);
  assert.equal(new Set(ladder.map(p=>p.id)).size,ladder.length,'ولا تتكرر درجة');
});

// ── (2) الفحص الأعمى عن خطوة «مديرك» ──────────────────────────────────────────
// قبل الإصلاح: `if(step.role==='manager')return` يتخطى الخطوة، فخمس خدمات إبداعية مسارها «مديرك» وحدها
// كان يعتمدها مديرُ الإدارة ثم ينفّذها، والفحص لا يرفع لها ملاحظة واحدة.
test('العطب 2: فحص الكتالوج يرى الجمع في خدمات مسارها «مديرك» وحدها',t=>{
  const {db}=fixture(t);
  const health=catalogHealth(db,'36t');
  const flagged=new Set(health.issues.filter(i=>i.kind==='decider_is_executor').map(i=>i.code));
  for(const serviceCode of ['CREATIVE-BRIEF','CRT-CONTENT','CRT-DESIGN','CRT-REVISION','CRT-TRANSLATION'])
    assert.ok(flagged.has(serviceCode),`${serviceCode}: الجمع فيها واقع، فيُقال`);
  // وتُقال بسببها: من يعتمدها بصفته مدير صاحب الطلب هو من ينفّذها.
  const design=health.issues.find(i=>i.code==='CRT-DESIGN'&&i.kind==='decider_is_executor');
  assert.equal(design.via_manager_step,true);
  assert.match(design.message,/مديرَ صاحب الطلب/);
  assert.ok(design.deciders.length,'وباسم من يجمعهما');
});

// ── (3) مجال النائب ───────────────────────────────────────────────────────────
// قبل الإصلاح: الشرط الوحيد «إدارة أخرى»، فمضت تسمية مدير إدارة الحسابات (قطاع النمو) نائبًا منفّذًا
// لأمر مناقلة مالية (قطاع الخدمات المؤسسية)، ومشى بها القياس فعلًا.
test('العطب 3: النائب من قطاع الإدارة المنفذة وبدور ينفّذ الخدمة، لا أي حساب في أي إدارة',t=>{
  const {db,tx,user}=fixture(t);
  let refusal=null;
  assert.throws(()=>tx(()=>wf.proposeExecutionDeputy(db,user('admin'),
    {service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'head-accounts',basis:BASIS})),
    error=>{refusal=error.details?.refusal;return error.code==='deputy_out_of_sector';},
    'إدارة الحسابات من قطاع النمو، والمالية من الخدمات المؤسسية');
  assert.match(refusal.what,/إدارة الحسابات/);
  assert.equal(refusal.missing[0].owner_role,'structure.manage');
  assert.match(refusal.missing[0].document,/المالية/);
  assert.ok(refusal.next,'والرفض يقول ما الخطوة التالية');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM execution_deputies WHERE service_code='FIN-BUDGET-TRANSFER'").get().n,0,'ولم يُكتب شيء');
  // والدور يُفحص أيضًا: خدمة منفّذها مديرُ إدارة لا ينوب عنها موظف ليس مديرًا ولا يحمل دور منفّذها.
  assert.throws(()=>tx(()=>wf.proposeExecutionDeputy(db,user('admin'),
    {service_code:'ACC-RENEWAL',rank:1,user_id:'employee',basis:BASIS})),code('deputy_role'));
  // ومن القطاع نفسه وبدور ينفّذ: تمضي التسمية.
  const row=tx(()=>wf.proposeExecutionDeputy(db,user('admin'),{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:BASIS}));
  assert.equal(row.status,'proposed');
  // والإدارات المؤهَّلة تُقرأ من الهيكل لا تُخمَّن.
  const eligible=wf.deputyEligibleDepartments(db,'36t','finance').map(d=>d.id);
  assert.ok(eligible.includes('it')&&eligible.includes('hr'),'إدارات القطاع نفسه');
  assert.ok(!eligible.includes('accounts')&&!eligible.includes('finance'),'لا قطاع آخر ولا الإدارة نفسها');
});

// ── (4) فصل المهام يصل مُشغَّلًا ───────────────────────────────────────────────
// قبل الإصلاح: الاثنتان والعشرون تصل sod:false، فيستلم المعتمِد طلبَه ويغلقه ويردّ الخادم 201.
test('العطب 4: المعتمِد لا يستلم طلبه في الخدمات الحسّاسة الاثنتين والعشرين كما تُسلَّم المنصة',t=>{
  const {db,tx,user,service,create,move,approveAll}=fixture(t);
  assert.deepEqual(separationOfDutiesState(db,'36t').off,[],'لا خدمة حسّاسة وصلت والضابط مُطفأ عليها');
  for(const serviceCode of SOD_SERVICES)
    assert.equal(service(serviceCode).approval_policy.sod,true,serviceCode);
  // خذ الأقسى دلالةً: أمر دفع. المعتمِد نفسه يحاول الاستلام.
  let r=create('FIN-PAYMENT-REQUEST');
  r=approveAll(move('employee',r,'submit'));
  assert.equal(r.status,'approved');
  const decider=db.prepare("SELECT decided_by FROM approval_steps WHERE request_id=? AND revision=? AND status='approved' ORDER BY position DESC LIMIT 1").get(r.id,r.revision).decided_by;
  assert.throws(()=>tx(()=>wf.transition(db,user(decider),r.id,'claim',{version:wf.getRequest(db,user(decider),r.id).version})),
    error=>error.status===403||error.status===409,'من اعتمد لا يستلم ما اعتمد');
  // وفحص الكتالوج لا يعدّ خدمة حسّاسة واحدة في «من يقرر ينفّذ».
  assert.equal(catalogHealth(db,'36t').decider_is_executor.sensitive,0);
});

// ── (5) قراءة مدير الإدارة بقدر بابه ──────────────────────────────────────────
// قبل الإصلاح: يُرسَل إليه كل الحدود وكل البدلاء وكل النواب وكل المقترحات وفحص الشركة بخدماتها كلها.
test('العطب 5: مدير الإدارة يقرأ أزمنة إدارته وفحصها، لا لوح اعتماد الشركة كله',t=>{
  const {db,tx,user}=fixture(t);
  // حدٌّ مسجَّل وبديلٌ معيَّن ونائبٌ مسمّى: أشياء قائمة في الكيان لا يملك مدير الإدارة قراءتها.
  tx(()=>wf.proposeThreshold(db,user('admin'),{setting_key:'fin.payment.finance_review',amount_minor:500000,basis:BASIS,effective_from:'2026-01-01'}));
  tx(()=>wf.setApprovalFallback(db,user('admin'),{department_id:'finance',step_role:'department_manager',fallback_user_id:'head-grc',note:'بديل تجريبي'}));
  tx(()=>wf.proposeExecutionDeputy(db,user('admin'),{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:BASIS}));
  const mine=approvalSettings(db,user('head-creative')??user('manager'));
  assert.equal(mine.scope,'department','الشاشة تقول بأي مدى فُتحت');
  assert.deepEqual(mine.thresholds,[],'لا حدود الشركة');
  assert.deepEqual(mine.keys,[]);
  assert.deepEqual(mine.fallbacks,[],'ولا بدلاؤها');
  assert.deepEqual(mine.proposals,[],'ولا مقترحات سياستها');
  assert.deepEqual(mine.targets_for_review,[]);
  assert.deepEqual(mine.people,[],'ولا دليل موظفيها');
  assert.equal(mine.can_propose,false);assert.equal(mine.can_assign_fallback,false);assert.equal(mine.can_decide,false);
  // وما يصله: إدارته وحدها، وفحصها وحده.
  assert.equal(mine.my_department.id,'creative');
  assert.ok(mine.my_service_targets.length,'وأزمنة خدماته');
  assert.equal(mine.health.scope,'department');
  assert.equal(mine.health.department_id,'creative');
  assert.ok(mine.health.issues.every(i=>i.department_id==='creative'),'ولا ملاحظة عن إدارة ليست إدارته');
  const all=catalogHealth(db,'36t');
  assert.ok(mine.health.services_checked<all.services_checked,'وعددُ خدمات إدارته لا عدد الشركة');
  assert.ok(mine.deputies.every(d=>d.service_department_id==='creative'||d.deputy_department_id==='creative'),'ولا نواب خدمات غيره');
  // والمسؤول يبقى يقرأ اللوح كله.
  const wide=approvalSettings(db,user('admin'));
  assert.equal(wide.scope,'tenant');
  assert.ok(wide.thresholds.length&&wide.proposals.length&&wide.deputies.length);
});

// ── (6) الطلب السري لا تتسع دائرته بعلاقة عامة ─────────────────────────────────
// قبل الإصلاح: تظلّمٌ أو بلاغ مخالفة لا يجد منفّذًا في إدارته فيصل مرجعَ تصعيدها، فيراه ويُشعَر به،
// وهو لم يُسمَّ لهذه الخدمة قط. وvisible كانت تُقدّم deputyExecutor على فحص السرية كله.
test('العطب 6: الطلب السري لا يصل مرجع تصعيد الإدارة، ويُقال ذلك رفضًا مكتوبًا',t=>{
  const {db,tx,user,service,create,move,row}=fixture(t);
  let r=create('HR-GRIEVANCE');
  r=move('employee',r,'submit');
  let guard=0;
  while(r.status==='pending'&&guard++<6){
    const step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
    if(!step)break;
    r=move(step.approver_id,r,'approve');
  }
  const definition=service('HR-GRIEVANCE');
  assert.equal(definition.approval_policy.confidential,true,'الخدمة سرية');
  assert.equal(definition.approval_policy.closed_circle,true,'ودائرتها مغلقة: بلاغٌ عن شخص');
  // اقطع منفّذي الإدارة كلهم، فالسلسلة لا تجد أحدًا: ومع ذلك لا تنزل إلى مرجع التصعيد.
  db.prepare("UPDATE users SET active=0 WHERE department_id='hr' AND id<>'admin'").run();
  const chain=wf.executionChain(db,definition,row(r.id));
  assert.equal(chain.basis,'none','لا سُلَّم تصعيد لخدمة سرية');
  assert.match(chain.refusal.missing[0].why,/بلاغٌ سري عن شخص/,'ويُقال السبب لا يُخفى');
  assert.match(chain.refusal.missing[0].document,/HR-GRIEVANCE/);
  const above=wf.escalationApprover(db,'36t','hr');
  assert.ok(above,'ومرجع التصعيد قائم في البيانات');
  assert.throws(()=>wf.getRequest(db,user(above.id),r.id),code('not_found'),'ومع ذلك لا يرى الطلب');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND request_id=?').get(above.id,r.id).n,0,'ولا يصله إشعار');
  // والنائب المسمّى لهذه الخدمة بعينها يبقى طريقًا: تسميةٌ مكتوبة تقول من يقرأ السر بالاسم.
  db.prepare("UPDATE users SET active=1 WHERE department_id='hr' AND id<>'admin'").run();
  tx(()=>wf.proposeExecutionDeputy(db,user('admin'),{service_code:'HR-GRIEVANCE',rank:1,user_id:'head-grc',basis:BASIS}));
  tx(()=>wf.acceptExecutionDeputy(db,user('head-hr'),{service_code:'HR-GRIEVANCE',rank:1,note:'قبِلتُ التسمية بوصفي مدير الإدارة المنفذة التي سيُقرأ سرُّها'}));
  assert.equal(wf.deputiesFor(db,'36t','HR-GRIEVANCE').length,1);
});

// ── (7) القبول لا يمنح القابل شيئًا ───────────────────────────────────────────
// قبل الإصلاح: `if(row.user_id!==u.id&&!can(...))` — النائب نفسه قابلٌ مقبول، فكان الشخص الثاني هو من كسب الحق.
test('العطب 7: النائب لا يقبل تسمية نفسه؛ يقبلها من لا يكسب بها حق تنفيذ',t=>{
  const {db,tx,user}=fixture(t);
  tx(()=>wf.proposeExecutionDeputy(db,user('admin'),{service_code:'FIN-REFUND',rank:1,user_id:'it',basis:BASIS}));
  let refusal=null;
  assert.throws(()=>tx(()=>wf.acceptExecutionDeputy(db,user('it'),{service_code:'FIN-REFUND',rank:1,note:'أقبل تسمية نفسي'})),
    error=>{refusal=error.details?.refusal;return error.code==='deputy_self_accept';});
  assert.match(refusal.what,/بنفسك/);
  assert.match(refusal.missing[0].why,/القبول هو ما يمنح حق التنفيذ/);
  assert.equal(wf.deputiesFor(db,'36t','FIN-REFUND').length,0,'ولم يصر منفّذًا');
  // ولا يقبلها من سمّاه.
  assert.throws(()=>tx(()=>wf.acceptExecutionDeputy(db,user('admin'),{service_code:'FIN-REFUND',rank:1,note:'أقبل ما سمّيتُ'})),code('separation_of_duties'));
  // ويقبلها مدير إدارة النائب: طرفٌ في القرار لا يكسب به تنفيذًا.
  tx(()=>wf.acceptExecutionDeputy(db,user('head-it'),{service_code:'FIN-REFUND',rank:1,note:'قبِلتُ تسمية موظفي نائبًا منفّذًا لهذه الخدمة'}));
  const row=db.prepare("SELECT * FROM execution_deputies WHERE service_code='FIN-REFUND' AND rank=1").get();
  assert.equal(row.status,'accepted');
  assert.equal(row.accepted_by,'head-it');
  assert.notEqual(row.accepted_by,row.user_id,'ومن قبِل ليس من كسب');
});

// ── (8) فصل المهام في إدارة بحساب واحد ────────────────────────────────────────
// قبل الإصلاح: يقف الطلب عند 409 no_executor حتى يُسمَّى نائب. الآن يمضي بدرجةٍ أعلى في السُّلَّم،
// ويبقى الرفض مكتوبًا حين يخلو السُّلَّم كله — لا صمت في الحالتين.
test('العطب 8: إدارة بحساب واحد غير إداري لا تعطّل خدمة حسّاسة، والرفض يبقى حين يخلو السُّلَّم',t=>{
  const {db,tx,user,service,insider,move,approveAll,row}=fixture(t);
  insider('qa-procurement','procurement','head-procurement');
  const definition=service('PRC-PURCHASE-REQUEST');
  assert.equal(definition.approval_policy.sod,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE department_id='procurement' AND active=1 AND role<>'admin' AND role<>'employee'").get().n,1,'حساب واحد غير إداري');
  const payload=Object.fromEntries(definition.fields.map(f=>[f.key,
    f.type==='select'?f.options[0]:f.type==='date'?'2026-12-31':f.type==='number'?'1500.00':'نص تجريبي مولّد آليًا لاختبار هذه الخدمة ولا يحمل بيانات شخص حقيقي']));
  let r=tx(()=>wf.createRequest(db,user('qa-procurement'),{service_id:definition.id,title:'طلب شراء تجريبي',payload}));
  r=approveAll(move('qa-procurement',r,'submit'));
  assert.equal(r.status,'approved','لا تقف الخدمة عند «لا منفذ»');
  assert.equal(wf.executionChain(db,definition,row(r.id)).basis,'escalation');
  // وحين يخلو السُّلَّم كله: رفضٌ مكتوب يسمّي من يُسأل، لا صمت ولا مخالفة.
  db.prepare("UPDATE users SET active=0 WHERE id IN ('vp-corporate','ceo')").run();
  db.prepare("DELETE FROM department_escalation WHERE department_id='procurement'").run();
  const gap=wf.executionChain(db,definition,row(r.id));
  assert.equal(gap.basis,'none');
  assert.match(gap.refusal.next,/نائبًا منفّذًا/);
  assert.equal(gap.refusal.missing[0].owner_role,'structure.manage');
});

// ── (9) حساب إدارة المنصة ليس مرجع تصعيد ─────────────────────────────────────
// قبل الإصلاح: nativeExecutors وdeputiesFor تستثنيان admin، وescalationApprover وحدها لا تستثنيه.
test('العطب 9: حساب إدارة المنصة لا يصير مرجع تصعيد ولا منفّذًا احتياطيًا',t=>{
  const {db}=fixture(t);
  db.prepare("DELETE FROM department_escalation WHERE department_id='finance'").run();
  db.prepare("INSERT INTO department_escalation VALUES('finance','36t','admin','مرجع تصعيد مصطنع للاختبار','admin',?)").run(new Date().toISOString());
  assert.equal(wf.escalationApprover(db,'36t','finance'),null,'حساب المنصة لا يعتمد ولا ينفّذ معاملة أعمال');
  assert.ok(!wf.escalationLadder(db,'36t','finance').some(p=>p.id==='admin'),'ولا يدخل السُّلَّم');
});

// ── (10) الزر لمن يملك الفعل ─────────────────────────────────────────────────
// قبل الإصلاح: الشاشة تعرض «قبول التسمية» لمن يدير الهيكل وحده، والخادم يقبله من النائب نفسه:
// فعلٌ في الخادم لا زرَّ له، وزرٌّ لا يطابق من يملك الفعل.
test('العطب 10: زر قبول التسمية يظهر لمن يقبلها فعلًا، ولا يظهر للنائب ولا لمن سمّاه',t=>{
  const {db,tx,user}=fixture(t);
  tx(()=>wf.proposeExecutionDeputy(db,user('admin'),{service_code:'FIN-REFUND',rank:1,user_id:'it',basis:BASIS}));
  const actions=(who)=>{
    const screen=approvalSettings(db,user(who));
    return screen.deputies.find(d=>d.service_code==='FIN-REFUND'&&d.rank===1)?.actions??[];
  };
  // النائب لا يملك هذه الشاشة أصلًا، فالفعل الذي كان الخادم يقبله منه لم يكن له زرٌّ قط.
  assert.throws(()=>approvalSettings(db,user('it')),code('not_permitted'),'النائب لا يفتح شاشة إعداد الاعتماد');
  assert.deepEqual(actions('admin'),[],'ومن سمّى لا يقبل تسميته');
  assert.deepEqual(actions('head-it'),['accept_deputy'],'ومدير إدارة النائب يملك الفعل، فيملك زره');
  // والزر يطابق الخادم: ما يظهر يمضي، وما لا يظهر يُرفض.
  assert.throws(()=>tx(()=>wf.acceptExecutionDeputy(db,user('it'),{service_code:'FIN-REFUND',rank:1,note:'محاولة قبول من النائب نفسه'})),code('deputy_self_accept'));
  tx(()=>wf.acceptExecutionDeputy(db,user('head-it'),{service_code:'FIN-REFUND',rank:1,note:'قبِلتُ تسمية موظفي نائبًا منفّذًا لهذه الخدمة'}));
  assert.deepEqual(actions('admin'),['withdraw_deputy'],'وبعد القبول يبقى السحب لمن يدير الهيكل');
});

// ── (2-ب) أثر المقترح كان يعمى عن خطوة «مديرك» بالـ`continue` نفسه ─────────────
// حين يكون مديرُ الإدارة مديرَ منفّذها الوحيد الآخر، فتبنّي مسارٍ فيه «مديرك» يجعل كل منفّذي الإدارة
// أصحابَ قرار. قبل الإصلاح لا تحذير: الخطوة متخطّاة، فيقرأ المالكُ أثرًا أضيق مما سيقع.
test('العطب 2: أثر المقترح يحسب خطوة «مديرك» في من سيعتمد بعد التبني',t=>{
  const {db}=fixture(t);
  db.prepare("UPDATE users SET manager_id='head-it' WHERE id='it'").run();
  const impact=proposalImpact(db,'36t',policyProposals.find(p=>p.key==='c1-chain-it-new-account'));
  assert.ok(impact,'للمقترح أثر محسوب');
  const warning=impact.warnings.find(w=>w.kind==='sod_no_executor');
  assert.ok(warning,'ويقول إن التبني يجعل منفّذي الإدارة كلهم أصحاب قرار');
  assert.equal(warning.resolved,true,'ويقول كيف يُغطّى: بسُلَّم تصعيد الإدارة');
  assert.match(warning.message,/سُلَّم تصعيد الإدارة|النائب المسمّى/);
});
