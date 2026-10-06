import { fundProject } from './budget-fixture.mjs';
import { approveVendor } from './vendor-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { listProcurement, createPurchase, procurementAction } from '../app/procurement.mjs';
import { exceptionAction } from '../app/procurement-exceptions.mjs';
import { procurementUI } from '../app/static/procurement-ui.mjs';

const errorCode = expected => error => error.code === expected;
function fixture(t) {
  const db = openDb(':memory:');
  seed(db,'synthetic-procurement-test-only');
  t.after(()=>db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  // العارضون الثلاثة ملفات موردين حقيقية: الكيان الذي بلا ملف لا يُطلب منه عرض ولا يُرسى عليه (app/vendors.mjs).
  for (const key of ['SUPPLIER-A','SUPPLIER-B','SUPPLIER-C']) approveVendor(db,key);
  const project = transaction(db,()=>createProject(db,users.manager,{name:'مشروع مشتريات مصطنع',brief:'اختبار الاحتياج والتوريد المحلي',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const input = {project_id:project.id,title:'احتياج طباعة مصطنع',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2026-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار داخلي قدره مئة ريال',currency:'SAR'};
  const make = (overrides={},who='employee') => transaction(db,()=>createPurchase(db,users[who],{...input,...overrides}));
  const act = (who,p,action,values={}) => transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  const read = (p,who='employee') => listProcurement(db,users[who]).find(x=>x.id===p.id);
  const quote = (p,key='supplier-a',price='10.01') => act('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق مواصفات الطباعة المسجلة',financial_terms:'استحقاق بعد استلام الكمية ومطابقة المرجع',delivery_date:'2026-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  const sourced = () => quote(quote(quote(act('employee',make(),'submit')),'supplier-b','11.00'),'supplier-c','12.00');
  // أمر المباشرة (الترحيلان 116 و162): أمر الشراء ليس إذن البدء، ولا استلام إلا على إذن يسري يوم التسجيل.
  // يبدأ اليوم لأن الاستلام في هذه الاختبارات يُسجَّل اليوم، والإذن الذي لم يبدأ سريانه لا يفتح استلامًا.
  const today = () => new Date(Date.now()+3*3600000).toISOString().slice(0,10);
  const commence = p => act('manager',p,'commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'مطبعة المورد المصطنعة',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر الداخلي',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
  const ordered = () => {
    let p = sourced();
    p = act('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'اخترنا العرض الموافق للمواصفات والأقل تكلفة وأكدنا المخصص'});
    p = act('manager',p,'approve_order',{terms:'تسليم داخلي على دفعتين بعد التحقق من الجودة',delivery_date:'2026-10-20',note:'اعتماد نسخة أمر محلي دون إرسال إلى المورد'});
    return commence(p);
  };
  return {db,users,project,input,make,act,read,quote,sourced,ordered,commence};
}

test('PRC-01/03/04/05/06 and FIN-05/07/08: a purchase reaches two matched payables without payment or official issuance',t=>{
  const {db,act,ordered} = fixture(t);
  let p = ordered();
  assert.equal(p.order.total_minor,5005);
  assert.equal(p.order.execution_status,'internal_only');
  assert.equal(p.quotes.length,3);
  assert.equal(p.award.approved_by,'manager');
  p = act('employee',p,'receive',{quantity:2,reference:'receipt-1',evidence:'استلام نسختين وفحص الجودة محليًا'});
  assert.equal(p.status,'part_received');
  p = act('employee',p,'record_invoice',{supplier_reference:'invoice-1',quantity:2,amount:'20.02',evidence:'مرجع مورد مصطنع بقيمة عشرين ريالًا وهللتين'});
  p = act('manager',p,'match',{invoice_id:p.invoices[0].id,note:'طابقنا نسختين مع الأمر والاستلام والمرجع'});
  assert.equal(p.payable_minor,2002);
  assert.equal(p.payables[0].payment_status,'not_paid');
  assert.equal(p.payables[0].posting_status,'not_posted');
  p = act('employee',p,'receive',{quantity:3,reference:'receipt-2',evidence:'استلام باقي النسخ وفحصها محليًا'});
  assert.equal(p.status,'received');
  p = act('employee',p,'record_invoice',{supplier_reference:'invoice-2',quantity:3,amount:'30.03',evidence:'مرجع مورد مصطنع لباقي النسخ'});
  p = act('manager',p,'match',{invoice_id:p.invoices.find(i=>i.supplier_reference==='INVOICE-2').id,note:'طابقنا باقي الكمية والمبلغ دون فرق'});
  assert.equal(p.payables.length,2);
  assert.equal(p.payable_minor,5005);
  assert.equal(p.payment_status,'not_paid');
  assert.equal(p.invoices[0].document_kind,'supplier_reference');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
  assert.equal(p.history.length,p.version);
  assert.equal(verifyAudit(db),true);
});

test('PRC-01/03: allocation, comparison and evidence are required before an award',t=>{
  const {db,make,act,quote} = fixture(t);
  for (const values of [{budget_amount:'0'},{budget_evidence:''},{cost_center:''},{specification:''},{due_date:'2026-02-30'}]) assert.throws(()=>make(values));
  let p = act('employee',make({budget_amount:'40.00'}),'submit');
  p = quote(p);
  assert.throws(()=>act('manager',p,'award',{quote_id:p.quotes[0].id,note:'مراجعة المخصص والعرض'}),errorCode('comparison_required'));
  assert.throws(()=>quote(p,'  SUPPLIER-A  '),errorCode('duplicate_supplier'));
  p = quote(p,'supplier-b');
  p = quote(p,'supplier-c');
  assert.throws(()=>act('manager',p,'award',{quote_id:p.quotes[0].id,note:''}),errorCode('invalid_text'));
  assert.throws(()=>act('manager',p,'award',{quote_id:'different-purchase-quote',note:'مراجعة المخصص والعرض'}),errorCode('invalid_quote'));
  assert.throws(()=>act('manager',p,'award',{quote_id:p.quotes[0].id,note:'مراجعة المخصص والعرض'}),errorCode('budget_exceeded'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_awards').get().n,0);
});

test('PRC-04/06: requesters cannot approve, skip an award, or match their own invoice',t=>{
  const {db,users,make,act,sourced,ordered} = fixture(t);
  let p = make();
  assert.throws(()=>act('manager',p,'approve_order',{terms:'شروط اختبار',delivery_date:'2026-10-20',note:'محاولة قفز الترسية'}),errorCode('transition_denied'));
  p = sourced();
  assert.throws(()=>act('employee',p,'award',{quote_id:p.quotes[0].id,note:'محاولة اعتماد ذاتي'}),errorCode('transition_denied'));
  db.prepare("UPDATE users SET role='manager' WHERE id='employee'").run();
  assert.throws(()=>act('employee',p,'award',{quote_id:p.quotes[0].id,note:'محاولة اعتماد ذاتي بعد تغيير الدور'}),errorCode('transition_denied'));
  db.prepare("UPDATE users SET role='employee' WHERE id='employee'").run();
  p = ordered();
  p = act('employee',p,'receive',{quantity:1,reference:'r-1',evidence:'استلام مصطنع لوحدة واحدة'});
  p = act('manager',p,'record_invoice',{supplier_reference:'manager-invoice',quantity:1,amount:'10.01',evidence:'مرجع سجله المعتمد لاختبار فصل الإعداد'});
  assert.throws(()=>act('manager',p,'match',{invoice_id:p.invoices[0].id,note:'محاولة اعتماد المرجع الذي سجلته'}),errorCode('self_approval'));
  assert.throws(()=>act('employee',p,'match',{invoice_id:p.invoices[0].id,note:'محاولة اعتماد صاحب الاحتياج'}),errorCode('transition_denied'));
  assert.equal(listProcurement(db,{...users.admin,role:'manager'}).length,0);
});

test('PRC-01 and FIN-02: project membership, current team and a separate PM cost grant constrain every read and action',t=>{
  const {db,users,project,make,act} = fixture(t);
  const p = make();
  for (const who of ['outsider','admin','external','hr','it']) {
    assert.deepEqual(listProcurement(db,users[who]),[]);
    assert.throws(()=>act(who,p,'submit'),errorCode('not_found'));
    assert.throws(()=>make({},who),errorCode('project_not_found'));
  }
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id,'outsider');
  assert.deepEqual(listProcurement(db,users.outsider),[]);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'pm','36t','creative','pm','مدير مشروع مصطنع',password_hash,'pm' FROM users WHERE id='employee'");
  users.pm = db.prepare("SELECT * FROM users WHERE id='pm'").get();
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id,'pm');
  assert.deepEqual(listProcurement(db,users.pm),[]);
  db.prepare('INSERT INTO procurement_project_grants VALUES(?,?,?,?,?)').run(project.id,'pm','manager','تصريح تكلفة مستقل لمشروع الاختبار',new Date().toISOString());
  assert.equal(listProcurement(db,users.pm)[0].id,p.id);
  db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id,'pm');
  assert.deepEqual(listProcurement(db,users.pm),[]);
  db.exec("UPDATE users SET manager_id=NULL WHERE id='employee'");
  assert.deepEqual(listProcurement(db,users.manager),[]);
  assert.throws(()=>act('manager',p,'reject',{note:'مدير بعد سحب علاقة الفريق'}),errorCode('not_found'));
  db.exec("UPDATE users SET manager_id='manager',department_id='it' WHERE id='employee'");
  assert.deepEqual(listProcurement(db,users.manager),[]);
  db.exec("UPDATE users SET department_id='creative',active=0 WHERE id='employee'");
  assert.throws(()=>listProcurement(db,users.employee),errorCode('forbidden'));
});

test('PRC-04/05 and FIN-05: stale actions and repeated receipt or supplier invoice references create no second record',t=>{
  const {db,act,ordered} = fixture(t);
  const before = ordered();
  let p = act('employee',before,'receive',{quantity:2,reference:'receipt-1',evidence:'دليل استلام وحدتين'});
  assert.throws(()=>act('employee',before,'receive',{quantity:2,reference:'receipt-1',evidence:'دليل استلام وحدتين'}),errorCode('stale_version'));
  assert.throws(()=>act('employee',p,'receive',{quantity:2,reference:' RECEIPT-1 ',evidence:'دليل استلام مكرر'}),errorCode('duplicate_receipt'));
  p = act('employee',p,'record_invoice',{supplier_reference:'invoice-1',quantity:2,amount:'20.02',evidence:'دليل فاتورة وحدتين'});
  assert.throws(()=>act('employee',p,'record_invoice',{supplier_reference:' ＩＮＶＯＩＣＥ-1 ',quantity:1,amount:'10.01',evidence:'دليل فاتورة مكررة'}),errorCode('duplicate_invoice'));
  let other = ordered();
  assert.throws(()=>act('employee',other,'record_invoice',{supplier_reference:'invoice-1',quantity:1,amount:'10.01',evidence:'نفس مرجع المورد في طلب آخر'}),errorCode('duplicate_invoice'));
  p = act('manager',p,'match',{invoice_id:p.invoices[0].id,note:'مراجعة المرجع الأول والاستلام'});
  assert.throws(()=>act('manager',p,'match',{invoice_id:p.invoices[0].id,note:'محاولة تكرار المطابقة'}),errorCode('already_matched'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_receipts').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_invoices').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_payables').get().n,1);
});

test('PRC-05/06: excess quantities, mismatched amounts and unmatched receipts cannot become payables',t=>{
  const {db,users,act,ordered,read} = fixture(t);
  let p = ordered();
  assert.throws(()=>act('employee',p,'receive',{quantity:6,reference:'too-many',evidence:'استلام زائد مصطنع'}),errorCode('quantity_exceeded'));
  // فرق السعر لا يُرفض عند الإدخال (الترحيل 169): فاتورة المورد الحقيقية تُسجَّل موقوفة بفرقها لكل بند،
  // ولا تصير مستحقًا إلا بقرار معتمد مستقل — والرفض قرارٌ منها يُميت الفاتورة ويحرر كمياتها.
  p = act('employee',p,'receive',{quantity:2,reference:'only-2',evidence:'استلام جزئي بوحدتين فقط'});
  p = act('employee',p,'record_invoice',{supplier_reference:'bad-price',quantity:2,amount:'20.03',evidence:'زيادة هللة عن سعر الأمر'});
  p = act('employee',p,'record_invoice',{supplier_reference:'low-price',quantity:2,amount:'20.01',evidence:'نقص هللة عن سعر الأمر'});
  const byReference = reference => p.invoices.find(i=>i.supplier_reference===reference);
  assert.deepEqual(['BAD-PRICE','LOW-PRICE'].map(r=>[byReference(r).state,byReference(r).variance.price_variance_minor]),[['held',1],['held',-1]]);
  assert.throws(()=>act('manager',p,'match',{invoice_id:byReference('BAD-PRICE').id,note:'محاولة مطابقة فاتورة بفرق سعر بلا قرار'}),errorCode('invoice_held'));
  for (const reference of ['BAD-PRICE','LOW-PRICE']) p = transaction(db,()=>exceptionAction(db,users.manager,p.id,'decide_invoice',{version:p.version,invoice_id:byReference(reference).id,decision:'reject',note:'نرفض الفاتورة ونطلب من المورد فاتورة بسعر الأمر'}));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_payables').get().n,0);
  p = act('employee',p,'record_invoice',{supplier_reference:'all-5',quantity:5,amount:'50.05',evidence:'مرجع لجميع الوحدات قبل الاستلام الكامل'});
  assert.throws(()=>act('employee',p,'record_invoice',{supplier_reference:'extra',quantity:1,amount:'10.01',evidence:'فاتورة إضافية فوق إجمالي الأمر'}),errorCode('invoice_exceeds_order'));
  const version = p.version;
  assert.throws(()=>act('manager',p,'match',{invoice_id:byReference('ALL-5').id,note:'محاولة مطابقة خمس وحدات باستلام وحدتين'}),errorCode('three_way_mismatch'));
  assert.equal(read(p).version,version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_payables').get().n,0);
  p = act('employee',p,'receive',{quantity:3,reference:'remaining-3',evidence:'استلام الوحدات المتبقية'});
  p = act('manager',p,'match',{invoice_id:byReference('ALL-5').id,note:'استكمل الاستلام وتطابقت الوحدات الخمس'});
  assert.equal(p.payable_minor,5005);
});

test('PRC-04/08 and PLT-06: submitted values, order versions and evidence records resist changes and deletion',t=>{
  const {db,act,ordered,input,make,read} = fixture(t);
  let draft = make();
  const edit = {...input}; delete edit.project_id;
  draft = act('employee',draft,'edit',{...edit,title:'احتياج معدل قبل التقديم'});
  assert.equal(draft.history[0].snapshot.title,input.title);
  assert.equal(draft.title,'احتياج معدل قبل التقديم');
  const p = ordered();
  assert.throws(()=>act('employee',p,'edit',edit),errorCode('transition_denied'));
  assert.throws(()=>db.prepare('UPDATE procurement_purchases SET quantity=6,version=version+1 WHERE id=?').run(p.id),/immutable/);
  assert.throws(()=>db.prepare("UPDATE procurement_purchases SET status='draft',version=version+1 WHERE id=?").run(p.id),/cannot skip or reopen/);
  for (const table of ['procurement_quotes','procurement_awards','procurement_orders','procurement_versions']) {
    const field = table === 'procurement_versions' ? 'action' : table === 'procurement_quotes' ? 'evidence' : 'note';
    assert.throws(()=>db.exec(`UPDATE ${table} SET ${field}='changed'`),/immutable/);
    assert.throws(()=>db.exec(`DELETE FROM ${table}`),/immutable/);
  }
  assert.equal(read(p).quantity,5);
  assert.equal(read(p).order.total_minor,5005);
});

test('PRC-01/04: decimal strings, bounds, currency and unrecognized fields are checked on the server',t=>{
  const {db,users,input,make,act,quote} = fixture(t);
  for (const budget_amount of [10.01,'1.001','1e2','NaN','-1','00.10',' 1.00','10000000000.01']) assert.throws(()=>make({budget_amount}),errorCode('invalid_money'));
  for (const q of [0,-1,1.5,'2',1_000_001]) assert.throws(()=>make({quantity:q}),errorCode('invalid_quantity'));
  for (const currency of ['USD','sar','']) assert.throws(()=>make({currency}),errorCode('invalid_currency'));
  for (const field of ['tenant_id','requester_id','status','approved_by','budget_minor']) assert.throws(()=>transaction(db,()=>createPurchase(db,users.employee,{...input,[field]:'forged'})),errorCode('invalid_fields'));
  let p = make({budget_amount:'0.01'}); assert.equal(p.budget_minor,1);
  p = act('employee',make({quantity:1_000_000}),'submit');
  approveVendor(db,'BIG');
  assert.throws(()=>quote(p,'big','10000000000'),errorCode('invalid_money'));
  assert.throws(()=>act('employee',p,'pay',{note:'محاولة دفع خارجي'}),errorCode('invalid_action'));
});

test('PRC-01 and PLT-09: creation retries return the current authorized record and rollback includes its audit',t=>{
  const {db,users,input,project} = fixture(t);
  const makeOnce = (values=input) => transaction(db,()=>createOnce(db,users.employee,'purchase.create','synthetic-purchase-key-1',values,()=>createPurchase(db,users.employee,values),id=>{
    const found = listProcurement(db,users.employee).find(p=>p.id===id);
    if (!found) throw Object.assign(new Error('غير متاح'),{code:'not_found'});
    return found;
  }));
  const first = makeOnce();
  assert.equal(makeOnce().id,first.id);
  assert.throws(()=>makeOnce({...input,title:'عنوان مختلف'}),errorCode('idempotency_conflict'));
  const before = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  assert.throws(()=>transaction(db,()=>{createPurchase(db,users.employee,input);throw new Error('forced rollback');}),/forced rollback/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_purchases').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before);
  db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id,'employee');
  assert.throws(()=>makeOnce(),errorCode('not_found'));
  assert.equal(verifyAudit(db),true);
});

test('PRC-04 and PLT-06: public writes require a transaction and failed audit rolls back the submitted version',t=>{
  const {db,users,input,make,act,read} = fixture(t);
  assert.throws(()=>createPurchase(db,users.employee,input),errorCode('transaction_required'));
  const p = make();
  assert.throws(()=>procurementAction(db,users.employee,p.id,'submit',{version:p.version}),errorCode('transaction_required'));
  db.exec("CREATE TEMP TRIGGER fail_purchase_audit BEFORE INSERT ON audit_events WHEN NEW.entity_type='procurement' BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
  assert.throws(()=>act('employee',p,'submit'),/test audit failure/);
  assert.equal(read(p).status,'draft');
  assert.equal(read(p).version,1);
  assert.equal(read(p).history.length,1);
  assert.equal(verifyAudit(db),true);
});

test('PRC-04/06: database constraints prevent an unbalanced payable and preserve receipt and invoice evidence',t=>{
  const {db,act,ordered} = fixture(t);
  let p = ordered();
  p = act('employee',p,'receive',{quantity:1,reference:'r-1',evidence:'دليل استلام وحدة مصطنعة'});
  p = act('employee',p,'record_invoice',{supplier_reference:'invoice-1',quantity:1,amount:'10.01',evidence:'دليل مرجع فاتورة وحدة'});
  const invoiceId = p.invoices[0].id;
  assert.throws(()=>db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('bad-payable',p.id,invoiceId,1002,'SAR','manager','فرق هللة واحد',p.version,new Date().toISOString()),/three way match/);
  assert.throws(()=>db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('self-payable',p.id,invoiceId,1001,'SAR','employee','اعتماد ذاتي',p.version,new Date().toISOString()),/three way match/);
  p = act('manager',p,'match',{invoice_id:invoiceId,note:'مطابقة مستقلة لوحدة واحدة'});
  for (const table of ['procurement_receipts','procurement_invoices','procurement_payables']) {
    const field = table==='procurement_payables' ? 'note' : 'evidence';
    assert.throws(()=>db.exec(`UPDATE ${table} SET ${field}='changed'`),/immutable/);
    assert.throws(()=>db.exec(`DELETE FROM ${table}`),/immutable/);
  }
  assert.equal(p.payable_minor,1001);
});

test('PRC-04: cancellation and rejection are final and cannot generate an internal order',t=>{
  const {make,act,sourced} = fixture(t);
  const cancelled = act('employee',make(),'cancel',{note:'الاحتياج المصطنع لم يعد مطلوبًا'});
  assert.throws(()=>act('employee',cancelled,'submit'),errorCode('transition_denied'));
  const rejected = act('manager',sourced(),'reject',{note:'رفض الاحتياج بعد مراجعة النطاق'});
  assert.throws(()=>act('manager',rejected,'approve_order',{terms:'شروط اختبار',delivery_date:'2026-10-20',note:'محاولة اعتماد طلب مرفوض'}),errorCode('transition_denied'));
});

test('PRC-01/04 UI: forms use authorized IDs, escape supplier evidence, and keep the opened version',t=>{
  const {users,project,make,act,quote} = fixture(t);
  let p = make({title:'<img src=x onerror=alert(1)>',budget_evidence:'<script>example</script>'});
  const data = {purchases:[p],projects:[project],user:users.employee};
  const create = procurementUI.form('create','',data);
  assert.equal(create.idempotent,true);
  assert.equal(create.endpoint,'/procurement');
  assert.equal(create.fields[0].options[0].value,project.id);
  const edit = procurementUI.form('edit',p.id,data),openedVersion = p.version;
  p.version += 1;
  assert.equal(edit.toPayload({quantity:'5'}).version,openedVersion);
  assert.equal(edit.toPayload({quantity:'5'}).quantity,5);
  assert.equal(edit.fields.some(f=>f.name==='version'),false);
  p.version = openedVersion;
  p = act('employee',p,'submit');
  p = act('employee',p,'add_quote',{supplier_key:'supplier-a',supplier_name:'مورد اختبار <svg onload=alert(1)>',unit_price:'10.01',technical_assessment:'العرض يطابق مواصفات الطباعة المسجلة',financial_terms:'استحقاق بعد استلام الكمية ومطابقة المرجع',delivery_date:'2026-10-20',evidence:'عرض مصطنع محفوظ برقم <svg onload=alert(1)>'});
  data.purchases = [p];
  const e = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const html = procurementUI.render(data,{e,button:(action,id,label)=>`<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`,money:minor=>String(minor)});
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;svg'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<svg onload'));
  assert.ok(!/\sstyle\s*=/i.test(html));
  assert.ok(!html.includes('<table class="detail-data"'));
  assert.throws(()=>procurementUI.form('award',p.id,data),/غير متاح/);
  const addQuote = procurementUI.form('add_quote',p.id,data);
  assert.equal(addQuote.fields.some(f=>f.name==='supplier_key'),true);
  assert.equal(addQuote.fields.some(f=>f.type==='textarea'),true);
});

// العطب المثبت (١): supplier_key نصّ حرّ يُرفع إلى أحرف كبيرة بلا فحص وجود، وبوابة الترسية كانت تمرّر
// الكيان غير المسجَّل بـallowed:true. فيصير أمر شراء لمن لا سجل تجاري له ولا شهادة ضريبية ولا فحص تكرار،
// ولا يستطيع أحد أصلًا أن يفصح عن تعارض معه لأن الإفصاح يشترط ملفًا مسجَّلًا.
test('PRC-02/03: an entity with no vendor file is refused at the quote and never reaches an internal order',t=>{
  const {db,make,act} = fixture(t);
  const p = act('employee',make(),'submit');
  const offer = {supplier_key:'ACME-XYZ',supplier_name:'كيان مصطنع بلا ملف مورد',unit_price:'10.01',technical_assessment:'عرض من كيان لم يُسجَّل في دليل الموردين',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2026-10-20',evidence:'عرض مصطنع من كيان مجهول'};
  let error; try { act('employee',p,'add_quote',offer); } catch (thrown) { error = thrown; }
  assert.equal(error?.code,'vendor_not_registered');
  // معيار الرفض: ما الذي رُفض، وما الناقص، ومن يملكه، وما الخطوة التالية.
  assert.equal(error.details.refusal.missing.length,1);
  assert.ok(error.details.refusal.missing[0].owner.length>0);
  assert.ok(error.details.refusal.next.length>0);
  assert.ok(error.message.includes('ACME-XYZ'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM procurement_quotes WHERE supplier_key='ACME-XYZ'").get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_orders').get().n,0);
});

// العطب المثبت (٢): من سجّل الاستلام كان يعتمد المطابقة المبنية عليه. الكود كان يفحص recorded_by (مسجّل
// الفاتورة) وحده، والمُطلِق يفحص requester_id وrecorded_by، ولا أحد يقرأ procurement_receipts.received_by.
test('PRC-05/06: whoever recorded a receipt cannot approve the match built on it, in code and in the database',t=>{
  const {db,act,ordered} = fixture(t);
  let p = ordered();
  p = act('manager',p,'receive',{quantity:5,reference:'reviewer-receipt',evidence:'استلام سجّله المراجع نفسه بدليل مصطنع'});
  p = act('employee',p,'record_invoice',{supplier_reference:'inv-self-match',quantity:5,amount:'50.05',evidence:'مرجع مورد مصطنع سجّله صاحب الطلب'});
  const invoiceId = p.invoices[0].id;
  assert.throws(()=>act('manager',p,'match',{invoice_id:invoiceId,note:'محاولة اعتماد مطابقة على استلام سجّلته بنفسي'}),errorCode('separation_of_duties'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_payables').get().n,0);
  // الحارس في الطبقتين: إدخال مباشر يتخطى الكود ويسقط بالمُطلِق.
  assert.throws(()=>db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('receiver-matched-payable',p.id,invoiceId,5005,'SAR','manager','إدخال مباشر من مسجّل الاستلام',p.version,new Date().toISOString()),/three way match/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_payables').get().n,0);
});
