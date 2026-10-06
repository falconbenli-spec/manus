// خريطة الوصول للوحدات — مطابقة لسياسات قاعدة البيانات (RLS)
export const MODULE_ACCESS: Record<string, string[] | "all"> = {
  "/": "all",
  "/me": "all",
  "/workspace": "all",
  "/profile": "all",
  "/help": "all",
  "/notifications": "all",
  "/insights": "all",
  "/growth": ["ceo", "vp", "epmo", "account_manager"],
  "/projects": "all",
  "/campaigns": "all",
  "/tasks": "all",
  "/approvals": "all",
  "/resources": "all",
  "/people": "all",
  "/hr": ["ceo", "vp", "hr", "finance", "employee", "pm", "epmo", "account_manager", "grc"],
  "/performance": "all",
  "/assets": ["ceo", "vp", "hr", "finance", "epmo"],
  "/procurement": ["ceo", "vp", "finance", "epmo", "pm"],
  "/knowledge": "all",
  "/workplace": "all",
  "/finance": ["ceo", "vp", "finance", "epmo", "pm", "account_manager"],
  "/ledger": ["ceo", "vp", "finance", "grc"],
  "/integrations": ["ceo", "vp", "finance"],
  "/bank": ["ceo", "vp", "finance", "grc"],
  "/payroll": ["ceo", "vp", "finance", "hr"],
  "/zatca": ["ceo", "vp", "finance", "grc"],
  "/readiness": ["ceo", "vp", "finance", "grc", "epmo"],



  "/portal": "all",
  "/services": "all",
  "/services/requests": "all",
  "/governance": ["ceo", "vp", "grc", "epmo", "pm"],
  "/report": "all",
  "/benchmark": "all",
  "/admin": ["ceo", "vp"],
  "/security": ["ceo", "vp"],
  "/roles": ["ceo", "vp"],
  "/audit": ["ceo", "vp"],
};

// وحدات لا يمكن سحبها من الرئيس التنفيذي (حماية من الإغلاق الكامل)
export const LOCKED_PERMISSIONS: Record<string, string[]> = {
  "/admin": ["ceo"],
  "/security": ["ceo"],
  "/roles": ["ceo"],
  "/audit": ["ceo"],
};

export const MODULE_LABELS: Record<string, string> = {
  "/": "لوحة القيادة",
  "/me": "يومي",
  "/workspace": "مساحتي",
  "/profile": "ملفي الوظيفي",
  "/help": "دليل الاستخدام",
  "/notifications": "مركز الإشعارات",
  "/insights": "المؤشرات التنفيذية",
  "/growth": "النمو والمبيعات",
  "/projects": "المشاريع",
  "/campaigns": "الحملات",
  "/tasks": "المهام",
  "/approvals": "الاعتمادات",
  "/resources": "سجل الموظفين",
  "/people": "الهيكل التنظيمي",
  "/hr": "الموارد البشرية",
  "/performance": "الأداء والأهداف",
  "/assets": "الأصول والعهد",
  "/procurement": "المشتريات",
  "/knowledge": "قاعدة المعرفة",
  "/workplace": "القاعات والحجوزات",
  "/finance": "المالية",
  "/ledger": "دفتر الأستاذ العام",
  "/integrations": "التكامل مع الأنظمة",
  "/bank": "التسوية البنكية",
  "/payroll": "الرواتب والتأمينات",
  "/zatca": "الفاتورة الإلكترونية",
  "/readiness": "جاهزية الاستغناء",

  "/portal": "بوابة الموظف",
  "/services": "كتالوج الخدمات",
  "/services/requests": "طلبات الخدمة",
  "/governance": "الحوكمة والمخاطر",
  "/report": "التقرير التفصيلي",
  "/benchmark": "المقارنة المرجعية",
  "/admin": "إدارة المستخدمين",
  "/security": "إعدادات الأمان",
  "/roles": "الأدوار والصلاحيات",
  "/audit": "سجل التدقيق",
};

export const MODULE_KEYS = Object.keys(MODULE_ACCESS);

// صلاحيات محمّلة من قاعدة البيانات (module -> roles) — تتجاوز الخريطة الثابتة عند توفرها
export type PermissionMap = Record<string, string[]>;
let OVERRIDES: PermissionMap | null = null;

export function setPermissionOverrides(map: PermissionMap | null) {
  OVERRIDES = map && Object.keys(map).length ? map : null;
}

export function getPermissionOverrides(): PermissionMap | null {
  return OVERRIDES;
}

export function canAccessWith(path: string, roles: string[], overrides?: PermissionMap | null): boolean {
  const map = overrides ?? OVERRIDES;
  if (map && map[path]) return map[path]!.some((r) => roles.includes(r));
  const rule = MODULE_ACCESS[path];
  if (!Object.hasOwn(MODULE_ACCESS, path)) return false;
  if (rule === "all") return true;
  return rule.some((r) => roles.includes(r));
}

export function canAccess(path: string, roles: string[]): boolean {
  return canAccessWith(path, roles);
}

export function accessReason(path: string, roles: string[], overrides?: PermissionMap | null): string {
  const map = overrides ?? OVERRIDES;
  if (map && map[path]) {
    const allowed = map[path]!;
    const hit = allowed.filter((r) => roles.includes(r));
    if (hit.length) return `مسموح عبر مصفوفة الصلاحيات — الدور: ${hit.join("، ")}`;
    return allowed.length
      ? `مرفوض — الوحدة متاحة فقط للأدوار: ${allowed.join("، ")}`
      : "مرفوض — لا يوجد أي دور مسموح لهذه الوحدة";
  }
  const rule = MODULE_ACCESS[path];
  if (!Object.hasOwn(MODULE_ACCESS, path)) return "مرفوض — الوحدة غير معروفة ولا توجد سياسة وصول";
  if (rule === "all") return "وحدة عامة لكل المستخدمين المسجّلين";
  const hit = rule.filter((r) => roles.includes(r));
  return hit.length
    ? `مسموح عبر الخريطة الثابتة — الدور: ${hit.join("، ")}`
    : `مرفوض — الوحدة متاحة فقط للأدوار: ${rule.join("، ")}`;
}
