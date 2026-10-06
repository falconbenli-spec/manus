// مراجعة مستقلة لمفتاح تفعيل الخدمة (الترحيل 129) — 22 سبتمبر 2026.
//
// فحص مراجعون فرع المفتاح وأثبتوا سبع عشرة ملاحظة بالتشغيل لا بالقراءة. كل اختبار هنا يثبّت واحدة منها:
// يسقط على الشيفرة قبل إصلاحها ويمرّ بعدها. الترتيب ترتيب الخطورة كما جاءت.
//
//   (1) المفتاح لم يكن يبلغ وحدة المزايا الثلاث: ثلاث مزايا من ثلاث عشرة تُخفى من «مزاياي» وتبقى تُطلب
//       كاملةً من /api/benefit-extras. بابان لميزة واحدة، أحدهما يرفض والآخر يقبل.
//   (2) لوح جودة الكتالوج كان يُسقط الموقوفة ومعها تاريخ طلباتها، فيطبع «صفر طلب» والطلب مفتوح يتحرك.
//   (3) على شاشة المفتاح نفسها: نائب الخدمة الموقوفة وزمنها يختفيان بلا كلمة، وفحصُها بجوارهما يعدّها.
//   (4) إعادة التقديم من طلب منقضٍ كانت تعيد الكذبة نفسها التي أُصلحت في createRequest.
//   (5) applyVariant يرفض بـfail عارٍ بلا سبب ولا مالك ولا خطوة.
//   (6) الرفض كان يطبع معرّف دخول من أوقفها («admin») لا اسمه.
//   (7) المركز التخصصي النشط يسمّي للموظف خدمةً موقوفة بلا علامة.
//   (8) حقول كتبها هذا الفرع تصل الحمولة ولا تُرسم على أي شاشة.
//   (9) البحث في 142 صفًّا تُلغيه البطاقات المطوية: العدّاد يتحرك والصفوف لا تُرى.
//  (14) العدّاد يقول «المعروض: 155» عند التحميل وعلى الشاشة عشرون صفًّا.
//  (11) لوح بطاقات الخدمات يفقد خدمةً ووحدةً من بلاطاته، والتوليد يتخطى الموقوفة.
//  (12) قراءة فصل المهام تقرأ الموقوفة «ناقصة من الكتالوج» وتسلّم خطوةً لا تغيّر شيئًا.
//  (13) اللوح يعرض نفسه شاملًا ويسكت عن HR-LEAVE، وهي مدخل طلب لا يبلغه.
//  (15) «اختيار الشركة» يسقط عن خيار الطلب ما دامت الميزة مسودة — وهي مسودة اليوم.
//  (16) hidden_checked يُحسب ولا يُطبع.
//
// البيانات كلها مصطنعة من البذرة التجريبية، وعلى قاعدة بالذاكرة. لا منفذ شبكة هنا عمدًا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, approvalSettings, applyVariant, variantCatalog, separationOfDutiesState, fieldModel } from '../app/service-catalog.mjs';
import { setAvailability, outOfReach, stopNote } from '../app/service-availability.mjs';
import { catalogQualityBoard } from '../app/catalog-quality.mjs';
import { cardsBoard, draftMissingCards, serviceCard } from '../app/service-cards.mjs';
import { centresBoard, proposeCentre, centreAction } from '../app/centres.mjs';
import { resubmitLapsed } from '../app/returned-requests.mjs';
import { myBenefits } from '../app/benefits-portal.mjs';
import { recordEmployeeGrade, setGradeCap, saveBenefitSettings, benefitExtrasBoard,
  submitParentsInsurance, submitEducationClaim, submitSportsClaim, BENEFIT_KEY_OF } from '../app/secondment-benefits.mjs';
import { usedServices, portal } from '../app/routing.mjs';
import { homeBoard } from '../app/home.mjs';
import { homeUI } from '../app/static/home-ui.mjs';
import { approvalSettingsUI } from '../app/static/approval-settings-ui.mjs';
import { catalogQualityUI } from '../app/static/catalog-quality-ui.mjs';
import { serviceCardsUI } from '../app/static/service-cards-ui.mjs';
import { centresUI } from '../app/static/centres-ui.mjs';
import { benefitExtrasUI } from '../app/static/secondment-benefits-ui.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';

const PASSWORD='synthetic-service-switch-review';
const REASON='تجريبي: قرار المالك 22 سبتمبر 2026 بإيقافها حتى تُراجع إجراءاتها';
const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// سياق الرسم كما تمرّره app.mjs: الشاشة تُرسم تحت Node بلا DOM، فما يُثبت هنا هو ما يراه القارئ.
function uiContext(){
  const button=(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  const ui={
    card:({code:c='',title,meta='',open=false,body=''})=>`<details${open?' open':''}><summary>${e(c)} ${e(title)} ${e(meta)}</summary>${body}</details>`,
    table:({head=[],rows=[]})=>rows.length?`<table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`:'<div class="empty"></div>'
  };
  return {e,button,ui,money:v=>String(v),tr:(ar)=>ar,lang:'ar',date:v=>String(v)};
}

function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);installServiceCatalog(db);
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const hide=(kind,key,reason=REASON)=>tx(()=>setAvailability(db,users.admin,{kind,target_key:key,state:'hidden',reason}));
  const service=c=>wf.catalog(db,users.admin,{includeHidden:true}).find(s=>s.code===c);
  const raise=(c,who='employee')=>{const d=service(c);
    const r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${c}`,payload:payloadForStored(d.fields,fieldModel(c))}));
    return tx(()=>wf.transition(db,user(who),r.id,'submit',{version:r.version,note:''})).id;};
  return {db,users,tx,user,row,hide,service,raise};
}

// موظفة مؤهَّلة للمزايا الثلاث: عقد ساري اجتازت تجربته، وتقييم صادر، ودرجة مسجَّلة، وسقف دراسة وأساسه.
// (المرآة الحرفية لما يبنيه tests/secondment-benefits.test.mjs، فلا يثبت الاختبار أهليةً لم تُبنَ.)
function makeEligible(db,users,tx){
  const grant=(who,capability)=>tx(()=>grantAccess(db,users.admin,{user_id:who,capability,department_id:null,note:'تصريح مصطنع لاختبار مراجعة المفتاح'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve'])grant('manager',c);
  const time=now(),lines=[{component:'basic',amount_minor:1000000},{component:'housing',amount_minor:250000}];
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pol-pay','36t','pay_components','بنود الراتب','سياسة بنود راتب مصطنعة للاختبار الآلي فقط','{\"components\":[\"basic\",\"housing\"]}','مصدر مصطنع','2019-01-01','accepted','hr','manager',?,?)").run(time,time);
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('c-employee','36t','employee','pol-pay','indefinite','وظيفة مصطنعة','الرياض','2024-01-01',40,90,30,?,1250000,'SAR','عقد مصطنع','active','hr','manager',?,?,?)")
    .run(JSON.stringify(lines),time,time,time);
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,status,updated_by,updated_at) VALUES('employee','36t','وظيفة مصطنعة','full_time','2024-01-01','active','hr',?)").run(time);
  db.prepare("INSERT INTO review_cycles(id,tenant_id,name,period_from,period_to,scale_max,criteria,status,created_by,released_by,released_at,created_at,updated_at) VALUES('cyc-1','36t','دورة تقييم مصطنعة','2025-01-01','2025-12-31',5,'[]','released','hr','manager',?,?,?)").run(time,time,time);
  db.prepare("INSERT INTO performance_reviews(id,tenant_id,cycle_id,user_id,reviewer_id,status,final_score_bp,created_at,updated_at) VALUES('rev-1','36t','cyc-1','employee','manager','released',425,?,?)").run(time,time);
  tx(()=>recordEmployeeGrade(db,users.hr,{user_id:'employee',grade_code:'D',note:'درجة مصطنعة للاختبار'}));
  tx(()=>setGradeCap(db,users.hr,{table:'education',grade_code:'D',amount:'20000.00',note:'سقف مصطنع للاختبار'}));
  tx(()=>saveBenefitSettings(db,users.manager,{education_cap_basis:'per_child',note:'أساس مصطنع للاختبار'}));
}
const invoice=n=>({invoice_number:`INV-TEST-${n}`,supplier_tax_number:'300000000000003',supplier_name:'مورد تجريبي',invoice_date:'2026-02-01',amount:'1200.00'});

/* ───── (1) المفتاح يبلغ الباب الثاني للمزايا الثلاث ──────────────────────── */
test('مراجعة 1: الميزة الموقوفة تُرفض في /api/benefit-extras كما تُرفض في «مزاياي»، فلا بابٌ ثانٍ يقبل ما يرفضه الأول',t=>{
  const {db,users,tx,hide}=fixture(t);
  makeEligible(db,users,tx);
  // الجسر بين نوع المطالبة ومفتاح الميزة مكتوب مرة واحدة، و«sports» مفتاحها «gym» لا «sports».
  assert.deepEqual(BENEFIT_KEY_OF,{parents_insurance:'parents_insurance',children_education:'children_education',sports:'gym'});
  for(const key of Object.values(BENEFIT_KEY_OF))
    assert.ok(db.prepare('SELECT 1 FROM benefit_catalog WHERE tenant_id=? AND benefit_key=?').get('36t',key),`${key} مفتاح قائم في كتالوج المزايا`);

  const before=benefitExtrasBoard(db,users.employee).availability;
  assert.equal(before.parents_insurance.available,true,'قبل الإيقاف: تأمين الوالدين متاح');
  assert.equal(before.sports.available,true,'وقبل الإيقاف: الأندية الصحية متاحة');

  for(const key of ['parents_insurance','children_education','gym'])hide('benefit',key);

  // اللوح: المفتاح يعلو الأهلية والسقوف والرصيد السنوي، ويُطبَّق على الكتلة كاملة لا على فرع فرع.
  const board=benefitExtrasBoard(db,users.employee);
  for(const kind of ['parents_insurance','children_education','sports']){
    assert.equal(board.availability[kind].available,false,`${kind}: لا تُعرض متاحة بعد إيقافها`);
    assert.equal(board.availability[kind].switched_off,true,`${kind}: والسبب مسمّى لا مبهم`);
    assert.match(board.availability[kind].reason,/موقوفة من إعدادات الخدمات/);
  }
  assert.equal(board.switched_off_count,3,'ويُقال عددها لا تُطرح صامتة');

  // وأبواب التقديم الثلاثة ترفض رفضًا مكتوبًا، لا تقبل الطلب ثم تُدخله طابور الموارد البشرية.
  const attempts=[
    ['sports',()=>tx(()=>submitSportsClaim(db,users.employee,{category:'club',invoice:invoice(1),acknowledged_single_request:true}))],
    ['parents_insurance',()=>tx(()=>submitParentsInsurance(db,users.employee,{parents:[{relation:'father',parent_name:'اسم تجريبي للوالد',id_reference:'****7890',birth_date:'1960-01-01'}],payment_mode:'one_off'}))],
    ['children_education',()=>tx(()=>submitEducationClaim(db,users.employee,{children:[{child_name:'اسم تجريبي للابن',birth_date:'2015-01-01',stage:'ابتدائي',school:'مدرسة تجريبية',enrolment_proof:'مرجع تجريبي',invoice:invoice(2)}],academic_year:'2026-2027'}))]
  ];
  for(const [kind,attempt] of attempts){
    let caught=null;try{attempt();}catch(error){caught=error;}
    assert.ok(caught,`${kind}: الطلب مرفوض`);
    assert.equal(caught.code,'service_hidden',`${kind}: الرفض رفض المفتاح نفسه`);
    const refusal=caught.details?.refusal;
    assert.ok(refusal,`${kind}: رفضٌ مكتوب لا رسالة وحدها`);
    assert.equal(refusal.missing[0].owner_role,'catalog.manage',`${kind}: ويسمّي من يعيد التفعيل`);
    assert.match(refusal.missing[0].why,new RegExp(REASON.slice(0,20)),`${kind}: ويحمل سبب الإيقاف كما كُتب`);
  }
  // ولا صفّ واحد وصل الجدول، ولا طلب وصل طابور الموارد البشرية ولا صندوقها.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM benefit_extra_requests').get().n,0,'لا مطالبة كُتبت على ميزة موقوفة');
  assert.equal(benefitExtrasBoard(db,users.hr).queue.length,0,'ولا شيء في طابور الموارد البشرية');

  // والشاشة تقول السبب وتقفل الزر: الصف غير المتاح يطبع `state.reason` أصلًا، وقالب الطلب يحرس الإتاحة.
  const html=benefitExtrasUI.render(board,uiContext());
  assert.match(html,/موقوفة من إعدادات الخدمات/,'الشاشة تقول لماذا اختفت');
  assert.match(html,/منها 3 أوقفها المالك من إعدادات الخدمات/,'وتقول عددها: عددٌ لا يقرؤه أحد هو العطب نفسه (المراجعة 8)');
  assert.equal(/اطلبها/.test(html),false,'ولا يبقى زرّ طلبٍ على ميزة موقوفة');
  for(const key of ['parents','education','sports'])
    assert.throws(()=>benefitExtrasUI.form(`request_${key}`,key,board),/الإجراء غير متاح|غير متاح/,`${key}: والنموذج لا يُفتح`);

  // والبابان يقولان الشيء نفسه عن الميزة نفسها: «مزاياي» ترفض بدل الدراسة، والوحدة ترفضه كذلك.
  const option=myBenefits(db,users.employee,users.employee.id).options.find(o=>o.key==='education_claim');
  assert.equal(option.switched_off,true,'«مزاياي»: بدل الدراسة موقوف');
  assert.equal(board.availability.children_education.switched_off,true,'والوحدة تقول الشيء نفسه');
  assert.ok(verifyAudit(db),'سلسلة التدقيق متصلة');
});

/* ───── (2) جودة الكتالوج ─────────────────────────────────────────────────── */
test('مراجعة 2: تقرير جودة الكتالوج يُبقي الموقوفة معلَّمة ولا يطرح تاريخ طلباتها من أرقامه',t=>{
  const {db,users,hide,raise}=fixture(t);
  raise('IT-SUPPORT');
  const before=catalogQualityBoard(db,users.admin);
  assert.equal(before.totals.services,142);
  assert.equal(before.totals.requests,1,'طلبٌ واحد مقدَّم فعلًا');

  hide('service','IT-SUPPORT');
  const after=catalogQualityBoard(db,users.admin);
  assert.equal(after.totals.services,142,'العدد لا ينقص: الخدمة ما زالت في الدليل وطلبها مفتوح');
  assert.equal(after.totals.hidden,1,'ويُقال كم منها موقوفة، فلا يُقرأ الرقم كتالوجًا أصغر');
  assert.equal(after.totals.requests,1,'وتاريخ طلباتها لم يُطرح: «صفر طلب» والطلب مفتوح جملةٌ كاذبة');
  const row=after.services.find(s=>s.code==='IT-SUPPORT');
  assert.ok(row,'صفّها باقٍ في التقرير');
  assert.equal(row.hidden,true,'معلَّمًا');
  assert.equal(row.requests,1,'بعدد طلباته كما هو');

  // والشاشة تقول العدد بجوار «الخدمات» وتعلّم الصف، فلا يقرأ أحد رقمًا ناقصًا بلا سبب.
  const html=catalogQualityUI.render(after,uiContext());
  assert.match(html,/منها 1 موقوفة/,'البلاطة تقول كم أُوقف');
  assert.match(html,/موقوفة من الإعدادات/,'والصف معلَّم');
});

/* ───── (3) قوائم الحوكمة على شاشة المفتاح نفسها ──────────────────────────── */
test('مراجعة 3: نائب الخدمة الموقوفة وزمنها يبقيان على الشاشة معلَّمين، فلا يُطرح صفّ بلا كلمة',t=>{
  const {db,users,hide}=fixture(t);
  const before=approvalSettings(db,users.admin);
  const deputiesBefore=before.deputy_services.length,targetsBefore=before.targets_for_review.length;
  assert.ok(before.deputy_services.some(d=>d.code==='ADM-EXPENSE-CLAIM'),'خدمة فصل مهام قبل الإيقاف');

  hide('service','ADM-EXPENSE-CLAIM');
  const after=approvalSettings(db,users.admin);
  assert.equal(after.deputy_services.length,deputiesBefore,'قائمة تسمية النائب لا تنقص: القرار ما زال يلزم عملًا يتحرك');
  assert.equal(after.targets_for_review.length,targetsBefore,'ولا قائمة الأزمنة المعروضة للمراجعة');
  const deputy=after.deputy_services.find(d=>d.code==='ADM-EXPENSE-CLAIM');
  assert.equal(deputy.hidden,true,'والصف معلَّم موقوفًا');
  assert.match(deputy.hidden_reason,new RegExp(REASON.slice(0,20)),'ومعه سبب الإيقاف');
  // والنصفان لا يتناقضان: الفحص بجوارهما يعدّ الموقوفة، فالقائمتان تعدّانها كذلك.
  assert.equal(after.health.services_checked,142);
  assert.equal(after.health.hidden_checked,1);
  assert.equal(after.availability.totals.services_hidden,1);

  const html=approvalSettingsUI.render({...after,workflow:null},uiContext());
  assert.match(html,/142 خدمة مفحوصة، منها 1 موقوفة من الإعدادات/,'الفحص يقول عدده وعدد الموقوفة (المراجعة 16)');

  // وأزمنة مدير الإدارة كذلك: خدمته الموقوفة تبقى في قائمته معلَّمة.
  const head=db.prepare("SELECT * FROM users WHERE role='manager' AND department_id IS NOT NULL LIMIT 1").get();
  const mineBoard=approvalSettings(db,head);
  assert.ok(Array.isArray(mineBoard.my_service_targets));
  for(const row of mineBoard.my_service_targets)assert.equal(typeof row.hidden,'boolean','كل صفٍّ يقول حاله لا يسقط');
});

/* ───── (4) إعادة التقديم من المنقضي ──────────────────────────────────────── */
test('مراجعة 4: إعادة التقديم من طلب منقضٍ على خدمة موقوفة تقول «موقوفة» لا «لم تعد منشورة»',t=>{
  const {db,users,tx,user,row,hide,raise}=fixture(t);
  const rid=raise('HR-LETTER');
  const steps=()=>db.prepare('SELECT * FROM approval_steps WHERE request_id=? AND revision=(SELECT revision FROM requests WHERE id=?) ORDER BY position').all(rid,rid);
  tx(()=>wf.transition(db,user(steps()[0].approver_id),rid,'approve',{version:row(rid).version,note:'موافقة تجريبية'}));
  const pending=steps().find(s=>s.status==='pending');
  tx(()=>wf.transition(db,user(pending.approver_id),rid,'return',{version:row(rid).version,note:'ينقصه اسم الجهة كاملًا'}));
  // انقضاء مصطنع بالحد الأدنى: صفّ الانقضاء هو ما يميّز المنقضي عن الملغى بيد صاحبه.
  const timer=randomUUID(),stamp=at=>new Date(Date.now()+at).toISOString();
  tx(()=>{db.prepare("INSERT INTO workflow_timer_settings(id,tenant_id,timer_key,unit,value,basis,status,proposed_by,proposed_at) VALUES(?,?,'returned_expiry','working_days',3,?,'proposed','admin',?)")
      .run(timer,'36t','قرار تجريبي مصطنع للرئاسة لاختبار المهل',stamp(-9e7));
    db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='vp-growth',adopted_at=? WHERE id=?").run(stamp(-8e7),timer);});
  const back=db.prepare("SELECT decided_at FROM approval_steps WHERE request_id=? AND status='returned'").get(rid).decided_at;
  tx(()=>{db.prepare('INSERT INTO request_lapses(request_id,tenant_id,revision,returned_at,returned_by,reminded_at,waited_days,timer_row_id,lapsed_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(rid,'36t',row(rid).revision,back,'hr',stamp(1000),4,timer,stamp(2000));
    db.prepare("UPDATE requests SET status='cancelled',version=version+1,updated_at=? WHERE id=?").run(stamp(2000),rid);});

  hide('service','HR-LETTER');
  let caught=null;
  try{tx(()=>resubmitLapsed(db,users.employee,rid,{version:row(rid).version,note:''}));}catch(error){caught=error;}
  assert.ok(caught,'إعادة التقديم مرفوضة');
  assert.equal(caught.code,'service_hidden','الرفض رفض المفتاح، لا رفض خدمة سُحبت نسختها');
  assert.notEqual(caught.code,'service_unavailable','و«لم تعد منشورة» كذبة: الخدمة منشورة، أوقفها المالك');
  const refusal=caught.details.refusal;
  assert.match(refusal.missing[0].why,new RegExp(REASON.slice(0,20)),'وسبب الإيقاف يصل صاحب الطلب');
  assert.equal(refusal.missing[0].owner_role,'catalog.manage','ومالكه هو من يملك المفتاح');
  assert.ok(!/نشر الخدمة/.test(refusal.next),'ولا يُرسَل يطلب نشرًا قائمًا أصلًا');
});

/* ───── (5) applyVariant ──────────────────────────────────────────────────── */
test('مراجعة 5: خيار الخدمة الموقوفة يُرفض برفضٍ مكتوب لا بـfail عارٍ، والخيار الغائب يبقى على رفضه',t=>{
  const {db,users,hide}=fixture(t);
  const group=variantCatalog(db,users.employee).find(g=>g.code==='VAR-LETTER');
  assert.ok(group.options.some(o=>o.code==='salary'),'الخيار معروض قبل الإيقاف');

  hide('service','HR-SALARY-CERT');
  assert.equal(variantCatalog(db,users.employee).find(g=>g.code==='VAR-LETTER').options.some(o=>o.code==='salary'),false,'واختفى من البطاقة بعده');

  // وهذا هو الباب الذي يبلغه من كانت نافذته مفتوحة لحظة قلب المفتاح، أو من أرسل variant في جسم الطلب.
  let caught=null;
  try{applyVariant(db,users.employee,{variant:{group:'VAR-LETTER',option:'salary'},payload:{}});}catch(error){caught=error;}
  assert.ok(caught,'مرفوض');
  assert.equal(caught.code,'service_hidden');
  const refusal=caught.details?.refusal;
  assert.ok(refusal,'رفضٌ مكتوب: ما رُفض، وما الناقص، ومن يملكه، والخطوة التالية');
  assert.equal(refusal.missing[0].owner_role,'catalog.manage');
  assert.match(refusal.missing[0].why,new RegExp(REASON.slice(0,20)));
  assert.ok(!/غير متاحة في دليل شركتك/.test(caught.message),'ولا يُقال إنها خارج دليل الشركة وهي فيه');

  // والخيار الذي لا خدمة له أصلًا يبقى على رفضه القديم: هذا الإصلاح لا يبتلع حالةً أخرى.
  assert.throws(()=>applyVariant(db,users.employee,{variant:{group:'VAR-LETTER',option:'bank'},payload:{}}),code('variant_module'));
  assert.throws(()=>applyVariant(db,users.employee,{variant:{group:'VAR-LETTER',option:'لا-خيار'},payload:{}}),code('variant_unknown'));
});

/* ───── (6) اسم من أوقفها لا معرّف دخوله ──────────────────────────────────── */
test('مراجعة 6: الرفض يسمّي من أوقف الخدمة باسمه، فلا تقول الجملة الواحدة «admin» و«مسؤولة المنصة» عن شخص واحد',t=>{
  const {db,users,tx,hide,service}=fixture(t);
  hide('service','IT-SUPPORT');
  const decider=db.prepare('SELECT name FROM users WHERE id=?').get(users.admin.id).name;
  assert.notEqual(decider,users.admin.id,'اسم الحساب غير معرّف دخوله، وإلا لم يثبت الاختبار شيئًا');

  let caught=null;
  try{tx(()=>wf.createRequest(db,users.employee,{service_id:service('IT-SUPPORT').id,title:'تجريبي: محاولة بعد الإيقاف',
    payload:{issue:'تجريبي: محاولة فتح طلب من خدمة موقوفة',impact:'استفسار'},project_id:null}));}
  catch(error){caught=error;}
  const why=caught.details.refusal.missing[0].why;
  assert.match(why,new RegExp(decider),'السطر الذي يقرؤه الموظف يحمل اسم من أوقفها');
  assert.ok(!new RegExp(`أوقفها ${users.admin.id} `).test(why),'لا معرّف دخوله');
  // ومصدر الجملة واحد: stopNote يقولها لكل من يحتاجها.
  assert.match(stopNote(db,'36t','service','IT-SUPPORT'),new RegExp(decider));
  assert.equal(stopNote(db,'36t','service','HR-LETTER'),'موقوفة من إعدادات الخدمات','وما لم يُتخذ فيه قرار يقول ذلك');
});

/* ───── (7) المركز التخصصي ────────────────────────────────────────────────── */
test('مراجعة 7: المركز النشط يعلّم خدمته الموقوفة بسببها ولا يسمّيها للموظف كأنها تُطلب',t=>{
  const {db,users,tx,hide}=fixture(t);
  const id=tx(()=>proposeCentre(db,users.admin,{key:'admin_facilities'})).id;
  const centre=who=>centresBoard(db,who).centres.find(x=>x.id===id);
  const department=db.prepare("SELECT id FROM departments WHERE tenant_id='36t' AND active=1 LIMIT 1").get().id;
  const owner=db.prepare("SELECT id FROM users WHERE tenant_id='36t' AND active=1 AND role<>'admin' LIMIT 1").get().id;
  const current=centre(users.admin);
  tx(()=>centreAction(db,users.admin,id,'edit_centre',{version:current.version,name:current.name,scope_note:current.scope_note,department_id:department,owner_id:owner}));
  tx(()=>centreAction(db,users.admin,id,'activate_centre',{version:centre(users.admin).version,note:'تجريبي: تفعيل المركز للاختبار الآلي'}));
  const linked=centre(users.employee).services.length;
  assert.ok(linked>1,'للمركز خدمات مربوطة');

  hide('service','ADM-ACCESS-CARD');
  const seen=centre(users.employee);
  assert.equal(seen.status_name,'نشط','المركز النشط يظهر للموظفين');
  assert.equal(seen.services.length,linked,'والصفّ لا يُحذف: المركز النشط لا يبقى بلا خدمة مربوطة');
  const stopped=seen.services.find(s=>s.code==='ADM-ACCESS-CARD');
  assert.equal(stopped.hidden,true,'لكنه معلَّم موقوفًا');
  assert.match(stopped.hidden_reason,new RegExp(REASON.slice(0,20)),'ومعه سبب الإيقاف');
  assert.equal(seen.services.filter(s=>!s.hidden).every(s=>s.hidden===false),true,'وغيره لم يُمَسّ');

  const html=centresUI.render(centresBoard(db,users.employee),uiContext());
  assert.match(html,/موقوفة من الإعدادات: لا تُطلب الآن/,'والشاشة تقولها للموظف');

  // واللوح يعترف بهذا السطح في نصّه، فلا يَعِد بأوسع مما يفعل.
  assert.match(approvalSettings(db,users.admin).availability.note,/المركز التخصصي/);
});

/* ───── (8) و(16) حقول تصل الحمولة وتُرسم ─────────────────────────────────── */
test('مراجعة 8: سبب عدم الإتاحة يُرسم في الرئيسية، فلا يُقرأ «موقوفة» و«سُحبت نسختها» بعبارة واحدة',t=>{
  const {db,users,tx,hide,service}=fixture(t);
  tx(()=>wf.createRequest(db,users.employee,{service_id:service('IT-SUPPORT').id,title:'تجريبي: طلب سابق',
    payload:{issue:'تجريبي: مشكلة سابقة في الشبكة',impact:'استفسار'},project_id:null}));
  hide('service','IT-SUPPORT');
  const used=usedServices(db,users.employee).find(s=>s.code==='IT-SUPPORT');
  assert.match(used.unavailable_reason,/موقوفة من إعدادات الخدمات/,'الحمولة تحمل السبب');

  const html=homeUI.render(homeBoard(db,users.employee),uiContext());
  assert.match(html,/موقوفة من إعدادات الخدمات/,'والشاشة ترسمه بدل العبارة العامة');
  assert.match(html,new RegExp(REASON.slice(0,20)),'بنص قرار المالك كما كتبه');

  // وبالإنجليزية تبقى العبارة العامة: نصّ القرار عربيٌّ كما كتبه صاحبه ولا يُترجَم هنا.
  const en=homeUI.render(homeBoard(db,users.employee),{...uiContext(),lang:'en',tr:(ar,english)=>english??ar});
  assert.match(en,/service not available now/);
});

/* ───── (9) و(14) البحث في 142 صفًّا والعدّاد ──────────────────────────────── */
// applyTableFilters تعيش في app/static/app.mjs (وحدة متصفح بلا تصدير)، فتُقتطع من مصدرها وتُشغَّل على
// DOM صغير مصطنع: ما يُثبت هنا هو سلوك الدالة نفسها التي تشحنها الصفحة، لا نسخة ثانية منها.
function loadFilter(){
  const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function applyTableFilters(selector){');
  assert.ok(start>0,'الدالة موجودة في مصدر الصفحة');
  const end=source.indexOf('\nfunction ',start+1);
  return source.slice(start,end);
}
function fakeDom(){
  const el=(tag,props={})=>({tag,hidden:false,open:false,dataset:{},children:[],...props,
    querySelector(sel){return this.descendants().find(x=>sel.includes('tbody tr')&&x.tag==='tr'&&!x.hidden)??null;},
    descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}});
  const rows=[],cards=[];
  for(let i=0;i<4;i++){
    const card=el('details',{open:i===0});
    for(let j=0;j<3;j++){const tr=el('tr');tr.dataset.filterText=`card${i} row${j} خدمة`;card.children.push(tr);rows.push(tr);}
    cards.push(card);
  }
  const counter=el('span',{textContent:'12'});
  const control=el('input',{value:''});control.dataset.filter='#list';
  const document={querySelectorAll(sel){
    if(sel==='[data-filter="#list"]')return [control];
    if(sel==='#list tbody tr')return rows;
    if(sel==='#list details')return cards;
    if(sel==='[data-filter-count="#list"]')return [counter];
    return [];}};
  return {document,control,rows,cards,counter};
}
test('مراجعة 9 و14: البحث يفتح البطاقة التي بقي فيها صفّ مطابق، ويعيدها إلى حالها حين يُفرَّغ',t=>{
  const {document,control,rows,cards,counter}=fakeDom();
  const run=new Function('document','CSS','selector',loadFilter()+'\napplyTableFilters(selector);');
  const apply=()=>run(document,{escape:s=>s},'#list');

  apply();
  assert.equal(counter.textContent,'12','بلا مرشّح: كل الصفوف غير مخفية');
  assert.deepEqual(cards.map(c=>c.open),[true,false,false,false],'وحال البطاقات كما رسمتها الشاشة');

  // الصفّ المطابق يقع في بطاقة مطوية: كان العدّاد يقول «1» والقارئ لا يرى شيئًا.
  control.value='card2 row1';
  apply();
  assert.equal(counter.textContent,'1','العدّاد يقول واحدًا');
  assert.equal(rows.filter(r=>!r.hidden).length,1);
  assert.equal(cards[2].open,true,'وبطاقته فُتحت فصار الصفّ مرئيًا فعلًا');
  assert.deepEqual(cards.filter((c,i)=>i!==2).map(c=>c.open),[false,false,false],'والبطاقات التي لا صفّ مطابق فيها مغلقة');

  // وحين يُفرَّغ المرشّح تعود كل بطاقة إلى حالها الأول: البحث لا يترك خلفه شاشة مفتوحة لم يطلبها أحد.
  control.value='';
  apply();
  assert.deepEqual(cards.map(c=>c.open),[true,false,false,false]);
  assert.equal(counter.textContent,'12');
});
test('مراجعة 14: عدّاد «المعروض» يبدأ بعدد ما يُرى فعلًا، ومعه الإجمالي',t=>{
  const {db,users,hide}=fixture(t);
  const html=()=>approvalSettingsUI.render({...approvalSettings(db,users.admin),workflow:null},uiContext());
  const shown=text=>Number(text.match(/data-filter-count="#service-switch-list">(\d+)</)[1]);
  const total=text=>Number(text.match(/data-filter-count="#service-switch-list">\d+<\/span> من (\d+)/)[1]);

  const first=html();
  assert.equal(total(first),155,'الإجمالي 142 خدمة و13 ميزة');
  // بلا خدمة موقوفة لا تُفتح بطاقة إدارة واحدة، فالمعروض هو صفوف المزايا وحدها.
  assert.equal(shown(first),13,'والمعروض ما يقع داخل بطاقة مفتوحة، لا مجموع الصفوف');
  assert.ok(shown(first)<total(first),'فلا يَعِد العدّاد بما لا يُرى');

  hide('service','IT-SUPPORT');
  const second=html();
  assert.equal(total(second),155,'الإجمالي لا ينقص بالإيقاف');
  assert.ok(shown(second)>13,'وبطاقة الإدارة التي فيها موقوفة تُفتح، فيرتفع المعروض بصفوفها');
});

/* ───── (11) لوح بطاقات الخدمات ───────────────────────────────────────────── */
test('مراجعة 11: لوح البطاقات يُبقي الموقوفة معلَّمة، والتوليد لا يتخطاها، ولا تُعرض لمن لا يملك التصريح',t=>{
  const {db,users,tx,hide}=fixture(t);
  const before=cardsBoard(db,users.admin).totals;
  assert.equal(before.services,142);assert.equal(before.hidden,0);

  hide('service','FIN-PAYMENT-REQUEST');
  const after=cardsBoard(db,users.admin);
  assert.equal(after.totals.services,142,'البلاطة لا تنقص بلا كلمة');
  assert.equal(after.totals.hidden,1,'ويُقال كم منها موقوفة');
  assert.equal(after.totals.with_module,before.with_module,'ولا تسقط وحدةُ تشغيلها من العدّ');
  assert.equal(after.services.find(s=>s.code==='FIN-PAYMENT-REQUEST').hidden,true,'والصف معلَّم');

  // والموظف لا تُعرض له بطاقة خدمة لا يستطيع طلبها.
  assert.equal(cardsBoard(db,users.employee).services.some(s=>s.code==='FIN-PAYMENT-REQUEST'),false);

  // والتوليد يشمل الموقوفة: بطاقتها هي ما يقرؤه منفّذ طلبها المفتوح.
  const created=tx(()=>draftMissingCards(db,users.admin)).created;
  assert.equal(created,142,'العدد المسجَّل في التدقيق يشمل ما وُلّد لها');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM service_cards WHERE service_code='FIN-PAYMENT-REQUEST'").get().n,1);

  const html=serviceCardsUI.render(cardsBoard(db,users.admin),uiContext());
  assert.match(html,/منها 1 موقوفة/,'والشاشة تقول العدد');

  // وما عرضه اللوح يُفتح: زرّ «عرض البطاقة» على صفّ موقوف لا يردّ 404، وهي شاشة واحدة لا تناقض نفسها.
  const card=serviceCard(db,users.admin,'FIN-PAYMENT-REQUEST');
  assert.equal(card.service.code,'FIN-PAYMENT-REQUEST');
  assert.throws(()=>serviceCard(db,users.employee,'FIN-PAYMENT-REQUEST'),code('not_found'),'والموظف لا يبلغها: لا تُعرض له في اللوح أصلًا');
  assert.ok(verifyAudit(db));
});

/* ───── (12) فصل المهام ───────────────────────────────────────────────────── */
test('مراجعة 12: الخدمة الموقوفة تُقرأ موقوفةً في فصل المهام، لا ناقصةً من الكتالوج',t=>{
  const {db,hide}=fixture(t);
  const before=separationOfDutiesState(db,'36t');
  assert.equal(before.services,22);assert.deepEqual(before.missing,[]);assert.deepEqual(before.stopped,[]);
  assert.equal(before.next,'');

  hide('service','FIN-PAYMENT-REQUEST');
  const after=separationOfDutiesState(db,'36t');
  assert.deepEqual(after.missing,[],'ليست ناقصة: نسختها في الدليل وتحمل الضابط');
  assert.deepEqual(after.stopped,['FIN-PAYMENT-REQUEST'],'بل موقوفة، ولها دلوها');
  assert.equal(after.on,22,'والضابط عليها مشتغل كما كان');
  assert.equal(after.next,'','ولا تُسلَّم خطوةٌ لا تغيّر شيئًا («ثبّت الدليل» لخدمة مثبَّتة)');
});

/* ───── (13) ما لا يبلغه المفتاح ──────────────────────────────────────────── */
test('مراجعة 13: اللوح يسمّي مداخل الطلب التي لا يبلغها ومن يوقفها، فلا يَعِد بأوسع مما يفعل',t=>{
  const {db,users}=fixture(t);
  const codes=new Set(db.prepare("SELECT DISTINCT code FROM services WHERE tenant_id='36t'").all().map(r=>r.code));
  assert.equal(codes.has('HR-LEAVE'),false,'«طلب إجازة» مدخل طلب بلا صفّ في جدول الخدمات');

  const reach=outOfReach(db,'36t');
  assert.deepEqual(reach.map(r=>r.code),['HR-LEAVE'],'وهي الوحيدة اليوم');
  assert.ok(reach[0].owner,'ومعها من يوقفها فعلًا');
  assert.ok(reach[0].stop_how,'وكيف تُوقف');
  assert.equal(approvalSettings(db,users.admin).availability.out_of_reach.length,1,'واللوح يحملها من الخادم');

  const html=approvalSettingsUI.render({...approvalSettings(db,users.admin),workflow:null},uiContext());
  assert.match(html,/خارج مدى المفتاح/,'وتُقرأ على الشاشة لا في وثيقة تسليم');
  assert.match(html,/HR-LEAVE/);

  // والحساب من الجدول نفسه: ما دخل الدليل يومًا سقط من القائمة ولم يبقَ تحذيرًا كاذبًا.
  db.prepare("INSERT INTO services(id,tenant_id,code,version,name_ar,name_en,description,department_id,fields,approval_policy,active) SELECT 'synthetic-leave','36t','HR-LEAVE',1,'طلب إجازة تجريبي','Leave','وصف مصطنع للاختبار',department_id,fields,approval_policy,1 FROM services WHERE code='HR-LETTER' LIMIT 1").run();
  assert.deepEqual(outOfReach(db,'36t'),[],'فلا يبقى في القائمة ما صار في الدليل');
});

/* ───── (15) «اختيار الشركة» عند خيار الطلب ───────────────────────────────── */
test('مراجعة 15: شرط السنة يُقال عند خيار الطلب ولو كانت الميزة مسودة — وهي مسودة اليوم',t=>{
  const {db,users}=fixture(t);
  const row=db.prepare("SELECT status FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='air_ticket' ORDER BY revision DESC LIMIT 1").get();
  assert.equal(row.status,'draft','التذكرة ما زالت مسودة في هذا الكيان، وهي حالُ المنصة اليوم');

  const mine=myBenefits(db,users.employee,users.employee.id);
  const card=mine.benefits.find(b=>b.key==='air_ticket');
  const option=mine.options.find(o=>o.key==='ticket_claim');
  assert.match(card.company_choice,/اختيار الشركة/,'البطاقة تقولها (وكانت تقولها قبل هذه المراجعة)');
  assert.ok(option.company_choice,'والخيار يقولها كذلك: الشرط قائم في الحالين فيُنسب إلى من اختاره في الحالين');
  assert.match(option.company_choice,/اختيار الشركة/);
  assert.match(option.company_choice,/12/,'ويسمّي المدة');
  assert.equal(option.available,false,'والخيار غير متاح لأن الميزة مسودة — وهذا سببٌ آخر يُقال بجواره');

  // وخيارٌ بلا شرط مدة لا يُلصق به كلام لا يخصّه.
  assert.equal(mine.options.find(o=>o.key==='benefit_letter').company_choice,null);
});
