#!/usr/bin/env python3
"""T0.3: build docs/org/cards-wave1.md, draft card content for wave-1 services
(the 22 services owned by Human Capital, plus HR-LEAVE).

Every value comes from the tested backup (read-only extract) or the inventory:
questions = the service's current form fields; documents = what the current
service description asks to attach, or the leave-type policy; policy = an article
of the policy library whose title matches the service. Anything without a source
is written «يحتاج سندًا». Nothing here is published; all drafts await the owner.

Usage: python3 docs/org/scripts/build_cards_wave1.py [--check]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORG = os.path.dirname(HERE)
INV = json.load(open(os.path.join(ORG, "data", "inventory_data.json"), encoding="utf-8"))
BAK = json.load(open(os.path.join(ORG, "data", "backup_extract.json"), encoding="utf-8"))
NEED = "يحتاج سندًا"

# Candidate articles of «لائحة تنظيم العمل» (policy library, document work_regulation) by title.
# policy_request_basis already binds HR-GRIEVANCE (126) and overtime (76); the rest are title matches
# that the department owner confirms or rejects.
ARTICLES = {
    "HR-ATTENDANCE-FIX": [75, 79],
    "HR-BANK-CHANGE": [50],
    "HR-BENEFIT-CLAIM": [98],
    "HR-GRIEVANCE": [126],
    "HR-HIRING-NEED": [8],
    "HR-JOB-CHANGE": [20, 62],
    "HR-OVERTIME": [76, 77],
    "HR-PAYROLL-INQUIRY": [50, 51],
    "HR-PROFILE-UPDATE": [29],
    "HR-REFERRAL": [10],
    "HR-RESIGNATION": [34, 35, 36],
    "HR-SALARY-ADVANCE": [71],
    "TAL-PERFORMANCE-REVIEW": [52, 55],
    "TAL-SUCCESSION": [62],
    "TAL-TRAINING": [45],
    "HR-LEAVE": [80, 82, 83, 86, 87, 88, 89, 90, 91, 105],
}
BOUND = {"HR-GRIEVANCE": "grievance.file", "HR-OVERTIME": "overtime.request"}
EXTRA_POLICY = {"HR-BENEFIT-CLAIM": "«سياسة المزايا الجديدة» في المكتبة، وحالتها مسودة غير متبنّاة: لا تُسند إليها البطاقة قبل تبنّيها"}
STEP = {"manager": "المدير المباشر", "hr": "الموارد البشرية", "department_manager": "مدير الإدارة المالكة", "it": "تقنية المعلومات"}
TEAM = {"HR-EXIT-INTERVIEW", "HR-HIRING-NEED", "HR-JOB-CHANGE", "IT-NEW-ACCOUNT", "PMO-RESOURCE"}


def art_title(n):
    for a in BAK["policy_articles"]:
        if a["doc"] == "work_regulation" and a["number"] == n:
            return a["title"]
    return None


def documents(desc, fields):
    found = []
    for m in re.finditer(r"أرفق ([^.؛]+)", desc or ""):
        found.append(f"{m.group(1).strip()} (من وصف الخدمة الحالي)")
    for f in fields:
        if any(w in f["label"] for w in ("الدليل", "المستند")):
            found.append(f"{f['label']} ({'إلزامي' if f['required'] else 'اختياري'}، حقل في النموذج الحالي)")
    return found


def card(code, name, desc, fields, steps, target, eligibility):
    lines = [f"### {code}: {name}", "",
             "**الحالة:** مسودة لاعتماد مالك الإدارة. لم تُنشر، ولا تُدخل المنصة قبل ت1.", ""]
    lines.append(f"- **الوصف القائم:** {desc or NEED}")
    docs = documents(desc, fields)
    lines.append("- **المستندات:** " + ("؛ ".join(docs) if docs else f"لا مستند في الخدمة الحالية. {NEED} إن كان يلزم مستند."))
    lines.append("- **الأهلية:** " + "؛ ".join(eligibility))
    q = [f"{f['label']}{' (إلزامي)' if f['required'] else ''}" for f in fields]
    lines.append("- **الأسئلة (حقول النموذج الحالي):** " + ("، ".join(q) if q else NEED))
    arts = ARTICLES.get(code, [])
    if arts:
        refs = "؛ ".join(f"م{n} «{art_title(n)}»" for n in arts if art_title(n))
        how = f"مربوطة في `policy_request_basis` ({BOUND[code]})" if code in BOUND else "مرشّحة بمطابقة العنوان، يؤكدها المالك"
        lines.append(f"- **السياسة المرجعية:** لائحة تنظيم العمل (منشورة في المكتبة، ونصها «مستخرج» لم يُتحقق منه): {refs}. {how}.")
    else:
        lines.append(f"- **السياسة المرجعية:** {NEED}. لا مادة في مكتبة السياسات تطابق هذه الخدمة.")
    if code in EXTRA_POLICY:
        lines.append(f"  - {EXTRA_POLICY[code]}.")
    lines.append(f"- **مسار الاعتماد (قائم):** {' ← '.join(STEP.get(s, s) for s in steps) if steps else 'بحسب نوع الإجازة'}")
    lines.append(f"- **المدة:** {target}")
    lines.append("")
    return lines


def main():
    hr = [s for s in INV["services"] if s["department_id"] == "hr"]
    out = ["# مسودات بطاقات الموجة الأولى (ت0.3)", "",
           "> مولّدة بـ`docs/org/scripts/build_cards_wave1.py` من الجرد ومن نسخة احتياطية مجرّبة فُتحت `readOnly`.",
           "> **كلها «مسودة لاعتماد مالك الإدارة».** لا سياسة مخترعة: ما لا سند له مكتوب «يحتاج سندًا».",
           f"> النطاق المبدئي: خدمات رأس المال البشري الـ{len(hr)}، ومعها `HR-LEAVE`. وتُضاف خدمات الإدارتين اللتين يسمّيهما تركي عند تسميتهما.",
           "> المدة كما هي اليوم ووسمها: «مشتقة» من بادئة الرمز (`service-target.mjs`)، ولم يُتبنَّ أي زمن (`service_target_adoptions` فارغ). لا قيمة جديدة.",
           "", "## ملخص", "", "| الرمز | الاسم | مستندات لها سند | سياسة لها سند | المدة |", "|---|---|---|---|---|"]
    body = []
    stats = {"docs": 0, "policy": 0, "n": 0}
    for s in hr:
        b = BAK["services"][s["code"]]
        elig = [f"الجمهور اليوم «الكل» (قبل ت2ب)"]
        if s["code"] in TEAM:
            elig.append("مصنّفة في `MY_TEAM_LENS`: يقدّمها المدير عن موظف في فريقه")
        if b["approval_policy"].get("closed_circle"):
            elig.append("دائرة مغلقة: لا تمر بالمدير المباشر")
        elig.append(f"شروط أهلية أخرى: {NEED}")
        target = f"{s['target_days']} أيام ({'مشتقة' if s['target_kind'] == 'derived' else 'مسجّلة'})"
        docs = documents(b["description"], b["fields"])
        has_pol = bool(ARTICLES.get(s["code"]))
        stats["n"] += 1; stats["docs"] += bool(docs); stats["policy"] += has_pol
        out.append(f"| `{s['code']}` | {s['name_ar']} | {'نعم' if docs else 'لا'} | {'نعم' if has_pol else 'لا'} | {target} |")
        body += card(s["code"], s["name_ar"], b["description"], b["fields"], b["approval_policy"].get("steps", []), target, elig)
    # HR-LEAVE from the leave-type policy (accepted in the backup)
    lt = BAK["leave_type_policies"][0]
    docs = [f"{t['name_ar']}: " + "، ".join(f"{d['name_ar']}{'' if d.get('required') else ''}" for d in t["documents"]) for t in lt["types"] if t["documents"]]
    elig = ["تصريح `leave.use` (قائم)"] + [f"{t['name_ar']}: " + json.dumps(t["eligibility"], ensure_ascii=False) for t in lt["types"] if t["eligibility"]]
    body += ["### HR-LEAVE: طلب إجازة (وحدة خارج جدول services)", "",
             "**الحالة:** مسودة لاعتماد مالك الإدارة.", "",
             f"- **المصدر:** سياسة «{lt['title']}» في القاعدة، حالتها «{lt['status']}».",
             "- **الأنواع:** " + "، ".join(t["name_ar"] for t in lt["types"]) + ".",
             "- **المستندات بحسب النوع:** " + "؛ ".join(docs) + ".",
             "- **الأهلية:** " + "؛ ".join(elig) + ".",
             "- **الأسئلة:** نموذج وحدة الإجازات القائم (النوع، والتواريخ، والمستند بحسب النوع). تفصيل الحقول في الوحدة، لا في جدول services.",
             "- **السياسة المرجعية:** لائحة تنظيم العمل: " + "؛ ".join(f"م{n} «{art_title(n)}»" for n in ARTICLES["HR-LEAVE"]) + ".",
             "- **المدة:** لا مهلة مسجّلة للوحدة. " + NEED + ".", ""]
    out.append(f"| `HR-LEAVE` | طلب إجازة | نعم | نعم | — |")
    out += ["", f"**العدّ:** {stats['n']} خدمة + `HR-LEAVE`. لها مستند بسند: {stats['docs']}. لها مادة سياسة مرشّحة أو مربوطة: {stats['policy']}. وكل «يحتاج سندًا» بند لمالك رأس المال البشري.", "",
            "## البطاقات", ""] + body
    text = "\n".join(out) + "\n"
    path = os.path.join(ORG, "cards-wave1.md")
    if "--check" in sys.argv:
        ok = open(path, encoding="utf-8").read() == text
        print("up to date" if ok else "STALE"); sys.exit(0 if ok else 1)
    open(path, "w", encoding="utf-8").write(text)
    print(stats)


if __name__ == "__main__":
    main()
