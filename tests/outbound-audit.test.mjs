import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { getRoute, createRoute, reviewAction, clientPack, previewMedia } from '../app/review-rounds.mjs';
import { createItem, createBooking, bookingAction, movementPhoto, equipmentBoard } from '../app/equipment.mjs';

// تدقيق ما يخرج (الحزمة 4، P4-PORTAL-2). لا بوابة للعميل ولا للمورد (قرار المالك: المنصة للموظفين فقط)، فما يصل الجهة
// الخارجية يصلها من يد موظف: حزمة العميل في المراجعة الإبداعية (ما يجوز عرضه على العميل)، ومعاينة المادة التي تُعرض عليه،
// وصورة حالة المعدات عند المناولة. كانت الثلاث تُقرأ بلا أثر، بينما تنزيل الملفات والمرفقات وطباعة تقرير العميل مسجَّلة.
// الآن: قراءة واحدة = حدث تدقيق واحد، في معاملة القراءة نفسها، فتدقيقٌ يتعذر لا يخرج بعده بايت؛ والقراءة المرفوضة لا تكتب شيئًا.

const PASSWORD='synthetic-outbound-audit';
const code=value=>error=>error.code===value;
const sha=value=>createHash('sha256').update(value).digest('hex');
const OUTBOUND=['review.client_pack_prepared','review.media_viewed','equipment.photo_viewed'];
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic-png-body-for-outbound-audit')]);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const brief={objective:'هدف تجريبي قابل للمراجعة',audience:'جمهور مصطنع للمشروع',audience_basis:'افتراض محلي معلن؛ لم يجر بحث ميداني',message:'رسالة الاختبار المعتمدة',prohibited_messages:'منع الادعاءات غير المسندة',kpi:'عدد استكمال نموذج الاهتمام',measurement_source:'سجل تجريبي محلي',channels:['instagram'],scope:'مخرج نصي واحد للاختبار'};
const output=assetId=>({title:'منشور الإطلاق المصطنع',channel:'instagram',format:'نص تجريبي',dimensions:'مربع موصوف 1080×1080',language:'العربية',brand_reference:'ATHAR-DEMO',acceptance:'مطابقة الرسالة',content:'محتوى عربي مصطنع للمراجعة.',asset_ids:[assetId]});

function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  // حسابات بكلمة مرور البذرة نفسها، فتدخل عبر الخادم كما يدخل غيرها.
  for(const [id,name] of [['creative-lead','قائد إبداعي تجريبي'],['account-lead','مدير حساب تجريبي'],['file-owner','مالكة ملف تجريبية']])
    db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT ?,'36t','creative',?,?,password_hash,'pm','manager' FROM users WHERE id='manager'").run(id,id,name);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('iso-admin','isolated','other','iso-admin','مسؤولة الكيان المعزول التجريبية','unused','admin',NULL)");
  db.exec("UPDATE users SET admin_level='super' WHERE id='iso-admin'");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // outsider يحمل التصريح وليس عضوًا في المشروع؛ hr لا يحمل التصريح أصلًا.
  for(const uid of ['employee','manager','creative-lead','account-lead','file-owner','outsider'])
    tx(()=>grantAccess(db,users.admin,{user_id:uid,capability:'review.manage',department_id:'',note:'اختبار تدقيق ما يخرج'}));
  const project=tx(()=>createProject(db,users.manager,{name:'حساب عميل مصطنع',brief:'اختبار تدقيق ما يخرج',member_ids:['employee','creative-lead','account-lead','file-owner']}));
  const act=(who,s,action,input={})=>tx(()=>studioAction(db,users[who],s.id,action,{version:s.version,...input}));
  let s=tx(()=>createStudio(db,users.employee,{project_id:project.id,title:'مساحة تسليم مصطنعة',...brief}));
  s=act('manager',act('employee',s,'submit_brief'),'approve_brief',{note:'راجعنا الهدف والرسالة'});
  s=act('employee',s,'add_asset',{name:'أصل نصي مصطنع',internal_reference:'ASSET_1',rights_holder:'صاحب حق مصطنع',rights_basis:'owned',rights_evidence:'إفادة ملكية داخلية مصطنعة',valid_from:'2020-01-01',valid_until:'2099-12-31',channels:['instagram']});
  s=act('manager',s,'inspect_asset',{asset_id:s.assets[0].id,outcome:'passed',evidence:'إفادة فحص الحقوق والقنوات والمدة'});
  s=act('employee',s,'create_output',output(s.assets[0].id));
  const routeId=tx(()=>createRoute(db,users.employee,{output_version_id:s.outputs[0].current_version_id,name:'مسار مراجعة مصطنع',owner_id:'file-owner',template_id:'',
    stages:[{position:1,name:'إبداعي',audience:'internal',reviewer_ids:['creative-lead'],due_days:3,reminder_days:1,escalation_days:2}]})).id;
  const run=(who,action,input={})=>tx(()=>reviewAction(db,users[who],routeId,action,{version:getRoute(db,users[who],routeId).version,...input}));
  run('employee','add_media',{kind:'image',label:'التصميم المعروض',content:{filename:'design.png',content:PNG.toString('base64')}});
  run('employee','add_media',{kind:'text',label:'نص الإعلان',body:'السطر الأول من النص الخاضع للمراجعة. السطر الثاني يحتاج تعديلًا.'});
  const media=getRoute(db,users.employee,routeId).media,image=media.find(m=>m.kind==='image'),text=media.find(m=>m.kind==='text');
  run('creative-lead','annotate',{media_id:image.id,visibility:'shared',body:'الشعار مزاح إلى اليمين قليلًا',x:0.5,y:0.25});
  // المعدات: قطعة تُسلَّم بصورة حالتها.
  const item=tx(()=>createItem(db,users.manager,{name:'كاميرا مصطنعة للتدقيق',category:'camera',serial_no:'',condition_state:'good',condition_note:'',home_location:'مخزن مصطنع',asset_id:''})).id;
  const bookingId=tx(()=>createBooking(db,users.manager,{item_id:item,kit_id:'',project_id:'',production_ref:'',purpose:'تصوير مصطنع للتدقيق',start_date:today(),end_date:today(),custodian_id:'employee'})).bookings[0];
  const booking=()=>equipmentBoard(db,users.manager).bookings.find(b=>b.id===bookingId);
  tx(()=>bookingAction(db,users.employee,bookingId,'hand_out',{version:booking().version,counterpart_id:'manager',condition_state:'good',condition_note:'سليمة ومعها بطاريتان',
    acknowledgement:'أقر باستلام الكاميرا ومسؤوليتي عنها حتى إعادتها',photo:{label:'حالة الكاميرا عند التسليم',filename:'out.png',content:PNG.toString('base64')}}));
  const photoId=booking().movements[0].photos[0].id;
  const rows=action=>db.prepare('SELECT * FROM audit_events WHERE action=? ORDER BY seq').all(action);
  const total=()=>db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  return {db,users,tx,routeId,run,image,text,photoId,bookingId,rows,total};
}

// طلب داخل العملية بلا منفذ (نمط tests/definitions-fixture.mjs).
function request(app,{method='GET',path,headers={},body}){
  return new Promise((resolve,reject)=>{
    const req=Object.assign(Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]),{method,url:path,
      headers:{host:'127.0.0.1:3600',...(body===undefined?{}:{'content-type':'application/json'}),...Object.fromEntries(Object.entries(headers).map(([k,x])=>[k.toLowerCase(),x]))},
      socket:{remoteAddress:'127.0.0.1',encrypted:false}});
    let status=0,head={};
    const res={writeHead(s,h={}){status=s;head=h;return res;},setHeader(){},getHeader(){},
      end(data){const buffer=data===undefined?Buffer.alloc(0):Buffer.isBuffer(data)?data:Buffer.from(String(data));
        resolve({status,headers:head,buffer,text:buffer.toString('utf8'),json(){return JSON.parse(buffer.toString('utf8'));}});}};
    try{app.emit('request',req,res);}catch(error){reject(error);}
  });
}
async function sessions(app,names){
  const out={};
  for(const username of names){
    const response=await request(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    assert.equal(response.status,200,`login ${username}: ${response.text.slice(0,200)}`);
    out[username]={cookie:response.headers['Set-Cookie'].split(';')[0],'x-csrf-token':response.json().csrf};
  }
  return out;
}

test('outbound audit: preparing the client pack writes one review.client_pack_prepared event carrying the sha256 of the exact payload — an unchanged pack keeps its digest, a shared note moves it, an internal note does not',t=>{
  const {db,users,tx,routeId,run,image,rows}=fixture(t);
  const pack1=tx(()=>clientPack(db,users['account-lead'],routeId));
  let events=rows('review.client_pack_prepared');
  assert.equal(events.length,1,'one read, one event');
  const after=JSON.parse(events[0].after_json);
  assert.equal(events[0].entity_type,'review_route');assert.equal(events[0].entity_id,routeId);assert.equal(events[0].actor_id,'account-lead');assert.equal(events[0].tenant_id,'36t');
  assert.equal(after.digest,sha(JSON.stringify(pack1)),'the digest is over the exact payload handed back');
  assert.deepEqual({media:after.media,shared_annotations:after.shared_annotations},{media:pack1.media.length,shared_annotations:pack1.shared_annotations.length});
  const pack2=tx(()=>clientPack(db,users['account-lead'],routeId));
  events=rows('review.client_pack_prepared');
  assert.equal(events.length,2,'every preparation is its own event');
  assert.equal(JSON.parse(events[1].after_json).digest,after.digest,'the same pack, the same digest');
  assert.deepEqual(pack2,pack1);
  run('creative-lead','annotate',{media_id:image.id,visibility:'internal',body:'ملاحظة داخلية لا تخرج للعميل أبدًا',x:0.1,y:0.1});
  const pack3=tx(()=>clientPack(db,users['account-lead'],routeId));
  assert.equal(JSON.parse(rows('review.client_pack_prepared')[2].after_json).digest,after.digest,'an internal note changes nothing that leaves');
  run('creative-lead','annotate',{media_id:image.id,visibility:'shared',body:'نقترح تكبير الشعار قليلًا',x:0.7,y:0.4});
  const pack4=tx(()=>clientPack(db,users['account-lead'],routeId));
  const moved=JSON.parse(rows('review.client_pack_prepared')[3].after_json).digest;
  assert.notEqual(moved,after.digest,'a shared note changes the pack, so the digest moves');
  assert.equal(moved,sha(JSON.stringify(pack4)));
  assert.notDeepEqual(pack4,pack3);
  assert.ok(verifyAudit(db));
});

test('outbound audit: every internal preview of review material writes one review.media_viewed, and every condition photo one equipment.photo_viewed, each naming what was read',t=>{
  const {db,users,tx,image,photoId,bookingId,rows}=fixture(t);
  for(let i=1;i<=3;i++){
    const bytes=tx(()=>previewMedia(db,users['creative-lead'],image.id));
    assert.ok(bytes.content.equals(PNG));
    assert.equal(rows('review.media_viewed').length,i,`read ${i}: ${i} events`);
  }
  const viewed=rows('review.media_viewed')[0],seen=JSON.parse(viewed.after_json);
  assert.deepEqual([viewed.entity_type,viewed.entity_id,viewed.actor_id],['review_media',image.id,'creative-lead']);
  assert.equal(seen.digest,sha(PNG),'the event carries the digest of the bytes that left');
  assert.equal(seen.media_type,'image/png');
  for(let i=1;i<=2;i++){
    const photo=tx(()=>movementPhoto(db,users.manager,photoId));
    assert.ok(Buffer.from(photo.content).equals(PNG));
    assert.equal(rows('equipment.photo_viewed').length,i);
  }
  const photoEvent=rows('equipment.photo_viewed')[0],photoAfter=JSON.parse(photoEvent.after_json);
  assert.deepEqual([photoEvent.entity_type,photoEvent.entity_id,photoEvent.actor_id],['equipment_photo',photoId,'manager']);
  assert.equal(photoAfter.booking_id,bookingId);assert.equal(photoAfter.digest,sha(PNG));
  assert.ok(verifyAudit(db));
});

test('outbound audit: a denied read writes nothing — no capability, a project you are not in, another tenant, a missing id, text material — inside a transaction or outside one',t=>{
  const {db,users,tx,routeId,image,text,photoId,total}=fixture(t);
  const before=total();
  const denied=[
    [()=>previewMedia(db,users.hr,image.id),'not_permitted'],
    [()=>previewMedia(db,users.outsider,image.id),'not_found'],
    [()=>previewMedia(db,users['iso-admin'],image.id),'not_found'],
    [()=>previewMedia(db,users['creative-lead'],randomUUID()),'not_found'],
    [()=>previewMedia(db,users['creative-lead'],text.id),'text_media'],
    [()=>clientPack(db,users.hr,routeId),'not_permitted'],
    [()=>clientPack(db,users.outsider,routeId),'not_found'],
    [()=>clientPack(db,users['iso-admin'],routeId),'not_found'],
    [()=>movementPhoto(db,users.employee,photoId),'not_permitted'],
    [()=>movementPhoto(db,users['iso-admin'],photoId),'not_found'],
    [()=>movementPhoto(db,users.manager,randomUUID()),'not_found']];
  for(const [read,expected] of denied){
    assert.throws(()=>tx(read),code(expected));
    assert.throws(read,code(expected));
  }
  assert.equal(total(),before,'not one audit row from a refused read');
  // ومادة تالفة لا تُسلَّم ولا يُكتب أنها سُلّمت.
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='review_media'").all())db.exec(`DROP TRIGGER "${name}"`);
  db.prepare('UPDATE review_media SET digest=? WHERE id=?').run('0'.repeat(64),image.id);
  assert.throws(()=>tx(()=>previewMedia(db,users['creative-lead'],image.id)),code('media_corrupted'));
  assert.equal(total(),before);
});

test('outbound audit over HTTP: each read sends its bytes after exactly one audit row, the pack digest is the sha256 of the bytes on the wire, a failing audit sends no bytes, and a refused read writes no outbound row',async t=>{
  const {db,routeId,image,photoId,rows}=fixture(t);
  const app=createApp(db),who=await sessions(app,['creative-lead','account-lead','manager','outsider','hr']);
  const count=()=>Object.fromEntries(OUTBOUND.map(action=>[action,rows(action).length]));
  const media=await request(app,{path:`/api/review-rounds/media/${image.id}`,headers:who['creative-lead']});
  assert.equal(media.status,200);assert.ok(media.buffer.equals(PNG));
  const photo=await request(app,{path:`/api/equipment/photos/${photoId}`,headers:who.manager});
  assert.equal(photo.status,200);assert.ok(photo.buffer.equals(PNG));
  const pack=await request(app,{method:'POST',path:`/api/review-rounds/${routeId}/client-pack`,headers:who['account-lead'],body:{}});
  assert.equal(pack.status,201,pack.text.slice(0,300));
  assert.deepEqual(count(),{'review.client_pack_prepared':1,'review.media_viewed':1,'equipment.photo_viewed':1});
  assert.equal(JSON.parse(rows('review.client_pack_prepared')[0].after_json).digest,sha(pack.text),'the digest matches the exact bytes the employee received');

  // تدقيقٌ يتعذر: المعاملة تتراجع ولا يخرج بايت واحد من المادة.
  db.exec(`CREATE TEMP TRIGGER outbound_audit_down BEFORE INSERT ON main.audit_events WHEN NEW.action IN (${OUTBOUND.map(a=>`'${a}'`).join(',')})
    BEGIN SELECT RAISE(ABORT,'synthetic audit outage'); END`);
  const failed=[
    await request(app,{path:`/api/review-rounds/media/${image.id}`,headers:who['creative-lead']}),
    await request(app,{path:`/api/equipment/photos/${photoId}`,headers:who.manager}),
    await request(app,{method:'POST',path:`/api/review-rounds/${routeId}/client-pack`,headers:who['account-lead'],body:{}})];
  for(const response of failed){
    assert.equal(response.status,500);
    assert.equal(response.json().error.code,'internal_error');
    assert.equal(response.buffer.includes(PNG.subarray(0,8)),false,'no material bytes went out');
    assert.equal(response.text.includes('shared_annotations'),false,'no pack went out');
  }
  db.exec('DROP TRIGGER temp.outbound_audit_down');
  assert.deepEqual(count(),{'review.client_pack_prepared':1,'review.media_viewed':1,'equipment.photo_viewed':1},'a failed audit leaves no half-written row');

  // القراءة المرفوضة لا تكتب حدث خروج. (رفض 403 يكتبه الخادم حدث «denied» أمنيًا كما في كل مسار، وهذا غير حدث الخروج.)
  const deniedBefore=db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='denied'").get().n;
  const refused=[
    [await request(app,{path:`/api/review-rounds/media/${image.id}`,headers:who.outsider}),404],
    [await request(app,{path:`/api/review-rounds/media/${image.id}`,headers:who.hr}),403],
    [await request(app,{path:`/api/equipment/photos/${photoId}`,headers:who.outsider}),403],
    [await request(app,{method:'POST',path:`/api/review-rounds/${routeId}/client-pack`,headers:who.outsider,body:{}}),404],
    [await request(app,{path:`/api/review-rounds/media/${image.id}`}),401]];
  for(const [response,status] of refused){assert.equal(response.status,status);assert.equal(response.buffer.includes(PNG.subarray(0,8)),false);}
  assert.deepEqual(count(),{'review.client_pack_prepared':1,'review.media_viewed':1,'equipment.photo_viewed':1});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='denied'").get().n,deniedBefore+2,'the two 403s are logged as access denials, nothing else');
  assert.ok(verifyAudit(db));
});
