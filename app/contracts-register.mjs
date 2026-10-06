import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
import { notifyMany } from './notices.mjs';

// سجل عقود الوكالة التجارية: عملاء وموردون ومستقلون وتراخيص برمجيات. ليس عقود الموظفين (تلك في hr-contracts).
// ثلاثة أشياء يفعلها هذا السجل ولا رابع: يحفظ شروط العقد كما وُقّع، ويحمل بنود الالتزام التي استخرجها إنسان
// بمالك وموعد ودليل، ويذكّر قبل موعد الإشعار بعدم التجديد وقبل الانتهاء.
// وما لا يفعله: لا يوقّع ولا يمنح حجية — التوقيع خارج المنصة لدى مزوّد مرخّص، وما هنا مكان حفظ الأصل ومن وقّعه ومتى.
export const PARTY_KINDS={client:'عميل',vendor:'مورد',freelancer:'مستقل',other:'جهة أخرى'};
export const CONTRACT_TYPES={master_services:'اتفاقية إطارية',statement_of_work:'أمر عمل ونطاق',retainer:'اشتراك خدمات دوري',nda:'اتفاقية سرية',software_license:'ترخيص برمجي',freelance:'عقد مستقل',other:'نوع آخر'};
export const OBLIGATION_CATEGORIES={deliverable:'تسليم',report:'تقرير',insurance:'تأمين ساري',confidentiality:'سرية',liability_cap:'حد مسؤولية',payment:'دفعة',data_protection:'حماية بيانات',other:'بند آخر'};
export const CADENCES={once:'مرة واحدة',monthly:'شهري',quarterly:'ربع سنوي',yearly:'سنوي'};
export const RENEWAL_DECISIONS={renew:'التجديد',do_not_renew:'عدم التجديد',renegotiate:'إعادة التفاوض'};
const STATES={draft:'مسودة سجل',cancelled:'ملغاة قبل السريان',in_force:'ساري',auto_renewed:'تجدد تلقائيًا',expired:'منتهٍ',terminated:'منهى'};
const STEP_MONTHS={once:0,monthly:1,quarterly:3,yearly:12};

const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const pad=n=>String(n).padStart(2,'0');
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const daysBetween=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
// إضافة أشهر تقصّ اليوم إلى آخر يوم في الشهر الأقصر: استحقاق 31 يناير يصير 28 فبراير لا 3 مارس.
function addMonths(date,months){
  const [y,m,d]=date.split('-').map(Number),total=y*12+(m-1)+months,year=Math.floor(total/12),month=total%12;
  return `${String(year).padStart(4,'0')}-${pad(month+1)}-${pad(Math.min(d,new Date(Date.UTC(year,month+1,0)).getUTCDate()))}`;
}
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل العقود معاملة قاعدة بيانات');}
function amountMinor(value,label,{signed=false}={}){
  const pattern=signed?/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/:/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
  if(typeof value!=='string'||!pattern.test(value))fail(400,label,`${label}: مبلغ بالريال بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.replace('-','').split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  return value.startsWith('-')?-minor:minor;
}

/* ───── الصلاحية والوصول ───── */
function reach(db,u){
  const manage=can(db,u,'contracts.register.manage'),view=manage||can(db,u,'contracts.register.view');
  const mine=!!db.prepare(`SELECT 1 FROM contract_records c WHERE c.tenant_id=? AND (c.owner_id=?
    OR EXISTS(SELECT 1 FROM contract_obligations o WHERE o.contract_id=c.id AND o.owner_id=?)
    OR EXISTS(SELECT 1 FROM contract_amendments a WHERE a.contract_id=c.id AND a.approved_by=?)) LIMIT 1`).get(u.tenant_id,u.id,u.id,u.id);
  if(!view&&!mine)fail(403,'not_permitted','لا يوجد تصريح لسجل العقود. اطلبه من مسؤول الصلاحيات');
  return {manage,view};
}
function contractRow(db,u,contractId){
  const c=typeof contractId==='string'&&db.prepare('SELECT * FROM contract_records WHERE id=? AND tenant_id=?').get(contractId,u.tenant_id);
  if(!c)fail(404,'not_found','العقد غير متاح');
  return c;
}

/* ───── القيمة والمدة السارية: الأصل زائد ملاحقه المؤكدة ───── */
function amendmentRows(db,contractId){return db.prepare('SELECT * FROM contract_amendments WHERE contract_id=? ORDER BY number').all(contractId);}
function effective(contract,amendments){
  const live=amendments.filter(a=>a.confirmed_at);
  const delta=live.reduce((sum,a)=>sum+a.value_delta_minor,0);
  const extended=live.filter(a=>a.new_end_date).at(-1)?.new_end_date??contract.end_date;
  return {value_minor:contract.value_minor===null&&!delta?null:(contract.value_minor??0)+delta,end_date:extended,
    notice_deadline:contract.auto_renew&&contract.notice_days?addDays(extended,-contract.notice_days):null};
}
// القيمة والمدة الساريتان لعقد بعينه: يقرؤها التجديد (app/client-renewals.mjs) والفوترة الدورية، بالحساب نفسه الذي تعرضه هذه الشاشة.
export const effectiveTerm=(db,contract)=>effective(contract,amendmentRows(db,contract.id));

/* ───── الالتزامات المستخرجة ───── */
// استحقاقات البند من تاريخ أول استحقاق وتكراره، محدودة بنهاية العقد السارية.
export function occurrences(obligation,endDate){
  const step=STEP_MONTHS[obligation.cadence],list=[obligation.first_due_date];
  if(!step)return list;
  for(let i=1;i<=240;i++){const next=addMonths(obligation.first_due_date,step*i);if(next>endDate)break;list.push(next);}
  return list;
}
function obligationView(db,u,o,contract,term,manage,lead){
  const today=riyadhToday(),dates=occurrences(o,term.end_date);
  const rows=db.prepare('SELECT * FROM contract_obligation_fulfilments WHERE obligation_id=? ORDER BY period').all(o.id);
  const done=new Map(rows.map(f=>[f.period,f])),current=dates.find(d=>!done.has(d))??null;
  const awaiting=rows.find(f=>!f.verified_by)??null,daysLeft=current?daysBetween(today,current):null;
  const state=!current?'fulfilled':daysLeft<0?'overdue':lead!==null&&daysLeft<=lead?'due_soon':'scheduled';
  const actions=[];
  if(current&&o.active&&contract.status==='active'&&o.owner_id===u.id)actions.push('complete_obligation');
  if(awaiting&&awaiting.completed_by!==u.id&&(manage||contract.owner_id===u.id))actions.push('verify_obligation');
  if(manage)actions.push(o.active?'deactivate_obligation':'activate_obligation');
  return {...o,active:!!o.active,category_name:OBLIGATION_CATEGORIES[o.category],cadence_name:CADENCES[o.cadence],owner_name:name(db,o.owner_id),entered_by_name:name(db,o.entered_by),
    contract_id:contract.id,contract_number:contract.number,occurrences:dates.length,current_due_date:current,days_left:daysLeft,state,
    state_name:{fulfilled:'مكتمل',overdue:'متأخر',due_soon:'مستحق قريبًا',scheduled:'مجدول'}[state],
    verifiable_period:awaiting?.period??null,
    fulfilments:rows.map(f=>({...f,completed_by_name:name(db,f.completed_by),verified_by_name:name(db,f.verified_by)})),
    // «التنبيه» لا يعمل قبل أن يدخل المالك مهلته؛ قبل ذلك لا يُوصف بند بأنه مستحق قريبًا.
    needs_owner:!!current&&o.active&&contract.status==='active'&&o.owner_id===u.id&&lead!==null&&['overdue','due_soon'].includes(state),
    actions};
}

/* ───── العقد ───── */
function contractView(db,u,c,manage,settings){
  const amendments=amendmentRows(db,c.id),term=effective(c,amendments),today=riyadhToday();
  const decisions=db.prepare('SELECT * FROM contract_renewal_decisions WHERE contract_id=? ORDER BY decided_at').all(c.id);
  const decided=decisions.find(d=>d.term_end_date===term.end_date)??null;
  const state=c.status==='draft'?'draft':c.status==='cancelled'?'cancelled':c.status==='terminated'?'terminated'
    :term.end_date<today?(c.auto_renew&&decided?.decision!=='do_not_renew'?'auto_renewed':'expired'):'in_force';
  const lead=settings?settings.obligation_lead_days:null;
  const obligations=db.prepare('SELECT * FROM contract_obligations WHERE contract_id=? ORDER BY first_due_date,title').all(c.id)
    .map(o=>obligationView(db,u,o,c,term,manage,lead));
  // سلسلة التجديد (الترحيل 185): العقد الذي يجدّده هذا، وعقد التجديد القائم له، وفرصة تجديده. عقدٌ له عقد تجديد قائم انتهى أمره: لا تنبيه.
  const renews=c.renews_id?db.prepare('SELECT id,number FROM contract_records WHERE id=?').get(c.renews_id)??null:null;
  const renewedBy=db.prepare("SELECT id,number,status FROM contract_records WHERE renews_id=? AND status<>'cancelled' ORDER BY created_at LIMIT 1").get(c.id)??null;
  const renewal=c.party_kind==='client'?db.prepare("SELECT id,name,status,owner_id FROM opportunities WHERE renews_contract_id=? AND status<>'lost' LIMIT 1").get(c.id)??null:null;
  const alert=renewedBy?null:contractAlert(c,term,decided,state,settings,today);
  const actions=[],owner=c.owner_id===u.id;
  if(manage&&c.status==='draft')actions.push('edit_contract','cancel_contract');
  if(c.status==='draft'&&owner&&c.created_by!==u.id)actions.push('activate_contract');
  if(c.status==='active'&&manage)actions.push('record_amendment','add_obligation');
  if(c.status==='active'&&(manage||owner))actions.push('terminate_contract');
  if(alert&&(manage||owner))actions.push('decide_renewal');
  const deal=c.case_id?db.prepare('SELECT id,name FROM commercial_cases WHERE id=?').get(c.case_id):null;
  return {...c,auto_renew:!!c.auto_renew,party_kind_name:PARTY_KINDS[c.party_kind],contract_type_name:CONTRACT_TYPES[c.contract_type],
    party_display:partyName(db,c),status_name:STATES[state],state,commercial_agreement:agreementView(db,c),
    deal:deal?{id:deal.id,ref:deal.id.replace(/-/g,'').slice(0,8).toUpperCase(),name:deal.name}:null,
    renews,renewed_by:renewedBy,renewal_opportunity:renewal?{id:renewal.id,name:renewal.name,status:renewal.status,owner_name:personName(db,renewal.owner_id)}:null,
    owner_name:name(db,c.owner_id),created_by_name:name(db,c.created_by),activated_by_name:name(db,c.activated_by),terminated_by_name:name(db,c.terminated_by),
    effective_value_minor:term.value_minor,effective_end_date:term.end_date,notice_deadline:term.notice_deadline,
    days_to_end:daysBetween(today,term.end_date),days_to_notice:term.notice_deadline?daysBetween(today,term.notice_deadline):null,
    amendments:amendments.map(a=>({...a,recorded_by_name:name(db,a.recorded_by),approved_by_name:name(db,a.approved_by),confirmed_by_name:name(db,a.confirmed_by),
      actions:!a.confirmed_at&&a.approved_by===u.id?['confirm_amendment']:[]})),
    renewal_decisions:decisions.map(d=>({...d,decision_name:RENEWAL_DECISIONS[d.decision],decided_by_name:name(db,d.decided_by)})),
    current_decision:decided,obligations,alert,
    // التوقيع خارج المنصة دائمًا. هذه الحقول توثيق لمكان الأصل لا بديل عنه.
    signature_note:'التوقيع يتم خارج المنصة لدى مزوّد مرخّص. ما هنا تسجيل لمكان حفظ الأصل الموقّع ومن وقّعه ومتى، ولا يمنح أي حجية نظامية.',
    actions};
}
// اتفاق الصفقة الذي يوثّقه العقد، وما يوقفه إنهاؤه. الإشارة من السجل إلى الصفقة؛ والمراجع القصيرة كما تُقرأ في الإشعارات.
function agreementView(db,c){
  if(!c.commercial_contract_id)return null;
  const k=db.prepare('SELECT k.id,k.case_id,c.name,c.status FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id WHERE k.id=?').get(c.commercial_contract_id);
  return k?{id:k.id,case_id:k.case_id,deal_ref:String(k.case_id).replace(/-/g,'').slice(0,8).toUpperCase(),deal_name:k.name,deal_status:k.status,
    stops_on_termination:'إنهاء هذا العقد يوقف على صفقته: تقديم المخرجات، وطلبات التغيير، والاستحقاقات الجديدة، وجدولات الفوترة الدورية'}:null;
}
// اتفاقات الصفقات التي لم يوثّقها عقد في السجل بعد، لعملاء الكيان: منها يختار حامل التصريح عند تسجيل عقد عميل.
function openAgreements(db,tenantId){
  return db.prepare(`SELECT k.id,k.case_id,c.client_id,c.name FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id
    WHERE c.tenant_id=? AND c.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_records r WHERE r.commercial_contract_id=k.id) ORDER BY c.name`).all(tenantId)
    .map(k=>({id:k.id,client_id:k.client_id,label:`${k.name} — اتفاق الصفقة ${String(k.case_id).replace(/-/g,'').slice(0,8).toUpperCase()}`}));
}
function partyName(db,c){
  if(c.client_id)return db.prepare('SELECT legal_name FROM clients WHERE id=?').get(c.client_id)?.legal_name??'';
  if(c.vendor_id)return db.prepare('SELECT legal_name FROM vendors WHERE id=?').get(c.vendor_id)?.legal_name??'';
  return c.party_name;
}
// تنبيه واحد لكل عقد، والأهم أولًا: تفويت مهلة الإشعار يجدّد العقد رغمًا عن الشركة، أما الانتهاء فيمكن تداركه.
function contractAlert(c,term,decided,state,settings,today){
  if(!settings||!['in_force','auto_renewed'].includes(state)||decided)return null;
  if(term.notice_deadline){
    if(today>term.notice_deadline)return {kind:'notice_missed',priority:1,due_date:term.notice_deadline,opened_on:term.notice_deadline,
      title:'فات آخر موعد للإشعار بعدم التجديد',detail:`مهلة الإشعار ${c.notice_days} يومًا قبل ${term.end_date}. ما لم يُسجَّل قرار، يتجدد العقد تلقائيًا.`};
    if(daysBetween(today,term.notice_deadline)<=settings.notice_lead_days)return {kind:'notice_due',priority:2,due_date:term.notice_deadline,
      opened_on:addDays(term.notice_deadline,-settings.notice_lead_days),title:'يقترب آخر موعد للإشعار بعدم التجديد',
      detail:`آخر موعد ${term.notice_deadline}. بعده يتجدد العقد تلقائيًا حتى ${term.end_date} وما بعدها.`};
  }
  if(state==='in_force'&&daysBetween(today,term.end_date)<=settings.expiry_lead_days)
    return {kind:'expiry',priority:3,due_date:term.end_date,opened_on:addDays(term.end_date,-settings.expiry_lead_days),
      title:'يقترب انتهاء العقد',detail:`ينتهي في ${term.end_date}${c.auto_renew?'':' ولا يتجدد تلقائيًا'}.`};
  if(state==='auto_renewed')return {kind:'renewed_unrecorded',priority:2,due_date:term.end_date,opened_on:term.end_date,
    title:'مضى تاريخ الانتهاء والعقد يتجدد تلقائيًا',detail:'المدة الجديدة لا تُعرف من المنصة. سجّل قرار التجديد، وإن تغيرت المدة أو القيمة فبملحق.'};
  return null;
}

function settingsRow(db,tenantId){return db.prepare('SELECT * FROM contract_alert_settings WHERE tenant_id=?').get(tenantId)??null;}

export function contractsRegisterBoard(db,supplied){
  const u=actor(db,supplied),{manage,view}=reach(db,u),settings=settingsRow(db,u.tenant_id);
  const rows=view
    ?db.prepare('SELECT * FROM contract_records WHERE tenant_id=? ORDER BY end_date,number').all(u.tenant_id)
    :db.prepare(`SELECT * FROM contract_records c WHERE c.tenant_id=? AND (c.owner_id=?
        OR EXISTS(SELECT 1 FROM contract_obligations o WHERE o.contract_id=c.id AND o.owner_id=?)
        OR EXISTS(SELECT 1 FROM contract_amendments a WHERE a.contract_id=c.id AND a.approved_by=?)) ORDER BY c.end_date,c.number`).all(u.tenant_id,u.id,u.id,u.id);
  const contracts=rows.map(c=>contractView(db,u,c,manage,settings));
  const people=manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id):[];
  return {today:riyadhToday(),user_id:u.id,can_manage:manage,can_view:view,
    party_kinds:PARTY_KINDS,contract_types:CONTRACT_TYPES,obligation_categories:OBLIGATION_CATEGORIES,cadences:CADENCES,renewal_decisions:RENEWAL_DECISIONS,
    alert_settings:settings?{...settings,set_by_name:name(db,settings.set_by)}:null,
    clients:manage?db.prepare('SELECT id,code,legal_name FROM clients WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id):[],
    vendors:manage?db.prepare('SELECT id,code,legal_name FROM vendors WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id):[],
    baselines:manage?db.prepare("SELECT id,client_id,name FROM scope_baselines WHERE tenant_id=? AND status='active' ORDER BY name").all(u.tenant_id):[],
    // صفقات العملاء المتعاقد عليها، لربط سجل العقد بصفقته (الترحيل 184).
    deals:manage?db.prepare("SELECT id,client_id,name FROM commercial_cases WHERE tenant_id=? AND client_id IS NOT NULL AND status IN ('contracted','project_active') ORDER BY name").all(u.tenant_id)
      .map(d=>({...d,ref:d.id.replace(/-/g,'').slice(0,8).toUpperCase()})):[],
    agreements:manage?openAgreements(db,u.tenant_id):[],
    people,contracts,
    totals:{all:contracts.length,in_force:contracts.filter(c=>c.state==='in_force').length,draft:contracts.filter(c=>c.state==='draft').length,
      alerts:contracts.filter(c=>c.alert).length,notice:contracts.filter(c=>c.alert&&['notice_due','notice_missed'].includes(c.alert.kind)).length,
      obligations:contracts.reduce((n,c)=>n+c.obligations.filter(o=>o.active).length,0),
      obligations_late:contracts.reduce((n,c)=>n+c.obligations.filter(o=>o.active&&o.state==='overdue').length,0)},
    note:'سجل عقود تجارية: العميل والمورد والمستقل وتراخيص البرمجيات — لا عقود الموظفين. بنود الالتزام يستخرجها إنسان قرأ العقد ويدخلها بنفسه؛ المنصة لا تقرأ نص عقد ولا تستنتج منه بندًا. التوقيع خارج المنصة، وما يُحفظ هنا مكان الأصل الموقّع ومن وقّعه ومتى. مهل التنبيه إعداد يدخله المالك: قبل ضبطها لا يصدر تنبيه.'};
}

/* ───── إعداد مهل التنبيه ───── */
export function setAlertSettings(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'contracts.register.manage'))fail(403,'not_permitted','ضبط مهل التنبيه لحامل تصريح إدارة سجل العقود');
  v.object(input,['expiry_lead_days','notice_lead_days','obligation_lead_days','basis','version']);
  const day=(value,key,label)=>{if(!Number.isInteger(value)||value<1||value>365)fail(400,key,`${label}: عدد أيام من 1 إلى 365`);return value;};
  const expiry=day(input.expiry_lead_days,'expiry_lead_days','مهلة التنبيه قبل الانتهاء');
  const notice=day(input.notice_lead_days,'notice_lead_days','مهلة التنبيه قبل آخر موعد للإشعار');
  const obligation=day(input.obligation_lead_days,'obligation_lead_days','مهلة التنبيه قبل استحقاق البند');
  const basis=v.text(input.basis,'سند هذه المهل ومن أقرّها',1500,10),time=now(),existing=settingsRow(db,u.tenant_id);
  if(existing){
    v.version(input.version,existing.version);
    db.prepare('UPDATE contract_alert_settings SET expiry_lead_days=?,notice_lead_days=?,obligation_lead_days=?,basis=?,set_by=?,version=version+1,updated_at=? WHERE tenant_id=?')
      .run(expiry,notice,obligation,basis,u.id,time,u.tenant_id);
  }else db.prepare('INSERT INTO contract_alert_settings(tenant_id,expiry_lead_days,notice_lead_days,obligation_lead_days,basis,set_by,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(u.tenant_id,expiry,notice,obligation,basis,u.id,time);
  audit(db,u,'contract_alert_settings',u.tenant_id,'contracts.alert_settings',existing?{expiry:existing.expiry_lead_days,notice:existing.notice_lead_days,obligation:existing.obligation_lead_days}:{},
    {expiry,notice,obligation},basis);
  return {tenant_id:u.tenant_id};
}

/* ───── تسجيل العقد وتعديله قبل السريان ───── */
const CONTRACT_FIELDS=['party_kind','client_id','vendor_id','party_name','contract_type','subject','start_date','end_date','value','auto_renew','notice_days','renewal_note','scope_baseline_id','owner_id','original_location','signed_for_company','signed_for_party','signed_on',
  // الحزمة 4 (الترحيل 184): صفقة العقد، وبندا الدعم اللذان يتجاوزان افتراض المنصة (القرار D4). و(185): العقد الذي يجدّده.
  'case_id','support_response_hours','warranty_days','renews_id',
  // اتفاق الصفقة الذي يوثّقه العقد (الترحيل 182).
  'commercial_contract_id'];
// العقد السابق الذي يجدّده هذا العقد (P4-CRM-6، الترحيل 185): عقد ساري لنفس العميل، ولكل سابق عقد تجديد قائم واحد.
// وإن سُمّيت الصفقة فهي صفقة التجديد نفسها: انفتحت من فرصة تجديد هذا السابق.
function renewalOf(db,u,input,clientId,caseId,currentId=null){
  if(input.renews_id===undefined||input.renews_id===null||input.renews_id==='')return null;
  const previous=typeof input.renews_id==='string'&&db.prepare('SELECT * FROM contract_records WHERE id=? AND tenant_id=?').get(input.renews_id,u.tenant_id);
  if(!previous||previous.id===currentId||previous.party_kind!=='client'||previous.client_id!==clientId)refuse(409,'renews_other_customer',{what:'العقد السابق لازم يكون عقدًا لنفس العميل',
    missing:[{document:'عقد سابق للعميل نفسه في السجل',why:'التجديد يكمل عقد العميل نفسه',owner:'مسؤول سجل العقود',owner_role:'legal',doc_key:'renews_id'}],
    next:'اختر العقد السابق من عقود العميل نفسه، أو اترك الحقل فاضي إذا هذا عقد جديد مو تجديد'});
  if(previous.status!=='active')refuse(409,'renews_not_in_force',{what:`العقد ${previous.number} مو ساري، فما يُسجَّل له تجديد`,
    next:'التجديد يكمل عقدًا ساريًا. وإذا انتهى العلاقة ورجع العميل، سجّل العقد جديدًا بلا سابق'});
  const taken=db.prepare("SELECT number FROM contract_records WHERE tenant_id=? AND renews_id=? AND status<>'cancelled' AND id<>?").get(u.tenant_id,previous.id,currentId??'');
  if(taken)refuse(409,'already_renewed',{what:`العقد ${previous.number} له عقد تجديد قائم: ${taken.number}`,
    missing:[{document:`عقد التجديد ${taken.number}`,why:'لكل عقد عقد تجديد قائم واحد',owner:'مسؤول سجل العقود',owner_role:'legal',doc_key:'renews_id'}],
    next:'افتح عقد التجديد القائم، أو ألغِ مسودته إذا كانت خطأ'});
  if(caseId){
    const opp=db.prepare('SELECT o.kind,o.renews_contract_id FROM commercial_cases k JOIN opportunities o ON o.id=k.opportunity_id WHERE k.id=?').get(caseId);
    if(!opp||opp.kind!=='renewal'||opp.renews_contract_id!==previous.id)refuse(409,'renewal_deal_mismatch',{what:`صفقة العقد ما انفتحت من فرصة تجديد العقد ${previous.number}`,
      missing:[{document:`صفقة مفتوحة من فرصة تجديد ${previous.number}`,why:'عقد التجديد وصفقته يكملان العقد نفسه، فتبقى سلسلة التجديد مقروءة',owner:'صاحب فرصة التجديد',owner_role:'account_manager',doc_key:'case_id'}],
      next:'اربط عقد التجديد بصفقة فرصة التجديد، أو اترك الصفقة فاضية'});
  }
  return previous.id;
}
// صفقة العقد وبندا الدعم (P4-CRM-5): الصفقة متعاقد عليها لعميل العقد نفسه، ولكل صفقة سجل عقد واحد قائم.
// البندان كما كُتبا في العقد؛ فارغان = العقد ما يقول شيئًا، فيسري المعتمد من crm.support_response_hours وcrm.warranty_days.
function supportTerms(db,u,input,clientId,currentId=null){
  let caseId=null;
  if(input.case_id!==undefined&&input.case_id!==null&&input.case_id!==''){
    const deal=typeof input.case_id==='string'&&db.prepare('SELECT id,client_id,status,owner_id FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id,u.tenant_id);
    if(!deal||!clientId||deal.client_id!==clientId)refuse(409,'deal_other_customer',{what:'صفقة العقد لازم تكون صفقة لعميل العقد نفسه',
      missing:[{document:'صفقة متعاقد عليها لنفس العميل',why:'بنود العقد تُقرأ على صفقته، والصفقة لعميلها',owner:'مسؤول سجل العقود',owner_role:'legal',doc_key:'case_id'}],
      next:'اختر الطرف «عميل» وصفقته من صفقاته، أو اترك الصفقة فاضية'});
    if(!['contracted','project_active'].includes(deal.status))refuse(409,'deal_not_contracted',{what:'الصفقة ما عليها اتفاق موثّق بعد، فما يُربط بها سجل عقد',
      missing:[{document:'اتفاق موثّق على الصفقة',why:'سجل العقد يحفظ ما اتُّفق عليه، والاتفاق يُسجَّل على الصفقة أول',owner:personName(db,deal.owner_id)??'صاحب الصفقة',owner_role:'account_manager',doc_key:'case_id'}],
      next:'يسجّل صاحب الصفقة الاتفاق من «العملاء والعروض»، ثم اربط سجل العقد بها'});
    const taken=db.prepare("SELECT number FROM contract_records WHERE tenant_id=? AND case_id=? AND status<>'cancelled' AND id<>?").get(u.tenant_id,deal.id,currentId??'');
    if(taken)refuse(409,'deal_has_contract',{what:`الصفقة لها سجل عقد قائم: ${taken.number}`,
      missing:[{document:`سجل العقد ${taken.number}`,why:'لكل صفقة سجل عقد واحد؛ والتجديد صفقة جديدة بسجل جديد يسمّي سابقه',owner:'مسؤول سجل العقود',owner_role:'legal',doc_key:'case_id'}],
      next:'افتح السجل القائم. وإذا هذا عقد تجديد، اربطه بصفقة التجديد'});
    caseId=deal.id;
  }
  const whole=(value,key,label,min,max)=>{
    if(value===undefined||value===null||value==='')return null;
    if(!Number.isInteger(value)||value<min||value>max)refuse(400,key,{what:`${label}: عدد صحيح من ${min} إلى ${max} كما في بند العقد`,next:`اكتب ${label} من نص العقد، أو اتركه فاضي إذا العقد ما يذكره`});
    return value;
  };
  return {case_id:caseId,support_response_hours:whole(input.support_response_hours,'support_response_hours','مهلة الرد الأول على بلاغ العميل بالساعات',1,2160),
    warranty_days:whole(input.warranty_days,'warranty_days','أيام الضمان بعد قبول المخرج',0,3650)};
}
// اتفاق الصفقة الذي يوثّقه هذا العقد (الترحيل 182): لعميل العقد نفسه، ومرة واحدة في السجل. بهذه الإشارة يوقف إنهاءُ العقد ما بعده.
function commercialAgreement(db,u,input,clientId,selfId=null){
  if(input.commercial_contract_id===undefined||input.commercial_contract_id===null||input.commercial_contract_id==='')return null;
  const k=typeof input.commercial_contract_id==='string'&&db.prepare('SELECT k.id,c.client_id,c.tenant_id FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id WHERE k.id=?').get(input.commercial_contract_id);
  if(!k||k.tenant_id!==u.tenant_id||!clientId||k.client_id!==clientId)refuse(409,'agreement_other_client',{what:'اتفاق الصفقة هذا مو لعميل هذا العقد',
    missing:[{document:'اتفاق صفقة لعميل العقد نفسه',why:'العقد يوثّق اتفاقًا قائمًا مع الطرف نفسه، فإنهاؤه يوقف صفقته هي لا صفقة غيره',owner:'حامل تصريح إدارة سجل العقود',owner_role:'contracts'}],
    next:'اختر الاتفاق من صفقات هذا العميل، أو اترك الحقل فاضي إذا العقد ما يوثّق صفقة في المنصة'});
  const taken=db.prepare('SELECT number FROM contract_records WHERE commercial_contract_id=? AND id IS NOT ?').get(k.id,selfId);
  if(taken)refuse(409,'agreement_already_registered',{what:`اتفاق الصفقة هذا موثّق في العقد ${taken.number}`,
    missing:[{document:'اتفاق صفقة ما له عقد في السجل',why:'الاتفاق الواحد عقدٌ واحد في السجل، وإلا ما يُعرف أي إنهاء يوقفه',owner:'حامل تصريح إدارة سجل العقود',owner_role:'contracts'}],
    next:`افتح العقد ${taken.number}؛ التعديل عليه ملحق مرقّم`});
  return k.id;
}
function cleanContract(db,u,input,selfId=null){
  if(!Object.hasOwn(PARTY_KINDS,input.party_kind))fail(400,'party_kind','اختر صفة الطرف الآخر');
  if(!Object.hasOwn(CONTRACT_TYPES,input.contract_type))fail(400,'contract_type','اختر نوع العقد');
  let clientId=null,vendorId=null,partyName='';
  if(input.party_kind==='client'){
    clientId=db.prepare('SELECT id FROM clients WHERE id=? AND tenant_id=?').get(input.client_id,u.tenant_id)?.id??null;
    if(!clientId)fail(400,'client_id','ملف العميل غير متاح');
  }else if(input.party_kind==='vendor'){
    vendorId=db.prepare('SELECT id FROM vendors WHERE id=? AND tenant_id=?').get(input.vendor_id,u.tenant_id)?.id??null;
    if(!vendorId)fail(400,'vendor_id','ملف المورد غير متاح');
  }else partyName=v.text(input.party_name,'اسم الطرف الآخر',180,3);
  const start=v.date(input.start_date),end=v.date(input.end_date);
  if(end<start)fail(400,'end_date','تاريخ الانتهاء يسبق تاريخ السريان');
  const autoRenew=input.auto_renew===true;
  let noticeDays=null;
  if(autoRenew){
    if(!Number.isInteger(input.notice_days)||input.notice_days<1||input.notice_days>365)fail(400,'notice_days','مهلة الإشعار بعدم التجديد كما في العقد: من 1 إلى 365 يومًا');
    noticeDays=input.notice_days;
    if(noticeDays>=daysBetween(start,end)+1)fail(400,'notice_days','مهلة الإشعار أطول من مدة العقد. راجع البند');
  }
  let baselineId=null;
  if(input.scope_baseline_id){
    const b=db.prepare('SELECT id,client_id FROM scope_baselines WHERE id=? AND tenant_id=?').get(input.scope_baseline_id,u.tenant_id);
    if(!b||b.client_id!==clientId)fail(400,'scope_baseline_id','خط الأساس ليس لهذا العميل');
    baselineId=b.id;
  }
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك العقد غير متاح');
  if(owner.id===u.id)fail(409,'separation_of_duties','من يسجّل العقد لا يكون مالكه: المالك هو من يضعه في حيز السريان');
  const signedOn=input.signed_on?v.date(input.signed_on):null;
  if(signedOn&&signedOn>riyadhToday())fail(400,'signed_on','تاريخ التوقيع لا يكون في المستقبل');
  const terms=supportTerms(db,u,input,clientId,input.id);
  return {...terms,renews_id:renewalOf(db,u,input,clientId,terms.case_id,input.id),party_kind:input.party_kind,client_id:clientId,vendor_id:vendorId,party_name:partyName,contract_type:input.contract_type,
    subject:v.text(input.subject,'موضوع العقد',1000,5),start_date:start,end_date:end,
    value_minor:input.value===undefined||input.value===''||input.value===null?null:amountMinor(input.value,'قيمة العقد'),
    auto_renew:autoRenew?1:0,notice_days:noticeDays,renewal_note:input.renewal_note?v.text(input.renewal_note,'شروط التجديد كما في العقد',1500,5):'',
    scope_baseline_id:baselineId,owner_id:owner.id,original_location:v.text(input.original_location,'مكان حفظ الأصل الموقّع',500,5),
    signed_for_company:input.signed_for_company?v.text(input.signed_for_company,'من وقّع عن الشركة',180,3):'',
    signed_for_party:input.signed_for_party?v.text(input.signed_for_party,'من وقّع عن الطرف الآخر',180,3):'',signed_on:signedOn,
    commercial_contract_id:commercialAgreement(db,u,input,clientId,selfId)};
}
export function createContract(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'contracts.register.manage'))fail(403,'not_permitted','تسجيل العقود لحامل تصريح إدارة سجل العقود');
  v.object(input,CONTRACT_FIELDS);
  const f=cleanContract(db,u,input);
  if(f.value_minor!==null&&f.value_minor<=0)fail(400,'value','قيمة العقد أكبر من صفر، أو اتركها فارغة');
// الرقم من أعلى رقم مستعمل لا من عدد الصفوف: العدّ يفترض تتابعًا بلا فجوة ولا شيء يفرضه.
// اليوم لا فجوة (حارس منع الحذف قائم ونطاق العدّ يطابق القيد الفريد) فالنتيجتان واحدة؛ لكن أول مسار
// استيراد أو ترحيل بيانات يُدخل رقمًا خارج التتابع يجعل العدّ يعيد رقمًا مستعملًا فيسقط الإدراج أمام المستخدم.
  const contractId=id(),time=now(),number='CT-'+String(db.prepare("SELECT COALESCE(MAX(CAST(substr(number,4) AS INTEGER)),0)+1 AS n FROM contract_records WHERE tenant_id=? AND number LIKE 'CT-%'").get(u.tenant_id).n).padStart(4,'0');
  db.prepare(`INSERT INTO contract_records(id,tenant_id,number,party_kind,client_id,vendor_id,party_name,contract_type,subject,start_date,end_date,value_minor,auto_renew,notice_days,renewal_note,scope_baseline_id,owner_id,original_location,signed_for_company,signed_for_party,signed_on,status,created_by,created_at,updated_at,case_id,support_response_hours,warranty_days,renews_id,commercial_contract_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?)`)
    .run(contractId,u.tenant_id,number,f.party_kind,f.client_id,f.vendor_id,f.party_name,f.contract_type,f.subject,f.start_date,f.end_date,f.value_minor,f.auto_renew,f.notice_days,f.renewal_note,f.scope_baseline_id,f.owner_id,f.original_location,f.signed_for_company,f.signed_for_party,f.signed_on,u.id,time,time,f.case_id,f.support_response_hours,f.warranty_days,f.renews_id,f.commercial_contract_id);
  audit(db,u,'contract_record',contractId,'contract.registered',{}, {number,party_kind:f.party_kind,end_date:f.end_date,...(f.renews_id?{renews_id:f.renews_id}:{}),
    ...(f.case_id?{case_id:f.case_id}:{}),...(f.support_response_hours!==null?{support_response_hours:f.support_response_hours}:{}),...(f.warranty_days!==null?{warranty_days:f.warranty_days}:{}),...(f.commercial_contract_id?{commercial_contract_id:f.commercial_contract_id}:{})});
  return {id:contractId};
}
export function updateContract(db,supplied,contractId,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'contracts.register.manage'))fail(403,'not_permitted','تصحيح مسودة العقد لحامل تصريح إدارة سجل العقود');
  v.object(input,[...CONTRACT_FIELDS,'version']);
  const c=contractRow(db,u,contractId);
  if(c.status!=='draft')fail(409,'contract_in_force','العقد الساري لا يُعدَّل. التعديل ملحق مرقّم باعتماد مسمّى');
  v.version(input.version,c.version);
  const f=cleanContract(db,u,{...input,id:c.id},c.id);
  if(f.value_minor!==null&&f.value_minor<=0)fail(400,'value','قيمة العقد أكبر من صفر، أو اتركها فارغة');
  db.prepare(`UPDATE contract_records SET party_kind=?,client_id=?,vendor_id=?,party_name=?,contract_type=?,subject=?,start_date=?,end_date=?,value_minor=?,auto_renew=?,notice_days=?,renewal_note=?,scope_baseline_id=?,owner_id=?,original_location=?,signed_for_company=?,signed_for_party=?,signed_on=?,case_id=?,support_response_hours=?,warranty_days=?,renews_id=?,commercial_contract_id=?,version=version+1,updated_at=? WHERE id=?`)
    .run(f.party_kind,f.client_id,f.vendor_id,f.party_name,f.contract_type,f.subject,f.start_date,f.end_date,f.value_minor,f.auto_renew,f.notice_days,f.renewal_note,f.scope_baseline_id,f.owner_id,f.original_location,f.signed_for_company,f.signed_for_party,f.signed_on,f.case_id,f.support_response_hours,f.warranty_days,f.renews_id,f.commercial_contract_id,now(),c.id);
  audit(db,u,'contract_record',c.id,'contract.draft_edited',{end_date:c.end_date,value_minor:c.value_minor},{end_date:f.end_date,value_minor:f.value_minor});
  return {id:c.id};
}

/* ───── أفعال العقد ───── */
export function contractAction(db,supplied,contractId,action,input){
  writing(db);const u=actor(db,supplied);const {manage}=reach(db,u);
  const c=contractRow(db,u,contractId),settings=settingsRow(db,u.tenant_id),view=contractView(db,u,c,manage,settings);
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة العقد أو لحسابك');
  const time=now();
  if(action==='activate_contract'){
    v.object(input,['version','note']);v.version(input.version,c.version);
    const note=v.text(input.note,'إقرارك بملكية العقد ومطابقته للأصل الموقّع',1000,10);
    if(!c.signed_on)fail(409,'signature_missing','لا يسري سجل عقد بلا تاريخ توقيع. أكمل بيانات الأصل الموقّع أولًا');
    db.prepare("UPDATE contract_records SET status='active',activated_by=?,activated_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,c.id);
    audit(db,u,'contract_record',c.id,'contract.activated',{status:c.status},{status:'active'},note);
  }else if(action==='cancel_contract'){
    v.object(input,['version','note']);v.version(input.version,c.version);
    db.prepare("UPDATE contract_records SET status='cancelled',version=version+1,updated_at=? WHERE id=?").run(time,c.id);
    audit(db,u,'contract_record',c.id,'contract.cancelled',{status:c.status},{status:'cancelled'},v.text(input.note,'سبب إلغاء المسودة',1000,10));
  }else if(action==='terminate_contract'){
    v.object(input,['version','note']);v.version(input.version,c.version);
    const note=v.text(input.note,'سند الإنهاء ومرجع الإشعار',1500,10);
    db.prepare("UPDATE contract_records SET status='terminated',terminated_by=?,terminated_at=?,termination_note=?,version=version+1,updated_at=? WHERE id=?")
      .run(u.id,time,note,time,c.id);
    // الإنهاء يوقف ما بعده على صفقة العقد (الترحيل 182): جدولات الفوترة الدورية تنتهي بسببها، والمُطلِقات ترفض كل استحقاق ومخرج وتغيير
    // وجدولة جديدة. ما استُحق قبل الإنهاء يبقى كما هو ويُحصَّل في مساره؛ وصاحب الصفقة وفريق مشروعها يصلهم الخبر.
    const stopped=c.commercial_contract_id?stopDealOnTermination(db,u,c,note,time):null;
    audit(db,u,'contract_record',c.id,'contract.terminated',{status:c.status},{status:'terminated',...(stopped?{stopped}:{})},note);
  }else{
    v.object(input,['decision','notice_reference','note']);
    if(!Object.hasOwn(RENEWAL_DECISIONS,input.decision))fail(400,'decision','اختر القرار');
    // «التجديد» لعقد عميل قرارٌ تتابعه فرصة (P4-CRM-6): بلا فرصة تجديد ولا عقد تجديد مسجّل يبقى القرار سطرًا لا يتابعه أحد (ACC-10).
    if(input.decision==='renew'&&c.party_kind==='client'&&!view.renewal_opportunity&&!view.renewed_by){
      const client=db.prepare('SELECT code,owner_id FROM clients WHERE id=?').get(c.client_id);
      refuse(409,'renewal_opportunity_required',{what:`قرار «التجديد» على العقد ${c.number} يحتاج فرصة تجديد تتابعه`,
        missing:[{document:`فرصة تجديد مفتوحة من العقد ${c.number}`,why:'التجديد يُتابَع بالعقد الحالي وبعرضه الجديد منفصلًا، ونطاق العقد وأسعاره تنتقل للفرصة',owner:personName(db,client?.owner_id)??'مسؤول حساب العميل',owner_role:'account_manager',doc_key:'renewal_opportunity'}],
        next:'يفتح فريق حساب العميل فرصة التجديد من «خط الفرص» (عقود قرب نهايتها)، ثم سجّل القرار'});
    }
    const reference=input.notice_reference?v.text(input.notice_reference,'مرجع الإشعار المرسل',500,5):'';
    if(input.decision==='do_not_renew'&&!reference)fail(400,'notice_reference','الإشعار يُرسل خارج المنصة. اكتب مرجعه (رقم الخطاب أو البريد وتاريخه) حتى يُعتد بالقرار');
    db.prepare('INSERT INTO contract_renewal_decisions(id,tenant_id,contract_id,term_end_date,notice_deadline,decision,notice_reference,note,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,c.id,view.effective_end_date,view.notice_deadline,input.decision,reference,v.text(input.note,'أساس القرار',1500,10),u.id,time);
    audit(db,u,'contract_record',c.id,'contract.renewal_decided',{}, {decision:input.decision,term_end_date:view.effective_end_date});
  }
  return {id:c.id,action};
}

function stopDealOnTermination(db,u,c,note,time){
  const deal=db.prepare('SELECT k.case_id,c.owner_id,c.project_id,c.name FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id WHERE k.id=?').get(c.commercial_contract_id);
  if(!deal)return null;
  const reason=`انتهى العقد ${c.number} بإنهاء مسجّل: ${note}`.slice(0,1000),ended=[];
  for(const s of db.prepare("SELECT id,status,version FROM billing_schedules WHERE case_id=? AND status IN ('active','paused')").all(deal.case_id)){
    db.prepare("UPDATE billing_schedules SET status='ended',stopped_reason=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(reason,time,s.id,s.version);
    audit(db,u,'billing_schedule',s.id,'billing.end_schedule',{status:s.status},{status:'ended',contract_record_id:c.id},reason);
    ended.push(s.id);
  }
  const team=[deal.owner_id,...(deal.project_id?db.prepare('SELECT user_id FROM project_members WHERE project_id=?').all(deal.project_id).map(r=>r.user_id):[])];
  notifyMany(db,team,u.id,{kind:'contract_terminated',subjectKind:'commercial_case',subjectId:deal.case_id,title:`انتهى العقد ${c.number} — ${deal.name}`,
    body:'بعد الإنهاء ما يتقدّم مخرج ولا يُطلب تغيير ولا يُستحق مبلغ جديد على هذا الاتفاق. ما استُحق قبله يُحصَّل في مساره.'});
  return {case_id:deal.case_id,billing_schedules_ended:ended};
}

/* ───── الملاحق ───── */
export function recordAmendment(db,supplied,contractId,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'contracts.register.manage'))fail(403,'not_permitted','تسجيل الملاحق لحامل تصريح إدارة سجل العقود');
  v.object(input,['signed_on','subject','value_delta','new_end_date','original_location','approved_by']);
  const c=contractRow(db,u,contractId);
  if(c.status!=='active')fail(409,'invalid_state','الملحق يكون على عقد ساري');
  const amendments=amendmentRows(db,c.id),term=effective(c,amendments);
  const signedOn=v.date(input.signed_on);
  if(signedOn>riyadhToday())fail(400,'signed_on','تاريخ الملحق لا يكون في المستقبل');
  const delta=input.value_delta===undefined||input.value_delta===''||input.value_delta===null?0:amountMinor(input.value_delta,'أثر الملحق على القيمة',{signed:true});
  if(c.value_minor===null&&delta)fail(409,'value_unknown','العقد بلا قيمة مسجلة، فلا يُحسب أثر الملحق عليها. صحّح قيمة العقد قبل سريانه أو اترك الأثر صفرًا');
  if(c.value_minor!==null&&c.value_minor+amendments.filter(a=>a.confirmed_at).reduce((s,a)=>s+a.value_delta_minor,0)+delta<0)fail(400,'value_delta','الخصم يتجاوز قيمة العقد السارية');
  let newEnd=null;
  if(input.new_end_date){newEnd=v.date(input.new_end_date);if(newEnd<=term.end_date)fail(400,'new_end_date','المدة الجديدة بعد النهاية السارية، وإلا فلا أثر للملحق على المدة');}
  const approver=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.approved_by,u.tenant_id);
  if(!approver)fail(400,'approved_by','معتمد الملحق غير متاح');
  if(approver.id===u.id)fail(409,'separation_of_duties','من يسجّل الملحق لا يؤكد اعتماده');
  const amendmentId=id(),number=(amendments.at(-1)?.number??0)+1;
  db.prepare('INSERT INTO contract_amendments(id,tenant_id,contract_id,number,signed_on,subject,value_delta_minor,new_end_date,original_location,approved_by,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(amendmentId,u.tenant_id,c.id,number,signedOn,v.text(input.subject,'موضوع الملحق وأثره',1500,5),delta,newEnd,v.text(input.original_location,'مكان حفظ أصل الملحق الموقّع',500,5),approver.id,u.id,now());
  audit(db,u,'contract_amendment',amendmentId,'amendment.recorded',{}, {contract:c.number,number,value_delta_minor:delta,new_end_date:newEnd});
  return {id:amendmentId};
}
export function amendmentAction(db,supplied,amendmentId,action,input){
  writing(db);const u=actor(db,supplied);
  if(action!=='confirm_amendment')fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['note']);
  const a=typeof amendmentId==='string'&&db.prepare('SELECT * FROM contract_amendments WHERE id=? AND tenant_id=?').get(amendmentId,u.tenant_id);
  if(!a||a.confirmed_at||a.approved_by!==u.id)fail(404,'not_found','لا ملحق ينتظر تأكيدك');
  db.prepare('UPDATE contract_amendments SET confirmed_by=?,confirmed_at=?,confirmation_note=? WHERE id=?')
    .run(u.id,now(),v.text(input.note,'إقرارك باعتماد الملحق وما اطلعت عليه',1000,10),a.id);
  audit(db,u,'contract_amendment',a.id,'amendment.confirmed',{}, {contract_id:a.contract_id,number:a.number});
  return {id:a.id};
}

/* ───── بنود الالتزام ───── */
export function addObligation(db,supplied,contractId,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'contracts.register.manage'))fail(403,'not_permitted','إدخال بنود الالتزام لحامل تصريح إدارة سجل العقود');
  v.object(input,['category','title','clause_reference','detail','owner_id','cadence','first_due_date','evidence_expected']);
  const c=contractRow(db,u,contractId);
  if(c.status!=='active')fail(409,'invalid_state','البنود تُستخرج من عقد ساري');
  if(!Object.hasOwn(OBLIGATION_CATEGORIES,input.category))fail(400,'category','اختر نوع البند');
  if(!Object.hasOwn(CADENCES,input.cadence))fail(400,'cadence','اختر تكرار البند');
  const term=effective(c,amendmentRows(db,c.id)),first=v.date(input.first_due_date);
  if(first<c.start_date||first>term.end_date)fail(400,'first_due_date','أول استحقاق داخل مدة العقد السارية');
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك البند غير متاح');
  const title=v.text(input.title,'البند',200,5);
  if(db.prepare('SELECT 1 FROM contract_obligations WHERE contract_id=? AND title=?').get(c.id,title))fail(409,'duplicate_obligation','البند مسجل على هذا العقد');
  const obligationId=id(),time=now();
  db.prepare('INSERT INTO contract_obligations(id,tenant_id,contract_id,category,title,clause_reference,detail,owner_id,cadence,first_due_date,evidence_expected,entered_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(obligationId,u.tenant_id,c.id,input.category,title,v.text(input.clause_reference,'رقم البند في العقد',120,1),input.detail?v.text(input.detail,'نص البند كما قرأته',2000,5):'',owner.id,input.cadence,first,v.text(input.evidence_expected,'دليل التنفيذ المتوقع',1000,5),u.id,time,time);
  audit(db,u,'contract_obligation',obligationId,'obligation.entered',{}, {contract:c.number,title,cadence:input.cadence});
  return {id:obligationId};
}
export function obligationAction(db,supplied,obligationId,action,input){
  writing(db);const u=actor(db,supplied);const {manage}=reach(db,u);
  const o=typeof obligationId==='string'&&db.prepare('SELECT * FROM contract_obligations WHERE id=? AND tenant_id=?').get(obligationId,u.tenant_id);
  if(!o)fail(404,'not_found','البند غير متاح');
  const c=contractRow(db,u,o.contract_id),settings=settingsRow(db,u.tenant_id);
  const term=effective(c,amendmentRows(db,c.id)),current=obligationView(db,u,o,c,term,manage,settings?settings.obligation_lead_days:null);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة البند أو لحسابك');
  const time=now();
  if(action==='complete_obligation'){
    v.object(input,['evidence_reference']);
    db.prepare('INSERT INTO contract_obligation_fulfilments(id,tenant_id,obligation_id,period,due_date,completed_by,completed_at,evidence_reference) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,o.id,current.current_due_date,current.current_due_date,u.id,time,v.text(input.evidence_reference,'دليل التنفيذ ومكان حفظه',1000,5));
  }else if(action==='verify_obligation'){
    v.object(input,['note']);
    db.prepare('UPDATE contract_obligation_fulfilments SET verified_by=?,verified_at=?,verification_note=? WHERE obligation_id=? AND period=?')
      .run(u.id,time,v.text(input.note,'ما الذي اطلعت عليه',1000,5),o.id,current.verifiable_period);
  }else{
    v.object(input,['version','note']);v.version(input.version,o.version);v.text(input.note,'السبب',1000,5);
    db.prepare('UPDATE contract_obligations SET active=?,version=version+1,updated_at=? WHERE id=?').run(action==='activate_obligation'?1:0,time,o.id);
  }
  audit(db,u,'contract_obligation',o.id,'obligation.'+action,{}, {contract_id:c.id,period:current.current_due_date??current.verifiable_period});
  return {id:o.id,action};
}

/* ───── صندوق «بانتظار قراري» ───── */
// الشكل الذي يقرأه app/inbox.mjs: شجرة كائنات، كل عقدة تحمل actions يعرفها الصندوق، وtitle وcreated_at لحساب التقادم.
// مفاتيح المجموعات مقصودة: contracts→«عقد» وobligations→«التزام دوري» في خريطة KINDS هناك.
export function contractAlerts(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'contracts.register.manage'),view=manage||can(db,u,'contracts.register.view');
  const settings=settingsRow(db,u.tenant_id);
  const rows=db.prepare(`SELECT * FROM contract_records c WHERE c.tenant_id=? AND (?=1 OR c.owner_id=?
      OR EXISTS(SELECT 1 FROM contract_obligations o WHERE o.contract_id=c.id AND o.owner_id=?)
      OR EXISTS(SELECT 1 FROM contract_amendments a WHERE a.contract_id=c.id AND a.approved_by=?))`).all(u.tenant_id,view?1:0,u.id,u.id,u.id);
  const contracts=[],amendments=[],obligations=[];
  for(const row of rows){
    const c=contractView(db,u,row,manage,settings);
    if(c.alert&&c.actions.includes('decide_renewal'))contracts.push({id:c.id,title:`${c.number} · ${c.alert.title}`,context:`${c.party_kind_name}: ${c.party_display} — ${c.subject}`,
      due_date:c.alert.due_date,created_at:c.alert.opened_on,priority:c.alert.priority,actions:['decide_renewal']});
    for(const a of c.amendments)if(a.actions.includes('confirm_amendment'))
      amendments.push({id:a.id,title:`ملحق ${a.number} على ${c.number} — ${a.subject}`,created_at:a.recorded_at,actions:['confirm_amendment']});
    for(const o of c.obligations){
      if(o.needs_owner)obligations.push({id:o.id,title:`${o.title} — ${c.number}`,due_date:o.current_due_date,created_at:o.current_due_date,actions:['complete_obligation']});
      else if(o.actions.includes('verify_obligation'))obligations.push({id:o.id,title:`تحقق من دليل: ${o.title} — ${c.number}`,due_date:o.verifiable_period,created_at:o.verifiable_period,actions:['verify_obligation']});
    }
  }
  contracts.sort((a,b)=>a.priority-b.priority||a.due_date.localeCompare(b.due_date));
  return {contracts,amendments,obligations,alerts_configured:!!settings,
    note:settings?'تنبيه الإشعار بعدم التجديد أهم من تنبيه الانتهاء: تفويته يجدّد العقد رغمًا عن الشركة.'
      :'لم تُضبط مهل التنبيه بعد، فلا تنبيهات انتهاء ولا تجديد. يضبطها حامل تصريح إدارة سجل العقود بسندها.'};
}
