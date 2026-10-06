import { useState, useEffect, useMemo } from "react";
import { useEmployees } from "../contexts/EmployeeContext";
import {
  Target, Plus, Search, Edit2, Trash2, Eye, X, CheckCircle2,
  Star, TrendingUp, Users, BarChart2, Award, ChevronDown, Calendar
} from "lucide-react";
import { toast } from "sonner";

interface Evaluation {
  id: string; employeeId: string; employeeName: string; period: string;
  evaluatorName: string; evaluatorRole: string; overallScore: number;
  criteria: { name: string; score: number; weight: number; comment: string }[];
  strengths: string; improvements: string; goals: string; status: string; createdAt: string;
}

interface OKR {
  id: string; employeeId: string; employeeName: string; period: string;
  objective: string; keyResults: { title: string; target: number; current: number; unit: string }[];
  status: string; createdAt: string;
}

const CRITERIA = [
  { name: "جودة العمل", weight: 20 },
  { name: "الإنتاجية", weight: 20 },
  { name: "المبادرة والإبداع", weight: 15 },
  { name: "العمل الجماعي", weight: 15 },
  { name: "الالتزام والانضباط", weight: 15 },
  { name: "التواصل", weight: 15 },
];

const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", outline: "none" };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" as const, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 6, fontFamily: "Alexandria" };
const overlayStyle: React.CSSProperties = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: React.CSSProperties = { background: "hsl(var(--card))", borderRadius: 16, border: "1px solid hsl(165 69% 39% / 0.20)", padding: 28, maxWidth: 640, width: "100%", maxHeight: "85vh", overflowY: "auto", fontFamily: "Alexandria", direction: "rtl" };
const tagStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 };

export function PerformanceEvalContent() {
  const { employees } = useEmployees();
  const [tab, setTab] = useState<"evaluations" | "okrs">("evaluations");
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [okrs, setOkrs] = useState<OKR[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [showOkrModal, setShowOkrModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailEval, setDetailEval] = useState<Evaluation | null>(null);

  const [evalForm, setEvalForm] = useState({
    employeeId: "", employeeName: "", period: "Q2-2026",
    evaluatorName: "", evaluatorRole: "مدير مباشر",
    criteria: CRITERIA.map(c => ({ name: c.name, score: 3, weight: c.weight, comment: "" })),
    strengths: "", improvements: "", goals: "",
  });

  const [okrForm, setOkrForm] = useState({
    employeeId: "", employeeName: "", period: "Q2-2026",
    objective: "",
    keyResults: [{ title: "", target: 100, current: 0, unit: "%" }],
  });

  const fetchAll = async () => {
    try {
      const [eRes, oRes] = await Promise.all([
        fetch("/api/services/evaluations", { credentials: "include" }),
        fetch("/api/services/okrs", { credentials: "include" }),
      ]);
      if (eRes.ok) setEvaluations(await eRes.json());
      if (oRes.ok) setOkrs(await oRes.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const calcOverall = (criteria: typeof evalForm.criteria) => {
    const total = criteria.reduce((sum, c) => sum + (c.score * c.weight), 0);
    const maxTotal = criteria.reduce((sum, c) => sum + (5 * c.weight), 0);
    return Math.round((total / maxTotal) * 100);
  };

  const saveEval = async () => {
    if (!evalForm.employeeName || !evalForm.evaluatorName) { toast.error("البيانات المطلوبة ناقصة"); return; }
    const overallScore = calcOverall(evalForm.criteria);
    await fetch("/api/services/evaluations", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ ...evalForm, overallScore, status: "draft" }),
    });
    toast.success("تم حفظ التقييم"); setShowEvalModal(false); fetchAll();
  };

  const saveOkr = async () => {
    if (!okrForm.employeeName || !okrForm.objective) { toast.error("البيانات المطلوبة ناقصة"); return; }
    await fetch("/api/services/okrs", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ ...okrForm, status: "active" }),
    });
    toast.success("تم حفظ الهدف"); setShowOkrModal(false); fetchAll();
  };

  const deleteEval = async (id: string) => {
    if (!confirm("حذف التقييم؟")) return;
    await fetch(`/api/services/evaluations/${id}`, { method: "DELETE", credentials: "include" });
    toast.success("تم الحذف"); fetchAll();
  };

  const deleteOkr = async (id: string) => {
    if (!confirm("حذف الهدف؟")) return;
    await fetch(`/api/services/okrs/${id}`, { method: "DELETE", credentials: "include" });
    toast.success("تم الحذف"); fetchAll();
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "#10B981";
    if (score >= 60) return "#F59E0B";
    return "#EF4444";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "ممتاز";
    if (score >= 80) return "جيد جداً";
    if (score >= 70) return "جيد";
    if (score >= 60) return "مقبول";
    return "يحتاج تحسين";
  };

  const renderStars = (score: number, onChange?: (s: number) => void) => (
    <div style={{ display: "flex", gap: 2, direction: "ltr" }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} size={16} fill={s <= score ? "#F59E0B" : "transparent"}
          style={{ color: s <= score ? "#F59E0B" : "hsl(var(--border))", cursor: onChange ? "pointer" : "default" }}
          onClick={() => onChange?.(s)} />
      ))}
    </div>
  );

  return (
    <div style={{ fontFamily: "Alexandria", direction: "rtl" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: "#1FA98C", margin: 0 }}>
            <Target size={24} style={{ verticalAlign: "middle", marginLeft: 8 }} />
            تقييم الأداء
          </h1>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>تقييمات الموظفين والأهداف (OKRs)</p>
        </div>
        <button onClick={tab === "evaluations" ? () => { setEvalForm({ employeeId: "", employeeName: "", period: "Q2-2026", evaluatorName: "", evaluatorRole: "مدير مباشر", criteria: CRITERIA.map(c => ({ name: c.name, score: 3, weight: c.weight, comment: "" })), strengths: "", improvements: "", goals: "" }); setShowEvalModal(true); } : () => { setOkrForm({ employeeId: "", employeeName: "", period: "Q2-2026", objective: "", keyResults: [{ title: "", target: 100, current: 0, unit: "%" }] }); setShowOkrModal(true); }} className="btn-brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} /> {tab === "evaluations" ? "تقييم جديد" : "هدف جديد"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "التقييمات", value: evaluations.length, color: "#3B82F6", icon: BarChart2 },
          { label: "الأهداف", value: okrs.length, color: "#8B5CF6", icon: Target },
          { label: "متوسط الأداء", value: evaluations.length ? Math.round(evaluations.reduce((s, e) => s + e.overallScore, 0) / evaluations.length) + "%" : "—", color: "#10B981", icon: TrendingUp },
          { label: "أهداف نشطة", value: okrs.filter(o => o.status === "active").length, color: "#F59E0B", icon: Award },
        ].map((s, i) => (
          <div key={i} style={{ background: "hsl(var(--card))", borderRadius: 12, border: "1px solid hsl(165 69% 39% / 0.10)", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <s.icon size={18} style={{ color: s.color }} />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", background: "hsl(var(--card))", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden" }}>
          {(["evaluations", "okrs"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "10px 24px", border: "none", cursor: "pointer", fontFamily: "Alexandria", fontSize: 14, fontWeight: 700, transition: "border-color 150ms ease, background-color 150ms ease", background: tab === t ? "hsl(165 69% 39% / 0.15)" : "transparent", color: tab === t ? "#1FA98C" : "hsl(var(--muted-foreground))" }}>
              {t === "evaluations" ? "التقييمات" : "الأهداف (OKRs)"}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, position: "relative", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", right: 12, top: 12, color: "hsl(var(--muted-foreground))" }} />
          <input placeholder="بحث..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...inputStyle, paddingRight: 36 }} />
        </div>
      </div>

      {/* Evaluations Tab */}
      {tab === "evaluations" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {evaluations.filter(e => !searchTerm || e.employeeName.toLowerCase().includes(searchTerm.toLowerCase())).map(ev => (
            <div key={ev.id} style={{ background: "hsl(var(--card))", borderRadius: 14, border: "1px solid hsl(165 69% 39% / 0.10)", padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: "hsl(var(--foreground))", margin: "0 0 4px" }}>{ev.employeeName}</h3>
                  <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{ev.period} • {ev.evaluatorRole}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: getScoreColor(ev.overallScore) }}>{ev.overallScore}%</div>
                  <div style={{ fontSize: 10, color: getScoreColor(ev.overallScore), fontWeight: 700 }}>{getScoreLabel(ev.overallScore)}</div>
                </div>
              </div>
              {/* Score bar */}
              <div style={{ height: 6, borderRadius: 3, background: "hsl(var(--muted))", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 3, background: getScoreColor(ev.overallScore), width: `${ev.overallScore}%`, transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...tagStyle, background: ev.status === "approved" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)", color: ev.status === "approved" ? "#10B981" : "#F59E0B" }}>
                  {ev.status === "approved" ? "معتمد" : "مسودة"}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => { setDetailEval(ev); setShowDetailModal(true); }} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer", padding: 4 }}><Eye size={14} /></button>
                  <button onClick={() => deleteEval(ev.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
          {evaluations.length === 0 && !loading && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
              <BarChart2 size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p>لا توجد تقييمات بعد</p>
            </div>
          )}
        </div>
      )}

      {/* OKRs Tab */}
      {tab === "okrs" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {okrs.filter(o => !searchTerm || o.employeeName.toLowerCase().includes(searchTerm.toLowerCase())).map(okr => {
            const progress = okr.keyResults.length ? Math.round(okr.keyResults.reduce((s, kr) => s + Math.min(100, (kr.current / kr.target) * 100), 0) / okr.keyResults.length) : 0;
            return (
              <div key={okr.id} style={{ background: "hsl(var(--card))", borderRadius: 14, border: "1px solid hsl(165 69% 39% / 0.10)", padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--foreground))", margin: "0 0 4px" }}>{okr.objective}</h3>
                    <div style={{ fontSize: 12, color: "#1FA98C" }}>{okr.employeeName}</div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: getScoreColor(progress) }}>{progress}%</div>
                </div>
                <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                  {okr.keyResults.map((kr, i) => {
                    const p = Math.min(100, Math.round((kr.current / kr.target) * 100));
                    return (
                      <div key={i} style={{ background: "hsl(var(--card))", borderRadius: 8, padding: "8px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "hsl(var(--foreground))", marginBottom: 4 }}>
                          <span>{kr.title}</span>
                          <span style={{ color: "hsl(var(--muted-foreground))" }}>{kr.current}/{kr.target} {kr.unit}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: "hsl(var(--muted))" }}>
                          <div style={{ height: "100%", borderRadius: 2, background: getScoreColor(p), width: `${p}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ ...tagStyle, background: okr.status === "completed" ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)", color: okr.status === "completed" ? "#10B981" : "#3B82F6" }}>
                    {okr.status === "completed" ? "مكتمل" : "نشط"}
                  </span>
                  <button onClick={() => deleteOkr(okr.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
          {okrs.length === 0 && !loading && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
              <Target size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p>لا توجد أهداف بعد</p>
            </div>
          )}
        </div>
      )}

      {/* Eval Modal */}
      {showEvalModal && (
        <div style={overlayStyle} onClick={() => setShowEvalModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>تقييم أداء جديد</h2>
              <button onClick={() => setShowEvalModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>الموظف *</label><select value={evalForm.employeeId} onChange={e => { const emp = employees.find((em: any) => em.employeeId === e.target.value); setEvalForm(f => ({ ...f, employeeId: e.target.value, employeeName: emp ? ((emp as any).nameAr || (emp as any).name) : "" })); }} style={selectStyle}><option value="">اختر</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr || emp.name}</option>)}</select></div>
                <div><label style={labelStyle}>الفترة</label><input value={evalForm.period} onChange={e => setEvalForm(f => ({ ...f, period: e.target.value }))} placeholder="Q2-2026" style={inputStyle} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>المقيّم *</label><input value={evalForm.evaluatorName} onChange={e => setEvalForm(f => ({ ...f, evaluatorName: e.target.value }))} style={inputStyle} /></div>
                <div><label style={labelStyle}>صفة المقيّم</label><select value={evalForm.evaluatorRole} onChange={e => setEvalForm(f => ({ ...f, evaluatorRole: e.target.value }))} style={selectStyle}><option>مدير مباشر</option><option>زميل</option><option>تقييم ذاتي</option><option>مرؤوس</option></select></div>
              </div>
              <div style={{ background: "hsl(var(--card))", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1FA98C", marginBottom: 10 }}>معايير التقييم</div>
                {evalForm.criteria.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: i < evalForm.criteria.length - 1 ? "1px solid hsl(165 69% 39% / 0.06)" : "none" }}>
                    <span style={{ fontSize: 13, color: "hsl(var(--foreground))", flex: 1 }}>{c.name} ({c.weight}%)</span>
                    {renderStars(c.score, (s) => { const newC = [...evalForm.criteria]; newC[i] = { ...newC[i], score: s }; setEvalForm(f => ({ ...f, criteria: newC })); })}
                  </div>
                ))}
                <div style={{ marginTop: 10, textAlign: "center", fontSize: 18, fontWeight: 900, color: getScoreColor(calcOverall(evalForm.criteria)) }}>
                  النتيجة: {calcOverall(evalForm.criteria)}% — {getScoreLabel(calcOverall(evalForm.criteria))}
                </div>
              </div>
              <div><label style={labelStyle}>نقاط القوة</label><textarea value={evalForm.strengths} onChange={e => setEvalForm(f => ({ ...f, strengths: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
              <div><label style={labelStyle}>مجالات التحسين</label><textarea value={evalForm.improvements} onChange={e => setEvalForm(f => ({ ...f, improvements: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
              <div><label style={labelStyle}>الأهداف المستقبلية</label><textarea value={evalForm.goals} onChange={e => setEvalForm(f => ({ ...f, goals: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveEval} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> حفظ التقييم</button>
              <button onClick={() => setShowEvalModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* OKR Modal */}
      {showOkrModal && (
        <div style={overlayStyle} onClick={() => setShowOkrModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>هدف جديد (OKR)</h2>
              <button onClick={() => setShowOkrModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>الموظف *</label><select value={okrForm.employeeId} onChange={e => { const emp = employees.find((em: any) => em.employeeId === e.target.value); setOkrForm(f => ({ ...f, employeeId: e.target.value, employeeName: emp ? ((emp as any).nameAr || (emp as any).name) : "" })); }} style={selectStyle}><option value="">اختر</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr || emp.name}</option>)}</select></div>
                <div><label style={labelStyle}>الفترة</label><input value={okrForm.period} onChange={e => setOkrForm(f => ({ ...f, period: e.target.value }))} placeholder="Q2-2026" style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>الهدف الرئيسي *</label><input value={okrForm.objective} onChange={e => setOkrForm(f => ({ ...f, objective: e.target.value }))} placeholder="مثال: زيادة رضا العملاء" style={inputStyle} /></div>
              <div style={{ background: "hsl(var(--card))", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1FA98C" }}>النتائج الرئيسية</span>
                  <button onClick={() => setOkrForm(f => ({ ...f, keyResults: [...f.keyResults, { title: "", target: 100, current: 0, unit: "%" }] }))} style={{ background: "none", border: "none", color: "#1FA98C", cursor: "pointer", fontSize: 12, fontFamily: "Alexandria" }}><Plus size={12} /> إضافة</button>
                </div>
                {okrForm.keyResults.map((kr, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 60px", gap: 8, marginBottom: 8 }}>
                    <input value={kr.title} onChange={e => { const n = [...okrForm.keyResults]; n[i] = { ...n[i], title: e.target.value }; setOkrForm(f => ({ ...f, keyResults: n })); }} placeholder="النتيجة" style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                    <input type="number" value={kr.target} onChange={e => { const n = [...okrForm.keyResults]; n[i] = { ...n[i], target: Number(e.target.value) }; setOkrForm(f => ({ ...f, keyResults: n })); }} placeholder="الهدف" style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                    <input type="number" value={kr.current} onChange={e => { const n = [...okrForm.keyResults]; n[i] = { ...n[i], current: Number(e.target.value) }; setOkrForm(f => ({ ...f, keyResults: n })); }} placeholder="الحالي" style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                    <input value={kr.unit} onChange={e => { const n = [...okrForm.keyResults]; n[i] = { ...n[i], unit: e.target.value }; setOkrForm(f => ({ ...f, keyResults: n })); }} placeholder="%" style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveOkr} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> حفظ الهدف</button>
              <button onClick={() => setShowOkrModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && detailEval && (
        <div style={overlayStyle} onClick={() => setShowDetailModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>تقييم {detailEval.employeeName}</h2>
              <button onClick={() => setShowDetailModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: getScoreColor(detailEval.overallScore) }}>{detailEval.overallScore}%</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: getScoreColor(detailEval.overallScore) }}>{getScoreLabel(detailEval.overallScore)}</div>
            </div>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {detailEval.criteria.map((c, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid hsl(165 69% 39% / 0.06)" }}>
                  <span style={{ fontSize: 13, color: "hsl(var(--foreground))" }}>{c.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {renderStars(c.score)}
                    <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", width: 30, textAlign: "center" }}>{c.score}/5</span>
                  </div>
                </div>
              ))}
            </div>
            {detailEval.strengths && <div style={{ marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#10B981", marginBottom: 4 }}>نقاط القوة</div><p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.6 }}>{detailEval.strengths}</p></div>}
            {detailEval.improvements && <div style={{ marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#F59E0B", marginBottom: 4 }}>مجالات التحسين</div><p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.6 }}>{detailEval.improvements}</p></div>}
            {detailEval.goals && <div><div style={{ fontSize: 13, fontWeight: 700, color: "#3B82F6", marginBottom: 4 }}>الأهداف المستقبلية</div><p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.6 }}>{detailEval.goals}</p></div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PerformanceEval() {
  return (
    <div style={{ fontFamily: "Alexandria", direction: "rtl", padding: "24px 28px", minHeight: "100vh", background: "hsl(var(--background))" }}>
      <PerformanceEvalContent />
    </div>
  );
}
