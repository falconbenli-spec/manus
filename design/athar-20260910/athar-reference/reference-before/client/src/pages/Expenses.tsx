import { useState, useEffect } from "react";
import { useEmployees } from "../contexts/EmployeeContext";
import { useAuth } from "../contexts/AuthContext";
import {
  Receipt, Plus, Search, Edit2, Trash2, X, CheckCircle2,
  DollarSign, Clock, TrendingUp, Wallet
} from "lucide-react";
import { toast } from "sonner";

interface Expense {
  id: string; employeeId: string; employeeName: string; category: string;
  amount: number; description: string; expenseDate: string | null;
  status: string; approverNotes: string; createdAt: string;
}

interface Custody {
  id: string; employeeId: string; employeeName: string; amount: number;
  purpose: string; status: string; settledAmount: number; dueDate: string;
  notes: string; createdAt: string;
}

interface DepartmentExpenseSummary {
  department: string;
  totalAmount: number;
  pendingCount: number;
  paidAmount: number;
}

const CATEGORIES = ["سفر وتنقل", "ضيافة", "مستلزمات مكتبية", "تسويق وإعلان", "اشتراكات وبرامج", "تدريب", "صيانة", "أخرى"];
const peoplePrimary = "hsl(var(--primary))";

async function getApiError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  return typeof payload?.error === "string" ? payload.error : fallback;
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid hsl(var(--primary) / .25)", background: "hsl(0 0% 22%)", color: "#e2e8f0", fontSize: 14, fontFamily: "Alexandria", outline: "none" };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none" as const, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, color: "hsl(0 0% 72%)", marginBottom: 6, fontFamily: "Alexandria" };
const overlayStyle: React.CSSProperties = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: React.CSSProperties = { background: "hsl(0 0% 18%)", borderRadius: 16, border: "1px solid hsl(165 69% 39% / 0.20)", padding: 28, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", fontFamily: "Alexandria", direction: "rtl" };

const statusColors: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B", label: "قيد مراجعة المدير" },
  manager_approved: { bg: "rgba(59,130,246,0.12)", color: "#3B82F6", label: "بانتظار المالية" },
  finance_approved: { bg: "rgba(139,92,246,0.12)", color: "#8B5CF6", label: "بانتظار الصرف" },
  paid: { bg: "rgba(16,185,129,0.12)", color: "#10B981", label: "تم الصرف" },
  rejected: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "مرفوض" },
  settled: { bg: "rgba(59,130,246,0.12)", color: "#3B82F6", label: "تمت التسوية" },
  open: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B", label: "مفتوحة" },
  partial: { bg: "rgba(139,92,246,0.12)", color: "#8B5CF6", label: "تسوية جزئية" },
  closed: { bg: "rgba(16,185,129,0.12)", color: "#10B981", label: "مغلقة" },
};

export default function Expenses() {
  const { employees } = useEmployees();
  const { user } = useAuth();
  const canApproveExpenses = user?.role === "manager" || user?.role === "admin" || user?.role === "owner";
  const canManageCustody = user?.role === "admin" || user?.role === "owner";
  const getExpenseApprovalOptions = (status: string) => {
    if (user?.role === "manager" && status === "pending") return [{ value: "manager_approved", label: "اعتماد المدير" }, { value: "rejected", label: "رفض" }];
    if (user?.role === "admin" && status === "manager_approved") return [{ value: "finance_approved", label: "اعتماد المالية" }, { value: "rejected", label: "رفض" }];
    if (user?.role === "owner" && status === "finance_approved") return [{ value: "paid", label: "تأكيد الصرف" }, { value: "rejected", label: "رفض" }];
    return [] as { value: string; label: string }[];
  };
  const [tab, setTab] = useState<"expenses" | "custody">("expenses");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [custodies, setCustodies] = useState<Custody[]>([]);
  const [departmentReport, setDepartmentReport] = useState<DepartmentExpenseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showCustodyModal, setShowCustodyModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingCustody, setEditingCustody] = useState<Custody | null>(null);

  const [expForm, setExpForm] = useState({ category: CATEGORIES[0], amount: 0, description: "", date: new Date().toISOString().split("T")[0] });
  const [custForm, setCustForm] = useState({ employeeId: "", employeeName: "", amount: 0, purpose: "", dueDate: "", settledAmount: 0, notes: "" });

  const fetchAll = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [eRes, cRes, reportRes] = await Promise.all([
        fetch("/api/services/expenses", { credentials: "include" }),
        fetch("/api/services/custodies", { credentials: "include" }),
        fetch("/api/services/expenses/report/department", { credentials: "include" }),
      ]);
      if (!eRes.ok || !cRes.ok) throw new Error("تعذر تحميل بيانات المصروفات والعهد");
      setExpenses(await eRes.json());
      setCustodies(await cRes.json());
      if (reportRes.ok) setDepartmentReport(await reportRes.json());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "تعذر تحميل بيانات المصروفات والعهد");
    }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalCustody = custodies.filter(c => c.status !== "closed").reduce((s, c) => s + (c.amount - c.settledAmount), 0);

  const saveExpense = async () => {
    if (!expForm.amount) { toast.error("البيانات المطلوبة ناقصة"); return; }
    const method = editingExpense ? "PUT" : "POST";
    const url = editingExpense ? `/api/services/expenses/${editingExpense.id}` : "/api/services/expenses";
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...expForm, status: "pending" }) });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر حفظ المصروف"));
      toast.success(editingExpense ? "تم التحديث" : "تم إضافة المصروف"); setShowExpenseModal(false); setEditingExpense(null); void fetchAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ المصروف");
    }
  };

  const saveCustody = async () => {
    if (!custForm.employeeId || !custForm.amount || !custForm.purpose.trim()) { toast.error("البيانات المطلوبة ناقصة"); return; }
    const method = editingCustody ? "PUT" : "POST";
    const url = editingCustody ? `/api/services/custodies/${editingCustody.id}` : "/api/services/custodies";
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: custForm.employeeId, amount: custForm.amount, purpose: custForm.purpose, dueDate: custForm.dueDate, settledAmount: custForm.settledAmount, notes: custForm.notes, status: editingCustody ? editingCustody.status : "open" }) });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر حفظ العهدة"));
      toast.success(editingCustody ? "تم التحديث" : "تم إضافة العهدة"); setShowCustodyModal(false); setEditingCustody(null); void fetchAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ العهدة");
    }
  };

  const updateStatus = async (type: "expense" | "custody", id: string, status: string) => {
    const url = type === "expense" ? `/api/services/expenses/${id}/status` : `/api/services/custodies/${id}`;
    try {
      const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر تحديث الحالة"));
      toast.success("تم تحديث الحالة"); void fetchAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحديث الحالة");
    }
  };

  const deleteItem = async (type: "expense" | "custody", id: string) => {
    if (!confirm("حذف العنصر؟")) return;
    const url = type === "expense" ? `/api/services/expenses/${id}` : `/api/services/custodies/${id}`;
    try {
      const response = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر حذف العنصر"));
      toast.success("تم الحذف"); void fetchAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حذف العنصر");
    }
  };

  return (
    <div style={{ fontFamily: "Alexandria", direction: "rtl", padding: "24px 28px", minHeight: "100vh", background: "hsl(0 0% 15%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: peoplePrimary, margin: 0 }}>
            <Receipt size={24} style={{ verticalAlign: "middle", marginLeft: 8 }} />
            المصروفات والعهد
          </h1>
          <p style={{ fontSize: 13, color: "hsl(0 0% 55%)", margin: "4px 0 0" }}>إدارة مصروفات الموظفين والعهد المالية</p>
        </div>
        {(tab === "expenses" || canManageCustody) && <button onClick={() => {
          if (tab === "expenses") {
            setExpForm({ category: CATEGORIES[0], amount: 0, description: "", date: new Date().toISOString().split("T")[0] });
            setEditingExpense(null); setShowExpenseModal(true);
          } else {
            setCustForm({ employeeId: "", employeeName: "", amount: 0, purpose: "", dueDate: "", settledAmount: 0, notes: "" });
            setEditingCustody(null); setShowCustodyModal(true);
          }
        }} className="btn-brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} /> {tab === "expenses" ? "مصروف جديد" : "عهدة جديدة"}
        </button>}
      </div>

      {loadError && <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)", color: "#fecaca", fontSize: 13 }}>
        <span>{loadError}</span>
        <button onClick={() => void fetchAll()} style={{ border: "1px solid rgba(254,202,202,0.4)", background: "transparent", color: "#fee2e2", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "Alexandria", fontSize: 12 }}>إعادة المحاولة</button>
      </div>}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "إجمالي المصروفات", value: totalExpenses.toLocaleString() + " ر.س", color: "#3B82F6", icon: DollarSign },
          { label: "عهد مفتوحة", value: totalCustody.toLocaleString() + " ر.س", color: "#F59E0B", icon: Wallet },
          { label: "قيد المراجعة", value: expenses.filter(e => e.status === "pending").length, color: "#8B5CF6", icon: Clock },
          { label: "تم صرفها", value: expenses.filter(e => e.status === "paid").length, color: "#10B981", icon: CheckCircle2 },
        ].map((s, i) => (
          <div key={i} style={{ background: "hsl(0 0% 20%)", borderRadius: 12, border: "1px solid hsl(165 69% 39% / 0.10)", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <s.icon size={18} style={{ color: s.color }} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "hsl(0 0% 55%)" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {departmentReport.length > 0 && (
        <section style={{ marginBottom: 24, background: "hsl(0 0% 20%)", border: "1px solid hsl(165 69% 39% / 0.14)", borderRadius: 14, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 14, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: 16, fontWeight: 800 }}>ملخص المصروفات حسب الإدارة</h2>
            <span style={{ color: "hsl(0 0% 55%)", fontSize: 11 }}>يعرض للمديرين والجهات المخوّلة فقط</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            {departmentReport.map((summary) => (
              <div key={summary.department} style={{ borderRadius: 10, padding: "12px 14px", background: "hsl(0 0% 17%)", border: "1px solid hsl(165 69% 39% / 0.10)" }}>
                <div style={{ color: "#b7e8df", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{summary.department}</div>
                <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 900 }}>{summary.totalAmount.toLocaleString()} ر.س</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, color: "hsl(0 0% 58%)", fontSize: 11 }}>
                  <span>معلّق: {summary.pendingCount}</span><span>مصروف: {summary.paidAmount.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", background: "hsl(0 0% 20%)", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden" }}>
          {(["expenses", "custody"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "10px 24px", border: "none", cursor: "pointer", fontFamily: "Alexandria", fontSize: 14, fontWeight: 700, transition: "all 0.2s", background: tab === t ? "hsl(var(--primary) / .15)" : "transparent", color: tab === t ? peoplePrimary : "hsl(0 0% 55%)" }}>
              {t === "expenses" ? "المصروفات" : "العهد"}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, position: "relative", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", right: 12, top: 12, color: "hsl(0 0% 52%)" }} />
          <input placeholder="بحث..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...inputStyle, paddingRight: 36 }} />
        </div>
      </div>

      {/* Expenses Table */}
      {tab === "expenses" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
            <thead><tr>{["الموظف", "الفئة", "المبلغ", "الوصف", "التاريخ", "الحالة", "إجراءات"].map(h => (
              <th key={h} style={{ textAlign: "right", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "hsl(0 0% 52%)", fontFamily: "Alexandria" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
                  {expenses.filter(e => !searchTerm || e.employeeName.includes(searchTerm) || e.category.includes(searchTerm)).map(e => {
                    const st = statusColors[e.status] || statusColors.pending;
                    const approvalOptions = getExpenseApprovalOptions(e.status);
                return (
                  <tr key={e.id} style={{ background: "hsl(0 0% 20%)" }}>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#e2e8f0", fontWeight: 700, borderRadius: "0 10px 10px 0" }}>{e.employeeName}</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: peoplePrimary }}>{e.category}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, color: "#F59E0B", fontWeight: 800 }}>{e.amount.toLocaleString()} ر.س</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "hsl(0 0% 62%)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description || "—"}</td>
                    <td style={{ padding: "12px 14px", fontSize: 11, color: "hsl(0 0% 52%)" }}>{e.expenseDate || new Date(e.createdAt).toLocaleDateString("ar-SA")}</td>
                    <td style={{ padding: "12px 14px" }}>
                      {canApproveExpenses && approvalOptions.length > 0 ? <select value="" aria-label="إجراء اعتماد المصروف" onChange={ev => { if (ev.target.value) void updateStatus("expense", e.id, ev.target.value); }}
                        style={{ background: st.bg, color: st.color, border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, fontFamily: "Alexandria", cursor: "pointer" }}>
                        <option value="" disabled>{st.label}</option>
                        {approvalOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select> : <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>{st.label}</span>}
                    </td>
                    <td style={{ padding: "12px 14px", borderRadius: "10px 0 0 10px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {e.employeeId === user?.id && e.status === "pending" && <button onClick={() => { setExpForm({ category: e.category, amount: e.amount, description: e.description, date: e.expenseDate || "" }); setEditingExpense(e); setShowExpenseModal(true); }} aria-label="تعديل المصروف" style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", padding: 4 }}><Edit2 size={13} /></button>}
                        {canManageCustody && <button onClick={() => deleteItem("expense", e.id)} aria-label="حذف المصروف" style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {expenses.length === 0 && !loading && <div style={{ textAlign: "center", padding: 60, color: "hsl(0 0% 52%)" }}><Receipt size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} /><p>لا توجد مصروفات</p></div>}
        </div>
      )}

      {/* Custody Table */}
      {tab === "custody" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
            <thead><tr>{["الموظف", "المبلغ", "المسوّى", "المتبقي", "الغرض", "الحالة", "إجراءات"].map(h => (
              <th key={h} style={{ textAlign: "right", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "hsl(0 0% 52%)", fontFamily: "Alexandria" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {custodies.filter(c => !searchTerm || c.employeeName.includes(searchTerm)).map(c => {
                const st = statusColors[c.status] || statusColors.open;
                const remaining = c.amount - c.settledAmount;
                return (
                  <tr key={c.id} style={{ background: "hsl(0 0% 20%)" }}>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#e2e8f0", fontWeight: 700, borderRadius: "0 10px 10px 0" }}>{c.employeeName}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, color: "#3B82F6", fontWeight: 800 }}>{c.amount.toLocaleString()} ر.س</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#10B981" }}>{c.settledAmount.toLocaleString()} ر.س</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: remaining > 0 ? "#F59E0B" : "#10B981", fontWeight: 700 }}>{remaining.toLocaleString()} ر.س</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "hsl(0 0% 62%)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.purpose}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>{st.label}</span>
                      {canManageCustody && <div style={{ marginTop: 5, fontSize: 10, color: "hsl(0 0% 52%)" }}>عدّل العهدة لتحديث التسوية والحالة</div>}
                    </td>
                    <td style={{ padding: "12px 14px", borderRadius: "10px 0 0 10px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {canManageCustody && <button onClick={() => { setCustForm({ employeeId: c.employeeId, employeeName: c.employeeName, amount: c.amount, purpose: c.purpose, dueDate: c.dueDate, settledAmount: c.settledAmount, notes: c.notes }); setEditingCustody(c); setShowCustodyModal(true); }} aria-label="تعديل العهدة" style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", padding: 4 }}><Edit2 size={13} /></button>}
                        {canManageCustody && <button onClick={() => deleteItem("custody", c.id)} aria-label="حذف العهدة" style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {custodies.length === 0 && !loading && <div style={{ textAlign: "center", padding: 60, color: "hsl(0 0% 52%)" }}><Wallet size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} /><p>لا توجد عهد</p></div>}
        </div>
      )}

      {/* Expense Modal */}
      {showExpenseModal && (
        <div style={overlayStyle} onClick={() => setShowExpenseModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", margin: 0 }}>{editingExpense ? "تعديل مصروف" : "مصروف جديد"}</h2>
              <button onClick={() => setShowExpenseModal(false)} style={{ background: "none", border: "none", color: "hsl(0 0% 52%)", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.20)", background: "hsl(165 69% 39% / 0.08)", color: "#b7e8df", fontSize: 12 }}>سيُسند الطلب تلقائياً إلى الموظف صاحب الجلسة الحالية لحماية بيانات الموظفين.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>الفئة *</label><select value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))} style={selectStyle}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={labelStyle}>المبلغ (ر.س) *</label><input type="number" value={expForm.amount || ""} onChange={e => setExpForm(f => ({ ...f, amount: Number(e.target.value) }))} style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>التاريخ</label><input type="date" value={expForm.date} onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
              <div><label style={labelStyle}>الوصف</label><textarea value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
              <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", fontSize: 12, lineHeight: 1.7 }}>
                إرفاق الإيصال غير متاح حالياً. لن تُقبل روابط مستندات خارجية إلى أن يتوفر تخزين خادمي وتنزيل مفروضان بالصلاحية.
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveExpense} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {editingExpense ? "تحديث" : "حفظ"}</button>
              <button onClick={() => setShowExpenseModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "#e2e8f0", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Custody Modal */}
      {showCustodyModal && (
        <div style={overlayStyle} onClick={() => setShowCustodyModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", margin: 0 }}>{editingCustody ? "تعديل عهدة" : "عهدة جديدة"}</h2>
              <button onClick={() => setShowCustodyModal(false)} style={{ background: "none", border: "none", color: "hsl(0 0% 52%)", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <div><label style={labelStyle}>الموظف *</label><select value={custForm.employeeId} onChange={e => { const emp = employees.find((em: any) => em.employeeId === e.target.value); setCustForm(f => ({ ...f, employeeId: e.target.value, employeeName: emp ? ((emp as any).nameAr || (emp as any).name) : "" })); }} style={selectStyle}><option value="">اختر</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr || emp.name}</option>)}</select></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>المبلغ (ر.س) *</label><input type="number" value={custForm.amount || ""} onChange={e => setCustForm(f => ({ ...f, amount: Number(e.target.value) }))} style={inputStyle} /></div>
                <div><label style={labelStyle}>المبلغ المسوّى</label><input type="number" value={custForm.settledAmount || ""} onChange={e => setCustForm(f => ({ ...f, settledAmount: Number(e.target.value) }))} style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>الغرض *</label><input value={custForm.purpose} onChange={e => setCustForm(f => ({ ...f, purpose: e.target.value }))} placeholder="مثال: مشتريات مشروع X" style={inputStyle} /></div>
              <div><label style={labelStyle}>تاريخ الاستحقاق</label><input type="date" value={custForm.dueDate} onChange={e => setCustForm(f => ({ ...f, dueDate: e.target.value }))} style={inputStyle} /></div>
              <div><label style={labelStyle}>ملاحظات</label><textarea value={custForm.notes} onChange={e => setCustForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveCustody} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {editingCustody ? "تحديث" : "حفظ"}</button>
              <button onClick={() => setShowCustodyModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "#e2e8f0", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
