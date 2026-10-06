import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { collaborationActor } from './collaboration-access.mjs';
import { createSpaceTask } from './collaboration-tasks.mjs';

function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تعديل تواصل مساحة العمل يحتاج معاملة قاعدة بيانات');}
function actor(db,u,spaceId,capability){const current=collaborationActor(db,u,spaceId);if(!current.capabilities.includes(capability))fail(403,'space_forbidden','هذا الإجراء غير متاح لك في مساحة العمل');return current;}
function activity(db,u,spaceId,type,id,action,details={}){db.prepare(`INSERT INTO space_activity(tenant_id,space_id,actor_id,entity_type,entity_id,action,details_json,created_at)
  VALUES(?,?,?,?,?,?,?,?)`).run(u.tenant_id,spaceId,u.id,type,id,action,JSON.stringify(details),now());}
function topicRow(db,spaceId,id){const row=db.prepare('SELECT * FROM workspace_topics WHERE id=? AND space_id=?').get(id,spaceId);if(!row)fail(404,'topic_not_found','المنشور غير متاح؛ حدّث لوحة الرسائل ثم حاول مرة أخرى');return row;}
function lineRow(db,spaceId,id){const row=db.prepare('SELECT * FROM workspace_chat_lines WHERE id=? AND space_id=?').get(id,spaceId);if(!row)fail(404,'chat_not_found','رسالة المحادثة غير متاحة؛ حدّث المحادثة ثم حاول مرة أخرى');return row;}

export function messageBoard(db,u,spaceId){
  const current=actor(db,u,spaceId,'space.read');
  const topics=db.prepare('SELECT * FROM workspace_topics WHERE space_id=? ORDER BY created_at DESC,id').all(spaceId).map(row=>({
    ...row,body:row.status==='withdrawn'?null:row.body,
    comments:db.prepare('SELECT id,author_id,body,created_at FROM workspace_topic_comments WHERE topic_id=? ORDER BY created_at,id').all(row.id).map(comment=>({...comment}))
  }));
  return {topics,can_publish:current.capabilities.includes('space.publish')};
}

export function publishTopic(db,u,spaceId,input){
  writing(db);actor(db,u,spaceId,'space.publish');v.object(input,['title','body']);const id=randomUUID(),stamp=now();
  db.prepare(`INSERT INTO workspace_topics(id,tenant_id,space_id,title,body,author_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id,u.tenant_id,spaceId,v.text(input.title,'عنوان المنشور',180,2),v.text(input.body,'نص المنشور',20000,2),u.id,stamp,stamp);
  activity(db,u,spaceId,'topic',id,'topic.published',{});audit(db,u,'collaboration_space',spaceId,'topic.published',{}, {topic_id:id});
  return topicRow(db,spaceId,id);
}
export function reviseTopic(db,u,spaceId,topicId,input){
  writing(db);const current=actor(db,u,spaceId,'space.publish');v.object(input,['version','title','body','reason']);const topic=topicRow(db,spaceId,topicId);v.version(input.version,topic.version);
  if(topic.status!=='published')fail(409,'topic_withdrawn','المنشور مسحوب ولا يقبل تعديلًا');if(topic.author_id!==u.id&&!current.capabilities.includes('space.organize'))fail(403,'space_forbidden','تعديل المنشور لكاتبه أو منظم المساحة');
  const reason=v.text(input.reason,'سبب التعديل',500,5),stamp=now();
  db.prepare(`INSERT INTO workspace_topic_revisions(id,tenant_id,topic_id,version,title,body,reason,revised_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,topic.id,topic.version,topic.title,topic.body,reason,u.id,stamp);
  db.prepare('UPDATE workspace_topics SET title=?,body=?,version=version+1,updated_at=? WHERE id=?')
    .run(v.text(input.title,'عنوان المنشور',180,2),v.text(input.body,'نص المنشور',20000,2),stamp,topic.id);
  activity(db,u,spaceId,'topic',topic.id,'topic.revised',{reason});return topicRow(db,spaceId,topic.id);
}
export function withdrawTopic(db,u,spaceId,topicId,input){
  writing(db);const current=actor(db,u,spaceId,'space.publish');v.object(input,['version','reason']);const topic=topicRow(db,spaceId,topicId);v.version(input.version,topic.version);
  if(topic.author_id!==u.id&&!current.capabilities.includes('space.organize'))fail(403,'space_forbidden','سحب المنشور لكاتبه أو منظم المساحة');
  const reason=v.text(input.reason,'سبب السحب',500,5),stamp=now();
  db.prepare("UPDATE workspace_topics SET status='withdrawn',withdrawn_by=?,withdrawn_at=?,withdrawal_reason=?,version=version+1,updated_at=? WHERE id=?")
    .run(u.id,stamp,reason,stamp,topic.id);activity(db,u,spaceId,'topic',topic.id,'topic.withdrawn',{reason});audit(db,u,'collaboration_space',spaceId,'topic.withdrawn',{topic_id:topic.id,status:topic.status},{status:'withdrawn'},reason);
  return topicRow(db,spaceId,topic.id);
}
export function commentOnTopic(db,u,spaceId,topicId,input){
  writing(db);actor(db,u,spaceId,'space.publish');v.object(input,['body']);const topic=topicRow(db,spaceId,topicId);if(topic.status!=='published')fail(409,'topic_withdrawn','المنشور مسحوب؛ أنشئ منشورًا جديدًا بدل تعديل المسحوب');
  const id=randomUUID(),stamp=now();db.prepare('INSERT INTO workspace_topic_comments(id,tenant_id,topic_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)')
    .run(id,u.tenant_id,topic.id,u.id,v.text(input.body,'التعليق',5000),stamp);activity(db,u,spaceId,'topic_comment',id,'topic.commented',{topic_id:topic.id});
  return db.prepare('SELECT * FROM workspace_topic_comments WHERE id=?').get(id);
}

export function chatLines(db,u,spaceId,{limit=100,before=null}={}){
  actor(db,u,spaceId,'space.chat');if(!Number.isInteger(limit)||limit<1||limit>200)fail(400,'limit','حد المحادثة غير صالح؛ استخدم رقمًا ضمن الحدود المعلنة');
  const rows=before?db.prepare('SELECT * FROM workspace_chat_lines WHERE space_id=? AND created_at<? ORDER BY created_at DESC,id DESC LIMIT ?').all(spaceId,before,limit):
    db.prepare('SELECT * FROM workspace_chat_lines WHERE space_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(spaceId,limit);
  return {items:rows.map(row=>({...row,body:row.status==='redacted'?null:row.body})),next:rows.length===limit?rows.at(-1).created_at:null};
}
export function postChatLine(db,u,spaceId,input){
  writing(db);actor(db,u,spaceId,'space.chat');v.object(input,['body']);const id=randomUUID(),stamp=now();
  db.prepare(`INSERT INTO workspace_chat_lines(id,tenant_id,space_id,author_id,body,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(id,u.tenant_id,spaceId,u.id,v.text(input.body,'الرسالة',5000),stamp,stamp);activity(db,u,spaceId,'chat',id,'chat.posted',{});
  return lineRow(db,spaceId,id);
}
export function reviseChatLine(db,u,spaceId,lineId,input){
  writing(db);actor(db,u,spaceId,'space.chat');v.object(input,['version','body','reason']);const line=lineRow(db,spaceId,lineId);v.version(input.version,line.version);
  if(line.author_id!==u.id||line.status!=='visible')fail(403,'space_forbidden','تعديل رسالة المحادثة لكاتبها وهي ظاهرة');const reason=v.text(input.reason,'سبب التعديل',500,3),stamp=now();
  db.prepare(`INSERT INTO chat_line_revisions(id,tenant_id,line_id,version,body,reason,revised_by,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,line.id,line.version,line.body,reason,u.id,stamp);
  db.prepare('UPDATE workspace_chat_lines SET body=?,version=version+1,updated_at=? WHERE id=?').run(v.text(input.body,'الرسالة',5000),stamp,line.id);
  activity(db,u,spaceId,'chat',line.id,'chat.revised',{reason});return lineRow(db,spaceId,line.id);
}
export function redactChatLine(db,u,spaceId,lineId,input){
  writing(db);const current=actor(db,u,spaceId,'space.chat');v.object(input,['version','reason']);const line=lineRow(db,spaceId,lineId);v.version(input.version,line.version);
  if(line.author_id!==u.id&&!current.capabilities.includes('space.organize'))fail(403,'space_forbidden','حجب الرسالة لكاتبها أو منظم المساحة');if(line.status!=='visible')fail(409,'chat_redacted','الرسالة محجوبة أصلًا؛ لا يمكن تعديل محتوى رسالة محجوبة');
  const reason=v.text(input.reason,'سبب الحجب',500,5),stamp=now();db.prepare(`INSERT INTO chat_line_revisions(id,tenant_id,line_id,version,body,reason,revised_by,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),u.tenant_id,line.id,line.version,line.body,reason,u.id,stamp);
  db.prepare("UPDATE workspace_chat_lines SET body=NULL,status='redacted',redacted_by=?,redacted_at=?,redaction_reason=?,version=version+1,updated_at=? WHERE id=?")
    .run(u.id,stamp,reason,stamp,line.id);activity(db,u,spaceId,'chat',line.id,'chat.redacted',{reason});audit(db,u,'collaboration_space',spaceId,'chat.redacted',{line_id:line.id},{status:'redacted'},reason);
  return lineRow(db,spaceId,line.id);
}
export function convertToTask(db,u,spaceId,lineId,input){
  writing(db);actor(db,u,spaceId,'space.task');const line=lineRow(db,spaceId,lineId);if(line.status!=='visible')fail(409,'chat_redacted','لا تتحول رسالة محجوبة إلى مهمة');
  const task=createSpaceTask(db,u,spaceId,input);activity(db,u,spaceId,'chat',line.id,'chat.converted_to_task',{task_id:task.id});
  audit(db,u,'collaboration_space',spaceId,'chat.converted_to_task',{line_id:line.id},{task_id:task.id});return task;
}
