import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// سجل الموافقات الخارجية (بديل ACC-04 المستبعد): موظف مخول يوثق ما وصله من العميل خارج المنصة.
// السجل يحفظ من أدخل ومن تحقق؛ ولا يُعرض بوصفه توقيعًا إلكترونيًا للعميل.
export const CHANNELS=[['email','بريد إلكتروني'],['signed_document','مستند موقع'],['meeting_minutes','محضر اجتماع معتمد'],['message','رسالة نصية أو تطبيق تواصل'],['call','اتصال هاتفي']].map(([key,name])=>({key,name}));
export const DECISIONS=[['approved','موافقة'],['approved_with_conditions','موافقة بشروط'],['changes_requested','طلب تعديل'],['rejected','رفض']].map(([key,name])=>({key,name}));
export const STATUS_NAMES={pending_evidence:'بانتظار الدليل',documented:'موثق',verified:'متحقق منه',withdrawn:'مسحوب'};
const roles=['employee','manager','pm'];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const id=()=>randomUUID();

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','يتطلب توثيق الموافقة معاملة قاعدة بيانات');}
function permissions(db,u){return ['approvals.record','approvals.verify'].filter(key=>can(db,u,key));}
function requireAny(db,u){const list=permissions(db,u);if(!list.length||!roles.includes(u.role))fail(403,'not_permitted','لا يوجد تصريح لسجل موافقات العملاء. اطلبه من مسؤول الصلاحيات');return list;}
// العزل بين الحسابات: لا يرى الموظف إلا مشاريع هو عضو فيها، حتى مع التصريح.
function memberProjects(db,u){return db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.name').all(u.tenant_id,u.id);}
function requireProject(db,u,projectId){
  const project=typeof projectId==='string'&&db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(projectId,u.tenant_id,u.id);
  if(!project)fail(404,'not_found','المشروع غير متاح');
  return project;
}
const approverActive=(a,date)=>a.valid_from<=date&&(!a.revoked_on||a.revoked_on>date);

function internallyApproved(db,versionId){
  return !!db.prepare("SELECT 1 FROM studio_reviews r JOIN studio_submissions s ON s.id=r.submission_id WHERE s.kind='output' AND s.version_id=? AND r.decision='approved' AND r.reviewed_by<>s.submitted_by").get(versionId);
}
function candidates(db,projectIds){
  if(!projectIds.length)return [];
  const marks=projectIds.map(()=>'?').join(',');
  return db.prepare(`SELECT o.id AS output_id,o.current_version_id,w.id AS studio_id,w.project_id,w.title AS studio_title,ver.id AS version_id,ver.revision,ver.snapshot FROM studio_outputs o JOIN studio_workspaces w ON w.id=o.studio_id JOIN studio_output_versions ver ON ver.output_id=o.id WHERE w.project_id IN (${marks}) ORDER BY w.title,ver.revision DESC`).all(...projectIds)
    .filter(row=>internallyApproved(db,row.version_id))
    .map(row=>({output_id:row.output_id,version_id:row.version_id,revision:row.revision,current:row.current_version_id===row.version_id,project_id:row.project_id,studio_title:row.studio_title,title:JSON.parse(row.snapshot).title??'مخرج'}));
}
function view(db,u,list,row){
  const output=db.prepare('SELECT current_version_id FROM studio_outputs WHERE id=?').get(row.output_id);
  const currentRevision=db.prepare('SELECT revision FROM studio_output_versions WHERE id=?').get(output.current_version_id).revision;
  const title=JSON.parse(db.prepare('SELECT snapshot FROM studio_output_versions WHERE id=?').get(row.output_version_id).snapshot).title??'مخرج';
  const names=Object.fromEntries(db.prepare(`SELECT id,name FROM users WHERE id IN (?,?,?)`).all(row.recorded_by,row.verified_by??'',row.withdrawn_by??'').map(x=>[x.id,x.name]));
  const record={
    ...row,approver:JSON.parse(row.approver_snapshot),output_title:title,current_revision:currentRevision,
    // الموافقة تخص النسخة المسجلة فقط؛ نسخة أحدث تحتاج موافقة جديدة.
    applies_to_current:row.output_version_id===output.current_version_id&&row.status!=='withdrawn',
    recorded_by_name:names[row.recorded_by],verified_by_name:names[row.verified_by]??null,withdrawn_by_name:names[row.withdrawn_by]??null,
    status_name:STATUS_NAMES[row.status],
    disclaimer:'موافقة خارجية وثّقها موظف. ليست توقيعًا إلكترونيًا من العميل ولم يدخل العميل المنصة.'
  };
  delete record.approver_snapshot;
  const actions=[];
  if(row.status==='pending_evidence'&&row.recorded_by===u.id)actions.push('add_evidence');
  if(row.status==='documented'&&row.recorded_by!==u.id&&list.includes('approvals.verify'))actions.push('verify');
  if(row.status!=='withdrawn'&&(row.recorded_by===u.id||list.includes('approvals.verify')))actions.push('withdraw');
  return {...record,actions};
}

export function listApprovals(db,supplied){
  const u=actor(db,supplied),list=requireAny(db,u),projects=memberProjects(db,u),ids=projects.map(p=>p.id),date=today();
  const marks=ids.map(()=>'?').join(',');
  const approvers=ids.length?db.prepare(`SELECT a.*,x.name AS recorded_by_name FROM client_approvers a JOIN users x ON x.id=a.recorded_by WHERE a.tenant_id=? AND a.project_id IN (${marks}) ORDER BY a.created_at DESC`).all(u.tenant_id,...ids).map(a=>({...a,active:approverActive(a,date)})):[];
  const records=ids.length?db.prepare(`SELECT * FROM external_approvals WHERE tenant_id=? AND project_id IN (${marks}) ORDER BY recorded_at DESC`).all(u.tenant_id,...ids).map(row=>view(db,u,list,row)):[];
  return {today:date,user_id:u.id,permissions:list,channels:CHANNELS,decisions:DECISIONS,status_names:STATUS_NAMES,projects,approvers,outputs:candidates(db,ids),records};
}
export function getApproval(db,supplied,approvalId){
  const u=actor(db,supplied),list=requireAny(db,u);
  const row=typeof approvalId==='string'&&db.prepare('SELECT * FROM external_approvals WHERE id=? AND tenant_id=?').get(approvalId,u.tenant_id);
  if(!row||!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(row.project_id,u.id))fail(404,'not_found','السجل غير متاح');
  return view(db,u,list,row);
}

export function registerApprover(db,supplied,input){
  writing(db);
  const u=actor(db,supplied),list=requireAny(db,u);
  if(!list.includes('approvals.record'))fail(403,'not_permitted','تسجيل المفوضين خارج صلاحيتك');
  v.object(input,['project_id','name','title','authority_basis','authority_scope','valid_from']);
  const project=requireProject(db,u,input.project_id),approverId=id();
  db.prepare('INSERT INTO client_approvers(id,tenant_id,project_id,name,title,authority_basis,authority_scope,valid_from,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(approverId,u.tenant_id,project.id,v.text(input.name,'اسم المفوض',180,3),v.text(input.title,'صفته لدى العميل',180,2),v.text(input.authority_basis,'سند التفويض',2000,10),v.text(input.authority_scope,'نطاق ما يحق له اعتماده',2000,3),v.date(input.valid_from),u.id,now());
  audit(db,u,'client_approver',approverId,'client_approver.registered',{}, {project_id:project.id});
  return {id:approverId};
}
export function revokeApprover(db,supplied,approverId,input){
  writing(db);
  const u=actor(db,supplied),list=requireAny(db,u);
  if(!list.includes('approvals.record'))fail(403,'not_permitted','سحب التفويض خارج صلاحيتك');
  v.object(input,['reason','revoked_on']);
  const approver=typeof approverId==='string'&&db.prepare('SELECT * FROM client_approvers WHERE id=? AND tenant_id=? AND revoked_on IS NULL').get(approverId,u.tenant_id);
  if(!approver)fail(404,'not_found','المفوض غير متاح');
  requireProject(db,u,approver.project_id);
  const date=input.revoked_on?v.date(input.revoked_on):today();
  if(date<approver.valid_from||date>today())fail(400,'revoked_on','تاريخ السحب بين بداية التفويض واليوم');
  db.prepare('UPDATE client_approvers SET revoked_on=?,revoked_by=?,revoke_reason=? WHERE id=?').run(date,u.id,v.text(input.reason,'سبب سحب التفويض',2000,10),approver.id);
  audit(db,u,'client_approver',approver.id,'client_approver.revoked',{}, {revoked_on:date});
  return {id:approver.id,revoked_on:date};
}

export function recordApproval(db,supplied,input){
  writing(db);
  const u=actor(db,supplied),list=requireAny(db,u);
  if(!list.includes('approvals.record'))fail(403,'not_permitted','توثيق الموافقات خارج صلاحيتك');
  v.object(input,['output_version_id','approver_id','decision','scope_note','channel','received_on','evidence_reference']);
  const version=typeof input.output_version_id==='string'&&db.prepare('SELECT ver.*,o.studio_id,w.project_id,w.tenant_id FROM studio_output_versions ver JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id WHERE ver.id=? AND w.tenant_id=?').get(input.output_version_id,u.tenant_id);
  if(!version)fail(404,'not_found','نسخة المخرج غير متاحة');
  requireProject(db,u,version.project_id);
  if(!internallyApproved(db,version.id))fail(409,'internal_approval_required','لا تُوثق موافقة عميل على نسخة لم تُعتمد داخليًا');
  if(!DECISIONS.some(d=>d.key===input.decision))fail(400,'decision','اختر قرار العميل كما ورد');
  if(!CHANNELS.some(c=>c.key===input.channel))fail(400,'channel','اختر وسيلة ورود القرار');
  const received=v.date(input.received_on);
  if(received>today())fail(400,'received_on','تاريخ الورود لا يكون مستقبليًا');
  const approver=db.prepare('SELECT * FROM client_approvers WHERE id=? AND tenant_id=? AND project_id=?').get(input.approver_id,u.tenant_id,version.project_id);
  if(!approver)fail(400,'approver','المفوض غير مسجل لهذا المشروع');
  // التفويض يُقاس بتاريخ ورود القرار: من سُحب تفويضه لا يُنسب إليه قرار لاحق، وقراراته السابقة تبقى.
  if(!approverActive(approver,received))fail(409,'approver_not_authorized','المفوض لم يكن مخولًا في تاريخ ورود القرار');
  const evidence=input.evidence_reference?v.text(input.evidence_reference,'مرجع الدليل',2000,10):'';
  if(input.channel==='call'&&!evidence)fail(400,'evidence_required','القرار الهاتفي يحتاج تأكيدًا مكتوبًا يُذكر مرجعه');
  const approvalId=id(),time=now();
  db.prepare('INSERT INTO external_approvals(id,tenant_id,project_id,studio_id,output_id,output_version_id,output_revision,output_digest,approver_id,approver_snapshot,decision,scope_note,channel,received_on,evidence_reference,status,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(approvalId,u.tenant_id,version.project_id,version.studio_id,version.output_id,version.id,version.revision,version.digest,approver.id,JSON.stringify({name:approver.name,title:approver.title,authority_basis:approver.authority_basis,authority_scope:approver.authority_scope}),input.decision,v.text(input.scope_note,'نطاق القرار وشروطه',3000,10),input.channel,received,evidence,evidence?'documented':'pending_evidence',u.id,time);
  audit(db,u,'external_approval',approvalId,'external_approval.recorded',{}, {output_version_id:version.id,revision:version.revision,decision:input.decision,status:evidence?'documented':'pending_evidence'});
  return {id:approvalId};
}

export function approvalAction(db,supplied,approvalId,action,input){
  writing(db);
  const u=actor(db,supplied);
  const fields={add_evidence:['evidence_reference'],verify:['note'],withdraw:['reason']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const current=getApproval(db,u,approvalId);
  v.version(input.version,current.version);
  if(!current.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة السجل الحالية أو لصلاحيتك');
  const time=now();
  if(action==='add_evidence')db.prepare("UPDATE external_approvals SET evidence_reference=?,status='documented',version=version+1 WHERE id=? AND version=?").run(v.text(input.evidence_reference,'مرجع الدليل',2000,10),current.id,current.version);
  if(action==='verify')db.prepare("UPDATE external_approvals SET status='verified',verified_by=?,verified_at=?,verification_note=?,version=version+1 WHERE id=? AND version=?").run(u.id,time,v.text(input.note,'ما الذي طابقته في الدليل',2000,10),current.id,current.version);
  if(action==='withdraw')db.prepare("UPDATE external_approvals SET status='withdrawn',withdrawn_by=?,withdrawn_reason=?,version=version+1 WHERE id=? AND version=?").run(u.id,v.text(input.reason,'سبب السحب',2000,10),current.id,current.version);
  audit(db,u,'external_approval',current.id,'external_approval.'+action,{status:current.status},{version:current.version+1});
  return getApproval(db,u,current.id);
}
