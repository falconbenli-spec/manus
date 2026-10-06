import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { collaborationActor } from './collaboration-access.mjs';

const RECURRENCE=new Set(['none','daily','weekly','monthly']);
const RANGE_START=new Date(0).toISOString();
const RANGE_END=new Date(253402300799999).toISOString();
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تعديل جدول مساحة العمل يحتاج معاملة قاعدة بيانات');}
function actor(db,u,spaceId,organize=false){const current=collaborationActor(db,u,spaceId);if(organize&&!current.capabilities.includes('space.organize'))fail(403,'space_forbidden','تنظيم جدول مساحة العمل غير متاح لك');return current;}
function iso(value,label){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'invalid_datetime',`${label}: التاريخ والوقت غير صالحين`);return new Date(value).toISOString();}
function eventRow(db,spaceId,id){const row=db.prepare('SELECT * FROM workspace_events WHERE id=? AND space_id=?').get(id,spaceId);if(!row)fail(404,'event_not_found','الموعد غير متاح؛ حدّث الجدول ثم حاول مرة أخرى');return row;}
function activeMember(db,spaceId,userId){const stamp=now();return db.prepare(`SELECT 1 FROM collaboration_memberships WHERE space_id=? AND user_id=? AND removed_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)`).get(spaceId,userId,stamp,stamp);}

export function scheduleBoard(db,u,spaceId,{from=RANGE_START,to=RANGE_END}={}){
  const current=actor(db,u,spaceId);const start=iso(from,'بداية المدة'),end=iso(to,'نهاية المدة');if(end<start)fail(400,'date_order','نهاية المدة تسبق بدايتها؛ راجع تاريخ البداية والنهاية');
  const events=db.prepare('SELECT * FROM workspace_events WHERE space_id=? AND starts_at<=? AND ends_at>=? ORDER BY starts_at,id').all(spaceId,end,start).map(row=>({
    ...row,attendee_ids:db.prepare('SELECT user_id FROM workspace_event_attendees WHERE event_id=? ORDER BY user_id').all(row.id).map(item=>item.user_id)
  }));return {events,timezone:'Asia/Riyadh',can_organize:current.capabilities.includes('space.organize')};
}
export function createEvent(db,u,spaceId,input){
  writing(db);actor(db,u,spaceId,true);v.object(input,['title','description','starts_at','ends_at','location','recurrence','attendee_ids']);
  const starts=iso(input.starts_at,'بداية الموعد'),ends=iso(input.ends_at,'نهاية الموعد');if(ends<=starts)fail(400,'date_order','نهاية الموعد يجب أن تكون بعد بدايته');
  const recurrence=input.recurrence??'none';if(!RECURRENCE.has(recurrence))fail(400,'recurrence','تكرار الموعد غير صالح؛ اختر نمطًا من الخيارات المعروضة');
  const attendees=[...new Set(input.attendee_ids??[])];if(!Array.isArray(input.attendee_ids??[])||attendees.length>100||attendees.some(id=>typeof id!=='string'||!activeMember(db,spaceId,id)))fail(400,'attendees','الحضور يجب أن يكونوا أعضاء نشطين في المساحة');
  const id=randomUUID(),stamp=now();db.prepare(`INSERT INTO workspace_events(id,tenant_id,space_id,title,description,starts_at,ends_at,timezone,location,status,created_by,created_at,updated_at,recurrence_rule)
    VALUES(?,?,?,?,?,?,?,'Asia/Riyadh',?,'scheduled',?,?,?,?)`).run(id,u.tenant_id,spaceId,v.text(input.title,'عنوان الموعد',180,2),input.description?v.text(input.description,'وصف الموعد',3000):'',starts,ends,input.location?v.text(input.location,'المكان',500):'',u.id,stamp,stamp,recurrence);
  for(const userId of attendees)db.prepare('INSERT INTO workspace_event_attendees(tenant_id,event_id,user_id) VALUES(?,?,?)').run(u.tenant_id,id,userId);
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(u.tenant_id,spaceId,u.id,'event',id,'event.created',JSON.stringify({starts_at:starts,ends_at:ends,recurrence}),stamp);
  audit(db,u,'collaboration_space',spaceId,'event.created',{}, {event_id:id,starts_at:starts,ends_at:ends,recurrence});return eventRow(db,spaceId,id);
}
export function cancelEvent(db,u,spaceId,eventId,input){
  writing(db);actor(db,u,spaceId,true);v.object(input,['version','reason']);const event=eventRow(db,spaceId,eventId);v.version(input.version,event.version);if(event.status!=='scheduled')fail(409,'event_closed','الموعد ليس مجدولًا؛ أنشئ موعدًا جديدًا بدل تعديل المغلق');
  const reason=v.text(input.reason,'سبب إلغاء الموعد',500,5),stamp=now();db.prepare(`UPDATE workspace_events SET status='cancelled',cancelled_by=?,cancelled_at=?,cancellation_reason=?,version=version+1,updated_at=? WHERE id=?`)
    .run(u.id,stamp,reason,stamp,event.id);audit(db,u,'collaboration_space',spaceId,'event.cancelled',{event_id:event.id,status:event.status},{status:'cancelled'},reason);return eventRow(db,spaceId,event.id);
}
