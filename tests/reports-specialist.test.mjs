import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { approveVendor, approveVendors } from './vendor-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approvedVersion } from './studio-fixture.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign } from '../app/campaigns.mjs';
import { createProject } from '../app/projects.mjs';
import { createProduction, productionsBoard, addCrew, crewAction, addTalent, addLocation, addShot, shotAction } from '../app/production.mjs';
import { createItem, createBooking, bookingAction } from '../app/equipment.mjs';
import { createInfluencer, influencerAction, influencersBoard, createEngagement, engagementAction, addContent, contentAction, verifyProof, influencerCampaignsBoard } from '../app/influencers.mjs';
import { createVendor, vendorAction, getVendor } from '../app/vendors.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { preparePayment, getOrder, paymentAction } from '../app/payables.mjs';
import { createContact, createPitch, pitchAction, createCoverage } from '../app/pr.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { createRoute, reviewAction, getRoute } from '../app/review-rounds.mjs';
import { createTemplate, generateReport, readClientReport, SECTIONS } from '../app/client-reports.mjs';
import { REPORTS, runReport, reportsIndex, snapshotAudience, exportReport } from '../app/reports.mjs';

// الحزمة 4، DOMAIN-4 — التقارير المتخصصة: الإنتاج والمعدات (R42)، وتسليم المؤثرين ومدفوعاتهم (R43)، والتغطية الإعلامية (R44)،
// وجولات المراجعة (R45). كل رقم يساوي سجله المصدر، وكل تقرير يرفض من لا يحمل تصريح وحدته، وR42 بلا أي أجر أو تكلفة، وR44 بلا
// «قيمة إعلانية». وقسما تقرير العميل الجديدان (تسليم المؤثرين والتغطية) من قراءتي R43 وR44 نفسيهما. كل البيانات مصطنعة (تجريبي).

const PASSWORD='synthetic-reports-specialist';
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const people=db=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
const iban=bban=>{const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;};
const grant=(db,who,capability)=>transaction(db,()=>grantAccess(db,people(db).admin,{user_id:who,capability,department_id:'',note:'تصريح اختبار مصطنع للتقارير المتخصصة'}));
function base(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-b','36t','creative','lead-b','مديرة حساب أخرى (تجريبي)','unused','manager',NULL)");
  return {db,tx:f=>transaction(db,f)};
}
const row=(result,key,value)=>result.rows.find(r=>r[key]===value);
// قارئ ZIP صغير للاختبار (كما في tests/reports.test.mjs): يفك كل ملف في حزمة XLSX من الدليل المركزي، فيُفحص النص لا البايتات المضغوطة.
function unzip(buffer){
  const files={},end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06])),count=buffer.readUInt16LE(end+10);let at=buffer.readUInt32LE(end+16);
  for(let i=0;i<count;i++){const size=buffer.readUInt32LE(at+20),nameLength=buffer.readUInt16LE(at+28),local=buffer.readUInt32LE(at+42),name=buffer.subarray(at+46,at+46+nameLength).toString('utf8');
    const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);files[name]=inflateRawSync(buffer.subarray(dataStart,dataStart+size)).toString('utf8');at+=46+nameLength+buffer.readUInt16LE(at+30)+buffer.readUInt16LE(at+32);}
  return files;
}

test('the specialist reports take the next free numbers R42–R45 (R13, R18 and R23 stay reserved for their catalogue reports), each is registered with an audience, and each states its definition and source',()=>{
  const keys=REPORTS.map(r=>r.key);
  assert.equal(new Set(keys).size,keys.length,'report keys are unique');
  const added=REPORTS.filter(r=>['R42','R43','R44','R45'].includes(r.key));
  assert.deepEqual(added.map(r=>r.title),['الإنتاج والمعدات','تسليم المؤثرين ومدفوعاتهم','التغطية الإعلامية','جولات المراجعة']);
  for(const r of added)assert.ok(r.definition.length>40&&r.source.length>10,r.key);
  assert.equal(keys.some(k=>['R13','R18','R23'].includes(k)),false,'gaps of the R01–R40 catalogue are not reused');
  assert.deepEqual(['R42','R43','R44','R45'].map(snapshotAudience),['uniform','creator','uniform','creator'],
    'production and coverage are tenant-wide behind their permission; influencer delivery and review rounds follow team and project membership');
  assert.deepEqual(SECTIONS.map(s=>s.key),['campaign_results','content_published','media_spend','influencer_delivery','pr_coverage','contract_progress','next_step']);
});

/* ───── R42: الإنتاج والمعدات ───── */
test('R42 production and equipment: every count equals its source records, no rate, fee or cost appears anywhere in it, and a reader without the production permission is refused',t=>{
  const {db,tx}=base(t);
  grant(db,'manager','production.manage');
  const users=people(db),vendor=approveVendor(db,'crew-freelancer'),day=today();
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تصوير مصطنع',brief:'تقرير الإنتاج والمعدات',member_ids:['employee']})).id;
  const make=(codeValue,title,from,to)=>tx(()=>createProduction(db,users.manager,{code:codeValue,title,kind:'ad',brief:'موجز مصطنع',client_id:'',campaign_id:'',project_id:project,shoot_from:from,shoot_to:to})).id;
  const shoot=make('SHOOT-01','إعلان الإنتاج المصطنع',day,addDays(day,3));
  make('SHOOT-09','إنتاج خارج الفترة المصطنع',addDays(day,40),addDays(day,41));
  const crew=values=>tx(()=>addCrew(db,users.manager,shoot,{role_key:'photographer',role_note:'',source:'internal',user_id:'employee',vendor_id:'',day_rate:'',days:'',engagement_note:'',...values})).id;
  crew({});
  crew({role_key:'director',source:'external',user_id:'',vendor_id:vendor.id,day_rate:'1750.00',days:2,engagement_note:'مستقل مصطنع بمعدل يومي'});
  const dropped=crew({role_key:'sound',source:'external',user_id:'',vendor_id:vendor.id,day_rate:'1750.00',days:1,engagement_note:'مستقل مصطنع ثانٍ'});
  tx(()=>crewAction(db,users.manager,dropped,'remove',{version:1,note:'اعتذر عن التصوير المصطنع'}));
  const talent=(name,release)=>tx(()=>addTalent(db,users.manager,shoot,{full_name:name,talent_kind:'actor',agency_vendor_id:'',contact_note:'',release_signed_on:'',release_valid_until:'',release_scope:'',release_media:'',release_storage:'',release_note:'',...release}));
  const signed=until=>({release_status:'signed',release_signed_on:day,release_valid_until:until,release_scope:'كل القنوات المصطنعة لمدة الحملة',release_storage:'مجلد التصاريح المصطنع'});
  talent('ممثل مصطنع أ',signed('2099-12-31'));
  talent('ممثل مصطنع ب',{release_status:'not_signed'});
  talent('ممثل مصطنع ج',signed(addDays(day,2)));
  const location=(name,permit)=>tx(()=>addLocation(db,users.manager,shoot,{name,address_note:'',map_link:'',contact_name:'',contact_phone:'',permit_basis:'',permit_number:'',permit_issuer:'',permit_expires_on:'',permit_storage:'',...permit}));
  location('موقع مصطنع أ',{permit_required:true,permit_basis:'يتطلب تصريحًا من جهة مصطنعة',permit_status:'pending'});
  location('موقع مصطنع ب',{permit_required:false,permit_status:'not_required'});
  location('موقع مصطنع ج',{permit_required:true,permit_basis:'يتطلب تصريحًا من جهة مصطنعة',permit_status:'obtained',permit_number:'P-1',permit_issuer:'جهة مصطنعة',permit_expires_on:'2099-01-01',permit_storage:'مجلد التصاريح المصطنع'});
  const shots=[1,2,3].map(n=>tx(()=>addShot(db,users.manager,shoot,{scene_id:'',code:'',description:`لقطة مصطنعة ${n}`,shot_size:'wide',camera_angle:'eye_level',reference_note:''})).id);
  tx(()=>shotAction(db,users.manager,shots[0],'status',{version:1,status:'shot',note:'صُوّرت في اليوم الأول'}));
  const item=name=>tx(()=>createItem(db,users.manager,{name,category:'camera',serial_no:'',condition_state:'good',condition_note:'',home_location:'مخزن تصوير مصطنع',asset_id:''})).id;
  const book=itemId=>tx(()=>createBooking(db,users.manager,{item_id:itemId,kit_id:'',project_id:'',production_id:shoot,production_ref:'',purpose:'تصوير مصطنع على الإنتاج',start_date:day,end_date:addDays(day,1),custodian_id:'employee'})).id;
  const version=id=>db.prepare('SELECT version FROM equipment_bookings WHERE id=?').get(id).version;
  const move=(who,id,action,counterpart,condition)=>tx(()=>bookingAction(db,users[who],id,action,{version:version(id),counterpart_id:counterpart,condition_state:condition,condition_note:'وصف مصطنع لحالة القطعة',acknowledgement:'أقر بالمناولة المصطنعة بحالتها الموصوفة'}));
  book(item('كاميرا مصطنعة أ'));
  const back=book(item('عدسة مصطنعة ب'));move('employee',back,'hand_out','manager','good');move('manager',back,'hand_in','employee','damaged');
  const out=book(item('إضاءة مصطنعة ج'));move('employee',out,'hand_out','manager','good');

  const period={from:day,to:addDays(day,10)},result=runReport(db,users.manager,'R42',period);
  assert.deepEqual(result.rows.map(r=>r.code),['SHOOT-01'],'only the production whose shoot days meet the period');
  const r=result.rows[0],board=productionsBoard(db,users.manager).productions.find(p=>p.id===shoot).counts;
  assert.equal(r.crew,board.crew);assert.equal(r.crew,2,'the removed freelancer is not crew');
  assert.equal(r.external_crew,board.external_crew);assert.equal(r.external_crew,1);
  assert.equal(r.shots_total,board.shots);assert.equal(r.shots_done,board.shots_done);assert.deepEqual([r.shots_done,r.shots_total],[1,3]);
  assert.equal(r.equipment_live,board.equipment_out);assert.equal(r.equipment_live,2,'one reserved, one out');
  assert.equal(r.equipment_damaged,db.prepare("SELECT COUNT(*) AS n FROM equipment_movements WHERE kind='in' AND condition_state<>'good'").get().n);assert.equal(r.equipment_damaged,1);
  assert.equal(r.releases_missing,2,'one never signed, one expiring before the period ends');
  assert.equal(r.permits_missing,1,'the pending permit; the not-required site and the valid permit do not count');
  assert.equal(r.status,'تحضير');
  // لا أجر ولا تكلفة: لا عمود مبلغ، ولا اسم حقل يشبهه، ولا رقم المعدل في أي موضع من النتيجة أو ملفاتها.
  assert.equal(result.columns.some(c=>c.type==='money'),false);
  assert.equal(result.columns.some(c=>/rate|fee|cost|pay|wage|salary|amount/i.test(c.key)),false);
  const text=JSON.stringify(result);
  assert.equal(/1750|175000/.test(text),false,'the freelancer day rate appears nowhere');
  assert.equal(/1750|175000/.test(exportReport(result,'csv').content.toString('utf8')),false,'csv');
  const sheets=unzip(exportReport(result,'xlsx').content);
  assert.ok(Object.values(sheets).some(x=>x.includes('SHOOT-01')),'the workbook was read as text');
  assert.equal(Object.values(sheets).some(x=>/1750|175000/.test(x)),false,'xlsx');
  // القارئ بلا تصريح الإنتاج لا يفتحه، ولا يراه في القائمة.
  for(const who of ['employee','hr'])assert.throws(()=>runReport(db,users[who],'R42',period),code('not_found'),who);
  assert.equal(reportsIndex(db,users.employee).reports.some(x=>x.key==='R42'),false);
  assert.ok(reportsIndex(db,users.manager).reports.some(x=>x.key==='R42'));
  assert.ok(verifyAudit(db));
});

/* ───── R43: تسليم المؤثرين ومدفوعاتهم، وقسم تقرير العميل ───── */
test('R43 influencer delivery and payments: promised, published, verified, fee, linked, paid and paid-before-proof equal their records through approval, execution and a returned transfer; the client report shows the same verified delivery with no fee or payment; outsiders are refused',t=>{
  const {db,tx}=base(t),day=today();
  // من يوثّق التحويل شخص ثالث بتفويض «post»: لا أعدّ الأمر ولا اعتمده ولا جمع بيانات الحساب.
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين صندوق مصطنع','unused','employee',NULL)");
  approveVendors(db,['supplier-b','supplier-c']);
  for(const who of ['employee','manager','lead-b'])grant(db,who,'influencers.manage');
  for(const who of ['employee','manager'])grant(db,who,'commercial.use');
  const users=people(db);
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة عميل المؤثرين التجريبية',trade_name:'عميل المؤثرين',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'منسقة المؤثرين (تجريبي)'}));
  tx(()=>createClient(db,users['lead-b'],{legal_name:'شركة عميل آخر تجريبية',trade_name:'عميل آخر',sector:'مطاعم',status:'active'}));
  const campaignId=tx(()=>createCampaign(db,users.employee,{client_id:clientId,name:'حملة المؤثرين التجريبية',objective:'تعريف الجمهور بالمنتج عبر صناع محتوى مصطنعين',
    channels:['instagram'],targets:[{metric:'مشاهدات',target:100000,unit:'مشاهدة'}],media_budget:'0',budget_reference:'',start_date:day,end_date:addDays(day,30)})).id;
  const influencerId=tx(()=>createInfluencer(db,users.employee,{stage_name:'مؤثرة تجريبية للتقرير',category:'food',contact_mode:'agency',agency_name:'وكالة مصطنعة',contact_name:'وكيل مصطنع',contact_channel:'agent@example.invalid',notes:''})).id;
  const person=()=>influencersBoard(db,users.employee).influencers.find(x=>x.id===influencerId);
  tx(()=>influencerAction(db,users.employee,influencerId,'set_status',{version:person().version,status:'active',note:'اكتمل الملف وجهة التواصل'}));
  const engagementId=tx(()=>createEngagement(db,users.employee,{influencer_id:influencerId,client_id:clientId,campaign_id:campaignId,title:'ارتباط إطلاق المنتج التجريبي',brief:'',
    posts_count:2,stories_count:1,videos_count:0,fee:'5000.00',starts_on:day,ends_on:addDays(day,20),cancellation_terms:'الإلغاء قبل سبعة أيام بلا مقابل، وبعدها نصف الأتعاب',
    disclosure_requirement:'يظهر وسم «إعلان» في أول سطر',usage_scope:'organic_only',usage_from:day,usage_until:addDays(day,60),usage_terms:'استخدام عضوي على حسابات المؤثرة فقط خلال المدة'})).id;
  // مشروع لعمل الاستوديو الذي تُعتمد منه نسخ مسودات المؤثرة (الترحيل 189).
  const studioProject=tx(()=>createProject(db,users.manager,{name:'مشروع مخرجات المؤثرين المصطنع',brief:'نسخ معتمدة لمسودات المؤثرة',member_ids:['employee','outsider']})).id;
  const view=who=>influencerCampaignsBoard(db,users[who]).engagements.find(e=>e.id===engagementId);
  const eAct=(who,action,values={})=>tx(()=>engagementAction(db,users[who],engagementId,action,{version:view(who).version,...values}));
  eAct('employee','request_review');
  eAct('manager','approve_engagement',{note:'راجعت المخرجات وحقوق الاستخدام وشروط الإلغاء',licence_ack:'لا رخصة مسجلة للمؤثرة. أتحمل مسؤولية المضي، وأحلت الأمر للمختص القانوني للتأكيد'});
  const publish=(n,verify)=>{
    const contentId=tx(()=>addContent(db,users.employee,engagementId,{version:view('employee').version,kind:'post',title:`منشور تجريبي ${n}`,description:''})).id;
    const item=who=>view(who).content.find(c=>c.id===contentId),cAct=(who,action,values={})=>tx(()=>contentAction(db,users[who],contentId,action,{version:item(who).version,...values}));
    const bound=approvedVersion(db,users,{project:studioProject,campaign:campaignId,title:`مسودة المؤثرة المعتمدة ${n}`});
    cAct('employee','submit_content',{output_version_id:bound.version});cAct('manager','approve_content',{note:'مطابق للبريف ويحمل وسم الإعلان'});
    cAct('employee','record_client_approval',{approver_name:'مديرة التسويق المصطنعة',channel:'email',received_on:day,reference:'بريد الموافقة محفوظ في ملف العميل بتاريخ اليوم'});
    cAct('employee','record_proof',{post_url:`https://example.invalid/p/${n}`,published_on:day,screenshot_reference:'لقطة الشاشة المصطنعة محفوظة في ملف الحملة',disclosure_confirmed:true,disclosure_evidence:'وسم «إعلان» في أول سطر من النص'});
    if(verify)tx(()=>verifyProof(db,users.manager,item('manager').proof.id,{method:'human_open_link',note:'فتحت الرابط وطابقت النص والوسم واللقطة'}));
  };
  publish(1,true);publish(2,false);
  // المسار المالي القائم: المؤثرة مورد مؤهل بحساب متحقق منه، ثم مستحق مطابَق، ثم أمر دفع يُربط بالارتباط قبل اعتماده.
  const finance=(who,actions)=>{for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مدفوعات مصطنع',null,now());};
  finance('employee',['read','prepare']);finance('manager',['read','approve']);finance('treasurer',['read','post']);
  for(const who of ['employee','outsider'])grant(db,who,'vendors.manage');
  grant(db,'hr','vendors.bank');
  const vendorId=tx(()=>createVendor(db,users.employee,{legal_name:'مؤثرة تجريبية للتقرير للخدمات الإعلانية',entity_type:'individual',country:'SA',categories:['influencers'],data_source:'نموذج تسجيل مصطنع',supplier_key:'supplier-a'})).id;
  const vAct=(who,action,values={})=>tx(()=>vendorAction(db,users[who],vendorId,action,{version:getVendor(db,users[who],vendorId).version,...values}));
  vAct('employee','add_contact',{name:'وكيل مصطنع',role:'وكيل أعمال',email:'agent@example.invalid',phone:''});
  vAct('employee','submit');
  vAct('outsider','propose_bank',{bank_name:'بنك مصطنع',account_holder:'مؤثرة تجريبية للتقرير',iban:iban('80000000000000000011'),reason:'تسجيل حساب الدفع الأول للمورد'});
  vAct('hr','verify_bank',{bank_id:getVendor(db,users.hr,vendorId).bank[0].id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق للاسم',effective_from:day});
  for(const [kind,who] of [['duplicate','outsider'],['procurement','outsider'],['technical','manager'],['finance','hr']])vAct(who,'review_'+kind,{decision:'passed',note:'اجتاز المراجعة المصطنعة'});
  vAct('outsider','approve',{outcome:'conditional',reason:'اعتماد مشروط بمدة حتى استكمال وثيقة العمل الحر',valid_until:addDays(day,90),condition_note:'يُستكمل إثبات العمل الحر قبل انتهاء المدة'});
  tx(()=>influencerAction(db,users.employee,influencerId,'link_vendor',{version:person().version,vendor_id:vendorId,note:'ملف المورد نفسه للمؤثرة'}));
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع مؤثرين مصطنع',brief:'تقرير المؤثرين',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const pAct=(p,who,action,values={})=>tx(()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=tx(()=>createPurchase(db,users.employee,{project_id:project.id,title:'أتعاب مؤثرة مصطنعة',specification:'منشوران وقصة ضمن حملة الإطلاق المصطنعة',cost_center:'SYNTHETIC-CC-1',
    due_date:'2099-10-20',quantity:1,unit:'ارتباط',budget_amount:'6000.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
  p=pAct(p,'employee','submit');
  for(const [key,price] of [['supplier-a','5000.00'],['supplier-b','5100.00'],['supplier-c','5200.00']])
    p=pAct(p,'employee','add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد النشر والتحقق',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  p=pAct(p,'manager','award',{quote_id:p.quotes.find(q=>q.supplier_key==='SUPPLIER-A').id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
  p=pAct(p,'manager','approve_order',{terms:'ارتباط واحد بعد الاعتماد',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
  p=pAct(p,'manager','commence',{start_on:day,valid_until:'2099-12-31',site_or_channel:'حساب المؤثرة المصطنع',scope_confirmation:'أذنّا بالنشر على النطاق المعتمد في الأمر الداخلي',evidence:'رسالة إذن النشر المرسلة للمؤثرة وردّها بالاستلام'});
  p=pAct(p,'employee','receive',{quantity:1,reference:'receipt-1',evidence:'استلمنا المخرجات وفق المتفق عليه'});
  p=pAct(p,'employee','record_invoice',{supplier_reference:'inv-900',quantity:1,amount:'5000.00',evidence:'فاتورة المؤثرة المصطنعة بقيمة 5000 ريال'});
  p=pAct(p,'manager','match',{invoice_id:p.invoices[0].id,note:'طابقنا الأمر والاستلام والفاتورة'});
  const orderId=tx(()=>preparePayment(db,users.employee,{payable_id:p.payables[0].id})).id;
  eAct('manager','link_payment',{payment_order_id:orderId,basis:'دفعة الأتعاب كاملة بحسب الاتفاق المصطنع',exception_note:'يُدفع قبل اكتمال إثبات النشر لارتباط الموعد بالعقد، وأتحمل القرار وأبلغت مسؤول الحساب'});
  const period={from:addDays(day,-1),to:day},r43=who=>runReport(db,users[who],'R43',period);
  const expect=(paid,label)=>{
    const r=row(r43('employee'),'influencer','مؤثرة تجريبية للتقرير'),g=view('employee');
    assert.equal(r.promised,g.deliverables.reduce((n,d)=>n+d.promised,0),label);assert.equal(r.promised,3);
    assert.equal(r.published,g.deliverables.reduce((n,d)=>n+d.published,0));assert.equal(r.published,2);
    assert.equal(r.verified,g.deliverables.reduce((n,d)=>n+d.verified,0));assert.equal(r.verified,1);
    assert.equal(r.fee*100,g.fee_minor);
    assert.equal(r.linked*100,g.payments.reduce((n,x)=>n+x.amount_minor,0));assert.equal(r.linked,5000);
    assert.equal(r.paid,paid,label);
    assert.equal(r.paid_before_proof,g.payments.filter(x=>x.proof_state==='written_exception').length);assert.equal(r.paid_before_proof,1);
    assert.equal(r.client,'عميل المؤثرين');assert.equal(r.campaign,'حملة المؤثرين التجريبية');
  };
  expect(0,'a pending order is linked, not paid');
  tx(()=>paymentAction(db,users.manager,orderId,'approve_order',{version:getOrder(db,users.manager,orderId).version,note:'اعتماد الدفعة بعد الاطلاع على أساسها'}));
  expect(0,'an approved order is still not paid');
  tx(()=>paymentAction(db,users.treasurer,orderId,'record_execution',{version:getOrder(db,users.treasurer,orderId).version,executed_on:day,bank_reference:'TRX-SYN-0001',evidence:'إشعار تنفيذ بنكي مصطنع محفوظ في ملف الدفع'}));
  expect(5000,'an executed transfer is paid');
  tx(()=>paymentAction(db,users.treasurer,orderId,'record_return',{version:getOrder(db,users.treasurer,orderId).version,returned_on:day,bank_reference:'RET-SYN-0001',credited:'5000.00',reason:'رجع التحويل لخطأ في اسم المستفيد المصطنع',evidence:'إشعار مرتجع بنكي مصطنع محفوظ'}));
  expect(0,'a returned transfer is no longer paid');
  // تقرير العميل: قسم تسليم المؤثرين من القراءة نفسها — المنشور المتحقق منه مقابل المتعاقد عليه، بلا أتعاب ولا دفعات.
  const template=tx(()=>createTemplate(db,users.manager,{client_id:clientId,name:'تقرير المؤثرين التجريبي',cadence:'monthly',sections:['influencer_delivery','next_step']})).id;
  const reportId=tx(()=>generateReport(db,users.employee,{template_id:template,period_start:period.from,period_end:period.to,title:'تقرير المؤثرين التجريبي',supersedes_id:''})).id;
  const body=readClientReport(db,users.employee,reportId).body,group=body.sections.find(s=>s.key==='influencer_delivery').groups[0];
  assert.equal(group.title,'مؤثرة تجريبية للتقرير — ارتباط إطلاق المنتج التجريبي');
  const post=group.figures.find(f=>f.label.startsWith('منشور')),story=group.figures.find(f=>f.label.startsWith('قصة'));
  assert.equal(post.value,row(r43('employee'),'influencer','مؤثرة تجريبية للتقرير').verified,'the client report equals R43: verified delivery only');
  assert.match(post.label,/من 2/);assert.match(post.source,/example\.invalid\/p\/1/);assert.doesNotMatch(post.source,/p\/2/,'an unverified post is not presented to the client as delivered');
  assert.equal(story.type,'none');assert.equal(story.value,null,'no proof is not a zero');
  assert.equal(/5000|500000|written_exception/.test(JSON.stringify(body)),false,'what we pay the influencer never reaches the client');
  // من لا يحمل تصريح المؤثرين لا يفتحه؛ ومن يحمله في فريق عميل آخر، أو في غير فريق، يفتحه ولا يرى ارتباطات غيره — كشاشة الارتباطات.
  for(const who of ['outsider','hr'])assert.throws(()=>r43(who),code('not_found'),who);
  assert.deepEqual(r43('lead-b').rows,[]);
  grant(db,'outsider','influencers.manage');
  assert.deepEqual(r43('outsider').rows,[]);assert.equal(influencerCampaignsBoard(db,people(db).outsider).engagements.length,0,'the same empty view as the engagements board');
  assert.ok(verifyAudit(db));
});

/* ───── R44: التغطية الإعلامية، وقسم تقرير العميل ───── */
test('R44 PR coverage: rows and tone counts equal the coverage recorded in the period, no advertising-value equivalent or any money appears, the client report shows the same coverage for its client, and a reader without the PR permission is refused',t=>{
  const {db,tx}=base(t),day=today();
  for(const who of ['employee','manager'])grant(db,who,'pr.manage');
  for(const who of ['employee','manager'])grant(db,who,'commercial.use');
  const users=people(db);
  const clientA=tx(()=>createClient(db,users.manager,{legal_name:'شركة عميل التغطية التجريبية',trade_name:'عميل التغطية',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientA,'add_member',{user_id:'employee',role:'منسقة العلاقات العامة (تجريبي)'}));
  const clientB=tx(()=>createClient(db,users['lead-b'],{legal_name:'شركة عميل آخر تجريبية',trade_name:'عميل آخر',sector:'مطاعم',status:'active'})).id;
  const contact=tx(()=>createContact(db,users.employee,{name:'محرر مصطنع',role_title:'محرر',outlet:'صحيفة مصطنعة',outlet_type:'digital',beats:['اقتصاد'],language:'ar',preferences:'',email:'',phone:'',
    lawful_basis:'public_professional_source',basis_note:'بيانات تواصل مهنية معلنة في موقع الوسيلة المصطنعة',collected_on:day,source:'موقع الوسيلة المصطنع'})).id;
  const pitch=(sent,subject)=>tx(()=>createPitch(db,users.employee,{contact_id:contact,list_id:'',client_id:clientA,campaign_id:'',subject,angle:'زاوية خبرية مصطنعة عن إطلاق المنتج',sent_on:sent,sent_via:'بريد الموظف'})).id;
  const published=pitch(addDays(day,-3),'خبر الإطلاق المصطنع'),declined=pitch(addDays(day,-2),'مقابلة مصطنعة');pitch(addDays(day,-30),'خبر قديم مصطنع');
  tx(()=>pitchAction(db,users.employee,published,'published',{version:1,outcome_on:addDays(day,-2),note:'نُشر الخبر في الوسيلة المصطنعة'}));
  tx(()=>pitchAction(db,users.employee,declined,'decline',{version:1,outcome_on:addDays(day,-1),note:'اعتذرت الوسيلة عن المقابلة'}));
  const coverage=(n,values)=>tx(()=>createCoverage(db,users.employee,{pitch_id:'',contact_id:'',client_id:'',campaign_id:'',outlet:'صحيفة مصطنعة',outlet_type:'digital',title:`تغطية مصطنعة ${n}`,
    url:`https://example.invalid/news/${n}`,published_on:day,tone:'neutral',tone_reason:'تقدير مصطنع من سجّل التغطية',highlight:false,highlight_reason:'',summary:'',...values}));
  coverage(1,{client_id:clientA,published_on:addDays(day,-2),tone:'positive',highlight:true,highlight_reason:'أبرز تغطية مصطنعة في الفترة'});
  coverage(2,{client_id:clientA,outlet:'مجلة مصطنعة',outlet_type:'print',published_on:addDays(day,-1),tone:'negative'});
  coverage(3,{client_id:clientB,outlet:'قناة مصطنعة',outlet_type:'broadcast',published_on:addDays(day,-1)});
  coverage(4,{outlet:'بودكاست مصطنع',outlet_type:'podcast',tone:'positive'});
  coverage(5,{client_id:clientA,published_on:addDays(day,-40),tone:'positive'});
  const period={from:addDays(day,-7),to:day},result=runReport(db,users.employee,'R44',period);
  const recorded=db.prepare('SELECT title,tone FROM pr_coverage WHERE published_on BETWEEN ? AND ? ORDER BY published_on,id').all(period.from,period.to);
  assert.deepEqual(result.rows.map(r=>r.title).sort(),recorded.map(r=>r.title).sort(),'rows are the coverage recorded in the period, the older one excluded');
  assert.equal(result.rows.length,4);
  assert.deepEqual(result.rows.map(r=>[r.title,r.client,r.tone,r.highlight]).sort(),[['تغطية مصطنعة 1','عميل التغطية','إيجابية','نعم'],['تغطية مصطنعة 2','عميل التغطية','سلبية',''],['تغطية مصطنعة 3','عميل آخر','محايدة',''],['تغطية مصطنعة 4','','إيجابية','']]);
  assert.match(result.notes[0],/4 تغطية: 2 إيجابية، و1 محايدة، و1 سلبية/);
  assert.match(result.notes[1],/المرسلة في الفترة 2: رُدّ على 0، ورُفضت 1، ونُشرت 1/);
  // لا «قيمة إعلانية» ولا أي مبلغ: لا عمود مال، ولا حقل يحمل قيمة أو وصولًا، ولا إجمالي.
  assert.equal(result.columns.some(c=>c.type!=='text'),false);
  assert.equal(result.columns.some(c=>/value|ave|equivalen|reach|impression|money|amount/i.test(c.key)),false);
  assert.deepEqual(result.totals,{});
  // تقرير العميل: قسم التغطية لعميله فقط، من القراءة نفسها.
  const template=tx(()=>createTemplate(db,users.manager,{client_id:clientA,name:'تقرير التغطية التجريبي',cadence:'monthly',sections:['pr_coverage','next_step']})).id;
  const reportId=tx(()=>generateReport(db,users.employee,{template_id:template,period_start:period.from,period_end:period.to,title:'تقرير التغطية التجريبي',supersedes_id:''})).id;
  const groups=readClientReport(db,users.employee,reportId).body.sections.find(s=>s.key==='pr_coverage').groups;
  const mine=result.rows.filter(r=>r.client==='عميل التغطية');
  const byType=Object.fromEntries(groups[0].figures.map(f=>[f.label,f.value]));
  assert.deepEqual(byType,{'رقمي — عدد التغطيات':1,'مطبوع — عدد التغطيات':1});
  assert.equal(groups[0].figures.reduce((n,f)=>n+f.value,0),mine.length,'the client report counts what R44 lists for that client');
  assert.deepEqual(Object.fromEntries(groups[1].figures.map(f=>[f.label,f.value])),{'تغطية إيجابية':1,'تغطية سلبية':1});
  assert.equal(/محرر مصطنع|تغطية مصطنعة 3|تغطية مصطنعة 5/.test(JSON.stringify(groups)),false,'no journalist, no other client, nothing outside the period');
  for(const who of ['hr','outsider'])assert.throws(()=>runReport(db,users[who],'R44',period),code('not_found'),who);
  assert.ok(verifyAudit(db));
});

/* ───── R45: جولات المراجعة ───── */
const brief={objective:'هدف تجريبي قابل للمراجعة',audience:'جمهور مصطنع للمشروع',audience_basis:'افتراض محلي معلن؛ لم يجر بحث ميداني',message:'رسالة الاختبار المعتمدة',prohibited_messages:'منع الادعاءات غير المسندة',kpi:'عدد استكمال نموذج الاهتمام',measurement_source:'سجل تجريبي محلي',channels:['instagram'],scope:'مخرج نصي واحد للاختبار'};
const output=(assetId,content='محتوى عربي مصطنع للمراجعة.')=>({title:'منشور الإطلاق المصطنع',channel:'instagram',format:'نص تجريبي',dimensions:'مربع موصوف 1080×1080',language:'العربية',brand_reference:'ATHAR-DEMO',acceptance:'مطابقة الرسالة',content,asset_ids:[assetId]});
test('R45 review rounds: one row per round opened in the period with its stages, decisions, overdue stages and open comments equal to the route records; a reviewer outside the project sees none, and a reader without the review permission is refused',t=>{
  const {db,tx}=base(t),day=today();
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('creative-lead','36t','creative','creative-lead','قائد إبداعي تجريبي','unused','pm','manager'),('account-lead','36t','creative','account-lead','مدير حساب تجريبي','unused','pm','manager'),
    ('file-owner','36t','creative','file-owner','مالكة ملف تجريبية','unused','pm','manager')`);
  for(const who of ['employee','manager','creative-lead','account-lead','file-owner','outsider'])grant(db,who,'review.manage');
  const users=people(db);
  const project=tx(()=>createProject(db,users.manager,{name:'حساب عميل مصطنع للمراجعة',brief:'تقرير جولات المراجعة',member_ids:['employee','creative-lead','account-lead','file-owner']}));
  const act=(who,s,action,input={})=>tx(()=>studioAction(db,users[who],s.id,action,{version:s.version,...input}));
  let s=tx(()=>createStudio(db,users.employee,{project_id:project.id,title:'مساحة تسليم مصطنعة',...brief}));
  s=act('manager',act('employee',s,'submit_brief'),'approve_brief',{note:'راجعنا الهدف والرسالة'});
  s=act('employee',s,'add_asset',{name:'أصل نصي مصطنع',internal_reference:'ASSET_1',rights_holder:'صاحب حق مصطنع',rights_basis:'owned',rights_evidence:'إفادة ملكية داخلية مصطنعة',valid_from:'2020-01-01',valid_until:'2099-12-31',channels:['instagram']});
  s=act('manager',s,'inspect_asset',{asset_id:s.assets[0].id,outcome:'passed',evidence:'إفادة فحص الحقوق والقنوات والمدة'});
  s=act('employee',s,'create_output',output(s.assets[0].id));
  const outputId=s.outputs[0].id,assetId=s.assets[0].id,first=s.outputs[0].current_version_id;
  const open=(versionId,stages)=>tx(()=>createRoute(db,users.employee,{output_version_id:versionId,name:'جولة مراجعة مصطنعة',owner_id:'file-owner',template_id:'',stages})).id;
  const run=(who,routeId,action,input={})=>tx(()=>reviewAction(db,users[who],routeId,action,{version:getRoute(db,users[who],routeId).version,...input}));
  const one=open(first,[{position:1,name:'إبداعي',audience:'internal',reviewer_ids:['creative-lead'],due_days:3,reminder_days:null,escalation_days:null},
    {position:2,name:'مدير الحساب',audience:'internal',reviewer_ids:['account-lead'],due_days:null,reminder_days:null,escalation_days:null}]);
  run('creative-lead',one,'decide',{stage_id:getRoute(db,users['creative-lead'],one).stages[0].id,decision:'changes_required',note:'الصياغة تحتاج إعادة عمل قبل المتابعة'});
  s=tx(()=>studioAction(db,users.employee,s.id,'save_output',{version:db.prepare('SELECT version FROM studio_workspaces WHERE id=?').get(s.id).version,output_id:outputId,...output(assetId,'محتوى عربي مصطنع بعد التعديل الأول.')}));
  const two=open(s.outputs[0].current_version_id,[{position:1,name:'إبداعي',audience:'internal',reviewer_ids:['creative-lead'],due_days:2,reminder_days:null,escalation_days:null}]);
  run('employee',two,'add_media',{kind:'text',label:'النص المعروض للمراجعة',body:'السطر الأول من النص الخاضع للمراجعة. السطر الثاني يحتاج تعديلًا.'});
  const mediaId=getRoute(db,users.employee,two).media[0].id;
  for(const [visibility,start] of [['internal',0],['shared',20]])run('creative-lead',two,'annotate',{media_id:mediaId,visibility,body:'ملاحظة مراجعة مصطنعة على الموضع',char_start:start,char_end:start+10});

  const period={from:day,to:addDays(day,30)},result=runReport(db,users.employee,'R45',period);
  assert.equal(result.rows.length,2,'two rounds: one per output version reviewed');
  const [r1,r2]=[...result.rows].sort((a,b)=>a.revision-b.revision),g1=getRoute(db,users.employee,one),g2=getRoute(db,users.employee,two);
  assert.deepEqual([r1.revision,r1.status,r1.opened,r1.closed,r1.days],[1,'تعديلات مطلوبة',day,day,0]);
  assert.equal(r1.stages_total,g1.stages.length);assert.equal(r1.stages_decided,g1.stages.filter(x=>x.status==='decided').length);assert.deepEqual([r1.stages_decided,r1.stages_total],[1,2]);
  assert.equal(r1.changes_required,g1.stages.filter(x=>x.decision?.decision==='changes_required').length);assert.equal(r1.changes_required,1);
  assert.deepEqual([r2.revision,r2.status,r2.closed,r2.days],[2,'جارٍ','',null]);
  assert.equal(r2.open_comments,g2.counts.open);assert.equal(r2.open_comments,2,'internal and shared comments alike, never their text');
  assert.equal(r2.overdue,0,'a due date that has not come is not late, even when the period runs past it');
  assert.equal(JSON.stringify(result).includes('ملاحظة مراجعة مصطنعة'),false);
  // بعد موعد المرحلة المفتوحة: تُعدّ متأخرة.
  t.mock.timers.enable({apis:['Date'],now:Date.now()+12*86400000});
  assert.equal(row(runReport(db,users.employee,'R45',period),'revision',2).overdue,g2.stages.filter(x=>x.status==='open'&&x.due_on).length);
  assert.equal(row(runReport(db,users.employee,'R45',period),'revision',2).overdue,1);
  t.mock.timers.reset();
  // العزل عزل الشاشة: مراجِع خارج المشروع لا يرى جولاته، ومن بلا التصريح لا يفتح التقرير.
  assert.deepEqual(runReport(db,users.outsider,'R45',period).rows,[]);
  for(const who of ['hr','it'])assert.throws(()=>runReport(db,users[who],'R45',period),code('not_found'),who);
  assert.ok(verifyAudit(db));
});
