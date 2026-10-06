import { useState, useEffect, useMemo } from "react";
import { useEmployees } from "../contexts/EmployeeContext";
import { useAuth } from "../contexts/AuthContext";
import {
  Briefcase, Plus, Search, Users, Calendar, DollarSign, Edit2, Trash2,
  CheckCircle2, Clock, AlertCircle, Eye, X, FolderOpen, Building2,
  Phone, Mail, Globe, BarChart2, Loader2, ChevronDown, LayoutGrid, List, ListTodo, Timer
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Client {
  id: string; name: string; contactPerson: string; email: string;
  phone: string; industry: string; status: string; notes: string; createdAt: string;
}
interface Project {
  id: string; name: string; clientId: string; clientName?: string;
  department: string; manager: string; status: string; budget: number;
  startDate: string; endDate: string; description: string; progress: number;
  createdAt: string;
}
interface ProjectTask {
  id: string; projectId: string; title: string; assignedTo: string;
  status: string; priority: string; dueDate: string; createdAt: string;
}
interface TimeEntry {
  id: string; projectId: string; employeeId: string; employeeName: string;
  entryDate: string; minutes: number; notes: string; createdAt: number;
}
interface ClientContract {
  id: string; contractReference: string; title: string; startDate: number | null;
  endDate: number | null; contractValue: number | null; status: string; notes: string | null;
}

const DEPARTMENTS = [
  "الإدارة التنفيذية", "إدارة الإنتاج", "الإدارة الرقمية",
  "إدارة العلاقات العامة", "الإدارة الإبداعية", "إدارة تطوير الأعمال",
  "إدارة الموارد البشرية", "إدارة التسويق"
];
const peoplePrimary = "hsl(var(--primary))";

const PROJECT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  planning:    { label: "تخطيط",     color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  active:      { label: "نشط",       color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  on_hold:     { label: "متوقف",     color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  completed:   { label: "مكتمل",     color: "#10B981", bg: "rgba(16,185,129,0.12)" },
};

const TASK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "قيد الانتظار", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  in_progress: { label: "قيد التنفيذ", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  completed: { label: "مكتمل", color: "#10B981", bg: "rgba(16,185,129,0.12)" },
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
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 6, fontFamily: "Alexandria" };
const overlayStyle: React.CSSProperties = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: React.CSSProperties = { background: "hsl(var(--card))", borderRadius: 16, border: "1px solid hsl(165 69% 39% / 0.20)", padding: 28, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", fontFamily: "Alexandria", direction: "rtl" };
const tagStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 };

async function getApiError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return typeof payload?.error === "string" && payload.error.trim() ? payload.error : fallback;
}

export default function ProjectsClients() {
  const { employees } = useEmployees();
  const { user } = useAuth();
  const [tab, setTab] = useState<"projects" | "clients">("projects");
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showClientModal, setShowClientModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [taskView, setTaskView] = useState<"kanban" | "table">("kanban");
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [contractClient, setContractClient] = useState<Client | null>(null);
  const [clientContracts, setClientContracts] = useState<ClientContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);

  const [clientForm, setClientForm] = useState({ name: "", contactPerson: "", email: "", phone: "", industry: "", status: "active", notes: "" });
  const [projectForm, setProjectForm] = useState({ name: "", clientId: "", department: "", manager: "", status: "planning", budget: 0, startDate: "", endDate: "", description: "", progress: 0 });
  const [taskForm, setTaskForm] = useState({ title: "", assignedTo: "", status: "pending", priority: "medium", dueDate: "" });
  const [timeForm, setTimeForm] = useState({ entryDate: new Date().toISOString().slice(0, 10), minutes: 60, notes: "" });
  const [contractForm, setContractForm] = useState({ contractReference: "", title: "", startDate: "", endDate: "", contractValue: "", status: "draft", notes: "" });
  const isContractAdmin = user?.role === "admin" || user?.role === "owner";

  const fetchAll = async () => {
    try {
      const [cRes, pRes] = await Promise.all([
        fetch("/api/services/clients", { credentials: "include" }),
        fetch("/api/services/projects", { credentials: "include" }),
      ]);
      if (cRes.ok) setClients(await cRes.json());
      if (pRes.ok) setProjects(await pRes.json());
    } catch { toast.error("فشل تحميل البيانات"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const fetchTasks = async (projectId: string) => {
    try {
      const res = await fetch(`/api/services/projects/${projectId}/tasks`, { credentials: "include" });
      if (res.ok) setTasks(await res.json());
    } catch { /* ignore */ }
  };
  const fetchTimeEntries = async (projectId: string) => {
    try {
      const res = await fetch(`/api/services/projects/${projectId}/time-entries`, { credentials: "include" });
      if (res.ok) setTimeEntries(await res.json());
    } catch { /* keep the project view usable if time records fail to load */ }
  };
  const openClientContracts = async (client: Client) => {
    setContractClient(client); setContractsLoading(true); setClientContracts([]);
    setContractForm({ contractReference: "", title: "", startDate: "", endDate: "", contractValue: "", status: "draft", notes: "" });
    try {
      const response = await fetch(`/api/services/clients/${client.id}/contracts`, { credentials: "include" });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر تحميل العقود"));
      setClientContracts(await response.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحميل العقود");
    } finally {
      setContractsLoading(false);
    }
  };
  const saveClientContract = async () => {
    if (!contractClient || !isContractAdmin) return;
    if (!contractForm.contractReference.trim() || !contractForm.title.trim()) {
      toast.error("رقم العقد وعنوانه مطلوبان");
      return;
    }
    const contractValue = contractForm.contractValue.trim() === "" ? null : Number(contractForm.contractValue);
    if (contractValue !== null && (!Number.isFinite(contractValue) || contractValue < 0)) {
      toast.error("قيمة العقد غير صالحة");
      return;
    }
    const startDate = contractForm.startDate ? Date.parse(contractForm.startDate) : null;
    const endDate = contractForm.endDate ? Date.parse(contractForm.endDate) : null;
    if ((startDate !== null && !Number.isFinite(startDate)) || (endDate !== null && !Number.isFinite(endDate))) {
      toast.error("تاريخ العقد غير صالح");
      return;
    }
    if (startDate !== null && endDate !== null && endDate < startDate) {
      toast.error("تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء");
      return;
    }
    setContractSaving(true);
    try {
      const response = await fetch(`/api/services/clients/${contractClient.id}/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          contractReference: contractForm.contractReference.trim(),
          title: contractForm.title.trim(),
          startDate,
          endDate,
          contractValue,
          status: contractForm.status,
          notes: contractForm.notes.trim(),
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر حفظ العقد"));
      toast.success("تم حفظ العقد");
      setContractForm({ contractReference: "", title: "", startDate: "", endDate: "", contractValue: "", status: "draft", notes: "" });
      const contractsResponse = await fetch(`/api/services/clients/${contractClient.id}/contracts`, { credentials: "include" });
      if (!contractsResponse.ok) throw new Error(await getApiError(contractsResponse, "تم الحفظ لكن تعذر تحديث القائمة"));
      setClientContracts(await contractsResponse.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ العقد");
    } finally {
      setContractSaving(false);
    }
  };

  // Client CRUD
  const openCreateClient = () => { setEditClient(null); setClientForm({ name: "", contactPerson: "", email: "", phone: "", industry: "", status: "active", notes: "" }); setShowClientModal(true); };
  const openEditClient = (c: Client) => { setEditClient(c); setClientForm({ name: c.name, contactPerson: c.contactPerson, email: c.email, phone: c.phone, industry: c.industry, status: c.status, notes: c.notes }); setShowClientModal(true); };
  const saveClient = async () => {
    if (!clientForm.name) { toast.error("اسم العميل مطلوب"); return; }
    try {
      if (editClient) {
        const response = await fetch(`/api/services/clients/${editClient.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(clientForm) });
        if (!response.ok) throw new Error(await getApiError(response, "تعذر تحديث العميل"));
        toast.success("تم تحديث العميل");
      } else {
        const response = await fetch("/api/services/clients", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(clientForm) });
        if (!response.ok) throw new Error(await getApiError(response, "تعذر إضافة العميل"));
        toast.success("تم إضافة العميل");
      }
      setShowClientModal(false); fetchAll();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ العميل"); }
  };
  const deleteClient = async (id: string) => {
    if (!confirm("حذف العميل؟")) return;
    try {
      const response = await fetch(`/api/services/clients/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر حذف العميل"));
      toast.success("تم الحذف"); fetchAll();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حذف العميل"); }
  };

  // Project CRUD
  const openCreateProject = () => { setEditProject(null); setProjectForm({ name: "", clientId: "", department: "", manager: "", status: "planning", budget: 0, startDate: "", endDate: "", description: "", progress: 0 }); setShowProjectModal(true); };
  const openEditProject = (p: Project) => { setEditProject(p); setProjectForm({ name: p.name, clientId: p.clientId, department: p.department, manager: p.manager, status: p.status, budget: p.budget, startDate: p.startDate, endDate: p.endDate, description: p.description, progress: p.progress }); setShowProjectModal(true); };
  const saveProject = async () => {
    if (!projectForm.name) { toast.error("اسم المشروع مطلوب"); return; }
    const clientName = clients.find(c => c.id === projectForm.clientId)?.name || "";
    try {
      if (editProject) {
        const response = await fetch(`/api/services/projects/${editProject.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...projectForm, clientName }) });
        if (!response.ok) throw new Error(await getApiError(response, "تعذر تحديث المشروع"));
        toast.success("تم تحديث المشروع");
      } else {
        const response = await fetch("/api/services/projects", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...projectForm, clientName }) });
        if (!response.ok) throw new Error(await getApiError(response, "تعذر إنشاء المشروع"));
        toast.success("تم إنشاء المشروع");
      }
      setShowProjectModal(false); fetchAll();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ المشروع"); }
  };
  const deleteProject = async (id: string) => {
    if (!confirm("حذف المشروع؟")) return;
    try {
      const response = await fetch(`/api/services/projects/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر حذف المشروع"));
      toast.success("تم الحذف"); fetchAll();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حذف المشروع"); }
  };

  // Task CRUD
  const saveTask = async () => {
    if (!taskForm.title || !selectedProject) { toast.error("العنوان مطلوب"); return; }
    try {
      const response = await fetch(`/api/services/projects/${selectedProject.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(taskForm) });
      if (!response.ok) throw new Error(await getApiError(response, "تعذر إضافة المهمة"));
      toast.success("تم إضافة المهمة"); setShowTaskModal(false); fetchTasks(selectedProject.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر إضافة المهمة"); }
  };
  const saveTimeEntry = async () => {
    if (!selectedProject || !timeForm.entryDate || timeForm.minutes < 1) { toast.error("أدخل التاريخ والمدة"); return; }
    const res = await fetch(`/api/services/projects/${selectedProject.id}/time-entries`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(timeForm) });
    if (!res.ok) { toast.error(await getApiError(res, "تعذر حفظ سجل الوقت")); return; }
    toast.success("تم تسجيل الوقت"); setShowTimeModal(false); fetchTimeEntries(selectedProject.id);
  };

  const filteredClients = useMemo(() => {
    if (!searchTerm) return clients;
    const q = searchTerm.toLowerCase();
    return clients.filter(c => c.name.toLowerCase().includes(q) || c.contactPerson.toLowerCase().includes(q));
  }, [clients, searchTerm]);

  const filteredProjects = useMemo(() => {
    if (!searchTerm) return projects;
    const q = searchTerm.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(q) || (p.clientName || "").toLowerCase().includes(q));
  }, [projects, searchTerm]);

  const teamProductivity = useMemo(() => {
    const members = new Map<string, { name: string; minutes: number; assignedTasks: number; completedTasks: number }>();
    for (const entry of timeEntries) {
      const key = entry.employeeId || entry.employeeName;
      const member = members.get(key) || { name: entry.employeeName || "غير محدد", minutes: 0, assignedTasks: 0, completedTasks: 0 };
      member.minutes += Number(entry.minutes) || 0;
      members.set(key, member);
    }
    for (const task of tasks) {
      const key = task.assignedTo || "unassigned";
      const member = members.get(key) || { name: task.assignedTo || "غير مسند", minutes: 0, assignedTasks: 0, completedTasks: 0 };
      member.assignedTasks += 1;
      if (task.status === "completed") member.completedTasks += 1;
      members.set(key, member);
    }
    return [...members.values()].sort((a, b) => (b.completedTasks - a.completedTasks) || (b.minutes - a.minutes));
  }, [tasks, timeEntries]);

  return (
    <div style={{ fontFamily: "Alexandria", direction: "rtl", padding: "24px 28px", minHeight: "100vh", background: "hsl(var(--background))" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: peoplePrimary, margin: 0 }}>
            <Briefcase size={24} style={{ verticalAlign: "middle", marginLeft: 8 }} />
            المشاريع والعملاء
          </h1>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>إدارة المشاريع والعملاء وتتبع المهام</p>
        </div>
        <button onClick={tab === "projects" ? openCreateProject : openCreateClient} className="btn-brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} /> {tab === "projects" ? "مشروع جديد" : "عميل جديد"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "العملاء", value: clients.length, color: peoplePrimary, icon: Users },
          { label: "المشاريع", value: projects.length, color: "#3B82F6", icon: FolderOpen },
          { label: "نشط", value: projects.filter(p => p.status === "active").length, color: "#10B981", icon: CheckCircle2 },
          { label: "متوقف", value: projects.filter(p => p.status === "on_hold").length, color: "#EF4444", icon: AlertCircle },
        ].map((s, i) => (
          <div key={i} style={{ background: "hsl(var(--card))", borderRadius: 12, border: "1px solid hsl(165 69% 39% / 0.10)", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <s.icon size={18} style={{ color: s.color }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs & Search */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", background: "hsl(var(--card))", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden" }}>
          {(["projects", "clients"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setSearchTerm(""); setSelectedProject(null); }}
              style={{
                padding: "10px 24px", border: "none", cursor: "pointer", fontFamily: "Alexandria",
                fontSize: 14, fontWeight: 700, transition: "border-color 150ms ease, background-color 150ms ease",
                background: tab === t ? "hsl(165 69% 39% / 0.15)" : "transparent",
                color: tab === t ? peoplePrimary : "hsl(var(--muted-foreground))",
              }}>
              {t === "projects" ? "المشاريع" : "العملاء"}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, position: "relative", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", right: 12, top: 12, color: "hsl(var(--muted-foreground))" }} />
          <input placeholder="بحث..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...inputStyle, paddingRight: 36 }} />
        </div>
      </div>

      {/* Projects Tab */}
      {tab === "projects" && !selectedProject && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filteredProjects.map(p => {
            const stCfg = PROJECT_STATUS[p.status] || PROJECT_STATUS.planning;
            return (
              <div key={p.id} onClick={() => { setSelectedProject(p); fetchTasks(p.id); fetchTimeEntries(p.id); }}
                style={{
                  background: "hsl(var(--card))", borderRadius: 14,
                  border: "1px solid hsl(165 69% 39% / 0.10)", padding: 20, cursor: "pointer",
                  transition: "border-color 150ms ease, background-color 150ms ease",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(165 69% 39% / 0.30)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(165 69% 39% / 0.10)"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>{p.name}</h3>
                  <span style={{ ...tagStyle, background: stCfg.bg, color: stCfg.color }}>{stCfg.label}</span>
                </div>
                {p.clientName && <div style={{ fontSize: 12, color: peoplePrimary, marginBottom: 8 }}><Building2 size={12} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {p.clientName}</div>}
                {p.description && <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "0 0 12px", lineHeight: 1.5, maxHeight: 36, overflow: "hidden" }}>{p.description}</p>}
                {/* Progress */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>
                    <span>التقدم</span><span>{p.progress}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "hsl(var(--muted))" }}>
                    <div style={{ height: "100%", borderRadius: 3, background: stCfg.color, width: `${p.progress}%`, transition: "width 0.3s" }} />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                    <Calendar size={10} style={{ verticalAlign: "middle", marginLeft: 4 }} />
                    {p.startDate ? new Date(p.startDate).toLocaleDateString("ar-SA-u-ca-gregory") : "—"}
                  </div>
                  {p.budget > 0 && (
                    <div style={{ fontSize: 11, color: peoplePrimary, fontWeight: 700 }}>
                      <DollarSign size={10} style={{ verticalAlign: "middle" }} /> {p.budget.toLocaleString()} ر.س
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={e => { e.stopPropagation(); openEditProject(p); }} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer", padding: 4 }}><Edit2 size={13} /></button>
                    <button onClick={e => { e.stopPropagation(); deleteProject(p.id); }} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredProjects.length === 0 && !loading && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
              <FolderOpen size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p>لا توجد مشاريع بعد</p>
            </div>
          )}
        </div>
      )}

      {/* Project Detail */}
      {tab === "projects" && selectedProject && (
        <div>
          <button onClick={() => setSelectedProject(null)} style={{ background: "none", border: "none", color: "#1FA98C", cursor: "pointer", fontFamily: "Alexandria", fontSize: 14, marginBottom: 16 }}>
            → العودة للمشاريع
          </button>
          <div style={{ background: "hsl(var(--card))", borderRadius: 14, border: "1px solid hsl(165 69% 39% / 0.10)", padding: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 900, color: "hsl(var(--foreground))", margin: "0 0 8px" }}>{selectedProject.name}</h2>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...tagStyle, background: (PROJECT_STATUS[selectedProject.status] || PROJECT_STATUS.planning).bg, color: (PROJECT_STATUS[selectedProject.status] || PROJECT_STATUS.planning).color }}>
                    {(PROJECT_STATUS[selectedProject.status] || PROJECT_STATUS.planning).label}
                  </span>
                  {selectedProject.clientName && <span style={{ ...tagStyle, background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}>{selectedProject.clientName}</span>}
                  {selectedProject.department && <span style={{ ...tagStyle, background: "rgba(139,92,246,0.1)", color: "#8B5CF6" }}>{selectedProject.department}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setTimeForm({ entryDate: new Date().toISOString().slice(0, 10), minutes: 60, notes: "" }); setShowTimeModal(true); }} style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "none", borderRadius: 9, padding: "8px 10px", fontFamily: "Alexandria", cursor: "pointer", fontSize: 12 }}><Timer size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> تسجيل وقت</button>
                <button onClick={() => { setTaskForm({ title: "", assignedTo: "", status: "pending", priority: "medium", dueDate: "" }); setShowTaskModal(true); }} className="btn-brand" style={{ fontSize: 13 }}>
                  <Plus size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> مهمة جديدة
                </button>
              </div>
            </div>
          </div>
          {/* Tasks */}
          <div style={{ background: "hsl(var(--card))", borderRadius: 14, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid hsl(165 69% 39% / 0.10)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ListTodo size={16} style={{ color: "#1FA98C" }} />
                <span style={{ fontWeight: 700, color: "hsl(var(--foreground))", fontSize: 15 }}>المهام ({tasks.length})</span>
              </div>
              <div role="group" aria-label="طريقة عرض المهام" style={{ display: "flex", gap: 4, background: "hsl(var(--card))", borderRadius: 8, padding: 3 }}>
                <button type="button" aria-label="عرض كانبان" onClick={() => setTaskView("kanban")} style={{ border: "none", borderRadius: 6, padding: 6, cursor: "pointer", background: taskView === "kanban" ? "hsl(165 69% 39% / 0.18)" : "transparent", color: taskView === "kanban" ? "#1FA98C" : "hsl(var(--muted-foreground))" }}><LayoutGrid size={15} /></button>
                <button type="button" aria-label="عرض الجدول" onClick={() => setTaskView("table")} style={{ border: "none", borderRadius: 6, padding: 6, cursor: "pointer", background: taskView === "table" ? "hsl(165 69% 39% / 0.18)" : "transparent", color: taskView === "table" ? "#1FA98C" : "hsl(var(--muted-foreground))" }}><List size={15} /></button>
              </div>
            </div>
            {tasks.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "hsl(var(--muted-foreground))" }}>لا توجد مهام بعد</div>
            ) : taskView === "kanban" ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: 16 }}>
                {(["pending", "in_progress", "completed"] as const).map((status) => {
                  const config = TASK_STATUS[status];
                  const statusTasks = tasks.filter(task => task.status === status);
                  return (
                    <section key={status} aria-label={`مهام ${config.label}`} style={{ flex: "1 0 250px", minWidth: 250 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: config.bg, color: config.color, borderRadius: 9, padding: "9px 11px", marginBottom: 10, fontSize: 13, fontWeight: 700 }}>
                        <span>{config.label}</span><span style={{ background: config.color, color: "#fff", borderRadius: 999, minWidth: 22, textAlign: "center", padding: "2px 6px", fontSize: 11 }}>{statusTasks.length}</span>
                      </div>
                      <div style={{ display: "grid", gap: 9 }}>
                        {statusTasks.length ? statusTasks.map(task => (
                          <div key={task.id} style={{ background: "hsl(var(--card))", border: "1px solid hsl(165 69% 39% / 0.12)", borderRadius: 10, padding: 12 }}>
                            <div style={{ color: "hsl(var(--foreground))", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{task.title}</div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "hsl(var(--muted-foreground))", fontSize: 11 }}>
                              <span>{task.assignedTo || "غير مسند"}</span>
                              <span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString("ar-SA-u-ca-gregory") : "دون موعد"}</span>
                            </div>
                          </div>
                        )) : <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 12, textAlign: "center", padding: 22 }}>لا توجد مهام</div>}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "hsl(var(--card))" }}>
                    {["المهمة", "المسؤول", "الأولوية", "الحالة", "التاريخ"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", color: "#1FA98C", fontWeight: 700, textAlign: "right", borderBottom: "1px solid hsl(165 69% 39% / 0.10)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(t => (
                    <tr key={t.id} style={{ borderBottom: "1px solid hsl(165 69% 39% / 0.06)" }}>
                      <td style={{ padding: "10px 16px", color: "hsl(var(--foreground))", fontWeight: 600 }}>{t.title}</td>
                      <td style={{ padding: "10px 16px", color: "hsl(var(--muted-foreground))" }}>{t.assignedTo || "—"}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ ...tagStyle, background: t.priority === "high" ? "rgba(239,68,68,0.12)" : t.priority === "urgent" ? "rgba(220,38,38,0.2)" : "rgba(245,158,11,0.12)", color: t.priority === "high" || t.priority === "urgent" ? "#EF4444" : "#F59E0B" }}>
                          {t.priority === "high" ? "عالي" : t.priority === "urgent" ? "عاجل" : t.priority === "low" ? "منخفض" : "متوسط"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ ...tagStyle, background: (TASK_STATUS[t.status] || TASK_STATUS.pending).bg, color: (TASK_STATUS[t.status] || TASK_STATUS.pending).color }}>
                          {(TASK_STATUS[t.status] || TASK_STATUS.pending).label}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", color: "hsl(var(--muted-foreground))" }}>{t.dueDate ? new Date(t.dueDate).toLocaleDateString("ar-SA-u-ca-gregory") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ background: "hsl(var(--card))", borderRadius: 14, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden", marginTop: 20 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid hsl(165 69% 39% / 0.10)", display: "flex", alignItems: "center", gap: 8 }}><Timer size={16} style={{ color: "#60a5fa" }} /><span style={{ fontWeight: 700, color: "hsl(var(--foreground))", fontSize: 15 }}>سجل الوقت ({timeEntries.length})</span></div>
            {timeEntries.length === 0 ? <div style={{ textAlign: "center", padding: 28, color: "hsl(var(--muted-foreground))", fontSize: 13 }}>لا توجد سجلات وقت بعد</div> : <div style={{ display: "grid", gap: 1 }}>{timeEntries.map((entry) => <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 16px", fontSize: 12, borderBottom: "1px solid hsl(165 69% 39% / 0.06)" }}><span style={{ color: "hsl(var(--foreground))" }}>{entry.minutes} دقيقة {entry.notes ? `— ${entry.notes}` : ""}</span><span style={{ color: "hsl(var(--muted-foreground))" }}>{entry.entryDate}</span></div>)}</div>}
          </div>
          <section aria-label="تقرير إنتاجية الفريق" style={{ background: "hsl(var(--card))", borderRadius: 14, border: "1px solid hsl(165 69% 39% / 0.10)", overflow: "hidden", marginTop: 20 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid hsl(165 69% 39% / 0.10)", display: "flex", alignItems: "center", gap: 8 }}><BarChart2 size={16} style={{ color: "#1FA98C" }} /><span style={{ fontWeight: 700, color: "hsl(var(--foreground))", fontSize: 15 }}>إنتاجية الفريق</span><span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>من المهام وسجل الوقت المتاح</span></div>
            {teamProductivity.length === 0 ? <div style={{ textAlign: "center", padding: 28, color: "hsl(var(--muted-foreground))", fontSize: 13 }}>لا توجد بيانات إنتاجية بعد</div> : <div style={{ display: "grid", gap: 1 }}>{teamProductivity.map((member) => <div key={member.name} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) repeat(3,auto)", alignItems: "center", gap: 16, padding: "12px 16px", fontSize: 12, borderBottom: "1px solid hsl(165 69% 39% / 0.06)" }}><span style={{ color: "hsl(var(--foreground))", fontWeight: 700 }}>{member.name}</span><span style={{ color: "#60a5fa" }}>{Math.floor(member.minutes / 60)} س {member.minutes % 60} د</span><span style={{ color: "#F59E0B" }}>{member.assignedTasks} مهام</span><span style={{ color: "#10B981" }}>{member.completedTasks} مكتملة</span></div>)}</div>}
          </section>
        </div>
      )}

      {/* Clients Tab */}
      {tab === "clients" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {filteredClients.map(c => (
            <div key={c.id} style={{
              background: "hsl(var(--card))", borderRadius: 14,
              border: "1px solid hsl(165 69% 39% / 0.10)", padding: 20,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: "hsl(var(--foreground))", margin: "0 0 4px" }}>{c.name}</h3>
                  {c.industry && <span style={{ ...tagStyle, background: "hsl(165 69% 39% / 0.10)", color: "#1FA98C" }}>{c.industry}</span>}
                </div>
                <span style={{ ...tagStyle, background: c.status === "active" ? "rgba(16,185,129,0.12)" : "rgba(107,114,128,0.12)", color: c.status === "active" ? "#10B981" : "#6B7280" }}>
                  {c.status === "active" ? "نشط" : "غير نشط"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {c.contactPerson && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}><Users size={12} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {c.contactPerson}</div>}
                {c.email && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}><Mail size={12} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {c.email}</div>}
                {c.phone && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}><Phone size={12} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {c.phone}</div>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {isContractAdmin && <button onClick={() => openClientContracts(c)} title="عقود العميل" style={{ background: "none", border: "none", color: "#1FA98C", cursor: "pointer", padding: 4 }}><Eye size={13} /></button>}
                <button onClick={() => openEditClient(c)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer", padding: 4 }}><Edit2 size={13} /></button>
                <button onClick={() => deleteClient(c.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", padding: 4 }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          {filteredClients.length === 0 && !loading && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>
              <Users size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p>لا يوجد عملاء بعد</p>
            </div>
          )}
        </div>
      )}

      {contractClient && (
        <div style={overlayStyle} onClick={() => setContractClient(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div><h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>عقود العميل</h2><p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>{contractClient.name}</p></div>
              <button onClick={() => setContractClient(null)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            {isContractAdmin && <section aria-label="إضافة عقد جديد" style={{ border: "1px solid hsl(165 69% 39% / 0.22)", borderRadius: 12, padding: 14, marginBottom: 18, background: "hsl(165 69% 39% / 0.05)" }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: "hsl(var(--foreground))", margin: "0 0 12px" }}>إضافة عقد جديد</h3>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><label style={labelStyle}>رقم العقد *</label><input value={contractForm.contractReference} onChange={e => setContractForm({ ...contractForm, contractReference: e.target.value })} maxLength={120} style={inputStyle} /></div><div><label style={labelStyle}>عنوان العقد *</label><input value={contractForm.title} onChange={e => setContractForm({ ...contractForm, title: e.target.value })} maxLength={300} style={inputStyle} /></div></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><label style={labelStyle}>تاريخ البدء</label><input type="date" value={contractForm.startDate} onChange={e => setContractForm({ ...contractForm, startDate: e.target.value })} style={inputStyle} /></div><div><label style={labelStyle}>تاريخ الانتهاء</label><input type="date" value={contractForm.endDate} onChange={e => setContractForm({ ...contractForm, endDate: e.target.value })} style={inputStyle} /></div></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><label style={labelStyle}>قيمة العقد (ر.س)</label><input type="number" min={0} step="0.01" value={contractForm.contractValue} onChange={e => setContractForm({ ...contractForm, contractValue: e.target.value })} style={inputStyle} /></div><div><label style={labelStyle}>الحالة</label><select value={contractForm.status} onChange={e => setContractForm({ ...contractForm, status: e.target.value })} style={selectStyle}><option value="draft">مسودة</option><option value="active">ساري</option><option value="expired">منتهي</option><option value="closed">مغلق</option></select></div></div>
                <div><label style={labelStyle}>ملاحظات</label><textarea value={contractForm.notes} onChange={e => setContractForm({ ...contractForm, notes: e.target.value })} maxLength={5000} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
                <button type="button" onClick={saveClientContract} disabled={contractSaving || contractsLoading} className="btn-brand" style={{ justifySelf: "start", opacity: contractSaving || contractsLoading ? 0.65 : 1 }}>{contractSaving ? <><Loader2 size={14} className="animate-spin" style={{ verticalAlign: "middle", marginLeft: 4 }} /> جارٍ الحفظ</> : <><Plus size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> حفظ العقد</>}</button>
              </div>
            </section>}
            {contractsLoading ? <div style={{ textAlign: "center", padding: 30, color: "#1FA98C" }}><Loader2 size={22} className="animate-spin" /></div> : clientContracts.length === 0 ? <div style={{ textAlign: "center", padding: 30, color: "hsl(var(--muted-foreground))" }}>لا توجد عقود مسجلة لهذا العميل</div> : <div style={{ display: "grid", gap: 10 }}>{clientContracts.map(contract => <div key={contract.id} style={{ border: "1px solid hsl(165 69% 39% / 0.16)", borderRadius: 10, padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ color: "hsl(var(--foreground))", fontSize: 14 }}>{contract.title}</strong><span style={{ ...tagStyle, background: "hsl(165 69% 39% / 0.12)", color: "#1FA98C" }}>{contract.contractReference}</span></div><div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 9, color: "hsl(var(--muted-foreground))", fontSize: 12 }}><span>{contract.startDate ? new Date(contract.startDate).toLocaleDateString("ar-SA-u-ca-gregory") : "—"} إلى {contract.endDate ? new Date(contract.endDate).toLocaleDateString("ar-SA-u-ca-gregory") : "—"}</span><span>{contract.contractValue === null ? "القيمة غير محددة" : `${contract.contractValue.toLocaleString()} ر.س`}</span></div>{contract.notes && <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 12, margin: "9px 0 0", lineHeight: 1.6 }}>{contract.notes}</p>}</div>)}</div>}
          </div>
        </div>
      )}

      {/* Client Modal */}
      {showClientModal && (
        <div style={overlayStyle} onClick={() => setShowClientModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>{editClient ? "تعديل العميل" : "عميل جديد"}</h2>
              <button onClick={() => setShowClientModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={labelStyle}>اسم العميل *</label><input value={clientForm.name} onChange={e => setClientForm({ ...clientForm, name: e.target.value })} style={inputStyle} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>جهة الاتصال</label><input value={clientForm.contactPerson} onChange={e => setClientForm({ ...clientForm, contactPerson: e.target.value })} style={inputStyle} /></div>
                <div><label style={labelStyle}>القطاع</label><input value={clientForm.industry} onChange={e => setClientForm({ ...clientForm, industry: e.target.value })} placeholder="تسويق، تقنية..." style={inputStyle} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>البريد</label><input value={clientForm.email} onChange={e => setClientForm({ ...clientForm, email: e.target.value })} style={inputStyle} /></div>
                <div><label style={labelStyle}>الهاتف</label><input value={clientForm.phone} onChange={e => setClientForm({ ...clientForm, phone: e.target.value })} style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>ملاحظات</label><textarea value={clientForm.notes} onChange={e => setClientForm({ ...clientForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveClient} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> حفظ</button>
              <button onClick={() => setShowClientModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Project Modal */}
      {showProjectModal && (
        <div style={overlayStyle} onClick={() => setShowProjectModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>{editProject ? "تعديل المشروع" : "مشروع جديد"}</h2>
              <button onClick={() => setShowProjectModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={labelStyle}>اسم المشروع *</label><input value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} style={inputStyle} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>العميل</label><select value={projectForm.clientId} onChange={e => setProjectForm({ ...projectForm, clientId: e.target.value })} style={selectStyle}><option value="">اختر عميل</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><label style={labelStyle}>الإدارة</label><select value={projectForm.department} onChange={e => setProjectForm({ ...projectForm, department: e.target.value })} style={selectStyle}><option value="">اختر</option>{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>مدير المشروع</label><select value={projectForm.manager} onChange={e => setProjectForm({ ...projectForm, manager: e.target.value })} style={selectStyle}><option value="">اختر</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.nameAr || emp.name}>{emp.nameAr || emp.name}</option>)}</select></div>
                <div><label style={labelStyle}>الحالة</label><select value={projectForm.status} onChange={e => setProjectForm({ ...projectForm, status: e.target.value })} style={selectStyle}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>تاريخ البدء</label><input type="date" value={projectForm.startDate} onChange={e => setProjectForm({ ...projectForm, startDate: e.target.value })} style={inputStyle} /></div>
                <div><label style={labelStyle}>تاريخ الانتهاء</label><input type="date" value={projectForm.endDate} onChange={e => setProjectForm({ ...projectForm, endDate: e.target.value })} style={inputStyle} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>الميزانية (ر.س)</label><input type="number" value={projectForm.budget} onChange={e => setProjectForm({ ...projectForm, budget: Number(e.target.value) })} style={inputStyle} /></div>
                <div><label style={labelStyle}>نسبة الإنجاز %</label><input type="number" min={0} max={100} value={projectForm.progress} onChange={e => setProjectForm({ ...projectForm, progress: Number(e.target.value) })} style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>الوصف</label><textarea value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveProject} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> حفظ</button>
              <button onClick={() => setShowProjectModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div style={overlayStyle} onClick={() => setShowTaskModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>مهمة جديدة</h2>
              <button onClick={() => setShowTaskModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={labelStyle}>عنوان المهمة *</label><input value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} style={inputStyle} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={labelStyle}>المسؤول</label><select value={taskForm.assignedTo} onChange={e => setTaskForm({ ...taskForm, assignedTo: e.target.value })} style={selectStyle}><option value="">اختر</option>{employees.map((emp: any) => <option key={emp.employeeId} value={emp.nameAr || emp.name}>{emp.nameAr || emp.name}</option>)}</select></div>
                <div><label style={labelStyle}>الأولوية</label><select value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })} style={selectStyle}><option value="low">منخفض</option><option value="medium">متوسط</option><option value="high">عالي</option><option value="urgent">عاجل</option></select></div>
              </div>
              <div><label style={labelStyle}>تاريخ التسليم</label><input type="date" value={taskForm.dueDate} onChange={e => setTaskForm({ ...taskForm, dueDate: e.target.value })} style={inputStyle} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveTask} className="btn-brand" style={{ flex: 1 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> إضافة</button>
              <button onClick={() => setShowTaskModal(false)} style={{ flex: 0.5, padding: "10px 20px", borderRadius: 10, border: "1px solid hsl(165 69% 39% / 0.25)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 14, fontFamily: "Alexandria", cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
      {showTimeModal && (
        <div style={overlayStyle} onClick={() => setShowTimeModal(false)}>
          <div style={{ ...modalStyle, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}><h2 style={{ fontSize: 18, fontWeight: 800, color: "hsl(var(--foreground))", margin: 0 }}>تسجيل وقت المشروع</h2><button onClick={() => setShowTimeModal(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={20} /></button></div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><label style={labelStyle}>التاريخ</label><input type="date" value={timeForm.entryDate} onChange={e => setTimeForm({ ...timeForm, entryDate: e.target.value })} style={inputStyle} /></div>
              <div><label style={labelStyle}>المدة بالدقائق</label><input type="number" min={1} max={1440} value={timeForm.minutes} onChange={e => setTimeForm({ ...timeForm, minutes: Number(e.target.value) })} style={inputStyle} /></div>
              <div><label style={labelStyle}>ملاحظات</label><textarea value={timeForm.notes} onChange={e => setTimeForm({ ...timeForm, notes: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></div>
            </div>
            <button onClick={saveTimeEntry} className="btn-brand" style={{ width: "100%", marginTop: 20 }}><Timer size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} /> حفظ سجل الوقت</button>
          </div>
        </div>
      )}
    </div>
  );
}
