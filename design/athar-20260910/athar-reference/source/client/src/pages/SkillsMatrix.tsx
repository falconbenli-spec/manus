import { useEffect, useMemo, useState } from "react";
import { useEmployees } from "../contexts/EmployeeContext";
import { useAuth } from "../contexts/AuthContext";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Crown,
  Eye,
  FileWarning,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.13)";
const cardSurface = "hsl(var(--card))";
const borderColor = "hsl(var(--border))";
const foreground = "hsl(var(--foreground))";
const mutedText = "hsl(var(--muted-foreground))";

type TabId = "dashboard" | "positions" | "candidates" | "development" | "advanced" | "committee" | "skills";

interface CriticalPosition {
  id: string;
  positionTitle: string;
  department: string | null;
  currentHolderId: string | null;
  currentHolderName: string | null;
  riskLevel: string;
  notes: string | null;
  createdAt: number;
  candidateCount?: number;
}

interface SuccessionCandidate {
  id: string;
  positionId: string;
  employeeId: string;
  employeeName: string | null;
  readiness: string;
  notes: string | null;
  createdAt: number;
  positionTitle: string;
  department: string | null;
}

interface Skill {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
}

interface EmployeeSkill {
  id: string;
  employeeId: string;
  employeeName: string | null;
  skillId: string;
  skillName: string | null;
  currentLevel: number;
  targetLevel: number;
  notes: string | null;
}

interface SuccessionDevelopmentPlan {
  id: string;
  candidateId: string;
  candidateName: string | null;
  positionId: string;
  positionTitle: string;
  targetGap: string;
  interventionType: string;
  activity: string;
  responsible: string | null;
  startDate: number | null;
  endDate: number | null;
  completion: number;
  status: "not_started" | "in_progress" | "blocked" | "completed";
  priority: "low" | "medium" | "high";
}

interface SuccessionTalentAssessment {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  assessmentPeriod: string;
  performanceScore: 1 | 2 | 3;
  potentialScore: 1 | 2 | 3;
  notes: string | null;
}

interface SuccessionCommitteeReport {
  id: string;
  title: string;
  meetingDate: number | null;
  reportingPeriod: string;
  summary: string | null;
  status: "draft" | "submitted" | "approved" | "rejected" | "finalized";
  submittedAt: number | null;
  submittedById: string | null;
  reviewedAt: number | null;
  reviewedById: string | null;
  reviewNote: string | null;
}

interface SuccessionCommitteeDecision {
  id: string;
  reportId: string;
  positionId: string | null;
  candidateId: string | null;
  decisionType: "candidate_selection" | "development_action" | "risk_mitigation" | "other";
  decisionText: string;
  ownerName: string | null;
  dueDate: number | null;
  status: "open" | "in_progress" | "completed";
}

const RISK_OPTIONS = [
  { value: "high", label: "مرتفع", color: "#EF4444", background: "rgba(239,68,68,0.14)" },
  { value: "medium", label: "متوسط", color: "#F59E0B", background: "rgba(245,158,11,0.14)" },
  { value: "low", label: "منخفض", color: "#10B981", background: "rgba(16,185,129,0.14)" },
];

const READINESS_OPTIONS = [
  { value: "ready_now", label: "جاهز الآن", color: "#10B981", background: "rgba(16,185,129,0.14)" },
  { value: "ready_1yr", label: "خلال 12 شهراً", color: "#3B82F6", background: "rgba(59,130,246,0.14)" },
  { value: "ready_2yr", label: "خلال 24 شهراً", color: "#F59E0B", background: "rgba(245,158,11,0.14)" },
  { value: "developing", label: "قيد التطوير", color: "#8B5CF6", background: "rgba(139,92,246,0.14)" },
];

const PLAN_STATUSES = [
  { value: "not_started", label: "لم يبدأ", color: "hsl(var(--muted-foreground))", background: "rgba(148,163,184,.14)" },
  { value: "in_progress", label: "قيد التنفيذ", color: "#3B82F6", background: "rgba(59,130,246,.14)" },
  { value: "blocked", label: "متوقف", color: "#EF4444", background: "rgba(239,68,68,.14)" },
  { value: "completed", label: "مكتمل", color: "#10B981", background: "rgba(16,185,129,.14)" },
];
const PLAN_PRIORITIES = [
  { value: "high", label: "عالية", color: "#EF4444" },
  { value: "medium", label: "متوسطة", color: "#F59E0B" },
  { value: "low", label: "منخفضة", color: "#10B981" },
];

const SKILL_CATEGORIES = ["تقنية", "إبداعية", "إدارية", "تسويقية", "تواصل", "تحليلية", "قيادية"];
const DEPARTMENTS = ["الإدارة التنفيذية", "الإنتاج", "التسويق الرقمي", "التسويق", "العلاقات العامة", "الإبداع", "الأعمال", "رأس المال البشري"];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid hsl(var(--primary) / 0.28)",
  background: "hsl(var(--input))", color: foreground, fontFamily: "Alexandria", fontSize: 13,
};
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, color: mutedText, fontSize: 12, fontWeight: 700 };
const cardStyle: React.CSSProperties = { background: cardSurface, border: `1px solid ${borderColor}`, borderRadius: 14 };

function badgeForRisk(value: string) {
  return RISK_OPTIONS.find(item => item.value === value) || RISK_OPTIONS[1];
}

function badgeForReadiness(value: string) {
  return READINESS_OPTIONS.find(item => item.value === value) || { value, label: value || "غير محدد", color: "hsl(var(--muted-foreground))", background: "rgba(148,163,184,0.14)" };
}

function labelForPlanStatus(value: string) {
  return PLAN_STATUSES.find(item => item.value === value)?.label || value;
}

function badgeForPlanStatus(value: string) {
  return PLAN_STATUSES.find(item => item.value === value) || PLAN_STATUSES[0];
}

function Badge({ label, color, background }: { label: string; color: string; background: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 999, color, background, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{label}</span>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof Shield; title: string; detail: string }) {
  return <div style={{ ...cardStyle, padding: "44px 24px", textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
    <Icon size={38} color={peoplePrimary} style={{ opacity: 0.7, marginBottom: 12 }} />
    <div style={{ color: "hsl(var(--foreground))", fontWeight: 800, fontSize: 15, marginBottom: 7 }}>{title}</div>
    <div style={{ fontSize: 12, lineHeight: 1.8, maxWidth: 540, margin: "auto" }}>{detail}</div>
  </div>;
}

export default function SkillsMatrix() {
  const { employees } = useEmployees();
  const { user } = useAuth();
  const canManageSuccession = ["owner", "admin"].includes(user?.role || "");
  const canEditSuccession = ["owner", "admin"].includes(user?.role || "");
  const canReviewCommittee = user?.role === "owner";
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [criticalPositions, setCriticalPositions] = useState<CriticalPosition[]>([]);
  const [candidates, setCandidates] = useState<SuccessionCandidate[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [employeeSkills, setEmployeeSkills] = useState<EmployeeSkill[]>([]);
  const [developmentPlans, setDevelopmentPlans] = useState<SuccessionDevelopmentPlan[]>([]);
  const [talentAssessments, setTalentAssessments] = useState<SuccessionTalentAssessment[]>([]);
  const [committeeReports, setCommitteeReports] = useState<SuccessionCommitteeReport[]>([]);
  const [committeeDecisions, setCommitteeDecisions] = useState<SuccessionCommitteeDecision[]>([]);
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [showCandidateModal, setShowCandidateModal] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showDevelopmentPlanModal, setShowDevelopmentPlanModal] = useState(false);
  const [showTalentAssessmentModal, setShowTalentAssessmentModal] = useState(false);
  const [showCommitteeReportModal, setShowCommitteeReportModal] = useState(false);
  const [showCommitteeDecisionModal, setShowCommitteeDecisionModal] = useState(false);
  const [editingPosition, setEditingPosition] = useState<CriticalPosition | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<SuccessionCandidate | null>(null);
  const [editingDevelopmentPlan, setEditingDevelopmentPlan] = useState<SuccessionDevelopmentPlan | null>(null);
  const [editingTalentAssessment, setEditingTalentAssessment] = useState<SuccessionTalentAssessment | null>(null);
  const [editingCommitteeReport, setEditingCommitteeReport] = useState<SuccessionCommitteeReport | null>(null);
  const [editingCommitteeDecision, setEditingCommitteeDecision] = useState<SuccessionCommitteeDecision | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<CriticalPosition | null>(null);
  const [selectedCommitteeReportId, setSelectedCommitteeReportId] = useState<string | null>(null);
  const [positionForm, setPositionForm] = useState({ positionTitle: "", department: "", currentHolderId: "", currentHolderName: "", riskLevel: "medium", notes: "" });
  const [candidateForm, setCandidateForm] = useState({ positionId: "", employeeId: "", employeeName: "", readiness: "developing", notes: "" });
  const [skillForm, setSkillForm] = useState({ name: "", category: SKILL_CATEGORIES[0], description: "" });
  const [assignForm, setAssignForm] = useState({ employeeId: "", employeeName: "", skillId: "", skillName: "", currentLevel: 1, targetLevel: 3, notes: "" });
  const [developmentPlanForm, setDevelopmentPlanForm] = useState({ candidateId: "", targetGap: "", interventionType: "", activity: "", responsible: "", startDate: "", endDate: "", completion: 0, status: "not_started", priority: "medium" });
  const [talentAssessmentForm, setTalentAssessmentForm] = useState({ employeeId: "", employeeName: "", department: "", assessmentPeriod: "", performanceScore: 2, potentialScore: 2, notes: "" });
  const [committeeReportForm, setCommitteeReportForm] = useState({ title: "", meetingDate: "", reportingPeriod: "", summary: "", status: "draft" });
  const [committeeDecisionForm, setCommitteeDecisionForm] = useState({ positionId: "", candidateId: "", decisionType: "other", decisionText: "", ownerName: "", dueDate: "", status: "open" });

  const loadData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const positionResponse = await fetch("/api/services/critical-positions", { credentials: "include" });
      if (!positionResponse.ok) throw new Error(positionResponse.status === 403 ? "لا تملك الصلاحية لمراجعة التعاقب الوظيفي." : "تعذر تحميل سجلات التعاقب الوظيفي.");
      const loadedPositions: CriticalPosition[] = await positionResponse.json();
      const candidateGroups = await Promise.all(loadedPositions.map(async position => {
        const response = await fetch(`/api/services/critical-positions/${encodeURIComponent(position.id)}/candidates`, { credentials: "include" });
        if (!response.ok) throw new Error("تعذر تحميل مرشحي التعاقب.");
        const records: Omit<SuccessionCandidate, "positionTitle" | "department">[] = await response.json();
        return records.map(record => ({ ...record, positionTitle: position.positionTitle, department: position.department }));
      }));
      const [skillsResponse, employeeSkillsResponse, developmentPlansResponse, talentAssessmentsResponse, committeeReportsResponse] = await Promise.all([
        fetch("/api/services/skills", { credentials: "include" }),
        fetch("/api/services/employee-skills", { credentials: "include" }),
        fetch("/api/services/succession-development-plans", { credentials: "include" }),
        fetch("/api/services/succession-talent-assessments", { credentials: "include" }),
        fetch("/api/services/succession-committee-reports", { credentials: "include" }),
      ]);
      if (!skillsResponse.ok || !employeeSkillsResponse.ok || !developmentPlansResponse.ok || !talentAssessmentsResponse.ok || !committeeReportsResponse.ok) throw new Error("تعذر تحميل السجلات المحمية.");
      setCriticalPositions(loadedPositions);
      setCandidates(candidateGroups.flat());
      setSkills(await skillsResponse.json());
      setEmployeeSkills(await employeeSkillsResponse.json());
      setDevelopmentPlans(await developmentPlansResponse.json());
      setTalentAssessments(await talentAssessmentsResponse.json());
      const loadedReports: SuccessionCommitteeReport[] = await committeeReportsResponse.json();
      setCommitteeReports(loadedReports);
      const decisionGroups = await Promise.all(loadedReports.map(async report => {
        const response = await fetch(`/api/services/succession-committee-reports/${encodeURIComponent(report.id)}/decisions`, { credentials: "include" });
        if (!response.ok) throw new Error("تعذر تحميل قرارات اللجنة.");
        return response.json() as Promise<SuccessionCommitteeDecision[]>;
      }));
      setCommitteeDecisions(decisionGroups.flat());
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر الاتصال بالخدمة.";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManageSuccession) {
      setLoading(false);
      return;
    }
    void loadData();
  }, [canManageSuccession]);

  const metrics = useMemo(() => {
    const highRisk = criticalPositions.filter(item => item.riskLevel === "high").length;
    const covered = criticalPositions.filter(item => (item.candidateCount || 0) > 0).length;
    const readyNow = candidates.filter(item => item.readiness === "ready_now").length;
    return {
      highRisk,
      totalPositions: criticalPositions.length,
      totalCandidates: candidates.length,
      readyNow,
      coverageRate: criticalPositions.length ? Math.round((covered / criticalPositions.length) * 100) : 0,
      covered,
      activeDevelopmentPlans: developmentPlans.filter(item => item.status === "in_progress").length,
    };
  }, [candidates, criticalPositions, developmentPlans]);

  const normalizedSearch = searchTerm.trim();
  const visiblePositions = criticalPositions.filter(position => !normalizedSearch || [position.positionTitle, position.department, position.currentHolderName].some(value => value?.includes(normalizedSearch)));
  const visibleCandidates = candidates.filter(candidate => !normalizedSearch || [candidate.employeeName, candidate.positionTitle, candidate.department].some(value => value?.includes(normalizedSearch)));
  const visibleDevelopmentPlans = developmentPlans.filter(plan => !normalizedSearch || [plan.candidateName, plan.positionTitle, plan.activity, plan.targetGap].some(value => value?.includes(normalizedSearch)));

  const postJson = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "تعذر حفظ السجل. تحقق من الصلاحيات والبيانات.");
    }
    return response.json();
  };

  const savePosition = async () => {
    if (!positionForm.positionTitle.trim()) return toast.error("المسمى الوظيفي مطلوب.");
    try {
      const response = await fetch(editingPosition ? `/api/services/critical-positions/${encodeURIComponent(editingPosition.id)}` : "/api/services/critical-positions", { method: editingPosition ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(positionForm) });
      if (!response.ok) throw new Error("تعذر حفظ المنصب. تحقق من الصلاحيات والبيانات.");
      toast.success(editingPosition ? "حُدّث المنصب الحرج." : "حُفظ المنصب الحرج.");
      setShowPositionModal(false);
      setEditingPosition(null);
      setPositionForm({ positionTitle: "", department: "", currentHolderId: "", currentHolderName: "", riskLevel: "medium", notes: "" });
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ المنصب."); }
  };

  const saveCandidate = async () => {
    if (!candidateForm.positionId || !candidateForm.employeeId || !candidateForm.employeeName) return toast.error("اختر المنصب والموظف.");
    try {
      if (editingCandidate) {
        const response = await fetch(`/api/services/succession-candidates/${encodeURIComponent(editingCandidate.id)}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ readiness: candidateForm.readiness, notes: candidateForm.notes }) });
        if (!response.ok) throw new Error("تعذر تحديث المرشح. تحقق من الصلاحيات والبيانات.");
      } else {
        await postJson(`/api/services/critical-positions/${encodeURIComponent(candidateForm.positionId)}/candidates`, candidateForm);
      }
      toast.success(editingCandidate ? "حُدّث مرشح التعاقب." : "حُفظ مرشح التعاقب.");
      setShowCandidateModal(false);
      setEditingCandidate(null);
      setCandidateForm({ positionId: "", employeeId: "", employeeName: "", readiness: "developing", notes: "" });
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ المرشح."); }
  };

  const saveSkill = async () => {
    if (!skillForm.name.trim()) return toast.error("اسم المهارة مطلوب.");
    try {
      await postJson("/api/services/skills", skillForm);
      toast.success("حُفظت المهارة.");
      setShowSkillModal(false);
      setSkillForm({ name: "", category: SKILL_CATEGORIES[0], description: "" });
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ المهارة."); }
  };

  const saveAssignment = async () => {
    if (!assignForm.employeeId || !assignForm.skillId) return toast.error("اختر الموظف والمهارة.");
    try {
      await postJson("/api/services/employee-skills", {
        employeeId: assignForm.employeeId,
        skillId: assignForm.skillId,
        currentLevel: assignForm.currentLevel,
        targetLevel: assignForm.targetLevel,
        notes: assignForm.notes,
      });
      toast.success("حُفظ تعيين المهارة.");
      setShowAssignModal(false);
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ تعيين المهارة."); }
  };

  const resetDevelopmentPlanForm = () => setDevelopmentPlanForm({ candidateId: "", targetGap: "", interventionType: "", activity: "", responsible: "", startDate: "", endDate: "", completion: 0, status: "not_started", priority: "medium" });
  const saveDevelopmentPlan = async () => {
    if (!developmentPlanForm.candidateId || !developmentPlanForm.activity.trim()) return toast.error("اختر المرشح وأدخل نشاط التطوير.");
    if (developmentPlanForm.startDate && developmentPlanForm.endDate && developmentPlanForm.endDate < developmentPlanForm.startDate) return toast.error("يجب ألا يسبق تاريخ انتهاء الخطة تاريخ بدايتها.");
    const body = {
      ...developmentPlanForm,
      responsible: developmentPlanForm.responsible.trim(),
      startDate: developmentPlanForm.startDate ? new Date(`${developmentPlanForm.startDate}T00:00:00`).getTime() : null,
      endDate: developmentPlanForm.endDate ? new Date(`${developmentPlanForm.endDate}T00:00:00`).getTime() : null,
    };
    try {
      const url = editingDevelopmentPlan ? `/api/services/succession-development-plans/${encodeURIComponent(editingDevelopmentPlan.id)}` : "/api/services/succession-development-plans";
      const payload = editingDevelopmentPlan ? (({ candidateId: _candidateId, ...update }) => update)(body) : body;
      const response = await fetch(url, { method: editingDevelopmentPlan ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("تعذر حفظ خطة التطوير. تحقق من الصلاحيات والحقول.");
      toast.success(editingDevelopmentPlan ? "حُدّثت خطة التطوير." : "حُفظت خطة التطوير.");
      setShowDevelopmentPlanModal(false);
      setEditingDevelopmentPlan(null);
      resetDevelopmentPlanForm();
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ خطة التطوير."); }
  };

  const resetTalentAssessmentForm = () => setTalentAssessmentForm({ employeeId: "", employeeName: "", department: "", assessmentPeriod: "", performanceScore: 2, potentialScore: 2, notes: "" });
  const saveTalentAssessment = async () => {
    if (!talentAssessmentForm.employeeId || !talentAssessmentForm.assessmentPeriod.trim()) return toast.error("اختر الموظف وأدخل فترة التقييم.");
    try {
      const response = await fetch("/api/services/succession-talent-assessments", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: talentAssessmentForm.employeeId, assessmentPeriod: talentAssessmentForm.assessmentPeriod, performanceScore: talentAssessmentForm.performanceScore, potentialScore: talentAssessmentForm.potentialScore, notes: talentAssessmentForm.notes }) });
      if (!response.ok) throw new Error("تعذر حفظ تقييم 9-Box. تحقق من الصلاحيات والحقول.");
      toast.success(editingTalentAssessment ? "حُدّث تقييم 9-Box." : "حُفظ تقييم 9-Box.");
      setShowTalentAssessmentModal(false);
      setEditingTalentAssessment(null);
      resetTalentAssessmentForm();
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ تقييم 9-Box."); }
  };

  const resetCommitteeReportForm = () => setCommitteeReportForm({ title: "", meetingDate: "", reportingPeriod: "", summary: "", status: "draft" });
  const saveCommitteeReport = async () => {
    if (!committeeReportForm.title.trim() || !committeeReportForm.reportingPeriod.trim()) return toast.error("أدخل عنوان المحضر وفترة التقرير.");
    const { status: _formStatus, ...reportFields } = committeeReportForm;
    const body = { ...reportFields, meetingDate: committeeReportForm.meetingDate ? new Date(`${committeeReportForm.meetingDate}T00:00:00`).getTime() : null };
    try {
      const response = await fetch(editingCommitteeReport ? `/api/services/succession-committee-reports/${encodeURIComponent(editingCommitteeReport.id)}` : "/api/services/succession-committee-reports", { method: editingCommitteeReport ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("تعذر حفظ محضر اللجنة. تحقق من الصلاحيات والحقول.");
      toast.success(editingCommitteeReport ? "حُدّث محضر اللجنة." : "حُفظ محضر اللجنة.");
      setShowCommitteeReportModal(false); setEditingCommitteeReport(null); resetCommitteeReportForm(); await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ محضر اللجنة."); }
  };
  const resetCommitteeDecisionForm = () => setCommitteeDecisionForm({ positionId: "", candidateId: "", decisionType: "other", decisionText: "", ownerName: "", dueDate: "", status: "open" });
  const saveCommitteeDecision = async () => {
    const reportId = editingCommitteeDecision?.reportId || selectedCommitteeReportId;
    if (!reportId || !committeeDecisionForm.decisionText.trim()) return toast.error("اختر المحضر وأدخل نص القرار.");
    const body = { ...committeeDecisionForm, positionId: committeeDecisionForm.positionId || null, candidateId: committeeDecisionForm.candidateId || null, ownerName: committeeDecisionForm.ownerName.trim(), dueDate: committeeDecisionForm.dueDate ? new Date(`${committeeDecisionForm.dueDate}T00:00:00`).getTime() : null };
    try {
      const url = editingCommitteeDecision ? `/api/services/succession-committee-decisions/${encodeURIComponent(editingCommitteeDecision.id)}` : `/api/services/succession-committee-reports/${encodeURIComponent(reportId)}/decisions`;
      const response = await fetch(url, { method: editingCommitteeDecision ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("تعذر حفظ قرار اللجنة. تحقق من الصلاحيات والحقول.");
      toast.success(editingCommitteeDecision ? "حُدّث قرار اللجنة." : "حُفظ قرار اللجنة.");
      setShowCommitteeDecisionModal(false); setEditingCommitteeDecision(null); resetCommitteeDecisionForm(); await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر حفظ قرار اللجنة."); }
  };
  const transitionCommitteeReport = async (reportId: string, action: "submit" | "approved" | "rejected") => {
    try {
      const url = action === "submit" ? `/api/services/succession-committee-reports/${encodeURIComponent(reportId)}/submit` : `/api/services/succession-committee-reports/${encodeURIComponent(reportId)}/review`;
      const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: action === "submit" ? undefined : JSON.stringify({ outcome: action, reviewNote: "" }) });
      if (!response.ok) throw new Error("تعذر تحديث حالة اعتماد المحضر. تحقق من الصلاحيات.");
      toast.success(action === "submit" ? "أُرسل المحضر للمراجعة." : action === "approved" ? "اعتُمد محضر اللجنة." : "أُعيد المحضر إلى المسودة للمراجعة.");
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر تحديث حالة الاعتماد."); }
  };

  const deleteRecord = async (url: string, name: string) => {
    if (!window.confirm(`هل تريد حذف ${name}؟`)) return;
    try {
      const response = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("تعذر الحذف. تحقق من الصلاحيات.");
      toast.success("تم الحذف.");
      await loadData();
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر الحذف."); }
  };

  const tabs: Array<{ id: TabId; label: string; icon: typeof Shield }> = [
    { id: "dashboard", label: "لوحة التحكم", icon: Crown },
    { id: "positions", label: "المناصب الحرجة", icon: Shield },
    { id: "candidates", label: "المرشحون", icon: Users },
    { id: "development", label: "خطط التطوير", icon: ClipboardList },
    { id: "advanced", label: "تحليلات متقدمة", icon: FileWarning },
    { id: "committee", label: "تقرير اللجنة", icon: ClipboardList },
    { id: "skills", label: "المهارات", icon: Zap },
  ];

  if (!canManageSuccession) return <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24, color: "hsl(var(--muted-foreground))", direction: "rtl", fontFamily: "Alexandria" }}><div style={{ ...cardStyle, maxWidth: 560, padding: 32, textAlign: "center" }}><Shield size={38} color="#F59E0B" style={{ marginBottom: 12 }} /><h1 style={{ color: "hsl(var(--foreground))", fontSize: 18, margin: "0 0 8px" }}>الوصول إلى التعاقب الوظيفي مقيّد</h1><p style={{ margin: 0, fontSize: 12, lineHeight: 1.9 }}>هذه السجلات الاستراتيجية متاحة للمديرين والجهات المخوّلة فقط. يظل سجل مسارك الوظيفي الشخصي متاحاً من صفحة المسار الوظيفي.</p></div></div>;
  if (loading) return <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: mutedText, direction: "rtl", fontFamily: "Alexandria" }}><div style={{ textAlign: "center" }}><RefreshCw size={32} color={peoplePrimary} style={{ animation: "spin 1s linear infinite" }} /><p>جاري تحميل السجلات المحفوظة والمحميّة…</p></div></div>;

  return <div data-succession-readonly={!canEditSuccession} style={{ fontFamily: "Alexandria", direction: "rtl", padding: "24px 28px", minHeight: "100vh", background: "hsl(var(--background))" }}>
    <style>{`[data-succession-readonly="true"] button[aria-label^="إضافة"], [data-succession-readonly="true"] button[aria-label^="تعديل"], [data-succession-readonly="true"] button[aria-label^="حذف"] { display: none !important; } [role="dialog"] label:has(select option[value="finalized"]) { display: none !important; }`}</style>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 20 }}>
      <div>
        <h1 style={{ fontSize: 25, margin: 0, color: foreground, display: "flex", alignItems: "center", gap: 10 }}><Crown color={peoplePrimary} /> التعاقب الوظيفي ومصفوفة المهارات</h1>
        <p style={{ color: mutedText, fontSize: 12, margin: "7px 0 0", maxWidth: 680 }}>تعرض هذه الصفحة فقط سجلات التعاقب والمهارات المحفوظة في المنصة. لا تُنشأ بيانات تقييم أو خطط تطوير افتراضية من قائمة الموظفين.</p>
      </div>
      <div style={{ position: "relative", width: 240 }}><Search size={15} style={{ position: "absolute", right: 12, top: 12, color: "hsl(var(--muted-foreground))" }} /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="بحث في السجلات…" style={{ ...inputStyle, paddingRight: 35 }} /></div>
    </header>

    {loadError && <div role="alert" style={{ ...cardStyle, borderColor: "rgba(239,68,68,.45)", padding: 14, color: "#FCA5A5", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}><AlertTriangle size={18} /> {loadError}<button onClick={() => void loadData()} style={{ marginRight: "auto", border: "none", background: "transparent", color: "#5EEAD4", cursor: "pointer", fontFamily: "Alexandria" }}>إعادة المحاولة</button></div>}

    <nav aria-label="أقسام التعاقب والمهارات" style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 7, marginBottom: 22 }}>{tabs.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 15px", borderRadius: 10, border: active ? "1px solid hsl(var(--primary) / .55)" : "1px solid transparent", color: active ? peoplePrimary : mutedText, background: active ? peoplePrimarySoft : "transparent", font: "700 12px Alexandria", cursor: "pointer", whiteSpace: "nowrap" }}><Icon size={15} />{tab.label}</button>; })}</nav>

    {activeTab === "dashboard" && <section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 13, marginBottom: 19 }}>
        {[
          { label: "المناصب الحرجة", value: metrics.totalPositions, sub: `${metrics.highRisk} عالية المخاطر`, icon: Shield, color: "#EF4444" },
          { label: "مرشحو التعاقب", value: metrics.totalCandidates, sub: `${metrics.readyNow} جاهز الآن`, icon: UserCheck, color: "#3B82F6" },
          { label: "التغطية بسجل مرشح", value: `${metrics.coverageRate}%`, sub: `${metrics.covered} من ${metrics.totalPositions} منصب`, icon: CheckCircle2, color: "#10B981" },
          { label: "خطط تطوير قيد التنفيذ", value: metrics.activeDevelopmentPlans, sub: `${developmentPlans.length} خطة محفوظة`, icon: ClipboardList, color: "#A78BFA" },
        ].map(item => { const Icon = item.icon; return <div key={item.label} style={{ ...cardStyle, padding: 18 }}><div style={{ display: "flex", alignItems: "center", gap: 9, color: "hsl(var(--muted-foreground))", fontSize: 11, fontWeight: 800 }}><Icon size={17} color={item.color} />{item.label}</div><div style={{ fontSize: 26, color: "hsl(var(--foreground))", fontWeight: 900, marginTop: 10 }}>{item.value}</div><div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>{item.sub}</div></div>; })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <div style={{ ...cardStyle, padding: 18 }}><h2 style={{ color: "hsl(var(--foreground))", fontSize: 14, margin: "0 0 13px" }}>توزيع مستوى المخاطر</h2>{RISK_OPTIONS.map(risk => { const count = criticalPositions.filter(item => item.riskLevel === risk.value).length; return <div key={risk.value} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid hsl(var(--foreground) / .05)" }}><Badge label={risk.label} color={risk.color} background={risk.background} /><span style={{ color: "hsl(var(--foreground))", fontWeight: 800 }}>{count}</span></div>; })}</div>
        <div style={{ ...cardStyle, padding: 18 }}><h2 style={{ color: "hsl(var(--foreground))", fontSize: 14, margin: "0 0 13px" }}>توزيع جاهزية المرشحين</h2>{READINESS_OPTIONS.map(readiness => { const count = candidates.filter(candidate => candidate.readiness === readiness.value).length; return <div key={readiness.value} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid hsl(var(--foreground) / .05)" }}><Badge label={readiness.label} color={readiness.color} background={readiness.background} /><span style={{ color: "hsl(var(--foreground))", fontWeight: 800 }}>{count}</span></div>; })}</div>
        <div style={{ ...cardStyle, padding: 18 }}><h2 style={{ color: "hsl(var(--foreground))", fontSize: 14, margin: "0 0 13px" }}>حالة خطط التطوير</h2>{PLAN_STATUSES.map(status => { const count = developmentPlans.filter(plan => plan.status === status.value).length; return <div key={status.value} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid hsl(var(--foreground) / .05)" }}><Badge label={status.label} color={status.color} background={status.background} /><span style={{ color: "hsl(var(--foreground))", fontWeight: 800 }}>{count}</span></div>; })}</div>
        <div style={{ ...cardStyle, padding: 18 }}><h2 style={{ color: "hsl(var(--foreground))", fontSize: 14, margin: "0 0 13px" }}>ضبط البيانات</h2><p style={{ color: "hsl(var(--muted-foreground))", fontSize: 12, lineHeight: 1.9, margin: 0 }}>جميع المؤشرات هنا ناتجة من سجلات محمية ومحفوظة: المناصب والمرشحون وخطط التطوير وتقييمات 9-Box ومحاضر اللجنة. لا تُنشأ المنصة أي درجة أو قرار تلقائياً.</p></div>
      </div>
    </section>}

    {activeTab === "positions" && <section>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 15 }}><h2 style={{ fontSize: 17, color: foreground, margin: 0 }}>المناصب الحرجة ({visiblePositions.length})</h2>{canEditSuccession && <button aria-label="إضافة منصب" onClick={() => setShowPositionModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 15px", borderRadius: 10, border: "none", color: "hsl(var(--primary-foreground))", background: peoplePrimary, font: "700 12px Alexandria", cursor: "pointer" }}><Plus size={15} />إضافة منصب</button>}</div>
      {visiblePositions.length === 0 ? <EmptyState icon={Shield} title="لا توجد مناصب حرجة محفوظة" detail="لن تُشتق المناصب من المسميات الوظيفية. أضف سجلاً معتمداً فقط عند وجود قرار إداري موثق." /> : <div style={{ ...cardStyle, overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}><thead><tr>{["المسمى", "الإدارة", "الشاغل الحالي", "مستوى المخاطر", "المرشحون", "ملاحظات", "إجراء"].map(header => <th key={header} style={{ padding: "13px 14px", textAlign: "right", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--foreground) / .08)", fontSize: 11 }}>{header}</th>)}</tr></thead><tbody>{visiblePositions.map(position => { const risk = badgeForRisk(position.riskLevel); return <tr key={position.id}><td style={{ padding: 14, color: "hsl(var(--foreground))", fontWeight: 800, fontSize: 12 }}>{position.positionTitle}</td><td style={{ padding: 14, color: "hsl(var(--muted-foreground))", fontSize: 12 }}>{position.department || "—"}</td><td style={{ padding: 14, color: "hsl(var(--muted-foreground))", fontSize: 12 }}>{position.currentHolderName || "غير محدد"}</td><td style={{ padding: 14 }}><Badge label={risk.label} color={risk.color} background={risk.background} /></td><td style={{ padding: 14, color: "hsl(var(--foreground))", fontWeight: 800 }}>{position.candidateCount || 0}</td><td style={{ padding: 14, color: "hsl(var(--muted-foreground))", fontSize: 11, maxWidth: 240 }}>{position.notes || "—"}</td><td style={{ padding: 14 }}><div style={{ display: "flex", gap: 6 }}><button aria-label={`عرض ملف ${position.positionTitle}`} onClick={() => setSelectedPosition(position)} style={{ border: "none", background: "hsl(165 69% 39% / .14)", color: "#5EEAD4", cursor: "pointer", padding: 7, borderRadius: 7 }}><Eye size={14} /></button><button aria-label={`تعديل ${position.positionTitle}`} onClick={() => { setEditingPosition(position); setPositionForm({ positionTitle: position.positionTitle, department: position.department || "", currentHolderId: position.currentHolderId || "", currentHolderName: position.currentHolderName || "", riskLevel: position.riskLevel, notes: position.notes || "" }); setShowPositionModal(true); }} style={{ border: "none", background: "rgba(59,130,246,.14)", color: "#93C5FD", cursor: "pointer", padding: 7, borderRadius: 7 }}><Pencil size={14} /></button><button aria-label={`حذف ${position.positionTitle}`} onClick={() => void deleteRecord(`/api/services/critical-positions/${encodeURIComponent(position.id)}`, "المنصب الحرج")} style={{ border: "none", background: "rgba(239,68,68,.14)", color: "#F87171", cursor: "pointer", padding: 7, borderRadius: 7 }}><Trash2 size={14} /></button></div></td></tr>; })}</tbody></table></div>}
    </section>}

    {activeTab === "candidates" && <section>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 15 }}><h2 style={{ fontSize: 17, color: foreground, margin: 0 }}>مرشحو التعاقب ({visibleCandidates.length})</h2>{canEditSuccession && <button aria-label="إضافة مرشح" onClick={() => setShowCandidateModal(true)} disabled={criticalPositions.length === 0} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 15px", borderRadius: 10, border: "none", color: "hsl(var(--primary-foreground))", background: criticalPositions.length ? peoplePrimary : "hsl(var(--muted))", font: "700 12px Alexandria", cursor: criticalPositions.length ? "pointer" : "not-allowed" }}><Plus size={15} />إضافة مرشح</button>}</div>
      {visibleCandidates.length === 0 ? <EmptyState icon={Users} title="لا يوجد مرشحون محفوظون" detail="أضف مرشحاً فقط إلى منصب حرج محفوظ، مع مستوى جاهزية معتمد. لا تستنتج المنصة مرشحين تلقائياً من قائمة الموظفين." /> : <div style={{ display: "grid", gap: 10 }}>{visibleCandidates.map(candidate => { const readiness = badgeForReadiness(candidate.readiness); const expanded = candidate.id === expandedCandidate; return <article key={candidate.id} style={cardStyle}><div onClick={() => setExpandedCandidate(expanded ? null : candidate.id)} style={{ cursor: "pointer", padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div style={{ display: "flex", gap: 11, alignItems: "center" }}><div style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "hsl(165 69% 39% / .14)" }}><UserCheck size={18} color="#35D7B6" /></div><div><div style={{ color: "hsl(var(--foreground))", fontWeight: 800, fontSize: 13 }}>{candidate.employeeName || candidate.employeeId}</div><div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginTop: 3 }}>{candidate.positionTitle}{candidate.department ? ` — ${candidate.department}` : ""}</div></div></div><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Badge label={readiness.label} color={readiness.color} background={readiness.background} /><button aria-label={`تعديل المرشح ${candidate.employeeName || candidate.employeeId}`} onClick={event => { event.stopPropagation(); setEditingCandidate(candidate); setCandidateForm({ positionId: candidate.positionId, employeeId: candidate.employeeId, employeeName: candidate.employeeName || "", readiness: candidate.readiness, notes: candidate.notes || "" }); setShowCandidateModal(true); }} style={{ border: "none", background: "rgba(59,130,246,.14)", color: "#93C5FD", cursor: "pointer", padding: 7, borderRadius: 7 }}><Pencil size={14} /></button><button aria-label={`حذف المرشح ${candidate.employeeName || candidate.employeeId}`} onClick={event => { event.stopPropagation(); void deleteRecord(`/api/services/succession-candidates/${encodeURIComponent(candidate.id)}`, "مرشح التعاقب"); }} style={{ border: "none", background: "rgba(239,68,68,.14)", color: "#F87171", cursor: "pointer", padding: 7, borderRadius: 7 }}><Trash2 size={14} /></button>{expanded ? <ChevronUp color="hsl(var(--muted-foreground))" size={16} /> : <ChevronDown color="hsl(var(--muted-foreground))" size={16} />}</div></div>{expanded && <div style={{ padding: "0 16px 16px", color: "hsl(var(--muted-foreground))", fontSize: 12, lineHeight: 1.8, borderTop: "1px solid hsl(var(--foreground) / .06)", paddingTop: 12 }}><strong style={{ color: "hsl(var(--muted-foreground))" }}>ملاحظات السجل:</strong> {candidate.notes || "لا توجد ملاحظات محفوظة."}</div>}</article>; })}</div>}
    </section>}

    {activeTab === "development" && <section>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 15, flexWrap: "wrap" }}><div><h2 style={{ fontSize: 17, color: foreground, margin: 0 }}>خطط تطوير المرشحين ({visibleDevelopmentPlans.length})</h2><p style={{ color: mutedText, fontSize: 11, margin: "5px 0 0" }}>سجل محفوظ لكل نشاط تطوير مرتبط بمرشح تعاقب قائم.</p></div>{canEditSuccession && <button aria-label="إضافة خطة تطوير" onClick={() => setShowDevelopmentPlanModal(true)} disabled={candidates.length === 0} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 15px", borderRadius: 10, border: "none", color: "hsl(var(--primary-foreground))", background: candidates.length ? peoplePrimary : "hsl(var(--muted))", font: "700 12px Alexandria", cursor: candidates.length ? "pointer" : "not-allowed" }}><Plus size={15} />إضافة خطة تطوير</button>}</div>
      {visibleDevelopmentPlans.length === 0 ? <EmptyState icon={ClipboardList} title="لا توجد خطط تطوير محفوظة" detail="أنشئ نشاط تطوير لمرشح تعاقب محفوظ. لا تنشئ المنصة خططاً تلقائية من المهارات أو قائمة الموظفين." /> : <div style={{ display: "grid", gap: 10 }}>{visibleDevelopmentPlans.map(plan => { const status = badgeForPlanStatus(plan.status); const priority = PLAN_PRIORITIES.find(item => item.value === plan.priority) || PLAN_PRIORITIES[1]; return <article key={plan.id} style={{ ...cardStyle, padding: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}><div><div style={{ color: foreground, fontWeight: 800, fontSize: 14 }}>{plan.activity}</div><div style={{ color: mutedText, fontSize: 11, marginTop: 4 }}>{plan.candidateName || plan.candidateId} — {plan.positionTitle}</div></div><div style={{ display: "flex", alignItems: "center", gap: 7 }}><Badge label={status.label} color={status.color} background={status.background} /><Badge label={`أولوية ${priority.label}`} color={priority.color} background={`${priority.color}20`} /><button aria-label={`تعديل خطة ${plan.activity}`} onClick={() => { setEditingDevelopmentPlan(plan); setDevelopmentPlanForm({ candidateId: plan.candidateId, targetGap: plan.targetGap, interventionType: plan.interventionType, activity: plan.activity, responsible: plan.responsible || "", startDate: plan.startDate ? new Date(plan.startDate).toISOString().slice(0, 10) : "", endDate: plan.endDate ? new Date(plan.endDate).toISOString().slice(0, 10) : "", completion: plan.completion, status: plan.status, priority: plan.priority }); setShowDevelopmentPlanModal(true); }} style={{ border: "none", background: "rgba(59,130,246,.14)", color: "#93C5FD", cursor: "pointer", padding: 7, borderRadius: 7 }}><Pencil size={14} /></button><button aria-label={`حذف خطة ${plan.activity}`} onClick={() => void deleteRecord(`/api/services/succession-development-plans/${encodeURIComponent(plan.id)}`, "خطة التطوير")} style={{ border: "none", background: "rgba(239,68,68,.14)", color: "#F87171", cursor: "pointer", padding: 7, borderRadius: 7 }}><Trash2 size={14} /></button></div></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 14, color: mutedText, fontSize: 11 }}><div><strong style={{ color: foreground }}>فجوة مستهدفة:</strong> {plan.targetGap || "—"}</div><div><strong style={{ color: foreground }}>التدخل:</strong> {plan.interventionType || "—"}</div><div><strong style={{ color: foreground }}>المسؤول:</strong> {plan.responsible || "—"}</div><div><strong style={{ color: foreground }}>المدة:</strong> {plan.startDate ? new Date(plan.startDate).toLocaleDateString("ar-SA") : "—"} {plan.endDate ? `حتى ${new Date(plan.endDate).toLocaleDateString("ar-SA")}` : ""}</div></div><div style={{ marginTop: 14 }}><div style={{ display: "flex", justifyContent: "space-between", color: mutedText, fontSize: 11, marginBottom: 6 }}><span>نسبة الإنجاز</span><strong style={{ color: peoplePrimary }}>{plan.completion}%</strong></div><div style={{ height: 7, borderRadius: 999, background: "hsl(var(--muted))", overflow: "hidden" }}><div style={{ height: "100%", width: `${plan.completion}%`, background: peoplePrimary, borderRadius: 999 }} /></div></div></article>; })}</div>}
    </section>}

    {activeTab === "advanced" && <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 15 }}><div><h2 style={{ fontSize: 17, color: foreground, margin: 0 }}>مصفوفة 9-Box</h2><p style={{ color: mutedText, fontSize: 11, margin: "5px 0 0" }}>تعرض التقييمات الخادمية الصريحة للأداء والإمكانات فقط؛ لا تُشتق درجات لأي موظف. محاضر اللجنة وقراراتها متاحة في تبويب تقرير اللجنة وفق سير التقديم والمراجعة والاعتماد.</p></div>{canEditSuccession && <button onClick={() => { setEditingTalentAssessment(null); resetTalentAssessmentForm(); setShowTalentAssessmentModal(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 15px", borderRadius: 10, border: "none", color: "hsl(var(--primary-foreground))", background: peoplePrimary, font: "700 12px Alexandria", cursor: "pointer" }}><Plus size={15} />إضافة تقييم معتمد</button>}</div>
      <NineBoxMatrix assessments={talentAssessments} canEdit={canEditSuccession} onEdit={assessment => { setEditingTalentAssessment(assessment); setTalentAssessmentForm({ employeeId: assessment.employeeId, employeeName: assessment.employeeName, department: assessment.department || "", assessmentPeriod: assessment.assessmentPeriod, performanceScore: assessment.performanceScore, potentialScore: assessment.potentialScore, notes: assessment.notes || "" }); setShowTalentAssessmentModal(true); }} onDelete={assessment => void deleteRecord(`/api/services/succession-talent-assessments/${encodeURIComponent(assessment.id)}`, "تقييم 9-Box")} />
    </section>}

    {activeTab === "committee" && <section><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 15 }}><div><h2 style={{ fontSize: 17, color: foreground, margin: 0 }}>محاضر وقرارات لجنة التعاقب</h2><p style={{ color: mutedText, fontSize: 11, margin: "5px 0 0" }}>تعرض المحاضر والقرارات التي حُفظت واعتمدت داخل المنصة فقط.</p></div>{canEditSuccession && <button onClick={() => { setEditingCommitteeReport(null); resetCommitteeReportForm(); setShowCommitteeReportModal(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 15px", borderRadius: 10, border: "none", color: "hsl(var(--primary-foreground))", background: peoplePrimary, font: "700 12px Alexandria", cursor: "pointer" }}><Plus size={15} />إضافة محضر</button>}</div>{committeeReports.length === 0 ? <EmptyState icon={ClipboardList} title="لا توجد محاضر لجنة محفوظة" detail="لن تنشئ المنصة محضراً أو قراراً تلقائياً. أضف محضراً معتمداً لتوثيق مخرجات الاجتماع." /> : <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,.75fr) minmax(330px,1.5fr)", gap: 13 }}><div style={{ display: "grid", gap: 8, alignContent: "start" }}>{committeeReports.map(report => { const active = selectedCommitteeReportId === report.id; return <article key={report.id} onClick={() => setSelectedCommitteeReportId(report.id)} style={{ ...cardStyle, padding: 13, cursor: "pointer", borderColor: active ? "hsl(var(--primary) / .55)" : undefined, background: active ? "hsl(var(--primary) / .10)" : undefined }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div><div style={{ color: foreground, fontSize: 12, fontWeight: 800 }}>{report.title}</div><div style={{ color: mutedText, fontSize: 10, marginTop: 4 }}>{report.reportingPeriod}{report.meetingDate ? ` — ${new Date(report.meetingDate).toLocaleDateString("ar-SA")}` : ""}</div></div><Badge label={report.status === "finalized" ? "نهائي" : "مسودة"} color={report.status === "finalized" ? peoplePrimary : "#FCD34D"} background={report.status === "finalized" ? "hsl(var(--primary) / .14)" : "rgba(245,158,11,.14)"} /></div>{canEditSuccession && <div style={{ display: "flex", gap: 4, marginTop: 9 }}><button aria-label={`تعديل محضر ${report.title}`} onClick={event => { event.stopPropagation(); setEditingCommitteeReport(report); setCommitteeReportForm({ title: report.title, meetingDate: report.meetingDate ? new Date(report.meetingDate).toISOString().slice(0, 10) : "", reportingPeriod: report.reportingPeriod, summary: report.summary || "", status: report.status }); setShowCommitteeReportModal(true); }} style={{ border: 0, background: "transparent", color: "#93C5FD", cursor: "pointer", padding: 2 }}><Pencil size={13} /></button><button aria-label={`حذف محضر ${report.title}`} onClick={event => { event.stopPropagation(); void deleteRecord(`/api/services/succession-committee-reports/${encodeURIComponent(report.id)}`, "محضر اللجنة"); }} style={{ border: 0, background: "transparent", color: "#F87171", cursor: "pointer", padding: 2 }}><Trash2 size={13} /></button></div>}</article>; })}</div><CommitteeReportDetail report={committeeReports.find(report => report.id === selectedCommitteeReportId) || null} decisions={committeeDecisions.filter(decision => decision.reportId === selectedCommitteeReportId)} canEdit={canEditSuccession} onAddDecision={() => { if (!selectedCommitteeReportId) return; setEditingCommitteeDecision(null); resetCommitteeDecisionForm(); setShowCommitteeDecisionModal(true); }} onEditDecision={decision => { setEditingCommitteeDecision(decision); setCommitteeDecisionForm({ positionId: decision.positionId || "", candidateId: decision.candidateId || "", decisionType: decision.decisionType, decisionText: decision.decisionText, ownerName: decision.ownerName || "", dueDate: decision.dueDate ? new Date(decision.dueDate).toISOString().slice(0, 10) : "", status: decision.status }); setShowCommitteeDecisionModal(true); }} onDeleteDecision={decision => void deleteRecord(`/api/services/succession-committee-decisions/${encodeURIComponent(decision.id)}`, "قرار اللجنة")} /></div>}</section>}

    {activeTab === "committee" && <CommitteeWorkflowActions report={committeeReports.find(report => report.id === selectedCommitteeReportId) || null} canEdit={canEditSuccession} canReview={canReviewCommittee} onTransition={transitionCommitteeReport} />}

    {activeTab === "skills" && <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 15 }}><h2 style={{ fontSize: 17, color: foreground, margin: 0 }}>مصفوفة المهارات</h2>{canEditSuccession && <div style={{ display: "flex", gap: 8 }}><button aria-label="إضافة تعيين مهارة" onClick={() => setShowAssignModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 13px", borderRadius: 10, border: "none", color: "#93C5FD", background: "rgba(59,130,246,.15)", font: "700 12px Alexandria", cursor: "pointer" }}><Plus size={15} />تعيين مهارة</button><button aria-label="إضافة مهارة جديدة" onClick={() => setShowSkillModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 13px", borderRadius: 10, border: "none", color: "hsl(var(--primary-foreground))", background: peoplePrimary, font: "700 12px Alexandria", cursor: "pointer" }}><Plus size={15} />مهارة جديدة</button></div>}</div>
      {skills.length === 0 ? <EmptyState icon={Zap} title="لا توجد مهارات محفوظة" detail="أضف تعريف مهارة معتمد قبل ربطها بسجل موظف." /> : <><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12, marginBottom: 19 }}>{skills.filter(skill => !normalizedSearch || skill.name.includes(normalizedSearch)).map(skill => <div key={skill.id} style={{ ...cardStyle, padding: 16 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div><div style={{ color: "hsl(var(--foreground))", fontWeight: 800, fontSize: 13 }}>{skill.name}</div><div style={{ color: "#47E0C1", marginTop: 5, fontSize: 11 }}>{skill.category || "غير مصنفة"}</div></div><button aria-label={`حذف مهارة ${skill.name}`} onClick={() => void deleteRecord(`/api/services/skills/${encodeURIComponent(skill.id)}`, "المهارة")} style={{ border: "none", background: "transparent", color: "#F87171", cursor: "pointer" }}><Trash2 size={14} /></button></div>{skill.description && <p style={{ color: "hsl(var(--muted-foreground))", margin: "9px 0 0", lineHeight: 1.7, fontSize: 11 }}>{skill.description}</p>}</div>)}</div>{employeeSkills.length > 0 && <div style={{ ...cardStyle, overflowX: "auto" }}><table style={{ width: "100%", minWidth: 650, borderCollapse: "collapse" }}><thead><tr>{["الموظف", "المهارة", "الحالي", "المستهدف", "ملاحظات", "إجراء"].map(header => <th key={header} style={{ padding: "13px 14px", textAlign: "right", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--foreground) / .08)", fontSize: 11 }}>{header}</th>)}</tr></thead><tbody>{employeeSkills.filter(item => !normalizedSearch || [item.employeeName, item.skillName].some(value => value?.includes(normalizedSearch))).map(item => <tr key={item.id}><td style={{ padding: 14, color: "hsl(var(--foreground))", fontWeight: 700, fontSize: 12 }}>{item.employeeName || item.employeeId}</td><td style={{ padding: 14, color: "#47E0C1", fontSize: 12 }}>{item.skillName || item.skillId}</td><td style={{ padding: 14, color: "hsl(var(--muted-foreground))", fontSize: 12 }}>{item.currentLevel}/5</td><td style={{ padding: 14, color: "hsl(var(--muted-foreground))", fontSize: 12 }}>{item.targetLevel}/5</td><td style={{ padding: 14, color: "hsl(var(--muted-foreground))", fontSize: 11 }}>{item.notes || "—"}</td><td style={{ padding: 14 }}><button aria-label="حذف تعيين مهارة" onClick={() => void deleteRecord(`/api/services/employee-skills/${encodeURIComponent(item.id)}`, "تعيين المهارة")} style={{ border: "none", background: "rgba(239,68,68,.14)", color: "#F87171", cursor: "pointer", padding: 7, borderRadius: 7 }}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>}</>}
    </section>}

    {showPositionModal && <Modal title={editingPosition ? "تعديل منصب حرج" : "إضافة منصب حرج"} onClose={() => { setShowPositionModal(false); setEditingPosition(null); }}><Field label="المسمى الوظيفي *"><input autoFocus value={positionForm.positionTitle} onChange={event => setPositionForm({ ...positionForm, positionTitle: event.target.value })} style={inputStyle} /></Field><Field label="الإدارة"><select value={positionForm.department} onChange={event => setPositionForm({ ...positionForm, department: event.target.value })} style={inputStyle}><option value="">اختر</option>{DEPARTMENTS.map(department => <option key={department} value={department}>{department}</option>)}</select></Field><Field label="الشاغل الحالي"><select value={positionForm.currentHolderId} onChange={event => { const employee: any = employees.find((item: any) => String(item.employeeId || item.id) === event.target.value); setPositionForm({ ...positionForm, currentHolderId: event.target.value, currentHolderName: employee?.nameAr || employee?.name || "" }); }} style={inputStyle}><option value="">غير محدد</option>{employees.map((employee: any) => <option key={employee.employeeId || employee.id} value={String(employee.employeeId || employee.id)}>{employee.nameAr || employee.name} — {employee.jobTitle}</option>)}</select></Field><Field label="مستوى المخاطر"><select value={positionForm.riskLevel} onChange={event => setPositionForm({ ...positionForm, riskLevel: event.target.value })} style={inputStyle}>{RISK_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="ملاحظات"><textarea value={positionForm.notes} onChange={event => setPositionForm({ ...positionForm, notes: event.target.value })} style={{ ...inputStyle, minHeight: 70 }} /></Field><ModalActions onCancel={() => { setShowPositionModal(false); setEditingPosition(null); }} onSave={() => void savePosition()} /></Modal>}

    {selectedPosition && <PositionProfile position={selectedPosition} candidates={candidates.filter(candidate => candidate.positionId === selectedPosition.id)} plans={developmentPlans.filter(plan => plan.positionId === selectedPosition.id)} onClose={() => setSelectedPosition(null)} />}

    {showCandidateModal && <Modal title={editingCandidate ? "تعديل مرشح تعاقب" : "إضافة مرشح تعاقب"} onClose={() => { setShowCandidateModal(false); setEditingCandidate(null); }}><Field label="المنصب المستهدف *"><select disabled={Boolean(editingCandidate)} value={candidateForm.positionId} onChange={event => setCandidateForm({ ...candidateForm, positionId: event.target.value })} style={{ ...inputStyle, opacity: editingCandidate ? 0.65 : 1 }}><option value="">اختر المنصب</option>{criticalPositions.map(position => <option key={position.id} value={position.id}>{position.positionTitle}{position.department ? ` — ${position.department}` : ""}</option>)}</select></Field><Field label="الموظف *"><select disabled={Boolean(editingCandidate)} value={candidateForm.employeeId} onChange={event => { const employee: any = employees.find((item: any) => String(item.employeeId || item.id) === event.target.value); setCandidateForm({ ...candidateForm, employeeId: event.target.value, employeeName: employee?.nameAr || employee?.name || "" }); }} style={{ ...inputStyle, opacity: editingCandidate ? 0.65 : 1 }}><option value="">اختر الموظف</option>{employees.map((employee: any) => <option key={employee.employeeId || employee.id} value={String(employee.employeeId || employee.id)}>{employee.nameAr || employee.name} — {employee.jobTitle}</option>)}</select></Field><Field label="الجاهزية"><select value={candidateForm.readiness} onChange={event => setCandidateForm({ ...candidateForm, readiness: event.target.value })} style={inputStyle}>{READINESS_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="ملاحظات"><textarea value={candidateForm.notes} onChange={event => setCandidateForm({ ...candidateForm, notes: event.target.value })} style={{ ...inputStyle, minHeight: 70 }} /></Field><ModalActions onCancel={() => { setShowCandidateModal(false); setEditingCandidate(null); }} onSave={() => void saveCandidate()} /></Modal>}

    {showDevelopmentPlanModal && <Modal title={editingDevelopmentPlan ? "تعديل خطة تطوير" : "إضافة خطة تطوير"} onClose={() => { setShowDevelopmentPlanModal(false); setEditingDevelopmentPlan(null); }}><Field label="مرشح التعاقب *"><select disabled={Boolean(editingDevelopmentPlan)} value={developmentPlanForm.candidateId} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, candidateId: event.target.value })} style={{ ...inputStyle, opacity: editingDevelopmentPlan ? 0.65 : 1 }}><option value="">اختر المرشح</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.employeeName || candidate.employeeId} — {candidate.positionTitle}</option>)}</select></Field><Field label="فجوة التطوير المستهدفة"><input value={developmentPlanForm.targetGap} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, targetGap: event.target.value })} style={inputStyle} /></Field><Field label="نوع التدخل"><input value={developmentPlanForm.interventionType} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, interventionType: event.target.value })} placeholder="مثال: تدريب، إرشاد، تكليف" style={inputStyle} /></Field><Field label="نشاط التطوير *"><textarea value={developmentPlanForm.activity} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, activity: event.target.value })} style={{ ...inputStyle, minHeight: 65 }} /></Field><Field label="المسؤول"><input value={developmentPlanForm.responsible} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, responsible: event.target.value })} style={inputStyle} /></Field><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="تاريخ البدء"><input type="date" value={developmentPlanForm.startDate} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, startDate: event.target.value })} style={inputStyle} /></Field><Field label="تاريخ الانتهاء"><input type="date" value={developmentPlanForm.endDate} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, endDate: event.target.value })} style={inputStyle} /></Field></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="الحالة"><select value={developmentPlanForm.status} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, status: event.target.value })} style={inputStyle}>{PLAN_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="الأولوية"><select value={developmentPlanForm.priority} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, priority: event.target.value })} style={inputStyle}>{PLAN_PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field></div><Field label="نسبة الإنجاز (0–100)"><input type="number" min="0" max="100" value={developmentPlanForm.completion} onChange={event => setDevelopmentPlanForm({ ...developmentPlanForm, completion: Number(event.target.value) })} style={inputStyle} /></Field><ModalActions onCancel={() => { setShowDevelopmentPlanModal(false); setEditingDevelopmentPlan(null); }} onSave={() => void saveDevelopmentPlan()} /></Modal>}

    {showTalentAssessmentModal && <Modal title={editingTalentAssessment ? "تعديل تقييم 9-Box" : "إضافة تقييم 9-Box"} onClose={() => { setShowTalentAssessmentModal(false); setEditingTalentAssessment(null); resetTalentAssessmentForm(); }}><Field label="الموظف *"><select disabled={Boolean(editingTalentAssessment)} value={talentAssessmentForm.employeeId} onChange={event => { const employee: any = employees.find((item: any) => String(item.employeeId || item.id) === event.target.value); setTalentAssessmentForm({ ...talentAssessmentForm, employeeId: event.target.value, employeeName: employee?.nameAr || employee?.name || "", department: employee?.department || employee?.departmentEn || "" }); }} style={{ ...inputStyle, opacity: editingTalentAssessment ? 0.65 : 1 }}><option value="">اختر الموظف</option>{employees.map((employee: any) => <option key={employee.employeeId || employee.id} value={String(employee.employeeId || employee.id)}>{employee.nameAr || employee.name} — {employee.jobTitle}</option>)}</select></Field><Field label="فترة التقييم *"><input disabled={Boolean(editingTalentAssessment)} value={talentAssessmentForm.assessmentPeriod} onChange={event => setTalentAssessmentForm({ ...talentAssessmentForm, assessmentPeriod: event.target.value })} placeholder="مثال: 2026-Q1" style={{ ...inputStyle, opacity: editingTalentAssessment ? 0.65 : 1 }} /></Field><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="الأداء"><select value={talentAssessmentForm.performanceScore} onChange={event => setTalentAssessmentForm({ ...talentAssessmentForm, performanceScore: Number(event.target.value) })} style={inputStyle}><option value={1}>1 — منخفض</option><option value={2}>2 — متوسط</option><option value={3}>3 — مرتفع</option></select></Field><Field label="الإمكانات"><select value={talentAssessmentForm.potentialScore} onChange={event => setTalentAssessmentForm({ ...talentAssessmentForm, potentialScore: Number(event.target.value) })} style={inputStyle}><option value={1}>1 — منخفضة</option><option value={2}>2 — متوسطة</option><option value={3}>3 — مرتفعة</option></select></Field></div><Field label="ملاحظات التقييم"><textarea value={talentAssessmentForm.notes} onChange={event => setTalentAssessmentForm({ ...talentAssessmentForm, notes: event.target.value })} style={{ ...inputStyle, minHeight: 70 }} /></Field><ModalActions onCancel={() => { setShowTalentAssessmentModal(false); setEditingTalentAssessment(null); resetTalentAssessmentForm(); }} onSave={() => void saveTalentAssessment()} /></Modal>}

    {showCommitteeReportModal && <Modal title={editingCommitteeReport ? "تعديل محضر اللجنة" : "إضافة محضر اللجنة"} onClose={() => { setShowCommitteeReportModal(false); setEditingCommitteeReport(null); resetCommitteeReportForm(); }}><Field label="عنوان المحضر *"><input value={committeeReportForm.title} onChange={event => setCommitteeReportForm({ ...committeeReportForm, title: event.target.value })} style={inputStyle} /></Field><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="فترة التقرير *"><input value={committeeReportForm.reportingPeriod} onChange={event => setCommitteeReportForm({ ...committeeReportForm, reportingPeriod: event.target.value })} placeholder="مثال: 2026-Q1" style={inputStyle} /></Field><Field label="تاريخ الاجتماع"><input type="date" value={committeeReportForm.meetingDate} onChange={event => setCommitteeReportForm({ ...committeeReportForm, meetingDate: event.target.value })} style={inputStyle} /></Field></div><Field label="حالة المحضر"><select value={committeeReportForm.status} onChange={event => setCommitteeReportForm({ ...committeeReportForm, status: event.target.value })} style={inputStyle}><option value="draft">مسودة</option><option value="finalized">نهائي</option></select></Field><Field label="ملخص الاجتماع"><textarea value={committeeReportForm.summary} onChange={event => setCommitteeReportForm({ ...committeeReportForm, summary: event.target.value })} style={{ ...inputStyle, minHeight: 90 }} /></Field><ModalActions onCancel={() => { setShowCommitteeReportModal(false); setEditingCommitteeReport(null); resetCommitteeReportForm(); }} onSave={() => void saveCommitteeReport()} /></Modal>}

    {showCommitteeDecisionModal && <Modal title={editingCommitteeDecision ? "تعديل قرار اللجنة" : "إضافة قرار اللجنة"} onClose={() => { setShowCommitteeDecisionModal(false); setEditingCommitteeDecision(null); resetCommitteeDecisionForm(); }}><Field label="المنصب المرتبط"><select value={committeeDecisionForm.positionId} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, positionId: event.target.value, candidateId: "" })} style={inputStyle}><option value="">غير مرتبط بمنصب محدد</option>{criticalPositions.map(position => <option key={position.id} value={position.id}>{position.positionTitle}</option>)}</select></Field><Field label="المرشح المرتبط"><select value={committeeDecisionForm.candidateId} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, candidateId: event.target.value })} style={inputStyle}><option value="">غير مرتبط بمرشح محدد</option>{candidates.filter(candidate => !committeeDecisionForm.positionId || candidate.positionId === committeeDecisionForm.positionId).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.employeeName || candidate.employeeId} — {candidate.positionTitle}</option>)}</select></Field><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="نوع القرار"><select value={committeeDecisionForm.decisionType} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, decisionType: event.target.value })} style={inputStyle}><option value="candidate_selection">اختيار مرشح</option><option value="development_action">إجراء تطويري</option><option value="risk_mitigation">معالجة مخاطر</option><option value="other">أخرى</option></select></Field><Field label="حالة التنفيذ"><select value={committeeDecisionForm.status} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, status: event.target.value })} style={inputStyle}><option value="open">مفتوح</option><option value="in_progress">قيد التنفيذ</option><option value="completed">مكتمل</option></select></Field></div><Field label="نص القرار *"><textarea value={committeeDecisionForm.decisionText} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, decisionText: event.target.value })} style={{ ...inputStyle, minHeight: 80 }} /></Field><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="المسؤول"><input value={committeeDecisionForm.ownerName} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, ownerName: event.target.value })} style={inputStyle} /></Field><Field label="تاريخ الاستحقاق"><input type="date" value={committeeDecisionForm.dueDate} onChange={event => setCommitteeDecisionForm({ ...committeeDecisionForm, dueDate: event.target.value })} style={inputStyle} /></Field></div><ModalActions onCancel={() => { setShowCommitteeDecisionModal(false); setEditingCommitteeDecision(null); resetCommitteeDecisionForm(); }} onSave={() => void saveCommitteeDecision()} /></Modal>}

    {showSkillModal && <Modal title="إضافة مهارة" onClose={() => setShowSkillModal(false)}><Field label="اسم المهارة *"><input autoFocus value={skillForm.name} onChange={event => setSkillForm({ ...skillForm, name: event.target.value })} style={inputStyle} /></Field><Field label="التصنيف"><select value={skillForm.category} onChange={event => setSkillForm({ ...skillForm, category: event.target.value })} style={inputStyle}>{SKILL_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></Field><Field label="الوصف"><textarea value={skillForm.description} onChange={event => setSkillForm({ ...skillForm, description: event.target.value })} style={{ ...inputStyle, minHeight: 70 }} /></Field><ModalActions onCancel={() => setShowSkillModal(false)} onSave={() => void saveSkill()} /></Modal>}

    {showAssignModal && <Modal title="تعيين مهارة لموظف" onClose={() => setShowAssignModal(false)}><Field label="الموظف *"><select value={assignForm.employeeId} onChange={event => { const employee: any = employees.find((item: any) => String(item.employeeId || item.id) === event.target.value); setAssignForm({ ...assignForm, employeeId: event.target.value, employeeName: employee?.nameAr || employee?.name || "" }); }} style={inputStyle}><option value="">اختر الموظف</option>{employees.map((employee: any) => <option key={employee.employeeId || employee.id} value={String(employee.employeeId || employee.id)}>{employee.nameAr || employee.name}</option>)}</select></Field><Field label="المهارة *"><select value={assignForm.skillId} onChange={event => { const skill = skills.find(item => item.id === event.target.value); setAssignForm({ ...assignForm, skillId: event.target.value, skillName: skill?.name || "" }); }} style={inputStyle}><option value="">اختر المهارة</option>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></Field><Field label="المستوى الحالي (1–5)"><input type="number" min="1" max="5" value={assignForm.currentLevel} onChange={event => setAssignForm({ ...assignForm, currentLevel: Number(event.target.value) })} style={inputStyle} /></Field><Field label="المستوى المستهدف (1–5)"><input type="number" min="1" max="5" value={assignForm.targetLevel} onChange={event => setAssignForm({ ...assignForm, targetLevel: Number(event.target.value) })} style={inputStyle} /></Field><Field label="ملاحظات"><textarea value={assignForm.notes} onChange={event => setAssignForm({ ...assignForm, notes: event.target.value })} style={{ ...inputStyle, minHeight: 70 }} /></Field><ModalActions onCancel={() => setShowAssignModal(false)} onSave={() => void saveAssignment()} /></Modal>}
  </div>;
}

function NineBoxMatrix({ assessments, canEdit, onEdit, onDelete }: { assessments: SuccessionTalentAssessment[]; canEdit: boolean; onEdit: (assessment: SuccessionTalentAssessment) => void; onDelete: (assessment: SuccessionTalentAssessment) => void }) {
  const potentialLevels = [{ value: 1, label: "إمكانات منخفضة" }, { value: 2, label: "إمكانات متوسطة" }, { value: 3, label: "إمكانات مرتفعة" }];
  const performanceLevels = [{ value: 3, label: "أداء مرتفع" }, { value: 2, label: "أداء متوسط" }, { value: 1, label: "أداء منخفض" }];
  const cellColors: Record<string, string> = { "1-1": "rgba(148,163,184,.10)", "1-2": "rgba(59,130,246,.10)", "1-3": "rgba(16,185,129,.12)", "2-1": "rgba(245,158,11,.10)", "2-2": "rgba(245,158,11,.13)", "2-3": "rgba(16,185,129,.14)", "3-1": "rgba(239,68,68,.10)", "3-2": "rgba(245,158,11,.14)", "3-3": "rgba(16,185,129,.17)" };
  if (!assessments.length) return <EmptyState icon={FileWarning} title="لا توجد تقييمات 9-Box محفوظة" detail="لن تعرض المنصة درجات أداء أو إمكانات تقديرية. أضف تقييماً معتمداً ليظهر في المصفوفة." />;
  return <div style={{ ...cardStyle, padding: 14, overflowX: "auto" }}><div style={{ minWidth: 800, display: "grid", gridTemplateColumns: "110px repeat(3,minmax(200px,1fr))", gap: 6 }}><div style={{ padding: 10, color: "hsl(var(--muted-foreground))", fontSize: 11, fontWeight: 800 }}>الأداء \ الإمكانات</div>{potentialLevels.map(level => <div key={level.value} style={{ padding: 10, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 11, fontWeight: 800 }}>{level.label}</div>)}{performanceLevels.map(performance => <>{<div key={`label-${performance.value}`} style={{ padding: 10, display: "grid", placeItems: "center", color: "hsl(var(--muted-foreground))", fontSize: 11, fontWeight: 800, textAlign: "center" }}>{performance.label}</div>}{potentialLevels.map(potential => { const items = assessments.filter(item => item.performanceScore === performance.value && item.potentialScore === potential.value); return <div key={`${performance.value}-${potential.value}`} style={{ minHeight: 122, padding: 9, borderRadius: 10, border: "1px solid hsl(var(--foreground) / .06)", background: cellColors[`${performance.value}-${potential.value}`], display: "grid", gap: 6, alignContent: "start" }}>{items.map(item => <div key={item.id} style={{ padding: "8px 9px", borderRadius: 7, background: "hsl(var(--card) / .8)", border: "1px solid hsl(var(--foreground) / .06)" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}><span style={{ color: "hsl(var(--foreground))", fontSize: 11, fontWeight: 800 }}>{item.employeeName}</span>{canEdit && <span style={{ display: "flex", gap: 3 }}><button aria-label={`تعديل تقييم ${item.employeeName}`} onClick={() => onEdit(item)} style={{ border: 0, background: "transparent", color: "#93C5FD", cursor: "pointer", padding: 1 }}><Pencil size={12} /></button><button aria-label={`حذف تقييم ${item.employeeName}`} onClick={() => onDelete(item)} style={{ border: 0, background: "transparent", color: "#F87171", cursor: "pointer", padding: 1 }}><Trash2 size={12} /></button></span>}</div><div style={{ color: "hsl(var(--muted-foreground))", fontSize: 10, marginTop: 3 }}>{item.assessmentPeriod}{item.department ? ` — ${item.department}` : ""}</div></div>)}</div>; })}</> )}</div></div>;
}

function CommitteeReportDetail({ report, decisions, canEdit: canEditRole, onAddDecision, onEditDecision, onDeleteDecision }: { report: SuccessionCommitteeReport | null; decisions: SuccessionCommitteeDecision[]; canEdit: boolean; onAddDecision: () => void; onEditDecision: (decision: SuccessionCommitteeDecision) => void; onDeleteDecision: (decision: SuccessionCommitteeDecision) => void }) {
  if (!report) return <div style={{ ...cardStyle, minHeight: 260, padding: 24, display: "grid", placeItems: "center", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>اختر محضراً لعرض ملخص الاجتماع وقرارات اللجنة المحفوظة.</div>;
  const canEdit = canEditRole && ["draft", "rejected"].includes(report.status);
  const decisionTypeLabels: Record<SuccessionCommitteeDecision["decisionType"], string> = { candidate_selection: "اختيار مرشح", development_action: "إجراء تطويري", risk_mitigation: "معالجة مخاطر", other: "أخرى" };
  const statusLabels: Record<SuccessionCommitteeDecision["status"], string> = { open: "مفتوح", in_progress: "قيد التنفيذ", completed: "مكتمل" };
  return <div style={{ ...cardStyle, padding: 16 }}><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h3 style={{ margin: 0, color: "hsl(var(--foreground))", fontSize: 15 }}>{report.title}</h3><p style={{ margin: "6px 0 0", color: "hsl(var(--muted-foreground))", fontSize: 11 }}>{report.summary || "لا يوجد ملخص محفوظ لهذا المحضر."}</p></div>{canEdit && <button onClick={onAddDecision} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 8, border: 0, color: "#5EEAD4", background: "hsl(165 69% 39% / .14)", font: "700 11px Alexandria", cursor: "pointer" }}><Plus size={14} />إضافة قرار</button>}</div><div style={{ borderTop: "1px solid hsl(var(--foreground) / .07)", marginTop: 15, paddingTop: 14 }}><h4 style={{ color: "hsl(var(--foreground))", margin: "0 0 10px", fontSize: 12 }}>القرارات ({decisions.length})</h4>{decisions.length === 0 ? <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, margin: 0 }}>لا توجد قرارات محفوظة لهذا المحضر.</p> : <div style={{ display: "grid", gap: 8 }}>{decisions.map(decision => <article key={decision.id} style={{ padding: 11, borderRadius: 9, background: "hsl(var(--muted))", border: "1px solid hsl(var(--foreground) / .05)" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}><div><Badge label={decisionTypeLabels[decision.decisionType]} color="#C4B5FD" background="rgba(167,139,250,.14)" /><span style={{ color: "hsl(var(--foreground))", display: "block", fontSize: 12, lineHeight: 1.7, marginTop: 6 }}>{decision.decisionText}</span></div>{canEdit && <span style={{ display: "flex", gap: 3 }}><button aria-label="تعديل قرار اللجنة" onClick={() => onEditDecision(decision)} style={{ border: 0, background: "transparent", color: "#93C5FD", cursor: "pointer", padding: 2 }}><Pencil size={13} /></button><button aria-label="حذف قرار اللجنة" onClick={() => onDeleteDecision(decision)} style={{ border: 0, background: "transparent", color: "#F87171", cursor: "pointer", padding: 2 }}><Trash2 size={13} /></button></span>}</div><div style={{ color: "hsl(var(--muted-foreground))", fontSize: 10, marginTop: 7 }}>{statusLabels[decision.status]}{decision.ownerName ? ` — المسؤول: ${decision.ownerName}` : ""}{decision.dueDate ? ` — الاستحقاق: ${new Date(decision.dueDate).toLocaleDateString("ar-SA")}` : ""}</div></article>)}</div>}</div></div>;
}

function CommitteeWorkflowActions({ report, canEdit, canReview, onTransition }: { report: SuccessionCommitteeReport | null; canEdit: boolean; canReview: boolean; onTransition: (reportId: string, action: "submit" | "approved" | "rejected") => void }) {
  if (!report) return null;
  const statusConfig: Record<SuccessionCommitteeReport["status"], { label: string; color: string; background: string }> = {
    draft: { label: "مسودة", color: "#FCD34D", background: "rgba(245,158,11,.14)" },
    submitted: { label: "بانتظار المراجعة", color: "#93C5FD", background: "rgba(59,130,246,.14)" },
    approved: { label: "معتمد", color: "#5EEAD4", background: "hsl(165 69% 39% / .14)" },
    rejected: { label: "معاد للمراجعة", color: "#FCA5A5", background: "rgba(239,68,68,.14)" },
    finalized: { label: "نهائي (سجل سابق)", color: "#5EEAD4", background: "hsl(165 69% 39% / .14)" },
  };
  const config = statusConfig[report.status];
  return <div style={{ ...cardStyle, marginTop: 13, padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginBottom: 5 }}>حالة اعتماد المحضر المحدد</div><Badge label={config.label} color={config.color} background={config.background} />{report.reviewNote && <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 10, marginRight: 8 }}>ملاحظة المراجع: {report.reviewNote}</span>}</div><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{canEdit && (report.status === "draft" || report.status === "rejected") && <button onClick={() => onTransition(report.id, "submit")} style={{ padding: "8px 11px", borderRadius: 8, border: 0, color: "#D1FAE5", background: "hsl(165 69% 39% / .20)", font: "700 11px Alexandria", cursor: "pointer" }}>إرسال للمراجعة</button>}{canReview && report.status === "submitted" && <><button onClick={() => onTransition(report.id, "approved")} style={{ padding: "8px 11px", borderRadius: 8, border: 0, color: "#D1FAE5", background: "hsl(165 69% 39% / .20)", font: "700 11px Alexandria", cursor: "pointer" }}>اعتماد</button><button onClick={() => onTransition(report.id, "rejected")} style={{ padding: "8px 11px", borderRadius: 8, border: 0, color: "#FECACA", background: "rgba(239,68,68,.16)", font: "700 11px Alexandria", cursor: "pointer" }}>إعادة للمراجعة</button></>}</div></div>;
}

function PositionProfile({ position, candidates, plans, onClose }: { position: CriticalPosition; candidates: SuccessionCandidate[]; plans: SuccessionDevelopmentPlan[]; onClose: () => void }) {
  const risk = badgeForRisk(position.riskLevel);
  return <Modal title={`ملف المنصب: ${position.positionTitle}`} onClose={onClose}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}><Badge label={risk.label} color={risk.color} background={risk.background} /><Badge label={`${candidates.length} مرشح`} color="#5EEAD4" background="hsl(165 69% 39% / .14)" /><Badge label={`${plans.length} خطة تطوير`} color="#C4B5FD" background="rgba(167,139,250,.14)" /></div>
    <div style={{ ...cardStyle, padding: 14, marginBottom: 14, fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.85 }}><div><strong style={{ color: "hsl(var(--foreground))" }}>الإدارة:</strong> {position.department || "غير محددة"}</div><div><strong style={{ color: "hsl(var(--foreground))" }}>الشاغل الحالي:</strong> {position.currentHolderName || "غير محدد"}</div>{position.notes && <div><strong style={{ color: "hsl(var(--foreground))" }}>ملاحظات السجل:</strong> {position.notes}</div>}</div>
    <h4 style={{ color: "hsl(var(--foreground))", margin: "0 0 10px", fontSize: 13 }}>مرشحو التعاقب وخططهم المحفوظة</h4>
    {candidates.length === 0 ? <div style={{ ...cardStyle, padding: 16, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>لا توجد سجلات مرشحين محفوظة لهذا المنصب.</div> : <div style={{ display: "grid", gap: 9 }}>{candidates.map(candidate => { const readiness = badgeForReadiness(candidate.readiness); const candidatePlans = plans.filter(plan => plan.candidateId === candidate.id); return <div key={candidate.id} style={{ ...cardStyle, padding: 13 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><div><div style={{ color: "hsl(var(--foreground))", fontSize: 13, fontWeight: 800 }}>{candidate.employeeName || candidate.employeeId}</div><div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginTop: 3 }}>{candidatePlans.length ? `${candidatePlans.length} خطة تطوير محفوظة` : "لا توجد خطة تطوير محفوظة"}</div></div><Badge label={readiness.label} color={readiness.color} background={readiness.background} /></div>{candidatePlans.length > 0 && <div style={{ marginTop: 10, display: "grid", gap: 6 }}>{candidatePlans.map(plan => <div key={plan.id} style={{ padding: "8px 10px", borderRadius: 8, background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", fontSize: 11 }}><strong style={{ color: "#5EEAD4" }}>{plan.activity}</strong> <span>— {labelForPlanStatus(plan.status)} ({plan.completion}%)</span></div>)}</div>}</div>; })}</div>}
  </Modal>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block", marginBottom: 13 }}><span style={labelStyle}>{label}</span>{children}</label>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div role="presentation" onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 18, background: "rgba(0,0,0,.68)", direction: "rtl" }}><div role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()} style={{ width: "min(520px,100%)", maxHeight: "88vh", overflowY: "auto", padding: 22, borderRadius: 16, background: "hsl(var(--card))", border: "1px solid hsl(165 69% 39% / .24)", fontFamily: "Alexandria" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}><h3 style={{ color: "hsl(var(--foreground))", margin: 0, fontSize: 16 }}>{title}</h3><button aria-label="إغلاق" onClick={onClose} style={{ border: "none", background: "transparent", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><X size={19} /></button></div>{children}</div></div>;
}

function ModalActions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return <div style={{ display: "flex", gap: 9, marginTop: 18 }}><button onClick={onSave} style={{ padding: "10px 19px", borderRadius: 9, border: "none", color: "hsl(var(--primary-foreground))", background: peoplePrimary, cursor: "pointer", font: "700 12px Alexandria" }}>حفظ السجل</button><button onClick={onCancel} style={{ padding: "10px 19px", borderRadius: 9, border: "none", color: mutedText, background: "hsl(var(--muted))", cursor: "pointer", font: "700 12px Alexandria" }}>إلغاء</button></div>;
}
