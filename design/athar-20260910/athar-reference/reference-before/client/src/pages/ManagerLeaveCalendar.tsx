/**
 * ManagerLeaveCalendar - HCM Platform
 * Visual monthly calendar showing all team leaves
 * Brand: People36t theme tokens, 3,6T identity
 */
import { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronLeft, Calendar, Users, Filter, X, Info } from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import leaveTypesRaw from "@/data/leaveTypes.json";

type LeaveRequest = {
  id: string; employeeId: number; nameAr: string; department: string;
  leaveType: string; startDate: string; endDate: string; days: number;
  status: string; reason: string; appliedDate: string;
  approvedBy: string | null; notes: string;
};
type LeaveType = {
  id: string; nameAr: string; color: string; icon: string; paid: boolean;
};

const leaveTypes = leaveTypesRaw as LeaveType[];
const leaveTypeMap = Object.fromEntries(leaveTypes.map(t => [t.id, t]));
const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.15)";
const cardSurface = "hsl(var(--card))";
const borderColor = "hsl(var(--border))";
const foreground = "hsl(var(--foreground))";
const mutedText = "hsl(var(--muted-foreground))";

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];
const ARABIC_DAYS_SHORT = ["أحد", "اثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  "معتمدة":       { bg: "hsl(var(--primary) / 0.15)",  border: peoplePrimary, text: peoplePrimary },
  "قيد المراجعة": { bg: "rgba(245,158,11,0.15)",  border: "#F59E0B", text: "#F59E0B" },
  "مرفوضة":       { bg: "rgba(239,68,68,0.15)",   border: "#EF4444", text: "#EF4444" },
};

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Get all dates in a leave request range
function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = isoToDate(start);
  const e = isoToDate(end);
  const cur = new Date(s);
  while (cur <= e) {
    dates.push(dateToIso(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Assign a unique color per employee for calendar display
const EMPLOYEE_PALETTE = [
  peoplePrimary,"#3B82F6","#8B5CF6","#EC4899","#F59E0B",
  "#10B981","#F97316","#06B6D4","#EF4444","#84CC16",
  "#A855F7","#14B8A6","#F43F5E","#6366F1","#22C55E",
];
const employeeColorCache: Record<number, string> = {};
let colorIdx = 0;
function getEmployeeColor(id: number): string {
  if (!employeeColorCache[id]) {
    employeeColorCache[id] = EMPLOYEE_PALETTE[colorIdx % EMPLOYEE_PALETTE.length];
    colorIdx++;
  }
  return employeeColorCache[id];
}

export default function ManagerLeaveCalendar() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hcm/leaves", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        // Map snake_case to camelCase
        const mapped = d.map((item: any) => ({
          id: item.id,
          employeeId: item.employee_id,
          nameAr: item.name_ar,
          department: item.department_en || item.department, // fallback if needed
          leaveType: item.leave_type,
          startDate: item.start_date || item.startDate,
          endDate: item.end_date || item.endDate,
          days: item.days,
          status: item.status,
          reason: item.reason,
          appliedDate: item.applied_date || item.appliedDate,
          approvedBy: item.approved_by || item.approvedBy,
          notes: item.notes
        }));
        setLeaveRequests(mapped);
        mapped.forEach((r: LeaveRequest) => getEmployeeColor(r.employeeId));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [deptFilter, setDeptFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("معتمدة");
  const [typeFilter, setTypeFilter] = useState("الكل");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const DEPARTMENTS = useMemo(() => ["الكل", ...Array.from(new Set(leaveRequests.map(r => r.department))).sort()], [leaveRequests]);
  const STATUSES = ["الكل", "معتمدة", "قيد المراجعة", "مرفوضة"];

  // Navigate months
  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
    setSelectedDay(null);
  };
  const goToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelectedDay(null); };

  // Filter requests
  const filteredRequests = useMemo(() => {
    return leaveRequests.filter(r => {
      const matchDept = deptFilter === "الكل" || r.department === deptFilter;
      const matchStatus = statusFilter === "الكل" || r.status === statusFilter;
      const matchType = typeFilter === "الكل" || r.leaveType === typeFilter;
      return matchDept && matchStatus && matchType;
    });
  }, [leaveRequests, deptFilter, statusFilter, typeFilter]);

  // Build a map: dateIso -> list of leave requests active on that day
  const dayLeaveMap = useMemo(() => {
    const map: Record<string, LeaveRequest[]> = {};
    filteredRequests.forEach(r => {
      getDatesInRange(r.startDate, r.endDate).forEach(d => {
        if (!map[d]) map[d] = [];
        map[d].push(r);
      });
    });
    return map;
  }, [filteredRequests]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startDow = firstDay.getDay(); // 0=Sun
    const days: (string | null)[] = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(dateToIso(new Date(viewYear, viewMonth, d)));
    }
    // Pad to complete last week
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [viewYear, viewMonth]);

  // Selected day leaves
  const selectedDayLeaves = selectedDay ? (dayLeaveMap[selectedDay] || []) : [];

  // KPIs for current month
  const monthKpis = useMemo(() => {
    const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
    const monthEnd = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(new Date(viewYear, viewMonth + 1, 0).getDate()).padStart(2, "0")}`;
    const monthReqs = filteredRequests.filter(r => r.startDate <= monthEnd && r.endDate >= monthStart);
    const uniqueEmps = new Set(monthReqs.map(r => r.employeeId)).size;
    const totalDays = monthReqs.reduce((s, r) => s + r.days, 0);
    const approved = monthReqs.filter(r => r.status === "معتمدة").length;
    const pending = monthReqs.filter(r => r.status === "قيد المراجعة").length;
    return { total: monthReqs.length, uniqueEmps, totalDays, approved, pending };
  }, [filteredRequests, viewYear, viewMonth]);

  // Upcoming leaves (next 7 days from today)
  const upcomingLeaves = useMemo(() => {
    const upcoming: { date: string; leaves: LeaveRequest[] }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = dateToIso(d);
      if (dayLeaveMap[iso]?.length) {
        upcoming.push({ date: iso, leaves: dayLeaveMap[iso] });
      }
    }
    return upcoming.slice(0, 5);
  }, [dayLeaveMap]);

  const todayIso = dateToIso(today);

  if (loading) {
    return (
      <PageTemplate title="تقويم إجازات الفريق" subtitle="عرض مرئي لإجازات الفريق بالكامل" icon={Calendar}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
          <div style={{ fontFamily: "Alexandria", fontSize: "18px", color: peoplePrimary }}>جاري التحميل...</div>
        </div>
      </PageTemplate>
    );
  }

  return (
    <PageTemplate title="تقويم إجازات الفريق" subtitle="عرض مرئي لإجازات الفريق بالكامل" icon={Calendar}>
      <div style={{ direction: "rtl", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
          {[
            { label: "طلبات الشهر", value: monthKpis.total, color: peoplePrimary, icon: "📋" },
            { label: "موظفون في إجازة", value: monthKpis.uniqueEmps, color: "#3B82F6", icon: "👥" },
            { label: "إجمالي الأيام", value: monthKpis.totalDays, color: "#8B5CF6", icon: "📅" },
            { label: "معتمدة", value: monthKpis.approved, color: "#10B981", icon: "✅" },
            { label: "قيد المراجعة", value: monthKpis.pending, color: "#F59E0B", icon: "⏳" },
          ].map(k => (
            <div key={k.label} style={{ background: `${k.color}12`, border: `1px solid ${k.color}28`, borderRadius: "10px", padding: "12px 14px" }}>
              <div style={{ fontSize: "18px", marginBottom: "6px" }}>{k.icon}</div>
              <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "20px", color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 58%)", marginTop: "3px" }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Main layout: Calendar + Sidebar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "16px", alignItems: "start" }}>

          {/* Calendar */}
          <div style={{ background: cardSurface, border: `1px solid ${borderColor}`, borderRadius: "14px", overflow: "hidden" }}>
            {/* Calendar header */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid hsl(0 0% 22%)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button onClick={prevMonth} style={{ width: "30px", height: "30px", borderRadius: "7px", background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)", color: "hsl(0 0% 65%)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ChevronRight size={14} />
                </button>
                <h2 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: "hsl(0 0% 92%)", margin: 0, minWidth: "140px", textAlign: "center" }}>
                  {ARABIC_MONTHS[viewMonth]} {viewYear}
                </h2>
                <button onClick={nextMonth} style={{ width: "30px", height: "30px", borderRadius: "7px", background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)", color: "hsl(0 0% 65%)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ChevronLeft size={14} />
                </button>
                <button onClick={goToday} style={{ padding: "5px 12px", background: "hsl(var(--primary) / 0.12)", border: "1px solid hsl(var(--primary) / 0.30)", borderRadius: "6px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: peoplePrimary, cursor: "pointer" }}>
                  اليوم
                </button>
              </div>
              <button
                onClick={() => setShowFilters(f => !f)}
                style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 12px", background: showFilters ? peoplePrimarySoft : "hsl(var(--muted))", border: `1px solid ${showFilters ? "hsl(var(--primary) / 0.40)" : borderColor}`, borderRadius: "7px", fontFamily: "Alexandria", fontSize: "12px", color: showFilters ? peoplePrimary : mutedText, cursor: "pointer" }}
              >
                <Filter size={12} />فلترة
              </button>
            </div>

            {/* Filters panel */}
            {showFilters && (
              <div style={{ padding: "12px 18px", borderBottom: "1px solid hsl(0 0% 22%)", background: "hsl(0 0% 15%)", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ padding: "6px 10px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "7px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)", direction: "rtl" }}>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d === "الكل" ? "كل الأقسام" : d}</option>)}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "6px 10px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "7px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)", direction: "rtl" }}>
                  {STATUSES.map(s => <option key={s} value={s}>{s === "الكل" ? "كل الحالات" : s}</option>)}
                </select>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ padding: "6px 10px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "7px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)", direction: "rtl" }}>
                  <option value="الكل">كل الأنواع</option>
                  {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
                </select>
                {(deptFilter !== "الكل" || statusFilter !== "معتمدة" || typeFilter !== "الكل") && (
                  <button onClick={() => { setDeptFilter("الكل"); setStatusFilter("معتمدة"); setTypeFilter("الكل"); }} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "5px 10px", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "6px", fontFamily: "Alexandria", fontSize: "11px", color: "#EF4444", cursor: "pointer" }}>
                    <X size={11} />إعادة تعيين
                  </button>
                )}
              </div>
            )}

            {/* Day headers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "hsl(0 0% 18%)" }}>
              {ARABIC_DAYS_SHORT.map(d => (
                <div key={d} style={{ padding: "8px 4px", textAlign: "center", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: (d === "جمع" || d === "سبت") ? mutedText : peoplePrimary }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
              {calendarDays.map((dayIso, idx) => {
                if (!dayIso) {
                  return <div key={`empty-${idx}`} style={{ minHeight: "80px", borderBottom: "1px solid hsl(0 0% 20%)", borderRight: idx % 7 !== 6 ? "1px solid hsl(0 0% 20%)" : "none", background: "hsl(0 0% 14%)" }} />;
                }
                const dayNum = parseInt(dayIso.split("-")[2]);
                const dow = new Date(dayIso).getDay();
                const isWeekend = dow === 5 || dow === 6;
                const isToday = dayIso === todayIso;
                const isSelected = dayIso === selectedDay;
                const leaves = dayLeaveMap[dayIso] || [];
                const MAX_SHOW = 3;

                return (
                  <div
                    key={dayIso}
                    onClick={() => setSelectedDay(isSelected ? null : dayIso)}
                    style={{
                      minHeight: "80px", padding: "6px 5px",
                      borderBottom: "1px solid hsl(0 0% 20%)",
                      borderRight: idx % 7 !== 6 ? "1px solid hsl(0 0% 20%)" : "none",
                      background: isSelected ? "hsl(var(--primary) / 0.08)" : "transparent",
                      cursor: leaves.length > 0 ? "pointer" : "default",
                      transition: "background 0.15s",
                      position: "relative",
                    }}
                  >
                    {/* Day number */}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
                      <span style={{
                        fontFamily: "Alexandria", fontSize: "12px", fontWeight: isToday ? 800 : 500,
                        color: isToday ? "#fff" : isWeekend ? "hsl(0 0% 45%)" : "hsl(0 0% 72%)",
                        background: isToday ? peoplePrimary : "transparent",
                        width: isToday ? "22px" : "auto", height: isToday ? "22px" : "auto",
                        borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{dayNum}</span>
                    </div>

                    {/* Leave chips */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {leaves.slice(0, MAX_SHOW).map(r => {
                        const empColor = getEmployeeColor(r.employeeId);
                        const lt = leaveTypeMap[r.leaveType];
                        return (
                          <div key={r.id} style={{
                            background: `${empColor}22`,
                            borderRight: `3px solid ${empColor}`,
                            borderRadius: "3px",
                            padding: "1px 4px",
                            overflow: "hidden",
                          }}>
                            <span style={{ fontFamily: "Alexandria", fontSize: "9px", fontWeight: 600, color: empColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                              {r.nameAr.split(" ")[0]} {lt ? `· ${lt.nameAr.split(" ")[0]}` : ""}
                            </span>
                          </div>
                        );
                      })}
                      {leaves.length > MAX_SHOW && (
                        <div style={{ fontFamily: "Alexandria", fontSize: "9px", color: "hsl(0 0% 55%)", paddingRight: "4px" }}>
                          +{leaves.length - MAX_SHOW} آخرون
                        </div>
                      )}
                    </div>

                    {/* Selected indicator */}
                    {isSelected && (
                      <div style={{ position: "absolute", inset: 0, border: `2px solid ${peoplePrimary}`, borderRadius: "0", pointerEvents: "none" }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

            {/* Selected day details */}
            {selectedDay ? (
              <div style={{ background: cardSurface, border: "1px solid hsl(var(--primary) / 0.35)", borderRadius: "12px", overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid hsl(0 0% 22%)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: peoplePrimary }}>
                      {parseInt(selectedDay.split("-")[2])} {ARABIC_MONTHS[parseInt(selectedDay.split("-")[1]) - 1]} {selectedDay.split("-")[0]}
                    </div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 55%)" }}>{selectedDayLeaves.length} موظف في إجازة</div>
                  </div>
                  <button onClick={() => setSelectedDay(null)} style={{ background: "none", border: "none", color: "hsl(0 0% 50%)", cursor: "pointer" }}><X size={14} /></button>
                </div>
                <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                  {selectedDayLeaves.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 50%)" }}>لا توجد إجازات في هذا اليوم</div>
                  ) : selectedDayLeaves.map(r => {
                    const empColor = getEmployeeColor(r.employeeId);
                    const lt = leaveTypeMap[r.leaveType];
                    const sc = STATUS_COLORS[r.status] || STATUS_COLORS["قيد المراجعة"];
                    return (
                      <div key={r.id} style={{ padding: "10px 14px", borderBottom: "1px solid hsl(0 0% 20%)", borderRight: `3px solid ${empColor}` }}>
                        <div style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: "hsl(0 0% 88%)" }}>{r.nameAr}</div>
                        <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 55%)", marginBottom: "5px" }}>{r.department}</div>
                        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                          {lt && <span style={{ fontFamily: "Alexandria", fontSize: "10px", fontWeight: 600, color: lt.color, background: `${lt.color}15`, padding: "2px 7px", borderRadius: "20px" }}>{lt.nameAr}</span>}
                          <span style={{ fontFamily: "Alexandria", fontSize: "10px", fontWeight: 600, color: sc.text, background: sc.bg, padding: "2px 7px", borderRadius: "20px" }}>{r.status}</span>
                          <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 55%)", background: "hsl(0 0% 22%)", padding: "2px 7px", borderRadius: "20px" }}>{r.days} يوم</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "12px", padding: "16px", textAlign: "center" }}>
                <Info size={20} color="hsl(0 0% 40%)" style={{ margin: "0 auto 8px" }} />
                <p style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 50%)", margin: 0 }}>انقر على أي يوم في التقويم لعرض تفاصيل إجازات ذلك اليوم</p>
              </div>
            )}

            {/* Upcoming leaves */}
            <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid hsl(0 0% 22%)" }}>
                <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 88%)", margin: 0 }}>إجازات قادمة (14 يوم)</h3>
              </div>
              <div>
                {upcomingLeaves.length === 0 ? (
                  <div style={{ padding: "16px", textAlign: "center", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 50%)" }}>لا توجد إجازات قادمة</div>
                ) : upcomingLeaves.map(({ date, leaves }) => (
                  <div key={date} style={{ padding: "8px 14px", borderBottom: "1px solid hsl(0 0% 20%)", cursor: "pointer" }} onClick={() => { setViewYear(parseInt(date.split("-")[0])); setViewMonth(parseInt(date.split("-")[1]) - 1); setSelectedDay(date); }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: peoplePrimary, marginBottom: "4px" }}>
                      {parseInt(date.split("-")[2])} {ARABIC_MONTHS[parseInt(date.split("-")[1]) - 1]}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {leaves.slice(0, 2).map(r => (
                        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: getEmployeeColor(r.employeeId), flexShrink: 0 }} />
                          <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 70%)" }}>{r.nameAr.split(" ")[0]} {r.nameAr.split(" ")[1] || ""}</span>
                        </div>
                      ))}
                      {leaves.length > 2 && <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 50%)" }}>+{leaves.length - 2} آخرون</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave type legend */}
            <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "12px", padding: "12px 14px" }}>
              <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "12px", color: "hsl(0 0% 75%)", margin: "0 0 10px" }}>أنواع الإجازات</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {leaveTypes.map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: t.color, flexShrink: 0 }} />
                    <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 67%)" }}>{t.nameAr}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Team list for current month */}
        <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "14px", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid hsl(0 0% 22%)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(0 0% 88%)", margin: 0 }}>
              قائمة إجازات {ARABIC_MONTHS[viewMonth]} {viewYear}
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <Users size={14} color="hsl(0 0% 55%)" />
              <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>{monthKpis.total} طلب</span>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl", minWidth: "600px" }}>
              <thead style={{ background: "hsl(0 0% 18%)" }}>
                <tr>
                  {["الموظف", "القسم", "نوع الإجازة", "من", "إلى", "الأيام", "الحالة"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: peoplePrimary, textAlign: "right", borderBottom: `1px solid ${borderColor}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRequests.filter(r => {
                  const ms = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
                  const me = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(new Date(viewYear, viewMonth + 1, 0).getDate()).padStart(2, "0")}`;
                  return r.startDate <= me && r.endDate >= ms;
                }).map(r => {
                  const lt = leaveTypeMap[r.leaveType];
                  const sc = STATUS_COLORS[r.status] || STATUS_COLORS["قيد المراجعة"];
                  const empColor = getEmployeeColor(r.employeeId);
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid hsl(0 0% 20%)" }}>
                      <td style={{ padding: "9px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: empColor, flexShrink: 0 }} />
                          <span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 600, color: "hsl(0 0% 88%)" }}>{r.nameAr}</span>
                        </div>
                      </td>
                      <td style={{ padding: "9px 12px" }}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 60%)" }}>{r.department}</span></td>
                      <td style={{ padding: "9px 12px" }}>
                        {lt && <span style={{ fontFamily: "Alexandria", fontSize: "10px", fontWeight: 600, color: lt.color, background: `${lt.color}15`, padding: "2px 8px", borderRadius: "20px" }}>{lt.nameAr}</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 65%)" }}>{parseInt(r.startDate.split("-")[2])} {ARABIC_MONTHS[parseInt(r.startDate.split("-")[1]) - 1]}</span></td>
                      <td style={{ padding: "9px 12px" }}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 65%)" }}>{parseInt(r.endDate.split("-")[2])} {ARABIC_MONTHS[parseInt(r.endDate.split("-")[1]) - 1]}</span></td>
                      <td style={{ padding: "9px 12px", textAlign: "center" }}><span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: "hsl(0 0% 80%)" }}>{r.days}</span></td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ fontFamily: "Alexandria", fontSize: "10px", fontWeight: 700, color: sc.text, background: sc.bg, padding: "2px 9px", borderRadius: "20px", border: `1px solid ${sc.border}30` }}>{r.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageTemplate>
  );
}
