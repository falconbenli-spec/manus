import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { createApp, isLoopbackAddress } from '../app/server.mjs';
import { CAPABILITIES } from '../app/access.mjs';

// فحص جاهزية الوصول عن بُعد. يقرأ الإعدادات القائمة وقاعدة البيانات ويقول ما هو كائن الآن، لا ما سيكون.
// لا يضبط شيئًا ولا يفتح نفقًا ولا يقرأ سرًا: الأسرار يضعها المالك بنفسه في .env، وهذا الملف لا يلمسها.
// ما ليس جاهزًا يُطبع بالوضوح نفسه الذي يُطبع به الجاهز، وما لا يمكن معرفته يُعلن «غير معلوم» ولا يُخمَّن.

const READY='جاهز', NOT='غير جاهز', UNKNOWN='غير معلوم';
const truthy=value=>['1','true','yes'].includes(String(value??'').toLowerCase());

// شهادة حيّة على طبقة النقل: تُبنى نسخة من الخادم بالإعدادات نفسها، ويُرسَل إليها طلب يحاكي ما يرسله النفق.
// وجود ترويسة HSTS في الرد يعني أن الخادم رأى الطلب مشفرًا، وهو المحدِّد نفسه الذي تتبعه راية Secure على ملف الجلسة.
async function transportProbe(db,{trustProxy,allowedHost}) {
  const server=createApp(db,{trustProxy,allowedHost});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const host=allowedHost??'127.0.0.1';
    const headers=name=>({host:`${host}:${server.address().port}`,...(name?{[name]:'https'}:{})});
    const tunnelled=await fetch(base+'/',{headers:headers('x-forwarded-proto')});
    const plain=await fetch(base+'/',{headers:headers(null)});
    return {
      https_when_tunnelled:!!tunnelled.headers.get('strict-transport-security'),
      https_on_plain_http:!!plain.headers.get('strict-transport-security'),
      host_accepted:tunnelled.status!==403
    };
  } finally { await new Promise(done=>server.close(done)); }
}

function lastBackup(dir) {
  let files=[];
  try { files=readdirSync(dir).filter(f=>f.endsWith('.sqlite')).map(f=>({file:f,at:statSync(join(dir,f)).mtime})); }
  catch { return {known:false,reason:'لا مجلد نسخ احتياطية على هذا المسار'}; }
  if(!files.length) return {known:false,reason:'المجلد موجود ولا نسخة فيه'};
  const newest=files.sort((a,b)=>b.at-a.at)[0];
  let check=null;
  try { check=JSON.parse(readFileSync(join(dir,'last-restore-check.json'),'utf8')); } catch {}
  return {known:true,file:newest.file,at:newest.at,count:files.length,
    days:Math.floor((Date.now()-newest.at.getTime())/86400000),
    restore_passed:check?check.passed===true:null,restore_backup:check?.backup??null};
}

export function readiness(db,env=process.env,root=fileURLToPath(new URL('../',import.meta.url))) {
  const trustProxy=truthy(env.TRUST_PROXY), allowedHost=env.LOCAL_ALLOWED_HOST??null;
  const bindHost=env.LOCAL_BIND_HOST??'127.0.0.1';
  const sensitive=CAPABILITIES.filter(c=>c.sensitive);
  const keys=sensitive.map(c=>c.key), roles=[...new Set(sensitive.flatMap(c=>c.roles??[]))];
  const marks=keys.map(()=>'?').join(','), roleMarks=roles.map(()=>'?').join(',')||"''";
  const holders=db.prepare(`SELECT DISTINCT x.id,x.name,x.username,x.tenant_id FROM users x
    LEFT JOIN access_grants g ON g.user_id=x.id AND g.revoked_at IS NULL AND g.capability IN (${marks})
    WHERE x.active=1 AND (g.id IS NOT NULL OR x.role IN (${roleMarks})) ORDER BY x.name`).all(...keys,...roles)
    .map(h=>({...h,mfa:!!db.prepare('SELECT 1 FROM user_totp WHERE user_id=? AND enabled_at IS NOT NULL').get(h.id)}));
  const withoutMfa=holders.filter(h=>!h.mfa);
  const policy=db.prepare('SELECT tenant_id,require_mfa_for_sensitive FROM security_settings').all();
  const enforcing=policy.filter(r=>r.require_mfa_for_sensitive);
  const ownerSet=db.prepare('SELECT id,name,username FROM users WHERE active=1 AND must_change_password=1 ORDER BY name').all();
  const sessions=db.prepare('SELECT address FROM sessions WHERE expires_at>?').all(Date.now());
  return {
    trustProxy,allowedHost,bindHost,
    bindLoopback:isLoopbackAddress(bindHost)||bindHost==='localhost',
    holders,withoutMfa,enforcing,ownerSet,
    policyRows:policy.length,
    sessions:{total:sessions.length,
      remote:sessions.filter(s=>s.address&&!isLoopbackAddress(s.address)).length,
      unknown:sessions.filter(s=>!s.address).length},
    backup:lastBackup(resolve(root,env.BACKUP_DIR??'work/backups/auto'))
  };
}

function print(state,probe) {
  const lines=[], flag=(ok,label,detail)=>lines.push(`${ok===null?'[ '+UNKNOWN+' ]':ok?'[ '+READY+' ]':'[ '+NOT+' ]'}  ${label}\n            ${detail}`);

  flag(probe?probe.https_when_tunnelled:null,'النقل مشفَّر عبر النفق',
    !probe?'لم يُجرَ الفحص الحي.'
    :probe.https_when_tunnelled?'الخادم يقرأ x-forwarded-proto من النفق ويعامل الطلب كطلب مشفَّر (ترويسة HSTS تظهر في الرد).'
    :'الخادم يعامل الطلب القادم من النفق كطلب HTTP عادي. السبب: TRUST_PROXY غير معلن. النتيجة: لا HSTS، ولا راية Secure على ملف الجلسة، ورفض كل كتابة بـ403 origin_denied لأن المتصفح يرسل مصدرًا بـhttps.');

  flag(!probe||!probe.https_on_plain_http,'لا ادعاء تشفير على HTTP المحلي',
    probe&&probe.https_on_plain_http?'الخادم يعلن HSTS على طلب غير مشفَّر — خلل.':'طلب محلي بلا ترويسة النفق لا يُعامل كمشفَّر، فلا يعلّق المتصفح على HTTPS لمضيف لا يخدمه.');

  flag(state.trustProxy,'TRUST_PROXY معلن ومحروس بالاسترجاع',
    state.trustProxy?'معلن. الترويسة x-forwarded-for لا تُقرأ إلا إذا كان الطرف المتصل عنوان استرجاع (النفق يتصل من هذا الجهاز)، وتؤخذ الحلقة الأخيرة وحدها.'
    :'غير معلن. كل موظف سيُحتسب بعنوان الاسترجاع نفسه: عشر محاولات خاطئة من شخص واحد تقفل الحساب أمام الجميع، وسجل التدقيق يسجل عنوان الجهاز لا عنوان الموظف.');

  flag(probe?probe.https_when_tunnelled:null,'ملف الجلسة سيحمل راية Secure',
    !probe?'لم يُجرَ الفحص الحي.'
    :probe.https_when_tunnelled?'الراية تتبع النقل الفعلي، والنقل عبر النفق مشفَّر، فستُرسل.'
    :'لن تُرسل. أي طلب HTTP عابر يقع سهوًا سيحمل ملف الجلسة نصًا.');

  flag(state.bindLoopback,'الخادم مربوط على عنوان الاسترجاع',
    state.bindLoopback?`LOCAL_BIND_HOST = ${state.bindHost}. الخادم غير مسموع من الشبكة المحلية؛ النفق وحده يصله.`
    :`LOCAL_BIND_HOST = ${state.bindHost}. الخادم مسموع من الشبكة المحلية بلا تشفير. النفق لا يحتاج هذا: احذف المتغير.`);

  flag(!!state.allowedHost,'قائمة العناوين المسموحة',
    state.allowedHost?`LOCAL_ALLOWED_HOST = ${state.allowedHost}${probe&&!probe.host_accepted?' — لكن الخادم ردّ الطلب بهذا العنوان. راجع الكتابة.':'. العنوان يُقبل، وما عداه (بما في ذلك عنوان شبيه) يُرفض بـ403.'}`
    :'غير معلن. لن يُقبل إلا 127.0.0.1 و localhost، فطلب النفق باسمه سيُرفض بـ403 host_denied.');

  const holders=state.holders.length, missing=state.withoutMfa.length;
  flag(holders===0?null:missing===0,'التحقق بخطوتين لحاملي التصاريح الحساسة',
    holders===0?'لا حساب نشط يحمل تصريحًا حساسًا في هذه القاعدة.'
    :missing===0?`${holders} من ${holders} من حاملي التصاريح الحساسة فعّلوا التحقق بخطوتين.`
    :`${missing} من ${holders} من حاملي التصاريح الحساسة بلا تحقق بخطوتين: ${state.withoutMfa.map(h=>h.name).join('، ')}.\n            هؤلاء يفتحون الرواتب والجزاءات بكلمة مرور وحدها من الإنترنت المفتوح.`);

  flag(state.enforcing.length>0,'سياسة إلزام التحقق بخطوتين',
    state.enforcing.length>0?`مفروضة على ${state.enforcing.length} كيانًا. التصريح الحساس لا يعمل لحساب لم يفعّل التحقق.`
    :`غير مفروضة (الافتراضي). فرضها قرار المالك من شاشة الأمان، ويوقف فورًا التصاريح الحساسة لـ${missing} حسابًا.`);

  flag(state.ownerSet.length===0,'كلمات المرور التي وضعها المالك',
    state.ownerSet.length===0?'لا حساب نشط ما زال على كلمة مرور مؤقتة.'
    :`${state.ownerSet.length} حسابًا نشطًا ما زال على كلمة المرور التي سُلّمت له ولم يغيّرها: ${state.ownerSet.map(u=>u.name).join('، ')}.`);

  const b=state.backup;
  flag(b.known?b.days<=7&&b.restore_passed!==false:null,'النسخ الاحتياطي',
    !b.known?`${b.reason}. الجهاز هو النسخة الوحيدة من بيانات الشركة.`
    :`آخر نسخة: ${b.file} قبل ${b.days} يومًا (${b.count} نسخة محفوظة). تجربة الاستعادة: ${b.restore_passed===true?'نجحت':b.restore_passed===false?'فشلت':'لم تُسجَّل'}.`);

  lines.push(`\nالجلسات السارية الآن: ${state.sessions.total} — منها ${state.sessions.remote} من عنوان بعيد، و${state.sessions.unknown} بلا عنوان مسجَّل (فُتحت قبل ترحيل 119).`);
  return lines.join('\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  try{process.loadEnvFile(resolve(root,'.env'));}catch(error){if(error.code!=='ENOENT')console.error('Could not read .env:',error.code??error.message);}
  const db=openDb(resolve(root,process.env.LOCAL_DB_PATH??'work/local.sqlite'));
  try{
    const state=readiness(db);
    let probe=null;
    try{ probe=await transportProbe(db,{trustProxy:state.trustProxy,allowedHost:state.allowedHost}); }
    catch(error){ console.error('تعذّر الفحص الحي للنقل:',error.message); }
    console.log('فحص جاهزية الوصول عن بُعد — '+new Date().toISOString());
    console.log('يقرأ هذا الفحص الإعدادات والقاعدة القائمة. لا يضبط شيئًا ولا يقرأ أي سر.\n');
    console.log(print(state,probe));
    const blocking=[!probe?.https_when_tunnelled,!state.trustProxy,!state.bindLoopback,!state.allowedHost].filter(Boolean).length;
    console.log(`\n${blocking?`${blocking} بندًا يمنع التشغيل عن بُعد اليوم.`:'بنود النقل والعنوان والربط مكتملة.'}`);
    console.log('ما يبقى بعد اكتمالها مخاطرة قائمة لا عطب: كلمة مرور وحدها على الإنترنت، وجهاز واحد لا ثاني له، وبلا مراجعة أمنية خارجية.');
  } finally { db.close(); }
}
