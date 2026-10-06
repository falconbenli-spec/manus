import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { runReport, reportsIndex, exportReport } from '../app/reports.mjs';
import { addDependant, benefitsBoard, enrolmentAction, recordEnrolment, recordMedicalPolicy, removeDependant, updateMedicalPolicy } from '../app/benefits.mjs';
import { benefitsUI } from '../app/static/leave-benefits-ui.mjs';

const code=expected=>error=>error.code===expected;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// تاريخ ميلاد مصطنع مميز، نتتبعه في التقارير والتصدير وسجل التدقيق لنثبت أنه لا يظهر في أي منها.
const DEPENDANT_BIRTH='2015-04-11';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-benefits');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const policy=(overrides={},who='hr')=>transaction(db,()=>recordMedicalPolicy(db,users[who],{
    insurer_name:'شركة تأمين مصطنعة للاختبار',policy_number:'SYN-0001',effective_from:day(-200),effective_to:day(200),
    tiers:['فئة أ مصطنعة','فئة ب مصطنعة'],renewal_notice_days:30,note:'وثيقة اختبار محلية لا وجود لها لدى أي شركة',...overrides})).id;
  const enrol=(overrides={},who='hr')=>transaction(db,()=>recordEnrolment(db,users[who],{policy_id:overrides.policy_id,employee_id:'employee',tier:'فئة أ مصطنعة',requested_on:day(-10),...overrides})).id;
  const act=(id,action,input,who='hr')=>transaction(db,()=>enrolmentAction(db,users[who],id,action,input));
  const dependant=(enrolmentId,overrides={},who='hr')=>transaction(db,()=>addDependant(db,users[who],{enrolment_id:enrolmentId,relation:'child',birth_date:DEPENDANT_BIRTH,added_on:day(-5),...overrides})).id;
  return {db,users,policy,enrol,act,dependant};
}

test('the medical policy is a record of what the insurer holds, and the screen says the platform is not connected to any insurer',t=>{
  const {db,users,policy}=fixture(t);
  const board=()=>benefitsBoard(db,users.hr);
  assert.deepEqual(board().policies,[]);
  assert.match(board().connection_note,/غير متصلة بشركة التأمين/);
  assert.match(board().note,/الإضافة والحذف يجريان لدى الشركة خارج المنصة/);
  for(const who of ['employee','manager','admin'])
    assert.throws(()=>transaction(db,()=>recordMedicalPolicy(db,users[who],{insurer_name:'شركة',policy_number:'X-1',effective_from:day(-1),effective_to:day(1),tiers:['فئة'],renewal_notice_days:30,note:''})),code('not_permitted'),who);
  const id=policy();
  const recorded=board().policies[0];
  assert.deepEqual(recorded.tiers,['فئة أ مصطنعة','فئة ب مصطنعة']);
  assert.equal(recorded.expired,false);assert.equal(recorded.expiring,false);
  assert.throws(()=>policy(),code('policy_exists'));
  assert.throws(()=>transaction(db,()=>updateMedicalPolicy(db,users.hr,id,{version:9,insurer_name:'شركة أخرى',policy_number:'SYN-0001',effective_from:day(-200),effective_to:day(20),tiers:['فئة أ مصطنعة','فئة ب مصطنعة'],renewal_notice_days:30,note:''})),code('stale_version'));
  transaction(db,()=>updateMedicalPolicy(db,users.hr,id,{version:1,insurer_name:'شركة تأمين مصطنعة للاختبار',policy_number:'SYN-0001',effective_from:day(-200),effective_to:day(20),tiers:['فئة أ مصطنعة','فئة ب مصطنعة'],renewal_notice_days:30,note:''}));
  assert.equal(board().policies[0].expiring,true,'the notice window is the one the user recorded, not a number in the code');
  assert.ok(board().alerts.some(a=>a.kind==='policy_expiring'));
  assert.throws(()=>db.prepare('DELETE FROM medical_policies WHERE id=?').run(id),/retained/);
  assert.equal(verifyAudit(db),true);
});

test('dependant data is third-party personal data: only the benefits capability reads it, and no report or export carries it',t=>{
  const {db,users,policy,enrol,dependant}=fixture(t);
  const policyId=policy(),enrolmentId=enrol({policy_id:policyId});
  dependant(enrolmentId);
  dependant(enrolmentId,{relation:'spouse',birth_date:'1992-02-02'});
  const holder=benefitsBoard(db,users.hr);
  assert.equal(holder.can_manage,true);
  assert.equal(holder.enrolments[0].dependants.length,2);
  assert.equal(holder.enrolments[0].dependants[0].birth_date,DEPENDANT_BIRTH);
  // لا الموظف صاحب التسجيل ولا مديره ولا الأدمن الأول يرى التابعين ولا عددهم.
  for(const who of ['employee','manager','admin','it','outsider']){
    const view=benefitsBoard(db,users[who]);
    assert.equal(view.can_manage,false,who);
    assert.equal(view.enrolments.every(x=>x.dependants===undefined),true,who);
    assert.equal(JSON.stringify(view).includes(DEPENDANT_BIRTH),false,who);
  }
  assert.equal(benefitsBoard(db,users.employee).enrolments.length,1,'the employee still sees their own enrolment and tier');
  // كل تقرير متاح لأي دور، حيًا ومصدَّرًا: لا أثر لبيانات التابعين في أي منه.
  let reports=0;
  for(const who of ['hr','admin','manager','employee']){
    for(const report of reportsIndex(db,users[who]).reports){
      const result=runReport(db,users[who],report.key,{from:day(-365),to:day(0)});reports++;
      const serialised=JSON.stringify(result)+exportReport(result,'csv').content.toString('utf8');
      assert.equal(serialised.includes(DEPENDANT_BIRTH),false,`${report.key} for ${who}`);
      assert.equal(/dependant|تابع/i.test(serialised),false,`${report.key} for ${who}`);
    }
  }
  assert.ok(reports>0,'reports were actually generated');
  // ولا وحدة أخرى في المنصة تستعلم عن جدول التابعين أصلًا.
  const readers=readdirSync(new URL('../app/',import.meta.url)).filter(f=>f.endsWith('.mjs')&&readFileSync(new URL('../app/'+f,import.meta.url),'utf8').includes('medical_dependants'));
  assert.deepEqual(readers,['benefits.mjs']);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM audit_events').all()).includes(DEPENDANT_BIRTH),false,'birth dates stay out of the shared audit trail');
  assert.equal(verifyAudit(db),true);
});

test('no medical information can be stored at all: the schema offers no column that would accept it',t=>{
  const {db,users,policy,enrol,dependant}=fixture(t);
  dependant(enrol({policy_id:policy()}));
  const columns=db.prepare('PRAGMA table_info(medical_dependants)').all().map(c=>c.name);
  assert.deepEqual(columns,['id','tenant_id','enrolment_id','relation','birth_date','added_on','removed_on','recorded_by','version','created_at']);
  assert.equal(columns.some(c=>/diagnos|claim|treat|health|medical|note|comment/i.test(c)),false,'a dependant row has no free-text field to hide health data in');
  const tables=['medical_policies','medical_enrolments','medical_dependants'].flatMap(table=>db.prepare(`PRAGMA table_info(${table})`).all().map(c=>`${table}.${c.name}`));
  assert.equal(tables.some(c=>/diagnos|claim|treatment|illness|disease|health/i.test(c)),false);
  assert.match(benefitsBoard(db,users.hr).privacy_note,/لا تُسجَّل هنا أي معلومة طبية/);
});

test('enrolment records an action taken at the insurer: never for yourself, never twice, and only in a tier of the policy',t=>{
  const {db,users,policy,enrol,act,dependant}=fixture(t);
  const policyId=policy();
  assert.throws(()=>enrol({policy_id:policyId,employee_id:'hr'}),code('separation_of_duties'));
  assert.throws(()=>enrol({policy_id:policyId,tier:'فئة غير موجودة'}),code('tier'));
  assert.throws(()=>enrol({policy_id:policyId,requested_on:day(1)}),code('future_date'));
  assert.throws(()=>enrol({policy_id:policyId,employee_id:'external'}),code('not_found'),'another tenant employee is out of reach');
  for(const who of ['employee','manager','admin'])assert.throws(()=>enrol({policy_id:policyId},who),code('not_permitted'),who);
  const enrolmentId=enrol({policy_id:policyId});
  assert.throws(()=>enrol({policy_id:policyId}),code('enrolment_exists'));
  assert.equal(benefitsBoard(db,users.hr).enrolments[0].status,'requested');
  assert.throws(()=>act(enrolmentId,'confirm_enrolment',{version:9,confirmed_on:day(-2),member_reference:'MEM-1'}),code('stale_version'));
  act(enrolmentId,'confirm_enrolment',{version:1,confirmed_on:day(-2),member_reference:'MEM-1'});
  assert.equal(benefitsBoard(db,users.hr).enrolments[0].status,'active');
  assert.throws(()=>act(enrolmentId,'confirm_enrolment',{version:2,confirmed_on:day(-1),member_reference:'MEM-2'}),code('action_unavailable'));
  const dependantId=dependant(enrolmentId);
  act(enrolmentId,'remove_enrolment',{version:2,removed_on:day(-1),reason:'انتهاء الخدمة في بيانات الاختبار'});
  assert.equal(benefitsBoard(db,users.hr).enrolments[0].status,'removed');
  assert.throws(()=>act(enrolmentId,'remove_enrolment',{version:3,removed_on:day(0),reason:'محاولة ثانية'}),code('enrolment_removed'));
  assert.throws(()=>dependant(enrolmentId),code('enrolment_removed'));
  assert.throws(()=>db.prepare("UPDATE medical_enrolments SET status='active',version=version+1 WHERE id=?").run(enrolmentId),/re-recorded, not edited/);
  assert.throws(()=>db.prepare('DELETE FROM medical_enrolments WHERE id=?').run(enrolmentId),/retained/);
  transaction(db,()=>removeDependant(db,users.hr,dependantId,{version:1,removed_on:day(0)}));
  assert.throws(()=>transaction(db,()=>removeDependant(db,users.hr,dependantId,{version:2,removed_on:day(0)})),code('already_removed'));
  assert.throws(()=>db.prepare('DELETE FROM medical_dependants WHERE id=?').run(dependantId),/retained/);
  assert.equal(verifyAudit(db),true);
});

test('the screen reminds what must be done at the insurer: nobody is added or removed by the platform itself',t=>{
  const {db,users,policy,enrol,act}=fixture(t);
  const policyId=policy();
  const before=benefitsBoard(db,users.hr);
  assert.ok(before.alerts.filter(a=>a.kind==='not_enrolled').length>=4,'every active employee starts uncovered');
  const enrolmentId=enrol({policy_id:policyId});
  act(enrolmentId,'confirm_enrolment',{version:1,confirmed_on:day(-2),member_reference:'MEM-1'});
  assert.equal(benefitsBoard(db,users.hr).alerts.some(a=>a.kind==='not_enrolled'&&a.employee_id==='employee'),false);
  // موظف غادر: الحساب أُوقف والتسجيل ما زال قائمًا لدى الشركة.
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();
  const leaver=benefitsBoard(db,users.hr).alerts.find(a=>a.kind==='leaver_enrolled');
  assert.ok(leaver&&leaver.employee_id==='employee');
  assert.match(leaver.message,/احذفه لدى شركة التأمين/);
  db.prepare("UPDATE users SET active=1 WHERE id='employee'").run();
  assert.throws(()=>{db.prepare("UPDATE users SET active=0 WHERE id='outsider'").run();return enrol({policy_id:policyId,employee_id:'outsider'});},code('inactive_employee'));
});

test('an isolated tenant account reads and writes nothing of the other tenant benefits',t=>{
  const {db,users,policy,enrol}=fixture(t);
  const policyId=policy();enrol({policy_id:policyId});
  const outside=benefitsBoard(db,users.external);
  assert.deepEqual(outside.policies,[]);assert.deepEqual(outside.enrolments,[]);assert.deepEqual(outside.alerts,[]);
  assert.equal(outside.can_manage,false);
  assert.throws(()=>transaction(db,()=>recordEnrolment(db,users.external,{policy_id:policyId,employee_id:'employee',tier:'فئة أ مصطنعة',requested_on:day(-1)})),code('not_permitted'));
});

test('the benefits screen renders for every role and every offered button opens a usable form',t=>{
  const {db,users,policy,enrol,dependant}=fixture(t);
  dependant(enrol({policy_id:policy()}));
  for(const who of ['hr','employee','manager','admin']){
    const data=benefitsBoard(db,users[who]),buttons=[];
    const html=benefitsUI.render(data,{e,button:(action,id,label)=>{buttons.push([action,id]);return `<button>${e(label)}</button>`;}});
    assert.equal(/\bundefined\b|\bNaN\b|\[object /.test(html.replace(/<[^>]+>/g,' ')),false,who);
    assert.equal(/ style=|<script/.test(html),false,'no inline styles and no scripts under the strict CSP');
    if(who!=='hr')assert.equal(html.includes(DEPENDANT_BIRTH),false,`${who} sees no dependant data on screen`);
    for(const [action,id] of buttons){
      const spec=benefitsUI.form(action,id,data);
      assert.ok(spec.title&&spec.endpoint&&Array.isArray(spec.fields)&&typeof spec.toPayload==='function',`${who}/${action}`);
    }
  }
});
