import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { addDocument } from '../app/employees.mjs';
import { expiringSoon, maskReference } from '../app/expiry.mjs';
import { homeBoard } from '../app/home.mjs';

// إثبات إغلاق كشف أرقام الوثائق كاملة في التنبيهات والصفحة الرئيسية (مراجعة الأمن 2026-09-18). كل البيانات مصطنعة.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const shift=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

test('document numbers: expiry alerts and the HR home show the last four digits only, to the officer and to the holder alike',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-security-documents');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  // شاشة الإدخال ترفض الرقم الكامل، لكن صفوفًا أقدم أو مستوردة قد تحمله: العرض يقنّعه أيًّا كان مصدره.
  assert.throws(()=>transaction(db,()=>addDocument(db,users.hr,'employee',{doc_type:'iqama',reference:'2456789012',expires_on:shift(-3)})),error=>error.code==='reference_number');
  const insert=db.prepare("INSERT INTO employee_documents(id,tenant_id,user_id,doc_type,reference,issued_on,expires_on,note,created_by,created_at) VALUES(?,'36t','employee',?,?,'2020-01-01',?,'','hr',?)");
  insert.run('doc-1','iqama','2456789012',shift(-3),today());
  insert.run('doc-2','passport','P12345678',shift(10),today());
  for(const u of [users.hr,users.employee]){
    const items=expiringSoon(db,u).filter(i=>i.doc_kind.startsWith('employee.'));
    assert.deepEqual(items.map(i=>i.reference).sort(),['••••5678','••••9012']);
    assert.ok(!JSON.stringify(items).includes('2456789012')&&!JSON.stringify(items).includes('12345678'));
  }
  const home=JSON.stringify(homeBoard(db,users.hr));
  assert.ok(!home.includes('2456789012'),'the HR home never carries the full number');
  assert.ok(home.includes('••••9012'));
  assert.equal(maskReference('••••9012'),'••••9012','masking is idempotent');
  assert.equal(maskReference('بلا أرقام'),'••••');
});
