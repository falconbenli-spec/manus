// الحزمة 3 — تحرير الدفع (بندا العقد 3 و6): تغيير حساب المورد البنكي بتحقق مستقل وتفعيل مؤجل ومتدرّج،
// والتنفيذ محلي ومحاكى حتى يوجد وصول خارجي معتمد. ما يثبته هذا الملف:
//   • التغيير المتحقق منه يُحِلّ الحساب الجديد محل القديم (superseded)، ويُسجَّل تغييرًا له مهلة تهدئة وخطوة إطلاق
//     لأول دفعة بيد شخص ثالث، ويُبلغ المالية داخل المنصة، ويترك رسالة «محاكاة» لجهة الاتصال الموثقة سابقًا.
//   • أيام التهدئة وسقف أول دفعة قيمتان للمالك: ما دامتا بلا اعتماد يبقى الحساب المتغيّر موقوفًا برفض يسمّيهما ومالكهما.
//   • جامع البيانات ومن تحقق منها لا يعدّان ولا يعتمدان ولا يطلقان دفعًا لذلك المورد أثناء النافذة — في الكود وفي SQL.
//   • الآيبان الموجود على مورد نشط آخر لا يُتحقق منه إلا بقرار مسبَّب يسجّله شخص آخر.
//   • أمر الدفع يدفع جزءًا من المستحق أو عدة مستحقات لمورد واحد بتحويل واحد، وpayableBalance تقول الرصيد في كل خطوة.
//   • المرتجع سجل مستقل لا يُعدَّل، يعيد فتح الرصيد ولا يمسّ الأمر المنفّذ؛ والتسويات (إشعار دائن أو مدين) باعتماد مستقل.
//   • التنفيذ «مسجَّل يدويًا» ومحاكى: لا شاشة ولا حمولة تقول إن المنصة دفعت.
//   • سباق حقيقي بين عمليات على ملف قاعدة واحد لا يُطلق المال مرتين.
// البيانات مصطنعة كلها: لا مورد حقيقي ولا آيبان حقيقي ولا موظف حقيقي.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, now, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import * as vendors from '../app/vendors.mjs';
import * as payables from '../app/payables.mjs';
import { adoptionAction, adopted } from '../app/options.mjs';
import { MODULE_STATUS_MAP } from '../app/static/vocabulary.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch, PASSWORD } from './definitions-fixture.mjs';
import { payablesUI } from '../app/static/payables-ui.mjs';
import { vendorsUI } from '../app/static/vendors-ui.mjs';
import { kit } from '../app/static/kit.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const WORKER=join(ROOT,'tests/payment-release-worker.mjs');
const DAY=86400000;
const DAYS='vendors.bank_change_cooling_off_days',CAP='payables.bank_change_first_payment_cap';
const code=value=>error=>error.code===value;
const caught=run=>{try{run();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*DAY).toISOString().slice(0,10);
// آيبان مصطنع بخانتي تحقق صحيحتين؛ لا يمثل حسابًا حقيقيًا.
function iban(bban){const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;}
const IBAN={a:iban('80000000000000000011'),changed:iban('80000000000000000012'),again:iban('80000000000000000013'),b:iban('80000000000000000021'),bChanged:iban('80000000000000000022')};
const FULL_IBAN=/SA\d{22}/;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={e,money:minor=>String(minor),tr:ar=>ar,lang:'ar',ui:kit(e,ar=>ar),button:(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`};

// الأدوار: employee يعدّ (ويسجّل الموردين)، outsider يجمع بيانات الحساب ويحمل إعدادًا وتوثيقًا ماليًا، hr وcontroller
// يتحققان ماليًا (وcontroller يحمل الاعتماد أيضًا)، manager يعتمد، releaser يطلق أول دفعة، treasurer يوثّق التنفيذ والمرتجع.
const FINANCE={employee:['read','prepare'],outsider:['read','prepare','post'],manager:['read','approve'],controller:['read','approve'],releaser:['read','approve'],treasurer:['read','post']};
export function buildWorld(db){
  seed(db,PASSWORD);
  const insert=db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT ?,'36t','ops',?,?,password_hash,'employee','manager' FROM users WHERE id='manager'");
  for(const [id,name] of [['treasurer','أمين خزينة مصطنع'],['controller','مراقب مالي مصطنع'],['releaser','مطلق دفعات مصطنع']])insert.run(id,id,name);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of Object.entries(FINANCE))for(const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مدفوعات مصطنع',null,now());
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح اختبار مصطنع'}));
  grant('employee','vendors.manage');grant('outsider','vendors.manage');grant('hr','vendors.bank');grant('controller','vendors.bank');
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع تحرير الدفع المصطنع',brief:'اختبار دفع الموردين',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  approveVendors(db,['supplier-a','supplier-b','supplier-c']);
  const vendorOf=key=>db.prepare('SELECT id FROM vendors WHERE supplier_key=?').get(key).id;
  const A=vendorOf('SUPPLIER-A'),B=vendorOf('SUPPLIER-B'),C=vendorOf('SUPPLIER-C');
  const vAct=(who,vendorId,action,values={})=>transaction(db,()=>vendors.vendorAction(db,users[who],vendorId,action,{version:vendors.getVendor(db,users[who],vendorId).version,...values}));
  // جهة اتصال المورد أ أدخلها employee ووثّقها outsider قبل أي تغيير — هي «جهة الاتصال الموثقة سابقًا».
  const contact=vendors.getVendor(db,users.outsider,A).contacts[0];
  vAct('outsider',A,'trust_contact',{contact_id:contact.id,basis:'وردت في العقد الموقع مع المورد المصطنع'});
  // الحساب الأول لكل مورد ليس تغييرًا: لا مهلة ولا إطلاق.
  const firstBank=(vendorId,value,collector)=>{
    vAct(collector,vendorId,'propose_bank',{bank_name:'بنك مصطنع',account_holder:'منشأة مصطنعة',iban:value,reason:'تسجيل حساب الدفع الأول للمورد'});
    const pending=db.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id=? AND status='pending'").get(vendorId).id;
    vAct('hr',vendorId,'verify_bank',{bank_id:pending,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق لاسم المورد',effective_from:riyadh()});
  };
  firstBank(A,IBAN.a,'outsider');firstBank(B,IBAN.b,'employee');
  const pAct=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  const purchase=(winner,prices,invoices)=>{
    let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'طباعة مصطنعة '+winner,specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:5,unit:'نسخة',budget_amount:'600.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
    p=pAct('employee',p,'submit');
    for(const [key,price] of prices)p=pAct('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
    p=pAct('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key===winner.toUpperCase()).id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
    p=pAct('manager',p,'approve_order',{terms:'تسليم دفعة واحدة بعد فحص الجودة',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
    p=pAct('manager',p,'commence',{start_on:riyadh(),valid_until:'2099-12-31',site_or_channel:'مطبعة المورد المصطنعة',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
    p=pAct('employee',p,'receive',{quantity:5,reference:'receipt-'+winner,evidence:'استلام خمس نسخ وفحصها محليًا'});
    for(const [reference,quantity,amount] of invoices)p=pAct('employee',p,'record_invoice',{supplier_reference:reference,quantity,amount,evidence:'فاتورة مورد مصطنعة '+reference});
    for(const invoice of p.invoices)p=pAct('manager',p,'match',{invoice_id:invoice.id,note:'طابقنا الأمر والاستلام والفاتورة'});
    return p;
  };
  const pa=purchase('supplier-a',[['supplier-a','115.00'],['supplier-b','116.00'],['supplier-c','117.00']],[['inv-a1',2,'230.00'],['inv-a2',3,'345.00']]);
  const pb=purchase('supplier-b',[['supplier-a','118.00'],['supplier-b','110.00'],['supplier-c','119.00']],[['inv-b1',5,'550.00']]);
  const payableFor=reference=>db.prepare('SELECT p.id FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id WHERE i.supplier_reference=?').get(reference.toUpperCase()).id;
  // الحسابات كلها بعد التجهيز: مساعد المخصص يضيف حسابي budget-preparer وbudget-reviewer بتفويض مالي.
  const everyone=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {users:everyone,A,B,C,a1:payableFor('inv-a1'),a2:payableFor('inv-a2'),b1:payableFor('inv-b1'),purchases:[pa.id,pb.id]};
}

function world(t){
  const db=openDb(':memory:');t.after(()=>db.close());
  const built=buildWorld(db),{users}=built;
  const vAct=(who,vendorId,action,values={})=>transaction(db,()=>vendors.vendorAction(db,users[who],vendorId,action,{version:vendors.getVendor(db,users[who],vendorId).version,...values}));
  const prepare=(who,input)=>payables.getOrder(db,users[who],transaction(db,()=>payables.preparePayment(db,users[who],input)).id);
  const act=(who,order,action,values={})=>transaction(db,()=>payables.paymentAction(db,users[who],order.id,action,{version:payables.getOrder(db,users[who],order.id).version,...values}));
  const execute=(order,reference,who='treasurer')=>act(who,order,'record_execution',{executed_on:riyadh(),bank_reference:reference,evidence:'إشعار تحويل بنكي مصطنع محفوظ في مجلد الخزينة'});
  const approve=(order,who='manager')=>act(who,order,'approve_order',{note:'طابقت المستحق والمورد والحساب'});
  const adopt=(key,value,effective=riyadh())=>{
    transaction(db,()=>adoptionAction(db,users.hr,key,'record',{value,basis:'قرار مصطنع للاختبار بعد مراجعة المالية',effective_from:effective}));
    const row=db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL ORDER BY created_at DESC,rowid DESC').get(key);
    transaction(db,()=>adoptionAction(db,users.controller,key,'approve',{adoption_id:row.id,note:'اعتمدنا القرار المصطنع بعد مراجعته'}));
  };
  // تغيير حساب المورد أ: يجمعه collector ويتحقق منه verifier باتصال مرتد بجهة الاتصال الموثقة قبل الطلب.
  const changeBank=({vendorId=built.A,collector='outsider',verifier='controller',value=IBAN.changed,effective=riyadh(),method='trusted_contact_callback'}={})=>{
    vAct(collector,vendorId,'propose_bank',{bank_name:'بنك مصطنع آخر',account_holder:'منشأة مصطنعة',iban:value,reason:'المورد أبلغ بتغيير حسابه البنكي'});
    const pending=db.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id=? AND status='pending'").get(vendorId).id;
    vAct(verifier,vendorId,'verify_bank',{bank_id:pending,decision:'verified',verification_method:method,verification_evidence:'اتصال مرتد بجهة الاتصال الموثقة وأكدت التغيير',effective_from:effective});
    return db.prepare('SELECT * FROM vendor_bank_changes WHERE bank_account_id=?').get(pending);
  };
  const balance=id=>{const b=payables.payableBalance(db,id);return b&&{adjusted:b.adjusted_minor,paid:b.paid_minor,in_flight:b.in_flight_minor,available:b.available_minor,outstanding:b.outstanding_minor,status:b.status};};
  return {db,...built,vAct,prepare,act,execute,approve,adopt,changeBank,balance};
}
const returnInput=(overrides={})=>({returned_on:riyadh(),bank_reference:'RET-1',credited:'549.50',reason:'رجع التحويل لأن حساب المستفيد مغلق',evidence:'إشعار إرجاع مصطنع من البنك محفوظ في مجلد الخزينة',...overrides});

/* ───── 1) التغيير: إحلال وسجل وإشعار ورسالة محاكاة ───── */
test('bank change: verifying a replacement supersedes the old account, records the change, tells finance in the platform and leaves a simulated message for the previously trusted contact',t=>{
  const w=world(t),{db,users}=w;
  const change=w.changeBank();
  assert.ok(change,'a verified replacement is recorded as a bank change');
  const rows=db.prepare('SELECT id,status FROM vendor_bank_accounts WHERE vendor_id=? ORDER BY collected_at,rowid').all(w.A);
  assert.deepEqual(rows.map(r=>r.status),['superseded','verified'],'the replaced account is marked superseded, not left payable');
  assert.equal(change.replaces_id,rows[0].id);
  assert.deepEqual([change.collected_by,change.verified_by,change.verified_on],['outsider','controller',riyadh()]);
  // إشعار المالية داخل المنصة: لمن يعدّ ويعتمد ويوثّق، لا للفاعل نفسه، وبلا آيبان.
  const notes=db.prepare("SELECT user_id,title,body FROM notifications WHERE subject_kind='vendor_bank_change' AND subject_id=?").all(change.id);
  const recipients=notes.map(n=>n.user_id);
  for(const who of ['employee','manager','releaser','treasurer'])assert.ok(recipients.includes(who),`${who} is told in the platform`);
  assert.ok(!recipients.includes('controller'),'the verifier is not notified of their own act');
  assert.doesNotMatch(JSON.stringify(notes),FULL_IBAN,'no full IBAN in a notice');
  assert.match(notes[0].body,/شخص ثالث/,'the notice says the first payment needs a third person');
  // رسالة لجهة الاتصال الموثقة سابقًا: مسجَّلة محاكاةً ولا تُرسل.
  const outbox=db.prepare('SELECT * FROM vendor_outbox WHERE subject_id=?').all(change.id);
  const trusted=vendors.getVendor(db,users.outsider,w.A).contacts.find(c=>c.trusted_at);
  assert.equal(outbox.length,1);
  assert.deepEqual([outbox[0].contact_id,outbox[0].status,outbox[0].simulated,outbox[0].channel],[trusted.id,'simulated',1,'email']);
  assert.doesNotMatch(outbox[0].body,FULL_IBAN);
  assert.match(outbox[0].body,/\d{4}/,'the message names the last four digits only');
  // شاشة المورد: الحساب الجديد موقوف عن الدفع، والقديم «حل محله حساب أحدث».
  const view=vendors.getVendor(db,users.controller,w.A);
  const current=view.bank.find(b=>b.status==='verified');
  assert.equal(current.change.state,'unadopted');
  assert.equal(view.payment_ready,false);
  assert.equal(current.change.notices.length,1);
  assert.equal(current.change.notices[0].simulated,true);
  const html=vendorsUI.render({...vendors.listVendors(db,users.controller)},ctx);
  assert.match(html,/محاكاة/,'the screen says the message was simulated, not sent');
  assert.match(html,/حل محله حساب أحدث/);
  assert.match(html,/الحساب الجديد موقوف في مهلة التهدئة/,'the card says the account is held, not missing');
  assert.match(html,/مهلة التهدئة ما تقررت للحين/);
  // سجل ثابت: لا تعديل ولا حذف للتغيير ولا للرسالة.
  assert.throws(()=>db.prepare("UPDATE vendor_bank_changes SET verified_on='2020-01-01' WHERE id=?").run(change.id),/bank changes are kept as recorded/);
  assert.throws(()=>db.prepare('DELETE FROM vendor_bank_changes WHERE id=?').run(change.id),/bank changes are kept as recorded/);
  assert.throws(()=>db.prepare("UPDATE vendor_outbox SET status='sent' WHERE id=?").run(outbox[0].id),/simulated messages are kept as recorded/);
  assert.throws(()=>db.prepare('DELETE FROM vendor_outbox WHERE id=?').run(outbox[0].id),/simulated messages are kept as recorded/);
  // مورد بلا جهة اتصال موثقة: الرسالة تُسجَّل بلا مستلم ويقال ذلك، ولا يُخترع عنوان.
  const other=w.changeBank({vendorId:w.B,collector:'outsider',verifier:'hr',value:IBAN.bChanged,method:'bank_letter'});
  const orphan=db.prepare('SELECT * FROM vendor_outbox WHERE subject_id=?').all(other.id);
  assert.deepEqual(orphan.map(r=>[r.status,r.contact_id,r.channel]),[['no_recipient',null,'none']]);
  assert.ok(verifyAudit(db));
});

/* ───── 2) القيمتان للمالك: بلا اعتماد يبقى الحساب المتغيّر موقوفًا ───── */
test('bank change: while the owner has not adopted the cooling-off days or the first-payment cap, the changed account stays blocked with a refusal naming both decisions and their owner',t=>{
  const w=world(t),{db,users}=w;
  // القيمتان مسجّلتان بلا رقم: المنصة لا تخترع عدد أيام ولا مبلغًا.
  const days=adopted(db,'36t',DAYS),cap=adopted(db,'36t',CAP);
  assert.deepEqual([days.source,days.value.days,cap.source,cap.value.amount],['code_default',null,'code_default',null]);
  assert.ok(days.owner&&cap.owner);
  // قبل أي تغيير: الحساب الأول يُدفع له كالمعتاد، فالقيمتان لا تمسّان من لم يغيّر حسابه.
  const ordinary=w.prepare('employee',{payable_id:w.b1});
  assert.equal(ordinary.first_payment.required,false);
  w.changeBank();
  let refused=caught(()=>w.prepare('employee',{payable_id:w.a1}));
  assert.equal(refused.code,'bank_change_unadopted');
  const missing=refused.details.refusal.missing;
  assert.equal(missing.length,2);
  assert.ok(missing.some(m=>m.document.includes(DAYS)),'the cooling-off decision is named');
  assert.ok(missing.some(m=>m.document.includes(CAP)),'the first-payment cap decision is named');
  assert.ok(missing.every(m=>m.owner&&m.owner_role==='finance'),'and so is its owner');
  const listed=payables.listPayables(db,users.employee).payables.find(p=>p.id===w.a1);
  assert.equal(listed.payable,false);
  assert.match(listed.block_reason,/التهدئة/);
  // اعتماد الأيام وحدها: الرفض يسمّي الناقص الباقي فقط.
  w.adopt(DAYS,{days:0});
  refused=caught(()=>w.prepare('employee',{payable_id:w.a1}));
  assert.equal(refused.code,'bank_change_unadopted');
  assert.deepEqual(refused.details.refusal.missing.map(m=>m.document.includes(CAP)),[true]);
  w.adopt(CAP,{amount:'1000.00'});
  assert.equal(w.prepare('employee',{payable_id:w.a1,amount:'10.00'}).first_payment.required,true);
  // قيمة لا تُقرأ (أيام سالبة) لا تُعامل كقرارٍ ولو اعتمدها شخصان: من يوم سريانها يعود الحساب المتغيّر موقوفًا.
  w.adopt(DAYS,{days:-1},riyadh(1));
  assert.equal(vendors.coolingOffDays(db,'36t',riyadh()).days,0);
  assert.equal(vendors.coolingOffDays(db,'36t',riyadh(1)).days,null);
  assert.equal(vendors.bankChangeState(db,'36t',db.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id=? AND status='verified'").get(w.A).id,riyadh(1)).state,'unadopted');
  assert.ok(verifyAudit(db));
});

/* ───── 3) المهلة تُحسب من يوم التحقق، ثم أول دفعة بسقف وإطلاق ───── */
test('bank change: cooling-off counts from the verification day; afterwards the first payment is capped, released by a third person, and only then recorded as executed',t=>{
  const start=Date.parse('2026-10-04T06:00:00.000Z');
  t.mock.timers.enable({apis:['Date'],now:start});
  const w=world(t),{db,users}=w;
  w.adopt(DAYS,{days:3});w.adopt(CAP,{amount:'100.00'});
  t.mock.timers.setTime(start+60000);
  const change=w.changeBank();
  assert.equal(change.verified_on,'2026-10-04');
  let refused=caught(()=>w.prepare('employee',{payable_id:w.a1,amount:'50.00'}));
  assert.equal(refused.code,'bank_change_cooling_off');
  assert.match(refused.message,/2026-10-07/,'the refusal says the day payment opens');
  assert.equal(vendors.getVendor(db,users.controller,w.A).bank.find(b=>b.status==='verified').change.payable_from,'2026-10-07');
  t.mock.timers.setTime(start+2*DAY);
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a1,amount:'50.00'})).code,'bank_change_cooling_off');
  t.mock.timers.setTime(start+3*DAY);
  // السقف: أول دفعة لحساب متغيّر لا تتجاوز ما قرّره المالك.
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a1})).code,'first_payment_cap');
  let order=w.prepare('employee',{payable_id:w.a1,amount:'100.00'});
  assert.deepEqual([order.amount_minor,order.first_payment.required,order.first_payment.released],[10000,true,false]);
  // دفعة أولى واحدة في الطريق: لا تُفتح ثانية حتى تُنفَّذ الأولى.
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a2,amount:'10.00'})).code,'first_payment_in_flight');
  order=w.approve(order);
  assert.ok(!order.actions.includes('record_execution'),'no execution before the release');
  // التوثيق قبل الإطلاق مرفوض في الكود...
  assert.equal(caught(()=>w.execute(order,'CHG-1')).code,'first_payment_release_required');
  // ...وفي SQL.
  assert.throws(()=>db.prepare("UPDATE payment_orders SET status='executed',executed_on=?,bank_reference='RAW-CHG',execution_evidence='إشعار تحويل بنكي مصطنع مباشر',execution_recorded_by='treasurer',version=version+1 WHERE id=?").run(riyadh(),order.id),/released by a third person/);
  // المعتمد لا يطلق ما اعتمده.
  assert.equal(caught(()=>w.act('manager',order,'release_first_payment',{note:'إطلاق من المعتمد نفسه'})).code,'separation_of_duties');
  order=w.act('releaser',order,'release_first_payment',{note:'اتصلنا بجهة الاتصال الموثقة سابقًا وأكدت الحساب الجديد'});
  assert.equal(order.first_payment.released,true);
  assert.equal(caught(()=>w.act('releaser',order,'release_first_payment',{note:'إطلاق ثانٍ للأمر نفسه'})).code,'action_unavailable');
  assert.throws(()=>db.prepare("UPDATE payment_order_releases SET note='تعديل بعد الإطلاق' WHERE order_id=?").run(order.id),/releases are kept as recorded/);
  order=w.execute(order,'CHG-1');
  assert.equal(order.status,'executed');
  // بعد تنفيذ أول دفعة تُقفل النافذة: الدفعة التالية عادية بلا سقف ولا إطلاق.
  const next=w.prepare('employee',{payable_id:w.a2});
  assert.deepEqual([next.amount_minor,next.first_payment.required],[34500,false]);
  const view=vendors.getVendor(db,users.controller,w.A);
  assert.equal(view.bank.find(b=>b.status==='verified').change.state,'settled');
  assert.equal(view.payment_ready,true);
  const events=db.prepare("SELECT action FROM audit_events WHERE entity_id=? ORDER BY seq").all(order.id).map(r=>r.action);
  assert.deepEqual(events,['payment.prepared','payment.approve_order','payment.release_first_payment','payment.record_execution']);
  assert.ok(verifyAudit(db));
});

/* ───── 4) فصل المهام أثناء النافذة: في الكود وفي SQL ───── */
test('bank change window: the collector and the verifier cannot prepare, approve, release or record the first payment to that vendor — refused in code and in SQL — and a returned first payment reopens the window',t=>{
  const w=world(t),{db,users}=w;
  w.adopt(DAYS,{days:0});w.adopt(CAP,{amount:'1000.00'});
  const change=w.changeBank({collector:'outsider',verifier:'controller'});
  // outsider جمع الحساب ويحمل تفويض الإعداد: ممنوع.
  assert.equal(caught(()=>w.prepare('outsider',{payable_id:w.a1})).code,'bank_change_separation');
  const raw=(preparedBy,payableId=w.a1)=>db.prepare("INSERT INTO payment_orders(id,tenant_id,payable_id,vendor_id,bank_account_id,amount_minor,currency,status,prepared_by,created_at,updated_at) VALUES(?,'36t',?,?,?,100,'SAR','pending',?,?,?)").run(randomUUID(),payableId,w.A,change.bank_account_id,preparedBy,now(),now());
  assert.throws(()=>raw('outsider'),/collector and the verifier/);
  assert.throws(()=>raw('controller'),/collector and the verifier/);
  let order=w.prepare('employee',{payable_id:w.a1});
  // controller تحقق من الحساب ويحمل تفويض الاعتماد: ممنوع.
  assert.ok(!payables.getOrder(db,users.controller,order.id).actions.includes('approve_order'));
  assert.equal(caught(()=>w.approve(order,'controller')).code,'bank_change_separation');
  assert.throws(()=>db.prepare("UPDATE payment_orders SET status='approved',approved_by='controller',approved_at=?,version=version+1 WHERE id=?").run(now(),order.id),/collector and the verifier/);
  order=w.approve(order);
  assert.equal(caught(()=>w.act('controller',order,'release_first_payment',{note:'إطلاق من المتحقق من الحساب'})).code,'bank_change_separation');
  const release=(by)=>db.prepare('INSERT INTO payment_order_releases(order_id,tenant_id,change_id,released_by,note,created_at) VALUES(?,?,?,?,?,?)').run(order.id,'36t',change.id,by,'إطلاق مباشر بلا المسار',now());
  for(const by of ['outsider','controller','employee','manager'])assert.throws(()=>release(by),/neither the collector/,by);
  order=w.act('releaser',order,'release_first_payment',{note:'اتصلنا بجهة الاتصال الموثقة سابقًا وأكدت الحساب الجديد'});
  // outsider يحمل تفويض التوثيق لكنه جامع البيانات.
  assert.ok(!payables.getOrder(db,users.outsider,order.id).actions.includes('record_execution'));
  assert.throws(()=>db.prepare("UPDATE payment_orders SET status='executed',executed_on=?,bank_reference='RAW-OUT',execution_evidence='توثيق مباشر من جامع البيانات',execution_recorded_by='outsider',version=version+1 WHERE id=?").run(riyadh(),order.id),/do not record its first payment|third person/);
  order=w.execute(order,'CHG-FIRST');
  // بعد تنفيذ أول دفعة يرتفع المنع.
  const later=w.prepare('outsider',{payable_id:w.a2,amount:'10.00'});
  assert.equal(later.status,'pending');
  // ورجوع أول دفعة يعيد فتح النافذة: المنع يعود، والأمر الذي أعدّه جامع البيانات لا يُعتمد.
  w.act('treasurer',order,'record_return',returnInput({credited:'230.00'}));
  assert.equal(caught(()=>w.prepare('outsider',{payable_id:w.a1,amount:'5.00'})).code,'bank_change_separation');
  assert.equal(caught(()=>w.approve(later)).code,'bank_change_separation');
  assert.equal(vendors.getVendor(db,users.controller,w.A).bank.find(b=>b.status==='verified').change.state,'first_payment');
  assert.ok(verifyAudit(db));
});

/* ───── 5) الآيبان على مورد نشط آخر ───── */
test('shared IBAN: verification is refused while the IBAN sits on another active vendor, until a separate reasoned decision by someone other than the collector allows it — and the decider does not verify',t=>{
  const w=world(t),{db,users}=w;
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'outsider',capability:'vendors.bank',note:'تصريح اختبار مصطنع'}));
  w.vAct('outsider',w.C,'propose_bank',{bank_name:'بنك مصطنع',account_holder:'منشأة مصطنعة',iban:IBAN.a,reason:'حساب أبلغ عنه المورد ج ويطابق حساب مورد آخر'});
  const pending=db.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id=? AND status='pending'").get(w.C).id;
  const verify=who=>w.vAct(who,w.C,'verify_bank',{bank_id:pending,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق لاسم صاحب الحساب',effective_from:riyadh()});
  const refused=caught(()=>verify('hr'));
  assert.equal(refused.code,'iban_on_another_vendor');
  const codeA=db.prepare('SELECT code FROM vendors WHERE id=?').get(w.A).code;
  assert.match(refused.message,new RegExp(codeA),'the refusal names the other vendor');
  assert.doesNotMatch(refused.message,FULL_IBAN);
  assert.throws(()=>db.prepare("UPDATE vendor_bank_accounts SET status='verified',verified_by='hr',verified_at=?,verification_method='bank_letter',verification_evidence='تحقق مباشر',effective_from=? WHERE id=?").run(now(),riyadh(),pending),/separate reasoned decision/);
  const decide=(who,reason='المورد ج وكيل تحصيل للمورد أ بعقد وكالة موقع ومحفوظ في ملفهما')=>w.vAct(who,w.C,'allow_shared_iban',{bank_id:pending,other_vendor_id:w.A,reason});
  // جامع البيانات لا يقرّر قبول الآيبان المشترك.
  assert.ok(!vendors.getVendor(db,users.outsider,w.C).actions.includes('allow_shared_iban'));
  assert.equal(caught(()=>decide('outsider')).code,'action_unavailable');
  assert.equal(caught(()=>decide('controller','قصير')).code,'invalid_text');
  const decided=decide('controller');
  assert.ok(decided.bank.find(b=>b.id===pending).shared_decisions.length===1);
  // من قرّر لا يتحقق بنفسه.
  assert.equal(caught(()=>verify('controller')).code,'separation_of_duties');
  const done=verify('hr');
  assert.equal(done.bank.find(b=>b.id===pending).status,'verified');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vendor_bank_changes WHERE vendor_id=?').get(w.C).n,0,'a first account is not a change');
  const row=db.prepare('SELECT id FROM vendor_bank_shared_decisions WHERE bank_account_id=?').get(pending);
  assert.throws(()=>db.prepare("UPDATE vendor_bank_shared_decisions SET reason='سبب آخر بعد القرار' WHERE id=?").run(row.id),/decisions are kept as recorded/);
  assert.throws(()=>db.prepare('DELETE FROM vendor_bank_shared_decisions WHERE id=?').run(row.id),/decisions are kept as recorded/);
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_id=? AND action='vendor.allow_shared_iban'").get(w.C));
  assert.ok(verifyAudit(db));
});

/* ───── 6) الدفع الجزئي والدفعي ───── */
test('partial and batch: an order pays part of a payable or several payables of one vendor in one transfer; payableBalance tracks each step; over-allocation is refused in code and in SQL',t=>{
  const w=world(t),{db,users}=w;
  assert.equal(typeof payables.payableBalance,'function','payableBalance is exported');
  assert.deepEqual(w.balance(w.a1),{adjusted:23000,paid:0,in_flight:0,available:23000,outstanding:23000,status:'not_paid'});
  let part=w.prepare('employee',{payable_id:w.a1,amount:'100.00'});
  assert.deepEqual([part.amount_minor,part.lines.length,part.lines[0].amount_minor],[10000,1,10000]);
  assert.deepEqual(w.balance(w.a1),{adjusted:23000,paid:0,in_flight:10000,available:13000,outstanding:23000,status:'payment_pending'});
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a1,amount:'130.01'})).code,'exceeds_balance');
  let rest=w.prepare('employee',{payable_id:w.a1,amount:'130.00'});
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a1})).code,'order_exists','nothing left to order: the balance is on its way');
  // SQL يحرس الرصيد حتى بلا الكود.
  const holder=w.prepare('employee',{payable_id:w.a2,amount:'1.00'});
  assert.throws(()=>db.prepare('INSERT INTO payment_order_lines(id,tenant_id,order_id,payable_id,line_no,amount_minor,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'36t',holder.id,w.a1,2,1,now()),/cannot exceed what is still open/);
  rest=w.act('employee',rest,'cancel_order',{note:'نعيد الدفع مع مستحق آخر بتحويل واحد'});
  w.act('employee',holder,'cancel_order',{note:'أمر مؤقت للاختبار يُلغى الآن'});
  assert.equal(w.balance(w.a1).available,13000,'a cancelled order frees its amount');
  // الدفعي: بقية المستحق الأول وكامل الثاني بتحويل واحد للمورد نفسه.
  assert.equal(caught(()=>w.prepare('employee',{lines:[{payable_id:w.a1,amount:'130.00'},{payable_id:w.b1,amount:'10.00'}]})).code,'batch_mixed_vendors');
  assert.equal(caught(()=>w.prepare('employee',{lines:[{payable_id:w.a1,amount:'10.00'},{payable_id:w.a1,amount:'10.00'}]})).code,'batch_duplicate_payable');
  assert.equal(caught(()=>w.prepare('employee',{lines:[]})).code,'invalid_lines');
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a1,lines:[{payable_id:w.a1,amount:'1.00'}]})).code,'invalid_fields');
  let batch=w.prepare('employee',{lines:[{payable_id:w.a1,amount:'130.00'},{payable_id:w.a2,amount:'345.00'}]});
  assert.deepEqual([batch.amount_minor,batch.lines.map(l=>l.amount_minor)],[47500,[13000,34500]]);
  // أمر بلا سطور تطابق مبلغه لا يُعتمد (SQL).
  const orphan=randomUUID(),bank=db.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id=? AND status='verified'").get(w.B).id;
  db.prepare("INSERT INTO payment_orders(id,tenant_id,payable_id,vendor_id,bank_account_id,amount_minor,currency,status,prepared_by,created_at,updated_at) VALUES(?,'36t',?,?,?,100,'SAR','pending','employee',?,?)").run(orphan,w.b1,w.B,bank,now(),now());
  assert.throws(()=>db.prepare("UPDATE payment_orders SET status='approved',approved_by='manager',approved_at=?,version=version+1 WHERE id=?").run(now(),orphan),/lines add up/);
  part=w.execute(w.approve(part),'PART-1');
  assert.deepEqual(w.balance(w.a1),{adjusted:23000,paid:10000,in_flight:13000,available:0,outstanding:13000,status:'partially_paid'});
  batch=w.execute(w.approve(batch),'BATCH-1');
  assert.equal(w.balance(w.a1).status,'paid');assert.equal(w.balance(w.a2).status,'paid');
  // الدفتر يرى تحويلًا واحدًا للدفعي: مستند واحد بسطرين متوازنين.
  const doc=payables.paymentLedgerDocument(db,'36t','supplier_payment',batch.id);
  assert.deepEqual(doc.lines.map(l=>[l[0],l[1],l[2]]),[['payable',47500,0],['bank',0,47500]]);
  const list=payables.listPayables(db,users.manager);
  assert.equal(list.payables.find(p=>p.id===w.a1).balance.status,'paid');
  assert.equal(list.totals.executed_minor,57500);
  assert.equal(list.totals.unpaid_minor,55000,'only the other vendor is still owed');
  assert.ok(verifyAudit(db));
});

/* ───── 7) المرتجع ───── */
test('returns: a bounced transfer is recorded once as its own record by a third person, the executed order is never edited, the balance reopens and can be paid again exactly once',t=>{
  const w=world(t),{db,users}=w;
  let order=w.prepare('outsider',{payable_id:w.b1});
  order=w.execute(w.approve(order),'TRX-B1');
  assert.equal(w.balance(w.b1).status,'paid');
  // من أعدّ الأمر أو اعتمده لا يسجّل مرتجعه.
  assert.equal(caught(()=>w.act('outsider',order,'record_return',returnInput())).code,'action_unavailable');
  assert.throws(()=>db.prepare('INSERT INTO payment_returns(id,tenant_id,order_id,returned_on,bank_reference,credited_minor,reason,evidence,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',order.id,riyadh(),'RAW-RET',100,'مرتجع مباشر للاختبار','دليل مرتجع مباشر للاختبار','outsider',now()),/neither prepared nor approved/);
  assert.equal(caught(()=>w.act('treasurer',order,'record_return',returnInput({credited:'550.01'}))).code,'return_exceeds_order');
  assert.equal(caught(()=>w.act('treasurer',order,'record_return',returnInput({returned_on:riyadh(-1)}))).code,'returned_on');
  order=w.act('treasurer',order,'record_return',returnInput());
  assert.deepEqual([order.status,order.returned,order.return.credited_minor],['executed',true,54950],'the executed order stays executed; the return is its own record');
  assert.match(order.status_name,/رجع/);
  assert.deepEqual(w.balance(w.b1),{adjusted:55000,paid:0,in_flight:0,available:55000,outstanding:55000,status:'not_paid'});
  assert.equal(caught(()=>w.act('treasurer',order,'record_return',returnInput({bank_reference:'RET-2'}))).code,'action_unavailable','a replayed return is refused');
  const ret=db.prepare('SELECT id FROM payment_returns WHERE order_id=?').get(order.id);
  assert.throws(()=>db.prepare("UPDATE payment_returns SET credited_minor=1 WHERE id=?").run(ret.id),/returns are kept as recorded/);
  assert.throws(()=>db.prepare('DELETE FROM payment_returns WHERE id=?').run(ret.id),/returns are kept as recorded/);
  assert.throws(()=>db.prepare("UPDATE payment_orders SET status='cancelled',version=version+1 WHERE id=?").run(order.id),/executed orders are final/);
  // الرصيد المفتوح يُدفع مرة واحدة فقط.
  const again=w.prepare('employee',{payable_id:w.b1});
  assert.equal(again.amount_minor,55000);
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.b1})).code,'order_exists');
  // خطّاف الدفتر: المرتجع مستند مستقل بسطور متوازنة، والفرق رسوم بنك.
  const listed=payables.paymentLedgerSources(db,'36t').find(s=>s.source_kind==='supplier_payment_return');
  assert.equal(listed.source_id,ret.id);
  const doc=payables.paymentLedgerDocument(db,'36t','supplier_payment_return',ret.id);
  const debit=doc.lines.reduce((n,l)=>n+l[1],0),credit=doc.lines.reduce((n,l)=>n+l[2],0);
  assert.equal(debit,credit);assert.equal(debit,55000);
  assert.deepEqual(doc.lines.map(l=>l[0]).sort(),['bank','bank_charges','payable']);
  const log=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='payment.record_return'").get(order.id).after_json);
  assert.deepEqual(log.reopened,[{payable_id:w.b1,amount_minor:55000}]);
  assert.ok(verifyAudit(db));
});

/* ───── 8) التسويات: إشعار دائن أو مدين من المورد ───── */
test('adjustments: supplier credit and debit notes are append-only, reasoned and approved by a second person; they move the balance, and a credit can never go below what is paid or on its way',t=>{
  const w=world(t),{db,users}=w;
  const record=(who,input={})=>transaction(db,()=>payables.recordAdjustment(db,users[who],{payable_id:w.a1,kind:'credit',amount:'30.00',vat:'3.91',reference:'CN-1',reason:'خصم تأخير متفق عليه مع المورد المصطنع',evidence:'إشعار دائن مصطنع محفوظ في مجلد المشتريات',...input}));
  const decide=(who,id,decision,note='راجعنا الإشعار وطابقناه مع الفاتورة')=>transaction(db,()=>payables.decideAdjustment(db,users[who],id,decision,{note}));
  const credit=record('budget-preparer').id;
  assert.equal(w.balance(w.a1).adjusted,23000,'a pending note moves nothing');
  assert.equal(caught(()=>decide('budget-preparer',credit,'approve')).code,'self_approval');
  assert.equal(caught(()=>record('employee',{vat:'31.00'})).code,'invalid_vat');
  decide('manager',credit,'approve');
  assert.deepEqual([w.balance(w.a1).adjusted,w.balance(w.a1).available],[20000,20000]);
  assert.equal(caught(()=>record('employee')).code,'duplicate_adjustment');
  const debit=record('employee',{kind:'debit',amount:'10.00',vat:'0',reference:'DN-1',reason:'فرق شحن متفق عليه يضاف للمستحق'}).id;
  decide('manager',debit,'approve');
  assert.equal(w.balance(w.a1).adjusted,21000);
  // إشعار دائن معلّق، ثم يذهب الرصيد كله في أمر: اعتماده يُرفض في الكود وفي SQL.
  const pending=record('employee',{amount:'5.00',vat:'0',reference:'CN-2'}).id;
  const order=w.prepare('employee',{payable_id:w.a1});
  assert.equal(order.amount_minor,21000);
  assert.equal(caught(()=>record('employee',{amount:'1.00',vat:'0',reference:'CN-3'})).code,'adjustment_exceeds_balance');
  assert.equal(caught(()=>decide('manager',pending,'approve')).code,'adjustment_exceeds_balance');
  assert.throws(()=>db.prepare("UPDATE payable_adjustments SET status='approved',decided_by='manager',decided_at=?,decision_note='اعتماد مباشر' WHERE id=?").run(now(),pending),/below what is already paid or on its way/);
  decide('manager',pending,'reject','الرصيد كله في أمر دفع؛ يُعاد الإشعار بعد التنفيذ إن لزم');
  assert.throws(()=>db.prepare("UPDATE payable_adjustments SET amount_minor=1 WHERE id=?").run(credit),/decided once and never edited/);
  assert.throws(()=>db.prepare('DELETE FROM payable_adjustments WHERE id=?').run(credit),/adjustments are kept/);
  assert.throws(()=>db.prepare("INSERT INTO payable_adjustments(id,tenant_id,payable_id,vendor_id,kind,amount_minor,vat_minor,reference,reason,evidence,source_kind,status,recorded_by,decided_by,decided_at,created_at) VALUES(?,?,?,?,'credit',100,0,'CN-X','سبب مباشر للاختبار','دليل مباشر للاختبار','manual','approved','manager','manager',?,?)").run(randomUUID(),'36t',w.a1,w.A,now(),now()),/CHECK|pending/);
  const listed=payables.listPayables(db,users.manager).payable_adjustments;
  assert.deepEqual(listed.map(a=>a.status).sort(),['approved','approved','rejected']);
  // خطّاف الدفتر: الإشعار الدائن المعتمد مستند بسطور متوازنة وضريبته منفصلة.
  const doc=payables.paymentLedgerDocument(db,'36t','supplier_adjustment',credit);
  assert.equal(doc.lines.reduce((n,l)=>n+l[1],0),doc.lines.reduce((n,l)=>n+l[2],0));
  assert.deepEqual(doc.lines.find(l=>l[0]==='input_vat').slice(1,3),[0,391]);
  // مستحق سوّاه إشعار دائن كله: ما عليه شيء ولا دُفع منه شيء — «settled»، ولا يُعدّ له أمر.
  const whole=record('employee',{payable_id:w.a2,amount:'345.00',vat:'45.00',reference:'CN-ALL',reason:'المورد ألغى الفاتورة كلها بإشعار دائن'}).id;
  decide('manager',whole,'approve');
  assert.deepEqual([w.balance(w.a2).adjusted,w.balance(w.a2).status],[0,'settled']);
  assert.equal(caught(()=>w.prepare('employee',{payable_id:w.a2})).code,'payable_settled');
  assert.ok(verifyAudit(db));
});

/* ───── 9) صياغة التنفيذ ───── */
test('execution wording: every order says execution was recorded manually and simulated; the payload and the screen never claim the platform paid',t=>{
  const w=world(t),{db,users}=w;
  let order=w.execute(w.approve(w.prepare('employee',{payable_id:w.b1})),'TRX-WORD');
  const view=payables.getOrder(db,users.treasurer,order.id);
  assert.deepEqual([view.execution_mode,view.simulated],['recorded_manually',true]);
  assert.match(view.status_name,/يدوي/);
  assert.match(MODULE_STATUS_MAP.payment_order.executed.phrase,/يدوي/,'the one vocabulary says it too');
  const list=payables.listPayables(db,users.treasurer);
  assert.deepEqual([list.execution.mode,list.execution.simulated],['recorded_manually',true]);
  const log=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='payment.record_execution'").get(order.id).after_json);
  assert.deepEqual([log.execution_mode,log.simulated],['recorded_manually',true]);
  const html=payablesUI.render(list,ctx);
  assert.match(html,/يدوي/);
  assert.match(html,/المنصة ما تحوّل/);
  assert.doesNotMatch(html,/مدفوع وموثق|دفعت المنصة|المنصة دفعت|المنصة حوّلت/);
  assert.ok(verifyAudit(db));
});

/* ───── 10) مركز الموردين: «مطابَق غير مدفوع» ───── */
test('vendor centre: open payables count only what is still owed — a paid payable is not open, a return reopens it',t=>{
  const w=world(t),{db,users}=w;
  const spend=()=>{const s=vendors.getVendor(db,users.employee,w.A).spend;return [s.open_payables,s.payable_minor];};
  assert.deepEqual(spend(),[2,57500]);
  const full=w.execute(w.approve(w.prepare('employee',{payable_id:w.a1})),'SPEND-1');
  assert.deepEqual(spend(),[1,34500],'the paid payable is no longer open');
  w.execute(w.approve(w.prepare('employee',{payable_id:w.a2,amount:'100.00'})),'SPEND-2');
  assert.deepEqual(spend(),[1,24500]);
  w.act('treasurer',full,'record_return',returnInput({credited:'230.00'}));
  assert.deepEqual(spend(),[2,47500],'a return reopens it');
});

/* ───── 11) عزل الكيانات ───── */
test('tenant isolation: another tenant sees no balance, order, return or adjustment and cannot act on any of them',t=>{
  const w=world(t),{db,users}=w;
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES('iso-admin','isolated','other','iso-admin','مسؤول الكيان المعزول','unused','manager')").run();
  for(const action of ['read','prepare','approve','post'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'isolated','external','employee',action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','iso-admin','تفويض الكيان المعزول',null,now());
  const external=db.prepare("SELECT * FROM users WHERE id='external'").get();
  let order=w.execute(w.approve(w.prepare('employee',{payable_id:w.b1})),'ISO-1');
  const adjustment=transaction(db,()=>payables.recordAdjustment(db,users.employee,{payable_id:w.a1,kind:'credit',amount:'1.00',reference:'CN-ISO',reason:'إشعار دائن مصطنع لاختبار العزل',evidence:'مرجع مصطنع لاختبار عزل الكيانات'})).id;
  const seen=payables.listPayables(db,external);
  assert.deepEqual([seen.payables.length,seen.orders.length,seen.payable_adjustments.length],[0,0,0]);
  assert.equal(caught(()=>payables.getOrder(db,external,order.id)).code,'not_found');
  assert.equal(caught(()=>transaction(db,()=>payables.paymentAction(db,external,order.id,'record_return',{version:order.version,...returnInput()}))).code,'not_found');
  assert.equal(caught(()=>transaction(db,()=>payables.preparePayment(db,external,{payable_id:w.a1}))).code,'not_found');
  assert.equal(caught(()=>transaction(db,()=>payables.recordAdjustment(db,external,{payable_id:w.a1,kind:'credit',amount:'1.00',reference:'CN-X',reason:'محاولة من كيان آخر للاختبار',evidence:'مرجع مصطنع من كيان آخر'}))).code,'not_found');
  assert.equal(caught(()=>transaction(db,()=>payables.decideAdjustment(db,external,adjustment,'approve',{note:'اعتماد من كيان آخر'}))).code,'not_found');
  assert.equal(payables.paymentLedgerSources(db,'isolated').length,0);
  // وفي SQL: سطر من كيان آخر على أمر وكيان هذا الكيان يُرفض.
  const pending=w.prepare('employee',{payable_id:w.a1,amount:'1.00'});
  assert.throws(()=>db.prepare('INSERT INTO payment_order_lines(id,tenant_id,order_id,payable_id,line_no,amount_minor,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'isolated',pending.id,w.a2,2,1,now()),/same tenant/);
  assert.ok(verifyAudit(db));
});

/* ───── 12) المسارات بلا منفذ شبكة ───── */
test('HTTP without a port: partial and batch orders, release, execution, return and adjustments go through the real handler; a replayed create returns the same record and a replayed step is refused',async t=>{
  const w=world(t),{db}=w;
  const app=createApp(db),sessions={};
  for(const username of ['employee','manager','releaser','treasurer','controller']){
    const r=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    assert.equal(r.status,200,r.text);
    sessions[username]={cookie:r.headers['Set-Cookie'].split(';')[0],csrf:r.json().csrf};
  }
  const call=async(who,path,body,key)=>{const s=sessions[who];
    const r=await dispatch(app,{method:body===undefined?'GET':'POST',path:'/api'+path,headers:{cookie:s.cookie,'x-csrf-token':s.csrf,...(key?{'idempotency-key':key}:{})},body});
    return {status:r.status,body:r.text?JSON.parse(r.text):null};};
  const key=randomUUID();
  const created=await call('employee','/payables/orders',{payable_id:w.b1,amount:'50.00'},key);
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(created.body.amount_minor,5000);
  const replay=await call('employee','/payables/orders',{payable_id:w.b1,amount:'50.00'},key);
  assert.deepEqual([replay.status,replay.body.id],[201,created.body.id],'the same key returns the same order');
  assert.equal((await call('employee','/payables/orders',{payable_id:w.b1,amount:'60.00'},key)).status,409,'the same key with a different body is refused');
  assert.equal((await call('employee','/payables/orders',{payable_id:w.b1,amount:'50.00'})).status,400,'a create without a key is refused');
  w.changeBank();
  const held=await call('employee','/payables/orders',{lines:[{payable_id:w.a1,amount:'20.00'}]},randomUUID());
  assert.deepEqual([held.status,held.body.error.code],[409,'bank_change_unadopted'],'the changed account holds the batch path too');
  assert.equal(held.body.error.details.refusal.missing.length,2);
  w.adopt(DAYS,{days:0});w.adopt(CAP,{amount:'1000.00'});
  const first=await call('employee','/payables/orders',{lines:[{payable_id:w.a1,amount:'20.00'},{payable_id:w.a2,amount:'30.00'}]},randomUUID());
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal(first.body.first_payment.required,true);
  let step=await call('manager',`/payables/orders/${first.body.id}/approve_order`,{version:first.body.version,note:'طابقت الأمر الدفعي'});
  assert.equal(step.status,201,JSON.stringify(step.body));
  assert.equal((await call('manager',`/payables/orders/${first.body.id}/approve_order`,{version:first.body.version,note:'إعادة الطلب نفسه'})).status,409,'a replayed step is refused');
  const refused=await call('controller',`/payables/orders/${first.body.id}/release_first_payment`,{version:step.body.version,note:'إطلاق من المتحقق من الحساب'});
  assert.equal(refused.status,409);assert.equal(refused.body.error.code,'bank_change_separation');
  assert.ok(refused.body.error.details.refusal,'the refusal travels in its structured form');
  step=await call('releaser',`/payables/orders/${first.body.id}/release_first_payment`,{version:step.body.version,note:'اتصلنا بجهة الاتصال الموثقة وأكدت الحساب'});
  assert.equal(step.status,201,JSON.stringify(step.body));
  step=await call('treasurer',`/payables/orders/${first.body.id}/record_execution`,{version:step.body.version,executed_on:riyadh(),bank_reference:'HTTP-1',evidence:'إشعار تحويل بنكي مصطنع محفوظ'});
  assert.equal(step.status,201,JSON.stringify(step.body));
  assert.equal(step.body.execution_mode,'recorded_manually');
  step=await call('treasurer',`/payables/orders/${first.body.id}/record_return`,{version:step.body.version,...returnInput({bank_reference:'HTTP-RET',credited:'50.00'})});
  assert.equal(step.status,201,JSON.stringify(step.body));
  assert.equal(step.body.returned,true);
  const adjustmentKey=randomUUID(),adjustmentInput={payable_id:w.b1,kind:'debit',amount:'5.00',reference:'DN-HTTP',reason:'فرق شحن متفق عليه مع المورد',evidence:'إشعار مدين مصطنع محفوظ'};
  const adjustment=await call('employee','/payables/adjustments',adjustmentInput,adjustmentKey);
  assert.equal(adjustment.status,201,JSON.stringify(adjustment.body));
  assert.equal((await call('employee','/payables/adjustments',adjustmentInput,adjustmentKey)).body.id,adjustment.body.id);
  const approved=await call('manager',`/payables/adjustments/${adjustment.body.id}/approve`,{note:'طابقنا الإشعار مع العقد'});
  assert.equal(approved.status,201,JSON.stringify(approved.body));
  assert.equal(approved.body.status,'approved');
  assert.equal((await call('manager',`/payables/adjustments/${adjustment.body.id}/approve`,{note:'اعتماد مكرر'})).status,404);
  const board=await call('treasurer','/payables');
  assert.equal(board.status,200);assert.equal(board.body.execution.mode,'recorded_manually');
  assert.equal((await call('treasurer','/payables/orders/'+first.body.id+'/pay_now',{version:1})).status,404,'no route pretends to pay');
  assert.ok(verifyAudit(db));
});

/* ───── 13) سباق حقيقي بين عمليات على ملف واحد ───── */
function race(path,jobs){
  const startAt=Date.now()+2500;
  return Promise.all(jobs.map((job,index)=>new Promise(done=>{
    const child=spawn(process.execPath,[WORKER,path,String(startAt),JSON.stringify({...job,index})],{cwd:ROOT});
    let out='',err='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{err+=c;});
    child.on('close',()=>{try{done(JSON.parse(out.trim().split('\n').pop()));}catch{done({index,ok:false,error:'no output: '+err.slice(0,300)});}});
  })));
}
test('race: processes writing the same database file at the same instant never release money twice — one order for a full balance, one execution, one return, one re-payment, one first-payment release',{timeout:240000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-payment-race-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'race.sqlite');
  let ids;
  {
    const memory=openDb(':memory:');
    const built=buildWorld(memory);
    const u=built.users,tx=run=>transaction(memory,run);
    for(const [key,value] of [[DAYS,{days:0}],[CAP,{amount:'1000.00'}]]){
      tx(()=>adoptionAction(memory,u.hr,key,'record',{value,basis:'قرار مصطنع لاختبار السباق',effective_from:riyadh()}));
      const row=memory.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(key);
      tx(()=>adoptionAction(memory,u.controller,key,'approve',{adoption_id:row.id,note:'اعتماد مصطنع لاختبار السباق'}));
    }
    const vAct=(who,action,values)=>tx(()=>vendors.vendorAction(memory,u[who],built.A,action,{version:vendors.getVendor(memory,u[who],built.A).version,...values}));
    vAct('outsider','propose_bank',{bank_name:'بنك مصطنع آخر',account_holder:'منشأة مصطنعة',iban:IBAN.changed,reason:'المورد أبلغ بتغيير حسابه البنكي'});
    const pending=memory.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id=? AND status='pending'").get(built.A).id;
    vAct('controller','verify_bank',{bank_id:pending,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع للحساب الجديد',effective_from:riyadh()});
    ids=built;
    memory.exec(`VACUUM INTO '${path.replaceAll("'","''")}'`);
    memory.close();
  }
  // اتصال حارس يبقى مفتوحًا طوال السباقات، كما يبقى اتصال الخادم مفتوحًا في التشغيل: بلاه يفتح العاملون الستة ملف WAL
  // مغلقًا في اللحظة نفسها، فيتسابقون على استرداده قبل أن يُضبط busy_timeout في openDb — وذاك سباق فتح لا سباق مال.
  const keeper=openDb(path);t.after(()=>keeper.close());
  const withDb=run=>run(keeper);
  const users=withDb(db=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])));
  const live=(db,payableId)=>db.prepare("SELECT COALESCE(SUM(l.amount_minor),0) AS n FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE l.payable_id=? AND (o.status IN ('pending','approved') OR (o.status='executed' AND NOT EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id)))").get(payableId).n;
  // (1) ست عمليات تعدّ الرصيد كاملًا للمستحق نفسه في اللحظة نفسها: أمر واحد.
  const full=await race(path,Array.from({length:6},()=>({action:'prepare',user:'employee',payable_id:ids.b1})));
  assert.equal(full.filter(r=>r.ok).length,1,JSON.stringify(full));
  assert.deepEqual([...new Set(full.filter(r=>!r.ok).map(r=>r.error))],['order_exists']);
  const orderId=full.find(r=>r.ok).id;
  withDb(db=>{assert.equal(live(db,ids.b1),55000);transaction(db,()=>payables.paymentAction(db,users.manager,orderId,'approve_order',{version:payables.getOrder(db,users.manager,orderId).version,note:'اعتماد قبل سباق التوثيق'}));});
  // (2) ثلاث عمليات توثّق تنفيذ الأمر نفسه بالنسخة نفسها: تنفيذ واحد.
  const version=withDb(db=>payables.getOrder(db,users.treasurer,orderId).version);
  const executed=await race(path,['RACE-A','RACE-B','RACE-C'].map(reference=>({action:'execute',user:'treasurer',order_id:orderId,version,reference})));
  assert.equal(executed.filter(r=>r.ok).length,1,JSON.stringify(executed));
  // (3) ثلاث عمليات تسجّل مرتجعه: مرتجع واحد.
  const executedVersion=withDb(db=>payables.getOrder(db,users.treasurer,orderId).version);
  const returned=await race(path,['RET-A','RET-B','RET-C'].map(reference=>({action:'return',user:'treasurer',order_id:orderId,version:executedVersion,reference})));
  assert.equal(returned.filter(r=>r.ok).length,1,JSON.stringify(returned));
  withDb(db=>assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_returns WHERE order_id=?').get(orderId).n,1));
  // (4) أربع عمليات تعيد دفع الرصيد المفتوح بـ200 ريال لكل واحدة: اثنتان فقط تتسعان (400 من 550).
  const again=await race(path,Array.from({length:4},()=>({action:'prepare',user:'employee',payable_id:ids.b1,amount:'200.00'})));
  assert.equal(again.filter(r=>r.ok).length,2,JSON.stringify(again));
  assert.deepEqual([...new Set(again.filter(r=>!r.ok).map(r=>r.error))],['exceeds_balance']);
  withDb(db=>assert.equal(live(db,ids.b1),40000,'never more than the payable in flight'));
  // (5) أول دفعة لحساب متغيّر: ثلاث عمليات تطلقها، ثم ثلاث توثّقها — إطلاق واحد وتنفيذ واحد.
  const firstId=withDb(db=>{
    const id=transaction(db,()=>payables.preparePayment(db,users.employee,{payable_id:ids.a1,amount:'100.00'})).id;
    transaction(db,()=>payables.paymentAction(db,users.manager,id,'approve_order',{version:payables.getOrder(db,users.manager,id).version,note:'اعتماد أول دفعة قبل السباق'}));
    return id;});
  const firstVersion=withDb(db=>payables.getOrder(db,users.releaser,firstId).version);
  const released=await race(path,Array.from({length:3},()=>({action:'release',user:'releaser',order_id:firstId,version:firstVersion})));
  assert.equal(released.filter(r=>r.ok).length,1,JSON.stringify(released));
  const firstExecuted=await race(path,['FIRST-A','FIRST-B','FIRST-C'].map(reference=>({action:'execute',user:'treasurer',order_id:firstId,version:firstVersion,reference})));
  assert.equal(firstExecuted.filter(r=>r.ok).length,1,JSON.stringify(firstExecuted));
  withDb(db=>{
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_order_releases WHERE order_id=?').get(firstId).n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payment_orders WHERE bank_reference LIKE 'RACE-%' OR bank_reference LIKE 'FIRST-%'").get().n,2);
    assert.equal(verifyAudit(db),true,'the audit chain did not fork under concurrent writers');
  });
});

/* ───── 14) الترقية فوق قاعدة كُتبت فيها أوامر قبل 166 ───── */
// قاعدة تبلغ 165 بالترحيلات نفسها، وفيها ما تركه الكود السابق: مورد بحسابين «verified» (لم يُكتب superseded يومًا)،
// وأمرا دفع بكامل المستحق — منفّذ ومعتمد. الترحيل 166 يُطبَّق فوقها كما يطبّقه openDb، ولا يُمسّ صفّ قائم.
function applyMigration(raw,version,sql){
  raw.exec('BEGIN');
  try{raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');}
  catch(error){raw.exec('ROLLBACK');throw error;}
}
test('upgrade: a database that already holds orders before 166 gets one line per order and the same balances, loses the one-order index, and its legacy vendor with two verified accounts is settled at the next verification',t=>{
  const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  const migrations=readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort();
  for(const file of migrations){const version=Number(file.slice(0,3));if(version<166)applyMigration(raw,version,readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8'));}
  assert.ok(raw.prepare("SELECT 1 FROM sqlite_master WHERE name='payment_orders_live'").get(),'165 still carries the one-order index');
  seed(raw,PASSWORD);
  const STAMP='2026-09-01T08:00:00.000Z';
  raw.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'treasurer','36t','ops','treasurer','أمين خزينة مصطنع',password_hash,'employee','manager' FROM users WHERE id='manager'").run();
  const users=Object.fromEntries(raw.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of Object.entries({employee:['read','prepare'],manager:['read','approve'],treasurer:['read','post']}))for(const action of actions)
    raw.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مدفوعات مصطنع',null,now());
  // الموردان كما تركهما الكود السابق: ملفان معتمدان، وللأول حسابان متحقق منهما معًا.
  const vendor=(vendorId,code)=>raw.prepare("INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,entity_type,country,categories,data_source,status,registered_by,created_at,updated_at) VALUES(?,'36t',?,?,'منشأة توريد مصطنعة قبل الترقية','company','SA','[\"print_gifts\"]','إدخال مصطنع قبل الترحيل 166','approved','employee',?,?)").run(vendorId,code,code,STAMP,STAMP);
  vendor('legacy-a','SUPPLIER-A');vendor('legacy-b','SUPPLIER-B');vendor('legacy-c','SUPPLIER-C');
  const bank=(bankId,vendorId,value,effective)=>raw.prepare("INSERT INTO vendor_bank_accounts(id,vendor_id,bank_name,account_holder,iban,iban_digest,reason,status,collected_by,collected_at,verification_method,verification_evidence,verified_by,verified_at,effective_from) VALUES(?,?,'بنك مصطنع','منشأة مصطنعة',?,?,'حساب مصطنع قبل الترحيل','verified','outsider',?,'bank_letter','خطاب بنكي مصطنع','hr',?,?)").run(bankId,vendorId,value,hash(`36t:iban:${value}`),`${effective}T08:00:00.000Z`,`${effective}T09:00:00.000Z`,effective);
  bank('legacy-old','legacy-a',IBAN.a,'2026-01-01');bank('legacy-new','legacy-a',IBAN.again,'2026-06-01');
  // المشتريات بالكود نفسه: لا يلمس جداول 166.
  const project=transaction(raw,()=>createProject(raw,users.manager,{name:'مشروع ترقية مصطنع',brief:'أوامر قبل الترحيل 166',member_ids:['employee']}));
  fundProject(raw,project.id,'SYNTHETIC-CC-1');
  const pAct=(who,p,action,values={})=>transaction(raw,()=>procurementAction(raw,users[who],p.id,action,{version:p.version,...values}));
  let p=transaction(raw,()=>createPurchase(raw,users.employee,{project_id:project.id,title:'طباعة مصطنعة قبل الترقية',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:5,unit:'نسخة',budget_amount:'600.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
  p=pAct('employee',p,'submit');
  for(const [key,price] of [['supplier-a','115.00'],['supplier-b','116.00'],['supplier-c','117.00']])p=pAct('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  p=pAct('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
  p=pAct('manager',p,'approve_order',{terms:'تسليم دفعة واحدة بعد فحص الجودة',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
  p=pAct('manager',p,'commence',{start_on:riyadh(),valid_until:'2099-12-31',site_or_channel:'مطبعة المورد المصطنعة',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
  p=pAct('employee',p,'receive',{quantity:5,reference:'receipt-legacy',evidence:'استلام خمس نسخ وفحصها محليًا'});
  for(const [reference,quantity,amount] of [['inv-l1',2,'230.00'],['inv-l2',3,'345.00']])p=pAct('employee',p,'record_invoice',{supplier_reference:reference,quantity,amount,evidence:'فاتورة مورد مصطنعة '+reference});
  for(const invoice of p.invoices)p=pAct('manager',p,'match',{invoice_id:invoice.id,note:'طابقنا الأمر والاستلام والفاتورة'});
  const payableFor=reference=>raw.prepare('SELECT p.id FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id WHERE i.supplier_reference=?').get(reference.toUpperCase()).id;
  const [l1,l2]=[payableFor('inv-l1'),payableFor('inv-l2')];
  // أمرا دفع بكامل المستحق كما كان يكتبهما الكود السابق: منفّذ، ومعتمد لم يُنفَّذ.
  raw.prepare("INSERT INTO payment_orders(id,tenant_id,payable_id,vendor_id,bank_account_id,amount_minor,currency,status,prepared_by,approved_by,approved_at,decision_note,executed_on,bank_reference,execution_evidence,execution_recorded_by,version,created_at,updated_at) VALUES('legacy-paid','36t',?,'legacy-a','legacy-new',23000,'SAR','executed','employee','manager',?,'طابقت المستحق',?,'LEGACY-1','إشعار تحويل مصطنع قبل الترحيل','treasurer',3,?,?)").run(l1,STAMP,riyadh(),STAMP,STAMP);
  raw.prepare("INSERT INTO payment_orders(id,tenant_id,payable_id,vendor_id,bank_account_id,amount_minor,currency,status,prepared_by,approved_by,approved_at,decision_note,version,created_at,updated_at) VALUES('legacy-approved','36t',?,'legacy-a','legacy-new',34500,'SAR','approved','employee','manager',?,'طابقت المستحق',2,?,?)").run(l2,STAMP,STAMP,STAMP);
  applyMigration(raw,166,readFileSync(new URL('../app/migrations/166-payment-release.sql',import.meta.url),'utf8'));
  assert.deepEqual(raw.prepare('SELECT order_id,payable_id,line_no,amount_minor FROM payment_order_lines ORDER BY order_id').all().map(r=>({...r})),
    [{order_id:'legacy-approved',payable_id:l2,line_no:1,amount_minor:34500},{order_id:'legacy-paid',payable_id:l1,line_no:1,amount_minor:23000}],'one line per order, at its amount');
  assert.equal(raw.prepare("SELECT 1 FROM sqlite_master WHERE name='payment_orders_live'").get(),undefined,'the one-order index is gone; the balance guards it now');
  const b1=payables.payableBalance(raw,l1),b2=payables.payableBalance(raw,l2);
  assert.deepEqual([b1.paid_minor,b1.outstanding_minor,b1.status],[23000,0,'paid']);
  assert.deepEqual([b2.approved_minor,b2.available_minor,b2.status],[34500,0,'payment_approved']);
  // الأمر المعتمد القديم يُكمل مساره بالكود الجديد.
  const legacy=payables.getOrder(raw,users.treasurer,'legacy-approved');
  assert.ok(legacy.actions.includes('record_execution'));
  transaction(raw,()=>payables.paymentAction(raw,users.treasurer,'legacy-approved','record_execution',{version:legacy.version,executed_on:riyadh(),bank_reference:'LEGACY-2',evidence:'إشعار تحويل مصطنع بعد الترحيل'}));
  assert.equal(payables.payableBalance(raw,l2).status,'paid');
  // والمورد بحسابين متحقق منهما: الساري أحدثهما، وأول تحقق جديد يُحِلّ الاثنين ويسجّل تغييرًا عن الأحدث.
  assert.equal(vendors.currentBankAccount(raw,'36t','legacy-a').bank.id,'legacy-new');
  transaction(raw,()=>grantAccess(raw,users.admin,{user_id:'employee',capability:'vendors.manage',note:'تصريح اختبار مصطنع'}));
  transaction(raw,()=>grantAccess(raw,users.admin,{user_id:'hr',capability:'vendors.bank',note:'تصريح اختبار مصطنع'}));
  const vAct=(who,action,values)=>transaction(raw,()=>vendors.vendorAction(raw,users[who],'legacy-a',action,{version:vendors.getVendor(raw,users[who],'legacy-a').version,...values}));
  vAct('employee','propose_bank',{bank_name:'بنك مصطنع آخر',account_holder:'منشأة مصطنعة',iban:IBAN.changed,reason:'المورد أبلغ بتغيير حسابه البنكي'});
  const pending=raw.prepare("SELECT id FROM vendor_bank_accounts WHERE vendor_id='legacy-a' AND status='pending'").get().id;
  vAct('hr','verify_bank',{bank_id:pending,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع للحساب الجديد',effective_from:riyadh()});
  assert.deepEqual(raw.prepare("SELECT id,status FROM vendor_bank_accounts WHERE vendor_id='legacy-a' ORDER BY collected_at,rowid").all().map(r=>r.status),['superseded','superseded','verified']);
  assert.equal(raw.prepare('SELECT replaces_id FROM vendor_bank_changes WHERE bank_account_id=?').get(pending).replaces_id,'legacy-new');
  assert.equal(vendors.bankChangeState(raw,'36t',pending).state,'unadopted');
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(verifyAudit(raw));
});
