import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ClipboardList, Calendar, Clock, FileText, AlertTriangle,
  CheckCircle2, Plus, Edit2, Trash2, BarChart3, ListChecks,
  BookOpen, RefreshCw, ChevronDown, X, Eye, Download, RotateCcw, ShieldOff, FileWarning, Search, Filter, TrendingUp, Target, Zap, ArrowUpRight
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateWarningLetter, getWarningLetterPreviewHTML, downloadWarningLetterAsWord, type WarningLetterData } from "@/lib/warningLetter";
import PageTemplate from "@/components/layout/PageTemplate";
const peoplePrimary = "hsl(var(--primary))";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  task_number: number;
  recurrence: string;
  task_name: string;
  description: string;
  start_date: string;
  due_date: string;
  due_day: string;
  days_remaining: number;
  time_status: string;
  status: string;
  importance: string;
  data_source: string;
  expected_output: string;
  notes: string;
}

interface WeeklyPlanItem {
  id: number;
  day_name: string;
  time_from: string;
  time_to: string;
  task_name: string;
  importance: string;
  execution_method: string;
  next_week_date: string;
  notes: string;
  recurrence_type: string;
  week_start: string;
}

interface AttendanceEntry {
  id: number;
  employee_id: string;
  employee_name: string;
  record_date: string;
  check_in: string;
  check_out: string;
  status: string;
  note: string;
  late_minutes: number;
  violation_status: string;
  week_number: number;
}

interface ContractEntry {
  id: number;
  employee_id: string;
  employee_name: string;
  contract_type: string;
  end_date: string;
  suggested_action: string;
  notes: string;
  days_remaining: number;
  contract_status: string;
}

interface PenaltyEntry {
  id: number;
  penalty_number: number;
  employee_name: string;
  violation_date: string;
  violation_type: string;
  action_taken: string;
  due_date: string;
  status: string;
  notes: string;
  days_remaining: number;
  follow_up_status: string;
}

interface Dashboard {
  totalTasks: number;
  openTasks: number;
  overdueTasks: number;
  urgentContracts: number;
  openPenalties: number;
  completionRate: number;
  attendanceViolations: number;
  attendanceStats: {
    excusedAbsences: number;
    unexcusedAbsences: number;
    totalEmployees: number;
    compliantEmployees: number;
    nonCompliantEmployees: number;
    complianceRate: number;
    nonComplianceRate: number;
    overallAttendanceRate: number;
    totalWorkingDays: number;
  };
}

// ─── Execution Guide Data ────────────────────────────────────────────────────
const executionGuide = [
  { task: "استفسارات الموظفين", method: "افتح سجل الاستفسارات، صنّف السؤال، راجع السياسة المعتمدة، ثم أرسل رد مختصر وموثق.", sources: "السياسات الداخلية، نظام العمل، سجل الاستفسارات.", output: "رد موثق حسب مدة الاستجابة المعتمدة.", alert: "إذا السؤال حساس أو قانوني ارفعه للمدير قبل الرد النهائي." },
  { task: "اعتماد الإجازات", method: "افتح طلب الإجازة في Zoho، تحقق من الرصيد والمدة وتعارضها مع العمل، ثم اعتمد أو ارفض مع سبب واضح.", sources: "Zoho، رصيد الإجازات، موافقة المدير المباشر.", output: "قرار اعتماد أو رفض موثق.", alert: "أي إجازة تتجاوز الحد المعتمد في السياسة تحتاج مراجعة المدير المختص." },
  { task: "المخالفات الانضباطية", method: "خذ المخالفة من سجل الحضور، اطلب إفادة الموظف عند الحاجة، طبّق الإجراء النظامي، ثم سجل القرار.", sources: "تقرير الحضور، لائحة الجزاءات، إفادة الموظف.", output: "إجراء نظامي موثق.", alert: "لا تنفذ جزاء بدون مستند داعم." },
  { task: "تقرير الحضور الأسبوعي", method: "اطلب تقرير Zoho من هيفا، احسب الغياب والتأخير والخروج المبكر، ثم اكتب ملخص أسبوعي.", sources: "Zoho، سجل الحضور، ملاحظات هيفا.", output: "ملخص مخالفات أسبوعي.", alert: "استخدم الأرقام فقط في الاجتماع واحتفظ بالتفاصيل في السجل." },
  { task: "قائمة التحقق الأسبوعية", method: "حدّث حالة المهام والعقود والجزاءات والامتثال، ثم أرسل النسخة لعبدالرحمن قبل الاجتماع.", sources: "ملف المتابعة، سجل العقود، سجل الجزاءات، منصات الامتثال.", output: "قائمة تحقق مرسلة قبل الموعد النهائي المعتمد.", alert: "جهّزها في يوم التحضير المعتمد وحدّثها قبل الاجتماع الأسبوعي." },
  { task: "اجتماع EPMO", method: "ادخل الاجتماع ومعك ثلاث نقاط: ماذا أُنجز، ما المخاطر، وما المطلوب من الإدارة.", sources: "قائمة التحقق، ملخص الحضور، تقرير الامتثال.", output: "محضر ومهام جديدة واضحة.", alert: "أي قرار يصدر في الاجتماع حوّله لمهمة بتاريخ استحقاق." },
  { task: "طلبات التوظيف", method: "راجع الاحتياج الوظيفي والميزانية والوصف الوظيفي ثم وافق على نشر الإعلان إذا كان مكتمل.", sources: "طلب التوظيف، الوصف الوظيفي، الميزانية.", output: "اعتماد إعلان وظيفي أو طلب تعديل.", alert: "لا تعتمد إعلان بدون وصف وظيفي واضح." },
  { task: "مسير الرواتب", method: "طابق الحضور والخصومات والغياب والإضافي مع المالية قبل الاعتماد.", sources: "مسير الرواتب، الحضور، الإجازات، الجزاءات.", output: "مسير رواتب مراجع.", alert: "ركّز على الحالات المتغيرة وليس كل الموظفين بنفس العمق." },
  { task: "مراجعة الامتثال", method: "افتح نطاقات وقوى ومدد، تحقق من التنبيهات، ثم سجل حالة كل منصة والإجراء المطلوب.", sources: "نطاقات، قوى، مدد، سجل العقود.", output: "تقرير امتثال مختصر.", alert: "راجعها في يوم التحضير المعتمد لتدخل الاجتماع الأسبوعي جاهزاً." },
  { task: "العقود المنتهية", method: "فلتر العقود التي تقترب من تاريخ الانتهاء حسب السياسة المعتمدة، راجع الاحتياج والتقييم، ثم جهّز قرار التجديد أو الإنهاء.", sources: "سجل العقود، تقييم الأداء، موافقة الإدارة.", output: "قرار تجديد أو إنهاء.", alert: "ابدأ بالعقود الأعلى أولوية حسب تاريخ الانتهاء والمخاطر النظامية." },
];

// ─── Checklist Data ──────────────────────────────────────────────────────────
const checklistItems = [
  { area: "الحضور", question: "هل تم استلام تقرير Zoho؟ هل تم تحديد الغياب والتأخير والخروج المبكر؟" },
  { area: "العقود", question: "هل تم فلترة العقود المنتهية خلال المدة المعتمدة؟ هل يوجد قرار تجديد أو إنهاء؟" },
  { area: "الجزاءات", question: "هل كل مخالفة لها مستند؟ هل تم توثيق الإجراء والحالة؟" },
  { area: "الامتثال", question: "هل تم فتح نطاقات وقوى ومدد؟ هل توجد تنبيهات أو مخاطر؟" },
  { area: "الرواتب", question: "هل تم إرسال أي خصومات أو ملاحظات للمالية قبل اعتماد المسير؟" },
  { area: "الاجتماع", question: "هل لديك ثلاث نقاط واضحة: المنجز، المخاطر، المطلوب؟" },
];

// ─── Tabs ────────────────────────────────────────────────────────────────────
const tabs = [
  { id: "dashboard", label: "لوحة التحكم", icon: BarChart3 },
  { id: "tasks", label: "المهام", icon: ClipboardList },
  { id: "weekly", label: "الخطة الأسبوعية", icon: Calendar },
  { id: "attendance", label: "الحضور", icon: Clock },
  { id: "contracts", label: "العقود", icon: FileText },
  { id: "penalties", label: "الجزاءات", icon: AlertTriangle },
  { id: "guide", label: "دليل التنفيذ", icon: BookOpen },
  { id: "checklist", label: "التحقق", icon: ListChecks },
];

// ─── Status/Importance Badges ────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "منجز": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    "مكتمل": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    "قيد التنفيذ": "bg-amber-500/15 text-amber-400 border-amber-500/25",
    "لم يبدأ": "bg-slate-500/15 text-slate-400 border-slate-500/25",
    "متأخر": "bg-red-500/15 text-red-400 border-red-500/25",
    "حاضر": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    "غياب": "bg-red-500/15 text-red-400 border-red-500/25",
    "إجازة": "bg-blue-500/15 text-blue-400 border-blue-500/25",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${colors[status] || colors["لم يبدأ"]}`}>
      {status}
    </span>
  );
}

function ImportanceBadge({ importance }: { importance: string }) {
  const colors: Record<string, string> = {
    "عالي": "bg-red-500/15 text-red-400 border-red-500/25",
    "متوسط": "bg-amber-500/15 text-amber-400 border-amber-500/25",
    "منخفض": "bg-blue-500/15 text-blue-400 border-blue-500/25",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${colors[importance] || colors["متوسط"]}`}>
      {importance}
    </span>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyState({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <div className="icon-teal-lg mb-4">
        <ClipboardList size={24} />
      </div>
      <p className="text-base font-bold" style={{ color: "hsl(0 0% 77%)" }}>{message}</p>
      <p className="text-sm mt-2" style={{ color: "hsl(0 0% 52%)" }}>أضف بيانات جديدة أو تواصل مع المسؤول لإدخال البيانات المطلوبة</p>
      {action && (
        <button onClick={action.onClick} className="btn-brand mt-4">
          <Plus size={14} />
          <span>{action.label}</span>
        </button>
      )}
    </div>
  );
}

// ─── Search Bar Component ────────────────────────────────────────────────────
function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(0 0% 45%)" }} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "بحث..."}
        className="w-full pr-9 pl-3 py-2 rounded-lg border text-sm transition-colors focus:border-[#1FA98C] focus:outline-none"
        style={{ background: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}
      />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function MyTasks() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlanItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [penalties, setPenalties] = useState<PenaltyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch data based on active tab
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        if (activeTab === "dashboard") {
          const res = await fetch("/api/tasks/dashboard", { credentials: "include" });
          if (res.ok) setDashboard(await res.json());
        } else if (activeTab === "tasks") {
          const res = await fetch("/api/tasks/items", { credentials: "include" });
          if (res.ok) setTasks(await res.json());
        } else if (activeTab === "weekly") {
          const res = await fetch("/api/tasks/weekly-plan", { credentials: "include" });
          if (res.ok) setWeeklyPlan(await res.json());
        } else if (activeTab === "attendance") {
          const res = await fetch("/api/tasks/attendance", { credentials: "include" });
          if (res.ok) setAttendance(await res.json());
        } else if (activeTab === "contracts") {
          const res = await fetch("/api/tasks/contracts", { credentials: "include" });
          if (res.ok) setContracts(await res.json());
        } else if (activeTab === "penalties") {
          const res = await fetch("/api/tasks/penalties", { credentials: "include" });
          if (res.ok) setPenalties(await res.json());
        }
      } catch (e) { console.error("Fetch error:", e); }
      setLoading(false);
    };
    fetchData();
  }, [activeTab]);

  // ─── Dashboard Tab ─────────────────────────────────────────────────────────
  const handleExportDashboardExcel = async () => {
    try {
      const res = await fetch("/api/tasks/dashboard/export-excel", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير_شامل_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("جارٍ تحميل التقرير الشامل...");
    } catch (e) {
      toast.error("فشل تحميل التقرير");
    }
  };

  const renderDashboard = () => {
    if (!dashboard) return <EmptyState message="لا توجد بيانات في لوحة التحكم" />;

    const completionNum = typeof dashboard.completionRate === "number" ? dashboard.completionRate : 0;

    const kpis = [
      { id: "total", label: "إجمالي المهام", value: dashboard.totalTasks, icon: ClipboardList, color: peoplePrimary, tab: "tasks" },
      { id: "open", label: "المهام المفتوحة", value: dashboard.openTasks, icon: Clock, color: "#F59E0B", tab: "tasks" },
      { id: "overdue", label: "المهام المتأخرة", value: dashboard.overdueTasks, icon: AlertTriangle, color: "#EF4444", tab: "tasks" },
      { id: "contracts", label: "عقود عاجلة", value: dashboard.urgentContracts, icon: FileText, color: "#8B5CF6", tab: "contracts" },
      { id: "penalties", label: "جزاءات مفتوحة", value: dashboard.openPenalties, icon: AlertTriangle, color: "#EC4899", tab: "penalties" },
      { id: "violations", label: "مخالفات الحضور", value: dashboard.attendanceViolations, icon: Clock, color: "#F97316", tab: "attendance" },
    ];

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Hero Progress Section */}
        <div className="card-brand rounded-xl p-6">
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Circular Progress */}
            <div className="relative w-36 h-36 flex-shrink-0">
              <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="hsl(0 0% 25%)" strokeWidth="8" />
                <circle cx="60" cy="60" r="50" fill="none" stroke="url(#progressGradient)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${completionNum * 3.14} 314`} className="transition-all duration-1000" />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#1FA98C" />
                    <stop offset="100%" stopColor="hsl(165 60% 55%)" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black" style={{ color: peoplePrimary }}>{completionNum}%</span>
                <span className="text-[11px] font-medium" style={{ color: "hsl(0 0% 52%)" }}>نسبة الإنجاز</span>
              </div>
            </div>
            {/* Summary Stats */}
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
              <div className="text-center p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-2xl font-black" style={{ color: peoplePrimary }}>{dashboard.totalTasks}</div>
                <div className="text-xs font-medium mt-1" style={{ color: "hsl(0 0% 55%)" }}>إجمالي المهام</div>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-2xl font-black" style={{ color: "#F59E0B" }}>{dashboard.openTasks}</div>
                <div className="text-xs font-medium mt-1" style={{ color: "hsl(0 0% 55%)" }}>مفتوحة</div>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-2xl font-black" style={{ color: "#EF4444" }}>{dashboard.overdueTasks}</div>
                <div className="text-xs font-medium mt-1" style={{ color: "hsl(0 0% 55%)" }}>متأخرة</div>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-2xl font-black" style={{ color: "#10B981" }}>{dashboard.totalTasks - dashboard.openTasks}</div>
                <div className="text-xs font-medium mt-1" style={{ color: "hsl(0 0% 55%)" }}>منجزة</div>
              </div>
            </div>
          </div>
        </div>

        {/* KPI Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kpis.map((kpi, i) => (
            <div
              key={kpi.id}
              onClick={() => { if (kpi.tab) setActiveTab(kpi.tab); }}
              className="stat-card cursor-pointer group animate-fade-in-up"
              style={{ animationDelay: `${i * 80}ms`, opacity: 0 }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15` }}>
                  <kpi.icon size={18} style={{ color: kpi.color }} />
                </div>
                <ArrowUpRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: kpi.color }} />
              </div>
              <div className="text-2xl font-black mb-0.5" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="text-sm font-semibold" style={{ color: "hsl(0 0% 75%)" }}>{kpi.label}</div>
              {/* Mini progress bar */}
              {typeof kpi.value === "number" && dashboard.totalTasks > 0 && (
                <div className="progress-brand mt-3">
                  <div className="progress-brand-fill" style={{ width: `${Math.min((kpi.value / dashboard.totalTasks) * 100, 100)}%`, background: kpi.color }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Attendance Stats Card */}
        {dashboard.attendanceStats && (
          <div className="card-brand rounded-xl p-5">
            <div className="section-title">
              <TrendingUp size={16} style={{ color: peoplePrimary }} />
              <span>إحصائيات الحضور</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-xs mb-1" style={{ color: "hsl(0 0% 52%)" }}>نسبة الالتزام</div>
                <div className="text-xl font-black" style={{ color: "#10B981" }}>{dashboard.attendanceStats.complianceRate}%</div>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-xs mb-1" style={{ color: "hsl(0 0% 52%)" }}>غياب بعذر</div>
                <div className="text-xl font-black" style={{ color: "#3B82F6" }}>{dashboard.attendanceStats.excusedAbsences}</div>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-xs mb-1" style={{ color: "hsl(0 0% 52%)" }}>غياب بدون عذر</div>
                <div className="text-xl font-black" style={{ color: "#EF4444" }}>{dashboard.attendanceStats.unexcusedAbsences}</div>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                <div className="text-xs mb-1" style={{ color: "hsl(0 0% 52%)" }}>إجمالي الموظفين</div>
                <div className="text-xl font-black" style={{ color: "#1FA98C" }}>{dashboard.attendanceStats.totalEmployees}</div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Navigation */}
        <div className="card-brand rounded-xl p-5">
          <div className="section-title">
              <Zap size={16} style={{ color: peoplePrimary }} />
            <span>وصول سريع</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { tab: "tasks", label: "المهام التفصيلية", icon: ClipboardList, color: "#1FA98C" },
              { tab: "contracts", label: "سجل العقود", icon: FileText, color: "#8B5CF6" },
              { tab: "penalties", label: "سجل الجزاءات", icon: AlertTriangle, color: "#EC4899" },
              { tab: "attendance", label: "سجل الحضور", icon: Clock, color: "#F97316" },
              { tab: "checklist", label: "قائمة التحقق", icon: ListChecks, color: "#10B981" },
            ].map(item => (
              <button
                key={item.tab}
                onClick={() => setActiveTab(item.tab)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: `${item.color}12`, color: item.color, border: `1px solid ${item.color}25` }}
              >
                <item.icon size={14} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ─── Tasks Tab ─────────────────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    if (!searchQuery) return tasks;
    return tasks.filter(t =>
      t.task_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.status?.includes(searchQuery) ||
      t.importance?.includes(searchQuery)
    );
  }, [tasks, searchQuery]);

  const renderTasks = () => {
    if (tasks.length === 0) return <EmptyState message="لا توجد مهام مسجلة حالياً" action={{ label: "إضافة مهمة", onClick: () => { setEditItem(null); setShowAddModal(true); } }} />;
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Search & Filter Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 max-w-sm">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="بحث في المهام..." />
          </div>
          <div className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: "hsl(0 0% 21%)", color: "hsl(0 0% 62%)" }}>
            {filteredTasks.length} مهمة
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "hsl(0 0% 25%)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>المهمة</th>
                <th>التكرار</th>
                <th>تاريخ الاستحقاق</th>
                <th>الأهمية</th>
                <th>الحالة</th>
                <th>الناتج المطلوب</th>
                <th style={{ textAlign: "center" }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task, i) => (
                <tr key={task.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 30}ms`, opacity: 0 }}>
                  <td style={{ color: "hsl(0 0% 55%)", fontSize: "12px" }}>{task.task_number}</td>
                  <td>
                    <span className="font-semibold text-sm" style={{ color: "hsl(0 0% 92%)" }}>{task.task_name}</span>
                  </td>
                  <td><span className="badge-teal">{task.recurrence}</span></td>
                  <td style={{ color: "hsl(0 0% 72%)", fontSize: "13px" }}>{task.due_date ? new Date(task.due_date).toLocaleDateString("en-CA") : "—"}</td>
                  <td><ImportanceBadge importance={task.importance} /></td>
                  <td><StatusBadge status={task.status} /></td>
                  <td className="max-w-[180px] truncate text-xs" style={{ color: "hsl(0 0% 62%)" }}>{task.expected_output || "—"}</td>
                  <td style={{ textAlign: "center" }}>
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => handleEditTask(task)} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="تعديل">
                        <Edit2 size={14} style={{ color: "#1FA98C" }} />
                      </button>
                      <button onClick={() => handleDeleteTask(task.id)} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="حذف">
                        <Trash2 size={14} style={{ color: "#EF4444" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── Weekly Plan Tab ───────────────────────────────────────────────────────
  const [weeklyChecked, setWeeklyChecked] = useState<Record<number, boolean>>({});
  const [weeklyFilter, setWeeklyFilter] = useState<string>("أسبوعي");

  const weeklyCompletionRate = useMemo(() => {
    if (weeklyPlan.length === 0) return 0;
    const checked = Object.values(weeklyChecked).filter(Boolean).length;
    return Math.round((checked / weeklyPlan.length) * 100);
  }, [weeklyChecked, weeklyPlan]);

  const recurrenceCategories = [
    { id: "يومي", label: "يومي", icon: "☀️" },
    { id: "أسبوعي", label: "أسبوعي", icon: "📅" },
    { id: "شهري", label: "شهري", icon: "📋" },
    { id: "ربع سنوي", label: "ربع سنوي", icon: "📊" },
    { id: "سنوي", label: "سنوي", icon: "🎯" },
    { id: "عند الحاجة", label: "عند الحاجة", icon: "⚡" },
  ];

  const renderWeeklyPlan = () => {
    if (weeklyPlan.length === 0) return <EmptyState message="لا توجد خطة أسبوعية مسجلة" action={{ label: "إضافة مهمة أسبوعية", onClick: () => { setEditItem(null); setShowAddModal(true); } }} />;

    const filteredItems = weeklyPlan.filter(item => (item.recurrence_type || "أسبوعي") === weeklyFilter);
    const totalChecked = Object.values(weeklyChecked).filter(Boolean).length;

    return (
      <div className="space-y-4 animate-fade-in">
        {/* Progress Bar */}
        <div className="card-brand rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target size={15} style={{ color: "#1FA98C" }} />
              <span className="text-sm font-bold" style={{ color: "hsl(0 0% 85%)" }}>تقدم الإنجاز</span>
            </div>
            <span className="text-sm font-black" style={{ color: weeklyCompletionRate === 100 ? "#10B981" : "#1FA98C" }}>{weeklyCompletionRate}%</span>
          </div>
          <div className="progress-brand">
            <div className="progress-brand-fill" style={{ width: `${weeklyCompletionRate}%` }} />
          </div>
          <div className="text-xs mt-2 font-medium" style={{ color: "hsl(0 0% 52%)" }}>
            {totalChecked} من {weeklyPlan.length} مهمة مكتملة
          </div>
        </div>

        {/* Recurrence Filter Tabs */}
        <div className="flex flex-wrap gap-2">
          {recurrenceCategories.map(cat => {
            const count = weeklyPlan.filter(i => (i.recurrence_type || "أسبوعي") === cat.id).length;
            if (count === 0) return null;
            return (
              <button
                key={cat.id}
                onClick={() => setWeeklyFilter(cat.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: weeklyFilter === cat.id ? "#1FA98C" : "hsl(0 0% 21%)",
                  color: weeklyFilter === cat.id ? "#fff" : "hsl(0 0% 72%)",
                  border: `1px solid ${weeklyFilter === cat.id ? "#1FA98C" : "hsl(0 0% 28%)"}`
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: weeklyFilter === cat.id ? "rgba(255,255,255,0.2)" : "hsl(0 0% 25%)" }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Tasks grouped by day_name */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-8" style={{ color: "hsl(0 0% 55%)" }}>لا توجد مهام في هذا التصنيف</div>
        ) : (
          (() => {
            const groups: Record<string, WeeklyPlanItem[]> = {};
            filteredItems.forEach(item => {
              const key = item.day_name || "عام";
              if (!groups[key]) groups[key] = [];
              groups[key].push(item);
            });
            return Object.entries(groups).map(([dayLabel, items]) => {
              const dayCompleted = items.filter(i => weeklyChecked[i.id]).length;
              return (
                <div key={dayLabel} className="card-brand rounded-xl overflow-hidden">
                  <div className="px-4 py-3 flex items-center justify-between" style={{ background: "hsl(165 69% 39% / 0.08)", borderBottom: "1px solid hsl(0 0% 25%)" }}>
                    <span className="font-bold text-sm" style={{ color: "#1FA98C" }}>{dayLabel}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C" }}>{dayCompleted}/{items.length}</span>
                  </div>
                  <div className="divide-y" style={{ borderColor: "hsl(0 0% 23%)" }}>
                    {items.map((item) => (
                      <label key={item.id} className="px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors hover:bg-white/[0.02]" style={{ background: weeklyChecked[item.id] ? "hsl(165 69% 39% / 0.03)" : "transparent" }}>
                        <input
                          type="checkbox"
                          checked={!!weeklyChecked[item.id]}
                          onChange={() => setWeeklyChecked(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                          className="w-4 h-4 rounded accent-emerald-500 shrink-0"
                        />
                        <div className="text-xs font-mono shrink-0 px-2 py-0.5 rounded" style={{ color: "hsl(0 0% 62%)", background: "hsl(0 0% 16%)" }}>{item.time_from} - {item.time_to}</div>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${weeklyChecked[item.id] ? "line-through opacity-50" : ""}`} style={{ color: "hsl(0 0% 88%)" }}>{item.task_name}</div>
                          {item.execution_method && <div className="text-xs mt-0.5 truncate" style={{ color: "hsl(0 0% 52%)" }}>{item.execution_method}</div>}
                        </div>
                        <ImportanceBadge importance={item.importance} />
                      </label>
                    ))}
                  </div>
                </div>
              );
            });
          })()
        )}
      </div>
    );
  };

  // ─── Attendance Tab ────────────────────────────────────────────────────────
  const handleExportAttendance = async () => {
    try {
      const res = await fetch("/api/tasks/attendance/export-excel", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير_الحضور_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("جارٍ تحميل تقرير الحضور...");
    } catch (e) {
      toast.error("فشل تحميل التقرير");
    }
  };

  const filteredAttendance = useMemo(() => {
    if (!searchQuery) return attendance;
    return attendance.filter(a =>
      a.employee_name?.includes(searchQuery) ||
      a.employee_id?.includes(searchQuery) ||
      a.status?.includes(searchQuery)
    );
  }, [attendance, searchQuery]);

  const renderAttendance = () => {
    if (attendance.length === 0) return <EmptyState message="لا توجد سجلات حضور مسجلة" action={{ label: "إضافة سجل حضور", onClick: () => { setEditItem(null); setShowAddModal(true); } }} />;
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 max-w-sm">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="بحث بالاسم أو الرقم..." />
          </div>
          <button onClick={handleExportAttendance} className="btn-brand text-xs">
            <Download size={14} />
            <span>تحميل Excel</span>
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "hsl(0 0% 25%)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>رقم الموظف</th>
                <th>الاسم</th>
                <th>التاريخ</th>
                <th>الدخول</th>
                <th>الخروج</th>
                <th>الحالة</th>
                <th>دقائق التأخير</th>
                <th>حالة المخالفة</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttendance.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ color: "hsl(0 0% 62%)", fontSize: "12px" }}>{entry.employee_id}</td>
                  <td><span className="font-semibold text-sm" style={{ color: "hsl(0 0% 92%)" }}>{entry.employee_name}</span></td>
                  <td style={{ color: "hsl(0 0% 72%)", fontSize: "13px" }}>{entry.record_date ? new Date(entry.record_date).toLocaleDateString("en-CA") : "—"}</td>
                  <td style={{ color: "hsl(0 0% 72%)", fontSize: "13px" }}>{entry.check_in || "—"}</td>
                  <td style={{ color: "hsl(0 0% 72%)", fontSize: "13px" }}>{entry.check_out || "—"}</td>
                  <td><StatusBadge status={entry.status || "—"} /></td>
                  <td style={{ color: entry.late_minutes > 0 ? "#EF4444" : "hsl(0 0% 55%)", fontWeight: entry.late_minutes > 0 ? 700 : 400, fontSize: "13px" }}>{entry.late_minutes || 0}</td>
                  <td>
                    {entry.violation_status === "مخالفة" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25">مخالفة</span>
                    ) : (
                      <span className="text-xs" style={{ color: "hsl(0 0% 52%)" }}>{entry.violation_status || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── Contracts Tab ─────────────────────────────────────────────────────────
  const [renewModalContract, setRenewModalContract] = useState<ContractEntry | null>(null);
  const [renewYears, setRenewYears] = useState("2");
  const [renewingId, setRenewingId] = useState<number | null>(null);

  const handleExportContracts = async () => {
    try {
      const res = await fetch("/api/tasks/contracts/export-excel", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير_العقود_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("جارٍ تحميل تقرير العقود...");
    } catch (e) {
      toast.error("فشل تحميل التقرير");
    }
  };

  const handleRenewContract = async () => {
    if (!renewModalContract) return;
    setRenewingId(renewModalContract.id);
    try {
      const res = await fetch("/api/tasks/contracts/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contractId: renewModalContract.id, renewalYears: parseInt(renewYears) }),
      });
      if (res.ok) {
        const result = await res.json();
        setContracts(prev => prev.map(c => c.id === renewModalContract.id ? { ...c, end_date: result.newEndDate, days_remaining: result.daysRemaining, contract_status: result.status } : c));
        toast.success(`تم تجديد العقد بنجاح — ينتهي ${result.newEndDate}`);
        setRenewModalContract(null);
      } else {
        toast.error("فشل تجديد العقد");
      }
    } catch (e) {
      toast.error("خطأ في الاتصال");
    }
    setRenewingId(null);
  };

  const filteredContracts = useMemo(() => {
    if (!searchQuery) return contracts;
    return contracts.filter(c =>
      c.employee_name?.includes(searchQuery) ||
      c.employee_id?.includes(searchQuery) ||
      c.contract_status?.includes(searchQuery)
    );
  }, [contracts, searchQuery]);

  const renderContracts = () => {
    if (contracts.length === 0) return <EmptyState message="لا توجد سجلات عقود مسجلة" action={{ label: "إضافة عقد", onClick: () => { setEditItem(null); setShowAddModal(true); } }} />;
    return (
      <>
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 max-w-sm">
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="بحث بالاسم أو الرقم..." />
            </div>
            <button onClick={handleExportContracts} className="btn-brand text-xs">
              <Download size={14} />
              <span>تحميل Excel</span>
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "hsl(0 0% 25%)" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم الموظف</th>
                  <th>الاسم</th>
                  <th>نوع العقد</th>
                  <th>تاريخ الانتهاء</th>
                  <th>الأيام المتبقية</th>
                  <th>الإجراء المقترح</th>
                  <th>الحالة</th>
                  <th style={{ textAlign: "center" }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredContracts.map((c) => (
                  <tr key={c.id}>
                    <td style={{ color: "hsl(0 0% 62%)", fontSize: "12px" }}>{c.employee_id}</td>
                    <td><span className="font-semibold text-sm" style={{ color: "hsl(0 0% 92%)" }}>{c.employee_name}</span></td>
                    <td style={{ color: "hsl(0 0% 72%)", fontSize: "13px" }}>{c.contract_type || "—"}</td>
                    <td style={{ color: "hsl(0 0% 72%)", fontSize: "13px" }}>{c.end_date ? new Date(c.end_date).toLocaleDateString("en-CA") : "—"}</td>
                    <td style={{ color: c.days_remaining <= 30 ? "#EF4444" : "hsl(0 0% 72%)", fontWeight: c.days_remaining <= 30 ? 700 : 400, fontSize: "13px" }}>{c.days_remaining ?? "—"}</td>
                    <td style={{ color: "hsl(0 0% 65%)", fontSize: "13px" }}>{c.suggested_action || "—"}</td>
                    <td>
                      {c.contract_status && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                          c.contract_status.includes("عاجل") ? "bg-red-500/15 text-red-400 border-red-500/25" :
                          c.contract_status.includes("30") ? "bg-amber-500/15 text-amber-400 border-amber-500/25" :
                          "bg-slate-500/15 text-slate-400 border-slate-500/25"
                        }`}>{c.contract_status}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        onClick={() => { setRenewModalContract(c); setRenewYears("2"); }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-[1.03] active:scale-[0.97] mx-auto"
                        style={{ background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C" }}
                      >
                        <RotateCcw size={13} />
                        <span>تجديد</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Contract Renewal Modal */}
        <Dialog open={!!renewModalContract} onOpenChange={(open) => { if (!open) setRenewModalContract(null); }}>
          <DialogContent className="max-w-md" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 28%)" }}>
            <DialogHeader>
              <DialogTitle className="text-right" style={{ color: "#1FA98C", fontFamily: "Alexandria" }}>
                تجديد العقد — {renewModalContract?.employee_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="p-3 rounded-lg" style={{ background: "hsl(0 0% 21%)" }}>
                <div className="text-xs mb-1" style={{ color: "hsl(0 0% 55%)" }}>تاريخ الانتهاء الحالي</div>
                <div className="font-bold" style={{ color: "hsl(0 0% 85%)" }}>{renewModalContract?.end_date ? new Date(renewModalContract.end_date).toLocaleDateString("en-CA") : "—"}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "hsl(0 0% 65%)" }}>مدة التجديد (سنوات)</label>
                <select
                  value={renewYears}
                  onChange={(e) => setRenewYears(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ background: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}
                >
                  <option value="1">1 سنة</option>
                  <option value="2">2 سنتين</option>
                  <option value="3">3 سنوات</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleRenewContract} disabled={renewingId !== null} className="btn-brand flex-1 justify-center">
                  {renewingId ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  <span>{renewingId ? "جاري التجديد..." : "تأكيد التجديد"}</span>
                </button>
                <button onClick={() => setRenewModalContract(null)} className="flex-1 py-2.5 rounded-lg font-medium text-sm border" style={{ borderColor: "hsl(0 0% 33%)", color: "hsl(0 0% 72%)" }}>
                  إلغاء
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  };

  // ─── Penalties Tab (Grouped by Employee) ────────────────────────────────────
  interface GroupedEmployee {
    employeeName: string;
    penalties: {
      id: number;
      penaltyNumber: number;
      violationType: string;
      violationDate: string;
      actionTaken: string;
      status: string;
      notes: string;
      followUpStatus: string;
      violationDates: string[];
      deductionDays: number;
    }[];
    totalDeductionDays: number;
    hasActiveViolations: boolean;
  }

  const [groupedPenalties, setGroupedPenalties] = useState<GroupedEmployee[]>([]);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [syncingPenalties, setSyncingPenalties] = useState(false);
  const [exemptModalPenalty, setExemptModalPenalty] = useState<any>(null);
  const [exemptReason, setExemptReason] = useState("");
  const [exemptingId, setExemptingId] = useState<number | null>(null);
  const [exemptType, setExemptType] = useState<"full" | "partial">("full");
  const [selectedExemptDates, setSelectedExemptDates] = useState<string[]>([]);
  const [selectedPenaltyEmployee, setSelectedPenaltyEmployee] = useState<string | null>(null);
  const [employeeLateDays, setEmployeeLateDays] = useState<AttendanceEntry[]>([]);
  const [loadingLateDays, setLoadingLateDays] = useState(false);
  const [markingDoneId, setMarkingDoneId] = useState<number | null>(null);
  const [previewWarningData, setPreviewWarningData] = useState<WarningLetterData | null>(null);
  const [showWarningPreview, setShowWarningPreview] = useState(false);

  const handleMarkDone = async (penaltyId: number, isDone: boolean) => {
    setMarkingDoneId(penaltyId);
    try {
      const endpoint = isDone ? "/api/tasks/penalties/undo-done" : "/api/tasks/penalties/mark-done";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ penaltyId }),
      });
      if (res.ok) {
        toast.success(isDone ? "تم إلغاء التعليم" : "تم تعليم الجزاء كمنفذ ✓");
        await fetchGroupedPenalties();
      } else {
        toast.error("فشل تحديث الحالة");
      }
    } catch (e) {
      toast.error("خطأ في الاتصال");
    }
    setMarkingDoneId(null);
  };

  const fetchGroupedPenalties = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/penalties/grouped", { credentials: "include" });
      if (res.ok) setGroupedPenalties(await res.json());
    } catch (e) { console.error("Error fetching grouped penalties:", e); }
  }, []);

  useEffect(() => {
    if (activeTab === "penalties") fetchGroupedPenalties();
  }, [activeTab, fetchGroupedPenalties]);

  const handleExempt = async () => {
    if (!exemptModalPenalty) return;
    setExemptingId(exemptModalPenalty.id);
    try {
      if (exemptType === "full") {
        const res = await fetch("/api/tasks/penalties/exempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ penaltyId: exemptModalPenalty.id, reason: exemptReason }),
        });
        if (res.ok) {
          toast.success("تم إعفاء الجزاء بالكامل");
          await fetchGroupedPenalties();
          setExemptModalPenalty(null);
          setExemptReason("");
        } else {
          toast.error("فشل الإعفاء");
        }
      } else {
        if (selectedExemptDates.length === 0) {
          toast.error("اختر يوم واحد على الأقل للإعفاء");
          setExemptingId(null);
          return;
        }
        const res = await fetch("/api/tasks/penalties/exempt-days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ penaltyId: exemptModalPenalty.id, exemptDates: selectedExemptDates, reason: exemptReason }),
        });
        if (res.ok) {
          toast.success(`تم إعفاء ${selectedExemptDates.length} أيام من الجزاء`);
          await fetchGroupedPenalties();
          setExemptModalPenalty(null);
          setExemptReason("");
          setSelectedExemptDates([]);
        } else {
          toast.error("فشل الإعفاء الجزئي");
        }
      }
    } catch (e) {
      toast.error("خطأ في الاتصال");
    }
    setExemptingId(null);
  };

  const handleSyncPenalties = async () => {
    setSyncingPenalties(true);
    try {
      const res = await fetch("/api/tasks/penalties/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchGroupedPenalties();
        const penRes = await fetch("/api/tasks/penalties", { credentials: "include" });
        if (penRes.ok) setPenalties(await penRes.json());
        toast.success("تم تحديث الجزاءات بنجاح");
      }
    } catch (e) {
      console.error("Error syncing penalties:", e);
      toast.error("فشل تحديث الجزاءات");
    }
    setSyncingPenalties(false);
  };

  const handleExportPenalties = async () => {
    try {
      const res = await fetch("/api/tasks/penalties/export-excel", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير_الجزاءات_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("جارٍ تحميل تقرير الجزاءات...");
    } catch (e) {
      toast.error("فشل تحميل التقرير");
    }
  };

  const handleEmployeeClick = async (employeeName: string) => {
    setSelectedPenaltyEmployee(employeeName);
    setLoadingLateDays(true);
    try {
      const res = await fetch("/api/tasks/attendance", { credentials: "include" });
      if (res.ok) {
        const allAttendance: AttendanceEntry[] = await res.json();
        const lateDays = allAttendance.filter(
          (a) => a.employee_name === employeeName && (a.late_minutes > 0 || (!a.check_out && a.check_in) || a.status === "غياب")
        ).sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());
        setEmployeeLateDays(lateDays);
      }
    } catch (e) {
      console.error("Error fetching late days:", e);
    }
    setLoadingLateDays(false);
  };

  const getViolationColor = (type: string) => {
    if (!type) return { bg: "rgba(100,116,139,0.15)", text: "#94A3B8", border: "rgba(100,116,139,0.3)" };
    if (type.includes("تأخير")) return { bg: "rgba(245,158,11,0.15)", text: "#F59E0B", border: "rgba(245,158,11,0.3)" };
    if (type.includes("غياب")) return { bg: "rgba(239,68,68,0.15)", text: "#EF4444", border: "rgba(239,68,68,0.3)" };
    if (type.includes("انصراف")) return { bg: "rgba(168,85,247,0.15)", text: "#A855F7", border: "rgba(168,85,247,0.3)" };
    if (type.includes("بصمة")) return { bg: "rgba(249,115,22,0.15)", text: "#F97316", border: "rgba(249,115,22,0.3)" };
    return { bg: "rgba(100,116,139,0.15)", text: "#94A3B8", border: "rgba(100,116,139,0.3)" };
  };

  const getPenaltySeverity = (action: string) => {
    if (!action) return { label: "—", color: "#94A3B8", bg: "rgba(100,116,139,0.15)" };
    if (action.includes("يومين") || action.includes("تحقيق")) return { label: "خطير", color: "#EF4444", bg: "rgba(239,68,68,0.15)" };
    if (action.includes("يوم كامل") || action.includes("يوم من")) return { label: "مرتفع", color: "#F97316", bg: "rgba(249,115,22,0.15)" };
    if (action.includes("نصف يوم") || action.includes("ربع يوم")) return { label: "متوسط", color: "#F59E0B", bg: "rgba(245,158,11,0.15)" };
    if (action.includes("إنذار")) return { label: "منخفض", color: "#3B82F6", bg: "rgba(59,130,246,0.15)" };
    return { label: "—", color: "#94A3B8", bg: "rgba(100,116,139,0.15)" };
  };

  const renderPenalties = () => {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Sync & Export Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncPenalties}
              disabled={syncingPenalties}
              className="btn-brand text-xs"
            >
              <RefreshCw size={14} className={syncingPenalties ? "animate-spin" : ""} />
              <span>{syncingPenalties ? "جاري الحساب..." : "تحديث من Zoho"}</span>
            </button>
            <button onClick={handleExportPenalties} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all" style={{ background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C", border: "1px solid hsl(165 69% 39% / 0.25)" }}>
              <Download size={14} />
              <span>تحميل Excel</span>
            </button>
          </div>
          <div className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: "hsl(0 0% 21%)", color: "hsl(0 0% 62%)" }}>
            {groupedPenalties.length} موظف
          </div>
        </div>

        {groupedPenalties.length === 0 ? <EmptyState message="لا توجد سجلات جزاءات — اضغط تحديث من Zoho لحسابها" /> : (
          <div className="space-y-3">
            {groupedPenalties.map((emp) => {
              const isExpanded = expandedEmployee === emp.employeeName;
              const activePenalties = emp.penalties.filter(p => p.status !== "معفى");
              const exemptedPenalties = emp.penalties.filter(p => p.status === "معفى");
              const mostSevere = activePenalties.length > 0 ? activePenalties.reduce((max, p) => p.deductionDays > max.deductionDays ? p : max, activePenalties[0]) : null;
              const severity = mostSevere ? getPenaltySeverity(mostSevere.actionTaken) : { label: "معفى", color: "#10B981", bg: "rgba(16,185,129,0.15)" };

              return (
                <div
                  key={emp.employeeName}
                  className="card-brand rounded-xl overflow-hidden transition-all"
                  style={{ borderColor: isExpanded ? "hsl(165 69% 39% / 0.40)" : undefined }}
                >
                  {/* Employee Summary Row */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setExpandedEmployee(isExpanded ? null : emp.employeeName)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: severity.bg, color: severity.color }}>
                        {emp.employeeName.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-sm" style={{ color: "hsl(0 0% 92%)" }}>{emp.employeeName}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {activePenalties.length > 0 && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}>
                              {activePenalties.length} مخالفة
                            </span>
                          )}
                          {exemptedPenalties.length > 0 && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.12)", color: "#10B981" }}>
                              {exemptedPenalties.length} معفى
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {mostSevere && mostSevere.status !== "معفى" && (
                        <div className="text-left hidden sm:block">
                          <div className="text-[10px] mb-0.5" style={{ color: "hsl(0 0% 52%)" }}>العقوبة المستحقة</div>
                          <span className="text-[11px] font-bold px-2 py-1 rounded-lg" style={{ background: severity.bg, color: severity.color }}>
                            {mostSevere.actionTaken}
                          </span>
                        </div>
                      )}
                      {emp.totalDeductionDays > 0 && (
                        <div className="text-center">
                          <div className="text-lg font-black" style={{ color: "#EF4444" }}>{emp.totalDeductionDays}</div>
                          <div className="text-[10px]" style={{ color: "hsl(0 0% 52%)" }}>يوم خصم</div>
                        </div>
                      )}
                      <ChevronDown size={16} className="transition-transform" style={{ color: "hsl(0 0% 52%)", transform: isExpanded ? "rotate(180deg)" : "none" }} />
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t px-4 pb-4 pt-3 animate-fade-in" style={{ borderColor: "hsl(0 0% 25%)" }}>
                      <div className="flex flex-col gap-2 mb-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEmployeeClick(emp.employeeName); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                            style={{ background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C", border: "1px solid hsl(165 69% 39% / 0.20)" }}
                          >
                            <Eye size={13} />
                            <span>عرض سجل الحضور</span>
                          </button>
                          {activePenalties.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const penaltyToExport = mostSevere || activePenalties[0];
                                const warningData: WarningLetterData = {
                                  employeeName: emp.employeeName,
                                  violationType: penaltyToExport.violationType || "",
                                  violationCount: penaltyToExport.violationDates?.length || 1,
                                  violationDates: penaltyToExport.violationDates || [penaltyToExport.violationDate || ""],
                                  penalty: penaltyToExport.actionTaken || "إنذار كتابي",
                                };
                                setPreviewWarningData(warningData);
                                setShowWarningPreview(true);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                              style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}
                            >
                              <FileWarning size={13} />
                              <span>إصدار إنذار</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Penalty Details */}
                      <div className="space-y-2">
                        {emp.penalties.map((p) => {
                          const vColor = getViolationColor(p.violationType);
                          const isDone = p.status === "منفذ";
                          const isExempt = p.status === "معفى";
                          return (
                            <div key={p.id} className="rounded-lg p-3 flex items-center justify-between gap-3" style={{ background: "hsl(0 0% 16%)", opacity: isExempt ? 0.6 : 1 }}>
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: vColor.bg, color: vColor.text, border: `1px solid ${vColor.border}` }}>
                                  {p.violationType}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold truncate" style={{ color: "hsl(0 0% 82%)" }}>{p.actionTaken}</div>
                                  {p.violationDates?.length > 0 && (
                                    <div className="text-[10px] mt-0.5" style={{ color: "hsl(0 0% 52%)" }}>
                                      {p.violationDates.length} أيام مخالفة
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isExempt && <span className="badge-teal text-[10px]">معفى</span>}
                                {isDone && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.12)", color: "#10B981" }}>منفذ</span>}
                                {!isExempt && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleMarkDone(p.id, isDone); }}
                                      disabled={markingDoneId === p.id}
                                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                                      title={isDone ? "إلغاء التنفيذ" : "تعليم كمنفذ"}
                                    >
                                      <CheckCircle2 size={14} style={{ color: isDone ? "#10B981" : "hsl(0 0% 52%)" }} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setExemptModalPenalty(p); setExemptType("full"); setExemptReason(""); setSelectedExemptDates([]); }}
                                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                                      title="إعفاء"
                                    >
                                      <ShieldOff size={14} style={{ color: "#F59E0B" }} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Exemption Modal */}
        <Dialog open={!!exemptModalPenalty} onOpenChange={(open) => { if (!open) setExemptModalPenalty(null); }}>
          <DialogContent className="max-w-md" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 28%)" }}>
            <DialogHeader>
              <DialogTitle className="text-right" style={{ color: "#1FA98C", fontFamily: "Alexandria" }}>إعفاء من الجزاء</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="flex gap-2">
                <button onClick={() => setExemptType("full")} className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all" style={{ background: exemptType === "full" ? "#1FA98C" : "hsl(0 0% 21%)", color: exemptType === "full" ? "#fff" : "hsl(0 0% 72%)" }}>إعفاء كامل</button>
                <button onClick={() => setExemptType("partial")} className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all" style={{ background: exemptType === "partial" ? "#1FA98C" : "hsl(0 0% 21%)", color: exemptType === "partial" ? "#fff" : "hsl(0 0% 72%)" }}>إعفاء جزئي</button>
              </div>
              {exemptType === "partial" && exemptModalPenalty?.violationDates?.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold" style={{ color: "hsl(0 0% 62%)" }}>اختر الأيام المعفاة:</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {exemptModalPenalty.violationDates.map((d: string) => (
                      <label key={d} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs cursor-pointer" style={{ background: selectedExemptDates.includes(d) ? "hsl(165 69% 39% / 0.15)" : "hsl(0 0% 21%)", color: selectedExemptDates.includes(d) ? "#1FA98C" : "hsl(0 0% 72%)" }}>
                        <input type="checkbox" checked={selectedExemptDates.includes(d)} onChange={() => setSelectedExemptDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])} className="w-3 h-3 rounded accent-emerald-500" />
                        {d}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "hsl(0 0% 65%)" }}>سبب الإعفاء</label>
                <textarea
                  value={exemptReason}
                  onChange={(e) => setExemptReason(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
                  style={{ background: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}
                  placeholder="مثال: بقرار إداري..."
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleExempt} disabled={exemptingId !== null} className="btn-brand flex-1 justify-center">
                  {exemptingId ? <RefreshCw size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                  <span>{exemptingId ? "جاري الإعفاء..." : "تأكيد الإعفاء"}</span>
                </button>
                <button onClick={() => setExemptModalPenalty(null)} className="flex-1 py-2.5 rounded-lg font-medium text-sm border" style={{ borderColor: "hsl(0 0% 33%)", color: "hsl(0 0% 72%)" }}>إلغاء</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Employee Late Days Modal */}
        <Dialog open={!!selectedPenaltyEmployee} onOpenChange={(open) => { if (!open) setSelectedPenaltyEmployee(null); }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 28%)" }}>
            <DialogHeader>
              <DialogTitle className="text-right" style={{ color: "#1FA98C", fontFamily: "Alexandria" }}>
                سجل المخالفات — {selectedPenaltyEmployee}
              </DialogTitle>
            </DialogHeader>
            {loadingLateDays ? (
              <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin" style={{ color: "#1FA98C" }} /></div>
            ) : employeeLateDays.length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: "hsl(0 0% 55%)" }}>لا توجد مخالفات مسجلة</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border mt-2" style={{ borderColor: "hsl(0 0% 25%)" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الدخول</th>
                      <th>الخروج</th>
                      <th>الحالة</th>
                      <th>دقائق التأخير</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeLateDays.map((d) => (
                      <tr key={d.id}>
                        <td style={{ fontSize: "13px" }}>{d.record_date ? new Date(d.record_date).toLocaleDateString("en-CA") : "—"}</td>
                        <td style={{ fontSize: "13px" }}>{d.check_in || "—"}</td>
                        <td style={{ fontSize: "13px" }}>{d.check_out || "—"}</td>
                        <td><StatusBadge status={d.status || "—"} /></td>
                        <td style={{ color: d.late_minutes > 0 ? "#EF4444" : "hsl(0 0% 52%)", fontWeight: 700, fontSize: "13px" }}>
                          {d.late_minutes > 0 ? `${d.late_minutes} دقيقة` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  // ─── Execution Guide Tab ───────────────────────────────────────────────────
  const renderGuide = () => {
    return (
      <div className="space-y-3 animate-fade-in">
        {executionGuide.map((item, i) => (
          <div key={i} className="card-brand rounded-xl overflow-hidden animate-fade-in-up" style={{ animationDelay: `${i * 50}ms`, opacity: 0 }}>
            <div className="px-5 py-3 flex items-center gap-3" style={{ background: "hsl(165 69% 39% / 0.06)", borderBottom: "1px solid hsl(0 0% 25%)" }}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: "#1FA98C", color: "#fff" }}>{i + 1}</div>
              <span className="font-bold text-sm" style={{ color: "#1FA98C" }}>{item.task}</span>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "hsl(0 0% 52%)" }}>طريقة التنفيذ</span>
                <p className="text-sm mt-1" style={{ color: "hsl(0 0% 82%)" }}>{item.method}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                  <span className="text-[10px] font-bold" style={{ color: "hsl(0 0% 52%)" }}>المصادر</span>
                  <p className="text-xs mt-0.5" style={{ color: "hsl(0 0% 72%)" }}>{item.sources}</p>
                </div>
                <div className="p-2.5 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
                  <span className="text-[10px] font-bold" style={{ color: "hsl(0 0% 52%)" }}>الناتج</span>
                  <p className="text-xs mt-0.5" style={{ color: "hsl(0 0% 72%)" }}>{item.output}</p>
                </div>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: "#F59E0B" }} />
                <p className="text-xs" style={{ color: "#F59E0B" }}>{item.alert}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ─── Checklist Tab ─────────────────────────────────────────────────────────
  const renderChecklist = () => {
    const allChecked = Object.values(checkedItems).filter(Boolean).length === checklistItems.length;
    const checkedCount = Object.values(checkedItems).filter(Boolean).length;
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="card-brand rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="section-title mb-0">
              <ListChecks size={16} style={{ color: "#1FA98C" }} />
              <span>قائمة التحقق قبل اجتماع الأحد</span>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: allChecked ? "rgba(16,185,129,0.15)" : "hsl(0 0% 21%)", color: allChecked ? "#10B981" : "hsl(0 0% 62%)" }}>
              {checkedCount}/{checklistItems.length}
            </span>
          </div>
          <p className="text-sm mb-4" style={{ color: "hsl(0 0% 52%)" }}>راجع القائمة التالية. إذا كانت الإجابات واضحة ومكتوبة، تكون جاهزاً للاجتماع.</p>
          
          {/* Progress */}
          <div className="progress-brand mb-4">
            <div className="progress-brand-fill" style={{ width: `${(checkedCount / checklistItems.length) * 100}%` }} />
          </div>

          <div className="space-y-2">
            {checklistItems.map((item, i) => (
              <label key={i} className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-white/[0.02]" style={{ background: checkedItems[i] ? "hsl(165 69% 39% / 0.04)" : "transparent", border: `1px solid ${checkedItems[i] ? "hsl(165 69% 39% / 0.20)" : "transparent"}` }}>
                <input
                  type="checkbox"
                  checked={!!checkedItems[i]}
                  onChange={() => setCheckedItems(prev => ({ ...prev, [i]: !prev[i] }))}
                  className="mt-1 w-4 h-4 rounded accent-emerald-500"
                />
                <div>
                  <span className="font-bold text-sm" style={{ color: "#1FA98C" }}>{item.area}: </span>
                  <span className="text-sm" style={{ color: "hsl(0 0% 82%)" }}>{item.question}</span>
                </div>
              </label>
            ))}
          </div>
          {allChecked && (
            <div className="mt-4 p-3 rounded-lg flex items-center gap-2 animate-fade-in" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
              <CheckCircle2 size={18} style={{ color: "#10B981" }} />
              <span className="text-sm font-bold" style={{ color: "#10B981" }}>جاهز للاجتماع الأسبوعي!</span>
            </div>
          )}
        </div>

        <div className="card-brand rounded-xl p-5">
          <div className="section-title">
            <BookOpen size={16} style={{ color: "#1FA98C" }} />
            <span>نموذج الكلام داخل الاجتماع</span>
          </div>
          <div className="p-4 rounded-lg" style={{ background: "hsl(0 0% 15%)", border: "1px solid hsl(0 0% 25%)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "hsl(0 0% 77%)" }}>
              "تم إنجاز <span className="font-bold" style={{ color: "#1FA98C" }}>[بنود الإنجاز الفعلية]</span>، والمخاطر الحالية هي <span className="font-bold" style={{ color: "#F59E0B" }}>[المخاطر المؤكدة من السجلات]</span>، والمطلوب من الإدارة هو <span className="font-bold" style={{ color: "#8B5CF6" }}>[القرار أو الدعم المطلوب]</span>."
            </p>
          </div>
        </div>
      </div>
    );
  };

  // ─── CRUD Handlers ─────────────────────────────────────────────────────────
  const handleEditTask = (task: Task) => {
    setEditItem(task);
    setShowAddModal(true);
  };

  const handleDeleteTask = async (id: number) => {
    if (!confirm("هل أنت متأكد من حذف هذه المهمة؟")) return;
    await fetch(`/api/tasks/items?id=${id}`, { method: "DELETE", credentials: "include" });
    setTasks(prev => prev.filter(t => t.id !== id));
    toast.success("تم حذف المهمة");
  };

  const handleSaveTask = async (data: any) => {
    if (editItem) {
      await fetch("/api/tasks/items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...data, id: editItem.id }),
      });
      toast.success("تم تحديث المهمة بنجاح");
    } else {
      await fetch("/api/tasks/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      toast.success("تم إضافة المهمة بنجاح");
    }
    setShowAddModal(false);
    setEditItem(null);
    const res = await fetch("/api/tasks/items", { credentials: "include" });
    if (res.ok) setTasks(await res.json());
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <PageTemplate
      title="مهامي"
      subtitle="دليل وخطة متابعة مهامي 3,6T"
      icon={ClipboardList}
      stats={dashboard ? [
        { label: "إجمالي المهام", value: String(dashboard.totalTasks), color: "#1FA98C", icon: ClipboardList },
        { label: "المتأخرة", value: String(dashboard.overdueTasks), color: "#EF4444", icon: AlertTriangle },
        { label: "عقود عاجلة", value: String(dashboard.urgentContracts), color: "#8B5CF6", icon: FileText },
        { label: "نسبة الإنجاز", value: `${dashboard.completionRate}%`, color: "#10B981", icon: CheckCircle2 },
      ] : undefined}
      actions={
        <button onClick={handleExportDashboardExcel} className="btn-brand text-xs">
          <Download size={14} />
          <span>تقرير شامل</span>
        </button>
      }
    >
      {/* Tabs */}
      <div className="card-brand rounded-xl p-1.5 flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSearchQuery(""); }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${isActive ? "shadow-md" : "hover:bg-white/5"}`}
              style={{
                background: isActive ? "hsl(var(--primary))" : "transparent",
                color: isActive ? "#fff" : "hsl(0 0% 62%)",
              }}
            >
              <tab.icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="card-brand rounded-xl p-5 min-h-[400px]">
        {/* Tab Header with Add Button */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="section-title mb-0">
            {(() => { const TabIcon = tabs.find(t => t.id === activeTab)?.icon || ClipboardList; return <TabIcon size={16} style={{ color: "#1FA98C" }} />; })()}
            <span>{tabs.find(t => t.id === activeTab)?.label}</span>
          </h2>
          {["tasks", "weekly", "attendance", "contracts", "penalties"].includes(activeTab) && (
            <button
              onClick={() => { setEditItem(null); setShowAddModal(true); }}
              className="btn-brand text-xs"
            >
              <Plus size={14} />
              <span>إضافة</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <RefreshCw size={24} className="animate-spin mb-3" style={{ color: "#1FA98C" }} />
            <span className="text-xs font-medium" style={{ color: "hsl(0 0% 52%)" }}>جاري التحميل...</span>
          </div>
        ) : (
          <>
            {activeTab === "dashboard" && renderDashboard()}
            {activeTab === "tasks" && renderTasks()}
            {activeTab === "weekly" && renderWeeklyPlan()}
            {activeTab === "attendance" && renderAttendance()}
            {activeTab === "contracts" && renderContracts()}
            {activeTab === "penalties" && renderPenalties()}
            {activeTab === "guide" && renderGuide()}
            {activeTab === "checklist" && renderChecklist()}
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <TaskFormModal
          activeTab={activeTab}
          editItem={editItem}
          onSave={handleSaveTask}
          onClose={() => { setShowAddModal(false); setEditItem(null); }}
        />
      )}

      {/* Warning Letter Preview Modal */}
      <Dialog open={showWarningPreview} onOpenChange={setShowWarningPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" style={{ background: 'hsl(0 0% 18%)', border: '1px solid hsl(0 0% 28%)' }}>
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="text-right" style={{ color: '#1FA98C', fontFamily: 'Alexandria' }}>
              معاينة نموذج الإنذار
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-lg" style={{ background: '#fff', minHeight: '400px' }}>
            {previewWarningData && (
              <div
                dangerouslySetInnerHTML={{ __html: getWarningLetterPreviewHTML(previewWarningData) }}
                style={{ padding: '20px', direction: 'rtl' }}
              />
            )}
          </div>
          <div className="flex-shrink-0 flex gap-3 justify-center pt-4 border-t" style={{ borderColor: 'hsl(0 0% 28%)' }}>
            <button
              onClick={() => {
                if (previewWarningData) {
                  downloadWarningLetterAsWord(previewWarningData).then(() => {
                    toast.success("تم تحميل ملف الإنذار بنجاح");
                  }).catch(() => {
                    toast.error("حدث خطأ في تصدير الإنذار");
                  });
                }
              }}
              className="btn-brand"
            >
              <Download size={16} />
              <span>تحميل كملف Word</span>
            </button>
            <button
              onClick={() => setShowWarningPreview(false)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'hsl(0 0% 72%)', border: '1px solid hsl(0 0% 33%)' }}
            >
              <X size={16} />
              <span>إغلاق</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </PageTemplate>
  );
}

// ─── Task Form Modal ─────────────────────────────────────────────────────────
function TaskFormModal({ activeTab, editItem, onSave, onClose }: {
  activeTab: string;
  editItem: any;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, any>>(editItem || {});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const renderFields = () => {
    if (activeTab === "tasks") {
      return (
        <>
          <FormField label="رقم المهمة" value={form.task_number || form.taskNumber} onChange={(v) => setForm({ ...form, taskNumber: parseInt(v) })} type="number" />
          <FormField label="اسم المهمة" value={form.task_name || form.taskName} onChange={(v) => setForm({ ...form, taskName: v })} required />
          <FormField label="التكرار" value={form.recurrence} onChange={(v) => setForm({ ...form, recurrence: v })} placeholder="أسبوعي، شهري..." />
          <FormField label="الوصف" value={form.description} onChange={(v) => setForm({ ...form, description: v })} textarea />
          <FormField label="تاريخ البداية" value={form.start_date || form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} type="date" />
          <FormField label="تاريخ الاستحقاق" value={form.due_date || form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} type="date" />
          <FormSelect label="الأهمية" value={form.importance} onChange={(v) => setForm({ ...form, importance: v })} options={["عالي", "متوسط", "منخفض"]} />
          <FormSelect label="الحالة" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["لم يبدأ", "قيد التنفيذ", "منجز", "متأخر"]} />
          <FormField label="مصدر البيانات" value={form.data_source || form.dataSource} onChange={(v) => setForm({ ...form, dataSource: v })} />
          <FormField label="الناتج المطلوب" value={form.expected_output || form.expectedOutput} onChange={(v) => setForm({ ...form, expectedOutput: v })} />
          <FormField label="ملاحظات" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} textarea />
        </>
      );
    }
    if (activeTab === "weekly") {
      return (
        <>
          <FormSelect label="اليوم" value={form.day_name || form.dayName} onChange={(v) => setForm({ ...form, dayName: v })} options={["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]} />
          <FormField label="من" value={form.time_from || form.timeFrom} onChange={(v) => setForm({ ...form, timeFrom: v })} placeholder="08:00" />
          <FormField label="إلى" value={form.time_to || form.timeTo} onChange={(v) => setForm({ ...form, timeTo: v })} placeholder="09:00" />
          <FormField label="المهمة" value={form.task_name || form.taskName} onChange={(v) => setForm({ ...form, taskName: v })} required />
          <FormSelect label="الأهمية" value={form.importance} onChange={(v) => setForm({ ...form, importance: v })} options={["عالي", "متوسط", "منخفض"]} />
          <FormField label="طريقة التنفيذ" value={form.execution_method || form.executionMethod} onChange={(v) => setForm({ ...form, executionMethod: v })} textarea />
          <FormField label="ملاحظات" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} textarea />
        </>
      );
    }
    if (activeTab === "attendance") {
      return (
        <>
          <FormField label="رقم الموظف" value={form.employee_id || form.employeeId} onChange={(v) => setForm({ ...form, employeeId: v })} required />
          <FormField label="اسم الموظف" value={form.employee_name || form.employeeName} onChange={(v) => setForm({ ...form, employeeName: v })} required />
          <FormField label="التاريخ" value={form.record_date || form.recordDate} onChange={(v) => setForm({ ...form, recordDate: v })} type="date" required />
          <FormField label="وقت الدخول" value={form.check_in || form.checkIn} onChange={(v) => setForm({ ...form, checkIn: v })} placeholder="08:00" />
          <FormField label="وقت الخروج" value={form.check_out || form.checkOut} onChange={(v) => setForm({ ...form, checkOut: v })} placeholder="17:00" />
          <FormSelect label="الحالة" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["حاضر", "غياب", "إجازة"]} />
          <FormField label="دقائق التأخير" value={form.late_minutes || form.lateMinutes} onChange={(v) => setForm({ ...form, lateMinutes: parseInt(v) || 0 })} type="number" />
          <FormSelect label="حالة المخالفة" value={form.violation_status || form.violationStatus} onChange={(v) => setForm({ ...form, violationStatus: v })} options={["سليم", "مخالفة", "تحت المراجعة"]} />
          <FormField label="ملاحظة" value={form.note} onChange={(v) => setForm({ ...form, note: v })} textarea />
        </>
      );
    }
    if (activeTab === "contracts") {
      return (
        <>
          <FormField label="رقم الموظف" value={form.employee_id || form.employeeId} onChange={(v) => setForm({ ...form, employeeId: v })} required />
          <FormField label="اسم الموظف" value={form.employee_name || form.employeeName} onChange={(v) => setForm({ ...form, employeeName: v })} required />
          <FormField label="نوع العقد" value={form.contract_type || form.contractType} onChange={(v) => setForm({ ...form, contractType: v })} />
          <FormField label="تاريخ الانتهاء" value={form.end_date || form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} type="date" />
          <FormField label="الإجراء المقترح" value={form.suggested_action || form.suggestedAction} onChange={(v) => setForm({ ...form, suggestedAction: v })} />
          <FormField label="الأيام المتبقية" value={form.days_remaining || form.daysRemaining} onChange={(v) => setForm({ ...form, daysRemaining: parseInt(v) || 0 })} type="number" />
          <FormSelect label="حالة العقد" value={form.contract_status || form.contractStatus} onChange={(v) => setForm({ ...form, contractStatus: v })} options={["ساري", "ينتهي خلال 30 يوم", "عاجل جداً", "منتهي"]} />
          <FormField label="ملاحظات" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} textarea />
        </>
      );
    }
    if (activeTab === "penalties") {
      return (
        <>
          <FormField label="رقم الجزاء" value={form.penalty_number || form.penaltyNumber} onChange={(v) => setForm({ ...form, penaltyNumber: parseInt(v) })} type="number" />
          <FormField label="اسم الموظف" value={form.employee_name || form.employeeName} onChange={(v) => setForm({ ...form, employeeName: v })} required />
          <FormField label="تاريخ المخالفة" value={form.violation_date || form.violationDate} onChange={(v) => setForm({ ...form, violationDate: v })} type="date" />
          <FormField label="نوع المخالفة" value={form.violation_type || form.violationType} onChange={(v) => setForm({ ...form, violationType: v })} />
          <FormField label="الإجراء المتخذ" value={form.action_taken || form.actionTaken} onChange={(v) => setForm({ ...form, actionTaken: v })} />
          <FormField label="تاريخ الاستحقاق" value={form.due_date || form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} type="date" />
          <FormSelect label="الحالة" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["لم يبدأ", "قيد التنفيذ", "منجز", "متأخر"]} />
          <FormSelect label="حالة المتابعة" value={form.follow_up_status || form.followUpStatus} onChange={(v) => setForm({ ...form, followUpStatus: v })} options={["بانتظار الإفادة", "تم التنفيذ", "مرفوع للإدارة", "مغلق"]} />
          <FormField label="ملاحظات" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} textarea />
        </>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto card-brand rounded-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold" style={{ color: "hsl(0 0% 92%)" }}>
            {editItem ? "تعديل" : "إضافة جديد"}
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition-colors"><X size={18} style={{ color: "hsl(0 0% 62%)" }} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {renderFields()}
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-brand flex-1 justify-center py-2.5">
              {editItem ? "تحديث" : "حفظ"}
            </button>
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg font-medium text-sm border transition-colors hover:bg-white/5" style={{ borderColor: "hsl(0 0% 33%)", color: "hsl(0 0% 72%)" }}>
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Form Components ─────────────────────────────────────────────────────────
function FormField({ label, value, onChange, type = "text", placeholder, required, textarea }: {
  label: string; value: any; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; textarea?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-1.5" style={{ color: "hsl(0 0% 65%)" }}>{label}</label>
      {textarea ? (
        <textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={3}
          className="w-full px-3 py-2.5 rounded-lg border text-sm resize-none transition-colors focus:border-[#1FA98C] focus:outline-none"
          style={{ background: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}
        />
      ) : (
        <input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full px-3 py-2.5 rounded-lg border text-sm transition-colors focus:border-[#1FA98C] focus:outline-none"
          style={{ background: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}
        />
      )}
    </div>
  );
}

function FormSelect({ label, value, onChange, options }: {
  label: string; value: any; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-1.5" style={{ color: "hsl(0 0% 65%)" }}>{label}</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border text-sm transition-colors focus:border-[#1FA98C] focus:outline-none"
        style={{ background: "hsl(0 0% 15%)", borderColor: "hsl(0 0% 28%)", color: "hsl(0 0% 88%)" }}
      >
        <option value="">اختر...</option>
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}
