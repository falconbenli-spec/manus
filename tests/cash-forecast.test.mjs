import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead,commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { createClaim,claimAction } from '../app/receivables.mjs';
import { getInvoice,recordCompanyProfile,approveCompanyProfile,recordCustomerProfile,prepareInvoice,invoiceAction } from '../app/invoices.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy,decidePolicy,prepareContract,contractAction,getContract } from '../app/hr-contracts.mjs';
import { cashForecastBoard,WEEKS } from '../app/cash-forecast.mjs';
import { cashForecastUI } from '../app/static/cash-close-ui.mjs';

const code=value=>error=>error.code===value;
const helpers={e:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${label}</button>`,money:m=>m===null||m===undefined?'—':`${m/100} SAR`};

const DAY=86400000;
const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plus=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
const sunday=date=>{const d=new Date(`${date}T00:00:00Z`);return new Date(d.getTime()-d.getUTCDay()*DAY).toISOString().slice(0,10);};
const address={building:'1234',street:'طريق مصطنع',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country:'SA'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-cash-forecast');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve']]])for(const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const grant=(who,capability)=>db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(),'36t',who,capability,'تصريح مصطنع للاختبار','admin',now());
  grant('employee','finance.forecast.view');
  const week0=sunday(riyadhToday());
  const act=(who,c,action,input={})=>transaction(db,()=>commercialAction(db,users[who],c.id,action,{version:c.version,...input}));
  let c=transaction(db,()=>dealFor(db,users.employee,{name:'عميل تنبؤ مصطنع',registration_number:'CF-100',contact:'جهة مصطنعة',source:'اختبار',sector:'تجريبي'}));
  c=act('employee',c,'qualify',{need:'مخرجان مصطنعان للتنبؤ',budget:'1000.00',currency:'SAR',timing:'2099-12-01',decision_maker:'ممثل عميل',service_fit:'مناسب للاختبار'});
  c=act('manager',c,'approve_qualification',{note:'تأهيل معتمد للاختبار'});
  c=act('employee',c,'save_quote',boundQuote(db,c.id,{scope:'مخرجان مصطنعان',currency:'SAR',valid_until:'2099-12-01',lines:[
    {description:'دفعة أولى مصطنعة',quantity:'1',unit_price:'100.00',unit_cost:'20.00',discount:'0',tax_rate:'15',acceptance:'قبول بدليل',revisions:1},
    {description:'دفعة ثانية مصطنعة',quantity:'1',unit_price:'200.00',unit_cost:'40.00',discount:'0',tax_rate:'15',acceptance:'قبول بدليل',revisions:1},
    {description:'دفعة ثالثة مصطنعة',quantity:'1',unit_price:'300.00',unit_cost:'60.00',discount:'0',tax_rate:'15',acceptance:'قبول بدليل',revisions:1}]}));
  c=act('employee',c,'submit_quote');c=act('manager',c,'approve_quote',{note:'عرض معتمد'});
  c=act('employee',c,'register_contract',{agreement_evidence:'اتفاق داخلي مصطنع موثق للاختبار',customer_representative:'ممثل مصطنع'});scheduleFor(db,c.id);
  c=act('manager',c,'create_project',{member_ids:[]});
  const approvedClaim=(lineIndex,amount,dueDate)=>{
    c=act('employee',c,'submit_delivery',{line_index:lineIndex,evidence:`مرجع تسليم مصطنع للبند ${lineIndex}`});
    const delivery=c.deliveries.at(-1);
    c=act('manager',c,'accept_delivery',{delivery_id:delivery.id,note:'مطابق لمعيار القبول',acceptance_evidence:'مرجع قبول داخلي مصطنع',approver_id: approverFor(db, c.project_id)});
    let claim=transaction(db,()=>createClaim(db,users.employee,{delivery_id:delivery.id,amount,due_date:dueDate,entitlement_evidence:'العقد والقبول يدعمان الاستحقاق المصطنع'}));
    claim=transaction(db,()=>claimAction(db,users.employee,claim.id,'submit',{version:claim.version}));
    return transaction(db,()=>claimAction(db,users.manager,claim.id,'approve',{version:claim.version,note:'استحقاق معتمد للاختبار'}));
  };
  const issueInvoiceFor=claim=>{
    const profile=transaction(db,()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة 3,6T المصطنعة',vat_number:'300000000000003',cr_number:'1010000001',address,effective_from:'2026-01-01'}));
    transaction(db,()=>approveCompanyProfile(db,users.manager,profile.id,{note:'طابقنا الشهادة الضريبية المصطنعة'}));
    transaction(db,()=>recordCustomerProfile(db,users.employee,{case_id:c.id,legal_name:'شركة العميل المصطنعة',vat_number:'310000000000003',address,source:'شهادة ضريبية مصطنعة'}));
    let doc=getInvoice(db,users.employee,transaction(db,()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:riyadhToday(),vat_category:'standard'})).id);
    doc=transaction(db,()=>invoiceAction(db,users.employee,doc.id,'submit',{version:doc.version}));
    return transaction(db,()=>invoiceAction(db,users.manager,doc.id,'issue',{version:doc.version}));
  };
  const board=(who='employee',input={})=>cashForecastBoard(db,users[who],input);
  return {db,users,grant,week0,approvedClaim,issueInvoiceFor,board,caseId:()=>c.id};
}

test('cash forecast: only an explicit capability opens it, and another tenant never appears in it',t=>{
  const {db,users,grant,board,week0,approvedClaim}=fixture(t);
  assert.throws(()=>board('manager'),code('not_permitted'),'a finance grant alone is not the forecast capability');
  assert.throws(()=>board('outsider'),code('not_permitted'));
  assert.throws(()=>cashForecastBoard(db,users.external,{}),code('not_permitted'));
  assert.throws(()=>cashForecastBoard(db,{id:'employee',tenant_id:'isolated'},{}),code('forbidden'),'an account is only ever read inside its own tenant');
  approvedClaim(0,'100.00',plus(week0,15));
  grant('manager','finance.forecast.view');
  assert.equal(board('manager').weeks.length,WEEKS);
  // الكيان الآخر يرى أفقه هو: لا مستند من الكيان الأول يعبر إليه.
  // المانح غير الممنوح — قيد الترحيل 144؛ التهيئة كانت تكتب الاثنين واحدًا وهي حالة لا تقع.
  db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(),'isolated','external','finance.forecast.view','تصريح مصطنع','admin',now());
  const isolated=cashForecastBoard(db,users.external,{});
  assert.equal(isolated.streams.length,0);
  assert.equal(isolated.weeks.reduce((n,w)=>n+w.expected_in_minor+w.confirmed_in_minor,0),0);
});

test('cash forecast: the horizon is thirteen rolling weeks and a claim lands in the week of its due date',t=>{
  const {board,week0,approvedClaim}=fixture(t);
  const empty=board();
  assert.equal(empty.horizon_weeks,13);assert.equal(empty.weeks.length,13);
  assert.equal(empty.week_starts_on,week0);
  assert.equal(empty.horizon_ends_on,plus(week0,90));
  assert.ok(empty.weeks.every((w,index)=>w.from===plus(week0,index*7)&&w.to===plus(w.from,6)),'every week is seven days after the one before it');
  approvedClaim(0,'100.00',plus(week0,17));
  const data=board();
  assert.equal(data.weeks[2].expected_in_minor,10000,'a claim due in the third week is counted in the third week');
  assert.equal(data.weeks.filter(w=>w.expected_in_minor).length,1);
  // ما بعد الأفق يُعلن ولا يُحشر في الأسبوع الثالث عشر.
  approvedClaim(1,'200.00',plus(week0,200));
  const wider=board();
  assert.equal(wider.beyond_horizon.in_minor,20000);assert.equal(wider.beyond_horizon.items,1);
  assert.equal(wider.weeks[12].expected_in_minor,0);
});

test('cash forecast: an issued invoice is confirmed, an unbilled entitlement is expected, and the two are never one number',t=>{
  const {board,week0,approvedClaim,issueInvoiceFor}=fixture(t);
  const invoiced=approvedClaim(0,'100.00',plus(week0,10));
  approvedClaim(1,'200.00',plus(week0,10));
  assert.equal(board().weeks[1].confirmed_in_minor,0,'nothing is confirmed before an invoice exists');
  issueInvoiceFor(invoiced);
  const data=board();
  assert.equal(data.weeks[1].confirmed_in_minor,10000);
  assert.equal(data.weeks[1].expected_in_minor,20000);
  assert.ok(!Object.hasOwn(data.weeks[1],'total_in_minor'),'the two certainties are never merged into one figure');
  assert.equal(data.weeks[1].closing_confirmed_minor,10000);
  assert.equal(data.weeks[1].closing_with_expected_minor,30000);
  assert.deepEqual([...new Set(data.streams.map(s=>s.stream))].sort(),['approved_claims_uninvoiced','invoiced_receivables']);
});

test('cash forecast: a recorded collection promise moves money to its promised date and stays expected',t=>{
  const {db,board,week0,approvedClaim,issueInvoiceFor,users}=fixture(t);
  const claim=approvedClaim(0,'100.00',plus(week0,3));
  issueInvoiceFor(claim);
  assert.equal(board().weeks[0].confirmed_in_minor,10000);
  transaction(db,()=>db.prepare('INSERT INTO ar_promises VALUES(?,?,?,?,?,?,?,?)')
    .run(randomUUID(),claim.id,'6000',plus(week0,45),'جهة اتصال مصطنعة','محضر مكالمة مصطنع',users.employee.id,now()));
  const data=board();
  assert.equal(data.weeks[0].confirmed_in_minor,4000,'only what was not promised keeps the invoice date');
  assert.equal(data.weeks[6].expected_in_minor,6000,'a promise is expected, never confirmed');
  assert.equal(data.weeks[6].confirmed_in_minor,0);
});

test('cash forecast: the opening balance is a manual input that is declared missing, and nothing the screen computes is stored',t=>{
  const {db,board,week0,approvedClaim}=fixture(t);
  approvedClaim(0,'100.00',plus(week0,10));
  const bare=board();
  assert.equal(bare.opening_balance_minor,null);
  assert.equal(bare.opening_required,true);
  assert.match(bare.note,/المطابقة البنكية/);
  // بلا تسوية بنكية معتمدة يبقى الرقم إدخالًا يدويًا مسمّى كذلك؛ ومصدر «التسوية البنكية» تقرؤه المنصة ولا يُكتب (tests/finance-visibility.test.mjs).
  const withOpening=board('employee',{opening_balance:'500.00',opening_source:'accountant',opening_note:'كشف مصطنع أكده المحاسب'});
  assert.equal(withOpening.opening_balance_minor,50000);
  assert.equal(withOpening.opening.source,'manual');
  assert.equal(withOpening.opening_required,false);
  assert.throws(()=>board('employee',{opening_balance:'500.00',opening_source:'bank_reconciliation'}),code('opening_source'));
  assert.equal(withOpening.weeks[1].closing_with_expected_minor,60000);
  assert.throws(()=>board('employee',{opening_source:'plugged_from_the_bank_api'}),code('opening_source'));
  const before=db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%forecast%'").get().n;
  assert.equal(before,0,'the forecast owns no table: nothing it computes becomes a stored fact');
});

test('cash forecast: scenarios are manual inputs computed on the spot, never stored and never changing a document',t=>{
  const {db,board,week0,approvedClaim,caseId}=fixture(t);
  approvedClaim(0,'100.00',plus(week0,10));
  const baseline=board('employee',{opening_balance:'0.00'});
  const auditBefore=db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  const delayed=board('employee',{opening_balance:'0.00',scenarios:[{kind:'client_delay',case_id:caseId(),delay_days:30}]});
  assert.equal(delayed.scenarios.length,1);
  assert.equal(delayed.scenarios[0].stored,false);
  assert.equal(delayed.weeks[1].expected_in_minor,10000,'the baseline the screen shows is untouched by the scenario');
  assert.equal(delayed.scenarios[0].weeks[1].closing_with_expected_minor,0,'in the scenario the money has moved out of week two');
  assert.equal(delayed.scenarios[0].weeks[5].closing_with_expected_minor,10000);
  const lost=board('employee',{opening_balance:'0.00',scenarios:[{kind:'client_lost',case_id:caseId()}]});
  assert.equal(lost.scenarios[0].min_with_expected_minor,0);
  const hire=board('employee',{opening_balance:'0.00',scenarios:[{kind:'new_hire',monthly_amount:'8000.00',starts_on:plus(week0,7)}]});
  assert.ok(hire.scenarios[0].min_with_expected_minor<baseline.min_with_expected_minor,'a new hire only ever costs money');
  assert.ok(hire.scenarios[0].delta_min_with_expected_minor<0);
  assert.throws(()=>board('employee',{scenarios:[{kind:'sell_the_office'}]}),code('scenario_kind'));
  assert.throws(()=>board('employee',{scenarios:[{kind:'collection_delay',delay_days:400}]}),code('delay_days'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,auditBefore,'reading a what-if writes nothing, not even an audit row');
});

test('cash forecast: no collection rate is invented, and a small sample says so instead of pretending',t=>{
  const {db,board,week0,approvedClaim,users}=fixture(t);
  const claim=approvedClaim(0,'100.00',plus(week0,10));
  const empty=board().collection_history;
  assert.equal(empty.available,false);assert.equal(empty.sample_size,0);
  assert.match(empty.note,/لا تُفترض نسبة/);
  transaction(db,()=>db.prepare("INSERT INTO ar_receipts VALUES(?,?,?,?,?,?,?,?,?,'confirmed',?)")
    .run(randomUUID(),claim.id,'36t','CF-RECEIPT-1','1000',plus(week0,17),'عميل مصطنع','إشعار مصطنع',users.employee.id,now()));
  const small=board().collection_history;
  assert.equal(small.sample_size,1);assert.equal(small.reliable,false);
  assert.match(small.note,/عينة صغيرة/);
  assert.equal(small.median_lag_days,7,'the lag is measured from the platform record, not assumed');
  // السياق التاريخي لا يُطبَّق على أي بند: المتوقع بقي على تاريخ استحقاقه لا على متوسط التأخر.
  assert.equal(board().weeks[1].expected_in_minor,9000);
});

test('cash forecast: salaries are a total from live contracts, never a person, and what the platform cannot know is declared',t=>{
  const {db,board,week0,approvedClaim}=fixture(t);
  approvedClaim(0,'100.00',plus(week0,10));
  const data=board();
  assert.ok(data.gaps.some(g=>/المصروفات المتكررة/.test(g)),'recurring costs still have no cadence anywhere in the platform and the screen says so instead of spreading a contract value');
  assert.ok(data.gaps.some(g=>/سياسة دورة رواتب معتمدة/.test(g)),'with no accepted payroll cycle policy the salary line is declared missing, not guessed at');
  assert.ok(data.gaps.some(g=>/حصة المنشأة في التأمينات/.test(g)));
  assert.equal(data.payroll_coverage.length,0);
  const names=new Set(db.prepare("SELECT name FROM users WHERE tenant_id='36t'").all().map(r=>r.name));
  const text=JSON.stringify(data);
  for(const name of names)assert.ok(!text.includes(name),`the forecast never names an employee (${name})`);
  assert.ok(verifyAudit(db));
});

test('cash forecast: live contracts answer “do I cover payroll?” as a total only, with its pay-date assumption declared',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-cash-payroll');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [user_id,capability] of [['hr-manager','hr.policy.accept'],['hr-manager','hr.contracts.approve'],['employee','finance.forecast.view']])
    transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع للاختبار'}));
  const policy=(kind,parameters,title)=>{
    const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2026-01-01',parameters}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']},'بنود الراتب');
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:500},'دورة الرواتب');
  const {id:contractId}=transaction(db,()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2026-01-01',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد مصطنع'}));
  for(const [who,action] of [['hr','submit_contract'],['hr-manager','approve_contract']])
    transaction(db,()=>contractAction(db,users[who],contractId,action,{version:getContract(db,users[who],contractId).version}));
  const data=cashForecastBoard(db,users.employee,{opening_balance:'1000.00'});
  // مراجعة أمنية 2026-09-18: كان هذا الاختبار يثبت أن مجموع شهر فيه موظف واحد (9,525) يظهر لحامل تصريح التنبؤ،
  // وهو صافي راتب ذلك الموظف. عدد أقل من الحد الأدنى يُحجب الآن؛ التغطية بالمجموع مع خمسة موظفين في tests/security-finance.test.mjs.
  assert.equal(data.payroll_coverage.length,1,'one horizon line instead of monthly lines');
  assert.equal(data.payroll_coverage[0].amount_minor,null,'a single employee’s net salary never reaches the forecast');
  assert.match(data.payroll_coverage[0].label,/محجوب لحماية الخصوصية/);
  assert.ok(data.assumptions.some(a=>/يوم الصرف/.test(a)),'the pay-date basis is declared, not silently assumed');
  assert.equal(data.streams.find(s=>s.stream==='payroll_aggregated').certainty,'confirmed');
  assert.ok(data.gaps.some(g=>/لم تدخل الأرصدة/.test(g)),'and the forecast says the balances exclude it');
  const text=JSON.stringify(data);
  assert.ok(!text.includes(users.employee.name)&&!text.includes('8000'),'no individual salary and no employee name reaches the forecast');
  assert.ok(verifyAudit(db));
});

test('cash forecast screen: it renders from real board data under the strict content policy',t=>{
  const {board,week0,approvedClaim,caseId}=fixture(t);
  approvedClaim(0,'100.00',plus(week0,10));
  const data=board('employee',{opening_balance:'500.00',opening_source:'accountant',opening_note:'كشف مصطنع أكده المحاسب',scenarios:[{kind:'collection_delay',delay_days:14}]});
  const html=cashForecastUI.render(data,{e:helpers.e,button:helpers.button,money:helpers.money});
  assert.ok(!/style=|<script/.test(html),'no inline style and no script: the page runs under a strict content policy');
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.ok(html.includes('غير محفوظ')&&html.includes('المصروفات المتكررة'),'the screen says what it does not do');
  const form=cashForecastUI.form('run_scenario','',data);
  assert.ok(form.fields.find(f=>f.name==='case_id').options.some(o=>o.value===caseId()));
});

test('cash forecast: a contracted subscription is expected money on its own billing dates, counted once',t=>{
  const {db,board,week0,caseId}=fixture(t);
  const startMonth=`${plus(week0,-40).slice(0,7)}-01`;
  db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,sector,status,owner_id,created_at,updated_at) VALUES('cf-client','36t','CF','عميل اشتراك مصطنع','تجريبي','active','manager',?,?)").run(now(),now());
  db.prepare(`INSERT INTO billing_schedules(id,tenant_id,client_id,case_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,end_date,status,owner_id,created_by,created_at,updated_at)
    VALUES('cf-sched','36t','cf-client',?,'اشتراك إدارة حسابات مصطنع','monthly',10,'[{"description":"إدارة شهرية","amount_minor":250000}]','SAR',250000,'بند العقد المصطنع رقم 1',?,NULL,'active','manager','manager',?,?)`)
    .run(caseId(),startMonth,now(),now());
  const data=board();
  const subscription=data.streams.find(s=>s.stream==='contracted_subscriptions');
  assert.ok(subscription,'the recurring-billing schedule is a real source, not a guess');
  assert.equal(subscription.certainty,'expected','a contracted subscription is committed, but its invoice is not issued yet');
  assert.ok(subscription.count>=3,'every billing date inside the horizon is counted');
  assert.equal(subscription.amount_minor,subscription.count*250000);
  // فترة وُلّدت لها مسودة تُحسب من المسودة لا من الجدولة: لا ازدواج.
  const first=data.weeks.flatMap(w=>w.items).find(i=>i.stream==='contracted_subscriptions');
  db.prepare("INSERT INTO billing_drafts(id,tenant_id,schedule_id,client_id,period_start,period_end,lines,currency,total_minor,status,created_at,updated_at) VALUES('cf-draft','36t','cf-sched','cf-client',?,?,'[]','SAR',250000,'pending_review',?,?)")
    .run(`${first.date.slice(0,8)}01`,`${first.date.slice(0,8)}28`,now(),now());
  db.prepare("INSERT INTO billing_schedule_runs VALUES('cf-sched',?,?,'cf-draft','draft','',?)").run(`${first.date.slice(0,8)}01`,`${first.date.slice(0,8)}28`,now());
  const after=board();
  assert.equal(after.streams.find(s=>s.stream==='contracted_subscriptions').count,subscription.count-1);
  assert.equal(after.streams.find(s=>s.stream==='subscription_drafts').count,1);
  const total=s=>after.streams.filter(x=>x.stream===s).reduce((n,x)=>n+x.amount_minor,0);
  assert.equal(total('contracted_subscriptions')+total('subscription_drafts'),subscription.amount_minor,'nothing is counted twice and nothing disappears');
});
