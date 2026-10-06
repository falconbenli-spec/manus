import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { cashForecastBoard, PAYROLL_PRIVACY_MIN } from '../app/cash-forecast.mjs';
import * as C from '../app/close-checklist.mjs';
import * as Pr from '../app/profitability.mjs';
import { FAMILIES, createClient } from '../app/agency.mjs';
import * as billing from '../app/billing-recurring.mjs';

// مراجعة أمنية 2026-09-18: المالية (التنبؤ النقدي، الإقفال، الربحية، الفوترة المتكررة).
const code=value=>error=>error.code===value;
const riyadh=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
function base(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-finance');t.after(()=>db.close());
  const tx=f=>transaction(db,f);
  const users=()=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,tx,users};
}

/* ───── التنبؤ النقدي ───── */
function payrollFixture(t,people){
  const {db,tx,users:load}=base(t);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير موارد مصطنع','unused','manager',NULL)");
  for(let i=1;i<=people;i++)db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES(?,'36t','creative',?,?,'unused','employee','manager')").run(`p${i}`,`p${i}`,`موظف مصطنع ${i}`);
  const users=load();
  for(const [user_id,capability] of [['hr-manager','hr.policy.accept'],['hr-manager','hr.contracts.approve'],['it','finance.forecast.view']])
    tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع للاختبار'}));
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2026-01-01',parameters}));
    tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار'}));};
  policy('pay_components',{components:['basic','housing']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:500});
  const contract=(userId,start,basic)=>{const {id}=tx(()=>prepareContract(db,users.hr,{user_id:userId,contract_type:'indefinite',job_title:'وظيفة',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:'2000.00'}],document_reference:'عقد مصطنع'}));
    for(const [who,action] of [['hr','submit_contract'],['hr-manager','approve_contract']])tx(()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version}));};
  const [y,m]=riyadh().split('-').map(Number);
  const nextMonth=m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,'0')}-01`;
  return {db,users,contract,nextMonth,board:()=>cashForecastBoard(db,users.it,{opening_balance:'0'})};
}

test('cash forecast: a single employee’s net salary is withheld, and the balances say so instead of showing it',t=>{
  const {contract,board}=payrollFixture(t,1);
  contract('p1','2026-01-01','8000.00');
  const data=board();
  assert.equal(data.payroll_coverage.length,1);
  assert.equal(data.payroll_coverage[0].amount_minor,null);
  assert.match(data.payroll_coverage[0].label,/محجوب لحماية الخصوصية/);
  const text=JSON.stringify(data);
  assert.ok(!/\(1 موظف/.test(text),'no headcount reaches the forecast');
  for(const week of data.weeks)assert.equal(week.confirmed_out_minor,0,'the withheld figure does not leak through a weekly total either');
  assert.ok(data.gaps.some(g=>g.includes('لم تدخل الأرصدة')));
});

test('cash forecast: a new hire joining a team of five does not reveal their salary by subtracting two months',t=>{
  const {contract,nextMonth,board}=payrollFixture(t,6);
  for(let i=1;i<=5;i++)contract(`p${i}`,'2026-01-01','8000.00');
  contract('p6',nextMonth,'12000.00');
  const data=board();
  const payroll=data.weeks.flatMap(w=>w.items).filter(i=>i.stream.startsWith('payroll_'));
  assert.equal(payroll.length,1,'one horizon line instead of monthly lines that differ by one person');
  assert.equal(payroll[0].stream,'payroll_aggregated');
  assert.ok(payroll[0].amount_minor>0,'with six people across the horizon the total itself stays in the balances');
  assert.ok(!/\d+ موظف/.test(payroll[0].label),'without any headcount');
  assert.ok(data.gaps.some(g=>g.includes('محجوب لحماية الخصوصية')));
});

test(`cash forecast: a steady team of ${PAYROLL_PRIVACY_MIN} still shows monthly totals`,t=>{
  const {contract,board}=payrollFixture(t,5);
  for(let i=1;i<=5;i++)contract(`p${i}`,'2026-01-01','8000.00');
  const data=board();
  assert.ok(data.payroll_coverage.length>=2);
  for(const event of data.payroll_coverage){assert.ok(event.amount_minor>0);assert.match(event.label,/5 موظف/);}
});

/* ───── الإقفال ───── */
test('close checklist: reading a period by its id needs the close capability or a task in that period',t=>{
  const {db,tx,users:load}=base(t);const U=load();
  const grant=(who,key)=>db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)').run(randomUUID(),'36t',who,key,'t','admin',now());
  grant('manager','finance.close.manage');grant('hr','finance.close.manage');
  const [y,m]=riyadh().split('-').map(Number),month=m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;
  tx(()=>C.createTemplate(db,U.manager,{title:'تسوية حساب مصطنعة',owner_id:'employee',due_day:5,basis:'قرار مالك إجراء الإقفال المصطنع'}));
  const p=tx(()=>C.openClosePeriod(db,U.manager,{period_key:month}));
  assert.throws(()=>C.getClosePeriod(db,U.outsider,p.id),code('not_found'),'a plain employee without a task learns nothing, not even that the period exists');
  assert.equal(C.getClosePeriod(db,U.employee,p.id).id,p.id,'the task owner still reads it');
  assert.equal(C.getClosePeriod(db,U.manager,p.id).id,p.id);
  assert.throws(()=>C.getClosePeriod(db,U.external,p.id),code('not_found'));
});

/* ───── الربحية ───── */
test('profitability: the read capability does not write service tags',t=>{
  const {db,tx,users:load}=base(t);const U=load();
  for(const [user_id,capability] of [['it','profitability.view'],['manager','profitability.view'],['manager','costing.manage']])
    tx(()=>grantAccess(db,U.admin,{user_id,capability,note:'تصريح مصطنع'}));
  db.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('p1','36t','مشروع','موجز','manager',?)").run(now());
  assert.throws(()=>tx(()=>Pr.tagProjectService(db,U.it,{project_id:'p1',family:FAMILIES[0].key,note:''})),code('not_permitted'));
  tx(()=>Pr.tagProjectService(db,U.manager,{project_id:'p1',family:FAMILIES[0].key,note:''}));
  assert.equal(db.prepare('SELECT tagged_by FROM project_service_tags WHERE project_id=?').get('p1').tagged_by,'manager');
});

/* ───── الفوترة المتكررة ───── */
function issuedInvoiceFor(db,projectId,clientId,sequence){
  const time=now(),ids={case:randomUUID(),qual:randomUUID(),quote:randomUUID(),contract:randomUUID(),claim:randomUUID(),invoice:randomUUID()};
  const snapshot=JSON.stringify({currency:'SAR',net_minor:'100000',tax_minor:'0',total_minor:'100000',lines:[]});
  db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,project_id,created_at,updated_at) VALUES(?,'36t','creative','manager','عميل تجريبي',?,'جهة اتصال','اختبار','خدمات','project_active',?,?,?)").run(ids.case,'REG-'+ids.case.slice(0,8),projectId,time,time);
  db.prepare("INSERT INTO commercial_qualifications VALUES(?,?,1,?, 'manager',?)").run(ids.qual,ids.case,snapshot,time);
  db.prepare("INSERT INTO commercial_quotes VALUES(?,?,?,1,?,'digest','manager',?)").run(ids.quote,ids.case,ids.qual,snapshot,time);
  db.prepare("INSERT INTO commercial_contracts VALUES(?,?,?,?,'سند اتفاق تجريبي','ممثل تجريبي','manager',?)").run(ids.contract,ids.case,ids.quote,snapshot,time);
  db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,created_at,updated_at) VALUES(?,'36t',?,?,?,'manager','advance','بند دفعة مقدمة تجريبي','{}','SAR','100000','2026-01-31','سند استحقاق تجريبي','approved',1,?,?)")
    .run(ids.claim,ids.contract,projectId,ids.case,time,time);
    // الترحيل 151 أضاف رموز المستند إلزاميةً على tax_invoices (نوع المستند وفئة الضريبة ووسيلة السداد)،
  // فالإدراج المباشر في هذا الاختبار يحملها كما يحملها مسار prepareInvoice الحقيقي.
db.prepare("INSERT INTO tax_invoices(id,tenant_id,kind,claim_id,project_id,sequence,number,issued_at,supply_date,seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,document_type_code,tax_category_code,payment_means_code,status,prepared_by,issued_by,chain_index,previous_hash,hash,qr_tlv,created_at,updated_at) VALUES(?,'36t','invoice',?,?,?,?,?,'2026-01-31','{}','{}','[]','zero_rated',0,'سبب تجريبي لعدم تطبيق النسبة','SAR',100000,0,100000,388,'Z','1','issued','manager','hr',?,'','hash-'||?,'qr',?,?)")
    .run(ids.invoice,ids.claim,projectId,sequence,'INV-SEC-'+sequence,time,sequence,String(sequence),time,time);
  if(clientId)db.prepare('INSERT INTO client_links(client_id,case_id,linked_by,linked_at) VALUES(?,?,?,?)').run(clientId,ids.case,'manager',time);
  return ids.invoice;
}
test('recurring billing: a draft is closed only by an invoice issued to its own client',t=>{
  const {db,tx,users:load}=base(t);const U=load();
  tx(()=>grantAccess(db,U.admin,{user_id:'manager',capability:'billing.recurring.manage',note:'تصريح مصطنع'}));
  const mine=tx(()=>createClient(db,U.manager,{legal_name:'عميل المسودة المصطنع',trade_name:'أ',sector:'تجريبي',status:'active',notes:''}));
  const other=tx(()=>createClient(db,U.manager,{legal_name:'عميل آخر مصطنع',trade_name:'ب',sector:'تجريبي',status:'active',notes:''}));
  db.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('bp','36t','مشروع فوترة','موجز','manager',?)").run(now());
  tx(()=>billing.createSchedule(db,U.admin,{client_id:mine.id,case_id:'',title:'اشتراك مصطنع',cadence:'monthly',issue_day:1,start_date:'2026-01-01',end_date:'2026-01-31',
    contract_reference:'بند مصطنع من العقد',owner_id:'admin',lines:[{description:'خدمة شهرية',amount:'1000.00'}]}));
  billing.runDueSchedules(db,'2026-01-05');
  const draft=db.prepare('SELECT * FROM billing_drafts').get();
  const foreign=issuedInvoiceFor(db,'bp',other.id,1),unlinked=issuedInvoiceFor(db,'bp',null,2),own=issuedInvoiceFor(db,'bp',mine.id,3);
  assert.throws(()=>tx(()=>billing.draftAction(db,U.manager,draft.id,'mark_issued',{version:draft.version,invoice_id:foreign,note:''})),code('invoice_client_mismatch'));
  assert.throws(()=>tx(()=>billing.draftAction(db,U.manager,draft.id,'mark_issued',{version:draft.version,invoice_id:unlinked,note:''})),code('invoice_client_mismatch'),'a case with no client link proves nothing');
  assert.throws(()=>db.prepare("UPDATE billing_drafts SET status='issued',issued_invoice_id=?,decided_by='manager',decided_at='x',version=version+1 WHERE id=?").run(foreign,draft.id),/its own client/,'and the database refuses it too');
  tx(()=>billing.draftAction(db,U.manager,draft.id,'mark_issued',{version:draft.version,invoice_id:own,note:''}));
  assert.equal(db.prepare('SELECT issued_invoice_id FROM billing_drafts WHERE id=?').get(draft.id).issued_invoice_id,own);
});
