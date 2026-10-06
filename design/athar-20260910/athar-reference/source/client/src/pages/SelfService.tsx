import { useState, useEffect } from "react";
import { useEmployees } from "../contexts/EmployeeContext";
import {
  FileText, Plus, Search, Edit2, Trash2, Eye, X, CheckCircle2,
  Clock, DollarSign, FileCheck, Send, AlertCircle, Download
} from "lucide-react";
import { toast } from "sonner";
const peoplePrimary = "hsl(var(--primary))";

interface LetterRequest {
  id: string; employeeId: string; employeeName: string; type: string;
  purpose: string; language: string; status: string; notes: string; createdAt: string;
}

interface AdvanceRequest {
  id: string; employeeId: string; employeeName: string; amount: number;
  reason: string; installments: number; status: string; notes: string; createdAt: string;
}

const LETTER_TYPES = ["تعريف بالراتب", "تعريف وظيفي", "شهادة خبرة", "خطاب لمن يهمه الأمر", "خطاب للسفارة", "خطاب للبنك"];

const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", outline: "none" };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" as const, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 6, fontFamily: "Alexandria" };
const overlayStyle: React.CSSProperties = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: React.CSSProperties = { background: "hsl(var(--card))", borderRadius: 16, border: "1px solid hsl(165 69% 39% / 0.20)", padding: 28, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", fontFamily: "Alexandria", direction: "rtl" };
const tagStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600 };

const statusColors: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B", label: "قيد المراجعة" },
  approved: { bg: "rgba(16,185,129,0.12)", color: "#10B981", label: "معتمد" },
  rejected: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "مرفوض" },
  processing: { bg: "rgba(59,130,246,0.12)", color: "#3B82F6", label: "قيد التنفيذ" },
  completed: { bg: "rgba(16,185,129,0.12)", color: "#10B981", label: "مكتمل" },
};

export default function SelfService() {
  const { employees } = useEmployees();
  const [tab, setTab] = useState<"letters" | "advances">("letters");
  const [letters, setLetters] = useState<LetterRequest[]>([]);
  const [advances, setAdvances] = useState<AdvanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [editingLetter, setEditingLetter] = useState<LetterRequest | null>(null);
  const [editingAdvance, setEditingAdvance] = useState<AdvanceRequest | null>(null);

  const [letterForm, setLetterForm] = useState({ employeeId: "", employeeName: "", type: LETTER_TYPES[0], purpose: "", language: "عربي", notes: "" });
  const [advanceForm, setAdvanceForm] = useState({ employeeId: "", employeeName: "", amount: 0, reason: "", installments: 3, notes: "" });

  const fetchAll = async () => {
    try {
      const [lRes, aRes] = await Promise.all([
        fetch("/api/services/letter-requests", { credentials: "include" }),
        fetch("/api/services/advance-requests", { credentials: "include" }),
      ]);
      if (lRes.ok) setLetters(await lRes.json());
      if (aRes.ok) setAdvances(await aRes.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const saveLetter = async () => {
    if (!letterForm.employeeName || !letterForm.type) { toast.error("البيانات المطلوبة ناقصة"); return; }
    const method = editingLetter ? "PUT" : "POST";
    const url = editingLetter ? `/api/services/letter-requests/${editingLetter.id}` : "/api/services/letter-requests";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...letterForm, status: "pending" }) });
    toast.success(editingLetter ? "تم تحديث الطلب" : "تم إرسال الطلب");
    setShowLetterModal(false); setEditingLetter(null); fetchAll();
  };

  const saveAdvance = async () => {
    if (!advanceForm.employeeName || !advanceForm.amount) { toast.error("البيانات المطلوبة ناقصة"); return; }
    const method = editingAdvance ? "PUT" : "POST";
    const url = editingAdvance ? `/api/services/advance-requests/${editingAdvance.id}` : "/api/services/advance-requests";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...advanceForm, status: "pending" }) });
    toast.success(editingAdvance ? "تم تحديث الطلب" : "تم إرسال الطلب");
    setShowAdvanceModal(false); setEditingAdvance(null); fetchAll();
  };

  const updateStatus = async (type: "letter" | "advance", id: string, status: string) => {
    const url = type === "letter" ? `/api/services/letter-requests/${id}` : `/api/services/advance-requests/${id}`;
    await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    toast.success("تم تحديث الحالة"); fetchAll();
  };

  const deleteItem = async (type: "letter" | "advance", id: string) => {
    if (!confirm("حذف الطلب؟")) return;
    const url = type === "letter" ? `/api/services/letter-requests/${id}` : `/api/services/advance-requests/${id}`;
    await fetch(url, { method: "DELETE", credentials: "include" });
    toast.success("تم الحذف"); fetchAll();
  };

  return (
    <div style={{ fontFamily: "Alexandria", direction: "rtl", padding: "24px 28px", minHeight: "100vh", background: "hsl(var(--background))" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: peoplePrimary, margin: 0 }}>
            <FileText size={24} style={{ verticalAlign: "middle", marginLeft: 8 }} />
            الخدمة الذاتية
          </h1>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>طلبات الخطابات والسلف والخدمات</p>
        </div>
        <button onClick={() => {
          if (tab === "letters") {
            setLetterForm({ employeeId: "", employeeName: "", type: LETTER_TYPES[0], purpose: "", language: "عربي", notes: "" });
            setEditingLetter(null); setShowLetterModal(true);
          } else {
            setAdvanceForm({ employeeId: "", employeeName: "", amount: 0, reason: "", installments: 3, notes: "" });
            setEditingAdvance(null); setShowAdvanceModal(true);
          }
        }} className="btn-brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} /> {tab === "letters" ? "طلب خطاب" : "طلب سلفة"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "طلبات الخطابات", value: letters.length, color: "#3B82F6", icon: FileCheck },
          { label: "طلبات السلف", value: advances.length, color: "#8B5CF6", icon: DollarSign },
          { label: "قيد المراجعة", value: [...letters, ...advances].filter(r => r.status === "pending").length, color: "#F59E0B", icon: Clock },
          { label: "معتمدة", value: [...letters, ...advances].filter(r => r.status === "approved" || r.status === "completed").length, color: "#10B981", icon: CheckCircle2 },
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

      {/* Tabs + Search */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", background: "hsl(var(--card))", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden" }}>
          {(["letters", "advances"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "10px 24px", border: "none", cursor: "pointer", fontFamily: "Alexandria", fontSize: 14, fontWeight: 700, transition: "border-color 150ms ease, background-color 150ms ease", background: tab === t ? "hsl(var(--primary) / 0.15)" : "transparent", color: tab === t ? peoplePrimary : "hsl(var(--muted-foreground))" }}>
              {t === "letters" ? "الخطابات" : "السلف"}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, position: "relative", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", right: 12, top: 12, color: "hsl(var(--muted-foreground))" }} />
          <input placeholder="بحث..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...inputStyle, paddingRight: 36 }} />
        </div>
      </div>

      {/* Letters Tab */}
      {tab === "letters" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
            <thead>
              <tr>{["الموظف", "نوع الخطاب", "الغرض", "اللغة", "الحالة", "التاريخ", "إجراءات"].map(h => (
                <th key={h} style={{ textAlign: "right", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {letters.filter(l => !searchTerm || l.employeeName.includes(searchTerm) || l.type.includes(searchTerm)).map(l => {
                const st = statusColors[l.status] || statusColors.pending;
                return (
                  <tr key={l.id} style={{ background: "hsl(var(--card))", borderRadius: 10 }}>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "hsl(var(--foreground))", fontWeight: 700, borderRadius: "0 10px 10px 0" }}>{l.employeeName}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: peoplePrimary }}>{l.type}</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "hsl(var(--muted-foreground))", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.purpose || "—"}</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{l.language}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <select value={l.status} onChange={e => updateStatus("letter", l.id, e.target.value)}
                        style={{ background: st.bg, color: st.color, border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}>
                        <option value="pending">قيد المراجعة</option>
                        <option value="processing">قيد التنفيذ</option>
                        <option value="approved">معتمد</option>
                        <option value="rejected">مرفوض</option>
                        <option value="completed">مكتمل</option>
                      </select>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{new Date(l.createdAt).toLocaleDateString("ar-SA-u-ca-gregory")}</td>
                    <td style={{ padding: "12px 14px", borderRadius: "10px 0 0 10px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => { setLetterForm({ employeeId: l.employeeId, employeeName: l.employeeName, type: l.type, purpose: l.purpose, language: l.language, notes: l.notes }); setEditingLetter(l); setShowLetterModal(true); }} style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", padding: 4 }}><Edit2 size={13} /></button>
                        <button onClick={() => deleteItem("letter", l.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {letters.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
              <FileText size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p>لا توجد طلبات خطابات</p>
            </div>
          )}
        </div>
      )}

      {/* Advances Tab */}
      {tab === "advances" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
            <thead>
              <tr>{["الموظف", "المبلغ", "السبب", "الأقساط", "الحالة", "التاريخ", "إجراءات"].map(h => (
                <th key={h} style={{ textAlign: "right", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {advances.filter(a => !searchTerm || a.employeeName.includes(searchTerm)).map(a => {
                const st = statusColors[a.status] || statusColors.pending;
                return (
                  <tr key={a.id} style={{ background: "hsl(var(--card))" }}>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "hsl(var(--foreground))", fontWeight: 700, borderRadius: "0 10px 10px 0" }}>{a.employeeName}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, color: peoplePrimary, fontWeight: 800 }}>{a.amount.toLocaleString()} ر.س</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "hsl(var(--muted-foreground))", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.reason}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>{a.installments} شهر</td>
                    <td style={{ padding: "12px 14px" }}>
                      <select value={a.status} onChange={e => updateStatus("advance", a.id, e.target.value)}
                        style={{ background: st.bg, color: st.color, border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}>
                        <option value="pending">قيد المراجعة</option>
                        <option value="approved">معتمد</option>
                        <option value="rejected">مرفوض</option>
                        <option value="completed">مكتمل</option>
                      </select>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{new Date(a.createdAt).toLocaleDateString("ar-SA-u-ca-gregory")}</td>
                    <td style={{ padding: "12px 14px", borderRadius: "10px 0 0 10px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => { setAdvanceForm({ employeeId: a.employeeId, employeeName: a.employeeName, amount: a.amount, reason: a.reason, installments: a.installments, notes: a.notes }); setEditingAdvance(a); setShowAdvanceModal(true); }} style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", padding: 4 }}><Edit2 size={13} /></button>
                        <button onClick={() => deleteItem("advance", a.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {advances.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
              <DollarSign size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p>لا توجد طلبات سلف</p>
            </div>
          )}
        </div>
      )}

      {/* Letter Modal */}
      {showLetterModal && (
        <div style={overlayStyle} onClick={() => setShowLetterModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>{editingLetter ? "تعديل طلب خطاب" : "طلب خطاب جديد"}</h2>
              <button onClick={() => setShowLetterModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <div><label style={labelStyle}>الموظف *</label><select value={letterForm.employeeId} onChange={e => { const emp = employees.find((em: any) => em.employeeId === e.target.value); setLetterForm(f => ({ ...f, employeeId: e.target.value, employeeName: emp ? ((emp as any).nameAr || (emp as any).name) : "" })); }} style={selectStyle}><option value="">اختر موظفاً</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr || emp.name}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>نوع الخطاب *</label><select value={letterForm.type} onChange={e => setLetterForm(f => ({ ...f, type: e.target.value }))} style={selectStyle}>{LETTER_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label style={labelStyle}>اللغة</label><select value={letterForm.language} onChange={e => setLetterForm(f => ({ ...f, language: e.target.value }))} style={selectStyle}><option>عربي</option><option>إنجليزي</option><option>عربي وإنجليزي</option></select></div>
              </div>
              <div><label style={labelStyle}>الغرض</label><input value={letterForm.purpose} onChange={e => setLetterForm(f => ({ ...f, purpose: e.target.value }))} placeholder="مثال: تقديم على تأشيرة" style={inputStyle} /></div>
              <div><label style={labelStyle}>ملاحظات</label><textarea value={letterForm.notes} onChange={e => setLetterForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveLetter} className="btn-brand" style={{ flex: 1 }}><Send size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {editingLetter ? "تحديث" : "إرسال الطلب"}</button>
              <button onClick={() => setShowLetterModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Advance Modal */}
      {showAdvanceModal && (
        <div style={overlayStyle} onClick={() => setShowAdvanceModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>{editingAdvance ? "تعديل طلب سلفة" : "طلب سلفة جديد"}</h2>
              <button onClick={() => setShowAdvanceModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <div><label style={labelStyle}>الموظف *</label><select value={advanceForm.employeeId} onChange={e => { const emp = employees.find((em: any) => em.employeeId === e.target.value); setAdvanceForm(f => ({ ...f, employeeId: e.target.value, employeeName: emp ? ((emp as any).nameAr || (emp as any).name) : "" })); }} style={selectStyle}><option value="">اختر موظفاً</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr || emp.name}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>المبلغ (ر.س) *</label><input type="number" value={advanceForm.amount || ""} onChange={e => setAdvanceForm(f => ({ ...f, amount: Number(e.target.value) }))} placeholder="5000" style={inputStyle} /></div>
                <div><label style={labelStyle}>عدد الأقساط</label><select value={advanceForm.installments} onChange={e => setAdvanceForm(f => ({ ...f, installments: Number(e.target.value) }))} style={selectStyle}>{[1, 2, 3, 4, 5, 6, 9, 12].map(n => <option key={n} value={n}>{n} شهر</option>)}</select></div>
              </div>
              <div><label style={labelStyle}>السبب *</label><textarea value={advanceForm.reason} onChange={e => setAdvanceForm(f => ({ ...f, reason: e.target.value }))} rows={2} placeholder="سبب طلب السلفة..." style={{ ...inputStyle, resize: "vertical" }} /></div>
              <div><label style={labelStyle}>ملاحظات</label><textarea value={advanceForm.notes} onChange={e => setAdvanceForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveAdvance} className="btn-brand" style={{ flex: 1 }}><Send size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {editingAdvance ? "تحديث" : "إرسال الطلب"}</button>
              <button onClick={() => setShowAdvanceModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
