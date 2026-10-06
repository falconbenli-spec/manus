// «ملفي» (G1): الموظف يطّلع على ملفه الوظيفي ووثائقه وحسابه البنكي وتابعيه. لا حقل قابل للتعديل هنا:
// كل تغيير زر يفتح خدمة الدليل المناسبة (data-action="new-request")، فيمر بالموارد البشرية ويبقى أثره.
// الأرقام تصل مقنّعة من الخادم (••••1234)؛ هذه الوحدة لا ترى الرقم الكامل أبدًا.
// العربية لهجة المنصة، والإنجليزية (tr) كما هي؛ والتاريخ في <time>، والعدد بأرقام مجدولة.
import { dual } from './dates.mjs';
import { countNoun } from './arabic-count.mjs';
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const fallbackTr=ar=>ar;
const stateNames={valid:['سارية','Valid'],expiring:['تنتهي قريبًا','Expiring soon'],expired:['منتهية','Expired'],replaced:['استُبدلت','Replaced']};
const stateTone={valid:'',expiring:'is-due',expired:'is-late',replaced:'is-old'};

export const profileUI={
  title:'ملفي',title_en:'My profile',
  description:'بياناتك الوظيفية ووثائقك وحساب راتبك مثل ما سجلتها الموارد البشرية. تبي تغيّر شي؟ قدّم طلب.',
  description_en:'Your job details, official documents and bank account as HR recorded them. To change any of them, make a request.',
  load:api=>api('/profile'),
  render(data,{e,tr=fallbackTr,lang='ar'}){
    const en=lang!=='ar',j=data.job||{};
    // اليوم بنصه كما كان يُعرض (ميلادي · هجري بالعربية، وكما يُخزَّن بالإنجليزية) وقيمته الآلية في datetime.
    const date=(v,show=en?String:dual)=>v?`<time datetime="${e(String(v).slice(0,10))}">${e(show(v))}</time>`:'—';
    const fact=(label,value,cls='')=>`<div><dt>${e(label)}</dt><dd${cls?` class="${cls}"`:''}>${e(value??'—')}</dd></div>`;
    const factHtml=(label,html)=>`<div><dt>${e(label)}</dt><dd>${html}</dd></div>`;
    // الأيام بصيغتها العربية الصحيحة («باقي يومان»، «باقي 5 أيام») والرقم وحده مجدول.
    const days=n=>{
      const abs=Math.abs(n),count=e(countNoun(abs,'day')).replace(/^\d+/,m=>`<span data-num>${m}</span>`);
      if(en)return n<0?`expired <span data-num>${e(abs)}</span> days ago`:`<span data-num>${e(n)}</span> days left`;
      return n<0?`انتهت ومضى عليها ${count}`:n===0?'تنتهي اليوم':`باقي ${count}`;
    };
    // السطر الفارغ يقول من أين يُضاف الناقص: باسم خدمة التغيير حين تتاح.
    const via=key=>{const s=(data.change_services||[]).find(c=>c.for===key);return s?.available?(en?s.label_en:s.label):'';};
    const tail=(key,ar,enText)=>{const name=via(key);return en?`.${name?` ${enText} “${e(name)}”.`:''}`:name?` — ${ar} «${e(name)}».`:'.';};
    const change=key=>{const s=(data.change_services||[]).find(c=>c.for===key);
      return s?.available?`<button type="button" class="btn outline small" data-action="new-request" data-id="${e(s.service_id)}">${e(en?s.label_en:s.label)}</button>`:'';};
    // اللون يرافقه اسم الحالة في آخر السطر: سارية، تنتهي قريبًا، منتهية، استُبدلت.
    const docRow=d=>`<li class="${stateTone[d.state]??''}"><strong>${e(en?d.name_en:d.name)} <span class="ltr eu-mask">${e(d.number_masked)}</span></strong><span>${tr('ينتهي','Expires')} ${date(d.expires_on)}${d.state!=='replaced'?` · ${days(d.days_left)}`:''} · ${e(tr(...(stateNames[d.state]||[d.state,d.state])))}</span></li>`;
    const job=`<section class="vn-block"><div class="panel-head"><h2>${tr('الوظيفة','Job')}</h2>${change('profile')}</div>
      ${j.recorded?'':`<p class="vn-alert">${tr('الموارد البشرية ما سجّلت ملفك الوظيفي للحين، واللي تشوفه هنا من حسابك بس.','HR has not recorded your job profile yet. What shows here comes from your account only.')}</p>`}
      <dl class="vn-facts">${fact(tr('المسمى الوظيفي','Job title'),j.job_title)}${fact(tr('الإدارة','Department'),j.department)}${fact(tr('المدير المباشر','Line manager'),j.manager)}${factHtml(tr('تاريخ الالتحاق','Hire date'),date(j.hire_date))}${fact(tr('نوع التوظيف','Employment type'),en?j.employment_type_name_en:j.employment_type_name)}${fact(tr('نوع العقد','Contract type'),en?j.contract_type_name_en:j.contract_type_name)}${j.contract_end?factHtml(tr('نهاية العقد','Contract end'),date(j.contract_end)):''}${j.work_location?fact(tr('مقر العمل','Work location'),j.work_location):''}</dl></section>`;
    const identity=`<section class="vn-block"><div class="panel-head"><h2>${tr('الهوية والجواز','ID and passport')}</h2>${change('documents')}</div>
      ${data.identity?.length?`<ul class="vn-list">${data.identity.map(docRow).join('')}</ul>`:`<p class="subtle">${tr('للحين ما فيه هوية أو إقامة أو جواز مسجّل لك — تضيفه من طلب «تحديث البيانات أو الوثائق».','No ID, iqama or passport is recorded for you yet. To add one, request “Update details or documents”.')}</p>`}</section>`;
    const b=data.bank||{};
    const bank=`<section class="vn-block"><div class="panel-head"><h2>${tr('حساب الراتب','Salary account')}</h2>${change('bank')}</div>
      ${b.current?`<dl class="vn-facts">${fact(tr('البنك','Bank'),b.current.bank_name)}${fact(tr('الآيبان','IBAN'),b.current.iban_masked,'ltr eu-mask')}${fact(tr('الحالة','Status'),en?b.current.status_name_en:b.current.status_name)}${fact(tr('يسري من','Effective from'),b.current.effective_month,'ltr')}</dl>`:`<p class="subtle">${tr('للحين ما فيه حساب راتب متحقق منه مسجّل لك','No verified salary account is recorded for you yet')}${tail('bank','تضيفه من','Add one with')}</p>`}
      ${b.pending?`<p class="vn-alert">${tr('فيه تغيير ينتظر التحقق:','A change is awaiting verification:')} ${e(b.pending.bank_name)} <span class="ltr eu-mask">${e(b.pending.iban_masked)}</span></p>`:''}</section>`;
    const dependants=data.dependants_hidden?'':`<section class="vn-block"><div class="panel-head"><h2>${tr('التابعون','Dependants')}</h2>${change('dependants')}</div>
      ${data.dependants?.length?`<ul class="vn-list">${data.dependants.map(d=>`<li><strong>${e(d.relation_name)}</strong><span>${tr('تاريخ الميلاد','Born')} ${date(d.birth_date)} · ${tr('انضاف','Added')} ${date(d.added_on,String)}</span></li>`).join('')}</ul>`:`<p class="subtle">${tr('للحين ما عندك تابعين مسجّلين في التأمين الطبي','No dependants are recorded on your medical insurance')}${tail('dependants','تضيفهم من','Add them with')}</p>`}</section>`;
    const count=data.documents?.length??0;
    const documents=`<details class="vn-group eu-group"${count?'':' open'}><summary><h2>${tr('كل وثائقي','All my documents')} <span data-num>${e(count)}</span></h2></summary>
      ${count?`<ul class="vn-list">${data.documents.map(docRow).join('')}</ul>`:`<p class="subtle">${tr('للحين ما عندك وثائق مسجّلة','No documents are recorded for you')}${tail('documents','تضيفها من','Add them with')}</p>`}</details>`;
    const who=data.own?'':`<p class="vn-alert">${tr('تشوف ملف','You are viewing the profile of')} ${e(data.person?.name)} ${tr('لأنك من الموارد البشرية.','as an HR officer.')}</p>`;
    return `<section class="panel panel-body vn-head"><p><strong>${e(data.person?.name)}</strong>${j.job_title?` · ${e(j.job_title)}`:''}</p><p class="subtle">${en?'Only you and HR can see this profile. ID, passport and IBAN numbers show their last four digits, and nothing is edited here: every change is a request that HR approves.':e(data.privacy)}</p>${who}</section>
      <section class="vn-board">${job}${identity}${bank}${dependants}${documents}</section>`;
  },
  form(){guard(false);}
};
