import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../app/db.mjs';
import * as wf from '../app/workflow.mjs';
import { buildScenario, publicSurface, surfaceDigest } from './escalation-equivalence.scenario.mjs';

// ضمان التكافؤ (الموجة 2، العطب 6): قبل أن يُكتب أي صف تصعيد، «من يملك قرار كل (مستخدم، طلب، خطوة)» هو ما كان قبل التعديل
// حرفًا بحرف. ثلاث طبقات: (1) نص الحكم القديم مثبّت ببصمته، (2) الحكم الساري يطابقه على مصفوفة كاملة، (3) السطح العام كله
// — الرؤية والأفعال والخطوات المعلقة والقوائم — يطابق بصمة المشهد نفسه مشغَّلًا على 434b411. كل ما هنا مصطنع.

// بصمة نص authorizedStep كما كان في 434b411 بعد تغيير اسمه وحده إلى authorizedStepBase (حُسبت من git show 434b411:app/workflow.mjs).
const BASE_PREDICATE_DIGEST='108dfabcb4cf02509a4a8dddabbda43a19ad145b95165c7277bf5ef830116ebf';
// بصمة publicSurface(buildScenario()) بعد تصحيح 3 أكتوبر: كل خطوة عادية بقيت على سطح 434b411،
// والخطوة التي كانت تحسب قرار شخص واحد مرتين صارت تظهر لمُعتمد تنفيذي مستقل واحد.
const BASE_SURFACE_DIGEST='267cf6e7ac271aa8d5ae78dc3c80082c712bd427a5e07798b052f5a8abc00178';

test('equivalence: the old predicate is kept byte for byte under its new name',()=>{
  assert.equal(hash(wf.authorizedStepBase.toString()),BASE_PREDICATE_DIGEST,'authorizedStepBase is the pre-escalation rule; change the new rule beside it, never this one');
});

test('equivalence: ordinary steps keep the old decision rule while a duplicate route has one distinct executive',t=>{
  const scene=buildScenario(),{db}=scene;t.after(()=>db.close());
  assert.deepEqual(scene.errors,[],'the scenario builds every request it names');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,0);
  const people=db.prepare('SELECT * FROM users ORDER BY id').all(),steps=db.prepare('SELECT * FROM approval_steps ORDER BY request_id,revision,position').all();
  let cells=0,allowed=0,duplicateSteps=0;
  for(const step of steps){
    const r=db.prepare('SELECT * FROM requests WHERE id=?').get(step.request_id);
    const duplicate=wf.stepBasis(db,step.id)?.basis==='duplicate_escalation';
    if(duplicate)duplicateSteps++;
    for(const person of people){
      const now=wf.mayDecideStep(db,person,r,step),before=wf.authorizedStepBase(db,person,r,step);
      if(!duplicate)assert.equal(now,before,`${person.id} on step ${step.position} of a ${r.status} request (revision ${step.revision})`);
      cells++;if(now)allowed++;
    }
    assert.equal(wf.deciderOf(db,step),step.approver_id,'with no row the decider is the recorded approver');
  }
  assert.ok(steps.length>=20&&cells===steps.length*people.length,`the matrix is every step × every account (${cells} cells)`);
  assert.ok(duplicateSteps>=1,'the scenario includes the intentional distinct-approver correction');
  assert.ok(allowed>=steps.length,'and it is not vacuous: every step has someone who may decide it');
  // من المبادئ الأولى، لا من الدالة القديمة: المدير يقرر خطوة موظفته، ولا يقررها صاحب الطلب ولا زميله ولا حساب الكيان الآخر.
  const first=db.prepare("SELECT s.* FROM approval_steps s JOIN requests r ON r.id=s.request_id WHERE r.id=? AND s.position=0").get(scene.requests[0]);
  const r0=db.prepare('SELECT * FROM requests WHERE id=?').get(scene.requests[0]),may=id=>wf.mayDecideStep(db,scene.user(id),r0,first);
  assert.deepEqual(['manager','employee','outsider','hr','external','admin'].map(may),[true,false,false,false,false,false]);
  // المفوَّض يقرر ما عند المفوِّض، بالحكم القديم نفسه.
  const delegated=db.prepare("SELECT s.* FROM approval_steps s WHERE s.request_id=? AND s.status='pending'").get(scene.requests[12]);
  const r12=db.prepare('SELECT * FROM requests WHERE id=?').get(scene.requests[12]);
  assert.equal(delegated.approver_id,'vp-growth');assert.equal(wf.mayDecideStep(db,scene.user('vp-corporate'),r12,delegated),true,'an active delegate decides, as before');
});

test('equivalence: the public surface matches the distinct-approver baseline',t=>{
  const scene=buildScenario();t.after(()=>scene.db.close());
  const surface=publicSurface(scene),cells=Object.values(surface.people).flat();
  assert.equal(cells.length,Object.keys(surface.people).length*scene.requests.length);
  assert.ok(cells.some(c=>c.actions?.includes('escalate')),'the reminder action (key «escalate») is offered on the two-day-old request');
  assert.ok(cells.filter(c=>c.pending?.length).length>=10&&cells.filter(c=>c.visible).length>=40,'the scenario is not vacuous');
  assert.equal(surfaceDigest(surface),BASE_SURFACE_DIGEST,'someone changed who may see, decide or act after the distinct-approver correction');
});
