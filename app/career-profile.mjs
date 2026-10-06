import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { riyadhToday } from './riyadh-time.mjs';

// الملف المهني للموظف. صاحبه يكتبه، وموظف موارد بشرية آخر يتحقق من المؤهل بمرجع دليله.
// يراه صاحبه ومديره المباشر ومن يحمل حق السجل الوظيفي. لا راتب فيه ولا تقييم.
export const QUALIFICATION_KINDS=[['degree','مؤهل علمي'],['certification','شهادة مهنية'],['course','دورة'],['language','لغة']].map(([key,name])=>({key,name}));
function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','الملف المهني لحسابات الموظفين');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
export function canSeeProfile(db,u,userId){return userId===u.id||isManagerOf(db,u,userId)||can(db,u,'employees.view');}

export function careerProfile(db,supplied,userId){
  const u=actor(db,supplied),target=userId||u.id;
  const person=db.prepare("SELECT id,name,department_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(target,u.tenant_id);
  if(!person||!canSeeProfile(db,u,person.id))fail(404,'not_found','الملف المهني غير متاح');
  const record=db.prepare('SELECT job_title,join_date FROM employee_profiles WHERE user_id=?').get(person.id),contract=db.prepare("SELECT job_title,start_date FROM employment_contracts WHERE user_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(person.id);
  const career=db.prepare('SELECT * FROM employee_career WHERE user_id=?').get(person.id)??null,hr=can(db,u,'employees.view');
  return {user_id:person.id,name:person.name,own:person.id===u.id,job_title:contract?.job_title??record?.job_title??'',joined:record?.join_date??contract?.start_date??'',
    department:db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(person.department_id,u.tenant_id)?.name??'',
    career:career?{...career,skills:JSON.parse(career.skills)}:null,
    qualifications:db.prepare("SELECT q.*,x.name AS verified_by_name FROM employee_qualifications q LEFT JOIN users x ON x.id=q.verified_by WHERE q.user_id=? AND q.status<>'withdrawn' ORDER BY q.year DESC,q.created_at DESC").all(person.id)
      .map(q=>({...q,kind_name:QUALIFICATION_KINDS.find(k=>k.key===q.kind).name,status_name:q.status==='verified'?'متحقق منه':'بإفادة الموظف',actions:q.status!=='self_declared'?[]:q.user_id===u.id?['withdraw_qualification']:hr?['verify_qualification']:[]})),
    kinds:QUALIFICATION_KINDS,complete:!!career&&!!(contract?.job_title??record?.job_title)};
}
export function saveCareer(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['years_total','years_in_field','previous_roles','skills','career_interest']);
  for(const key of ['years_total','years_in_field'])if(!Number.isInteger(input[key])||input[key]<0||input[key]>60)fail(400,key,'سنوات الخبرة عدد صحيح من 0 إلى 60');
  if(input.years_in_field>input.years_total)fail(400,'years_in_field','سنوات الخبرة في المجال لا تتجاوز إجمالي الخبرة');
  if(!Array.isArray(input.skills)||input.skills.length>30)fail(400,'skills','حتى ثلاثين مهارة');
  const skills=[...new Set(input.skills.map(s=>v.text(s,'المهارة',60,2)))];
  db.prepare('INSERT INTO employee_career(user_id,tenant_id,years_total,years_in_field,previous_roles,skills,career_interest,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET years_total=excluded.years_total,years_in_field=excluded.years_in_field,previous_roles=excluded.previous_roles,skills=excluded.skills,career_interest=excluded.career_interest,updated_at=excluded.updated_at')
    .run(u.id,u.tenant_id,input.years_total,input.years_in_field,input.previous_roles?v.text(input.previous_roles,'الأدوار السابقة',1500,3):'',JSON.stringify(skills),input.career_interest?v.text(input.career_interest,'الاهتمام المهني',1000,3):'',now());
  audit(db,u,'career_profile',u.id,'career.saved',{}, {skills:skills.length});
  return {id:u.id};
}
export function addQualification(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['kind','title','field','institution','year','evidence_reference']);
  if(!QUALIFICATION_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع المؤهل');
  if(input.year!==null&&(!Number.isInteger(input.year)||input.year<1960||input.year>Number(riyadhToday().slice(0,4))))fail(400,'year','سنة الحصول غير صالحة');
  const title=v.text(input.title,'اسم المؤهل',200,3);
  if(db.prepare("SELECT 1 FROM employee_qualifications WHERE user_id=? AND title=? AND status<>'withdrawn'").get(u.id,title))fail(409,'duplicate_qualification','هذا المؤهل مسجل في ملفك');
  const qualificationId=randomUUID();
  db.prepare("INSERT INTO employee_qualifications(id,tenant_id,user_id,kind,title,field,institution,year,status,evidence_reference,created_at) VALUES(?,?,?,?,?,?,?,?,'self_declared',?,?)").run(qualificationId,u.tenant_id,u.id,input.kind,title,input.field?v.text(input.field,'التخصص',160,2):'',input.institution?v.text(input.institution,'الجهة المانحة',200,2):'',input.year,input.evidence_reference?v.text(input.evidence_reference,'مرجع الشهادة',400,3):'',now());
  audit(db,u,'career_profile',u.id,'qualification.added',{}, {kind:input.kind});
  return {id:qualificationId};
}
export function qualificationAction(db,supplied,qualificationId,action,input){
  writing(db);const u=actor(db,supplied);
  const q=typeof qualificationId==='string'&&db.prepare("SELECT * FROM employee_qualifications WHERE id=? AND tenant_id=? AND status='self_declared'").get(qualificationId,u.tenant_id);
  if(!q)fail(404,'not_found','المؤهل غير متاح');
  if(action==='withdraw'){v.object(input,[]);if(q.user_id!==u.id)fail(404,'not_found','المؤهل غير متاح');db.prepare("UPDATE employee_qualifications SET status='withdrawn' WHERE id=?").run(q.id);}
  else if(action==='verify'){
    v.object(input,['evidence_reference']);
    if(q.user_id===u.id||!can(db,u,'employees.view'))fail(403,'not_permitted','يتحقق من المؤهل موظف موارد بشرية غير صاحبه');
    db.prepare("UPDATE employee_qualifications SET status='verified',verified_by=?,verified_at=?,evidence_reference=? WHERE id=?").run(u.id,now(),v.text(input.evidence_reference,'مرجع الوثيقة التي اطلعت عليها',400,5),q.id);
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'career_profile',q.user_id,'qualification.'+action,{}, {});
  return {id:q.id};
}
export function pendingQualifications(db,supplied){
  const u=actor(db,supplied);if(!can(db,u,'employees.view'))return [];
  return db.prepare("SELECT q.*,x.name AS employee_name FROM employee_qualifications q JOIN users x ON x.id=q.user_id WHERE q.tenant_id=? AND q.status='self_declared' AND q.user_id<>? ORDER BY q.created_at LIMIT 100").all(u.tenant_id,u.id).map(q=>({...q,kind_name:QUALIFICATION_KINDS.find(k=>k.key===q.kind).name}));
}
