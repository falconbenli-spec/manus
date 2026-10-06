import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { spaceById, spaceCapabilities } from './collaboration-space.mjs';
import { eligibleSpacePerson, personAssignment } from './people-read.mjs';

const ROLES=new Set(['owner','manager','member','internal_guest']);

export function collaborationActor(db,u,spaceId){
  const space=spaceById(db,u,spaceId);
  return {...space,role:space.member_role,capabilities:spaceCapabilities(db,u,space)};
}

export function canSpace(db,u,space,action){
  try{return collaborationActor(db,u,space.id).capabilities.includes(action);}
  catch(error){if(error?.code==='space_not_found')return false;throw error;}
}

export function spacePeople(db,u,spaceId){
  collaborationActor(db,u,spaceId);
  const at=now();
  return db.prepare(`SELECT m.user_id,m.role,m.starts_at,m.ends_at,m.version
    FROM collaboration_memberships m
    WHERE m.space_id=? AND m.removed_at IS NULL AND m.starts_at<=? AND (m.ends_at IS NULL OR m.ends_at>?)
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,m.user_id`).all(spaceId,at,at).map(row=>{
      const person=personAssignment(db,u.tenant_id,row.user_id);
      return {...row,name:person?.name??'عضو غير نشط',department_id:person?.department_id??null};
    }).sort((a,b)=>a.role===b.role?a.name.localeCompare(b.name,'ar'):0);
}

function requirePeopleManager(db,u,spaceId){
  const actor=collaborationActor(db,u,spaceId);
  if(!actor.capabilities.includes('space.people'))fail(403,'space_forbidden','إدارة أعضاء مساحة العمل غير متاحة لك');
  return actor;
}

function membership(db,spaceId,userId){
  return db.prepare('SELECT * FROM collaboration_memberships WHERE space_id=? AND user_id=?').get(spaceId,userId);
}

function eligibleOrRefuse(db,u,space,userId){
  const person=eligibleSpacePerson(db,u.tenant_id,space.target_kind,space.target_id,userId);
  if(!person)fail(403,'member_scope','يمكن إضافة أعضاء داخليين لهم وصول قائم إلى مصدر مساحة العمل فقط');
  return person;
}

export function addSpaceMember(db,u,spaceId,input){
  v.object(input,['user_id','role','reason','ends_at']);
  const space=requirePeopleManager(db,u,spaceId);
  if(!ROLES.has(input.role)||input.role==='owner')fail(400,'role','اختر دورًا داخليًا صالحًا للعضو الجديد');
  const person=eligibleOrRefuse(db,u,space,input.user_id);
  const reason=v.text(input.reason,'سبب إضافة العضو',500,5),stamp=now();
  if(input.ends_at!==undefined&&input.ends_at!==null&&input.ends_at<=stamp)fail(400,'membership_end','تاريخ نهاية العضوية يجب أن يكون في المستقبل');
  const previous=membership(db,spaceId,person.id);
  if(previous&&!previous.removed_at)fail(409,'membership_exists','الشخص عضو نشط في مساحة العمل');
  if(previous){
    db.prepare(`UPDATE collaboration_memberships SET role=?,starts_at=?,ends_at=?,removed_at=NULL,removed_by=NULL,removal_reason='',
      created_by=?,created_at=?,version=version+1 WHERE id=?`).run(input.role,stamp,input.ends_at??null,u.id,stamp,previous.id);
  }else{
    db.prepare(`INSERT INTO collaboration_memberships(id,tenant_id,space_id,user_id,role,starts_at,ends_at,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,spaceId,person.id,input.role,stamp,input.ends_at??null,u.id,stamp);
  }
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,'membership',person.id,'member.added',JSON.stringify({role:input.role,reason}),stamp);
  audit(db,u,'collaboration_space',spaceId,'member.added',previous??{}, {user_id:person.id,role:input.role,ends_at:input.ends_at??null},reason);
  return membership(db,spaceId,person.id);
}

export function removeSpaceMember(db,u,spaceId,userId,input){
  v.object(input,['reason']);
  const space=requirePeopleManager(db,u,spaceId),target=membership(db,spaceId,userId);
  if(!target||target.removed_at)fail(404,'membership_not_found','عضوية مساحة العمل غير موجودة');
  if(target.role==='owner')fail(409,'owner_required','مالك مساحة العمل لا يزال مرتبطًا بمصدرها ولا يمكن إزالته');
  const reason=v.text(input.reason,'سبب إزالة العضو',500,5),stamp=now();
  db.prepare(`UPDATE collaboration_memberships SET removed_at=?,removed_by=?,removal_reason=?,version=version+1
    WHERE id=? AND removed_at IS NULL`).run(stamp,u.id,reason,target.id);
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,'membership',userId,'member.removed',JSON.stringify({reason}),stamp);
  audit(db,u,'collaboration_space',spaceId,'member.removed',{user_id:userId,role:target.role},{removed:true},reason);
  return {removed:true,user_id:userId,space_id:space.id};
}

export function changeSpaceRole(db,u,spaceId,userId,input){
  v.object(input,['role','reason']);
  requirePeopleManager(db,u,spaceId);
  if(!ROLES.has(input.role))fail(400,'role','دور مساحة العمل غير صالح؛ اختر دورًا من الخيارات المعروضة');
  const target=membership(db,spaceId,userId);
  if(!target||target.removed_at)fail(404,'membership_not_found','عضوية مساحة العمل غير موجودة');
  if(target.role==='owner'&&input.role!=='owner')fail(409,'owner_required','مالك مساحة العمل مرتبط بمالك مصدرها');
  const reason=v.text(input.reason,'سبب تغيير الدور',500,5),stamp=now();
  db.prepare('UPDATE collaboration_memberships SET role=?,version=version+1 WHERE id=?').run(input.role,target.id);
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,'membership',userId,'member.role_changed',JSON.stringify({from:target.role,to:input.role,reason}),stamp);
  audit(db,u,'collaboration_space',spaceId,'member.role_changed',{user_id:userId,role:target.role},{user_id:userId,role:input.role},reason);
  return membership(db,spaceId,userId);
}
