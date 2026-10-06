// مفتاح تفعيل الخدمة وإخفائها (ترحيل 129) — طلب المالك 22 سبتمبر 2026.
// «تذكرة السفر السنوية خل عندي خيار اني افعلها او اخفيها من صفحه الاعدادات والصلاحيات لكل خدمه».
//
// المثال الذي ضربه المالك ليس خدمة في الدليل: «تذكرة السفر السنوية» هي الميزة air_ticket في benefit_catalog،
// يبلغها الموظف من خيار الطلب ticket_claim في «مزاياي». فالمفتاح يمسك سجلّين لا سجلًا واحدًا — خدمات الدليل
// بالرمز، والمزايا بمفتاحها — ولذلك يحمل كل صف kind. مفتاح على services وحدها ما كان ليمس التذكرة أصلًا.
//
// ثلاث قواعد تحكم هذه الوحدة:
//   (1) الافتراضي بلا صف «متاحة». لا يُدرج صف عند التهيئة، ولا يتغير شيء لخدمة لم يمسّها المالك.
//   (2) السجل إلحاقي: الإخفاء قرار بسببه، وإعادة التفعيل قرار ثانٍ بسببه، ويبقى الاثنان. الحالة السارية
//       صاحب أكبر seq. القادح service_availability_no_repeat يمنع صفًّا لا يغيّر شيئًا.
//   (3) الإخفاء ليس حذفًا: الطلب المفتوح على خدمة مخفية يكمل مساره واعتماده وتنفيذه وتقاريره وصندوقه
//       كما لو لم يُخفَ شيء. getService في app/workflow.mjs يقرأ بالمعرّف بلا هذا المرشّح عمدًا.
//
// لا تستورد هذه الوحدة workflow.mjs ولا service-catalog.mjs: تقرأ جدول services بالـSQL مباشرة، فلا تدخل
// في دورة الاستيراد القائمة بين الاثنتين. وسرية الخدمة تُقرأ من نسختها المخزَّنة (approval_policy) لا من
// قائمة في الكود، فهي حال النسخة التي يقف عليها الدليل الآن.
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, capabilityName, CAPABILITIES } from './access.mjs';
// بيانات ورقية (قائمة ثابتة بلا استيراد لأي وحدة خادم): app/search.mjs وapp/policy-assistant.mjs تقرآنها من هنا نفسه.
import { MODULE_SERVICES } from './static/module-services.mjs';

// التصريح الذي يملك المفتاح: التصريح نفسه الذي يملك كل كتابة على خدمة (createService وsetServiceSection
// وsetServiceTarget وبطاقات الخدمة وPOST /api/catalog). لا تصريح جديد لبابٍ هو نفسه باب إعداد الخدمات.
export const CAPABILITY='catalog.manage';
export const KINDS=Object.freeze(['service','benefit']);
export const STATES=Object.freeze(['available','hidden']);
export const STATE_NAMES=Object.freeze({available:'مفعَّلة',hidden:'موقوفة من الإعدادات'});
export const KIND_NAMES=Object.freeze({service:'خدمة في الدليل',benefit:'ميزة في «مزاياي»'});

// شرط SQL يُحقن في جملة قائمة: «صف الخدمة هذا ليست حالته السارية مخفية». alias هو اسم جدول services في
// الجملة المضيفة. مصدر واحد للشرط، فلا ينحرف مرشّح الدليل عن مرشّح البحث عن مرشّح بطاقات الخدمة.
export const availableSql=(alias='s',column='code',kind='service')=>`NOT EXISTS(SELECT 1 FROM service_availability sa
  WHERE sa.tenant_id=${alias}.tenant_id AND sa.kind='${kind}' AND sa.target_key=${alias}.${column} AND sa.state='hidden'
    AND sa.seq=(SELECT MAX(sax.seq) FROM service_availability sax WHERE sax.tenant_id=sa.tenant_id AND sax.kind=sa.kind AND sax.target_key=sa.target_key))`;

// ── الجمهور (ترحيل 131) ───────────────────────────────────────────────────────
// أربعة في المخطط، والمكتوب منها صفوفًا اثنان: لا دور لعميل ولا لمورّد في users
// (employee, manager, hr, it, admin, pm) ولا أحد منهما يستطيع الدخول.
export const AUDIENCES=Object.freeze(['employee','manager','client','vendor']);
// من يرى دليل المدير: **كل من يطلب نيابةً عن غيره**، لا حامل الدور «manager» وحده. الموارد البشرية
// وتقنية المعلومات ومدير المشروع ومسؤول المنصة يفتحون اليوم الدليل كاملًا، وتضييقُه عليهم تغييرٌ لم
// يطلبه أحد. فالتضييق الوحيد في هذه الحزمة يقع على الموظف بلا صفة: IT-NEW-ACCOUNT — تجهيز حسابات
// موظف جديد — لا يطلبها موظفٌ لنفسه أبدًا، ومع ذلك يراها اليوم الجميع.
export const audiencesFor=user=>user&&user.role&&user.role!=='employee'?['employee','manager']:['employee'];

// «وهل يرى هذا الجمهور هذه الخدمة في الشجرة أصلًا» — شرطٌ **داخل المُسنَد نفسه** لا مرشِّحٌ ثانٍ بجواره.
// أربعة مسارات قراءة تمرّ على هذه الدالة (الدليل، البحث، الأزرار السريعة، بطاقات الخدمة)، ولو أُضيف
// الجمهور بجوارها لانشطرت الرؤية بينها وظهرت خدمة في البحث لا تظهر في التصفّح.
//
// والشقّ الأول ضرورة لا احتياط، **وهو القاعدة التي تمنع أخطر ما في هذا الشرط**: خدمةٌ لا صفَّ لها في
// الإسقاط **تبقى ظاهرة للجميع** ولا تختفي بالصمت. فبلا هذا الشقّ تختفي من الدليل كلُّ خدمة أُنشئت بعد
// آخر إسقاط، وكلُّ مستأجرٍ لم يُسقَط له شيء (ومنه isolated في البذرة، وكل قاعدة فُتحت على 131 قبل أن
// يُشغَّل المثبّت) يصير دليلُه فارغًا. والخدمة غير المُسنَدة تُقال ولا تُطرح: تُعدّ في items_unplaced
// في catalog_projection_state ويقرؤها لوح صحة الدليل، وهدف ذلك الرقم صفر.
// أي أن الشرط **يضيّق على ما أُسنِد وحده**، ولا يمنح الإسقاطُ رؤيةً ولا يمنعها عمّا لم يبلغه بعد.
const placedSql=(alias,column,audiences,gates)=>`(NOT EXISTS(SELECT 1 FROM catalog_placement cp WHERE cp.tenant_id=${alias}.tenant_id
    AND cp.item_kind='service' AND cp.item_key=${alias}.${column})
  OR EXISTS(SELECT 1 FROM catalog_placement p WHERE p.tenant_id=${alias}.tenant_id AND p.item_kind='service'
    AND p.item_key=${alias}.${column} AND p.visible=1 AND p.audience IN (${audiences.map(a=>`'${a}'`).join(',')})
    AND ${gateSql('p',gates)}))`;

/* ── شرط الأهلية على صفّ الإسقاط (ترحيل 138) ────────────────────────────────────
   العمودان required_capability وdepartment_id في catalog_placement موجودان منذ 131، ولم يقرأهما
   **مرشّحُ ظهورٍ واحد** حتى هذا السطر: قارئهما الوحيد كان eligibilityFrom في app/service-cards.mjs،
   وهي تطبعهما للموظف نصًّا — «لازم يكون بحسابك تصريح كذا»، «الخدمة هذي لمنسوبي كذا وبس». فالبطاقة
   كانت تعد بحصرٍ لا يفرضه أحد. هنا يُفرض، وفي الموضع الواحد الذي يفرض منه شرطُ 129 وشرطُ الجمهور،
   فلا يفترق مرشّح الدليل عن مرشّح البحث عن مرشّح بطاقات الخدمة عن مرشّح الأزرار السريعة.

   وgates ثلاثة أحوال لا حالان، والفرق بينها مقصود:
     كائن {capabilities, department_id} — سياق حسابٍ بعينه: يمرّ ما لا شرط له، وما شرطُه تصريحٌ يحمله،
       وما حصرُه إدارتُه. وهذا هو الحال الوحيد الذي يقرأ به موظفٌ الدليلَ.
     'all' — لا تصفية: أسطح الإدارة التي **تعدّ الشجرة كلها** (لوح الدليل وفحص جودته) لا تقرأ بعين
       حساب، ولو صُفّيت لعدّت أقلّ مما تديره وظهر الفرق الذي بُنيت عدّاداتها لمنعه.
     غياب/null — **يمرّ غير المشروط وحده**. الباب مغلق عند النسيان لا مفتوح: قارئٌ جديد يُضاف غدًا
       وينسى تمرير السياق يُخفي خدمةً مشروطة، ولا يسرّبها لمن لا يملك شرطها.

   وفرقٌ يُقال ولا يُكتشف بالمفاجأة: الأدمن الأول يمرّ من **شرط التصريح** دائمًا (isSuperAdmin في
   app/access.mjs تجعل can صادقة لكل تصريح غير حساس)، ولا يمرّ من **حصر الإدارة** إن لم يكن من
   منسوبيها — الحصر صفةُ انتماء لا صلاحية تُمنح. فالخدمة المحصورة بإدارةٍ تختفي من دليله هو أيضًا،
   وتبقى أمامه في لوح الشروط وفي لوح الدليل (كلاهما يقرأ بـ'all')، ويرفعها من حيث وضعها. */
export const gateSql=(alias='p',gates=null)=>{
  if(gates==='all')return '1=1';
  if(!gates)return `(${alias}.required_capability='' AND ${alias}.department_id IS NULL)`;
  const keys=[...new Set((gates.capabilities??[]).map(String))].filter(k=>/^[a-z][a-z._]{2,39}$/.test(k));
  const held=keys.length?` OR ${alias}.required_capability IN (${keys.map(k=>`'${k}'`).join(',')})`:'';
  const dept=typeof gates.department_id==='string'&&/^[a-z][a-z0-9-]{1,39}$/.test(gates.department_id)
    ? ` OR ${alias}.department_id='${gates.department_id}'`:'';
  return `((${alias}.required_capability=''${held}) AND (${alias}.department_id IS NULL${dept}))`;
};

// سياق الأهلية لحسابٍ بعينه: ما يحمله من تصاريح، وإدارته. يُحسب مرة ويُمرَّر، فلا يُستدعى can مرةً
// لكل صفّ خدمة. والمقياس can نفسه الذي تَعِد به بطاقة الخدمة («لازم يكون بحسابك تصريح كذا») بلا نطاق
// إدارة: الوعد المكتوب للموظف هو المفروض عليه، حرفًا بحرف.
//
// ولا يُسأل can إلا عن **التصاريح التي يشترطها إسقاطٌ فعلًا**، لا عن المئة وواحد كلها. الفرق ليس تحسينًا
// تجميليًّا: catalog(db,u) تُنادى في كل مسار قراءة تقريبًا، وكل نداء can يقرأ أربعة جداول — فسؤال المئة
// كان يضيف ‎~29ms‎ لكل قراءة دليل على مقاس القاعدة الحية، على خادم raw node:http بخيط واحد وnode:sqlite
// متزامن. والقاعدة نفسها مكتوبة في app/department-levels.mjs عن المقارنة الظلية. وبلا شرطٍ واحد في
// الإسقاط — وهو حالُ الـ169 اليوم — لا يُسأل can ولا مرة، فالثمن صفر حتى يضع المالك أول شرط.
export function gatesFor(db,supplied){
  // هوية ناقصة تُقرأ صفًّا كما هي ولا تُسأل عنها القاعدة: currentUser تربط u.tenant_id بمُعامل SQLite،
  // فصفٌّ جزئي (اختبارات تبني حسابها بيدها) كان يصير عطل خادم في مسارٍ ما كان يسأل القاعدة أصلًا.
  // الحارس نفسه المكتوب في actorOrRefuse (app/refusal.mjs)، وبنتيجةٍ أضيق: بلا حساب لا شرط يُتخطّى.
  const u=(typeof supplied?.id==='string'&&typeof supplied?.tenant_id==='string'?currentUser(db,supplied):null)??supplied;
  if(!u||typeof u.tenant_id!=='string')return null;
  const wanted=db.prepare("SELECT DISTINCT required_capability AS key FROM catalog_placement WHERE tenant_id=? AND required_capability<>''")
    .all(u.tenant_id).map(r=>r.key).filter(key=>CAPABILITIES.some(c=>c.key===key));
  const held=[];
  for(const key of wanted){try{if(can(db,u,key))held.push(key);}catch{/* تصريح لا يُقاس لهذا الحساب لا يُعدّ محمولًا */}}
  return {capabilities:held,department_id:typeof u.department_id==='string'?u.department_id:null};
}

// المرشّح الواحد الذي تراه مسارات القراءة: الموقوفة بـ129 **و**غير المُسنَدة لجمهور هذا الحساب
// **و**ما شرطُه تصريحٌ أو إدارةٌ ليست له (138).
// والمزايا (kind='benefit') لا شجرة لها: تُبلَغ من «مزاياي» ولا تدخل catalog_placement، فلا يُركَّب
// عليها شرط جمهور يطرحها كلها.
export const visibleSql=(alias='s',column='code',kind='service',audiences=['employee'],gates=null)=>{
  const available=availableSql(alias,column,kind);
  if(kind!=='service')return available;
  const list=(Array.isArray(audiences)?audiences:[audiences]).filter(a=>AUDIENCES.includes(a));
  // جمهورٌ خارج الأربعة يُرفض لا يُقرأ دليلًا كاملًا: كان الشرط يسقط إلى شرط 129 وحده فيرى «partner» ما لا
  // يراه الموظف. placementFor ترفضه بالجملة نفسها، فالبابان يردّان ردًّا واحدًا.
  if(!list.length)throw new Error('visibleSql needs at least one known audience: '+AUDIENCES.join(', '));
  return `${available} AND ${placedSql(alias,column,list,gates)}`;
};

// آخر قرار مسجَّل على شيء بعينه، أو null إن لم يُتخذ فيه قرار قط.
export function lastDecision(db,tenantId,kind,key){
  return db.prepare('SELECT * FROM service_availability WHERE tenant_id=? AND kind=? AND target_key=? ORDER BY seq DESC LIMIT 1').get(tenantId,kind,key)??null;
}
export const stateOf=(db,tenantId,kind,key)=>lastDecision(db,tenantId,kind,key)?.state??'available';
export const isHidden=(db,tenantId,kind,key)=>stateOf(db,tenantId,kind,key)==='hidden';

// مفاتيح ما هو مخفيٌّ الآن من نوع واحد. مجموعة واحدة تُقرأ مرة وتُستعمل في حلقة، بدل استعلام لكل صف.
export function hiddenKeys(db,tenantId,kind){
  return new Set(db.prepare(`SELECT target_key FROM service_availability a WHERE a.tenant_id=? AND a.kind=? AND a.state='hidden'
    AND a.seq=(SELECT MAX(x.seq) FROM service_availability x WHERE x.tenant_id=a.tenant_id AND x.kind=a.kind AND x.target_key=a.target_key)`).all(tenantId,kind).map(r=>r.target_key));
}
export const hiddenServiceCodes=(db,tenantId)=>hiddenKeys(db,tenantId,'service');
export const hiddenBenefitKeys=(db,tenantId)=>hiddenKeys(db,tenantId,'benefit');
export const hiddenServiceCount=(db,tenantId)=>hiddenServiceCodes(db,tenantId).size;
// عدد الموقوف **كما يخصّ جمهور القارئ** (مراجعة 23 سبتمبر): الرمز الموقوف الذي له صفٌّ في إسقاط أحد جماهيره، أو لا صفَّ له
// في الإسقاط أصلًا (فهو ظاهرٌ للجميع قبل الإيقاف — قاعدة «خدمةٌ بلا موضع تبقى ظاهرة»). أما الموقوف لجمهورٍ لا يشمل
// القارئ فلم يكن في دليله قط، ولا يُقال له «خدمة موقوفة من الإعدادات» عن بابٍ لم يره.
export function hiddenServiceCountFor(db,tenantId,audiences){
  const list=(Array.isArray(audiences)?audiences:[audiences]).filter(a=>AUDIENCES.includes(a));
  if(!list.length)throw new Error('hiddenServiceCountFor needs at least one known audience: '+AUDIENCES.join(', '));
  const marks=list.map(()=>'?').join(',');
  const anywhere=db.prepare("SELECT 1 FROM catalog_placement WHERE tenant_id=? AND item_kind='service' AND item_key=? LIMIT 1");
  const mine=db.prepare(`SELECT 1 FROM catalog_placement WHERE tenant_id=? AND item_kind='service' AND item_key=? AND audience IN (${marks}) LIMIT 1`);
  let n=0;
  for(const code of hiddenServiceCodes(db,tenantId))if(!anywhere.get(tenantId,code)||mine.get(tenantId,code,...list))n++;
  return n;
}

// من يملك إعادة التفعيل، بالاسم. capabilityHolders في app/access.mjs يستثني الحسابات الإدارية عمدًا (فهي
// لا تعتمد معاملات أعمال)، وحاملُ «إعداد الخدمات» الوحيد في التهيئة حسابٌ إداري — فلو استُعملت هناك لعاد
// الرفض بلا اسم أحد. هنا يُسأل can نفسه عن كل حساب نشط، فيظهر الأدمن الأول ومن مُنح التصريح صراحةً.
export function switchOwners(db,tenantId){
  return db.prepare('SELECT id,tenant_id,name,role,department_id,admin_level FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(tenantId)
    .filter(p=>{try{return can(db,p,CAPABILITY);}catch{return false;}}).map(p=>({id:p.id,name:p.name,role:p.role}));
}
const ownerText=(db,tenantId)=>{const owners=switchOwners(db,tenantId);return owners.length?owners.map(o=>o.name).join('، '):'مسؤول المنصة';};
// اسم من اتخذ القرار لا معرّف دخوله. decided_by عمودٌ يحمل users.id، وكان يُطبع كما هو في السطر الذي يقرؤه
// الموظف: فتقول الجملة الواحدة «أوقفها admin» و«يعيد تفعيلها مسؤولة المنصة» عن الشخص نفسه. decorate
// وavailabilityHistory في هذا الملف تحلّانه من users منذ البداية؛ هذه ثالثتهما، ومصدرها واحد.
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??userId:'';

// سبب الإيقاف بنصه ومن اتخذه ومتى، جملةً واحدة. تُقرأ في الرفض وفي «مزاياي» وفي لوح المراكز سواء.
export function stopNote(db,tenantId,kind,key){
  const decision=lastDecision(db,tenantId,kind,key);
  return decision?`أوقفها ${personName(db,decision.decided_by)} في ${String(decision.decided_at).slice(0,10)}: ${decision.reason}`:'موقوفة من إعدادات الخدمات';
}

// الرفض المكتوب حين يُطلب شيء أوقفه المالك: ما رُفض، ولماذا هو موقوف بنص سبب القرار، ومن يعيد تفعيله، والخطوة التالية.
// يُستعمل في createRequest وفي طلب المزايا ومطالبات المزايا الثلاث وإعادة التقديم من المنقضي وخيار الخدمة الواحدة،
// فالعبارة واحدة أينما اصطدم الموظف بالمفتاح.
export function refuseHidden(db,tenantId,kind,key,name){
  const what=`${name||key} موقوفة من الإعدادات، فلا يُفتح منها طلب جديد`;
  refuse(409,'service_hidden',{what,
    missing:[{document:'إعادة تفعيل هذه الخدمة من شاشة «إعداد الاعتماد»',
      why:stopNote(db,tenantId,kind,key),
      owner:ownerText(db,tenantId),owner_role:CAPABILITY}],
    next:`اطلب إعادة تفعيلها ممن يملك «${capabilityName(CAPABILITY)}»؛ طلباتك المفتوحة عليها تكمل مسارها كما هي ولا يتوقف منها شيء`,
    link:'#approval-settings'});
}

/* ───── شرط الأهلية: القرار الساري وقراءته (ترحيل 138) ────────────────────── */
// الشرط الساري لكل خدمة وُضع عليها شرطٌ يومًا، صاحبُ أكبر seq. الخدمة بلا صف لا شرط لها — وهذا هو
// حال الـ142 كلها اليوم. الخريطة تُقرأ مرة وتُستعمل في حلقة، بدل استعلام لكل صف.
export function currentGates(db,tenantId){
  const rows=db.prepare(`SELECT g.* FROM service_gate g WHERE g.tenant_id=?
    AND g.seq=(SELECT MAX(x.seq) FROM service_gate x WHERE x.tenant_id=g.tenant_id AND x.service_code=g.service_code)
    ORDER BY g.service_code`).all(tenantId);
  return new Map(rows.filter(r=>String(r.required_capability??'').trim()||r.department_id)
    .map(r=>[r.service_code,{required_capability:String(r.required_capability??''),department_id:r.department_id??null,
      basis:r.basis,decided_by:r.decided_by,decided_by_name:personName(db,r.decided_by),decided_at:r.decided_at}]));
}
// كل قرار شرطٍ اتُّخذ، أحدثه أولًا: الوضع والرفع معًا بسنديهما. لا يُختصر إلى «الشرط الآن».
export function gateHistory(db,tenantId,limit=200){
  return db.prepare(`SELECT g.*,x.name AS decided_by_name FROM service_gate g JOIN users x ON x.id=g.decided_by
    WHERE g.tenant_id=? ORDER BY g.seq DESC LIMIT ?`).all(tenantId,limit)
    .map(r=>({seq:r.seq,service_code:r.service_code,required_capability:r.required_capability,
      capability_name:r.required_capability?capabilityName(r.required_capability):'',
      department_id:r.department_id,basis:r.basis,decided_by_name:r.decided_by_name,decided_at:r.decided_at,
      lifted:!String(r.required_capability??'').trim()&&!r.department_id}));
}

// الرفض المكتوب حين يُطلب ما شرطُه ليس في الحساب. نظير refuseHidden بالضبط: ما رُفض، وما الناقص بنصّه،
// ومن يملكه، وما الخطوة التالية. ولماذا هذا الرفض ضرورة لا تحسين: createRequest يفحص عضويةَ الخدمة في
// catalog(db,u) ويردّ «توجد نسخة أحدث من الخدمة» لمن سقطت عنه — وهي كذبة، لا نسخة أحدث ولا شيء. وهو
// العطب نفسه الذي أُصلح لخدمة 129 الموقوفة في السطر الذي فوقه. فيُقال للموظف ما الشرط ومن يملك منحه.
export function refuseGated(db,tenantId,code,name,gate){
  // مالك الشرط هو الأدمن الأول بعينه، لا حامل «إعداد الخدمات»: الباب (setServiceGate) لا يُفتح لغيره،
  // فلو سُمّي غيره لأُرسل الموظف إلى من لا يستطيع مساعدته. الاسم كما في app/department-levels.mjs.
  const owner=db.prepare("SELECT name FROM users WHERE tenant_id=? AND role='admin' AND admin_level='super' AND active=1 ORDER BY name").get(tenantId)?.name
    ??'الأدمن الأول';
  const missing=[];
  if(String(gate?.required_capability??'').trim())missing.push({document:`تصريح «${capabilityName(gate.required_capability)}»`,
    why:gate.basis||'شرطٌ وضعه مالك المنصة على هذه الخدمة',owner,owner_role:'admin'});
  if(gate?.department_id){const dept=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(gate.department_id,tenantId)?.name??gate.department_id;
    missing.push({document:`أن تكون من منسوبي ${dept}`,why:gate.basis||'الخدمة هذي إجراء داخلي لهذه الإدارة',
      owner,owner_role:'admin'});}
  refuse(403,'service_gated',{what:`${name||code} مشروطة، وما ينطبق عليك شرطها`,missing,
    next:'اطلب الشرط من مسؤول المنصة، أو اطلب منه يرفع الشرط عن الخدمة من شاشة «إعداد الاعتماد»',
    link:'#approval-settings'});
}

/* ───── الكتابة ───────────────────────────────────────────────────────────── */
// قرار واحد: يُسجَّل صفًّا في السجل الإلحاقي، ويُختم في سلسلة التدقيق، داخل معاملة واحدة.
export function setAvailability(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة قرار التفعيل معاملة قاعدة بيانات');
  const u=currentUser(db,supplied);
  if(!u)fail(403,'forbidden','الحساب غير متاح لتسجيل قرار تفعيل خدمة');
  if(!can(db,u,CAPABILITY))refuse(403,'not_permitted',{what:'تفعيل الخدمات وإخفاؤها ليس من صلاحيات حسابك',
    missing:[{document:`تصريح «${capabilityName(CAPABILITY)}»`,why:'المفتاح يغيّر ما يراه كل موظف في الدليل، فيملكه من يملك إعداد الخدمات',
      owner:ownerText(db,u.tenant_id),owner_role:CAPABILITY}],
    next:'اطلب التصريح من مسؤول المنصة، أو اطلب منه تنفيذ القرار نفسه'});
  v.object(input,['kind','target_key','state','reason']);
  const kind=String(input.kind??'');
  if(!KINDS.includes(kind))fail(400,'kind','نوع المفتاح إما خدمة في الدليل (service) أو ميزة في «مزاياي» (benefit)');
  const state=String(input.state??'');
  if(!STATES.includes(state))fail(400,'state','حالة المفتاح إما مفعَّلة (available) أو موقوفة (hidden)');
  const key=v.text(input.target_key,'رمز الخدمة أو مفتاح الميزة',60,2);
  // لا يُخفى ما لا وجود له: مفتاح مكتوب خطأ كان سيُقبل صفًّا صامتًا لا يوقف شيئًا ولا يظهر في الشاشة.
  const known=kind==='service'
    ?db.prepare('SELECT 1 FROM services WHERE tenant_id=? AND code=? AND active=1').get(u.tenant_id,key)
    :db.prepare('SELECT 1 FROM benefit_catalog WHERE tenant_id=? AND benefit_key=?').get(u.tenant_id,key);
  if(!known)refuse(404,'not_found',{what:`لا ${kind==='service'?'خدمة في الدليل برمز':'ميزة بمفتاح'} «${key}» في هذا الكيان`,
    missing:[{document:`${kind==='service'?'رمز خدمة':'مفتاح ميزة'} موجود فعلًا`,why:'المفتاح يُكتب كما هو في الشاشة، ولا يُخفى ما لا وجود له',
      owner:ownerText(db,u.tenant_id),owner_role:CAPABILITY}],
    next:'افتح «تفعيل الخدمات وإخفاؤها» في شاشة «إعداد الاعتماد» واختر الصف من القائمة'});
  const reason=v.text(input.reason,'سبب القرار',400,4);
  const previous=lastDecision(db,u.tenant_id,kind,key),before=previous?.state??'available';
  if(before===state)fail(409,'already_in_state',`${key} ${state==='hidden'?'موقوفة بالفعل':'مفعَّلة بالفعل'}؛ السجل لا يقبل صفًّا لا يغيّر شيئًا`);
  db.prepare('INSERT INTO service_availability(tenant_id,kind,target_key,state,reason,decided_by,decided_at) VALUES(?,?,?,?,?,?,?)')
    .run(u.tenant_id,kind,key,state,reason,u.id,now());
  audit(db,u,'service_availability',`${kind}:${key}`,state==='hidden'?'availability.hidden':'availability.restored',{state:before},{state,kind,target_key:key},reason);
  return {kind,target_key:key,state,state_name:STATE_NAMES[state],reason,decided_at:now()};
}

/* ───── القراءة: لوح المفاتيح ─────────────────────────────────────────────── */
const OPEN_STATUSES="('draft','pending','returned','approved','in_progress')";
// كل خدمة في الدليل بحالتها وقرارها الأخير، وكم طلبًا مفتوحًا عليها الآن. النسخة الأحدث وحدها كما يقرأها الدليل.
function serviceRows(db,tenantId){
  const open=new Map(db.prepare(`SELECT sv.code AS code,COUNT(*) AS n FROM requests r JOIN services sv ON sv.id=r.service_id
    WHERE r.tenant_id=? AND r.status IN ${OPEN_STATUSES} GROUP BY sv.code`).all(tenantId).map(r=>[r.code,r.n]));
  return db.prepare(`SELECT s.code,s.name_ar,s.department_id,d.name AS department_name,dir.section,
      json_extract(s.approval_policy,'$.confidential') AS confidential,json_extract(s.approval_policy,'$.closed_circle') AS closed_circle
    FROM services s LEFT JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
    LEFT JOIN service_directory dir ON dir.tenant_id=s.tenant_id AND dir.service_code=s.code
    WHERE s.tenant_id=? AND s.active=1 AND s.version=(SELECT MAX(n.version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)
    ORDER BY s.code`).all(tenantId)
    .map(s=>({...decorate(db,tenantId,'service',s.code),name:s.name_ar,department_id:s.department_id,department_name:s.department_name??s.department_id,
      section:s.section??'',open_requests:open.get(s.code)??0,
      // القناة السرية لا تُخفى بلا تنبيه: بلاغ المخالفات والتظلم قناةٌ واحدة، وإخفاؤها يقطعها بلا بديل.
      warning:s.confidential||s.closed_circle?'قناة سرية: إخفاؤها يقطع الطريق الوحيد لتقديم بلاغ أو تظلم في المنصة. تأكد من وجود بديل معلن قبل الإيقاف.':''}));
}
// مزايا الكيان الثلاث عشرة بمفاتيحها. الصف المعروض هو أحدث مراجعة للمفتاح مهما كانت حالتها في الكتالوج،
// فالمالك يرى الميزة ويضع عليها مفتاحه سواء اعتُمدت بعد أو ما زالت مسودة.
function benefitRows(db,tenantId,options){
  return db.prepare(`SELECT b.benefit_key,b.name,b.status,b.request_option FROM benefit_catalog b
    WHERE b.tenant_id=? AND b.revision=(SELECT MAX(n.revision) FROM benefit_catalog n WHERE n.tenant_id=b.tenant_id AND n.benefit_key=b.benefit_key)
    ORDER BY b.sort_order,b.benefit_key`).all(tenantId)
    .map(b=>({...decorate(db,tenantId,'benefit',b.benefit_key),name:b.name,catalog_status:b.status,
      request_option:b.request_option||null,option_name:options.get(b.request_option)??null,open_requests:0,warning:''}));
}
function decorate(db,tenantId,kind,key){
  const decision=lastDecision(db,tenantId,kind,key),state=decision?.state??'available';
  return {kind,key,state,state_name:STATE_NAMES[state],
    reason:decision?.reason??'',decided_at:decision?.decided_at??null,
    decided_by:decision?.decided_by??null,decided_by_name:decision?personName(db,decision.decided_by):null,
    decisions:db.prepare('SELECT COUNT(*) AS n FROM service_availability WHERE tenant_id=? AND kind=? AND target_key=?').get(tenantId,kind,key).n};
}

// ما لا يبلغه المفتاح، مُسمّى لا مسكوتًا عنه (مراجعة 22 سبتمبر 2026).
// اللوح يحمل صفوف جدول services وصفوف benefit_catalog، ويقول «N خدمة موقوفة من 142». لكن في نافذة الطلب
// الجديد وفي البحث وتحت إدارتها مدخلًا آخر لا صفّ له في services: خدمات الوحدات المخصصة في
// app/static/module-services.mjs. الوحيدة منها بلا رمز في الجدول اليوم «طلب إجازة» (HR-LEAVE)، فالمفتاح
// لا يمسّها ولا يستطيع. أن يعرض اللوح ١٤٢ ويسكت عمّا لا يبلغه وعدٌ أوسع من الشيفرة — فيُقال هنا، من الخادم
// لا من نصٍّ مكتوب في الشاشة، ومعه من يوقفها فعلًا. الحساب يجري على الجدول نفسه: ما دخل services يومًا
// سقط من هذه القائمة تلقائيًا ولا يبقى تحذيرًا كاذبًا.
export function outOfReach(db,tenantId){
  const codes=new Set(db.prepare('SELECT DISTINCT code FROM services WHERE tenant_id=?').all(tenantId).map(r=>r.code));
  return MODULE_SERVICES.filter(m=>!codes.has(m.code)).map(m=>({code:m.code,name:m.name_ar,department_id:m.department_id??null,
    why:'مدخلها شاشة وحدتها المخصصة لا صفّ في دليل الخدمات، والمفتاح يمسك الرموز المسجلة في الدليل ومفاتيح المزايا وحدها',
    owner:'من يملك سياسة الوحدة نفسها (أنواع الإجازات لدى الموارد البشرية)',
    stop_how:'توقفها بإيقاف نوعها في سياسة وحدتها، لا من هذا اللوح'}));
}

// السجل كله بترتيب اتخاذه، أحدثه أولًا: الإخفاء وإعادة التفعيل معًا بسببيهما. لا يُختصر إلى «الحالة الآن».
export function availabilityHistory(db,tenantId,limit=200){
  return db.prepare(`SELECT a.*,x.name AS decided_by_name FROM service_availability a JOIN users x ON x.id=a.decided_by
    WHERE a.tenant_id=? ORDER BY a.seq DESC LIMIT ?`).all(tenantId,limit)
    .map(r=>({seq:r.seq,kind:r.kind,kind_name:KIND_NAMES[r.kind],target_key:r.target_key,state:r.state,state_name:STATE_NAMES[r.state],
      reason:r.reason,decided_by_name:r.decided_by_name,decided_at:r.decided_at}));
}

// اللوح الذي ترسمه الشاشة. يُبنى لحامل التصريح وحده؛ غيره لا يصله شيء من هذا الباب (الشاشة تقرأ can_manage).
export function availabilityBoard(db,supplied,{options=new Map()}={}){
  const u=currentUser(db,supplied)??supplied;
  const manage=can(db,u,CAPABILITY);
  if(!manage)return {can_manage:false,capability:CAPABILITY,capability_name:capabilityName(CAPABILITY),
    owners:switchOwners(db,u.tenant_id),services:[],benefits:[],history:[],out_of_reach:[],
    totals:{services_total:0,services_hidden:0,benefits_total:0,benefits_hidden:0},
    note:`تفعيل الخدمات وإخفاؤها لمن يملك «${capabilityName(CAPABILITY)}».`};
  const services=serviceRows(db,u.tenant_id),benefits=benefitRows(db,u.tenant_id,options);
  const hiddenServices=services.filter(s=>s.state==='hidden'),hiddenBenefits=benefits.filter(b=>b.state==='hidden');
  return {can_manage:true,capability:CAPABILITY,capability_name:capabilityName(CAPABILITY),owners:switchOwners(db,u.tenant_id),
    services,benefits,history:availabilityHistory(db,u.tenant_id),
    // ما لا يبلغه المفتاح يُقال في اللوح نفسه، لا في وثيقة تسليم يقرؤها المهندس ولا يقرؤها المالك.
    out_of_reach:outOfReach(db,u.tenant_id),
    totals:{services_total:services.length,services_hidden:hiddenServices.length,
      benefits_total:benefits.length,benefits_hidden:hiddenBenefits.length},
    hidden_service_codes:hiddenServices.map(s=>s.key),hidden_benefit_keys:hiddenBenefits.map(b=>b.key),
    note:'الخدمة الموقوفة تختفي من الدليل ومن نافذة الطلب الجديد ومن بطاقات الخدمة ومن البحث ومن أزرار الرئيسية، وتُعلَّم «موقوفة» بسببها في قائمة خدمات المركز التخصصي، ويُرفض فتح طلب جديد منها برفض يسمّي من يعيد تفعيلها. ولا يتوقف منها شيء قائم: كل طلب مفتوح عليها يكمل اعتماده وتنفيذه وتقاريره وصندوق صاحبه. الإيقاف ليس حذفًا، والقرار وسببه يبقيان في السجل بعد الرجوع عنه.'};
}
