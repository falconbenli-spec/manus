import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeUI } from '../app/static/home-ui.mjs';
import { catalogHome, forYouRow, serviceCard } from '../app/static/catalog-home-ui.mjs';
import { HUB_SECTIONS, composeOperationPage } from '../app/static/hubs-ui.mjs';
import { HUBS, NAV_DEST } from '../app/static/nav-map.mjs';
import { inboxUI } from '../app/static/inbox-ui.mjs';
import { workBoard } from '../app/static/work-ui.mjs';
import { kit } from '../app/static/kit.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

test('التنقل اليومي له مدخل واحد باسم «عملي» وتصل إليه شارة ما ينتظر الموظف',()=>{
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  const signature=readFileSync(new URL('../app/static/signature.mjs',import.meta.url),'utf8');
  const home=readFileSync(new URL('../app/home.mjs',import.meta.url),'utf8');
  const notices=readFileSync(new URL('../app/notices.mjs',import.meta.url),'utf8');
  assert.equal((app.match(/nav\.push\(\['work'/g)??[]).length,1);
  assert.equal((app.match(/nav\.push\(\['inbox'/g)??[]).length,0);
  assert.equal(NAV_DEST.work.label,'عملي');
  assert.equal(HUBS.pending.route,'work');
  assert.match(app,/a\[href="#work"\]/);
  assert.match(signature,/setAttribute\('href','#work'\)/);
  assert.doesNotMatch(signature,/setAttribute\('href','#inbox'\)/);
  assert.doesNotMatch(home,/card\('(?:decisions|request_approvals)'[^\n]*'#inbox'/);
  assert.doesNotMatch(notices,/(?:approvals_digest|manager_digest):'#inbox'/);
});

test('الرئيسية الهادئة لا تكرر الأصفار ولا تعرض ملاحظات النظام الداخلية',()=>{
  const html=homeUI.render({
    me:{name:'موظف تجريبي',role:'employee',department:null},
    decisions:[],respond:[],tasks:[],my_requests:[],returned_by_me:[],
    quick_actions:[],top_services:[],today_card:null,cards:[],leave:[],my_documents:[],
    unavailable_notice:['وحدة داخلية'],note:'تفصيل تقني عن مصادر الأرقام',department:null,
    manager:null,hr:null,finance:null,executive:null,discipline:null
  },{e,tr:ar=>ar,lang:'ar'});
  assert.doesNotMatch(html,/hm-stats|vn-head/);
  assert.doesNotMatch(text(html),/مصادر لم تُحتسب|تفصيل تقني|لا رصيد إجازة|لا وثيقة لك/);
  assert.match(text(html),/أمورك تمام/);
});

test('دليل الخدمات يعرض عددًا مفهومًا ويخفي تشخيص الإسقاط والنواقص من الموظف',()=>{
  const tree={
    lens:'department',totals:{categories:1,cards:2,items:3},department_only_items:2,hidden_services:1,
    categories:[{key:'my_time',name:'وقتي',description:'خدمات الوقت',items:3,cards_count:2,cards:[]}],
    featured:[{name:'طلب إجازة',description:'خدمة مختارة',href:'#services/HR-LEAVE'}],for_you:null,
    open_requests:[],my_team:null,feedback_service:null,
    projection:{text:'إسقاط داخلي — النسخة 12',items_unplaced:0},
    gaps:{home:[{label:'قياس داخلي',why:'لم يُنفذ',needs:'قرار',owner:'المالك'}]}
  };
  const html=catalogHome(tree,{e,ui});
  const status=/<p class="sc-counts"[^>]*>([^<]+)<\/p>/.exec(html)?.[1];
  assert.equal(status,'5 خدمات متاحة لك');
  assert.doesNotMatch(text(html),/إسقاط داخلي|ما ليس في هذه الشاشة|موقوفة من الإعدادات|اختيار ثابت يدوي/);
});

test('إدارة المقترحات في موضع واحد ولا تزاحم كل بطاقة بزر مستقل',()=>{
  const item={key:'IT-SUPPORT',kind:'service',name:'الدعم التقني',description:'حل مشكلة تقنية',department_id:'it',
    path:[],target:null,season:null,items:1,options:[],members:[],eligible:true,href:'#services/IT-SUPPORT',service_id:'svc',
    for_you:{reasons:[{text:'طلبتها من قبل',link:''}]}};
  const html=forYouRow({for_you:{hidden_by_me:false,dismissed:[],items:[item]}},{e,ui});
  assert.equal((html.match(/data-action="hide-suggestion"/g)??[]).length,1);
  assert.match(html,/إدارة المقترحات/);
  assert.doesNotMatch(text(html),/لا تقترح هذه عليّ/);
});

test('بطاقة الخدمة تسمي الزمن غير المعتمد بلغة الموظف دون إسقاط تنبيه الصدق',()=>{
  const item={key:'IT-SUPPORT',kind:'service',name:'الدعم التقني',description:'حل مشكلة تقنية',department_id:'it',
    path:[],season:null,items:1,options:[],members:[],eligible:true,href:'#services/IT-SUPPORT',service_id:'svc',
    target:{kind:'derived',kind_name:'مشتق',adopted:false,amount:'5 أيام عمل',label:'5 أيام عمل — مشتق من عائلة رمز الخدمة، لم يتبنّه أحد بعد — ليس وعدًا قطعه أحد'}};
  const html=serviceCard(item,{e});
  assert.match(text(html),/5 أيام عمل · إرشادي/);
  assert.doesNotMatch(text(html),/5 أيام عمل · مشتق/);
  assert.match(html,/مشتق من عائلة رمز الخدمة/,'يبقى تنبيه المصدر الكامل في الوصف المسموع');
});

test('الملف الشخصي يقدّم بيانات الصفحة ثم روابطه ويجمعها في خمسة أقسام',()=>{
  assert.equal(HUB_SECTIONS.profile.length,5);
  const html=composeOperationPage({head:'<h1>ملفي</h1>',links:'<nav>روابط الملف</nav>',body:'<section>بيانات الموظف</section>',profile:true});
  assert.ok(html.indexOf('بيانات الموظف')<html.indexOf('روابط الملف'));
  assert.equal(HUB_SECTIONS.admin.length,4);
});

test('تعذّر مصدر داخلي لا يكشف اسم الوحدة للموظف',()=>{
  const inbox=inboxUI.render({groups:[],respond:[],unavailable:['payroll_internal'],note:'',late_note:''},{e,button:()=>''});
  assert.match(text(inbox),/بعض البيانات غير متاحة الآن/);
  assert.doesNotMatch(inbox,/payroll_internal|تعذر قراءة/);
  const work=workBoard({decisions:[],respond:[],doing:[],mine:[],returned_by_me:[],optional:[],personal:[],unavailable:['ledger_internal']},{e,date:String});
  assert.match(text(work),/بعض البيانات غير متاحة الآن/);
  assert.doesNotMatch(work,/ledger_internal|تعذر قراءة/);
});
