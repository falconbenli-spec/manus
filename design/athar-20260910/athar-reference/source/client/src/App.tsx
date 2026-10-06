import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { EmployeeProvider } from "./contexts/EmployeeContext";
import MainLayout from "./components/layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import CoreHRM from "./pages/CoreHRM";
import Recruitment from "./pages/Recruitment";
import Onboarding from "./pages/Onboarding";
import Attendance from "./pages/Attendance";
import Leave from "./pages/Leave";
import ManagerLeaveCalendar from "./pages/ManagerLeaveCalendar";
import Payroll from "./pages/Payroll";
import Performance from "./pages/Performance";
import Learning from "./pages/Learning";
import CareerPlanning from "./pages/CareerPlanning";
import Engagement from "./pages/Engagement";
import Analytics from "./pages/Analytics";
import Compliance from "./pages/Compliance";
import AdminSettings from "./pages/AdminSettings";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import { lazy, Suspense, useEffect } from "react";
import { useIdleLogout } from "./hooks/useIdleLogout";
import { ActivityLogProvider } from "./contexts/ActivityLogContext";
import ActivityLog from "./pages/ActivityLog";
import ZohoIntegration from "./pages/ZohoIntegration";
import WeeklyReport from "./pages/WeeklyReport";
import EmployeePortal from "./pages/EmployeePortal";
import EmployeePasswords from "./pages/EmployeePasswords";
import HRApprovals from "./pages/HRApprovals";
import OrgChart from "./pages/OrgChart";
import EmployeePortalLogin from "./pages/EmployeePortalLogin";
import WorkRequests from "./pages/WorkRequests";
import ProjectsClients from "./pages/ProjectsClients";
import PerformanceEval from "./pages/PerformanceEval";
import SelfService from "./pages/SelfService";
import Expenses from "./pages/Expenses";
import Surveys from "./pages/Surveys";
import Documents from "./pages/Documents";
import SkillsMatrix from "./pages/SkillsMatrix";
import AIAssistant from "./pages/AIAssistant";
import Recognition from "./pages/Recognition";
import Notifications from "./pages/Notifications";
import WellnessProgram from "./pages/WellnessProgram";
import KnowledgeBase from "./pages/KnowledgeBase";
import OKRsDashboard from "./pages/OKRsDashboard";
import Gamification from "./pages/Gamification";
import WorkflowEngine from "./pages/WorkflowEngine";
import RecruitmentPipeline from "./pages/RecruitmentPipeline";
import OnboardingJourney from "./pages/OnboardingJourney";
import AdvancedAnalytics from "./pages/AdvancedAnalytics";
import EngagementHub from "./pages/EngagementHub";
import LearningHub from "./pages/LearningHub";
import PrivacyConsent from "./pages/PrivacyConsent";
import MyTasks from "./pages/MyTasks";
import TaskReports from "./pages/TaskReports";
import GovernmentIntegration from "./pages/GovernmentIntegration";
import EmailManagement from "./pages/EmailManagement";
import AnnouncementsManagement from "./pages/AnnouncementsManagement";
import { LoadingState } from "./components/feedback/AsyncState";

const ReportsCenter = lazy(() => import("./pages/ReportsCenter"));
const DepartmentReports = lazy(() => import("./pages/DepartmentReports"));

function ProtectedRouter() {
  const { user, logout, loading } = useAuth();
  const [location, setLocation] = useLocation();

  // Auto-logout after 30 minutes of inactivity (admin sessions only)
  const { showWarning, dismissWarning } = useIdleLogout({
    onLogout: () => {
      logout();
      setLocation("/login");
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (loading) return;
    // Don't redirect employee portal — it has its own independent auth
    if (!user && location !== "/login" && !location.startsWith("/employee-portal") && location !== "/employee-portal/login") {
      setLocation("/login");
    }
    if (user && location === "/login") {
      setLocation("/");
    }
  }, [user, loading, location, setLocation]);

  // Allow employee portal login page without admin session
  if (loading) {
    return <div className="min-h-screen" style={{ background: "hsl(var(--background))" }} />;
  }

  if (!user && location === "/employee-portal/login") {
    return <EmployeePortalLogin />;
  }

  // Allow the portal itself to restore its own emp_session without an admin session.
  if (!user && location === "/employee-portal") {
    return <EmployeePortal />;
  }

  if (!user) {
    return <Login />;
  }
  // Employee portal login renders without sidebar (standalone page)
  if (location === "/employee-portal/login") {
    return <EmployeePortalLogin />;
  }

  return (
    <EmployeeProvider>
      {showWarning && (
          <div
            style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "hsl(var(--foreground) / .50)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "16px",
            }}
          >
            <div
              style={{
              background: "hsl(var(--card))", border: "1px solid hsl(var(--primary) / .42)", borderRadius: 16,
              padding: "32px", width: "100%", maxWidth: 400, boxSizing: "border-box", textAlign: "center", color: "hsl(var(--foreground))",
              fontFamily: "Alexandria, system-ui, sans-serif",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ color: "hsl(var(--primary))", marginBottom: 8, fontSize: 18, fontWeight: 700 }}>تنبيه: انتهاء الجلسة</h3>
            <p style={{ marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
              ستنتهي جلستك خلال دقيقتين بسبب عدم النشاط. هل تريد الاستمرار؟
            </p>
            <button
              onClick={dismissWarning}
              style={{
                background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", border: "none",
                borderRadius: 12, minHeight: 44, padding: "10px 28px", cursor: "pointer",
                fontSize: 15, fontWeight: 700, fontFamily: "Alexandria, system-ui, sans-serif",
              }}
            >
              نعم، استمر
            </button>
          </div>
        </div>
      )}
      <MainLayout>
        <Suspense fallback={<LoadingState title="جارٍ تحميل الوحدة" message="ننتقل إلى الشاشة المطلوبة دون تغيير بياناتك." className="my-6" />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/core-hrm" component={CoreHRM} />
          <Route path="/recruitment" component={Recruitment} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/attendance" component={Attendance} />
          <Route path="/leave" component={Leave} />
          <Route path="/manager-leave-calendar" component={ManagerLeaveCalendar} />
          <Route path="/payroll" component={Payroll} />
          <Route path="/performance" component={Performance} />
          <Route path="/learning" component={Learning} />
          <Route path="/career" component={CareerPlanning} />
          <Route path="/engagement" component={Engagement} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/compliance" component={Compliance} />
          <Route path="/settings" component={AdminSettings} />
          <Route path="/activity-log" component={ActivityLog} />
          <Route path="/zoho-integration" component={ZohoIntegration} />
          <Route path="/weekly-report" component={WeeklyReport} />
          <Route path="/employee-portal" component={EmployeePortal} />
          <Route path="/employee-passwords" component={EmployeePasswords} />
          <Route path="/hr-approvals" component={HRApprovals} />
          <Route path="/org-chart" component={OrgChart} />
          <Route path="/work-requests" component={WorkRequests} />
          <Route path="/projects" component={ProjectsClients} />
          <Route path="/performance-eval" component={PerformanceEval} />
          <Route path="/self-service" component={SelfService} />
          <Route path="/expenses" component={Expenses} />
          <Route path="/surveys" component={Surveys} />
          <Route path="/documents" component={Documents} />
          <Route path="/skills-matrix" component={SkillsMatrix} />
          <Route path="/ai-assistant" component={AIAssistant} />
          <Route path="/recognition" component={Recognition} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/wellness" component={WellnessProgram} />
          <Route path="/knowledge-base" component={KnowledgeBase} />
          <Route path="/okrs" component={OKRsDashboard} />
          <Route path="/gamification" component={Gamification} />
          <Route path="/workflow" component={WorkflowEngine} />
          <Route path="/recruitment-pipeline" component={RecruitmentPipeline} />
          <Route path="/onboarding-journey" component={OnboardingJourney} />
          <Route path="/advanced-analytics" component={AdvancedAnalytics} />
          <Route path="/engagement-hub" component={EngagementHub} />
          <Route path="/learning-hub" component={LearningHub} />
          <Route path="/privacy" component={PrivacyConsent} />
          <Route path="/my-tasks" component={MyTasks} />
          <Route path="/task-reports" component={TaskReports} />
          <Route path="/reports-center" component={ReportsCenter} />
          <Route path="/department-reports" component={DepartmentReports} />
          <Route path="/government" component={GovernmentIntegration} />
          <Route path="/email-management" component={EmailManagement} />
          <Route path="/announcements" component={AnnouncementsManagement} />
          <Route component={NotFound} />
        </Switch>
        </Suspense>
      </MainLayout>
    </EmployeeProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <AuthProvider>
          <ActivityLogProvider>
          <TooltipProvider>
            <Toaster />
            <ProtectedRouter />
          </TooltipProvider>
          </ActivityLogProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
