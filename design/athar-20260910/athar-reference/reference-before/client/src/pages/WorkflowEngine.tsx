/**
 * Workflow Engine - محرك سير العمل الآلي
 * إنشاء وإدارة سير العمل للعمليات HR
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PageTemplate from "@/components/layout/PageTemplate";
import { GitBranch, Play, Pause, CheckCircle2, XCircle, Clock, Plus, Settings, Ticket, Send, MessageSquare } from "lucide-react";
import { toast } from "sonner";
const peoplePrimary = "hsl(var(--primary))";

interface WorkflowRequest {
  id: string;
  type: string;
  employee_id: string;
  employee_name: string;
  department: string;
  title: string;
  description: string;
  data: any;
  status: string;
  current_level: number;
  max_levels: number;
  priority: string;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
  approvals?: any[];
}

interface HrTicket {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string;
  resolution: string;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}

const TYPE_LABELS: Record<string, string> = {
  leave: "إجازة",
  promotion: "ترقية",
  transfer: "نقل",
  salary_increase: "زيادة راتب",
  training: "تدريب",
  resignation: "استقالة",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد المراجعة",
  manager_approved: "موافقة المدير",
  hr_approved: "موافقة HR",
  approved: "معتمد",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

const TICKET_CATEGORIES: Record<string, string> = {
  general: "عام",
  complaint: "شكوى",
  suggestion: "اقتراح",
  document_request: "طلب مستند",
  salary_inquiry: "استفسار راتب",
  other: "أخرى",
};

const TICKET_STATUS: Record<string, string> = {
  open: "مفتوحة",
  in_progress: "قيد المعالجة",
  resolved: "تم الحل",
  closed: "مغلقة",
};

function getStatusBadge(status: string) {
  switch (status) {
    case "approved": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400"><CheckCircle2 size={10} /> معتمد</span>;
    case "rejected": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400"><XCircle size={10} /> مرفوض</span>;
    case "pending": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400"><Clock size={10} /> قيد المراجعة</span>;
    case "manager_approved": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400"><Play size={10} /> موافقة المدير</span>;
    case "hr_approved": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400"><Play size={10} /> موافقة HR</span>;
    case "cancelled": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400"><Pause size={10} /> ملغي</span>;
    default: return <span className="text-xs text-gray-400">{STATUS_LABELS[status] || status}</span>;
  }
}

function getTicketStatusBadge(status: string) {
  switch (status) {
    case "open": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">مفتوحة</span>;
    case "in_progress": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">قيد المعالجة</span>;
    case "resolved": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">تم الحل</span>;
    case "closed": return <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400">مغلقة</span>;
    default: return null;
  }
}

function getPriorityBadge(priority: string) {
  switch (priority) {
    case "urgent": return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">عاجل</span>;
    case "high": return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400">مرتفع</span>;
    case "medium": return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">متوسط</span>;
    case "low": return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400">منخفض</span>;
    default: return null;
  }
}

function formatDate(ts: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

// ── New Request Modal ─────────────────────────────────────────────────────
function NewRequestModal({ onClose, onSave }: { onClose: () => void; onSave: (data: any) => void }) {
  const [form, setForm] = useState({
    type: "leave",
    employeeName: "",
    employeeId: "",
    department: "",
    title: "",
    description: "",
    priority: "medium",
    maxLevels: 2,
  });
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  function save() {
    if (!form.title.trim()) { toast.error("يرجى إدخال عنوان الطلب"); return; }
    if (!form.employeeName.trim()) { toast.error("يرجى إدخال اسم الموظف"); return; }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl p-6 w-full max-w-lg" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 28%)", direction: "rtl" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: peoplePrimary }}>طلب جديد</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>نوع الطلب *</label>
              <select value={form.type} onChange={e => set("type", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>الأولوية</label>
              <select value={form.priority} onChange={e => set("priority", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }}>
                <option value="low">منخفض</option>
                <option value="medium">متوسط</option>
                <option value="high">مرتفع</option>
                <option value="urgent">عاجل</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>اسم الموظف *</label>
              <input value={form.employeeName} onChange={e => set("employeeName", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>القسم</label>
              <input value={form.department} onChange={e => set("department", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>عنوان الطلب *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>التفاصيل</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg text-sm resize-none" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>مستويات الموافقة</label>
              <select value={form.maxLevels} onChange={e => set("maxLevels", parseInt(e.target.value))} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }}>
                <option value={1}>مستوى واحد (المدير)</option>
                <option value={2}>مستويان (المدير + HR)</option>
                <option value={3}>ثلاث مستويات (المدير + HR + CEO)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>رقم الموظف</label>
              <input value={form.employeeId} onChange={e => set("employeeId", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", outline: "none" }} />
            </div>
          </div>
          <div className="flex gap-3 mt-3">
            <button className="btn-brand flex-1" onClick={save}>إرسال الطلب</button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm" style={{ fontFamily: "Alexandria", background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 70%)" }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── New Ticket Modal ─────────────────────────────────────────────────────
function NewTicketModal({ onClose, onSave }: { onClose: () => void; onSave: (data: any) => void }) {
  const [form, setForm] = useState({
    employeeName: "",
    employeeId: "",
    department: "",
    category: "general",
    subject: "",
    description: "",
    priority: "medium",
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  function save() {
    if (!form.subject.trim()) { toast.error("يرجى إدخال موضوع التذكرة"); return; }
    if (!form.employeeName.trim()) { toast.error("يرجى إدخال اسم الموظف"); return; }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl p-6 w-full max-w-lg" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 28%)", direction: "rtl" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: peoplePrimary }}>تذكرة جديدة</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>اسم الموظف *</label>
              <input value={form.employeeName} onChange={e => set("employeeName", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>التصنيف</label>
              <select value={form.category} onChange={e => set("category", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }}>
                {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>الموضوع *</label>
            <input value={form.subject} onChange={e => set("subject", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>التفاصيل</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg text-sm resize-none" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>الأولوية</label>
              <select value={form.priority} onChange={e => set("priority", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }}>
                <option value="low">منخفض</option>
                <option value="medium">متوسط</option>
                <option value="high">مرتفع</option>
                <option value="urgent">عاجل</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>القسم</label>
              <input value={form.department} onChange={e => set("department", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
            </div>
          </div>
          <div className="flex gap-3 mt-3">
            <button className="btn-brand flex-1" onClick={save}>إرسال التذكرة</button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm" style={{ fontFamily: "Alexandria", background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 70%)" }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Approval Modal ─────────────────────────────────────────────────────
function ApprovalModal({ request, onClose, onApprove }: { request: WorkflowRequest; onClose: () => void; onApprove: (action: "approved" | "rejected", comment: string) => void }) {
  const [comment, setComment] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 28%)", direction: "rtl" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "16px", color: peoplePrimary }}>اتخاذ إجراء</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <div className="mb-4 p-3 rounded-lg" style={{ background: "hsl(0 0% 16%)" }}>
          <div className="text-sm text-white font-bold mb-1">{request.title}</div>
          <div className="text-xs text-gray-400">من: {request.employee_name} | النوع: {TYPE_LABELS[request.type] || request.type}</div>
          <div className="text-xs text-gray-400 mt-1">المستوى الحالي: {request.current_level} من {request.max_levels}</div>
        </div>
        <div className="mb-4">
          <label className="text-xs text-gray-400 block mb-1" style={{ fontFamily: "Alexandria" }}>ملاحظات (اختياري)</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm resize-none" style={{ background: "hsl(0 0% 26%)", border: "1px solid hsl(0 0% 33%)", color: "hsl(0 0% 88%)", fontFamily: "Alexandria", outline: "none" }} />
        </div>
        <div className="flex gap-3">
          <button className="flex-1 rounded-lg py-2 text-sm font-bold text-white" style={{ background: peoplePrimary }} onClick={() => onApprove("approved", comment)}>
            <CheckCircle2 size={14} className="inline ml-1" /> موافقة
          </button>
          <button className="flex-1 rounded-lg py-2 text-sm font-bold text-white" style={{ background: "#ef4444" }} onClick={() => onApprove("rejected", comment)}>
            <XCircle size={14} className="inline ml-1" /> رفض
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowEngine() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"requests" | "tickets">("requests");
  const [requests, setRequests] = useState<WorkflowRequest[]>([]);
  const [tickets, setTickets] = useState<HrTicket[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState<WorkflowRequest | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [reqRes, ticketRes, statsRes] = await Promise.all([
        fetch("/api/workflow/requests"),
        fetch("/api/workflow/tickets"),
        fetch("/api/workflow/stats"),
      ]);
      if (reqRes.ok) setRequests(await reqRes.json());
      if (ticketRes.ok) setTickets(await ticketRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) {
      console.error("Error loading workflow data", e);
    }
    setLoading(false);
  }

  async function handleCreateRequest(data: any) {
    try {
      const res = await fetch("/api/workflow/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast.success("تم إرسال الطلب بنجاح");
        setShowNewRequest(false);
        loadData();
      } else {
        toast.error("حدث خطأ في إرسال الطلب");
      }
    } catch { toast.error("خطأ في الاتصال"); }
  }

  async function handleCreateTicket(data: any) {
    try {
      const res = await fetch("/api/workflow/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast.success("تم إرسال التذكرة بنجاح");
        setShowNewTicket(false);
        loadData();
      } else {
        toast.error("حدث خطأ في إرسال التذكرة");
      }
    } catch { toast.error("خطأ في الاتصال"); }
  }

  async function handleApproval(action: "approved" | "rejected", comment: string) {
    if (!approvalTarget) return;
    try {
      const res = await fetch("/api/workflow/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: approvalTarget.id,
          level: approvalTarget.current_level,
          action,
          comment,
          approverName: user?.name || "المدير",
        }),
      });
      if (res.ok) {
        toast.success(action === "approved" ? "تمت الموافقة" : "تم الرفض");
        setApprovalTarget(null);
        loadData();
      } else {
        toast.error("حدث خطأ");
      }
    } catch { toast.error("خطأ في الاتصال"); }
  }

  async function handleUpdateTicketStatus(ticketId: string, status: string) {
    try {
      const res = await fetch("/api/workflow/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ticketId, status }),
      });
      if (res.ok) {
        toast.success("تم تحديث حالة التذكرة");
        loadData();
      }
    } catch { toast.error("خطأ في الاتصال"); }
  }

  const filteredRequests = requests.filter(r => {
    if (filterType !== "all" && r.type !== filterType) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  });

  return (
    <PageTemplate
      title="سير العمل والطلبات"
      subtitle="إدارة الطلبات والموافقات وتذاكر الموارد البشرية"
      icon={GitBranch}
    >
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="stat-card text-center">
          <div className="text-2xl font-bold text-white">{stats?.totalRequests || requests.length}</div>
          <div className="text-xs text-gray-400 mt-1">إجمالي الطلبات</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-2xl font-bold" style={{ color: "#f59e0b" }}>{stats?.pendingRequests || requests.filter(r => r.status === "pending").length}</div>
          <div className="text-xs text-gray-400 mt-1">بانتظار الموافقة</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-2xl font-bold" style={{ color: peoplePrimary }}>{stats?.totalTickets || tickets.length}</div>
          <div className="text-xs text-gray-400 mt-1">تذاكر HR</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-2xl font-bold text-blue-400">{stats?.openTickets || tickets.filter(t => t.status === "open").length}</div>
          <div className="text-xs text-gray-400 mt-1">تذاكر مفتوحة</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("requests")}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
            style={{ background: activeTab === "requests" ? peoplePrimary : "rgba(255,255,255,0.05)", color: "white" }}
          >
            <Send size={14} /> الطلبات والموافقات
          </button>
          <button
            onClick={() => setActiveTab("tickets")}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
            style={{ background: activeTab === "tickets" ? peoplePrimary : "rgba(255,255,255,0.05)", color: "white" }}
          >
            <Ticket size={14} /> تذاكر HR
          </button>
        </div>
        {activeTab === "requests" ? (
          <button className="btn-brand flex items-center gap-2" onClick={() => setShowNewRequest(true)}>
            <Plus size={16} /> طلب جديد
          </button>
        ) : (
          <button className="btn-brand flex items-center gap-2" onClick={() => setShowNewTicket(true)}>
            <Plus size={16} /> تذكرة جديدة
          </button>
        )}
      </div>

      {/* Modals */}
      {showNewRequest && <NewRequestModal onClose={() => setShowNewRequest(false)} onSave={handleCreateRequest} />}
      {showNewTicket && <NewTicketModal onClose={() => setShowNewTicket(false)} onSave={handleCreateTicket} />}
      {approvalTarget && <ApprovalModal request={approvalTarget} onClose={() => setApprovalTarget(null)} onApprove={handleApproval} />}

      {/* Requests Tab */}
      {activeTab === "requests" && (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontFamily: "Alexandria" }}
            >
              <option value="all">كل الأنواع</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontFamily: "Alexandria" }}
            >
              <option value="all">كل الحالات</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12">
              <GitBranch size={48} className="mx-auto text-gray-600 mb-3" />
              <div className="text-gray-400 text-sm">لا توجد طلبات</div>
              <div className="text-gray-500 text-xs mt-1">اضغط "طلب جديد" لإنشاء أول طلب</div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map(req => (
                <div key={req.id} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "hsl(165 69% 39% / 0.15)" }}>
                        <Send size={18} style={{ color: peoplePrimary }} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-sm font-bold text-white">{req.title}</h4>
                          {getStatusBadge(req.status)}
                          {getPriorityBadge(req.priority)}
                        </div>
                        <p className="text-xs text-gray-400 mb-2">{req.description || "بدون تفاصيل"}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                          <span>النوع: {TYPE_LABELS[req.type] || req.type}</span>
                          <span>من: {req.employee_name}</span>
                          <span>القسم: {req.department || "-"}</span>
                          <span>التاريخ: {formatDate(req.created_at)}</span>
                          <span>المستوى: {req.current_level}/{req.max_levels}</span>
                        </div>
                      </div>
                    </div>
                    {(req.status === "pending" || req.status === "manager_approved" || req.status === "hr_approved") && (
                      <button
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                        style={{ background: peoplePrimary }}
                        onClick={() => setApprovalTarget(req)}
                      >
                        اتخاذ إجراء
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tickets Tab */}
      {activeTab === "tickets" && (
        <>
          {loading ? (
            <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-12">
              <Ticket size={48} className="mx-auto text-gray-600 mb-3" />
              <div className="text-gray-400 text-sm">لا توجد تذاكر</div>
              <div className="text-gray-500 text-xs mt-1">اضغط "تذكرة جديدة" لإنشاء أول تذكرة</div>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                    <th className="text-right text-xs text-gray-400 p-3 font-medium">الموضوع</th>
                    <th className="text-right text-xs text-gray-400 p-3 font-medium">الموظف</th>
                    <th className="text-right text-xs text-gray-400 p-3 font-medium">التصنيف</th>
                    <th className="text-center text-xs text-gray-400 p-3 font-medium">الأولوية</th>
                    <th className="text-center text-xs text-gray-400 p-3 font-medium">الحالة</th>
                    <th className="text-right text-xs text-gray-400 p-3 font-medium">التاريخ</th>
                    <th className="text-center text-xs text-gray-400 p-3 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(ticket => (
                    <tr key={ticket.id} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                      <td className="p-3 text-sm text-white">{ticket.subject}</td>
                      <td className="p-3 text-sm text-gray-300">{ticket.employee_name}</td>
                      <td className="p-3 text-xs text-gray-400">{TICKET_CATEGORIES[ticket.category] || ticket.category}</td>
                      <td className="p-3 text-center">{getPriorityBadge(ticket.priority)}</td>
                      <td className="p-3 text-center">{getTicketStatusBadge(ticket.status)}</td>
                      <td className="p-3 text-xs text-gray-400">{formatDate(ticket.created_at)}</td>
                      <td className="p-3 text-center">
                        {ticket.status === "open" && (
                          <button
                            className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                            onClick={() => handleUpdateTicketStatus(ticket.id, "in_progress")}
                          >
                            بدء المعالجة
                          </button>
                        )}
                        {ticket.status === "in_progress" && (
                          <button
                            className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            onClick={() => handleUpdateTicketStatus(ticket.id, "resolved")}
                          >
                            تم الحل
                          </button>
                        )}
                        {ticket.status === "resolved" && (
                          <button
                            className="text-xs px-2 py-1 rounded bg-gray-500/10 text-gray-400 hover:bg-gray-500/20"
                            onClick={() => handleUpdateTicketStatus(ticket.id, "closed")}
                          >
                            إغلاق
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </PageTemplate>
  );
}
