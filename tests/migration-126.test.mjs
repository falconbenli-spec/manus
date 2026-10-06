import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed } from '../scripts/seed.mjs';
import { openDb,hash } from '../app/db.mjs';

// اختبار ترقية الترحيل 126 من قاعدة سبقته (docs/implementation/COMPANY-WIDE-PROMPT.md، القاعدة 2).
// القاعدة القديمة تُبنى بكل ترحيل قبل 126 وتُملأ بـSQL خام لا بدوال المحرك: دوال المحرك تقرأ جداول 126 (authorizedStep يقرأ
// approval_step_escalations)، والقاعدة القديمة لا تحملها. كل ما فيها مصطنع.
const STAMP='2026-09-14T07:00:00.000Z',LATER='2026-09-16T07:00:00.000Z',LAST='2026-09-20T07:00:00.000Z';
const TABLES=['workflow_timer_settings','approval_step_escalations','request_assignment_events','request_lapses','undeliverable_notices','undeliverable_notice_resolutions'];
function pre126(t){
  const directory=mkdtempSync(join(tmpdir(),'36t-pre126-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'pre126.sqlite'),raw=new DatabaseSync(path),schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec('PRAGMA foreign_keys=ON');raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=126)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));
  }
  seed(raw,'synthetic-pre-126');
  const service=raw.prepare("SELECT id FROM services WHERE code='HR-LETTER'").get().id;
  const request=(id,status,revision,assigned=null)=>raw.prepare('INSERT INTO requests(id,tenant_id,requester_id,service_id,title,payload,status,revision,assigned_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'36t','employee',service,`طلب تجريبي قبل الترحيل ${id}`,'{"purpose":"غرض مصطنع"}',status,revision,assigned,STAMP,STAMP);
  request('req-pending','pending',1);request('req-returned','returned',1);request('req-running','in_progress',1,'hr');request('req-resubmitted','pending',2);
  for(const id of ['req-pending','req-returned','req-running'])raw.prepare('INSERT INTO request_versions VALUES(?,?,?,?)').run(id,1,'{}',STAMP);
  for(const revision of [1,2])raw.prepare('INSERT INTO request_versions VALUES(?,?,?,?)').run('req-resubmitted',revision,'{}',STAMP);
  const step=(id,rid,revision)=>raw.prepare("INSERT INTO approval_steps(id,request_id,revision,position,approver_id,status) VALUES(?,?,?,0,'manager','pending')").run(id,rid,revision);
  step('step-pending','req-pending',1);
  // الخطوة تولد معلّقة ثم تُحسم (مشغّلا decision_initial وdecision_valid)، كما يكتبها المحرك.
  step('step-returned','req-returned',1);
  raw.prepare("UPDATE approval_steps SET status='returned',note='ينقصه اسم الجهة',decided_at=?,decided_by='manager' WHERE id='step-returned'").run(STAMP);
  // خطوة معلّقة يتيمة من نسخة سابقة: الطلب أُعيد ثم قُدّم من جديد، وخطوة النسخة الأولى بقيت «pending» إلى الأبد.
  step('step-dead','req-resubmitted',1);step('step-live','req-resubmitted',2);
  const before={requests:JSON.stringify(raw.prepare('SELECT * FROM requests ORDER BY id').all()),steps:JSON.stringify(raw.prepare('SELECT * FROM approval_steps ORDER BY id').all()),
    audit:raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n};
  raw.close();
  return {path,before};
}
const aborts=(db,sql,pattern,...values)=>assert.throws(()=>db.prepare(sql).run(...values),pattern);
const TIMER='INSERT INTO workflow_timer_settings(id,tenant_id,timer_key,unit,value,basis,status,proposed_by,proposed_at,adopted_by,adopted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)';
const timerRow=(id,key,value,status='proposed',adopter=null)=>[id,'36t',key,'working_days',value,'سند مصطنع لاختبار الترحيل',status,'admin',STAMP,adopter,adopter?STAMP:null];
function adoptedTimer(db,id,key,value){
  db.prepare(TIMER).run(...timerRow(id,key,value));
  db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='manager',adopted_at=? WHERE id=?").run(STAMP,id);
}

test('migration 126: a database from before it upgrades in place, keeps every request and step, and gains its tables empty',t=>{
  const {path,before}=pre126(t),db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=126').get(),'126 is applied by openDb');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM requests ORDER BY id').all()),before.requests,'requests are untouched');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM approval_steps ORDER BY id').all()),before.steps,'approval steps are untouched');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before.audit,'the migration writes no audit event of its own');
  for(const table of TABLES){
    const meta=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    assert.ok(meta,`${table} exists`);assert.match(meta.sql,/\)\s*STRICT\s*$/,`${table} is STRICT`);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`${table} is seeded with nothing: the owner has decided no value`);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const checksums=JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all());db.close();
  const again=openDb(path);t.after(()=>{try{again.close();}catch{}});
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),checksums,'a second start applies nothing');
});

test('migration 126: the number belongs to this file alone, and 120 stays the owner’s own migration',()=>{
  const files=readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f));
  assert.deepEqual(files.filter(f=>f.startsWith('126-')),['126-workflow-timers-and-escalations.sql']);
  assert.deepEqual(files.filter(f=>f.startsWith('120-')),['120-appearance-studio.sql'],'the first draft of this migration was numbered 120; that number is taken');
  assert.equal(files.some(f=>/^12[35]-/.test(f)&&/timer|escalat/.test(f)),false,'123 and 125 are reserved by other branches');
});

test('migration 126: a timer is born proposed, is adopted once by a second person, is never edited and never deleted',t=>{
  const {path}=pre126(t),db=openDb(path);t.after(()=>db.close());
  aborts(db,TIMER,/born proposed/,...timerRow('t0','returned_expiry',10,'adopted','manager'));
  db.prepare(TIMER).run(...timerRow('t1','returned_expiry',10));
  aborts(db,TIMER,/UNIQUE/,...timerRow('t2','returned_expiry',12));
  aborts(db,TIMER,/CHECK/,...timerRow('t3','Returned-Expiry',12));
  aborts(db,TIMER,/CHECK/,...timerRow('t4','unclaimed_alert',0));
  aborts(db,TIMER,/FOREIGN KEY/,'t5','36t','unclaimed_alert','working_days',2,'سند مصطنع لاختبار الترحيل','proposed','external',STAMP,null,null);
  aborts(db,"UPDATE workflow_timer_settings SET status='adopted',adopted_by='admin',adopted_at=? WHERE id='t1'",/CHECK/,STAMP);
  aborts(db,"UPDATE workflow_timer_settings SET value=11 WHERE id='t1'",/never edited/);
  aborts(db,"UPDATE workflow_timer_settings SET basis='سند آخر مصطنع بعد الاقتراح' WHERE id='t1'",/never edited/);
  db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='manager',adopted_at=? WHERE id='t1'").run(STAMP);
  aborts(db,"UPDATE workflow_timer_settings SET adopted_by='hr' WHERE id='t1'",/never edited/);
  aborts(db,"UPDATE workflow_timer_settings SET status='proposed',adopted_by=NULL,adopted_at=NULL WHERE id='t1'",/never edited/);
  db.prepare(TIMER).run(...timerRow('t6','returned_expiry',15));
  aborts(db,"UPDATE workflow_timer_settings SET status='adopted',adopted_by='manager',adopted_at=? WHERE id='t6'",/UNIQUE/,STAMP);
  db.prepare("UPDATE workflow_timer_settings SET status='superseded',superseded_at=? WHERE id='t1'").run(STAMP);
  db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='manager',adopted_at=? WHERE id='t6'").run(STAMP);
  aborts(db,"UPDATE workflow_timer_settings SET status='adopted',superseded_at=NULL WHERE id='t1'",/never edited/);
  aborts(db,"DELETE FROM workflow_timer_settings WHERE id='t1'",/retained/);
  assert.deepEqual(db.prepare('SELECT id,status,value FROM workflow_timer_settings ORDER BY id').all().map(r=>({...r})),[{id:'t1',status:'superseded',value:10},{id:'t6',status:'adopted',value:15}]);
});

test('migration 126: an escalation is a ladder — it moves a current pending step from its present decider, level by level, never back and never to the requester',t=>{
  const {path}=pre126(t),db=openDb(path);t.after(()=>db.close());
  const insert='INSERT INTO approval_step_escalations(id,step_id,level,tenant_id,request_id,from_user_id,to_user_id,basis,reason,timer_row_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)';
  const reason='سبب مصطنع لاختبار قيود جدول التصعيد';
  const row=(id,step,level,rid,from,to,basis='unqualified',timer=null,actor=null)=>[id,step,level,'36t',rid,from,to,basis,reason,timer,actor,STAMP];
  // المشغّل يسبق قيد CHECK: أيهما رفض فالصف لم يُكتب.
  aborts(db,insert,/CHECK|present decider/,...row('x','step-pending',1,'req-pending','manager','manager'));
  aborts(db,insert,/CHECK/,...row('x','step-pending',1,'req-pending','manager','hr','requester_followup'));
  aborts(db,insert,/CHECK/,...row('x','step-pending',1,'req-pending','manager','hr','other_basis',null,'admin'));
  aborts(db,insert,/CHECK|present decider/,...row('x','step-pending',0,'req-pending','manager','hr'));
  aborts(db,insert,/never to the requester/,...row('x','step-pending',1,'req-pending','manager','employee'));
  aborts(db,insert,/present decider/,...row('x','step-pending',1,'req-pending','it','hr'));
  aborts(db,insert,/present decider/,...row('x','step-pending',2,'req-pending','manager','hr'));
  aborts(db,insert,/current pending step of this request/,...row('x','step-pending',1,'req-returned','manager','hr'));
  aborts(db,insert,/current pending step/,...row('x','step-returned',1,'req-returned','manager','hr'));
  // الحارس الذي نقص المسودة الأولى: خطوة معلّقة يتيمة من نسخة سابقة لا تُصعَّد، ولو كان طلبها «قيد الاعتماد» بنسخة أحدث.
  aborts(db,insert,/current pending step/,...row('x','step-dead',1,'req-resubmitted','manager','hr'));
  // حساب من كيان آخر: كان يقف عند المفتاح الأجنبي، وصار يقف قبله عند المشغّل نفسه — شرطُ «نشطٌ في هذا الكيان» أضيق.
  aborts(db,insert,/FOREIGN KEY|stopped account/,...row('x','step-pending',1,'req-pending','manager','external'));
  // وحسابٌ موقوف في الكيان نفسه: الصف كان يُكتب فلا يبقى للخطوة من يقررها أصلًا (authorizedStep تحل صاحب القرار بحساب نشط).
  db.prepare("UPDATE users SET active=0 WHERE id='hr'").run();
  aborts(db,insert,/stopped account/,...row('x','step-pending',1,'req-pending','manager','hr'));
  db.prepare("UPDATE users SET active=1 WHERE id='hr'").run();
  // انقضاء المهلة لا يُكتب بلا مهلة متبناة: لا بصف مقترح، ولا بمفتاح آخر، ولا بلا صف.
  aborts(db,insert,/CHECK|adopted approval_escalation timer/,...row('x','step-pending',1,'req-pending','manager','hr','timeout'));
  db.prepare(TIMER).run(...timerRow('esc-proposed','approval_escalation',2));
  aborts(db,insert,/adopted approval_escalation timer/,...row('x','step-pending',1,'req-pending','manager','hr','timeout','esc-proposed'));
  adoptedTimer(db,'other-key','returned_expiry',9);
  aborts(db,insert,/adopted approval_escalation timer/,...row('x','step-pending',1,'req-pending','manager','hr','timeout','other-key'));
  db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='manager',adopted_at=? WHERE id='esc-proposed'").run(STAMP);
  aborts(db,insert,/CHECK/,...row('x','step-pending',1,'req-pending','manager','hr','unqualified','esc-proposed'));
  db.prepare(insert).run(...row('e1','step-pending',1,'req-pending','manager','hr','timeout','esc-proposed'));
  aborts(db,insert,/UNIQUE|present decider/,...row('e1b','step-pending',1,'req-pending','manager','it','admin_override',null,'admin'));
  // الدرجة الثانية تنطلق ممن وصله القرار لا من المعتمد الأصلي، ولا تعود إلى أحد مرّ به.
  aborts(db,insert,/present decider/,...row('x','step-pending',2,'req-pending','manager','it','admin_override',null,'admin'));
  aborts(db,insert,/already passed|present decider/,...row('x','step-pending',2,'req-pending','hr','manager','admin_override',null,'admin'));
  db.prepare(insert).run(...row('e2','step-pending',2,'req-pending','hr','it','admin_override',null,'admin'));
  aborts(db,insert,/already passed/,...row('x','step-pending',3,'req-pending','it','hr','admin_override',null,'admin'));
  aborts(db,"UPDATE approval_step_escalations SET to_user_id='it' WHERE id='e1'",/written once/);
  aborts(db,"DELETE FROM approval_step_escalations WHERE id='e1'",/retained/);
  // معتمد الخطوة نفسه يبقى كما كان: التصعيد صفوف بجانبه لا تعديل عليه.
  assert.equal(db.prepare("SELECT approver_id FROM approval_steps WHERE id='step-pending'").get().approver_id,'manager');
  assert.deepEqual(db.prepare("SELECT level,from_user_id,to_user_id FROM approval_step_escalations WHERE step_id='step-pending' ORDER BY level").all().map(r=>({...r})),
    [{level:1,from_user_id:'manager',to_user_id:'hr'},{level:2,from_user_id:'hr',to_user_id:'it'}]);
});

test('migration 126: an assignment event carries a reason, names where the work went, and is kept',t=>{
  const {path}=pre126(t),db=openDb(path);t.after(()=>db.close());
  const insert='INSERT INTO request_assignment_events(id,tenant_id,request_id,kind,from_user_id,to_user_id,handling_department_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)';
  const reason='سبب مصطنع لاختبار قيود أحداث الإسناد';
  aborts(db,insert,/CHECK/,'e0','36t','req-running','reassigned','hr',null,'hr',reason,'manager',STAMP);
  aborts(db,insert,/CHECK/,'e0','36t','req-running','released','hr','it','hr',reason,'hr',STAMP);
  aborts(db,insert,/CHECK/,'e0','36t','req-running','released','hr',null,'hr','قصير','hr',STAMP);
  aborts(db,insert,/CHECK/,'e0','36t','req-running','released','hr',null,'hr',reason,null,STAMP);
  aborts(db,insert,/CHECK/,'e0','36t','req-running','reassigned','hr','hr','hr',reason,'manager',STAMP);
  aborts(db,insert,/own requester/,'e0','36t','req-running','reassigned','hr','employee','hr',reason,'manager',STAMP);
  aborts(db,insert,/FOREIGN KEY/,'e0','isolated','req-running','released','hr',null,null,reason,'hr',STAMP);
  aborts(db,insert,/FOREIGN KEY/,'e0','36t','req-running','released','hr',null,'other',reason,'hr',STAMP);
  db.prepare(insert).run('e1','36t','req-running','departure','hr',null,'hr',reason,null,STAMP);
  db.prepare(insert).run('e2','36t','req-running','admin_override','hr','it',null,reason,'admin',STAMP);
  aborts(db,"UPDATE request_assignment_events SET reason='سبب آخر مصطنع بعد الكتابة' WHERE id='e1'",/written once/);
  aborts(db,"DELETE FROM request_assignment_events WHERE id='e1'",/retained/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_assignment_events').get().n,2);
});

test('migration 126: a request lapses only while returned, on the adopted expiry timer, after at least its value, and after its owner was reminded',t=>{
  const {path}=pre126(t),db=openDb(path);t.after(()=>db.close());
  const insert='INSERT INTO request_lapses(request_id,tenant_id,revision,returned_at,returned_by,reminded_at,waited_days,timer_row_id,lapsed_at) VALUES(?,?,?,?,?,?,?,?,?)';
  aborts(db,insert,/FOREIGN KEY|lapses only/,'req-returned','36t',1,STAMP,'manager',LATER,12,'no-such-timer',LAST);
  db.prepare(TIMER).run(...timerRow('exp','returned_expiry',10));
  aborts(db,insert,/lapses only/,'req-returned','36t',1,STAMP,'manager',LATER,12,'exp',LAST);
  db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='manager',adopted_at=? WHERE id='exp'").run(STAMP);
  aborts(db,insert,/lapses only/,'req-returned','36t',1,STAMP,'manager',LATER,9,'exp',LAST);
  aborts(db,insert,/lapses only/,'req-pending','36t',1,STAMP,'manager',LATER,12,'exp',LAST);
  aborts(db,insert,/lapses only/,'req-returned','36t',2,STAMP,'manager',LATER,12,'exp',LAST);
  // لا انقضاء قبل تذكير: لحظة التذكير تسبق لحظة الانقضاء وتلي الإعادة.
  aborts(db,insert,/CHECK/,'req-returned','36t',1,STAMP,'manager',LAST,12,'exp',LAST);
  aborts(db,insert,/CHECK/,'req-returned','36t',1,LATER,'manager',STAMP,12,'exp',LAST);
  adoptedTimer(db,'wrong-key','approval_escalation',2);
  aborts(db,insert,/lapses only/,'req-returned','36t',1,STAMP,'manager',LATER,12,'wrong-key',LAST);
  db.prepare(insert).run('req-returned','36t',1,STAMP,'manager',LATER,12,'exp',LAST);
  aborts(db,insert,/UNIQUE|PRIMARY/,'req-returned','36t',1,STAMP,'manager',LATER,12,'exp',LAST);
  aborts(db,"UPDATE request_lapses SET waited_days=99 WHERE request_id='req-returned'",/written once/);
  aborts(db,"DELETE FROM request_lapses WHERE request_id='req-returned'",/retained/);
});

test('migration 126: an undeliverable notice keeps what was tried and no notice text, and a resolution is a second row',t=>{
  const {path}=pre126(t),db=openDb(path);t.after(()=>db.close());
  const columns=db.prepare("SELECT name FROM pragma_table_info('undeliverable_notices')").all().map(c=>c.name);
  assert.equal(columns.some(c=>['title','body','text','payload'].includes(c)),false,'whoever reads this table manages the structure and does not read requests');
  const insert='INSERT INTO undeliverable_notices(id,tenant_id,kind,subject_kind,subject_id,intended_user_id,department_id,tried,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)';
  const reason='لا مدير للإدارة ولا مرجع تصعيد نشط يستلم الإشعار';
  aborts(db,insert,/CHECK/,'n0','36t','timesheet_submitted','timesheet','ts-1',null,'creative','not json',reason,STAMP);
  aborts(db,insert,/CHECK/,'n0','36t','timesheet_submitted','timesheet','ts-1',null,'creative','[]','قصير',STAMP);
  aborts(db,insert,/FOREIGN KEY/,'n0','36t','timesheet_submitted','timesheet','ts-1','external','creative','[]',reason,STAMP);
  db.prepare(insert).run('n1','36t','timesheet_submitted','timesheet','ts-1',null,'creative','[{"step":"department_head","outcome":"none"}]',reason,STAMP);
  aborts(db,"UPDATE undeliverable_notices SET reason='سبب آخر مصطنع بعد الكتابة' WHERE id='n1'",/written once/);
  aborts(db,"DELETE FROM undeliverable_notices WHERE id='n1'",/retained/);
  const resolve='INSERT INTO undeliverable_notice_resolutions(notice_id,tenant_id,resolved_by,note,resolved_at) VALUES(?,?,?,?,?)';
  aborts(db,resolve,/CHECK/,'n1','36t','admin','قصير',LATER);
  aborts(db,resolve,/FOREIGN KEY/,'missing','36t','admin','عُيّن مدير للإدارة التجريبية',LATER);
  db.prepare(resolve).run('n1','36t','admin','عُيّن مدير للإدارة التجريبية',LATER);
  aborts(db,resolve,/UNIQUE|PRIMARY/,'n1','36t','admin','قرار ثانٍ على الإشعار نفسه',LATER);
  aborts(db,"UPDATE undeliverable_notice_resolutions SET note='ملاحظة أخرى مصطنعة بعد الكتابة' WHERE notice_id='n1'",/written once/);
  aborts(db,"DELETE FROM undeliverable_notice_resolutions WHERE notice_id='n1'",/retained/);
});
