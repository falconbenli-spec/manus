// المنح بيدين على access_grants (الترحيل 144): التصريح يمنحه غيرُ صاحبه.
// طبقتان تُختبران هنا لأن كلًّا منهما تسدّ ثغرة الأخرى: القيد في القاعدة هو الضمان الذي لا يُلتف عليه
// ولو كُتب الصف من خارج الوحدة، والرفض المكتوب في grantAccess هو ما يقرؤه الإنسان فيعرف ماذا يفعل.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as access from '../app/access.mjs';
import * as admin from '../app/admin.mjs';

const password='synthetic-two-person-only';
const code=c=>error=>error.code===c;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const grantsFor=(db,id)=>db.prepare('SELECT COUNT(*) AS n FROM access_grants WHERE user_id=?').get(id).n;
function setup(t){const db=openDb(':memory:');seed(db,password);installServiceCatalog(db);t.after(()=>db.close());return db;}

// يدٌ ثانية: أدمن أول آخر، فالتصريح الذي مُنع صاحبه من منحه لنفسه يبقى قابلًا للمنح من غيره.
function secondFirstAdmin(db,first){
  transaction(db,()=>admin.createAccount(db,first,{username:'second.admin',name:'مسؤول منصة ثانٍ مصطنع',role:'employee',department_id:'ops',manager_id:null,temporary_password:'Welcome-2026'}));
  db.prepare("UPDATE users SET role='admin',must_change_password=0 WHERE id='second.admin'").run();
  transaction(db,()=>access.setAdminLevel(db,first,'second.admin',{admin_level:'super',reason:'يد ثانية لمنح التصاريح'}));
  return user(db,'second.admin');
}

test('ACCESS 144: the first admin cannot grant himself an ordinary capability, and nothing is written',t=>{
  const db=setup(t),first=user(db,'admin');
  const before=grantsFor(db,'admin');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,{user_id:'admin',capability:'vendors.manage',note:'أمنح نفسي'})),
    code('separation_of_duties'),'الأدمن الأول لا يمنح نفسه تصريحًا عاديًا');
  assert.equal(grantsFor(db,'admin'),before,'الرفض قبل الكتابة: لا صفّ جديد في access_grants');
});

test('ACCESS 144: nor a sensitive one — and the refusal names the rule, who owns it and the next step',t=>{
  const db=setup(t),first=user(db,'admin');
  const before=grantsFor(db,'admin');
  let error=null;
  try{transaction(db,()=>access.grantAccess(db,first,{user_id:'admin',capability:'payroll.approve',note:'أمنح نفسي اعتماد المسير'}));}catch(thrown){error=thrown;}
  assert.ok(error,'التصريح الحساس أولى بالمنع، فالمنح لا يمرّ');
  assert.equal(error.code,'separation_of_duties');
  assert.equal(grantsFor(db,'admin'),before,'لا صفّ جديد');
  assert.equal(error.status,409);
  const refusal=error.details.refusal;
  assert.ok(refusal.what.includes('نفسك'),'الرفض يقول ما الذي رُفض: منحُ النفس');
  assert.ok(refusal.what.includes('اعتماد مسير الرواتب'),'ويسمّي التصريح المطلوب بعينه');
  assert.equal(refusal.missing.length,1);
  assert.ok(refusal.missing[0].owner.includes('أدمن أول'),'ويسمّي من يملك المنح');
  assert.equal(refusal.missing[0].owner_role,'admin');
  assert.ok(refusal.missing[0].why.includes('غير صاحبه'),'ويقول لماذا: التصريح يمنحه غير صاحبه');
  assert.ok(refusal.next.length>10,'وخطوة تالية يفعلها القارئ');
  assert.ok(error.message.includes('نفسك')&&error.message.includes('أدمن أول'),'والنص المقروء يحمل القاعدة نفسها');
  // والتصريح الحساس يبقى مغلقًا عليه: امتياز الأدمن الأول وحده لا يفتحه، وهو سبب القاعدة أصلًا.
  assert.equal(access.can(db,user(db,'admin'),'payroll.approve'),false);
});

test('ACCESS 144: a second first admin grants him that very capability, and it takes effect',t=>{
  const db=setup(t),first=user(db,'admin');
  const second=secondFirstAdmin(db,first);
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,{user_id:'admin',capability:'payroll.approve'})),code('separation_of_duties'),'بيده هو: مرفوض');
  const grant=transaction(db,()=>access.grantAccess(db,second,{user_id:'admin',capability:'payroll.approve',note:'قرار اليد الثانية مكتوب'}));
  assert.ok(grant.id,'وبيد غيره: يمرّ');
  const row=db.prepare('SELECT user_id,granted_by FROM access_grants WHERE id=?').get(grant.id);
  assert.equal(row.user_id,'admin');
  assert.equal(row.granted_by,'second.admin','المانح غير الممنوح في الصف نفسه');
  assert.equal(access.can(db,user(db,'admin'),'payroll.approve'),true,'التصريح الحساس انفتح بالمنح المسجَّل');
  // والمنع ليس منعًا للمنح كله: الأدمن الأول يمنح غيرَه كما كان.
  const toOther=transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'commercial.use',department_id:'creative'}));
  assert.ok(toOther.id);
  assert.equal(access.can(db,user(db,'employee'),'commercial.use','creative'),true);
});

test('ACCESS 144: the database itself refuses a self-grant written around the module',t=>{
  const db=setup(t);
  const insert=(id,who,by)=>db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,'36t',who,'payroll.approve','صفّ مصطنع مكتوب بلا مرور بالوحدة',by,'2026-09-24T00:00:00.000Z');
  assert.throws(()=>insert('self-written','admin','admin'),/CHECK constraint failed: user_id<>granted_by/,'القاعدة ترفض الصف ولو التُفّ على grantAccess');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE id='self-written'").get().n,0,'ولا شيء يُكتب');
  // والقيد قاعدةُ اليدين لا منعًا شاملًا: الصف نفسه بيد أخرى يُقبل.
  insert('written-by-other','admin','hr');
  assert.equal(db.prepare("SELECT granted_by FROM access_grants WHERE id='written-by-other'").get().granted_by,'hr');
  // والقيد مكتوب في تعريف الجدول نفسه، بالحرف الذي في finance_grants منذ الترحيل 007.
  const ddl=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='access_grants'").get().sql;
  assert.match(ddl,/CHECK\(user_id<>granted_by\)/);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_grants'").get().sql,/CHECK\(user_id<>granted_by\)/);
  // والفهرسان عبرا الترحيل كما هما.
  const indexes=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='access_grants' AND sql IS NOT NULL ORDER BY name").all().map(r=>r.name);
  assert.deepEqual(indexes,['access_grants_live','access_grants_user']);
  // والجدولان الابنان ما زالا يحيلان إلى access_grants بالاسم، لا إلى نسخة مُعاد تسميتها.
  for(const child of ['access_review_items','access_revocation_requests'])
    assert.match(db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('table',child).sql,/grant_id TEXT REFERENCES access_grants\(id\)/,child);
});

test('ACCESS 144: revoking is untouched — including a grant the first admin revokes off himself',t=>{
  const db=setup(t),first=user(db,'admin');
  const second=secondFirstAdmin(db,first);
  const mine=transaction(db,()=>access.grantAccess(db,second,{user_id:'admin',capability:'payroll.approve',note:'منحته اليد الثانية'}));
  transaction(db,()=>access.revokeAccess(db,first,mine.id,{reason:'انتهت الحاجة إلى اعتماد المسير'}));
  const row=db.prepare('SELECT revoked_at,revoked_by FROM access_grants WHERE id=?').get(mine.id);
  assert.ok(row.revoked_at,'السحب يُسجَّل');
  assert.equal(row.revoked_by,'admin','وصاحب التصريح يسحبه عن نفسه: قاعدة اليدين على المنح وحده، لا على السحب');
  assert.equal(access.can(db,user(db,'admin'),'payroll.approve'),false,'والتصريح أُغلق فعلًا');
  // والسحب المعتاد لتصريح ممنوح لغيره كما كان.
  const other=transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'commercial.use',department_id:'creative'}));
  transaction(db,()=>access.revokeAccess(db,first,other.id,{reason:'انتهت مشاركته في المشاريع'}));
  assert.ok(db.prepare('SELECT revoked_at FROM access_grants WHERE id=?').get(other.id).revoked_at);
  assert.equal(access.can(db,user(db,'employee'),'commercial.use','creative'),false);
});
