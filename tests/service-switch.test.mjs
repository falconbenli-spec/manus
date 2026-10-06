// مفتاح تفعيل الخدمة وإخفائها (ترحيل 129) — طلب المالك 22 سبتمبر 2026.
//
// «تذكرة السفر السنوية خل عندي خيار اني افعلها او اخفيها من صفحه الاعدادات والصلاحيات لكل خدمه».
//
// المثال الذي ضربه المالك ليس خدمة في الدليل: «تذكرة السفر السنوية» هي الميزة air_ticket في benefit_catalog،
// يبلغها الموظف من خيار الطلب ticket_claim في «مزاياي». فالمفتاح يمسك سجلّين لا سجلًا واحدًا، ولذلك تمشي
// هنا الحالتان: خدمة في الدليل (IT-SUPPORT) وميزة في «مزاياي» (air_ticket) — ومفتاح على services وحدها
// ما كان ليمسّ التذكرة أصلًا، وهي الشيء الوحيد الذي سمّاه.
//
// ما تثبته هذه الملفات، بندًا بندًا:
//   (1) الافتراضي بلا صف «متاحة»: الترحيل لا يُدرج صفًّا، ولا تتغير خدمة لم يمسّها المالك.
//   (2) الإخفاء صادق في كل سطح: الدليل والبحث وبطاقات الخدمة والأزرار السريعة وبوابة الموظف.
//   (3) الإخفاء ليس حذفًا: الطلب المفتوح قبل الإيقاف يكمل اعتماده وتنفيذه وإغلاقه بعده.
//   (4) الرفض مكتوب: من يفتح رابطًا لخدمة موقوفة يُقال له لماذا ومن يعيد تفعيلها، لا «توجد نسخة أحدث».
//   (5) السجل إلحاقي: الإيقاف وإعادة التفعيل قراران بسببيهما، يبقى الاثنان بعد الرجوع.
//   (6) العدّ صادق: ما أُوقف يُقال عدده بجواره، ولا يُقرأ نقصان الرقم تحسّنًا.
//   (7) التصريح مطلوب: «إعداد الخدمات» وحده يدير المفتاح، وسلسلة التدقيق تبقى متصلة.
// البيانات كلها مصطنعة من البذرة التجريبية، وعلى قاعدة بالذاكرة. لا منفذ شبكة هنا عمدًا: الاختبار يمشي
// على الوحدات مباشرة، فيعمل في بيئة لا تأذن بفتح منفذ كما يعمل في غيرها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, approvalSettings, catalogHealth } from '../app/service-catalog.mjs';
import { setAvailability, stateOf, isHidden, availabilityHistory, hiddenServiceCodes } from '../app/service-availability.mjs';
import { portal, usedServices } from '../app/routing.mjs';
import { cardsBoard } from '../app/service-cards.mjs';
import { searchAll, refreshIndex } from '../app/search.mjs';
import { myBenefits, submitBenefitRequest, companyChoiceNote, OPTIONS } from '../app/benefits-portal.mjs';
import { approvalSettingsUI } from '../app/static/approval-settings-ui.mjs';
import { myBenefitsUI } from '../app/static/benefits-portal-ui.mjs';
import { portalPage } from '../app/static/portal-ui.mjs';

const PASSWORD='synthetic-service-switch';
const REASON='تجريبي: قرار المالك 22 سبتمبر 2026 بإيقاف الخدمة حتى تُراجع إجراءاتها';
const RESTORE='تجريبي: قرار المالك 23 سبتمبر 2026 بإعادة تفعيلها بعد مراجعة الإجراء';
const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// سياق الرسم كما تمرّره app.mjs: الشاشة تُرسم تحت Node بلا DOM، فما يُثبت هنا هو ما يراه المالك.
function uiContext(){
  const button=(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  const ui={
    card:({code:c='',title,meta='',open=false,body=''})=>`<details${open?' open':''}><summary>${e(c)} ${e(title)} ${e(meta)}</summary>${body}</details>`,
    table:({head=[],rows=[]})=>rows.length?`<table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`:'<div class="empty"></div>'
  };
  return {e,button,ui};
}

function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);installServiceCatalog(db);
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  return {db,users,tx};
}
const hide=(db,tx,actor,kind,key,reason=REASON)=>tx(()=>setAvailability(db,actor,{kind,target_key:key,state:'hidden',reason}));
const show=(db,tx,actor,kind,key,reason=RESTORE)=>tx(()=>setAvailability(db,actor,{kind,target_key:key,state:'available',reason}));

/* ───── (1) الافتراضي: متاحة بلا صف ───────────────────────────────────────── */
test('المفتاح: بلا قرار لا صف، وكل خدمة وكل ميزة متاحة بالافتراض، والدليل كما كان', t=>{
  const {db,users}=fixture(t);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_availability').get().n,0,'الترحيل لا يُدرج صفًّا واحدًا');
  assert.equal(stateOf(db,'36t','service','IT-SUPPORT'),'available','بلا صف: متاحة');
  assert.equal(stateOf(db,'36t','benefit','air_ticket'),'available','بلا صف: متاحة');
  assert.equal(isHidden(db,'36t','service','IT-SUPPORT'),false);
  assert.equal(hiddenServiceCodes(db,'36t').size,0);
  // رمز لم يُذكر قط يُقرأ متاحًا لا مجهولًا: الغياب ليس حالة ثالثة.
  assert.equal(stateOf(db,'36t','service','NO-SUCH-CODE'),'available');
  const full=wf.catalog(db,users.employee);
  assert.equal(full.length,142,'الدليل كامل: 142 خدمة');
  assert.equal(portal(db,users.employee,{requests:[],projects:[],leave:[]}).catalog_size,142);
});

/* ───── (2) الإخفاء صادق في كل سطح ────────────────────────────────────────── */
test('المفتاح: الخدمة الموقوفة تختفي من الدليل والبوابة والبطاقات والبحث، ولا تختفي من غيرها', t=>{
  const {db,users,tx}=fixture(t);
  const before=wf.catalog(db,users.employee).length;
  hide(db,tx,users.admin,'service','IT-SUPPORT');

  // الدليل: 19 سطحًا من 20 يمرّ من catalog، فسقوطها هنا يغطيها دفعة واحدة.
  const after=wf.catalog(db,users.employee);
  assert.equal(after.length,before-1,'خدمة واحدة سقطت من الدليل');
  assert.equal(after.some(s=>s.code==='IT-SUPPORT'),false,'IT-SUPPORT ليست في دليل الموظف');
  assert.ok(after.some(s=>s.code==='HR-LETTER'),'ما لم يُمسّ باقٍ كما هو');

  // بوابة الموظف: العدد ينقص، ويُقال كم أُوقف بجواره لا يُطرح صامتًا.
  const board=portal(db,users.employee,{requests:[],projects:[],leave:[]});
  assert.equal(board.catalog_size,before-1);
  assert.equal(board.catalog_hidden,1,'البوابة تقول كم خدمة موقوفة');
  assert.equal(board.quick_services.some(s=>s.code==='IT-SUPPORT'),false);
  assert.equal(board.department_services.some(s=>s.code==='IT-SUPPORT'),false);

  // بطاقات الخدمة.
  //
  // ⚠ تأكيدان في هذا الموضع نقضتهما المراجعة المستقلة (22 سبتمبر 2026، الملاحظة 11 — الموثّقة في
  // docs/implementation/handoff/service-switch.md §8-ب). كانا يقولان: «لا بطاقة لخدمة موقوفة»
  // و«عدّ البطاقات يتبع الدليل» — أي totals.services ينزل من 142 إلى 141. وقاس المراجعون أن هذا
  // هو نفسه العطب الذي أُضيف `hidden_checked` و`catalog_hidden` في هذا الفرع لمنعه: ثلاث بلاطات
  // («خدمة في الدليل» و«بلا بطاقة» و«لها شاشة تشغيل كاملة») تهبط معًا بلا كلمة واحدة تقول لماذا،
  // و`draftMissingCards` يتخطى الموقوفة فتبقى بلا بطاقة — وبطاقتها هي ما يقرؤه منفّذ طلبها المفتوح.
  //
  // فصار اللوح يقرأ الجميع ويعلّم الموقوفة ويقول عددها، ويبقى **الموظف** وحده لا تُعرض له بطاقة
  // خدمة لا يستطيع طلبها. عُدِّل التأكيدان إلى هذه القاعدة، ولم يُحذف منهما شيء: ما كانا يحرسانه
  // (ألّا تصل بطاقةُ خدمةٍ موقوفة إلى من لا يستطيع طلبها) محروسٌ أدناه بالحرف.
  // هذا الملف ليس مسجَّلًا في REQUIREMENTS.json ولا traceability.json (فُحص)، وكُتب في b60748e من
  // هذا الفرع نفسه غير المدموج. التعديل معلن هنا وفي وثيقة التسليم وفي STATUS وفي رسالة الالتزام.
  const cards=cardsBoard(db,users.admin);
  assert.ok(cards.services.some(c=>c.code==='IT-SUPPORT'),'حامل التصريح يرى الموقوفة: بطاقتها تخدم طلباتها المفتوحة');
  assert.equal(cards.services.find(c=>c.code==='IT-SUPPORT').hidden,true,'معلَّمة موقوفة');
  assert.equal(cards.totals.services,before,'والعدّ لا ينزل بلا كلمة');
  assert.equal(cards.totals.hidden,1,'بل يُقال كم منها موقوفة');
  assert.equal(cardsBoard(db,users.employee).services.some(c=>c.code==='IT-SUPPORT'),false,'ولا تُعرض بطاقتها لمن لا يستطيع طلبها');

  // البحث: المرشّح في شرط النطاق لا في بناء الفهرس، فيسري لحظة الإخفاء لا بعد خمس عشرة ثانية.
  tx(()=>refreshIndex(db,users.employee,{explicit:true,maxAgeMs:0}));
  const hits=searchAll(db,users.employee,'دعم تقني',{limit:50}).results??[];
  assert.equal(hits.some(r=>r.type==='service'&&r.title?.includes('دعم تقني')),false,'الخدمة الموقوفة لا تُبحث');

  // ولا تختفي من فحص الدليل: لها طلبات تمشي، فلو سقطت من الفحص لصار «لا ملاحظات» يعني «لم نَنظر».
  const health=catalogHealth(db,'36t');
  assert.equal(health.services_checked,before,'الفحص يشمل الموقوفة: العدد لم ينقص');
  assert.equal(health.hidden_checked,1,'ويُقال كم منها موقوفة');

  // والرقم المعروض في بوابة الموظف يقول نقصانه: «141 خدمة» وحدها تُقرأ كتالوجًا أصغر، لا كخدمة أُوقفت.
  const html=portalPage(board,{e,date:()=>'2026-09-22'});
  assert.match(html,/141 خدمة في مساحات الإدارات، و1 موقوفة من الإعدادات/,'العدد يُقال ومعه ما أُوقف');
});

/* ───── (3) الإخفاء ليس حذفًا ─────────────────────────────────────────────── */
test('المفتاح: طلب فُتح قبل الإيقاف يكمل اعتماده وتنفيذه بعده، ولا يتوقف منه شيء', t=>{
  const {db,users,tx}=fixture(t);
  const service=wf.catalog(db,users.employee).find(s=>s.code==='IT-SUPPORT');
  const request=tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'تجريبي: تعطّل الطابعة',
    payload:{issue:'تجريبي: الطابعة لا تستجيب منذ الصباح',impact:'يؤخر العمل'},project_id:null}));
  tx(()=>wf.transition(db,users.employee,request.id,'submit',{version:wf.detail(db,users.employee,request.id).version}));
  assert.equal(wf.detail(db,users.employee,request.id).status,'pending','الطلب قُدّم قبل الإيقاف');

  hide(db,tx,users.admin,'service','IT-SUPPORT');

  // getService بالمعرّف وبلا مرشّح المفتاح عمدًا: الطلب ما زال يحلّ خدمته بعد الإيقاف.
  const detail=wf.detail(db,users.employee,request.id);
  assert.equal(detail.service_code??detail.service?.code,'IT-SUPPORT','الطلب ما زال يعرف خدمته');
  assert.equal(detail.status,'pending','ولم تتغير حالته بالإيقاف');

  // المسار يكمل: اعتماد المدير ثم التنفيذ.
  tx(()=>wf.transition(db,users.manager,request.id,'approve',{version:detail.version,note:'تجريبي: معتمد من المدير بعد الإيقاف'}));
  const afterApproval=wf.detail(db,users.it,request.id);
  assert.ok(['approved','in_progress'].includes(afterApproval.status),`الاعتماد مضى بعد الإيقاف (${afterApproval.status})`);
  assert.ok(verifyAudit(db),'سلسلة التدقيق متصلة');
});

/* ───── (4) الرفض المكتوب ─────────────────────────────────────────────────── */
test('المفتاح: فتح طلب جديد من خدمة موقوفة يُرفض برفضٍ يسمّي السبب ومن يعيد التفعيل، لا «نسخة أحدث»', t=>{
  const {db,users,tx}=fixture(t);
  const service=wf.catalog(db,users.employee).find(s=>s.code==='IT-SUPPORT');
  hide(db,tx,users.admin,'service','IT-SUPPORT');
  let caught=null;
  try{tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'تجريبي: محاولة بعد الإيقاف',
    payload:{issue:'تجريبي: محاولة فتح طلب من خدمة موقوفة',impact:'استفسار'},project_id:null}));}
  catch(error){caught=error;}
  assert.ok(caught,'الطلب مرفوض');
  assert.equal(caught.code,'service_hidden','رمز الرفض يخص الإيقاف لا القِدَم');
  assert.notEqual(caught.code,'service_outdated','لا يُقال «توجد نسخة أحدث» عن نسخة لا وجود لها');
  const refusal=caught.details?.refusal;
  assert.ok(refusal,'الرفض مكتوب لا رسالة وحدها');
  assert.match(refusal.what,/موقوفة/,'يقول ما الذي رُفض ولماذا');
  assert.ok(refusal.missing.length,'يسمّي الناقص');
  assert.equal(refusal.missing[0].owner_role,'catalog.manage','ومالكه هو تصريح إعداد الخدمات');
  assert.match(refusal.missing[0].why,new RegExp(REASON.slice(0,20)),'ويحمل سبب الإيقاف كما كُتب');
  assert.ok(refusal.missing[0].owner,'ويسمّي من يعيد التفعيل');
  assert.ok(refusal.next,'وما الخطوة التالية');
});

/* ───── (5) السجل الإلحاقي وإعادة التفعيل ─────────────────────────────────── */
test('المفتاح: إعادة التفعيل تُرجع الخدمة، ويبقى القراران بسببيهما في سجل لا يُمحى', t=>{
  const {db,users,tx}=fixture(t);
  hide(db,tx,users.admin,'service','IT-SUPPORT');
  assert.equal(wf.catalog(db,users.employee).some(s=>s.code==='IT-SUPPORT'),false);
  show(db,tx,users.admin,'service','IT-SUPPORT');
  assert.ok(wf.catalog(db,users.employee).some(s=>s.code==='IT-SUPPORT'),'عادت إلى الدليل');
  assert.equal(stateOf(db,'36t','service','IT-SUPPORT'),'available');

  const history=availabilityHistory(db,'36t').filter(h=>h.target_key==='IT-SUPPORT');
  assert.equal(history.length,2,'قراران لا واحد: الإخفاء لا يُمحى بإعادة التفعيل');
  assert.equal(history[0].state,'available');assert.equal(history[0].reason,RESTORE);
  assert.equal(history[1].state,'hidden');assert.equal(history[1].reason,REASON);

  // صفٌّ لا يغيّر شيئًا ليس قرارًا: يُردّ في الوحدة قبل أن يصل القادح.
  assert.throws(()=>show(db,tx,users.admin,'service','IT-SUPPORT'),code('already_in_state'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM service_availability WHERE target_key='IT-SUPPORT'").get().n,2,'ولم يُضف صف ثالث');
  // والسجل إلحاقي في القاعدة نفسها لا في الوحدة وحدها.
  assert.throws(()=>db.prepare("UPDATE service_availability SET reason='محاولة تعديل' WHERE target_key='IT-SUPPORT'").run(),/append only/);
  assert.throws(()=>db.prepare("DELETE FROM service_availability WHERE target_key='IT-SUPPORT'").run(),/append only/);
  assert.ok(verifyAudit(db),'سلسلة التدقيق متصلة بعد القرارين');
});

/* ───── (6) الميزة: «تذكرة السفر السنوية» نفسها ───────────────────────────── */
test('المفتاح: الميزة الموقوفة تختفي من «مزاياي» عن الموظف، ويُرفض طلبها برفضٍ مكتوب', t=>{
  const {db,users,tx}=fixture(t);
  const ticket=OPTIONS.find(o=>o.key==='ticket_claim');
  assert.equal(ticket.benefit,'air_ticket','المثال الذي ضربه المالك ميزة لا خدمة في الدليل');

  const before=myBenefits(db,users.employee,users.employee.id);
  assert.ok(before.benefits.some(b=>b.key==='air_ticket'),'التذكرة معروضة قبل الإيقاف');

  hide(db,tx,users.admin,'benefit','air_ticket');

  const after=myBenefits(db,users.employee,users.employee.id);
  assert.equal(after.benefits.some(b=>b.key==='air_ticket'),false,'اختفت عن الموظف');
  assert.equal(after.switched_off_count,1,'ويُقال عددها لا تُطرح صامتة');
  const option=after.options.find(o=>o.key==='ticket_claim');
  assert.equal(option.available,false,'ولا يُفتح منها خيار طلب');
  assert.equal(option.switched_off,true);
  assert.match(option.reason,/موقوفة من إعدادات الخدمات/,'والسبب يُقرأ في الشاشة');

  // حامل تصريح المزايا يراها ومعه سبب الإيقاف: يعرف لماذا اختفت عن موظفيه.
  const hrView=myBenefits(db,users.hr,users.hr.id);
  const seen=hrView.benefits.find(b=>b.key==='air_ticket');
  assert.ok(seen,'الموارد البشرية ترى الموقوفة');
  assert.equal(seen.switched_off,true);
  assert.match(seen.switched_off_reason,/موقوفة/);

  // والطلب يُرفض رفضًا مكتوبًا: هذا باب من يفتح رابطًا قديمًا #my-benefits/new?option=ticket_claim.
  let caught=null;
  const claim={option:'ticket_claim',details:{mode:'ticket',destination:'تجريبي: الرياض',travel_from:'2026-10-01',travel_to:'2026-10-10'}};
  try{tx(()=>submitBenefitRequest(db,users.employee,claim));}
  catch(error){caught=error;}
  assert.ok(caught,'الطلب مرفوض');
  assert.equal(caught.code,'service_hidden');
  assert.equal(caught.details?.refusal?.missing?.[0]?.owner_role,'catalog.manage','ويسمّي من يعيد التفعيل');

  // وإعادة التفعيل تُرجعها كما كانت.
  show(db,tx,users.admin,'benefit','air_ticket');
  assert.ok(myBenefits(db,users.employee,users.employee.id).benefits.some(b=>b.key==='air_ticket'),'عادت بعد التفعيل');
});

/* ───── (7) التصريح ──────────────────────────────────────────────────────── */
test('المفتاح: لا يديره إلا من يملك «إعداد الخدمات»، والرفض يسمّي التصريح ومن يمنحه', t=>{
  const {db,users,tx}=fixture(t);
  for(const who of ['employee','manager','hr','it']){
    let caught=null;
    try{hide(db,tx,users[who],'service','IT-SUPPORT');}catch(error){caught=error;}
    assert.ok(caught,`${who} لا يدير المفتاح`);
    assert.equal(caught.code,'not_permitted',`${who}: الرفض بالتصريح`);
    assert.equal(caught.details?.refusal?.missing?.[0]?.owner_role,'catalog.manage');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_availability').get().n,0,'ولم يُكتب صف واحد من المحاولات');
  // والكتابة تحتاج معاملة: لا قرار يُكتب خارج معاملة ولا خارج سلسلة التدقيق.
  assert.throws(()=>setAvailability(db,users.admin,{kind:'service',target_key:'IT-SUPPORT',state:'hidden',reason:REASON}),code('transaction_required'));
  // ولا يُخفى ما لا وجود له: مفتاح مكتوب خطأ كان سيصير صفًّا صامتًا لا يوقف شيئًا.
  assert.throws(()=>hide(db,tx,users.admin,'service','NO-SUCH-CODE'),code('not_found'));
  assert.throws(()=>hide(db,tx,users.admin,'benefit','no_such_benefit'),code('not_found'));
});

/* ───── (8) الشاشة ───────────────────────────────────────────────────────── */
test('المفتاح: شاشة «إعداد الاعتماد» ترسم اللوح لحامل التصريح وحده، بحالة كل صف وقراره وزرّه', t=>{
  const {db,users,tx}=fixture(t);
  hide(db,tx,users.admin,'service','IT-SUPPORT');
  const data={...approvalSettings(db,users.admin),workflow:null};
  assert.ok(data.availability?.can_manage,'مسؤولة المنصة تملك المفتاح');
  assert.equal(data.availability.totals.services_hidden,1);
  assert.ok(data.availability.benefits.some(b=>b.key==='air_ticket'),'والمزايا في اللوح نفسه');

  const html=approvalSettingsUI.render(data,uiContext());
  assert.match(html,/تفعيل الخدمات وإخفاؤها/,'القسم معنون في الشاشة');
  assert.match(html,/IT-SUPPORT/,'والخدمة الموقوفة معروضة لا مخفية عن مالك المفتاح');
  assert.match(html,/خدمة موقوفة من/,'والعدد يُقال صراحة');
  assert.match(html,/data-operation="switch_availability" data-id="service\|IT-SUPPORT"/,'وزرّها يحمل نوعها ومفتاحها');
  assert.match(html,/data-id="benefit\|air_ticket"/,'ولتذكرة السفر زرّها، وهي المثال الذي ضربه المالك');
  assert.match(html,new RegExp(REASON.slice(0,20)),'وسبب القرار يُقرأ في الصف');
  assert.match(html,/data-filter="#service-switch-list"/,'وبحثٌ واحد لأنها 142 صفًّا');

  // النموذج: الحالة المطلوبة نقيض السارية، فلا يُختار ما هو قائم ثم يُردّ.
  const form=approvalSettingsUI.form('switch_availability','service|IT-SUPPORT',data);
  assert.match(form.title,/إعادة تفعيل/,'الموقوفة يُعرض عليها التفعيل');
  assert.equal(form.endpoint,'/approval-settings/availability');
  assert.deepEqual(form.toPayload({reason:RESTORE}),{kind:'service',target_key:'IT-SUPPORT',state:'available',reason:RESTORE});
  const hiding=approvalSettingsUI.form('switch_availability','service|HR-LETTER',data);
  assert.match(hiding.title,/إيقاف/,'والمتاحة يُعرض عليها الإيقاف');
  assert.equal(hiding.toPayload({reason:REASON}).state,'hidden');

  // ومن لا يملك التصريح لا تُرسم له الشاشة أفعالًا لا يملكها: مديرة الإدارة تدخل الشاشة لبابٍ واحد
  // (أزمنة خدمات إدارتها)، فلا يصلها لوح المفاتيح أصلًا من الخادم ولا يُرسم لها قسمه.
  const managerData={...approvalSettings(db,users.manager),workflow:null};
  assert.equal(managerData.availability,undefined,'الخادم لا يرسل اللوح لغير نطاق الكيان');
  assert.equal(approvalSettingsUI.render(managerData,uiContext()).includes('تفعيل الخدمات وإخفاؤها'),false,'ولا يُرسم القسم');
  // وحاملة تصريح المزايا لا تفتح الشاشة أصلًا: بابها «إدارة المزايا» لا «إعداد الاعتماد».
  assert.throws(()=>approvalSettings(db,users.hr),code('not_permitted'));
});

/* ───── (10) شرط السنة: اختيار الشركة لا نص اللائحة ───────────────────────── */
// م39/2 تحيل مصروفات إركاب العامل وأسرته إلى «ما يتفق عليه في عقد العمل» ولا تذكر مدة خدمة قبل أول تذكرة،
// وم41 تحدد الدرجة لا المدة. فسنة الخدمة المسجَّلة على «تذكرة السفر السنوية» اختيار الشركة. سُئل المالك
// أيُبقيها أم يُسقطها فطلب مفتاحًا بدل الجواب، فالشرط باقٍ كما هو — وما يتغير أنه يُنسب إلى من اختاره.
test('شرط السنة: يُقال إنه اختيار الشركة لا حكم اللائحة، في «مزاياي» وفي الشاشة التي يُعدَّل منها', t=>{
  const {db,users,tx}=fixture(t);
  const raw=db.prepare("SELECT * FROM benefit_catalog WHERE benefit_key='air_ticket' ORDER BY revision DESC LIMIT 1").get();
  assert.equal(raw.source_kind,'regulation','التذكرة ميزة مصدرها اللائحة');
  assert.equal(JSON.parse(raw.rules).min_tenure_months,12,'وعليها شرط اثني عشر شهرًا');

  // النص يُقرأ من الصف الخام كما يُقرأ من المفكوك: ملاحظة تسقط لأن المستدعي لم يفكّ الصف لا تُقال حين تلزم.
  const note=companyChoiceNote(raw);
  assert.ok(note,'الصف الخام يُقرأ أيضًا');
  assert.match(note,/اختيار الشركة/,'يُنسب الشرط إلى الشركة');
  assert.match(note,/لا تحدد مدة خدمة/,'ويقول إن المادة لا تضع مدة');
  assert.match(note,/12/,'ويسمّي المدة التي اختارتها');

  // الشرط باقٍ: لم يُحذف ولم يُخفَّض. هذا ما طلبه المالك — مفتاح، لا إسقاط للشرط.
  const card=myBenefits(db,users.employee,users.employee.id).benefits.find(b=>b.key==='air_ticket');
  assert.equal(JSON.parse(raw.rules).min_tenure_months,12,'الشرط لم يُمَسّ');
  assert.ok(card.company_choice,'ويُقرأ في بطاقة الميزة بجوار أهليتها');

  // ويُقال في «مزاياي» بنصه.
  const html=myBenefitsUI.render(myBenefits(db,users.employee,users.employee.id),uiContext());
  assert.match(html,/من اختار هذا الشرط/,'العنوان في الشاشة');
  assert.match(html,/اختيار الشركة/,'ونصه');

  // والقاعدة عامة لا استثناءً لسطر واحد: ميزة أخرى مصدرها اللائحة وعليها مدة خدمة تُقرأ الشيء نفسه،
  // وميزةٌ بلا شرط مدة لا يُلصق بها كلام لا يخصّها.
  const noTenure={source_kind:'regulation',article:'م95',rules:{}};
  assert.equal(companyChoiceNote(noTenure),null,'بلا شرط مدة: لا ملاحظة');
  assert.equal(companyChoiceNote({source_kind:'policy',article:'مرفق 1',rules:{min_tenure_months:6}}),null,'وما ليس مصدره اللائحة لا يُقال فيه ذلك');
});

/* ───── (9) الأزرار السريعة: «موقوفة» غير «سُحبت نسختها» ──────────────────── */
test('المفتاح: الخدمة المستعملة سابقًا تبقى في تاريخ صاحبها معلَّمة موقوفة بسببها، ولا يُفتح منها طلب', t=>{
  const {db,users,tx}=fixture(t);
  const service=wf.catalog(db,users.employee).find(s=>s.code==='IT-SUPPORT');
  tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'تجريبي: طلب سابق',
    payload:{issue:'تجريبي: مشكلة سابقة في الشبكة',impact:'استفسار'},project_id:null}));
  assert.ok(usedServices(db,users.employee).find(s=>s.code==='IT-SUPPORT')?.available,'قبل الإيقاف: متاحة');

  hide(db,tx,users.admin,'service','IT-SUPPORT');
  const used=usedServices(db,users.employee).find(s=>s.code==='IT-SUPPORT');
  assert.ok(used,'تبقى في تاريخه: الإخفاء ليس حذفًا');
  assert.equal(used.available,false,'ولا يُفتح منها طلب جديد');
  assert.equal(used.hidden,true);
  assert.match(used.unavailable_reason,/موقوفة من إعدادات الخدمات/,'ويُقال لماذا: «موقوفة» غير «لم تعد في الدليل»');
});
