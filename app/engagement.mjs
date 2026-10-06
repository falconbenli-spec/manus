import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { can } from './access.mjs';
import { notifySubject } from './notices.mjs';

// الارتباط: استبيان النبض وeNPS، والتقدير بين الزملاء، والإعلانات الداخلية وتقويم الفعاليات.
//
// القاعدة الحاكمة للاستبيان، وهي قيد تصميمي لا ملاحظة: الشركة من 30 إلى 60 موظفًا وأقسامها من 3 إلى 6 أشخاص،
// فأي تقسيم للنتائج حسب القسم يكشف صاحب الرأي. لذلك لا تقبل أي دالة هنا معامل تقسيم أو تصفية أصلًا:
// المنع في بنية الاستعلام نفسه، لا في تحقق يمكن نسيانه.
export const QUESTION_KINDS={scale:'مقياس من 1 (أرفض بشدة) إلى 5 (أوافق بشدة)',enps:'ترشيح الشركة للعمل من 0 إلى 10 (eNPS)',comment:'تعليق حر'};
export const VISIBILITY={public:'علنية في الموجز',private:'خاصة بينك وبين زميلك'};
export const AUDIENCE={all:'كل الموظفين',department:'إدارة محددة'};
const SCALE_MAX=5,ENPS_MAX=10,MAX_QUESTIONS=15;
// أدنى حد للمستجيبين يقبله الكود وقاعدة البيانات (الترحيل 091): باثنين أو ثلاثة يكشف من شارك إجابةَ غيره بطرح إجابته.
export const MIN_RESPONDENTS_FLOOR=5;
const SIGNATURES=[['application/pdf',Buffer.from('%PDF-')],['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/jpeg',Buffer.from([0xFF,0xD8,0xFF])]];

export const PULSE_NOTE='النتائج على مستوى الشركة فقط لحماية سرية من يشارك في شركة بهذا الحجم. لا تقسيم حسب القسم ولا الإدارة ولا أي مجموعة، ولا مقارنة بمعايير قطاعية — لا نملك بياناتها ولا نخترعها. إجابتك تُخزَّن بلا أي مفتاح يربطها باسمك؛ يُسجَّل أنك شاركت في جدول منفصل حتى لا تُسأل مرتين، لا أكثر.';
export const PULSE_COMMENT_WARNING='التعليق الحر قد يكشف كاتبه من أسلوبه أو من تفصيلة يذكرها، في شركة بهذا الحجم. اكتب ما ترضى أن يُقرأ دون أن تُنسب إليه نسبة مؤكدة. ولا يُجرى على التعليقات أي تحليل مشاعر ولا نموذج لغوي: تُعرض كما كُتبت لمن له التصريح.';
export const RECOGNITION_NOTE='التقدير بلا نقاط ولا لوحة صدارة ولا ترتيب: المسابقة تفقده معناه وتحوله إلى أداة ضغط. ولا يُحتسب آليًا في تقييم الأداء؛ لصاحبه أن يعرضه دليلًا إن شاء. القيم المؤسسية هنا يعرّفها صاحب الإجراء بسندها، ولا تُخترع في الكود.';
export const ANNOUNCEMENT_NOTE='الإشعار داخل المنصة فقط. لا بريد إلكتروني: لا مزوّد بريد مربوط بعد، فمن لا يفتح المنصة لا يصله شيء. إقرار القراءة يُسجَّل باسم صاحبه ووقته لما يستوجبه فقط؛ الإعلان العادي لا يُتتبع من قرأه.';

const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const actor=actorOrRefuse;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');}
function manager(db,u,message){if(!can(db,u,'hr.survey.manage'))fail(403,'not_permitted',message);}
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const dateAfter=(value,label,floor)=>{const d=v.date(value);if(d<floor)fail(400,label,'التاريخ اليوم أو بعده');return d;};

/* ————————————————— أ. استبيان النبض وeNPS ————————————————— */

// الحد الأدنى للمستجيبين إعداد مؤرّخ يدخله مدير الموارد البشرية بسنده؛ لا قيمة افتراضية في الكود.
// بلا إعداد سارٍ لا تُفتح دورة أصلًا: وعد السرية يسبق جمع الإجابات ولا يُقرر بعده.
function privacyInForce(db,u,on=today()){
  return db.prepare('SELECT * FROM survey_privacy_settings WHERE tenant_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(u.tenant_id,on)??null;
}
export function setSurveyPrivacy(db,supplied,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'تحديد الحد الأدنى للمستجيبين لمدير الموارد البشرية');
  v.object(input,['min_respondents','effective_from','basis']);
  const minimum=Number(input.min_respondents);
  if(!Number.isInteger(minimum)||minimum<MIN_RESPONDENTS_FLOOR||minimum>500)fail(400,'min_respondents',`الحد الأدنى رقم صحيح ما يقل عن ${MIN_RESPONDENTS_FLOOR}: بأقل منه يطرح المشارك إجابته فينكشف جواب غيره`);
  // خفض الحد بأثر رجعي يكشف نتائج جُمعت بوعد أعلى؛ السريان اليوم أو بعده فقط.
  const effective=dateAfter(input.effective_from,'effective_from',today());
  const basis=v.text(input.basis,'سند القرار ومن قرره',600,10);
  if(db.prepare('SELECT 1 FROM survey_privacy_settings WHERE tenant_id=? AND effective_from=?').get(u.tenant_id,effective))fail(409,'duplicate_setting','فيه إعداد بنفس تاريخ السريان');
  const settingId=id();
  db.prepare('INSERT INTO survey_privacy_settings(id,tenant_id,min_respondents,effective_from,basis,set_by,created_at) VALUES(?,?,?,?,?,?,?)').run(settingId,u.tenant_id,minimum,effective,basis,u.id,now());
  audit(db,u,'survey_privacy',settingId,'survey.privacy_set',{},{min_respondents:minimum,effective_from:effective},basis);
  return {id:settingId};
}

function readQuestions(input){
  const rows=input.questions;
  if(!Array.isArray(rows)||!rows.length||rows.length>MAX_QUESTIONS)fail(400,'questions',`أسئلة الدورة من سؤال واحد لين ${MAX_QUESTIONS}`);
  const clean=rows.map((q,index)=>{
    if(!q||typeof q!=='object'||Array.isArray(q))fail(400,'questions','صيغة السؤال مو صحيحة');
    v.object(q,['kind','prompt']);
    if(!Object.hasOwn(QUESTION_KINDS,q.kind))fail(400,'kind','نوع السؤال مو صحيح');
    return {position:index+1,kind:q.kind,prompt:v.text(q.prompt,'نص السؤال',400,5)};
  });
  if(clean.filter(q=>q.kind==='enps').length>1)fail(400,'questions','سؤال eNPS واحد في الدورة وبس');
  return clean;
}
function writeQuestions(db,u,cycleId,questions){
  db.prepare('DELETE FROM pulse_questions WHERE cycle_id=? AND tenant_id=?').run(cycleId,u.tenant_id);
  for(const q of questions)db.prepare('INSERT INTO pulse_questions(id,tenant_id,cycle_id,position,kind,prompt) VALUES(?,?,?,?,?,?)').run(id(),u.tenant_id,cycleId,q.position,q.kind,q.prompt);
}
const cycleRow=(db,u,cycleId)=>(typeof cycleId==='string'?db.prepare('SELECT * FROM pulse_cycles WHERE id=? AND tenant_id=?').get(cycleId,u.tenant_id):null)??fail(404,'not_found','ما لقينا الدورة هذي');

export function createCycle(db,supplied,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'إعداد دورات النبض لمن يدير الاستبيانات');
  v.object(input,['title','purpose','opens_on','closes_on','questions']);
  const questions=readQuestions(input),opens=dateAfter(input.opens_on,'opens_on',today()),closes=v.date(input.closes_on);
  if(closes<opens)fail(400,'closes_on','تاريخ الإغلاق قبل تاريخ الفتح');
  const cycleId=id(),time=now();
  db.prepare("INSERT INTO pulse_cycles(id,tenant_id,title,purpose,opens_on,closes_on,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?,?)")
    .run(cycleId,u.tenant_id,v.text(input.title,'عنوان الدورة',160,3),input.purpose?v.text(input.purpose,'الغرض من الدورة',800):'',opens,closes,u.id,time,time);
  writeQuestions(db,u,cycleId,questions);
  audit(db,u,'pulse_cycle',cycleId,'pulse.drafted',{},{questions:questions.length,opens_on:opens,closes_on:closes});
  return {id:cycleId};
}
export function editCycle(db,supplied,cycleId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'تعديل دورة النبض لمن يدير الاستبيانات');
  v.object(input,['version','title','purpose','opens_on','closes_on','questions']);
  const cycle=cycleRow(db,u,cycleId);
  if(cycle.status!=='draft')fail(409,'not_draft','الدورة المفتوحة ما تتعدّل — أسئلتها ثابتة قدام اللي أجاب');
  v.version(input.version,cycle.version);
  const questions=readQuestions(input),opens=dateAfter(input.opens_on,'opens_on',today()),closes=v.date(input.closes_on);
  if(closes<opens)fail(400,'closes_on','تاريخ الإغلاق قبل تاريخ الفتح');
  // من يعدّل الأسئلة يصير معدّها: لا يفتح بعدها ما صاغه بنفسه، ولو أنشأ المسودة غيره.
  db.prepare('UPDATE pulse_cycles SET title=?,purpose=?,opens_on=?,closes_on=?,prepared_by=?,version=version+1,updated_at=? WHERE id=?')
    .run(v.text(input.title,'عنوان الدورة',160,3),input.purpose?v.text(input.purpose,'الغرض من الدورة',800):'',opens,closes,u.id,now(),cycle.id);
  writeQuestions(db,u,cycle.id,questions);
  audit(db,u,'pulse_cycle',cycle.id,'pulse.edited',{questions:cycle.version,prepared_by:cycle.prepared_by},{questions:questions.length,prepared_by:u.id});
  return {id:cycle.id};
}
// فتح الدورة اعتماد لا إجراء إداري: من صاغ الأسئلة لا يفتحها وحده، وصياغة السؤال قد تحدد من يُسأل عنه.
export function approveCycle(db,supplied,cycleId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'فتح دورة النبض لمن يدير الاستبيانات');
  v.object(input,['version','note']);
  const cycle=cycleRow(db,u,cycleId);
  if(cycle.status!=='draft')fail(409,'not_draft','الدورة هذي مو مسودة');
  v.version(input.version,cycle.version);
  if(cycle.prepared_by===u.id)fail(409,'separation_of_duties','اللي أعدّ أسئلة الدورة ما يفتحها بنفسه');
  const setting=privacyInForce(db,u);
  if(!setting)fail(409,'privacy_not_set','مدير الموارد البشرية ما حدد الحد الأدنى للمستجيبين لين الحين — وما نجمع إجابة قبل ما يثبت وعد السرية');
  if(!db.prepare('SELECT 1 FROM pulse_questions WHERE cycle_id=?').get(cycle.id))fail(409,'no_questions','الدورة هذي بلا أسئلة');
  const note=v.text(input.note,'أساس الفتح',600,5),time=now();
  // إعداد قديم بحد أقل من الأدنى لا يُفتح به: يُثبَّت في الدورة الأعلى منهما.
  const minimum=Math.max(setting.min_respondents,MIN_RESPONDENTS_FLOOR);
  db.prepare("UPDATE pulse_cycles SET status='open',opened_by=?,opened_at=?,min_respondents=?,privacy_setting_id=?,version=version+1,updated_at=? WHERE id=?")
    .run(u.id,time,minimum,setting.id,time,cycle.id);
  audit(db,u,'pulse_cycle',cycle.id,'pulse.opened',{},{min_respondents:minimum},note);
  return {id:cycle.id};
}
export function closeCycle(db,supplied,cycleId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'إغلاق دورة النبض لمن يدير الاستبيانات');
  v.object(input,['version','note']);
  const cycle=cycleRow(db,u,cycleId);
  if(cycle.status!=='open')fail(409,'not_open','الدورة هذي مو مفتوحة');
  v.version(input.version,cycle.version);
  // الإغلاق المبكر بعد إجابة واحدة أو اثنتين يحوّل الدورة إلى استجواب لمن أجاب؛ تبقى مفتوحة حتى تاريخ إغلاقها.
  if(today()<cycle.closes_on)fail(409,'closes_later',`ما تنغلق الدورة قبل تاريخ إغلاقها المعلن (${cycle.closes_on})`);
  const time=now();
  db.prepare("UPDATE pulse_cycles SET status='closed',closed_by=?,closed_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,cycle.id);
  audit(db,u,'pulse_cycle',cycle.id,'pulse.closed',{},{status:'closed'},v.text(input.note,'أساس الإغلاق',600,5));
  return {id:cycle.id};
}

// التقديم: المشاركة تُكتب باسم صاحبها في جدول، والإجابات تُكتب في جدول آخر بلا اسم ولا وقت ولا ترتيب إدخال.
// سجل التدقيق يوثق أن فلانًا شارك — وهو ما يوثقه جدول المشاركة أصلًا — ولا يحمل أي قيمة من إجاباته.
export function submitPulse(db,supplied,cycleId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['answers']);
  const cycle=cycleRow(db,u,cycleId),day=today();
  if(cycle.status!=='open')fail(409,'not_open','الدورة هذي مو مفتوحة للإجابة');
  if(day<cycle.opens_on||day>cycle.closes_on)fail(409,'outside_window','الإجابة خارج مدة الدورة');
  if(db.prepare('SELECT 1 FROM pulse_participants WHERE cycle_id=? AND user_id=?').get(cycle.id,u.id))fail(409,'already_responded','شاركت في هذي الدورة — وما ينعدّل جواب ما يعرف النظام صاحبه');
  const questions=db.prepare('SELECT * FROM pulse_questions WHERE cycle_id=? AND tenant_id=? ORDER BY position').all(cycle.id,u.tenant_id);
  const answers=input.answers;
  if(!Array.isArray(answers)||answers.length!==questions.length)fail(400,'answers','جاوب على كل أسئلة الدورة');
  const rows=[];
  for(const q of questions){
    const given=answers.find(a=>a&&typeof a==='object'&&a.question_id===q.id);
    if(!given)fail(400,'answers','ناقص جواب أحد الأسئلة');
    v.object(given,['question_id','value','comment']);
    // التعليق الحر اختياري دائمًا: إلزام أحد بالكتابة في شركة صغيرة يجعل الصمت نفسه إجابة تُعرف.
    if(q.kind==='comment'){
      const comment=String(given.comment??'').trim();
      if(comment)rows.push({question_id:q.id,value:null,comment:v.text(given.comment,'التعليق',1200,3)});
      continue;
    }
    const top=q.kind==='enps'?ENPS_MAX:SCALE_MAX,floor=q.kind==='enps'?0:1,value=Number(given.value);
    if(!Number.isInteger(value)||value<floor||value>top)fail(400,'value',`اختر قيمة من ${floor} لين ${top}`);
    rows.push({question_id:q.id,value,comment:''});
  }
  db.prepare('INSERT INTO pulse_participants(tenant_id,cycle_id,user_id,responded_on) VALUES(?,?,?,?)').run(u.tenant_id,cycle.id,u.id,day);
  for(const r of rows)db.prepare('INSERT INTO pulse_answers(id,tenant_id,cycle_id,question_id,value,comment) VALUES(?,?,?,?,?,?)').run(id(),u.tenant_id,cycle.id,r.question_id,r.value,r.comment);
  audit(db,u,'pulse_cycle',cycle.id,'pulse.responded',{},{responded:true});
  return {id:cycle.id};
}

// الحجب بالطرح: عرض بعض الفئات مع المجموع يكشف الفئة الصغيرة الباقية طرحًا.
// فالتوزيع يُعرض كاملًا أو لا يُعرض؛ لا عرض جزئي أبدًا.
const safeBands=(bands,minimum)=>bands.every(b=>b.count===0||b.count>=minimum)?bands:null;
function questionResults(db,u,cycle,minimum,showComments){
  const questions=db.prepare('SELECT * FROM pulse_questions WHERE cycle_id=? AND tenant_id=? ORDER BY position').all(cycle.id,u.tenant_id);
  return questions.map(q=>{
    // لا معامل تصفية في هذا الاستعلام ولا في غيره: مفتاحه الدورة كلها وسؤال واحد، والمجموعة الوحيدة هي الشركة.
    const rows=db.prepare('SELECT value,comment FROM pulse_answers WHERE tenant_id=? AND cycle_id=? AND question_id=? ORDER BY id').all(u.tenant_id,cycle.id,q.id);
    const head={id:q.id,position:q.position,kind:q.kind,kind_name:QUESTION_KINDS[q.kind],prompt:q.prompt};
    if(rows.length<minimum)return {...head,withheld:true,answered:null,reason:`عدد من أجاب على هذا السؤال دون الحد الأدنى (${minimum}). محجوب بالكامل، والعدد نفسه محجوب.`};
    if(q.kind==='comment'){
      const comments=rows.map(r=>String(r.comment??'').trim()).filter(Boolean);
      return {...head,withheld:false,answered:comments.length,
        comments:showComments?comments:null,comments_visible:showComments,
        comments_note:showComments?PULSE_COMMENT_WARNING:'التعليقات لحامل تصريح إدارة الاستبيانات فقط.'};
    }
    const values=rows.map(r=>r.value).filter(Number.isInteger);
    const average=Math.round(values.reduce((sum,x)=>sum+x,0)/values.length*10)/10;
    // حين يُحجب التوزيع يُحجب المتوسط وeNPS معه: المتوسط مع العدد يعطي المجموع، وeNPS مع العدد يعطي فرق الفئتين،
    // ومنهما تُعاد بناء الفئة الصغيرة المحجوبة (مثال: خمسة مستجيبين بمتوسط 4.2 = أربعة بخمسة وواحد بواحد).
    if(q.kind==='enps'){
      const promoters=values.filter(x=>x>=9).length,passives=values.filter(x=>x>=7&&x<=8).length,detractors=values.filter(x=>x<=6).length;
      const bands=safeBands([{band:'promoters',label:'مُرشِّحون (9–10)',count:promoters},{band:'passives',label:'محايدون (7–8)',count:passives},{band:'detractors',label:'غير مُرشِّحين (0–6)',count:detractors}],minimum);
      return {...head,withheld:false,answered:values.length,average:bands?average:null,
        enps:bands?Math.round((promoters-detractors)/values.length*100):null,bands,
        bands_withheld:!bands,bands_reason:bands?'':`إحدى الفئات أصغر من الحد الأدنى (${minimum})؛ عرض الباقي يكشفها طرحًا، فحُجب التوزيع كله ومعه المتوسط وeNPS لأنهما يعيدان بناءه.`};
    }
    const bands=safeBands(Array.from({length:SCALE_MAX},(_,i)=>({band:i+1,label:`${i+1}`,count:values.filter(x=>x===i+1).length})),minimum);
    return {...head,withheld:false,answered:values.length,average:bands?average:null,bands,
      bands_withheld:!bands,bands_reason:bands?'':`إحدى درجات المقياس اختارها عدد أصغر من الحد الأدنى (${minimum})؛ عرض الباقي يكشفها طرحًا، فحُجب التوزيع كله ومعه المتوسط لأنه يعيد بناءه.`};
  });
}
function cycleResults(db,u,cycle,showComments){
  const respondents=db.prepare('SELECT COUNT(*) AS n FROM pulse_participants WHERE tenant_id=? AND cycle_id=?').get(u.tenant_id,cycle.id).n;
  // لا نتائج قبل الإغلاق: قراءة النتائج اليوم ثم غدًا، مع معرفة من شارك بينهما، تكشف إجابته بالطرح.
  if(cycle.status!=='closed')return {available:false,respondents,questions:[],
    reason:'لا تُعرض نتيجة قبل إغلاق الدورة. النتيجة الجارية تُقرأ مرتين فتكشف إجابة من شارك بين القراءتين بالطرح.'};
  // دورة فُتحت قبل الترحيل 091 بحد أقل من الأدنى تُقرأ بالأدنى: الوعد الأعلى يغلب.
  const minimum=Math.max(cycle.min_respondents,MIN_RESPONDENTS_FLOOR);
  if(respondents<minimum)return {available:false,respondents,questions:[],
    reason:`أُغلقت الدورة بعدد مستجيبين (${respondents}) دون الحد الأدنى (${minimum}). لا نتيجة الآن ولا لاحقًا؛ هذا ما وُعد به من شارك.`};
  return {available:true,respondents,minimum,questions:questionResults(db,u,cycle,minimum,showComments),
    scope:'الشركة كلها. لا تقسيم ولا تصفية ولا مقارنة معيارية بقطاع.'};
}

export function pulseBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'hr.survey.manage'),day=today(),setting=privacyInForce(db,u);
  const rows=db.prepare('SELECT * FROM pulse_cycles WHERE tenant_id=? ORDER BY opens_on DESC,created_at DESC').all(u.tenant_id);
  const visible=manage?rows:rows.filter(c=>c.status!=='draft');
  const cycles=visible.map(cycle=>{
    const mine=!!db.prepare('SELECT 1 FROM pulse_participants WHERE cycle_id=? AND user_id=?').get(cycle.id,u.id);
    const respondents=db.prepare('SELECT COUNT(*) AS n FROM pulse_participants WHERE tenant_id=? AND cycle_id=?').get(u.tenant_id,cycle.id).n;
    const invited=db.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1').get(u.tenant_id).n;
    const open=cycle.status==='open'&&day>=cycle.opens_on&&day<=cycle.closes_on;
    const actions=[];
    if(manage&&cycle.status==='draft')actions.push('edit_cycle');
    if(manage&&cycle.status==='draft'&&cycle.prepared_by!==u.id)actions.push('approve_cycle');
    if(manage&&cycle.status==='open'&&day>=cycle.closes_on)actions.push('close_cycle');
    if(open&&!mine)actions.push('answer_pulse');
    return {id:cycle.id,title:cycle.title,purpose:cycle.purpose,opens_on:cycle.opens_on,closes_on:cycle.closes_on,status:cycle.status,version:cycle.version,
      prepared_by:cycle.prepared_by,prepared_by_name:personName(db,cycle.prepared_by),opened_by_name:personName(db,cycle.opened_by),closed_by_name:personName(db,cycle.closed_by),
      min_respondents:cycle.min_respondents,
      // عدد فقط ولا أسماء: جدول المشاركة يمنع الإجابة مرتين، ولا يصنع قائمة «من لم يجب» ليُضغط بها عليه.
      participation:{responded:respondents,invited,names_withheld:true},
      answered_by_me:mine,questions:db.prepare('SELECT id,position,kind,prompt FROM pulse_questions WHERE cycle_id=? AND tenant_id=? ORDER BY position').all(cycle.id,u.tenant_id).map(q=>({...q,kind_name:QUESTION_KINDS[q.kind]})),
      results:cycleResults(db,u,cycle,manage),actions};
  });
  return {can_manage:manage,user_id:u.id,today:day,question_kinds:QUESTION_KINDS,
    privacy:setting?{min_respondents:setting.min_respondents,effective_from:setting.effective_from,basis:setting.basis,set_by_name:personName(db,setting.set_by)}:null,
    privacy_history:manage?db.prepare('SELECT * FROM survey_privacy_settings WHERE tenant_id=? ORDER BY effective_from DESC').all(u.tenant_id).map(s=>({min_respondents:s.min_respondents,effective_from:s.effective_from,basis:s.basis,set_by_name:personName(db,s.set_by)})):[],
    cycles,my_open:cycles.filter(c=>c.actions.includes('answer_pulse')).map(c=>({id:c.id,title:c.title,closes_on:c.closes_on})),
    note:PULSE_NOTE,comment_warning:PULSE_COMMENT_WARNING,
    benchmarks:'لا مقارنات معيارية بقطاعات: لا نملك بياناتها ولا نخترعها.'};
}

/* ————————————————— ب. التقدير بين الزملاء ————————————————— */

export function defineValue(db,supplied,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'تعريف القيم المؤسسية لصاحب الإجراء');
  v.object(input,['name','description','basis','effective_from']);
  const name=v.text(input.name,'اسم القيمة',80,2);
  if(db.prepare('SELECT 1 FROM recognition_values WHERE tenant_id=? AND name=?').get(u.tenant_id,name))fail(409,'duplicate_value','القيمة هذي معرّفة أصلًا');
  const valueId=id();
  db.prepare('INSERT INTO recognition_values(id,tenant_id,name,description,basis,effective_from,defined_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(valueId,u.tenant_id,name,v.text(input.description,'ما تعنيه القيمة عمليًا',800,10),v.text(input.basis,'سند القيمة ومن أقرّها',400,5),dateAfter(input.effective_from,'effective_from',today()),u.id,now());
  audit(db,u,'recognition_value',valueId,'recognition.value_defined',{},{name});
  return {id:valueId};
}
export function retireValue(db,supplied,valueId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'سحب القيم المؤسسية لصاحب الإجراء');
  v.object(input,['version','reason']);
  const value=(typeof valueId==='string'?db.prepare('SELECT * FROM recognition_values WHERE id=? AND tenant_id=?').get(valueId,u.tenant_id):null)??fail(404,'not_found','ما لقينا القيمة هذي');
  if(value.retired_on)fail(409,'already_retired','القيمة هذي مسحوبة');
  v.version(input.version,value.version);
  const reason=v.text(input.reason,'سبب السحب',400,3);
  db.prepare('UPDATE recognition_values SET retired_on=?,retired_by=?,retired_reason=?,version=version+1 WHERE id=?').run(today(),u.id,reason,value.id);
  audit(db,u,'recognition_value',value.id,'recognition.value_retired',{name:value.name},{retired:true},reason);
  return {id:value.id};
}
export function sendRecognition(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['to_user_id','value_id','message','visibility']);
  if(!Object.hasOwn(VISIBILITY,input.visibility))fail(400,'visibility','اختر ظهور البطاقة من القائمة');
  const day=today();
  const value=db.prepare('SELECT * FROM recognition_values WHERE id=? AND tenant_id=? AND retired_on IS NULL AND effective_from<=?').get(input.value_id,u.tenant_id,day);
  if(!value)fail(400,'value_id','اختر قيمة مؤسسية سارية من القائمة');
  const target=db.prepare('SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.to_user_id,u.tenant_id);
  if(!target)fail(404,'not_found','ما لقينا الزميل هذا');
  if(target.id===u.id)fail(409,'separation_of_duties','التقدير من زميل لزميل — ما تقدّر نفسك');
  const cardId=id();
  db.prepare('INSERT INTO recognition_cards(id,tenant_id,from_user_id,to_user_id,value_id,message,visibility,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(cardId,u.tenant_id,u.id,target.id,value.id,v.text(input.message,'ما الذي تقدّره تحديدًا',1200,10),input.visibility,now());
  audit(db,u,'recognition_card',cardId,'recognition.sent',{},{value:value.name,visibility:input.visibility});
  // D-21 (تدقيق مسارات الوحدات، 20 سبتمبر): البطاقة كانت تُحفظ ولا تصل صاحبها، فتظهر على شاشة واحدة فقط.
  // نص البطاقة لا ينتقل إلى الإشعار: البطاقة الخاصة تبقى بين طرفيها في شاشتها.
  notifySubject(db,{userId:target.id,kind:'recognition_received',subjectKind:'recognition_card',subjectId:cardId,
    title:`قدّرك ${u.name} على قيمة «${value.name}»`,body:input.visibility==='public'?'البطاقة في موجز «التقدير».':'بطاقة خاصة بينكما في «التقدير».'});
  return {id:cardId};
}
const cardView=(db,c)=>({id:c.id,from_name:personName(db,c.from_user_id),to_name:personName(db,c.to_user_id),value_name:c.value_name,message:c.message,visibility:c.visibility,visibility_name:VISIBILITY[c.visibility],created_at:c.created_at});
export function recognitionBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'hr.survey.manage'),day=today();
  const values=db.prepare('SELECT * FROM recognition_values WHERE tenant_id=? ORDER BY retired_on IS NOT NULL,name').all(u.tenant_id);
  const live=values.filter(x=>!x.retired_on&&x.effective_from<=day);
  const select=`SELECT c.*,x.name AS value_name FROM recognition_cards c JOIN recognition_values x ON x.id=c.value_id WHERE c.tenant_id=?`;
  // الموجز بالتاريخ لا بالكم: لا ترتيب بعدد البطاقات ولا مجموع لأي شخص في أي مكان من هذه اللوحة.
  const feed=db.prepare(`${select} AND c.visibility='public' ORDER BY c.created_at DESC LIMIT 60`).all(u.tenant_id).map(c=>cardView(db,c));
  const received=db.prepare(`${select} AND c.to_user_id=? ORDER BY c.created_at DESC LIMIT 60`).all(u.tenant_id,u.id).map(c=>cardView(db,c));
  const sent=db.prepare(`${select} AND c.from_user_id=? ORDER BY c.created_at DESC LIMIT 60`).all(u.tenant_id,u.id).map(c=>cardView(db,c));
  return {can_manage:manage,user_id:u.id,today:day,visibility:VISIBILITY,
    values:values.map(x=>({id:x.id,name:x.name,description:x.description,basis:x.basis,effective_from:x.effective_from,version:x.version,
      defined_by_name:personName(db,x.defined_by),retired_on:x.retired_on,retired_reason:x.retired_reason,live:!x.retired_on&&x.effective_from<=day,
      actions:manage&&!x.retired_on?['retire_value']:[]})),
    live_values:live.map(x=>({id:x.id,name:x.name,description:x.description})),
    colleagues:db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND id<>? ORDER BY name').all(u.tenant_id,u.id),
    feed,received,sent,cards_total:db.prepare('SELECT COUNT(*) AS n FROM recognition_cards WHERE tenant_id=?').get(u.tenant_id).n,
    actions:[...(live.length?['send_recognition']:[]),...(manage?['define_value']:[])],
    values_missing:!live.length,
    note:RECOGNITION_NOTE,
    performance_note:'ما يظهر هنا لا يدخل تقييم الأداء آليًا ولا يُحتسب في أي درجة. لصاحب البطاقة أن يعرضها في تقييمه دليلًا إن أراد.'};
}

/* ————————————————— ج. الإعلانات الداخلية والفعاليات ————————————————— */

const inAudience=(u,row)=>row.audience_kind==='all'||row.department_id===u.department_id;
function audienceUsers(db,u,row){
  return row.audience_kind==='all'
    ? db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id)
    : db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND department_id=? ORDER BY name').all(u.tenant_id,row.department_id);
}
function readAnnouncementInput(db,u,input){
  if(!Object.hasOwn(AUDIENCE,input.audience_kind))fail(400,'audience_kind','اختر الجمهور من القائمة');
  const department=input.audience_kind==='department'
    ? db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id)??fail(400,'department_id','ما لقينا الإدارة هذي')
    : null;
  const publish=dateAfter(input.publish_on,'publish_on',today()),expires=v.date(input.expires_on);
  if(expires<publish)fail(400,'expires_on','تاريخ الانتهاء قبل تاريخ النشر');
  const requiresAck=input.requires_ack===true||input.requires_ack==='true';
  if(requiresAck&&!String(input.ack_reason??'').trim())fail(400,'ack_reason','اكتب ليش هذا الإعلان يستوجب إقرار بالقراءة');
  return {title:v.text(input.title,'عنوان الإعلان',200,3),body:v.text(input.body,'نص الإعلان',8000,10),
    audience_kind:input.audience_kind,department_id:department?.id??null,publish_on:publish,expires_on:expires,
    requires_ack:requiresAck?1:0,ack_reason:requiresAck?v.text(input.ack_reason,'سبب طلب الإقرار',400,5):''};
}
const announcementRow=(db,u,announcementId)=>(typeof announcementId==='string'?db.prepare('SELECT * FROM announcements WHERE id=? AND tenant_id=?').get(announcementId,u.tenant_id):null)??fail(404,'not_found','ما لقينا الإعلان هذا');

export function draftAnnouncement(db,supplied,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'إعداد الإعلانات الداخلية لمن يدير الاتصال الداخلي');
  v.object(input,['title','body','audience_kind','department_id','publish_on','expires_on','requires_ack','ack_reason']);
  const f=readAnnouncementInput(db,u,input),announcementId=id(),time=now();
  db.prepare("INSERT INTO announcements(id,tenant_id,title,body,audience_kind,department_id,publish_on,expires_on,requires_ack,ack_reason,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(announcementId,u.tenant_id,f.title,f.body,f.audience_kind,f.department_id,f.publish_on,f.expires_on,f.requires_ack,f.ack_reason,u.id,time,time);
  audit(db,u,'announcement',announcementId,'announcement.drafted',{},{title:f.title,requires_ack:!!f.requires_ack});
  return {id:announcementId};
}
export function editAnnouncement(db,supplied,announcementId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'تعديل الإعلانات لمن يدير الاتصال الداخلي');
  v.object(input,['version','title','body','audience_kind','department_id','publish_on','expires_on','requires_ack','ack_reason']);
  const row=announcementRow(db,u,announcementId);
  if(row.status!=='draft')fail(409,'not_draft','الإعلان المنشور ما يتعدّل — يُسحب بسبب وينُشر إعلان جديد');
  v.version(input.version,row.version);
  const f=readAnnouncementInput(db,u,input);
  db.prepare('UPDATE announcements SET title=?,body=?,audience_kind=?,department_id=?,publish_on=?,expires_on=?,requires_ack=?,ack_reason=?,prepared_by=?,version=version+1,updated_at=? WHERE id=?')
    .run(f.title,f.body,f.audience_kind,f.department_id,f.publish_on,f.expires_on,f.requires_ack,f.ack_reason,u.id,now(),row.id);
  audit(db,u,'announcement',row.id,'announcement.edited',{title:row.title},{title:f.title});
  return {id:row.id};
}
export function attachToAnnouncement(db,supplied,announcementId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'إرفاق الملفات لمن يدير الاتصال الداخلي');
  v.object(input,['label','file']);
  const row=announcementRow(db,u,announcementId);
  if(row.status!=='draft')fail(409,'not_draft','المرفقات تنضاف قبل النشر');
  const file=input.file;
  if(!file||typeof file!=='object'||Array.isArray(file))fail(400,'file','اختر ملف من جهازك');
  v.object(file,['filename','content']);
  const filename=v.text(file.filename,'اسم الملف',120);
  if([...filename].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127||ch==='/'||ch==='\\')||filename.includes('..'))fail(400,'filename','اسم الملف هذا مو صحيح');
  if(typeof file.content!=='string'||file.content.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))fail(400,'content','ترميز الملف مو صحيح');
  const data=Buffer.from(file.content,'base64');
  if(data.length<1||data.length>2097152)fail(413,'file_size','الملف 2 ميغابايت على الأكثر');
  // النوع من توقيع المحتوى لا من الامتداد.
  const media=SIGNATURES.find(([,signature])=>data.subarray(0,signature.length).equals(signature))?.[0];
  if(!media)fail(400,'file_type','المسموح: PDF وPNG وJPEG، وبتوقيع محتوى مطابق');
  const digest=hash(data);
  if(db.prepare('SELECT 1 FROM announcement_attachments WHERE announcement_id=? AND digest=?').get(row.id,digest))fail(409,'duplicate_file','الملف هذا مرفق بنفس الإعلان');
  const fileId=id();
  db.prepare('INSERT INTO announcement_attachments(id,tenant_id,announcement_id,label,filename,media_type,size,digest,content,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(fileId,u.tenant_id,row.id,v.text(input.label,'وصف المرفق',180,3),filename,media,data.length,digest,data,u.id,now());
  audit(db,u,'announcement',row.id,'announcement.attached',{},{file_id:fileId,size:data.length});
  return {id:fileId};
}
// النشر اعتماد: من كتب الإعلان لا يبثه على الشركة وحده، وخاصة ما يطلب إقرارًا يُحتج به لاحقًا.
export function approveAnnouncement(db,supplied,announcementId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'نشر الإعلانات لمن يدير الاتصال الداخلي');
  v.object(input,['version','note']);
  const row=announcementRow(db,u,announcementId);
  if(row.status!=='draft')fail(409,'not_draft','الإعلان هذا مو مسودة');
  v.version(input.version,row.version);
  if(row.prepared_by===u.id)fail(409,'separation_of_duties','اللي أعدّ الإعلان ما ينشره بنفسه');
  const time=now();
  db.prepare("UPDATE announcements SET status='published',published_by=?,published_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,row.id);
  audit(db,u,'announcement',row.id,'announcement.published',{},{title:row.title,audience:row.audience_kind},v.text(input.note,'أساس النشر',600,5));
  return {id:row.id};
}
export function withdrawAnnouncement(db,supplied,announcementId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'سحب الإعلانات لمن يدير الاتصال الداخلي');
  v.object(input,['version','reason']);
  const row=announcementRow(db,u,announcementId);
  if(row.status!=='published')fail(409,'not_published','الإعلان هذا مو منشور');
  v.version(input.version,row.version);
  const reason=v.text(input.reason,'سبب السحب',600,3);
  db.prepare("UPDATE announcements SET status='withdrawn',withdrawn_by=?,withdrawn_reason=?,version=version+1,updated_at=? WHERE id=?").run(u.id,reason,now(),row.id);
  audit(db,u,'announcement',row.id,'announcement.withdrawn',{title:row.title},{withdrawn:true},reason);
  return {id:row.id};
}
export function acknowledgeAnnouncement(db,supplied,announcementId){
  writing(db);const u=actor(db,supplied);
  const row=announcementRow(db,u,announcementId);
  if(row.status!=='published'||row.publish_on>today())fail(409,'not_published','الإعلان هذا مو منشور');
  if(!row.requires_ack)fail(409,'ack_not_required','الإعلان هذا ما يستوجب إقرار، وما نتتبّع مين قراه');
  if(!inAudience(u,row))fail(404,'not_found','ما لقينا الإعلان هذا');
  if(db.prepare('SELECT 1 FROM announcement_reads WHERE announcement_id=? AND user_id=?').get(row.id,u.id))fail(409,'already_acknowledged','إقرارك على هذا الإعلان مسجّل أصلًا');
  db.prepare('INSERT INTO announcement_reads(tenant_id,announcement_id,user_id,read_at) VALUES(?,?,?,?)').run(u.tenant_id,row.id,u.id,now());
  audit(db,u,'announcement',row.id,'announcement.acknowledged',{},{acknowledged:true});
  return {id:row.id};
}
export function downloadAnnouncementFile(db,supplied,fileId){
  const u=actor(db,supplied);
  const f=typeof fileId==='string'?db.prepare('SELECT * FROM announcement_attachments WHERE id=? AND tenant_id=?').get(fileId,u.tenant_id):null;
  if(!f)fail(404,'not_found','ما لقينا المرفق هذا');
  const row=db.prepare('SELECT * FROM announcements WHERE id=? AND tenant_id=?').get(f.announcement_id,u.tenant_id);
  const live=row.status==='published'&&row.publish_on<=today()&&inAudience(u,row);
  if(!live&&!can(db,u,'hr.survey.manage'))fail(404,'not_found','ما لقينا المرفق هذا');
  if(hash(Buffer.from(f.content))!==f.digest)fail(409,'file_corrupted','بصمة المرفق ما تطابق محتواه');
  audit(db,u,'announcement',row.id,'announcement.file_downloaded',{},{file_id:f.id});
  return {filename:f.filename,media_type:f.media_type,content:Buffer.from(f.content)};
}

export function createEvent(db,supplied,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'تقويم الفعاليات لمن يدير الاتصال الداخلي');
  v.object(input,['title','event_date','start_time','location','note','audience_kind','department_id']);
  if(!Object.hasOwn(AUDIENCE,input.audience_kind))fail(400,'audience_kind','اختر الجمهور من القائمة');
  const department=input.audience_kind==='department'
    ? db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id)??fail(400,'department_id','ما لقينا الإدارة هذي')
    : null;
  const start=String(input.start_time??'').trim();
  if(start&&!/^[0-2]\d:[0-5]\d$/.test(start))fail(400,'start_time','اكتب الوقت بصيغة HH:MM');
  const eventId=id(),time=now();
  db.prepare('INSERT INTO internal_events(id,tenant_id,title,event_date,start_time,location,note,audience_kind,department_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,u.tenant_id,v.text(input.title,'اسم الفعالية',200,3),dateAfter(input.event_date,'event_date',today()),start,
      input.location?v.text(input.location,'المكان',200):'',input.note?v.text(input.note,'تفاصيل',1200):'',input.audience_kind,department?.id??null,u.id,time,time);
  audit(db,u,'internal_event',eventId,'event.created',{},{title:input.title});
  return {id:eventId};
}
export function cancelEvent(db,supplied,eventId,input){
  writing(db);const u=actor(db,supplied);manager(db,u,'إلغاء الفعاليات لمن يدير الاتصال الداخلي');
  v.object(input,['version','reason']);
  const row=(typeof eventId==='string'?db.prepare('SELECT * FROM internal_events WHERE id=? AND tenant_id=?').get(eventId,u.tenant_id):null)??fail(404,'not_found','ما لقينا الفعالية هذي');
  if(row.cancelled_by)fail(409,'already_cancelled','الفعالية هذي ملغاة');
  v.version(input.version,row.version);
  const reason=v.text(input.reason,'سبب الإلغاء',400,3);
  db.prepare('UPDATE internal_events SET cancelled_by=?,cancelled_reason=?,version=version+1,updated_at=? WHERE id=?').run(u.id,reason,now(),row.id);
  audit(db,u,'internal_event',row.id,'event.cancelled',{title:row.title},{cancelled:true},reason);
  return {id:row.id};
}

export function announcementsBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'hr.survey.manage'),day=today();
  const rows=db.prepare('SELECT * FROM announcements WHERE tenant_id=? ORDER BY publish_on DESC,created_at DESC').all(u.tenant_id);
  const readable=rows.filter(a=>manage||(a.status==='published'&&a.publish_on<=day&&inAudience(u,a)));
  const announcements=readable.map(a=>{
    const acknowledged=!!db.prepare('SELECT 1 FROM announcement_reads WHERE announcement_id=? AND user_id=?').get(a.id,u.id);
    const live=a.status==='published'&&a.publish_on<=day,expired=live&&a.expires_on<day;
    const actions=[];
    if(manage&&a.status==='draft')actions.push('edit_announcement','attach_file');
    if(manage&&a.status==='draft'&&a.prepared_by!==u.id)actions.push('approve_announcement');
    if(manage&&a.status==='published')actions.push('withdraw_announcement');
    if(a.requires_ack&&live&&inAudience(u,a)&&!acknowledged)actions.push('acknowledge');
    let reads=null,pending=null;
    if(manage&&a.requires_ack&&a.status!=='draft'){
      const seen=db.prepare('SELECT r.user_id,r.read_at,x.name FROM announcement_reads r JOIN users x ON x.id=r.user_id WHERE r.announcement_id=? ORDER BY r.read_at').all(a.id);
      reads=seen.map(r=>({name:r.name,read_at:r.read_at}));
      const ids=new Set(seen.map(r=>r.user_id));
      pending=audienceUsers(db,u,a).filter(p=>!ids.has(p.id)).map(p=>({id:p.id,name:p.name}));
    }
    return {id:a.id,title:a.title,body:a.body,status:a.status,audience_kind:a.audience_kind,audience_name:AUDIENCE[a.audience_kind],
      department_id:a.department_id,department_name:a.department_id?db.prepare('SELECT name FROM departments WHERE id=?').get(a.department_id)?.name??a.department_id:'',
      publish_on:a.publish_on,expires_on:a.expires_on,expired,requires_ack:!!a.requires_ack,ack_reason:a.ack_reason,
      prepared_by:a.prepared_by,prepared_by_name:personName(db,a.prepared_by),published_by_name:personName(db,a.published_by),
      withdrawn_by_name:personName(db,a.withdrawn_by),withdrawn_reason:a.withdrawn_reason,version:a.version,
      acknowledged,acknowledged_count:reads?reads.length:null,reads,pending,
      attachments:db.prepare('SELECT id,label,filename,media_type,size FROM announcement_attachments WHERE announcement_id=? ORDER BY created_at').all(a.id),
      actions};
  });
  const events=db.prepare('SELECT * FROM internal_events WHERE tenant_id=? AND event_date>=? ORDER BY event_date,start_time').all(u.tenant_id,day)
    .filter(x=>manage||inAudience(u,x))
    .map(x=>({id:x.id,title:x.title,event_date:x.event_date,start_time:x.start_time,location:x.location,note:x.note,
      audience_kind:x.audience_kind,audience_name:AUDIENCE[x.audience_kind],department_id:x.department_id,version:x.version,
      created_by_name:personName(db,x.created_by),cancelled:!!x.cancelled_by,cancelled_reason:x.cancelled_reason,
      actions:manage&&!x.cancelled_by?['cancel_event']:[]}));
  return {can_manage:manage,user_id:u.id,today:day,audiences:AUDIENCE,
    departments:db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),
    announcements,events,
    awaiting_me:announcements.filter(a=>a.actions.includes('acknowledge')||a.actions.includes('approve_announcement'))
      .map(a=>({id:a.id,title:a.title,created_at:a.publish_on,actions:a.actions.filter(x=>['acknowledge','approve_announcement'].includes(x))})),
    actions:manage?['draft_announcement','create_event']:[],
    note:ANNOUNCEMENT_NOTE};
}
