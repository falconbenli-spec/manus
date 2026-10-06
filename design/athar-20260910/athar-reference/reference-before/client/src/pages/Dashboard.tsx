/**
 * Dashboard - HCM Platform (Professional Redesign)
 * Brand: People36t theme tokens with a charcoal hero surface
 */
import { useEffect, useState, useMemo, useRef } from "react";
import {
  Users, Building2, Clock, TrendingUp, Calendar, Award,
  FileDown, Activity, AlertTriangle, CheckCircle2, UserCheck,
  Globe2, GraduationCap, ChevronRight, BarChart3, PieChart as PieIcon,
  ArrowUpRight, ArrowDownRight, Minus
} from "lucide-react";
import { toast } from "sonner";
import { useEmployees } from "@/contexts/EmployeeContext";
import type { Employee } from "@/contexts/EmployeeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/contexts/ActivityLogContext";
// Attendance data loaded dynamically from API
import {
  Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, Area, AreaChart
} from "recharts";
import EmployeeProfileModal from "@/components/EmployeeProfileModal";
import ImpactWelcome from "@/components/brand/ImpactWelcome";

const DEPT_COLORS = ["hsl(var(--primary))","#28B99D","#D97706","#7C3AED","#2563EB","#DC2626","#059669","#EA580C","#DB2777","#0891B2","#65A30D","#9333EA"];
const TEAL = "hsl(var(--primary))";
const TEAL_LIGHT = "hsl(var(--accent))";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', padding: '8px 14px', fontFamily: 'Alexandria', boxShadow: 'var(--shadow-card)' }}>
        <p style={{ color: TEAL, fontSize: '12px', fontWeight: 700 }}>{label || payload[0]?.name}</p>
        <p style={{ color: 'hsl(var(--foreground))', fontSize: '13px', fontWeight: 800 }}>{payload[0]?.value}</p>
      </div>
    );
  }
  return null;
};

function parseContractDate(s: string): Date | null {
  if (!s || typeof s !== 'string') return null;
  const clean = s.trim();
  const formats = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/, // dd/mm/yyyy
    /^(\d{2})-(\d{2})-(\d{4})$/,   // dd-mm-yyyy
    /^(\d{4})-(\d{2})-(\d{2})$/,   // yyyy-mm-dd
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // d/m/yyyy
  ];
  for (const fmt of formats) {
    const m = clean.match(fmt);
    if (m) {
      if (fmt === formats[2]) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    }
  }
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function formatAttendanceSyncTime(timestamp: number | null): string {
  if (!timestamp) return "لا تتوفر مزامنة محفوظة";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "لا تتوفر مزامنة محفوظة";
  return date.toLocaleString("ar-SA-u-ca-gregory", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function Dashboard() {
  const [visible, setVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [profileEmp, setProfileEmp] = useState<Employee | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'contracts' | 'attendance'>('overview');
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'present' | 'absent' | 'leave' | 'exempt'>('all');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [deptSearch, setDeptSearch] = useState('');
  const deptListRef = useRef<HTMLDivElement>(null);
  const { logActivity } = useActivityLog();
  const { employees, getDeptStats, canSeeData } = useEmployees();
  const { user } = useAuth();

  // Attendance exemptions (employees exempt from geo-fencing)
  const [exemptIds, setExemptIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch('/api/attendance/exemptions', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: Array<{employeeId?: string; employee_id?: string}>) => {
        if (Array.isArray(data)) setExemptIds(new Set(data.map(e => String(e.employeeId || e.employee_id || ''))));
      })
      .catch(() => {});
  }, []);

  // Dynamic attendance data from API
  const [rawAttendance, setRawAttendance] = useState<Array<{
    employeeId: string; employeeName: string; date: string;
    lateEntry: string; netHours: string; flexLate?: boolean;
    flexShortfall?: boolean; isWeekend?: boolean;
  }>>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceLastSyncedAt, setAttendanceLastSyncedAt] = useState<number | null>(null);
  // Selected date for attendance card (defaults to today)
  const [selectedDateISO, setSelectedDateISO] = useState<string>(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetch('/api/attendance/sync-status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(status => {
        if (typeof status?.lastSyncedAt === 'number') setAttendanceLastSyncedAt(status.lastSyncedAt);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Read the week containing selectedDateISO from persisted platform records.
    const selectedDate = new Date(selectedDateISO + 'T12:00:00');
    // Week starts Saturday (Saudi Arabia)
    const dayOfWeek = selectedDate.getDay();
    const daysSinceSat = (dayOfWeek + 1) % 7;
    const weekStart = new Date(selectedDate);
    weekStart.setDate(selectedDate.getDate() - daysSinceSat);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const from = weekStart.toISOString().split('T')[0];
    const to = weekEnd.toISOString().split('T')[0];

    const loadPersistedAttendance = () => fetch(`/api/attendance/synced?from=${from}&to=${to}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        const records = Array.isArray(payload) ? payload : (Array.isArray(payload?.records) ? payload.records : []);
        const lastSyncedAt = Array.isArray(payload) ? null : payload?.lastSyncedAt;
        if (typeof lastSyncedAt === 'number') setAttendanceLastSyncedAt(lastSyncedAt);
        setRawAttendance(records.map((record: any) => {
          const hoursWorked = Math.max(0, Number(record.hoursWorked ?? record.hours_worked ?? 0));
          const totalMinutes = Math.round(hoursWorked * 60);
          const checkIn = String(record.checkIn ?? record.check_in ?? '');
          const hour = Number(checkIn.split(':')[0] || 0);
          const minute = Number(checkIn.split(':')[1] || 0);
          const status = String(record.status || '');
          const isWeekend = ['weekend', 'holiday'].includes(status.toLowerCase());
          return {
            employeeId: String(record.employeeId ?? record.employee_id ?? ''),
            employeeName: String(record.employeeName ?? record.employee_name ?? ''),
            date: String(record.date || ''),
            lateEntry: '',
            netHours: `${Math.floor(hoursWorked)}:${String(Math.round((hoursWorked % 1) * 60)).padStart(2, '0')}`,
            flexLate: !isWeekend && Boolean(checkIn) && (hour > 9 || (hour === 9 && minute > 0)),
            flexShortfall: !isWeekend && totalMinutes > 0 && totalMinutes < 480,
            isWeekend,
            status,
            checkIn,
            checkOut: String(record.checkOut ?? record.check_out ?? ''),
          };
        }));
      });

    setAttendanceLoading(true);
    loadPersistedAttendance()
      .catch(() => setRawAttendance([]))
      .finally(() => setAttendanceLoading(false));
  }, [selectedDateISO]);

  useEffect(() => { setTimeout(() => setVisible(true), 50); }, []);

  const today = new Date();
  const todayStr = today.toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { generateHCMReport } = await import('@/lib/generateReport');
      await generateHCMReport();
      if (user) {
        logActivity({
          userId: user.id, userName: user.name, userRole: user.role,
          category: "report", action: "تصدير تقرير PDF",
          details: "تم تصدير تقرير رأس المال البشري الشامل بصيغة PDF",
          severity: "success", metadata: { format: "PDF", date: new Date().toISOString() },
        });
      }
      toast.success('تم تصدير التقرير بنجاح ✔️');
    } catch (e) {
      toast.error('حدث خطأ أثناء تصدير التقرير');
    } finally {
      setExporting(false);
    }
  };

  const deptStats = useMemo(() => getDeptStats(), [employees]);

  // Contract analytics
  const contractStats = useMemo(() => {
    const now = today.getTime();
    const in30 = now + 30 * 86400000;
    const in60 = now + 60 * 86400000;
    const in90 = now + 90 * 86400000;

    let expired = 0, within30 = 0, within60 = 0, within90 = 0, active = 0;
    const expiringList: { emp: Employee; date: Date; daysLeft: number }[] = [];

    employees.forEach(emp => {
      const d = parseContractDate(emp.contractEnd);
      if (!d) return;
      const t = d.getTime();
      const daysLeft = Math.ceil((t - now) / 86400000);
      if (t < now) { expired++; }
      else if (t <= in30) { within30++; expiringList.push({ emp, date: d, daysLeft }); }
      else if (t <= in60) { within60++; expiringList.push({ emp, date: d, daysLeft }); }
      else if (t <= in90) { within90++; expiringList.push({ emp, date: d, daysLeft }); }
      else { active++; }
    });

    expiringList.sort((a, b) => a.daysLeft - b.daysLeft);
    return { expired, within30, within60, within90, active, expiringList };
  }, [employees]);

  // Today's date ISO string for filtering
  const todayISO = today.toISOString().split('T')[0];

  // Today's attendance rate (live from rawAttendance)
  const todayAttendanceRate = useMemo(() => {
    // Filter records for selected date, exclude weekends/holidays
    const todayRecs = rawAttendance.filter(r => {
      const d = (r as any).date || '';
      const s = ((r as any).status || '').toLowerCase();
      const isWeekendOrHoliday = (r as any).isWeekend || s === 'weekend' || s === 'holiday';
      return d === selectedDateISO && !isWeekendOrHoliday;
    });
    if (todayRecs.length === 0) return null;

    // Classify each employee record
    const classified = todayRecs.map(r => {
      const s = ((r as any).status || '').toLowerCase();
      const checkIn = (r as any).checkIn || (r as any).firstIn || '';
      const checkOut = (r as any).checkOut || (r as any).lastOut || '';
      const netHours = (r as any).netHours || (r as any).hoursWorked || '';
      const hoursNum = typeof netHours === 'number' ? netHours : 0;
      const hoursStr = typeof netHours === 'string' ? netHours : '';
      const hasHours = hoursNum > 0 || (hoursStr && hoursStr !== '00:00' && hoursStr !== '0');
      const hasCheckIn = !!(checkIn && checkIn !== '-' && checkIn !== '');

      const empId = String((r as any).employeeId || '');
      const isExempt = exemptIds.has(empId);

      let attendStatus: 'present' | 'absent' | 'leave' | 'exempt';
      if (s === 'leave') attendStatus = 'leave';
      else if (s === 'present' || s === 'half day') attendStatus = 'present';
      else if (hasCheckIn || hasHours) attendStatus = 'present';
      else if (isExempt) attendStatus = 'exempt';
      else attendStatus = 'absent';

      return {
        employeeId: empId,
        employeeName: (r as any).employeeName || '',
        department: (r as any).department || '',
        checkIn: checkIn && checkIn !== '-' ? checkIn : '',
        checkOut: checkOut && checkOut !== '-' ? checkOut : '',
        netHours: hoursStr || (hoursNum > 0 ? String(hoursNum) : ''),
        attendStatus,
        isExempt,
      };
    });

    const presentCount = classified.filter(r => r.attendStatus === 'present').length;
    const absentCount = classified.filter(r => r.attendStatus === 'absent').length;
    const leaveCount = classified.filter(r => r.attendStatus === 'leave').length;
    const exemptCount = classified.filter(r => r.attendStatus === 'exempt').length;
    // Exempt employees count as present (full attendance) in rate calculation
    const effectivePresent = presentCount + exemptCount;
    const rate = classified.length > 0 ? Math.round((effectivePresent / classified.length) * 100) : 0;
    return { rate, present: presentCount, absent: absentCount, leave: leaveCount, exempt: exemptCount, total: classified.length, employees: classified };
  }, [rawAttendance, selectedDateISO, exemptIds]);

  // Attendance stats
  const attendanceStats = useMemo(() => {
    const att = rawAttendance as Array<{
      employeeId: string; employeeName: string; date: string;
      lateEntry: string; netHours: string; flexLate?: boolean;
      flexShortfall?: boolean; isWeekend?: boolean; status?: string;
    }>;
    // Exclude weekends and holidays from all calculations
    const workdays = att.filter(r => !r.isWeekend);
    // Required workdays = workdays excluding approved leaves AND holidays
    const requiredDays = workdays.filter(r => {
      const s = (r.status || '').toLowerCase();
      return !s.includes('إجازة') && !s.includes('leave') && !s.includes('holiday') && !s.includes('عطلة');
    });
    // Actual attendance = days where employee actually checked in
    // A record counts as present if:
    //   - status is 'حاضر' or 'present', OR
    //   - has a netHours value > 0, OR
    //   - has a lateEntry value (means they came in, even late), OR
    //   - flexLate is defined (means check-in was detected)
    //   - employee is exempt from geo-fencing (counts as full attendance)
    // A record is ABSENT if status contains 'غائب' or 'absent' AND no check-in data AND not exempt
    const presentDays = requiredDays.filter(r => {
      // Exempt employees always count as present
      if (exemptIds.has(String(r.employeeId))) return true;
      const s = (r.status || '').toLowerCase();
      const isAbsent = s.includes('غائب') || s.includes('absent');
      if (isAbsent) return false;
      // Has actual check-in data
      const hasCheckIn = !!(r.netHours && r.netHours !== '00:00') || !!(r.lateEntry) || r.flexLate === true || r.flexLate === false;
      return hasCheckIn;
    });
    const uniqueEmployees = new Set(workdays.map(r => r.employeeId)).size;
    const lateCount = presentDays.filter(r => r.flexLate === true).length;
    const shortfallCount = presentDays.filter(r => r.flexShortfall === true && !exemptIds.has(String(r.employeeId))).length;
    const totalRecords = requiredDays.length;
    const presentCount = presentDays.length;
    const absentCount = totalRecords - presentCount;
    // Attendance rate = present days / required days (excluding leaves)
    const onTimeRate = totalRecords > 0 ? Math.round((presentCount / totalRecords) * 100) : 100;
    // Compliance rate = days with full 8 hours / present days
    const complianceRate = presentCount > 0 ? Math.round(((presentCount - shortfallCount) / presentCount) * 100) : 100;

    // Daily trend (last 7 unique dates)
    const dateMap: Record<string, { total: number; late: number; shortfall: number }> = {};
    workdays.forEach(r => {
      if (!dateMap[r.date]) dateMap[r.date] = { total: 0, late: 0, shortfall: 0 };
      dateMap[r.date].total++;
      if (r.flexLate) dateMap[r.date].late++;
      if (r.flexShortfall) dateMap[r.date].shortfall++;
    });
    const trend = Object.entries(dateMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([date, v]) => ({
        date: date.slice(5),
        حاضر: v.total,
        متأخر: v.late,
        ناقص: v.shortfall,
      }));

    return { uniqueEmployees, lateCount, shortfallCount, totalRecords, presentCount, absentCount, onTimeRate, complianceRate, trend };
  }, [rawAttendance, exemptIds]);

  // Nationality stats
  const nationalityStats = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => {
      const nat = e.nationality || 'غير محدد';
      map[nat] = (map[nat] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [employees]);

  // Gender stats
  const genderStats = useMemo(() => {
    const male = employees.filter(e => e.gender === 'ذكر').length;
    const female = employees.filter(e => e.gender === 'انثى').length;
    const total = male + female;
    return { male, female, total, maleRate: total ? Math.round((male / total) * 100) : 0, femaleRate: total ? Math.round((female / total) * 100) : 0 };
  }, [employees]);

  // Education stats
  const educationStats = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => { if (e.education) map[e.education] = (map[e.education] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [employees]);

  // Saudization rate
  const saudiRate = useMemo(() => {
    const saudis = employees.filter(e => e.nationality === 'المملكة العربية السعودية').length;
    return employees.length > 0 ? Math.round((saudis / employees.length) * 100) : 0;
  }, [employees]);

  const totalExpiring = contractStats.within30 + contractStats.within60 + contractStats.within90;

  return (
    <div className={`space-y-5 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '22px', color: 'hsl(var(--foreground))', marginBottom: '3px' }}>
            لوحة التحكم الرئيسية
          </h1>
          <p style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>
            مرحباً {user?.name} — {todayStr}
          </p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '8px', padding: '5px 9px', borderRadius: '999px', background: 'hsl(var(--primary) / .10)', border: '1px solid hsl(var(--primary) / .20)', color: attendanceLoading ? 'hsl(var(--muted-foreground))' : TEAL, fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700 }}>
            <Clock size={12} />
            <span>{attendanceLoading ? 'جارٍ التحقق من بيانات الحضور' : `آخر مزامنة للحضور: ${formatAttendanceSyncTime(attendanceLastSyncedAt)}`}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all"
            style={{
              background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
              color: exporting ? 'hsl(var(--muted-foreground))' : TEAL,
              fontFamily: 'Alexandria', fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer',
            }}
          >
            <FileDown size={14} />
            <span>{exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}</span>
          </button>
          <button
            className="btn-brand flex items-center gap-2"
            onClick={() => toast.success("البيانات محدّثة")}
          >
            <Activity size={14} /><span>تحديث</span>
          </button>
        </div>
      </div>

      <ImpactWelcome stats={[
        { label: 'إجمالي الموظفين', value: employees.length },
        { label: 'الإدارات', value: deptStats.length },
        { label: 'نسبة السعودة', value: `${saudiRate}%` },
        { label: 'عقود تنتهي', value: totalExpiring },
      ]} />

      {/* ── KPI Cards Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            title: 'إجمالي الموظفين', value: employees.length, sub: `${deptStats.length} إدارة`,
            icon: Users, color: TEAL, trend: null,
          },
          {
            title: 'نسبة السعودة', value: `${saudiRate}%`,
            sub: `${employees.filter(e => e.nationality === 'المملكة العربية السعودية').length} سعودي`,
            icon: UserCheck, color: '#F59E0B', trend: saudiRate >= 70 ? 'up' : saudiRate >= 50 ? 'neutral' : 'down',
          },
          {
            title: 'دوام اليوم',
            value: todayAttendanceRate ? `${todayAttendanceRate.rate}%` : attendanceLoading ? 'جاري...' : '—',
            sub: todayAttendanceRate ? `${todayAttendanceRate.present} حاضر من ${todayAttendanceRate.total} موظف` : 'لا توجد بيانات لليوم',
            icon: Clock,
            color: todayAttendanceRate ? (todayAttendanceRate.rate >= 80 ? '#10B981' : todayAttendanceRate.rate >= 60 ? '#F59E0B' : '#EF4444') : TEAL,
            trend: todayAttendanceRate ? (todayAttendanceRate.rate >= 80 ? 'up' : todayAttendanceRate.rate >= 60 ? 'neutral' : 'down') : null,
          },
          {
            title: 'عقود تنتهي (90 يوم)', value: totalExpiring,
            sub: `${contractStats.within30} خلال 30 يوم`,
            icon: AlertTriangle, color: totalExpiring > 5 ? '#EF4444' : totalExpiring > 0 ? '#F59E0B' : '#10B981',
            trend: totalExpiring > 5 ? 'down' : totalExpiring > 0 ? 'neutral' : 'up',
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="rounded-xl p-5 animate-fade-in-up"
              style={{
                animationDelay: `${i * 70}ms`, opacity: 0,
                background: 'hsl(var(--card))',
                border: `1px solid ${card.color}30`,
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="rounded-xl flex items-center justify-center" style={{ width: '44px', height: '44px', background: `${card.color}18`, color: card.color }}>
                  <Icon size={20} />
                </div>
                {card.trend && (
                  <div className="flex items-center gap-1 rounded-full px-2 py-1" style={{
                    background: card.trend === 'up' ? '#10B98115' : card.trend === 'down' ? '#EF444415' : '#F59E0B15',
                    color: card.trend === 'up' ? '#10B981' : card.trend === 'down' ? '#EF4444' : '#F59E0B',
                  }}>
                    {card.trend === 'up' ? <ArrowUpRight size={12} /> : card.trend === 'down' ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                  </div>
                )}
              </div>
              <div style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '28px', color: card.color, lineHeight: 1 }}>{card.value}</div>
              <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))', marginTop: '5px' }}>{card.title}</div>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>{card.sub}</div>
            </div>
          );
        })}
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', width: 'fit-content' }}>
        {([
          { id: 'overview', label: 'نظرة عامة', icon: BarChart3 },
          { id: 'contracts', label: 'العقود', icon: Calendar },
          { id: 'attendance', label: 'الحضور', icon: Clock },
        ] as const).map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all"
              style={{
                fontFamily: 'Alexandria', fontWeight: active ? 700 : 500, fontSize: '13px',
                background: active ? TEAL : 'transparent',
                color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && canSeeData && (
        <>
          {/* Dept Bar Chart - full width, clickable */}
          <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 size={16} color={TEAL} />
                <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>الموظفون حسب الإدارة</span>
              </div>
              {selectedDept && (
                <button
                  onClick={() => { setSelectedDept(null); setDeptSearch(''); }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs transition-all"
                  style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', fontFamily: 'Alexandria', border: '1px solid hsl(var(--border))' }}
                >
                  × إلغاء التحديد
                </button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={deptStats}
                margin={{ top: 28, right: 10, left: -20, bottom: 80 }}
                onClick={(data) => {
                  if (data?.activePayload?.[0]) {
                    const dept = data.activePayload[0].payload;
                    const deptName = dept.name;
                    setSelectedDept(prev => prev === deptName ? null : deptName);
                    setDeptSearch('');
                    setTimeout(() => deptListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={(props: any) => {
                    const { x, y, payload, index } = props;
                    const color = DEPT_COLORS[index % DEPT_COLORS.length];
                    const isSelected = selectedDept === payload.value;
                    const words: string[] = (payload.value || '').split(' ');
                    const mid = Math.ceil(words.length / 2);
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text x={0} y={0} dy={14} textAnchor="middle" fill={color} fontFamily="Alexandria" fontSize={isSelected ? 10 : 9} fontWeight={isSelected ? 800 : 600}>
                          {words.slice(0, mid).join(' ')}
                        </text>
                        {words.length > mid && (
                          <text x={0} y={0} dy={26} textAnchor="middle" fill={color} fontFamily="Alexandria" fontSize={isSelected ? 10 : 9} fontWeight={isSelected ? 800 : 600}>
                            {words.slice(mid).join(' ')}
                          </text>
                        )}
                      </g>
                    );
                  }}
                  interval={0} height={80}
                />
                <YAxis tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="الموظفون" radius={[6, 6, 0, 0]}>
                  <LabelList
                    dataKey="count"
                    position="top"
                    content={(props: any) => {
                      const { x, y, width, value, index } = props;
                      const color = DEPT_COLORS[(index ?? 0) % DEPT_COLORS.length];
                      return (
                        <text x={x + width / 2} y={y - 6} textAnchor="middle" fill={color} fontFamily="Alexandria" fontSize={11} fontWeight={800}>
                          {value}
                        </text>
                      );
                    }}
                  />
                  {deptStats.map((d, i) => (
                    <Cell
                      key={i}
                      fill={DEPT_COLORS[i % DEPT_COLORS.length]}
                      opacity={selectedDept && selectedDept !== d.name ? 0.3 : 1}
                      stroke={selectedDept === d.name ? '#fff' : 'none'}
                      strokeWidth={selectedDept === d.name ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Expanded dept employees */}
            {selectedDept && (() => {
              const deptIndex = deptStats.findIndex(d => d.name === selectedDept);
              const color = DEPT_COLORS[deptIndex % DEPT_COLORS.length];
              const allDeptEmps = employees.filter(e => e.department === selectedDept);
              const q = deptSearch.trim().toLowerCase();
              const filtered = q
                ? allDeptEmps.filter(e =>
                    e.nameAr?.toLowerCase().includes(q) ||
                    e.jobTitle?.toLowerCase().includes(q) ||
                    String(e.employeeId || e.id || '').toLowerCase().includes(q)
                  )
                : allDeptEmps;
              return (
                <div ref={deptListRef} style={{ marginTop: '20px', borderTop: `2px solid ${color}40`, paddingTop: '20px' }}>
                  {/* Dept header */}
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl flex items-center justify-center" style={{ width: '40px', height: '40px', background: `${color}20`, color }}>
                        <Building2 size={18} />
                      </div>
                      <div>
                        <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color }}>{selectedDept}</div>
                        <div style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>
                          {filtered.length}{q ? ` من ${allDeptEmps.length}` : ''} موظف
                        </div>
                      </div>
                    </div>
                    {/* Search */}
                    <div style={{ position: 'relative', minWidth: '220px' }}>
                      <input
                        type="text"
                        value={deptSearch}
                        onChange={e => setDeptSearch(e.target.value)}
                        placeholder="ابحث بالاسم أو المسمى أو الرقم..."
                        style={{
                          width: '100%', padding: '8px 36px 8px 12px',
                          background: `${color}08`, border: `1px solid ${color}35`,
                          borderRadius: '10px', fontFamily: 'Alexandria', fontSize: '12px',
                          color: 'hsl(var(--foreground))', outline: 'none', direction: 'rtl',
                        }}
                        onFocus={e => { e.target.style.borderColor = color; e.target.style.boxShadow = `0 0 0 2px ${color}20`; }}
                        onBlur={e => { e.target.style.borderColor = `${color}35`; e.target.style.boxShadow = 'none'; }}
                      />
                      <svg style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color, opacity: 0.6 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                      </svg>
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>
                      لا توجد نتائج لـ "{deptSearch}"
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filtered.map((emp, idx) => (
                        <div
                          key={emp.id}
                          className="animate-fade-in-up"
                          style={{ animationDelay: `${idx * 30}ms`, opacity: 0 }}
                          onClick={() => setProfileEmp(emp)}
                        >
                          <div
                            className="flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-all"
                            style={{ background: `${color}08`, border: `1px solid ${color}20` }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${color}18`; (e.currentTarget as HTMLElement).style.borderColor = `${color}50`; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${color}08`; (e.currentTarget as HTMLElement).style.borderColor = `${color}20`; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
                          >
                            {/* Avatar */}
                            <div className="rounded-xl flex items-center justify-center flex-shrink-0" style={{ width: '44px', height: '44px', background: `${color}25`, border: `2px solid ${color}50`, color, fontFamily: 'Alexandria', fontWeight: 900, fontSize: '16px' }}>
                              {emp.nameAr?.charAt(0) || '?'}
                            </div>
                            {/* Info */}
                            <div className="flex-1 overflow-hidden">
                              <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.nameAr}</div>
                              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>{emp.jobTitle || '—'}</div>
                              <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>{emp.nationality || ''}</div>
                            </div>
                            {/* Arrow */}
                            <ChevronRight size={14} color={`${color}80`} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {/* Gender + Nationality */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Gender */}
              <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Users size={16} color={TEAL} />
                  <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>التوزيع حسب الجنس</span>
                </div>
                <div className="flex items-center gap-6">
                  {/* Male */}
                  <div className="flex items-center gap-3 flex-1">
                    <div className="rounded-xl flex items-center justify-center" style={{ width: '48px', height: '48px', background: 'hsl(var(--primary) / .12)', flexShrink: 0 }}>
                      <span style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '16px', color: TEAL }}>{genderStats.male}</span>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))' }}>ذكور</div>
                      <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: TEAL }}>{genderStats.maleRate}%</div>
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="flex-1">
                    <div style={{ height: '10px', borderRadius: '999px', overflow: 'hidden', background: '#F59E0B25', display: 'flex' }}>
                      <div style={{ width: `${genderStats.maleRate}%`, background: TEAL, borderRadius: '999px 0 0 999px', transition: 'width 1s ease' }} />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: TEAL }}>{genderStats.maleRate}% ذكور</span>
                      <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: '#F59E0B' }}>{genderStats.femaleRate}% إناث</span>
                    </div>
                  </div>
                  {/* Female */}
                  <div className="flex items-center gap-3 flex-1 justify-end">
                    <div>
                      <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))', textAlign: 'right' }}>إناث</div>
                      <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: '#F59E0B', textAlign: 'right' }}>{genderStats.femaleRate}%</div>
                    </div>
                    <div className="rounded-xl flex items-center justify-center" style={{ width: '48px', height: '48px', background: '#F59E0B20', flexShrink: 0 }}>
                      <span style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '16px', color: '#F59E0B' }}>{genderStats.female}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Nationality */}
              <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Globe2 size={16} color={TEAL} />
                  <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>الجنسيات</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {nationalityStats.map((n, i) => (
                    <div key={n.name} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: `${DEPT_COLORS[i % DEPT_COLORS.length]}12`, border: `1px solid ${DEPT_COLORS[i % DEPT_COLORS.length]}25` }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: DEPT_COLORS[i % DEPT_COLORS.length], flexShrink: 0 }} />
                      <div className="overflow-hidden">
                        <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</div>
                        <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '14px', color: DEPT_COLORS[i % DEPT_COLORS.length] }}>{n.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          {/* Education */}
          <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap size={16} color={TEAL} />
                <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>المستوى التعليمي</span>
              </div>
              <div className="space-y-3">
                {educationStats.map((edu, i) => (
                  <div key={edu.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>{edu.name}</span>
                      <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: DEPT_COLORS[i % DEPT_COLORS.length] }}>{edu.value}</span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '999px', background: 'hsl(var(--muted))', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: '999px',
                        background: DEPT_COLORS[i % DEPT_COLORS.length],
                        width: `${(edu.value / employees.length) * 100}%`,
                        transition: 'width 0.8s ease',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
        </>
      )}

      {/* ── Today's Attendance Live Widget with Filter ── */}
      {activeTab === 'overview' && canSeeData && (() => {
        const filterColor = todayAttendanceRate
          ? (attendanceFilter === 'present' ? '#10B981' : attendanceFilter === 'absent' ? '#EF4444' : attendanceFilter === 'leave' ? '#F59E0B' : attendanceFilter === 'exempt' ? '#8B5CF6' : (todayAttendanceRate.rate >= 80 ? '#10B981' : todayAttendanceRate.rate >= 60 ? '#F59E0B' : '#EF4444'))
          : TEAL;
        const filteredEmps = todayAttendanceRate
          ? (attendanceFilter === 'all' ? todayAttendanceRate.employees : todayAttendanceRate.employees.filter(e => e.attendStatus === attendanceFilter))
          : [];
        return (
          <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: `1px solid ${filterColor}30` }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock size={16} color={filterColor} />
                <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>
                  {selectedDateISO === todayISO ? 'دوام اليوم — لحظي' : `دوام ${new Date(selectedDateISO + 'T12:00:00').toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {selectedDateISO === todayISO && (
                  <div className="flex items-center gap-1">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', animation: 'pulse 2s infinite' }} />
                    <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>محدّث تلقائياً</span>
                  </div>
                )}
                <input
                  type="date"
                  value={selectedDateISO}
                  max={todayISO}
                  onChange={e => { if (e.target.value) setSelectedDateISO(e.target.value); }}
                  style={{
                    fontFamily: 'Alexandria', fontSize: '12px', padding: '4px 8px',
                    background: 'hsl(var(--elevated))', border: `1px solid ${filterColor}50`,
                    borderRadius: '8px', color: 'hsl(var(--foreground))',
                    cursor: 'pointer', outline: 'none',
                    colorScheme: 'dark',
                  }}
                />
                {selectedDateISO !== todayISO && (
                  <button
                    onClick={() => setSelectedDateISO(todayISO)}
                    style={{
                      fontFamily: 'Alexandria', fontSize: '11px', padding: '4px 10px',
                      background: `${TEAL}20`, border: `1px solid ${TEAL}50`,
                      borderRadius: '8px', color: TEAL, cursor: 'pointer',
                    }}
                  >اليوم</button>
                )}
              </div>
            </div>

            {/* Stats Row */}
            {todayAttendanceRate ? (
            <div className="flex items-end gap-6 mb-4">
              <div>
                <div style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '48px', lineHeight: 1, color: todayAttendanceRate.rate >= 80 ? '#10B981' : todayAttendanceRate.rate >= 60 ? '#F59E0B' : '#EF4444' }}>{todayAttendanceRate.rate}%</div>
                <div style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginTop: '4px' }}>نسبة الحضور اليومي</div>
              </div>
              <div className="flex gap-4 mb-2">
                <div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '22px', color: '#10B981', lineHeight: 1 }}>{todayAttendanceRate.present}</div>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>حاضر</div>
                </div>
                <div style={{ width: '1px', background: 'hsl(var(--border))' }} />
                <div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '22px', color: '#EF4444', lineHeight: 1 }}>{todayAttendanceRate.absent}</div>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>غائب</div>
                </div>
                <div style={{ width: '1px', background: 'hsl(var(--border))' }} />
                <div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '22px', color: '#F59E0B', lineHeight: 1 }}>{todayAttendanceRate.leave}</div>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>إجازة</div>
                </div>
                <div style={{ width: '1px', background: 'hsl(var(--border))' }} />
                <div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '22px', color: TEAL, lineHeight: 1 }}>{todayAttendanceRate.total}</div>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>إجمالي</div>
                </div>
              </div>
            </div>
            ) : (
              <div style={{ fontFamily: 'Alexandria', fontSize: '14px', color: 'hsl(var(--muted-foreground))', textAlign: 'center', padding: '24px 0' }}>
                لا توجد بيانات حضور لهذا اليوم — قد يكون عطلة أو لم يتم جلب البيانات بعد
              </div>
            )}

            {/* Progress bar */}
            {todayAttendanceRate && <>
            <div style={{ height: '10px', borderRadius: '999px', background: 'hsl(var(--muted))', overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{
                height: '100%', borderRadius: '999px',
                background: todayAttendanceRate.rate >= 80 ? '#10B981' : todayAttendanceRate.rate >= 60 ? '#F59E0B' : '#EF4444',
                width: `${todayAttendanceRate.rate}%`,
                transition: 'width 1s ease',
              }} />
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2 flex-wrap mb-4">
              {([
                { key: 'all', label: 'الكل', count: todayAttendanceRate.total, color: TEAL },
                { key: 'present', label: 'حاضر', count: todayAttendanceRate.present, color: '#10B981' },
                { key: 'absent', label: 'غائب', count: todayAttendanceRate.absent, color: '#EF4444' },
                { key: 'leave', label: 'إجازة', count: todayAttendanceRate.leave, color: '#F59E0B' },
                ...(todayAttendanceRate.exempt > 0 ? [{ key: 'exempt' as const, label: 'مستثنى', count: todayAttendanceRate.exempt, color: '#8B5CF6' }] : []),
              ] as const).map(btn => (
                <button
                  key={btn.key}
                  onClick={() => setAttendanceFilter(btn.key)}
                  style={{
                    fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px',
                    padding: '5px 14px', borderRadius: '999px', cursor: 'pointer',
                    border: `1.5px solid ${attendanceFilter === btn.key ? btn.color : 'hsl(var(--border))'}`,
                    background: attendanceFilter === btn.key ? `${btn.color}18` : 'transparent',
                    color: attendanceFilter === btn.key ? btn.color : 'hsl(var(--muted-foreground))',
                    transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  <span>{btn.label}</span>
                  <span style={{
                    background: attendanceFilter === btn.key ? btn.color : 'hsl(var(--border))',
                    color: attendanceFilter === btn.key ? '#fff' : 'hsl(var(--muted-foreground))',
                    borderRadius: '999px', padding: '0 6px', fontSize: '11px', fontWeight: 800,
                  }}>{btn.count}</span>
                </button>
              ))}
            </div>

            </>}

            {/* Employee List */}
            {filteredEmps.length > 0 ? (
              <div className="space-y-2" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                {filteredEmps.map((emp, i) => {
                  const statusColor = emp.attendStatus === 'present' ? '#10B981' : emp.attendStatus === 'leave' ? '#F59E0B' : emp.attendStatus === 'exempt' ? '#8B5CF6' : '#EF4444';
                  const statusLabel = emp.attendStatus === 'present' ? 'حاضر' : emp.attendStatus === 'leave' ? 'إجازة' : emp.attendStatus === 'exempt' ? 'مستثنى' : 'غائب';
                  const initials = emp.employeeName.split(' ').slice(0, 2).map((w: string) => w[0] || '').join('');
                  return (
                    <div key={emp.employeeId || i} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'hsl(var(--elevated))' }}>
                      {/* Avatar */}
                      <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: '34px', height: '34px', background: `${statusColor}22`, color: statusColor, fontFamily: 'Alexandria', fontWeight: 800, fontSize: '12px' }}>
                        {initials || '؟'}
                      </div>
                      {/* Name & Dept */}
                      <div className="flex-1 min-w-0">
                        <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.employeeName || '—'}</div>
                        {emp.department && <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{emp.department}</div>}
                      </div>
                      {/* Check-in time */}
                      {emp.checkIn && (
                        <div className="text-center flex-shrink-0">
                          <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: '#10B981' }}>{emp.checkIn}</div>
                          <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))' }}>دخول</div>
                        </div>
                      )}
                      {emp.checkOut && (
                        <div className="text-center flex-shrink-0">
                          <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: '#6366F1' }}>{emp.checkOut}</div>
                          <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))' }}>خروج</div>
                        </div>
                      )}
                      {/* Status Badge */}
                      <div className="flex-shrink-0" style={{ background: `${statusColor}18`, color: statusColor, borderRadius: '999px', padding: '2px 10px', fontFamily: 'Alexandria', fontWeight: 700, fontSize: '11px', border: `1px solid ${statusColor}40` }}>
                        {statusLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6" style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>
                لا يوجد موظفون في هذه الحالة اليوم
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Contracts Tab ── */}
      {activeTab === 'contracts' && (
        <div className="space-y-4">
          {/* Contract KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'عقود نشطة', value: contractStats.active, color: '#10B981', icon: CheckCircle2 },
              { label: 'تنتهي خلال 30 يوم', value: contractStats.within30, color: '#EF4444', icon: AlertTriangle },
              { label: 'تنتهي خلال 60 يوم', value: contractStats.within60, color: '#F97316', icon: AlertTriangle },
              { label: 'تنتهي خلال 90 يوم', value: contractStats.within90, color: '#F59E0B', icon: Calendar },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl p-4 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms`, opacity: 0, background: 'hsl(var(--card))', border: `1px solid ${item.color}30` }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="rounded-lg flex items-center justify-center" style={{ width: '36px', height: '36px', background: `${item.color}18`, color: item.color }}>
                      <Icon size={16} />
                    </div>
                  </div>
                  <div style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '32px', color: item.color, lineHeight: 1 }}>{item.value}</div>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginTop: '4px' }}>{item.label}</div>
                </div>
              );
            })}
          </div>

          {/* Expiring contracts list */}
          {contractStats.expiringList.length > 0 ? (
            <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={16} color="#F59E0B" />
                <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>
                  العقود المنتهية خلال 90 يوم ({contractStats.expiringList.length})
                </span>
              </div>
              <div className="space-y-2">
                {contractStats.expiringList.map(({ emp, date, daysLeft }) => {
                  const urgency = daysLeft <= 30 ? '#EF4444' : daysLeft <= 60 ? '#F97316' : '#F59E0B';
                  return (
                    <div
                      key={emp.id}
                      className="flex items-center justify-between rounded-lg px-4 py-3 cursor-pointer transition-all"
                      style={{ background: `${urgency}08`, border: `1px solid ${urgency}25` }}
                      onClick={() => setProfileEmp(emp)}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = `${urgency}15`}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = `${urgency}08`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-full flex items-center justify-center" style={{ width: '36px', height: '36px', background: `${urgency}20`, color: urgency, fontFamily: 'Alexandria', fontWeight: 800, fontSize: '13px', flexShrink: 0 }}>
                          {emp.nameAr?.charAt(0) || '?'}
                        </div>
                        <div>
                          <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))' }}>{emp.nameAr}</div>
                          <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{emp.jobTitle} — {emp.department}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: urgency }}>{daysLeft} يوم متبقي</div>
                          <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{date.toLocaleDateString('ar-SA-u-ca-gregory')}</div>
                        </div>
                        <div className="rounded-full px-3 py-1" style={{ background: `${urgency}20`, color: urgency, fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700 }}>
                          {daysLeft <= 30 ? 'عاجل' : daysLeft <= 60 ? 'قريب' : 'تنبيه'}
                        </div>
                        <ChevronRight size={14} color="hsl(var(--muted-foreground))" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-10 flex flex-col items-center gap-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <CheckCircle2 size={48} color="#10B981" />
              <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '16px', color: '#10B981' }}>جميع العقود سارية المفعولة</div>
              <div style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>لا توجد عقود تنتهي خلال الـ 90 يوم القادمة</div>
            </div>
          )}
        </div>
      )}

      {/* ── Attendance Tab ── */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          {/* Attendance KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'أيام العمل المطلوبة', value: attendanceStats.totalRecords, color: TEAL, sub: 'بعد استثناء الإجازات' },
              { label: 'معدل الحضور الفعلي', value: `${attendanceStats.onTimeRate}%`, color: attendanceStats.onTimeRate >= 80 ? '#10B981' : '#F59E0B', sub: `${attendanceStats.absentCount ?? 0} غياب` },
              { label: 'نسبة الالتزام بالساعات', value: `${attendanceStats.complianceRate}%`, color: attendanceStats.complianceRate >= 80 ? '#10B981' : '#F97316', sub: `${attendanceStats.shortfallCount} ناقص 8 ساعات` },
              { label: 'موظفون مسجّلون', value: attendanceStats.uniqueEmployees, color: '#8B5CF6', sub: 'موظف' },
            ].map((item, i) => (
              <div key={item.label} className="rounded-xl p-4 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms`, opacity: 0, background: 'hsl(var(--card))', border: `1px solid ${item.color}30` }}>
                <div style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '28px', color: item.color, lineHeight: 1 }}>{item.value}</div>
                <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginTop: '6px' }}>{item.label}</div>
                <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>{item.sub}</div>
              </div>
            ))}
          </div>

          {/* Attendance trend */}
          {attendanceStats.trend.length > 0 && (
            <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={16} color={TEAL} />
                <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))' }}>اتجاه الحضور اليومي</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={attendanceStats.trend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="حاضر" stroke={TEAL} fill="hsl(var(--primary) / .14)" strokeWidth={2} dot={{ fill: TEAL, r: 3 }} />
                  <Area type="monotone" dataKey="متأخر" stroke="#EF4444" fill="rgba(239,68,68,.12)" strokeWidth={2} dot={{ fill: '#EF4444', r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-6 mt-3 justify-center">
                <div className="flex items-center gap-2"><div style={{ width: '12px', height: '3px', background: TEAL, borderRadius: '2px' }} /><span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>إجمالي الحضور</span></div>
                <div className="flex items-center gap-2"><div style={{ width: '12px', height: '3px', background: '#EF4444', borderRadius: '2px' }} /><span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>التأخر</span></div>
              </div>
            </div>
          )}

          {/* Compliance bars */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))', marginBottom: '16px' }}>معدل الحضور الفعلي</div>
              <div className="flex items-center gap-4">
                <div style={{ position: 'relative', width: '90px', height: '90px', flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '90px', height: '90px' }}>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={attendanceStats.onTimeRate >= 80 ? '#10B981' : '#F59E0B'} strokeWidth="3"
                      strokeDasharray={`${attendanceStats.onTimeRate} ${100 - attendanceStats.onTimeRate}`} strokeLinecap="round" />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <span style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '16px', color: attendanceStats.onTimeRate >= 80 ? '#10B981' : '#F59E0B' }}>{attendanceStats.onTimeRate}%</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between"><span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>حاضر</span><span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: '#10B981' }}>{attendanceStats.presentCount ?? attendanceStats.totalRecords}</span></div>
                  <div className="flex justify-between"><span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>غائب</span><span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: '#EF4444' }}>{attendanceStats.absentCount ?? 0}</span></div>
                  <div className="flex justify-between"><span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>أيام مطلوبة</span><span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: TEAL }}>{attendanceStats.totalRecords}</span></div>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(var(--foreground))', marginBottom: '16px' }}>الالتزام بساعات العمل (8 ساعات)</div>
              <div className="flex items-center gap-4">
                <div style={{ position: 'relative', width: '90px', height: '90px', flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '90px', height: '90px' }}>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={attendanceStats.complianceRate >= 80 ? '#10B981' : '#F97316'} strokeWidth="3"
                      strokeDasharray={`${attendanceStats.complianceRate} ${100 - attendanceStats.complianceRate}`} strokeLinecap="round" />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: 'Alexandria', fontWeight: 900, fontSize: '16px', color: attendanceStats.complianceRate >= 80 ? '#10B981' : '#F97316' }}>{attendanceStats.complianceRate}%</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between"><span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>ملتزم (8+ ساعات)</span><span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: '#10B981' }}>{(attendanceStats.presentCount ?? attendanceStats.totalRecords) - attendanceStats.shortfallCount}</span></div>
                  <div className="flex justify-between"><span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>ناقص 8 ساعات</span><span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: '#F97316' }}>{attendanceStats.shortfallCount}</span></div>
                  <div className="flex justify-between"><span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>الإجمالي</span><span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: TEAL }}>{attendanceStats.totalRecords}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Employee Profile Modal ── */}
      <EmployeeProfileModal employee={profileEmp} onClose={() => setProfileEmp(null)} />
    </div>
  );
}
