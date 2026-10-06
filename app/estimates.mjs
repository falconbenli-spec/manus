import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { id, today, nameOf, writing, seller, sellerClient, money, decimal, code } from './pipeline-shared.mjs';
// الملف المقفل لا ينفتح له تقدير ولا بطاقة أسعار (P4-CRM-7، الترحيل 186).
import { assertClientOpen } from './client-offboarding.mjs';

// بطاقات الأسعار ومصفوفة التقدير (دور × مخرج) وأوامر التغيير.
//
// مربط الفرس: من يسعّر يرى أثر كل سطر على الهامش قبل أن يرسل العرض. ولذلك قاعدتان لا تُكسران:
//   (1) لا سعر افتراضي: سعر البيع من بطاقة أسعار معتمدة سارية أو يُكتب يدويًا في السطر ويُوسم «يدوي».
//   (2) لا تكلفة صفرية: معدل التكلفة يأتي من **خارج** هذه الوحدة عبر المعامل الاختياري costRate (يصله المنسّق بمعدلات
//       الفئة الوظيفية في وحدة الربحية). إن غاب أو لم يجد معدلًا بقي السطر «غير مُكلَّف» (NULL)، ولا يُعرض هامش له ولا للإجمالي.
//
// عقد costRate: ({tenant_id,category_code,role_name,date}) => {rate_minor:int>0, source:string} | null
// يُستدعى عند حفظ المسودة فقط، ويُخزَّن ما أعاده مع مصدره: التقدير المرسل للاعتماد لا تتغير أرقامه بتغير المعدلات بعده.
//
// المشروع وميزانيته لا يُنشآن هنا: التقدير المعتمد يُحمَل إلى المسار التجاري القائم (commercialPayload أدناه)، وذاك المسار
// هو من يعتمد الهامش ويسجل العقد وينشئ المشروع وخط أساسه.

export const ESTIMATE_STATUS={draft:'مسودة',submitted:'بانتظار الاعتماد',approved:'معتمد',rejected:'مرفوض'};
export const CARD_STATUS={draft:'بانتظار الاعتماد',approved:'معتمدة',rejected:'مرفوضة'};
const NO_COST='الهامش غير محسوب لأن التكلفة غير متاحة';

function hours(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,4})(\.\d{1,2})?$/.test(value))fail(400,'invalid_hours',`${label}: ساعات بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),centi=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(centi<1)fail(400,'invalid_hours',`${label}: الجهد أكبر من صفر`);
  return centi;
}
const amount=(centi,rate)=>Math.round(centi*rate/100);
const marginBp=(sell,cost)=>cost===null||!sell?null:Math.round((sell-cost)*10000/sell);

/* ───── حساب المصفوفة (دالة نقية) ───── */
// المجموع الذي فيه سطر واحد غير مُكلَّف لا تكلفة له ولا هامش: هامش جزئي يُقرأ كأنه هامش العرض كله.
function subtotal(lines){
  const sell=lines.reduce((n,l)=>n+l.sell_minor,0),uncosted=lines.filter(l=>l.cost_minor===null).length,cost=uncosted?null:lines.reduce((n,l)=>n+l.cost_minor,0);
  return {hours_centi:lines.reduce((n,l)=>n+l.hours_centi,0),sell_minor:sell,cost_minor:cost,margin_minor:cost===null?null:sell-cost,margin_bp:marginBp(sell,cost),uncosted_lines:uncosted};
}
export function computeMatrix(rows){
  const lines=rows.map(l=>{const sell=amount(l.hours_centi,l.sell_rate_minor),cost=l.cost_rate_minor===null||l.cost_rate_minor===undefined?null:amount(l.hours_centi,l.cost_rate_minor);
    return {...l,sell_minor:sell,cost_minor:cost,margin_minor:cost===null?null:sell-cost,margin_bp:marginBp(sell,cost)};});
  const group=key=>[...new Set(lines.map(l=>l[key]))].map(name=>({name,...subtotal(lines.filter(l=>l[key]===name))}));
  const total=subtotal(lines);
  return {lines,roles:group('role_name'),deliverables:group('deliverable'),total,margin_available:total.uncosted_lines===0&&lines.length>0,
    margin_notice:total.uncosted_lines?`${NO_COST}: ${total.uncosted_lines} من ${lines.length} سطرًا بلا معدل تكلفة معتمد. لا يُحسب الناقص صفرًا.`:''};
}
// أمر التغيير مصفوفة كاملة منقحة؛ ما تغيّر وبكم يُشتق بمقارنتها بالتقدير المعتمد الذي بُنيت عليه.
export function diffMatrix(parent,current){
  const key=l=>`${l.role_name}\u0000${l.deliverable}`,before=new Map(parent.lines.map(l=>[key(l),l])),after=new Map(current.lines.map(l=>[key(l),l])),changes=[];
  const delta=(a,b)=>a===null||b===null?null:b-a;
  for(const [k,l] of after){const old=before.get(k);
    if(!old)changes.push({type:'added',role_name:l.role_name,deliverable:l.deliverable,hours_delta_centi:l.hours_centi,sell_delta_minor:l.sell_minor,cost_delta_minor:l.cost_minor});
    else if(old.hours_centi!==l.hours_centi||old.sell_rate_minor!==l.sell_rate_minor||old.cost_rate_minor!==l.cost_rate_minor)changes.push({type:'changed',role_name:l.role_name,deliverable:l.deliverable,hours_delta_centi:l.hours_centi-old.hours_centi,sell_delta_minor:l.sell_minor-old.sell_minor,cost_delta_minor:delta(old.cost_minor,l.cost_minor)});}
  for(const [k,l] of before)if(!after.has(k))changes.push({type:'removed',role_name:l.role_name,deliverable:l.deliverable,hours_delta_centi:-l.hours_centi,sell_delta_minor:-l.sell_minor,cost_delta_minor:l.cost_minor===null?null:-l.cost_minor});
  const cost=delta(parent.total.cost_minor,current.total.cost_minor),sell=current.total.sell_minor-parent.total.sell_minor;
  return {changes,hours_delta_centi:current.total.hours_centi-parent.total.hours_centi,sell_delta_minor:sell,cost_delta_minor:cost,margin_delta_minor:cost===null?null:sell-cost,
    margin_bp_before:parent.total.margin_bp,margin_bp_after:current.total.margin_bp,margin_notice:cost===null?NO_COST+' في أحد التقديرين، فلا يُحسب أثر التغيير على الهامش.':''};
}

/* ───── بطاقات الأسعار ───── */
const cardLines=r=>JSON.parse(r.lines);
function liveCard(db,tenantId,clientId,date){
  const pick=client=>db.prepare("SELECT * FROM price_cards WHERE tenant_id=? AND coalesce(client_id,'')=? AND status='approved' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").get(tenantId,client??'',date);
  // بطاقة العميل إن وُجدت تحل محل القائمة العامة كاملة، لا تُدمج معها: سعر لم يُتفق عليه مع العميل لا يتسرب إلى عرضه.
  return pick(clientId)??pick(null)??null;
}
function cardView(db,u,r,clientNames){
  const actions=[];
  if(r.status==='draft'&&r.prepared_by!==u.id)actions.push('approve_card','reject_card');
  return {...r,lines:cardLines(r).map(l=>({...l,unit_price:decimal(l.unit_price_minor)})),status_name:CARD_STATUS[r.status],client_name:r.client_id?clientNames.get(r.client_id)??null:null,scope_name:r.client_id?'بطاقة عميل':'القائمة العامة',
    prepared_by_name:nameOf(db,r.prepared_by),decided_by_name:nameOf(db,r.decided_by),actions};
}
export function preparePriceCard(db,supplied,input){
  writing(db);v.object(input,['client_id','name','effective_from','source','lines']);
  const {u}=input.client_id?sellerClient(db,supplied,input.client_id):seller(db,supplied),clientId=input.client_id||null,from=v.date(input.effective_from);
  assertClientOpen(db,u.tenant_id,clientId,'ما تنفتح بطاقة أسعار');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>80)fail(400,'lines','من بند سعر واحد إلى ثمانين. البطاقة تبدأ فارغة ويملؤها صاحب الإجراء');
  const seen=new Set(),lines=input.lines.map(l=>{v.object(l,['kind','name','category_code','price']);
    if(!['role','deliverable'].includes(l.kind))fail(400,'kind','البند سعر ساعة لدور، أو سعر وحدة لمخرج');
    const label=v.text(l.name,l.kind==='role'?'اسم الدور':'اسم المخرج',160,2);if(seen.has(`${l.kind}|${label}`))fail(400,'lines','البند مكرر في البطاقة');seen.add(`${l.kind}|${label}`);
    return {kind:l.kind,name:label,category_code:l.kind==='role'&&l.category_code?code(l.category_code,'رمز الفئة الوظيفية'):'',unit_price_minor:money(l.price,`سعر «${label}»`,{max:100000000})};});
  if(db.prepare("SELECT 1 FROM price_cards WHERE tenant_id=? AND coalesce(client_id,'')=? AND effective_from=? AND status<>'rejected'").get(u.tenant_id,clientId??'',from))fail(409,'duplicate_card','توجد بطاقة لهذا النطاق بتاريخ السريان نفسه. السعر الجديد بطاقة بتاريخ سريان جديد');
  const cardId=id(),time=now();
  db.prepare("INSERT INTO price_cards(id,tenant_id,client_id,name,effective_from,lines,source,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)").run(cardId,u.tenant_id,clientId,v.text(input.name,'اسم البطاقة',180,3),from,JSON.stringify(lines),v.text(input.source,'سند الأسعار (قرار التسعير أو الاتفاق مع العميل)',1500,10),u.id,time,time);
  audit(db,u,'price_card',cardId,'price_card.prepared',{}, {client_id:clientId,effective_from:from,lines:lines.length});
  return {id:cardId};
}
export function priceCardAction(db,supplied,cardId,action,input){
  writing(db);v.object(input,['version','note']);
  const row=typeof cardId==='string'&&db.prepare('SELECT * FROM price_cards WHERE id=?').get(cardId);
  if(!row)fail(404,'not_found','بطاقة الأسعار غير متاحة');
  const {u}=row.client_id?sellerClient(db,supplied,row.client_id):seller(db,supplied);
  if(row.tenant_id!==u.tenant_id)fail(404,'not_found','بطاقة الأسعار غير متاحة');
  v.version(input.version,row.version);
  if(row.status==='draft'&&row.prepared_by===u.id)fail(403,'self_approval','من أعدّ بطاقة الأسعار لا يعتمدها');
  if(!['approve_card','reject_card'].includes(action)||row.status!=='draft')fail(409,'action_unavailable','البطاقة قُرر فيها. السعر الجديد بطاقة جديدة');
  const status=action==='approve_card'?'approved':'rejected',time=now(),note=v.text(input.note,'أساس القرار',1500,status==='approved'?3:10);
  db.prepare('UPDATE price_cards SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,row.id);
  audit(db,u,'price_card',row.id,'price_card.'+status,{status:'draft',version:row.version},{status,version:row.version+1},note);
  return {id:row.id,status};
}

/* ───── التقديرات ───── */
function resolveCost(costRate,context){
  if(typeof costRate!=='function'||!context.category_code)return null;
  const found=costRate(context);
  if(found===null||found===undefined)return null;
  // مصدر يعيد صفرًا أو رقمًا بلا سند خطأ توصيل، لا «تكلفة صفرية»: يُرفض الحفظ بدل أن يُخزَّن هامش كاذب.
  if(!Number.isInteger(found.rate_minor)||found.rate_minor<1||found.rate_minor>100000000||typeof found.source!=='string'||found.source.trim().length<3)fail(500,'cost_rate_resolver','مصدر معدلات التكلفة أعاد قيمة غير صالحة');
  return {rate_minor:found.rate_minor,source:found.source.trim().slice(0,500)};
}
function cleanLines(input,card,context,costRate){
  if(!Array.isArray(input)||!input.length||input.length>120)fail(400,'lines','المصفوفة من سطر واحد إلى مئة وعشرين');
  const roles=new Map((card?cardLines(card):[]).filter(l=>l.kind==='role').map(l=>[l.name,l])),seen=new Set();
  return input.map((l,index)=>{v.object(l,['role_name','category_code','deliverable','hours','sell_rate']);
    const role=v.text(l.role_name,'الدور',160,2),deliverable=v.text(l.deliverable,'المخرج',160,2);
    if(seen.has(`${role}|${deliverable}`))fail(400,'lines',`الخلية مكررة: ${role} × ${deliverable}`);seen.add(`${role}|${deliverable}`);
    const listed=roles.get(role)??null,typed=l.sell_rate!==undefined&&l.sell_rate!==null&&l.sell_rate!=='';
    if(!typed&&!listed)fail(409,'no_price',`لا سعر للدور «${role}»: ليس في بطاقة أسعار معتمدة سارية ولم يُكتب سعر في السطر. لا سعر افتراضي`);
    const sell=typed?money(l.sell_rate,`سعر بيع ساعة «${role}»`,{max:100000000}):listed.unit_price_minor;
    const category=l.category_code?code(l.category_code,'رمز الفئة الوظيفية'):listed?.category_code??'',cost=resolveCost(costRate,{...context,category_code:category,role_name:role});
    return {line_no:index+1,role_name:role,category_code:category,deliverable,hours_centi:hours(l.hours,`ساعات ${role} × ${deliverable}`),sell_rate_minor:sell,sell_rate_origin:listed&&sell===listed.unit_price_minor?'price_card':'manual',cost_rate_minor:cost?.rate_minor??null,cost_rate_source:cost?.source??''};});
}
function writeLines(db,estimateId,lines,time){
  db.prepare('DELETE FROM estimate_lines WHERE estimate_id=?').run(estimateId);
  const insert=db.prepare('INSERT INTO estimate_lines(id,estimate_id,line_no,role_name,category_code,deliverable,hours_centi,sell_rate_minor,sell_rate_origin,cost_rate_minor,cost_rate_source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const l of lines)insert.run(id(),estimateId,l.line_no,l.role_name,l.category_code,l.deliverable,l.hours_centi,l.sell_rate_minor,l.sell_rate_origin,l.cost_rate_minor,l.cost_rate_source,time);
}
const linesOf=(db,estimateId)=>db.prepare('SELECT * FROM estimate_lines WHERE estimate_id=? ORDER BY line_no').all(estimateId);
function estimateRow(db,supplied,estimateId){
  const row=typeof estimateId==='string'&&db.prepare('SELECT * FROM estimates WHERE id=?').get(estimateId);
  if(!row)fail(404,'not_found','التقدير غير متاح');
  const {u,c}=sellerClient(db,supplied,row.client_id);
  if(row.tenant_id!==u.tenant_id)fail(404,'not_found','التقدير غير متاح');
  return {u,c,row};
}
function estimateView(db,u,r,clientName){
  const matrix=computeMatrix(linesOf(db,r.id)),mine=r.prepared_by===u.id,actions=[];
  if(r.status==='draft'&&mine)actions.push('edit_estimate','submit_estimate');
  if(r.status==='submitted')actions.push(...(mine?['withdraw_estimate']:['approve_estimate','reject_estimate']));
  const handoff=db.prepare('SELECT h.*,k.name AS case_name,k.status AS case_status,k.project_id FROM estimate_handoffs h JOIN commercial_cases k ON k.id=h.case_id WHERE h.estimate_id=?').get(r.id)??null;
  if(r.status==='approved')actions.push('create_change_order',...(handoff?[]:['handoff_estimate']));
  const card=r.price_card_id?db.prepare('SELECT * FROM price_cards WHERE id=?').get(r.price_card_id):null;
  const parent=r.parent_estimate_id?db.prepare('SELECT id,code,name FROM estimates WHERE id=?').get(r.parent_estimate_id):null;
  return {...r,client_name:clientName,status_name:ESTIMATE_STATUS[r.status],kind_name:r.kind==='change_order'?'أمر تغيير':'تقدير',prepared_by_name:nameOf(db,r.prepared_by),decided_by_name:nameOf(db,r.decided_by),is_mine:mine,
    ...matrix,price_card_name:card?`${card.name} · سريان ${card.effective_from}`:null,
    // سعر المخرج في البطاقة مرجع للمقارنة: المصفوفة تُسعَّر بالساعات، والفرق بين مجموعها وسعر المخرج المعلن يراه المسعّر قبل الإرسال.
    deliverable_reference:card?cardLines(card).filter(l=>l.kind==='deliverable').map(l=>({name:l.name,card_price_minor:l.unit_price_minor,matrix_sell_minor:matrix.deliverables.find(d=>d.name===l.name)?.sell_minor??null})).filter(l=>l.matrix_sell_minor!==null):[],
    parent,change:parent?diffMatrix(computeMatrix(linesOf(db,parent.id)),matrix):null,handoff,actions};
}
const FIELDS=['client_id','opportunity_id','parent_estimate_id','change_reason','scope_event_id','name','scope_note','lines'];
export function saveEstimate(db,supplied,input,{costRate}={}){
  writing(db);v.object(input,FIELDS);
  const {u,c}=sellerClient(db,supplied,input.client_id),date=today(),time=now(),change=!!input.parent_estimate_id;
  assertClientOpen(db,u.tenant_id,c.id,'ما ينفتح تقدير');
  if(input.opportunity_id&&!db.prepare("SELECT 1 FROM opportunities WHERE id=? AND client_id=? AND tenant_id=? AND status='open'").get(input.opportunity_id,c.id,u.tenant_id))fail(400,'opportunity_id','الفرصة ليست فرصة مفتوحة لهذا العميل');
  if(change&&!db.prepare("SELECT 1 FROM estimates WHERE id=? AND client_id=? AND tenant_id=? AND status='approved'").get(input.parent_estimate_id,c.id,u.tenant_id))fail(409,'parent_not_approved','أمر التغيير يُبنى على تقدير معتمد للعميل نفسه');
  if(!change&&(input.change_reason||input.scope_event_id))fail(400,'change_reason','سبب التغيير وتنبيه النطاق لأوامر التغيير فقط');
  if(input.scope_event_id){
    // تنبيه حارس النطاق يُقرأ من جدوله ولا يُعدَّل هنا: قرار مسؤول الحساب فيه يبقى في شاشة حارس النطاق.
    const event=db.prepare('SELECT e.*,b.client_id FROM scope_events e JOIN scope_baselines b ON b.id=e.baseline_id WHERE e.id=? AND b.tenant_id=?').get(input.scope_event_id,u.tenant_id);
    if(!event||event.client_id!==c.id||!event.over_scope||!['change_request',null].includes(event.disposition))fail(400,'scope_event_id','التنبيه ليس حدثًا خارج النطاق لهذا العميل بانتظار طلب تغيير');
    if(db.prepare("SELECT 1 FROM estimates WHERE scope_event_id=? AND status<>'rejected'").get(event.id))fail(409,'change_exists','لهذا التنبيه أمر تغيير قائم');
  }
  const card=liveCard(db,u.tenant_id,c.id,date),lines=cleanLines(input.lines,card,{tenant_id:u.tenant_id,date},costRate),estimateId=id();
  const prefix=change?'CO':'EST',estimateCode=`${prefix}-${String(db.prepare('SELECT COUNT(*) AS n FROM estimates WHERE tenant_id=? AND kind=?').get(u.tenant_id,change?'change_order':'base').n+1).padStart(4,'0')}`;
  db.prepare("INSERT INTO estimates(id,tenant_id,client_id,opportunity_id,kind,parent_estimate_id,change_reason,scope_event_id,code,name,scope_note,price_card_id,rates_on,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(estimateId,u.tenant_id,c.id,input.opportunity_id||null,change?'change_order':'base',input.parent_estimate_id||null,change?v.text(input.change_reason,'ما الذي تغيّر ولماذا',2000,10):'',input.scope_event_id||null,estimateCode,v.text(input.name,'اسم التقدير',180,3),v.text(input.scope_note,'النطاق والافتراضات',4000,10),card?.id??null,date,u.id,time,time);
  writeLines(db,estimateId,lines,time);
  audit(db,u,'estimate',estimateId,change?'change_order.created':'estimate.created',{}, {code:estimateCode,client:c.code,lines:lines.length,uncosted:lines.filter(l=>l.cost_rate_minor===null).length});
  return {id:estimateId};
}
export function estimateAction(db,supplied,estimateId,action,input,{costRate}={}){
  writing(db);const {u,c,row}=estimateRow(db,supplied,estimateId),view=estimateView(db,u,row,''),time=now();
  const key={edit:'edit_estimate',submit:'submit_estimate',withdraw:'withdraw_estimate',approve:'approve_estimate',reject:'reject_estimate',handoff:'handoff_estimate'}[action];
  if(!key)fail(404,'not_found','الإجراء غير متاح');
  if(['approve','reject'].includes(action)&&row.status==='submitted'&&row.prepared_by===u.id)fail(403,'self_approval','من أعدّ التقدير لا يعتمده');
  if(!view.actions.includes(key))fail(409,'action_unavailable',['approved','rejected'].includes(row.status)?'التقدير قُرر فيه ولا يُعدَّل. التصحيح تقدير جديد أو أمر تغيير':'الإجراء غير متاح في حالة التقدير أو لحسابك');
  if(action==='handoff'){
    // لا يمس التقدير المعتمد: يسجل فقط أي ملف تجاري حُمل إليه. الملف ملك من يحمله، ومرتبط بملف العميل نفسه.
    v.object(input,['version','case_id','note']);v.version(input.version,row.version);
    const linked=typeof input.case_id==='string'&&db.prepare('SELECT k.id FROM commercial_cases k JOIN client_links l ON l.case_id=k.id WHERE k.id=? AND k.tenant_id=? AND k.owner_id=? AND l.client_id=?').get(input.case_id,u.tenant_id,u.id,c.id);
    if(!linked)fail(404,'not_found','الملف التجاري ليس ملفًا لك مرتبطًا بهذا العميل');
    db.prepare('INSERT INTO estimate_handoffs VALUES(?,?,?,?,?)').run(row.id,linked.id,input.note?v.text(input.note,'ملاحظة',1000):'',u.id,time);
    audit(db,u,'estimate',row.id,'estimate.handoff',{}, {case_id:linked.id});
    return {id:row.id};
  }
  v.version(input?.version,row.version);
  const bump=(fields,values)=>db.prepare(`UPDATE estimates SET ${fields},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values,time,row.id,row.version);
  let after={};
  if(action==='edit'){
    v.object(input,['version','name','scope_note','change_reason','lines']);
    const date=today(),card=liveCard(db,u.tenant_id,c.id,date),lines=cleanLines(input.lines,card,{tenant_id:u.tenant_id,date},costRate);
    bump('name=?,scope_note=?,change_reason=?,price_card_id=?,rates_on=?',[v.text(input.name,'اسم التقدير',180,3),v.text(input.scope_note,'النطاق والافتراضات',4000,10),row.kind==='change_order'?v.text(input.change_reason,'ما الذي تغيّر ولماذا',2000,10):'',card?.id??null,date]);
    writeLines(db,row.id,lines,time);after={lines:lines.length,uncosted:lines.filter(l=>l.cost_rate_minor===null).length};
  }else if(action==='submit'||action==='withdraw'){v.object(input,['version']);bump('status=?,submitted_at=?',action==='submit'?['submitted',time]:['draft',null]);after={status:action==='submit'?'submitted':'draft'};}
  else{
    v.object(input,['version','note','accept_unknown_margin']);
    // اعتماد تقدير بلا هامش محسوب قرار يُتخذ بعين مفتوحة ويُسجَّل، لا نتيجة سهو.
    if(action==='approve'&&!view.margin_available&&input.accept_unknown_margin!==true)fail(409,'margin_unknown',`${NO_COST}. الاعتماد يتطلب إقرارًا صريحًا بذلك`);
    const status=action==='approve'?'approved':'rejected',note=v.text(input.note,'أساس القرار',2000,status==='approved'?3:10);
    bump('status=?,decided_by=?,decided_at=?,decision_note=?',[status,u.id,time,note]);
    after={status,margin_available:view.margin_available,sell_minor:view.total.sell_minor,margin_minor:view.total.margin_minor};
  }
  audit(db,u,'estimate',row.id,'estimate.'+action,{status:row.status,version:row.version},{...after,version:row.version+1},typeof input.note==='string'?input.note.trim():'');
  return {id:row.id};
}

/* ───── نقطة الوصل بالمسار التجاري القائم ───── */
// تبني حمولة الإجراء القائم في commercial.mjs ولا تستدعيه: save_quote للتقدير، وcreate_change لأمر التغيير.
// المنسّق يمررها إلى commercialAction(db,u,caseId,action,{version,...payload}) فيسري عليها اعتماد الهامش والعقد وإنشاء المشروع كما هي.
// الضريبة والصلاحية ومعيار القبول لا تُفترض هنا: يدخلها المستخدم.
export function commercialPayload(db,supplied,estimateId,input){
  const {u,row}=estimateRow(db,supplied,estimateId),view=estimateView(db,u,row,'');
  if(row.status!=='approved')fail(409,'not_approved','يُحمل إلى المسار التجاري التقدير المعتمد فقط');
  // المسار التجاري يحسب هامشه من تكلفة الوحدة؛ تمرير صفر مكان تكلفة مجهولة يصنع هامشًا كاذبًا هناك.
  if(!view.margin_available)fail(409,'cost_unavailable',`${NO_COST}، فلا يُحمل التقدير إلى عرض يُعتمد هامشه`);
  const acceptance=label=>v.text(input.acceptance,label,2000,3);
  if(row.kind==='change_order'){
    v.object(input,['case_version','extra_days','due_date','acceptance']);
    if(view.change.cost_delta_minor===null)fail(409,'cost_unavailable',view.change.margin_notice);
    if(view.change.sell_delta_minor<0||view.change.cost_delta_minor<0)fail(409,'negative_change','أمر تغيير يخفض السعر أو التكلفة لا يمر بإجراء العمل الإضافي القائم. يحتاج قرار مالك الإجراء');
    if(!Number.isInteger(input.extra_days)||input.extra_days<0||input.extra_days>3650)fail(400,'extra_days','أثر المدة عدد أيام من صفر إلى 3650');
    return {action:'create_change',estimate_id:row.id,case_version:input.case_version,case_id:view.handoff?.case_id??db.prepare('SELECT case_id FROM estimate_handoffs WHERE estimate_id=?').get(row.parent_estimate_id)?.case_id??null,
      payload:{scope:`${row.code} — ${row.change_reason}`.slice(0,3000),additional_price:decimal(view.change.sell_delta_minor),additional_cost:decimal(view.change.cost_delta_minor),extra_days:input.extra_days,due_date:v.date(input.due_date),acceptance:acceptance('معيار قبول العمل الإضافي')}};
  }
  // عرض سعر العميل (FRM-024) الذي تُحفظ عليه النسخة (الترحيل 182، القرار D2): يمرّ كما هو، والمسار التجاري يفحصه.
  v.object(input,['case_version','valid_until','tax_rate','acceptance','revisions','quotation_id']);
  if(typeof input.tax_rate!=='string'||!/^(0|[1-9]\d?)(\.\d{1,2})?$/.test(input.tax_rate))fail(400,'tax_rate','نسبة الضريبة يدخلها المستخدم نصًا عشريًا؛ لا نسبة مفترضة في الكود');
  if(!Number.isInteger(input.revisions)||input.revisions<0||input.revisions>20)fail(400,'revisions','عدد المراجعات من صفر إلى 20');
  if(view.deliverables.length>30)fail(409,'too_many_lines','العرض التجاري يقبل ثلاثين بندًا. ادمج المخرجات');
  // العميل يشتري مخرجات لا ساعات أدوار: بند عرض لكل مخرج بمجموع سعره وتكلفته.
  return {action:'save_quote',estimate_id:row.id,case_version:input.case_version,case_id:view.handoff?.case_id??null,
    payload:{scope:`${row.code} — ${row.scope_note}`.slice(0,5000),currency:'SAR',valid_until:v.date(input.valid_until),...(input.quotation_id?{quotation_id:input.quotation_id}:{}),
      lines:view.deliverables.map(d=>({description:d.name.slice(0,500),quantity:'1',unit_price:decimal(d.sell_minor),unit_cost:decimal(d.cost_minor),discount:'0',tax_rate:input.tax_rate,acceptance:acceptance('معيار قبول المخرجات'),revisions:input.revisions}))}};
}

/* ───── اللوحة ───── */
export function estimatesBoard(db,supplied,{costRate}={}){
  const {u,clients}=seller(db,supplied),date=today(),ids=clients.map(c=>c.id),marks=ids.map(()=>'?').join(','),names=new Map(clients.map(c=>[c.id,c.trade_name||c.legal_name]));
  const cards=db.prepare(`SELECT * FROM price_cards WHERE tenant_id=? AND (client_id IS NULL${ids.length?` OR client_id IN (${marks})`:''}) ORDER BY client_id IS NOT NULL,effective_from DESC,created_at DESC`).all(u.tenant_id,...ids).map(r=>cardView(db,u,r,names));
  const rows=ids.length?db.prepare(`SELECT * FROM estimates WHERE tenant_id=? AND client_id IN (${marks}) ORDER BY updated_at DESC LIMIT 300`).all(u.tenant_id,...ids):[];
  const estimates=rows.map(r=>estimateView(db,u,r,names.get(r.client_id))),connected=typeof costRate==='function';
  const scope=ids.length?db.prepare(`SELECT e.id,e.kind,e.quantity,e.item_reference,e.description,e.disposition,e.created_at,b.name AS baseline_name,b.client_id FROM scope_events e JOIN scope_baselines b ON b.id=e.baseline_id
    WHERE b.tenant_id=? AND b.client_id IN (${marks}) AND e.over_scope=1 AND (e.disposition IS NULL OR e.disposition='change_request') AND NOT EXISTS(SELECT 1 FROM estimates x WHERE x.scope_event_id=e.id AND x.status<>'rejected') ORDER BY e.created_at DESC LIMIT 100`).all(u.tenant_id,...ids):[];
  return {today:date,user_id:u.id,status_names:ESTIMATE_STATUS,cost_source_connected:connected,
    cost_notice:connected?'معدل التكلفة يُقرأ من معدلات الفئة الوظيفية المعتمدة عند حفظ المسودة. سطر بلا رمز فئة، أو فئة بلا معدل معتمد في تاريخ الحفظ، يبقى غير مُكلَّف.':`${NO_COST}: مصدر معدلات التكلفة غير موصول بهذه الشاشة. تُحفظ التقديرات بأسعار البيع وحدها، ولا يُعرض هامش على تكلفة صفرية.`,
    clients:clients.map(c=>({id:c.id,name:names.get(c.id),live_card:(card=>card?{id:card.id,name:card.name,effective_from:card.effective_from,own:!!card.client_id,roles:cardLines(card).filter(l=>l.kind==='role')}:null)(liveCard(db,u.tenant_id,c.id,date)),
      opportunities:db.prepare("SELECT id,name FROM opportunities WHERE client_id=? AND tenant_id=? AND status='open' ORDER BY name").all(c.id,u.tenant_id),
      cases:db.prepare('SELECT k.id,k.name,k.status,k.version FROM commercial_cases k JOIN client_links l ON l.case_id=k.id WHERE l.client_id=? AND k.tenant_id=? AND k.owner_id=? ORDER BY k.name').all(c.id,u.tenant_id,u.id)})),
    price_cards:cards,estimates,
    // تنبيهات حارس النطاق التي تنتظر أمر تغيير مسعّرًا، مع التقديرات المعتمدة التي يصح البناء عليها.
    scope_candidates:scope.map(e=>({...e,client_name:names.get(e.client_id),parents:estimates.filter(x=>x.client_id===e.client_id&&x.status==='approved').map(x=>({id:x.id,code:x.code,name:x.name}))})),
    awaiting_me:[...estimates.filter(x=>x.actions.includes('approve_estimate')).map(x=>({id:x.id,title:`${x.kind_name} ${x.code} — ${x.client_name} · ${decimal(x.total.sell_minor)} ريال${x.margin_available?'':' · الهامش غير محسوب'}`,created_at:x.submitted_at,actions:['approve_estimate']})),
      ...cards.filter(x=>x.actions.includes('approve_card')).map(x=>({id:x.id,title:`بطاقة أسعار «${x.name}» — ${x.scope_name} · سريان ${x.effective_from}`,created_at:x.created_at,actions:['approve_card']}))],
    note:'لا أسعار افتراضية: بطاقات الأسعار تبدأ فارغة، يدخلها صاحب الإجراء بسندها ويعتمدها شخص آخر، والسعر الجديد بطاقة بتاريخ سريان جديد. بطاقة العميل إن وُجدت تحل محل القائمة العامة كاملة. '
      +'التقدير هنا حساب داخلي قبل العرض: لا يُرسل للعميل من هذه الشاشة، ولا ينشئ مشروعًا. التقدير المعتمد يُحمل إلى «المبيعات والتسليم» حيث يُعتمد الهامش ويُسجل العقد ويُنشأ المشروع بميزانيته.'};
}
