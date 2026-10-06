import { fundProject } from './budget-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,verifyAudit,now } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import * as f from '../app/finance.mjs';
import * as p from '../app/procurement.mjs';
import { createProject } from '../app/projects.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { recordMapping, approveMapping, journalFromSource } from '../app/ledger.mjs';
import { recordInputTax, decideInputTax } from '../app/payables.mjs';

// الاستلام يُسجَّل اليوم، فأمر المباشرة يبدأ اليوم: الإذن الذي لم يبدأ سريانه لا يفتح استلامًا (الترحيل 162).
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-finance-only');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const who of ['employee','manager'])for(const action of ['read','configure','prepare','approve','post','reverse','source_procurement'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','منحة مالية مصطنعة صريحة',null,now());
  const reference=(kind,input)=>transaction(db,()=>f.createFinanceReference(db,users.manager,kind,input));
  const expense=reference('accounts',{code:'EXP-LOCAL',name:'مصروف اختبار',account_type:'expense',currency:'SAR'}),liability=reference('accounts',{code:'AP-LOCAL',name:'التزام اختبار',account_type:'liability',currency:'SAR'});
  const center=reference('cost_centers',{code:'TEST-CC',name:'مركز تكلفة مصطنع'}),period=reference('periods',{name:'فترة اختبار 2026',starts_on:'2026-01-01',ends_on:'2026-12-31'});
  const input=()=>({period_id:period.id,entry_date:'2026-09-10',description:'قيد مصطنع متوازن',evidence:'دليل اختبار محلي',currency:'SAR',source_reference:randomUUID(),lines:[{account_id:expense.id,cost_center_id:center.id,debit:'10.01',credit:'0',memo:'مصروف مصطنع'},{account_id:liability.id,cost_center_id:center.id,debit:'0',credit:'10.01',memo:'التزام مصطنع'}]});
  const make=values=>transaction(db,()=>f.createJournal(db,users.employee,values??input()));
  const act=(who,j,action,values={})=>transaction(db,()=>f.journalAction(db,users[who],j.id,action,{version:j.version,...(!['edit','reverse'].includes(action)?{note:'دليل قرار مالي مصطنع'}:{}),...values}));
  const post=j=>act('manager',act('manager',act('employee',j,'submit'),'approve'),'post');
  // بوابة المورد (app/vendors.mjs): الكيان الذي بلا ملف ما عاد يُقبل عرضه ولا تُرسى عليه ترسية،
  // فكل مفتاح يمرّ في add_quote يحتاج ملفًا مؤهلًا فعلًا يبنيه المساعد بالمسار الحقيقي.
  // وموضعه آخر التجهيز عمدًا: المساعد يمنح vendors.manage بنفسه، فلو سبق منح الاختبار لاصطدما.
  approveVendors(db,['LOCAL-A', 'LOCAL-B', 'LOCAL-C']);
  return {db,users,reference,expense,liability,center,period,input,make,act,post};
}
test('FIN-01/06/09: a balanced journal reaches an immutable local posting and a sourced trial balance',t=>{
  const {db,users,make,post}=fixture(t);const draft=make();assert.equal(f.listFinance(db,users.manager).trial_balance.total_debit_minor,0);
  const j=post(draft),report=f.listFinance(db,users.manager);assert.equal(j.status,'posted');assert.equal(report.trial_balance.total_debit_minor,1001);assert.equal(report.trial_balance.total_credit_minor,1001);assert.equal(report.ledger.length,2);assert.equal(report.trial_balance.is_balanced,true);
  // حالة الدفع لا تُكتب على التقرير كله نصًّا ثابتًا: كل مستحق يحمل حالته من أمر دفعه (tests/ledger-completeness.test.mjs).
  assert.equal('payment_status' in report,false);assert.equal(report.external_posting_status,'not_configured');
  assert.throws(()=>db.prepare('DELETE FROM finance_lines WHERE journal_id=?').run(j.id));assert.throws(()=>db.prepare("UPDATE finance_journals SET status='draft',version=version+1 WHERE id=?").run(j.id));assert.ok(verifyAudit(db));
});
test('FIN-01/06: unbalanced, floating, negative, empty or two-sided amounts cannot create a journal',t=>{
  const {db,input,make}=fixture(t);
  for(const edit of [i=>i.lines[1].credit='10',i=>i.lines[0].debit=10.01,i=>i.lines[0].debit='1e2',i=>i.lines[0].debit='-1',i=>i.lines[0].credit='1',i=>i.lines=[],i=>i.lines[0].debit='10.001',i=>i.currency='USD',i=>i.entry_date='2026-02-30']){const values=input();edit(values);assert.throws(()=>make(values));}
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_journals').get().n,0);
});
test('FIN-06: returned revisions require a fresh independent approval and cannot skip posting',t=>{
  const {db,users,make,act,input}=fixture(t);let j=make();assert.throws(()=>act('manager',j,'post'),{code:'transition_denied'});
  j=act('employee',j,'submit');assert.throws(()=>act('employee',j,'approve'),{code:'transition_denied'});j=act('manager',j,'return');
  const edits=input();edits.source_reference=j.source_reference;
  j=act('employee',j,'edit',edits);
  assert.throws(()=>act('manager',j,'post'),{code:'transition_denied'});j=act('employee',j,'submit');assert.equal(j.revision,2);
  j=act('manager',j,'approve');j=act('manager',j,'post');assert.equal(j.decisions.length,2);assert.equal(f.listFinance(db,users.manager).ledger.length,2);
});
test('FIN-06/09: a closed period and deactivated reference block a pending posting',t=>{
  const {db,users,make,act,period,expense}=fixture(t);let j=make();j=act('manager',act('employee',j,'submit'),'approve');
  transaction(db,()=>f.financeReferenceAction(db,users.manager,'accounts',expense.id,'deactivate',{version:expense.version,note:'تعليق حساب اختبار'}));
  assert.throws(()=>act('manager',j,'post'),{code:'inactive_reference'});
  transaction(db,()=>f.financeReferenceAction(db,users.manager,'accounts',expense.id,'activate',{version:expense.version+1,note:'استعادة حساب اختبار'}));
  transaction(db,()=>f.financeReferenceAction(db,users.manager,'periods',period.id,'close',{version:period.version,note:'إقفال فترة مصطنعة'}));
  assert.throws(()=>act('manager',j,'post'),{code:'period_closed'});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_postings').get().n,0);
});
test('FIN-06: an exact reversal is prepared and approved separately, then offsets the ledger once',t=>{
  const {db,users,make,post,act,period}=fixture(t);const j=post(make());
  assert.throws(()=>act('employee',j,'reverse',{period_id:period.id,entry_date:'2026-09-11',reason:'عكس اختبار',evidence:'دليل العكس'}),{code:'transition_denied'});
  const reverseInput={version:j.version,period_id:period.id,entry_date:'2026-09-11',reason:'عكس تجربة محفوظة',evidence:'دليل عكس مصطنع'};
  let r=transaction(db,()=>f.journalAction(db,users.manager,j.id,'reverse',reverseInput));
  assert.equal(r.lines[0].credit_minor,j.lines[0].debit_minor);
  assert.throws(()=>transaction(db,()=>f.journalAction(db,users.manager,j.id,'reverse',reverseInput)),{code:'duplicate_reversal'});
  r=act('manager',r,'submit');assert.throws(()=>act('manager',r,'approve'),{code:'transition_denied'});r=act('employee',r,'approve');r=act('employee',r,'post');
  assert.equal(r.status,'posted');assert.ok(f.listFinance(db,users.manager).trial_balance.rows.every(row=>row.balance_debit_minor===0&&row.balance_credit_minor===0));assert.ok(verifyAudit(db));
});
test('IT-02/PLT-05: financial reads and writes require current explicit unexpired grants',t=>{
  const {db,users,make,act}=fixture(t);const j=make();
  for(const who of ['admin','hr','it','external','outsider'])assert.throws(()=>f.listFinance(db,users[who]),{code:'financial_access_denied'});
  db.prepare("UPDATE finance_grants SET revoked_at=? WHERE user_id='employee' AND action='read'").run(now());
  assert.throws(()=>act('employee',j,'submit'),{code:'financial_access_denied'});
  db.exec("UPDATE users SET role='employee' WHERE id='manager'");assert.throws(()=>f.listFinance(db,users.manager),{code:'financial_access_denied'});
});
test('FIN-06: posting checks whether the original approver still holds authority',t=>{
  const {db,make,act}=fixture(t);let j=act('manager',act('employee',make(),'submit'),'approve');
  db.prepare("UPDATE finance_grants SET revoked_at=? WHERE user_id='manager' AND action='approve'").run(now());
  assert.throws(()=>act('manager',j,'post'),{code:'approval_authority_revoked'});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_postings').get().n,0);
});
test('FIN-05/06: a matched procurement reference creates one exact payable journal',t=>{
  const {db,users,period,expense,liability,center,post}=fixture(t);
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع مصدر مالي',brief:'اختبار ربط المستحق',member_ids:['employee']}));
  fundProject(db,project.id,'TEST-CC');
  let purchase=transaction(db,()=>p.createPurchase(db,users.employee,{project_id:project.id,title:'احتياج مالي مصطنع',specification:'وحدة اختبار',cost_center:'TEST-CC',due_date:'2026-12-10',quantity:1,unit:'وحدة',budget_amount:'50',budget_evidence:'مخصص اختبار',currency:'SAR'}));
  const action=(who,kind,values)=>{purchase=transaction(db,()=>p.procurementAction(db,users[who],purchase.id,kind,{version:purchase.version,...values}));};
  action('employee','submit',{});
  for(const supplier_key of ['A','B','C'])action('employee','add_quote',{supplier_key:'LOCAL-'+supplier_key,supplier_name:'مورد مصطنع '+supplier_key,unit_price:'10.01',technical_assessment:'مطابق للمواصفات',financial_terms:'شروط عينة محلية',delivery_date:'2026-12-10',evidence:'عرض اختبار'});
  action('manager','award',{quote_id:purchase.quotes[0].id,note:'مراجعة مقارنة العرضين'});action('manager','approve_order',{terms:'أمر داخلي فقط',delivery_date:'2026-12-10',note:'اعتماد نسخة العينة'});action('manager','commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'موقع المورد المصطنع',scope_confirmation:'إذن بدء على النطاق المعتمد في الأمر الداخلي',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});action('employee','receive',{quantity:1,reference:'REC-LOCAL',evidence:'فحص واستلام'});action('employee','record_invoice',{supplier_reference:'INV-LOCAL',quantity:1,amount:'10.01',evidence:'مرجع مصطنع'});action('manager','match',{invoice_id:purchase.invoices[0].id,note:'مطابقة محلية'});
  const input={payable_id:purchase.payables[0].id,period_id:period.id,entry_date:'2026-09-10',description:'قيد المستحق المصدر',evidence:'ربط الاختبار',debit_account_id:expense.id,credit_account_id:liability.id,cost_center_id:center.id};
  // الحزمة 3: المسار اليدوي كان يبني سطرين بالإجمالي على حسابين يختارهما المُعدّ ومركز واحد، بلا ضريبة مدخلات. أُغلق لقيد جديد،
  // والقيد الواحد الدقيق للمستحق يُبنى الآن من فاتورة المورد نفسها (app/ledger.mjs، supplier_invoice) بالربط المحاسبي المعتمد.
  let refusal=null;try{transaction(db,()=>f.createJournalFromPayable(db,users.employee,input));}catch(error){refusal=error;}
  assert.equal(refusal?.code,'payable_source_moved');assert.match(refusal.details.refusal.next,/القوائم المالية/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_journals').get().n,0,'the closed path writes nothing');
  for(const [purpose,account] of [['supplier_cost',expense],['payable',liability]]){const {id}=transaction(db,()=>recordMapping(db,users.employee,{purpose,account_id:account.id,cost_center_id:center.id,effective_from:'2026-01-01'}));transaction(db,()=>approveMapping(db,users.manager,id,{note:'ربط اختبار معتمد'}));}
  // المورد مسجّل ضريبيًا (vendor-fixture): فاتورته صفرية الضريبة تُسجَّل ويتحقق منها شخص ثانٍ، فلا سطر ضريبة مدخلات.
  const vat=db.prepare("SELECT vat_number FROM vendors WHERE supplier_key='LOCAL-A'").get().vat_number;
  const tax=transaction(db,()=>recordInputTax(db,users.employee,{invoice_id:purchase.invoices[0].id,supplier_vat_number:vat,supplier_invoice_number:'TAX-LOCAL',invoice_date:today(),vat:'0.00',evidence:'فاتورة ضريبية مصطنعة صفرية الضريبة'}));
  transaction(db,()=>decideInputTax(db,users.manager,tax.id,'verify',{note:'طابقنا الفاتورة الضريبية المصطنعة'}));
  const source={source_kind:'supplier_invoice',source_id:purchase.payables[0].id,period_id:period.id};
  const j=transaction(db,()=>journalFromSource(db,users.employee,source));assert.equal(j.lines[0].debit_minor,1001);assert.equal(j.lines.length,2);
  assert.throws(()=>transaction(db,()=>journalFromSource(db,users.employee,source)),{code:'duplicate_source'});
  assert.throws(()=>transaction(db,()=>f.createJournalFromPayable(db,users.employee,input)),{code:'payable_source_moved'});
  assert.equal(f.listFinance(db,users.employee).eligible_payables[0].posting_status,'not_posted');post(j);assert.equal(f.listFinance(db,users.employee).eligible_payables[0].posting_status,'posted_locally');assert.equal(p.listProcurement(db,users.employee)[0].payment_status,'not_paid');
  assert.equal(f.listFinance(db,users.employee).eligible_payables[0].payment_status,'not_paid','each payable carries its payment state from its payment orders');
});
test('FIN-06 PLT-06/09: idempotent creation and rollback preserve one journal and its audit',t=>{
  const {db,users,input}=fixture(t),values=input(),key=randomUUID();
  const create=()=>f.createJournal(db,users.employee,values),read=id=>f.listFinance(db,users.employee).journals.find(j=>j.id===id);
  const first=transaction(db,()=>createOnce(db,users.employee,'journal',key,values,create,read));assert.equal(transaction(db,()=>createOnce(db,users.employee,'journal',key,values,create,read)).id,first.id);
  db.exec("CREATE TEMP TRIGGER fail_finance_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
  assert.throws(()=>transaction(db,()=>f.createJournal(db,users.employee,input())),/test audit failure/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_journals').get().n,1);
});
