/**
 * WeeklyReport - HCM Platform
 * Weekly attendance summary: hours per employee, shortage cases, compliance rate
 * Design: Dark theme, teal #1FA98C, Alexandria font, RTL
 */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  FileText, RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, Clock, Users, TrendingDown, TrendingUp,
  CalendarDays, Download, LogIn, LogOut, Timer,
} from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";
import { exportWeeklyReport } from "@/lib/excelExport";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DaySummary {
  date: string;
  status: string;
  firstIn: string;
  lastOut: string;
  totalMinutes: number;
  isUnder8: boolean;
  shortfallMinutes: number;
}

interface EmpSummary {
  employeeId: string;
  employeeName: string;
  workDays: number;
  totalMinutes: number;
  under8Days: number;
  totalShortfallMinutes: number;
  avgMinutesPerDay: number;
  complianceRate: number;
  days: DaySummary[];
}

interface ReportData {
  period: { from: string; to: string };
  summary: {
    totalEmployees: number;
    totalPresent: number;
    totalUnder8: number;
    totalShortfall: number;
    overallAvgMins: number;
    overallCompliance: number;
  };
  employees: EmpSummary[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function minsToHHMM(mins: number): string {
  if (!mins || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "short", month: "long", day: "numeric" });
  } catch { return iso; }
}

function formatPeriod(from: string, to: string): string {
  try {
    const f = new Date(from).toLocaleDateString("ar-SA-u-ca-gregory", { day: "numeric", month: "long", year: "numeric" });
    const t = new Date(to).toLocaleDateString("ar-SA-u-ca-gregory", { day: "numeric", month: "long", year: "numeric" });
    return `${f} — ${t}`;
  } catch { return `${from} — ${to}`; }
}

// Avatar color per name hash
const AVATAR_COLORS = ["#1FA98C","#3B82F6","#8B5CF6","#F59E0B","#EF4444","#06B6D4","#10B981","#F97316","#EC4899","#6366F1"];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string): string {
  const p = name.trim().split(" ");
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.charAt(0).toUpperCase();
}

// Compliance color
function complianceColor(rate: number): string {
  if (rate >= 90) return "#1FA98C";
  if (rate >= 70) return "#F59E0B";
  return "#EF4444";
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color, highlight }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string; highlight?: boolean;
}) {
  return (
    <div style={{
      background: highlight ? `${color}10` : "hsl(var(--card))",
      border: `1px solid ${highlight ? color + "40" : "hsl(var(--border))"}`,
      borderRadius: "14px", padding: "18px 20px",
      display: "flex", alignItems: "center", gap: "14px",
    }}>
      <div style={{ width: "46px", height: "46px", borderRadius: "12px", flexShrink: 0, background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", color }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>{label}</div>
        <div style={{ fontFamily: "Alexandria", fontSize: "24px", fontWeight: 900, color: highlight ? color : "hsl(var(--foreground))", lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "3px" }}>{sub}</div>}
      </div>
    </div>
  );
}

// Horizontal bar chart for hours
function HoursBar({ minutes, target = 480 }: { minutes: number; target?: number }) {
  const pct = Math.min(100, Math.round((minutes / target) * 100));
  const color = minutes >= target ? "#1FA98C" : minutes >= 360 ? "#F59E0B" : minutes > 0 ? "#EF4444" : "#374151";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "120px" }}>
      <div style={{ flex: 1, height: "6px", background: "hsl(var(--border))", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "3px", transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 800, color, minWidth: "38px", textAlign: "left" }}>
        {minsToHHMM(minutes)}
      </span>
    </div>
  );
}

// Compliance badge
function ComplianceBadge({ rate }: { rate: number }) {
  const color = complianceColor(rate);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontFamily: "Alexandria", fontSize: "12px", fontWeight: 800,
      color, background: `${color}15`, padding: "3px 10px",
      borderRadius: "20px", border: `1px solid ${color}35`,
    }}>
      {rate >= 90 ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
      {rate}%
    </span>
  );
}

// Expandable employee row with daily breakdown
function EmpRow({ emp, idx }: { emp: EmpSummary; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const color = avatarColor(emp.employeeName);
  const isProblematic = emp.under8Days > 0;

  const rowBg = isProblematic
    ? (idx % 2 === 0 ? "rgba(249,115,22,0.04)" : "rgba(249,115,22,0.07)")
    : (idx % 2 === 0 ? "transparent" : "hsl(var(--card))");

  return (
    <>
      <tr
        style={{ background: rowBg, borderBottom: `1px solid ${isProblematic ? "rgba(249,115,22,0.12)" : "hsl(var(--muted))"}`, cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}
        onMouseEnter={e => (e.currentTarget.style.background = isProblematic ? "rgba(249,115,22,0.12)" : "hsl(var(--card))")}
        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
      >
        {/* Expand toggle */}
        <td style={{ padding: "11px 10px", textAlign: "center", width: "36px" }}>
          <span style={{ color: "hsl(var(--muted-foreground))", display: "flex", justifyContent: "center" }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </td>

        {/* Employee */}
        <td style={{ padding: "11px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0, background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 800, color, border: `1.5px solid ${color}40` }}>
              {initials(emp.employeeName)}
            </div>
            <div>
              <div style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "hsl(var(--foreground))" }}>{emp.employeeName}</div>
              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>#{emp.employeeId}</div>
            </div>
            {isProblematic && <AlertTriangle size={13} style={{ color: "#F97316", flexShrink: 0 }} />}
          </div>
        </td>

        {/* Work days */}
        <td style={{ padding: "11px 14px", textAlign: "center" }}>
          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "hsl(var(--foreground))" }}>{emp.workDays}</span>
        </td>

        {/* Total hours bar */}
        <td style={{ padding: "11px 14px" }}>
          <HoursBar minutes={emp.totalMinutes} target={emp.workDays * 480} />
        </td>

        {/* Avg hours/day */}
        <td style={{ padding: "11px 14px", textAlign: "center" }}>
          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: emp.avgMinutesPerDay >= 480 ? "#1FA98C" : emp.avgMinutesPerDay >= 360 ? "#F59E0B" : "#EF4444" }}>
            {minsToHHMM(emp.avgMinutesPerDay)}
          </span>
        </td>

        {/* Under-8 days */}
        <td style={{ padding: "11px 14px", textAlign: "center" }}>
          {emp.under8Days > 0 ? (
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 800, color: "#F97316", background: "rgba(249,115,22,0.12)", padding: "3px 10px", borderRadius: "20px", border: "1px solid rgba(249,115,22,0.3)" }}>
              {emp.under8Days} {emp.under8Days === 1 ? "يوم" : "أيام"}
            </span>
          ) : (
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "#1FA98C" }}>✓ لا يوجد</span>
          )}
        </td>

        {/* Total shortfall */}
        <td style={{ padding: "11px 14px", textAlign: "center" }}>
          {emp.totalShortfallMinutes > 0 ? (
            <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 800, color: "#EF4444" }}>
              -{minsToHHMM(emp.totalShortfallMinutes)}
            </span>
          ) : (
            <span style={{ color: "hsl(var(--border))", fontSize: "14px" }}>—</span>
          )}
        </td>

        {/* Compliance */}
        <td style={{ padding: "11px 14px", textAlign: "center" }}>
          <ComplianceBadge rate={emp.complianceRate} />
        </td>
      </tr>

      {/* Expanded daily breakdown */}
      {expanded && (
        <tr style={{ background: "hsl(var(--background))" }}>
          <td colSpan={8} style={{ padding: "0 0 0 50px" }}>
            <div style={{ padding: "12px 16px 16px", direction: "rtl" }}>
              <div style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: "#1FA98C", marginBottom: "10px", letterSpacing: "0.5px" }}>
                تفاصيل الأيام
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {emp.days.sort((a, b) => a.date.localeCompare(b.date)).map(day => {
                  const isUnder = day.isUnder8;
                  const isAbsent = day.status === "Absent";
                  const cardColor = isAbsent ? "#EF4444" : isUnder ? "#F97316" : day.totalMinutes > 0 ? "#1FA98C" : "#6B7280";
                  return (
                    <div key={day.date} style={{
                      background: `${cardColor}10`, border: `1px solid ${cardColor}30`,
                      borderRadius: "10px", padding: "10px 14px", minWidth: "160px",
                    }}>
                      <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>{formatDate(day.date)}</div>
                      {isAbsent ? (
                        <div style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: "#EF4444" }}>غائب</div>
                      ) : day.totalMinutes > 0 ? (
                        <>
                          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "4px" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontFamily: "Alexandria", fontSize: "11px", color: "#1FA98C" }}>
                              <LogIn size={10} />{day.firstIn}
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>
                              <LogOut size={10} />{day.lastOut}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 800, color: cardColor }}>{minsToHHMM(day.totalMinutes)}</span>
                            {isUnder && (
                              <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "#EF4444", fontWeight: 700 }}>
                                (-{minsToHHMM(day.shortfallMinutes)})
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>{day.status}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type FilterMode = "الكل" | "ناقص 8 ساعات" | "ملتزم";

export default function WeeklyReport() {
  const today = new Date();
  // Default: current week Sat–Fri
  const dayOfWeek = today.getDay();
  const daysSinceSat = (dayOfWeek + 1) % 7;
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - daysSinceSat);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);

  const [fromDate, setFromDate] = useState(weekStart.toISOString().split("T")[0]);
  const [toDate,   setToDate]   = useState(weekEnd.toISOString().split("T")[0]);
  const [report,   setReport]   = useState<ReportData | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [dataSourceReady, setDataSourceReady] = useState<boolean | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("الكل");
  const [sortBy, setSortBy] = useState<"shortfall" | "compliance" | "name">("shortfall");

  useEffect(() => {
    fetch("/api/attendance/sync-status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setDataSourceReady(Boolean(d.success)))
      .catch(() => setDataSourceReady(false));
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/weekly-report?from=${fromDate}&to=${toDate}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setReport(json);
        toast.success(`تم تحميل التقرير — ${json.employees.length} موظف`);
      } else {
        setError(json.error || "فشل تحميل التقرير");
        toast.error("فشل تحميل التقرير الأسبوعي");
      }
    } catch (e: any) {
      setError(e.message);
      toast.error("خطأ في الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (dataSourceReady) fetchReport();
  }, [dataSourceReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredEmployees = useMemo(() => {
    if (!report) return [];
    let list = [...report.employees];
    if (filterMode === "ناقص 8 ساعات") list = list.filter(e => e.under8Days > 0);
    else if (filterMode === "ملتزم")     list = list.filter(e => e.under8Days === 0 && e.workDays > 0);
    if (sortBy === "shortfall")   list.sort((a, b) => b.totalShortfallMinutes - a.totalShortfallMinutes);
    else if (sortBy === "compliance") list.sort((a, b) => a.complianceRate - b.complianceRate);
    else list.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    return list;
  }, [report, filterMode, sortBy]);

  // Export to Excel
  const handleExport = () => {
    if (!report) return;
    exportWeeklyReport({ employees: report.employees, attendance: [], leaves: [], performance: [] });
    toast.success('جارٍ تحميل ملف Excel...');
  };

  const FILTER_TABS: { key: FilterMode; label: string; color: string }[] = [
    { key: "الكل",          label: "جميع الموظفين", color: "#1FA98C" },
    { key: "ناقص 8 ساعات", label: "ناقص 8 ساعات",  color: "#F97316" },
    { key: "ملتزم",         label: "ملتزمون",        color: "#3B82F6" },
  ];

  return (
    <PageTemplate title="التقرير الأسبوعي" subtitle="ملخص ساعات العمل وحالات النقص الأسبوعية" icon={FileText}>

      {/* ── Controls Bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px", direction: "rtl", flexWrap: "wrap", gap: "12px",
        background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
        borderRadius: "14px", padding: "14px 18px",
      }}>
        {/* Internal data status */}
        <div>
          {dataSourceReady === null ? (
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>جارٍ التحقق...</span>
          ) : dataSourceReady ? (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "Alexandria", fontSize: "12px", color: "#1FA98C", background: "hsl(165 69% 39% / 0.10)", padding: "5px 12px", borderRadius: "20px", border: "1px solid hsl(165 69% 39% / 0.25)" }}>
              <Wifi size={13} /> بيانات الحضور الداخلية جاهزة
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "Alexandria", fontSize: "12px", color: "#EF4444", background: "rgba(239,68,68,0.08)", padding: "5px 12px", borderRadius: "20px", border: "1px solid rgba(239,68,68,0.2)" }}>
              <WifiOff size={13} /> بيانات الحضور غير متاحة
            </span>
          )}
        </div>

        {/* Date range + actions */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>من</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "6px 10px", fontFamily: "Alexandria", fontSize: "12px", outline: "none" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>إلى</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "6px 10px", fontFamily: "Alexandria", fontSize: "12px", outline: "none" }} />
          </div>
          <button onClick={fetchReport} disabled={loading || !dataSourceReady}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: dataSourceReady ? "#1FA98C" : "hsl(var(--border))", color: dataSourceReady ? "white" : "hsl(var(--muted-foreground))", border: "none", borderRadius: "9px", padding: "8px 18px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: loading || !dataSourceReady ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {loading ? "جارٍ التحميل..." : "تحميل التقرير"}
          </button>
          {report && (
            <button onClick={handleExport}
              style={{ display: "flex", alignItems: "center", gap: "6px", background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))", borderRadius: "9px", padding: "8px 14px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
              <Download size={13} /> تصدير Excel
            </button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", fontFamily: "Alexandria", fontSize: "13px", color: "#EF4444", direction: "rtl" }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Internal data unavailable ── */}
      {!loading && !dataSourceReady && dataSourceReady !== null && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
          <WifiOff size={52} style={{ margin: "0 auto 16px", opacity: 0.25 }} />
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>بيانات الحضور الداخلية غير جاهزة حالياً</div>
          <div style={{ fontSize: "13px" }}>يرجى التحقق من مزامنة الحضور المحفوظة في المنصة.</div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
          <RefreshCw size={40} style={{ margin: "0 auto 16px", animation: "spin 1s linear infinite", opacity: 0.5 }} />
          <div style={{ fontSize: "14px" }}>جارٍ تحليل بيانات الحضور الأسبوعية...</div>
        </div>
      )}

      {/* ── Report Content ── */}
      {!loading && report && (
        <>
          {/* Period Header */}
          <div style={{
            background: "hsl(var(--primary) / 0.10)",
            border: "1px solid hsl(165 69% 39% / 0.25)", borderRadius: "14px",
            padding: "16px 20px", marginBottom: "20px", direction: "rtl",
            display: "flex", alignItems: "center", gap: "12px",
          }}>
            <CalendarDays size={20} style={{ color: "#1FA98C", flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "2px" }}>الفترة الزمنية</div>
              <div style={{ fontFamily: "Alexandria", fontSize: "15px", fontWeight: 800, color: "hsl(var(--foreground))" }}>
                {formatPeriod(report.period.from, report.period.to)}
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "22px", direction: "rtl" }}>
            <KpiCard icon={<Users size={20} />}        label="إجمالي الموظفين"    value={report.summary.totalEmployees}                                          color="#1FA98C" />
            <KpiCard icon={<CheckCircle size={20} />}  label="حضروا هذا الأسبوع" value={report.summary.totalPresent}                                            color="#3B82F6" />
            <KpiCard icon={<Clock size={20} />}        label="متوسط ساعات يومياً" value={minsToHHMM(report.summary.overallAvgMins)} sub="من أصل 8 ساعات"        color="#8B5CF6" />
            <KpiCard icon={<TrendingUp size={20} />}   label="نسبة الالتزام"      value={`${report.summary.overallCompliance}%`} sub="من الأيام الكاملة"         color={complianceColor(report.summary.overallCompliance)} />
            <KpiCard icon={<AlertTriangle size={20} />} label="موظفون ناقصون"     value={report.summary.totalUnder8} sub="أقل من 8 ساعات"                        color="#F97316" highlight={report.summary.totalUnder8 > 0} />
            <KpiCard icon={<TrendingDown size={20} />} label="إجمالي ساعات النقص" value={minsToHHMM(report.summary.totalShortfall)} sub="مجموع الساعات الناقصة" color="#EF4444" highlight={report.summary.totalShortfall > 0} />
          </div>

          {/* Alert banner for shortfall */}
          {report.summary.totalUnder8 > 0 && (
            <div style={{
              background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)",
              borderRadius: "12px", padding: "12px 18px", marginBottom: "16px",
              display: "flex", alignItems: "center", gap: "10px", direction: "rtl",
            }}>
              <AlertTriangle size={18} style={{ color: "#F97316", flexShrink: 0 }} />
              <div>
                <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#F97316" }}>
                  {report.summary.totalUnder8} موظف أمضوا أقل من 8 ساعات
                </span>
                <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginRight: "8px" }}>
                  — إجمالي الساعات الناقصة: {minsToHHMM(report.summary.totalShortfall)}
                </span>
              </div>
            </div>
          )}

          {/* Filter Tabs + Sort */}
          <div style={{
            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
            borderRadius: "14px", padding: "12px 16px", marginBottom: "16px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: "10px", direction: "rtl",
          }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {FILTER_TABS.map(tab => {
                const count = tab.key === "الكل" ? report.employees.length
                  : tab.key === "ناقص 8 ساعات" ? report.summary.totalUnder8
                  : report.employees.filter(e => e.under8Days === 0 && e.workDays > 0).length;
                const isActive = filterMode === tab.key;
                return (
                  <button key={tab.key} onClick={() => setFilterMode(tab.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "6px 14px", borderRadius: "22px",
                      fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                      background: isActive ? tab.color : "hsl(var(--muted))",
                      color: isActive ? "white" : "hsl(var(--muted-foreground))",
                      border: isActive ? `1px solid ${tab.color}` : "1px solid hsl(var(--border))",
                    }}>
                    {tab.label}
                    <span style={{ fontSize: "10px", fontWeight: 900, background: isActive ? "rgba(255,255,255,0.25)" : "hsl(var(--border))", color: isActive ? "white" : "hsl(var(--muted-foreground))", padding: "1px 6px", borderRadius: "10px" }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Sort */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>ترتيب حسب:</span>
              {[
                { key: "shortfall" as const, label: "الأكثر نقصاً" },
                { key: "compliance" as const, label: "الالتزام" },
                { key: "name" as const, label: "الاسم" },
              ].map(s => (
                <button key={s.key} onClick={() => setSortBy(s.key)}
                  style={{ padding: "4px 10px", borderRadius: "16px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, cursor: "pointer", background: sortBy === s.key ? "hsl(165 69% 39% / 0.15)" : "hsl(var(--muted))", color: sortBy === s.key ? "#1FA98C" : "hsl(var(--muted-foreground))", border: sortBy === s.key ? "1px solid hsl(165 69% 39% / 0.40)" : "1px solid hsl(var(--border))" }}>
                  {s.label}
                </button>
              ))}
              <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginRight: "4px" }}>
                {filteredEmployees.length} موظف
              </span>
            </div>
          </div>

          {/* Main Table */}
          <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl", minWidth: "780px" }}>
                <thead>
                  <tr style={{ background: "hsl(var(--card))" }}>
                    <th style={{ width: "36px", padding: "12px 10px" }} />
                    {[
                      { label: "الموظف",           align: "right"  as const, w: "22%" },
                      { label: "أيام الحضور",      align: "center" as const, w: "9%"  },
                      { label: "إجمالي الساعات",   align: "right"  as const, w: "18%" },
                      { label: "متوسط يومي",       align: "center" as const, w: "10%" },
                      { label: "أيام ناقصة",       align: "center" as const, w: "11%" },
                      { label: "إجمالي النقص",     align: "center" as const, w: "11%" },
                      { label: "نسبة الالتزام",    align: "center" as const, w: "11%" },
                    ].map(col => (
                      <th key={col.label} style={{ padding: "12px 14px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: "#1FA98C", textAlign: col.align, borderBottom: "2px solid hsl(var(--muted))", width: col.w, whiteSpace: "nowrap" }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "56px 20px", textAlign: "center", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(var(--muted-foreground))" }}>
                        لا توجد بيانات تطابق الفلتر الحالي
                      </td>
                    </tr>
                  ) : filteredEmployees.map((emp, idx) => (
                    <EmpRow key={emp.employeeId} emp={emp} idx={idx} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table footer summary */}
            {filteredEmployees.length > 0 && (
              <div style={{ padding: "12px 18px", borderTop: "1px solid hsl(var(--border))", direction: "rtl", display: "flex", gap: "20px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>
                  <Timer size={11} style={{ display: "inline", marginLeft: "4px" }} />
                  إجمالي الساعات الناقصة: <strong style={{ color: "#EF4444" }}>{minsToHHMM(filteredEmployees.reduce((s, e) => s + e.totalShortfallMinutes, 0))}</strong>
                </span>
                <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>
                  متوسط الالتزام: <strong style={{ color: "#1FA98C" }}>{filteredEmployees.length > 0 ? Math.round(filteredEmployees.reduce((s, e) => s + e.complianceRate, 0) / filteredEmployees.length) : 0}%</strong>
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && dataSourceReady && !report && !error && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
          <FileText size={52} style={{ margin: "0 auto 16px", opacity: 0.2 }} />
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>لا يوجد تقرير بعد</div>
          <div style={{ fontSize: "13px" }}>اضغط «تحميل التقرير» لتحليل بيانات الحضور الأسبوعية</div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </PageTemplate>
  );
}
