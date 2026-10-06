import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { messageBoard, publishTopic, reviseTopic, withdrawTopic, commentOnTopic, chatLines, postChatLine, reviseChatLine, redactChatLine, convertToTask } from '../app/collaboration-messages.mjs';
import { taskBoard } from '../app/collaboration-tasks.mjs';

const code=value=>error=>error?.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function fixture(t){const db=openDb(':memory:');seed(db,'synthetic-collaboration-messages');t.after(()=>db.close());
  const owner=user(db,'manager'),member=user(db,'employee'),space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'}));
  return {db,owner,member,space,list:db.prepare('SELECT * FROM work_lists WHERE space_id=?').get(space.id)};}

test('formal project topics stay separate from company announcements and retain revisions',t=>{
  const {db,owner,member,space}=fixture(t);
  let topic=transaction(db,()=>publishTopic(db,owner,space.id,{title:'تحديث خطة التسليم',body:'تم الاتفاق على موعد التسليم التجريبي'}));
  topic=transaction(db,()=>reviseTopic(db,owner,space.id,topic.id,{version:topic.version,title:'تحديث خطة التسليم',body:'تم تعديل موعد التسليم التجريبي بعد المراجعة',reason:'تحديث الموعد بعد اجتماع الفريق'}));
  transaction(db,()=>commentOnTopic(db,member,space.id,topic.id,{body:'اطلعت على الموعد الجديد'}));
  const board=messageBoard(db,member,space.id);assert.equal(board.topics.length,1);assert.equal(board.topics[0].comments.length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_topic_revisions WHERE topic_id=?').get(topic.id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM announcements').get().n,0,'workspace topics do not become organisation announcements');
  transaction(db,()=>withdrawTopic(db,owner,space.id,topic.id,{version:topic.version,reason:'أصبح التحديث غير صالح للنشر'}));
  assert.equal(messageBoard(db,member,space.id).topics[0].body,null);
});

test('chat cannot become approval and redaction keeps the audit trail without leaking text',t=>{
  const {db,member,space}=fixture(t);
  const line=transaction(db,()=>postChatLine(db,member,space.id,{body:'ملاحظة سريعة مصطنعة'}));
  assert.throws(()=>transaction(db,()=>postChatLine(db,member,space.id,{body:'اعتمدت الصرف',effect:'approve'})),code('invalid_fields'));
  const revised=transaction(db,()=>reviseChatLine(db,member,space.id,line.id,{version:line.version,body:'ملاحظة سريعة مصطنعة بعد التصحيح',reason:'تصحيح العبارة'}));
  transaction(db,()=>redactChatLine(db,member,space.id,line.id,{version:revised.version,reason:'احتوى معلومة غير لازمة'}));
  assert.equal(chatLines(db,member,space.id).items[0].body,null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_line_revisions WHERE line_id=?').get(line.id).n,2);
});

test('a chat line converts to one governed task and keeps its source link',t=>{
  const {db,member,space,list}=fixture(t);
  const line=transaction(db,()=>postChatLine(db,member,space.id,{body:'نحتاج تجهيز نموذج الاستلام'}));
  const task=transaction(db,()=>convertToTask(db,member,space.id,line.id,{list_id:list.id,title:'تجهيز نموذج الاستلام',accountable_id:member.id,due_on:'2099-10-10',acceptance:'نموذج مراجع'}));
  assert.equal(task.source_kind,null);assert.equal(taskBoard(db,member,space.id).tasks[0].id,task.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM space_activity WHERE space_id=? AND action='chat.converted_to_task'").get(space.id).n,1);
});

