import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { riyadhDate } from '../app/work-calendar.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { defineScale, setMatrixCell, saveIntake, submissionGate, intakeSettings, intakeFor,
  duplicateCandidates, earliestDelivery, freezeIntake, derivePriority } from '../app/request-intake.mjs';

const code=value=>error=>error.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const blank={beneficiary_id:'',impact_code:'',urgency_code:'',needed_by:'',justification:'',cost_impact:'',cost_center:'',client_id:'',campaign_id:'',contract_reference:''};
function setup(t){const db=openDb(':memory:');seed(db,'synthetic-request-intake');installServiceCatalog(db);t.after(()=>db.close());return db;}
function draft(db,who,serviceCode='ADM-MAINTENANCE',payload={category:'تكييف',location:'الدور الثاني',description:'تسريب تجريبي',urgency:'عادي'}){
  const u=user(db,who),service=wf.catalog(db,u).find(s=>s.code===serviceCode);
  return wf.createRequest(db,u,{service_id:service.id,title:'طلب تجريبي',payload,project_id:null});
}
function configureMatrix(db){
  const admin=user(db,'admin'),basis='اعتمدها مالك إجراء الخدمات في ورشة تجريبية';
  transaction(db,()=>{
    defineScale(db,admin,{dimension:'impact',code:'wide',name:'أثر واسع',guidance:'يتعطل عمل إدارة كاملة أو عميل',rank:1,basis});
    defineScale(db,admin,{dimension:'impact',code:'single',name:'أثر فردي',guidance:'يتعطل عمل شخص واحد فقط',rank:2,basis});
    defineScale(db,admin,{dimension:'urgency',code:'now',name:'عاجل',guidance:'لا يحتمل الانتظار ليوم عمل',rank:1,basis});
    defineScale(db,admin,{dimension:'urgency',code:'normal',name:'عادي',guidance:'يحتمل الانتظار ضمن الزمن المعتاد',rank:2,basis});
    setMatrixCell(db,admin,{impact_code:'wide',urgency_code:'now',priority:'حرجة',priority_rank:1,target_days:1,basis});
    setMatrixCell(db,admin,{impact_code:'wide',urgency_code:'normal',priority:'مرتفعة',priority_rank:2,target_days:3,basis});
    setMatrixCell(db,admin,{impact_code:'single',urgency_code:'now',priority:'مرتفعة',priority_rank:2,target_days:3,basis});
    setMatrixCell(db,admin,{impact_code:'single',urgency_code:'normal',priority:'عادية',priority_rank:3,target_days:10,basis});
  });
}

test('intake scales: the platform ships no impact scale of its own, and only the catalogue owner may define one',t=>{
  const db=setup(t),admin=user(db,'admin');
  const before=intakeSettings(db,admin);
  assert.equal(before.configured,false);assert.deepEqual(before.impact,[]);assert.deepEqual(before.urgency,[]);
  assert.throws(()=>transaction(db,()=>defineScale(db,user(db,'manager'),{dimension:'impact',code:'wide',name:'أثر واسع',guidance:'يتعطل عمل إدارة كاملة',rank:1,basis:'محاولة غير مصرح بها'})),code('forbidden'));
  assert.throws(()=>transaction(db,()=>defineScale(db,admin,{dimension:'impact',code:'wide',name:'أثر واسع',guidance:'قصير',rank:1,basis:'سند كافٍ الطول'})),error=>error.status===400,'guidance must actually guide');
  assert.throws(()=>transaction(db,()=>setMatrixCell(db,admin,{impact_code:'wide',urgency_code:'now',priority:'حرجة',priority_rank:1,target_days:1,basis:'قبل تعريف الدرجات'})),code('unknown_scale'));
  configureMatrix(db);
  const after=intakeSettings(db,admin);
  assert.equal(after.configured,true);assert.deepEqual(after.missing,[],'every impact/urgency intersection carries a priority');
  assert.equal(derivePriority(db,'36t','wide','now').priority,'حرجة');
  assert.equal(derivePriority(db,'36t','single','normal').target_days,10);
  assert.ok(verifyAudit(db));
});

test('submission gate: blocks what an approver cannot fix, and only advises on the rest',t=>{
  const db=setup(t),employee=user(db,'employee');
  const incomplete=draft(db,'employee','ADM-MAINTENANCE',{category:'تكييف',location:'',description:'',urgency:'عادي'});
  const gate=submissionGate(db,employee,incomplete.id);
  assert.equal(gate.ready,false);
  assert.ok(gate.blocking.some(b=>b.code==='missing_field'),'a required field left empty blocks submission');
  assert.ok(gate.advisory.some(a=>a.code==='matrix_missing'),'an unconfigured matrix advises, it does not block');
  configureMatrix(db);
  const r=draft(db,'employee');
  const afterConfig=submissionGate(db,employee,r.id);
  assert.equal(afterConfig.ready,false);
  assert.ok(afterConfig.blocking.some(b=>b.code==='missing_priority'),'once a matrix exists, impact and urgency are required');
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'single',urgency_code:'normal'}));
  assert.equal(intakeFor(db,r.id).priority,'عادية','the priority is derived, never typed by the requester');
  assert.equal(submissionGate(db,employee,r.id).ready,true);
  assert.ok(verifyAudit(db));
});

test('submission gate: money without a reason blocks, and a date that has already passed blocks',t=>{
  const db=setup(t),employee=user(db,'employee');
  configureMatrix(db);
  const r=draft(db,'employee');
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'single',urgency_code:'normal',cost_impact:'1500.50'}));
  assert.equal(intakeFor(db,r.id).cost_impact_minor,150050,'money is stored in halalas like the rest of the platform');
  const costed=submissionGate(db,employee,r.id);
  assert.equal(costed.ready,false);
  assert.ok(costed.blocking.some(b=>b.code==='cost_without_justification'));
  assert.ok(costed.advisory.some(a=>a.code==='cost_without_center'));
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'single',urgency_code:'normal',cost_impact:'1500.50',justification:'استبدال وحدة تكييف معطلة في قاعة الاجتماعات',cost_center:'CC-OPS'}));
  assert.equal(submissionGate(db,employee,r.id).ready,true);
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'single',urgency_code:'normal',needed_by:'2020-01-01'}));
  assert.ok(submissionGate(db,employee,r.id).blocking.some(b=>b.code==='needed_by_past'));
});

test('service level: a date sooner than the working-day target advises rather than blocks, and the tighter of service and priority wins',t=>{
  const db=setup(t),employee=user(db,'employee');
  configureMatrix(db);
  const r=draft(db,'employee');
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'wide',urgency_code:'now'}));
  const delivery=earliestDelivery(db,db.prepare('SELECT * FROM requests WHERE id=?').get(r.id),wf.catalog(db,employee).find(s=>s.code==='ADM-MAINTENANCE'));
  assert.equal(delivery.from_priority,1);assert.equal(delivery.from_service,2);
  assert.equal(delivery.target_days,1,'a critical priority tightens the service target, it never loosens it');
  assert.equal(delivery.earliest_on.length,10);
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'wide',urgency_code:'now',needed_by:riyadhDate(Date.now()+86400000/24)}));
  const gate=submissionGate(db,employee,r.id);
  assert.ok(gate.advisory.some(a=>a.code==='needed_by_tight')||gate.ready,'an impossible date is surfaced, not refused');
});

test('on behalf of: the beneficiary stays visible, and only their manager or HR may file for them',t=>{
  const db=setup(t),employee=user(db,'employee'),manager=user(db,'manager'),hr=user(db,'hr');
  const peerRequest=draft(db,'employee');
  assert.throws(()=>transaction(db,()=>saveIntake(db,employee,peerRequest.id,{...blank,beneficiary_id:'outsider'})),code('not_permitted'),'a colleague cannot file for a colleague');
  assert.throws(()=>transaction(db,()=>saveIntake(db,employee,peerRequest.id,{...blank,beneficiary_id:'employee'})),code('beneficiary_self'),'filing for yourself needs no beneficiary');
  const byManager=draft(db,'manager');
  transaction(db,()=>saveIntake(db,manager,byManager.id,{...blank,beneficiary_id:'employee',justification:'الجهاز في مكتب الموظف وأنا مديره المباشر'}));
  assert.equal(intakeFor(db,byManager.id).beneficiary_id,'employee');
  const byHr=draft(db,'hr');
  transaction(db,()=>saveIntake(db,hr,byHr.id,{...blank,beneficiary_id:'outsider',justification:'الموارد البشرية تقدم نيابة عن الموظف بناء على طلبه'}));
  assert.equal(intakeFor(db,byHr.id).beneficiary_id,'outsider');
  assert.throws(()=>db.prepare("UPDATE request_intake SET beneficiary_id='manager' WHERE request_id=?").run(byManager.id),/beneficiary equals requester/,'the database refuses a beneficiary who is the requester, not only the code path');
  assert.ok(verifyAudit(db));
});

test('duplicates: an open request for the same service and the same beneficiary is surfaced, never blocked',t=>{
  const db=setup(t),employee=user(db,'employee');
  const first=draft(db,'employee');
  transaction(db,()=>wf.transition(db,employee,first.id,'submit',{version:first.version}));
  const second=draft(db,'employee');
  const found=duplicateCandidates(db,employee,second.id);
  assert.equal(found.length,1);assert.equal(found[0].id,first.id);
  assert.equal(found[0].identical_payload,true,'the same answers to the same service is the strongest signal');
  const gate=submissionGate(db,employee,second.id);
  assert.ok(gate.advisory.some(a=>a.code==='possible_duplicate'));
  assert.equal(gate.blocking.some(b=>b.code==='possible_duplicate'),false,'a repeat may well be deliberate');
});

test('intake freezes with the submitted revision so the priority cannot shift under the approver',t=>{
  const db=setup(t),employee=user(db,'employee');
  configureMatrix(db);
  const r=draft(db,'employee');
  transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'single',urgency_code:'normal'}));
  const submitted=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
  transaction(db,()=>freezeIntake(db,employee,r.id));
  assert.ok(intakeFor(db,r.id).frozen_at);
  assert.throws(()=>transaction(db,()=>saveIntake(db,employee,r.id,{...blank,impact_code:'wide',urgency_code:'now'})),code('intake_frozen'));
  assert.equal(submitted.status,'pending');
  assert.ok(verifyAudit(db));
});

test('duplicates never reveal a request the reader cannot open: a confidential grievance stays hidden from the manager it is about',t=>{
  const db=setup(t),employee=user(db,'employee'),manager=user(db,'manager');
  const payload={category:'معاملة غير لائقة',description:'وصف تجريبي سري للشكوى',expected:'تحقيق مستقل'};
  const grievance=draft(db,'employee','HR-GRIEVANCE',payload);
  transaction(db,()=>wf.transition(db,employee,grievance.id,'submit',{version:grievance.version}));
  assert.throws(()=>wf.getRequest(db,manager,grievance.id),error=>error.status===404,'the manager cannot open the grievance');
  const probe=draft(db,'manager','HR-GRIEVANCE',payload);
  transaction(db,()=>saveIntake(db,manager,probe.id,{...blank,beneficiary_id:'employee',justification:'محاولة كشف طلب لا يحق لي رؤيته'}));
  assert.deepEqual(duplicateCandidates(db,manager,probe.id),[],'neither the title nor a payload comparison leaks');
  assert.equal(submissionGate(db,manager,probe.id).advisory.some(a=>a.code==='possible_duplicate'),false);
  assert.throws(()=>transaction(db,()=>saveIntake(db,employee,grievance.id,{...blank,client_id:'client-of-another-tenant'})),error=>['invalid_link','intake_frozen'].includes(error.code));
});
