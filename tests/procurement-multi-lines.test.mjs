import test from 'node:test';
import assert from 'node:assert/strict';
import { fundProject } from './budget-fixture.mjs';
import { openDb, transaction } from '../app/db.mjs';
import { approveVendors, registerVendor } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { procurementUI } from '../app/static/procurement-ui.mjs';

// الاستلام يُسجَّل اليوم، فأمر المباشرة يبدأ اليوم: الإذن الذي لم يبدأ سريانه لا يفتح استلامًا (الترحيل 162).
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

function fixture(t) {
  const db=openDb(':memory:');
  seed(db,'synthetic-procurement-multi-lines-test-only');
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(user=>[user.id,user]));
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع شراء متعدد البنود',brief:'اختبار دورة بنود مستقلة محليًا',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const input={
    project_id:project.id,
    title:'مواد فعالية داخلية مصطنعة',
    specification:'تسليم البنود كاملة بالمواصفات والكميات المسجلة وفحص كل بند مستقلًا',
    due_date:'2026-10-20',
    budget_evidence:'مخصص اختبار داخلي قدره مئة وعشرون ريالًا',
    currency:'SAR',
    lines:[
      {description:'بطاقات تعريف مطبوعة',quantity:5,unit:'نسخة',cost_center:'SYNTHETIC-CC-1',budget_amount:'50.00'},
      {description:'حوامل بطاقات بلاستيكية',quantity:3,unit:'قطعة',cost_center:'SYNTHETIC-CC-1',budget_amount:'70.00'}
    ]
  };
  const create=()=>transaction(db,()=>createPurchase(db,users.employee,input));
  const act=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  const prices=(p,a,b)=>[
    {purchase_line_id:p.lines[0].id,unit_price:a},
    {purchase_line_id:p.lines[1].id,unit_price:b}
  ];
  const quote=(p,key,a,b)=>act('employee',p,'add_quote',{
    supplier_key:key,supplier_name:'مورد اختبار '+key,line_prices:prices(p,a,b),
    technical_assessment:'العرض يطابق مواصفات كل بند مسجل',financial_terms:'استحقاق بعد الاستلام والمطابقة',
    delivery_date:'2026-10-20',evidence:'عرض مصطنع متعدد البنود '+key
  });
  // بوابة المورد: الكيان بلا ملف ما عاد يُقبل عرضه. والمفاتيح أدناه تحتاج ملفًا مؤهلًا فعلًا،
  // إلا ما يقصد الاختبار أن يبقى بلا ملف فيبقى.
  approveVendors(db,['supplier-a','supplier-b','supplier-c','duplicate','empty','foreign','missing']);
  return {db,users,input,create,act,quote,prices};
}

function orderPurchase(f) {
  let p=f.act('employee',f.create(),'submit');
  p=f.quote(p,'supplier-a','5.00','10.00');
  p=f.quote(p,'supplier-b','6.00','11.00');
  p=f.quote(p,'supplier-c','7.00','12.00');
  p=f.act('manager',p,'award',{quote_id:p.quotes.find(row=>row.supplier_key==='SUPPLIER-A').id,note:'اختير العرض المطابق والأقل لكل البنود وأكد المخصص'});
  p=f.act('manager',p,'approve_order',{terms:'تسليم البنود وفحص كل واحد منها مستقلًا',delivery_date:'2026-10-20',note:'اعتماد أمر داخلي متعدد البنود دون إرسال خارجي'});
  return p;
}

test('PRC-04: الطلب والعرض والأمر يحفظون عدة بنود بهويات وأسعار مستقلة',t=>{
  const f=fixture(t);
  let p=f.create();
  assert.equal(p.lines.length,2);
  assert.deepEqual(p.lines.map(line=>[line.line_no,line.description,line.quantity,line.unit,line.allocations[0].amount_minor]),[
    [1,'بطاقات تعريف مطبوعة',5,'نسخة',5000],
    [2,'حوامل بطاقات بلاستيكية',3,'قطعة',7000]
  ]);
  assert.equal(p.budget_minor,12000);

  p=f.act('employee',p,'submit');
  p=f.quote(p,'supplier-a','5.00','10.00');
  const quote=p.quotes[0];
  assert.equal(quote.total_minor,5500);
  assert.deepEqual(quote.lines.map(line=>[line.purchase_line_id,line.unit_price_minor,line.total_minor]),[
    [p.lines[0].id,500,2500],
    [p.lines[1].id,1000,3000]
  ]);
  p=f.quote(p,'supplier-b','6.00','11.00');
  p=f.quote(p,'supplier-c','7.00','12.00');
  p=f.act('manager',p,'award',{quote_id:quote.id,note:'اختير العرض الأقل بعد مقارنة أسعار كل بند وتأكيد المخصص'});
  p=f.act('manager',p,'approve_order',{terms:'تسليم كل بند حسب الكمية والوحدة المسجلة',delivery_date:'2026-10-20',note:'اعتماد داخلي متعدد البنود'});
  assert.equal(p.order.total_minor,5500);
  assert.deepEqual(p.order.lines.map(line=>[line.purchase_line_id,line.quantity,line.unit,line.unit_price_minor,line.total_minor]),[
    [p.lines[0].id,5,'نسخة',500,2500],
    [p.lines[1].id,3,'قطعة',1000,3000]
  ]);
});

test('PRC-04: تسعير العرض يرفض البند الناقص والمكرر والغريب',t=>{
  const f=fixture(t);
  let p=f.act('employee',f.create(),'submit');
  const base={supplier_name:'مورد تحقق البنود',technical_assessment:'مطابقة فنية لكل البنود',financial_terms:'بعد الاستلام',delivery_date:'2026-10-20',evidence:'عرض اختبار تحقق البنود'};
  assert.throws(()=>f.act('employee',p,'add_quote',{...base,supplier_key:'empty'}),error=>error.code==='invalid_quote_lines');
  assert.throws(()=>f.act('employee',p,'add_quote',{...base,supplier_key:'missing',line_prices:[{purchase_line_id:p.lines[0].id,unit_price:'5.00'}]}),error=>error.code==='invalid_quote_lines');
  assert.throws(()=>f.act('employee',p,'add_quote',{...base,supplier_key:'duplicate',line_prices:[{purchase_line_id:p.lines[0].id,unit_price:'5.00'},{purchase_line_id:p.lines[0].id,unit_price:'6.00'}]}),error=>error.code==='invalid_quote_lines');
  assert.throws(()=>f.act('employee',p,'add_quote',{...base,supplier_key:'foreign',line_prices:[{purchase_line_id:p.lines[0].id,unit_price:'5.00'},{purchase_line_id:'not-this-purchase',unit_price:'6.00'}]}),error=>error.code==='invalid_quote_lines');
});

test('PRC-05/06: الاستلام والفاتورة والمطابقة تتحقق من كل بند مستقلًا',t=>{
  const f=fixture(t);
  let p=orderPurchase(f);
  p=f.act('manager',p,'commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'موقع المورد المصطنع',scope_confirmation:'أذنّا للمورد ببدء البنود المسجلة في الأمر الداخلي',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
  const [cards,holders]=p.order.lines;
  p=f.act('employee',p,'receive',{reference:'multi-receipt-1',evidence:'فُحصت دفعة جزئية من البندين',lines:[
    {order_line_id:cards.id,quantity:2},{order_line_id:holders.id,quantity:1}
  ]});
  assert.equal(p.status,'part_received');
  assert.deepEqual(p.receipts[0].lines.map(line=>[line.order_line_id,line.quantity]),[[cards.id,2],[holders.id,1]]);
  // فاتورة بسعر يتجاوز البند تُسجَّل موقوفة بفرقها على البند نفسه، ولا تُطابَق بلا قرار (الترحيل 169).
  p=f.act('employee',p,'record_invoice',{supplier_reference:'multi-invoice-too-high',evidence:'فاتورة تتجاوز سعر البند',lines:[
    {order_line_id:cards.id,quantity:2,amount:'10.01'}
  ]});
  const high=p.invoices.find(invoice=>invoice.supplier_reference==='MULTI-INVOICE-TOO-HIGH');
  assert.equal(high.state,'held');
  assert.deepEqual(high.variance.lines.map(line=>[line.order_line_id,line.price_variance_minor]),[[cards.id,1]]);
  assert.throws(()=>f.act('manager',p,'match',{invoice_id:high.id,note:'محاولة مطابقة فاتورة موقوفة'}),error=>error.code==='invoice_held');
  p=f.act('employee',p,'record_invoice',{supplier_reference:'multi-invoice-1',evidence:'مرجع فاتورة لدفعة البنود المستلمة',lines:[
    {order_line_id:cards.id,quantity:2,amount:'10.00'},
    {order_line_id:holders.id,quantity:1,amount:'10.00'}
  ]});
  const first=p.invoices.find(invoice=>invoice.supplier_reference==='MULTI-INVOICE-1');
  assert.equal(first.amount_minor,2000);
  assert.deepEqual(first.lines.map(line=>[line.order_line_id,line.quantity,line.amount_minor]),[[cards.id,2,1000],[holders.id,1,1000]]);
  p=f.act('manager',p,'match',{invoice_id:first.id,note:'طابقنا كميات وأسعار كل بند مع الاستلام والأمر'});
  assert.deepEqual(p.payables[0].lines.map(line=>[line.order_line_id,line.quantity,line.amount_minor]),[[cards.id,2,1000],[holders.id,1,1000]]);

  assert.throws(()=>f.act('employee',p,'receive',{reference:'multi-receipt-over',evidence:'محاولة تجاوز كمية بند واحد',lines:[
    {order_line_id:cards.id,quantity:4}
  ]}),error=>error.code==='quantity_exceeded');
});

test('واجهة المشتريات تجمع البنود والأسعار والكميات في جداول صفوف',()=>{
  const create=procurementUI.form('create','',{projects:[{id:'p1',name:'مشروع'}],purchases:[]});
  const createLines=create.fields.find(field=>field.name==='lines');
  assert.equal(createLines.type,'rows');
  assert.deepEqual(createLines.columns.map(column=>column.name),['description','quantity','unit','cost_center','budget_amount']);

  const row={id:'r1',version:2,due_date:'2026-10-20',allowed_actions:['add_quote'],lines:[
    {id:'l1',line_no:1,description:'البند الأول',quantity:2,unit:'قطعة'},
    {id:'l2',line_no:2,description:'البند الثاني',quantity:3,unit:'نسخة'}
  ]};
  const quote=procurementUI.form('add_quote','r1',{purchases:[row],projects:[],user:{id:'employee'}});
  const prices=quote.fields.find(field=>field.name==='line_prices');
  assert.equal(prices.type,'rows');
  assert.equal(prices.minRows,2);
  assert.equal(prices.maxRows,2);
  assert.deepEqual(prices.value.map(value=>value.purchase_line_id),['l1','l2']);
});
