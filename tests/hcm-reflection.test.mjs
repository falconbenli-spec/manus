import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { HCM_FEATURES, hcmCoverage } from '../app/hcm-reference.mjs';
import { hrTeamAccessBoard, setHrTeamAccess } from '../app/hr-team-access.mjs';
import { operationsBoard } from '../app/hr-operations.mjs';
import { hrOperationsUI } from '../app/static/hr-operations-ui.mjs';

const code=value=>error=>error?.code===value;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hcm-reflection');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-head','36t','hr','hr-head','مدير رأس المال البشري المصطنع','unused','manager',NULL); INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-operator','36t','hr','hr-operator','موظف موارد بشرية مصطنع','unused','employee','hr-head'),('finance-operator','36t','creative','finance-operator','موظف خارج الموارد البشرية مصطنع','unused','employee',NULL)");
  const users=()=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(row=>[row.id,row]));
  const tx=fn=>transaction(db,fn);
  return {db,users,tx};
}

test('كل مسارات منصة HCM المرجعية ممثلة مرة واحدة وبحالة صريحة',()=>{
  const expected=['/','/core-hrm','/recruitment','/onboarding','/attendance','/leave','/manager-leave-calendar','/payroll','/performance','/learning','/career','/engagement','/analytics','/compliance','/settings','/activity-log','/zoho-integration','/weekly-report','/employee-portal','/employee-passwords','/hr-approvals','/org-chart','/work-requests','/projects','/performance-eval','/self-service','/expenses','/surveys','/documents','/skills-matrix','/ai-assistant','/recognition','/notifications','/wellness','/knowledge-base','/okrs','/gamification','/workflow','/recruitment-pipeline','/onboarding-journey','/advanced-analytics','/engagement-hub','/learning-hub','/privacy','/my-tasks','/task-reports','/reports-center','/department-reports','/government','/email-management','/announcements'];
  assert.deepEqual(HCM_FEATURES.map(row=>row.source_path),expected);
  assert.equal(new Set(HCM_FEATURES.map(row=>row.source_path)).size,51);
  assert.ok(HCM_FEATURES.every(row=>['native','merged','restricted','external'].includes(row.status)));
  assert.ok(HCM_FEATURES.every(row=>row.current_routes.length||['restricted','external'].includes(row.status)));
});

test('مدير رأس المال البشري يرى تغطية HCM وفريقه بينما يرى الموظف صلاحياته فقط',t=>{
  const {db,users}=fixture(t);
  const head=hrTeamAccessBoard(db,users()['hr-head']);
  const worker=hrTeamAccessBoard(db,users()['hr-operator']);
  assert.equal(head.can_manage,true);
  assert.ok(head.members.some(row=>row.id==='hr-operator'));
  assert.equal(worker.can_manage,false);
  assert.deepEqual(worker.members,[]);
  assert.ok(worker.mine.capabilities.some(row=>row.key==='people.manage'&&row.source==='unavailable'));
  const coverage=hcmCoverage(db,users()['hr-head']);
  assert.equal(coverage.total,51);
  assert.ok(coverage.features.find(row=>row.source_path==='/core-hrm'));
  assert.ok(coverage.features.find(row=>row.source_path==='/payroll'));
  assert.ok(coverage.features.some(row=>row.source_path==='/employee-passwords'&&row.status==='restricted'));
  assert.ok(coverage.features.some(row=>row.source_path==='/zoho-integration'&&row.status==='external'));
});

test('مدير رأس المال البشري يمنح ويسحب الحزمة التشغيلية المخصصة مع تدقيق وإلغاء الجلسات',t=>{
  const {db,users,tx}=fixture(t);
  db.prepare("INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen,address) VALUES('t','hr-operator','c',9999999999999,1,'test')").run();
  tx(()=>setHrTeamAccess(db,users()['hr-head'],{user_id:'hr-operator',mode:'custom',capability_keys:['people.manage','hr.operations.use','hr.compensation.review'],note:'تكليف الموظف بملفات التوظيف ومركز التشغيل ومراجعة التعويضات'}));
  let board=hrTeamAccessBoard(db,users()['hr-head']);
  let member=board.members.find(row=>row.id==='hr-operator');
  assert.ok(member.capabilities.find(row=>row.key==='people.manage').selected);
  assert.ok(member.capabilities.find(row=>row.key==='hr.operations.use').selected);
  assert.ok(member.capabilities.find(row=>row.key==='hr.compensation.review').selected);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='hr-operator'").get().n,0);
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_type='hr_team_access' AND entity_id='hr-operator' AND action='hr.team_access_changed'").get());
  tx(()=>setHrTeamAccess(db,users()['hr-head'],{user_id:'hr-operator',mode:'custom',capability_keys:['hr.operations.use'],note:'إعادة نطاق العمل إلى مركز عمليات الموارد البشرية فقط'}));
  board=hrTeamAccessBoard(db,users()['hr-head']);member=board.members.find(row=>row.id==='hr-operator');
  assert.equal(member.capabilities.find(row=>row.key==='people.manage').selected,false);
  assert.equal(member.capabilities.find(row=>row.key==='hr.operations.use').selected,true);
  assert.ok(verifyAudit(db));
});

test('المدير لا يمنح قرارات الاعتماد ولا يستهدف خارج الموارد البشرية ولا يكتب جزءًا من طلب مرفوض',t=>{
  const {db,users,tx}=fixture(t);
  const before=()=>db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE user_id='hr-operator' AND revoked_at IS NULL").get().n;
  assert.throws(()=>tx(()=>setHrTeamAccess(db,users()['hr-head'],{user_id:'finance-operator',mode:'custom',capability_keys:['people.manage'],note:'محاولة خارج الإدارة'})),code('target_scope'));
  assert.throws(()=>tx(()=>setHrTeamAccess(db,users()['hr-head'],{user_id:'hr-operator',mode:'custom',capability_keys:['people.manage','payroll.approve'],note:'محاولة جمع التشغيل والقرار'})),code('capability_not_delegable'));
  assert.equal(before(),0);
});

test('منح الأدمن الأول يبقى مقفلاً ولا يسحبه مدير الموارد البشرية',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>grantAccess(db,users().admin,{user_id:'hr-operator',capability:'privacy.manage',department_id:null,note:'منح مستقل من أدمن المنصة'}));
  let member=hrTeamAccessBoard(db,users()['hr-head']).members.find(row=>row.id==='hr-operator');
  const privacy=member.capabilities.find(row=>row.key==='privacy.manage');
  assert.equal(privacy.selected,true);assert.equal(privacy.locked,true);
  tx(()=>setHrTeamAccess(db,users()['hr-head'],{user_id:'hr-operator',mode:'custom',capability_keys:[],note:'إزالة منح مدير الموارد البشرية فقط'}));
  member=hrTeamAccessBoard(db,users()['hr-head']).members.find(row=>row.id==='hr-operator');
  assert.equal(member.capabilities.find(row=>row.key==='privacy.manage').selected,true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE user_id='hr-operator' AND capability='privacy.manage' AND revoked_at IS NULL").get().n,1);
});

test('واجهة مركز الموارد البشرية تعرض خريطة HCM ونموذج الصلاحيات الشامل والمخصص',t=>{
  const {db,users}=fixture(t),data=operationsBoard(db,users()['hr-head']);
  const html=hrOperationsUI.render(data,{e:value=>String(value),button:(action,id,label)=>`<button data-action="${action}" data-id="${id}">${label}</button>`});
  assert.match(html,/خدمات HCM داخل 3,6T/);
  assert.match(html,/51/);
  assert.match(html,/صلاحيات فريق رأس المال البشري/);
  assert.match(html,/manage_team_access/);
  const form=hrOperationsUI.form('manage_team_access','hr-operator',data);
  assert.equal(form.endpoint,'/hr/team-access');
  assert.ok(form.fields.some(row=>row.name==='mode'&&row.options.some(option=>option.value==='comprehensive')));
  assert.ok(form.fields.some(row=>row.name==='capability_keys'&&row.type==='checks'));
});
