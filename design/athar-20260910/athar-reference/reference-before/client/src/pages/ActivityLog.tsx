import { useState, useMemo } from "react";
import { useActivityLog, CATEGORY_LABELS, CATEGORY_COLORS, SEVERITY_COLORS, ActivityCategory, ActivitySeverity } from "@/contexts/ActivityLogContext";
import PageTemplate from "@/components/layout/PageTemplate";
import { Activity, Search, Filter, Download, Trash2, Clock, User, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";
import { exportActivityLog } from "@/lib/excelExport";
const peoplePrimary = "hsl(var(--primary))";

const SEVERITY_ICONS: Record<ActivitySeverity, React.ReactNode> = {
  info: <Info size={13} />,
  success: <CheckCircle size={13} />,
  warning: <AlertTriangle size={13} />,
  error: <XCircle size={13} />,
};

const SEVERITY_LABELS: Record<ActivitySeverity, string> = {
  info: "معلومة",
  success: "نجاح",
  warning: "تحذير",
  error: "خطأ",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("ar-SA-u-ca-gregory", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date} — ${time}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `منذ ${days} يوم`;
}

export default function ActivityLog() {
  const { logs, clearLogs } = useActivityLog();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<ActivitySeverity | "all">("all");
  const [userFilter, setUserFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 25;

  // Unique users for filter
  const uniqueUsers = useMemo(() => {
    const map = new Map<string, string>();
    logs.forEach(l => map.set(l.userId, l.userName));
    return Array.from(map.entries());
  }, [logs]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (severityFilter !== "all" && l.severity !== severityFilter) return false;
      if (userFilter !== "all" && l.userId !== userFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!l.action.toLowerCase().includes(q) && !l.details.toLowerCase().includes(q) && !l.userName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [logs, categoryFilter, severityFilter, userFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Stats
  const stats = useMemo(() => ({
    total: logs.length,
    today: logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString()).length,
    errors: logs.filter(l => l.severity === "error").length,
    warnings: logs.filter(l => l.severity === "warning").length,
  }), [logs]);

  function exportExcel() {
    exportActivityLog(filtered.map(l => ({
      timestamp: formatTimestamp(l.timestamp), userName: l.userName, userRole: l.userRole,
      category: CATEGORY_LABELS[l.category], action: l.action, details: l.details,
      severity: SEVERITY_LABELS[l.severity],
    })));
  }

  function handleClear() {
    if (window.confirm("هل أنت متأكد من حذف جميع سجلات النشاط؟ لا يمكن التراجع عن هذا الإجراء.")) {
      clearLogs();
    }
  }

  const cardStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    padding: "16px 20px",
  };

  return (
    <PageTemplate
      title="سجل النشاط"
      subtitle="تتبع وتسجيل جميع إجراءات المستخدمين في النظام"
      icon={Activity}
      actions={
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={exportExcel}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", borderRadius: "8px",
              background: "hsl(var(--primary) / 0.15)", border: "1px solid hsl(var(--primary) / 0.30)",
              color: peoplePrimary, fontSize: "13px", fontFamily: "Alexandria, system-ui, sans-serif",
              cursor: "pointer", fontWeight: 600,
            }}
          >
            <Download size={14} /> تصدير Excel
          </button>
          <button
            onClick={handleClear}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", borderRadius: "8px",
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
              color: "#EF4444", fontSize: "13px", fontFamily: "Alexandria, system-ui, sans-serif",
              cursor: "pointer", fontWeight: 600,
            }}
          >
            <Trash2 size={14} /> مسح السجل
          </button>
        </div>
      }
    >
      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "إجمالي السجلات", value: stats.total, color: peoplePrimary, icon: <Activity size={18} /> },
          { label: "نشاط اليوم", value: stats.today, color: "#3B82F6", icon: <Clock size={18} /> },
          { label: "تحذيرات", value: stats.warnings, color: "#F59E0B", icon: <AlertTriangle size={18} /> },
          { label: "أخطاء", value: stats.errors, color: "#EF4444", icon: <XCircle size={18} /> },
        ].map(kpi => (
          <div key={kpi.label} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{
              width: "42px", height: "42px", borderRadius: "10px",
              background: `${kpi.color}20`, border: `1px solid ${kpi.color}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: kpi.color, flexShrink: 0,
            }}>
              {kpi.icon}
            </div>
            <div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: kpi.color, lineHeight: 1 }}>{kpi.value}</div>
              <div style={{ fontSize: "12px", color: "hsl(0 0% 60%)", marginTop: "3px" }}>{kpi.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ ...cardStyle, marginBottom: "16px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1", minWidth: "200px" }}>
          <Search size={14} style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "hsl(0 0% 50%)" }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="بحث في السجل..."
            style={{
              width: "100%", padding: "8px 32px 8px 12px", borderRadius: "8px",
              background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)",
              color: "hsl(0 0% 88%)", fontSize: "13px", fontFamily: "Alexandria, system-ui, sans-serif",
              direction: "rtl", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
        {/* Category */}
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value as ActivityCategory | "all"); setPage(1); }}
          style={{
            padding: "8px 12px", borderRadius: "8px",
            background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)",
            color: "hsl(0 0% 88%)", fontSize: "13px", fontFamily: "Alexandria, system-ui, sans-serif",
            direction: "rtl", outline: "none", cursor: "pointer",
          }}
        >
          <option value="all">جميع الفئات</option>
          {(Object.entries(CATEGORY_LABELS) as [ActivityCategory, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {/* Severity */}
        <select
          value={severityFilter}
          onChange={e => { setSeverityFilter(e.target.value as ActivitySeverity | "all"); setPage(1); }}
          style={{
            padding: "8px 12px", borderRadius: "8px",
            background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)",
            color: "hsl(0 0% 88%)", fontSize: "13px", fontFamily: "Alexandria, system-ui, sans-serif",
            direction: "rtl", outline: "none", cursor: "pointer",
          }}
        >
          <option value="all">جميع الشدات</option>
          {(Object.entries(SEVERITY_LABELS) as [ActivitySeverity, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {/* User */}
        <select
          value={userFilter}
          onChange={e => { setUserFilter(e.target.value); setPage(1); }}
          style={{
            padding: "8px 12px", borderRadius: "8px",
            background: "hsl(0 0% 22%)", border: "1px solid hsl(0 0% 28%)",
            color: "hsl(0 0% 88%)", fontSize: "13px", fontFamily: "Alexandria, system-ui, sans-serif",
            direction: "rtl", outline: "none", cursor: "pointer",
          }}
        >
          <option value="all">جميع المستخدمين</option>
          {uniqueUsers.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <span style={{ fontSize: "12px", color: "hsl(0 0% 55%)", marginRight: "auto" }}>
          {filtered.length} سجل
        </span>
      </div>

      {/* Log Timeline */}
      <div style={{ ...cardStyle, padding: "0" }}>
        {paginated.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center" }}>
            <Activity size={40} style={{ color: "hsl(0 0% 35%)", margin: "0 auto 12px" }} />
            <div style={{ color: "hsl(0 0% 55%)", fontSize: "14px" }}>
              {logs.length === 0 ? "لا توجد سجلات نشاط بعد — ستُسجَّل الإجراءات تلقائياً عند استخدام المنصة" : "لا توجد نتائج تطابق الفلاتر المحددة"}
            </div>
          </div>
        ) : (
          <div>
            {paginated.map((entry, idx) => {
              const catColor = CATEGORY_COLORS[entry.category];
              const sevColor = SEVERITY_COLORS[entry.severity];
              const isExpanded = expandedId === entry.id;
              const isLast = idx === paginated.length - 1;

              return (
                <div
                  key={entry.id}
                  style={{
                    borderBottom: isLast ? "none" : "1px solid hsl(0 0% 26%)",
                    padding: "14px 20px",
                    cursor: "pointer",
                    transition: "background 0.15s",
                    background: isExpanded ? "hsl(0 0% 20%)" : "transparent",
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "hsl(0 0% 21%)"; }}
                  onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {/* Severity dot */}
                    <div style={{
                      width: "8px", height: "8px", borderRadius: "50%",
                      background: sevColor, flexShrink: 0,
                      boxShadow: `0 0 6px ${sevColor}60`,
                    }} />

                    {/* Category badge */}
                    <span style={{
                      padding: "2px 8px", borderRadius: "20px", fontSize: "11px", fontWeight: 600,
                      background: `${catColor}18`, color: catColor, border: `1px solid ${catColor}30`,
                      flexShrink: 0,
                    }}>
                      {CATEGORY_LABELS[entry.category]}
                    </span>

                    {/* Action */}
                    <span style={{ fontWeight: 700, fontSize: "13px", color: "hsl(0 0% 88%)", flexShrink: 0 }}>
                      {entry.action}
                    </span>

                    {/* Details preview */}
                    <span style={{ fontSize: "12px", color: "hsl(0 0% 60%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {entry.details}
                    </span>

                    {/* User */}
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
                      <div style={{
                        width: "22px", height: "22px", borderRadius: "50%",
                        background: "hsl(var(--primary) / 0.20)", border: "1px solid hsl(var(--primary) / 0.30)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "10px", fontWeight: 700, color: peoplePrimary,
                      }}>
                        {entry.userName.charAt(0)}
                      </div>
                      <span style={{ fontSize: "12px", color: "hsl(0 0% 65%)" }}>{entry.userName}</span>
                    </div>

                    {/* Time */}
                    <span style={{ fontSize: "11px", color: "hsl(0 0% 50%)", flexShrink: 0 }}>
                      {timeAgo(entry.timestamp)}
                    </span>

                    {/* Expand icon */}
                    <div style={{ color: "hsl(0 0% 45%)", flexShrink: 0 }}>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{
                      marginTop: "12px", padding: "14px 16px", borderRadius: "8px",
                      background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 26%)",
                    }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "12px" }}>
                        {[
                          { label: "التاريخ والوقت", value: formatTimestamp(entry.timestamp), icon: <Clock size={12} /> },
                          { label: "المستخدم", value: `${entry.userName} (${entry.userRole})`, icon: <User size={12} /> },
                          { label: "الشدة", value: SEVERITY_LABELS[entry.severity], icon: SEVERITY_ICONS[entry.severity], color: sevColor },
                        ].map(item => (
                          <div key={item.label}>
                            <div style={{ fontSize: "11px", color: "hsl(0 0% 50%)", marginBottom: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{ color: item.color || "hsl(0 0% 50%)" }}>{item.icon}</span>
                              {item.label}
                            </div>
                            <div style={{ fontSize: "13px", color: item.color || "hsl(0 0% 82%)", fontWeight: 600 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: "11px", color: "hsl(0 0% 50%)", marginBottom: "4px" }}>التفاصيل الكاملة</div>
                        <div style={{ fontSize: "13px", color: "hsl(0 0% 80%)", lineHeight: 1.6 }}>{entry.details}</div>
                      </div>
                      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                        <div style={{ marginTop: "10px" }}>
                          <div style={{ fontSize: "11px", color: "hsl(0 0% 50%)", marginBottom: "6px" }}>بيانات إضافية</div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            {Object.entries(entry.metadata).map(([k, v]) => (
                              <span key={k} style={{
                                padding: "2px 8px", borderRadius: "6px", fontSize: "11px",
                                background: "hsl(0 0% 26%)", color: "hsl(0 0% 70%)",
                              }}>
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginTop: "16px" }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "6px 14px", borderRadius: "8px", fontSize: "13px",
              background: page === 1 ? "hsl(var(--muted))" : "hsl(var(--primary) / 0.15)",
              border: `1px solid ${page === 1 ? "hsl(var(--border))" : "hsl(var(--primary) / 0.30)"}`,
              color: page === 1 ? "hsl(var(--muted-foreground))" : peoplePrimary,
              cursor: page === 1 ? "not-allowed" : "pointer", fontFamily: "Alexandria, system-ui, sans-serif",
            }}
          >السابق</button>
          <span style={{ fontSize: "13px", color: "hsl(0 0% 65%)" }}>
            صفحة {page} من {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: "6px 14px", borderRadius: "8px", fontSize: "13px",
              background: page === totalPages ? "hsl(var(--muted))" : "hsl(var(--primary) / 0.15)",
              border: `1px solid ${page === totalPages ? "hsl(var(--border))" : "hsl(var(--primary) / 0.30)"}`,
              color: page === totalPages ? "hsl(var(--muted-foreground))" : peoplePrimary,
              cursor: page === totalPages ? "not-allowed" : "pointer", fontFamily: "Alexandria, system-ui, sans-serif",
            }}
          >التالي</button>
        </div>
      )}
    </PageTemplate>
  );
}
