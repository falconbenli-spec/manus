import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createProduction, productionAction, productionsBoard } from '../app/production.mjs';
import { createItem, createKit, kitAction, createBooking, bookingAction, equipmentBoard } from '../app/equipment.mjs';
import { approvedVersion, reviewRoute } from './studio-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';

// المعدات والإنتاج (الحزمة 4، P4-DOMAIN-3، الترحيل 193). كان الحجز يحمل الإنتاج نصًّا حرًّا (production_ref، 063)؛ صار
// يحمل معرّفه: يُربط بإنتاج كيانه وحده، ولا يُحجز على إنتاج انتهى تصويره أو أُقفل أو أُلغي، ولا يُقفل إنتاجٌ ومعداته
// طالعة أو محجوزة له — والرفض يسمّي القطع ومن هي بعهدته. والحجوزات القديمة رُبطت بنصّها إذا طابق إنتاجًا واحدًا بالضبط.

const PASSWORD='synthetic-equipment-production';
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const item=(name,extra={})=>({name,category:'camera',serial_no:'',condition_state:'good',condition_note:'',home_location:'مخزن تصوير مصطنع',asset_id:'',...extra});
const production=(projectId,codeValue,title,extra={})=>({code:codeValue,title,kind:'ad',brief:'موجز مصطنع',client_id:'',campaign_id:'',project_id:projectId,shoot_from:today(),shoot_to:addDays(today(),5),...extra});
const STAMP='2026-09-01T08:00:00.000Z';

function people(db){
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('iso-admin','isolated','other','iso-admin','مسؤولة الكيان المعزول التجريبية','unused','admin',NULL)");
  db.exec("UPDATE users SET admin_level='super' WHERE id='iso-admin'");
  db.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('iso-project','isolated','مشروع الكيان المعزول','موجز مصطنع','iso-admin',?)").run(STAMP);
  return Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
}
function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  let users=people(db);const tx=f=>transaction(db,f);
  // المنتج (manager) يحمل تصريح الإنتاج، ومن يقفل الإنتاج (hr) غير منتجه. manager أمين المخزن أيضًا بدوره.
  for(const who of ['manager','hr'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'production.manage',department_id:'',note:'اختبار مصطنع لربط المعدات بالإنتاج'}));
  users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تصوير مصطنع',brief:'ربط المعدات بالإنتاج',member_ids:['employee','outsider']})).id;
  // كل إنتاج هنا جاهز للتصوير (PRO-01، الترحيل 188): يصوّر معالجة وافق عليها مسار مراجعة، ولمشروعه مخصص معتمد يغطي المدة.
  const treatment=reviewRoute(db,users,{version:approvedVersion(db,users,{project,title:'معالجة تصوير مصطنعة'}).version});fundProject(db,project,'EQP-CC');
  const make=(codeValue,title,extra)=>tx(()=>createProduction(db,users.manager,production(project,codeValue,title,{review_route_id:treatment,...extra}))).id;
  const of=id=>productionsBoard(db,users.manager).productions.find(p=>p.id===id);
  const move=(id,action,input={})=>tx(()=>productionAction(db,users[action==='close'?'hr':'manager'],id,action,{version:of(id).version,...input}));
  const live=make('SHOOT-01','إعلان رمضان المصطنع');
  const wrapped=make('SHOOT-02','تصوير المنتج المصطنع');move(wrapped,'start');move(wrapped,'wrap',{wrap_note:'انتهى التصوير وسُلّمت المواد الخام للمونتاج'});
  const closed=make('SHOOT-03','فيلم الشركة المصطنع');move(closed,'start');move(closed,'wrap',{wrap_note:'انتهى التصوير وسُلّمت المواد الخام للمونتاج'});move(closed,'close',{note:'المخرجات سُلّمت والتصاريح موثقة'});
  const cancelled=make('SHOOT-04','حملة ملغاة مصطنعة');move(cancelled,'cancel',{note:'ألغى العميل الحملة قبل التصوير'});
  const iso=tx(()=>createProduction(db,users['iso-admin'],production('iso-project','ISO-01','إنتاج الكيان المعزول'))).id;
  const items=Object.fromEntries(['body','lens','light','mic','stand'].map(key=>[key,tx(()=>createItem(db,users.manager,item(`قطعة ${key} المصطنعة`))).id]));
  const isoItem=tx(()=>createItem(db,users['iso-admin'],item('قطعة الكيان المعزول'))).id;
  const book=(input,who='manager')=>tx(()=>createBooking(db,users[who],{item_id:'',kit_id:'',project_id:'',production_ref:'',purpose:'تصوير مصطنع على الإنتاج',
    start_date:today(),end_date:addDays(today(),1),custodian_id:'employee',...input}));
  const booking=id=>equipmentBoard(db,users.manager).bookings.find(b=>b.id===id);
  return {db,users,tx,project,of,move,live,wrapped,closed,cancelled,iso,items,isoItem,book,booking};
}

/* ───── الترقية: قاعدة قبل 193 بحجوزات نصّها حر ───── */
function applyMigration(raw,version,sql){
  raw.exec('BEGIN');
  try{raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');}
  catch(error){raw.exec('ROLLBACK');throw error;}
}
const MIGRATION=readdirSync(new URL('../app/migrations/',import.meta.url)).find(name=>name.startsWith('193-'));

test('migration 193 upgrade: a booking whose free-text reference names exactly one production of its own tenant — by code in any letter case, or by exact title — is linked; an ambiguous, foreign, partial or empty reference stays NULL; no old column of any row moves, and closed bookings are linked too',t=>{
  assert.ok(MIGRATION,'migration 193 exists');
  const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()){
    const version=Number(file.slice(0,3));
    if(version<193)applyMigration(raw,version,readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8'));
  }
  assert.equal(raw.prepare("SELECT 1 FROM pragma_table_info('equipment_bookings') WHERE name='production_id'").get(),undefined,'before 193 the booking carries text only');
  seed(raw,PASSWORD);
  let users=people(raw);const tx=f=>transaction(raw,f);
  tx(()=>grantAccess(raw,users.admin,{user_id:'manager',capability:'production.manage',department_id:'',note:'اختبار ترقية مصطنع'}));
  users=Object.fromEntries(raw.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const project=tx(()=>createProject(raw,users.manager,{name:'مشروع ترقية مصطنع',brief:'حجوزات قبل 193',member_ids:['employee']})).id;
  const P=(codeValue,title)=>tx(()=>createProduction(raw,users.manager,production(project,codeValue,title))).id;
  const p1=P('SHOOT-01','إعلان رمضان المصطنع'),p2=P('SHOOT-02','تصوير المنتج المصطنع');
  P('SHOOT-03','تصوير المنتج المصطنع');P('CROSS-01','إنتاج أول مصطنع');P('CROSS-02','CROSS-01');
  const iso=tx(()=>createProduction(raw,users['iso-admin'],production('iso-project','ISO-01','إنتاج الكيان المعزول'))).id;
  const isoItem=tx(()=>createItem(raw,users['iso-admin'],item('قطعة الكيان المعزول'))).id;
  // الحجوزات كما كتبها الكود قبل 193: نص حر، وبكل الحالات. لكل حجز قطعته فلا يتقاطع حجزان.
  const insert=(id,ref,status='reserved',{tenant='36t',itemId=null,custodian='employee',booker='manager'}={})=>{
    const itemRef=itemId??tx(()=>createItem(raw,users.manager,item(`قطعة الحجز ${id}`))).id;
    raw.prepare(`INSERT INTO equipment_bookings(id,tenant_id,item_id,kit_id,group_id,project_id,production_ref,purpose,start_date,end_date,custodian_id,status,booked_by,cancel_note,version,created_at,updated_at)
      VALUES(?,?,?,NULL,?,NULL,?,'حجز مصطنع قبل الترحيل 193','2026-08-01','2026-08-03',?,?,?,?,3,?,?)`)
      .run(id,tenant,itemRef,id,ref,custodian,status,booker,status==='cancelled'?'ألغي قبل الترقية':'',STAMP,STAMP);
  };
  insert('b-code','SHOOT-01');insert('b-case','shoot-01','out');insert('b-space','  SHOOT-01  ');insert('b-title','إعلان رمضان المصطنع');
  insert('b-two-titles','تصوير المنتج المصطنع');insert('b-code-and-title','CROSS-01');insert('b-foreign','ISO-01');
  insert('b-partial','SHOOT-01 اليوم الثاني');insert('b-empty','');insert('b-free','تصوير خارجي بلا إنتاج مسجل');
  insert('b-returned','SHOOT-02','returned');insert('b-cancelled','SHOOT-02','cancelled');
  insert('b-iso','iso-01','reserved',{tenant:'isolated',itemId:isoItem,custodian:'external',booker:'iso-admin'});
  const oldColumns=raw.prepare('PRAGMA table_info(equipment_bookings)').all().map(c=>c.name);
  const snapshot=()=>raw.prepare(`SELECT ${oldColumns.join(',')} FROM equipment_bookings ORDER BY id`).all().map(r=>JSON.stringify(r));
  const before=snapshot(),versionedSql=raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='equipment_bookings_versioned'").get().sql;
  const auditBefore=raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;

  applyMigration(raw,193,readFileSync(new URL('../app/migrations/'+MIGRATION,import.meta.url),'utf8'));

  const linked=Object.fromEntries(raw.prepare('SELECT id,production_id FROM equipment_bookings ORDER BY id').all().map(r=>[r.id,r.production_id]));
  assert.deepEqual(linked,{'b-case':p1,'b-cancelled':p2,'b-code':p1,'b-code-and-title':null,'b-empty':null,'b-foreign':null,'b-free':null,
    'b-iso':iso,'b-partial':null,'b-returned':p2,'b-space':p1,'b-title':p1,'b-two-titles':null});
  const matched=Object.values(linked).filter(Boolean).length;
  assert.deepEqual([matched,Object.keys(linked).length-matched],[7,6],'seven linked, six left NULL with their text intact');
  assert.deepEqual(snapshot(),before,'not one old column of any booking moved — version and updated_at included');
  assert.equal(raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='equipment_bookings_versioned'").get().sql,versionedSql,'the version guard is back word for word');
  for(const name of ['equipment_bookings_production_tenant','equipment_bookings_production_live','equipment_bookings_production_fixed','productions_close_after_equipment'])
    assert.ok(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name),name);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,auditBefore,'the migration writes no audit event of its own');
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(verifyAudit(raw));
  // وبعد الترقية: الحجز المغلق نهائي كما كان، والمرتبط لا ينفك.
  assert.throws(()=>raw.prepare("UPDATE equipment_bookings SET purpose='تعديل صامت',version=version+1 WHERE id='b-returned'").run(),/closed booking is final/);
  assert.throws(()=>raw.prepare("UPDATE equipment_bookings SET production_id=NULL,version=version+1 WHERE id='b-code'").run(),/keeps the production it was made for/);
});

test('booking against a production: the booking carries the production of its own tenant, another tenant\'s production is a 404, and a wrapped, closed or cancelled production takes no new booking — in the code and in SQL',t=>{
  const {db,users,tx,live,wrapped,closed,cancelled,iso,items,isoItem,book,booking}=fixture(t);
  const first=book({item_id:items.body,production_id:live,production_ref:'يوم التصوير الأول'});
  const row=booking(first.id);
  assert.equal(row.production_id,live);assert.equal(row.production_code,'SHOOT-01');assert.equal(row.production_title,'إعلان رمضان المصطنع');
  assert.equal(row.production_ref,'يوم التصوير الأول','the free text stays as written');
  for(const foreign of [iso,randomUUID(),'not-an-id']){
    const error=(()=>{try{book({item_id:items.lens,production_id:foreign});}catch(e){return e;}})();
    assert.equal(error?.status,404);assert.equal(error.code,'not_found');
    assert.equal(error.message.includes('ISO-01')||error.message.includes('إنتاج الكيان المعزول'),false,'the refusal says nothing about the other tenant');
  }
  for(const [id,name] of [[wrapped,'SHOOT-02'],[closed,'SHOOT-03'],[cancelled,'SHOOT-04']]){
    const error=(()=>{try{book({item_id:items.lens,production_id:id});}catch(e){return e;}})();
    assert.equal(error?.status,409);assert.equal(error.code,'production_not_live');
    assert.ok(error.message.includes(name),'the refusal names the production');
    assert.ok(error.details.refusal.next,'and says what to do next');
  }
  // نص المرجع: إن طابق إنتاجًا واحدًا بالضبط فهو ذلك الإنتاج — القاعدة نفسها التي ربط بها الترحيل القديم.
  const byCode=book({item_id:items.lens,production_ref:'shoot-01'});
  assert.equal(booking(byCode.id).production_id,live);
  assert.throws(()=>book({item_id:items.light,production_ref:'SHOOT-02'}),code('production_not_live'),'a reference naming a wrapped production is refused the same way');
  const free=book({item_id:items.light,production_ref:'تصوير خارجي بلا إنتاج مسجل'});
  assert.equal(booking(free.id).production_id,null,'free text that names no production stays a note');
  const foreignRef=book({item_id:items.body,production_ref:'ISO-01',start_date:addDays(today(),5),end_date:addDays(today(),6)});
  assert.equal(booking(foreignRef.id).production_id,null,'a reference naming another tenant\'s production code links nothing across the tenant');
  // الطقم يُحجز ككتلة على الإنتاج نفسه.
  const kit=tx(()=>createKit(db,users.manager,{name:'طقم الإنتاج المصطنع',notes:''})).id;
  const kitVersion=()=>equipmentBoard(db,users.manager).kits.find(k=>k.id===kit).version;
  for(const key of ['mic','stand'])tx(()=>kitAction(db,users.manager,kit,'add_item',{version:kitVersion(),item_id:items[key]}));
  const kitted=book({kit_id:kit,production_id:live});
  assert.equal(kitted.bookings.length,2);assert.ok(kitted.bookings.every(id=>booking(id).production_id===live));

  // القيد في القاعدة لا في الكود وحده: إدراج مباشر يتجاوز الوحدة يُرفض، والربط لا يتبدّل بعد الحجز.
  const raw=(id,productionId,tenant='36t',itemId=items.body,custodian='employee',booker='manager')=>db.prepare(`INSERT INTO equipment_bookings(id,tenant_id,item_id,group_id,production_id,purpose,start_date,end_date,custodian_id,status,booked_by,created_at,updated_at)
    VALUES(?,?,?,?,?,'إدراج مباشر يتجاوز الوحدة',?,?,?,'reserved',?,?,?)`).run(id,tenant,itemId,id,productionId,addDays(today(),40),addDays(today(),41),custodian,booker,STAMP,STAMP);
  assert.throws(()=>raw('raw-foreign',iso),/only to a production of its own tenant/);
  assert.throws(()=>raw('raw-iso',live,'isolated',isoItem,'external','iso-admin'),/only to a production of its own tenant/);
  for(const id of [wrapped,closed,cancelled])assert.throws(()=>raw('raw-'+id,id),/only against a production still in planning or shooting/);
  for(const next of [null,wrapped])assert.throws(()=>db.prepare('UPDATE equipment_bookings SET production_id=?,version=version+1 WHERE id=?').run(next,first.id),/keeps the production it was made for/);
  assert.throws(()=>db.prepare('UPDATE equipment_bookings SET production_id=?,version=version+1 WHERE id=?').run(live,free.id),/keeps the production it was made for/);

  // قائمة الإنتاجات في لوحة المعدات: الحية من كيانك وحده.
  assert.deepEqual(equipmentBoard(db,users.manager).productions.map(p=>p.code),['SHOOT-01']);
  assert.deepEqual(equipmentBoard(db,users['iso-admin']).productions.map(p=>p.code),['ISO-01']);
  assert.deepEqual(equipmentBoard(db,users.employee).productions,[],'an account without the store capability gets no list');
  assert.equal(equipmentBoard(db,users['iso-admin']).bookings.some(b=>b.production_id===live),false);
  assert.ok(verifyAudit(db));
});

test('a booking on a production inherits the production\'s project when none is named, so project closure sees that equipment; a different named project is refused by name',t=>{
  const {db,users,tx,project,live,items,book,booking}=fixture(t);
  const inherited=book({item_id:items.mic,production_id:live});
  assert.equal(booking(inherited.id).project_id,project,'the booking carries the production\'s project');
  const other=tx(()=>createProject(db,users.manager,{name:'مشروع ثانٍ مصطنع',brief:'مشروع لا يملك الإنتاج',member_ids:['employee']})).id;
  const error=(()=>{try{book({item_id:items.stand,production_id:live,project_id:other});}catch(e){return e;}})();
  assert.deepEqual([error?.status,error?.code],[409,'production_project_mismatch']);
  assert.ok(error.message.includes('SHOOT-01'),'the refusal names the production');
  assert.equal(booking(book({item_id:items.stand,production_id:live,project_id:project}).id).project_id,project,'the same project named explicitly is accepted');
});

test('closing a production while its equipment is out or still reserved is refused by name — each item and who holds it — and goes through once the gear is back',t=>{
  const {db,users,tx,of,move,live,items,book,booking}=fixture(t);
  move(live,'start');
  const out=book({item_id:items.body,production_id:live,start_date:addDays(today(),-1),end_date:today()}).id;
  tx(()=>bookingAction(db,users.employee,out,'hand_out',{version:booking(out).version,counterpart_id:'manager',condition_state:'good',condition_note:'سليمة ومعها بطاريتان',acknowledgement:'أقر باستلام القطعة ومسؤوليتي عنها حتى إعادتها'}));
  const reserved=book({item_id:items.lens,production_id:live,custodian_id:'outsider',start_date:addDays(today(),2),end_date:addDays(today(),3)}).id;
  move(live,'wrap',{wrap_note:'انتهى التصوير وبقيت لقطات تكميلية محتملة'});
  const view=of(live);
  assert.deepEqual(view.equipment.map(e=>[e.item_code,e.status,e.custodian_name]),
    [[booking(out).item_code,'out',users.employee.name],[booking(reserved).item_code,'reserved',users.outsider.name]],'the production shows what is still out on it');
  assert.equal(view.counts.equipment_out,2);

  const error=(()=>{try{move(live,'close',{note:'المخرجات سُلّمت والتصاريح موثقة'});}catch(e){return e;}})();
  assert.equal(error?.status,409);assert.equal(error.code,'equipment_still_out');
  const refusal=error.details.refusal;
  assert.deepEqual(refusal.missing.map(m=>m.owner),[users.employee.name,users.outsider.name],'each item names who holds it');
  for(const [id,who] of [[out,'employee'],[reserved,'outsider']]){
    const b=booking(id);
    assert.ok(error.message.includes(b.item_code)&&error.message.includes(b.item_name),`the refusal names ${b.item_code}`);
    assert.ok(error.message.includes(users[who].name));
  }
  assert.ok(refusal.next);
  assert.equal(of(live).status,'wrapped','nothing was written');
  // حارس الكتابة المباشرة في القاعدة.
  assert.throws(()=>db.prepare("UPDATE productions SET status='closed',closed_by='hr',closed_at=?,version=version+1 WHERE id=?").run(STAMP,live),/closed only after its booked equipment is back/);

  tx(()=>bookingAction(db,users.manager,out,'hand_in',{version:booking(out).version,counterpart_id:'employee',condition_state:'good',condition_note:'رجعت سليمة كما سُلّمت',acknowledgement:'أقر باستلامها في المخزن بحالتها الموصوفة'}));
  assert.deepEqual(of(live).equipment.map(e=>e.status),['reserved'],'the returned item leaves the list');
  assert.throws(()=>move(live,'close',{note:'المخرجات سُلّمت والتصاريح موثقة'}),code('equipment_still_out'),'a reservation still pending blocks the close too');
  tx(()=>bookingAction(db,users.manager,reserved,'cancel',{version:booking(reserved).version,note:'اللقطات التكميلية ألغيت'}));
  move(live,'close',{note:'المخرجات سُلّمت والتصاريح موثقة والمعدات رجعت'});
  assert.equal(of(live).status,'closed');assert.deepEqual(of(live).equipment,[]);
  assert.throws(()=>book({item_id:items.light,production_id:live}),code('production_not_live'),'a closed production takes no new booking');
  // كيان آخر لا يصل الإنتاج أصلًا.
  assert.throws(()=>tx(()=>productionAction(db,users['iso-admin'],live,'close',{version:1,note:'محاولة من كيان آخر'})),code('not_found'));
  assert.equal(productionsBoard(db,users['iso-admin']).productions.some(p=>p.id===live),false);
  assert.ok(verifyAudit(db));
});
