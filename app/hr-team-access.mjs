import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { CAPABILITIES, capabilityConflicts, defaultCapabilities, levelCapabilities, holds } from './access.mjs';
import { sensitiveGrantAlert } from './security-alerts.mjs';
import { refuse } from './refusal.mjs';
import { activeDepartmentPeople, personAssignment } from './people-read.mjs';

const id=()=>randomUUID();
const definitions=new Map(CAPABILITIES.map(row=>[row.key,row]));
const DELEGABLE_KEYS=Object.freeze([
  'people.manage','employees.view','hr.policy.prepare','hr.contracts.manage','hr.attendance.manage',
  'hr.performance.manage','hr.succession.manage','payroll.prepare','hr.letters.prepare','hr.cases.handle',
  'hr.discipline.propose','hr.feedback.manage','hr.survey.manage','hr.compensation.review','hr.workforce.view',
  'hr.operations.use','hr.competency.manage','hr.pip.manage','hr.benefits.manage','knowledge.manage','privacy.manage'
]);
export const HR_DELEGABLE_CAPABILITIES=DELEGABLE_KEYS.map(key=>definitions.get(key));

function actor(db,supplied){
  const u=currentUser(db,supplied);
  if(!u||u.role==='admin'||u.department_id!=='hr')refuse(403,'forbidden',{what:'صلاحيات فريق رأس المال البشري تظهر لأعضاء الإدارة فقط',next:'افتح المركز بحساب مدير أو موظف في إدارة رأس المال البشري'});
  return u;
}
function manager(db,u){
  if(u.role!=='manager'||!holds(db,u,'hr.permissions.delegate'))refuse(403,'not_permitted',{what:'تعديل صلاحيات فريق رأس المال البشري لمدير الإدارة المخول فقط',next:'اطلب من أدمن المنصة تثبيت مدير الإدارة والتحقق بخطوتين إذا كانت السياسة تفرضه'});
  return u;
}
function activeGrants(db,targetId){
  return db.prepare('SELECT * FROM access_grants WHERE user_id=? AND revoked_at IS NULL ORDER BY granted_at').all(targetId).map(row=>{
    const grantor=personAssignment(db,row.tenant_id,row.granted_by);
    return {...row,grantor_role:grantor?.role??null,grantor_department:grantor?.department_id??null,granted_by_name:grantor?.name??'حساب سابق'};
  });
}
const fromHrManager=row=>row.grantor_role==='manager'&&row.grantor_department==='hr';
function capabilityRows(db,target){
  const defaults=defaultCapabilities(target),levels=levelCapabilities(db,target),grants=activeGrants(db,target.id);
  return HR_DELEGABLE_CAPABILITIES.map(definition=>{
    const matching=grants.filter(row=>row.capability===definition.key),managerGrant=matching.find(fromHrManager),otherGrant=matching.find(row=>!fromHrManager(row));
    let source='unavailable',source_name='غير ممنوحة',selected=false,locked=false;
    if(defaults.has(definition.key)){source='inherited';source_name='أساسية مع دور الحساب';selected=true;locked=true;}
    else if(otherGrant){source='platform_admin';source_name=`منح مستقل من ${otherGrant.granted_by_name}`;selected=true;locked=true;}
    else if(levels.has(definition.key)){source='level';source_name='من مستوى صلاحية الإدارة';selected=true;locked=true;}
    else if(managerGrant){source='hr_manager';source_name='من مدير رأس المال البشري';selected=true;}
    return {key:definition.key,name:definition.name,group:definition.group,sensitive:!!definition.sensitive,selected,locked,source,source_name};
  });
}
function memberRow(db,row){return {id:row.id,name:row.name,role:row.role,capabilities:capabilityRows(db,row)};}

export function hrTeamAccessBoard(db,supplied){
  const u=actor(db,supplied),canManage=u.role==='manager'&&holds(db,u,'hr.permissions.delegate');
  const members=canManage?activeDepartmentPeople(db,u.tenant_id,'hr').filter(row=>row.id!==u.id&&['hr','employee'].includes(row.role)).map(row=>memberRow(db,{...row,tenant_id:u.tenant_id,active:1})):[];
  return {can_manage:canManage,mode_options:[{key:'comprehensive',name:'شامل — كل صلاحيات التشغيل القابلة للتفويض'},{key:'custom',name:'مخصص — اختر احتياج الموظف'}],mine:memberRow(db,u),members};
}

export function setHrTeamAccess(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','حفظ صلاحيات الفريق لازم يتم داخل معاملة واحدة');
  const u=manager(db,actor(db,supplied));
  v.object(input,['user_id','mode','capability_keys','note']);
  if(!['comprehensive','custom'].includes(input.mode))fail(400,'mode','اختر منحًا شاملًا أو مخصصًا');
  if(!Array.isArray(input.capability_keys)||input.capability_keys.some(key=>typeof key!=='string')||new Set(input.capability_keys).size!==input.capability_keys.length)fail(400,'capability_keys','اختيارات الصلاحيات غير صحيحة');
  const target=personAssignment(db,u.tenant_id,input.user_id);
  if(!target||!target.active||target.department_id!=='hr'||!['hr','employee'].includes(target.role))fail(404,'target_scope','الموظف لازم يكون حسابًا نشطًا داخل إدارة رأس المال البشري');
  if(target.id===u.id)fail(409,'separation_of_duties','المدير لا يغيّر صلاحياته من شاشة فريقه');
  const note=v.text(input.note,'سبب تغيير الصلاحيات',500,10);
  const requested=input.mode==='comprehensive'?[...DELEGABLE_KEYS]:input.capability_keys;
  const unsupported=requested.find(key=>!DELEGABLE_KEYS.includes(key));
  if(unsupported)fail(400,'capability_not_delegable','هذه الصلاحية قرار اعتماد أو صلاحية تقنية ولا يفوضها مدير رأس المال البشري');
  const desired=new Set(requested),grants=activeGrants(db,target.id),managed=grants.filter(fromHrManager).filter(row=>DELEGABLE_KEYS.includes(row.capability));
  const lockedGrants=grants.filter(row=>!fromHrManager(row)).map(row=>row.capability);
  const resulting=new Set([...defaultCapabilities(target),...levelCapabilities(db,target),...lockedGrants,...desired]);
  const conflicts=capabilityConflicts(resulting);
  if(conflicts.length)refuse(409,'separation_of_duties',{what:'الصلاحيات المختارة تجمع إعداد العمل واعتماده عند الشخص نفسه',details:{conflicts},next:'وزع صلاحية الإعداد والقرار على شخصين مختلفين'});
  const time=now(),removed=[],added=[];
  for(const grant of managed){
    if(desired.has(grant.capability))continue;
    db.prepare('UPDATE access_grants SET revoked_at=?,revoked_by=? WHERE id=?').run(time,u.id,grant.id);removed.push(grant.capability);
  }
  const existing=new Set(activeGrants(db,target.id).map(row=>row.capability));
  for(const key of desired){
    if(defaultCapabilities(target).has(key)||levelCapabilities(db,target).has(key)||existing.has(key))continue;
    const definition=definitions.get(key),grantId=id();
    db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?,?)').run(grantId,u.tenant_id,target.id,key,null,note,u.id,time);
    added.push(key);existing.add(key);if(definition.sensitive)sensitiveGrantAlert(db,u,target.id,definition.name);
  }
  if(added.length||removed.length)db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(db,u,'hr_team_access',target.id,'hr.team_access_changed',{managed:managed.map(row=>row.capability)},{mode:input.mode,added,removed,selected:[...desired]},note);
  return {user_id:target.id,mode:input.mode,added,removed};
}
