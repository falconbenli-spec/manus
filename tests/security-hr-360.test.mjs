import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createCycle, cycleAction } from '../app/talent.mjs';
import { review360Board, setUpwardThreshold, nominate, nominationAction, submit360 } from '../app/feedback.mjs';

// إثبات إغلاق ثغرات التقييم الصاعد (مراجعة الأمن 2026-09-18، الترحيل 091 القسم ج). كل البيانات مصطنعة.
const code=value=>error=>error.code===value;
const day=offset=>new Date(Date.now()+offset*86400000+3*3600000).toISOString().slice(0,10);
const S1={strengths:'نص الموظفة السري جدًا عن مديرها المباشر',improvements:'تحسين تكتبه الموظفة تحديدًا هنا'};
const S2={strengths:'نص الزميل الآخر عن مديره بوضوح وتفصيل',improvements:'تحسين يكتبه الزميل بتفصيل كاف'};
const S3={strengths:'نص العضو الثالث الذي ظن أنه مجهول تمامًا',improvements:'تحسين يكتبه العضو الثالث بالتفصيل'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-360');t.after(()=>db.close());
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'third',tenant_id,department_id,'third','عضو فريق ثالث تجريبي',password_hash,'employee','manager' FROM users WHERE id='employee'").run();
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const open=()=>{
    const c=tx(()=>createCycle(db,users.hr,{name:`دورة ${Math.random()}`,period_from:day(-120),period_to:day(30),scale_max:5,criteria:[{name:'جودة',weight:60},{name:'تعاون',weight:40}]}));
    tx(()=>cycleAction(db,users.hr,c.id,'open',{version:db.prepare('SELECT version FROM review_cycles WHERE id=?').get(c.id).version}));
    return c.id;
  };
  const approve=(cycleId,raterId)=>{
    const n=tx(()=>nominate(db,users.manager,{cycle_id:cycleId,subject_id:'manager',rater_id:raterId,source:'upward'}));
    tx(()=>nominationAction(db,users.hr,n.id,'approve_nomination',{version:db.prepare('SELECT version FROM review_360_nominations WHERE id=?').get(n.id).version,note:'الفريق المباشر كاملًا'}));
    return n.id;
  };
  const toCalibration=cycleId=>db.prepare("UPDATE review_cycles SET status='calibration',version=version+1 WHERE id=?").run(cycleId);
  const panel=(u,cycleId)=>review360Board(db,u).cycles.find(c=>c.id===cycleId).panels.find(p=>p.subject_id==='manager');
  const threshold=(min)=>tx(()=>setUpwardThreshold(db,users.hr,{min_upward_respondents:min,basis:`قرار مدير الموارد البشرية التجريبي بحد ${min}`,confirmed_on:day(0)}));
  return {db,users,tx,open,approve,toCalibration,panel,threshold};
}

test('360 linkage: an answer carries no time, no date, no rowid and no nomination; the submission mark carries the day only, so no join names a writer',t=>{
  const {db,users,tx,open,approve}=fixture(t);
  const cycleId=open();
  const n1=approve(cycleId,'employee'),n2=approve(cycleId,'outsider');
  tx(()=>submit360(db,users.employee,n1,S1));
  tx(()=>submit360(db,users.outsider,n2,S2));
  const columns=db.prepare('PRAGMA table_info(review_360_answers)').all().map(c=>c.name);
  assert.deepEqual(columns,['id','tenant_id','cycle_id','subject_id','source','strengths','improvements']);
  assert.ok(!columns.some(c=>/time|date|_at|_on|rater|nomination|user|actor/.test(c)),`an answer carries an identifying column: ${columns}`);
  assert.throws(()=>db.prepare('SELECT rowid FROM review_360_answers').all(),/no such column/,'answers have no insertion order to align with the audit trail');
  assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='review_360_responses'").get().type,'view','the old table that stored the instant is gone');
  assert.ok(!db.prepare('PRAGMA table_info(review_360_responses)').all().some(c=>c.name==='submitted_at'));
  for(const row of db.prepare('SELECT submitted_at FROM review_360_submissions').all())assert.match(row.submitted_at,/^\d{4}-\d{2}-\d{2}$/,'the submission mark is the day, not the instant');
  assert.throws(()=>db.prepare("INSERT INTO review_360_submissions(nomination_id,submitted_at) VALUES('x','2026-09-18T10:00:00.000Z')").run(),/day, never the instant/);
  // أوسع ربط ممكن بين نص ومقيِّم: الدورة والمقيَّم فقط، فيعود كل نص لكل من أجاب لا لواحد.
  const reach=db.prepare(`SELECT r.strengths,COUNT(DISTINCT n.rater_id) AS raters FROM review_360_answers r
    JOIN review_360_nominations n ON n.cycle_id=r.cycle_id AND n.subject_id=r.subject_id AND n.source=r.source
    JOIN review_360_submissions s ON s.nomination_id=n.id GROUP BY r.id`).all();
  assert.deepEqual(reach.map(r=>r.raters),[2,2],'every answer resolves to the whole panel, never to one rater');
  // سجل التدقيق يحفظ من أرسل ومتى، لكن لا شيء في جدول الاستجابات يُرتَّب به ليطابق ذلك الترتيب.
  const audited=db.prepare("SELECT actor_id,after_json FROM audit_events WHERE action='review_360.submitted' ORDER BY seq").all();
  assert.deepEqual(audited.map(a=>a.actor_id),['employee','outsider']);
  for(const a of audited)assert.equal(a.after_json,'{"source":"upward"}','the audit event carries no text, no answer id');
  assert.ok(verifyAudit(db));
});

test('360 reading: no upward text while the cycle is open (no differencing between two reads), and a rater holding hr.feedback.manage never reads the panel',t=>{
  const {db,users,tx,open,approve,toCalibration,panel,threshold}=fixture(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'outsider',capability:'hr.feedback.manage',department_id:null,note:'منسق موارد بشرية تجريبي'}));
  threshold(3);
  const cycleId=open();
  const n1=approve(cycleId,'employee'),n2=approve(cycleId,'outsider'),n3=approve(cycleId,'third');
  tx(()=>submit360(db,users.employee,n1,S1));tx(()=>submit360(db,users.outsider,n2,S2));
  const first=panel(users.hr,cycleId);
  assert.deepEqual(first.results.upward,[],'nothing is read while the cycle collects answers');
  assert.match(first.results.upward_note,/قبل انتقال الدورة إلى المعايرة/);
  tx(()=>submit360(db,users.third,n3,S3));
  assert.deepEqual(panel(users.hr,cycleId).results.upward,[],'a read after one more submission shows nothing new to subtract');
  assert.deepEqual(panel(users.manager,cycleId).results,null,'the subject waits for calibration');
  // المنسق مقيِّم في اللوحة: لا يقرأ نتائجها ولا في المعايرة.
  toCalibration(cycleId);
  const rater=panel(users.outsider,cycleId);
  assert.equal(rater.results,null,'a rater holding hr.feedback.manage never reads the panel they rated in');
  assert.match(rater.results_note,/أنت مقيِّم في هذه اللوحة/);
  const hr=panel(users.hr,cycleId);
  assert.equal(hr.results.upward.length,3,'HR, who rated nobody, reads the aggregate once collection has ended');
  assert.ok(verifyAudit(db));
});

test('360 threshold: floor of three in code and in SQL, pinned into the cycle when it opens, and a later change never reopens a cycle collected under a higher promise',t=>{
  const {db,users,tx,open,approve,toCalibration,panel,threshold}=fixture(t);
  assert.throws(()=>threshold(2),code('min_upward_respondents'));
  assert.throws(()=>db.prepare("INSERT INTO review_360_settings(id,tenant_id,min_upward_respondents,basis,confirmed_on,set_by,created_at) VALUES('s2','36t',2,'حد اثنين مباشر في القاعدة',?,'hr',?)").run(day(0),day(0)),/at least three/);
  threshold(5);
  const cycleId=open();
  assert.equal(db.prepare('SELECT min_upward_respondents FROM review_360_cycle_thresholds WHERE cycle_id=?').get(cycleId).min_upward_respondents,5,'the promise in force is pinned when the cycle opens');
  const n1=approve(cycleId,'employee'),n2=approve(cycleId,'outsider'),n3=approve(cycleId,'third');
  tx(()=>submit360(db,users.employee,n1,S1));tx(()=>submit360(db,users.outsider,n2,S2));tx(()=>submit360(db,users.third,n3,S3));
  threshold(3);
  toCalibration(cycleId);
  const p=panel(users.hr,cycleId);
  assert.deepEqual(p.results.upward,[],'lowering the setting to 3 does not reveal three answers collected under a promise of 5');
  assert.equal(p.results.upward_threshold,5);
  assert.throws(()=>db.prepare('UPDATE review_360_cycle_thresholds SET min_upward_respondents=3 WHERE cycle_id=?').run(cycleId),/never changed/);
  // دورة فُتحت بلا إعداد: أول إعداد يُثبَّت فيها، وخفضه بعدها لا يمسها.
  const t2=fixture(t);
  const c2=t2.open();
  assert.equal(t2.db.prepare('SELECT 1 FROM review_360_cycle_thresholds WHERE cycle_id=?').get(c2),undefined);
  t2.threshold(4);t2.threshold(3);
  assert.equal(t2.db.prepare('SELECT min_upward_respondents FROM review_360_cycle_thresholds WHERE cycle_id=?').get(c2).min_upward_respondents,4);
  assert.ok(verifyAudit(db));
});

test('360 migration 091: answers collected before it move to the new table without their instant, the old table is dropped, and an open cycle is pinned at no less than three',t=>{
  const directory=mkdtempSync(join(tmpdir(),'36t-sec360-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'pre091.sqlite'),raw=new DatabaseSync(path);
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec('PRAGMA foreign_keys=ON');raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=91)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));
  }
  seed(raw,'synthetic-pre-091');
  const stamp='2026-09-17T21:30:00.000Z';
  raw.prepare("INSERT INTO review_cycles(id,tenant_id,name,period_from,period_to,scale_max,criteria,status,created_by,opened_at,created_at,updated_at) VALUES('cyc','36t','دورة قبل الترحيل','2026-01-01','2026-12-31',5,'[]','open','hr',?,?,?)").run(stamp,stamp,stamp);
  raw.prepare("INSERT INTO review_360_settings(id,tenant_id,min_upward_respondents,basis,confirmed_on,set_by,created_at) VALUES('set','36t',2,'حد اثنين قديم قبل الترحيل','2026-01-01','hr',?)").run(stamp);
  raw.prepare("INSERT INTO review_360_nominations(id,tenant_id,cycle_id,subject_id,rater_id,source,nominated_by,status,decided_by,decided_at,decision_note,created_at) VALUES('nom','36t','cyc','manager','employee','upward','manager','approved','hr',?,'اعتماد تجريبي قديم',?)").run(stamp,stamp);
  raw.prepare("INSERT INTO review_360_responses(id,tenant_id,cycle_id,subject_id,source,strengths,improvements,submitted_at) VALUES('old-1','36t','cyc','manager','upward',?,?,?)").run(S1.strengths,S1.improvements,stamp);
  raw.prepare("INSERT INTO review_360_submissions(nomination_id,submitted_at) VALUES('nom',?)").run(stamp);
  raw.close();
  const db=openDb(path);t.after(()=>db.close());
  const moved=db.prepare('SELECT * FROM review_360_answers').all();
  assert.equal(moved.length,1);assert.equal(moved[0].strengths,S1.strengths);
  assert.notEqual(moved[0].id,'old-1','the migrated answer gets a fresh random key, unlinked to its old row');
  assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='review_360_responses'").get().type,'view');
  assert.equal(db.prepare("SELECT submitted_at FROM review_360_submissions WHERE nomination_id='nom'").get().submitted_at,'2026-09-18','the old instant is cut to its Riyadh day');
  assert.equal(db.prepare("SELECT min_upward_respondents FROM review_360_cycle_thresholds WHERE cycle_id='cyc'").get().min_upward_respondents,3,'a cycle opened under a threshold of 2 is pinned at the floor of 3');
});
