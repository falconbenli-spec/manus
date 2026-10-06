// مُرسل البريد بلا تبعيات: fetch العام إلى واجهة HTTP لمزوّد يختاره المالك. لا SMTP (يحتاج عميل TLS مكتوبًا يدويًا).
// الإعداد من متغيرات البيئة وحدها، يضعها المالك عند تشغيل الخادم؛ لا يُخزَّن شيء منها في القاعدة ولا يُعرض المفتاح أبدًا.
//   MAIL_PROVIDER_URL  رابط HTTPS لنقطة الإرسال لدى المزود (مثل https://api.<provider>/emails)
//   MAIL_API_KEY       مفتاح المزود، يُرسل في ترويسة Authorization: Bearer
//   MAIL_FROM          عنوان المرسل من نطاق الشركة الموثّق لدى المزود (SPF وDKIM وDMARC)
// اختيارية:
//   MAIL_APP_URL       رابط المنصة الذي يفتحه الزر في الرسالة (HTTPS). بدونه تقول الرسالة «افتح المنصة» بلا رابط.
//   MAIL_FROM_NAME     اسم المرسل الظاهر. الافتراضي «منصة 3,6T».
//   MAIL_RATE_PER_MINUTE حد الإرسال في الدقيقة لكل كيان. الافتراضي 30، والأقصى 600.
//   MAIL_DELIVERY=off  مفتاح الإيقاف: يحجب كل بريد ولو اكتمل الإعداد.
// أي نقص يعني «غير مفعّل»، والعامل يحجب الرسائل (blocked) ولا يحاول الإرسال.

const EMAIL=/^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export const isEmail=value=>typeof value==='string'&&value.length<=180&&EMAIL.test(value);
const httpsUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u:null;}catch{return null;}};

export const NOT_CONFIGURED_MESSAGE='البريد غير مفعّل — يحتاج قرار المالك باختيار المزوّد';

// يعيد {enabled:true,...} أو {enabled:false,missing:[...],reason}. المفتاح لا يخرج من هذا الكائن إلى أي شاشة.
export function mailConfig(env=process.env){
  if(String(env.MAIL_DELIVERY??'').toLowerCase()==='off')return {enabled:false,missing:[],reason:'مفتاح الإيقاف MAIL_DELIVERY=off مفعّل'};
  const missing=[],invalid=[];
  const url=env.MAIL_PROVIDER_URL?httpsUrl(env.MAIL_PROVIDER_URL):null;
  if(!env.MAIL_PROVIDER_URL)missing.push('MAIL_PROVIDER_URL');else if(!url)invalid.push('MAIL_PROVIDER_URL (يلزم رابط https)');
  const key=typeof env.MAIL_API_KEY==='string'?env.MAIL_API_KEY.trim():'';
  if(!key)missing.push('MAIL_API_KEY');else if(key.length<8||/\s/.test(key))invalid.push('MAIL_API_KEY');
  const from=typeof env.MAIL_FROM==='string'?env.MAIL_FROM.trim():'';
  if(!from)missing.push('MAIL_FROM');else if(!isEmail(from))invalid.push('MAIL_FROM (عنوان بريد)');
  const app=env.MAIL_APP_URL?httpsUrl(env.MAIL_APP_URL):null;
  if(env.MAIL_APP_URL&&!app)invalid.push('MAIL_APP_URL (يلزم رابط https)');
  if(missing.length||invalid.length)return {enabled:false,missing,invalid,reason:NOT_CONFIGURED_MESSAGE};
  const rate=Number(env.MAIL_RATE_PER_MINUTE??30);
  return {enabled:true,provider:'json',url:url.href,key,from,fromName:String(env.MAIL_FROM_NAME??'منصة 3,6T').replace(/[\r\n<>"]/g,'').slice(0,80)||'منصة 3,6T',
    appUrl:app?app.origin+app.pathname.replace(/\/$/,''):null,ratePerMinute:Number.isInteger(rate)&&rate>=1&&rate<=600?rate:30};
}
// ما يجوز عرضه عن الإعداد: لا مفتاح، ولا مسار الرابط (قد يحمل معرّف حساب)، بل اسم المضيف فقط.
export function publicConfig(config){
  if(!config.enabled)return {enabled:false,missing:config.missing??[],invalid:config.invalid??[],reason:config.reason};
  return {enabled:true,provider:config.provider,provider_host:new URL(config.url).host,from:config.from,from_name:config.fromName,app_url:config.appUrl,rate_per_minute:config.ratePerMinute};
}

/* ───── القوالب ───── */
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const oneLine=value=>String(value??'').replace(/[\r\n\u2028\u2029]+/g,' ').replace(/\s+/g,' ').trim();
// سطر عام لكل فئة: الرسالة تنبيه ورابط فقط. لا عنوان إشعار ولا اسم طرف ولا مبلغ ولا رقم هوية ولا نوع إجازة
// (الإجازة المرضية بيان صحي)، فلا يتسرب شيء من هذه مهما كتبت الوحدات في نص الإشعار داخل المنصة.
const LINES={
  approvals:'لديك ما ينتظر قرارك أو تنفيذك في المنصة.',
  my_requests:'صدر تحديث على أحد طلباتك في المنصة.',
  hr_cases:'صدر تحديث على حالة لك لدى الموارد البشرية.',
  development:'لديك تحديث في التدريب أو تقييم الأداء أو كشف الوقت.',
  reminders:'لديك تذكير في المنصة.',
  security:'تنبيه أمني يخص المنصة. راجعه من داخلها.'
};
const SUBJECTS={approvals:'بانتظار قرارك',my_requests:'تحديث على طلب',hr_cases:'تحديث على حالة',development:'تحديث في التطوير والأداء',reminders:'تذكير',security:'تنبيه أمني'};
// هذه الأنماط لا تظهر في أي رسالة: أرقام طويلة (هوية، إقامة، حساب، جوال)، آيبان، مبالغ بعملة، كلمات الراتب والصحة.
export const FORBIDDEN_IN_MAIL=[/\d{6,}/,/\bSA\d{2}/i,/\d[\d,.]*\s*(?:SAR|ر\.س|ريال|﷼)/i,/(?:SAR|ريال)\s*\d/i,/راتب|الراتب|أجر\s|الأجر|مرض|تشخيص|طبي|صحي/];
export function assertMailSafe(message){
  for(const part of [message.subject,message.text,message.html])for(const pattern of FORBIDDEN_IN_MAIL)
    if(pattern.test(part))throw Object.assign(new Error('mail_content_forbidden'),{permanent:true});
  return message;
}
// notice: {category, link:'#…', recipientName?}. link تجزئة داخل المنصة فقط؛ غيرها يُرفض.
export function renderNotificationMail(notice,config){
  const category=LINES[notice.category]?notice.category:'my_requests';
  const hash=typeof notice.link==='string'&&/^#[a-z0-9/_-]{1,120}$/i.test(notice.link)?notice.link:'#notifications';
  const href=config?.appUrl?`${config.appUrl}/${hash}`:null;
  // الاسم وحده يُدرج، ويسقط إن طابق نمطًا ممنوعًا (اسم مثل «مرضي» يطابق نمط الصحة) فتبقى التحية عامة.
  const candidate=oneLine(notice.recipientName).slice(0,80),name=FORBIDDEN_IN_MAIL.some(p=>p.test(candidate))?'':candidate;
  const greeting=name?`مرحبًا ${name}،`:'مرحبًا،';
  const line=LINES[category],subject=`3,6T: ${SUBJECTS[category]}`;
  const footer='رسالة تنبيه آلية من منصة 3,6T. التفاصيل داخل المنصة فقط، ولا تحمل هذه الرسالة بيانات شخصية. لإيقاف البريد لهذه الفئة افتح «إعدادات الإشعارات» في المنصة.';
  const text=[greeting,'',line,href?`افتح المنصة: ${href}`:'افتح المنصة للاطلاع على التفاصيل.','','—',footer].join('\n');
  const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>`
    +`<body style="margin:0;padding:24px;background:#f5f5f7;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right;color:#1d1d1f">`
    +`<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">`
    +`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p><p style="margin:0 0 20px;font-size:16px">${escapeHtml(line)}</p>`
    +(href?`<p style="margin:0 0 20px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1d1d1f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">افتح المنصة</a></p>`:'<p style="margin:0 0 20px">افتح المنصة للاطلاع على التفاصيل.</p>')
    +`<p style="margin:0;color:#6e6e73;font-size:12px">${escapeHtml(footer)}</p></div></body></html>`;
  return assertMailSafe({subject,text,html});
}

/* ───── المحوّلات ───── */
// المحوّل يبني الطلب من الرسالة ويقرأ الرد. واجهته: {name, request(config,message)→{url,init}, parse(status,bodyText)→{providerId}}.
// محوّل JSON يطابق شكل واجهات البريد الشائعة: POST بجسم {from,to,subject,html,text} وBearer ومفتاح تكرار في الترويسة.
export const jsonAdapter={
  name:'json',
  request(config,message){
    return {url:config.url,init:{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':`Bearer ${config.key}`,'Idempotency-Key':message.idempotencyKey},
      body:JSON.stringify({from:`${config.fromName} <${config.from}>`,to:[message.to],subject:message.subject,html:message.html,text:message.text})}};
  },
  parse(status,bodyText){
    let data=null;try{data=JSON.parse(bodyText);}catch{}
    const id=data&&(data.id??data.messageId??data.MessageID??data.message_id??data.data?.id);
    return {providerId:typeof id==='string'||typeof id==='number'?String(id).slice(0,200):null};
  }
};
export const ADAPTERS={json:jsonAdapter};

// لا يخرج المفتاح ولا عنوان المستلم في رسالة خطأ تُخزَّن.
function scrub(text,config,to){
  let out=String(text??'');
  for(const secret of [config.key,to].filter(Boolean))out=out.split(secret).join('***');
  return oneLine(out).slice(0,300);
}
// يعيد {ok:true,providerId} أو {ok:false,retryable,status,error}. الشبكة والمهلة و429 و5xx قابلة للإعادة؛ غيرها نهائي.
export async function sendMail(config,message,{fetchImpl=globalThis.fetch,timeoutMs=15000,adapter=ADAPTERS[config.provider]??jsonAdapter}={}){
  if(!config?.enabled)return {ok:false,retryable:false,error:NOT_CONFIGURED_MESSAGE};
  if(!isEmail(message.to))return {ok:false,retryable:false,error:'عنوان المستلم غير صالح'};
  const {url,init}=adapter.request(config,message);
  let response,body='';
  try{
    response=await fetchImpl(url,{...init,signal:AbortSignal.timeout(timeoutMs)});
    body=await response.text().catch(()=>'');
  }catch(error){
    return {ok:false,retryable:true,error:scrub(error?.name==='TimeoutError'?'انتهت مهلة الاتصال بالمزود':`تعذر الاتصال بالمزود: ${error?.message??error}`,config,message.to)};
  }
  if(response.ok)return {ok:true,status:response.status,providerId:adapter.parse(response.status,body).providerId};
  const retryable=response.status===429||response.status>=500;
  return {ok:false,retryable,status:response.status,error:scrub(`رد المزود ${response.status}: ${body}`,config,message.to)};
}
