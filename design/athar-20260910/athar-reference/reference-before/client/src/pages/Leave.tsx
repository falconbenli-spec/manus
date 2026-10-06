/**
 * Leave Management - HCM Platform
 * Saudi Labor Law compliant leave system
 * Brand: People36t theme tokens
 */
import { useState, useMemo, useEffect } from "react";
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle, Plus, Search, FileText, BookOpen, ChevronDown, ChevronUp, RefreshCw, Wifi, WifiOff, Download } from "lucide-react";
import { exportLeaveRequests } from "@/lib/excelExport";
import { toast } from "sonner";
import PageTemplate from "@/components/layout/PageTemplate";
import leaveTypesRaw from "@/data/leaveTypes.json";
import LeaveRequestsTab from "@/components/LeaveRequestsTab";

type LeaveType = {
  id: string; nameAr: string; nameEn: string; daysPerYear: number;
  color: string; icon: string; paid: boolean; article: string;
  description: string; conditions: string; breakdown?: string;
  daysAfter5Years?: number; daysSpouse?: number;
};
type LeaveRequest = {
  id: string; employeeId: number; nameAr: string; department: string;
  leaveType: string; startDate: string; endDate: string; days: number;
  status: string; reason: string; appliedDate: string;
  approvedBy: string | null; notes: string;
};
type LeaveBalance = {
  employeeId: number; nameAr: string; department: string; yearsOfService: number;
  balances: Record<string, { total: number; used: number; remaining: number; pending: number }>;
};

const leaveTypes = leaveTypesRaw as LeaveType[];
const peoplePrimary = "hsl(var(--primary))";

const statusConfig: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  "معتمدة":       { color: peoplePrimary, bg: "hsl(var(--primary) / .12)", label: "معتمدة",       icon: <CheckCircle size={12} /> },
  "قيد المراجعة": { color: "#F59E0B", bg: "rgba(245,158,11,0.12)",  label: "قيد المراجعة", icon: <Clock size={12} /> },
  "مرفوضة":       { color: "#EF4444", bg: "rgba(239,68,68,0.12)",   label: "مرفوضة",       icon: <XCircle size={12} /> },
};

// Resolve leave types by ID or by their stored historical name.
const leaveTypeMap = Object.fromEntries(leaveTypes.map(t => [t.id, t]));
const leaveTypeByName = Object.fromEntries(leaveTypes.map(t => [t.nameAr, t]));

const th = (align: "right" | "center" | "left" = "right"): React.CSSProperties => ({
  padding: "10px 14px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700,
  color: peoplePrimary, textAlign: align, borderBottom: "1px solid hsl(0 0% 26%)",
  whiteSpace: "nowrap",
});
const td = (align: "right" | "center" | "left" = "right"): React.CSSProperties => ({
  padding: "10px 14px", fontFamily: "Alexandria", fontSize: "12px",
  color: "hsl(0 0% 82%)", textAlign: align,
  borderBottom: "1px solid hsl(0 0% 20%)",
});

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" });
}// ── New Request Form ────────────────────────────────────────────────────────────
function NewRequestForm({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "hsl(0 0% 16%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "16px", width: "100%", maxWidth: "520px", padding: "24px", direction: "rtl" }}>
        <h2 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "17px", color: "hsl(0 0% 96%)", margin: 0 }}>إنشاء طلب إداري غير متاح حالياً</h2>
        <p style={{ fontFamily: "Alexandria", fontSize: "13px", color: "hsl(0 0% 60%)", lineHeight: 1.8, margin: "12px 0 20px" }}>لا تجمع هذه الصفحة بيانات طلب الإجازة ولا تحاكي حفظه. يتطلب الإنشاء الإداري مساراً خادمياً محمياً يحدد الموظف ونطاق المدير ودورة الموافقات قبل تفعيله.</p>
        <button type="button" onClick={onClose} style={{ padding: "9px 20px", background: peoplePrimary, border: "none", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer" }}>إغلاق</button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Leave() {
  const [activeTab, setActiveTab] = useState<"overview" | "requests" | "balances" | "policy" | "submit">("overview");
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [typeFilter, setTypeFilter] = useState("الكل");
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  // Persisted leave data from the platform archive.
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSourceReady, setDataSourceReady] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const today = new Date();
  const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = today.toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  useEffect(() => {
    fetch("/api/leaves/archive", { credentials: "include" })
      .then(r => r.json())
      .then(d => setDataSourceReady(Array.isArray(d)))
      .catch(() => setDataSourceReady(false));
  }, []);

  const fetchLeaves = async () => {
    setLoading(true);
    setError(null);
    try {
      await loadArchivedLeaves();
    } catch {
      setError("تعذّر تحميل بيانات الإجازات المحفوظة");
    } finally {
      setLoading(false);
    }
  };

  const loadArchivedLeaves = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/leaves/archive", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const filtered = data.filter((item: any) => {
            const start = String(item.startDate ?? item.start_date ?? "");
            const end = String(item.endDate ?? item.end_date ?? start);
            return !start || (start <= toDate && end >= fromDate);
          });
          setLeaveRequests(filtered);
          setLastSync("من سجلات المنصة الداخلية");
          setDataSourceReady(true);
          if (filtered.length > 0) toast.success(`تم تحميل ${filtered.length} طلب إجازة محفوظ`);
          return true;
        } else {
          setError("لا توجد بيانات إجازات محفوظة متاحة.");
        }
      }
    } catch {
      setError("تعذّر تحميل بيانات الإجازات");
    }
    return false;
  };

  useEffect(() => {
    if (dataSourceReady !== null) fetchLeaves();
  }, [dataSourceReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // KPI stats
  const kpis = useMemo(() => {
    const total = leaveRequests.length;
    const approved = leaveRequests.filter(r => r.status === "معتمدة").length;
    const pending = leaveRequests.filter(r => r.status === "قيد المراجعة").length;
    const rejected = leaveRequests.filter(r => r.status === "مرفوضة").length;
    const totalDays = leaveRequests.filter(r => r.status === "معتمدة").reduce((s, r) => s + r.days, 0);
    return { total, approved, pending, rejected, totalDays };
  }, [leaveRequests]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return leaveRequests.filter(r => {
      const matchSearch = !searchQuery || r.nameAr.includes(searchQuery) || r.department.includes(searchQuery) || r.id.includes(searchQuery);
      const matchStatus = statusFilter === "الكل" || r.status === statusFilter;
      const matchType = typeFilter === "الكل" || r.leaveType === typeFilter;
      return matchSearch && matchStatus && matchType;
    });
  }, [leaveRequests, searchQuery, statusFilter, typeFilter]);

  const totalPages = Math.ceil(filteredRequests.length / PAGE_SIZE);
  const pagedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Leave type distribution
  const typeDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    leaveRequests.forEach(r => { map[r.leaveType] = (map[r.leaveType] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({
      id: name,
      count,
      // Try to find matching type by ID first, then by name, then create a fallback
      type: leaveTypeMap[name] || leaveTypeByName[name] || {
        id: name, nameAr: name, nameEn: name, daysPerYear: 0,
        color: peoplePrimary, icon: "", paid: true, article: "",
        description: "", conditions: ""
      }
    }))
      .sort((a, b) => b.count - a.count);
  }, [leaveRequests]);

  const tabs = [
    { id: "overview", label: "نظرة عامة", icon: <Calendar size={14} /> },
    { id: "requests", label: "طلبات الإجازة", icon: <FileText size={14} /> },
    { id: "balances", label: "أرصدة الموظفين", icon: <Clock size={14} /> },
    { id: "policy", label: "سياسة الإجازات", icon: <BookOpen size={14} /> },
    { id: "submit", label: "تقديم طلب إجازة", icon: <Plus size={14} /> },
  ];

  return (
    <PageTemplate title="إدارة الإجازات" subtitle="نظام الإجازات وفق نظام العمل السعودي" icon={Calendar}>
      {showNewRequest && (
        <NewRequestForm onClose={() => setShowNewRequest(false)} />
      )}

      {/* Zoho connection status + date range */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", direction: "rtl", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {dataSourceReady === null ? (
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>جارٍ التحقق من السجلات المحفوظة...</span>
          ) : dataSourceReady ? (
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontFamily: "Alexandria", fontSize: "12px", color: peoplePrimary }}>
              <Wifi size={13} /> سجلات الإجازات الداخلية جاهزة
              {lastSync && <span style={{ color: "hsl(0 0% 45%)", marginRight: "6px" }}>· آخر تحديث: {lastSync}</span>}
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontFamily: "Alexandria", fontSize: "12px", color: "#EF4444" }}>
              <WifiOff size={13} /> تعذر الوصول إلى سجلات الإجازات الداخلية
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)", color: "hsl(0 0% 77%)", borderRadius: "7px", padding: "5px 8px", fontFamily: "Alexandria", fontSize: "12px" }} />
          <span style={{ color: "hsl(0 0% 45%)", fontFamily: "Alexandria", fontSize: "12px" }}>إلى</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            style={{ background: "hsl(0 0% 20%)", border: "1px solid hsl(0 0% 28%)", color: "hsl(0 0% 77%)", borderRadius: "7px", padding: "5px 8px", fontFamily: "Alexandria", fontSize: "12px" }} />
          <button onClick={fetchLeaves} disabled={loading || !dataSourceReady}
            style={{ display: "flex", alignItems: "center", gap: "5px", background: peoplePrimary, color: "white", border: "none", borderRadius: "8px", padding: "6px 14px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: loading || !dataSourceReady ? "not-allowed" : "pointer", opacity: loading || !dataSourceReady ? 0.6 : 1 }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {loading ? "جارٍ الجلب..." : "تحديث"}
          </button>
          <button
            onClick={() => { if (!leaveRequests.length) { toast.error('لا توجد بيانات للتصدير'); return; } exportLeaveRequests(leaveRequests); toast.success('جارٍ تحميل ملف Excel...'); }}
            style={{ display: "flex", alignItems: "center", gap: "5px", background: "hsl(0 0% 26%)", color: "hsl(0 0% 75%)", border: "1px solid hsl(0 0% 28%)", borderRadius: "8px", padding: "6px 12px", fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
          >
            <Download size={13} />تصدير Excel
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "12px 16px", marginBottom: "12px", fontFamily: "Alexandria", fontSize: "13px", color: "#EF4444", direction: "rtl" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "hsl(0 0% 50%)", fontFamily: "Alexandria" }}>
          <RefreshCw size={32} style={{ margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: "14px" }}>جارٍ تحميل بيانات الإجازات المحفوظة في المنصة...</div>
        </div>
      )}

      {/* Internal data unavailable state */}
      {!loading && !dataSourceReady && dataSourceReady !== null && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(0 0% 50%)", fontFamily: "Alexandria" }}>
          <WifiOff size={48} style={{ margin: "0 auto 16px", opacity: 0.3 }} />
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>بيانات الإجازات الداخلية غير متاحة حالياً</div>
          <div style={{ fontSize: "13px" }}>يرجى التحقق من حفظ بيانات الإجازات داخل المنصة.</div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", direction: "rtl" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as typeof activeTab)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 16px", borderRadius: "8px", cursor: "pointer",
                fontFamily: "Alexandria", fontSize: "13px", fontWeight: 600,
                background: activeTab === t.id ? peoplePrimary : "hsl(0 0% 18%)",
                color: activeTab === t.id ? "#fff" : "hsl(0 0% 65%)",
                border: activeTab === t.id ? "none" : "1px solid hsl(0 0% 26%)",
                transition: "all 0.2s",
              }}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNewRequest(true)}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 18px", background: peoplePrimary, border: "none", borderRadius: "9px", fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer" }}
        >
          <Plus size={14} />طلب إجازة جديد
        </button>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", direction: "rtl" }}>
          {leaveRequests.length === 0 && (
            <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(0 0% 50%)",fontFamily:"Alexandria"}}>
              <Calendar size={48} style={{margin:"0 auto 16px",opacity:0.3}} />
              <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>لا توجد طلبات إجازة بعد</div>
              <div style={{fontSize:"13px"}}>سيتم عرض طلبات الإجازة هنا بعد إدخال البيانات</div>
            </div>
          )}
          {leaveRequests.length > 0 && <>{/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px" }}>
            {[
              { label: "إجمالي الطلبات", value: kpis.total, color: peoplePrimary, icon: "📋" },
              { label: "طلبات معتمدة", value: kpis.approved, color: "#10B981", icon: "✅" },
              { label: "قيد المراجعة", value: kpis.pending, color: "#F59E0B", icon: "⏳" },
              { label: "مرفوضة", value: kpis.rejected, color: "#EF4444", icon: "❌" },
              { label: "أيام إجازة معتمدة", value: kpis.totalDays, color: "#8B5CF6", icon: "📅" },
            ].map(k => (
              <div key={k.label} style={{ background: `${k.color}10`, border: `1px solid ${k.color}25`, borderRadius: "12px", padding: "16px" }}>
                <div style={{ fontSize: "22px", marginBottom: "8px" }}>{k.icon}</div>
                <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "22px", color: k.color, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 60%)", marginTop: "4px" }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Leave type distribution */}
          <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "14px", padding: "20px" }}>
            <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(0 0% 88%)", marginBottom: "16px", marginTop: 0 }}>توزيع الطلبات حسب نوع الإجازة</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {typeDistribution.map(({ id, count, type }) => (
                <div key={id}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 75%)" }}>{type.nameAr}</span>
                    <span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: type.color }}>{count} طلب</span>
                  </div>
                  <div style={{ height: "6px", borderRadius: "999px", background: "hsl(0 0% 26%)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(count / kpis.total) * 100}%`, background: type.color, borderRadius: "999px", transition: "width 0.8s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent requests */}
          <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid hsl(0 0% 22%)" }}>
              <h3 style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(0 0% 88%)", margin: 0 }}>آخر الطلبات</h3>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl" }}>
                <thead style={{ background: "hsl(0 0% 18%)" }}>
                  <tr>
                    <th style={th()}>الموظف</th>
                    <th style={th()}>نوع الإجازة</th>
                    <th style={th("center")}>المدة</th>
                    <th style={th("center")}>الحالة</th>
                    <th style={th()}>تاريخ التقديم</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.slice(0, 8).map(r => {
                    const lt = leaveTypeMap[r.leaveType];
                    const sc = statusConfig[r.status] || statusConfig["قيد المراجعة"];
                    return (
                      <tr key={r.id} style={{ transition: "background 0.15s" }}>
                        <td style={td()}>
                          <div style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 600, color: "hsl(0 0% 88%)" }}>{r.nameAr}</div>
                          <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 55%)" }}>{r.department}</div>
                        </td>
                        <td style={td()}>
                          {lt && <span style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 600, color: lt.color, background: `${lt.color}15`, padding: "2px 8px", borderRadius: "20px" }}>{lt.nameAr}</span>}
                        </td>
                        <td style={td("center")}>
                          <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 75%)" }}>{r.days} يوم</span>
                        </td>
                        <td style={td("center")}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: sc.color, background: sc.bg, padding: "3px 10px", borderRadius: "20px" }}>
                            {sc.icon}{sc.label}
                          </span>
                        </td>
                        <td style={td()}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 60%)" }}>{formatDate(r.appliedDate)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>}
        </div>
      )}

      {/* ── REQUESTS TAB ── */}
      {activeTab === "requests" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", direction: "rtl" }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
              <Search size={14} style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "hsl(0 0% 50%)" }} />
              <input
                type="text"
                placeholder="بحث بالاسم أو القسم..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                style={{ width: "100%", padding: "8px 32px 8px 12px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "13px", color: "hsl(0 0% 88%)", outline: "none", direction: "rtl", boxSizing: "border-box" }}
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)", direction: "rtl" }}
            >
              <option value="الكل">كل الحالات</option>
              <option value="معتمدة">معتمدة</option>
              <option value="قيد المراجعة">قيد المراجعة</option>
              <option value="مرفوضة">مرفوضة</option>
            </select>
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "8px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)", direction: "rtl" }}
            >
              <option value="الكل">كل الأنواع</option>
              {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
            </select>
            <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>{filteredRequests.length} طلب</span>
          </div>

          {leaveRequests.length === 0 && (
            <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(0 0% 50%)",fontFamily:"Alexandria"}}>
              <FileText size={48} style={{margin:"0 auto 16px",opacity:0.3}} />
              <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>لا توجد طلبات إجازة بعد</div>
              <div style={{fontSize:"13px"}}>سيتم عرض طلبات الإجازة هنا بعد إدخال البيانات</div>
            </div>
          )}
          {leaveRequests.length > 0 && <>
          {/* Table */}
          <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl", minWidth: "750px" }}>
                <thead style={{ background: "hsl(0 0% 18%)" }}>
                  <tr>
                    <th style={th()}>رقم الطلب</th>
                    <th style={th()}>الموظف</th>
                    <th style={th()}>نوع الإجازة</th>
                    <th style={th("center")}>من</th>
                    <th style={th("center")}>إلى</th>
                    <th style={th("center")}>الأيام</th>
                    <th style={th("center")}>الحالة</th>
                    <th style={th()}>السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRequests.map(r => {
                    const lt = leaveTypeMap[r.leaveType];
                    const sc = statusConfig[r.status] || statusConfig["قيد المراجعة"];
                    return (
                      <tr key={r.id}>
                        <td style={td()}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "#1FA98C", fontWeight: 700 }}>{r.id}</span></td>
                        <td style={td()}>
                          <div style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 600, color: "hsl(0 0% 88%)" }}>{r.nameAr}</div>
                          <div style={{ fontFamily: "Alexandria", fontSize: "10px", color: "hsl(0 0% 55%)" }}>{r.department}</div>
                        </td>
                        <td style={td()}>
                          {lt && <span style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 600, color: lt.color, background: `${lt.color}15`, padding: "2px 8px", borderRadius: "20px", whiteSpace: "nowrap" }}>{lt.nameAr}</span>}
                        </td>
                        <td style={td("center")}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 70%)" }}>{formatDate(r.startDate)}</span></td>
                        <td style={td("center")}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 70%)" }}>{formatDate(r.endDate)}</span></td>
                        <td style={td("center")}><span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: "hsl(0 0% 82%)" }}>{r.days}</span></td>
                        <td style={td("center")}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: sc.color, background: sc.bg, padding: "3px 10px", borderRadius: "20px", whiteSpace: "nowrap" }}>
                            {sc.icon}{sc.label}
                          </span>
                        </td>
                        <td style={td()}><span style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 60%)" }}>{r.reason}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid hsl(0 0% 22%)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: "6px 14px", background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)", borderRadius: "6px", fontFamily: "Alexandria", fontSize: "12px", color: page === 1 ? "hsl(0 0% 40%)" : "hsl(0 0% 75%)", cursor: page === 1 ? "not-allowed" : "pointer" }}>السابق</button>
                <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 55%)" }}>صفحة {page} من {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: "6px 14px", background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)", borderRadius: "6px", fontFamily: "Alexandria", fontSize: "12px", color: page === totalPages ? "hsl(0 0% 40%)" : "hsl(0 0% 75%)", cursor: page === totalPages ? "not-allowed" : "pointer" }}>التالي</button>
              </div>
            )}
          </div>
          </>}
        </div>
      )}

      {/* ── BALANCES TAB ── */}
      {activeTab === "balances" && (
        <div style={{ direction: "rtl" }}>
          {/* Summary of leave days used per employee from Zoho data */}
          {leaveRequests.length === 0 ? (
            <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(0 0% 50%)",fontFamily:"Alexandria"}}>
              <Clock size={48} style={{margin:"0 auto 16px",opacity:0.3}} />
              <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>لا توجد بيانات إجازات</div>
              <div style={{fontSize:"13px"}}>اضغط على «تحديث» لجلب بيانات الإجازات من Zoho People</div>
            </div>
          ) : (
            <div style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)", borderRadius: "14px", overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl", minWidth: "600px" }}>
                  <thead style={{ background: "hsl(0 0% 18%)" }}>
                    <tr>
                      <th style={th()}>الموظف</th>
                      <th style={th("center")}>إجازات معتمدة</th>
                      <th style={th("center")}>إجازات معلقة</th>
                      <th style={th("center")}>إجازات مرفوضة</th>
                      <th style={th("center")}>إجمالي الأيام</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(
                      leaveRequests.reduce((acc: Record<string, {name: string; approved: number; pending: number; rejected: number}>, r) => {
                        const key = String(r.employeeId);
                        if (!acc[key]) acc[key] = { name: r.nameAr, approved: 0, pending: 0, rejected: 0 };
                        if (r.status === "معتمدة") acc[key].approved += r.days;
                        else if (r.status === "قيد المراجعة") acc[key].pending += r.days;
                        else if (r.status === "مرفوضة") acc[key].rejected += r.days;
                        return acc;
                      }, {})
                    ).map(([id, emp]) => (
                      <tr key={id}>
                        <td style={td()}>
                          <div style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 600, color: "hsl(0 0% 88%)" }}>{emp.name}</div>
                        </td>
                        <td style={td("center")}>
                          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#1FA98C" }}>{emp.approved} يوم</span>
                        </td>
                        <td style={td("center")}>
                          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#F59E0B" }}>{emp.pending} يوم</span>
                        </td>
                        <td style={td("center")}>
                          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: emp.rejected > 0 ? "#EF4444" : "hsl(0 0% 45%)" }}>{emp.rejected} يوم</span>
                        </td>
                        <td style={td("center")}>
                          <span style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 65%)" }}>{emp.approved + emp.pending} يوم</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── POLICY TAB ── */}
      {activeTab === "policy" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", direction: "rtl" }}>
          <div style={{ padding: "14px 18px", background: "hsl(165 69% 39% / 0.08)", border: "1px solid hsl(165 69% 39% / 0.25)", borderRadius: "10px", marginBottom: "4px" }}>
            <p style={{ fontFamily: "Alexandria", fontSize: "13px", color: "#1FA98C", margin: 0, fontWeight: 600 }}>
              📋 جميع الإجازات وفق نظام العمل السعودي الصادر بالمرسوم الملكي رقم م/51 وتعديلاته
            </p>
          </div>
          {leaveTypes.map(t => (
            <div
              key={t.id}
              style={{ background: "hsl(0 0% 18%)", border: `1px solid ${expandedPolicy === t.id ? t.color + "40" : "hsl(0 0% 26%)"}`, borderRadius: "12px", overflow: "hidden", transition: "border-color 0.2s" }}
            >
              <button
                onClick={() => setExpandedPolicy(expandedPolicy === t.id ? null : t.id)}
                style={{ width: "100%", padding: "14px 18px", background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", direction: "rtl" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: `${t.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: t.color }} />
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "Alexandria", fontWeight: 700, fontSize: "14px", color: "hsl(0 0% 90%)" }}>{t.nameAr}</div>
                    <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 55%)" }}>{t.paid ? "بأجر" : "بدون أجر"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontFamily: "Alexandria", fontSize: "12px", fontWeight: 700, color: t.color, background: `${t.color}15`, padding: "3px 10px", borderRadius: "20px" }}>
                    {t.daysPerYear > 0 ? `${t.daysPerYear} يوم` : "حسب الحاجة"}
                  </span>
                  {expandedPolicy === t.id ? <ChevronUp size={16} color="hsl(0 0% 55%)" /> : <ChevronDown size={16} color="hsl(0 0% 55%)" />}
                </div>
              </button>
              {expandedPolicy === t.id && (
                <div style={{ padding: "0 18px 16px", borderTop: "1px solid hsl(0 0% 22%)" }}>
                  <div style={{ paddingTop: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div style={{ background: "hsl(0 0% 18%)", borderRadius: "8px", padding: "12px" }}>
                      <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 55%)", marginBottom: "4px" }}>الوصف</div>
                      <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)" }}>{t.description}</div>
                    </div>
                    <div style={{ background: "hsl(0 0% 18%)", borderRadius: "8px", padding: "12px" }}>
                      <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 55%)", marginBottom: "4px" }}>الشروط</div>
                      <div style={{ fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 80%)" }}>{t.conditions}</div>
                    </div>
                    {t.breakdown && (
                      <div style={{ gridColumn: "1 / -1", background: `${t.color}10`, border: `1px solid ${t.color}25`, borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: t.color, fontWeight: 700 }}>التفاصيل: {t.breakdown}</div>
                      </div>
                    )}
                    {t.daysAfter5Years && (
                      <div style={{ gridColumn: "1 / -1", background: "hsl(165 69% 39% / 0.08)", border: "1px solid hsl(165 69% 39% / 0.25)", borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "#1FA98C", fontWeight: 700 }}>
                          ⭐ بعد 5 سنوات خدمة: {t.daysAfter5Years} يوم
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* ── SUBMIT REQUEST TAB ── */}
      {activeTab === "submit" && (
        <LeaveRequestsTab />
      )}
    </PageTemplate>
  );
}
