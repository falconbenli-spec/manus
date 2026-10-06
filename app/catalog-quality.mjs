import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { catalog, getRequest, serviceOf } from './workflow.mjs';
import { enrichFields, fieldModel } from './service-catalog.mjs';
// مفتاح تفعيل الخدمة (ترحيل 129): وحدة ورقية لا تستورد هذه، فلا دورة.
import { hiddenServiceCodes } from './service-availability.mjs';
// صحة شجرة مركز الخدمات (الدفعة الرابعة): ما يُحسب من الإسقاط والسجلات فعلًا، وما لا يُحسب مكتوبٌ سببه.
import { placementFor, PROPOSAL_MARK } from './catalog-tree.mjs';
import { targetsByCode } from './service-target.mjs';
import { unavailableFor, catalogFacts } from './catalog-home.mjs';
import { CATALOG_STATUS } from './benefits-portal.mjs';
import { countNoun } from './static/arabic-count.mjs';
import { missesReport, AUDIENCE_NAMES } from './catalog-admin.mjs';
import { SERVICE_VARIANTS } from './service-catalog.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';

// جودة الكتالوج: أين ينقص الإرشاد، وأي الحقول تُرجع الطلبات فعلًا. الترتيب بعدد الطلبات المقدمة،
// لأن تحسين خدمة يستعملها العشرات أولى من تجميل خدمة لم تُطلب قط.
export const REASONS={missing_field:'حقل لازم غير موجود في النموذج',unclear_field:'الحقل غامض فأُجيب خطأ',wrong_options:'خيارات الحقل لا تغطي الحالة',insufficient_answer:'الحقل موجود والإجابة ناقصة',not_needed:'حقل لا يُستعمل في القرار'};
function actor(db,u){const c=currentUser(db,u);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}

const count=(rows,key)=>Object.fromEntries(rows.map(r=>[r[key],r.n]));
function fieldGaps(fields){
  return fields.map(f=>({key:f.key,label:f.label,why:!!f.why,hint:!!f.hint,example:!!f.example,conditional:!!f.show_when}));
}

// الطلبات التي أعادها هذا المستخدم في نسختها الحالية: هو وحده من يعرف أي حقل كان السبب.
function myReturns(db,u){
  return db.prepare(`SELECT r.id,r.title,r.revision,r.status,s.code,s.name_ar,s.fields,a.note,a.decided_at FROM approval_steps a
      JOIN requests r ON r.id=a.request_id AND r.revision=a.revision JOIN services s ON s.id=r.service_id
      WHERE r.tenant_id=? AND a.status='returned' AND a.decided_by=? AND r.requester_id<>? ORDER BY a.decided_at DESC LIMIT 50`)
    .all(u.tenant_id,u.id,u.id).map(row=>{
      const recorded=db.prepare('SELECT field_key,reason FROM service_field_feedback WHERE request_id=? AND revision=?').all(row.id,row.revision);
      return {id:row.id,title:row.title,revision:row.revision,status:row.status,service_code:row.code,service_name:row.name_ar,return_note:row.note,returned_at:row.decided_at,
        fields:JSON.parse(row.fields).map(f=>({key:f.key,label:f.label})),recorded,actions:['report_field_gap']};
    });
}

// ── لوح صحة الشجرة: مقاييس محسوبة وحدها ─────────────────────────────────────
// كل رقم هنا من جملةٍ على جدول قائم (الإسقاط، بطاقات التعريف، تبنّي الأزمنة، المرادفات، سجل البحث، الرحلات).
// وما لا يُحسب بصدق (نسبة الالتزام، زمن العثور، الإغناء، الأكثر طلبًا) صفٌّ «غير متاح» بنصّ UNAVAILABLE نفسه، لا فراغ ولا صفر.
// وقمع البحث **أعدادٌ لا أزمنة**: searched/opened/submitted في ثلاثين يومًا، وحصة الفتح من المرتبة الأولى عدٌّ بديل لا نسبة نجاح.
const FUNNEL_DAYS=30;
function treeHealth(db,u){
  const tenantId=u.tenant_id;
  const audiences=[['employee',['employee']],['manager',['employee','manager']]].map(([key,list])=>{
    const view=placementFor(db,tenantId,list,'all');
    return {key,name:AUDIENCE_NAMES[key],totals:view.totals,items_unplaced:view.items_unplaced,release_version:view.release_version,
      categories:view.categories.map(c=>({key:c.key,name:c.name_ar,cards:c.cards,items:c.items,flag:c.cards<3?'under_3':c.cards>12?'over_12':null}))};
  });
  const outOfRange=audiences.flatMap(a=>a.categories.filter(c=>c.flag).map(c=>({audience:a.name,key:c.key,name:c.name,cards:c.cards,flag:c.flag})));
  const codes=db.prepare('SELECT DISTINCT code FROM services WHERE tenant_id=? AND active=1').all(tenantId).map(r=>r.code);
  const published=db.prepare("SELECT COUNT(DISTINCT service_code) AS n FROM service_cards WHERE tenant_id=? AND status='published'").get(tenantId).n;
  // الزمن المتبنّى وحده يُعدّ متبنًّى؛ ما بلا صفّ في service_directory سنده مشتقٌّ كما تحسبه بطاقة الدليل.
  const targets=targetsByCode(db,tenantId);
  const adopted=codes.filter(code=>targets.get(code)?.kind==='adopted').length;
  const derived=codes.filter(code=>{const t=targets.get(code);return !t||t.kind==='derived';}).length;
  // المرادفات: البنود المسنَدة كلها، والمقترَح غير المؤكَّد لا يُعدّ (لا يقرؤه البحث).
  const counts=new Map(db.prepare('SELECT item_kind||\':\'||item_key AS id,COUNT(*) AS n FROM service_synonyms WHERE tenant_id=? AND note NOT LIKE ? GROUP BY id').all(tenantId,PROPOSAL_MARK+'|%').map(r=>[r.id,r.n]));
  const nameOf=(kind,key)=>kind==='group'?SERVICE_VARIANTS.find(g=>g.code===key)?.name_ar??key:kind==='module'?MODULE_SERVICES.find(m=>m.code===key)?.name_ar??key
    :db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get(tenantId,key)?.name_ar??key;
  const placed=db.prepare('SELECT DISTINCT item_kind,item_key FROM catalog_placement WHERE tenant_id=? ORDER BY item_key').all(tenantId);
  const thin=placed.map(p=>({kind:p.item_kind,key:p.item_key,name:nameOf(p.item_kind,p.item_key),synonyms:counts.get(`${p.item_kind}:${p.item_key}`)??0})).filter(x=>x.synonyms<3);
  const since=new Date(Date.now()-FUNNEL_DAYS*86400000).toISOString();
  const event=name=>db.prepare('SELECT COUNT(*) AS n FROM catalog_search_log WHERE tenant_id=? AND event=? AND at>=?').get(tenantId,name,since).n;
  const funnel={days:FUNNEL_DAYS,searched:event('searched'),opened:event('opened'),submitted:event('submitted'),
    opened_first:db.prepare("SELECT COUNT(*) AS n FROM catalog_search_log WHERE tenant_id=? AND event='opened' AND position=1 AND at>=?").get(tenantId,since).n,
    // «بحوثٌ انتهت بلا تقديم» باسمها الصحيح: جلسات بحث لم يتبعها تقديم. ليست إغناءً ولا تُسمّى كذلك.
    sessions:db.prepare("SELECT COUNT(DISTINCT search_id) AS n FROM catalog_search_log WHERE tenant_id=? AND event='searched' AND at>=?").get(tenantId,since).n,
    sessions_without_submit:db.prepare(`SELECT COUNT(DISTINCT s.search_id) AS n FROM catalog_search_log s WHERE s.tenant_id=? AND s.event='searched' AND s.at>=?
      AND NOT EXISTS(SELECT 1 FROM catalog_search_log x WHERE x.search_id=s.search_id AND x.event='submitted')`).get(tenantId,since).n,
    note:'أعدادٌ لا أزمنة ولا هويات: المنصة لا تسجّل توقيتًا في المتصفح. وحصة الفتح من المرتبة الأولى عدٌّ بديل عن قياسٍ لم يُبنَ.'};
  const misses=missesReport(db,tenantId);
  const runs=db.prepare('SELECT status,COUNT(*) AS n FROM journey_runs WHERE tenant_id=? GROUP BY status').all(tenantId);
  const journeys={open:runs.find(r=>r.status==='open')?.n??0,completed:runs.find(r=>r.status==='completed')?.n??0,
    blocked_steps:db.prepare("SELECT COUNT(*) AS n FROM journey_run_steps WHERE tenant_id=? AND outcome='blocked'").get(tenantId).n,
    waiting_children:db.prepare("SELECT COUNT(*) AS n FROM journey_run_steps s JOIN requests q ON q.id=s.child_request_id WHERE s.tenant_id=? AND q.status IN ('draft','returned')").get(tenantId).n};
  // سابقة الأهلية تُذكر بعددها الصحيح (C7): مفاتيح الميزات في صفوفها، بحالتها.
  // وحين تختلط الحالات (القاعدة الحيّة: 13 مفتاحًا في 26 صفًّا) تُسمّى كلُّ حالة بكلمتها من قاموس المزايا لا بمفتاحها الإنجليزي،
  // وعدد صفوفها بتمييزه (مراجعة 23 سبتمبر: «13 draft، 1 rejected» كانت تُطبع داخل الجملة العربية).
  const benefitRows=db.prepare('SELECT status,COUNT(*) AS n,COUNT(DISTINCT benefit_key) AS keys FROM benefit_catalog WHERE tenant_id=? GROUP BY status ORDER BY n DESC,status').all(tenantId);
  const benefits={keys:db.prepare('SELECT COUNT(DISTINCT benefit_key) AS n FROM benefit_catalog WHERE tenant_id=?').get(tenantId).n,rows:benefitRows.reduce((a,r)=>a+r.n,0),
    all_draft:benefitRows.length===1&&benefitRows[0].status==='draft',
    by_status:benefitRows.map(r=>({status:r.status,status_name:CATALOG_STATUS[r.status]??r.status,rows:r.n}))};
  const ROW_NOUN=['صفٌّ واحد','صفّان','صفوف','صفًّا'];
  benefits.sentence=`${benefits.keys} مفتاح ميزة في ${benefits.rows} صفًّا، ${benefits.all_draft?'كلها مسودات':benefits.by_status.map(r=>`${countNoun(r.rows,ROW_NOUN)} بحالة «${r.status_name}»`).join('، ')}`;
  const facts=catalogFacts(db,tenantId);
  return {audiences,items_unplaced:{value:Math.max(...audiences.map(a=>a.items_unplaced)),target:0},out_of_range:outOfRange,
    hidden:hiddenServiceCodes(db,tenantId).size,
    cards_published:{value:published,of:codes.length},targets_adopted:{value:adopted,of:codes.length,derived},
    synonyms:{thin_count:thin.length,thin,items:placed.length},
    funnel,misses:misses.misses,misses_min_count:misses.min_count,misses_window_days:misses.window_days,journeys,benefits,
    // نصوص الغياب بأرقامها المقيسة لحظتها (facts)، بالجملة نفسها التي تحسب بلاطات هذا اللوح.
    unavailable:unavailableFor(db,tenantId,['compliance','finding_time','deflection','usage'],facts),facts,
    note:'مقاييس الشجرة كلها من جملٍ على جداول قائمة؛ وما لا يُحسب بصدق صفٌّ «غير متاح» بسببه وبما يلزمه.'};
}

export function catalogQualityBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'catalog.manage');
  const returns=myReturns(db,u);
  const base={can_manage:manage,reasons:REASONS,my_returns:returns,
    note:'التقرير يقرأ الكتالوج كما هو معرّف في المنصة وعدد الطلبات المقدمة فعلًا. الإرشاد (لماذا يُسأل الحقل، ومثاله، وتلميحه) اقتراح من إعداد الكتالوج لم يعتمده مالكو الإجراءات بعد. أسباب الارتداد يسجلها من أعاد الطلب يدويًا؛ المنصة لا تستنتجها.'};
  if(!manage)return {...base,services:[],fields:[],totals:null};
  const submitted=count(db.prepare(`SELECT s.code,COUNT(*) AS n FROM requests r JOIN services s ON s.id=r.service_id WHERE r.tenant_id=? AND r.revision>0 GROUP BY s.code`).all(u.tenant_id),'code');
  const returned=count(db.prepare(`SELECT s.code,COUNT(DISTINCT r.id) AS n FROM approval_steps a JOIN requests r ON r.id=a.request_id JOIN services s ON s.id=r.service_id
      WHERE r.tenant_id=? AND a.status='returned' GROUP BY s.code`).all(u.tenant_id),'code');
  const feedback=db.prepare(`SELECT service_code,field_key,reason,COUNT(*) AS n FROM service_field_feedback WHERE tenant_id=? GROUP BY service_code,field_key,reason`).all(u.tenant_id);
  const cards=new Set(db.prepare("SELECT service_code FROM service_cards WHERE tenant_id=? AND status='published'").all(u.tenant_id).map(r=>r.service_code));
  // الموقوفة بمفتاح الإعدادات (ترحيل 129) تبقى في التقرير معلَّمة، كما بقيت في فحص الدليل (catalogHealth)
  // وللسبب نفسه (مراجعة 22 سبتمبر): لها طلبات مفتوحة تمشي بمعتمديها ومنفذيها، وهذا التقرير يرتّب بعدد
  // «الطلبات المقدمة فعلًا» — فإسقاطها كان يطرح تاريخها كله من الأرقام: «142 خدمة، طلب واحد» تصير
  // «141 خدمة، صفر طلب» والطلب مفتوح يتحرك. الرقم يُقال ولا يُطرح، ويُقال معه كم منها موقوفة.
  const hidden=hiddenServiceCodes(db,u.tenant_id);
  const services=catalog(db,u,{includeHidden:true}).map(s=>{
    const fields=fieldGaps(enrichFields(s.code,s.fields)),gaps=[];
    if(!fieldModel(s.code))gaps.push('خارج الكتالوج المعرّف: لا إرشاد لحقوله');
    if(fields.some(f=>!f.why))gaps.push(`حقول بلا سبب مكتوب: ${fields.filter(f=>!f.why).length}`);
    if(!fields.some(f=>f.hint))gaps.push('لا إرشاد تحت أي حقل');
    if(!fields.some(f=>f.example))gaps.push('لا مثال في أي حقل');
    if(!s.target_days)gaps.push('بلا زمن مستهدف');
    if(!cards.has(s.code))gaps.push('بلا بطاقة خدمة منشورة');
    const mine=feedback.filter(f=>f.service_code===s.code);
    return {code:s.code,name:s.name_ar,department_id:s.department_id,section:s.section??'',version:s.version,
      requests:submitted[s.code]??0,returned:returned[s.code]??0,field_feedback:mine.reduce((a,f)=>a+f.n,0),
      target_days:s.target_days??null,card_published:cards.has(s.code),hidden:hidden.has(s.code),fields,gaps};
  }).sort((a,b)=>b.requests-a.requests||b.field_feedback-a.field_feedback||b.gaps.length-a.gaps.length||a.code.localeCompare(b.code));
  // الحقول الأكثر تسببًا في الارتداد، عبر كل الخدمات. الموقوفة هنا كذلك: حقلٌ أرجع طلبًا قبل الإيقاف
  // يبقى حقلًا أرجع طلبًا، واسمه يُقرأ من نسخة خدمته لا من الفراغ.
  const labels=Object.fromEntries(catalog(db,u,{includeHidden:true}).flatMap(s=>s.fields.map(f=>[`${s.code}:${f.key}`,f.label])));
  const byField={};
  for(const f of feedback){const k=`${f.service_code}:${f.field_key}`;(byField[k]??={service_code:f.service_code,field_key:f.field_key,label:f.field_key?labels[k]??f.field_key:'حقل غير موجود في النموذج',total:0,reasons:{}});byField[k].total+=f.n;byField[k].reasons[f.reason]=f.n;}
  const fields=Object.values(byField).sort((a,b)=>b.total-a.total||a.service_code.localeCompare(b.service_code)).slice(0,30);
  // «موقوفة» عددٌ يُقال بجوار «الخدمات» لا نقصانٌ في «الخدمات»: الرقمان جملتان مختلفتان.
  return {...base,services,fields,totals:{services:services.length,hidden:services.filter(s=>s.hidden).length,
    with_gaps:services.filter(s=>s.gaps.length).length,
    without_card:services.filter(s=>!s.card_published).length,without_target:services.filter(s=>!s.target_days).length,
    requests:services.reduce((a,s)=>a+s.requests,0),returned:services.reduce((a,s)=>a+s.returned,0),field_feedback:feedback.reduce((a,f)=>a+f.n,0)},
    tree:treeHealth(db,u)};
}

// يسجل من أعاد الطلب أي حقل كان السبب. الشرط مفروض هنا وفي قادح قاعدة البيانات معًا.
export function reportFieldGap(db,supplied,requestId,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تسجيل سبب الارتداد داخل معاملة');
  const u=actor(db,supplied);
  const r=getRequest(db,u,requestId);
  if(r.requester_id===u.id)fail(403,'separation_of_duties','صاحب الطلب لا يسجل سبب ارتداد طلبه');
  const step=db.prepare("SELECT 1 FROM approval_steps WHERE request_id=? AND revision=? AND status='returned' AND decided_by=?").get(r.id,r.revision,u.id);
  if(!step)fail(403,'not_returner','يسجل السبب من أعاد هذه النسخة من الطلب فقط');
  v.object(input,['field_key','reason','note']);
  if(!Object.hasOwn(REASONS,input.reason))fail(400,'reason','اختر سبب الارتداد من القائمة');
  const service=serviceOf(db,r),key=input.reason==='missing_field'?'':String(input.field_key??'');
  if(input.reason==='missing_field'&&input.field_key)fail(400,'field_key','الحقل غير الموجود لا يُختار من القائمة؛ صفه في الملاحظة');
  if(input.reason!=='missing_field'&&!service.fields.some(f=>f.key===key))fail(400,'field_key','اختر الحقل من حقول هذه الخدمة');
  const note=v.text(input.note,'ما الذي كان ناقصًا أو غامضًا',1000,5);
  if(db.prepare('SELECT 1 FROM service_field_feedback WHERE request_id=? AND revision=? AND field_key=? AND reason=?').get(r.id,r.revision,key,input.reason))
    fail(409,'already_recorded','سُجل هذا السبب لهذا الحقل في هذه النسخة من قبل');
  const row={id:randomUUID(),service_code:service.code,service_version:service.version,field_key:key,reason:input.reason,note};
  db.prepare('INSERT INTO service_field_feedback(id,tenant_id,request_id,revision,service_code,service_version,field_key,reason,note,reported_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.id,u.tenant_id,r.id,r.revision,row.service_code,row.service_version,key,row.reason,note,u.id,now());
  audit(db,u,'request',r.id,'service.field_feedback_recorded',{},{service_code:row.service_code,field_key:key,reason:row.reason,revision:r.revision},note);
  return catalogQualityBoard(db,u);
}
