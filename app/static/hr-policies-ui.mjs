// «سياسات الموارد البشرية»: شاشة واحدة لكل سياسة بنصها ومادتها وحالتها، مع قبولها أو رفضها من مكانها،
// السياسة المعتمدة تُقرأ بنصها وسندها وحدهما: من أعدها ومن قررها وأساس قراره في سجل التدقيق لا على الشاشة.
// يبقى اسم المُعد على المسودة وحدها لأن القارئ يحتاج أن يعرف من يراجع، ويبقى سبب الرفض لأنه محتوى القرار.
// وقائمة جاهزية تقول ما الذي ما زال يمنع تشغيل وحدات الموارد البشرية وأين يُصلَح.
// الشاشة لا تملك نقطة كتابة خاصة: كل قبول أو رفض يُرسل إلى نقطة النهاية الأصلية لوحدة السياسة، فتبقى قاعدة الشخصين
// وفحص التصريح حيث كُتبا. accept_path وreject_path يأتيان من الخادم، فما لا يحق للمستخدم لا يصل إليه أصلًا.
// الترتيب (better-layout): ما ينتظر قرار القارئ أولًا، ثم ما يمنع التشغيل، ثم كل السياسات، ثم القيم المشتركة مرجعًا.
// القوائم الطويلة تُطوى في <details> يقول ملخّصه ما يخفيه وكم، والمكتمل يُطوى دائمًا: المنتهي صامت.
import { dual } from './dates.mjs';
import { kit } from './kit.mjs';
import { NAV_DEST, LENS } from './nav-map.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const tile=(e,value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const LABELS={accept_policy:'اعتماد السياسة',reject_policy:'رفض المسودة'};
// لون الصف لما يحتاج انتباهًا وحده: المسودة تنتظر قرارًا، والمرفوضة والمستبدلة خاملة، والمعتمدة صامتة.
const tone=s=>s==='draft'?'is-due':s==='rejected'||s==='retired'?'is-old':'';
// شارة الحالة بكلمة الخادم وشكل الحالة من أصناف الشارة القائمة (signature.css): الحالة تُقرأ من بعيد بشكل وكلمة.
const BADGE_TONE={accepted:'accepted',draft:'pending',rejected:'rejected',retired:'superseded'};
// قيمة لاتينية داخل نص عربي من الخادم (مفتاح تصريح بين علامتي `…`، رمز قالب، رقم بند) تُعزل باتجاهها، والنص نفسه لا يُمس.
const isolate=(e,text)=>String(text??'').split(/(`[^`]+`|\{\{\w+\}\}|[A-Za-z][\w.\-\/@]*\w)/).map((part,i)=>i%2?(part.startsWith('`')?`<code>${e(part.slice(1,-1))}</code>`:`<bdi>${e(part)}</bdi>`):e(part)).join('');
const when=(e,iso)=>`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(iso))}</time>`;
const count=(e,n)=>`(<span data-num>${e(n)}</span>)`;
// اسم الشاشة التي يقود إليها الرابط بدل الرابط الخام: اسم عدسة الموارد البشرية إن وُجد، ثم اسم القائمة.
const SELF='#hr-policies';
const screenName=link=>{const key=String(link??'').replace(/^#/,'').split(/[/?]/)[0];return LENS[key]?.[3]??NAV_DEST[key]?.label??null;};
const openLink=(e,link,fallback)=>{const name=screenName(link);return `<a class="btn outline small" href="${e(link)}">${name?`فتح «${e(name)}»`:e(fallback)}</a>`;};
const fixLink=(e,link)=>!link?'':link===SELF?'<small>يتصلّح من هذي الشاشة نفسها.</small>':`<div class="operation-actions">${openLink(e,link,'فتح الشاشة اللي تصلّحه')}</div>`;
// مجموعة مطوية: الملخّص يسمّي ما يخفيه وعدده. تُفتح حين تقصر فلا تكلّف نقرة بلا داعٍ.
const fold=(e,title,rows,{open=rows.length<=6}={})=>rows.length?`<details${open?' open':''}><summary>${e(title)} ${count(e,rows.length)}</summary><ul class="vn-list">${rows.join('')}</ul></details>`:'';

const sharedValue=(e,v)=>`<li class="${v.mismatch.length?'is-late':''}">
  <strong>${isolate(e,v.label)}</strong>
  <span>${isolate(e,v.value)}${v.source?` · مصدرها: ${isolate(e,v.source)}`:''}</span>
  <small>${isolate(e,v.articles.join('، '))} · تقراها: ${isolate(e,v.read_by.join(' · '))}</small>
  ${v.mismatch.map(m=>`<small class="error">${isolate(e,m)}</small>`).join('')}</li>`;

const checkRow=(e,c)=>`<li class="${c.ok?'':'is-due'}">
  <strong>${isolate(e,c.title)}</strong>
  ${c.detail?`<span>${isolate(e,c.detail)}</span>`:''}
  ${c.ok?'':fixLink(e,c.link)}</li>`;
// سطور الجاهزية الناقصة بحسب نوعها، فتُقرأ الصورة من الملخّصات قبل التفاصيل.
const CHECK_GROUPS=[['capability','صلاحيات ما انمنحت لأحد'],['policy','سياسات ما انعتمدت'],['letters','قوالب خطابات ناقصة'],['','قيم واختيارات ما انحسمت']];
const groupOf=c=>CHECK_GROUPS.find(([prefix])=>prefix&&String(c.key??'').startsWith(prefix+':'))?.[0]??'';

const policyRow=(e,button)=>p=>{
  const meta=[p.store_name,p.kind_name].filter((x,i,all)=>x&&all.indexOf(x)===i).map(x=>isolate(e,x)).join(' · ');
  const actions=[...p.actions.map(a=>button(a,p.id,LABELS[a])),...(p.decide_at?[openLink(e,p.decide_at,'فتح شاشتها')]:[])];
  return `<li class="${tone(p.status)}">
  <strong>${isolate(e,p.title)}</strong>
  <span class="badge ${BADGE_TONE[p.status]??''}">${e(p.status_name)}</span>
  <span>${meta}${p.effective_from?` · يسري من ${when(e,p.effective_from)}`:''}</span>
  ${p.articles.length?`<small>السند: ${isolate(e,p.articles.join(' · '))}</small>`:''}
  ${p.status==='draft'?`<small>${p.platform_draft?'جهّزها مستخرج المنصة':p.prepared_by_name?`جهّزها ${e(p.prepared_by_name)}`:'ما لها مُعدّ مسجّل'}</small>`:''}
  ${p.status==='rejected'&&p.decision_note?`<small class="subtle">سبب الرفض: ${isolate(e,p.decision_note)}</small>`:''}
  ${p.pending_choices.map(c=>`<small class="is-warn-text">${isolate(e,c)}</small>`).join('')}
  ${p.blocked_while_unaccepted.length?`<small class="subtle">لين تنعتمد: ${isolate(e,p.blocked_while_unaccepted.join(' '))}</small>`:''}
  ${p.adopted_copy?`<small class="subtle">اعتمدت الشركة نسختها منها${p.adopted_copy.effective_from?`، وتسري من ${when(e,p.adopted_copy.effective_from)}`:''}. المستخرج يبقى مرجع، وإذا تبي تغيّر القيم جهّز نسخة معدّلة.</small>`:''}
  ${p.own_draft?'<small class="subtle">انت اللي جهّزتها، فما تعتمدها بنفسك — يعتمدها غيرك.</small>':''}
  ${actions.length?`<div class="operation-actions">${actions.join('')}</div>`:''}</li>`;
};

export const hrPoliciesUI={
  title:'سياسات الموارد البشرية',
  description:'كل سياسة في مكان واحد: نصها ومادتها وحالتها، وتنعتمد أو تنرفض بقاعدة الشخصين نفسها. ومعها قائمة باللي يمنع تشغيل وحدات الموارد البشرية للحين ووين يتصلّح.',
  load:api=>api('/hr-policies'),
  render(data,{e,button,ui=kit(e)}){
    const row=policyRow(e,button);
    const drafts=data.policies.filter(p=>p.status==='draft'),accepted=data.policies.filter(p=>p.status==='accepted'),closed=data.policies.filter(p=>p.status==='rejected'||p.status==='retired');
    const failing=data.checklist.filter(c=>!c.ok),passing=data.checklist.filter(c=>c.ok);
    const failingGroups=CHECK_GROUPS.map(([prefix,title])=>[title,failing.filter(c=>groupOf(c)===prefix)]).filter(([,list])=>list.length);
    const failingHtml=!failing.length?'<p class="subtle">ما فيه شي يمنع تشغيل وحدات الموارد البشرية.</p>'
      :failingGroups.length===1?`<ul class="vn-list">${failing.map(c=>checkRow(e,c)).join('')}</ul>`
      :failingGroups.map(([title,list])=>fold(e,title,list.map(c=>checkRow(e,c)),{open:failing.length<=6})).join('');
    const head=(title,n)=>`<div class="panel-head"><h2>${e(title)}${n===undefined?'':` ${count(e,n)}`}</h2></div>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><p class="subtle">صاحب الاعتماد: ${isolate(e,data.acceptance_owner)}</p></section>
      <section class="vn-board"><div class="vn-tiles">
        ${tile(e,data.awaiting_me.length,'تنتظر قرارك',data.awaiting_me.length?'is-due':'')}
        ${tile(e,drafts.length,'مسودات ما انحسمت')}
        ${tile(e,accepted.length,'معتمدة')}
        ${tile(e,data.blocking,'بنود جاهزية ناقصة',data.blocking?'is-due':'')}
      </div>
      ${data.awaiting_me.length?`<section class="vn-block">${head('تنتظر قرارك',data.awaiting_me.length)}<ul class="vn-list">${data.awaiting_me.map(row).join('')}</ul></section>`:''}
      <section class="vn-block">${head('قائمة الجاهزية — اللي يمنع التشغيل للحين',failing.length)}
        ${failingHtml}
        ${fold(e,'اللي اكتمل',passing.map(c=>checkRow(e,c)),{open:false})}</section>
      <section class="vn-block">${head('كل السياسات',data.policies.length)}
        ${data.policies.length?`${fold(e,'مسودات ما انحسمت',drafts.map(row))}${fold(e,'معتمدة',accepted.map(row))}${fold(e,'مرفوضة أو مستبدلة',closed.map(row),{open:false})}`
          :ui.empty('ما فيه سياسات مسجّلة للحين','المسودات تتجهّز من شاشة كل وحدة — الدوام والرواتب والإجازات والجزاءات — وتظهر هنا عشان تنعتمد.')}</section>
      <section class="vn-block"><div class="panel-head"><h2>قيم تقراها أكثر من وحدة</h2>
        <p>كل قيمة هنا قرار واحد ينكتب مرة وحدة في مكانه المذكور، وباقي الوحدات تقراه منه. وإذا اختلفت بين موضعين ينكتب الاختلاف تحتها.</p></div>
        <ul class="vn-list">${data.shared_values.map(v=>sharedValue(e,v)).join('')}</ul></section>
      </section>`;
  },
  form(action,id,data){
    const p=data.policies.find(x=>x.id===id);
    guard(p&&p.actions.includes(action));
    const accept=action==='accept_policy',path=accept?p.accept_path:p.reject_path;
    guard(!!path);
    const fields=[field('note',accept?'إقرارك إن القيم مطابقة للنسخة الموقّعة، وأساس اعتمادك':'سبب الرفض','textarea',{minLength:10,maxLength:2000})];
    // كل مخزن سياسات يقبل في وحدته الحقول التي تخصه وحدها؛ إرسال حقل زائد يرفضه الخادم. لا نموذج موحد يخفي شرطًا.
    const needsEffective=accept&&['discipline_schedule','regulation_rule','benefit'].includes(p.store);
    const needsVersion=['discipline_schedule','benefit'].includes(p.store)&&p.version!==null;
    if(needsEffective)fields.unshift(field('effective_from','تاريخ سريان السياسة','date',{value:data.today}));
    return {title:`${accept?'اعتماد':'رفض'} — ${p.title}`,endpoint:path,submit:accept?'اعتماد':'رفض',
      hint:`${p.store_name} · ${p.kind_name}${p.articles.length?` · ${p.articles.join(' · ')}`:''}${p.blocked_while_unaccepted.length?` — لين تنعتمد: ${p.blocked_while_unaccepted.join(' ')}`:''}`,
      fields,
      toPayload:v=>({note:v.note,...(needsEffective?{effective_from:v.effective_from}:{}),...(needsVersion?{version:p.version}:{})})};
  }
};
