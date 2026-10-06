import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Eye, FileText, Plus, Search, Shield, Trash2, X } from "lucide-react";
import { toast } from "sonner";

interface Policy {
  id: string;
  title: string;
  category: string | null;
  content: string | null;
  version: string;
  status: "draft" | "published" | "archived";
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  ackCount?: number;
}

interface PolicyAcknowledgment {
  employeeId: string;
  employeeName: string;
  acknowledgedAt: number;
}

const CATEGORIES = ["سياسات الشركة", "إجراءات العمل", "نماذج رسمية", "أدلة تدريبية", "لوائح وأنظمة", "أخرى"];
const statusStyle: Record<Policy["status"], { label: string; color: string; bg: string }> = {
  draft: { label: "مسودة", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  published: { label: "منشورة", color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  archived: { label: "مؤرشفة", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
};

const peoplePrimary = "hsl(var(--primary))";
const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid hsl(var(--primary) / 0.25)", background: "hsl(var(--input))", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: 13, boxSizing: "border-box" };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: 12, fontWeight: 700 };

export default function Documents() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("الكل");
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [ackPolicy, setAckPolicy] = useState<Policy | null>(null);
  const [acknowledgments, setAcknowledgments] = useState<PolicyAcknowledgment[]>([]);
  const [form, setForm] = useState({ title: "", category: CATEGORIES[0], content: "", version: "1.0", status: "draft" as Policy["status"] });

  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/services/policies", { credentials: "include" });
      if (!response.ok) throw new Error("policies request failed");
      setPolicies(await response.json());
    } catch {
      toast.error("تعذر تحميل السياسات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchPolicies(); }, []);

  const filteredPolicies = useMemo(() => policies.filter((policy) => {
    const content = `${policy.title} ${policy.content || ""} ${policy.category || ""}`.toLowerCase();
    return (!search || content.includes(search.toLowerCase())) && (category === "الكل" || policy.category === category);
  }), [category, policies, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: "", category: CATEGORIES[0], content: "", version: "1.0", status: "draft" });
    setShowEditor(true);
  };

  const openEdit = (policy: Policy) => {
    setEditing(policy);
    setForm({ title: policy.title, category: policy.category || CATEGORIES[0], content: policy.content || "", version: policy.version, status: policy.status });
    setShowEditor(true);
  };

  const savePolicy = async () => {
    if (!form.title.trim()) return toast.error("عنوان السياسة مطلوب");
    try {
      const response = await fetch(editing ? `/api/services/policies/${editing.id}` : "/api/services/policies", {
        method: editing ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title.trim(), category: form.category, content: form.content, version: form.version, status: form.status }),
      });
      if (!response.ok) throw new Error("policy save failed");
      toast.success(editing ? "تم تحديث السياسة" : "تم إنشاء مسودة السياسة");
      setShowEditor(false);
      await fetchPolicies();
    } catch {
      toast.error("تعذر حفظ السياسة");
    }
  };

  const deletePolicy = async (policy: Policy) => {
    if (!confirm(`حذف السياسة «${policy.title}»؟`)) return;
    try {
      const response = await fetch(`/api/services/policies/${policy.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("policy delete failed");
      toast.success("تم حذف السياسة");
      await fetchPolicies();
    } catch {
      toast.error("تعذر حذف السياسة");
    }
  };

  const viewAcknowledgments = async (policy: Policy) => {
    try {
      const response = await fetch(`/api/services/policies/${policy.id}/acknowledgments`, { credentials: "include" });
      if (!response.ok) throw new Error("acknowledgments request failed");
      setAcknowledgments(await response.json());
      setAckPolicy(policy);
    } catch {
      toast.error("تعذر تحميل إقرارات الموظفين");
    }
  };

  return <main style={{ fontFamily: "Alexandria", direction: "rtl", padding: "24px 28px", minHeight: "100vh", background: "hsl(var(--background))" }}>
    <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div><h1 style={{ fontSize: 24, fontWeight: 900, color: peoplePrimary, margin: 0 }}><FileText size={24} style={{ verticalAlign: "middle", marginLeft: 8 }} />السياسات والوثائق</h1><p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>إدارة نسخ السياسات وإقرارات الموظفين داخل المنصة.</p></div>
      <button onClick={openCreate} className="btn-brand flex items-center gap-2"><Plus size={16} />سياسة جديدة</button>
    </header>

    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {[
        { label: "إجمالي السياسات", value: policies.length, icon: FileText, color: "#3B82F6" },
        { label: "منشورة", value: policies.filter((policy) => policy.status === "published").length, icon: BookOpen, color: "#10B981" },
        { label: "إجمالي الإقرارات", value: policies.reduce((sum, policy) => sum + Number(policy.ackCount || 0), 0), icon: Shield, color: "#F59E0B" },
        { label: "تصنيفات", value: new Set(policies.map((policy) => policy.category).filter(Boolean)).size, icon: CheckCircle2, color: "#8B5CF6" },
      ].map((stat) => <div key={stat.label} className="card-brand rounded-xl p-4 flex items-center gap-3"><div style={{ width: 40, height: 40, borderRadius: 10, background: `${stat.color}20`, display: "grid", placeItems: "center" }}><stat.icon size={18} color={stat.color} /></div><div><div style={{ color: stat.color, fontWeight: 900, fontSize: 18 }}>{stat.value}</div><div style={{ color: "hsl(0 0% 55%)", fontSize: 11 }}>{stat.label}</div></div></div>)}
    </section>

    <section className="flex flex-wrap gap-3 mb-5"><div style={{ position: "relative", flex: "1 1 240px" }}><Search size={14} style={{ position: "absolute", right: 12, top: 12, color: "hsl(var(--muted-foreground))" }} /><input aria-label="بحث في السياسات" placeholder="بحث في السياسات..." value={search} onChange={(event) => setSearch(event.target.value)} style={{ ...inputStyle, paddingRight: 34 }} /></div><select aria-label="تصنيف السياسة" value={category} onChange={(event) => setCategory(event.target.value)} style={{ ...inputStyle, width: 190 }}><option value="الكل">كل التصنيفات</option>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></section>

    {loading ? <div style={{ padding: 56, textAlign: "center", color: "hsl(0 0% 55%)" }}>جارٍ تحميل السياسات...</div> : filteredPolicies.length === 0 ? <div style={{ padding: 70, textAlign: "center", color: "hsl(0 0% 55%)" }}><FileText size={44} style={{ margin: "0 auto 12px", opacity: .45 }} /><p>لا توجد سياسات ضمن النتائج.</p></div> : <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{filteredPolicies.map((policy) => {
      const state = statusStyle[policy.status];
      return <article key={policy.id} className="card-brand rounded-xl p-4 flex flex-col gap-3"><div className="flex items-start justify-between gap-3"><div><h2 style={{ color: "hsl(var(--foreground))", fontSize: 15, fontWeight: 800, margin: 0 }}>{policy.title}</h2><p style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, margin: "5px 0 0" }}>{policy.category || "غير مصنف"} · الإصدار {policy.version}</p></div><span style={{ color: state.color, background: state.bg, borderRadius: 7, padding: "3px 8px", fontSize: 10, fontWeight: 700 }}>{state.label}</span></div><p style={{ color: "hsl(var(--muted-foreground))", lineHeight: 1.65, fontSize: 12, margin: 0, minHeight: 40 }}>{policy.content || "لا يوجد نص تفصيلي لهذه السياسة بعد."}</p><div className="flex items-center justify-between gap-2"><button onClick={() => void viewAcknowledgments(policy)} style={{ background: "hsl(var(--primary) / .12)", color: peoplePrimary, border: "1px solid hsl(var(--primary) / .28)", borderRadius: 8, padding: "7px 10px", fontFamily: "Alexandria", fontSize: 11, cursor: "pointer" }}><Eye size={12} style={{ verticalAlign: "middle", marginLeft: 4 }} />إقرارات ({policy.ackCount || 0})</button><div className="flex gap-2"><button onClick={() => openEdit(policy)} style={{ background: "transparent", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>تعديل</button><button onClick={() => void deletePolicy(policy)} style={{ background: "rgba(239,68,68,.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,.22)", borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}><Trash2 size={13} /></button></div></div></article>;
    })}</section>}

    {showEditor && <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.68)", padding: 16, display: "grid", placeItems: "center" }} onClick={() => setShowEditor(false)}><div style={{ width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "hsl(0 0% 18%)", border: "1px solid hsl(165 69% 39% / .25)", borderRadius: 16, padding: 24 }} onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between mb-5"><h2 style={{ color: "hsl(0 0% 92%)", fontSize: 18, margin: 0 }}>{editing ? "تعديل السياسة" : "سياسة جديدة"}</h2><button onClick={() => setShowEditor(false)} style={{ background: "none", border: "none", color: "hsl(0 0% 55%)", cursor: "pointer" }}><X /></button></div><div className="grid gap-4"><label style={labelStyle}>عنوان السياسة<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} style={{ ...inputStyle, marginTop: 6 }} /></label><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label style={labelStyle}>التصنيف<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} style={{ ...inputStyle, marginTop: 6 }}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label style={labelStyle}>الإصدار<input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} style={{ ...inputStyle, marginTop: 6 }} /></label></div><label style={labelStyle}>الحالة<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Policy["status"] })} style={{ ...inputStyle, marginTop: 6 }}><option value="draft">مسودة</option><option value="published">منشورة</option><option value="archived">مؤرشفة</option></select></label><label style={labelStyle}>محتوى السياسة<textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} rows={9} style={{ ...inputStyle, marginTop: 6, resize: "vertical" }} /></label></div><div className="flex gap-3 mt-5"><button onClick={() => void savePolicy()} className="btn-brand flex-1">{editing ? "حفظ التعديل" : "إنشاء سياسة"}</button><button onClick={() => setShowEditor(false)} style={{ padding: "10px 16px", borderRadius: 9, background: "transparent", border: "1px solid hsl(0 0% 32%)", color: "hsl(0 0% 70%)", fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button></div></div></div>}

    {ackPolicy && <div style={{ position: "fixed", inset: 0, zIndex: 71, background: "rgba(0,0,0,.68)", padding: 16, display: "grid", placeItems: "center" }} onClick={() => setAckPolicy(null)}><div style={{ width: "min(520px, 100%)", background: "hsl(0 0% 18%)", border: "1px solid hsl(165 69% 39% / .25)", borderRadius: 16, padding: 24 }} onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between mb-4"><div><h2 style={{ color: "hsl(0 0% 92%)", margin: 0, fontSize: 16 }}>إقرارات السياسة</h2><p style={{ color: "hsl(0 0% 55%)", margin: "4px 0 0", fontSize: 11 }}>{ackPolicy.title}</p></div><button onClick={() => setAckPolicy(null)} style={{ background: "none", border: "none", color: "hsl(0 0% 55%)", cursor: "pointer" }}><X /></button></div>{acknowledgments.length === 0 ? <p style={{ color: "hsl(0 0% 55%)", fontSize: 12 }}>لا توجد إقرارات مسجلة حتى الآن.</p> : <div className="grid gap-2">{acknowledgments.map((ack) => <div key={ack.employeeId} style={{ padding: 10, borderRadius: 9, background: "hsl(0 0% 21%)", color: "hsl(0 0% 85%)", fontSize: 12 }}>{ack.employeeName || ack.employeeId}<span style={{ color: "hsl(0 0% 55%)", marginRight: 8 }}>{new Date(ack.acknowledgedAt).toLocaleDateString("ar-SA-u-ca-gregory")}</span></div>)}</div>}</div></div>}
  </main>;
}
