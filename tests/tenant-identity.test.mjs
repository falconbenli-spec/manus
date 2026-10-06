import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { invoicePrintable, payslipPrintable } from '../app/print-documents.mjs';
import { letterPrintable } from '../app/letters.mjs';
import { callSheetPrintable } from '../app/production.mjs';
import { clientReportPrintable } from '../app/client-reports.mjs';
import { documentFooter, tenantIdentity, tenantDemoFlag, tenantDataView, declareTenantData, stillSynthetic, REAL, SYNTHETIC } from '../app/tenant-identity.mjs';

// العطب: «أُنتجت من منصة 3,6T — بيئة تجريبية ببيانات مصطنعة» كانت مكتوبة بحرفها في أربعة ملفات ولا تقرأ شيئًا،
// فتُطبع على قسيمة راتب حقيقية وتقرير عميل حقيقي. هنا يُثبَّت الباب الجديد بحيث يفشل هذا الملف إن عاد العطب:
// التحذير يُطبع ما دام demo_data=1، ويسقط عند 0، والنداء الذي لا يمرر شيئًا يبقى على التحذير لا العكس.
const WARNING='بيئة تجريبية ببيانات مصطنعة';
const PRINT='استخدم «طباعة» من المتصفح ثم «حفظ كـ PDF».';
const source=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');

/* ───── نسخ مصطنعة للمستندات الخمسة. لا اسم موظف حقيقي ولا رقم حقيقي. ───── */
const seller={legal_name:'شركة مصطنعة للتسويق',vat_number:'300000000000003',cr_number:'1010000000',address:{building:'1234',street:'طريق مصطنع',district:'حي مصطنع',city:'الرياض',postal_code:'12345',country:'SA'}};
const invoice={kind:'invoice',number:'INV-2026-000001',status:'issued',status_name:'صادرة',issued_at:'2026-09-17T10:00:00.000Z',supply_date:'2026-09-15',seller,buyer:{legal_name:'عميل مصطنع',vat_number:'',address:'الرياض'},
  lines:[{description:'تصميم هوية مصطنع',quantity:'1',net_minor:100000,vat_minor:15000,total_minor:115000}],vat_basis_points:1500,currency:'SAR',net_minor:100000,vat_minor:15000,total_minor:115000,
  qr_tlv:'AQ1TeW50aGV0aWM=',hash:'a'.repeat(64),prepared_by_name:'محاسب مصطنع',issued_by_name:'معتمد مصطنع',original_number:null,vat_reason:'',reason:''};
const slip={month:'2026-08',earnings:[{component:'basic',monthly_minor:800000,amount_minor:800000}],adjustments:[],
  gross_minor:800000,additions_minor:0,advance_minor:0,other_deductions_minor:0,unpaid_absence_minor:0,social_insurance_minor:80000,net_minor:720000,basis:{parts:[{rule:'قاعدة مصطنعة للاحتساب'}]}};
const employee={name:'الموظفة التجريبية',department:'الفريق الإبداعي التجريبي'};
const letter={type_name:'تعريف بالراتب',reference:'HR-2026-000001',issued_on:'2026-09-20',cancelled:null,body:'إلى من يهمه الأمر\n\nنفيدكم بأن حامل هذا الخطاب موظف مصطنع لدينا.',
  verify_path:'/verify/AAAABBBBCCCC',verify_code:'AAAABBBBCCCC',prepared_by_name:'معدّة مصطنعة',issued_by_name:'مصدِرة مصطنعة',delivery:'digital',copies:1};
const callSheet={status:'issued',production_code:'PRD-001',production_title:'إنتاج مصطنع',shoot_date:'2026-09-25',revision:1,call_time:'06:30',wrap_time:'18:00',change_summary:'',
  location_name:'موقع مصطنع',location_address:'الرياض، حي مصطنع',location_contact:'منسق مصطنع',location_contact_phone:'0500000000',map_link:'',location_permit:{required:false},
  nearest_hospital:'مستشفى مصطنع',hospital_address:'الرياض',emergency_contact_name:'جهة مصطنعة',emergency_contact_phone:'0500000001',weather_note:'',safety_notes:'',
  day_schedule:[{time:'07:00',activity:'تجهيز',note:''}],invitees:[{display_name:'عضو طاقم مصطنع',party_kind:'crew',call_time:'06:30',state_name:'مؤكد',response_source:'in_platform',delivery:'in_platform'}],
  prepared_by_name:'منتجة مصطنعة',issued_by_name:'مديرة إنتاج مصطنعة',issued_at:'2026-09-21T07:00:00.000Z'};
const clientReport={status:'draft',status_name:'مسودة',title:'تقرير أداء مصطنع',client_name:'عميل مصطنع',period_start:'2026-08-01',period_end:'2026-08-31',
  digest:'b'.repeat(64),commentary:'',next_step:'',signed_name:null,signed_at:null,
  body:{sections:[{name:'الحملات',human:false,groups:[{title:'حملة مصطنعة',subtitle:'',figures:[{label:'مرات الظهور',type:'count',value:1000,source:'إدخال يدوي',as_of:'2026-08-31'}]}]}]}};

// الخمسة كما يناديها الخادم: اسم، ونداء بحالة تُمرَّر، ونداء بلا حالة إطلاقًا.
const DOCUMENTS=[
  {name:'الفاتورة الضريبية',with:flag=>invoicePrintable(invoice,flag),bare:()=>invoicePrintable(invoice)},
  {name:'قسيمة الراتب',with:flag=>payslipPrintable(slip,employee,flag),bare:()=>payslipPrintable(slip,employee)},
  {name:'خطاب الموارد البشرية',with:flag=>letterPrintable(letter,flag),bare:()=>letterPrintable(letter)},
  {name:'ورقة الاستدعاء',with:flag=>callSheetPrintable(callSheet,flag),bare:()=>callSheetPrintable(callSheet)},
  {name:'تقرير العميل',with:flag=>clientReportPrintable(clientReport,flag),bare:()=>clientReportPrintable(clientReport)}
];

test('FOOTER: المستندات الخمسة تطبع التحذير ما دامت البيانات مصطنعة، ولا تطبعه بعد أن تصير بيانات الشركة',()=>{
  for(const doc of DOCUMENTS){
    const synthetic=doc.with(SYNTHETIC),real=doc.with(REAL);
    assert.ok(synthetic.includes(WARNING),`${doc.name}: التحذير يجب أن يُطبع عند demo_data=1`);
    assert.ok(!real.includes(WARNING),`${doc.name}: التحذير يجب أن يسقط عند demo_data=0`);
    // وما بقي في الحالتين: تعليمة الحفظ واسم المنصة — ولا شيء يدّعي أن المستند موثّق أو أن بياناته صحيحة.
    assert.ok(synthetic.includes(PRINT)&&real.includes(PRINT),`${doc.name}: تعليمة الطباعة تبقى في الحالتين`);
    assert.ok(real.includes('من منصة 3,6T.'),`${doc.name}: يبقى اسم المنصة وحده`);
    assert.ok(!/موثّق|مصدّق|صحيح|معتمد من الجهة/.test(real.split('<footer>')[1]??''),`${doc.name}: الذيل لا يدّعي توثيقًا`);
  }
});

test('FOOTER: النداء بلا حالة يبقى على التحذير — الافتراض في الاتجاه الحذر لا في اتجاه الراحة',()=>{
  for(const doc of DOCUMENTS)assert.ok(doc.bare().includes(WARNING),`${doc.name}: موضع نداء لم يمرر الحقيقة يجب أن يبقى يطبع التحذير`);
  // وكل قيمة ليست صفرًا عددًا تُقرأ مصطنعة: ‎Number(null)‎ صفر، فلو حُوِّلت القيمة لأسقط الغيابُ التحذيرَ.
  for(const value of [undefined,null,'',{},'0',2,false])assert.ok(stillSynthetic(value),`${JSON.stringify(value)??'undefined'}: لا تُقرأ إقرارًا`);
  assert.ok(!stillSynthetic(0),'الصفر عددًا وحده هو الإقرار');
  assert.equal(documentFooter(SYNTHETIC),documentFooter(),'النص الافتراضي هو نص الحالة المصطنعة بحرفه');
});

test('FOOTER: لا نسخة ثانية من الجملة في الشيفرة، وكل موضع نداء في الخادم يمرر الحقيقة',()=>{
  // العطب كان أربع نسخ من الجملة لا تقرأ شيئًا. مصدرها الآن واحد، وعودة أي نسخة أخرى تُسقط هذا الاختبار.
  for(const path of ['app/print-documents.mjs','app/letters.mjs','app/production.mjs','app/client-reports.mjs'])
    assert.ok(!source(path).includes(WARNING),`${path}: الجملة تُبنى من tenants.demo_data ولا تُكتب بحرفها`);
  const server=source('app/server.mjs').split('\n');
  for(const name of ['invoicePrintable','payslipPrintable','letterPrintable','callSheetPrintable','clientReportPrintable']){
    const calls=server.filter(line=>new RegExp(`\\b${name}\\(`).test(line)&&!line.trimStart().startsWith('//'));
    assert.ok(calls.length,`${name}: لا موضع نداء في الخادم`);
    for(const line of calls)assert.ok(/demoData|tenantDemoFlag/.test(line),`${name}: موضع نداء لا يمرر الحقيقة المقروءة من القاعدة — ${line.trim().slice(0,80)}`);
  }
});

/* ───── الباب ───── */
const BASIS='انتقلت الشركة إلى المنصة وصارت سجلاتها هي السجلات المعتمدة';
function setup(){const db=openDb(':memory:');seed(db,'synthetic-tenant-identity');return db;}
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const thrown=(run,what)=>{try{run();}catch(error){return error;}return assert.fail(`${what}: كان يجب أن يُرفض`);};
const flag=db=>db.prepare("SELECT demo_data FROM tenants WHERE id='36t'").get().demo_data;

test('TENANT: الكيان يبدأ مصطنعًا، ويقرؤه الخادم من القاعدة لا من اسم الكيان',()=>{
  const db=setup();
  try{
    assert.equal(tenantDemoFlag(db,'36t'),SYNTHETIC);
    assert.equal(tenantIdentity(db,'36t').synthetic,true);
    // كيان لا صف له يُقرأ مصطنعًا: الغياب ليس إقرارًا.
    assert.equal(tenantIdentity(db,'لا-كيان').synthetic,true);
  }finally{db.close();}
});

test('TENANT: الأدمن الأول وحده يقرّ، وغيره يأخذ رفضًا يسمّي صاحب القرار',()=>{
  const db=setup();
  try{
    for(const id of ['employee','manager','hr']){
      const error=thrown(()=>transaction(db,()=>declareTenantData(db,user(db,id),{demo_data:REAL,basis:BASIS})),id);
      assert.equal(error.status,403);assert.equal(error.code,'forbidden');
      assert.equal(error.details.refusal.missing[0].owner,'مالك المنصة','الرفض يسمّي من يملك القرار');
      assert.ok(error.details.refusal.next.length>10,'ويقول الخطوة التالية');
    }
    assert.equal(flag(db),SYNTHETIC,'لا رفض يغيّر شيئًا');
    assert.equal(tenantDataView(db,user(db,'employee')),null,'ومن لا يملك القرار لا يرى بابه');
    assert.ok(tenantDataView(db,user(db,'admin')),'ويراه الأدمن الأول');
  }finally{db.close();}
});

test('TENANT: الإقرار يحتاج معاملة وسندًا مكتوبًا، ولا يقبل قيمة ثالثة',()=>{
  const db=setup();
  try{
    const admin=user(db,'admin');
    assert.throws(()=>declareTenantData(db,admin,{demo_data:REAL,basis:BASIS}),e=>e.status===500&&e.code==='transaction_required');
    assert.throws(()=>transaction(db,()=>declareTenantData(db,admin,{demo_data:REAL,basis:'قصير'})),e=>e.status===400);
    assert.throws(()=>transaction(db,()=>declareTenantData(db,admin,{demo_data:2,basis:BASIS})),e=>e.status===400);
    assert.throws(()=>transaction(db,()=>declareTenantData(db,admin,{demo_data:REAL})),e=>e.status===400);
    assert.throws(()=>transaction(db,()=>declareTenantData(db,admin,{demo_data:SYNTHETIC,basis:BASIS})),e=>e.status===409&&e.code==='no_change');
    assert.equal(flag(db),SYNTHETIC);
  }finally{db.close();}
});

test('TENANT: إقرار المالك يطفئ الوسم ويكتب سطر تدقيق يحمل ما كان وما صار، فيتغير ذيل المستندات',()=>{
  const db=setup();
  try{
    const admin=user(db,'admin');
    const before=invoicePrintable(invoice,tenantDemoFlag(db,'36t'));
    assert.ok(before.includes(WARNING));
    const view=transaction(db,()=>declareTenantData(db,admin,{demo_data:REAL,basis:BASIS}));
    assert.equal(flag(db),REAL);
    assert.equal(view.synthetic,false);
    const row=db.prepare("SELECT * FROM audit_events WHERE action='tenant.demo_data' ORDER BY seq DESC LIMIT 1").get();
    assert.ok(row,'سطر تدقيق واحد على الأقل');
    assert.equal(row.actor_id,'admin');assert.equal(row.entity_type,'tenant');assert.equal(row.entity_id,'36t');
    assert.deepEqual(JSON.parse(row.before_json),{demo_data:SYNTHETIC});
    assert.deepEqual(JSON.parse(row.after_json),{demo_data:REAL});
    assert.equal(row.reason,BASIS,'السند يُحفظ كما كُتب');
    assert.equal(view.last.by_name,admin.name,'واللوحة تعرض من أقرّ وبأي سند');
    const after=invoicePrintable(invoice,tenantDemoFlag(db,'36t'));
    assert.ok(!after.includes(WARNING),'والمستند بعدها لا يصف نفسه بأنه تجريبي');
    // والرجوع ممكن بالباب نفسه وبسند آخر.
    transaction(db,()=>declareTenantData(db,admin,{demo_data:SYNTHETIC,basis:'رجعت البيانات إلى التجريب قبل الإطلاق الحقيقي'}));
    assert.equal(flag(db),SYNTHETIC);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='tenant.demo_data'").get().n,2);
  }finally{db.close();}
});

test('TENANT: القادح في القاعدة يرفض أي قيمة غير صفر وواحد، فلا يمر من تحت الباب شيء',()=>{
  const db=setup();
  try{
    assert.throws(()=>db.prepare("UPDATE tenants SET demo_data=2 WHERE id='36t'").run(),/demo_data/);
    assert.throws(()=>db.prepare("UPDATE tenants SET demo_data=-1 WHERE id='36t'").run(),/demo_data/);
    assert.equal(flag(db),SYNTHETIC);
    db.prepare("UPDATE tenants SET demo_data=0 WHERE id='36t'").run();
    assert.equal(flag(db),REAL,'والقيمتان المسموحتان تمران');
  }finally{db.close();}
});
