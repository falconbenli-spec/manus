// البحث الشامل: حقل واحد فوق كل الكيانات، ونتائج مجمّعة بنوعها، وكل نتيجة رابط.
// الاستعلام يعيش في العنوان (#search/كلمة) ليبقى الرابط قابلًا للمشاركة، ويُحفظ في جلسة المتصفح
// لأن إطار العمليات يعيد بناء الشاشة بعد كل نموذج، فلولا الحفظ ضاعت كلمة البحث بمجرد تنفيذها.
// العدّة من ctx.ui، وبلاها (اختبار الشاشة يرسمها بسياق مختصر) تُبنى من kit نفسها فلا نسخة محلية من البلاطة ولا الصف.
import { kit } from './kit.mjs';
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');};
const KEY='36t-search-query';
const stored=()=>{try{return sessionStorage.getItem(KEY)??'';}catch{return '';}};
const remember=query=>{try{sessionStorage.setItem(KEY,query);}catch{/* وضع خاص أو تخزين معطّل: البحث يعمل بالعنوان وحده */}};
const fromHash=()=>{try{return decodeURIComponent(location.hash.slice(1).split('/').slice(1).join('/'));}catch{return '';}};
const query=()=>fromHash()||stored();
const RIYADH=new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'});
const lines=n=>n===1?'سطر واحد':n===2?'سطرين':`${n} ${n>=3&&n<=10?'أسطر':'سطر'}`;

export const searchUI={
  title:'البحث الشامل',
  description:'حقل واحد يدوّر في كل شي تقدر تفتحه: العملاء والموردين والزملاء والخدمات والطلبات والمشاريع والحملات وبطاقات الخدمة المنشورة والسياسات المعتمدة ولقطات التقارير.',
  load:api=>{const q=query();return api('/search'+(q?`?q=${encodeURIComponent(q)}`:''));},
  render(data,{e,button,ui:given}){
    const ui=typeof given?.row==='function'?given:kit(e);
    const at=Date.parse(String(data.index.built_at??''));
    const built=Number.isNaN(at)?'':`<time datetime="${e(new Date(at).toISOString())}">${e(RIYADH.format(new Date(at)))}</time>`;
    // البحث فعل الشاشة الأول، ثم ما بحثت عنه وأين يبحث، ثم حال الفهرس؛ وشرح طريقة البحث وحدوده مطويٌّ تحتها.
    const head=`<section class="panel panel-body vn-head">
      <div class="operation-actions">${button('run_search','','بحث')}</div>
      ${data.query?`<p>دوّرت على: <strong><bdi>${e(data.query)}</bdi></strong>${data.normalized&&data.normalized!==data.query?` — وبعد توحيد الحروف: <strong><bdi>${e(data.normalized)}</bdi></strong>`:''}</p>`:'<p class="subtle">اكتب كلمة أو أكثر، وما يفرق التشكيل ولا الهمزة ولا التاء المربوطة ولا نوع الأرقام.</p>'}
      <p class="subtle">${data.searchable.length?`يدوّر في: ${data.searchable.map(t=>e(t.name)).join(' · ')}.`:'ما فيه نوع تقدر تدوّر فيه بصلاحيتك.'}</p>
      ${data.index.ready?`<p class="subtle">آخر تحديث للفهرس ${built||'—'} (${e(lines(Number(data.index.entries)||0))}) — اللي ينضاف بعده يطلع بعد ما يتحدّث.</p>`:'<p class="vn-alert is-due">الفهرس ما انبنى للحين، فما فيه نتائج. ينبني أول ما تدوّر.</p>'}
      <details class="rq-help"><summary>وش يلقى البحث، ووش ما يلقى؟</summary><p class="measure">${e(data.note)}</p></details>
    </section>`;
    // الأرقام بعد البحث وحده: «0 نتيجة» قبل أن يُكتب شيء رقمٌ بلا سؤال. ورقم كل نوع طول قائمته تحته.
    const tiles=data.query?`<section class="vn-board"><div class="vn-tiles">${ui.tile(data.total,'نتيجة')}${ui.tile(data.groups.length,'نوع فيه نتائج')}${ui.tile(data.searchable.length,'نوع تقدر تدوّر فيه')}</div></section>`:'';
    // النتيجة صفٌّ رابطه الوحيد عنوانها، فيمتد على الصف كله (journey.css).
    const result=r=>ui.row({title:r.title,href:r.href,meta:r.snippet??'',
      html:r.updated_at?`<small class="subtle">آخر تحديث <time datetime="${e(String(r.updated_at).slice(0,10))}">${e(String(r.updated_at).slice(0,10))}</time></small>`:''});
    const groups=data.groups.map(group=>`<section class="panel panel-body vn-block"><h2>${e(group.name)} <span>${e(group.count)}</span></h2><ul class="vn-list">${group.results.map(result).join('')}</ul></section>`).join('');
    const nothing=data.query
      ?`<section class="panel">${ui.empty(`ما لقينا شي يطابق «${data.query}» في اللي تقدر تفتحه`,'جرّب كلمة أقصر أو جزء من الكلمة — البحث يطابق الحروف وما يفهم المرادفات.')}</section>`
      :`<section class="panel">${ui.empty('اكتب كلمتك وابدأ البحث','من زر «بحث» فوق: اسم عميل أو مورد أو زميل، أو عنوان طلب أو مشروع.')}</section>`;
    return head+tiles+(groups||nothing);
  },
  form(action,id,data){
    guard(action==='run_search');
    return {
      title:'البحث الشامل',
      endpoint:'/search',method:'GET',
      // الاستعلام يُبنى من القيمة المدخلة ويُحفظ قبل الإرسال، فتقرأه الشاشة عند إعادة بنائها بعد النموذج.
      dynamicEndpoint:values=>{const q=String(values.q??'').trim();remember(q);return q?`/search?q=${encodeURIComponent(q)}`:'/search';},
      fields:[{name:'q',label:'دوّر في كل شي تقدر تفتحه',type:'text',value:data.query,maxLength:200,placeholder:'اسم عميل أو مورد أو زميل أو عنوان طلب…'}],
      toPayload:()=>undefined
    };
  }
};
