import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign, campaignAction, campaignsBoard } from '../app/campaigns.mjs';
import { mediaSpendBoard, prepareMediaPlan, mediaPlanAction, recordMediaSpend, correctMediaSpend, saveMediaProfile, importMediaSpend, cancelMediaImport } from '../app/media-spend.mjs';
import { createTemplate, generateReport, readClientReport } from '../app/client-reports.mjs';
import { runReport } from '../app/reports.mjs';

// الحزمة 4، DOMAIN-2 — ريال واحد ومصدر واحد. كان للصرف الإعلامي سجلّان: قيود «صرف» داخل الحملة (campaign_entries) يقرؤها R22
// وتكتبها شاشة الحملات، وسجل الصرف الإعلامي (media_spend_entries) يقرؤه تقرير العميل ولوحة الصرف. فيخرج للعميل رقم، ويقرأ
// المدير في R22 رقمًا ثانيًا للحملة نفسها والفترة نفسها. صار سجل الصرف الإعلامي هو المصدر الوحيد: R22 يقرؤه بشرط تقرير العميل
// نفسه، والحملة ترفض قيد «صرف» متى اعتُمدت لها خطة صرف (والقاعدة ترفضه بقادح الترحيل 192). كل البيانات مصطنعة (تجريبي).

const PASSWORD='synthetic-media-spend-truth';
const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const minor=sar=>Math.round(sar*100);

function fixture(t,db=openDb(':memory:')){
  seed(db,PASSWORD);t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-b','36t','creative','lead-b','مديرة حساب أخرى (تجريبي)','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const who of ['employee','manager','lead-b'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'commercial.use',department_id:'creative',note:'تصريح اختبار تجريبي'}));
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة عميل الريال الواحد التجريبية',trade_name:'عميل الريال الواحد',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'مشترية وسائط (تجريبي)'}));
  // فريق حساب آخر بعميله: يفتح R22 ولا يرى حملات غيره.
  tx(()=>createClient(db,users['lead-b'],{legal_name:'شركة عميل آخر تجريبية',trade_name:'عميل آخر',sector:'مطاعم',status:'active'}));
  const start=addDays(today(),-9),end=addDays(today(),10);
  const launch=name=>{
    const id=tx(()=>createCampaign(db,users.employee,{client_id:clientId,name,objective:'اختبار مصدر واحد للصرف الإعلامي على بيانات مصطنعة',channels:['instagram','google_ads'],
      targets:[{metric:'نقرات',target:20000,unit:'نقرة'}],media_budget:'10000.00',budget_reference:'بريد اعتماد العميل التجريبي',start_date:start,end_date:end})).id;
    const camp=who=>campaignsBoard(db,users[who]).campaigns.find(c=>c.id===id);
    const act=(who,action,values={})=>tx(()=>campaignAction(db,users[who],id,action,{version:camp(who).version,...values}));
    for(const item of camp('employee').checklist)act('employee','check',{key:item.key,evidence:'دليل تجريبي لاكتمال البند'});
    act('employee','request_launch');act('manager','approve_launch',{note:'اعتماد إطلاق تجريبي بعد المراجعة'});
    return {id,camp,act};
  };
  const lines=[{channel:'instagram',start_date:start,end_date:end,planned:'6000.00',target_metric:'نقرات',target_value:12000,target_unit:'نقرة'},
    {channel:'google_ads',start_date:start,end_date:end,planned:'4000.00',target_metric:'نقرات',target_value:8000,target_unit:'نقرة'}];
  const board=(who,campaignId)=>mediaSpendBoard(db,users[who]).campaigns.find(c=>c.id===campaignId);
  const approvePlan=(campaignId,planLines=lines)=>{
    const planId=tx(()=>prepareMediaPlan(db,users.employee,{campaign_id:campaignId,budget_reference:'توزيع معتمد في محضر تجريبي',lines:planLines})).id;
    tx(()=>mediaPlanAction(db,users.manager,planId,'approve_plan',{version:board('manager',campaignId).draft.version,note:'راجعت التوزيع مقابل ميزانية العميل'}));
    return planId;
  };
  const spend=(campaignId,values)=>tx(()=>recordMediaSpend(db,users.employee,campaignId,{channel:'instagram',spend_date:today(),amount:'1000.00',
    evidence_kind:'platform_screenshot',evidence_reference:'لقطة لوحة إعلانات تجريبية محفوظة',funding:'client_direct',...values})).id;
  return {db,users,tx,clientId,start,end,lines,launch,board,approvePlan,spend};
}
// تقرير العميل لعميل الحملة عن فترة: مجموع «المصروف في الفترة» لكل قناة في قسم الصرف، للحملة المسماة.
function clientReportSpend(f,campaignName,from,to){
  const {db,users,tx,clientId}=f;
  let template=db.prepare('SELECT id FROM client_report_templates WHERE client_id=?').get(clientId)?.id;
  template??=tx(()=>createTemplate(db,users.manager,{client_id:clientId,name:'تقرير الصرف التجريبي',cadence:'monthly',sections:['media_spend']})).id;
  const reportId=tx(()=>generateReport(db,users.employee,{template_id:template,period_start:from,period_end:to,title:`تقرير الصرف ${from} إلى ${to}`,supersedes_id:''})).id;
  const group=readClientReport(db,users.employee,reportId).body.sections.find(s=>s.key==='media_spend').groups.find(g=>g.title===campaignName);
  const figures=(group?.figures??[]).filter(x=>x.label.endsWith('المصروف في الفترة'));
  return {total:figures.reduce((n,x)=>n+x.value,0),byLabel:Object.fromEntries(figures.map(x=>[x.label,x.value]))};
}

test('one riyal, one source: for the same campaign and period R22 equals the media-spend board equals the client report — corrections, a cancelled import and a superseded plan revision included, and spend typed into the campaign screen before the plan counts in none of them',t=>{
  const f=fixture(t),{db,users,tx,start,approvePlan,spend,board,launch}=f;
  const {id:campaignId,act}=launch('حملة الريال الواحد التجريبية');
  // قيد «صرف» كُتب في شاشة الحملة قبل اعتماد خطة الصرف: تاريخٌ في السجل القديم، لا رقمٌ في أي تقرير.
  act('employee','spend',{entry_date:addDays(today(),-6),channel:'instagram',amount:'9999.00',source:'لوحة إعلانات قديمة تجريبية'});
  approvePlan(campaignId);
  const wrong=spend(campaignId,{spend_date:addDays(today(),-5)});
  tx(()=>correctMediaSpend(db,users.employee,wrong,{amount:'1200.00',evidence_kind:'account_statement',evidence_reference:'كشف حساب المنصة التجريبي',reason:'اللقطة التقطت قبل اكتمال اليوم'}));
  spend(campaignId,{channel:'google_ads',spend_date:addDays(today(),-3),amount:'500.00',evidence_kind:'invoice',evidence_reference:'فاتورة منصة تجريبية رقم 7'});
  const profile=tx(()=>saveMediaProfile(db,users.employee,{channel:'instagram',name:'تصدير مدير الإعلانات التجريبي',delimiter:'comma',date_format:'YYYY-MM-DD',header_rows:1,columns:{date:'Day',amount:'Spend'}})).id;
  const file=(name,rows)=>({profile_id:profile,file_name:name,content:`Day,Spend\n${rows.map(([d,a])=>`${d},${a}`).join('\n')}\n`,campaign_match:'',evidence_kind:'platform_screenshot',evidence_reference:'ملف مصدّر من لوحة المنصة ومحفوظ في مجلد الحملة',funding:'client_direct'});
  const cancelled=tx(()=>importMediaSpend(db,users.employee,campaignId,file('export-1.csv',[[addDays(today(),-2),'250.50'],[addDays(today(),-1),'300.00']]))).id;
  const batch=board('employee',campaignId).imports.find(i=>i.id===cancelled);
  tx(()=>cancelMediaImport(db,users.employee,cancelled,{version:batch.version,reason:'الملف صُدّر بالمنطقة الزمنية الخطأ'}));
  tx(()=>importMediaSpend(db,users.employee,campaignId,file('export-2.csv',[[addDays(today(),-1),'100.00']])));
  // نسخة ثانية من الخطة تحل محل الأولى؛ صرف النسخة الأولى يبقى صرفًا.
  approvePlan(campaignId,f.lines.map(l=>({...l,planned:'5000.00'})));
  spend(campaignId,{channel:'google_ads',spend_date:today(),amount:'700.00'});

  // الحملة كلها حتى اليوم: إنستغرام 1200 (بعد التصحيح) + 100 (الدفعة السارية)، وقوقل 500 + 700. لا 9999 ولا الدفعة الملغاة.
  const whole=board('employee',campaignId).pacing.actual_minor;
  assert.equal(whole,250000,'the board counts the live ledger lines only');
  const r22=from=>to=>runReport(db,users.employee,'R22',{from,to}).rows.find(r=>r.campaign==='حملة الريال الواحد التجريبية');
  let row=r22(start)(today());
  assert.equal(minor(row.spent),whole,'R22 = the media-spend board (it used to read the 9,999.00 typed into the campaign screen)');
  assert.equal(clientReportSpend(f,'حملة الريال الواحد التجريبية',start,today()).total,whole,'the client report = the media-spend board');
  assert.equal(minor(row.spent_to_date),whole);
  assert.equal(row.plan,'النسخة 2');assert.equal(minor(row.planned),1000000);assert.equal(row.spent_share,25);
  assert.match(row.by_channel,/إنستغرام: 1,300\.00/);assert.match(row.by_channel,/إعلانات قوقل: 1,200\.00/);
  // فترة أضيق: R22 يقرأ بشرط تقرير العميل نفسه — تاريخ الصرف بين البداية والنهاية.
  const from=addDays(today(),-3),to=addDays(today(),-1);
  row=r22(from)(to);
  const narrow=clientReportSpend(f,'حملة الريال الواحد التجريبية',from,to);
  assert.equal(minor(row.spent),60000,'500.00 on google ads and 100.00 on instagram, nothing else in the three days');
  assert.equal(minor(row.spent),narrow.total,'R22 = the client report for the same period');
  assert.deepEqual(narrow.byLabel,{'إنستغرام — المصروف في الفترة':10000,'إعلانات قوقل — المصروف في الفترة':50000});
  assert.equal(minor(row.spent_to_date),180000,'to the end of the period: everything but the 700.00 spent today');
  // فريق حساب آخر لا يرى الحملة في R22.
  assert.equal(runReport(db,users['lead-b'],'R22',{from:start,to:today()}).rows.some(r=>r.campaign==='حملة الريال الواحد التجريبية'),false);
  assert.ok(verifyAudit(db));
});

test('R22 shows a campaign without an approved media plan as having no ledger yet — not as the spend typed into the campaign screen, and not as zero',t=>{
  const f=fixture(t),{db,users,start,launch}=f;
  const {act}=launch('حملة بلا خطة صرف تجريبية');
  act('employee','spend',{entry_date:addDays(today(),-1),channel:'instagram',amount:'300.00',source:'لوحة إعلانات تجريبية'});
  const row=runReport(db,users.employee,'R22',{from:start,to:today()}).rows.find(r=>r.campaign==='حملة بلا خطة صرف تجريبية');
  assert.ok(row,'the campaign is listed: a budget with no approved spend plan is something to see');
  assert.equal(row.spent,null,'no ledger, no figure — the 300.00 in the campaign screen is not media spend');
  assert.equal(row.spent_to_date,null);assert.equal(row.planned,null);assert.equal(row.plan,'بلا خطة صرف معتمدة');
  assert.equal(clientReportSpend(f,'حملة بلا خطة صرف تجريبية',start,today()).total,0,'the client report shows nothing for it either');
  assert.match(runReport(db,users.employee,'R22',{from:start,to:today()}).notes.join(' '),/سجل الصرف الإعلامي/);
});

test('once an approved media plan exists the campaign refuses a spend entry — and a correction of an old one — with a named reason that points to the media-spend screen, the database refuses it too, and the campaign tile reads the ledger',async t=>{
  const f=fixture(t),{db,users,tx,approvePlan,spend,board,launch}=f;
  const {id:campaignId,camp,act}=launch('حملة الصرف المنقول التجريبية');
  act('employee','result',{entry_date:addDays(today(),-1),metric:'نقرات',value:1500,source:'لوحة المنصة التجريبية'});
  act('employee','spend',{entry_date:addDays(today(),-2),channel:'instagram',amount:'400.00',source:'لوحة إعلانات قديمة تجريبية'});
  assert.ok(camp('employee').actions.includes('record_spend'),'before a plan the campaign still records spend');
  approvePlan(campaignId);
  spend(campaignId,{amount:'250.00'});
  const view=camp('employee');
  assert.equal(view.actions.includes('record_spend'),false,'the screen no longer offers spend on the campaign');
  assert.equal(view.spent_minor,board('employee',campaignId).pacing.actual_minor,'the campaign tile reads the same ledger as the media-spend board');
  assert.equal(view.spent_minor,25000);
  assert.deepEqual(view.spend_ledger,{plan_revision:1,legacy_spend_minor:40000});
  const legacy=view.entries.find(e=>e.kind==='spend'),result=view.entries.find(e=>e.kind==='result');
  assert.equal(legacy.correctable,false);assert.equal(result.correctable,true);
  const refused=error=>{
    assert.equal(error.code,'spend_in_media_ledger');assert.equal(error.status,409);
    const r=error.details.refusal;
    assert.equal(r.link,'#media-spend');assert.match(r.next,/الصرف الإعلامي/);assert.ok(r.missing.length&&r.missing.every(m=>m.owner&&m.document));
    return true;
  };
  assert.throws(()=>act('employee','spend',{entry_date:today(),channel:'instagram',amount:'100.00',source:'لوحة إعلانات تجريبية'}),refused);
  assert.throws(()=>act('manager','correct',{entry_id:legacy.id,value:'0.00',source:'تصحيح قيد صرف قديم بعد اعتماد الخطة'}),refused);
  act('manager','correct',{entry_id:result.id,value:1600,source:'الرقم السابق قبل اكتمال اليوم في لوحة المنصة'});
  assert.equal(camp('employee').targets[0].actual,1600,'results are still corrected in the campaign');
  // القاعدة نفسها، لا الكود وحده (الترحيل 192).
  assert.throws(()=>db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,channel,value,source,recorded_by,created_at) VALUES('raw-spend',?,'spend',?,'instagram',100,'إدخال مباشر تجريبي','employee','2026-09-30T08:00:00.000Z')").run(campaignId,today()),/media_spend_entries/);
  db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,metric,value,source,recorded_by,created_at) VALUES('raw-result',?,'result',?,'نقرات',1,'إدخال مباشر تجريبي','employee','2026-09-30T08:00:00.000Z')").run(campaignId,today());
  // حملة بلا خطة صرف لا يمسها شيء.
  const other=launch('حملة بلا خطة تجريبية');
  other.act('employee','spend',{entry_date:today(),channel:'instagram',amount:'50.00',source:'لوحة إعلانات تجريبية'});
  assert.equal(other.camp('employee').spent_minor,5000);assert.equal(other.camp('employee').spend_ledger,null);
  // الشاشة: لا زر صرف، وسطر يدل على شاشة الصرف الإعلامي، ونموذج التصحيح لا يعرض قيد الصرف القديم.
  const { campaignsUI } = await import('../app/static/campaigns-ui.mjs');
  const { money } = await import('../app/static/operations.mjs');
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),seen=[];
  const button=(action,id,label)=>{seen.push([action,id]);return `<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;};
  const data=campaignsBoard(db,users.employee),html=campaignsUI.render(data,{e,button,money});
  assert.equal(seen.some(([action,id])=>action==='record_spend'&&id===campaignId),false);
  assert.match(html,/href="#media-spend"/);assert.match(html,/400\.00/,'the old campaign-screen spend stays visible as history');
  assert.doesNotMatch(html,/style=/);
  const form=campaignsUI.form('correct_entry',campaignId,data);
  assert.deepEqual(form.fields[0].options.map(o=>o.value).includes(legacy.id),false);
  for(const [action,id] of seen)if(id)assert.ok(campaignsUI.form(action,id,data).endpoint,action);
  assert.ok(verifyAudit(db));
});

/* ───── الترحيل 192 ───── */
function applyMigration(raw,version,sql){
  raw.exec('BEGIN');
  try{raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');}
  catch(error){raw.exec('ROLLBACK');throw error;}
}
const MIGRATIONS=new URL('../app/migrations/',import.meta.url);
const MIGRATION=readdirSync(MIGRATIONS).find(name=>name.startsWith('192-'));

test('migration 192 applies cleanly from empty and on a database that already carries 193: spend typed into a campaign before its plan stays as recorded, the trigger exists, keys and the audit chain are clean, and afterwards the database refuses new campaign spend once a plan is approved',t=>{
  assert.ok(MIGRATION,'migration 192 exists');
  // من الصفر: openDb يطبّق كل الترحيلات بما فيها 192.
  const fresh=openDb(':memory:');t.after(()=>fresh.close());
  assert.ok(fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='campaign_entries_spend_after_media_plan'").get());
  assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(),[]);
  // قاعدة قائمة: كل الترحيلات إلا 192 (193 مطبّق قبلها، والرقم الناقص تحت الأعلى يُطبَّق كما في app/db.mjs).
  const raw=new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(MIGRATIONS).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()){
    const version=Number(file.slice(0,3));
    if(version!==192)applyMigration(raw,version,readFileSync(new URL(file,MIGRATIONS),'utf8'));
  }
  assert.ok(raw.prepare('SELECT 1 FROM schema_migrations WHERE version=193').get());
  const f=fixture(t,raw),{db,approvePlan,spend,launch}=f;
  const {id:campaignId,act}=launch('حملة قبل الترحيل التجريبية');
  act('employee','spend',{entry_date:addDays(today(),-2),channel:'instagram',amount:'400.00',source:'لوحة إعلانات قديمة تجريبية'});
  approvePlan(campaignId);spend(campaignId,{amount:'250.00'});
  // قبل 192 كانت القاعدة تقبل قيد صرف في الحملة بعد اعتماد الخطة: هذا هو الصف الذي كان يصنع الرقم الثاني.
  db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,channel,value,source,recorded_by,created_at) VALUES('pre-192',?,'spend',?,'instagram',7000,'قيد كُتب بعد الخطة قبل الترحيل','employee','2026-09-30T08:00:00.000Z')").run(campaignId,today());
  const snapshot=()=>db.prepare('SELECT * FROM campaign_entries ORDER BY id').all().map(r=>JSON.stringify(r));
  const before=snapshot(),ledger=db.prepare('SELECT COUNT(*) AS n FROM media_spend_entries').get().n,auditBefore=db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  applyMigration(db,192,readFileSync(new URL(MIGRATION,MIGRATIONS),'utf8'));
  assert.deepEqual(snapshot(),before,'history is preserved: no campaign entry moves or disappears');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_spend_entries').get().n,ledger);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,auditBefore,'the migration writes no audit event of its own');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(verifyAudit(db));
  assert.throws(()=>db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,channel,value,source,recorded_by,created_at) VALUES('post-192',?,'spend',?,'instagram',100,'إدخال مباشر تجريبي','employee','2026-09-30T08:00:00.000Z')").run(campaignId,today()),/media_spend_entries/);
  assert.throws(()=>db.prepare("INSERT INTO campaign_entries(id,campaign_id,kind,entry_date,channel,value,source,corrects_id,recorded_by,created_at) VALUES('post-192-fix',?,'spend',?,'instagram',0,'تصحيح مباشر تجريبي','pre-192','employee','2026-09-30T08:00:00.000Z')").run(campaignId,today()),/media_spend_entries/,'a correction is a spend row too');
  const other=launch('حملة بلا خطة بعد الترحيل التجريبية');
  other.act('employee','spend',{entry_date:today(),channel:'instagram',amount:'50.00',source:'لوحة إعلانات تجريبية'});
});
