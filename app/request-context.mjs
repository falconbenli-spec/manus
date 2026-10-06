// سياق الطلب الواحد (ترحيل 123، «جرّب كمستخدم»): حامل صغير بلا أي استيراد من المنصة، فتقرؤه access.mjs وdelegations.mjs
// وfinance.mjs وdb.mjs بلا دورة استيراد. المرفق الوحيد الجديد node:async_hooks — مدمج في Node، لا اعتمادية npm.
//
// يُلفّ معالج الطلبات مرة واحدة بـrunRequest، ويُملأ المخزن عند نقطة المصادقة في app/server.mjs. run() بمخزن قابل للتعديل
// واجهة مستقرة؛ enterWith تجريبية فلا تُستعمل. خارج أي طلب (سكربت، اختبار يستدعي وحدة مباشرة) لا مخزن، فتعيد viewing() القيمة
// null ويجري كل شيء كما كان.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage=new AsyncLocalStorage();
export const runRequest=fn=>storage.run({viewing:null,lockWaitMs:0,transactions:0},fn);
// انتظار قفل الكتابة (TP2.6): BEGIN IMMEDIATE يحجز قفل الكاتب، وانتظاره هو المقياس الذي يسبق
// كل تباطؤ في قاعدة بملف واحد. يُجمَع هنا لأنه يقع في db.mjs ويُقرأ في server.mjs، ولا ثالث بينهما.
export function noteLockWait(ms){const store=storage.getStore();if(store){store.lockWaitMs+=ms;store.transactions++;}}
export const requestMetrics=()=>{const store=storage.getStore();
  return store?{lock_wait_ms:Math.round(store.lockWaitMs),transactions:store.transactions}:null;};
export function setViewing(value){const store=storage.getStore();if(store)store.viewing=value??null;}
export const viewing=()=>storage.getStore()?.viewing??null;
// هل هذا الحساب هو من يجرّب الآن؟ الخفض يقع على صاحب التجربة وحده: capabilityHolders تمشي كل الحسابات في الطلب نفسه،
// ولا يجوز أن يُخفَّض غيره.
export const viewingAs=user=>{const v=viewing();return v&&user&&v.actor_id===user.id?v:null;};
