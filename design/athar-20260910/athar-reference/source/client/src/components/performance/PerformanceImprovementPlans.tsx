import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

type PlanStatus = "draft" | "active" | "completed" | "cancelled";
interface ImprovementPlan { id: string; employeeId: string; employeeName?: string; department?: string; title: string; objectives?: string; startDate?: number | null; endDate?: number | null; status: PlanStatus; managerNotes?: string; }

const statusStyle: Record<PlanStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "مسودة", color: "#F59E0B", bg: "rgba(245,158,11,.12)" },
  active: { label: "نشطة", color: "#1FA98C", bg: "hsl(165 69% 39% / .12)" },
  completed: { label: "مكتملة", color: "#10B981", bg: "rgba(16,185,129,.12)" },
  cancelled: { label: "ملغاة", color: "#EF4444", bg: "rgba(239,68,68,.12)" },
};

const dateText = (timestamp?: number | null) => timestamp ? new Date(timestamp).toLocaleDateString("ar-SA-u-ca-gregory") : "—";

export function PerformanceImprovementPlans() {
  const [plans, setPlans] = useState<ImprovementPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employeeId: "", title: "", objectives: "", managerNotes: "", startDate: "", endDate: "" });

  const loadPlans = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/services/performance-improvement-plans", { credentials: "include" });
      if (!response.ok) throw new Error("تعذر تحميل خطط تحسين الأداء ضمن نطاق الصلاحية");
      setPlans(await response.json());
    } catch (loadError) {
      setPlans([]); setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الخطط");
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadPlans(); }, []);

  const savePlan = async () => {
    if (!form.employeeId.trim() || !form.title.trim()) { toast.error("أدخل الرقم الوظيفي وعنوان الخطة"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/services/performance-improvement-plans", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: form.employeeId.trim(), title: form.title.trim(), objectives: form.objectives.trim(), managerNotes: form.managerNotes.trim(), startDate: form.startDate ? new Date(`${form.startDate}T00:00:00`).getTime() : null, endDate: form.endDate ? new Date(`${form.endDate}T00:00:00`).getTime() : null, status: "draft" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "تعذر حفظ الخطة");
      toast.success("تم حفظ خطة التحسين داخلياً");
      setShowForm(false); setForm({ employeeId: "", title: "", objectives: "", managerNotes: "", startDate: "", endDate: "" });
      await loadPlans();
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : "تعذر حفظ الخطة"); }
    finally { setSaving(false); }
  };

  const updateStatus = async (plan: ImprovementPlan, status: PlanStatus) => {
    try {
      const response = await fetch(`/api/services/performance-improvement-plans/${plan.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "تعذر تحديث الخطة");
      toast.success("تم تحديث حالة الخطة"); await loadPlans();
    } catch (updateError) { toast.error(updateError instanceof Error ? updateError.message : "تعذر تحديث الخطة"); }
  };

  return <section style={{ direction: "rtl" }}>
    <div className="flex flex-wrap justify-between items-center gap-3 mb-4"><div><h2 style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))", fontWeight: 900, margin: 0, fontSize: 16 }}>خطط تحسين الأداء</h2><p style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", fontSize: 11, margin: "4px 0 0" }}>سجلات حساسة ظاهرة ضمن نطاق الصلاحية فقط.</p></div><button className="btn-brand flex items-center gap-2" onClick={() => setShowForm(true)}><Plus size={14} />خطة جديدة</button></div>
    {loading ? <div className="card-brand rounded-xl p-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="inline animate-spin ml-2" size={17} />جارٍ تحميل الخطط…</div> : error ? <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", color: "#fca5a5" }}><AlertCircle className="inline ml-2" size={16} />{error}<button className="mr-3 underline" onClick={() => void loadPlans()}>إعادة المحاولة</button></div> : plans.length === 0 ? <div className="card-brand rounded-xl p-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}><ClipboardList size={34} className="mx-auto mb-3 opacity-50" />لا توجد خطط تحسين أداء ضمن نطاقك.</div> : <div className="grid gap-3">{plans.map((plan) => { const state = statusStyle[plan.status] || statusStyle.draft; return <article key={plan.id} className="card-brand rounded-xl p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex items-center gap-2"><span style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))", fontWeight: 800 }}>{plan.title}</span><span style={{ color: state.color, background: state.bg, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700 }}>{state.label}</span></div><p style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", fontSize: 12, margin: "6px 0 0" }}>{plan.employeeName || "—"} · {plan.employeeId}{plan.department ? ` · ${plan.department}` : ""}</p></div><div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}>من {dateText(plan.startDate)} إلى {dateText(plan.endDate)}</div></div>{plan.objectives && <p style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", fontSize: 12, lineHeight: 1.8, whiteSpace: "pre-wrap", margin: "14px 0 0" }}>{plan.objectives}</p>}{plan.managerNotes && <p style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", fontSize: 11, lineHeight: 1.7, whiteSpace: "pre-wrap", margin: "8px 0 0" }}>ملاحظات المدير: {plan.managerNotes}</p>}<div className="flex gap-2 mt-4">{plan.status === "draft" && <button className="btn-brand" onClick={() => void updateStatus(plan, "active")}>تفعيل</button>}{plan.status === "active" && <button className="btn-brand" onClick={() => void updateStatus(plan, "completed")}><CheckCircle2 size={14} className="inline ml-1" />إكمال الخطة</button>}</div></article>; })}</div>}
    {showForm && <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}><div className="card-brand rounded-xl p-5" style={{ width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}><div className="flex justify-between items-center mb-4"><h3 style={{ fontFamily: "Alexandria", color: "hsl(var(--foreground))", margin: 0 }}>خطة تحسين أداء جديدة</h3><button aria-label="إغلاق" onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={18} /></button></div><div className="grid gap-3"><input aria-label="الرقم الوظيفي" value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} placeholder="الرقم الوظيفي" className="input-brand" /><input aria-label="عنوان الخطة" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="عنوان الخطة" className="input-brand" /><textarea aria-label="أهداف التحسين" value={form.objectives} onChange={(event) => setForm({ ...form, objectives: event.target.value })} placeholder="أهداف التحسين ومعايير النجاح" rows={4} className="input-brand" /><textarea aria-label="ملاحظات المدير" value={form.managerNotes} onChange={(event) => setForm({ ...form, managerNotes: event.target.value })} placeholder="ملاحظات المدير (اختياري)" rows={3} className="input-brand" /><div className="grid grid-cols-2 gap-3"><input aria-label="تاريخ البداية" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} className="input-brand" /><input aria-label="تاريخ النهاية" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} className="input-brand" /></div></div><div className="flex gap-2 mt-5"><button disabled={saving} className="btn-brand flex-1" onClick={() => void savePlan()}>{saving ? "جارٍ الحفظ…" : "حفظ الخطة"}</button><button onClick={() => setShowForm(false)} className="flex-1 rounded-lg" style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>إلغاء</button></div></div></div>}
  </section>;
}
