import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign } from '../app/campaigns.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { createVendor, vendorAction, getVendor } from '../app/vendors.mjs';
import { preparePayment, getOrder, paymentAction } from '../app/payables.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approvedVersion } from './studio-fixture.mjs';
import { uploadFile, listFiles, downloadFile } from '../app/files.mjs';
import { createInfluencer, influencerAction, influencersBoard, createEngagement, engagementAction,
  addContent, contentAction, verifyProof, influencerCampaignsBoard, MANUAL_METRIC_NOTE } from '../app/influencers.mjs';

const code=value=>error=>error.code===value;
const caught=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
const PNG=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]).toString('base64');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const iban=bban=>{const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-influencers');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const who of ['employee','manager','outsider'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'influencers.manage',note:'تصريح اختبار مصطنع'}));
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل المصطنعة للمؤثرين',trade_name:'عميل المؤثرين',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'منسقة المؤثرين'}));
  const campaignId=tx(()=>createCampaign(db,users.employee,{client_id:clientId,name:'حملة المؤثرين المصطنعة',objective:'تعريف الجمهور بالمنتج الجديد عبر صناع المحتوى',
    channels:['instagram','tiktok'],targets:[{metric:'مشاهدات',target:100000,unit:'مشاهدة'}],media_budget:'0',budget_reference:'',start_date:today(),end_date:addDays(today(),30)})).id;
  const roster=who=>influencersBoard(db,users[who]);
  const board=who=>influencerCampaignsBoard(db,users[who]);
  const person=(who='employee')=>roster(who).influencers.find(x=>x.stage_name==='مؤثرة تجريبية أ');
  const makeInfluencer=(who='employee')=>tx(()=>createInfluencer(db,users[who],{stage_name:'مؤثرة تجريبية أ',category:'food',contact_mode:'agency',agency_name:'وكالة مصطنعة',
    contact_name:'وكيل مصطنع',contact_channel:'agent@example.invalid',notes:'ملف اختبار'})).id;
  const act=(who,id,action,values={})=>tx(()=>influencerAction(db,users[who],id,action,{version:person(who).version,...values}));
  // بوابة المورد (app/vendors.mjs): الكيان الذي بلا ملف ما عاد يُقبل عرضه ولا تُرسى عليه ترسية،
  // فكل مفتاح يمرّ في add_quote يحتاج ملفًا مؤهلًا فعلًا يبنيه المساعد بالمسار الحقيقي.
  // وموضعه آخر التجهيز عمدًا: المساعد يمنح vendors.manage بنفسه، فلو سبق منح الاختبار لاصطدما.
    // «supplier-a» يسجّله الاختبار نفسه أدناه بملف مؤثرة فردية، فلا يُسجَّل هنا مرتين.
  approveVendors(db,['supplier-b', 'supplier-c']);
  // مشروع عمل الاستوديو الذي تُعتمد فيه مسودات المؤثرين (الترحيل 189).
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع مسودات المؤثرين المصطنع',brief:'نسخ معتمدة لمحتوى المؤثرين',member_ids:['employee','outsider']})).id;
  return {db,users,tx,clientId,campaignId,roster,board,person,makeInfluencer,act,project};
}

// ارتباط جاهز للاستخدام في اختبارات المحتوى والدفع: مؤثر متاح، وارتباط معتمد من غير صاحبه.
function activeEngagement(f,{posts=1,stories=0,videos=0}={}){
  const {db,users,tx,clientId,campaignId,makeInfluencer,act,board}=f,date=today();
  const influencerId=makeInfluencer();
  act('employee',influencerId,'set_status',{status:'active',note:'اكتمل الملف وجهة التواصل'});
  const engagementId=tx(()=>createEngagement(db,users.employee,{influencer_id:influencerId,client_id:clientId,campaign_id:campaignId,
    title:'ارتباط إطلاق المنتج المصطنع',brief:'ثلاث لقطات من التجربة',posts_count:posts,stories_count:stories,videos_count:videos,fee:'5000.00',
    starts_on:date,ends_on:addDays(date,20),cancellation_terms:'الإلغاء قبل سبعة أيام بلا مقابل، وبعدها نصف الأتعاب',
    disclosure_requirement:'يظهر وسم «إعلان» في أول سطر من النص',usage_scope:'organic_only',usage_from:date,usage_until:addDays(date,60),
    usage_terms:'استخدام عضوي على حسابات المؤثرة فقط خلال المدة المذكورة'})).id;
  const view=who=>board(who).engagements.find(e=>e.id===engagementId);
  const eAct=(who,action,values={})=>tx(()=>engagementAction(db,users[who],engagementId,action,{version:view(who).version,...values}));
  eAct('employee','request_review');
  eAct('manager','approve_engagement',{note:'راجعت المخرجات وحقوق الاستخدام وشروط الإلغاء',licence_ack:'لا رخصة مسجلة للمؤثرة. أتحمل مسؤولية المضي، وأحلت الأمر للمختص القانوني للتأكيد'});
  return {influencerId,engagementId,view,eAct};
}

test('influencer roster: the platform reads nothing from any social platform — every number is a dated manual snapshot corrected by a newer one, and a licence is an alert with a written acknowledgement, never an automatic block',t=>{
  const f=fixture(t),{db,users,tx,roster,person,makeInfluencer,act}=f,date=today();
  assert.throws(()=>roster('hr'),code('not_permitted'),'the module needs its own capability');
  const id=makeInfluencer();
  let x=person();
  assert.equal(x.licence.state,'missing');assert.equal(roster('employee').alerts.licence_missing,1);
  assert.equal(x.status,'draft');assert.equal(x.vendor,null);
  act('employee',id,'add_account',{platform:'instagram',handle:'synthetic.creator',profile_url:'https://example.invalid/synthetic'});
  const accountId=person().accounts[0].id;
  assert.throws(()=>act('employee',id,'record_snapshot',{account_id:accountId,metric:'متابعون',value:120000,unit:'حساب',captured_on:addDays(date,1),source:'لقطة أرسلها الوكيل',corrects_id:''}),code('captured_on'));
  act('employee',id,'record_snapshot',{account_id:accountId,metric:'متابعون',value:120000,unit:'حساب',captured_on:date,source:'لقطة شاشة أرسلها الوكيل بالبريد',corrects_id:''});
  let snapshot=person().accounts[0].snapshots[0];
  assert.equal(snapshot.entry_method,'manual_snapshot');assert.equal(snapshot.entry_note,MANUAL_METRIC_NOTE);assert.equal(snapshot.superseded,false);
  const account=person().accounts[0];
  assert.deepEqual(Object.keys(account).filter(k=>/rate|engagement|average|total|reach/.test(k)),[],'no computed audience figure is invented');
  assert.throws(()=>db.prepare('UPDATE influencer_metrics SET value=1').run(),/corrected by a new snapshot/);
  act('employee',id,'record_snapshot',{account_id:accountId,metric:'متابعون',value:118000,unit:'حساب',captured_on:date,source:'لقطة أحدث من لوحة الحساب نفسه',corrects_id:snapshot.id});
  assert.equal(person().accounts[0].snapshots.find(m=>m.id===snapshot.id).superseded,true);
  assert.throws(()=>act('employee',id,'record_snapshot',{account_id:accountId,metric:'متابعون',value:1,unit:'',captured_on:date,source:'تصحيح ثانٍ للقطة نفسها',corrects_id:snapshot.id}),code('corrects_id'));
  assert.throws(()=>act('employee',id,'set_licence',{licence_number:'',licence_expires_on:addDays(date,30),licence_source:''}),code('licence_number'));
  act('employee',id,'set_licence',{licence_number:'SYN-LIC-1',licence_expires_on:addDays(date,-1),licence_source:'نسخة الرخصة من الوكيل بتاريخ اليوم — لم تُتحقق رسميًا'});
  x=person();
  assert.equal(x.licence.state,'expired');assert.equal(x.licence.needs_ack,true);assert.equal(roster('employee').alerts.licence_expired,1);
  assert.match(roster('employee').licence_notice,/مصدره ثانوي ولم يُتحقق منه رسميًا/);
  act('employee',id,'set_licence',{licence_number:'SYN-LIC-1',licence_expires_on:addDays(date,20),licence_source:'نسخة الرخصة من الوكيل بتاريخ اليوم — لم تُتحقق رسميًا'});
  assert.equal(person().licence.state,'recorded');
  act('employee',id,'set_status',{status:'blocked',note:'اختبار الحالة: لا نتعاقد حاليًا'});
  assert.deepEqual(person().actions,['set_status'],'a blocked file offers nothing but reopening its status');
  // العزل بين الكيانات: ملف مؤثر في كيان آخر لا يظهر هنا مهما كان التصريح.
  db.prepare("INSERT INTO influencers(id,tenant_id,code,stage_name,category,contact_mode,agency_name,contact_name,contact_channel,notes,status,created_by,created_at,updated_at) VALUES(?,'isolated','INF-9001','مؤثر الكيان المعزول','other','direct','','جهة مصطنعة','x@example.invalid','','active','external',?,?)").run(randomUUID(),now(),now());
  assert.equal(roster('employee').influencers.length,1);
  assert.ok(verifyAudit(db));
});

test('influencer engagement: the person who prepares it never approves it, an expired or missing licence needs a written acknowledgement instead of a silent block, and an approved engagement keeps its deliverables, fee and usage rights',t=>{
  const f=fixture(t),{db,users,tx,clientId,campaignId,board,makeInfluencer,act}=f,date=today();
  const influencerId=makeInfluencer();
  const input={influencer_id:influencerId,client_id:clientId,campaign_id:campaignId,title:'ارتباط مصطنع',brief:'',posts_count:0,stories_count:0,videos_count:0,fee:'5000.00',
    starts_on:date,ends_on:addDays(date,20),cancellation_terms:'الإلغاء قبل سبعة أيام بلا مقابل',disclosure_requirement:'وسم إعلان ظاهر',
    usage_scope:'paid_ads',usage_from:date,usage_until:addDays(date,10),usage_terms:'إعادة نشر في إعلان مدفوع خلال المدة المذكورة'};
  assert.throws(()=>tx(()=>createEngagement(db,users.employee,{...input,posts_count:2})),code('influencer_unavailable'),'a draft file is not contracted');
  act('employee',influencerId,'set_status',{status:'active',note:'اكتمل الملف'});
  assert.throws(()=>tx(()=>createEngagement(db,users.employee,input)),code('deliverables'),'an engagement without a countable deliverable is not an engagement');
  assert.throws(()=>tx(()=>createEngagement(db,users.employee,{...input,posts_count:2,cancellation_terms:'قصير'})),code('invalid_text'));
  assert.throws(()=>tx(()=>createEngagement(db,users.outsider,{...input,posts_count:2})),code('not_found'),'an account team member only');
  const id=tx(()=>createEngagement(db,users.employee,{...input,posts_count:2})).id;
  const view=who=>board(who).engagements.find(e=>e.id===id);
  const eAct=(who,action,values={})=>tx(()=>engagementAction(db,users[who],id,action,{version:view(who).version,...values}));
  assert.equal(board('outsider').engagements.length,0,'an employee outside the account team sees nothing');
  eAct('employee','request_review');
  assert.throws(()=>eAct('employee','approve_engagement',{note:'أعتمد ارتباطي بنفسي',licence_ack:''}),code('action_unavailable'));
  assert.throws(()=>eAct('manager','approve_engagement',{note:'اعتماد دون النظر في الرخصة',licence_ack:''}),code('licence_ack_required'));
  assert.throws(()=>tx(()=>engagementAction(db,users.manager,id,'approve_engagement',{version:view('manager').version+5,note:'نسخة قديمة',licence_ack:'إقرار مكتوب طويل بما يكفي للاختبار المصطنع'})),code('stale_version'));
  eAct('manager','approve_engagement',{note:'راجعت المخرجات وحقوق الاستخدام',licence_ack:'لا رخصة مسجلة. أتحمل مسؤولية المضي وأحلت الأمر للمختص القانوني'});
  let g=view('employee');
  assert.equal(g.status,'active');assert.equal(g.licence_state_at_approval,'missing');assert.match(g.licence_ack_note,/أتحمل مسؤولية المضي/);
  assert.equal(g.usage_state,'expiring','usage rights ending within a month raise their own alert');
  assert.equal(board('employee').alerts.usage_expiring,1);
  assert.equal(g.payment_gate.allowed,false);
  assert.throws(()=>db.prepare('UPDATE influencer_engagements SET fee_minor=1,version=version+1 WHERE id=?').run(id),/keeps its deliverables/);
  assert.throws(()=>db.prepare('DELETE FROM influencer_engagements WHERE id=?').run(id),/cancelled, not deleted/);
  assert.throws(()=>db.prepare("INSERT INTO influencer_engagements(id,tenant_id,influencer_id,client_id,campaign_id,title,posts_count,stories_count,videos_count,fee_minor,currency,starts_on,ends_on,cancellation_terms,disclosure_requirement,usage_scope,usage_from,usage_until,usage_terms,status,owner_id,approved_by,approved_at,licence_state_at_approval,created_at,updated_at) VALUES(?,'36t',?,?,?,'ارتباط يعتمده صاحبه',1,0,0,100,'SAR',?,?,'شروط إلغاء مصطنعة','وسم إعلان','organic_only',?,?,'شروط استخدام مصطنعة','active','employee','employee',?,'recorded',?,?)")
    .run(randomUUID(),influencerId,clientId,campaignId,date,date,date,date,now(),now(),now()),/CHECK/,'SQL refuses a self-approved engagement even if the code is bypassed');
  assert.throws(()=>eAct('employee','complete_engagement',{note:'قصير'}),code('invalid_text'));
  eAct('employee','complete_engagement',{note:'أُقفل دون تنفيذ أي مخرج: اعتذرت المؤثرة، ولم تُدفع أي دفعة'});
  assert.deepEqual(view('employee').actions,['link_payment'],'a closed engagement is read-only except for tying a payment already prepared');
  assert.throws(()=>db.prepare("UPDATE influencer_engagements SET status='active',version=version+1 WHERE id=?").run(id),/closed engagement is final/);
  assert.ok(verifyAudit(db));
});

test('influencer content and proof: internal approval by another person, a client approval recorded with its evidence, and a publication proof a human verifies — the platform never visits a platform and never verifies by itself',t=>{
  const f=fixture(t),{db,users,tx,board}=f,date=today();
  const {engagementId,view,eAct}=activeEngagement(f);
  // مسودة المؤثر نسخة مخرج يعتمدها الاستوديو في عمل مفتوح لحملة الارتباط (P4-SPEC-3، الترحيل 189): الأولى ثم المعدّلة بعد الإعادة.
  const [first,second]=['مسودة المؤثرة المصطنعة v1','مسودة المؤثرة المصطنعة v2 بالوسم'].map(title=>approvedVersion(db,users,{project:f.project,campaign:f.campaignId,channel:'instagram',title}).version);
  const contentId=tx(()=>addContent(db,users.employee,engagementId,{version:view('employee').version,kind:'post',title:'منشور التجربة المصطنع',description:'لقطات من تجربة المنتج'})).id;
  const item=who=>board(who).engagements.find(e=>e.id===engagementId).content.find(c=>c.id===contentId);
  const cAct=(who,action,values={})=>tx(()=>contentAction(db,users[who],contentId,action,{version:item(who).version,...values}));
  cAct('employee','submit_content',{output_version_id:first});
  assert.throws(()=>cAct('employee','approve_content',{note:'أعتمد عملي بنفسي'}),code('action_unavailable'));
  cAct('manager','return_content',{note:'وسم الإعلان غير ظاهر في أول سطر من النص'});
  cAct('employee','submit_content',{output_version_id:second});
  assert.equal(item('employee').output.version_id,second,'the resubmitted content carries the new approved version');
  cAct('manager','approve_content',{note:'مطابق للبريف ويحمل وسم الإعلان'});
  assert.throws(()=>cAct('employee','record_proof',{post_url:'https://example.invalid/p/1',published_on:date,screenshot_reference:'لقطة مصطنعة',disclosure_confirmed:true,disclosure_evidence:'الوسم في أول سطر'}),code('action_unavailable'),'no proof before the client approves');
  assert.throws(()=>cAct('employee','record_client_approval',{approver_name:'مديرة التسويق المصطنعة',channel:'phone',received_on:date,reference:'مكالمة بلا دليل مكتوب'}),code('channel'));
  cAct('employee','record_client_approval',{approver_name:'مديرة التسويق المصطنعة',channel:'email',received_on:date,reference:'بريد الموافقة محفوظ في ملف العميل بتاريخ اليوم'});
  assert.equal(item('employee').status,'client_approved');
  assert.throws(()=>cAct('employee','record_proof',{post_url:'https://example.invalid/p/1',published_on:date,screenshot_reference:'لقطة الشاشة المصطنعة محفوظة في ملف الحملة',disclosure_confirmed:false,disclosure_evidence:'الوسم في أول سطر من النص'}),code('disclosure_confirmed'),'the advertising disclosure is mandatory');
  assert.throws(()=>cAct('employee','record_proof',{post_url:'example.invalid/p/1',published_on:date,screenshot_reference:'لقطة الشاشة المصطنعة محفوظة في ملف الحملة',disclosure_confirmed:true,disclosure_evidence:'الوسم في أول سطر من النص'}),code('post_url'));
  assert.throws(()=>tx(()=>engagementAction(db,users.employee,engagementId,'complete_engagement',{version:view('employee').version,note:'إقفال قبل نشر المحتوى المعتمد'})),code('content_open'));
  cAct('employee','record_proof',{post_url:'https://example.invalid/p/1',published_on:date,screenshot_reference:'لقطة الشاشة المصطنعة محفوظة في ملف الحملة',disclosure_confirmed:true,disclosure_evidence:'وسم «إعلان» في أول سطر من النص'});
  let proof=item('employee').proof;
  assert.equal(item('employee').status,'published');assert.equal(proof.verified_by,null,'publishing is claimed by a person, never confirmed by the platform');
  assert.deepEqual(item('employee').proof.actions,[],'the one who recorded the proof is not offered its verification');
  assert.deepEqual(item('manager').proof.actions,['verify_proof']);
  assert.throws(()=>tx(()=>verifyProof(db,users.employee,proof.id,{method:'human_open_link',note:'أتحقق من إثباتي بنفسي'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>verifyProof(db,users.manager,proof.id,{method:'automatic_api',note:'تحقق آلي من المنصة مباشرة'})),code('method'));
  assert.equal(board('employee').alerts.proofs_awaiting,1);
  tx(()=>verifyProof(db,users.manager,proof.id,{method:'human_open_link',note:'فتحت الرابط وطابقت النص والوسم واللقطة'}));
  proof=item('employee').proof;
  assert.equal(proof.verified_by_name,users.manager.name);assert.equal(board('employee').alerts.proofs_awaiting,0);
  assert.throws(()=>tx(()=>verifyProof(db,users.outsider,proof.id,{method:'human_open_link',note:'تحقق ثانٍ بعد التحقق الأول'})),code('not_found'));
  assert.throws(()=>db.prepare("UPDATE influencer_proofs SET post_url='https://example.invalid/p/2' WHERE id=?").run(proof.id),/verified once by a person/);
  assert.throws(()=>db.prepare("UPDATE influencer_content SET title='تعديل بعد النشر',version=version+1 WHERE id=?").run(contentId),/final/);
  const g=view('employee');
  assert.equal(g.deliverables.find(d=>d.key==='post').verified,1);
  assert.equal(g.payment_gate.proof_complete,true);
  eAct('employee','complete_engagement',{note:'سُلّم المنشور المتفق عليه وتحقق منه فريق الحساب'});
  assert.equal(view('employee').status,'completed');
  assert.ok(verifyAudit(db));
});

test('influencer payment: it rides the existing payables path on the vendor file, is linked before finance approves it, and paying before a verified proof needs a written exception from someone other than the engagement owner',t=>{
  const f=fixture(t),{db,users,tx,board}=f,date=today();
  const {influencerId,engagementId,view}=activeEngagement(f,{posts:1});
  const person=()=>influencersBoard(db,users.employee).influencers.find(x=>x.id===influencerId);
  // المسار المالي القائم: المؤثرة مورد مؤهل بحساب بنكي متحقق منه، ثم مستحق مطابَق، ثم أمر دفع.
  for(const [who,actions] of [['employee',['read','prepare']],['manager',['read','approve']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مدفوعات مصطنع',null,now());
  for(const who of ['employee','outsider'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'vendors.manage',note:'تصريح اختبار'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'vendors.bank',note:'تصريح اختبار'}));
  const vendorId=tx(()=>createVendor(db,users.employee,{legal_name:'مؤثرة تجريبية أ للخدمات الإعلانية',entity_type:'individual',country:'SA',categories:['influencers'],
    data_source:'نموذج تسجيل مصطنع',supplier_key:'supplier-a'})).id;
  const vAct=(who,action,values={})=>tx(()=>vendorAction(db,users[who],vendorId,action,{version:getVendor(db,users[who],vendorId).version,...values}));
  vAct('employee','add_contact',{name:'وكيل مصطنع',role:'وكيل أعمال',email:'agent@example.invalid',phone:''});
  vAct('employee','submit');
  vAct('outsider','propose_bank',{bank_name:'بنك مصطنع',account_holder:'مؤثرة تجريبية أ',iban:iban('80000000000000000011'),reason:'تسجيل حساب الدفع الأول للمورد'});
  vAct('hr','verify_bank',{bank_id:getVendor(db,users.hr,vendorId).bank[0].id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق للاسم',effective_from:date});
  for(const [kind,who] of [['duplicate','outsider'],['procurement','outsider'],['technical','manager'],['finance','hr']])vAct(who,'review_'+kind,{decision:'passed',note:'اجتاز المراجعة المصطنعة'});
  vAct('outsider','approve',{outcome:'conditional',reason:'اعتماد مشروط بمدة حتى استكمال وثيقة العمل الحر',valid_until:addDays(date,90),condition_note:'يُستكمل إثبات العمل الحر قبل انتهاء المدة'});
  tx(()=>influencerAction(db,users.employee,influencerId,'link_vendor',{version:person().version,vendor_id:vendorId,note:'ملف المورد نفسه للمؤثرة'}));
  assert.equal(view('employee').payment_gate.blockers.some(b=>b.code==='proof'),true);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع مؤثرين مصطنع',brief:'اختبار دفع المؤثرين',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const pAct=(p,who,action,values={})=>tx(()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=tx(()=>createPurchase(db,users.employee,{project_id:project.id,title:'أتعاب مؤثرة مصطنعة',specification:'منشور واحد ضمن حملة الإطلاق المصطنعة',cost_center:'SYNTHETIC-CC-1',
    due_date:'2099-10-20',quantity:1,unit:'منشور',budget_amount:'6000.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
  p=pAct(p,'employee','submit');
  for(const [key,price] of [['supplier-a','5000.00'],['supplier-b','5100.00'],['supplier-c','5200.00']])
    p=pAct(p,'employee','add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',
      financial_terms:'استحقاق بعد النشر والتحقق',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  p=pAct(p,'manager','award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
  p=pAct(p,'manager','approve_order',{terms:'منشور واحد بعد الاعتماد',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
  p=pAct(p,'manager','commence',{start_on:today(),valid_until:'2099-12-31',site_or_channel:'حساب المؤثرة المصطنع',scope_confirmation:'أذنّا بالنشر على النطاق المعتمد في الأمر الداخلي',evidence:'رسالة إذن النشر المرسلة للمؤثرة وردّها بالاستلام'});
  p=pAct(p,'employee','receive',{quantity:1,reference:'receipt-1',evidence:'استلمنا المنشور وفق المتفق عليه'});
  p=pAct(p,'employee','record_invoice',{supplier_reference:'inv-900',quantity:1,amount:'5000.00',evidence:'فاتورة المؤثرة المصطنعة بقيمة 5000 ريال'});
  p=pAct(p,'manager','match',{invoice_id:p.invoices[0].id,note:'طابقنا الأمر والاستلام والفاتورة'});
  const orderId=tx(()=>preparePayment(db,users.employee,{payable_id:p.payables[0].id})).id;
  const link=(who,values)=>tx(()=>engagementAction(db,users[who],engagementId,'link_payment',{version:view(who).version,...values}));
  assert.throws(()=>link('employee',{payment_order_id:orderId,basis:'دفعة الأتعاب كاملة',exception_note:''}),code('proof_required'),'no verified proof, no payment without a written exception');
  assert.throws(()=>link('employee',{payment_order_id:orderId,basis:'دفعة الأتعاب كاملة',exception_note:'أقرر الدفع قبل إثبات النشر لأن المؤثرة صاحبة الارتباط'}),code('separation_of_duties'));
  link('manager',{payment_order_id:orderId,basis:'دفعة الأتعاب كاملة بحسب الاتفاق المصطنع',exception_note:'يُدفع قبل إثبات النشر لارتباط الموعد بالعقد، وأتحمل القرار وأبلغت مسؤول الحساب'});
  let g=view('employee');
  assert.equal(g.payments.length,1);assert.equal(g.payments[0].proof_state,'written_exception');assert.equal(g.payments[0].order_status,'pending');
  assert.equal(board('employee').alerts.paid_without_proof,1);
  assert.throws(()=>link('manager',{payment_order_id:orderId,basis:'ربط ثانٍ لأمر الدفع نفسه',exception_note:'محاولة ربط مكررة لأمر الدفع نفسه ذاته'}),code('already_linked'));
  // بعد اعتماد المالية للأمر لا يُربط بأثر رجعي: الربط يسبق القرار حتى يراه المعتمد.
  tx(()=>paymentAction(db,users.manager,orderId,'approve_order',{version:getOrder(db,users.manager,orderId).version,note:'اعتماد الدفعة بعد الاطلاع على أساسها'}));
  assert.throws(()=>db.prepare('INSERT INTO influencer_payments VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t',engagementId,orderId,'ربط بعد الاعتماد','verified_proof','','manager',now()),/awaits approval|UNIQUE/);
  assert.ok(verifyAudit(db));
});

test('INF-01 one file per handle: the same platform handle — whatever its letter case or leading @ — is refused on a second influencer file in the tenant, naming the file that holds it, in the code and in SQL; retiring it from the wrong file frees it',t=>{
  const f=fixture(t),{db,users,tx}=f;
  const make=(stage)=>tx(()=>createInfluencer(db,users.employee,{stage_name:stage,category:'food',contact_mode:'direct',agency_name:'',contact_name:'جهة تواصل مصطنعة',contact_channel:'creator@example.invalid',notes:''})).id;
  const first=make('مؤثر الحساب الأول'),second=make('مؤثر الحساب الثاني');
  const file=id=>influencersBoard(db,users.employee).influencers.find(x=>x.id===id);
  const add=(id,handle)=>tx(()=>influencerAction(db,users.employee,id,'add_account',{version:file(id).version,platform:'instagram',handle,profile_url:''}));
  add(first,'@Creator.One');
  const refused=caught(()=>add(second,'creator.one'));
  assert.equal(refused.code,'duplicate_account');
  assert.ok(refused.message.includes(file(first).code),'the refusal names the file that already holds the handle');
  assert.ok(refused.details.refusal.next,'and says what to do next');
  assert.equal(caught(()=>add(first,'CREATOR.ONE')).code,'duplicate_account','the same file does not hold it twice either');
  add(second,'creator.one.official');
  assert.throws(()=>db.prepare("INSERT INTO influencer_accounts(id,influencer_id,platform,handle,profile_url,added_by,created_at) VALUES(?,?,'instagram','@CREATOR.ONE','','employee',?)").run(randomUUID(),second,now()),/one influencer file in its tenant/);
  assert.equal(influencersBoard(db,users.employee).duplicate_accounts.length,0,'no pair to decide');
  // الحساب انسجل غلط على الملف الأول: يُعطَّل منه، فيُضاف للملف الصحيح.
  const account=file(first).accounts.find(a=>a.handle==='@Creator.One');
  tx(()=>influencerAction(db,users.employee,first,'retire_account',{version:file(first).version,account_id:account.id,note:'الحساب يخص المؤثر الثاني'}));
  add(second,'@Creator.One');
  assert.ok(file(second).accounts.some(a=>a.handle==='@Creator.One'&&a.active));
  assert.throws(()=>db.prepare('UPDATE influencer_accounts SET active=1 WHERE id=?').run(account.id),/one influencer file in its tenant/,'the retired line does not come back beside the live one');
  assert.ok(verifyAudit(db));
});

test('INF-08 proof screenshot: the screenshot is a file on the proof itself — its recorder uploads it before verification, the count is the files actually stored, and someone outside the client team gets nothing',t=>{
  const f=fixture(t),{db,users,tx,board}=f,date=today();
  const {engagementId,view}=activeEngagement(f);
  const version=approvedVersion(db,users,{project:f.project,campaign:f.campaignId,channel:'instagram',title:'منشور الإثبات المصطنع'}).version;
  const contentId=tx(()=>addContent(db,users.employee,engagementId,{version:view('employee').version,kind:'post',title:'منشور الإثبات المصطنع',description:''})).id;
  const item=who=>board(who).engagements.find(e=>e.id===engagementId).content.find(c=>c.id===contentId);
  const cAct=(who,action,values={})=>tx(()=>contentAction(db,users[who],contentId,action,{version:item(who).version,...values}));
  cAct('employee','submit_content',{output_version_id:version});cAct('manager','approve_content',{note:'مطابق للنسخة المعتمدة'});
  cAct('employee','record_client_approval',{approver_name:'مديرة التسويق المصطنعة',channel:'email',received_on:date,reference:'بريد الموافقة محفوظ في ملف العميل بتاريخ اليوم'});
  cAct('employee','record_proof',{post_url:'https://example.invalid/proof/1',published_on:date,screenshot_reference:'لقطة الشاشة المصطنعة',disclosure_confirmed:true,disclosure_evidence:'وسم «إعلان» في أول سطر'});
  const proof=item('employee').proof;
  assert.equal(proof.attachments,0);
  tx(()=>uploadFile(db,users.employee,{entity_type:'influencer_proof',entity_id:proof.id,label:'لقطة المنشور المصطنعة',filename:'proof.png',content:PNG}));
  assert.equal(item('employee').proof.attachments,1,'the count is the file actually stored on the proof');
  const files=listFiles(db,users.manager,'influencer_proof',proof.id);
  assert.equal(files.files.length,1);
  assert.equal(downloadFile(db,users.manager,files.files[0].id).media_type,'image/png');
  assert.throws(()=>listFiles(db,users.outsider,'influencer_proof',proof.id),error=>error.status===404,'a manager of influencers outside the client team reads nothing');
  assert.equal(caught(()=>tx(()=>uploadFile(db,users.manager,{entity_type:'influencer_proof',entity_id:proof.id,label:'لقطة من غير المسجّل',filename:'other.png',content:PNG}))).status,403,'only the recorder attaches the screenshot');
  tx(()=>verifyProof(db,users.manager,proof.id,{method:'human_screenshot_review',note:'طابقت اللقطة المرفوعة مع الرابط والوسم'}));
  assert.equal(caught(()=>tx(()=>uploadFile(db,users.employee,{entity_type:'influencer_proof',entity_id:proof.id,label:'لقطة بعد التحقق',filename:'late.png',content:PNG}))).status,403,'nothing is attached after the proof is verified');
  assert.ok(verifyAudit(db));
});

