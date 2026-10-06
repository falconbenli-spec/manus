import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction, createRetainer } from '../app/agency.mjs';
import { createCampaign, campaignAction, campaignsBoard, createContent, createBaseline, recordScope } from '../app/campaigns.mjs';
import { createCycle, requestTraining, setGoal } from '../app/talent.mjs';
import { proposeHoliday, requestMission, requestOvertime } from '../app/attendance-extras.mjs';
import { PROPOSED, proposeCentre } from '../app/centres.mjs';

// بيانات عرض مصطنعة لشاشات التشغيل الجديدة: عميل وحملة نشطة ومحتوى وخط نطاق، ودورة تقييم مسودة، وطلبات حضور معلقة.
// كل الأسماء مصطنعة، ولا يُعتمد هنا ما هو قرار بشري داخل المنصة إلا اعتماد إطلاق الحملة اللازم لعرضها نشطة.
const synthetic={'36t':'3,6T — بيئة تجريبية',isolated:'كيان اختبار معزول'};
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function seedOperationsDemo(db){
  const tenants=db.prepare('SELECT id,name FROM tenants').all();
  if(!tenants.length||tenants.some(t=>synthetic[t.id]!==t.name))throw new Error('Synthetic tenants only. Refusing to add demo operations data to this database.');
  if(db.prepare("SELECT 1 FROM clients WHERE tenant_id='36t' AND legal_name='شركة نخيل المصطنعة للتجزئة'").get())return 0;
  const user=id=>{const u=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t' AND active=1").get(id);if(!u)throw new Error('Missing synthetic account: '+id);return u;};
  const admin=user('admin'),manager=user('manager'),employee=user('employee'),hr=user('hr'),tx=f=>transaction(db,f),day=today(),month=day.slice(0,7);
  const optional=f=>{try{return tx(f);}catch(error){if(error.status)return null;throw error;}};
  const clientId=tx(()=>createClient(db,manager,{legal_name:'شركة نخيل المصطنعة للتجزئة',trade_name:'نخيل (تجريبي)',sector:'تجزئة',status:'active'})).id;
  tx(()=>clientAction(db,manager,clientId,'add_member',{user_id:employee.id,role:'مصممة الحساب'}));
  tx(()=>clientAction(db,employee,clientId,'add_brand',{name:'نخيل (تجريبي)',guideline_reference:'دليل هوية مصطنع v2'}));
  const retainerId=tx(()=>createRetainer(db,manager,{client_id:clientId,name:'محتوى شهري (تجريبي)',period_month:month,allowances:[{type:'منشور',quantity:12},{type:'فيديو قصير',quantity:4}],contract_reference:'البند 4 من عقد مصطنع',carry_over_rule:'لا ترحيل؛ التجاوز بطلب تغيير مسعّر'})).id;
  const campaignId=tx(()=>createCampaign(db,employee,{client_id:clientId,name:'حملة موسم مصطنعة',objective:'زيادة طلبات المتجر الإلكتروني خلال الموسم',channels:['instagram','google_ads'],targets:[{metric:'طلبات',target:400,unit:'طلب'},{metric:'نقرات',target:20000,unit:'نقرة'}],media_budget:'10000.00',budget_reference:'بريد اعتماد مصطنع من العميل',start_date:addDays(day,-6),end_date:addDays(day,14)})).id;
  const campaign=()=>campaignsBoard(db,employee).campaigns.find(c=>c.id===campaignId),step=(who,action,values={})=>tx(()=>campaignAction(db,who,campaignId,action,{version:campaign().version,...values}));
  for(const item of campaign().checklist)step(employee,'check',{key:item.key,evidence:'مرجع مصطنع لاكتمال البند'});
  step(employee,'request_launch');step(manager,'approve_launch',{note:'عرض تجريبي: روجعت الجاهزية المصطنعة'});
  step(employee,'result',{entry_date:addDays(day,-1),metric:'طلبات',value:96,source:'لوحة متجر مصطنعة'});
  step(employee,'spend',{entry_date:addDays(day,-1),channel:'instagram',amount:'2850.00',source:'لوحة إعلانات مصطنعة'});
  for(const [title,offset,format,type] of [['منشور إطلاق المجموعة',1,'post','منشور'],['فيديو خلف الكواليس',3,'reel','فيديو قصير'],['عرض نهاية الأسبوع',5,'story','']])
    tx(()=>createContent(db,employee,{client_id:clientId,campaign_id:campaignId,brand_id:'',channel:'instagram',format,title:`${title} (تجريبي)`,brief:'فكرة مصطنعة لعرض تقويم المحتوى',planned_date:addDays(day,offset),planned_time:'18:30',retainer_id:type?retainerId:'',deliverable_type:type}));
  const baselineId=tx(()=>createBaseline(db,manager,{client_id:clientId,name:'هوية بصرية (تجريبي)',contract_reference:'عرض سعر مصطنع رقم 12',lines:[{name:'شعار',quantity:1,revisions:2},{name:'تصميم مطبوع',quantity:3,revisions:1}],exclusions:'التصوير والطباعة'})).id;
  tx(()=>recordScope(db,employee,baselineId,{line_key:'l1',kind:'delivery',quantity:1,item_reference:'شعار v1',description:''}));
  for(let i=0;i<3;i++)tx(()=>recordScope(db,employee,baselineId,{line_key:'l1',kind:'revision',quantity:1,item_reference:'شعار v1',description:''}));
  // الموارد البشرية: دورة تقييم مسودة، وطلب تدريب، وهدف، وعطلة مقترحة، ومهمة وعمل إضافي بانتظار القرار.
  tx(()=>createCycle(db,hr,{name:`تقييم ${day.slice(0,4)} (تجريبي)`,period_from:`${day.slice(0,4)}-01-01`,period_to:`${day.slice(0,4)}-12-31`,scale_max:5,criteria:[{name:'جودة التسليم',weight:40},{name:'الالتزام بالمواعيد',weight:20},{name:'التعاون',weight:20},{name:'التطور المهني',weight:20}]}));
  tx(()=>requestTraining(db,employee,{user_id:'',title:'دورة تحليل بيانات (تجريبي)',provider:'جهة تدريب مصطنعة',kind:'course',hours:16,start_date:addDays(day,20),end_date:addDays(day,22),purpose:'تحسين تقارير أداء الحملات للعملاء'}));
  tx(()=>setGoal(db,manager,{user_id:employee.id,goal:'قيادة تقرير أداء شهري لعميل واحد دون مراجعة',measure:'ثلاثة تقارير متتالية بلا ملاحظات جوهرية',due_date:addDays(day,90),review_id:''}));
  optional(()=>proposeHoliday(db,hr,{holiday_date:addDays(day,30),name:'عطلة مصطنعة للعرض',basis:'تاريخ مصطنع لعرض مسار الاقتراح والاعتماد؛ ليس عطلة فعلية'}));
  optional(()=>requestMission(db,employee,{from_date:addDays(day,2),to_date:addDays(day,2),destination:'موقع تصوير مصطنع',purpose:'تغطية فعالية مصطنعة للعميل التجريبي'}));
  optional(()=>requestOvertime(db,employee,{work_date:day,minutes:90,reason:'إنهاء تسليمات الحملة المصطنعة قبل الإطلاق'}));
  // المراكز الأربعة تُسجل مقترحات فقط؛ تسمية المالك والتفعيل قرار الإدارة.
  for(const centre of PROPOSED)optional(()=>proposeCentre(db,admin,{key:centre.key}));
  for(const [who,capability] of [['head-hr','hr.performance.calibrate'],['head-hr','hr.succession.manage'],['head-grc','vendors.legal']]){
    const target=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id='36t' AND active=1").get(who);
    if(target)try{tx(()=>grantAccess(db,admin,{user_id:who,capability,note:'تصريح عرض تجريبي'}));}catch(error){if(!['already_granted','already_default'].includes(error.code))throw error;}
  }
  return 1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Demo operations data is disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{console.log(`Demo operations data: ${seedOperationsDemo(db)?'added':'already present'}.`);}finally{db.close();}
}
