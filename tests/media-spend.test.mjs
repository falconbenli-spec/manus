import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign, campaignAction, campaignsBoard } from '../app/campaigns.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { fundProject } from './budget-fixture.mjs';
import { mediaSpendBoard, prepareMediaPlan, mediaPlanAction, recordMediaSpend, correctMediaSpend, saveMediaProfile, deactivateMediaProfile, importMediaSpend, cancelMediaImport,
  setThreshold, retireThreshold, acknowledgeSpend, linkCommitment, recordBilling, pacingFor } from '../app/media-spend.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

// بيانات مصطنعة كلها (تجريبي): عميل وحملة نشطة بدأت قبل تسعة أيام وتنتهي بعد عشرة.
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-media-spend');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-b','36t','creative','lead-b','مديرة حساب أخرى (تجريبي)','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const who of ['employee','manager','lead-b'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'commercial.use',department_id:'creative',note:'تصريح اختبار تجريبي'}));
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل التجريبي للصرف',trade_name:'عميل الصرف التجريبي',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'مشترية وسائط (تجريبي)'}));
  const start=addDays(today(),-9),end=addDays(today(),10);
  const campaignId=tx(()=>createCampaign(db,users.employee,{client_id:clientId,name:'حملة الصرف التجريبية',objective:'اختبار انضباط الصرف الإعلامي على بيانات مصطنعة',channels:['instagram','google_ads'],targets:[{metric:'نقرات',target:20000,unit:'نقرة'}],media_budget:'10000.00',budget_reference:'بريد اعتماد العميل التجريبي',start_date:start,end_date:end})).id;
  const camp=who=>campaignsBoard(db,users[who]).campaigns.find(c=>c.id===campaignId);
  const cAct=(who,action,values={})=>tx(()=>campaignAction(db,users[who],campaignId,action,{version:camp(who).version,...values}));
  for(const item of camp('employee').checklist)cAct('employee','check',{key:item.key,evidence:'دليل تجريبي لاكتمال البند'});
  cAct('employee','request_launch');cAct('manager','approve_launch',{note:'اعتماد إطلاق تجريبي بعد المراجعة'});
  const view=who=>mediaSpendBoard(db,users[who]).campaigns.find(c=>c.id===campaignId);
  const lines=[{channel:'instagram',start_date:start,end_date:end,planned:'6000.00',target_metric:'نقرات',target_value:12000,target_unit:'نقرة'},{channel:'google_ads',start_date:start,end_date:end,planned:'4000.00',target_metric:'نقرات',target_value:8000,target_unit:'نقرة'}];
  const approvePlan=()=>{const planId=tx(()=>prepareMediaPlan(db,users.employee,{campaign_id:campaignId,budget_reference:'توزيع معتمد في محضر تجريبي',lines})).id;tx(()=>mediaPlanAction(db,users.manager,planId,'approve_plan',{version:view('manager').draft.version,note:'راجعت التوزيع مقابل ميزانية العميل'}));return planId;};
  const spend=(values={})=>tx(()=>recordMediaSpend(db,users.employee,campaignId,{channel:'instagram',spend_date:today(),amount:'1000.00',evidence_kind:'platform_screenshot',evidence_reference:'لقطة لوحة إعلانات تجريبية محفوظة',funding:'client_direct',...values}));
  // بوابة المورد (app/vendors.mjs): الكيان الذي بلا ملف ما عاد يُقبل عرضه ولا تُرسى عليه ترسية،
  // فكل مفتاح يمرّ في add_quote يحتاج ملفًا مؤهلًا فعلًا يبنيه المساعد بالمسار الحقيقي.
  // وموضعه آخر التجهيز عمدًا: المساعد يمنح vendors.manage بنفسه، فلو سبق منح الاختبار لاصطدما.
  approveVendors(db,['media-a', 'media-b', 'media-c']);
  return {db,users,tx,clientId,campaignId,start,end,lines,view,approvePlan,spend};
}

test('media plan: the person who prepares the spend plan never approves it, the plan never exceeds the client-approved budget, and an approved plan is replaced by a new revision instead of being edited',t=>{
  const {db,users,tx,campaignId,lines,view}=fixture(t);
  assert.throws(()=>tx(()=>prepareMediaPlan(db,users.employee,{campaign_id:campaignId,budget_reference:'توزيع يتجاوز الميزانية',lines:[{...lines[0],planned:'9000.00'},lines[1]]})),code('plan_exceeds_budget'));
  const planId=tx(()=>prepareMediaPlan(db,users.employee,{campaign_id:campaignId,budget_reference:'توزيع معتمد في محضر تجريبي',lines})).id;
  assert.deepEqual(view('employee').draft.actions,['edit_plan','discard_plan']);
  assert.throws(()=>tx(()=>mediaPlanAction(db,users.employee,planId,'approve_plan',{version:1,note:'أعتمد خطتي بنفسي'})),code('self_approval'));
  assert.throws(()=>db.prepare("UPDATE media_plans SET status='approved',approved_by=prepared_by,approved_at='x',version=version+1 WHERE id=?").run(planId),/CHECK constraint/,'the database refuses self-approval too');
  assert.throws(()=>tx(()=>mediaPlanAction(db,users.manager,planId,'approve_plan',{version:0,note:'نسخة قديمة من الشاشة'})),code('stale_version'));
  tx(()=>mediaPlanAction(db,users.manager,planId,'approve_plan',{version:1,note:'راجعت التوزيع مقابل ميزانية العميل'}));
  assert.equal(view('employee').plan.approved_by_name,users.manager.name);
  assert.throws(()=>db.prepare("UPDATE media_plans SET budget_reference='تعديل صامت',version=version+1 WHERE id=?").run(planId),/replaced by a new revision/);
  assert.throws(()=>db.prepare("UPDATE media_plan_lines SET planned_minor=1 WHERE plan_id=?").run(planId),/never edited/);
  assert.throws(()=>tx(()=>mediaPlanAction(db,users.employee,planId,'edit_plan',{version:2,budget_reference:'تعديل بعد الاعتماد',lines})),code('invalid_state'));
  // نسخة ثانية تحل محل الأولى عند اعتمادها، وتبقى الأولى محفوظة.
  const second=tx(()=>prepareMediaPlan(db,users.employee,{campaign_id:campaignId,budget_reference:'إعادة توزيع تجريبية',lines:[{...lines[0],planned:'5000.00'},{...lines[1],planned:'5000.00'}]})).id;
  assert.equal(view('employee').plan.id,planId,'the approved revision stays in force until the new one is approved');
  tx(()=>mediaPlanAction(db,users.manager,second,'approve_plan',{version:1,note:'اعتماد إعادة التوزيع التجريبية'}));
  assert.deepEqual(db.prepare('SELECT status FROM media_plans WHERE campaign_id=? ORDER BY revision').all(campaignId).map(r=>r.status),['superseded','approved']);
  assert.ok(verifyAudit(db));
});

test('actual spend: a figure without its source is refused, each entry keeps who entered it and when, a correction is a new entry, and pacing compares with an even spread over the channel days',t=>{
  const {db,users,tx,campaignId,start,end,view,approvePlan,spend}=fixture(t);
  assert.throws(()=>spend(),code('plan_required'),'actual spend is measured against an approved plan');
  approvePlan();
  assert.throws(()=>spend({evidence_kind:''}),code('evidence_kind'));
  assert.throws(()=>spend({evidence_reference:'  '}),code('invalid_text'));
  assert.throws(()=>spend({channel:'tiktok'}),code('channel'));
  assert.throws(()=>spend({spend_date:addDays(today(),1)}),code('spend_date'));
  const first=spend().id;spend({channel:'google_ads',amount:'500.00',evidence_kind:'invoice',evidence_reference:'فاتورة منصة تجريبية رقم 7'});
  assert.throws(()=>db.prepare("INSERT INTO media_spend_entries(id,tenant_id,plan_id,line_id,spend_date,amount_minor,evidence_kind,evidence_reference,entry_method,funding,recorded_by,recorded_at) SELECT 'x',tenant_id,plan_id,line_id,spend_date,10,evidence_kind,'',entry_method,funding,recorded_by,recorded_at FROM media_spend_entries WHERE id=?").run(first),/CHECK constraint/,'the schema itself refuses a number without a source');
  const row=view('employee').entries.find(e=>e.id===first);
  assert.equal(row.recorded_by_name,users.employee.name);assert.ok(row.recorded_at);assert.equal(row.evidence_kind_name,'لقطة من لوحة المنصة الإعلانية');
  assert.throws(()=>db.prepare('UPDATE media_spend_entries SET amount_minor=1 WHERE id=?').run(first),/corrected by a new entry/);
  tx(()=>correctMediaSpend(db,users.employee,first,{amount:'1200.00',evidence_kind:'account_statement',evidence_reference:'كشف حساب المنصة التجريبي',reason:'اللقطة التقطت قبل اكتمال اليوم'}));
  assert.throws(()=>tx(()=>correctMediaSpend(db,users.employee,first,{amount:'1.00',evidence_kind:'invoice',evidence_reference:'فاتورة تجريبية',reason:'تصحيح ثان للسطر نفسه'})),code('already_corrected'));
  const p=view('employee').pacing,ig=p.lines.find(l=>l.channel==='instagram');
  // عشرون يومًا مضى منها عشرة: المتوقع لو توزعت 6000 بالتساوي = 3000.
  assert.equal(ig.days_total,20);assert.equal(ig.days_elapsed,10);assert.equal(ig.expected_minor,300000);assert.equal(ig.actual_minor,120000);assert.equal(ig.variance_minor,-180000);
  assert.equal(p.actual_minor,170000);assert.equal(p.planned_minor,1000000);
  assert.equal(pacingFor([{channel:'x',start_date:start,end_date:end,planned_minor:2000}],[],end).lines[0].expected_minor,2000,'at the end of the line the whole budget is expected');
  assert.ok(verifyAudit(db));
});

test('platform file import: nothing connects to an ad platform, a saved column mapping per channel is reused, the same file is never imported twice, and overlapping days are refused',t=>{
  const {db,users,tx,campaignId,view,approvePlan}=fixture(t);
  approvePlan();
  assert.match(mediaSpendBoard(db,users.employee).note,/لا اتصال بأي منصة إعلانية/);
  assert.throws(()=>tx(()=>saveMediaProfile(db,users.employee,{channel:'instagram',name:'تصدير مدير الإعلانات',delimiter:'comma',date_format:'YYYY-MM-DD',header_rows:1,columns:{date:'Day'}})),code('columns_required'));
  const profile=tx(()=>saveMediaProfile(db,users.employee,{channel:'instagram',name:'تصدير مدير الإعلانات',delimiter:'comma',date_format:'YYYY-MM-DD',header_rows:1,columns:{date:'Day',amount:'Amount spent (SAR)',campaign:'Campaign name'}})).id;
  const d1=addDays(today(),-2),d2=addDays(today(),-1);
  const csv=`Day,Campaign name,Amount spent (SAR)\n${d1},حملة الصرف التجريبية,"1,250.456"\n${d2},حملة الصرف التجريبية,980.10\n${d2},حملة أخرى لا تخصنا,999.00\n`;
  const input={profile_id:profile,file_name:'meta-export-تجريبي.csv',content:csv,campaign_match:'حملة الصرف التجريبية',evidence_kind:'platform_screenshot',evidence_reference:'ملف مصدّر من لوحة المنصة ومحفوظ في مجلد الحملة',funding:'client_direct'};
  const result=tx(()=>importMediaSpend(db,users.employee,campaignId,input));
  assert.equal(result.row_count,2);assert.equal(result.skipped_other_campaigns,1,'rows of other campaigns in the same ad account are skipped, not attributed');
  assert.equal(result.total_minor,125046+98010);
  assert.throws(()=>tx(()=>importMediaSpend(db,users.employee,campaignId,{...input,file_name:'نسخة ثانية.csv'})),code('duplicate_file'));
  assert.throws(()=>tx(()=>importMediaSpend(db,users.employee,campaignId,{...input,content:csv+`${d1},حملة أخرى لا تخصنا,1.00\n`})),code('overlapping_import'));
  assert.throws(()=>tx(()=>importMediaSpend(db,users.employee,campaignId,{...input,content:`Day,Campaign name,Amount spent (SAR)\n${today()},حملة الصرف التجريبية,5\n`,evidence_reference:''})),code('invalid_text'),'an imported number also needs its source');
  const entries=view('employee').entries.filter(e=>e.entry_method==='file_import');
  assert.equal(entries.length,2);assert.ok(entries.every(e=>e.file_name==='meta-export-تجريبي.csv'&&e.recorded_by===users.employee.id));
  const batch=view('employee').imports[0];
  assert.throws(()=>tx(()=>cancelMediaImport(db,users.manager,batch.id,{version:batch.version,reason:'ليس لي أن ألغي دفعة غيري'})),code('forbidden'));
  tx(()=>cancelMediaImport(db,users.employee,batch.id,{version:batch.version,reason:'الملف صُدّر بالمنطقة الزمنية الخطأ'}));
  assert.equal(view('employee').pacing.actual_minor,0,'a cancelled batch no longer counts');
  // التعيين نفسه يُعاد استخدامه لملف لاحق بأيام أخرى.
  tx(()=>importMediaSpend(db,users.employee,campaignId,{...input,file_name:'meta-export-2.csv',content:`Day,Campaign name,Amount spent (SAR)\n${today()},حملة الصرف التجريبية,100\n`}));
  const saved=mediaSpendBoard(db,users.employee).profiles[0];
  assert.throws(()=>db.prepare("UPDATE media_import_profiles SET columns='{}',version=version+1 WHERE id=?").run(profile),/not rewritten/);
  tx(()=>deactivateMediaProfile(db,users.employee,profile,{version:saved.version,note:'المنصة غيرت شكل التصدير'}));
  assert.throws(()=>tx(()=>importMediaSpend(db,users.employee,campaignId,{...input,file_name:'x.csv',content:'Day,Campaign name,Amount spent (SAR)\n'})),code('profile_inactive'));
  assert.ok(verifyAudit(db));
});

test('alerts: thresholds are set only by the campaign owner with no percentage in the code, and crossing one or the budget never blocks spend — it asks for a written acknowledgement',t=>{
  const {db,users,tx,campaignId,view,approvePlan,spend}=fixture(t);
  approvePlan();
  assert.deepEqual(view('employee').thresholds,[],'no default threshold exists');
  assert.throws(()=>tx(()=>setThreshold(db,users.manager,campaignId,{percent:'80',basis:'ليس مالك الحملة'})),code('forbidden'));
  assert.throws(()=>db.prepare("INSERT INTO media_spend_thresholds(id,tenant_id,campaign_id,threshold_bp,basis,set_by,set_at) VALUES('t','36t',?,5000,'أساس تجريبي كافٍ','manager','x')").run(campaignId),/campaign owner/);
  const th=tx(()=>setThreshold(db,users.employee,campaignId,{percent:'50',basis:'اتفقنا مع العميل على تنبيه عند نصف الميزانية'})).id;
  spend({amount:'4000.00'});
  assert.equal(view('employee').alerts.length,0);
  spend({amount:'1500.00',funding:'client_direct'});
  let v=view('employee');assert.equal(v.alerts.length,1);assert.equal(v.pending_acknowledgements,1);assert.ok(v.actions.includes('acknowledge_spend'));
  assert.throws(()=>tx(()=>acknowledgeSpend(db,users.employee,campaignId,{kind:'threshold',threshold_id:th,decision:'continue',note:'قصير'})),code('invalid_text'));
  tx(()=>acknowledgeSpend(db,users.employee,campaignId,{kind:'threshold',threshold_id:th,decision:'continue',note:'راجعت الوتيرة مع العميل واتفقنا على الاستمرار'}));
  assert.throws(()=>tx(()=>acknowledgeSpend(db,users.employee,campaignId,{kind:'threshold',threshold_id:th,decision:'continue',note:'إقرار ثان على التنبيه نفسه للاختبار'})),code('already_acknowledged'));
  // التجاوز لا يمنع التسجيل.
  spend({amount:'5000.00',spend_date:addDays(today(),-1)});
  v=view('employee');assert.ok(v.pacing.actual_minor>v.pacing.planned_minor);assert.ok(v.alerts.some(a=>a.kind==='over_budget'&&!a.acknowledgement));
  assert.equal(db.prepare('SELECT status FROM campaigns WHERE id=?').get(campaignId).status,'live','the platform never pauses a client campaign by itself');
  assert.throws(()=>tx(()=>acknowledgeSpend(db,users.outsider,campaignId,{kind:'over_budget',threshold_id:'',decision:'reduce',note:'لست في الفريق ولا أقر'})),error=>['not_found','not_permitted'].includes(error.code));
  tx(()=>acknowledgeSpend(db,users.manager,campaignId,{kind:'over_budget',threshold_id:'',decision:'pause_requested',note:'مسؤول الحساب يطلب الإيقاف المؤقت حتى يعتمد العميل زيادة'}));
  assert.equal(db.prepare('SELECT status FROM campaigns WHERE id=?').get(campaignId).status,'live','an acknowledgement records the decision; pausing stays a separate human action');
  assert.throws(()=>db.prepare('UPDATE media_spend_acknowledgements SET note=? WHERE plan_id IS NOT NULL').run('تعديل صامت للإقرار المكتوب سابقا'),/written once/);
  const threshold=view('employee').thresholds[0];
  assert.throws(()=>tx(()=>retireThreshold(db,users.employee,th,{version:threshold.version+1,reason:'نسخة قديمة'})),code('stale_version'));
  tx(()=>retireThreshold(db,users.employee,th,{version:threshold.version,reason:'العميل رفع الميزانية'}));
  assert.ok(verifyAudit(db));
});

test('spend on behalf of the client: it is linked to an internal purchase order in the existing procurement path, never beyond the order, and the gap between what we committed and what we billed is shown',t=>{
  const {db,users,tx,campaignId,view,approvePlan,spend}=fixture(t);
  approvePlan();
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع وسائط تجريبي',brief:'شراء وسائط نيابة عن العميل التجريبي',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-MEDIA-CC');
  const pAct=(who,p,action,values={})=>tx(()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=tx(()=>createPurchase(db,users.employee,{project_id:project.id,title:'رصيد إعلاني تجريبي',specification:'شحن رصيد حساب إعلاني باسم الوكالة',cost_center:'SYNTHETIC-MEDIA-CC',due_date:'2099-10-20',quantity:5,unit:'دفعة',budget_amount:'600.00',budget_evidence:'مخصص اختبار داخلي',currency:'SAR'}));
  p=pAct('employee',p,'submit');
  for(const [key,price] of [['media-a','115.00'],['media-b','116.00'],['media-c','117.00']])p=pAct('employee',p,'add_quote',{supplier_key:key,supplier_name:'منصة تجريبية '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'دفع مقدم',delivery_date:'2099-10-20',evidence:'عرض تجريبي '+key});
  p=pAct('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='MEDIA-A').id,note:'ترسية على الأقل سعرًا'});
  p=pAct('manager',p,'approve_order',{terms:'شحن رصيد واحد',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي تجريبي'});
  const direct=spend({amount:'100.00'}).id,paid=spend({amount:'300.00',funding:'agency_on_behalf'}).id,more=spend({amount:'300.00',funding:'agency_on_behalf',spend_date:addDays(today(),-1)}).id;
  assert.throws(()=>tx(()=>linkCommitment(db,users.employee,direct,{purchase_id:p.id,invoice_id:'',note:'صرف العميل مباشرة'})),code('not_on_behalf'));
  tx(()=>linkCommitment(db,users.employee,paid,{purchase_id:p.id,invoice_id:'',note:'الأمر يغطي شحن الرصيد'}));
  assert.throws(()=>tx(()=>linkCommitment(db,users.employee,more,{purchase_id:p.id,invoice_id:'',note:'يتجاوز قيمة الأمر'})),code('commitment_exceeds_order'));
  assert.throws(()=>tx(()=>linkCommitment(db,users['lead-b'],more,{purchase_id:p.id,invoice_id:'',note:'لست في فريق الحساب'})),code('not_found'));
  assert.throws(()=>tx(()=>correctMediaSpend(db,users.employee,paid,{amount:'1.00',evidence_kind:'invoice',evidence_reference:'فاتورة تجريبية',reason:'تصحيح بعد الربط المالي'})),code('commitment_linked'));
  const o=view('employee').on_behalf;
  assert.equal(o.committed_minor,60000);assert.equal(o.linked_minor,30000);assert.equal(o.unlinked_minor,30000);
  assert.equal(o.billed_minor,0);assert.equal(o.unbilled_minor,60000,'what we paid and have not billed is shown, not hidden');
  assert.throws(()=>tx(()=>recordBilling(db,users.employee,campaignId,{claim_id:'00000000-0000-0000-0000-000000000000',amount:'600.00',note:'استحقاق غير موجود للاختبار'})),code('not_found'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_orders').get().n,0,'no payment is created here');
  assert.ok(verifyAudit(db));
});

test('isolation: another account team, an account without the commercial permission, and another tenant see nothing of the campaign spend',t=>{
  const {db,users,tx,campaignId,approvePlan,spend}=fixture(t);
  approvePlan();spend();
  assert.equal(mediaSpendBoard(db,users['lead-b']).campaigns.length,0);
  assert.throws(()=>tx(()=>recordMediaSpend(db,users['lead-b'],campaignId,{channel:'instagram',spend_date:today(),amount:'1.00',evidence_kind:'invoice',evidence_reference:'فاتورة تجريبية',funding:'client_direct'})),code('not_found'));
  assert.throws(()=>tx(()=>recordMediaSpend(db,users.external,campaignId,{channel:'instagram',spend_date:today(),amount:'1.00',evidence_kind:'invoice',evidence_reference:'فاتورة تجريبية',funding:'client_direct'})),code('not_found'));
  // عضو الفريق بلا تصريح المبيعات والتسليم لا يرى الوحدة.
  const noGrant=db.prepare("SELECT id FROM access_grants WHERE user_id='employee' AND capability='commercial.use'").get().id;
  db.prepare("UPDATE access_grants SET revoked_at=?,revoked_by='admin' WHERE id=?").run(new Date().toISOString(),noGrant);
  assert.throws(()=>mediaSpendBoard(db,users.employee),code('not_permitted'));
  assert.throws(()=>spend(),code('not_permitted'));
  assert.ok(verifyAudit(db));
});

test('media spend screen: states it is not connected to any ad platform, escapes values, uses no inline style, and every offered action opens a form',async t=>{
  const {db,users,tx,campaignId,approvePlan,spend}=fixture(t);
  const { mediaSpendUI } = await import('../app/static/media-spend-ui.mjs');
  const { money } = await import('../app/static/operations.mjs');
  approvePlan();spend({evidence_reference:'<b>لقطة تجريبية</b>'});spend({funding:'agency_on_behalf',amount:'10.00'});
  tx(()=>setThreshold(db,users.employee,campaignId,{percent:'5',basis:'عتبة تجريبية منخفضة للاختبار'}));
  tx(()=>saveMediaProfile(db,users.employee,{channel:'instagram',name:'تعيين تجريبي',delimiter:'comma',date_format:'YYYY-MM-DD',header_rows:1,columns:{date:'Day',amount:'Spend'}}));
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),seen=[];
  const button=(action,id,label)=>{seen.push([action,id]);return `<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;};
  const data=mediaSpendBoard(db,users.employee),html=mediaSpendUI.render(data,{e,button,money});
  assert.match(html,/لا اتصال بأي منصة إعلانية/);assert.doesNotMatch(html,/<b>/);assert.doesNotMatch(html,/style=|<script/);
  assert.ok(seen.length>5);
  for(const [action,id] of seen){const spec=mediaSpendUI.form(action,id,data);assert.ok(spec.endpoint.startsWith('/media-spend'),action);assert.ok(Array.isArray(spec.fields),action);}
});
