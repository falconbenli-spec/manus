import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync,readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { kit } from '../app/static/kit.mjs';

// العدّة (م0 «السور»): ما تصدره مطابق بالحرف للنسخ المحلية التي تحل محلها، فترحيل شاشة إليها لا يغيّر بايتًا من HTML.
const dir=new URL('../app/static/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir),'utf8');
// دالة التهريب كما في app.mjs.
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tr=(ar)=>ar,ui=kit(e,tr);
// مدخلات تكشف أي فرق: نص عادي، وصفر، وفارغ، وnull، ونص عدائي يحتاج تهريبًا، ولون وبلا لون.
const VALUES=[12,0,'','٣ أيام',null,undefined,'<script>alert(1)</script>','"اقتباس" & \'مفرد\''];
const TONES=['','is-late','is-due','is-ok is-old'];

// النسخة القديمة كما كانت تُنسخ، بحروفها. تبقى هنا بعد أن تزول آخر نسخة من الشاشات، فيظل الاختبار يثبت المطابقة.
const OLD_TILE="(value,label,t='')=>`<div class=\"vn-tile ${t}\"><strong>${e(value)}</strong><span>${e(label)}</span></div>`";

test('kit.tile is byte-identical to the old copy-pasted tile, including the trailing space when there is no tone',()=>{
  const old=runInNewContext(`(${OLD_TILE})`,{e});
  for(const value of VALUES)for(const label of VALUES){
    assert.equal(ui.tile(value,label),old(value,label));
    for(const tone of TONES)assert.equal(ui.tile(value,label,tone),old(value,label,tone));
  }
  assert.equal(ui.tile(5,'طلب مفتوح'),'<div class="vn-tile "><strong>5</strong><span>طلب مفتوح</span></div>');
  assert.equal(ui.tile(5,'متأخر','is-late'),'<div class="vn-tile is-late"><strong>5</strong><span>متأخر</span></div>');
});

test('kit.tile matches every local tile still living in a screen: they differ only in parameter naming',()=>{
  // كل «const tile=» من الصيغة السائدة في app/static، بأي أسماء وسائط، ومع e وسيطًا أول أو من الإغلاق.
  const FORM=/const tile=\((e,)?(\w+),(\w+),(\w+)=''\)=>`<div class="vn-tile \$\{(\w+)\}"><strong>\$\{e\((\w+)\)\}<\/strong><span>\$\{e\((\w+)\)\}<\/span><\/div>`/g;
  const copies=[],shapes=new Set(),signatures=new Set();
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.mjs')&&n!=='kit.mjs'))for(const m of read(name).matchAll(FORM)){
    const [whole,takesE,value,label,tone,toneUse,valueUse,labelUse]=m;
    assert.deepEqual([toneUse,valueUse,labelUse],[tone,value,label],`${name}: الوسائط تُستعمل في مواضعها`);
    copies.push({name,source:whole.replace(/^const tile=/,''),takesE:!!takesE});
    signatures.add(`${takesE?'e,':''}${value},${label},${tone}`);
    // بعد توحيد أسماء الوسائط تبقى صيغة واحدة.
    shapes.add(whole.replace(new RegExp(`\\b${tone}\\b`,'g'),'T').replace(new RegExp(`\\b${value}\\b`,'g'),'V').replace(new RegExp(`\\b${label}\\b`,'g'),'L').replace('(e,','('));
  }
  // الحد يثبت أن النمط ما زال يتعرّف على الصيغة السائدة، لا عددًا يُحرس: العدد ينزل كلما تبنّت شاشةٌ kit.tile، والمسنّنة
  // (scripts/quality-ratchet.mjs) هي التي تعدّه وتمنع صعوده. كان 40 حتى دفعة شاشات المشاريع، التي نقلت أربع عشرة نسخة إلى العدّة (من 48 إلى 34).
  assert.ok(copies.length>0,`وُجدت ${copies.length} نسخة محلية من الصيغة السائدة`);
  assert.ok(signatures.size>=4,`بـ${signatures.size} تواقيع مختلفة`);
  assert.equal(shapes.size,1,'كلها صيغة واحدة بعد توحيد أسماء الوسائط: '+[...shapes].join(' | '));
  for(const copy of copies){
    const local=runInNewContext(`(${copy.source})`,{e});
    for(const value of VALUES)for(const tone of TONES){
      const got=copy.takesE?local(e,value,'عنوان',tone):local(value,'عنوان',tone);
      assert.equal(ui.tile(value,'عنوان',tone),got,copy.name);
    }
  }
});

test('kit.tile with a link is the anchor form «طلباتي» used, and the link is escaped',()=>{
  const old=(value,label,href,cls='')=>`<a class="vn-tile ${cls}" href="${href}"><strong>${e(value)}</strong><span>${e(label)}</span></a>`;
  assert.equal(ui.tile(3,'مفتوح','','#my-requests'),old(3,'مفتوح','#my-requests'));
  assert.equal(ui.tile(0,'تجاوز موعده','is-late','#my-requests'),old(0,'تجاوز موعده','#my-requests','is-late'));
  assert.ok(ui.tile(1,'x','','"><script>').includes('href="&quot;&gt;&lt;script&gt;"'));
});

test('kit.empty, kit.pageHead and kit.statusBadge are byte-identical to the functions in app.mjs',()=>{
  const app=read('app.mjs');
  const emptySource=app.match(/^function empty\(title,body\)\{.*\}$/m)?.[0],headSource=app.match(/^function pageHead\(title,description,action=''\)\{.*\}$/m)?.[0];
  assert.ok(emptySource&&headSource,'الدالتان ما زالتا في app.mjs بصيغتهما');
  const sandbox={e};runInNewContext(`${emptySource};${headSource};this.empty=empty;this.pageHead=pageHead;`,sandbox);
  for(const a of VALUES.filter(v=>v!==undefined))for(const b of VALUES.filter(v=>v!==undefined)){
    assert.equal(ui.empty(a,b),sandbox.empty(a,b));
    assert.equal(ui.pageHead(a,b),sandbox.pageHead(a,b));
    assert.equal(ui.pageHead(a,b,'<button class="btn">جديد</button>'),sandbox.pageHead(a,b,'<button class="btn">جديد</button>'));
  }
  // badge في app.mjs: <span class="badge ${e(s)}">${e(statusLabel(s))}</span> بعبارة القاموس.
  assert.match(app,/const badge=s=>`<span class="badge \$\{e\(s\)\}">\$\{e\(statusLabel\(s\)\)\}<\/span>`;/);
  assert.equal(ui.statusBadge('pending'),'<span class="badge pending">بانتظار الاعتماد</span>');
  assert.equal(ui.statusBadge('in_progress'),'<span class="badge in_progress">قيد التنفيذ</span>');
  assert.equal(ui.statusBadge('odd"status'),'<span class="badge odd&quot;status">odd&quot;status</span>','حالة خارج الثماني تُعرض كما هي مهرَّبة');
});

test('kit.statusBadge with a module shows the one canonical phrase and keeps the module\'s own phrase beside it',()=>{
  assert.equal(ui.statusBadge('pending_manager',{module:'leave'}),'<span class="badge pending">بانتظار الاعتماد</span> <small class="subtle">بانتظار المدير</small>');
  assert.equal(ui.statusBadge('manager_approved',{module:'expense'}),'<span class="badge pending">بانتظار الاعتماد</span> <small class="subtle">بانتظار المالية</small>');
  // عبارة الوحدة المطابقة لعبارة القاموس لا تُكرَّر.
  assert.equal(ui.statusBadge('approved',{module:'leave'}),'<span class="badge approved">معتمد</span>');
});

test('kit.table is the table the mobile enhancer reads, and with no rows it renders an empty state instead of a header over nothing',()=>{
  const old=runInNewContext("((e,head,rows)=>`<div class=\"table-wrap\"><table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`)",{});
  // النسخة المحلية المرجعية كانت في pricing-ui.mjs، وقد انتقلت تلك الشاشة إلى ui.table (سجل التعريفات، ترحيل 123)؛ النسخة المطابقة لها بالحرف باقية في pipeline-estimates-ui.mjs.
  assert.ok(!/const table=/.test(read('pricing-ui.mjs')),'pricing-ui.mjs لم يعد يعرّف table محليًا');
  assert.ok(read('pipeline-estimates-ui.mjs').includes("const table=(e,head,rows)=>`<div class=\"table-wrap\"><table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;"),'النسخة المحلية المرجعية في pipeline-estimates-ui.mjs');
  const head=['البند','المبلغ <ريال>'],rows=['<tr><td>تصميم</td><td>1,200</td></tr>','<tr><td>إنتاج</td><td>900</td></tr>'];
  assert.equal(ui.table({head,rows}),old(e,head,rows));
  const none=ui.table({head,rows:[],empty:{title:'لا بنود في هذه الورقة',body:'أضف أول بند من «بند جديد».'}});
  assert.ok(!none.includes('<thead')&&!none.includes('<table'),'لا رأس فوق فراغ');
  assert.equal(none,ui.empty('لا بنود في هذه الورقة','أضف أول بند من «بند جديد».'));
  assert.equal(ui.table({head,rows:[],empty:'لا حركة مرحّلة'}),ui.empty('لا حركة مرحّلة',''));
  assert.equal(ui.table({head,rows:[]}),ui.empty('لا سجلات هنا بعد',''),'حالة فارغة افتراضية، لا صمت');
});

test('kit.row and kit.card carry the shared skeleton of the list row and the folding card',()=>{
  assert.equal(ui.row({title:'طلب خطاب',meta:'خدمات الموظف · منذ 3 أيام',tone:'is-late',href:'#request/abc',glyph:false}),
    '<li class="is-late"><a href="#request/abc"><strong>طلب خطاب</strong></a><span>خدمات الموظف · منذ 3 أيام</span></li>');
  assert.equal(ui.row({title:'بلا رابط',glyph:false}),'<li class=""><strong>بلا رابط</strong></li>');
  assert.equal(ui.row({title:'<b>',meta:'&',html:'<div class="operation-actions"></div>',glyph:false}),'<li class=""><strong>&lt;b&gt;</strong><span>&amp;</span><div class="operation-actions"></div></li>');
  assert.equal(ui.card({code:'CL-01',title:'عميل تجريبي',meta:'قطاع · مسؤول الحساب',body:'<p>تفاصيل</p>',glyph:false}),
    '<details class="vn-card"><summary><span class="vn-code">CL-01</span><span class="vn-name"><strong>عميل تجريبي</strong><small>قطاع · مسؤول الحساب</small></span></summary><p>تفاصيل</p></details>');
  assert.ok(ui.card({title:'x',open:true,glyph:false}).startsWith('<details class="vn-card" open>'));
  assert.ok(ui.card({title:'x',codeHtml:'<bdi dir="ltr">A-1</bdi>',glyph:false}).includes('<span class="vn-code"><bdi dir="ltr">A-1</bdi></span>'));
});

test('kit.refusal draws what was refused, what is missing, who holds it and the next step; a bare message keeps the old .error shape',()=>{
  const details={refusal:{what:'لا يبدأ التنفيذ المدفوع',missing:[{document:'أمر شراء العميل',why:'لم يُرفع بعد',owner:'مسؤول الحساب',owner_role:'account_manager'},{document:'الدفعة المقدمة',why:null,owner:'المالية',owner_role:'finance'}],next:'ارفع أمر الشراء من ملف المشروع',link:'#project-receipt'}};
  const html=ui.refusal(Object.assign(new Error('نص'),{details}));
  assert.equal(html,'<div class="vn-alert is-block" role="alert"><strong>لا يبدأ التنفيذ المدفوع</strong><ul class="vn-list"><li><strong>أمر شراء العميل</strong><span>لم يُرفع بعد · عند: مسؤول الحساب</span></li><li><strong>الدفعة المقدمة</strong><span>عند: المالية</span></li></ul><p>الخطوة التالية: ارفع أمر الشراء من ملف المشروع <a class="btn outline small" href="#project-receipt">فتح</a></p></div>');
  assert.equal(ui.refusal(details.refusal),html,'يقبل الكائن نفسه كما يقبل الخطأ');
  assert.equal(ui.refusal(new Error('الإجراء <غير> متاح')),'<div class="error" role="alert">الإجراء &lt;غير&gt; متاح</div>');
  assert.equal(ui.refusal('نص وحده'),'<div class="error" role="alert">نص وحده</div>');
  assert.ok(ui.refusal({what:'<x>',missing:[{document:'"d"',owner:'<o>'}]}).includes('&lt;x&gt;')&&!ui.refusal({what:'<x>',missing:[]}).includes('<x>'));
});

test('kit: nothing it emits breaks the content security policy, and it refuses to be built without an escaper',()=>{
  const everything=[ui.tile(1,'a','is-due','#x'),ui.row({title:'a',meta:'b',href:'#x'}),ui.card({title:'a',body:''}),ui.empty('a','b'),ui.table({head:['a'],rows:['<tr></tr>']}),
    ui.table({rows:[]}),ui.pageHead('a','b','c'),ui.statusBadge('pending'),ui.statusBadge('submitted',{module:'expense'}),ui.refusal({what:'a',missing:[{document:'d',owner:'o'}],next:'n',link:'#x'})].join('');
  assert.ok(!/style=|<script|\son[a-z]+=|javascript:/i.test(everything),'لا style= ولا script ولا معالج حدث داخل الترميز');
  assert.throws(()=>kit(),TypeError);assert.throws(()=>kit('e'),TypeError);
  assert.ok(Object.isFrozen(ui));assert.deepEqual(Object.keys(ui).sort(),['card','empty','fields','filters','label','pageHead','records','refusal','row','statusBadge','table','tile']);
});

test('kit: the language is read when a screen is drawn, so one kit survives a language switch',()=>{
  let lang='ar';const live=kit(e,(ar,en)=>lang==='ar'?ar:en);
  assert.equal(live.statusBadge('pending'),'<span class="badge pending">بانتظار الاعتماد</span>');
  lang='en';
  assert.equal(live.statusBadge('pending'),'<span class="badge pending">Awaiting approval</span>');
  assert.equal(live.table({rows:[]}),live.empty('Nothing here yet',''));
});

test('kit: app.mjs injects it as ctx.ui at the single module.render call site, and the server serves it',()=>{
  const app=read('app.mjs'),calls=app.match(/module\.render\(/g)??[];
  assert.equal(calls.length,1,'موضع واحد يرسم الشاشات التشغيلية');
  assert.match(app,/module\.render\(loaded,\{e,button,money,tr,lang,date,ui:uiKit\}\)/);
  // الوسيط الثالث وصلة سجل التعريفات، محروسة لأن صندوق الاختبارات بلا استيرادات: بلا الوصلة تُبنى العدّة كما كانت.
  assert.match(app,/uiKit=kit\(e,tr,typeof defsFor==='function'\?defsFor\(\(\)=>view,\(\)=>lang\):undefined\)/);assert.match(app,/import \{ kit \} from '\.\/kit\.mjs';/);
  const server=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
  for(const name of ['kit.mjs','vocabulary.mjs'])assert.ok(server.includes(`assets.set('/${name}',['${name}','text/javascript; charset=utf-8']);`),`${name} في قائمة الملفات المقدَّمة`);
});

test('kit: the six migrated daily screens take tile from ctx.ui and define none of their own',()=>{
  for(const name of ['my-requests-ui.mjs','request-transparency-ui.mjs','letters-ui.mjs','expenses-ui.mjs','payroll-ui.mjs','engagement-ui.mjs']){
    const source=read(name);
    assert.ok(!/const tile=/.test(source),`${name} ما زال يعرّف tile محليًا`);
    assert.match(source,/const \{tile(,empty)?\}=ui;/,`${name} يأخذ tile من ui`);
    assert.ok(!/from '\.\/kit\.mjs'/.test(source),`${name} تبنّى العدّة بلا سطر استيراد`);
  }
});

/* ───── سجل التعريفات: الوسيط الثالث اختياري، وافتراضه لا يغيّر بايتًا ───── */

test('kit: the third argument is optional — kit(e), kit(e,tr) and kit(e,tr,undefined) emit the same bytes, and an empty registry draws nothing',()=>{
  const plain=kit(e),withTr=kit(e,ar=>ar),withNone=kit(e,ar=>ar,undefined);
  const sample=k=>[k.tile(3,'العميل','is-due'),k.table({head:['العميل','الحالة'],rows:['<tr><td>أ</td><td>ب</td></tr>']}),k.statusBadge('pending'),k.statusBadge('manager_approved',{module:'expense'}),
    k.fields('client_quotation',{id:'q1',custom:[]},'header'),k.fields('client_quotation',{id:'q1'},'body'),k.label('client_quotation','client_id','العميل')].join('|');
  assert.equal(sample(withTr),sample(plain));assert.equal(sample(withNone),sample(plain));
  assert.equal(plain.fields('client_quotation',{id:'q1',custom:[]},'header'),'','بسجل فارغ لا يُرسم شيء في الموضع');
  assert.equal(plain.label('client_quotation','client_id','العميل'),'العميل');
  assert.equal(plain.statusBadge('issued',{entity:'client_quotation',name:'صدر للعميل'}),'<span class="badge">صدر للعميل</span>','شارة كيان بلا تجاوز = ترميز الشاشة القائم بالحرف');
});

test('kit: with the registry link, labels, status phrases and custom fields reach a hand-written screen — a missing value says «غير متاح» with its reason and owner',()=>{
  const glossary={'العميل':'الجهة'};
  const live=kit(e,ar=>ar,{text:s=>glossary[String(s).trim()]??s,label:(entity,key,fallback)=>key==='client_id'?'الجهة':fallback,
    status:(entity,status)=>status==='issued'?{label:'مُرسل',tone:'approved'}:null,term:key=>key==='status.request.pending'?'ينتظر القرار':null});
  assert.equal(live.label('client_quotation','client_id','العميل'),'الجهة');
  assert.ok(live.table({head:['العميل'],rows:['<tr><td>العميل</td></tr>']}).includes('<th>الجهة</th><'),'رأس الجدول تسمية');
  assert.ok(live.table({head:['العميل'],rows:['<tr><td>العميل</td></tr>']}).includes('<td>العميل</td>'),'الخلية بيانات مستخدم ولا تُمس');
  assert.equal(live.tile(4,'العميل'),'<div class="vn-tile "><strong>4</strong><span>الجهة</span></div>');
  assert.equal(live.statusBadge('issued',{entity:'client_quotation',name:'صدر للعميل'}),'<span class="badge approved">مُرسل</span>');
  assert.equal(live.statusBadge('pending'),'<span class="badge pending">ينتظر القرار</span>','تجاوز مفتاح القاموس يُسأل قبل القاموس');
  const record={id:'q1',version:3,custom:[
    {key:'lead_source',label:'مصدر الفرصة',label_en:'Lead source',slot:'header',kind:'recorded',value:'referral',text:'إحالة من عميل',tone:'approved',editable:true},
    {key:'brief',label:'ملخص',label_en:'',slot:null,kind:'unavailable',value:null,text:'غير متاح',reason:'لم يُدخل بعد',needed:'يستكمله معدّ العرض',editable:true}]};
  const header=live.fields('client_quotation',record,'header'),body=live.fields('client_quotation',record,'body');
  assert.ok(header.includes('<dt>مصدر الفرصة</dt><dd><span class="badge approved">إحالة من عميل</span></dd>'));
  assert.ok(!header.includes('data-action="custom-fields"'),'زر التعديل في المتن وحده');
  assert.ok(body.includes('<span class="cf-missing">غير متاح</span><small>لم يُدخل بعد — يستكمله معدّ العرض</small>'),'لا فراغ ولا صفر');
  assert.ok(body.includes('data-action="custom-fields" data-entity="client_quotation" data-id="q1"'));
  const list=live.records('client_quotation',[record],{id:'quotation-list',columns:[{key:'code',label:'رقم العرض',value:()=>'QT-0001'}],
    custom:[{field_key:'lead_source',label:'مصدر الفرصة',label_en:'Lead source',type:'select',filter:true,options:[{value:'referral',label:'إحالة من عميل'},{value:'event',label:'فعالية',retired:true}]}]});
  assert.ok(list.includes('<div class="cf-records" id="quotation-list">'));
  assert.ok(list.includes('<th>رقم العرض</th><th>مصدر الفرصة</th>'),'عمود القائمة بعد أعمدة الشاشة');
  assert.ok(list.includes('data-filter-text="QT-0001 إحالة من عميل" data-cf-lead_source="referral"'),'الصف يحمل نصه للبحث وقيمة الحقل للتصفية');
  assert.ok(list.includes('<select data-filter="#quotation-list" data-filter-key="cfLead_source">'),'المرشّح يعمل بـapplyTableFilters القائمة');
  assert.ok(list.includes('<option value="referral">إحالة من عميل</option>')&&!list.includes('فعالية'),'الخيار المسحوب لا يُعرض للتصفية');
  assert.ok(!/style=|<script|\son[a-z]+=|javascript:/i.test(header+body+list),'لا style= ولا script (CSP)');
});
