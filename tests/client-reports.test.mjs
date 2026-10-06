import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction, createRetainer } from '../app/agency.mjs';
import { createCampaign, campaignAction, campaignsBoard, createContent, contentAction, contentBoard } from '../app/campaigns.mjs';
import { mediaSpendBoard, prepareMediaPlan, mediaPlanAction, recordMediaSpend } from '../app/media-spend.mjs';
import { clientReportsBoard, createTemplate, templateAction, generateReport, reportAction, readClientReport, clientReportPrintable } from '../app/client-reports.mjs';
import { createProject } from '../app/projects.mjs';
import { approvedVersion } from './studio-fixture.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const ALL=['campaign_results','content_published','media_spend','contract_progress','next_step'];

// كل البيانات مصطنعة (تجريبي). مسؤول الحساب: manager. عضوة الفريق: employee. فريق حساب آخر: lead-b.
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-client-reports');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-b','36t','creative','lead-b','مديرة حساب أخرى (تجريبي)','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const who of ['employee','manager','lead-b'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'commercial.use',department_id:'creative',note:'تصريح اختبار تجريبي'}));
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة عميل التقارير التجريبية',trade_name:'عميل التقارير التجريبي',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'منسقة الحساب (تجريبي)'}));
  const otherClient=tx(()=>createClient(db,users['lead-b'],{legal_name:'شركة عميل آخر تجريبية',trade_name:'عميل آخر',sector:'مطاعم',status:'active'})).id;
  const start=addDays(today(),-9),end=addDays(today(),10);
  const campaignId=tx(()=>createCampaign(db,users.employee,{client_id:clientId,name:'حملة التقرير التجريبية',objective:'حملة مصطنعة لاختبار تقرير العميل الدوري',channels:['instagram'],targets:[{metric:'نقرات',target:5000,unit:'نقرة'},{metric:'مشتريات',target:100,unit:'طلب'}],media_budget:'5000.00',budget_reference:'بريد اعتماد العميل التجريبي',start_date:start,end_date:end})).id;
  const camp=who=>campaignsBoard(db,users[who]).campaigns.find(c=>c.id===campaignId);
  const cAct=(who,action,values={})=>tx(()=>campaignAction(db,users[who],campaignId,action,{version:camp(who).version,...values}));
  for(const item of camp('employee').checklist)cAct('employee','check',{key:item.key,evidence:'دليل تجريبي لاكتمال البند'});
  cAct('employee','request_launch');cAct('manager','approve_launch',{note:'اعتماد إطلاق تجريبي بعد المراجعة'});
  cAct('employee','result',{entry_date:addDays(today(),-1),metric:'نقرات',value:1800,source:'لوحة المنصة التجريبية بتاريخ أمس'});
  const planId=tx(()=>prepareMediaPlan(db,users.employee,{campaign_id:campaignId,budget_reference:'توزيع تجريبي معتمد',lines:[{channel:'instagram',start_date:start,end_date:end,planned:'5000.00',target_metric:'نقرات',target_value:5000,target_unit:'نقرة'}]})).id;
  tx(()=>mediaPlanAction(db,users.manager,planId,'approve_plan',{version:1,note:'راجعت الخطة التجريبية'}));
  tx(()=>recordMediaSpend(db,users.employee,campaignId,{channel:'instagram',spend_date:addDays(today(),-1),amount:'750.00',evidence_kind:'account_statement',evidence_reference:'كشف حساب المنصة التجريبي',funding:'client_direct'}));
  const retainerId=tx(()=>createRetainer(db,users.manager,{client_id:clientId,name:'اشتراك المحتوى التجريبي',period_month:today().slice(0,7),allowances:[{type:'منشور',quantity:8}],contract_reference:'عقد تجريبي بند 4',carry_over_rule:'لا ترحيل في العقد التجريبي'})).id;
  const itemId=tx(()=>createContent(db,users.employee,{client_id:clientId,campaign_id:campaignId,brand_id:'',channel:'instagram',format:'post',title:'منشور تجريبي للحملة',brief:'',planned_date:today(),planned_time:'',retainer_id:retainerId,deliverable_type:'منشور'})).id;
  const item=who=>contentBoard(db,users[who]).items.find(i=>i.id===itemId);
  const iAct=(who,action,values={})=>tx(()=>contentAction(db,users[who],itemId,action,{version:item(who).version,...values}));
  // المنشور نسخة اعتمدها الاستوديو في عمل مفتوح للحملة (P4-SPEC-3، الترحيل 189).
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع منشورات التقرير التجريبي',brief:'نسخ معتمدة للحملة',member_ids:['employee','outsider']})).id;
  const version=approvedVersion(db,users,{project,campaign:campaignId,channel:'instagram',title:'منشور تجريبي معتمد'}).version;
  iAct('employee','start');iAct('employee','submit',{output_version_id:version});iAct('manager','pass',{note:'مراجعة داخلية تجريبية'});
  iAct('employee','client_approve',{reference:'موافقة العميل التجريبي بالبريد'});iAct('employee','publish',{published_reference:'https://example.invalid/post-1',overage_note:''});
  const templateId=tx(()=>createTemplate(db,users.manager,{client_id:clientId,name:'التقرير الشهري التجريبي',cadence:'monthly',sections:ALL})).id;
  const generate=(who,values={})=>tx(()=>generateReport(db,users[who],{template_id:templateId,period_start:start,period_end:today(),title:'تقرير الأداء التجريبي',supersedes_id:'',...values})).id;
  const report=(who,reportId)=>readClientReport(db,users[who],reportId);
  const act=(who,reportId,action,values={})=>tx(()=>reportAction(db,users[who],reportId,action,{version:report(who,reportId).version,...values}));
  return {db,users,tx,clientId,otherClient,templateId,generate,report,act};
}

test('client report: generated from platform records only, every figure carries its source and date, and a missing record reads "no entry" not zero',t=>{
  const {db,users,tx,clientId,generate,report}=fixture(t);
  assert.throws(()=>tx(()=>createTemplate(db,users.employee,{client_id:clientId,name:'قالب من عضو',cadence:'weekly',sections:ALL})),code('forbidden'),'the account owner sets the template');
  assert.throws(()=>generate('employee',{period_end:addDays(today(),1)}),code('future_period'));
  const r=report('employee',generate('employee'));
  const figures=r.body.sections.flatMap(s=>s.groups.flatMap(g=>g.figures));
  assert.ok(figures.length>=5);
  for(const f of figures){assert.ok(f.source.trim().length>=5,`${f.label} has a source`);assert.match(f.as_of,/^\d{4}-\d{2}-\d{2}$/);}
  const results=r.body.sections.find(s=>s.key==='campaign_results').groups[0].figures;
  assert.equal(results[0].value,1800);assert.match(results[0].source,/لوحة المنصة التجريبية/);
  assert.equal(results[1].value,null);assert.equal(results[1].type,'none','no entry is not a zero');
  const spend=r.body.sections.find(s=>s.key==='media_spend').groups[0].figures;
  assert.equal(spend.find(f=>f.label.includes('المصروف')).value,75000);assert.match(spend.find(f=>f.label.includes('المصروف')).source,/كشف حساب/);
  assert.equal(r.body.sections.find(s=>s.key==='content_published').groups[0].figures[0].value,1);
  assert.equal(r.body.sections.find(s=>s.key==='contract_progress').groups[0].figures[0].value,1);
  assert.equal(r.commentary,'','no automatic commentary is written');
  assert.ok(r.integrity);
  assert.throws(()=>db.prepare("UPDATE client_reports SET body='{\"sections\":[]}',version=version+1 WHERE id=?").run(r.id),/never edited/,'figures are never edited, even in a draft');
  assert.ok(verifyAudit(db));
});

test('client report: the account manager writes and signs the commentary in their own name, the person who generated it cannot sign, and a signed report is corrected by a new one',t=>{
  const {db,users,generate,report,act}=fixture(t);
  const id=generate('employee');
  assert.throws(()=>act('employee',id,'write_commentary',{commentary:'تعليق من غير مسؤول الحساب للاختبار',next_step:''}),code('action_unavailable'));
  assert.throws(()=>act('manager',id,'sign_report',{confirm:true}),code('commentary_required'));
  act('manager',id,'write_commentary',{commentary:'النقرات تتقدم دون الهدف، والصرف أبطأ من الوتيرة المخططة.',next_step:'نراجع الاستهداف مع العميل الأسبوع القادم'});
  assert.throws(()=>act('manager',id,'sign_report',{confirm:false}),code('confirm'));
  assert.throws(()=>transaction(db,()=>reportAction(db,users.manager,id,'sign_report',{version:0,confirm:true})),code('stale_version'));
  act('manager',id,'sign_report',{confirm:true});
  const signed=report('employee',id);
  assert.equal(signed.status,'signed');assert.equal(signed.signed_name,users.manager.name);
  assert.throws(()=>db.prepare("UPDATE client_reports SET commentary='تعديل صامت بعد التوقيع لا يجوز',version=version+1 WHERE id=?").run(id),/corrected by a new report/);
  // من ولّد التقرير لا يوقّعه — في الكود وفي قيد الجدول.
  const own=generate('manager',{title:'تقرير ولّده مسؤول الحساب'});
  act('manager',own,'write_commentary',{commentary:'تعليق تجريبي كافٍ على أداء الحملة المصطنعة',next_step:'خطوة تجريبية'});
  assert.ok(report('manager',own).signer_blocked);
  assert.throws(()=>act('manager',own,'sign_report',{confirm:true}),code('action_unavailable'));
  assert.throws(()=>db.prepare("UPDATE client_reports SET status='signed',signed_by=prepared_by,signed_name='x y',signed_at='x',version=version+1 WHERE id=?").run(own),/CHECK constraint/);
  act('manager',own,'discard_report',{note:'يولّده عضو آخر'});
  // التصحيح تقرير جديد يحل محل الموقّع عند توقيعه، ويبقى الأول محفوظًا.
  const fix=generate('employee',{title:'تقرير الأداء التجريبي — مصحَّح',supersedes_id:id});
  assert.throws(()=>generate('employee',{supersedes_id:id}),code('correction_exists'));
  act('manager',fix,'write_commentary',{commentary:'نسخة مصححة بعد إضافة قيد نتائج متأخر من المنصة',next_step:'لا تغيير في الخطة'});
  act('manager',fix,'sign_report',{confirm:true});
  assert.equal(report('employee',id).status,'superseded');assert.equal(report('employee',fix).supersedes.id,id);
  assert.ok(verifyAudit(db));
});

test('client report isolation: only the account team of that client sees its reports — another account team, another tenant and an account without the permission get nothing',t=>{
  const {db,users,tx,otherClient,templateId,generate,report,act}=fixture(t);
  const id=generate('employee');
  assert.equal(clientReportsBoard(db,users.employee).reports.length,1);
  assert.equal(clientReportsBoard(db,users['lead-b']).reports.length,0,'another account team does not see the report');
  assert.equal(clientReportsBoard(db,users['lead-b']).templates.length,0);
  assert.throws(()=>report('lead-b',id),code('not_found'));
  assert.throws(()=>report('outsider',id),error=>['not_found','forbidden','not_permitted'].includes(error.code));
  assert.throws(()=>report('external',id),code('not_found'));
  assert.throws(()=>tx(()=>generateReport(db,users['lead-b'],{template_id:templateId,period_start:addDays(today(),-3),period_end:today(),title:'محاولة من فريق آخر',supersedes_id:''})),code('not_found'));
  assert.throws(()=>tx(()=>reportAction(db,users['lead-b'],id,'write_commentary',{version:1,commentary:'تعليق من خارج فريق الحساب للاختبار',next_step:''})),code('not_found'));
  // فريق العميل الآخر يرى تقاريره وحده.
  tx(()=>createTemplate(db,users['lead-b'],{client_id:otherClient,name:'قالب العميل الآخر',cadence:'weekly',sections:['content_published']}));
  assert.equal(clientReportsBoard(db,users.employee).templates.length,1);
  // بلا تصريح «المبيعات والتسليم» لا وصول، ولو كان في الفريق.
  db.prepare("UPDATE access_grants SET revoked_at=?,revoked_by='admin' WHERE user_id='employee' AND capability='commercial.use'").run(new Date().toISOString());
  assert.throws(()=>report('employee',id),code('not_permitted'));
  assert.throws(()=>clientReportsBoard(db,users.employee),code('not_permitted'));
  act('manager',id,'write_commentary',{commentary:'يبقى متاحًا لمسؤول الحساب صاحب التصريح',next_step:'لا تغيير في الخطة'});
  assert.ok(verifyAudit(db));
});

test('client report print page: Arabic, escapes every value, states that the platform sends nothing, and never labels a draft as final',t=>{
  const {db,users,tx,templateId,generate,report,act}=fixture(t);
  tx(()=>templateAction(db,users.manager,templateId,'edit_template',{version:1,name:'التقرير الشهري التجريبي',cadence:'monthly',sections:ALL}));
  const id=generate('employee',{title:'<script>تقرير</script>'});
  const draft=clientReportPrintable(report('employee',id));
  assert.match(draft,/lang="ar" dir="rtl"/);assert.doesNotMatch(draft,/<script>/);assert.match(draft,/&lt;script&gt;/);
  assert.match(draft,/لا يُرسل للعميل قبل توقيع/);assert.match(draft,/لا بوابة عميل ولا إرسال/);assert.match(draft,/كشف حساب المنصة التجريبي/);
  assert.doesNotMatch(draft,/style=/);
  act('manager',id,'write_commentary',{commentary:'تعليق مسؤول الحساب على نتائج الفترة التجريبية',next_step:'نرفع ميزانية القناة الأعلى أداءً بعد موافقة العميل'});
  act('manager',id,'sign_report',{confirm:true});
  assert.match(clientReportPrintable(report('employee',id)),new RegExp(`موقّع من ${users.manager.name}`));
  assert.ok(verifyAudit(db));
});

test('client reports screen: says nothing is sent from the platform, shows every figure with its source, and every offered action opens a form',async t=>{
  const {db,users,generate}=fixture(t);
  const { clientReportsUI } = await import('../app/static/media-spend-ui.mjs');
  const { money } = await import('../app/static/operations.mjs');
  generate('employee');
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
  for(const who of ['employee','manager']){
    const seen=[],button=(action,id,label)=>{seen.push([action,id]);return `<button>${e(label)}</button>`;};
    const data=clientReportsBoard(db,users[who]),html=clientReportsUI.render(data,{e,button,money});
    assert.match(html,/لا بوابة عميل ولا إرسال/);assert.match(html,/كشف حساب المنصة التجريبي/);assert.doesNotMatch(html,/style=|<script/);
    for(const [action,id] of seen){const spec=clientReportsUI.form(action,id,data);assert.ok(spec.endpoint.startsWith('/client-reports'),action);}
  }
});
