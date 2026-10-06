import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as f from '../app/finance.mjs';
import { expensesBoard, submitClaim, claimAction, requestCustody, custodyAction } from '../app/expenses.mjs';
import { assetsBoard, registerAsset, assetAction, runDepreciation, monthlyDepreciation } from '../app/assets.mjs';
import { recordMapping, approveMapping, journalFromSource, statements } from '../app/ledger.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-expenses');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee',NULL),('accountant','36t','ops','accountant','محاسب مصطنع','unused','employee',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const [who,actions] of [['accountant',['read','configure','prepare']],['treasurer',['read','configure','approve','post']]])for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,users[who].role,action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const claim=(who,input={})=>transaction(db,()=>submitClaim(db,users[who],{expense_date:today(),category:'transport',description:'أجرة نقل معدات إلى موقع التصوير المصطنع',amount:'230.00',receipt_reference:'rcpt-77',...input})).id;
  const act=(who,id,action,values={})=>transaction(db,()=>claimAction(db,users[who],id,action,{version:db.prepare('SELECT version FROM expense_claims WHERE id=?').get(id).version,...values}));
  const cAct=(who,id,action,values={})=>transaction(db,()=>custodyAction(db,users[who],id,action,{version:db.prepare('SELECT version FROM custodies WHERE id=?').get(id).version,...values}));
  return {db,users,claim,act,cAct};
}

test('E51: a receipt is claimed once, approved by the line manager then finance, and the claimant decides nothing',t=>{
  const {db,users,claim,act}=fixture(t);
  const id=claim('employee');
  assert.throws(()=>claim('employee'),code('duplicate_receipt'));
  assert.throws(()=>claim('employee',{expense_date:'2099-01-01',receipt_reference:'future'}),code('expense_date'));
  assert.throws(()=>act('employee',id,'manager_approve',{note:'إقرار ذاتي'}),code('action_unavailable'));
  assert.throws(()=>act('treasurer',id,'finance_approve',{note:'تجاوز المدير المباشر'}),code('action_unavailable'));
  assert.equal(act('manager',id,'manager_approve',{note:'المصروف لمشروع الفريق'}).status,'manager_approved');
  assert.throws(()=>act('manager',id,'finance_approve',{note:'المدير ليس المالية'}),code('action_unavailable'));
  assert.equal(act('treasurer',id,'finance_approve',{note:'طابقت الإيصال والمبلغ'}).status,'finance_approved');
  assert.equal(expensesBoard(db,users.employee).totals.my_unreimbursed_minor,23000);
  assert.throws(()=>act('treasurer',id,'record_reimbursement',{reimbursed_on:'2099-01-01',reference:'TRX-9'}),code('reimbursed_on'));
  assert.equal(act('treasurer',id,'record_reimbursement',{reimbursed_on:today(),reference:'trx-9'}).status,'reimbursed');
  assert.equal(expensesBoard(db,users.outsider).claims.length,0,'a colleague sees no one else\'s claims');
  assert.equal(expensesBoard(db,users.manager).claims.length,1);
  assert.throws(()=>db.prepare("UPDATE expense_claims SET amount_minor=1,version=version+1 WHERE id=?").run(id),/final/);
  assert.ok(verifyAudit(db));
});

test('E52: custody is issued by finance, settled by approved claims, and closes only when the remainder is returned exactly',t=>{
  const {db,users,claim,act,cAct}=fixture(t);
  const id=transaction(db,()=>requestCustody(db,users.employee,{amount:'1000.00',purpose:'مصروفات تصوير ميداني مصطنع لثلاثة أيام'})).id;
  assert.throws(()=>transaction(db,()=>requestCustody(db,users.employee,{amount:'500.00',purpose:'عهدة ثانية قبل تسوية الأولى'})),code('open_custody'));
  assert.throws(()=>cAct('employee',id,'approve_custody',{note:'اعتماد ذاتي'}),code('action_unavailable'));
  cAct('treasurer',id,'approve_custody',{note:'ضمن سقف العهد المعتمد'});
  assert.throws(()=>claim('employee',{custody_id:id}),code('custody'),'an approved but unissued custody holds no money');
  cAct('treasurer',id,'issue_custody',{issued_on:today(),reference:'cash-1'});
  assert.throws(()=>claim('employee',{custody_id:id,amount:'1200.00',receipt_reference:'big'}),code('custody_exceeded'));
  const c1=claim('employee',{custody_id:id,amount:'600.00',receipt_reference:'r-1'});
  assert.throws(()=>cAct('treasurer',id,'close_custody',{returned:'400.00',return_reference:'ret-1',note:'إقفال مبكر'}),code('action_unavailable'),'pending claims block closing');
  act('manager',c1,'manager_approve',{note:'مصروف ميداني فعلي'});act('treasurer',c1,'finance_approve',{note:'طابقت الإيصال'});
  assert.equal(expensesBoard(db,users.treasurer).custodies[0].open_minor,40000);
  assert.throws(()=>cAct('treasurer',id,'close_custody',{returned:'300.00',return_reference:'ret-1',note:'إقفال بفرق'}),code('unexplained_balance'));
  assert.equal(cAct('treasurer',id,'close_custody',{returned:'400.00',return_reference:'ret-1',note:'أعيد المتبقي نقدًا'}).status,'closed');
});

test('E61: an asset is approved by a second person and depreciates straight-line once per month with no gaps, the last month absorbing rounding',t=>{
  const {db,users}=fixture(t);
  const asset={acquired_on:'2026-01-15',cost_minor:100000,salvage_minor:0,useful_months:3};
  assert.deepEqual(['2026-01','2026-02','2026-03','2026-04','2026-05'].map((m,i)=>monthlyDepreciation(asset,m,[0,0,33333,66666,100000][i])),[0,33333,33333,33334,0]);
  const id=transaction(db,()=>registerAsset(db,users.accountant,{name:'كاميرا مصطنعة',category:'cameras_production',acquired_on:'2026-01-15',cost:'1000.00',salvage:'0',useful_months:3,custodian_id:'employee',location:'الاستوديو',evidence:'فاتورة شراء مصطنعة وسياسة عمر ثلاثة أشهر للاختبار'})).id;
  assert.throws(()=>transaction(db,()=>runDepreciation(db,users.accountant,{month:'2026-02'})),code('nothing_to_depreciate'),'a pending asset does not depreciate');
  const version=()=>db.prepare('SELECT version FROM fixed_assets WHERE id=?').get(id).version;
  assert.throws(()=>transaction(db,()=>assetAction(db,users.accountant,id,'approve_asset',{version:version(),note:'اعتماد ذاتي'})),code('assets_access_denied'));
  transaction(db,()=>assetAction(db,users.treasurer,id,'approve_asset',{version:version(),note:'طابقت الفاتورة'}));
  assert.throws(()=>transaction(db,()=>runDepreciation(db,users.accountant,{month:'2026-03'})),code('earlier_month_missing'));
  assert.equal(transaction(db,()=>runDepreciation(db,users.accountant,{month:'2026-02'})).total_minor,33333);
  assert.throws(()=>transaction(db,()=>runDepreciation(db,users.accountant,{month:'2026-02'})),code('run_exists'));
  transaction(db,()=>runDepreciation(db,users.accountant,{month:'2026-03'}));
  assert.equal(transaction(db,()=>runDepreciation(db,users.accountant,{month:'2026-04'})).total_minor,33334);
  const board=assetsBoard(db,users.treasurer);
  assert.deepEqual([board.assets[0].accumulated_minor,board.assets[0].net_book_minor,board.assets[0].code],[100000,0,'FA-0001']);
  assert.throws(()=>db.prepare('DELETE FROM depreciation_lines').run(),/immutable/);
  assert.throws(()=>assetsBoard(db,users.employee),code('assets_access_denied'));
});

test('ledger: expense, custody, depreciation and the year-end close all post from their documents and keep the balance sheet balanced',t=>{
  const {db,users,claim,act}=fixture(t);
  const ref=(kind,input)=>transaction(db,()=>f.createFinanceReference(db,users.treasurer,kind,input));
  const accounts=Object.fromEntries([['bank','1000','asset'],['employee_custody','1200','asset'],['accumulated_depreciation','1590','asset'],['employee_payable','2300','liability'],['retained_earnings','3100','equity'],['general_expense','5100','expense'],['depreciation_expense','5200','expense']].map(([purpose,c,type])=>[purpose,ref('accounts',{code:c,name:purpose,account_type:type,currency:'SAR'})]));
  const center=ref('cost_centers',{code:'GEN',name:'عام'}),year=Number(today().slice(0,4));
  const periods={[year]:ref('periods',{name:'السنة الحالية',starts_on:`${year}-01-01`,ends_on:`${year}-12-31`}),[year-1]:ref('periods',{name:'السنة السابقة',starts_on:`${year-1}-01-01`,ends_on:`${year-1}-12-31`})};
  for(const purpose of Object.keys(accounts)){const {id}=transaction(db,()=>recordMapping(db,users.accountant,{purpose,account_id:accounts[purpose].id,cost_center_id:center.id,effective_from:'2020-01-01'}));transaction(db,()=>approveMapping(db,users.treasurer,id,{note:'طابقت الدليل'}));}
  const post=(kind,sourceId,period=year)=>{let j=transaction(db,()=>journalFromSource(db,users.accountant,{source_kind:kind,source_id:sourceId,period_id:periods[period].id}));
    const step=(who,action)=>{j=transaction(db,()=>f.journalAction(db,users[who],j.id,action,{version:j.version,note:'دليل قرار مالي مصطنع'}));};step('accountant','submit');step('treasurer','approve');step('treasurer','post');return j;};
  const id=claim('employee');
  assert.throws(()=>post('expense_claim',id),code('source_not_ready'));
  act('manager',id,'manager_approve',{note:'مصروف الفريق'});act('treasurer',id,'finance_approve',{note:'طابقت الإيصال'});
  assert.deepEqual(post('expense_claim',id).lines.map(l=>[l.debit_minor,l.credit_minor]),[[23000,0],[0,23000]]);
  act('treasurer',id,'record_reimbursement',{reimbursed_on:today(),reference:'trx-1'});post('expense_reimbursement',id);
  const assetId=transaction(db,()=>registerAsset(db,users.accountant,{name:'حاسوب مصطنع',category:'devices',acquired_on:`${year-1}-10-01`,cost:'1200.00',salvage:'0',useful_months:12,custodian_id:'employee',location:'المكتب',evidence:'فاتورة شراء مصطنعة وسياسة عمر سنة للاختبار'})).id;
  transaction(db,()=>assetAction(db,users.treasurer,assetId,'approve_asset',{version:1,note:'طابقت الفاتورة'}));
  const run=transaction(db,()=>runDepreciation(db,users.accountant,{month:`${year-1}-11`}));
  post('depreciation_run',run.id,year-1);
  assert.deepEqual(statements(db,users.treasurer).closable_years,[String(year-1)]);
  const close=post('year_close',String(year-1),year-1);
  assert.deepEqual(close.lines.map(l=>[l.debit_minor,l.credit_minor]),[[0,10000],[10000,0]],'depreciation expense is closed into retained earnings');
  assert.throws(()=>post('year_close',String(year-1),year-1),code('duplicate_source'));
  assert.throws(()=>post('year_close',String(year)),code('source_not_ready'),'the current year cannot be closed');
  const s=statements(db,users.treasurer,{from:`${year-1}-01-01`,to:today()});
  assert.equal(s.balance_sheet.balanced,true);
  assert.equal(s.balance_sheet.equity.find(r=>r.code==='3100').amount_minor,-10000);
  assert.deepEqual(s.closable_years,[]);
});
