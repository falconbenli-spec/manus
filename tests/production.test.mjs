import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { productionsUI, callSheetsUI } from '../app/static/production-ui.mjs';
import { operationFields, money } from '../app/static/operations.mjs';
import {
  createProduction, productionAction, productionsBoard,
  addCrew, crewAction, addTalent, talentAction, addLocation, locationAction,
  saveSchedule, addShot, shotAction,
  createCallSheet, callSheetAction, respondToCallSheet, callSheetsBoard, getCallSheet, callSheetPrintable
} from '../app/production.mjs';
import { getRoute, reviewAction } from '../app/review-rounds.mjs';
import { approvedVersion, reviewRoute } from './studio-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';

const code=value=>error=>error.code===value;
const caught=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);

// الإنتاج الجاهز للتصوير (PRO-01 وP4-SPEC-2): يصوّر معالجة وافق عليها مسار مراجعة، ولمشروعه مخصص معتمد يغطي المدة.
// ready:false يترك الإنتاج بلا معالجة مربوطة والمشروع بلا مخصص، ليُختبر الرفض.
function fixture(t,{ready=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-production');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  // المنتج ومُصدِر أوراق الاستدعاء يحملان تصريح الإنتاج؛ الموظفة تظهر في الطاقم بلا أي تصريح.
  for(const who of ['manager','hr'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'production.manage',department_id:'',note:'اختبار مصطنع'}));
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تصوير تجريبي',brief:'موجز مصطنع لاختبار وحدة الإنتاج',member_ids:['employee','outsider']}));
  const treatment=approvedVersion(db,users,{project:project.id,title:'معالجة إعلان تجريبي'}),route=reviewRoute(db,users,{version:treatment.version});
  if(ready)fundProject(db,project.id,'PRD-CC');
  const time=now();
  db.prepare("INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,entity_type,country,categories,data_source,status,registered_by,created_at,updated_at) VALUES('v-crew','36t','V-9001','FREELANCE-DOP','مصور مستقل تجريبي','individual','SA','[\"photo_video\"]','تسجيل مصطنع','approved','manager',?,?)").run(time,time);
  const production=tx(()=>createProduction(db,users.manager,{code:'prod-01',title:'إعلان تجريبي',kind:'ad',brief:'موجز مصطنع',client_id:'',campaign_id:'',project_id:project.id,review_route_id:ready?route:'',shoot_from:day(3),shoot_to:day(6)})).id;
  const of=id=>productionsBoard(db,users.manager).productions.find(p=>p.id===id);
  return {db,users,tx,project,production,of,treatment,route};
}
function fullSite(db,users,tx,production){
  const location=tx(()=>addLocation(db,users.manager,production,{name:'استوديو تجريبي',address_note:'عنوان وصفي مصطنع',map_link:'',contact_name:'جهة اتصال',contact_phone:'0500000000',
    permit_required:false,permit_basis:'',permit_status:'not_required',permit_number:'',permit_issuer:'',permit_expires_on:'',permit_storage:''})).id;
  const crew=tx(()=>addCrew(db,users.manager,production,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:''})).id;
  const talent=tx(()=>addTalent(db,users.manager,production,{full_name:'ممثل تجريبي',talent_kind:'actor',agency_vendor_id:'',contact_note:'',
    release_status:'not_signed',release_signed_on:'',release_valid_until:'',release_scope:'',release_media:'',release_storage:'',release_note:''})).id;
  return {location,crew,talent};
}
const sheetBody=(location,over={})=>({location_id:location,map_link:'خريطة يدخلها المنتج',
  call_time:'06:30',wrap_time:'18:00',day_schedule:[{time:'06:30',activity:'تجمع الطاقم',note:''},{time:'08:00',activity:'المشهد الأول',note:'ضوء الصباح'}],
  safety_notes:'كابلات مثبتة ومخرج طوارئ مفتوح',weather_note:'صحو بحسب ما اطلع عليه المنتج',nearest_hospital:'مستشفى تجريبي',hospital_address:'عنوان مصطنع',
  emergency_contact_name:'منسق السلامة التجريبي',emergency_contact_phone:'0555000111',...over});
const sheetInput=(production,location,crew,talent)=>({production_id:production,shoot_date:day(3),...sheetBody(location),
  invitees:[{party:`crew:${crew}`,call_time:'06:30'},{party:`talent:${talent}`,call_time:'08:00'}]});

test('production crew: the external freelancer is a vendor with a day rate, the internal employee is a user whose pay never appears here',t=>{
  const {db,users,tx,production,of}=fixture(t);
  assert.throws(()=>tx(()=>addCrew(db,users.manager,production,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'900.00',days:2,engagement_note:''})),code('internal_rate'));
  assert.throws(()=>tx(()=>addCrew(db,users.manager,production,{role_key:'sound',role_note:'',source:'external',user_id:'',vendor_id:'not-a-vendor',day_rate:'900.00',days:2,engagement_note:''})),code('vendor_id'));
  tx(()=>addCrew(db,users.manager,production,{role_key:'photographer',role_note:'مصور رئيسي',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:''}));
  tx(()=>addCrew(db,users.manager,production,{role_key:'sound',role_note:'',source:'external',user_id:'',vendor_id:'v-crew',day_rate:'1250.50',days:2,engagement_note:'يُصرف عبر دورة المدفوعات'}));
  const crew=of(production).crew;
  assert.equal(crew.find(c=>c.source==='internal').day_rate_minor,null,'no cost is carried for an internal employee');
  assert.equal(crew.find(c=>c.source==='external').day_rate_minor,125050);
  assert.equal(db.prepare("SELECT day_rate_minor FROM production_crew WHERE source='internal'").get().day_rate_minor,null,'nothing is stored either');
  assert.throws(()=>db.prepare("UPDATE production_crew SET day_rate_minor=50000,version=version+1 WHERE source='internal'").run(),/CHECK|constraint/i,'the schema refuses an internal pay figure');
  assert.throws(()=>tx(()=>addCrew(db,users.manager,production,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:''})),code('duplicate_crew'));
  assert.ok(verifyAudit(db));
});

test('talent release and location permit: a recorded fact and a producer decision, never a signature nor an assumed legal requirement',t=>{
  const {db,users,tx,production,of}=fixture(t);
  const release=(over={})=>({full_name:'عارضة تجريبية',talent_kind:'model',agency_vendor_id:'',contact_note:'',
    release_status:'signed',release_signed_on:day(-1),release_valid_until:day(365),release_scope:'إنستغرام والسعودية لسنة',release_media:'صور وفيديو',release_storage:'ملف الإنتاج الورقي رقم 12',release_note:'',...over});
  assert.throws(()=>tx(()=>addTalent(db,users.manager,production,release({release_storage:''}))),code('invalid_text'),'a signed release without a place for the original is refused');
  assert.throws(()=>tx(()=>addTalent(db,users.manager,production,release({release_signed_on:day(2)}))),code('release_signed_on'));
  const talent=tx(()=>addTalent(db,users.manager,production,release({release_status:'not_signed',release_signed_on:'',release_valid_until:'',release_scope:'',release_storage:''}))).id;
  assert.equal(of(production).talent[0].release_status,'not_signed');
  const version=of(production).talent[0].version;
  tx(()=>talentAction(db,users.manager,talent,'release',{version,release_status:'signed',release_signed_on:day(-1),release_valid_until:day(200),release_scope:'إنستغرام والسعودية',release_media:'صور',release_storage:'مجلد العقود المصطنع',release_note:''}));
  assert.equal(of(production).talent[0].release_status,'signed');

  const permit=(over={})=>({name:'شارع تجريبي',address_note:'',map_link:'',contact_name:'',contact_phone:'',
    permit_required:true,permit_basis:'قرر المنتج أن الموقع عام ويحتاج إذنًا من مالكه',permit_status:'pending',permit_number:'',permit_issuer:'',permit_expires_on:'',permit_storage:'',...over});
  assert.throws(()=>tx(()=>addLocation(db,users.manager,production,permit({permit_required:false}))),code('permit_status'),'a location the producer says needs no permit carries no permit state');
  assert.throws(()=>tx(()=>addLocation(db,users.manager,production,permit({permit_basis:''}))),code('invalid_text'),'the producer says why, the platform assumes nothing');
  assert.throws(()=>tx(()=>addLocation(db,users.manager,production,permit({permit_status:'obtained'}))),code('invalid_text'),'an obtained permit carries its number, issuer, expiry and where the original is');
  const location=tx(()=>addLocation(db,users.manager,production,permit())).id;
  assert.equal(of(production).locations[0].permit_status,'pending');
  const lv=of(production).locations[0].version;
  tx(()=>locationAction(db,users.manager,location,'permit',{version:lv,permit_required:true,permit_basis:'إذن مالك الموقع',permit_status:'obtained',permit_number:'P-77',permit_issuer:'مالك الموقع التجريبي',permit_expires_on:day(30),permit_storage:'ملف الإنتاج'}));
  assert.equal(of(production).locations[0].permit_status,'obtained');
  assert.ok(verifyAudit(db));
});

test('call sheet: the producer never issues their own sheet, and an issued sheet is replaced by a revision that states what changed',t=>{
  const {db,users,tx,production,of}=fixture(t);
  const {location,crew,talent}=fullSite(db,users,tx,production);
  const sheet=tx(()=>createCallSheet(db,users.manager,sheetInput(production,location,crew,talent))).id;
  const at=id=>getCallSheet(db,users.manager,id);
  assert.equal(at(sheet).status,'draft');
  assert.ok(!at(sheet).actions.includes('issue_sheet'),'the preparer is not offered the issue action');
  assert.throws(()=>tx(()=>callSheetAction(db,users.manager,sheet,'issue',{version:at(sheet).version,note:'أصدرها بنفسي رغم أنني أعددتها'})),code('invalid_state'));
  assert.throws(()=>tx(()=>callSheetAction(db,users.outsider,sheet,'issue',{version:at(sheet).version,note:'لا أحمل تصريح الإنتاج إطلاقًا'})),code('not_found'));
  tx(()=>callSheetAction(db,users.hr,sheet,'issue',{version:at(sheet).version,note:'راجعت الجدول وبيانات الطوارئ والسلامة'}));
  assert.equal(at(sheet).status,'issued');
  assert.equal(at(sheet).issued_by_name,users.hr.name);

  assert.throws(()=>db.prepare("UPDATE call_sheets SET call_time='09:00',version=version+1 WHERE id=?").run(sheet),/never edited/);
  assert.throws(()=>tx(()=>callSheetAction(db,users.manager,sheet,'edit',{version:at(sheet).version,...sheetBody(location),change_summary:'تعديل صامت'})),code('invalid_state'));
  assert.throws(()=>tx(()=>createCallSheet(db,users.manager,sheetInput(production,location,crew,talent))),code('issued_exists'));

  const invitee=at(sheet).invitees.find(i=>i.user_id==='employee');
  tx(()=>respondToCallSheet(db,users.employee,invitee.id,{version:invitee.version,state:'confirmed',note:'سأحضر'}));
  assert.equal(at(sheet).invitees.find(i=>i.id===invitee.id).state,'confirmed');

  const next=tx(()=>callSheetAction(db,users.manager,sheet,'revise',{version:at(sheet).version,change_summary:'تأخر وقت التجمع ساعة وتغير المشهد الأول'})).id;
  assert.equal(at(next).revision,2);
  assert.equal(at(next).status,'draft');
  assert.equal(at(sheet).status,'issued','the live sheet stays live until the revision is issued');
  assert.deepEqual([...new Set(at(next).invitees.map(i=>i.state))],['sent'],'everyone is called again on a new revision');
  const v2=at(next).version;
  tx(()=>callSheetAction(db,users.manager,next,'edit',{version:v2,...sheetBody(location,{call_time:'07:30'}),change_summary:'تأخر وقت التجمع ساعة وتغير المشهد الأول'}));
  tx(()=>callSheetAction(db,users.hr,next,'issue',{version:at(next).version,note:'راجعت النسخة الثانية وبيان ما تغير فيها'}));
  assert.equal(at(sheet).status,'superseded');
  assert.equal(at(next).status,'issued');
  assert.equal(at(next).call_time,'07:30');
  assert.match(callSheetPrintable(at(next)),/ورقة استدعاء/);
  assert.match(callSheetPrintable(at(next)),/تأخر وقت التجمع ساعة/,'the printed revision says what changed');
  assert.ok(!callSheetPrintable(at(next)).includes('<script'));
  assert.ok(verifyAudit(db));
});

test('call sheet delivery: the platform notifies only people who hold an account, and it never claims to have reached anyone else',t=>{
  const {db,users,tx,production}=fixture(t);
  const {location,crew,talent}=fullSite(db,users,tx,production);
  const sheet=tx(()=>createCallSheet(db,users.manager,sheetInput(production,location,crew,talent))).id;
  tx(()=>callSheetAction(db,users.hr,sheet,'issue',{version:getCallSheet(db,users.manager,sheet).version,note:'راجعت الجدول وبيانات الطوارئ والسلامة'}));
  const lines=getCallSheet(db,users.manager,sheet).invitees;
  assert.equal(lines.find(i=>i.party_kind==='crew').delivery,'in_platform');
  assert.equal(lines.find(i=>i.party_kind==='talent').delivery,'outside_platform');

  // للموظفة لا تصريح إنتاج: لا ترى لوحة الإنتاج، وترى استدعاءها وتؤكده بنفسها.
  assert.throws(()=>productionsBoard(db,users.employee),code('not_permitted'));
  const mine=callSheetsBoard(db,users.employee).my_invitations;
  assert.equal(mine.length,1);
  assert.deepEqual(mine[0].actions,['mark_viewed','confirm','decline']);
  assert.match(callSheetsBoard(db,users.employee).note,/لا رابط مشاركة عام/,'the screen says out loud what it cannot do');
  tx(()=>respondToCallSheet(db,users.employee,mine[0].invitee_id,{version:mine[0].version,state:'confirmed',note:''}));
  assert.equal(callSheetsBoard(db,users.employee).my_invitations[0].state,'confirmed');

  const employeeLine=getCallSheet(db,users.manager,sheet).invitees.find(i=>i.user_id==='employee');
  assert.throws(()=>tx(()=>respondToCallSheet(db,users.outsider,employeeLine.id,{version:employeeLine.version,state:'declined',note:'لست أنا'})),code('not_your_invitation'));
  assert.throws(()=>tx(()=>respondToCallSheet(db,users.manager,employeeLine.id,{version:employeeLine.version,state:'declined',note:'أسجل نيابة عن صاحبة حساب'})),code('not_your_invitation'));

  const talentLine=getCallSheet(db,users.manager,sheet).invitees.find(i=>i.party_kind==='talent');
  assert.throws(()=>tx(()=>respondToCallSheet(db,users.manager,talentLine.id,{version:talentLine.version,state:'confirmed',note:''})),code('invalid_text'),'a response recorded for someone outside the platform says how it arrived');
  assert.throws(()=>tx(()=>respondToCallSheet(db,users.manager,talentLine.id,{version:talentLine.version,state:'viewed',note:'اتصال هاتفي اليوم'})),code('state'));
  tx(()=>respondToCallSheet(db,users.manager,talentLine.id,{version:talentLine.version,state:'confirmed',note:'اتصال هاتفي اليوم الساعة العاشرة'}));
  const recorded=getCallSheet(db,users.manager,sheet).invitees.find(i=>i.id===talentLine.id);
  assert.equal(recorded.response_source,'recorded_outside');
  assert.match(getCallSheet(db,users.manager,sheet).invitees.find(i=>i.party_kind==='talent').delivery_note,/لا رابط مشاركة عام/);
  assert.ok(verifyAudit(db));
});

test('production lifecycle: the producer does not close their own production, a closed one is frozen, and stale versions and other tenants are refused',t=>{
  const {db,users,tx,production,of}=fixture(t);
  const {location,crew,talent}=fullSite(db,users,tx,production);
  assert.throws(()=>tx(()=>productionAction(db,users.manager,production,'edit',{version:99,title:'اسم آخر',kind:'ad',brief:'',client_id:'',campaign_id:'',project_id:of(production).project_id,shoot_from:day(3),shoot_to:day(6)})),code('stale_version'));
  assert.throws(()=>productionsBoard(db,users.external),code('not_permitted'));
  assert.throws(()=>tx(()=>productionAction(db,users.external,production,'start',{version:1})),code('not_permitted'));

  const draft=tx(()=>createCallSheet(db,users.manager,sheetInput(production,location,crew,talent))).id;
  tx(()=>productionAction(db,users.manager,production,'start',{version:of(production).version}));
  tx(()=>productionAction(db,users.manager,production,'wrap',{version:of(production).version,wrap_note:'انتهى التصوير وسُلّمت المواد الخام للمونتاج'}));
  assert.ok(!productionsBoard(db,users.hr).productions.find(p=>p.id===production).actions.includes('accept_close'),'an unsettled draft call sheet blocks the close');
  tx(()=>callSheetAction(db,users.manager,draft,'cancel',{version:getCallSheet(db,users.manager,draft).version,note:'ألغي يوم التصوير'}));
  assert.ok(!of(production).actions.includes('accept_close'),'the producer is never offered the close of their own production');
  assert.throws(()=>tx(()=>productionAction(db,users.manager,production,'close',{version:of(production).version,note:'أقفل إنتاجي بنفسي'})),code('invalid_state'));
  tx(()=>productionAction(db,users.hr,production,'close',{version:of(production).version,note:'المخرجات سُلّمت والتصاريح موثقة'}));
  assert.equal(of(production).status,'closed');
  assert.equal(of(production).closed_by_name,users.hr.name);
  assert.throws(()=>db.prepare("UPDATE productions SET title='تعديل صامت',version=version+1 WHERE id=?").run(production),/final/);
  assert.throws(()=>tx(()=>addCrew(db,users.manager,production,{role_key:'editor',role_note:'',source:'internal',user_id:'outsider',vendor_id:'',day_rate:'',days:'',engagement_note:''})),code('invalid_state'));
  assert.ok(verifyAudit(db));
});

test('shoot schedule and shot list: the day keeps the order it was saved in, and a shot that changed state says why',t=>{
  const {db,users,tx,production,of}=fixture(t);
  const {location}=fullSite(db,users,tx,production);
  tx(()=>saveSchedule(db,users.manager,production,{shoot_date:day(3),rows:[
    {id:'',scene_ref:'1',title:'المشهد الأول',note:'',location_id:location,start_time:'08:00',estimated_minutes:90},
    {id:'',scene_ref:'2',title:'المشهد الثاني',note:'',location_id:location,start_time:'10:00',estimated_minutes:60}]}));
  const first=of(production).schedule_days[0].rows;
  assert.deepEqual(first.map(r=>r.title),['المشهد الأول','المشهد الثاني']);
  assert.deepEqual(first.map(r=>r.sort_order),[0,1]);
  assert.throws(()=>tx(()=>saveSchedule(db,users.manager,production,{shoot_date:day(30),rows:[{id:'',scene_ref:'',title:'خارج المدة',note:'',location_id:'',start_time:'',estimated_minutes:''}]})),code('shoot_date'));
  tx(()=>saveSchedule(db,users.manager,production,{shoot_date:day(3),rows:[
    {id:first[1].id,scene_ref:'2',title:'المشهد الثاني',note:'',location_id:location,start_time:'08:00',estimated_minutes:60},
    {id:first[0].id,scene_ref:'1',title:'المشهد الأول',note:'',location_id:location,start_time:'10:00',estimated_minutes:90}]}));
  assert.deepEqual(of(production).schedule_days[0].rows.map(r=>r.title),['المشهد الثاني','المشهد الأول'],'the stored order follows the order that was saved');

  const scene=of(production).schedule_days[0].rows[0].id;
  const shot=tx(()=>addShot(db,users.manager,production,{scene_id:scene,code:'1A',description:'لقطة افتتاحية للمكان',shot_size:'wide',camera_angle:'eye_level',reference_note:'مرجع بصري محفوظ في مجلد الإنتاج'})).id;
  assert.equal(of(production).shots[0].status,'planned');
  const sv=of(production).shots[0].version;
  assert.throws(()=>tx(()=>shotAction(db,users.manager,shot,'status',{version:sv,status:'reshoot',note:''})),code('invalid_text'));
  tx(()=>shotAction(db,users.manager,shot,'status',{version:sv,status:'reshoot',note:'خلل في التركيز'}));
  assert.equal(of(production).shots[0].status_name,'أُعيدت');
  assert.ok(verifyAudit(db));
});

const linkInput=(extra={})=>({title:'تصوير المعالجة التجريبية',kind:'ad',brief:'',client_id:'',campaign_id:'',project_id:'',shoot_from:day(3),shoot_to:day(6),...extra});

test('P4-SPEC-2 production on its treatment: the production links the review route of what it shoots, reads that output version and the studio job’s project, and a link that does not match, is hidden or was turned down is refused by name',t=>{
  const {db,users,tx,project,treatment,route,of}=fixture(t);
  const linked=tx(()=>createProduction(db,users.manager,{code:'PRD-LINK',...linkInput({review_route_id:route})})).id;
  assert.deepEqual({...db.prepare('SELECT review_route_id,output_version_id,project_id FROM productions WHERE id=?').get(linked)},
    {review_route_id:route,output_version_id:treatment.version,project_id:project.id},'the version and the project are read from the route and its studio job, never typed');
  const view=of(linked).treatment;
  assert.deepEqual([view.route_id,view.output_version_id,view.revision,view.digest,view.status,view.output_title],[route,treatment.version,treatment.revision,treatment.digest,'approved','معالجة إعلان تجريبي']);

  const other=tx(()=>createProject(db,users.manager,{name:'مشروع آخر تجريبي',brief:'مشروع لا يخص المعالجة',member_ids:['employee']})).id;
  const mismatch=caught(()=>tx(()=>createProduction(db,users.manager,{code:'PRD-MIS',...linkInput({project_id:other,review_route_id:route})})));
  assert.equal(mismatch.code,'treatment_mismatch');
  assert.match(mismatch.message,/المشروع/,'the refusal names the field that does not match');
  // hr يحمل تصريح الإنتاج وليس عضوًا في مشروع المعالجة: لا يرى مسارها، والرفض لا يسمّيها.
  const hidden=caught(()=>tx(()=>createProduction(db,users.hr,{code:'PRD-HID',...linkInput({project_id:project.id,review_route_id:route})})));
  assert.equal(hidden.status,404);
  assert.equal(hidden.message.includes('معالجة إعلان تجريبي'),false);
  const turnedDown=reviewRoute(db,users,{version:approvedVersion(db,users,{project:project.id,title:'معالجة طُلب تعديلها'}).version,decision:'changes_required'});
  assert.equal(caught(()=>tx(()=>createProduction(db,users.manager,{code:'PRD-REJ',...linkInput({review_route_id:turnedDown})}))).code,'treatment_rejected');

  // الربط يتغير في التحضير وحده؛ بعد بدء التصوير ثابت في الكود وفي القاعدة.
  tx(()=>productionAction(db,users.manager,linked,'start',{version:of(linked).version}));
  const second=reviewRoute(db,users,{version:approvedVersion(db,users,{project:project.id,title:'معالجة ثانية'}).version});
  const p=of(linked);
  assert.equal(caught(()=>tx(()=>productionAction(db,users.manager,linked,'edit',{version:p.version,...linkInput({project_id:project.id,review_route_id:second})}))).code,'treatment_locked');
  assert.throws(()=>db.prepare('UPDATE productions SET review_route_id=?,output_version_id=(SELECT output_version_id FROM review_routes WHERE id=?),version=version+1 WHERE id=?').run(second,second,linked),/only while it is still in planning/);
  tx(()=>productionAction(db,users.manager,linked,'edit',{version:p.version,...linkInput({project_id:project.id,title:'تصوير المعالجة بعنوان أوضح'})}));
  assert.equal(of(linked).review_route_id,route,'an edit that does not name the treatment keeps it');
  assert.ok(verifyAudit(db));
});

test('PRO-01 shoot readiness: the shoot does not start before its treatment is approved and an approved project allocation covers the shoot dates — the refusal names each missing approval and who owns it, and SQL refuses it too',t=>{
  const {db,users,tx,project,production,of}=fixture(t,{ready:false});
  const start=()=>tx(()=>productionAction(db,users.manager,production,'start',{version:of(production).version}));
  assert.equal(of(production).actions.includes('start_production'),false,'start is not offered before the shoot is ready');
  assert.deepEqual(of(production).readiness.missing.map(m=>m.doc_key),['treatment','budget']);
  let refused=caught(start);
  assert.equal(refused.code,'shoot_not_ready');
  assert.deepEqual(refused.details.refusal.missing.map(m=>m.doc_key),['treatment','budget']);
  assert.ok(refused.details.refusal.missing.every(m=>m.owner&&m.why),'each missing approval says why and who owns it');
  assert.ok(refused.details.refusal.next);

  const running=reviewRoute(db,users,{version:approvedVersion(db,users,{project:project.id,title:'معالجة قيد المراجعة'}).version,decision:null});
  tx(()=>productionAction(db,users.manager,production,'edit',{version:of(production).version,...linkInput({project_id:project.id,title:'إعلان تجريبي',review_route_id:running})}));
  refused=caught(start);
  assert.match(refused.details.refusal.missing.find(m=>m.doc_key==='treatment').why,/جارٍ/,'a review still running is not an approved treatment');
  const pending=getRoute(db,users.manager,running);
  tx(()=>reviewAction(db,users.manager,running,'decide',{version:pending.version,stage_id:pending.stages[0].id,decision:'approved',note:'المعالجة مراجعة وموافق عليها'}));
  refused=caught(start);
  assert.deepEqual(refused.details.refusal.missing.map(m=>m.doc_key),['budget'],'with the treatment approved, the allocation is what remains');
  assert.throws(()=>db.prepare("UPDATE productions SET status='in_production',version=version+1 WHERE id=?").run(production),/approved treatment and an approved project budget/);

  fundProject(db,project.id,'PRD-CC');
  assert.ok(of(production).actions.includes('start_production'));
  assert.equal(of(production).readiness.ready,true);
  start();
  assert.equal(of(production).status,'in_production');
  const started=db.prepare("SELECT after_json FROM audit_events WHERE entity_type='production' AND action='production.start'").get();
  assert.equal(JSON.parse(started.after_json).review_route_id,running,'the start records the treatment it stood on');
  assert.ok(verifyAudit(db));
});

test('PRO-03 call sheet issue: a sheet is not issued while its location’s required permit is pending or lapses before the shoot day — the refusal names the location and its permit, and SQL refuses it too',t=>{
  const {db,users,tx,production,of}=fixture(t);
  const permitInput=(over={})=>({permit_required:true,permit_basis:'قرر المنتج أن الموقع عام ويحتاج إذنًا من مالكه',permit_status:'pending',permit_number:'',permit_issuer:'',permit_expires_on:'',permit_storage:'',...over});
  const location=tx(()=>addLocation(db,users.manager,production,{name:'شارع تجريبي',address_note:'',map_link:'',contact_name:'',contact_phone:'',...permitInput()})).id;
  const crew=tx(()=>addCrew(db,users.manager,production,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:''})).id;
  const sheet=tx(()=>createCallSheet(db,users.manager,{production_id:production,shoot_date:day(3),...sheetBody(location),invitees:[{party:`crew:${crew}`,call_time:'06:30'}]})).id;
  const at=()=>getCallSheet(db,users.hr,sheet),issue=()=>tx(()=>callSheetAction(db,users.hr,sheet,'issue',{version:at().version,note:'راجعت الجدول وبيانات الطوارئ والسلامة'}));
  assert.equal(at().actions.includes('issue_sheet'),false,'the issuer is not offered a sheet whose permit is still pending');
  assert.deepEqual(at().readiness.missing.map(m=>m.doc_key),['permit']);
  let refused=caught(issue);
  assert.equal(refused.code,'call_sheet_not_ready');
  assert.match(refused.message,/شارع تجريبي/);
  assert.match(refused.details.refusal.missing[0].why,/قيد الطلب/);
  assert.throws(()=>db.prepare("UPDATE call_sheets SET status='issued',issued_by='hr',issued_at=?,version=version+1 WHERE id=?").run(now(),sheet),/required permit is obtained/);

  const permit=over=>tx(()=>locationAction(db,users.manager,location,'permit',{version:of(production).locations.find(l=>l.id===location).version,
    ...permitInput({permit_status:'obtained',permit_number:'P-77',permit_issuer:'مالك الموقع التجريبي',permit_storage:'ملف الإنتاج',...over})}));
  permit({permit_expires_on:day(2)});
  refused=caught(issue);
  assert.match(refused.details.refusal.missing[0].why,/انتهى/,'a permit that lapses before the shoot day does not cover it');
  permit({permit_expires_on:day(30)});
  assert.ok(at().actions.includes('issue_sheet'));
  issue();
  assert.equal(at().status,'issued');
  assert.ok(verifyAudit(db));
});

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,id,label)=>`<button class="btn outline small" data-action="operation" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const painted=(ui,data)=>ui.render(data,{e,button,money});

test('production screens: every offered action opens a form, nothing is inlined past the strict CSP, and the screens say what they cannot do',t=>{
  const {db,users,tx,production,of}=fixture(t);
  const {location,crew,talent}=fullSite(db,users,tx,production);
  tx(()=>saveSchedule(db,users.manager,production,{shoot_date:day(3),rows:[{id:'',scene_ref:'1',title:'المشهد الأول',note:'',location_id:location,start_time:'08:00',estimated_minutes:60}]}));
  tx(()=>addShot(db,users.manager,production,{scene_id:'',code:'1A',description:'لقطة تجريبية',shot_size:'wide',camera_angle:'eye_level',reference_note:''}));
  const sheet=tx(()=>createCallSheet(db,users.manager,sheetInput(production,location,crew,talent))).id;
  tx(()=>callSheetAction(db,users.hr,sheet,'issue',{version:getCallSheet(db,users.manager,sheet).version,note:'راجعت الجدول وبيانات الطوارئ والسلامة'}));

  for(const [ui,data] of [[productionsUI,productionsBoard(db,users.manager)],[callSheetsUI,callSheetsBoard(db,users.manager)],[callSheetsUI,callSheetsBoard(db,users.employee)]]){
    const html=painted(ui,data);
    assert.ok(!/ style="/.test(html)&&!html.includes('<script'),'no inline style and no script survives the strict CSP');
    let opened=0;
    for(const m of html.matchAll(/data-operation="([^"]+)" data-id="([^"]*)"/g)){
      const spec=ui.form(m[1],m[2],data);
      assert.ok(spec.endpoint.startsWith('/'),`${m[1]} points at an endpoint`);
      const rendered=operationFields(spec.fields,e);
      assert.ok(!/ style="/.test(rendered)&&!rendered.includes('<script'));
      opened++;
    }
    assert.ok(opened>0,`${ui.title}: the screen offers at least one action`);
  }
  assert.match(painted(productionsUI,productionsBoard(db,users.manager)),/لا يُعرض أجره ولا تكلفته هنا|مخصص هذا المشروع/);
  assert.match(painted(callSheetsUI,callSheetsBoard(db,users.employee)),/لا رابط مشاركة عام/);
  assert.equal(callSheetsUI.form('create_sheet',production,callSheetsBoard(db,users.manager)).endpoint,'/call-sheets');
  assert.throws(()=>callSheetsUI.form('issue_sheet',sheet,callSheetsBoard(db,users.manager)),/غير متاح/,'a stale screen cannot open a form the server would refuse');
});

test('P4-SPEC-2, PRO-01 and PRO-03 screens: the card names the treatment it shoots and lists what is missing before the shoot and who owns it, start shows only when ready, the form offers the treatment, and a draft sheet says what stops its issue',t=>{
  const {db,users,tx,project,route,production,of}=fixture(t,{ready:false});
  const data=productionsBoard(db,users.manager);
  let html=painted(productionsUI,data);
  assert.match(html,/قبل بدء التصوير/);
  assert.match(html,/معالجة معتمدة/);
  assert.ok(!html.includes('data-operation="start_production"'),'no start button before the shoot is ready');
  const spec=productionsUI.form('edit_production',production,data);
  assert.ok(spec.fields.find(f=>f.name==='review_route_id').options.some(o=>o.value===route),'the approved treatment is offered in the production form');
  const values=Object.fromEntries(spec.fields.map(f=>[f.name,f.value??'']));
  assert.equal(spec.toPayload({...values,review_route_id:route}).review_route_id,route);
  tx(()=>productionAction(db,users.manager,production,'edit',{version:of(production).version,...spec.toPayload({...values,review_route_id:route})}));
  fundProject(db,project.id,'PRD-CC');
  html=painted(productionsUI,productionsBoard(db,users.manager));
  assert.match(html,/المعالجة: «/);
  assert.ok(html.includes('data-operation="start_production"'),'start shows once the shoot is ready');
  assert.ok(!html.includes('قبل بدء التصوير'));

  const location=tx(()=>addLocation(db,users.manager,production,{name:'شارع تجريبي',address_note:'',map_link:'',contact_name:'',contact_phone:'',permit_required:true,
    permit_basis:'قرر المنتج أن الموقع عام ويحتاج إذنًا من مالكه',permit_status:'pending',permit_number:'',permit_issuer:'',permit_expires_on:'',permit_storage:''})).id;
  const crew=tx(()=>addCrew(db,users.manager,production,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:''})).id;
  tx(()=>createCallSheet(db,users.manager,{production_id:production,shoot_date:day(3),...sheetBody(location),invitees:[{party:`crew:${crew}`,call_time:'06:30'}]}));
  const sheets=painted(callSheetsUI,callSheetsBoard(db,users.hr));
  assert.match(sheets,/قبل إصدار الورقة/);
  assert.match(sheets,/تصريح التصوير لموقع «شارع تجريبي»/);
  assert.ok(!sheets.includes('data-operation="issue_sheet"'));
});

