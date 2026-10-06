// أدوات اختبارات الشاشات الموصولة بخادم الحزمة 4: الشاشة تُحمَّل بحمولة الخادم الحقيقي (createApp بلا منفذ، بالجلسة وCSRF)، وتُرسم كما
// يرسمها app.mjs (العدّة ui وزرٌّ بسماته)، ثم يُرسل نموذجها إلى نقطة نهايته بحمولته هو وبمفتاح التكرار حين يعلنه — فلا يمر اختبار على
// زرٍّ يُرسم ويُرفض، ولا على نموذج يرسل ما لا يقبله الخادم. بلا listen: تمر حيث يُمنع فتح منفذ.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app/server.mjs';
import { kit } from '../app/static/kit.mjs';
import { money } from '../app/static/operations.mjs';
import { dispatch, PASSWORD } from './definitions-fixture.mjs';

const DAY=86400000;
export const riyadh=(offset=0)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*DAY));
// سياق الرسم كما يمرره app.mjs في موضعه الواحد: e وbutton بسماته وmoney والعدّة ui.
export const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const context=view=>({e,money,tr:ar=>ar,lang:'ar',ui:kit(e),
  button:(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="${e(view)}" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`});
export const buttonsOf=html=>[...html.matchAll(/data-operation="([a-z_]+)" data-id="([^"]*)">([^<]*)</g)].map(m=>({action:m[1],id:m[2],label:m[3]}));
export const named=(html,id)=>buttonsOf(html).filter(b=>b.id===id).map(b=>[b.action,b.label]);
export const cardOf=(html,needle)=>html.split('<details class="vn-card"').slice(1).find(chunk=>chunk.includes(needle))??'';
export const panelOf=(html,id)=>html.split('<section class="panel"').slice(1).find(chunk=>chunk.startsWith(` data-id="${id}"`))??'';
// رفض الخادم كما يرميه api() في app.mjs: الرسالة والرمز والتفاصيل (فيها الرفض المكتوب)، فيرسمه ui.refusal كما يرسمه الغلاف.
export const errorOf=response=>{const body=response.json();return Object.assign(new Error(body.error?.message??''),{code:body.error?.code??null,details:body.error?.details??null});};
export const usersOf=db=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));

// جلسات حقيقية بلا منفذ: GET للتحميل كما تفعل الشاشة (api)، والحفظ كما يحفظه الغلاف: المسار وحمولة toPayload ومفتاح التكرار إن أُعلن.
export async function screens(db,names){
  const app=createApp(db),auth={};
  for(const username of names){
    const r=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    assert.equal(r.status,200,`login ${username}: ${r.text.slice(0,200)}`);
    auth[username]={cookie:r.headers['Set-Cookie'].split(';')[0],csrf:r.json().csrf};
  }
  const headers=(who,extra={})=>({cookie:auth[who].cookie,'x-csrf-token':auth[who].csrf,origin:'http://127.0.0.1:3600',...extra});
  const api=who=>async path=>{
    const r=await dispatch(app,{path:'/api'+path,headers:headers(who)}),body=r.json();
    if(r.status>=400)throw Object.assign(new Error(body.error?.message??String(r.status)),{status:r.status,code:body.error?.code??null,details:body.error?.details??null});
    return body;
  };
  const submit=(who,spec,values)=>dispatch(app,{method:spec.method||'POST',path:'/api'+(spec.dynamicEndpoint?spec.dynamicEndpoint(values):spec.endpoint),
    headers:headers(who,spec.idempotent?{'idempotency-key':`ui-wiring-${randomUUID()}`}:{}),body:spec.toPayload(values)});
  return {api,submit};
}
