import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { privacyBoard, subjectRequestsBoard, privacyPosture, subjectDataMap, deletionAssessment,
  suggestedActivities, draftSuggestedActivities, saveActivity, activityAction,
  recordTransfer, transferAction, saveRetentionRule, retentionAction,
  recordIncident, incidentAction, createSubjectRequest, requestAction } from '../app/privacy.mjs';
import { privacyUI, subjectRequestsUI } from '../app/static/privacy-ui.mjs';
import { operationFields, money } from '../app/static/operations.mjs';

const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const shift=n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date(Date.now()+n*86400000));

function open(t){
  const db=openDb(':memory:');seed(db,'synthetic-privacy');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>{grantAccess(db,users.admin,{user_id:'manager',capability:'privacy.manage',note:'تصريح خصوصية تجريبي'});
    grantAccess(db,users.admin,{user_id:'hr',capability:'privacy.manage',note:'تصريح خصوصية تجريبي'});});
  return {db,users,tx};
}
// معدّ مسجل هو manager، ومالك يعتمد هو hr. الفصل بالهوية مقصود في كل حالة أدناه.
const activity={name:'نشاط تجريبي: أرشيف الموظفين',purpose:'حفظ ملفات الموظفين التجريبية لغرض الاختبار وحده.',subject_categories:['employees'],
  data_categories:'الاسم، المسمى الوظيفي',sensitive:false,sensitive_note:'',legal_basis:'',legal_basis_source:'',legal_basis_confirmed_on:'',
  internal_access:'خدمات الموظف التجريبية',retention_period:'',retention_source:'',retention_confirmed_on:'',disposal_action:'',owner_id:'hr',next_review_date:shift(60)};
const complete={...activity,legal_basis:'أساس تجريبي أدخله مختص تجريبي',legal_basis_source:'مصدر تجريبي أكده مستشار تجريبي بتاريخ اليوم',legal_basis_confirmed_on:today(),
  retention_period:'مدة تجريبية يحددها المختص',retention_source:'مصدر مدة تجريبي أكده مختص تجريبي بتاريخ اليوم',retention_confirmed_on:today(),disposal_action:'إتلاف تجريبي موثق'};

test('privacy records: a duration or a legal basis is never stored without its source and the date its owner confirmed it',t=>{
  const {db,users,tx}=open(t);
  assert.throws(()=>tx(()=>saveActivity(db,users.manager,{...activity,retention_period:'خمس سنوات'})),code('invalid_text'),'a retention period with no source is refused');
  assert.throws(()=>tx(()=>saveActivity(db,users.manager,{...activity,legal_basis:'مصلحة مشروعة',legal_basis_source:'مصدر تجريبي مذكور'})),code('invalid_date'),'a legal basis with no confirmation date is refused');
  const id=tx(()=>saveActivity(db,users.manager,activity)).id;
  // القاعدة نفسها ترفض الاقتران الناقص، لا الكود وحده.
  assert.throws(()=>db.prepare("UPDATE processing_activities SET retention_period='سنة',version=version+1 WHERE id=?").run(id),/CHECK|constraint/i);
  const view=privacyBoard(db,users.hr).activities.find(a=>a.id===id);
  assert.equal(view.legal_review,'يحتاج مراجعة قانونية');
  assert.deepEqual(view.gaps,['الأساس النظامي ومصدره','مدة الاحتفاظ ومصدرها','إجراء الإتلاف']);
  assert.ok(verifyAudit(db));
});

test('processing activities: the platform proposes candidates from its own tables, and a human approves them; nothing is recorded automatically',t=>{
  const {db,users,tx}=open(t);
  const suggestions=suggestedActivities(db,users.manager);
  assert.ok(suggestions.length>=5,'candidates are derived from the modules that actually exist');
  const payroll=suggestions.find(s=>s.name.includes('الرواتب'));
  assert.ok(payroll.source_tables.includes('payroll_runs'),'the suggestion names the real tables it was derived from');
  assert.ok(payroll.sensitive===1&&payroll.sensitive_note.includes('قرار المختص'),'the sensitivity flag is a proposal, not a ruling');
  assert.equal(privacyBoard(db,users.manager).activities.length,0,'a suggestion is not a record');
  assert.throws(()=>tx(()=>draftSuggestedActivities(db,users.manager,{owner_id:'manager'})),code('separation_of_duties'));
  const {created}=tx(()=>draftSuggestedActivities(db,users.manager,{owner_id:'hr'}));
  assert.ok(created>=5);
  const drafts=privacyBoard(db,users.hr).activities;
  assert.ok(drafts.every(a=>a.status==='draft'&&!a.legal_basis&&!a.retention_period),'every generated draft starts with no legal basis and no retention period');
  const draft=drafts[0];
  assert.throws(()=>tx(()=>activityAction(db,users.hr,draft.id,'approve_activity',{version:draft.version,note:'اعتماد تجريبي مبكر'})),code('activity_incomplete'));
  assert.equal(tx(()=>draftSuggestedActivities(db,users.manager,{owner_id:'hr'})).created,0,'running the suggestion again duplicates nothing');
  assert.ok(verifyAudit(db));
});

test('processing activities: the preparer never approves, and an approved record is replaced by a new one instead of being edited',t=>{
  const {db,users,tx}=open(t);
  assert.throws(()=>tx(()=>saveActivity(db,users.manager,{...complete,owner_id:'manager'})),code('separation_of_duties'));
  const id=tx(()=>saveActivity(db,users.manager,complete)).id;
  const draft=privacyBoard(db,users.hr).activities.find(a=>a.id===id);
  assert.deepEqual(draft.gaps,[]);
  assert.throws(()=>tx(()=>activityAction(db,users.manager,id,'approve_activity',{version:draft.version,note:'المعد يعتمد نفسه تجريبيًا'})),code('invalid_state'));
  assert.throws(()=>tx(()=>activityAction(db,users.hr,id,'approve_activity',{version:draft.version+5,note:'نسخة قديمة تجريبية'})),code('stale_version'));
  tx(()=>activityAction(db,users.hr,id,'approve_activity',{version:draft.version,note:'أقر بملكية هذا النشاط التجريبي'}));
  const approved=privacyBoard(db,users.hr).activities.find(a=>a.id===id);
  assert.equal(approved.status,'approved');
  assert.deepEqual(approved.actions,['supersede_activity']);
  assert.throws(()=>tx(()=>saveActivity(db,users.manager,{...complete,id,version:approved.version})),code('not_found'),'an approved activity has no draft to edit');
  assert.throws(()=>db.prepare("UPDATE processing_activities SET purpose='غرض جديد صامت',version=version+1 WHERE id=?").run(id),/never edited/);
  assert.throws(()=>tx(()=>activityAction(db,users.hr,id,'supersede_activity',{version:approved.version,note:'المالك يعد بديله بنفسه'})),code('separation_of_duties'));
  const replacement=tx(()=>activityAction(db,users.manager,id,'supersede_activity',{version:approved.version,note:'تصحيح تجريبي لغرض النشاط'})).id;
  const after=privacyBoard(db,users.hr).activities;
  assert.equal(after.find(a=>a.id===id).status,'superseded','the old record stays as it was');
  assert.equal(after.find(a=>a.id===replacement).status,'draft');
  assert.ok(verifyAudit(db));
});

test('tenant isolation: activities of another tenant never appear in this tenant board or self-check',t=>{
  const {db,users,tx}=open(t);
  const time=new Date().toISOString();
  db.prepare("INSERT INTO processing_activities(id,tenant_id,name,purpose,subject_categories,data_categories,owner_id,prepared_by,status,created_at,updated_at) VALUES('foreign','isolated','نشاط كيان معزول','غرض تجريبي في كيان آخر تمامًا','employees','الاسم','external','external','draft',?,?)").run(time,time);
  assert.equal(privacyBoard(db,users.manager).activities.length,0);
  assert.equal(privacyPosture(db,users.manager).activities.total,0);
  assert.throws(()=>subjectDataMap(db,users.manager,'external'),code('not_found'),'a person of another tenant is not mapped here');
  assert.throws(()=>privacyBoard(db,users.employee),code('not_permitted'),'an employee without the capability sees nothing');
  assert.throws(()=>subjectRequestsBoard(db,users.it),code('not_permitted'));
  tx(()=>saveActivity(db,users.manager,activity));
  assert.equal(privacyPosture(db,users.manager).activities.total,1);
  assert.ok(verifyAudit(db));
});

test('cross-border transfer: the platform own call to a model hosted abroad shows as awaiting the owner decision until someone assesses it',t=>{
  const {db,users,tx}=open(t);
  const board=privacyBoard(db,users.manager),ai=board.platform_transfers.find(p=>p.slug==='ai_model_provider');
  assert.ok(ai,'the module own transfer is listed explicitly, not left to be remembered');
  assert.equal(ai.recorded,false);
  assert.match(ai.state,/بانتظار قرار المالك/);
  assert.match(ai.evidence,/غير مفعّلين|مفعّلون/,'the entry is tied to the provider state as it actually is');
  assert.equal(board.posture.transfers.platform_unrecorded,1);
  const input={slug:'ai_model_provider',recipient:'مزود نموذج تجريبي',country:'بلد تجريبي',purpose:'تشغيل مساعدي المنصة على بيانات تجريبية.',data_categories:'نص يلصقه الموظف، فقرات سياسات',safeguard:'',safeguard_source:'',next_review_date:shift(90)};
  const id=tx(()=>recordTransfer(db,users.manager,input)).id;
  assert.throws(()=>tx(()=>recordTransfer(db,users.manager,input)),code('duplicate_transfer'));
  const pending=privacyBoard(db,users.manager).transfers.find(x=>x.id===id);
  assert.equal(pending.state_name,'غير مُقيَّم — بانتظار قرار المالك');
  assert.throws(()=>tx(()=>transferAction(db,users.manager,id,'approve_transfer',{version:pending.version,note:'اعتماد قبل التقييم تجريبيًا'})),code('invalid_state'));
  tx(()=>transferAction(db,users.manager,id,'assess_transfer',{version:pending.version,risk_assessment:'تقييم مخاطر تجريبي مفصل يذكر ما يُرسل ومن يطلع عليه لدى المزود.',safeguard:'ضمانة تعاقدية تجريبية',safeguard_source:'مرجع تجريبي أكده مختص تجريبي',next_review_date:shift(90)}));
  const assessed=privacyBoard(db,users.manager).transfers.find(x=>x.id===id);
  assert.equal(assessed.state_name,'مُقيَّم — بانتظار الاعتماد');
  assert.throws(()=>tx(()=>transferAction(db,users.manager,id,'approve_transfer',{version:assessed.version,note:'المقيّم يعتمد تقييمه تجريبيًا'})),code('invalid_state'),'the assessor is not the approver');
  tx(()=>transferAction(db,users.hr,id,'approve_transfer',{version:assessed.version,note:'اعتماد تجريبي بعد قراءة التقييم'}));
  assert.throws(()=>db.prepare("UPDATE data_transfers SET risk_assessment='تقييم صامت',version=version+1 WHERE id=?").run(id),/not rewritten/);
  const done=privacyBoard(db,users.hr);
  assert.equal(done.platform_transfers[0].state,'معتمد');
  assert.equal(done.posture.transfers.unapproved,0);
  assert.ok(verifyAudit(db));
});

test('subject requests: identity verification cannot be skipped, and the verifier is not the one who answers',t=>{
  const {db,users,tx}=open(t);
  const input={request_type:'access',requester_name:'صاحب بيانات تجريبي',requester_kind:'employee',subject_user_id:'employee',
    request_detail:'طلب اطلاع تجريبي على ما لدى المنصة عني.',received_on:today(),due_date:'',due_source:''};
  assert.throws(()=>tx(()=>createSubjectRequest(db,users.manager,{...input,due_date:shift(10)})),code('invalid_text'),'a deadline with no source is refused');
  const {id,reference}=tx(()=>createSubjectRequest(db,users.manager,input));
  assert.match(reference,/^DSR-\d{4}-0001$/);
  const received=subjectRequestsBoard(db,users.manager).requests.find(r=>r.id===id);
  assert.equal(received.identity_required,true);
  assert.equal(received.data_map,undefined,'no data map before identity is verified');
  assert.throws(()=>tx(()=>requestAction(db,users.manager,id,'answer_request',{version:received.version,response:'رد تجريبي قبل التحقق',response_evidence:'دليل تجريبي'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE subject_requests SET status='answered',answered_by='hr',answered_at='x',response='رد صامت طويل بما يكفي',version=version+1 WHERE id=?").run(id),/CHECK|constraint/i);
  tx(()=>requestAction(db,users.manager,id,'verify_identity',{version:received.version,identity_evidence:'تحقق تجريبي: قارنت الطلب بحساب الموظف التجريبي'}));
  const verified=subjectRequestsBoard(db,users.manager).requests.find(r=>r.id===id);
  assert.equal(verified.state_name,'تحققت الهوية — قيد العمل');
  assert.equal(verified.actions.includes('answer_request'),false,'the verifier cannot answer');
  assert.throws(()=>db.prepare("UPDATE subject_requests SET identity_evidence='دليل صامت',version=version+1 WHERE id=?").run(id),/recorded once/);
  const other=subjectRequestsBoard(db,users.hr).requests.find(r=>r.id===id);
  assert.ok(other.actions.includes('answer_request'));
  tx(()=>requestAction(db,users.hr,id,'set_due_date',{version:other.version,due_date:shift(20),due_source:'مهلة تجريبية أكدها مختص تجريبي بتاريخ اليوم'}));
  const dated=subjectRequestsBoard(db,users.hr).requests.find(r=>r.id===id);
  tx(()=>requestAction(db,users.hr,id,'answer_request',{version:dated.version,response:'رد تجريبي: أُرسل ملخص البيانات للموظف.',response_evidence:'محفوظ في ملف تجريبي رقم 1'}));
  assert.equal(subjectRequestsBoard(db,users.hr).requests.find(r=>r.id===id).state_name,'أُجيب');
  assert.ok(verifyAudit(db));
});

test('subject data map: table names and record counts only, never the contents of anyone record',t=>{
  const {db,users,tx}=open(t);
  tx(()=>saveActivity(db,users.manager,activity));
  const map=subjectDataMap(db,users.hr,'manager');
  assert.ok(map.totals.tables>=2&&map.totals.records>=2);
  assert.ok(map.tables.some(x=>x.table==='users'&&x.role==='subject'));
  assert.ok(map.tables.some(x=>x.table==='audit_events'&&x.role==='actor'),'records he acted on are marked as his footprint, not as data about him');
  for(const row of map.tables)assert.deepEqual(Object.keys(row).sort(),['blocked_by','column','referenced_by','role','rows','table'],'a map row carries no record content');
  assert.equal(JSON.stringify(map).includes(activity.purpose),false);
  assert.ok(verifyAudit(db));
});

test('erasure is never automatic: the assessment names what cannot be removed and why, and the module contains no delete statement',t=>{
  const {db,users,tx}=open(t);
  tx(()=>saveActivity(db,users.manager,activity));
  const assessment=deletionAssessment(db,users.hr,'manager');
  assert.ok(assessment.blocked>=1);
  const audits=assessment.entries.find(e=>e.table==='audit_events');
  assert.equal(audits.removable,false);
  assert.ok(audits.reasons.some(r=>r.includes('أثر فعل')));
  assert.ok(assessment.entries.every(e=>e.reasons.length),'every line says why, including the ones with no technical blocker');
  assert.match(assessment.note,/لا تحذف شيئًا/);
  const source=readFileSync(new URL('../app/privacy.mjs',import.meta.url),'utf8');
  assert.equal(/DELETE\s+FROM/i.test(source),false,'the module has no deletion path at all');
  const before=db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  deletionAssessment(db,users.hr,'manager');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,before,'reading the assessment removes nothing');
  assert.ok(verifyAudit(db));
});

test('retention schedule and incidents: the platform alerts and records, it never disposes and never knows a statutory deadline',t=>{
  const {db,users,tx}=open(t);
  const rule={id:'',version:0,data_category:'فئة بيانات تجريبية',retention_period:'',retention_source:'',confirmed_on:'',disposal_action:'',owner_id:'hr',next_check_date:today()};
  assert.throws(()=>tx(()=>saveRetentionRule(db,users.manager,{...rule,retention_period:'ثلاث سنوات'})),code('invalid_text'));
  const ruleId=tx(()=>saveRetentionRule(db,users.manager,rule)).id;
  const stored=privacyBoard(db,users.hr).retention_rules.find(r=>r.id===ruleId);
  assert.equal(stored.missing_period,true);
  assert.ok(['overdue','due_soon'].includes(stored.state));
  assert.ok(privacyBoard(db,users.hr).inbox.some(x=>x.id===ruleId),'the owner is reminded, and the reminder is all that happens');
  tx(()=>retentionAction(db,users.hr,ruleId,'record_check',{version:stored.version,note:'روجعت الفئة تجريبيًا ولم يُتلف شيء',next_check_date:shift(60)}));
  assert.equal(privacyBoard(db,users.hr).retention_rules.find(r=>r.id===ruleId).state,'scheduled');

  const incident={title:'حادثة تجريبية',description:'وصف تجريبي لحادثة تسريب مفترضة في بيئة اختبار.',impact:'أثر تجريبي محدود',affected_count:3,discovered_on:today(),occurred_on:shift(-1),owner_id:'hr'};
  const incidentId=tx(()=>recordIncident(db,users.manager,incident)).id;
  const open_=privacyBoard(db,users.hr).incidents[0];
  assert.deepEqual(open_.gaps,['مهلة الإبلاغ ومصدرها','خطوات المعالجة','الدروس المستفادة']);
  assert.throws(()=>tx(()=>incidentAction(db,users.hr,incidentId,'update_incident',{version:open_.version,status:'contained',notification_deadline:shift(3),notification_deadline_source:'قصير',notified_on:'',notification_note:'',remediation:'',lessons:''})),code('invalid_text'),'a reporting deadline with no source is refused');
  tx(()=>incidentAction(db,users.hr,incidentId,'update_incident',{version:open_.version,status:'contained',notification_deadline:shift(3),notification_deadline_source:'مهلة تجريبية أكدها مختص تجريبي بتاريخ اليوم',notified_on:today(),notification_note:'إبلاغ تجريبي',remediation:'خطوات معالجة تجريبية موثقة',lessons:'درس تجريبي مستفاد موثق'}));
  const contained=privacyBoard(db,users.hr).incidents[0];
  assert.throws(()=>tx(()=>incidentAction(db,users.manager,incidentId,'close_incident',{version:contained.version,note:'من رفعها يقفلها تجريبيًا'})),code('invalid_state'));
  tx(()=>incidentAction(db,users.hr,incidentId,'close_incident',{version:contained.version,note:'تحققت تجريبيًا من المعالجة قبل الإقفال'}));
  assert.throws(()=>db.prepare("UPDATE privacy_incidents SET lessons='درس صامت',version=version+1 WHERE id=?").run(incidentId),/not rewritten/);
  assert.ok(verifyAudit(db));
});

test('both screens render for the capability holder, every button opens a valid form, and nothing breaks the strict content policy',t=>{
  const {db,users,tx}=open(t);
  tx(()=>draftSuggestedActivities(db,users.manager,{owner_id:'hr'}));
  tx(()=>saveActivity(db,users.manager,complete));
  tx(()=>recordTransfer(db,users.manager,{slug:'',recipient:'جهة تجريبية',country:'بلد تجريبي',purpose:'غرض نقل تجريبي مفصل بما يكفي.',data_categories:'الاسم',safeguard:'',safeguard_source:'',next_review_date:shift(90)}));
  tx(()=>saveRetentionRule(db,users.manager,{id:'',version:0,data_category:'فئة تجريبية',retention_period:'',retention_source:'',confirmed_on:'',disposal_action:'',owner_id:'hr',next_check_date:shift(5)}));
  tx(()=>recordIncident(db,users.manager,{title:'حادثة تجريبية',description:'وصف تجريبي لحادثة في بيئة اختبار مصطنعة.',impact:'أثر تجريبي',affected_count:'',discovered_on:today(),occurred_on:'',owner_id:'hr'}));
  const {id}=tx(()=>createSubjectRequest(db,users.manager,{request_type:'delete',requester_name:'صاحب بيانات تجريبي',requester_kind:'employee',subject_user_id:'employee',request_detail:'طلب حذف تجريبي.',received_on:today(),due_date:'',due_source:''}));
  const fresh=subjectRequestsBoard(db,users.manager).requests.find(r=>r.id===id);
  tx(()=>requestAction(db,users.manager,id,'verify_identity',{version:fresh.version,identity_evidence:'تحقق تجريبي موثق'}));

  const problems=[];
  for(const [key,ui,data] of [['privacy',privacyUI,privacyBoard(db,users.hr)],['subject-requests',subjectRequestsUI,subjectRequestsBoard(db,users.hr)]]){
    const buttons=[],button=(action,rowId,label)=>{buttons.push([action,rowId]);return `<button>${e(label)}</button>`;};
    const html=ui.render(data,{e,button,money});
    if(/style=|<script|https?:\/\//i.test(html))problems.push(`${key}: render breaks the content policy`);
    const text=html.replace(/<[^>]+>/g,' ');
    if(/\bundefined\b|\bNaN\b|\[object /.test(text))problems.push(`${key}: rendered text contains ${text.match(/\bundefined\b|\bNaN\b|\[object /)[0]}`);
    assert.ok(buttons.length>=4,`${key} offers actions`);
    for(const [action,rowId] of buttons){
      try{
        const spec=ui.form(action,rowId,data);
        if(!spec||typeof spec.title!=='string'||!Array.isArray(spec.fields)||typeof spec.toPayload!=='function'||!spec.endpoint)problems.push(`${key}/${action}: incomplete form spec`);
        else if(/\bundefined\b/.test(spec.title+operationFields(spec.fields,e).replace(/<[^>]+>/g,' ')))problems.push(`${key}/${action}: form shows undefined`);
      }catch(error){problems.push(`${key}/${action}: form ${error.message}`);}
    }
  }
  assert.deepEqual(problems,[]);
  // شاشة الطلبات تعرض خريطة الحذف بعد التحقق: أسماء وأعداد، ولا محتوى ولا زر حذف.
  const requests=subjectRequestsBoard(db,users.hr);
  const rendered=subjectRequestsUI.render(requests,{e,button:(a,i,l)=>`<button>${e(l)}</button>`,money});
  assert.match(rendered,/غير قابل للحذف/);
  assert.equal(/زر الحذف|احذف الآن/.test(rendered),false);
  assert.ok(verifyAudit(db));
});

test('self-check: the platform reports its gaps as counts and refuses to hand out a compliance score',t=>{
  const {db,users,tx}=open(t);
  tx(()=>draftSuggestedActivities(db,users.manager,{owner_id:'hr'}));
  const posture=privacyPosture(db,users.hr);
  assert.equal(posture.no_score,true);
  assert.equal(posture.score,undefined);
  assert.equal(/%|percent|نسبة الامتثال|درجة الامتثال/i.test(JSON.stringify({...posture,score_note:''})),false,'no percentage and no score anywhere in the figures');
  assert.equal(posture.activities.without_legal_basis,posture.activities.total);
  assert.equal(posture.activities.without_retention,posture.activities.total);
  assert.equal(posture.transfers.platform_unrecorded,1);
  assert.match(privacyBoard(db,users.hr).note,/تسجّل وتذكّر ولا تفتي/);
  assert.match(subjectRequestsBoard(db,users.hr).note,/لا حذف آليًا/);
  assert.ok(verifyAudit(db));
});
