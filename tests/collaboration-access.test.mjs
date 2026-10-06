import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace, spaceById } from '../app/collaboration-space.mjs';
import { collaborationActor, canSpace, addSpaceMember, removeSpaceMember, changeSpaceRole } from '../app/collaboration-access.mjs';

const code=value=>error=>error?.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-collaboration-access');t.after(()=>db.close());
  const stamp=now();
  db.prepare('INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES(?,?,?,?,?,?)')
    .run('access-project','36t','مشروع الصلاحيات','مشروع مصطنع لاختبار صلاحيات مساحة العمل','manager',stamp);
  for(const id of ['manager','employee'])db.prepare('INSERT INTO project_members(project_id,user_id) VALUES(?,?)').run('access-project',id);
  const owner=user(db,'manager'),member=user(db,'employee');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'project',id:'access-project'}));
  return {db,owner,member,outsider:user(db,'outsider'),admin:user(db,'admin'),space};
}

test('removing a member revokes every new read while retaining authorship and reason',t=>{
  const {db,owner,member,admin,space}=fixture(t);
  assert.equal(collaborationActor(db,member,space.id).role,'member');
  transaction(db,()=>removeSpaceMember(db,owner,space.id,member.id,{reason:'انتهاء المشاركة في هذا المشروع'}));
  assert.throws(()=>spaceById(db,member,space.id),code('space_not_found'));
  assert.throws(()=>collaborationActor(db,member,space.id),code('space_not_found'));
  assert.throws(()=>spaceById(db,admin,space.id),code('space_not_found'));
  const retained=db.prepare('SELECT user_id,removed_by,removal_reason FROM collaboration_memberships WHERE space_id=? AND user_id=?').get(space.id,member.id);
  assert.equal(retained.user_id,'employee');assert.equal(retained.removed_by,'manager');assert.match(retained.removal_reason,/انتهاء المشاركة/);
  assert.equal(verifyAudit(db),true);
});

test('space roles control actions and membership management respects project scope',t=>{
  const {db,owner,member,outsider,space}=fixture(t);
  assert.equal(canSpace(db,member,space,'space.task'),true);
  assert.equal(canSpace(db,member,space,'space.people'),false);
  assert.throws(()=>transaction(db,()=>changeSpaceRole(db,member,space.id,owner.id,{role:'member',reason:'محاولة بلا صلاحية'})),code('space_forbidden'));
  assert.throws(()=>transaction(db,()=>addSpaceMember(db,owner,space.id,{user_id:outsider.id,role:'member',reason:'إضافة خارج نطاق المشروع'})),code('member_scope'));
  db.prepare('INSERT INTO project_members(project_id,user_id) VALUES(?,?)').run('access-project',outsider.id);
  const added=transaction(db,()=>addSpaceMember(db,owner,space.id,{user_id:outsider.id,role:'internal_guest',reason:'مشاركة داخلية محددة في المشروع'}));
  assert.equal(added.role,'internal_guest');
  assert.deepEqual(collaborationActor(db,outsider,space.id).capabilities,['space.read','space.task','space.chat','space.files']);
  const changed=transaction(db,()=>changeSpaceRole(db,owner,space.id,outsider.id,{role:'member',reason:'أصبح منفذًا دائمًا في المشروع'}));
  assert.equal(changed.role,'member');assert.equal(changed.version,2);
});

test('inactive or expired memberships are rejected at read time',t=>{
  const {db,owner,member,space}=fixture(t);
  db.prepare('UPDATE collaboration_memberships SET starts_at=?,ends_at=? WHERE space_id=? AND user_id=?').run('2019-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z',space.id,member.id);
  assert.throws(()=>collaborationActor(db,member,space.id),code('space_not_found'));
  db.prepare('UPDATE collaboration_memberships SET starts_at=?,ends_at=NULL WHERE space_id=? AND user_id=?').run(now(),space.id,member.id);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(member.id);
  assert.throws(()=>collaborationActor(db,member,space.id),code('space_not_found'));
  assert.equal(collaborationActor(db,owner,space.id).role,'owner');
});
