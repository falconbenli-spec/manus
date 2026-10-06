/**
 * الإنجازات والنقاط — Achievements & Points
 * محسوب تلقائياً من بيانات الحضور والانصراف (9ص - 5م) لجميع الموظفين
 * يستخدم محرك الحساب المشترك attendanceEngine.ts
 */
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployees } from "@/contexts/EmployeeContext";
import PageTemplate from "@/components/layout/PageTemplate";
import {
  setEngineData,
  getEmployeeScores, getOverallStats, getDepartmentStats, getTopEmployees,
  getActiveEmployees, getBadgeStats, getAvailableMonths, getCurrentMonth,
  LEVEL_NAMES, LEVEL_THRESHOLDS,
  type EmployeeScore, type DepartmentStats
} from "@/lib/attendanceEngine";
import {
  Trophy, Star, Zap, Award, Crown, Medal, Target, TrendingUp,
  Gift, Lock, Clock, CheckCircle, AlertTriangle, Users, Flame,
  Calendar, BarChart2, Search, Shield,
  Timer, ChevronDown, ChevronUp, Layers, Sparkles
} from "lucide-react";
import { toast } from "sonner";

const peoplePrimary = "hsl(var(--primary))";
const peoplePrimarySoft = "hsl(var(--primary) / 0.12)";

/* ─── Icon Map ─── */
const iconMap: Record<string, any> = { CheckCircle, Clock, Timer, Flame, Zap, Target, Shield, Star, Trophy };

/* ─── Helpers ─── */
function ScoreRing({ score, size = 52, sw = 3.5 }: { score: number; size?: number; sw?: number }) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r, p = (score / 100) * c;
  const col = score >= 80 ? peoplePrimary : score >= 60 ? '#f59e0b' : score >= 40 ? '#ef4444' : '#64748b';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={c - p} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-black" style={{ color: col, fontSize: size * 0.24, fontFamily: 'Alexandria' }}>{score}%</span>
      </div>
    </div>
  );
}

function Avatar({ name, size = 40, tier }: { name: string; size?: number; tier: string }) {
  const tierBg: Record<string, string> = {
    'ذهبي': '#eab308',
    'فضي': 'hsl(var(--muted-foreground))',
    'برونزي': '#cd7c2f',
    'عادي': peoplePrimary,
  };
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, background: tierBg[tier] || tierBg['عادي'], fontSize: size * 0.38, fontFamily: 'Alexandria' }}>
      {name.charAt(0)}
    </div>
  );
}

function ProgressBar({ value, max, color, height = 6 }: { value: number; max: number; color: string; height?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: 'rgba(255,255,255,0.05)' }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ─── Tabs ─── */
type TabId = 'overview' | 'badges' | 'challenges' | 'leaderboard' | 'levels';
const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: Sparkles },
  { id: 'badges', label: 'الشارات', icon: Award },
  { id: 'challenges', label: 'التحديات', icon: Target },
  { id: 'leaderboard', label: 'المتصدرين', icon: Trophy },
  { id: 'levels', label: 'المستويات', icon: Layers },
];

/* ─── Main Component ─── */
export default function Gamification() {
  const { user } = useAuth();
  const { employees: contextEmployees } = useEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLevel, setExpandedLevel] = useState<number | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Load data from API for PDPL compliance
  useEffect(() => {
    Promise.all([
      fetch('/api/hcm/attendance', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/api/hcm/employees', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([att, emp]) => {
      setEngineData(att, emp);
      setDataLoaded(true);
    }).catch(() => setDataLoaded(true));
  }, []);

  // Month filter
  const availableMonths = useMemo(() => dataLoaded ? getAvailableMonths() : [], [dataLoaded]);
  const [selectedMonth, setSelectedMonth] = useState('');

  // Update selectedMonth once data is loaded
  useEffect(() => {
    if (dataLoaded && !selectedMonth) {
      setSelectedMonth(getCurrentMonth());
    }
  }, [dataLoaded]);

  // Use shared attendance engine with month filter
  const allScores = useMemo(() => getEmployeeScores(selectedMonth), [selectedMonth, dataLoaded]);
  const stats = useMemo(() => getOverallStats(selectedMonth), [selectedMonth, dataLoaded]);
  const deptStats = useMemo(() => getDepartmentStats(selectedMonth), [selectedMonth, dataLoaded]);
  const topEmployees = useMemo(() => getTopEmployees(60, selectedMonth), [selectedMonth, dataLoaded]);
  const active = useMemo(() => getActiveEmployees(selectedMonth), [selectedMonth, dataLoaded]);
  const badgeStats = useMemo(() => getBadgeStats(selectedMonth), [selectedMonth, dataLoaded]);

  // Current user
  const currentUser = useMemo(() => {
    if (user?.id) {
      const found = allScores.find(e => e.id === user.id);
      if (found) return found;
    }
    return undefined;
  }, [user, allScores]);

  const filtered = useMemo(() => {
    if (!searchQuery) return topEmployees;
    return topEmployees.filter(e => e.name.includes(searchQuery) || e.department.includes(searchQuery));
  }, [topEmployees, searchQuery]);

  // Level distribution
  const levelDist = useMemo(() => {
    const dist: Record<number, EmployeeScore[]> = {};
    for (let i = 1; i <= 10; i++) dist[i] = [];
    active.forEach(e => { if (dist[e.level]) dist[e.level].push(e); });
    return dist;
  }, [active]);

  return (
    <PageTemplate
      title="الإنجازات والنقاط"
      subtitle="اجمع النقاط واحصل على الشارات وتنافس مع زملائك • محسوب تلقائياً من الحضور (9ص - 5م)"
      icon={Trophy}
      stats={[
        { label: "إجمالي الموظفين", value: stats.activeEmployees.toString(), icon: Users },
        { label: "متوسط النقاط", value: Math.round(stats.totalPoints / Math.max(stats.activeEmployees, 1)).toString(), icon: BarChart2 },
        { label: "الشارات الممنوحة", value: stats.totalBadges.toString(), icon: Award },
        { label: "أداء متميز", value: (stats.goldCount + stats.silverCount).toString(), icon: Star },
      ]}
    >
      {/* Month Selector */}
      {availableMonths.length > 0 && (
        <div className="flex items-center gap-3 mb-6 justify-end">
          <Calendar size={16} className="text-gray-400" />
          <span className="text-sm text-gray-400" style={{ fontFamily: 'Alexandria' }}>الشهر:</span>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-sm border border-gray-600 bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            style={{ fontFamily: 'Alexandria' }}
          >
            {availableMonths.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}{m.hasData ? '' : ' (لا توجد بيانات)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* My Stats Card */}
      {currentUser && (
        <div className="rounded-xl p-4 mb-6 relative overflow-hidden" style={{ background: `${currentUser.tierColor}0d`, border: `1px solid ${currentUser.tierColor}30` }}>
          <div className="absolute top-0 left-0 w-full h-1 opacity-60" style={{ background: currentUser.tierColor }} />
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <Avatar name={currentUser.name} size={56} tier={currentUser.tier} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold text-lg" style={{ fontFamily: "Alexandria" }}>{currentUser.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{ background: `${currentUser.tierColor}20`, color: currentUser.tierColor, border: `1px solid ${currentUser.tierColor}30` }}>
                    {currentUser.tier}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span style={{ color: currentUser.tierColor }}>المستوى {currentUser.level}</span>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-400">{currentUser.levelName}</span>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-400">{currentUser.department}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6">
              {[
                { v: currentUser.points.toLocaleString(), l: 'نقطة', c: '#eab308' },
                { v: currentUser.badges.length, l: 'شارة', c: '#8b5cf6' },
                { v: `#${currentUser.rank}`, l: 'الترتيب', c: peoplePrimary },
                { v: `${currentUser.attendanceRate}%`, l: 'الحضور', c: currentUser.tierColor },
              ].map((s, i) => (
                <div key={i} className="text-center">
                  <div className="text-2xl font-bold" style={{ color: s.c }}>{s.v}</div>
                  <div className="text-xs text-gray-400">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>المستوى {currentUser.level} → المستوى {Math.min(currentUser.level + 1, 10)}</span>
              <span style={{ color: currentUser.tierColor }}>
                {currentUser.level >= 10 ? 'الحد الأقصى!' : `${currentUser.nextLevelPoints - currentUser.points} نقطة متبقية`}
              </span>
            </div>
            <ProgressBar value={currentUser.progressToNextLevel} max={100} color={currentUser.tierColor} height={8} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(tab => {
          const I = tab.icon; const a = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                fontFamily: "Alexandria",
                background: a ? peoplePrimary : "rgba(255,255,255,0.05)",
                color: a ? "white" : "rgba(255,255,255,0.6)",
                border: `1px solid ${a ? peoplePrimary : "rgba(255,255,255,0.1)"}`,
              }}>
              <I size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ═══ Overview Tab ═══ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Stats */}
          {currentUser && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "أيام الحضور", value: currentUser.presentDays, icon: CheckCircle, color: peoplePrimary },
                { label: "أيام الغياب", value: currentUser.absentDays, icon: AlertTriangle, color: "#ef4444" },
                { label: "متوسط الساعات", value: `${currentUser.avgHoursPerDay}h`, icon: Clock, color: "#3b82f6" },
                { label: "نسبة الالتزام", value: `${currentUser.complianceRate}%`, icon: Shield, color: "#8b5cf6" },
              ].map((stat, i) => (
                <div key={i} className="rounded-xl p-3 text-center" style={{ background: `${stat.color}06`, border: `1px solid ${stat.color}12` }}>
                  <stat.icon size={20} className="mx-auto mb-1" style={{ color: stat.color }} />
                  <div className="text-lg font-bold text-white">{stat.value}</div>
                  <div className="text-xs text-gray-400" style={{ fontFamily: "Alexandria" }}>{stat.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Top 3 Podium */}
          {topEmployees.length >= 3 && (
            <div>
              <h3 className="text-white font-bold mb-3 flex items-center gap-2" style={{ fontFamily: "Alexandria" }}>
                <Trophy size={18} style={{ color: "#eab308" }} /> أفضل 3 هذا الشهر
              </h3>
              <div className="flex items-end justify-center gap-3 px-4">
                {[topEmployees[1], topEmployees[0], topEmployees[2]].map((emp, i) => {
                  const cols = ['hsl(var(--muted-foreground))', '#eab308', '#cd7c2f'];
                  const nums = ['2', '1', '3'];
                  const heights = ['h-24', 'h-32', 'h-20'];
                  return (
                    <div key={emp.id} className="flex flex-col items-center" style={{ width: i === 1 ? '130px' : '110px' }}>
                      <div className="relative mb-2">
                        {i === 1 && <Crown size={18} className="absolute -top-4 left-1/2 -translate-x-1/2" style={{ color: '#eab308' }} />}
                        <Avatar name={emp.name} size={i === 1 ? 52 : 44} tier={emp.tier} />
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                          style={{ background: cols[i] }}>{nums[i]}</div>
                      </div>
                      <p className="text-[11px] font-bold text-center text-white/90 leading-tight mb-0.5">{emp.name}</p>
                      <p className="text-[9px] text-gray-500 text-center mb-1">{emp.department}</p>
                      <div className={`w-full ${heights[i]} rounded-t-xl mt-2 flex flex-col items-center justify-end pb-2`}
                        style={{ background: `${cols[i]}10`, borderTop: `2px solid ${cols[i]}40` }}>
                        <p className="text-lg font-black" style={{ color: cols[i] }}>{emp.points}</p>
                        <p className="text-[9px] text-gray-500">نقطة</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-xl p-4" style={{ background: "hsl(var(--primary) / 0.06)", border: "1px solid hsl(var(--primary) / 0.16)" }}>
            <h3 className="text-white font-bold mb-1 flex items-center gap-2" style={{ fontFamily: "Alexandria" }}><Target size={18} style={{ color: peoplePrimary }} /> التحديات</h3>
            <p className="text-xs text-gray-400">تظهر التحديات بعد نشرها وربط تقدمها بسجل خادمي محمي. لا توجد تحديات محلية أو تقدم تجريبي معروض حالياً.</p>
          </div>

          {/* Department Rankings */}
          <div>
            <h3 className="text-white font-bold mb-3 flex items-center gap-2" style={{ fontFamily: "Alexandria" }}>
              <Users size={18} style={{ color: peoplePrimary }} /> ترتيب الأقسام
            </h3>
            <div className="space-y-2">
              {deptStats.map((dept, i) => (
                <div key={dept.name} className="flex items-center gap-3 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="text-sm font-bold w-6 text-center" style={{ color: i < 3 ? "#eab308" : "rgba(255,255,255,0.4)" }}>#{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-white font-medium" style={{ fontFamily: "Alexandria" }}>{dept.name}</span>
                      <span className="text-[10px] text-gray-400">{dept.employeeCount} موظف</span>
                    </div>
                    <ProgressBar value={dept.avgScore} max={100} color={dept.avgScore >= 60 ? peoplePrimary : dept.avgScore >= 40 ? '#f59e0b' : '#ef4444'} height={4} />
                  </div>
                  <div className="text-center w-14">
                    <p className="text-sm font-bold" style={{ color: peoplePrimary }}>{dept.avgScore}%</p>
                    <p className="text-[8px] text-gray-500">التقييم</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tier Distribution */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { t: 'ذهبي', c: '#eab308', n: stats.goldCount, icon: Crown },
              { t: 'فضي', c: 'hsl(var(--muted-foreground))', n: stats.silverCount, icon: Medal },
              { t: 'برونزي', c: '#cd7c2f', n: stats.bronzeCount, icon: Award },
              { t: 'عادي', c: '#64748b', n: stats.normalCount, icon: Star },
            ].map(d => {
              const I = d.icon;
              return (
                <div key={d.t} className="text-center p-4 rounded-xl border border-white/5" style={{ background: `${d.c}06` }}>
                  <I size={22} className="mx-auto mb-1" style={{ color: d.c }} />
                  <p className="text-xl font-black" style={{ color: d.c }}>{d.n}</p>
                  <p className="text-[10px] text-gray-500">{d.t}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Badges Tab ═══ */}
      {activeTab === 'badges' && (
        <div className="space-y-4">
          <div className="rounded-xl p-3 border border-white/5" style={{ background: 'rgba(139,92,246,0.06)' }}>
            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <Award size={13} style={{ color: '#8b5cf6' }} />
              الشارات تُمنح تلقائياً بناءً على أداء الحضور والانصراف الفعلي (9ص - 5م)
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {badgeStats.map(badge => {
              const BI = iconMap[badge.icon] || Star;
              const holders = allScores.filter(e => e.badges.some(b => b.name === badge.name));
              const userHas = currentUser?.badges.some(b => b.name === badge.name);
              return (
                <div key={badge.name} className="rounded-xl p-4 border border-white/5 hover:border-white/10 transition-all"
                  style={{ background: userHas ? `${badge.color}08` : 'rgba(255,255,255,0.02)', borderColor: userHas ? `${badge.color}30` : undefined }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center relative" style={{ background: `${badge.color}15` }}>
                      <BI size={24} style={{ color: badge.color }} />
                      {userHas && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                          <CheckCircle size={10} className="text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-white">{badge.name}</p>
                      <p className="text-[10px] text-gray-500">{badge.description}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black" style={{ color: badge.color }}>{badge.count}</p>
                      <p className="text-[8px] text-gray-500">حاصل</p>
                    </div>
                  </div>
                  <ProgressBar value={badge.count} max={active.length} color={badge.color} height={4} />
                  <p className="text-[9px] text-gray-500 mt-1.5 text-left">{Math.round((badge.count / Math.max(active.length, 1)) * 100)}% من الموظفين</p>
                  {holders.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
                      {holders.slice(0, 5).map(h => (
                        <div key={h.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                          <Avatar name={h.name} size={14} tier={h.tier} />
                          <span className="text-[9px] text-gray-400">{h.name.split(' ')[0]}</span>
                        </div>
                      ))}
                      {holders.length > 5 && <span className="text-[9px] text-gray-500 self-center">+{holders.length - 5}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'challenges' && (
        <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <Target size={28} className="mx-auto mb-3" style={{ color: peoplePrimary }} />
          <h3 className="text-white font-bold" style={{ fontFamily: "Alexandria" }}>لا توجد تحديات منشورة حالياً</h3>
          <p className="text-sm text-gray-400 mt-2">يتطلب نشر التحديات وتحديث التقدم مساراً خادمياً محمياً. لم يُنشأ أو يُعدّل أي تحدٍ محلياً.</p>
        </div>
      )}

      {/* ═══ Leaderboard Tab ═══ */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" placeholder="ابحث بالاسم أو القسم..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2.5 rounded-xl text-xs text-white placeholder-gray-500 border border-white/5 outline-none"
                style={{ background: 'rgba(255,255,255,0.03)', fontFamily: 'Alexandria' }} />
            </div>
          </div>
          <div className="mb-3 text-[11px] text-gray-400 flex items-center gap-1.5 p-2.5 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.06)', border: '1px solid hsl(var(--primary) / 0.12)' }}>
            <TrendingUp size={12} style={{ color: peoplePrimary }} />
            الترتيب مبني على: 40% نسبة الحضور + 30% الالتزام بالمواعيد (9ص) + 20% الامتثال (8 ساعات) + 10% معدل الساعات
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {['#', 'الموظف', 'الحضور', 'الساعات', 'المستوى', 'الشارات', 'التقييم', 'النقاط'].map(h => (
                    <th key={h} className="p-3 text-gray-400 font-medium text-center first:text-right" style={{ fontFamily: "Alexandria" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp, idx) => {
                  const isMe = currentUser && emp.id === currentUser.id;
                  return (
                    <tr key={emp.id} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors"
                      style={{ background: isMe ? "hsl(var(--primary) / 0.08)" : "transparent" }}>
                      <td className="p-3">
                        {emp.rank <= 3 ? (
                          emp.rank === 1 ? <Crown size={16} className="text-yellow-400" /> :
                          emp.rank === 2 ? <Medal size={16} className="text-gray-300" /> :
                          <Medal size={16} className="text-amber-600" />
                        ) : <span className="font-bold text-gray-500">{emp.rank}</span>}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={emp.name} size={28} tier={emp.tier} />
                          <div>
                            <span className="text-[11px] text-white font-bold" style={{ fontFamily: "Alexandria" }}>
                              {emp.name}
                              {isMe && <span className="text-green-400 mr-1"> (أنت)</span>}
                            </span>
                            <p className="text-[9px] text-gray-500">{emp.department}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
                          background: emp.attendanceRate >= 70 ? "rgba(34,197,94,0.15)" : emp.attendanceRate >= 50 ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.15)",
                          color: emp.attendanceRate >= 70 ? "#22c55e" : emp.attendanceRate >= 50 ? "#eab308" : "#ef4444",
                        }}>{emp.attendanceRate}%</span>
                      </td>
                      <td className="p-3 text-center font-bold" style={{ color: emp.avgHoursPerDay >= 8 ? '#10b981' : '#f59e0b' }}>
                        {emp.avgHoursPerDay}h
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${emp.tierColor}15`, color: emp.tierColor }}>
                          Lv.{emp.level}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {emp.badges.slice(0, 3).map((b, j) => {
                            const BI = iconMap[b.icon] || Star;
                            return <BI key={j} size={11} style={{ color: b.color }} />;
                          })}
                          {emp.badges.length > 3 && <span className="text-[9px] text-gray-500">+{emp.badges.length - 3}</span>}
                          {emp.badges.length === 0 && <span className="text-[9px] text-gray-600">—</span>}
                        </div>
                      </td>
                      <td className="p-3 text-center"><ScoreRing score={emp.compositeScore} size={34} sw={3} /></td>
                      <td className="p-3 text-center font-black" style={{ color: '#eab308' }}>{emp.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Levels Tab ═══ */}
      {activeTab === 'levels' && (
        <div className="space-y-4">
          <div className="rounded-xl p-3 border border-white/5" style={{ background: 'rgba(139,92,246,0.06)' }}>
            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <Layers size={13} style={{ color: '#8b5cf6' }} />
              نظام المستويات: 10 مستويات من مبتدئ إلى أسطورة+ • النقاط محسوبة تلقائياً من الحضور (9ص - 5م)
            </p>
          </div>
          <div className="space-y-2">
            {Array.from({ length: 10 }, (_, i) => 10 - i).map(lvl => {
              const emps = levelDist[lvl] || [];
              const isExp = expandedLevel === lvl;
              const lvlName = LEVEL_NAMES[lvl] || '';
              const minPts = LEVEL_THRESHOLDS[lvl - 1] || 0;
              const maxPts = LEVEL_THRESHOLDS[lvl] || '∞';
              const lvlColor = lvl >= 9 ? '#eab308' : lvl >= 7 ? '#f59e0b' : lvl >= 5 ? '#8b5cf6' : lvl >= 3 ? '#3b82f6' : '#64748b';

              return (
                <div key={lvl} className="rounded-xl border border-white/5 overflow-hidden" style={{ background: emps.length > 0 ? `${lvlColor}04` : 'rgba(255,255,255,0.01)' }}>
                  <button onClick={() => setExpandedLevel(isExp ? null : lvl)}
                    className="w-full flex items-center gap-3 p-3.5 text-right hover:bg-white/[0.02] transition-all">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-sm"
                      style={{ background: `${lvlColor}15`, color: lvlColor }}>{lvl}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white" style={{ fontFamily: 'Alexandria' }}>{lvlName}</span>
                        <span className="text-[9px] text-gray-500">{minPts} - {maxPts} نقطة</span>
                      </div>
                      <ProgressBar value={emps.length} max={Math.max(active.length / 3, 1)} color={lvlColor} height={3} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black" style={{ color: lvlColor }}>{emps.length}</span>
                      <span className="text-[9px] text-gray-500">موظف</span>
                      {emps.length > 0 && (isExp ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />)}
                    </div>
                  </button>
                  {isExp && emps.length > 0 && (
                    <div className="border-t border-white/5 p-3 space-y-1.5">
                      {emps.sort((a, b) => b.points - a.points).map(emp => (
                        <div key={emp.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.02]">
                          <Avatar name={emp.name} size={26} tier={emp.tier} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-white truncate" style={{ fontFamily: 'Alexandria' }}>{emp.name}</p>
                            <p className="text-[9px] text-gray-500">{emp.department}</p>
                          </div>
                          <div className="flex items-center gap-3 text-[10px]">
                            <span style={{ color: '#3b82f6' }}>{emp.attendanceRate}%</span>
                            <span className="font-bold" style={{ color: lvlColor }}>{emp.points} pt</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PageTemplate>
  );
}
