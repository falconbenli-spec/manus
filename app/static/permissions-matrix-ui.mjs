// مصفوفة الصلاحيات (ترحيل 130) — شاشة المالك: ثلاثة مستويات في عمود، والتصاريح المئة في صفوف،
// وكل تصريح في صنف نطاق واحد **صادق** يأتي من مسح مُعدّ لا من أمنية:
//   «يُحصر بإدارة»  grantAccess يقبل له نطاق إدارة. ويُقال بجواره كم منها يحصره الكود فعلًا اليوم.
//   «خاص بصاحبه»   مجموعة صفوفه شخصٌ واحد، فحصره بإدارة لا معنى له.
//   «على مستوى الشركة»  لا يحصره الكود بإدارة. يُعرض هنا **بلا منتقي إدارة وبلا «إضافة لإدارة»**، وباسم
//                   من يحمله؛ ويعدّله الأدمن الأول في قالب الشركة بتأكيد يقول له صراحةً أن وضعه في
//                   مستوى لا يحصره بإدارة. الشاشة لا تعرض أبدًا حصرًا لا يفعله الكود، ولو كان أجمل في العين.
// و«الإضافة لإدارة» لا تُعرض إلا على ما يحصره الكود فعلًا (data.confined_in_code): ما عداه يقبل الحجب
// والرجوع إلى القالب وحدهما، فلا يصل الطلب إلى الخادم ليُرفض بعد الإرسال.
// وتقول الشاشة بصريح العبارة ما يحكمه المستوى اليوم (القائمة وبوابات المسارات)، وما يلزم لحصر بقية التصاريح بإدارة
// (تعديل حارس، أو عمود وقرار ردم من المالك) — مادةً وسندًا بلهجة المنصة، بلا أسماء مراحل وموجات بناء (معيار المالك
// للشاشة، 23 سبتمبر: النص وسنده، لا سجل من قرّر ونفّذ).
// لا مكوّن محلي هنا: كل ما يُرسم من ctx.ui (app/static/kit.mjs).
// لوح «من يغطّي كل إدارة»: وحدة مستقلة تُستورد هنا، ومسجَّلة في خريطة أصول الخادم (app/server.mjs).
import { escalationPanel, escalationForm } from './department-escalation-ui.mjs';
const LEVEL_NAMES={department_manager:'مدير الإدارة',employee:'موظف',department_admin:'أدمن الإدارة'};
const SCOPE_NAMES={department:'يُحصر بإدارة',personal:'خاص بصاحبه',company:'على مستوى الشركة'};
const MODE_NAMES={add:'مضاف لهذه الإدارة',remove:'محجوب عن هذه الإدارة',follow:'يتبع قالب الشركة'};
const SOURCE_NOTES={derived:'مشتق من دوره، وما قرّره أحد للحين',stale:'باقٍ من دور سابق: ما يطابق دوره اليوم، وما قرّره أحد'};
// ما يلزم لحصر تصريحٍ على مستوى الشركة بإدارة: الجواب نفسه، لا اسم مرحلة في خطة بناء.
const STAGE_NAMES={guard:'حصره بإدارة: تعديل الحارس بس',schema:'حصره بإدارة: عمود جديد وقرار ردم منك'};
const ROLE_LABELS={employee:'موظف',manager:'مدير',hr:'موارد بشرية',it:'تقنية معلومات',pm:'مدير مشروع'};
const TEMPLATE_HEAD=['التصريح','النطاق وما يقوله الكود','مدير الإدارة','موظف','أدمن الإدارة'];

export const permissionsMatrixUI={
 title:'مصفوفة الصلاحيات',
 description:'ثلاث مستويات لكل إدارة: قالب شركة واحد تضبطه مرة، واستثناء تكتبه لإدارة إذا احتاجت. المستوى يضيف وما يسحب: اللي يحمله الموظف اليوم يبقى مثل ما هو.',
 async load(api){return api('/permissions-matrix');},
 render(data,{e,button,ui,date}){
  const deptName=id=>data.departments.find(d=>d.id===id)?.name||id;
  const capabilityName=key=>data.capabilities.find(c=>c.key===key)?.name??key;
  const s=data.summary,shadow=data.shadow,on=data.switch.enabled;
  // اسمٌ يُسمع: زرٌّ يتكرر في كل صف («أضفه»، «تغيير المستوى») يحمل في اسمه المسموع صفّه وعمودَه، ويبدأ بنصّه الظاهر
  // (التسمية في الاسم، WCAG 2.5.3). نصّه الظاهر لا يتغيّر: app.mjs تأخذ منه فعلَ زرّ الحوار حين لا يسمّيه النموذج.
  const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
  // رأس كل عمود مقرون بعموده صراحةً (scope)؛ العدّة ترسم الجدول وهذا يضيف السمة وحدها. يسقط حين ترسمها العدّة نفسها.
  // والعمود الأخير للأفعال بلا عنوان مرئي (محسّن الجوال لا يكتب له تسمية)، فيُسمّى للقارئ الآلي وحده.
  const scoped=html=>html.replace(/<th>/g,'<th scope="col">').replaceAll('<th scope="col"></th>','<th scope="col" aria-label="الإجراء"></th>');
  const stamp=value=>typeof date==='function'?date(value):String(value??'').slice(0,10);

  // (1) الحال بالأرقام: البلاطات في صفّها، وتحتها ما يعنيه كل رقم سطرًا سطرًا.
  const confinedNames=data.confined_in_code.map(capabilityName).join('، ')||'ولا واحد';
  const counts=`<section class="panel"><div class="panel-head"><div><h2>وين وصلنا</h2><p>${e(s.total)} تصريحًا، كل واحد بنطاقه.</p></div></div>`
   +`<div class="panel-body vn-board"><div class="vn-tiles">`
   +ui.tile(s.department,'تصريحًا يقبل نطاق إدارة عند المنح')
   +ui.tile(s.confined_in_code,'منها محصور بإدارة فعلًا اليوم','is-due')
   +ui.tile(s.personal,'تصريحًا خاصًّا بصاحبه')
   +ui.tile(s.company,'تصريحًا على مستوى الشركة')
   +`</div><ul class="vn-list">`
   +ui.row({title:'المحصور بإدارة فعلًا',meta:`${confinedNames}. والباقي يقبل نطاق إدارة عند المنح، بس ما يصفّي فيه للحين.`})
   +ui.row({title:`${s.stage_b_guard} من تصاريح الشركة تنحصر بتعديل الحارس بس`,meta:'تعديلٌ في الكود، ما يحتاج قرارًا منك.'})
   +ui.row({title:`${s.stage_b_schema} من تصاريح الشركة تحتاج قرارًا منك`,meta:'هل ينحصر المورد الواحد بإدارة أصلًا؟ حصرها يحتاج عمودًا جديدًا في سجل عام وقرار ردم.'})
   +`</ul></div></section>`;

  // (2) المفتاح والمقارنة الظلية. المقارنة **محفوظة لا محسوبة عند كل فتح**: تمرّ على كل حساب × كل تصريح
  // × كل إدارة، والخادم بخيط واحد. فتُعرض نتيجة آخر تشغيل بختمها، ويشغّلها الأدمن الأول بزر.
  // ولأدمن الإدارة الحكمُ والأرقام بلا أسماء: الاختلافات تسمّي حسابات الكيان كله، وهو لا يبلغ غير إدارته.
  const shadowVerdict=shadow.never_run
   ?'<p>ما شغّلت المقارنة للحين. شغّلها أول: المفتاح ما يشتغل أول مرة قبلها.</p>'
   :shadow.clean
    ?`<p>المقارنة نظيفة: ${e(shadow.users)} حسابًا نشطًا × ${e(shadow.capabilities)} تصريحًا (${e(shadow.checks)} مقارنة)، وما اختلف ولا واحد. ما أحد يكسب تصريحًا ولا أحد يفقده.</p>`
    :`<p>المقارنة مو نظيفة: ${e(shadow.gained)} كسبًا و${e(shadow.lost)} فقدانًا في ${e(shadow.checks)} مقارنة.${data.switch.first_enabled_at?' وهذا متوقَّع بعد ما أُسند مستوى عن قصد؛ شرط «صفر اختلاف» للتشغيل الأول بس.':' المفتاح ما يشتغل أول مرة لين تصير صفرًا.'}</p>`
     +(shadow.names_withheld
       ?'<p class="subtle">أسماء اللي يكسبون أو يفقدون تظهر للأدمن الأول بس: الاختلافات تسمّي حسابات الكيان كله، وأنت تضبط إدارتك.</p>'
       :scoped(ui.table({head:['الحساب','التصريح','الإدارة','الاتجاه'],rows:shadow.differences.map(d=>`<tr><td>${e(d.user_name)}</td><td>${e(d.capability_name)}</td><td>${e(d.department_id?deptName(d.department_id):'كل الإدارات')}</td><td>${e(d.direction==='gained'?'يكسب':'يفقد')}</td></tr>`)})));
  const shadowStamp=shadow.never_run?''
   :`<p class="subtle">آخر تشغيل: <time datetime="${e(shadow.ran_at)}">${e(stamp(shadow.ran_at))}</time>.</p>${shadow.dirty?'<p class="vn-alert is-due">تغيّر القالب أو الاستثناءات أو مستويات الحسابات بعدها، فالنتيجة فوق ما عادت تمثّل الحال. شغّلها من جديد.</p>':''}`;
  const switchPanel=`<section class="panel"><div class="panel-head"><div><h2>المفتاح والمقارنة الظلية</h2><p>حساب المستويات ${on?'شغّال: المستوى يحكم القائمة وبوابات المسارات.':'مطفّى: الصلاحيات تمشي على الأدوار والمنح مثل ما هي، والمستويات ما لها أثر.'}</p></div>`
   +`${data.can_edit_template?`<div class="operation-actions">${button('shadow','','تشغيل المقارنة')}${button('switch','',on?'إطفاء المفتاح':'تشغيل المفتاح')}</div>`:''}</div><div class="panel-body">${shadowVerdict}${shadowStamp}`
   +`${data.switch.basis?`<p class="subtle">السند: ${e(data.switch.basis)}</p>`:''}`
   +`<p class="subtle measure">الترتيب: شغّل المفتاح والمقارنة نظيفة، <strong>وبعدها</strong> أسند المستويات — الإسناد نفسه يخلّي المقارنة غير نظيفة، وهذا المقصود. وبعد أول تشغيل ناجح تقدر تطفّيه وترجّعه بلا شرط «صفر اختلاف».</p></div></section>`;

  // (3) القالب: جدول لكل مجموعة في بطاقتها (لا صفّ فاصل «— المجموعة» داخل جدول واحد)، فرؤوس الأعمدة قريبة من بياناتها،
  //     وعلى الجوال يصير كل تصريح سجلًّا بأسماء أعمدته. ما هو على مستوى الشركة يُعرض باسم حامله
  //     وبلا منتقي إدارة، ويعدّله الأدمن الأول بتأكيد يقول له أن وضعه في مستوى لا يحصره بإدارة.
  //     النطاق صنفٌ لا حالة، فيُكتب كلمةً بلا لون حالة؛ و«حساس» انتباهٌ لا رفض.
  const groups=[...new Set(data.capabilities.map(c=>c.group))];
  const quiet=spoken=>`<span class="subtle" aria-hidden="true">—</span><span class="sr-only">${e(spoken)}</span>`;
  const cell=(c,level)=>{
   if(!c.grantable)return quiet('ما يُمنح بمستوى');
   const in_level=c.levels.includes(level);
   if(!data.can_edit_template)return in_level?'<span class="badge approved">ضمن المستوى</span>':quiet('خارج المستوى');
   const verb=in_level?'أخرجه':'أضفه';
   return `${in_level?'<span class="badge approved">ضمن المستوى</span> ':''}${named(button('template',`${level}:${c.key}`,verb),`${verb}: «${c.name}» ${in_level?'من':'إلى'} مستوى ${LEVEL_NAMES[level]}`)}`;
  };
  const capabilityRow=c=>`<tr><td><strong>${e(c.name)}</strong><br><code class="ltr" translate="no">${e(c.key)}</code>${c.sensitive?' <span class="badge is-warn">حساس</span>':''}</td>`
    +`<td><span class="badge">${e(SCOPE_NAMES[c.scope])}</span>${c.confined_in_code?' <span class="badge approved">محصور في الكود</span>':''}`
    +`${c.stage?`<br><small class="subtle">${e(STAGE_NAMES[c.stage])}</small>`:''}`
    +`${c.scope==='company'&&c.holders.length?`<br><small class="subtle">يحمله: ${e(c.holders.join('، '))}</small>`:''}`
    +`${c.scope==='company'&&!c.holders.length&&c.grantable?'<br><small class="subtle">ما يحمله أحد</small>':''}</td>`
    +`<td>${cell(c,'department_manager')}</td><td>${cell(c,'employee')}</td><td>${cell(c,'department_admin')}</td></tr>`;
  // كل مجموعة بطاقة مفتوحة: رأسها يقول كم منها في كل مستوى، فتُطوى المجموعة التي فُرغ منها ويبقى عدّها ظاهرًا.
  const groupTable=group=>{
   const list=data.capabilities.filter(c=>c.group===group),inLevel=level=>list.filter(c=>c.levels.includes(level)).length;
   return ui.card({code:String(list.length),title:group,open:true,
    meta:Object.entries(LEVEL_NAMES).map(([level,name])=>`${name} ${inLevel(level)}`).join(' · '),
    body:scoped(ui.table({head:TEMPLATE_HEAD,rows:list.map(capabilityRow)}))});
  };
  // العدد من البيانات لا من نصٍّ مكتوب: «سبع عشرة» كانت ثابتة في الشاشة بينما القائمة في يدها.
  const activeDepartments=data.departments.filter(d=>d.active).length;
  const template=`<section class="panel"><div class="panel-head"><div><h2>قالب الشركة</h2><p>قالب واحد لـ${e(activeDepartments)} إدارة. التصريح اللي على مستوى الشركة يظهر باسم اللي يحمله، وما له اختيار إدارة لأنه ما ينحصر بإدارة.</p></div></div>`
   +groups.map(groupTable).join('')
   +`<div class="panel-body"><p class="subtle measure">مستوى «موظف» فاضي عن قصد: الموظف ما يحمل إلا تصاريح «الجميع» الست، وهذي ما تُمنح، فحطّها في القالب يوهم بقرار ما صار.</p></div></section>`;

  // (4) استثناءات الإدارات: الإدارة والمستوى والتصريح والوضع وسببه. كاتب الاستثناء هو الأدمن الأول دائمًا، فلا عمود لاسمه:
  //     القرار وسنده هما ما يُقرأ هنا، ومن كتبه في سجل التدقيق.
  const exceptionRows=data.exceptions.map(x=>`<tr><td>${e(deptName(x.department_id))}</td><td>${e(LEVEL_NAMES[x.level]||x.level)}</td><td>${e(capabilityName(x.capability))}</td><td>${e(MODE_NAMES[x.mode]||x.mode)}</td><td>${e(x.basis)}</td></tr>`);
  const exceptions=data.can_edit_template?`<section class="panel"><div class="panel-head"><div><h2>استثناءات الإدارات</h2><p>الإدارة اللي ما لها استثناء تاخذ قالب الشركة حرفيًا. الاستثناء ما ينحذف: الرجوع عنه سطر جديد بوضع «يتبع قالب الشركة» وسببه.</p></div><div class="operation-actions">${button('exception','','استثناء لإدارة')}</div></div>`
   +scoped(ui.table({head:['الإدارة','المستوى','التصريح','الوضع','السبب'],rows:exceptionRows,empty:{title:'ما فيه استثناء لأي إدارة',body:'كل الإدارات على قالب الشركة، وهذا الأصل لين تحتاج إدارة غيره.'}}))+'</section>':'';

  // (5) مستوى كل حساب. المستوى صنفٌ لا حالة، فيُكتب كلمةً؛ والصفّ الباقي من دور سابق يُعلَّم انتباهًا.
  const peopleRows=data.users.map(p=>`<tr class="${p.active?'':'is-inactive'}"><td><strong>${e(p.name)}</strong><br><code translate="no">${e(p.username)}</code>${p.active?'':' <span class="badge inactive">موقوف</span>'}</td><td>${e(deptName(p.department_id))}</td><td>${e(ROLE_LABELS[p.role]||p.role)}</td>`
   +`<td><span class="badge">${e(LEVEL_NAMES[p.level]||p.level)}</span>${p.level_source==='stale'?` <span class="badge is-warn">${e(SOURCE_NOTES.stale)}</span> <small class="subtle">اللي يشتقه دوره اليوم: ${e(LEVEL_NAMES[p.derived_level]||p.derived_level||'—')}</small>`:p.level_source==='derived'?` <small class="subtle">${e(SOURCE_NOTES.derived)}</small>`:''}</td>`
   +`<td>${data.can_edit_levels&&p.active?named(button('level',p.id,'تغيير المستوى'),`تغيير المستوى: ${p.name}`):''}</td></tr>`);
  const people=`<section class="panel"><div class="panel-head"><div><h2>مستوى كل حساب</h2><p>${data.can_edit_template?'كل حسابات الكيان.':'أعضاء إدارتك بس: أدمن الإدارة يضبط إدارته وما يوصل غيرها، وما يضبط مستوى نفسه.'}</p></div></div>`
   +scoped(ui.table({head:['الحساب','الإدارة','الدور','المستوى',''],rows:peopleRows,empty:{title:'ما فيه حساب هنا',body:'ما فيه حساب في نطاقك للحين.'}}))+'</section>';

  // (6) ما لا تحله هذه الشاشة، مكتوبًا على الشاشة نفسها لا في وثيقة بعيدة: الحدّ وما يحلّه، بلا أسماء موجات بناء.
  const limits=`<section class="panel"><div class="panel-head"><div><h2>اللي ما تحلّه المصفوفة</h2></div></div><div class="panel-body"><ul class="vn-list">`
   +ui.row({title:'فصل المهام ما تحلّه المصفوفة',meta:'الإدارة اللي فيها شخص واحد يبقى مديرها منفّذها الوحيد مهما كان مستواه. الحل النائب المنفّذ في «إعداد الاعتماد».'})
   +ui.row({title:'المستوى يحكم القائمة وبوابات المسارات',meta:'بقية التصاريح تنحصر بإدارة عائلةً عائلة بحسب الاستعمال.'})
   +ui.row({title:'المنح الفردية تبقى مثل ما هي',meta:'اللي يحمله الموظف بمنح مسجَّل يبقى فوق مستواه، ويُراجَع في «مراجعة الصلاحيات». المستوى يضيف وما يسحب.'})
   +ui.row({title:'التصريح الحساس ما يجي بمستوى، أي مستوى من الثلاثة',meta:`ومنه الرواتب والتعويضات والتكلفة والربحية (${data.salary_capabilities.length} مفاتيح يُرفض طلبها باسمها فيقول الرفض «راتب»). يُمنح لشخص بعينه بمنح مسجَّل يوصل تنبيهه لصاحبه ولكل مسؤول منصة، ويدخل مراجعة الصلاحيات، ويُسحب بسحب منحه.`})
   +`</ul><p class="subtle">تمنح التصاريح الفردية وتسحبها من <a href="#accounts">الموظفون والصلاحيات</a>، وتراجعها دوريًّا في <a href="#access-reviews">مراجعة الصلاحيات</a>.</p></div></section>`;

  // مرجع التصعيد قبل القالب: هو الوقفة التي يقف عليها اعتماد الحدود وتبنّي المهل، وأربع عشرة إدارة
  // منه تشير اليوم إلى حساب لا يحمله أحد. من فتح هذه الشاشة يرى ذلك أولًا لا بعد ستة ألواح.
  return counts+escalationPanel(data,{e,button,ui,date})+switchPanel+template+exceptions+people+limits;
 },
 form(action,id,data){
  const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
  const levelOptions=Object.entries(LEVEL_NAMES).map(([value,label])=>({value,label}));
  const editable=data.capabilities.filter(c=>c.grantable&&!c.admin);
  if(action==='template'){
   if(!data.can_edit_template)throw Error('قالب الشركة يضبطه الأدمن الأول');
   const [level,key]=String(id).split(/:(.*)/s);
   const c=data.capabilities.find(x=>x.key===key);
   if(!c)throw Error('التصريح غير معروف');
   const on=c.levels.includes(level);
   return {title:`${on?'إخراج':'إضافة'} «${c.name}» ${on?'من':'إلى'} مستوى ${LEVEL_NAMES[level]||level}`,endpoint:'/permissions/template',
    fields:[field('confirm',`${c.scope==='company'?'هذا التصريح على مستوى الشركة: وضعه في مستوى ما يحصره بإدارة، وهذا اللي بيصير. ':''}أؤكد التغيير`,'checkbox')],
    toPayload:()=>({level,capability:key,included:!on})};
  }
  if(action==='exception'){
   if(!data.can_edit_template)throw Error('استثناءات الإدارات يضبطها الأدمن الأول');
   // «مضاف لهذه الإدارة» لا يجوز إلا على ما يحصره الكود فعلًا، والخادم يرفض ما سواه بـscope_not_confined.
   // فيُقال ذلك في القائمة نفسها قبل الإرسال: كل تصريح يحمل بجانبه ما يجوز عليه، وحقل الوضع يسمّي المحصور.
   const confined=new Set(data.confined_in_code);
   const confinedNames=data.capabilities.filter(c=>confined.has(c.key)).map(c=>c.name).join('، ')||'ولا واحد للحين';
   return {title:'استثناء لإدارة',endpoint:'/permissions/exceptions',fields:[
    field('department_id','الإدارة','select',{options:data.departments.filter(d=>d.active).map(d=>({value:d.id,label:d.name}))}),
    field('level','المستوى','select',{options:levelOptions}),
    field('capability','التصريح','select',{options:editable.map(c=>({value:c.key,label:`${c.group} · ${c.name} — ${SCOPE_NAMES[c.scope]}${confined.has(c.key)?' · يقبل الإضافة والحجب':' · الحجب فقط'}`}))}),
    field('mode','الوضع','select',{options:Object.entries(MODE_NAMES).map(([value,label])=>({value,label})),
     hint:`«مضاف لهذه الإدارة» يجوز بس على تصريح يحصره الكود بإدارة فعلًا، وهو اليوم: ${confinedNames}. وغيره يقبل الحجب والرجوع للقالب بس — التضييق صادق دائمًا، والإضافة تكذب لما الكود ما يحصر.`}),
    field('basis','سبب الاستثناء (10 أحرف على الأقل)','textarea',{hint:'يظهر بجنب الاستثناء في المصفوفة، فاكتبه لمن يقراه بعدك.'})],
    toPayload:v=>v};
  }
  if(action==='level'){
   if(!data.can_edit_levels)throw Error('ضبط المستويات متاح للأدمن الأول ولأدمن الإدارة في إدارته');
   const p=data.users.find(x=>x.id===id);
   if(!p)throw Error('الحساب غير متاح');
   const allowed=data.can_edit_template?levelOptions:levelOptions.filter(o=>o.value!=='department_admin');
   return {title:'مستوى '+p.name,endpoint:'/permissions/levels',fields:[
    field('level','المستوى','select',{options:allowed,value:p.level||'',
     hint:data.can_edit_template?'':'أدمن الإدارة يضبط أعضاء إدارته بس، وما يضبط مستوى نفسه، وما يرفع أحدًا لمستوى يحمل ضبط المستويات مهما كان اسمه.'}),
    field('reason','السبب','textarea',{required:false})],
    toPayload:v=>({user_id:id,level:v.level,reason:v.reason||''})};
  }
  if(action==='escalation')return escalationForm(id,data);
  if(action==='shadow'){
   if(!data.can_edit_template)throw Error('المقارنة الظلية يشغّلها الأدمن الأول');
   return {title:'تشغيل المقارنة الظلية',endpoint:'/permissions/shadow',
    fields:[field('confirm','تمرّ دالة القرار نفسها على كل حساب نشط وكل تصريح وكل إدارة. تاخذ لحظات والمنصة واقفة خلالها، وما تغيّر شي: تقرا وتحفظ النتيجة. أؤكد التشغيل','checkbox')],
    toPayload:()=>({})};
  }
  if(action==='switch'){
   if(!data.can_edit_template)throw Error('المفتاح يشغّله الأدمن الأول');
   const on=data.switch.enabled,firstTime=!data.switch.first_enabled_at;
   return {title:on?'إطفاء حساب المستويات':'تشغيل حساب المستويات',endpoint:'/permissions/switch',fields:[
    field('basis','السند (10 أحرف على الأقل)','textarea',{hint:on?'ليش يتطفّى الحين. والإطفاء ما يمحي اللي أُسند: إعادة التشغيل بعده ما تشترط «صفر اختلاف».'
     :firstTime?'اكتب نتيجة المقارنة الظلية مثل ما قريتها. المفتاح ما يشتغل أول مرة وفيها اختلاف واحد.'
     :'تشغيل بعد إطفاء: تنعاد المقارنة وتنحفظ نتيجتها في سجل التدقيق، وما يُشترط تكون صفرًا — الاختلاف بعد أول تشغيل هو اللي أسندته أنت.'})],
    toPayload:v=>({enabled:!on,basis:v.basis})};
  }
  throw Error('الإجراء غير متاح');
 }
};
