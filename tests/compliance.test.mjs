import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { complianceBoard, createObligation, obligationAction, currentPeriod } from '../app/compliance.mjs';
import { inbox } from '../app/inbox.mjs';

const code=value=>error=>error.code===value;
test('periods: monthly, quarterly and yearly obligations resolve to the period that is due next',()=>{
  assert.deepEqual(currentPeriod({cadence:'monthly',due_day:10,due_month:null},'2026-09-17'),{period:'2026-09',due_date:'2026-09-10'});
  assert.deepEqual(currentPeriod({cadence:'yearly',due_day:30,due_month:4},'2026-09-17'),{period:'2026',due_date:'2026-04-30'});
  assert.deepEqual(currentPeriod({cadence:'quarterly',due_day:28,due_month:1},'2026-09-17'),{period:'2026-Q4',due_date:'2026-10-28'});
  assert.deepEqual(currentPeriod({cadence:'quarterly',due_day:28,due_month:1},'2026-11-05'),{period:'2027-Q1',due_date:'2027-01-28'});
});

test('compliance calendar: the owner is reminded and records evidence, someone else verifies it, and the platform assumes no statutory date',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-compliance');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'compliance.manage',note:'تصريح التزامات مصطنع'}));
  const input={title:'رفع ملف حماية الأجور',authority:'جهة مصطنعة',cadence:'monthly',due_day:Math.min(28,Math.max(1,new Date(Date.now()+3*3600000).getUTCDate())),due_month:null,owner_id:'hr',basis:'موعد مصطنع أكده مختص مصطنع بتاريخ اليوم'};
  assert.throws(()=>tx(()=>createObligation(db,users.hr,input)),code('not_permitted'));
  assert.throws(()=>tx(()=>createObligation(db,users.manager,{...input,basis:'قصير'})),code('invalid_text'),'a due date without its source is refused');
  const id=tx(()=>createObligation(db,users.manager,input)).id;
  assert.throws(()=>tx(()=>createObligation(db,users.manager,input)),code('duplicate_obligation'));
  assert.equal(complianceBoard(db,users.employee).obligations.length,0,'others see nothing');
  const mine=complianceBoard(db,users.hr).obligations[0];
  assert.ok(['due_soon','overdue'].includes(mine.state));assert.deepEqual(mine.actions,['complete_obligation']);
  assert.ok(inbox(db,users.hr).groups.some(g=>g.key==='compliance'),'the owner is reminded in the unified inbox');
  assert.throws(()=>tx(()=>obligationAction(db,users.manager,id,'complete_obligation',{evidence_reference:'المدير ليس المالك'})),code('invalid_state'));
  tx(()=>obligationAction(db,users.hr,id,'complete_obligation',{evidence_reference:'إيصال مصطنع رقم 55 محفوظ في ملف الرواتب'}));
  assert.throws(()=>tx(()=>obligationAction(db,users.hr,id,'complete_obligation',{evidence_reference:'تنفيذ ثانٍ للفترة نفسها'})),code('invalid_state'));
  assert.throws(()=>tx(()=>obligationAction(db,users.hr,id,'verify_obligation',{note:'أتحقق من تنفيذي بنفسي'})),code('invalid_state'));
  assert.ok(inbox(db,users.manager).groups.some(g=>g.key==='compliance'));
  tx(()=>obligationAction(db,users.manager,id,'verify_obligation',{note:'اطلعت على الإيصال المصطنع'}));
  assert.equal(complianceBoard(db,users.hr).obligations[0].state,'verified');
  assert.equal(inbox(db,users.hr).groups.some(g=>g.key==='compliance'),false);
  assert.throws(()=>db.prepare("UPDATE compliance_completions SET evidence_reference='تعديل صامت'").run(),/never rewritten/);
  assert.match(complianceBoard(db,users.manager).note,/لا تفترض موعدًا نظاميًا/);
  assert.ok(verifyAudit(db));
});
