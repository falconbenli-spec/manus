import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(root, "client", "src", "index.css"), "utf8");
const authShell = fs.readFileSync(path.join(root, "client/src/components/brand/AuthShell.tsx"), "utf8");
const authStyles = fs.readFileSync(path.join(root, "client/public/brand/people-design.css"), "utf8");
const themeContext = fs.readFileSync(path.join(root, "client", "src", "contexts", "ThemeContext.tsx"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
const layout = fs.readFileSync(path.join(root, "client", "src", "components", "layout", "MainLayout.tsx"), "utf8");
const portal = fs.readFileSync(path.join(root, "client", "src", "pages", "EmployeePortal.tsx"), "utf8");
const login = fs.readFileSync(path.join(root, "client", "src", "pages", "Login.tsx"), "utf8");
const activityLog = fs.readFileSync(path.join(root, "client", "src", "pages", "ActivityLog.tsx"), "utf8");
const hrApprovals = fs.readFileSync(path.join(root, "client", "src", "pages", "HRApprovals.tsx"), "utf8");
const announcements = fs.readFileSync(path.join(root, "client", "src", "pages", "AnnouncementsManagement.tsx"), "utf8");
const surveys = fs.readFileSync(path.join(root, "client", "src", "pages", "Surveys.tsx"), "utf8");
const notifications = fs.readFileSync(path.join(root, "client", "src", "pages", "Notifications.tsx"), "utf8");
const compliance = fs.readFileSync(path.join(root, "client", "src", "pages", "Compliance.tsx"), "utf8");
const governmentIntegration = fs.readFileSync(path.join(root, "client", "src", "pages", "GovernmentIntegration.tsx"), "utf8");
const geometricPattern = fs.readFileSync(path.join(root, "client", "src", "components", "GeometricPattern.tsx"), "utf8");
const brandPattern = fs.readFileSync(path.join(root, "client", "src", "components", "BrandPattern.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "client", "src", "App.tsx"), "utf8");
const adminSettings = fs.readFileSync(path.join(root, "client", "src", "pages", "AdminSettings.tsx"), "utf8");
const advancedAnalytics = fs.readFileSync(path.join(root, "client", "src", "pages", "AdvancedAnalytics.tsx"), "utf8");
const analytics = fs.readFileSync(path.join(root, "client", "src", "pages", "Analytics.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "client", "src", "pages", "Dashboard.tsx"), "utf8");
const departmentReports = fs.readFileSync(path.join(root, "client", "src", "pages", "DepartmentReports.tsx"), "utf8");
const documents = fs.readFileSync(path.join(root, "client", "src", "pages", "Documents.tsx"), "utf8");
const careerPlanning = fs.readFileSync(path.join(root, "client", "src", "pages", "CareerPlanning.tsx"), "utf8");
const employeePasswords = fs.readFileSync(path.join(root, "client", "src", "pages", "EmployeePasswords.tsx"), "utf8");
const coreHrm = fs.readFileSync(path.join(root, "client", "src", "pages", "CoreHRM.tsx"), "utf8");
const attendance = fs.readFileSync(path.join(root, "client", "src", "pages", "Attendance.tsx"), "utf8");
const leave = fs.readFileSync(path.join(root, "client", "src", "pages", "Leave.tsx"), "utf8");
const payroll = fs.readFileSync(path.join(root, "client", "src", "pages", "Payroll.tsx"), "utf8");
const workRequests = fs.readFileSync(path.join(root, "client", "src", "pages", "WorkRequests.tsx"), "utf8");
const performance = fs.readFileSync(path.join(root, "client", "src", "pages", "Performance.tsx"), "utf8");
const projectsClients = fs.readFileSync(path.join(root, "client", "src", "pages", "ProjectsClients.tsx"), "utf8");
const recruitment = fs.readFileSync(path.join(root, "client", "src", "pages", "Recruitment.tsx"), "utf8");
const expenses = fs.readFileSync(path.join(root, "client", "src", "pages", "Expenses.tsx"), "utf8");
const learning = fs.readFileSync(path.join(root, "client", "src", "pages", "Learning.tsx"), "utf8");
const knowledgeBase = fs.readFileSync(path.join(root, "client", "src", "pages", "KnowledgeBase.tsx"), "utf8");
const orgChart = fs.readFileSync(path.join(root, "client", "src", "pages", "OrgChart.tsx"), "utf8");
const engagement = fs.readFileSync(path.join(root, "client", "src", "pages", "Engagement.tsx"), "utf8");
const taskReports = fs.readFileSync(path.join(root, "client", "src", "pages", "TaskReports.tsx"), "utf8");
const myTasks = fs.readFileSync(path.join(root, "client", "src", "pages", "MyTasks.tsx"), "utf8");
const selfService = fs.readFileSync(path.join(root, "client", "src", "pages", "SelfService.tsx"), "utf8");
const aiAssistant = fs.readFileSync(path.join(root, "client", "src", "pages", "AIAssistant.tsx"), "utf8");
const onboarding = fs.readFileSync(path.join(root, "client", "src", "pages", "Onboarding.tsx"), "utf8");
const workflow = fs.readFileSync(path.join(root, "client", "src", "pages", "WorkflowEngine.tsx"), "utf8");
const employeePortal = fs.readFileSync(path.join(root, "client", "src", "pages", "EmployeePortal.tsx"), "utf8");
const employeePortalLogin = fs.readFileSync(path.join(root, "client", "src", "pages", "EmployeePortalLogin.tsx"), "utf8");
const privacyConsent = fs.readFileSync(path.join(root, "client", "src", "pages", "PrivacyConsent.tsx"), "utf8");
const wellnessProgram = fs.readFileSync(path.join(root, "client", "src", "pages", "WellnessProgram.tsx"), "utf8");
const managerLeaveCalendar = fs.readFileSync(path.join(root, "client", "src", "pages", "ManagerLeaveCalendar.tsx"), "utf8");
const okrsDashboard = fs.readFileSync(path.join(root, "client", "src", "pages", "OKRsDashboard.tsx"), "utf8");
const gamification = fs.readFileSync(path.join(root, "client", "src", "pages", "Gamification.tsx"), "utf8");
const skillsMatrix = fs.readFileSync(path.join(root, "client", "src", "pages", "SkillsMatrix.tsx"), "utf8");
const recognition = fs.readFileSync(path.join(root, "client", "src", "pages", "Recognition.tsx"), "utf8");
const activityLogContext = fs.readFileSync(path.join(root, "client", "src", "contexts", "ActivityLogContext.tsx"), "utf8");

function clientSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return clientSourceFiles(entryPath);
    return /\.(css|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("People36t identity contract", () => {
  it("keeps the handoff light and dark palette in reusable theme tokens", () => {
    expect(css).toContain("--primary: 168 79% 24%;");
    expect(css).toContain("--background: 150 18% 97%;");
    expect(css).toContain("--secondary: 200 20% 95%;");
    expect(css).toContain("--background: 168 9% 9%;");
    expect(css).toContain("--primary: 168 64% 44%;");
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("keeps active client sources free of gradients and glass effects", () => {
    for (const file of clientSourceFiles(path.join(root, "client", "src"))) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, file).not.toContain("linear-gradient");
      expect(source, file).not.toContain("radial-gradient");
      expect(source, file).not.toContain("backdrop-filter");
      expect(source, file).not.toContain("backdrop-blur");
    }
  });

  it("preserves the People36t preference key and typography", () => {
    expect(themeContext).toContain('localStorage.getItem("people36t-theme")');
    expect(themeContext).toContain('localStorage.setItem("people36t-theme", theme)');
    expect(indexHtml).toContain("سلسلة خطوط نظام محلية");
    expect(indexHtml).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(css).toContain('font-family: "Alexandria", Tahoma, Arial, system-ui, sans-serif');
    expect(indexHtml).toContain('content="#16A085"');
  });

  it("applies the identity to employee entry and accessible app chrome", () => {
    expect(portal).toContain('className="portal-shell page-shell mx-auto max-w-5xl');
    expect(portal).toContain("background: 'hsl(var(--primary))'");
    expect(layout).toContain("sidebarOpen || !desktop ? 'w-[254px]' : 'w-20'");
    expect(layout).toContain("width: '44px', height: '44px'");
    expect(css).toContain("#root { width: 100%; min-height: 100vh; overflow-x: clip; }");
    expect(login).toContain('<AuthShell mode="admin">');
    expect(authShell).toContain('<BrandMark height={32} />');
    expect(authShell).toContain('new Date().getFullYear()');
    expect(indexHtml).toContain('href="/brand/people-design.css"');
  });

  it("keeps the employee-portal sign-in screen inside the People36t token system", () => {
    expect(employeePortalLogin).toContain('<AuthShell mode="employee">');
    expect(authStyles).toContain('--people-paper:');
    expect(authStyles).toMatch(/\.dark,\s*body\.dark-mode/);
    expect(authStyles).toMatch(/background:\s*var\(--people-field\)/);
    expect(authStyles).toMatch(/border:\s*1px solid var\(--people-line\)/);
    for (const asset of ['athar-motion.js', 'fonts/alexandria-arabic-400-normal.woff2', 'fonts/alexandria-arabic-700-normal.woff2']) {
      expect(fs.existsSync(path.join(root, 'client/public/brand', asset))).toBe(true);
    }
    expect(employeePortalLogin).not.toContain("#1FA98C");
    expect(employeePortalLogin).not.toContain("linear-gradient");
  });

  it("uses People36t tokens for privacy consent and data-subject rights actions", () => {
    expect(privacyConsent).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(privacyConsent).toContain('const cardSurface = "hsl(var(--card))"');
    expect(privacyConsent).toContain('background: peoplePrimary');
    expect(privacyConsent).not.toContain("#1FA98C");
    expect(privacyConsent).not.toContain("linear-gradient");
  });

  it("uses People36t tokens for wellness status, tabs, and recommendations", () => {
    expect(wellnessProgram).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(wellnessProgram).toContain('const cardSurface = "hsl(var(--card))"');
    expect(wellnessProgram).toContain('background: peoplePrimarySoft');
    expect(wellnessProgram).not.toContain("#1FA98C");
    expect(wellnessProgram).not.toContain("linear-gradient");
  });

  it("uses People36t tokens for the manager leave calendar controls and approved status", () => {
    expect(managerLeaveCalendar).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(managerLeaveCalendar).toContain('const cardSurface = "hsl(var(--card))"');
    expect(managerLeaveCalendar).toContain('background: showFilters ? peoplePrimarySoft');
    expect(managerLeaveCalendar).not.toContain("#1FA98C");
    expect(managerLeaveCalendar).not.toContain("linear-gradient");
  });

  it("uses People36t tokens for objective status and key-result indicators", () => {
    expect(okrsDashboard).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(okrsDashboard).toContain('const peoplePrimarySoft = "hsl(var(--primary) / 0.12)"');
    expect(okrsDashboard).toContain('color: peoplePrimary');
    expect(okrsDashboard).not.toContain("#1FA98C");
    expect(okrsDashboard).not.toContain("linear-gradient");
  });

  it("uses People36t tokens for achievement tabs, scores, and challenge indicators", () => {
    expect(gamification).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(gamification).toContain('const peoplePrimarySoft = "hsl(var(--primary) / 0.12)"');
    expect(gamification).toContain('background: a ? peoplePrimary');
    expect(gamification).not.toContain("#1FA98C");
    expect(gamification).not.toContain("linear-gradient");
  });

  it("uses People36t tokens for skills, succession, and development-plan controls", () => {
    expect(skillsMatrix).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(skillsMatrix).toContain('const cardSurface = "hsl(var(--card))"');
    expect(skillsMatrix).toContain('background: peoplePrimary');
    expect(skillsMatrix).not.toContain("#1FA98C");
    expect(skillsMatrix).not.toContain("linear-gradient");
  });

  it("does not invent local recognition messages, reactions, or senders", () => {
    expect(recognition).toContain("const allRecognitions: Recognition[] = []");
    expect(recognition).toContain("لم يتم إنشاء أي سجل");
    expect(recognition).not.toContain("id: `demo-");
    expect(recognition).not.toContain("reactions: [{ emoji:");
    expect(recognition).not.toContain("fromName: 'تركي الخضر'");
  });

  it("does not persist or locally analyze mood and sentiment entries", () => {
    expect(aiAssistant).not.toContain('localStorage.getItem("hr-sentiment-history")');
    expect(aiAssistant).not.toContain('localStorage.setItem("hr-sentiment-history"');
    expect(wellnessProgram).not.toContain('localStorage.getItem("wellness-mood-history")');
    expect(wellnessProgram).not.toContain('localStorage.setItem("wellness-mood-history"');
    expect(aiAssistant).toContain("لا توجد محادثة أو تحليل مشاعر أو سجل محلي");
    expect(aiAssistant).not.toContain("sentimentHistory");
  });

  it("does not retain employee-facing chat, audit, or report-recipient data in local storage", () => {
    expect(aiAssistant).not.toContain("hr-assistant-chat");
    expect(activityLogContext).not.toContain("localStorage");
    expect(departmentReports).not.toContain("department-report-emails");
  });

  it("does not render locally generated knowledge articles or wellness challenges", () => {
    expect(knowledgeBase).not.toContain("DEMO_ARTICLES");
    expect(knowledgeBase).toContain("لا توجد مقالات منشورة حالياً");
    expect(wellnessProgram).not.toContain("DEMO_CHALLENGES");
    expect(wellnessProgram).toContain("برنامج الرفاهية غير متصل بسجل خادمي");
    expect(wellnessProgram).not.toContain("setChallenges(prev => [...prev");
  });

  it("uses People36t tokens for knowledge-base surfaces, tabs, and pinned articles", () => {
    expect(knowledgeBase).toContain('const peoplePrimarySoft = "hsl(var(--primary) / 0.15)"');
    expect(knowledgeBase).toContain('const cardSurface = "hsl(var(--card))"');
    expect(knowledgeBase).toContain("background: !selectedCategory ? peoplePrimarySoft : mutedSurface");
    expect(knowledgeBase).not.toContain("#1FA98C");
    expect(knowledgeBase).not.toContain("hsl(165 69% 39%");
  });

  it("derives decorative brand patterns from the active People36t theme token", () => {
    expect(geometricPattern).toContain('fill="hsl(var(--primary))"');
    expect(brandPattern).toContain("color = 'hsl(var(--primary))'");
  });

  it("keeps the administrative session warning inside the People36t token system", () => {
    expect(app).toContain('background: "hsl(var(--card))"');
    expect(app).toContain('border: "1px solid hsl(var(--primary) / .42)"');
    expect(app).toContain('minHeight: 44');
    expect(app).toContain('color: "hsl(var(--primary-foreground))"');
  });

  it("uses the People36t theme token for the core administrative settings accent", () => {
    expect(adminSettings).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(adminSettings).toContain("const peoplePrimarySoft = \"hsl(var(--primary) / .15)\"");
    expect(adminSettings).not.toContain("#1FA98C");
  });

  it("does not render or create system users from local-only state", () => {
    expect(adminSettings).toContain("const [users, setUsers] = useState<SystemUser[]>([])");
    expect(adminSettings).not.toContain('id: "admin-001"');
    expect(adminSettings).not.toContain("onAdd={addUser}");
    expect(adminSettings).toContain("لم يتم إنشاء أي مستخدم محلي");
  });

  it("keeps advanced analytics free of legacy gradients and tied to People36t tokens", () => {
    expect(advancedAnalytics).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(advancedAnalytics).not.toContain("linear-gradient");
    expect(advancedAnalytics).not.toContain("#1FA98C");
    expect(advancedAnalytics).not.toContain("hsl(165 69% 39%");
  });

  it("uses People36t tokens for basic analytics charts and tabs", () => {
    expect(analytics).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(analytics).toContain('background: mainTab === tab.key ? peoplePrimary');
    expect(analytics).not.toContain("#1FA98C");
  });

  it("keeps the administrative dashboard free of legacy gradients and tied to People36t tokens", () => {
    expect(dashboard).toContain('const TEAL = "hsl(var(--primary))"');
    expect(dashboard).toContain('const TEAL_LIGHT = "hsl(var(--accent))"');
    expect(dashboard).not.toContain("linear-gradient");
    expect(dashboard).not.toContain("linearGradient");
    expect(dashboard).not.toContain("#1FA98C");
  });

  it("uses People36t tokens for policy documents and acknowledgement actions", () => {
    expect(documents).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(documents).toContain('background: "hsl(var(--background))"');
    expect(documents).not.toContain("#1FA98C");
  });

  it("uses People36t tokens for department-report progress and exports", () => {
    expect(departmentReports).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(departmentReports).toContain('background: "hsl(var(--card))"');
    expect(departmentReports).not.toContain("linear-gradient");
    expect(departmentReports).not.toContain("#1FA98C");
  });

  it("uses People36t tokens for employee-password indicators and actions", () => {
    expect(employeePasswords).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(employeePasswords).toContain("background: peoplePrimary");
    expect(employeePasswords).not.toContain("linear-gradient");
    expect(employeePasswords).not.toContain("#1FA98C");
  });

  it("uses People36t tokens for career planning readiness and save actions", () => {
    expect(careerPlanning).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(careerPlanning).toContain('const cardSurface = "hsl(var(--card))"');
    expect(careerPlanning).toContain('const mutedSurface = "hsl(var(--muted))"');
    expect(careerPlanning).toContain('background: peoplePrimary');
    expect(careerPlanning).not.toContain("linear-gradient");
    expect(careerPlanning).not.toContain("#1FA98C");
  });

  it("keeps core employee management tied to People36t theme tokens", () => {
    expect(coreHrm).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(coreHrm).not.toContain("#1FA98C");
    expect(coreHrm).not.toContain("#16A085");
    expect(coreHrm).not.toContain("hsl(165 69% 39%");
  });

  it("uses People36t tokens for core attendance indicators without gradients", () => {
    expect(attendance).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(attendance).toContain('const TEAL = peoplePrimary');
    expect(attendance).not.toContain('linear-gradient(90deg, #1FA98C, #1abc9c)');
  });

  it("uses People36t tokens for core leave-management actions", () => {
    expect(leave).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(leave).toContain('background: peoplePrimary');
    expect(leave).toContain('"معتمدة":       { color: peoplePrimary');
  });

  it("uses People36t tokens for core payroll actions", () => {
    expect(payroll).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(payroll).toContain('"مدفوع": { color: peoplePrimary');
    expect(payroll).toContain('color: peoplePrimary, margin: 0, fontSize: 16');
  });

  it("uses People36t tokens for core work-request indicators", () => {
    expect(workRequests).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(workRequests).toContain('className="metric-strip__item"');
    expect(authStyles).toMatch(/color:\s*var\(--people-ink\)/);
    expect(workRequests).toContain('background: peoplePrimary, borderRadius: 999');
  });

  it("uses People36t tokens for core performance indicators", () => {
    expect(performance).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(performance).toContain('"ممتاز":       { color: peoplePrimary');
    expect(performance).toContain('background:activeTab===tab?peoplePrimary');
  });

  it("uses People36t tokens for core projects and clients indicators", () => {
    expect(projectsClients).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(projectsClients).toContain('color: peoplePrimary, margin: 0');
    expect(projectsClients).toContain('color: tab === t ? peoplePrimary');
  });

  it("uses People36t tokens for core recruitment indicators", () => {
    expect(recruitment).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(recruitment).toContain('"مقبول": peoplePrimary');
    expect(recruitment).toContain('background: activeTab === tab.key ? peoplePrimary');
  });

  it("uses People36t tokens for core expenses and custody indicators", () => {
    expect(expenses).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(expenses).toContain('color: tab === t ? peoplePrimary');
    expect(expenses).toContain('color: peoplePrimary }}>{e.category}');
  });

  it("uses People36t tokens for core learning indicators", () => {
    expect(learning).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(learning).toContain('color: peoplePrimary }}>{course');
    expect(learning).toContain('background: activeTab === tab.key ? peoplePrimary');
  });

  it("uses People36t tokens for core knowledge-base indicators", () => {
    expect(knowledgeBase).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(knowledgeBase).toContain('color: peoplePrimary }}');
    expect(knowledgeBase).toContain('color: !selectedCategory ? peoplePrimary');
  });

  it("uses People36t tokens for core organizational-chart indicators", () => {
    expect(orgChart).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(orgChart).toContain('if (level >= 7) return peoplePrimary');
    expect(orgChart).toContain('color: peoplePrimary }}');
  });

  it("uses People36t tokens for core engagement indicators", () => {
    expect(engagement).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(engagement).toContain('B: { label: "فعالية متوسطة", color: peoplePrimary');
    expect(engagement).toContain('color: peoplePrimary, fontSize: \'12px\'');
  });

  it("uses People36t tokens for core reporting indicators", () => {
    expect(taskReports).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(taskReports).toContain('style={{ background: peoplePrimary, color: "#fff" }}');
    expect(taskReports).toContain('background: peoplePrimary, color: "white"');
  });

  it("uses People36t tokens for core task-management indicators", () => {
    expect(myTasks).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(myTasks).toContain('color: peoplePrimary, tab: "tasks"');
    expect(myTasks).toContain('TrendingUp size={16} style={{ color: peoplePrimary }}');
  });

  it("uses People36t tokens for employee self-service indicators", () => {
    expect(selfService).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(selfService).toContain('color: peoplePrimary, margin: 0');
    expect(selfService).toContain('color: tab === t ? peoplePrimary');
  });

  it("uses People36t tokens for the disabled assistant privacy state without gradients", () => {
    expect(aiAssistant).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(aiAssistant).toContain('background: "hsl(var(--card))"');
    expect(aiAssistant).not.toContain('linear-gradient(135deg, #1FA98C');
  });

  it("uses People36t tokens for onboarding actions and progress", () => {
    expect(onboarding).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(onboarding).toContain('"مستندات": peoplePrimary');
    expect(onboarding).toContain('background: mainTab === tab.key ? peoplePrimary');
  });

  it("uses People36t tokens for workflow approvals and tickets", () => {
    expect(workflow).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(workflow).toContain('background: activeTab === "requests" ? peoplePrimary');
    expect(workflow).toContain('background: peoplePrimary }} onClick={() => onApprove');
  });

  it("uses People36t tokens for embedded employee benefits and portal summary", () => {
    expect(employeePortal).toContain('label: "الراتب الصافي"');
    expect(employeePortal).toContain('label: "حالة الحضور"');
    expect(employeePortal).toContain('<Heart size={16} style={{ color: "hsl(var(--primary))" }} /> مزاياي');
    expect(employeePortal).toContain('borderColor: "hsl(var(--primary))"');
  });

  it("uses People36t tokens for login labels and active fields", () => {
    expect(login).toContain('htmlFor="admin-email"');
    expect(login).toContain('id="admin-email"');
    expect(authStyles).toMatch(/\.people-field label\s*\{/);
    expect(authStyles).toMatch(/color:\s*var\(--people-ink\)/);
    expect(authStyles).toMatch(/\.people-field input:focus\s*\{/);
    expect(authStyles).toMatch(/border-color:\s*var\(--people-accent\)/);
  });

  it("uses People36t tokens for activity-log actions and pagination", () => {
    expect(activityLog).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(activityLog).toContain('color: peoplePrimary, fontSize: "13px"');
    expect(activityLog).toContain('background: "hsl(var(--primary) / 0.15)"');
  });

  it("uses People36t tokens for employee letter approvals and actions", () => {
    expect(hrApprovals).toContain('const peoplePrimary = "hsl(var(--primary))"');
    expect(hrApprovals).toContain('background: salaryFilter === f ? peoplePrimary');
    expect(hrApprovals).not.toContain("#1FA98C");
  });

  it("uses People36t tokens for internal announcements without gradients", () => {
    expect(announcements).not.toContain("bg-gradient-to-l");
    expect(announcements).toContain('background: "hsl(var(--primary))"');
    expect(announcements).toContain('borderColor: "hsl(var(--primary) / 0.20)"');
  });

  it("uses People36t tokens for survey inputs, cards, and question controls", () => {
    expect(surveys).toContain('background: "hsl(var(--input))"');
    expect(surveys).toContain('color: "hsl(var(--primary))"');
    expect(surveys).toContain('background: "hsl(var(--background))"');
  });

  it("uses People36t tokens for internal notification defaults and filters", () => {
    expect(notifications).toContain('color: "hsl(var(--primary))", label: "عام"');
    expect(notifications).toContain('filter === f.id ? "hsl(var(--primary) / 0.15)"');
    expect(notifications).toContain('background: "hsl(var(--input))"');
  });

  it("uses People36t tokens for compliance export, status, and renewal actions", () => {
    expect(compliance).toContain('color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.12)"');
    expect(compliance).toContain("background:'hsl(var(--primary) / 0.15)'");
    expect(compliance).toContain("color:'hsl(var(--primary))'");
  });

  it("uses People36t tokens for government-integration truthful states", () => {
    expect(governmentIntegration).toContain('background: "hsl(var(--primary) / 0.12)"');
    expect(governmentIntegration).toContain('background: isActive ? "hsl(var(--primary))"');
    expect(governmentIntegration).toContain('color: "hsl(var(--primary))"');
    expect(governmentIntegration).not.toContain("linear-gradient");
    expect(governmentIntegration).not.toContain("#1FA98C");
  });
});
