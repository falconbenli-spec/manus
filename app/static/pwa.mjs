// التطبيق القابل للتثبيت (REF-APP-FRONTEND P2-1 وP2-2). عامل الخدمة يُسجَّل في سياق آمن فقط: HTTPS أو localhost.
// كل شيء محروس: الصندوق التجريبي في الاختبارات بلا navigator ولا caches، وفشل التسجيل لا يوقف الصفحة.
export const CACHE_PREFIX='36t-static-';
export function secureOrigin(loc){
  try{return loc?.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(loc?.hostname);}catch{return false;}
}
export function registerServiceWorker(){
  try{
    if(typeof navigator==='undefined'||!('serviceWorker' in navigator)||typeof location==='undefined'||!secureOrigin(location))return false;
    navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
    return true;
  }catch{return false;}
}
// الخروج على جهاز مشترك: تُحذف نسخ الملفات الثابتة ويُلغى تسجيل العامل. لا يحفظ العامل بيانات شخصية أصلًا (لا /api)،
// لكن الحذف يمنع أن يبقى أثر للجلسة على الجهاز.
export async function clearOfflineCaches(){
  try{
    if(typeof caches!=='undefined'){for(const key of await caches.keys())if(key.startsWith(CACHE_PREFIX))await caches.delete(key);}
    if(typeof navigator!=='undefined'&&navigator.serviceWorker?.getRegistrations){for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();}
  }catch{}
}
