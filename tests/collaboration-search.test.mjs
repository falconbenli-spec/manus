import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { removeSpaceMember } from '../app/collaboration-access.mjs';
import { publishTopic } from '../app/collaboration-messages.mjs';
import { createDocument } from '../app/collaboration-files.mjs';
import { reindex, searchAll } from '../app/search.mjs';

const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function fixture(t){const db=openDb(':memory:');seed(db,'synthetic-collaboration-search');t.after(()=>db.close());const owner=user(db,'manager'),member=user(db,'employee');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'}));return {db,owner,member,space};}
const results=(board,key)=>board.groups.find(group=>group.key===key)?.results??[];

test('search never reveals a workspace title after membership removal, even before reindex',t=>{
  const {db,owner,member,space}=fixture(t);transaction(db,()=>publishTopic(db,owner,space.id,{title:'خطة سرية مصطنعة',body:'نص تجريبي داخل مساحة العمل'}));
  transaction(db,()=>reindex(db,'36t'));assert.equal(results(searchAll(db,member,'خطة سرية'),'workspace_topic').length,1);
  transaction(db,()=>removeSpaceMember(db,owner,space.id,member.id,{reason:'انتهاء المشاركة في هذا العمل'}));
  assert.equal(searchAll(db,member,'خطة سرية').total,0);
});

test('workspace search indexes documents but never raw chat or file bytes',t=>{
  const {db,owner,member,space}=fixture(t);transaction(db,()=>createDocument(db,owner,space.id,{title:'دليل التسليم التشغيلي',body:'خطوات المراجعة والتسليم الداخلي'}));
  transaction(db,()=>reindex(db,'36t'));const documents=results(searchAll(db,member,'المراجعة والتسليم'),'workspace_document');
  assert.equal(documents.length,1);
  assert.equal(documents[0].href,`#workspace/${space.id}/files`);
  assert.equal(searchAll(db,member,'synthetic-binary-canary').total,0);
});
