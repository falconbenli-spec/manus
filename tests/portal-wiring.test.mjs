import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { runDue } from '../app/jobs.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { decideRule, addDays } from '../app/payroll-rules.mjs';
import { submitResignation, resignationAction, resignationsBoard, JOB_TYPE } from '../app/resignations.mjs';
import { proposeTravel, travelAction, travelBoard, extensionAction } from '../app/travel.mjs';
import { recordMedicalPolicy, recordEnrolment, enrolmentAction } from '../app/benefits.mjs';
import { myBenefits, benefitsAdmin, submitBenefitRequest, hrDecision, financeDecision, proposeBenefit, decideBenefit } from '../app/benefits-portal.mjs';
import { myBenefitsUI, benefitsAdminUI } from '../app/static/benefits-portal-ui.mjs';
import { adoptStarter, approveTemplate, templatesBoard, lettersBoard, letterAction, letterDocument, verifyLetter } from '../app/letters.mjs';
import { BASE_SCHEDULE_ID, decideSchedule, recordViolation, caseAction, getCase } from '../app/discipline.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { statusName } from '../app/static/vocabulary.mjs';
// م0 «السور»: الشاشات المرحَّلة إلى العدّة تأخذ tile من ui، فيمررها الاختبار كما تمررها app.mjs في موضعها الواحد.
import { kit } from '../app/static/kit.mjs';
import { myRequestsUI } from '../app/static/my-requests-ui.mjs';
import { homeBoard } from '../app/home.mjs';
import { homeUI } from '../app/static/home-ui.mjs';
import { notifications } from '../app/workflow.mjs';
import { SUBJECT_LINKS, categoryOf } from '../app/notices.mjs';

// ربط البوابة: الفجوات المسجلة في docs/implementation/handoff/integration-20260919.md §5.
// كل الأسماء والتواريخ والمبالغ هنا مصطنعة، والقاعدة نفسها قاعدة الوحدات: لا شيء يُقبل ولا يُصرف من هذه الاختبارات.
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const at=date=>Date.parse(`${date}T12:00:00+03:00`);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const RULE_SEED={resignation:'reg-seed-resignation',travel_per_diem:'reg-seed-travel'};

// manager = صاحب الصلاحية (hr.contracts.approve)، ومدير الموارد البشرية المعتمِد (hr.policy.accept)، ومُصدِر الخطابات.
// hr = مسؤول المزايا ومُعد الخطابات والرواتب بحكم دوره. it = التأكيد المالي.
function fixture(t,{contracts=['employee','outsider']}={}){
  const db=openDb(':memory:');seed(db,'synthetic-portal-wiring');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار ربط البوابة'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','hr.letters.issue','hr.discipline.decide','payroll.approve'])grant('manager',c);
  grant('it','benefits.finance.confirm');
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));
    tx(()=>decidePolicy(db,users.manager,id,'accept',{note:'اعتماد مصطنع للاختبار'}));};
  policy('pay_components',{components:['basic','housing','transport']});
  for(const user_id of contracts){
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:30,
      pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}],document_reference:'عقد مصطنع'}));
    tx(()=>contractAction(db,users.hr,id,'submit_contract',{version:getContract(db,users.hr,id).version}));
    tx(()=>contractAction(db,users.manager,id,'approve_contract',{version:getContract(db,users.manager,id).version}));
  }
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,updated_by,updated_at) VALUES('employee','36t','وظيفة مصطنعة','full_time','2024-01-01','hr',?)").run(new Date().toISOString());
  const acceptRule=(kind,choices={})=>tx(()=>decideRule(db,users.manager,RULE_SEED[kind],'accept',{effective_from:'2020-01-01',choices,note:'طابقت القيم مع اللائحة الموقعة (اختبار مصطنع)'}));
  const noticesOf=(who,subject)=>notifications(db,users[who]).filter(n=>n.subject_kind===subject);
  return {db,users,tx,grant,acceptRule,noticesOf};
}

// تسجيل تأمين قائم لـ«مزاياي»: وثيقة بثلاث فئات، والموظف مسجَّل في «فئة ب» ومؤكَّد.
function insurance(f){
  const {db,users,tx}=f;
  const policyId=tx(()=>recordMedicalPolicy(db,users.hr,{insurer_name:'شركة تأمين مصطنعة',policy_number:'SYN-PORTAL-1',effective_from:day(-200),effective_to:day(200),tiers:['فئة ب','فئة أ','فئة VIP'],renewal_notice_days:30,note:''})).id;
  const enrolmentId=tx(()=>recordEnrolment(db,users.hr,{policy_id:policyId,employee_id:'employee',tier:'فئة ب',requested_on:day(-30)})).id;
  tx(()=>enrolmentAction(db,users.hr,enrolmentId,'confirm_enrolment',{version:1,confirmed_on:day(-20),member_reference:'MEM-PORTAL-0001'}));
  return {policyId,enrolmentId};
}
// نشر قالب «خطاب بالمزايا» (الترحيل 105): يتبناه المعد مسودةً، ويعتمده شخص آخر يملك الإصدار.
function publishBenefitLetter(f){
  const {db,users,tx}=f;
  tx(()=>adoptStarter(db,users.hr,'benefit_letter',{}));
  const draft=templatesBoard(db,users.manager).types.find(x=>x.code==='benefit_letter').draft;
  tx(()=>approveTemplate(db,users.manager,'benefit_letter',{effective_from:today(),note:'راجعت النص المبدئي ثنائي اللغة وأعتمده',version:draft.version}));
  return draft;
}

test('«طلباتي» carries the resignation, the travel decision and the benefit request, each read by its own module and nobody else’s',t=>{
  const f=fixture(t);const {db,users,tx,acceptRule}=f;
  insurance(f);
  acceptRule('resignation');acceptRule('travel_per_diem');
  const d0=today();
  const resignationId=tx(()=>submitResignation(db,users.employee,{letter_date:d0,reason:'انتقال مصطنع إلى مدينة أخرى',proposed_last_day:addDays(d0,45)})).id;
  const start=addDays(d0,7);
  const travelId=tx(()=>proposeTravel(db,users.employee,{task:'ورشة عمل مصطنعة لدى عميل',destination:'جدة',scope:'domestic',start_date:start,end_date:addDays(start,2),distance_km:950,road_type:'paved'})).id;
  const benefitId=tx(()=>submitBenefitRequest(db,users.employee,{option:'benefit_letter',details:{purpose:'bank',addressee:'بنك مصطنع',language:'ar'}})).id;

  const mine=myRequests(db,users.employee),byKey=new Map(mine.items.map(i=>[i.key,i]));
  assert.ok(byKey.has(`resignation:${resignationId}`)&&byKey.has(`travel:${travelId}`)&&byKey.has(`benefit:${benefitId}`),'the three new sources appear in the one list');
  const r=byKey.get(`resignation:${resignationId}`);
  // م0 «السور»: عبارة الحالة من القاموس الواحد («بانتظار الاعتماد»)، فلا تُنسخ هنا حرفيةً تنحرف عنه.
  assert.deepEqual([r.source_name,r.status,r.status_name,r.link],['استقالة','pending',statusName('pending'),'#resignations']);
  assert.equal(r.module_status,'مقدمة بانتظار الرد','the module’s own status word travels beside the unified one');
  assert.equal(r.due_on,addDays(d0,31),'the deemed-acceptance day shows as the date it is, once the rule is accepted');
  assert.equal(r.overdue,false,'a statutory date is never called “past due”: it is not a service level');
  assert.equal(r.submitted_on,d0);
  const tr=byKey.get(`travel:${travelId}`);
  assert.deepEqual([tr.source_name,tr.status,tr.link],['انتداب','pending','#travel']);
  assert.match(tr.title,/^جدة · /);
  const b=byKey.get(`benefit:${benefitId}`);
  assert.deepEqual([b.source_name,b.status,b.link],['طلب مزايا','pending','#my-benefits']);
  assert.match(b.title,/^خطاب بالمزايا — BEN-\d{4}-\d{4}$/,'the option and its reference only: no dependant data in a general list');
  // الشكل كما هو: العناصر والعدادات والمصادر.
  assert.equal(mine.counts.all,mine.items.length);
  assert.equal(mine.counts.open,mine.items.filter(i=>i.open).length);
  for(const key of ['resignation','travel','benefit'])assert.ok(mine.sources[key],`SOURCES names ${key}`);

  // قواعد رؤية كل وحدة كما هي: الزميل لا يرى شيئًا من ذلك، والمدير يرى انتداب فريقه في شاشته لا في «طلباتي».
  const outsider=new Set(myRequests(db,users.outsider).items.map(i=>i.key));
  for(const key of [`resignation:${resignationId}`,`travel:${travelId}`,`benefit:${benefitId}`])assert.equal(outsider.has(key),false);
  const managerKeys=new Set(myRequests(db,users.manager).items.map(i=>i.key));
  assert.equal(managerKeys.has(`travel:${travelId}`),false,'the line manager sees the team’s travel in «الانتداب», never as one of his own requests');
  assert.equal(managerKeys.has(`resignation:${resignationId}`),false,'nor the resignation addressed to him');
  // الانتداب المنتهية مدته يُعد مكتملًا كما تُعد الإجازة المنتهية مكتملة.
  const past=tx(()=>proposeTravel(db,users.employee,{task:'انتداب مصطنع انتهت مدته',destination:'الدمام',scope:'domestic',start_date:day(-10),end_date:day(-8),distance_km:400,road_type:'paved'})).id;
  tx(()=>travelAction(db,users.manager,past,'approve_travel',{version:travelBoard(db,users.manager).decisions.find(x=>x.id===past).version,grade:'employee',housing:'none',transport:'none'}));
  assert.equal(myRequests(db,users.employee).items.find(i=>i.key===`travel:${past}`).status,'completed');
  assert.equal(myRequests(db,users.employee).items.find(i=>i.key===`travel:${travelId}`).status,'pending','a trip still ahead stays open');
  // الشاشة تعرض المصادر الثلاثة بأسمائها.
  const html=myRequestsUI.render(myRequests(db,users.employee),{e,tr:ar=>ar,lang:'ar',ui:kit(e)});
  for(const name of ['استقالة','انتداب','طلب مزايا'])assert.ok(html.includes(name),`the screen shows ${name}`);
  assert.ok(verifyAudit(db));
});

test('resignation and travel notify: a submit receipt, every decision, deemed acceptance, the last working day, travel approval and its extension',t=>{
  const f=fixture(t);const {db,users,tx,acceptRule,noticesOf}=f;
  acceptRule('resignation');acceptRule('travel_per_diem');
  assert.deepEqual([SUBJECT_LINKS.resignation,SUBJECT_LINKS.travel_decision],['#resignations','#travel'],'both subjects open their own screen');
  for(const kind of ['resignation','travel_decision'])assert.ok(kind.length>=3&&kind.length<=40&&/^[a-z_]+$/.test(kind),`${kind} passes the shape rule of migration 099`);

  const d0=today();
  const resignationId=tx(()=>submitResignation(db,users.employee,{letter_date:d0,reason:'سبب مصطنع لا يظهر في أي إشعار',proposed_last_day:addDays(d0,45)})).id;
  const receipt=noticesOf('employee','resignation');
  assert.equal(receipt.length,1);
  assert.match(receipt[0].title,/^استلمنا خطاب استقالتك$/);
  assert.equal(receipt[0].link,'#resignations');
  assert.equal(receipt[0].category,'my_requests','the employee’s own updates ride the my_requests email category of migration 100');
  assert.ok(!receipt[0].body.includes('سبب مصطنع'),'the reason never enters a notice');
  const waiting=noticesOf('manager','resignation');
  assert.equal(waiting.length,1);
  assert.match(waiting[0].title,/^استقالة تنتظر قرارك: /);
  assert.equal(waiting[0].category,'approvals','what waits for a decision rides the approvals category');

  // التأجيل ثم القبول ثم تحديد آخر يوم: كل قرار يصل صاحب الاستقالة.
  const view=()=>resignationsBoard(db,users.manager).resignations.find(x=>x.id===resignationId);
  tx(()=>resignationAction(db,users.manager,resignationId,'defer_resignation',{version:view().version,deferred_until:addDays(d0,40),reason:'مصلحة عمل مصطنعة: تسليم مشروع قائم قبل المغادرة'}));
  assert.ok(noticesOf('employee','resignation').some(n=>/أُجِّل قبول استقالتك/.test(n.title)));
  tx(()=>resignationAction(db,users.manager,resignationId,'accept_resignation',{version:view().version,last_working_day:addDays(d0,45),notice_waived:false,note:'قبول مصطنع'}));
  const accepted=noticesOf('employee','resignation').find(n=>/^قُبلت استقالتك$/.test(n.title));
  assert.ok(accepted&&accepted.body.includes(addDays(d0,45).slice(8).replace(/^0/,'')),'the accepted notice states the last working day');

  // القبول الحكمي من مهمة الطابور: صاحبها ومن كان ينتظر القرار يُخبَران، ثم يُحدَّد آخر يوم عمل فيصله إشعاره.
  const second=fixture(t);
  second.acceptRule('resignation');
  const lateId=second.tx(()=>submitResignation(second.db,second.users.employee,{letter_date:today(),reason:'استقالة مصطنعة بلا رد',proposed_last_day:addDays(today(),40)})).id;
  assert.equal(second.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type=?').get(JOB_TYPE).n,1);
  assert.deepEqual(runDue(second.db,{now:at(addDays(today(),31))}).map(x=>x.outcome),['done']);
  assert.equal(second.db.prepare('SELECT status FROM resignations WHERE id=?').get(lateId).status,'deemed_accepted');
  assert.ok(second.noticesOf('employee','resignation').some(n=>/مقبولة حكمًا/.test(n.title)),'the employee is told the clock ran out');
  assert.ok(second.noticesOf('manager','resignation').some(n=>/مقبولة حكمًا/.test(n.title)),'so is whoever still owed a decision');
  const lateView=()=>resignationsBoard(second.db,second.users.manager).resignations.find(x=>x.id===lateId);
  assert.ok(lateView().actions.includes('set_last_day'));
  second.tx(()=>resignationAction(second.db,second.users.manager,lateId,'set_last_day',{version:lateView().version,last_working_day:addDays(today(),50),notice_waived:true,note:'تحديد مصطنع لآخر يوم عمل'}));
  const lastDay=second.noticesOf('employee','resignation').find(n=>/^حُدد آخر يوم عمل لك$/.test(n.title));
  assert.ok(lastDay&&/الإعفاء من فترة الإشعار/.test(lastDay.body),'the waiver is stated, the note is not');

  // الانتداب: الاقتراح ثم الاعتماد ثم التمديد.
  const start=addDays(d0,7);
  const travelId=tx(()=>proposeTravel(db,users.employee,{task:'ورشة عمل مصطنعة لدى عميل',destination:'جدة',scope:'domestic',start_date:start,end_date:addDays(start,2),distance_km:950,road_type:'paved'})).id;
  const need=noticesOf('manager','travel_decision');
  assert.equal(need.length,1);assert.match(need[0].title,/^انتداب ينتظر قرارك: /);assert.equal(need[0].category,'approvals');assert.equal(need[0].link,'#travel');
  const decision=()=>travelBoard(db,users.manager).decisions.find(x=>x.id===travelId);
  const approved=tx(()=>travelAction(db,users.manager,travelId,'approve_travel',{version:decision().version,grade:'employee',housing:'none',transport:'none'}));
  assert.ok(approved.allowance_minor>0);
  const told=noticesOf('employee','travel_decision').find(n=>/^اعتُمد انتدابك/.test(n.title));
  assert.ok(told,'the traveller is told the decision');
  assert.equal(told.category,'my_requests');
  assert.ok(!/\d/.test(told.body),'no allowance figure in the notice: the amount is read in the screen');
  const ext=tx(()=>travelAction(db,users.employee,travelId,'request_extension',{version:decision().version,days:5,progress_review:'أُنجز نصف الورشة وبقي التدريب الميداني مع فريق العميل'})).id;
  assert.ok(noticesOf('manager','travel_decision').some(n=>/^تمديد انتداب ينتظر قرارك/.test(n.title)));
  tx(()=>extensionAction(db,users.manager,ext,'approve_extension',{note:'راجعت ما أنجز والمتبقي'}));
  assert.ok(noticesOf('employee','travel_decision').some(n=>/^مُدد انتدابك 5 يوم/.test(n.title)));
  // فئة البريد تُقرأ بالدالة نفسها التي يقرأ بها مخطط البريد الصفوف القديمة.
  assert.equal(categoryOf({kind:'travel_decision_needed',subject_kind:'travel_decision'}),'approvals');
  assert.equal(categoryOf({kind:'resignation_accepted',subject_kind:'resignation'}),'my_requests');
  assert.ok(verifyAudit(db));
});

test('the benefit letter is generated, not recorded: it opens a real letter request and the employee downloads an issued document with its QR verification code',t=>{
  const f=fixture(t);const {db,users,tx}=f;
  insurance(f);
  // قبل اعتماد القالب: المسار القديم كما هو، مرجع يدوي يسجله فريق المزايا.
  const before=myBenefits(db,users.employee).options.find(o=>o.key==='benefit_letter');
  assert.deepEqual([before.available,before.letter_ready],[true,false]);
  const recorded=tx(()=>submitBenefitRequest(db,users.employee,{option:'benefit_letter',details:{purpose:'school',addressee:'مدرسة مصطنعة',language:'ar'}})).id;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM letter_requests').get().n,0,'nothing is opened in the letters module without an approved template');
  tx(()=>hrDecision(db,users.hr,recorded,'approve',{version:1,letter_reference:'HR-LTR-OLD-1'}));

  publishBenefitLetter(f);
  const ready=myBenefits(db,users.employee).options.find(o=>o.key==='benefit_letter');
  assert.equal(ready.letter_ready,true);
  const id=tx(()=>submitBenefitRequest(db,users.employee,{option:'benefit_letter',details:{purpose:'insurance_proof',addressee:'جهة مصطنعة',language:'en'}})).id;
  const opened=db.prepare("SELECT * FROM letter_requests WHERE type_code='benefit_letter'").get();
  assert.ok(opened,'a real letter request is opened in the letters module');
  assert.deepEqual([opened.user_id,opened.status,opened.addressee],['employee','requested','جهة مصطنعة']);
  assert.deepEqual(Object.values(db.prepare('SELECT language,delivery,copies FROM letter_request_options WHERE request_id=?').get(opened.id)),['en','digital',1]);
  const linked=myBenefits(db,users.employee).requests.find(r=>r.id===id);
  assert.equal(linked.letter.status,'requested');assert.equal(linked.letter.reference,null);
  // طلب ثانٍ بينما الأول مفتوح: الخيار نفسه يقول السبب قبل التقديم، فلا يصل الموظف إلى رفض بعده.
  const blocked=myBenefits(db,users.employee).options.find(o=>o.key==='benefit_letter');
  assert.equal(blocked.available,false);assert.match(blocked.reason,/«خطاباتي»/);
  assert.throws(()=>tx(()=>submitBenefitRequest(db,users.employee,{option:'benefit_letter',details:{purpose:'bank',addressee:'بنك مصطنع',language:'ar'}})),code('option_unavailable'));

  // اعتماد فريق المزايا لا يسأل عن مرجع يدوي: الخطاب يصدر من وحدة الخطابات.
  const spec=benefitsAdminUI.form('hr_approve',id,benefitsAdmin(db,users.hr));
  assert.deepEqual(spec.fields.map(x=>x.name),['note'],'the HR form no longer asks for a hand-typed letter reference');
  tx(()=>hrDecision(db,users.hr,id,'approve',{version:1}));
  assert.equal(db.prepare('SELECT status FROM benefit_requests WHERE id=?').get(id).status,'completed');

  // سلسلة الخطابات كما هي: جهة تُعدّ وجهة أخرى تُصدر.
  const letterView=who=>lettersBoard(db,users[who]).requests.find(r=>r.id===opened.id);
  tx(()=>letterAction(db,users.hr,opened.id,'prepare_letter',{version:letterView('hr').version,note:'طوبق على العقد'}));
  assert.throws(()=>tx(()=>letterAction(db,users.hr,opened.id,'issue_letter',{version:letterView('hr').version})),code('action_unavailable'),'whoever prepared it never issues it');
  const issued=tx(()=>letterAction(db,users.manager,opened.id,'issue_letter',{version:letterView('manager').version,note:'صدر'}));
  assert.match(issued.reference,/^\d{4}-\d{5}$/);
  const document=letterDocument(db,users.employee,db.prepare('SELECT id FROM letters WHERE request_id=?').get(opened.id).id);
  assert.equal(document.reference,issued.reference);
  assert.match(document.verify_path,/^\/verify\/letter\/[0-9A-Z]{12}$/,'an issued document with its QR verification path');
  assert.equal(verifyLetter(db,document.verify_code).found,true);
  assert.ok(document.body.includes(users.employee.name)&&document.body.includes('Benefits letter'),'the bilingual draft template filled from the platform’s own records');
  assert.ok(!/\d{1,3}(,\d{3})*\.\d{2}/.test(document.body),'the benefits letter carries no salary figure');
  const after=myBenefits(db,users.employee).requests.find(r=>r.id===id);
  assert.deepEqual([after.letter.status,after.letter.reference],['issued',issued.reference]);
  assert.equal(after.outcome.letter_request_id,opened.id);
  // بعد صدور الخطاب يُفتح باب طلب جديد من «مزاياي» كما تفتحه وحدة الخطابات.
  assert.equal(myBenefits(db,users.employee).options.find(o=>o.key==='benefit_letter').available,true);
  assert.ok(verifyAudit(db));
});

test('the discipline panel renders where the employee looks: on home when a case or a penalty exists, and never for someone with neither',t=>{
  const f=fixture(t);const {db,users,tx}=f;
  tx(()=>decideSchedule(db,users.manager,BASE_SCHEDULE_ID,'accept',{effective_from:'2024-01-01',note:'قبول مصطنع بعد مطابقة الجدول'}));
  const clean=homeBoard(db,users.outsider);
  assert.equal(clean.discipline,null,'nobody is reminded of violations they do not have');
  assert.equal(clean.cards.some(c=>c.key==='discipline'),false);
  assert.equal(homeUI.render(clean,{e,tr:ar=>ar,lang:'ar'}).includes('مخالفاتي وجزاءاتي'),false);

  const d=today();
  const caseId=tx(()=>recordViolation(db,users.hr,{user_id:'employee',codes:['A01'],act_date:d,discovered_on:d,description:'تأخر مصطنع عن بداية الدوام',source_kind:'hr_observation'})).id;
  const home=homeBoard(db,users.employee);
  assert.ok(home.discipline,'the section appears once a case exists');
  assert.deepEqual([home.discipline.cases,home.discipline.open_cases,home.discipline.link],[1,1,'#my-discipline']);
  assert.equal(home.discipline.rows[0].id,caseId);
  assert.ok(home.discipline.rows[0].due_on,'the Art. 119 deadline travels with the row');
  const card=home.cards.find(c=>c.key==='discipline');
  assert.ok(card&&card.link==='#my-discipline');
  const html=homeUI.render(home,{e,tr:ar=>ar,lang:'ar'});
  assert.ok(html.includes('مخالفاتي وجزاءاتي')&&html.includes('#my-discipline'),'the home screen paints the section and its link');
  assert.ok(html.includes(home.discipline.rows[0].reference));
  assert.ok(!html.includes('تأخر مصطنع عن بداية الدوام'),'the accusation text stays in «مخالفاتي وجزاءاتي», not on home');

  // دفاع ينتظر الموظف: الصف يقول «ينتظر ردك».
  tx(()=>caseAction(db,users.hr,caseId,'open_investigation',{version:getCase(db,users.hr,caseId).version,process:'written',charge_text:'اتهام كتابي مصطنع',charge_delivered_on:d}));
  const waiting=homeBoard(db,users.employee);
  assert.equal(waiting.discipline.needs_you,1);
  assert.ok(waiting.discipline.rows[0].actions.includes('submit_defence'));
  assert.equal(waiting.cards.find(c=>c.key==='discipline').tone,'is-due');
  // زميله لا يرى شيئًا من ذلك على صفحته.
  assert.equal(homeBoard(db,users.outsider).discipline,null);
  assert.ok(verifyAudit(db));
});

test('an approved class upgrade changes the tier in the insurance register, with an audit line and a notice that the insurer must still be told',t=>{
  const f=fixture(t);const {db,users,tx}=f;
  const {enrolmentId}=insurance(f);
  // السياسة المعتمدة يجب أن تجيز الترقية على حساب الموظف صراحة (المسودة المزروعة لا تجيزها).
  const draft=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='medical_insurance' AND status='draft'").get();
  assert.equal(myBenefits(db,users.employee).options.find(o=>o.key==='class_upgrade').available,false);
  tx(()=>proposeBenefit(db,users.hr,'medical_insurance',{version:draft.version,name:draft.name,summary:draft.summary,source_kind:'regulation',article:'م70',source_note:draft.source_note,
    rules:{},value_basis:'policy',value_params:{text:'تغطية طبية بحسب وثيقة المنشأة',upgrade_at_employee_cost:true},frequency:'policy_term',claim_method:'enrolment',documents:[],
    change_note:'أقر المالك السماح بترقية الفئة على حساب الموظف'}));
  const proposed=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='medical_insurance' AND status='draft'").get();
  tx(()=>decideBenefit(db,users.manager,proposed.id,'accept',{version:proposed.version,effective_from:day(-1),note:'قرار المالك المصطنع بتاريخ اليوم'}));

  const option=myBenefits(db,users.employee).options.find(o=>o.key==='class_upgrade');
  assert.deepEqual([option.available,option.current_tier],[true,'فئة ب']);
  const id=tx(()=>submitBenefitRequest(db,users.employee,{option:'class_upgrade',details:{target_tier:'فئة أ',consent:true}})).id;
  tx(()=>hrDecision(db,users.hr,id,'approve',{version:1,amount:'350.00',note:'فرق القسط من عرض الشركة'}));
  assert.equal(db.prepare('SELECT tier FROM medical_enrolments WHERE id=?').get(enrolmentId).tier,'فئة ب','the register does not move before the finance confirmation');
  const version=db.prepare('SELECT version FROM benefit_requests WHERE id=?').get(id).version;
  tx(()=>financeDecision(db,users.it,id,'approve',{version,note:'تأكيد مصطنع'}));

  const row=db.prepare('SELECT tier,version,status FROM medical_enrolments WHERE id=?').get(enrolmentId);
  assert.deepEqual([row.tier,row.status],['فئة أ','active'],'the enrolment now carries the upgraded class');
  const entry=db.prepare("SELECT * FROM audit_events WHERE action='benefits.class_upgraded' ORDER BY seq DESC LIMIT 1").get();
  assert.ok(entry,'the change leaves an audit line');
  assert.deepEqual([JSON.parse(entry.before_json).tier,JSON.parse(entry.after_json).tier],['فئة ب','فئة أ']);
  assert.equal(entry.actor_id,'it','recorded against whoever completed the chain');
  const told=notifications(db,users.employee).find(n=>n.kind==='benefit_class_upgraded');
  assert.ok(told,'the employee is told');
  assert.match(told.title,/سُجّلت ترقية فئة تأمينك إلى فئة أ/);
  assert.match(told.body,/شركة التأمين.*خارج المنصة/,'and told plainly that the insurer is still notified outside the platform');
  assert.equal(myBenefits(db,users.employee).insurance.tier,'فئة أ');
  const completed=myBenefits(db,users.employee).requests.find(r=>r.id===id);
  assert.deepEqual([completed.outcome.from_tier,completed.outcome.tier],['فئة ب','فئة أ']);
  assert.equal(completed.proposal.target,'payroll_deduction','the premium difference is still only a proposed deduction');
  // الموظف لا يرقّي فئته بنفسه ولو حمل تصريح المزايا، والقاعدة مفروضة في وحدة السجل نفسها.
  assert.ok(verifyAudit(db));
});
