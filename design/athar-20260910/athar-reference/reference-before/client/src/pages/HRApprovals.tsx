import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, CalendarDays, FileText,
  Clock, User, Building2, Loader2, RefreshCw, AlertCircle,
  Inbox, DollarSign, Edit3, MessageSquare, Briefcase, PalmtreeIcon, BookOpen
} from "lucide-react";
import { generateSalaryCertificate, generateSalaryCertificateEnglish, generateBankConfirmation, type SalaryDocEmployee } from "@/lib/salaryDocuments";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "pending" | "approved" | "rejected";
  reason: string;
  appliedDate: string;
  approvedBy?: string;
  rejectionReason?: string;
}

interface SalaryLetterRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  jobTitle: string;
  purpose: string;
  recipientName: string;
  recipientNameEn: string;
  language: string;
  notes: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  rejectionReason?: string;
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "إجازة سنوية",
  sick: "إجازة مرضية",
  maternity: "إجازة أمومة",
  paternity: "إجازة أبوة",
  hajj: "إجازة حج",
  marriage: "إجازة زواج",
  bereavement: "إجازة وفاة",
  study: "إجازة دراسية",
  iddah: "إجازة عدة",
};

const PURPOSE_LABELS: Record<string, string> = {
  bank: "للبنك",
  embassy: "للسفارة",
  government: "للجهات الحكومية",
  housing: "للإسكان",
  general: "عام",
};

const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.15)";

async function generateSalaryLetterByLanguage(docEmployee: SalaryDocEmployee, req: SalaryLetterRequest) {
  const purpose = PURPOSE_LABELS[req.purpose] || req.purpose;
  if (req.language !== "en") {
    if (req.purpose === "bank") {
      await generateBankConfirmation(docEmployee, req.recipientName || "البنك");
    } else {
      await generateSalaryCertificate(docEmployee, req.recipientName || undefined, req.recipientNameEn || undefined, purpose);
    }
  }
  if (req.language !== "ar") {
    await generateSalaryCertificateEnglish(docEmployee, req.recipientNameEn || req.recipientName || undefined, purpose);
  }
}

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">موافق عليه</Badge>;
  if (status === "rejected") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">مرفوض</Badge>;
  return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">قيد المراجعة</Badge>;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" });
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function HRApprovals() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("leave");
  const [loading, setLoading] = useState(false);

  // Leave requests
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveFilter, setLeaveFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  // Salary letters
  const [salaryLetters, setSalaryLetters] = useState<SalaryLetterRequest[]>([]);
  const [salaryFilter, setSalaryFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  // Self-service requests from employee portal
  interface SelfServiceRequest {
    id: string;
    employeeId: string;
    employeeName: string | null;
    requestType: string;
    title: string;
    details: string | null;
    status: string;
    approvedBy: string | null;
    approvedAt: number | null;
    createdAt: number;
    updatedAt: number;
  }
  const [selfServiceRequests, setSelfServiceRequests] = useState<SelfServiceRequest[]>([]);
  const [ssFilter, setSsFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  // Rejection dialog
  const [rejectDialog, setRejectDialog] = useState<{ type: "leave" | "salary"; id: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // PDF generation loading
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);


  const [employees, setEmployees] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/hcm/employees", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/hcm/payroll", { credentials: "include" }).then(r => r.ok ? r.json() : [])
    ]).then(([empData, payData]) => {
      // Map snake_case to camelCase
      const mappedEmp = empData.map((e: any) => ({
        ...e,
        employeeId: e.employee_id || e.employeeId,
        nameAr: e.name_ar || e.nameAr,
        jobTitle: e.job_title || e.jobTitle,
        department: e.department_en || e.department,
        birthDate: e.birth_date || e.birthDate,
        contractStart: e.contract_start || e.contractStart,
        contractEnd: e.contract_end || e.contractEnd,
        nationalId: e.national_id || e.nationalId,
        maritalStatus: e.marital_status || e.maritalStatus,
        cvLink: e.cv_link || e.cvLink,
        iqamaNumber: e.iqama_number || e.iqamaNumber,
        nationality: e.nationality || e.nationality,
        hireDate: e.hire_date || e.hireDate,
        contractType: e.contract_type || e.contractType
      }));
      
      const mappedPay = payData.map((p: any) => ({
        ...p,
        employeeId: p.employee_id || p.employeeId,
        basicSalary: p.basic_salary || p.basicSalary,
        housingAllowance: p.housing_allowance || p.housingAllowance,
        transportAllowance: p.transport_allowance || p.transportAllowance,
        totalSalary: p.total_salary || p.totalSalary,
        grossSalary: p.gross_salary || p.grossSalary,
        netSalary: p.net_salary || p.netSalary,
        bankName: p.bank_name || p.bankName,
        ibanNumber: p.iban_number || p.ibanNumber
      }));
      
      setEmployees(mappedEmp);
      setPayroll(mappedPay);
      setDataLoading(false);
    }).catch(() => setDataLoading(false));
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [leaveRes, salaryRes, ssRes] = await Promise.all([
        fetch("/api/leave-requests", { credentials: "include" }),
        fetch("/api/salary-letters", { credentials: "include" }),
        fetch("/api/services/self-service-requests", { credentials: "include" }),
      ]);
      if (leaveRes.ok) setLeaveRequests(await leaveRes.json());
      if (salaryRes.ok) setSalaryLetters(await salaryRes.json());
      if (ssRes.ok) {
        const ssData = await ssRes.json();
        // Enrich with employee names from employees state
        const enriched = (ssData || []).map((r: SelfServiceRequest) => ({
          ...r,
          employeeName: r.employeeName || employees.find(e => String(e.employeeId) === String(r.employeeId))?.nameAr || `موظف #${r.employeeId}`,
        }));
        setSelfServiceRequests(enriched);
      }
    } catch {
      toast.error("تعذّر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [employees]);

  useEffect(() => { loadData(); }, [loadData]);

  // Approve leave
  const approveLeave = async (id: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status: "approved", approvedBy: user?.id }),
      });
      if ((await res.json()).success) {
        toast.success("✅ تمت الموافقة على طلب الإجازة");
        await loadData();
      }
    } catch { toast.error("حدث خطأ"); }
    finally { setSubmitting(false); }
  };

  // Reject leave
  const rejectLeave = async (id: string, reason: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status: "rejected", rejectionReason: reason }),
      });
      if ((await res.json()).success) {
        toast.success("تم رفض طلب الإجازة");
        setRejectDialog(null);
        setRejectionReason("");
        await loadData();
      }
    } catch { toast.error("حدث خطأ"); }
    finally { setSubmitting(false); }
  };

  // Approve salary letter + generate PDF
  const approveSalaryLetter = async (req: SalaryLetterRequest) => {
    setGeneratingPdf(req.id);
    try {
      // First approve in DB
      const res = await fetch(`/api/salary-letters/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "approved" }),
      });
      if (!(await res.json()).success) { toast.error("حدث خطأ في الموافقة"); return; }

      // Find employee payroll data
      const emp = employees.find(e => e.employeeId === req.employeeId);
      const pay = payroll.find(p => p.employeeId === req.employeeId);

      if (!emp || !pay) {
        toast.warning("تمت الموافقة لكن لا توجد بيانات راتب لتوليد PDF");
        await loadData();
        return;
      }

      const docEmployee: SalaryDocEmployee = {
        employeeId: emp.employeeId,
        nameAr: emp.nameAr,
        jobTitle: emp.jobTitle,
        department: emp.department,
        basicSalary: pay.basicSalary || 0,
        housingAllowance: pay.housingAllowance || 0,
        transportAllowance: pay.transportAllowance || 0,
        grossSalary: pay.grossSalary || 0,
        netSalary: pay.netSalary || 0,
        hireDate: emp.hireDate,
        contractType: emp.contractType,
        nationalId: emp.nationalId,
        iqamaNumber: emp.iqamaNumber,
        nationality: emp.nationality,
      };

      await generateSalaryLetterByLanguage(docEmployee, req);

      toast.success("✅ تمت الموافقة وتم توليد PDF التعريف بالراتب");
      await loadData();
    } catch (e: any) {
      toast.error("حدث خطأ: " + e?.message);
    } finally {
      setGeneratingPdf(null);
    }
  };

  // Reject salary letter
  const rejectSalaryLetter = async (id: string, reason: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/salary-letters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "rejected", rejectionReason: reason }),
      });
      if ((await res.json()).success) {
        toast.success("تم رفض طلب التعريف");
        setRejectDialog(null);
        setRejectionReason("");
        await loadData();
      }
    } catch { toast.error("حدث خطأ"); }
    finally { setSubmitting(false); }
  };

  // Re-generate PDF for approved salary letter
  const regeneratePdf = async (req: SalaryLetterRequest) => {
    setGeneratingPdf(req.id);
    try {
      const emp = employees.find(e => e.employeeId === req.employeeId);
      const pay = payroll.find(p => p.employeeId === req.employeeId);
      if (!emp || !pay) { toast.error("لا توجد بيانات راتب"); return; }
      const docEmployee: SalaryDocEmployee = {
        employeeId: emp.employeeId,
        nameAr: emp.nameAr,
        jobTitle: emp.jobTitle,
        department: emp.department,
        basicSalary: pay.basicSalary || 0,
        housingAllowance: pay.housingAllowance || 0,
        transportAllowance: pay.transportAllowance || 0,
        grossSalary: pay.grossSalary || 0,
        netSalary: pay.netSalary || 0,
        hireDate: emp.hireDate,
        contractType: emp.contractType,
        nationalId: emp.nationalId,
        iqamaNumber: emp.iqamaNumber,
        nationality: emp.nationality,
      };
      await generateSalaryLetterByLanguage(docEmployee, req);
      toast.success("✅ تم إعادة توليد PDF");
    } catch (e: any) {
      toast.error("حدث خطأ: " + e?.message);
    } finally {
      setGeneratingPdf(null);
    }
  };

  // Access control
  const canAccess = user && ["owner", "admin", "manager"].includes(user.role || "");
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <div className="text-center space-y-3">
          <AlertCircle size={48} className="mx-auto" style={{ color: "#EF4444" }} />
          <p className="text-lg font-bold" style={{ color: "hsl(0 0% 88%)" }}>غير مصرح</p>
          <p className="text-sm" style={{ color: "hsl(0 0% 55%)" }}>هذه الصفحة متاحة فقط لمدراء الموارد البشرية</p>
        </div>
      </div>
    );
  }

  const pendingLeave = leaveRequests.filter(r => r.status === "pending").length;
  const pendingSalary = salaryLetters.filter(r => r.status === "pending").length;
  const pendingSS = selfServiceRequests.filter(r => r.status === "pending").length;

  const filteredLeave = leaveFilter === "all" ? leaveRequests : leaveRequests.filter(r => r.status === leaveFilter);
  const filteredSalary = salaryFilter === "all" ? salaryLetters : salaryLetters.filter(r => r.status === salaryFilter);
  const filteredSS = ssFilter === "all" ? selfServiceRequests : selfServiceRequests.filter(r => r.status === ssFilter);

  // Self-service request type labels and icons
  const SS_TYPE_LABELS: Record<string, string> = {
    advance_request: "طلب سلفة",
    overtime: "عمل إضافي",
    data_update: "تعديل بيانات",
    hr_contact: "تواصل مع HR",
    leave_request: "طلب إجازة",
    training_course: "طلب دورة تدريبية",
    general: "طلب عام",
  };
  const SS_TYPE_COLORS: Record<string, string> = {
    advance_request: "#8B5CF6",
    overtime: "#F59E0B",
    data_update: "#3B82F6",
    hr_contact: "#EC4899",
    leave_request: "#10B981",
    training_course: "#0EA5E9",
    general: "#6B7280",
  };

  // Approve/reject self-service request
  const approveSS = async (id: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/services/self-service-requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) {
        toast.success("✅ تمت الموافقة على الطلب");
        await loadData();
      }
    } catch { toast.error("حدث خطأ"); }
    finally { setSubmitting(false); }
  };

  const rejectSS = async (id: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/services/self-service-requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "rejected" }),
      });
      if (res.ok) {
        toast.success("تم رفض الطلب");
        await loadData();
      }
    } catch { toast.error("حدث خطأ"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="p-4 md:p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(0 0% 88%)", fontFamily: "Alexandria" }}>
            الموافقات والطلبات
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(0 0% 55%)" }}>
            مراجعة طلبات الإجازات وتعريف الراتب
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}
          style={{ borderColor: "hsl(0 0% 33%)", color: "hsl(0 0% 72%)" }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          <span className="mr-1">تحديث</span>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "طلبات إجازة معلقة", value: pendingLeave, color: "#F59E0B" },
          { label: "طلبات تعريف معلقة", value: pendingSalary, color: peoplePrimary },
          { label: "طلبات بوابة الموظف معلقة", value: pendingSS, color: "#8B5CF6" },
          { label: "إجمالي طلبات الإجازة", value: leaveRequests.length, color: "hsl(0 0% 55%)" },
          { label: "إجمالي طلبات التعريف", value: salaryLetters.length, color: "hsl(0 0% 55%)" },
        ].map(item => (
          <Card key={item.label} style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)" }}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-3xl font-bold mb-1" style={{ color: item.color }}>{item.value}</p>
              <p className="text-xs" style={{ color: "hsl(0 0% 55%)" }}>{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList style={{ background: "hsl(0 0% 20%)" }}>
          <TabsTrigger value="leave" className="gap-2">
            <CalendarDays size={15} />
            طلبات الإجازة
            {pendingLeave > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: "#F59E0B", color: "#000" }}>
                {pendingLeave}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="salary" className="gap-2">
            <FileText size={15} />
            تعريف الراتب
            {pendingSalary > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: peoplePrimary, color: "hsl(var(--primary-foreground))" }}>
                {pendingSalary}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="portal" className="gap-2">
            <Inbox size={15} />
            طلبات الموظفين
            {pendingSS > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: "#8B5CF6", color: "#fff" }}>
                {pendingSS}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── LEAVE REQUESTS ───────────────────────────────────────────────── */}
        <TabsContent value="leave" className="space-y-4 mt-4">
          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            {(["pending", "approved", "rejected", "all"] as const).map(f => (
              <button key={f} onClick={() => setLeaveFilter(f)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: leaveFilter === f ? peoplePrimary : "hsl(var(--muted))",
                  color: leaveFilter === f ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                  border: `1px solid ${leaveFilter === f ? peoplePrimary : "hsl(var(--border))"}`,
                }}>
                {f === "pending" ? "معلقة" : f === "approved" ? "موافق عليها" : f === "rejected" ? "مرفوضة" : "الكل"}
              </button>
            ))}
          </div>

          {filteredLeave.length === 0 ? (
            <div className="text-center py-16" style={{ color: "hsl(0 0% 45%)" }}>
              <CalendarDays size={48} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد طلبات</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLeave.slice().reverse().map(req => (
                <Card key={req.id} style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)" }}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                        style={{ background: peoplePrimarySoft, color: peoplePrimary }}>
                        {req.employeeName?.charAt(0) || "م"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-sm" style={{ color: "hsl(0 0% 88%)" }}>
                            {req.employeeName}
                          </span>
                          {statusBadge(req.status)}
                        </div>
                        <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: "hsl(0 0% 55%)" }}>
                          <span className="flex items-center gap-1">
                            <Building2 size={11} />
                            {req.department}
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarDays size={11} />
                            {LEAVE_TYPE_LABELS[req.leaveType] || req.leaveType}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {req.startDate} → {req.endDate} ({req.days} أيام)
                          </span>
                        </div>
                        {req.reason && (
                          <p className="text-xs mt-1" style={{ color: "hsl(0 0% 45%)" }}>
                            السبب: {req.reason}
                          </p>
                        )}
                        {req.status === "rejected" && req.rejectionReason && (
                          <p className="text-xs mt-1" style={{ color: "#EF4444" }}>
                            سبب الرفض: {req.rejectionReason}
                          </p>
                        )}
                      </div>
                      {req.status === "pending" && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button size="sm" onClick={() => approveLeave(req.id)} disabled={submitting}
                            style={{ background: peoplePrimarySoft, color: peoplePrimary, border: "1px solid hsl(var(--primary) / 0.30)" }}>
                            <CheckCircle size={14} />
                          </Button>
                          <Button size="sm" onClick={() => { setRejectDialog({ type: "leave", id: req.id }); setRejectionReason(""); }}
                            style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                            <XCircle size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── SALARY LETTER REQUESTS ───────────────────────────────────────── */}
        <TabsContent value="salary" className="space-y-4 mt-4">
          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            {(["pending", "approved", "rejected", "all"] as const).map(f => (
              <button key={f} onClick={() => setSalaryFilter(f)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: salaryFilter === f ? peoplePrimary : "hsl(var(--muted))",
                  color: salaryFilter === f ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                  border: `1px solid ${salaryFilter === f ? peoplePrimary : "hsl(var(--border))"}`,
                }}>
                {f === "pending" ? "معلقة" : f === "approved" ? "موافق عليها" : f === "rejected" ? "مرفوضة" : "الكل"}
              </button>
            ))}
          </div>

          {filteredSalary.length === 0 ? (
            <div className="text-center py-16" style={{ color: "hsl(0 0% 45%)" }}>
              <FileText size={48} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد طلبات</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSalary.slice().reverse().map(req => (
                <Card key={req.id} style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)" }}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                        style={{ background: peoplePrimarySoft, color: peoplePrimary }}>
                        {req.employeeName?.charAt(0) || "م"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-sm" style={{ color: "hsl(0 0% 88%)" }}>
                            {req.employeeName}
                          </span>
                          {statusBadge(req.status)}
                        </div>
                        <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: "hsl(0 0% 55%)" }}>
                          <span className="flex items-center gap-1">
                            <Building2 size={11} />
                            {req.department}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText size={11} />
                            {PURPOSE_LABELS[req.purpose] || req.purpose}
                          </span>
                          {req.recipientName && (
                            <span className="flex items-center gap-1">
                              <User size={11} />
                              {req.recipientName}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatDate(req.requestedAt)}
                          </span>
                        </div>
                        {req.notes && (
                          <p className="text-xs mt-1" style={{ color: "hsl(0 0% 45%)" }}>
                            ملاحظات: {req.notes}
                          </p>
                        )}
                        {req.status === "rejected" && req.rejectionReason && (
                          <p className="text-xs mt-1" style={{ color: "#EF4444" }}>
                            سبب الرفض: {req.rejectionReason}
                          </p>
                        )}
                        {req.status === "approved" && (
                          <Button size="sm" variant="outline" className="mt-2 text-xs gap-1"
                            onClick={() => regeneratePdf(req)}
                            disabled={generatingPdf === req.id}
                            style={{ borderColor: "hsl(var(--primary) / 0.30)", color: peoplePrimary }}>
                            {generatingPdf === req.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                            إعادة توليد PDF
                          </Button>
                        )}
                      </div>
                      {req.status === "pending" && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button size="sm" onClick={() => approveSalaryLetter(req)}
                            disabled={generatingPdf === req.id}
                            style={{ background: peoplePrimarySoft, color: peoplePrimary, border: "1px solid hsl(var(--primary) / 0.30)" }}>
                            {generatingPdf === req.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <CheckCircle size={14} />}
                          </Button>
                          <Button size="sm" onClick={() => { setRejectDialog({ type: "salary", id: req.id }); setRejectionReason(""); }}
                            style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                            <XCircle size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── SELF-SERVICE REQUESTS (Employee Portal) ───────────────── */}
        <TabsContent value="portal" className="space-y-4 mt-4">
          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            {(["pending", "approved", "rejected", "all"] as const).map(f => (
              <button key={f} onClick={() => setSsFilter(f)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: ssFilter === f ? "#8B5CF6" : "hsl(0 0% 20%)",
                  color: ssFilter === f ? "#fff" : "hsl(0 0% 55%)",
                  border: `1px solid ${ssFilter === f ? "#8B5CF6" : "hsl(0 0% 28%)"}`,
                }}>
                {f === "pending" ? "معلقة" : f === "approved" ? "موافق عليها" : f === "rejected" ? "مرفوضة" : "الكل"}
              </button>
            ))}
          </div>

          {filteredSS.length === 0 ? (
            <div className="text-center py-16" style={{ color: "hsl(0 0% 45%)" }}>
              <Inbox size={48} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد طلبات</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSS.map(req => {
                const typeColor = SS_TYPE_COLORS[req.requestType] || "#6B7280";
                const typeLabel = SS_TYPE_LABELS[req.requestType] || req.requestType;
                let parsedDetails: any = null;
                try { parsedDetails = JSON.parse(req.details || ""); } catch {}
                return (
                  <Card key={req.id} style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)" }}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                          style={{ background: `${typeColor}20`, color: typeColor }}>
                          {req.requestType === "advance_request" ? <DollarSign size={18} /> :
                           req.requestType === "overtime" ? <Briefcase size={18} /> :
                           req.requestType === "data_update" ? <Edit3 size={18} /> :
                           req.requestType === "hr_contact" ? <MessageSquare size={18} /> :
                           req.requestType === "leave_request" ? <CalendarDays size={18} /> :
                           req.requestType === "training_course" ? <BookOpen size={18} /> :
                           <Inbox size={18} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-sm" style={{ color: "hsl(0 0% 88%)" }}>
                              {req.employeeName || `موظف #${req.employeeId}`}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: `${typeColor}20`, color: typeColor }}>
                              {typeLabel}
                            </span>
                            {statusBadge(req.status)}
                          </div>
                          <p className="text-sm font-medium mb-1" style={{ color: "hsl(0 0% 75%)" }}>
                            {req.title}
                          </p>
                          {req.details && !parsedDetails && (
                            <p className="text-xs" style={{ color: "hsl(0 0% 50%)" }}>
                              {req.details}
                            </p>
                          )}
                          {parsedDetails && req.requestType === "leave_request" && (
                            <div className="text-xs flex gap-3 flex-wrap" style={{ color: "hsl(0 0% 50%)" }}>
                              <span>النوع: {parsedDetails.leaveType}</span>
                              <span>من {parsedDetails.startDate} إلى {parsedDetails.endDate}</span>
                              {parsedDetails.reason && <span>السبب: {parsedDetails.reason}</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-3 text-xs mt-1" style={{ color: "hsl(0 0% 45%)" }}>
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {new Date(req.createdAt).toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "short", day: "numeric" })}
                            </span>
                          </div>
                        </div>
                        {req.status === "pending" && (
                          <div className="flex gap-2 flex-shrink-0">
                            <Button size="sm" onClick={() => approveSS(req.id)} disabled={submitting}
                              style={{ background: peoplePrimarySoft, color: peoplePrimary, border: "1px solid hsl(var(--primary) / 0.30)" }}>
                              <CheckCircle size={14} />
                            </Button>
                            <Button size="sm" onClick={() => rejectSS(req.id)} disabled={submitting}
                              style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                              <XCircle size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Rejection Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!rejectDialog} onOpenChange={() => { setRejectDialog(null); setRejectionReason(""); }}>
        <DialogContent dir="rtl" style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "hsl(0 0% 88%)", fontFamily: "Alexandria" }}>
              رفض الطلب
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-sm mb-2 block" style={{ color: "hsl(0 0% 72%)" }}>
              سبب الرفض (اختياري)
            </Label>
            <Textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="اذكر سبب الرفض للموظف..."
              style={{ background: "hsl(0 0% 15%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)" }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectionReason(""); }}
              style={{ borderColor: "hsl(0 0% 33%)", color: "hsl(0 0% 72%)" }}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                if (!rejectDialog) return;
                if (rejectDialog.type === "leave") rejectLeave(rejectDialog.id, rejectionReason);
                else rejectSalaryLetter(rejectDialog.id, rejectionReason);
              }}
              disabled={submitting}
              style={{ background: "#EF4444", color: "#fff" }}>
              {submitting ? <Loader2 size={16} className="animate-spin ml-2" /> : null}
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
