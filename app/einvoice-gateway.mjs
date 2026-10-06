import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { verifyInvoiceChain } from './invoices.mjs';
import { INTEGRATION_STATUS, integrationStatus } from './integration-readiness.mjs';

// طبقة قابلة للتوصيل للفوترة الإلكترونية. المنصة **غير مربوطة** ولا ترسل شيئًا إلى أي جهة اليوم،
// والمبني هنا نافع بذاته: عدّاد لا يُعاد ضبطه، وأرشيف لا يُعدَّل، وطابور يحمل سبب كل حالة.
// الربط لاحقًا = مزوّد جديد يحقق `EInvoiceGateway` ويُحقن بـ`setGateway`، لا إعادة بناء لدورة الفاتورة.
export const NOT_CONNECTED='غير مربوط. المرحلة الأولى فقط. الربط يحتاج قرار المالك واعتماد المختص الضريبي.';
export const SECRETS_NOTE='لا مفتاح خاص ولا شهادة ولا سر في قاعدة البيانات ولا في أي ملف من ملفات المنصة. مكانها خزنة أسرار يقررها المالك، والمنصة لا تقرأ .env ولا تعرض أي سر.';
export const FORMAT_NOTE='صيغة الأرشيف `platform-json-v1` صيغة المنصة نفسها، وليست مواصفة جهة. المنصة لا تخترع مواصفة ولا تدّعي مطابقتها.';
export const STATUS_NAMES={queued:'بانتظار الإرسال',sent:'أُرسل',accepted:'قُبل',accepted_with_warnings:'قُبل بتحذير',rejected:'رُفض',failed:'تعذّر'};
export const OUTCOME_NAMES={refused:'رفض المزوّد الاستدعاء',pending:'قيد المعالجة لدى المزوّد',accepted:'قُبل',accepted_with_warnings:'قُبل بتحذير',rejected:'رُفض',failed:'تعذّر'};
export const CHANNELS=[['clearance','تصديق قبل التسليم (submitForClearance)'],['reporting','إبلاغ بعد الإصدار (reportSimplified)']].map(([key,name])=>({key,name}));
export const BUYER_FIELDS=[['vat_number','الرقم الضريبي للمشتري'],['building','رقم المبنى'],['street','الشارع'],['district','الحي'],['city','المدينة'],['postal_code','الرمز البريدي']].map(([key,name])=>({key,name}));
const BUYER_NAMES=new Map(BUYER_FIELDS.map(f=>[f.key,f.name]));

// سلوك الرفض: مقترح لا قرار. الرقم المتسلسل لا يُعاد استخدامه والعدّاد لا يرجع للوراء — هذا مفروض في SQL —
// والتصحيح يكون بمستند جديد. حدود هذا السلوك نظاميًا **تحتاج تأكيد المختص الضريبي** قبل اعتماده.
export const REJECTION_POLICY={
  status:'proposed',
  needs:'يحتاج تأكيد المختص الضريبي',
  enforced_today:['الرقم المتسلسل المُعطى لمستند صادر لا يُسحب ولا يُعاد استخدامه (محفّز einvoice_sequence_monotonic)','العدّاد لا يرجع للوراء ولا يُعاد ضبطه (محفّز einvoice_counter_never_resets)','المستند الصادر لا يُعدَّل ولا يُحذف، والتصحيح بإشعار دائن'],
  proposal:'إذا رُفض مستند صادر من جهة خارجية بعد الربط: يبقى المستند ورقمه وحلقته في السلسلة كما هما، وتُغلق محاولته بحالة «رُفض» وسببها المكتوب، ويُصحَّح الأثر بإشعار دائن ثم فاتورة جديدة تأخذ الرقم التالي. لا تُترك فجوة ولا يُعاد ترقيم شيء.',
  open_question:'هل يقبل المختص الضريبي أن يبقى الرقم مستهلكًا لمستند مرفوض، أم يلزم مسار آخر؟ لم يُحسم، ولم تُبنَ عليه أي آلية إلغاء.'};

/* ───── العقد المجرّد والمزوّد الافتراضي ───── */
// أي مزوّد مستقبلي يحقق هذه الدوال الثلاث ولا شيء غيرها. لا مفاتيح ولا شهادات ولا عناوين في الكود.
export class EInvoiceGateway {
  constructor(name='gateway'){this.name=name;}
  async submitForClearance(document){return this.unavailable('submitForClearance',document);}
  async reportSimplified(document){return this.unavailable('reportSimplified',document);}
  async statusOf(reference){return this.unavailable('statusOf',reference);}
  async unavailable(operation){return {outcome:'refused',reference:'',message:`${NOT_CONNECTED} الاستدعاء ${operation} لم يُنفَّذ ولم يُرسل شيء.`};}
}
// المزوّد الافتراضي الوحيد: يرفض كل استدعاء برسالة واضحة، والمحاولة تُسجَّل كاملة في einvoice_attempts.
export class DisconnectedGateway extends EInvoiceGateway {
  constructor(){super('disconnected');}
}
const DISCONNECTED=new DisconnectedGateway();
let injected=null;
// للاختبارات فقط: حقن مزوّد بديل، على نمط setProvider في app/ai.mjs.
export function setGateway(provider){injected=provider??null;}
export function gateway(){return injected??DISCONNECTED;}

/* ───── أدوات نقية ───── */
// تراجع أسي: خمس دقائق تتضاعف حتى سقف يوم كامل. ليست مهلة نظامية، بل تباعد محاولات تشغيلي.
export const BACKOFF_BASE_MINUTES=5,BACKOFF_CAP_MINUTES=1440;
export function backoffMinutes(attempt){
  if(!Number.isInteger(attempt)||attempt<1)return BACKOFF_BASE_MINUTES;
  return Math.min(BACKOFF_CAP_MINUTES,BACKOFF_BASE_MINUTES*2**Math.min(attempt-1,20));
}
const nextAttemptAt=(attempt,from=Date.now())=>new Date(from+backoffMinutes(attempt)*60000).toISOString();
// ما ينقص المشتري من بيانات. المنصة لا تعرف حدود ما يلزم لكل نوع فاتورة، فتعرض النقص ولا تحكم.
export function buyerGaps(buyer){
  const value=typeof buyer==='string'?JSON.parse(buyer):buyer??{},address=value.address??{},gaps=[];
  if(!value.vat_number)gaps.push('vat_number');
  for(const key of ['building','street','district','city','postal_code'])if(!String(address[key]??'').trim())gaps.push(key);
  return gaps;
}
export const gapNames=gaps=>gaps.map(key=>BUYER_NAMES.get(key)??key);

/* ───── الفاعل والصلاحية ───── */
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function permitted(db,u){if(!can(db,u,'einvoice.manage'))fail(403,'not_permitted','لا يوجد تصريح لشاشة الفوترة الإلكترونية. اطلبه من مسؤول الصلاحيات');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const id=()=>randomUUID();
const caseOf=(db,documentId)=>db.prepare('SELECT c.case_id FROM tax_invoices t JOIN ar_claims c ON c.id=t.claim_id WHERE t.id=?').get(documentId)?.case_id??null;
const overrideFor=(db,tenantId,caseId)=>db.prepare('SELECT o.*,x.name AS recorded_by_name FROM einvoice_buyer_overrides o JOIN users x ON x.id=o.recorded_by WHERE o.tenant_id=? AND o.case_id=? ORDER BY o.created_at DESC LIMIT 1').get(tenantId,caseId)??null;

function submissionRow(db,u,submissionId){
  const row=typeof submissionId==='string'&&db.prepare('SELECT * FROM einvoice_submissions WHERE id=? AND tenant_id=?').get(submissionId,u.tenant_id);
  if(!row)fail(404,'not_found','سجل الإرسال غير متاح');
  return row;
}
function actionsFor(u,row){
  const out=[];
  if(['accepted','accepted_with_warnings','rejected'].includes(row.status))return out;
  if(!row.channel)out.push('assign_channel');
  if(row.channel&&['queued','failed'].includes(row.status)&&row.channel_by!==u.id)out.push('attempt_submission');
  if(row.status==='sent'&&row.provider_reference&&row.channel_by!==u.id)out.push('refresh_status');
  return out;
}
function submissionView(db,u,row){
  const document=db.prepare('SELECT number,kind,total_minor,issued_at FROM tax_invoices WHERE id=?').get(row.document_id)??{};
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const gaps=buyerGaps(db.prepare('SELECT buyer FROM tax_invoices WHERE id=?').get(row.document_id)?.buyer??'{}');
  const caseId=caseOf(db,row.document_id),override=caseId?overrideFor(db,row.tenant_id,caseId):null;
  return {...row,number:document.number,kind:document.kind,total_minor:document.total_minor,issued_at:document.issued_at,
    status_name:STATUS_NAMES[row.status],channel_name:CHANNELS.find(c=>c.key===row.channel)?.name??'لم تُحدد بعد',
    channel_by_name:name(row.channel_by),last_attempt_by_name:name(row.last_attempt_by),
    buyer_gaps:gapNames(gaps),override_reason:gaps.length?override?.reason??null:null,
    attempts_log:db.prepare('SELECT a.*,x.name AS actor_name FROM einvoice_attempts a JOIN users x ON x.id=a.actor_id WHERE a.submission_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 20').all(row.id)
      .map(a=>({...a,outcome_name:OUTCOME_NAMES[a.outcome]??a.outcome})),
    actions:actionsFor(u,row)};
}

/* ───── فحص بيانات المشتري قبل الإصدار ───── */
// حارس يُستدعى قبل إعداد فاتورة لعميل. المتطلب يخص نوعًا من الفواتير دون غيره ولا نعرف حدوده يقينًا،
// فالمنع قابل للتجاوز بتجاوز موثّق بسببه، ولا يُطبَّق صامتًا.
export function buyerReadiness(db,supplied,caseId){
  const u=permitted(db,actor(db,supplied));
  const profile=db.prepare('SELECT * FROM customer_tax_profiles WHERE case_id=? AND tenant_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(caseId,u.tenant_id);
  if(!profile)return {case_id:caseId,ready:false,gaps:['vat_number'],gap_names:['لا بيانات ضريبية مسجّلة للعميل'],override:null,note:'سجّل البيانات الضريبية للعميل قبل إعداد فاتورته.'};
  const gaps=buyerGaps({vat_number:profile.vat_number,address:JSON.parse(profile.address)}),override=gaps.length?overrideFor(db,u.tenant_id,caseId):null;
  return {case_id:caseId,ready:!gaps.length,gaps,gap_names:gapNames(gaps),
    override:override?{reason:override.reason,recorded_by_name:override.recorded_by_name,created_at:override.created_at,missing:JSON.parse(override.missing)}:null,
    note:gaps.length?(override?'النقص قائم ومغطى بتجاوز موثّق مسجّل باسم صاحبه.':'بيانات المشتري ناقصة. أكملها أو سجّل تجاوزًا موثّقًا بسببه.'):'بيانات المشتري مكتملة بحسب ما تعرفه المنصة.'};
}
// حارس رمي: يصلح لربطه لاحقًا بمسار إعداد الفاتورة دون تعديل دورة الفاتورة نفسها.
export function assertBuyerReady(db,supplied,caseId){
  const state=buyerReadiness(db,supplied,caseId);
  if(!state.ready&&!state.override)fail(409,'buyer_incomplete',`بيانات المشتري ناقصة: ${state.gap_names.join('، ')}. أكملها أو سجّل تجاوزًا موثّقًا بسببه`);
  return state;
}

/* ───── اللوحة ───── */
export function einvoiceBoard(db,supplied){
  const u=permitted(db,actor(db,supplied)),provider=gateway();
  const submissions=db.prepare('SELECT * FROM einvoice_submissions WHERE tenant_id=? ORDER BY created_at DESC,rowid DESC').all(u.tenant_id).map(row=>submissionView(db,u,row));
  const counters=db.prepare('SELECT c.*,t.number FROM einvoice_counters c LEFT JOIN tax_invoices t ON t.id=c.last_document_id WHERE c.tenant_id=? ORDER BY c.kind').all(u.tenant_id)
    .map(c=>({...c,kind_name:c.kind==='invoice'?'فاتورة':'إشعار دائن'}));
  const archive=db.prepare('SELECT document_id,kind,number,sequence,chain_index,issued_at,format,document_hash,previous_hash,original_document_id FROM einvoice_archive WHERE tenant_id=? ORDER BY chain_index DESC LIMIT 30').all(u.tenant_id);
  const customers=db.prepare('SELECT DISTINCT k.id,k.name FROM commercial_cases k JOIN customer_tax_profiles p ON p.case_id=k.id WHERE k.tenant_id=? ORDER BY k.name').all(u.tenant_id)
    .map(k=>({id:k.id,name:k.name,...buyerReadiness(db,u,k.id)}));
  const counts=Object.fromEntries(Object.keys(STATUS_NAMES).map(key=>[key,submissions.filter(s=>s.status===key).length]));
  return {user_id:u.id,today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date()),
    connected:false,state:'disconnected',provider:provider.name,
    // الحالة بمفردات العقد من خريطة التكاملات نفسها: الفوترة الرسمية محاكاة محلية حتى يوجد وصول معتمد، ولا تُصنع استجابة نجاح.
    integration:{status:integrationStatus('zatca'),status_name:INTEGRATION_STATUS[integrationStatus('zatca')],
      basis:'الفاتورة تُصدر وتُرقَّم وتُسلسل وتُؤرشف هنا وتُطبع بعلامة «داخلية — ما تبلّغت»، ولا يُرسل شيء لأي جهة: المزوّد الافتراضي يرفض كل استدعاء ويسجّله. «متصل» يحتاج دليلًا مستقلًا على اتصال حي'},
    disclaimer:NOT_CONNECTED,
    note:'الطابور والأرشيف والعدّاد تعمل اليوم وتنفع اليوم. لا شيء يُرسل إلى أي جهة، والمزوّد الافتراضي يرفض كل استدعاء ويسجّله.',
    secrets_note:SECRETS_NOTE,format_note:FORMAT_NOTE,
    channels:CHANNELS,status_names:STATUS_NAMES,buyer_fields:BUYER_FIELDS,
    counters,archive,archive_count:db.prepare('SELECT COUNT(*) AS n FROM einvoice_archive WHERE tenant_id=?').get(u.tenant_id).n,
    chain_valid:verifyInvoiceChain(db,u.tenant_id),
    submissions,counts,customers,
    rejection_policy:REJECTION_POLICY,
    limits:['لا مزوّد حقيقي ولا مفاتيح ولا شهادات في الكود إطلاقًا.','القناة (تصديق أو إبلاغ) يحددها إنسان بسببه؛ المنصة لا تستنتج نوع الفاتورة.','من صنّف القناة لا يُجري المحاولة — فصل مهام مفروض في SQL.','الإشعار المدين غير مبني في المنصة أصلًا؛ المستندات نوعان فقط: فاتورة وإشعار دائن.']};
}

/* ───── الكتابة ───── */
export function assignChannel(db,supplied,submissionId,input){
  writing(db);
  const u=permitted(db,actor(db,supplied));
  v.object(input,['version','channel','reason']);
  const row=submissionRow(db,u,submissionId);
  v.version(input.version,row.version);
  if(!actionsFor(u,row).includes('assign_channel'))fail(409,'channel_set','القناة محددة سلفًا أو السجل مقفل؛ لا تُغيَّر بعد تحديدها');
  if(!CHANNELS.some(c=>c.key===input.channel))fail(400,'channel','اختر القناة كما حددها المختص');
  const reason=v.text(input.reason,'أساس تصنيف المستند',1000,10),time=now();
  db.prepare('UPDATE einvoice_submissions SET channel=?,channel_reason=?,channel_by=?,channel_at=?,reason=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .run(input.channel,reason,u.id,time,`صُنّف على قناة ${input.channel} ولم يُرسل بعد: ${reason}`.slice(0,900),time,row.id,row.version);
  audit(db,u,'einvoice_submission',row.id,'einvoice.channel_assigned',{channel:row.channel},{channel:input.channel},reason);
  return submissionView(db,u,submissionRow(db,u,row.id));
}

export function recordBuyerOverride(db,supplied,input){
  writing(db);
  const u=permitted(db,actor(db,supplied));
  v.object(input,['case_id','reason']);
  const customer=typeof input.case_id==='string'&&db.prepare('SELECT id,name FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id,u.tenant_id);
  if(!customer)fail(404,'not_found','العميل غير متاح');
  const state=buyerReadiness(db,u,customer.id);
  if(state.ready)fail(409,'buyer_complete','بيانات هذا المشتري مكتملة؛ لا حاجة لتجاوز');
  const reason=v.text(input.reason,'سبب التجاوز ومن قرره',2000,20),overrideId=id();
  db.prepare('INSERT INTO einvoice_buyer_overrides(id,tenant_id,case_id,missing,reason,recorded_by,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(overrideId,u.tenant_id,customer.id,JSON.stringify(state.gaps),reason,u.id,now());
  audit(db,u,'einvoice_override',overrideId,'einvoice.buyer_override',{}, {case_id:customer.id,missing:state.gaps},reason);
  return {id:overrideId,case_id:customer.id,missing:state.gaps};
}

const OUTCOMES=['refused','pending','accepted','accepted_with_warnings','rejected','failed'];
const STATUS_OF={refused:'queued',pending:'sent',accepted:'accepted',accepted_with_warnings:'accepted_with_warnings',rejected:'rejected',failed:'failed'};
function normalise(result){
  const outcome=OUTCOMES.includes(result?.outcome)?result.outcome:'failed';
  const message=typeof result?.message==='string'&&result.message.trim().length>=5?result.message.trim().slice(0,1000):'لم يُرجع المزوّد رسالة مفهومة.';
  const reference=typeof result?.reference==='string'?result.reference.trim().slice(0,200):'';
  return {outcome,message,reference};
}

// محاولة إرسال. اليوم لا ترسل شيئًا: المزوّد الافتراضي يرفض، وتُسجَّل المحاولة وسببها ويُحسب موعد التالية.
export async function attemptSubmission(db,supplied,submissionId,input,transaction){
  const u=permitted(db,actor(db,supplied));
  v.object(input,['version','note']);
  const row=submissionRow(db,u,submissionId);
  v.version(input.version,row.version);
  if(!actionsFor(u,row).includes('attempt_submission'))fail(409,'attempt_denied','المحاولة غير متاحة: حدد القناة أولًا، ومن صنّف القناة لا يُجري المحاولة');
  const note=v.text(input.note,'ما الذي تحاوله ولماذا الآن',1000,10);
  const document=db.prepare('SELECT * FROM einvoice_archive WHERE document_id=? AND tenant_id=?').get(row.document_id,u.tenant_id);
  if(!document)fail(409,'not_archived','المستند غير مؤرشف؛ لا يُرسل ما لا نسخة محفوظة منه');
  const caseId=caseOf(db,row.document_id),gaps=buyerGaps(JSON.parse(document.payload).buyer);
  if(gaps.length&&!overrideFor(db,u.tenant_id,caseId))fail(409,'buyer_incomplete',`بيانات المشتري ناقصة: ${gapNames(gaps).join('، ')}. أكملها أو سجّل تجاوزًا موثّقًا بسببه`);
  const provider=gateway(),operation=row.channel==='clearance'?'submitForClearance':'reportSimplified',attemptNo=row.attempts+1;
  const payload={id:document.document_id,kind:document.kind,number:document.number,format:document.format,document_hash:document.document_hash,previous_hash:document.previous_hash,payload:JSON.parse(document.payload)};
  let result;
  try{result=await provider[operation](payload);}
  catch(error){result={outcome:'failed',message:`تعذّر الاستدعاء: ${String(error?.message??'خطأ غير معروف').slice(0,300)}`};}
  const {outcome,message,reference}=normalise(result),status=STATUS_OF[outcome],time=now();
  const retrying=['queued','failed'].includes(status),next=retrying?nextAttemptAt(attemptNo):null;
  const reason=`${OUTCOME_NAMES[outcome]} (${provider.name}/${operation}، المحاولة ${attemptNo}): ${message}${retrying?` — المحاولة التالية بعد ${backoffMinutes(attemptNo)} دقيقة.`:''}`.slice(0,900);
  transaction(db,()=>{
    db.prepare('INSERT INTO einvoice_attempts(id,tenant_id,submission_id,attempt_no,operation,provider,outcome,message,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,row.id,attemptNo,operation,provider.name,outcome,`${message} — ${note}`.slice(0,1000),u.id,time);
    // آلة الحالات في SQL لا تسمح بالقفز من «تعذّر» إلى نتيجة: السجل يعود للطابور أولًا بسببه، ثم تُكتب نتيجة المحاولة.
    let version=row.version;
    if(row.status==='failed'){
      db.prepare("UPDATE einvoice_submissions SET status='queued',reason=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(`أُعيد للطابور لمحاولة جديدة بعد تعذّر سابق: ${note}`.slice(0,900),time,row.id,version);
      version++;
    }
    db.prepare('UPDATE einvoice_submissions SET status=?,attempts=?,last_attempt_at=?,last_attempt_by=?,next_attempt_at=?,provider=?,provider_reference=?,reason=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .run(status,attemptNo,time,u.id,next,provider.name,reference||row.provider_reference,reason,time,row.id,version);
    audit(db,u,'einvoice_submission',row.id,'einvoice.attempted',{status:row.status,attempts:row.attempts},{status,attempts:attemptNo,outcome,provider:provider.name},note);
  });
  return submissionView(db,u,submissionRow(db,u,row.id));
}

// استعلام حالة مستند سبق إرساله. لا يزيد عدّاد المحاولات، ويُسجَّل كغيره.
export async function refreshSubmissionStatus(db,supplied,submissionId,input,transaction){
  const u=permitted(db,actor(db,supplied));
  v.object(input,['version','note']);
  const row=submissionRow(db,u,submissionId);
  v.version(input.version,row.version);
  if(!actionsFor(u,row).includes('refresh_status'))fail(409,'status_denied','استعلام الحالة متاح لمستند أُرسل وله مرجع لدى المزوّد');
  const note=v.text(input.note,'سبب الاستعلام',1000,10),provider=gateway();
  let result;
  try{result=await provider.statusOf(row.provider_reference);}
  catch(error){result={outcome:'failed',message:`تعذّر الاستعلام: ${String(error?.message??'خطأ غير معروف').slice(0,300)}`};}
  const {outcome,message,reference}=normalise(result),time=now();
  // الرفض لا يُغيّر حالة سجل أُرسل: يبقى «أُرسل» وتُسجَّل المحاولة وسببها.
  const status=outcome==='refused'?row.status:STATUS_OF[outcome];
  const reason=`استعلام الحالة (${provider.name}): ${OUTCOME_NAMES[outcome]} — ${message}`.slice(0,900);
  transaction(db,()=>{
    db.prepare('INSERT INTO einvoice_attempts(id,tenant_id,submission_id,attempt_no,operation,provider,outcome,message,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,row.id,Math.max(row.attempts,1),'statusOf',provider.name,outcome,`${message} — ${note}`.slice(0,1000),u.id,time);
    if(status!==row.status)db.prepare('UPDATE einvoice_submissions SET status=?,provider_reference=?,next_attempt_at=NULL,reason=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .run(status,reference||row.provider_reference,reason,time,row.id,row.version);
    audit(db,u,'einvoice_submission',row.id,'einvoice.status_checked',{status:row.status},{status,outcome},note);
  });
  return submissionView(db,u,submissionRow(db,u,row.id));
}
