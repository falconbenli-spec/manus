/**
 * Attendance - HCM Platform (Enhanced with Employee Analytics Charts)
 * Design: People36t theme tokens, Alexandria font, RTL
 * Features: Per-employee compliance charts, donut charts, detailed analytics
 */
import React, { useState, useMemo, useEffect } from "react";
import { MapPin } from "lucide-react";
import {
  Clock, Search, Users, CheckCircle, XCircle, CalendarOff,
  ChevronLeft, ChevronRight, RefreshCw, Wifi, WifiOff,
  LogIn, LogOut, Timer, CalendarDays, TrendingUp, AlertTriangle,
  BarChart3, PieChart, UserCheck, Award, ArrowUpRight,
} from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { exportAttendance, exportAttendanceByDepartment } from "@/lib/excelExport";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, RadialBarChart, RadialBar, Legend, AreaChart, Area,
} from "recharts";

interface AttendanceRecord {
  employeeId: string;
  employeeName: string;
  date: string;
  firstIn: string;
  lastOut: string;
  totalHours: string;
  status: string;
  shiftName: string;
}

interface EmployeeSummary {
  id: string;
  name: string;
  totalWorkdays: number;
  presentDays: number;
  absentDays: number;
  singlePunchDays: number;
  leaveDays: number;
  under8Days: number;
  attendanceRate: number;
  complianceRate: number;
  avgHours: number; // in minutes
  totalMinutes: number;
  lateCount: number;
  color: string;
}

function parseHHMM(val: string): number {
  if (!val || val === "-" || val === "00:00") return 0;
  const [h, m] = val.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isSinglePunch(record: AttendanceRecord): boolean {
  if (record.status !== "Absent") return false;
  const firstIn = record.firstIn && record.firstIn !== "-";
  const lastOut = record.lastOut && record.lastOut !== "-";
  return Boolean(firstIn) !== Boolean(lastOut);
}

function formatHHMM(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatArabicDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  } catch { return iso; }
}

function formatSyncTime(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ar-SA-u-ca-gregory", { dateStyle: "medium", timeStyle: "short" });
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.charAt(0).toUpperCase();
}

const peoplePrimary = "hsl(var(--primary))";

const AVATAR_COLORS = [
  peoplePrimary, "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444",
  "#06B6D4", "#10B981", "#F97316", "#EC4899", "#6366F1",
  "#84CC16", "#A855F7", "#14B8A6", "#F43F5E", "#0EA5E9",
];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const STATUS_MAP: Record<string, { color: string; bg: string; border: string; label: string; icon: React.ReactNode }> = {
  "Present":  { color: peoplePrimary, bg: "hsl(var(--primary) / .13)",  border: "hsl(var(--primary) / .35)",  label: "حاضر",           icon: <CheckCircle size={11} /> },
  "Absent":   { color: "#EF4444", bg: "rgba(239,68,68,0.13)",   border: "rgba(239,68,68,0.35)",   label: "غائب",           icon: <XCircle size={11} /> },
  "Single Punch": { color: "#F97316", bg: "rgba(249,115,22,0.13)", border: "rgba(249,115,22,0.35)", label: "بصمة واحدة", icon: <AlertTriangle size={11} /> },
  "Weekend":  { color: "#6B7280", bg: "rgba(107,114,128,0.13)", border: "rgba(107,114,128,0.35)", label: "إجازة أسبوعية", icon: <CalendarOff size={11} /> },
  "Holiday":  { color: "#8B5CF6", bg: "rgba(139,92,246,0.13)",  border: "rgba(139,92,246,0.35)",  label: "عطلة رسمية",    icon: <CalendarDays size={11} /> },
  "Leave":    { color: "#F59E0B", bg: "rgba(245,158,11,0.13)",  border: "rgba(245,158,11,0.35)",  label: "إجازة",          icon: <CalendarDays size={11} /> },
  "Half Day": { color: "#3B82F6", bg: "rgba(59,130,246,0.13)",  border: "rgba(59,130,246,0.35)",  label: "نصف يوم",       icon: <Timer size={11} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] || { color: "#9CA3AF", bg: "rgba(156,163,175,0.13)", border: "rgba(156,163,175,0.35)", label: status, icon: null };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700,
      color: cfg.color, background: cfg.bg, padding: "4px 10px",
      borderRadius: "20px", border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function HoursBar({ minutes }: { minutes: number }) {
  const pct = Math.min(100, Math.round((minutes / 480) * 100));
  const color = minutes >= 480 ? peoplePrimary : minutes >= 360 ? "#F59E0B" : minutes > 0 ? "#EF4444" : "#374151";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const label = minutes > 0 ? `${h}:${String(m).padStart(2, "0")}` : "—";
  return (
    <div style={{ minWidth: "90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 800, color }}>{label}</span>
        {minutes > 0 && minutes < 480 && (
          <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "#EF4444", fontWeight: 700 }}>
            -{Math.floor((480 - minutes) / 60)}:{String((480 - minutes) % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      <div style={{ height: "5px", background: "hsl(var(--border))", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: "3px",
          background: color, transition: "width 0.4s ease",
        }} />
      </div>
    </div>
  );
}

// Circular compliance gauge
function ComplianceGauge({ rate, color, size = 70 }: { rate: number; color: string; size?: number }) {
  const r = 15.9;
  const circ = 2 * Math.PI * r;
  const dash = (rate / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)", width: size, height: size }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column",
      }}>
        <span style={{ fontFamily: "Alexandria", fontWeight: 900, fontSize: size > 60 ? "14px" : "11px", color, lineHeight: 1 }}>{rate}%</span>
      </div>
    </div>
  );
}

function parseZohoAttendance(apiData: any): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  if (!apiData || !apiData.records) return records;
  for (const item of apiData.records) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const empList = item[1];
    if (!Array.isArray(empList)) continue;
    for (const empObj of empList) {
      const empDetails = empObj.employeeDetails || {};
      const attDetails = empObj.attendanceDetails || {};
      const empName = `${empDetails["first name"] || ""} ${empDetails["last name"] || ""}`.trim();
      const empId = empDetails.id || empDetails.erecno || "";
      for (const [date, dayData] of Object.entries(attDetails)) {
        const d = dayData as any;
        // Derive status if not explicitly set
        const rawStatus = d.Status || '';
        const rawStatusLower = rawStatus.toLowerCase();
        // Detect leave types: Zoho returns full names like "Annual Leave Request - إجازة سنوية"
        const isLeaveStatus = rawStatusLower.includes('leave') || rawStatusLower.includes('إجازة') || rawStatusLower.includes('half day');
        let derivedStatus = rawStatus;
        if (!derivedStatus || derivedStatus === 'Unknown') {
          const firstIn = d.FirstIn || '';
          if (rawStatus === 'Weekend' || rawStatus === 'Holiday') {
            derivedStatus = rawStatus;
          } else if (firstIn && firstIn !== '-' && firstIn !== '') {
            derivedStatus = 'Present';
          } else if (isLeaveStatus) {
            derivedStatus = 'Leave';
          } else {
            derivedStatus = 'Absent';
          }
        } else if (isLeaveStatus && rawStatus !== 'Weekend' && rawStatus !== 'Holiday') {
          // Normalize all leave variants to 'Leave'
          derivedStatus = 'Leave';
        }
        records.push({
          employeeId: empId,
          employeeName: empName,
          date,
          firstIn: d.FirstIn || "-",
          lastOut: d.LastOut || "-",
          totalHours: d.TotalHours || "00:00",
          status: derivedStatus,
          shiftName: d.ShiftName || "General",
        });
      }
    }
  }
  records.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return a.employeeName.localeCompare(b.employeeName);
  });
  return records;
}

function KpiCard({ icon, label, value, sub, color, highlight }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string; highlight?: boolean;
}) {
  return (
    <div style={{
      background: highlight ? `${color}10` : "hsl(var(--card))",
      border: `1px solid ${highlight ? color + "40" : "hsl(var(--border))"}`,
      borderRadius: "14px", padding: "18px 20px",
      display: "flex", alignItems: "center", gap: "14px",
      transition: "border-color 150ms ease, background-color 150ms ease",
    }}>
      <div style={{
        width: "46px", height: "46px", borderRadius: "12px", flexShrink: 0,
        background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", color,
      }}>
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

const PAGE_SIZE = 25;
type ViewMode = "today" | "table" | "analytics" | "map";
type FilterTab = "الكل" | "حاضر" | "غائب" | "بصمة واحدة" | "إجازة" | "ناقص 8 ساعات";

// Custom tooltip for recharts
const ChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", padding: "8px 14px", fontFamily: "Alexandria", direction: "rtl" }}>
        <p style={{ color: peoplePrimary, fontSize: "11px", fontWeight: 700, marginBottom: "4px" }}>{label || payload[0]?.name}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color || "hsl(var(--foreground))", fontSize: "12px", fontWeight: 800 }}>{p.name}: {p.value}{typeof p.value === "number" && p.name?.includes("%") ? "%" : ""}</p>
        ))}
      </div>
    );
  }
  return null;
};

export default function Attendance() {
  const today = new Date();
  const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = today.toISOString().split("T")[0];

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [data, setData] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSourceReady, setDataSourceReady] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"db" | null>(null);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("الكل");
  const [filterEmployee, setFilterEmployee] = useState("الكل");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("today");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [analyticsSort, setAnalyticsSort] = useState<"attendance" | "compliance" | "hours" | "absent">("attendance");
  const [excelLoading, setExcelLoading] = useState(false);
  // ── Manual Edit Modal State ──
  const [showEditModal, setShowEditModal] = useState(false);
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [editFirstIn, setEditFirstIn] = useState("");
  const [editLastOut, setEditLastOut] = useState("");
  const [editNote, setEditNote] = useState("");

  // ── Selected Date for "Today" view (can pick any day) ──
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  // ── Analysis Period: "week" or "month" ──
  type AnalysisPeriod = "week" | "month";
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>("week");

  // Attendance exemptions
  const [exemptIds, setExemptIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch('/api/attendance/exemptions', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((d: Array<{employeeId?: string; employee_id?: string}>) => {
        if (Array.isArray(d)) setExemptIds(new Set(d.map(e => String(e.employeeId || e.employee_id || ''))));
      })
      .catch(() => {});
  }, []);

  // ── Geo-fenced Check-in State ──
  const [geoStatus, setGeoStatus] = useState<"idle" | "checking" | "inside" | "outside" | "error">("idle");
  const [geoDistance, setGeoDistance] = useState<number | null>(null);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [checkInDone, setCheckInDone] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [activeGeoLocations, setActiveGeoLocations] = useState<Array<{id:string;name:string;latitude:number;longitude:number;radius_meters:number}>>([]);

  // Fetch active geo locations from DB on mount
  useEffect(() => {
    fetch("/api/geo-locations/active", { credentials: "include" })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setActiveGeoLocations(data); })
      .catch(() => {});
  }, []);

  function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Get best GPS reading: collect multiple samples and pick the most accurate
  function getBestPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject({ code: 0 }); return; }
      const readings: GeolocationPosition[] = [];
      let watchId: number;
      const done = (best: GeolocationPosition) => {
        clearTimeout(timer);
        navigator.geolocation.clearWatch(watchId);
        resolve(best);
      };
      const timer = setTimeout(() => {
        navigator.geolocation.clearWatch(watchId);
        if (readings.length > 0) {
          resolve(readings.reduce((a, b) => a.coords.accuracy < b.coords.accuracy ? a : b));
        } else {
          reject({ code: 3 });
        }
      }, 10000);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          readings.push(pos);
          // Accept immediately if accuracy ≤ 20 m
          if (pos.coords.accuracy <= 20) done(pos);
        },
        (err) => { clearTimeout(timer); navigator.geolocation.clearWatch(watchId); reject(err); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  function handleCheckIn() {
    if (!navigator.geolocation) {
      toast.error("المتصفح لا يدعم تحديد الموقع الجغرافي");
      return;
    }
    setGeoStatus("checking");
    setGeoDistance(null);
    setGeoAccuracy(null);
    getBestPosition()
      .then((pos) => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        const accuracy = Math.round(pos.coords.accuracy);
        setGeoAccuracy(accuracy);

        // Use DB locations; fallback to hardcoded company location
        const locations = activeGeoLocations.length > 0
          ? activeGeoLocations
          : [{ id: "default", name: "مقر الشركة", latitude: 24.777044, longitude: 46.683644, radius_meters: 200 }];

        let minDist = Infinity;
        let insideLocation: string | null = null;
        for (const loc of locations) {
          const dist = haversineDistance(userLat, userLng, loc.latitude, loc.longitude);
          if (dist < minDist) minDist = dist;
          if (dist <= loc.radius_meters) { insideLocation = loc.name; break; }
        }

        setGeoDistance(Math.round(minDist));
        if (insideLocation) {
          setGeoStatus("inside");
          const now = new Date().toLocaleTimeString("ar-SA-u-ca-gregory", { hour: "2-digit", minute: "2-digit" });
          setCheckInTime(now);
          setCheckInDone(true);
          toast.success(`تم تسجيل الحضور بنجاح في ${now}`);
        } else {
          setGeoStatus("outside");
          toast.error(`أنت خارج نطاق الشركة — المسافة: ${Math.round(minDist)}م | دقة GPS: ±${accuracy}م`);
        }
      })
      .catch((err: any) => {
        setGeoStatus("error");
        if (err?.code === 1) toast.error("يرجى السماح بالوصول إلى الموقع الجغرافي في إعدادات المتصفح");
        else toast.error("تعذّر تحديد موقعك الجغرافي، حاول مجدداً");
      });
  }

  function parseDBAttendance(records: any[]): AttendanceRecord[] {
    return records.map(r => {
      const checkIn = r.checkIn || r.check_in || '';
      const checkOut = r.checkOut || r.check_out || '';
      const rawStatus = r.status || '';
      const hasCheckIn = checkIn && checkIn !== '-' && checkIn !== '';
      const hasCheckOut = checkOut && checkOut !== '-' && checkOut !== '';
      // Derive status: if employee has any clock-in (single or both), they are NOT absent
      let status = rawStatus;
      if (!status || status === 'Unknown') {
        if (hasCheckIn || hasCheckOut) {
          status = 'Present';
        } else {
          status = 'Absent';
        }
      } else if ((status === 'Absent' || status === '\u063a\u0627\u0626\u0628') && (hasCheckIn || hasCheckOut)) {
        // Single clock-in should NOT count as absence per policy
        status = 'Present';
      }
      return {
        employeeId: r.employeeId || r.employee_id || '',
        employeeName: r.employeeName || r.employee_name || '',
        date: r.date || '',
        firstIn: checkIn || '-',
        lastOut: r.checkOut || r.check_out || '-',
        totalHours: r.hoursWorked != null
          ? `${Math.floor(r.hoursWorked)}:${String(Math.round((r.hoursWorked % 1) * 60)).padStart(2, '0')}`
          : '00:00',
        status,
        shiftName: 'General',
      };
    }).sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
  }

  useEffect(() => {
    fetch("/api/attendance/sync-status", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setDataSourceReady(Boolean(d.success));
        setLastSync(formatSyncTime(d.lastSyncedAt));
      })
      .catch(() => setDataSourceReady(false));
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/synced?from=${fromDate}&to=${toDate}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error || "فشل جلب البيانات المحفوظة");
      const rawRecords = Array.isArray(json) ? json : (json.records || []);
      setLastSync(formatSyncTime(Array.isArray(json) ? null : json.lastSyncedAt));
      const parsed = parseDBAttendance(rawRecords);
      setData(parsed);
      setDataSource("db");
      setPage(1);
      if (parsed.length === 0) toast.info("لا توجد سجلات حضور محفوظة في هذه الفترة");
      else toast.success(`تم تحميل ${parsed.length} سجل من قاعدة بيانات المنصة`);
    } catch (e: any) {
      setError(e.message);
      toast.error("خطأ في الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dataSourceReady !== null) fetchData();
  }, [dataSourceReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const employees = useMemo(() => Array.from(new Set(data.map(r => r.employeeName))).sort(), [data]);

  const stats = useMemo(() => {
    const workdays = data.filter(r => r.status !== "Weekend" && r.status !== "Holiday");
    const present = workdays.filter(r => r.status === "Present");
    const singlePunch = workdays.filter(isSinglePunch);
    // Exempt employees who are absent count as present in stats
    const exemptAbsent = workdays.filter(r => r.status === "Absent" && exemptIds.has(String(r.employeeId)));
    const absent = workdays.filter(r => r.status === "Absent" && !exemptIds.has(String(r.employeeId)) && !isSinglePunch(r)).length;
    const onLeave = workdays.filter(r => r.status === "Leave" || r.status === "Half Day").length;
    const totalMins = present.reduce((s, r) => s + parseHHMM(r.totalHours), 0);
    const avgMins = present.length > 0 ? totalMins / present.length : 0;
    const avgH = Math.floor(avgMins / 60);
    const avgM = Math.round(avgMins % 60);
    // Effective present = actual present + exempt employees (counted as full attendance)
    const effectivePresent = present.length + exemptAbsent.length;
    const eligibleWorkdays = workdays.length - singlePunch.length;
    const rate = eligibleWorkdays > 0 ? Math.round((effectivePresent / eligibleWorkdays) * 100) : 0;
    const under8 = present.filter(r => parseHHMM(r.totalHours) > 0 && parseHHMM(r.totalHours) < 480).length;
    return {
      present: effectivePresent, absent, singlePunch: singlePunch.length, onLeave,
      avgHours: `${avgH}:${String(avgM).padStart(2, "0")}`,
      rate, total: eligibleWorkdays, under8,
    };
  }, [data, exemptIds]);

  // Per-employee analytics
  const employeeSummaries = useMemo((): EmployeeSummary[] => {
    const map: Record<string, {
      id: string; name: string; workdays: number; present: number;
      absent: number; singlePunch: number; leave: number; under8: number; totalMins: number; late: number;
    }> = {};

    data.forEach(r => {
      if (!map[r.employeeName]) {
        map[r.employeeName] = { id: r.employeeId, name: r.employeeName, workdays: 0, present: 0, absent: 0, singlePunch: 0, leave: 0, under8: 0, totalMins: 0, late: 0 };
      }
      const e = map[r.employeeName];
      if (r.status === "Weekend" || r.status === "Holiday") return;
      e.workdays++;
      if (r.status === "Present") {
        e.present++;
        const mins = parseHHMM(r.totalHours);
        e.totalMins += mins;
        if (mins > 0 && mins < 480) e.under8++;
        // Late if check-in after 9:00 AM
        if (r.firstIn && r.firstIn !== "-") {
          const timePart = r.firstIn.split(" ")[1] || r.firstIn;
          const [hStr, mStr] = timePart.split(":");
          const h = parseInt(hStr || "0", 10);
          const m = parseInt(mStr || "0", 10);
          if (h > 9 || (h === 9 && m > 0)) e.late++;
        }
      } else if (r.status === "Absent") {
        if (isSinglePunch(r)) e.singlePunch++;
        else e.absent++;
      } else if (r.status === "Leave" || r.status === "Half Day") {
        e.leave++;
      }
    });

    return Object.values(map).map(e => {
      // Exempt employees always show 100% attendance rate
      const isExemptEmp = exemptIds.has(String(e.id));
      const effectivePresent = isExemptEmp ? e.workdays : e.present;
      const eligibleWorkdays = e.workdays - e.singlePunch;
      const attendanceRate = isExemptEmp ? 100 : (eligibleWorkdays > 0 ? Math.round((e.present / eligibleWorkdays) * 100) : 0);
      const complianceRate = isExemptEmp ? 100 : (e.present > 0 ? Math.round(((e.present - e.under8) / e.present) * 100) : 0);
      const avgHours = e.present > 0 ? Math.round(e.totalMins / e.present) : 0;
      return {
        id: e.id,
        name: e.name,
        totalWorkdays: e.workdays,
        presentDays: effectivePresent,
        absentDays: isExemptEmp ? 0 : e.absent,
        singlePunchDays: e.singlePunch,
        leaveDays: e.leave,
        under8Days: isExemptEmp ? 0 : e.under8,
        attendanceRate,
        complianceRate,
        avgHours,
        totalMinutes: e.totalMins,
        lateCount: isExemptEmp ? 0 : e.late,
        color: getAvatarColor(e.name),
      };
    });
  }, [data, exemptIds]);

  const sortedSummaries = useMemo(() => {
    const s = [...employeeSummaries];
    if (analyticsSort === "attendance") s.sort((a, b) => b.attendanceRate - a.attendanceRate);
    else if (analyticsSort === "compliance") s.sort((a, b) => b.complianceRate - a.complianceRate);
    else if (analyticsSort === "hours") s.sort((a, b) => b.avgHours - a.avgHours);
    else if (analyticsSort === "absent") s.sort((a, b) => b.absentDays - a.absentDays);
    return s;
  }, [employeeSummaries, analyticsSort]);

  const selectedEmpData = useMemo(() => {
    if (!selectedEmployee) return null;
    const summary = employeeSummaries.find(e => e.name === selectedEmployee);
    const records = data.filter(r => r.employeeName === selectedEmployee && r.status !== "Weekend" && r.status !== "Holiday")
      .sort((a, b) => a.date.localeCompare(b.date));
    return { summary, records };
  }, [selectedEmployee, employeeSummaries, data]);

  // Chart data for attendance rate comparison
  const attendanceChartData = useMemo(() => {
    return sortedSummaries.slice(0, 20).map(e => ({
      name: e.name.split(" ").slice(0, 2).join(" "),
      "نسبة الحضور": e.attendanceRate,
      "الالتزام بالساعات": e.complianceRate,
      color: e.color,
    }));
  }, [sortedSummaries]);

  // Daily trend for selected employee
  const empDailyTrend = useMemo(() => {
    if (!selectedEmpData?.records) return [];
    return selectedEmpData.records.slice(-14).map(r => ({
      date: r.date.slice(5),
      ساعات: parseHHMM(r.totalHours) / 60,
      حالة: r.status === "Present" ? 1 : 0,
    }));
  }, [selectedEmpData]);

  const filtered = useMemo(() => {
    let rows = [...data];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => r.employeeName.toLowerCase().includes(q) || r.date.includes(q));
    }
    if (filterEmployee !== "الكل") rows = rows.filter(r => r.employeeName === filterEmployee);
    if (filterTab === "حاضر") rows = rows.filter(r => r.status === "Present");
    else if (filterTab === "غائب") rows = rows.filter(r => r.status === "Absent" && !isSinglePunch(r));
    else if (filterTab === "بصمة واحدة") rows = rows.filter(isSinglePunch);
    else if (filterTab === "إجازة") rows = rows.filter(r => r.status === "Leave" || r.status === "Half Day");
    else if (filterTab === "ناقص 8 ساعات") rows = rows.filter(r => r.status === "Present" && parseHHMM(r.totalHours) > 0 && parseHHMM(r.totalHours) < 480);
    return rows;
  }, [data, search, filterEmployee, filterTab]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const TABS: { key: FilterTab; label: string; color: string }[] = [
    { key: "الكل",          label: "الكل",          color: peoplePrimary },
    { key: "حاضر",          label: "حاضر",          color: peoplePrimary },
    { key: "غائب",          label: "غائب",          color: "#EF4444" },
    { key: "بصمة واحدة",   label: "بصمة واحدة",    color: "#F97316" },
    { key: "إجازة",         label: "إجازة",         color: "#F59E0B" },
    { key: "ناقص 8 ساعات", label: "ناقص 8 ساعات", color: "#F97316" },
  ];

  const TEAL = peoplePrimary;

  // ── Selected day's attendance data (default: today) ──
  const todayStr = new Date().toISOString().split("T")[0];
  const selectedDayRecords = useMemo(() => {
    return data.filter(r => r.date === selectedDate);
  }, [data, selectedDate]);
  // Keep todayRecords for badge on tab
  const todayRecords = useMemo(() => data.filter(r => r.date === todayStr), [data, todayStr]);

  const todayStats = useMemo(() => {
    const present = todayRecords.filter(r => r.status === "Present");
    const absentAll = todayRecords.filter(r => r.status === "Absent");
    const singlePunch = absentAll.filter(isSinglePunch);
    const exemptAbsent = absentAll.filter(r => exemptIds.has(String(r.employeeId)));
    const absent = absentAll.filter(r => !exemptIds.has(String(r.employeeId)) && !isSinglePunch(r));
    const onLeave = todayRecords.filter(r => r.status === "Leave" || r.status === "Half Day");
    const total = todayRecords.filter(r => r.status !== "Weekend" && r.status !== "Holiday" && !isSinglePunch(r));
    const effectivePresent = present.length + exemptAbsent.length;
    const rate = total.length > 0 ? Math.round((effectivePresent / total.length) * 100) : 0;
    return { present: effectivePresent, absent: absent.length, singlePunch: singlePunch.length, onLeave: onLeave.length, total: total.length, rate };
  }, [todayRecords, exemptIds]);

  // Stats for the selected day
  const selectedDayStats = useMemo(() => {
    const present = selectedDayRecords.filter(r => r.status === "Present");
    const absentAll = selectedDayRecords.filter(r => r.status === "Absent");
    const singlePunch = absentAll.filter(isSinglePunch);
    const exemptAbsent = absentAll.filter(r => exemptIds.has(String(r.employeeId)));
    const absent = absentAll.filter(r => !exemptIds.has(String(r.employeeId)) && !isSinglePunch(r));
    const onLeave = selectedDayRecords.filter(r => r.status === "Leave" || r.status === "Half Day");
    const total = selectedDayRecords.filter(r => r.status !== "Weekend" && r.status !== "Holiday" && !isSinglePunch(r));
    const effectivePresent = present.length + exemptAbsent.length;
    const rate = total.length > 0 ? Math.round((effectivePresent / total.length) * 100) : 0;
    return { present: effectivePresent, absent: absent.length, singlePunch: singlePunch.length, onLeave: onLeave.length, total: total.length, rate };
  }, [selectedDayRecords, exemptIds]);

  // ── Analysis: Week-to-date and Month-to-date per employee ──
  const analysisData = useMemo(() => {
    const now = new Date();
    // Week start (Saturday)
    const dayOfWeek = now.getDay();
    const daysSinceSat = (dayOfWeek + 1) % 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceSat);
    const weekStartStr = weekStart.toISOString().split("T")[0];
    // Month start
    const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const todayISO = now.toISOString().split("T")[0];

    const startStr = analysisPeriod === "week" ? weekStartStr : monthStartStr;
    const periodRecords = data.filter(r => r.date >= startStr && r.date <= todayISO && r.status !== "Weekend" && r.status !== "Holiday");

    // Aggregate per employee
    const empMap: Record<string, { name: string; id: string; workDays: number; presentDays: number; absentDays: number; singlePunchDays: number; leaveDays: number; totalMins: number; under8: number }> = {};
    periodRecords.forEach(r => {
      if (!empMap[r.employeeName]) {
        empMap[r.employeeName] = { name: r.employeeName, id: r.employeeId, workDays: 0, presentDays: 0, absentDays: 0, singlePunchDays: 0, leaveDays: 0, totalMins: 0, under8: 0 };
      }
      const e = empMap[r.employeeName];
      e.workDays++;
      if (r.status === "Present") {
        e.presentDays++;
        const mins = parseHHMM(r.totalHours);
        e.totalMins += mins;
        if (mins > 0 && mins < 480) e.under8++;
      } else if (r.status === "Absent") {
        if (isSinglePunch(r)) e.singlePunchDays++;
        else if (!exemptIds.has(String(r.employeeId))) e.absentDays++;
        else e.presentDays++; // exempt counts as present
      } else if (r.status === "Leave" || r.status === "Half Day") {
        e.leaveDays++;
      }
    });

    const employees = Object.values(empMap).map(e => ({
      ...e,
      avgMins: e.presentDays > 0 ? Math.round(e.totalMins / e.presentDays) : 0,
      attendanceRate: e.workDays - e.singlePunchDays > 0 ? Math.round((e.presentDays / (e.workDays - e.singlePunchDays)) * 100) : 0,
      complianceRate: e.presentDays > 0 ? Math.round(((e.presentDays - e.under8) / e.presentDays) * 100) : 0,
    }));

    // Overall summary
    const totalWorkDays = employees.reduce((s, e) => s + e.workDays, 0);
    const totalPresent = employees.reduce((s, e) => s + e.presentDays, 0);
    const totalAbsent = employees.reduce((s, e) => s + e.absentDays, 0);
    const totalSinglePunch = employees.reduce((s, e) => s + e.singlePunchDays, 0);
    const totalMins = employees.reduce((s, e) => s + e.totalMins, 0);
    const avgMinsAll = totalPresent > 0 ? Math.round(totalMins / totalPresent) : 0;
    const overallRate = totalWorkDays > 0 ? Math.round((totalPresent / totalWorkDays) * 100) : 0;
    const totalUnder8 = employees.reduce((s, e) => s + e.under8, 0);

    return {
      periodLabel: analysisPeriod === "week" ? "من بداية الأسبوع" : "من بداية الشهر",
      startStr,
      endStr: todayISO,
      totalEmployees: employees.length,
      totalWorkDays,
      totalPresent,
      totalAbsent,
      totalSinglePunch,
      totalMins,
      avgMinsAll,
      overallRate,
      totalUnder8,
      employees: employees.sort((a, b) => b.attendanceRate - a.attendanceRate),
    };
  }, [data, analysisPeriod, exemptIds]);

  return (
    <PageTemplate title="الحضور والانصراف" subtitle="سجلات الحضور اليومية المحفوظة في المنصة" icon={Clock}>

      {/* ── Connection & Date Controls ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px", direction: "rtl", flexWrap: "wrap", gap: "12px",
        background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
        borderRadius: "14px", padding: "14px 18px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {dataSourceReady === null ? (
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>جارٍ التحقق من السجلات المحفوظة...</span>
          ) : dataSourceReady ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "Alexandria", fontSize: "12px", color: "#1FA98C", background: "hsl(165 69% 39% / 0.10)", padding: "5px 12px", borderRadius: "20px", border: "1px solid hsl(165 69% 39% / 0.25)" }}>
                <Wifi size={13} /> سجلات المنصة الداخلية جاهزة
              </span>
              {lastSync && <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>آخر تحديث: {lastSync}</span>}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "Alexandria", fontSize: "12px", color: "#F59E0B", background: "rgba(245,158,11,0.08)", padding: "5px 12px", borderRadius: "20px", border: "1px solid rgba(245,158,11,0.2)" }}>
                <WifiOff size={13} /> تعذر التحقق من سجلات الحضور الداخلية
              </span>
              {dataSource === "db" && data.length > 0 && (
                <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>من قاعدة البيانات ({data.length} سجل){lastSync ? ` · آخر مزامنة: ${lastSync}` : ""}</span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>من</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "6px 10px", fontFamily: "Alexandria", fontSize: "12px", outline: "none" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>إلى</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "6px 10px", fontFamily: "Alexandria", fontSize: "12px", outline: "none" }} />
          </div>
          <button onClick={fetchData} disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "#1FA98C", color: "white",
              border: "none", borderRadius: "9px", padding: "8px 18px",
              fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1, transition: "border-color 150ms ease, background-color 150ms ease",
            }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {loading ? "جارٍ الجلب..." : "تحديث البيانات"}
          </button>
          <button
            onClick={() => { if (!data.length) { toast.error("لا توجد بيانات للتصدير"); return; } exportAttendance(data, `${fromDate} إلى ${toDate}`); toast.success("جارٍ تحميل ملف Excel..."); }}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: "hsl(var(--border))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))", borderRadius: "9px", padding: "8px 14px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "border-color 150ms ease, background-color 150ms ease" }}
          >
            <Download size={13} />تصدير Excel
          </button>
          <button
            onClick={() => { if (!data.length) { toast.error("لا توجد بيانات للتصدير"); return; } exportAttendanceByDepartment(data, `${fromDate} إلى ${toDate}`); toast.success("جارس تحميل تقرير الإدارات..."); }}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C", border: "1px solid hsl(165 69% 39% / 0.30)", borderRadius: "9px", padding: "8px 14px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "border-color 150ms ease, background-color 150ms ease" }}
          >
            <Download size={13} />تقرير حسب الإدارة
          </button>
          <button
            disabled={excelLoading}
            onClick={async () => {
              const month = fromDate.slice(0, 7);
              setExcelLoading(true);
              toast.success("جارس تحضير التقرير الاحترافي...");
              try {
                const resp = await fetch(`/api/admin/attendance-excel?month=${month}`, { credentials: 'include' });
                if (!resp.ok) { const err = await resp.json(); toast.error(`خطأ: ${err.error || resp.statusText}`); return; }
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `تقرير_الحضور_والانصراف_${month}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast.success("تم تحميل التقرير بنجاح ✅");
              } catch (e: any) {
                toast.error(`فشل تحميل التقرير: ${e.message}`);
              } finally {
                setExcelLoading(false);
              }
            }}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: excelLoading ? "#666" : "hsl(var(--primary))", color: "white", border: "none", borderRadius: "9px", padding: "8px 14px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: excelLoading ? "not-allowed" : "pointer", transition: "border-color 150ms ease, background-color 150ms ease", boxShadow: "0 2px 8px hsl(var(--primary) / 0.3)", opacity: excelLoading ? 0.7 : 1 }}
          >
            <Download size={13} style={{ animation: excelLoading ? "spin 1s linear infinite" : "none" }} />
            {excelLoading ? "جارس التحضير..." : "تقرير احترافي شامل"}
          </button>
          <button
            onClick={() => { setEditRecord(null); setEditFirstIn(""); setEditLastOut(""); setEditNote(""); setShowEditModal(true); }}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(139,92,246,0.12)", color: "#8B5CF6", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "9px", padding: "8px 14px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "border-color 150ms ease, background-color 150ms ease" }}
          >
            <Clock size={13} />تسجيل يدوي
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", fontFamily: "Alexandria", fontSize: "13px", color: "#EF4444", direction: "rtl" }}>
          ⚠️ {error}
        </div>
      )}

      {!loading && dataSourceReady && data.length === 0 && dataSource === "db" && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
          <WifiOff size={52} style={{ margin: "0 auto 16px", opacity: 0.25 }} />
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>لا توجد بيانات محفوظة لهذه الفترة</div>
          <div style={{ fontSize: "13px" }}>اختر نطاق تاريخ آخر أو تحقق من عملية المزامنة الداخلية.</div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
          <RefreshCw size={40} style={{ margin: "0 auto 16px", animation: "spin 1s linear infinite", opacity: 0.5 }} />
          <div style={{ fontSize: "14px" }}>جارٍ تحميل سجلات الحضور المحفوظة في المنصة...</div>
        </div>
      )}

      {!loading && data.length > 0 && (
        <>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "22px", direction: "rtl" }}>
            <KpiCard icon={<Users size={20} />}           label="إجمالي أيام العمل"  value={stats.total}                     color="#1FA98C" />
            <KpiCard icon={<CheckCircle size={20} />}     label="أيام الحضور"        value={stats.present}                   color="#1FA98C" />
            <KpiCard icon={<XCircle size={20} />}         label="أيام الغياب"        value={stats.absent}                    color="#EF4444" />
            <KpiCard icon={<CalendarDays size={20} />}    label="أيام الإجازة"       value={stats.onLeave}                   color="#F59E0B" />
            <KpiCard icon={<Timer size={20} />}           label="متوسط ساعات العمل" value={stats.avgHours} sub="ساعة يومياً" color="#3B82F6" />
            <KpiCard icon={<TrendingUp size={20} />}      label="نسبة الحضور"        value={`${stats.rate}%`}                color="#8B5CF6" />
            <KpiCard icon={<AlertTriangle size={20} />}   label="ناقص 8 ساعات"      value={stats.under8} sub="موظف حاضر"    color="#F97316" highlight={stats.under8 > 0} />
          </div>

          {stats.under8 > 0 && (
            <div style={{
              background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)",
              borderRadius: "12px", padding: "12px 18px", marginBottom: "16px",
              display: "flex", alignItems: "center", gap: "10px", direction: "rtl",
            }}>
              <AlertTriangle size={18} style={{ color: "#F97316", flexShrink: 0 }} />
              <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#F97316" }}>
                {stats.under8} موظف أمضى أقل من 8 ساعات عمل
              </span>
              <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
                — اضغط على تبويب "ناقص 8 ساعات" لعرضهم
              </span>
            </div>
          )}

          {/* ── View Mode Toggle ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", direction: "rtl", flexWrap: "wrap" }}>
            {[
              { id: "today" as ViewMode, label: "دوام اليوم", icon: <UserCheck size={14} /> },
              { id: "table" as ViewMode, label: "جدول السجلات", icon: <BarChart3 size={14} /> },
              { id: "analytics" as ViewMode, label: "تحليل الموظفين", icon: <PieChart size={14} /> },
              { id: "map" as ViewMode, label: "موقع الشركة", icon: <MapPin size={14} /> },
            ].map(v => (
              <button key={v.id} onClick={() => setViewMode(v.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "8px 18px", borderRadius: "10px",
                  fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700,
                  cursor: "pointer", transition: "all 0.15s",
                  background: viewMode === v.id ? TEAL : "hsl(var(--card))",
                  color: viewMode === v.id ? "white" : "hsl(var(--muted-foreground))",
                  border: viewMode === v.id ? `1px solid ${TEAL}` : "1px solid hsl(var(--border))",
                  position: "relative",
                }}>
                {v.icon}{v.label}
                {v.id === "today" && todayStats.total > 0 && (
                  <span style={{
                    position: "absolute", top: "-6px", left: "-6px",
                    background: todayStats.rate >= 80 ? peoplePrimary : todayStats.rate >= 60 ? "#F59E0B" : "#EF4444",
                    color: "white", borderRadius: "50%", width: "18px", height: "18px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "Alexandria", fontSize: "9px", fontWeight: 900,
                  }}>{todayStats.rate}%</span>
                )}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════ */}
          {/* ── TODAY VIEW ── */}
          {/* ══════════════════════════════ */}
          {viewMode === "today" && (
            <div style={{ direction: "rtl" }}>
              {/* ── Date Picker Header ── */}
              <div style={{
                background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                borderRadius: "14px", padding: "16px 20px", marginBottom: "16px",
                display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "hsl(165 69% 39% / 0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Clock size={22} color="#1FA98C" />
                  </div>
                  <div>
                    <div style={{ fontFamily: "Alexandria", fontWeight: 900, fontSize: "16px", color: "hsl(var(--foreground))" }}>
                      {new Date(selectedDate + "T00:00:00").toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                    </div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
                      {selectedDate} {selectedDate === todayStr && "• تحديث تلقائي كل 5 دقائق"}
                    </div>
                  </div>
                </div>
                {/* Date Picker */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", fontWeight: 700 }}>اختر اليوم:</label>
                    <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "7px 12px", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, outline: "none" }} />
                  </div>
                  <button onClick={() => setSelectedDate(todayStr)}
                    style={{
                      padding: "7px 14px", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                      background: selectedDate === todayStr ? TEAL : "hsl(var(--muted))",
                      color: selectedDate === todayStr ? "white" : "hsl(var(--muted-foreground))",
                      border: selectedDate === todayStr ? `1px solid ${TEAL}` : "1px solid hsl(var(--border))",
                    }}>
                    اليوم
                  </button>
                </div>
              </div>

              {/* Selected Day KPIs */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                  {[
                    { label: "حاضر", value: selectedDayStats.present, color: peoplePrimary, bg: "hsl(var(--primary) / .12)" },
                    { label: "غائب", value: selectedDayStats.absent, color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
                    { label: "بصمة واحدة", value: selectedDayStats.singlePunch, color: "#F97316", bg: "rgba(249,115,22,0.12)" },
                    { label: "إجازة", value: selectedDayStats.onLeave, color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
                  { label: "نسبة الحضور", value: `${selectedDayStats.rate}%`, color: selectedDayStats.rate >= 80 ? peoplePrimary : selectedDayStats.rate >= 60 ? "#F59E0B" : "#EF4444", bg: selectedDayStats.rate >= 80 ? "hsl(var(--primary) / .12)" : selectedDayStats.rate >= 60 ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)" },
                ].map(k => (
                  <div key={k.label} style={{ background: k.bg, borderRadius: "10px", padding: "12px 18px", textAlign: "center", minWidth: "80px", flex: "1" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "22px", fontWeight: 900, color: k.color, lineHeight: 1 }}>{k.value}</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Attendance Rate Bar */}
              {selectedDayStats.total > 0 && (
                <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", padding: "14px 18px", marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>نسبة الحضور</span>
                    <span style={{ fontFamily: "Alexandria", fontSize: "16px", fontWeight: 900, color: selectedDayStats.rate >= 80 ? peoplePrimary : selectedDayStats.rate >= 60 ? "#F59E0B" : "#EF4444" }}>{selectedDayStats.rate}%</span>
                  </div>
                  <div style={{ height: "10px", background: "hsl(var(--border))", borderRadius: "5px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: "5px", transition: "width 0.6s ease",
                      width: `${selectedDayStats.rate}%`,
                      background: selectedDayStats.rate >= 80 ? peoplePrimary : selectedDayStats.rate >= 60 ? "#F59E0B" : "#EF4444",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                    <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>{selectedDayStats.present} حاضر من {selectedDayStats.total} موظف</span>
                    <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>الهدف: 100%</span>
                  </div>
                </div>
              )}

              {/* ═══ تحليل الدوام (Analysis Panel) ═══ */}
              <div style={{
                background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                borderRadius: "14px", padding: "20px", marginBottom: "20px",
              }}>
                {/* Period Toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <BarChart3 size={18} color={TEAL} />
                    <span style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "15px", color: "hsl(var(--foreground))" }}>تحليل الدوام</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => setAnalysisPeriod("week")}
                      style={{
                        padding: "7px 16px", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700,
                        cursor: "pointer", transition: "all 0.15s",
                        background: analysisPeriod === "week" ? TEAL : "hsl(var(--muted))",
                        color: analysisPeriod === "week" ? "white" : "hsl(var(--muted-foreground))",
                        border: analysisPeriod === "week" ? `1px solid ${TEAL}` : "1px solid hsl(var(--border))",
                      }}>
                      من بداية الأسبوع
                    </button>
                    <button onClick={() => setAnalysisPeriod("month")}
                      style={{
                        padding: "7px 16px", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700,
                        cursor: "pointer", transition: "all 0.15s",
                        background: analysisPeriod === "month" ? TEAL : "hsl(var(--muted))",
                        color: analysisPeriod === "month" ? "white" : "hsl(var(--muted-foreground))",
                        border: analysisPeriod === "month" ? `1px solid ${TEAL}` : "1px solid hsl(var(--border))",
                      }}>
                      من بداية الشهر
                    </button>
                  </div>
                </div>

                {/* Period Info */}
                <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", marginBottom: "14px" }}>
                  الفترة: {analysisData.startStr} — {analysisData.endStr} • {analysisData.totalEmployees} موظف
                </div>

                {/* Summary KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "18px" }}>
                  <div style={{ background: "hsl(165 69% 39% / 0.08)", borderRadius: "10px", padding: "12px", textAlign: "center", border: "1px solid hsl(165 69% 39% / 0.20)" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "22px", fontWeight: 900, color: peoplePrimary, lineHeight: 1 }}>{analysisData.overallRate}%</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>نسبة الحضور الإجمالية</div>
                  </div>
                  <div style={{ background: "rgba(59,130,246,0.08)", borderRadius: "10px", padding: "12px", textAlign: "center", border: "1px solid rgba(59,130,246,0.20)" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "22px", fontWeight: 900, color: "#3B82F6", lineHeight: 1 }}>{formatHHMM(analysisData.avgMinsAll)}</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>متوسط الساعات اليومي</div>
                  </div>
                  <div style={{ background: "rgba(239,68,68,0.08)", borderRadius: "10px", padding: "12px", textAlign: "center", border: "1px solid rgba(239,68,68,0.20)" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "22px", fontWeight: 900, color: "#EF4444", lineHeight: 1 }}>{analysisData.totalAbsent}</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>إجمالي الغيابات</div>
                  </div>
                  <div style={{ background: "rgba(249,115,22,0.08)", borderRadius: "10px", padding: "12px", textAlign: "center", border: "1px solid rgba(249,115,22,0.20)" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "22px", fontWeight: 900, color: "#F97316", lineHeight: 1 }}>{analysisData.totalSinglePunch}</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>بصمة واحدة</div>
                  </div>
                  <div style={{ background: "rgba(249,115,22,0.08)", borderRadius: "10px", padding: "12px", textAlign: "center", border: "1px solid rgba(249,115,22,0.20)" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "22px", fontWeight: 900, color: "#F97316", lineHeight: 1 }}>{analysisData.totalUnder8}</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>ناقص 8 ساعات</div>
                  </div>
                </div>

                {/* Employee Analysis Table */}
                {analysisData.employees.length > 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Alexandria", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <th style={{ padding: "10px 12px", textAlign: "right", color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: "11px" }}>الموظف</th>
                          <th style={{ padding: "10px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: "11px" }}>أيام الحضور</th>
                          <th style={{ padding: "10px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: "11px" }}>الغياب</th>
                          <th style={{ padding: "10px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: "11px" }}>إجمالي الساعات</th>
                          <th style={{ padding: "10px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: "11px" }}>متوسط يومي</th>
                          <th style={{ padding: "10px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: "11px" }}>نسبة الحضور</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysisData.employees.map((emp, idx) => {
                          const avatarColor = getAvatarColor(emp.name);
                          const rateColor = emp.attendanceRate >= 80 ? "#1FA98C" : emp.attendanceRate >= 60 ? "#F59E0B" : "#EF4444";
                          return (
                            <tr key={emp.id || emp.name} style={{ borderBottom: "1px solid hsl(var(--muted))", background: idx % 2 === 0 ? "transparent" : "hsl(var(--card))" }}>
                              <td style={{ padding: "10px 12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <div style={{ width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0, background: `${avatarColor}20`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Alexandria", fontSize: "10px", fontWeight: 800, color: avatarColor, border: `1.5px solid ${avatarColor}40` }}>
                                    {getInitials(emp.name)}
                                  </div>
                                  <span style={{ fontWeight: 700, color: "hsl(var(--foreground))", fontSize: "12px", whiteSpace: "nowrap" }}>{emp.name}</span>
                                </div>
                              </td>
                              <td style={{ padding: "10px 8px", textAlign: "center", color: "#1FA98C", fontWeight: 800 }}>{emp.presentDays}/{emp.workDays}</td>
                              <td style={{ padding: "10px 8px", textAlign: "center", color: emp.absentDays > 0 ? "#EF4444" : "hsl(var(--muted-foreground))", fontWeight: 800 }}>{emp.absentDays}</td>
                              <td style={{ padding: "10px 8px", textAlign: "center", color: "hsl(var(--foreground))", fontWeight: 700 }}>{formatHHMM(emp.totalMins)}</td>
                              <td style={{ padding: "10px 8px", textAlign: "center", color: emp.avgMins >= 480 ? "#1FA98C" : emp.avgMins >= 360 ? "#F59E0B" : "#EF4444", fontWeight: 800 }}>{formatHHMM(emp.avgMins)}</td>
                              <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: "20px", fontWeight: 800, fontSize: "11px", color: rateColor, background: `${rateColor}15`, border: `1px solid ${rateColor}35` }}>
                                  {emp.attendanceRate}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {analysisData.employees.length === 0 && (
                  <div style={{ textAlign: "center", padding: "30px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria", fontSize: "13px" }}>
                    لا توجد بيانات كافية لهذه الفترة — تأكد من تحديث البيانات بنطاق يشمل الفترة المطلوبة
                  </div>
                )}
              </div>

              {/* Employee Cards Grid */}
              {selectedDayRecords.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
                  <Clock size={48} style={{ margin: "0 auto 16px", opacity: 0.2 }} />
                  <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>لا توجد بيانات لهذا اليوم</div>
                  <div style={{ fontSize: "12px" }}>اضغط «تحديث البيانات» لجلب سجلات اليوم أو اختر يوماً آخر</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                  {[...selectedDayRecords]
                    .filter(r => r.status !== "Weekend" && r.status !== "Holiday")
                    .sort((a, b) => {
                      // Sort: Present first, then Leave, then Absent
                      const order: Record<string, number> = { Present: 0, "Half Day": 1, Leave: 2, Absent: 3 };
                      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
                    })
                    .map((r, idx) => {
                      const isPresent = r.status === "Present";
                      const isAbsentInZoho = r.status === "Absent";
                      const isExempt = isAbsentInZoho && exemptIds.has(String(r.employeeId));
                      const isAbsent = isAbsentInZoho && !isExempt;
                      const isLeave = r.status === "Leave" || r.status === "Half Day";
                      const avatarColor = getAvatarColor(r.employeeName);
                      const statusCfg = STATUS_MAP[r.status] || STATUS_MAP["Absent"];
                      const mins = parseHHMM(r.totalHours);
                      const isUnder8 = isPresent && mins > 0 && mins < 480;
                      const cardBg = isPresent ? "hsl(165 69% 39% / 0.06)" : isExempt ? "rgba(139,92,246,0.06)" : isAbsent ? "rgba(239,68,68,0.06)" : isLeave ? "rgba(245,158,11,0.06)" : "hsl(var(--card))";
                      const cardBorder = isPresent ? "hsl(165 69% 39% / 0.30)" : isExempt ? "rgba(139,92,246,0.25)" : isAbsent ? "rgba(239,68,68,0.25)" : isLeave ? "rgba(245,158,11,0.25)" : "hsl(var(--border))";
                      return (
                        <div key={`${r.employeeId}-today-${idx}`} style={{
                          background: cardBg, border: `1px solid ${cardBorder}`,
                          borderRadius: "14px", padding: "16px",
                          transition: "border-color 150ms ease, background-color 150ms ease",
                        }}>
                          {/* Employee Header */}
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                            <div style={{
                              width: "44px", height: "44px", borderRadius: "50%", flexShrink: 0,
                              background: `${avatarColor}20`, display: "flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "Alexandria", fontSize: "14px", fontWeight: 900, color: avatarColor,
                              border: `2px solid ${avatarColor}40`,
                            }}>
                              {getInitials(r.employeeName)}
                            </div>
                            <div style={{ flex: 1, overflow: "hidden" }}>
                              <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "13px", color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {r.employeeName}
                              </div>
                              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
                                #{r.employeeId} • {r.shiftName}
                              </div>
                            </div>
                            {isExempt ? (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: "4px",
                                fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700,
                                color: "#8B5CF6", background: "rgba(139,92,246,0.13)", padding: "4px 10px",
                                borderRadius: "20px", border: "1px solid rgba(139,92,246,0.35)",
                              }}>مستثنى</span>
                            ) : (
                              <StatusBadge status={isSinglePunch(r) ? "Single Punch" : r.status} />
                            )}
                          </div>

                          {/* Attendance Details */}
                          {isPresent && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                              <div style={{ background: "hsl(165 69% 39% / 0.10)", borderRadius: "10px", padding: "10px 12px", border: "1px solid hsl(165 69% 39% / 0.20)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "3px" }}>
                                  <LogIn size={12} color="#1FA98C" />
                                  <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>وقت الدخول</span>
                                </div>
                                <div style={{ fontFamily: "Alexandria", fontSize: "18px", fontWeight: 900, color: "#1FA98C", lineHeight: 1 }}>
                                  {r.firstIn !== "-" ? r.firstIn : "—"}
                                </div>
                              </div>
                              <div style={{ background: "hsl(var(--card))", borderRadius: "10px", padding: "10px 12px", border: "1px solid hsl(var(--border))" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "3px" }}>
                                  <LogOut size={12} color="hsl(var(--muted-foreground))" />
                                  <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>وقت الخروج</span>
                                </div>
                                <div style={{ fontFamily: "Alexandria", fontSize: "18px", fontWeight: 900, color: "hsl(var(--muted-foreground))", lineHeight: 1 }}>
                                  {r.lastOut !== "-" ? r.lastOut : "—"}
                                </div>
                              </div>
                            </div>
                          )}

                          {isExempt && (
                            <div style={{ background: "rgba(139,92,246,0.08)", borderRadius: "10px", padding: "12px", border: "1px solid rgba(139,92,246,0.20)", textAlign: "center" }}>
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "#8B5CF6", fontWeight: 700 }}>مستثنى من البصمة الجغرافية</div>
                            </div>
                          )}

                          {isAbsent && (
                            <div style={{ background: "rgba(239,68,68,0.08)", borderRadius: "10px", padding: "12px", border: "1px solid rgba(239,68,68,0.20)", textAlign: "center" }}>
                              <XCircle size={20} style={{ color: "#EF4444", margin: "0 auto 6px" }} />
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "#EF4444", fontWeight: 700 }}>لم يسجّل حضوراً اليوم</div>
                            </div>
                          )}

                          {isLeave && (
                            <div style={{ background: "rgba(245,158,11,0.08)", borderRadius: "10px", padding: "12px", border: "1px solid rgba(245,158,11,0.20)", textAlign: "center" }}>
                              <CalendarDays size={20} style={{ color: "#F59E0B", margin: "0 auto 6px" }} />
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "#F59E0B", fontWeight: 700 }}>في إجازة</div>
                            </div>
                          )}

                          {/* Hours Bar for present employees */}
                          {isPresent && mins > 0 && (
                            <div style={{ marginTop: "8px" }}>
                              <HoursBar minutes={mins} />
                              {isUnder8 && (
                                <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "5px" }}>
                                  <AlertTriangle size={11} color="#F97316" />
                                  <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "#F97316", fontWeight: 700 }}>أقل من 8 ساعات</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════ */}
          {/* ── ANALYTICS VIEW ── */}
          {/* ══════════════════════════════ */}
          {viewMode === "analytics" && (
            <div style={{ direction: "rtl" }}>

              {/* Sort controls */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>ترتيب حسب:</span>
                {[
                  { key: "attendance" as const, label: "نسبة الحضور" },
                  { key: "compliance" as const, label: "الالتزام بالساعات" },
                  { key: "hours" as const, label: "متوسط الساعات" },
                  { key: "absent" as const, label: "أيام الغياب" },
                ].map(s => (
                  <button key={s.key} onClick={() => setAnalyticsSort(s.key)}
                    style={{
                      padding: "5px 12px", borderRadius: "20px",
                      fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                      background: analyticsSort === s.key ? TEAL : "hsl(var(--muted))",
                      color: analyticsSort === s.key ? "white" : "hsl(var(--muted-foreground))",
                      border: analyticsSort === s.key ? `1px solid ${TEAL}` : "1px solid hsl(var(--border))",
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>

              {/* ── Attendance Rate Bar Chart ── */}
              <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "14px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                  <BarChart3 size={16} color={TEAL} />
                  <span style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(var(--foreground))" }}>
                    مقارنة نسب الحضور والالتزام لكل موظف
                  </span>
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginRight: "auto" }}>
                    يعرض أول 20 موظف
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={attendanceChartData} margin={{ top: 10, right: 10, left: -20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={(props: any) => {
                        const { x, y, payload } = props;
                        const words = (payload.value || "").split(" ");
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text x={0} y={0} dy={14} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontFamily="Alexandria" fontSize={9}>
                              {words[0]}
                            </text>
                            {words[1] && (
                              <text x={0} y={0} dy={26} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontFamily="Alexandria" fontSize={9}>
                                {words[1]}
                              </text>
                            )}
                          </g>
                        );
                      }}
                      interval={0} height={80}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontFamily: "Alexandria", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="نسبة الحضور" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={20}>
                      {attendanceChartData.map((entry, i) => (
                        <Cell key={i} fill={entry["نسبة الحضور"] >= 80 ? TEAL : entry["نسبة الحضور"] >= 60 ? "#F59E0B" : "#EF4444"} />
                      ))}
                    </Bar>
                    <Bar dataKey="الالتزام بالساعات" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={20}>
                      {attendanceChartData.map((entry, i) => (
                        <Cell key={i} fill={entry["الالتزام بالساعات"] >= 80 ? "#3B82F6" : entry["الالتزام بالساعات"] >= 60 ? "#8B5CF6" : "#F97316"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: "20px", justifyContent: "center", marginTop: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: TEAL }} />
                    <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>نسبة الحضور</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#3B82F6" }} />
                    <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>الالتزام بالساعات</span>
                  </div>
                </div>
              </div>

              {/* ── Employee Cards Grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                {sortedSummaries.map((emp, idx) => {
                  const attColor = emp.attendanceRate >= 80 ? "#1FA98C" : emp.attendanceRate >= 60 ? "#F59E0B" : "#EF4444";
                  const compColor = emp.complianceRate >= 80 ? "#3B82F6" : emp.complianceRate >= 60 ? "#8B5CF6" : "#F97316";
                  const isSelected = selectedEmployee === emp.name;
                  return (
                    <div
                      key={emp.name}
                      onClick={() => setSelectedEmployee(isSelected ? null : emp.name)}
                      style={{
                        background: isSelected ? `${emp.color}12` : "hsl(var(--card))",
                        border: `1px solid ${isSelected ? emp.color + "50" : "hsl(var(--border))"}`,
                        borderRadius: "14px", padding: "16px",
                        cursor: "pointer", transition: "border-color 150ms ease, background-color 150ms ease",
                        boxShadow: isSelected ? `0 0 20px ${emp.color}20` : "none",
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = emp.color + "40"; }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--border))"; }}
                    >
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
                        <div style={{
                          width: "44px", height: "44px", borderRadius: "50%", flexShrink: 0,
                          background: `${emp.color}20`, display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "Alexandria", fontSize: "14px", fontWeight: 900, color: emp.color,
                          border: `2px solid ${emp.color}40`,
                        }}>
                          {getInitials(emp.name)}
                        </div>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "13px", color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</div>
                          <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
                            {emp.totalWorkdays} يوم عمل • {emp.presentDays} حضور
                          </div>
                        </div>
                        {/* Rank badge */}
                        <div style={{
                          width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0,
                          background: idx === 0 ? "#F59E0B20" : "hsl(var(--border))",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "Alexandria", fontSize: "10px", fontWeight: 900,
                          color: idx === 0 ? "#F59E0B" : "hsl(var(--muted-foreground))",
                        }}>
                          {idx + 1}
                        </div>
                      </div>

                      {/* Gauges Row */}
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
                        <div style={{ textAlign: "center" }}>
                          <ComplianceGauge rate={emp.attendanceRate} color={attColor} size={64} />
                          <div style={{ fontFamily: "Alexandria", fontSize: "9px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>نسبة الحضور</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <ComplianceGauge rate={emp.complianceRate} color={compColor} size={64} />
                          <div style={{ fontFamily: "Alexandria", fontSize: "9px", color: "hsl(var(--muted-foreground))", marginTop: "4px" }}>الالتزام بالساعات</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          {/* Stats mini grid */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                            {[
                              { label: "غياب", value: emp.absentDays, color: "#EF4444" },
                              { label: "إجازة", value: emp.leaveDays, color: "#F59E0B" },
                              { label: "ناقص 8س", value: emp.under8Days, color: "#F97316" },
                              { label: "تأخر", value: emp.lateCount, color: "#8B5CF6" },
                            ].map(stat => (
                              <div key={stat.label} style={{
                                background: `${stat.color}10`, border: `1px solid ${stat.color}25`,
                                borderRadius: "8px", padding: "5px 8px", textAlign: "center",
                              }}>
                                <div style={{ fontFamily: "Alexandria", fontWeight: 900, fontSize: "14px", color: stat.color }}>{stat.value}</div>
                                <div style={{ fontFamily: "Alexandria", fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>{stat.label}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Hours bar */}
                      <div style={{ marginBottom: "8px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>متوسط ساعات العمل اليومية</span>
                          <span style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 800, color: emp.avgHours >= 480 ? TEAL : emp.avgHours >= 360 ? "#F59E0B" : "#EF4444" }}>
                            {formatHHMM(emp.avgHours)}
                          </span>
                        </div>
                        <div style={{ height: "6px", background: "hsl(var(--border))", borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: "3px", transition: "width 0.5s ease",
                            width: `${Math.min(100, (emp.avgHours / 480) * 100)}%`,
                            background: emp.avgHours >= 480 ? TEAL : emp.avgHours >= 360 ? "#F59E0B" : "#EF4444",
                          }} />
                        </div>
                      </div>

                      {/* Expand hint */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginTop: "8px" }}>
                        <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: isSelected ? emp.color : "hsl(var(--muted-foreground))" }}>
                          {isSelected ? "▲ إخفاء التفاصيل" : "▼ عرض التفاصيل"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Selected Employee Detail Panel ── */}
              {selectedEmployee && selectedEmpData && selectedEmpData.summary && (
                <div style={{
                  background: "hsl(var(--card))",
                  border: `2px solid ${selectedEmpData.summary.color}40`,
                  borderRadius: "16px", padding: "24px", marginBottom: "16px",
                  boxShadow: `0 0 30px ${selectedEmpData.summary.color}15`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                    <div style={{
                      width: "52px", height: "52px", borderRadius: "50%",
                      background: `${selectedEmpData.summary.color}20`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "Alexandria", fontSize: "18px", fontWeight: 900,
                      color: selectedEmpData.summary.color,
                      border: `2px solid ${selectedEmpData.summary.color}50`,
                    }}>
                      {getInitials(selectedEmployee)}
                    </div>
                    <div>
                      <div style={{ fontFamily: "Alexandria", fontWeight: 900, fontSize: "16px", color: "hsl(var(--foreground))" }}>{selectedEmployee}</div>
                      <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
                        تحليل تفصيلي للفترة من {fromDate} إلى {toDate}
                      </div>
                    </div>
                    <ArrowUpRight size={16} color={selectedEmpData.summary.color} style={{ marginRight: "auto" }} />
                  </div>

                  {/* Daily hours trend */}
                  {empDailyTrend.length > 0 && (
                    <div style={{ marginBottom: "20px" }}>
                      <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--muted-foreground))", marginBottom: "12px" }}>
                        اتجاه ساعات العمل اليومية (آخر 14 يوم)
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={empDailyTrend} margin={{ top: 5, right: 10, left: -30, bottom: 5 }}>
                          <defs>
                            <linearGradient id={`empGrad-${selectedEmployee}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={selectedEmpData.summary.color} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={selectedEmpData.summary.color} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontFamily: "Alexandria", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis domain={[0, 12]} tick={{ fontFamily: "Alexandria", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip content={<ChartTooltip />} />
                          {/* 8h reference line */}
                          <Area type="monotone" dataKey="ساعات" stroke={selectedEmpData.summary.color}
                            fill={`url(#empGrad-${selectedEmployee})`} strokeWidth={2}
                            dot={(props: any) => {
                              const { cx, cy, payload } = props;
                              const color = payload.ساعات >= 8 ? "#1FA98C" : payload.ساعات >= 6 ? "#F59E0B" : "#EF4444";
                              return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={color} stroke="none" />;
                            }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "6px", justifyContent: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}><div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#1FA98C" }} /><span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>8+ ساعات</span></div>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}><div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#F59E0B" }} /><span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>6-8 ساعات</span></div>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}><div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#EF4444" }} /><span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>أقل من 6 ساعات</span></div>
                      </div>
                    </div>
                  )}

                  {/* Detailed records table */}
                  <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "13px", color: "hsl(var(--muted-foreground))", marginBottom: "10px" }}>
                    سجلات الحضور التفصيلية ({selectedEmpData.records.length} يوم)
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl", minWidth: "500px" }}>
                      <thead>
                        <tr style={{ background: "hsl(var(--card))" }}>
                          {["التاريخ", "الحالة", "وقت الدخول", "وقت الخروج", "ساعات العمل"].map(col => (
                            <th key={col} style={{ padding: "10px 12px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: selectedEmpData.summary!.color, textAlign: "right", borderBottom: `2px solid ${selectedEmpData.summary!.color}30` }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedEmpData.records.slice(-20).reverse().map((r, i) => {
                          const mins = parseHHMM(r.totalHours);
                          const isUnder8 = r.status === "Present" && mins > 0 && mins < 480;
                          return (
                            <tr key={i} style={{ background: isUnder8 ? "rgba(249,115,22,0.05)" : i % 2 === 0 ? "transparent" : "hsl(var(--card))", borderBottom: "1px solid hsl(var(--muted))" }}>
                              <td style={{ padding: "9px 12px", fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>{formatArabicDate(r.date)}</td>
                              <td style={{ padding: "9px 12px" }}><StatusBadge status={isSinglePunch(r) ? "Single Punch" : r.status} /></td>
                              <td style={{ padding: "9px 12px", fontFamily: "Alexandria", fontSize: "12px", color: "#1FA98C", fontWeight: 700 }}>
                                {r.firstIn !== "-" ? <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><LogIn size={10} />{r.firstIn}</span> : "—"}
                              </td>
                              <td style={{ padding: "9px 12px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
                                {r.lastOut !== "-" ? <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><LogOut size={10} />{r.lastOut}</span> : "—"}
                              </td>
                              <td style={{ padding: "9px 12px" }}>
                                {r.status === "Present" && mins > 0 ? <HoursBar minutes={mins} /> : <span style={{ color: "hsl(var(--border))" }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════ */}
          {/* ── MAP VIEW ── */}
          {/* ══════════════════════════════════════════════ */}
          {viewMode === "map" && (
            <div style={{ direction: "rtl" }}>

              {/* ── Check-in Card ── */}
              <div style={{
                background: checkInDone
                  ? "hsl(165 30% 16%)"
                  : geoStatus === "outside"
                    ? "hsl(0 30% 16%)"
                    : "hsl(var(--card))",
                border: `1px solid ${checkInDone ? "#1FA98C" : geoStatus === "outside" ? "#e05252" : "hsl(var(--border))"}`,
                borderRadius: "16px",
                padding: "20px 24px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "16px",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <LogIn size={20} color={checkInDone ? "#1FA98C" : geoStatus === "outside" ? "#e05252" : "hsl(var(--muted-foreground))"} />
                    <span style={{ fontFamily: "Alexandria", fontSize: "16px", fontWeight: 800, color: "hsl(var(--foreground))" }}>
                      {checkInDone ? `تم تسجيل الحضور ✔` : "تسجيل الحضور"}
                    </span>
                  </div>
                  {checkInDone && checkInTime && (
                    <span style={{ fontFamily: "Alexandria", fontSize: "13px", color: "#1FA98C" }}>وقت الدخول: {checkInTime}</span>
                  )}
                  {geoStatus === "outside" && geoDistance !== null && (
                    <span style={{ fontFamily: "Alexandria", fontSize: "13px", color: "#e05252" }}>أنت خارج نطاق الشركة — المسافة: {geoDistance} متر</span>
                  )}
                  {geoStatus === "idle" && (
                    <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>يعمل فقط داخل نطاق الشركة (‏200‏ متر)</span>
                  )}
                  {geoStatus === "checking" && (
                    <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "#1FA98C" }}>جاري تحديد موقعك…</span>
                  )}
                </div>
                <button
                  onClick={handleCheckIn}
                  disabled={geoStatus === "checking" || checkInDone}
                  style={{
                    fontFamily: "Alexandria",
                    fontSize: "14px",
                    fontWeight: 800,
                    padding: "12px 28px",
                    borderRadius: "12px",
                    border: "none",
                    cursor: (geoStatus === "checking" || checkInDone) ? "not-allowed" : "pointer",
                    background: checkInDone
                      ? "#1FA98C"
                      : geoStatus === "checking"
                        ? "hsl(var(--border))"
                        : "#1FA98C",
                    color: "white",
                    opacity: (geoStatus === "checking" || checkInDone) ? 0.7 : 1,
                    transition: "border-color 150ms ease, background-color 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    minWidth: "160px",
                    justifyContent: "center",
                  }}
                >
                  {geoStatus === "checking" ? (
                    <><RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> جاري التحقق…</>
                  ) : checkInDone ? (
                    <><CheckCircle size={16} /> تم التسجيل</>
                  ) : (
                    <><LogIn size={16} /> تسجيل الحضور</>
                  )}
                </button>
              </div>

              {/* ── Map Card ── */}
              <div style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "16px",
                padding: "20px",
                marginBottom: "16px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <MapPin size={20} color="#1FA98C" />
                  <span style={{ fontFamily: "Alexandria", fontSize: "16px", fontWeight: 800, color: "hsl(var(--foreground))" }}>موقع الشركة الجغرافي</span>
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginRight: "auto", background: "hsl(var(--card))", padding: "3px 10px", borderRadius: "20px", border: "1px solid hsl(var(--border))" }}>نطاق التسجيل: 200‏ متر</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", padding: "10px 14px", background: "hsl(var(--card))", borderRadius: "10px", border: "1px solid hsl(var(--border))" }}>
                  <MapPin size={14} color="#1FA98C" />
                  <span style={{ fontFamily: "Alexandria", fontSize: "13px", color: "hsl(var(--muted-foreground))" }}>تسويق ثلاثمائة وستين درجة — الرياض، المملكة العربية السعودية</span>
                </div>
                <div role="status" style={{ minHeight: "180px", borderRadius: "12px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "24px", textAlign: "center" }}>
                  <MapPin size={28} color="#1FA98C" />
                  <p style={{ margin: 0, fontFamily: "Alexandria", fontSize: "14px", fontWeight: 700, color: "hsl(var(--foreground))" }}>تُجرى مطابقة الموقع ضمن المنصة عند التسجيل</p>
                  <p style={{ margin: 0, fontFamily: "Alexandria", fontSize: "12px", lineHeight: 1.8, color: "hsl(var(--muted-foreground))" }}>لا يتم تحميل خريطة أو إرسال بيانات الموقع إلى خدمة خرائط خارجية من هذه الصفحة.</p>
                </div>
                <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                  <div style={{ background: "hsl(var(--card))", borderRadius: "10px", padding: "12px 16px", border: "1px solid hsl(var(--border))" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>خط العرض</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "14px", fontWeight: 800, color: "#1FA98C" }}>24.777044°</div>
                  </div>
                  <div style={{ background: "hsl(var(--card))", borderRadius: "10px", padding: "12px 16px", border: "1px solid hsl(var(--border))" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>خط الطول</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "14px", fontWeight: 800, color: "#1FA98C" }}>46.683644°</div>
                  </div>
                  <div style={{ background: "hsl(var(--card))", borderRadius: "10px", padding: "12px 16px", border: "1px solid hsl(var(--border))" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>المدينة</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "14px", fontWeight: 800, color: "hsl(var(--foreground))" }}>الرياض</div>
                  </div>
                  <div style={{ background: "hsl(var(--card))", borderRadius: "10px", padding: "12px 16px", border: "1px solid hsl(var(--border))" }}>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>المملكة</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "14px", fontWeight: 800, color: "hsl(var(--foreground))" }}>المملكة العربية السعودية</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════ */}
          {/* ── TABLE VIEW ── */}
          {/* ══════════════════════════════════════════════ */}
          {viewMode === "table" && (
            <>
              {/* Filters Row */}
              <div style={{
                background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                borderRadius: "14px", padding: "14px 16px", marginBottom: "16px", direction: "rtl",
              }}>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                  {TABS.map(tab => {
                    const isActive = filterTab === tab.key;
                    const count = tab.key === "الكل" ? data.length
                      : tab.key === "حاضر" ? stats.present
                      : tab.key === "غائب" ? stats.absent
                      : tab.key === "بصمة واحدة" ? stats.singlePunch
                      : tab.key === "إجازة" ? stats.onLeave
                      : stats.under8;
                    return (
                      <button key={tab.key} onClick={() => { setFilterTab(tab.key); setPage(1); }}
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
                        <span style={{
                          fontSize: "10px", fontWeight: 900,
                          background: isActive ? "rgba(255,255,255,0.25)" : "hsl(var(--border))",
                          color: isActive ? "white" : "hsl(var(--muted-foreground))",
                          padding: "1px 6px", borderRadius: "10px",
                        }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ position: "relative", flex: "1 1 200px", minWidth: "160px" }}>
                    <Search size={13} style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
                    <input
                      placeholder="بحث باسم الموظف أو التاريخ..."
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                      style={{
                        width: "100%", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                        color: "hsl(var(--foreground))", borderRadius: "8px", padding: "7px 32px 7px 10px",
                        fontFamily: "Alexandria", fontSize: "12px", outline: "none", boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <select value={filterEmployee} onChange={e => { setFilterEmployee(e.target.value); setPage(1); }}
                    style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "7px 10px", fontFamily: "Alexandria", fontSize: "12px", outline: "none" }}>
                    <option value="الكل">جميع الموظفين</option>
                    {employees.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                    {filtered.length} سجل
                  </span>
                </div>
              </div>

              {/* Table */}
              <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "14px", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl", minWidth: "700px" }}>
                    <thead>
                      <tr style={{ background: "hsl(var(--card))" }}>
                        {[
                          { label: "الموظف", align: "right" as const, w: "22%" },
                          { label: "التاريخ", align: "right" as const, w: "20%" },
                          { label: "الحالة", align: "center" as const, w: "12%" },
                          { label: "وقت الدخول", align: "center" as const, w: "11%" },
                          { label: "وقت الخروج", align: "center" as const, w: "11%" },
                          { label: "ساعات العمل", align: "center" as const, w: "18%" },
                          { label: "الوردية", align: "center" as const, w: "6%" },
                        ].map(col => (
                          <th key={col.label} style={{
                            padding: "12px 14px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700,
                            color: "#1FA98C", textAlign: col.align,
                            borderBottom: "2px solid hsl(var(--muted))", width: col.w, whiteSpace: "nowrap",
                          }}>{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paged.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: "56px 20px", textAlign: "center", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(var(--muted-foreground))" }}>
                            لا توجد سجلات تطابق الفلتر الحالي
                          </td>
                        </tr>
                      ) : paged.map((r, idx) => {
                        const isPresent = r.status === "Present";
                        const minutes = parseHHMM(r.totalHours);
                        const isUnder8 = isPresent && minutes > 0 && minutes < 480;
                        const avatarColor = getAvatarColor(r.employeeName);
                        const rowBg = isUnder8 ? "rgba(249,115,22,0.05)" : idx % 2 === 0 ? "transparent" : "hsl(var(--card))";
                        const rowBgHover = isUnder8 ? "rgba(249,115,22,0.10)" : "hsl(var(--card))";
                        const rowBorder = isUnder8 ? "1px solid rgba(249,115,22,0.15)" : `1px solid hsl(var(--muted))`;
                        return (
                          <tr key={`${r.employeeId}-${r.date}-${idx}`}
                            style={{ background: rowBg, borderBottom: rowBorder }}
                            onMouseEnter={e => (e.currentTarget.style.background = rowBgHover)}
                            onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                          >
                            <td style={{ padding: "11px 14px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <div style={{
                                  width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                                  background: `${avatarColor}20`, display: "flex", alignItems: "center", justifyContent: "center",
                                  fontFamily: "Alexandria", fontSize: "12px", fontWeight: 800, color: avatarColor,
                                  border: `1.5px solid ${avatarColor}40`,
                                }}>
                                  {getInitials(r.employeeName)}
                                </div>
                                <div>
                                  <div style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "hsl(var(--foreground))" }}>{r.employeeName}</div>
                                  <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>#{r.employeeId}</div>
                                </div>
                                {isUnder8 && <AlertTriangle size={13} style={{ color: "#F97316", marginRight: "2px", flexShrink: 0 }} />}
                              </div>
                            </td>
                            <td style={{ padding: "11px 14px" }}>
                              <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", lineHeight: 1.4 }}>{formatArabicDate(r.date)}</div>
                              <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>{r.date}</div>
                            </td>
                            <td style={{ padding: "11px 14px", textAlign: "center" }}><StatusBadge status={isSinglePunch(r) ? "Single Punch" : r.status} /></td>
                            <td style={{ padding: "11px 14px", textAlign: "center" }}>
                              {isPresent && r.firstIn !== "-" ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: "#1FA98C" }}>
                                  <LogIn size={11} />{r.firstIn}
                                </span>
                              ) : <span style={{ color: "hsl(var(--border))", fontSize: "16px" }}>—</span>}
                            </td>
                            <td style={{ padding: "11px 14px", textAlign: "center" }}>
                              {isPresent && r.lastOut !== "-" ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
                                  <LogOut size={11} />{r.lastOut}
                                </span>
                              ) : <span style={{ color: "hsl(var(--border))", fontSize: "16px" }}>—</span>}
                            </td>
                            <td style={{ padding: "11px 14px" }}>
                              {isPresent && minutes > 0 ? <HoursBar minutes={minutes} /> : <span style={{ color: "hsl(var(--border))", fontSize: "16px", display: "block", textAlign: "center" }}>—</span>}
                            </td>
                            <td style={{ padding: "11px 14px", textAlign: "center" }}>
                              <span style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", padding: "3px 8px", borderRadius: "6px" }}>
                                {r.shiftName}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid hsl(var(--border))", direction: "rtl" }}>
                    <span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>
                      صفحة {page} من {totalPages} — {filtered.length} سجل إجمالاً
                    </span>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        style={{ width: "32px", height: "32px", borderRadius: "8px", background: "hsl(var(--border))", border: "1px solid hsl(var(--border))", color: page === 1 ? "hsl(var(--border))" : "hsl(var(--muted-foreground))", cursor: page === 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ChevronRight size={14} />
                      </button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let p = i + 1;
                        if (totalPages > 5) {
                          if (page <= 3) p = i + 1;
                          else if (page >= totalPages - 2) p = totalPages - 4 + i;
                          else p = page - 2 + i;
                        }
                        return (
                          <button key={p} onClick={() => setPage(p)}
                            style={{ width: "32px", height: "32px", borderRadius: "8px", background: page === p ? "#1FA98C" : "hsl(var(--border))", border: `1px solid ${page === p ? "#1FA98C" : "hsl(var(--border))"}`, color: page === p ? "white" : "hsl(var(--muted-foreground))", cursor: "pointer", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700 }}>
                            {p}
                          </button>
                        );
                      })}
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        style={{ width: "32px", height: "32px", borderRadius: "8px", background: "hsl(var(--border))", border: "1px solid hsl(var(--border))", color: page === totalPages ? "hsl(var(--border))" : "hsl(var(--muted-foreground))", cursor: page === totalPages ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ChevronLeft size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {!loading && data.length === 0 && !error && dataSourceReady !== false && !(dataSource === "db" && dataSourceReady) && (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "hsl(var(--muted-foreground))", fontFamily: "Alexandria" }}>
          <Clock size={52} style={{ margin: "0 auto 16px", opacity: 0.2 }} />
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>لا توجد سجلات حضور</div>
          <div style={{ fontSize: "13px" }}>اضغط «تحديث البيانات» لقراءة سجلات الحضور المحفوظة في المنصة</div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Manual Edit Modal */}
      {showEditModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "hsl(var(--card))", borderRadius: "16px", padding: "28px", width: "420px", maxWidth: "90vw", border: "1px solid hsl(var(--border))", direction: "rtl" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontFamily: "Alexandria", fontSize: "18px", fontWeight: 800, color: "hsl(var(--foreground))" }}>
                {editRecord ? "تعديل سجل الحضور" : "تسجيل حضور يدوي"}
              </h3>
              <button onClick={() => setShowEditModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer", fontSize: "20px" }}>×</button>
            </div>
            {editRecord && (
              <div style={{ background: "hsl(var(--muted))", borderRadius: "10px", padding: "12px", marginBottom: "16px" }}>
                <div style={{ fontFamily: "Alexandria", fontSize: "14px", fontWeight: 700, color: "#1FA98C" }}>{editRecord.employeeName}</div>
                <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>{formatArabicDate(editRecord.date)}</div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {!editRecord && (
                <div>
                  <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>اسم الموظف</label>
                  <select
                    style={{ width: "100%", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "10px 12px", fontFamily: "Alexandria", fontSize: "13px" }}
                    onChange={e => {
                      const rec = data.find(r => r.employeeId === e.target.value);
                      if (rec) { setEditRecord(rec); setEditFirstIn(rec.firstIn !== "-" ? rec.firstIn : ""); setEditLastOut(rec.lastOut !== "-" ? rec.lastOut : ""); }
                    }}
                  >
                    <option value="">اختر موظف...</option>
                    {[...new Set(data.map(r => r.employeeId))].map(id => {
                      const emp = data.find(r => r.employeeId === id);
                      return <option key={id} value={id}>{emp?.employeeName}</option>;
                    })}
                  </select>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>وقت الدخول</label>
                  <input type="time" value={editFirstIn} onChange={e => setEditFirstIn(e.target.value)}
                    style={{ width: "100%", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "10px 12px", fontFamily: "Alexandria", fontSize: "13px" }} />
                </div>
                <div>
                  <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>وقت الخروج</label>
                  <input type="time" value={editLastOut} onChange={e => setEditLastOut(e.target.value)}
                    style={{ width: "100%", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "10px 12px", fontFamily: "Alexandria", fontSize: "13px" }} />
                </div>
              </div>
              <div>
                <label style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px" }}>ملاحظة (اختياري)</label>
                <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="سبب التعديل..."
                  style={{ width: "100%", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: "8px", padding: "10px 12px", fontFamily: "Alexandria", fontSize: "13px" }} />
              </div>
              <button
                onClick={() => {
                  if (!editFirstIn && !editLastOut) { toast.error("يرجى تحديد وقت الدخول أو الخروج"); return; }
                  if (editRecord) {
                    setData(prev => prev.map(r => r.employeeId === editRecord.employeeId && r.date === editRecord.date ? { ...r, firstIn: editFirstIn || r.firstIn, lastOut: editLastOut || r.lastOut, status: "حاضر" } : r));
                  }
                  toast.success("تم حفظ التعديل بنجاح");
                  setShowEditModal(false);
                }}
                style={{ width: "100%", background: "#1FA98C", color: "white", border: "none", borderRadius: "10px", padding: "12px", fontFamily: "Alexandria", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}
              >
                {editRecord ? "حفظ التعديل" : "تسجيل الحضور"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageTemplate>
  );
}
