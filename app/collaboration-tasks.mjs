import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { collaborationActor } from './collaboration-access.mjs';
import { completeTask as completeProjectTask } from './projects.mjs';
import { projectManagerOfRecord } from './project-authority.mjs';

const PRIORITIES=new Set(['low','normal','high','urgent']);
const LIST_KINDS=new Set(['backlog','active','complete','archive']);

function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تعديل مساحة العمل يحتاج معاملة قاعدة بيانات');}
function requireAction(db,u,spaceId,action){
  const actor=collaborationActor(db,u,spaceId);
  if(!actor.capabilities.includes(action))fail(403,'space_forbidden','هذا الإجراء غير متاح لك في مساحة العمل');
  return actor;
}
function listRow(db,spaceId,listId){
  const row=db.prepare('SELECT * FROM work_lists WHERE id=? AND space_id=?').get(listId,spaceId);
  if(!row)fail(404,'list_not_found','قائمة العمل غير متاحة؛ اختر قائمة ظاهرة في مساحة العمل');
  return row;
}
function member(db,spaceId,userId){
  const stamp=now();
  return db.prepare(`SELECT * FROM collaboration_memberships WHERE space_id=? AND user_id=? AND removed_at IS NULL
    AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)`).get(spaceId,userId,stamp,stamp);
}
function activity(db,u,spaceId,entityType,entityId,action,details={}){
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,entityType,entityId,action,JSON.stringify(details),now());
}
function spaceTask(db,spaceId,taskId){
  const row=db.prepare('SELECT * FROM space_tasks WHERE id=? AND space_id=?').get(taskId,spaceId);
  if(!row)fail(404,'task_not_found','المهمة غير متاحة في مساحة العمل');
  return row;
}
function normalizedSpaceTask(db,row,actor){
  const contributors=db.prepare('SELECT user_id FROM space_task_contributors WHERE task_id=? ORDER BY user_id').all(row.id).map(item=>item.user_id);
  const actions=row.source_kind==='request'?['open_source']:
    row.status==='completed'?(actor.capabilities.includes('space.organize')?['reopen']:[]):['update','move','comment',...(row.accountable_id===actor.id||actor.capabilities.includes('space.organize')?['complete']:[])];
  return {id:row.id,source:'space_task',list_id:row.list_id,title:row.title,accountable_id:row.accountable_id,contributors,
    start_on:row.start_on,due_on:row.due_on,priority:row.priority,status:row.status,acceptance:row.acceptance,evidence:row.evidence,
    version:row.version,position:row.position,source_kind:row.source_kind,source_id:row.source_id,actions};
}
function normalizedProjectTask(row,actor,defaultList){
  return {id:row.id,source:'project_task',list_id:row.list_id??defaultList,title:row.title,accountable_id:row.assignee_id,contributors:[],
    start_on:row.start_on,due_on:row.due_date,priority:row.priority??'normal',status:row.status,acceptance:row.acceptance,evidence:row.evidence,
    version:row.version,position:row.sort_order??0,source_kind:'project_task',source_id:row.id,
    actions:row.status==='completed'?[]:['update','move','comment',...(row.assignee_id===actor.id?['complete']:[])]};
}

export function taskBoard(db,u,spaceId){
  const actor=requireAction(db,u,spaceId,'space.read');
  const lists=db.prepare('SELECT * FROM work_lists WHERE space_id=? ORDER BY position,id').all(spaceId).map(row=>({...row}));
  const defaultList=lists[0]?.id??null;
  let tasks;
  if(actor.target_kind==='project'){
    tasks=db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY COALESCE(sort_order,0),due_date,id').all(actor.target_id)
      .map(row=>normalizedProjectTask(row,actor,defaultList));
  }else{
    tasks=db.prepare('SELECT * FROM space_tasks WHERE space_id=? ORDER BY position,id').all(spaceId)
      .map(row=>normalizedSpaceTask(db,row,actor));
  }
  const project=actor.target_kind==='project'?db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(actor.target_id,u.tenant_id):null;
  const manager=project?projectManagerOfRecord(db,project):null;
  const canCreate=actor.target_kind!=='project'||!!(manager?.available&&manager.id===u.id);
  return {space:{id:actor.id,name:actor.name,target_kind:actor.target_kind,target_id:actor.target_id},can_create:canCreate,
    lists:lists.map(list=>({...list,tasks:tasks.filter(task=>task.list_id===list.id)})),tasks};
}

export function createList(db,u,spaceId,input){
  writing(db);requireAction(db,u,spaceId,'space.organize');v.object(input,['title','kind']);
  if(db.prepare('SELECT COUNT(*) AS n FROM work_lists WHERE space_id=?').get(spaceId).n>=30)fail(409,'list_limit','بلغت مساحة العمل الحد الأعلى للقوائم');
  const kind=input.kind??'active';if(!LIST_KINDS.has(kind))fail(400,'list_kind','نوع القائمة غير صالح؛ اختر نوعًا من الخيارات المعتمدة');
  const position=(db.prepare('SELECT MAX(position) AS n FROM work_lists WHERE space_id=?').get(spaceId).n??-1)+1;
  const id=randomUUID(),stamp=now();
  db.prepare(`INSERT INTO work_lists(id,tenant_id,space_id,title,kind,position,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(id,u.tenant_id,spaceId,v.text(input.title,'اسم القائمة',100),kind,position,u.id,stamp,stamp);
  activity(db,u,spaceId,'list',id,'list.created',{kind,position});audit(db,u,'collaboration_space',spaceId,'list.created',{}, {list_id:id,kind,position});
  return db.prepare('SELECT * FROM work_lists WHERE id=?').get(id);
}

export function reorderList(db,u,spaceId,listId,input){
  writing(db);requireAction(db,u,spaceId,'space.organize');v.object(input,['version','position']);
  const row=listRow(db,spaceId,listId);v.version(input.version,row.version);
  if(typeof input.position!=='number'||!Number.isFinite(input.position)||input.position<0)fail(400,'position','ترتيب القائمة غير صالح؛ حدّث اللوحة ثم اختر موضعًا صالحًا');
  db.prepare('UPDATE work_lists SET position=?,version=version+1,updated_at=? WHERE id=?').run(input.position,now(),listId);
  activity(db,u,spaceId,'list',listId,'list.reordered',{from:row.position,to:input.position});
  return db.prepare('SELECT * FROM work_lists WHERE id=?').get(listId);
}

export function createSpaceTask(db,u,spaceId,input){
  writing(db);const actor=requireAction(db,u,spaceId,'space.task');
  v.object(input,['list_id','title','accountable_id','contributors','start_on','due_on','priority','acceptance','source_kind','source_id']);
  const list=listRow(db,spaceId,input.list_id);
  if(!member(db,spaceId,input.accountable_id))fail(400,'accountable','المسؤول يجب أن يكون عضوًا نشطًا في المساحة');
  const contributors=input.contributors??[];
  if(!Array.isArray(contributors)||contributors.length>30||contributors.some(id=>typeof id!=='string'||!member(db,spaceId,id)))fail(400,'contributors','المساهمون يجب أن يكونوا أعضاء نشطين في المساحة');
  if(input.source_kind!==undefined&&!['request','project_task'].includes(input.source_kind))fail(400,'source_kind','مصدر المهمة غير صالح؛ افتح المهمة من مصدرها الأصلي');
  if((input.source_kind===undefined)!=(input.source_id===undefined))fail(400,'source','المصدر يحتاج نوعًا ومعرّفًا معًا');
  const priority=input.priority??'normal';if(!PRIORITIES.has(priority))fail(400,'priority','أولوية المهمة غير صالحة؛ اختر أولوية من الخيارات المعروضة');
  const start=input.start_on?v.date(input.start_on):null,due=input.due_on?v.date(input.due_on):null;if(start&&due&&due<start)fail(400,'date_order','موعد الاستحقاق يسبق بداية المهمة');
  if(actor.target_kind==='project')fail(409,'project_task_source','مهام المشروع تُنشأ من مسار المشروع حتى تبقى بواباته مطبقة');
  const id=randomUUID(),stamp=now(),position=(db.prepare('SELECT MAX(position) AS n FROM space_tasks WHERE list_id=?').get(list.id).n??-1)+1;
  db.prepare(`INSERT INTO space_tasks(id,tenant_id,space_id,list_id,title,accountable_id,start_on,due_on,priority,acceptance,position,source_kind,source_id,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,u.tenant_id,spaceId,list.id,v.text(input.title,'عنوان المهمة',180,2),input.accountable_id,start,due,priority,
      input.acceptance?v.text(input.acceptance,'معيار القبول',2000):'',position,input.source_kind??null,input.source_id??null,u.id,stamp,stamp);
  for(const userId of [...new Set(contributors)])db.prepare('INSERT INTO space_task_contributors(tenant_id,task_id,user_id,added_by,added_at) VALUES(?,?,?,?,?)').run(u.tenant_id,id,userId,u.id,stamp);
  activity(db,u,spaceId,'task',id,'task.created',{list_id:list.id,accountable_id:input.accountable_id});
  audit(db,u,'collaboration_space',spaceId,'task.created',{}, {task_id:id,list_id:list.id,accountable_id:input.accountable_id});
  return spaceTask(db,spaceId,id);
}

export function updateSpaceTask(db,u,spaceId,taskId,input){
  writing(db);const actor=requireAction(db,u,spaceId,'space.task');v.object(input,['version','title','accountable_id','start_on','due_on','priority','acceptance']);
  const task=spaceTask(db,spaceId,taskId);v.version(input.version,task.version);
  if(task.source_kind==='request')fail(409,'source_action_required','الطلب المرتبط يُعدّل من مساره الأصلي');
  if(task.accountable_id!==u.id&&!actor.capabilities.includes('space.organize'))fail(403,'space_forbidden','تعديل المهمة للمسؤول عنها أو منظم المساحة');
  const accountable=input.accountable_id??task.accountable_id;if(!member(db,spaceId,accountable))fail(400,'accountable','المسؤول يجب أن يكون عضوًا نشطًا في المساحة');
  const start=input.start_on===undefined?task.start_on:(input.start_on?v.date(input.start_on):null);
  const due=input.due_on===undefined?task.due_on:(input.due_on?v.date(input.due_on):null);if(start&&due&&due<start)fail(400,'date_order','موعد الاستحقاق يسبق بداية المهمة');
  const priority=input.priority??task.priority;if(!PRIORITIES.has(priority))fail(400,'priority','أولوية المهمة غير صالحة؛ اختر أولوية من الخيارات المعروضة');
  db.prepare(`UPDATE space_tasks SET title=?,accountable_id=?,start_on=?,due_on=?,priority=?,acceptance=?,version=version+1,updated_at=? WHERE id=?`)
    .run(input.title===undefined?task.title:v.text(input.title,'عنوان المهمة',180,2),accountable,start,due,priority,
      input.acceptance===undefined?task.acceptance:v.text(input.acceptance,'معيار القبول',2000,0),now(),task.id);
  activity(db,u,spaceId,'task',task.id,'task.updated',{});return spaceTask(db,spaceId,task.id);
}

export function moveTask(db,u,spaceId,taskId,input){
  writing(db);const actor=requireAction(db,u,spaceId,'space.task');v.object(input,['version','to_list_id','position','evidence']);
  const target=listRow(db,spaceId,input.to_list_id);
  if(typeof input.position!=='number'||!Number.isFinite(input.position)||input.position<0)fail(400,'position','ترتيب البطاقة غير صالح؛ حدّث اللوحة ثم اختر موضعًا صالحًا');
  const local=db.prepare('SELECT * FROM space_tasks WHERE id=? AND space_id=?').get(taskId,spaceId);
  if(local){
    v.version(input.version,local.version);
    if(local.source_kind==='request')fail(409,'source_action_required','الطلب المرتبط يُحرّك من مساره الأصلي');
    if(target.kind==='complete'){
      if(!input.evidence)fail(400,'evidence_required','إغلاق المهمة يحتاج دليل إنجاز');
      return completeSpaceTask(db,u,spaceId,taskId,{version:input.version,evidence:input.evidence,to_list_id:target.id,position:input.position});
    }
    db.prepare('UPDATE space_tasks SET list_id=?,position=?,version=version+1,updated_at=? WHERE id=?').run(target.id,input.position,now(),taskId);
    activity(db,u,spaceId,'task',taskId,'task.moved',{from_list_id:local.list_id,to_list_id:target.id,position:input.position});
    return spaceTask(db,spaceId,taskId);
  }
  if(actor.target_kind!=='project')fail(404,'task_not_found','المهمة غير متاحة في مساحة العمل');
  const task=db.prepare('SELECT * FROM tasks WHERE id=? AND project_id=?').get(taskId,actor.target_id);if(!task)fail(404,'task_not_found','المهمة غير متاحة في مساحة العمل');v.version(input.version,task.version);
  if(target.kind==='complete'){
    if(!input.evidence)fail(400,'evidence_required','إغلاق المهمة يحتاج دليل إنجاز');
    const completed=completeProjectTask(db,u,task.id,{version:task.version,evidence:input.evidence});
    db.prepare('UPDATE tasks SET list_id=?,sort_order=? WHERE id=?').run(target.id,input.position,task.id);return completed;
  }
  db.prepare('UPDATE tasks SET list_id=?,sort_order=?,version=version+1 WHERE id=?').run(target.id,input.position,task.id);
  activity(db,u,spaceId,'project_task',task.id,'task.moved',{to_list_id:target.id,position:input.position});
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
}

export function completeSpaceTask(db,u,spaceId,taskId,input){
  writing(db);const actor=requireAction(db,u,spaceId,'space.task');v.object(input,['version','evidence','to_list_id','position']);
  const task=spaceTask(db,spaceId,taskId);v.version(input.version,task.version);
  if(task.source_kind==='request')fail(409,'source_action_required','الطلب المرتبط يُغلق من مساره الأصلي');
  if(task.accountable_id!==u.id&&!actor.capabilities.includes('space.organize'))fail(403,'space_forbidden','إكمال المهمة للمسؤول عنها أو منظم المساحة');
  const evidence=v.text(input.evidence,'دليل الإنجاز',3000,3),target=input.to_list_id?listRow(db,spaceId,input.to_list_id):listRow(db,spaceId,task.list_id);
  if(input.to_list_id&&target.kind!=='complete')fail(400,'complete_list','اختر قائمة مكتملة لإغلاق المهمة');
  const stamp=now();
  db.prepare(`UPDATE space_tasks SET status='completed',evidence=?,completed_at=?,completed_by=?,list_id=?,position=?,version=version+1,updated_at=? WHERE id=?`)
    .run(evidence,stamp,u.id,target.id,input.position??task.position,stamp,task.id);
  activity(db,u,spaceId,'task',task.id,'task.completed',{evidence,list_id:target.id});
  audit(db,u,'collaboration_space',spaceId,'task.completed',{task_id:task.id,status:task.status},{task_id:task.id,status:'completed',evidence});
  return spaceTask(db,spaceId,task.id);
}

export function reopenSpaceTask(db,u,spaceId,taskId,input){
  writing(db);requireAction(db,u,spaceId,'space.organize');v.object(input,['version','reason','to_list_id','position']);
  const task=spaceTask(db,spaceId,taskId);v.version(input.version,task.version);if(task.status!=='completed')fail(409,'task_open','المهمة مفتوحة أصلًا؛ حدّث الشاشة قبل طلب إعادة الفتح');
  const target=listRow(db,spaceId,input.to_list_id);if(target.kind==='complete')fail(400,'active_list','اختر قائمة عمل مفتوحة؛ اختر قائمة مفتوحة من اللوحة');
  const reason=v.text(input.reason,'سبب إعادة الفتح',500,5);
  db.prepare(`UPDATE space_tasks SET status='open',evidence=NULL,completed_at=NULL,completed_by=NULL,list_id=?,position=?,version=version+1,updated_at=? WHERE id=?`)
    .run(target.id,input.position??task.position,now(),task.id);
  activity(db,u,spaceId,'task',task.id,'task.reopened',{reason,previous_evidence:task.evidence});
  audit(db,u,'collaboration_space',spaceId,'task.reopened',{task_id:task.id,status:'completed',evidence:task.evidence},{task_id:task.id,status:'open'},reason);
  return spaceTask(db,spaceId,task.id);
}

export function commentOnTask(db,u,spaceId,taskId,input){
  writing(db);requireAction(db,u,spaceId,'space.task');v.object(input,['body']);spaceTask(db,spaceId,taskId);
  const id=randomUUID(),stamp=now(),body=v.text(input.body,'التعليق',3000);
  db.prepare('INSERT INTO space_task_comments(id,tenant_id,task_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)').run(id,u.tenant_id,taskId,u.id,body,stamp);
  activity(db,u,spaceId,'task_comment',id,'task.commented',{task_id:taskId});
  return db.prepare('SELECT * FROM space_task_comments WHERE id=?').get(id);
}
