#!/usr/bin/env python3
"""T0.2: build docs/org/nav-mapping.md from the inventory navigation (15 distinct menus, 28 accounts).

Every current sidebar entry is mapped by the rules r1..r9 of IA_NAVIGATION_SPEC 2.4-d,
with the precedence of PROMPT_ORG_REFORM 1.2 section 2.1 (the prompt wins on conflict).
"After" counts are an ESTIMATE computed from this table, not from running menu code.
No modified menu code is written.

Usage: python3 docs/org/scripts/build_nav_mapping.py [--check]
"""
import json
import os
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ORG = os.path.dirname(HERE)
INV = json.load(open(os.path.join(ORG, "data", "inventory_data.json"), encoding="utf-8"))
DEPT = {d["id"]: d["name"] for d in INV["departments"]}
NO_PAGE = {"ops"}  # owns no service and no queue (CATALOG_GOVERNANCE 0, improvement 6)

ME = "مساحتي"
# Destination kinds
E = "entry"      # a sidebar entry of its own (in the fixed budget)
P = "profile"    # section inside «ملفي»
PEND = "pending" # «بانتظار إجرائي»
REQ = "requests" # «طلباتي»
TEAM = "team"    # «فريقي»
SVC = "services" # «الخدمات»
ORGN = "org"     # «المنظمة»
TOOL = "tool"    # «أدوات الإدارة» in a department page
REP = "report"   # «التقارير» in a department page
ADMIN = "admin"  # «إدارة المنصة»
INTERNAL = "internal"

# key -> (kind, target, stable label, rule, owner dept for TOOL/REP, shared tool?)
M = {
    "home": (E, "مساحتي › الرئيسية", "الرئيسية", "—", None, False),
    "inbox": (E, "مساحتي › بانتظار إجرائي (قرارات)", "بانتظار إجرائي", "ر3", None, False),
    "work": (PEND, "مساحتي › بانتظار إجرائي (مهام)", "بانتظار إجرائي", "ر3", None, False),
    "my-requests": (E, "مساحتي › طلباتي", "طلباتي", "ر1", None, False),
    "notifications": (E, "مساحتي › الإشعارات", "الإشعارات", "—", None, False),
    "announcements": (ORGN, "المنظمة › الإعلانات", "الإعلانات", "ر6", None, False),
    "attendance": (P, "ملفي › وقتي › حضوري", "حضوري", "ر1", None, False),
    "leave": (P, "ملفي › وقتي › إجازاتي", "إجازاتي", "ر1", None, False),
    "time": (P, "ملفي › وقتي › ساعاتي", "ساعاتي", "ر1", None, False),
    "expenses": (REQ, "طلباتي (مطالباتي بالمصروفات والعهد)، والتقديم من «الخدمات»", "مصروفاتي وعهدي", "ر1، ر2", None, False),
    "letters": (P, "ملفي › خطاباتي", "خطاباتي", "ر1", None, False),
    "resignations": (SVC, "الخدمات › تقديم استقالة وإخلاء طرف، ومتابعتها في طلباتي", "الاستقالة", "ر2", None, False),
    "travel": (P, "ملفي › وقتي › الانتداب", "الانتداب", "ر1", None, False),
    "contracts": (P, "ملفي › عقدي وراتبي", "عقدي وراتبي", "ر1", None, False),
    "payroll": (P, "ملفي › قسائمي", "قسائمي", "ر1", None, False),
    "profile": (P, "ملفي › بياناتي (الصفحة الجامعة نفسها)", "ملفي", "ر1", None, False),
    "my-benefits": (P, "ملفي › مزاياي", "مزاياي", "ر1", None, False),
    "hr-cases": (SVC, "الخدمات › تقديم شكوى أو تظلم سري، ومتابعتها في طلباتي", "الشكاوى والاستفسارات", "ر2", None, False),
    "my-discipline": (P, "ملفي › مخالفاتي", "مخالفاتي", "ر1", None, False),
    "policy-library": (ORGN, "المنظمة › السياسات", "مكتبة السياسات", "ر6", None, False),
    "policy-assistant": (ORGN, "المنظمة › السياسات › اسأل عن السياسة", "اسأل عن السياسة", "ر6", None, False),
    "policy-acknowledgements": (ORGN, "المنظمة › السياسات › ما ينتظر إقراري، ويظهر عنصرًا في «بانتظار إجرائي»", "السياسات المطلوب إقرارها", "ر6، ر3", None, False),
    "pulse": (P, "ملفي › مشاركتي › النبض", "النبض", "ر1", None, False),
    "recognition": (P, "ملفي › مشاركتي › التقدير", "التقدير", "ر1", None, False),
    "one-to-ones": (P, "ملفي › مشاركتي › اللقاءات الفردية", "اللقاءات الفردية", "ر1", None, False),
    "feedback": (P, "ملفي › مشاركتي › ملاحظات الزملاء", "ملاحظات الزملاء", "ر1", None, False),
    "security": (P, "ملفي › إعدادات الحساب › أمان حسابي", "أمان حسابي", "ر1", None, False),
    "assistants": (P, "ملفي › إعدادات الحساب › المساعدون الذكيون", "المساعدون الذكيون", "ر1", None, False),
    "appearance": (P, "ملفي › إعدادات الحساب › المظهر", "المظهر", "ر1", None, False),
    "notification-settings": (P, "ملفي › إعدادات الحساب › إعدادات الإشعارات", "إعدادات الإشعارات", "ر1", None, False),
    "services": (E, "الخدمات (الباب الواحد)", "الخدمات", "ر2", None, False),
    "catalog": (SVC, "الخدمات (الباب الواحد)؛ #catalog يُحال", "الخدمات", "ر2", None, False),
    "requests": (PEND, "تُقسم بحسب العدسة: ما قدّمتُه في «طلباتي»، وما ينتظر قراري أو تنفيذي في «بانتظار إجرائي»، وطابور إدارتي في «صفحة الإدارة › الطلبات الواردة»، وللمدير «فريقي › طلبات الفريق»", "طلباتي / الطلبات الواردة / طلبات الفريق", "ر1، ر3، ر4، ر5", None, False),
    "departments": (SVC, "الخدمات › حسب الإدارة؛ #departments يُحال و#departments/<id> يبقى", "الخدمات", "ر2", None, False),
    "service-cards": (TOOL, "صفحة الإدارة › الخدمات (وضع الإدارة لمالكها)", "خدمات الإدارة", "ر4", "*own", True),
    "delegations": (TEAM, "فريقي › التفويض المؤقت", "التفويض المؤقت", "ر5", None, False),
    "knowledge": (ADMIN, "إدارة المنصة › الكتالوج › مراجعة المصادر", "مراجعة المصادر", "ر7", None, False),
    "forms": (ADMIN, "إدارة المنصة › الكتالوج › النماذج الإلكترونية", "النماذج الإلكترونية", "ر7، ر9", None, False),
    "centres": (ADMIN, "إدارة المنصة › الكتالوج › المراكز المقترحة (لا مدخل حتى يُسمّى مالكها)", "المراكز التخصصية", "ر7؛ O6", None, False),
    "access-reviews": (ADMIN, "إدارة المنصة › الصلاحيات › مراجعة الصلاحيات", "مراجعة الصلاحيات", "ر7", None, False),
    "integrations": (ADMIN, "إدارة المنصة › التكاملات", "حالة التكاملات", "ر7", None, False),
    "requirements": (ADMIN, "إدارة المنصة › نطاق المنصة", "نطاق المنصة", "ر7", None, False),
    "accounts": (ADMIN, "إدارة المنصة › الموظفون والصلاحيات", "الموظفون والصلاحيات", "ر7", None, False),
    "permissions-matrix": (ADMIN, "إدارة المنصة › الموظفون والصلاحيات › مصفوفة الصلاحيات", "مصفوفة الصلاحيات", "ر7", None, False),
    "ai-governance": (ADMIN, "إدارة المنصة › حوكمة المساعدين", "حوكمة المساعدين", "ر7", None, False),
    "jobs": (ADMIN, "إدارة المنصة › المهام الخلفية", "المهام الخلفية", "ر7", None, False),
    "feature-flags": (ADMIN, "إدارة المنصة › المفاتيح", "مفاتيح الميزات", "ر7", None, False),
    "mail": (ADMIN, "إدارة المنصة › التكاملات › البريد والإشعارات", "البريد والإشعارات", "ر7", None, False),
    "definitions": (ADMIN, "إدارة المنصة › تعريفات الصفحات", "تعريفات الصفحات", "ر7", None, False),
    "catalog-quality": (ADMIN, "إدارة المنصة › الكتالوج › النواقص", "نواقص دليل الخدمات", "ر7", None, False),
    "service-insight": (ADMIN, "إدارة المنصة › الكتالوج › القياس", "قياس الخدمات", "ر7", None, False),
    "service-benchmark": (ADMIN, "إدارة المنصة › الكتالوج › التطوير", "تطوير الخدمات", "ر7", None, False),
    "intake-settings": (ADMIN, "إدارة المنصة › الكتالوج › أولويات الطلبات", "أولويات الطلبات", "ر7", None, False),
    "approval-settings": (ADMIN, "إدارة المنصة › الكتالوج › مسارات الاعتماد", "مسارات الاعتماد", "ر7", None, False),
    "org": (ORGN, "المنظمة › الهيكل التنظيمي", "الهيكل التنظيمي", "ر6", None, False),
    "reports": (REP, "التقارير: كل مجموعة من مجموعات «مركز التقارير» العشر (المالية، والمشتريات، والمشاريع، والحملات، …) إلى «التقارير» في صفحة إدارتها المالكة، وتقارير المنظمة في صفحة مكتب الرئيس التنفيذي؛ ويبقى تصريح كل تقرير (allowed) كما هو", "مركز التقارير", "ر8", "*own", False),
    "executive": (TOOL, "أدوات الإدارة", "اللوحة التنفيذية", "ر4", "ceo-office", False),
    "decisions": (TOOL, "أدوات الإدارة", "القرارات والمحاضر", "ر4", "ceo-office", False),
    "objectives": (TOOL, "أدوات الإدارة", "الأهداف والمبادرات", "ر4", "epmo", False),
    "epmo": (REP, "التقارير", "تقرير الإدارة التنفيذية للمشاريع", "ر8", "epmo", False),
    "compliance": (TOOL, "أدوات الإدارة", "تقويم الالتزامات", "ر4", "grc", False),
    "risks": (TOOL, "أدوات الإدارة", "سجل المخاطر", "ر4", "grc", False),
    "privacy": (TOOL, "أدوات الإدارة", "حماية البيانات", "ر4", "grc", False),
    "subject-requests": (TOOL, "أدوات الإدارة", "طلبات أصحاب البيانات", "ر4", "grc", False),
}
HR_TOOLS = {
    "employees": "السجل الوظيفي", "employee-profile": "ملف الموظف", "expiry": "انتهاء الوثائق",
    "discipline": "المخالفات والجزاءات", "payroll-rules": "قواعد اللائحة في الرواتب", "benefits-admin": "إدارة المزايا",
    "payroll-extras": "حركات الرواتب", "payroll-anomaly": "فحص المسير", "wage-reconciliation": "مطابقة الأجور",
    "wps": "ملف حماية الأجور", "payroll-insurance": "حالات التأمينات", "people": "التوظيف", "lifecycle": "التعيين والمغادرة",
    "clearance": "إخلاء الطرف", "hr-policies": "سياسات الموارد البشرية", "letter-templates": "قوالب الخطابات",
    "workforce": "تركيبة الموظفين", "leave-accrual": "استحقاق الإجازات", "benefits": "التأمين والمزايا",
    "secondment": "الانتداب وبدلاته",
}
FIN_TOOLS = {
    "budgets": "مخصصات المشاريع", "receivables": "مستحقات العملاء", "invoices": "الفواتير الضريبية",
    "billing-schedules": "الفوترة الدورية", "retainers": "اتفاقات الاشتراك", "einvoice": "الفوترة الإلكترونية",
    "payables": "مدفوعات الموردين", "bank-reconciliation": "المطابقة البنكية", "cash-forecast": "التنبؤ النقدي",
    "finance": "الدفتر المالي", "statements": "القوائم المالية", "accruals": "الإطفاء والاستحقاقات",
    "close-checklist": "الإقفال الشهري", "assets": "الأصول الثابتة", "vat-worksheet": "القيمة المضافة والزكاة",
    "withholding": "ضريبة الاستقطاع", "profitability": "الربحية", "cost-rates": "معدلات التكلفة",
    "finance-grants": "التفويض المالي", "pricing": "تسعير المشاريع", "margin-exceptions": "استثناءات التسعير",
}
CONTEXT = {
    "scope": "حارس النطاق", "project-handover": "محضر تسليم المشروع", "project-receipt": "استلام المشروع وبوابته",
    "project-kickoff": "محضر الانطلاق",
}
OWNED = {
    "procurement": ["vendors", "contracts-register", "procurement", "procurement-extras"],
    "business-dev": ["offerings", "pipeline", "estimates", "commercial", "quotations"],
    "accounts": ["clients", "approvals", "client-reports"],
    "marketing": ["campaigns", "content", "media-spend"],
    "pr": ["influencers", "influencer-campaigns", "pr", "media-contacts"],
    "epmo": ["projects", "project-templates", "change-requests", "resourcing"],
    "production": ["call-sheets", "equipment", "studio", "review-rounds", "productions"],
}
# Tools used by several delivery departments: shown in each user's own department page (D-2).
SHARED = {"projects", "change-requests", "clients", "approvals", "client-reports", "campaigns", "content",
          "review-rounds", "studio", "equipment"}
import re as _re
LABELS = {s["key"]: _re.sub(r"\s*\([A-Z]{2,4}-\d+\)", "", s["title"]) for s in INV["screens"]}
for k, lbl in HR_TOOLS.items():
    M[k] = (TOOL, "أدوات الإدارة", lbl, "ر4", "hr", False)
for k, lbl in FIN_TOOLS.items():
    M[k] = (TOOL, "أدوات الإدارة", lbl, "ر4", "finance", False)
for dept, keys in OWNED.items():
    for k in keys:
        M[k] = (TOOL, "أدوات الإدارة", LABELS.get(k, k), "ر4", dept, k in SHARED)
for k, lbl in CONTEXT.items():
    M[k] = ("context", "سياق المشروع: المشاريع › صفحة المشروع (لمن له دور فيه، من إدارات التسليم)", lbl, "ر4؛ البرومبت 2.1 سياق المشروع", None, False)
M["forms"] = ("context", "تعبئة النموذج من صفحة المشروع أو الخدمة التي يتبعها؛ وتصميمه (forms.design) في صفحة الإدارة المالكة للنموذج، وقبوله لمالكه", "النماذج الإلكترونية", "ر2، ر4", None, False)
M["clients"] = (TOOL, "أدوات الإدارة", "العملاء", "ر4", "accounts", True)
# Personal-or-team screens whose owner view goes to a department page.
M["compensation"] = (P, "ملفي › عقدي وراتبي › زياداتي", "زياداتي", "ر1", None, False)
M["performance"] = (P, "ملفي › مشاركتي › تقييم أدائي", "تقييم أدائي", "ر1، ر9", None, False)
M["review-360"] = (P, "ملفي › مشاركتي › تقييم 360", "تقييم 360", "ر1، ر9", None, False)
M["growth"] = (P, "ملفي › مشاركتي › تدريبي وتطوري", "تدريبي وتطوري", "ر1، ر9", None, False)
M["timesheets"] = (P, "ملفي › وقتي › كشفي الأسبوعي", "كشفي الأسبوعي", "ر1", None, False)

# Screens the server opens to anyone with direct reports (app/static/app.mjs:257-270): team lens for
# managers outside HR, HR label on the HR page, personal lens for the rest.
TEAM_VIEW = {
    "employees": ("فريقي › أعضاء الفريق", "أعضاء الفريق", None),
    "employee-profile": ("فريقي › أعضاء الفريق › ملف الموظف", "ملف الموظف", None),
    "discipline": ("فريقي › مخالفات فريقي", "مخالفات فريقي", None),
    "expiry": ("فريقي › وثائق فريقي", "وثائق فريقي", "ملفي › بياناتي › وثائقي المقتربة من الانتهاء"),
}
# Owner/team lens of a dual-label screen: label seen today -> (team lens, department-page lens).
LENS = {
    "attendance": ("الحضور والانصراف", "فريقي › حضور فريقي", "hr", "حضور الموظفين"),
    "leave": ("الإجازات", "فريقي › إجازات فريقي", "hr", "إجازات الموظفين"),
    "expenses": ("المصروفات والعهد النقدية", "بانتظار إجرائي (قرارات المطالبات)", "finance", "المصروفات والعهد"),
    "letters": ("خطابات الموظفين", None, "hr", "خطابات الموظفين"),
    "contracts": ("العقود وبنود الراتب", None, "hr", "العقود وبنود الراتب"),
    "payroll": ("مسير الرواتب", None, "hr", "مسير الرواتب"),
    "hr-cases": ("الحالات السرية", None, "hr", "الحالات السرية"),
    "catalog": ("دليل الخدمات", None, "admin", "الكتالوج › دليل الخدمات"),
    "compensation": ("مراجعة الرواتب", None, "hr", "مراجعة الرواتب"),
    "timesheets": ("اعتماد الساعات", "فريقي › اعتماد الساعات", "epmo", "اعتماد الساعات"),
    "performance": (None, "فريقي › تقييم أداء فريقي", "hr", "تقييم الأداء"),
    "review-360": (None, None, "hr", "تقييم 360"),
    "growth": (None, None, "hr", "التدريب والتطوير"),
    "resignations": (None, None, "hr", "الاستقالات"),
}
# Screens that exist but are not in any menu today.
OFF_MENU = {
    "portal": ("اسم بديل لـ#home؛ يُحال إلى الرئيسية", "داخلية"),
    "request": ("صفحة تفاصيل الطلب؛ تُفتح من طلباتي وبانتظار إجرائي والطابور", "داخلية"),
    "annotations": ("إدارة المنصة › التعليقات وقائمة عمل النسخة التالية", "إدارة المنصة"),
    "search": ("صفحة نتائج البحث الموحد (عرض كل النتائج)", "داخلية"),
    "einvoice-selfcheck": ("صفحة المالية › أدوات الإدارة › الفوترة الإلكترونية › مراجعة الضوابط", "داخلية"),
    "my-request-timeline": ("طلباتي › أين طلباتي", "داخلية"),
    "benefit-extras": ("ملفي › مزاياي › مزايا إضافية", "داخلية"),
}


def dest(key, label, role, own):
    """Return (text, kinds) for one entry of one account: kinds is a list of (kind, dept)."""
    kind, target, stable, rule, owner, shared = M[key]
    lens = LENS.get(key)
    if key in TEAM_VIEW and not (own == "hr" or role == "hr"):
        t, lbl, personal = TEAM_VIEW[key]
        if role == "manager":
            return f"{t}؛ ورؤية الإدارة: صفحة رأس المال البشري › أدوات الإدارة › {M[key][2]}", lbl, "ر5", [(TEAM, None)]
        if personal:
            return personal, "وثائقي", "ر1", [(P, None)]
    if kind == "context":
        return target, stable, rule, [(kind, None)]
    if kind in (TOOL, REP) and own in NO_PAGE and owner == "*own":
        alt = NOPAGE_ALT[key]
        return alt[0], alt[1], alt[2], [alt[3]]
    if kind in (TOOL, REP):
        d = own if (owner == "*own" or (shared and own in OWNING_SHARED.get(key, set()))) else owner
        if d in NO_PAGE or d is None:
            d = owner if owner not in ("*own", None) else None
        assert d, f"no department page resolved for {key} ({role}, {own})"
        where = f"صفحة {DEPT[d]} › {'التقارير' if kind == REP else target}"
        return where, stable, rule, [(kind, d)]
    if lens and lens[0] and label == lens[0]:
        team, dept, dlabel = lens[1], lens[2], lens[3]
        if dept == "admin":
            return f"إدارة المنصة › {dlabel}", dlabel, "ر7", [(ADMIN, None)]
        if own == dept or (role == "hr" and dept == "hr") or (role == "manager" and own == dept):
            return f"{target}؛ ورؤية الإدارة: صفحة {DEPT[dept]} › أدوات الإدارة › {dlabel}", dlabel, "ر1، ر4", [(kind, None), (TOOL, dept)]
        if team and role in ("manager", "pm"):
            if key == "timesheets" and role == "pm":
                return f"صفحة {DEPT['epmo']} › أدوات الإدارة › اعتماد الساعات (سياق المشروع)", "اعتماد الساعات", "ر4", [(TOOL, "epmo")]
            return f"{target}؛ و{team}", stable, "ر1، ر5", [(kind, None), (TEAM, None)]
        return f"{target}؛ ورؤية الإدارة: صفحة {DEPT[dept]} › أدوات الإدارة › {dlabel}", dlabel, "ر1، ر4", [(kind, None), (TOOL, dept)]
    if key == "delegations" and role != "manager":
        return "ملفي › تفويضاتي (لا «فريقي» لهذا الحساب؛ بند مفتوح)", "تفويضاتي", "ر1، ر9", [(P, None)]
    if kind == ADMIN and role != "admin":
        alt = ADMIN_ALT.get(key)
        return alt[0], alt[1], alt[2], [alt[3]]
    return target, stable, rule, [(kind, None)]


# Accounts whose department has no page (ops): a named place instead of "own department".
NOPAGE_ALT = {
    "service-cards": ("إدارة المنصة › الكتالوج › البطاقات", "البطاقات", "ر7", (ADMIN, None)),
    "reports": ("صفحة مكتب الرئيس التنفيذي › التقارير (تقارير المنظمة)، ومجموعات التقارير الأخرى في صفحات إداراتها", "مركز التقارير", "ر8", (REP, "ceo-office")),
    "knowledge": ("إدارة المنصة › الكتالوج › مراجعة المصادر", "مراجعة المصادر", "ر7", (ADMIN, None)),
    "catalog-quality": ("إدارة المنصة › الكتالوج › النواقص", "نواقص دليل الخدمات", "ر7", (ADMIN, None)),
    "service-insight": ("إدارة المنصة › الكتالوج › القياس", "قياس الخدمات", "ر7", (ADMIN, None)),
    "service-benchmark": ("إدارة المنصة › الكتالوج › التطوير", "تطوير الخدمات", "ر7", (ADMIN, None)),
}
# Non-admin accounts reaching a platform screen today: the named new place (prompt 2.1, «لا يُفقد وصول»).
ADMIN_ALT = {
    "access-reviews": ("فريقي › مراجعة صلاحيات فريقي (حملات المراجعة المسندة إليّ)، وعناصرها في «بانتظار إجرائي»", "مراجعة صلاحيات فريقي", "ر5، ر3", (TEAM, None)),
    "integrations": ("صفحة تقنية المعلومات › أدوات الإدارة › حالة التكاملات (قراءة)", "حالة التكاملات", "ر4، ر9", (TOOL, "it")),
    "permissions-matrix": ("صفحة الإدارة › الفريق › المستويات (لحامل department.levels.manage)", "مستويات الإدارة", "ر4", (TOOL, "*own")),
    "requirements": ("صفحة مكتب الرئيس التنفيذي › التقارير › نطاق المنصة (قراءة)", "نطاق المنصة", "ر8", (REP, "ceo-office")),
    "knowledge": ("صفحة الإدارة › الخدمات (وضع الإدارة) › مراجعة المصادر", "مراجعة المصادر", "ر4", (TOOL, "*own")),
    "centres": ("لا مدخل حتى يُسمّى مالك المراكز (O6)؛ خدماتها الـ26 في صفحات إداراتها المالكة", "المراكز التخصصية", "ر4؛ O6", (INTERNAL, None)),
    "catalog-quality": ("صفحة الإدارة › الخدمات (وضع الإدارة) › النواقص", "نواقص خدمات الإدارة", "ر4", (TOOL, "*own")),
    "service-insight": ("صفحة الإدارة › التقارير › قياس خدمات الإدارة", "قياس خدمات الإدارة", "ر8", (REP, "*own")),
    "service-benchmark": ("صفحة الإدارة › الخدمات (وضع الإدارة) › تطوير الخدمات", "تطوير خدمات الإدارة", "ر4", (TOOL, "*own")),
}
# Departments where a shared tool is shown in the user's own page.
DELIVERY = {"accounts", "brand", "creative", "business-dev", "campaigns-audit", "marketing", "pr", "production", "epmo"}
OWNING_SHARED = {k: DELIVERY for k in SHARED}


def after_count(entries, role, own):
    kinds = []
    for e in entries:
        _, _, _, ks = dest(e["key"], e["label"], role, own)
        kinds += ks
    depts = set()
    if own not in NO_PAGE:
        depts.add(own)
    for k, d in kinds:
        if k in (TOOL, REP) and d not in (None, "*own"):
            depts.add(d)
    has_team = role == "manager" or any(k == TEAM for k, _ in kinds)
    base = 5 + (1 if has_team else 0) + 1 + 1 + (1 if role == "admin" else 0)
    n_strict = base + len(depts)
    n_switch = base + (0 if own in NO_PAGE else 1)
    return n_strict, sorted(depts - {own}), has_team, n_switch


BUDGET = {"employee": 8, "hr": 8, "it": 8, "pm": 8, "manager": 9, "admin": 9}


def main():
    variants = []
    for role, lst in INV["navigation"].items():
        for i, v in enumerate(lst):
            variants.append((f"{role}-{i + 1}", role, v))
    out = ["# خريطة التنقل «من ← إلى» (ت0.2)", "",
           "> مولّدة آليًا بـ`docs/org/scripts/build_nav_mapping.py` من الجرد (`f34b3dc`). الخريطة لكل قائمة من القوائم الـ15 المختلفة، لا لكل دور.",
           "> **أعداد «بعد» تقدير** محسوب من جدول الربط بقواعد IA §2.4-د وترتيب البرومبت §2.1، ولم يُشغَّل كود قائمة معدّل (لم يُكتب).",
           "> قاعدة «فريقي»: يُحسب لحساب `manager` أو لمن يصل اليوم إلى شاشة عدسة فريق. علاقة الإشراف لم تُقس (تقدير).",
           "> «تشغيل المنصة» لا صفحة لها (لا خدمات ولا طابور)، فحسابات `ops` بلا مدخل إدارة أساسية، ولشاشاتها موضع مسمّى في «إدارة المنصة» أو صفحة مكتب الرئيس التنفيذي.",
           "> **حدود التقدير:** خط الأساس «ما يصله الحساب اليوم» مأخوذ من مدخلات القائمة، وبعضها علم ظهور لا تصريح خادم (مثل `equipment` و`call-sheets`: القائمة تظهرها، والخادم يرد 403 بلا `equipment.manage`). فبعد-أ يبالغ. وفي ت1 يُبنى خط الأساس من بوابات الخادم. ولا يقيس التقدير مجموعات التعاون ولا أدوار التنفيذ في إدارات أخرى.", ""]
    # Summary table
    out += ["## 1. قبل وبعد لكل قائمة (بعد = تقدير)", "",
            "- **بعد-أ (الحرفي):** مدخل لكل إدارة يصل الحساب اليوم إلى أداة من أدواتها بتصريحه، تطبيقًا حرفيًا لـ«لا يُفقد وصول» مع «مدخل لكل إدارة إضافية».",
            "- **بعد-ب (الموصى به):** مدخل لإدارة الحساب وحدها؛ وأدوات الإدارات الأخرى التي يصلها بتصريح (لا بعضوية ولا دور) تُبلغ من «الخدمات» › شريط الإدارات › صفحة الإدارة، حيث تظهر «أدوات الإدارة» بالتصاريح القائمة (البرومبت §5 النطاق 3). المسار: الرئيسية › الخدمات › الإدارة في الشريط › الأداة، أي ثلاث نقرات إلى أربع.",
            "- **تعارض يحسمه تركي:** بعد-ب يستند إلى البرومبت §5 النطاق 3 («تعرض ما تسمح به الصلاحيات القائمة»)، والبرومبت §2.1 يقول «غير العضو يرى قسم «الخدمات» وحده». إن غلب §2.1 صار كل وصول عابر للإدارات في بعد-ب وصولًا مفقودًا. والمواصفة §2.4-أ (سطر الأدمن) تسند قراءة التصريح.",
            "",
            "| القائمة | الدور | حسابات | قبل | بعد-أ (تقدير) | بعد-ب (تقدير) | الحد | إدارات أخرى يصل أدواتها اليوم | بعد-أ ضمن 12؟ | بعد-ب ضمن الحد؟ |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    summary = []
    for name, role, v in variants:
        res = [after_count(v["entries"], role, own) for own in v["departments"]]
        lo, hi = min(r[0] for r in res), max(r[0] for r in res)
        blo, bhi = min(r[3] for r in res), max(r[3] for r in res)
        extra = sorted({DEPT[x] for r in res for x in r[1] if x in DEPT})
        cap = BUDGET[role]
        worst_extra = max(len(r[1]) for r in res)
        ok = "نعم" if hi <= min(12, cap + worst_extra) and hi <= 12 else ("يتجاوز 12" if hi > 12 else "نعم بالإضافات")
        if hi <= cap:
            ok = "نعم"
        elif hi <= 12:
            ok = "نعم بالإضافات"
        else:
            ok = "لا: يتجاوز 12"
        after = f"{lo}" if lo == hi else f"{lo}–{hi}"
        after_b = f"{blo}" if blo == bhi else f"{blo}–{bhi}"
        ok_b = "نعم" if bhi <= cap else "لا"
        ok_a = "نعم" if hi <= 12 else "لا"
        summary.append((name, role, v["accounts"], len(v["entries"]), after, cap, extra, ok_a, after_b, ok_b))
        out.append(f"| {name} | `{role}` | {v['accounts']} | {len(v['entries'])} | {after} | {after_b} | {cap} | {'، '.join(extra) or '—'} | {ok_a} | {ok_b} |")
    out.append("")
    over = [s for s in summary if s[7] == "لا"]
    over_b = [s for s in summary if s[9] == "لا"]
    out.append(f"**بعد-أ:** {len(over)} قائمة من {len(summary)} تتجاوز السقف المطلق 12. السبب أن القائمة اليوم تُبنى من التصاريح، فحساب المدير يصل إلى أدوات إدارات كثيرة ليس عضوًا فيها. **بعد-ب:** {len(over_b)} قائمة تتجاوز حد دورها. الاختيار بينهما بند للاعتماد (ب-تنقل-1).")
    out.append("")

    # Per-key mapping
    all_keys = OrderedDict()
    for name, role, v in variants:
        for e in v["entries"]:
            all_keys.setdefault(e["key"], {"labels": Counter(), "groups": set(), "menus": []})
            all_keys[e["key"]]["labels"][e["label"]] += 1
            all_keys[e["key"]]["groups"].add(e["group"])
            all_keys[e["key"]]["menus"].append(name)
    out += ["## 2. جدول الربط لكل مدخل حالي (142 مفتاحًا)", "",
            "الموضع لكل مفتاح بحسب عدسته. «الإحالة» = العنوان القديم الذي يُحال إلى الموضع الجديد.", "",
            "| المفتاح | التسمية اليوم | المجموعة اليوم | القاعدة | الموضع الجديد | التسمية الثابتة | الإحالة من | عدد القوائم |",
            "|---|---|---|---|---|---|---|---|"]
    for k, info in all_keys.items():
        kind, target, stable, rule, owner, shared = M[k]
        if kind in (TOOL, REP):
            if owner == "*own":
                where = "صفحة إدارة المستخدم › " + ("التقارير" if kind == REP else target)
            elif shared:
                where = f"صفحة {DEPT[owner]} › {target}؛ وتظهر في صفحة إدارة المستخدم من إدارات التسليم (مشتركة)"
            else:
                where = f"صفحة {DEPT[owner]} › " + ("التقارير" if kind == REP else target)
        else:
            where = target
        lens = LENS.get(k)
        if lens and lens[3]:
            dl = "إدارة المنصة" if lens[2] == "admin" else f"صفحة {DEPT[lens[2]]} › أدوات الإدارة"
            where += f"؛ عدسة الإدارة: {dl} › «{lens[3]}»"
            if lens[1]:
                where += f"؛ عدسة المدير: {lens[1]}"
        if kind == ADMIN and k in ADMIN_ALT:
            where += f"؛ لغير الأدمن: {ADMIN_ALT[k][0]}"
        if k == "delegations":
            where += "؛ لمن لا «فريقي» له: ملفي › تفويضاتي (بند مفتوح)"
        route = f"`#{k}`" if k not in ("home",) else "— (يبقى)"
        labels = " / ".join(info["labels"])
        out.append(f"| `{k}` | {labels} | {'، '.join(sorted(info['groups']))} | {rule} | {where} | {stable} | {route} | {len(info['menus'])} |")
    out.append("")

    # Screens
    nav_keys = set(all_keys)
    out += ["## 3. الشاشات الـ149 ومكان كل منها", "",
            "142 شاشة لها مدخل اليوم (جدول القسم 2)، و7 خارج القائمة. هنا الشاشات السبع، وكل شاشة من الـ142 موضعها في القسم 2.", "",
            "| الشاشة | العنوان | النوع | المكان بعد التغيير | الوسم |", "|---|---|---|---|---|"]
    kinds = Counter()
    for s in INV["screens"]:
        if s["key"] in nav_keys:
            kinds["لها موضع في القائمة الجديدة أو داخل صفحة"] += 1
            continue
        place, tag = OFF_MENU[s["key"]]
        kinds[tag] += 1
        out.append(f"| `{s['key']}` | {s['title']} | {s['kind']} | {place} | {tag} |")
    out.append("")
    out.append("**العدّ:** " + "، ".join(f"{k}: {v}" for k, v in kinds.items()) + f". المجموع {sum(kinds.values())}.")
    out.append("")

    # Non-admin platform screens
    out += ["## 4. شاشات يصلها اليوم غير الأدمن وتنتقل إلى «إدارة المنصة»", "",
            "«إدارة المنصة» للأدمن وحده، فلكل شاشة منها موضع مسمّى لغيره.", "",
            "| الشاشة | القوائم التي تصلها من غير الأدمن | موضعها لغير الأدمن |", "|---|---|---|"]
    for k, info in all_keys.items():
        if M[k][0] != ADMIN:
            continue
        menus = [m for m in info["menus"] if not m.startswith("admin")]
        if menus:
            out.append(f"| `{k}` {M[k][2]} | {'، '.join(menus)} | {ADMIN_ALT[k][0]} |")
    out.append("")

    # Per menu detail
    out += ["## 5. التفصيل لكل قائمة", ""]
    for name, role, v in variants:
        own = v["departments"][0]
        out += [f"### {name} (`{role}`، {v['accounts']} حساب، إدارات: {'، '.join(DEPT[d] for d in v['departments'])})", "",
                f"قبل: {len(v['entries'])} مدخلًا. التفصيل محسوب لحساب من إدارة «{DEPT[own]}».", "",
                "| المدخل اليوم | المجموعة | الموضع الجديد | التسمية الثابتة | القاعدة |", "|---|---|---|---|---|"]
        for e in v["entries"]:
            where, stable, rule, _ = dest(e["key"], e["label"], role, own)
            out.append(f"| {e['label']} | {e['group']} | {where} | {stable} | {rule} |")
        out.append("")

    out += ["## 6. بنود مفتوحة من هذه الخريطة", "",
            "1. **ب-تنقل-1:** بعد-أ أم بعد-ب (القسم 1). التوصية بعد-ب: مدخل الإدارة للعضوية أو الدور وحدهما كما في البرومبت §2.1، وأدوات الإدارات الأخرى المتاحة بالتصريح تُبلغ من شريط الإدارات. ويُراجع في ت2أ هل كل تصريح عابر للإدارات مقصود.",
            "2. **ب-تنقل-2:** «التفويض المؤقت» شاشة شخصية (يفوّض صاحبها اعتماده، `delegations.mjs`). البرومبت يضعها في «فريقي»، فيراها غير المديرين في «ملفي › تفويضاتي»، وهذا يخالف قاعدة التسمية الثابتة. التوصية: موضع واحد للجميع «ملفي › تفويضاتي».",
            "3. **ب-تنقل-3:** تقييم الأداء و360 والتطوير للموظف: لا قسم لها في «ملفي» في البرومبت؛ الخريطة تضعها في «مشاركتي» (ر9).",
            "4. **ب-تنقل-4:** «النماذج الإلكترونية» و«حالة التكاملات» لغير الأدمن: موضعهما يثبته فحص الشاشة في ت1 (ر9).",
            "5. **ب-تنقل-5:** «مصروفاتي وعهدي» ليس في أقسام «ملفي» في البرومبت؛ الخريطة تضعه في «طلباتي» والتقديم من «الخدمات».",
            "6. **ب-تنقل-6:** مسارات تنقسم بحسب العدسة (`#leave` و`#attendance` و`#expenses` و`#letters` و`#payroll` و`#contracts` و`#hr-cases` و`#timesheets` و`#compensation` و`#performance` و`#requests` و`#catalog` و`#delegations`) لها وجهتان أو ثلاث. التوصية لمعيار ق-ت1-3: يُحال المسار القديم إلى العدسة التي كان الحساب يراها بتسميته اليوم، والتسمية اليوم مسجّلة لكل قائمة في القسم 5.",
            ""]
    text = "\n".join(out) + "\n"
    path = os.path.join(ORG, "nav-mapping.md")
    if "--check" in sys.argv:
        ok = open(path, encoding="utf-8").read() == text
        print("up to date" if ok else "STALE"); sys.exit(0 if ok else 1)
    open(path, "w", encoding="utf-8").write(text)
    json.dump([dict(zip(["menu", "role", "accounts", "before", "after_a_estimate", "budget", "extra_departments", "a_within_12", "after_b_estimate", "b_within_budget"], s)) for s in summary],
              open(os.path.join(ORG, "data", "nav-mapping.summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for s in summary:
        print(s[0], s[3], "-> A", s[4], s[7], "| B", s[8], s[9], "cap", s[5])
    print("screens:", dict(kinds))


if __name__ == "__main__":
    main()
