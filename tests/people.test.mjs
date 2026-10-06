import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,verifyAudit,now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { addCandidate,createRequisition,getPeopleRecord,listPeople,peopleAction,peopleToday,completeOnboardingTask } from '../app/people.mjs';
import { peopleUI } from '../app/static/people-ui.mjs';

const code=expected=>error=>error.code===expected;
const shift=days=>new Date(Date.parse(`${peopleToday()}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
const matrix=[{key:'craft',label:'مهارة الوظيفة',weight:60,acceptance:'دليل مصطنع على جودة التنفيذ'},{key:'planning',label:'تخطيط العمل',weight:40,acceptance:'يوضح المراحل وتسليمها'}];
function fixture(t) {
  const db=openDb(':memory:');
  seed(db,'synthetic-people-tests-only');t.after(()=>db.close());
  db.prepare('INSERT INTO people_policies VALUES(?,?,?,?,?,?,?,?,?,?)').run('synthetic-hiring','36t','creative','hr','نطاق توظيف مصطنع، ليس سياسة الشركة',shift(-30),shift(365),'مرجع خصوصية مصطنع مؤرخ',1,now());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const needInput={policy_id:'synthetic-hiring',title:'وظيفة اختبار مصطنعة',need:'احتياج واحد بمهارات محددة للاختبار',plan_reference:'خطة عينة محلية راجعها HR',budget_evidence:'دليل مخصص عينة محلية',target_date:shift(10),criteria:matrix};
  const make=(input={},who='manager')=>transaction(db,()=>createRequisition(db,users[who],{...needInput,...input}));
  const act=(who,row,action,input={})=>transaction(db,()=>peopleAction(db,users[who],row.id,action,{version:row.version,...input}));
  const open=()=>act('hr',make(),'approve_need',{note:'راجع HR مرجع الخطة والمخصص المصطنعين'});
  const add=(r,input={})=>transaction(db,()=>addCandidate(db,users.hr,r.id,{version:r.version,name:'مرشح مصطنع',contact:`candidate-${randomUUID()}@example.invalid`,source:'عينة ترشيح محلية',consent_evidence:'دليل موافقة مصطنع للاختبار',retention_until:shift(90),...input}));
  const interview=c=>act('hr',act('hr',c,'screen',{evidence:'فرز مؤهلات موثق مصطنع'}),'schedule_interview',{interview_date:peopleToday(),evidence:'موعد مقابلة محلية مصطنعة'});
  const scores=matrix.map(x=>({key:x.key,score:4,evidence:'دليل عملي مصطنع لكل معيار'}));
  const evaluate=(who,c,input={})=>act(who,c,'evaluate',{scores,recommendation:'proceed',evidence:'تقييم مستقل موثق مصطنع',...input});
  const evaluated=c=>evaluate('hr',evaluate('manager',interview(c)));
  const offer=(c,input={})=>act('hr',c,'propose_offer',{monthly_base:'8000.50',currency:'SAR',start_date:shift(20),valid_until:shift(10),benefits:'مزايا مصطنعة لا تنشئ التزامًا',conditions:'مقترح داخلي فقط دون إرسال',evidence:'مبرر عرض مصطنع من نتائج المقابلة',...input});
  const accepted=c=>act('hr',act('manager',offer(evaluated(c)),'approve_offer',{evidence:'قرار مستقل بمراجعة شروط المقترح'}),'accept_offer',{accepted_on:peopleToday(),evidence:'مرجع قبول مصطنع سجل يدويًا'});
  return {db,users,needInput,make,act,open,add,interview,evaluate,evaluated,offer,accepted};
}

test('TAL-01/02/03/04 HR-08: hiring reaches a completed local checklist with independent owners',t=>{
  const {db,users,open,add,accepted,act}=fixture(t),beforeUsers=db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const r=open();let c=accepted(add(r));assert.equal(c.status,'accepted');
  assert.equal(getPeopleRecord(db,users.manager,r.id).status,'filled');
  assert.equal(c.versions.find(x=>x.kind==='acceptance').snapshot.accepted_on,peopleToday());
  c=act('hr',c,'start_onboarding',{evidence:'قائمة تهيئة محلية بأدلة محددة',items:[{title:'إعداد مساحة اختبار',owner_id:'it',due_date:shift(3),acceptance:'اختبار فتح مساحة محلية دون حساب فعلي'},{title:'مراجعة وثائق العينة',owner_id:'hr',due_date:shift(2),acceptance:'توثيق مراجعة المستندات المصطنعة'}]});
  assert.equal(c.status,'onboarding');assert.equal(c.tasks.length,2);
  assert.throws(()=>act('hr',c,'complete_onboarding',{evidence:'محاولة إكمال مبكر'}),code('onboarding_incomplete'));
  for(const task of c.tasks) transaction(db,()=>completeOnboardingTask(db,users[task.owner_id],task.id,{version:task.version,evidence:'دليل إكمال اختبار محلي'}));
  c=act('hr',c,'complete_onboarding',{evidence:'راجعت HR أدلة جميع عناصر التهيئة'});assert.equal(c.status,'completed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,beforeUsers);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);assert.equal(verifyAudit(db),true);
});

test('TAL-01 PLT-04: need approval requires plan and budget evidence and cannot be self-approved',t=>{
  const {db,users,make,act,add}=fixture(t);
  for(const input of [{plan_reference:''},{budget_evidence:''},{criteria:[]},{criteria:matrix.map(x=>({...x,weight:40}))},{target_date:shift(-1)},{manager_id:'hr'},{status:'open'}]) assert.throws(()=>make(input));
  for(const who of ['employee','hr','it','admin','external'])assert.throws(()=>make({},who),code('forbidden'));
  let r=make();assert.equal(r.status,'pending_need');assert.throws(()=>add(r),code('transition_denied'));
  assert.throws(()=>act('manager',r,'approve_need',{note:'اعتماد ذاتي'}),code('transition_denied'));
  r=act('hr',r,'reject_need',{note:'الخطة المصطنعة لا تدعم الاحتياج'});assert.equal(r.status,'rejected');assert.throws(()=>add(r),code('transition_denied'));
  const c=act('manager',make(),'cancel_need',{note:'إلغاء الاحتياج المصطنع'});assert.equal(c.status,'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people_candidates').get().n,0);
  assert.throws(()=>getPeopleRecord(db,users.outsider,r.id),code('not_found'));
});

test('TAL-02 PLT-09: candidate contact is unique, normalized and restricted to synthetic addresses',t=>{
  const {db,users,open,add}=fixture(t);let r=open();
  const c=add(r,{contact:'UNIQUE@EXAMPLE.INVALID'});assert.equal(c.contact,'unique@example.invalid');
  r=getPeopleRecord(db,users.hr,r.id);
  assert.throws(()=>add(r,{contact:'unique@example.invalid'}),code('candidate_exists'));
  for(const input of [{contact:'real@example.com'},{consent_evidence:''},{retention_until:shift(-1)},{tenant_id:'isolated'}])assert.throws(()=>add(r,input));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people_candidates').get().n,1);
  assert.notEqual(c.id,c.name);assert.equal(c.privacy_reference,'مرجع خصوصية مصطنع مؤرخ');
});

test('TAL-02 PLT-01/05: candidate data excludes unrelated managers, employees, other tenants and admins',t=>{
  const {db,users,open,add}=fixture(t);const r=open(),c=add(r);
  db.prepare("UPDATE users SET role='manager' WHERE id='outsider'").run();
  for(const who of ['employee','outsider','it','external']) {
    assert.deepEqual(listPeople(db,users[who]).candidates,[]);
    assert.throws(()=>getPeopleRecord(db,users[who],c.id),code('not_found'));
    assert.throws(()=>getPeopleRecord(db,users[who],r.id),code('not_found'));
  }
  assert.throws(()=>listPeople(db,users.admin),code('forbidden'));
  assert.throws(()=>getPeopleRecord(db,users.admin,c.id),code('forbidden'));
  assert.throws(()=>getPeopleRecord(db,{...users.employee,role:'hr',department_id:'hr'},c.id),code('not_found'));
  assert.equal(getPeopleRecord(db,users.hr,c.id).contact,c.contact);assert.equal(getPeopleRecord(db,users.manager,c.id).contact,c.contact);
});

test('TAL-02 PLT-05: active roles and departments are rechecked on every candidate operation',t=>{
  const {db,users,open,add,act}=fixture(t);const c=add(open());
  db.prepare("UPDATE users SET department_id='it' WHERE id='hr'").run();
  assert.throws(()=>getPeopleRecord(db,users.hr,c.id),code('not_found'));
  assert.throws(()=>act('hr',c,'screen',{evidence:'دليل قديم'}),code('not_found'));
  db.prepare("UPDATE users SET role='employee' WHERE id='manager'").run();
  assert.throws(()=>getPeopleRecord(db,users.manager,c.id),code('not_found'));
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();assert.throws(()=>listPeople(db,users.employee),code('forbidden'));
});

test('TAL-03: each evaluator records criterion evidence before seeing another recommendation',t=>{
  const {db,users,open,add,interview,evaluate}=fixture(t);let c=interview(add(open()));
  c=evaluate('manager',c,{evidence:'PRIVATE_MANAGER_REASON',recommendation:'do_not_proceed'});
  const hrView=getPeopleRecord(db,users.hr,c.id);assert.equal(hrView.evaluation_count,1);assert.deepEqual(hrView.evaluations,[]);
  assert.equal(JSON.stringify(hrView).includes('PRIVATE_MANAGER_REASON'),false);
  assert.equal(getPeopleRecord(db,users.manager,c.id).evaluations.length,1);
  c=evaluate('hr',c);assert.equal(c.status,'evaluated');assert.equal(c.evaluations.length,2);
  assert.equal(c.evaluations.some(e=>e.recommendation==='do_not_proceed'),true);
  assert.throws(()=>evaluate('manager',c),code('transition_denied'));
});

test('TAL-03: interviews require every approved criterion and cannot be evaluated before their date',t=>{
  const {open,add,act,interview,evaluate}=fixture(t);let c=add(open());
  assert.throws(()=>act('hr',c,'schedule_interview',{interview_date:peopleToday(),evidence:'موعد قبل الفرز'}),code('transition_denied'));
  c=interview(c);
  for(const input of [{scores:[]},{scores:[{key:'craft',score:4,evidence:'دليل'},{key:'craft',score:4,evidence:'دليل'}]},{scores:[{key:'craft',score:6,evidence:'دليل'},{key:'planning',score:4,evidence:'دليل'}]},{evidence:''}])assert.throws(()=>evaluate('manager',c,input));
  let later=act('hr',add(open()),'screen',{evidence:'فرز مصطنع'});
  later=act('hr',later,'schedule_interview',{interview_date:shift(1),evidence:'موعد مستقبلي مصطنع'});
  assert.throws(()=>evaluate('manager',later),code('interview_not_due'));
});

test('TAL-04 PLT-04: changing approved compensation creates a revision and requires a fresh approval',t=>{
  const {db,users,open,add,evaluated,offer,act}=fixture(t);let c=offer(evaluated(add(open())));
  assert.equal(c.offer.monthly_base_minor,'800050');
  assert.throws(()=>act('hr',c,'approve_offer',{evidence:'اعتماد ذاتي للمقترح'}),code('transition_denied'));
  c=act('manager',c,'approve_offer',{evidence:'اعتماد مستقل للنسخة الأولى'});const previous=c;
  c=offer(c,{monthly_base:'9000.25'});assert.equal(c.status,'offer_pending');assert.equal(c.offer_revision,2);
  assert.equal(c.versions.find(x=>x.kind==='offer'&&x.revision===1).snapshot.monthly_base_minor,'800050');
  assert.throws(()=>act('hr',c,'accept_offer',{accepted_on:peopleToday(),evidence:'تجاوز إعادة الاعتماد'}),code('transition_denied'));
  assert.throws(()=>act('manager',previous,'approve_offer',{evidence:'قرار على نسخة قديمة'}),code('stale_version'));
  c=act('manager',c,'approve_offer',{evidence:'راجع المدير التغيير المالي المصطنع'});
  c=act('hr',c,'accept_offer',{accepted_on:peopleToday(),evidence:'دليل قبول النسخة الثانية'});
  assert.equal(c.status,'accepted');assert.equal(getPeopleRecord(db,users.hr,c.id).offer.monthly_base_minor,'900025');
});

test('TAL-04: offer inputs, stage evidence, expiry and acceptance dates are checked',t=>{
  const {open,add,evaluated,offer,act}=fixture(t);let c=evaluated(add(open()));
  for(const input of [{monthly_base:'1e4'},{monthly_base:'-10'},{monthly_base:'1.001'},{monthly_base:100},{currency:'AAA'},{valid_until:shift(-1)},{benefits:''},{evidence:''}]) assert.throws(()=>offer(c,input));
  c=offer(c);assert.throws(()=>act('hr',c,'accept_offer',{accepted_on:peopleToday(),evidence:'لا يوجد اعتماد مدير'}),code('transition_denied'));
  c=act('manager',c,'approve_offer',{evidence:'اعتماد مصطنع'});
  assert.throws(()=>act('hr',c,'accept_offer',{accepted_on:shift(1),evidence:'قبول مستقبلي'}),code('offer_expired'));
  assert.throws(()=>act('hr',c,'accept_offer',{accepted_on:shift(-1),evidence:'قبول سابق للقرار'}),code('acceptance_date'));
  assert.throws(()=>act('hr',c,'accept_offer',{accepted_on:peopleToday(),evidence:''}),code('invalid_text'));
});

test('HR-08 PLT-05: checklist owners see only their tasks and cannot complete another owner task',t=>{
  const {db,users,open,add,accepted,act}=fixture(t);let c=accepted(add(open()));
  c=act('hr',c,'start_onboarding',{evidence:'تهيئة مصطنعة محددة',items:[{title:'إعداد جهاز مصطنع',owner_id:'it',due_date:shift(2),acceptance:'دليل فتح بيئة اختبار'},{title:'عنصر موارد بشرية',owner_id:'hr',due_date:shift(2),acceptance:'مراجعة دليل مصطنع'}]});
  const itData=listPeople(db,users.it);assert.equal(itData.tasks.length,1);assert.deepEqual(itData.candidates,[]);assert.deepEqual(itData.requisitions,[]);
  assert.equal('candidate_id' in itData.tasks[0],false);assert.equal(JSON.stringify(itData).includes(c.contact),false);
  const task=itData.tasks[0];
  assert.throws(()=>transaction(db,()=>completeOnboardingTask(db,users.hr,task.id,{version:task.version,evidence:'تجاوز مالك العنصر'})),code('forbidden'));
  const complete=transaction(db,()=>completeOnboardingTask(db,users.it,task.id,{version:task.version,evidence:'دليل إكمال مصطنع'}));
  assert.equal(complete.status,'completed');
  assert.throws(()=>transaction(db,()=>completeOnboardingTask(db,users.it,task.id,{version:task.version,evidence:'محاولة ثانية'})),code('stale_version'));
  assert.throws(()=>transaction(db,()=>completeOnboardingTask(db,users.external,task.id,{version:complete.version,evidence:'خارج الكيان'})),code('not_found'));
});

test('HR-08: onboarding cannot start before acceptance or assign an inactive, external or admin owner',t=>{
  const {open,add,accepted,act}=fixture(t);let c=add(open());
  const items=[{title:'عنصر اختبار مصطنع',owner_id:'it',due_date:shift(2),acceptance:'دليل قبول العنصر'}];
  assert.throws(()=>act('hr',c,'start_onboarding',{items,evidence:'تجاوز القبول'}),code('transition_denied'));
  c=accepted(c);
  for(const owner_id of ['external','admin','missing'])assert.throws(()=>act('hr',c,'start_onboarding',{items:items.map(x=>({...x,owner_id})),evidence:'تكليف غير مخول'}),code('task_owner'));
  assert.throws(()=>act('hr',c,'start_onboarding',{items:[...items,...items],evidence:'عنصر مكرر'}),code('duplicate_item'));
  assert.throws(()=>act('hr',c,'start_onboarding',{items:[],evidence:'قائمة فارغة'}),code('onboarding_items'));
});

test('TAL-02 PLT-06/09: repeated candidate creation reuses the authorized identity and audit',t=>{
  const {db,users,open}=fixture(t);const r=open(),key=randomUUID(),input={version:r.version,name:'مرشح عينة',contact:'retry@example.invalid',source:'عينة محلية',consent_evidence:'دليل عينة مصطنع',retention_until:shift(90)};
  const create=()=>transaction(db,()=>createOnce(db,users.hr,'people.add_candidate',key,input,()=>addCandidate(db,users.hr,r.id,input),id=>getPeopleRecord(db,users.hr,id)));
  const a=create(),b=create();assert.equal(a.id,b.id);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people_candidates').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='people.candidate_added'").get().n,1);
  db.prepare("UPDATE users SET department_id='it' WHERE id='hr'").run();assert.throws(create,code('not_found'));
});

test('TAL-02 PLT-06: candidate records, evaluations, offer revisions and decisions resist rewriting',t=>{
  const {db,open,add,evaluated,offer}=fixture(t);const c=offer(evaluated(add(open())));
  for(const table of ['people_events','people_versions','people_evaluations','people_candidates','people_requisitions','people_policies'])assert.throws(()=>db.exec(`DELETE FROM ${table}`),/immutable|append only|retention/);
  assert.throws(()=>db.prepare("UPDATE people_candidates SET contact='changed@example.invalid' WHERE id=?").run(c.id),/immutable|invalid candidate transition/);
  assert.throws(()=>db.prepare("UPDATE people_candidates SET offer_json='{}',version=version+1 WHERE id=?").run(c.id),/new approval revision/);
  assert.throws(()=>db.exec("UPDATE people_evaluations SET recommendation='do_not_proceed'"),/immutable/);
  assert.throws(()=>db.exec("UPDATE people_events SET evidence='changed'"),/append only/);
});

test('TAL-02: retention expiry hides the candidate profile and queues an authorized retention review',t=>{
  const {db,users,open,add}=fixture(t);const c=add(open(),{retention_until:peopleToday()});
  t.mock.timers.enable({apis:['Date'],now:Date.now()+2*86400000});
  const view=listPeople(db,users.hr);assert.deepEqual(view.candidates,[]);assert.equal(view.retention_due[0].id,c.id);
  assert.equal(JSON.stringify(view).includes(c.contact),false);assert.throws(()=>getPeopleRecord(db,users.manager,c.id),code('retention_due'));
  assert.deepEqual(listPeople(db,users.it).retention_due,[]);
});

test('TAL-01/02 PLT-06: an audit failure rolls back the applicant and a missing transaction is rejected',t=>{
  const {db,users,open,add,needInput}=fixture(t);const r=open();
  assert.throws(()=>createRequisition(db,users.manager,needInput),code('transaction_required'));
  db.exec("CREATE TRIGGER fail_people_audit BEFORE INSERT ON audit_events WHEN NEW.action='people.candidate_added' BEGIN SELECT RAISE(ABORT,'synthetic people audit failure'); END;");
  assert.throws(()=>add(r),/synthetic people audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people_candidates').get().n,0);
  assert.equal(getPeopleRecord(db,users.hr,r.id).version,r.version);
});

test('TAL-04: a single vacancy cannot accept a second candidate or reuse an old approval',t=>{
  const {db,users,open,add,evaluated,offer,act}=fixture(t);let r=open();
  let a=add(r);r=getPeopleRecord(db,users.hr,r.id);let b=add(r);
  a=act('manager',offer(evaluated(a)),'approve_offer',{evidence:'قرار مستقل للمرشح الأول'});
  b=act('manager',offer(evaluated(b)),'approve_offer',{evidence:'قرار مستقل للمرشح الثاني'});
  a=act('hr',a,'accept_offer',{accepted_on:peopleToday(),evidence:'قبول مصطنع لشاغر واحد'});
  assert.throws(()=>act('hr',b,'accept_offer',{accepted_on:peopleToday(),evidence:'محاولة قبول ثانٍ'}),code('transition_denied'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM people_candidates WHERE status='accepted'").get().n,1);
  const latest=getPeopleRecord(db,users.hr,r.id);assert.throws(()=>add(latest),code('transition_denied'));
  assert.equal(a.status,'accepted');
});

test('TAL-04 F10: acceptance dates use the Riyadh day at the UTC year boundary',t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-12-31T21:30:00.000Z')});
  const {open,add,evaluated,offer,act}=fixture(t);assert.equal(peopleToday(),'2027-01-01');
  let c=act('manager',offer(evaluated(add(open()))),'approve_offer',{evidence:'اعتماد الساعة00:30 بتوقيت الرياض'});
  assert.throws(()=>act('hr',c,'accept_offer',{accepted_on:'2026-12-31',evidence:'قبول في اليوم السابق بالرياض'}),code('acceptance_date'));
  c=act('hr',c,'accept_offer',{accepted_on:'2027-01-01',evidence:'دليل قبول بتاريخ الرياض الصحيح'});
  assert.equal(c.versions.find(x=>x.kind==='acceptance').snapshot.accepted_on,'2027-01-01');
});

test('TAL-02/04 SEC-01: people forms retain the selected version and escape sensitive displayed text',async t=>{
  const {db,users,open,add,interview}=fixture(t);const c=interview(add(open(),{name:'<script>synthetic()</script>'}));
  const data=await peopleUI.load(async()=>listPeople(db,users.manager));
  const spec=peopleUI.form('evaluate',c.id,data);data.candidates[0].version=999;
  const input=spec.toPayload({score_craft:'4',score_planning:'3',evidence_craft:'دليل الأول',evidence_planning:'دليل الثاني',recommendation:'proceed',evidence:'سبب التوصية'});
  assert.equal(input.version,c.version);assert.equal(input.scores[0].score,4);assert.equal(spec.fields.some(f=>f.name==='version'),false);
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=peopleUI.render(data,{e,button:(action,id,label)=>`<button>${e(label)}</button>`,money:value=>String(value)});
  assert.equal(html.includes('<script>'),false);assert.equal(html.includes('&lt;script&gt;'),true);
  const create=peopleUI.form('create',data.policies[0].id,data);assert.equal(create.idempotent,true);
  assert.equal(create.toPayload({first_weight:'60',second_weight:'40'}).criteria[0].weight,60);
});
