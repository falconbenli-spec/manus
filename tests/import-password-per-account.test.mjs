import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { importAccounts } from '../app/admin.mjs';
import { dispatch } from './definitions-fixture.mjs';

/* استيلاء على حساب زميل عبر كلمة المرور المؤقتة المشتركة — العيب الذي أوجب هذا الملف:
 *
 * كان `importAccounts` يجزّئ كلمة المرور المؤقتة **مرة واحدة** ويكتب البصمة نفسها على كل صف:
 *     const digest=passwordHash(passwordPolicy(input.temporary_password));
 *     const ids=rows.map(r=>insertAccount(db,u,r,digest));
 * فكل الحسابات المستوردة — حتى ألف حساب — تشترك في كلمة مرور واحدة. وحقل الشاشة يقولها صراحةً:
 * «كلمة مرور مؤقتة لكل الحسابات المستوردة».
 *
 * والأثر ليس نظريًا: أي موظف مستورَد **يعرف هذه الكلمة، لأنها كلمته هو**. فيكتب اسم مستخدم زميل لم
 * يغيّر كلمته بعد فتُفتح له جلسة صحيحة؛ و`app/server.mjs` يسمح بـ`/api/account/password` رغم
 * `must_change_password` (وهو لازم، وإلا تعذّر التغيير أصلًا)، فيضع كلمة لا يعرفها إلا هو. ثم يُطرد
 * صاحب الحساب من حسابه، ويُسجَّل كل فعل تالٍ في سجل التدقيق **باسم الضحية**. ولا حاجز ثانٍ: التحقق
 * بخطوتين غير مفعَّل لأي حساب في قاعدة التشغيل (قياس 29 سبتمبر 2026).
 *
 * وأسماء المستخدمين ليست سرًّا: هي العمود الأول في ملف الاستيراد نفسه، وتظهر في الهيكل التنظيمي.
 *
 * الثابت المحروس: كل حساب مستورَد له سرٌّ يخصّه وحده.
 */

const PASSWORD='synthetic-import-takeover';
const CSV='username,name,department_id,role,manager_username\n'
  +'t.first,الموظف التجريبي الأول,creative,employee,\n'
  +'t.second,الموظف التجريبي الثاني,creative,employee,';

function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
  const result=transaction(db,()=>importAccounts(db,admin,{csv:CSV,temporary_password:'Import-Temp-2026'}));
  return {db,app:createApp(db),result};
}
const login=(app,username,password)=>dispatch(app,{method:'POST',path:'/api/login',body:{username,password}});

test('الاستيراد يعطي كل حساب سرًّا يخصّه: لا يفتح سرُّ حسابٍ حسابَ زميله',async t=>{
  const {app,result}=fixture(t);
  assert.equal(result.created,2);
  const creds=result.credentials;
  assert.ok(Array.isArray(creds)&&creds.length===2,
    'الاستيراد يعيد كلمة مؤقتة لكل حساب على حدة، وإلا فلا سبيل لتسليمها لأصحابها.');
  const [a,b]=creds;
  assert.notEqual(a.temporary_password,b.temporary_password,
    'كلمتان متطابقتان تعنيان أن كل مستورَد يملك مفتاح حساب كل زميل مستورَد معه.');

  // كلٌّ يدخل بسرّه.
  assert.equal((await login(app,a.username,a.temporary_password)).status,200);
  assert.equal((await login(app,b.username,b.temporary_password)).status,200);

  // ولا يدخل بسرّ زميله — وهذا هو الثابت.
  assert.equal((await login(app,b.username,a.temporary_password)).status,401,
    'سرّ الحساب الأول فتح الحساب الثاني: هذا استيلاء كامل على حساب زميل بلا أي تصريح.');
  assert.equal((await login(app,a.username,b.temporary_password)).status,401);

  // والكلمة التي كتبها الأدمن في الحقل القديم لا تفتح شيئًا: لم تعد سرًّا مشتركًا.
  assert.equal((await login(app,a.username,'Import-Temp-2026')).status,401);
  assert.equal((await login(app,b.username,'Import-Temp-2026')).status,401);
});

test('وكل حساب مستورَد يبقى ملزَمًا بتغيير كلمته عند أول دخول',t=>{
  const {db}=fixture(t);
  const rows=db.prepare("SELECT username,must_change_password FROM users WHERE username LIKE 't.%' ORDER BY username").all();
  assert.deepEqual(rows.map(r=>r.must_change_password),[1,1],
    'الكلمة المؤقتة مؤقتة فعلًا: تُستبدل عند أول دخول، ولا تبقى كلمةَ الحساب.');
});
