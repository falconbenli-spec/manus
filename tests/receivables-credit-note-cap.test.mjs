import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead,commercialAction } from '../app/commercial.mjs';
import { createClaim,claimAction,listReceivables,recordReceipt,receiptAction } from '../app/receivables.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { recordCompanyProfile,approveCompanyProfile,recordCustomerProfile,prepareInvoice,prepareCreditNote,invoiceAction,getInvoice } from '../app/invoices.mjs';

// لماذا هذا الملف موجود: سقف المقبوضات في app/receivables.mjs كان قيمة الاستحقاق وحدها، ولا شيء في القاعدة
// يحرسه. والإشعار الدائن الصادر يخفض ما على العميل ولا يمس ar_claims، فكان استحقاق 1000 صدر عليه إشعار دائن
// بـ400 يقبل قبضًا بـ1000 كاملة: ذمة العميل تصير سالبة 400 بلا تنبيه، وaging_bucket يقول «مسدد داخليًا».
// اختبار المستحقات القائم (tests/receivables.test.mjs) لا يصدر إشعارًا دائنًا أبدًا، فلا يمر على هذا.
// هنا يُقاس الصافي — قيمة الاستحقاق ناقص الإشعارات الدائنة **الصادرة** وحدها — سقفًا للقبض ورصيدًا وعمرًا.

const code=value=>error=>error.code===value;
const address={building:'1234',street:'طريق مصطنع',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country:'SA'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-receivables-credit');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve','configure','post']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض تحصيل مصطنع',null,now());
  const tx=f=>transaction(db,f),act=(who,c,action,input={})=>tx(()=>commercialAction(db,users[who],c.id,action,{version:c.version,...input}));
  let c=tx(()=>dealFor(db,users.employee,{name:'عميل إشعارات مصطنع',registration_number:'CN-100',contact:'جهة مصطنعة',source:'اختبار',sector:'تجريبي'}));
  c=act('employee',c,'qualify',{need:'مخرج مصطنع',budget:'1000.00',currency:'SAR',timing:'2099-12-01',decision_maker:'ممثل عميل',service_fit:'مناسب للاختبار'});
  c=act('manager',c,'approve_qualification',{note:'تأهيل معتمد للاختبار'});
  // بند بلا ضريبة: المبالغ في هذا الملف صافية فتُقرأ أرقامها كما هي.
  c=act('employee',c,'save_quote',boundQuote(db,c.id,{scope:'مخرج واحد مصطنع',currency:'SAR',valid_until:'2099-12-01',lines:[{description:'تقرير نهائي',quantity:'1',unit_price:'1000.00',unit_cost:'200.00',discount:'0',tax_rate:'0',acceptance:'قبول التقرير بدليل',revisions:1}]}));
  c=act('employee',c,'submit_quote');c=act('manager',c,'approve_quote',{note:'عرض معتمد'});
  c=act('employee',c,'register_contract',{agreement_evidence:'اتفاق داخلي مصطنع موثق للاختبار',customer_representative:'ممثل مصطنع'});scheduleFor(db,c.id);
  c=act('manager',c,'create_project',{member_ids:[]});
  c=act('employee',c,'submit_delivery',{line_index:0,evidence:'مرجع تسليم التقرير النهائي المصطنع'});
  c=act('manager',c,'accept_delivery',{delivery_id:c.deliveries[0].id,note:'مطابق لمعيار التقرير',acceptance_evidence:'مرجع قبول داخلي مصطنع',approver_id: approverFor(db, c.project_id)});
  let claim=tx(()=>createClaim(db,users.employee,{delivery_id:c.deliveries[0].id,amount:'1000.00',due_date:'2099-12-15',entitlement_evidence:'العقد والقبول يدعمان الاستحقاق المصطنع'}));
  claim=tx(()=>claimAction(db,users.employee,claim.id,'submit',{version:claim.version}));
  claim=tx(()=>claimAction(db,users.manager,claim.id,'approve',{version:claim.version,note:'راجعت مصدر الاستحقاق ومبلغه'}));
  const sellerId=tx(()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة 3,6T المصطنعة',vat_number:'300000000000003',cr_number:'1010000001',address,effective_from:'2026-01-01'})).id;
  tx(()=>approveCompanyProfile(db,users.manager,sellerId,{note:'طابقنا الشهادة المصطنعة'}));
  tx(()=>recordCustomerProfile(db,users.employee,{case_id:c.id,legal_name:'شركة العميل المصطنعة',vat_number:'310000000000003',address,source:'شهادة مصطنعة من العميل'}));
  const step=(who,doc,action,input={})=>tx(()=>invoiceAction(db,users[who],doc.id,action,{version:doc.version,...input}));
  const issue=doc=>step('manager',step('employee',doc,'submit'),'issue');
  const invoice=issue(getInvoice(db,users.employee,tx(()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:'2026-09-01',vat_category:'zero_rated',vat_reason:'تصنيف مصطنع للاختبار لا يحمل نسبة'})).id));
  const creditNote=amount=>getInvoice(db,users.employee,tx(()=>prepareCreditNote(db,users.employee,invoice.id,{amount,reason:'تصحيح مصطنع على الفاتورة للاختبار'})).id);
  const receipt=(amount,reference)=>tx(()=>recordReceipt(db,users.employee,claim.id,{reference,amount,received_on:'2026-09-15',payer:'عميل مصطنع',evidence:'إشعار إيداع مصطنع للمراجعة'}));
  const read=()=>listReceivables(db,users.employee).claims[0];
  return {db,users,tx,claim,invoice,issue,creditNote,receipt,read};
}

test('receivables: an issued credit note lowers the ceiling on receipts, the balance and the aging bucket',t=>{
  const {db,users,tx,claim,creditNote,issue,receipt,read}=fixture(t);
  assert.equal(read().amount_minor,'100000');
  // المسودة لا تخفض شيئًا: إشعار لم يصدر قد يُرفض، والعميل لم يُبلَّغ به.
  const note=creditNote('400.00');
  assert.equal(read().credited_minor,'0','a draft credit note is not yet a reduction of what the customer owes');
  issue(note);
  const credited=read();
  assert.equal(credited.credited_minor,'40000');
  assert.equal(credited.net_amount_minor,'60000');
  assert.equal(credited.balance_minor,'60000','the balance is what is still collectable, not the original claim');
  // القبض بكامل قيمة الاستحقاق بعد الإشعار: رصيد سالب بـ400 كان يمر بلا تنبيه.
  assert.throws(()=>receipt('1000.00','SYN-OVER'),code('over_allocation'));
  const r=receipt('600.00','SYN-NET');
  const confirmed=tx(()=>receiptAction(db,users.manager,claim.id,r.id,'confirm',{note:'طابقت المرجع والمبلغ',matching_evidence:'مطابقة كشف مصطنع داخلية'}));
  assert.equal(confirmed.confirmed_minor,'60000');
  assert.equal(confirmed.balance_minor,'0');
  assert.equal(confirmed.aging_bucket,'مسدد داخليًا','the net claim is settled by the net receipt, and says so');
  assert.ok(!confirmed.actions.includes('record_receipt'),'nothing is left to collect, so no receipt is offered');
  assert.throws(()=>receipt('0.01','SYN-AFTER'),code('over_allocation'));
  assert.ok(verifyAudit(db));
});

test('receivables: a credit note for the whole invoice leaves nothing to collect and nothing owing',t=>{
  const {creditNote,issue,receipt,read}=fixture(t);
  issue(creditNote('1000.00'));
  const c=read();
  assert.equal(c.credited_minor,'100000');
  assert.equal(c.net_amount_minor,'0');
  assert.equal(c.balance_minor,'0');
  assert.equal(c.aging_bucket,'ملغى بإشعار دائن','a fully credited claim is not reported as internally settled');
  assert.throws(()=>receipt('0.01','SYN-NOTHING'),code('over_allocation'));
});
