/**
 * LeaveRequestsTab — Platform-native leave request submission and management
 * Employees can submit requests; admins/owners can approve or reject.
 * Includes leave balance display and management.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Plus, CheckCircle, XCircle, Clock, Trash2, RefreshCw,
  ChevronDown, ChevronUp, FileText, Send, Wallet, Settings,
  AlertTriangle, TrendingDown
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import leaveTypesRaw from "@/data/leaveTypes.json";

type LeaveType = { id: string; nameAr: string; daysPerYear: number; color: string; paid: boolean };
type Employee = { id: number; employeeId: string; nameAr: string; department: string };
type LeaveReq = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string;
  appliedDate: string;
  approvedBy: string | null;
  approvedAt: number | null;
  rejectionReason: string | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
  source?: "local" | "archive";
};

type LeaveBalance = {
  id?: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  leaveType: string;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
};

const leaveTypes = leaveTypesRaw as LeaveType[];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:   { label: "قيد المراجعة", color: "#F59E0B", bg: "rgba(245,158,11,0.12)",  icon: <Clock size={12} /> },
  approved:  { label: "معتمدة",       color: "#1FA98C", bg: "hsl(165 69% 39% / 0.12)", icon: <CheckCircle size={12} /> },
  rejected:  { label: "مرفوضة",       color: "#EF4444", bg: "rgba(239,68,68,0.12)",  icon: <XCircle size={12} /> },
  cancelled: { label: "ملغاة",         color: "#6B7280", bg: "rgba(107,114,128,0.12)", icon: <XCircle size={12} /> },
};

function calcDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : 0;
}

// ─── Balance Card ─────────────────────────────────────────────────────────────
function BalanceCard({ balance }: { balance: LeaveBalance }) {
  const lt = leaveTypes.find(t => t.id === balance.leaveType);
  const remaining = balance.totalDays - balance.usedDays - balance.pendingDays;
  const usedPct = balance.totalDays > 0 ? Math.min(100, ((balance.usedDays + balance.pendingDays) / balance.totalDays) * 100) : 0;
  const color = lt?.color || "#1FA98C";
  const isLow = remaining <= 3 && balance.totalDays > 0;

  return (
    <div style={{
      background: "hsl(var(--card))",
      border: `1px solid ${isLow ? "rgba(239,68,68,0.30)" : "hsl(var(--border))"}`,
      borderRadius: "12px",
      padding: "14px 16px",
      position: "relative",
      overflow: "hidden"
    }}>
      {isLow && (
        <div style={{ position: "absolute", top: "8px", left: "8px" }}>
          <AlertTriangle size={14} color="#EF4444" />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
        <div>
          <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--foreground))" }}>
            {lt?.nameAr || balance.leaveType}
          </div>
          <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
            {balance.year}
          </div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: "Alexandria", fontWeight: 900, fontSize: "22px", color: isLow ? "#EF4444" : color }}>
            {remaining}
          </div>
          <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>متبقي</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: "5px", background: "hsl(var(--border))", borderRadius: "3px", marginBottom: "8px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${usedPct}%`, background: isLow ? "#EF4444" : color, borderRadius: "3px", transition: "width 0.3s" }} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>
          مستخدم: <strong style={{ color: "hsl(var(--muted-foreground))" }}>{balance.usedDays}</strong>
        </span>
        {balance.pendingDays > 0 && (
          <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "#F59E0B" }}>
            معلق: <strong>{balance.pendingDays}</strong>
          </span>
        )}
        <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>
          الإجمالي: <strong style={{ color: "hsl(var(--muted-foreground))" }}>{balance.totalDays}</strong>
        </span>
      </div>
    </div>
  );
}

// ─── Balance Manager (Admin) ──────────────────────────────────────────────────
function BalanceManager({ onClose, employees }: { onClose: () => void, employees: Employee[] }) {
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [totalDays, setTotalDays] = useState(21);
  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const fetchBalances = async (empId: string) => {
    if (!empId) return;
    setLoadingBalances(true);
    try {
      const res = await fetch(`/api/leave-balances?employeeId=${encodeURIComponent(empId)}`);
      const data = await res.json();
      setBalances(Array.isArray(data) ? data : []);
    } catch {
      setBalances([]);
    } finally {
      setLoadingBalances(false);
    }
  };

  useEffect(() => {
    if (selectedEmployee) {
      const emp = employees.find(e => String(e.id) === selectedEmployee);
      if (emp) fetchBalances(emp.employeeId);
    }
  }, [selectedEmployee, employees]);

  const handleSave = async () => {
    if (!selectedEmployee) { toast.error("اختر موظفاً أولاً"); return; }
    const emp = employees.find(e => String(e.id) === selectedEmployee);
    if (!emp) return;
    setSaving(true);
    try {
      const res = await fetch("/api/leave-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: emp.employeeId,
          employeeName: emp.nameAr,
          department: emp.department,
          leaveType,
          year,
          totalDays,
          usedDays: 0,
          pendingDays: 0,
        }),
      });
      if (!res.ok) throw new Error("فشل الحفظ");
      toast.success("تم حفظ الرصيد بنجاح");
      await fetchBalances(emp.employeeId);
    } catch (e: any) {
      toast.error("فشل حفظ الرصيد: " + e?.message);
    } finally {
      setSaving(false);
    }
  };

  const defaultDays = leaveTypes.find(t => t.id === leaveType)?.daysPerYear || 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: "16px", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflowY: "auto", direction: "rtl" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid hsl(var(--muted))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(var(--foreground))" }}>إدارة أرصدة الإجازات</div>
            <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>تعيين وتحديث أرصدة الإجازات السنوية للموظفين</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", fontSize: "20px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {/* Form */}
          <div style={{ background: "hsl(var(--card))", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
            <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--foreground))", marginBottom: "14px" }}>تعيين رصيد جديد</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "5px" }}>الموظف</label>
                <select
                  value={selectedEmployee}
                  onChange={e => setSelectedEmployee(e.target.value)}
                  style={{ width: "100%", padding: "9px 10px", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "12px", direction: "rtl" }}
                >
                  <option value="">— اختر الموظف —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={String(emp.id)}>{emp.nameAr}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "5px" }}>نوع الإجازة</label>
                <select
                  value={leaveType}
                  onChange={e => { setLeaveType(e.target.value); const lt = leaveTypes.find(t => t.id === e.target.value); if (lt) setTotalDays(lt.daysPerYear); }}
                  style={{ width: "100%", padding: "9px 10px", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "12px", direction: "rtl" }}
                >
                  {leaveTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.nameAr}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "5px" }}>
                  إجمالي الأيام {defaultDays > 0 && <span style={{ color: "#1FA98C" }}>(افتراضي: {defaultDays})</span>}
                </label>
                <input
                  type="number"
                  min={0}
                  value={totalDays}
                  onChange={e => setTotalDays(Number(e.target.value))}
                  style={{ width: "100%", padding: "9px 10px", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "5px" }}>السنة</label>
                <input
                  type="number"
                  min={2020}
                  max={2030}
                  value={year}
                  onChange={e => setYear(Number(e.target.value))}
                  style={{ width: "100%", padding: "9px 10px", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !selectedEmployee}
              style={{ padding: "9px 20px", background: saving || !selectedEmployee ? "hsl(var(--border))" : "#1FA98C", border: "none", borderRadius: "8px", color: "#fff", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, cursor: saving || !selectedEmployee ? "not-allowed" : "pointer" }}
            >
              {saving ? "جارٍ الحفظ..." : "حفظ الرصيد"}
            </button>
          </div>

          {/* Current balances for selected employee */}
          {selectedEmployee && (
            <div>
              <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--muted-foreground))", marginBottom: "12px" }}>
                أرصدة الموظف الحالية
              </div>
              {loadingBalances ? (
                <div style={{ textAlign: "center", padding: "20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: "12px" }}>جارٍ التحميل...</div>
              ) : balances.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: "12px" }}>لا توجد أرصدة محددة لهذا الموظف</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" }}>
                  {balances.map((b, i) => <BalanceCard key={i} balance={b} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New Request Form ─────────────────────────────────────────────────────────
function NewRequestForm({ onClose, onSubmit, currentUser, myBalances, employees }: {
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  currentUser: { id: string; name: string; department?: string; role: string };
  myBalances: LeaveBalance[];
  employees: Employee[];
}) {
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // For admin/owner: allow selecting employee
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const isAdmin = currentUser.role === "admin" || currentUser.role === "owner";

  const days = calcDays(startDate, endDate);
  const selectedType = leaveTypes.find(t => t.id === leaveType);

  // Find balance for selected leave type
  const currentBalance = myBalances.find(b => b.leaveType === leaveType);
  const remainingDays = currentBalance
    ? currentBalance.totalDays - currentBalance.usedDays - currentBalance.pendingDays
    : null;
  const exceedsBalance = remainingDays !== null && days > remainingDays;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveType || !startDate || !endDate) {
      toast.error("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    if (days <= 0) {
      toast.error("تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية");
      return;
    }
    if (exceedsBalance && !isAdmin) {
      toast.error(`الأيام المطلوبة (${days}) تتجاوز رصيدك المتاح (${remainingDays})`);
      return;
    }

    let empName = currentUser.name;
    let empId = currentUser.id;
    let dept = currentUser.department || "";

    if (isAdmin && selectedEmployee) {
      const emp = employees.find(e => String(e.id) === selectedEmployee);
      if (emp) {
        empName = emp.nameAr;
        empId = emp.employeeId;
        dept = emp.department;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({ employeeId: empId, employeeName: empName, department: dept, leaveType, startDate, endDate, days, reason, notes });
      toast.success("تم تقديم طلب الإجازة بنجاح");
      onClose();
    } catch (err: any) {
      toast.error("فشل تقديم الطلب: " + (err?.message || "خطأ غير معروف"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", width: "100%", maxWidth: "540px", maxHeight: "90vh", overflowY: "auto", direction: "rtl" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid hsl(var(--muted))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(var(--foreground))" }}>تقديم طلب إجازة</div>
            <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>أدخل تفاصيل طلب الإجازة</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", fontSize: "20px", lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {/* Employee selector for admin */}
          {isAdmin && (
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>الموظف</label>
              <select
                value={selectedEmployee}
                onChange={e => setSelectedEmployee(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", direction: "rtl" }}
              >
                <option value="">— اختر الموظف (أو اترك فارغاً لنفسك) —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={String(emp.id)}>{emp.nameAr} — {emp.department}</option>
                ))}
              </select>
            </div>
          )}

          {/* Leave type */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>نوع الإجازة *</label>
            <select
              required
              value={leaveType}
              onChange={e => setLeaveType(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", direction: "rtl" }}
            >
              <option value="">— اختر نوع الإجازة —</option>
              {leaveTypes.map(t => (
                <option key={t.id} value={t.id}>{t.nameAr} {t.daysPerYear > 0 ? `(${t.daysPerYear} يوم/سنة)` : ""}</option>
              ))}
            </select>
            {/* Balance indicator */}
            {selectedType && !isAdmin && (
              <div style={{ marginTop: "6px", padding: "8px 12px", background: currentBalance ? `${selectedType.color}12` : "hsl(var(--card))", border: `1px solid ${currentBalance ? selectedType.color + "30" : "hsl(var(--border))"}`, borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: selectedType.paid ? selectedType.color : "#9CA3AF" }}>
                  {selectedType.paid ? "إجازة مدفوعة الأجر" : "إجازة غير مدفوعة"}
                </span>
                {currentBalance ? (
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: remainingDays! <= 3 ? "#EF4444" : "#1FA98C", fontWeight: 700 }}>
                    <Wallet size={10} style={{ display: "inline", marginLeft: "4px" }} />
                    الرصيد المتاح: {remainingDays} يوم
                  </span>
                ) : (
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>لا يوجد رصيد محدد</span>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>تاريخ البداية *</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }}
                style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>تاريخ الانتهاء *</label>
              <input
                type="date"
                required
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", boxSizing: "border-box" }}
              />
            </div>
          </div>

          {/* Days badge */}
          {days > 0 && (
            <div style={{ marginBottom: "16px", padding: "10px 14px", background: exceedsBalance ? "rgba(239,68,68,0.10)" : "hsl(165 69% 39% / 0.10)", border: `1px solid ${exceedsBalance ? "rgba(239,68,68,0.25)" : "hsl(165 69% 39% / 0.25)"}`, borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              {exceedsBalance ? <TrendingDown size={14} color="#EF4444" /> : <Clock size={14} color="#1FA98C" />}
              <span style={{ fontFamily: "Alexandria", fontSize: "13px", color: exceedsBalance ? "#EF4444" : "#1FA98C", fontWeight: 700 }}>
                عدد الأيام: {days} يوم
                {exceedsBalance && ` (يتجاوز الرصيد المتاح: ${remainingDays} يوم)`}
              </span>
            </div>
          )}

          {/* Reason */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>سبب الإجازة</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="اذكر سبب طلب الإجازة..."
              style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", resize: "vertical", boxSizing: "border-box", direction: "rtl" }}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>ملاحظات إضافية</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="أي ملاحظات إضافية..."
              style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", resize: "vertical", boxSizing: "border-box", direction: "rtl" }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 20px", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: "13px", cursor: "pointer" }}>
              إلغاء
            </button>
            <button type="submit" disabled={submitting} style={{ padding: "10px 20px", background: submitting ? "hsl(var(--muted-foreground))" : "#1FA98C", border: "none", borderRadius: "8px", color: "#fff", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
              <Send size={14} />
              {submitting ? "جارٍ الإرسال..." : "تقديم الطلب"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reject Dialog ────────────────────────────────────────────────────────────
function RejectDialog({ onClose, onReject }: { onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "14px", width: "100%", maxWidth: "420px", padding: "24px", direction: "rtl" }}>
        <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "15px", color: "hsl(var(--foreground))", marginBottom: "12px" }}>رفض الطلب</div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="اذكر سبب الرفض..."
          style={{ width: "100%", padding: "10px 12px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))", fontFamily: "Alexandria", fontSize: "13px", resize: "vertical", boxSizing: "border-box", direction: "rtl", marginBottom: "16px" }}
        />
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: "13px", cursor: "pointer" }}>إلغاء</button>
          <button
            disabled={loading}
            onClick={async () => { setLoading(true); await onReject(reason); setLoading(false); }}
            style={{ padding: "9px 18px", background: "#EF4444", border: "none", borderRadius: "8px", color: "#fff", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? "جارٍ الرفض..." : "تأكيد الرفض"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LeaveRequestsTab() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<LeaveReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBalanceManager, setShowBalanceManager] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [myBalances, setMyBalances] = useState<LeaveBalance[]>([]);
  const [activeTab, setActiveTab] = useState<"requests" | "balances">("requests");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hcm/employees", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const mapped = d.map((e: any) => ({
          id: e.id,
          employeeId: e.employee_id,
          nameAr: e.name_ar,
          department: e.department_en
        }));
        setEmployees(mapped);
        setEmployeesLoading(false);
      })
      .catch(() => setEmployeesLoading(false));
  }, []);

  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch platform-native requests and the internally archived historical ledger.
      const [localRes, archiveRes] = await Promise.all([
        fetch("/api/leave-requests", { credentials: "include" }),
        fetch("/api/leaves/archive", { credentials: "include" }),
      ]);
      const localData: LeaveReq[] = await localRes.json().then(d => Array.isArray(d) ? d : []).catch(() => []);
      const archivedRaw: any[] = await archiveRes.json().then(d => Array.isArray(d) ? d : []).catch(() => []);
      // Normalize internally archived leaves to the native request shape.
      const archivedData: LeaveReq[] = archivedRaw.map(z => ({
        id: `archive-${z.id}`,
        employeeId: z.employeeId,
        employeeName: z.employeeName,
        department: z.department || "",
        leaveType: z.leaveType,
        startDate: z.startDate,
        endDate: z.endDate,
        days: z.days,
        status: z.status,
        reason: z.reason || "",
        appliedDate: z.appliedDate || "",
        approvedBy: z.approvedBy || null,
        approvedAt: null,
        rejectionReason: null,
        notes: z.notes || "",
        createdAt: 0,
        updatedAt: 0,
        source: "archive" as const,
      }));
      // Merge native requests with the historical archive without triggering a live provider read.
      const localIds = new Set(localData.map(l => l.id));
      const merged = [
        ...localData,
        ...archivedData.filter(z => !localIds.has(z.id)),
      ];
      // Sort by appliedDate descending
      merged.sort((a, b) => (b.appliedDate || "").localeCompare(a.appliedDate || ""));
      setRequests(merged);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMyBalances = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch("/api/leave-balances", { credentials: "include" });
      const data = await res.json();
      setMyBalances(Array.isArray(data) ? data : []);
    } catch {
      setMyBalances([]);
    }
  }, [user?.id]);

  useEffect(() => { fetchRequests(); fetchMyBalances(); }, [fetchRequests, fetchMyBalances]);

  const handleSubmit = async (data: any) => {
    const { employeeName: _employeeName, department: _department, ...leaveRequest } = data;
    const res = await fetch("/api/leave-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(leaveRequest),
    });
    if (!res.ok) throw new Error("فشل تقديم الطلب");
    await fetchRequests();
    await fetchMyBalances();
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch("/api/leave-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status: "approved", approvedBy: user?.name || user?.id }),
      });
      toast.success("تمت الموافقة على الطلب");
      await fetchRequests();
      await fetchMyBalances();
    } catch {
      toast.error("فشل تحديث الطلب");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string, rejectionReason: string) => {
    try {
      await fetch("/api/leave-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status: "rejected", approvedBy: user?.name || user?.id, rejectionReason }),
      });
      toast.success("تم رفض الطلب");
      setRejectTarget(null);
      await fetchRequests();
      await fetchMyBalances();
    } catch {
      toast.error("فشل تحديث الطلب");
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch("/api/leave-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status: "cancelled" }),
      });
      toast.success("تم إلغاء الطلب");
      await fetchRequests();
      await fetchMyBalances();
    } catch {
      toast.error("فشل إلغاء الطلب");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا الطلب؟")) return;
    setActionLoading(id);
    try {
      await fetch("/api/leave-requests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });
      toast.success("تم حذف الطلب");
      await fetchRequests();
    } catch {
      toast.error("فشل حذف الطلب");
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = filterStatus === "all" ? requests : requests.filter(r => r.status === filterStatus);

  // Stats
  const stats = {
    total: requests.length,
    pending: requests.filter(r => r.status === "pending").length,
    approved: requests.filter(r => r.status === "approved").length,
    rejected: requests.filter(r => r.status === "rejected").length,
  };

  return (
    <div style={{ direction: "rtl" }}>
      {showForm && user && (
        <NewRequestForm
          onClose={() => setShowForm(false)}
          onSubmit={handleSubmit}
          currentUser={{ id: user.id, name: user.name || user.id, department: user.department, role: user.role }}
          myBalances={myBalances}
          employees={employees}
        />
      )}
      {showBalanceManager && isAdmin && (
        <BalanceManager onClose={() => setShowBalanceManager(false)} employees={employees} />
      )}
      {rejectTarget && (
        <RejectDialog
          onClose={() => setRejectTarget(null)}
          onReject={(reason) => handleReject(rejectTarget, reason)}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(var(--foreground))" }}>
            {isAdmin ? "إدارة طلبات الإجازة" : "طلبات إجازتي"}
          </div>
          <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
            {isAdmin ? "مراجعة وإدارة جميع طلبات الإجازة والأرصدة" : "تقديم ومتابعة طلبات الإجازة الخاصة بك"}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => { fetchRequests(); fetchMyBalances(); }} style={{ padding: "8px 14px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--muted-foreground))", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
            <RefreshCw size={13} />
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowBalanceManager(true)}
              style={{ padding: "8px 14px", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
            >
              <Settings size={13} />
              إدارة الأرصدة
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            style={{ padding: "8px 16px", background: "#1FA98C", border: "none", borderRadius: "8px", color: "#fff", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          >
            <Plus size={14} />
            طلب إجازة جديد
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px", background: "hsl(var(--background))", borderRadius: "10px", padding: "4px", width: "fit-content" }}>
        {[
          { id: "requests", label: "الطلبات", icon: <FileText size={13} /> },
          { id: "balances", label: "الأرصدة", icon: <Wallet size={13} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: "7px 16px",
              background: activeTab === tab.id ? "#1FA98C" : "transparent",
              border: "none",
              borderRadius: "7px",
              color: activeTab === tab.id ? "#fff" : "hsl(var(--muted-foreground))",
              fontFamily: "Alexandria",
              fontSize: "12px",
              fontWeight: activeTab === tab.id ? 700 : 400,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              transition: "border-color 150ms ease, background-color 150ms ease",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Balances Tab */}
      {activeTab === "balances" && (
        <div>
          <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(var(--foreground))", marginBottom: "14px" }}>
            {isAdmin ? "أرصدة الإجازات" : "أرصدة إجازاتي"}
          </div>
          {myBalances.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", background: "hsl(var(--background))", borderRadius: "12px", border: "1px dashed hsl(var(--border))" }}>
              <Wallet size={32} color="hsl(var(--border))" style={{ marginBottom: "10px" }} />
              <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(var(--muted-foreground))", marginBottom: "6px" }}>لا توجد أرصدة محددة</div>
              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
                {isAdmin ? "استخدم زر \"إدارة الأرصدة\" لتعيين أرصدة الإجازات للموظفين" : "لم يتم تعيين أرصدة إجازات لك بعد، يرجى التواصل مع الموارد البشرية"}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
              {myBalances.map((b, i) => <BalanceCard key={i} balance={b} />)}
            </div>
          )}
        </div>
      )}

      {/* Requests Tab */}
      {activeTab === "requests" && (
        <>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
            {[
              { label: "إجمالي الطلبات", value: stats.total, color: "#1FA98C" },
              { label: "قيد المراجعة",   value: stats.pending,  color: "#F59E0B" },
              { label: "معتمدة",          value: stats.approved, color: "#10B981" },
              { label: "مرفوضة",          value: stats.rejected, color: "#EF4444" },
            ].map(s => (
              <div key={s.label} style={{ background: "hsl(var(--card))", border: `1px solid ${s.color}25`, borderRadius: "10px", padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "Alexandria", fontWeight: 900, fontSize: "24px", color: s.color }}>{s.value}</div>
                <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: "الكل" },
              { id: "pending", label: "قيد المراجعة" },
              { id: "approved", label: "معتمدة" },
              { id: "rejected", label: "مرفوضة" },
              { id: "cancelled", label: "ملغاة" },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilterStatus(f.id)}
                style={{
                  padding: "6px 14px",
                  background: filterStatus === f.id ? "#1FA98C" : "hsl(var(--card))",
                  border: filterStatus === f.id ? "none" : "1px solid hsl(var(--border))",
                  borderRadius: "20px",
                  color: filterStatus === f.id ? "#fff" : "hsl(var(--muted-foreground))",
                  fontFamily: "Alexandria",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* List */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
              <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: "8px" }} />
              <div>جارٍ التحميل...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", background: "hsl(var(--background))", borderRadius: "12px", border: "1px dashed hsl(var(--border))" }}>
              <FileText size={36} color="hsl(var(--border))" style={{ marginBottom: "12px" }} />
              <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "15px", color: "hsl(var(--muted-foreground))", marginBottom: "6px" }}>لا توجد طلبات</div>
              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginBottom: "16px" }}>
                {filterStatus === "all" ? "لم يتم تقديم أي طلبات إجازة بعد" : `لا توجد طلبات بحالة "${STATUS_CONFIG[filterStatus]?.label}"`}
              </div>
              <button
                onClick={() => setShowForm(true)}
                style={{ padding: "10px 20px", background: "#1FA98C", border: "none", borderRadius: "8px", color: "#fff", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                تقديم طلب إجازة
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {filtered.map(req => {
                const sc = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending;
                const lt = leaveTypes.find(t => t.id === req.leaveType);
                const isExpanded = expandedId === req.id;
                const isActioning = actionLoading === req.id;

                return (
                  <div key={req.id} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", overflow: "hidden", transition: "border-color 0.2s" }}>
                    {/* Row */}
                    <div
                      style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: "14px", cursor: "pointer", flexWrap: "wrap" }}
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                    >
                      {/* Leave type color dot */}
                      <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: lt?.color || "#1FA98C", flexShrink: 0 }} />

                      {/* Main info */}
                      <div style={{ flex: 1, minWidth: "180px" }}>
                        <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--foreground))" }}>
                          {req.employeeName}
                        </div>
                        <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
                          {lt?.nameAr || req.leaveType} — {req.department || "—"}
                        </div>
                      </div>

                      {/* Dates */}
                      <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", minWidth: "160px" }}>
                        {req.startDate} → {req.endDate}
                        <span style={{ marginRight: "6px", color: "#1FA98C", fontWeight: 700 }}>({req.days} يوم)</span>
                      </div>

                      {/* Status badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", background: sc.bg, borderRadius: "20px", color: sc.color, fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>
                        {sc.icon}
                        {sc.label}
                      </div>

                      {/* Expand arrow */}
                      <div style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div style={{ borderTop: "1px solid hsl(var(--muted))", padding: "16px 18px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px", marginBottom: "14px" }}>
                          {req.reason && (
                            <div style={{ background: "hsl(var(--card))", borderRadius: "8px", padding: "10px 12px" }}>
                              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginBottom: "3px" }}>سبب الإجازة</div>
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--foreground))" }}>{req.reason}</div>
                            </div>
                          )}
                          {req.notes && (
                            <div style={{ background: "hsl(var(--card))", borderRadius: "8px", padding: "10px 12px" }}>
                              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginBottom: "3px" }}>ملاحظات</div>
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--foreground))" }}>{req.notes}</div>
                            </div>
                          )}
                          <div style={{ background: "hsl(var(--card))", borderRadius: "8px", padding: "10px 12px" }}>
                            <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginBottom: "3px" }}>تاريخ التقديم</div>
                            <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--foreground))" }}>{req.appliedDate}</div>
                          </div>
                          {req.approvedBy && (
                            <div style={{ background: "hsl(var(--card))", borderRadius: "8px", padding: "10px 12px" }}>
                              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginBottom: "3px" }}>
                                {req.status === "approved" ? "اعتمد بواسطة" : "رفض بواسطة"}
                              </div>
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--foreground))" }}>{req.approvedBy}</div>
                            </div>
                          )}
                          {req.rejectionReason && (
                            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)", borderRadius: "8px", padding: "10px 12px", gridColumn: "1 / -1" }}>
                              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "#EF4444", marginBottom: "3px" }}>سبب الرفض</div>
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--foreground))" }}>{req.rejectionReason}</div>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                          {/* Admin actions on pending */}
                          {isAdmin && req.status === "pending" && (
                            <>
                              <button
                                disabled={isActioning}
                                onClick={() => handleApprove(req.id)}
                                style={{ padding: "7px 16px", background: "hsl(165 69% 39% / 0.15)", border: "1px solid hsl(165 69% 39% / 0.35)", borderRadius: "8px", color: "#1FA98C", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: isActioning ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "5px" }}
                              >
                                <CheckCircle size={13} /> موافقة
                              </button>
                              <button
                                disabled={isActioning}
                                onClick={() => setRejectTarget(req.id)}
                                style={{ padding: "7px 16px", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: "8px", color: "#EF4444", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: isActioning ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "5px" }}
                              >
                                <XCircle size={13} /> رفض
                              </button>
                            </>
                          )}

                          {/* Employee can cancel pending */}
                          {!isAdmin && req.status === "pending" && (
                            <button
                              disabled={isActioning}
                              onClick={() => handleCancel(req.id)}
                              style={{ padding: "7px 16px", background: "rgba(107,114,128,0.12)", border: "1px solid rgba(107,114,128,0.30)", borderRadius: "8px", color: "#9CA3AF", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: isActioning ? "not-allowed" : "pointer" }}
                            >
                              إلغاء الطلب
                            </button>
                          )}

                          {/* Admin can delete */}
                          {isAdmin && (
                            <button
                              disabled={isActioning}
                              onClick={() => handleDelete(req.id)}
                              style={{ padding: "7px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)", borderRadius: "8px", color: "#EF4444", fontFamily: "Alexandria", fontSize: "12px", cursor: isActioning ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "5px" }}
                            >
                              <Trash2 size={13} /> حذف
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
