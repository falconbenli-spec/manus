// «طلباتي» (G5): قائمة واحدة بكل ما قدّمه الموظف، من الدليل ومن وحدات الموارد البشرية والمالية، بكلمات حالة موحدة.
// الصفحة للقراءة: كل صف يفتح شاشة الطلب نفسها، والقرار والتعديل يجريان هناك بقواعدها.
// ما ينتظرك أول الصفحة («ينتظر ردك»)، ثم ما هو عند غيرك، ثم المغلق مطويًّا؛ ورقم كل بلاطة طول القائمة التي تسمّيها.
import { dual } from './dates.mjs';
// مرحلة الطالب (الدفعة الثالثة من مركز الخدمات): عبارة «ينتظر ردك» من القاموس (REQUESTER_STAGES.needs_you) لا نسخة هنا.
import { REQUESTER_STAGES } from './vocabulary.mjs';
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');};
const fallbackTr=ar=>ar;
const NEEDS_YOU=REQUESTER_STAGES.needs_you;
const ISO_DAY=/^\d{4}-\d{2}-\d{2}/;

// الصف: العنوان يفتح سجله، ثم مصدره وشارة حالته من القاموس (ui.statusBadge)، و«ينتظر ردك» حين يكون عندك، وموعده إن كان له.
// الموعد ليس حالة: كان يُرسم بشارة «معتمد» (شكل المنجز) و«مرفوض»، فصار وسمًا بكلمته وتاريخه، وأحمر حين يفوت وحده.
export function requestRows(items,{e,tr=fallbackTr,lang='ar',ui}){
  const en=lang!=='ar';
  const day=(iso,text=en?iso:dual(iso))=>ISO_DAY.test(String(iso??''))?`<time datetime="${e(String(iso).slice(0,10))}">${e(text)}</time>`:e(text??'—');
  return items.map(i=>`<li class="${i.overdue?'is-late':i.needs_you?'is-due':i.open?'':'is-old'}" data-source="${e(i.source)}" data-status="${e(i.status)}"><a href="${e(i.link)}"><strong>${e(i.title)}</strong></a>
    <span class="eu-chips"><span class="pill">${e(en?i.source_name_en:i.source_name)}</span>${ui.statusBadge(i.status)}${i.needs_you?`<span class="pill is-due">${tr(NEEDS_YOU[0],NEEDS_YOU[1])}</span>`:''}${i.due_on?`<span class="pill${i.overdue?' is-late':''}">${i.overdue?tr('فات موعده','Past due'):tr('موعده','Due')} ${day(i.due_on)}</span>`:''}</span>
    <small>${tr('قُدّم','Submitted')} ${day(i.submitted_on,i.submitted_on)}${i.module_status&&!en?` · ${e(i.module_status)}`:''}${i.due_note&&!en?` · ${e(i.due_note)}`:''}</small></li>`).join('');
}

export const myRequestsUI={
  title:'طلباتي',title_en:'My requests',
  description:'كل طلب قدّمته، من أي شاشة، في قائمة وحدة: حالته، وموعده إذا له زمن محدد، ورابطه.',
  description_en:'Every request you made, from any screen, in one list: its status, its due date where a service level is set, and its link.',
  load:api=>api('/my-requests'),
  render(data,{e,tr=fallbackTr,lang='ar',ui}){
    const en=lang!=='ar',items=data.items||[];
    // التجميع بمرحلة الطالب حين تحملها الحمولة (stage من stageOf في الخادم)، وبعلمَي needs_you/open لحمولةٍ أقدم:
    // النتيجة واحدة بالبناء — «ينتظر ردك» هي المرحلة needs_you، و«مغلقة» هي المراحل الثلاث المنتهية.
    const needs=items.filter(i=>i.stage?i.stage==='needs_you':i.needs_you),open=items.filter(i=>i.open&&!needs.includes(i)),closed=items.filter(i=>!i.open);
    // م0 «السور»: tile من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية.
    const {tile,empty}=ui;
    const group=(id,title,list,none,openByDefault=true)=>list.length?`<details class="vn-group eu-group" id="${id}"${openByDefault?' open':''}><summary><h2>${e(title)} <span>${list.length}</span></h2></summary><ul class="vn-list">${requestRows(list,{e,tr,lang,ui})}</ul></details>`
      :(none?`<section class="vn-group eu-group" id="${id}"><h2>${e(title)} <span>0</span></h2><p class="subtle">${e(none)}</p></section>`:'');
    const c=data.counts||{};
    const head=`<section class="panel panel-body vn-head"><p class="measure">${en?'Each request opens in its own screen. A due date appears where the service owner set a service level; leave, expenses and letters have none approved yet.':e(data.note)}</p>
      <div class="operation-actions"><a class="btn primary" href="#catalog/new">${tr('طلب جديد','New request')}</a><a class="btn outline" href="#my-request-timeline">${tr('وين وصلت طلبات الدليل؟','Where are my catalog requests?')}</a></div>
      ${data.unavailable?.length?`<p class="subtle">${tr('مصادر ما يفتحها حسابك، فما انحسبت هنا:','Sources your account cannot open, not counted:')} ${e(data.unavailable.join('، '))}</p>`:''}</section>`;
    // البلاطات بيان لا روابط: كانت تقود إلى #my-requests نفسها (نقرة لا تفعل شيئًا). ورقم كل بلاطة طول القائمة التي تسمّيها تحتها.
    const tiles=`<div class="vn-tiles">${tile(needs.length,tr(NEEDS_YOU[0],NEEDS_YOU[1]),needs.length?'is-due':'')}${tile(open.length,tr('عند غيرك','With someone else'))}${tile(c.overdue??0,tr('فات موعده','Past due'),c.overdue?'is-late':'')}${tile(closed.length,tr('مغلق','Closed'),'is-old')}</div>`;
    if(!items.length)return `${head}<section class="panel">${empty(tr('ما قدّمت طلب للحين','You have no requests yet'),tr('تبدأ من «طلب جديد» فوق، أو من «إنشاء» في الرئيسية — وكل طلب تقدّمه يطلع هنا بحالته.','Start from “New request”, or from Create on Home — every request you make shows here with its status.'))}</section>`;
    return `${head}<section class="vn-board">${tiles}${group('mr-needs',tr(NEEDS_YOU[0],NEEDS_YOU[1]),needs,'')}${group('mr-open',tr('عند غيرك','With someone else'),open,tr('ما عندك طلب مفتوح عند غيرك الحين.','Nothing is open with someone else.'))}${group('mr-closed',tr('مغلقة','Closed'),closed,'',false)}</section>`;
  },
  form(){guard(false);}
};
