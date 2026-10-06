// الترحيل 193 في الشاشات — المعدات مربوطة بإنتاجها: الحجز على إنتاج من النموذج ويرث مشروعه ويسمّيه في القائمة، والمشروع المسمّى المخالف
// رفضٌ مكتوب يرسمه ui.refusal لا نصٌّ خام، والإنتاج يعرض معداته المحجوزة والطالعة ولا يُعرض إقفاله ومعداته برّا (PRO-04، وإقفال المشروع PMO-09).
// البيانات تجريبية كلها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createProduction, productionAction, productionsBoard } from '../app/production.mjs';
import { createItem, createBooking, bookingAction, equipmentBoard } from '../app/equipment.mjs';
import { equipmentUI } from '../app/static/equipment-ui.mjs';
import { productionsUI } from '../app/static/production-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { operationFields } from '../app/static/operations.mjs';
import { PASSWORD } from './definitions-fixture.mjs';
import { approvedVersion, reviewRoute } from './studio-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';
import { riyadh, e, context, named, cardOf, errorOf, usersOf, screens } from './ui-wiring-fixture.mjs';

/* ───── المعدات والإنتاج (الترحيل 193) ───── */
function shootWorld(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const tx=f=>transaction(db,f);let users=usersOf(db);
  // المنتج (manager) يحمل تصريح الإنتاج، ومن يقفل الإنتاج (hr) غير منتجه. manager أمين المخزن بدوره.
  for(const who of ['manager','hr'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'production.manage',department_id:'',note:'منح تجريبي لربط المعدات بالإنتاج'}));
  users=usersOf(db);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تصوير تجريبي',brief:'ربط المعدات بالإنتاج',member_ids:['employee','outsider']})).id;
  // جاهزية التصوير (الترحيل 188): معالجة معتمدة بمسارها ومخصص فعّال يغطي الأيام.
  const route=reviewRoute(db,users,{version:approvedVersion(db,users,{project,title:'معالجة إعلان رمضان التجريبي'}).version});
  fundProject(db,project,'EQP-CC');
  const other=tx(()=>createProject(db,users.manager,{name:'مشروع ثانٍ تجريبي',brief:'مشروع لا يملك الإنتاج',member_ids:['employee']})).id;
  const live=tx(()=>createProduction(db,users.manager,{code:'SHOOT-01',title:'إعلان <b>رمضان</b> التجريبي',kind:'ad',brief:'موجز تجريبي',client_id:'',campaign_id:'',project_id:project,review_route_id:route,shoot_from:riyadh(),shoot_to:riyadh(5)})).id;
  const item=name=>tx(()=>createItem(db,users.manager,{name,category:'camera',serial_no:'',condition_state:'good',condition_note:'',home_location:'مخزن تجريبي',asset_id:''})).id;
  return {db,users,tx,project,other,live,items:{mic:item('ميكروفون تجريبي'),stand:item('حامل <i>إضاءة</i> تجريبي'),lens:item('عدسة تجريبية')}};
}

test('equipment: a booking is made on a production from the form, carries its project, and names it on the list; a named project that differs is the written refusal, drawn by ui.refusal',async t=>{
  const {db,items,live,project,other}=shootWorld(t);
  const {api,submit}=await screens(db,['manager']);
  let data=await equipmentUI.load(api('manager'));
  const spec=equipmentUI.form('create_booking','',data);
  const names=spec.fields.map(f=>f.name);
  assert.ok(names.includes('production_id')&&names.indexOf('production_id')<names.indexOf('project_id'),'the production is chosen before the project');
  const production=spec.fields.find(f=>f.name==='production_id');
  assert.equal(production.required,false);
  assert.deepEqual(production.options.map(o=>o.value),['',live]);
  assert.match(production.options[1].label,/^SHOOT-01 — /);
  assert.match(spec.fields.find(f=>f.name==='project_id').hint,/مشروع الإنتاج/);
  assert.ok(operationFields(spec.fields,e).includes('إعلان &lt;b&gt;رمضان&lt;/b&gt; التجريبي'),'the production title is escaped in the form');
  const values=over=>({target:`item:${items.mic}`,custodian_id:'employee',start_date:riyadh(),end_date:riyadh(),purpose:'تصوير تجريبي على الإنتاج',production_id:live,project_id:'',production_ref:'اليوم الأول',...over});
  assert.equal(spec.toPayload(values()).production_id,live);
  const booked=await submit('manager',spec,values());
  assert.equal(booked.status,201,booked.text);
  data=await equipmentUI.load(api('manager'));
  const row=equipmentUI.render(data,context('equipment')).split('<li').find(li=>li.includes('ميكروفون تجريبي')&&li.includes('محجوزة'))??'';
  assert.match(row,/إنتاج: <bdi>SHOOT-01<\/bdi> «إعلان &lt;b&gt;رمضان&lt;\/b&gt; التجريبي»/,'the booking names its production, escaped');
  assert.match(row,/مشروع: مشروع تصوير تجريبي/,'the booking carries the production’s project');
  assert.match(row,/اليوم الأول/,'the free note stays as written');
  assert.equal(data.bookings.find(b=>b.item_id===items.mic).project_id,project);
  // المشروع المسمّى المخالف: رفض مكتوب، يرسمه الغلاف بـui.refusal (ما رُفض والخطوة التالية) لا نصًّا خامًا.
  const refused=await submit('manager',spec,values({target:`item:${items.stand}`,project_id:other}));
  assert.equal(refused.status,409);
  const error=errorOf(refused);
  assert.equal(error.code,'production_project_mismatch');
  assert.ok(error.details?.refusal?.what.includes('SHOOT-01'));
  const drawn=kit(e).refusal(error);
  assert.match(drawn,/^<div class="vn-alert is-block" role="alert"><strong>الإنتاج SHOOT-01 «إعلان &lt;b&gt;رمضان&lt;\/b&gt; التجريبي» تابع لمشروع ثاني/);
  assert.match(drawn,/الخطوة التالية: احجز على مشروع الإنتاج نفسه، أو خلّ المشروع فاضي/);
  assert.doesNotMatch(drawn,/class="error"|\{"/);
  assert.equal(equipmentBoard(db,usersOf(db).manager).bookings.some(b=>b.item_id===items.stand),false,'nothing was booked');
  assert.ok(verifyAudit(db));
});

test('productions: the production lists the equipment still booked or out on it, and the closer sees why it cannot close yet instead of a button the server refuses',async t=>{
  const {db,users,tx,live,items}=shootWorld(t);
  const of=()=>productionsBoard(db,users.manager).productions.find(p=>p.id===live);
  const move=(action,input={})=>tx(()=>productionAction(db,users.manager,live,action,{version:of().version,...input}));
  move('start');
  const book=(item,custodian)=>tx(()=>createBooking(db,users.manager,{item_id:item,kit_id:'',project_id:'',production_id:live,production_ref:'',purpose:'تصوير تجريبي على الإنتاج',start_date:riyadh(),end_date:riyadh(1),custodian_id:custodian})).id;
  const out=book(items.stand,'employee'),reserved=book(items.lens,'outsider');
  const booking=id=>equipmentBoard(db,users.manager).bookings.find(b=>b.id===id);
  tx(()=>bookingAction(db,users.employee,out,'hand_out',{version:booking(out).version,counterpart_id:'manager',condition_state:'good',condition_note:'سليمة ومعها بطاريتان',acknowledgement:'أقر باستلام القطعة ومسؤوليتي عنها حتى إعادتها'}));
  move('wrap',{wrap_note:'انتهى التصوير وسُلّمت المواد الخام للمونتاج'});
  const {api}=await screens(db,['hr']);
  let data=await productionsUI.load(api('hr'));
  assert.ok(data.productions.find(p=>p.id===live).actions.includes('accept_close'),'the server lists the close for the second person');
  let card=cardOf(productionsUI.render(data,context('productions')),'<bdi>SHOOT-01</bdi>');
  assert.equal(named(card,live).some(([a])=>a==='accept_close'),false,'but refuses it while gear is out (equipment_still_out): no live button');
  assert.match(card,/<div class="vn-alert is-block" role="alert"><strong>ما ينقفل الإنتاج SHOOT-01 والمعدات حقّته للحين ما رجعت المخزن<\/strong>/);
  for(const who of [users.employee.name,users.outsider.name])assert.ok(card.includes(`عند: ${e(who)}`),who);
  assert.throws(()=>productionsUI.form('accept_close',live,data),/غير متاح/);
  // قسم المعدات: كل قطعة برمزها المعزول وحالتها بكلمتها وحاملها، والاسم مهرَّب.
  const section=card.slice(card.indexOf('<h3>المعدات على هالإنتاج</h3>'));
  assert.ok(card.includes('<h3>المعدات على هالإنتاج</h3>'));
  assert.match(section,new RegExp(`<bdi>${booking(out).item_code}</bdi> · حامل &lt;i&gt;إضاءة&lt;/i&gt; تجريبي`));
  assert.match(section,/مُسلَّمة/);assert.match(section,/محجوزة/);
  assert.doesNotMatch(card,/<i>إضاءة/);
  // رجعت القطعة وانلغى الحجز الثاني: الإقفال زرٌّ باسمه، ولا قسم معدات ولا رفض.
  tx(()=>bookingAction(db,users.manager,out,'hand_in',{version:booking(out).version,counterpart_id:'employee',condition_state:'good',condition_note:'رجعت سليمة كما سُلّمت',acknowledgement:'أقر باستلامها في المخزن بحالتها الموصوفة'}));
  tx(()=>bookingAction(db,users.manager,reserved,'cancel',{version:booking(reserved).version,note:'اللقطات التكميلية انلغت'}));
  data=await productionsUI.load(api('hr'));
  card=cardOf(productionsUI.render(data,context('productions')),'<bdi>SHOOT-01</bdi>');
  assert.deepEqual(named(card,live),[['accept_close','اعتماد الإقفال']]);
  assert.doesNotMatch(card,/المعدات على هالإنتاج|vn-alert is-block/);
  assert.equal(productionsUI.form('accept_close',live,data).endpoint,`/productions/${live}/close`);
  assert.ok(verifyAudit(db));
});
