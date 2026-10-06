import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { proposeTravel, travelAction, travelBoard } from '../app/travel.mjs';
import { jobGrades, recordEmployeeGrade, gradeOf, allowanceVersions, versionInForce, activateAllowanceVersion, perDiemBreakdown, perDiemFor,
  recordAttestation, overtimeOverlap, recordTicket, ticketsOf, secondmentBoard, openDecisions, sharedEligibility, saveBenefitSettings, setGradeCap,
  submitParentsInsurance, hrQuoteParents, consentToDeduction, authorityApproveParents, submitEducationClaim, submitSportsClaim, sportsBalance,
  hrDecideClaim, financeCompleteClaim, handExtraToPayroll, benefitExtrasBoard, money } from '../app/secondment-benefits.mjs';

const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const CIRCULAR_FROM='2026-06-01';

// كيان اختبار مصطنع: موظفة بعقد ساري اجتازت التجربة، وتقييم أداء صادر، ودرجة وظيفية مسجلة.
function fixture(t,{appraisalPercent=85,employmentType='full_time',probationDays=90,grade='D',contractStart='2024-01-01'}={}){
  const db=openDb(':memory:');seed(db,'synthetic-secondment-benefits');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=run=>transaction(db,run);
  const grant=(who,capability)=>tx(()=>grantAccess(db,users.admin,{user_id:who,capability,department_id:null,note:'تصريح مصطنع لاختبار التعميم والمزايا'}));
  // مدير الموارد البشرية المعتمِد وصاحب الصلاحية: manager. التأكيد المالي: it. المزايا ومُعد الرواتب: hr (بدوره).
  for(const c of ['hr.policy.accept','hr.contracts.approve'])grant('manager',c);
  grant('it','benefits.finance.confirm');
  const time=now();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pol-pay','36t','pay_components','بنود الراتب','سياسة بنود راتب مصطنعة للاختبار الآلي فقط','{\"components\":[\"basic\",\"housing\"]}','مصدر مصطنع','2019-01-01','accepted','hr','manager',?,?)").run(time,time);
  const lines=[{component:'basic',amount_minor:1000000},{component:'housing',amount_minor:250000}];
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('c-employee','36t','employee','pol-pay','indefinite','وظيفة مصطنعة','الرياض',?,40,?,30,?,1250000,'SAR','عقد مصطنع','active','hr','manager',?,?,?)")
    .run(contractStart,probationDays,JSON.stringify(lines),time,time,time);
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,status,updated_by,updated_at) VALUES('employee','36t','وظيفة مصطنعة',?,?,'active','hr',?)").run(employmentType,contractStart,time);
  if(appraisalPercent!==null){
    db.prepare("INSERT INTO review_cycles(id,tenant_id,name,period_from,period_to,scale_max,criteria,status,created_by,released_by,released_at,created_at,updated_at) VALUES('cyc-1','36t','دورة تقييم مصطنعة','2025-01-01','2025-12-31',5,'[]','released','hr','manager',?,?,?)").run(time,time,time);
    // درجة وحدة الأداء رقم على سلم الدورة ×100؛ سلم 5 فالنسبة المئوية × 5 تعطي الدرجة (85% ← 4.25 ← 425).
    db.prepare("INSERT INTO performance_reviews(id,tenant_id,cycle_id,user_id,reviewer_id,status,final_score_bp,created_at,updated_at) VALUES('rev-1','36t','cyc-1','employee','manager','released',?,?,?)").run(appraisalPercent*5,time,time);
  }
  if(grade)tx(()=>recordEmployeeGrade(db,users.hr,{user_id:'employee',grade_code:grade,note:'درجة مصطنعة للاختبار'}));
  // جدول بدل الانتداب في سياسات اللائحة (الترحيل 102) يُقبل أولًا: بدونه لا يُحسب بدل أصلًا.
  const acceptTravelRule=()=>tx(()=>decideRule(db,users.manager,'reg-seed-travel','accept',{effective_from:'2019-01-01',choices:{},note:'طابقت قيم م65 مع اللائحة الموقعة (اختبار مصطنع)'}));
  const circularId='36t-sec-circ';
  const versionRow=id=>db.prepare('SELECT * FROM secondment_allowance_versions WHERE id=?').get(id);
  const activateCircular=(from=CIRCULAR_FROM)=>tx(()=>activateAllowanceVersion(db,users.manager,circularId,{version:versionRow(circularId).version,effective_from:from,note:'قرار الإدارة رقم مصطنع بتاريخ سريان التعميم'}));
  const view=id=>travelBoard(db,users.manager).decisions.find(x=>x.id===id);
  const propose=extra=>tx(()=>proposeTravel(db,users.employee,{task:'مهمة ميدانية مصطنعة لدى العميل',destination:'الدمام',scope:'domestic',start_date:day(5),end_date:day(7),...extra})).id;
  const attest=id=>tx(()=>recordAttestation(db,users.manager,id,{statement:'لا يوجد في منطقة المهمة موظف يستطيع أداءها؛ راجعت فريق المنطقة قبل الترشيح.'}));
  const approve=(id,values)=>tx(()=>travelAction(db,users.manager,id,'approve_travel',{version:view(id).version,...values}));
  const extra=id=>db.prepare('SELECT * FROM benefit_extra_requests WHERE id=?').get(id);
  return {db,users,tx,grant,acceptTravelRule,activateCircular,circularId,versionRow,view,propose,attest,approve,extra};
}

test('job grades are reference data with the naming conflict on the record, and the open decisions are surfaced instead of assumed',t=>{
  const {db,users}=fixture(t);
  const grades=jobGrades(db);
  assert.deepEqual(grades.map(g=>g.code),['A','B','C','D']);
  assert.deepEqual(grades.map(g=>g.travel_grade),['ceo','deputy','gm','employee']);
  const c=grades.find(g=>g.code==='C');
  assert.ok(c.name_ar.includes('مدراء الإدارات')&&c.name_ar.includes('مدراء العموم'));
  assert.ok(c.needs_confirmation,'the C-grade naming needs the owner to confirm the two names are one grade');
  assert.ok(grades.find(g=>g.code==='B').needs_confirmation,'the VP ticket class is a conflict, not a decision the platform makes');
  assert.equal(gradeOf(db,'36t','employee'),'D');
  assert.equal(gradeOf(db,'36t','outsider'),null,'no grade is assumed for anyone');
  const keys=openDecisions(db,'36t').map(d=>d.key);
  assert.deepEqual(keys.sort(),['benefits_deck_links','circular_effective_from','deputy_ticket_class','education_amounts','grade_c_naming','parents_year_basis'].sort());
  const deck=openDecisions(db,'36t').find(d=>d.key==='benefits_deck_links');
  assert.match(deck.detail,/موقع جهة أخرى/,'the deck points at another entity\'s site; its links are not used');
  assert.ok(secondmentBoard(db,users.manager).grades.length===4);
  // المزايا الثلاث في كتالوج المزايا: مسودات تستشهد بمصدرها وتحمل الأهلية المشتركة، ولا تُعد استحقاقًا قبل الاعتماد.
  const catalog=db.prepare("SELECT benefit_key,name,status,source_kind,rules,source_note FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key IN ('parents_insurance','children_education','gym') ORDER BY benefit_key").all();
  assert.equal(catalog.length,3);
  assert.ok(catalog.every(r=>r.status==='draft'),'the three stay drafts until the HR manager accepts them');
  assert.ok(catalog.every(r=>r.source_kind==='needs_matrix'&&r.source_note.includes('عرض المزايا الداخلي')));
  assert.ok(catalog.every(r=>JSON.parse(r.rules).past_probation===true&&JSON.parse(r.rules).employment_types[0]==='full_time'));
  assert.ok(catalog.every(r=>JSON.parse(r.rules).min_tenure_months===6),'the old app\'s six months stays on the card until the owner decides; the request gate is the shared rule');
  assert.ok(catalog.every(r=>r.source_note.includes('موقع جهة أخرى')),'the deck\'s links are recorded as unused on every one of them');
  assert.equal(catalog.find(r=>r.benefit_key==='gym').name,'الأندية الصحية والأجهزة الرياضية');
  assert.ok(verifyAudit(db));
});

test('the circular is a new dated version: it cannot be activated until the effective date is entered, and the regulation version expires the day before',t=>{
  const {db,users,tx,circularId,versionRow,activateCircular}=fixture(t);
  const before=allowanceVersions(db,'36t');
  assert.deepEqual(before.map(v=>[v.code,v.status]).sort(),[['circular','draft'],['regulation_art65','active']].sort());
  const draft=before.find(v=>v.code==='circular');
  assert.equal(draft.effective_from,null);
  assert.match(draft.pending_note,/لا يذكر تاريخ سريان/);
  assert.throws(()=>tx(()=>activateAllowanceVersion(db,users.manager,circularId,{version:versionRow(circularId).version,effective_from:'',note:'محاولة تفعيل بلا تاريخ سريان'})),
    code('effective_from_required'),'the circular states no date, so activation is blocked until the admin enters one');
  assert.throws(()=>tx(()=>activateAllowanceVersion(db,users.hr,circularId,{version:versionRow(circularId).version,effective_from:CIRCULAR_FROM,note:'تفعيل من غير مدير الموارد البشرية'})),
    code('not_permitted'));
  activateCircular();
  const after=allowanceVersions(db,'36t');
  const regulation=after.find(v=>v.code==='regulation_art65'),circular=after.find(v=>v.code==='circular');
  assert.deepEqual([regulation.status,regulation.effective_to],['expired','2026-05-31'],'the old table is kept as an expired version, not deleted');
  assert.deepEqual([circular.status,circular.effective_from],['active','2026-06-01']);
  assert.equal(regulation.superseded_by,circular.id);
  // اختيار النسخة بالتاريخ: يوم قبل السريان يقرأ الجدول القديم، ويوم السريان يقرأ الجديد.
  assert.equal(versionInForce(db,'36t','2026-05-31').code,'regulation_art65');
  assert.equal(versionInForce(db,'36t','2026-06-01').code,'circular');
  assert.equal(versionInForce(db,'36t','2026-05-31').grades.gm.domestic_minor,60000);
  assert.equal(versionInForce(db,'36t','2026-06-01').grades.gm.domestic_minor,90000);
  assert.deepEqual(Object.fromEntries(Object.entries(versionInForce(db,'36t','2026-06-01').grades).map(([k,g])=>[k,[g.domestic_minor,g.abroad_minor]])),
    {ceo:[210000,250000],deputy:[100000,150000],gm:[90000,120000],employee:[70000,90000]},'grade A stays on the Art. 65 values because the circular is silent');
  assert.deepEqual(Object.fromEntries(Object.entries(versionInForce(db,'36t','2026-06-01').grades).map(([k,g])=>[k,g.ticket_class])),
    {ceo:'first',deputy:'business',gm:'business',employee:'economy'});
  assert.match(versionInForce(db,'36t','2026-06-01').grades.deputy.ticket_class_conflict,/الدرجة الأولى/,'the VP conflict is recorded on the row, defaulting to the circular');
  assert.throws(()=>tx(()=>activateAllowanceVersion(db,users.manager,circularId,{version:versionRow(circularId).version,effective_from:'2027-01-01',note:'محاولة تفعيل ثانية للنسخة نفسها'})),code('action_unavailable'));
  assert.ok(verifyAudit(db));
});

test("the owner's worked case: a grade D employee, 4 days outside the Kingdom, housing provided only = 4 × 900 × 0.5 = 1800 SAR, with the full calculation shown",t=>{
  const {db,users,acceptTravelRule,activateCircular,propose,attest,approve,view}=fixture(t);
  acceptTravelRule();activateCircular('2026-06-01');
  // الحساب الصرف أولًا، ثم المسار الكامل في المنصة.
  const pure=perDiemBreakdown({grade_code:'D',grade_name:'العاملون',scope:'abroad',daily_rate_minor:90000,days:4,factor_bp:5000,
    factor_reason:'خُفض إلى النصف لتوفير السكن فقط (م65/2)',rounding:'riyal_up',version_title:'التعميم'});
  assert.equal(pure.allowance_minor,180000);
  assert.equal(money(pure.allowance_minor),'1,800.00 ريال');
  assert.equal(pure.steps.length,6);
  assert.match(pure.steps[4],/900\.00 ريال × 4 يوم × 50% = 1,800\.00 ريال/);
  const computed=perDiemFor(db,'36t',{grade:'employee',scope:'abroad',days:4,factor_bp:5000,factor_reason:'السكن فقط',date:'2026-07-01'});
  assert.equal(computed.allowance_minor,180000);
  const trip=propose({scope:'abroad',destination:'القاهرة',start_date:'2026-07-01',end_date:'2026-07-04'});
  attest(trip);
  const result=approve(trip,{grade:'employee',housing:'company',transport:'none'});
  assert.equal(result.eligible,true);
  assert.equal(result.allowance_minor,180000,'4 × 900 × 50% = 1800 SAR');
  const decision=view(trip);
  assert.equal(decision.days,4);
  assert.equal(decision.daily_rate_minor,90000);
  assert.equal(decision.factor_bp,5000);
  assert.equal(decision.basis.allowance_version_from,'2026-06-01');
  assert.ok(decision.basis.steps.some(s=>s.includes('1,800.00 ريال')),'the full calculation is on the decision for the employee and every approver');
  const adjustment=db.prepare('SELECT kind,status,amount_minor FROM payroll_adjustments WHERE id=?').get(decision.adjustment_id);
  assert.deepEqual([adjustment.kind,adjustment.status,adjustment.amount_minor],['allowance','proposed',180000],'a PROPOSED adjustment, never a payment');
  assert.ok(verifyAudit(db));
});

// بُدّلت الدرجة من gm إلى employee في 30 سبتمبر 2026: صفّ «gm» كان يحمل 900/1200 باسمٍ مدموج
// يسوّي «مدراء الإدارات» بـ«مدراء العموم» بلا سند، وقد صار يُرفض بـgrade_basis_missing حتى يحسم المالك.
// والمقصود محفوظ كاملًا: السعر ما زال يتغيّر على حدّ النسخة (400 ← 700 للعاملين).
test('version selection by date: a secondment that started before the circular keeps the old rate, and one that starts after gets the new one',t=>{
  const {db,users,tx,acceptTravelRule,activateCircular,propose,attest,approve,view}=fixture(t);
  acceptTravelRule();activateCircular('2026-06-01');
  const old=propose({scope:'domestic',destination:'جدة',start_date:'2026-05-10',end_date:'2026-05-12',distance_km:900,road_type:'paved'});
  attest(old);
  const oldResult=approve(old,{grade:'employee',housing:'none',transport:'none'});
  assert.equal(view(old).daily_rate_minor,40000,'the expired Art. 65 version still governs a decision that started before the circular');
  assert.equal(oldResult.allowance_minor,120000,'3 × 400 = 1200 SAR on the old table (the employee row of Art. 65)');
  assert.equal(view(old).basis.rounding,'halala','the old version keeps the rounding that was in force with it');
  const fresh=propose({scope:'domestic',destination:'جدة',start_date:'2026-06-10',end_date:'2026-06-12',distance_km:900,road_type:'paved'});
  attest(fresh);
  const freshResult=approve(fresh,{grade:'employee',housing:'none',transport:'none'});
  assert.equal(view(fresh).daily_rate_minor,70000);
  assert.equal(freshResult.allowance_minor,210000,'3 × 700 = 2100 SAR on the circular table (the employee row)');
  assert.equal(view(fresh).basis.rounding,'riyal_up','rounding up to the riyal (Art. 50) comes with the circular');
  assert.ok(verifyAudit(db));
});

test('no allowance below the distance thresholds, and the refusal names the threshold and the road type',t=>{
  const {db,acceptTravelRule,activateCircular,propose,attest,approve,view}=fixture(t);
  acceptTravelRule();activateCircular();
  const near=propose({scope:'domestic',destination:'الخرج',start_date:'2026-07-01',end_date:'2026-07-03',distance_km:40,road_type:'paved'});
  attest(near);
  const result=approve(near,{grade:'employee',housing:'none',transport:'none'});
  assert.equal(result.eligible,false);
  assert.equal(result.allowance_minor,0);
  assert.match(result.reason,/40 كم أقل من 75 كم/);
  assert.equal(view(near).adjustment_id,null,'nothing is proposed to payroll when the distance refuses the allowance');
  const unpaved=propose({scope:'domestic',destination:'وادٍ مصطنع',start_date:'2026-07-05',end_date:'2026-07-06',distance_km:41,road_type:'unpaved'});
  attest(unpaved);
  assert.equal(approve(unpaved,{grade:'employee',housing:'none',transport:'none'}).eligible,true,'41 km on an unpaved road clears the 40 km threshold');
});

test('the manager attestation is mandatory under the circular, is never written by the traveller, and is recorded once',t=>{
  const {db,users,tx,acceptTravelRule,activateCircular,propose,view,approve}=fixture(t);
  acceptTravelRule();activateCircular();
  const trip=propose({start_date:'2026-07-01',end_date:'2026-07-03',distance_km:400,road_type:'paved'});
  assert.throws(()=>approve(trip,{grade:'employee',housing:'none',transport:'none'}),code('attestation_required'));
  assert.throws(()=>tx(()=>recordAttestation(db,users.employee,trip,{statement:'أقر بنفسي أنه لا بديل عني في منطقة المهمة المصطنعة'})),
    code('separation_of_duties'),'the traveller never attests that nobody can replace them');
  assert.throws(()=>tx(()=>recordAttestation(db,users.it,trip,{statement:'إقرار من غير المدير المباشر ولا صاحب الصلاحية للاختبار'})),code('not_permitted'));
  tx(()=>recordAttestation(db,users.manager,trip,{statement:'لا يوجد في منطقة المهمة موظف يستطيع أداءها؛ راجعت فريق المنطقة.'}));
  assert.throws(()=>tx(()=>recordAttestation(db,users.manager,trip,{statement:'إقرار ثانٍ على القرار نفسه لا يُقبل في الاختبار'})),code('already_attested'));
  const decision=view(trip);
  assert.ok(decision.attestation_required);
  assert.equal(decision.attestation.attested_by_name,users.manager.name);
  assert.equal(approve(trip,{grade:'employee',housing:'none',transport:'none'}).eligible,true);
  assert.ok(verifyAudit(db));
});

test('no overlap between overtime pay and a secondment for the same period (Art. 77/9)',t=>{
  const {db,users,tx,acceptTravelRule,activateCircular,propose,attest,approve}=fixture(t);
  acceptTravelRule();activateCircular();
  const time=now();
  db.exec(`INSERT INTO overtime_assignments(id,tenant_id,user_id,from_date,to_date,minutes_per_day,days_json,reason,policy_id,status,assigned_by,created_at)
    VALUES('ot-1','36t','employee','2026-07-02','2026-07-04',120,'[{"date":"2026-07-02","type":"working"}]','تكليف عمل إضافي مصطنع لاختبار التعارض','pol-pay','proposed','manager','${time}')`);
  assert.deepEqual(overtimeOverlap(db,'employee','2026-07-01','2026-07-03'),{kind:'assignment',from:'2026-07-02',to:'2026-07-04'});
  assert.equal(overtimeOverlap(db,'employee','2026-08-01','2026-08-03'),null);
  const clashing=propose({start_date:'2026-07-01',end_date:'2026-07-03',distance_km:400,road_type:'paved'});
  attest(clashing);
  assert.throws(()=>approve(clashing,{grade:'employee',housing:'none',transport:'none'}),code('overtime_overlap'));
  const clear=propose({start_date:'2026-08-01',end_date:'2026-08-03',distance_km:400,road_type:'paved'});
  attest(clear);
  assert.equal(approve(clear,{grade:'employee',housing:'none',transport:'none'}).eligible,true,'a period with no overtime is approved normally');
});

test('the kilometre allowance: 1 SAR per kilometre each way when there is no company car and no airport, measured from the workplace or the nearest airport',t=>{
  const {db,users,tx,acceptTravelRule,activateCircular,propose,attest,approve}=fixture(t);
  acceptTravelRule();activateCircular();
  const trip=propose({start_date:'2026-07-01',end_date:'2026-07-03',distance_km:400,road_type:'paved'});
  attest(trip);approve(trip,{grade:'employee',housing:'none',transport:'none'});
  const ticket=tx(()=>recordTicket(db,users.hr,trip,{mode:'mileage',distance_km:310,measured_from:'workplace'}));
  assert.equal(ticket.amount_minor,62000,'310 km × 2 × 1 SAR = 620 SAR');
  assert.equal(ticket.entitled_class,'economy');
  assert.ok(ticket.steps.some(s=>s.includes('310 كم × 2 (ذهابًا وإيابًا) × 1.00 ريال للكيلومتر = 620.00 ريال')));
  assert.ok(ticket.steps.some(s=>s.includes('من مقر العمل')));
  const fromAirport=tx(()=>recordTicket(db,users.hr,trip,{mode:'mileage',distance_km:85,measured_from:'nearest_airport'}));
  assert.equal(fromAirport.amount_minor,17000);
  assert.ok(fromAirport.steps.some(s=>s.includes('من أقرب مطار')));
  assert.throws(()=>tx(()=>recordTicket(db,users.hr,trip,{mode:'mileage',distance_km:0,measured_from:'workplace'})),code('distance_km'));
  assert.equal(ticketsOf(db,'36t',trip).length,2);
});

test('the Art. 41 ticket rules: cash at the lowest fare, the fare difference for a lower class, nothing with a company car, a higher class only for the CEO or official guests, and a driver with an assistant',t=>{
  const {db,users,tx,acceptTravelRule,activateCircular,propose,attest,approve}=fixture(t);
  acceptTravelRule();activateCircular();
  const trip=propose({scope:'abroad',destination:'لندن',start_date:'2026-07-01',end_date:'2026-07-05'});
  attest(trip);approve(trip,{grade:'deputy',housing:'none',transport:'none'});
  const cash=tx(()=>recordTicket(db,users.hr,trip,{mode:'cash_lowest_fare',entitled_fare:'4200.00'}));
  assert.deepEqual([cash.amount_minor,cash.entitled_class,cash.payable_via],[420000,'business','payroll_proposal']);
  assert.ok(cash.steps.some(s=>s.includes('أقل سعر متاح للدرجة المستحقة')));
  const difference=tx(()=>recordTicket(db,users.hr,trip,{mode:'fare_difference',issued_class:'economy',entitled_fare:'4200.00',issued_fare:'1500.00'}));
  assert.equal(difference.amount_minor,270000,'4200 − 1500 = 2700 SAR compensated for the lower class');
  assert.throws(()=>tx(()=>recordTicket(db,users.hr,trip,{mode:'fare_difference',issued_class:'first',entitled_fare:'1500.00',issued_fare:'4200.00'})),code('fare_order'));
  const car=tx(()=>recordTicket(db,users.hr,trip,{mode:'company_car'}));
  assert.deepEqual([car.amount_minor,car.payable_via],[0,'none']);
  assert.ok(car.steps.some(s=>s.includes('الوقود والصيانة')));
  assert.throws(()=>tx(()=>recordTicket(db,users.hr,trip,{mode:'cash_lowest_fare',entitled_fare:'4200.00',higher_class:true,higher_class_reason:'personal'})),code('higher_class_reason'));
  const higher=tx(()=>recordTicket(db,users.hr,trip,{mode:'cash_lowest_fare',entitled_fare:'4200.00',higher_class:true,higher_class_reason:'ceo'}));
  assert.ok(higher.steps.some(s=>s.includes('مرافقة الرئيس التنفيذي')));
  const driver=tx(()=>recordTicket(db,users.hr,trip,{mode:'company_car',driver:true,driver_assistant:true,driver_reason:'materials',driver_value:'800.00'}));
  assert.equal(driver.amount_minor,160000,'a ticket value for the driver and their assistant: 2 × 800 SAR');
  const contract=tx(()=>recordTicket(db,users.hr,trip,{mode:'contract_or_authority',contract_basis:'عقد استشاري مصطنع: درجة رجال الأعمال بقرار صاحب الصلاحية رقم 12'}));
  assert.equal(contract.entitled_class,'per_contract','for collaborators, consultants and secondees the class follows the contract or the authority holder');
  assert.throws(()=>tx(()=>recordTicket(db,users.hr,trip,{mode:'contract_or_authority',contract_basis:'قصير'})),code('invalid_text'));
  assert.ok(verifyAudit(db));
});

test("parents' insurance: 5% of the policy value capped at exactly 2500 SAR per parent, and the deduction never moves without a recorded consent (Art. 51)",t=>{
  const {db,users,tx,extra}=fixture(t);
  const submitted=tx(()=>submitParentsInsurance(db,users.employee,{parents:[{relation:'father',parent_name:'والد الموظفة المصطنع',id_reference:'ينتهي بـ4417',birth_date:'1958-04-02'}],
    payment_mode:'instalments',instalment_months:12}));
  assert.match(submitted.reference,/^BEX-\d{4}-0001$/);
  assert.equal(extra(submitted.id).status,'pending_hr');
  assert.throws(()=>tx(()=>hrQuoteParents(db,users.hr,submitted.id,{version:extra(submitted.id).version,policy_value:'60000.00',documents_verified:false})),code('documents_verified'));
  // 5% من 60,000 = 3,000 ريال، والسقف 2,500 لوالد واحد: المستحق 2,500 بالضبط.
  const quoted=tx(()=>hrQuoteParents(db,users.hr,submitted.id,{version:extra(submitted.id).version,policy_value:'60000.00',documents_verified:true}));
  assert.equal(quoted.amount_minor,250000,'min(60000 × 5%, 2500) = 2500 SAR exactly at the cap');
  assert.equal(quoted.calculation.share_minor,300000);
  assert.equal(quoted.calculation.cap_minor,250000);
  assert.ok(quoted.calculation.steps.some(s=>s.includes('2,500.00 ريال')));
  assert.equal(extra(submitted.id).status,'pending_employee');
  assert.throws(()=>tx(()=>authorityApproveParents(db,users.manager,submitted.id,{version:extra(submitted.id).version,first_month:'2026-10',added_on:today()})),
    code('action_unavailable'),'the authority holder never sees it before the employee consents');
  assert.throws(()=>tx(()=>consentToDeduction(db,users.employee,submitted.id,{version:extra(submitted.id).version,consent:false})),code('consent_required'));
  const consented=tx(()=>consentToDeduction(db,users.employee,submitted.id,{version:extra(submitted.id).version,consent:true,confirmed_amount:'2500.00'}));
  assert.match(consented.consent_text,/المادة 51/);
  assert.equal(extra(submitted.id).status,'pending_authority');
  assert.throws(()=>tx(()=>authorityApproveParents(db,users.hr,submitted.id,{version:extra(submitted.id).version,first_month:'2026-10',added_on:today()})),code('not_permitted'));
  const approved=tx(()=>authorityApproveParents(db,users.manager,submitted.id,{version:extra(submitted.id).version,first_month:'2026-10',added_on:today(),note:'اعتماد مصطنع'}));
  assert.equal(approved.instalments.length,12,'instalments up to 12 months');
  assert.equal(approved.instalments.reduce((n,x)=>n+x.amount_minor,0),250000);
  assert.deepEqual([approved.instalments[0].month,approved.instalments[11].month],['2026-10','2027-09']);
  const handed=tx(()=>handExtraToPayroll(db,users.hr,{request_id:submitted.id,instalment_seq:1,month:'2026-10'}));
  const adjustment=db.prepare('SELECT kind,status,amount_minor FROM payroll_adjustments WHERE id=?').get(handed.payroll_adjustment_id);
  assert.deepEqual([adjustment.kind,adjustment.status],['deduction','proposed'],'a PROPOSED deduction; nothing is deducted by the benefits module');
  // السقف لكل والد: والدان يرفعان السقف إلى 5,000 فيصير المستحق 5% من القيمة (3,000) لأنه الأقل.
  const both=tx(()=>submitParentsInsurance(db,users.employee,{parents:[{relation:'father',parent_name:'والد مصطنع ثانٍ',id_reference:'ينتهي بـ1122',birth_date:'1955-01-01'},
    {relation:'mother',parent_name:'والدة مصطنعة',id_reference:'ينتهي بـ3344',birth_date:'1960-02-02'}],payment_mode:'one_off'}));
  const bothQuoted=tx(()=>hrQuoteParents(db,users.hr,both.id,{version:extra(both.id).version,policy_value:'60000.00',documents_verified:true}));
  assert.equal(bothQuoted.calculation.cap_minor,500000,'2500 SAR per parent × 2');
  assert.equal(bothQuoted.amount_minor,300000,'min(3000, 5000) = 3000 SAR when two parents raise the cap');
  assert.ok(verifyAudit(db));
});

test("children's education: requests are blocked until the per-grade table is filled, two children is the maximum, and a duplicate invoice is refused",t=>{
  const {db,users,tx,extra}=fixture(t);
  const invoice=(n)=>({invoice_number:n,supplier_tax_number:'300012345600003',supplier_name:'مدرسة مصطنعة',invoice_date:'2026-08-01',amount:'9000.00'});
  const child=(name,n)=>({child_name:name,birth_date:'2016-03-03',stage:'ابتدائي',school:'مدرسة مصطنعة',enrolment_proof:'قيد رقم 55',invoice:invoice(n)});
  assert.throws(()=>tx(()=>submitEducationClaim(db,users.employee,{children:[child('ابن مصطنع','INV-1')],academic_year:'2026-2027'})),
    code('caps_not_set'),'the source does not state the amounts: the table starts empty and blocks the request');
  assert.match(benefitExtrasBoard(db,users.employee).availability.children_education.reason,/غير مقررة بعد/);
  tx(()=>setGradeCap(db,users.manager,{table:'education',grade_code:'D',amount:'8000.00',note:'قرار إدارة مصطنع'}));
  assert.throws(()=>tx(()=>submitEducationClaim(db,users.employee,{children:[child('ابن مصطنع','INV-1')],academic_year:'2026-2027'})),
    code('caps_not_set'),'the cap basis (per child or per employee) is part of the missing decision');
  tx(()=>saveBenefitSettings(db,users.manager,{education_cap_basis:'per_child',note:'قرار إدارة مصطنع بأساس السقف'}));
  assert.throws(()=>tx(()=>submitEducationClaim(db,users.employee,{children:[child('أ','INV-A'),child('ب','INV-B'),child('ج','INV-C')],academic_year:'2026-2027'})),
    code('children_limit'),'up to two children');
  assert.throws(()=>tx(()=>submitEducationClaim(db,users.employee,{children:[child('ابن','INV-1')],academic_year:'2026-2028'})),code('academic_year'));
  const claim=tx(()=>submitEducationClaim(db,users.employee,{children:[child('ابن مصطنع','INV-1'),child('ابنة مصطنعة','INV-2')],academic_year:'2026-2027'}));
  assert.equal(claim.calculation.claimed_minor,1800000,'two invoices of 9000 SAR');
  assert.equal(claim.calculation.cap_minor,1600000,'8000 SAR per child × 2');
  assert.equal(claim.calculation.amount_minor,1600000,'min(invoices, cap)');
  // الفاتورة نفسها (رقمها مع الرقم الضريبي للمورد) لا تُصرف مرتين، ولو في طلب آخر أو عام دراسي آخر.
  assert.throws(()=>tx(()=>submitEducationClaim(db,users.employee,{children:[child('ابن مصطنع','INV-1')],academic_year:'2027-2028'})),
    code('duplicate_invoice'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM benefit_extra_requests WHERE kind='children_education'").get().n,1,'the refused duplicate leaves no half-written request behind');
  const hr=tx(()=>hrDecideClaim(db,users.hr,claim.id,'approve',{version:extra(claim.id).version,note:'طوبقت الفواتير وإثبات القيد'}));
  assert.equal(hr.amount_minor,1600000);
  assert.equal(extra(claim.id).status,'pending_finance');
  const finance=tx(()=>financeCompleteClaim(db,users.it,claim.id,'approve',{version:extra(claim.id).version,month:'2026-09'}));
  assert.deepEqual([finance.reimbursement_month,finance.month_end],['2026-09','2026-09-30'],'reimbursement at the end of the Gregorian month');
  const handed=tx(()=>handExtraToPayroll(db,users.hr,{request_id:claim.id,month:'2026-09'}));
  assert.equal(db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(handed.payroll_adjustment_id).status,'proposed');
  assert.ok(verifyAudit(db));
});

test('sports clubs and equipment: 5500 SAR a year per grade by default, one request a year with the employee warned first, and the system pays min(amount, cap)',t=>{
  const {db,users,tx,extra}=fixture(t);
  const year=today().slice(0,4);
  const balance=sportsBalance(db,'36t','employee',year);
  assert.equal(balance.cap_minor,550000,'5500 SAR is the default for every grade');
  assert.ok(balance.open);
  assert.match(balance.warning,/طلب واحد فقط/);
  assert.match(benefitExtrasBoard(db,users.employee).availability.sports.warning,/يُغلق رصيد السنة/);
  const invoice={invoice_number:'GYM-001',supplier_tax_number:'300099887700003',supplier_name:'نادٍ رياضي مصطنع',invoice_date:`${year}-03-01`,amount:'4000.00'};
  assert.throws(()=>tx(()=>submitSportsClaim(db,users.employee,{category:'club',invoice,acknowledged_single_request:false})),
    code('acknowledgement_required'),'the employee is warned before submitting that this is their only request for the year');
  assert.throws(()=>tx(()=>submitSportsClaim(db,users.employee,{category:'spa',invoice,acknowledged_single_request:true})),
    code('category'),'only club subscriptions and sports equipment are allowed');
  const claim=tx(()=>submitSportsClaim(db,users.employee,{category:'club',invoice,acknowledged_single_request:true}));
  assert.equal(claim.calculation.amount_minor,400000,'min(4000, 5500) = 4000 SAR');
  assert.throws(()=>tx(()=>submitSportsClaim(db,users.employee,{category:'equipment',acknowledged_single_request:true,
    invoice:{...invoice,invoice_number:'GYM-002'}})),code('yearly_limit'),'the balance closes for the year after the first request');
  assert.equal(benefitExtrasBoard(db,users.employee).availability.sports.available,false);
  // السقف يُفرّق بالدرجة لأن المصدر يقول «حسب الفئة الوظيفية» مع ذكره 5500 ريال.
  tx(()=>setGradeCap(db,users.manager,{table:'sports',grade_code:'C',amount:'7000.00',note:'قرار إدارة مصطنع بسقف أعلى للدرجة C'}));
  assert.equal(db.prepare("SELECT annual_cap_minor FROM sports_grade_caps WHERE tenant_id='36t' AND grade_code='C'").get().annual_cap_minor,700000);
  assert.equal(db.prepare("SELECT annual_cap_minor FROM sports_grade_caps WHERE tenant_id='36t' AND grade_code='D'").get().annual_cap_minor,550000);
  tx(()=>hrDecideClaim(db,users.hr,claim.id,'approve',{version:extra(claim.id).version}));
  const finance=tx(()=>financeCompleteClaim(db,users.it,claim.id,'approve',{version:extra(claim.id).version,month:`${year}-04`}));
  assert.equal(finance.status,'completed');
  assert.equal(extra(claim.id).amount_minor,400000);
  assert.ok(verifyAudit(db));
});

test('the shared eligibility rules refuse a request and name the unmet condition: full-time, probation passed, and the last appraisal at or above the setting',t=>{
  const low=fixture(t,{appraisalPercent:65});
  const e=sharedEligibility(low.db,'36t','employee');
  assert.equal(e.ok,false);
  assert.match(e.text,/65% وهو أقل من الحد المطلوب 70%/);
  assert.throws(()=>low.tx(()=>submitParentsInsurance(low.db,low.users.employee,{parents:[{relation:'father',parent_name:'والد مصطنع',id_reference:'ينتهي بـ0001',birth_date:'1959-01-01'}],payment_mode:'one_off'})),
    code('not_eligible'));
  // الحد نفسه إعداد: خفضه إلى 60% يجعل الموظف مؤهلًا بلا تغيير في بياناته.
  low.tx(()=>saveBenefitSettings(low.db,low.users.manager,{min_appraisal_percent:60,note:'قرار مصطنع بخفض الحد'}));
  assert.equal(sharedEligibility(low.db,'36t','employee').ok,true);

  const part=fixture(t,{employmentType:'part_time'});
  assert.match(sharedEligibility(part.db,'36t','employee').text,/دوام كامل نظامي/);

  const probation=fixture(t,{contractStart:today(),probationDays:90});
  const still=sharedEligibility(probation.db,'36t','employee');
  assert.equal(still.ok,false);
  assert.match(still.text,/لم تجتز فترة التجربة بعد/);

  const noReview=fixture(t,{appraisalPercent:null});
  assert.match(sharedEligibility(noReview.db,'36t','employee').text,/لا يوجد تقييم أداء صادر/);

  const noGrade=fixture(t,{grade:null});
  assert.throws(()=>noGrade.tx(()=>submitSportsClaim(noGrade.db,noGrade.users.employee,{category:'club',acknowledged_single_request:true,
    invoice:{invoice_number:'G-9',supplier_tax_number:'300011112200003',supplier_name:'نادٍ مصطنع',invoice_date:today(),amount:'1000.00'}})),
    code('grade_required'),'no grade is assumed; the refusal says the grade is not recorded');
});
