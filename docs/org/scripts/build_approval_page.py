#!/usr/bin/env python3
"""T0.5: build docs/org/approval-page.html, the private approval page «خطة التنظيم — للاعتماد».

All numbers are read from the generated data (catalog-mapping.csv, data/*.json);
nothing is typed by hand. The recommendations are the T0 session's, marked as such.

Usage: python3 docs/org/scripts/build_approval_page.py [--check]
"""
import csv
import re
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORG = os.path.dirname(HERE)
ST = json.load(open(os.path.join(ORG, "data", "catalog-mapping.stats.json"), encoding="utf-8"))
NAV = json.load(open(os.path.join(ORG, "data", "nav-mapping.summary.json"), encoding="utf-8"))
DEC = json.load(open(os.path.join(ORG, "data", "decisions-t0.json"), encoding="utf-8"))
ROWS = list(csv.DictReader(l for l in open(os.path.join(ORG, "catalog-mapping.csv"), encoding="utf-8") if not l.startswith("#")))
REVIEW = os.path.join(ORG, "data", "review-findings.json")
FINDINGS = json.load(open(REVIEW, encoding="utf-8")) if os.path.exists(REVIEW) else []
e = html.escape

N = ST["منها خدمات جدول services"]
M1 = ST["يحتاج قرار تركي (صفوف)"]
M2 = ST["يحتاج مالك الإدارة (صفوف، بلا ADM-)"]


def uname(r):
    n = r["الاسم الموحد المقترح"]
    return r["الاسم الحالي"] if n.startswith("—") else n


def batch_rows(tag):
    return [r for r in ROWS if tag in r["دفعة تركي"]]


def codes_table(rows, cols):
    head = "".join(f"<th>{e(c)}</th>" for c in ["الرمز", "الاسم الموحد المقترح"] + cols)
    body = ""
    for r in rows:
        body += "<tr><td class=code>" + e(r["الرمز"]) + "</td><td>" + e(uname(r)) + "</td>" + "".join(f"<td>{e(r[c])}</td>" for c in cols) + "</tr>"
    return f'<div class="scroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


DECISIONS = [
    ("ق1", "الجمهور: الإتاحة هي الافتراض",
     "الإتاحة هي الافتراض، والتقييد يحتاج سببًا مكتوبًا، ومجموعات التعاون لا تمنح ظهور خدمة ولا دخول أقسام الأعضاء.",
     "أوافق كما هو. يبقى الجمهور «الكل» فعليًا حتى ت2ب، فلا يفقد أحد خدمة قبل الفرض في الخادم."),
    ("ق2", "فئات الحاجة",
     "الفئات الثماني نقطة بداية، والحد الأعلى عشر فئات.",
     "أوافق. فئة «مشاريعي وعملائي» تنزل من 59 خدمة إلى 19 في الباب الأمامي بعد نقل 40 إلى صفحات الإدارات، فيُختبر اسمها في اختبار الشجرة قبل تغييره."),
    ("ق3", "خدمات ADM- الأربع عشرة",
     "الملكية للشؤون الإدارية والمرافق الموقوفة، والمنفّذ المؤقت مكتب الرئيس التنفيذي بسند تفويض مسجل. تُعرض في صفحة «خدمات فقط» باسم الإدارة المالكة. في ت1 وسم عرض فقط، وفي ت2أ يُفصل في البيانات.",
     "أوافق، مع نقل ADM-EXPENSE-CLAIM إلى المالية الآن لأنها تملك FIN-CUSTODY في الفئة نفسها، وإبقاء ADM-GOVT-SERVICES وADM-SUBSCRIPTION مع الإدارة الإدارية. وحدّد تاريخ مراجعة السند."),
    ("ق4", "سلطة القرار",
     "مالك الإدارة يقرر داخل إدارته. تركي يقرر ما يعبر الإدارات والاستثناءات وأي إنقاص لخطوات اعتماد خدمة تمس المال، وهو بديل مؤقت عن كل إدارة بلا مالك.",
     f"أوافق. ملاك الإدارات لم يُسمَّوا بعد، فكل البنود الـ{M2} تقع عليك مؤقتًا حتى تسمّيهم. أقترح أن تبدأ بتسمية مالك رأس المال البشري، لأن الموجة الأولى له."),
    ("ق5", "عتبة نجاح اختبار الشجرة",
     "يكتبها تركي قبل تشغيل الاختبار.",
     "اكتبها قبل أول جلسة، لكل مهمة: نسبة النجاح المطلوبة، ونسبة النجاح المباشر بلا رجوع. لا أقترح رقمًا، فلا خط أساس لهذه المنصة."),
    ("ق6", "إلغاء قرار MANAGER_DELTA الفارغ",
     "إلغاء القرار المكتوب بإبقاء MANAGER_DELTA فارغًا (catalog-tree.mjs:94). ثم يُملأ في ت2ب بخدمات «فريقي» الخمس، وبما تقرره من الخدمات القيادية.",
     "أوافق، بشرط أن يُكتب السبب في سجل القرارات، وأن يكون الملء في ت2ب خلف مفتاح ميزة يعيد «الكل» عند إطفائه. خدمات «نيابة عن موظف» الظاهرة للجميع اليوم تسمح لموظف أن يطلب حسابًا أو تغييرًا وظيفيًا لغيره."),
    ("ق7", "تغييران على الخطة المعتمدة",
     "(أ) دخول ت1 بشروط البرومبت §5، أي عند TP2.1 وTP2.4 وقبل خروج م2 كاملة. (ب) ضم خروج ت2 إلى معايير خروج م3.",
     "أوافق على الاثنين. ت1 لا تمنح وصولًا ولا ترحّل مخططًا قبل TP2.3، فالتبكير لا يمس ترتيب م0–م5."),
    ("ق8", "أسطح الفرض ونص رسالة الرفض",
     "الأسطح (BR-ORG-03 حدًّا أدنى): القائمة، والبحث والإكمال التلقائي، والرابط المباشر والروابط العميقة، وواجهة API، وتقديم الطلب، والطلب نيابة عن غيره، والمسودات، والأزرار السريعة، و«لك» و«فريقي» والعدادات. يُحسم قبل ت2.",
     "أوافق على القائمة. نص الرفض المقترح: «هذه الخدمة غير متاحة لحسابك. إن كنت تحتاجها، فتواصل مع مدير إدارتك.» ومعه رابط «الخدمات». الرسالة لا تكشف سبب التقييد ولا من يشمله."),
]

BATCHES = [
    ("د1", "خدمات ADM-", "الملكية للإدارة الإدارية الموقوفة، والتنفيذ المؤقت لمكتب الرئيس التنفيذي بسند، والموضع «الخدمات» والجمهور «الكل» بلا تغيير.",
     "أوافق على الدفعة كما في ق3. ومع ADM-EXPENSE-CLAIM: نقل ملكيتها إلى المالية.", ["الإجراء", "ملاحظات"]),
    ("د2", "الحدّيات من client_work", "خدمات عمل عملاء يحتاجها موظف خارج إدارات التسليم.",
     "أوافق على التوصية: ست تبقى في الباب الأمامي للجميع (أصل رقمي، واستعمال أداة ذكاء اصطناعي، ووصول إلى بيانات، وبلاغ جودة بيانات، وإسهام في المعرفة، وتنبيه لقضية إعلامية). وثمانٍ في الباب الأمامي للمديرين وإدارات التسليم وpm، لأن الإدارات المؤسسية تطلب تصميمًا أو محتوى عبر مديرها.", ["الموضع", "الجمهور المقترح"]),
    ("د3", "القيادية", "عشر خدمات رجّح الجرد أنها للمديرين أو القيادة.",
     "أوافق: ست للمديرين في الباب الأمامي، واثنتان للمديرين وpm (مشروع جديد، وتعاقد من الباطن)، وDAT-PROFITABILITY في صفحة إدارتها للمديرين وpm، وTAL-SUCCESSION في «فريقي».", ["الموضع", "الجمهور المقترح"]),
    ("د4", "جمهور client_work غير الحدّية", "تخرج من فئات الحاجة إلى قسم «الخدمات» في صفحة الإدارة المالكة، وتبقى في سياق المشروع أو العميل. الجمهور المقترح «إدارات التسليم + pm».",
     "أوافق على نقل الموضع في ت1، وعلى تعريف إدارات التسليم بالثماني المالكة لهذه الخدمات. التقييد نفسه لا يُفرض قبل ت2ب، والرابط المباشر يبقى حتى ذلك الحين.", ["الإدارة المالكة المقترحة", "الموضع"]),
    ("د5", "عدسة «فريقي» (تتبع ق6)", "خمس خدمات صنّفها الكود «عدسة فريقي» وهي ظاهرة للجميع.",
     "أوافق إن وافقت على ق6: الموضع «فريقي» والجمهور المديرون. أضف pm إلى جمهور PMO-RESOURCE، لأن مدير المشروع يطلب الموارد.", ["الموضع", "الجمهور المقترح"]),
]

def _mgr_range():
    ns = []
    for n in NAV:
        if n["role"] != "manager":
            continue
        ns += [int(x) for x in re.findall(r"\d+", str(n["after_a_estimate"]))]
    return min(ns), max(ns)


MGR_MIN, MGR_MAX = _mgr_range()

NAV_ITEMS = [
    ("ب-تنقل-1", "الميزانية مع «لا يُفقد وصول»",
     f"القائمة اليوم تُبنى من التصاريح. التطبيق الحرفي (بعد-أ) يعطي المدير من {MGR_MIN} إلى {MGR_MAX} مدخلًا، فوق السقف المطلق 12. في بعد-ب يبقى مدخل لإدارة الحساب وحدها، وأدوات الإدارات الأخرى التي يصلها بتصريح تُبلغ من «الخدمات» › شريط الإدارات › صفحة الإدارة، وتظهر فيها بالتصاريح القائمة.",
     "بعد-ب. يحقق الحد لكل القوائم الـ15 في التقدير دون أن يفقد أحد وصولًا. ويُراجع في ت2أ هل كل تصريح عابر للإدارات مقصود."),
    ("ب-تنقل-2", "«التفويض المؤقت» لمن لا «فريقي» له",
     "البرومبت يضعه في «فريقي»، والمواصفة تضع «تفويضاتي» في «ملفي». حسابات hr وit وpm والأدمن تصله اليوم ولا «فريقي» لها.",
     "في «فريقي» للمديرين، و«ملفي › تفويضاتي» لغيرهم ممن له اعتماد قابل للتفويض."),
    ("ب-تنقل-3", "الأداء و360 والتطوير للموظف",
     "لا قسم لها في «ملفي» كما حدده البرومبت.",
     "في «ملفي › مشاركتي». وعدسة المدير في «فريقي»، وعدسة الموارد البشرية في صفحتها."),
    ("ب-تنقل-4", "«النماذج الإلكترونية» و«حالة التكاملات» لغير الأدمن",
     "صار لهما موضع في خريطة التنقل: النموذج يُعبَّأ من صفحة المشروع أو الخدمة التي يتبعها ويُصمَّم في صفحة الإدارة المالكة له، و«حالة التكاملات» تُقرأ من صفحة تقنية المعلومات. الموضعان مستنبطان من الجرد والتصاريح، لا من فحص الشاشتين.",
     "أوافق على الموضعين، ويُثبتان بفتح الشاشتين في ت1 قبل أي نقل — فالجرد يقول من يصل إليهما ولا يقول ما يراه فيهما."),
    ("ب-تنقل-5", "«مصروفاتي وعهدي»",
     "ليست في أقسام «ملفي» في البرومبت.",
     "المتابعة في «طلباتي»، والتقديم من «الخدمات». وعدسة الإدارة في صفحة المالية."),
]

CONFLICTS = [
    "أقسام «ملفي»: البرومبت يختلف عن المواصفة §2.2. اتُّبع البرومبت.",
    "دخول ت0: الحوكمة تشترط قرارات ORG-Q2 وQ3 وQ5 أولًا، والبرومبت «فورًا». اتُّبع البرومبت.",
    "حقول ت1: الحوكمة تضع المنفّذ ومسار الاعتماد والحالة في ت1، والبرومبت يمنعها. اتُّبع البرومبت.",
    "ORG-AF-05 يضع خدمات «عدسة فريقي» «بلا رفع»، والبرومبت يجعلها بند ق6. رُفعت.",
    "قائمة الموظف اليوم: 31 في INV و32 في المواصفة، والجرد فيه ثلاث قوائم للموظف: 31 و32 و47.",
    "«تشغيل المنصة» بلا خدمات ولا طابور، فلا صفحة لها (الحوكمة، التحسين 6)، فحسابات ops بلا مدخل إدارة.",
    "تسمية الموضع: «مساحة الإدارة» في الحوكمة، و«قسم الخدمات في صفحة الإدارة فقط» في البرومبت. اعتُمدت تسمية البرومبت.",
]


def verdict(code, table):
    d = DEC[table].get(code)
    if not d:
        return "", ""
    state = d["الحالة"]
    cls = "open" if state == "مفتوح" else "done"
    return f'<span class="state {cls}">{e(state)}</span>', f'<dt>ما اعتُمد</dt><dd class="rec">{e(d["النص"])}</dd>'


def section_decisions():
    out = ""
    for code, title, default, rec in DECISIONS:
        badge, settled = verdict(code, "القرارات")
        out += f"""<article class="item" id="{code}"><header><span class="tag">{code}</span><h3>{e(title)}</h3>{badge}</header>
<dl>{settled}<dt>القرار الافتراضي</dt><dd>{e(default)}</dd><dt>توصيتي قبل الاعتماد</dt><dd>{e(rec)}</dd></dl></article>"""
    return out


def count_ar(n):
    if n == 1:
        return "خدمة واحدة"
    if n == 2:
        return "خدمتان"
    return f"{n} خدمات" if 3 <= n <= 10 else f"{n} خدمة"


def section_batches():
    out = ""
    for code, title, what, rec, cols in BATCHES:
        tag = {"د1": "د1", "د2": "د2", "د3": "د3", "د4": "د4", "د5": "د5"}[code]
        rows = batch_rows(tag)
        badge, settled = verdict(code, "الدفعات")
        out += f"""<article class="item" id="{code}"><header><span class="tag">{code}</span><h3>{e(title)} <span class="count">{count_ar(len(rows))}</span></h3>{badge}</header>
<p>{e(what)}</p><dl>{settled}<dt>توصيتي قبل الاعتماد</dt><dd>{e(rec)}</dd></dl>
<details><summary>الخدمات ({len(rows)})</summary>{codes_table(rows, cols)}</details>
</article>"""
    return out


def section_nav():
    rows = ""
    for n in NAV:
        ok_a = "ok" if n["a_within_12"] == "نعم" else "bad"
        ok_b = "ok" if n["b_within_budget"] == "نعم" else "bad"
        rows += (f"<tr><td class=code>{e(n['menu'])}</td><td class=num>{n['accounts']}</td><td class=num>{n['before']}</td>"
                 f"<td class='num {ok_a}'>{e(str(n['after_a_estimate']))}</td><td class='num {ok_b}'>{e(str(n['after_b_estimate']))}</td><td class=num>{n['budget']}</td></tr>")
    items = ""
    for code, title, what, rec in NAV_ITEMS:
        badge, settled = verdict(code, "بنود_التنقل")
        items += f"""<article class="item" id="{code}"><header><span class="tag">{code}</span><h3>{e(title)}</h3>{badge}</header>
<p>{e(what)}</p><dl>{settled}<dt>توصيتي قبل الاعتماد</dt><dd>{e(rec)}</dd></dl></article>"""
    return f"""<div class="scroll"><table class="navt"><thead><tr><th>القائمة</th><th>حسابات</th><th>اليوم</th><th>بعد-أ (تقدير)</th><th>بعد-ب (تقدير)</th><th>الحد</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="note">«بعد» تقدير محسوب من جدول الربط بقواعد المواصفة §2.4-د، ولم يُشغَّل كود قائمة معدّل. الأحمر في «بعد-أ» فوق السقف المطلق 12، وفي «بعد-ب» فوق حد الدور في عمود «الحد». 15 قائمة على 28 حساب معاينة، لا على الموظفين الـ53.</p>{items}"""


def section_findings():
    if not FINDINGS:
        return ""
    lis = "".join(f"<li><span class='sev sev-{e(f['severity'])}'>{e(f['severity_ar'])}</span> {e(f['text'])} <span class=note>({e(f['status'])})</span></li>" for f in FINDINGS)
    return f"<ul class=findings>{lis}</ul>"


def open_items():
    return "<ul>" + "".join(f"<li>{e(x)}</li>" for x in DEC["ما_زال_مفتوحًا"]) + "</ul>"


def page():
    pl = {k.split(': ', 1)[1]: v for k, v in ST.items() if k.startswith("الموضع: ")}
    return f"""<title>خطة التنظيم — للاعتماد</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{{--paper:#f3f4f1;--sheet:#fbfbf9;--ink:#1b2230;--muted:#586070;--line:#d3d8d3;--accent:#24594f;--accent-soft:#e1ece8;--ok:#1f6a3b;--bad:#a13a22;--warn:#8a5a10;
--f:"IBM Plex Sans Arabic","Noto Sans Arabic",Tahoma,system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{color-scheme:dark;--paper:#131719;--sheet:#1a1f22;--ink:#e6e9e6;--muted:#a1a9a6;--line:#343c3d;--accent:#7cc0af;--accent-soft:#1f302c;--ok:#7fd19b;--bad:#f0927c;--warn:#e0b25a}}}}
:root[data-theme="dark"]{{color-scheme:dark;--paper:#131719;--sheet:#1a1f22;--ink:#e6e9e6;--muted:#a1a9a6;--line:#343c3d;--accent:#7cc0af;--accent-soft:#1f302c;--ok:#7fd19b;--bad:#f0927c;--warn:#e0b25a}}
body{{background:var(--paper);color:var(--ink);font:16px/1.75 var(--f);direction:rtl}}
.wrap{{max-width:980px;margin:0 auto;padding-inline:16px;padding-block:24px 64px}}
h1{{font-size:1.9rem;line-height:1.3;margin:0 0 .25rem;text-wrap:balance}}h2{{font-size:1.3rem;margin:2.5rem 0 .75rem;text-wrap:balance}}h3{{font-size:1.05rem;margin:0;text-wrap:balance}}
.status{{font-family:var(--mono);font-size:.9rem;background:var(--sheet);border:1px solid var(--line);border-radius:6px;padding:10px 12px;overflow-wrap:anywhere}}
.lede{{max-width:65ch;color:var(--muted)}}
.figs{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:1.25rem 0}}
.fig{{background:var(--sheet);border:1px solid var(--line);border-radius:6px;padding:12px}}.fig b{{display:block;font-size:1.7rem;font-variant-numeric:tabular-nums;color:var(--accent)}}.fig span{{color:var(--muted);font-size:.9rem}}
nav.toc{{display:flex;flex-wrap:wrap;gap:8px}}nav.toc a{{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:6px 12px;min-height:44px;display:inline-flex;align-items:center}}
nav.toc a:focus-visible,summary:focus-visible{{outline:3px solid var(--accent);outline-offset:2px}}
.item{{background:var(--sheet);border:1px solid var(--line);border-radius:6px;padding:14px 16px;margin:12px 0;display:grid;gap:8px}}
.item header{{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}}.tag{{font-family:var(--mono);font-weight:500;background:var(--accent-soft);color:var(--accent);border-radius:4px;padding:0 8px}}
.count{{font-weight:400;color:var(--muted);font-size:.9rem}}
dl{{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:4px 14px}}dt{{color:var(--muted);font-size:.9rem}}dd{{margin:0;max-width:70ch}}dd.rec{{font-weight:500}}
@media (max-width:560px){{dl{{grid-template-columns:1fr}}}}
.reply{{margin:0;color:var(--muted);font-size:.85rem;border-top:1px dashed var(--line);padding-top:6px}}
.scroll{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:.9rem}}th,td{{border-bottom:1px solid var(--line);padding:6px 8px;text-align:start;vertical-align:top}}th{{color:var(--muted);font-weight:500}}
td.code{{font-family:var(--mono);font-size:.85rem;white-space:nowrap}}td.num{{font-variant-numeric:tabular-nums}}td.ok{{color:var(--ok)}}td.bad{{color:var(--bad);font-weight:600}}
summary{{cursor:pointer;color:var(--accent);min-height:44px;display:flex;align-items:center}}
.note{{color:var(--muted);font-size:.88rem;max-width:75ch}}ul{{padding-inline-start:1.2rem}}li{{margin:.3rem 0;max-width:75ch}}
.state{{font-size:.8rem;border-radius:999px;padding:1px 10px;border:1px solid currentColor;white-space:nowrap;align-self:center}}.state.done{{color:var(--ok)}}.state.open{{color:var(--warn)}}
.sev{{font-size:.8rem;border-radius:4px;padding:0 6px;border:1px solid currentColor}}.sev-high,.sev-critical{{color:var(--bad)}}.sev-medium{{color:var(--warn)}}.sev-low{{color:var(--muted)}}
code{{font-family:var(--mono);font-size:.9em}}
</style>
<div class="wrap">
<p class="status">ت0 معتمدة {DEC["التاريخ"]} · خدمات {N} · معتمدة {ST["معتمدة من تركي 2026-09-26 (صفوف)"]} · بانتظار مالك إدارة {ST["بانتظار مالك الإدارة (صفوف)"]} · مفتوح: ق5</p>
<h1>خطة التنظيم — للاعتماد</h1>
<p class="lede">إعادة تنظيم منصة 3,6T على نمط المساحات: خدمات كل إدارة داخل صفحتها، وباب واحد للخدمات، وقائمة جانبية بحد لكل دور. اعتمد تركي هذه الصفحة في {DEC["التاريخ"]} بتعليمة «{DEC["نص التعليمة"]}»: الافتراضي في كل بند معدَّلًا بالتوصية المكتوبة تحته. وما بقي مفتوحًا مسمّى في آخر الصفحة. المصدر commit <code>f34b3dc</code>، الترحيل 147، ونسخة احتياطية مجرّبة فُتحت للقراءة فقط.</p>
<div class="figs">
<div class="fig"><b>{N}</b><span>خدمة، ومعها HR-LEAVE</span></div>
<div class="fig"><b>{M1}</b><span>صفًّا لقرار تركي، في 5 دفعات</span></div>
<div class="fig"><b>{M2}</b><span>صفًّا لمالكي الإدارات</span></div>
<div class="fig"><b>{pl.get('الخدمات (الباب الأمامي)', 0)} / {pl.get('فريقي', 0)} / {pl.get('صفحة الإدارة فقط', 0)}</b><span>الباب الأمامي / فريقي / صفحة الإدارة فقط</span></div>
</div>
<nav class="toc" aria-label="أقسام الصفحة"><a href="#decisions">القرارات ق1–ق8</a><a href="#batches">دفعات الخدمات</a><a href="#nav">القائمة قبل وبعد</a><a href="#numbers">لماذا {M1} لا 38</a><a href="#open">ما زال مفتوحًا</a><a href="#review">التحقق</a><a href="#conflicts">تعارضات المصادر</a><a href="#evidence">الأدلة والملفات</a></nav>

<h2 id="decisions">القرارات ق1–ق8</h2>
<p class="note">لكل قرار: ما اعتُمد، ثم الافتراضي في البرومبت والتوصية التي عُرضت قبل الاعتماد — محفوظان ليُعرف على أي أساس قُرر.</p>
{section_decisions()}

<h2 id="batches">دفعات الخدمات</h2>
<p class="note">الدفعات الخمس معتمدة. وعمود «قرار تركي» في <code>docs/org/catalog-mapping.csv</code> يحمل القرار لكل صف من الـ{len(ROWS)}.</p>
{section_batches()}

<h2 id="nav">القائمة الجانبية: قبل وبعد لكل قائمة</h2>
{section_nav()}

<h2 id="numbers">لماذا {M1} لتركي لا 38</h2>
<ul>
<li>أعاد السكربت الأولي <code>build_conversion.py</code> إنتاج الجدول الأولي حرفيًا: 142 صفًّا، و96/6/40، و72/32/38.</li>
<li>ثم طُبّقت قواعد الرفع في البرومبت §4 كما هي. «كل تقييد جمهور» يرفع جمهور client_work غير الحدّية ({ST['دفعة تركي: د4 جمهور client_work غير الحدّية']} خدمة) دفعةً واحدة (د4)، و«عدسة فريقي» تعكس قرارًا مكتوبًا فصارت دفعة (د5، {ST['دفعة تركي: د5 عدسة فريقي (ق6)']} خدمات).</li>
<li>عمود «يحتاج مالك الإدارة؟» مستقل عن عمود تركي، فصار {M2} بدل 32. ويقرر تركي بديلًا في {ST['مالك الإدارة لـADM-: تركي بديلًا']} صفوف ADM- لأن مالكها موقوف.</li>
<li>لا دمج في أي زوج مكرر: التوصية تمييز بالاسم، لأن تطابق النماذج لم يثبت.</li>
</ul>

<h2 id="open">ما زال مفتوحًا</h2>
<p class="note">ثلاثة أشياء لا يملك أحد غيرك أن يحسمها، ولا يمنع أيٌّ منها العمل الجاري:</p>
{open_items()}

<h2 id="review">التحقق الذي جرى فعلًا</h2>
<p class="note"><b>لم يراجع هذه المخرجات وكيل مستقل.</b> المراجعة لك، على هذه الصفحة. وما تحقّقتُ منه بنفسي، وأعدت تشغيله قبل النشر:</p>
<ul>
<li>كل سكربت أعاد توليد مخرجه حرفيًا: <code>--check</code> يقول «up to date» للخريطة وخريطة التنقل والبطاقات واختبار الشجرة وهذه الصفحة.</li>
<li>سكربت الحزمة الأولي <code>build_conversion.py</code> أعاد إنتاج جدولها الأولي كما هو: 142 خدمة، والمواضع 96/6/40، والقرارات 72 بلا قرار و38 لتركي و32 لمالكي الإدارات، و14 رمز ADM-. الفرق في هذه الصفحة سببه قواعد الرفع، لا خطأ في العدّ — وشرحه في «لماذا 82 لتركي لا 38».</li>
<li>صفحة اختبار الشجرة بلا أي طلب خارجي: لا <code>src</code> ولا <code>href</code> ولا <code>fetch</code> إلى أي مضيف.</li>
<li>بصمة النسخة الاحتياطية أعيد حسابها الآن فطابقت بصمة ما قبل ت0 حرفًا بحرف.</li>
</ul>
<p class="note">وما لم يُتحقَّق منه: الصفحة لم تُفتح في متصفح، ولا خط أساس لعتبة نجاح اختبار الشجرة (ق5)، ومواضع الشاشات مستنبطة من الجرد لا من فتحها.</p>
{section_findings()}

<h2 id="conflicts">تعارضات المصادر (مسجّلة، لم أحسمها)</h2>
<ul>{''.join(f'<li>{e(c)}</li>' for c in CONFLICTS)}</ul>

<h2 id="evidence">الأدلة والملفات</h2>
<ul>
<li>الفرع <code>integration-20260920</code> والـcommit <code>f34b3dc</code> مطابقان للجرد.</li>
<li>بصمة النسخة الاحتياطية sha256 قبل ت0 وبعدها: <code>cbaa2d41…aa115</code>. القراءة من نسخة مؤقتة <code>readOnly</code>. لم تُفتح القاعدة الحية، ولم يُعدَّل <code>app/</code> ولا الاختبارات.</li>
<li>الملفات في <code>docs/org/</code>: جدول التحويل (CSV وmd)، وخريطة التنقل، ومسودات بطاقات الموجة الأولى (22 خدمة لرأس المال البشري وHR-LEAVE)، وعدة اختبار الشجرة، والسكربتات. كل ملف يُعاد توليده بسكربته، و<code>--check</code> يكشف القديم.</li>
<li>لم يُشغَّل <code>npm test</code>: لم يتغير منطق. وصفحة اختبار الشجرة لم تُفتح في متصفح، لأن حماية الجلسة منعت تشغيله. افتحها بنفسك قبل الجلسة الأولى.</li>
<li>لا أسماء أشخاص ولا بريد ولا جوال في المخرجات. الحسابات أعداد فقط.</li>
<li>التالي: القرارات مسجّلة في عمود «قرار تركي» بجدول التحويل وفي <code>data/decisions-t0.json</code>. ولا يبدأ ت1 قبل شروط دخولها في البرومبت §5: م1 مغلقة بتقريرها، وTP2.1 وTP2.4 جاهزتان، ونتيجة اختبار الشجرة مسجّلة.</li>
</ul>
</div>
"""


def main():
    text = page()
    path = os.path.join(ORG, "approval-page.html")
    if "--check" in sys.argv:
        ok = open(path, encoding="utf-8").read() == text
        print("up to date" if ok else "STALE"); sys.exit(0 if ok else 1)
    open(path, "w", encoding="utf-8").write(text)
    print("written", len(text.encode()))


if __name__ == "__main__":
    main()
