import { readFileSync, readdirSync } from 'node:fs';
import { now, verifyAudit } from './db.mjs';
import { fail } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { verifyInvoiceChain } from './invoices.mjs';
import { gateway, NOT_CONNECTED } from './einvoice-gateway.mjs';

// مراجعة «الوظائف المحظورة»: المنصة تفحص نفسها بالكود مقابل ضوابط سلامة حل الفوترة.
// كل بند يحمل حكمه ودليله من الكود (جدول أو محفّز أو دالة). ما لم يُتحقق منه يُقال صراحة ولا يُخمَّن.
// هذا فحص ذاتي داخلي، وليس شهادة توافق ولا مراجعة جهة خارجية.
export const STATUS_NAMES={met:'مستوفى',not_met:'غير مستوفى',not_applicable:'لا ينطبق',not_verified:'لم يُتحقق منه'};
const DISCLAIMER='فحص ذاتي داخلي بالكود. ليس شهادة توافق ولا مراجعة جهة، ولا يثبت امتثالًا لأي متطلب نظامي.';

let cache=null;
function sources(){
  if(cache)return cache;
  const directory=new URL('./',import.meta.url),files=new Map();
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.mjs'))){
    try{files.set(name,readFileSync(new URL(name,directory),'utf8'));}catch{/* ملف غير مقروء يُبلَّغ عنه كبند لم يُتحقق منه */}
  }
  return (cache={files});
}
const source=name=>sources().files.get(name)??null;
const anySource=pattern=>[...sources().files].filter(([,text])=>pattern.test(text)).map(([name])=>`app/${name}`);
function schema(db){
  const rows=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master').all();
  return {has:(type,name)=>rows.some(r=>r.type===type&&r.name===name),sqlOf:name=>rows.find(r=>r.name===name)?.sql??'',
    columns:table=>{try{return db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);}catch{return [];}}};
}
// جسم دالة مصدَّرة، لفحص ما بداخلها لا ما يجاورها.
function body(text,name){
  const start=text.indexOf(`export function ${name}(`);
  if(start<0)return null;
  const next=text.indexOf('\nexport ',start+1);
  return text.slice(start,next<0?text.length:next);
}
const item=(key,question,status,evidence,note)=>({key,question,status,status_name:STATUS_NAMES[status],evidence,note});

export function einvoiceSelfcheck(db,supplied){
  const u=currentUser(db,supplied);
  if(!u)fail(403,'forbidden','الحساب غير متاح');
  if(!can(db,u,'einvoice.manage'))fail(403,'not_permitted','لا يوجد تصريح لمراجعة ضوابط الفوترة. اطلبه من مسؤول الصلاحيات');
  const s=schema(db),invoices=source('invoices.mjs'),auth=source('auth.mjs'),items=[];

  /* 1) حذف الفاتورة */
  {
    const trigger=s.has('trigger','tax_invoices_no_delete'),archiveTrigger=s.has('trigger','einvoice_archive_no_delete');
    const writers=anySource(/DELETE\s+FROM\s+(tax_invoices|einvoice_archive)/i);
    const ok=trigger&&archiveTrigger&&!writers.length;
    items.push(item('invoice_delete','هل يمكن حذف فاتورة؟',ok?'met':'not_met',
      [trigger?'TRIGGER tax_invoices_no_delete — يرفض كل DELETE على المستندات الضريبية':'لا يوجد محفّز يمنع حذف المستندات الضريبية',
       archiveTrigger?'TRIGGER einvoice_archive_no_delete — يرفض كل DELETE على الأرشيف':'لا يوجد محفّز يمنع حذف الأرشيف',
       writers.length?`استعلامات حذف في: ${writers.join('، ')}`:'لا استعلام DELETE على tax_invoices أو einvoice_archive في أي وحدة'],
      ok?'لا. المنع في SQL لا في الكود وحده، فيسري حتى على من يفتح قاعدة البيانات مباشرة.':'يوجد مسار حذف؛ راجع الأدلة أعلاه.'));
  }

  /* 2) تعديل فاتورة صادرة */
  {
    const trigger=s.has('trigger','tax_invoices_fixed'),archive=s.has('trigger','einvoice_archive_no_update');
    const ok=trigger&&archive;
    items.push(item('issued_invoice_update','هل يمكن تعديل فاتورة صادرة؟',ok?'met':'not_met',
      [trigger?'TRIGGER tax_invoices_fixed — يرفض أي UPDATE بعد الإصدار أو الرفض':'لا يوجد محفّز يقفل المستند الصادر',
       archive?'TRIGGER einvoice_archive_no_update — نسخة الأرشيف لا تُعدَّل إطلاقًا':'الأرشيف غير مقفل',
       'app/invoices.mjs: prepareCreditNote — التصحيح بإشعار دائن يحمل مرجع الأصل إلزامًا'],
      ok?'لا. التصحيح بإشعار دائن، والأصل والنسخة المؤرشفة يبقيان كما صدرا.':'المستند الصادر قابل للتعديل؛ هذا خرق للضابط.'));
  }

  /* 3) إعادة ضبط العدّاد أو إنشاء فجوة */
  {
    const gapless=s.has('trigger','tax_invoices_gapless'),unique=s.has('index','tax_invoices_sequence');
    const monotonic=s.has('trigger','einvoice_sequence_monotonic'),counter=s.has('trigger','einvoice_counter_never_resets'),noClear=s.has('trigger','einvoice_counter_no_delete');
    const setters=anySource(/UPDATE\s+tax_invoices\s+SET[^;']*sequence=/i).filter(name=>name!=='app/invoices.mjs');
    const ok=gapless&&unique&&monotonic&&counter&&noClear&&!setters.length;
    items.push(item('counter_reset_or_gap','هل يمكن إعادة ضبط العدّاد أو إنشاء فجوة في الترقيم؟',ok?'met':'not_met',
      [gapless?'TRIGGER tax_invoices_gapless — الرقم التالي هو الأكبر + 1 داخل الكيان والنوع':'لا محفّز يمنع الفجوة',
       unique?'INDEX tax_invoices_sequence — رقم واحد لكل كيان ونوع، لا تكرار':'لا فهرس فريد على الترقيم',
       monotonic?'TRIGGER einvoice_sequence_monotonic — كل رقم يمر بالعدّاد ولا يرجع للوراء':'لا محفّز يربط الترقيم بالعدّاد',
       counter?'TRIGGER einvoice_counter_never_resets — العدّاد يزيد واحدًا واحدًا فقط':'العدّاد قابل لإعادة الضبط',
       noClear?'TRIGGER einvoice_counter_no_delete — العدّاد لا يُمسح':'العدّاد قابل للمسح',
       setters.length?`وحدات تكتب في الترقيم خارج دورة الفاتورة: ${setters.join('، ')}`:'لا وحدة تكتب sequence خارج app/invoices.mjs'],
      ok?'لا. الرقم يُمنح عند الإصدار فقط، ويمر بعدّاد لا يرجع ولا يُعاد ضبطه ولا يُمسح.':'يوجد مسار لإعادة الضبط أو الفجوة؛ راجع الأدلة.'));
  }

  /* 4) سلسلة البصمات */
  {
    const linked=s.has('trigger','einvoice_chain_link'),valid=verifyInvoiceChain(db,u.tenant_id);
    items.push(item('hash_chain','هل ترتبط المستندات الصادرة بسلسلة بصمات متصلة؟',linked&&valid?'met':'not_met',
      [linked?'TRIGGER einvoice_chain_link — بصمة السابق ورقم الحلقة يُفرضان في SQL عند الإصدار':'ربط السلسلة في الكود وحده',
       `app/invoices.mjs: verifyInvoiceChain — أعيد تشغيلها الآن على هذا الكيان، والنتيجة: ${valid?'السلسلة متصلة':'السلسلة مكسورة'}`],
      valid?'كل مستند يحمل بصمة سابقه، وأي تعديل خارج المنصة يكسر السلسلة ويظهر.':'السلسلة مكسورة: عُدّل مستند صادر خارج المنصة أو فُقد.'));
  }

  /* 5) الدخول المجهول وكلمة المرور الافتراضية */
  if(!auth)items.push(item('anonymous_or_default_password','هل يوجد دخول مجهول أو كلمة مرور افتراضية؟','not_verified',['تعذّرت قراءة app/auth.mjs'],'لم يُتحقق منه.'));
  else{
    const guarded=/fail\(401,'login_required'/.test(auth)&&/expires_at>\?/.test(auth);
    const hashed=/scryptSync/.test(auth)&&/timingSafeEqual/.test(auth);
    const literal=/password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(auth);
    const forced=s.columns('users').includes('must_change_password');
    const pending=forced?db.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND must_change_password=1 AND active=1').get(u.tenant_id).n:null;
    const ok=guarded&&hashed&&!literal;
    items.push(item('anonymous_or_default_password','هل يوجد دخول مجهول أو كلمة مرور افتراضية؟',ok?'met':'not_met',
      [guarded?"app/auth.mjs: authenticate — بلا جلسة صالحة غير منتهية يفشل الطلب بـ401 login_required":'لا حارس جلسة في authenticate',
       hashed?'app/auth.mjs: passwordHash/verifyPassword — scrypt بملح لكل حساب ومقارنة ثابتة الزمن':'التحقق من كلمة المرور غير مبني على تجزئة بملح',
       literal?'يوجد نص كلمة مرور مكتوب داخل app/auth.mjs':'لا كلمة مرور مكتوبة داخل app/auth.mjs',
       forced?`عمود users.must_change_password موجود، وعدد الحسابات النشطة الملزمة بتغيير كلمتها الآن: ${pending}`:'لا عمود must_change_password في هذه القاعدة'],
      ok?'لا دخول مجهول: كل مسار يمر بجلسة. ولا كلمة مرور افتراضية في الكود؛ كلمة البيئة المحلية تُولَّد عشوائيًا وتُخزَّن مجزَّأة.':'راجع الأدلة أعلاه.'));
  }

  /* 6) إدارة الجلسات وانتهاؤها */
  if(!auth)items.push(item('session_lifecycle','هل تُدار الجلسات وتنتهي؟','not_verified',['تعذّرت قراءة app/auth.mjs'],'لم يُتحقق منه.'));
  else{
    const columns=s.columns('sessions'),expiry=columns.includes('expires_at'),csrf=columns.includes('csrf');
    const filtered=/expires_at>\?/.test(auth),rotated=/DELETE FROM sessions WHERE user_id=\? AND token_hash<>\?/.test(auth);
    const revoked=anySource(/DELETE FROM sessions WHERE user_id=\?/).length>0;
    const ok=expiry&&filtered&&rotated&&revoked;
    items.push(item('session_lifecycle','هل تُدار الجلسات وتنتهي؟',ok?'met':'not_met',
      [expiry?'جدول sessions يحمل expires_at و token_hash مجزَّأ، لا الرمز نفسه':'جدول الجلسات بلا تاريخ انتهاء',
       filtered?'app/auth.mjs: authenticate — يستبعد الجلسة المنتهية في الاستعلام نفسه':'الجلسة المنتهية غير مستبعدة',
       rotated?'app/auth.mjs: changePassword — تغيير كلمة المرور يلغي بقية جلسات الحساب':'تغيير كلمة المرور لا يلغي الجلسات الأخرى',
       revoked?'app/access.mjs: revokeAccess/setAdminLevel — سحب التصريح أو تغيير المستوى يقطع جلسات الحساب':'سحب التصريح لا يقطع الجلسة',
       csrf?'كل جلسة تحمل رمز CSRF يُتحقق منه في كل كتابة':'لا رمز CSRF في الجلسة'],
      ok?'نعم. الجلسة عمرها محدود بانتهاء مطلق مخزَّن، وتُلغى عند تغيير كلمة المرور أو سحب التصريح. **حدّ معلوم:** لا يوجد انتهاء بالخمول، ولا حد لعدد الجلسات المتزامنة — قرار المالك إن أراد أحدهما.':'راجع الأدلة أعلاه.'));
  }

  /* 7) الإصدار بتاريخ ماضٍ */
  if(!invoices)items.push(item('backdated_issue','هل يمكن إصدار فاتورة بتاريخ ماضٍ؟','not_verified',['تعذّرت قراءة app/invoices.mjs'],'لم يُتحقق منه.'));
  else{
    const action=body(invoices,'invoiceAction')??'';
    const serverTime=/const time=now\(\)/.test(action)&&/issued_at=\?/.test(action);
    const noInput=!/issued_at:\s*input/.test(invoices)&&!/input\.issued_at/.test(invoices);
    const futureSupply=/fail\(400,'supply_date'/.test(invoices);
    const ok=serverTime&&noInput;
    items.push(item('backdated_issue','هل يمكن إصدار فاتورة بتاريخ ماضٍ؟',ok?'met':'not_met',
      [serverTime?'app/invoices.mjs: invoiceAction — issued_at يُكتب من ساعة الخادم عند الإصدار لا من إدخال المستخدم':'تاريخ الإصدار يأتي من الإدخال',
       noInput?'لا حقل issued_at في أي مدخل من مدخلات الوحدة':'يوجد مسار يمرر تاريخ إصدار من الخارج',
       futureSupply?'تاريخ التوريد لا يكون مستقبليًا (fail 400 supply_date)، والماضي مسموح لأنه تاريخ واقعة لا تاريخ إصدار':'لا فحص على تاريخ التوريد',
       'TRIGGER tax_invoices_fixed — تاريخ الإصدار بعد كتابته لا يُعدَّل'],
      ok?'لا يمكن اختيار تاريخ إصدار. تاريخ التوريد الماضي مسموح عمدًا لأنه تاريخ الواقعة، ويظهر مستقلًا عن تاريخ الإصدار.':'راجع الأدلة أعلاه.'));
  }

  /* 8) تغيير تاريخ النظام */
  items.push(item('system_clock','هل يمكن تغيير تاريخ النظام؟','not_verified',
    ['المنصة تقرأ ساعة الخادم عبر now() في app/db.mjs ولا تكتبها، ولا توجد في أي وحدة دالة تضبط ساعة النظام',
     'ضبط ساعة الخادم ومزامنتها (NTP) خارج المنصة تمامًا، ولم يُتحقق منه هنا'],
    'لم يُتحقق منه: هذا ضابط على مستوى الخادم لا المنصة. **يحتاج قرار المالك:** من يملك صلاحية تغيير ساعة الخادم، وهل المزامنة مفعّلة ومسجّلة.'));

  /* 9) تغطية سجل التدقيق */
  if(!invoices)items.push(item('audit_coverage','هل يغطي سجل التدقيق كل فعل على الفاتورة؟','not_verified',['تعذّرت قراءة app/invoices.mjs'],'لم يُتحقق منه.'));
  else{
    const writes=[...invoices.matchAll(/export function (\w+)\(db,supplied[^)]*\)\{\s*writing\(db\);/g)].map(m=>m[1]);
    const missing=writes.filter(name=>!/audit\(/.test(body(invoices,name)??''));
    const reads=['listInvoices','getInvoice'].filter(name=>!/audit\(/.test(body(invoices,name)??''));
    const recorded=db.prepare("SELECT DISTINCT action FROM audit_events WHERE tenant_id=? AND entity_type IN ('tax_invoice','tax_profile','customer_tax_profile','einvoice_submission','einvoice_override') ORDER BY action").all(u.tenant_id).map(r=>r.action);
    const chain=verifyAudit(db);
    const ok=!missing.length&&!reads.length&&chain;
    items.push(item('audit_coverage','هل يغطي سجل التدقيق كل فعل على الفاتورة؟',ok?'met':'not_met',
      [`أفعال الكتابة في app/invoices.mjs: ${writes.join('، ')||'لا شيء'} — ${missing.length?`بلا تسجيل: ${missing.join('، ')}`:'كلها تستدعي audit()'}`,
       reads.length?`أفعال القراءة بلا تسجيل: ${reads.join('، ')} — فتح مستند أو طباعته أو تصديره لا يترك أثرًا`:'القراءة مسجّلة أيضًا',
       `الأفعال المسجّلة فعليًا في هذا الكيان: ${recorded.join('، ')||'لا شيء بعد'}`,
       `app/db.mjs: verifyAudit — سلسلة سجل التدقيق ${chain?'متصلة':'مكسورة'}`,
       'app/einvoice-gateway.mjs: كل فعل على الطابور والتجاوز يسجّل einvoice.channel_assigned / einvoice.attempted / einvoice.status_checked / einvoice.buyer_override'],
      ok?'نعم.':'جزئيًا فقط، فالجواب لا. **كل فعل كتابة** مسجّل بسلسلة بصمات متصلة، لكن **القراءة والطباعة والتصدير غير مسجّلة**: لا يمكن اليوم معرفة من فتح فاتورة أو صدّرها. هذه فجوة حقيقية تحتاج قرار المالك.'));
  }

  /* 10) الأسرار والمفاتيح */
  {
    const columns=['einvoice_submissions','einvoice_attempts','einvoice_archive','einvoice_counters','einvoice_buyer_overrides'].flatMap(table=>s.columns(table));
    const suspicious=columns.filter(name=>/key|secret|certificate|password|token|credential/i.test(name));
    const envReaders=anySource(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/);
    const disconnected=gateway().name==='disconnected';
    const ok=!suspicious.length&&disconnected;
    items.push(item('no_stored_secrets','هل تخزّن طبقة الفوترة مفتاحًا أو شهادة أو سرًا؟',ok?'met':'not_met',
      [suspicious.length?`أعمدة مشبوهة: ${suspicious.join('، ')}`:'لا عمود لمفتاح أو شهادة أو سر في أي جدول من جداول الهجرة 070',
       disconnected?`المزوّد الفعّال الآن: disconnected — ${NOT_CONNECTED}`:`المزوّد الفعّال الآن: ${gateway().name} — مزوّد محقون (اختبار)`,
       envReaders.length?`وحدات تقرأ أسرارًا من بيئة الخادم: ${envReaders.join('، ')} — خارج طبقة الفوترة`:'لا وحدة في طبقة الفوترة تقرأ سرًا من البيئة'],
      ok?'لا. لا مفتاح ولا شهادة ولا سر في القاعدة ولا في الكود. مكانها خزنة أسرار يقررها المالك عند الربط.':'راجع الأدلة أعلاه.'));
  }

  /* 11) الأرشيف والطابور */
  {
    const archived=s.has('trigger','einvoice_issue_archives'),immutable=s.has('trigger','einvoice_archive_no_update');
    const queued=s.has('trigger','einvoice_submission_flow'),attempts=s.has('trigger','einvoice_attempts_no_update');
    const orphans=db.prepare("SELECT COUNT(*) AS n FROM tax_invoices t WHERE t.tenant_id=? AND t.status='issued' AND NOT EXISTS(SELECT 1 FROM einvoice_archive a WHERE a.document_id=t.id)").get(u.tenant_id).n;
    const ok=archived&&immutable&&queued&&attempts&&orphans===0;
    items.push(item('archive_and_queue','هل يفلت مستند صادر من الأرشيف أو الطابور؟',ok?'met':'not_met',
      [archived?'TRIGGER einvoice_issue_archives — الإصدار نفسه يكتب نسخة الأرشيف ويفتح سجل الطابور':'الأرشفة تعتمد على الكود وحده',
       immutable?'الأرشيف بلا UPDATE وبلا DELETE':'الأرشيف قابل للتعديل',
       queued?'TRIGGER einvoice_submission_flow — حالات الطابور لا ترجع للوراء، والقرار النهائي مقفل، ولكل حالة سبب مكتوب':'حالات الطابور غير محكومة',
       attempts?'سجل المحاولات بلا UPDATE وبلا DELETE':'سجل المحاولات قابل للتعديل',
       `مستندات صادرة بلا نسخة أرشيف في هذا الكيان: ${orphans}`],
      ok?'لا. الأرشفة ودخول الطابور يحدثان بالمحفّز نفسه الذي يُصدر المستند، فلا يفلت مستند من أيهما.':'راجع الأدلة أعلاه.'));
  }

  const summary=Object.fromEntries(Object.keys(STATUS_NAMES).map(key=>[key,items.filter(i=>i.status===key).length]));
  return {checked_at:now(),user_id:u.id,disclaimer:DISCLAIMER,connection_state:NOT_CONNECTED,
    status_names:STATUS_NAMES,summary,items,
    note:'البنود التي حالتها «لم يُتحقق منه» لم تُفحص هنا ولم تُخمَّن. لا تعامل أي بند «مستوفى» على أنه شهادة توافق.'};
}
