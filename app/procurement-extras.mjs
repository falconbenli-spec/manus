import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { purchaseFor, listProcurement, canSee, purchaseState, INVOICE_STATES } from './procurement.mjs';
import { effectiveOrder, itemActions } from './procurement-guards.mjs';
import { commitmentOf, recordCommitmentMovement } from './budgets.mjs';
import { financeCapabilities } from './finance.mjs';

// الشراء الطارئ يختصر المقارنة ولا يختصر الاعتماد المستقل ولا المخصص ولا بوابة المورد، وتلزمه مراجعة لاحقة من طرف ثالث.
const REVIEW_DAYS=7;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة المشتريات معاملة قاعدة بيانات');}
export const RELATIONSHIPS=[['ownership','ملكية أو شراكة'],['family','قرابة'],['prior_employment','عمل سابق لدى المورد'],['gift_or_benefit','هدية أو منفعة'],['other','علاقة أخرى']].map(([key,label])=>({key,name:label}));
const CONFLICT_STATES={disclosed:'بانتظار البت — القرارات على المورد ممنوعة',no_conflict:'لا تعارض',managed:'مُدار بشروط',recused:'تنحٍّ عن قرارات المورد',withdrawn:'مسحوب'};

export function declareEmergency(db,supplied,purchaseId,input){
  writing(db);const {u,p,own}=purchaseFor(db,supplied,purchaseId);
  v.object(input,['justification','risk_if_delayed']);
  if(!own||p.status!=='sourcing')fail(409,'invalid_state','يعلن صاحب الطلب الطارئ وهو في مرحلة جمع العروض');
  if(db.prepare('SELECT 1 FROM procurement_emergencies WHERE purchase_id=?').get(p.id))fail(409,'duplicate_emergency','لهذا الطلب إعلان طارئ مسجل');
  // من تأخرت مراجعة طارئه السابق لا يعلن طارئًا جديدًا.
  const overdue=db.prepare("SELECT COUNT(*) AS n FROM procurement_emergencies WHERE tenant_id=? AND declared_by=? AND status='approved' AND reviewed_by IS NULL AND review_due<?").get(u.tenant_id,u.id,today()).n;
  if(overdue)fail(409,'review_overdue','لديك شراء طارئ سابق تأخرت مراجعته اللاحقة. تُستكمل المراجعة أولًا');
  db.prepare("INSERT INTO procurement_emergencies(purchase_id,tenant_id,justification,risk_if_delayed,declared_by,status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(p.id,u.tenant_id,v.text(input.justification,'سبب الاستعجال ولماذا لم يُخطط له',3000,30),v.text(input.risk_if_delayed,'الأثر إن انتظر الشراء المسار المعتاد',2000,20),u.id,now());
  audit(db,u,'procurement',p.id,'emergency.declared',{}, {});
  return {id:p.id};
}
export function decideEmergency(db,supplied,purchaseId,decision,input){
  writing(db);const {u,p,reviewer}=purchaseFor(db,supplied,purchaseId);
  v.object(input,['note']);if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const e=db.prepare("SELECT * FROM procurement_emergencies WHERE purchase_id=? AND status='pending'").get(p.id);
  if(!e||!reviewer||p.status!=='sourcing')fail(409,'invalid_state','لا إعلان طارئ بانتظار قرارك');
  const status=decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE procurement_emergencies SET status=?,decided_by=?,decided_at=?,decision_note=?,review_due=? WHERE purchase_id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',2000,10),decision==='approve'?addDays(today(),REVIEW_DAYS):null,p.id);
  audit(db,u,'procurement',p.id,'emergency.'+status,{}, {});
  return {id:p.id,status};
}
export function reviewEmergency(db,supplied,purchaseId,input){
  writing(db);const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');
  v.object(input,['outcome','note']);
  if(!['justified','not_justified'].includes(input.outcome))fail(400,'outcome','اختر نتيجة المراجعة');
  // المراجعة اللاحقة لحامل تصريح مراجعة الموردين النظامية: طرف خارج فريق الطلب.
  if(!holds(db,u,'vendors.legal'))fail(403,'not_permitted','المراجعة اللاحقة للشراء الطارئ لحامل تصريح المراجعة النظامية');
  const e=typeof purchaseId==='string'&&db.prepare("SELECT e.* FROM procurement_emergencies e WHERE e.purchase_id=? AND e.tenant_id=? AND e.status='approved' AND e.reviewed_by IS NULL").get(purchaseId,u.tenant_id);
  if(!e)fail(404,'not_found','لا شراء طارئ بانتظار المراجعة');
  if(e.declared_by===u.id||e.decided_by===u.id)fail(409,'separation_of_duties','من أعلن الطارئ أو اعتمده لا يراجعه');
  if(!db.prepare('SELECT 1 FROM procurement_awards WHERE purchase_id=?').get(e.purchase_id))fail(409,'not_awarded','تُراجع الحالة بعد الترسية');
  db.prepare('UPDATE procurement_emergencies SET review_outcome=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE purchase_id=?').run(input.outcome,u.id,now(),v.text(input.note,'نتيجة المراجعة وما يُتخذ',3000,20),e.purchase_id);
  audit(db,u,'procurement',e.purchase_id,'emergency.reviewed',{}, {outcome:input.outcome});
  return {id:e.purchase_id,outcome:input.outcome};
}

export function requestOrderChange(db,supplied,purchaseId,input){
  writing(db);const {u,p,own}=purchaseFor(db,supplied,purchaseId);
  v.object(input,['kind','new_delivery_date','new_terms','reason','supplier_confirmation']);
  if(!['delivery_date','terms','close_short'].includes(input.kind))fail(400,'kind','اختر نوع التعديل');
  const order=effectiveOrder(db,db.prepare('SELECT * FROM procurement_orders WHERE purchase_id=?').get(p.id));
  if(!own||!order||!['ordered','part_received'].includes(p.status)||order.closed_short)fail(409,'invalid_state','يُطلب التعديل من صاحب الطلب على أمر قائم لم يكتمل استلامه');
  if(db.prepare("SELECT 1 FROM procurement_order_changes WHERE order_id=? AND status='pending'").get(order.id))fail(409,'pending_change','للأمر تعديل بانتظار القرار');
  if(input.kind==='close_short'&&p.status!=='part_received')fail(409,'nothing_received','الإقفال على المستلم يتطلب استلامًا جزئيًا. الأمر الذي لم يُستلم منه شيء يُعالج بقرار مستقل');
  const date=input.kind==='delivery_date'?v.date(input.new_delivery_date):null,terms=input.kind==='terms'?v.text(input.new_terms,'الشروط الجديدة',3000,3):null;
  if(date&&date===order.effective_delivery_date)fail(400,'no_change','التاريخ الجديد يطابق الحالي');
  const changeId=randomUUID();
  db.prepare("INSERT INTO procurement_order_changes(id,tenant_id,purchase_id,order_id,kind,new_delivery_date,new_terms,reason,supplier_confirmation,requested_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?)").run(changeId,u.tenant_id,p.id,order.id,input.kind,date,terms,v.text(input.reason,'سبب التعديل',3000,20),v.text(input.supplier_confirmation,'مرجع موافقة المورد المكتوبة',1000,5),u.id,now());
  audit(db,u,'procurement',p.id,'order_change.requested',{}, {kind:input.kind});
  return {id:changeId};
}
export function decideOrderChange(db,supplied,changeId,decision,input){
  writing(db);const viewer=currentUser(db,supplied);
  v.object(input,['note']);if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const c=viewer&&typeof changeId==='string'&&db.prepare("SELECT * FROM procurement_order_changes WHERE id=? AND tenant_id=? AND status='pending'").get(changeId,viewer.tenant_id);
  if(!c)fail(404,'not_found','التعديل غير متاح');
  const {u,p,reviewer}=purchaseFor(db,supplied,c.purchase_id);
  if(!reviewer||c.requested_by===u.id)fail(403,'not_permitted','يقرر التعديل مراجع غير صاحب الطلب');
  const status=decision==='approve'?'approved':'rejected';
  // الإقفال على المستلم يحرر من الالتزام ما لن يصل (الترحيل 169): الرقم مشتق في المخصص، والحركة تُكتب في سجل تدقيقه.
  const before=c.kind==='close_short'&&status==='approved'?commitmentOf(db,c.purchase_id):null;
  db.prepare('UPDATE procurement_order_changes SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',2000,10),c.id);
  audit(db,u,'procurement',c.purchase_id,'order_change.'+status,{}, {kind:c.kind});
  if(before)recordCommitmentMovement(db,u,p,'release_purchase_commitment',before);
  return {id:c.id,status};
}

export function discloseConflict(db,supplied,input){
  writing(db);const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','الإفصاح لحسابات الموظفين');
  v.object(input,['supplier_key','relationship','description']);
  if(!RELATIONSHIPS.some(r=>r.key===input.relationship))fail(400,'relationship','اختر نوع العلاقة');
  const vendor=typeof input.supplier_key==='string'&&db.prepare('SELECT id FROM vendors WHERE tenant_id=? AND supplier_key=?').get(u.tenant_id,input.supplier_key.trim().toUpperCase());
  if(!vendor)fail(404,'vendor_not_found','المورد غير مسجل في دليل الموردين. يُسجل أولًا ثم يُفصح عن العلاقة');
  if(db.prepare("SELECT 1 FROM vendor_conflict_disclosures WHERE vendor_id=? AND user_id=? AND status IN ('disclosed','managed','recused')").get(vendor.id,u.id))fail(409,'duplicate_disclosure','لك إفصاح قائم عن هذا المورد');
  const disclosureId=randomUUID();
  db.prepare("INSERT INTO vendor_conflict_disclosures(id,tenant_id,vendor_id,user_id,relationship,description,status,created_at) VALUES(?,?,?,?,?,?,'disclosed',?)").run(disclosureId,u.tenant_id,vendor.id,u.id,input.relationship,v.text(input.description,'وصف العلاقة',3000,20),now());
  audit(db,u,'vendor_conflict',disclosureId,'conflict.disclosed',{}, {vendor_id:vendor.id});
  return {id:disclosureId};
}
export function decideConflict(db,supplied,disclosureId,decision,input){
  writing(db);const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');
  v.object(input,['note','conditions']);
  const d=typeof disclosureId==='string'&&db.prepare('SELECT * FROM vendor_conflict_disclosures WHERE id=? AND tenant_id=?').get(disclosureId,u.tenant_id);
  if(!d||!(d.user_id===u.id||holds(db,u,'vendors.legal')))fail(404,'not_found','الإفصاح غير متاح');
  const time=now(),note=v.text(input.note,'أساس القرار',2000,10);
  if(decision==='withdraw'){
    const ownPending=d.status==='disclosed'&&d.user_id===u.id,lift=['managed','recused'].includes(d.status)&&d.user_id!==u.id&&holds(db,u,'vendors.legal');
    if(!ownPending&&!lift)fail(409,'invalid_state','صاحب الإفصاح يسحب ما لم يُبت فيه؛ والقيد القائم يرفعه المراجع النظامي');
    db.prepare("UPDATE vendor_conflict_disclosures SET status='withdrawn',withdrawn_by=?,withdrawn_at=?,withdrawal_note=? WHERE id=?").run(u.id,time,note,d.id);
  }else{
    if(!['no_conflict','managed','recused'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
    if(d.status!=='disclosed'||d.user_id===u.id||!holds(db,u,'vendors.legal'))fail(409,'invalid_state','يبت في الإفصاح المراجع النظامي، لا صاحبه');
    db.prepare('UPDATE vendor_conflict_disclosures SET status=?,conditions=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(decision,decision==='managed'?v.text(input.conditions,'شروط الإدارة',2000,10):'',u.id,time,note,d.id);
  }
  audit(db,u,'vendor_conflict',d.id,'conflict.'+decision,{status:d.status},{vendor_id:d.vendor_id});
  return {id:d.id};
}

// استثناءات المشتريات لحامل التفويض المالي خارج نطاق الطلب (الترحيل 169): الفواتير الموقوفة وطلبات الإلغاء المعلّقة وطلبات الإشعار
// الدائن المنتظرة. من في النطاق يراها على بطاقة الطلب نفسها، فلا تُكرَّر هنا — فلا يعدّ صندوق «أقرّر» القرار الواحد مرتين.
function financeExceptions(db,u){
  const perms=financeCapabilities(db,u);
  if(!perms.length)return [];
  const candidates=db.prepare(`SELECT p.* FROM procurement_purchases p WHERE p.tenant_id=? AND (
      EXISTS(SELECT 1 FROM procurement_credit_requests r WHERE r.purchase_id=p.id)
      OR EXISTS(SELECT 1 FROM procurement_voids x WHERE x.purchase_id=p.id AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=x.id))
      OR EXISTS(SELECT 1 FROM procurement_invoice_lines il JOIN procurement_order_lines ol ON ol.id=il.order_line_id WHERE il.purchase_id=p.id
        AND il.amount_minor<>il.quantity*ol.unit_price_minor AND NOT EXISTS(SELECT 1 FROM procurement_payables y WHERE y.invoice_id=il.invoice_id))
      OR ((EXISTS(SELECT 1 FROM procurement_returns t WHERE t.purchase_id=p.id) OR EXISTS(SELECT 1 FROM procurement_order_changes c WHERE c.purchase_id=p.id AND c.kind='close_short' AND c.status='approved'))
        AND EXISTS(SELECT 1 FROM procurement_invoices i WHERE i.purchase_id=p.id AND NOT EXISTS(SELECT 1 FROM procurement_payables y WHERE y.invoice_id=i.id))))
    ORDER BY p.updated_at DESC LIMIT 200`).all(u.tenant_id).filter(p=>!canSee(db,u,p));
  const items=[];
  for(const p of candidates){
    const state=itemActions(u,perms,purchaseState(db,p),{scoped:false}),base={purchase_id:p.id,title:p.title,version:p.version};
    for(const invoice of state.invoices.filter(i=>i.state==='held'))items.push({...base,kind:'held_invoice',id:invoice.id,supplier_reference:invoice.supplier_reference,
      amount_minor:invoice.amount_minor,created_at:invoice.created_at,state_name:INVOICE_STATES.held,variance:invoice.variance,actions:invoice.actions.filter(a=>a==='decide_invoice')});
    for(const request of state.voids.filter(x=>x.state==='pending')){const invoice=state.invoices.find(i=>i.id===request.invoice_id);
      items.push({...base,kind:'void',id:request.id,supplier_reference:invoice?.supplier_reference??null,payable:!!request.payable_id,reason:request.reason,evidence:request.evidence,
        requested_by_name:request.requested_by_name,created_at:request.created_at,actions:request.actions});}
    for(const payable of state.payables)for(const request of payable.credit_requests.filter(r=>r.outstanding_minor>0)){const invoice=state.invoices.find(i=>i.id===payable.invoice_id);
      items.push({...base,kind:'credit_request',id:request.id,payable_id:payable.id,supplier_reference:invoice?.supplier_reference??null,source:request.source,amount_minor:request.amount_minor,
        outstanding_minor:request.outstanding_minor,open_minor:request.open_minor,created_at:request.created_at,actions:request.actions});}
  }
  return items;
}
export function procurementExtras(db,supplied){
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');
  const legal=holds(db,u,'vendors.legal'),visible=new Set(listProcurement(db,u).map(p=>p.id));
  const emergencies=db.prepare("SELECT e.*,p.title,p.requester_id FROM procurement_emergencies e JOIN procurement_purchases p ON p.id=e.purchase_id WHERE e.tenant_id=? ORDER BY e.created_at DESC LIMIT 100").all(u.tenant_id)
    .filter(e=>visible.has(e.purchase_id)||legal).map(e=>{const awarded=!!db.prepare('SELECT 1 FROM procurement_awards WHERE purchase_id=?').get(e.purchase_id);
      return {...e,declared_by_name:name(db,e.declared_by),decided_by_name:name(db,e.decided_by),reviewed_by_name:name(db,e.reviewed_by),review_overdue:e.status==='approved'&&!e.reviewed_by&&e.review_due<today(),
        actions:e.status==='approved'&&!e.reviewed_by&&awarded&&legal&&e.declared_by!==u.id&&e.decided_by!==u.id?['review_emergency']:[]};});
  const disclosures=db.prepare(`SELECT d.*,x.legal_name,x.code,x.supplier_key FROM vendor_conflict_disclosures d JOIN vendors x ON x.id=d.vendor_id WHERE d.tenant_id=? ${legal?'':'AND d.user_id=?'} ORDER BY d.created_at DESC LIMIT 200`).all(...(legal?[u.tenant_id]:[u.tenant_id,u.id]))
    .map(d=>({...d,status_name:CONFLICT_STATES[d.status],relationship_name:RELATIONSHIPS.find(r=>r.key===d.relationship).name,employee_name:name(db,d.user_id),decided_by_name:name(db,d.decided_by),own:d.user_id===u.id,
      actions:d.status==='disclosed'?(d.user_id===u.id?['withdraw_conflict']:legal?['decide_conflict']:[]):['managed','recused'].includes(d.status)&&legal&&d.user_id!==u.id?['withdraw_conflict']:[]}));
  const vendorOptions=db.prepare("SELECT supplier_key,code,legal_name FROM vendors WHERE tenant_id=? AND status<>'merged' ORDER BY legal_name LIMIT 500").all(u.tenant_id);
  return {user_id:u.id,review_days:REVIEW_DAYS,vendor_options:vendorOptions,relationships:RELATIONSHIPS,emergencies,disclosures,can_disclose:u.role!=='admin',exceptions:financeExceptions(db,u),
    note:'الشراء الطارئ يختصر المقارنة فقط: يبقى المخصص واعتماد شخص آخر وتأهيل المورد، وتلزمه مراجعة لاحقة. تعديل السعر أو زيادة الكمية ليس تعديل أمر: يحتاج طلب شراء جديدًا.'};
}
