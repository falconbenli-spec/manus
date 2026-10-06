import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
// مفتاح تفعيل الخدمة (ترحيل 129): وحدة ورقية لا تستورد هذه، فلا دورة.
import { isHidden, stopNote } from './service-availability.mjs';

// المراكز التخصصية الأربعة في البرومبت الشامل مقترحات تنظيمية، لا إدارات قائمة.
// تظهر للموظفين بعد تفعيلها فقط؛ والتفعيل يشترط مالكًا مسمى وإدارة أمًا وخدمة مربوطة واحدة على الأقل.
export const PROPOSED=[
  {key:'strategy_research',name:'مركز الاستراتيجية والأبحاث',scope_note:'خطط بحث ومصادر مؤرخة، جمهور ورحلة، اقتراح قيمة، وبريف إبداعي واحد معتمد لكل إصدار.',prefixes:['STR-']},
  {key:'digital_commerce',name:'مركز التجارب الرقمية والتجارة والأتمتة',scope_note:'بحث وتجارة ورحلات عملاء وصفحات هبوط وتجارب؛ يفصل المشروع التقني عن التشغيل اليومي. لا خدمات قائمة له بعد.',prefixes:[]},
  {key:'data_knowledge',name:'مركز البيانات والذكاء والمعرفة',scope_note:'قاموس مؤشرات وجودة بيانات ولقطات دورية ومساعدو معرفة، مع بقاء تدقيق جودة الحملات لدى إدارة تدقيق الحملات.',prefixes:['DAT-']},
  {key:'admin_facilities',name:'مركز الخدمات الإدارية والمرافق',scope_note:'مرافق وقاعات وضيوف وسفر ومراسلات ومخزون خفيف واشتراكات وسلامة.',prefixes:['ADM-']}
];
const STATES={proposed:'مقترح — بلا تفعيل',active:'نشط',retired:'متقاعد'};
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db,u){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة');if(!can(db,u,'structure.manage'))fail(403,'not_permitted','إدارة المراكز لمن يدير الهيكل التنظيمي');}
function view(db,u,c,manage){
  const services=db.prepare("SELECT s.code,s.name_ar,d.name AS department FROM service_centre_services x JOIN services s ON s.code=x.service_code AND s.tenant_id=x.tenant_id AND s.active=1 JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id WHERE x.centre_id=? AND s.version=(SELECT MAX(version) FROM services z WHERE z.tenant_id=s.tenant_id AND z.code=s.code) ORDER BY s.code").all(c.id)
    // مفتاح تفعيل الخدمة (ترحيل 129): المركز النشط يُعرض للموظفين، فكان يسمّي لهم خدمةً أوقفها المالك بلا علامة
    // (مراجعة 22 سبتمبر). الصفّ يبقى ويُعلَّم بسببه، ولا يُحذف: المركز النشط لا يبقى بلا خدمة مربوطة واحدة
    // (active_needs_service)، وإفراغه صامتًا كان سيقفل «ربط الخدمات» و«تقاعد المركز» على من يديره. ولا باب
    // طلبٍ في هذا الصف أصلًا — لا service_id ولا زر — فالعلامة هي كل ما ينقص ليصدق ما يقرؤه الموظف.
    .map(s=>({...s,...(isHidden(db,c.tenant_id,'service',s.code)
      ?{hidden:true,hidden_reason:stopNote(db,c.tenant_id,'service',s.code)}:{hidden:false,hidden_reason:null})}));
  const missing=[...(c.owner_id?[]:['مالك مسمى']),...(c.department_id?[]:['إدارة أم']),...(services.length?[]:['خدمة مربوطة واحدة على الأقل'])];
  return {...c,status_name:STATES[c.status],owner_name:c.owner_id?db.prepare('SELECT name FROM users WHERE id=?').get(c.owner_id)?.name:null,department_name:c.department_id?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(c.department_id,c.tenant_id)?.name:null,services,missing,
    actions:!manage||c.status==='retired'?[]:['edit_centre','link_services',...(c.status==='proposed'&&!missing.length?['activate_centre']:[]),'retire_centre']};
}
export function centresBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'structure.manage');
  const rows=db.prepare(`SELECT * FROM service_centres WHERE tenant_id=? ${manage?'':"AND status='active'"} ORDER BY status='active' DESC,name`).all(u.tenant_id);
  return {can_manage:manage,centres:rows.map(c=>view(db,u,c,manage)),
    proposable:manage?PROPOSED.filter(p=>!rows.some(c=>c.key===p.key)).map(p=>({key:p.key,name:p.name})):[],
    departments:manage?db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id):[],
    people:manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id):[],
    unlinked_services:manage?db.prepare('SELECT DISTINCT s.code,s.name_ar FROM services s WHERE s.tenant_id=? AND s.active=1 AND NOT EXISTS(SELECT 1 FROM service_centre_services x WHERE x.tenant_id=s.tenant_id AND x.service_code=s.code) ORDER BY s.code').all(u.tenant_id):[],
    note:'المركز تجميع تنظيمي لخدمات قائمة. الخدمة تبقى ملك إدارتها، ولا يتغير مسار اعتمادها ولا صلاحياتها بربطها بمركز.'};
}
export function proposeCentre(db,supplied,input){
  const u=actor(db,supplied);writing(db,u);v.object(input,['key']);
  const p=PROPOSED.find(x=>x.key===input.key);if(!p)fail(400,'key','مركز غير معروف');
  if(db.prepare('SELECT 1 FROM service_centres WHERE tenant_id=? AND key=?').get(u.tenant_id,p.key))fail(409,'duplicate_centre','المركز مسجل');
  const centreId=randomUUID(),time=now();
  db.prepare("INSERT INTO service_centres(id,tenant_id,key,name,scope_note,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'proposed',?,?,?)").run(centreId,u.tenant_id,p.key,p.name,p.scope_note,u.id,time,time);
  // الخدمات القائمة التي تحمل بادئة المركز تُربط اقتراحًا؛ يراجعها المدير قبل التفعيل.
  for(const prefix of p.prefixes)for(const s of db.prepare('SELECT DISTINCT code FROM services WHERE tenant_id=? AND active=1 AND code LIKE ?').all(u.tenant_id,prefix+'%'))
    db.prepare('INSERT OR IGNORE INTO service_centre_services VALUES(?,?,?,?,?)').run(centreId,u.tenant_id,s.code,u.id,time);
  audit(db,u,'service_centre',centreId,'centre.proposed',{}, {key:p.key});
  return {id:centreId};
}
export function centreAction(db,supplied,centreId,action,input){
  const u=actor(db,supplied);writing(db,u);
  const c=typeof centreId==='string'&&db.prepare('SELECT * FROM service_centres WHERE id=? AND tenant_id=?').get(centreId,u.tenant_id);
  if(!c)fail(404,'not_found','المركز غير متاح');
  const current=view(db,u,c,true);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة المركز');
  if(!Number.isInteger(input?.version)||input.version!==c.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE service_centres SET ${fields},version=version+1,updated_at=? WHERE id=?`).run(...values,time,c.id);
  if(action==='edit_centre'){
    v.object(input,['version','name','scope_note','department_id','owner_id']);
    const department=input.department_id?db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id):null,owner=input.owner_id?db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id):null;
    if(input.department_id&&!department)fail(400,'department_id','الإدارة غير متاحة');if(input.owner_id&&!owner)fail(400,'owner_id','المالك غير متاح');
    if(c.status==='active'&&(!department||!owner))fail(409,'active_needs_owner','المركز النشط لا يبقى بلا مالك أو إدارة أم');
    bump('name=?,scope_note=?,department_id=?,owner_id=?',[v.text(input.name,'اسم المركز',160,3),v.text(input.scope_note,'نطاق المركز',1500,10),department?.id??null,owner?.id??null]);
  }else if(action==='link_services'){
    v.object(input,['version','service_codes']);
    if(!Array.isArray(input.service_codes)||input.service_codes.length>200||input.service_codes.some(x=>typeof x!=='string'))fail(400,'service_codes','قائمة رموز الخدمات غير صالحة');
    const codes=[...new Set(input.service_codes.map(x=>x.trim().toUpperCase()).filter(Boolean))];
    for(const code of codes){
      if(!db.prepare('SELECT 1 FROM services WHERE tenant_id=? AND code=? AND active=1').get(u.tenant_id,code))fail(400,'service_codes',`الخدمة ${code} غير موجودة أو غير نشطة`);
      const other=db.prepare('SELECT c.name FROM service_centre_services x JOIN service_centres c ON c.id=x.centre_id WHERE x.tenant_id=? AND x.service_code=? AND x.centre_id<>?').get(u.tenant_id,code,c.id);
      if(other)fail(409,'service_in_other_centre',`الخدمة ${code} مربوطة بمركز «${other.name}»`);
    }
    if(c.status==='active'&&!codes.length)fail(409,'active_needs_service','المركز النشط لا يبقى بلا خدمات. قاعده بدل إفراغه');
    db.prepare('DELETE FROM service_centre_services WHERE centre_id=?').run(c.id);
    for(const code of codes)db.prepare('INSERT INTO service_centre_services VALUES(?,?,?,?,?)').run(c.id,u.tenant_id,code,u.id,time);
    bump('updated_at=updated_at',[]);
  }else if(action==='activate_centre'){v.object(input,['version','note']);v.text(input.note,'قرار التفعيل وسنده',1000,10);bump("status='active'",[]);}
  else if(action==='retire_centre'){v.object(input,['version','note']);v.text(input.note,'سبب التقاعد',1000,10);bump("status='retired'",[]);db.prepare('DELETE FROM service_centre_services WHERE centre_id=?').run(c.id);}
  audit(db,u,'service_centre',c.id,'centre.'+action,{status:c.status},{},typeof input.note==='string'?input.note.trim():'');
  return {id:c.id};
}
