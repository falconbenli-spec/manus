import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { collaborationActor } from './collaboration-access.mjs';
import { createSpaceTask } from './collaboration-tasks.mjs';

const CADENCES=new Set(['daily','weekly','monthly']);
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تعديل السؤال الدوري يحتاج معاملة قاعدة بيانات');}
function actor(db,u,spaceId,organize=false){const current=collaborationActor(db,u,spaceId);if(organize&&!current.capabilities.includes('space.organize'))fail(403,'space_forbidden','تنظيم الأسئلة الدورية غير متاح لك');return current;}
const asDate=value=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))fail(400,'invalid_datetime','وقت تشغيل السؤال الدوري غير صالح');return date;};
function riyadhParts(value){const shifted=new Date(asDate(value).getTime()+3*3600000);return {year:shifted.getUTCFullYear(),month:shifted.getUTCMonth(),day:shifted.getUTCDate(),weekday:shifted.getUTCDay()};}
function utcForLocal(parts,time){const [hour,minute]=time.split(':').map(Number);return new Date(Date.UTC(parts.year,parts.month,parts.day,hour-3,minute,0,0));}
function firstDue(from,cadence,weekday,time){
  const base=asDate(from),parts=riyadhParts(base);let due=utcForLocal(parts,time);
  if(cadence==='weekly'){const add=(weekday-parts.weekday+7)%7;due=new Date(due.getTime()+add*86400000);}
  if(due<=base){if(cadence==='daily')due=new Date(due.getTime()+86400000);else if(cadence==='weekly')due=new Date(due.getTime()+7*86400000);else due=new Date(Date.UTC(parts.year,parts.month+1,parts.day,Number(time.slice(0,2))-3,Number(time.slice(3)),0,0));}
  return due.toISOString();
}
function nextDue(value,cadence){const date=asDate(value);if(cadence==='daily')date.setUTCDate(date.getUTCDate()+1);else if(cadence==='weekly')date.setUTCDate(date.getUTCDate()+7);else date.setUTCMonth(date.getUTCMonth()+1);return date.toISOString();}
function row(db,id){const checkin=db.prepare('SELECT * FROM workspace_checkins WHERE id=?').get(id);if(!checkin)fail(404,'checkin_not_found','السؤال الدوري غير متاح؛ حدّث مساحة العمل ثم حاول مرة أخرى');return checkin;}

export function createCheckin(db,u,spaceId,input){
  writing(db);actor(db,u,spaceId,true);v.object(input,['question','cadence','weekday','due_time','from']);
  if(!CADENCES.has(input.cadence))fail(400,'cadence','تكرار السؤال الدوري غير صالح');if(input.cadence==='weekly'&&(!Number.isInteger(input.weekday)||input.weekday<0||input.weekday>6))fail(400,'weekday','يوم السؤال الأسبوعي غير صالح');
  const time=typeof input.due_time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.due_time)?input.due_time:null;if(!time)fail(400,'due_time','وقت السؤال الدوري غير صالح');
  const stamp=now(),from=input.from??stamp,next=firstDue(from,input.cadence,input.weekday??null,time),id=randomUUID();
  db.prepare(`INSERT INTO workspace_checkins(id,tenant_id,space_id,question,cadence,weekday,local_time,timezone,next_due_at,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'Asia/Riyadh',?,?,?,?)`).run(id,u.tenant_id,spaceId,v.text(input.question,'السؤال الدوري',500,3),input.cadence,input.cadence==='weekly'?input.weekday:null,time,next,u.id,stamp,stamp);
  audit(db,u,'collaboration_space',spaceId,'checkin.created',{}, {checkin_id:id,cadence:input.cadence,next_due_at:next});return row(db,id);
}
export function runDueCheckins(db,{at=now()}={}){
  writing(db);const instant=asDate(at).toISOString(),generated=[];
  for(const checkin of db.prepare('SELECT * FROM workspace_checkins WHERE active=1 AND next_due_at<=? ORDER BY next_due_at,id').all(instant)){
    let due=checkin.next_due_at,guard=0;
    while(due<=instant&&guard++<100){
      const next=nextDue(due,checkin.cadence),id=randomUUID();
      db.prepare(`INSERT OR IGNORE INTO workspace_checkin_cycles(id,tenant_id,checkin_id,due_at,closes_at,generated_at) VALUES(?,?,?,?,?,?)`)
        .run(id,checkin.tenant_id,checkin.id,due,next,instant);
      if(db.prepare('SELECT id FROM workspace_checkin_cycles WHERE checkin_id=? AND due_at=?').get(checkin.id,due)?.id===id)generated.push(id);
      due=next;
    }
    db.prepare('UPDATE workspace_checkins SET next_due_at=?,version=version+1,updated_at=? WHERE id=?').run(due,instant,checkin.id);
  }
  return {generated};
}
export function answerCheckin(db,u,checkinId,input){
  writing(db);v.object(input,['body']);const checkin=row(db,checkinId);actor(db,u,checkin.space_id);
  const cycle=db.prepare('SELECT * FROM workspace_checkin_cycles WHERE checkin_id=? ORDER BY due_at DESC LIMIT 1').get(checkin.id);if(!cycle)fail(409,'checkin_not_due','لم تبدأ دورة السؤال بعد؛ انتظر بدء الدورة المعلنة ثم أجب');
  const existing=db.prepare('SELECT * FROM workspace_checkin_responses WHERE cycle_id=? AND user_id=?').get(cycle.id,u.id),stamp=now(),body=v.text(input.body,'إجابة السؤال الدوري',5000);
  if(existing){db.prepare('UPDATE workspace_checkin_responses SET body=?,updated_at=?,version=version+1 WHERE id=?').run(body,stamp,existing.id);return db.prepare('SELECT * FROM workspace_checkin_responses WHERE id=?').get(existing.id);}
  const id=randomUUID();db.prepare(`INSERT INTO workspace_checkin_responses(id,tenant_id,cycle_id,user_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(id,u.tenant_id,cycle.id,u.id,body,stamp,stamp);
  return db.prepare('SELECT * FROM workspace_checkin_responses WHERE id=?').get(id);
}
export function checkinBoard(db,u,spaceId){
  const current=actor(db,u,spaceId),organizer=current.capabilities.includes('space.organize');
  const members=organizer?db.prepare(`SELECT user_id FROM collaboration_memberships WHERE space_id=? AND removed_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?) ORDER BY user_id`).all(spaceId,now(),now()).map(x=>x.user_id):[];
  const checkins=db.prepare('SELECT * FROM workspace_checkins WHERE space_id=? ORDER BY created_at DESC,id').all(spaceId).map(checkin=>({
    ...checkin,cycles:db.prepare('SELECT * FROM workspace_checkin_cycles WHERE checkin_id=? ORDER BY due_at DESC LIMIT 12').all(checkin.id).map(cycle=>{
      const responses=db.prepare('SELECT id,user_id,body,created_at,updated_at,version FROM workspace_checkin_responses WHERE cycle_id=? ORDER BY created_at,id').all(cycle.id).map(response=>({...response}));
      return {...cycle,responses,missing_user_ids:organizer?members.filter(id=>!responses.some(response=>response.user_id===id)):undefined};
    })
  })).map(checkin=>({...checkin,answer_due:!!checkin.cycles[0]&&!checkin.cycles[0].responses.some(response=>response.user_id===u.id)}));
  return {checkins,can_organize:organizer};
}
export function convertAnswerToTask(db,u,responseId,input){
  writing(db);const response=db.prepare(`SELECT r.*,c.checkin_id,k.space_id FROM workspace_checkin_responses r JOIN workspace_checkin_cycles c ON c.id=r.cycle_id JOIN workspace_checkins k ON k.id=c.checkin_id WHERE r.id=?`).get(responseId);
  if(!response)fail(404,'checkin_response_not_found','إجابة السؤال الدوري غير متاحة');actor(db,u,response.space_id,true);const task=createSpaceTask(db,u,response.space_id,input);
  db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(u.tenant_id,response.space_id,u.id,'checkin_response',response.id,'checkin.converted_to_task',JSON.stringify({task_id:task.id}),now());return task;
}
