#!/usr/bin/env python3
"""T0.1: build docs/org/catalog-mapping.csv and catalog-mapping.md.

Inputs (both produced read-only, see docs/org/README.md):
    docs/org/data/inventory_data.json   inventory JSON (commit f34b3dc, migration 147)
    docs/org/data/backup_extract.json   extract_backup.mjs output from the tested backup

The coordinator's build_conversion.py stays the single source of the base rules
(ORG-AF / ORG-HD). This script reuses its build() row for every service, then adds
the remaining columns and the raise rules of PROMPT_ORG_REFORM 1.2 section 4:
    every client_work borderline, the ten leadership services, every merge,
    every audience restriction, and every audience / placement / approval change
    on a service tagged money or restricted.
Tag review itself is owner work and is not counted as a decision item.

Usage: python3 docs/org/scripts/build_mapping.py [--check]
"""
import csv
import io
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ORG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_conversion as bc  # noqa: E402

INV = json.load(open(os.path.join(ORG, "data", "inventory_data.json"), encoding="utf-8"))
BAK = json.load(open(os.path.join(ORG, "data", "backup_extract.json"), encoding="utf-8"))
DEC = json.load(open(os.path.join(ORG, "data", "decisions-t0.json"), encoding="utf-8"))
AMEND = {}
for _a in DEC["تعديلات_على_الصفوف"]:
    AMEND.setdefault(_a["الرمز"], {})[_a["الحقل"]] = _a["إلى"]
DECIDED_BATCHES = {k for k, v in DEC["الدفعات"].items() if v["الحالة"].startswith("معتمد")}

PLACE = {
    "الخدمات": "الخدمات (الباب الأمامي)",
    "فريقي": "فريقي",
    "مساحة الإدارة": "صفحة الإدارة فقط",
}
STEP = {
    "manager": "المدير المباشر",
    "department_manager": "مدير الإدارة المالكة",
    "hr": "منصب الموارد البشرية المنفّذ",
    "it": "منصب تقنية المعلومات المنفّذ",
}
HANDLER = {
    "manager": "مدير الإدارة",
    "member": "عضو الإدارة",
    "hr": "منفّذ الموارد البشرية",
    "it": "منفّذ تقنية المعلومات",
}
HANDLER_DEPT = {"hr": "رأس المال البشري", "it": "تقنية المعلومات"}
ADM_OWNER = "الشؤون الإدارية والمرافق (موقوفة)"
TURKI_BATCH = {
    "ORG-AF-04": "د1 خدمات ADM-",
    "ORG-HD-10": "د2 الحدّيات من client_work",
    "ORG-HD-11": "د3 القيادية",
    "AUD-CW": "د4 جمهور client_work غير الحدّية",
    "Q6": "د5 عدسة فريقي (ق6)",
}


def audience_reason(code, kind, aud, why):
    if code in bc.LEAD:
        return "قيادية: رجّح الجرد أنها للمديرين أو القيادة (ORG-HD-11)"
    if code in bc.BORDER:
        return "حدّية من client_work: حاجة داخلية لموظف خارج إدارات التسليم (ORG-HD-10)"
    if code in bc.TEAM:
        return "في MY_TEAM_LENS: تُطلب نيابة عن موظف (ORG-AF-05، يمس ق6)"
    if kind == "client_work":
        return "client_work: سير عمل تشغيلي لإدارات التسليم (BR-ORG-23)"
    if code in bc.RESTRICT:
        return f"يبقى «الكل»؛ مرشّح للتقييد إلى: {bc.RESTRICT[code]} (ORG-HD-02)"
    return "الإتاحة هي الافتراض (ORG-AF-06)"


def row_for(s):
    code, kind = s["code"], s["service_kind"]
    base = bc.build(s)  # code, name, owner, aud, place, uname, dec, why
    _, name, owner_p, aud, place, uname, dec, why = base
    b = BAK["services"].get(code, {})
    is_adm = code.startswith("ADM-")
    money, personal = s["touches_money"], s["touches_personal_data"]
    restricted, confidential = s["restricted"], s["confidential"]
    renamed = uname not in ("—",) and not uname.startswith("—")
    placement_changed = place != "الخدمات"
    audience_restricted = not aud.startswith("الكل")

    turki, batches, owner = False, [], False
    if dec == "تركي":
        turki = True
        for k in ("ORG-AF-04", "ORG-HD-10", "ORG-HD-11"):
            if k in why:
                batches.append(TURKI_BATCH[k])
    # The two decision columns are independent: build() keeps only the highest one,
    # so owner items are re-derived from the same rule sets (ORG-HD-02, ORG-AF-09, ORG-AF-11).
    if code in bc.RENAME or code in bc.RESTRICT or code in bc.OWNER_EXTRA or code in bc.DUP_OWNER:
        owner = True
    # Prompt 1.2 section 4: every audience restriction goes to a human decision.
    if kind == "client_work" and code not in bc.BORDER and code not in bc.LEAD:
        turki = True; batches.append(TURKI_BATCH["AUD-CW"])
    if code in bc.TEAM:
        turki = True; batches.append(TURKI_BATCH["Q6"])
    # A department without a named owner: Turki substitutes (ق4). ADM owner is suspended.
    owner_col = "لا"
    if owner:
        owner_col = "تركي بديلًا (الإدارة المالكة موقوفة)" if is_adm else "نعم"

    actions = []
    if renamed:
        actions.append("إعادة تسمية")
    if placement_changed:
        actions.append("نقل موضع")
    if is_adm:
        actions.append("نقل ملكية (وسم عرض في ت1، بيانات في ت2أ)")
    action = " + ".join(actions) or "إبقاء"

    synonyms = []
    if renamed:
        synonyms.append(name)
    synonyms += b.get("old_names", [])
    synonyms += b.get("synonyms", [])
    seen, syn = set(), []
    for t in synonyms:
        if t and t not in seen:
            seen.add(t); syn.append(t)

    handler = HANDLER[s["handler_role"]]
    exec_dept = HANDLER_DEPT.get(s["handler_role"], "مكتب الرئيس التنفيذي" if is_adm else s["department_ar"])
    executor = f"{exec_dept}: {handler}"
    proposed_owner = AMEND.get(code, {}).get("الإدارة المالكة المقترحة") or (ADM_OWNER if is_adm else s["department_ar"])
    # The instrument runs from whoever owns the service to whoever executes it, so it has to name the
    # decided owner: ADM-EXPENSE-CLAIM moved to المالية (ق3)، وتنفيذها يبقى في مكتب الرئيس حتى ت2أ.
    if proposed_owner == exec_dept:
        delegation = "لا ينطبق"
    elif is_adm:
        delegation = f"مطلوب: سند تفويض مسجل من {proposed_owner} إلى {exec_dept} (ORG-F06)"
    elif exec_dept == s["department_ar"]:
        delegation = "لا ينطبق"
    else:
        delegation = "منفّذ من إدارة أخرى بالدور (قائم)؛ لا سند مطلوب في ت0"
    tags = []
    if money: tags.append("مال")
    if personal: tags.append("بيانات شخصية")
    if restricted: tags.append("مقيدة")
    if confidential: tags.append("سرية")
    notes = []
    if code in bc.ADM_OUTSIDE_11:
        notes.append("خارج «أدواتي ومكاني»: المالك الدائم لقرار تركي؛ بديل: المالية لـADM-EXPENSE-CLAIM")
    if code in bc.DUP:
        notes.append("زوج مكرر في الجرد: التوصية تمييز لا دمج (شرط تطابق النموذج لم يُفحص)")
    if code == "HR-LETTER":
        notes.append("الاسم مثبّت باختبارات CATALOG_RENAMES: يبقى بسبب مكتوب")
    if (money or restricted) and (placement_changed or audience_restricted):
        notes.append("موسومة بمال أو قيد، ويتغير موضعها أو جمهورها: قرار بشري")
    if kind == "client_work" and code not in bc.BORDER and code not in bc.LEAD:
        notes.append("التقييد يُفرض في ت2ب فقط؛ في ت1 نقل موضع عرض والرابط المباشر يبقى")
    return {
        "الرمز": code,
        "الاسم الحالي": name,
        "الاسم الموحد المقترح": uname if renamed else "— (يبقى)",
        "المرادفات": "؛ ".join(syn),
        "الإدارة المالكة الحالية": s["department_ar"],
        "الإدارة المالكة المقترحة": proposed_owner,
        "المنفّذ": executor,
        "سند التفويض": delegation,
        "فئة الحاجة الحالية": s["category_ar"],
        "فئة الحاجة المقترحة": s["category_ar"],
        "القسم": s["section"],
        "مجموعة الخيارات": s.get("group") or "",
        "الموضع": PLACE[place],
        "الجمهور المقترح": AMEND.get(code, {}).get("الجمهور المقترح") or aud,
        "سبب الجمهور": audience_reason(code, kind, aud, why),
        "مسار الاعتماد بالمنصب": " ← ".join(STEP[x] for x in s["approval_steps"]),
        "الوسوم": "، ".join(tags) or "—",
        "حالة البطاقة": "مسودة" if s["card_status"] == "draft" else s["card_status"],
        "المهلة ووسمها": f"{s['target_days']} يوم ({'مشتقة' if s['target_kind'] == 'derived' else 'مسجّلة'})",
        "النوع": s["service_kind"],
        "الموجة": "1" if s["department_id"] == "hr" else "غير محددة",
        "الإجراء": action,
        "يحتاج قرار تركي؟": "نعم" if turki else "لا",
        "دفعة تركي": "؛ ".join(batches),
        "يحتاج مالك الإدارة؟": owner_col,
        "السبب (قواعد)": why,
        "ملاحظات": "؛ ".join(notes),
        "قرار تركي": decision_col(code, batches, owner_col),
    }


def decision_col(code, batches, owner_col):
    parts = []
    done = [b for b in batches if b.split()[0] in DECIDED_BATCHES]
    if done:
        amended = " (بتعديل)" if code in AMEND else ""
        parts.append(f"معتمد {DEC['التاريخ']}: {'؛ '.join(b.split()[0] for b in done)}{amended}")
    if owner_col != "لا":
        parts.append("بانتظار مالك الإدارة" + (" (تركي بديلًا)" if owner_col.startswith("تركي") else ""))
    return " · ".join(parts) or "لا يحتاج قرارًا"


def leave_row():
    m = INV["modules_outside_services"][0]
    b = BAK["leave_type_policies"]
    return {
        "الرمز": m["code"], "الاسم الحالي": m["name_ar"], "الاسم الموحد المقترح": "— (يبقى)",
        "المرادفات": "إجازة؛ إجازتي؛ " + "؛ ".join(t["name_ar"] for p in b[:1] for t in p["types"]),
        "الإدارة المالكة الحالية": "رأس المال البشري", "الإدارة المالكة المقترحة": "رأس المال البشري",
        "المنفّذ": "رأس المال البشري: وحدة الإجازات (خارج جدول services)", "سند التفويض": "لا ينطبق",
        "فئة الحاجة الحالية": "وقتي وحضوري", "فئة الحاجة المقترحة": "وقتي وحضوري", "القسم": "الإجازات",
        "مجموعة الخيارات": "VAR-LEAVE", "الموضع": "الخدمات (الباب الأمامي)",
        "الجمهور المقترح": "من يحمل تصريح leave.use (قائم)",
        "سبب الجمهور": "وحدة خارج الجدول؛ الجمهور قائم بتصريح ولا يتغير",
        "مسار الاعتماد بالمنصب": "بحسب نوع الإجازة في سياسة أنواع الإجازات (وحدة الإجازات)",
        "الوسوم": "بيانات شخصية", "حالة البطاقة": "لا بطاقة (وحدة)", "المهلة ووسمها": "—",
        "النوع": "module", "الموجة": "1", "الإجراء": "إبقاء", "يحتاج قرار تركي؟": "لا", "دفعة تركي": "", "قرار تركي": "لا يحتاج قرارًا",
        "يحتاج مالك الإدارة؟": "لا", "السبب (قواعد)": "وحدة خارج services (INVENTORY_DIGEST أ)",
        "ملاحظات": "تُعدّ في «خدمات» 143 = 142 + HR-LEAVE",
    }


def stats(rows):
    svc = [r for r in rows if r["النوع"] != "module"]
    out = []
    add = out.append
    add(("عدد الصفوف", len(rows)))
    add(("منها خدمات جدول services", len(svc)))
    for k, v in sorted(Counter(r["الموضع"] for r in rows).items()):
        add((f"الموضع: {k}", v))
    for k, v in sorted(Counter(r["الجمهور المقترح"] for r in rows).items(), key=lambda x: -x[1]):
        add((f"الجمهور: {k}", v))
    for k, v in sorted(Counter(r["الإجراء"] for r in rows).items(), key=lambda x: -x[1]):
        add((f"الإجراء: {k}", v))
    add(("يحتاج قرار تركي (صفوف)", sum(r["يحتاج قرار تركي؟"] == "نعم" for r in rows)))
    for k, v in sorted(Counter(b for r in rows for b in r["دفعة تركي"].split("؛ ") if b).items()):
        add((f"دفعة تركي: {k}", v))
    add(("يحتاج مالك الإدارة (صفوف، بلا ADM-)", sum(r["يحتاج مالك الإدارة؟"] == "نعم" for r in rows)))
    add(("مالك الإدارة لـADM-: تركي بديلًا", sum(r["يحتاج مالك الإدارة؟"].startswith("تركي") for r in rows)))
    add(("يحتاج تركي ومالك الإدارة معًا", sum(r["يحتاج قرار تركي؟"] == "نعم" and r["يحتاج مالك الإدارة؟"] == "نعم" for r in rows)))
    add(("معتمدة من تركي 2026-09-26 (صفوف)", sum(r["قرار تركي"].startswith("معتمد") for r in rows)))
    add(("بانتظار مالك الإدارة (صفوف)", sum("بانتظار" in r["قرار تركي"] for r in rows)))
    add(("لا يحتاج قرارًا", sum(r["يحتاج قرار تركي؟"] == "لا" and r["يحتاج مالك الإدارة؟"] == "لا" for r in rows)))
    base = Counter(bc.build(s)[6] for s in INV["services"])
    add(("مرجع: الجدول الأولي (build_conversion.py) لتركي", base["تركي"]))
    add(("مرجع: الجدول الأولي لمالكي الإدارات", base["مالك الإدارة"]))
    add(("مرجع: الجدول الأولي بلا قرار", base["لا"]))
    return out


def main():
    rows = [row_for(s) for s in INV["services"]]
    assert len(rows) == 142
    rows.append(leave_row())
    st = stats(rows)
    cols = list(rows[0].keys())

    buf = io.StringIO()
    buf.write("# جدول التحويل ت0 — مقترح لا قرار (BR-ORG-22). مولّد بـdocs/org/scripts/build_mapping.py\n")
    for k, v in st:
        buf.write(f"# {k}: {v}\n")
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    csv_text = buf.getvalue()

    md = ["# جدول التحويل (ت0.1)", "",
          "> مقترح لا قرار (BR-ORG-22). مولّد آليًا بـ`docs/org/scripts/build_mapping.py` من الجرد (`f34b3dc`، الترحيل 147) ومن نسخة احتياطية مجرّبة فُتحت `readOnly`. لا يُحرَّر يدويًا: عدّل القواعد في السكربت وأعد التوليد.",
          "", "## الإحصاءات (يولّدها السكربت)", "", "| البند | العدد |", "|---|---|"]
    md += [f"| {k} | {v} |" for k, v in st]
    md += ["", "## الجدول", "",
           "الأعمدة الطويلة (المرادفات، السبب، الملاحظات) في ملف CSV وحده.", ""]
    short = ["الرمز", "الاسم الحالي", "الاسم الموحد المقترح", "الإدارة المالكة المقترحة", "الموضع",
             "الجمهور المقترح", "مسار الاعتماد بالمنصب", "الوسوم", "الإجراء", "يحتاج قرار تركي؟", "دفعة تركي", "يحتاج مالك الإدارة؟"]
    md.append("| # | " + " | ".join(short) + " |")
    md.append("|---" * (len(short) + 1) + "|")
    for i, r in enumerate(rows, 1):
        md.append(f"| {i} | " + " | ".join(str(r[c]).replace("|", "/") for c in short) + " |")
    md_text = "\n".join(md) + "\n"

    if "--check" in sys.argv:
        ok = open(os.path.join(ORG, "catalog-mapping.csv"), encoding="utf-8").read() == csv_text and \
            open(os.path.join(ORG, "catalog-mapping.md"), encoding="utf-8").read() == md_text
        print("up to date" if ok else "STALE"); sys.exit(0 if ok else 1)
    open(os.path.join(ORG, "catalog-mapping.csv"), "w", encoding="utf-8").write(csv_text)
    open(os.path.join(ORG, "catalog-mapping.md"), "w", encoding="utf-8").write(md_text)
    json.dump(dict(st), open(os.path.join(ORG, "data", "catalog-mapping.stats.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for k, v in st:
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
