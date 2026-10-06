import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { createSpaceTask } from '../app/collaboration-tasks.mjs';
import { createFolder, createDocument, saveDocumentRevision, uploadWorkspaceFile, publishFileAsEvidence, downloadWorkspaceFile, filesBoard } from '../app/collaboration-files.mjs';

const code=value=>error=>error?.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const pdf=text=>Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from(text)]).toString('base64');
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-collaboration-files');t.after(()=>db.close());
  const owner=user(db,'manager'),member=user(db,'employee'),space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'}));
  const list=db.prepare('SELECT * FROM work_lists WHERE space_id=?').get(space.id);
  const task=transaction(db,()=>createSpaceTask(db,owner,space.id,{list_id:list.id,title:'مهمة دليل الملف',accountable_id:member.id,due_on:'2099-10-08',acceptance:'نسخة ثابتة من التسليم'}));
  return {db,owner,member,space,task};
}

test('documents keep immutable revisions and expose only their current revision on the board',t=>{
  const {db,owner,member,space}=fixture(t);
  const folder=transaction(db,()=>createFolder(db,owner,space.id,{name:'مخرجات المشروع'}));
  let doc=transaction(db,()=>createDocument(db,member,space.id,{folder_id:folder.id,title:'محضر العمل',body:'النسخة الأولى من المحضر المصطنع'}));
  doc=transaction(db,()=>saveDocumentRevision(db,member,space.id,doc.id,{version:doc.version,body:'النسخة الثانية من المحضر المصطنع',note:'إضافة قرارات الاجتماع'}));
  assert.equal(doc.current_revision,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_document_revisions WHERE document_id=?').get(doc.id).n,2);
  assert.throws(()=>db.prepare("UPDATE workspace_document_revisions SET body='x' WHERE document_id=?").run(doc.id),/immutable/i);
  const board=filesBoard(db,member,space.id);assert.equal(board.documents[0].current_revision,2);assert.doesNotMatch(JSON.stringify(board),/النسخة الأولى/);
});

test('publishing a file as evidence pins one digest even after a new version',t=>{
  const {db,member,space,task}=fixture(t);
  const file=transaction(db,()=>uploadWorkspaceFile(db,member,space.id,{label:'ملف التسليم',filename:'delivery.pdf',content:pdf('v1')}));
  assert.equal(file.scan_state,'unavailable');
  const proof=transaction(db,()=>publishFileAsEvidence(db,member,space.id,file.id,{version:file.current_version,entity_type:'space_task',entity_id:task.id,label:'التسليم المقبول'}));
  const updated=transaction(db,()=>uploadWorkspaceFile(db,member,space.id,{replaces_id:file.id,label:'ملف التسليم',filename:'delivery-v2.pdf',content:pdf('v2')}));
  assert.equal(updated.current_version,2);
  assert.equal(db.prepare('SELECT digest FROM workspace_evidence_links WHERE id=?').get(proof.id).digest,file.digest);
  assert.notEqual(updated.digest,file.digest);
  assert.equal(downloadWorkspaceFile(db,member,space.id,file.id,{version:1,allow_unavailable:true}).content.toString().includes('v1'),true);
  assert.equal(downloadWorkspaceFile(db,member,space.id,file.id,{version:2,allow_unavailable:true}).content.toString().includes('v2'),true);
});

test('file signatures, names, membership and scan state are enforced',t=>{
  const {db,member,space}=fixture(t);
  assert.throws(()=>transaction(db,()=>uploadWorkspaceFile(db,member,space.id,{label:'ملف تنفيذي',filename:'run.pdf',content:Buffer.from('MZ executable').toString('base64')})),code('file_type'));
  assert.throws(()=>transaction(db,()=>uploadWorkspaceFile(db,member,space.id,{label:'اسم غير صالح',filename:'../secret.pdf',content:pdf('bad name')})),code('filename'));
  const file=transaction(db,()=>uploadWorkspaceFile(db,member,space.id,{label:'ملف ينتظر الفحص',filename:'waiting.pdf',content:pdf('waiting')}));
  assert.throws(()=>downloadWorkspaceFile(db,member,space.id,file.id),code('scan_unavailable'));
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(member.id);
  assert.throws(()=>filesBoard(db,member,space.id),code('space_not_found'));
});

