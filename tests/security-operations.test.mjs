import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as G from '../app/governance.mjs';
import * as E from '../app/equipment.mjs';
import * as PR from '../app/production.mjs';
import { createProject } from '../app/projects.mjs';
import { mpegFrameHeader } from '../app/review-rounds.mjs';
import { createInfluencer, influencerAction, influencersBoard } from '../app/influencers.mjs';
import * as X from '../app/service-experience.mjs';
import { fixture as requestFixture } from './request-transparency-fixture.mjs';

// مراجعة أمنية 2026-09-18: الحوكمة والمعدات والإنتاج والمراجعة والمؤثرون وتجربة الخدمة.
const code=value=>error=>error.code===value;
const day=o=>new Date(Date.now()+o*86400000).toISOString().slice(0,10);
function base(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-operations');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users,tx:f=>transaction(db,f)};
}

/* ───── قبول الخطر ───── */
const SCALE={likelihood:[{value:1,label:'نادر',description:''},{value:3,label:'مرجّح',description:''}],impact:[{value:2,label:'محدود',description:''},{value:5,label:'جسيم',description:''}],
  bands:[{label:'مقبول',min_score:1,max_score:5},{label:'مرتفع',min_score:6,max_score:20}]};
const RISK={title:'خطر تجريبي على التسليم',description:'خطر بسيط محدود الأثر على موعد تسليم واحد',category:'تشغيلي',owner_id:'employee',likelihood_value:1,impact_value:2,
  response:'accept_proposed',existing_controls:'',treatment_plan:'',treatment_owner_id:null,treatment_due:null,next_review_on:'2099-10-15',link_type:null,link_id:null};
function acceptedRisk(t){
  const f=base(t),{db,users,tx}=f;
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'governance.risks.manage',note:'تصريح مصطنع'}));
  tx(()=>G.saveRiskScale(db,users.manager,SCALE));
  const id=tx(()=>G.createRisk(db,users.manager,RISK)).id;
  tx(()=>G.riskAction(db,users.manager,id,'accept_risk',{version:1,reason:'قبلت الخطر لأن أثره محدود جدا ونادر'}));
  const risk=()=>G.risksBoard(db,users.manager).risks.find(r=>r.id===id);
  return {...f,id,risk};
}
test('risk acceptance: an owner who raises the severity or rewrites the risk sends it back to proposed acceptance',t=>{
  const {db,users,tx,id,risk}=acceptedRisk(t);
  assert.equal(risk().response,'accept');
  tx(()=>G.riskAction(db,users.employee,id,'edit_risk',{...RISK,version:2,likelihood_value:3,impact_value:5,description:'خطر جسيم: احتمال فقدان عقد العميل الرئيسي كاملًا'}));
  assert.equal(risk().response,'accept_proposed','the acceptance was for score 2, not 15');
  assert.equal(risk().acceptance,null,'and the old approval is no longer shown as standing');
  assert.ok(G.risksBoard(db,users.manager).risks.find(r=>r.id===id).awaiting_acceptance,'it needs a new approval from above the owner');
});
test('risk acceptance: an edit that leaves score, title and description as accepted keeps the acceptance; a title change or a review with a new score does not',t=>{
  const {db,users,tx,id,risk}=acceptedRisk(t);
  tx(()=>G.riskAction(db,users.employee,id,'edit_risk',{...RISK,version:2,category:'تشغيلي معدل'}));
  assert.equal(risk().response,'accept','a category tweak does not change what was accepted');
  tx(()=>G.riskAction(db,users.employee,id,'edit_risk',{...RISK,version:3,category:'تشغيلي معدل',title:'عنوان جديد لخطر مختلف'}));
  assert.equal(risk().response,'accept_proposed');
  tx(()=>G.riskAction(db,users.manager,id,'accept_risk',{version:4,reason:'أعدت قبول الخطر بعنوانه الجديد بعد مراجعته'}));
  assert.equal(risk().response,'accept');
  tx(()=>G.riskAction(db,users.employee,id,'review_risk',{version:5,note:'ارتفع الاحتمال',likelihood_value:3,impact_value:2,next_review_on:'2099-12-01'}));
  assert.equal(risk().response,'accept_proposed','a review that changes the score reopens the acceptance too');
});
test('risk acceptance: the database refuses an accepted risk whose score or text changes',t=>{
  const {db,id}=acceptedRisk(t);
  assert.throws(()=>db.prepare('UPDATE governance_risks SET impact_value=5,version=version+1 WHERE id=?').run(id),/returns it to proposed acceptance/);
  assert.throws(()=>db.prepare("UPDATE governance_risks SET description='وصف آخر تمامًا للخطر المقبول',version=version+1 WHERE id=?").run(id),/returns it to proposed acceptance/);
  db.prepare("UPDATE governance_risks SET response='accept_proposed',impact_value=5,version=version+1 WHERE id=?").run(id);
  assert.throws(()=>db.prepare("UPDATE governance_risks SET response='accept',version=version+1 WHERE id=?").run(id),/snapshot matching/,'the old approval does not re-apply to the new score');
});

/* ───── فقد المعدات ───── */
test('equipment: the custodian of a live booking cannot confirm the loss of the item in their custody, and a confirmed loss closes the booking',t=>{
  const {db,users,tx}=base(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'equipment.manage',note:'تصريح مصطنع'}));
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('boss','36t','ops','boss','مدير أعلى مصطنع','unused','manager',NULL)");
  const boss=db.prepare("SELECT * FROM users WHERE id='boss'").get();
  const item=tx(()=>E.createItem(db,users.manager,{name:'كاميرا تجريبية',category:'camera',serial_no:'SN-1',condition_state:'good',condition_note:'',home_location:'',asset_id:''}));
  const bk=tx(()=>E.createBooking(db,users.hr,{item_id:item.id,kit_id:'',project_id:'',production_ref:'',purpose:'تصوير تجريبي',start_date:day(0),end_date:day(0),custodian_id:'manager'}));
  tx(()=>E.bookingAction(db,users.manager,bk.id,'hand_out',{version:1,counterpart_id:'hr',condition_state:'good',condition_note:'سليمة تماما',acknowledgement:'استلمت القطعة بحالة سليمة',photo:null}));
  const version=()=>db.prepare('SELECT version FROM equipment_items WHERE id=?').get(item.id).version;
  tx(()=>E.itemAction(db,users.hr,item.id,'report_lost',{version:version(),note:'لم تعد القطعة من موقع التصوير'}));
  assert.throws(()=>tx(()=>E.itemAction(db,users.manager,item.id,'confirm_lost',{version:version(),note:'أقر بفقدان القطعة نهائيا'})),code('invalid_state'),'the custodian does not judge the loss of what they hold');
  assert.throws(()=>tx(()=>E.itemAction(db,users.manager,item.id,'reject_lost',{version:version(),note:'القطعة عندي ولم تفقد'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE equipment_items SET status='lost',lost_confirmed_by='manager',version=version+1 WHERE id=?").run(item.id),/custodian or booker/,'and the database refuses it');
  tx(()=>E.itemAction(db,boss,item.id,'confirm_lost',{version:version(),note:'أقر بفقدان القطعة بعد التحقق من الموقع'}));
  assert.equal(db.prepare('SELECT status FROM equipment_items WHERE id=?').get(item.id).status,'lost');
  const booking=db.prepare('SELECT status,cancel_note FROM equipment_bookings WHERE id=?').get(bk.id);
  assert.equal(booking.status,'cancelled','a lost item keeps no live booking');
  assert.match(booking.cancel_note,/إقرار فقد/);
});

/* ───── ورقة الاستدعاء ───── */
test('production: an invitee without the production capability reads a call sheet only once it is issued',t=>{
  const {db,users,tx}=base(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'production.manage',note:'تصريح مصطنع'}));
  const proj=tx(()=>createProject(db,users.manager,{name:'مشروع تصوير تجريبي',brief:'موجز مصطنع لاختبار وحدة الإنتاج',member_ids:['employee']}));
  const pid=tx(()=>PR.createProduction(db,users.manager,{code:'CRE-01',title:'إنتاج',kind:'ad',brief:'',client_id:'',campaign_id:'',project_id:proj.id,shoot_from:day(3),shoot_to:day(6)})).id;
  const loc=tx(()=>PR.addLocation(db,users.manager,pid,{name:'استوديو تجريبي',address_note:'عنوان',map_link:'',contact_name:'مالك الموقع',contact_phone:'0500000000',permit_required:false,permit_basis:'',permit_status:'not_required',permit_number:'',permit_issuer:'',permit_expires_on:'',permit_storage:''})).id;
  const crew=tx(()=>PR.addCrew(db,users.manager,pid,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:''})).id;
  const sheet=tx(()=>PR.createCallSheet(db,users.manager,{production_id:pid,shoot_date:day(4),location_id:loc,map_link:'',call_time:'07:00',wrap_time:'',day_schedule:[{time:'07:00',activity:'تجمع',note:''}],safety_notes:'',weather_note:'',
    nearest_hospital:'مستشفى',hospital_address:'',emergency_contact_name:'مسؤول السلامة',emergency_contact_phone:'0561111111',invitees:[{party:`crew:${crew}`,call_time:'07:00'}]})).id;
  assert.throws(()=>PR.getCallSheet(db,users.employee,sheet),code('not_found'),'a draft is not the invitee’s to read');
  assert.equal(PR.getCallSheet(db,users.manager,sheet).status,'draft','the production team still reads it');
  db.prepare("UPDATE call_sheets SET status='issued',issued_by='hr',issued_at='2026-01-01T00:00:00Z',version=version+1 WHERE id=?").run(sheet);
  assert.equal(PR.getCallSheet(db,users.employee,sheet).status,'issued');
});

/* ───── توقيع MP3 ───── */
test('review rounds: audio is accepted as MP3 only with an ID3 tag or a valid MPEG frame header',()=>{
  const bytes=(...b)=>Buffer.from([...b,0,0,0,0]);
  assert.equal(mpegFrameHeader(bytes(0xFF,0xFB,0x90,0x64)),true,'MPEG-1 layer III, 128 kbps, 44.1 kHz');
  assert.equal(mpegFrameHeader(bytes(0xFF,0xF3,0x48,0xC4)),true,'MPEG-2 layer III');
  assert.equal(mpegFrameHeader(bytes(0xFF,0xFF,0xFF,0xFF)),false,'sync alone is not a header: bad bitrate');
  assert.equal(mpegFrameHeader(bytes(0xFF,0xEB,0x90,0x64)),false,'reserved version');
  assert.equal(mpegFrameHeader(bytes(0xFF,0xF9,0x90,0x64)),false,'reserved layer');
  assert.equal(mpegFrameHeader(bytes(0xFF,0xFB,0xF0,0x64)),false,'bitrate index 1111');
  assert.equal(mpegFrameHeader(bytes(0xFF,0xFB,0x9C,0x64)),false,'reserved sample rate');
  assert.equal(mpegFrameHeader(Buffer.from([0xFF,0xFB])),false,'too short');
});

/* ───── رابط حساب المؤثر ───── */
test('influencers: an account profile link is http(s) with no spaces, or nothing',t=>{
  const {db,users,tx}=base(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'employee',capability:'influencers.manage',note:'تصريح مصطنع'}));
  const id=tx(()=>createInfluencer(db,users.employee,{stage_name:'مؤثرة تجريبية أ',category:'food',contact_mode:'agency',agency_name:'وكالة مصطنعة',contact_name:'وكيل مصطنع',contact_channel:'agent@example.invalid',notes:'ملف اختبار'})).id;
  const version=()=>influencersBoard(db,users.employee).influencers.find(x=>x.id===id).version;
  const add=(handle,profile_url)=>tx(()=>influencerAction(db,users.employee,id,'add_account',{version:version(),platform:'instagram',handle,profile_url}));
  for(const bad of ['javascript:alert(1)','data:text/html,x','https://ex ample.test','ftp://example.test/x'])
    assert.throws(()=>add('handle.bad',bad),code('profile_url'),bad);
  add('handle.ok','https://example.invalid/synthetic');
  add('handle.none','');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM influencer_accounts WHERE influencer_id=?').get(id).n,2);
});

/* ───── تجربة الخدمة ───── */
test('service experience: a department is folded when subtracting its visible services would reveal a lone answer, and its comments need every service to reach the threshold',t=>{
  const f=requestFixture(t,'security-experience');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
  const ans=(u,id,a,c='')=>f.tx(()=>X.answerExperience(f.db,f.users[u],id,{version:f.version(id),answer:a,comment:c}));
  f.tx(()=>X.setExperienceThreshold(f.db,f.users.admin,{min_responses:3,basis:'تجريبي: حد أدنى ثلاث إجابات',confirmed_on:today}));
  f.grantInsight('manager');
  for(const c of ['تجريبي أ','تجريبي ب','تجريبي ج']){const id=f.closed('employee');ans('employee',id,'met',c);}
  const cols=f.db.prepare('PRAGMA table_info(services)').all().map(c=>c.name);
  f.db.prepare(`INSERT INTO services(${cols.join(',')}) SELECT ${cols.map(c=>c==='id'?"'svc-lone'":c==='code'?"'IT-LONE'":c).join(',')} FROM services WHERE code='IT-SUPPORT'`).run();
  const lone=f.closed('outsider');
  f.db.prepare('UPDATE requests SET service_id=? WHERE id=?').run('svc-lone',lone);
  ans('outsider',lone,'not_met','مدير الدعم تجاهلني');
  const byService=X.experienceSummary(f.db,f.users.manager,{group_by:'service'});
  assert.deepEqual(byService.groups.map(g=>g.key),['IT-SUPPORT']);
  const byDepartment=X.experienceSummary(f.db,f.users.manager,{group_by:'department'});
  assert.equal(byDepartment.groups.length,0,'4 answers minus the visible 3 is the lone answer: the department folds');
  assert.ok(!JSON.stringify(byDepartment).includes('مدير الدعم تجاهلني'));
  // خدمتان تبلغان الحد: تظهر الإدارة وتعليقاتها.
  for(const c of ['تعليق ثان أ','تعليق ثان ب']){const id=f.closed('outsider');f.db.prepare('UPDATE requests SET service_id=? WHERE id=?').run('svc-lone',id);ans('outsider',id,'partly',c);}
  const full=X.experienceSummary(f.db,f.users.manager,{group_by:'department'});
  assert.equal(full.groups.length,1);
  assert.equal(full.groups[0].answers,6);
  assert.ok(full.groups[0].comments.length>0);
});
