import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, verifyAudit } from '../app/db.mjs';
import { login, logout, authenticate } from '../app/auth.mjs';
import { seed } from '../scripts/seed.mjs';

// محاولات الدخول الفاشلة كانت تُعدّ في login_attempts وحده، وصفوفه تُحذف بعد ربع ساعة (نافذة 900000 مللي في auth.mjs).
// فلا يبقى في المنصة أثر دائم لمن حاول الدخول على حساب من ومتى. سجل التدقيق هو الأثر الدائم، وهو المقصود هنا.
const PASSWORD='synthetic-login-audit';
const events=(db,action)=>db.prepare("SELECT * FROM audit_events WHERE action=? ORDER BY seq").all(action);
const fixture=t=>{const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());return db;};

test('محاولة دخول فاشلة على حساب قائم تُكتب في سجل التدقيق بعنوانها وعدد محاولاتها، والسلسلة تبقى صحيحة',t=>{
  const db=fixture(t);
  assert.throws(()=>login(db,'admin','كلمة خاطئة','198.51.100.7'),e=>e.code==='invalid_credentials');
  const rows=events(db,'login.failed');
  assert.equal(rows.length,1);
  const after=JSON.parse(rows[0].after_json);
  assert.equal(after.address,'198.51.100.7');
  assert.equal(after.failures,1);
  assert.equal(rows[0].actor_id,'admin');
  assert.equal(rows[0].entity_type,'session');
  // الفاعل المكتوب هو الحساب المستهدف لا من حاول؛ الصفّ يقول ذلك بنفسه فلا يُقرأ خطأً.
  assert.match(rows[0].reason,/الحساب المستهدف لا من حاول/);
  assert.equal(verifyAudit(db),true);
});

test('اسم مستخدم غير موجود لا يترك حدثًا: لا كيان يُنسب إليه، وتسجيله يفتح بابًا لتعداد الأسماء',t=>{
  const db=fixture(t);
  assert.throws(()=>login(db,'لا-أحد-بهذا-الاسم','أي كلمة','198.51.100.8'),e=>e.code==='invalid_credentials');
  assert.equal(events(db,'login.failed').length,0);
  assert.equal(verifyAudit(db),true);
});

test('المحاولات المتتالية تُسجَّل كلها ويتصاعد العدد المكتوب فيها، والدخول الناجح يبقى حدثه كما هو',t=>{
  const db=fixture(t);
  for(let i=0;i<3;i++) assert.throws(()=>login(db,'admin','كلمة خاطئة','198.51.100.9'));
  assert.deepEqual(events(db,'login.failed').map(r=>JSON.parse(r.after_json).failures),[1,2,3]);
  login(db,'admin',PASSWORD,'198.51.100.9');
  assert.equal(events(db,'login').length,1);
  assert.equal(events(db,'login.failed').length,3);
  assert.equal(verifyAudit(db),true);
});

test('الخروج يُكتب في سجل التدقيق بعنوانه وتُحذف الجلسة، فيُعرف متى أُغلقت الجلسة لا متى فُتحت وحدها',t=>{
  const db=fixture(t);
  const {token}=login(db,'admin',PASSWORD,'198.51.100.21');
  assert.equal(events(db,'login').length,1);
  assert.equal(events(db,'logout').length,0,'لا يُكتب خروج قبل أن يقع');

  const {user,session}=authenticate(db,`session=${token}`);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get('admin').n,1);
  assert.deepEqual(logout(db,user,session,'198.51.100.21'),{logged_out:true});

  const rows=events(db,'logout');
  assert.equal(rows.length,1);
  assert.equal(rows[0].actor_id,'admin');
  assert.equal(rows[0].entity_type,'session');
  assert.equal(JSON.parse(rows[0].after_json).address,'198.51.100.21');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get('admin').n,0,'الجلسة تُحذف مع تسجيل الخروج');
  // الرمز نفسه لم يعد يفتح شيئًا بعد الخروج.
  assert.throws(()=>authenticate(db,`session=${token}`),e=>e.code==='session_expired');
  assert.equal(verifyAudit(db),true);
});
