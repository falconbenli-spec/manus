import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createFinanceReference,createJournal } from '../app/finance.mjs';
import { getClosePeriod,createTemplate,openClosePeriod,taskAction,periodAction } from '../app/close-checklist.mjs';

// لماذا هذا الملف موجود: اختبار الإقفال القائم (tests/close-checklist.test.mjs) يبني لكل شهر فترةً محاسبية
// مطابقة له بالضبط، فلا يمر أبدًا على الحالة التي تعيشها قاعدة التشغيل — فترة محاسبية واحدة تغطي السنة كلها.
// وعليها كان اعتماد إقفال شهر واحد يقفل السنة بأكملها، والقفل هناك لا رجعة فيه: مُطلِق finance_period_identity
// لا يسمح إلا بانتقال open→closed، وfinance_periods_no_delete يمنع الحذف، ولا مسار إعادة فتح في الكود ولا في
// القاعدة. فخسارة أكتوبر ونوفمبر وديسمبر كانت نهائية. هذا الملف يحرس الحد في الكود وفي القاعدة معًا، ويحرس
// ألا تقول الشاشة عن شهر إنه «معتمد ومقفل» والقيود بتاريخه ما زالت مقبولة.

const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return `${month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`;};

function fixture(t,periods){
  const db=openDb(':memory:');seed(db,'synthetic-finance-periods');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('closer','36t','ops','closer','محاسب الإقفال المصطنع','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع الإقفال المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const who of ['closer','reviewer'])db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(),'36t',who,'finance.close.manage','تصريح إقفال مصطنع للاختبار','admin',now());
  for(const [who,actions] of [['closer',['read','configure','prepare']],['reviewer',['read','configure','approve','post']],['employee',['read','prepare']],['manager',['read','approve','post','configure']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const tx=f=>transaction(db,f);
  const made=periods.map(p=>tx(()=>createFinanceReference(db,users.closer,'periods',p)));
  const account=(code,name,type)=>tx(()=>createFinanceReference(db,users.manager,'accounts',{code,name,account_type:type,currency:'SAR'}));
  const expense=account('FP-EXP','مصروف مصطنع','expense'),liability=account('FP-LIA','التزام مصطنع','liability');
  const centre=tx(()=>createFinanceReference(db,users.manager,'cost_centers',{code:'FP-CC',name:'مركز إقفال مصطنع'}));
  // قيد متوازن بتاريخ محدد: ينجح ما دامت فترته المحاسبية مفتوحة، ويسقط بـperiod_closed إن أُقفلت.
  const journal=(periodId,date)=>tx(()=>createJournal(db,users.employee,{period_id:periodId,entry_date:date,description:`قيد مصطنع بتاريخ ${date}`,evidence:'دليل مصطنع للاختبار',currency:'SAR',source_reference:randomUUID(),
    lines:[{account_id:expense.id,cost_center_id:centre.id,debit:'10.00',credit:'0',memo:'مدين مصطنع'},{account_id:liability.id,cost_center_id:centre.id,debit:'0',credit:'10.00',memo:'دائن مصطنع'}]}));
  const template=title=>tx(()=>createTemplate(db,users.closer,{title,owner_id:'closer',due_day:5,basis:'قرار مالك إجراء الإقفال المصطنع لهذه المهمة'}));
  // المسار الكامل: فتح الإقفال، إنجاز مهمته بدليل، ثم اعتماده بيد شخص آخر.
  const closeMonth=(month,financePeriodId)=>{
    const opened=tx(()=>openClosePeriod(db,users.closer,{period_key:month,finance_period_id:financePeriodId}));
    const p=getClosePeriod(db,users.closer,opened.id);
    tx(()=>taskAction(db,users.closer,p.tasks[0].id,'complete_task',{version:p.tasks[0].version,evidence:'طابقت الكشف المصطنع وحفظت دليله'}));
    const fresh=getClosePeriod(db,users.reviewer,p.id);
    return tx(()=>periodAction(db,users.reviewer,p.id,'approve_close',{version:fresh.version,note:'راجعت كل مهمة ودليلها قبل الاعتماد'}));
  };
  const status=id=>db.prepare('SELECT status FROM finance_periods WHERE id=?').get(id).status;
  return {db,users,tx,periods:made,template,journal,closeMonth,status};
}

test('finance periods: a monthly close never rides on a year-long accounting period, and the rest of the year stays postable',t=>{
  const {db,users,tx,periods:[year],template,journal,status}=fixture(t,[{name:'السنة المالية المصطنعة 2026',starts_on:'2026-01-01',ends_on:'2026-12-31'}]);
  template('مطابقة كشف البنك المصطنع');
  // الفترة تغطي الشهر ولا تساويه: الربط يُرفض عند الفتح، والرفض يسمّي مدى الفترة الفعلي ويقول ما الذي يُنشأ بدله.
  assert.throws(()=>tx(()=>openClosePeriod(db,users.closer,{period_key:'2026-09',finance_period_id:year.id})),
    error=>error.code==='finance_period_scope'&&error.message.includes('2026-01-01')&&error.message.includes('2026-12-31')&&/شهرية/.test(error.message),
    'a close bound to a period wider than its month would close that whole period, with no way back');
  assert.equal(status(year.id),'open','the year was never dragged into a single month\'s close');
  journal(year.id,'2026-12-15');
  assert.ok(verifyAudit(db));
});

test('finance periods: the database itself refuses a close period bound to an accounting period that is not exactly its month',t=>{
  const {db,periods:[year]}=fixture(t,[{name:'السنة المالية المصطنعة 2026',starts_on:'2026-01-01',ends_on:'2026-12-31'}]);
  // الحارس في القاعدة لا في سطر كود واحد: القفل لا رجعة فيه، فلا يجوز أن يمنعه شرطٌ واحد قابل للالتفاف.
  const insert=()=>db.prepare('INSERT INTO close_periods(id,tenant_id,period_key,finance_period_id,opened_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t','2026-09',year.id,'closer',now(),now());
  assert.throws(insert,/exactly its own month/);
  const id=randomUUID();
  db.prepare('INSERT INTO close_periods(id,tenant_id,period_key,finance_period_id,opened_by,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?)').run(id,'36t','2026-09','closer',now(),now());
  assert.throws(()=>db.prepare('UPDATE close_periods SET finance_period_id=?,version=version+1,updated_at=? WHERE id=?').run(year.id,now(),id),/exactly its own month/,
    'a period bound after the fact is the same irreversible lock by another door');
});

test('finance periods: a month approved with no accounting period is not called locked, because its entries are not',t=>{
  const {db,users,template,closeMonth,periods:[september],status}=fixture(t,[{name:'سبتمبر المصطنع',starts_on:'2026-09-01',ends_on:'2026-09-30'}]);
  template('مطابقة كشف البنك المصطنع');
  // شهر بلا فترة محاسبية: يُعتمد، ولا يُقفل دفتره. التسمية تقول ذلك بدل أن تدّعي قفلًا لم يحدث.
  const unlocked=closeMonth('2026-08',null);
  assert.equal(unlocked.status,'approved');
  assert.equal(unlocked.ledger_locked,false);
  assert.equal(unlocked.status_name,'معتمد — القيود غير مقفلة');
  assert.equal(unlocked.finance_period,null);
  // وشهر مربوط بفترة تساويه بالضبط: يُقفل فعلًا، وتسميته تصدق.
  const locked=closeMonth('2026-09',september.id);
  assert.equal(locked.ledger_locked,true);
  assert.equal(locked.status_name,'معتمد ومقفل');
  assert.equal(status(september.id),'closed');
  assert.equal(getClosePeriod(db,users.reviewer,locked.id).status_name,'معتمد ومقفل');
  assert.ok(verifyAudit(db));
});
