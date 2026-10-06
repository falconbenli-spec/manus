import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, holds, holdsIn, can } from '../app/access.mjs';
import { installCatalogue, acceptDefinition, formsBoard, createInstance, saveInstance,
  instanceAction, getInstance } from '../app/forms.mjs';

/* البوابة 2 (تجاوز الصلاحية) — العيب الذي أوجب هذا الملف:
 *
 * شاشة التصاريح تمنح التصريح «محصورًا بإدارة»: grantAccess يقبل department_id ويخزّنه، ويرفضه على
 * تصريحٍ لا يقبل الحصر. وcan() تحترم الحصر: منحٌ لإدارةٍ لا يفتح غيرها.
 * لكن محرك النماذج لا يسأل can() في موضع واحد — يسأل holds()، وholds() تتجاهل الإدارة عمدًا
 * (سؤالها «هل يحمله هذا الشخص بعينه» لفصل المهام وقوائم الحاملين). فالحصر يتبخّر داخل النماذج:
 *   • canReadInstance  — يفتح قراءة كل نسخة مملوءة لحامل أي تصريح في السلسلة، ولو كان محصورًا بإدارة أخرى.
 *   • instanceActions  — يفتح «اعتمد/أعد/ارفض» لصاحب تصريح الخطوة، ولو كان محصورًا بإدارة أخرى.
 *
 * وليست الحالة فرضية. قياس 29 سبتمبر 2026 على قاعدة التشغيل: خمسة منحٍ محصورة بإدارة قائمة الآن،
 * ثلاثة منها على تصاريح تقف عليها خطوات اعتماد في الكتالوج — commercial.use محصورًا بـ«accounts»،
 * وcommercial.use محصورًا بـ«business-dev»، وstudio.use محصورًا بـ«accounts». وكلٌّ من التصريحين
 * تقف عليه **خمس** خطوات اعتماد في الكتالوج (محسوبةً من FORM_CATALOGUE لا من عدّ نصّي). فحاملو
 * هذه المنح الثلاثة يعتمدون اليوم نماذج كل الإدارات، والشاشة التي منحتهم تقول «إدارة واحدة».
 * والقياس كامله في docs/testing/forms-department-scope-20260929.json.
 *
 * ولماذا الآن أرخص وقت: form_instances صفر وform_approvals صفر. لم يُتَّخذ قرار واحد بعد، فالإصلاح
 * لا يُبطل اعتمادًا قائمًا ولا يُربك سجلًا. ولو انتظرنا التشغيل لصار كل اعتماد خارج الإدارة سجلًا
 * يلزم تفسيره.
 *
 * وإدارة النسخة المملوءة هي إدارة من عبّأها (users.department_id غير قابل للعدم، وصفر فراغ في
 * قاعدة التشغيل). وهذا ليس اختيارًا بين متكافئين: جدول form_instances لا يحمل إدارة، وجدول
 * projects لا يحمل إدارة، والموضوع قد يكون فرصةً أو موردًا لا إدارة له أصلًا — فإدارة المعبّئ هي
 * الإدارة الوحيدة التي تُشتق لكل نسخة بلا استثناء. وأيّ اشتقاق ناقص يُبقي الثغرة مفتوحة حيث ينقص.
 */

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// المعبّئ في «creative»، والمعتمدان في إدارتين: واحد حصره يصل إلى إدارة المعبّئ، وواحد لا يصل.
const GRANTS=[
  ['manager','forms.accept',null],       // مالك النماذج يقبل التعريف
  ['outsider','commercial.use',null],    // المعبّئ — إدارته creative
  ['hr','commercial.use','hr'],          // معتمد محصور بإدارة **غير** إدارة المعبّئ
  ['it','commercial.use','creative']     // معتمد محصور بإدارة المعبّئ نفسها
];

const QUALIFY={company:'شركة تجريبية',sector:'تجزئة',contact_name:'جهة تواصل',contact_title:'مدير تسويق',
  contact_email:'contact@example.test',contact_phone:'0500000000',reached_us:'ترشيح من عميل سابق',
  bant_budget:'محدد',bant_authority:'نعم',bant_need:'واضحة',bant_timing:'فوري',
  services:'هوية بصرية وحملة إطلاق',expected_value:'250000',above_minimum:'الحد الأدنى غير محدد',
  duration:'ثلاثة أشهر',capacity:'الفريق متاح',experience:'سبق العمل في القطاع نفسه',
  decision:'مؤهل',priority:'عالية',justification:'ميزانية محددة وحاجة واضحة وتوقيت فوري',next_step:'إعداد التسعير'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-forms');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  for(const [user,capability,department_id] of GRANTS)
    tx(()=>grantAccess(db,users.admin,{user_id:user,capability,department_id,note:'تصريح تجريبي لاختبار حصر النماذج بالإدارة'}));
  tx(()=>installCatalogue(db,'36t'));
  const draft=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-BD-QUALIFY');
  tx(()=>acceptDefinition(db,users.manager,'FORM-BD-QUALIFY',
    {version:draft.row_version,effective_from:today(),note:'أقبل هذا التعريف مسؤولية مني كمالك للنموذج'}));
  // نسخة مملوءة ومقدَّمة من موظف إدارة creative.
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-BD-QUALIFY',title:'فرصة شركة تجريبية',
    subject_kind:'opportunity',subject_id:'OPP-001',payload:{company:'شركة تجريبية'}}));
  const drafted=getInstance(db,users.outsider,created.id);
  tx(()=>saveInstance(db,users.outsider,created.id,{version:drafted.row_version,title:'فرصة شركة تجريبية',payload:QUALIFY}));
  tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:getInstance(db,users.outsider,created.id).row_version}));
  return {db,users,tx,instanceId:created.id};
}

test('المنح المحصور بإدارة يُخزَّن بإدارته: الحصر مكتوب في الصف لا مُدَّعى على الشاشة',t=>{
  const {db,users}=fixture(t);
  const rows=db.prepare("SELECT user_id,department_id FROM access_grants WHERE capability='commercial.use' AND revoked_at IS NULL ORDER BY user_id").all().map(r=>({...r}));
  assert.deepEqual(rows,[{user_id:'hr',department_id:'hr'},{user_id:'it',department_id:'creative'},{user_id:'outsider',department_id:null}],
    'شاشة التصاريح تَعِد بحصرٍ بإدارة؛ فإن لم يصل الحصر إلى الصف فما بعده لا معنى له.');
  assert.equal(db.prepare('SELECT department_id FROM users WHERE id=?').get('outsider').department_id,'creative');
});

test('المعتمد المحصور بإدارة أخرى لا يقرأ النسخة المملوءة',t=>{
  const {db,users,instanceId}=fixture(t);
  assert.throws(()=>getInstance(db,users.hr,instanceId),code('not_found'),
    'حامل commercial.use محصورًا بإدارة «hr» يقرأ نموذجًا عبّأه موظف إدارة «creative». '
    +'canReadInstance تسأل holds() التي تتجاهل الإدارة، فالحصر الذي منحه المالك على الشاشة لا أثر له في القراءة.');
});

test('المعتمد المحصور بإدارة أخرى لا يعتمد ولا يعيد ولا يرفض',t=>{
  const {db,users,tx,instanceId}=fixture(t);
  const version=getInstance(db,users.outsider,instanceId).row_version;
  assert.throws(()=>tx(()=>instanceAction(db,users.hr,instanceId,'approve',{version,note:'اعتماد من خارج إدارتي'})),
    error=>['not_found','action_unavailable'].includes(error.code),
    'حامل commercial.use محصورًا بإدارة «hr» يعتمد نموذج إدارة «creative». '
    +'instanceActions تسأل holds() على تصريح الخطوة، وholds() لا ترى الإدارة — فالقرار يقع خارج ما مُنح له.');
});

test('والحصر لا يُغلق على من يصله: معتمد إدارة المعبّئ يقرأ ويعتمد كما كان',t=>{
  const {db,users,tx,instanceId}=fixture(t);
  const seen=getInstance(db,users.it,instanceId);
  assert.equal(seen.status,'submitted','من حصره يصل إلى إدارة المعبّئ يقرأ النسخة: الإصلاح يحصر ولا يشلّ.');
  assert.ok(seen.actions.includes('approve'));
  tx(()=>instanceAction(db,users.it,instanceId,'approve',{version:seen.row_version,note:'أعتمد التأهيل داخل إدارتي'}));
  assert.equal(getInstance(db,users.it,instanceId).status,'approved');
});

/* جدول الحقيقة لقاعدة الحصر نفسها (reachesDepartment عبر holdsIn وcan).
 * هذا هو الحارس الدائم: الإصلاح أعلاه يمنع الثغرة في محرك النماذج، وهذا يمنع أن تُنقض القاعدة
 * من تحته. وأهمّ سطر فيه الأخير: امتياز الأدمن الأول يفتح can() ولا يفتح holdsIn() — فمن يستبدل
 * holds() بـcan() في سلسلة اعتماد (وهو الاختصار الذي يقفز إليه الذهن) يسلّم المالك قرار كل خطوة
 * في كل نموذج، وهي نقيض فصل المهام لا إصلاحه.
 */
test('قاعدة الحصر: ما يصل بالدور يعمّ، والمنح المحصور يقف عند إدارته، وامتياز الأدمن لا يفتح قرار السلسلة',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-scope-rule');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'commercial.use',department_id:'hr',note:'منح محصور بإدارة — بيانات تجريبية'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'commercial.use',department_id:null,note:'منح عام بلا حصر — بيانات تجريبية'}));

  // ١) منحٌ محصور: يصل إلى إدارته، ولا يصل إلى غيرها، ولا يُسأل عن إدارة فلا يُمنع.
  assert.equal(holdsIn(db,users.hr,'commercial.use','hr'),true);
  assert.equal(holdsIn(db,users.hr,'commercial.use','creative'),false);
  assert.equal(holdsIn(db,users.hr,'commercial.use',null),true,'بلا إدارة مطلوبة لا محلّ للسؤال، فتعود holdsIn إلى holds حرفيًا');
  assert.equal(holds(db,users.hr,'commercial.use'),true,'وholds نفسها لا تتغير: سؤالها «هل يحمله» لا «أين»');

  // ٢) منحٌ عام: يعمّ كل الإدارات.
  for(const department of ['hr','creative','it'])assert.equal(holdsIn(db,users.it,'commercial.use',department),true);

  // ٣) من لا يحمله لا يصل إلى إدارةٍ أصلًا.
  assert.equal(holdsIn(db,users.employee,'commercial.use','creative'),false);

  // ٤) ما يصل بالدور يصل بلا نطاق: تصريح عام لكل الموظفين لا يُحصر بإدارة.
  assert.equal(holdsIn(db,users.employee,'forms.fill','creative'),true);
  assert.equal(holdsIn(db,users.employee,'forms.fill','hr'),true);

  // ٥) الفرق الذي يحرسه هذا الملف: can تفتح للأدمن الأول، وholdsIn لا تفتح.
  assert.equal(can(db,users.admin,'commercial.use','creative'),true,'امتياز الأدمن الأول يفتح الشاشات');
  assert.equal(holdsIn(db,users.admin,'commercial.use','creative'),false,
    'ولا يفتح قرار خطوة اعتماد: لو فتحه لصار المالك معتمدًا لكل نموذج في كل إدارة، وهو نقيض فصل المهام.');
});
