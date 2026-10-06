import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { holds } from './access.mjs';
import { riyadhToday } from './riyadh-time.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { personName, activeEmployeeAssignment, activeEmployeePage, isDirectManager } from './people-read.mjs';
import { hcmCoverage } from './hcm-reference.mjs';
import { hrTeamAccessBoard } from './hr-team-access.mjs';

const id=()=>randomUUID();
const today=()=>riyadhToday();
const CAPABILITIES=['hr.operations.use','hr.competency.manage','hr.pip.manage','hr.survey.manage','hr.performance.calibrate','hr.permissions.delegate'];
const LEVELS=[1,2,3,4,5];
const QUESTION_KINDS={rating:'تقييم من 1 إلى 5',text:'إجابة نصية',choice:'اختيار واحد',yes_no:'نعم أو لا'};
const PIP_STATUS={draft:'مسودة لدى المدير',hr_review:'بانتظار مراجعة الموارد البشرية',active:'خطة نشطة',completed:'اكتملت',extended:'ممددة',cancelled:'ملغاة'};

function actor(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(u.role==='admin')refuse(403,'forbidden',{what:'مركز عمليات الموارد البشرية لحسابات الموظفين المخولة لا لحساب إدارة المنصة',next:'سجّل الدخول بحساب موظف الموارد البشرية'});
  u.caps=CAPABILITIES.filter(capability=>holds(db,u,capability));
  return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const reject=(status,code,what,next='صحّح البيانات أو افتح السجل من مركز عمليات الموارد البشرية ثم أعد المحاولة')=>refuse(status,code,{what,next});
const need=(u,capability,message)=>{if(!u.caps.includes(capability))refuse(403,'not_permitted',{what:message,missing:[{document:`تصريح ${capability}`,owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب التصريح ثم أعد فتح مركز عمليات الموارد البشرية'});};
const name=personName;
const isManagerOf=(db,u,userId)=>isDirectManager(db,u.tenant_id,u.id,userId);
function employee(db,u,userId){
  const row=typeof userId==='string'&&activeEmployeeAssignment(db,u.tenant_id,userId);
  if(!row)reject(404,'not_found','لا يمكن فتح الموظف المحدد ضمن كيانك');
  return row;
}
const version=(row,input)=>v.version(input?.version,row.version);
function canSeeEmployee(db,u,userId){return userId===u.id||isManagerOf(db,u,userId)||u.caps.includes('hr.operations.use')||u.caps.includes('hr.competency.manage')||u.caps.includes('hr.pip.manage');}

const SERVICES=[
  {title:'القوى العاملة والملفات',services:[['employees','سجل الموظفين','employees.view'],['people','الاستقطاب','people.manage'],['lifecycle','التعيين والمغادرة','people.manage'],['clearance','إخلاء الطرف','people.manage'],['workforce','تركيبة القوى العاملة','hr.workforce.view']]},
  {title:'الوقت والإجازات',services:[['attendance','الحضور والانصراف','hr.attendance.manage'],['leave','الإجازات','leave.use'],['leave-accrual','استحقاق الإجازات','hr.policy.prepare'],['travel','السفر والانتداب','hr.policy.prepare']]},
  {title:'التعويضات والمزايا',services:[['payroll','مسير الرواتب','payroll.prepare'],['payroll-extras','حركات الرواتب','payroll.prepare'],['compensation','مراجعة الرواتب','hr.compensation.review'],['benefits-admin','إدارة المزايا','hr.benefits.manage'],['payroll-insurance','حالات التأمينات','hr.workforce.view']]},
  {title:'الأداء والتطوير',services:[['performance','تقييم الأداء','hr.performance.manage'],['growth','التدريب والتطوير والتعاقب','hr.performance.manage'],['hr-operations','قاموس الكفاءات ومصفوفة المهارات','hr.competency.manage','competencies'],['hr-operations','خطط تحسين الأداء','hr.pip.manage','improvement-plans'],['review-360','التغذية الراجعة 360','hr.feedback.manage'],['one-to-ones','اللقاءات الفردية','hr.feedback.manage']]},
  {title:'التجربة والارتباط',services:[['pulse','استبيان النبض','hr.survey.manage'],['hr-operations','الاستبانات العامة','hr.survey.manage','surveys'],['recognition','التقدير','hr.survey.manage'],['announcements','الإعلانات والفعاليات','hr.survey.manage']]},
  {title:'العقود والسياسات',services:[['contracts','العقود وبنود الراتب','hr.contracts.manage'],['hr-policies','سياسات الموارد البشرية','hr.policy.prepare'],['policy-library','مكتبة السياسات','portal.use'],['policy-acknowledgements','إقرارات السياسات','portal.use'],['letters','خطابات الموظفين','hr.letters.prepare']]},
  {title:'الحالات والامتثال',services:[['hr-cases','الحالات السرية','hr.cases.handle'],['discipline','المخالفات والجزاءات','hr.discipline.propose'],['expiry','انتهاء الوثائق','employees.view'],['privacy','حماية البيانات الشخصية','privacy.manage']]},
  {title:'الخدمة الذاتية والتشغيل',services:[['portal','بوابة الموظف','portal.use'],['my-requests','طلبات الموظف','requests.use'],['forms','النماذج الإلكترونية','forms.fill'],['delegations','التفويضات','delegations.use'],['resourcing','خطة الموارد والسعة','resourcing.view']]}
];

function serviceSections(db,u){
  if(!u.caps.includes('hr.operations.use'))return [];
  return SERVICES.map(section=>({title:section.title,services:section.services.map(([route,label,capability,key=route])=>({route,label,capability,key,available:holds(db,u,capability)}))}));
}

function competencyRows(db,u){
  const wide=u.caps.includes('hr.competency.manage')||u.caps.includes('hr.operations.use');
  const rows=db.prepare(`SELECT * FROM hr_competencies WHERE tenant_id=? ${wide?'':"AND status='active'"} ORDER BY category,name`).all(u.tenant_id);
  return rows.map(row=>({
    ...row,levels:JSON.parse(row.levels_json),prepared_by_name:name(db,row.prepared_by),accepted_by_name:name(db,row.accepted_by),
    actions:[...(row.status==='draft'&&u.caps.includes('hr.performance.calibrate')&&row.prepared_by!==u.id?['activate']:[]),...(row.status==='active'&&u.caps.includes('hr.competency.manage')?['retire']:[])]
  }));
}
function assessmentRows(db,u){
  const rows=db.prepare(`SELECT a.*,c.code,c.name AS competency_name,c.category FROM hr_employee_competencies a JOIN hr_competencies c ON c.id=a.competency_id WHERE a.tenant_id=? ORDER BY a.review_on,a.employee_id,c.name`).all(u.tenant_id);
  return rows.filter(row=>canSeeEmployee(db,u,row.employee_id)).map(row=>({...row,employee_name:name(db,row.employee_id),assessed_by_name:name(db,row.assessed_by),gap:Math.max(0,row.target_level-row.current_level)}));
}
function planRows(db,u){
  const rows=db.prepare('SELECT * FROM hr_performance_improvement_plans WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id);
  return rows.filter(row=>canSeeEmployee(db,u,row.employee_id)).map(row=>{
    const actions=[];
    if(row.status==='draft'&&row.proposed_by===u.id)actions.push('submit');
    if(row.status==='hr_review'&&u.caps.includes('hr.pip.manage')&&row.proposed_by!==u.id)actions.push('activate','cancel');
    if(row.status==='active'&&row.employee_id===u.id&&!row.acknowledged_at)actions.push('acknowledge');
    if(row.status==='active'&&(isManagerOf(db,u,row.employee_id)||u.caps.includes('hr.pip.manage')))actions.push('add_checkpoint');
    if(row.status==='active'&&u.caps.includes('hr.pip.manage')&&row.proposed_by!==u.id)actions.push('close');
    const checkpoints=db.prepare('SELECT * FROM hr_pip_checkpoints WHERE plan_id=? ORDER BY recorded_at').all(row.id).map(item=>({...item,recorded_by_name:name(db,item.recorded_by)}));
    return {...row,employee_name:name(db,row.employee_id),proposed_by_name:name(db,row.proposed_by),activated_by_name:name(db,row.activated_by),closed_by_name:name(db,row.closed_by),objectives:JSON.parse(row.objectives_json),status_name:PIP_STATUS[row.status],checkpoints,actions};
  });
}
function surveyAudience(db,u,survey){return survey.audience_kind==='all'||survey.department_id===u.department_id;}
function safeBands(values,minimum){
  const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)??0)+1);
  return [...counts.entries()].every(([,count])=>count>=minimum)?[...counts.entries()].map(([value,count])=>({value,count})):null;
}
function surveyResults(db,u,survey,questions,participantCount){
  if(survey.status!=='closed')return {available:false,reason:'النتائج لا تظهر قبل إغلاق الاستبانة حتى لا تكشف الإجابات بالتغيّر بين قراءتين.',questions:[]};
  if(survey.identity_mode==='anonymous'&&participantCount<survey.min_respondents)return {available:false,reason:`عدد المشاركين دون الحد الأدنى (${survey.min_respondents})، لذلك تبقى النتائج المجهولة محجوبة.`,questions:[]};
  const table=survey.identity_mode==='anonymous'?'hr_general_survey_answers_anonymous':'hr_general_survey_answers_named';
  return {available:true,respondents:participantCount,questions:questions.map(question=>{
    const values=db.prepare(`SELECT value FROM ${table} WHERE tenant_id=? AND survey_id=? AND question_id=? ORDER BY id`).all(u.tenant_id,survey.id,question.id).map(row=>row.value);
    if(question.kind==='text')return {...question,answers:values,warning:'قد يكشف النص الحر صاحبه من أسلوبه أو من تفاصيله؛ اقرأه ضمن غرض الاستبانة فقط.'};
    const bands=safeBands(values,survey.identity_mode==='anonymous'?survey.min_respondents:1);
    return {...question,bands,bands_withheld:!bands,reason:bands?'':`فئة واحدة على الأقل دون الحد الأدنى (${survey.min_respondents})؛ حُجب التوزيع كله لمنع كشفها بالطرح.`};
  })};
}
function surveyRows(db,u){
  const manage=u.caps.includes('hr.survey.manage');
  const rows=db.prepare(`SELECT * FROM hr_general_surveys WHERE tenant_id=? ${manage?'':"AND status='open'"} ORDER BY created_at DESC`).all(u.tenant_id);
  return rows.filter(row=>manage||surveyAudience(db,u,row)).map(row=>{
    const questions=db.prepare('SELECT * FROM hr_general_survey_questions WHERE survey_id=? ORDER BY position').all(row.id).map(q=>({...q,kind_name:QUESTION_KINDS[q.kind],options:JSON.parse(q.options_json)}));
    const responded=!!db.prepare('SELECT 1 FROM hr_general_survey_participants WHERE tenant_id=? AND survey_id=? AND user_id=?').get(u.tenant_id,row.id,u.id);
    const participantCount=db.prepare('SELECT COUNT(*) AS n FROM hr_general_survey_participants WHERE tenant_id=? AND survey_id=?').get(u.tenant_id,row.id).n;
    const actions=[];
    if(row.status==='draft'&&manage&&row.prepared_by!==u.id)actions.push('open');
    if(row.status==='open'&&!responded&&surveyAudience(db,u,row)&&today()>=row.opens_on&&today()<=row.closes_on)actions.push('respond');
    if(row.status==='open'&&manage&&today()>=row.closes_on)actions.push('close');
    const results=manage?surveyResults(db,u,row,questions,participantCount):null;
    return {...row,questions,responded,participant_count:manage||row.status==='closed'?participantCount:null,prepared_by_name:name(db,row.prepared_by),opened_by_name:name(db,row.opened_by),actions,results,results_available:!!results?.available};
  });
}

export function operationsBoard(db,supplied){
  const u=actor(db,supplied),assessments=assessmentRows(db,u);
  const hrOperator=u.caps.includes('hr.operations.use');
  const hrMember=u.department_id==='hr'&&['hr','manager','employee'].includes(u.role);
  return {today:today(),permissions:u.caps,sections:serviceSections(db,u),hcm_coverage:hrMember?hcmCoverage(db,u):{total:0,available:0,features:[]},team_access:hrMember?hrTeamAccessBoard(db,u):{can_manage:false,mine:null,members:[]},competencies:competencyRows(db,u),competency_assessments:assessments,my_competencies:assessments.filter(row=>row.employee_id===u.id),improvement_plans:planRows(db,u),surveys:surveyRows(db,u),employees:hrOperator?activeEmployeePage(db,u.tenant_id,{limit:500}):[],departments:hrOperator?db.prepare('SELECT id,name FROM departments WHERE tenant_id=? ORDER BY name').all(u.tenant_id):[]};
}

export function generalSurveyExport(db,supplied,surveyId){
  const u=actor(db,supplied);need(u,'hr.survey.manage','تصدير نتائج الاستبانة لمن يدير استبانات الموارد البشرية');
  const survey=surveyRow(db,u,surveyId),questions=db.prepare('SELECT * FROM hr_general_survey_questions WHERE survey_id=? ORDER BY position').all(survey.id).map(row=>({...row,kind_name:QUESTION_KINDS[row.kind],options:JSON.parse(row.options_json)}));
  const participants=db.prepare('SELECT COUNT(*) AS n FROM hr_general_survey_participants WHERE tenant_id=? AND survey_id=?').get(u.tenant_id,survey.id).n,results=surveyResults(db,u,survey,questions,participants);
  if(!results.available)reject(409,'results_withheld','لا يمكن تصدير نتائج الاستبانة وهي محجوبة',results.reason);
  return {survey:{id:survey.id,title:survey.title,purpose:survey.purpose,identity_mode:survey.identity_mode,audience_kind:survey.audience_kind,opens_on:survey.opens_on,closes_on:survey.closes_on,closed_at:survey.closed_at},results,exported_at:now(),notice:'هذا التصدير تجميعي ولا يحتوي أسماء المشاركين أو معرّفاتهم.'};
}

function cleanLevels(levels){
  if(!Array.isArray(levels)||levels.length!==5)reject(400,'levels','عرّف وصفًا لكل مستوى من 1 إلى 5');
  return levels.map((value,index)=>v.text(value,`وصف المستوى ${index+1}`,500,10));
}
export function createCompetency(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.competency.manage','إعداد قاموس الكفاءات لموظفي الموارد البشرية المخولين');
  v.object(input,['code','name','category','description','levels']);
  const code=String(input.code??'').trim().toUpperCase();
  if(!/^[A-Z][A-Z0-9-]{2,39}$/.test(code))reject(400,'code','رمز الكفاءة يبدأ بحرف لاتيني ويحتوي حروفًا وأرقامًا وشرطة فقط');
  const competencyId=id(),time=now();
  try{db.prepare("INSERT INTO hr_competencies(id,tenant_id,code,name,category,description,levels_json,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)").run(competencyId,u.tenant_id,code,v.text(input.name,'اسم الكفاءة',160,3),v.text(input.category,'فئة الكفاءة',100,2),v.text(input.description,'وصف الكفاءة',1200,10),JSON.stringify(cleanLevels(input.levels)),u.id,time,time);}catch(error){if(String(error.message).includes('UNIQUE'))reject(409,'duplicate_competency','رمز الكفاءة مستخدم من قبل');throw error;}
  audit(db,u,'hr_competency',competencyId,'competency.created',{},{code});return {id:competencyId};
}
function competencyRow(db,u,competencyId){return (typeof competencyId==='string'&&db.prepare('SELECT * FROM hr_competencies WHERE id=? AND tenant_id=?').get(competencyId,u.tenant_id))??reject(404,'not_found','الكفاءة غير متاحة');}
export function competencyAction(db,supplied,competencyId,action,input){
  writing(db);const u=actor(db,supplied),row=competencyRow(db,u,competencyId);version(row,input);
  if(action==='activate'){
    need(u,'hr.performance.calibrate','اعتماد قاموس الكفاءات لحامل تصريح المعايرة');if(row.status!=='draft')reject(409,'invalid_state','الكفاءة ليست مسودة');if(row.prepared_by===u.id)reject(409,'separation_of_duties','من أعد تعريف الكفاءة لا يعتمدها بنفسه');
    const note=v.text(input.note,'أساس الاعتماد',800,10),time=now();db.prepare("UPDATE hr_competencies SET status='active',accepted_by=?,accepted_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,row.id);audit(db,u,'hr_competency',row.id,'competency.activated',{status:row.status},{status:'active'},note);return {id:row.id};
  }
  if(action==='retire'){
    need(u,'hr.competency.manage','سحب الكفاءة لموظفي الموارد البشرية المخولين');if(row.status!=='active')reject(409,'invalid_state','الكفاءة ليست فعالة');const note=v.text(input.note,'سبب السحب',800,10),time=now();db.prepare("UPDATE hr_competencies SET status='retired',retired_by=?,retired_at=?,retirement_reason=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,row.id);audit(db,u,'hr_competency',row.id,'competency.retired',{status:row.status},{status:'retired'},note);return {id:row.id};
  }
  reject(404,'not_found','الإجراء غير متاح');
}
export function recordCompetencyAssessment(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['employee_id','competency_id','target_level','current_level','evidence','development_action','review_on']);
  const person=employee(db,u,input.employee_id);if(!isManagerOf(db,u,person.id)&&!u.caps.includes('hr.competency.manage'))reject(403,'not_permitted','تقييم الكفاءة للمدير المباشر أو الموارد البشرية المخولة');
  const competency=competencyRow(db,u,input.competency_id);if(competency.status!=='active')reject(409,'inactive_competency','لا يقاس الموظفون على كفاءة غير معتمدة');
  const target=Number(input.target_level),current=Number(input.current_level);if(!LEVELS.includes(target)||!LEVELS.includes(current))reject(400,'level','المستوى من 1 إلى 5');
  const evidence=v.text(input.evidence,'دليل المستوى الحالي',3000,20),development=v.text(input.development_action,'إجراء التطوير',2000,10),reviewOn=v.date(input.review_on);if(reviewOn<today())reject(400,'review_on','موعد المراجعة اليوم أو بعده');
  const assessmentId=id(),time=now(),previous=db.prepare('SELECT * FROM hr_employee_competencies WHERE tenant_id=? AND employee_id=? AND competency_id=?').get(u.tenant_id,person.id,competency.id);
  if(previous)db.prepare('UPDATE hr_employee_competencies SET target_level=?,current_level=?,evidence=?,development_action=?,review_on=?,assessed_by=?,assessed_at=?,version=version+1 WHERE id=?').run(target,current,evidence,development,reviewOn,u.id,time,previous.id);
  else db.prepare('INSERT INTO hr_employee_competencies(id,tenant_id,employee_id,competency_id,target_level,current_level,evidence,development_action,review_on,assessed_by,assessed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(assessmentId,u.tenant_id,person.id,competency.id,target,current,evidence,development,reviewOn,u.id,time);
  const recordId=previous?.id??assessmentId;audit(db,u,'hr_employee_competency',recordId,previous?'competency.assessment_updated':'competency.assessment_recorded',{current_level:previous?.current_level??null},{employee_id:person.id,current_level:current,target_level:target});return {id:recordId};
}

function cleanObjectives(rows){
  if(!Array.isArray(rows)||rows.length<1||rows.length>8)reject(400,'objectives','الخطة تحتاج هدفًا واحدًا إلى ثمانية أهداف');
  return rows.map((row,index)=>{v.object(row,['objective','measure']);return {objective:v.text(row.objective,`الهدف ${index+1}`,800,10),measure:v.text(row.measure,`مقياس الهدف ${index+1}`,800,10)};});
}
export function createImprovementPlan(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['employee_id','title','reason','objectives','support','starts_on','ends_on']);const person=employee(db,u,input.employee_id);
  if(person.id===u.id)reject(409,'separation_of_duties','لا ينشئ الموظف خطة تحسين لنفسه');if(!isManagerOf(db,u,person.id)&&!u.caps.includes('hr.pip.manage'))reject(403,'not_permitted','اقتراح الخطة للمدير المباشر أو الموارد البشرية المخولة');
  const starts=v.date(input.starts_on),ends=v.date(input.ends_on);if(ends<=starts)reject(400,'date_order','نهاية الخطة بعد بدايتها');
  const planId=id(),time=now();db.prepare("INSERT INTO hr_performance_improvement_plans(id,tenant_id,employee_id,title,reason,objectives_json,support,starts_on,ends_on,status,proposed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?,?)").run(planId,u.tenant_id,person.id,v.text(input.title,'عنوان الخطة',180,5),v.text(input.reason,'الوقائع وأساس الخطة',4000,30),JSON.stringify(cleanObjectives(input.objectives)),v.text(input.support,'الدعم الذي ستقدمه الشركة',3000,20),starts,ends,u.id,time,time);audit(db,u,'hr_improvement_plan',planId,'pip.created',{},{employee_id:person.id});return {id:planId};
}
function planRow(db,u,planId){return (typeof planId==='string'&&db.prepare('SELECT * FROM hr_performance_improvement_plans WHERE id=? AND tenant_id=?').get(planId,u.tenant_id))??reject(404,'not_found','خطة التحسين غير متاحة');}
export function improvementPlanAction(db,supplied,planId,action,input){
  writing(db);const u=actor(db,supplied),row=planRow(db,u,planId);if(!canSeeEmployee(db,u,row.employee_id))reject(404,'not_found','خطة التحسين غير متاحة');version(row,input);const time=now();
  if(action==='submit'){
    if(row.status!=='draft'||row.proposed_by!==u.id)reject(403,'not_permitted','يرسل المسودة من اقترحها');const note=v.text(input.note,'أساس الإرسال',1000,10);db.prepare("UPDATE hr_performance_improvement_plans SET status='hr_review',submitted_at=?,version=version+1,updated_at=? WHERE id=?").run(time,time,row.id);audit(db,u,'hr_improvement_plan',row.id,'pip.submitted',{status:'draft'},{status:'hr_review'},note);return {id:row.id};
  }
  if(action==='activate'){
    need(u,'hr.pip.manage','تفعيل الخطة لموظف موارد بشرية مخول');if(row.status!=='hr_review')reject(409,'invalid_state','الخطة ليست بانتظار مراجعة الموارد البشرية');if(row.proposed_by===u.id)reject(409,'separation_of_duties','من اقترح الخطة لا يفعلها بنفسه');const note=v.text(input.note,'أساس التفعيل',1500,20);db.prepare("UPDATE hr_performance_improvement_plans SET status='active',activated_by=?,activated_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,row.id);audit(db,u,'hr_improvement_plan',row.id,'pip.activated',{status:'hr_review'},{status:'active'},note);return {id:row.id};
  }
  if(action==='acknowledge'){
    if(row.status!=='active'||row.employee_id!==u.id||row.acknowledged_at)reject(403,'not_permitted','إقرار الاطلاع لصاحب الخطة مرة واحدة');const note=input.note?v.text(input.note,'ملاحظة الموظف',2000,3):'';db.prepare('UPDATE hr_performance_improvement_plans SET acknowledged_at=?,employee_note=?,version=version+1,updated_at=? WHERE id=?').run(time,note,time,row.id);audit(db,u,'hr_improvement_plan',row.id,'pip.acknowledged',{},{acknowledged:true});return {id:row.id};
  }
  if(action==='close'){
    need(u,'hr.pip.manage','إقفال الخطة لموظف موارد بشرية مخول');if(row.status!=='active')reject(409,'invalid_state','الخطة ليست نشطة');if(row.proposed_by===u.id)reject(409,'separation_of_duties','من اقترح الخطة لا يقفلها بنفسه');if(!['completed','extended','cancelled'].includes(input.outcome))reject(400,'outcome','اختر مكتملة أو ممددة أو ملغاة');const note=v.text(input.note,'أساس الإقفال',2000,20);db.prepare('UPDATE hr_performance_improvement_plans SET status=?,closed_by=?,closed_at=?,closure_note=?,version=version+1,updated_at=? WHERE id=?').run(input.outcome,u.id,time,note,time,row.id);audit(db,u,'hr_improvement_plan',row.id,'pip.closed',{status:'active'},{status:input.outcome},note);return {id:row.id};
  }
  if(action==='cancel'){
    need(u,'hr.pip.manage','إلغاء الخطة لموظف موارد بشرية مخول');if(row.status!=='hr_review')reject(409,'invalid_state','لا تلغى الخطة من حالتها الحالية');const note=v.text(input.note,'سبب الإلغاء',1500,20);db.prepare("UPDATE hr_performance_improvement_plans SET status='cancelled',closed_by=?,closed_at=?,closure_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,row.id);audit(db,u,'hr_improvement_plan',row.id,'pip.cancelled',{status:row.status},{status:'cancelled'},note);return {id:row.id};
  }
  reject(404,'not_found','الإجراء غير متاح');
}
export function addImprovementCheckpoint(db,supplied,planId,input){
  writing(db);const u=actor(db,supplied),row=planRow(db,u,planId);version(row,input);if(row.status!=='active')reject(409,'invalid_state','نقطة المتابعة لخطة نشطة');if(!isManagerOf(db,u,row.employee_id)&&!u.caps.includes('hr.pip.manage'))reject(403,'not_permitted','المتابعة للمدير المباشر أو الموارد البشرية المخولة');if(!['on_track','at_risk','off_track'].includes(input.progress))reject(400,'progress','اختر حالة تقدم صحيحة');const checkpointId=id(),time=now();db.prepare('INSERT INTO hr_pip_checkpoints(id,tenant_id,plan_id,progress,evidence,next_action,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)').run(checkpointId,u.tenant_id,row.id,input.progress,v.text(input.evidence,'دليل المتابعة',3000,20),v.text(input.next_action,'الخطوة التالية',2000,10),u.id,time);db.prepare('UPDATE hr_performance_improvement_plans SET version=version+1,updated_at=? WHERE id=?').run(time,row.id);audit(db,u,'hr_improvement_plan',row.id,'pip.checkpoint_added',{},{progress:input.progress,checkpoint_id:checkpointId});return {id:checkpointId};
}

function cleanSurveyQuestions(rows){
  if(!Array.isArray(rows)||rows.length<1||rows.length>20)reject(400,'questions','الاستبانة من سؤال واحد إلى عشرين سؤالًا');
  return rows.map((row,index)=>{v.object(row,['kind','prompt','options']);if(!Object.hasOwn(QUESTION_KINDS,row.kind))reject(400,'kind','نوع السؤال غير صحيح');const options=Array.isArray(row.options)?row.options.map((option,i)=>v.text(option,`خيار ${i+1}`,160,1)):[];if(row.kind==='choice'&&(options.length<2||options.length>12))reject(400,'options','سؤال الاختيار يحتاج خيارين إلى اثني عشر خيارًا');if(row.kind!=='choice'&&options.length)reject(400,'options','الخيارات لسؤال الاختيار فقط');return {position:index+1,kind:row.kind,prompt:v.text(row.prompt,'نص السؤال',500,5),options};});
}
export function createGeneralSurvey(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.survey.manage','إعداد الاستبانات لمن يدير استبانات الموارد البشرية');v.object(input,['title','purpose','identity_mode','audience_kind','department_id','opens_on','closes_on','questions']);if(!['named','anonymous'].includes(input.identity_mode))reject(400,'identity_mode','اختر استبانة مسماة أو مجهولة');if(!['all','department'].includes(input.audience_kind))reject(400,'audience_kind','اختر جمهور الاستبانة');if(input.identity_mode==='anonymous'&&input.audience_kind!=='all')reject(400,'privacy_scope','الاستبانة المجهولة على مستوى الشركة فقط لحماية المشاركين من الكشف');const department=input.audience_kind==='department'?String(input.department_id??''):null;if(input.audience_kind==='department'&&!db.prepare('SELECT 1 FROM departments WHERE id=? AND tenant_id=?').get(department,u.tenant_id))reject(400,'department_id','الإدارة غير متاحة');const opens=v.date(input.opens_on),closes=v.date(input.closes_on);if(closes<opens)reject(400,'date_order','تاريخ الإغلاق بعد تاريخ الفتح');const questions=cleanSurveyQuestions(input.questions),surveyId=id(),time=now();db.prepare("INSERT INTO hr_general_surveys(id,tenant_id,title,purpose,identity_mode,audience_kind,department_id,opens_on,closes_on,status,min_respondents,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',5,?,?,?)").run(surveyId,u.tenant_id,v.text(input.title,'عنوان الاستبانة',180,5),v.text(input.purpose,'غرض الاستبانة',1200,10),input.identity_mode,input.audience_kind,department,opens,closes,u.id,time,time);for(const question of questions)db.prepare('INSERT INTO hr_general_survey_questions(id,tenant_id,survey_id,position,kind,prompt,options_json) VALUES(?,?,?,?,?,?,?)').run(id(),u.tenant_id,surveyId,question.position,question.kind,question.prompt,JSON.stringify(question.options));audit(db,u,'hr_general_survey',surveyId,'survey.created',{},{questions:questions.length,identity_mode:input.identity_mode});return {id:surveyId};
}
function surveyRow(db,u,surveyId){return (typeof surveyId==='string'&&db.prepare('SELECT * FROM hr_general_surveys WHERE id=? AND tenant_id=?').get(surveyId,u.tenant_id))??reject(404,'not_found','الاستبانة غير متاحة');}
export function generalSurveyAction(db,supplied,surveyId,action,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.survey.manage','إدارة الاستبانة لمن يدير استبانات الموارد البشرية');const row=surveyRow(db,u,surveyId);version(row,input);const time=now();
  if(action==='open'){
    if(row.status!=='draft')reject(409,'invalid_state','الاستبانة ليست مسودة');if(row.prepared_by===u.id)reject(409,'separation_of_duties','من أعد أسئلة الاستبانة لا يفتحها بنفسه');const note=v.text(input.note,'أساس الفتح',1000,10);db.prepare("UPDATE hr_general_surveys SET status='open',opened_by=?,opened_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,row.id);audit(db,u,'hr_general_survey',row.id,'survey.opened',{status:'draft'},{status:'open'},note);return {id:row.id};
  }
  if(action==='close'){
    if(row.status!=='open')reject(409,'invalid_state','الاستبانة ليست مفتوحة');if(today()<row.closes_on)reject(409,'closes_later',`لا تغلق الاستبانة قبل ${row.closes_on}`);const note=v.text(input.note,'أساس الإغلاق',1000,10);db.prepare("UPDATE hr_general_surveys SET status='closed',closed_by=?,closed_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,row.id);audit(db,u,'hr_general_survey',row.id,'survey.closed',{status:'open'},{status:'closed'},note);return {id:row.id};
  }
  reject(404,'not_found','الإجراء غير متاح');
}
export function submitGeneralSurvey(db,supplied,surveyId,input){
  writing(db);const u=actor(db,supplied),row=surveyRow(db,u,surveyId);if(row.status!=='open'||today()<row.opens_on||today()>row.closes_on)reject(409,'survey_unavailable','الاستبانة غير متاحة للإجابة');if(!surveyAudience(db,u,row))reject(404,'not_found','الاستبانة غير متاحة');if(db.prepare('SELECT 1 FROM hr_general_survey_participants WHERE tenant_id=? AND survey_id=? AND user_id=?').get(u.tenant_id,row.id,u.id))reject(409,'already_responded','أرسلت إجابتك من قبل ولا يمكن تعديلها');v.object(input,['answers']);const questions=db.prepare('SELECT * FROM hr_general_survey_questions WHERE survey_id=? ORDER BY position').all(row.id);if(!Array.isArray(input.answers)||input.answers.length!==questions.length)reject(400,'answers','جاوب على كل أسئلة الاستبانة');const values=questions.map(question=>{const answer=input.answers.find(item=>item?.question_id===question.id);if(!answer)reject(400,'answers','هناك سؤال بلا إجابة');v.object(answer,['question_id','value']);let value=String(answer.value??'').trim();if(question.kind==='rating'&&!/^[1-5]$/.test(value))reject(400,'value','التقييم من 1 إلى 5');if(question.kind==='yes_no'&&!['yes','no'].includes(value))reject(400,'value','اختر نعم أو لا');if(question.kind==='choice'&&!JSON.parse(question.options_json).includes(value))reject(400,'value','اختر قيمة من الخيارات');value=v.text(value,'الإجابة',2000,1);return {question_id:question.id,value};});const time=now();db.prepare('INSERT INTO hr_general_survey_participants(tenant_id,survey_id,user_id,responded_on) VALUES(?,?,?,?)').run(u.tenant_id,row.id,u.id,today());for(const answer of values){if(row.identity_mode==='anonymous')db.prepare('INSERT INTO hr_general_survey_answers_anonymous(id,tenant_id,survey_id,question_id,value) VALUES(?,?,?,?,?)').run(id(),u.tenant_id,row.id,answer.question_id,answer.value);else db.prepare('INSERT INTO hr_general_survey_answers_named(id,tenant_id,survey_id,question_id,user_id,value,answered_at) VALUES(?,?,?,?,?,?,?)').run(id(),u.tenant_id,row.id,answer.question_id,u.id,answer.value,time);}audit(db,u,'hr_general_survey',row.id,'survey.responded',{},{responded:true,identity_mode:row.identity_mode});return {id:row.id};
}
