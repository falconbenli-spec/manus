import { fail } from './auth.mjs';
import { now } from './db.mjs';
import { collaborationActor } from './collaboration-access.mjs';

const RANGE_START=new Date(0).toISOString();
function access(db,u,spaceId){const actor=collaborationActor(db,u,spaceId);if(!actor.capabilities.includes('space.read'))fail(403,'space_forbidden','تقارير مساحة العمل غير متاحة لك');return actor;}
function iso(value,label){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail(400,'invalid_datetime',`${label}: التاريخ والوقت غير صالحين`);return new Date(value).toISOString();}
export function activityFeed(db,u,spaceId,{cursor=null,limit=50}={}){
  access(db,u,spaceId);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'limit','حد سجل النشاط غير صالح؛ استخدم رقمًا ضمن الحدود المعلنة');
  const items=cursor===null?db.prepare('SELECT * FROM space_activity WHERE space_id=? ORDER BY seq DESC LIMIT ?').all(spaceId,limit):
    db.prepare('SELECT * FROM space_activity WHERE space_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(spaceId,cursor,limit);
  return {items:items.map(row=>({...row,details:JSON.parse(row.details_json)})),next_cursor:items.length===limit?items.at(-1).seq:null};
}
export function workspaceReport(db,u,spaceId,{from=RANGE_START,to=now()}={}){
  const actor=access(db,u,spaceId),start=iso(from,'بداية التقرير'),end=iso(to,'نهاية التقرير');if(end<start)fail(400,'date_order','نهاية التقرير تسبق بدايته؛ راجع تاريخ البداية والنهاية');
  const tasks=actor.target_kind==='project'?db.prepare(`SELECT id,title,assignee_id AS accountable_id,status,due_date AS due_on,created_at FROM tasks WHERE project_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at,id`).all(actor.target_id,start,end):
    db.prepare('SELECT id,title,accountable_id,status,due_on,created_at FROM space_tasks WHERE space_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at,id').all(spaceId,start,end);
  const topics=db.prepare('SELECT id,title,status,author_id,created_at FROM workspace_topics WHERE space_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at,id').all(spaceId,start,end);
  const events=db.prepare('SELECT id,title,status,starts_at,ends_at FROM workspace_events WHERE space_id=? AND starts_at BETWEEN ? AND ? ORDER BY starts_at,id').all(spaceId,start,end);
  const fileVersions=db.prepare(`SELECT v.id,v.file_id,v.version,v.filename,v.size,v.scan_state,v.created_at FROM workspace_file_versions v JOIN workspace_files f ON f.id=v.file_id
    WHERE f.space_id=? AND v.created_at BETWEEN ? AND ? ORDER BY v.created_at,v.id`).all(spaceId,start,end);
  const activities=db.prepare('SELECT seq,actor_id,entity_type,entity_id,action,created_at FROM space_activity WHERE space_id=? AND created_at BETWEEN ? AND ? ORDER BY seq').all(spaceId,start,end);
  const by=new Map();for(const task of tasks.filter(row=>row.status==='open'))by.set(task.accountable_id,(by.get(task.accountable_id)??0)+1);
  return {period:{from:start,to:end},counts:{tasks:tasks.length,topics:topics.length,events:events.length,file_versions:fileVersions.length,activities:activities.length},
    rows:{tasks:tasks.map(x=>({...x})),topics:topics.map(x=>({...x})),events:events.map(x=>({...x})),file_versions:fileVersions.map(x=>({...x})),activities:activities.map(x=>({...x}))},
    workload:{label:'عدد المهام المفتوحة',note:'عدد مهام عمل لا تقييم أداء للأشخاص',by_accountable:[...by].map(([accountable_id,task_count])=>({accountable_id,task_count})).sort((a,b)=>b.task_count-a.task_count)}};
}
