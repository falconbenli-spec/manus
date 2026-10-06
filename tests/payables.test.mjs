import { payablesUI } from '../app/static/payables-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { approveVendors, registerVendor } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { createVendor, vendorAction, getVendor } from '../app/vendors.mjs';
import { fundProject } from './budget-fixture.mjs';
import { listPayables, getOrder, preparePayment, paymentAction, recordInputTax, decideInputTax, verifiedInputVat } from '../app/payables.mjs';

const code=value=>error=>error.code===value;
function iban(bban){const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;}
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

function fixture(t,{qualified=true,bank=true,partial=false}={}){
  const db=openDb(':memory:');seed(db,'synthetic-payables');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee','manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve']],['treasurer',['read','post']],['outsider',['read','prepare','post']]])for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مدفوعات مصطنع',null,now());
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح اختبار'}));
  grant('employee','vendors.manage');grant('outsider','vendors.manage');grant('hr','vendors.bank');
  // طلب شراء حتى مستحق مطابَق غير مدفوع للمورد SUPPLIER-A.
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع مدفوعات مصطنع',brief:'اختبار دفع الموردين',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const pAct=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'طباعة مصطنعة',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:5,unit:'نسخة',budget_amount:'600.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
  p=pAct('employee',p,'submit');
  // بوابة المورد (app/vendors.mjs): الكيان بلا ملف ما عاد يُقبل عرضه. فالمفاتيح الثلاثة تُسجَّل قبل
  // العروض، و«supplier-a» يُسجَّل **غير مؤهَّل** حتى يبقى تأهيله هو ما يختبره هذا الملف لا وجوده.
  approveVendors(db,['supplier-b','supplier-c']);
  registerVendor(db,'supplier-a');
  for(const [key,price] of [['supplier-a','115.00'],['supplier-b','116.00'],['supplier-c','117.00']])p=pAct('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  let vendorId=null;
  const vAct=(who,action,values={})=>transaction(db,()=>vendorAction(db,users[who],vendorId,action,{version:getVendor(db,users[who],vendorId).version,...values}));
  if(qualified){
    vendorId=db.prepare("SELECT id FROM vendors WHERE upper(supplier_key)=upper('supplier-a')").get().id;  // مسجَّل قبل العروض، وهنا يُؤهَّل
    vAct('employee','add_contact',{name:'ممثل مصطنع',role:'مبيعات',email:'a@vendor.invalid',phone:''});
    vAct('employee','add_document',{kind:'commercial_registration',reference:'سجل تجاري مصطنع محفوظ',issued_on:'2026-01-01',expires_on:'2099-01-01'});
    vAct('employee','submit');
    vAct('outsider','verify_document',{document_id:getVendor(db,users.outsider,vendorId).documents[0].id,verification:'verified',note:'طابقنا السجل'});
    for(const [kind,who] of [['duplicate','outsider'],['procurement','outsider'],['technical','manager']])vAct(who,'review_'+kind,{decision:'passed',note:'اجتاز المراجعة المصطنعة'});
    vAct('outsider','approve',{outcome:'approved',reason:'اجتاز فحوص التأهيل المصطنعة كلها'});
    if(bank){
      vAct('outsider','propose_bank',{bank_name:'بنك مصطنع',account_holder:'مطبعة مصطنعة',iban:iban('80000000000000000011'),reason:'تسجيل حساب الدفع الأول للمورد'});
      vAct('hr','verify_bank',{bank_id:getVendor(db,users.hr,vendorId).bank[0].id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق لاسم المورد',effective_from:today()});
    }
  }
  p=pAct('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
  p=pAct('manager',p,'approve_order',{terms:'تسليم دفعة واحدة بعد فحص الجودة',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
  // أمر المباشرة (ترحيل 116): لا استلام من المورد قبل إذن بدء بتاريخه ومن أصدره.
  p=pAct('manager',p,'commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'مطبعة المورد المصطنعة',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
  p=pAct('employee',p,'receive',{quantity:5,reference:'receipt-1',evidence:'استلام خمس نسخ وفحصها محليًا'});
  p=pAct('employee',p,'record_invoice',{supplier_reference:'inv-900',quantity:partial?2:5,amount:partial?'230.00':'575.00',evidence:'فاتورة مورد مصطنعة بقيمة 575 ريالًا'});
  p=pAct('manager',p,'match',{invoice_id:p.invoices[0].id,note:'طابقنا الأمر والاستلام والفاتورة'});
  const payable=p.payables[0],invoice=p.invoices[0];
  const act=(who,order,action,values={})=>transaction(db,()=>paymentAction(db,users[who],order.id,action,{version:order.version,...values}));
  const prepare=(who='employee')=>getOrder(db,users[who],transaction(db,()=>preparePayment(db,users[who],{payable_id:payable.id})).id);
  return {db,users,payable,invoice,act,prepare,vAct,vendorId:()=>vendorId};
}

test('PRC-02: an unregistered or unqualified vendor never enters the payment cycle, and no bank account means no order',t=>{
  // بوابة المورد (29 سبتمبر 2026): الكيان غير المؤهَّل صار يُرفض عند **الترسية** لا عند الدفع، فلا
  // يبلغ دورة الدفع أصلًا. وهذا أقوى مما كان يُثبته السطر السابق (وصولُه إلى المستحقات ثم حجبُه هناك):
  // الحاجز انتقل خطوةً إلى الوراء، فلا يُنشأ التزامٌ على من لا يجوز التعاقد معه.
  assert.throws(()=>fixture(t,{qualified:false}),code('vendor_blocked'),
    'المورد غير المؤهَّل لا تصله ترسية، فلا يدخل دورة الدفع من أولها');
  let f=fixture(t,{bank:false});
  assert.throws(()=>f.prepare(),code('vendor_not_payable'));
  assert.match(listPayables(f.db,f.users.employee).payables[0].block_reason,/بلا حساب بنكي/);
  f=fixture(t);
  f.vAct('outsider','suspend',{reason:'إيقاف مصطنع للتحقق من منع الدفع'});
  assert.throws(()=>f.prepare(),code('vendor_not_payable'));
});

test('FIN-07/PRC-09: approved is not paid — three people prepare, approve and record the bank execution, and the bank-detail collector cannot record it',t=>{
  const {db,users,payable,act,prepare}=fixture(t);
  let order=prepare();
  assert.equal(order.amount_minor,57500);assert.equal(order.status,'pending');
  assert.throws(()=>prepare(),code('order_exists'));
  assert.throws(()=>act('employee',order,'approve_order',{note:'اعتماد ذاتي'}),code('action_unavailable'));
  order=act('manager',getOrder(db,users.manager,order.id),'approve_order',{note:'طابقت المستحق والمورد والحساب'});
  assert.equal(order.status,'approved');
  let view=listPayables(db,users.manager);
  assert.equal(view.payables[0].order_status,'approved');assert.equal(view.totals.executed_minor,0,'an approved order has moved no money');assert.equal(view.totals.unpaid_minor,57500);
  assert.equal(db.prepare('SELECT payment_status FROM procurement_payables WHERE id=?').get(payable.id).payment_status,'not_paid');
  // outsider جمع بيانات الحساب البنكي للمورد، فلا يوثق التنفيذ رغم حمله تفويض الترحيل.
  assert.deepEqual(getOrder(db,users.outsider,order.id).actions,[]);
  assert.throws(()=>act('outsider',getOrder(db,users.outsider,order.id),'record_execution',{executed_on:today(),bank_reference:'TRX-1',evidence:'إشعار تحويل بنكي مصطنع'}),code('action_unavailable'));
  assert.throws(()=>act('treasurer',getOrder(db,users.treasurer,order.id),'record_execution',{executed_on:'2099-01-01',bank_reference:'TRX-1',evidence:'إشعار تحويل بنكي مصطنع'}),code('executed_on'));
  order=act('treasurer',getOrder(db,users.treasurer,order.id),'record_execution',{executed_on:today(),bank_reference:'trx-1',evidence:'إشعار تحويل بنكي مصطنع محفوظ في مجلد الخزينة'});
  assert.equal(order.status,'executed');assert.equal(order.bank_reference,'TRX-1');
  view=listPayables(db,users.manager);
  assert.deepEqual([view.totals.executed_minor,view.totals.unpaid_minor],[57500,0]);
  assert.throws(()=>db.prepare("UPDATE payment_orders SET amount_minor=1,version=version+1 WHERE id=?").run(order.id),/final|keeps its payee/);
  assert.throws(()=>db.prepare('DELETE FROM payment_orders WHERE id=?').run(order.id),/retained/);
  assert.throws(()=>listPayables(db,users.hr),code('payables_access_denied'));
  assert.ok(verifyAudit(db));
});

test('PRC-09: if the vendor bank account changes after the order was prepared, approval stops instead of silently paying the new account',t=>{
  const {db,users,act,prepare,vAct}=fixture(t);
  const order=prepare();
  vAct('employee','propose_bank',{bank_name:'بنك آخر',account_holder:'مطبعة مصطنعة',iban:iban('80000000000000000012'),reason:'المورد أبلغ بتغيير حسابه البنكي'});
  vAct('hr','verify_bank',{bank_id:db.prepare("SELECT id FROM vendor_bank_accounts WHERE status='pending'").get().id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع للحساب الجديد',effective_from:today()});
  assert.throws(()=>act('manager',getOrder(db,users.manager,order.id),'approve_order',{note:'اعتماد بعد تغيير الحساب'}),code('bank_changed'));
  assert.equal(act('employee',getOrder(db,users.employee,order.id),'cancel_order',{note:'تغير حساب المورد؛ يعاد إعداد الأمر'}).status,'cancelled');
  // الترحيل 166: التحقق من الحساب الجديد يُحِلّه محل القديم (superseded)، ويُدخله مهلة تهدئة وخطوة إطلاق لأول دفعة.
  // وقيمتا المهلة والسقف للمالك ولم تُعتمدا في هذا الملف، فإعادة الإعداد الفورية التي كان هذا السطر يثبتها — دفعٌ
  // لحساب تغيّر اليوم بموافقة شخصين عاديين — صارت موقوفة برفض يسمّي القرار الناقص ومالكه. الأمر الملغى حرّر المستحق
  // (لا order_exists)، والحساب المتغيّر هو ما يوقفه.
  const held=(()=>{try{prepare();}catch(error){return error;}})();
  assert.equal(held?.code,'bank_change_unadopted','a changed account is not paid on the day it changed');
  assert.equal(db.prepare('SELECT status FROM vendor_bank_accounts WHERE id=?').get(order.bank_account_id).status,'superseded','the replaced account is marked superseded');
});

test('input VAT enters the summary only after a second person verifies the supplier tax invoice, and cannot exceed 15% of net',t=>{
  const {db,users,invoice}=fixture(t);
  const record=(overrides={})=>transaction(db,()=>recordInputTax(db,users.employee,{invoice_id:invoice.id,supplier_vat_number:'310000000000003',supplier_invoice_number:'INV-900',invoice_date:today(),vat:'75.00',evidence:'فاتورة المورد الضريبية المصطنعة محفوظة في مجلد المشتريات',...overrides})).id;
  assert.throws(()=>record({vat:'90.00'}),code('vat_exceeds_invoice'));
  assert.throws(()=>record({supplier_vat_number:'123456789012345'}),code('vat_number'));
  const id=record();
  assert.throws(()=>record(),code('tax_exists'));
  assert.equal(verifiedInputVat(db,'36t','2026-01-01','2099-12-31'),null,'pending tax is not deductible yet');
  assert.throws(()=>transaction(db,()=>decideInputTax(db,users.employee,id,'verify',{note:'تحقق ذاتي'})),code('payables_access_denied'));
  transaction(db,()=>decideInputTax(db,users.manager,id,'verify',{note:'طابقت الرقم الضريبي والمبلغ مع الفاتورة'}));
  assert.equal(verifiedInputVat(db,'36t','2026-01-01','2099-12-31'),7500);
  assert.equal(verifiedInputVat(db,'36t','2020-01-01','2020-12-31'),0);
  assert.equal(listPayables(db,users.manager).totals.verified_input_vat_minor,7500);
  assert.throws(()=>db.prepare("UPDATE procurement_invoice_tax SET vat_minor=1 WHERE id=?").run(id),/final/);
});

test('FIN-09: تمنع ضريبة الفاتورة المكررة عبر مرجع شراء آخر بعد توحيد شكل رقمها',t=>{
  const {db,users,invoice}=fixture(t,{partial:true});
  const record=(invoiceId,reference)=>transaction(db,()=>recordInputTax(db,users.employee,{invoice_id:invoiceId,supplier_vat_number:'310000000000003',supplier_invoice_number:reference,invoice_date:today(),vat:'30.00',evidence:'مرجع فاتورة ضريبية مصطنعة للتحقق من منع التكرار'}));
  record(invoice.id,'Inv-900');
  const other=randomUUID();
  db.prepare(`INSERT INTO procurement_invoices(id,tenant_id,purchase_id,supplier_key,supplier_reference,quantity,amount_minor,currency,evidence,recorded_by,purchase_version,created_at) SELECT ?,tenant_id,purchase_id,supplier_key,'INV-OTHER',quantity,amount_minor,currency,evidence,recorded_by,purchase_version,created_at FROM procurement_invoices WHERE id=?`).run(other,invoice.id);
  assert.throws(()=>record(other,'ＩＮＶ-900'),code('duplicate_tax_invoice'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_invoice_tax').get().n,1);
});

test('PRC-09: يظهر توقف المورد بعد الاعتماد ويُحفظ التحذير عند توثيق تنفيذ وقع فعلا',t=>{
  const {db,users,act,prepare,vAct}=fixture(t);
  let order=prepare();
  order=act('manager',order,'approve_order',{note:'اعتماد مستحق المورد المصطنع'});
  vAct('outsider','suspend',{reason:'إيقاف المورد بعد اعتماد أمر الدفع للمراجعة'});
  order=getOrder(db,users.treasurer,order.id);
  assert.equal(order.execution_warning.code,'vendor_not_payable');
  const html=payablesUI.render(listPayables(db,users.treasurer),{e:value=>String(value??'').replaceAll('<','&lt;'),button:()=>'',money:value=>String(value)});
  assert.match(html,/تغيّر وضع المستفيد/);
  assert.match(html,/التوثيق لا يجيز تحويلًا جديدًا/);
  assert.ok(order.actions.includes('record_execution'));
  const done=act('treasurer',order,'record_execution',{executed_on:today(),bank_reference:'PAID-BEFORE-HOLD',evidence:'تم التنفيذ في البنك قبل وصول قرار إيقاف المورد'});
  assert.equal(done.status,'executed');
  const log=db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='payment.record_execution'").get(order.id);
  assert.equal(JSON.parse(log.after_json).execution_warning.code,'vendor_not_payable');
});

test('FIN-09: السجلات القديمة المكررة لا تعتمد، ويمكن رفض المكرر ثم اعتماد الأصل',t=>{
  const {db,users,invoice}=fixture(t,{partial:true});
  const original=transaction(db,()=>recordInputTax(db,users.employee,{invoice_id:invoice.id,supplier_vat_number:'310000000000003',supplier_invoice_number:'LEGACY-1',invoice_date:today(),vat:'30.00',evidence:'فاتورة ضريبية مصطنعة لاختبار السجلات القديمة'})).id;
  const other=randomUUID();
  db.prepare(`INSERT INTO procurement_invoices(id,tenant_id,purchase_id,supplier_key,supplier_reference,quantity,amount_minor,currency,evidence,recorded_by,purchase_version,created_at) SELECT ?,tenant_id,purchase_id,supplier_key,'LEGACY-OTHER',quantity,amount_minor,currency,evidence,recorded_by,purchase_version,created_at FROM procurement_invoices WHERE id=?`).run(other,invoice.id);
  const legacy={...db.prepare('SELECT * FROM procurement_invoice_tax WHERE id=?').get(original),id:randomUUID(),invoice_id:other,supplier_invoice_number:'legacy-1'};
  db.prepare(`INSERT INTO procurement_invoice_tax (${Object.keys(legacy).join(',')}) VALUES (${Object.keys(legacy).map(()=>'?').join(',')})`).run(...Object.values(legacy));
  const decide=(id,decision)=>transaction(db,()=>decideInputTax(db,users.manager,id,decision,{note:'مراجعة الفاتورة الضريبية المكررة واختيار الأصل'}));
  assert.throws(()=>decide(original,'verify'),code('duplicate_tax_invoice'));
  assert.equal(verifiedInputVat(db,'36t','2026-01-01','2099-01-01'),null);
  decide(legacy.id,'reject');decide(original,'verify');
  assert.equal(verifiedInputVat(db,'36t','2026-01-01','2099-01-01'),3000);
});

test('PRC-09: تغير الحساب البنكي بعد اعتماد الدفع يظهر للمالية دون كشف الآيبان',t=>{
  const {db,users,act,prepare,vAct}=fixture(t);
  let order=prepare();order=act('manager',order,'approve_order',{note:'اعتماد قبل تغيير الحساب'});
  assert.equal(getOrder(db,users.treasurer,order.id).execution_warning,null);
  vAct('outsider','propose_bank',{bank_name:'بنك مصطنع جديد',account_holder:'مطبعة مصطنعة',iban:iban('80000000000000000022'),reason:'طلب تغيير حساب المورد بعد اعتماد أمر الدفع'});
  vAct('hr','verify_bank',{bank_id:db.prepare("SELECT id FROM vendor_bank_accounts WHERE status='pending'").get().id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع للحساب الجديد',effective_from:today()});
  const view=listPayables(db,users.treasurer).orders.find(x=>x.id===order.id);
  assert.equal(view.execution_warning.code,'bank_changed');
  assert.doesNotMatch(JSON.stringify(view.execution_warning),/SA\d{22}/);
});
