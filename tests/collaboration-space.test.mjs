import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace, spaceById, spaceForTarget, spacesForUser, spaceCapabilities } from '../app/collaboration-space.mjs';

const code=value=>error=>error?.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-collaboration-space');t.after(()=>db.close());
  const stamp=now();
  db.prepare('INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES(?,?,?,?,?,?)')
    .run('project-space','36t','مشروع مساحة العمل','مشروع مصطنع لاختبار مساحة التعاون','manager',stamp);
  for(const id of ['manager','employee'])db.prepare('INSERT INTO project_members(project_id,user_id) VALUES(?,?)').run('project-space',id);
  return {db,manager:user(db,'manager'),employee:user(db,'employee'),outsider:user(db,'outsider'),admin:user(db,'admin'),external:user(db,'external')};
}

test('one target has one space and membership never crosses tenants',t=>{
  const {db,manager,employee}=fixture(t);
  const first=transaction(db,()=>ensureSpace(db,manager,{kind:'project',id:'project-space'}));
  const second=transaction(db,()=>ensureSpace(db,manager,{kind:'project',id:'project-space'}));
  assert.equal(first.id,second.id);
  assert.equal(spaceForTarget(db,employee,{kind:'project',id:'project-space'}).id,first.id);
  assert.throws(()=>db.prepare(`INSERT INTO collaboration_memberships(id,tenant_id,space_id,user_id,role,starts_at,created_by,created_at)
    VALUES('cross-tenant','isolated',?,'external','member',?,'external',?)`).run(first.id,now(),now()),/FOREIGN KEY|tenant/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collaboration_spaces WHERE target_kind=? AND target_id=?').get('project','project-space').n,1);
  assert.deepEqual(db.prepare('SELECT title,kind FROM work_lists WHERE space_id=? ORDER BY position').all(first.id).map(row=>({...row})),[
    {title:'قادم',kind:'backlog'},{title:'قيد العمل',kind:'active'},{title:'مكتمل',kind:'complete'}
  ]);
  assert.deepEqual(spacesForUser(db,employee).spaces.map(item=>item.id),[first.id]);
});

test('workspace discovery shows only eligible targets and removes a suggestion after activation',t=>{
  const {db,manager,employee,admin}=fixture(t);
  const before=spacesForUser(db,employee);
  assert.ok(before.suggestions.some(item=>item.kind==='department'&&item.id==='creative'));
  assert.ok(before.suggestions.some(item=>item.kind==='project'&&item.id==='project-space'));
  assert.deepEqual(spacesForUser(db,admin),{spaces:[],suggestions:[]});
  const space=transaction(db,()=>ensureSpace(db,manager,{kind:'department',id:'creative'}));
  const after=spacesForUser(db,employee);
  assert.ok(after.spaces.some(item=>item.id===space.id&&item.target_kind==='department'));
  assert.ok(!after.suggestions.some(item=>item.kind==='department'&&item.id==='creative'));
});

test('project membership is derived without copying project business fields',t=>{
  const {db,manager,employee,outsider,admin}=fixture(t);
  const space=transaction(db,()=>ensureSpace(db,manager,{kind:'project',id:'project-space'}));
  assert.equal(space.name,'مشروع مساحة العمل');
  assert.equal(space.target_kind,'project');
  assert.deepEqual(db.prepare('SELECT user_id,role FROM collaboration_memberships WHERE space_id=? ORDER BY user_id').all(space.id).map(row=>({...row})),[
    {user_id:'employee',role:'member'},
    {user_id:'manager',role:'owner'}
  ]);
  const columns=db.prepare("PRAGMA table_info('collaboration_spaces')").all().map(column=>column.name);
  for(const forbidden of ['customer_id','budget_minor','project_status','status'])assert.ok(!columns.includes(forbidden),`${forbidden} is not copied`);
  assert.throws(()=>spaceById(db,outsider,space.id),code('space_not_found'));
  assert.throws(()=>spaceById(db,admin,space.id),code('space_not_found'),'platform administration does not imply project membership');
  assert.deepEqual(spaceCapabilities(db,employee,space),['space.read','space.task','space.publish','space.chat','space.files']);
});

test('department spaces derive active internal members and external guests stay disabled',t=>{
  const {db,manager,external}=fixture(t);
  const space=transaction(db,()=>ensureSpace(db,manager,{kind:'department',id:'creative'}));
  assert.deepEqual(db.prepare('SELECT user_id,role FROM collaboration_memberships WHERE space_id=? ORDER BY user_id').all(space.id).map(row=>({...row})),[
    {user_id:'employee',role:'member'},
    {user_id:'manager',role:'owner'},
    {user_id:'outsider',role:'member'}
  ]);
  assert.throws(()=>db.prepare(`INSERT INTO collaboration_memberships(id,tenant_id,space_id,user_id,role,starts_at,created_by,created_at)
    VALUES('external-guest','36t',?,'manager','external_guest',?,'manager',?)`).run(space.id,now(),now()),/external guests are disabled/i);
  assert.throws(()=>transaction(db,()=>ensureSpace(db,external,{kind:'department',id:'creative'})),code('target_not_found'));
});
