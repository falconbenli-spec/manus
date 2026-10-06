import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { qrSvg } from './qr.mjs';
import { refuse } from './refusal.mjs';

// حجز المعدات والعهد: القطعة وطقمها وحجزها ومناولتها وصيانتها وجردها.
// القيمة المالية والإهلاك يبقيان في سجل الأصول (fixed_assets)؛ هنا ربط فقط بلا تكرار.
// العهدة إقرار داخلي في المنصة باسم المستلم ووقته — ليست توقيعًا ذا حجية نظامية.
export const CATEGORIES=[['camera','كاميرا'],['lens','عدسة'],['lighting','إضاءة'],['audio','صوت'],['grip','حوامل وملحقات تثبيت'],['accessory','ملحق'],['other','أخرى']].map(([key,name])=>({key,name}));
export const CONDITIONS=[['good','سليمة'],['minor_damage','خدوش أو ضرر طفيف'],['damaged','تالفة'],['incomplete','ناقصة قطعًا']].map(([key,name])=>({key,name}));
export const ITEM_STATES={available:'متاحة',in_use:'بعهدة',maintenance:'في الصيانة',lost_review:'بلاغ فقد بانتظار إقرار',lost:'مفقودة',retired:'مستبعدة'};
export const BOOKING_STATES={reserved:'محجوزة',out:'مُسلَّمة',returned:'أُعيدت',cancelled:'ملغاة'};
export const MAINTENANCE_KINDS=[['preventive','صيانة وقائية'],['repair','إصلاح'],['calibration','معايرة']].map(([key,name])=>({key,name}));
export const MAINTENANCE_STATES={open:'مفتوح',in_progress:'قيد التنفيذ',done:'منجز',cancelled:'ملغى'};
// الرمز يفتح صفحة القطعة داخل المنصة نفسها؛ لا يحمل أي بيان عن القطعة ولا يعمل خارج الشبكة.
export const qrTarget=itemId=>`/#equipment/item/${itemId}`;
const PHOTO_SIGNATURES=[['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/jpeg',Buffer.from([0xFF,0xD8,0xFF])]];
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const label=(list,key)=>list.find(x=>x.key===key)?.name??key;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');}
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');return c;}
// إدارة المخزن لحامل التصريح. أما إقرار العهدة فيوقّعه المستلم نفسه ولو لم يكن من فريق المخزن.
function gate(db,supplied){const u=actor(db,supplied);if(!can(db,u,'equipment.manage'))fail(403,'not_permitted','إدارة المعدات لحامل تصريحها — اطلبه من مسؤول الصلاحيات');return u;}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','السجل تغيّر من وقت ما فتحته — حدّث الصفحة');}
const pick=(list,key,field,text)=>{if(!list.some(x=>x.key===key))fail(400,field,text);return key;};
function money(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين على الأكثر`);
  const [whole,fraction='']=value.split('.');return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
// الرقم من أعلى رقم مستعمل لا من عدد الصفوف: العدّ يفترض تتابعًا بلا فجوة ولا شيء يفرضه.
// اليوم لا فجوة (حارس منع الحذف قائم ونطاق العدّ يطابق القيد الفريد) فالنتيجتان واحدة؛ لكن أول مسار
// استيراد أو ترحيل بيانات يُدخل رقمًا خارج التتابع يجعل العدّ يعيد رقمًا مستعملًا فيسقط الإدراج أمام المستخدم.
const nextCode=(db,tenantId,table,prefix)=>prefix+String(db.prepare(`SELECT COALESCE(MAX(CAST(substr(code,${prefix.length+1}) AS INTEGER)),0)+1 AS n FROM ${table} WHERE tenant_id=? AND code LIKE '${prefix}%'`).get(tenantId).n).padStart(4,'0');

/* ───── القطع ───── */
function itemRow(db,u,itemId){
  const row=typeof itemId==='string'&&db.prepare('SELECT * FROM equipment_items WHERE id=? AND tenant_id=?').get(itemId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا القطعة هذي');
  return row;
}
const holdsLiveBooking=(db,itemId,userId)=>!!db.prepare("SELECT 1 FROM equipment_bookings WHERE item_id=? AND status IN ('reserved','out') AND (custodian_id=? OR booked_by=?)").get(itemId,userId,userId);
function itemView(db,u,row,{manage=true}={}){
  const openOrders=db.prepare("SELECT COUNT(*) AS n FROM equipment_maintenance WHERE item_id=? AND status IN ('open','in_progress')").get(row.id).n;
  const bookings=db.prepare("SELECT COUNT(*) AS n FROM equipment_bookings WHERE item_id=? AND status IN ('reserved','out')").get(row.id).n;
  const actions=[];
  if(manage){
    if(['available','in_use','maintenance'].includes(row.status))actions.push('edit_item','report_lost','open_work_order');
    if(row.status==='available')actions.push('book_item','retire_item');
    if(row.status==='maintenance'&&!openOrders)actions.push('return_to_service');
    // إقرار الفقد لمسؤول غير من بلّغ: يُفحص الشخص عند التنفيذ أيضًا.
    // ولا لمن القطعة في عهدته أو من حجزها بحجز قائم: لا يحكم أحد في فقد ما هو مسؤول عنه.
    if(row.status==='lost_review'&&row.lost_reported_by!==u.id&&!holdsLiveBooking(db,row.id,u.id))actions.push('confirm_lost','reject_lost');
  }
  const asset=row.asset_id?db.prepare('SELECT code,name,status FROM fixed_assets WHERE id=?').get(row.asset_id):null;
  return {...row,status_name:ITEM_STATES[row.status],category_name:label(CATEGORIES,row.category),condition_name:label(CONDITIONS,row.condition_state),
    created_by_name:name(db,row.created_by),lost_reported_by_name:name(db,row.lost_reported_by),lost_confirmed_by_name:name(db,row.lost_confirmed_by),
    asset:asset?{id:row.asset_id,code:asset.code,name:asset.name,status:asset.status}:null,
    kit:db.prepare('SELECT k.id,k.name FROM equipment_kit_items i JOIN equipment_kits k ON k.id=i.kit_id WHERE i.item_id=?').get(row.id)??null,
    open_work_orders:openOrders,open_bookings:bookings,qr_target:qrTarget(row.id),actions};
}
const ITEM_FIELDS=['name','category','serial_no','condition_state','condition_note','home_location','asset_id'];
function cleanItem(db,u,input,currentId=null){
  const serial=input.serial_no?v.text(input.serial_no,'الرقم التسلسلي',120):'';
  if(serial){
    const clash=db.prepare('SELECT id FROM equipment_items WHERE tenant_id=? AND serial_no=?').get(u.tenant_id,serial);
    if(clash&&clash.id!==currentId)fail(409,'duplicate_serial','الرقم التسلسلي هذا مسجّل لقطعة ثانية');
  }
  let assetId=null;
  if(input.asset_id){
    const asset=db.prepare("SELECT id,status FROM fixed_assets WHERE id=? AND tenant_id=?").get(input.asset_id,u.tenant_id);
    if(!asset)fail(400,'asset_id','ما لقينا سجل الأصل هذا');
    if(!['active','pending'].includes(asset.status))fail(400,'asset_id','الأصل مستبعد ولا مرفوض في السجل المحاسبي');
    const linked=db.prepare('SELECT id FROM equipment_items WHERE asset_id=?').get(asset.id);
    if(linked&&linked.id!==currentId)fail(409,'asset_linked','الأصل هذا مربوط بقطعة ثانية — القطعة تنربط بالأصل وما تكرره');
    assetId=asset.id;
  }
  return {name:v.text(input.name,'اسم القطعة',180,3),category:pick(CATEGORIES,input.category,'category','فئة القطعة غير متاحة'),serial,
    condition:pick(CONDITIONS,input.condition_state,'condition_state','حالة القطعة غير متاحة'),
    note:input.condition_note?v.text(input.condition_note,'ملاحظة الحالة',2000):'',
    location:input.home_location?v.text(input.home_location,'مكانها المعتاد',180):'',assetId};
}
export function createItem(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,ITEM_FIELDS);
  const f=cleanItem(db,u,input),itemId=id(),time=now(),code=nextCode(db,u.tenant_id,'equipment_items','EQ-');
  db.prepare("INSERT INTO equipment_items(id,tenant_id,code,name,category,serial_no,condition_state,condition_note,home_location,asset_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'available',?,?,?)")
    .run(itemId,u.tenant_id,code,f.name,f.category,f.serial,f.condition,f.note,f.location,f.assetId,u.id,time,time);
  audit(db,u,'equipment_item',itemId,'equipment.item_created',{}, {code,asset_id:f.assetId});
  return {id:itemId,code};
}
export function itemAction(db,supplied,itemId,action,input){
  writing(db);const u=gate(db,supplied),row=itemRow(db,u,itemId),view=itemView(db,u,row);
  const key={edit:'edit_item',report_lost:'report_lost',confirm_lost:'confirm_lost',reject_lost:'reject_lost',retire:'retire_item',return_to_service:'return_to_service'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','ما ينفع هذا الإجراء في حالة القطعة، ولا هو من صلاحية حسابك');
  versioned(row,input);
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE equipment_items SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,time,row.id);
  if(action==='edit'){
    v.object(input,['version',...ITEM_FIELDS]);const f=cleanItem(db,u,input,row.id);
    bump('name=?,category=?,serial_no=?,condition_state=?,condition_note=?,home_location=?,asset_id=?',[f.name,f.category,f.serial,f.condition,f.note,f.location,f.assetId]);
  }else if(action==='report_lost'){
    v.object(input,['version','note']);
    bump("status='lost_review',lost_reported_by=?,lost_note=?",[u.id,v.text(input.note,'ما الذي جرى ومتى فُقدت',2000,10)]);
  }else if(action==='confirm_lost'||action==='reject_lost'){
    v.object(input,['version','note']);
    // إقرار الفقد أو رده قرار مسؤول أعلى، وليس من بلّغ.
    if(row.lost_reported_by===u.id)fail(409,'separation_of_duties','اللي بلّغ عن الفقد ما يقرّه');
    if(holdsLiveBooking(db,row.id,u.id))fail(409,'separation_of_duties','حامل العهدة ولا اللي حجز القطعة بحجز قائم ما يقرّ فقدها ولا يردّه');
    if(!(u.role==='manager'||u.admin_level==='super'))fail(403,'not_permitted','إقرار الفقد لمسؤول أعلى منك');
    const note=v.text(input.note,'أساس القرار',2000,10);
    if(action==='confirm_lost'){
      bump("status='lost',lost_confirmed_by=?,lost_confirmed_at=?,lost_decision_note=?",[u.id,time,note]);
      // القطعة المفقودة لا تبقى «مسلَّمة» أو «محجوزة»: يُغلق الحجز القائم بسبب مكتوب يحيل إلى الإقرار.
      for(const booking of db.prepare("SELECT id,status FROM equipment_bookings WHERE item_id=? AND status IN ('reserved','out')").all(row.id)){
        db.prepare("UPDATE equipment_bookings SET status='cancelled',cancel_note=?,version=version+1,updated_at=? WHERE id=?").run(`أُغلق بإقرار فقد القطعة: ${note}`.slice(0,1000),time,booking.id);
        audit(db,u,'equipment_booking',booking.id,'equipment.booking_closed_lost',{status:booking.status},{status:'cancelled'},note);
      }
    }
    else bump("status='available',lost_decision_note=?",[note]);
  }else if(action==='retire'){
    v.object(input,['version','note']);
    if(view.open_bookings)fail(409,'open_bookings','ألغِ حجوزات القطعة القائمة قبل ما تستبعدها');
    bump("status='retired',condition_note=?",[v.text(input.note,'سبب الاستبعاد',2000,5)]);
  }else{
    v.object(input,['version','note']);
    bump("status='available',condition_note=?",[v.text(input.note,'ما الذي أُصلح ومن أعادها للخدمة',2000,5)]);
  }
  audit(db,u,'equipment_item',row.id,'equipment.item_'+action,{status:row.status},{version:row.version+1},typeof input.note==='string'?input.note.trim():'');
  return {id:row.id};
}
// رمز QR للقطعة: يولّده المولّد الداخلي ولا يمر بخدمة خارجية، ويفتح صفحة القطعة داخل المنصة.
export function itemQr(db,supplied,itemId){
  const u=gate(db,supplied),row=itemRow(db,u,itemId),target=qrTarget(row.id);
  return {id:row.id,code:row.code,name:row.name,target,svg:qrSvg(target,{scale:4}),
    note:'الرمز يفتح صفحة القطعة داخل المنصة فقط. لا يحمل بيانات القطعة ولا يعمل خارج شبكة المنصة.'};
}

/* ───── الأطقم ───── */
function kitRow(db,u,kitId){
  const row=typeof kitId==='string'&&db.prepare('SELECT * FROM equipment_kits WHERE id=? AND tenant_id=?').get(kitId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا الطقم هذا');
  return row;
}
function kitView(db,u,row){
  const items=db.prepare('SELECT i.id,i.code,i.name,i.status,i.category FROM equipment_kit_items k JOIN equipment_items i ON i.id=k.item_id WHERE k.kit_id=? ORDER BY i.code').all(row.id);
  const actions=row.status==='active'?['add_kit_item','archive_kit',...(items.length?['remove_kit_item','book_kit']:[])]:[];
  return {...row,status_name:row.status==='active'?'نشط':'مؤرشف',created_by_name:name(db,row.created_by),
    items:items.map(i=>({...i,status_name:ITEM_STATES[i.status],category_name:label(CATEGORIES,i.category)})),
    bookable:items.length>0&&items.every(i=>i.status==='available'),actions};
}
export function createKit(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,['name','notes']);
  const title=v.text(input.name,'اسم الطقم',180,3);
  if(db.prepare('SELECT 1 FROM equipment_kits WHERE tenant_id=? AND name=?').get(u.tenant_id,title))fail(409,'duplicate_kit','فيه طقم مسجّل بنفس الاسم');
  const kitId=id(),time=now(),code=nextCode(db,u.tenant_id,'equipment_kits','KIT-');
  db.prepare("INSERT INTO equipment_kits(id,tenant_id,code,name,notes,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?,?)")
    .run(kitId,u.tenant_id,code,title,input.notes?v.text(input.notes,'ملاحظات الطقم',2000):'',u.id,time,time);
  audit(db,u,'equipment_kit',kitId,'equipment.kit_created',{}, {code});
  return {id:kitId,code};
}
export function kitAction(db,supplied,kitId,action,input){
  writing(db);const u=gate(db,supplied),row=kitRow(db,u,kitId),view=kitView(db,u,row);
  const key={add_item:'add_kit_item',remove_item:'remove_kit_item',archive:'archive_kit'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','ما ينفع هذا الإجراء في حالة الطقم الحالية');
  versioned(row,input);
  const time=now();
  if(action==='add_item'){
    v.object(input,['version','item_id']);const item=itemRow(db,u,input.item_id);
    if(item.status==='retired'||item.status==='lost')fail(409,'invalid_state','القطعة المستبعدة ولا المفقودة ما تدخل طقم');
    if(db.prepare('SELECT kit_id FROM equipment_kit_items WHERE item_id=?').get(item.id))fail(409,'already_in_kit','القطعة في طقم ثاني — والقطعة في طقم واحد على الأكثر');
    db.prepare('INSERT INTO equipment_kit_items(kit_id,item_id,added_by,added_at) VALUES(?,?,?,?)').run(row.id,item.id,u.id,time);
  }else if(action==='remove_item'){
    v.object(input,['version','item_id']);
    if(!view.items.some(i=>i.id===input.item_id))fail(404,'not_found','القطعة هذي مو داخل الطقم');
    if(db.prepare("SELECT 1 FROM equipment_bookings WHERE item_id=? AND kit_id=? AND status IN ('reserved','out')").get(input.item_id,row.id))fail(409,'open_bookings','للطقم حجز قائم يضم هذي القطعة');
    db.prepare('DELETE FROM equipment_kit_items WHERE kit_id=? AND item_id=?').run(row.id,input.item_id);
  }else{
    v.object(input,['version','note']);v.text(input.note,'سبب الأرشفة',1000,5);
    if(db.prepare("SELECT 1 FROM equipment_bookings WHERE kit_id=? AND status IN ('reserved','out')").get(row.id))fail(409,'open_bookings','للطقم حجز قائم الحين');
    db.prepare("UPDATE equipment_kits SET status='archived',version=version+1,updated_at=? WHERE id=?").run(time,row.id);
  }
  if(action!=='archive')db.prepare('UPDATE equipment_kits SET version=version+1,updated_at=? WHERE id=?').run(time,row.id);
  audit(db,u,'equipment_kit',row.id,'equipment.kit_'+action,{}, {version:row.version+1});
  return {id:row.id};
}

/* ───── الحجز ───── */
function bookingRow(db,u,bookingId){
  const row=typeof bookingId==='string'&&db.prepare('SELECT * FROM equipment_bookings WHERE id=? AND tenant_id=?').get(bookingId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا الحجز هذا');
  return row;
}
function bookingView(db,u,row,{manage=can(db,u,'equipment.manage')}={}){
  const item=db.prepare('SELECT code,name,status FROM equipment_items WHERE id=?').get(row.item_id);
  const movements=db.prepare('SELECT * FROM equipment_movements WHERE booking_id=? ORDER BY created_at').all(row.id).map(m=>({...m,
    released_by_name:name(db,m.released_by),received_by_name:name(db,m.received_by),condition_name:label(CONDITIONS,m.condition_state),
    photos:db.prepare('SELECT id,label,media_type,size,created_at FROM equipment_photos WHERE movement_id=? ORDER BY created_at').all(m.id)}));
  const mine=row.custodian_id===u.id,late=row.status==='out'&&row.end_date<today(),actions=[];
  if(row.status==='reserved'){
    if(mine)actions.push('hand_out');
    if(manage||row.booked_by===u.id)actions.push('cancel_booking');
  }
  if(row.status==='out'&&manage&&!mine)actions.push('hand_in');
  return {...row,status_name:BOOKING_STATES[row.status],item_code:item?.code??'',item_name:item?.name??'',custodian_name:name(db,row.custodian_id),
    booked_by_name:name(db,row.booked_by),project_name:row.project_id?db.prepare('SELECT name FROM projects WHERE id=?').get(row.project_id)?.name??null:null,
    ...bookingProductionView(db,row),
    mine,late,days_late:late?Math.round((Date.parse(today())-Date.parse(row.end_date))/86400000):0,movements,
    has_out_photo:movements.some(m=>m.kind==='out'&&m.photos.length),has_in_photo:movements.some(m=>m.kind==='in'&&m.photos.length),actions};
}
// الإنتاج المربوط بالحجز كما يُعرض: رمزه واسمه وحالته، من كيان الحجز نفسه.
function bookingProductionView(db,row){
  const p=row.production_id?db.prepare('SELECT code,title,status FROM productions WHERE id=? AND tenant_id=?').get(row.production_id,row.tenant_id):null;
  return {production_code:p?.code??null,production_title:p?.title??null,production_status:p?.status??null};
}
function cleanBooking(db,u,input){
  const from=v.date(input.start_date),to=v.date(input.end_date);
  if(to<from)fail(400,'date_order','خلّ نهاية الحجز بعد بدايته');
  // يُسمح بتسجيل حجز بدأ قريبًا (تسجيل لاحق لما جرى)، لا بنبش تواريخ قديمة.
  if(from<addDays(today(),-30))fail(400,'start_date','ما ينسجّل حجز أقدم من ثلاثين يوم');
  const custodian=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.custodian_id,u.tenant_id);
  if(!custodian)fail(400,'custodian_id','ما لقينا حامل العهدة هذا');
  if(custodian.id===u.id)fail(409,'separation_of_duties','اللي يحجز ويسلّم مو هو اللي يستلم العهدة');
  const project=input.project_id?db.prepare('SELECT id FROM projects WHERE id=? AND tenant_id=?').get(input.project_id,u.tenant_id):null;
  if(input.project_id&&!project)fail(400,'project_id','ما لقينا المشروع هذا');
  const reference=input.production_ref?v.text(input.production_ref,'مرجع الإنتاج أو التصوير',300):'';
  // الحجز على إنتاجٍ يرث مشروع الإنتاج حين لا يُسمّى مشروع: فحص إقفال المشروع يبحث عن المعدات بمشروعها (project-axes)، فحجزٌ على
  // إنتاجٍ بلا مشروع كان لا يراه الإقفال أبدًا. ومشروعٌ مسمّى يخالف مشروع الإنتاج تناقضٌ يُرفض باسمه لا يُختار أحدهما صامتًا.
  const linked=bookingProduction(db,u,input.production_id,reference);
  const productionProject=linked?db.prepare('SELECT project_id FROM productions WHERE id=?').get(linked.id)?.project_id??null:null;
  if(project&&productionProject&&project.id!==productionProject)refuse(409,'production_project_mismatch',{what:`الإنتاج ${linked.code} «${linked.title}» تابع لمشروع ثاني غير المشروع المختار`,
    next:'احجز على مشروع الإنتاج نفسه، أو خلّ المشروع فاضي ويتعبّى من الإنتاج'});
  return {from,to,custodian:custodian.id,project:project?.id??productionProject,production:reference,productionId:linked?.id??null,
    purpose:v.text(input.purpose,'سبب الحجز',1000,5)};
}
// الإنتاج الذي يُحجز له (الترحيل 193): معرّفه إن اختير، وإلا فنص المرجع إن طابق إنتاجًا واحدًا بالضبط في شركتك — رمزه بلا
// اعتبار لحالة الأحرف أو اسمه حرفًا بحرف، وهي القاعدة نفسها التي ربط بها الترحيل الحجوزات القديمة. ما لم يطابق أو طابق
// اثنين يبقى ملاحظة نصية بلا ربط. والحجز على إنتاج حيّ وحده؛ القاعدة نفسها محفّز في SQL لمن يتجاوز الوحدة.
const LIVE_PRODUCTION=['planning','in_production'];
const PRODUCTION_DONE={wrapped:'خلص تصويره',closed:'مقفل',cancelled:'ملغى'};
function bookingProduction(db,u,productionId,reference){
  let row=null;
  if(productionId){
    row=typeof productionId==='string'&&db.prepare('SELECT id,code,title,status FROM productions WHERE id=? AND tenant_id=?').get(productionId,u.tenant_id);
    if(!row)refuse(404,'not_found',{what:'ما لقينا الإنتاج هذا في شركتك',next:'اختر الإنتاج من القائمة، ولا احجز بدون ربط بإنتاج'});
  }else if(reference){
    const matches=db.prepare('SELECT id,code,title,status FROM productions WHERE tenant_id=? AND (code=upper(trim(?)) OR trim(title)=trim(?)) LIMIT 2').all(u.tenant_id,reference,reference);
    if(matches.length===1)row=matches[0];
  }
  if(row&&!LIVE_PRODUCTION.includes(row.status))refuse(409,'production_not_live',{what:`ما تنحجز معدات على الإنتاج ${row.code} «${row.title}» — الإنتاج ${PRODUCTION_DONE[row.status]??row.status}`,
    next:'المعدات تنحجز على إنتاج للحين في التحضير ولا قيد التصوير. اختر إنتاج قائم، ولا احجز بدون ربط بإنتاج واكتب المرجع ملاحظة'});
  return row;
}
export function createBooking(db,supplied,input){
  writing(db);const u=gate(db,supplied);
  v.object(input,['item_id','kit_id','project_id','production_id','production_ref','purpose','start_date','end_date','custodian_id']);
  if(!!input.item_id===!!input.kit_id)fail(400,'item_id','احجز قطعة وحدة ولا طقم كامل — مو الاثنين');
  const f=cleanBooking(db,u,input),groupId=id(),time=now();
  const items=input.kit_id?(()=>{
    const kit=kitRow(db,u,input.kit_id);if(kit.status!=='active')fail(409,'invalid_state','الطقم هذا مؤرشف');
    const rows=db.prepare('SELECT item_id FROM equipment_kit_items WHERE kit_id=?').all(kit.id).map(r=>r.item_id);
    if(!rows.length)fail(409,'empty_kit','الطقم هذا بلا قطع');
    return {kitId:kit.id,ids:rows};
  })():{kitId:null,ids:[itemRow(db,u,input.item_id).id]};
  const created=[];
  // الطقم يُحجز ككتلة: تعارض قطعة واحدة يُسقط الحجز كله (المعاملة نفسها).
  for(const itemId of items.ids){
    const bookingId=id();
    db.prepare("INSERT INTO equipment_bookings(id,tenant_id,item_id,kit_id,group_id,project_id,production_id,production_ref,purpose,start_date,end_date,custodian_id,status,booked_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'reserved',?,?,?)")
      .run(bookingId,u.tenant_id,itemId,items.kitId,groupId,f.project,f.productionId,f.production,f.purpose,f.from,f.to,f.custodian,u.id,time,time);
    created.push(bookingId);
  }
  audit(db,u,'equipment_booking',groupId,'equipment.booked',{}, {items:created.length,from:f.from,to:f.to,custodian_id:f.custodian,production_id:f.productionId});
  return {id:created[0],group_id:groupId,bookings:created};
}
function photoFor(db,u,movementId,photo){
  if(photo===undefined||photo===null||photo==='')return null;
  v.object(photo,['label','filename','content']);
  const filename=v.text(photo.filename,'اسم الصورة',120);
  if([...filename].some(ch=>ch.charCodeAt(0)<32||ch==='/'||ch==='\\')||filename.includes('..'))fail(400,'filename','اسم الملف هذا مو صحيح');
  if(typeof photo.content!=='string'||photo.content.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photo.content))fail(400,'content','ترميز الصورة مو صحيح');
  const data=Buffer.from(photo.content,'base64');
  if(data.length<1||data.length>2097152)fail(413,'file_size','الصورة 2 ميغابايت على الأكثر');
  const media=PHOTO_SIGNATURES.find(([,signature])=>data.subarray(0,signature.length).equals(signature))?.[0];
  if(!media)fail(400,'file_type','صورة الحالة PNG ولا JPEG، وبتوقيع محتوى مطابق');
  db.prepare('INSERT INTO equipment_photos(id,movement_id,label,media_type,size,digest,content,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id(),movementId,v.text(photo.label,'وصف الصورة',180,3),media,data.length,hash(data),data,u.id,now());
  return media;
}
export function bookingAction(db,supplied,bookingId,action,input){
  writing(db);
  // الاستلام يقرّه المستلم نفسه ولو لم يحمل تصريح إدارة المعدات؛ ما عداه لفريق المخزن.
  const u=action==='hand_out'?actor(db,supplied):gate(db,supplied);
  const row=bookingRow(db,u,bookingId),view=bookingView(db,u,row);
  const key={hand_out:'hand_out',hand_in:'hand_in',cancel:'cancel_booking'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','ما ينفع هذا الإجراء في حالة الحجز، ولا هو من صلاحية حسابك');
  versioned(row,input);
  const time=now(),date=today();
  if(action==='cancel'){
    v.object(input,['version','note']);
    db.prepare("UPDATE equipment_bookings SET status='cancelled',cancel_note=?,version=version+1,updated_at=? WHERE id=?").run(v.text(input.note,'سبب الإلغاء',1000,5),time,row.id);
  }else{
    v.object(input,['version','counterpart_id','condition_state','condition_note','acknowledgement','photo']);
    const condition=pick(CONDITIONS,input.condition_state,'condition_state','حالة القطعة غير متاحة');
    const note=v.text(input.condition_note,'وصف حالة القطعة عند المناولة',2000,5);
    const ack=v.text(input.acknowledgement,'نص الإقرار',1000,10);
    const counterpart=db.prepare('SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.counterpart_id,u.tenant_id);
    if(!counterpart)fail(400,'counterpart_id','ما لقينا الطرف الثاني');
    if(counterpart.id===u.id)fail(409,'separation_of_duties','اللي يسلّم مو هو اللي يستلم');
    // فريق المخزن هو الطرف الحامل للتصريح في الحالتين.
    const keeper=action==='hand_out'?counterpart.id:u.id;
    if(!can(db,{id:keeper,tenant_id:u.tenant_id},'equipment.manage'))fail(403,'not_permitted','اللي يسلّم لازم من فريق المخزن (حامل تصريح إدارة المعدات)');
    const released=action==='hand_out'?counterpart.id:row.custodian_id;
    const received=action==='hand_out'?row.custodian_id:u.id;
    if(action==='hand_out'&&u.id!==row.custodian_id)fail(403,'not_permitted','إقرار الاستلام يوقّعه حامل العهدة بنفسه');
    if(action==='hand_in'&&counterpart.id!==row.custodian_id)fail(400,'counterpart_id','اللي يرجّع القطعة هو حامل العهدة المسجّل');
    const movementId=id();
    db.prepare('INSERT INTO equipment_movements(id,booking_id,kind,moved_on,released_by,received_by,condition_state,condition_note,acknowledgement,acknowledged_by,acknowledged_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(movementId,row.id,action==='hand_out'?'out':'in',date,released,received,condition,note,ack,received,time,time);
    photoFor(db,u,movementId,input.photo);
    db.prepare('UPDATE equipment_bookings SET status=?,version=version+1,updated_at=? WHERE id=?').run(action==='hand_out'?'out':'returned',time,row.id);
    // العودة بحالة تالفة أو ناقصة تُدخل القطعة الصيانة حتى يُفتح أمر عمل ويُغلق.
    const itemStatus=action==='hand_out'?'in_use':['damaged','incomplete'].includes(condition)?'maintenance':'available';
    db.prepare('UPDATE equipment_items SET status=?,condition_state=?,condition_note=?,version=version+1,updated_at=? WHERE id=?').run(itemStatus,condition,note,time,row.item_id);
  }
  audit(db,u,'equipment_booking',row.id,'equipment.'+action,{status:row.status},{version:row.version+1});
  return {id:row.id};
}
// صورة الحالة دليل عهدة يُطلَع عليه ويُرسَل أحيانًا لطرف خارج الشركة (مورد صيانة، تأمين)، فكل قراءة حدثُ تدقيق واحد
// باسم القارئ وبصمة الصورة. الخادم يلفّ القراءة والتدقيق في معاملة واحدة: تدقيقٌ يتعذر لا تخرج بعده الصورة، والمرفوض لا يكتب شيئًا.
export function movementPhoto(db,supplied,photoId){
  const u=gate(db,supplied);
  const row=typeof photoId==='string'&&db.prepare('SELECT p.*,m.booking_id,b.tenant_id AS booking_tenant FROM equipment_photos p JOIN equipment_movements m ON m.id=p.movement_id JOIN equipment_bookings b ON b.id=m.booking_id WHERE p.id=?').get(photoId);
  if(!row||row.booking_tenant!==u.tenant_id)fail(404,'not_found','ما لقينا الصورة هذي');
  // البصمة المكتوبة في التدقيق بصمةُ ما خرج فعلًا: صورة لا تطابق بصمتها لا تُسلَّم ولا يُكتب أنها سُلّمت.
  if(hash(Buffer.from(row.content))!==row.digest)refuse(409,'photo_corrupted',{what:'ما نقدر نعرض صورة الحالة هذي: محتواها ما يطابق بصمتها المحفوظة',
    missing:[{document:'نسخة سليمة من صورة الحالة',why:'الصورة دليل عهدة، وما يُسلَّم دليل تغيّر بعد حفظه',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'بلّغ مسؤول المنصة يرجّعها من آخر نسخة احتياطية'});
  audit(db,u,'equipment_photo',row.id,'equipment.photo_viewed',{},{movement_id:row.movement_id,booking_id:row.booking_id,digest:row.digest,media_type:row.media_type,size:row.size});
  return {id:row.id,label:row.label,media_type:row.media_type,size:row.size,content:row.content};
}

/* ───── الصيانة ───── */
function orderRow(db,u,orderId){
  const row=typeof orderId==='string'&&db.prepare('SELECT * FROM equipment_maintenance WHERE id=? AND tenant_id=?').get(orderId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا أمر العمل هذا');
  return row;
}
function orderView(db,u,row){
  const item=db.prepare('SELECT code,name FROM equipment_items WHERE id=?').get(row.item_id);
  return {...row,status_name:MAINTENANCE_STATES[row.status],kind_name:label(MAINTENANCE_KINDS,row.kind),item_code:item?.code??'',item_name:item?.name??'',
    opened_by_name:name(db,row.opened_by),closed_by_name:name(db,row.closed_by),
    actions:row.status==='open'?['start_work','complete_work','cancel_work']:row.status==='in_progress'?['complete_work','cancel_work']:[]};
}
export function openWorkOrder(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,['item_id','kind','description']);
  const item=itemRow(db,u,input.item_id);
  if(['lost','retired'].includes(item.status))fail(409,'invalid_state','القطعة المفقودة ولا المستبعدة ما ينفتح لها أمر عمل');
  const orderId=id(),time=now();
  db.prepare("INSERT INTO equipment_maintenance(id,tenant_id,item_id,kind,description,status,opened_by,opened_on,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?,?)")
    .run(orderId,u.tenant_id,item.id,pick(MAINTENANCE_KINDS,input.kind,'kind','نوع أمر العمل غير متاح'),v.text(input.description,'ما المطلوب عمله',3000,10),u.id,today(),time,time);
  if(item.status==='available')db.prepare("UPDATE equipment_items SET status='maintenance',version=version+1,updated_at=? WHERE id=?").run(time,item.id);
  audit(db,u,'equipment_maintenance',orderId,'equipment.work_order_opened',{}, {item_id:item.id,kind:input.kind});
  return {id:orderId};
}
export function workOrderAction(db,supplied,orderId,action,input){
  writing(db);const u=gate(db,supplied),row=orderRow(db,u,orderId),view=orderView(db,u,row);
  const key={start:'start_work',complete:'complete_work',cancel:'cancel_work'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state','ما ينفع هذا الإجراء في حالة أمر العمل الحالية');
  versioned(row,input);
  const time=now();
  if(action==='start'){
    v.object(input,['version','vendor_note']);
    db.prepare("UPDATE equipment_maintenance SET status='in_progress',vendor_note=?,version=version+1,updated_at=? WHERE id=?").run(input.vendor_note?v.text(input.vendor_note,'من ينفذها',600):'',time,row.id);
  }else{
    v.object(input,['version','resolution','cost','cost_reference']);
    const resolution=v.text(input.resolution,action==='complete'?'ما الذي أُنجز':'سبب الإلغاء',2000,10);
    const cost=input.cost?money(String(input.cost).trim(),'تكلفة الصيانة'):0;
    if(cost&&!(typeof input.cost_reference==='string'&&input.cost_reference.trim().length>=3))fail(400,'cost_reference','اكتب مرجع فاتورة الصيانة هنا');
    db.prepare('UPDATE equipment_maintenance SET status=?,closed_by=?,closed_on=?,resolution=?,cost_minor=?,cost_reference=?,version=version+1,updated_at=? WHERE id=?')
      .run(action==='complete'?'done':'cancelled',u.id,today(),resolution,cost,cost?input.cost_reference.trim():'',time,row.id);
    const open=db.prepare("SELECT COUNT(*) AS n FROM equipment_maintenance WHERE item_id=? AND status IN ('open','in_progress')").get(row.item_id).n;
    const item=db.prepare('SELECT status FROM equipment_items WHERE id=?').get(row.item_id);
    if(!open&&item.status==='maintenance')db.prepare("UPDATE equipment_items SET status='available',version=version+1,updated_at=? WHERE id=?").run(time,row.item_id);
  }
  audit(db,u,'equipment_maintenance',row.id,'equipment.work_order_'+action,{status:row.status},{version:row.version+1});
  return {id:row.id};
}

/* ───── الجرد بالمسح ───── */
function checkRow(db,u,checkId){
  const row=typeof checkId==='string'&&db.prepare('SELECT * FROM equipment_inventory_checks WHERE id=? AND tenant_id=?').get(checkId,u.tenant_id);
  if(!row)fail(404,'not_found','ما لقينا الجرد هذا');
  return row;
}
function checkView(db,u,row){
  const scans=db.prepare('SELECT s.*,i.code,i.name FROM equipment_inventory_scans s JOIN equipment_items i ON i.id=s.item_id WHERE s.check_id=? ORDER BY s.confirmed_at').all(row.id);
  const expected=db.prepare("SELECT id,code,name,status FROM equipment_items WHERE tenant_id=? AND status NOT IN ('retired','lost') ORDER BY code").all(u.tenant_id);
  const seen=new Set(scans.map(s=>s.item_id)),actions=[];
  if(row.status==='open'){actions.push('scan_item');if(row.started_by!==u.id)actions.push('close_check');}
  return {...row,status_name:row.status==='open'?'مفتوح':'مقفل',started_by_name:name(db,row.started_by),closed_by_name:name(db,row.closed_by),
    scans:scans.map(s=>({...s,condition_name:label(CONDITIONS,s.condition_state),confirmed_by_name:name(db,s.confirmed_by)})),
    expected:expected.length,confirmed:seen.size,missing:expected.filter(i=>!seen.has(i.id)).map(i=>({id:i.id,code:i.code,name:i.name,status_name:ITEM_STATES[i.status]})),actions};
}
export function startCheck(db,supplied,input){
  writing(db);const u=gate(db,supplied);v.object(input,['name']);
  const title=v.text(input.name,'اسم جولة الجرد',180,3);
  if(db.prepare('SELECT 1 FROM equipment_inventory_checks WHERE tenant_id=? AND name=?').get(u.tenant_id,title))fail(409,'duplicate_check','فيه جولة جرد بنفس الاسم');
  const checkId=id(),time=now();
  db.prepare("INSERT INTO equipment_inventory_checks(id,tenant_id,name,status,started_by,started_at,created_at,updated_at) VALUES(?,?,?,'open',?,?,?,?)").run(checkId,u.tenant_id,title,u.id,time,time,time);
  audit(db,u,'equipment_inventory',checkId,'equipment.inventory_started',{}, {name:title});
  return {id:checkId};
}
export function checkAction(db,supplied,checkId,action,input){
  writing(db);const u=gate(db,supplied),row=checkRow(db,u,checkId),view=checkView(db,u,row);
  const key={scan:'scan_item',close:'close_check'}[action];
  if(!key||!view.actions.includes(key))fail(409,'invalid_state',row.status==='closed'?'الجرد مقفل':'من بدأ الجرد لا يقفله');
  versioned(row,input);
  const time=now();
  if(action==='scan'){
    v.object(input,['version','item_id','condition_state','note']);
    const item=itemRow(db,u,input.item_id);
    if(['retired','lost'].includes(item.status))fail(409,'invalid_state','القطعة المستبعدة ولا المفقودة خارج الجرد');
    if(view.scans.some(s=>s.item_id===item.id))fail(409,'already_scanned','وجود هذي القطعة تأكّد في هذي الجولة');
    db.prepare('INSERT INTO equipment_inventory_scans(check_id,item_id,condition_state,note,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?)')
      .run(row.id,item.id,pick(CONDITIONS,input.condition_state,'condition_state','حالة القطعة غير متاحة'),input.note?v.text(input.note,'ملاحظة المسح',600):'',u.id,time);
    db.prepare('UPDATE equipment_inventory_checks SET version=version+1,updated_at=? WHERE id=?').run(time,row.id);
  }else{
    v.object(input,['version','note']);
    db.prepare("UPDATE equipment_inventory_checks SET status='closed',closed_by=?,closed_at=?,closing_note=?,version=version+1,updated_at=? WHERE id=?")
      .run(u.id,time,v.text(input.note,'خلاصة الجولة وما لم يُعثر عليه',2000,10),time,row.id);
  }
  audit(db,u,'equipment_inventory',row.id,'equipment.inventory_'+action,{status:row.status},{version:row.version+1});
  return {id:row.id};
}

/* ───── اللوحة والتقارير ───── */
// استغلال القطعة: أيام مُسلَّمة فعليًا خلال نافذة الأيام المطلوبة، لا أيام محجوزة فقط.
export function utilization(db,supplied,days=90){
  const u=gate(db,supplied),window=Number.isInteger(days)&&days>=7&&days<=365?days:90,from=addDays(today(),-window+1),to=today();
  const overlap=(start,end)=>{const a=start>from?start:from,b=end<to?end:to;return b<a?0:Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;};
  return {from,to,days:window,note:'الاستغلال محسوب من أيام التسليم الفعلي المسجلة في المنصة. لا يقيس ساعات التشغيل ولا يقرأ من الجهاز نفسه.',
    items:db.prepare("SELECT id,code,name,status FROM equipment_items WHERE tenant_id=? AND status<>'retired' ORDER BY code").all(u.tenant_id).map(item=>{
      const rows=db.prepare("SELECT status,start_date,end_date FROM equipment_bookings WHERE item_id=? AND status IN ('out','returned') AND end_date>=? AND start_date<=?").all(item.id,from,to);
      const used=rows.reduce((n,b)=>n+overlap(b.start_date,b.end_date),0);
      return {...item,status_name:ITEM_STATES[item.status],bookings:rows.length,used_days:Math.min(used,window),utilisation_bp:Math.round(Math.min(used,window)*10000/window)};
    })};
}
export function equipmentBoard(db,supplied,options={}){
  const u=actor(db,supplied),manage=can(db,u,'equipment.manage');
  const bookingRows=manage
    ?db.prepare("SELECT * FROM equipment_bookings WHERE tenant_id=? ORDER BY status IN ('returned','cancelled'),start_date DESC LIMIT 300").all(u.tenant_id)
    :db.prepare("SELECT * FROM equipment_bookings WHERE tenant_id=? AND custodian_id=? ORDER BY status IN ('returned','cancelled'),start_date DESC LIMIT 100").all(u.tenant_id,u.id);
  const bookings=bookingRows.map(r=>bookingView(db,u,r,{manage}));
  const base={today:today(),user_id:u.id,can_manage:manage,categories:CATEGORIES,conditions:CONDITIONS,item_states:ITEM_STATES,
    booking_states:BOOKING_STATES,maintenance_kinds:MAINTENANCE_KINDS,bookings,overdue:bookings.filter(b=>b.late).length,
    note:'العهدة إقرار داخلي في المنصة باسم المستلم ووقته، وليست توقيعًا ذا حجية نظامية. من يسلّم ليس من يستلم، وحالة «مفقود» تحتاج إقرار مسؤول أعلى غير من بلّغ.'};
  if(!manage)return {...base,items:[],kits:[],work_orders:[],checks:[],utilization:null,custodians:[],projects:[],productions:[],assets:[],
    note:base.note+' لا تحمل تصريح إدارة المعدات، فترى عهدك أنت فقط.'};
  return {...base,
    items:db.prepare('SELECT * FROM equipment_items WHERE tenant_id=? ORDER BY status,code LIMIT 500').all(u.tenant_id).map(r=>itemView(db,u,r,{manage})),
    kits:db.prepare('SELECT * FROM equipment_kits WHERE tenant_id=? ORDER BY status,code LIMIT 200').all(u.tenant_id).map(r=>kitView(db,u,r)),
    work_orders:db.prepare('SELECT * FROM equipment_maintenance WHERE tenant_id=? ORDER BY status,opened_on DESC LIMIT 200').all(u.tenant_id).map(r=>orderView(db,u,r)),
    checks:db.prepare('SELECT * FROM equipment_inventory_checks WHERE tenant_id=? ORDER BY status,started_at DESC LIMIT 50').all(u.tenant_id).map(r=>checkView(db,u,r)),
    utilization:utilization(db,u,options.days),
    custodians:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id),
    projects:db.prepare('SELECT id,name FROM projects WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(u.tenant_id),
    // الإنتاجات التي يُحجز لها (الترحيل 193): الحية من كيانك وحده — في التحضير ولا قيد التصوير.
    productions:db.prepare("SELECT id,code,title,status FROM productions WHERE tenant_id=? AND status IN ('planning','in_production') ORDER BY code LIMIT 200").all(u.tenant_id),
    assets:db.prepare("SELECT id,code,name FROM fixed_assets WHERE tenant_id=? AND status IN ('active','pending') AND id NOT IN (SELECT asset_id FROM equipment_items WHERE asset_id IS NOT NULL) ORDER BY code LIMIT 200").all(u.tenant_id)};
}
