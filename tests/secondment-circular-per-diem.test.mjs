import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { proposeTravel, travelAction, travelBoard, travelFromRequest, gradeBasisGap, effectiveDates, effectiveDays } from '../app/travel.mjs';
import { recordEmployeeGrade, activateAllowanceVersion, recordAttestation } from '../app/secondment-benefits.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';

// بدل الانتداب بعد تعميم 30 سبتمبر 2026، وحقول «نموذج طلب انتداب» الورقي.
//
// جدول التعميم (المبلغ لليوم الواحد، ريال): العاملون 700 داخل المملكة و900 خارجها، ومدراء الإدارات 900/1200،
// ونواب الرئيس 1000/1500. ودرجة الإركاب: نواب الرئيس ومدراء الإدارات درجة رجال الأعمال، وبقية العاملين
// درجة الضيافة. والتعميم يعلو على م65 بصفٍّ مدوَّن في policy_article_supersedes.
//
// وجدول م65 المخزَّن (قبل التعميم): الرئيس التنفيذي 2100/2500، نواب الرئيس 1000/1500، مدراء العموم 600/900،
// العاملون 400/500. فالقيم كلها مستشهدة بسندها المؤرَّخ، ولا رقم في هذا الملف بلا سند.
//
// بيانات مصطنعة بحتة: كيان الاختبار وحساباته من scripts/seed.mjs، ولا اسم موظف حقيقي في أي سطر.

const code=expected=>error=>error.code===expected;
const CIRCULAR_FROM='2026-06-01';
// تواريخ ثابتة على جانبي السريان: قرار يبدأ قبله يبقى على م65، وما بدأ بعده يأخذ التعميم.
const AFTER={start:'2026-07-01',end:'2026-07-05'},BEFORE={start:'2026-05-10',end:'2026-05-14'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-secondment-circular');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=run=>transaction(db,run);
  // صاحب الصلاحية ومدير الموارد البشرية المعتمِد: manager. والمنتدب: employee (مديره manager في البذرة).
  for(const capability of ['hr.policy.accept','hr.contracts.approve'])
    tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability,department_id:null,note:'تصريح مصطنع لاختبار بدل الانتداب'}));
  // جدول م65 في سياسات اللائحة يُقبل أولًا: بلا قبوله لا يُحسب بدل إطلاقًا.
  tx(()=>decideRule(db,users.manager,'reg-seed-travel','accept',{effective_from:'2019-01-01',choices:{},note:'طابقت قيم م65 مع اللائحة الموقعة (اختبار مصطنع)'}));
  const circular='36t-sec-circ';
  const activateCircular=(from=CIRCULAR_FROM)=>tx(()=>activateAllowanceVersion(db,users.manager,circular,
    {version:db.prepare('SELECT version FROM secondment_allowance_versions WHERE id=?').get(circular).version,
     effective_from:from,note:'قرار الإدارة المصطنع بتاريخ سريان تعميم الانتداب'}));
  const view=id=>travelBoard(db,users.manager).decisions.find(x=>x.id===id);
  const propose=extra=>tx(()=>proposeTravel(db,users.employee,{task:'مهمة ميدانية مصطنعة لدى عميل تجريبي',destination:'الدمام',
    scope:'domestic',start_date:AFTER.start,end_date:AFTER.end,distance_km:900,road_type:'paved',...extra})).id;
  const attest=id=>tx(()=>recordAttestation(db,users.manager,id,
    {statement:'لا يوجد في منطقة المهمة موظف يستطيع أداءها؛ راجعت فريق المنطقة قبل الترشيح (إقرار مصطنع).'}));
  const approve=(id,values)=>tx(()=>travelAction(db,users.manager,id,'approve_travel',{version:view(id).version,housing:'none',transport:'none',...values}));
  return {db,users,tx,activateCircular,circular,view,propose,attest,approve};
}

// ————— 1) الحساب التلقائي لكل فئة، داخل المملكة وخارجها —————

test('التعميم: البدل = أيام الانتداب × بدل الفئة داخل المملكة وخارجها، ومعه درجة الإركاب المستحقة',t=>{
  const {db,users,activateCircular,propose,attest,approve,view}=fixture(t);
  activateCircular();
  // فئتان لهما سند في التعميم: العاملون 700/900، ونواب الرئيس 1000/1500. خمسة أيام في كل حالة.
  const cases=[
    {grade:'employee',scope:'domestic',daily:70000,total:350000,ticket:'economy',source:'تعميم الانتداب 30 سبتمبر 2026 — العاملون 700 داخل المملكة'},
    {grade:'employee',scope:'abroad',daily:90000,total:450000,ticket:'economy',source:'تعميم الانتداب 30 سبتمبر 2026 — العاملون 900 خارج المملكة'},
    {grade:'deputy',scope:'domestic',daily:100000,total:500000,ticket:'business',source:'تعميم الانتداب 30 سبتمبر 2026 — نواب الرئيس 1000 داخل المملكة'},
    {grade:'deputy',scope:'abroad',daily:150000,total:750000,ticket:'business',source:'تعميم الانتداب 30 سبتمبر 2026 — نواب الرئيس 1500 خارج المملكة'}
  ];
  for(const {grade,scope,daily,total,ticket,source} of cases){
    // الدرجة تُسجَّل مع الاقتراح، فالمبلغ ودرجة الإركاب يُقرآن قبل القرار لا عنده.
    const id=propose({scope,grade,housing:'none',transport:'none',...(scope==='abroad'?{distance_km:null,road_type:null}:{})});
    attest(id);
    const before=view(id),preview=before.allowance_preview;
    assert.equal(before.days_total,5,`${source}: خمسة أيام من ${AFTER.start} إلى ${AFTER.end}`);
    assert.equal(preview.ready,true,source);
    assert.equal(preview.daily_rate_minor,daily,`${source}: البدل اليومي معروض قبل القرار`);
    assert.equal(preview.allowance_minor,total,`${source}: المبلغ محسوب تلقائيًا قبل القرار`);
    const result=approve(id,{grade});
    assert.equal(result.eligible,true,source);
    assert.equal(view(id).daily_rate_minor,daily,`${source}: البدل اليومي`);
    assert.equal(result.allowance_minor,total,`${source}: ${daily/100} × 5 يوم = ${total/100} ريال`);
    assert.equal(view(id).days,5);
    assert.equal(preview.ticket_class,ticket,`${source}: درجة الإركاب المستحقة معروضة`);
    // الخطوات كاملة على القرار: الفئة، والبدل اليومي، والأيام، والنسبة، وحاصل الضرب، والتقريب.
    assert.equal(view(id).basis.steps.length,6,source);
    assert.ok(view(id).basis.steps[2].includes('5'),`${source}: عدد الأيام في خطوات الحساب`);
    // حركة راتب «مقترحة» لا صرف: المنصة تحسب وتقترح ولا تدفع.
    const adjustment=db.prepare('SELECT kind,status,amount_minor FROM payroll_adjustments WHERE id=?').get(view(id).adjustment_id);
    assert.deepEqual([adjustment.kind,adjustment.status,adjustment.amount_minor],['allowance','proposed',total],source);
  }
  assert.ok(verifyAudit(db));
});

test('م65 قبل سريان التعميم: الفئات الأربع بقيم اللائحة، فقرار مضى لا يتغير بتعميم صدر بعده',t=>{
  const {db,activateCircular,propose,attest,approve,view}=fixture(t);
  activateCircular();
  // م65 المخزَّنة: الرئيس التنفيذي 2100/2500، نواب الرئيس 1000/1500، مدراء العموم 600/900، العاملون 400/500.
  const cases=[
    {grade:'ceo',scope:'domestic',daily:210000,total:1050000},
    {grade:'ceo',scope:'abroad',daily:250000,total:1250000},
    {grade:'deputy',scope:'domestic',daily:100000,total:500000},
    {grade:'deputy',scope:'abroad',daily:150000,total:750000},
    {grade:'gm',scope:'domestic',daily:60000,total:300000},
    {grade:'gm',scope:'abroad',daily:90000,total:450000},
    {grade:'employee',scope:'domestic',daily:40000,total:200000},
    {grade:'employee',scope:'abroad',daily:50000,total:250000}
  ];
  for(const {grade,scope,daily,total} of cases){
    const id=propose({scope,start_date:BEFORE.start,end_date:BEFORE.end,...(scope==='abroad'?{distance_km:null,road_type:null}:{})});
    // نسخة م65 لا تلزم الإقرار (التعميم وحده يلزمه)، فلا إقرار هنا — والقرار يمضي.
    const result=approve(id,{grade});
    assert.equal(view(id).daily_rate_minor,daily,`م65: ${grade} ${scope}`);
    assert.equal(result.allowance_minor,total,`م65: ${daily/100} × 5 يوم = ${total/100} ريال`);
    assert.equal(view(id).basis.rounding,'halala','نسخة م65 تبقى على تقريبها، فلا يتغير أثر قرار مضى');
  }
  assert.ok(verifyAudit(db));
});

test('التخفيض في م65/2: السكن وحده ينزل البدل إلى النصف، ومعه وسيلة التنقل إلى الربع',t=>{
  const {activateCircular,propose,attest,approve}=fixture(t);
  activateCircular();
  // العاملون 700 داخل المملكة × 5 أيام = 3500، ثم النصف 1750 والربع 875 (تعميم 30 سبتمبر 2026 مع م65/2).
  const full=propose();attest(full);
  assert.equal(approve(full,{grade:'employee',housing:'none',transport:'none'}).allowance_minor,350000);
  const half=propose();attest(half);
  assert.equal(approve(half,{grade:'employee',housing:'company',transport:'none'}).allowance_minor,175000,'السكن وحده: النصف (م65/2)');
  const quarter=propose();attest(quarter);
  assert.equal(approve(quarter,{grade:'employee',housing:'company',transport:'company'}).allowance_minor,87500,'السكن والتنقل: الربع (م65/2)');
});

// ————— 2) فئة لا سند لها: رفض مكتوب يسمّي الناقص ومن يملكه —————

test('الرئيس التنفيذي تحت التعميم: رفض مكتوب لا قيمة مخمَّنة — التعميم لا يذكر هذه الفئة إطلاقًا',t=>{
  const {db,users,activateCircular,propose,attest,approve,view}=fixture(t);
  activateCircular();
  const id=propose();attest(id);
  const before=view(id);
  let error=null;
  try{approve(id,{grade:'ceo'});}catch(caught){error=caught;}
  assert.ok(error,'انتداب فئة لا سند لها في النسخة السارية لا يُعتمد');
  assert.equal(error.code,'grade_basis_missing');
  // الرفض مكتوب: ما الذي رُفض، وما الناقص، ومن يملكه، وما الخطوة التالية — لا «الإجراء غير متاح».
  const refusal=error.details.refusal;
  assert.match(refusal.what,/رئيس التنفيذي/);
  assert.equal(refusal.missing.length,1);
  assert.match(refusal.missing[0].document,/قرار المالك/);
  assert.equal(refusal.missing[0].owner,'مدير رأس المال البشري','الرفض يسمّي من يملك الناقص');
  assert.equal(refusal.missing[0].owner_role,'hr.policy.accept');
  assert.match(refusal.missing[0].why,/تعميم الانتداب 30 سبتمبر 2026/,'السند مؤرَّخ في بند الناقص');
  assert.ok(refusal.next&&refusal.next.length>10,'الرفض يعطي خطوة تالية');
  // ولا قيمة 2100 من م65 المنسوخة تسرّبت: لا مبلغ، ولا حركة راتب، ولا حالة معتمدة.
  const after=view(id);
  assert.equal(after.status,'proposed','القرار يبقى مقترحًا');
  assert.equal(after.allowance_minor,null,'ما انكتب مبلغ');
  assert.equal(after.adjustment_id,null,'ما اقتُرحت حركة راتب');
  assert.equal(after.version,before.version,'الرفض لا يحرّك المعاملة');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payroll_adjustments WHERE kind='allowance'").get().n,0);
  assert.ok(verifyAudit(db));
});

test('مدراء الإدارات / مدراء العموم تحت التعميم: رفض مكتوب لأن الاسمين لم يُؤكَّد أنهما فئة واحدة',t=>{
  const {activateCircular,propose,attest,approve,view}=fixture(t);
  activateCircular();
  const id=propose();attest(id);
  let error=null;
  try{approve(id,{grade:'gm'});}catch(caught){error=caught;}
  assert.equal(error?.code,'grade_basis_missing');
  const refusal=error.details.refusal;
  assert.match(refusal.missing[0].document,/مدراء الإدارات/);
  assert.match(refusal.missing[0].document,/مدراء العموم/);
  assert.equal(refusal.missing[0].owner,'مدير رأس المال البشري');
  // الفرق مالٌ يُصرف لشخص: 900 في التعميم مقابل 600 في م65 داخل المملكة — فلا يُبنى على ترجيح.
  assert.match(refusal.missing[0].why,/900/);
  assert.match(refusal.missing[0].why,/600/);
  assert.equal(view(id).status,'proposed');
});

test('الفجوة مسجَّلة بيانًا لا منطقًا مبثوثًا، ولوح الانتداب يحجب مبلغ الفئة التي لا سند لها',t=>{
  const {db,users,activateCircular}=fixture(t);
  activateCircular();
  // الفجوتان على نسخة التعميم وحدها: نسخة م65 تذكر الفئات الأربع بقيمها، فلا فجوة فيها.
  assert.ok(gradeBasisGap(db,'circular','ceo'));
  assert.ok(gradeBasisGap(db,'circular','gm'));
  assert.equal(gradeBasisGap(db,'circular','deputy'),null);
  assert.equal(gradeBasisGap(db,'circular','employee'),null);
  for(const grade of ['ceo','deputy','gm','employee'])assert.equal(gradeBasisGap(db,'regulation_art65',grade),null);
  const grades=Object.fromEntries(travelBoard(db,users.manager).grades.map(g=>[g.key,g]));
  assert.equal(grades.ceo.domestic_minor,null,'مبلغ محجوب لا مبلغ مخمَّن');
  assert.equal(grades.ceo.abroad_minor,null);
  assert.ok(grades.ceo.basis_gap,'الفجوة مع الفئة في اللوح، فتُقرأ قبل القرار لا عنده');
  assert.equal(grades.gm.domestic_minor,null);
  assert.ok(grades.gm.basis_gap);
  assert.equal(grades.employee.domestic_minor,70000,'العاملون 700 داخل المملكة (تعميم 30 سبتمبر 2026)');
  assert.equal(grades.employee.abroad_minor,90000,'العاملون 900 خارج المملكة (تعميم 30 سبتمبر 2026)');
  assert.equal(grades.deputy.domestic_minor,100000,'نواب الرئيس 1000 داخل المملكة');
  assert.equal(grades.deputy.abroad_minor,150000,'نواب الرئيس 1500 خارج المملكة');
  assert.equal(grades.deputy.basis_gap,null);
  // والفجوة لا تُحرَّر: قرار المالك حدثٌ له تاريخ، فيُغلقها ترحيل يحمله.
  assert.throws(()=>db.exec("UPDATE secondment_grade_basis_gaps SET owner='غيره' WHERE grade='ceo'"),/new migration/);
  assert.throws(()=>db.exec("DELETE FROM secondment_grade_basis_gaps WHERE grade='ceo'"),/retained/);
});

test('الحساب المعروض قبل القرار يرفض الفئة التي لا سند لها بالنص نفسه، ولا يُعطب قراءة الشاشة',t=>{
  const {db,users,activateCircular,propose,attest}=fixture(t);
  activateCircular();
  const id=propose({grade:'ceo'});attest(id);
  const preview=travelBoard(db,users.manager).decisions.find(x=>x.id===id).allowance_preview;
  assert.equal(preview.ready,false);
  assert.equal(preview.blocked,true);
  assert.match(preview.note,/رئيس التنفيذي/);
  assert.equal(preview.refusal.missing[0].owner,'مدير رأس المال البشري');
  assert.equal(preview.allowance_minor,undefined,'ما فيه مبلغ يُعرض لفئة لا سند لها');
});

// ————— 3) تغيّر التواريخ يعيد الحساب —————

test('تغيّر التواريخ يعيد الحساب: العدّ على الأيام الفعلية حين تُعرف (م65/1)، وعلى المخططة حين لا تُعرف',t=>{
  const {db,users,activateCircular,propose,attest,approve,view}=fixture(t);
  activateCircular();
  const preview=id=>travelBoard(db,users.manager).decisions.find(x=>x.id===id).allowance_preview;
  // (أ) المخطط وحده: خمسة أيام × 700 = 3500 ريال.
  const planned=propose({grade:'employee',housing:'none',transport:'none'});
  assert.equal(preview(planned).days,5);
  assert.equal(preview(planned).dates_basis,'planned');
  assert.equal(preview(planned).allowance_minor,350000,'700 × 5 = 3500 ريال');
  // (ب) التواريخ نفسها بمدة أطول: ثمانية أيام × 700 = 5600 — المبلغ يتبع التاريخ بلا إجراء.
  const longer=propose({grade:'employee',housing:'none',transport:'none',end_date:'2026-07-08'});
  assert.equal(preview(longer).days,8);
  assert.equal(preview(longer).allowance_minor,560000,'700 × 8 = 5600 ريال');
  // (ج) البداية والنهاية الفعلية على السجل: ثلاثة أيام تسبق المخطط في العدّ (م65/1).
  const actual=propose({grade:'employee',housing:'none',transport:'none',actual_start_date:AFTER.start,actual_end_date:'2026-07-03'});
  assert.equal(preview(actual).dates_basis,'actual');
  assert.equal(preview(actual).days,3);
  assert.equal(preview(actual).allowance_minor,210000,'700 × 3 = 2100 ريال على الأيام الفعلية');
  assert.equal(effectiveDays(db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(actual)),3);
  // (د) القرار نفسه: اقتُرح بخمسة أيام مخططة، واعتُمد بتاريخين فعليين ثلاثة أيام — فالمعتمد 2100 لا 3500.
  const decided=propose({grade:'employee',housing:'none',transport:'none'});
  attest(decided);
  assert.equal(preview(decided).allowance_minor,350000,'قبل القرار: خمسة أيام مخططة');
  const result=approve(decided,{grade:'employee',actual_start_date:AFTER.start,actual_end_date:'2026-07-03'});
  assert.equal(result.allowance_minor,210000,'بعد إدخال التاريخين الفعليين: 700 × 3 = 2100 ريال');
  const row=view(decided);
  assert.equal(row.days,3);
  assert.equal(row.basis.dates_basis,'actual');
  assert.deepEqual([row.basis.counted_from,row.basis.counted_to],[AFTER.start,'2026-07-03'],'السند يقول على أي تاريخين عُدّت الأيام');
  assert.equal(db.prepare('SELECT amount_minor FROM payroll_adjustments WHERE id=?').get(row.adjustment_id).amount_minor,210000);
  assert.ok(verifyAudit(db));
});

test('التاريخان الفعليان يُدخلان معًا ومرتَّبين',t=>{
  const {activateCircular,propose,attest,approve}=fixture(t);
  activateCircular();
  const one=propose();attest(one);
  assert.throws(()=>approve(one,{grade:'employee',actual_start_date:AFTER.start}),code('actual_dates'),'واحد منهما ما يكوّن مدة');
  const back=propose();attest(back);
  assert.throws(()=>approve(back,{grade:'employee',actual_start_date:'2026-07-05',actual_end_date:'2026-07-01'}),code('actual_date_order'));
  // والبداية الفعلية تختار النسخة أيضًا: انتداب فعليٌّ بدأ قبل السريان يبقى على م65 ولو كان المخطط بعده.
  const row={start_date:AFTER.start,end_date:AFTER.end,actual_start_date:BEFORE.start,actual_end_date:BEFORE.end};
  assert.deepEqual(effectiveDates(row),{start:BEFORE.start,end:BEFORE.end,dates_basis:'actual'});
});

// ————— 4) الموظف لا يعتمد انتدابه بنفسه —————

test('الموظف لا يعتمد انتدابه بنفسه، ولا مقترحه، والرفض يسمّي من يملك الاعتماد',t=>{
  const {db,users,tx,activateCircular,propose,attest,view}=fixture(t);
  activateCircular();
  const id=propose();attest(id);
  const version=view(id).version;
  // (أ) صاحب الانتداب هو مقترحه: لا اعتماد ولا رفض بيده.
  let error=null;
  try{tx(()=>travelAction(db,users.employee,id,'approve_travel',{version,grade:'employee',housing:'none',transport:'none'}));}catch(caught){error=caught;}
  assert.ok(error,'ما يعتمد الموظف انتداب نفسه');
  assert.equal(error.code,'action_unavailable');
  assert.match(error.message,/فصل المهام/,'السبب مسمّى: صاحب الانتداب ومقترحه لا يقرران فيه');
  assert.ok(!view(id).own||true);
  const mine=travelBoard(db,users.employee).decisions.find(x=>x.id===id);
  assert.ok(mine.own);
  assert.ok(!mine.actions.includes('approve_travel'),'الاعتماد ما هو من إجراءاته');
  assert.ok(mine.actions.includes('cancel_travel'),'يقدر يسحب اقتراحه وبس');
  // (ب) ولا يرفضه بنفسه كذلك.
  assert.throws(()=>tx(()=>travelAction(db,users.employee,id,'reject_travel',{version,note:'رفض مصطنع من صاحب الانتداب'})),code('action_unavailable'));
  // (ج) والحالة ما تغيّرت، وما اقتُرحت حركة راتب.
  assert.equal(view(id).status,'proposed');
  assert.equal(view(id).adjustment_id,null);
  // (د) والحارس الأخير في المخطط نفسه: قاعدة البيانات ترفض قرارًا صاحبه أو مقترحه هو من قرّره.
  assert.throws(()=>db.exec(`UPDATE travel_decisions SET decided_by='employee',version=version+1 WHERE id='${id}'`),/CHECK constraint failed/);
  // (هـ) ومن يملك الاعتماد يعتمده: صاحب الصلاحية، غير صاحب الانتداب وغير مقترحه.
  const approved=tx(()=>travelAction(db,users.manager,id,'approve_travel',{version:view(id).version,grade:'employee',housing:'none',transport:'none'}));
  assert.equal(approved.allowance_minor,350000);
  assert.equal(view(id).decided_by,'manager');
  assert.ok(verifyAudit(db));
});

// ————— 5) حقول النموذج الورقي تصل السجل من طلب الكتالوج —————

test('طلب ADM-TRAVEL يحمل حقول النموذج الورقي إلى قرار الانتداب: الرحلة والوجهة والتواريخ وصفوف الحجز',t=>{
  const {db}=fixture(t);
  installServiceCatalog(db);
  const stored=db.prepare("SELECT * FROM services WHERE code='ADM-TRAVEL' AND tenant_id='36t'").get();
  const fields=JSON.parse(stored.fields),keys=fields.map(f=>f.key);
  // بنية النموذج الورقي «نموذج طلب انتداب»: نوع الرحلة والمدينة والدولة، ومن تاريخ / إلى تاريخ،
  // وبداية ونهاية الانتداب الفعلية، والطيران والسكن والمواصلات (حجز / بدون حجز)، والغرض من السفر.
  for(const key of ['travel_type','city','country','start_date','end_date','actual_start_date','actual_end_date','flight','housing','transport','purpose'])
    assert.ok(keys.includes(key),`حقل النموذج الورقي «${key}» في الخدمة`);
  assert.deepEqual(fields.find(f=>f.key==='travel_type').options,['داخلية','خارجية']);
  for(const key of ['flight','housing','transport'])
    assert.deepEqual(fields.find(f=>f.key===key).options,['حجز','بدون حجز'],`صفّ «${key}» في النموذج خياراه حجز وبدون حجز`);
  // الدولة للخارجي وحده، مفروضةً على الخادم لا في الواجهة وحدها.
  assert.deepEqual(fields.find(f=>f.key==='country').show_when,{field:'travel_type',equals:['خارجية']});
  assert.ok(!fields.find(f=>f.key==='actual_start_date').required,'الفعلية تُعرف بعد السفر، فلا تُطلب عند التقديم');

  // والطلب المعتمد يصير قرار انتداب مقترحًا بما فيه: «خارجية» انتدابٌ خارج المملكة لا داخلها.
  const payload={travel_type:'خارجية',city:'القاهرة',country:'مصر',start_date:AFTER.start,end_date:AFTER.end,
    flight:'حجز',housing:'حجز',transport:'بدون حجز',purpose:'حضور مؤتمر تجريبي مصطنع لاختبار الربط'};
  const id=transaction(db,()=>travelFromRequest(db,{id:null,tenant_id:'36t',requester_id:'employee',title:'انتداب مصطنع',payload:JSON.stringify(payload)}));
  const row=db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(id);
  assert.equal(row.scope,'abroad','«خارجية» لا تُقرأ داخليةً بصمت — الفرق بدلٌ ودرجة تذكرة');
  assert.equal(row.city,'القاهرة');
  assert.equal(row.country,'مصر');
  assert.equal(row.flight,'booked');
  assert.equal(row.housing,'company','«حجز السكن» هو مدخل م65/2: المنشأة وفّرت السكن');
  assert.equal(row.transport,'none','«بدون حجز» يعني أن المنشأة لم توفر وسيلة التنقل');
  assert.match(row.destination,/مصر/);
  assert.match(row.destination,/القاهرة/);
  // والصيغة القديمة «خارجي» في طلبات مخزَّنة قبل مطابقة النموذج تُقرأ كما هي.
  const legacy=transaction(db,()=>travelFromRequest(db,{id:null,tenant_id:'36t',requester_id:'employee',title:'انتداب مصطنع قديم',
    payload:JSON.stringify({travel_type:'خارجي',destination:'الدوحة',start_date:AFTER.start,end_date:AFTER.end,purpose:'مهمة مصطنعة'})}));
  assert.equal(db.prepare('SELECT scope FROM travel_decisions WHERE id=?').get(legacy).scope,'abroad');
});
