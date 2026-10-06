import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createCycle, cycleAction, performanceBoard, reviewAction, growthBoard, requestTraining, trainingAction, setGoal, goalAction, createPlan, planAction } from '../app/talent.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-talent');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('panel','36t','hr','panel','عضو لجنة تظلمات مصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const who of ['hr-manager','panel'])tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'hr.performance.calibrate',note:'تصريح معايرة مصطنع'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.succession.manage',note:'تصريح تعاقب مصطنع'}));
  const cycleInput={name:'تقييم 2026 المصطنع',period_from:'2026-01-01',period_to:'2026-12-31',scale_max:5,criteria:[{name:'جودة التسليم',weight:50},{name:'التعاون',weight:30},{name:'التطور المهني',weight:20}]};
  const cycle=()=>performanceBoard(db,users.hr).cycles[0];
  const review=(viewer,userId)=>performanceBoard(db,users[viewer]).cycles[0].reviews.find(r=>r.user_id===userId);
  const act=(who,userId,action,values={})=>tx(()=>reviewAction(db,users[who],review(who,userId).id,action,{version:review(who,userId).version,...values}));
  const scores=[{key:'c1',score:4,evidence:'سلّم ثلاث حملات في موعدها بلا إعادة عمل'},{key:'c2',score:3,evidence:'تعاون جيد مع فريق الحسابات في مشروعين'},{key:'c3',score:5,evidence:'أكمل شهادة مهنية وطبقها في العمل'}];
  return {db,users,tx,cycleInput,cycle,review,act,scores};
}

test('TAL-05: weights must total 100, the cycle opens one review per employee with an active manager, and scores stay hidden from the employee until release',t=>{
  const {db,users,tx,cycleInput,cycle,review,act,scores}=fixture(t);
  assert.throws(()=>tx(()=>createCycle(db,users.manager,cycleInput)),code('not_permitted'));
  assert.throws(()=>tx(()=>createCycle(db,users.hr,{...cycleInput,criteria:[{name:'أ أ أ',weight:60},{name:'ب ب ب',weight:30}]})),code('criteria'));
  tx(()=>createCycle(db,users.hr,cycleInput));
  const opened=tx(()=>cycleAction(db,users.hr,cycle().id,'open',{version:cycle().version}));
  assert.ok(opened.skipped_without_manager.length>0,'people without a manager are reported, not silently dropped');
  assert.equal(review('employee','employee').status,'self');
  assert.equal(performanceBoard(db,users.outsider).cycles[0]?.reviews.some(r=>r.user_id==='employee')??false,false,'a colleague sees nothing of it');
  assert.throws(()=>act('manager','employee','submit_manager',{scores,summary:'ملخص مصطنع لأداء الموظفة خلال السنة'}),code('invalid_state'),'the manager waits for the self assessment');
  act('employee','employee','submit_self',{self_text:'أنجزت ثلاث حملات رئيسية وطورت مهاراتي في التحليل خلال السنة المصطنعة.'});
  assert.throws(()=>act('manager','employee','submit_manager',{scores:scores.slice(0,2),summary:'ملخص مصطنع لأداء الموظفة خلال السنة'}),code('scores'));
  assert.throws(()=>act('manager','employee','submit_manager',{scores:scores.map(s=>({...s,evidence:'قصير'})),summary:'ملخص مصطنع لأداء الموظفة خلال السنة'}),code('invalid_text'));
  act('manager','employee','submit_manager',{scores,summary:'أداء قوي في التسليم مع حاجة لتوسيع التعاون بين الفرق'});
  assert.equal(review('manager','employee').manager_score_bp,390,'4×50 + 3×30 + 5×20');
  const mine=review('employee','employee');assert.equal(mine.result_hidden,true);assert.equal(mine.manager_score_bp,null);assert.deepEqual(mine.scores,[]);
  assert.throws(()=>db.prepare("UPDATE performance_reviews SET manager_score_bp=500,version=version+1 WHERE user_id='employee'").run(),/final/);
});

test('TAL-06: calibration is by a third person, a changed score needs a reason, release is not by the cycle creator, and one appeal is decided by someone who neither scored nor calibrated',t=>{
  const {db,users,tx,cycleInput,cycle,review,act,scores}=fixture(t);
  tx(()=>createCycle(db,users.hr,cycleInput));tx(()=>cycleAction(db,users.hr,cycle().id,'open',{version:cycle().version}));
  act('employee','employee','submit_self',{self_text:'أنجزت ثلاث حملات رئيسية وطورت مهاراتي في التحليل خلال السنة المصطنعة.'});
  act('manager','employee','submit_manager',{scores,summary:'أداء قوي في التسليم مع حاجة لتوسيع التعاون بين الفرق'});
  assert.throws(()=>tx(()=>cycleAction(db,users.hr,cycle().id,'to_calibration',{version:cycle().version})),code('reviews_incomplete'));
  assert.throws(()=>act('manager','outsider','exclude_review',{note:'المدير لا يستبعد تقييمًا'}),code('invalid_state'));
  act('hr','outsider','exclude_review',{note:'في إجازة طويلة طوال فترة التقييم المصطنعة'});
  tx(()=>cycleAction(db,users.hr,cycle().id,'to_calibration',{version:cycle().version}));
  // حاملة تصريح المعايرة لا تعاير تقييمًا كتبته بنفسها.
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.performance.calibrate',note:'اختبار فصل المهام'}));
  assert.throws(()=>act('manager','employee','calibrate',{final_score:'3.90',note:'تأكيد'}),code('invalid_state'));
  assert.throws(()=>act('hr-manager','employee','calibrate',{final_score:'3.50',note:'قصير'}),code('invalid_text'),'changing the manager score needs a real reason');
  assert.throws(()=>act('hr-manager','employee','calibrate',{final_score:'6',note:'خارج السلم المعتمد لهذه الدورة'}),code('score'));
  act('hr-manager','employee','calibrate',{final_score:'3.50',note:'مواءمة مع توزيع الفريق بعد مراجعة أدلة المعيار الثالث'});
  assert.equal(review('employee','employee').result_hidden,true,'calibrated is still not released');
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.performance.calibrate',note:'اختبار فصل المهام'}));
  assert.throws(()=>tx(()=>cycleAction(db,users.hr,cycle().id,'release',{version:cycle().version})),code('separation_of_duties'));
  tx(()=>cycleAction(db,users['hr-manager'],cycle().id,'release',{version:cycle().version}));
  const released=review('employee','employee');
  assert.equal(released.final_score_bp,350);assert.equal(released.manager_score_bp,390,'the manager score is kept beside the calibrated one');assert.deepEqual(released.actions,['acknowledge','appeal']);
  act('employee','employee','appeal',{appeal_text:'أرى أن تخفيض الدرجة لم يراعِ أدلة التطور المهني المقدمة في التقييم.'});
  assert.throws(()=>act('hr-manager','employee','decide_appeal',{outcome:'upheld',final_score:'',note:'من عاير لا يبت في التظلم من معايرته'}),code('invalid_state'));
  assert.throws(()=>act('manager','employee','decide_appeal',{outcome:'upheld',final_score:'',note:'المدير المقيّم لا يبت في التظلم من تقييمه'}),code('invalid_state'));
  assert.throws(()=>act('panel','employee','decide_appeal',{outcome:'changed',final_score:'3.50',note:'تعديل بلا تغيير فعلي في الدرجة النهائية'}),code('outcome'));
  act('panel','employee','decide_appeal',{outcome:'changed',final_score:'3.80',note:'أدلة المعيار الثالث موثقة وتبرر درجة أعلى من المعايرة'});
  const final=review('employee','employee');assert.equal(final.final_score_bp,380);assert.equal(final.status,'appeal_decided');assert.deepEqual(final.actions,[]);
  assert.throws(()=>db.prepare("UPDATE performance_reviews SET final_score_bp=500,version=version+1 WHERE user_id='employee'").run(),/final/);
  assert.match(performanceBoard(db,users.employee).rule,/لا تغيّر راتبًا/);
  assert.ok(verifyAudit(db));
});

test('TAL-07/08: training is approved by the manager and completed with evidence; a goal is closed by the manager, not by its owner',t=>{
  const {db,users,tx}=fixture(t);
  const input={user_id:'',title:'دورة تحليل بيانات مصطنعة',provider:'جهة تدريب مصطنعة',kind:'course',hours:16,start_date:addDays(today(),10),end_date:addDays(today(),12),purpose:'تحسين تقارير أداء الحملات للعملاء'};
  const id=tx(()=>requestTraining(db,users.employee,input)).id,row=who=>growthBoard(db,users[who]).training.find(x=>x.id===id);
  assert.throws(()=>tx(()=>requestTraining(db,users.employee,{...input,user_id:'outsider'})),code('not_permitted'));
  assert.throws(()=>tx(()=>trainingAction(db,users.employee,id,'approve',{version:row('employee').version,note:'اعتماد ذاتي'})),code('invalid_state'));
  assert.equal(row('outsider'),undefined);
  tx(()=>trainingAction(db,users.manager,id,'approve',{version:row('manager').version,note:'ضمن خطة الفريق'}));
  assert.throws(()=>tx(()=>trainingAction(db,users.employee,id,'complete',{version:row('employee').version,completion_reference:''})),code('invalid_text'));
  tx(()=>trainingAction(db,users.employee,id,'complete',{version:row('employee').version,completion_reference:'شهادة حضور مصطنعة رقم 12 محفوظة في ملف الموظف'}));
  assert.equal(growthBoard(db,users.employee).my_completed_hours_this_year>=0,true);
  const goalId=tx(()=>setGoal(db,users.manager,{user_id:'employee',goal:'قيادة تقرير أداء شهري لعميل واحد دون مراجعة',measure:'ثلاثة تقارير متتالية بلا ملاحظات جوهرية',due_date:addDays(today(),90),review_id:''})).id,goal=who=>growthBoard(db,users[who]).goals.find(g=>g.id===goalId);
  assert.deepEqual(goal('employee').actions,['note_goal']);
  tx(()=>goalAction(db,users.employee,goalId,'note',{version:goal('employee').version,note:'سلمت التقرير الأول واعتمده مدير الحساب'}));
  assert.throws(()=>tx(()=>goalAction(db,users.employee,goalId,'achieve',{version:goal('employee').version,note:'أعلن تحقق هدفي بنفسي'})),code('invalid_state'));
  tx(()=>goalAction(db,users.manager,goalId,'achieve',{version:goal('manager').version,note:'اكتملت التقارير الثلاثة بلا ملاحظات'}));
  assert.equal(goal('employee').status,'achieved');assert.equal(goal('employee').progress.length,1);
});

test('TAL-09: succession plans are visible only to their capability holders, never to the position holder or a listed candidate',t=>{
  const {db,users,tx}=fixture(t);
  assert.equal(growthBoard(db,users.hr).succession,null,'HR officers without the grant see no succession data');
  assert.throws(()=>tx(()=>createPlan(db,users.hr,{position_title:'مدير إبداعي',holder_id:'manager',criticality:'high',risk_note:'توقف اعتماد المخرجات الإبداعية عند الشغور'})),code('not_permitted'));
  const planId=tx(()=>createPlan(db,users['hr-manager'],{position_title:'مدير إبداعي',holder_id:'manager',criticality:'high',risk_note:'توقف اعتماد المخرجات الإبداعية عند الشغور'})).id;
  const plan=()=>growthBoard(db,users['hr-manager']).succession.plans.find(p=>p.id===planId);
  assert.equal(plan().gap,true,'no ready-now successor is flagged');
  const candidate={user_id:'employee',readiness:'one_two_years',strengths:'جودة تسليم عالية وثقة العملاء',gaps:'لم تقُد فريقًا ولم تدر ميزانية',development_action:'قيادة مشروع متوسط مع إشراف ربع سنوي'};
  assert.throws(()=>tx(()=>planAction(db,users['hr-manager'],planId,'add_candidate',{version:plan().version,...candidate,user_id:'manager'})),code('separation_of_duties'));
  tx(()=>planAction(db,users['hr-manager'],planId,'add_candidate',{version:plan().version,...candidate}));
  assert.throws(()=>tx(()=>planAction(db,users['hr-manager'],planId,'add_candidate',{version:plan().version,...candidate})),code('duplicate_candidate'));
  // حتى لو مُنح شاغل المنصب أو المرشح التصريح لا يرى الخطة التي تخصه.
  for(const who of ['manager','employee']){tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'hr.succession.manage',note:'اختبار السرية'}));assert.deepEqual(growthBoard(db,users[who]).succession.plans.filter(p=>p.id===planId),[]);assert.throws(()=>tx(()=>planAction(db,users[who],planId,'archive_plan',{version:1,note:'محاولة أرشفة خطة لا يراها'})),code('not_found'));}
  tx(()=>planAction(db,users['hr-manager'],planId,'remove_candidate',{version:plan().version,candidate_id:plan().candidates[0].id,note:'انتقلت إلى مسار تخصصي بطلبها'}));
  assert.equal(plan().candidates[0].active,false,'history is kept');
  assert.throws(()=>db.prepare("UPDATE succession_candidates SET readiness='ready_now'").run(),/replaced by removal/);
});
