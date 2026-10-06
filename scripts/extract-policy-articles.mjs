// مولّد ترحيل 110 من نص اللائحة المستخرج من PDF.
//
// أنتج هذا السكربت app/migrations/110-policy-library.sql مرة واحدة، وهو محفوظ هنا لسبب واحد: حين يصل ملف PDF
// الموقّع تُعاد الاستخراجة بأمر واحد بدل إعادة كتابة العمل. ملف المصدر خارج Git (مجلد work مستبعد)، فالسكربت
// لا يعمل في التكامل المستمر ولا يستدعيه الخادم — يشغّله إنسان بيده:
//
//   node scripts/extract-policy-articles.mjs [مسار النص المستخرج] [مسار ملف SQL]
//
// تنبيه: 110 ترحيل مطبَّق. إعادة توليده فوق نفسه تكسر بصمة أي قاعدة قائمة؛ وجّه المخرَج إلى ترحيل جديد وقارنه.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { repairLine, reflowClauses, splitParagraphs, numberFromWords } from '../app/policy-extract.mjs';
import { normalize, tokens, stem } from '../app/arabic-text.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SRC=process.argv[2]??resolve(ROOT,'work/reference/manus-app/server/work-regulations.txt');
const OUT=process.argv[3]??resolve(ROOT,'app/migrations/110-policy-library.sql');

const CHAPTERS=[
 ['أحكام عامة',1,5],['التوظيف',6,17],['عقد العمل',18,38],['الإركاب',39,41],['التدريب',42,45],['الأجور',46,51],
 ['تقارير الأداء',52,55],['العلاوات والمكافآت',56,60],['الترقيات',61,62],['الانتداب',63,65],['المزايا والبدلات',66,72],
 ['أيام وساعات العمل',73,75],['العمل الإضافي',76,77],['التفتيش الإداري',78,79],['الإجازات',80,94],['الرعاية الطبية',95,100],
 ['أحكام خاصة بالمرأة',101,105],['الخدمات الاجتماعية',106,106],['ضوابط السلوك',107,110],['المخالفات والجزاءات',111,124],
 ['التظلم',125,126],['أحكام ختامية',127,127]];
const CHAPTER_LINE=new RegExp('^('+['أحكام عامة','احكام عامة','التوظيف','عقد العمل','الإركاب','الاركاب','التدريب','الأجور','الاجور','تقارير الأداء','العلاوات والمكافآت','الترقيات','الانتداب','الإنتداب','المزايا والبدلات','المزايا و البدلات','أيام وساعات العمل','العمل الإضافي','التفتيش الإداري','الإجازات','الاجازات','الرعاية الطبية','أحكام خاصة بالمرأة','الخدمات الاجتماعية','الخدمات الإجتماعية','ضوابط السلوك','المخالفات والجزاءات','التظلم','أحكام ختامية','احكام ختامية'].join('|')+')$');
const CHROME=[/^شركة ثلاثمائة وستون درجة للدعاية والاعلان$/,/^صفحة \d+\/52$/,/^شركة اسا للمحاماة والاستشارات القانونية$/,/^-{2,}$/,/^\(?\s*مادة\s*\)?\s*\d*$/,/^\(?\s*\d+\s*\)?$/];
const STOP=new Set(['في','من','على','عن','الى','او','التي','الذي','هذه','هذا','ما','لا','مع','كل','بعد','قبل','عند','غير','بين','ان','اذا','ذلك','لم','قد','به','له','لها','عليه','هو','هي','ثم','كما','حتى','الا','اي','مما','وفق','وذلك','عليها','العامل','المنشاه','اللائحه','يجوز','يجب','حال','حالات','التاليه','وفقا','يكون','تكون','بما','وان','ولا','الحق','المشار','اليها','عليهم','منها','عنه','عليها']);

const raw=readFileSync(SRC,'utf8').split('\n');
const fixed=raw.map(repairLine);
const marks=[];
raw.forEach((l,i)=>{const t=l.normalize('NFKC').trim();if(/^\(\s*\d+$/.test(t)&&raw[i+1]?.normalize('NFKC').includes('مادة'))marks.push({n:Number(t.slice(1).trim()),line:i});});
const tablesAt=fixed.findIndex((f,i)=>i>marks.at(-1).line&&f.text.trim()==='المخالفات والعقوبات');
const chapterOf=n=>CHAPTERS.find(([,a,b])=>n>=a&&n<=b);

const articles=[];
for(let k=0;k<marks.length;k++){
  const start=marks[k].line+2,end=k+1<marks.length?marks[k+1].line:tablesAt;
  const kept=[],artifacts=new Set();
  for(let i=start;i<end;i++){
    const t=fixed[i].text.trim();
    if(!t||CHROME.some(r=>r.test(t)))continue;
    for(const a of fixed[i].artifacts)artifacts.add(a);
    kept.push(t);
  }
  while(kept.length&&CHAPTER_LINE.test(kept.at(-1)))kept.pop();
  const {lines,moved}=reflowClauses(kept);
  if(moved)artifacts.add('clause_reflow');
  let title=null,titleSource='proposed',rest=lines;
  if(lines.length>1&&lines[0].length>=6&&lines[0].length<=70&&!/[.:؛،]$/.test(lines[0])&&!/^[.\d]/.test(lines[0])){title=lines[0];titleSource='extracted';rest=lines.slice(1);}
  const paragraphs=splitParagraphs(rest).map(p=>({...p,text:p.text.replace(/\.\s*:/g,'.').replace(/\s+([،.؛:])/g,'$1').replace(/،\./g,'.')}));
  if(!title){
    const first=(paragraphs.find(p=>p.text.length>12)??paragraphs[0])?.text??'';
    // «تحل هذه المادة محل المادة المتعلقة بـ…»: موضوع المادة هو ما بعد «المتعلقة»، وهو العنوان الطبيعي لها.
    const replaces=first.match(/تحل هذه المادة محل المادة المتعلقة\s*(?:\(\s*)?(?:ب)?(.{4,90}?)(?:\s*\)|[.؛]|$)/);
    if(replaces)title=replaces[1].replace(/[()]/g,'').replace(/\s+/g,' ').trim();
    else{
      title=first.split(/[،.؛:]/)[0].split(/\s+/).slice(0,9).join(' ');
      if(title.length<6)title=first.slice(0,60);
    }
    // عنوان ينتهي بحرف جر أو عطف مقطوع: تُحذف الكلمة الأخيرة فلا يقف العنوان في منتصف عبارة.
    title=title.replace(/\s+(?:عن|على|في|من|إلى|الى|أن|ان|و|أو|او|مع|بـ?|ل|ك)$/,'').trim();
  }
  // مادة خرج نصها تالفًا لا يُشتق منه عنوان: يبقى العنوان اسم موضعها حتى يقترح الأدمن عنوانًا بعد المطابقة.
  if(title.trim().length<3){title=`المادة ${marks[k].n} — ${chapterOf(marks[k].n)[0]}`;titleSource='proposed';artifacts.add('title_unavailable');}
  if(artifacts.has('tatweel_split')||artifacts.has('orphan_letter'))artifacts.add('broken_glyphs');
  const body=paragraphs.map(p=>(p.marker?`${p.marker}. `:'')+p.text).join('\n');
  articles.push({number:marks[k].n,chapter:chapterOf(marks[k].n)[0],chapter_order:CHAPTERS.findIndex(c=>c[0]===chapterOf(marks[k].n)[0])+1,
    title,title_source:titleSource,body,paragraphs,artifacts:[...artifacts].sort().filter(a=>a!=='tatweel_split'&&a!=='orphan_letter')});
}

// الكلمات المفتاحية: كلمات المادة المميزة — تتكرر فيها ولا تتكرر في كل مادة.
const df=new Map();
for(const a of articles){
  const seen=new Set(tokens(`${a.title} ${a.body}`).map(stem).filter(w=>w.length>2&&!STOP.has(w)));
  for(const w of seen)df.set(w,(df.get(w)??0)+1);
}
for(const a of articles){
  const counts=new Map();
  for(const w of tokens(`${a.title} ${a.title} ${a.body}`).map(stem)){
    if(w.length<=2||STOP.has(w))continue;
    counts.set(w,(counts.get(w)??0)+1);
  }
  a.keywords=[...counts].filter(([w])=>(df.get(w)??0)<=articles.length*0.25)
    .map(([w,c])=>[w,c*Math.log(articles.length/(df.get(w)??1))])
    .sort((x,y)=>y[1]-x[1]).slice(0,10).map(([w])=>w);
}

// ── الإحالات داخل النص ─────────────────────────────────────────────────────────
// «وفق المادة السادسة والعشرين» و«الفقرة (1) من المادة 40» تصير روابط. «المادة الثمانون من نظام العمل» مرجع خارجي.
const ARTICLE_WORD=/^(ال)?ماده$/;
function references(article){
  const words=normalize(`${article.title} ${article.body}`).split(/\s+/).filter(Boolean);
  const out=[];
  for(let i=0;i<words.length;i++){
    if(!ARTICLE_WORD.test(words[i].replace(/[^\p{L}]/gu,'')))continue;
    const tail=words.slice(i+1,i+7);
    let number=null,span=0;
    const digits=tail[0]?.match(/^\(?(\d{1,3})\)?$/);
    if(digits){number=Number(digits[1]);span=1;}
    else for(let end=1;end<=5&&end<=tail.length;end++){
      const value=numberFromWords(tail.slice(0,end));
      if(value!==null&&value<=200){number=value;span=end;}
    }
    if(number===null)continue;
    const window=words.slice(i,i+span+5).join(' ');
    const external=/نظام العمل|نظام, العمل|لائحته التنفيذيه|نظام التامينات/.test(window);
    const phrase=words.slice(Math.max(0,i-3),i+span+1).join(' ');
    out.push({number,external,phrase});
    i+=span;
  }
  // مرجع خارجي بلا رقم: ذكر نظام العمل مجردًا.
  if(!out.some(r=>r.external)&&/نظام العمل/.test(normalize(article.body)))out.push({number:null,external:true,phrase:'نظام العمل'});
  const seen=new Set();
  return out.filter(r=>{const key=`${r.number}:${r.external}`;if(seen.has(key))return false;seen.add(key);return true;});
}
for(const a of articles)a.references=references(a).filter(r=>r.external||(r.number>=1&&r.number<=127&&r.number!==a.number));

// ── الحالة والشارات ────────────────────────────────────────────────────────────
const REPLACEMENTS=[[105,[101]],[126,[125]],[72,[66,67,68]]];
const AMENDED=[41,65];
const status=new Map(articles.map(a=>[a.number,'in_force']));
for(const [,olds] of REPLACEMENTS)for(const old of olds)status.set(old,'replaced');
for(const n of AMENDED)status.set(n,'amended');

const uuid=(prefix,n)=>`${prefix}-${String(n).padStart(3,'0')}`;
const q=value=>value===null||value===undefined?'NULL':`'${String(value).replace(/'/g,"''")}'`;
const DOC='policy-doc-work-regulation';
const CIRCULAR='policy-doc-secondment-circular';
const BENEFITS='policy-doc-benefits-policy';
const NOTE='مستخرج — يحتاج مطابقة مع الأصل الموقّع';
const now='2026-09-20T00:00:00.000Z';

const SEED_SYNONYMS=[
 ['انتداب',['سفر عمل','مهمة رسمية','بدل سفر','ايفاد']],
 ['اجر',['راتب','معاش','مرتب']],
 ['اجازة مرضية',['سكليف','تقرير طبي','اجازه مرضيه']],
 ['فصل',['انهاء خدمات','انهاء الخدمة','تسريح']],
 ['نهاية الخدمة',['مكافأة نهاية الخدمة','EOS','مكافاه نهايه الخدمه']],
 ['تأخر',['تأخير','تاخر','تاخير']],
 ['غياب',['انقطاع','تغيب']],
 ['ولادة',['وضع','أمومة','امومه','حمل']],
 ['تذكرة',['إركاب','طيران','تذاكر']],
 ['نادي',['جيم','رياضة','لياقة']],
 ['تأمين الوالدين',['تأمين الأهل','تامين الوالدين','تامين الاهل']]];

const TABLES=[['A','مخالفات تتعلق بمواعيد العمل',16],['B','مخالفات تتعلق بتنظيم العمل',18],['C','مخالفات تتعلق بسلوك العامل',16]];
const BASIS=[
 ['leave.annual','طلب إجازة سنوية',80,'form'],
 ['leave.marriage','طلب إجازة زواج',82,'form'],
 ['leave.sick','طلب إجازة مرضية',88,'form'],
 ['leave.maternity','طلب إجازة وضع',105,'form'],
 ['leave.bereavement','طلب إجازة وفاة',82,'form'],
 ['overtime.request','طلب عمل إضافي',76,'form'],
 ['secondment.request','طلب انتداب',65,'form'],
 ['grievance.file','تقديم تظلم',126,'form'],
 ['discipline.penalty','توقيع جزاء تأديبي',112,'form'],
 ['payroll.deduction','استقطاع من الأجر',51,'form'],
 ['leave.unpaid.over_limit','رفض إجازة بلا أجر فوق الحد',91,'refusal'],
 ['deduction.over_cap','رفض استقطاع يتجاوز السقف الشهري',116,'refusal'],
 ['penalty.stale','رفض توقيع جزاء بعد مضي المدة',120,'refusal'],
 ['grievance.late','رفض تظلم بعد انقضاء المهلة',126,'refusal'],
 ['overtime.unapproved','رفض احتساب عمل إضافي غير معتمد',76,'refusal'],
 ['secondment.no_decision','رفض بدل انتداب بلا قرار انتداب',65,'refusal']];

const lines=[];
const w=s=>lines.push(s);
w(`-- مكتبة السياسات (ترحيل 110). النص مستخرج من لائحة تنظيم العمل المعتمدة رقم 351743 بتاريخ 24 أبريل 2025.
-- ملف PDF الموقّع لم يصل هذه الجلسة؛ كل مادة هنا موسومة «${NOTE}» حتى يعتمدها الأدمن بعد المطابقة.
-- الجداول الثلاثة للمخالفات والجزاءات (50 صفًا) لا تُنسخ هنا: مصدرها الوحيد جدول وحدة الجزاءات (ترحيل 097)،
-- وهذا الترحيل يربط كل صف بمادته فقط.
-- لا طباعة ولا تصدير PDF في هذه الوحدة: السجل إلكتروني ورابط المادة هو ما يُنسخ ويُشارك.

CREATE TABLE policy_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  reference_no TEXT,
  approved_on TEXT,
  effective_from TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','published','superseded')),
  source_note TEXT NOT NULL CHECK(length(trim(source_note))>=10),
  verification TEXT NOT NULL CHECK(verification IN ('extracted','verified')),
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX policy_documents_code ON policy_documents(code,tenant_id);
CREATE TRIGGER policy_documents_no_delete BEFORE DELETE ON policy_documents BEGIN SELECT RAISE(ABORT,'policy documents are retained'); END;

CREATE TABLE policy_articles (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES policy_documents(id),
  tenant_id TEXT REFERENCES tenants(id),
  chapter TEXT NOT NULL,
  chapter_order INTEGER NOT NULL,
  number INTEGER NOT NULL CHECK(number>0),
  title TEXT NOT NULL CHECK(length(trim(title))>=2),
  title_source TEXT NOT NULL CHECK(title_source IN ('extracted','proposed','approved')),
  body TEXT NOT NULL CHECK(length(trim(body))>=2),
  paragraphs TEXT NOT NULL CHECK(json_valid(paragraphs)),
  keywords TEXT NOT NULL CHECK(json_valid(keywords)),
  artifacts TEXT NOT NULL CHECK(json_valid(artifacts)),
  effective_from TEXT,
  status TEXT NOT NULL CHECK(status IN ('in_force','amended','repealed','replaced')),
  verification TEXT NOT NULL CHECK(verification IN ('extracted','verified')),
  revision INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id,number)
) STRICT;
CREATE INDEX policy_articles_number ON policy_articles(number,status);
CREATE INDEX policy_articles_chapter ON policy_articles(chapter_order,number);
CREATE TRIGGER policy_articles_no_delete BEFORE DELETE ON policy_articles BEGIN SELECT RAISE(ABORT,'articles are replaced by a new dated version, never deleted'); END;
-- كل تعديل يرفع الرقمين معًا: version لمنع الكتابة المتزامنة، revision لأن كل تعديل نسخة لها تاريخ سريان.
CREATE TRIGGER policy_articles_versioned BEFORE UPDATE ON policy_articles
WHEN NEW.version<>OLD.version+1 OR NEW.number<>OLD.number OR NEW.document_id<>OLD.document_id
BEGIN SELECT RAISE(ABORT,'an article edit increments version and keeps its number and document'); END;

-- النسخة السابقة تبقى كما كانت: المقارنة تحتاج نصًا لا يتغير خلفها.
CREATE TABLE policy_article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES policy_articles(id),
  tenant_id TEXT REFERENCES tenants(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  paragraphs TEXT NOT NULL CHECK(json_valid(paragraphs)),
  status TEXT NOT NULL,
  effective_from TEXT,
  note TEXT NOT NULL DEFAULT '',
  edited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(article_id,revision)
) STRICT;
CREATE TRIGGER policy_article_versions_fixed BEFORE UPDATE ON policy_article_versions BEGIN SELECT RAISE(ABORT,'a kept version is never rewritten'); END;
CREATE TRIGGER policy_article_versions_no_delete BEFORE DELETE ON policy_article_versions BEGIN SELECT RAISE(ABORT,'versions are retained'); END;

-- الإحالات: داخلية (رابط) أو خارجية (نظام العمل — تُعرض «مرجع خارجي» ولا تُفتح).
CREATE TABLE policy_article_links (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES policy_articles(id),
  kind TEXT NOT NULL CHECK(kind IN ('reference','amends','amended_by','replaces','replaced_by','external','related')),
  target_article_id TEXT REFERENCES policy_articles(id),
  target_number INTEGER,
  target_label TEXT NOT NULL DEFAULT '',
  phrase TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(kind='external' OR target_article_id IS NOT NULL)
) STRICT;
CREATE INDEX policy_article_links_article ON policy_article_links(article_id,kind);
CREATE INDEX policy_article_links_target ON policy_article_links(target_article_id);

-- قاموس المرادفات: ما يكتبه الموظف مقابل ما كتبته اللائحة. يحرره الأدمن، والصفوف بلا tenant_id بذرة المنصة.
CREATE TABLE policy_synonyms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  head TEXT NOT NULL CHECK(length(trim(head))>=2),
  term TEXT NOT NULL CHECK(length(trim(term))>=2),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,head,term)
) STRICT;

CREATE TABLE policy_favourites (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES policy_articles(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,article_id)
) STRICT;

-- التحليلات: أكثر ما يُبحث، وما لا يجد نصًا، وأكثر ما يُفتح. الاستعلام يُحفظ بلا ربطه بقرار عن صاحبه.
CREATE TABLE policy_searches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  query TEXT NOT NULL,
  normalized TEXT NOT NULL,
  results INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX policy_searches_term ON policy_searches(tenant_id,normalized);
CREATE TABLE policy_article_views (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  article_id TEXT NOT NULL REFERENCES policy_articles(id),
  user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX policy_article_views_article ON policy_article_views(article_id);

-- صف الجدول ← مادته. الصفوف نفسها تبقى في discipline_schedules (097): مصدر واحد للجداول الثلاثة.
CREATE TABLE policy_table_rows (
  row_code TEXT PRIMARY KEY,
  table_key TEXT NOT NULL,
  table_name TEXT NOT NULL,
  article_number INTEGER NOT NULL
) STRICT;

-- «قرأت واطلعت»: إقرار الموظف على اللائحة وعلى كل تحديث. مربوط بنسخة المادة أو الوثيقة وببصمة نصها، فنسخة
-- جديدة تعني إقرارًا جديدًا والإقرار القديم يبقى مرتبطًا بنسخته — القاعدة نفسها المكتوبة في وحدة إقرار السياسات.
-- وحدة إقرار السياسات (ترحيل 075) تربط جولاتها بجدول hr_policies، فلا تستقبل وثيقة مكتبة؛ المكتبة تعرض جولاتها
-- المعلّقة للموظف في مكان واحد وتسجل إقرار القراءة هنا. توحيد المحرّكين قرار مفتوح في وثيقة التسليم.
CREATE TABLE policy_reading_acknowledgements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  document_id TEXT NOT NULL REFERENCES policy_documents(id),
  article_id TEXT REFERENCES policy_articles(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  content_digest TEXT NOT NULL CHECK(length(content_digest)=64),
  acknowledged_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX policy_reading_ack_once ON policy_reading_acknowledgements(user_id,document_id,COALESCE(article_id,''),revision);
CREATE TRIGGER policy_reading_ack_fixed BEFORE UPDATE ON policy_reading_acknowledgements BEGIN SELECT RAISE(ABORT,'an acknowledgement records what was read and when; it is never rewritten'); END;
CREATE TRIGGER policy_reading_ack_no_delete BEFORE DELETE ON policy_reading_acknowledgements BEGIN SELECT RAISE(ABORT,'acknowledgements are retained'); END;

-- «الأساس النظامي» تحت كل نموذج، والمادة التي منعت كل رفض آلي. مفتاح واحد تقرأه الوحدات ولا تكرر الرقم في كودها.
CREATE TABLE policy_request_basis (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  article_number INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('form','refusal'))
) STRICT;
`);

w(`\n-- ── الوثائق ──────────────────────────────────────────────────────────────────`);
w(`INSERT INTO policy_documents(id,tenant_id,code,title,reference_no,approved_on,effective_from,status,source_note,verification,version,created_at) VALUES
(${q(DOC)},NULL,'work_regulation','لائحة تنظيم العمل','351743','2025-04-24','2025-04-25','published',${q(NOTE+' — استُخرج النص من PDF بترتيب كلمات معكوس وحروف مفصولة في مواضع؛ أُصلح آليًا ولم تصل نسخة PDF الموقّعة إلى جلسة البناء.')},'extracted',1,${q(now)}),
(${q(CIRCULAR)},NULL,'secondment_circular','تعميم الانتداب المعدِّل للمادتين 41 و65','—',NULL,NULL,'draft',${q(NOTE+' — نص التعميم لم يصل هذه الجلسة: الوثيقة مسجلة بحقولها ليربط بها الأدمن النص عند رفعه، والمادتان 41 و65 موسومتان «معدّلة» بناءً على ما أفاد به المالك.')},'extracted',1,${q(now)}),
(${q(BENEFITS)},NULL,'benefits_policy','سياسة المزايا الجديدة','—',NULL,NULL,'draft',${q(NOTE+' — نص سياسة المزايا لم يصل هذه الجلسة: الوثيقة مسجلة ليربط بها الأدمن النص عند رفعه.')},'extracted',1,${q(now)});`);

w(`\n-- ── المواد 1–127 ─────────────────────────────────────────────────────────────`);
for(const a of articles){
  const id=uuid('policy-article',a.number);
  const art=[...a.artifacts];
  w(`INSERT INTO policy_articles(id,document_id,tenant_id,chapter,chapter_order,number,title,title_source,body,paragraphs,keywords,artifacts,effective_from,status,verification,revision,version,updated_at,created_at) VALUES(${q(id)},${q(DOC)},NULL,${q(a.chapter)},${a.chapter_order},${a.number},${q(a.title)},${q(a.title_source)},${q(a.body)},${q(JSON.stringify(a.paragraphs))},${q(JSON.stringify(a.keywords))},${q(JSON.stringify(art))},'2025-04-25',${q(status.get(a.number))},'extracted',1,1,${q(now)},${q(now)});`);
}
w(`INSERT INTO policy_article_versions(id,article_id,tenant_id,revision,title,body,paragraphs,status,effective_from,note,edited_by,created_at)
SELECT 'policy-version-'||a.number, a.id, NULL, 1, a.title, a.body, a.paragraphs, a.status, a.effective_from, 'النسخة الأولى كما خرجت من المستخرج، قبل أي تعديل بشري.', NULL, ${q(now)} FROM policy_articles a;`);

w(`\n-- ── الإحالات ─────────────────────────────────────────────────────────────────`);
let linkId=0;
const target=n=>uuid('policy-article',n);
for(const a of articles){
  const from=uuid('policy-article',a.number);
  for(const r of a.references){
    linkId++;
    if(r.external)w(`INSERT INTO policy_article_links(id,article_id,kind,target_article_id,target_number,target_label,phrase,created_at) VALUES(${q('policy-link-'+linkId)},${q(from)},'external',NULL,${r.number??'NULL'},${q(r.number?`المادة ${r.number} من نظام العمل`:'نظام العمل')},${q(r.phrase)},${q(now)});`);
    else w(`INSERT INTO policy_article_links(id,article_id,kind,target_article_id,target_number,target_label,phrase,created_at) VALUES(${q('policy-link-'+linkId)},${q(from)},'reference',${q(target(r.number))},${r.number},${q('المادة '+r.number)},${q(r.phrase)},${q(now)});`);
  }
}
for(const [newer,olds] of REPLACEMENTS)for(const old of olds){
  linkId++;w(`INSERT INTO policy_article_links(id,article_id,kind,target_article_id,target_number,target_label,phrase,created_at) VALUES(${q('policy-link-'+linkId)},${q(target(newer))},'replaces',${q(target(old))},${old},${q('تحل محل المادة '+old)},'',${q(now)});`);
  linkId++;w(`INSERT INTO policy_article_links(id,article_id,kind,target_article_id,target_number,target_label,phrase,created_at) VALUES(${q('policy-link-'+linkId)},${q(target(old))},'replaced_by',${q(target(newer))},${newer},${q('استُبدلت بالمادة '+newer)},'',${q(now)});`);
}
for(const n of AMENDED){
  linkId++;w(`INSERT INTO policy_article_links(id,article_id,kind,target_article_id,target_number,target_label,phrase,created_at) VALUES(${q('policy-link-'+linkId)},${q(target(n))},'amended_by',${q(target(n))},${n},'عُدّلت بتعميم الانتداب — نص التعميم لم يصل بعد','',${q(now)});`);
}

w(`\n-- ── المرادفات (بذرة المالك) ───────────────────────────────────────────────────`);
let synId=0;
for(const [head,terms] of SEED_SYNONYMS)for(const term of terms){
  synId++;w(`INSERT INTO policy_synonyms(id,tenant_id,head,term,active,created_by,created_at) VALUES(${q('policy-synonym-'+String(synId).padStart(3,'0'))},NULL,${q(head)},${q(term)},1,NULL,${q(now)});`);
}

w(`\n-- ── ربط صفوف الجداول الثلاثة بمادتها (م112 هي المادة التي تُلحق الجداول باللائحة) ──`);
for(const [key,name,count] of TABLES)
  for(let i=1;i<=count;i++)w(`INSERT INTO policy_table_rows(row_code,table_key,table_name,article_number) VALUES(${q(key+String(i).padStart(2,'0'))},${q(key)},${q(name)},112);`);

w(`\n-- ── الأساس النظامي للنماذج والرفض الآلي ──────────────────────────────────────`);
for(const [key,label,number,kind] of BASIS)
  w(`INSERT INTO policy_request_basis(key,label,article_number,kind) VALUES(${q(key)},${q(label)},${number},${q(kind)});`);

writeFileSync(OUT,lines.join('\n')+'\n');
console.log('articles',articles.length,'links',linkId,'synonyms',synId);
console.log('references total',articles.reduce((s,a)=>s+a.references.length,0));
console.log('internal refs',articles.reduce((s,a)=>s+a.references.filter(r=>!r.external).length,0));
console.log('external refs',articles.reduce((s,a)=>s+a.references.filter(r=>r.external).length,0));
console.log('sample refs م26:',JSON.stringify(articles.find(a=>a.number===26).references));
console.log('sample refs م126:',JSON.stringify(articles.find(a=>a.number===126).references));
console.log('keywords م82:',articles.find(a=>a.number===82).keywords.join(' '));
console.log('keywords م65:',articles.find(a=>a.number===65).keywords.join(' '));
console.log('م71:',articles.find(a=>a.number===71).body);
console.log('artifacts summary:',JSON.stringify(articles.reduce((m,a)=>{for(const x of a.artifacts)m[x]=(m[x]??0)+1;return m;},{})));
console.log('clean:',articles.filter(a=>!a.artifacts.length).length);
