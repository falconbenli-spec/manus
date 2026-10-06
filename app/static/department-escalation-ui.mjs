// لوح «من يغطّي كل إدارة» داخل مصفوفة الصلاحيات (شاشة المالك).
// الحقيقة المقيسة أولًا بالأرقام، ثم صفٌّ لكل إدارة نشطة باسم من يقف فوق مديرها اليوم وعلامةٍ صريحة
// على من يشير إلى حساب مصطنع لا يحمله أحد. لا مكوّن محلي: كل ما يُرسم من ctx.ui (app/static/kit.mjs).
//
// وهذه الوحدة تستوردها permissions-matrix-ui.mjs، فوجودها في خريطة أصول الخادم (app/server.mjs) شرطُ
// ظهور الشاشة: وحدةٌ تُستورد ولا تُقدَّم تترك الصفحة بيضاء في المتصفح بينما كل اختبار داخل العملية يمرّ.
const STATE_BADGES=[
 ['missing','rejected','ما لها مرجع'],
 ['inactive','rejected','الحساب موقوف'],
 ['synthetic','pending','حساب تجريبي ما يحمله أحد'],
 ['internal','pending','المرجع من داخل الإدارة نفسها']
];

export function escalationPanel(data,{e,button,ui,date}){
 const board=data.escalation??[],summary=data.escalation_summary??null;
 if(!summary)return '';
 // البلاطات في صفّها (.vn-tiles)؛ كانت تُرسم متتابعة بلا حاوية فينزل كل رقم في سطر. ولون الحالة حين يصدق وحده:
 // «سليم» حين تسلم الإدارات كلها، والتأخر والانتباه حين يكون فيهما شيء — صفرٌ لا يُلوَّن إنذارًا ولا طمأنينة.
 const unreachable=summary.missing+summary.inactive;
 const counts=`<div class="vn-tiles">${ui.tile(summary.departments,'إدارة نشطة لها سُلَّم تصعيد')
  +ui.tile(summary.healthy,'منها مرجعها حساب حقيقي نشط بدور مدير',summary.departments&&summary.healthy===summary.departments?'is-ok':'')
  +ui.tile(summary.synthetic,'منها تشير إلى حساب تجريبي ما يحمله أحد',summary.synthetic?'is-late':'')
  +ui.tile(unreachable,'ما لها مرجع أو مرجعها موقوف',unreachable?'is-due':'')}</div>`;
 // الزرّ يتكرر في كل صف، فاسمه المسموع يحمل إدارته ويبدأ بنصّه الظاهر (WCAG 2.5.3). نصّه الظاهر يبقى فعلَ زرّ الحوار.
 const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
 const since=value=>typeof date==='function'?date(value):String(value??'').slice(0,10);
 // الصفّ يقول المرجع وسنده ومنذ متى؛ من سمّاه في سجل التدقيق لا في جسم الصفّ (معيار المالك للشاشة: المادة وسندها).
 const line=item=>{
  const marks=STATE_BADGES.filter(([key])=>item[key]).map(([,tone,label])=>`<span class="badge ${tone}">${e(label)}</span>`).join(' ');
  const holder=item.missing?'<span class="subtle">ما تسمّى أحد</span>'
   :`<strong>${e(item.holder_name??item.user_id)}</strong>${item.holder_role_name?` <small class="subtle">${e(item.holder_role_name)}</small>`:''}`;
  const stamp=item.assigned_at?`<br><small class="subtle">من <time datetime="${e(item.assigned_at)}">${e(since(item.assigned_at))}</time></small>`:'';
  const basis=item.note?`<br><small class="subtle">السند: ${e(item.note)}</small>`:'';
  return `<tr><td><strong>${e(item.department_name)}</strong><br><code class="ltr" translate="no">${e(item.department_id)}</code></td>`
   +`<td>${e(item.sector||'—')}</td><td>${holder}${stamp}${basis}</td><td>${marks||'<span class="badge approved">قائم</span>'}</td>`
   +`<td>${data.can_edit_escalation?named(button('escalation',item.department_id,item.missing?'تسمية مرجع':'تغيير المرجع'),`${item.missing?'تسمية مرجع':'تغيير المرجع'}: ${item.department_name}`):''}</td></tr>`;
 };
 const scoped=html=>html.replace(/<th>/g,'<th scope="col">').replaceAll('<th scope="col"></th>','<th scope="col" aria-label="الإجراء"></th>');
 return `<section class="panel"><div class="panel-head"><div><h2>من يغطّي كل إدارة</h2>`
  +`<p>مرجع التصعيد هو اللي فوق مدير الإدارة: له يصعد طلبه، وعن طريقه بس ينفتح اعتماد حدود الاعتماد وتبنّي مهل محرك العمل. تسمّيه وتغيّره من هنا.</p></div></div>`
  +`<div class="panel-body vn-board">${counts}`
  +`<p class="subtle measure">الحساب المعلَّم «تجريبي» بذرته المنصة وما يحمله إنسان، فالتصعيد له يوقف عنده. والمرجع من داخل الإدارة نفسها جائز ومعلَّم: يعني طلب مديرها ممكن يرجع له هو.</p></div>`
  +scoped(ui.table({head:['الإدارة','القطاع','مرجع التصعيد اليوم','الحال',''],rows:board.map(line),
    empty:{title:'ما فيه إدارة نشطة في هذا الكيان',body:'تنضاف الإدارات من «الإدارات والهيكل»، وبعدها يتسمّى مرجع تصعيد لكل وحدة.'}}))
  +'</section>';
}

// نموذج التسمية. المرشحون هم عين ما يقبله الخادم (حسابات نشطة بدور «مدير» في الكيان)، فلا يُعرض اسم يُرفض بعد الإرسال.
export function escalationForm(id,data){
 if(!data.can_edit_escalation)throw Error('تسمية مرجع التصعيد يقرّرها الأدمن الأول');
 const item=(data.escalation??[]).find(x=>x.department_id===id);
 if(!item)throw Error('الإدارة غير متاحة في هذه الشاشة');
 const options=(data.escalation_candidates??[]).map(c=>({value:c.id,
  label:`${c.name} — ${c.department_name}${c.synthetic?' · حساب تجريبي':''}${c.department_id===item.department_id?' · من داخل الإدارة نفسها':''}`}));
 return {title:`مرجع تصعيد ${item.department_name}`,endpoint:'/permissions/escalation',fields:[
  {name:'user_id',label:'المرجع',type:'select',options,value:item.user_id||'',
   hint:'الحسابات النشطة بدور «مدير» في كيانك بس. الحساب المعلَّم «تجريبي» ما يحمله أحد، واختياره يخلّي التصعيد واقفًا مكانه.'},
  {name:'basis',label:'سند التسمية (10 أحرف على الأقل)',type:'textarea',
   hint:'ليش هذا المرجع ومتى تقرّر. يظهر بجنب الاسم في هذا اللوح، ويبقى في سجل التدقيق.'}],
  toPayload:value=>({department_id:item.department_id,user_id:value.user_id,basis:value.basis})};
}
