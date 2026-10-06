/**
 * التقدير والمكافأة — Recognition & Rewards
 * محسوب تلقائياً من بيانات الحضور والانصراف (9ص - 5م)
 */
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useEmployees } from "../contexts/EmployeeContext";
import {
  setEngineData,
  getEmployeeScores, getOverallStats, getDepartmentStats, getTopEmployees,
  getActiveEmployees, getBadgeStats, getAvailableMonths, getCurrentMonth,
  type EmployeeScore, type DepartmentStats
} from "@/lib/attendanceEngine";
import {
  Award, Star, Trophy, Heart, ThumbsUp, Zap, Crown, Medal,
  Plus, Send, Search, TrendingUp, Users, Sparkles,
  Gift, Target, Flame, X, Clock, CheckCircle, Timer, Shield,
  BarChart3, ChevronDown, ChevronUp, Edit2, Trash2, Filter
} from "lucide-react";
import { toast } from "sonner";

/* ─── Icon Map ─── */
const iconMap: Record<string, any> = { CheckCircle, Clock, Timer, Flame, Zap, Target, Shield, Star, Trophy };

/* ─── Types ─── */
interface Recognition {
  id: string; fromName: string; toId: string; toName: string; toDept: string;
  category: string; message: string; points: number;
  reactions: { emoji: string; count: number }[];
  createdAt: number;
}

const CATEGORIES = [
  { id: "attendance", label: "التزام بالحضور", icon: Clock, points: 15, color: "#1FA98C" },
  { id: "teamwork", label: "تعاون مميز", icon: Users, points: 10, color: "#6366f1" },
  { id: "innovation", label: "إبداع وابتكار", icon: Sparkles, points: 15, color: "#f59e0b" },
  { id: "leadership", label: "قيادة ملهمة", icon: Crown, points: 20, color: "#8b5cf6" },
  { id: "excellence", label: "تميز في الأداء", icon: Star, points: 15, color: "#10b981" },
  { id: "dedication", label: "تفاني وإخلاص", icon: Heart, points: 10, color: "#ef4444" },
  { id: "helpfulness", label: "مساعدة الآخرين", icon: ThumbsUp, points: 10, color: "#3b82f6" },
  { id: "speed", label: "سرعة الإنجاز", icon: Zap, points: 12, color: "#f97316" },
  { id: "quality", label: "جودة عالية", icon: Target, points: 15, color: "#10b981" },
];

/* ─── Helpers ─── */
function ScoreRing({ score, size = 48, sw = 4 }: { score: number; size?: number; sw?: number }) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r, p = (score / 100) * c;
  const col = score >= 90 ? '#eab308' : score >= 75 ? 'hsl(var(--muted-foreground))' : score >= 60 ? '#cd7c2f' : '#64748b';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={c - p} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-black" style={{ color: col, fontSize: size * 0.22, fontFamily: 'Alexandria' }}>{score}%</span>
      </div>
    </div>
  );
}

function Avatar({ name, size = 40, tier }: { name: string; size?: number; tier: string }) {
  const tierBg: Record<string, string> = {
    'ذهبي': '#eab308',
    'فضي': 'hsl(var(--muted-foreground))',
    'برونزي': '#cd7c2f',
    'عادي': 'hsl(var(--primary))',
  };
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, background: tierBg[tier] || tierBg['عادي'], fontSize: size * 0.38, fontFamily: 'Alexandria' }}>
      {name.charAt(0)}
    </div>
  );
}

function TierBadge({ tier, color }: { tier: string; color: string }) {
  const icons: Record<string, any> = { 'ذهبي': Crown, 'فضي': Medal, 'برونزي': Award, 'عادي': Star };
  const I = icons[tier] || Star;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}>
      <I size={10} /> {tier}
    </span>
  );
}

function StatCard({ icon: I, label, value, sub, color, bg }: {
  icon: any; label: string; value: string | number; sub?: string; color: string; bg: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 border border-white/5" style={{ background: bg }}>
      <div className="absolute top-0 left-0 w-full h-1 opacity-60" style={{ background: color }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-gray-400 mb-1" style={{ fontFamily: 'Alexandria' }}>{label}</p>
          <p className="text-2xl font-black" style={{ color, fontFamily: 'Alexandria' }}>{value}</p>
          {sub && <p className="text-[10px] text-gray-500 mt-1" style={{ fontFamily: 'Alexandria' }}>{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
          <I size={20} style={{ color }} />
        </div>
      </div>
    </div>
  );
}

/* ─── Podium ─── */
function Podium({ employees }: { employees: EmployeeScore[] }) {
  if (employees.length < 3) return null;
  const [first, second, third] = employees;
  const order = [second, first, third];
  const h = ['h-24', 'h-32', 'h-20'];
  const bgs = [
    'rgba(148,163,184,0.15)',
    'rgba(234,179,8,0.2)',
    'rgba(205,124,47,0.15)',
  ];
  const borders = ['rgba(148,163,184,0.3)', 'rgba(234,179,8,0.4)', 'rgba(205,124,47,0.3)'];
  const cols = ['hsl(var(--muted-foreground))', '#eab308', '#cd7c2f'];
  const nums = ['2', '1', '3'];

  return (
    <div className="flex items-end justify-center gap-3 mb-6 px-4">
      {order.map((emp, i) => (
        <div key={emp.id} className="flex flex-col items-center" style={{ width: i === 1 ? '130px' : '110px' }}>
          <div className="relative mb-2">
            {i === 1 && <Crown size={18} className="absolute -top-4 left-1/2 -translate-x-1/2" style={{ color: '#eab308' }} />}
            <Avatar name={emp.name} size={i === 1 ? 52 : 44} tier={emp.tier} />
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
              style={{ background: cols[i] }}>{nums[i]}</div>
          </div>
          <p className="text-[11px] font-bold text-center text-white/90 leading-tight mb-0.5" style={{ fontFamily: 'Alexandria' }}>
            {emp.name}
          </p>
          <p className="text-[9px] text-gray-500 text-center mb-1">{emp.department}</p>
          <TierBadge tier={emp.tier} color={emp.tierColor} />
          <div className={`w-full ${h[i]} rounded-t-xl mt-2 flex flex-col items-center justify-end pb-2`}
            style={{ background: bgs[i], borderTop: `2px solid ${borders[i]}` }}>
            <p className="text-lg font-black" style={{ color: cols[i], fontFamily: 'Alexandria' }}>{emp.points}</p>
            <p className="text-[9px] text-gray-500">نقطة</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Tabs ─── */
type TabId = 'wall' | 'leaderboard' | 'badges' | 'analysis' | 'departments';
const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'wall', label: 'جدار التقدير', icon: Heart },
  { id: 'leaderboard', label: 'المتصدرين', icon: Trophy },
  { id: 'badges', label: 'الشارات', icon: Award },
  { id: 'analysis', label: 'تحليل الحضور', icon: BarChart3 },
  { id: 'departments', label: 'الأقسام', icon: Users },
];

/* ─── Main ─── */
export default function RecognitionPage() {
  const { user } = useAuth();
  const { employees } = useEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('wall');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'attendance' | 'hours' | 'points'>('score');
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [formTo, setFormTo] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formMessage, setFormMessage] = useState('');
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

  const allScores = useMemo(() => getEmployeeScores(selectedMonth), [selectedMonth, dataLoaded]);
  const stats = useMemo(() => getOverallStats(selectedMonth), [selectedMonth, dataLoaded]);
  const deptStats = useMemo(() => getDepartmentStats(selectedMonth), [selectedMonth, dataLoaded]);
  const topEmployees = useMemo(() => getTopEmployees(30, selectedMonth), [selectedMonth, dataLoaded]);
  const active = useMemo(() => getActiveEmployees(selectedMonth), [selectedMonth, dataLoaded]);
  const badgeStats = useMemo(() => getBadgeStats(selectedMonth), [selectedMonth, dataLoaded]);

  // This interface does not invent recognition messages, reactions, or senders.
  // Recognition publishing remains unavailable until it has a protected persisted backend.
  const allRecognitions: Recognition[] = [];

  const filtered = useMemo(() => {
    let list = [...active];
    if (searchQuery) list = list.filter(e => e.name.includes(searchQuery) || e.department.includes(searchQuery));
    switch (sortBy) {
      case 'attendance': list.sort((a, b) => b.attendanceRate - a.attendanceRate); break;
      case 'hours': list.sort((a, b) => b.avgHoursPerDay - a.avgHoursPerDay); break;
      case 'points': list.sort((a, b) => b.points - a.points); break;
      default: list.sort((a, b) => b.compositeScore - a.compositeScore);
    }
    return list;
  }, [active, searchQuery, sortBy]);

  const handleSubmit = () => {
    if (!formTo || !formCategory || !formMessage.trim()) { toast.error('يرجى تعبئة جميع الحقول'); return; }
    toast.error('نشر التقدير غير متاح حتى يُربط بحفظ خادمي محمي. لم يتم إنشاء أي سجل.');
  };

  const timeAgo = (ts: number) => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'الآن'; if (m < 60) return `منذ ${m} دقيقة`;
    const h = Math.floor(m / 60); if (h < 24) return `منذ ${h} ساعة`;
    const d = Math.floor(h / 24); return d < 7 ? `منذ ${d} يوم` : `منذ ${Math.floor(d / 7)} أسبوع`;
  };

  return (
    <div className="space-y-6 pb-8" style={{ fontFamily: 'Alexandria' }}>
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-6 border border-white/5"
        style={{ background: 'hsl(var(--card))' }}>
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10" style={{ background: 'hsl(var(--primary))' }} />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'hsl(165 69% 39% / 0.15)' }}>
              <Award size={28} style={{ color: '#1FA98C' }} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white">التقدير والمكافأة</h1>
              <p className="text-xs text-gray-400 mt-1">قدّر زملاءك بناءً على أدائهم والتزامهم بالحضور • 9 صباحاً - 5 مساءً</p>
            </div>
          </div>
          <button onClick={() => setShowNewForm(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: 'hsl(var(--primary))' }}>
            <Plus size={16} /> تقدير جديد
          </button>
        </div>
      </div>

      {/* Month Selector */}
      {availableMonths.length > 0 && (
        <div className="flex items-center gap-3 justify-end">
          <Clock size={16} className="text-gray-400" />
          <span className="text-sm text-gray-400" style={{ fontFamily: 'Alexandria' }}>الشهر:</span>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-sm border border-gray-600 bg-gray-800 text-white focus:outline-none focus:ring-2"
            style={{ fontFamily: 'Alexandria', borderColor: 'hsl(165 69% 39% / 0.30)', outline: 'none' }}
          >
            {availableMonths.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}{m.hasData ? '' : ' (لا توجد بيانات)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users} label="موظفون نشطون" value={stats.activeEmployees} sub={`من ${stats.totalEmployees} إجمالي`}
          color="#1FA98C" bg="hsl(var(--primary) / 0.08)" />
        <StatCard icon={Heart} label="إجمالي التقديرات" value={allRecognitions.length} sub={`${stats.totalBadges} شارة ممنوحة`}
          color="#ef4444" bg="rgba(239,68,68,0.08)" />
        <StatCard icon={CheckCircle} label="متوسط الحضور" value={`${stats.avgAttendance}%`} sub={`${stats.avgPunctuality}% التزام بالمواعيد`}
          color="#3b82f6" bg="rgba(59,130,246,0.08)" />
        <StatCard icon={Clock} label="متوسط الساعات" value={stats.avgHours} sub="ساعة يومياً (المعيار 8)"
          color="#f59e0b" bg="rgba(245,158,11,0.08)" />
      </div>

      {/* Formula */}
      <div className="rounded-xl p-3 border border-white/5" style={{ background: 'hsl(165 69% 39% / 0.06)' }}>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={13} style={{ color: '#1FA98C' }} />
          <span className="text-[11px] font-bold text-white/80">الترتيب مبني على بيانات الحضور والانصراف الفعلية:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[{ l: 'نسبة الحضور', w: '40%', c: '#3b82f6' }, { l: 'الالتزام بالمواعيد', w: '30%', c: '#8b5cf6' },
            { l: 'الامتثال (8 ساعات+)', w: '20%', c: '#06b6d4' }, { l: 'معدل الساعات', w: '10%', c: '#f59e0b' }
          ].map(f => (
            <span key={f.l} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
              style={{ background: `${f.c}15`, color: f.c, border: `1px solid ${f.c}20` }}>
              {f.w} {f.l}
            </span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map(tab => {
          const I = tab.icon; const a = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${a ? 'text-white' : 'text-gray-400 hover:text-gray-300'}`}
              style={a ? { background: 'hsl(var(--primary))' } : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <I size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── Wall Tab ─── */}
      {activeTab === 'wall' && (
        <div className="space-y-6">
          <Podium employees={topEmployees.slice(0, 3)} />
          <div className="space-y-3">
            {allRecognitions.map(rec => {
              const cat = CATEGORIES.find(c => c.id === rec.category);
              const CatIcon = cat?.icon || Star;
              return (
                <div key={rec.id} className="rounded-xl p-4 border border-white/5 hover:border-white/10 transition-all"
                  style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${cat?.color || '#1FA98C'}15` }}>
                      <CatIcon size={18} style={{ color: cat?.color || '#1FA98C' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white">{rec.fromName}</span>
                        <span className="text-[10px] text-gray-500">قدّر</span>
                        <span className="text-xs font-bold" style={{ color: '#1FA98C' }}>{rec.toName}</span>
                        <span className="text-[10px] text-gray-500">• {rec.toDept}</span>
                      </div>
                      <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{rec.message}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                          style={{ background: `${cat?.color || '#1FA98C'}15`, color: cat?.color || '#1FA98C' }}>
                          {cat?.label} • +{rec.points} نقطة
                        </span>
                        {rec.reactions.map((r, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                            {r.emoji} {r.count}
                          </span>
                        ))}
                        <span className="text-[9px] text-gray-600 mr-auto">{timeAgo(rec.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Leaderboard Tab ─── */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" placeholder="ابحث بالاسم أو القسم..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2.5 rounded-xl text-xs text-white placeholder-gray-500 border border-white/5 outline-none"
                style={{ background: 'rgba(255,255,255,0.03)' }} />
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="px-3 py-2.5 rounded-xl text-xs text-white border border-white/5 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              <option value="score">التقييم الشامل</option>
              <option value="attendance">نسبة الحضور</option>
              <option value="hours">ساعات العمل</option>
              <option value="points">النقاط</option>
            </select>
          </div>
          <p className="text-[10px] text-gray-500">{filtered.length} موظف نشط</p>
          <div className="rounded-xl border border-white/5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.01)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'hsl(165 69% 39% / 0.08)' }}>
                    {['#', 'الموظف', 'الحضور', 'المواعيد', 'الساعات', '8 ساعات', 'النقاط', 'الشارات', 'التقييم'].map(h => (
                      <th key={h} className="p-3 text-gray-400 font-bold text-center first:text-right">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr key={emp.id} className="border-t border-white/3 hover:bg-white/[0.02] transition-colors">
                      <td className="p-3 font-black" style={{ color: emp.rank <= 3 ? '#eab308' : '#64748b' }}>{emp.rank}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={emp.name} size={30} tier={emp.tier} />
                          <div>
                            <p className="font-bold text-white text-[11px]">{emp.name}</p>
                            <p className="text-[9px] text-gray-500">{emp.department}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-center font-bold" style={{ color: emp.attendanceRate >= 80 ? '#10b981' : emp.attendanceRate >= 50 ? '#f59e0b' : '#ef4444' }}>
                        {emp.attendanceRate}%
                      </td>
                      <td className="p-3 text-center font-bold" style={{ color: emp.punctualityRate >= 90 ? '#10b981' : '#f59e0b' }}>
                        {emp.punctualityRate}%
                      </td>
                      <td className="p-3 text-center font-bold" style={{ color: emp.avgHoursPerDay >= 8 ? '#10b981' : '#f59e0b' }}>
                        {emp.avgHoursPerDay}
                      </td>
                      <td className="p-3 text-center font-bold" style={{ color: emp.complianceRate >= 90 ? '#10b981' : '#f59e0b' }}>
                        {emp.complianceRate}%
                      </td>
                      <td className="p-3 text-center font-black" style={{ color: '#1FA98C' }}>{emp.points}</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {emp.badges.slice(0, 3).map((b, j) => {
                            const BI = iconMap[b.icon] || Star;
                            return <BI key={j} size={11} style={{ color: b.color }} />;
                          })}
                          {emp.badges.length > 3 && <span className="text-[9px] text-gray-500">+{emp.badges.length - 3}</span>}
                        </div>
                      </td>
                      <td className="p-3 text-center"><ScoreRing score={emp.compositeScore} size={36} sw={3} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Badges Tab ─── */}
      {activeTab === 'badges' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">الشارات تُمنح تلقائياً بناءً على أداء الحضور والانصراف الفعلي (9ص - 5م)</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {badgeStats.map(badge => {
              const BI = iconMap[badge.icon] || Star;
              const holders = allScores.filter(e => e.badges.some(b => b.name === badge.name));
              return (
                <div key={badge.name} className="p-4 rounded-xl border border-white/5 hover:border-white/10 transition-all"
                  style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${badge.color}15` }}>
                      <BI size={22} style={{ color: badge.color }} />
                    </div>
                    <span className="text-xl font-black" style={{ color: badge.color }}>{badge.count}</span>
                  </div>
                  <p className="text-xs font-bold text-white">{badge.name}</p>
                  <p className="text-[9px] text-gray-500 mt-0.5">{badge.description}</p>
                  {holders.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {holders.slice(0, 4).map(h => (
                        <span key={h.id} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}>
                          {h.name.split(' ')[0]}
                        </span>
                      ))}
                      {holders.length > 4 && <span className="text-[9px] text-gray-500">+{holders.length - 4}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Analysis Tab ─── */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Attendance Distribution */}
            <div className="rounded-xl border border-white/5 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <CheckCircle size={14} style={{ color: '#1FA98C' }} /> توزيع نسب الحضور
              </h3>
              {[
                { r: '90-100%', c: '#10b981', n: active.filter(e => e.attendanceRate >= 90).length },
                { r: '70-89%', c: '#3b82f6', n: active.filter(e => e.attendanceRate >= 70 && e.attendanceRate < 90).length },
                { r: '50-69%', c: '#f59e0b', n: active.filter(e => e.attendanceRate >= 50 && e.attendanceRate < 70).length },
                { r: '30-49%', c: '#ef4444', n: active.filter(e => e.attendanceRate >= 30 && e.attendanceRate < 50).length },
                { r: '0-29%', c: '#64748b', n: active.filter(e => e.attendanceRate < 30).length },
              ].map(d => {
                const max = Math.max(...active.map(e => 1), active.length);
                return (
                  <div key={d.r} className="mb-3">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-gray-400">{d.r}</span>
                      <span className="font-bold" style={{ color: d.c }}>{d.n} موظف</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max((d.n / active.length) * 100, 2)}%`, background: d.c }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hours Distribution */}
            <div className="rounded-xl border border-white/5 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Clock size={14} style={{ color: '#f59e0b' }} /> توزيع ساعات العمل اليومية
              </h3>
              {[
                { r: '9+ ساعة', c: '#10b981', n: active.filter(e => e.avgHoursPerDay >= 9).length },
                { r: '8-9 ساعة', c: '#3b82f6', n: active.filter(e => e.avgHoursPerDay >= 8 && e.avgHoursPerDay < 9).length },
                { r: '7-8 ساعة', c: '#f59e0b', n: active.filter(e => e.avgHoursPerDay >= 7 && e.avgHoursPerDay < 8).length },
                { r: 'أقل من 7', c: '#ef4444', n: active.filter(e => e.avgHoursPerDay > 0 && e.avgHoursPerDay < 7).length },
              ].map(d => (
                <div key={d.r} className="mb-3">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-gray-400">{d.r}</span>
                    <span className="font-bold" style={{ color: d.c }}>{d.n} موظف</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max((d.n / active.length) * 100, 2)}%`, background: d.c }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tier Distribution */}
          <div className="rounded-xl border border-white/5 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Trophy size={14} style={{ color: '#eab308' }} /> توزيع المستويات
            </h3>
            <div className="grid grid-cols-4 gap-3">
              {[
                { t: 'ذهبي', c: '#eab308', n: stats.goldCount, icon: Crown },
                { t: 'فضي', c: 'hsl(var(--muted-foreground))', n: stats.silverCount, icon: Medal },
                { t: 'برونزي', c: '#cd7c2f', n: stats.bronzeCount, icon: Award },
                { t: 'عادي', c: '#64748b', n: stats.normalCount, icon: Star },
              ].map(d => {
                const I = d.icon;
                return (
                  <div key={d.t} className="text-center p-3 rounded-xl" style={{ background: `${d.c}08`, border: `1px solid ${d.c}20` }}>
                    <I size={20} className="mx-auto mb-1" style={{ color: d.c }} />
                    <p className="text-lg font-black" style={{ color: d.c }}>{d.n}</p>
                    <p className="text-[10px] text-gray-500">{d.t}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Department Comparison */}
          <div className="rounded-xl border border-white/5 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <BarChart3 size={14} style={{ color: '#8b5cf6' }} /> مقارنة الأقسام
            </h3>
            {deptStats.map(dept => (
              <div key={dept.name} className="mb-3">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-gray-300 font-bold">{dept.name}</span>
                  <span className="text-gray-400">{dept.employeeCount} موظف • {dept.avgScore}%</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${dept.avgScore}%`, background: dept.avgScore >= 60 ? '#1FA98C' : dept.avgScore >= 40 ? '#f59e0b' : '#ef4444' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Departments Tab ─── */}
      {activeTab === 'departments' && (
        <div className="space-y-3">
          {deptStats.map(dept => {
            const isExp = expandedDept === dept.name;
            const deptEmps = allScores.filter(e => e.department === dept.name).sort((a, b) => b.compositeScore - a.compositeScore);
            return (
              <div key={dept.name} className="rounded-xl border border-white/5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <button onClick={() => setExpandedDept(isExp ? null : dept.name)}
                  className="w-full flex items-center gap-4 p-4 text-right hover:bg-white/[0.02] transition-all">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'hsl(165 69% 39% / 0.10)' }}>
                    <Users size={18} style={{ color: '#1FA98C' }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">{dept.name}</p>
                    <p className="text-[10px] text-gray-500">{dept.employeeCount} موظف • حضور {dept.avgAttendance}% • {dept.avgHours} ساعة</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <ScoreRing score={dept.avgScore} size={40} sw={3} />
                    {isExp ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </button>
                {isExp && (
                  <div className="border-t border-white/5 p-3 space-y-2">
                    {deptEmps.map(emp => (
                      <div key={emp.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.02]">
                        <span className="text-[10px] font-bold w-5 text-center" style={{ color: '#64748b' }}>{emp.rank}</span>
                        <Avatar name={emp.name} size={28} tier={emp.tier} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-white truncate">{emp.name}</p>
                          <p className="text-[9px] text-gray-500">{emp.jobTitle}</p>
                        </div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span style={{ color: '#3b82f6' }}>{emp.attendanceRate}%</span>
                          <span style={{ color: '#f59e0b' }}>{emp.avgHoursPerDay}h</span>
                          <span className="font-bold" style={{ color: '#1FA98C' }}>{emp.points}pt</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── New Recognition Modal ─── */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-2xl p-6 w-full max-w-lg mx-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-black" style={{ color: '#1FA98C' }}>تقدير جديد</h3>
              <button onClick={() => setShowNewForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">اختر الموظف</label>
              <select value={formTo} onChange={e => setFormTo(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-xs text-white outline-none"
                style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                <option value="">اختر موظفاً...</option>
                {employees.map(emp => <option key={emp.employeeId} value={emp.employeeId}>{emp.nameAr} - {emp.department}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">فئة التقدير</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(cat => {
                  const CI = cat.icon;
                  return (
                    <button key={cat.id} onClick={() => setFormCategory(cat.id)}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg transition-all text-center"
                      style={{ background: formCategory === cat.id ? `${cat.color}20` : 'hsl(var(--muted))',
                        border: `1px solid ${formCategory === cat.id ? cat.color : 'hsl(var(--border))'}` }}>
                      <CI size={14} style={{ color: cat.color }} />
                      <span className="text-[10px]" style={{ color: formCategory === cat.id ? cat.color : 'hsl(var(--muted-foreground))' }}>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">رسالة التقدير</label>
              <textarea value={formMessage} onChange={e => setFormMessage(e.target.value)} placeholder="اكتب رسالة تقدير لزميلك..."
                rows={3} className="w-full px-3 py-2.5 rounded-lg text-xs text-white outline-none resize-none"
                style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', lineHeight: 1.7 }} />
            </div>
            <button onClick={handleSubmit} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: 'hsl(var(--primary))' }}>
              <Send size={14} style={{ transform: 'rotate(180deg)' }} /> إرسال التقدير
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
