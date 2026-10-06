import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, CAPABILITIES, defaultCapabilities, isSuperAdmin, revokeAccess } from './access.mjs';

// حملات مراجعة الصلاحيات: يفتحها مسؤول المنصة، فيقرر كل مدير فيمن يتبعه «أُبقيه» أو «أسحبه».
// السحب لا ينفذه النظام: يُنشأ طلب سحب ينفذه إنسان يملك access.manage، لأن السحب الآلي قد يعطّل شخصًا في منتصف عمله.
// الحملة المغلقة دليل مؤرخ للمدقق: من راجع ماذا ومتى وبأي قرار، ولا تُعدَّل.
const byKey=new Map(CAPABILITIES.map(c=>[c.key,c]));
// الاستعمال يُستنتج من audit_events: أفعال صاحب التصريح على أنواع السجلات التي يكتب فيها هذا التصريح.
// استنتاج لا قياس: النوع الواحد قد تكتب فيه عدة تصاريح، والاطلاع لا يُسجَّل أصلًا. ما لا أثر له هنا يُعرض «لا يُقاس» لا «غير مستعمل».
export const USAGE_TRACES={
  'vendors.manage':['vendor'],'vendors.legal':['vendor','vendor_conflict'],'vendors.assess':['vendor'],'vendors.bank':['vendor'],
  'hr.policy.prepare':['hr_policy'],'hr.policy.accept':['hr_policy'],'hr.contracts.manage':['employment_contract'],'hr.contracts.approve':['employment_contract'],
  'hr.attendance.manage':['attendance'],'hr.attendance.approve':['attendance'],'hr.performance.manage':['review_cycle','performance_review','training'],'hr.performance.calibrate':['review_cycle','performance_review'],
  'hr.succession.manage':['succession_plan'],'payroll.prepare':['payroll_run','payroll_adjustment','salary_advance','employee_bank','service_settlement','payroll_retro'],'payroll.review':['payroll_run','payroll_payment'],'payroll.approve':['payroll_run','payroll_payment','service_settlement'],
  'hr.letters.prepare':['letter','letter_request','letter_template','letter_type'],'hr.letters.issue':['letter','letter_request'],'hr.feedback.manage':['feedback_request','feedback_note','one_to_one'],'hr.survey.manage':['pulse_cycle','survey_privacy'],
  'hr.benefits.manage':['medical_policy','medical_enrolment'],'people.manage':['people_onboarding_task','lifecycle_bundle','lifecycle_template','lifecycle_step'],
  'bank.reconcile':['bank_reconciliation','bank_match','bank_import','bank_rule','bank_import_profile','bank_account'],'bank.reconcile.approve':['bank_reconciliation'],
  'billing.recurring.manage':['retainer','retainer_agreement','retainer_period','billing_schedule','billing_draft','advance_invoice','advance_draw'],'finance.close.manage':['close_period','close_task','close_template'],
  'costing.manage':['cost_rate','overhead_rate','job_category','job_category_assignment'],'tax.returns.prepare':['vat_worksheet','zakat_worksheet','withholding','input_tax','vat_export_boxes'],'tax.returns.review':['vat_worksheet','zakat_worksheet'],
  'einvoice.manage':['einvoice_submission','einvoice_override'],'compliance.manage':['compliance'],'privacy.manage':['processing_activity','subject_request','retention_rule','data_transfer','privacy_incident'],
  'governance.objectives.manage':['governance_objective','governance_initiative','governance_indicator'],'governance.risks.manage':['governance_risk','governance_risk_scale'],'governance.decisions.record':['governance_decision','governance_minute','governance_commitment'],
  'contracts.register.manage':['contract_record','contract_obligation','contract_amendment','contract_alert_settings'],'review.manage':['review_route','review_annotation'],'influencers.manage':['influencer','influencer_engagement','influencer_content','influencer_proof'],
  'production.manage':['production','call_sheet','shot','production_crew','production_talent','production_location'],'pr.manage':['pr_pitch','pr_coverage','media_list','media_contact'],'equipment.manage':['equipment_item','equipment_kit','equipment_booking','equipment_maintenance','equipment_inventory'],
  'knowledge.manage':['knowledge_source'],'access.review':['access_review'],'access.manage':['access'],'accounts.manage':['user','employee'],'structure.manage':['department'],'catalog.manage':['service','service_card','service_centre'],'platform.flags':['experience_setting'],
  'clients.manage':['client','client_approver'],'offerings.manage':['offering'],'approvals.record':['external_approval'],'approvals.verify':['external_approval'],'timesheets.approve':['timesheet_period','timesheet_lock','time_entry'],'resourcing.plan':['resource_booking','resource_capacity'],'budgets.use':['project_budget']
};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const USAGE_NAMES={used:'مستعمل خلال نافذة الحملة',unused:'لم يُستعمل خلال نافذة الحملة',unmeasured:'لا يُقاس من سجل التدقيق'};

export function usageOf(db,tenantId,userId,capability,since){
  const types=USAGE_TRACES[capability];if(!types)return {usage_state:'unmeasured',usage_events:null,last_used_at:null};
  const from=new Date(Date.parse(since+'T00:00:00+03:00')).toISOString();
  const row=db.prepare(`SELECT COUNT(*) AS n,MAX(created_at) AS last FROM audit_events WHERE tenant_id=? AND actor_id=? AND created_at>=? AND entity_type IN (${types.map(()=>'?').join(',')})`).get(tenantId,userId,from,...types);
  return {usage_state:row.n?'used':'unused',usage_events:row.n,last_used_at:row.last??null};
}
// ما يدخل المراجعة: كل منح صريح، وكل تصريح حساس يأتي من الدور، والصلاحية الكاملة للأدمن الأول. تصاريح الدور غير الحساسة جزء من تعريف الدور لا قرار فردي.
function entitlements(db,user){
  const out=[];
  for(const g of db.prepare('SELECT id,capability,department_id FROM access_grants WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL ORDER BY capability').all(user.tenant_id,user.id))out.push({capability:g.capability,source:'grant',grant_id:g.id,department_id:g.department_id});
  for(const key of defaultCapabilities(user))if(byKey.get(key)?.sensitive)out.push({capability:key,source:'role',grant_id:null,department_id:null});
  if(isSuperAdmin(user))out.push({capability:'access.manage',source:'admin_level',grant_id:null,department_id:null});
  return out.map(e=>({...e,capability_name:byKey.get(e.capability)?.name??e.capability,sensitive:byKey.get(e.capability)?.sensitive||e.source==='admin_level'?1:0}));
}

function itemView(db,u,campaign,item){
  const open=campaign.status==='open'&&!item.decision,live=open?usageOf(db,u.tenant_id,item.subject_id,item.capability,campaign.usage_since):item;
  return {...item,sensitive:!!item.sensitive,usage_state:live.usage_state,usage_events:live.usage_events,last_used_at:live.last_used_at,usage_name:USAGE_NAMES[live.usage_state]??'',
    // الترتيب الذي يراه المدير: الحساس غير المستعمل أولًا، فهو أول ما يُسحب.
    attention:(live.usage_state==='unused'?2:0)+(item.sensitive?1:0),
    subject_name:name(db,item.subject_id),reviewer_name:name(db,item.reviewer_id),source_name:{grant:'منح صريح',role:'من الدور',admin_level:'أدمن أول'}[item.source],decision_name:item.decision?{keep:'أُبقي',revoke:'طُلب سحبه'}[item.decision]:'لم يُراجع',
    actions:open&&item.reviewer_id===u.id?['keep_access','revoke_access']:[]};
}
function campaignView(db,u,c,oversee){
  const items=db.prepare(`SELECT * FROM access_review_items WHERE campaign_id=? AND tenant_id=? ${oversee?'':'AND reviewer_id=?'} ORDER BY subject_id,capability`).all(...(oversee?[c.id,u.tenant_id]:[c.id,u.tenant_id,u.id])).map(i=>itemView(db,u,c,i)).sort((a,b)=>b.attention-a.attention||a.subject_name.localeCompare(b.subject_name,'ar'));
  const decided=items.filter(i=>i.decision).length;
  return {...c,status_name:c.status==='open'?'مفتوحة':'مغلقة',opened_by_name:name(db,c.opened_by),closed_by_name:name(db,c.closed_by),late:c.status==='open'&&c.due_on<today(),
    totals:{items:items.length,decided,undecided:items.length-decided,keep:items.filter(i=>i.decision==='keep').length,revoke:items.filter(i=>i.decision==='revoke').length,sensitive:items.filter(i=>i.sensitive).length,unused:items.filter(i=>i.usage_state==='unused').length},
    reviewers:oversee?[...new Set(items.map(i=>i.reviewer_id))].map(id=>{const own=items.filter(i=>i.reviewer_id===id);return {id,name:name(db,id),items:own.length,undecided:own.filter(i=>!i.decision).length};}):[],
    items,actions:oversee&&c.status==='open'?['close_campaign']:[]};
}
function requestView(db,u,r,execute){
  return {...r,subject_name:name(db,r.subject_id),requested_by_name:name(db,r.requested_by),executed_by_name:name(db,r.executed_by),capability_name:byKey.get(r.capability)?.name??r.capability,sensitive:!!byKey.get(r.capability)?.sensitive||r.source==='admin_level',
    status_name:{open:'بانتظار التنفيذ',executed:'نُفذ',declined:'رُدّ'}[r.status],
    how:r.source==='grant'?'التنفيذ يسحب المنح الصريح من سجل التصاريح وينهي جلسات صاحبه.':'هذا التصريح يأتي من دور الحساب أو مستواه الإداري: غيّره من شاشة «الموظفون والصلاحيات» ثم وثّق هنا ما فعلت. هذه الشاشة لا تغيّر الدور.',
    // من طلب السحب لا ينفذه، وصاحب التصريح لا يقرر في تصريحه.
    actions:execute&&r.status==='open'&&r.requested_by!==u.id&&r.subject_id!==u.id?['execute_revocation','decline_revocation']:[]};
}

export function accessReviewBoard(db,supplied){
  const u=actor(db,supplied),oversee=can(db,u,'access.review'),execute=can(db,u,'access.manage');
  const mineOnly="AND EXISTS(SELECT 1 FROM access_review_items i WHERE i.campaign_id=c.id AND i.reviewer_id=?)";
  const campaigns=db.prepare(`SELECT c.* FROM access_review_campaigns c WHERE c.tenant_id=? ${oversee?'':mineOnly} ORDER BY c.status DESC,c.opened_at DESC LIMIT 12`).all(...(oversee?[u.tenant_id]:[u.tenant_id,u.id])).map(c=>campaignView(db,u,c,oversee));
  const requests=(oversee||execute?db.prepare('SELECT * FROM access_revocation_requests WHERE tenant_id=? ORDER BY status=\'open\' DESC,requested_at DESC LIMIT 100').all(u.tenant_id):db.prepare('SELECT * FROM access_revocation_requests WHERE tenant_id=? AND requested_by=? ORDER BY requested_at DESC LIMIT 100').all(u.tenant_id,u.id)).map(r=>requestView(db,u,r,execute));
  const open=campaigns.find(c=>c.status==='open'),myOpen=open?open.items.filter(i=>i.actions.length):[];
  // الصندوق الموحد يحتاج سطرًا واحدًا لكل موظف لا سطرًا لكل تصريح.
  const bySubject=new Map();for(const i of myOpen)bySubject.set(i.subject_id,[...(bySubject.get(i.subject_id)??[]),i]);
  return {today:today(),user_id:u.id,can_oversee:oversee,can_execute:execute,usage_names:USAGE_NAMES,campaigns,revocation_requests:requests,
    people:oversee?db.prepare("SELECT id,name,role,admin_level FROM users WHERE tenant_id=? AND active=1 ORDER BY name").all(u.tenant_id).filter(p=>p.admin_level!=='super').map(p=>({id:p.id,name:p.name})):[],
    actions:oversee&&!db.prepare("SELECT 1 FROM access_review_campaigns WHERE tenant_id=? AND status='open'").get(u.tenant_id)?['open_campaign']:[],
    awaiting_me:[...[...bySubject].map(([subjectId,list])=>({id:subjectId,title:`مراجعة تصاريح ${list[0].subject_name}`,context:`${list.length} تصريحًا · ${open.title}`,created_at:open.opened_at,actions:['review_access']})),
      ...requests.filter(r=>r.actions.length).map(r=>({id:r.id,title:`طلب سحب: ${r.capability_name} — ${r.subject_name}`,context:`طلبه ${r.requested_by_name}`,created_at:r.requested_at,actions:['decide_revocation']}))],
    note:'يدخل المراجعة كل منح صريح، وكل تصريح حساس يأتي من الدور، والصلاحية الكاملة للأدمن الأول؛ تصاريح الدور غير الحساسة جزء من تعريف الدور. الاستعمال مستنتج من سجل التدقيق (أفعال الكتابة على السجلات المرتبطة بالتصريح) لا مقيس: الاطلاع لا يُسجَّل، و«لا يُقاس» تعني أن لا أثر يمكن ربطه بالتصريح. قرار السحب يُنشئ طلبًا ينفذه حامل access.manage بنفسه؛ المنصة لا تسحب شيئًا آليًا.'};
}

export function openCampaign(db,supplied,input){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'access.review'))fail(403,'not_permitted','فتح حملات المراجعة لحامل تصريحها من مسؤولي المنصة');
  v.object(input,['title','usage_since','due_on','top_reviewer_id','second_reviewer_id']);
  if(db.prepare("SELECT 1 FROM access_review_campaigns WHERE tenant_id=? AND status='open'").get(u.tenant_id))fail(409,'campaign_open','توجد حملة مفتوحة؛ أغلقها قبل فتح أخرى');
  const date=today(),since=v.date(input.usage_since),due=v.date(input.due_on);
  if(since>=date)fail(400,'usage_since','بداية نافذة الاستعمال قبل اليوم');if(due<date)fail(400,'due_on','موعد الحملة اليوم أو بعده');
  const users=db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1 ORDER BY id').all(u.tenant_id),byId=new Map(users.map(x=>[x.id,x]));
  // من لا مدير فوقه في المنصة يراجعه «المراجع الأعلى» الذي يسميه فاتح الحملة؛ والمراجع الأعلى نفسه يراجعه مراجع ثانٍ.
  const reviewer=(key,label)=>{if(!input[key])return null;const r=byId.get(input[key]);if(!r)fail(400,key,`${label} غير متاح`);if(isSuperAdmin(r))fail(409,'separation_of_duties',`${label} لا يكون أدمن أول: من يطلب السحب لا ينفذه`);return r.id;};
  const top=reviewer('top_reviewer_id','المراجع الأعلى'),second=reviewer('second_reviewer_id','المراجع الثاني');
  if(top&&top===second)fail(400,'second_reviewer_id','المراجع الثاني غير المراجع الأعلى');
  const campaignId=randomUUID(),time=now(),rows=[];
  for(const subject of users){
    const list=entitlements(db,subject);if(!list.length)continue;
    const manager=byId.get(subject.manager_id),reviewerId=manager&&manager.id!==subject.id?manager.id:top&&top!==subject.id?top:second&&second!==subject.id?second:null;
    if(!reviewerId)fail(409,'reviewer_required',`${subject.name}: لا مدير فوقه في المنصة. سمِّ ${top===subject.id?'مراجعًا ثانيًا':'مراجعًا أعلى'} يراجع تصاريحه`);
    for(const e of list)rows.push({...e,subject_id:subject.id,reviewer_id:reviewerId});
  }
  if(!rows.length)fail(409,'nothing_to_review','لا تصاريح تدخل المراجعة');
  db.prepare('INSERT INTO access_review_campaigns(id,tenant_id,title,usage_since,due_on,opened_by,opened_at) VALUES(?,?,?,?,?,?,?)').run(campaignId,u.tenant_id,v.text(input.title,'اسم الحملة',160,5),since,due,u.id,time);
  for(const r of rows)db.prepare('INSERT INTO access_review_items(id,tenant_id,campaign_id,subject_id,reviewer_id,capability,capability_name,source,grant_id,department_id,sensitive) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),u.tenant_id,campaignId,r.subject_id,r.reviewer_id,r.capability,r.capability_name,r.source,r.grant_id,r.department_id,r.sensitive);
  audit(db,u,'access_review',campaignId,'access_review.opened',{}, {items:rows.length,subjects:new Set(rows.map(r=>r.subject_id)).size,reviewers:new Set(rows.map(r=>r.reviewer_id)).size,usage_since:since,due_on:due});
  return {id:campaignId};
}

export function decideItem(db,supplied,itemId,input){
  writing(db);const u=actor(db,supplied);v.object(input,['version','decision','reason']);
  const item=typeof itemId==='string'&&db.prepare('SELECT * FROM access_review_items WHERE id=? AND tenant_id=?').get(itemId,u.tenant_id);
  // غير المراجع المسمى لا يعرف بوجود البند أصلًا.
  if(!item||(item.reviewer_id!==u.id&&item.subject_id!==u.id&&!can(db,u,'access.review')))fail(404,'not_found','بند المراجعة غير متاح');
  if(item.subject_id===u.id)fail(409,'separation_of_duties','لا تراجع تصاريحك بنفسك؛ يراجعها من فوقك');
  if(item.reviewer_id!==u.id)fail(403,'not_reviewer','القرار للمراجع المسمى في الحملة وحده');
  v.version(input.version,item.version);
  const campaign=db.prepare('SELECT * FROM access_review_campaigns WHERE id=? AND tenant_id=?').get(item.campaign_id,u.tenant_id);
  if(campaign.status!=='open'||item.decision)fail(409,'action_unavailable',campaign.status!=='open'?'الحملة مغلقة ولا تُعدَّل':'سُجّل القرار في هذا البند');
  if(!['keep','revoke'].includes(input.decision))fail(400,'decision','اختر: أُبقيه أو أسحبه');
  const needsReason=input.decision==='revoke'||item.sensitive,reason=needsReason?v.text(input.reason,input.decision==='revoke'?'سبب السحب':'سبب الإبقاء على تصريح حساس',1000,10):input.reason?v.text(input.reason,'ملاحظة',1000,3):'';
  const usage=usageOf(db,u.tenant_id,item.subject_id,item.capability,campaign.usage_since),time=now();
  db.prepare('UPDATE access_review_items SET decision=?,reason=?,usage_state=?,usage_events=?,last_used_at=?,decided_by=?,decided_at=?,version=version+1 WHERE id=?').run(input.decision,reason,usage.usage_state,usage.usage_events,usage.last_used_at,u.id,time,item.id);
  let requestId=null;
  if(input.decision==='revoke'){
    requestId=randomUUID();
    db.prepare('INSERT INTO access_revocation_requests(id,tenant_id,campaign_id,item_id,subject_id,capability,source,grant_id,reason,requested_by,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(requestId,u.tenant_id,campaign.id,item.id,item.subject_id,item.capability,item.source,item.grant_id,reason,u.id,time);
  }
  audit(db,u,'access_review',item.id,'access_review.'+input.decision,{}, {campaign_id:campaign.id,subject_id:item.subject_id,capability:item.capability,usage_state:usage.usage_state,revocation_request:requestId},reason);
  return {id:item.id,decision:input.decision,revocation_request_id:requestId};
}

export function closeCampaign(db,supplied,campaignId,input){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'access.review'))fail(403,'not_permitted','إغلاق الحملة لحامل تصريح حملات المراجعة');
  v.object(input,['version','note','accept_incomplete']);
  const c=typeof campaignId==='string'&&db.prepare('SELECT * FROM access_review_campaigns WHERE id=? AND tenant_id=?').get(campaignId,u.tenant_id);
  if(!c)fail(404,'not_found','الحملة غير متاحة');
  v.version(input.version,c.version);
  if(c.status!=='open')fail(409,'action_unavailable','الحملة مغلقة ولا تُعدَّل');
  const undecided=db.prepare('SELECT * FROM access_review_items WHERE campaign_id=? AND decision IS NULL').all(c.id);
  // الإغلاق الناقص مسموح بإقرار صريح فقط، ويبقى ما لم يُراجع مسجلًا «لم يُراجع»: الدليل يقول ما حدث لا ما كان ينبغي.
  if(undecided.length&&input.accept_incomplete!==true)fail(409,'review_incomplete',`${undecided.length} بندًا لم يُراجع. أكمل المراجعة أو أقرّ بالإغلاق الناقص`);
  const note=v.text(input.note,'ملاحظة الإغلاق',1500,10),time=now();
  for(const item of undecided){const usage=usageOf(db,u.tenant_id,item.subject_id,item.capability,c.usage_since);db.prepare('UPDATE access_review_items SET usage_state=?,usage_events=?,last_used_at=?,version=version+1 WHERE id=?').run(usage.usage_state,usage.usage_events,usage.last_used_at,item.id);}
  db.prepare("UPDATE access_review_campaigns SET status='closed',closed_by=?,closed_at=?,close_note=?,version=version+1 WHERE id=?").run(u.id,time,note,c.id);
  audit(db,u,'access_review',c.id,'access_review.closed',{status:'open'},{status:'closed',left_undecided:undecided.length},note);
  return {id:c.id,left_undecided:undecided.length};
}

export function revocationAction(db,supplied,requestId,action,input){
  writing(db);const u=actor(db,supplied);if(!['execute_revocation','decline_revocation'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  if(!can(db,u,'access.manage'))fail(403,'not_permitted','تنفيذ طلبات السحب لمن يملك منح التصاريح وسحبها');
  v.object(input,['version','note']);
  const r=typeof requestId==='string'&&db.prepare('SELECT * FROM access_revocation_requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!r)fail(404,'not_found','طلب السحب غير متاح');
  v.version(input.version,r.version);
  if(r.status!=='open')fail(409,'action_unavailable','حُسم هذا الطلب');
  if(r.requested_by===u.id)fail(409,'separation_of_duties','من طلب السحب لا ينفذه ولا يرده');
  if(r.subject_id===u.id)fail(409,'separation_of_duties','لا تقرر في سحب تصريحك؛ ينفذه أدمن أول آخر');
  const note=v.text(input.note,action==='execute_revocation'?'ما الذي نفذته':'سبب رد الطلب',1500,10),time=now(),executed=action==='execute_revocation';
  let grantState=null;
  if(executed&&r.source==='grant'){
    // المنح قد يكون سُحب من شاشة الصلاحيات قبل الوصول إلى الطلب؛ يُوثَّق ذلك ولا يُعد خطأ.
    const live=db.prepare('SELECT 1 FROM access_grants WHERE id=? AND tenant_id=? AND revoked_at IS NULL').get(r.grant_id,u.tenant_id);
    if(live)revokeAccess(db,u,r.grant_id,{reason:`حملة مراجعة الصلاحيات: ${r.reason}`.slice(0,500)});
    grantState=live?'revoked_now':'already_revoked';
  }
  db.prepare('UPDATE access_revocation_requests SET status=?,executed_by=?,executed_at=?,execution_note=?,version=version+1 WHERE id=?').run(executed?'executed':'declined',u.id,time,note,r.id);
  audit(db,u,'access_review',r.id,executed?'access_review.revocation_executed':'access_review.revocation_declined',{status:'open'},{status:executed?'executed':'declined',subject_id:r.subject_id,capability:r.capability,grant:grantState},note);
  return {id:r.id,status:executed?'executed':'declined',grant:grantState};
}
