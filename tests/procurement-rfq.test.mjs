import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { createPurchase, procurementAction, submitRfq, listProcurement } from '../app/procurement.mjs';
import { listFinanceRfqs, reviewRfq } from '../app/procurement-rfq.mjs';
import { procurementUI } from '../app/static/procurement-ui.mjs';
import { createApp } from '../app/server.mjs';
import { inbox } from '../app/inbox.mjs';

const code=expected=>error=>error.code===expected;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-rfq-test-only');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(row=>[row.id,row]));
  for(const action of ['read','approve'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t','outsider',users.outsider.role,action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع لمراجعة F-04',null,now());
  db.prepare("INSERT INTO procurement_rfq_policies VALUES('36t',1,'F-03/F-04 test adoption',?)").run(now());
  approveVendors(db,['SUPPLIER-A','SUPPLIER-B','SUPPLIER-C']);
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع تحقق مالي مصطنع',brief:'اختبار F-03 وF-04 من الترسية إلى الأمر',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const act=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'طباعة مواد مصطنعة',specification:'خمس نسخ وفق المواصفات المسجلة في الاختبار',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار محلي',currency:'SAR'}));
  p=act('employee',p,'submit');
  for(const [key,price] of [['SUPPLIER-A','10.00'],['SUPPLIER-B','11.00'],['SUPPLIER-C','12.00']])p=act('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد مصطنع '+key,unit_price:price,technical_assessment:'مطابق للمواصفات المصطنعة',financial_terms:'ثلاثون يومًا بعد المطابقة',delivery_date:'2099-10-20',evidence:'عرض مورد مصطنع '+key});
  p=act('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'اختيار العرض المطابق والأقل ضمن المخصص'});
  const submit=(purchase=p,overrides={})=>transaction(db,()=>submitRfq(db,users.manager,purchase.id,{purchase_version:purchase.version,quotation_on:today(),vendor_quote_reference:'VQ-SYNTH-1',rfp_reference:'RFP-SYNTH-1',proposed_payment_terms:'ثلاثون يومًا بعد المطابقة',valid_until:'2099-10-20',vat_amount:'7.50',po_required:true,...overrides}));
  const review=(rfq,overrides={})=>transaction(db,()=>reviewRfq(db,users.outsider,rfq.id,{decision:'approved',report_number:'FVR-SYNTH-1',report_date:today(),finance_notes:'راجعت قيمة العرض والمخصص والمقارنة لكل بند',lines:rfq.lines.map(line=>({rfq_line_id:line.id,rate_card_unit_price:'10.00',result:'within_rate',note:''})),...overrides}));
  return {db,users,project,act,p,submit,review,read:who=>listProcurement(db,users[who]).find(row=>row.id===p.id)};
}

test('F-03/F-04: an adopted tenant cannot issue a purchase order before an independent one-day finance verification',t=>{
  const {db,users,act,p,submit,review}=fixture(t);
  assert.throws(()=>act('manager',p,'approve_order',{terms:'شروط أمر داخلي',delivery_date:'2099-10-20',note:'محاولة تجاوز المالية'}),code('rfq_finance_required'));
  const rfq=submit();
  assert.equal(rfq.status,'pending_finance');
  assert.equal(rfq.source_reference,'F-03/F-04');
  assert.equal(rfq.lines.length,1);
  assert.deepEqual([rfq.subtotal_minor,rfq.vat_minor,rfq.total_minor],[5000,750,5750]);
  assert.ok(rfq.finance_due_on>=rfq.request_on);
  assert.equal(listFinanceRfqs(db,users.outsider)[0].actions[0],'finance_review_rfq');
  const decision=inbox(db,users.outsider).groups.find(group=>group.key==='procurement')?.items.find(item=>item.id===rfq.id);
  assert.equal(decision?.actions[0],'مراجعة طلب عرض سعر');
  assert.equal(decision?.link,`#procurement?focus=${rfq.id}`);
  assert.throws(()=>db.prepare(`INSERT INTO procurement_rfqs(id,tenant_id,purchase_id,quote_id,revision,rfq_number,request_on,rfp_reference,requesting_department,quotation_on,vendor_quote_reference,proposed_payment_terms,valid_until,subtotal_minor,vat_minor,total_minor,currency,po_required,status,finance_due_on,source_reference,created_by,purchase_version,created_at)
    SELECT ?,tenant_id,purchase_id,quote_id,revision+90,rfq_number||'-FORCED',request_on,rfp_reference,requesting_department,quotation_on,vendor_quote_reference,proposed_payment_terms,valid_until,subtotal_minor,vat_minor,total_minor,currency,po_required,status,finance_due_on,source_reference,?,purchase_version,created_at FROM procurement_rfqs WHERE id=?`)
    .run(randomUUID(),'employee',rfq.id),/awarded quote and an independent procurement reviewer/);
  assert.throws(()=>db.prepare('INSERT INTO procurement_rfq_finance_reviews(id,tenant_id,rfq_id,purchase_id,decision,finance_notes,report_number,report_date,reviewed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t',rfq.id,p.id,'approved','محاولة اعتماد بلا مراجعة البنود','FORCED',today(),'outsider',now()),/every RFQ line/);
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'no-finance-reviewer',tenant_id,department_id,'no-finance-reviewer','مراجع بلا تفويض',password_hash,'employee',manager_id FROM users WHERE id='outsider'").run();
  assert.throws(()=>transaction(db,()=>{
    const reviewId=randomUUID(),line=rfq.lines[0];
    db.prepare('INSERT INTO procurement_rfq_finance_lines(id,review_id,rfq_id,rfq_line_id,quote_unit_price_minor,rate_card_unit_price_minor,difference_minor,difference_basis_points,result,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),reviewId,rfq.id,line.id,line.quote_unit_price_minor,line.quote_unit_price_minor,0,0,'within_rate','',now());
    db.prepare('INSERT INTO procurement_rfq_finance_reviews(id,tenant_id,rfq_id,purchase_id,decision,finance_notes,report_number,report_date,reviewed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(reviewId,'36t',rfq.id,p.id,'approved','محاولة اعتماد بلا تفويض مالي','FORCED-NO-GRANT',today(),'no-finance-reviewer',now());
  }),/active finance approval grant/);
  assert.throws(()=>submit(),code('rfq_already_active'));

  for(const action of ['read','approve'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t','manager','manager',action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع لاختبار الفصل',null,now());
  assert.throws(()=>transaction(db,()=>reviewRfq(db,users.manager,rfq.id,{decision:'approved',report_number:'BAD',report_date:today(),finance_notes:'محاولة اعتماد من معتمد الترسية نفسه',lines:rfq.lines.map(line=>({rfq_line_id:line.id,rate_card_unit_price:'10.00',result:'within_rate',note:''}))})),code('rfq_separation_of_duties'));

  const approved=review(rfq);
  assert.equal(approved.status,'approved');
  assert.equal(approved.finance_review.reviewed_by,'outsider');
  assert.equal(approved.finance_review.lines[0].difference_minor,0);
  let ordered=act('manager',p,'approve_order',{terms:'شروط أمر داخلي بعد التحقق المالي',delivery_date:'2099-10-20',note:'راجعت تقرير F-04 قبل إصدار الأمر'});
  assert.equal(ordered.status,'ordered');
  assert.equal(ordered.rfq.status,'approved');
  assert.throws(()=>db.prepare("UPDATE procurement_rfqs SET vendor_quote_reference='changed' WHERE id=?").run(rfq.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM procurement_rfq_finance_reviews WHERE id=?').run(approved.finance_review.id),/immutable/);
  assert.equal(verifyAudit(db),true);
});

test('F-04: every line is reviewed, missing rate references need reasons, revisions remain visible, and the UI exposes both queues',t=>{
  const {db,users,p,submit,review}=fixture(t);
  const first=submit();
  assert.throws(()=>review(first,{lines:[]}),code('rfq_review_lines'));
  assert.throws(()=>review(first,{lines:first.lines.map(line=>({rfq_line_id:line.id,rate_card_unit_price:'',result:'no_reference',note:''}))}),code('rfq_review_note'));
  const changed=review(first,{decision:'changes_required',report_number:'FVR-CHANGES-1',finance_notes:'مرجع المورد يحتاج تصحيحًا قبل الاعتماد',lines:first.lines.map(line=>({rfq_line_id:line.id,rate_card_unit_price:'',result:'no_reference',note:'لا توجد بطاقة سعر لهذا البند'}))});
  assert.equal(changed.status,'changes_required');
  const second=submit(p,{vendor_quote_reference:'VQ-SYNTH-2',vat_amount:'0.00'});
  assert.equal(second.revision,2);
  assert.equal(second.total_minor,second.subtotal_minor);
  const queue=listFinanceRfqs(db,users.outsider),pending=queue.find(x=>x.id===second.id);
  const ctx={e:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),button:(action,id,label)=>`<button data-op="${action}" data-id="${id}">${label}</button>`,money:minor=>String(minor)};
  const managerView=listProcurement(db,users.manager).find(row=>row.id===p.id);
  const html=procurementUI.render({purchases:[managerView],projects:[],user:users.outsider,rfq_queue:queue},ctx);
  assert.match(html,/طلبات عرض السعر عند المالية/);
  assert.match(html,/data-op="finance_review_rfq"/);
  assert.match(html,/VQ-SYNTH-2/);
  const form=procurementUI.form('finance_review_rfq',pending.id,{purchases:[],projects:[],user:users.outsider,rfq_queue:queue});
  assert.equal(form.endpoint,`/procurement-rfqs/${pending.id}/review`);
  assert.equal(form.fields.find(field=>field.name==='lines').type,'rows');
});

test('F-03/F-04 HTTP: the procurement screen submits the package and finance reads and decides its own queue',async t=>{
  const {db,p}=fixture(t),server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['manager','outsider']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-rfq-test-only'})});
    assert.equal(response.status,200);const body=await response.json();sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.csrf};
  }
  const call=async(who,path,input,expected=200)=>{
    const auth=sessions[who],response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie:auth.cookie,'x-csrf-token':auth.csrf,'Idempotency-Key':randomUUID()},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;
  };
  const rfq=await call('manager',`/procurement-rfqs/${p.id}/submit`,{purchase_version:p.version,quotation_on:today(),vendor_quote_reference:'VQ-HTTP-1',rfp_reference:'',proposed_payment_terms:'ثلاثون يومًا بعد المطابقة',valid_until:'2099-10-20',vat_amount:'0.00',po_required:true},201);
  const queue=await call('outsider','/procurement-rfqs');
  assert.equal(queue[0].id,rfq.id);assert.deepEqual(queue[0].actions,['finance_review_rfq']);
  const approved=await call('outsider',`/procurement-rfqs/${rfq.id}/review`,{decision:'approved',report_number:'FVR-HTTP-1',report_date:today(),finance_notes:'تحقق مالي مصطنع عبر المسار العام',lines:rfq.lines.map(line=>({rfq_line_id:line.id,rate_card_unit_price:'',result:'no_reference',note:'لا توجد بطاقة سعر للبند المصطنع'}))},201);
  assert.equal(approved.status,'approved');
  const purchase=(await call('manager','/procurement')).find(row=>row.id===p.id);
  assert.equal(purchase.rfq.status,'approved');
});
