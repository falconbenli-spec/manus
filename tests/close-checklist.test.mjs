import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,now,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createFinanceReference,createJournal } from '../app/finance.mjs';
import { closeBoard,getClosePeriod,createTemplate,templateAction,openClosePeriod,taskAction,periodAction,RECLOSE_DAYS } from '../app/close-checklist.mjs';
import { adoptionAction } from '../app/options.mjs';
import { closeChecklistUI } from '../app/static/cash-close-ui.mjs';

const code=value=>error=>error.code===value;
const helpers={e:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${label}</button>`,money:m=>m===null||m===undefined?'—':`${m/100} SAR`};

const lastMonth=()=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [y,m]=today.slice(0,7).split('-').map(Number);
  return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;
};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-close-checklist');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('closer','36t','ops','closer','محاسب الإقفال المصطنع','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع الإقفال المصطنع','unused','manager',NULL),('third','36t','ops','third','الطرف الثالث المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const capability=(who,key)=>db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(),'36t',who,key,'تصريح مصطنع للاختبار','admin',now());
  for(const who of ['closer','reviewer','third'])capability(who,'finance.close.manage');
  capability('employee','finance.close.manage');
  // تفويض مالي: قفل القيود هو إقفال الفترة المحاسبية في الدفتر، ويحتاج تفويض configure فيه.
  for(const [who,actions] of [['closer',['read','configure','prepare']],['reviewer',['read','configure','approve','post']],['third',['read','configure']],['employee',['read','prepare']],['manager',['read','approve','post','configure']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const tx=f=>transaction(db,f);
  const month=lastMonth(),[year,m]=month.split('-').map(Number);
  const monthEnd=`${month}-${String(new Date(Date.UTC(year,m,0)).getUTCDate()).padStart(2,'0')}`;
  const financePeriod=tx(()=>createFinanceReference(db,users.closer,'periods',{name:`فترة ${month} المصطنعة`,starts_on:`${month}-01`,ends_on:monthEnd}));
  const template=(title,owner='closer',due_day=5)=>tx(()=>createTemplate(db,users.closer,{title,owner_id:owner,due_day,basis:'قرار مالك إجراء الإقفال المصطنع لهذه المهمة'}));
  const open=(extra={})=>tx(()=>openClosePeriod(db,users.closer,{period_key:month,finance_period_id:financePeriod.id,...extra}));
  const period=id=>getClosePeriod(db,users.closer,id);
  return {db,users,tx,month,monthEnd,financePeriod,template,open,period,capability};
}

test('close checklist: the list starts empty and every task comes from an owner who put it there',t=>{
  const {db,users,tx,template,open,period}=fixture(t);
  const bare=closeBoard(db,users.closer);
  assert.deepEqual(bare.templates,[]);assert.deepEqual(bare.periods,[]);
  assert.match(bare.note,/تبدأ فارغة/);
  const empty=period(open().id);
  assert.deepEqual(empty.tasks,[]);
  assert.match(empty.blocked_reason,/لا مهام/);
  assert.ok(!empty.actions.includes('approve_close'),'an empty checklist is not an approvable close');
  template('مطابقة كشف البنك المصطنع');template('مراجعة أعمار الذمم المصطنعة');
  const next=period(tx(()=>openClosePeriod(db,users.closer,{period_key:'2026-01',finance_period_id:null})).id);
  assert.deepEqual(next.tasks.map(x=>x.title).sort(),['مراجعة أعمار الذمم المصطنعة','مطابقة كشف البنك المصطنع']);
  assert.equal(next.tasks[0].status,'open');
  assert.equal(next.finance_period,null,'a month with no accounting period is honest that nothing will be locked');
  assert.throws(()=>tx(()=>openClosePeriod(db,users.closer,{period_key:'2026-01',finance_period_id:null})),code('period_exists'));
  assert.throws(()=>tx(()=>openClosePeriod(db,users.closer,{period_key:'2099-01',finance_period_id:null})),code('future_period'));
});

test('close checklist: the capability, not a role, opens it, and another tenant is never in view',t=>{
  const {db,users,tx,template,open}=fixture(t);
  assert.throws(()=>tx(()=>createTemplate(db,users.manager,{title:'مهمة بلا تصريح',owner_id:'closer',due_day:5,basis:'محاولة بلا تصريح للاختبار'})),code('not_permitted'));
  assert.throws(()=>tx(()=>openClosePeriod(db,users.outsider,{period_key:'2026-02',finance_period_id:null})),code('not_permitted'));
  template('مهمة مصطنعة واحدة');const p=open();
  assert.equal(closeBoard(db,users.outsider).periods.length,0,'a task owner sees their periods; a stranger sees none');
  assert.equal(closeBoard(db,users.closer).periods.length,1);
  assert.throws(()=>getClosePeriod(db,users.external,p.id),code('not_found'),'a period of another tenant does not exist for this account');
  assert.throws(()=>tx(()=>periodAction(db,users.external,p.id,'add_task',{version:1,title:'اختراق العزل',owner_id:'closer',due_date:'2026-10-01'})),code('not_found'));
  assert.throws(()=>tx(()=>createTemplate(db,users.external,{title:'قالب من كيان آخر',owner_id:'closer',due_day:5,basis:'محاولة عبور العزل للاختبار'})),code('not_permitted'));
});

test('close checklist: a task closes only with evidence, and whoever executed one never approves the close',t=>{
  const {db,users,tx,template,open,period}=fixture(t);
  template('مطابقة كشف البنك المصطنع','closer');
  const p=period(open().id),task=p.tasks[0];
  assert.throws(()=>tx(()=>periodAction(db,users.reviewer,p.id,'approve_close',{version:p.version,note:'اعتماد قبل إنجاز المهام'})),code('invalid_state'));
  assert.throws(()=>tx(()=>taskAction(db,users.reviewer,task.id,'complete_task',{version:task.version,evidence:'قصير'})),code('invalid_text'));
  const done=tx(()=>taskAction(db,users.closer,task.id,'complete_task',{version:task.version,evidence:'طابقت كشف الحساب المصطنع وحفظته في ملف الإقفال'}));
  assert.equal(done.tasks[0].status,'done');assert.equal(done.tasks[0].completed_by,'closer');
  assert.equal(done.open_tasks,0);
  // من فتح الفترة (closer) نفّذ المهمة أيضًا: لا يعتمد إقفالها بأي حال.
  assert.ok(!done.actions.includes('approve_close'));
  assert.throws(()=>tx(()=>periodAction(db,users.closer,p.id,'approve_close',{version:done.version,note:'أعتمد ما نفذته بنفسي'})),code('invalid_state'));
  assert.equal(getClosePeriod(db,users.reviewer,p.id).actions.includes('approve_close'),true);
  assert.throws(()=>db.prepare("UPDATE close_periods SET status='approved',approved_by='closer',approved_at=?,approval_note='التفاف على الفصل',version=version+1 WHERE id=?").run(now(),p.id),/does not approve/);
});

test('close checklist: an approved close locks the accounting period so no entry carries a date inside it',t=>{
  const {db,users,tx,template,open,period,financePeriod,month}=fixture(t);
  template('مطابقة كشف البنك المصطنع','closer');
  const p=period(open().id);
  tx(()=>taskAction(db,users.closer,p.tasks[0].id,'complete_task',{version:p.tasks[0].version,evidence:'طابقت الكشف المصطنع وحفظت الدليل'}));
  const before=getClosePeriod(db,users.reviewer,p.id);
  const approved=tx(()=>periodAction(db,users.reviewer,p.id,'approve_close',{version:before.version,note:'راجعت كل مهمة ودليلها قبل الاعتماد'}));
  assert.equal(approved.status,'approved');assert.equal(approved.ledger_locked,true);
  assert.equal(db.prepare('SELECT status FROM finance_periods WHERE id=?').get(financePeriod.id).status,'closed','the close reuses the ledger lock that already exists; it does not build a second one');
  const account=kind=>tx(()=>createFinanceReference(db,users.manager,'accounts',{code:`CL-${kind}`,name:`حساب ${kind} مصطنع`,account_type:kind,currency:'SAR'}));
  const expense=account('expense'),liability=account('liability'),centre=tx(()=>createFinanceReference(db,users.manager,'cost_centers',{code:'CL-CC',name:'مركز إقفال مصطنع'}));
  assert.throws(()=>tx(()=>createJournal(db,users.employee,{period_id:financePeriod.id,entry_date:`${month}-15`,description:'قيد بتاريخ داخل فترة مقفلة',evidence:'دليل مصطنع',currency:'SAR',source_reference:randomUUID(),
    lines:[{account_id:expense.id,cost_center_id:centre.id,debit:'10.00',credit:'0',memo:'مدين مصطنع'},{account_id:liability.id,cost_center_id:centre.id,debit:'0',credit:'10.00',memo:'دائن مصطنع'}]})),code('period_closed'));
  // المعتمد لا يُعدَّل: لا مهمة جديدة ولا تعديل على دليل مهمة منفذة.
  assert.throws(()=>tx(()=>periodAction(db,users.reviewer,p.id,'add_task',{version:approved.version,title:'مهمة بعد الاعتماد',owner_id:'closer',due_date:`${month}-28`})),code('invalid_state'));
  assert.throws(()=>db.prepare("INSERT INTO close_tasks(id,tenant_id,period_id,title,owner_id,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(),'36t',p.id,'مهمة مهرّبة','closer',`${month}-28`,'closer',now(),now()),/takes no new task/);
  assert.throws(()=>db.prepare("UPDATE close_tasks SET evidence='دليل مبدّل بصمت',version=version+1 WHERE period_id=?").run(p.id),/not edited|keeps its executor/);
  assert.ok(verifyAudit(db));
});

test('close checklist: an approved close reopens only on a documented request a third person approves',t=>{
  const {db,users,tx,template,open,period}=fixture(t);
  template('مطابقة كشف البنك المصطنع','closer');
  const p=period(open().id);
  tx(()=>taskAction(db,users.closer,p.tasks[0].id,'complete_task',{version:p.tasks[0].version,evidence:'طابقت الكشف المصطنع وحفظت الدليل'}));
  let state=tx(()=>periodAction(db,users.reviewer,p.id,'approve_close',{version:getClosePeriod(db,users.reviewer,p.id).version,note:'راجعت كل مهمة ودليلها قبل الاعتماد'}));
  // من اعتمد الإقفال لا يطلب فتحه.
  assert.ok(!getClosePeriod(db,users.reviewer,p.id).actions.includes('request_reopen'));
  assert.throws(()=>tx(()=>periodAction(db,users.reviewer,p.id,'request_reopen',{version:state.version,reason:'أفتح ما اعتمدته بنفسي'})),code('invalid_state'));
  state=tx(()=>periodAction(db,users.closer,p.id,'request_reopen',{version:state.version,reason:'وصلت فاتورة مورد تخص الشهر بعد الاعتماد'}));
  assert.equal(state.status,'approved','the close stays approved until a third person decides');
  assert.equal(state.pending_reopen.status,'pending');
  // طالب الفتح لا يعتمده، ومعتمد الإقفال لا يعتمده.
  assert.throws(()=>tx(()=>periodAction(db,users.closer,p.id,'approve_reopen',{version:state.version,note:'أعتمد طلبي بنفسي وهذا ممنوع'})),code('invalid_state'));
  assert.throws(()=>tx(()=>periodAction(db,users.reviewer,p.id,'approve_reopen',{version:state.version,note:'أعتمد فتح ما اعتمدته وهذا ممنوع'})),code('invalid_state'));
  assert.throws(()=>tx(()=>periodAction(db,users.third,p.id,'approve_reopen',{version:state.version+5,note:'نسخة قديمة من الشاشة تُرفض'})),code('stale_version'));
  // موعد إعادة الإقفال قرار المالك: يسجّله واحد ويعتمده ثانٍ قبل أن يُفتح الدفتر (الترحيل 168).
  tx(()=>adoptionAction(db,users.closer,RECLOSE_DAYS,'record',{value:{days:5},basis:'قرار مالك إجراء الإقفال المصطنع لمدة إعادة الإقفال',effective_from:'2026-01-01'}));
  tx(()=>adoptionAction(db,users.reviewer,RECLOSE_DAYS,'approve',{adoption_id:db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(RECLOSE_DAYS).id,note:'اعتمدت المدة بعد مراجعة أساسها'}));
  const reopened=tx(()=>periodAction(db,users.third,p.id,'approve_reopen',{version:state.version,note:'أقر بأن الفاتورة تخص الشهر وتستوجب فتح الإقفال'}));
  assert.equal(reopened.status,'open');assert.equal(reopened.reopen_count,1);
  assert.equal(reopened.reopenings[0].status,'approved');
  assert.equal(reopened.reopenings[0].previous_approved_by,'reviewer','the trace of who had approved the close survives the reopening');
  // كان الدفتر يبقى مقفلًا بعد الفتح (المسبار على 3d1d84c: ledger_locked=true والفترة closed). الفتح المعتمد يفتح الفترة المحاسبية معه الآن.
  assert.equal(reopened.ledger_locked,false,'the approved reopen opens the accounting period through its ledger reopening');
  assert.equal(db.prepare('SELECT status FROM finance_periods WHERE id=?').get(reopened.finance_period_id).status,'open');
  assert.throws(()=>db.prepare("UPDATE close_reopenings SET reason='سبب مبدّل',version=version+1 WHERE period_id=?").run(p.id),/never rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM close_periods WHERE id=?').run(p.id),/immutable/);
  assert.ok(verifyAudit(db));
});

test('close checklist: every write needs a transaction and a fresh version of what the screen showed',t=>{
  const {db,users,tx,template,open,period}=fixture(t);
  const tpl=template('مطابقة كشف البنك المصطنع','closer');
  assert.throws(()=>createTemplate(db,users.closer,{title:'بلا معاملة',owner_id:'closer',due_day:5,basis:'محاولة بلا معاملة للاختبار'}),code('transaction_required'));
  assert.throws(()=>openClosePeriod(db,users.closer,{period_key:'2026-03',finance_period_id:null}),code('transaction_required'));
  const p=period(open().id),task=p.tasks[0];
  assert.throws(()=>taskAction(db,users.closer,task.id,'complete_task',{version:task.version,evidence:'دليل مصطنع كافٍ'}),code('transaction_required'));
  assert.throws(()=>tx(()=>taskAction(db,users.closer,task.id,'complete_task',{version:task.version+3,evidence:'دليل مصطنع كافٍ'})),code('stale_version'));
  assert.throws(()=>tx(()=>templateAction(db,users.closer,tpl.id,'deactivate_template',{version:99,note:'نسخة قديمة'})),code('stale_version'));
  tx(()=>templateAction(db,users.closer,tpl.id,'deactivate_template',{version:1,note:'أوقفت القالب بقرار مالك الإجراء'}));
  assert.throws(()=>tx(()=>templateAction(db,users.closer,tpl.id,'deactivate_template',{version:2,note:'تكرار الإيقاف'})),code('invalid_state'));
  // الفترة التالية لا ترث قالبًا موقوفًا، والفترة القائمة تحتفظ بقائمة يوم فتحها.
  const later=period(tx(()=>openClosePeriod(db,users.closer,{period_key:'2026-04',finance_period_id:null})).id);
  assert.deepEqual(later.tasks,[]);
  assert.equal(period(p.id).tasks.length,1);
  assert.ok(verifyAudit(db));
});

test('close checklist screen: it renders from real board data under the strict content policy',t=>{
  const {db,users,template,open}=fixture(t);
  template('مطابقة كشف البنك المصطنع','closer');open();
  const data=closeBoard(db,users.closer);
  const html=closeChecklistUI.render(data,{e:helpers.e,button:helpers.button,money:helpers.money});
  assert.ok(!/style=|<script/.test(html));
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.ok(html.includes('تبدأ فارغة'),'the screen repeats that the platform invents no accounting checklist');
  assert.equal(closeChecklistUI.form('open_period','',data).endpoint,'/close-checklist/periods');
  assert.throws(()=>closeChecklistUI.form('approve_close',data.periods[0].id,data),/غير متاح/,'the screen never offers an action the board did not allow');
});
