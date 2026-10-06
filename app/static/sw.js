/* /sw.js — عامل خدمة أدنى لمنصة 3,6T (REF-APP-FRONTEND P2-2).
   القواعد:
   1. لا يُخزَّن أي رد من /api ولا من /verify أبدًا: لا بيانات شخصية ولا مستندات مطبوعة في ذاكرة الجهاز.
   2. يُخزَّن الملف الثابت فقط (وحدات الواجهة والأنماط والخطوط والأيقونات والبيان)، والشبكة أولًا دائمًا: النسخة المخزنة للانقطاع فقط.
   3. التنقل (فتح الصفحة) من الشبكة أولًا؛ عند الانقطاع صفحة عربية ثابتة تقول إن الحضور والطلبات تحتاج اتصالًا. لا طابور حضور دون اتصال.
   4. الخروج يحذف النسخ (pwa.mjs clearOfflineCaches). */
const VERSION='2026-10-05.classicplus';
const CACHE='36t-static-'+VERSION;
const PRECACHE=['/app.mjs','/signature.mjs','/signature.css','/style.css','/cockpit.css','/executive-cockpit-ui.mjs','/admin-cockpit-ui.mjs','/workspace-ui.mjs','/workspace.css','/journey.css','/athar.css','/hr-design.css','/classic.css','/classic-plus.css','/studio.css','/riwaq.css','/yawm.css','/markaz.css','/depth.css','/theme-boot.js','/brand-logo.mjs','/manifest.webmanifest','/icons/icon-192.png'];
const STATIC=/^\/(?:[\w.-]+\.(?:mjs|css|js|webmanifest)|fonts\/[\w.-]+\.woff2|icons\/[\w.-]+\.png)$/;
const cacheable=url=>url.origin===self.location.origin&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/verify/')&&url.pathname!=='/sw.js'&&STATIC.test(url.pathname);
const OFFLINE_HTML='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>3,6T | لا يوجد اتصال</title><link rel="stylesheet" href="/style.css"></head><body><main class="empty" id="main"><strong>لا يوجد اتصال بالخادم</strong><p>لا يُسجَّل الحضور ولا تُرسل الطلبات دون اتصال بالخادم. أعد المحاولة حين يعود الاتصال.</p><p><a class="btn outline" href="/">إعادة المحاولة</a></p></main></body></html>';
const OFFLINE_HEADERS={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'"};

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(PRECACHE.map(path=>cache.add(new Request(path,{cache:'reload'})).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('36t-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{
  if(event.data?.type==='logout')event.waitUntil?.(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('36t-static-')).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  // /api و/verify: يمران إلى الشبكة كما هما، بلا respondWith وبلا نسخة.
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/verify/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>new Response(OFFLINE_HTML,{status:503,headers:OFFLINE_HEADERS})));
    return;
  }
  if(!cacheable(url))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(request).then(hit=>hit||Response.error())));
});
