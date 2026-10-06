import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead,commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { createClaim,claimAction,recordReceipt,receiptAction } from '../app/receivables.mjs';
import { recordCompanyProfile,approveCompanyProfile,recordCustomerProfile,prepareInvoice,prepareCreditNote,invoiceAction,getInvoice } from '../app/invoices.mjs';
import * as f from '../app/finance.mjs';
import { recordMapping,approveMapping,journalFromSource,statements } from '../app/ledger.mjs';
import { recordDepartmentCentre,decideDepartmentCentre } from '../app/payroll-ledger.mjs';

const code=value=>error=>error.code===value;
const address={building:'1234',street:'طريق مصطنع',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country:'SA'};
function fixture(t,{map=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-ledger-only');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['employee',['read','configure','prepare']],['manager',['read','configure','approve','post']],['outsider',['read']]])for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض دفتر مصطنع',null,now());
  const ref=(kind,input)=>transaction(db,()=>f.createFinanceReference(db,users.manager,kind,input));
  const account=(c,name,type)=>ref('accounts',{code:c,name,account_type:type,currency:'SAR'});
  const accounts={receivable:account('1100','ذمم العملاء','asset'),bank:account('1000','البنك','asset'),revenue:account('4000','إيراد الخدمات','income'),output_vat:account('2200','ضريبة مخرجات','liability'),salaries_expense:account('5000','رواتب','expense'),salaries_payable:account('2100','رواتب مستحقة','liability'),social_insurance_payable:account('2110','تأمينات مستحقة','liability')};
  const center=ref('cost_centers',{code:'GEN',name:'عام'}),year=new Date().getUTCFullYear(),period=ref('periods',{name:'سنة الاختبار',starts_on:`${year}-01-01`,ends_on:`${year}-12-31`});
  const mapPurpose=purpose=>{const {id}=transaction(db,()=>recordMapping(db,users.employee,{purpose,account_id:accounts[purpose].id,cost_center_id:center.id,effective_from:'2026-01-01'}));transaction(db,()=>approveMapping(db,users.manager,id,{note:'طابقت الحساب مع دليل الحسابات'}));return id;};
  if(map)for(const purpose of Object.keys(accounts))mapPurpose(purpose);
  const act=(who,c,action,input={})=>transaction(db,()=>commercialAction(db,users[who],c.id,action,{version:c.version,...input}));
  let c=transaction(db,()=>dealFor(db,users.employee,{name:'عميل دفتر مصطنع',registration_number:'LED-100',contact:'جهة مصطنعة',source:'اختبار',sector:'تجريبي'}));
  c=act('employee',c,'qualify',{need:'مخرج مصطنع',budget:'1000.00',currency:'SAR',timing:'2099-12-01',decision_maker:'ممثل عميل',service_fit:'مناسب للاختبار'});c=act('manager',c,'approve_qualification',{note:'تأهيل معتمد'});
  c=act('employee',c,'save_quote',boundQuote(db,c.id,{scope:'مخرج مصطنع',currency:'SAR',valid_until:'2099-12-01',lines:[{description:'حملة مصطنعة',quantity:'1',unit_price:'100.00',unit_cost:'20.00',discount:'0',tax_rate:'15',acceptance:'قبول بدليل',revisions:1}]}));
  c=act('employee',c,'submit_quote');c=act('manager',c,'approve_quote',{note:'عرض معتمد'});c=act('employee',c,'register_contract',{agreement_evidence:'اتفاق داخلي مصطنع موثق',customer_representative:'ممثل مصطنع'});scheduleFor(db,c.id);c=act('manager',c,'create_project',{member_ids:[]});
  c=act('employee',c,'submit_delivery',{line_index:0,evidence:'مرجع تسليم مصطنع'});c=act('manager',c,'accept_delivery',{delivery_id:c.deliveries[0].id,note:'مطابق للمعيار',acceptance_evidence:'مرجع قبول مصطنع',approver_id: approverFor(db, c.project_id)});
  let claim=transaction(db,()=>createClaim(db,users.employee,{delivery_id:c.deliveries[0].id,amount:'115.00',due_date:'2099-12-15',entitlement_evidence:'العقد والقبول يدعمان الاستحقاق المصطنع'}));
  claim=transaction(db,()=>claimAction(db,users.employee,claim.id,'submit',{version:claim.version}));claim=transaction(db,()=>claimAction(db,users.manager,claim.id,'approve',{version:claim.version,note:'استحقاق معتمد'}));
  const sellerId=transaction(db,()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة 3,6T المصطنعة',vat_number:'300000000000003',cr_number:'1010000001',address,effective_from:'2026-01-01'})).id;
  transaction(db,()=>approveCompanyProfile(db,users.manager,sellerId,{note:'طابقنا الشهادة المصطنعة'}));
  transaction(db,()=>recordCustomerProfile(db,users.employee,{case_id:c.id,legal_name:'شركة العميل المصطنعة',vat_number:'310000000000003',address,source:'شهادة مصطنعة من العميل'}));
  const step=(who,doc,action,input={})=>transaction(db,()=>invoiceAction(db,users[who],doc.id,action,{version:doc.version,...input}));
  const issue=doc=>step('manager',step('employee',doc,'submit'),'issue');
  const invoice=issue(getInvoice(db,users.employee,transaction(db,()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:'2026-09-01',vat_category:'standard'})).id));
  const journal=(kind,id)=>transaction(db,()=>journalFromSource(db,users.employee,{source_kind:kind,source_id:id,period_id:period.id}));
  const jAct=(who,j,action,values={})=>transaction(db,()=>f.journalAction(db,users[who],j.id,action,{version:j.version,note:'دليل قرار مالي مصطنع',...values}));
  const post=j=>jAct('manager',jAct('manager',jAct('employee',j,'submit'),'approve'),'post');
  return {db,users,accounts,center,period,claim,invoice,issue,journal,jAct,post,mapPurpose};
}

test('an issued invoice becomes one balanced draft journal whose lines cannot be edited or posted twice',t=>{
  const {db,users,accounts,center,period,invoice,journal,jAct,post}=fixture(t);
  const j=journal('tax_invoice',invoice.id);
  assert.equal(j.status,'draft');assert.equal(j.source_reference,invoice.number);
  assert.deepEqual(j.lines.map(l=>[l.account_id,l.debit_minor,l.credit_minor]),[[accounts.receivable.id,11500,0],[accounts.revenue.id,0,10000],[accounts.output_vat.id,0,1500]]);
  assert.throws(()=>journal('tax_invoice',invoice.id),code('duplicate_source'));
  const tampered={period_id:period.id,entry_date:j.entry_date,description:j.description,evidence:j.evidence,currency:'SAR',source_reference:j.source_reference,lines:[{account_id:accounts.receivable.id,cost_center_id:center.id,debit:'100.00',credit:'0',memo:'مبلغ معدل'},{account_id:accounts.revenue.id,cost_center_id:center.id,debit:'0',credit:'100.00',memo:'مبلغ معدل'}]};
  assert.throws(()=>transaction(db,()=>f.journalAction(db,users.employee,j.id,'edit',{version:j.version,...tampered})),code('source_mismatch'));
  assert.throws(()=>jAct('employee',jAct('employee',j,'submit'),'approve'),code('transition_denied'),'the preparer cannot approve the sourced journal either');
  assert.throws(()=>journal('tax_invoice',randomUUID()),code('source_not_ready'));
  assert.throws(()=>transaction(db,()=>journalFromSource(db,users.outsider,{source_kind:'tax_invoice',source_id:invoice.id,period_id:period.id})),code('ledger_access_denied'));
  assert.ok(verifyAudit(db));
});

test('statements come from posted journals only: invoice, credit note and receipt flow into income statement, balance sheet and the customer statement',t=>{
  const {db,users,claim,invoice,issue,journal,post}=fixture(t);
  let s=statements(db,users.manager);
  assert.equal(s.income_statement.net_minor,0);assert.equal(s.unposted,1,'issued but not yet posted is visible as pending');
  post(journal('tax_invoice',invoice.id));
  const note=issue(getInvoice(db,users.employee,transaction(db,()=>prepareCreditNote(db,users.employee,invoice.id,{amount:'23.00',reason:'خصم متفق عليه بعد مراجعة نطاق التسليم'})).id));
  post(journal('credit_note',note.id));
  const receipt=transaction(db,()=>recordReceipt(db,users.employee,claim.id,{reference:'RCPT-1',amount:'92.00',received_on:invoice.issued_at.slice(0,10),payer:'شركة العميل المصطنعة',evidence:'إشعار تحويل بنكي مصطنع محفوظ'}));
  assert.throws(()=>journal('ar_receipt',receipt.id),code('source_not_ready'),'an unconfirmed receipt is not cash');
  transaction(db,()=>receiptAction(db,users.manager,claim.id,receipt.id,'confirm',{note:'طابقت كشف الحساب',matching_evidence:'سطر كشف حساب مصطنع مطابق للمبلغ والتاريخ'}));
  post(journal('ar_receipt',receipt.id));
  s=statements(db,users.manager);
  assert.equal(s.income_statement.total_income_minor,8000,'100.00 net less 20.00 net credited');
  assert.equal(s.balance_sheet.total_assets_minor,9200,'cash 92.00 and receivable 0');
  assert.equal(s.balance_sheet.liabilities.find(r=>r.code==='2200').amount_minor,1200);
  assert.equal(s.balance_sheet.retained_earnings_minor,8000);assert.equal(s.balance_sheet.balanced,true);
  assert.deepEqual([s.vat.output_vat_minor,s.vat.taxable_sales_minor,s.vat.input_vat_minor],[1200,8000,null]);
  const customer=s.customers[0];
  assert.deepEqual([customer.invoiced_minor,customer.credited_minor,customer.received_minor,customer.balance_minor],[11500,2300,9200,0]);
  assert.equal(customer.movements.length,3);assert.equal(s.unposted,0);
  assert.throws(()=>statements(db,users.hr),code('ledger_access_denied'));
  assert.throws(()=>statements(db,users.manager,{from:'2026-12-01',to:'2026-01-01'}),code('date_order'));
});

test('a payroll run posts as totals only, and nothing posts without approved mappings recorded and approved by different people',t=>{
  const {db,users,accounts,center,invoice,journal,mapPurpose,post}=fixture(t,{map:false});
  assert.throws(()=>journal('tax_invoice',invoice.id),code('mapping_required'));
  const own=transaction(db,()=>recordMapping(db,users.employee,{purpose:'receivable',account_id:accounts.receivable.id,cost_center_id:center.id,effective_from:'2026-01-01'}));
  assert.throws(()=>transaction(db,()=>approveMapping(db,users.employee,own.id,{note:'اعتماد ذاتي'})),code('ledger_access_denied'));
  assert.throws(()=>transaction(db,()=>recordMapping(db,users.employee,{purpose:'revenue',account_id:accounts.bank.id,cost_center_id:center.id,effective_from:'2026-01-01'})),code('account_type'));
  assert.throws(()=>journal('tax_invoice',invoice.id),code('mapping_required'),'an unapproved mapping posts nothing');
  for(const purpose of ['salaries_expense','salaries_payable','social_insurance_payable'])mapPurpose(purpose);
  db.exec("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pol','36t','payroll_cycle','دورة','نص سياسة مصطنع كافٍ الطول للاختبار','{}','قرار مصطنع للاختبار','2026-01-01','accepted','hr','manager','2026-01-02T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
  db.exec("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,created_at,updated_at) VALUES('con','36t','employee','pol','indefinite','وظيفة','الرياض','2026-01-01',40,90,60,'[]',1000000,'SAR','عقد مصطنع','draft','hr','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
  db.exec("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,created_at,updated_at) VALUES('run','36t','2026-02','pol','draft',1,1000000,130000,870000,'hr','2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')");
  db.exec("INSERT INTO payroll_lines(id,run_id,user_id,contract_id,paid_fraction_bp,earnings,gross_minor,unpaid_absence_minor,social_insurance_minor,net_minor,variance_flag,basis) VALUES('line','run','employee','con',10000,'[]',1000000,35000,95000,870000,0,'{}')");
  assert.throws(()=>journal('payroll_run','run'),code('source_not_ready'),'a draft run is not a liability yet');
  db.exec("UPDATE payroll_runs SET status='in_review',version=version+1 WHERE id='run';UPDATE payroll_runs SET status='reviewed',reviewed_by='outsider',version=version+1 WHERE id='run';UPDATE payroll_runs SET status='approved',approved_by='manager',version=version+1 WHERE id='run'");
  // الحزمة 4 (P4-HR-3، الترحيل 174): مصروف الرواتب على مركز إدارة الموظف في آخر الشهر، فلا قيد قبل أن يكون لإدارتها مركز معتمد بيدين.
  assert.throws(()=>journal('payroll_run','run'),code('department_cost_centre_missing'));
  const centre=transaction(db,()=>recordDepartmentCentre(db,users.employee,{department_id:'creative',cost_center_id:center.id,effective_from:'2026-01-01',reason:'مركز الفريق الإبداعي المصطنع'}));
  transaction(db,()=>decideDepartmentCentre(db,users.manager,centre.id,'approve',{note:'طابقت المركز مع الهيكل'}));
  const j=journal('payroll_run','run');
  assert.deepEqual(j.lines.map(l=>[l.debit_minor,l.credit_minor]),[[965000,0],[0,95000],[0,870000]]);
  assert.equal(j.description.includes('1 موظف'),true);
  assert.equal(j.lines.some(l=>/employee|الموظفة/.test(l.memo)),false,'no individual salary reaches the ledger');
  post(j);
  const s=statements(db,users.manager,{from:'2026-01-01',to:'2026-12-31'});
  assert.equal(s.income_statement.total_expenses_minor,965000);assert.equal(s.balance_sheet.balanced,true);
});
