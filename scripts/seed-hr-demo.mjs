import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';

// بيانات عرض مصطنعة للعقود: مدير الموارد البشرية التجريبي مالك القبول (DEC16). المبالغ وهمية.
const synthetic={'36t':'3,6T — بيئة تجريبية',isolated:'كيان اختبار معزول'};
export function seedHrDemo(db){
  const tenants=db.prepare('SELECT id,name FROM tenants').all();
  if(!tenants.length||tenants.some(t=>synthetic[t.id]!==t.name))throw new Error('Synthetic tenants only. Refusing to add demo contracts to this database.');
  if(db.prepare("SELECT COUNT(*) AS n FROM hr_policies WHERE tenant_id='36t'").get().n)return 0;
  const user=(...ids)=>{for(const id of ids){const u=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t' AND active=1").get(id);if(u)return u;}throw new Error('Missing synthetic account: '+ids.join('/'));};
  const admin=user('admin'),officer=user('hr'),manager=user('head-hr','manager');
  for(const capability of ['hr.policy.accept','hr.contracts.approve'])try{transaction(db,()=>grantAccess(db,admin,{user_id:manager.id,capability,note:'مدير الموارد البشرية مالك القبول (DEC16) — عرض تجريبي'}));}catch(error){if(!['already_granted','already_default'].includes(error.code))throw error;}
  const policyId=transaction(db,()=>preparePolicy(db,officer,{kind:'pay_components',title:'بنود الراتب المعتمدة (تجريبي)',body:'يتكون الراتب الشهري من راتب أساسي وبدل سكن وبدل نقل بمبالغ شهرية ثابتة بالريال. أي بند آخر يحتاج سياسة جديدة.',basis:'سياسة عرض تجريبية؛ لا تمثل قرارًا فعليًا للشركة',effective_from:'2026-01-01',parameters:{components:['basic','housing','transport']}})).id;
  transaction(db,()=>decidePolicy(db,manager,policyId,'accept',{note:'اعتماد تجريبي لعرض المنصة فقط'}));
  // تاريخ السريان قبل يوم تشغيل حقيقي: البصمة الذهبية تُقنّع يوم ساعة SQL بصورته المعروضة، فتاريخٌ مبذور يساوي يوم التشغيل
  // يختفي معه وتتحرك بصمة «سياسات الموارد البشرية» ذلك اليوم وحده (كان 2026-10-01). وهو بعد الساعة المجمّدة (2026-09-20) فيبقى «قادمًا».
  transaction(db,()=>preparePolicy(db,officer,{kind:'working_time',title:'ساعات العمل والحضور (تجريبي)',body:'أيام العمل من الأحد إلى الخميس، ثماني ساعات يوميًا، مع مرونة ساعة في الحضور. بانتظار اعتماد مدير الموارد البشرية.',basis:'مسودة عرض تجريبية',effective_from:'2026-09-30',parameters:{workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:60}}));
  const pay=(basic,housing,transport)=>[{component:'basic',amount:basic},{component:'housing',amount:housing},{component:'transport',amount:transport}];
  const make=(userId,title,lines)=>transaction(db,()=>prepareContract(db,officer,{user_id:userId,contract_type:'indefinite',job_title:title,work_location:'الرياض',start_date:'2026-02-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:lines,document_reference:'عقد تجريبي؛ لا يوجد مستند فعلي'})).id;
  const step=(who,contractId,action,values={})=>transaction(db,()=>contractAction(db,who,contractId,action,{version:getContract(db,who,contractId).version,...values}));
  const first=make(user('employee').id,'مصممة أولى (تجريبي)',pay('8000.00','2000.00','500.00'));
  step(officer,first,'submit_contract');step(manager,first,'approve_contract',{note:'اعتماد تجريبي'});
  step(officer,make(user('outsider').id,'كاتب محتوى (تجريبي)',pay('6500.00','1625.00','400.00')),'submit_contract');
  return db.prepare("SELECT COUNT(*) AS n FROM employment_contracts WHERE tenant_id='36t'").get().n;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Demo contracts are disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{console.log(`Demo contracts available: ${seedHrDemo(db)||'already present'}.`);}finally{db.close();}
}
