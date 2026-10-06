import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as f from '../app/finance.mjs';
import { recordMapping,approveMapping,journalFromSource,statements } from '../app/ledger.mjs';
import { recordRateSetting,confirmRateSetting,recordWithholding,withholdingBoard } from '../app/tax-returns.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase,procurementAction } from '../app/procurement.mjs';
import { createVendor,vendorAction,getVendor } from '../app/vendors.mjs';
import { preparePayment,getOrder,paymentAction } from '../app/payables.mjs';
import { fundProject } from './budget-fixture.mjs';

// لماذا هذا الملف موجود: سجل الاستقطاع كان يحسب المبلغ المستقطع ويحفظه ولا يصل الدفتر أبدًا — لا نوع مستند
// «withholding» في SOURCE_KINDS ولا غرض محاسبي للالتزام تجاه الهيئة. فالتزامٌ قائم على المنشأة لا يظهر في
// أي قائمة مالية، ويُعرف فقط لمن يفتح شاشة الضرائب. هنا يُبنى قيده من أرقام السجل نفسه ويمر بالاعتماد
// والترحيل المستقلين كبقية المستندات.
// والحد الثاني الذي يحرسه هذا الملف: القيد لا يُبنى حين تكذّبه أرقام أمر الدفع المرتبط. أمر دفع نُفِّذ بالمبلغ
// كاملًا يعني أن المستفيد استلم 100% ولم يُستقطع منه شيء، وقيد «من ذمم الموردين إلى استقطاع مستحق» حينها
// يخصم الذمة مرتين. الرفض يقول ذلك بالأرقام بدل أن يضيف رقمًا خاطئًا إلى الدفتر.

const code=value=>error=>error.code===value;
const iban=bban=>{const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;};
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const ENTRY={beneficiary_name:'مزوّد خدمة غير مقيم مصطنع',beneficiary_country:'IE',service_kind:'خدمة فنية كما صنفها المختص',
  remittance_due_date:'2026-10-10',due_date_basis:'موعد التوريد كما أكده المختص الضريبي المصطنع في مذكرته',
  classified_by_name:'مختص ضريبي مصطنع',classified_on:'2026-09-01',classification_note:'أساس التصنيف والنسبة كما كتبه المختص المصطنع',treaty_note:''};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-withholding-ledger');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee','manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=g=>transaction(db,g);
  for(const [who,actions] of [['employee',['read','configure','prepare']],['manager',['read','configure','approve','post']],['treasurer',['read','post']],['outsider',['read','prepare','post']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض دفتر مصطنع',null,now());
  tx(()=>grantAccess(db,users.admin,{user_id:'employee',capability:'tax.returns.prepare',note:'تصريح إعداد ضريبي مصطنع'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'tax.returns.review',note:'تصريح مراجعة ضريبية مصطنعة'}));
  const ref=(kind,input)=>tx(()=>f.createFinanceReference(db,users.manager,kind,input));
  const accounts={payable:ref('accounts',{code:'WH-2100',name:'ذمم الموردين المصطنعة',account_type:'liability',currency:'SAR'}),
    withholding_payable:ref('accounts',{code:'WH-2300',name:'استقطاع مستحق للهيئة',account_type:'liability',currency:'SAR'})};
  const centre=ref('cost_centers',{code:'WH-CC',name:'مركز ضرائب مصطنع'});
  const period=ref('periods',{name:'سنة الاختبار المصطنعة',starts_on:'2026-01-01',ends_on:'2026-12-31'});
  const map=purpose=>{const {id}=tx(()=>recordMapping(db,users.employee,{purpose,account_id:accounts[purpose].id,cost_center_id:centre.id,effective_from:'2026-01-01'}));
    tx(()=>approveMapping(db,users.manager,id,{note:'طابقت الحساب مع دليل الحسابات المصطنع'}));};
  for(const purpose of Object.keys(accounts))map(purpose);
  // نسبة استقطاع مؤرّخة مؤكدة: من يدخلها ليس من يؤكدها، كما يفرض سجل الاستقطاع.
  const rateId=tx(()=>recordRateSetting(db,users.employee,{kind:'withholding',category:'خدمة فنية',label:'استقطاع خدمة فنية',percent:'5',effective_from:'2026-01-01',
    source:'خطاب مصطنع من مختص ضريبي محفوظ في ملف الالتزامات',confirmed_on:'2026-01-05',specialist_name:'مختص ضريبي مصطنع'})).id;
  tx(()=>confirmRateSetting(db,users.manager,rateId,{version:db.prepare('SELECT version FROM tax_rate_settings WHERE id=?').get(rateId).version,note:'طابقت الخطاب المصطنع وتاريخ سريانه'}));
  const entry=input=>tx(()=>recordWithholding(db,users.employee,{...ENTRY,rate_setting_id:rateId,payment_order_id:null,payment_date:'2026-09-01',amount:'1000.00',...input})).id;
  const journal=sourceId=>tx(()=>journalFromSource(db,users.employee,{source_kind:'withholding',source_id:sourceId,period_id:period.id}));
  const jAct=(who,j,action,values={})=>tx(()=>f.journalAction(db,users[who],j.id,action,{version:j.version,note:'دليل قرار مالي مصطنع',...values}));
  const post=j=>jAct('manager',jAct('manager',jAct('employee',j,'submit'),'approve'),'post');
  return {db,users,tx,accounts,period,entry,journal,post};
}

// أمر دفع معتمد حقيقي بمبلغه الكامل: السلسلة نفسها التي تبنيها اختبارات المدفوعات، لأن المُطلِقات لا تقبل صفًا مركّبًا باليد.
function approvedOrder(db,users,tx){
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح اختبار مصطنع'}));
  grant('employee','vendors.manage');grant('outsider','vendors.manage');grant('hr','vendors.bank');
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع استقطاع مصطنع',brief:'اختبار قيد الاستقطاع',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const pAct=(who,p,action,values={})=>tx(()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=tx(()=>createPurchase(db,users.employee,{project_id:project.id,title:'خدمة فنية مصطنعة',specification:'خدمة فنية واحدة باختبار المواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:1,unit:'خدمة',budget_amount:'1000.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
  p=pAct('employee',p,'submit');
  // العرض لا يُحفظ لكيان بلا ملف مورد، والترسية تحتاج ثلاثة عروض: ثلاثة ملفات، ويُؤهَّل المُرسى عليه وحده.
  const vendorId=tx(()=>createVendor(db,users.employee,{legal_name:'مزوّد خدمة مصطنع',entity_type:'company',country:'SA',entity_ref:'1010000001',categories:['print_gifts'],data_source:'نموذج تسجيل مصطنع',supplier_key:'supplier-a'})).id;
  for(const [key,ref,label] of [['supplier-b','1010000002','ب'],['supplier-c','1010000003','ج']])
    tx(()=>createVendor(db,users.employee,{legal_name:`مزوّد مقارنة مصطنع ${label}`,entity_type:'company',country:'SA',entity_ref:ref,categories:['print_gifts'],data_source:'نموذج تسجيل مصطنع',supplier_key:key}));
  for(const [key,price] of [['supplier-a','1000.00'],['supplier-b','1100.00'],['supplier-c','1200.00']])
    p=pAct('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  const vAct=(who,action,values={})=>tx(()=>vendorAction(db,users[who],vendorId,action,{version:getVendor(db,users[who],vendorId).version,...values}));
  vAct('employee','add_contact',{name:'ممثل مصطنع',role:'مبيعات',email:'a@vendor.invalid',phone:''});
  vAct('employee','add_document',{kind:'commercial_registration',reference:'سجل تجاري مصطنع محفوظ',issued_on:'2026-01-01',expires_on:'2099-01-01'});
  vAct('employee','submit');
  vAct('outsider','verify_document',{document_id:getVendor(db,users.outsider,vendorId).documents[0].id,verification:'verified',note:'طابقنا السجل'});
  for(const [kind,who] of [['duplicate','outsider'],['procurement','outsider'],['technical','manager']])vAct(who,'review_'+kind,{decision:'passed',note:'اجتاز المراجعة المصطنعة'});
  vAct('outsider','approve',{outcome:'approved',reason:'اجتاز فحوص التأهيل المصطنعة كلها'});
  vAct('outsider','propose_bank',{bank_name:'بنك مصطنع',account_holder:'مزوّد خدمة مصطنع',iban:iban('80000000000000000011'),reason:'تسجيل حساب الدفع الأول للمورد'});
  vAct('hr','verify_bank',{bank_id:getVendor(db,users.hr,vendorId).bank[0].id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق لاسم المورد',effective_from:today()});
  p=pAct('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
  p=pAct('manager',p,'approve_order',{terms:'تسليم دفعة واحدة بعد فحص الجودة',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
  p=pAct('manager',p,'commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'موقع المورد المصطنع',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
  p=pAct('employee',p,'receive',{quantity:1,reference:'receipt-1',evidence:'استلام الخدمة الفنية وفحصها محليًا'});
  p=pAct('employee',p,'record_invoice',{supplier_reference:'inv-900',quantity:1,amount:'1000.00',evidence:'فاتورة مورد مصطنعة بقيمة ألف ريال'});
  p=pAct('manager',p,'match',{invoice_id:p.invoices[0].id,note:'طابقنا الأمر والاستلام والفاتورة'});
  const order=getOrder(db,users.employee,tx(()=>preparePayment(db,users.employee,{payable_id:p.payables[0].id})).id);
  tx(()=>paymentAction(db,users.manager,order.id,'approve_order',{version:order.version,note:'اعتماد أمر دفع مصطنع بعد المطابقة'}));
  return db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id);
}

test('withholding: a recorded entry becomes one balanced journal that recognises the liability to the authority',t=>{
  const {db,users,accounts,entry,journal,post}=fixture(t);
  const id=entry({});
  assert.equal(withholdingBoard(db,users.employee).entries.find(e=>e.id===id).ledger_journal,null,'before posting, the register says the obligation has not reached the ledger');
  const j=journal(id);
  const lines=db.prepare('SELECT account_id,debit_minor,credit_minor FROM finance_lines WHERE journal_id=? ORDER BY debit_minor DESC').all(j.id);
  assert.equal(lines.length,2);
  assert.deepEqual(lines.map(l=>[l.account_id,l.debit_minor,l.credit_minor]),
    [[accounts.payable.id,5000,0],[accounts.withholding_payable.id,0,5000]],
    'the withheld part of the payment settles the beneficiary and becomes an amount owed to the authority');
  assert.equal(j.entry_date,'2026-09-01','the entry carries the payment date, not the day it was posted');
  // الربط بالمستند قائم في finance_source_links، وهو ما يمنع ترحيله مرتين.
  assert.equal(db.prepare("SELECT journal_id FROM finance_source_links WHERE source_kind='withholding' AND source_id=?").get(id).journal_id,j.id);
  assert.throws(()=>journal(id),code('duplicate_source'));
  post(j);
  const board=statements(db,users.manager,{from:'2026-01-01',to:'2026-12-31'});
  assert.equal(board.balance_sheet.liabilities.find(l=>l.code==='WH-2300').amount_minor,5000,'the obligation now stands in the financial statements');
  assert.ok(board.balance_sheet.balanced);
  assert.ok(board.sources.some(s=>s.source_kind==='withholding'&&s.source_id===id&&s.journal_status==='posted'),'a withholding entry is listed among the documents the ledger reads');
  assert.deepEqual({...withholdingBoard(db,users.employee).entries.find(e=>e.id===id).ledger_journal},{id:j.id,status:'posted',entry_date:'2026-09-01'},
    'the register itself says the obligation is now in the ledger, and which journal carries it');
  assert.ok(verifyAudit(db));
});

test('withholding: the journal is refused while the linked payment order still carries the full amount',t=>{
  const {db,users,tx,entry,journal}=fixture(t);
  const order=approvedOrder(db,users,tx);
  assert.equal(order.amount_minor,100000);
  const id=entry({payment_order_id:order.id});
  // 100000 مدفوعة و5000 مستقطعة تعني تحويلًا بـ95000، وأمر الدفع يقول 100000. القيد لا يُبنى على تناقض.
  assert.throws(()=>journal(id),error=>error.code==='withholding_not_deducted'&&error.message.includes('950.00')&&error.message.includes('1000.00'),
    'the refusal names both numbers: what the transfer should have been and what the order still says');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM finance_source_links WHERE source_kind='withholding'").get().n,0,'nothing reached the ledger');
});

test('withholding: a cancelled entry carries no obligation and builds no journal',t=>{
  const {db,users,tx,entry,journal}=fixture(t);
  const id=entry({});
  const e=db.prepare('SELECT * FROM withholding_entries WHERE id=?').get(id);
  tx(()=>db.prepare("UPDATE withholding_entries SET status='cancelled',cancel_note='ألغي بقرار المختص المصطنع للاختبار',version=version+1,updated_at=? WHERE id=?").run(now(),e.id));
  assert.throws(()=>journal(id),code('source_not_ready'));
});
