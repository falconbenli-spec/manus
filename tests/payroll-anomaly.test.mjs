import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { anomalyBoard, runAnomalyReport, saveAnomalySettings, duplicateBankAccounts, anomalySettings } from '../app/payroll-anomaly.mjs';
import { fixture, iban } from './wage-fixture.mjs';

const code=value=>error=>error.code===value;
const keys=report=>report.findings.map(f=>f.key);
const finding=(report,key)=>report.findings.find(f=>f.key===key);

test('one bank account behind two employees is the loudest finding on the board, and no finding ever stops the run',t=>{
  const {db,users,tx,contract,bank,draftRun,act}=fixture(t);
  contract('employee');contract('outsider',[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1000.00'}]);
  bank('employee','80000000000000000021');bank('outsider','80000000000000000021');
  assert.throws(()=>anomalyBoard(db,users.employee),code('not_permitted'));
  const run=draftRun('2026-02'),report=runAnomalyReport(db,users.reviewer,run.id);
  assert.equal(report.advisory,true);
  assert.equal(report.findings[0].key,'duplicate_bank_account','the fraud check comes first whatever else is on the board');
  assert.equal(report.findings[0].critical,true);
  assert.equal(report.findings[0].employees.length,2);
  assert.equal(report.findings.every(f=>['attention','info'].includes(f.level)),true,'nothing here is a blocker');
  assert.equal(JSON.stringify(report).includes(iban('80000000000000000021')),false,'the check compares accounts without ever exposing one');
  assert.ok(report.findings[0].detail.includes('0021'),'the reader still gets enough to recognise the account');
  assert.deepEqual(duplicateBankAccounts(db,'isolated'),[],'the check never reaches across tenants');
  // استشاري لا مانع: المسير يمضي في مساره كاملًا والنتائج قائمة.
  let moved=act('hr',run,'submit_run');
  moved=act('reviewer',moved,'pass_review',{note:'رأيت نتائج كشف الشذوذ وقررت المضي'});
  moved=act('hr-manager',moved,'approve_run',{note:'اعتماد تجريبي بعد الاطلاع على النتائج'});
  assert.equal(moved.status,'approved');
  assert.equal(finding(runAnomalyReport(db,users['hr-manager'],run.id),'duplicate_bank_account').critical,true,'the finding stays visible after approval');
  assert.ok(verifyAudit(db));
});

test('every rule is deterministic and either has a threshold its owner entered or says plainly that it is not running',t=>{
  const {db,users,tx,contract,amend,endContract,adjustment,draftRun,approveRun,act}=fixture(t);
  const employeeContract=contract('employee');
  const outsiderContract=contract('outsider',[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1000.00'}]);
  approveRun('2026-02');
  amend(employeeContract,'employee',[{component:'basic',amount:'8000.00'}],'2026-03-01');
  endContract(outsiderContract,'2026-02-28');
  contract('new-hire',[{component:'basic',amount:'5000.00'}],'2026-03-01');
  adjustment('employee','bonus','2026-03','3000.00');
  adjustment('employee','overtime','2026-03','500.00');
  const march=draftRun('2026-03');

  const blind=runAnomalyReport(db,users.reviewer,march.id);
  assert.deepEqual(keys(blind).filter(k=>k.endsWith('threshold_not_set')).sort(),['deduction_threshold_not_set','overtime_threshold_not_set','variance_threshold_not_set']);
  assert.equal(keys(blind).includes('variance_over_threshold'),false,'without a threshold the platform invents none');
  const thresholds={version:undefined,variance_bp:500,variance_amount:null,deduction_ratio_bp:5000,overtime_factor_bp:20000,basis:'قرار تجريبي من معتمد الرواتب بتاريخ اليوم، لأغراض الاختبار الآلي'};
  assert.throws(()=>tx(()=>saveAnomalySettings(db,users.hr,thresholds)),code('not_permitted'));
  assert.throws(()=>tx(()=>saveAnomalySettings(db,users.reviewer,thresholds)),code('not_permitted'));
  assert.throws(()=>tx(()=>saveAnomalySettings(db,users['hr-manager'],{...thresholds,variance_bp:0})),code('threshold'));
  tx(()=>saveAnomalySettings(db,users['hr-manager'],thresholds));
  assert.equal(anomalySettings(db,'36t').variance_bp,500);
  assert.throws(()=>tx(()=>saveAnomalySettings(db,users['hr-manager'],{...thresholds,version:7})),code('stale_version'));

  const report=runAnomalyReport(db,users.reviewer,march.id);
  assert.equal(report.compared_with,'2026-02');
  assert.equal(keys(report).includes('variance_threshold_not_set'),false);
  assert.deepEqual(finding(report,'variance_over_threshold').employees.map(e=>e.id),['employee']);
  assert.deepEqual(finding(report,'first_time_in_run').employees.map(e=>e.id),['new-hire']);
  assert.deepEqual(finding(report,'disappeared_from_run').employees.map(e=>e.id),['outsider']);
  assert.equal(finding(report,'allowance_stopped').employees[0].component,'housing');
  assert.deepEqual(finding(report,'overtime_without_history').employees.map(e=>e.id),['employee']);
  assert.ok(finding(report,'variance_over_threshold').detail.includes('5.00%'),'the finding carries the threshold and its basis');
  assert.ok(finding(report,'variance_over_threshold').link.ids.length,'every finding points back at the record');

  // سبب مكتوب على السطر يُسقط تنبيه انقطاع البدل: القاعدة تحترم ما كتبه الإنسان.
  let run=act('hr',march,'submit_run');
  const line=run.lines.find(l=>l.user_id==='employee');
  act('reviewer',run,'justify',{line_id:line.id,note:'انقطع بدل السكن بعقد معدل موقّع ومحفوظ مرجعه'});
  assert.equal(keys(runAnomalyReport(db,users.reviewer,march.id)).includes('allowance_stopped'),false);
  assert.ok(verifyAudit(db));
});
