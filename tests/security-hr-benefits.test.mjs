import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { recordMedicalPolicy, recordEnrolment, enrolmentAction, addDependant, removeDependant, benefitsBoard } from '../app/benefits.mjs';

// إثبات إغلاق ثغرة اعتماد مسؤول المزايا تسجيله هو (مراجعة الأمن 2026-09-18، الترحيل 091 القسم ج). كل البيانات مصطنعة.
const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-benefits');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.benefits.manage',department_id:null,note:'مسؤول مزايا ثان تجريبي'}));
  const policy=tx(()=>recordMedicalPolicy(db,users.hr,{insurer_name:'شركة تأمين تجريبية',policy_number:'P-1',effective_from:day(-100),effective_to:day(200),tiers:['أ','VIP'],renewal_notice_days:30,note:''})).id;
  const enrolment=tx(()=>recordEnrolment(db,users.manager,{policy_id:policy,employee_id:'hr',tier:'VIP',requested_on:day(-1)})).id;
  return {db,users,tx,enrolment};
}

test('benefits SoD: the insured benefits officer neither confirms, removes, adds to nor removes from their own enrolment — another officer does',t=>{
  const {db,users,tx,enrolment}=fixture(t);
  assert.throws(()=>tx(()=>enrolmentAction(db,users.hr,enrolment,'confirm_enrolment',{version:1,confirmed_on:today(),member_reference:'M-1'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>enrolmentAction(db,users.hr,enrolment,'remove_enrolment',{version:1,removed_on:today(),reason:'حذف ذاتي'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>addDependant(db,users.hr,{enrolment_id:enrolment,relation:'other',birth_date:'1990-01-01',added_on:today()})),code('separation_of_duties'));
  assert.deepEqual(benefitsBoard(db,users.hr).enrolments.find(e=>e.id===enrolment).actions,[],'no action is offered on your own enrolment');
  tx(()=>enrolmentAction(db,users.manager,enrolment,'confirm_enrolment',{version:1,confirmed_on:today(),member_reference:'M-1'}));
  assert.equal(db.prepare('SELECT decided_by FROM medical_enrolments WHERE id=?').get(enrolment).decided_by,'manager');
  const dependant=tx(()=>addDependant(db,users.manager,{enrolment_id:enrolment,relation:'other',birth_date:'1990-01-01',added_on:today()})).id;
  assert.throws(()=>tx(()=>removeDependant(db,users.hr,dependant,{version:1,removed_on:today()})),code('separation_of_duties'));
  tx(()=>removeDependant(db,users.manager,dependant,{version:1,removed_on:today()}));
  assert.ok(verifyAudit(db));
});

test('benefits SoD in SQL: a trigger refuses the insured employee as the decider of their enrolment or the adder of their dependant',t=>{
  const {db,enrolment}=fixture(t);
  assert.throws(()=>db.prepare("UPDATE medical_enrolments SET status='active',confirmed_on=?,decided_by='hr',version=version+1 WHERE id=?").run(today(),enrolment),/other than the insured employee/);
  assert.throws(()=>db.prepare("UPDATE medical_enrolments SET status='active',confirmed_on=?,version=version+1 WHERE id=?").run(today(),enrolment),/other than the insured employee/,'a decision with no decider is refused');
  assert.throws(()=>db.prepare("INSERT INTO medical_dependants(id,tenant_id,enrolment_id,relation,birth_date,added_on,recorded_by,created_at) VALUES('d1','36t',?,'other','1990-01-01',?,'hr',?)").run(enrolment,today(),today()),/other than the insured employee/);
});
