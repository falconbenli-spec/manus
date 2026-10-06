// المظهر (DESIGNS-ADDENDUM §هـ.5): تسعة تصاميم داخل نظام واحد، لكل منها وضع داكن وفاتح. يُحفظ الاختيار في الحساب ويتبع صاحبه على كل جهاز.
// الشاشة ترسم بأصناف قائمة فقط. المعاينات SVG بسمات عرض (fill وstroke) بلا style ولا class؛ سياسة المحتوى تمنع غير ذلك.
// الفيروزي يُكتب var(--brand-turquoise) حتى يبقى قرار المالك 1 برمز واحد؛ بقية الألوان حرفية لأنها تصف تصاميم غير التصميم الفعّال.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const TURQUOISE='var(--brand-turquoise)';
const COMMA='M5.11 0h8.62L7.4 10H0z';
const SOURCES={personal:'اختيارك',company:'افتراضي الشركة',default:'افتراضي المنصة'};
// لوحات المعاينة: أرض العمل، الحبر، الخط الفاصل، حبّة الفعل ونصها، وعلامات الكوكبة الست (نسبة الحلقة في الملحق §ج.7).
// المعاينة صادقة: الأرض والحبر والثانوي والفاصل والفعل ونصّه قيم رموز التصميم نفسه في ورقته (--canvas، --ink-1 أو --label،
// --ink-3، --line، --action و--on-action)، مقيسةً بمحرّك الشلال الذي في tests/contrast-tokens.test.mjs (1 أكتوبر 2026).
// صُحّح ما كان قديمًا: «كوكبة 360» فراغ أسود (نهارًا أبيض) بلا ألواح — كانت معاينتها أرضًا فيروزية داكنة بلوح زجاجي من نسخة
// سابقة للتصميم — و«الكلاسيكي» داكنًا أرضه أسود الدليل وبطاقته #1A1A1A، والفعل في «الكلاسيكي» و«مدار 360» الفاتح و«مركز الأثر»
// الفيروزي العميق بنصّ أبيض لا الفيروزي بنصّ أسود.
// surface (اختياري): بطاقة تطفو تحت الصفوف حيث للتصميم بطاقات (عائلة «الكلاسيكي»)؛ panel نصف قطر زواياها. عائلة الفراغ بلا لوح.
export const PALETTES={
  classicplus:{
    // لوحة «الكلاسيكي» من الدليل (تدقيق 1 أكتوبر): رماديات iOS صارت سلّم الفحمي والسماوي كما في classic.css.
    dark:{ground:'#000000',surface:'#1A1A1A',panel:8,ink:'#FFFFFF',soft:'rgba(235,235,235,.85)',line:'rgba(235,235,235,.18)',action:'#12806B',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#F2F6F9',surface:'#FFFFFF',panel:8,ink:'#000000',soft:'rgba(53,53,53,.85)',line:'rgba(53,53,53,.22)',action:'#12806B',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#353535','#7A5C00']}
  },

  markaz:{
    dark:{ground:'#141414',surface:'#1C1C1C',panel:12,ink:'#F4F4F5',soft:'rgba(244,244,245,.58)',line:'rgba(244,244,245,.14)',action:'#12806B',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#F2F3F5',surface:'#FFFFFF',panel:12,ink:'#1A1A1A',soft:'rgba(26,26,26,.60)',line:'rgba(26,26,26,.14)',action:'#12806B',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#353535','#7A5C00']}
  },
  depth:{
    dark:{ground:'#000000',ink:'#FFFFFF',soft:'#BDBDBD',line:'rgba(255,255,255,.14)',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#FFFFFF',ink:'#000000',soft:'#4A4E52',line:'rgba(0,0,0,.14)',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#353535','#7A5C00']}
  },
  studio:{
    dark:{ground:'#0C1716',surface:'#152522',panel:8,ink:'#EEF7F4',soft:'#B3C8C1',line:'#30483F',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#EDF3F2',surface:'#FFFFFF',panel:8,ink:'#102B27',soft:'#526762',line:'#D3DFDC',action:'#0E6B59',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#353535','#7A5C00']}
  },
  classic:{
    // لوحة «الكلاسيكي» من الدليل (تدقيق 1 أكتوبر): رماديات iOS صارت سلّم الفحمي والسماوي كما في classic.css.
    dark:{ground:'#000000',surface:'#1A1A1A',panel:8,ink:'#FFFFFF',soft:'rgba(235,235,235,.85)',line:'rgba(235,235,235,.18)',action:'#12806B',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#F2F6F9',surface:'#FFFFFF',panel:8,ink:'#000000',soft:'rgba(53,53,53,.85)',line:'rgba(53,53,53,.22)',action:'#12806B',onAction:'#FFFFFF',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#353535','#7A5C00']}
  },
  void:{
    dark:{ground:'#000000',ink:'#FFFFFF',soft:'#BDBDBD',line:'#383838',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#FFFFFF',ink:'#000000',soft:'#55595D',line:'#BDBDBD',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#353535','#7A5C00']}
  },
  field:{
    dark:{ground:'#353535',ink:'#FFFFFF',soft:'#CFCFCF',line:'#616161',action:TURQUOISE,onAction:'#000000',stage:true,marks:['#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#353535','#000000']},
    light:{ground:'#FAF9FF',ink:'#000000',soft:'#55595D',line:'#BAB9BE',action:TURQUOISE,onAction:'#000000',stage:true,marks:['#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#353535','#000000']}
  },
  // «الرواق»: علاماته الست تُظهر فكرته — لون فعل واحد ثم الحالات الأربع منفصلة عنه ثم الساكن.
  riwaq:{
    dark:{ground:'#2A2A2A',surface:'#353535',panel:6,ink:'#FFFFFF',soft:'#B4B4B4',line:'#4A4A4A',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,'#EBEBEB','#F1C40F','#FF9C8F','#AED6F1','#A3A3A3']},
    light:{ground:'#F2F6F9',surface:'#FFFFFF',panel:6,ink:'#000000',soft:'#4D5257',line:'#CBD7DF',action:'#12806B',onAction:'#FFFFFF',marks:['#12806B','#353535','#7A5C00','#C0392B','#21618C','#565B60']}
  },
  // «اليوم»: أرض ورق الهوية وبطاقة ترتفع عنها بزوايا واسعة (panel أوسع من الرواق)، وعلاماته الست كعلامات «الرواق» بحبر حالاته هو.
  yawm:{
    dark:{ground:'#1A1A1A',surface:'#242424',panel:12,ink:'#F6F6F6',soft:'#C2C2C2',line:'#333333',action:TURQUOISE,onAction:'#10221E',marks:[TURQUOISE,'#E4E4E4','#F6D55C','#F1897C','#8FCBEB','#9A9A9A']},
    light:{ground:'#FAF9FF',surface:'#FFFFFF',panel:12,ink:'#353535',soft:'#4D5257',line:'#DDE6ED',action:'#12806B',onAction:'#FFFFFF',marks:['#12806B','#353535','#7A5C00','#A93226','#1F6F9B','#6A7075']}
  },
  slate:{
    dark:{ground:'#353535',ink:'#FFFFFF',soft:'#CFCFCF',line:'#616161',action:TURQUOISE,onAction:'#000000',marks:[TURQUOISE,TURQUOISE,TURQUOISE,TURQUOISE,'#DDE6ED','#F1C40F']},
    light:{ground:'#DDE6ED',ink:'#000000',soft:'#3F4347',line:'#9FA6AB',action:'#12806B',onAction:'#FFFFFF',marks:['#12806B','#12806B','#12806B','#12806B','#353535','#5E4700']}
  }
};
const ROWS=[[44,70],[54,96],[64,58],[74,84]];
// معاينة واحدة 156×104 مرسومة من اليمين كما تُقرأ المنصة: شريط العنوان يمينًا، علامات الكوكبة يسارًا، أربعة صفوف بفواصلها، وحبّة الفعل.
// الإطار بلون الحبر الجاري (currentColor) حتى تظهر حدود معاينة سوداء على أرض سوداء؛ والمعاينة المطابقة للمظهر الفعّال إطارها فيروزي.
// تصميم أو وضع لا تعرفه هذه الوحدة (خادم أحدث منها) يُرسم بلوحة «كوكبة 360» بدل أن تنهار الشاشة كلها.
function preview(design,mode,label,active){
  const set=PALETTES[design]??PALETTES.depth,c=set[mode]??set.dark,headInk=c.stage?'#FFFFFF':c.ink;
  const stage=c.stage?`<rect x="0" y="0" width="156" height="32" fill="${TURQUOISE}"/>`:'';
  const surface=c.surface?`<rect x="6" y="38" width="144" height="44" rx="${c.panel??0}" fill="${c.surface}"/>`:'';
  const marks=c.marks.map((fill,i)=>`<path d="${COMMA}" transform="translate(${(12+i*12.4).toFixed(1)} 11)" fill="${fill}"/>`).join('');
  const rows=ROWS.map(([y,width])=>`<rect x="${144-width}" y="${y}" width="${width}" height="3" fill="${c.soft}"/><rect x="12" y="${y+6}" width="132" height="1" fill="${c.line}"/>`).join('');
  const frame=active?`<rect x="1.5" y="1.5" width="153" height="101" fill="none" stroke="${TURQUOISE}" stroke-width="3"/>`:'<rect x="0.5" y="0.5" width="155" height="103" fill="none" stroke="currentColor" stroke-opacity="0.32" stroke-width="1"/>';
  return `<svg role="img" aria-label="${label}" viewBox="0 0 156 104" width="156" height="104" focusable="false"><rect x="0" y="0" width="156" height="104" fill="${c.ground}"/>${stage}${surface}<rect x="96" y="12" width="48" height="8" fill="${headInk}"/>${marks}${rows}<rect x="100" y="86" width="44" height="12" rx="6" fill="${c.action}"/><rect x="110" y="91" width="24" height="2" fill="${c.onAction}"/>${frame}</svg>`;
}
export const appearanceUI={
  title:'المظهر',description:'تصميم المنصة ووضعها على ذوقك، والاختيار ينحفظ في حسابك ويتبعك على كل جهاز.',
  load:api=>api('/appearance'),
  render(data,{e,button}){
    const now=data.appearance,locked=!!now.locked,designName=key=>data.designs.find(d=>d.key===key)?.name??key,themeName=key=>data.themes.find(t=>t.key===key)?.name??key;
    const look=a=>`${e(designName(a.design))} · ${e(themeName(a.theme))}`;
    const head=`<section class="panel panel-body vn-head"><p>تصميمك الحين: <strong>${look(now)}</strong> — ${e(SOURCES[now.source]??SOURCES.default)}.${now.theme==='auto'?' والوضع يتبدّل بين الداكن والفاتح مع إعداد جهازك.':''}</p>${!locked&&now.source==='personal'?`<div class="operation-actions">${button('reset','','العودة إلى افتراضي الشركة')}</div>`:''}</section>`;
    const lock=locked?`<div class="vn-alert"><strong>المظهر موحّد من إدارة المنصة.</strong><p>الكل على افتراضي الشركة: ${look(data.company)}.${data.personal?' اختيارك الشخصي محفوظ، ويرجع مثل ما كان لما ينرفع التوحيد.':''}</p></div>`:'';
    const block=d=>{
      const current=d.key===now.design,activeMode=current&&now.theme!=='auto'?now.theme:'';
      // الاسم اللاتيني بلغته (lang) فيُنطق ويُتباعد كاللاتيني، والزرّ يسمّي تصميمه: تسعة أزرار «اختيار هذا التصميم» لا يفرّقها
      // قارئ الشاشة ولا المتحدّث إلى جهازه.
      return `<section class="vn-block"><h3>${e(d.name)}${current?' <span class="badge">الحالي</span>':''}</h3><p><bdi class="ltr" dir="ltr" lang="en" translate="no">${e(d.latin)}</bdi></p><p>${e(d.description)}</p><p>${preview(d.key,'dark',`معاينة ${e(d.name)} في الوضع الداكن`,activeMode==='dark')} ${preview(d.key,'light',`معاينة ${e(d.name)} في الوضع الفاتح`,activeMode==='light')}</p><p class="subtle">المعاينتان: الداكن وبعده الفاتح.${current?` المفعّل الحين: ${e(themeName(now.theme))}.`:''}</p>${locked?'':`<div class="operation-actions">${button('choose',d.key,current?'تغيير الوضع':`اختيار «${d.name}»`)}</div>`}</section>`;
    };
    const grid=`<div class="vn-grid">${data.designs.map(block).join('')}</div>`;
    const modes=locked?'':`<section class="vn-block"><h3>الوضع</h3><p>الداكن هو الأصل لكل حساب. و«يتبع الجهاز» اختيار تحدده بنفسك: يبدّل بين الداكن والفاتح مع إعداد جهازك.</p><div class="operation-actions">${data.themes.map(t=>button('choose',`${now.design}:${t.key}`,t.key===now.theme?`${t.name} — الحالي`:t.name)).join('')}</div><p class="subtle">زر «الوضع» في الفهرس يبدّل بين الثلاثة بضغطة، ويحفظ في حسابك بعد.</p></section>`;
    const c=data.company;
    // التاريخ وحده بجوار آخر تغيير: من غيّره وسببه في سجل التدقيق لا في جسم الشاشة (معيار المالك: المادة وسندها).
    const company=data.can_manage?`<section class="vn-block"><h3>افتراضي الشركة</h3><p>يبدأ عليه كل اللي ما اختار لنفسه: <strong>${look(c)}</strong> · اختيار الموظفين: <strong>${c.locked?'موحّد، الكل على الافتراضي':'مسموح، لكل موظف اختياره'}</strong>${c.updated_at?` · آخر تغيير <bdi class="ltr" dir="ltr">${e(c.updated_at.slice(0,10))}</bdi>`:' · ما تغيّر للحين (افتراضي المنصة)'}.</p><p class="subtle">التوحيد ما يحذف اختيارات الموظفين؛ يتجاهلها لين ينرفع. وكل تغيير بسببه ينحفظ في سجل التدقيق.</p><div class="operation-actions">${button('company','','تغيير افتراضي الشركة')}</div></section>`:'';
    return `${head}${lock}${grid}${modes}${company}`;
  },
  // أسماء العمليات الثلاث لا تحمل كلمة من تعبير destructive في app.mjs (وفيه void)؛ لذلك التصميم في id لا في اسم العملية.
  // اسما الحقلين design وtheme عقد: المعاينة الحية في app.mjs تقرؤهما بالاسم.
  form(action,id,data){
    const designs=data.designs.map(d=>({value:d.key,label:d.name})),themes=data.themes.map(t=>({value:t.key,label:t.name})),themeHint='«يتبع الجهاز» يبدّل بين الداكن والفاتح مع إعداد جهازك.';
    if(action==='choose'){
      guard(!data.appearance.locked);
      const [design,theme=data.appearance.theme]=String(id??'').split(':');
      guard(designs.some(d=>d.value===design)&&themes.some(t=>t.value===theme));
      return {title:'اختيار التصميم',endpoint:'/account/appearance',submit:'حفظ المظهر',fields:[field('design','التصميم','select',{value:design,options:designs}),field('theme','الوضع','select',{value:theme,options:themes,hint:themeHint})],toPayload:v=>({design:v.design,theme:v.theme})};
    }
    if(action==='reset'){guard(!data.appearance.locked);return {title:'العودة إلى افتراضي الشركة',endpoint:'/account/appearance',submit:'العودة إلى الافتراضي',fields:[],toPayload:()=>({reset:true})};}
    if(action==='company'){
      guard(data.can_manage);const c=data.company;
      return {title:'افتراضي الشركة للمظهر',endpoint:'/admin/appearance',submit:'حفظ افتراضي الشركة',fields:[field('design','التصميم','select',{value:c.design,options:designs}),field('theme','الوضع','select',{value:c.theme,options:themes,hint:themeHint}),field('locked','اختيار الموظفين','select',{value:c.locked?'1':'0',options:[{value:'0',label:'مسموح: لكل موظف اختياره'},{value:'1',label:'موحّد: الجميع على افتراضي الشركة'}]}),field('reason','سبب القرار','textarea',{maxLength:1000,hint:'10 أحرف على الأقل، وينحفظ في سجل التدقيق.'})],
        toPayload:v=>({design:v.design,theme:v.theme,locked:v.locked==='1',reason:v.reason,version:c.version})};
    }
    throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
  }
};
