import { useState, useEffect, useRef } from "react";
import {
  FileText, Download, Printer, BarChart3, Clock, AlertTriangle,
  CheckCircle2, Users, Calendar, Shield, TrendingUp, RefreshCw
} from "lucide-react";
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

// ─── Report Types ────────────────────────────────────────────────────────────
const reportTypes = [
  { id: "tasks-summary", label: "تقرير ملخص المهام", icon: BarChart3, description: "ملخص شامل لجميع المهام وحالاتها ونسب الإنجاز" },
  { id: "attendance-weekly", label: "تقرير الحضور الأسبوعي", icon: Clock, description: "تقرير مخالفات الحضور والتأخير والغياب" },
  { id: "contracts-status", label: "تقرير حالة العقود", icon: FileText, description: "العقود المنتهية والقريبة من الانتهاء والإجراءات المطلوبة" },
  { id: "penalties-log", label: "تقرير سجل الجزاءات", icon: AlertTriangle, description: "المخالفات والإجراءات المتخذة وحالة المتابعة" },
  { id: "compliance-check", label: "تقرير الامتثال", icon: Shield, description: "حالة الامتثال في نطاقات وقوى ومدد" },
  { id: "executive-summary", label: "التقرير التنفيذي", icon: TrendingUp, description: "ملخص تنفيذي شامل لجميع المحاور" },
];

// ─── Main Component ──────────────────────────────────────────────────────────
export default function TaskReports() {
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [penalties, setPenalties] = useState<PenaltyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [missingData, setMissingData] = useState<string[]>([]);
  const reportRef = useRef<HTMLDivElement>(null);

  // Load all data
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [tasksRes, attRes, contRes, penRes] = await Promise.all([
          fetch("/api/tasks/items", { credentials: "include" }),
          fetch("/api/tasks/attendance", { credentials: "include" }),
          fetch("/api/tasks/contracts", { credentials: "include" }),
          fetch("/api/tasks/penalties", { credentials: "include" }),
        ]);
        if (tasksRes.ok) setTasks(await tasksRes.json());
        if (attRes.ok) setAttendance(await attRes.json());
        if (contRes.ok) setContracts(await contRes.json());
        if (penRes.ok) setPenalties(await penRes.json());
        setDataLoaded(true);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Check for missing data
  useEffect(() => {
    if (!dataLoaded) return;
    const missing: string[] = [];
    if (tasks.length === 0) missing.push("المهام التفصيلية (لم يتم إدخال أي مهمة بعد)");
    if (attendance.length === 0) missing.push("سجل الحضور الأسبوعي (لا توجد بيانات حضور مسجلة)");
    if (contracts.length === 0) missing.push("سجل العقود (لا توجد بيانات عقود مسجلة)");
    if (penalties.length === 0) missing.push("سجل الجزاءات (لا توجد بيانات جزاءات مسجلة)");
    // Check for incomplete task data
    tasks.forEach(t => {
      if (!t.due_date) missing.push(`المهمة #${t.task_number} "${t.task_name}" - تاريخ الاستحقاق مفقود`);
      if (!t.expected_output) missing.push(`المهمة #${t.task_number} "${t.task_name}" - الناتج المطلوب مفقود`);
    });
    setMissingData([...new Set(missing)]);
  }, [dataLoaded, tasks, attendance, contracts, penalties]);

  // Print report
  const handlePrint = () => {
    if (reportRef.current) {
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(`
          <html dir="rtl" lang="ar">
          <head>
            <title>تقرير - People 3.6T</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: Arial, Tahoma, sans-serif; direction: rtl; padding: 40px; color: #1a2332; }
              .report-header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #1FA98C; }
              .report-header h1 { color: #1FA98C; font-size: 24px; font-weight: 900; }
              .report-header p { color: #64748b; font-size: 12px; margin-top: 5px; }
              .brand-badge { display: inline-block; background: #1FA98C; color: white; padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-top: 8px; }
              table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12px; }
              th { background: #1FA98C; color: white; padding: 10px 8px; text-align: right; font-weight: 700; }
              td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
              tr:nth-child(even) { background: #f8fafc; }
              .section-title { color: #1FA98C; font-size: 16px; font-weight: 700; margin: 25px 0 10px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
              .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 15px 0; }
              .kpi-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; text-align: center; }
              .kpi-value { font-size: 24px; font-weight: 900; color: #1FA98C; }
              .kpi-label { font-size: 11px; color: #64748b; margin-top: 4px; }
              .alert-box { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 12px; margin: 15px 0; }
              .alert-box h4 { color: #92400e; font-size: 13px; margin-bottom: 5px; }
              .alert-box p { color: #78350f; font-size: 11px; }
              .footer { text-align: center; margin-top: 40px; padding-top: 15px; border-top: 2px solid #e2e8f0; color: #94a3b8; font-size: 10px; }
              @media print { body { padding: 20px; } }
            </style>
          </head>
          <body>${reportRef.current.innerHTML}
            <div class="footer">
              <p>People 3.6T | تقرير مُنشأ آلياً | ${new Date().toLocaleDateString("en-CA")} | سري - للاستخدام الداخلي فقط</p>
            </div>
          </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  };

  // ─── Report Renderers ──────────────────────────────────────────────────────
  const renderTasksSummary = () => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === "منجز").length;
    const inProgress = tasks.filter(t => t.status === "قيد التنفيذ").length;
    const overdue = tasks.filter(t => t.status === "متأخر").length;
    const notStarted = tasks.filter(t => t.status === "لم يبدأ").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
      <div>
        <div className="report-header" style={{ textAlign: "center", marginBottom: 30, paddingBottom: 20, borderBottom: "3px solid #1FA98C" }}>
          <h1 style={{ color: "#1FA98C", fontSize: 24, fontWeight: 900 }}>تقرير ملخص المهام</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}>الفترة: {new Date().toLocaleDateString("en-CA")} | إعداد: إدارة رأس المال البشري</p>
          <span style={{ display: "inline-block", background: "#1FA98C", color: "white", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginTop: 8 }}>People 3.6T</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, margin: "15px 0" }}>
          <KPICard value={total} label="إجمالي المهام" />
          <KPICard value={completed} label="مهام منجزة" />
          <KPICard value={inProgress} label="قيد التنفيذ" />
          <KPICard value={overdue} label="متأخرة" alert={overdue > 0} />
        </div>

        <div style={{ textAlign: "center", margin: "15px 0", padding: 12, background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#1FA98C" }}>{completionRate}%</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>نسبة الإنجاز الكلية</div>
        </div>

        {overdue > 0 && (
          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12, margin: "15px 0" }}>
            <h4 style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>⚠️ تنبيه: مهام متأخرة</h4>
            <p style={{ color: "#78350f", fontSize: 11 }}>يوجد {overdue} مهمة متأخرة تحتاج إلى متابعة فورية</p>
          </div>
        )}

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>تفاصيل المهام</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>المهمة</th>
              <th style={thStyle}>التكرار</th>
              <th style={thStyle}>الاستحقاق</th>
              <th style={thStyle}>الأهمية</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>الناتج المطلوب</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr key={t.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={tdStyle}>{t.task_number}</td>
                <td style={tdStyle}>{t.task_name}</td>
                <td style={tdStyle}>{t.recurrence}</td>
                <td style={tdStyle}>{t.due_date ? new Date(t.due_date).toLocaleDateString("en-CA") : "—"}</td>
                <td style={tdStyle}>{t.importance}</td>
                <td style={tdStyle}>{t.status}</td>
                <td style={{ ...tdStyle, maxWidth: 150 }}>{t.expected_output || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderAttendanceReport = () => {
    const totalRecords = attendance.length;
    const violations = attendance.filter(a => a.violation_status === "مخالفة").length;
    const lateEntries = attendance.filter(a => a.late_minutes > 0);
    const totalLateMinutes = lateEntries.reduce((sum, a) => sum + a.late_minutes, 0);
    const absentCount = attendance.filter(a => a.status === "غياب").length;

    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 30, paddingBottom: 20, borderBottom: "3px solid #1FA98C" }}>
          <h1 style={{ color: "#1FA98C", fontSize: 24, fontWeight: 900 }}>تقرير الحضور الأسبوعي</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}>الفترة: {new Date().toLocaleDateString("en-CA")} | إعداد: إدارة رأس المال البشري</p>
          <span style={{ display: "inline-block", background: "#1FA98C", color: "white", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginTop: 8 }}>People 3.6T</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, margin: "15px 0" }}>
          <KPICard value={totalRecords} label="إجمالي السجلات" />
          <KPICard value={violations} label="مخالفات" alert={violations > 0} />
          <KPICard value={absentCount} label="غياب" alert={absentCount > 0} />
          <KPICard value={totalLateMinutes} label="دقائق تأخير" />
        </div>

        {violations > 0 && (
          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12, margin: "15px 0" }}>
            <h4 style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>⚠️ تنبيه: مخالفات حضور</h4>
            <p style={{ color: "#78350f", fontSize: 11 }}>يوجد {violations} مخالفة حضور تحتاج إلى متابعة وتوثيق الإجراء النظامي</p>
          </div>
        )}

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>سجل الحضور التفصيلي</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>الموظف</th>
              <th style={thStyle}>التاريخ</th>
              <th style={thStyle}>الدخول</th>
              <th style={thStyle}>الخروج</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>التأخير (دقيقة)</th>
              <th style={thStyle}>المخالفة</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((a, i) => (
              <tr key={a.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={tdStyle}>{a.employee_name}</td>
                <td style={tdStyle}>{a.record_date ? new Date(a.record_date).toLocaleDateString("en-CA") : "—"}</td>
                <td style={tdStyle}>{a.check_in || "—"}</td>
                <td style={tdStyle}>{a.check_out || "—"}</td>
                <td style={tdStyle}>{a.status}</td>
                <td style={{ ...tdStyle, color: a.late_minutes > 0 ? "#dc2626" : "#1a2332" }}>{a.late_minutes || 0}</td>
                <td style={{ ...tdStyle, color: a.violation_status === "مخالفة" ? "#dc2626" : "#1a2332" }}>{a.violation_status || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderContractsReport = () => {
    const total = contracts.length;
    const urgent = contracts.filter(c => c.days_remaining <= 30).length;
    const expired = contracts.filter(c => c.days_remaining <= 0).length;

    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 30, paddingBottom: 20, borderBottom: "3px solid #1FA98C" }}>
          <h1 style={{ color: "#1FA98C", fontSize: 24, fontWeight: 900 }}>تقرير حالة العقود</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}>الفترة: {new Date().toLocaleDateString("en-CA")} | إعداد: إدارة رأس المال البشري</p>
          <span style={{ display: "inline-block", background: "#1FA98C", color: "white", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginTop: 8 }}>People 3.6T</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "15px 0" }}>
          <KPICard value={total} label="إجمالي العقود" />
          <KPICard value={urgent} label="عاجلة (≤30 يوم)" alert={urgent > 0} />
          <KPICard value={expired} label="منتهية" alert={expired > 0} />
        </div>

        {urgent > 0 && (
          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12, margin: "15px 0" }}>
            <h4 style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>⚠️ تنبيه: عقود عاجلة</h4>
            <p style={{ color: "#78350f", fontSize: 11 }}>يوجد {urgent} عقد ينتهي خلال 30 يوماً أو أقل. يجب اتخاذ قرار التجديد أو الإنهاء.</p>
          </div>
        )}

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>تفاصيل العقود</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>الموظف</th>
              <th style={thStyle}>نوع العقد</th>
              <th style={thStyle}>تاريخ الانتهاء</th>
              <th style={thStyle}>الأيام المتبقية</th>
              <th style={thStyle}>الإجراء المقترح</th>
              <th style={thStyle}>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c, i) => (
              <tr key={c.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={tdStyle}>{c.employee_name}</td>
                <td style={tdStyle}>{c.contract_type || "—"}</td>
                <td style={tdStyle}>{c.end_date ? new Date(c.end_date).toLocaleDateString("en-CA") : "—"}</td>
                <td style={{ ...tdStyle, color: c.days_remaining <= 30 ? "#dc2626" : "#1a2332", fontWeight: c.days_remaining <= 30 ? 700 : 400 }}>{c.days_remaining ?? "—"}</td>
                <td style={tdStyle}>{c.suggested_action || "—"}</td>
                <td style={tdStyle}>{c.contract_status || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderPenaltiesReport = () => {
    const total = penalties.length;
    const open = penalties.filter(p => p.status !== "منجز").length;
    const overdue = penalties.filter(p => p.status === "متأخر").length;

    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 30, paddingBottom: 20, borderBottom: "3px solid #1FA98C" }}>
          <h1 style={{ color: "#1FA98C", fontSize: 24, fontWeight: 900 }}>تقرير سجل الجزاءات</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}>الفترة: {new Date().toLocaleDateString("en-CA")} | إعداد: إدارة رأس المال البشري</p>
          <span style={{ display: "inline-block", background: "#1FA98C", color: "white", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginTop: 8 }}>People 3.6T</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "15px 0" }}>
          <KPICard value={total} label="إجمالي الجزاءات" />
          <KPICard value={open} label="مفتوحة" alert={open > 0} />
          <KPICard value={overdue} label="متأخرة" alert={overdue > 0} />
        </div>

        {overdue > 0 && (
          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12, margin: "15px 0" }}>
            <h4 style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>⚠️ تنبيه: جزاءات متأخرة</h4>
            <p style={{ color: "#78350f", fontSize: 11 }}>يوجد {overdue} جزاء متأخر عن موعد التنفيذ. يجب المتابعة الفورية.</p>
          </div>
        )}

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>تفاصيل الجزاءات</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>الموظف</th>
              <th style={thStyle}>تاريخ المخالفة</th>
              <th style={thStyle}>نوع المخالفة</th>
              <th style={thStyle}>الإجراء</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>المتابعة</th>
            </tr>
          </thead>
          <tbody>
            {penalties.map((p, i) => (
              <tr key={p.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={tdStyle}>{p.penalty_number}</td>
                <td style={tdStyle}>{p.employee_name}</td>
                <td style={tdStyle}>{p.violation_date ? new Date(p.violation_date).toLocaleDateString("en-CA") : "—"}</td>
                <td style={tdStyle}>{p.violation_type || "—"}</td>
                <td style={tdStyle}>{p.action_taken || "—"}</td>
                <td style={tdStyle}>{p.status}</td>
                <td style={tdStyle}>{p.follow_up_status || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderComplianceReport = () => {
    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 30, paddingBottom: 20, borderBottom: "3px solid #1FA98C" }}>
          <h1 style={{ color: "#1FA98C", fontSize: 24, fontWeight: 900 }}>تقرير الامتثال</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}>الفترة: {new Date().toLocaleDateString("en-CA")} | إعداد: إدارة رأس المال البشري</p>
          <span style={{ display: "inline-block", background: "#1FA98C", color: "white", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginTop: 8 }}>People 3.6T</span>
        </div>

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>حالة المنصات الحكومية</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>المنصة</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>آخر مراجعة</th>
              <th style={thStyle}>الإجراء المطلوب</th>
              <th style={thStyle}>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: "#fff" }}>
              <td style={tdStyle}>نطاقات</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={{ ...tdStyle, color: "#dc2626" }}>⚠️ لا توجد بيانات - يرجى إدخال حالة نطاقات</td>
            </tr>
            <tr style={{ background: "#f8fafc" }}>
              <td style={tdStyle}>قوى</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={{ ...tdStyle, color: "#dc2626" }}>⚠️ لا توجد بيانات - يرجى إدخال حالة قوى</td>
            </tr>
            <tr style={{ background: "#fff" }}>
              <td style={tdStyle}>مدد</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={{ ...tdStyle, color: "#dc2626" }}>⚠️ لا توجد بيانات - يرجى إدخال حالة مدد</td>
            </tr>
          </tbody>
        </table>

        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12, margin: "15px 0" }}>
          <h4 style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>⚠️ تنبيه: بيانات مفقودة</h4>
          <p style={{ color: "#78350f", fontSize: 11 }}>لا توجد بيانات امتثال مسجلة. يرجى إدخال حالة كل منصة (نطاقات، قوى، مدد) من خلال قسم المهام.</p>
        </div>
      </div>
    );
  };

  const renderExecutiveSummary = () => {
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === "منجز").length;
    const overdueTasks = tasks.filter(t => t.status === "متأخر").length;
    const urgentContracts = contracts.filter(c => c.days_remaining <= 30).length;
    const openPenalties = penalties.filter(p => p.status !== "منجز").length;
    const attendanceViolations = attendance.filter(a => a.violation_status === "مخالفة").length;

    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 30, paddingBottom: 20, borderBottom: "3px solid #1FA98C" }}>
          <h1 style={{ color: "#1FA98C", fontSize: 24, fontWeight: 900 }}>التقرير التنفيذي الشامل</h1>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}>الفترة: {new Date().toLocaleDateString("en-CA")} | إعداد: إدارة رأس المال البشري | People 3.6T</p>
          <span style={{ display: "inline-block", background: "#1FA98C", color: "white", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginTop: 8 }}>People 3.6T</span>
        </div>

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>ملخص المؤشرات الرئيسية</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "15px 0" }}>
          <KPICard value={totalTasks} label="إجمالي المهام" />
          <KPICard value={completedTasks} label="مهام منجزة" />
          <KPICard value={overdueTasks} label="مهام متأخرة" alert={overdueTasks > 0} />
          <KPICard value={urgentContracts} label="عقود عاجلة" alert={urgentContracts > 0} />
          <KPICard value={openPenalties} label="جزاءات مفتوحة" alert={openPenalties > 0} />
          <KPICard value={attendanceViolations} label="مخالفات حضور" alert={attendanceViolations > 0} />
        </div>

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>المخاطر والتنبيهات</h3>
        {overdueTasks === 0 && urgentContracts === 0 && openPenalties === 0 && attendanceViolations === 0 ? (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 12 }}>
            <p style={{ color: "#166534", fontSize: 12 }}>✅ لا توجد مخاطر حالية. جميع المحاور ضمن المعدل الطبيعي.</p>
          </div>
        ) : (
          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12 }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12, color: "#78350f" }}>
              {overdueTasks > 0 && <li style={{ marginBottom: 4 }}>⚠️ {overdueTasks} مهمة متأخرة عن الموعد المحدد</li>}
              {urgentContracts > 0 && <li style={{ marginBottom: 4 }}>⚠️ {urgentContracts} عقد ينتهي خلال 30 يوماً</li>}
              {openPenalties > 0 && <li style={{ marginBottom: 4 }}>⚠️ {openPenalties} جزاء مفتوح بانتظار التنفيذ</li>}
              {attendanceViolations > 0 && <li style={{ marginBottom: 4 }}>⚠️ {attendanceViolations} مخالفة حضور مسجلة</li>}
            </ul>
          </div>
        )}

        <h3 style={{ color: "#1FA98C", fontSize: 16, fontWeight: 700, margin: "25px 0 10px", paddingBottom: 8, borderBottom: "2px solid #e2e8f0" }}>التوصيات</h3>
        <ol style={{ fontSize: 12, color: "#1a2332", paddingRight: 20, lineHeight: 2 }}>
          {overdueTasks > 0 && <li>معالجة المهام المتأخرة فوراً وتحديد أسباب التأخير</li>}
          {urgentContracts > 0 && <li>اتخاذ قرارات التجديد/الإنهاء للعقود العاجلة</li>}
          {openPenalties > 0 && <li>متابعة الجزاءات المفتوحة وتوثيق الإجراءات</li>}
          {attendanceViolations > 0 && <li>مراجعة مخالفات الحضور وتطبيق الإجراءات النظامية</li>}
          <li>تحديث قائمة التحقق الأسبوعية قبل اجتماع EPMO</li>
          <li>مراجعة حالة المنصات الحكومية (نطاقات، قوى، مدد)</li>
        </ol>
      </div>
    );
  };

  // ─── Render Selected Report ────────────────────────────────────────────────
  const renderReport = () => {
    switch (selectedReport) {
      case "tasks-summary": return renderTasksSummary();
      case "attendance-weekly": return renderAttendanceReport();
      case "contracts-status": return renderContractsReport();
      case "penalties-log": return renderPenaltiesReport();
      case "compliance-check": return renderComplianceReport();
      case "executive-summary": return renderExecutiveSummary();
      default: return null;
    }
  };

  // ─── Main Render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen p-6" style={{ background: "hsl(0 0% 15%)", fontFamily: "Alexandria, system-ui, sans-serif" }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "hsl(0 0% 92%)" }}>التقارير الاحترافية</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(0 0% 55%)" }}>إنشاء تقارير احترافية لكل مهمة بهوية People 3.6T</p>
      </div>

      {/* Missing Data Alert */}
      {missingData.length > 0 && (
        <div className="mb-6 rounded-xl border p-5" style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.3)" }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} style={{ color: "#F59E0B" }} />
            <h3 className="font-bold text-sm" style={{ color: "#F59E0B" }}>تنبيه: بيانات مفقودة</h3>
          </div>
          <p className="text-xs mb-2" style={{ color: "hsl(0 0% 77%)" }}>البيانات التالية غير متوفرة حالياً وتحتاج إلى إدخالها لإنشاء تقارير كاملة:</p>
          <ul className="space-y-1">
            {missingData.map((item, i) => (
              <li key={i} className="text-xs flex items-center gap-2" style={{ color: "hsl(0 0% 72%)" }}>
                <span style={{ color: "#F59E0B" }}>•</span> {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Report Selection Grid */}
      {!selectedReport ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reportTypes.map((report) => (
            <button
              key={report.id}
              onClick={() => setSelectedReport(report.id)}
              className="text-right rounded-xl border p-5 transition-all hover:border-[#1FA98C]/50 hover:shadow-lg"
              style={{ background: "hsl(0 0% 19%)", borderColor: "hsl(0 0% 28%)" }}
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "hsl(165 69% 39% / 0.12)" }}>
                <report.icon size={24} style={{ color: "#1FA98C" }} />
              </div>
              <h3 className="font-bold text-sm mb-1" style={{ color: "hsl(0 0% 88%)" }}>{report.label}</h3>
              <p className="text-xs" style={{ color: "hsl(0 0% 55%)" }}>{report.description}</p>
            </button>
          ))}
        </div>
      ) : (
        <div>
          {/* Report Actions Bar */}
          <div className="flex items-center justify-between mb-4 p-3 rounded-xl" style={{ background: "hsl(0 0% 19%)", border: "1px solid hsl(0 0% 28%)" }}>
            <button
              onClick={() => setSelectedReport(null)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-white/5"
              style={{ color: "hsl(0 0% 72%)" }}
            >
              ← العودة للتقارير
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ background: peoplePrimary, color: "#fff" }}
              >
                <Printer size={16} />
                <span>طباعة</span>
              </button>
            </div>
          </div>

          {/* Report Content */}
          <div ref={reportRef} className="rounded-xl border p-8" style={{ background: "#fff", borderColor: "hsl(0 0% 28%)" }}>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={24} className="animate-spin" style={{ color: peoplePrimary }} />
              </div>
            ) : (
              renderReport()
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────
function KPICard({ value, label, alert }: { value: number | string; label: string; alert?: boolean }) {
  return (
    <div style={{ background: alert ? "#fef3c7" : "#f0fdf4", border: `1px solid ${alert ? "#fbbf24" : "#bbf7d0"}`, borderRadius: 8, padding: 12, textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 900, color: alert ? "#dc2626" : peoplePrimary }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Shared Styles ───────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = { background: peoplePrimary, color: "white", padding: "10px 8px", textAlign: "right", fontWeight: 700 };
const tdStyle: React.CSSProperties = { padding: 8, borderBottom: "1px solid #e2e8f0" };
