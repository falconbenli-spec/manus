// خريطة الربط (#integrations): كل جهة بحالتها وأساسها وما ينقصها، ولا يُقال «متصل» إلا بدليل مستقل.
// الحالة بمفردات العقد (app/integration-readiness.mjs INTEGRATION_STATUS): محاكاة، أو جاهز لبيئة اختبار، أو موقوف. «متصل» لا يُرسم إلا بدليل مستقل، ولا شيء اليوم كذلك.
// يرسمها app.mjs بسياق {e} وحده، فالعدّة تُبنى هنا من kit نفسها.
import { kit } from './kit.mjs';
// الحالة شكلٌ وكلمة: الموقوف خامل لا رفض (ينتظر قرارًا أو وصولًا)، والمحاكاة والجاهز لبيئة الاختبار بشكل الانتظار، والمتصل منجز.
const TONE={blocked:'suspended','sandbox-ready':'awaiting',simulated:'pending',active:'active'};
// ما ينتظر قرارًا أولًا: الموقوف، ثم الجاهز لبيئة اختبار، ثم المحاكاة، ثم المتصل.
const ORDER=['blocked','sandbox-ready','simulated','active'];
export function integrationCards(data,{e}) {
  const ui=kit(e),connections=data.connections??[];
  // عبارة العقد «الكلمة — شرحها»: الكلمة في الشارة والعنوان، والشرح سطرٌ واحد تحت عنوان المجموعة لا في كل بطاقة.
  const split=c=>{const [word,...rest]=String(c.status_name??'غير متصل').split(' — ');return {word,about:rest.join(' — ')};};
  const keys=[...ORDER.filter(k=>connections.some(c=>c.status===k)),...new Set(connections.filter(c=>!ORDER.includes(c.status)).map(c=>c.status))];
  const groups=keys.map(key=>({key,list:connections.filter(c=>c.status===key)}));
  // الأرقام من القائمة نفسها: كل بلاطة طول مجموعتها تحتها.
  const tiles=groups.map(g=>ui.tile(g.list.length,split(g.list[0]).word)).join('');
  const connected=connections.some(c=>c.status==='active');
  const head=`<section class="panel"><div class="panel-head"><h2>خريطة الربط</h2><span class="badge ${connected?'active':'none'}">${connected?'فيه تكامل متصل بدليل مستقل':'ما فيه تكامل متصل'}</span></div><div class="panel-body">`
    +`<p class="measure">${e(data.reason)}</p>${tiles?`<div class="vn-tiles">${tiles}</div>`:''}`
    +`<p>الأحداث المحجوبة: <strong>${e(data.blocked_events)}</strong></p>${data.mail?`<p>البريد: <strong>${e(data.mail.message)}</strong> · محجوب ${e(data.mail.blocked)} · فشل ${e(data.mail.failed)}</p>`:''}`
    +`<p class="subtle">كل جهة تحت تحتاج تنفيذ وتحقق مستقل، وإضافة اسم منصة ما تفعّل اتصال بها.</p></div></section>`;
  // الجهة: اسمها وشارة حالتها، ثم غرضها وأساس حالتها، ثم حال موصلها وآخر نجاح خارجي من الحمولة نفسها (لا جملة ثابتة تكذب يوم يُنفَّذ
  // موصل)، ثم ما ينقصها للتفعيل مطويًّا بعدّه (الموانع نفسها تتكرر في الجهات).
  const connectionRow=c=>ui.row({title:c.name,html:`<span class="badge ${e(TONE[c.status]??'none')}">${e(split(c).word)}</span>`
    +`<span>${e(c.purpose)}</span>${c.status_basis?`<small>${e(c.status_basis)}</small>`:''}<small>${c.adapter_implemented?'الموصل منفذ':'الموصل غير منفذ'} · آخر نجاح خارجي: ${c.last_success?`<time datetime="${e(c.last_success)}">${e(String(c.last_success).slice(0,10))}</time>`:'ما فيه'}</small>`
    +`${(c.blockers??[]).length?`<details><summary>${e(`اللي ينقصها للتفعيل (${c.blockers.length})`)}</summary><ul>${c.blockers.map(item=>`<li>${e(item)}</li>`).join('')}</ul></details>`:''}`});
  return head+groups.map(g=>{const {word,about}=split(g.list[0]);
    return `<section class="vn-group"><h2>${e(word)} <span>${g.list.length}</span></h2>${about?`<p>${e(about)}</p>`:''}<ul class="vn-list">${g.list.map(connectionRow).join('')}</ul></section>`;}).join('');
}
