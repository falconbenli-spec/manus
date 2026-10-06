import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import {
  operationsBoard,
  createCompetency, competencyAction, recordCompetencyAssessment,
  createImprovementPlan, improvementPlanAction, addImprovementCheckpoint,
  createGeneralSurvey, generalSurveyAction, submitGeneralSurvey, generalSurveyExport
} from '../app/hr-operations.mjs';

const code=value=>error=>error?.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(iso,days)=>new Date(Date.parse(`${iso}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hr-operations');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-reviewer','36t','hr','hr-reviewer','مراجع موارد بشرية مصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(row=>[row.id,row]));
  const tx=fn=>transaction(db,fn);
  for(const capability of ['hr.operations.use','hr.competency.manage','hr.pip.manage','hr.survey.manage','hr.performance.calibrate']){
    tx(()=>grantAccess(db,users.admin,{user_id:'hr-reviewer',capability,note:'فصل مهام مصطنع لاختبار مركز الموارد البشرية'}));
  }
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.performance.calibrate',note:'اختبار منع اعتماد المعد لتعريفه'}));
  return {db,users,tx};
}

test('مركز عمليات الموارد البشرية يجمع الوحدات الفعلية ويمنع الحسابات غير المخولة',t=>{
  const {db,users}=fixture(t);
  const board=operationsBoard(db,users.hr);
  assert.equal(board.sections.length,8);
  assert.ok(board.sections.flatMap(section=>section.services).some(service=>service.route==='employees'));
  assert.ok(board.sections.flatMap(section=>section.services).some(service=>service.route==='hr-operations'&&service.key==='competencies'));
  assert.ok(board.permissions.includes('hr.operations.use'));
  assert.ok(board.departments.some(department=>department.id==='hr'));
  assert.equal(operationsBoard(db,users.employee).sections.length,0);
  assert.deepEqual(operationsBoard(db,users.employee).departments,[]);
});

test('قاموس الكفاءات يعتمد بفصل مهام وتعرض المصفوفة فجوة مثبتة بالدليل',t=>{
  const {db,users,tx}=fixture(t);
  const competencyId=tx(()=>createCompetency(db,users.hr,{
    code:'CLIENT-STRATEGY',name:'استراتيجية العميل',category:'تجارية',description:'تحويل حاجة العميل إلى قرار قابل للقياس',
    levels:[
      'يفهم المصطلحات الأساسية ويطلب التوجيه',
      'ينفذ تحليلًا محدودًا بإشراف',
      'يبني توصية مستقلة ويشرح أثرها',
      'يقود قرارات معقدة بين عدة فرق',
      'يضع المنهج المؤسسي ويطور الممارسين'
    ]
  })).id;
  let competency=operationsBoard(db,users.hr).competencies.find(row=>row.id===competencyId);
  assert.throws(()=>tx(()=>competencyAction(db,users.hr,competencyId,'activate',{version:competency.version,note:'أعتمد تعريفي بنفسي'})),code('separation_of_duties'));
  tx(()=>competencyAction(db,users['hr-reviewer'],competencyId,'activate',{version:competency.version,note:'راجعت المستويات الخمسة وربطها بالدور'}));
  competency=operationsBoard(db,users.hr).competencies.find(row=>row.id===competencyId);
  assert.equal(competency.status,'active');
  tx(()=>recordCompetencyAssessment(db,users.manager,{
    employee_id:'employee',competency_id:competencyId,target_level:4,current_level:2,
    evidence:'عرضان لعميلين أظهرا حاجة إلى تعميق تحليل الأثر التجاري',development_action:'مرافقة مدير الحساب في عرضين ثم قيادة العرض الثالث',review_on:addDays(today(),45)
  }));
  const mine=operationsBoard(db,users.employee).my_competencies[0];
  assert.equal(mine.gap,2);
  assert.equal(mine.target_level,4);
  assert.match(mine.evidence,/عرضان/);
  assert.equal(operationsBoard(db,users.outsider).my_competencies.length,0);
  assert.ok(verifyAudit(db));
});

test('خطة تحسين الأداء تمر من اقتراح المدير إلى مراجعة الموارد البشرية ثم إقرار الموظف ونقاط المتابعة والإقفال',t=>{
  const {db,users,tx}=fixture(t);
  const planId=tx(()=>createImprovementPlan(db,users.manager,{
    employee_id:'employee',title:'تحسين انتظام التسليم',reason:'تكرر تأخر ثلاثة مخرجات عن التاريخ المتفق عليه دون تنبيه مسبق',
    objectives:[
      {objective:'تسليم المهام الأسبوعية في موعدها',measure:'أربع أسابيع متتالية بلا تأخير غير مبرر'},
      {objective:'رفع التنبيه المبكر عن العوائق',measure:'توثيق العائق خلال يوم عمل من ظهوره'}
    ],support:'اجتماع أسبوعي مع المدير وإزالة العوائق المسجلة',starts_on:today(),ends_on:addDays(today(),60)
  })).id;
  let plan=operationsBoard(db,users.manager).improvement_plans.find(row=>row.id===planId);
  tx(()=>improvementPlanAction(db,users.manager,planId,'submit',{version:plan.version,note:'راجعت الوقائع والأهداف مع الموارد البشرية'}));
  plan=operationsBoard(db,users.hr).improvement_plans.find(row=>row.id===planId);
  assert.throws(()=>tx(()=>improvementPlanAction(db,users.manager,planId,'activate',{version:plan.version,note:'أفعل خطتي بنفسي'})),code('not_permitted'));
  tx(()=>improvementPlanAction(db,users['hr-reviewer'],planId,'activate',{version:plan.version,note:'تحققت من الوقائع والمدة والدعم وعدم وجود إجراء تأديبي مخفي'}));
  plan=operationsBoard(db,users.employee).improvement_plans.find(row=>row.id===planId);
  tx(()=>improvementPlanAction(db,users.employee,planId,'acknowledge',{version:plan.version,note:'اطلعت على الخطة وسأضيف ملاحظتي عند الحاجة'}));
  plan=operationsBoard(db,users.manager).improvement_plans.find(row=>row.id===planId);
  tx(()=>addImprovementCheckpoint(db,users.manager,planId,{version:plan.version,progress:'on_track',evidence:'اكتملت مهام الأسبوع الأول والثاني في الموعد',next_action:'الاستمرار على المتابعة الأسبوعية'}));
  plan=operationsBoard(db,users['hr-reviewer']).improvement_plans.find(row=>row.id===planId);
  tx(()=>improvementPlanAction(db,users['hr-reviewer'],planId,'close',{version:plan.version,outcome:'completed',note:'تحققت المقاييس خلال مدة الخطة وثبتت في نقطتي المتابعة'}));
  const closed=operationsBoard(db,users.employee).improvement_plans.find(row=>row.id===planId);
  assert.equal(closed.status,'completed');
  assert.equal(closed.checkpoints.length,1);
  assert.ok(closed.acknowledged_at);
  assert.ok(verifyAudit(db));
});

test('الاستبانة العامة تثبت الأسئلة عند الفتح وتحمي الرد المجهول من الربط بصاحبه',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>createGeneralSurvey(db,users.hr,{
    title:'استبانة ضيقة مجهولة',purpose:'اختبار حماية هوية المشاركين في الجمهور الصغير',identity_mode:'anonymous',audience_kind:'department',department_id:'hr',
    opens_on:today(),closes_on:today(),questions:[{kind:'rating',prompt:'هل الخدمة واضحة؟',options:[]}]
  })),code('privacy_scope'));
  const surveyId=tx(()=>createGeneralSurvey(db,users.hr,{
    title:'جاهزية أدوات العمل',purpose:'تحديد أولويات تحسين الأدوات الداخلية',identity_mode:'anonymous',audience_kind:'all',department_id:'',
    opens_on:today(),closes_on:today(),questions:[
      {kind:'rating',prompt:'أدوات العمل تساعدني على إنجاز المهمة',options:[]},
      {kind:'choice',prompt:'ما الأولوية الأعلى؟',options:['البحث','السرعة','وضوح الإجراءات']}
    ]
  })).id;
  let survey=operationsBoard(db,users.hr).surveys.find(row=>row.id===surveyId);
  assert.throws(()=>tx(()=>generalSurveyAction(db,users.hr,surveyId,'open',{version:survey.version,note:'أفتح ما أعددته'})),code('separation_of_duties'));
  tx(()=>generalSurveyAction(db,users['hr-reviewer'],surveyId,'open',{version:survey.version,note:'راجعت الأسئلة والجمهور ووعد السرية'}));
  survey=operationsBoard(db,users.employee).surveys.find(row=>row.id===surveyId);
  tx(()=>submitGeneralSurvey(db,users.employee,surveyId,{answers:survey.questions.map((question,index)=>({question_id:question.id,value:index===0?'5':'البحث'}))}));
  assert.throws(()=>tx(()=>submitGeneralSurvey(db,users.employee,surveyId,{answers:survey.questions.map(question=>({question_id:question.id,value:'5'}))})),code('already_responded'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hr_general_survey_answers_anonymous WHERE survey_id=?').get(surveyId).n,2);
  const answerColumns=db.prepare('PRAGMA table_info(hr_general_survey_answers_anonymous)').all().map(row=>row.name);
  assert.ok(!answerColumns.some(name=>/user|employee|actor|created_at|time/i.test(name)),answerColumns.join(','));
  assert.throws(()=>db.prepare("UPDATE hr_general_survey_questions SET prompt='تغيير صامت' WHERE survey_id=?").run(surveyId),/fixed/);
  for(const who of ['manager','outsider','it','hr-reviewer']){
    const open=operationsBoard(db,users[who]).surveys.find(row=>row.id===surveyId);
    tx(()=>submitGeneralSurvey(db,users[who],surveyId,{answers:open.questions.map((question,index)=>({question_id:question.id,value:index===0?'5':'البحث'}))}));
  }
  survey=operationsBoard(db,users.hr).surveys.find(row=>row.id===surveyId);
  tx(()=>generalSurveyAction(db,users.hr,surveyId,'close',{version:survey.version,note:'انتهت الفترة وجُمعت خمسة ردود وفق وعد السرية'}));
  const exported=generalSurveyExport(db,users.hr,surveyId);
  assert.equal(exported.results.available,true);
  assert.equal(exported.results.respondents,5);
  assert.equal(exported.results.questions[0].bands[0].count,5);
  assert.ok(!JSON.stringify(exported).includes(users.employee.name));
  assert.throws(()=>db.prepare('DELETE FROM hr_general_survey_answers_anonymous WHERE survey_id=?').run(surveyId),/retained/);
  assert.ok(verifyAudit(db));
});
