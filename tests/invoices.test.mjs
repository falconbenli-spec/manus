import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead,commercialAction } from '../app/commercial.mjs';
import { createClaim,claimAction } from '../app/receivables.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { listInvoices,getInvoice,recordCompanyProfile,approveCompanyProfile,recordCustomerProfile,prepareInvoice,prepareCreditNote,invoiceAction,verifyInvoiceChain,splitGross,qrTlv } from '../app/invoices.mjs';

const code=value=>error=>error.code===value;
const address={building:'1234',street:'طريق مصطنع',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country:'SA'};
function fixture(t,{taxRate='15'}={}){
  const db=openDb(':memory:');seed(db,'synthetic-invoices-only');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve']],['outsider',['read']]])for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض فوترة مصطنع',null,now());
  const act=(who,c,action,input={})=>transaction(db,()=>commercialAction(db,users[who],c.id,action,{version:c.version,...input}));
  let c=transaction(db,()=>dealFor(db,users.employee,{name:'عميل فوترة مصطنع',registration_number:'INV-100',contact:'جهة مصطنعة',source:'اختبار',sector:'تجريبي'}));
  c=act('employee',c,'qualify',{need:'مخرج مصطنع للفوترة',budget:'1000.00',currency:'SAR',timing:'2099-12-01',decision_maker:'ممثل عميل',service_fit:'مناسب للاختبار'});
  c=act('manager',c,'approve_qualification',{note:'تأهيل معتمد للاختبار'});
  c=act('employee',c,'save_quote',boundQuote(db,c.id,{scope:'مخرجان مصطنعان',currency:'SAR',valid_until:'2099-12-01',lines:[{description:'حملة إطلاق مصطنعة',quantity:'1',unit_price:'100.00',unit_cost:'20.00',discount:'0',tax_rate:taxRate,acceptance:'قبول الحملة بدليل',revisions:1},{description:'تقرير ختامي مصطنع',quantity:'1',unit_price:'33.33',unit_cost:'5.00',discount:'0',tax_rate:taxRate,acceptance:'قبول التقرير بدليل',revisions:1}]}));
  c=act('employee',c,'submit_quote');c=act('manager',c,'approve_quote',{note:'عرض معتمد'});c=act('employee',c,'register_contract',{agreement_evidence:'اتفاق داخلي مصطنع موثق للاختبار',customer_representative:'ممثل مصطنع'});scheduleFor(db,c.id);c=act('manager',c,'create_project',{member_ids:[]});
  const claimFor=(lineIndex,amount,approve=true)=>{
    c=act('employee',c,'submit_delivery',{line_index:lineIndex,evidence:'مرجع تسليم مصطنع للبند '+lineIndex});
    const delivery=c.deliveries.at(-1);
    c=act('manager',c,'accept_delivery',{delivery_id:delivery.id,note:'مطابق لمعيار القبول',acceptance_evidence:'مرجع قبول داخلي مصطنع',approver_id: approverFor(db, c.project_id)});
    let claim=transaction(db,()=>createClaim(db,users.employee,{delivery_id:delivery.id,amount,due_date:'2099-12-15',entitlement_evidence:'العقد والقبول يدعمان الاستحقاق المصطنع'}));
    claim=transaction(db,()=>claimAction(db,users.employee,claim.id,'submit',{version:claim.version}));
    return approve?transaction(db,()=>claimAction(db,users.manager,claim.id,'approve',{version:claim.version,note:'استحقاق معتمد للاختبار'})):claim;
  };
  const seller=()=>{const {id}=transaction(db,()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة 3,6T المصطنعة',vat_number:'300000000000003',cr_number:'1010000001',address,effective_from:'2026-01-01'}));transaction(db,()=>approveCompanyProfile(db,users.manager,id,{note:'طابقنا الشهادة الضريبية المصطنعة'}));return id;};
  const buyer=(vat='310000000000003')=>transaction(db,()=>recordCustomerProfile(db,users.employee,{case_id:c.id,legal_name:'شركة العميل المصطنعة',vat_number:vat,address,source:'شهادة ضريبية مصطنعة أرسلها العميل'}));
  const prepare=(claim,input={})=>getInvoice(db,users.employee,transaction(db,()=>prepareInvoice(db,users.employee,{claim_id:claim.id,supply_date:'2026-09-01',vat_category:'standard',...input})).id);
  const step=(who,doc,action,input={})=>transaction(db,()=>invoiceAction(db,users[who],doc.id,action,{version:doc.version,...input}));
  const issue=doc=>step('manager',step('employee',doc,'submit'),'issue');
  return {db,users,claimFor,seller,buyer,prepare,step,issue,caseId:()=>c.id};
}

test('criterion 7: an accepted deliverable is not billable until the receivable is approved, and both tax profiles exist',t=>{
  const {db,users,claimFor,seller,buyer,prepare}=fixture(t);
  const pending=claimFor(0,'115.00',false);
  assert.throws(()=>prepare(pending),code('claim_not_billable'));
  const claim=transaction(db,()=>claimAction(db,users.manager,pending.id,'approve',{version:pending.version,note:'استحقاق معتمد'}));
  assert.throws(()=>prepare(claim),code('seller_profile_required'));
  seller();
  assert.throws(()=>prepare(claim),code('buyer_profile_required'));
  buyer();
  assert.throws(()=>prepare(claim,{vat_category:'exempt',vat_reason:'سبب إعفاء لا يطابق العقد المعتمد'}),code('vat_mismatch'));
  const draft=prepare(claim);
  assert.deepEqual([draft.net_minor,draft.vat_minor,draft.total_minor],[10000,1500,11500]);
  assert.equal(draft.number,null,'a draft carries no tax number');
  assert.throws(()=>prepare(claim),code('already_invoiced'));
  assert.equal(listInvoices(db,users.employee).claims.length,0);
});

test('issuing needs a second person, numbers run without gaps, and an issued invoice cannot be changed or deleted',t=>{
  const {db,users,claimFor,seller,buyer,prepare,step,issue}=fixture(t);
  seller();buyer();
  let first=step('employee',prepare(claimFor(0,'115.00')),'submit');
  assert.throws(()=>step('employee',first,'issue'),code('transition_denied'));
  assert.throws(()=>step('outsider',first,'issue'),code('transition_denied'));
  first=step('manager',first,'return',{note:'صحح تاريخ التوريد قبل الإصدار'});
  assert.equal(first.status,'draft');assert.equal(first.number,null);
  first=issue(first);
  assert.equal(first.number,`INV-${first.issued_at.slice(0,4)}-000001`);
  assert.equal(first.issued_by,'manager');assert.equal(first.reporting_status,'not_reported');
  // المرفوضة لا تستهلك رقمًا: التالية تأخذ 000002.
  const claimTwo=claimFor(1,'38.33');
  const rejected=step('manager',step('employee',prepare(claimTwo),'submit'),'reject',{note:'بيانات العميل تحتاج تحديثًا قبل الفوترة'});
  assert.equal(rejected.number,null);
  const second=issue(prepare(claimTwo));
  assert.equal(second.sequence,2);
  assert.deepEqual([second.net_minor,second.vat_minor,second.total_minor],[3333,500,3833]);
  assert.throws(()=>db.prepare("UPDATE tax_invoices SET total_minor=1,net_minor=1,vat_minor=0,version=version+1 WHERE id=?").run(first.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM tax_invoices WHERE id=?').run(first.id),/retained/);
  assert.throws(()=>db.prepare("UPDATE tax_invoices SET sequence=9,version=version+1 WHERE id=?").run(rejected.id),/immutable|sequential/);
  assert.equal(verifyInvoiceChain(db,'36t'),true);
  assert.equal(second.previous_hash,first.hash);
  const fields=Buffer.from(first.qr_tlv,'base64');
  assert.equal(fields[0],1);assert.equal(fields.subarray(2,2+fields[1]).toString('utf8'),'شركة 3,6T المصطنعة');
  assert.ok(verifyAudit(db));
});

test('a credit note corrects an issued invoice, never exceeds it, and carries its own sequence and reason',t=>{
  const {db,users,claimFor,seller,buyer,prepare,step,issue}=fixture(t);
  seller();buyer();
  const invoice=issue(prepare(claimFor(0,'115.00')));
  const credit=(amount,reason='خصم متفق عليه بعد مراجعة نطاق التسليم')=>getInvoice(db,users.employee,transaction(db,()=>prepareCreditNote(db,users.employee,invoice.id,{amount,reason})).id);
  assert.throws(()=>credit('115.01'),code('credit_exceeds_invoice'));
  assert.throws(()=>credit('10.00','قصير'),code('invalid_text'));
  let note=credit('57.50');
  assert.deepEqual([note.net_minor,note.vat_minor,note.total_minor],[5000,750,5750]);
  // المسودة تحجز من الرصيد: لا يمكن إعداد إشعارين يتجاوز مجموعهما الفاتورة.
  assert.throws(()=>credit('57.51'),code('credit_exceeds_invoice'));
  assert.throws(()=>step('employee',step('employee',note,'submit'),'issue'),code('transition_denied'));
  note=step('manager',getInvoice(db,users.manager,note.id),'issue');
  assert.match(note.number,/^CN-\d{4}-000001$/);assert.equal(note.original_number,invoice.number);
  const after=getInvoice(db,users.employee,invoice.id);
  assert.equal(after.credited_minor,5750);assert.equal(after.net_after_credits_minor,5750);
  const totals=listInvoices(db,users.employee).totals;
  assert.deepEqual([totals.invoiced_minor,totals.credited_minor,totals.output_vat_minor],[11500,5750,750]);
  assert.equal(verifyInvoiceChain(db,'36t'),true);
  assert.throws(()=>transaction(db,()=>prepareCreditNote(db,users.employee,note.id,{amount:'1.00',reason:'إشعار على إشعار غير مسموح به'})),code('original_not_issued'));
});

test('zero-rated supplies need a written reason, access needs a finance grant, and tax data is replaced rather than edited',t=>{
  const {db,users,claimFor,seller,buyer,prepare,issue}=fixture(t,{taxRate:'0'});
  const sellerId=seller();buyer('');
  const claim=claimFor(0,'100.00');
  assert.throws(()=>prepare(claim),code('vat_mismatch'));
  assert.throws(()=>prepare(claim,{vat_category:'zero_rated',vat_reason:'قصير'}),code('invalid_text'));
  const invoice=issue(prepare(claim,{vat_category:'zero_rated',vat_reason:'خدمة مصدرة لعميل خارج المملكة بحسب العقد المصطنع'}));
  assert.deepEqual([invoice.net_minor,invoice.vat_minor],[10000,0]);assert.equal(invoice.buyer.vat_number,null);
  assert.throws(()=>listInvoices(db,users.hr),code('invoice_access_denied'));
  assert.throws(()=>listInvoices(db,users.external),code('invoice_access_denied'));
  assert.throws(()=>db.prepare("UPDATE company_tax_profiles SET legal_name='اسم آخر' WHERE id=?").run(sellerId),/approved once/);
  assert.throws(()=>transaction(db,()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة مصطنعة',vat_number:'123456789012345',cr_number:'1010000001',address,effective_from:'2026-01-01'})),code('vat_number'));
  const own=transaction(db,()=>recordCompanyProfile(db,users.employee,{legal_name:'شركة 3,6T بعد التعديل',vat_number:'300000000000003',cr_number:'1010000001',address,effective_from:'2026-10-01'}));
  assert.throws(()=>transaction(db,()=>approveCompanyProfile(db,users.employee,own.id,{note:'اعتماد ذاتي غير مسموح'})),code('invoice_access_denied'));
  // البيانات الجديدة لا تغير فاتورة صدرت: اللقطة محفوظة داخل المستند.
  assert.equal(getInvoice(db,users.employee,invoice.id).seller.legal_name,'شركة 3,6T المصطنعة');
  assert.deepEqual(splitGross(11500,1500),{net_minor:10000,vat_minor:1500,total_minor:11500});
  assert.deepEqual(splitGross(100,1500),{net_minor:87,vat_minor:13,total_minor:100});
  assert.equal(Buffer.from(qrTlv('أ','3','t','1.00','0.13'),'base64')[1],2,'length counts UTF-8 bytes, not characters');
});

/* ───── رمز المرحلة الأولى (TLV) وحقول المستند المجمَّدة عند الإصدار ───── */
// فكّ الترميز يمشي على الوسوم وسمًا وسمًا: بايت الوسم، بايت الطول، ثم القيمة بطولها بالبايت.
// الطول بالبايت لا بالحرف، فالاسم العربي يشغل أكثر من حرفه، ولهذا يُقرأ الطول ولا يُفترض.
function tlvFields(base64){
  const bytes=Buffer.from(base64,'base64'),out=new Map();
  for(let i=0;i+1<bytes.length;){
    const tag=bytes[i],length=bytes[i+1];
    out.set(tag,bytes.subarray(i+2,i+2+length).toString('utf8'));
    i+=2+length;
  }
  return out;
}

test('the QR issue time carries no fractional seconds, while the record keeps its own precision',t=>{
  const {db,claimFor,seller,buyer,prepare,issue}=fixture(t);
  seller();buyer();
  const invoice=issue(prepare(claimFor(0,'115.00')));
  const fields=tlvFields(invoice.qr_tlv);
  assert.equal(fields.size,5,'خمسة وسوم: الاسم، الرقم الضريبي، الوقت، الإجمالي، الضريبة');
  assert.match(fields.get(3),/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,'الوسم 3 بصيغة YYYY-MM-DDTHH:mm:ssZ بلا كسور ثانية');
  assert.equal(fields.get(3),invoice.issued_at.replace(/\.\d{3}Z$/,'Z'),'اللحظة نفسها، بلا كسر الثانية لا غير');
  // السجل يبقى بدقته: التجريد في بناء الرمز وحده.
  assert.match(invoice.issued_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,'issued_at في السجل يبقى بالميلي ثانية');
  assert.deepEqual([fields.get(4),fields.get(5)],['115.00','15.00']);
  // والنسخة المؤرشفة تحمل الرمز نفسه، ولا تُعدَّل بعد كتابتها.
  assert.equal(db.prepare('SELECT qr_tlv FROM einvoice_archive WHERE document_id=?').get(invoice.id).qr_tlv,invoice.qr_tlv);
});

test('the output-VAT rate is read from the dated legal schedule at the supply date, not written into the code',t=>{
  const {db,claimFor,seller,buyer,prepare,issue}=fixture(t,{taxRate:'5'});
  seller();buyer();
  // توريد قبل 2020-07-01: النسبة السارية يومها 5% من الجدول المؤرَّخ نفسه الذي تقرؤه ضريبة المدخلات.
  const claim=claimFor(0,'105.00');
  const invoice=issue(prepare(claim,{supply_date:'2020-06-30'}));
  assert.equal(invoice.vat_basis_points,500);
  assert.deepEqual([invoice.net_minor,invoice.vat_minor,invoice.total_minor],[10000,500,10500]);
  assert.equal(invoice.vat_category,'standard');
  assert.equal(db.prepare('SELECT vat_basis_points FROM tax_invoices WHERE id=?').get(invoice.id).vat_basis_points,500,'القيد في القاعدة يقبل النسبة المؤرَّخة المعتمدة');
  // والنسبة تُقاس بتاريخ التوريد لا بتاريخ اليوم: بند بنسبة 5% وتوريد بعد 2020-07-01 لا يمر.
  const later=claimFor(1,'35.00');
  assert.throws(()=>prepare(later,{supply_date:'2026-09-01'}),code('unsupported_rate'));
});

test('a rate that is not the one in force on the supply date is refused, in either direction',t=>{
  const {claimFor,seller,buyer,prepare}=fixture(t);
  seller();buyer();
  // بند بنسبة 15% وتاريخ توريد يسبق رفعها: النسبة السارية يومها 5%، فالبند لا يطابقها.
  assert.throws(()=>prepare(claimFor(0,'115.00'),{supply_date:'2020-06-30'}),code('unsupported_rate'));
});

test('the archived copy carries the document type, the tax category code, the payment means and a unit code on every line',t=>{
  const {db,users,claimFor,seller,buyer,prepare,issue}=fixture(t);
  seller();buyer();
  const invoice=issue(prepare(claimFor(0,'115.00')));
  const payload=JSON.parse(db.prepare('SELECT payload FROM einvoice_archive WHERE document_id=?').get(invoice.id).payload);
  assert.equal(payload.document_type_code,'388','الفاتورة الضريبية 388');
  assert.equal(payload.tax_category_code,'S','النسبة الأساسية S في UN/ECE 5305');
  assert.equal(payload.payment_means_code,'1','لا وسيلة سداد معلومة وقت الإصدار');
  assert.ok(payload.lines.every(l=>l.unit_code==='C62'),'لكل سطر رمز وحدة');
  const note=issue(getInvoice(db,users.employee,transaction(db,()=>prepareCreditNote(db,users.employee,invoice.id,{amount:'11.50',reason:'خصم متفق عليه بعد مراجعة نطاق التسليم'})).id));
  const notePayload=JSON.parse(db.prepare('SELECT payload FROM einvoice_archive WHERE document_id=?').get(note.id).payload);
  assert.equal(notePayload.document_type_code,'381','الإشعار الدائن 381');
  assert.equal(notePayload.tax_category_code,'S');
  assert.ok(notePayload.lines.every(l=>l.unit_code==='C62'));
});
