import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { wageReconciliation, recordWageRegistration, recordWageDifferenceNote } from '../app/wage-reconciliation.mjs';
import { fixture } from './wage-fixture.mjs';

const code=value=>error=>error.code===value;
const registration=(userId,amount)=>({user_id:userId,amount,registered_on:'2026-02-10',source_note:'قرأته من كشف الأجور في حساب المنشأة التجريبي'});
const row=(board,userId)=>board.rows.find(r=>r.user_id===userId);

test('the three wages are compared side by side, the gap is shown with its size and ordered by the largest, and recording the authority number changes nothing else',t=>{
  const {db,users,tx,contract,approveRun}=fixture(t);
  contract('employee');contract('outsider',[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1000.00'}]);contract('new-hire',[{component:'basic',amount:'5000.00'}]);
  approveRun('2026-02');
  assert.throws(()=>wageReconciliation(db,users.employee),code('not_permitted'));
  assert.throws(()=>tx(()=>recordWageRegistration(db,users.reviewer,registration('employee','8000.00'))),code('not_permitted'),'the authority number is entered by whoever prepares payroll');
  assert.throws(()=>tx(()=>recordWageRegistration(db,users.hr,registration('hr','8000.00'))),code('separation_of_duties'));
  assert.throws(()=>tx(()=>recordWageRegistration(db,users.hr,registration('external','8000.00'))),code('not_found'),'another tenant is out of reach');
  tx(()=>recordWageRegistration(db,users.hr,registration('employee','8000.00')));
  tx(()=>recordWageRegistration(db,users.hr,registration('outsider','7000.00')));
  const board=wageReconciliation(db,users.hr);
  assert.equal(board.month,'2026-02');assert.deepEqual(board.months,['2026-02']);
  const employee=row(board,'employee');
  assert.deepEqual([employee.contract_wage_minor,employee.registered_wage_minor,employee.payroll_wage_minor],[1000000,800000,1000000]);
  assert.deepEqual(employee.differences,{contract_vs_registered:200000,registered_vs_payroll:-200000,contract_vs_payroll:0});
  assert.equal(employee.state,'different');assert.equal(employee.largest_difference_minor,200000);
  assert.equal(employee.registration.registered_on,'2026-02-10','the date the wage was registered with the authority, not the date it was typed');
  assert.equal(board.rows[0].user_id,'employee','the biggest gap comes first');
  assert.equal(row(board,'outsider').state,'matched');
  assert.equal(row(board,'new-hire').state,'missing_registration');
  assert.deepEqual(board.totals,{people:3,matched:1,different:1,missing_registration:1});
  // لا تصحيح آلي: العقد والمسير كما هما بعد إدخال رقم الجهة.
  assert.equal(db.prepare("SELECT monthly_total_minor FROM employment_contracts WHERE user_id='employee' AND status='active'").get().monthly_total_minor,1000000);
  assert.equal(row(wageReconciliation(db,users.hr),'employee').payroll_wage_minor,1000000);
  // التصحيح إدخال جديد يحل محل السابق، والسابق باقٍ.
  const previous=db.prepare("SELECT id FROM wage_registrations WHERE user_id='employee'").get().id;
  tx(()=>recordWageRegistration(db,users.hr,{...registration('employee','9500.00'),registered_on:'2026-03-02'}));
  assert.equal(row(wageReconciliation(db,users.hr),'employee').registered_wage_minor,950000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wage_registrations').get().n,3,'the superseded entry is kept');
  assert.throws(()=>db.prepare('UPDATE wage_registrations SET registered_wage_minor=1 WHERE id=?').run(previous),/superseded, not edited/);
  db.prepare("INSERT INTO wage_registrations(id,tenant_id,user_id,registered_wage_minor,registered_on,source_note,recorded_by,recorded_at) VALUES('iso','isolated','external',123456,'2026-01-01','إدخال تجريبي في كيان معزول','admin','t')").run();
  assert.equal(wageReconciliation(db,users.hr).registration_history.some(h=>h.id==='iso'),false);
  assert.ok(verifyAudit(db));
});

test('a gap is never closed by the platform: it waits for a written human decision, and that decision is kept with the numbers that were true when it was written',t=>{
  const {db,users,tx,contract,approveRun}=fixture(t);
  contract('employee');contract('outsider',[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1000.00'}]);contract('reviewer',[{component:'basic',amount:'4000.00'}]);
  approveRun('2026-02');
  for(const [userId,amount] of [['employee','8000.00'],['outsider','7000.00'],['reviewer','3000.00']])tx(()=>recordWageRegistration(db,users.hr,registration(userId,amount)));
  const decision={user_id:'employee',month:'2026-02',resolution:'registration_update_requested',note:'طلبت تعديل الأجر المسجّل لدى الجهة ليطابق العقد، والمرجع محفوظ في ملف الموظفة'};
  assert.throws(()=>tx(()=>recordWageDifferenceNote(db,users.hr,decision)),code('not_permitted'),'the decision belongs to whoever reviews or approves the run');
  assert.throws(()=>tx(()=>recordWageDifferenceNote(db,users.reviewer,{...decision,user_id:'outsider'})),code('no_difference'));
  assert.throws(()=>tx(()=>recordWageDifferenceNote(db,users.reviewer,{...decision,user_id:'reviewer'})),code('separation_of_duties'),'nobody rules on the gap in their own wage');
  assert.throws(()=>tx(()=>recordWageDifferenceNote(db,users.reviewer,{...decision,resolution:'auto_fix'})),code('resolution'));
  tx(()=>recordWageDifferenceNote(db,users.reviewer,decision));
  const stored=db.prepare("SELECT * FROM wage_difference_notes WHERE user_id='employee'").get();
  assert.deepEqual([stored.contract_wage_minor,stored.registered_wage_minor,stored.payroll_wage_minor],[1000000,800000,1000000]);
  assert.throws(()=>db.prepare("UPDATE wage_difference_notes SET note='تعديل صامت' WHERE id=?").run(stored.id),/immutable/);
  const after=wageReconciliation(db,users.hr,'2026-02'),employee=after.rows.find(r=>r.user_id==='employee');
  assert.equal(employee.state,'different','a written decision explains the gap, it does not erase it');
  assert.equal(employee.notes.length,1);
  assert.equal(employee.notes[0].resolution_name,'طُلب تعديل التسجيل لدى الجهة');
  assert.equal(after.notes[0].recorded_by_name,users.reviewer.name);
  assert.ok(verifyAudit(db));
});
