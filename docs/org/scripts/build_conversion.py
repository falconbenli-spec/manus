#!/usr/bin/env python3
"""Rebuild Appendix A (catalog conversion table) of docs/platform/org/CATALOG_GOVERNANCE.md
from inventory_data.json, and print the placement / decision statistics.

Usage:
    python3 build_conversion.py inventory_data.json          # stats only
    python3 build_conversion.py inventory_data.json --md     # also print the markdown rows

The rule sets below mirror ORG-AF / ORG-HD in section 4 of the document.
Judgement-based lists (borderline, leadership, restriction candidates, renames, duplicate pairs)
are written out explicitly so the result is reproducible. Not executed by its author
(no shell available in that session); run it and compare with the counts in Appendix A.
"""
import json
import sys
from collections import Counter

DELIVERY = "إدارات التسليم + pm"
MGR_DELIVERY = "المديرون + إدارات التسليم + pm"

# ORG-AF-05: the code's own MY_TEAM_LENS (catalog-tree.mjs:99)
TEAM = {"HR-EXIT-INTERVIEW", "HR-HIRING-NEED", "HR-JOB-CHANGE", "IT-NEW-ACCOUNT", "PMO-RESOURCE"}

# ORG-HD-11: the ten services the inventory judged manager / leadership -> (placement, audience)
LEAD = {
    "DAT-PROFITABILITY": ("مساحة الإدارة", "المديرون + pm"),
    "FIN-BUDGET-TRANSFER": ("الخدمات", "المديرون"),
    "GOV-DECISION": ("الخدمات", "المديرون"),
    "GOV-INITIATIVE": ("الخدمات", "المديرون"),
    "GOV-MEETING-ITEM": ("الخدمات", "المديرون"),
    "GOV-OBJECTIVE": ("الخدمات", "المديرون"),
    "GOV-POLICY": ("الخدمات", "المديرون"),
    "PMO-NEW-PROJECT": ("الخدمات", "المديرون + pm"),
    "PMO-SUBCONTRACT": ("الخدمات", "المديرون + pm"),
    "TAL-SUCCESSION": ("فريقي", "المديرون"),
}

# ORG-HD-10: borderline client_work services -> recommended (placement, audience)
BORDER = {
    "CREATIVE-BRIEF": ("الخدمات", MGR_DELIVERY),
    "CRT-CONTENT": ("الخدمات", MGR_DELIVERY),
    "CRT-DESIGN": ("الخدمات", MGR_DELIVERY),
    "CRT-REVISION": ("الخدمات", MGR_DELIVERY),
    "CRT-TRANSLATION": ("الخدمات", MGR_DELIVERY),
    "BRAND-COMPLIANCE": ("الخدمات", MGR_DELIVERY),
    "BRAND-MERCH": ("الخدمات", MGR_DELIVERY),
    "DAT-DASHBOARD": ("الخدمات", MGR_DELIVERY),
    "CRT-ASSET-REQUEST": ("الخدمات", "الكل"),
    "DAT-AI-USE": ("الخدمات", "الكل"),
    "DAT-DATA-ACCESS": ("الخدمات", "الكل"),
    "DAT-DATA-QUALITY": ("الخدمات", "الكل"),
    "DAT-KNOWLEDGE": ("الخدمات", "الكل"),
    "PR-ISSUE-ALERT": ("الخدمات", "الكل"),
}

# ORG-HD-02: restriction candidates (audience stays "all" until the department owner decides)
RESTRICT = {
    "EXP-ANNOUNCEMENT": "المديرون",
    "EXP-SURVEY": "المديرون",
    "EXP-WELCOME": "المديرون، في فريقي",
    "FIN-CLIENT-INVOICE": "إدارات التسليم + pm",
    "FIN-COLLECTION-FOLLOWUP": "المالية + إدارة الحسابات",
    "FIN-PAYMENT-REQUEST": "المديرون + pm + المشتريات",
    "FIN-REFUND": "إدارات التسليم + المالية",
    "IT-CHANGE-REQUEST": "تقنية المعلومات + تشغيل المنصة",
    "PMO-CLOSURE": "المديرون + pm",
    "PRC-VENDOR-BANK": "المشتريات",
    "PRC-VENDOR-EVALUATION": "المديرون + pm",
}

# ORG-AF-09 / ORG-AF-11: proposed unified names
RENAME = {
    "ADM-ACCESS-CARD": "طلب بطاقة موظف أو بطاقة دخول",
    "ADM-MAINTENANCE": "طلب صيانة أو إصلاح",
    "ADM-OUTGOING-LETTER": "طلب مراسلة رسمية صادرة",
    "ADM-SUPPLIES": "طلب قرطاسية أو مستلزمات مكتبية",
    "ADM-TRAVEL": "طلب سفر أو انتداب",
    "ADM-VISITOR": "طلب تصريح دخول زائر",
    "ADM-WORKSPACE": "طلب مكتب أو مقعد عمل",
    "BRAND-MERCH": "طلب مطبوعات أو هدايا دعائية",
    "DAT-AI-USE": "طلب استخدام أداة ذكاء اصطناعي",
    "EXP-INTERNAL-EVENT": "طلب تنظيم فعالية داخلية",
    "EXP-SUGGESTION": "اقتراح تحسين في بيئة العمل",
    "EXP-WELCOME": "طلب برنامج ترحيب بموظف جديد",
    "FIN-CUSTODY": "طلب عهدة نقدية أو تسويتها",
    "FIN-TAX-QUERY": "استفسار عن ضريبة أو فاتورة",
    "HR-EXIT-INTERVIEW": "طلب مقابلة خروج ونقل معرفة",
    "HR-EXPERIENCE-CERT": "طلب شهادة خبرة",
    "HR-GRIEVANCE": "تقديم شكوى أو تظلم سري",
    "HR-JOB-CHANGE": "طلب تغيير وظيفي لموظف",
    "HR-RESIGNATION": "تقديم استقالة وإخلاء طرف",
    "HR-SALARY-ADVANCE": "طلب سلفة على الراتب",
    "HR-SALARY-CERT": "طلب تعريف بالراتب",
    "IT-MEETING-SUPPORT": "حجز دعم تقني لاجتماع",
    "IT-OUTAGE": "الإبلاغ عن توقف نظام أو بطئه",
    "LEG-CONSULTATION": "طلب استشارة قانونية",
    "LEG-IP-RIGHTS": "طلب بشأن ملكية فكرية أو علامة",
    "LEG-LICENSE-PERMIT": "طلب ترخيص أو تصريح حكومي",
    "LEG-NDA": "طلب اتفاقية عدم إفصاح",
    "PRC-EMERGENCY": "طلب شراء عاجل",
}

# duplicate pairs from the inventory (ORG-AF-11); OWNER = pair members needing an owner decision
DUP = {"IT-SUPPORT", "IT-MEETING-SUPPORT", "IT-OUTAGE", "EXP-SUGGESTION", "IT-PLATFORM-FEEDBACK",
       "PRC-PURCHASE-REQUEST", "PRC-EMERGENCY", "CRM-OPPORTUNITY", "CRM-LOSS", "INF-CAMPAIGN"}
DUP_OWNER = {"INF-CAMPAIGN", "PRC-PURCHASE-REQUEST"}  # group renames; others decided via RENAME

NAME_NOTE = {
    "HR-LETTER": "— (مثبّت: CATALOG_RENAMES)",
    "INF-CAMPAIGN": "— (المجموعة VAR-INFLUENCER تصير «خدمات المؤثرين»)",
    "PRC-PURCHASE-REQUEST": "— (المجموعة VAR-PROCURE تصير «الشراء»)",
}
OWNER_EXTRA = {"PMO-RESOURCE"}  # add role pm?  -> owner decision
ADM_OUTSIDE_11 = {"ADM-EXPENSE-CLAIM", "ADM-GOVT-SERVICES", "ADM-SUBSCRIPTION"}

RANK = {"لا": 0, "مالك الإدارة": 1, "تركي": 2}


def bump(cur, new):
    return new if RANK[new] > RANK[cur] else cur


def build(s):
    code, kind = s["code"], s["service_kind"]
    owner, aud, place, name, dec, why = s["department_ar"], "الكل", "الخدمات", "—", "لا", []
    if code.startswith("ADM-"):
        owner = "الشؤون الإدارية (موقوفة)؛ تنفيذ مؤقت: مكتب الرئيس التنفيذي"
        if code in ADM_OUTSIDE_11:
            owner += " *"
        dec = bump(dec, "تركي"); why.append("ORG-AF-04")
    if kind == "client_work":
        place, aud = "مساحة الإدارة", DELIVERY; why.append("ORG-AF-16")
    if code in TEAM:
        place, aud = "فريقي", "المديرون"; why.append("ORG-AF-05")
    if code in BORDER:
        place, aud = BORDER[code]; dec = bump(dec, "تركي"); why.append("ORG-HD-10")
    if code in LEAD:
        place, aud = LEAD[code]; dec = bump(dec, "تركي"); why.append("ORG-HD-11")
    if code in RESTRICT:
        aud = f"الكل (مرشح: {RESTRICT[code]})"; dec = bump(dec, "مالك الإدارة"); why.append("ORG-HD-02")
    if code in OWNER_EXTRA:
        dec = bump(dec, "مالك الإدارة"); why.append("ORG-HD-02")
    if code in RENAME:
        name = RENAME[code]; dec = bump(dec, "مالك الإدارة"); why.append("ORG-AF-09")
    if code in DUP:
        why.append("ORG-AF-11")
        if code in DUP_OWNER:
            dec = bump(dec, "مالك الإدارة")
    if code in NAME_NOTE:
        name = NAME_NOTE[code]
    if not why:
        why.append("ORG-AF-06")
    return [code, s["name_ar"], owner, aud, place, name, dec, "، ".join(why)]


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    rows = [build(s) for s in data["services"]]
    assert len(rows) == 142, len(rows)
    kinds = Counter(s["service_kind"] for s in data["services"])
    print("services:", len(rows), dict(kinds))
    print("placement:", dict(Counter(r[4] for r in rows)))
    print("decision:", dict(Counter(r[6] for r in rows)))
    print("placement x decision:", dict(Counter((r[4], r[6]) for r in rows)))
    print("ADM- codes:", sum(r[0].startswith("ADM-") for r in rows))
    if "--md" in sys.argv:
        for i, r in enumerate(rows, 1):
            print("| " + " | ".join([str(i)] + r) + " |")


if __name__ == "__main__":
    main()
