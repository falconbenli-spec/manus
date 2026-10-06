/**
 * MainLayout - HCM Platform
 * Brand: People36t Identity — Teal #0E9F87, Charcoal #292B2D
 * Dark theme sidebar with turquoise active states + grouped navigation
 * Font: Alexandria
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Users, UserPlus, UserCheck, Clock, DollarSign, BarChart2,
  BookOpen, TrendingUp, Heart, PieChart, Shield, Settings,
  LayoutDashboard, Menu, Bell, Search, ChevronDown, ChevronLeft,
  LogOut, HelpCircle, CalendarDays, Activity, Plug, FileText,
  Smartphone, ClipboardCheck, Building2, KeyRound,
  Send, FolderKanban, Target, UserCog, Receipt, MessageSquare, FileArchive, FileSpreadsheet, Award, Sun, Moon, X,
  Trophy, GitBranch, Gamepad2, Bot, Brain, Briefcase, GraduationCap, Zap, ClipboardList, Mail, Megaphone
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import BrandLogo from "@/components/BrandLogo";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useTheme } from "@/contexts/ThemeContext";

import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';

// Compute weekly shortfall alerts count from API data
function computeAlertCount(data: Array<{ employeeId?: string; employee_id?: string; date: string; isWeekend?: boolean; is_weekend?: boolean; flexShortfall?: boolean; flex_shortfall?: boolean; flexShortfallMins?: number }>): number {
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  function getISOWeek(dateStr: string): number {
    const parts = dateStr.split("-");
    let dt: Date;
    if (parts.length === 3 && months[parts[1]] !== undefined) {
      const [d, mon, y] = parts;
      dt = new Date(Number(y), months[mon], Number(d));
    } else {
      dt = new Date(dateStr);
    }
    if (isNaN(dt.getTime())) return 0;
    const jan4 = new Date(dt.getFullYear(), 0, 4);
    const s = new Date(jan4); s.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    return Math.floor((dt.getTime() - s.getTime()) / (7 * 86400000)) + 1;
  }
  const map: Record<string, Record<number, number>> = {};
  data.filter(r => !(r.isWeekend || r.is_weekend) && (r.flexShortfall || r.flex_shortfall)).forEach(r => {
    const eid = r.employeeId || r.employee_id || '';
    const w = getISOWeek(r.date);
    if (!map[eid]) map[eid] = {};
    map[eid][w] = (map[eid][w] || 0) + 1;
  });
  let count = 0;
  Object.values(map).forEach(weeks => Object.values(weeks).forEach(days => { if (days >= 3) count++; }));
  return count;
}

// Types
interface NavItem {
  path: string;
  icon: any;
  label: string;
  labelEn: string;
  badge?: number;
  strategic?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  labelEn: string;
  icon: any;
  items: NavItem[];
}

// Grouped navigation structure
const navGroups: (NavItem | NavGroup)[] = [
  { path: "/", icon: LayoutDashboard, label: "لوحة التحكم", labelEn: "Dashboard" },
  { path: "/my-tasks", icon: ClipboardList, label: "مهامي", labelEn: "My Tasks" },
  { path: "/task-reports", icon: FileText, label: "تقارير المهام", labelEn: "Task Reports" },
  {
    id: "employees",
    label: "إدارة الموظفين",
    labelEn: "Employees",
    icon: Users,
    items: [
      { path: "/core-hrm", icon: Users, label: "بيانات الموظفين", labelEn: "Core HRM" },
      { path: "/org-chart", icon: Building2, label: "الهيكل التنظيمي", labelEn: "Org Chart" },
      { path: "/employee-passwords", icon: KeyRound, label: "كلمات المرور", labelEn: "Passwords" },
      { path: "/employee-portal", icon: Smartphone, label: "بوابة الموظف", labelEn: "Employee Portal" },
    ]
  },
  {
    id: "hiring",
    label: "التوظيف والتهيئة",
    labelEn: "Hiring",
    icon: UserPlus,
    items: [
      { path: "/recruitment", icon: UserPlus, label: "الاستقطاب والتوظيف", labelEn: "Recruitment" },
      { path: "/onboarding", icon: UserCheck, label: "الإعداد والتأهيل", labelEn: "Onboarding" },
    ]
  },
  {
    id: "time",
    label: "الحضور والإجازات",
    labelEn: "Time & Leave",
    icon: Clock,
    items: [
      { path: "/attendance", icon: Clock, label: "الحضور والانصراف", labelEn: "Attendance" },
      { path: "/weekly-report", icon: FileText, label: "التقرير الأسبوعي", labelEn: "Weekly Report" },
      { path: "/leave", icon: CalendarDays, label: "إدارة الإجازات", labelEn: "Leave" },
      { path: "/manager-leave-calendar", icon: CalendarDays, label: "تقويم الفريق", labelEn: "Team Calendar" },
    ]
  },
  {
    id: "finance",
    label: "الرواتب والمالية",
    labelEn: "Finance",
    icon: DollarSign,
    items: [
      { path: "/payroll", icon: DollarSign, label: "الرواتب والمزايا", labelEn: "Payroll" },
      { path: "/expenses", icon: Receipt, label: "المصروفات والعهد", labelEn: "Expenses" },
    ]
  },
  {
    id: "performance",
    label: "الأداء والأهداف",
    labelEn: "Performance",
    icon: Target,
    items: [
      { path: "/performance", icon: BarChart2, label: "الأداء والتقييم", labelEn: "Performance" },
      { path: "/okrs", icon: Target, label: "الأهداف (OKRs)", labelEn: "OKRs" },
      { path: "/skills-matrix", icon: Award, label: "المهارات والتعاقب", labelEn: "Skills", strategic: true },
      { path: "/career", icon: TrendingUp, label: "المسار الوظيفي", labelEn: "Career" },
    ]
  },
  {
    id: "learning",
    label: "التعلم والتطوير",
    labelEn: "Learning",
    icon: GraduationCap,
    items: [
      { path: "/learning", icon: BookOpen, label: "التدريب والتطوير", labelEn: "Training" },
      { path: "/knowledge-base", icon: BookOpen, label: "قاعدة المعرفة", labelEn: "Knowledge Base" },
    ]
  },
  {
    id: "engagement",
    label: "الاندماج والرفاهية",
    labelEn: "Engagement & Wellbeing",
    icon: Heart,
    items: [
      { path: "/engagement", icon: Heart, label: "اندماج الموظفين", labelEn: "Engagement" },
      { path: "/wellness", icon: Heart, label: "الصحة والرفاهية", labelEn: "Wellness" },
      { path: "/recognition", icon: Award, label: "التقدير والمكافأة", labelEn: "Recognition" },
      { path: "/gamification", icon: Trophy, label: "الإنجازات والنقاط", labelEn: "Achievements & Points" },
    ]
  },
  {
    id: "operations",
    label: "العمليات والطلبات",
    labelEn: "Operations",
    icon: Send,
    items: [
      { path: "/work-requests", icon: Send, label: "طلبات الأعمال", labelEn: "Requests" },
      { path: "/projects", icon: FolderKanban, label: "المشاريع والعملاء", labelEn: "Projects" },
      { path: "/self-service", icon: UserCog, label: "الخدمة الذاتية", labelEn: "Self Service" },
      { path: "/hr-approvals", icon: ClipboardCheck, label: "الموافقات", labelEn: "Approvals" },
      { path: "/workflow", icon: GitBranch, label: "سير العمل", labelEn: "Workflow" },
      { path: "/documents", icon: FileArchive, label: "الوثائق والسياسات", labelEn: "Documents" },
    ]
  },
  {
    id: "analytics",
    label: "التحليلات والتقارير",
    labelEn: "Analytics",
    icon: PieChart,
    items: [
      { path: "/analytics", icon: PieChart, label: "التقارير والتحليلات", labelEn: "Analytics" },
      { path: "/reports-center", icon: FileText, label: "مركز تقارير PDF", labelEn: "Reports Center" },
      { path: "/department-reports", icon: FileSpreadsheet, label: "تقارير الإدارات Excel", labelEn: "Department Excel Reports" },
    ]
  },
  { path: "/ai-assistant", icon: Bot, label: "المساعد الذكي", labelEn: "AI Assistant" },
  { path: "/notifications", icon: Bell, label: "الإشعارات", labelEn: "Notifications" },
  {
    id: "system",
    label: "النظام والإعدادات",
    labelEn: "System",
    icon: Settings,
    items: [
      { path: "/settings", icon: Settings, label: "الإعدادات", labelEn: "Settings" },
      { path: "/email-management", icon: Mail, label: "إدارة البريد", labelEn: "Email Management" },
      { path: "/announcements", icon: Megaphone, label: "إدارة الإعلانات", labelEn: "Announcements" },
      { path: "/compliance", icon: Shield, label: "الامتثال القانوني", labelEn: "Compliance" },
      { path: "/privacy", icon: KeyRound, label: "الخصوصية والبيانات", labelEn: "Privacy & Data" },
      { path: "/activity-log", icon: Activity, label: "سجل النشاط", labelEn: "Activity Log" },
      { path: "/zoho-integration", icon: Plug, label: "ربط Zoho", labelEn: "Zoho" },
      { path: "/government", icon: Shield, label: "التكامل الحكومي", labelEn: "Government" },
    ]
  },
];

function isNavGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'items' in item;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "مالك النظام • مدير رأس المال البشري",
  admin: "مدير النظام",
  manager: "مدير إدارة",
  employee: "موظف",
};

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = mobileNavRef.current;
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)') || []).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (matchMedia('(min-width:1024px)').matches) return;
      if (event.key === 'Escape') { event.preventDefault(); setMobileSidebarOpen(false); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items[items.length - 1];
        if (!first) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [mobileSidebarOpen]);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width:1024px)').matches);
  useEffect(() => {const media=window.matchMedia('(min-width:1024px)');const update=()=>{setDesktop(media.matches);if(media.matches)setMobileSidebarOpen(false);else setSidebarOpen(true)};media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearchOpen(value=>!value)}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navGroups.forEach(item => {
      if (isNavGroup(item)) {
        if (item.items.some(sub => sub.path === location)) {
          initial[item.id] = true;
        }
      }
    });
    return initial;
  });
  const { user, logout } = useAuth();
  const { logActivity } = useActivityLog();
  const { theme, toggleTheme } = useTheme();
  const canManageSuccession = ["owner", "admin", "manager"].includes(user?.role || "");

  // Interactive glow tracking for stat-card elements


  const [alertCount, setAlertCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    fetch('/api/hcm/attendance', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAlertCount(computeAlertCount(data || [])))
      .catch(() => setAlertCount(0));
  }, [user]);

  const handleNav = (path: string) => {
    navigate(path);
    setMobileSidebarOpen(false);
    setSearchQuery("");
    setSearchOpen(false);
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleLogout = () => {
    if (user) {
      logActivity({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        category: "auth",
        action: "تسجيل خروج",
        details: `قام ${user.name} بتسجيل الخروج من المنصة`,
        severity: "info",
      });
    }
    logout();
    navigate("/login");
  };

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ar");

    const items: NavItem[] = [];
    navGroups.forEach(item => {
      if (isNavGroup(item)) items.push(...item.items.filter(sub => !sub.strategic || canManageSuccession));
      else if (!item.strategic || canManageSuccession) items.push(item);
    });
    return items.filter(item => `${item.label} ${item.labelEn}`.toLocaleLowerCase("ar").includes(query));
  }, [searchQuery, canManageSuccession]);

  const activeGroupId = useMemo(() => {
    for (const item of navGroups) {
      if (isNavGroup(item) && item.items.some(sub => sub.path === location)) {
        return item.id;
      }
    }
    return null;
  }, [location]);

  useEffect(() => {
    if (activeGroupId && !expandedGroups[activeGroupId]) {
      setExpandedGroups(prev => ({ ...prev, [activeGroupId]: true }));
    }
  }, [activeGroupId]);

  const activeItem = navGroups.flatMap(item=>isNavGroup(item)?item.items:[item]).find(item=>item.path===location);
  const activeGroup = navGroups.find(item=>isNavGroup(item)&&item.items.some(sub=>sub.path===location));
  const userInitial = user?.name?.charAt(0) || "م";
  const userName = user?.name || "مدير النظام";
  const userRole = user ? ROLE_LABELS[user.role] || user.role : "";
  const userDept = user?.department ? ` — ${user.department}` : "";

  const totalBadge = alertCount;

  return (
    <div className="people-workspace app-surface flex h-screen overflow-hidden">
      <a className="sr-only-focusable" href="#main-content">انتقل إلى المحتوى الرئيسي</a>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={mobileNavRef}
        aria-label="القائمة الجانبية"
        inert={!desktop && !mobileSidebarOpen}
        data-collapsed={!sidebarOpen}
        className={`sidebar-shell
          fixed right-0 lg:relative z-50 lg:z-auto
          flex flex-col h-full
          transition-transform duration-200 ease-out
          ${sidebarOpen || !desktop ? 'w-[254px]' : 'w-20'}
          ${mobileSidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
        `}
        style={{
          background: 'hsl(var(--sidebar))',
          borderLeft: '1px solid hsl(var(--sidebar-border))',
          borderRight: 'none',
          flexShrink: 0
        }}
      >
        {/* Logo area */}
        <div className="sidebar-brand flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid hsl(var(--sidebar-border))' }}>
          {sidebarOpen ? (
            <BrandLogo className="text-[32px]" showTagline={false} variant="color" />
          ) : (
            <BrandLogo className="text-[22px]" showTagline={false} variant="color" />
          )}
          <button
            className="mr-auto hidden lg:flex items-center justify-center rounded-md transition-colors"
            style={{ color: 'hsl(var(--muted-foreground))', width: '44px', height: '44px' }}
            aria-label={sidebarOpen ? "طي القائمة الجانبية" : "توسيع القائمة الجانبية"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu size={16} />
          </button>
        </div>

        {mobileSidebarOpen && <button type="button" className="lg:hidden mx-3 mb-2 flex min-h-11 items-center justify-center gap-2 rounded-md border text-xs" aria-label="إغلاق قائمة المنصة" onClick={() => setMobileSidebarOpen(false)}><X size={16} aria-hidden="true" /> إغلاق القائمة</button>}

        {/* Nav items */}
        <nav className="sidebar-nav flex-1 overflow-y-auto py-2 px-2" style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--border)) transparent' }} aria-label="أقسام المنصة">
          {navGroups.map((item, idx) => {
            if (!isNavGroup(item)) {
              if (item.strategic && !canManageSuccession) return null;
              const isActive = location === item.path;
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  onClick={() => handleNav(item.path)}
                  className="nav-item w-full text-right mb-0.5" aria-current={isActive ? "page" : undefined}
                  style={isActive ? {
                    background: 'hsl(var(--primary) / 0.12)',
                    color: 'hsl(var(--primary))',
                    borderRight: '3px solid hsl(var(--primary))',
                    paddingRight: 'calc(0.875rem - 3px)'
                  } : {}}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                    <Icon size={17} />
                  </div>
                  {sidebarOpen && (
                    <span style={{ fontWeight: isActive ? 600 : 500, fontSize: '13px' }}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            }

            const visibleItems = item.items.filter(sub => !sub.strategic || canManageSuccession);
            if (!visibleItems.length) return null;
            const isExpanded = expandedGroups[item.id] || false;
            const hasActiveChild = visibleItems.some(sub => sub.path === location);
            const Icon = item.icon;
            const groupBadge = visibleItems.reduce((sum, sub) => {
              if (sub.path === '/attendance') return sum + alertCount;
              return sum + (sub.badge || 0);
            }, 0);

            return (
              <div key={item.id} className="mb-1">
                <button
                  onClick={() => sidebarOpen ? toggleGroup(item.id) : handleNav(visibleItems[0].path)}
                  className="nav-item w-full text-right" aria-expanded={sidebarOpen ? isExpanded : undefined}
                  style={{
                    ...(hasActiveChild && !isExpanded ? {
                      background: 'hsl(var(--primary) / 0.08)',
                      color: 'hsl(var(--primary))',
                    } : {}),
                    fontWeight: 600,
                  }}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                    <Icon size={17} />
                    {groupBadge > 0 && !sidebarOpen && (
                      <span style={{
                        position: 'absolute', top: '-5px', right: '-5px',
                        width: '14px', height: '14px', borderRadius: '50%',
                        background: '#EF4444', color: 'white',
                        fontSize: '8px', fontWeight: 800,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1.5px solid hsl(var(--sidebar))',
                      }}>{groupBadge}</span>
                    )}
                  </div>
                  {sidebarOpen && (
                    <>
                      <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>
                        {item.label}
                      </span>
                      {groupBadge > 0 && (
                        <span style={{
                          background: '#EF4444', color: 'white', borderRadius: '10px',
                          padding: '0 6px', fontSize: '10px', fontWeight: 700,
                          lineHeight: '18px', marginLeft: '4px',
                        }}>{groupBadge}</span>
                      )}
                      <ChevronDown
                        size={14}
                        style={{
                          color: 'hsl(var(--muted-foreground))',
                          transition: 'transform 0.2s ease',
                          transform: isExpanded ? 'rotate(0deg)' : 'rotate(90deg)',
                          flexShrink: 0,
                        }}
                      />
                    </>
                  )}
                </button>

                {sidebarOpen && isExpanded && (
                  <div style={{
                    overflow: 'hidden',
                    transition: 'max-height 0.25s ease',
                    marginRight: '12px',
                    borderRight: '2px solid hsl(var(--border))',
                    paddingRight: '0',
                  }}>
                    {visibleItems.map(sub => {
                      const isSubActive = location === sub.path;
                      const SubIcon = sub.icon;
                      return (
                        <button
                          key={sub.path}
                          onClick={() => handleNav(sub.path)}
                          className="nav-subitem w-full text-right flex items-center gap-2 rounded-md transition-colors" aria-current={isSubActive ? "page" : undefined}
                          style={{
                            padding: '6px 10px',
                            marginBottom: '1px',
                            fontSize: '12px',
                            fontWeight: isSubActive ? 600 : 400,
                            color: isSubActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                            background: isSubActive ? 'hsl(var(--primary) / 0.10)' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: '6px',
                          }}
                        >
                          <SubIcon size={14} style={{ flexShrink: 0 }} />
                          <span style={{ flex: 1 }}>{sub.label}</span>
                          {((sub.path === '/attendance' ? alertCount : sub.badge) || 0) > 0 && (
                            <span style={{
                              background: '#EF4444', color: 'white', borderRadius: '8px',
                              padding: '0 5px', fontSize: '9px', fontWeight: 700,
                              lineHeight: '16px',
                            }}>{sub.path === '/attendance' ? alertCount : sub.badge}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom user area */}
        <div style={{ borderTop: '1px solid hsl(var(--sidebar-border))', padding: '0.75rem' }}>
          {sidebarOpen ? (
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'hsl(var(--muted))' }}>
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0"
                style={{ width: '32px', height: '32px', background: 'hsl(var(--primary))' }}
              >
                <span style={{ color: 'white', fontWeight: 700, fontSize: '13px' }}>{userInitial}</span>
              </div>
              <div className="flex-1 overflow-hidden">
                <div style={{ fontWeight: 600, fontSize: '12px', color: 'hsl(var(--foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {userName}
                </div>
                <div style={{ fontSize: '10px', color: 'hsl(var(--muted-foreground))' }}>
                  {userRole}{userDept}
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="تسجيل الخروج"
                style={{ color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                onClick={handleLogout}
                title="تسجيل الخروج"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <div
                  className="rounded-full flex items-center justify-center"
                  style={{ width: '32px', height: '32px', background: 'hsl(var(--primary))' }}
                >
                  <span style={{ color: 'white', fontWeight: 700, fontSize: '13px' }}>{userInitial}</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <div className="app-body flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="top-header app-topbar flex-shrink-0" style={{ position: 'relative', overflow: 'hidden' }}>
          <button
            className="lg:hidden flex items-center justify-center rounded-md"
            aria-label="فتح قائمة المنصة"
            style={{ color: 'hsl(var(--muted-foreground))', width: '44px', height: '44px' }}
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          <div className="workspace-location"><span>{activeGroup && isNavGroup(activeGroup)?activeGroup.label:'مساحة العمل'}</span><ChevronLeft size={12} aria-hidden="true"/><strong>{activeItem?.label||'منصة رأس المال البشري'}</strong></div>
          <button type="button" className="people-search flex items-center gap-3 rounded-lg border px-3 py-3 text-muted-foreground" onClick={()=>setSearchOpen(true)} aria-label="البحث في المنصة"><Search size={16}/><span className="flex-1 text-start text-xs">ابحث عن قسم…</span><kbd className="hidden sm:inline text-[10px]" dir="ltr">⌘ K</kbd></button>
          <CommandDialog open={searchOpen} onOpenChange={open=>{setSearchOpen(open);if(!open)setSearchQuery('')}} title="البحث في المنصة" description="ابحث باسم القسم، ثم اضغط Enter لفتحه." className="athar-command" showCloseButton={false}>
            <CommandInput value={searchQuery} onValueChange={setSearchQuery} placeholder="ابحث عن قسم أو خدمة…" aria-label="البحث عن قسم أو خدمة"/>
            <CommandList><CommandEmpty>لا توجد أقسام تطابق هذا البحث.</CommandEmpty><CommandGroup heading="أقسام المنصة">{searchResults.map(item=><CommandItem key={item.path} value={`${item.label} ${item.labelEn}`} onSelect={()=>handleNav(item.path)}><item.icon size={16} aria-hidden="true"/><span>{item.label}</span></CommandItem>)}</CommandGroup></CommandList>
          </CommandDialog>

          <div className="flex items-center gap-2 mr-auto">
            {/* Notifications */}
            <button
              className="top-action relative flex items-center justify-center rounded-xl transition-colors"
              aria-label={`فتح الإشعارات${totalBadge > 0 ? `، ${totalBadge} تنبيهات` : ""}`}
              style={{
                width: '44px', height: '44px',
                background: totalBadge > 0 ? 'hsl(0 75% 55% / 0.10)' : 'hsl(var(--muted))',
                border: `1px solid ${totalBadge > 0 ? 'hsl(0 75% 55% / 0.35)' : 'hsl(var(--border))'}`,
                color: totalBadge > 0 ? '#EF4444' : 'hsl(var(--muted-foreground))'
              }}
              onClick={() => handleNav('/notifications')}
            >
              <Bell size={16} />
              {totalBadge > 0 && (
                <span style={{
                  position: 'absolute', top: '-4px', right: '-4px',
                  width: '17px', height: '17px', borderRadius: '50%',
                  background: '#EF4444', color: 'white',
                  fontSize: '9px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid hsl(var(--card))',
                  
                }}>{totalBadge}</span>
              )}
            </button>

            <button
              className="top-action flex items-center justify-center rounded-xl transition-colors"
              style={{ width: '44px', height: '44px', background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              onClick={toggleTheme}
              title={theme === 'dark' ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
              aria-label={theme === 'dark' ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* AI Assistant */}
            <button
              className="top-action flex items-center justify-center rounded-xl transition-colors"
              aria-label="فتح المساعد الذكي"
              style={{
                width: '44px', height: '44px',
                background: 'hsl(var(--muted))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--muted-foreground))'
              }}
              onClick={() => handleNav('/ai-assistant')}
              title="المساعد الذكي"
            >
              <Bot size={16} />
            </button>

            {/* User avatar + logout */}
            <div
              className="top-user flex items-center gap-2 rounded-xl px-2 py-1.5"
              style={{
                background: 'hsl(var(--muted))',
                border: '1px solid hsl(var(--border))'
              }}
              title={userName}
            >
              <div
                className="rounded-full flex items-center justify-center"
                style={{ width: '26px', height: '26px', background: 'hsl(var(--primary))' }}
              >
                <span style={{ color: 'white', fontWeight: 700, fontSize: '11px' }}>{userInitial}</span>
              </div>
              <span style={{ fontWeight: 600, fontSize: '12px', color: 'hsl(var(--foreground))' }}>
                {userName}
              </span>
              <LogOut size={12} style={{ color: 'hsl(var(--muted-foreground))' }} />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main data-route={location} id="main-content" tabIndex={-1} className="page-content flex-1 overflow-y-auto p-4 lg:p-6 mobile-safe-bottom" style={{ position: 'relative' }}>
          {children}
        </main>
      </div>

      <nav className="mobile-nav fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t bg-card px-2 py-2 lg:hidden" style={{ borderColor: 'hsl(var(--border))' }} aria-label="التنقل الرئيسي">
        {[
          { path: '/', label: 'الرئيسية', icon: LayoutDashboard },
          { path: '/attendance', label: 'الحضور', icon: Clock },
          { path: '/leave', label: 'الإجازات', icon: CalendarDays },
          { path: '/notifications', label: 'التنبيهات', icon: Bell },
        ].map(item => {
          const Icon = item.icon;
          const active = location === item.path;
          return <button key={item.path} aria-current={active ? "page" : undefined} onClick={() => handleNav(item.path)} className="flex min-w-14 flex-col items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))', background: active ? 'hsl(var(--primary) / .10)' : 'transparent' }}><Icon size={18} /><span>{item.label}</span></button>;
        })}
      </nav>
    </div>
  );
}
