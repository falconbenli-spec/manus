import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createFinanceReference } from '../app/finance.mjs';
import { createTemplate,openClosePeriod,taskAction,periodAction,getClosePeriod } from '../app/close-checklist.mjs';
import { accrualsBoard,getSchedule,createSchedule,scheduleAction,entryAction,scheduleAmounts } from '../app/accruals.mjs';
import { accrualsUI } from '../app/static/cash-close-ui.mjs';

const code=value=>error=>error.code===value;
const helpers={e:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${label}</button>`,money:m=>m===null||m===undefined?'—':`${m/100} SAR`};


function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-accruals');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('accountant','36t','ops','accountant','محاسبة الإطفاء المصطنعة','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع الإطفاء المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const who of ['accountant','reviewer'])db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(),'36t',who,'finance.close.manage','تصريح مصطنع للاختبار','admin',now());
  for(const [who,actions] of [['accountant',['read','configure']],['reviewer',['read','configure','approve']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const tx=f=>transaction(db,f);
  const reference=(kind,input)=>tx(()=>createFinanceReference(db,users.accountant,kind,input));
  const expense=reference('accounts',{code:'ACC-EXP',name:'اشتراكات برمجية مصطنعة',account_type:'expense',currency:'SAR'});
  const asset=reference('accounts',{code:'ACC-PRE',name:'مصروف مدفوع مقدمًا مصطنع',account_type:'asset',currency:'SAR'});
  const liability=reference('accounts',{code:'ACC-ACR',name:'مصروف مستحق مصطنع',account_type:'liability',currency:'SAR'});
  const centre=reference('cost_centers',{code:'ACC-CC',name:'مركز إطفاء مصطنع'});
  const base={source_reference:'SUB-2026-001',description:'اشتراك برمجي سنوي مصطنع لفريق التصميم',amount:'1200.00',starts_on:'2026-01-01',ends_on:'2026-12-31',
    debit_account_id:expense.id,credit_account_id:asset.id,cost_center_id:centre.id,basis:'عقد الاشتراك المصطنع يغطي اثني عشر شهرًا وحدده المحاسب'};
  const make=(input={},who='accountant')=>tx(()=>createSchedule(db,users[who],{kind:'prepaid',invoice_id:null,...base,...input}));
  return {db,users,tx,expense,asset,liability,centre,base,make};
}

test('accruals: the accountant sets the period and the system splits it to the last halala, adding the remainder to the last month',t=>{
  const {db,users,make}=fixture(t);
  assert.deepEqual(scheduleAmounts(100000,12),Array(11).fill(8333).concat(8337),'the months are equal and the remainder lands on the last one, so the parts sum to the document');
  assert.equal(scheduleAmounts(100000,12).reduce((a,b)=>a+b,0),100000);
  const s=getSchedule(db,users.accountant,make().id);
  assert.equal(s.months,12);assert.equal(s.entries.length,12);
  assert.equal(s.entries.reduce((n,e)=>n+e.amount_minor,0),120000,'nothing is lost or invented in the split');
  assert.deepEqual(s.entries.map(e=>e.period_key).slice(0,3),['2026-01','2026-02','2026-03']);
  assert.deepEqual(s.entries.map(e=>e.entry_date).slice(0,3),['2026-01-31','2026-02-28','2026-03-31']);
  assert.ok(s.entries.every(e=>e.status==='proposed'),'a generated schedule is a proposal, never a posted fact');
  assert.equal(s.approved_minor,0);assert.equal(s.remaining_minor,120000);
});

test('accruals: the capability opens it, the accounts are the accountant’s choice, and the platform assumes none',t=>{
  const {db,users,tx,base,expense,asset,liability,make}=fixture(t);
  assert.throws(()=>accrualsBoard(db,users.manager),code('not_permitted'));
  assert.throws(()=>tx(()=>createSchedule(db,users.manager,{kind:'prepaid',invoice_id:null,...base})),code('not_permitted'));
  assert.throws(()=>createSchedule(db,users.accountant,{kind:'prepaid',invoice_id:null,...base}),code('transaction_required'));
  // مدفوع مقدمًا: مصروف مدين مقابل أصل. استحقاق: مصروف مدين مقابل التزام. لا خلط بينهما.
  assert.throws(()=>make({credit_account_id:liability.id}),code('account_type'));
  assert.throws(()=>make({kind:'accrual',credit_account_id:asset.id,source_reference:'ACR-1'}),code('account_type'));
  assert.throws(()=>make({debit_account_id:asset.id}),code('account_type'));
  assert.throws(()=>make({debit_account_id:expense.id,credit_account_id:expense.id}),code('account_type'));
  const accrual=getSchedule(db,users.accountant,make({kind:'accrual',credit_account_id:liability.id,source_reference:'ACR-2026-001',description:'كهرباء الربع الأخير تحققت ولم تصل فاتورتها'}).id);
  assert.equal(accrual.credit_account.account_type,'liability');
  assert.match(accrual.kind_rule,/لم تصل فاتورته/);
  make();
  assert.throws(()=>make(),code('duplicate_schedule'));
  assert.equal(accrualsBoard(db,users.reviewer).schedules.length,2);
  assert.throws(()=>accrualsBoard(db,users.external),code('not_permitted'));
});

test('accruals: whoever prepared the schedule never approves its monthly entry, and an entry is decided once',t=>{
  const {db,users,tx,make}=fixture(t);
  const s=getSchedule(db,users.accountant,make().id),first=s.entries[0];
  assert.deepEqual(first.actions,['cancel_entry'],'the preparer may withdraw a proposal but may not approve it');
  assert.throws(()=>tx(()=>entryAction(db,users.accountant,first.id,'approve_entry',{version:first.version,note:'أعتمد ما أعددته'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE amortization_entries SET status='approved',approved_by='accountant',approved_at=?,approval_note='التفاف على الفصل',version=version+1 WHERE id=?").run(now(),first.id),/does not approve/);
  const reviewerView=getSchedule(db,users.reviewer,s.id);
  assert.ok(reviewerView.entries[0].actions.includes('approve_entry'));
  assert.throws(()=>tx(()=>entryAction(db,users.reviewer,first.id,'approve_entry',{version:first.version+4,note:'نسخة قديمة'})),code('stale_version'));
  const after=tx(()=>entryAction(db,users.reviewer,first.id,'approve_entry',{version:first.version,note:'راجعت العقد والفترة والمبلغ'}));
  assert.equal(after.entries[0].status,'approved');assert.equal(after.approved_minor,10000);assert.equal(after.remaining_minor,110000);
  assert.equal(after.entries[0].posting_status,'not_posted');
  assert.match(after.entries[0].posting_note,/لا ترحيل آلي/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM finance_journals").get().n,0,'approving a monthly entry posts nothing to the ledger by itself');
  // المعتمد لا يُعدَّل ولا يُعاد اعتماده.
  assert.throws(()=>tx(()=>entryAction(db,users.reviewer,first.id,'approve_entry',{version:after.entries[0].version,note:'اعتماد مكرر'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE amortization_entries SET amount_minor=99999,version=version+1 WHERE id=?").run(first.id),/never change/);
  assert.throws(()=>db.prepare('DELETE FROM amortization_entries WHERE id=?').run(first.id),/retained/);
  assert.ok(verifyAudit(db));
});

test('accruals: an entry is not approved before its month ends, nor inside a close that is already approved',t=>{
  const {db,users,tx,make}=fixture(t);
  const s=getSchedule(db,users.accountant,make({starts_on:'2026-01-01',ends_on:'2027-12-31',amount:'1200.00',source_reference:'SUB-LONG'}).id);
  const future=s.entries.at(-1);
  assert.deepEqual(future.actions,['cancel_entry'],'a month that has not ended yet carries no approvable entry');
  assert.throws(()=>tx(()=>entryAction(db,users.reviewer,future.id,'approve_entry',{version:future.version,note:'اعتماد قسط شهر لم ينته'})),code('invalid_state'));
  // إقفال معتمد لشهر يمنع اعتماد قسط بتاريخ داخله.
  transaction(db,()=>createTemplate(db,users.accountant,{title:'مراجعة جداول الإطفاء المصطنعة',owner_id:'accountant',due_day:5,basis:'قرار مالك إجراء الإقفال المصطنع'}));
  const period=transaction(db,()=>openClosePeriod(db,users.accountant,{period_key:'2026-01',finance_period_id:null}));
  const opened=getClosePeriod(db,users.accountant,period.id);
  transaction(db,()=>taskAction(db,users.accountant,opened.tasks[0].id,'complete_task',{version:opened.tasks[0].version,evidence:'راجعت جداول الإطفاء وحفظت الدليل'}));
  transaction(db,()=>periodAction(db,users.reviewer,period.id,'approve_close',{version:getClosePeriod(db,users.reviewer,period.id).version,note:'راجعت كل مهمة ودليلها قبل الاعتماد'}));
  const january=getSchedule(db,users.accountant,s.id).entries[0];
  assert.equal(january.period_key,'2026-01');
  assert.throws(()=>tx(()=>entryAction(db,users.reviewer,january.id,'approve_entry',{version:january.version,note:'اعتماد داخل شهر مقفل'})),code('period_closed'));
  assert.ok(verifyAudit(db));
});

test('accruals: a wrong schedule is cancelled with a reason, never rewritten, and approved months survive it',t=>{
  const {db,users,tx,make}=fixture(t);
  const s=getSchedule(db,users.accountant,make().id);
  tx(()=>entryAction(db,users.reviewer,s.entries[0].id,'approve_entry',{version:s.entries[0].version,note:'راجعت العقد والفترة والمبلغ'}));
  assert.throws(()=>tx(()=>scheduleAction(db,users.reviewer,s.id,'cancel_schedule',{version:s.version,reason:'إلغاء من غير معدّ الجدول'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE amortization_schedules SET total_minor=1,version=version+1 WHERE id=?").run(s.id),/keeps its numbers/);
  const cancelled=tx(()=>scheduleAction(db,users.accountant,s.id,'cancel_schedule',{version:s.version,reason:'الفترة الصحيحة تسعة أشهر لا اثنا عشر؛ سيُعد جدول بديل'}));
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelled.entries[0].status,'approved','a month already approved is not erased by cancelling the schedule');
  assert.ok(cancelled.entries.slice(1).every(e=>e.status==='cancelled'));
  assert.throws(()=>tx(()=>scheduleAction(db,users.accountant,s.id,'cancel_schedule',{version:cancelled.version,reason:'إلغاء مكرر للاختبار المحلي'})),code('invalid_state'));
  // التصحيح بجدول جديد يحل محل القديم مع بقاء القديم.
  const replacement=getSchedule(db,users.accountant,make({source_reference:'SUB-2026-001-B',starts_on:'2026-04-01',ends_on:'2026-12-31'}).id);
  assert.equal(replacement.months,9);
  assert.equal(accrualsBoard(db,users.accountant).schedules.length,2);
  assert.equal(accrualsBoard(db,users.accountant).totals.unamortized_minor,replacement.remaining_minor,'a cancelled schedule no longer counts as something left to amortise');
  assert.ok(verifyAudit(db));
});

test('accruals screen: it renders from real board data under the strict content policy',t=>{
  const {db,users,make}=fixture(t);
  make();
  const data=accrualsBoard(db,users.accountant);
  const html=accrualsUI.render(data,{e:helpers.e,button:helpers.button,money:helpers.money});
  assert.ok(!/style=|<script/.test(html));
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.ok(html.includes('لا ترحيل آلي'),'the screen states that nothing posts by itself');
  assert.ok(accrualsUI.form('create_schedule','',data).fields.some(f=>f.name==='credit_account_id'));
});
