import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createLeaveRequest, getLeaveRequest, grantLeaveOpening, leaveAction, listLeave } from '../app/leave.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, createLeaveCalendar, statutoryHolidayPlan, proposeStatutoryHolidays, REGULATION_LEAVE_TYPES } from '../app/leave-types.mjs';
import { prepareAccrualPolicy, decideAccrualPolicy, recordAccrualAdjustment, accrualBalance, runAccrualCycle } from '../app/leave-accrual.mjs';
import { uploadFile, listFiles } from '../app/files.mjs';
import { countLeaveDays, sickTiers } from '../app/static/leave-count.mjs';
import { leaveUI, leavePreview } from '../app/static/leave-ui.mjs';
import { searchModuleServices, launcherResults } from '../app/static/request-picker.mjs';
import { searchAll } from '../app/search.mjs';
import { MODULE_SERVICES } from '../app/service-catalog.mjs';

const code=expected=>error=>error.code===expected;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const pdf=label=>({filename:`${label}.pdf`,content:Buffer.from(`%PDF-1.4 synthetic ${label}`).toString('base64')});
const shift=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function fixture(t,{accept=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-leave-types');t.after(()=>db.close());
  // hr يعد السياسات ويعتمد الخطوة الأخيرة؛ hr-manager مدير الموارد البشرية مالك الاعتماد (hr.policy.accept).
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=fn=>transaction(db,fn);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.policy.accept',note:'مالك اعتماد سياسات الموارد البشرية في الاختبار'}));
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pay-policy','36t','pay_components','بنود راتب مصطنعة','نص سياسة مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.','{\"components\":[\"basic\"]}','سند مصطنع للاختبار المحلي','2024-01-01','accepted','hr','hr-manager',?,?)").run(now(),now());
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('cycle-policy','36t','payroll_cycle','دورة رواتب مصطنعة','نص سياسة دورة رواتب مصطنع للاختبار المحلي فقط.',?,'سند مصطنع للاختبار المحلي','2024-01-01','accepted','hr','hr-manager',?,?)")
    .run(JSON.stringify({pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic'],review_threshold_bp:1000}),now(),now());
  // إجمالي شهري 10,000.00 ريال (1,000,000 هللة) لتسهل مراجعة مبالغ الخصم يدويًا.
  const contract=(userId,start,probation)=>db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES(?,'36t',?,'pay-policy','indefinite','وظيفة تجريبية','الرياض',?,40,?,60,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مستند تجريبي لا وجود له','active','hr','hr-manager',?,?,?)")
    .run(`contract-${userId}`,userId,start,probation,now(),now(),now());
  contract('employee','2025-01-01',90);contract('outsider','2026-06-01',90);
  let policyId=null;
  if(accept){
    policyId=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2025-01-01'})).id;
    tx(()=>decideLeaveTypes(db,users['hr-manager'],policyId,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد في الاختبار'}));
  }
  const calendar=(year,department='creative')=>tx(()=>createLeaveCalendar(db,users.hr,{employee_department_id:department,name:`تقويم إجازات ${year}`,effective_from:`${year}-01-01`,effective_to:`${year}-12-31`,weekdays:[0,1,2,3,4]})).id;
  const cal2026=calendar(2026);
  const ask=(input,who='employee')=>tx(()=>createLeaveRequest(db,users[who],{balance_year:Number(input.start_date.slice(0,4)),reason:'طلب اختبار للأنواع النظامية',...input}));
  const act=(who,r,action,input={})=>tx(()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار اختبار مصطنع',...input}));
  const approve=r=>act('hr',act('manager',r,'approve'),'approve');
  const opening=(who,type,days,calendarId=cal2026)=>tx(()=>grantLeaveOpening(db,users.hr,{employee_id:who,leave_type:type,balance_year:2026,days,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع للاختبار',evidence:'بيانات اختبار محلية',calendar_id:calendarId}));
  const holiday=(date,status='approved')=>db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,'عطلة رسمية مصطنعة','تعميم مصطنع لبيئة الاختبار',?,'hr',?,?,?)")
    .run(`holiday-${date}-${status}`,date,status,status==='proposed'?null:'hr-manager',status==='proposed'?null:now(),now());
  return {db,users,tx,policyId,calendar,cal2026,ask,act,approve,opening,holiday};
}

test('the regulation draft cites its articles and changes nothing until the HR manager accepts it',t=>{
  const {db,users,tx,cal2026}=fixture(t,{accept:false});
  // كل نوع يستشهد بمادة: من لائحة الشركة، أو من نظام العمل حيث لا مادة له في اللائحة (الحج، تمديد العدة للحامل).
  for(const type of REGULATION_LEAVE_TYPES)assert.ok((type.articles.length||type.law_articles.length)&&Array.isArray(type.law_articles)&&type.name_ar&&type.name_en&&['working','calendar'].includes(type.unit),type.code);
  const byCode=Object.fromEntries(REGULATION_LEAVE_TYPES.map(x=>[x.code,x]));
  assert.equal(byCode.annual.entitlement.days,30);assert.equal(byCode.annual.unit,'calendar');assert.equal(byCode.annual.limits.max_splits_per_year,6);
  assert.deepEqual(byCode.sick.pay_tiers,[{days:30,rate_bp:10000},{days:60,rate_bp:7500},{days:30,rate_bp:0}]);
  assert.equal(byCode.emergency.entitlement.days,3);assert.equal(byCode.emergency.half_day,true);
  assert.equal(byCode.maternity.entitlement.days,84,'12 weeks under Art. 105, not the 70 days of the old app');
  assert.equal(byCode.unpaid.routing.threshold_working_days,5);assert.equal(byCode.exam.limits.min_notice_days,15);
  // قبل الاعتماد: السلوك القديم كما هو، والحقول الجديدة مرفوضة.
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'synthetic_annual',balance_year:2026,days:5,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع للاختبار',evidence:'بيانات اختبار محلية',calendar_id:cal2026}));
  assert.throws(()=>tx(()=>createLeaveRequest(db,users.employee,{leave_type:'emergency',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-04',half_day:true,reason:'طلب قبل الاعتماد'})),code('policy_required'));
  assert.equal(tx(()=>createLeaveRequest(db,users.employee,{leave_type:'synthetic_annual',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-05',reason:'طلب قديم برصيد افتتاحي'})).days,2);
  assert.equal(listLeave(db,users.employee).statutory,null);
  const id=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2025-01-01'})).id;
  assert.throws(()=>tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2025-01-01'})),code('draft_exists'));
  assert.throws(()=>tx(()=>decideLeaveTypes(db,users.hr,id,'accept',{note:'المعدة لا تعتمد مسودتها'})),code('not_permitted'));
  for(const who of ['employee','manager','admin'])assert.throws(()=>tx(()=>prepareLeaveTypesDraft(db,users[who],{effective_from:'2025-01-01'})),error=>['not_permitted','forbidden'].includes(error.code),who);
  assert.equal(listLeave(db,users.employee).statutory,null,'a draft is not in force');
  tx(()=>decideLeaveTypes(db,users['hr-manager'],id,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد'}));
  assert.throws(()=>db.prepare("UPDATE leave_type_policies SET parameters='{}' WHERE id=?").run(id),/replaced by a new dated policy/);
  // بعد الاعتماد: نوع خارج السياسة مرفوض، والأنواع تظهر بأسمائها.
  assert.throws(()=>tx(()=>createLeaveRequest(db,users.employee,{leave_type:'synthetic_annual',balance_year:2026,start_date:'2026-10-11',end_date:'2026-10-11',reason:'نوع خارج السياسة'})),code('leave_type_unknown'));
  const view=listLeave(db,users.employee).statutory;
  assert.equal(view.types.length,REGULATION_LEAVE_TYPES.length);assert.ok(view.balances.every(b=>b.name_ar&&!/^[a-z_]+$/.test(b.name_ar)));
  assert.equal(verifyAudit(db),true);
});

test('calendar-day and working-day types count the same range differently',t=>{
  const {db,users,ask,opening,act}=fixture(t);
  opening('employee','annual',30);
  // من الأحد 4 أكتوبر إلى السبت 10 أكتوبر 2026: 7 أيام تقويمية، منها 5 أيام عمل.
  const annual=ask({leave_type:'annual',start_date:'2026-10-04',end_date:'2026-10-10'});
  assert.equal(annual.days,7);assert.equal(annual.unit,'calendar');assert.equal(annual.terms.counted_dates.length,7);
  assert.equal(annual.work_dates.length,5,'attendance still sees only the working days as leave days');
  assert.equal(annual.terms.source,'opening','no accepted accrual rule, so the opening balance is used');
  const emergency=ask({leave_type:'emergency',start_date:'2026-10-15',end_date:'2026-10-18'});
  assert.equal(emergency.days,2,'Thursday and Sunday; Friday and Saturday are weekly rest');assert.equal(emergency.unit,'working');
  assert.deepEqual(emergency.terms.counted_dates,['2026-10-15','2026-10-18']);
  assert.throws(()=>ask({leave_type:'emergency',start_date:'2026-10-16',end_date:'2026-10-17'}),code('no_workdays'));
  assert.throws(()=>ask({leave_type:'marriage',start_date:'2026-11-01',end_date:'2026-11-08'}),code('entitlement_exceeded'),'marriage is 5 days');
  assert.equal(ask({leave_type:'marriage',start_date:'2026-11-01',end_date:'2026-11-05'}).days,5);
  // الخدمة المشتركة: عدّ واحد للخادم والنموذج.
  const shared=countLeaveDays({start:'2026-10-04',end:'2026-10-10',unit:'calendar',weekdays:[0,1,2,3,4],holidays:[]});
  assert.equal(shared.days_milli,7000);assert.equal(shared.working_days,5);
  const balance=listLeave(db,users.employee).statutory.balances.find(b=>b.code==='annual');
  assert.equal(balance.available_days,'23');assert.equal(balance.reserved_days,'7');
  act('manager',annual,'approve');
  assert.throws(()=>ask({leave_type:'annual',start_date:'2026-10-06',end_date:'2026-10-07'}),code('leave_overlap'));
});

test('sick leave tiers cross request and month boundaries: 30 full, 60 at 75%, then unpaid, proposed to payroll and never auto-approved',t=>{
  const {db,users,tx,ask,act,approve}=fixture(t);
  let first=ask({leave_type:'sick',start_date:'2026-03-01',end_date:'2026-04-19'});
  assert.equal(first.days,50);assert.equal(first.terms.document_required,true);
  assert.throws(()=>act('manager',first,'approve'),code('document_required'),'no medical certificate, no manager step');
  assert.throws(()=>tx(()=>uploadFile(db,users.manager,{entity_type:'leave_request',entity_id:first.id,label:'تقرير طبي',...pdf('m')})),code('not_permitted'),'only the requester attaches');
  tx(()=>uploadFile(db,users.employee,{entity_type:'leave_request',entity_id:first.id,label:'تقرير طبي معتمد',...pdf('first')}));
  assert.equal(listFiles(db,users.manager,'leave_request',first.id).files.length,1,'the manager sees the certificate');
  first=approve(getLeaveRequest(db,users.employee,first.id));assert.equal(first.status,'approved');
  const rates=r=>r.terms.pay.reduce((m,p)=>({...m,[p.rate_bp]:(m[p.rate_bp]??0)+1}),{});
  assert.deepEqual(rates(first),{10000:30,7500:20});
  let second=ask({leave_type:'sick',start_date:'2026-04-20',end_date:'2026-06-08',document:pdf('second')});
  assert.equal(second.documents.length,1,'the certificate can travel with the request');
  second=approve(second);
  assert.deepEqual(rates(second),{7500:40,0:10},'100 days in the window: 30 full, 60 at 75%, 10 unpaid');
  assert.throws(()=>ask({leave_type:'sick',start_date:'2026-06-09',end_date:'2026-07-10',document:pdf('third')}),code('sick_committee'),'beyond 120 days the case goes to the medical committee');
  // أثر الأجر: خصم مقترح لكل شهر = 1,000,000 × مجموع (1 − النسبة) ÷ 30.
  const effects=db.prepare("SELECT e.month,e.amount_minor,e.status,a.status AS adjustment,a.kind,a.proposed_by FROM leave_pay_effects e JOIN payroll_adjustments a ON a.id=e.adjustment_id ORDER BY e.created_at,e.month").all();
  assert.deepEqual(effects.map(x=>[x.month,x.amount_minor]),[['2026-03',8333],['2026-04',158333],['2026-04',91667],['2026-05',308333],['2026-06',266667]]);
  assert.ok(effects.every(x=>x.status==='proposed'&&x.adjustment==='proposed'&&x.kind==='deduction'&&x.proposed_by==='hr'),'nothing is approved automatically');
  // إلغاء إجازة معتمدة يسحب الأثر ولا يرفض الحركة نيابة عن مُعد الرواتب.
  // B20 (تدقيق 19 سبتمبر): هذه الإجازة مضت، فلم يعد لصاحبها إلغاؤها؛ سحبها قرار خدمات الموظف بسبب مكتوب.
  assert.throws(()=>act('employee',getLeaveRequest(db,users.employee,second.id),'cancel',{note:'محاولة إلغاء إجازة مضت'}),code('transition_denied'));
  act('hr',getLeaveRequest(db,users.hr,second.id),'cancel',{note:'إلغاء اختبار بعد الاعتماد'});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_pay_effects WHERE request_id=? AND status='withdrawn'").get(second.id).n,3);
  assert.equal(sickTiers(['2025-01-10'],['2026-01-11'],[{days:1,rate_bp:10000},{days:1,rate_bp:7500}])[0].rate_bp,10000,'a new year window starts after 12 months');
  assert.equal(verifyAudit(db),true);
});

test('emergency leave takes half days: the third day may be 2.5 + 0.5, and nothing beyond',t=>{
  const {db,users,ask,act}=fixture(t);
  const two=ask({leave_type:'emergency',start_date:'2026-10-04',end_date:'2026-10-05'});assert.equal(two.days,2);
  const half=ask({leave_type:'emergency',start_date:'2026-10-06',end_date:'2026-10-06',half_day:true});
  assert.equal(half.days,0.5);assert.equal(half.terms.half_day,true);
  assert.equal(listLeave(db,users.employee).statutory.balances.find(b=>b.code==='emergency').available_days,'0.5');
  const last=ask({leave_type:'emergency',start_date:'2026-10-07',end_date:'2026-10-07',half_day:true});assert.equal(last.days,0.5);
  assert.throws(()=>ask({leave_type:'emergency',start_date:'2026-10-08',end_date:'2026-10-08',half_day:true}),code('insufficient_balance'));
  assert.throws(()=>ask({leave_type:'annual',start_date:'2026-10-11',end_date:'2026-10-11',half_day:true}),code('half_day_not_allowed'));
  assert.throws(()=>ask({leave_type:'emergency',start_date:'2026-10-11',end_date:'2026-10-12',half_day:true}),code('half_day'));
  // الرفض يحرر نصف اليوم المحجوز بالضبط.
  act('manager',last,'reject',{note:'رفض اختبار لتحرير نصف اليوم'});
  assert.equal(listLeave(db,users.employee).statutory.balances.find(b=>b.code==='emergency').available_days,'0.5');
  const ledger=db.prepare("SELECT kind,reserved_milli FROM leave_day_ledger WHERE request_id=? ORDER BY seq").all(last.id).map(x=>({...x}));
  assert.deepEqual(ledger,[{kind:'reserve',reserved_milli:500},{kind:'release',reserved_milli:-500}]);
});

test('annual leave is refused during probation and allowed once it ends',t=>{
  const {db,users,ask,opening}=fixture(t);
  opening('outsider','annual',10);
  // عقد يبدأ 1 يونيو 2026 بتجربة 90 يومًا: آخر يوم تجربة 29 أغسطس.
  assert.throws(()=>ask({leave_type:'annual',start_date:'2026-08-02',end_date:'2026-08-03'},'outsider'),error=>error.code==='probation'&&/2026-08-29/.test(error.message));
  assert.equal(ask({leave_type:'annual',start_date:'2026-08-30',end_date:'2026-08-31'},'outsider').status,'pending_manager');
  // الطارئة ليست مقيدة بالتجربة.
  assert.equal(ask({leave_type:'emergency',start_date:'2026-08-04',end_date:'2026-08-04'},'outsider').days,1);
  // موظف بلا عقد: لا رفض مخترع، بل تنبيه للمعتمدين.
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('newcomer','36t','creative','newcomer','موظف جديد تجريبي','unused-test-hash','employee','manager')");
  users.newcomer=db.prepare("SELECT * FROM users WHERE id='newcomer'").get();
  opening('newcomer','annual',10);
  const unverified=ask({leave_type:'annual',start_date:'2026-09-06',end_date:'2026-09-07'},'newcomer');
  assert.match(unverified.terms.warnings.join(' '),/فترة التجربة/);
});

test('unpaid leave needs a year of service and no balance left; above 5 working days it goes to the authority holder',t=>{
  const {db,users,tx,ask,act,approve}=fixture(t);
  assert.throws(()=>ask({leave_type:'unpaid',start_date:'2026-11-01',end_date:'2026-11-05'},'outsider'),code('service_required'));
  assert.throws(()=>ask({leave_type:'unpaid',start_date:'2026-11-01',end_date:'2026-11-05'}),code('balance_remaining'),'3 emergency days are still available');
  approve(ask({leave_type:'emergency',start_date:'2026-02-01',end_date:'2026-02-03'}));
  // 5 أيام عمل: يعتمدها المدير ثم خدمات الموظف.
  let five=ask({leave_type:'unpaid',start_date:'2026-11-01',end_date:'2026-11-05'});
  assert.equal(five.terms.route,'manager_hr');assert.match(five.terms.warnings.join(' '),/السنوية/,'an unverifiable annual balance is flagged, not assumed');
  five=act('manager',five,'approve');assert.equal(five.stage,'pending_hr');
  // 6 أيام عمل: لا مسار دون صاحب صلاحية نشط غير المدير.
  assert.throws(()=>ask({leave_type:'unpaid',start_date:'2026-11-08',end_date:'2026-11-15'}),code('routing_unavailable'));
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.leave.authority',note:'صاحب الصلاحية في الاختبار (م91)'}));
  let six=ask({leave_type:'unpaid',start_date:'2026-11-08',end_date:'2026-11-15'});
  assert.equal(six.terms.route,'manager_authority_hr');assert.equal(six.days,8,'unpaid leave counts calendar days');
  six=act('manager',six,'approve');assert.equal(six.stage,'pending_authority');
  assert.deepEqual(getLeaveRequest(db,users.hr,six.id).actions,[],'HR waits for the authority holder');
  assert.deepEqual(getLeaveRequest(db,users['hr-manager'],six.id).actions,['approve','return','reject']);
  assert.throws(()=>getLeaveRequest(db,users.outsider,six.id),code('not_found'));
  const authorised=act('hr-manager',six,'approve');
  assert.equal(authorised.status,'pending_hr');assert.equal(authorised.stage,'pending_hr');assert.equal(authorised.version,six.version,'the authority step adds a decision, not a new state');
  six=act('hr',authorised,'approve');assert.equal(six.status,'approved');
  assert.equal(six.authority_decisions[0].actor_id,'hr-manager');
  // 8 أيام بلا أجر في نوفمبر: 1,000,000 × 8 ÷ 30.
  assert.equal(db.prepare('SELECT amount_minor FROM leave_pay_effects WHERE request_id=?').get(six.id).amount_minor,266667);
  assert.equal(db.prepare("SELECT status FROM payroll_adjustments WHERE id=(SELECT adjustment_id FROM leave_pay_effects WHERE request_id=?)").get(six.id).status,'proposed');
  // صاحب الصلاحية يعيد: يعود الطلب للموظف ويتحرر الحجز.
  let back=act('manager',ask({leave_type:'unpaid',start_date:'2026-12-06',end_date:'2026-12-14'}),'approve');
  back=act('hr-manager',back,'return',{note:'أعد تحديد الفترة بعد مراجعة الاحتياج'});assert.equal(back.status,'returned');
});

test('more than 20 unpaid days stop the annual accrual for the period (Art. 86.2b, 91.6)',t=>{
  const {db,users,tx,ask,act,approve}=fixture(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.leave.authority',note:'صاحب الصلاحية في الاختبار'}));
  const rule=tx(()=>prepareAccrualPolicy(db,users.hr,{leave_type:'annual',title:'استحقاق السنوية الشهري',body:'قاعدة استحقاق مصطنعة للاختبار: 2.5 يوم عن كل شهر من تاريخ المباشرة.',accrual_unit:'month',accrual_days:'2.5',accrual_start:'hire',waiting_days:0,carryover_allowed:false,carryover_cap_days:'',cash_on_end_of_service:true,basis:'لائحة تنظيم العمل م80 وم86 (نسخة الاختبار)',basis_confirmed_on:'2026-01-05',effective_from:'2025-01-01'})).id;
  tx(()=>decideAccrualPolicy(db,users['hr-manager'],rule,'accept',{note:'راجعت القاعدة ومصدرها قبل الاعتماد'}));
  approve(ask({leave_type:'emergency',start_date:'2026-02-01',end_date:'2026-02-03'}));
  const run=tx(()=>runAccrualCycle(db,users['hr-manager'],{kind:'accrual',leave_type:'annual',period_key:'2026-05',note:'تقييد استحقاق مايو في الاختبار'}));
  assert.equal(accrualBalance(db,'36t','employee','annual',2026).balance_days,'2.5');
  // الرصيد السنوي المتاح يمنع الاستثنائية؛ يُستهلك أولًا.
  const annual=approve(ask({leave_type:'annual',start_date:'2026-05-03',end_date:'2026-05-04'}));
  assert.equal(annual.terms.source,'accrual');
  tx(()=>recordAccrualAdjustment(db,users['hr-manager'],{employee_id:'employee',leave_type:'annual',effective_date:'2026-05-31',days:'-0.5',reason:'تسوية نصف اليوم المتبقي في الاختبار'}));
  let unpaid=ask({leave_type:'unpaid',start_date:'2026-06-01',end_date:'2026-06-25'});
  unpaid=act('hr',act('hr-manager',act('manager',unpaid,'approve'),'approve'),'approve');assert.equal(unpaid.status,'approved');
  const june=tx(()=>runAccrualCycle(db,users['hr-manager'],{kind:'accrual',leave_type:'annual',period_key:'2026-06',note:'تقييد استحقاق يونيو في الاختبار'}));
  assert.ok(june.skipped.some(s=>s.employee_id==='employee'&&/م86/.test(s.reason)),'five unpaid days beyond the twentieth fall in June');
  assert.ok(run.employees>=1);
});

test('leave reads the approved public holidays: one source for attendance and leave',t=>{
  const {db,users,ask,holiday,tx,cal2026}=fixture(t);
  holiday('2026-10-06');holiday('2026-10-07','proposed');
  const emergency=ask({leave_type:'emergency',start_date:'2026-10-04',end_date:'2026-10-07'});
  assert.deepEqual(emergency.terms.counted_dates,['2026-10-04','2026-10-05','2026-10-07'],'the approved holiday is not a working day; a proposed one still is');
  const sick=ask({leave_type:'sick',start_date:'2026-10-11',end_date:'2026-10-11'});assert.equal(sick.days,1);
  const calendar=listLeave(db,users.employee).statutory.own_calendars.find(c=>c.id===cal2026);
  assert.deepEqual(calendar.holidays,['2026-10-06']);assert.deepEqual(calendar.calendar_holidays,[],'new calendars keep no private holiday list');
  // المرضية التقويمية لا تحسب العطلة الرسمية داخلها (م83)، والعدة التقويمية تحسبها.
  holiday('2026-10-20');
  const sickWeek=ask({leave_type:'sick',start_date:'2026-10-18',end_date:'2026-10-24',document:pdf('sick')});
  assert.equal(sickWeek.days,6);assert.equal(sickWeek.terms.counted_dates.includes('2026-10-20'),false);
  // الطريق القديم (رصيد افتتاحي بلا سياسة) يقرأ المصدر نفسه.
  const legacy=fixture(t,{accept:false});
  legacy.holiday('2026-10-06');legacy.opening('employee','synthetic_annual',5,legacy.cal2026);
  assert.deepEqual(legacy.ask({leave_type:'synthetic_annual',start_date:'2026-10-04',end_date:'2026-10-07'}).work_dates,['2026-10-04','2026-10-05','2026-10-07']);
  // خطة العطل الثابتة: التعويض عن عطلة وقعت في الراحة الأسبوعية.
  const plan2022=statutoryHolidayPlan(2022);
  assert.ok(plan2022.some(h=>h.date==='2022-09-22'&&h.kind==='compensation'),'National Day on Friday is compensated on Thursday');
  assert.ok(statutoryHolidayPlan(2023).some(h=>h.date==='2023-09-24'&&h.kind==='compensation'),'Saturday is compensated on Sunday');
  const eid=statutoryHolidayPlan(2027,{eid_al_fitr_start:'2027-03-10'});
  assert.equal(eid.filter(h=>h.key==='eid_al_fitr'&&h.kind==='holiday').length,4);
  // اللائحة التنفيذية م24/ثانيًا/1: يوما العيد الواقعان في الجمعة والسبت (12 و13 مارس 2027) يُعوَّضان بيومي عمل بعد آخر أيامه.
  assert.deepEqual(eid.filter(h=>h.key==='eid_al_fitr'&&h.kind==='compensation').map(h=>h.date),['2027-03-14','2027-03-15']);
  const next=Number(today().slice(0,4))+1;
  const proposed=tx(()=>proposeStatutoryHolidays(db,users.hr,{year:next}));
  assert.ok(proposed.proposed>=2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_holidays WHERE holiday_date LIKE ? AND status='proposed'").get(`${next}-%`).n,proposed.proposed,'proposals wait for a second person in attendance');
});

test('annual leave reserves and debits against the accrual engine once an accrual rule is accepted',t=>{
  const {db,users,tx,ask,act,approve,opening}=fixture(t);
  const rule=tx(()=>prepareAccrualPolicy(db,users.hr,{leave_type:'annual',title:'استحقاق السنوية الشهري',body:'قاعدة استحقاق مصطنعة للاختبار: 2.5 يوم عن كل شهر من تاريخ المباشرة.',accrual_unit:'month',accrual_days:'2.5',accrual_start:'hire',waiting_days:0,carryover_allowed:false,carryover_cap_days:'',cash_on_end_of_service:true,basis:'لائحة تنظيم العمل م80 وم86 (نسخة الاختبار)',basis_confirmed_on:'2026-01-05',effective_from:'2025-01-01'})).id;
  tx(()=>decideAccrualPolicy(db,users['hr-manager'],rule,'accept',{note:'راجعت القاعدة ومصدرها قبل الاعتماد'}));
  tx(()=>recordAccrualAdjustment(db,users['hr-manager'],{employee_id:'employee',leave_type:'annual',effective_date:'2026-01-15',days:'10',reason:'رصيد منقول مصطنع لاختبار الحجز من محرك الاستحقاق'}));
  // رصيد افتتاحي قديم لا يُستعمل متى وُجدت قاعدة استحقاق معتمدة.
  opening('employee','annual',30);
  // تاريخ مستقبلي ثابت داخل سنة الرصيد؛ 4 أكتوبر صار «اليوم» في 2026 فكان اختبار الإلغاء يختبر منع إلغاء إجازة بدأت فعلًا.
  let first=ask({leave_type:'annual',start_date:'2026-11-08',end_date:'2026-11-14'});
  assert.equal(first.terms.source,'accrual');assert.equal(first.days,7);
  let view=listLeave(db,users.employee).statutory.balances.find(b=>b.code==='annual');
  assert.equal(view.available_days,'3');assert.equal(view.reserved_days,'7');assert.equal(view.source,'accrual');
  assert.equal(accrualBalance(db,'36t','employee','annual',2026).balance_days,'10','a reservation is not usage');
  assert.throws(()=>ask({leave_type:'annual',start_date:'2026-11-22',end_date:'2026-11-25'}),code('insufficient_balance'));
  first=approve(first);
  const engine=accrualBalance(db,'36t','employee','annual',2026);
  assert.equal(engine.used_days,'7');assert.equal(engine.balance_days,'3');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_ledger WHERE kind IN ('reserve','debit')").get().n,0,'the opening ledger is untouched');
  assert.deepEqual(db.prepare('SELECT kind,used_milli,reserved_milli FROM leave_day_ledger WHERE request_id=? ORDER BY seq').all(first.id).map(x=>({...x})),[{kind:'reserve',used_milli:0,reserved_milli:7000},{kind:'debit',used_milli:7000,reserved_milli:-7000}]);
  act('employee',first,'cancel',{note:'إلغاء اختبار يرد الأيام إلى المحرك'});
  assert.equal(accrualBalance(db,'36t','employee','annual',2026).balance_days,'10');
  assert.throws(()=>db.exec('DELETE FROM leave_day_ledger'),/append only/);
  assert.equal(verifyAudit(db),true);
});

test('event types, exam notice and iddah limits follow their articles',t=>{
  const {ask,calendar}=fixture(t);
  // يوم عمل بعد أقل من 15 يومًا من اليوم: طلب الامتحان متأخر (م89).
  let soon=shift(today(),3);while([5,6].includes(new Date(`${soon}T00:00:00Z`).getUTCDay()))soon=shift(soon,1);
  if(soon.slice(0,4)!=='2026')calendar(Number(soon.slice(0,4)));
  assert.throws(()=>ask({leave_type:'exam',variant:'approved_enrolment',start_date:soon,end_date:soon,document:pdf('exam')}),code('notice_required'));
  assert.throws(()=>ask({leave_type:'exam',variant:'not_approved',start_date:'2026-12-06',end_date:'2026-12-06',document:pdf('exam2')}),code('exam_not_approved'));
  const repeated=ask({leave_type:'exam',variant:'repeated_year',start_date:'2026-12-07',end_date:'2026-12-07',document:pdf('exam3')});
  assert.equal(repeated.terms.pay[0].rate_bp,0,'a repeated year is unpaid');
  assert.throws(()=>ask({leave_type:'iddah',variant:'non_muslim',event_date:'2026-03-01',start_date:'2026-03-01',end_date:'2026-03-16',document:pdf('d1')}),code('entitlement_exceeded'));
  assert.equal(ask({leave_type:'iddah',variant:'non_muslim',event_date:'2026-03-01',start_date:'2026-03-01',end_date:'2026-03-15',document:pdf('d2')}).days,15);
  assert.throws(()=>ask({leave_type:'maternity',event_date:'2026-08-01',start_date:'2026-06-01',end_date:'2026-08-23',document:pdf('m1')}),code('too_early'));
  const maternity=ask({leave_type:'maternity',event_date:'2026-07-20',start_date:'2026-07-06',end_date:'2026-09-27',document:pdf('m2')});
  assert.equal(maternity.days,84);
});

test('the leave form, the catalog service and search all lead to the same request',async t=>{
  const {db,users,opening}=fixture(t);
  opening('employee','annual',5);
  const data={...listLeave(db,users.employee),user:users.employee};
  assert.equal(data.statutory.ready,true);
  const spec=leaveUI.form('request','new',data);
  assert.equal(spec.endpoint,'/leave/requests');assert.equal(spec.idempotent,true);
  assert.ok(spec.fields.some(f=>f.name==='document'&&f.type==='file'&&f.required===false));
  assert.ok(spec.fields.find(f=>f.name==='leave_type').options.some(o=>o.label.includes('الإجازة المرضية')));
  const preview=spec.live({leave_type:'annual',start_date:'2026-10-04',end_date:'2026-10-10'},e);
  assert.match(preview,/7 أيام تقويمية/);assert.match(preview,/يتجاوز المتاح/);
  assert.match(leavePreview({leave_type:'emergency',start_date:'2026-10-04',end_date:'2026-10-04',half_day:'on'},data,e),/0\.5 أيام عمل/);
  assert.match(leavePreview({leave_type:'sick'},data,e),/تقرير طبي/);
  assert.deepEqual(spec.toPayload({leave_type:'emergency',start_date:'2026-10-04',end_date:'2026-10-04',half_day:'on',variant:'exam:repeated_year',reason:'ظرف طارئ'}),
    {leave_type:'emergency',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-04',reason:'ظرف طارئ',half_day:true});
  assert.deepEqual(leaveUI.autoOpen('request',data),{action:'request',id:'new'});
  const html=leaveUI.render(data,{e,button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${e(label)}</button>`});
  assert.match(html,/data-operation="request" data-id="new"/);assert.match(html,/أرصدتي حسب النوع/);
  const hrData={...listLeave(db,users.hr),user:users.hr};
  assert.match(leaveUI.render(hrData,{e,button:(a,i,l)=>`<button>${e(l)}</button>`}),/إعداد الإجازات/);
  assert.equal(leaveUI.form('calendar','new',hrData).endpoint,'/leave/calendars');
  // «إجازة» في دليل الخدمات وفي البحث الشامل يقود إلى النموذج نفسه.
  assert.equal(MODULE_SERVICES[0].href,'#leave/request');
  assert.equal(searchModuleServices('إجازة')[0].code,'HR-LEAVE');assert.equal(searchModuleServices('اجازه مرضية')[0].code,'HR-LEAVE');
  const departments=db.prepare("SELECT id,name FROM departments WHERE tenant_id='36t'").all();
  assert.match(launcherResults({departments,services:[],me:users.employee,query:'إجازة',e}),/href="#leave\/request"/);
  const found=searchAll(db,users.employee,'إجازة');
  assert.equal(found.groups[0].key,'module_service');assert.equal(found.groups[0].results[0].href,'#leave/request');
  assert.equal(searchAll(db,users.admin,'إجازة').groups.some(g=>g.key==='module_service'),false,'the technical admin has no leave service');
});

test('HTTP: HR prepares, the HR manager accepts, HR sets the calendar, and the employee requests leave with a certificate',async t=>{
  const { once }=await import('node:events');const { randomUUID }=await import('node:crypto');const { createApp }=await import('../app/server.mjs');
  const db=openDb(':memory:');seed(db,'synthetic-leave-http');
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي',password_hash,'manager',NULL FROM users WHERE id='hr'");
  transaction(db,()=>grantAccess(db,db.prepare("SELECT * FROM users WHERE id='admin'").get(),{user_id:'hr-manager',capability:'hr.policy.accept',note:'مالك اعتماد سياسات الموارد البشرية'}));
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['employee','manager','hr','hr-manager']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-leave-http'})});
    sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:(await response.json()).csrf};
  }
  const call=async(who,path,input)=>{const r=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie:sessions[who].cookie,'x-csrf-token':sessions[who].csrf,'Idempotency-Key':randomUUID()},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
  const draft=await call('hr','/leave/types/draft',{effective_from:'2025-01-01'});assert.equal(draft.status,201);
  assert.equal((await call('hr',`/leave/types/${draft.body.id}/accept`,{note:'المعدة لا تعتمد مسودتها'})).status,403);
  assert.equal((await call('hr-manager',`/leave/types/${draft.body.id}/accept`,{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد'})).status,201);
  assert.equal((await call('employee','/leave/calendars',{employee_department_id:'creative',name:'تقويم',effective_from:'2026-01-01',effective_to:'2026-12-31',weekdays:[0,1,2,3,4]})).status,403);
  assert.equal((await call('hr','/leave/calendars',{employee_department_id:'creative',name:'تقويم الإجازات 2026',effective_from:'2026-01-01',effective_to:'2026-12-31',weekdays:[0,1,2,3,4]})).status,201);
  const created=await call('employee','/leave/requests',{leave_type:'sick',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-06',reason:'مرض مفاجئ',document:pdf('http')});
  assert.equal(created.status,201);assert.equal(created.body.days,3);assert.equal(created.body.documents.length,1);
  const approved=await call('manager',`/leave/requests/${created.body.id}/approve`,{version:created.body.version,note:''});
  assert.equal(approved.status,201);assert.equal(approved.body.stage,'pending_hr');
  const board=await call('employee','/leave');assert.equal(board.body.statutory.ready,true);assert.ok(board.body.statutory.balances.find(b=>b.code==='sick').window);
  for(const asset of ['/leave-count.mjs','/module-services.mjs'])assert.equal((await fetch(base+asset)).status,200,asset);
});

// دمج 20260919: بطاقة «إجازة» في الخيارات (101) والزر السريع والرابط العميق تقود إلى نموذج الأنواع النظامية (098) بعد اعتمادها.
test('integration: under an accepted leave-types policy the variant card, the quick action and #leave/new open the statutory request form',async t=>{
  const { variantCatalog } = await import('../app/service-catalog.mjs');
  const { homeBoard } = await import('../app/home.mjs');
  const { parseDeepLink } = await import('../app/static/deep-links.mjs');
  const {db,users}=fixture(t);
  const card=variantCatalog(db,users.employee).find(g=>g.code==='VAR-LEAVE');
  assert.ok(card,'the leave card is offered without an opening balance once the policy is accepted');
  const emergency=card.options.find(o=>o.code==='emergency');
  assert.equal(emergency.link,'#leave/new?kind=emergency');assert.equal(emergency.mode,'module');
  assert.ok(card.options.find(o=>o.code==='sick').docs.length,'a required document is listed before the form');
  assert.equal(homeBoard(db,users.employee).quick_actions.find(a=>a.key==='leave').ready,true);
  const link=parseDeepLink(emergency.link);
  assert.equal(link.operation,'create');assert.equal(link.alternate,'request');assert.deepEqual(link.fields,{leave_type:'emergency'});
  assert.equal(listLeave(db,users.employee).statutory.ready,true);
});
test('integration: before the policy is accepted the leave card and quick action follow opening balances only',async t=>{
  const { variantCatalog } = await import('../app/service-catalog.mjs');
  const { homeBoard } = await import('../app/home.mjs');
  const {db,users}=fixture(t,{accept:false});
  assert.equal(variantCatalog(db,users.employee).some(g=>g.code==='VAR-LEAVE'),false,'no balance and no accepted policy: no leave card');
  assert.equal(homeBoard(db,users.employee).quick_actions.find(a=>a.key==='leave')?.ready??false,false);
});
