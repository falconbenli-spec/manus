import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { registerApprover, recordApproval } from '../app/client-approvals.mjs';
import { reviewBoard, getRoute, createRoute, reviewAction, annotationAction, clientPack, previewMedia, DECISIONS } from '../app/review-rounds.mjs';
import { reviewRoundsUI, annotationsUI } from '../app/static/review-rounds-ui.mjs';

const code=value=>error=>error.code===value;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const helpers={e:escape,button:(action,id,label)=>`<button data-operation="${escape(action)}" data-id="${escape(id)}">${escape(label)}</button>`,money:x=>String(x)};
const brief={objective:'هدف تجريبي قابل للمراجعة',audience:'جمهور مصطنع للمشروع',audience_basis:'افتراض محلي معلن؛ لم يجر بحث ميداني',message:'رسالة الاختبار المعتمدة',prohibited_messages:'منع الادعاءات غير المسندة',kpi:'عدد استكمال نموذج الاهتمام',measurement_source:'سجل تجريبي محلي',channels:['instagram'],scope:'مخرج نصي واحد للاختبار'};
const output=assetId=>({title:'منشور الإطلاق المصطنع',channel:'instagram',format:'نص تجريبي',dimensions:'مربع موصوف 1080×1080',language:'العربية',brand_reference:'ATHAR-DEMO',acceptance:'مطابقة الرسالة',content:'محتوى عربي مصطنع للمراجعة.',asset_ids:[assetId]});
const quality={brand:'passed',language:'passed',claims:'passed',accessibility:'passed',specification:'passed'};
// صورة PNG صغيرة مصطنعة بتوقيع محتوى صحيح.
const png=()=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic-png-body-for-tests')]).toString('base64');
const reviewText='السطر الأول من النص الخاضع للمراجعة. السطر الثاني يحتاج تعديلًا في صياغته.';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-review-rounds');t.after(()=>db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('creative-lead','36t','creative','creative-lead','قائد إبداعي تجريبي','unused-test-hash','pm','manager'),
    ('account-lead','36t','creative','account-lead','مدير حساب تجريبي','unused-test-hash','pm','manager'),
    ('file-owner','36t','creative','file-owner','مالكة ملف تجريبية','unused-test-hash','pm','manager')`);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const uid of ['employee','manager','creative-lead','account-lead','file-owner','outsider'])
    transaction(db,()=>grantAccess(db,users.admin,{user_id:uid,capability:'review.manage',department_id:'',note:'اختبار مسارات المراجعة'}));
  const project=transaction(db,()=>createProject(db,users.manager,{name:'حساب عميل مصطنع',brief:'اختبار جولات المراجعة',member_ids:['employee','creative-lead','account-lead','file-owner']}));
  const act=(who,s,action,input={})=>transaction(db,()=>studioAction(db,users[who],s.id,action,{version:s.version,...input}));
  let s=transaction(db,()=>createStudio(db,users.employee,{project_id:project.id,title:'مساحة تسليم مصطنعة',...brief}));
  s=act('manager',act('employee',s,'submit_brief'),'approve_brief',{note:'راجعنا الهدف والرسالة'});
  s=act('employee',s,'add_asset',{name:'أصل نصي مصطنع',internal_reference:'ASSET_1',rights_holder:'صاحب حق مصطنع',rights_basis:'owned',rights_evidence:'إفادة ملكية داخلية مصطنعة',valid_from:'2020-01-01',valid_until:'2099-12-31',channels:['instagram']});
  s=act('manager',s,'inspect_asset',{asset_id:s.assets[0].id,outcome:'passed',evidence:'إفادة فحص الحقوق والقنوات والمدة'});
  s=act('employee',s,'create_output',output(s.assets[0].id));
  const studio={id:s.id,outputId:s.outputs[0].id,assetId:s.assets[0].id,versionId:s.outputs[0].current_version_id};
  // نسخة ثانية معتمدة داخليًا: تُستعمل في اختبار «التراجع قرار جديد على نسخة جديدة» وفي المقارنة.
  const nextVersion=()=>{
    let w=transaction(db,()=>studioAction(db,users.employee,s.id,'save_output',{version:latest().version,output_id:studio.outputId,...output(studio.assetId),content:'محتوى عربي مصطنع بعد التعديل الأول.'}));
    s=w;return w.outputs[0].current_version_id;
  };
  const latest=()=>db.prepare('SELECT * FROM studio_workspaces WHERE id=?').get(s.id);
  // اعتماد النسخة داخليًا في الاستوديو: شرط توثيق أي موافقة عميل عليها.
  const approveInStudio=()=>{s=act('manager',act('employee',s,'submit_output',{output_id:studio.outputId}),'approve_output',{output_id:studio.outputId,note:'اجتازت النسخة فحوص الجودة',quality_checks:quality});};
  const open=(versionId=studio.versionId,stages=null,extra={})=>transaction(db,()=>createRoute(db,users.employee,{
    output_version_id:versionId,name:'مسار مراجعة مصطنع',owner_id:'file-owner',template_id:'',
    stages:stages??[{position:1,name:'إبداعي',audience:'internal',reviewer_ids:['creative-lead'],due_days:3,reminder_days:1,escalation_days:2},
      {position:2,name:'مدير الحساب',audience:'internal',reviewer_ids:['account-lead'],due_days:2,reminder_days:null,escalation_days:null}],...extra})).id;
  const run=(who,routeId,action,input={})=>transaction(db,()=>reviewAction(db,users[who],routeId,action,{version:getRoute(db,users[who],routeId).version,...input}));
  return {db,users,project,studio,open,run,nextVersion,latest,approveInStudio};
}

test('a review route runs its stages in order: parallel stages at the same position open together, the next position opens only when all of them are decided, and three decisions exist — not two',t=>{
  const {db,users,open,run}=fixture(t);
  assert.deepEqual(Object.keys(DECISIONS).sort(),['approved','approved_with_changes','changes_required']);
  const routeId=open(undefined,[
    {position:1,name:'إبداعي',audience:'internal',reviewer_ids:['creative-lead'],due_days:3,reminder_days:1,escalation_days:2},
    {position:1,name:'جودة اللغة',audience:'internal',reviewer_ids:['account-lead'],due_days:3,reminder_days:null,escalation_days:null},
    {position:2,name:'مالك الملف',audience:'internal',reviewer_ids:['file-owner'],due_days:2,reminder_days:null,escalation_days:null}]);
  const state=who=>getRoute(db,users[who],routeId);
  const stageNamed=(who,name)=>state(who).stages.find(s=>s.name===name);
  assert.deepEqual(state('employee').stages.map(s=>s.status),['open','open','waiting'],'both stages of position 1 start together; position 2 waits');
  assert.ok(stageNamed('creative-lead','إبداعي').due_on,'a stage with an agreed period carries a working-day due date');
  assert.equal(stageNamed('account-lead','جودة اللغة').due_note,null);
  run('creative-lead',routeId,'decide',{stage_id:stageNamed('creative-lead','إبداعي').id,decision:'approved',note:'الاتجاه الإبداعي مقبول كما هو'});
  assert.equal(stageNamed('employee','مالك الملف').status,'waiting','one decision of a parallel pair does not advance the route');
  run('account-lead',routeId,'decide',{stage_id:stageNamed('account-lead','جودة اللغة').id,decision:'approved_with_changes',note:'امضِ في التنفيذ مع تصحيح صياغة الجملة الثانية'});
  assert.equal(stageNamed('employee','مالك الملف').status,'open','the next position opens by itself once the parallel pair is complete');
  run('file-owner',routeId,'decide',{stage_id:stageNamed('file-owner','مالك الملف').id,decision:'approved',note:'معتمد بعد استيفاء ملاحظات المرحلة السابقة'});
  const closed=state('employee');
  assert.equal(closed.status,'approved_with_changes','one approval with changes carries through to the route outcome');
  assert.equal(closed.stages.find(s=>s.name==='جودة اللغة').decision.meaning,'امضِ في التنفيذ مع الالتزام بالملاحظات المسجلة.');
  assert.ok(verifyAudit(db));
});

test('a decision belongs to one version: the author never decides, a decision is never edited, and reversing it needs a new version with its own route',t=>{
  const {db,users,studio,open,run,nextVersion}=fixture(t);
  const routeId=open();
  const stage=who=>getRoute(db,users[who],routeId).stages[0];
  assert.throws(()=>run('employee',routeId,'decide',{stage_id:stage('employee').id,decision:'approved',note:'أعتمد عملي بنفسي'}),code('action_unavailable'));
  run('creative-lead',routeId,'decide',{stage_id:stage('creative-lead').id,decision:'changes_required',note:'الصياغة تحتاج إعادة عمل قبل المتابعة'});
  assert.throws(()=>db.prepare("UPDATE review_decisions SET decision='approved' WHERE 1").run(),/final/);
  assert.throws(()=>db.prepare('DELETE FROM review_decisions WHERE 1').run(),/retained/);
  assert.throws(()=>run('creative-lead',routeId,'decide',{stage_id:stage('creative-lead').id,decision:'approved',note:'تراجعت عن قراري'}),code=>['action_unavailable','stage_closed'].includes(code.code));
  assert.throws(()=>open(studio.versionId),code('route_exists'),'one version carries one route');
  const second=nextVersion();
  // معدّ النسخة ليس مراجعًا لها، لا في التخطيط ولا عند القرار.
  assert.throws(()=>open(second,[{position:1,name:'ذاتي',audience:'internal',reviewer_ids:['employee'],due_days:null,reminder_days:null,escalation_days:null}]),code('separation_of_duties'));
  const reversal=open(second);
  assert.notEqual(reversal,routeId,'the reversal is a fresh decision on a fresh version, not an edit of the old one');
  assert.ok(verifyAudit(db));
});

test('changes_required stops the route at once and cancels what is left; nothing downstream is silently treated as decided',t=>{
  const {db,users,open,run}=fixture(t);
  const routeId=open();
  const before=getRoute(db,users.employee,routeId);
  run('creative-lead',routeId,'decide',{stage_id:before.stages[0].id,decision:'changes_required',note:'النسخة تحتاج تعديلًا جوهريًا قبل أي مرحلة تالية'});
  const after=getRoute(db,users.employee,routeId);
  assert.equal(after.status,'changes_required');
  assert.deepEqual(after.stages.map(s=>s.status),['decided','cancelled']);
  assert.equal(after.stages[1].decision,null,'a cancelled stage has no decision attributed to it');
  assert.deepEqual(after.actions,['save_template'].filter(a=>after.actions.includes(a)),'a closed route offers no further review work');
  assert.ok(verifyAudit(db));
});

test('an internal annotation never reaches the client: the separation is enforced in the query, not in the screen',t=>{
  const {db,users,open,run}=fixture(t);
  const routeId=open();
  run('employee',routeId,'add_media',{kind:'text',label:'النص المعروض للمراجعة',body:reviewText});
  const mediaId=getRoute(db,users.employee,routeId).media[0].id;
  run('creative-lead',routeId,'annotate',{media_id:mediaId,visibility:'internal',body:'ملاحظة داخلية: العميل تجاوز الميزانية سابقًا، لا تذكر هذا له',char_start:0,char_end:12});
  run('creative-lead',routeId,'annotate',{media_id:mediaId,visibility:'shared',body:'نقترح تعديل الجملة الثانية لتصبح أوضح',char_start:40,char_end:60});
  const internalBody='ملاحظة داخلية: العميل تجاوز الميزانية سابقًا، لا تذكر هذا له';
  const pack=clientPack(db,users['account-lead'],routeId);
  assert.equal(pack.shared_annotations.length,1);
  assert.equal(JSON.stringify(pack).includes(internalBody),false,'not one character of an internal note appears in what may reach the client');
  const internalIds=new Set(db.prepare("SELECT id FROM review_annotations WHERE visibility='internal'").all().map(r=>r.id));
  assert.equal(pack.shared_annotations.some(a=>internalIds.has(a.id)),false);
  for(const m of pack.media)assert.equal(m.annotations.every(a=>!internalIds.has(a.id)),true);
  // الشاشة الداخلية ترى الاثنين وتسمّي الفرق صراحة.
  const inside=getRoute(db,users['account-lead'],routeId);
  assert.deepEqual(inside.counts,{internal:1,shared:1,open:2});
  assert.ok(inside.annotations.every(a=>a.visibility_name));
  assert.equal(pack.disclaimer.includes('لا يدخل العميل المنصة'),true);
  assert.ok(verifyAudit(db));
});

test('annotations are pinned to a place in the material with relative coordinates, never pixels, and only inside the material they belong to',t=>{
  const {db,users,open,run}=fixture(t);
  const routeId=open();
  run('employee',routeId,'add_media',{kind:'image',label:'التصميم المعروض',content:{filename:'design.png',content:png()}});
  run('employee',routeId,'add_media',{kind:'text',label:'نص الإعلان',body:reviewText});
  const media=getRoute(db,users.employee,routeId).media;
  const image=media.find(m=>m.kind==='image'),text=media.find(m=>m.kind==='text');
  assert.equal(image.preview_path,`/api/review-rounds/media/${image.id}`,'the material is previewed from an internal path only');
  assert.equal(text.preview_path,null);
  assert.throws(()=>run('creative-lead',routeId,'annotate',{media_id:image.id,visibility:'shared',body:'الشعار مزاح إلى اليمين',x:540,y:320}),code('invalid_position'));
  assert.throws(()=>run('creative-lead',routeId,'annotate',{media_id:image.id,visibility:'shared',body:'الشعار مزاح إلى اليمين',x:0.5,y:0.25,page:2}),code=>['invalid_number','invalid_fields'].includes(code.code));
  assert.throws(()=>run('creative-lead',routeId,'annotate',{media_id:text.id,visibility:'shared',body:'خارج حدود النص',char_start:0,char_end:99999}),code('invalid_number'));
  run('creative-lead',routeId,'annotate',{media_id:image.id,visibility:'shared',body:'الشعار مزاح إلى اليمين قليلًا',x:0.5,y:0.25});
  const pinned=getRoute(db,users.employee,routeId).media.find(m=>m.kind==='image').annotations[0];
  assert.equal(pinned.x,0.5);assert.equal(pinned.y,0.25);
  assert.match(pinned.place,/٪/,'the place is also written out, so the list beside the material stays usable without inline CSS');
  const bytes=previewMedia(db,users['creative-lead'],image.id);
  assert.equal(bytes.media_type,'image/png');
  assert.throws(()=>previewMedia(db,users.outsider,image.id),code('not_found'),'the capability alone does not open material from a project you are not in');
  assert.ok(verifyAudit(db));
});

test('every annotation closes with a stated outcome, “will not fix” needs its reason, and what stays open becomes the worklist for the next version',t=>{
  const {db,users,open,run}=fixture(t);
  const routeId=open();
  run('employee',routeId,'add_media',{kind:'text',label:'نص الإعلان',body:reviewText});
  const mediaId=getRoute(db,users.employee,routeId).media[0].id;
  run('creative-lead',routeId,'annotate',{media_id:mediaId,visibility:'shared',body:'الجملة الثانية طويلة',char_start:40,char_end:60});
  run('creative-lead',routeId,'annotate',{media_id:mediaId,visibility:'internal',body:'نراجع المرجع اللغوي لاحقًا',char_start:0,char_end:10});
  const ids=getRoute(db,users.employee,routeId).annotations.map(a=>({id:a.id,version:a.version}));
  assert.equal(getRoute(db,users.employee,routeId).worklist.length,2);
  transaction(db,()=>annotationAction(db,users.employee,ids[0].id,'address',{version:ids[0].version,note:'أعدنا صياغة الجملة الثانية في النسخة التالية'}));
  assert.throws(()=>transaction(db,()=>annotationAction(db,users.employee,ids[1].id,'wont_fix',{version:ids[1].version,reason:''})),code('invalid_text'));
  transaction(db,()=>annotationAction(db,users.employee,ids[1].id,'wont_fix',{version:ids[1].version,reason:'المرجع اللغوي خارج نطاق هذه النسخة، ويُعالج في تحديث الهوية'}));
  const after=getRoute(db,users.employee,routeId);
  assert.equal(after.worklist.length,0,'closed annotations leave the next-version worklist');
  assert.deepEqual(after.annotations.map(a=>a.status).sort(),['addressed','wont_fix']);
  assert.throws(()=>db.prepare("UPDATE review_annotations SET body='نص مبدّل',version=version+1 WHERE 1").run(),/keeps its text/);
  assert.throws(()=>db.prepare("UPDATE review_annotations SET visibility='shared',version=version+1 WHERE visibility='internal'").run(),/keeps its text/);
  assert.throws(()=>transaction(db,()=>annotationAction(db,users.employee,ids[0].id,'address',{version:ids[0].version,note:'محاولة ثانية'})),code=>['stale_version','action_unavailable'].includes(code.code));
  assert.ok(verifyAudit(db));
});

test('a client stage closes only on an external approval documented against the same version; the platform opens no external review link and sends no mail',t=>{
  const {db,users,studio,open,run,approveInStudio}=fixture(t);
  approveInStudio();
  const routeId=open(undefined,[{position:1,name:'قرار العميل',audience:'client',reviewer_ids:['account-lead'],due_days:5,reminder_days:2,escalation_days:4}]);
  const stage=()=>getRoute(db,users['account-lead'],routeId).stages[0];
  assert.throws(()=>run('account-lead',routeId,'decide',{stage_id:stage().id,decision:'approved',note:'قال لي العميل شفهيًا إنه موافق'}),code('client_evidence_required'));
  const approverId=transaction(db,()=>registerApprover(db,users['account-lead'],{project_id:getRoute(db,users['account-lead'],routeId).project_id,name:'مفوضة العميل المصطنعة',title:'مديرة التسويق لدى العميل',authority_basis:'البند 7 من العقد المصطنع يسميها مفوضة باعتماد المحتوى',authority_scope:'اعتماد محتوى القنوات الاجتماعية',valid_from:'2026-01-01'})).id;
  transaction(db,()=>recordApproval(db,users['account-lead'],{output_version_id:studio.versionId,approver_id:approverId,decision:'approved_with_conditions',scope_note:'وافقت بشرط تعديل الجملة الثانية قبل النشر',channel:'email',received_on:'2026-09-01',evidence_reference:'بريد مصطنع محفوظ في مجلد الحساب بتاريخ 2026-09-01'}));
  const evidence=getRoute(db,users['account-lead'],routeId).client_evidence;
  assert.equal(evidence.length,1);assert.equal(evidence[0].maps_to,'approved_with_changes');
  assert.throws(()=>run('account-lead',routeId,'decide',{stage_id:stage().id,decision:'approved',note:'أسجلها موافقة كاملة',external_approval_id:evidence[0].id}),code('client_decision_mismatch'));
  run('account-lead',routeId,'decide',{stage_id:stage().id,decision:'approved_with_changes',note:'وثّقنا موافقة العميل المشروطة كما وردت',external_approval_id:evidence[0].id});
  const closed=getRoute(db,users['account-lead'],routeId);
  assert.equal(closed.status,'approved_with_changes');
  assert.equal(closed.stages[0].decision.external_approval_id,evidence[0].id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0,'nothing is queued for any external channel');
  assert.match(closed.stages[0].decision.meaning,/الملاحظات/);
  assert.ok(verifyAudit(db));
});

test('reminders and escalation stay inside the platform, are repeatable without piling up, and a route saved as a template rebuilds the same stages',t=>{
  const {db,users,open,run,nextVersion}=fixture(t);
  const routeId=open();
  // مرحلة بلا مدة لا تنتج تذكيرًا ولا تصعيدًا: لا مهلة مفترضة في الكود.
  db.prepare("UPDATE review_stages SET opened_on='2020-01-01',due_on='2020-01-05',version=version+1 WHERE route_id=? AND status='open'").run(routeId);
  run('employee',routeId,'notify');
  const first=db.prepare("SELECT COUNT(*) AS n FROM review_notices WHERE kind IN ('review_due_reminder','review_stage_escalated')").get().n;
  assert.ok(first>=2,'an overdue stage reminds its reviewers and escalates to the file owner');
  run('employee',routeId,'notify');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_notices WHERE kind IN ('review_due_reminder','review_stage_escalated')").get().n,first,'a second sweep adds nothing');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_notices WHERE user_id='file-owner' AND kind='review_stage_escalated'").get().n,1);
  run('employee',routeId,'save_template',{name:'مسار المراجعة القياسي المصطنع',description:'إبداعي ثم مدير الحساب'});
  const template=reviewBoard(db,users.employee).templates[0];
  assert.equal(template.stages.length,2);
  assert.deepEqual(template.stages.map(s=>s.reviewer_ids).flat(),['creative-lead','account-lead']);
  const second=nextVersion();
  const fromTemplate=transaction(db,()=>createRoute(db,users.employee,{output_version_id:second,name:'مسار من القالب',owner_id:'file-owner',template_id:template.id,stages:[]})).id;
  const rebuilt=getRoute(db,users.employee,fromTemplate);
  assert.deepEqual(rebuilt.stages.map(s=>s.name),['إبداعي','مدير الحساب']);
  assert.deepEqual(rebuilt.stages.map(s=>s.status),['open','waiting']);
  assert.ok(rebuilt.compare.previous,'a second version compares against the one before it');
  assert.match(rebuilt.compare.note,/لا تقارن المنصة البكسلات/);
  assert.ok(verifyAudit(db));
});

test('tenant isolation, the capability and optimistic locking all hold, and neither screen emits inline style or script',t=>{
  const {db,users,open,run}=fixture(t);
  const routeId=open();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_routes WHERE tenant_id<>?').get('36t').n,0,'every review row is written under one tenant');
  assert.throws(()=>getRoute(db,users.external,routeId),code=>['not_permitted','not_found'].includes(code.code),'another tenant never reaches the route');
  assert.throws(()=>reviewBoard(db,users.hr),code('not_permitted'),'without the capability there is no board at all');
  assert.throws(()=>getRoute(db,users.outsider,routeId),code('not_found'),'the capability alone does not open a project you are not a member of');
  assert.throws(()=>transaction(db,()=>reviewAction(db,users.employee,routeId,'add_media',{version:99,kind:'text',label:'نص',body:reviewText})),code('stale_version'));
  assert.throws(()=>reviewAction(db,users.employee,routeId,'notify',{version:1}),code('transaction_required'));
  run('employee',routeId,'add_media',{kind:'text',label:'نص الإعلان',body:reviewText});
  run('creative-lead',routeId,'annotate',{media_id:getRoute(db,users.employee,routeId).media[0].id,visibility:'internal',body:'ملاحظة داخلية للاختبار',char_start:0,char_end:8});
  for(const ui of [reviewRoundsUI,annotationsUI]){
    const html=ui.render(reviewBoard(db,users.employee),helpers);
    assert.equal(/\sstyle\s*=/.test(html),false,'no inline style survives a strict CSP');
    assert.equal(/<script/i.test(html),false);
    assert.equal(/https?:\/\//.test(html),false,'no external resource');
    assert.ok(ui.title&&ui.description);
  }
  const board=reviewBoard(db,users.employee);
  const spec=reviewRoundsUI.form('annotate',routeId,board);
  assert.equal(spec.endpoint,`/review-rounds/${routeId}/annotate`);
  assert.ok(spec.fields.some(f=>f.name==='visibility'&&f.options.length===2));
  assert.ok(verifyAudit(db));
});

test('PRO-07 video review: a comment on a video is pinned to a moment inside its declared length — never a point in space, never past the end — and it stays with that version while the next version’s route starts clean',t=>{
  const {db,users,open,run,nextVersion}=fixture(t);
  // MP4 مصطنع بتوقيع محتوى صحيح (ftyp في البايتات 4–8)، ومدته يعلنها الرافع ولا تُستخرج من الملف.
  const mp4=()=>Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.from('synthetic-mp4-body-for-tests')]).toString('base64');
  const routeId=open();
  run('employee',routeId,'add_media',{kind:'video',label:'مقطع الإعلان المعروض',content:{filename:'cut.mp4',content:mp4()},duration_seconds:90});
  const video=getRoute(db,users.employee,routeId).media.find(m=>m.kind==='video');
  assert.equal(video.anchor_kind,'timestamp');
  assert.throws(()=>run('creative-lead',routeId,'annotate',{media_id:video.id,visibility:'shared',body:'اللقطة طويلة',at_seconds:95}),code('at_seconds'),'a moment past the end of the video');
  assert.throws(()=>run('creative-lead',routeId,'annotate',{media_id:video.id,visibility:'shared',body:'اللقطة طويلة',at_seconds:-1}),code('at_seconds'));
  assert.throws(()=>run('creative-lead',routeId,'annotate',{media_id:video.id,visibility:'shared',anchor:'point',body:'نقطة على الفيديو',x:0.5,y:0.5}),code('anchor'),'a video is pinned in time, not in space');
  run('creative-lead',routeId,'annotate',{media_id:video.id,visibility:'shared',body:'الشعار يتأخر ثانيتين عن الموسيقى',at_seconds:73.5});
  const pinned=getRoute(db,users.employee,routeId).media.find(m=>m.kind==='video').annotations[0];
  assert.deepEqual([pinned.anchor,pinned.at_seconds,pinned.x,pinned.y],['timestamp',73.5,null,null]);
  assert.equal(pinned.place,'الدقيقة 01:13','the moment is written out for the list beside the player');
  assert.throws(()=>db.prepare("INSERT INTO review_annotations(id,tenant_id,media_id,anchor,at_seconds,visibility,body,status,created_by,created_at) VALUES('raw-past-end','36t',?,'timestamp',120,'shared','خارج مدة المقطع','open','creative-lead','2026-10-01T00:00:00.000Z')").run(video.id),
    /anchor must fit the material/,'SQL refuses a moment past the declared length even when the code is bypassed');
  // النسخة التالية تبدأ مسارها بلا تعليق من مسار النسخة السابقة، والتعليق السابق باقٍ مع نسخته.
  const next=open(nextVersion());
  assert.equal(getRoute(db,users.employee,next).annotations.length,0,'the next version starts with no comment from the previous one');
  assert.equal(getRoute(db,users.employee,routeId).annotations.length,1,'the previous version keeps its comment');
  assert.ok(verifyAudit(db));
});

