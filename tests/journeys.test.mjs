// الرحلات — طلبٌ أب يولّد أبناء (مركز الخدمات، الدفعة الرابعة) — 23 سبتمبر 2026.
//
// ما يحرسه هذا الملف: الأبناء باسم صاحب الأب لا باسم من اعتمد؛ وما لا يعرفه التعريف يبقى مسودةً بسببٍ مكتوب لا يُخترع؛
// واعتمادٌ ثانٍ لا يولّد ثانية؛ والشرط بشكل show_when يُقيَّم بمُقيِّم الحقول نفسه؛ والابن الموقوف بـ129 يُعلَّم تعذّرًا بسبب
// الإيقاف نفسه؛ والرحلة تكتمل حين يكتمل الأب وكل ابنٍ وُلد لا قبل؛ وصفحة التتبع تقرأ حالة كل ابن من الطلبات.
// والقرار المكتوب في catalog-tree.mjs: لا فرع «سعودي/غير سعودي» — الأب بلا حقل إقامة ولا خدمة إصدار إقامة يتفرّع إليها؛
// فالمحرّك يُختبر على شرطٍ حقيقي بتعريفٍ اصطناعي، لا بتعريفٍ مزيَّف في الكود.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { createRequest, transition } from '../app/workflow.mjs';
import { setAvailability } from '../app/service-availability.mjs';
import { JOURNEYS, JOURNEYS_LATER, JOURNEY_VERSION } from '../app/catalog-tree.mjs';
import { startRun, onRequestTransition, journeyRun, myJourneyRuns, journeyLens, childPayload, stepDue, OUTCOME_NAMES } from '../app/journeys.mjs';
import { catalogTree, setLens } from '../app/catalog-home.mjs';
import { catalogHome, journeyLensView, journeyRunView } from '../app/static/catalog-home-ui.mjs';
import { REQUEST_STATUS } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const ctx={e,ui};
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const CSP=/<script|\sstyle=|\son[a-z]+=/i;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-journeys');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const latest=code=>db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code=? ORDER BY version DESC LIMIT 1").get(code);
  const version=id=>db.prepare('SELECT version FROM requests WHERE id=?').get(id).version;
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  return {db,users,tx,latest,version,row};
}
const PARENT_PAYLOAD={employee_name:'موظف جديد تجريبي',department:'الفريق الإبداعي التجريبي',start_date:'2026-10-01',systems:'البريد ومساحة الملفات وأداة المهام'};
// الأب الحقيقي: المدير يطلب تجهيز الحسابات، ويعتمده منفذ الدعم التقني (المسار ['it']).
function approvedParent({db,users,tx,latest,version}){
  const parent=latest('IT-NEW-ACCOUNT');
  const draft=tx(()=>createRequest(db,users.manager,{service_id:parent.id,title:'تجهيز حسابات موظف جديد — تجريبي',payload:PARENT_PAYLOAD,project_id:null}));
  tx(()=>transition(db,users.manager,draft.id,'submit',{version:draft.version,note:''}));
  tx(()=>transition(db,users.it,draft.id,'approve',{version:version(draft.id),note:''}));
  return draft.id;
}

test('التعريف: رحلة واحدة مبنيّة على IT-NEW-ACCOUNT بأربع خطوات بلا شرط، وسبعٌ معرّفة لاحقًا بمادّتها، والنسخة صفر',()=>{
  assert.equal(JOURNEYS.length,1);assert.equal(JOURNEY_VERSION,0);
  const [journey]=JOURNEYS;
  assert.equal(journey.key,'new_joiner');assert.deepEqual(journey.parent,{kind:'service',key:'IT-NEW-ACCOUNT'});
  assert.deepEqual(journey.steps.map(s=>s.item.key),['IT-DEVICE','ADM-WORKSPACE','ADM-ACCESS-CARD','EXP-WELCOME']);
  assert.ok(journey.steps.every(s=>s.when===null),'بلا شرط: الأب لا يحمل حقلًا يُشترط عليه');
  assert.equal(JOURNEYS_LATER.length,7);
  for(const later of JOURNEYS_LATER)assert.ok(later.material&&later.missing,`${later.key}: مادّة وما ينقص`);
  // حمولة الابن: preset التعريف، ثم copy، ثم المفتاح المتطابق؛ ولا يُخترع ما لا يُعرف.
  const workspace=journey.steps.find(s=>s.key==='workspace');
  const fields=[{key:'employee_name'},{key:'action'},{key:'date'},{key:'preferred_area'}];
  assert.deepEqual(childPayload(workspace,fields,PARENT_PAYLOAD),{employee_name:'موظف جديد تجريبي',action:'تخصيص جديد',date:'2026-10-01'});
  assert.equal(stepDue({when:null},PARENT_PAYLOAD,[]),true);
  assert.equal(stepDue({when:{field:'department',equals:['غيرها']}},PARENT_PAYLOAD,[{key:'department'}]),false);
});

test('الرحلة: اعتماد الأب يولّد أربعة أبناء باسم صاحبه؛ المكتمل حقوله يُقدَّم والباقي مسودات بسبب مكتوب؛ واعتمادٌ ثانٍ لا يولّد ثانية',t=>{
  const f=fixture(t),{db,users,row}=f;
  const auditBefore=db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  const parentId=approvedParent(f);
  assert.equal(row(parentId).status,'approved');
  const runs=myJourneyRuns(db,users.manager);
  assert.equal(runs.length,1);assert.equal(runs[0].status,'open');assert.equal(runs[0].children,4);
  const run=journeyRun(db,users.manager,runs[0].id);
  assert.deepEqual(run.steps.map(s=>[s.key,s.outcome]),[['device','created'],['workspace','created'],['access_card','created'],['welcome','created']]);
  for(const step of run.steps){
    const child=row(step.child.id);
    assert.equal(child.requester_id,users.manager.id,`${step.key}: الابن باسم صاحب الأب لا باسم من اعتمد`);
    assert.ok(child.title.includes('ضمن رحلة «انضمام موظف جديد»'),`${step.key}: العنوان يسمّي الرحلة`);
  }
  // المقعد اكتملت حقوله من الأب والتعريف (الاسم، تخصيص جديد، تاريخ المباشرة) فقُدّم؛ والثلاثة الأخرى مسودات بسببها.
  const workspace=run.steps.find(s=>s.key==='workspace');
  assert.equal(workspace.child.status,'pending');
  assert.deepEqual(JSON.parse(row(workspace.child.id).payload),{employee_name:'موظف جديد تجريبي',action:'تخصيص جديد',date:'2026-10-01'});
  for(const key of ['device','access_card','welcome']){
    const step=run.steps.find(s=>s.key===key);
    assert.equal(step.child.status,'draft',`${key}: مسودة تنتظر صاحبها`);
    assert.match(step.reason,/حقول لازمة لا يعرفها التعريف/,`${key}: السبب مكتوب`);
  }
  assert.match(run.steps.find(s=>s.key==='device').reason,/نوع الجهاز/,'واسم الحقل الناقص يُقال');
  assert.equal(run.counts.waiting_me,3);assert.equal(run.counts.open_children,4);
  // اعتمادٌ مكرر (زرٌّ ضُغط مرتين، أو إعادة تشغيل): لا رحلة ثانية ولا أبناء جدد.
  transaction(db,()=>onRequestTransition(db,users.it,{...row(parentId),status:'pending'},'approved'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journey_runs').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journey_run_steps').get().n,4);
  // حدث بدء الرحلة في السلسلة باسم من اعتمد، والسلسلة سليمة بعد كل ما كُتب.
  const started=db.prepare("SELECT * FROM audit_events WHERE action='journey.started'").all();
  assert.equal(started.length,1);assert.equal(started[0].actor_id,users.it.id);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n>auditBefore);
  assert.ok(verifyAudit(db),'سلسلة التدقيق سليمة');
});

test('الرحلة: الشرط بشكل show_when يُقيَّم على حمولة الأب بالمُقيِّم نفسه — متحقق يولّد، وغير متحقق يُعلَّم skipped بسببه',t=>{
  const {db,users,tx,latest}=fixture(t);
  // أبٌ بلا رحلة في الكود (IT-SUPPORT المبذورة) وتعريفٌ اصطناعي بشرطين على حقل الاختيار «impact».
  const support=latest('IT-SUPPORT');
  const parent=tx(()=>createRequest(db,users.manager,{service_id:support.id,title:'أب اصطناعي',payload:{issue:'عطل تجريبي في الشبكة',impact:'يمنع العمل'},project_id:null}));
  const definition={key:'synthetic_test',name_ar:'رحلة اصطناعية',parent:{kind:'service',key:'IT-SUPPORT'},steps:[
    {key:'due',item:{kind:'service',key:'IT-DEVICE'},when:{field:'impact',equals:['يمنع العمل']},copy:{},preset:{reason:'تلف',device:'حاسب محمول',fault:'عطل تجريبي كامل في الجهاز'}},
    {key:'not_due',item:{kind:'service',key:'ADM-ACCESS-CARD'},when:{field:'impact',equals:['استفسار']},copy:{},preset:{}}]};
  const run=tx(()=>startRun(db,users.it,db.prepare('SELECT * FROM requests WHERE id=?').get(parent.id),definition));
  assert.deepEqual(run.steps.map(s=>[s.step_key,s.outcome]),[['due','created'],['not_due','skipped']]);
  const skipped=run.steps.find(s=>s.step_key==='not_due');
  assert.match(skipped.reason,/الشرط لم يتحقق/);assert.match(skipped.reason,/impact/);
  assert.equal(skipped.child_request_id,null);
  const page=journeyRun(db,users.manager,run.id);
  assert.equal(page.steps[1].outcome_name,OUTCOME_NAMES.skipped);
  assert.deepEqual(page.steps[1].condition,{field:'impact',equals:['استفسار']},'الشرط كما قُيِّم محفوظ بشكله');
  assert.ok(verifyAudit(db));
});

test('الرحلة: الابن الموقوف بـ129 يُعلَّم تعذّرًا بسبب الإيقاف نفسه ولا يُنشأ له طلب، والبقية تمضي',t=>{
  const f=fixture(t),{db,users,tx}=f;
  tx(()=>setAvailability(db,users.admin,{kind:'service',target_key:'ADM-ACCESS-CARD',state:'hidden',reason:'تجريبي: إيقاف مصطنع لاختبار خطوة الرحلة'}));
  const parentId=approvedParent(f);
  const run=journeyRun(db,users.manager,myJourneyRuns(db,users.manager)[0].id);
  const card=run.steps.find(s=>s.key==='access_card');
  assert.equal(card.outcome,'blocked');assert.equal(card.child,null);
  assert.match(card.reason,/أوقفها/);assert.match(card.reason,/إيقاف مصطنع/,'سبب الإيقاف بنصّه');
  assert.deepEqual(run.steps.filter(s=>s.key!=='access_card').map(s=>s.outcome),['created','created','created']);
  assert.equal(run.counts.blocked,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requests WHERE requester_id=? AND id<>?').get(users.manager.id,parentId).n,3,'ثلاثة أبناء لا أربعة');
  assert.ok(verifyAudit(db));
});

test('الرحلة: تكتمل حين يكتمل الأب وكل ابنٍ وُلد — لا حين يكتمل الأب وحده',t=>{
  const {db,users,tx,latest,version,row}=fixture(t);
  // أبٌ يكتمل بلا وحدة مرتبطة (CREATIVE-BRIEF: المدير يعتمد وينفّذ)، وابنٌ واحد اصطناعي IT-SUPPORT بحقوله كاملة.
  const brief=latest('CREATIVE-BRIEF');
  const parent=tx(()=>createRequest(db,users.employee,{service_id:brief.id,title:'تكليف تجريبي أب',payload:{objective:'هدف تجريبي للرحلة',deliverable:'مخرج تجريبي',due_date:'2026-10-15'},project_id:null}));
  tx(()=>transition(db,users.employee,parent.id,'submit',{version:parent.version,note:''}));
  tx(()=>transition(db,users.manager,parent.id,'approve',{version:version(parent.id),note:''}));
  const definition={key:'synthetic_done',name_ar:'رحلة اصطناعية',parent:{kind:'service',key:'CREATIVE-BRIEF'},steps:[
    {key:'support',item:{kind:'service',key:'IT-SUPPORT'},when:null,copy:{},preset:{issue:'تجهيز جهاز التكليف التجريبي',impact:'استفسار'}}]};
  const run=tx(()=>startRun(db,users.manager,row(parent.id),definition));
  const child=run.steps[0];
  assert.equal(child.outcome,'created');assert.equal(row(child.child_request_id).status,'pending','اكتملت حقوله فقُدّم');
  // الأب يكتمل أولًا: الرحلة تبقى مفتوحة لأن الابن لم يكتمل.
  tx(()=>transition(db,users.manager,parent.id,'claim',{version:version(parent.id),note:''}));
  tx(()=>transition(db,users.manager,parent.id,'complete',{version:version(parent.id),note:'سُلِّم المخرج التجريبي كاملًا واعتُمد'}));
  assert.equal(row(parent.id).status,'completed');
  assert.equal(journeyRun(db,users.employee,run.id).status,'open','لا تكتمل بالأب وحده');
  // ثم الابن: اعتماد المدير، ثم استلام منفذ الدعم وإغلاقه بدليل — فتكتمل الرحلة بحدثٍ في السلسلة.
  const childId=child.child_request_id;
  tx(()=>transition(db,users.manager,childId,'approve',{version:version(childId),note:''}));
  tx(()=>transition(db,users.it,childId,'claim',{version:version(childId),note:''}));
  assert.equal(journeyRun(db,users.employee,run.id).status,'open');
  tx(()=>transition(db,users.it,childId,'complete',{version:version(childId),note:'جُهّز الجهاز وسُلِّم لصاحب التكليف التجريبي'}));
  const done=journeyRun(db,users.employee,run.id);
  assert.equal(done.status,'completed');assert.ok(done.closed_at);
  assert.equal(done.steps[0].child.status,'completed','حالة الابن من الطلبات لحظة القراءة');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='journey.completed'").get().n,1);
  assert.ok(verifyAudit(db));
});

test('صفحة التتبع وعدسة الرحلة: الأب والخطوات بترتيبها وشارة كل ابن من الطلبات؛ من لا يرى الأب لا يرى الرحلة؛ ولا نمط سطري',t=>{
  const f=fixture(t),{db,users,tx}=f;
  approvedParent(f);
  const [mine]=myJourneyRuns(db,users.manager);
  assert.equal(mine.waiting_me,3);assert.equal(mine.href,`#services/journey/${mine.id}`);
  const run=journeyRun(db,users.manager,mine.id);
  const page=journeyRunView(run,ctx),body=text(page);
  assert.doesNotMatch(page,CSP,'CSP');
  assert.ok(body.includes('رحلة «انضمام موظف جديد»')&&body.includes('الطلب الأب')&&body.includes('الخطوات بترتيبها'));
  for(const step of run.steps)assert.ok(body.includes(`${step.position}. ${step.item.name}`),`${step.key}: مسمّاة بترتيبها`);
  // شارات الحالة من القاموس وحده: «مسودة» للثلاثة و«بانتظار الاعتماد» للمقعد، ولا مفتاح خام.
  assert.ok(body.includes(REQUEST_STATUS.draft[0])&&body.includes(REQUEST_STATUS.pending[0]));
  assert.ok(!/[>\s](draft|pending)[<\s]/.test(page.replace(/class="[^"]*"/g,'')),'لا مفتاح حالة خام');
  assert.ok(body.includes('4 طلبات وُلدت')&&body.includes('3 طلبات تنتظر ردك'),`العدّادات من الحمولة: ${body.slice(0,300)}`);
  // من لا يرى الأب (موظف آخر في الإدارة نفسها) لا يبلغ الرحلة، ومعرّفٌ مجهول يُردّ رفضًا مكتوبًا.
  assert.throws(()=>journeyRun(db,users.outsider,mine.id));
  assert.throws(()=>journeyRun(db,users.manager,'00000000-0000-4000-8000-000000000000'),error=>error.details?.refusal?.next?.length>0);
  // العدسة: من الأب في دليله يستطيع بدء الرحلة (المدير والموظف سواء اليوم: IT-NEW-ACCOUNT في دليل الجميع كما يثبّته المسجَّل)؛
  // ومن ليس الأب في دليله — يُقاس بإيقافه من الإعدادات (129) — يقرأ سبب امتناعه مكتوبًا لا زرًّا ميتًا.
  assert.equal(journeyLens(db,users.manager).definitions[0].parent.can_start,true);
  assert.equal(journeyLens(db,users.employee).definitions[0].parent.can_start,true);
  tx(()=>setAvailability(db,users.admin,{kind:'service',target_key:'IT-NEW-ACCOUNT',state:'hidden',reason:'تجريبي: إيقاف مصطنع لاختبار باب الرحلة المغلق'}));
  const stoppedLens=journeyLens(db,users.employee).definitions[0].parent;
  assert.equal(stoppedLens.can_start,false);assert.ok(stoppedLens.why_not);
  tx(()=>setAvailability(db,users.admin,{kind:'service',target_key:'IT-NEW-ACCOUNT',state:'available',reason:'تجريبي: إعادة التفعيل بعد الاختبار'}));
  tx(()=>setLens(db,users.manager,{lens:'journey'}));
  const tree=catalogTree(db,users.manager);
  const home=catalogHome(tree,{...ctx,extra:journeyLensView(tree,ctx)}),homeText=text(home);
  assert.doesNotMatch(home,CSP);
  assert.ok(homeText.includes('رحلاتي')&&homeText.includes('انضمام موظف جديد')&&homeText.includes('رحلات معرّفة لاحقًا'));
  assert.ok(home.includes(`href="${mine.href}"`),'رحلتي رابطٌ إلى صفحة تتبعها');
  assert.ok(home.includes('href="#services/IT-NEW-ACCOUNT"'),'باب الرحلة صفحة الأب');
  // والخطوة المستحقة (مسودة ابن) تظهر في «لك» بسببها وبرابط رحلتها.
  const due=tree.for_you.items.filter(item=>item.for_you.reasons.some(r=>r.key==='journey_step_due'));
  assert.ok(due.length>=1,'خطوة مستحقة في «لك»');
  assert.ok(due[0].for_you.reasons.find(r=>r.key==='journey_step_due').link===mine.href);
});
