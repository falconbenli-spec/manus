import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

// الترحيل 125 يعيد بناء leave_request_terms ليقبل مصدر الرصيد «overtime»، ويضيف دفاتر الإجازة التعويضية ويجمّد اختيار التعويض.
// يُختبر على قاعدة من قبله فيها طلب إجازة بشروطه، وطلب عمل إضافي اختير له وقت الراحة: لا صف يضيع ولا معنى يتغير. كل البيانات مصطنعة «تجريبي».
const STAMP='2026-09-20T09:00:00.000Z';

function pre125(t){
  const dir=mkdtempSync(join(tmpdir(),'pre125-')),path=join(dir,'pre125.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=125)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-125');
  // سياسة بشكل الإصدار 2، وتقويم ورصيد وطلب إجازة طارئة نصف يوم بشروطه، وحركة في دفتر الأيام تحيل إلى الطلب نفسه.
  raw.prepare("INSERT INTO leave_type_policies(id,tenant_id,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,decision_note,created_at) VALUES('policy-pre125','36t','أنواع الإجازات (تجريبي)','سياسة مصطنعة بشكل الإصدار الثاني سابقة للترحيل 125.',?,'سند مصطنع للاختبار','2025-01-01','accepted','hr','manager',?,'اعتماد تجريبي سابق',?)")
    .run(JSON.stringify({version:2,types:[{code:'emergency',name_ar:'الإجازة الطارئة',articles:['87'],unit:'working',source:'entitlement',half_day:true,entitlement:{days:3,period:'year'},pay_tiers:[{days:null,rate_bp:10000}],documents:[],rules_ar:[]}],public_holidays:{items:[]},unpaid_leave:{threshold_days:20,mode:null}}),STAMP,STAMP);
  raw.prepare("INSERT INTO leave_calendars VALUES('cal-pre125','36t','creative','hr','تقويم تجريبي 2026','2026-01-01','2026-12-31','[0,1,2,3,4]','[]','Asia/Riyadh',1,?)").run(STAMP);
  raw.prepare("INSERT INTO leave_balances VALUES('bal-pre125','36t','employee','emergency',2026,'cal-pre125','2026-01-01',?)").run(STAMP);
  raw.prepare("INSERT INTO leave_requests(id,tenant_id,employee_id,balance_id,start_date,end_date,days,work_dates_json,reason,status,created_at,updated_at) VALUES('req-pre125','36t','employee','bal-pre125','2026-10-04','2026-10-04',1,'[\"2026-10-04\"]','طلب تجريبي سابق للترحيل','pending_manager',?,?)").run(STAMP,STAMP);
  raw.prepare("INSERT INTO leave_request_terms(request_id,revision,tenant_id,leave_type,policy_id,unit,days_milli,counted_dates_json,half_day,variant,event_date,source,route,pay_json,document_required,warnings_json,created_at) VALUES('req-pre125',1,'36t','emergency','policy-pre125','working',500,'[\"2026-10-04\"]',1,NULL,NULL,'entitlement','manager_hr','[{\"date\":\"2026-10-04\",\"rate_bp\":10000,\"milli\":500}]',0,'[]',?)").run(STAMP);
  raw.prepare("INSERT INTO leave_day_ledger(id,tenant_id,employee_id,leave_type,balance_year,source,request_id,revision,kind,used_milli,reserved_milli,effective_date,actor_id,reason,created_at) VALUES('ledger-pre125','36t','employee','emergency',2026,'entitlement','req-pre125',1,'reserve',0,500,'2026-10-04','employee','حجز تجريبي',?)").run(STAMP);
  // عمل إضافي اختير له وقت الراحة واعتُمد قبل الترحيل: بلا نص موافقة محفوظ وبلا قيد رصيد.
  raw.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,decided_by,decided_at,decision_note,created_at,retroactive,compensation,consent_at) VALUES('ot-pre125','36t','employee','2026-09-15',60,'ساعات مصطنعة اعتُمدت قبل الترحيل 125','approved','manager',?,'اعتماد سابق',?,1,'time_off',?)").run(STAMP,STAMP,STAMP);
  const before={terms:JSON.stringify(raw.prepare('SELECT * FROM leave_request_terms ORDER BY request_id,revision').all()),ledger:JSON.stringify(raw.prepare('SELECT * FROM leave_day_ledger ORDER BY seq').all()),
    overtime:JSON.stringify(raw.prepare('SELECT * FROM overtime_requests ORDER BY id').all()),audit:raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n};
  // القيد الذي يوسّعه الترحيل قائم قبله: مصدر «overtime» مرفوض.
  assert.doesNotMatch(raw.prepare("SELECT sql FROM sqlite_master WHERE name='leave_request_terms'").get().sql,/'overtime'/);
  raw.close();
  return {path,before};
}

test('migration 125: a database with leave terms and a time-off overtime request upgrades in place, keeps every row, and gains the compensatory ledgers',t=>{
  const {path,before}=pre125(t),db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=125').get(),'125 is applied by openDb');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM leave_request_terms ORDER BY request_id,revision').all()),before.terms,'every term row and column is carried unchanged');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM leave_day_ledger ORDER BY seq').all()),before.ledger,'the day ledger is untouched');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM overtime_requests ORDER BY id').all()),before.overtime);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before.audit,'the migration writes no audit event of its own');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(verifyAudit(db),true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'leave_request_terms_v098%'").get().n,0,'the carry table is gone');
  // الجدول المعاد بناؤه: STRICT، وقيوده ومشغّلاه وفهرسه عادت، والمصدر الجديد مقبول والمجهول مرفوض.
  const sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='leave_request_terms'").get().sql;
  assert.match(sql,/\)\s*STRICT\s*$/);assert.match(sql,/'opening','accrual','entitlement','none','overtime'/);assert.match(sql,/REFERENCES leave_requests\(id,tenant_id\)/);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='leave_request_terms_type'").get());
  assert.throws(()=>db.prepare("UPDATE leave_request_terms SET days_milli=1000 WHERE request_id='req-pre125'").run(),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM leave_request_terms').run(),/immutable/);
  const term='INSERT INTO leave_request_terms(request_id,revision,tenant_id,leave_type,policy_id,unit,days_milli,counted_dates_json,half_day,source,route,pay_json,document_required,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  db.prepare(term).run('req-pre125',2,'36t','compensatory','policy-pre125','working',500,'["2026-10-04"]',1,'overtime','manager_hr','[]',0,STAMP);
  assert.throws(()=>db.prepare(term).run('req-pre125',3,'36t','compensatory','policy-pre125','working',500,'["2026-10-04"]',1,'invented','manager_hr','[]',0,STAMP),/CHECK/);
  assert.throws(()=>db.prepare(term).run('no-such-request',1,'36t','compensatory','policy-pre125','working',500,'["2026-10-04"]',1,'overtime','manager_hr','[]',0,STAMP),/FOREIGN KEY/);
  assert.throws(()=>db.prepare(term).run('req-pre125',4,'36t','compensatory','policy-pre125','working',1000,'["2026-10-04"]',1,'overtime','manager_hr','[]',0,STAMP),/CHECK/,'half_day still means 500');
  // اختيار التعويض صار ثابتًا، والدفاتر الجديدة STRICT تقبل قيدًا صحيحًا عن الطلب القديم وترفض ما يخالفه.
  assert.throws(()=>db.prepare("UPDATE overtime_requests SET compensation='pay',consent_at=NULL WHERE id='ot-pre125'").run(),/never rewritten/);
  for(const table of ['overtime_compensation_consents','compensatory_credits','compensatory_movements','compensatory_payouts'])
    assert.match(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table).sql,/\)\s*STRICT\s*$/,table);
  const credit='INSERT INTO compensatory_credits(id,tenant_id,user_id,overtime_request_id,work_date,overtime_minutes,ratio_bp,leave_minutes,expires_on,policy_id,legacy,credited_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  assert.throws(()=>db.prepare(credit).run('credit-wrong','36t','employee','ot-pre125','2026-09-15',120,15000,180,'2026-11-14','policy-pre125',1,'manager','دقائق لا تطابق الطلب',STAMP),/approved overtime request compensated by leave/);
  assert.throws(()=>db.prepare(credit).run('credit-self','36t','employee','ot-pre125','2026-09-15',60,15000,90,'2026-11-14','policy-pre125',1,'employee','يقيّد لنفسه',STAMP),/CHECK/);
  db.prepare(credit).run('credit-after','36t','employee','ot-pre125','2026-09-15',60,15000,90,'2026-11-14','policy-pre125',1,'manager','قيد تجريبي بعد الترحيل',STAMP);
  // مُشغِّل «مرة واحدة» يسبق فهرس UNIQUE، ويمسك ما لا يمسكه: INSERT OR REPLACE يحذف الصف دون إطلاق مُشغِّل الحذف.
  assert.throws(()=>db.prepare(credit).run('credit-twice','36t','employee','ot-pre125','2026-09-15',60,15000,90,'2026-11-14','policy-pre125',1,'manager','قيد ثانٍ',STAMP),/append only|UNIQUE/);
  assert.throws(()=>db.prepare(credit.replace('INSERT INTO','INSERT OR REPLACE INTO')).run('credit-after','36t','employee','ot-pre125','2026-09-15',60,15000,240,'2026-11-14','policy-pre125',1,'manager','إعادة كتابة قيد مسجَّل',STAMP),/append only/);
  assert.equal(db.prepare('SELECT leave_minutes FROM compensatory_credits WHERE id=?').get('credit-after').leave_minutes,90);
  const move='INSERT INTO compensatory_movements(id,tenant_id,user_id,credit_id,request_id,revision,kind,used_minutes,reserved_minutes,daily_minutes,working_time_policy_id,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('wt-after','36t','working_time','ساعات عمل تجريبية','نص سياسة مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.','{}','سند مصطنع للاختبار','2025-01-01','accepted','hr','manager',?,?)").run(STAMP,STAMP);
  assert.throws(()=>db.prepare(move).run('move-over','36t','employee','credit-after','req-pre125',2,'reserve',0,91,480,'wt-after','employee','أكثر مما في القيد',STAMP),/cannot be overdrawn/);
  assert.throws(()=>db.prepare(move).run('move-other','36t','outsider','credit-after','req-pre125',2,'reserve',0,30,480,'wt-after','outsider','قيد غيره',STAMP),/stays on its owner/);
  db.prepare(move).run('move-ok','36t','employee','credit-after','req-pre125',2,'reserve',0,90,480,'wt-after','employee','حجز تجريبي',STAMP);
  assert.throws(()=>db.prepare(move).run('move-refund','36t','employee','credit-after','req-pre125',2,'refund',-90,0,480,'wt-after','manager','رد بلا خصم',STAMP),/requires a matching debit/);
  assert.throws(()=>db.prepare('DELETE FROM compensatory_movements').run(),/append only/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const checksums=JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all());db.close();
  const again=openDb(path);t.after(()=>{try{again.close();}catch{}});
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),checksums,'a second start applies nothing');
});
