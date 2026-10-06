import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { equipmentBoard, createItem, itemAction, itemQr, createKit, kitAction, createBooking, bookingAction, movementPhoto,
  openWorkOrder, workOrderAction, startCheck, checkAction, utilization, qrTarget } from '../app/equipment.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24,7)]).toString('base64');
const item=(name='كاميرا تجريبية أولى',extra={})=>({name,category:'camera',serial_no:'',condition_state:'good',condition_note:'',home_location:'مخزن التصوير التجريبي',asset_id:'',...extra});

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-equipment');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('keeper','36t','creative','keeper','أمين المخزن التجريبي','unused','manager',NULL),('iso-admin','isolated','other','iso-admin','مسؤولة الكيان المعزول التجريبية','unused','admin',NULL)");
  db.exec("UPDATE users SET admin_level='super' WHERE id='iso-admin'");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  return {db,users,tx};
}
const itemOf=(db,user,id)=>equipmentBoard(db,user).items.find(i=>i.id===id);
const bookingOf=(db,user,id)=>equipmentBoard(db,user).bookings.find(b=>b.id===id);

test('equipment item: the capability guards the store, the accounting asset is linked and never duplicated, and a QR code points at the internal item page',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>createItem(db,users.employee,item())),code('not_permitted'));
  assert.deepEqual(equipmentBoard(db,users.employee).items,[],'an account without the capability sees only its own custody');
  db.exec("INSERT INTO fixed_assets(id,tenant_id,code,name,category,acquired_on,cost_minor,salvage_minor,useful_months,location,evidence,status,recorded_by,created_at,updated_at) VALUES('asset-1','36t','FA-0001','كاميرا مرسملة تجريبية','cameras_production','2026-01-05',4000000,0,60,'','فاتورة شراء تجريبية موثقة','active','manager','2026-01-05T00:00:00.000Z','2026-01-05T00:00:00.000Z')");
  const id=tx(()=>createItem(db,users.manager,item('كاميرا تجريبية أولى',{serial_no:'SN-TEST-1',asset_id:'asset-1'}))).id;
  assert.throws(()=>tx(()=>createItem(db,users.manager,item('كاميرا تجريبية ثانية',{serial_no:'SN-TEST-1'}))),code('duplicate_serial'));
  assert.throws(()=>tx(()=>createItem(db,users.manager,item('كاميرا تجريبية ثالثة',{asset_id:'asset-1'}))),code('asset_linked'),'an item links to the asset record, it does not copy it');
  const row=itemOf(db,users.manager,id);
  assert.equal(row.asset.code,'FA-0001');assert.equal(row.cost_minor,undefined,'no financial figure is duplicated outside the asset register');
  const qr=itemQr(db,users.manager,id);
  assert.equal(qr.target,qrTarget(id));assert.match(qr.svg,/^<svg /);assert.equal(qr.svg.includes('style='),false,'the strict content policy allows no inline style');
  assert.throws(()=>itemQr(db,users['iso-admin'],id),code('not_found'),'another tenant reaches nothing');
  assert.ok(verifyAudit(db));
});

test('booking: SQL itself refuses an overlapping booking, a kit is booked as one block, and an item in maintenance is not booked',t=>{
  const {db,users,tx}=fixture(t);
  const body=tx(()=>createItem(db,users.manager,item('بدن كاميرا تجريبي'))).id;
  const lens=tx(()=>createItem(db,users.manager,item('عدسة تجريبية',{category:'lens'}))).id;
  const kitId=tx(()=>createKit(db,users.manager,{name:'طقم التصوير التجريبي',notes:''})).id;
  const kitView=()=>equipmentBoard(db,users.manager).kits.find(k=>k.id===kitId);
  tx(()=>kitAction(db,users.manager,kitId,'add_item',{version:kitView().version,item_id:body}));
  tx(()=>kitAction(db,users.manager,kitId,'add_item',{version:kitView().version,item_id:lens}));
  const booking={item_id:'',kit_id:kitId,project_id:'',production_ref:'تصوير تجريبي رقم 7',purpose:'تصوير إعلان العميل التجريبي',start_date:today(),end_date:addDays(today(),2),custodian_id:'employee'};
  assert.throws(()=>tx(()=>createBooking(db,users.manager,{...booking,item_id:body})),code('item_id'),'a booking is one item or one kit');
  assert.throws(()=>tx(()=>createBooking(db,users.manager,{...booking,custodian_id:'manager'})),code('separation_of_duties'));
  const first=tx(()=>createBooking(db,users.manager,booking));
  assert.equal(first.bookings.length,2,'a kit books as one block');
  assert.throws(()=>tx(()=>createBooking(db,users.manager,{...booking,item_id:lens,kit_id:'',start_date:addDays(today(),2),end_date:addDays(today(),4)})),/already booked over an overlapping date range/);
  // القيد في قاعدة البيانات لا في الكود: الإدخال المباشر يُرفض أيضًا.
  assert.throws(()=>db.prepare("INSERT INTO equipment_bookings(id,tenant_id,item_id,kit_id,group_id,project_id,production_ref,purpose,start_date,end_date,custodian_id,status,booked_by,created_at,updated_at) VALUES('raw','36t',?,NULL,'raw',NULL,'','تجاوز الكود مباشرة',?,?,'employee','reserved','manager','x','x')")
    .run(body,today(),addDays(today(),1)),/already booked over an overlapping date range/);
  const later=tx(()=>createBooking(db,users.manager,{...booking,item_id:lens,kit_id:'',start_date:addDays(today(),5),end_date:addDays(today(),6)}));
  assert.equal(later.bookings.length,1,'a non overlapping range is free');
  const order=tx(()=>openWorkOrder(db,users.manager,{item_id:lens,kind:'repair',description:'صيانة تجريبية لعدسة تحتاج تنظيفًا وضبطًا'})).id;
  assert.equal(itemOf(db,users.manager,lens).status,'maintenance');
  assert.throws(()=>tx(()=>createBooking(db,users.manager,{...booking,item_id:lens,kit_id:'',start_date:addDays(today(),20),end_date:addDays(today(),21)})),/maintenance, reported lost or retired is not booked/);
  const orderView=()=>equipmentBoard(db,users.manager).work_orders.find(o=>o.id===order);
  tx(()=>workOrderAction(db,users.manager,order,'start',{version:orderView().version,vendor_note:'ورشة تجريبية'}));
  tx(()=>workOrderAction(db,users.manager,order,'complete',{version:orderView().version,resolution:'نُظفت العدسة وضُبط تركيزها',cost:'350.00',cost_reference:'فاتورة تجريبية 99'}));
  assert.equal(itemOf(db,users.manager,lens).status,'available','closing the last work order returns the item to service');
  assert.throws(()=>tx(()=>workOrderAction(db,users.manager,order,'start',{version:orderView().version,vendor_note:''})),code('invalid_state'),'a closed work order is final');
  assert.ok(verifyAudit(db));
});

test('custody: the one who releases is never the one who receives, the custodian signs their own receipt in the platform, and a custody record is never rewritten',t=>{
  const {db,users,tx}=fixture(t);
  const id=tx(()=>createItem(db,users.manager,item('إضاءة تجريبية',{category:'lighting'}))).id;
  const bookingId=tx(()=>createBooking(db,users.manager,{item_id:id,kit_id:'',project_id:'',production_ref:'',purpose:'جلسة تصوير تجريبية',start_date:addDays(today(),-3),end_date:addDays(today(),-1),custodian_id:'employee'})).bookings[0];
  const out={version:0,counterpart_id:'manager',condition_state:'good',condition_note:'سليمة مع بطاريتين',acknowledgement:'أقر باستلام العهدة ومسؤوليتي عنها حتى إعادتها'};
  assert.throws(()=>tx(()=>bookingAction(db,users.manager,bookingId,'hand_out',{...out,version:bookingOf(db,users.manager,bookingId).version})),code('invalid_state'),'the store keeper does not sign the receipt on the custodian behalf');
  assert.throws(()=>tx(()=>bookingAction(db,users.employee,bookingId,'hand_out',{...out,version:bookingOf(db,users.employee,bookingId).version,counterpart_id:'employee'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>bookingAction(db,users.employee,bookingId,'hand_out',{...out,version:bookingOf(db,users.employee,bookingId).version,counterpart_id:'outsider'})),code('not_permitted'),'the releasing side is the store team');
  tx(()=>bookingAction(db,users.employee,bookingId,'hand_out',{...out,version:bookingOf(db,users.employee,bookingId).version,photo:{label:'حالة الإضاءة عند التسليم',filename:'out.png',content:png}}));
  const handed=bookingOf(db,users.manager,bookingId);
  assert.equal(handed.status,'out');assert.equal(handed.movements[0].acknowledged_by,'employee');assert.equal(handed.has_out_photo,true);
  assert.equal(itemOf(db,users.manager,id).status,'in_use');
  assert.equal(handed.late,true,'a booking past its end date while still out is flagged as overdue');
  assert.equal(equipmentBoard(db,users.manager).overdue,1);
  assert.equal(movementPhoto(db,users.manager,handed.movements[0].photos[0].id).media_type,'image/png');
  assert.throws(()=>tx(()=>bookingAction(db,users.employee,bookingId,'hand_in',{version:handed.version,counterpart_id:'manager',condition_state:'good',condition_note:'أعيدت كما سُلمت',acknowledgement:'أقر باستلامها في المخزن'})),code('not_permitted'),'the custodian does not receive their own return');
  tx(()=>bookingAction(db,users.manager,bookingId,'hand_in',{version:handed.version,counterpart_id:'employee',condition_state:'damaged',condition_note:'كسر في حامل المصباح',acknowledgement:'أقر باستلامها في المخزن بحالتها الموصوفة',photo:{label:'حالة الإضاءة عند الاستلام',filename:'in.png',content:png}}));
  const closed=bookingOf(db,users.manager,bookingId);
  assert.equal(closed.status,'returned');assert.equal(closed.has_in_photo,true);
  assert.equal(itemOf(db,users.manager,id).status,'maintenance','an item back damaged goes to maintenance, not straight back to the shelf');
  assert.throws(()=>db.prepare("UPDATE equipment_movements SET condition_state='good' WHERE booking_id=?").run(bookingId),/never rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM equipment_photos').run(),/never deleted/);
  assert.throws(()=>db.prepare("INSERT INTO equipment_movements(id,booking_id,kind,moved_on,released_by,received_by,condition_state,condition_note,acknowledgement,acknowledged_by,acknowledged_at,created_at) VALUES('self',?,'out',?,'employee','employee','good','نفس الشخص','إقرار','employee','x','x')").run(bookingId,today()),/CHECK constraint failed/);
  assert.ok(verifyAudit(db));
});

test('lost and inventory: whoever reports a loss never confirms it, confirmation is a higher manager decision with a written reason, the person who starts a stock check does not close it, and utilisation counts handed-out days only',t=>{
  const {db,users,tx}=fixture(t);
  const id=tx(()=>createItem(db,users.manager,item('ميكروفون تجريبي',{category:'audio'}))).id;
  const view=()=>itemOf(db,users.manager,id);
  tx(()=>itemAction(db,users.manager,id,'report_lost',{version:view().version,note:'لم يُعثر عليه بعد تصوير العميل التجريبي'}));
  assert.equal(view().status,'lost_review');
  assert.throws(()=>tx(()=>itemAction(db,users.manager,id,'confirm_lost',{version:view().version,note:'أقر فقده بنفسي بعد بلاغي'})),code('invalid_state'),'the reporter is not offered the decision');
  assert.throws(()=>tx(()=>itemAction(db,users.employee,id,'confirm_lost',{version:view().version,note:'قرار من حساب بلا تصريح'})),code('not_permitted'));
  assert.throws(()=>tx(()=>itemAction(db,users.keeper,id,'confirm_lost',{version:view().version,note:'قصير'})),code('invalid_text'));
  tx(()=>itemAction(db,users.keeper,id,'confirm_lost',{version:view().version,note:'بحثنا في المخزن وموقع التصوير ولم يُعثر عليه'}));
  const lost=view();
  assert.equal(lost.status,'lost');assert.equal(lost.lost_confirmed_by_name,users.keeper.name);assert.deepEqual(lost.actions,[]);
  assert.throws(()=>db.prepare("UPDATE equipment_items SET status='available',version=version+1 WHERE id=?").run(id),/lost or retired item is final/);
  // القاعدة في قاعدة البيانات لا في الكود: إقرار الفقد باسم المبلّغ نفسه مرفوض حتى بإدخال مباشر.
  const second=tx(()=>createItem(db,users.manager,item('مسجل صوت تجريبي',{category:'audio'}))).id;
  tx(()=>itemAction(db,users.manager,second,'report_lost',{version:itemOf(db,users.manager,second).version,note:'لم يُعثر عليه في جرد المخزن التجريبي'}));
  assert.throws(()=>db.prepare("UPDATE equipment_items SET status='lost',lost_confirmed_by=lost_reported_by,lost_confirmed_at='x',lost_decision_note='إقرار من المبلّغ نفسه',version=version+1 WHERE id=?").run(second),/CHECK constraint failed/);

  const kept=tx(()=>createItem(db,users.manager,item('حامل ثلاثي تجريبي',{category:'grip'}))).id;
  const bookingId=tx(()=>createBooking(db,users.manager,{item_id:kept,kit_id:'',project_id:'',production_ref:'',purpose:'تصوير تجريبي قصير',start_date:addDays(today(),-2),end_date:today(),custodian_id:'employee'})).bookings[0];
  tx(()=>bookingAction(db,users.employee,bookingId,'hand_out',{version:bookingOf(db,users.employee,bookingId).version,counterpart_id:'manager',condition_state:'good',condition_note:'سليم ومكتمل',acknowledgement:'أقر باستلام الحامل الثلاثي وأتحمل مسؤوليته'}));
  const usage=utilization(db,users.manager,90).items.find(i=>i.id===kept);
  assert.equal(usage.used_days,3,'three calendar days handed out');assert.equal(usage.bookings,1);
  assert.equal(utilization(db,users.manager,90).items.some(i=>i.id===id),true,'a lost item still appears until it is retired');

  const checkId=tx(()=>startCheck(db,users.manager,{name:'جرد تجريبي — الربع الأول'})).id;
  const check=()=>equipmentBoard(db,users.manager).checks.find(c=>c.id===checkId);
  assert.throws(()=>tx(()=>checkAction(db,users.manager,checkId,'close',{version:check().version,note:'أقفل جردي بنفسي دون مراجعة'})),code('invalid_state'),'no self approval on a stock check');
  tx(()=>checkAction(db,users.manager,checkId,'scan',{version:check().version,item_id:kept,condition_state:'good',note:'أُكد وجوده بالمسح'}));
  assert.throws(()=>tx(()=>checkAction(db,users.manager,checkId,'scan',{version:check().version,item_id:kept,condition_state:'good',note:''})),code('already_scanned'));
  assert.throws(()=>tx(()=>checkAction(db,users.manager,checkId,'scan',{version:check().version,item_id:id,condition_state:'good',note:''})),code('invalid_state'),'a confirmed lost item is out of the count');
  assert.equal(check().confirmed,1);assert.equal(check().missing.length,check().expected-1);
  tx(()=>checkAction(db,users.keeper,checkId,'close',{version:check().version,note:'أُكدت قطعة واحدة والباقي لم يُمسح بعد'}));
  assert.equal(check().status,'closed');
  assert.throws(()=>tx(()=>checkAction(db,users.manager,checkId,'scan',{version:check().version,item_id:kept,condition_state:'good',note:''})),code('invalid_state'));
  assert.throws(()=>db.prepare("INSERT INTO equipment_inventory_scans VALUES(?,?,'good','','manager','x')").run(checkId,kept),/closed inventory check takes no further scans/);
  assert.ok(verifyAudit(db));
});
