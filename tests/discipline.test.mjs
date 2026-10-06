import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { decideAdjustment } from '../app/payroll-extras.mjs';
import { monthDeductions } from '../app/payroll-rules.mjs';
import { openInvestigationsFor } from '../app/resignations.mjs';
import { saveTemplate, approveTemplate, templatesBoard, lettersBoard, letterDocument, requestLetter } from '../app/letters.mjs';
import { listFiles, uploadFile } from '../app/files.mjs';
import { notifications } from '../app/workflow.mjs';
import { BASE_SCHEDULE_ID, prepareSchedule, decideSchedule, recordViolation, caseAction, getCase, disciplineBoard, myDiscipline, penaltySheet,
  addDaysExcludingHolidays, occurrenceOf, penaltyFor, parsePenalty, severity, addDays } from '../app/discipline.mjs';

// سجل المخالفات والجزاءات (P1-01، ترحيل 097). الأسماء والتواريخ والمبالغ مصطنعة.
const code=value=>error=>error.code===value;
const DAY=86400000;
const riyadh=ms=>new Date(ms+3*3600000).toISOString().slice(0,10);
const TEXT='نص تجريبي كافٍ الطول لأغراض الاختبار الآلي';
const NOTICE_TEMPLATE=`إشعار بجزاء تأديبي / Notice of a disciplinary penalty
رقم القضية {{case_reference}} — الموظف {{employee_name}}
المخالفة: {{violation_ar}} / Violation: {{violation_en}} — {{violation_date}}
السند: {{article}}
الجزاء: {{penalty_ar}} / Penalty: {{penalty_en}}
عند التكرار: {{repeat_penalty_ar}} / On repeat: {{repeat_penalty_en}}
لك التظلم خلال {{grievance_days}} يومًا.`;

function fixture(t,{accept=true,noticeTemplate=true,contract=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-discipline');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح تجريبي'}));
  // it = صاحب الصلاحية ومدير الموارد البشرية ومعتمد الرواتب؛ manager = مُصدِر الخطابات. hr يسجل ويحقق ويعد الرواتب بحكم دوره.
  for(const c of ['hr.discipline.decide','hr.policy.accept','payroll.approve','hr.contracts.approve'])grant('it',c);
  grant('manager','hr.letters.issue');
  const today=riyadh(Date.now());
  if(accept)tx(()=>decideSchedule(db,users.it,BASE_SCHEDULE_ID,'accept',{effective_from:'2024-01-01',note:'قبول تجريبي بعد مطابقة الجدول'}));
  if(noticeTemplate){
    tx(()=>saveTemplate(db,users.hr,'discipline_notice',{body:NOTICE_TEMPLATE}));
    const draft=templatesBoard(db,users.manager).types.find(x=>x.code==='discipline_notice').draft;
    tx(()=>approveTemplate(db,users.manager,'discipline_notice',{effective_from:today,note:'اعتماد تجريبي لنص الإشعار',version:draft.version}));
  }
  if(contract){
    const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));tx(()=>decidePolicy(db,users.it,id,'accept',{note:'اعتماد تجريبي للسياسة'}));};
    policy('pay_components',{components:['basic','housing','transport']});
    for(const user_id of ['employee','outsider']){
      const {id}=tx(()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,
        pay_lines:[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'1500.00'}],document_reference:'عقد مصطنع'}));
      tx(()=>contractAction(db,users.hr,id,'submit_contract',{version:getContract(db,users.hr,id).version}));
      tx(()=>contractAction(db,users.it,id,'approve_contract',{version:getContract(db,users.it,id).version}));
    }
  }
  const record=(input={},who='hr')=>tx(()=>recordViolation(db,users[who],{user_id:'employee',codes:['A01'],act_date:today,discovered_on:today,description:'تأخر تجريبي عن بداية الدوام',source_kind:'hr_observation',...input}));
  const act=(who,id,action,input={})=>tx(()=>caseAction(db,users[who],id,action,{version:getCase(db,users[who],id).version,...input}));
  // المسار المختصر للمخالفة البسيطة: استجواب شفهي بمحضر، ثم ثبوت، ثم قرار صاحب الصلاحية.
  const oralToProven=id=>{act('hr',id,'open_investigation',{process:'oral',minutes:'محضر استجواب شفهي تجريبي: أقر الموظف بالتأخر',questioned_on:today});act('hr',id,'conclude',{finding:'proven',note:TEXT});};
  const writtenToProven=(id,{defence=true}={})=>{act('hr',id,'open_investigation',{process:'written',charge_text:'اتهام كتابي تجريبي بالغياب دون إذن',charge_delivered_on:today});
    if(defence)act('employee',id,'submit_defence',{defence:'دفاع تجريبي مكتوب من الموظف'});
    act('hr',id,'record_hearing',{hearing_on:today,minutes:'محضر جلسة تحقيق تجريبي بأقوال الموظف'});act('hr',id,'conclude',{finding:'proven',note:TEXT});};
  const decideMax=id=>{const c=getCase(db,users.it,id);return act('it',id,'decide',{penalty:c.decision_options.choices[0].token,note:TEXT});};
  const notify=(id,method='hand',extra={})=>{act('manager',id,'issue_notice');return act('hr',id,'record_delivery',{method,delivered_on:today,...extra});};
  return {db,users,tx,today,grant,record,act,oralToProven,writtenToProven,decideMax,notify};
}

test('schedule: the regulation extract is seeded as a platform draft with every row cited, two flagged cells, and nothing applies until the HR manager accepts a company version',t=>{
  const {db,users,tx,today,record}=fixture(t,{accept:false,noticeTemplate:false,contract:false});
  const base=db.prepare('SELECT * FROM discipline_schedules WHERE id=?').get(BASE_SCHEDULE_ID),p=JSON.parse(base.parameters);
  assert.equal(base.status,'draft');assert.equal(base.tenant_id,null);assert.equal(base.prepared_by,null);
  assert.equal(p.rows.length,50);
  assert.deepEqual(['A','B','C'].map(x=>p.rows.filter(r=>r.table===x).length),[16,18,16],'16 working-time rows and 34 organisation and conduct rows');
  assert.ok(p.rows.every(r=>r.article_ar.includes('البند')&&Number.isInteger(r.page)&&r.page>=42&&r.page<=51),'every row cites its item and page');
  assert.deepEqual([p.repeat_window_days,p.fine_cap_days_per_violation,p.monthly_fine_cap_days,p.investigation_limit_days,p.decision_limit_days,p.grievance_filing_days,p.grievance_answer_days],[180,5,5,30,30,30,15]);
  assert.deepEqual(p.uncertain.map(u=>[u.id,u.rows]),[['U1',['A01','A02','A03','A04','A05']],['U2',['A11']]]);
  assert.deepEqual(p.rows.filter(r=>r.uncertain).map(r=>r.code),['A01','A02','A03','A04','A05','A11']);
  // جدول الوقت كما في اللائحة (§3.3 في REF-APP-WORKFLOWS)؛ ما خالفه التطبيق القديم هنا صريح: A01 الرابعة 20% لا 15%.
  const expected={A01:['warning','fine:500','fine:1000','fine:2000'],A02:['warning','fine:1500','fine:2500','fine:5000'],A03:['fine:1000','fine:1500','fine:2500','fine:5000'],A04:['fine:2500','fine:5000','fine:7500','fine:10000'],
    A05:['fine:2500','fine:5000','fine:7500','fine:10000'],A06:['fine:3000','fine:5000','fine:10000','fine:20000'],A07:['warning','fine:10000','fine:20000','fine:30000'],A08:['warning','fine:1000','fine:2500','fine:10000'],
    A09:['fine:1000','fine:2500','fine:5000','fine:10000'],A10:['warning','fine:1000','fine:2500','fine:10000'],A11:['fine:20000','fine:30000','fine:40000','deprivation'],A12:['fine:20000','fine:30000','fine:40000','deprivation'],
    A13:['fine:40000','fine:50000','deprivation','dismissal_award'],A14:['fine:50000','deprivation','dismissal_no_award',null],A15:['dismissal_no_award'],A16:['dismissal_no_award']};
  for(const [c,penalties] of Object.entries(expected))assert.deepEqual(p.rows.find(r=>r.code===c).penalties,penalties,c);
  assert.deepEqual(p.rows.find(r=>r.code==='B14').penalties,['fine:10000','fine:20000','deprivation','dismissal_award'],'tampering with attendance');
  assert.deepEqual(p.rows.find(r=>r.code==='C07').penalties,['fine:20000','fine:30000','fine:50000','dismissal_award'],'cash not handed over');
  assert.deepEqual(p.rows.find(r=>r.code==='C13').penalties,['dismissal_no_award']);
  // Art. 116: no row fines more than five days' wage.
  assert.ok(p.rows.flatMap(r=>r.penalties).filter(x=>x?.startsWith('fine:')).every(x=>Number(x.slice(5))<=50000));
  // غير فعال قبل القبول: لا تسجيل ولا اقتراح.
  assert.throws(()=>record(),code('schedule_required'));
  assert.throws(()=>tx(()=>decideSchedule(db,users.hr,BASE_SCHEDULE_ID,'accept',{effective_from:'2024-01-01',note:'قبول من غير المخول'})),code('not_permitted'));
  assert.throws(()=>db.prepare("UPDATE discipline_schedules SET title='تعديل صامت',version=version+1 WHERE id=?").run(BASE_SCHEDULE_ID),/never edited/);
  // نسخة الكيان: من يعدها لا يقبلها، والتعديل لا يتجاوز سقف م116.
  assert.throws(()=>tx(()=>prepareSchedule(db,users.hr,{source_id:BASE_SCHEDULE_ID,title:'نسخة',basis:'اللائحة المعتمدة رقم 351743',changes:[{code:'A01',occurrence:4,penalty:'fine:60000'}]})),code('penalty'));
  const {id}=tx(()=>prepareSchedule(db,users.hr,{source_id:BASE_SCHEDULE_ID,title:'نسخة الشركة',basis:'اللائحة المعتمدة رقم 351743',effective_from:'2024-01-01',
    changes:[{code:'A10',occurrence:4,penalty:'fine:5000'}],settings:{defence_wait_days:5},confirmations:{U2:'طابقنا الصفحة 44 من الملف الموقع: البند 11 يشمل حسم أجر اليوم'}}));
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.policy.accept',note:'تجريبي'}));
  assert.throws(()=>tx(()=>decideSchedule(db,users.hr,id,'accept',{effective_from:'2024-01-01',note:'أقبل ما أعددته بنفسي',version:1})),code('separation_of_duties'));
  assert.throws(()=>db.prepare("UPDATE discipline_schedules SET status='accepted',decided_by='hr',decided_at='x',effective_from='2024-01-01',version=version+1 WHERE id=?").run(id),/CHECK constraint/);
  tx(()=>decideSchedule(db,users.it,id,'accept',{effective_from:'2024-01-01',note:'قبول نسخة الشركة بعد المطابقة',version:1}));
  const board=disciplineBoard(db,users.hr);
  assert.equal(board.active_schedule.id,id);
  assert.equal(board.active_schedule.settings.defence_wait_days,5);
  assert.equal(board.active_schedule.uncertain.find(u=>u.id==='U2').confirmation.includes('الصفحة 44'),true);
  assert.equal(record().proposed.kind,'warning');
  assert.ok(verifyAudit(db));
  void today;
});

test('Art. 114: repeats are counted within 180 days of the previous same violation, and a gap of 181 days starts again at one',t=>{
  const {db,users,today,record,oralToProven,decideMax}=fixture(t);
  const run=(act_date,expectOccurrence,expectPenalty)=>{
    const r=record({act_date});
    assert.equal(r.violations[0].occurrence,expectOccurrence,`${act_date}`);assert.equal(r.violations[0].penalty,expectPenalty,`${act_date}`);
    oralToProven(r.id);decideMax(r.id);return r.id;
  };
  // أربع مرات بفاصل 100 يوم: إنذار ثم 5% ثم 10% ثم 20% من الأجر اليومي.
  const d1=addDays(today,-700);
  run(d1,1,'warning');run(addDays(d1,100),2,'fine:500');run(addDays(d1,200),3,'fine:1000');run(addDays(d1,300),4,'fine:2000');
  // الخامسة خلال 180 يومًا من الرابعة: تبقى العقوبة الرابعة (آخر خانة).
  run(addDays(d1,480),5,'fine:2000');
  // بعد 181 يومًا من السابقة: كأنها أولى.
  run(addDays(d1,661),1,'warning');
  // والفاصل 180 يومًا بالتمام تكرار.
  assert.equal(occurrenceOf(db,'36t','employee','A01',addDays(d1,841),180),2);
  assert.equal(occurrenceOf(db,'36t','employee','A01',addDays(d1,842),180),1);
  // بند آخر لا يُحسب تكرارًا لهذا البند.
  assert.equal(record({codes:['A08'],act_date:addDays(d1,662)}).violations[0].occurrence,1);
  // ومخالفة موظف آخر لا تُحسب على هذا الموظف.
  assert.equal(record({user_id:'outsider',act_date:addDays(d1,662)}).violations[0].occurrence,1);
  assert.ok(verifyAudit(db));void users;
});

test('Art. 114: only penalties that stand are counted — withdrawn, unproven and grievance-cancelled cases do not raise the next occurrence',t=>{
  const {db,users,today,record,act,oralToProven,decideMax,notify}=fixture(t);
  const a=record({act_date:addDays(today,-20)});
  // قضية مفتوحة تُحسب احتياطًا عند التسجيل، ويُعاد الحساب عند القرار بما حُسم فقط.
  const b=record({act_date:addDays(today,-10)});
  assert.equal(b.violations[0].occurrence,2,'an earlier open case counts provisionally');
  act('hr',a.id,'withdraw',{reason:'سحب تجريبي لعدم كفاية الدليل'});
  oralToProven(b.id);
  const options=getCase(db,users.it,b.id).decision_options;
  assert.equal(options.max.kind,'warning','the withdrawn case no longer counts, so the maximum falls back to occurrence 1');
  decideMax(b.id);notify(b.id);
  act('employee',b.id,'file_grievance',{body:'تظلم تجريبي: كان التأخر بسبب حادث طريق موثق'});
  act('it',b.id,'answer_grievance',{outcome:'upheld',answer:'قُبل التظلم لثبوت العذر المقبول'});
  assert.equal(record({act_date:today}).violations[0].occurrence,1,'a penalty cancelled on grievance is not a previous occurrence');
  assert.equal(penaltySheet(db,users.employee,'employee').rows[0].cancelled,true,'the sheet keeps it, marked cancelled');
});

test('Art. 115: one act that breaks several items gets only the harshest penalty, once',t=>{
  const {db,users,record,oralToProven,decideMax}=fixture(t);
  const r=record({codes:['A01','B04','B13'],description:'واقعة واحدة: تأخر ثم تدخل في عمل غيره وتسكع'});
  assert.equal(r.violations.length,3);
  assert.deepEqual(r.proposed.kind+':'+r.proposed.day_bp+':'+r.proposed.code,'fine:5000:B04');
  oralToProven(r.id);
  const decided=decideMax(r.id);
  assert.equal(decided.penalty,'fine:5000');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discipline_fines WHERE case_id=?').get(r.id).n,1,'one penalty, one fine');
  const c=getCase(db,users.employee,r.id);
  assert.equal(c.violations.length,3,'each item is still recorded against the act');
  assert.equal(c.effective.kind,'fine');
  assert.equal(severity(parsePenalty('fine:5000'))>severity(parsePenalty('warning')),true);
});

test('Art. 113: the authority may choose a lighter penalty with a written reason, never a harsher one',t=>{
  const {db,users,record,act,writtenToProven}=fixture(t);
  const r=record({codes:['A12'],description:'غياب متصل ثلاثة أيام دون إذن مكتوب'});
  assert.equal(r.proposed.kind,'fine');assert.equal(r.proposed.day_bp,20000);
  writtenToProven(r.id);
  const version=()=>getCase(db,users.it,r.id).version;
  assert.throws(()=>act('it',r.id,'decide',{penalty:'fine:30000',note:TEXT}),code('harsher_than_schedule'));
  assert.throws(()=>act('it',r.id,'decide',{penalty:'dismissal_award',note:TEXT}),code('harsher_than_schedule'));
  assert.throws(()=>act('it',r.id,'decide',{penalty:'fine:60000',note:TEXT}),code('penalty'),'Art. 116: no fine above five days');
  assert.throws(()=>act('it',r.id,'decide',{penalty:'warning',note:TEXT}),code('invalid_text'),'a lighter penalty needs its reason');
  const out=act('it',r.id,'decide',{penalty:'warning',note:TEXT,lighter_reason:'أول غياب وله ظرف عائلي موثق'});
  assert.equal(out.lighter,true);
  const c=getCase(db,users.employee,r.id);
  assert.equal(c.decided.kind,'warning');assert.equal(c.lighter_reason,'أول غياب وله ظرف عائلي موثق');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discipline_fines').get().n,0,'a warning records no fine');
  assert.ok(version()>1);
});

test('Arts. 117 and 126(1): above a one-day fine a written charge, hearing minutes and a defence (or its window) come before any finding; oral questioning is for minor penalties only',t=>{
  const {db,users,today,record,act}=fixture(t);
  const r=record({codes:['A12'],discovered_on:addDays(today,-5),act_date:addDays(today,-6)});
  assert.equal(getCase(db,users.hr,r.id).proposed.minor,false);
  assert.throws(()=>act('hr',r.id,'open_investigation',{process:'oral',minutes:'محضر شفهي لا يكفي هنا',questioned_on:today}),code('written_required'));
  assert.throws(()=>act('hr',r.id,'decide',{penalty:'warning',note:TEXT}),code('action_unavailable'),'nothing is decided before an investigation');
  act('hr',r.id,'open_investigation',{process:'written',charge_text:'اتهام كتابي تجريبي بالغياب',charge_delivered_on:today});
  assert.throws(()=>act('hr',r.id,'conclude',{finding:'proven',note:TEXT}),code('hearing_required'));
  act('hr',r.id,'record_hearing',{hearing_on:today,minutes:'محضر جلسة: سُمعت أقوال الموظف'});
  assert.throws(()=>act('hr',r.id,'conclude',{finding:'proven',note:TEXT}),code('defence_pending'),'the defence window has not passed');
  // الموظف يقدم دفاعه من صفحته، مرة واحدة، ولا يقدمه غيره.
  assert.ok(myDiscipline(db,users.employee).cases[0].actions.includes('submit_defence'));
  assert.throws(()=>act('hr',r.id,'submit_defence',{defence:'دفاع يكتبه غير صاحب الشأن'}),code('action_unavailable'));
  act('employee',r.id,'submit_defence',{defence:'كنت في المستشفى ومعي تقرير طبي'});
  assert.ok(!myDiscipline(db,users.employee).cases[0].actions.includes('submit_defence'));
  act('hr',r.id,'conclude',{finding:'proven',note:TEXT});
  assert.equal(getCase(db,users.employee,r.id).status,'proven');
  // بعد مهلة الدفاع يجوز الإنهاء دونه.
  const late=record({codes:['A12'],discovered_on:addDays(today,-5),act_date:addDays(today,-9)});
  act('hr',late.id,'open_investigation',{process:'written',charge_text:'اتهام كتابي تجريبي آخر',charge_delivered_on:addDays(today,-3)});
  act('hr',late.id,'record_hearing',{hearing_on:addDays(today,-1),minutes:'محضر جلسة: لم يحضر الموظف رغم تبليغه'});
  act('hr',late.id,'conclude',{finding:'proven',note:TEXT});
  // الشفهي للمخالفة البسيطة، مثبت في محضر إلزامي.
  const minor=record({codes:['A01']});
  assert.throws(()=>act('hr',minor.id,'open_investigation',{process:'oral',minutes:'',questioned_on:today}),code('invalid_text'));
  act('hr',minor.id,'open_investigation',{process:'oral',minutes:'محضر استجواب شفهي تجريبي',questioned_on:today});
  assert.equal(getCase(db,users.employee,minor.id).process,'oral');
  // مستوى قاعدة البيانات: المسار المكتوب بلا اتهام مرفوض.
  assert.throws(()=>db.prepare("UPDATE discipline_cases SET charge_text='',version=version+1 WHERE id=?").run(r.id),/CHECK constraint/);
});

test('Arts. 119 and 120: no investigation after 30 days from discovery and no penalty after 30 days from proof; both show countdowns and close as time-barred',t=>{
  const start=Date.now();
  t.mock.timers.enable({apis:['Date'],now:start});
  const {db,users,today,record,act,oralToProven}=fixture(t);
  assert.throws(()=>record({discovered_on:addDays(today,-31),act_date:addDays(today,-31)}),code('time_barred'));
  const edge=record({discovered_on:addDays(today,-30),act_date:addDays(today,-30)});
  assert.deepEqual(getCase(db,users.hr,edge.id).deadlines.map(d=>[d.key,d.article,d.days_left]),[['investigation','م119',0]]);
  const fresh=record({discovered_on:addDays(today,-2),act_date:addDays(today,-2)});
  assert.equal(getCase(db,users.hr,fresh.id).deadlines[0].days_left,28);
  const proven=record({discovered_on:today});oralToProven(proven.id);
  assert.deepEqual(getCase(db,users.it,proven.id).deadlines.map(d=>[d.key,d.article,d.days_left]),[['decision','م120',30]]);
  const board=disciplineBoard(db,users.hr);
  assert.equal(board.deadlines[0].case_id,edge.id,'the nearest limit comes first');
  // بعد يوم: مهلة البدء انقضت للأولى.
  t.mock.timers.setTime(start+DAY);
  let c=getCase(db,users.hr,edge.id);
  assert.equal(c.deadlines[0].overdue,true);
  assert.ok(!c.actions.includes('open_investigation'));assert.ok(c.actions.includes('close_lapsed'));
  assert.throws(()=>act('hr',edge.id,'open_investigation',{process:'oral',minutes:'محضر بعد انقضاء المهلة',questioned_on:riyadh(start+DAY)}),code('action_unavailable'));
  act('hr',edge.id,'close_lapsed',{reason:'انقضت مهلة بدء التحقيق دون إجراء'});
  assert.equal(getCase(db,users.employee,edge.id).status,'lapsed');
  // بعد 31 يومًا من الثبوت: لا قرار.
  t.mock.timers.setTime(start+31*DAY);
  c=getCase(db,users.it,proven.id);
  assert.ok(!c.actions.includes('decide'));
  assert.throws(()=>act('it',proven.id,'decide',{penalty:'warning',note:TEXT}),code('action_unavailable'));
  act('hr',proven.id,'close_lapsed',{reason:'انقضت مهلة توقيع الجزاء بعد الثبوت'});
  assert.equal(getCase(db,users.employee,proven.id).status,'lapsed');
  assert.throws(()=>db.prepare("UPDATE discipline_cases SET status='decided',version=version+1 WHERE id=?").run(proven.id),/never rewritten/);
});

test('separation of duties: nobody records against themselves, the recorder and the subject never decide, and the decider does not issue the notice',t=>{
  const {db,users,tx,grant,record,act,oralToProven}=fixture(t);
  assert.throws(()=>record({user_id:'hr'}),code('separation_of_duties'));
  assert.throws(()=>record({},'outsider'),code('not_permitted'),'a colleague cannot record');
  assert.throws(()=>record({user_id:'outsider'},'employee'),code('not_permitted'));
  // المدير المباشر يسجل على فريقه، ثم تحقق الموارد البشرية.
  const byManager=record({},'manager');
  assert.equal(getCase(db,users.manager,byManager.id).level,'manager');
  assert.throws(()=>record({user_id:'hr'},'manager'),code('not_permitted'),'a manager records only for their own team');
  // المسجِّل لا يقرر حتى لو مُنح التصريح.
  grant('hr','hr.discipline.decide');
  const r=record();oralToProven(r.id);
  assert.ok(!getCase(db,users.hr,r.id).actions.includes('decide'));
  assert.throws(()=>act('hr',r.id,'decide',{penalty:'warning',note:TEXT}),code('action_unavailable'));
  // صاحب الشأن لا يقرر في قضيته ولو حمل التصريح.
  grant('employee','hr.discipline.decide');
  assert.throws(()=>act('employee',r.id,'decide',{penalty:'warning',note:TEXT}),code('action_unavailable'));
  // الموظف الحامل لتصريح القرار لا يرى قضيته في لوحة غيره: يراها في صفحته.
  assert.ok(!disciplineBoard(db,users.employee).cases.some(c=>c.id===r.id));
  act('it',r.id,'decide',{penalty:'warning',note:TEXT});
  // من قرر لا يصدر الإشعار.
  grant('it','hr.letters.issue');
  assert.ok(!getCase(db,users.it,r.id).actions.includes('issue_notice'));
  // قاعدة البيانات تمنع أيضًا.
  assert.throws(()=>db.prepare("UPDATE discipline_cases SET decided_by=recorded_by,version=version+1 WHERE id=?").run(byManager.id),/CHECK constraint/);
  assert.throws(()=>tx(()=>db.prepare("INSERT INTO discipline_cases(id,tenant_id,reference,user_id,schedule_id,act_date,discovered_on,description,source_kind,recorded_by,proposed_penalty,status,created_at,updated_at) SELECT 'x','36t','D-X','employee',schedule_id,act_date,discovered_on,description,source_kind,'employee',proposed_penalty,'recorded',created_at,updated_at FROM discipline_cases LIMIT 1").run()),/CHECK constraint/);
});

test('Art. 121: the penalty notice is a bilingual HR-initiated letter; delivery is recorded by hand, registered mail or the contract email, and a refusal to sign needs a second delivery',t=>{
  const {db,users,today,record,act,oralToProven,decideMax}=fixture(t,{noticeTemplate:false});
  const r=record({codes:['A02']});oralToProven(r.id);decideMax(r.id);
  assert.throws(()=>act('manager',r.id,'issue_notice'),code('template_required'),'no approved notice template, no notice');
  tx2();
  function tx2(){
    transaction(db,()=>saveTemplate(db,users.hr,'discipline_notice',{body:NOTICE_TEMPLATE}));
    // عناصر الجزاء لا تُستعمل في نوع خطاب آخر.
    assert.throws(()=>transaction(db,()=>saveTemplate(db,users.hr,'employment',{body:'{{penalty_ar}}'})),code('placeholder_type'));
    const draft=templatesBoard(db,users.manager).types.find(x=>x.code==='discipline_notice').draft;
    transaction(db,()=>approveTemplate(db,users.manager,'discipline_notice',{effective_from:today,note:'اعتماد تجريبي لنص الإشعار',version:draft.version}));
  }
  // الموظف لا يطلب إشعار جزاء بنفسه.
  assert.ok(!lettersBoard(db,users.employee).types.some(x=>x.code==='discipline_notice'));
  assert.throws(()=>transaction(db,()=>requestLetter(db,users.employee,{type_code:'discipline_notice',purpose:'طلب تجريبي'})),code('not_found'));
  const issued=act('manager',r.id,'issue_notice');
  const doc=letterDocument(db,users.employee,issued.letter_id);
  assert.match(doc.body,/إنذار كتابي/);assert.match(doc.body,/Written warning/);
  assert.match(doc.body,/Late arrival of up to 15 minutes/);assert.match(doc.body,/غرامة 15% من الأجر اليومي/,'the notice states the penalty for a repeat');
  assert.match(doc.body,/30 يومًا/);assert.ok(!doc.body.includes('{{'));
  assert.equal(doc.prepared_by_name,users.it.name,'the decider is the author of the content');assert.equal(doc.issued_by_name,users.manager.name);
  // يراه صاحبه ومن يملك الإصدار؛ من يعد الخطابات فقط لا يراه، وغيرهما لا يعرف بوجوده.
  assert.ok(lettersBoard(db,users.employee).requests.some(x=>x.type_code==='discipline_notice'));
  assert.ok(!lettersBoard(db,users.hr).requests.some(x=>x.type_code==='discipline_notice'));
  assert.throws(()=>letterDocument(db,users.hr,issued.letter_id),code('not_found'));
  assert.throws(()=>letterDocument(db,users.outsider,issued.letter_id),code('not_found'));
  // الامتناع عن التوقيع: يبقى القرار دون إبلاغ حتى يُرسل بالبريد المسجل أو البريد الإلكتروني.
  assert.throws(()=>act('hr',r.id,'record_delivery',{method:'registered_mail',delivered_on:today}),code('invalid_text'),'registered mail needs its reference');
  assert.throws(()=>act('hr',r.id,'record_delivery',{method:'contract_email',delivered_on:today,reference:'MSG-1',refused_to_sign:true}),code('refused_to_sign'));
  act('hr',r.id,'record_delivery',{method:'hand',delivered_on:today,refused_to_sign:true});
  let c=getCase(db,users.employee,r.id);
  assert.equal(c.status,'decided');assert.equal(c.delivery.refused_to_sign,true);assert.ok(!c.actions.includes('file_grievance'));
  act('hr',r.id,'record_delivery',{method:'registered_mail',delivered_on:today,reference:'RR123456789SA'});
  c=getCase(db,users.employee,r.id);
  assert.equal(c.status,'notified');assert.equal(c.notified_on,today);assert.equal(c.delivery.method,'registered_mail');
  assert.deepEqual(c.deadlines.map(d=>d.key),['grievance_filing']);
});

test('Art. 126: the grievance window is 30 days excluding official holidays, the answer is due in 15, the outcome is never harsher, and filing pauses the payroll deduction',t=>{
  const start=Date.now();
  t.mock.timers.enable({apis:['Date'],now:start});
  const {db,users,today,record,act,oralToProven,writtenToProven,decideMax,notify}=fixture(t);
  // عطلتان رسميتان معتمدتان داخل المهلة تمددانها يومين؛ الجمعة والسبت لا تُستبعدان.
  for(const [i,d] of [[1,addDays(today,5)],[2,addDays(today,12)]])db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,'عطلة تجريبية','تعميم تجريبي لعطلة رسمية','approved','hr','it',?,?)").run('h'+i,d,new Date().toISOString(),new Date().toISOString());
  const holidays=new Set([addDays(today,5),addDays(today,12)]);
  assert.equal(addDaysExcludingHolidays(today,30,holidays),addDays(today,32));
  assert.equal(addDaysExcludingHolidays(today,30,new Set()),addDays(today,30));
  const r=record({codes:['A12'],description:'غياب متصل يومين دون إذن'});writtenToProven(r.id);decideMax(r.id);notify(r.id);
  let c=getCase(db,users.employee,r.id);
  assert.equal(c.deadlines[0].due_on,addDays(today,32));assert.equal(c.deadlines[0].days_left,32);
  // الغرامة أجر يومين: تُقترح على المسير ثم يُقدم التظلم فيتوقف ما لم يُقترح.
  // لا تظلم بعد انقضاء المهلة.
  t.mock.timers.setTime(start+33*DAY);
  assert.ok(!getCase(db,users.employee,r.id).actions.includes('file_grievance'));
  assert.throws(()=>act('employee',r.id,'file_grievance',{body:'تظلم متأخر عن المهلة'}),code('action_unavailable'));
  t.mock.timers.setTime(start+32*DAY);
  assert.ok(getCase(db,users.employee,r.id).actions.includes('file_grievance'),'the last day counts');
  t.mock.timers.setTime(start);
  // تقديم التظلم يوقف اقتراح الخصم.
  assert.ok(getCase(db,users.hr,r.id).actions.includes('propose_deduction'));
  act('employee',r.id,'file_grievance',{body:'تظلم تجريبي: الغياب كان بعذر طبي مرفق'});
  c=getCase(db,users.employee,r.id);
  assert.equal(c.grievance.answer_due_on,addDays(today,17),'15 days plus the two holidays inside the window');
  assert.ok(!getCase(db,users.hr,r.id).actions.includes('propose_deduction'));
  assert.throws(()=>act('hr',r.id,'propose_deduction',{month:today.slice(0,7)}),code('action_unavailable'));
  // نص التظلم لصاحب الصلاحية وصاحبه فقط.
  assert.equal(getCase(db,users.hr,r.id).grievance,undefined,'HR staff without the decide capability see only that a grievance exists');
  assert.equal(getCase(db,users.hr,r.id).grievance_status,'filed');
  assert.equal(getCase(db,users.manager,r.id).grievance,undefined);
  assert.throws(()=>getCase(db,users.outsider,r.id),code('not_found'));
  assert.equal(getCase(db,users.it,r.id).grievance.body.includes('عذر طبي'),true);
  // النتيجة لا تكون أشد: التخفيف أخف حتمًا.
  assert.throws(()=>act('it',r.id,'answer_grievance',{outcome:'reduced',answer:'تخفيف غير صحيح',penalty:'fine:30000'}),code('not_lighter'));
  assert.throws(()=>act('it',r.id,'answer_grievance',{outcome:'reduced',answer:'تخفيف غير صحيح',penalty:'fine:20000'}),code('not_lighter'));
  assert.throws(()=>act('employee',r.id,'answer_grievance',{outcome:'upheld',answer:'أقبل تظلمي بنفسي'}),code('action_unavailable'));
  assert.throws(()=>act('hr',r.id,'answer_grievance',{outcome:'rejected',answer:'رد من غير صاحب الصلاحية'}),code('action_unavailable'));
  act('it',r.id,'answer_grievance',{outcome:'reduced',answer:'خُفف الجزاء لوجود عذر جزئي',penalty:'fine:10000'});
  c=getCase(db,users.employee,r.id);
  assert.equal(c.effective.day_bp,10000);assert.equal(c.grievance.outcome,'reduced');
  assert.equal(db.prepare('SELECT day_bp FROM discipline_fines WHERE case_id=?').get(r.id).day_bp,10000);
  assert.throws(()=>db.prepare('UPDATE discipline_fines SET day_bp=40000,version=version+1 WHERE case_id=?').run(r.id),/only be reduced/);
  // الرفض يذكر حق المحكمة العمالية.
  const second=record({codes:['A01']});oralToProven(second.id);decideMax(second.id);notify(second.id);
  act('employee',second.id,'file_grievance',{body:'تظلم تجريبي ثانٍ على الإنذار'});
  act('it',second.id,'answer_grievance',{outcome:'rejected',answer:'ثبت التأخر ولا عذر مقبول'});
  assert.match(getCase(db,users.employee,second.id).grievance.court_note,/المحكمة العمالية/);
  // إشعار بكل خطوة، بلا مبالغ.
  const notes=db.prepare("SELECT * FROM notifications WHERE user_id='employee' AND subject_kind='discipline_case'").all();
  for(const kind of ['discipline_recorded','discipline_charge','discipline_hearing','discipline_proven','discipline_decided','discipline_notice_issued','discipline_notified','discipline_grievance_filed','discipline_grievance_answered'])assert.ok(notes.some(n=>n.kind===kind),kind);
  assert.ok(notes.every(n=>!/ريال|SAR|\d+\.\d\d/.test(n.title+n.body)),'no amounts in notifications');
  const listed=notifications(db,users.employee).filter(n=>n.subject_kind==='discipline_case');
  assert.ok(listed.length&&listed.every(n=>n.link==='#my-discipline'));
});

test('payroll: a decided fine reaches payroll only as a proposed deduction, capped at five days’ wage a month, and never approved by the platform',t=>{
  const {db,users,today,record,act,writtenToProven,decideMax,notify,oralToProven}=fixture(t);
  const month=today.slice(0,7),next=addDays(today.slice(0,8)+'01',40).slice(0,7);
  // غرامتان: أجر أربعة أيام (A12 الثالثة) وأجر يومين.
  const fine=(days)=>{const r=record({codes:['A12'],description:'غياب متصل دون إذن'});writtenToProven(r.id);
    const c=getCase(db,users.it,r.id),token=`fine:${days*10000}`;act('it',r.id,'decide',{penalty:token,note:TEXT,...(c.decision_options.max.day_bp!==days*10000?{lighter_reason:'تخفيف تجريبي لاختبار السقف'}:{})});notify(r.id);return r.id;};
  const a=fine(2),b=fine(2),c=fine(2);
  assert.equal(openInvestigationsFor(db,'36t','employee').filter(x=>x.source==='discipline_cases').length,0,'integration: a notified case no longer holds a resignation (102)');
  assert.throws(()=>act('employee',a,'propose_deduction',{month}),code('action_unavailable'));
  assert.throws(()=>act('it',a,'propose_deduction',{month}),code('action_unavailable'),'the payroll approver does not propose');
  const first=act('hr',a,'propose_deduction',{month});
  assert.equal(first.day_bp,20000);assert.equal(first.remaining_bp,0);
  const adj=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(first.adjustment_id);
  assert.equal(adj.status,'proposed');assert.equal(adj.kind,'deduction');assert.equal(adj.user_id,'employee');
  // الأجر اليومي = (6000 + 1500 + 1500) ÷ 30 = 300 ريال؛ يومان = 600 ريال.
  assert.equal(adj.amount_minor,60000);
  assert.match(adj.reason,/صندوق منفعة العمال/);
  // دمج 20260919: الغرامة مصنفة «fine» فيراها سقف م116 في قواعد الرواتب (102) مع أي غرامة أخرى.
  assert.equal(db.prepare('SELECT class,source_kind,source_id FROM payroll_adjustment_classes WHERE adjustment_id=?').get(first.adjustment_id).class,'fine');
  assert.equal(monthDeductions(db,'36t','employee',month,['proposed']).fines_minor,60000);
  act('hr',b,'propose_deduction',{month});
  // الثالثة: يتسع السقف ليوم واحد فقط، والباقي لشهر لاحق.
  const partial=act('hr',c,'propose_deduction',{month});
  assert.equal(partial.day_bp,10000);assert.equal(partial.remaining_bp,10000);
  const d=fine(1);
  assert.throws(()=>act('hr',d,'propose_deduction',{month}),code('monthly_fine_cap'));
  assert.equal(act('hr',c,'propose_deduction',{month:next}).day_bp,10000);
  assert.ok(!getCase(db,users.hr,c).actions.includes('propose_deduction'),'fully proposed');
  // لا شيء معتمد حتى يقرر معتمد الرواتب، ولا يعتمد من اقترح.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payroll_adjustments WHERE status<>'proposed'").get().n,0,'the platform approved nothing');
  assert.throws(()=>transaction(db,()=>decideAdjustment(db,users.hr,first.adjustment_id,'approve',{note:'اعتماد من المقترح'})),code('not_permitted'));
  transaction(db,()=>decideAdjustment(db,users.it,first.adjustment_id,'reject',{note:'رفض تجريبي لإعادة الحساب'}));
  // الحركة المرفوضة تعيد الغرامة للسجل غير المقترح وتفرغ مكانها من سقف الشهر.
  assert.ok(getCase(db,users.hr,a).actions.includes('propose_deduction'));
  // سجل الغرامات: التزام لصندوق منفعة العمال لا إيراد.
  const register=disciplineBoard(db,users.it).fines;
  assert.equal(register.fund,'workers_benefit_fund');assert.equal(register.rows.length,4);
  assert.ok(register.rows.every(r=>r.fund==='workers_benefit_fund'));
  assert.equal(register.liability_minor,0,'nothing is collected until a payroll run is approved');
  // الإنذار لا يصل المسير.
  const w=record({codes:['A01']});oralToProven(w.id);decideMax(w.id);notify(w.id);
  assert.ok(!getCase(db,users.hr,w.id).actions.includes('propose_deduction'));
  // صحيفة الجزاءات (م122) للموظف نفسه وللموارد البشرية، لا لزميله.
  assert.equal(penaltySheet(db,users.employee,'employee').rows.length,5);
  assert.throws(()=>penaltySheet(db,users.outsider,'employee'),code('not_found'));
  assert.throws(()=>penaltySheet(db,users.manager,'employee'),code('not_found'));
  assert.ok(verifyAudit(db));
});

test('no automatic penalty: attendance days are evidence only, a late day never opens a case by itself, and absence items need a confirmed unpaid absence',t=>{
  const {db,users,tx,today,record}=fixture(t);
  const {id}=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات العمل',body:'نص سياسة ساعات العمل المصطنع لأغراض الاختبار الآلي فقط.',basis:'اللائحة م73 — قرار مصطنع',effective_from:'2020-01-01',parameters:{workdays:[0,1,2,3,4,5,6],start:'08:00',end:'16:00',grace_minutes:0}}));
  tx(()=>decidePolicy(db,users.it,id,'accept',{note:'اعتماد تجريبي للسياسة'}));
  const day=addDays(today,-3),iso=(d,clock)=>new Date(`${d}T${clock}:00+03:00`).toISOString();
  db.prepare("INSERT INTO attendance_records VALUES('ar1','36t','employee',?,?,?,'self',?,?)").run(day,iso(day,'08:10'),iso(day,'16:00'),iso(day,'16:00'),iso(day,'16:00'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discipline_cases').get().n,0,'a late day creates nothing');
  assert.equal(disciplineBoard(db,users.hr).cases.length,0);
  const r=record({codes:['A01'],act_date:day,source_kind:'attendance_day',source_ref:day});
  const c=getCase(db,users.hr,r.id);
  assert.equal(c.source_snapshot.state,'late');assert.equal(c.source_snapshot.check_in,'08:10');
  assert.equal(c.status,'recorded','recorded is not a penalty');assert.equal(c.decided,null);
  assert.throws(()=>record({codes:['A11'],act_date:day,source_kind:'attendance_day',source_ref:day}),code('attendance_day'),'absence items need a confirmed unpaid absence');
  const blank=addDays(today,-4);
  assert.throws(()=>record({codes:['A11'],act_date:blank,source_kind:'attendance_day',source_ref:blank}),code('attendance_day'),'an unexplained day is not an absence (HR-03)');
  assert.throws(()=>record({codes:['A01'],act_date:blank,source_kind:'attendance_day',source_ref:blank}),code('attendance_day'));
  assert.throws(()=>record({codes:['A01'],act_date:day,source_kind:'attendance_day',source_ref:blank}),code('source_ref'));
  // حتى بعد القرار لا تُعتمد حركة رواتب ولا يتغير العقد.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustments').get().n,0);
});

test('privacy: the employee alone sees their case in full; colleagues learn nothing, the manager sees a summary, and evidence follows the case',t=>{
  const {db,users,tx,record,act,oralToProven,decideMax,notify}=fixture(t);
  const r=record({codes:['C11'],description:'إساءة لفظية تجريبية لزميل في اجتماع'});
  act('hr',r.id,'open_investigation',{process:'written',charge_text:'اتهام كتابي تجريبي بالإساءة',charge_delivered_on:riyadh(Date.now())});
  act('employee',r.id,'submit_defence',{defence:'دفاع تجريبي سري لا يراه الزملاء'});
  // الزميل: لا لوحة، ولا قضية، ولا ملفات، وصفحته خالية.
  assert.throws(()=>disciplineBoard(db,users.outsider),code('not_permitted'));
  assert.throws(()=>getCase(db,users.outsider,r.id),code('not_found'));
  assert.throws(()=>listFiles(db,users.outsider,'discipline_case',r.id),code('not_found'));
  assert.equal(myDiscipline(db,users.outsider).cases.length,0);
  assert.ok(!JSON.stringify(myDiscipline(db,users.outsider)).includes(r.id));
  // الكيان المعزول لا يرى شيئًا.
  assert.throws(()=>getCase(db,users.external,r.id),code('not_found'));
  // صاحب الشأن يرى كل شيء، ولا يرى لوحة غيره.
  const mine=myDiscipline(db,users.employee).cases[0];
  assert.equal(mine.defence_text,'دفاع تجريبي سري لا يراه الزملاء');assert.equal(mine.charge_text,'اتهام كتابي تجريبي بالإساءة');
  assert.throws(()=>disciplineBoard(db,users.employee),code('not_permitted'));
  assert.ok(listFiles(db,users.employee,'discipline_case',r.id));
  assert.equal(listFiles(db,users.employee,'discipline_case',r.id).can_upload,false);
  assert.equal(listFiles(db,users.hr,'discipline_case',r.id).can_upload,true);
  // دمج 20260919 (ترحيل 104): discipline_case مسجل في stored_file_entity_types، فيُقبل رفع الدليل فعلًا لا الصلاحية وحدها.
  tx(()=>uploadFile(db,users.hr,{entity_type:'discipline_case',entity_id:r.id,label:'دليل تجريبي على القضية',filename:'evidence.pdf',content:Buffer.from('%PDF-1.4 synthetic evidence').toString('base64')}));
  assert.equal(listFiles(db,users.employee,'discipline_case',r.id).files.length,1);
  // المدير المباشر: ملخص بلا نصوص ولا دفاع ولا ملفات.
  const summary=getCase(db,users.manager,r.id);
  assert.equal(summary.level,'manager');
  for(const key of ['description','charge_text','defence_text','hearing_minutes','events','grievance'])assert.equal(summary[key],undefined,key);
  assert.throws(()=>listFiles(db,users.manager,'discipline_case',r.id),code('not_found'));
  assert.ok(!JSON.stringify(disciplineBoard(db,users.manager)).includes('دفاع تجريبي سري'));
  // المبالغ لمن يملكها فقط: صاحب الصلاحية والرواتب.
  act('hr',r.id,'record_hearing',{hearing_on:riyadh(Date.now()),minutes:'محضر جلسة تجريبي'});act('hr',r.id,'conclude',{finding:'proven',note:TEXT});decideMax(r.id);notify(r.id);
  const board=disciplineBoard(db,users.manager);
  assert.equal(board.fines,null,'the notice issuer does not see the fines register');
  assert.ok(board.cases.every(c=>c.description===undefined));
  // التدقيق لا يحمل وصف الواقعة ولا الدفاع.
  const trail=JSON.stringify(db.prepare("SELECT before_json,after_json,reason FROM audit_events WHERE entity_type='discipline_case'").all());
  assert.ok(!trail.includes('إساءة لفظية')&&!trail.includes('دفاع تجريبي'));
  void oralToProven;
});

test('penalty helpers: labels, occurrence tiers past the last cell, and the empty fourth cell',()=>{
  const row={penalties:['fine:30000','fine:50000','dismissal_award',null]};
  assert.equal(penaltyFor(row,3).kind,'dismissal_award');
  assert.equal(penaltyFor(row,4).kind,'dismissal_award','an empty cell keeps the last scheduled penalty');
  assert.equal(penaltyFor({penalties:['dismissal_no_award']},3).kind,'dismissal_no_award');
  assert.throws(()=>parsePenalty('fine:0'),code('penalty'));
  assert.throws(()=>parsePenalty('fine'),code('penalty'));
  assert.ok(severity(parsePenalty('fine:50000'))<severity(parsePenalty('deprivation')));
  assert.ok(severity(parsePenalty('warning'))<severity(parsePenalty('fine:1')));
});

// دمج 20260919: قضية الانضباط المفتوحة تحجب الاستقالة وتعلّق قبولها (م37(5) عبر resignations.mjs، 102)، والمسحوبة لا.
test('integration: an open discipline case counts as an open investigation for the resignation clock, and a withdrawn one does not',t=>{
  const {db,record,act}=fixture(t);
  const r=record({codes:['C11'],description:'واقعة تجريبية مفتوحة للتحقيق'});
  assert.deepEqual(openInvestigationsFor(db,'36t','employee').filter(x=>x.source==='discipline_cases').map(x=>x.id),[r.id]);
  act('hr',r.id,'withdraw',{reason:'سحب تجريبي لاختبار ساعة الاستقالة'});
  assert.equal(openInvestigationsFor(db,'36t','employee').filter(x=>x.source==='discipline_cases').length,0);
});

test('مرجع القضية يُشتق من أعلى رقم مستعمل، فلا تعيده فجوة في التسلسل إلى رقم سبق أن استُعمل',t=>{
  const {db,users,tx,today,record}=fixture(t);
  const year=today.slice(0,4);
  const first=record();
  assert.equal(first.reference,`D-${year}-0001`);
  // فجوة: صفٌّ برقم خارج التتابع، كما قد يُدخله مسار استيراد أو ترحيل بيانات لاحقًا.
  // لا حذف هنا — حارس discipline_cases_no_delete قائم — فالفجوة تأتي من الإدخال لا من الحذف.
  tx(()=>db.prepare(`INSERT INTO discipline_cases(id,tenant_id,reference,user_id,schedule_id,act_date,discovered_on,description,source_kind,recorded_by,proposed_penalty,status,created_at,updated_at)
    SELECT 'gap','36t',?,user_id,schedule_id,act_date,discovered_on,description,source_kind,recorded_by,proposed_penalty,'recorded',created_at,updated_at FROM discipline_cases WHERE id=?`).run(`D-${year}-0005`,first.id));
  // بالعدّ كان يخرج 0003 (ثلاث قضايا)، وهو رقم يتعارض مع ما بعده ويكسر ترتيب المراجع.
  assert.equal(record().reference,`D-${year}-0006`);
  assert.equal(verifyAudit(db),true);
});
