import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';

const PASSWORD='synthetic-collaboration-api';
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
async function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());const owner=user(db,'manager');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'})),list=db.prepare("SELECT * FROM work_lists WHERE space_id=? AND kind='active'").get(space.id),app=createApp(db);
  const sessions={};for(const username of ['employee','admin']){const login=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});sessions[username]={cookie:login.headers['Set-Cookie'].split(';')[0],csrf:login.json().csrf};}
  const call=(who,path,{method='GET',body,csrf=true,key=null}={})=>dispatch(app,{method,path,headers:{cookie:sessions[who].cookie,...(csrf?{'x-csrf-token':sessions[who].csrf}:{}),...(key?{'idempotency-key':key}:{})},body});
  return {db,space,list,call};
}

test('workspace writes require CSRF and creation is idempotent',async t=>{
  const {space,list,call}=await fixture(t),body={list_id:list.id,title:'مهمة واجهة API',accountable_id:'employee',due_on:'2099-10-12',acceptance:'مخرج محفوظ ومراجع'};
  assert.equal((await call('employee',`/api/spaces/${space.id}/tasks`,{method:'POST',body,csrf:false,key:'workspace-task-0001'})).status,403);
  const first=await call('employee',`/api/spaces/${space.id}/tasks`,{method:'POST',body,key:'workspace-task-0001'}),second=await call('employee',`/api/spaces/${space.id}/tasks`,{method:'POST',body,key:'workspace-task-0001'});
  assert.equal(first.status,201);assert.equal(second.status,201);assert.equal(first.json().id,second.json().id);
  const board=await call('employee',`/api/spaces/${space.id}/tasks`);assert.equal(board.status,200);assert.equal(board.json().tasks.length,1);
  assert.equal((await call('admin',`/api/spaces/${space.id}/tasks`)).status,404,'platform admin has no implicit workspace membership');
});

test('chat pagination returns a cursor and board endpoints never include file bytes',async t=>{
  const {space,call}=await fixture(t);
  for(const [key,body] of [['workspace-chat-0001','السطر الأول'],['workspace-chat-0002','السطر الثاني']])assert.equal((await call('employee',`/api/spaces/${space.id}/chat`,{method:'POST',body:{body},key})).status,201);
  const page=await call('employee',`/api/spaces/${space.id}/chat?limit=1`);assert.equal(page.status,200);assert.equal(page.json().items.length,1);assert.ok(page.json().next);
  const files=await call('employee',`/api/spaces/${space.id}/files`);assert.equal(files.status,200);assert.doesNotMatch(files.text,/"content"\s*:/);
});

test('work and space discovery expose the same governed workspace without creating duplicates',async t=>{
  const {space,call}=await fixture(t);
  const work=await call('employee','/api/work'),spaces=await call('employee','/api/spaces');
  assert.equal(work.status,200);assert.ok(work.json().spaces.some(item=>item.id===space.id));
  assert.equal(spaces.status,200);assert.deepEqual(spaces.json().spaces.map(item=>item.id),[space.id]);
  assert.equal((await call('admin','/api/spaces')).json().spaces.length,0,'platform administration still grants no implicit workspace access');
});
