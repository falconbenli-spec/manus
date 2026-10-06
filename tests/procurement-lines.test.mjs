import test from 'node:test';
import assert from 'node:assert/strict';
import { fundProject } from './budget-fixture.mjs';
import { openDb, transaction } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';

// الاستلام يُسجَّل اليوم، فأمر المباشرة يبدأ اليوم: الإذن الذي لم يبدأ سريانه لا يفتح استلامًا (الترحيل 162).
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

function fixture(t) {
  const db=openDb(':memory:');
  seed(db,'synthetic-procurement-lines-test-only');
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(user=>[user.id,user]));
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع بنود مشتريات مصطنع',brief:'اختبار ربط بنود الشراء محليًا',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const input={project_id:project.id,title:'احتياج طباعة مصطنع',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2026-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار داخلي قدره مئة ريال',currency:'SAR'};
  const make=()=>transaction(db,()=>createPurchase(db,users.employee,input));
  const act=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  const quote=(p,key,price)=>act('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق مواصفات الطباعة المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2026-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  // بوابة المورد (app/vendors.mjs): الكيان الذي بلا ملف ما عاد يُقبل عرضه ولا تُرسى عليه ترسية،
  // فكل مفتاح يمرّ في add_quote يحتاج ملفًا مؤهلًا فعلًا يبنيه المساعد بالمسار الحقيقي.
  // وموضعه آخر التجهيز عمدًا: المساعد يمنح vendors.manage بنفسه، فلو سبق منح الاختبار لاصطدما.
  approveVendors(db,['supplier-a', 'supplier-b', 'supplier-c']);
  return {db,input,make,act,quote};
}

test('PRC-04/05/06: السطر الواحد الحالي يُحفظ بمعرّف ثابت وتتبعه الاستلامات والفاتورة والمطابقة',t=>{
  const {db,input,make,act,quote}=fixture(t);
  let p=make();
  assert.equal(p.lines.length,1);
  const purchaseLine=p.lines[0];
  assert.equal(purchaseLine.description,input.specification);
  assert.equal(purchaseLine.quantity,5);
  assert.equal(purchaseLine.unit,'نسخة');
  assert.equal(purchaseLine.unit_price_minor,null,'لا يُختلق سعر قبل عرض المورد المعتمد');
  assert.equal(purchaseLine.price_source,'not_priced');
  assert.deepEqual(purchaseLine.allocations.map(row=>({cost_center:row.cost_center,amount_minor:row.amount_minor})),[
    {cost_center:'SYNTHETIC-CC-1',amount_minor:10000}
  ]);

  p=act('employee',p,'submit');
  p=quote(p,'supplier-a','10.01');
  p=quote(p,'supplier-b','11.00');
  p=quote(p,'supplier-c','12.00');
  p=act('manager',p,'award',{quote_id:p.quotes.find(row=>row.supplier_key==='SUPPLIER-A').id,note:'اخترنا العرض الموافق والأقل وأكدنا المخصص'});
  p=act('manager',p,'approve_order',{terms:'تسليم داخلي بعد التحقق من الجودة',delivery_date:'2026-10-20',note:'اعتماد أمر محلي دون إرسال خارجي'});
  p=act('manager',p,'commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'مطبعة المورد المصطنعة',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر الداخلي',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});

  assert.equal(p.lines[0].id,purchaseLine.id,'هوية بند الطلب لا تتغير عبر الاعتماد');
  assert.equal(p.order.lines.length,1);
  const orderLine=p.order.lines[0];
  assert.equal(orderLine.purchase_line_id,purchaseLine.id);
  assert.equal(orderLine.unit_price_minor,1001);
  assert.equal(orderLine.total_minor,5005);
  assert.equal(orderLine.allocated_minor,5005);

  p=act('employee',p,'receive',{quantity:2,reference:'receipt-lines-1',evidence:'استلام وحدتين وفحصهما محليًا'});
  assert.deepEqual(p.receipts[0].lines.map(row=>[row.order_line_id,row.quantity]),[[orderLine.id,2]]);
  p=act('employee',p,'record_invoice',{supplier_reference:'invoice-lines-1',quantity:2,amount:'20.02',evidence:'مرجع فاتورة مصطنع لوحدتين'});
  assert.deepEqual(p.invoices[0].lines.map(row=>[row.order_line_id,row.quantity,row.amount_minor]),[[orderLine.id,2,2002]]);
  p=act('manager',p,'match',{invoice_id:p.invoices[0].id,note:'مطابقة مستقلة لبند الأمر والاستلام والفاتورة'});
  assert.deepEqual(p.payables[0].lines.map(row=>[row.order_line_id,row.quantity,row.amount_minor]),[[orderLine.id,2,2002]]);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_purchase_lines WHERE purchase_id=?').get(p.id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_order_lines WHERE purchase_id=?').get(p.id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_receipt_lines WHERE purchase_id=?').get(p.id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_invoice_lines WHERE purchase_id=?').get(p.id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_payable_lines WHERE purchase_id=?').get(p.id).n,1);
});

test('PRC-05: القاعدة ترفض ربط استلام من طلب ببند أمر طلب آخر',t=>{
  const {db,make,act,quote}=fixture(t);
  const ordered=()=>{
    let p=act('employee',make(),'submit');
    p=quote(p,'supplier-a','10.01');
    p=quote(p,'supplier-b','11.00');
    p=quote(p,'supplier-c','12.00');
    p=act('manager',p,'award',{quote_id:p.quotes.find(row=>row.supplier_key==='SUPPLIER-A').id,note:'ترسية مصطنعة مستقلة لاختبار سلامة الربط'});
    return act('manager',p,'approve_order',{terms:'شروط أمر مصطنعة لاختبار سلامة الربط',delivery_date:'2026-10-20',note:'اعتماد أمر مصطنع لاختبار سلامة الربط'});
  };
  let first=ordered();
  first=act('manager',first,'commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'موقع المورد المصطنع الأول',scope_confirmation:'أمر مباشرة مصطنع للطلب الأول فقط',evidence:'بريد إذن المباشرة المرسل للمورد الأول'});
  first=act('employee',first,'receive',{quantity:1,reference:'receipt-first',evidence:'استلام مصطنع مرتبط بالطلب الأول'});
  const second=ordered();
  assert.throws(()=>db.prepare('INSERT INTO procurement_receipt_lines(id,receipt_id,purchase_id,order_line_id,quantity,created_at) VALUES(?,?,?,?,?,?)')
    .run('cross-purchase-line',first.receipts[0].id,second.id,second.order.lines[0].id,1,new Date().toISOString()),/FOREIGN KEY/);
});
