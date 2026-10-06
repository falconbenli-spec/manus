// شرط أهلية الخدمة: الاشتقاق والمقارنة الظلية والباب (ترحيل 138) — 24 سبتمبر 2026.
//
// ما قِيس على القاعدة الحية قبل هذا الملف، لا ما يُظن:
//   • 169 صفًّا في catalog_placement (142 خدمة + 26 مجموعة + بند وحدة واحد)، كلها بلا شرط.
//   • صفر خطوة اعتماد تحمل شرطًا (`when`) في 139 تعريفًا.
//   • والعمودان required_capability وdepartment_id **لم يقرأهما مرشّح ظهور واحد**: قارئهما الوحيد
//     eligibilityFrom في app/service-cards.mjs، تطبعهما للموظف وعدًا بحصرٍ لا يفرضه أحد.
// فالعطب لم يكن «المفتاح مطفأ في البيانات» بل «المفتاح غير موصول». الوصل في app/service-availability.mjs
// (gateSql داخل placedSql، مصدر الشرط الواحد)، وهذا الملف يقرّر **ماذا يوضع فيه** ومن يضعه.
//
// القاعدة التي تحكم الاشتقاق كله: **لا يُقترح شرطٌ إلا حيث تعرفه المنصة أصلًا.** ما لا يفرضه الكود
// ولا تقوله طبيعة الخدمة يبقى مفتوحًا، ويُقال على الشاشة إنه مفتوح **عن قصد** لا عن سهو. ومن يطلب
// ماذا قرارُ المالك؛ هذا الملف يقترح ويعرض ويفتح له الباب، ولا يقرّر عنه.
import { audit, now } from './db.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { CAPABILITIES, capabilityName, isSuperAdmin, can } from './access.mjs';
import { visibleSql, audiencesFor, currentGates, gateHistory } from './service-availability.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';

const capability=key=>CAPABILITIES.find(c=>c.key===key)??null;
const superAdminName=(db,tenantId)=>db.prepare("SELECT name FROM users WHERE tenant_id=? AND role='admin' AND admin_level='super' AND active=1 ORDER BY name").get(tenantId)?.name
  ??'الأدمن الأول';

/* ═════ (1) الاشتقاق: يقترح شرطًا حيث تعرفه المنصة، ويسمّي سبب البقاء مفتوحًا حيث لا تعرفه ═════ */

// أسباب البقاء مفتوحًا، مسمّاةً لا مسكوتًا عنها. الشاشة تطبع النص كما هو، فلا يُقرأ الفراغ سهوًا.
export const OPEN_REASONS=Object.freeze({
  no_code_gate:'ما فيه تصريح يرفض طلبها: مدخل الطلب الوحيد createRequest يرفض حساب إدارة المنصة والخدمة الموقوفة والنسخة القديمة، وما يسأل عن تصريح لأي خدمة',
  department_is_handler:'إدارتها في التعريف هي الإدارة اللي تنفّذها لا اللي تطلبها: نفس العمود يوجّه فيه المحرك الطلب ويعرض فيه لمدير الإدارة «خدمات إدارتي»، وقراءته حصرًا على الطالب تقفلها بوجه كل موظف برّا الإدارة',
  confidential_channel:'قناة سرية: هي الطريق الوحيد في المنصة لبلاغ أو تظلّم، وحصرها يقطعه بلا بديل معلن',
  not_a_service:'بند في الشجرة مو خدمة في الدليل (مجموعة خيارات أو شاشة وحدة مخصصة)، والشرط يُوضع على رمز خدمة'
});

// القنوات التي لا تُشرَط أبدًا، بأي سبب ومن أي حساب. تُقرأ من النسخة المخزَّنة لا من قائمة في الكود،
// فهي حال النسخة التي يقف عليها الدليل الآن — القاعدة نفسها التي يمشي عليها لوح المفاتيح (129).
export function guardedChannels(db,tenantId){
  return db.prepare(`SELECT s.code,s.name_ar FROM services s WHERE s.tenant_id=? AND s.active=1
      AND s.version=(SELECT MAX(n.version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)
      AND json_extract(s.approval_policy,'$.closed_circle')=1
    ORDER BY s.code`).all(tenantId);
}

// التصريح الذي **يرفض الطلب فعلًا** لخدمة بعينها، أو null. المصدر الوحيد الذي يفرض تصريحًا على مدخل
// خدمةٍ في هذه المنصة هو خدمةُ الوحدة المخصصة (MODULE_SERVICES[].capability): شاشتها لا تُفتح لمن لا
// يحمله. وتصريحٌ يحمله كل موظف (everyone) لا يرفض أحدًا، فلا يُقترح شرطًا — وهو حال leave.use اليوم،
// وهو سبب أن هذه القاعدة تعطي صفرًا على الحال الراهن ولا تعطيه بالتعريف.
export function enforcedCapabilityFor(code){
  const module=MODULE_SERVICES.find(m=>m.code===code);
  const key=module?.capability?String(module.capability):'';
  if(!key)return null;
  const c=capability(key);
  return c&&!c.everyone?key:null;
}

/* الاشتقاق على صفوف الإسقاط كلها. يردّ اقتراحًا لكل صفٍّ تعرف المنصة شرطه، وسببًا مسمّى لكل صفٍّ يبقى
   مفتوحًا. ولا يخترع سياسة: «إدارة الخدمة» في التعريف ليست «من يطلبها» — هي الإدارة المنفّذة، والعمود
   نفسه يقرؤه routing.mjs ليوجّه وapprovalSettings ليعرض لمديرها أزمنتها. فحصرُ الطلب بها قرارُ مالك
   يُكتب بابًا بابًا بسنده، لا استنتاجٌ يجريه محرّك على 142 خدمة دفعة واحدة. */
export function deriveGates(db,tenantId){
  const rows=db.prepare(`SELECT DISTINCT item_kind,item_key FROM catalog_placement WHERE tenant_id=? ORDER BY item_kind,item_key`).all(tenantId);
  const guarded=new Set(guardedChannels(db,tenantId).map(r=>r.code));
  const named=new Map(db.prepare(`SELECT s.code,s.name_ar FROM services s WHERE s.tenant_id=? AND s.active=1
      AND s.version=(SELECT MAX(n.version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)`).all(tenantId).map(r=>[r.code,r.name_ar]));
  const proposals=[],open=[];
  for(const row of rows){
    const code=row.item_key,name=named.get(code)??code;
    if(row.item_kind!=='service'){open.push({item_kind:row.item_kind,code,name,reason_key:'not_a_service',reason:OPEN_REASONS.not_a_service});continue;}
    if(guarded.has(code)){open.push({item_kind:'service',code,name,reason_key:'confidential_channel',reason:OPEN_REASONS.confidential_channel});continue;}
    const cap=enforcedCapabilityFor(code);
    if(cap){proposals.push({item_kind:'service',code,name,required_capability:cap,capability_name:capabilityName(cap),department_id:null,
      basis:`شاشة وحدتها المخصصة ما تنفتح بغير تصريح «${capabilityName(cap)}»، فالبطاقة تقول الشرط اللي يفرضه الكود أصلًا`});continue;}
    // لا تصريح يفرضه الكود، ولا العمود يقول إنها إجراء داخلي: تبقى مفتوحة، ويُكتب السببان معًا.
    open.push({item_kind:'service',code,name,reason_key:'no_code_gate',
      reason:`${OPEN_REASONS.no_code_gate}. و${OPEN_REASONS.department_is_handler}`});
  }
  return {tenant_id:tenantId,rows:rows.length,proposals,open,
    counts:{placements:rows.length,with_capability:proposals.filter(p=>p.required_capability).length,
      with_department:proposals.filter(p=>p.department_id).length,stays_open:open.length},
    by_reason:Object.fromEntries(Object.keys(OPEN_REASONS).map(key=>[key,open.filter(o=>o.reason_key===key).length])),
    note:'الاقتراح يقف عند ما تعرفه المنصة: تصريحٌ يرفض الطلب فعلًا، أو خدمةٌ هي بطبعها إجراء إدارةٍ داخلي. وما عدا ذلك يبقى مفتوحًا عن قصد، ومن يطلب ماذا قرارك أنت.'};
}

/* ═════ (2) المقارنة الظلية: من يخسر ماذا ومن يكسب ماذا، قبل أن يسري شيء ═════
   النموذج shadowCompare في app/department-levels.mjs حرفًا بحرف: تمرّ على كل حساب نشط، تحسب الجواب
   قبل وبعد، وتسمّي كل فرق. والفرق الوحيد أن الوحدة هنا «خدمة يراها ويقدر يطلبها» لا «تصريح يحمله» —
   والشرط الواحد في visibleSql هو نفسه الذي يحكم الرؤية والطلب، فلا مجموعتان تفترقان.

   والأساس (base) يُقرأ بالجملة الحقيقية نفسها مع تحييد شرط الأهلية وحده ('all')، ثم يُطبَّق الشرط في
   الذاكرة: فما يُقاس هو أثر الشرط بعينه، لا أثرُ إعادة كتابة الاستعلام. */
function baseCodesFor(db,u){
  return new Set(db.prepare(`SELECT DISTINCT s.code FROM services s WHERE s.tenant_id=? AND s.active=1
    AND ${visibleSql('s','code','service',audiencesFor(u),'all')}`).all(u.tenant_id).map(r=>r.code));
}
// «هل يمرّ هذا الحساب من هذا الشرط»: الحساب بلا شرط يمرّ؛ وذو الشرط يمرّ بتصريحه وبإدارته معًا.
// المقياس can نفسه الذي تَعِد به بطاقة الخدمة، بلا نطاق إدارة — الوعد المكتوب هو المفروض.
const passes=(gate,held,departmentId)=>{
  if(!gate)return true;
  if(String(gate.required_capability??'').trim()&&!held.has(gate.required_capability))return false;
  if(gate.department_id&&gate.department_id!==departmentId)return false;
  return true;
};
// يُسأل can عن التصاريح التي يشترطها قرارٌ قائم أو مقترح **وحدها**: passes لا تقرأ غيرها، فالتضييق
// مطابقٌ تمامًا لا تقريب. والمقارنة تمرّ على كل حساب نشط، فسؤال المئة وواحد لكل حساب ثمنٌ بلا مشترٍ.
function heldBy(db,u,keys){
  const held=new Set();
  for(const key of keys){try{if(can(db,u,key))held.add(key);}catch{/* تصريح لا يُقاس لهذا الحساب لا يُعدّ محمولًا */}}
  return held;
}
// proposal: قائمة اقتراحات deriveGates (أو أي قائمة بالشكل نفسه). «بعد» = الشرط الساري مُغطّى بالمقترح.
export function shadowCompareGates(db,tenantId,proposals=[]){
  const before=currentGates(db,tenantId);
  const after=new Map(before);
  for(const p of proposals){
    const cap=String(p.required_capability??''),dept=p.department_id??null;
    if(!cap&&!dept)after.delete(p.code);
    else after.set(p.code,{required_capability:cap,department_id:dept,basis:p.basis??''});
  }
  const keys=new Set();
  for(const map of [before,after])for(const g of map.values())if(String(g.required_capability??'').trim())keys.add(g.required_capability);
  const users=db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(tenantId);
  const differences=[];
  let checks=0,codes=0;
  for(const u of users){
    const base=baseCodesFor(db,u),held=heldBy(db,u,keys);
    codes=Math.max(codes,base.size);
    for(const code of base){
      checks++;
      const was=passes(before.get(code),held,u.department_id),is=passes(after.get(code),held,u.department_id);
      if(was!==is)differences.push({user_id:u.id,user_name:u.name,role:u.role,department_id:u.department_id,
        service_code:code,direction:is?'gained':'lost',
        gate:is?null:{required_capability:after.get(code)?.required_capability??'',department_id:after.get(code)?.department_id??null}});
    }
  }
  const lost=differences.filter(d=>d.direction==='lost');
  return {clean:differences.length===0,accounts:users.length,services:codes,checks,
    gained:differences.filter(d=>d.direction==='gained').length,lost:lost.length,
    // من يخسر ماذا، بالاسم. الرفض يقرؤها ويطبعها، فلا يُقال «أحدهم يخسر شيئًا».
    lost_by_account:[...new Map(lost.map(d=>[d.user_id,d.user_name])).entries()].map(([id,name])=>({user_id:id,user_name:name,
      services:lost.filter(d=>d.user_id===id).map(d=>d.service_code)})),
    differences:differences.slice(0,200)};
}

/* ═════ (3) الباب: تصريحٌ وإدارةٌ على خدمة واحدة، بسند مكتوب، داخل معاملة، وبحدث تدقيق ═════ */
function requireOwner(db,supplied,what){
  const u=actorOrRefuse(db,supplied);
  if(!isSuperAdmin(u))refuse(403,'forbidden',{what,
    missing:[{document:'امتياز الأدمن الأول (سوبر ادمن)',why:'الشرط يغيّر ما يراه كل موظف في الدليل وما يقدر يطلبه، وهو قرار صاحب المنصة وحده',
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'اطلب من الأدمن الأول يضع الشرط من شاشة «إعداد الاعتماد»، أو يمنحك امتياز الأدمن الأول'});
  return u;
}

export function setServiceGate(db,supplied,input){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'ما انحفظ شرط الخدمة',next:'أعد المحاولة؛ يُنفَّذ القرار داخل معاملة واحدة'});
  const u=requireOwner(db,supplied,'ما ينوضع شرط على خدمة بحسابك');
  v.object(input,['service_code','required_capability','department_id','basis']);
  const code=v.text(input.service_code,'رمز الخدمة',60,2);
  const service=db.prepare(`SELECT s.code,s.name_ar,s.approval_policy FROM services s WHERE s.tenant_id=? AND s.code=? AND s.active=1
    ORDER BY s.version DESC LIMIT 1`).get(u.tenant_id,code);
  if(!service)refuse(404,'not_found',{what:`ما فيه خدمة برمز «${code}» في هذا الكيان`,
    missing:[{document:'رمز خدمة موجود فعلًا في الدليل',why:'الشرط يُوضع على رمز مسجَّل، وما ينوضع على رمز مكتوب غلط',
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'افتح «شروط أهلية الخدمات» في شاشة «إعداد الاعتماد» واختر الخدمة من القائمة'});
  // القناة السرية لا تُشرَط: هي الطريق الوحيد لبلاغ أو تظلّم، وحصرها يقطعه. الاشتقاق يرفض اقتراحها،
  // والباب يرفض وضعها باليد — وإلا صار الزر يفعل ما ترفضه القاعدة.
  const guarded=guardedChannels(db,u.tenant_id).find(g=>g.code===code);
  if(guarded)refuse(400,'closed_circle',{what:`«${guarded.name_ar}» قناة سرية، وما تنحط عليها شروط`,
    missing:[{document:'بديل معلن لتقديم البلاغ أو التظلّم',why:OPEN_REASONS.confidential_channel,
      owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
    next:'خلّها مفتوحة للجميع؛ لو تبي تضيّقها لازم يكون فيه طريق ثاني معلن يوصل فيه الموظف للبلاغ'});
  const key=String(input.required_capability??'').trim();
  if(key){
    const c=capability(key);
    if(!c)refuse(404,'capability',{what:`ما فيه تصريح بالمفتاح «${key}» في المنصة`,
      missing:[{document:'مفتاح تصريح من قائمة المنصة',why:'التصاريح مكتوبة في app/access.mjs، والتحقق بـcan لا بإحالة لجدول',
        owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اختر تصريحًا من قائمة «مصفوفة الصلاحيات»'});
    // تصريحٌ يحمله كل موظف ما يرفض أحدًا: يطبع على البطاقة وعدًا بحصرٍ ما يحصر شيئًا، وهو نوع الكذب
    // الذي بُني هذا الترحيل ليغلقه — فلا يُقبل من الباب الذي يغلقه.
    if(c.everyone)refuse(400,'capability',{what:`«${c.name}» يحمله كل موظف أصلًا، فما يحصر أحد`,
      missing:[{document:'تصريح يُمنح لبعض الحسابات لا لكلها',why:'شرطٌ يمرّ منه الجميع يطبع على بطاقة الخدمة وعدًا بحصر ما يفرضه شيء',
        owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اختر تصريحًا يُمنح فعلًا، أو احصرها بإدارة، أو خلّها مفتوحة'});
    // وتصريح إدارة المنصة يقفلها بوجه **الجميع** لا بوجه بعضهم: grantAccess لا يمنحه إلا لحساب إداري،
    // وcreateRequest يردّ حساب الإدارة عن كل معاملة أعمال. فالنتيجة خدمةٌ ما يقدر يطلبها أحد — إقفالٌ
    // صامت بصورة تضييق، وهو أسوأ ما يمكن أن يفعله هذا الباب.
    if(c.admin||c.super)refuse(400,'capability',{what:`«${c.name}» من تصاريح إدارة المنصة، وحسابات الإدارة ما تفتح طلبات أصلًا`,
      missing:[{document:'تصريح يحمله موظف يقدر يقدّم طلبًا',why:'الشرط بهذا التصريح يقفل الخدمة بوجه الجميع: ما يحمله إلا حسابٌ إداري، والحساب الإداري مردود عن كل معاملة أعمال',
        owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اختر تصريحًا يُمنح لموظف، أو احصرها بإدارة، أو أوقفها من «تفعيل الخدمات وإخفاؤها» إن كنت تبي تقفلها فعلًا'});
  }
  const department=input.department_id===null||input.department_id===undefined||input.department_id===''?null:String(input.department_id);
  if(department){
    const row=db.prepare('SELECT id,name,active FROM departments WHERE id=? AND tenant_id=?').get(department,u.tenant_id);
    if(!row)refuse(404,'department',{what:`ما فيه إدارة بالمعرّف «${department}» في هذا الكيان`,
      missing:[{document:'معرّف إدارة مسجَّلة',why:'الحصر يمشي على إدارة قائمة في الهيكل، وما يمشي على معرّف مكتوب غلط',
        owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'اختر الإدارة من قائمة «الإدارات والهيكل والتصعيد»'});
    if(!row.active)refuse(400,'department',{what:`«${row.name}» إدارة موقوفة، وحصر خدمة فيها يقفلها بوجه الجميع`,
      missing:[{document:'إدارة نشطة',why:'الإدارة الموقوفة ما فيها منسوبين يمرّون من الشرط، فالحصر فيها إقفال لا تضييق',
        owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'فعّل الإدارة أولًا من «الإدارات والهيكل»، أو احصرها في إدارة نشطة'});
  }
  const basis=v.text(input.basis,'سند القرار',400,10);
  const before=currentGates(db,u.tenant_id).get(code)??null;
  const beforeState={required_capability:before?.required_capability??'',department_id:before?.department_id??null};
  const afterState={required_capability:key,department_id:department};
  if(beforeState.required_capability===afterState.required_capability&&beforeState.department_id===afterState.department_id){
    if(!key&&!department)refuse(409,'no_gate',{what:`«${service.name_ar}» مفتوحة أصلًا، وما فيه شرط يُرفع عنها`,
      next:'لو تبي تشرطها اختر تصريحًا أو إدارة؛ السجل ما يقبل صفًّا ما يغيّر شي'});
    refuse(409,'already_in_state',{what:`«${service.name_ar}» عليها هذا الشرط نفسه من قبل`,
      next:'غيّر التصريح أو الإدارة، أو ارفع الشرط؛ السجل ما يقبل صفًّا ما يغيّر شي'});
  }
  db.prepare('INSERT INTO service_gate(tenant_id,service_code,required_capability,department_id,basis,decided_by,decided_at) VALUES(?,?,?,?,?,?,?)')
    .run(u.tenant_id,code,key,department,basis,u.id,now());
  // صورة القرار على الإسقاط، لكل جمهور له صفٌّ بهذا الرمز. الإسقاط يُعاد بناؤه من service_gate في
  // projectCatalog، فهذان السطران يجعلان الشرط ساريًا **الآن** لا عند أول تشغيلة مثبّت.
  db.prepare("UPDATE catalog_placement SET required_capability=?,department_id=? WHERE tenant_id=? AND item_kind='service' AND item_key=?")
    .run(key,department,u.tenant_id,code);
  audit(db,u,'service_gate',code,key||department?'service_gate.set':'service_gate.lifted',beforeState,{...afterState,service_code:code},basis);
  return {service_code:code,service:service.name_ar,required_capability:key,capability_name:key?capabilityName(key):'',
    department_id:department,basis,decided_at:now(),lifted:!key&&!department};
}

/* ═════ (4) التطبيق دفعةً: المقارنة أولًا، والرفض بالأسماء إن خسر أحد ═════
   كلٌّ أو لا شيء داخل معاملة واحدة، والبوابة تُحسب **لحظة التطبيق** لا من نتيجة محفوظة: نفس قاعدة
   setSwitch في app/department-levels.mjs. ولا تُبنى على ادّعاء المشغِّل أن المقارنة كانت نظيفة. */
export function applyProposal(db,supplied,proposals,{basis=''}={}){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'ما انطبق شي',next:'أعد المحاولة؛ تُطبَّق الشروط كلها داخل معاملة واحدة'});
  const u=requireOwner(db,supplied,'ما تنطبق شروط الأهلية بحسابك');
  const list=Array.isArray(proposals)?proposals:[];
  const shadow=shadowCompareGates(db,u.tenant_id,list);
  if(shadow.lost>0){
    const names=shadow.lost_by_account.slice(0,10).map(a=>`${a.user_name} (${a.services.length} خدمة: ${a.services.slice(0,5).join('، ')})`);
    refuse(409,'shadow_not_clean',{what:`ما انطبق شي: ${shadow.lost} حالة فقد على ${shadow.lost_by_account.length} حساب`,
      missing:[{document:'قرار مكتوب من المالك على كل حساب يخسر وصولًا',
        why:`اللي يخسرون: ${names.join('؛ ')}${shadow.lost_by_account.length>10?' وغيرهم':''}`,
        owner:superAdminName(db,u.tenant_id),owner_role:'admin'}],
      next:'راجع القائمة؛ لو الفقد مقصود ضع كل شرط بابًا بابًا بسنده من شاشة «إعداد الاعتماد»، فيُسجَّل قرارًا باسمه لا دفعةً صامتة'});
  }
  const applied=[];
  for(const p of list)applied.push(setServiceGate(db,u,{service_code:p.code,required_capability:p.required_capability??'',
    department_id:p.department_id??null,basis:basis||p.basis}));
  return {applied:applied.length,shadow,gates:applied};
}

/* ═════ (5) الشاشة ═════ */
// اللوح يُبنى للأدمن الأول وحده؛ غيره يقرأ can_manage=false بقوائم فارغة، فلا تُرسم شاشة أفعال لا يملكها.
// والمقارنة الظلية **لا تُحسب هنا**: تمرّ على كل حساب نشط × كل خدمة، والخادم raw node:http بخيط واحد
// وnode:sqlite متزامن — القاعدة نفسها المكتوبة في app/department-levels.mjs. تُشغَّل من السكربت وتُقرأ نتيجتها.
export function gatesBoard(db,supplied){
  const u=actorOrRefuse(db,supplied);
  const tenantId=u.tenant_id,manage=isSuperAdmin(u);
  // غير المالك لا يصله شيء من هذا الباب — قوائم فارغة لا شاشة أفعالٍ لا يملكها، كما يفعل لوح المفاتيح
  // فوقه. وهذه الشاشة يفتحها مدير الإدارة لأزمنة خدماته، فلا تُحمَّل رسالتُه بـ142 خدمة و101 تصريح.
  if(!manage)return {can_manage:false,owner:superAdminName(db,tenantId),
    totals:{placements:0,gated:0,open:0,proposed_capability:0,proposed_department:0},
    gates:[],proposal:{proposals:[],counts:{placements:0,with_capability:0,with_department:0,stays_open:0},
      by_reason:{},note:'',reasons:OPEN_REASONS,open_sample:[]},
    guarded:[],capabilities:[],departments:[],services:[],history:[],
    note:'شروط أهلية الخدمات للأدمن الأول وحده.'};
  const derived=deriveGates(db,tenantId);
  const gates=currentGates(db,tenantId);
  const named=new Map(db.prepare(`SELECT s.code,s.name_ar,s.department_id FROM services s WHERE s.tenant_id=? AND s.active=1
      AND s.version=(SELECT MAX(n.version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code) ORDER BY s.code`).all(tenantId).map(r=>[r.code,r]));
  const departmentName=id=>id?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(id,tenantId)?.name??id:null;
  const rows=[...gates.entries()].map(([code,g])=>({service_code:code,service:named.get(code)?.name_ar??code,
    required_capability:g.required_capability,capability_name:g.required_capability?capabilityName(g.required_capability):'',
    department_id:g.department_id,department_name:departmentName(g.department_id),
    basis:g.basis,decided_by_name:g.decided_by_name,decided_at:g.decided_at,
    actions:manage?['set_service_gate']:[]})).sort((a,b)=>a.service_code.localeCompare(b.service_code));
  return {can_manage:manage,owner:superAdminName(db,tenantId),
    totals:{placements:derived.counts.placements,gated:rows.length,open:derived.counts.placements-rows.length,
      proposed_capability:derived.counts.with_capability,proposed_department:derived.counts.with_department},
    gates:rows,
    // الاقتراح يُعرض بعدده وبسبب كل صنفٍ بقي مفتوحًا. صفرٌ باقتراحاته ليس شاشةً فارغة: هو النتيجة نفسها،
    // ومكتوبٌ لماذا — وهذا الفرق بين «مفتوحة عن قصد» و«مفتوحة لأن أحدًا ما ملأ الخانة».
    proposal:{proposals:derived.proposals,counts:derived.counts,by_reason:derived.by_reason,note:derived.note,
      reasons:OPEN_REASONS,open_sample:derived.open.slice(0,12)},
    guarded:guardedChannels(db,tenantId).map(g=>({code:g.code,name:g.name_ar,why:OPEN_REASONS.confidential_channel})),
    // القائمة المعروضة هي ما يُقبل فعلًا في الباب: بلا تصاريح «الجميع» (لا تحصر أحدًا) وبلا تصاريح
    // إدارة المنصة (تقفل الخدمة بوجه الجميع). فما يُعرض في القائمة هو ما يمرّ، ولا يُردّ المالك بعد اختياره.
    capabilities:CAPABILITIES.filter(c=>!c.everyone&&!c.admin&&!c.super).map(c=>({key:c.key,name:c.name,group:c.group})),
    departments:db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(tenantId),
    services:[...named.values()].map(s=>({code:s.code,name:s.name_ar,department_id:s.department_id})),
    history:gateHistory(db,tenantId),
    note:'الخدمة بلا شرط مفتوحة عن قصد: المنصة ما تعرف لها شرطًا تفرضه، وما تخترع لك سياسة عن مين يطلب وش. الشرط اللي تحطه هنا يختفي معه الباب من الدليل ومن البحث ومن نافذة الطلب، ويُردّ الطلب عليه برفضٍ يسمّي الناقص ومن يملكه. ويبقى القرار وسنده في السجل بعد رفعه.'};
}
