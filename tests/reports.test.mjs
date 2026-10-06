import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { submitClaim, claimAction } from '../app/expenses.mjs';
import { reportsIndex, runReport, saveSnapshot, readSnapshot, snapshotAction, exportReport, printable } from '../app/reports.mjs';
import { workbook, csv } from '../app/xlsx.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
// قارئ ZIP صغير للاختبار: يفك كل ملف في الحزمة من الدليل المركزي.
function unzip(buffer){
  const files={},end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06])),count=buffer.readUInt16LE(end+10);let at=buffer.readUInt32LE(end+16);
  for(let i=0;i<count;i++){const size=buffer.readUInt32LE(at+20),nameLength=buffer.readUInt16LE(at+28),local=buffer.readUInt32LE(at+42),name=buffer.subarray(at+46,at+46+nameLength).toString('utf8');
    const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);files[name]=inflateRawSync(buffer.subarray(dataStart,dataStart+size)).toString('utf8');at+=46+nameLength+buffer.readUInt16LE(at+30)+buffer.readUInt16LE(at+32);}
  return files;
}
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-reports');t.after(()=>db.close());seedVendorsDemo(db);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee',NULL),('controller','36t','ops','controller','مراقب مالي مصطنع','unused','employee',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const who of ['treasurer','controller'])for(const action of ['read','approve','post'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,'employee',action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض تقارير مصطنع',null,now());
  const claim=(amount,receipt)=>{const id=transaction(db,()=>submitClaim(db,users.employee,{expense_date:today(),category:'transport',description:'مصروف نقل مصطنع لأغراض التقرير',amount,receipt_reference:receipt})).id;const v=()=>db.prepare('SELECT version FROM expense_claims WHERE id=?').get(id).version;transaction(db,()=>claimAction(db,users.manager,id,'manager_approve',{version:v(),note:'مصروف الفريق'}));transaction(db,()=>claimAction(db,users.treasurer,id,'finance_approve',{version:v(),note:'طابقت الإيصال'}));};
  claim('100.50','r-1');claim('49.50','r-2');
  return {db,users};
}

test('acceptance: the same report matches on screen, CSV and XLSX, and carries its definition, source, period and extraction time',t=>{
  const {db,users}=fixture(t);
  const r=runReport(db,users.treasurer,'R34',{from:'2026-01-01',to:today()});
  assert.deepEqual(r.rows[0],{category:'نقل',claims:2,total:150,approved:150,reimbursed:0,rejected:0});
  assert.equal(r.data_until,today());assert.ok(r.generated_at);assert.equal(r.live,true);
  const asCsv=exportReport(r,'csv'),text=asCsv.content.toString('utf8');
  assert.equal(text.charCodeAt(0),0xFEFF,'BOM keeps Arabic readable in spreadsheet programs');
  assert.ok(text.includes('نقل,2,150,150,0,0'));
  const files=unzip(exportReport(r,'xlsx').content);
  assert.deepEqual(Object.keys(files).sort(),['[Content_Types].xml','_rels/.rels','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/workbook.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml']);
  const sheet=files['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('rightToLeft="1"'));assert.ok(sheet.includes('<v>150</v>'),'amounts are numbers, not text');assert.ok(sheet.includes('نقل'));
  assert.ok(files['xl/worksheets/sheet2.xml'].includes('expense_claims + custodies'),'definitions sheet names the source');
  const page=printable(r);
  assert.ok(page.includes('dir="rtl"')&&page.includes('البيانات حتى')&&page.includes('150.00')&&!page.includes('<script'));
});

test('export safety: text that looks like a formula stays text in CSV and XLSX',()=>{
  assert.equal(csv([['x'],['=HYPERLINK("http://evil")'],['+1'],[-5]]).split('\r\n')[1].startsWith("\"'=HYPERLINK"),true);
  assert.equal(csv([[-5]]).includes("'-5"),false,'real negative numbers are not altered');
  const sheet=unzip(workbook([{name:'اختبار/غير:صالح',rows:[['عمود'],['=1+1'],[7]]}]))['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('t="inlineStr"')&&sheet.includes('=1+1')&&!sheet.includes('<f>'));
});

test('acceptance: two users with different rights do not get the same reports, including through a saved snapshot',t=>{
  const {db,users}=fixture(t);
  assert.deepEqual(reportsIndex(db,users.it).reports.map(r=>r.key),['R11'],'no capability: only the progress of projects you are a member of');
  assert.deepEqual(reportsIndex(db,users.employee).reports.map(r=>r.key),['R11','R26','R27','R28','R29','R30'],'the procurement officer sees own projects and the vendor and procurement reports');
  assert.deepEqual(reportsIndex(db,users.manager).reports.map(r=>r.key),['R06','R07','R08','R09','R10','R11','R14','R26','R27','R28','R29','R30']);
  assert.ok(reportsIndex(db,users.treasurer).reports.some(r=>r.key==='R31'));
  assert.throws(()=>runReport(db,users.manager,'R34',{}),code('not_found'));
  assert.throws(()=>runReport(db,users.employee,'R07',{}),code('not_found'));
  assert.throws(()=>runReport(db,users.external,'R26',{}),code('not_found'));
  const id=transaction(db,()=>saveSnapshot(db,users.treasurer,'R34',{from:'2026-01-01',to:today()})).id;
  assert.throws(()=>readSnapshot(db,users.manager,id),code('not_found'),'a snapshot grants nothing its report does not');
  assert.equal(reportsIndex(db,users.manager).snapshots.length,0);
  assert.throws(()=>runReport(db,users.treasurer,'R34',{from:'2026-05-01',to:'2026-01-01'}),code('date_order'));
});

test('acceptance: an approved snapshot reproduces the captured figures after the live data changes, and is approved by someone else',t=>{
  const {db,users}=fixture(t);
  const id=transaction(db,()=>saveSnapshot(db,users.treasurer,'R34',{from:'2026-01-01',to:today()})).id;
  assert.throws(()=>transaction(db,()=>snapshotAction(db,users.treasurer,id,'approve_snapshot',{note:'اعتماد من مُعد اللقطة نفسه'})),code('separation_of_duties'));
  transaction(db,()=>snapshotAction(db,users.controller,id,'approve_snapshot',{note:'راجعت الإجماليات مع سجل المطالبات'}));
  const extra=transaction(db,()=>submitClaim(db,users.employee,{expense_date:today(),category:'transport',description:'مصروف لاحق بعد حفظ اللقطة المعتمدة',amount:'500.00',receipt_reference:'r-late'}));
  assert.ok(extra.id);
  assert.equal(runReport(db,users.treasurer,'R34',{from:'2026-01-01',to:today()}).rows[0].total,650);
  const frozen=readSnapshot(db,users.controller,id);
  assert.equal(frozen.rows[0].total,150);assert.equal(frozen.live,false);assert.equal(frozen.snapshot.status,'approved');
  assert.throws(()=>db.prepare("UPDATE report_snapshots SET result='{}' WHERE id=?").run(id),/keeps the figures/);
  assert.throws(()=>db.prepare('DELETE FROM report_snapshots WHERE id=?').run(id),/retained/);
  db.exec('DROP TRIGGER report_snapshots_fixed');db.prepare("UPDATE report_snapshots SET result=replace(result,'150','999') WHERE id=?").run(id);
  assert.throws(()=>readSnapshot(db,users.controller,id),code('snapshot_corrupted'),'tampering outside the platform is detected by the digest');
  assert.ok(verifyAudit(db));
});

test('vendor and workforce reports read real records and say what they do not cover',t=>{
  const {db,users}=fixture(t);
  const vendors=runReport(db,users.manager,'R26',{});
  assert.equal(vendors.rows.length,7);assert.ok(vendors.rows.some(r=>r.status==='موقوف'));
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.attendance.approve',note:'اختبار تقرير'}));
  const attendance=runReport(db,users.hr,'R37',{from:'2026-01-01',to:today()});
  assert.ok(attendance.notes.some(n=>n.includes('ليس مخالفة')));
  const workforce=runReport(db,users.hr,'R36',{});
  assert.equal(workforce.rows.reduce((n,r)=>n+r.headcount,0),db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id='36t' AND active=1 AND role<>'admin'").get().n);
  assert.ok(workforce.notes[0].includes('لا رواتب'));
});
