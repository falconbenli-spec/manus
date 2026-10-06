#!/usr/bin/env python3
"""T0.4: build docs/org/tree-test/index.html, a static local tree-test kit.

The tree is generated from catalog-mapping.csv (unified names, placement, owner)
and the inventory (departments, categories). The page makes no network request,
stores nothing and sends nothing: click counts and times live in page memory
only and are copied by the moderator onto the printed score sheet.

Usage: python3 docs/org/scripts/build_tree_test.py [--check]
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORG = os.path.dirname(HERE)
INV = json.load(open(os.path.join(ORG, "data", "inventory_data.json"), encoding="utf-8"))
ROWS = list(csv.DictReader(l for l in open(os.path.join(ORG, "catalog-mapping.csv"), encoding="utf-8") if not l.startswith("#")))
ADM_OWNER = "الشؤون الإدارية والمرافق (موقوفة)"


def uname(r):
    n = r["الاسم الموحد المقترح"]
    return r["الاسم الحالي"] if n.startswith("—") else n


def leaf(r):
    return {"t": uname(r), "id": r["الرمز"]}


def build_tree():
    depts = [d for d in INV["departments"] if d["services"]]
    by_owner = {}
    for r in ROWS:
        by_owner.setdefault(r["الإدارة المالكة المقترحة"], []).append(r)
    front = [r for r in ROWS if r["الموضع"].startswith("الخدمات")]
    team = [r for r in ROWS if r["الموضع"] == "فريقي"]
    sectors = {}
    for d in depts:
        sectors.setdefault(d["sector"], []).append(d["name"])
    by_dept_lens = []
    for sector, names in sectors.items():
        kids = []
        for n in names:
            svc = [leaf(r) for r in front if r["الإدارة المالكة المقترحة"] == n]
            if svc:
                kids.append({"t": n, "c": svc})
        if kids:
            by_dept_lens.append({"t": sector, "c": kids})
    adm = [leaf(r) for r in front if r["الإدارة المالكة المقترحة"] == ADM_OWNER]
    by_dept_lens.append({"t": "الشؤون الإدارية والمرافق", "c": adm})
    cats = []
    for c in INV["catalog_structure"]["categories"]:
        svc = [leaf(r) for r in front if r["فئة الحاجة المقترحة"] == c["name_ar"]]
        if svc:
            cats.append({"t": c["name_ar"], "c": svc})
    dept_pages = []
    for d in depts:
        rows = by_owner.get(d["name"], [])
        dept_pages.append({"t": d["name"], "c": [
            {"t": "نظرة عامة"}, {"t": "الطلبات الواردة"},
            {"t": "الخدمات", "c": [leaf(r) for r in rows]},
            {"t": "الفريق"}, {"t": "التقارير"}]})
    dept_pages.append({"t": "الشؤون الإدارية والمرافق", "c": [{"t": "الخدمات", "c": [leaf(r) for r in by_owner.get(ADM_OWNER, [])]}]})
    profile = {"t": "ملفي", "c": [
        {"t": "بياناتي"}, {"t": "عقدي وراتبي"}, {"t": "قسائمي", "id": "NAV-PAYSLIPS"}, {"t": "مزاياي"}, {"t": "خطاباتي"}, {"t": "مخالفاتي"},
        {"t": "وقتي", "c": [{"t": "حضوري"}, {"t": "إجازاتي"}, {"t": "ساعاتي"}, {"t": "الانتداب"}]},
        {"t": "مشاركتي", "c": [{"t": "النبض"}, {"t": "التقدير"}, {"t": "اللقاءات الفردية"}, {"t": "ملاحظات الزملاء"}]},
        {"t": "إعدادات الحساب"}]}
    return [
        {"t": "مساحتي", "c": [{"t": "الرئيسية"}, {"t": "بانتظار إجرائي"}, {"t": "طلباتي", "id": "NAV-MYREQ"}, profile, {"t": "الإشعارات"}]},
        {"t": "فريقي", "c": [{"t": "أعضاء الفريق"}, {"t": "طلبات الفريق"},
                             {"t": "الطلب نيابة عن موظف", "c": [leaf(r) for r in team]},
                             {"t": "اعتماد الساعات"}, {"t": "التفويض المؤقت"}]},
        {"t": "الخدمات", "c": [
            {"t": "حسب الإدارة", "c": by_dept_lens},
            {"t": "حسب الحاجة", "c": cats}]},
        {"t": "الإدارات", "c": dept_pages},
        {"t": "المنظمة", "c": [{"t": "الدليل"}, {"t": "الهيكل التنظيمي"}, {"t": "السياسات"}, {"t": "الإعلانات"}]},
    ]


TASKS = [
    ("تريد إجازة الأسبوع القادم.", ["HR-LEAVE"]),
    ("جهازك المحمول معطل ولا يعمل.", ["IT-SUPPORT"]),
    ("تحتاج خطاب تعريف لجهة خارجية.", ["HR-LETTER"]),
    ("موظف جديد في فريقك يبدأ الأحد ويحتاج حسابًا على الأنظمة.", ["IT-NEW-ACCOUNT"]),
    ("تريد سلفة على راتبك.", ["HR-SALARY-ADVANCE"]),
    ("قدّمت طلبًا الأسبوع الماضي وتريد أن تعرف أين وصل.", ["NAV-MYREQ"]),
    ("تحتاج شراء أداة لعملك.", ["PRC-PURCHASE-REQUEST", "PRC-EMERGENCY"]),
    ("تريد تصميمًا لتعميم داخلي في إدارتك.", ["CRT-DESIGN"]),
    ("تريد رؤية قسيمة راتب الشهر الماضي.", ["NAV-PAYSLIPS"]),
    ("تحتاج مقعد عمل في المكتب.", ["ADM-WORKSPACE"]),
]

PAGE = """<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>اختبار الشجرة</title>
<style>
:root{--bg:#f7f6f3;--panel:#fff;--ink:#1d1d1b;--muted:#5d5b55;--line:#dedbd3;--accent:#1f5f8b;--ok:#1d6b3a;--bad:#9b2c1f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--panel:#1f1f1d;--ink:#eceae4;--muted:#a9a69e;--line:#3a3935;--accent:#7fb6dd;--ok:#7fd19b;--bad:#f09a8c}}
:root[data-theme="dark"]{--bg:#161615;--panel:#1f1f1d;--ink:#eceae4;--muted:#a9a69e;--line:#3a3935;--accent:#7fb6dd;--ok:#7fd19b;--bad:#f09a8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}h1{font-size:1.4rem;margin:.5rem 0}h2{font-size:1.1rem;margin:1.5rem 0 .5rem}
.note{color:var(--muted);font-size:.9rem}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin:12px 0}
select{font:inherit;min-height:44px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)}
.node[aria-pressed="true"]{background:var(--bg);outline:2px solid var(--accent)}
.answer{display:none}.show-answers .answer{display:table-cell}
button{font:inherit;min-height:44px;padding:8px 14px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);color:var(--bg);border-color:var(--accent)}button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
ul.tree{list-style:none;padding-inline-start:18px;margin:0}ul.tree>li{margin:2px 0}ul.root{padding-inline-start:0}
.node{display:block;width:100%;text-align:start;border:0;background:transparent;border-radius:4px;min-height:44px}.node:hover{background:var(--bg)}
.node[aria-expanded="true"]{font-weight:600}.leaf{color:var(--accent)}
#task{font-size:1.15rem;font-weight:600}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{border:1px solid var(--line);padding:6px;text-align:start;vertical-align:top}
.res-ok{color:var(--ok)}.res-bad{color:var(--bad)}
@media print{.no-print{display:none}body{background:#fff;color:#000}}
</style>
</head>
<body>
<main>
<header>
<h1>اختبار الشجرة: التنقل المقترح لمنصة 3,6T</h1>
<p class="note">عدة ت0.4. صفحة محلية ثابتة: لا طلب شبكي، ولا تخزين، ولا إرسال. ما تحسبه الصفحة (النقرات والوقت) يبقى في ذاكرتها ويُمحى بإغلاقها، ويكتبه المدير في ورقة التسجيل. الأسماء موحدة مقترحة من جدول التحويل، وليست معتمدة.</p>
</header>
<section class="panel no-print" aria-labelledby="run-h">
<h2 id="run-h">التشغيل</h2>
<p class="note">يديره تركي مع 5 إلى 8 موظفين من إدارات مختلفة. يسجّل عمود «العدسة الأولى» أول اختيار تحت المستوى الأعلى (مثل «الخدمات › حسب الإدارة»)، وبه يُحسم الافتراضي بين العدستين. لكل مهمة: اقرأها للمشارك، واضغط «ابدأ»، ويتنقل المشارك في الشجرة حتى يختار مكانًا ويضغط «هنا أجدها». عتبة النجاح يكتبها تركي قبل التشغيل (ق5).</p>
<div class="row"><label for="pick">المهمة:</label><select id="pick"></select><button class="primary" id="start">ابدأ</button><button id="reset">امسح نتائج الجلسة</button></div>
<p id="task" aria-live="polite"></p>
<p class="note" id="status" aria-live="polite"></p>
<nav aria-label="الشجرة المقترحة"><ul class="tree root" id="tree"></ul></nav>
<div class="row"><button class="primary" id="found" disabled>هنا أجدها</button><button id="giveup" disabled>لا أجدها</button></div>
</section>
<section class="panel" aria-labelledby="sheet-h">
<h2 id="sheet-h">ورقة التسجيل</h2>
<p class="note no-print">عمود «الجواب الصحيح» مخفي حتى يضغط المدير «اعرض الأجوبة» بعد انتهاء المشارك من كل المهام.</p>
<p class="no-print"><button id="reveal" aria-pressed="false">اعرض الأجوبة</button></p>
<p class="note">المشارك: رمز بلا اسم (م1، م2، …). الإدارة: اسمها فقط. «مباشر» = بلا رجوع إلى الخلف.</p>
<p>رمز المشارك: ________ &nbsp; الإدارة: ______________ &nbsp; التاريخ: ________</p>
<table><thead><tr><th>#</th><th>المهمة</th><th class="answer">الجواب الصحيح</th><th>نجح؟</th><th>مباشر؟</th><th>النقرات</th><th>الوقت (ث)</th><th>أول نقرة</th><th>العدسة الأولى</th></tr></thead><tbody id="sheet"></tbody></table>

</section>
</main>
<script>
const TREE = __TREE__;
const TASKS = __TASKS__;
const pick = document.getElementById('pick'), treeEl = document.getElementById('tree');
const results = {};
let cur = null, clicks = 0, t0 = 0, first = '', lens = '', backtracked = false, selected = null, lastPath = [];
function pathOf(li){const p=[];while(li&&li.dataset){if(li.dataset.t)p.unshift(li.dataset.t);li=li.parentElement.closest('li');}return p;}
function render(nodes, ul){for(const n of nodes){const li=document.createElement('li');li.dataset.t=n.t;if(n.id)li.dataset.id=n.id;
 const b=document.createElement('button');b.className='node'+(n.c?'':' leaf');b.textContent=(n.c?'◂ ':'')+n.t;b.type='button';
 if(n.c){b.setAttribute('aria-expanded','false');const sub=document.createElement('ul');sub.className='tree';sub.hidden=true;li.append(b,sub);
  b.onclick=()=>{if(!cur)return;count(li);const open=b.getAttribute('aria-expanded')==='true';if(!sub.childElementCount)render(n.c,sub);
   b.setAttribute('aria-expanded',String(!open));sub.hidden=open;b.textContent=(open?'◂ ':'▾ ')+n.t;if(open){backtracked=true;if(selected&&sub.contains(selected))select(null);}};}
 else{b.setAttribute('aria-pressed','false');li.append(b);b.onclick=()=>{if(!cur)return;count(li);select(li);};}
 ul.append(li);}}
function select(li){if(selected)selected.firstChild.setAttribute('aria-pressed','false');selected=li;document.getElementById('found').disabled=!li;
 if(li){li.firstChild.setAttribute('aria-pressed','true');document.getElementById('status').textContent='المختار: '+pathOf(li).join(' › ');}else document.getElementById('status').textContent='جارٍ…';}
function count(li){clicks++;const p=pathOf(li);if(!first)first=p[0];if(!lens&&p.length>1)lens=p.slice(0,2).join(' › ');if(lastPath.length&&p.length<=lastPath.length&&p.join()!==lastPath.slice(0,p.length).join())backtracked=true;lastPath=p;}
function reset(){treeEl.innerHTML='';render(TREE,treeEl);}
TASKS.forEach((t,i)=>{const o=document.createElement('option');o.value=i;o.textContent=(i+1)+'. '+t.q;pick.append(o);});
document.getElementById('start').onclick=()=>{cur=TASKS[pick.value];clicks=0;first='';lens='';backtracked=false;selected=null;lastPath=[];t0=performance.now();reset();
 document.getElementById('task').textContent=cur.q;document.getElementById('status').textContent='جارٍ…';
 document.getElementById('found').disabled=true;document.getElementById('giveup').disabled=false;};
function finish(gaveUp){if(!cur)return;const i=TASKS.indexOf(cur);const ok=!gaveUp&&selected&&cur.a.includes(selected.dataset.id);
 results[i]={ok,direct:ok&&!backtracked,clicks,sec:Math.round((performance.now()-t0)/1000),first,lens};cur=null;
 document.getElementById('found').disabled=true;document.getElementById('giveup').disabled=true;
 document.getElementById('status').textContent=ok?'نجحت المهمة.':'لم تنجح.';drawSheet();}
document.getElementById('found').onclick=()=>finish(false);document.getElementById('giveup').onclick=()=>finish(true);
document.getElementById('reset').onclick=()=>{for(const k in results)delete results[k];drawSheet();};
document.getElementById('reveal').onclick=e=>{const on=document.getElementById('sheet-h').parentElement.classList.toggle('show-answers');e.target.setAttribute('aria-pressed',String(on));e.target.textContent=on?'أخفِ الأجوبة':'اعرض الأجوبة';};
function drawSheet(){const tb=document.getElementById('sheet');tb.innerHTML='';TASKS.forEach((t,i)=>{const r=results[i];const tr=document.createElement('tr');
 const cells=[i+1,t.q,t.ans,r?(r.ok?'نعم':'لا'):'',r?(r.direct?'نعم':'لا'):'',r?r.clicks:'',r?r.sec:'',r?r.first:'',r?r.lens:''];
 cells.forEach((c,j)=>{const td=document.createElement('td');td.textContent=c;if(j===2)td.className='answer';if(j===3&&r)td.className=r.ok?'res-ok':'res-bad';tr.append(td);});tb.append(tr);});}
reset();drawSheet();
</script>
</body>
</html>
"""


def main():
    tree = build_tree()
    names = {r["الرمز"]: uname(r) for r in ROWS}
    names["NAV-PAYSLIPS"] = "مساحتي › ملفي › قسائمي"
    names["NAV-MYREQ"] = "مساحتي › طلباتي"
    tasks = [{"q": q, "a": a, "ans": " أو ".join(f"{names.get(x, x)} ({x})" if not x.startswith("NAV") else names[x] for x in a)} for q, a in TASKS]
    html = PAGE.replace("__TREE__", json.dumps(tree, ensure_ascii=False)).replace("__TASKS__", json.dumps(tasks, ensure_ascii=False))
    path = os.path.join(ORG, "tree-test", "index.html")
    if "--check" in sys.argv:
        ok = open(path, encoding="utf-8").read() == html
        print("up to date" if ok else "STALE"); sys.exit(0 if ok else 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(html)
    print("tree roots", len(tree), "tasks", len(tasks), "bytes", len(html.encode()))


if __name__ == "__main__":
    main()
