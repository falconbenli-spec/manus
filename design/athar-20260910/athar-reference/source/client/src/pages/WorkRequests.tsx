import PageTemplate from '@/components/layout/PageTemplate';
import DetailPanel from '@/components/experience/DetailPanel';
import RequestTrail from '@/components/experience/RequestTrail';
import {ErrorState} from '@/components/feedback/AsyncState';
import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useEmployees } from "../contexts/EmployeeContext";
import {
  Send, Plus, Search, Filter, Clock, CheckCircle2, AlertCircle, XCircle,
  ArrowUpDown, MoreVertical, Calendar, User, Building2, Flag, Edit2, Trash2,
  Eye, MessageSquare, ChevronDown, LayoutGrid, List, Loader2, Star, X
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface WorkRequest {
  id: string;
  title: string;
  description: string;
  fromDept: string;
  toDept: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "new" | "reviewing" | "in_progress" | "pending_approval" | "completed" | "rejected" | "cancelled";
  assigneeId?: string | null;
  assigneeName?: string | null;
  createdById: string;
  createdByName: string;
  dueDate?: number | null;
  completedAt?: number | null;
  notes?: string | null;
  rating?: number | null;
  ratingComment?: string | null;
  createdAt: number;
  updatedAt: number;
}

const DEPARTMENTS = [
  "الإدارة التنفيذية", "إدارة الإنتاج", "الإدارة الرقمية",
  "إدارة العلاقات العامة", "الإدارة الإبداعية", "إدارة تطوير الأعمال",
  "إدارة الموارد البشرية", "إدارة التسويق"
];
const peoplePrimary = "hsl(var(--primary))";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  new:         { label: "جديد",           color: "#F59E0B", bg: "rgba(245,158,11,0.12)", icon: Clock },
  reviewing:   { label: "قيد المراجعة",  color: "#8B5CF6", bg: "rgba(139,92,246,0.12)", icon: Eye },
  in_progress: { label: "قيد التنفيذ",   color: "#3B82F6", bg: "rgba(59,130,246,0.12)", icon: Loader2 },
  pending_approval: { label: "بانتظار الاعتماد", color: "#6366F1", bg: "rgba(99,102,241,0.12)", icon: Eye },
  completed:   { label: "مكتمل",         color: "#10B981", bg: "rgba(16,185,129,0.12)", icon: CheckCircle2 },
  rejected:    { label: "مرفوض",         color: "#EF4444", bg: "rgba(239,68,68,0.12)",  icon: XCircle },
  cancelled:   { label: "ملغي",          color: "#6B7280", bg: "rgba(107,114,128,0.12)", icon: XCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  low:    { label: "منخفض", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
  medium: { label: "متوسط", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  high:   { label: "عالي",  color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  urgent: { label: "عاجل",  color: "#DC2626", bg: "rgba(220,38,38,0.2)" },
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid hsl(var(--primary) / .25)", background: "hsl(var(--muted))",
  color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: "none" as const, cursor: "pointer",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2315A085' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "left 12px center",
};

export default function WorkRequests() {
  const { user } = useAuth();
  const { employees } = useEmployees();
  const [requests, setRequests] = useState<WorkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState<string|null>(null);
  const requestVersion=useRef(0);
  const [showModal, setShowModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<WorkRequest | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [filterDept, setFilterDept] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [detailRequest, setDetailRequest] = useState<WorkRequest | null>(null);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [savingRating, setSavingRating] = useState(false);
  const canManage = ["owner", "admin", "manager"].includes(user?.role || "");

  const getApiError = async (response: Response, fallback: string): Promise<string> => {
    const body = await response.json().catch(() => ({}));
    return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  };

  // Form state
  const [form, setForm] = useState({
    title: "", description: "", fromDept: "", toDept: "",
    priority: "medium" as string, assigneeId: "", dueDate: "",
  });

  const fetchRequests = async () => {
    const version=++requestVersion.current;setLoading(true);setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (filterDept) params.set("dept", filterDept);
      if (filterStatus) params.set("status", filterStatus);
      if (filterPriority) params.set("priority", filterPriority);
      const res = await fetch(`/api/services/work-requests?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await getApiError(res, "فشل تحميل الطلبات"));
      const data=await res.json();if(!Array.isArray(data))throw Error("تعذّر قراءة الطلبات");if(version===requestVersion.current)setRequests(data);
    } catch (error) {if(version===requestVersion.current)setLoadError(error instanceof Error?error.message:"تعذّر تحميل الطلبات");}
    finally {if(version===requestVersion.current)setLoading(false);}
  };

  useEffect(() => {void fetchRequests();return()=>{requestVersion.current++}}, [filterDept, filterStatus, filterPriority]);
  useEffect(() => {
    setRating(detailRequest?.rating ?? 0);
    setRatingComment(detailRequest?.ratingComment ?? "");
  }, [detailRequest?.id]);

  const filtered = useMemo(() => {
    if (!searchTerm) return requests;
    const q = searchTerm.toLowerCase();
    return requests.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.fromDept.toLowerCase().includes(q) ||
      r.toDept.toLowerCase().includes(q)
    );
  }, [requests, searchTerm]);

  const openCreate = () => {
    setEditingRequest(null);
    setForm({ title: "", description: "", fromDept: "", toDept: "", priority: "medium", assigneeId: "", dueDate: "" });
    setShowModal(true);
  };

  const openEdit = (req: WorkRequest) => {
    setEditingRequest(req);
    setForm({
      title: req.title, description: req.description, fromDept: req.fromDept,
      toDept: req.toDept, priority: req.priority, assigneeId: req.assigneeId || "",
      dueDate: req.dueDate ? new Date(req.dueDate).toISOString().slice(0, 10) : "",
    });
    setShowModal(true);
  };

  const [saving,setSaving]=useState(false);
  const saveLock=useRef(false);
  const handleSave = async () => {
    if(saveLock.current)return;
    if (!form.title || !form.fromDept || !form.toDept) {
      toast.error("يرجى تعبئة الحقول المطلوبة");
      return;
    }
    saveLock.current=true;setSaving(true);
    try {
      if (editingRequest) {
        const res = await fetch(`/api/services/work-requests/${editingRequest.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error(await getApiError(res, "تعذر تحديث الطلب"));
        toast.success("تم تحديث الطلب بنجاح");
      } else {
        const res = await fetch("/api/services/work-requests", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify({
            ...form,
            assigneeName: employees.find((emp: any) => String(emp.employeeId) === form.assigneeId)?.nameAr || "",
          }),
        });
        if (!res.ok) throw new Error(await getApiError(res, "تعذر إنشاء الطلب"));
        toast.success("تم إنشاء الطلب بنجاح");
      }
      setShowModal(false);
      fetchRequests();
    } catch (error) { toast.error(error instanceof Error ? error.message : "حدث خطأ"); } finally {saveLock.current=false;setSaving(false);}
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/services/work-requests/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await getApiError(res, "فشل تحديث الحالة"));
      toast.success("تم تحديث الحالة");
      fetchRequests();
    } catch (error) { toast.error(error instanceof Error ? error.message : "فشل التحديث"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا الطلب؟")) return;
    try {
      const res = await fetch(`/api/services/work-requests/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await getApiError(res, "فشل حذف الطلب"));
      toast.success("تم حذف الطلب");
      fetchRequests();
    } catch (error) { toast.error(error instanceof Error ? error.message : "فشل الحذف"); }
  };

  const handleRatingSubmit = async (id: string) => {
    if (rating < 1 || rating > 5) {
      toast.error("اختر تقييماً من نجمة إلى خمس نجوم");
      return;
    }
    setSavingRating(true);
    try {
      const res = await fetch(`/api/services/work-requests/${id}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rating, ratingComment }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "تعذر حفظ التقييم");
      }
      toast.success("تم حفظ تقييم التسليم");
      setDetailRequest(null);
      fetchRequests();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ التقييم");
    } finally {
      setSavingRating(false);
    }
  };

  const stats = useMemo(() => ({
    total: filtered.length,
    pending: filtered.filter(r => r.status === "new").length,
    inProgress: filtered.filter(r => r.status === "in_progress").length,
    review: filtered.filter(r => r.status === "reviewing" || r.status === "pending_approval").length,
    completed: filtered.filter(r => r.status === "completed").length,
  }), [filtered]);

  const report = useMemo(() => {
    const completedWithDuration = filtered.filter(request =>
      request.status === "completed" && request.completedAt && request.createdAt
    );
    const averageCompletionDays = completedWithDuration.length
      ? completedWithDuration.reduce((total, request) => total + ((request.completedAt! - request.createdAt) / 86_400_000), 0) / completedWithDuration.length
      : null;
    const departmentCounts = Object.entries(filtered.reduce<Record<string, number>>((counts, request) => {
      counts[request.toDept] = (counts[request.toDept] || 0) + 1;
      return counts;
    }, {})).sort(([, left], [, right]) => right - left);
    return {
      averageCompletionDays,
      completionRate: filtered.length ? Math.round((stats.completed / filtered.length) * 100) : 0,
      departmentCounts,
      maxDepartmentCount: Math.max(...departmentCounts.map(([, count]) => count), 1),
    };
  }, [filtered, stats.completed]);

  /* ─── Kanban Column ─────────────────────────────────────────────────── */
  const KanbanColumn = ({ status, items }: { status: string; items: WorkRequest[] }) => {
    const cfg = STATUS_CONFIG[status];
    return (
      <div style={{ flex: 1, minWidth: 280, maxWidth: 340 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          padding: "10px 14px", borderRadius: 10, background: cfg.bg,
        }}>
          <cfg.icon size={16} style={{ color: cfg.color }} />
          <span style={{ fontWeight: 700, color: cfg.color, fontSize: 14 }}>{cfg.label}</span>
          <span style={{
            marginRight: "auto", background: cfg.color, color: "#fff",
            borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700,
          }}>{items.length}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 200 }}>
          {items.map(req => (
            <RequestCard key={req.id} req={req} />
          ))}
          {items.length === 0 && (
            <div style={{ textAlign: "center", padding: 24, color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              لا توجد طلبات
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ─── Request Card ──────────────────────────────────────────────────── */
  const RequestCard = ({ req }: { req: WorkRequest }) => {
    const prCfg = PRIORITY_CONFIG[req.priority];
    const [showActions, setShowActions] = useState(false);
    return (
      <div
        style={{
          background: "hsl(var(--card))", borderRadius: 12,
          border: "1px solid hsl(165 69% 39% / 0.12)", padding: 16,
          cursor: "pointer", transition: "border-color 150ms ease, background-color 150ms ease",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(165 69% 39% / 0.35)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(165 69% 39% / 0.12)"; setShowActions(false); }}

      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <button type="button" onClick={()=>setDetailRequest(req)} aria-label={`فتح الطلب: ${req.title}`} style={{background:"none",border:0,padding:0,textAlign:"right",fontSize:14,fontWeight:700,color:"hsl(var(--foreground))",lineHeight:1.7,flex:1}}>{req.title}</button>
          <div style={{ position: "relative" }}>
            <button
              onClick={e => { e.stopPropagation(); setShowActions(!showActions); }} aria-label={`إجراءات ${req.title}`} aria-expanded={showActions}
              style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 4 }}
            >
              <MoreVertical size={14} />
            </button>
            {showActions && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: "absolute", left: 0, top: "100%", zIndex: 50,
                  background: "hsl(var(--border))", borderRadius: 8,
                  border: "1px solid hsl(165 69% 39% / 0.20)", minWidth: 140,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {canManage && <>
                  <button onClick={() => { openEdit(req); setShowActions(false); }} style={actionBtnStyle}>
                    <Edit2 size={13} /> تعديل
                  </button>
                  {req.status === "new" && (
                    <button onClick={() => { handleStatusChange(req.id, "reviewing"); setShowActions(false); }} style={actionBtnStyle}>
                      <Eye size={13} /> بدء المراجعة
                    </button>
                  )}
                </>}
                {canManage && req.status === "reviewing" && (
                  <button onClick={() => { handleStatusChange(req.id, "in_progress"); setShowActions(false); }} style={actionBtnStyle}>
                    <Loader2 size={13} /> بدء التنفيذ
                  </button>
                )}
                {req.status === "in_progress" && (
                  <button onClick={() => { handleStatusChange(req.id, "pending_approval"); setShowActions(false); }} style={actionBtnStyle}>
                    <Eye size={13} /> إرسال للاعتماد
                  </button>
                )}
                {canManage && req.status === "pending_approval" && (
                  <button onClick={() => { handleStatusChange(req.id, "completed"); setShowActions(false); }} style={actionBtnStyle}>
                    <CheckCircle2 size={13} /> اعتماد
                  </button>
                )}
                {canManage && <button onClick={() => { handleDelete(req.id); setShowActions(false); }} style={{ ...actionBtnStyle, color: "#EF4444" }}>
                  <Trash2 size={13} /> حذف
                </button>}
              </div>
            )}
          </div>
        </div>
        {req.description && (
          <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "0 0 10px", lineHeight: 1.5, maxHeight: 36, overflow: "hidden" }}>
            {req.description}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          <span style={{ ...tagStyle, background: prCfg.bg, color: prCfg.color }}>
            <Flag size={10} /> {prCfg.label}
          </span>
          <span style={{ ...tagStyle, background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}>
            <Building2 size={10} /> {req.toDept}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
            <Send size={10} /> {req.fromDept}
          </div>
          {req.dueDate && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              <Calendar size={10} /> {new Date(req.dueDate).toLocaleDateString("ar-SA-u-ca-gregory")}
            </div>
          )}
        </div>
      </div>
    );
  };

  const actionBtnStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "8px 14px", background: "none", border: "none",
    color: "hsl(var(--foreground))", fontSize: 13, fontFamily: "Alexandria", cursor: "pointer",
    textAlign: "right",
  };

  const tagStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
  };

  return (
    <PageTemplate title="طلبات الأعمال" subtitle="من فريق إلى فريق. كل طلب، وخطوته القادمة." icon={Send} actions={<button onClick={openCreate} className="btn-brand"><Plus size={16}/>طلب جديد</button>}>
      {!loading&&!loadError&&<>
      <div className="metric-strip">
        {[
          { label: "إجمالي الطلبات", value: stats.total, color: peoplePrimary },
          { label: "جديد", value: stats.pending, color: "#F59E0B" },
          { label: "قيد التنفيذ", value: stats.inProgress, color: "#3B82F6" },
          { label: "المراجعة والاعتماد", value: stats.review, color: "#8B5CF6" },
          { label: "مكتمل", value: stats.completed, color: "#10B981" },
        ].map((s, i) => (
          <div key={i} className="metric-strip__item"><span>{s.label}</span><strong>{s.value}</strong></div>
        ))}
      </div>

      <details className="athar-request-report"><summary>ملخص الطلبات ضمن النطاق الحالي</summary>
      <section aria-label="تقرير طلبات الأعمال" style={{
        background: "hsl(var(--card))", borderRadius: 12,
        border: "1px solid hsl(165 69% 39% / 0.10)", padding: 18, marginBottom: 20,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
          <div>
            <h2 style={{ color: "hsl(var(--foreground))", fontSize: 16, fontWeight: 800, margin: 0 }}>تقرير نطاق الطلبات</h2>
            <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 12, margin: "5px 0 0" }}>يعكس هذا التقرير الطلبات المتاحة لك فقط، ويتغير وفق الفلاتر الحالية.</p>
          </div>
          <span style={{ ...tagStyle, background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C" }}>{filtered.length} طلباً ضمن النطاق</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "hsl(var(--card))", borderRadius: 10, padding: 14 }}>
            <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>معدل إكمال الطلبات</div>
            <div style={{ color: "#10B981", fontSize: 24, fontWeight: 900, marginTop: 4 }}>{report.completionRate}%</div>
          </div>
          <div style={{ background: "hsl(var(--card))", borderRadius: 10, padding: 14 }}>
            <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>متوسط وقت الإنجاز</div>
            <div style={{ color: peoplePrimary, fontSize: 24, fontWeight: 900, marginTop: 4 }}>
              {report.averageCompletionDays === null ? "—" : `${report.averageCompletionDays.toFixed(1)} يوم`}
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "hsl(var(--foreground))", fontSize: 13, fontWeight: 700 }}>الطلبات حسب الإدارة المستقبلة</div>
          {report.departmentCounts.length ? report.departmentCounts.map(([department, count]) => (
            <div key={department} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr auto", alignItems: "center", gap: 10 }}>
              <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>{department}</span>
              <div aria-hidden="true" style={{ height: 7, background: "hsl(var(--border))", borderRadius: 999 }}>
                <div style={{ width: `${(count / report.maxDepartmentCount) * 100}%`, height: "100%", background: peoplePrimary, borderRadius: 999 }} />
              </div>
              <span style={{ color: "hsl(var(--foreground))", fontSize: 12, fontWeight: 700 }}>{count}</span>
            </div>
          )) : <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 13, margin: 0 }}>لا تتوفر بيانات كافية ضمن النطاق الحالي.</p>}
        </div>
      </section></details></>}

      {/* Filters */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20,
        background: "hsl(var(--card))", borderRadius: 12,
        border: "1px solid hsl(165 69% 39% / 0.10)", padding: 16,
      }}>
        <div style={{ flex: "1 1 200px", position: "relative" }}>
          <Search size={14} style={{ position: "absolute", right: 12, top: 12, color: "hsl(var(--muted-foreground))" }} />
          <input
            placeholder="بحث في الطلبات..." aria-label="البحث في طلبات الأعمال"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ ...inputStyle, paddingRight: 36 }}
          />
        </div>
        <select aria-label="الإدارة المستقبلة" value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...selectStyle, flex: "0 1 200px" }}>
          <option value="">كل الإدارات</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label="حالة الطلب" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...selectStyle, flex: "0 1 160px" }}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select aria-label="أولوية الطلب" value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ ...selectStyle, flex: "0 1 140px" }}>
          <option value="">كل الأولويات</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setViewMode("kanban")} aria-label="عرض اللوحة" aria-pressed={viewMode==="kanban"}
            style={{
              ...viewBtnStyle,
              background: viewMode === "kanban" ? "hsl(165 69% 39% / 0.15)" : "transparent",
              color: viewMode === "kanban" ? "#1FA98C" : "hsl(var(--muted-foreground))",
            }}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode("list")} aria-label="عرض القائمة" aria-pressed={viewMode==="list"}
            style={{
              ...viewBtnStyle,
              background: viewMode === "list" ? "hsl(165 69% 39% / 0.15)" : "transparent",
              color: viewMode === "list" ? "#1FA98C" : "hsl(var(--muted-foreground))",
            }}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loadError ? <ErrorState title="تعذّر تحميل الطلبات" message={loadError} onRetry={()=>void fetchRequests()}/> : loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
          <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 12px" }} />
          <p>جاري التحميل...</p>
        </div>
      ) : viewMode === "kanban" ? (
        <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 20 }}>
          {["new", "reviewing", "in_progress", "pending_approval", "completed", "rejected", "cancelled"].map(status => (
            <KanbanColumn key={status} status={status} items={filtered.filter(r => r.status === status)} />
          ))}
        </div>
      ) : (
        <div style={{
          background: "hsl(var(--card))", borderRadius: 12,
          border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "hsl(var(--card))" }}>
                {["العنوان", "من", "إلى", "الأولوية", "الحالة", "التاريخ", "إجراءات"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", color: "#1FA98C", fontWeight: 700, textAlign: "right", borderBottom: "1px solid hsl(165 69% 39% / 0.10)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(req => {
                const stCfg = STATUS_CONFIG[req.status];
                const prCfg = PRIORITY_CONFIG[req.priority];
                return (
                  <tr key={req.id} style={{ borderBottom: "1px solid hsl(165 69% 39% / 0.06)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "hsl(var(--card))"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                  >
                    <td style={tdStyle}>
                      <button type="button" style={{background:"none",border:0,textAlign:"start",cursor:"pointer",color:"hsl(var(--foreground))",fontWeight:600}} onClick={()=>setDetailRequest(req)}>{req.title}</button>
                    </td>
                    <td style={tdStyle}>{req.fromDept}</td>
                    <td style={tdStyle}>{req.toDept}</td>
                    <td style={tdStyle}>
                      <span style={{ ...tagStyle, background: prCfg.bg, color: prCfg.color }}>{prCfg.label}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ ...tagStyle, background: stCfg.bg, color: stCfg.color }}>{stCfg.label}</span>
                    </td>
                    <td style={tdStyle}>{new Date(req.createdAt).toLocaleDateString("ar-SA-u-ca-gregory")}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {canManage && <>
                          <button onClick={() => openEdit(req)} style={iconBtnStyle}><Edit2 size={13} /></button>
                          <button onClick={() => handleDelete(req.id)} style={{ ...iconBtnStyle, color: "#EF4444" }}><Trash2 size={13} /></button>
                        </>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "hsl(var(--muted-foreground))" }}>
              لا توجد طلبات
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <DetailPanel returnFocusLabel="طلب جديد" open={showModal} onClose={()=>setShowModal(false)} title={editingRequest?"تعديل الطلب":"طلب عمل جديد"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>
                {editingRequest ? "تعديل الطلب" : "طلب عمل جديد"}
              </h2>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label htmlFor="work-title" style={labelStyle}>عنوان الطلب *</label>
                <input id="work-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="مثال: تصميم هوية بصرية لعميل جديد" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="work-description" style={labelStyle}>الوصف</label>
                <textarea id="work-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="تفاصيل الطلب والمتطلبات..." rows={3} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="work-fromDept" style={labelStyle}>من إدارة *</label>
                  <select id="work-fromDept" value={form.fromDept} onChange={e => setForm({ ...form, fromDept: e.target.value })} style={selectStyle}>
                    <option value="">اختر الإدارة</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="work-toDept" style={labelStyle}>إلى إدارة *</label>
                  <select id="work-toDept" value={form.toDept} onChange={e => setForm({ ...form, toDept: e.target.value })} style={selectStyle}>
                    <option value="">اختر الإدارة</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="work-priority" style={labelStyle}>الأولوية</label>
                  <select id="work-priority" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={selectStyle}>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="work-dueDate" style={labelStyle}>تاريخ التسليم</label>
                  <input type="date" id="work-dueDate" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <div>
                <label htmlFor="work-assigneeId" style={labelStyle}>المسؤول عن التنفيذ</label>
                <select id="work-assigneeId" value={form.assigneeId} onChange={e => setForm({ ...form, assigneeId: e.target.value })} style={selectStyle}>
                  <option value="">اختر موظف</option>
                  {employees.map((emp: any) => (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {emp.nameAr || emp.name} ({emp.employeeId})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button disabled={saving} onClick={handleSave} className="btn-brand" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <CheckCircle2 size={16} /> {saving?"جارٍ الحفظ…":editingRequest ? "تحديث" : "إرسال الطلب"}
              </button>
              <button onClick={() => setShowModal(false)} style={{
                flex: 0.5, padding: "10px 20px", borderRadius: 10,
                border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent",
                color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer",
              }}>
                <X size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> إلغاء
              </button>
            </div>
        </DetailPanel>
      )}

      {/* Detail Modal */}
      {detailRequest && (
        <DetailPanel open={!!detailRequest} onClose={()=>setDetailRequest(null)} title={detailRequest.title} side>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: "0 0 6px" }}>{detailRequest.title}</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ ...tagStyle, background: STATUS_CONFIG[detailRequest.status].bg, color: STATUS_CONFIG[detailRequest.status].color }}>
                    {STATUS_CONFIG[detailRequest.status].label}
                  </span>
                  <span style={{ ...tagStyle, background: PRIORITY_CONFIG[detailRequest.priority].bg, color: PRIORITY_CONFIG[detailRequest.priority].color }}>
                    {PRIORITY_CONFIG[detailRequest.priority].label}
                  </span>
                </div>
              </div>
            </div>

            <RequestTrail status={detailRequest.status}/>
            {detailRequest.description && (
              <div style={{ background: "hsl(var(--card))", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <p style={{ color: "hsl(var(--foreground))", fontSize: 14, lineHeight: 1.7, margin: 0 }}>{detailRequest.description}</p>
              </div>
            )}

            {detailRequest.status === "completed" && detailRequest.rating != null && (
              <div style={{ background: "hsl(165 69% 39% / 0.10)", border: "1px solid hsl(165 69% 39% / 0.20)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ color: "hsl(var(--foreground))", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>تقييم مقدم الطلب</div>
                <div style={{ display: "flex", gap: 3, color: "#F59E0B", marginBottom: detailRequest.ratingComment ? 8 : 0 }}>
                  {Array.from({ length: 5 }, (_, index) => <Star key={index} size={18} fill={index < detailRequest.rating! ? "currentColor" : "none"} />)}
                </div>
                {detailRequest.ratingComment && <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 13, lineHeight: 1.6, margin: 0 }}>{detailRequest.ratingComment}</p>}
              </div>
            )}

            {detailRequest.status === "completed" && detailRequest.rating == null && detailRequest.createdById === user?.id && (
              <div style={{ background: "hsl(165 69% 39% / 0.10)", border: "1px solid hsl(165 69% 39% / 0.20)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ color: "hsl(var(--foreground))", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>قيّم تسليم هذا الطلب</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <button key={index} type="button" onClick={() => setRating(index + 1)} aria-label={`تقييم ${index + 1} من 5`} style={{ color: index < rating ? "#F59E0B" : "hsl(var(--muted-foreground))", background: "transparent", border: "none", padding: 1, cursor: "pointer" }}>
                      <Star size={24} fill={index < rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
                <textarea value={ratingComment} onChange={event => setRatingComment(event.target.value)} maxLength={1000} rows={2} placeholder="ملاحظة اختيارية عن التسليم" style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }} />
                <button type="button" disabled={savingRating} onClick={() => handleRatingSubmit(detailRequest.id)} className="btn-brand" style={{ width: "100%", opacity: savingRating ? 0.7 : 1 }}>
                  {savingRating ? "جارٍ الحفظ..." : "حفظ التقييم"}
                </button>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                { icon: Send, label: "من إدارة", value: detailRequest.fromDept },
                { icon: Building2, label: "إلى إدارة", value: detailRequest.toDept },
                { icon: User, label: "مقدم الطلب", value: detailRequest.createdByName },
                { icon: User, label: "المسؤول", value: detailRequest.assigneeName || "غير محدد" },
                { icon: Calendar, label: "تاريخ الإنشاء", value: new Date(detailRequest.createdAt).toLocaleDateString("ar-SA-u-ca-gregory") },
                { icon: Calendar, label: "تاريخ التسليم", value: detailRequest.dueDate ? new Date(detailRequest.dueDate).toLocaleDateString("ar-SA-u-ca-gregory") : "غير محدد" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "hsl(var(--card))", borderRadius: 8 }}>
                  <item.icon size={14} style={{ color: "#1FA98C" }} />
                  <div>
                    <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{item.label}</div>
                    <div style={{ fontSize: 13, color: "hsl(var(--foreground))", fontWeight: 600 }}>{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Status change buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canManage && detailRequest.status === "pending_approval" && (
                <button onClick={() => { handleStatusChange(detailRequest.id, "completed"); setDetailRequest(null); }} className="btn-brand" style={{ fontSize: 13, padding: "8px 16px" }}>
                  <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> اعتماد
                </button>
              )}
              {canManage && detailRequest.status === "new" && (
                <button onClick={() => { handleStatusChange(detailRequest.id, "reviewing"); setDetailRequest(null); }} style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(59,130,246,0.3)",
                  background: "rgba(59,130,246,0.1)", color: "#3B82F6", fontSize: 13, fontFamily: "Alexandria", cursor: "pointer",
                }}>
                  <Eye size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> بدء المراجعة
                </button>
              )}
              {canManage && <button onClick={() => { openEdit(detailRequest); setDetailRequest(null); }} style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid hsl(165 69% 39% / 0.25)",
                background: "transparent", color: "hsl(var(--foreground))", fontSize: 13, fontFamily: "Alexandria", cursor: "pointer",
              }}>
                <Edit2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> تعديل
              </button>}
            </div>
        </DetailPanel>
      )}
    </PageTemplate>
  );
}

const viewBtnStyle: React.CSSProperties = {
  padding: 8, borderRadius: 8, border: "1px solid hsl(165 69% 39% / 0.15)",
  cursor: "pointer", display: "flex", alignItems: "center",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px", color: "hsl(var(--foreground))", fontSize: 13,
};

const iconBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "hsl(var(--muted-foreground))",
  cursor: "pointer", padding: 4, borderRadius: 4,
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 13, fontWeight: 700, color: "hsl(var(--muted-foreground))",
  marginBottom: 6, fontFamily: "Alexandria",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.6)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20,
};

const modalStyle: React.CSSProperties = {
  background: "hsl(var(--card))", borderRadius: 16,
  border: "1px solid hsl(165 69% 39% / 0.20)", padding: 28,
  maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto",
  fontFamily: "Alexandria", direction: "rtl",
};
