// اللوحة التنفيذية: وضع الشركة في شاشة واحدة، بأرقام مجمّعة فقط.
// م0 «السور»: عبارات الحالات من القاموس الواحد، لا من نسخة هنا.
import { REQUEST_STATUS_AR as statusNames } from './vocabulary.mjs';
const attentionTone={overdue:'is-late',no_manager:'is-warn',pending:'is-due'};

// نسبة مئوية من نقاط الأساس، بمنزلتين كما تُدخل وتُخزَّن.
const percent=bp=>bp===null||bp===undefined?'—':`${(bp/100).toFixed(2)}٪`;
// الشريط رسمٌ يكرّر الرقم المكتوب بجواره، فيُخفى عن القارئ الآلي ويبقى الرقم هو ما يُقرأ.
const bar=share=>`<span class="ex-bar" aria-hidden="true"><i data-width="${Math.round(share)}"></i></span>`;

// محفظة المشاريع والقمع: يظهران لحامل تصريح «اللوحة التنفيذية» وحده، فـ`portfolio` يعود
// فارغًا لمن يقرأ اللوحة بدوره. أعداد وقيم فقط: لا اسم مشروع ولا فرصة ولا عميل.
function portfolioSection(p,{e,money}){
  if(!p)return '';
  const figure=(value,label,hint,tone='')=>`<article class="ex-figure ${tone}"><span class="ex-figure-label">${e(label)}</span><strong>${value}</strong><small>${e(hint)}</small></article>`;
  const total=Math.max(1,p.projects);
  const axes=p.axes.map(axis=>`<tr>
      <td><strong>${e(axis.name)}</strong><br><span class="subtle">${e(axis.owner_role)}</span></td>
      <td>${axis.states.length?axis.states.map(s=>`<span class="badge">${e(s.name)} · ${s.count}</span>`).join(' '):'<span class="subtle">ما فيه مشاريع</span>'}</td>
      <td>${bar(((axis.states[0]?.count??0)/total)*100)}<b>${axis.states[0]?.count??0}</b></td>
    </tr>`).join('');
  const f=p.funnel,stagePeak=Math.max(1,...f.by_stage.map(s=>s.value_minor));
  const stages=f.by_stage.length?f.by_stage.map(s=>`<tr>
      <td><strong>${e(s.name)}</strong><br><span class="subtle"><bdi>${e(s.code)}</bdi> · احتمال ${e(percent(s.win_probability_bp))} مؤكد في ${e(s.confirmed_on)}</span></td>
      <td>${s.count}</td>
      <td>${bar((s.value_minor/stagePeak)*100)}<b>${e(money(s.value_minor))}</b></td>
      <td>${e(money(s.weighted_minor))}</td>
    </tr>`).join(''):'<tr><td colspan="4" class="subtle">ما فيه مراحل معتمدة للحين: يعرّفها مالك الإجراء باحتمالها وسندها، ويعتمدها شخص ثاني.</td></tr>';
  const reasons=f.loss_reasons.length?f.loss_reasons.map(r=>`<tr><td>${e(r.name)}</td><td>${r.count}</td><td>${e(money(r.value_minor))}</td></tr>`).join('')
    :'<tr><td colspan="3" class="subtle">ما فيه خسائر مسجّلة في الفترة.</td></tr>';
  return `<div class="ex-figures">
      ${figure(p.projects,'مشروع في الكيان','كل مشاريع الشركة لا مشاريعك')}
      ${figure(p.running,'مشروع جارٍ','تنفيذ مباشر الآن')}
      ${figure(p.on_hold,'مشروع متوقف','محور التنفيذ',p.on_hold?'is-warn':'')}
      ${figure(p.blocked_start,'ينتظر شرط بدء','أمر شراء عميل أو دفعة مقدمة',p.blocked_start?'is-late':'')}
      ${figure(p.overdue_collection,'تحصيل متأخر','استحقاق معتمد فات موعده',p.overdue_collection?'is-late':'')}
      ${figure(p.in_closure,'دخل الإقفال',`مقفل نهائيًا منها ${p.closed}`)}
    </div>
    <section class="panel">
      <div class="panel-head"><h2>محاور المشاريع</h2><p class="subtle">ثمانية محاور مستقلة، ووين واقفة مشاريع الشركة في كل واحد</p></div>
      <div class="table-wrap"><table class="ex-table">
        <thead><tr><th scope="col">المحور وصاحبه</th><th scope="col">الحالات</th><th scope="col">أكثرها</th></tr></thead>
        <tbody>${axes}</tbody>
      </table></div>
    </section>
    <div class="ex-figures">
      ${figure(f.open_count,'فرصة مفتوحة','في القمع الآن')}
      ${figure(e(money(f.open_value_minor)),'قيمة القمع','مجموع قيم الفرص المفتوحة')}
      ${figure(e(money(f.weighted_minor)),'التوقع الموزون','قيمة × احتمال المرحلة')}
      ${figure(f.unweighted_count,'خارج الوزن','فرص في مرحلة غير معتمدة',f.unweighted_count?'is-warn':'')}
      ${figure(e(percent(f.closed.win_rate_count_bp)),'نسبة الفوز بالعدد',`فوز ${f.closed.won_count} · خسارة ${f.closed.lost_count}`)}
      ${figure(e(percent(f.closed.win_rate_value_bp)),'نسبة الفوز بالقيمة','من قيمة ما أُغلق في الفترة')}
    </div>
    <section class="panel">
      <div class="panel-head"><h2>قمع الفرص</h2><p class="subtle">الفترة ${e(f.from)} إلى ${e(f.to)}</p></div>
      <div class="table-wrap"><table class="ex-table">
        <thead><tr><th scope="col">المرحلة</th><th scope="col">الفرص</th><th scope="col">القيمة</th><th scope="col">الموزون</th></tr></thead>
        <tbody>${stages}</tbody>
      </table></div>
      <div class="table-wrap"><table class="ex-table">
        <thead><tr><th scope="col">سبب الخسارة</th><th scope="col">العدد</th><th scope="col">القيمة</th></tr></thead>
        <tbody>${reasons}</tbody>
      </table></div>
      <p class="subtle ex-note">${e(f.warning)}</p>
      <p class="subtle ex-note">${e(p.note)}</p>
    </section>`;
}

// منسّق المبالغ تمرّره الصفحة (money في operations.mjs). هذا بديله بالصيغة نفسها حين تُرسم اللوحة بلا صفحة،
// فلا تسقط اللوحة كلها لأن من رسمها لم يمرّر منسّقًا.
const plainMoney=value=>{
  if(value===null||value===undefined)return '—';
  const amount=BigInt(value),absolute=amount<0n?-amount:amount;
  return `${amount<0n?'-':''}${(absolute/100n).toLocaleString('en-US')}.${String(absolute%100n).padStart(2,'0')} SAR`;
};
export function executiveBoard(data,{e,name,money=plainMoney}){
  const t=data.totals;
  const flow=['pending','approved','in_progress','completed'].map(key=>({key,label:statusNames[key],value:data.by_status[key]??0}));
  const peak=Math.max(1,...data.departments.map(d=>d.open));
  const figure=(value,label,hint,tone='')=>`<article class="ex-figure ${tone}"><span class="ex-figure-label">${e(label)}</span><strong>${value}</strong><small>${e(hint)}</small></article>`;
  return `<section class="ex-hero">
      <div class="ex-hero-copy">
        <span class="eyebrow">اللوحة التنفيذية</span>
        <h1>وضع الشركة الآن</h1>
        <p>${e(name)} · ${t.people} موظفًا في ${t.departments} إدارة · ${t.services} خدمة مهيأة</p>
      </div>
      <div class="ex-attention">${data.attention.length?data.attention.map(item=>`<span class="ex-flag ${attentionTone[item.kind]||''}">${e(item.text)}</span>`).join(''):'<span class="ex-flag is-ok">ما فيه شي يحتاج تدخّلك الحين</span>'}</div>
    </section>
    <div class="ex-figures">
      ${figure(t.open,'طلب مفتوح',`${statusNames.pending} أو ${statusNames.in_progress}`)}
      ${figure(t.overdue,'تجاوز زمن الخدمة','يحتاج تدخلًا أو تصعيدًا',t.overdue?'is-late':'')}
      ${figure(t.completed,'طلب مكتمل','أُغلق بدليل موثق')}
      ${figure(t.tasks_open,'مهمة مسندة','داخل الطلبات الجارية',t.tasks_overdue?'is-warn':'')}
      ${figure(t.tasks_overdue,'مهمة متأخرة','تجاوزت موعدها',t.tasks_overdue?'is-late':'')}
    </div>
    <div class="ex-grid">
      <section class="panel">
        <div class="panel-head"><h2>مسار الطلبات</h2><p class="subtle">من الاعتماد إلى الإغلاق</p></div>
        <div class="panel-body ex-flow">${flow.map(step=>`<div class="ex-step"><strong>${step.value}</strong><span>${e(step.label)}</span></div>`).join('<span class="ex-arrow" aria-hidden="true">←</span>')}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>ما يستحق قرارك</h2></div>
        <div class="panel-body ex-rows">${data.attention.length?data.attention.map(item=>`<div class="ex-row ${attentionTone[item.kind]||''}"><span>${e(item.text)}</span><a class="btn outline small" href="#requests">فتح<span class="sr-only"> — ${e(item.text)}</span></a></div>`).join(''):'<p class="subtle">ما فيه تنبيهات مفتوحة.</p>'}</div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>الإدارات</h2><p class="subtle">الحمل والتأخر ومتوسط زمن الإغلاق</p></div>
      <div class="table-wrap"><table class="ex-table">
        <thead><tr><th scope="col">الإدارة</th><th scope="col">القطاع</th><th scope="col">الموظفون</th><th scope="col">الحمل المفتوح</th><th scope="col">متأخر</th><th scope="col">مكتمل</th><th scope="col">متوسط الإغلاق</th></tr></thead>
        <tbody>${data.departments.map(d=>`<tr><td><strong>${e(d.name)}</strong></td><td class="subtle">${e(d.sector||'—')}</td><td>${d.people}</td><td>${bar(d.open/peak*100)}<b>${d.open}</b></td><td class="${d.overdue?'is-late-text':''}">${d.overdue}</td><td>${d.completed}</td><td>${d.average_days===null?'—':`${d.average_days} يوم`}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="subtle ex-note">${e(data.scope)}</p>
    </section>
    ${portfolioSection(data.portfolio,{e,money})}`;
}
