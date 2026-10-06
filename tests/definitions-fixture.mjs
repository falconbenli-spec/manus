// مُثبِّت مشترك لاختبارات سجل التعريفات والحقول المخصّصة (ترحيل 123). بيانات مصطنعة بالكامل.
// السلسلة كلها: عميل ← فرصة في مرحلة معتمدة ← ورقة تسعير معتمدة من مقاعدها الأربعة ← عرض سعر مسودة، وقرار مالك بجهة الإصدار.
// الحسابات:  employee  يعمل على الكيانات الثلاثة ويُعدّ التعريفات وينشرها (حامل definitions.publish بمنح صريح)
//            manager   ناشر ثانٍ، وهو وحده من يحمل profitability.view — التصريح الذي تُحجب به الحقول في اختبارات الحجب
//            outsider  عضو في فريق الحساب يحمل تصريح التسعير والمبيعات بلا أي تصريح تعريفات ولا profitability.view: «القارئ غير المخوَّل»
import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { prepareStage, stageAction, createOpportunity } from '../app/pipeline-estimates.mjs';
import { preparePriceCard, priceCardAction } from '../app/estimates.mjs';
import { preparePolicy, policyAction, prepareIssuerDecision, issuerDecisionAction, saveSheet, sheetAction, createQuotation, APPROVAL_SEATS } from '../app/pricing.mjs';
import { saveDraft, publishDraft } from '../app/definitions.mjs';

export const PASSWORD='synthetic-definitions';
export const code=value=>error=>error.code===value;
export const caught=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
export const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
export const GRANTS=[
  ['employee','pricing.sheets.use','creative'],['employee','clients.manage',''],['employee','commercial.use','creative'],['employee','procurement.use','creative'],
  ['employee','definitions.configure',''],['employee','definitions.publish',''],
  ['outsider','pricing.sheets.use','creative'],['outsider','finance.use','creative'],['outsider','commercial.use','creative'],
  ['manager','pricing.sheets.use','creative'],['manager','commercial.use','creative'],['manager','procurement.use','creative'],
  ['manager','pricing.epmo.approve','creative'],['manager','pricing.vp.approve',''],['manager','pricing.exception.approve',''],
  ['manager','definitions.configure',''],['manager','definitions.publish',''],['manager','profitability.view','']];

// الحقل الذي يدور عليه اختبار القبول الحاكم: «مصدر الفرصة» قائمة اختيار، في الترويسة، إلزامي عند «إصدار العرض للعميل»، وعمود في القائمة.
export const LEAD_SOURCE={key:'lead_source',label:{ar:'مصدر الفرصة',en:'Lead source'},type:'select',required:false,help:'من أين وصلتنا هذه الفرصة',
  options:[{value:'referral',label:{ar:'إحالة من عميل',en:'Referral'},tone:'positive'},{value:'event',label:{ar:'فعالية أو معرض',en:'Event'}},{value:'inbound',label:{ar:'تواصل وارد',en:'Inbound'}}]};
export const GOVERNING_SPEC={fields:[LEAD_SOURCE],layout:{slots:{header:['lead_source']}},views:{list:{columns:['lead_source'],filters:['lead_source']}},
  transitions:{issue:{require:['lead_source']}},statuses:{issued:{label:{ar:'مُرسل',en:'Sent'}}}};
// حقل محجوب: لا يراه إلا حامل profitability.view (المدير في هذا المُثبِّت). قيمته في الاختبارات «كناري» يُبحث عنه في كل مخرج.
export const MASKED_NOTE={key:'internal_note',label:{ar:'ملاحظة داخلية للإدارة'},type:'text',required:false,searchable:true,tracked:true,visible_to:['profitability.view']};
export const CANARY='كناري-محجوب-7Q';

const HEAD={contract_kind:'one_off',duration_note:'ثمانية أسابيع',proposed_pm_id:'',review_notes:'',vat_rate:'15',vat_basis:'نسبة ضريبة القيمة المضافة النظامية كما أدخلها المستخدم بمرجعها'};
const LINES=[{cost_group:'internal_team',description:'رواتب الفريق الداخلي المحمّلة على المشروع',basis:'hours',quantity:'100',unit_price:'500.00'},
  {cost_group:'external_production',description:'إنتاج فيديو خارجي',basis:'quantity',quantity:'1',unit_price:'50000.00'}].map(l=>({...l,cost_reference_kind:'',cost_reference_id:'',note:''}));

export const usersOf=db=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
export function grantAll(db,users){
  transaction(db,()=>{for(const [user,capability,department] of GRANTS)grantAccess(db,users.admin,{user_id:user,capability,department_id:department,note:'منح تجريبي'});});
}
// من سياسات التسعير إلى ورقة معتمدة من مقاعدها الأربعة، وقرار جهة الإصدار. لا تمس جداول الكيانات الثلاثة، فتعمل على قاعدة قبل 123 أيضًا.
export function approvedSheet(db,users,clientId,{name='مشروع تجريبي'}={}){
  const tx=f=>transaction(db,f),version=(table,id)=>db.prepare(`SELECT version FROM ${table} WHERE id=?`).get(id).version;
  if(!db.prepare("SELECT 1 FROM pricing_policies WHERE status='approved' LIMIT 1").get()){
    for(const [key,value] of [['contingency_rate','10'],['target_margin','20']]){
      const pid=tx(()=>preparePolicy(db,users.employee,{policy_key:key,percent:value,duration:null,source_reference:`نموذج تسعير المشروع MOD-BD-02 المعتمد في الشركة — حقل ${key}`,
        basis:'الرقم منصوص عليه في النموذج الذي تستخدمه الشركة اليوم',effective_from:riyadh(-1)})).id;
      tx(()=>policyAction(db,users.manager,pid,'approve_policy',{version:version('pricing_policies',pid),note:'اعتماد الرقم كما في النموذج'}));
    }
    const cardId=tx(()=>preparePriceCard(db,users.employee,{client_id:'',name:`بطاقة الأسعار العامة ${riyadh(-1)}`,effective_from:riyadh(-1),
      source:'قرار التسعير الداخلي التجريبي ومرجعه المحفوظ',lines:[{kind:'role',name:'مصمم',category_code:'',price:'300.00'}]})).id;
    tx(()=>priceCardAction(db,users.manager,cardId,'approve_card',{version:version('price_cards',cardId),note:'اعتماد تجريبي'}));
    const decisionId=tx(()=>prepareIssuerDecision(db,users.employee,{chosen_option:'procurement',basis:'قرار المالك بعد عرض القراءتين المتعارضتين عليه'})).id;
    tx(()=>issuerDecisionAction(db,users.manager,decisionId,'approve_decision',{version:version('pricing_decisions',decisionId),note:'حسم القرار'}));
  }
  const sheetId=tx(()=>saveSheet(db,users.employee,{client_id:clientId,opportunity_id:'',name,scope_note:'نطاق تجريبي مكتوب بما يكفي من التفصيل',
    discount:'',discount_basis:'',admin_fee_percent:'',admin_fee_basis:'',...HEAD,lines:LINES},{})).id;
  tx(()=>sheetAction(db,users.employee,sheetId,'submit',{version:version('pricing_sheets',sheetId)}));
  const holder={requesting_department:users.outsider,procurement_finance:users.outsider,epmo:users.manager,vp_corporate_services:users.manager};
  for(const seat of APPROVAL_SEATS.map(s=>s.key))tx(()=>sheetAction(db,holder[seat],sheetId,'decide',{version:version('pricing_sheets',sheetId),seat,decision:'approved',note:'راجعت البنود والنسب واعتمدت'}));
  return sheetId;
}
export function fixture(t,{quotation=true}={}){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const users=usersOf(db),tx=f=>transaction(db,f);grantAll(db,users);
  const client=tx(()=>createClient(db,users.employee,{legal_name:'شركة تجريبية للتجزئة',sector:'التجزئة',status:'prospect'})).id;
  for(const member of ['manager','outsider'])tx(()=>clientAction(db,users.employee,client,'add_member',{user_id:member,role:'عضو الفريق التجريبي'}));
  for(const [stageCode,name,order] of [['LEAD','فرصة أولية',1],['PROPOSED','عرض مقدَّم',2]]){
    const stageId=tx(()=>prepareStage(db,users.employee,{code:stageCode,name,sort_order:order,win_probability:order===1?'10':'50',probability_basis:'متوسط تجربة الشركة التجريبية في آخر سنة',
      confirmed_on:riyadh(),required_fields:order===2?['decision_maker']:[],idle_days:7})).id;
    tx(()=>stageAction(db,users.manager,stageId,'approve_stage',{version:db.prepare('SELECT version FROM pipeline_stages WHERE id=?').get(stageId).version,note:'اعتماد تجريبي'}));
  }
  const opportunity=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',name:'فرصة تجريبية لحملة إطلاق',service_family:'campaigns',value:'100000.00',
    expected_close_on:'',decision_maker:'',budget_note:'',next_step:'',next_step_on:''})).id;
  const sheet=quotation?approvedSheet(db,users,client):null;
  const quote=quotation?tx(()=>createQuotation(db,users.employee,sheet,{valid_until:riyadh(30),note:''})).id:null;
  const row=(table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  // نشر تعريف بخطوتين كما يفعل المحرّر: مسودة ثم نشر. by يُعدّ، وpublisher ينشر (هو نفسه ما لم يكن الفرق تخفيفًا).
  const publish=(entity,spec,{by=users.employee,publisher=by,note='نشر تجريبي لتعريف الصفحة'}={})=>{
    const draft=tx(()=>saveDraft(db,by,entity,{spec,...(db.prepare('SELECT row_version FROM definition_drafts WHERE tenant_id=? AND entity_key=?').get(by.tenant_id,entity)??{})}));
    return tx(()=>publishDraft(db,publisher,entity,{row_version:draft.row_version,note}));
  };
  return {db,users,tx,client,opportunity,sheet,quote,row,publish,quotationRow:()=>row('client_quotations',quote)};
}

/* ───── المسارات بلا منفذ شبكة ───── */
// معالج الطلبات الحقيقي (createApp) يُستدعى داخل العملية بحدث request: الجلسة وCSRF والتفويض والمعاملة كلها تجري كما في الشبكة،
// بلا listen — فالاختبار يمر حتى في بيئة معزولة تمنع فتح منفذ.
export function dispatch(app,{method='GET',path,headers={},body}){
  return new Promise((resolve,reject)=>{
    const req=Object.assign(Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]),{method,url:path,
      headers:{host:'127.0.0.1:3600',...(body===undefined?{}:{'content-type':'application/json'}),...Object.fromEntries(Object.entries(headers).map(([k,x])=>[k.toLowerCase(),x]))},
      socket:{remoteAddress:'127.0.0.1',encrypted:false}});
    let status=0,head={};
    const res={writeHead(s,h={}){status=s;head=h;return res;},setHeader(){},getHeader(){},
      end(data){const buffer=data===undefined?Buffer.alloc(0):Buffer.isBuffer(data)?data:Buffer.from(String(data));resolve({status,headers:head,buffer,text:buffer.toString('utf8'),json(){return JSON.parse(buffer.toString('utf8'));}});}};
    try{app.emit('request',req,res);}catch(error){reject(error);}
  });
}
export async function sessionsFor(app,names){
  const sessions={};
  for(const username of names){
    const response=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    if(response.status!==200)throw new Error(`login failed for ${username}: ${response.text}`);
    sessions[username]={cookie:response.headers['Set-Cookie'].split(';')[0],csrf:response.json().csrf};
  }
  const call=async(who,path,input,expected)=>{
    const auth=sessions[who],response=await dispatch(app,{method:input===undefined?'GET':'POST',path:'/api'+path,headers:{cookie:auth.cookie,'x-csrf-token':auth.csrf},body:input});
    if(expected!==undefined&&response.status!==expected)throw new Error(`${who} ${path}: expected ${expected}, got ${response.status} — ${response.text.slice(0,600)}`);
    return response;
  };
  return {sessions,call};
}
// نص كل أوراق ملف XLSX: الحزمة ZIP، وكل مدخل فيها مضغوط deflate خام. يُفك بلا مكتبة ليُبحث في الخلايا عن قيمة لا يجوز أن تكون فيها.
export function workbookText(buffer){
  let out='',offset=0;
  while(offset+30<=buffer.length&&buffer.readUInt32LE(offset)===0x04034b50){
    const packed=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28),start=offset+30+nameLength+extra;
    out+=inflateRawSync(buffer.subarray(start,start+packed)).toString('utf8');offset=start+packed;
  }
  return out;
}
