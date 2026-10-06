import { icon } from './icons.mjs';

const STATES=Object.freeze({
  healthy:{label:'سليم',icon:'check'},
  warning:{label:'يحتاج متابعة',icon:'warning'},
  failed:{label:'فشل',icon:'alert'},
  unknown:{label:'غير معروف',icon:'question'}
});
const EVIDENCE_LABELS=Object.freeze({
  commit:'الإصدار',files:'ملفات المصدر',latest:'آخر ترحيل',applied:'الترحيلات المطبقة',age_hours:'عمر الدليل بالساعات',
  total:'الإجمالي',queued:'في الانتظار',running:'قيد التشغيل',dead:'متوقفة',overdue:'متأخرة',enabled:'مفعلة',expired_enabled:'منتهية ومفعلة',
  active:'نشطة',proposed:'بانتظار التقييم',overdue_reviews:'مراجعات متأخرة',open:'مفتوحة',blocked:'موقوفة',simulated:'محاكاة محلية',
  sandbox_ready:'جاهزة للاختبار',definitions:'التعريفات',observations:'الأرصاد',without_observation:'بلا رصد',expected:'المتوقع',actual:'الفعلي',count:'العدد'
});
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
const number=value=>new Intl.NumberFormat('ar-SA',{maximumFractionDigits:1}).format(Number(value));
const dateTime=value=>{
  if(!value)return 'لم يُفحص';
  const date=new Date(value);
  if(Number.isNaN(date.valueOf()))return 'وقت غير صالح';
  return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(date);
};

function evidenceItems(evidence,e){
  if(!evidence||typeof evidence!=='object')return '';
  return Object.entries(evidence).filter(([key,value])=>EVIDENCE_LABELS[key]&&['string','number','boolean'].includes(typeof value)).slice(0,5)
    .map(([key,value])=>`<li><span>${e(EVIDENCE_LABELS[key])}</span><strong>${e(typeof value==='number'?number(value):String(value).slice(0,14))}</strong></li>`).join('');
}

function healthCard({key,title,check,href},e){
  const state=STATES[check?.state]??STATES.unknown,checkedAt=check?.checked_at??'';
  const evidence=evidenceItems(check?.evidence,e);
  return `<article class="admin-health-card is-${e(check?.state??'unknown')}" data-health-check="${e(key)}" data-checked-at="${e(checkedAt)}">
    <header>
      <span class="admin-health-icon">${icon(state.icon)}</span>
      <div><h3>${e(title)}</h3><span class="admin-health-state">${e(state.label)}</span></div>
    </header>
    <p>${e(check?.note||'لا يوجد وصف للفحص.')}</p>
    ${evidence?`<ul class="admin-health-evidence">${evidence}</ul>`:'<p class="admin-health-no-evidence">لا يوجد دليل رقمي مرفق.</p>'}
    <footer><time datetime="${e(checkedAt)}">${e(dateTime(checkedAt))}</time>${href?`<a href="${e(href)}">فتح الأداة ${icon('chevron','is-directional')}</a>`:''}</footer>
  </article>`;
}

function section({key,eyebrow,title,description,checks},e){
  return `<section class="admin-health-section" aria-labelledby="admin-${e(key)}-title">
    <header class="admin-health-section-head"><div><span class="cockpit-eyebrow">${e(eyebrow)}</span><h2 id="admin-${e(key)}-title">${e(title)}</h2></div><p>${e(description)}</p></header>
    <div class="admin-health-grid">${checks.map(item=>healthCard(item,e)).join('')}</div>
  </section>`;
}

function render(data,{e=escapeHtml}={}){
  const groups=[
    {key:'service',eyebrow:'البنية والإصدار',title:'صحة الخدمة',description:'أدلة تشغيلية عن الإصدار والمخطط والنسخ، من دون تشغيل إجراء جديد عند فتح الشاشة.',checks:[
      {key:'build',title:'بصمة الإصدار',check:data?.build},
      {key:'migration',title:'ترحيلات قاعدة البيانات',check:data?.database?.migration},
      {key:'schema',title:'بصمة المخطط',check:data?.database?.schema},
      {key:'backup',title:'دليل النسخ الاحتياطي',check:data?.database?.backup}
    ]},
    {key:'operations',eyebrow:'التشغيل اليومي',title:'العمليات الخلفية',description:'حالة الأعمال المؤجلة والتغييرات التجريبية التي يديرها فريق المنصة.',checks:[
      {key:'queue',title:'طابور الوظائف',check:data?.jobs?.queue,href:'#jobs'},
      {key:'feature-flags',title:'أعلام الميزات',check:data?.jobs?.feature_flags,href:'#feature-flags'}
    ]},
    {key:'security',eyebrow:'الحوكمة',title:'الأمن والصلاحيات',description:'سلامة سلسلة التدقيق ودورية مراجعة الوصول وحوكمة أدوات الذكاء الاصطناعي.',checks:[
      {key:'audit-chain',title:'سلسلة التدقيق',check:data?.security?.audit_chain},
      {key:'access-reviews',title:'مراجعات الصلاحيات',check:data?.access_reviews?.campaign,href:'#access-reviews'},
      {key:'ai-inventory',title:'جرد الذكاء الاصطناعي',check:data?.security?.ai_inventory,href:'#ai-governance'}
    ]},
    {key:'data',eyebrow:'البيانات والروابط',title:'جاهزية البيانات والتكاملات',description:'حالة القياس والاتصالات كما تثبتها الأدلة الحالية، مع إبقاء المحاكاة واضحة.',checks:[
      {key:'integrations',title:'التكاملات',check:data?.integrations?.connections,href:'#integrations'},
      {key:'metric-quality',title:'جودة مؤشرات القيادة',check:data?.data_quality?.executive_metrics}
    ]}
  ];
  const all=groups.flatMap(group=>group.checks),summary=all.reduce((counts,item)=>{
    const state=STATES[item.check?.state]?item.check.state:'unknown';counts[state]=(counts[state]??0)+1;return counts;
  },{healthy:0,warning:0,failed:0,unknown:0});
  return `<main class="cockpit admin-cockpit" aria-labelledby="admin-cockpit-title">
    <header class="cockpit-hero admin-cockpit-hero">
      <div class="cockpit-hero-copy"><span class="cockpit-eyebrow">الإدارة التقنية</span><h1 id="admin-cockpit-title">مركز تشغيل المنصة</h1><p class="cockpit-summary">صورة واحدة عن صحة التشغيل، مع فصل واضح بين الدليل الحالي وما يحتاج فحصًا أو معالجة.</p></div>
      <div class="admin-health-summary" aria-label="ملخص حالات الصحة">
        ${Object.entries(STATES).map(([key,value])=>`<div class="is-${key}"><span>${e(value.label)}</span><strong>${e(number(summary[key]))}</strong></div>`).join('')}
        <small>آخر تجميع ${e(dateTime(data?.generated_at))}</small>
      </div>
    </header>
    ${groups.map(group=>section(group,e)).join('')}
  </main>`;
}

export const adminCockpitUI=Object.freeze({render});
export { render };
