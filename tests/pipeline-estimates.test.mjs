import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { pipelineBoard, prepareStage, stageAction, addLossReason, lossReasonAction, createOpportunity, opportunityAction } from '../app/pipeline-estimates.mjs';
import { saveEstimate, estimateAction } from '../app/estimates.mjs';
// الفوز صار يشترط صفقة متعاقدًا عليها مفتوحة من الفرصة (الحزمة 4، الترحيل 181): المساعد يفتحها ويوصلها إلى اتفاق موثّق.
import { contractedDealFor } from './crm-fixture.mjs';

// بيانات تجريبية مصطنعة بالكامل.
const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-pipeline-estimates');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>{
    for(const [user,capability] of [['employee','commercial.use'],['employee','clients.manage'],['manager','commercial.use'],['outsider','commercial.use']])
      grantAccess(db,users.admin,{user_id:user,capability,department_id:capability==='commercial.use'?'creative':'',note:'منح تجريبي'});
  });
  const client=tx(()=>createClient(db,users.employee,{legal_name:'شركة تجريبية للتجزئة',sector:'التجزئة',status:'prospect'})).id;
  const second=tx(()=>createClient(db,users.employee,{legal_name:'جهة تجريبية للصحة',sector:'الصحة',status:'prospect'})).id;
  for(const c of [client,second])tx(()=>clientAction(db,users.employee,c,'add_member',{user_id:'manager',role:'مدير الفريق التجريبي'}));
  const stage=(by,input)=>tx(()=>prepareStage(db,by,{sort_order:1,probability_basis:'متوسط تجربة الشركة التجريبية في آخر سنة',confirmed_on:riyadh(),required_fields:[],idle_days:7,...input})).id;
  const approve=(id,by=users.manager)=>tx(()=>stageAction(db,by,id,'approve_stage',{version:db.prepare('SELECT version FROM pipeline_stages WHERE id=?').get(id).version,note:'اعتماد تجريبي'}));
  const opp=id=>db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
  const act=(by,id,action,input)=>tx(()=>opportunityAction(db,by,id,action,{version:opp(id).version,...input}));
  return {db,users,tx,client,second,stage,approve,opp,act};
}
const base={name:'فرصة تجريبية لحملة إطلاق',service_family:'campaigns',value:'100000.00',expected_close_on:'',decision_maker:'',budget_note:'',next_step:'',next_step_on:''};

test('pipeline: stage probabilities are entered with their basis and approved by someone else, and nothing exists until the owner defines it',t=>{
  const {db,users,tx,client,stage,approve}=fixture(t);
  const empty=pipelineBoard(db,users.employee);
  assert.equal(empty.stages.length,0,'no stage is invented');assert.equal(empty.setup_needed.length,2);
  assert.throws(()=>tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',...base})),code('stage'),'no opportunity before an approved stage exists');
  assert.throws(()=>stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10',probability_basis:'قصير'}),code('invalid_text'),'a probability needs its basis');
  assert.throws(()=>stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10',idle_days:0}),code('idle_days'),'no default idle threshold');
  const lead=stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10'});
  assert.throws(()=>approve(lead,users.employee),code('self_approval'));
  assert.throws(()=>db.prepare("UPDATE pipeline_stages SET status='approved',decided_by=prepared_by,decided_at='x',version=version+1 WHERE id=?").run(lead),/CHECK constraint/,'the database refuses self-approval too');
  approve(lead);
  assert.throws(()=>db.prepare('UPDATE pipeline_stages SET win_probability_bp=9000,version=version+1 WHERE id=?').run(lead),/replaced by a new revision/);
  // تعديل الاحتمال نسخة جديدة تحل محل السارية عند اعتمادها.
  const revised=stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'12.5'});
  assert.equal(pipelineBoard(db,users.employee).stages[0].win_probability_bp,1000,'the approved revision stays in force until the new one is approved');
  assert.ok(pipelineBoard(db,users.manager).awaiting_me.some(a=>a.id===revised));
  approve(revised);
  assert.equal(pipelineBoard(db,users.employee).stages[0].win_probability_bp,1250);
  assert.deepEqual(db.prepare("SELECT status FROM pipeline_stages WHERE code='LEAD' ORDER BY revision").all().map(r=>r.status),['retired','approved']);
  assert.ok(verifyAudit(db));
});

test('pipeline: a stage cannot be entered before its required fields are met, and the weighted forecast is labelled an estimate, not revenue',t=>{
  const {db,users,tx,client,stage,approve,opp,act}=fixture(t);
  approve(stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10',required_fields:['value_entered']}));
  approve(stage(users.employee,{code:'PROPOSED',name:'عرض مقدَّم',sort_order:2,win_probability:'50',required_fields:['value_entered','decision_maker','estimate_linked'],idle_days:5}));
  assert.throws(()=>tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',...base,value:'0'})),code('stage_requirements'));
  assert.throws(()=>tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'PROPOSED',...base,decision_maker:'مدير تسويق تجريبي'})),code('stage_requirements'),'no jumping straight to “proposal submitted”');
  const id=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',...base})).id;
  const blocked=pipelineBoard(db,users.employee).opportunities[0].moves.find(m=>m.code==='PROPOSED');
  assert.deepEqual(blocked.missing,['صاحب القرار لدى العميل مسجّل','تقدير مرفوع للاعتماد أو معتمد مرتبط بالفرصة'],'the owner sees what is missing before trying');
  assert.throws(()=>act(users.employee,id,'move',{stage_code:'PROPOSED',note:''}),code('stage_requirements'));
  act(users.employee,id,'edit',{...base,decision_maker:'مدير تسويق تجريبي'});
  assert.throws(()=>act(users.employee,id,'move',{stage_code:'PROPOSED',note:''}),error=>error.code==='stage_requirements'&&/تقدير/.test(error.message),'no proposal stage without an uploaded estimate');
  const estimate=tx(()=>saveEstimate(db,users.employee,{client_id:client,opportunity_id:id,name:'تقدير تجريبي',scope_note:'نطاق تجريبي لحملة الإطلاق',lines:[{role_name:'مصمم',deliverable:'هوية الحملة',hours:'10',sell_rate:'300.00'}]})).id;
  assert.throws(()=>act(users.employee,id,'move',{stage_code:'PROPOSED',note:''}),code('stage_requirements'),'a draft estimate is not an uploaded one');
  tx(()=>estimateAction(db,users.employee,estimate,'submit',{version:1}));
  act(users.employee,id,'move',{stage_code:'PROPOSED',note:'أُرسل التقدير للاعتماد الداخلي'});
  assert.throws(()=>act(users.employee,id,'edit',{...base,decision_maker:''}),code('stage_requirements'),'a field the current stage requires cannot be emptied');
  const board=pipelineBoard(db,users.employee);
  assert.equal(board.forecast.weighted_minor,5000000,'100,000.00 × 50%');
  assert.equal(board.forecast.open_value_minor,10000000);
  assert.match(board.forecast.warning,/تقدير لا إيراد/);assert.match(board.forecast.warning,/يدوية/);
  assert.deepEqual(opp(id).stage_code,'PROPOSED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM opportunity_stage_events WHERE opportunity_id=?').get(id).n,2);
  assert.ok(verifyAudit(db));
});

test('pipeline: an idle opportunity turns stale for its owner after the stage threshold, and a logged activity resets the counter',t=>{
  const {db,users,tx,client,stage,approve,opp,act}=fixture(t);
  approve(stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10',idle_days:7}));
  const id=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',...base})).id;
  assert.equal(pipelineBoard(db,users.employee).stale_mine.length,0);
  // محاكاة مرور الزمن: آخر نشاط قبل عشرة أيام.
  db.prepare('UPDATE opportunities SET last_activity_on=?,created_at=?,version=version+1 WHERE id=?').run(riyadh(-10),riyadh(-20)+'T00:00:00.000Z',id);
  const mine=pipelineBoard(db,users.employee);
  assert.deepEqual(mine.stale_mine.map(o=>[o.id,o.days_idle,o.idle_threshold]),[[id,10,7]]);
  assert.equal(pipelineBoard(db,users.manager).stale_mine.length,0,'the stale list is shown to the opportunity owner');
  act(users.employee,id,'activity',{activity_date:riyadh(-15),kind:'call',note:'اتصال تجريبي قديم'});
  assert.equal(opp(id).last_activity_on,riyadh(-10),'an older activity does not wind the counter back');
  act(users.manager,id,'activity',{activity_date:riyadh(),kind:'meeting',note:'اجتماع تجريبي مع العميل'});
  assert.equal(pipelineBoard(db,users.employee).stale_mine.length,0,'a logged activity resets the idle counter');
  assert.throws(()=>act(users.employee,id,'activity',{activity_date:riyadh(1),kind:'call',note:'نشاط في المستقبل'}),code('activity_date'));
  assert.ok(verifyAudit(db));
});

test('pipeline: closing lost demands a listed reason and a comment, a closed opportunity is final, and win/loss is reported by reason, sector and service',t=>{
  const {db,users,tx,client,second,stage,approve,opp,act}=fixture(t);
  approve(stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10'}));
  const lost=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',...base})).id;
  const won=tx(()=>createOpportunity(db,users.employee,{client_id:second,stage_code:'LEAD',...base,service_family:'branding',value:'40000.00'})).id;
  const lostToo=tx(()=>createOpportunity(db,users.employee,{client_id:second,stage_code:'LEAD',...base,value:'25000.00'})).id;
  assert.throws(()=>act(users.employee,lost,'lose',{loss_reason_id:'',comment:'خسرنا بسبب السعر المرتفع'}),code('loss_reason_required'));
  const price=tx(()=>addLossReason(db,users.employee,{code:'PRICE',name:'السعر أعلى من المنافس'})).id;
  const timing=tx(()=>addLossReason(db,users.employee,{code:'TIMING',name:'توقيت العميل تغيّر'})).id;
  assert.throws(()=>act(users.employee,lost,'lose',{loss_reason_id:price,comment:'قصير'}),code('invalid_text'),'the comment is mandatory');
  assert.throws(()=>db.prepare("UPDATE opportunities SET status='lost',closed_on='2026-01-01',closed_by='employee',version=version+1 WHERE id=?").run(lost),/CHECK constraint/,'the database refuses a loss without a reason');
  assert.throws(()=>act(users.manager,lost,'lose',{loss_reason_id:price,comment:'ليس صاحب الفرصة'}),code('action_unavailable'),'only the owner closes');
  act(users.employee,lost,'lose',{loss_reason_id:price,comment:'العميل اختار عرضًا أرخص بفارق كبير'});
  act(users.employee,lostToo,'lose',{loss_reason_id:price,comment:'السعر مرة أخرى؛ نراجع بطاقة الأسعار'});
  contractedDealFor(db,users,won);
  act(users.employee,won,'win',{note:'موافقة العميل التجريبية بالبريد'});
  assert.throws(()=>db.prepare("UPDATE opportunities SET loss_comment='إعادة كتابة',version=version+1 WHERE id=?").run(lost),/closed opportunity is final/);
  assert.throws(()=>act(users.employee,lost,'activity',{activity_date:riyadh(),kind:'call',note:'بعد الإغلاق'}),code('action_unavailable'));
  tx(()=>lossReasonAction(db,users.employee,timing,'deactivate_reason',{version:1}));
  const board=pipelineBoard(db,users.employee),report=board.report;
  assert.equal(board.loss_reasons.find(r=>r.id===timing).active,false);
  assert.deepEqual(report.by_reason.map(r=>[r.name,r.count,r.value_minor]),[['السعر أعلى من المنافس',2,12500000]]);
  assert.deepEqual(report.total&&[report.total.won_count,report.total.lost_count,report.total.won_value_minor,report.total.lost_value_minor],[1,2,4000000,12500000]);
  const health=report.by_sector.find(s=>s.key==='الصحة');
  assert.deepEqual([health.won_count,health.lost_count,health.win_rate_count_bp],[1,1,5000]);
  assert.deepEqual(report.by_family.map(f=>f.key).sort(),['branding','campaigns']);
  assert.equal(report.comments.length,2);assert.equal(report.loss_by_month.length,1);
  assert.equal(board.forecast.open_count,0);assert.equal(opp(lost).status,'lost');
  assert.ok(verifyAudit(db));
});

test('pipeline: capability, client team and tenant isolation, and optimistic versions',t=>{
  const {db,users,tx,client,stage,approve,opp,act}=fixture(t);
  approve(stage(users.employee,{code:'LEAD',name:'فرصة أولية',win_probability:'10'}));
  const id=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',...base})).id;
  assert.throws(()=>pipelineBoard(db,users.hr),error=>['forbidden','not_permitted'].includes(error.code),'no commercial.use, no pipeline');
  assert.throws(()=>pipelineBoard(db,users.external),error=>['forbidden','not_permitted'].includes(error.code));
  assert.equal(pipelineBoard(db,users.outsider).opportunities.length,0,'a colleague outside the client team sees nothing');
  assert.throws(()=>act(users.outsider,id,'activity',{activity_date:riyadh(),kind:'call',note:'خارج الفريق'}),code('not_found'));
  assert.throws(()=>tx(()=>createOpportunity(db,users.outsider,{client_id:client,stage_code:'LEAD',...base})),code('not_found'));
  assert.throws(()=>tx(()=>opportunityAction(db,users.employee,id,'edit',{version:opp(id).version+1,...base})),code('stale_version'));
  assert.throws(()=>db.prepare("INSERT INTO opportunities(id,tenant_id,client_id,name,service_family,value_minor,stage_code,owner_id,status,last_activity_on,created_at,updated_at) VALUES('x','isolated',?,'تسرب بين الكيانات','campaigns',0,'LEAD','external','open','2026-01-01','t','t')").run(client),/one tenant/);
  assert.equal(pipelineBoard(db,users.manager).opportunities[0].actions.includes('move_stage'),false,'a team member logs activity but does not move someone else’s deal');
  assert.ok(verifyAudit(db));
});
