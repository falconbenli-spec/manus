import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { listApprovals, getApproval, registerApprover, revokeApprover, recordApproval, approvalAction } from '../app/client-approvals.mjs';

const code=value=>error=>error.code===value;
const brief={objective:'هدف تجريبي قابل للمراجعة',audience:'جمهور مصطنع للمشروع',audience_basis:'افتراض محلي معلن؛ لم يجر بحث ميداني',message:'رسالة الاختبار المعتمدة',prohibited_messages:'منع الادعاءات الطبية والوعود غير المسندة',kpi:'عدد استكمال نموذج الاهتمام',measurement_source:'سجل تجريبي محلي',channels:['instagram'],scope:'مخرج نصي واحد للاختبار'};
const output=assetId=>({title:'منشور الإطلاق المصطنع',channel:'instagram',format:'نص تجريبي',dimensions:'مربع موصوف 1080×1080',language:'العربية',brand_reference:'ATHAR-DEMO',acceptance:'مطابقة الرسالة',content:'محتوى عربي مصطنع للمراجعة.',asset_ids:[assetId]});
const quality={brand:'passed',language:'passed',claims:'passed',accessibility:'passed',specification:'passed'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-client-approvals');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'employee',capability:'approvals.record',note:'مسؤولة الحساب في الاختبار'}));
  const project=transaction(db,()=>createProject(db,users.manager,{name:'حساب العميل أ (مصطنع)',brief:'اختبار توثيق الموافقة الخارجية',member_ids:['employee']}));
  const other=transaction(db,()=>createProject(db,users.manager,{name:'حساب العميل ب (مصطنع)',brief:'مشروع لا تنتمي إليه الموظفة',member_ids:['outsider']}));
  const act=(who,s,action,input={})=>transaction(db,()=>studioAction(db,users[who],s.id,action,{version:s.version,...input}));
  let s=transaction(db,()=>createStudio(db,users.employee,{project_id:project.id,title:'مساحة تسليم مصطنعة',...brief}));
  s=act('manager',act('employee',s,'submit_brief'),'approve_brief',{note:'راجعنا الهدف والرسالة'});
  s=act('employee',s,'add_asset',{name:'أصل نصي مصطنع',internal_reference:'ASSET_1',rights_holder:'صاحب حق مصطنع',rights_basis:'owned',rights_evidence:'إفادة ملكية داخلية مصطنعة',valid_from:'2020-01-01',valid_until:'2099-12-31',channels:['instagram']});
  s=act('manager',s,'inspect_asset',{asset_id:s.assets[0].id,outcome:'passed',evidence:'إفادة فحص الحقوق والقنوات والمدة'});
  s=act('employee',s,'create_output',output(s.assets[0].id));
  const outputId=s.outputs[0].id,first=s.outputs[0].current_version_id;
  // النسخة الأولى تُعاد، والثانية تُعتمد داخليًا.
  s=act('manager',act('employee',s,'submit_output',{output_id:outputId}),'return_output',{output_id:outputId,note:'عدّل صياغة الدعوة إلى الإجراء'});
  s=act('employee',s,'save_output',{output_id:outputId,...output(s.assets[0].id),content:'محتوى عربي مصطنع بعد التعديل.'});
  s=act('manager',act('employee',s,'submit_output',{output_id:outputId}),'approve_output',{output_id:outputId,note:'اجتازت النسخة فحوص الجودة',quality_checks:quality});
  const second=s.outputs[0].current_version_id;
  const approver=(overrides={})=>transaction(db,()=>registerApprover(db,users.employee,{project_id:project.id,name:'مفوضة العميل المصطنعة',title:'مديرة التسويق لدى العميل',authority_basis:'البند 7 من العقد المصطنع يسميها مفوضة باعتماد المحتوى',authority_scope:'اعتماد محتوى القنوات الاجتماعية',valid_from:'2026-01-01',...overrides})).id;
  const record=(overrides={},who='employee')=>{const {id}=transaction(db,()=>recordApproval(db,users[who],{output_version_id:second,decision:'approved',scope_note:'وافقت على النص والصورة للنشر على إنستغرام فقط',channel:'email',received_on:'2026-09-01',evidence_reference:'بريد مصطنع محفوظ في مجلد الحساب بتاريخ 2026-09-01',...overrides}));return getApproval(db,users[who],id);};
  const act2=(who,r,action,input)=>transaction(db,()=>approvalAction(db,users[who],r.id,action,{version:r.version,...input}));
  return {db,users,project,other,first,second,approver,record,act2};
}

test('criterion 22: an employee-recorded client approval keeps recorder, authorised person, version and evidence, and never claims a client signature',t=>{
  const {db,users,second,approver,record,act2}=fixture(t);
  const before=db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const approverId=approver();
  let r=record({approver_id:approverId});
  assert.equal(r.status,'documented');
  assert.equal(r.recorded_by,'employee');assert.equal(r.output_version_id,second);assert.equal(r.output_revision,2);
  assert.equal(r.approver.name,'مفوضة العميل المصطنعة');
  assert.match(r.disclaimer,/ليست توقيعًا إلكترونيًا/);
  assert.equal(r.applies_to_current,true);
  // من وثّق لا يتحقق من توثيقه، ومن لا يحمل تصريح التحقق لا يتحقق.
  assert.throws(()=>act2('employee',r,'verify',{note:'طابقت البريد مع النسخة'}),code('action_unavailable'));
  r=act2('manager',getApproval(db,users.manager,r.id),'verify',{note:'طابقت مرسل البريد وتاريخه ونص الموافقة مع النسخة الثانية'});
  assert.equal(r.status,'verified');assert.equal(r.verified_by,'manager');
  assert.throws(()=>db.prepare("UPDATE external_approvals SET decision='rejected',version=version+1 WHERE id=?").run(r.id),/keeps its content/);
  assert.throws(()=>db.prepare('DELETE FROM external_approvals WHERE id=?').run(r.id),/retained/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,before,'no client login is created');
  assert.ok(verifyAudit(db));
});

test('evidence states: without a reference the record waits for evidence; a phone decision needs a written confirmation',t=>{
  const {approver,record,act2}=fixture(t);
  const approverId=approver();
  assert.throws(()=>record({approver_id:approverId,channel:'call',evidence_reference:''}),code('evidence_required'));
  let r=record({approver_id:approverId,channel:'meeting_minutes',evidence_reference:''});
  assert.equal(r.status,'pending_evidence');assert.deepEqual(r.actions,['add_evidence','withdraw']);
  r=act2('employee',r,'add_evidence',{evidence_reference:'محضر اجتماع مصطنع موقع من الطرفين ومحفوظ في مجلد الحساب'});
  assert.equal(r.status,'documented');
  r=act2('employee',r,'withdraw',{reason:'سُجل القرار على مخرج خاطئ؛ سيعاد توثيقه'});
  assert.equal(r.status,'withdrawn');assert.equal(r.applies_to_current,false);assert.deepEqual(r.actions,[]);
});

test('criteria 2 and 3: approval is tied to an internally approved version, and a revoked approver cannot approve later while earlier decisions stay',t=>{
  const {db,users,first,approver,record}=fixture(t);
  const approverId=approver();
  assert.throws(()=>record({approver_id:approverId,output_version_id:first}),code('internal_approval_required'));
  const early=record({approver_id:approverId,received_on:'2026-09-01'});
  transaction(db,()=>revokeApprover(db,users.employee,approverId,{reason:'أبلغ العميل بانتقال المفوضة إلى إدارة أخرى',revoked_on:'2026-09-10'}));
  assert.throws(()=>record({approver_id:approverId,received_on:'2026-09-12'}),code('approver_not_authorized'));
  assert.throws(()=>record({approver_id:approverId,received_on:'2025-12-31'}),code('approver_not_authorized'));
  // قرار ورد قبل السحب يبقى قابلًا للتوثيق ومحفوظًا بهوية المفوضة وقتها.
  const late=record({approver_id:approverId,received_on:'2026-09-05',decision:'approved_with_conditions',scope_note:'موافقة بشرط تغيير الوسم قبل النشر'});
  assert.equal(late.approver.title,'مديرة التسويق لدى العميل');
  assert.equal(getApproval(db,users.employee,early.id).status,'documented');
  assert.throws(()=>db.prepare("UPDATE client_approvers SET name='اسم آخر' WHERE id=?").run(approverId),/approver identity is fixed/);
});

test('criterion 1: an employee on account A cannot read, record or verify anything on account B, even with the capability',t=>{
  const {db,users,approver,record}=fixture(t);
  const r=record({approver_id:approver()});
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'outsider',capability:'approvals.record',note:'مسؤول حساب آخر'}));
  assert.equal(listApprovals(db,users.outsider).records.length,0);
  assert.equal(listApprovals(db,users.outsider).outputs.length,0);
  assert.throws(()=>getApproval(db,users.outsider,r.id),code('not_found'));
  assert.throws(()=>record({approver_id:r.approver_id},'outsider'),code('not_found'));
  assert.throws(()=>listApprovals(db,users.hr),code('not_permitted'));
  assert.throws(()=>listApprovals(db,users.external),code('not_permitted'));
  assert.equal(listApprovals(db,users.employee).records.length,1);
});
