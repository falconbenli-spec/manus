import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { activeDepartmentPeople, activeProjectPeople, eligibleSpacePerson, personAssignment } from './people-read.mjs';

const TARGETS=new Set(['project','department','initiative']);
const ROLE_CAPABILITIES={
  owner:['space.read','space.organize','space.task','space.publish','space.chat','space.files','space.people'],
  manager:['space.read','space.organize','space.task','space.publish','space.chat','space.files','space.people'],
  member:['space.read','space.task','space.publish','space.chat','space.files'],
  internal_guest:['space.read','space.task','space.chat','space.files'],
  external_guest:[]
};

function targetOrNotFound(db,u,{kind,id}){
  if(!TARGETS.has(kind)||typeof id!=='string'||!id)fail(404,'target_not_found','مساحة العمل غير متاحة لك؛ تحقّق من بيانات مساحة العمل ثم حاول مرة أخرى');
  if(kind==='project'){
    const target=db.prepare(`SELECT p.id,p.tenant_id,p.name,p.created_by
      FROM projects p JOIN project_members m ON m.project_id=p.id
      WHERE p.id=? AND p.tenant_id=? AND m.user_id=?`).get(id,u.tenant_id,u.id);
    if(!target)fail(404,'target_not_found','مساحة العمل غير متاحة لك؛ تحقّق من بيانات مساحة العمل ثم حاول مرة أخرى');
    return {...target,kind,members:activeProjectPeople(db,u.tenant_id,id),owner_id:target.created_by};
  }
  if(kind==='department'){
    const target=db.prepare('SELECT id,tenant_id,name FROM departments WHERE id=? AND tenant_id=? AND id=?').get(id,u.tenant_id,u.department_id);
    if(!target)fail(404,'target_not_found','مساحة العمل غير متاحة لك؛ تحقّق من بيانات مساحة العمل ثم حاول مرة أخرى');
    const members=activeDepartmentPeople(db,u.tenant_id,id);
    const owner=members.find(person=>person.role==='manager')??members.find(person=>person.id===u.id);
    return {...target,kind,members,owner_id:owner?.id??u.id};
  }
  const target=db.prepare(`SELECT i.id,i.tenant_id,i.title AS name,i.owner_id,i.proposed_by,o.department_id
    FROM governance_initiatives i JOIN governance_objectives o ON o.id=i.objective_id
    WHERE i.id=? AND i.tenant_id=? AND (i.owner_id=? OR i.proposed_by=?)`).get(id,u.tenant_id,u.id,u.id);
  if(!target)fail(404,'target_not_found','مساحة العمل غير متاحة لك؛ تحقّق من بيانات مساحة العمل ثم حاول مرة أخرى');
  const members=activeDepartmentPeople(db,u.tenant_id,target.department_id)
    .filter(person=>person.id===target.owner_id||person.id===target.proposed_by||person.id===u.id);
  return {...target,kind,members,owner_id:target.owner_id};
}

function activeMembership(db,u,spaceId){
  const current=personAssignment(db,u.tenant_id,u.id);
  if(!current?.active||current.role==='admin')return null;
  const at=now();
  const row=db.prepare(`SELECT m.*,s.target_kind,s.target_id,s.name,s.created_by AS space_created_by,s.created_at AS space_created_at,
      s.updated_at AS space_updated_at,s.version AS space_version
    FROM collaboration_memberships m JOIN collaboration_spaces s ON s.id=m.space_id AND s.tenant_id=m.tenant_id
    WHERE m.space_id=? AND m.tenant_id=? AND m.user_id=? AND m.removed_at IS NULL
      AND m.starts_at<=? AND (m.ends_at IS NULL OR m.ends_at>?)`).get(spaceId,u.tenant_id,u.id,at,at);
  return row&&eligibleSpacePerson(db,u.tenant_id,row.target_kind,row.target_id,u.id)?row:null;
}

const publicSpace=row=>({id:row.space_id??row.id,tenant_id:row.tenant_id,target_kind:row.target_kind,target_id:row.target_id,
  name:row.name,created_by:row.space_created_by??row.created_by,created_at:row.space_created_at??row.created_at,
  updated_at:row.space_updated_at??row.updated_at,version:row.space_version??row.version,member_role:row.role});

export function spaceById(db,u,id){
  const row=activeMembership(db,u,id);
  if(!row)fail(404,'space_not_found','مساحة العمل غير متاحة لك؛ افتح مساحة مرتبطة بعملك من صفحة مهامي');
  return publicSpace(row);
}

export function spaceForTarget(db,u,target){
  if(!TARGETS.has(target?.kind)||typeof target?.id!=='string')fail(404,'space_not_found','مساحة العمل غير متاحة لك؛ افتح مساحة مرتبطة بعملك من صفحة مهامي');
  const row=db.prepare(`SELECT s.id FROM collaboration_spaces s JOIN collaboration_memberships m ON m.space_id=s.id AND m.tenant_id=s.tenant_id
    WHERE s.tenant_id=? AND s.target_kind=? AND s.target_id=? AND m.user_id=? AND m.removed_at IS NULL
      AND m.starts_at<=? AND (m.ends_at IS NULL OR m.ends_at>?)`).get(u.tenant_id,target.kind,target.id,u.id,now(),now());
  return row?spaceById(db,u,row.id):null;
}

function spaceSummary(db,u,row){
  const openTasks=row.target_kind==='project'
    ?db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND status='open'").get(row.target_id).n
    :db.prepare("SELECT COUNT(*) AS n FROM space_tasks WHERE space_id=? AND status='open'").get(row.id).n;
  const files=db.prepare('SELECT COUNT(*) AS n FROM workspace_files WHERE space_id=?').get(row.id).n;
  const topics=db.prepare("SELECT COUNT(*) AS n FROM workspace_topics WHERE space_id=? AND status='published'").get(row.id).n;
  const nextEvent=db.prepare("SELECT starts_at FROM workspace_events WHERE space_id=? AND status='scheduled' AND starts_at>=? ORDER BY starts_at LIMIT 1").get(row.id,now());
  return {...spaceById(db,u,row.id),open_tasks:openTasks,files,topics,next_event:nextEvent?.starts_at??null};
}

export function spacesForUser(db,u){
  const assignment=personAssignment(db,u.tenant_id,u.id);
  if(!assignment?.active||assignment.role==='admin')return {spaces:[],suggestions:[]};
  const stamp=now();
  const rows=db.prepare(`SELECT s.* FROM collaboration_spaces s
    JOIN collaboration_memberships m ON m.space_id=s.id AND m.tenant_id=s.tenant_id
    WHERE s.tenant_id=? AND m.user_id=? AND m.removed_at IS NULL
      AND m.starts_at<=? AND (m.ends_at IS NULL OR m.ends_at>?) ORDER BY s.updated_at DESC,s.name`).all(u.tenant_id,u.id,stamp,stamp)
    .filter(row=>eligibleSpacePerson(db,u.tenant_id,row.target_kind,row.target_id,u.id));
  const activeTargets=new Set(rows.map(row=>`${row.target_kind}:${row.target_id}`));
  const candidates=[];
  if(u.department_id){
    const department=db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND id=?').get(u.tenant_id,u.department_id);
    if(department)candidates.push({kind:'department',id:department.id,name:department.name});
  }
  for(const project of db.prepare(`SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id
    WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.name`).all(u.tenant_id,u.id))candidates.push({kind:'project',id:project.id,name:project.name});
  for(const initiative of db.prepare(`SELECT i.id,i.title AS name FROM governance_initiatives i
    WHERE i.tenant_id=? AND (i.owner_id=? OR i.proposed_by=?) ORDER BY i.title`).all(u.tenant_id,u.id,u.id))candidates.push({kind:'initiative',id:initiative.id,name:initiative.name});
  return {spaces:rows.map(row=>spaceSummary(db,u,row)),suggestions:candidates.filter(item=>!activeTargets.has(`${item.kind}:${item.id}`))};
}

export function ensureSpace(db,u,input){
  v.object(input,['kind','id']);
  const target=targetOrNotFound(db,u,input);
  const existing=db.prepare('SELECT id FROM collaboration_spaces WHERE tenant_id=? AND target_kind=? AND target_id=?')
    .get(u.tenant_id,input.kind,input.id);
  if(existing){
    const membership=activeMembership(db,u,existing.id);
    if(!membership)fail(404,'space_not_found','مساحة العمل غير متاحة لك؛ افتح مساحة مرتبطة بعملك من صفحة مهامي');
    return publicSpace(membership);
  }
  const stamp=now(),spaceId=randomUUID();
  db.prepare(`INSERT INTO collaboration_spaces(id,tenant_id,target_kind,target_id,name,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(spaceId,u.tenant_id,input.kind,input.id,target.name,u.id,stamp,stamp);
  const members=new Map(target.members.map(person=>[person.id,person]));
  if(!members.has(u.id))members.set(u.id,{id:u.id,role:u.role});
  for(const person of members.values()){
    const role=person.id===target.owner_id?'owner':'member';
    db.prepare(`INSERT INTO collaboration_memberships(id,tenant_id,space_id,user_id,role,starts_at,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,spaceId,person.id,role,stamp,u.id,stamp);
  }
  for(const [title,kind,position] of [['قادم','backlog',0],['قيد العمل','active',1],['مكتمل','complete',2]]){
    db.prepare(`INSERT INTO work_lists(id,tenant_id,space_id,title,kind,position,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,spaceId,title,kind,position,u.id,stamp,stamp);
  }
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,'space',spaceId,'space.created',JSON.stringify({target_kind:input.kind,target_id:input.id}),stamp);
  audit(db,u,'collaboration_space',spaceId,'space.created',{}, {target_kind:input.kind,target_id:input.id,members:members.size});
  return spaceById(db,u,spaceId);
}

export function spaceCapabilities(db,u,space){
  const membership=activeMembership(db,u,space.id);
  if(!membership)fail(404,'space_not_found','مساحة العمل غير متاحة لك؛ افتح مساحة مرتبطة بعملك من صفحة مهامي');
  return [...(ROLE_CAPABILITIES[membership.role]??[])];
}
