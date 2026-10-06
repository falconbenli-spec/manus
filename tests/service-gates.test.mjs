// شرط أهلية الخدمة (ترحيل 138) — 24 سبتمبر 2026.
//
// العطب الذي يمنعه هذا الملف من العودة مكتوبٌ بثلاث جمل:
//   (1) العمودان required_capability وdepartment_id في catalog_placement موجودان منذ 131، ولم يقرأهما
//       **مرشّح ظهور واحد**. قارئهما الوحيد eligibilityFrom في app/service-cards.mjs، تطبعهما للموظف
//       نصًّا: «لازم يكون بحسابك تصريح كذا». فالبطاقة كانت تعد بحصرٍ لا يفرضه أحد.
//   (2) والشرط لو سكن في الإسقاط وحده لمحاه أولُ تشغيلة مثبّت: projectCatalog يمحو صفوف الكيان كلها
//       ويعيد بناءها. فالقرار في service_gate، والإسقاط صورته، والبناء يعيد وضعها.
//   (3) وأخطر ما في الباب ليس أن يُفتح لمن لا يملكه، بل أن **ينقلب الاحتياط قفلًا**: خدمةٌ لا صفَّ لها
//       في الإسقاط تبقى ظاهرة للجميع (قاعدة 131)، وإسقاطٌ فارغ يعني دليلًا كاملًا لا شاشةً بيضاء.
//       هذا آخر اختبار في الملف، وهو الذي يقول متى صار الإصلاح أسوأ من العطب.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalog, createRequest } from '../app/workflow.mjs';
import { projectCatalog, placementFor } from '../app/catalog-tree.mjs';
import { visibleSql, gatesFor, currentGates, audiencesFor } from '../app/service-availability.mjs';
import { deriveGates, shadowCompareGates, setServiceGate, applyProposal, gatesBoard, guardedChannels, enforcedCapabilityFor, OPEN_REASONS } from '../app/service-gates.mjs';
import { CAPABILITIES } from '../app/access.mjs';
import { MODULE_SERVICES } from '../app/static/module-services.mjs';
import { grantAccess } from '../app/access.mjs';
import { searchAll, refreshIndex } from '../app/search.mjs';
import { serviceGatesSection, serviceGatesForm } from '../app/static/service-gates-ui.mjs';
import { kit } from '../app/static/kit.mjs';

// الخدمة التي تُشرَط في هذه الاختبارات: طلب شراء. اختيارها ليس اعتراضًا على كونها مفتوحة اليوم —
// الاشتقاق لا يقترح عليها شيئًا — بل لأنها خدمة عادية بلا سرّية ولا قناة مغلقة، فتقيس الشرط وحده.
const CODE='PRC-PURCHASE-REQUEST';
// تصريح يُمنح فعلًا ولا يحمله كل موظف، فيصلح شرطًا يفرّق بين حسابين.
const CAP='procurement.use';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-service-gates');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users};
}
const seen=(db,u)=>new Set(catalog(db,u).map(s=>s.code));
const gate=(db,users,input)=>transaction(db,()=>setServiceGate(db,users.admin,input));

/* ───── الاشتقاق ───────────────────────────────────────────────────────────── */

test('الاشتقاق: يقترح حيث تعرف المنصة شرطًا، ويسمّي سبب البقاء مفتوحًا حيث لا تعرف', t=>{
  const {db}=fixture(t);
  const derived=deriveGates(db,'36t');
  assert.equal(derived.counts.placements,derived.proposals.length+derived.open.length,'كل صف إمّا اقتراح وإمّا سببٌ مكتوب: لا صفَّ بلا جواب');
  // على الحال الراهن: لا تصريح يفرضه الكود على أي خدمة، فالاقتراح صفر — وهذا **قياس** لا افتراض.
  // مدخل الطلب الوحيد createRequest لا ينادي can لأي خدمة، وخدمة الوحدة الوحيدة (HR-LEAVE) تصريحها
  // leave.use يحمله كل موظف. لو أُضيفت غدًا شاشةُ وحدةٍ بتصريح يُمنح، ارتفع هذا الرقم وحده.
  assert.equal(derived.counts.with_capability,0,'ما فيه تصريح يرفض طلب خدمة اليوم');
  assert.equal(derived.counts.with_department,0,'وإدارة الخدمة في التعريف هي المنفّذة لا الطالبة، فلا تُقرأ حصرًا');
  assert.equal(derived.counts.stays_open,derived.counts.placements);
  // ولا يبقى بندٌ مفتوحًا بلا سبب مسمّى: الفراغ يُقرأ سهوًا، والسبب المكتوب يُقرأ قرارًا.
  for(const row of derived.open)assert.ok(row.reason&&row.reason.length>20,`${row.code} مفتوح بلا سبب مكتوب`);
  assert.ok(derived.by_reason.confidential_channel>0,'والقناة السرية سببها الخاص لا سبب البقية');
  assert.ok(derived.by_reason.not_a_service>0,'ومجموعات الخيارات وبند الوحدة ليست رموز خدمات');
});

test('الاشتقاق: قاعدة التصريح حيّة لا ميتة — صفرُها اليوم سببه مقيس، ويتحرك لو تحرّك سببه', t=>{
  fixture(t);
  // القاعدة تقرأ خدمات الوحدات المخصصة: شاشتها لا تُفتح لمن لا يحمل تصريحها، فهو تصريحٌ يرفض الطلب فعلًا.
  // والوحيدة اليوم HR-LEAVE، وتصريحها leave.use **يحمله كل موظف**، فلا يرفض أحدًا فلا يُقترح شرطًا.
  // فلو أُضيفت غدًا شاشةُ وحدةٍ بتصريح يُمنح، أعطت القاعدة نفسها اقتراحًا بلا تعديل حرف فيها — وهذا
  // ما يفرّق «صفرٌ مقيس» عن «قاعدة لا تُطلِق أبدًا».
  assert.equal(MODULE_SERVICES.length,1,'خدمة وحدة واحدة اليوم؛ إن زادت فأعد قراءة هذا الرقم');
  assert.equal(MODULE_SERVICES[0].capability,'leave.use');
  assert.equal(CAPABILITIES.find(c=>c.key==='leave.use')?.everyone,true,'وهو من تصاريح «الجميع»، وهذا سبب الصفر');
  assert.equal(enforcedCapabilityFor('HR-LEAVE'),null,'فلا يُقترح شرطًا');
  assert.equal(enforcedCapabilityFor('PRC-PURCHASE-REQUEST'),null,'وخدمةٌ بلا شاشة وحدة لا تصريح يرفض طلبها');
  // والمقياس هو الرفض الفعلي: تصريحٌ لا يحمله الجميع يمرّ من القاعدة نفسها.
  assert.ok(CAPABILITIES.some(c=>c.key===CAP&&!c.everyone),`${CAP} يُمنح فعلًا، فيصلح شرطًا`);
});

test('الاشتقاق: القناة السرية محروسة — لا تُقترح ولا تُوضع باليد', t=>{
  const {db,users}=fixture(t);
  const guarded=guardedChannels(db,'36t').map(g=>g.code);
  assert.deepEqual(guarded.sort(),['HR-GRIEVANCE','LEG-WHISTLEBLOW'],'قناتا البلاغ والتظلّم وحدهما');
  const derived=deriveGates(db,'36t');
  for(const code of guarded){
    assert.ok(!derived.proposals.some(p=>p.code===code),`${code} لا يُقترح عليه شرط`);
    assert.equal(derived.open.find(o=>o.code===code)?.reason,OPEN_REASONS.confidential_channel);
  }
  // والباب يرفض ما يرفضه الاشتقاق: وإلّا صار الزر يفعل ما تمنعه القاعدة.
  assert.throws(()=>gate(db,users,{service_code:'HR-GRIEVANCE',required_capability:CAP,department_id:null,
    basis:'محاولة حصر قناة التظلّم في اختبار'}),e=>e.code==='closed_circle'&&e.details.refusal.missing.length>0);
});

/* ───── الأثر: ما يُخفى وما يُرفض ─────────────────────────────────────────── */

test('الشرط: الخدمة المشروطة تختفي عمّن لا يحمل تصريحها وتبقى لمن يحمله، تصفّحًا وبحثًا وطلبًا', t=>{
  const {db,users}=fixture(t);
  assert.ok(seen(db,users.employee).has(CODE),'قبل الشرط: يراها الموظف');
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'outsider',capability:CAP,department_id:null,note:'اختبار شرط الأهلية'}));
  gate(db,users,{service_code:CODE,required_capability:CAP,department_id:null,basis:'اختبار: طلبات الشراء لحاملي تصريح المشتريات'});

  const holder=db.prepare("SELECT * FROM users WHERE id='outsider'").get();
  assert.equal(seen(db,users.employee).has(CODE),false,'تختفي عمّن لا يحمل التصريح');
  assert.ok(seen(db,holder).has(CODE),'وتبقى لمن يحمله');
  // والتصفّح والبحث يتبعان الدليل، لأن الشرط واحد داخل visibleSql لا ثلاثة مرشّحات بجوار بعضها.
  const tree=who=>new Set(placementFor(db,'36t',audiencesFor(who),gatesFor(db,who)).rows.map(r=>r.item_key));
  assert.equal(tree(users.employee).has(CODE),false,'ولا تظهر في الشجرة');
  assert.ok(tree(holder).has(CODE),'وتظهر لحاملها');
  transaction(db,()=>refreshIndex(db,users.admin,{explicit:true,maxAgeMs:0}));
  const hit=who=>(searchAll(db,who,'طلب شراء',{limit:50}).groups.find(g=>g.key==='service')?.results??[]).some(r=>r.title==='طلب شراء');
  assert.equal(hit(users.employee),false,'ولا في البحث');
  assert.ok(hit(holder),'ويجدها حاملها في البحث');

  // والطلب يُردّ برفضٍ مكتوب يسمّي الناقص ومالكه — لا بـ«توجد نسخة أحدث من الخدمة».
  const service=db.prepare("SELECT id FROM services WHERE tenant_id='36t' AND code=? ORDER BY version DESC LIMIT 1").get(CODE);
  assert.throws(()=>transaction(db,()=>createRequest(db,users.employee,{service_id:service.id,title:'شراء اختبار',
    payload:{items:'ورق تصوير 5 علب',estimated_cost:'500',project:'مركز تكلفة تجريبي',needed_by:'2026-12-01'}})),
    error=>{
      assert.equal(error.code,'service_gated');
      assert.notEqual(error.code,'service_outdated','«توجد نسخة أحدث» كذبة: لا نسخة أحدث ولا شيء');
      assert.ok(error.details.refusal.missing.some(m=>m.document.includes('تصريح')),'الرفض يسمّي التصريح الناقص');
      assert.ok(error.details.refusal.missing.every(m=>m.owner),'ولكل ناقصٍ مالكٌ يُطلب منه');
      return true;
    });
});

test('الشرط: الحصر بإدارة يخفي الخدمة عن غير منسوبيها', t=>{
  const {db,users}=fixture(t);
  gate(db,users,{service_code:CODE,required_capability:'',department_id:'it',
    basis:'اختبار: طلبات الشراء إجراء داخلي للدعم التقني'});
  assert.ok(seen(db,users.it).has(CODE),'منسوب الإدارة يراها');
  assert.equal(seen(db,users.employee).has(CODE),false,'ومن هو خارجها لا يراها');
  assert.equal(seen(db,users.hr).has(CODE),false);
  // ورفعُ الشرط قرارٌ ثانٍ يعيدها للجميع، والقراران يبقيان في السجل.
  gate(db,users,{service_code:CODE,required_capability:'',department_id:null,basis:'اختبار: رفع الحصر عن طلبات الشراء'});
  assert.ok(seen(db,users.employee).has(CODE),'ترجع بعد رفع الشرط');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_gate').get().n,2,'والقراران كلاهما في السجل');
});

/* ───── المقارنة الظلية ────────────────────────────────────────────────────── */

test('المقارنة الظلية: نظيفة على اقتراح لا يشرط شيئًا، وتمسك الفقد بالاسم وترفض التطبيق', t=>{
  const {db,users}=fixture(t);
  const derived=deriveGates(db,'36t');
  const clean=shadowCompareGates(db,'36t',derived.proposals);
  assert.equal(clean.clean,true,'اقتراح الاشتقاق لا يغيّر على أحد شيئًا');
  assert.equal(clean.gained,0);assert.equal(clean.lost,0);
  assert.equal(clean.accounts,db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id='36t' AND active=1").get().n);
  assert.ok(clean.checks>0,'ولا تُقرأ «نظيفة» لأنها لم تقارن شيئًا بشيء');

  // اقتراحٌ يخسر به أحد: يُمسك بالاسم، ويُرفض التطبيق كله — لا يُطبَّق بعضه ويُترك بعضه.
  const loss=[{code:CODE,required_capability:CAP,department_id:null,basis:'اختبار: اقتراح يسقط عنه حسابات'}];
  const dirty=shadowCompareGates(db,'36t',loss);
  assert.equal(dirty.clean,false);
  assert.ok(dirty.lost>0,'والفقد معدود');
  assert.equal(dirty.gained,0,'والشرط يطرح ولا يمنح');
  assert.ok(dirty.lost_by_account.length>0&&dirty.lost_by_account.every(a=>a.user_name&&a.services.length),'وكل خاسرٍ باسمه وبما خسره');
  assert.throws(()=>transaction(db,()=>applyProposal(db,users.admin,loss,{basis:'اختبار: تطبيق يخسر به أحد'})),
    error=>{
      assert.equal(error.code,'shadow_not_clean');
      assert.ok(error.details.refusal.missing[0].why.includes(dirty.lost_by_account[0].user_name),'الرفض يسمّي من يخسر');
      return true;
    });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_gate').get().n,0,'ولا صفَّ كُتب: كلٌّ أو لا شيء');
});

/* ───── الباب ──────────────────────────────────────────────────────────────── */

test('الباب: للأدمن الأول وحده، ويرفض المجهول بالاسم، ويسجّل ما كان وما صار', t=>{
  const {db,users}=fixture(t);
  for(const who of ['manager','hr','it','employee'])
    assert.throws(()=>transaction(db,()=>setServiceGate(db,users[who],{service_code:CODE,required_capability:CAP,
      department_id:null,basis:'محاولة من حساب لا يملك الباب'})),e=>e.code==='forbidden'||e.code==='not_permitted',who);
  // وخارج معاملة لا يُكتب قرار أصلًا.
  assert.throws(()=>setServiceGate(db,users.admin,{service_code:CODE,required_capability:CAP,department_id:null,
    basis:'قرار خارج معاملة قاعدة بيانات'}),e=>e.code==='transaction_required');
  // المجهول يُردّ باسمه: خدمة، وتصريح، وإدارة.
  assert.throws(()=>gate(db,users,{service_code:'NO-SUCH-SERVICE',required_capability:CAP,department_id:null,
    basis:'رمز خدمة غير موجود في الدليل'}),e=>e.code==='not_found'&&e.message.includes('NO-SUCH-SERVICE'));
  assert.throws(()=>gate(db,users,{service_code:CODE,required_capability:'no.such.capability',department_id:null,
    basis:'مفتاح تصريح غير معروف في المنصة'}),e=>e.code==='capability'&&e.message.includes('no.such.capability'));
  assert.throws(()=>gate(db,users,{service_code:CODE,required_capability:'',department_id:'no-such-department',
    basis:'معرّف إدارة غير مسجَّل في الهيكل'}),e=>e.code==='department'&&e.message.includes('no-such-department'));
  // وتصريحٌ يحمله كل موظف مرفوض: يطبع وعدًا بحصرٍ لا يحصر أحدًا، وهو الكذب الذي بُني الترحيل ليغلقه.
  assert.throws(()=>gate(db,users,{service_code:CODE,required_capability:'leave.use',department_id:null,
    basis:'تصريح يحمله كل موظف فلا يحصر شيئًا'}),e=>e.code==='capability');
  // وتصريح إدارة المنصة مرفوض لأنه **إقفال** لا تضييق: ما يحمله إلا حسابٌ إداري (grantAccess)،
  // والحساب الإداري مردود عن كل معاملة أعمال (createRequest)، فالنتيجة خدمة لا يطلبها أحد.
  for(const key of ['catalog.manage','access.manage'])
    assert.throws(()=>gate(db,users,{service_code:CODE,required_capability:key,department_id:null,
      basis:'تصريح إدارة منصة يقفل الخدمة بوجه الجميع'}),e=>e.code==='capability',key);
  // والإدارة الموقوفة مرفوضة للسبب نفسه: ما فيها منسوبون يمرّون من الشرط.
  db.prepare("UPDATE departments SET active=0 WHERE id='it' AND tenant_id='36t'").run();
  assert.throws(()=>gate(db,users,{service_code:CODE,required_capability:'',department_id:'it',
    basis:'حصر في إدارة موقوفة يقفل الخدمة لا يضيّقها'}),e=>e.code==='department');
  db.prepare("UPDATE departments SET active=1 WHERE id='it' AND tenant_id='36t'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_gate').get().n,0,'ولا صفَّ من كل ما رُفض');

  // القرار المقبول: صفٌّ بسنده، وحدث تدقيق يحمل ما كان وما صار، والسلسلة سليمة.
  gate(db,users,{service_code:CODE,required_capability:CAP,department_id:'it',basis:'اختبار: تصريح وحصر إدارة معًا'});
  const event=db.prepare("SELECT * FROM audit_events WHERE entity_type='service_gate' ORDER BY seq DESC LIMIT 1").get();
  assert.equal(event.action,'service_gate.set');
  assert.equal(event.entity_id,CODE);
  assert.deepEqual(JSON.parse(event.before_json),{required_capability:'',department_id:null},'ما كان: مفتوحة');
  assert.equal(JSON.parse(event.after_json).required_capability,CAP);
  assert.equal(JSON.parse(event.after_json).department_id,'it');
  assert.ok(event.reason.includes('تصريح وحصر'),'والسند في الحدث بنصّه');
  assert.ok(verifyAudit(db),'وسلسلة التدقيق سليمة');
  // وتكرار القرار نفسه ليس قرارًا.
  assert.throws(()=>gate(db,users,{service_code:CODE,required_capability:CAP,department_id:'it',
    basis:'إعادة إرسال القرار نفسه مرة ثانية'}),e=>e.code==='already_in_state');
});

/* ───── البقاء بعد إعادة بناء الإسقاط ─────────────────────────────────────── */

test('الشرط قرارٌ لا إسقاط: يبقى بعد إعادة بناء catalog_placement كاملًا', t=>{
  const {db,users}=fixture(t);
  gate(db,users,{service_code:CODE,required_capability:CAP,department_id:null,basis:'اختبار: شرط يسبق إعادة بناء الإسقاط'});
  const before=db.prepare("SELECT required_capability FROM catalog_placement WHERE tenant_id='36t' AND item_key=?").get(CODE);
  assert.equal(before.required_capability,CAP,'الصورة على الإسقاط سارية فورًا');
  // المثبّت يمحو صفوف الكيان كلها ويعيد بناءها. بلا إعادة وضع الشرط يضيع قرار المالك بلا خبر.
  transaction(db,()=>projectCatalog(db,'36t',users.admin.id));
  assert.equal(db.prepare("SELECT required_capability FROM catalog_placement WHERE tenant_id='36t' AND item_key=?").get(CODE).required_capability,CAP,
    'وبعد إعادة البناء الكاملة يبقى الشرط كما قرّره المالك');
  assert.equal(seen(db,users.employee).has(CODE),false,'وأثره باقٍ على من لا يحمله');
  assert.equal(currentGates(db,'36t').get(CODE).required_capability,CAP);
});

/* ───── الاحتياط لا ينقلب قفلًا ───────────────────────────────────────────── */

test('الاحتياط: إسقاطٌ فارغ يبقى دليلًا كاملًا للجميع، لا شاشةً بيضاء', t=>{
  const {db,users}=fixture(t);
  const all=db.prepare("SELECT COUNT(DISTINCT code) AS n FROM services WHERE tenant_id='36t' AND active=1").get().n;
  assert.equal(seen(db,users.employee).size,all);
  db.prepare("DELETE FROM catalog_placement WHERE tenant_id='36t'").run();
  // قاعدة 131 بنصّها: خدمةٌ لا صفَّ لها في الإسقاط تبقى ظاهرة للجميع. شرط الأهلية يقع **داخل** فرع
  // «لها صفّ» فلا يمسّها، ولو وقع بجواره لصار كل مستأجرٍ لم يُسقَط له شيء دليلُه فارغًا.
  assert.equal(seen(db,users.employee).size,all,'الدليل كامل بلا إسقاط');
  assert.equal(seen(db,users.hr).size,all);
  // وحتى بلا سياق أهلية أصلًا (قارئٌ نسي تمريره) يبقى غير المشروط ظاهرًا ولا يُسرَّب المشروط.
  const noContext=db.prepare(`SELECT COUNT(DISTINCT s.code) AS n FROM services s WHERE s.tenant_id='36t' AND s.active=1
    AND ${visibleSql('s','code','service',['employee'])}`).get().n;
  assert.equal(noContext,all);
});

test('الاحتياط: قارئٌ بلا سياق أهلية يخفي المشروط ولا يسرّبه', t=>{
  const {db,users}=fixture(t);
  gate(db,users,{service_code:CODE,required_capability:CAP,department_id:null,basis:'اختبار: الباب مغلق عند النسيان'});
  const blind=db.prepare(`SELECT COUNT(DISTINCT s.code) AS n FROM services s WHERE s.tenant_id='36t' AND s.active=1
    AND ${visibleSql('s','code','service',['employee'])} AND s.code=?`).get(CODE).n;
  assert.equal(blind,0,'الشرط لا يُتخطّى بنسيان تمرير السياق');
  const admin=db.prepare(`SELECT COUNT(DISTINCT s.code) AS n FROM services s WHERE s.tenant_id='36t' AND s.active=1
    AND ${visibleSql('s','code','service',['employee'],'all')} AND s.code=?`).get(CODE).n;
  assert.equal(admin,1,'وأسطح الإدارة تعدّ الشجرة كلها بـ«all» صراحةً لا بالصمت');
});

/* ───── الشاشة ─────────────────────────────────────────────────────────────── */

test('اللوح: للأدمن الأول وحده، ويقول «مفتوحة عن قصد» بسببها لا بفراغ', t=>{
  const {db,users}=fixture(t);
  const board=gatesBoard(db,users.admin);
  assert.equal(board.can_manage,true);
  assert.equal(gatesBoard(db,users.manager).can_manage,false,'وغيره يقرأ ولا يفعل');
  assert.equal(board.totals.gated,0);
  assert.equal(board.totals.open,board.totals.placements);
  assert.ok(board.note.includes('عن قصد'),'اللوح يقول إنها مفتوحة عن قصد');
  assert.ok(board.proposal.open_sample.every(row=>row.reason),'ولكل بندٍ معروضٍ سببه');
  assert.ok(board.capabilities.length&&board.capabilities.every(c=>c.key),'وقائمة التصاريح تأتي من الخادم، فلا يُكتب مفتاح باليد');
  // والمعروض في القائمة هو ما يمرّ من الباب: لا تصريح يحمله الجميع ولا تصريح إدارة منصة، فلا يختار
  // المالك خيارًا ثم يُردّ عليه. وهذه هي القاعدة التي تجعل الشاشة تعد بما يفعله الخادم لا بأكثر منه.
  for(const key of ['leave.use','catalog.manage','access.manage'])
    assert.equal(board.capabilities.some(c=>c.key===key),false,key);
  assert.ok(board.departments.every(d=>d.id&&d.name));
  assert.equal(board.guarded.length,2,'والقناتان المحروستان مسمّاتان في اللوح');
  gate(db,users,{service_code:CODE,required_capability:CAP,department_id:null,basis:'اختبار: صفّ واحد في اللوح'});
  const after=gatesBoard(db,users.admin);
  assert.equal(after.totals.gated,1);
  assert.equal(after.gates[0].service_code,CODE);
  assert.ok(after.gates[0].basis.includes('اختبار'),'والسند معروض بجوار الشرط');
  assert.equal(after.gates[0].decided_by_name,users.admin.name,'ومن قرّره باسمه لا بمعرّفه');
  assert.equal(after.history.length,1);
});

test('الشاشة: القسم يُرسم بالعدّة نفسها، ويحمل الشرط وسنده والعدد من الإسقاط لا من رقم مكتوب', t=>{
  const {db,users}=fixture(t);
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ctx={e,ui:kit(e,ar=>ar),
    button:(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`};
  // مدير الإدارة يفتح هذه الشاشة لأزمنة خدماته، ولا يُرسم له هذا القسم أصلًا.
  assert.equal(serviceGatesSection(gatesBoard(db,users.manager),ctx),'','لا يُرسم لغير الأدمن الأول');
  const before=serviceGatesSection(gatesBoard(db,users.admin),ctx);
  assert.ok(before.includes('169 بندًا كلها مفتوحة'),'العدد من الإسقاط: 169 صفًّا، لا رقمًا محفورًا في الشاشة');
  assert.ok(before.includes('مفتوحة عن قصد'),'ويُقال إنها مفتوحة عن قصد لا عن سهو');
  assert.ok(before.includes(OPEN_REASONS.confidential_channel),'وسبب القناة السرية بنصّه من الخادم');
  gate(db,users,{service_code:CODE,required_capability:CAP,department_id:null,basis:'اختبار: سند يُقرأ في الشاشة'});
  const after=serviceGatesSection(gatesBoard(db,users.admin),ctx);
  assert.ok(after.includes(CODE)&&after.includes('اختبار: سند يُقرأ في الشاشة'),'الشرط وسنده في الجدول');
  assert.ok(after.includes('1 خدمة مشروطة من 169'));
  // والنموذج يبني قوائمه من الخادم: لا حقل نصّ حرّ لمفتاح تصريح ولا لمعرّف إدارة.
  const form=serviceGatesForm('set_service_gate',CODE,{service_gates:gatesBoard(db,users.admin)});
  assert.equal(form.endpoint,'/approval-settings/service-gates');
  assert.ok(form.fields.every(f=>f.type!=='text'),'ما فيه حقل نصّ حرّ يُكتب فيه مفتاح باليد');
  assert.equal(form.fields.find(f=>f.name==='required_capability').value,CAP,'والنموذج يفتح على الشرط القائم');
  assert.throws(()=>serviceGatesForm('set_service_gate',CODE,{service_gates:gatesBoard(db,users.manager)}),
    /الإجراء غير متاح/,'ولا يُبنى لغير مالكه');
});
