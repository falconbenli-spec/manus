/**
 * Payroll & Benefits - HCM Platform
 * Design: People36t theme tokens, Alexandria font, RTL
 * Data: protected /api/hcm/payroll records scoped by the active session
 * Features: Excel export, تعريف الراتب, تثبيت الراتب للبنوك, تعديل حالة الدفع
 */
import { useState, useMemo, useEffect } from "react";
import { DollarSign, Download, Search, TrendingUp, CheckCircle, Clock, FileText, Building2, Globe, X, Edit2, Check, Plus } from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";
import saudiBanks from "@/data/saudiBanks.json";
import saudiEmbassies from "@/data/saudiEmbassies.json";
import { exportPayroll } from "@/lib/excelExport";
import { generateSalaryCertificate, generateBankConfirmation, generatePayslipPDF, type SalaryDocEmployee } from "@/lib/salaryDocuments";
import { useAuth } from "@/contexts/AuthContext";

interface PayrollRecord {
  employeeId: string; nameAr: string; department: string; jobTitle: string;
  basicSalary: number; housingAllowance: number; transportAllowance: number;
  grossSalary: number; gosiDeduction: number; netSalary: number;
  paymentStatus: string; paymentMonth: string;
}

const peoplePrimary = "hsl(var(--primary))";

const statusColors: Record<string, { color: string; bg: string }> = {
  "مدفوع": { color: peoplePrimary, bg: "hsl(var(--primary) / .12)" },
  "معلق":  { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
};

interface AdvancedPayslip {
  id: string; employeeId: string; employeeName: string; month: string;
  basicSalary: number; housingAllowance: number; transportAllowance: number;
  otherAllowances: number; overtimeAmount: number; bonus: number;
  gosiDeduction: number; absenceDeduction: number; loanDeduction: number;
  otherDeductions: number; netSalary: number; status: "draft" | "approved" | "paid"; createdAt: number;
}

interface SalaryStructure {
  employeeId: string; employeeName: string; basicSalary: number; housingAllowance: number;
  transportAllowance: number; otherAllowances: number; gosiDeduction: number;
  grade: string | null; notes: string | null; updatedAt: number;
}

const advancedStatus: Record<AdvancedPayslip["status"], { label: string; color: string }> = {
  draft: { label: "مسودة", color: "#F59E0B" },
  approved: { label: "معتمد", color: "#6366F1" },
  paid: { label: "مدفوع", color: "#10B981" },
};

function AdvancedPayslipPanel({ employees }: { employees: PayrollRecord[] }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [employeeId, setEmployeeId] = useState("");
  const [payslips, setPayslips] = useState<AdvancedPayslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payslipComponents, setPayslipComponents] = useState({ otherAllowances: 0, overtimeAmount: 0, bonus: 0, gosiDeduction: 0, absenceDeduction: 0, loanDeduction: 0, otherDeductions: 0 });

  const refreshPayslips = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/services/payslips?month=${encodeURIComponent(month)}`, { credentials: "include" });
      if (!response.ok) throw new Error("payslips request failed");
      setPayslips(await response.json());
    } catch {
      toast.error("تعذر تحميل كشوف الرواتب المحفوظة");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshPayslips(); }, [month]);

  const selectEmployee = (nextEmployeeId: string) => {
    setEmployeeId(nextEmployeeId);
    const employee = employees.find((record) => record.employeeId === nextEmployeeId);
    setPayslipComponents((current) => ({ ...current, gosiDeduction: employee?.gosiDeduction || 0 }));
  };

  const createDraft = async () => {
    const employee = employees.find((record) => record.employeeId === employeeId);
    if (!employee) {
      toast.error("اختر موظفاً لإنشاء كشف راتب");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/services/payslips", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: employee.employeeId, employeeName: employee.nameAr, month,
          basicSalary: employee.basicSalary, housingAllowance: employee.housingAllowance,
          transportAllowance: employee.transportAllowance,
          ...payslipComponents,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error === "string" ? payload.error : "تعذر إنشاء كشف الراتب");
      }
      toast.success("تم إنشاء مسودة كشف الراتب");
      setEmployeeId("");
      setPayslipComponents({ otherAllowances: 0, overtimeAmount: 0, bonus: 0, gosiDeduction: 0, absenceDeduction: 0, loanDeduction: 0, otherDeductions: 0 });
      await refreshPayslips();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إنشاء كشف الراتب");
    } finally {
      setSaving(false);
    }
  };

  const moveStatus = async (id: string, status: "approved" | "paid") => {
    try {
      const response = await fetch(`/api/services/payslips/${id}/status`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("payslip status failed");
      toast.success(status === "approved" ? "تم اعتماد الكشف" : "تم تسجيل الكشف كمدفوع");
      await refreshPayslips();
    } catch {
      toast.error("تعذر تحديث حالة كشف الراتب");
    }
  };

  const downloadPayslip = async (payslip: AdvancedPayslip) => {
    try {
      await generatePayslipPDF(payslip);
      toast.success("تم تنزيل كشف الراتب بصيغة PDF");
    } catch {
      toast.error("تعذر إنشاء ملف كشف الراتب");
    }
  };

  return (
    <section className="card-brand rounded-xl p-4 mb-5" style={{ direction: "rtl" }} aria-label="كشوف الرواتب المحفوظة">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 style={{ fontFamily: "Alexandria", fontWeight: 900, color: peoplePrimary, margin: 0, fontSize: 16 }}>كشوف الرواتب المحفوظة</h2>
          <p style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", margin: "4px 0 0", fontSize: 11 }}>حساب الصافي وحالة الاعتماد محفوظان في قاعدة البيانات.</p>
        </div>
        <input aria-label="شهر كشف الراتب" type="month" value={month} onChange={(event) => setMonth(event.target.value)} style={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontFamily: "Alexandria" }} />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <select id="advanced-payslip-select" aria-label="موظف كشف الراتب" value={employeeId} onChange={(event) => selectEmployee(event.target.value)} style={{ flex: "1 1 220px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontFamily: "Alexandria" }}>
          <option value="">اختر موظفاً لإنشاء مسودة</option>
          {employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.nameAr} — {employee.employeeId}</option>)}
        </select>
        <button onClick={() => void createDraft()} disabled={saving} className="btn-brand flex items-center gap-2"><Plus size={14} />إنشاء مسودة</button>
      </div>
      <div aria-label="مكونات كشف الراتب" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {([
          ["otherAllowances", "بدلات أخرى", "استحقاق"], ["overtimeAmount", "عمل إضافي", "استحقاق"], ["bonus", "مكافأة", "استحقاق"],
          ["gosiDeduction", "خصم التأمينات", "استقطاع"], ["absenceDeduction", "خصم الغياب", "استقطاع"], ["loanDeduction", "خصم سلفة", "استقطاع"], ["otherDeductions", "خصومات أخرى", "استقطاع"],
        ] as const).map(([key, label, kind]) => (
          <label key={key} style={{ display: "grid", gap: 4, padding: "8px 10px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontFamily: "Alexandria" }}>
            <span style={{ fontSize: 10, color: kind === "استحقاق" ? peoplePrimary : "#f59e0b" }}>{label} — {kind}</span>
            <input aria-label={label} type="number" min={0} step="0.01" value={payslipComponents[key]} onChange={(event) => setPayslipComponents((current) => ({ ...current, [key]: Math.max(0, Number(event.target.value) || 0) }))} style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: 13, direction: "ltr" }} />
          </label>
        ))}
      </div>
      {loading ? <p style={{ color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: 12 }}>جارٍ تحميل كشوف الشهر...</p> : payslips.length === 0 ? <p style={{ color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: 12 }}>لا توجد كشوف رواتب محفوظة لهذا الشهر.</p> : <div className="grid gap-2">
        {payslips.map((payslip) => {
          const state = advancedStatus[payslip.status];
          return <div key={payslip.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-3" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--muted))" }}>
            <div><div style={{ color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontWeight: 700, fontSize: 13 }}>{payslip.employeeName}</div><div style={{ color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: 11 }}>{payslip.employeeId} · صافي {payslip.netSalary.toLocaleString("ar-SA")} ر.س</div></div>
            <div className="flex items-center gap-2"><span style={{ color: state.color, fontFamily: "Alexandria", fontSize: 11, fontWeight: 700 }}>{state.label}</span><button onClick={() => void downloadPayslip(payslip)} aria-label={`تنزيل كشف راتب ${payslip.employeeName}`} style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 7, padding: "7px 9px", cursor: "pointer" }}><FileText size={14} /></button>{payslip.status === "draft" && <button onClick={() => void moveStatus(payslip.id, "approved")} className="btn-brand" style={{ padding: "7px 10px", fontSize: 11 }}>اعتماد</button>}{payslip.status === "approved" && <button onClick={() => void moveStatus(payslip.id, "paid")} className="btn-brand" style={{ padding: "7px 10px", fontSize: 11 }}>تسجيل كمدفوع</button>}</div>
          </div>;
        })}
      </div>}
    </section>
  );
}

function SalaryStructuresPanel({ employees }: { employees: PayrollRecord[] }) {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ basicSalary: 0, housingAllowance: 0, transportAllowance: 0, otherAllowances: 0, gosiDeduction: 0, grade: "", notes: "" });

  const refreshStructures = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/services/salary-structures", { credentials: "include" });
      if (!response.ok) throw new Error("salary structures request failed");
      setStructures(await response.json());
    } catch {
      toast.error("تعذر تحميل هياكل الرواتب المحفوظة");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refreshStructures(); }, []);

  const selectEmployee = (employeeId: string) => {
    setSelectedEmployeeId(employeeId);
    const stored = structures.find((structure) => structure.employeeId === employeeId);
    const employee = employees.find((record) => record.employeeId === employeeId);
    setForm(stored ? { basicSalary: stored.basicSalary, housingAllowance: stored.housingAllowance, transportAllowance: stored.transportAllowance, otherAllowances: stored.otherAllowances, gosiDeduction: stored.gosiDeduction, grade: stored.grade || "", notes: stored.notes || "" } : { basicSalary: employee?.basicSalary || 0, housingAllowance: employee?.housingAllowance || 0, transportAllowance: employee?.transportAllowance || 0, otherAllowances: 0, gosiDeduction: employee?.gosiDeduction || 0, grade: "", notes: "" });
  };

  const saveStructure = async () => {
    if (!selectedEmployeeId) { toast.error("اختر موظفاً لحفظ هيكل الراتب"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/services/salary-structures", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: selectedEmployeeId, ...form }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error === "string" ? payload.error : "salary structure save failed");
      }
      toast.success("تم حفظ هيكل الراتب");
      await refreshStructures();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ هيكل الراتب");
    } finally {
      setSaving(false);
    }
  };

  const fields = [["basicSalary", "الراتب الأساسي"], ["housingAllowance", "بدل السكن"], ["transportAllowance", "بدل النقل"], ["otherAllowances", "بدلات أخرى"], ["gosiDeduction", "خصم التأمينات"]] as const;
  const totalEarnings = form.basicSalary + form.housingAllowance + form.transportAllowance + form.otherAllowances;
  return <section className="card-brand rounded-xl p-4 mb-5" style={{ direction: "rtl" }} aria-label="هياكل الرواتب الإدارية">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 style={{ fontFamily: "Alexandria", fontWeight: 900, color: peoplePrimary, margin: 0, fontSize: 16 }}>هياكل الرواتب</h2><p style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", margin: "4px 0 0", fontSize: 11 }}>تُحفظ المكونات الأساسية والبدلات والخصومات للمستخدمين الإداريين فقط.</p></div><span style={{ fontFamily: "Alexandria", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{loading ? "جارٍ التحميل..." : `${structures.length} هياكل محفوظة`}</span></div>
    <div className="grid gap-3">
      <select aria-label="موظف هيكل الراتب" value={selectedEmployeeId} onChange={(event) => selectEmployee(event.target.value)} style={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontFamily: "Alexandria" }}><option value="">اختر موظفاً لإدارة هيكل الراتب</option>{employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.nameAr} — {employee.employeeId}</option>)}</select>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">{fields.map(([key, label]) => <label key={key} style={{ display: "grid", gap: 4, padding: "8px 10px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontFamily: "Alexandria" }}><span style={{ fontSize: 10, color: key === "gosiDeduction" ? "#f59e0b" : "#1FA98C" }}>{label}</span><input aria-label={label} type="number" min={0} step="0.01" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: Math.max(0, Number(event.target.value) || 0) }))} style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: 13, direction: "ltr" }} /></label>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><label style={{ display: "grid", gap: 4, fontFamily: "Alexandria", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>الدرجة<input aria-label="درجة الراتب" value={form.grade} maxLength={50} onChange={(event) => setForm((current) => ({ ...current, grade: event.target.value }))} style={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontFamily: "Alexandria" }} /></label><label style={{ display: "grid", gap: 4, fontFamily: "Alexandria", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>ملاحظات<textarea aria-label="ملاحظات هيكل الراتب" value={form.notes} maxLength={2000} rows={1} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} style={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", fontFamily: "Alexandria", resize: "vertical" }} /></label></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><span style={{ fontFamily: "Alexandria", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>إجمالي الاستحقاقات: <strong style={{ color: "#1FA98C" }}>{totalEarnings.toLocaleString("ar-SA")} ر.س</strong></span><button type="button" onClick={() => void saveStructure()} disabled={saving || !selectedEmployeeId} className="btn-brand flex items-center gap-2"><Check size={14} />{saving ? "جارٍ الحفظ" : "حفظ هيكل الراتب"}</button></div>
      {!loading && (structures.length === 0 ? <p style={{ margin: 0, color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: 12 }}>لا توجد هياكل رواتب محفوظة بعد.</p> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" aria-label="قائمة هياكل الرواتب المحفوظة">{structures.map((structure) => <button type="button" key={structure.employeeId} onClick={() => selectEmployee(structure.employeeId)} className="text-right rounded-lg p-3" style={{ background: selectedEmployeeId === structure.employeeId ? "hsl(165 69% 39% / 0.15)" : "hsl(var(--card))", border: `1px solid ${selectedEmployeeId === structure.employeeId ? "#1FA98C" : "hsl(var(--border))"}`, fontFamily: "Alexandria", cursor: "pointer" }}><span style={{ display: "block", color: "hsl(var(--foreground))", fontSize: 12, fontWeight: 700 }}>{structure.employeeName}</span><span style={{ display: "block", color: "hsl(var(--muted-foreground))", fontSize: 10, marginTop: 4 }}>{structure.employeeId}{structure.grade ? ` · ${structure.grade}` : ""}</span><span style={{ display: "block", color: "#1FA98C", fontSize: 11, marginTop: 6 }}>الاستحقاقات {Number(structure.basicSalary + structure.housingAllowance + structure.transportAllowance + structure.otherAllowances).toLocaleString("ar-SA")} ر.س</span></button>)}</div>)}
    </div>
  </section>;
}

const thS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"hsl(var(--muted-foreground))",whiteSpace:"nowrap",borderBottom:"1px solid hsl(var(--border))",background:"hsl(var(--card))" };
const tdS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",borderBottom:"1px solid hsl(var(--card))" };

// ── Document Modal ────────────────────────────────────────────────────────────
function DocumentModal({ employee, onClose }: { employee: PayrollRecord; onClose: () => void }) {
  const [docType, setDocType] = useState<"certificate" | "bank">("certificate");
  const [selectedBank, setSelectedBank] = useState("");
  const [selectedEmbassy, setSelectedEmbassy] = useState("");
  const [purpose, setPurpose] = useState("");
  const [generating, setGenerating] = useState(false);

  const emp: SalaryDocEmployee = {
    employeeId: employee.employeeId,
    nameAr: employee.nameAr,
    jobTitle: employee.jobTitle,
    department: employee.department,
    basicSalary: employee.basicSalary,
    housingAllowance: employee.housingAllowance,
    transportAllowance: employee.transportAllowance,
    grossSalary: employee.grossSalary,
    netSalary: employee.netSalary,
  };

  async function handleGenerate() {
    if (docType === "bank" && !selectedBank) {
      toast.error("يرجى اختيار البنك أولاً");
      return;
    }
    setGenerating(true);
    try {
      if (docType === "bank") {
        const bank = saudiBanks.find(b => b.id === selectedBank);
        await generateBankConfirmation(emp, bank?.nameAr || selectedBank);
        toast.success(`تم إصدار خطاب تثبيت الراتب لـ ${bank?.nameAr}`);
      } else {
        const embassy = saudiEmbassies.find(e => e.id === selectedEmbassy);
        await generateSalaryCertificate(emp, embassy?.country, purpose || undefined);
        toast.success("تم إصدار خطاب تعريف الراتب بنجاح");
      }
      onClose();
    } catch (err) {
      toast.error("حدث خطأ أثناء إنشاء المستند");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"16px",padding:"28px",width:"100%",maxWidth:"520px",direction:"rtl",maxHeight:"90vh",overflowY:"auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"24px"}}>
          <div>
            <div style={{fontFamily:"Alexandria",fontWeight:900,fontSize:"18px",color:"hsl(var(--foreground))"}}>إصدار وثيقة راتب</div>
            <div style={{fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",marginTop:"2px"}}>{employee.nameAr} — {employee.jobTitle}</div>
          </div>
          <button onClick={onClose} style={{background:"hsl(var(--muted))",border:"none",borderRadius:"8px",padding:"6px",cursor:"pointer",color:"hsl(var(--muted-foreground))"}}>
            <X size={16}/>
          </button>
        </div>

        {/* Document type selector */}
        <div style={{marginBottom:"20px"}}>
          <div style={{fontFamily:"Alexandria",fontSize:"12px",fontWeight:700,color:"hsl(var(--muted-foreground))",marginBottom:"10px"}}>نوع الوثيقة</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
            {[
              { id: "certificate", label: "تعريف الراتب", sub: "للسفارات والجهات العامة", icon: Globe },
              { id: "bank", label: "تثبيت الراتب", sub: "للبنوك فقط", icon: Building2 },
            ].map(opt => {
              const Icon = opt.icon;
              const active = docType === opt.id;
              return (
                <button key={opt.id} onClick={() => setDocType(opt.id as "certificate" | "bank")}
                  style={{background: active ? "hsl(165 69% 39% / 0.15)" : "hsl(var(--card))",border: `2px solid ${active ? "#1FA98C" : "hsl(var(--muted))"}`,borderRadius:"12px",padding:"14px",cursor:"pointer",textAlign:"right",transition:"all 0.2s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
                    <Icon size={16} color={active ? "#1FA98C" : "hsl(var(--muted-foreground))"}/>
                    <span style={{fontFamily:"Alexandria",fontWeight:700,fontSize:"13px",color: active ? "#1FA98C" : "hsl(var(--muted-foreground))"}}>{opt.label}</span>
                  </div>
                  <div style={{fontFamily:"Alexandria",fontSize:"10px",color:"hsl(var(--muted-foreground))"}}>{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bank selection */}
        {docType === "bank" && (
          <div style={{marginBottom:"16px"}}>
            <label style={{fontFamily:"Alexandria",fontSize:"12px",fontWeight:700,color:"hsl(var(--muted-foreground))",display:"block",marginBottom:"8px"}}>اختر البنك *</label>
            <select value={selectedBank} onChange={e => setSelectedBank(e.target.value)}
              style={{width:"100%",background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"10px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",direction:"rtl"}}>
              <option value="">— اختر البنك —</option>
              {saudiBanks.map(b => (
                <option key={b.id} value={b.id}>{b.nameAr}</option>
              ))}
            </select>
          </div>
        )}

        {/* Embassy selection (optional for certificate) */}
        {docType === "certificate" && (
          <>
            <div style={{marginBottom:"16px"}}>
              <label style={{fontFamily:"Alexandria",fontSize:"12px",fontWeight:700,color:"hsl(var(--muted-foreground))",display:"block",marginBottom:"8px"}}>السفارة / الجهة المستلمة (اختياري)</label>
              <select value={selectedEmbassy} onChange={e => setSelectedEmbassy(e.target.value)}
                style={{width:"100%",background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"10px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",direction:"rtl"}}>
                <option value="">— جهة عامة / غير محدد —</option>
                {saudiEmbassies.map(e => (
                  <option key={e.id} value={e.id}>{e.flag} {e.country} — {e.city}</option>
                ))}
              </select>
            </div>
            <div style={{marginBottom:"16px"}}>
              <label style={{fontFamily:"Alexandria",fontSize:"12px",fontWeight:700,color:"hsl(var(--muted-foreground))",display:"block",marginBottom:"8px"}}>الغرض من الخطاب (اختياري)</label>
              <input type="text" value={purpose} onChange={e => setPurpose(e.target.value)}
                placeholder="مثال: تأشيرة سياحية، تجديد إقامة..."
                style={{width:"100%",background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"10px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",direction:"rtl",outline:"none",boxSizing:"border-box"}}/>
            </div>
          </>
        )}

        {/* Salary preview */}
        <div style={{background:"hsl(var(--card))",borderRadius:"10px",padding:"14px",marginBottom:"20px"}}>
          <div style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"hsl(var(--muted-foreground))",marginBottom:"8px"}}>ملخص الراتب</div>
          {[
            ["الراتب الأساسي", employee.basicSalary],
            ["بدل السكن", employee.housingAllowance],
            ["بدل النقل", employee.transportAllowance],
            ["الإجمالي", employee.grossSalary],
            ["الصافي", employee.netSalary],
          ].map(([label, val]) => (
            <div key={String(label)} style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
              <span style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(var(--muted-foreground))"}}>{label}</span>
              <span style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color: label === "الصافي" || label === "الإجمالي" ? "#1FA98C" : "hsl(var(--foreground))"}}>
                {Number(val).toLocaleString("ar-SA-u-ca-gregory")} ر.س
              </span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{display:"flex",gap:"10px"}}>
          <button onClick={handleGenerate} disabled={generating}
            style={{flex:1,background:"#1FA98C",border:"none",borderRadius:"10px",padding:"12px",fontFamily:"Alexandria",fontSize:"13px",fontWeight:700,color:"white",cursor:generating?"not-allowed":"pointer",opacity:generating?0.7:1,display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
            <FileText size={15}/>
            {generating ? "جارٍ الإنشاء..." : docType === "bank" ? "إصدار تثبيت الراتب" : "إصدار تعريف الراتب"}
          </button>
          <button onClick={onClose}
            style={{background:"hsl(var(--muted))",border:"1px solid hsl(var(--border))",borderRadius:"10px",padding:"12px 18px",fontFamily:"Alexandria",fontSize:"13px",fontWeight:700,color:"hsl(var(--muted-foreground))",cursor:"pointer"}}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Payroll Editor ────────────────────────────────────────────────────────────
function EditPayrollModal({ employee, onSave, onClose }: { employee: PayrollRecord; onSave: (id: string, update: Pick<PayrollRecord, "basicSalary" | "housingAllowance" | "transportAllowance" | "gosiDeduction" | "paymentStatus" | "paymentMonth">) => Promise<void>; onClose: () => void }) {
  const [basicSalary, setBasicSalary] = useState(employee.basicSalary);
  const [housingAllowance, setHousingAllowance] = useState(employee.housingAllowance);
  const [transportAllowance, setTransportAllowance] = useState(employee.transportAllowance);
  const [gosiDeduction, setGosiDeduction] = useState(employee.gosiDeduction);
  const [paymentStatus, setPaymentStatus] = useState(employee.paymentStatus);
  const [saving, setSaving] = useState(false);
  const grossSalary = basicSalary + housingAllowance + transportAllowance;
  const netSalary = Math.max(0, grossSalary - gosiDeduction);
  const salaryFields: Array<[string, number, (value: number) => void]> = [
    ["الراتب الأساسي", basicSalary, setBasicSalary],
    ["بدل السكن", housingAllowance, setHousingAllowance],
    ["بدل النقل", transportAllowance, setTransportAllowance],
    ["خصم التأمينات", gosiDeduction, setGosiDeduction],
  ];

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(employee.employeeId, { basicSalary, housingAllowance, transportAllowance, gosiDeduction, paymentStatus, paymentMonth: employee.paymentMonth });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"16px",padding:"24px",width:"100%",maxWidth:"360px",direction:"rtl"}}>
        <div style={{fontFamily:"Alexandria",fontWeight:900,fontSize:"16px",color:"hsl(var(--foreground))",marginBottom:"6px"}}>تعديل بيانات الراتب</div>
        <div style={{fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",marginBottom:"20px"}}>{employee.nameAr}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"16px"}}>
          {salaryFields.map(([label, value, setValue]) => (
            <label key={String(label)} style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(var(--muted-foreground))"}}>
              {label}
              <input type="number" min="0" step="0.01" value={value} onChange={e => setValue(Math.max(0, Number(e.target.value) || 0))}
                style={{width:"100%",marginTop:"5px",boxSizing:"border-box",background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:"8px",padding:"9px 10px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",direction:"ltr"}} />
            </label>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"16px",padding:"10px",background:"hsl(var(--card))",borderRadius:"8px"}}>
          <div><div style={{fontFamily:"Alexandria",fontSize:"10px",color:"hsl(var(--muted-foreground))"}}>الإجمالي المحسوب</div><div style={{fontFamily:"Alexandria",fontSize:"13px",fontWeight:800,color:"hsl(var(--foreground))"}}>{grossSalary.toLocaleString()} ر.س</div></div>
          <div><div style={{fontFamily:"Alexandria",fontSize:"10px",color:"hsl(var(--muted-foreground))"}}>الصافي المحسوب</div><div style={{fontFamily:"Alexandria",fontSize:"13px",fontWeight:800,color:"#1FA98C"}}>{netSalary.toLocaleString()} ر.س</div></div>
        </div>
        <div style={{display:"flex",gap:"10px",marginBottom:"20px"}}>
          {["مدفوع","معلق"].map(s => (
            <button key={s} onClick={() => setPaymentStatus(s)}
              style={{flex:1,background: paymentStatus===s ? "hsl(165 69% 39% / 0.15)" : "hsl(var(--card))",border:`2px solid ${paymentStatus===s ? "#1FA98C" : "hsl(var(--muted))"}`,borderRadius:"10px",padding:"12px",fontFamily:"Alexandria",fontSize:"13px",fontWeight:700,color: paymentStatus===s ? "#1FA98C" : "hsl(var(--muted-foreground))",cursor:"pointer"}}>
              {s}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:"10px"}}>
          <button onClick={handleSave} disabled={saving}
            style={{flex:1,background:"#1FA98C",border:"none",borderRadius:"10px",padding:"10px",fontFamily:"Alexandria",fontSize:"13px",fontWeight:700,color:"white",cursor:saving?"not-allowed":"pointer",opacity:saving?0.7:1,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>
            <Check size={14}/> {saving ? "جارٍ الحفظ..." : "حفظ"}
          </button>
          <button onClick={onClose}
            style={{background:"hsl(var(--muted))",border:"1px solid hsl(var(--border))",borderRadius:"10px",padding:"10px 16px",fontFamily:"Alexandria",fontSize:"13px",fontWeight:700,color:"hsl(var(--muted-foreground))",cursor:"pointer"}}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Payroll() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("الكل");
  const [filterDept, setFilterDept] = useState("الكل");
  const [docEmployee, setDocEmployee] = useState<PayrollRecord | null>(null);
  const [editEmployee, setEditEmployee] = useState<PayrollRecord | null>(null);
  const [localData, setLocalData] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hcm/payroll", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const mappedData = d.map((item: any) => ({
          employeeId: item.employee_id || item.employeeId,
          nameAr: item.name_ar || item.nameAr,
          department: item.department_en || item.department,
          jobTitle: item.job_title || item.jobTitle,
          basicSalary: item.basic_salary || item.basicSalary,
          housingAllowance: item.housing_allowance || item.housingAllowance,
          transportAllowance: item.transport_allowance || item.transportAllowance,
          grossSalary: item.total_salary || item.grossSalary,
          gosiDeduction: item.gosi_deduction || item.gosiDeduction || 0,
          netSalary: item.net_salary || item.netSalary || (item.total_salary || item.grossSalary),
          paymentStatus: item.payment_status || item.paymentStatus || "معلق",
          paymentMonth: item.payment_month || item.paymentMonth || "",
        }));
        setLocalData(mappedData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const departments = useMemo(() => ["الكل",...Array.from(new Set(localData.map(r=>r.department))).sort()],[localData]);
  const filtered = useMemo(() => {
    let rows = [...localData];
    if (search.trim()) { const q=search.trim().toLowerCase(); rows=rows.filter(r=>r.nameAr.includes(q)||r.employeeId.includes(q)||r.department.includes(q)); }
    if (filterStatus!=="الكل") rows=rows.filter(r=>r.paymentStatus===filterStatus);
    if (filterDept!=="الكل") rows=rows.filter(r=>r.department===filterDept);
    return rows;
  },[search,filterStatus,filterDept,localData]);

  const kpis = useMemo(()=>({
    totalNet:filtered.reduce((s,r)=>s+r.netSalary,0),
    totalGross:filtered.reduce((s,r)=>s+r.grossSalary,0),
    paid:filtered.filter(r=>r.paymentStatus==="مدفوع").length,
    pending:filtered.filter(r=>r.paymentStatus==="معلق").length,
    avgNet:Math.round(filtered.reduce((s,r)=>s+r.netSalary,0)/(filtered.length||1)),
  }),[filtered]);

  function handleExport() {
    exportPayroll(filtered.map(r => ({
      employeeId: r.employeeId, nameAr: r.nameAr, department: r.department,
      jobTitle: r.jobTitle, baseSalary: r.basicSalary, housingAllowance: r.housingAllowance,
      transportAllowance: r.transportAllowance, otherAllowances: 0,
      totalSalary: r.grossSalary, gosi: r.gosiDeduction, netSalary: r.netSalary,
    })));
    toast.success('جارٍ تحميل ملف Excel...');
  }

  async function handlePayrollSave(employeeId: string, update: Pick<PayrollRecord, "basicSalary" | "housingAllowance" | "transportAllowance" | "gosiDeduction" | "paymentStatus" | "paymentMonth">) {
    const response = await fetch("/api/hcm/payroll", {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, ...update }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      toast.error(result.error || "تعذر حفظ بيانات الراتب");
      throw new Error("Payroll update failed");
    }
    setLocalData(prev => prev.map(r => r.employeeId === employeeId ? {
      ...r, ...update,
      grossSalary: update.basicSalary + update.housingAllowance + update.transportAllowance,
      netSalary: Math.max(0, update.basicSalary + update.housingAllowance + update.transportAllowance - update.gosiDeduction),
    } : r));
    toast.success("تم حفظ بيانات الراتب بنجاح");
  }

  return (
    <>
      {docEmployee && <DocumentModal employee={docEmployee} onClose={() => setDocEmployee(null)} />}
      {editEmployee && <EditPayrollModal employee={editEmployee} onSave={handlePayrollSave} onClose={() => setEditEmployee(null)} />}

      <PageTemplate title="الرواتب والمزايا" subtitle={`مسير رواتب أبريل 2026 — ${localData.length} موظف`} icon={DollarSign}
        stats={[
          {label:"إجمالي الصافي",value:kpis.totalNet.toLocaleString()+" ر.س",color:"#1FA98C"},
          {label:"مدفوع",value:String(kpis.paid),color:"#10B981"},
          {label:"معلق",value:String(kpis.pending),color:"#F59E0B"},
          {label:"متوسط الراتب",value:kpis.avgNet.toLocaleString()+" ر.س",color:"#8B5CF6"},
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-brand flex items-center gap-2" onClick={() => document.getElementById("advanced-payslip-select")?.focus()}><Plus size={14}/><span>إنشاء قسيمة</span></button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold" style={{fontFamily:'Alexandria',background:'hsl(165 69% 39% / 0.15)',color:'#1FA98C',border:'1px solid hsl(165 69% 39% / 0.30)'}} onClick={handleExport}><Download size={14}/><span>تصدير</span></button>
          </div>
        }
      >
        {(user?.role === "admin" || user?.role === "owner") && <SalaryStructuresPanel employees={localData} />}
        <AdvancedPayslipPanel employees={localData} />
        {loading ? (
          <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(var(--muted-foreground))",fontFamily:"Alexandria"}}>
            <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>جارٍ تحميل البيانات...</div>
          </div>
        ) : localData.length === 0 ? (
          <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(var(--muted-foreground))",fontFamily:"Alexandria"}}>
            <DollarSign size={48} style={{margin:"0 auto 16px",opacity:0.3}} />
            <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>لا توجد بيانات رواتب بعد</div>
            <div style={{fontSize:"13px"}}>سيتم عرض مسير الرواتب هنا بعد إدخال البيانات</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {[
                {label:"إجمالي الرواتب الصافية",value:kpis.totalNet.toLocaleString()+" ر.س",icon:DollarSign,color:"#1FA98C"},
                {label:"إجمالي الرواتب الإجمالية",value:kpis.totalGross.toLocaleString()+" ر.س",icon:TrendingUp,color:"#8B5CF6"},
                {label:"رواتب مدفوعة",value:`${kpis.paid} موظف`,icon:CheckCircle,color:"#10B981"},
                {label:"رواتب معلقة",value:`${kpis.pending} موظف`,icon:Clock,color:"#F59E0B"},
              ].map((k,i)=>{const Icon=k.icon;return(
                <div key={k.label} className="stat-card animate-fade-in-up" style={{animationDelay:`${i*60}ms`,opacity:0}}>
                  <div className="flex items-start justify-between mb-2">
                    <div style={{width:"36px",height:"36px",borderRadius:"10px",background:`${k.color}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon size={17} color={k.color}/></div>
                  </div>
                  <div style={{fontFamily:"Alexandria",fontWeight:800,fontSize:"15px",color:k.color}}>{k.value}</div>
                  <div style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(var(--muted-foreground))",marginTop:"2px"}}>{k.label}</div>
                </div>
              );})}
            </div>

            {/* Filters */}
            <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",direction:"rtl"}}>
              <div style={{display:"flex",alignItems:"center",gap:"8px",background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"6px 12px",flex:1,minWidth:"200px"}}>
                <Search size={14} color="hsl(var(--muted-foreground))"/>
                <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو الرقم الوظيفي..."
                  style={{background:"none",border:"none",outline:"none",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",direction:"rtl",width:"100%"}}/>
              </div>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
                style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"6px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",direction:"rtl"}}>
                {["الكل","مدفوع","معلق"].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterDept} onChange={e=>setFilterDept(e.target.value)}
                style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--muted))",borderRadius:"8px",padding:"6px 12px",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--muted-foreground))",direction:"rtl",maxWidth:"200px"}}>
                {departments.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Table */}
            <div className="card-brand rounded-xl overflow-hidden">
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",direction:"rtl"}}>
                  <thead>
                    <tr>
                      {["الرقم","الاسم","القسم","المسمى الوظيفي","الراتب الأساسي","بدل السكن","بدل النقل","الإجمالي","التأمينات","الصافي","الحالة","الوثائق","تعديل"].map(h=>
                        <th key={h} style={thS}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r,idx)=>{
                      const sc=statusColors[r.paymentStatus]||{color:"#888",bg:"rgba(128,128,128,0.1)"};
                      return(
                        <tr key={r.employeeId} style={{background:idx%2===0?"transparent":"hsl(var(--card))"}}>
                          <td style={{...tdS,color:"#1FA98C",fontWeight:700}}>{r.employeeId}</td>
                          <td style={{...tdS,fontWeight:600,whiteSpace:"nowrap"}}>{r.nameAr}</td>
                          <td style={{...tdS,fontSize:"11px",color:"hsl(var(--muted-foreground))"}}>{r.department}</td>
                          <td style={{...tdS,fontSize:"11px",color:"hsl(var(--muted-foreground))",maxWidth:"150px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.jobTitle}</td>
                          <td style={tdS}>{r.basicSalary.toLocaleString()}</td>
                          <td style={tdS}>{r.housingAllowance.toLocaleString()}</td>
                          <td style={tdS}>{r.transportAllowance.toLocaleString()}</td>
                          <td style={{...tdS,fontWeight:700}}>{r.grossSalary.toLocaleString()}</td>
                          <td style={{...tdS,color:"#EF4444"}}>({r.gosiDeduction.toLocaleString()})</td>
                          <td style={{...tdS,fontWeight:800,color:"#1FA98C"}}>{r.netSalary.toLocaleString()}</td>
                          <td style={tdS}>
                            <span style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:sc.color,background:sc.bg,padding:"3px 10px",borderRadius:"20px"}}>{r.paymentStatus}</span>
                          </td>
                          {/* Document button */}
                          <td style={{...tdS,whiteSpace:"nowrap"}}>
                            <button onClick={() => setDocEmployee(r)}
                              style={{display:"flex",alignItems:"center",gap:"4px",background:"hsl(165 69% 39% / 0.12)",border:"1px solid hsl(165 69% 39% / 0.30)",borderRadius:"6px",padding:"4px 10px",fontFamily:"Alexandria",fontSize:"10px",fontWeight:700,color:"#1FA98C",cursor:"pointer",whiteSpace:"nowrap"}}>
                              <FileText size={11}/> وثيقة
                            </button>
                          </td>
                          {/* Edit button */}
                          <td style={tdS}>
                            <button onClick={() => setEditEmployee(r)}
                              style={{display:"flex",alignItems:"center",gap:"4px",background:"rgba(139,92,246,0.12)",border:"1px solid rgba(139,92,246,0.3)",borderRadius:"6px",padding:"4px 10px",fontFamily:"Alexandria",fontSize:"10px",fontWeight:700,color:"#8B5CF6",cursor:"pointer"}}>
                              <Edit2 size={11}/> تعديل
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:"hsl(var(--card))"}}>
                      <td colSpan={7} style={{...tdS,fontWeight:800,color:"hsl(var(--muted-foreground))"}}>الإجمالي ({filtered.length} موظف)</td>
                      <td style={{...tdS,fontWeight:800}}>{filtered.reduce((s,r)=>s+r.grossSalary,0).toLocaleString()}</td>
                      <td style={{...tdS,fontWeight:800,color:"#EF4444"}}>({filtered.reduce((s,r)=>s+r.gosiDeduction,0).toLocaleString()})</td>
                      <td style={{...tdS,fontWeight:800,fontSize:"14px",color:"#1FA98C"}}>{filtered.reduce((s,r)=>s+r.netSalary,0).toLocaleString()} ر.س</td>
                      <td style={tdS}></td>
                      <td style={tdS}></td>
                      <td style={tdS}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </PageTemplate>
    </>
  );
}
