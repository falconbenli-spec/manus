import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, RefreshCw, Target, X } from "lucide-react";
import { toast } from "sonner";
import PageTemplate from "@/components/layout/PageTemplate";

const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.12)";
const mutedText = "hsl(var(--muted-foreground))";

type OkrStatus = "active" | "completed" | "cancelled";

interface OkrRecord {
  id: string;
  employeeId?: string;
  employeeName?: string;
  department?: string;
  title?: string;
  objective?: string;
  keyResult1?: string;
  keyResult2?: string;
  keyResult3?: string;
  progress1?: number;
  progress2?: number;
  progress3?: number;
  quarter?: string;
  year?: number;
  status?: OkrStatus;
}

const statusStyle: Record<OkrStatus, { label: string; color: string; bg: string }> = {
  active: { label: "نشط", color: peoplePrimary, bg: peoplePrimarySoft },
  completed: { label: "مكتمل", color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  cancelled: { label: "ملغى", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
};

function progressFor(okr: OkrRecord): number {
  const values = [
    okr.keyResult1 ? Number(okr.progress1 || 0) : null,
    okr.keyResult2 ? Number(okr.progress2 || 0) : null,
    okr.keyResult3 ? Number(okr.progress3 || 0) : null,
  ].filter((value): value is number => value !== null);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

export default function OKRsDashboard() {
  const [okrs, setOkrs] = useState<OkrRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OkrStatus>("all");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employeeId: "", title: "", keyResult1: "", keyResult2: "", keyResult3: "", quarter: "Q1", year: new Date().getFullYear() });

  const loadOkrs = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/services/okrs", { credentials: "include" });
      if (!response.ok) throw new Error("تعذر تحميل الأهداف ضمن نطاق صلاحيتك");
      setOkrs(await response.json());
    } catch (loadError) {
      setOkrs([]);
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الأهداف");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadOkrs(); }, []);

  const filtered = useMemo(() => okrs.filter((okr) => {
    const matchesSearch = !query.trim() || [okr.title, okr.objective, okr.employeeName, okr.employeeId, okr.department]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query.trim().toLowerCase()));
    return matchesSearch && (status === "all" || (okr.status || "active") === status);
  }), [okrs, query, status]);

  const metrics = useMemo(() => {
    const active = okrs.filter((okr) => (okr.status || "active") === "active");
    const avg = active.length ? Math.round(active.reduce((sum, okr) => sum + progressFor(okr), 0) / active.length) : 0;
    return { total: okrs.length, active: active.length, completed: okrs.filter((okr) => okr.status === "completed").length, avg };
  }, [okrs]);

  const saveOkr = async () => {
    if (!form.employeeId.trim() || !form.title.trim() || !form.keyResult1.trim()) {
      toast.error("أدخل الرقم الوظيفي والهدف والنتيجة الرئيسية الأولى");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/services/okrs", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, employeeId: form.employeeId.trim(), title: form.title.trim(), keyResult1: form.keyResult1.trim(), keyResult2: form.keyResult2.trim(), keyResult3: form.keyResult3.trim(), status: "active", progress1: 0, progress2: 0, progress3: 0 }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "تعذر حفظ الهدف");
      toast.success("تم حفظ الهدف في السجل الداخلي");
      setShowForm(false);
      setForm({ employeeId: "", title: "", keyResult1: "", keyResult2: "", keyResult3: "", quarter: "Q1", year: new Date().getFullYear() });
      await loadOkrs();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "تعذر حفظ الهدف");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTemplate title="الأهداف والنتائج الرئيسية" subtitle="سجلات الأهداف المحفوظة ضمن نطاق صلاحيتك" icon={Target}
      stats={loading||error?undefined:[{ label: "إجمالي الأهداف", value: String(metrics.total), color: peoplePrimary }, { label: "أهداف نشطة", value: String(metrics.active), color: "#F59E0B" }, { label: "أهداف مكتملة", value: String(metrics.completed), color: "#10B981" }, { label: "متوسط التقدم", value: `${metrics.avg}%`, color: "#3B82F6" }]}
      actions={<div className="flex items-center gap-2"><button className="btn-brand flex items-center gap-2" onClick={() => setShowForm(true)}><Plus size={14} />هدف جديد</button><button aria-label="تحديث الأهداف" onClick={() => void loadOkrs()} style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", padding: 9, borderRadius: 8, cursor: "pointer" }}><RefreshCw size={15} /></button></div>}
    >
      <section className="card-brand rounded-xl p-4 mb-4" style={{ direction: "rtl" }}><div className="flex flex-wrap gap-2"><input aria-label="البحث في الأهداف" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالهدف أو الموظف أو الإدارة" className="input-brand flex-1 min-w-52" /><select aria-label="حالة الهدف" value={status} onChange={(event) => setStatus(event.target.value as "all" | OkrStatus)} className="input-brand"><option value="all">كل الحالات</option><option value="active">نشط</option><option value="completed">مكتمل</option><option value="cancelled">ملغى</option></select></div></section>

      {loading ? <div className="card-brand rounded-xl p-10 text-center" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="inline animate-spin ml-2" size={18} />جارٍ تحميل الأهداف…</div> : error ? <div className="rounded-xl p-5" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)", direction: "rtl" }}><AlertCircle className="inline ml-2" size={17} />{error}<button onClick={() => void loadOkrs()} className="mr-3 underline">إعادة المحاولة</button></div> : filtered.length === 0 ? <div className="card-brand rounded-xl p-10 text-center" style={{ color: "hsl(var(--muted-foreground))", direction: "rtl" }}><Target size={36} className="mx-auto mb-3 opacity-50" /><p>{okrs.length ? "لا توجد أهداف تطابق الفلاتر." : "لا توجد أهداف محفوظة ضمن نطاق صلاحيتك."}</p></div> : <div className="grid gap-3" style={{ direction: "rtl" }}>{filtered.map((okr) => {
        const progress = progressFor(okr);
        const config = statusStyle[okr.status || "active"] || statusStyle.active;
        const keyResults = [okr.keyResult1, okr.keyResult2, okr.keyResult3].filter(Boolean) as string[];
        return <article key={okr.id} className="card-brand rounded-xl p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex items-center gap-2 mb-2"><span style={{ fontFamily: "Alexandria", fontWeight: 800, color: "hsl(var(--foreground))" }}>{okr.title || okr.objective || "هدف"}</span><span style={{ color: config.color, background: config.bg, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700 }}>{config.label}</span></div><div style={{ fontFamily: "Alexandria", color: mutedText, fontSize: 12 }}>{okr.employeeName || "—"} · {okr.employeeId || "—"}{okr.department ? ` · ${okr.department}` : ""}</div></div><div style={{ color: peoplePrimary, fontFamily: "Alexandria", fontWeight: 800 }}>{okr.quarter || "—"} {okr.year || ""}</div></div><div className="mt-4"><div className="flex justify-between mb-1" style={{ color: mutedText, fontSize: 11 }}><span>متوسط تقدم النتائج الرئيسية</span><span>{progress}%</span></div><div style={{ height: 8, borderRadius: 999, background: "hsl(var(--muted))", overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: progress >= 75 ? "#10B981" : progress >= 40 ? "#F59E0B" : "#EF4444", borderRadius: 999 }} /></div></div>{keyResults.length > 0 && <ul className="mt-3 grid gap-1" style={{ listStyle: "none", padding: 0, marginBottom: 0 }}>{keyResults.map((result, index) => <li key={`${okr.id}-${index}`} style={{ color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: 12 }}><CheckCircle2 size={13} color={peoplePrimary} className="inline ml-2" />{result}</li>)}</ul>}</article>;
      })}</div>}

      {showForm && <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}><div className="card-brand rounded-xl p-5" style={{ width: "100%", maxWidth: 600, direction: "rtl", maxHeight: "90vh", overflowY: "auto" }}><div className="flex justify-between items-center mb-4"><h2 style={{ fontFamily: "Alexandria", fontSize: 17, fontWeight: 900, color: "hsl(var(--foreground))", margin: 0 }}>هدف جديد</h2><button aria-label="إغلاق" onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={18} /></button></div><div className="grid gap-3"><input aria-label="الرقم الوظيفي" value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} placeholder="الرقم الوظيفي" className="input-brand" /><textarea aria-label="الهدف" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="الهدف" className="input-brand" rows={2} /><input aria-label="النتيجة الرئيسية الأولى" value={form.keyResult1} onChange={(event) => setForm({ ...form, keyResult1: event.target.value })} placeholder="النتيجة الرئيسية الأولى" className="input-brand" /><input aria-label="النتيجة الرئيسية الثانية" value={form.keyResult2} onChange={(event) => setForm({ ...form, keyResult2: event.target.value })} placeholder="النتيجة الرئيسية الثانية (اختياري)" className="input-brand" /><input aria-label="النتيجة الرئيسية الثالثة" value={form.keyResult3} onChange={(event) => setForm({ ...form, keyResult3: event.target.value })} placeholder="النتيجة الرئيسية الثالثة (اختياري)" className="input-brand" /><div className="grid grid-cols-2 gap-3"><input aria-label="الربع" value={form.quarter} onChange={(event) => setForm({ ...form, quarter: event.target.value })} placeholder="الربع" className="input-brand" /><input aria-label="السنة" type="number" value={form.year} onChange={(event) => setForm({ ...form, year: Number(event.target.value) })} className="input-brand" /></div></div><div className="flex gap-2 mt-5"><button disabled={saving} onClick={() => void saveOkr()} className="btn-brand flex-1">{saving ? "جارٍ الحفظ…" : "حفظ الهدف"}</button><button onClick={() => setShowForm(false)} className="flex-1 rounded-lg" style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>إلغاء</button></div></div></div>}
    </PageTemplate>
  );
}
