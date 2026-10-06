import AtharScene from "@/components/experience/AtharScene";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapView } from "@/components/Map";
import { toast } from "sonner";
import {
  MapPin, Clock, CheckCircle, XCircle, LogIn, LogOut,
  FileText, CalendarDays, AlertCircle, Navigation, Loader2,
  Building2, Briefcase, RefreshCw, ChevronRight, Landmark, Globe, Users,
  User, Shield, Phone, Mail, Home as HomeIcon, Edit2, Save, Heart, Bell
} from "lucide-react";
import saudiBanks from "@/data/saudiBanks.json";
import saudiEmbassies from "@/data/saudiEmbassies.json";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CheckinStatus {
  checkedIn: boolean;
  checkedOut: boolean;
  checkInTime: number | null;
  checkOutTime: number | null;
  withinZone: boolean | null;
  officeLocation: { lat: number; lng: number; radius: number };
  geoZones?: { lat: number; lng: number; radius: number; name: string }[];
}

interface SalaryLetterRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  purpose: string;
  recipientName: string;
  recipientNameEn: string;
  language: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  rejectionReason?: string;
}

interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "pending" | "approved" | "rejected";
  reason: string;
  appliedDate: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const LEAVE_TYPES = [
  { value: "annual", label: "إجازة سنوية" },
  { value: "sick", label: "إجازة مرضية" },
  { value: "maternity", label: "إجازة أمومة" },
  { value: "paternity", label: "إجازة أبوة" },
  { value: "hajj", label: "إجازة حج" },
  { value: "marriage", label: "إجازة زواج" },
  { value: "bereavement", label: "إجازة وفاة" },
  { value: "study", label: "إجازة دراسية" },
  { value: "iddah", label: "إجازة عدة" },
];

// Recipient type — drives which sub-list appears
const RECIPIENT_TYPES = [
  { value: "bank", label: "بنك", icon: "🏦", description: "تثبيت راتب للبنك (قرض / بطاقة ائتمانية)" },
  { value: "embassy", label: "سفارة", icon: "🏛️", description: "تعريف بالراتب للسفارة (تأشيرة / إقامة)" },
  { value: "government", label: "جهة حكومية", icon: "🏢", description: "تعريف بالراتب للجهات الحكومية" },
  { value: "housing", label: "الإسكان", icon: "🏠", description: "تعريف بالراتب لصندوق التنمية العقارية" },
  { value: "general", label: "عام", icon: "📄", description: "تعريف بالراتب لأغراض عامة" },
];

const PURPOSE_LABELS: Record<string, string> = {
  bank: "للبنك",
  embassy: "للسفارة",
  government: "للجهات الحكومية",
  housing: "للإسكان",
  general: "عام",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(ts: number | null): string {
  if (!ts) return "--:--";
  return new Date(ts).toLocaleTimeString("ar-SA-u-ca-gregory", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" });
}

function statusBadge(status: string) {
  if (status === "approved") {
    return <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"><CheckCircle size={12} aria-hidden="true" />موافق عليه</Badge>;
  }
  if (status === "rejected") {
    return <Badge className="gap-1 border-red-500/30 bg-red-500/20 text-red-700 dark:text-red-300"><XCircle size={12} aria-hidden="true" />مرفوض</Badge>;
  }
  return <Badge className="gap-1 border-amber-500/30 bg-amber-500/20 text-amber-800 dark:text-amber-300"><Clock size={12} aria-hidden="true" />قيد المراجعة</Badge>;
}

function PortalLoadingState() {
  return (
    <div className="min-h-screen p-4 md:p-6" dir="rtl" role="status" aria-live="polite" aria-busy="true" style={{ background: "hsl(var(--background))" }}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="animate-pulse rounded-xl p-6" style={{ background: "hsl(210 4.65% 16.86%)" }}>
          <div className="h-5 w-36 rounded" style={{ background: "hsl(var(--foreground) / 0.16)" }} />
          <div className="mt-3 h-8 w-2/3 rounded" style={{ background: "hsl(var(--foreground) / 0.12)" }} />
          <div className="mt-3 h-4 w-1/2 rounded" style={{ background: "hsl(var(--foreground) / 0.1)" }} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl" style={{ background: "hsl(var(--muted))" }} />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, cardIndex) => (
            <div key={cardIndex} className="surface-card space-y-4 p-5">
              <div className="h-5 w-40 animate-pulse rounded" style={{ background: "hsl(var(--muted))" }} />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-10 animate-pulse rounded-xl" style={{ background: "hsl(var(--muted))" }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>جارٍ تجهيز بوابة الموظف…</p>
      </div>
    </div>
  );
}

function PortalProfileUnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen p-4 md:p-6" dir="rtl" role="alert" style={{ background: "hsl(var(--background))" }}>
      <div className="mx-auto flex min-h-[65vh] max-w-xl flex-col items-center justify-center text-center">
        <div className="surface-card w-full space-y-4 p-6 md:p-8">
          <AlertCircle className="mx-auto h-9 w-9" style={{ color: "hsl(var(--destructive))" }} aria-hidden="true" />
          <h1 className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>تعذّر تحميل ملف الموظف</h1>
          <p className="text-sm leading-6" style={{ color: "hsl(var(--muted-foreground))" }}>
            لم يتم عرض بيانات بديلة أو محفوظة محلياً. تحقّق من الاتصال ثم أعد المحاولة، أو تواصل مع الموارد البشرية إذا استمرت المشكلة.
          </p>
          <Button type="button" onClick={onRetry} className="w-full gap-2" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            <RefreshCw size={16} aria-hidden="true" />
            إعادة المحاولة
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─// ── Employee Portal Login Screen ─────────────────────────────────────────────────────
function EmployeeLoginScreen({ onLogin }: { onLogin: (emp: any) => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !password) { setError("يرجى إدخال رقم الموظف وكلمة المرور"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/employee/portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeId, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onLogin(data.employee);
      } else {
        setError(data.error || "بيانات غير صحيحة");
      }
    } catch {
      setError("تعذّر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center brand-pattern" style={{ background: 'hsl(var(--background))', fontFamily: 'Alexandria' }}>
      <div className="w-full max-w-sm px-4 box-border">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}>
            <span style={{ fontSize: 32 }}>👤</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>بوابة الموظف</h1>
          <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>سجّل دخولك بمعلوماتك الوظيفية</p>
        </div>
        <form onSubmit={handleLogin} className="surface-card space-y-4 p-6">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'hsl(var(--foreground))' }}>رقم الموظف</label>
            <Input
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              placeholder="مثال: 1895"
              className="text-right"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'hsl(var(--foreground))' }}>كلمة المرور</label>
            <Input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="أدخل كلمة المرور"
              type="password"
              className="text-right"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-center" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>}
          <Button type="submit" disabled={loading} className="w-full" style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'تسجيل الدخول'}
          </Button>
        </form>
        <p className="text-center text-xs mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>للحصول على كلمة المرور تواصل مع مدير الموارد البشرية</p>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────
export default function EmployeePortal() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");

  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [payrollData, setPayrollData] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ── Employee Portal Independent Auth ───────────────────────────────────
  // Employees can log in directly with employeeId + nationalId without admin session
  const [portalEmployee, setPortalEmployee] = useState<any>(null);
  const [checkingPortalSession, setCheckingPortalSession] = useState(true);
  const [portalProfileError, setPortalProfileError] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    // Check if there's an existing emp_session cookie
    fetch("/api/employee/portal-me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.success) {
          setPortalEmployee(data.employee);
          setMustChangePassword(Boolean(data.mustChangePassword));
        }
      })
      .catch(() => {})
      .finally(() => setCheckingPortalSession(false));
  }, []);

  useEffect(() => {
    if (checkingPortalSession) return;

    if (portalEmployee?.employeeId) {
      setPortalProfileError(false);
      fetch("/api/employee/portal-profile", { credentials: "include" })
        .then(response => {
          if (!response.ok) throw new Error("portal_profile_unavailable");
          return response.json();
        })
        .then(data => {
          if (!data?.success || !data.employee) throw new Error("portal_profile_unavailable");
          setPortalEmployee(data.employee);
          setEmployeesData([data.employee]);
          setPayrollData([data.employee]);
        })
        .catch(() => {
          setEmployeesData([]);
          setPayrollData([]);
          setPortalProfileError(true);
        })
        .finally(() => setLoadingData(false));
      return;
    }

    const hasAdministrativeSession = user?.role === "owner" || user?.role === "admin" || user?.role === "manager";
    if (!hasAdministrativeSession) {
      setEmployeesData([]);
      setPayrollData([]);
      setLoadingData(false);
      return;
    }

    Promise.all([
      fetch("/api/hcm/employees", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/hcm/payroll", { credentials: "include" }).then(r => r.ok ? r.json() : [])
    ]).then(([empData, payData]) => {
      const mapEmp = (d: any) => ({
        ...d,
        employeeId: d.employee_id || d.employeeId,
        nameAr: d.name_ar || d.nameAr,
        jobTitle: d.job_title || d.jobTitle,
        departmentEn: d.department_en || d.departmentEn,
        birthDate: d.birth_date || d.birthDate,
        contractStart: d.contract_start || d.contractStart,
        contractEnd: d.contract_end || d.contractEnd,
        nationalId: d.national_id || d.nationalId,
        maritalStatus: d.marital_status || d.maritalStatus,
        cvLink: d.cv_link || d.cvLink,
        bankName: d.bank_name || d.bankName,
        ibanNumber: d.iban_number || d.ibanNumber,
      });
      const mapPay = (d: any) => ({
        ...d,
        employeeId: d.employee_id || d.employeeId,
        basicSalary: d.basic_salary || d.basicSalary,
        housingAllowance: d.housing_allowance || d.housingAllowance,
        transportAllowance: d.transport_allowance || d.transportAllowance,
        totalSalary: d.total_salary || d.totalSalary,
      });
      setEmployeesData(empData.map(mapEmp));
      setPayrollData(payData.map(mapPay));
    }).catch(() => {
      setEmployeesData([]);
      setPayrollData([]);
    }).finally(() => setLoadingData(false));
  }, [checkingPortalSession, portalEmployee?.employeeId, user?.role]);

  // Find employee data
  const employees = employeesData as any[];
  const payroll = payrollData as any[];
  const banks = saudiBanks as Array<{ id: string; nameAr: string; nameEn: string; swift: string; logo: string }>;
  const embassies = saudiEmbassies as Array<{ id: string; country: string; countryEn: string; city: string; flag: string }>;

  // For managers/admins who don't have an employee record, let them pick which employee to act on behalf of
  const selfEmp = employees.find(e => e.employeeId === user?.id);
  const isManager = !selfEmp && (user?.role === "owner" || user?.role === "admin" || user?.role === "manager");
  const [selectedEmpId, setSelectedEmpId] = useState<string>("");

  // Determine the active employee: portal login > admin session > fallback
  const activeEmpId = portalEmployee?.employeeId || user?.id;
  const emp = portalEmployee
    ? portalEmployee
    : isManager
      ? (selectedEmpId ? employees.find(e => e.employeeId === selectedEmpId) : null)
      : (employees.find(e => e.employeeId === activeEmpId) || selfEmp || employees[0]);
  const pay = payroll.find(p => p.employeeId === emp?.employeeId);

  // ── ALL hooks must be declared before any early returns (React rules of hooks) ──
  // Check-in state
  const [checkinStatus, setCheckinStatus] = useState<CheckinStatus | null>(null);
  const [loadingCheckin, setLoadingCheckin] = useState(false);
  const [locating, setLocating] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  // Leave requests state
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveRequestsError, setLeaveRequestsError] = useState<string | null>(null);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showLeavePreview, setShowLeavePreview] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ leaveType: "", startDate: "", endDate: "", reason: "" });
  const [submittingLeave, setSubmittingLeave] = useState(false);
  // Salary letter state
  const [salaryLetters, setSalaryLetters] = useState<SalaryLetterRequest[]>([]);
  const [salaryLettersError, setSalaryLettersError] = useState<string | null>(null);
  const [showSalaryDialog, setShowSalaryDialog] = useState(false);
  const [showSalaryPreview, setShowSalaryPreview] = useState(false);
  const [showPayslipDetails, setShowPayslipDetails] = useState(false);
  const [salaryForm, setSalaryForm] = useState({
    recipientType: "",
    selectedBankId: "",
    selectedEmbassyId: "",
    customRecipientAr: "",
    customRecipientEn: "",
    notes: "",
    selectedEmployeeId: "",
  });
  const [submittingSalary, setSubmittingSalary] = useState(false);
  // Personal info update state
  const [personalForm, setPersonalForm] = useState({ phone: "", email: "", address: "", emergencyContact: "", emergencyPhone: "" });
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  // Violations state
  const [violations, setViolations] = useState<any[]>([]);
  const [loadingViolations, setLoadingViolations] = useState(false);
  const [violationsError, setViolationsError] = useState<string | null>(null);
  // Leave balance state
  const [leaveBalances, setLeaveBalances] = useState<any[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  // Personal benefits are supplied by a session-scoped endpoint.
  const [benefits, setBenefits] = useState<any[]>([]);
  const [loadingBenefits, setLoadingBenefits] = useState(false);
  const [benefitsError, setBenefitsError] = useState<string | null>(null);
  const [portalPerformance, setPortalPerformance] = useState<{ score: number | string; rating: string; reviewPeriod: string; goalsCompleted: number; goalsPending: number; status: string; notes: string } | null>(null);
  const [portalAttendance, setPortalAttendance] = useState<any[]>([]);
  const [portalNotifications, setPortalNotifications] = useState<any[]>([]);
  const [portalUnreadCount, setPortalUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Can this user request on behalf of others?
  const canRequestForOthers = !isManager && (user?.role === "owner" || user?.role === "admin" || user?.role === "manager");
  const pendingLeaves = leaveRequests.filter(request => request.status === "pending").length;
  const availableLeaveDays = leaveBalances.reduce((total, balance) => total + Math.max(0, (Number(balance.total_days || balance.totalDays || 0) - Number(balance.used_days || balance.usedDays || 0) - Number(balance.pending_days || balance.pendingDays || 0))), 0);
  const activeBenefits = benefits.filter(benefit => !benefit.status || benefit.status === "active" || benefit.status === "نشطة").length;
  const pendingLetters = salaryLetters.filter(letter => letter.status === "pending").length;
  const performanceGoalsTotal = Number(portalPerformance?.goalsCompleted || 0) + Number(portalPerformance?.goalsPending || 0);
  const performanceProgress = performanceGoalsTotal > 0 ? Math.round((Number(portalPerformance?.goalsCompleted || 0) / performanceGoalsTotal) * 100) : null;
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const monthlyAttendance = portalAttendance.filter(record => String(record.date || "").startsWith(currentMonthKey));
  const monthlyAttendanceStats = monthlyAttendance.reduce((stats, record) => {
    const status = String(record.status || "").toLowerCase();
    const isAbsent = status === "absent" || status === "غائب";
    const isLate = status === "late" || status === "متأخر" || Number(record.lateEntry || record.late_entry || 0) > 0;
    if (isAbsent) stats.absent += 1;
    else stats.present += 1;
    if (isLate) stats.late += 1;
    return stats;
  }, { present: 0, absent: 0, late: 0 });

  // Load today's checkin status
  const loadCheckinStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/employee/checkin/today", { credentials: "include" });
      if (res.ok) setCheckinStatus(await res.json());
    } catch {}
  }, []);

  // Load leave requests
  const loadLeaveRequests = useCallback(async () => {
    setLeaveRequestsError(null);
    try {
      const res = await fetch("/api/employee/portal-leaves", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load leave requests");
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.leaves)) throw new Error("Unable to load leave requests");
      setLeaveRequests(data.leaves);
    } catch {
      setLeaveRequests([]);
      setLeaveRequestsError("تعذّر تحميل طلبات الإجازة حالياً. حاول مرة أخرى.");
    }
  }, []);

  // Load salary letters
  const loadSalaryLetters = useCallback(async () => {
    setSalaryLettersError(null);
    try {
      const isPortalSession = Boolean(portalEmployee?.employeeId);
      const res = await fetch(isPortalSession ? "/api/employee/portal-salary-letters" : "/api/salary-letters", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load salary letters");
      const data = await res.json();
      const letters = isPortalSession ? data?.letters : data;
      if (!Array.isArray(letters)) throw new Error("Unable to load salary letters");
      setSalaryLetters(letters);
    } catch {
      setSalaryLetters([]);
      setSalaryLettersError("تعذّر تحميل طلبات التعريف بالراتب حالياً. حاول مرة أخرى.");
    }
  }, [portalEmployee?.employeeId]);

  // Load violations for this employee
  const loadViolations = useCallback(async () => {
    if (!emp?.employeeId) return;
    setLoadingViolations(true);
    setViolationsError(null);
    try {
      const res = await fetch("/api/employee/portal-violations", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load penalties");
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.violations)) throw new Error("Unable to load penalties");
      setViolations(data.violations);
    } catch {
      setViolations([]);
      setViolationsError("تعذّر تحميل المخالفات حالياً. حاول مرة أخرى.");
    } finally { setLoadingViolations(false); }
  }, [emp?.employeeId]);

  // Load leave balances
  const loadLeaveBalances = useCallback(async () => {
    if (!emp?.employeeId) return;
    setLoadingBalances(true);
    setBalancesError(null);
    try {
      const res = await fetch("/api/employee/portal-leave-balances", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load leave balances");
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.balances)) throw new Error("Unable to load leave balances");
      setLeaveBalances(data.balances);
    } catch {
      setLeaveBalances([]);
      setBalancesError("تعذّر تحميل أرصدة الإجازات حالياً. حاول مرة أخرى.");
    } finally { setLoadingBalances(false); }
  }, [emp?.employeeId]);

  // Load personal info
  const loadPersonalInfo = useCallback(async () => {
    if (!emp?.employeeId) return;
    try {
      const res = await fetch("/api/employee/personal-info", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPersonalForm({
          phone: data.phone || "",
          email: data.email || "",
          address: data.address || "",
          emergencyContact: data.emergencyContact || "",
          emergencyPhone: data.emergencyPhone || "",
        });
      }
    } catch {}
  }, [emp?.employeeId]);

  const loadBenefits = useCallback(async () => {
    setLoadingBenefits(true);
    setBenefitsError(null);
    try {
      const res = await fetch("/api/employee/portal-benefits", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load benefits");
      const data = await res.json();
      setBenefits(Array.isArray(data?.benefits) ? data.benefits : Array.isArray(data) ? data : []);
    } catch {
      setBenefitsError("تعذّر تحميل المزايا حالياً. حاول مرة أخرى.");
    } finally {
      setLoadingBenefits(false);
    }
  }, []);

  const loadPortalPerformance = useCallback(async () => {
    try {
      const res = await fetch("/api/employee/portal-performance", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setPortalPerformance(data?.performance || null);
    } catch {
      setPortalPerformance(null);
    }
  }, []);

  const loadPortalAttendance = useCallback(async () => {
    try {
      const res = await fetch("/api/employee/portal-attendance", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setPortalAttendance(Array.isArray(data?.attendance) ? data.attendance : []);
    } catch {
      setPortalAttendance([]);
    }
  }, []);

  const loadPortalNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/employee/portal-notifications", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setPortalNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
      setPortalUnreadCount(Number(data?.unreadCount || 0));
    } catch {
      setPortalNotifications([]);
      setPortalUnreadCount(0);
    }
  }, []);

  const markPortalNotificationsAsRead = useCallback(async (notificationId?: number) => {
    try {
      const res = await fetch("/api/employee/portal-notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(notificationId ? { notificationId } : {}),
      });
      if (!res.ok) return;
      const data = await res.json();
      setPortalUnreadCount(Number(data?.unreadCount || 0));
      setPortalNotifications(current => current.map(notification => !notificationId || Number(notification.id) === notificationId ? { ...notification, is_read: true } : notification));
    } catch {}
  }, []);

  useEffect(() => {
    loadCheckinStatus();
    loadLeaveRequests();
    loadSalaryLetters();
    loadViolations();
    loadLeaveBalances();
    loadBenefits();
    loadPersonalInfo();
    loadPortalPerformance();
    loadPortalAttendance();
    loadPortalNotifications();
  }, [loadCheckinStatus, loadLeaveRequests, loadSalaryLetters, loadViolations, loadLeaveBalances, loadBenefits, loadPersonalInfo, loadPortalPerformance, loadPortalAttendance, loadPortalNotifications]);

  // Get current location
  const getLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocating(false);
      },
      () => {
        setLocationError("تعذّر تحديد موقعك. تأكد من تفعيل خدمة الموقع.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // Redirect to standalone login page if no session (must be before early returns - React rules of hooks)
  const needsLogin = !user && !portalEmployee && !checkingPortalSession;
  useEffect(() => {
    if (needsLogin) {
      window.location.replace("/employee-portal/login");
    }
  }, [needsLogin]);

  // ── Early returns (after ALL hooks) ──
  if (checkingPortalSession || loadingData || needsLogin) return <PortalLoadingState />;
  if (portalProfileError) return <PortalProfileUnavailableState onRetry={() => window.location.reload()} />;

  // Perform check-in or check-out
  const handleCheckin = async (type: "check_in" | "check_out") => {
    if (!currentLocation) { toast.error("يرجى تحديد موقعك أولاً"); return; }
    setLoadingCheckin(true);
    try {
      const res = await fetch("/api/employee/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type,
          latitude: currentLocation.lat,
          longitude: currentLocation.lng,
          accuracy: currentLocation.accuracy,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.exempt) {
          toast.success(type === "check_in" ? "✅ تم تسجيل الحضور — مستثنى من البصمة" : "✅ تم تسجيل الانصراف — مستثنى من البصمة");
        } else if (data.withinZone) {
          toast.success(type === "check_in" ? "✅ تم تسجيل الحضور بنجاح" : "✅ تم تسجيل الانصراف بنجاح");
        } else {
          toast.warning(`⚠️ تم التسجيل لكنك خارج النطاق (${data.distanceFromOffice}م من المكتب)`);
        }
        await loadCheckinStatus();
      } else {
        toast.error(data.error || "حدث خطأ");
      }
    } catch {
      toast.error("تعذّر الاتصال بالسيرفر");
    } finally {
      setLoadingCheckin(false);
    }
  };

  const changeMandatoryPassword = async () => {
    if (newPassword.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("تأكيد كلمة المرور غير مطابق");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/employee/portal-change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "تعذّر تغيير كلمة المرور");
      setMustChangePassword(false);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("تم تغيير كلمة المرور بنجاح");
    } catch (error: any) {
      toast.error(error?.message || "تعذّر تغيير كلمة المرور");
    } finally {
      setChangingPassword(false);
    }
  };

  // Save personal info
  const savePersonalInfo = async () => {
    setSavingPersonal(true);
    try {
      const res = await fetch("/api/employee/personal-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      body: JSON.stringify(personalForm),
      });
      if (res.ok) {
        toast.success("✅ تم حفظ البيانات الشخصية بنجاح");
        setEditingPersonal(false);
      } else {
        toast.error("حدث خطأ أثناء الحفظ");
      }
    } catch { toast.error("تعذّر الاتصال بالسيرفر"); }
    finally { setSavingPersonal(false); }
  };

  const openLeavePreview = () => {
    if (!leaveForm.leaveType || !leaveForm.startDate || !leaveForm.endDate) {
      toast.error("يرجى تعبئة جميع الحقول المطلوبة");
      return;
    }
    const start = new Date(leaveForm.startDate);
    const end = new Date(leaveForm.endDate);
    if (end < start) { toast.error("تاريخ النهاية يجب أن يكون بعد تاريخ البداية"); return; }
    setShowLeavePreview(true);
  };

  // Submit leave request
  const submitLeave = async () => {
    if (!leaveForm.leaveType || !leaveForm.startDate || !leaveForm.endDate) {
      toast.error("يرجى تعبئة جميع الحقول المطلوبة");
      return;
    }
    const start = new Date(leaveForm.startDate);
    const end = new Date(leaveForm.endDate);
    if (end < start) { toast.error("تاريخ النهاية يجب أن يكون بعد تاريخ البداية"); return; }
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    setSubmittingLeave(true);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leaveType: leaveForm.leaveType,
          startDate: leaveForm.startDate,
          endDate: leaveForm.endDate,
          days,
          reason: leaveForm.reason,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("✅ تم تقديم طلب الإجازة بنجاح");
        setShowLeaveDialog(false);
        setShowLeavePreview(false);
        setLeaveForm({ leaveType: "", startDate: "", endDate: "", reason: "" });
        await loadLeaveRequests();
      } else {
        toast.error(data.error || "حدث خطأ");
      }
    } catch {
      toast.error("تعذّر الاتصال بالسيرفر");
    } finally {
      setSubmittingLeave(false);
    }
  };

  // Derive recipient names from form state
  const getRecipientNames = () => {
    if (salaryForm.recipientType === "bank" && salaryForm.selectedBankId) {
      const bank = banks.find(b => b.id === salaryForm.selectedBankId);
      return { ar: bank?.nameAr || "", en: bank?.nameEn || "" };
    }
    if (salaryForm.recipientType === "embassy" && salaryForm.selectedEmbassyId) {
      const emb = embassies.find(e => e.id === salaryForm.selectedEmbassyId);
      return {
        ar: emb ? `سفارة ${emb.country}` : "",
        en: emb ? `Embassy of ${emb.countryEn}` : "",
      };
    }
    return { ar: salaryForm.customRecipientAr, en: salaryForm.customRecipientEn };
  };

  const openSalaryPreview = () => {
    if (!salaryForm.recipientType) {
      toast.error("يرجى اختيار نوع الجهة المستلمة");
      return;
    }
    if (salaryForm.recipientType === "bank" && !salaryForm.selectedBankId) {
      toast.error("يرجى اختيار البنك");
      return;
    }
    if (salaryForm.recipientType === "embassy" && !salaryForm.selectedEmbassyId) {
      toast.error("يرجى اختيار السفارة");
      return;
    }
    const targetEmp = (canRequestForOthers && salaryForm.selectedEmployeeId)
      ? employees.find(e => e.employeeId === salaryForm.selectedEmployeeId)
      : emp;
    if (!targetEmp) { toast.error("يرجى اختيار الموظف"); return; }
    setShowSalaryPreview(true);
  };

  // Submit salary letter request
  const submitSalaryLetter = async () => {
    if (!salaryForm.recipientType) {
      toast.error("يرجى اختيار نوع الجهة المستلمة");
      return;
    }
    if (salaryForm.recipientType === "bank" && !salaryForm.selectedBankId) {
      toast.error("يرجى اختيار البنك");
      return;
    }
    if (salaryForm.recipientType === "embassy" && !salaryForm.selectedEmbassyId) {
      toast.error("يرجى اختيار السفارة");
      return;
    }
    const { ar: recipientName, en: recipientNameEn } = getRecipientNames();
    // Determine which employee this request is for
    const targetEmp = (canRequestForOthers && salaryForm.selectedEmployeeId)
      ? employees.find(e => e.employeeId === salaryForm.selectedEmployeeId)
      : emp;
    if (!targetEmp) { toast.error("يرجى اختيار الموظف"); return; }
    setSubmittingSalary(true);
    try {
      const isPortalSession = Boolean(portalEmployee?.employeeId);
      const res = await fetch(isPortalSession ? "/api/employee/portal-salary-letter" : "/api/salary-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(isPortalSession
          ? { purpose: salaryForm.recipientType, recipientName, language: "both", notes: salaryForm.notes }
          : {
              ...(canRequestForOthers ? { employeeId: targetEmp.employeeId } : {}),
              purpose: salaryForm.recipientType,
              recipientName,
              recipientNameEn,
              language: "both",
              notes: salaryForm.notes,
            }),
      });
      const data = await res.json();
      if (data.success) {
        const forWhom = (canRequestForOthers && salaryForm.selectedEmployeeId && targetEmp.employeeId !== emp?.employeeId)
          ? ` للموظف ${targetEmp.nameAr}`
          : "";
        toast.success(`✅ تم إرسال طلب التعريف بالراتب${forWhom} بنجاح. سيتم مراجعته من قِبل مدير الموارد البشرية.`);
        setShowSalaryDialog(false);
        setShowSalaryPreview(false);
        setSalaryForm({ recipientType: "", selectedBankId: "", selectedEmbassyId: "", customRecipientAr: "", customRecipientEn: "", notes: "", selectedEmployeeId: "" });
        await loadSalaryLetters();
      } else {
        toast.error(data.error || "حدث خطأ");
      }
    } catch {
      toast.error("تعذّر الاتصال بالسيرفر");
    } finally {
      setSubmittingSalary(false);
    }
  };

  // Compute distance from office — check against ALL active geo zones
  const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const toRad = (v: number) => v * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  // Fallback zones (hardcoded) used if checkinStatus hasn't loaded yet
  const FALLBACK_ZONES = [
    { lat: 24.776971, lng: 46.683038, radius: 3000, name: '3,6T' },
    { lat: 24.825948, lng: 46.690484, radius: 300, name: 'Gg' },
  ];
  const allZones = checkinStatus?.geoZones && checkinStatus.geoZones.length > 0
    ? checkinStatus.geoZones
    : checkinStatus?.officeLocation
      ? [checkinStatus.officeLocation]
      : FALLBACK_ZONES;
  let distanceFromOffice: number | null = null;
  let withinZone: boolean | null = null;
  if (currentLocation && allZones.length > 0) {
    let closestDist = Infinity;
    let insideAny = false;
    for (const zone of allZones) {
      const d = haversine(currentLocation.lat, currentLocation.lng, zone.lat, zone.lng);
      if (d < closestDist) closestDist = d;
      if (d <= zone.radius) insideAny = true;
    }
    distanceFromOffice = Math.round(closestDist);
    withinZone = insideAny;
  };

  // Derived: is the salary form ready to submit?
  const salaryFormReady = (() => {
    if (!salaryForm.recipientType) return false;
    if (salaryForm.recipientType === "bank") return !!salaryForm.selectedBankId;
    if (salaryForm.recipientType === "embassy") return !!salaryForm.selectedEmbassyId;
    return true; // government / housing / general — no sub-selection required
  })();

  return (
    <div className="portal-shell page-shell mx-auto max-w-5xl space-y-6 p-4 md:p-6" data-portal="employee" dir="rtl">
      {/* Header */}
      {isManager ? (
        /* Manager view: show employee picker */
        <div className="space-y-3">
          <div className="surface-card p-4 text-sm" style={{ background: "hsl(var(--primary) / .08)", borderColor: "hsl(var(--primary) / .24)", color: "hsl(var(--primary))" }}>
            أنت مسجّل كمدير. اختر الموظف الذي تريد إدارة بياناته.
          </div>
          <div>
            <Label className="text-sm mb-1 block font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
              اختر الموظف *
            </Label>
            <Select value={selectedEmpId} onValueChange={setSelectedEmpId}>
              <SelectTrigger style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                <SelectValue placeholder="اختر موظفاً…" />
              </SelectTrigger>
              <SelectContent style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "300px" }}>
                {employees
                  .sort((a, b) => (a.department || "").localeCompare(b.department || "", "ar"))
                  .map(e => (
                    <SelectItem key={e.employeeId} value={e.employeeId}>
                      {e.nameAr} — {e.department}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {emp && (
            <div className="surface-card flex items-center gap-3 p-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                {emp.nameAr?.charAt(0)}
              </div>
              <div>
                <h1 className="text-lg font-bold" style={{ color: "hsl(var(--foreground))", fontFamily: "Alexandria" }}>{emp.nameAr}</h1>
                <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{emp.jobTitle} — {emp.department}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Regular employee view */
        <div className="portal-hero relative overflow-hidden rounded-2xl p-5" style={{ background: "var(--people-mint)", color: "var(--people-ink)", border: "1px solid var(--people-line)" }}>
          <div className="people-portal-art" aria-hidden="true"><AtharScene compact /></div>
          <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
              style={{ background: "#16A085", color: "#fff" }}>
              {emp?.nameAr?.charAt(0) || "م"}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold" style={{ color: "var(--people-accent)" }}>3,6T People</p>
              <h1 className="text-xl font-bold" style={{ color: "var(--people-ink)", fontFamily: "Alexandria" }}>
                {emp?.nameAr || "الموظف"}
              </h1>
              <p className="text-sm" style={{ color: "var(--people-soft)" }}>
                {emp?.jobTitle} — {emp?.department}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setNotificationsOpen(true)} className="relative flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "hsl(var(--primary) / 0.18)", color: "var(--people-ink)" }} aria-label={`الإشعارات${portalUnreadCount ? `، ${portalUnreadCount} غير مقروءة` : ""}`}>
              <Bell size={17} aria-hidden="true" />
              {portalUnreadCount > 0 && <span className="absolute -left-1 -top-1 min-w-4 rounded-full px-1 text-[10px] font-bold" style={{ background: "#DC2626", color: "var(--people-ink)" }}>{Math.min(portalUnreadCount, 99)}</span>}
            </button>
            {/* Logout button — only for portal-authenticated employees (not admin session) */}
            {portalEmployee && (
              <button
                onClick={async () => {
                  try {
                    await fetch("/api/employee/portal-logout", { method: "POST", credentials: "include" });
                  } catch {}
                  window.location.replace("/employee-portal/login");
                }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                خروج
              </button>
            )}
          </div>
          </div>
        </div>
      )}

      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent dir="rtl" className="max-w-lg" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3" style={{ color: "hsl(var(--foreground))" }}>
              <span className="flex items-center gap-2"><Bell size={18} style={{ color: "hsl(var(--primary))" }} /> الإشعارات</span>
              {portalUnreadCount > 0 && <Button variant="outline" size="sm" onClick={() => markPortalNotificationsAsRead()} style={{ borderColor: "hsl(var(--border))" }}>تعليم الكل كمقروء</Button>}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {portalNotifications.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>لا توجد إشعارات حالياً.</p>
            ) : portalNotifications.map(notification => (
              <button key={notification.id} type="button" onClick={() => !notification.is_read && markPortalNotificationsAsRead(Number(notification.id))} className="w-full rounded-xl border p-3 text-right" style={{ background: notification.is_read ? "hsl(var(--card))" : "hsl(var(--primary) / 0.08)", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                <div className="flex items-start justify-between gap-3"><span className="font-semibold text-sm">{notification.title || "تحديث إداري"}</span>{!notification.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--primary))" }} />}</div>
                {notification.message && <p className="mt-1 text-xs leading-5" style={{ color: "hsl(var(--muted-foreground))" }}>{notification.message}</p>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {(!isManager || emp) && (
        <section className="portal-summary mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="ملخص خدمات الموظف">
          {[
            { label: "رصيد الإجازات", value: `${availableLeaveDays} يوم`, icon: CalendarDays, tab: "leave", tone: "hsl(var(--primary))" },
            { label: "الراتب الصافي", value: typeof pay?.netSalary === "number" ? `${pay.netSalary.toLocaleString()} ر.س` : "غير متاح", icon: Landmark, tab: "salary", tone: "hsl(var(--primary))" },
            { label: "حالة الحضور", value: checkinStatus?.checkedOut ? "انتهى الدوام" : checkinStatus?.checkedIn ? "في الدوام" : "لم يسجل", icon: Clock, tab: "attendance", tone: checkinStatus?.checkedIn ? "hsl(var(--primary))" : "#D97706" },
            { label: "طلبات قيد المراجعة", value: String(pendingLeaves), icon: FileText, tab: "leave", tone: "#D97706" },
          ].map(({ label, value, icon: Icon, tab, tone }) => (
            <button
              key={label}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="surface-card flex min-h-24 flex-col items-start justify-between rounded-2xl p-4 text-right transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2"
              style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
              aria-label={`${label}: ${value}`}
            >
              <Icon size={18} style={{ color: tone }} aria-hidden="true" />
              <div>
                <p className="text-lg font-bold">{value}</p>
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
              </div>
            </button>
          ))}
        </section>
      )}

      {/* Guard: manager must select an employee first */}
      {isManager && !emp && (
        <div className="empty-state" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Users size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">يرجى اختيار موظف من القائمة أعلاه لعرض بياناته</p>
        </div>
      )}

      {/* Tabs — only show when employee is selected */}
      {(!isManager || emp) && (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="portal-tabs w-full grid grid-cols-5 mb-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", padding: "4px" }}>
          <TabsTrigger value="profile" className="gap-1 text-xs">
            <User size={14} /> بياناتي
          </TabsTrigger>
          <TabsTrigger value="checkin" className="gap-1 text-xs">
            <Clock size={14} /> الحضور
          </TabsTrigger>
          <TabsTrigger value="leave" className="gap-1 text-xs">
            <CalendarDays size={14} /> الإجازات
          </TabsTrigger>
          <TabsTrigger value="violations" className="gap-1 text-xs">
            <Shield size={14} /> المخالفات
          </TabsTrigger>
          <TabsTrigger value="salary" className="gap-1 text-xs">
            <FileText size={14} /> التعريف
          </TabsTrigger>
        </TabsList>

        {/* ── PROFILE TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="profile" className="space-y-4">
          {/* Employee Info Card */}
          <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                  <User size={16} style={{ color: "#1FA98C" }} />
                  المعلومات الوظيفية
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "الاسم", value: emp?.nameAr },
                { label: "رقم الموظف", value: emp?.employeeId },
                { label: "المسمى الوظيفي", value: emp?.jobTitle },
                { label: "القسم", value: emp?.department },
                { label: "الجنسية", value: emp?.nationality },
                { label: "تاريخ الميلاد", value: emp?.birthDate },
                { label: "الحالة الاجتماعية", value: emp?.maritalStatus },
                { label: "بداية العقد", value: emp?.contractStart },
                { label: "نهاية العقد", value: emp?.contractEnd },
                { label: "التأمين", value: emp?.insurance },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{item.label}</span>
                  <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{item.value || "—"}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="portal-card" aria-label="تقدم الأداء" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                <CheckCircle size={16} style={{ color: "hsl(var(--primary))" }} /> تقدم الأداء
              </CardTitle>
            </CardHeader>
            <CardContent>
              {performanceProgress === null ? (
                <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>لا توجد أهداف أداء مسجلة للفترة الحالية.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>الأهداف المنجزة</span>
                    <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>{portalPerformance?.goalsCompleted} من {performanceGoalsTotal}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: "hsl(var(--muted))" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={performanceProgress} aria-label="نسبة تقدم الأداء">
                    <div className="h-full rounded-full" style={{ width: `${performanceProgress}%`, background: "hsl(var(--primary))" }} />
                  </div>
                  <div className="flex items-center justify-between text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <span>{performanceProgress}% مكتمل</span>
                    <span>{portalPerformance?.reviewPeriod || "الفترة الحالية"}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Personal Contact Info - Editable */}
          <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                  <Phone size={16} style={{ color: "#1FA98C" }} />
                  بيانات التواصل
                </CardTitle>
                {!editingPersonal ? (
                  <Button size="sm" variant="outline" onClick={() => setEditingPersonal(true)}
                    style={{ borderColor: "hsl(var(--border))", color: "#1FA98C" }} className="gap-1 text-xs">
                    <Edit2 size={12} /> تعديل
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingPersonal(false)}
                      style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }} className="text-xs">
                      إلغاء
                    </Button>
                    <Button size="sm" onClick={savePersonalInfo} disabled={savingPersonal}
                      style={{ background: "#1FA98C", color: "#fff" }} className="gap-1 text-xs">
                      {savingPersonal ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      حفظ
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "رقم الجوال", key: "phone", icon: <Phone size={14} />, placeholder: "05xxxxxxxx" },
                { label: "البريد الإلكتروني", key: "email", icon: <Mail size={14} />, placeholder: "example@email.com" },
                { label: "العنوان", key: "address", icon: <HomeIcon size={14} />, placeholder: "المدينة، الحي" },
                { label: "جهة اتصال الطوارئ", key: "emergencyContact", icon: <Users size={14} />, placeholder: "اسم شخص الطوارئ" },
                { label: "رقم الطوارئ", key: "emergencyPhone", icon: <Phone size={14} />, placeholder: "05xxxxxxxx" },
              ].map(item => (
                <div key={item.key} className="space-y-1">
                  <label className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {item.icon} {item.label}
                  </label>
                  {editingPersonal ? (
                    <Input
                      value={(personalForm as any)[item.key]}
                      onChange={e => setPersonalForm(f => ({ ...f, [item.key]: e.target.value }))}
                      placeholder={item.placeholder}
                      className="text-right text-sm"
                      style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    />
                  ) : (
                    <p className="text-sm py-1.5 px-3 rounded-md" style={{ background: "hsl(var(--muted))", color: (personalForm as any)[item.key] ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                      {(personalForm as any)[item.key] || "لم يتم الإدخال"}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Leave Balance Summary */}
          <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                <CalendarDays size={16} style={{ color: "#1FA98C" }} />
                رصيد الإجازات
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingBalances ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: "#1FA98C" }} /></div>
              ) : balancesError ? (
                <div className="empty-state py-7" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <AlertCircle size={28} className="mx-auto mb-2" style={{ color: "#D97706" }} />
                  <p className="text-sm font-medium">{balancesError}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={loadLeaveBalances}>إعادة المحاولة</Button>
                </div>
              ) : leaveBalances.length === 0 ? (
                <div className="empty-state py-7" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <CalendarDays size={28} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium">لا توجد بيانات رصيد إجازات حالياً</p>
                  <p className="mt-1 text-xs">سيظهر الرصيد فور اعتماده في النظام.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {leaveBalances.map((lb: any, i: number) => {
                    const remaining = (lb.total_days || lb.totalDays || 0) - (lb.used_days || lb.usedDays || 0) - (lb.pending_days || lb.pendingDays || 0);
                    return (
                      <div key={i} className="p-3 rounded-xl text-center" style={{ background: "hsl(var(--muted))" }}>
                        <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {LEAVE_TYPES.find(t => t.value === (lb.leave_type || lb.leaveType))?.label || lb.leave_type || lb.leaveType}
                        </p>
                        <p className="text-lg font-bold" style={{ color: remaining > 0 ? "#1FA98C" : "#EF4444" }}>
                          {remaining}
                        </p>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>من {lb.total_days || lb.totalDays || 0} يوم</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                <Heart size={16} style={{ color: "hsl(var(--primary))" }} /> مزاياي
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingBenefits ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: "hsl(var(--primary))" }} /></div>
              ) : benefitsError ? (
                <div className="empty-state py-7" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <AlertCircle size={28} className="mx-auto mb-2" style={{ color: "#D97706" }} />
                  <p className="text-sm font-medium">{benefitsError}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={loadBenefits}>إعادة المحاولة</Button>
                </div>
              ) : benefits.length === 0 ? (
                <div className="empty-state py-7" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Heart size={28} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium">لا توجد مزايا مسجلة حالياً</p>
                  <p className="mt-1 text-xs">ستظهر مزاياك المعتمدة هنا فور إضافتها من الموارد البشرية.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {benefits.map((benefit: any, index: number) => (
                    <div key={benefit.id || index} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: "hsl(var(--muted))" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{benefit.name || benefit.benefitName || benefit.type || "مزية موظف"}</p>
                        {benefit.description ? <p className="mt-0.5 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{benefit.description}</p> : null}
                      </div>
                      <Badge variant="outline" style={{ color: "hsl(var(--primary))", borderColor: "hsl(var(--primary))" }}>{benefit.status || "نشطة"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── VIOLATIONS TAB ──────────────────────────────────────────────── */}
        <TabsContent value="violations" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>المخالفات والجزاءات</h2>
            <Button size="sm" variant="outline" onClick={loadViolations} disabled={loadingViolations}
              style={{ borderColor: "hsl(var(--border))", color: "#1FA98C" }} className="gap-1 text-xs">
              <RefreshCw size={12} className={loadingViolations ? "animate-spin" : ""} /> تحديث
            </Button>
          </div>

          {loadingViolations ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin" style={{ color: "#1FA98C" }} /></div>
          ) : violationsError ? (
            <div className="empty-state py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
              <AlertCircle size={40} className="mx-auto mb-3" style={{ color: "#D97706" }} />
              <p className="text-sm font-medium">{violationsError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={loadViolations}>إعادة المحاولة</Button>
            </div>
          ) : violations.length === 0 ? (
            <div className="empty-state py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
              <Shield size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">لا توجد مخالفات مسجلة</p>
              <p className="mt-1 text-xs">سجلك نظيف. استمر على هذا الأداء.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {violations.map((v: any, i: number) => (
                <Card key={i} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                            {v.violationType || "مخالفة حضور"}
                          </span>
                          <Badge className={v.status === "معفى" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                            {v.status || "نشط"}
                          </Badge>
                        </div>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          التاريخ: {v.violationDate || "—"}
                        </p>
                        <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          الإجراء: {v.actionTaken || "—"}
                        </p>
                        {v.deductionDays > 0 && (
                          <p className="text-xs mt-1" style={{ color: "#EF4444" }}>
                            خصم: {v.deductionDays} يوم
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── CHECK-IN TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="checkin" className="space-y-4">
          <Card aria-label="ملخص الحضور الشهري" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                <CalendarDays size={16} style={{ color: "hsl(var(--primary))" }} /> ملخص الحضور لهذا الشهر
              </CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyAttendance.length === 0 ? (
                <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>لا توجد سجلات حضور محفوظة للشهر الحالي.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: "حاضر", value: monthlyAttendanceStats.present, tone: "hsl(var(--primary))" },
                    { label: "غائب", value: monthlyAttendanceStats.absent, tone: "#DC2626" },
                    { label: "متأخر", value: monthlyAttendanceStats.late, tone: "#D97706" },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl border p-3" style={{ background: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}>
                      <p className="text-xl font-bold" style={{ color: item.tone }}>{item.value}</p>
                      <p className="mt-1 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{item.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Today's status */}
          <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                <Clock size={16} style={{ color: "#1FA98C" }} />
                سجل اليوم
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-xl" style={{ background: "hsl(var(--muted))" }}>
                <LogIn size={20} className="mx-auto mb-1" style={{ color: checkinStatus?.checkedIn ? "#1FA98C" : "hsl(var(--muted-foreground))" }} />
                <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>وقت الحضور</p>
                <p className="text-lg font-bold font-mono" style={{ color: checkinStatus?.checkedIn ? "#1FA98C" : "hsl(var(--muted-foreground))" }}>
                  {formatTime(checkinStatus?.checkInTime || null)}
                </p>
              </div>
              <div className="text-center p-3 rounded-xl" style={{ background: "hsl(var(--muted))" }}>
                <LogOut size={20} className="mx-auto mb-1" style={{ color: checkinStatus?.checkedOut ? "#EF4444" : "hsl(var(--muted-foreground))" }} />
                <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>وقت الانصراف</p>
                <p className="text-lg font-bold font-mono" style={{ color: checkinStatus?.checkedOut ? "#EF4444" : "hsl(var(--muted-foreground))" }}>
                  {formatTime(checkinStatus?.checkOutTime || null)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Navigation size={16} style={{ color: "#1FA98C" }} />
                  <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>موقعك الحالي</span>
                </div>
                <Button size="sm" variant="outline" onClick={getLocation} disabled={locating}
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  {locating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span className="mr-1 text-xs">{locating ? "جاري التحديد..." : "تحديد الموقع"}</span>
                </Button>
              </div>

              {locationError && (
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
                  <AlertCircle size={14} />
                  <span className="text-xs">{locationError}</span>
                </div>
              )}

              {currentLocation && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: withinZone ? "hsl(165 69% 39% / 0.10)" : "rgba(239,68,68,0.1)", border: `1px solid ${withinZone ? "hsl(165 69% 39% / 0.30)" : "rgba(239,68,68,0.3)"}` }}>
                    <div className="flex items-center gap-2">
                      {withinZone
                        ? <CheckCircle size={18} style={{ color: "#1FA98C" }} />
                        : <XCircle size={18} style={{ color: "#EF4444" }} />}
                      <div>
                        <p className="text-sm font-medium" style={{ color: withinZone ? "#1FA98C" : "#EF4444" }}>
                          {withinZone ? "داخل نطاق الشركة ✓" : "خارج نطاق الشركة"}
                        </p>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          المسافة: {distanceFromOffice}م — النطاق المسموح: {checkinStatus?.officeLocation?.radius || 200}م
                        </p>
                      </div>
                    </div>
                    <MapPin size={16} style={{ color: withinZone ? "#1FA98C" : "#EF4444" }} />
                  </div>
                  <p className="text-xs text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                    دقة الموقع: ±{Math.round(currentLocation.accuracy)}م
                  </p>
                </div>
              )}

              {checkinStatus?.officeLocation && (
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: "hsl(var(--border))" }}>
                  <MapView
                    key={`${currentLocation?.lat ?? "office"}-${currentLocation?.lng ?? "office"}`}
                    className="h-56"
                    initialCenter={currentLocation
                      ? { lat: currentLocation.lat, lng: currentLocation.lng }
                      : { lat: checkinStatus.officeLocation.lat, lng: checkinStatus.officeLocation.lng }}
                    initialZoom={16}
                    onMapReady={(map) => {
                      const office = checkinStatus.officeLocation;
                      new google.maps.Marker({
                        map,
                        position: { lat: office.lat, lng: office.lng },
                        title: "موقع الشركة",
                      });
                      new google.maps.Circle({
                        map,
                        center: { lat: office.lat, lng: office.lng },
                        radius: office.radius,
                        fillColor: "#16A085",
                        fillOpacity: 0.12,
                        strokeColor: "#16A085",
                        strokeOpacity: 0.65,
                        strokeWeight: 2,
                      });
                      if (currentLocation) {
                        new google.maps.Marker({
                          map,
                          position: { lat: currentLocation.lat, lng: currentLocation.lng },
                          title: "موقعك الحالي",
                        });
                      }
                    }}
                  />
                  <p className="px-3 py-2 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))" }}>
                    خريطة موقع الشركة والنطاق المسموح للحضور والانصراف
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              className="h-14 text-base font-bold gap-2"
              disabled={loadingCheckin || !currentLocation || checkinStatus?.checkedIn}
              onClick={() => handleCheckin("check_in")}
              style={{ background: checkinStatus?.checkedIn ? "hsl(var(--muted))" : "#16A085", color: "#fff" }}>
              {loadingCheckin ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
              {checkinStatus?.checkedIn ? "تم الحضور" : "تسجيل الحضور"}
            </Button>
            <Button
              className="h-14 text-base font-bold gap-2"
              disabled={loadingCheckin || !currentLocation || !checkinStatus?.checkedIn || checkinStatus?.checkedOut}
              onClick={() => handleCheckin("check_out")}
              style={{ background: checkinStatus?.checkedOut ? "hsl(var(--muted))" : "#DC2626", color: "#fff" }}>
              {loadingCheckin ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
              {checkinStatus?.checkedOut ? "تم الانصراف" : "تسجيل الانصراف"}
            </Button>
          </div>

          {!currentLocation && !locating && (
            <p className="text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              اضغط "تحديد الموقع" أولاً لتفعيل أزرار الحضور والانصراف
            </p>
          )}
        </TabsContent>

        {/* ── LEAVE TAB ────────────────────────────────────────────────────── */}
        <TabsContent value="leave" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>طلبات الإجازة</h2>
            <Button size="sm" onClick={() => setShowLeaveDialog(true)}
              style={{ background: "#1FA98C", color: "#fff" }}>
              + طلب إجازة جديد
            </Button>
          </div>

          {leaveRequestsError ? (
            <div className="empty-state py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
              <AlertCircle size={40} className="mx-auto mb-3" style={{ color: "#D97706" }} />
              <p className="text-sm font-medium">{leaveRequestsError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={loadLeaveRequests}>إعادة المحاولة</Button>
            </div>
          ) : leaveRequests.length === 0 ? (
            <div className="empty-state py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
              <CalendarDays size={40} className="mx-auto mb-3 opacity-40" />
              <p className="font-medium">لا توجد طلبات إجازة</p>
              <p className="mt-1 text-xs">استخدم زر «طلب إجازة جديد» عند الحاجة.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {leaveRequests.slice().reverse().map((req) => (
                <Card key={req.id} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                            {LEAVE_TYPES.find(t => t.value === req.leaveType)?.label || req.leaveType}
                          </span>
                          {statusBadge(req.status)}
                        </div>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {req.startDate} → {req.endDate} ({req.days} أيام)
                        </p>
                        {req.reason && (
                          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{req.reason}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── SALARY LETTER TAB ────────────────────────────────────────────── */}
        <TabsContent value="salary" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>تعريف بالراتب</h2>
            <Button size="sm" onClick={() => setShowSalaryDialog(true)}
              style={{ background: "#1FA98C", color: "#fff" }}>
              + طلب تعريف جديد
            </Button>
          </div>

          {/* Salary Summary */}
          {pay && (
            <Card className="portal-card" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                  <Briefcase size={16} style={{ color: "#1FA98C" }} />
                  ملخص الراتب
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2">
                {[
                  { label: "الراتب الأساسي", value: pay.basicSalary?.toLocaleString() + " ر.س" },
                  { label: "الإجمالي", value: pay.grossSalary?.toLocaleString() + " ر.س" },
                  { label: "الصافي", value: pay.netSalary?.toLocaleString() + " ر.س" },
                ].map(item => (
                  <div key={item.label} className="text-center p-2 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                    <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>{item.label}</p>
                    <p className="text-sm font-bold" style={{ color: "#1FA98C" }}>{item.value}</p>
                  </div>
                ))}
              </CardContent>
              <CardContent className="pt-0">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowPayslipDetails(open => !open)} style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  {showPayslipDetails ? "إخفاء التفصيل" : "عرض تفصيل الراتب"}
                </Button>
                {showPayslipDetails && (
                  <div className="mt-3 space-y-2 rounded-xl border p-3 text-sm" style={{ background: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }} aria-label="تفصيل الراتب">
                    {[
                      { label: "الراتب الأساسي", value: typeof pay.basicSalary === "number" ? `${pay.basicSalary.toLocaleString()} ر.س` : "غير متاح", tone: "hsl(var(--foreground))" },
                      { label: "إجمالي الاستحقاقات", value: typeof pay.grossSalary === "number" ? `${pay.grossSalary.toLocaleString()} ر.س` : "غير متاح", tone: "hsl(var(--foreground))" },
                      { label: "خصم التأمينات", value: typeof pay.gosiDeduction === "number" ? `${pay.gosiDeduction.toLocaleString()} ر.س` : "غير متاح", tone: "#DC2626" },
                      { label: "صافي الراتب", value: typeof pay.netSalary === "number" ? `${pay.netSalary.toLocaleString()} ر.س` : "غير متاح", tone: "hsl(var(--primary))" },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between gap-4 border-b pb-2 last:border-0 last:pb-0" style={{ borderColor: "hsl(var(--border))" }}>
                        <span style={{ color: "hsl(var(--muted-foreground))" }}>{item.label}</span>
                        <span className="font-semibold" style={{ color: item.tone }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Salary Letter Requests */}
          {salaryLettersError ? (
            <div className="empty-state py-10" style={{ color: "hsl(var(--muted-foreground))" }}>
              <AlertCircle size={40} className="mx-auto mb-3" style={{ color: "#D97706" }} />
              <p className="text-sm font-medium">{salaryLettersError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={loadSalaryLetters}>إعادة المحاولة</Button>
            </div>
          ) : salaryLetters.length === 0 ? (
            <div className="empty-state py-10" style={{ color: "hsl(var(--muted-foreground))" }}>
              <FileText size={40} className="mx-auto mb-3 opacity-40" />
              <p className="font-medium">لا توجد طلبات تعريف سابقة</p>
              <p className="mt-1 text-xs">أنشئ طلباً جديداً ليظهر تاريخه وحالته هنا.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {salaryLetters.slice().reverse().map((req) => (
                <Card key={req.id} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "16px", boxShadow: "var(--shadow-card)" }}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                            {PURPOSE_LABELS[req.purpose] || req.purpose}
                            {req.recipientName ? ` — ${req.recipientName}` : ""}
                          </span>
                          {statusBadge(req.status)}
                        </div>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {formatDate(req.requestedAt)}
                        </p>
                        {req.status === "rejected" && req.rejectionReason && (
                          <p className="text-xs mt-1" style={{ color: "#EF4444" }}>
                            سبب الرفض: {req.rejectionReason}
                          </p>
                        )}
                        {req.status === "approved" && (
                          <p className="text-xs mt-1" style={{ color: "#1FA98C" }}>
                            ✅ تمت الموافقة — يمكنك استلام التعريف من الموارد البشرية
                          </p>
                        )}
                      </div>
                      <ChevronRight size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      )}

      {/* ── Leave Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showLeaveDialog} onOpenChange={open => { setShowLeaveDialog(open); if (!open) setShowLeavePreview(false); }}>
        <DialogContent dir="rtl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "hsl(var(--foreground))", fontFamily: "Alexandria" }}>{showLeavePreview ? "مراجعة طلب الإجازة" : "طلب إجازة جديد"}</DialogTitle>
          </DialogHeader>
          {showLeavePreview ? (
            <div className="space-y-3 rounded-2xl border p-4" style={{ background: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}>
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>راجع البيانات التالية قبل إرسال الطلب للاعتماد.</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>نوع الإجازة</p><p className="mt-1 font-semibold">{LEAVE_TYPES.find(t => t.value === leaveForm.leaveType)?.label || leaveForm.leaveType}</p></div>
                <div><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>المدة</p><p className="mt-1 font-semibold">{Math.ceil((new Date(leaveForm.endDate).getTime() - new Date(leaveForm.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1} يوم</p></div>
                <div><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>من</p><p className="mt-1 font-semibold" dir="ltr">{leaveForm.startDate}</p></div>
                <div><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>إلى</p><p className="mt-1 font-semibold" dir="ltr">{leaveForm.endDate}</p></div>
              </div>
              {leaveForm.reason && <div className="border-t pt-3" style={{ borderColor: "hsl(var(--border))" }}><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>السبب</p><p className="mt-1 text-sm">{leaveForm.reason}</p></div>}
            </div>
          ) : <div className="space-y-4">
            <div>
              <Label className="text-sm mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>نوع الإجازة *</Label>
              <Select value={leaveForm.leaveType} onValueChange={v => setLeaveForm(f => ({ ...f, leaveType: v }))}>
                <SelectTrigger style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <SelectValue placeholder="اختر نوع الإجازة" />
                </SelectTrigger>
                <SelectContent style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                  {LEAVE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>من *</Label>
                <Input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))}
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
              </div>
              <div>
                <Label className="text-sm mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>إلى *</Label>
                <Input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))}
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
              </div>
            </div>
            <div>
              <Label className="text-sm mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>السبب</Label>
              <Textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="اذكر سبب الإجازة (اختياري)"
                style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            </div>
          </div>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => showLeavePreview ? setShowLeavePreview(false) : setShowLeaveDialog(false)}
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>{showLeavePreview ? "تعديل البيانات" : "إلغاء"}</Button>
            <Button onClick={showLeavePreview ? submitLeave : openLeavePreview} disabled={submittingLeave}
              style={{ background: "#1FA98C", color: "#fff" }}>
              {submittingLeave ? <Loader2 size={16} className="animate-spin ml-2" /> : null}
              {showLeavePreview ? "تأكيد وإرسال الطلب" : "مراجعة الطلب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Salary Letter Dialog ──────────────────────────────────────────── */}
      <Dialog open={showSalaryDialog} onOpenChange={open => { setShowSalaryDialog(open); if (!open) setShowSalaryPreview(false); }}>
        <DialogContent dir="rtl" className="max-w-lg" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "hsl(var(--foreground))", fontFamily: "Alexandria" }}>{showSalaryPreview ? "مراجعة طلب التعريف" : "طلب تعريف بالراتب"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">

            {/* Info note */}
            <div className="p-3 rounded-lg text-sm" style={{ background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C", border: "1px solid hsl(165 69% 39% / 0.20)" }}>
              سيتم إصدار التعريف باللغتين العربية والإنجليزية بعد موافقة مدير الموارد البشرية
            </div>

            {/* Employee selector — only for admin/owner/manager */}
            {canRequestForOthers && (
              <div>
                <Label className="text-sm mb-1 block font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                  الموظف المعني *
                </Label>
                <Select
                  value={salaryForm.selectedEmployeeId || "__self__"}
                  onValueChange={v => setSalaryForm(f => ({ ...f, selectedEmployeeId: v === "__self__" ? "" : v }))}
                >
                  <SelectTrigger style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                    <SelectValue placeholder="اختر الموظف..." />
                  </SelectTrigger>
                  <SelectContent style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "280px" }}>
                    <SelectItem value="__self__">
                      <span className="ml-1">👤</span> {emp?.nameAr || "أنا"} (أنا)
                    </SelectItem>
                    {employees
                      .filter(e => e.employeeId !== emp?.employeeId)
                      .sort((a, b) => (a.department || "").localeCompare(b.department || "", "ar"))
                      .map(e => (
                        <SelectItem key={e.employeeId} value={e.employeeId}>
                          {e.nameAr} — {e.department}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {salaryForm.selectedEmployeeId && (() => {
                  const sel = employees.find(e => e.employeeId === salaryForm.selectedEmployeeId);
                  return sel ? (
                    <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {sel.jobTitle} — {sel.department}
                    </p>
                  ) : null;
                })()}
              </div>
            )}

            {/* Step 1: Recipient type cards */}
            <div>
              <Label className="text-sm mb-2 block font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                الخطوة 1 — نوع الجهة المستلمة *
              </Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {RECIPIENT_TYPES.map(rt => (
                  <button
                    key={rt.value}
                    type="button"
                    onClick={() => setSalaryForm(f => ({ ...f, recipientType: rt.value, selectedBankId: "", selectedEmbassyId: "" }))}
                    className="flex flex-col items-center gap-1 p-3 rounded-xl text-center transition-all"
                    style={{
                      background: salaryForm.recipientType === rt.value ? "hsl(165 69% 39% / 0.15)" : "hsl(var(--background))",
                      border: salaryForm.recipientType === rt.value ? "2px solid #1FA98C" : "2px solid hsl(var(--border))",
                      color: salaryForm.recipientType === rt.value ? "#1FA98C" : "hsl(var(--muted-foreground))",
                    }}>
                    <span className="text-xl">{rt.icon}</span>
                    <span className="text-xs font-semibold">{rt.label}</span>
                  </button>
                ))}
              </div>
              {salaryForm.recipientType && (
                <p className="text-xs mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {RECIPIENT_TYPES.find(r => r.value === salaryForm.recipientType)?.description}
                </p>
              )}
            </div>

            {/* Step 2a: Bank selector */}
            {salaryForm.recipientType === "bank" && (
              <div>
                <Label className="text-sm mb-1 block font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Landmark size={14} className="inline ml-1" />
                  الخطوة 2 — اختر البنك *
                </Label>
                <Select value={salaryForm.selectedBankId} onValueChange={v => setSalaryForm(f => ({ ...f, selectedBankId: v }))}>
                  <SelectTrigger style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                    <SelectValue placeholder="اختر البنك..." />
                  </SelectTrigger>
                  <SelectContent style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "260px" }}>
                    {banks.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.logo && b.logo.startsWith('/') ? <img src={b.logo} alt={b.nameAr} className="inline-block w-5 h-5 object-contain rounded ml-1" style={{background:'#fff'}} /> : <span className="ml-1">{b.logo}</span>} {b.nameAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {salaryForm.selectedBankId && (
                  <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {banks.find(b => b.id === salaryForm.selectedBankId)?.nameEn} — SWIFT: {banks.find(b => b.id === salaryForm.selectedBankId)?.swift}
                  </p>
                )}
              </div>
            )}

            {/* Step 2b: Embassy selector */}
            {salaryForm.recipientType === "embassy" && (
              <div>
                <Label className="text-sm mb-1 block font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Globe size={14} className="inline ml-1" />
                  الخطوة 2 — اختر السفارة *
                </Label>
                <Select value={salaryForm.selectedEmbassyId} onValueChange={v => setSalaryForm(f => ({ ...f, selectedEmbassyId: v }))}>
                  <SelectTrigger style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                    <SelectValue placeholder="اختر السفارة..." />
                  </SelectTrigger>
                  <SelectContent style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "260px" }}>
                    {embassies.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        <span className="ml-1">{e.flag}</span> {e.country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {salaryForm.selectedEmbassyId && (
                  <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Embassy of {embassies.find(e => e.id === salaryForm.selectedEmbassyId)?.countryEn}
                  </p>
                )}
              </div>
            )}

            {/* Step 2c: Custom name for government / housing / general */}
            {["government", "housing", "general"].includes(salaryForm.recipientType) && (
              <div className="space-y-3">
                <Label className="text-sm mb-1 block font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Building2 size={14} className="inline ml-1" />
                  الخطوة 2 — اسم الجهة (اختياري)
                </Label>
                <Input
                  value={salaryForm.customRecipientAr}
                  onChange={e => setSalaryForm(f => ({ ...f, customRecipientAr: e.target.value }))}
                  placeholder="اسم الجهة بالعربي (مثال: وزارة الإسكان)"
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                />
                <Input
                  value={salaryForm.customRecipientEn}
                  onChange={e => setSalaryForm(f => ({ ...f, customRecipientEn: e.target.value }))}
                  placeholder="Entity name in English (optional)"
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                  dir="ltr"
                />
              </div>
            )}

            {/* Notes */}
            {salaryForm.recipientType && (
              <div>
                <Label className="text-sm mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>ملاحظات إضافية</Label>
                <Textarea
                  value={salaryForm.notes}
                  onChange={e => setSalaryForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="أي تفاصيل إضافية تريد ذكرها"
                  rows={2}
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                />
              </div>
            )}
          </div>

          {showSalaryPreview && (
            <div className="rounded-2xl border p-4" style={{ background: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}>
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>راجع البيانات التالية قبل إرسال طلب التعريف للاعتماد.</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>الموظف</p><p className="mt-1 font-semibold">{((canRequestForOthers && salaryForm.selectedEmployeeId) ? employees.find(e => e.employeeId === salaryForm.selectedEmployeeId) : emp)?.nameAr || "—"}</p></div>
                <div><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>نوع الجهة</p><p className="mt-1 font-semibold">{RECIPIENT_TYPES.find(r => r.value === salaryForm.recipientType)?.label || "—"}</p></div>
                <div className="col-span-2"><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>الجهة المستلمة</p><p className="mt-1 font-semibold">{getRecipientNames().ar || "جهة عامة"}</p></div>
              </div>
              {salaryForm.notes && <div className="mt-3 border-t pt-3" style={{ borderColor: "hsl(var(--border))" }}><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>ملاحظات</p><p className="mt-1 text-sm">{salaryForm.notes}</p></div>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => showSalaryPreview ? setShowSalaryPreview(false) : setShowSalaryDialog(false)}
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>{showSalaryPreview ? "تعديل البيانات" : "إلغاء"}</Button>
            <Button onClick={showSalaryPreview ? submitSalaryLetter : openSalaryPreview} disabled={submittingSalary || (!showSalaryPreview && !salaryFormReady)}
              style={{ background: (showSalaryPreview || salaryFormReady) ? "#1FA98C" : "hsl(var(--border))", color: "#fff" }}>
              {submittingSalary ? <Loader2 size={16} className="animate-spin ml-2" /> : null}
              {showSalaryPreview ? "تأكيد وإرسال الطلب" : "مراجعة الطلب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mustChangePassword}>
        <DialogContent dir="rtl" className="max-w-md" onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield size={20} className="text-primary" />تغيير كلمة المرور مطلوب</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">لحماية حسابك، يجب تعيين كلمة مرور جديدة قبل متابعة استخدام بوابة الموظف.</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mandatory-new-password">كلمة المرور الجديدة</Label>
              <Input id="mandatory-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={changingPassword} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mandatory-confirm-password">تأكيد كلمة المرور الجديدة</Label>
              <Input id="mandatory-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={changingPassword} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={changeMandatoryPassword} disabled={changingPassword || !newPassword || !confirmPassword} className="w-full">
              {changingPassword && <Loader2 size={16} className="ml-2 animate-spin" />}حفظ كلمة المرور الجديدة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
