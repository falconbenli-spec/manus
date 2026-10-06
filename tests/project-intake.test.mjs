import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient } from '../app/agency.mjs';
import { createProject, createTask } from '../app/projects.mjs';
import { applyTemplate, createTemplate } from '../app/agency.mjs';
import { deriveClearance } from '../app/lifecycle.mjs';
import { createHandover, handoverAction, approveReceipt, provideDocument, startExecution, executionGate,
  recordKickoff, confirmRounds, recordRound, raiseChange, changeAction, setGateReading,
  prepareClassificationPolicy, decideClassificationPolicy, intakeBoard, DOCUMENTS } from '../app/project-intake.mjs';
import { installCatalogue, formsBoard, createInstance } from '../app/forms.mjs';
import { pinClock } from './riyadh-clock.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-intake');t.after(()=>db.close());
  const add=(uid,name,role)=>db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES(?,'36t','creative',?,?,'unused',?,'manager')").run(uid,uid,name,role);
  add('pm1','مديرة المشروع المسندة','pm');
  add('fin','محاسبة المالية','employee');
  add('other','موظف آخر في الفريق','employee');
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'fin',capability:'finance.use',note:'تسجيل الوثائق المالية في اختبار الاستلام'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'intake.policy.approve',note:'مالك إجراء سلسلة الاستلام'}));
  // رؤية المبالغ تأتي من تفويض الدفتر المالي المؤرخ، لا من تصريح الشاشة: الاثنان منفصلان عمدًا في المنصة.
  db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t','fin','employee','read','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض قراءة مالية مصطنع',null,new Date().toISOString());
  return {db,users,tx};
}
// assert.throws لا يعيد الخطأ؛ وهذه الاختبارات تتحقق من نص الرفض نفسه لا من رمزه فقط.
function thrown(fn,expected){
  try{fn();}catch(error){assert.equal(error.code,expected);return error;}
  assert.fail(`expected ${expected}`);
}

const handoverInput=(projectId,clientId,extra={})=>({
  project_id:projectId,client_id:clientId,
  contract_reference:'العقد المصطنع رقم 2026/14',contract_signed_on:addDays(today(),-10),
  kickoff_planned_on:addDays(today(),3),channels:'البريد الرسمي وقناة المشروع',
  contract_value:'100000.00',advance:'30000.00',advance_claimed_on:addDays(today(),-4),
  project_manager_id:'pm1',
  services:['إدارة محتوى شهرية','تصميم هوية حملة'],
  deliverables:[
    {name:'هوية الحملة',unit:'ملف',quantity:1,acceptance:'اعتماد العميل الكتابي للهوية',revision_rounds:3,rounds_source:'contract',rounds_basis:'البند 6 من العقد المصطنع'},
    {name:'منشور مصمم',unit:'منشور',quantity:12,acceptance:'مطابقة الموجز ودليل الهوية',revision_rounds:2,rounds_source:'template_default',rounds_basis:''}
  ],
  timeline_start:today(),timeline_end:addDays(today(),90),
  milestones:[{name:'تسليم الهوية',due_on:addDays(today(),20)},{name:'إطلاق المحتوى',due_on:addDays(today(),45)}],
  client_contacts:[{name:'ممثلة العميل',title:'مديرة التسويق',email:'m@client.invalid',phone:'',is_primary:true},
    {name:'منسق العميل',title:'أخصائي',email:'',phone:'',is_primary:false}],
  risks:'تأخر مواد العميل',special_requirements:'لا نشر قبل موافقة كتابية',
  payment_terms:[
    {label:'دفعة مقدمة',amount:'30000.00',due_on:addDays(today(),-4),condition:'عند توقيع العقد',term_status:'received',notes:'',is_advance:true},
    {label:'عند تسليم الهوية',amount:'40000.00',due_on:addDays(today(),20),condition:'عند اعتماد العميل للهوية',term_status:'planned',notes:'',is_advance:false},
    {label:'عند الإقفال',amount:'30000.00',due_on:addDays(today(),90),condition:'عند قبول آخر مخرج',term_status:'planned',notes:'',is_advance:false}
  ],...extra});

// يبني المشروع والعميل ومحضر التسليم المعتمد من طرفيه، ويعيد سجل استلام PM-01 بقائمة وثائقه الثماني.
function received(db,users,tx,extra={}){
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل المصطنعة للاستلام',trade_name:'عميل الاستلام',sector:'تجزئة',status:'active'})).id;
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع الاستلام المصطنع',brief:'اختبار سلسلة استلام المشروع',member_ids:['pm1','fin','other']}));
  const handoverId=tx(()=>createHandover(db,users.manager,handoverInput(project.id,clientId,extra))).id;
  const hv=()=>db.prepare('SELECT version FROM project_handovers WHERE id=?').get(handoverId).version;
  tx(()=>handoverAction(db,users.manager,handoverId,'approve_handover',{version:hv(),statement:'أقرّ أن ما في المحضر هو ما تعاقدنا عليه'}));
  tx(()=>handoverAction(db,users.pm1,handoverId,'approve_handover',{version:hv(),statement:'أقرّ استلامي للمحضر ومراجعتي لبنوده'}));
  const receiptId=tx(()=>handoverAction(db,users.pm1,handoverId,'receive_handover',{version:hv(),note:'استلمت المحضر وبقيت الوثائق المطلوبة'})).id;
  return {clientId,project,handoverId,receiptId,
    hv,rv:()=>db.prepare('SELECT version FROM project_receipts WHERE id=?').get(receiptId).version,
    dv:key=>db.prepare('SELECT version FROM receipt_documents WHERE receipt_id=? AND doc_key=?').get(receiptId,key).version,
    deliverable:name=>db.prepare('SELECT * FROM project_deliverables WHERE handover_id=? AND name=?').get(handoverId,name)};
}
// ورقة تسعير معتمدة لهذا العميل (ترحيل 108 + الربط في 113): «ملف التسعير المعتمد ماليًا» صار مفتاحًا
// أجنبيًا إلى ورقة معتمدة، لا مرجعًا نصيًا. الصفوف تُدرج مباشرة هنا لأن بناء الورقة من مسارها يخص اختبارات التسعير.
function approvedPricingSheetFor(db,clientId,{status='approved',code='PR-INTAKE-1'}={}){
  const policy=(key,value)=>{const pid=`policy-${key}-${code}`;
    db.prepare(`INSERT INTO pricing_policies(id,tenant_id,policy_key,revision,value_unit,value_raw,source_reference,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at,updated_at)
      VALUES(?,'36t',?,1,'percent',?,'MOD-BD-02 — الإجماليات في نموذج تسعير المشروع','سند مصطنع لاختبار الربط بين الاستلام والتسعير','2026-01-01','approved','manager','pm1',?,?,?)`)
      .run(pid,key,value,now(),now(),now());
    return pid;};
  const has=db.prepare("SELECT id FROM pricing_policies WHERE tenant_id='36t' AND policy_key=? AND status='approved'");
  const contingency=has.get('contingency_rate')?.id??policy('contingency_rate',1000);
  const margin=has.get('target_margin')?.id??policy('target_margin',2000);
  const sheetId=`sheet-${code}`;
  // تُدرج «مقدَّمة» أولًا لأن مقاعد الاعتماد لا تُملأ إلا على ورقة معروضة (مُشغِّل ترحيل 108)، ثم تُقرَّر.
  db.prepare(`INSERT INTO pricing_sheets(id,tenant_id,client_id,code,name,scope_note,contract_kind,duration_note,quoted_on,rates_on,
      contingency_rate_bp,contingency_policy_id,target_margin_bp,target_margin_policy_id,vat_rate_bp,vat_basis,status,approval_round,prepared_by,submitted_at,created_at,updated_at)
    VALUES(?,'36t',?,?,'ورقة تسعير مصطنعة للاستلام','نطاق مصطنع لاختبار ربط الاستلام بالتسعير','one_off','ثلاثة أشهر','2026-09-01','2026-09-01',
      1000,?,2000,?,1500,'نسبة الضريبة من سجل المنشأة','submitted',1,'manager',?,?,?)`)
    .run(sheetId,clientId,code,contingency,margin,now(),now(),now());
  for(const [seat,who] of [['requesting_department','pm1'],['procurement_finance','fin'],['epmo','other']])
    db.prepare(`INSERT INTO pricing_sheet_approvals(id,sheet_id,approval_round,seat,decision,capability,note,decided_by,decided_at)
      VALUES(?,?,1,?,'approved','مصطنع','اعتماد مقعد مصطنع لاختبار الربط',?,?)`).run(`seat-${code}-${seat}`,sheetId,seat,who,now());
  if(status==='approved')db.prepare("UPDATE pricing_sheets SET status='approved',decided_at=?,version=version+1,updated_at=? WHERE id=?").run(now(),now(),sheetId);
  return sheetId;
}

// قبض دفعة مقدمة مؤكَّد: فاتورة يسجلها شخص ويؤكد قبضها آخر (قيد CHECK في ترحيل 051).
function payAdvance(db,r,amount){
  const minor=Math.round(Number(amount)*100),id=`advance-${r.receiptId}`;
  if(db.prepare('SELECT 1 FROM advance_invoices WHERE id=?').get(id))return;
  db.prepare(`INSERT INTO advance_invoices(id,tenant_id,client_id,project_id,description,agreement_reference,currency,amount_minor,
      paid_minor,received_on,status,recorded_by,confirmed_by,confirmed_at,created_at,updated_at)
    VALUES(?,'36t',?,?,'دفعة مقدمة مصطنعة','مرجع اتفاق مصطنع للاختبار','SAR',?,?,?,'paid','manager','fin',?,?,?)`)
    .run(id,r.clientId,r.project.id,minor,minor,addDays(today(),-3),now(),now(),now());
}

// كل وثيقة إلزامية عدا ما يُستثنى، مع اعتماد المحضر من طرفيه وتأكيد المالية للدفعة.
function completeChecklist(db,users,tx,r,{skip=[],advance='30000.00'}={}){
  for(const doc of DOCUMENTS){
    if(!doc.required||skip.includes(doc.key))continue;
    const who=doc.owner_role==='finance'?users.fin:doc.owner_role==='project_manager'?users.pm1:users.manager;
    // الدفعة المقدمة صارت تُقرأ من قبض مؤكَّد (advance_invoices.status='paid') لا من مبلغ يُكتب:
    // تسوية يدوية عند دمج 109 مع 116. الفاتورة تُسجَّل ويؤكدها شخص آخر، ثم تُسجَّل الوثيقة بلا رقم.
    if(doc.key==='advance_confirmation'&&advance!==null)payAdvance(db,r,advance);
    const extra={};
    if(doc.key==='approved_pricing'){
      const sheetId=r.pricingSheetId??(r.pricingSheetId=approvedPricingSheetFor(db,r.clientId));
      tx(()=>provideDocument(db,who,r.receiptId,{doc_key:doc.key,version:r.dv(doc.key),pricing_sheet_id:sheetId}));
      continue;
    }
    tx(()=>provideDocument(db,who,r.receiptId,{doc_key:doc.key,version:r.dv(doc.key),reference:`مرجع ${doc.name} المصطنع`,...extra}));
  }
  if(!skip.includes('receipt_approval')){
    tx(()=>approveReceipt(db,users.manager,r.receiptId,{version:r.rv(),statement:'أقرّ بصفتي المُسلِّم صحة ما في المحضر'}));
    tx(()=>approveReceipt(db,users.pm1,r.receiptId,{version:r.rv(),statement:'أقرّ بصفتي المُستلِم استلام المشروع ووثائقه'}));
  }
}

test('PM-01: the gate blocks paid execution until the advance is confirmed, and never blocks scoping',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);

  // قبل أي وثيقة: التنفيذ المدفوع ممنوع، والتحديد والدراسة مسموحان. القراءتان من المصدر نفسه معروضتان.
  const blocked=executionGate(db,users.pm1,r.project.id,'paid_execution');
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.blocked,true);
  assert.equal(blocked.reading,'block_paid_execution','the safer reading is the default when nobody has decided');
  assert.equal(blocked.conflict.readings.length,2,'both readings of the source stay visible');
  assert.ok(blocked.conflict.unresolved.length>10,'the conflict is surfaced, not silently resolved');

  const scoping=executionGate(db,users.pm1,r.project.id,'scoping');
  assert.equal(scoping.allowed,true,'pre-sale scoping is not blocked by PM-01');
  assert.equal(scoping.refusals.length,0);
  assert.ok(scoping.advisory.length>0,'what is still missing is shown to the scoping reader, it just does not block');

  // كل الوثائق حاضرة والمحضر معتمد، إلا تأكيد المالية للدفعة: البوابة ما زالت مغلقة، والرفض يسمي المالية.
  completeChecklist(db,users,tx,r,{skip:['advance_confirmation']});
  const noAdvance=executionGate(db,users.pm1,r.project.id,'paid_execution');
  assert.equal(noAdvance.blocked,true);
  assert.deepEqual(noAdvance.refusals.map(x=>x.doc_key),['advance_confirmation']);
  assert.equal(noAdvance.refusals[0].owner,'محاسبة المالية','the refusal names who must provide it');
  assert.throws(()=>tx(()=>startExecution(db,users.pm1,r.receiptId,{version:r.rv(),basis:'محاولة بدء بلا دفعة مؤكدة'})),code('execution_blocked'));
  assert.equal(executionGate(db,users.pm1,r.project.id,'scoping').allowed,true,'scoping still passes while payment is pending');

  // تأكيد ناقص ليس تأكيدًا: المقبوض المؤكد أقل من المتفق عليه يبقي البوابة مغلقة ويقول كم نقص.
  // والمبلغ لا يُكتب في الخانة: يُقرأ من قبض مؤكَّد (advance_invoices.status='paid').
  assert.throws(()=>tx(()=>provideDocument(db,users.fin,r.receiptId,{doc_key:'advance_confirmation',
    version:r.dv('advance_confirmation'),reference:'إشعار بنكي مصطنع 88',amount:'10000.00',
    confirmed_on:addDays(today(),-3)})),code('invalid_fields'),'the amount is never typed into this box');
  assert.throws(()=>tx(()=>provideDocument(db,users.fin,r.receiptId,{doc_key:'advance_confirmation',
    version:r.dv('advance_confirmation'),reference:'إشعار بنكي مصطنع 88'})),code('advance_not_confirmed'),
    'and without a confirmed receipt there is nothing to record');
  payAdvance(db,r,'100.00');
  tx(()=>provideDocument(db,users.fin,r.receiptId,{doc_key:'advance_confirmation',version:r.dv('advance_confirmation'),
    reference:'إشعار بنكي مصطنع 88'}));
  const short=executionGate(db,users.pm1,r.project.id,'paid_execution');
  assert.equal(short.blocked,true);
  assert.deepEqual(short.refusals.map(x=>x.code),['advance_short']);
  assert.ok(short.refusals[0].why.includes('30000.00'),'the refusal states the agreed amount, not just "incomplete"');
  assert.ok(short.advance.source.includes('advance_invoices'),'the gate says where the confirmed figure came from');
  assert.equal(short.advance.confirmed_minor,10000,'read from the confirmed receipt, not from a typed number');
  assert.ok(verifyAudit(db));
});

test('PM-01: each missing document refuses by name and says who must provide it',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  const gate=executionGate(db,users.pm1,r.project.id,'paid_execution');
  const required=DOCUMENTS.filter(d=>d.required);

  // الوثيقة المشروطة وحدها لا تمنع؛ والسبع الإلزامية تمنع كل واحدة باسمها.
  assert.equal(required.length,7);
  assert.ok(!gate.refusals.some(x=>x.doc_key==='kickoff_minutes'),'"kickoff minutes if any" is the only conditional document');
  for(const doc of required){
    const refusal=gate.refusals.find(x=>x.doc_key===doc.key);
    assert.ok(refusal,`${doc.key} refuses by name`);
    assert.equal(refusal.document,doc.name);
    assert.ok(refusal.owner.length>2,`${doc.key} names a person or a role, never nobody`);
  }
  assert.deepEqual([...new Set(gate.refusals.filter(x=>x.doc_key).map(x=>x.owner_role))].sort(),
    ['account_manager','business_development','finance','project_manager'].sort());
  // «وتوقيع المحضر» كان شرطًا ثالثًا في البوابة، ومصدره نقلُ الملحق لا ملف الشركة الأصلي.
  // المرجع: docs/product/workflow/APPENDIX-VS-ORIGINAL.md — القيمة المقروءة من الملف الأصلي تسبق نقل الملحق.
  // النموذج الأصلي يشترط التحقق من استلام الدفعة المقدمة وحدها، فسقط الشرط من البوابة (تسوية يدوية عند الدمج).
  // الاعتماد الإلكتروني من الطرفين باقٍ سجلًا وإجراءً في شاشة الاستلام؛ ما سقط هو أن يمنع التنفيذ.
  assert.deepEqual(gate.refusals.filter(x=>x.code==='receipt_unapproved'),[],
    'the minutes-signature condition is not in the company form, so it does not block execution');

  // الوثيقة المالية لا يعلن عنها مدير المشروع نيابةً عن المالية.
  assert.throws(()=>tx(()=>provideDocument(db,users.pm1,r.receiptId,{doc_key:'approved_pricing',version:r.dv('approved_pricing'),reference:'ادعاء اعتماد مالي'})),code('not_permitted'));
  // وغير الطرفين لا يعتمد المحضر.
  assert.throws(()=>tx(()=>approveReceipt(db,users.other,r.receiptId,{version:r.rv(),statement:'اعتماد من غير طرف'})),code('not_a_party'));

  completeChecklist(db,users,tx,r);
  const open=executionGate(db,users.pm1,r.project.id,'paid_execution');
  assert.deepEqual(open.refusals,[]);
  assert.equal(open.allowed,true);
  assert.equal(open.advance.confirmed_minor,3000000);
  tx(()=>startExecution(db,users.pm1,r.receiptId,{version:r.rv(),basis:'اكتملت الوثائق وتأكدت الدفعة واعتُمد المحضر'}));
  assert.equal(db.prepare('SELECT status FROM project_receipts WHERE id=?').get(r.receiptId).status,'executing');
  assert.ok(verifyAudit(db));
});

test('PM-01 gate guards project execution itself: tasks and templates refuse by document name, and the second reading only warns',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  // إسناد مهمة على مشروع مستلَم تنفيذٌ مدفوع، فيُرفض بالاسم لا برسالة عامة. والمُسنِد مدير المشروع المسجَّل: المستلم (pm1) بعد محضر الاستلام.
  const task={title:'تنفيذ الهوية',assignee_id:'pm1',due_date:addDays(today(),10),acceptance:'ملف الهوية معتمد'};
  const error=thrown(()=>tx(()=>createTask(db,users.pm1,r.project.id,task)),'execution_blocked');
  assert.ok(error.message.includes('العقد الموقع من الطرفين'),'the refusal names a missing document');
  assert.ok(error.message.includes('التحديد والدراسة غير ممنوعين'),'and says what is still allowed');
  const templateId=tx(()=>createTemplate(db,users.manager,{name:'قالب تنفيذ',service_kind:'هوية',
    phases:[{name:'التنفيذ',tasks:[{title:'تصميم',offset_days:2,acceptance:'مسودة أولى'}]}]})).id;
  assert.throws(()=>tx(()=>applyTemplate(db,users.pm1,templateId,{project_id:r.project.id,start_date:today(),assignee_id:'pm1'})),code('execution_blocked'));

  // القراءة الثانية من المخطط: النقص يُعرض ولا يمنع، وما كان ناقصًا وقت البدء يبقى مسجلًا.
  tx(()=>setGateReading(db,users.manager,{gate_reading:'documents_advisory',
    basis:'مالك الإجراء رجّح ترتيب المخطط في اختبار مصطنع بتاريخ اليوم',confirmed_on:today()}));
  const advisory=executionGate(db,users.pm1,r.project.id,'paid_execution');
  assert.equal(advisory.allowed,true);
  assert.equal(advisory.blocked,false);
  assert.ok(advisory.advisory.length>=7,'nothing is hidden: the missing list is still there, it just does not block');
  const started=tx(()=>startExecution(db,users.pm1,r.receiptId,{version:r.rv(),basis:'بدء بقراءة المخطط الإرشادية في اختبار مصطنع'}));
  assert.ok(started.started_with_missing.includes('العقد الموقع من الطرفين'),'starting under the advisory reading records what was missing');
  tx(()=>createTask(db,users.pm1,r.project.id,task));

  // العودة إلى القراءة المانعة تعيد المنع، ولا تمحو ما سُجِّل.
  tx(()=>setGateReading(db,users.manager,{gate_reading:'block_paid_execution',basis:'رجوع مالك الإجراء عن القراءة الإرشادية في الاختبار',confirmed_on:today()}));
  assert.equal(executionGate(db,users.pm1,r.project.id,'paid_execution').blocked,true);
  assert.ok(verifyAudit(db));
});

test('PM-02: kickoff minutes record attendance, the agreed scope and every policy the source lists, and fill their own checklist row',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  const minutes={held_on:today(),mode:'hybrid',client_contact_name:'ممثلة العميل',
    attendees:[{side:'company',user_id:'pm1',name:'',title:'مديرة المشروع',organisation:'',attended:true},
      {side:'company',user_id:'manager',name:'',title:'مدير تطوير الأعمال',organisation:'',attended:true},
      {side:'client',user_id:'',name:'ممثلة العميل',title:'مديرة التسويق',organisation:'عميل الاستلام',attended:true}],
    agreed_scope:'إدارة محتوى شهرية وهوية حملة واحدة كما في العقد',
    deliverables_note:'هوية الحملة واثنا عشر منشورًا مصممًا',
    milestones:[{name:'تسليم الهوية',due_on:addDays(today(),20)}],
    revision_rounds_note:'ثلاث جولات للهوية وجولتان لكل منشور كما في العقد',
    recurring_meetings:'اجتماع أسبوعي كل يوم اثنين',
    approval_policy:'الاعتماد كتابي من جهة التواصل الرئيسية وحدها',
    client_response_days:3,official_channel:'البريد الرسمي للمشروع',
    special_constraints:'لا تصوير خارجي',
    revision_policy:'التعديلات داخل النطاق ضمن الجولات، وما زاد يُسعَّر بطلب تغيير',
    written_changes_only:true,
    delay_policy:'تأخر مواد العميل يزيح المواعيد بالمدة نفسها',
    publication_policy:'لا نشر قبل الموافقة الكتابية على المخرج',
    cancellation_policy:'الإلغاء وغراماته حسب بنود العقد',
    client_acknowledgement:'أكدت ممثلة العميل المحضر بالبريد المحفوظ في ملف المشروع'};

  assert.throws(()=>tx(()=>recordKickoff(db,users.other,r.receiptId,minutes)),code('not_permitted'));
  assert.throws(()=>tx(()=>recordKickoff(db,users.pm1,r.receiptId,{...minutes,written_changes_only:undefined})),code('written_changes_only'),
    'the "changes in writing only" point is acknowledged explicitly, never assumed');
  assert.throws(()=>tx(()=>recordKickoff(db,users.pm1,r.receiptId,{...minutes,attendees:minutes.attendees.filter(a=>a.side==='company')})),code('attendees'));
  assert.throws(()=>tx(()=>recordKickoff(db,users.pm1,r.receiptId,{...minutes,attendees:[...minutes.attendees.slice(0,2),{side:'client',user_id:'other',name:'اسم',title:'',organisation:'جهة',attended:true}]})),code('attendees'),
    'the client has no account in the platform');

  tx(()=>recordKickoff(db,users.pm1,r.receiptId,minutes));
  assert.throws(()=>tx(()=>recordKickoff(db,users.pm1,r.receiptId,minutes)),code('kickoff_exists'));
  const board=intakeBoard(db,users.pm1),receipt=board.receipts[0];
  assert.equal(receipt.kickoff.mode_name,'هجين');
  assert.equal(receipt.kickoff.client_response_days,3);
  assert.equal(receipt.kickoff.written_changes_only,1);
  // الحاضر من جهة الشركة يأتي اسمه ودوره من دليل المنصة لا من نص يكتبه أحد.
  const company=receipt.kickoff.attendees.filter(a=>a.side==='company');
  assert.deepEqual(company.map(a=>a.name).sort(),['مدير الفريق التجريبي','مديرة المشروع المسندة']);
  assert.deepEqual(company.map(a=>a.role_name).sort(),['مدير','مدير مشروع']);
  assert.equal(receipt.kickoff.attendees.find(a=>a.side==='client').organisation,'عميل الاستلام');
  // الاعتماد الإلكتروني بدل التوقيع: اسم ودور ووقت. ولا طباعة ولا صورة توقيع.
  assert.ok(receipt.kickoff.recorded_label.startsWith('اعتمد: مديرة المشروع المسندة · مدير مشروع · '));
  // المحضر هو البند الثالث في قائمة PM-01، فيُملأ من مصدره.
  assert.equal(receipt.documents.find(d=>d.doc_key==='kickoff_minutes').status,'present');
  assert.throws(()=>db.prepare('UPDATE project_kickoffs SET agreed_scope=? WHERE id=?').run('نطاق آخر',receipt.kickoff.id),/record of what was said/);
  assert.ok(verifyAudit(db));
});

test('revision rounds are counted per deliverable from its own contract line, and the template default is not a company policy',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  completeChecklist(db,users,tx,r);
  const identity=r.deliverable('هوية الحملة'),post=r.deliverable('منشور مصمم');
  const round=(deliverable,reference,extra={})=>tx(()=>recordRound(db,users.pm1,deliverable.id,{item_reference:reference,note:'',...extra}));

  // ثلاث جولات للهوية من بند العقد، والعدّ لهذا المخرج وحده.
  assert.deepEqual([1,2,3].map(n=>round(identity,`نسخة الهوية ${n}`)).map(x=>[x.round_number,x.kind]),[[1,'included'],[2,'included'],[3,'included']]);
  assert.equal(round(post,'منشور 1 نسخة أولى').round_number,1,'the other deliverable starts its own count at one');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliverable_rounds WHERE deliverable_id=?').get(identity.id).n,3);

  // الجولة الرابعة على الهوية تتجاوز العقد: لا تُسجَّل بلا طلب تغيير مطبَّق. هذا منع العمل الإضافي الصامت.
  const error=thrown(()=>round(identity,'نسخة الهوية 4'),'extra_round_requires_change');
  assert.ok(error.message.includes('(3)'),'the refusal states how many rounds the contract gave');

  // «منشور مصمم» رقمه افتراضي قالب (DS-03) لم يؤكده أحد: لا يُبنى عليه استنفاد ولا جولة إضافية.
  round(post,'منشور 1 نسخة ثانية');
  assert.throws(()=>round(post,'منشور 1 نسخة ثالثة'),code('rounds_unconfirmed'));
  const boardBefore=intakeBoard(db,users.pm1).handovers[0].deliverables.find(d=>d.name==='منشور مصمم');
  assert.equal(boardBefore.rounds_confirmed,false);
  assert.ok(boardBefore.rounds_note.includes('DS-03'),'the board names where the default number came from');

  // التأكيد من العقد يصحّح الرقم ويحمل سنده، ولا يُثبَّت على أقل مما سُجِّل فعلًا.
  const pv=()=>db.prepare('SELECT version FROM project_deliverables WHERE id=?').get(post.id).version;
  assert.throws(()=>tx(()=>confirmRounds(db,users.pm1,post.id,{version:pv(),revision_rounds:1,basis:'بند 7'})),code('rounds_already_used'));
  assert.throws(()=>tx(()=>confirmRounds(db,users.other,post.id,{version:pv(),revision_rounds:3,basis:'البند 7 من العقد المصطنع'})),code('not_permitted'));
  tx(()=>confirmRounds(db,users.pm1,post.id,{version:pv(),revision_rounds:3,basis:'البند 7 من العقد المصطنع يعطي ثلاث جولات للمنشور'}));
  assert.equal(round(post,'منشور 1 نسخة ثالثة').kind,'included','after confirmation the third round is inside the contract');
  const confirmed=intakeBoard(db,users.pm1).handovers[0].deliverables.find(d=>d.name==='منشور مصمم');
  assert.deepEqual([confirmed.rounds_source,confirmed.used_rounds,confirmed.remaining_rounds,confirmed.exhausted],['contract',3,0,true]);
  assert.ok(verifyAudit(db));
});

test('PM-03: the four classifications hold, our own error is never charged to the client, and exhausted rounds raise a priced quotation',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  completeChecklist(db,users,tx,r);
  const identity=r.deliverable('هوية الحملة');
  for(const n of [1,2,3])tx(()=>recordRound(db,users.pm1,identity.id,{item_reference:`نسخة الهوية ${n}`,note:''}));
  const base={description:'العميل يطلب تعديل اتجاه الهوية بالكامل',reason:'تغيّر توجه الحملة لدى العميل',deliverable_id:identity.id};

  // خطؤنا لا يُسعَّر على العميل، لا آليًا ولا بإدخال يدوي.
  assert.throws(()=>tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,classification:'our_error',free_rounds_exhausted:true,extra_cost:'5000.00',quotation_reference:'عرض 9'})),code('no_charge_for_our_error'));
  const ourError=tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,description:'إعادة تصميم بسبب خطأ في مقاسات ملفنا',classification:'our_error',free_rounds_exhausted:true,schedule_impact_days:2}));
  assert.equal(ourError.classification,'our_error');
  assert.deepEqual(ourError.needs,{finance:false,client:false},'fixing our own error waits on nobody to pay for it');
  assert.deepEqual(ourError.will_reopen,[],'and invalidates no approval');

  // تغيير داخل النطاق لا يحمل سعرًا؛ والادعاء المخالف لسجل الجولات يُرد.
  assert.throws(()=>tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,classification:'in_scope',free_rounds_exhausted:true,extra_cost:'1000.00',quotation_reference:'عرض 4'})),code('in_scope_is_not_priced'));
  const mismatch=thrown(()=>tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,classification:'extra_round',free_rounds_exhausted:false,added_rounds:1,extra_cost:'4000.00',quotation_reference:'عرض 12'})),'rounds_mismatch');
  assert.ok(mismatch.message.includes('سُجلت 3 جولة من 3'),'the platform answers the "are free rounds exhausted" question from its own record');

  // استنفاد الجولات يرفع عرضًا مسعّرًا، لا عملًا صامتًا.
  assert.throws(()=>tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,classification:'extra_round',free_rounds_exhausted:true,added_rounds:1})),code('quotation_required'));
  assert.throws(()=>tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,classification:'extra_round',free_rounds_exhausted:true,added_rounds:1,extra_cost:'4000.00'})),code('quotation_reference'));
  const extra=tx(()=>raiseChange(db,users.pm1,r.receiptId,{...base,classification:'extra_round',free_rounds_exhausted:true,added_rounds:1,extra_cost:'4000.00',quotation_reference:'عرض الجولة الإضافية 12',schedule_impact_days:5}));
  assert.equal(extra.free_rounds_exhausted,true);
  assert.deepEqual(extra.needs,{finance:true,client:true});

  const cv=()=>db.prepare('SELECT version FROM project_change_requests WHERE id=?').get(extra.id).version;
  // الترتيب ليس تفصيلًا: لا موافقة عميل على سعر لم تعتمده المالية، ولا تطبيق قبلهما.
  assert.throws(()=>tx(()=>changeAction(db,users.pm1,extra.id,'record_client_approval',{version:cv(),reference:'موافقة مبكرة',approved_on:today()})),code('finance_first'));
  assert.throws(()=>tx(()=>changeAction(db,users.pm1,extra.id,'apply_change',{version:cv(),start_date:today(),note:'محاولة تطبيق قبل الاعتماد'})),code('finance_first'));
  assert.throws(()=>tx(()=>changeAction(db,users.pm1,extra.id,'decide_finance',{version:cv(),decision:'approved',note:'اعتماد ذاتي'})),code('not_permitted'));
  tx(()=>changeAction(db,users.fin,extra.id,'decide_finance',{version:cv(),decision:'approved',note:'السعر مطابق لبطاقة الأسعار المصطنعة'}));
  assert.throws(()=>tx(()=>changeAction(db,users.pm1,extra.id,'apply_change',{version:cv(),start_date:today(),note:'محاولة تطبيق بلا موافقة العميل'})),code('client_approval_first'));
  tx(()=>changeAction(db,users.pm1,extra.id,'record_client_approval',{version:cv(),reference:'وافقت ممثلة العميل بالبريد المحفوظ في ملف المشروع',approved_on:today()}));

  // الجولة الرابعة لا تُسجَّل إلا بعد تطبيق طلب التغيير، ثم تُسجَّل «إضافية» مربوطة به.
  assert.throws(()=>tx(()=>recordRound(db,users.pm1,identity.id,{item_reference:'نسخة الهوية 4',note:'',change_request_id:extra.id})),code('extra_round_requires_change'));
  tx(()=>changeAction(db,users.pm1,extra.id,'apply_change',{version:cv(),start_date:today(),note:'بدأ تنفيذ الجولة الإضافية المعتمدة'}));
  const fourth=tx(()=>recordRound(db,users.pm1,identity.id,{item_reference:'نسخة الهوية 4',note:'',change_request_id:extra.id}));
  assert.deepEqual([fourth.round_number,fourth.kind],[4,'included'],'the purchased round became part of the deliverable balance');
  assert.ok(verifyAudit(db));
});

test('PM-03: an applied change moves budget, schedule and the deliverable, and reopens only the approvals it touches',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  completeChecklist(db,users,tx,r);
  tx(()=>startExecution(db,users.pm1,r.receiptId,{version:r.rv(),basis:'اكتملت الوثائق وتأكدت الدفعة واعتُمد المحضر'}));
  const identity=r.deliverable('هوية الحملة');
  const before=intakeBoard(db,users.fin).handovers[0];
  assert.equal(before.contract_value_minor,10000000);
  assert.equal(before.effective_value_minor,10000000);

  const change=tx(()=>raiseChange(db,users.pm1,r.receiptId,{description:'إضافة مخرج ثانٍ للهوية بطلب العميل',reason:'توسعة نطاق الحملة إلى قناة جديدة',
    deliverable_id:identity.id,classification:'scope_change',free_rounds_exhausted:false,
    schedule_impact_days:14,extra_cost:'12000.00',quotation_reference:'عرض توسعة النطاق 21',added_rounds:1,added_quantity:1}));
  assert.deepEqual(change.will_reopen.sort(),['approved_pricing','creative_brief','signed_contract'].sort());
  const cv=()=>db.prepare('SELECT version FROM project_change_requests WHERE id=?').get(change.id).version;
  tx(()=>changeAction(db,users.fin,change.id,'decide_finance',{version:cv(),decision:'approved',note:'التسعير مراجع ومطابق'}));
  tx(()=>changeAction(db,users.pm1,change.id,'record_client_approval',{version:cv(),reference:'وافق العميل كتابةً على التوسعة، الدليل في ملف المشروع',approved_on:today()}));
  const applied=tx(()=>changeAction(db,users.pm1,change.id,'apply_change',{version:cv(),start_date:today(),note:'بدأ العمل على المخرج الإضافي'}));

  // الميزانية والجدول: القيمة السارية تُحسب من العقد وما طُبِّق عليه، ولا يُعاد كتابة العقد بصمت.
  const after=intakeBoard(db,users.fin).handovers[0];
  assert.equal(after.contract_value_minor,10000000,'the contract value on record is not silently rewritten');
  assert.equal(after.effective_value_minor,11200000);
  assert.equal(after.schedule_shift_days,14);
  assert.equal(after.effective_timeline_end,addDays(before.timeline_end,14));
  // المخرج: جولة وكمية مضافتان على المخرج المتأثر وحده.
  const moved=after.deliverables.find(d=>d.id===identity.id),untouched=after.deliverables.find(d=>d.name==='منشور مصمم');
  assert.deepEqual([moved.revision_rounds,moved.quantity],[4,2]);
  assert.deepEqual([untouched.revision_rounds,untouched.quantity],[2,12],'the deliverable the change did not name is untouched');

  // الاعتمادات: الثلاثة المتأثرة فقط أُعيد فتحها، وبقيتها كما هي.
  assert.deepEqual(applied.reopened_documents.sort(),['approved_pricing','creative_brief','signed_contract'].sort());
  const receipt=intakeBoard(db,users.pm1).receipts[0];
  // الوثيقة المُعاد فتحها تحمل سبب فتحها؛ و«محضر Kick-off إن وجد» لم يُسجَّل أصلًا في هذا المشروع فلم يُفتح شيء.
  assert.deepEqual(receipt.documents.filter(d=>d.reopened_reason).map(d=>d.doc_key).sort(),
    ['approved_pricing','creative_brief','signed_contract'].sort());
  assert.equal(receipt.documents.find(d=>d.doc_key==='kickoff_minutes').reopened_reason,'');
  assert.deepEqual(receipt.documents.filter(d=>d.status==='present').map(d=>d.doc_key).sort(),
    ['advance_confirmation','client_assets','client_contacts','payment_schedule'].sort(),
    'the advance, the contacts, the assets and the payment schedule keep their approval');
  assert.ok(receipt.documents.find(d=>d.doc_key==='approved_pricing').reopened_reason.includes('تغيّرت القيمة'));
  // التنفيذ يعود ممنوعًا حتى يُعاد اعتماد ما فُتح، وسجل بدء التنفيذ الأول يبقى.
  assert.equal(receipt.gate.blocked,true);
  assert.equal(receipt.status,'executing');
  assert.ok(receipt.execution_started_at);
  // اعتماد إلكتروني لتطبيق التغيير: اسم ودور ووقت، لا توقيع.
  assert.ok(receipt.changes[0].applied_label.startsWith('اعتمد: مديرة المشروع المسندة · مدير مشروع · '));
  assert.ok(receipt.changes[0].history.some(h=>h.action==='intake.change_applied'));
  assert.ok(verifyAudit(db));
});

test('the change classification policy stays a draft until someone other than its author approves it',t=>{
  const {db,users,tx}=fixture(t);
  const rules=['our_error','in_scope','extra_round','scope_change'].map(classification=>
    ({classification,test:`اختبار مصطنع يميّز ${classification} عن غيره بوضوح`,examples:'مثالان من عمل الشركة المصطنع'}));

  assert.throws(()=>tx(()=>prepareClassificationPolicy(db,users.other,{rules,basis:'محاولة من غير مختص'})),code('not_permitted'));
  assert.throws(()=>tx(()=>prepareClassificationPolicy(db,users.manager,{rules:rules.slice(0,3),basis:'سياسة ناقصة للاختبار'})),code('rules'));
  const policyId=tx(()=>prepareClassificationPolicy(db,users.manager,{rules,basis:'أعدّها مالك الإجراء في اختبار مصطنع'})).id;
  assert.equal(intakeBoard(db,users.manager).classification_policy,null,'a draft is not a policy');
  assert.equal(intakeBoard(db,users.manager).classification_policy_draft.status,'draft');
  assert.throws(()=>tx(()=>prepareClassificationPolicy(db,users.manager,{rules,basis:'مسودة ثانية في انتظار الأولى'})),code('draft_exists'));
  assert.throws(()=>tx(()=>decideClassificationPolicy(db,users.manager,policyId,{decision:'approved',note:'اعتماد ذاتي'})),code('separation_of_duties'));

  tx(()=>grantAccess(db,users.admin,{user_id:'pm1',capability:'intake.policy.approve',note:'معتمدة السياسة في الاختبار'}));
  tx(()=>decideClassificationPolicy(db,users.pm1,policyId,{decision:'approved',note:'راجعت التعريفات الأربعة'}));
  const board=intakeBoard(db,users.manager);
  assert.equal(board.classification_policy.status,'approved');
  assert.equal(board.classification_policy.rules.length,4);
  assert.equal(board.classification_policy_draft,null);
  assert.ok(verifyAudit(db));
});

test('BD-04 is an electronic record: two separate parties approve it, one person cannot be both, and the money stays with finance',t=>{
  const {db,users,tx}=fixture(t);
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة عميل التسليم المصطنعة',trade_name:'عميل التسليم',sector:'تجزئة',status:'active'})).id;
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع التسليم المصطنع',brief:'اختبار محضر التسليم',member_ids:['pm1','fin','other']}));
  const input=handoverInput(project.id,clientId);

  assert.throws(()=>tx(()=>createHandover(db,users.other,input)),code('not_permitted'));
  assert.throws(()=>tx(()=>createHandover(db,users.manager,{...input,project_manager_id:'manager'})),code('separation_of_duties'),'the person handing over is not the person receiving');
  assert.throws(()=>tx(()=>createHandover(db,users.manager,{...input,payment_terms:input.payment_terms.slice(0,2)})),code('payment_terms'),'the schedule must add up to the contract value');
  assert.throws(()=>tx(()=>createHandover(db,users.manager,{...input,payment_terms:input.payment_terms.map(t=>({...t,condition:''}))})),code('invalid_text'),'no payment term without its condition');
  assert.throws(()=>tx(()=>createHandover(db,users.manager,{...input,client_contacts:input.client_contacts.map(c=>({...c,is_primary:false}))})),code('client_contacts'));

  const handoverId=tx(()=>createHandover(db,users.manager,input)).id;
  const hv=()=>db.prepare('SELECT version FROM project_handovers WHERE id=?').get(handoverId).version;
  assert.throws(()=>tx(()=>handoverAction(db,users.other,handoverId,'approve_handover',{version:hv(),statement:'اعتماد من غير طرف في المحضر'})),code('not_a_party'));
  assert.throws(()=>tx(()=>handoverAction(db,users.pm1,handoverId,'receive_handover',{version:hv(),note:'استلام قبل اكتمال الاعتماد'})),code('not_handed_over'));
  tx(()=>handoverAction(db,users.manager,handoverId,'approve_handover',{version:hv(),statement:'أقرّ أن ما في المحضر هو ما تعاقدنا عليه'}));
  assert.throws(()=>tx(()=>handoverAction(db,users.manager,handoverId,'approve_handover',{version:hv(),statement:'محاولة اعتماد الطرف الثاني أيضًا'})),code('already_approved'));
  tx(()=>handoverAction(db,users.pm1,handoverId,'approve_handover',{version:hv(),statement:'أقرّ استلامي للمحضر ومراجعتي لبنوده'}));

  const board=intakeBoard(db,users.fin),handover=board.handovers[0];
  assert.equal(handover.status,'handed_over');
  assert.deepEqual(handover.approvals.map(a=>a.side).sort(),['handing_over','receiving']);
  // الاعتماد الإلكتروني يحمل الهوية والدور والتصريح ونسخة السجل والوقت: هذا ما حلّ محل التوقيع.
  const handing=handover.approvals.find(a=>a.side==='handing_over');
  assert.deepEqual([handing.approver_role,handing.approver_capability,handing.record_version],['manager','intake.handover',1]);
  assert.ok(handing.label.startsWith('اعتمد: مدير الفريق التجريبي · مدير · '));
  assert.ok(handover.history.some(h=>h.action==='intake.handover_approved'));
  // الأرقام المالية لحامل التفويض المالي وحده؛ العضو في المشروع يرى النطاق لا المبالغ.
  assert.equal(handover.contract_value_minor,10000000);
  assert.equal(intakeBoard(db,users.other).handovers[0].contract_value_minor,null);
  assert.equal(intakeBoard(db,users.other).handovers[0].finance_hidden,true);
  // المحضر سجل، لا صورة توقيع: الاعتماد لا يُعدَّل بعد صدوره.
  assert.throws(()=>db.prepare('UPDATE handover_approvals SET statement=? WHERE handover_id=?').run('نص آخر',handoverId),/not edited/);
  assert.ok(verifyAudit(db));
});

test('a departing project manager leaves the intake chain visible in the clearance list',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  completeChecklist(db,users,tx,r);
  const rows=deriveClearance(db,'36t','pm1');
  const receipt=rows.find(x=>x.source==='project_receipt');
  assert.ok(receipt,'the project receipt recorded in his name is an open obligation');
  assert.ok(receipt.title.includes('مشروع الاستلام المصطنع'));
  assert.ok(receipt.action_owner.includes('مدير المشروع البديل'));
  assert.equal(receipt.financial,0,'it blocks nothing financially; it is shown so the project is not left without a named owner');
  const identity=r.deliverable('هوية الحملة');
  for(const n of [1,2,3])tx(()=>recordRound(db,users.pm1,identity.id,{item_reference:`نسخة الهوية ${n}`,note:''}));
  tx(()=>raiseChange(db,users.pm1,r.receiptId,{description:'طلب تغيير مفتوح باسم المغادر',reason:'طلب من العميل لم يُبت فيه بعد',
    deliverable_id:identity.id,classification:'extra_round',free_rounds_exhausted:true,added_rounds:1,extra_cost:'3000.00',quotation_reference:'عرض 31'}));
  assert.ok(deriveClearance(db,'36t','pm1').some(x=>x.source==='project_change_request'),'an undecided change request he raised is listed too');
  assert.ok(verifyAudit(db));
});

/* ───── الربط بمحرك النماذج (107) وبمحرك التسعير (108) — ترحيل 113 ───── */

test('the intake records carry their catalogue form identity, and the catalogue refuses a second empty copy of it',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  tx(()=>installCatalogue(db,'36t'));
  const board=intakeBoard(db,users.pm1);
  const handover=board.handovers.find(h=>h.id===r.handoverId);
  // السجل يحمل هوية النموذج: رمزه الداخلي وأسماءه البديلة من الفهرس ورابط الكتالوج.
  assert.equal(handover.form.form_key,'FORM-BD-HANDOVER');
  assert.ok(handover.form.aliases.includes('BD-04'),'the source code BD-04 is kept as an alias, not invented here');
  assert.ok(handover.form.aliases.includes('FRM-002'));
  assert.equal(handover.form.data_entry,'intake_record');
  assert.ok(handover.form.unbound_note.length>10,'what is not bound field-by-field is written down, not hidden');
  assert.ok(handover.form.linked_at,'the link is recorded when the record is created');
  const receipt=board.receipts.find(x=>x.id===r.receiptId);
  assert.equal(receipt.form.form_key,'FORM-PM-RECEIPT');
  assert.ok(receipt.form.aliases.includes('PM-01'));

  // الكتالوج لا يعرض هذه النماذج قابلة للتعبئة، ويقول أين تُعبَّأ.
  const forms=formsBoard(db,users.pm1,{});
  const definition=forms.definitions.find(d=>d.form_key==='FORM-BD-HANDOVER');
  assert.equal(definition.fillable,false,'a bound form is never filled as a second empty copy');
  assert.equal(definition.bound_to.screen,'project-handover');
  for(const key of ['FORM-PM-RECEIPT','FORM-PM-KICKOFF','FORM-PM-CHANGE'])
    assert.ok(forms.definitions.find(d=>d.form_key===key).bound_to,`${key} is bound to its intake record`);
  // ولا من المسار: محاولة إنشاء نسخة من الكتالوج تُرد باسم الشاشة التي تُعبَّأ فيها.
  assert.throws(()=>tx(()=>createInstance(db,users.pm1,{form_key:'FORM-BD-HANDOVER',title:'نسخة موازية',
    subject_kind:'project',subject_id:r.project.id,payload:{}})),code('bound_record'));
  // نموذج غير مربوط يبقى كما كان: مسودة حتى يقبلها مالكها، لا ممنوعًا.
  assert.throws(()=>tx(()=>createInstance(db,users.pm1,{form_key:'FORM-BD-QUALIFY',title:'تأهيل',
    subject_kind:'project',subject_id:r.project.id,payload:{}})),code('definition_draft'));
  assert.ok(verifyAudit(db));
});

test('the financially approved pricing file is a reference to an approved pricing sheet, not a sentence someone typed',t=>{
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  const doc={doc_key:'approved_pricing'};
  // مرجع نصي لم يعد مقبولًا: الخانة تشير إلى ورقة تسعير.
  assert.throws(()=>tx(()=>provideDocument(db,users.fin,r.receiptId,{...doc,version:r.dv('approved_pricing'),
    reference:'ملف التسعير معتمد ماليًا — كلام'})),code('pricing_sheet_not_found'));
  // ورقة لم تُعتمد بعد: تُرد بحالتها بدل أن تمر.
  const submitted=approvedPricingSheetFor(db,r.clientId,{status:'submitted',code:'PR-INTAKE-DRAFT'});
  assert.throws(()=>tx(()=>provideDocument(db,users.fin,r.receiptId,{...doc,version:r.dv('approved_pricing'),
    pricing_sheet_id:submitted})),code('pricing_sheet_not_approved'));
  // ورقة عميل آخر: تُرد كذلك.
  const otherClient=tx(()=>createClient(db,users.manager,{legal_name:'عميل آخر مصطنع',trade_name:'عميل آخر',sector:'تجزئة',status:'active'})).id;
  const foreign=approvedPricingSheetFor(db,otherClient,{code:'PR-INTAKE-OTHER'});
  assert.throws(()=>tx(()=>provideDocument(db,users.fin,r.receiptId,{...doc,version:r.dv('approved_pricing'),
    pricing_sheet_id:foreign})),code('pricing_sheet_client'));

  const sheetId=approvedPricingSheetFor(db,r.clientId);
  tx(()=>provideDocument(db,users.fin,r.receiptId,{...doc,version:r.dv('approved_pricing'),pricing_sheet_id:sheetId}));
  const row=db.prepare('SELECT * FROM receipt_documents WHERE receipt_id=? AND doc_key=?').get(r.receiptId,'approved_pricing');
  assert.equal(row.pricing_sheet_id,sheetId,'the column holds the sheet, so the approval is read from its source');
  assert.ok(row.reference.includes('PR-INTAKE-1'),'the shown reference is derived from the sheet, never typed');
  const view=intakeBoard(db,users.fin).receipts.find(x=>x.id===r.receiptId)
    .documents.find(d=>d.doc_key==='approved_pricing');
  assert.equal(view.pricing_source.linked,true);
  assert.equal(view.pricing_source.status,'approved');
  assert.equal(view.pricing_source.seats.length,3,'the seats that approved the sheet are read from the sheet');
  assert.ok(view.pricing_source.seats.every(s=>s.decided_by_name));
  assert.ok(verifyAudit(db));
});

// حدّ اليوم بين الرياض وUTC (app/riyadh-time.mjs): يوم رفع طلب التغيير يوم رياض. رُفع الطلب الساعة 02:05 بتوقيت الرياض من 1 أكتوبر
// (23:05 UTC من 30 سبتمبر)، فلا يبدأ تطبيقه يوم 30 سبتمبر — وكان أول عشرة أحرف من طابع الرفع تقبله.
test('PM-03 at the Riyadh day boundary: a change raised at 02:05 Riyadh on the 1st cannot be applied from the last day of the previous month',t=>{
  pinClock(t,'2026-09-30T23:05:00.000Z');
  const {db,users,tx}=fixture(t);
  const r=received(db,users,tx);
  completeChecklist(db,users,tx,r);
  const change=tx(()=>raiseChange(db,users.pm1,r.receiptId,{description:'إعادة تصميم بسبب خطأ في مقاسات ملفنا',reason:'خطأ داخلي في المقاسات',classification:'our_error',free_rounds_exhausted:false,schedule_impact_days:2}));
  assert.deepEqual(change.needs,{finance:false,client:false});
  const cv=()=>db.prepare('SELECT version FROM project_change_requests WHERE id=?').get(change.id).version;
  assert.throws(()=>tx(()=>changeAction(db,users.pm1,change.id,'apply_change',{version:cv(),start_date:'2026-09-30',note:'بدأ تصحيح المقاسات على ملفاتنا'})),code('start_date'),'رُفع الطلب يوم 1 أكتوبر بتوقيت الرياض');
  tx(()=>changeAction(db,users.pm1,change.id,'apply_change',{version:cv(),start_date:'2026-10-01',note:'بدأ تصحيح المقاسات على ملفاتنا'}));
  assert.equal(db.prepare('SELECT status FROM project_change_requests WHERE id=?').get(change.id).status,'applied');
});
