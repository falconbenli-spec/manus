import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead,commercialAction } from '../app/commercial.mjs';
import { createClaim,claimAction,listReceivables,recordReceipt,receiptAction,requestClaimCancel,decideAdjustment } from '../app/receivables.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor,boundQuote,approverFor,scheduleFor } from './proposal-fixture.mjs';

const code=value=>error=>error.code===value;
function fixture(t){
 const db=openDb(':memory:');seed(db,'synthetic-receivables-only');t.after(()=>db.close());
 const users=Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id FROM users').all().map(u=>[u.id,u]));
 for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve']]])for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض تحصيل مصطنع',null,now());
 const act=(who,c,action,input={})=>transaction(db,()=>commercialAction(db,users[who],c.id,action,{version:c.version,...input}));
 let c=transaction(db,()=>dealFor(db,users.employee,{name:'عميل تحصيل مصطنع',registration_number:'AR-100',contact:'جهة مصطنعة',source:'اختبار',sector:'تجريبي'}));
 c=act('employee',c,'qualify',{need:'مخرج مصطنع للتحصيل',budget:'100.00',currency:'SAR',timing:'2099-12-01',decision_maker:'ممثل عميل',service_fit:'مناسب للاختبار'});
 c=act('manager',c,'approve_qualification',{note:'تأهيل معتمد للاختبار'});
 c=act('employee',c,'save_quote',boundQuote(db,c.id,{scope:'مخرج واحد مصطنع',currency:'SAR',valid_until:'2099-12-01',lines:[{description:'تقرير نهائي',quantity:'1',unit_price:'100.00',unit_cost:'20.00',discount:'0',tax_rate:'0',acceptance:'قبول التقرير بدليل',revisions:1}]}));
 c=act('employee',c,'submit_quote');c=act('manager',c,'approve_quote',{note:'عرض معتمد'});c=act('employee',c,'register_contract',{agreement_evidence:'اتفاق داخلي مصطنع موثق للاختبار',customer_representative:'ممثل مصطنع'});scheduleFor(db,c.id);c=act('manager',c,'create_project',{member_ids:[]});
 c=act('employee',c,'submit_delivery',{line_index:0,evidence:'مرجع تسليم التقرير النهائي المصطنع'});c=act('manager',c,'accept_delivery',{delivery_id:c.deliveries[0].id,note:'مطابق لمعيار التقرير',acceptance_evidence:'مرجع قبول داخلي مصطنع',approver_id:approverFor(db,c.project_id)});
 const delivery=c.deliveries[0],make=input=>transaction(db,()=>createClaim(db,users.employee,{delivery_id:delivery.id,amount:'100.00',due_date:'2099-12-15',entitlement_evidence:'العقد والقبول يدعمان الاستحقاق المصطنع',...input}));
 const claimAct=(who,claim,action,input={})=>transaction(db,()=>claimAction(db,users[who],claim.id,action,{version:claim.version,...input}));
 return {db,users,delivery,make,claimAct};
}

test('FIN-03: المخرج المقبول ينشئ استحقاقًا واحدًا بلقطة مصدر ولا يتجاوز قيمة البند',t=>{
 const {db,users,delivery,make}=fixture(t);const c=make();
 assert.equal(c.source_snapshot.delivery_id,delivery.id);assert.equal(c.amount_minor,'10000');assert.equal(c.status,'draft');
 assert.throws(()=>make(),code('duplicate_entitlement'));
 // الإلغاء بطلبٍ يعتمده غير طالبه (الترحيل 170)؛ التعديل المباشر للحالة صار يرفضه المحفّز ar_claim_cancel_decided.
 assert.throws(()=>db.prepare("UPDATE ar_claims SET status='cancelled',version=version+1 WHERE id=?").run(c.id),/independently decided cancellation/);
 const cancel=transaction(db,()=>requestClaimCancel(db,users.employee,c.id,{reason:'استحقاق مصطنع يُلغى لإعادة إعداده',evidence:'مذكرة داخلية مصطنعة بالإلغاء'}));
 transaction(db,()=>decideAdjustment(db,users.manager,c.id,cancel.id,'approve',{note:'راجعت المذكرة'}));
 // السقف منذ الترحيل 183 دفعة البند في الجدول — هنا بقيمة البند كاملة (tests/proposal-fixture.mjs scheduleFor)، فالسقف قيمة البند نفسها.
 assert.throws(()=>make({amount:'100.01'}),code('term_exceeded'));
 assert.throws(()=>listReceivables(db,users.outsider),code('receivable_access_denied'));
});

test('FIN-03: إعداد واعتماد الاستحقاق مستقلان والنسخة المقدمة ثابتة',t=>{
 const {db,users,make,claimAct}=fixture(t);let c=make();
 c=claimAct('employee',c,'submit');assert.equal(c.status,'pending');assert.equal(c.revision,1);
 assert.throws(()=>claimAct('employee',c,'approve',{note:'اعتماد ذاتي'}),code('transition_denied'));
 c=claimAct('manager',c,'approve',{note:'راجعت مصدر الاستحقاق والمبلغ'});assert.equal(c.status,'approved');
 assert.throws(()=>db.prepare("UPDATE ar_claim_versions SET snapshot='{}'").run(),/immutable/);assert.equal(verifyAudit(db),true);
});

test('FIN-03: كل قبض يصل إلى استحقاق ويحتاج مطابقة مستقلة ولا يتجاوز الرصيد',t=>{
 const {db,users,make,claimAct}=fixture(t);let c=claimAct('manager',claimAct('employee',make(),'submit'),'approve',{note:'استحقاق صحيح'});
 transaction(db,()=>recordReceipt(db,users.employee,c.id,{reference:'bank-ref-1',amount:'60.00',received_on:'2026-09-15',payer:'عميل مصطنع',evidence:'إشعار إيداع مصطنع للمراجعة'}));c=listReceivables(db,users.employee).claims[0];
 assert.equal(c.receipts[0].status,'pending');assert.throws(()=>transaction(db,()=>recordReceipt(db,users.employee,c.id,{reference:'bank-ref-2',amount:'50.00',received_on:'2026-09-15',payer:'عميل مصطنع',evidence:'إشعار آخر مصطنع للمراجعة'})),code('over_allocation'));
 assert.throws(()=>transaction(db,()=>recordReceipt(db,users.employee,c.id,{reference:'bank-ref-1',amount:'10.00',received_on:'2026-09-15',payer:'عميل مصطنع',evidence:'مرجع مكرر للاختبار المحلي'})),code('duplicate_receipt_reference'));
 const receipt=c.receipts[0];assert.throws(()=>transaction(db,()=>receiptAction(db,users.employee,c.id,receipt.id,'confirm',{note:'ذاتي',matching_evidence:'دليل ذاتي غير مسموح'})),code('receivable_access_denied'));
 c=transaction(db,()=>receiptAction(db,users.manager,c.id,receipt.id,'confirm',{note:'طابقت المرجع والمبلغ',matching_evidence:'مطابقة كشف مصطنع داخلية'}));
 assert.equal(c.confirmed_minor,'6000');assert.equal(c.balance_minor,'4000');assert.equal(c.aging_bucket,'غير مستحق');
 assert.throws(()=>transaction(db,()=>receiptAction(db,users.manager,c.id,receipt.id,'confirm',{note:'تكرار',matching_evidence:'تكرار القرار'})),code('receipt_not_found'));
});

test('FIN-04/08: العرض يفصل المتنازع عليه ولا يدعي فاتورة أو دفعًا خارجيًا',t=>{
 const {db,users,make,claimAct}=fixture(t);let c=claimAct('manager',claimAct('employee',make({due_date:'2026-01-01'}),'submit'),'approve',{note:'استحقاق صحيح'});
 assert.equal(listReceivables(db,users.manager).claims[0].aging_bucket,'متأخر');
 db.prepare('INSERT INTO ar_disputes(id,claim_id,amount_minor,reason,evidence,opened_by,opened_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),c.id,'2500','اعتراض مصطنع','مرجع اعتراض داخلي',users.employee.id,now());
 const result=listReceivables(db,users.manager);assert.equal(result.claims[0].aging_bucket,'متنازع عليه');assert.equal(result.external_invoicing,'not_connected');assert.equal(result.payment_execution,'not_connected');
});

test('المسودة والمراجعة والرفض لا تظهر كاستحقاق مسدد',t=>{
 const {make,claimAct}=fixture(t);let c=make();assert.equal(c.aging_bucket,'غير مقدم');
 c=claimAct('employee',c,'submit');assert.equal(c.aging_bucket,'قيد الاعتماد');
 c=claimAct('manager',c,'reject',{note:'مصدر يحتاج تصحيحًا'});assert.equal(c.aging_bucket,'مرفوض');assert.equal(c.confirmed_minor,'0');
});

test('رفض قبض غير مطابق يحرر المبلغ لمراجعة سجل صحيح دون تغيير الرصيد المؤكد',t=>{
 const {db,users,make,claimAct}=fixture(t);const c=claimAct('manager',claimAct('employee',make(),'submit'),'approve',{note:'استحقاق صحيح'});
 const input={reference:'wrong-ref',amount:'100.00',received_on:'2026-09-15',payer:'عميل مصطنع',evidence:'دليل مصطنع به اختلاف للمراجعة'};
 const r=transaction(db,()=>recordReceipt(db,users.employee,c.id,input));
 const rejected=transaction(db,()=>receiptAction(db,users.manager,c.id,r.id,'reject',{note:'المبلغ غير مطابق',matching_evidence:'مرجع مراجعة مصطنع يثبت الاختلاف'}));
 assert.equal(rejected.balance_minor,'10000');assert.equal(rejected.receipts[0].status,'rejected');
 const replacement=transaction(db,()=>recordReceipt(db,users.employee,c.id,{...input,reference:'correct-ref'}));assert.equal(replacement.status,'pending');assert.equal(verifyAudit(db),true);
});

test('واجهة المستحقات توفر الرفض للمطابق المستقل وتمنعه عن صاحب القبض',async()=>{
 const {receivablesUI}=await import('../app/static/receivables-ui.mjs');
 const data={user_id:'reviewer',permissions:['read','approve'],sources:[],claims:[{id:'claim',source_snapshot:{line_description:'مخرج'},status:'approved',currency:'SAR',amount_minor:'10000',balance_minor:'10000',due_date:'2099-01-01',aging_bucket:'غير مستحق',entitlement_evidence:'دليل',actions:['confirm_receipt','reject_receipt'],receipts:[{id:'receipt',reference:'REF',amount_minor:'10000',status:'pending',received_on:'2026-09-15',recorded_by:'maker'}]}]};
 const rendered=receivablesUI.render(data,{e:String,money:String,button:(a)=>`[${a}]`});assert.ok(rendered.includes('[reject_receipt]'));
 assert.equal(receivablesUI.form('reject_receipt','claim:receipt',data).endpoint,'/receivables/claim/receipts/receipt/reject');
 assert.throws(()=>receivablesUI.form('reject_receipt','claim:receipt',{...data,user_id:'maker'}));
 assert.throws(()=>receivablesUI.form('reject_receipt','claim:receipt',{...data,permissions:['read']}));
});
