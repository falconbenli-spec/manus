import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { operationFields, money } from '../app/static/operations.mjs';
import { objectivesUI, risksUI, decisionsUI } from '../app/static/governance-ui.mjs';
import { GOVERNANCE_REPORTS } from '../app/reports-governance.mjs';
import {
  objectivesBoard, createObjective, objectiveAction, createInitiative, initiativeAction,
  createIndicator, recordMeasurement,
  risksBoard, saveRiskScale, createRisk, riskAction,
  decisionsBoard, recordDecision, createMinute, minuteAction, createCommitment, commitmentAction
} from '../app/governance.mjs';

const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);

function fixture(t,password){
  const db=openDb(':memory:');seed(db,password);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const grant=(user,capability)=>tx(()=>grantAccess(db,users.admin,{user_id:user,capability,note:'تصريح حوكمة مصطنع'}));
  return {db,users,tx,grant};
}
// الهيكل المزروع: employee و outsider تحت manager، وhr و it بلا مدير.
const OBJECTIVE={department_id:'creative',title:'هدف تجريبي للفريق الإبداعي',statement:'يدل على تحققه عدد التسليمات في موعدها',owner_id:'employee',period_from:'2026-01-01',period_to:'2026-12-31'};
const SCALE={likelihood:[{value:1,label:'نادر',description:''},{value:3,label:'مرجّح',description:''}],
  impact:[{value:2,label:'محدود',description:''},{value:5,label:'جسيم',description:''}],
  bands:[{label:'مقبول',min_score:1,max_score:5},{label:'مرتفع',min_score:6,max_score:20}]};
const RISK={title:'خطر تجريبي على التسليم',description:'وصف تجريبي كافٍ الطول لاختبار السجل',category:'تشغيلي',owner_id:'employee',
  likelihood_value:3,impact_value:5,response:'reduce',existing_controls:'ضوابط تجريبية قائمة',treatment_plan:'خطة معالجة تجريبية كافية الطول',
  treatment_owner_id:'employee',treatment_due:'2099-10-01',next_review_on:'2099-10-15',link_type:null,link_id:null};
const DECISION={title:'قرار تجريبي بتأجيل الحملة',context:'سياق تجريبي كافٍ الطول للاختبار',alternatives:'البديل الأول تنفيذ فوري والثاني تأجيل شهرًا',
  decision:'تأجيل الحملة شهرًا واحدًا لإعادة التسعير',impact:'الأثر المتوقع تأخر الإيراد شهرًا مقابل هامش أفضل',decided_by:'manager',decided_on:'2026-09-01',
  reference:'مرجع تجريبي',minute_id:null,reverses_id:null,reversal_reason:''};
const MINUTE={title:'محضر اجتماع تجريبي',meeting_date:'2026-09-15',location:'قاعة تجريبية',
  attendees:[{user_id:'manager',attendance:'present',note:''},{user_id:'employee',attendance:'present',note:''}],
  items:[{title:'بند تجريبي أول',note:''},{title:'بند تجريبي ثانٍ',note:''}]};

test('objectives: an initiative is approved by someone other than its proposer and never reports an invented completion percentage',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-objectives');
  grant('manager','governance.objectives.manage');grant('hr','governance.objectives.manage');

  assert.throws(()=>tx(()=>createObjective(db,users.employee,OBJECTIVE)),code('not_permitted'),'the register is closed to accounts without its capability');
  const objectiveId=tx(()=>createObjective(db,users.manager,OBJECTIVE)).id;
  assert.throws(()=>tx(()=>createObjective(db,users.manager,OBJECTIVE)),code('duplicate_objective'));

  const initiativeId=tx(()=>createInitiative(db,users.manager,{objective_id:objectiveId,title:'مبادرة تجريبية للتسليم',owner_id:'employee',due_date:'2026-11-30',budget_amount:'1500.50',budget_id:null,budget_note:'رقم مخطط تجريبي'})).id;
  assert.throws(()=>tx(()=>createInitiative(db,users.manager,{objective_id:objectiveId,title:'مبادرة خارج الفترة',owner_id:'employee',due_date:'2027-03-01',budget_amount:null,budget_id:null,budget_note:''})),code('due_date'),'an initiative cannot outlive the objective it serves');

  assert.throws(()=>tx(()=>initiativeAction(db,users.manager,initiativeId,'approve_initiative',{version:1,note:'أعتمد اقتراحي بنفسي وهذا ممنوع'})),code('invalid_state'),'the proposer is never offered the approval');
  assert.throws(()=>tx(()=>initiativeAction(db,users.hr,initiativeId,'approve_initiative',{version:9,note:'نسخة قديمة لا تُقبل مهما كان صاحبها'})),code('stale_version'));
  tx(()=>initiativeAction(db,users.hr,initiativeId,'approve_initiative',{version:1,note:'راجعت المبادرة واعتمدتها لأنها ضمن الهدف'}));
  assert.throws(()=>tx(()=>initiativeAction(db,users.hr,initiativeId,'edit_initiative',{version:2,title:'عنوان بعد الاعتماد',owner_id:'employee',due_date:'2026-11-30',budget_amount:null,budget_id:null,budget_note:''})),code('invalid_state'),'an approved initiative is not rewritten');
  assert.throws(()=>db.prepare("UPDATE governance_initiatives SET title='تعديل صامت' WHERE id=?").run(initiativeId),/never rewritten/);

  tx(()=>initiativeAction(db,users.employee,initiativeId,'start_initiative',{version:2}));
  const indicatorId=tx(()=>createIndicator(db,users.employee,{initiative_id:initiativeId,title:'نسبة التسليم في الموعد',unit:'%',baseline_value:60,target_value:90,direction:'up',measurement_source:'يُقرأ من تقرير الطلبات شهريًا ويدخله مالك المبادرة'})).id;
  assert.throws(()=>tx(()=>createIndicator(db,users.employee,{initiative_id:initiativeId,title:'مؤشر بلا مصدر',unit:'%',baseline_value:1,target_value:2,direction:'up',measurement_source:'قصير'})),code('invalid_text'),'an indicator without a written measurement source is refused');

  const first=tx(()=>recordMeasurement(db,users.employee,indicatorId,{value:72.5,measured_on:'2026-06-30',source:'تقرير الطلبات المصطنع لشهر يونيو',corrects_id:null,correction_reason:''})).id;
  assert.throws(()=>db.prepare('UPDATE governance_measurements SET value=99').run(),/never rewritten/,'a recorded measurement is never edited in place');
  assert.throws(()=>db.prepare('DELETE FROM governance_measurements').run(),/retained/);
  tx(()=>recordMeasurement(db,users.employee,indicatorId,{value:71,measured_on:'2026-06-30',source:'إعادة قراءة التقرير نفسه',corrects_id:first,correction_reason:'خطأ في نقل الرقم'}));
  assert.throws(()=>tx(()=>recordMeasurement(db,users.employee,indicatorId,{value:70,measured_on:'2026-06-30',source:'تصحيح ثانٍ لنفس القياس',corrects_id:first,correction_reason:'محاولة تصحيح مكرر'})),code('already_corrected'));

  const indicator=objectivesBoard(db,users.manager).objectives[0].initiatives[0].indicators[0];
  assert.equal(indicator.measurements.length,1,'a corrected measurement leaves the live list but stays in the table');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM governance_measurements').get().n,2,'and the original is retained');
  assert.equal(indicator.latest.value,71);
  assert.deepEqual(Object.keys(indicator).filter(k=>/percent|completion|progress/.test(k)),[],'no invented completion percentage is published');
  assert.match(objectivesBoard(db,users.manager).note,/لا تحسب نسبة إنجاز/);
  assert.ok(verifyAudit(db));
});

test('objectives: an owner without the register capability sees only their own objectives, and other tenants see none',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-scope');
  grant('manager','governance.objectives.manage');
  tx(()=>createObjective(db,users.manager,OBJECTIVE));
  assert.equal(objectivesBoard(db,users.employee).objectives.length,1,'the objective owner sees the objective they own');
  assert.equal(objectivesBoard(db,users.employee).can_manage,false);
  assert.equal(objectivesBoard(db,users.outsider).objectives.length,0,'an unrelated colleague sees nothing');
  assert.equal(objectivesBoard(db,users.external).objectives.length,0,'another tenant sees nothing');
  assert.equal(risksBoard(db,users.external).risks.length,0);
  assert.equal(decisionsBoard(db,users.external).decisions.length,0);
});

test('risks: the scale is defined by the procedure owner, an accepted risk needs approval from above its owner, and an overdue review reaches the inbox',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-risks');
  grant('manager','governance.risks.manage');grant('hr','governance.risks.manage');

  assert.throws(()=>tx(()=>createRisk(db,users.manager,RISK)),code('scale_undefined'),'the platform imposes no 1-5 scale and no ready-made matrix');
  assert.throws(()=>tx(()=>saveRiskScale(db,users.employee,SCALE)),code('not_permitted'));
  tx(()=>saveRiskScale(db,users.manager,SCALE));
  assert.throws(()=>tx(()=>createRisk(db,users.manager,{...RISK,likelihood_value:4})),code('likelihood_value'),'a value outside the defined scale is refused');
  assert.throws(()=>tx(()=>createRisk(db,users.manager,{...RISK,response:'accept'})),code('response'),'a risk is never registered as already accepted');
  assert.throws(()=>tx(()=>createRisk(db,users.manager,{...RISK,treatment_owner_id:null,treatment_due:null})),code('treatment'),'any response but acceptance needs a treatment owner and a date');
  assert.throws(()=>tx(()=>createRisk(db,users.manager,{...RISK,treatment_plan:'قصيرة'})),code('invalid_text'),'and a treatment plan that actually says something');

  const riskId=tx(()=>createRisk(db,users.manager,RISK)).id;
  let board=risksBoard(db,users.manager);
  assert.equal(board.risks[0].score,15);
  assert.equal(board.risks[0].band,'مرتفع','the band is the name its owner gave that range, not a platform verdict');

  const acceptFields={version:1,title:RISK.title,description:RISK.description,category:RISK.category,owner_id:'employee',likelihood_value:3,impact_value:5,
    response:'accept_proposed',existing_controls:RISK.existing_controls,treatment_plan:'',treatment_owner_id:null,treatment_due:null,next_review_on:RISK.next_review_on,link_type:null,link_id:null};
  tx(()=>riskAction(db,users.manager,riskId,'edit_risk',acceptFields));
  assert.throws(()=>tx(()=>riskAction(db,users.employee,riskId,'accept_risk',{version:2,reason:'أقبل خطري بنفسي وهذا ممنوع قطعًا'})),code('invalid_state'),'an owner never accepts their own risk');
  assert.throws(()=>tx(()=>riskAction(db,users.hr,riskId,'accept_risk',{version:2,reason:'لست أعلى من مالك الخطر في الهيكل'})),code('invalid_state'),'a peer with the register capability is not above the owner');
  assert.throws(()=>db.prepare("UPDATE governance_risks SET response='accept',version=version+1 WHERE id=?").run(riskId),/someone above its owner/,'the database refuses an acceptance with no recorded approval');
  tx(()=>riskAction(db,users.manager,riskId,'accept_risk',{version:2,reason:'قبلت الخطر لأن كلفة معالجته أعلى من أثره المتوقع'}));
  board=risksBoard(db,users.manager);
  assert.equal(board.risks[0].response,'accept');
  assert.equal(board.risks[0].acceptance.accepted_by_name,users.manager.name,'the acceptance carries the name and the reason of who gave it');

  // لا تحكم للاختبار في ساعة النظام، فيُقدَّم تاريخ المراجعة مباشرة مع رقم نسخته كما تفرضه القاعدة.
  db.prepare("UPDATE governance_risks SET next_review_on='2020-01-01',version=version+1 WHERE id=?").run(riskId);
  board=risksBoard(db,users.manager);
  assert.equal(board.risks[0].review_overdue,true);
  assert.equal(board.counters.review_overdue,1);
  assert.deepEqual(board.inbox.map(i=>i.actions).flat(),['review_risk']);
  assert.equal(risksBoard(db,users.employee).inbox.length,1,'the risk owner is asked for the overdue review too');
  assert.throws(()=>tx(()=>riskAction(db,users.manager,riskId,'review_risk',{version:4,note:'مراجعة بتاريخ ماضٍ',likelihood_value:1,impact_value:2,next_review_on:'2020-02-01'})),code('next_review_on'));
  tx(()=>riskAction(db,users.manager,riskId,'review_risk',{version:4,note:'راجعت الخطر ولم يتغير تقديره',likelihood_value:1,impact_value:2,next_review_on:'2099-01-01'}));
  board=risksBoard(db,users.manager);
  assert.equal(board.counters.review_overdue,0);
  assert.equal(board.risks[0].reviews.length,1);
  assert.throws(()=>db.prepare("UPDATE governance_risk_reviews SET note='تعديل صامت'").run(),/never rewritten/);

  assert.throws(()=>tx(()=>riskAction(db,users.employee,riskId,'close_risk',{version:5,closure_note:'أقفل خطري بنفسي'})),code('invalid_state'),'an owner never closes their own risk');
  tx(()=>riskAction(db,users.manager,riskId,'close_risk',{version:5,closure_note:'زال مصدر الخطر بانتهاء المشروع المصطنع'}));
  assert.throws(()=>tx(()=>riskAction(db,users.manager,riskId,'edit_risk',{...acceptFields,version:6})),code('invalid_state'),'a closed risk is reopened by a new record, not by an edit');
  assert.throws(()=>tx(()=>saveRiskScale(db,users.manager,{...SCALE,likelihood:[{value:3,label:'مرجّح',description:''}]})),code('scale_in_use'),'a level used by a registered risk is not withdrawn from the scale');
  assert.throws(()=>tx(()=>saveRiskScale(db,users.manager,{...SCALE,likelihood:[{value:1,label:'اسم آخر للدرجة نفسها',description:''},{value:3,label:'مرجّح',description:''}]})),code('scale_in_use'),'nor does a used level quietly change its meaning');
  assert.ok(verifyAudit(db));
});

test('risks: a risk owned by someone with nobody above them cannot have its acceptance approved, and the board says so',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-acceptance');
  grant('manager','governance.risks.manage');
  tx(()=>saveRiskScale(db,users.manager,SCALE));
  const riskId=tx(()=>createRisk(db,users.manager,{...RISK,owner_id:'hr',treatment_owner_id:'hr'})).id;
  tx(()=>riskAction(db,users.manager,riskId,'edit_risk',{version:1,title:RISK.title,description:RISK.description,category:RISK.category,owner_id:'hr',
    likelihood_value:3,impact_value:5,response:'accept_proposed',existing_controls:'',treatment_plan:'',treatment_owner_id:null,treatment_due:null,next_review_on:RISK.next_review_on,link_type:null,link_id:null}));
  const risk=risksBoard(db,users.manager).risks[0];
  assert.equal(risk.acceptance_blocked,true,'the platform states the gap instead of letting anyone accept');
  assert.equal(risk.actions.includes('accept_risk'),false);
  assert.match(risksUI.render(risksBoard(db,users.manager),{e,button:(a,i,l)=>`<button>${e(l)}</button>`}),/لا يوجد في الهيكل من هو أعلى/);
});

test('decisions: a recorded decision is never edited, an approved minute is sealed, and a commitment closes only with evidence',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-decisions');
  grant('manager','governance.decisions.record');grant('hr','governance.decisions.record');

  assert.throws(()=>tx(()=>recordDecision(db,users.employee,DECISION)),code('not_permitted'));
  assert.throws(()=>tx(()=>recordDecision(db,users.manager,{...DECISION,alternatives:'لا شيء'})),code('invalid_text'),'a decision with no alternatives considered is refused');
  const decisionId=tx(()=>recordDecision(db,users.manager,DECISION)).id;
  assert.throws(()=>db.prepare("UPDATE governance_decisions SET decision='تعديل صامت'").run(),/never edited/);
  assert.throws(()=>db.prepare('DELETE FROM governance_decisions').run(),/never deleted/);
  const reversalId=tx(()=>recordDecision(db,users.manager,{...DECISION,title:'قرار تجريبي بالعدول عن التأجيل',decided_on:'2026-09-10',reverses_id:decisionId,reversal_reason:'تغيّر السوق المصطنع فعاد الإطلاق في موعده'})).id;
  const board=decisionsBoard(db,users.manager);
  assert.equal(board.decisions.find(d=>d.id===decisionId).reversed_by.id,reversalId,'the first decision stays and points at the one that reversed it');
  assert.equal(board.decisions.find(d=>d.id===reversalId).reverses_title,DECISION.title);

  const minuteId=tx(()=>createMinute(db,users.manager,MINUTE)).id;
  assert.throws(()=>tx(()=>createMinute(db,users.manager,{...MINUTE,attendees:[]})),code('attendees'));
  assert.throws(()=>tx(()=>createMinute(db,users.manager,{...MINUTE,items:[]})),code('items'));
  assert.throws(()=>tx(()=>minuteAction(db,users.manager,minuteId,'approve_minute',{version:1,note:'أعتمد محضري بنفسي'})),code('invalid_state'),'whoever prepared the minute does not approve it');
  tx(()=>minuteAction(db,users.manager,minuteId,'edit_minute',{...MINUTE,version:1,items:[{title:'بند تجريبي معدَّل',note:''}]}));
  tx(()=>minuteAction(db,users.hr,minuteId,'approve_minute',{version:2,note:'راجعت الحاضرين والبنود قبل الاعتماد'}));
  assert.throws(()=>tx(()=>minuteAction(db,users.manager,minuteId,'edit_minute',{...MINUTE,version:3})),code('invalid_state'),'an approved minute is never rewritten');
  assert.throws(()=>db.prepare('DELETE FROM governance_minute_items WHERE minute_id=?').run(minuteId),/sealed/);
  assert.throws(()=>db.prepare("INSERT INTO governance_minute_attendees VALUES(?,?,'present','')").run(minuteId,'it'),/sealed/);

  const commitmentId=tx(()=>createCommitment(db,users.manager,{decision_id:decisionId,minute_id:null,title:'إعادة تسعير الباقة قبل الإطلاق',detail:'',owner_id:'employee',due_date:'2026-09-10'})).id;
  assert.throws(()=>tx(()=>createCommitment(db,users.manager,{decision_id:null,minute_id:null,title:'التزام بلا مصدر',detail:'',owner_id:'employee',due_date:'2026-09-10'})),code('source'),'a commitment never stands without a decision or a minute behind it');
  assert.equal(decisionsBoard(db,users.employee).commitments.length,1,'the commitment owner sees their own commitment without the register capability');
  assert.equal(decisionsBoard(db,users.outsider).commitments.length,0);
  assert.deepEqual(decisionsBoard(db,users.employee).inbox.map(i=>i.actions).flat(),['record_execution'],'an overdue commitment reaches its owner');
  assert.throws(()=>tx(()=>commitmentAction(db,users.employee,commitmentId,'record_execution',{version:1,closure_evidence:'تم'})),code('invalid_text'),'a closure with no evidence is refused');
  assert.throws(()=>tx(()=>commitmentAction(db,users.outsider,commitmentId,'record_execution',{version:1,closure_evidence:'لست مالك هذا الالتزام ولا حامل تصريحه'})),code('invalid_state'));
  tx(()=>commitmentAction(db,users.employee,commitmentId,'record_execution',{version:1,closure_evidence:'أُعيد التسعير ووثيقته محفوظة في ملف الباقة المصطنع'}));
  assert.throws(()=>tx(()=>commitmentAction(db,users.manager,commitmentId,'cancel_commitment',{version:2,closure_evidence:'محاولة إعادة فتح التزام مغلق'})),code('invalid_state'));
  assert.equal(decisionsBoard(db,users.manager).counters.done,1);
  assert.ok(verifyAudit(db));
});

test('governance screens render for every role and every button they offer opens a usable form',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-ui');
  for(const capability of ['governance.objectives.manage','governance.risks.manage','governance.decisions.record'])grant('manager',capability);
  grant('hr','governance.objectives.manage');grant('hr','governance.decisions.record');
  const objectiveId=tx(()=>createObjective(db,users.manager,OBJECTIVE)).id;
  const initiativeId=tx(()=>createInitiative(db,users.manager,{objective_id:objectiveId,title:'مبادرة تجريبية للتسليم',owner_id:'employee',due_date:'2026-11-30',budget_amount:'1000.00',budget_id:null,budget_note:''})).id;
  tx(()=>initiativeAction(db,users.hr,initiativeId,'approve_initiative',{version:1,note:'اعتماد مصطنع للمبادرة ضمن الهدف'}));
  tx(()=>initiativeAction(db,users.employee,initiativeId,'start_initiative',{version:2}));
  const indicatorId=tx(()=>createIndicator(db,users.employee,{initiative_id:initiativeId,title:'نسبة التسليم في الموعد',unit:'%',baseline_value:60,target_value:90,direction:'up',measurement_source:'تقرير الطلبات الشهري يقرؤه مالك المبادرة'})).id;
  tx(()=>recordMeasurement(db,users.employee,indicatorId,{value:72.5,measured_on:'2026-06-30',source:'تقرير الطلبات المصطنع',corrects_id:null,correction_reason:''}));
  tx(()=>saveRiskScale(db,users.manager,SCALE));
  tx(()=>createRisk(db,users.manager,{...RISK,link_type:'initiative',link_id:initiativeId}));
  const decisionId=tx(()=>recordDecision(db,users.manager,DECISION)).id;
  tx(()=>createMinute(db,users.manager,MINUTE));
  tx(()=>createCommitment(db,users.manager,{decision_id:decisionId,minute_id:null,title:'إعادة تسعير الباقة قبل الإطلاق',detail:'',owner_id:'employee',due_date:'2026-09-10'}));

  const screens=[[objectivesUI,objectivesBoard],[risksUI,risksBoard],[decisionsUI,decisionsBoard]];
  const problems=[];let forms=0;
  for(const who of ['manager','hr','employee','outsider','it']){
    for(const [ui,board] of screens){
      const data=board(db,users[who]),buttons=[],button=(action,id,label)=>{buttons.push([action,id,label]);return `<button>${e(label)}</button>`;};
      const html=ui.render(data,{e,button,money}),text=html.replace(/<[^>]+>/g,' ');
      const leak=text.match(/\bundefined\b|\bNaN\b|\[object |\bnull\b/);
      if(leak)problems.push(`${who}/${ui.title}: rendered text contains ${leak[0]}`);
      if(/<script|style="/.test(html))problems.push(`${who}/${ui.title}: inline script or style breaks the content policy`);
      for(const [action,recordId,label] of buttons){
        if(!label)problems.push(`${who}/${ui.title}/${action}: button without a label`);
        try{
          const spec=ui.form(action,recordId,data);forms++;
          if(typeof spec.title!=='string'||!Array.isArray(spec.fields)||typeof spec.toPayload!=='function'||!spec.endpoint)problems.push(`${who}/${ui.title}/${action}: incomplete form spec`);
          else if(/\bundefined\b/.test(spec.title+operationFields(spec.fields,e).replace(/<[^>]+>/g,' ')))problems.push(`${who}/${ui.title}/${action}: form shows undefined`);
        }catch(error){problems.push(`${who}/${ui.title}/${action}: form ${error.message}`);}
      }
    }
  }
  assert.deepEqual(problems,[]);
  assert.ok(forms>15,`opened ${forms} forms`);
  // زر لم تعرضه اللوحة لا يفتح نموذجًا، مهما نُسخ معرّفه.
  assert.throws(()=>objectivesUI.form('close_objective',objectiveId,objectivesBoard(db,users.employee)),/غير متاح/);
  assert.throws(()=>risksUI.form('create_risk','',risksBoard(db,users.employee)),/غير متاح/);
  assert.throws(()=>decisionsUI.form('record_decision','',decisionsBoard(db,users.employee)),/غير متاح/);
});

test('governance reports: R02, R03 and R05 open for the roles that may read them and publish rows that match their columns',t=>{
  const {db,users,tx,grant}=fixture(t,'synthetic-governance-reports');
  for(const capability of ['governance.objectives.manage','governance.risks.manage','governance.decisions.record'])grant('manager',capability);
  grant('hr','governance.objectives.manage');grant('it','executive.view');
  const objectiveId=tx(()=>createObjective(db,users.manager,OBJECTIVE)).id;
  const initiativeId=tx(()=>createInitiative(db,users.manager,{objective_id:objectiveId,title:'مبادرة تجريبية للتسليم',owner_id:'employee',due_date:'2026-11-30',budget_amount:'1500.50',budget_id:null,budget_note:''})).id;
  tx(()=>initiativeAction(db,users.hr,initiativeId,'approve_initiative',{version:1,note:'اعتماد مصطنع للمبادرة ضمن الهدف'}));
  const indicatorId=tx(()=>createIndicator(db,users.manager,{initiative_id:initiativeId,title:'نسبة التسليم في الموعد',unit:'%',baseline_value:60,target_value:90,direction:'up',measurement_source:'تقرير الطلبات الشهري يقرؤه مالك المبادرة'})).id;
  tx(()=>recordMeasurement(db,users.manager,indicatorId,{value:72.5,measured_on:'2026-06-30',source:'تقرير الطلبات المصطنع',corrects_id:null,correction_reason:''}));
  tx(()=>saveRiskScale(db,users.manager,SCALE));
  tx(()=>createRisk(db,users.manager,{...RISK,link_type:'initiative',link_id:initiativeId}));
  const decisionId=tx(()=>recordDecision(db,users.manager,DECISION)).id;
  tx(()=>createCommitment(db,users.manager,{decision_id:decisionId,minute_id:null,title:'إعادة تسعير الباقة قبل الإطلاق',detail:'',owner_id:'employee',due_date:'2026-09-10'}));

  assert.deepEqual(GOVERNANCE_REPORTS.map(r=>r.key),['R02','R03','R05']);
  const problems=[];
  for(const report of GOVERNANCE_REPORTS){
    assert.equal(report.group,'الإدارة العليا');
    assert.ok(report.definition&&report.source,`${report.key}: definition and source are published with the report`);
    assert.equal(report.allowed(db,users.employee),false,`${report.key}: a colleague without a governance capability cannot open it`);
    assert.equal(report.allowed(db,users.it),true,`${report.key}: an executive reader can open it`);
    const result=report.run(db,users.it,{from:'2026-01-01',to:'2026-12-31'}),columns=new Set(result.columns.map(c=>c[0]));
    assert.ok(result.rows.length,`${report.key}: the fixture produced rows`);
    assert.ok(result.notes.length,`${report.key}: the report states its limits`);
    for(const row of result.rows){
      for(const key of Object.keys(row))if(!columns.has(key))problems.push(`${report.key}: row field ${key} has no column`);
      for(const [key,,type] of result.columns){
        const value=row[key];
        if(value===undefined)problems.push(`${report.key}: column ${key} is undefined`);
        if(['number','money'].includes(type)&&value!==null&&!Number.isFinite(value))problems.push(`${report.key}: column ${key} is not a number (${value})`);
      }
    }
  }
  assert.deepEqual(problems,[]);
  const r02=GOVERNANCE_REPORTS[0].run(db,users.it,{from:'2026-01-01',to:'2026-12-31'});
  assert.equal(r02.rows[0].latest,72.5);
  assert.equal(r02.rows[0].budget,1500.5,'the planned budget is published in riyals from the halalas that were stored');
  assert.equal(r02.columns.some(([key])=>/percent|completion|progress/.test(key)),false,'R02 publishes no completion percentage');
  assert.ok(r02.notes.some(n=>n.includes('لا نسبة إنجاز')));
  // قياس تاريخه بعد نهاية الفترة المطلوبة لا يظهر في تقرير تلك الفترة.
  tx(()=>recordMeasurement(db,users.manager,indicatorId,{value:88,measured_on:'2026-09-15',source:'قياس لاحق داخل السنة نفسها',corrects_id:null,correction_reason:''}));
  assert.equal(GOVERNANCE_REPORTS[0].run(db,users.it,{from:'2026-01-01',to:'2026-07-31'}).rows[0].latest,72.5);
  assert.equal(GOVERNANCE_REPORTS[0].run(db,users.it,{from:'2026-01-01',to:'2026-12-31'}).rows[0].latest,88);
  const r05=GOVERNANCE_REPORTS[2].run(db,users.it,{from:'2026-01-01',to:'2026-12-31'});
  assert.equal(r05.rows[0].commitments,1);
  assert.ok(r05.notes.some(n=>n.includes('لا تقيس الأثر المتحقق')));
  assert.ok(verifyAudit(db));
});
