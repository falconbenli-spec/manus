import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as f from '../app/finance.mjs';
import { bankBoard, createBankAccount, saveImportProfile, importStatement, cancelImport, suggestMatches,
  proposeMatch, decideMatch, createRule, reconciliationStatement, prepareReconciliation, approveReconciliation, parseCsv } from '../app/bank-reconciliation.mjs';

const code=value=>error=>error.code===value;
const PERIOD={start:'2026-08-01',end:'2026-08-31'};
// كشف مصطنع: صرف عهدة، رسوم بنكية بلا سجل مقابل، ثم إعادة متبقي العهدة. 10000 − 1500 − 25 + 500 = 8975.
const STATEMENT=['التاريخ,البيان,المرجع,مدين,دائن,الرصيد',
  '01/08/2026,"صرف عهدة تصوير — تجريبي",CUST-9001,"1,500.00",,"8,500.00"',
  '05/08/2026,رسوم خدمات بنكية شهرية,FEE-08,25.00,,8475.00',
  '12/08/2026,إعادة متبقي عهدة تجريبي,CUST-RET-9001,,500.00,8975.00'].join('\n');

function fixture(t,{book=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-bank-reconciliation');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  // employee يُعِدّ، manager يعتمد، hr يحمل التصريحين معًا لاختبار منع الاعتماد الذاتي على من يملك الاثنين.
  for(const [who,capability] of [['employee','bank.reconcile'],['manager','bank.reconcile.approve'],['hr','bank.reconcile'],['hr','bank.reconcile.approve']])
    tx(()=>grantAccess(db,users.admin,{user_id:who,capability,note:'تصريح مطابقة بنكية مصطنع'}));
  for(const [who,actions] of [['employee',['read','configure','prepare']],['manager',['read','approve','post']]])for(const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض دفتر مصطنع',null,now());
  const ref=(kind,input)=>tx(()=>f.createFinanceReference(db,users.employee,kind,input));
  const bankGl=ref('accounts',{code:'1000',name:'البنك — حساب تجريبي',account_type:'asset',currency:'SAR'});
  const equity=ref('accounts',{code:'3000',name:'رأس المال التجريبي',account_type:'equity',currency:'SAR'});
  const center=ref('cost_centers',{code:'GEN',name:'عام'}),period=ref('periods',{name:'سنة الاختبار',starts_on:'2026-01-01',ends_on:'2026-12-31'});
  // رصيد الدفتر: قيد يدوي مرحّل يجعل حساب البنك 9000.00 حتى نهاية الفترة.
  if(book){
    // الرصيد الافتتاحي بتاريخ ما قبل فترة الكشف: قيدٌ يدوي على حساب البنك داخل الفترة صار بندًا دفتريًا لم يظهر في البنك (الترحيل 168).
    const j=tx(()=>f.createJournal(db,users.employee,{period_id:period.id,entry_date:'2026-07-31',description:'رصيد بنك افتتاحي تجريبي',evidence:'قيد مصطنع للاختبار',currency:'SAR',source_reference:'OPEN-2026',
      lines:[{account_id:bankGl.id,cost_center_id:center.id,debit:'9000.00',credit:'0',memo:'رصيد البنك'},{account_id:equity.id,cost_center_id:center.id,debit:'0',credit:'9000.00',memo:'مقابل رأس المال'}]}));
    const step=(who,doc,action)=>tx(()=>f.journalAction(db,users[who],doc.id,action,{version:doc.version,note:'قرار مالي مصطنع'}));
    step('manager',step('manager',step('employee',j,'submit'),'approve'),'post');
  }
  // عهدة مصطنعة: صرف 1500 وإعادة 500. حاملها غير من صرفها وغير من أقفلها.
  const custodyId=randomUUID();
  db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,returned_minor,return_reference,closed_by,closed_at,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,'closed',?,?,?,?,?,?,?,?,?,'',?,?)")
    .run(custodyId,'36t','outsider',150000,'عهدة تصوير تجريبية للاختبار','manager','2026-07-30T00:00:00.000Z','2026-08-01','CUST-9001','manager',50000,'CUST-RET-9001','manager','2026-08-12T00:00:00.000Z',now(),now());
  const account=tx(()=>createBankAccount(db,users.employee,{label:'الحساب التشغيلي التجريبي',bank_name:'بنك تجريبي',account_tail:'4321',gl_account_id:bankGl.id}));
  const profile=tx(()=>saveImportProfile(db,users.employee,{bank_account_id:account.id,name:'كشف البنك التجريبي',delimiter:'comma',date_format:'DD/MM/YYYY',header_rows:1,
    columns:{date:'التاريخ',description:'البيان',reference:'المرجع',debit:'مدين',credit:'دائن',balance:'الرصيد'}}));
  const load=(content=STATEMENT,name='statement-08.csv')=>tx(()=>importStatement(db,users.employee,{profile_id:profile.id,file_name:name,content,
    period_start:PERIOD.start,period_end:PERIOD.end,opening_balance:'10000.00',closing_balance:'8975.00'}));
  return {db,users,tx,account,profile,period,bankGl,center,custodyId,load};
}
const lineOf=(board,text)=>board.transactions.find(t=>t.description.includes(text));

test('csv reader: quoted fields, thousands separators and a trailing row survive the bank export format',()=>{
  const rows=parseCsv('a,b\n"x,1","2"\n\ny,3',',');
  assert.deepEqual(rows,[['a','b'],['x,1','2'],['y','3']]);
});

test('statement import: the file is the only source, its content digest blocks a second import, and a file that does not add up is refused',t=>{
  const {db,users,tx,profile,load}=fixture(t);
  const batch=load();
  assert.equal(batch.row_count,3);
  assert.throws(()=>load(),code('duplicate_file'),'the same file content is never imported twice');
  const broken=STATEMENT.replace('25.00','35.00');
  assert.throws(()=>tx(()=>importStatement(db,users.employee,{profile_id:profile.id,file_name:'broken.csv',content:broken,period_start:PERIOD.start,period_end:PERIOD.end,opening_balance:'10000.00',closing_balance:'8975.00'})),code('statement_out_of_balance'));
  const outside=STATEMENT.replace('12/08/2026','12/09/2026');
  assert.throws(()=>tx(()=>importStatement(db,users.employee,{profile_id:profile.id,file_name:'outside.csv',content:outside,period_start:PERIOD.start,period_end:PERIOD.end,opening_balance:'10000.00',closing_balance:'8975.00'})),code('date_outside_period'));
  assert.throws(()=>tx(()=>importStatement(db,users.manager,{profile_id:profile.id,file_name:'x.csv',content:'a',period_start:PERIOD.start,period_end:PERIOD.end,opening_balance:'0',closing_balance:'0'})),code('not_permitted'),'an approver does not import');
  const board=bankBoard(db,users.employee);
  assert.equal(board.transactions.length,3);
  assert.equal(lineOf(board,'صرف عهدة').amount_minor,150000);
  assert.equal(lineOf(board,'إعادة متبقي').direction,'in');
  assert.match(board.note,/لا اتصال بأي بنك ولا مصرفية مفتوحة/);
  assert.ok(verifyAudit(db));
});

test('an imported bank line is never edited: correction is cancelling the whole batch, and only before a match on it is approved',t=>{
  const {db,users,tx,load}=fixture(t);
  const batch=load();
  const txn=lineOf(bankBoard(db,users.employee),'صرف عهدة');
  assert.throws(()=>db.prepare("UPDATE bank_transactions SET debit_minor=1 WHERE id=?").run(txn.id),/never edited/);
  assert.throws(()=>db.prepare('DELETE FROM bank_transactions WHERE id=?').run(txn.id),/retained/);
  const match=tx(()=>proposeMatch(db,users.employee,{transaction_id:txn.id,kind:'record',source_kind:'custody_issue',source_id:txn.suggestions[0].source_id,unmatched_reason:null,rationale:'المبلغ والمرجع والتاريخ يطابقان صرف العهدة المصطنعة'}));
  const live=db.prepare('SELECT version FROM bank_statement_imports WHERE id=?').get(batch.id).version;
  assert.throws(()=>tx(()=>cancelImport(db,users.employee,batch.id,{version:live,reason:'إلغاء قبل البت في المقترح'})),code('matches_pending'));
  tx(()=>decideMatch(db,users.manager,match.id,'approve',{version:1,note:'راجعت سند العهدة المصطنع'}));
  assert.throws(()=>tx(()=>cancelImport(db,users.employee,batch.id,{version:live,reason:'إلغاء بعد اعتماد مطابقة عليه'})),code('match_approved'));
  assert.throws(()=>db.prepare("UPDATE bank_statement_imports SET status='cancelled',cancelled_by='employee',cancelled_at='x',cancel_reason='تجاوز الضابط',version=version+1 WHERE id=?").run(batch.id),/approved match/);
  assert.ok(verifyAudit(db));
});

test('suggestion explains itself in words and stays a suggestion: nothing is matched without a human, and the preparer never approves',t=>{
  const {db,users,tx,load}=fixture(t);
  load();
  const board=bankBoard(db,users.employee);
  const txn=lineOf(board,'صرف عهدة'),fee=lineOf(board,'رسوم');
  const suggested=suggestMatches(db,users.employee,txn.id,{});
  assert.equal(suggested.candidates.length,1);
  const [candidate]=suggested.candidates;
  assert.equal(candidate.source_kind,'custody_issue');
  assert.ok(candidate.score>=70,'amount, date and reference all agree');
  assert.ok(candidate.reasons.some(r=>r.includes('المبلغ مطابق تمامًا')),'the reason is written for a human, not a bare number');
  assert.ok(candidate.reasons.some(r=>r.includes('التاريخ مطابق'))&&candidate.reasons.some(r=>r.includes('CUST-9001')));
  assert.deepEqual(suggestMatches(db,users.employee,fee.id,{}).candidates,[],'a bank fee has no record to match');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_matches').get().n,0,'a suggestion writes nothing by itself');
  assert.throws(()=>tx(()=>proposeMatch(db,users.employee,{transaction_id:fee.id,kind:'record',source_kind:'custody_issue',source_id:candidate.source_id,unmatched_reason:null,rationale:'محاولة مطابقة بمبلغ مختلف'})),code('amount_mismatch'));
  const match=tx(()=>proposeMatch(db,users.employee,{transaction_id:txn.id,kind:'record',source_kind:'custody_issue',source_id:candidate.source_id,unmatched_reason:null,rationale:'المبلغ والمرجع والتاريخ يطابقان صرف العهدة المصطنعة'}));
  assert.throws(()=>tx(()=>decideMatch(db,users.employee,match.id,'approve',{version:1,note:'أعتمد اقتراحي'})),code('not_permitted'),'the preparer holds no approval capability');
  // hr يحمل التصريحين: الفصل يبقى قائمًا بالهوية لا بالتصريح.
  const own=tx(()=>proposeMatch(db,users.hr,{transaction_id:fee.id,kind:'unmatched',source_kind:null,source_id:null,unmatched_reason:'bank_fee',rationale:'رسوم شهرية لا يقابلها سجل في المنصة'}));
  assert.throws(()=>tx(()=>decideMatch(db,users.hr,own.id,'approve',{version:1,note:'أعتمد ما أعددته'})),code('self_approval'));
  assert.throws(()=>tx(()=>decideMatch(db,users.manager,match.id,'approve',{version:9,note:'نسخة قديمة'})),code('stale_version'));
  tx(()=>decideMatch(db,users.manager,match.id,'approve',{version:1,note:'راجعت سند العهدة المصطنع'}));
  assert.throws(()=>tx(()=>decideMatch(db,users.manager,match.id,'reject',{version:2,note:'قرار ثانٍ على المطابقة نفسها'})),code('already_decided'));
  assert.throws(()=>db.prepare("UPDATE bank_matches SET rationale='تعديل صامت',version=version+1 WHERE id=?").run(match.id),/decided once/);
  assert.throws(()=>tx(()=>proposeMatch(db,users.employee,{transaction_id:lineOf(bankBoard(db,users.employee),'إعادة متبقي').id,kind:'record',source_kind:'custody_issue',source_id:candidate.source_id,unmatched_reason:null,rationale:'محاولة استخدام السجل مرتين'})),code('direction_mismatch'));
  assert.ok(verifyAudit(db));
});

test('tenant isolation and capability: a user of another entity and a user without the capability see and touch nothing',t=>{
  const {db,users,load}=fixture(t);
  load();
  assert.throws(()=>bankBoard(db,users.it),code('not_permitted'));
  assert.throws(()=>bankBoard(db,users.external),code('not_permitted'));
  assert.throws(()=>bankBoard(db,users.outsider),code('not_permitted'));
  const txn=lineOf(bankBoard(db,users.employee),'رسوم');
  assert.throws(()=>suggestMatches(db,users.external,txn.id,{}),code('not_permitted'));
  assert.equal(bankBoard(db,users.manager).transactions.length,3,'the approver reads the same board');
});

test('a bank rule only suggests: it names an account and an owner and posts nothing',t=>{
  const {db,users,tx,load,bankGl}=fixture(t);
  load();
  tx(()=>createRule(db,users.employee,{pattern:'رسوم خدمات بنكية',suggested_account_id:bankGl.id,suggested_project_id:null,note:'رسوم الحساب الشهرية تُقيَّد على مصروف البنك بعد اعتماد قيدها'}));
  assert.throws(()=>tx(()=>createRule(db,users.employee,{pattern:'رسوم خدمات بنكية',suggested_account_id:bankGl.id,suggested_project_id:null,note:'نمط مكرر يجب أن يُرفض'})),code('duplicate_rule'));
  assert.throws(()=>tx(()=>createRule(db,users.employee,{pattern:'بلا اقتراح',suggested_account_id:null,suggested_project_id:null,note:'قاعدة بلا حساب ولا مشروع'})),code('suggestion_required'));
  const board=bankBoard(db,users.employee),fee=lineOf(board,'رسوم');
  assert.equal(fee.rule_hints.length,1);
  assert.match(fee.rule_hints[0].text,/اقتراح فقط، لا ترحيل/);
  assert.equal(board.rules[0].owner_name,users.employee.name);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_journals').get().n,1,'no rule created a journal');
});

test('period reconciliation: every line is decided first, the difference is shown, and an approved reconciliation is locked',t=>{
  const {db,users,tx,account,load}=fixture(t);
  load();
  const board=bankBoard(db,users.employee);
  const ask={bank_account_id:account.id,period_start:PERIOD.start,period_end:PERIOD.end};
  const open=reconciliationStatement(db,users.employee,ask);
  assert.equal(open.undecided_count,3);
  assert.equal(open.can_prepare,false);
  assert.match(open.blocked_reason,/بلا قرار معتمد/);
  assert.throws(()=>tx(()=>prepareReconciliation(db,users.employee,{...ask,explanation:''})),code('transactions_undecided'));
  const decide=(description,payload)=>{
    const txn=lineOf(bankBoard(db,users.employee),description);
    const m=tx(()=>proposeMatch(db,users.employee,{transaction_id:txn.id,source_kind:null,source_id:null,unmatched_reason:null,...payload}));
    tx(()=>decideMatch(db,users.manager,m.id,'approve',{version:1,note:'راجعت السند المصطنع'}));
  };
  const issueId=lineOf(board,'صرف عهدة').suggestions[0].source_id;
  decide('صرف عهدة',{kind:'record',source_kind:'custody_issue',source_id:issueId,rationale:'المبلغ والمرجع والتاريخ يطابقان صرف العهدة'});
  decide('إعادة متبقي',{kind:'record',source_kind:'custody_return',source_id:issueId,rationale:'المبلغ والمرجع يطابقان إعادة متبقي العهدة'});
  decide('رسوم',{kind:'unmatched',unmatched_reason:'bank_fee',rationale:'رسوم شهرية لا يقابلها سجل؛ تنتظر قيدًا يُعِدّه المحاسب'});
  const ready=reconciliationStatement(db,users.employee,ask);
  assert.equal(ready.undecided_count,0);
  assert.equal(ready.statement_closing_minor,897500);
  assert.equal(ready.unmatched_bank_minor,-2500,'the classified bank fee is the only bank movement missing from the books');
  assert.equal(ready.book_balance_minor,900000);
  assert.equal(ready.expected_book_minor,900000);
  assert.equal(ready.difference_minor,0);
  assert.match(ready.formula,/رصيد البنك الختامي/);
  // hr يحمل تصريحي الإعداد والاعتماد معًا: الفصل بالهوية لا بالتصريح.
  const draft=tx(()=>prepareReconciliation(db,users.hr,{...ask,explanation:''}));
  assert.throws(()=>tx(()=>approveReconciliation(db,users.employee,draft.id,{version:1,note:'اعتماد بلا تصريح'})),code('not_permitted'));
  assert.throws(()=>tx(()=>approveReconciliation(db,users.hr,draft.id,{version:1,note:'أعتمد ما أعددته'})),code('self_approval'));
  assert.throws(()=>tx(()=>approveReconciliation(db,users.manager,draft.id,{version:5,note:'نسخة قديمة'})),code('stale_version'));
  tx(()=>approveReconciliation(db,users.manager,draft.id,{version:1,note:'طابقت الكشف بالسجلات وراجعت تصنيف الرسوم'}));
  assert.throws(()=>tx(()=>approveReconciliation(db,users.manager,draft.id,{version:2,note:'اعتماد ثانٍ'})),code('not_draft'));
  assert.throws(()=>db.prepare("UPDATE bank_reconciliations SET difference_minor=0,version=version+1 WHERE id=?").run(draft.id),/locked/);
  assert.throws(()=>tx(()=>prepareReconciliation(db,users.employee,{bank_account_id:account.id,period_start:'2026-08-15',period_end:'2026-08-31',explanation:''})),code('period_overlap'));
  const row=bankBoard(db,users.employee).reconciliations[0];
  assert.equal(row.status,'approved');
  assert.equal(row.approved_by_name,users.manager.name);
  assert.ok(verifyAudit(db));
});

test('a non-zero difference is never stored or approved without a written explanation',t=>{
  const {db,users,tx,account,load}=fixture(t,{book:false});
  load();
  const ask={bank_account_id:account.id,period_start:PERIOD.start,period_end:PERIOD.end};
  for(const [description,payload] of [['صرف عهدة',{kind:'unmatched',unmatched_reason:'unknown',rationale:'سجل غير محدد بعد في هذه النسخة'}],
    ['رسوم',{kind:'unmatched',unmatched_reason:'bank_fee',rationale:'رسوم شهرية لا يقابلها سجل في المنصة'}],
    ['إعادة متبقي',{kind:'unmatched',unmatched_reason:'unknown',rationale:'إيداع لم يُربط بسجل بعد'}]]){
    const txn=lineOf(bankBoard(db,users.employee),description);
    const m=tx(()=>proposeMatch(db,users.employee,{transaction_id:txn.id,source_kind:null,source_id:null,...payload}));
    tx(()=>decideMatch(db,users.manager,m.id,'approve',{version:1,note:'راجعت التصنيف المصطنع'}));
  }
  const s=reconciliationStatement(db,users.employee,ask);
  assert.equal(s.book_balance_minor,0,'nothing is posted to the bank account in the ledger');
  assert.equal(s.difference_minor,s.expected_book_minor);
  assert.notEqual(s.difference_minor,0);
  assert.throws(()=>tx(()=>prepareReconciliation(db,users.employee,{...ask,explanation:''})),code('explanation_required'));
  assert.throws(()=>tx(()=>prepareReconciliation(db,users.employee,{...ask,explanation:'قصير'})),code('explanation_required'));
  const draft=tx(()=>prepareReconciliation(db,users.employee,{...ask,explanation:'لم تُرحّل قيود الفترة في الدفتر بعد، والفرق يساوي مجموع الحركات غير المقيدة'}));
  tx(()=>approveReconciliation(db,users.manager,draft.id,{version:1,note:'اطلعت على التفسير وقبلته'}));
  const row=db.prepare('SELECT * FROM bank_reconciliations WHERE id=?').get(draft.id);
  assert.equal(row.status,'approved');
  assert.ok(row.explanation.length>=20,'the explanation is stored with the approved reconciliation');
  assert.throws(()=>db.prepare("UPDATE bank_reconciliations SET explanation='',version=version+1 WHERE id=?").run(draft.id),/locked/);
  assert.ok(verifyAudit(db));
});
