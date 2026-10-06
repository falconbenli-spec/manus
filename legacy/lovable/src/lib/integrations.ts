import { supabase } from "@/integrations/supabase/client";
import type { Row } from "@/lib/db";

/* ============ CSV ============ */

/** قارئ CSV يدعم علامات التنصيص والفواصل داخل الحقول */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = (rows[0] ?? []).map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
}

/* ============ IMPORT SPECS ============ */

type FieldType = "text" | "number" | "date" | "bool";

export type ImportField = {
  column: string;
  label: string;
  type?: FieldType;
  required?: boolean;
};

export type ImportSpec = {
  id: string;
  label: string;
  table: string;
  systems: string[];
  keyColumn: string;
  fields: ImportField[];
  /** يحوّل عمود بريد/اسم الموظف إلى employee_id */
  employeeLookup?: boolean;
  note: string;
};

export const IMPORT_SPECS: ImportSpec[] = [
  {
    id: "chart_of_accounts",
    label: "دليل الحسابات",
    table: "chart_of_accounts",
    systems: ["SAP", "Oracle"],
    keyColumn: "code",
    note: "يُستلم من SAP أو Oracle لمطابقة أرقام الحسابات قبل ترحيل أي قيد.",
    fields: [
      { column: "code", label: "رمز الحساب", required: true },
      { column: "name", label: "اسم الحساب", required: true },
      { column: "account_type", label: "التصنيف (أصول/خصوم/حقوق ملكية/إيرادات/مصروفات)", required: true },
      { column: "parent_code", label: "الحساب الأب" },
    ],
  },
  {
    id: "cost_centers",
    label: "مراكز التكلفة",
    table: "cost_centers",
    systems: ["SAP", "Oracle"],
    keyColumn: "code",
    note: "مراكز التكلفة المعتمدة في النظام المالي القائم.",
    fields: [
      { column: "code", label: "رمز مركز التكلفة", required: true },
      { column: "name", label: "الاسم", required: true },
      { column: "manager", label: "المسؤول" },
    ],
  },
  {
    id: "vendors",
    label: "الموردون",
    table: "vendors",
    systems: ["SAP", "Oracle"],
    keyColumn: "name",
    note: "سجل الموردين المؤهلين — يمنع تكرار المورد بنفس الاسم.",
    fields: [
      { column: "name", label: "اسم المورّد", required: true },
      { column: "category", label: "الفئة" },
      { column: "rating", label: "التقييم", type: "number" },
      { column: "status", label: "الحالة" },
    ],
  },
  {
    id: "accounts",
    label: "الحسابات والعملاء",
    table: "accounts",
    systems: ["Zoho"],
    keyColumn: "name",
    note: "هجرة حسابات العملاء من Zoho CRM.",
    fields: [
      { column: "name", label: "اسم الحساب", required: true },
      { column: "sector", label: "القطاع" },
      { column: "owner_name", label: "مدير الحساب" },
      { column: "health", label: "الصحة" },
      { column: "status", label: "الحالة" },
      { column: "annual_value", label: "القيمة السنوية", type: "number" },
    ],
  },
  {
    id: "leads",
    label: "القادة المحتملون",
    table: "leads",
    systems: ["Zoho"],
    keyColumn: "name",
    note: "هجرة القادة من Zoho CRM.",
    fields: [
      { column: "name", label: "الاسم", required: true },
      { column: "company", label: "الجهة" },
      { column: "source", label: "المصدر" },
      { column: "status", label: "الحالة" },
      { column: "owner_name", label: "المالك" },
      { column: "est_value", label: "القيمة المتوقعة", type: "number" },
    ],
  },
  {
    id: "opportunities",
    label: "الفرص",
    table: "opportunities",
    systems: ["Zoho"],
    keyColumn: "title",
    note: "هجرة الفرص من Zoho CRM مع المرحلة والاحتمالية.",
    fields: [
      { column: "title", label: "عنوان الفرصة", required: true },
      { column: "stage", label: "المرحلة" },
      { column: "value", label: "القيمة", type: "number" },
      { column: "probability", label: "الاحتمالية %", type: "number" },
      { column: "owner_name", label: "المالك" },
      { column: "close_date", label: "تاريخ الإغلاق", type: "date" },
    ],
  },
  {
    id: "leave_balances",
    label: "أرصدة الإجازات",
    table: "leave_balances",
    systems: ["Jisr"],
    keyColumn: "employee_key",
    employeeLookup: true,
    note: "أرصدة الإجازات من جسر — يُطابق الموظف بالبريد أو الاسم الكامل.",
    fields: [
      { column: "employee_key", label: "بريد أو اسم الموظف", required: true },
      { column: "leave_type", label: "نوع الإجازة", required: true },
      { column: "year", label: "السنة", type: "number" },
      { column: "entitled", label: "المستحق", type: "number" },
      { column: "used", label: "المستخدم", type: "number" },
      { column: "carried", label: "المرحّل", type: "number" },
    ],
  },
  {
    id: "payslips",
    label: "مسيّرات الرواتب",
    table: "payslips",
    systems: ["Jisr"],
    keyColumn: "employee_key",
    employeeLookup: true,
    note: "مسيّرات الرواتب من جسر — تُعرض للموظف والمالية فقط.",
    fields: [
      { column: "employee_key", label: "بريد أو اسم الموظف", required: true },
      { column: "period", label: "الفترة (2026-08)", required: true },
      { column: "basic", label: "الأساسي", type: "number" },
      { column: "allowances", label: "البدلات", type: "number" },
      { column: "deductions", label: "الخصومات", type: "number" },
      { column: "net", label: "الصافي", type: "number" },
      { column: "status", label: "الحالة" },
    ],
  },
];

export const specById = (id: string) => IMPORT_SPECS.find((s) => s.id === id);

export function csvTemplate(spec: ImportSpec) {
  const head = spec.fields.map((f) => f.column).join(",");
  const sample = spec.fields.map((f) => (f.type === "number" ? "0" : "")).join(",");
  return `${head}\n${sample}`;
}

/* ============ EXPORT SPECS (دفع للأنظمة الخارجية) ============ */

export type ExportSpec = {
  id: string;
  label: string;
  systems: string[];
  note: string;
  columns: string[];
  build: () => Promise<(string | number)[][]>;
};

const rows = async (table: string, select = "*") => {
  const { data, error } = await supabase.from(table as never).select(select);
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
};

export const EXPORT_SPECS: ExportSpec[] = [
  {
    id: "gl_journal",
    label: "قيود اليومية المُرحّلة",
    systems: ["SAP", "Oracle"],
    note: "ملف قيود جاهز للتحميل في دفتر الأستاذ الخارجي — القيود المُرحّلة فقط.",
    columns: ["entry_no", "entry_date", "account_code", "cost_center_code", "debit", "credit", "description", "memo"],
    build: async () => {
      const entries = await rows("journal_entries");
      const lines = await rows("journal_lines");
      const posted = new Map(entries.filter((e) => e["status"] === "مرحّل").map((e) => [String(e["id"]), e]));
      return lines
        .filter((l) => posted.has(String(l["entry_id"])))
        .map((l) => {
          const e = posted.get(String(l["entry_id"]))!;
          return [
            String(e["entry_no"] ?? ""),
            String(e["entry_date"] ?? ""),
            String(l["account_code"] ?? ""),
            String(l["cost_center_code"] ?? ""),
            Number(l["debit"] ?? 0),
            Number(l["credit"] ?? 0),
            String(e["description"] ?? ""),
            String(l["memo"] ?? ""),
          ];
        });
    },
  },
  {
    id: "approved_pos",
    label: "أوامر الشراء المعتمدة",
    systems: ["SAP", "Oracle"],
    note: "أوامر الشراء المعتمدة في المنصة لتنفيذها في نظام المشتريات الخارجي.",
    columns: ["number", "amount", "status", "order_date", "received_at"],
    build: async () => {
      const list = await rows("purchase_orders");
      return list.map((p) => [
        String(p["number"] ?? ""),
        Number(p["amount"] ?? 0),
        String(p["status"] ?? ""),
        String(p["order_date"] ?? ""),
        String(p["received_at"] ?? ""),
      ]);
    },
  },
  {
    id: "approved_expenses",
    label: "المصروفات المعتمدة",
    systems: ["SAP", "Oracle"],
    note: "المصروفات المعتمدة فقط، جاهزة للقيد في النظام المالي الخارجي.",
    columns: ["description", "amount", "status", "spend_date"],
    build: async () => {
      const list = await rows("expenses");
      return list
        .filter((e) => ["معتمد", "مدفوعة"].includes(String(e["status"])))
        .map((e) => [
          String(e["description"] ?? ""),
          Number(e["amount"] ?? 0),
          String(e["status"] ?? ""),
          String(e["spend_date"] ?? ""),
        ]);
    },
  },
  {
    id: "approved_leaves",
    label: "طلبات الإجازة المعتمدة",
    systems: ["Jisr"],
    note: "طلبات الإجازة المعتمدة في المنصة لتحديث أرصدة جسر.",
    columns: ["title", "service_code", "status", "created_at"],
    build: async () => {
      const list = await rows("service_requests");
      return list
        .filter((r) => String(r["status"]) === "مقدّم" || String(r["status"]) === "مكتمل")
        .filter((r) => String(r["service_code"] ?? "").includes("LEAVE") || String(r["title"] ?? "").includes("إجازة"))
        .map((r) => [
          String(r["title"] ?? ""),
          String(r["service_code"] ?? ""),
          String(r["status"] ?? ""),
          String(r["created_at"] ?? "").slice(0, 10),
        ]);
    },
  },
];

/* ============ IMPORT RUNNER ============ */

export type ImportResult = {
  total: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
};

const coerce = (value: string, type?: FieldType) => {
  const v = (value ?? "").trim();
  if (type === "number") return v === "" ? 0 : Number(v.replace(/,/g, ""));
  if (type === "date") return v === "" ? null : v;
  if (type === "bool") return ["true", "1", "نعم", "yes"].includes(v.toLowerCase());
  return v;
};

export async function runImport(
  spec: ImportSpec,
  integration: Row,
  records: Record<string, string>[],
  actorName: string,
): Promise<ImportResult> {
  const result: ImportResult = { total: records.length, inserted: 0, updated: 0, failed: 0, errors: [] };

  const { data: syncRow } = await supabase
    .from("integration_syncs" as never)
    .insert({
      integration_id: integration["id"],
      direction: "استيراد",
      entity: spec.label,
      rows_total: records.length,
      actor_name: actorName,
    } as never)
    .select("id")
    .single();
  const syncId = (syncRow as unknown as { id: string } | null)?.id;

  let employees: Row[] = [];
  if (spec.employeeLookup) employees = await rows("employees", "id, full_name, email");

  for (let i = 0; i < records.length; i++) {
    const raw = records[i] ?? {};
    try {
      for (const f of spec.fields) {
        if (f.required && !(raw[f.column] ?? "").trim()) throw new Error(`العمود «${f.label}» مطلوب`);
      }

      const payload: Record<string, unknown> = {};
      for (const f of spec.fields) {
        if (spec.employeeLookup && f.column === "employee_key") continue;
        payload[f.column] = coerce(raw[f.column] ?? "", f.type);
      }

      let matchColumn = spec.keyColumn;
      let matchValue: unknown = (raw[spec.keyColumn] ?? "").trim();

      if (spec.employeeLookup) {
        const key = (raw["employee_key"] ?? "").trim().toLowerCase();
        const emp = employees.find(
          (e) =>
            String(e["email"] ?? "").toLowerCase() === key ||
            String(e["full_name"] ?? "").trim().toLowerCase() === key,
        );
        if (!emp) throw new Error(`لا يوجد موظف مطابق للبريد أو الاسم: ${raw["employee_key"]}`);
        payload["employee_id"] = emp["id"];
        matchColumn = "employee_id";
        matchValue = emp["id"];
      }

      const filter = supabase.from(spec.table as never).select("id").eq(matchColumn, matchValue as never);
      const scoped =
        spec.table === "payslips"
          ? filter.eq("period", payload["period"] as never)
          : spec.table === "leave_balances"
            ? filter.eq("leave_type", payload["leave_type"] as never)
            : filter;

      const { data: existing } = await scoped.maybeSingle();
      const existingId = (existing as unknown as { id: string } | null)?.id;

      if (existingId) {
        const { error } = await supabase.from(spec.table as never).update(payload as never).eq("id", existingId);
        if (error) throw error;
        result.updated++;
      } else {
        const { error } = await supabase.from(spec.table as never).insert(payload as never);
        if (error) throw error;
        result.inserted++;
      }

      await supabase
        .from("external_refs" as never)
        .upsert(
          {
            system: String(integration["system"]),
            entity: spec.table,
            local_id: String(existingId ?? matchValue),
            external_id: String((raw[spec.keyColumn] ?? "").trim() || matchValue),
            payload: raw,
          } as never,
          { onConflict: "system,entity,external_id" } as never,
        );
    } catch (e) {
      result.failed++;
      if (result.errors.length < 50) {
        result.errors.push({ row: i + 2, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (syncId) {
    await supabase
      .from("integration_syncs" as never)
      .update({
        status: result.failed === 0 ? "ناجحة" : result.inserted + result.updated > 0 ? "جزئية" : "فاشلة",
        rows_ok: result.inserted + result.updated,
        rows_failed: result.failed,
        message: `${result.inserted} جديد · ${result.updated} محدّث · ${result.failed} فاشل`,
        errors: result.errors,
        finished_at: new Date().toISOString(),
      } as never)
      .eq("id", syncId);
  }

  await supabase
    .from("integrations" as never)
    .update({ last_sync_at: new Date().toISOString() } as never)
    .eq("id", integration["id"] as string);

  return result;
}

export async function logExport(integration: Row, spec: ExportSpec, count: number, actorName: string) {
  await supabase.from("integration_syncs" as never).insert({
    integration_id: integration["id"],
    direction: "تصدير",
    entity: spec.label,
    status: "ناجحة",
    rows_total: count,
    rows_ok: count,
    message: `تم توليد ملف ${spec.label} بعدد ${count} صف`,
    actor_name: actorName,
    finished_at: new Date().toISOString(),
  } as never);
  await supabase
    .from("integrations" as never)
    .update({ last_sync_at: new Date().toISOString() } as never)
    .eq("id", integration["id"] as string);
}

