/**
 * Analytics - HR Analytics & Reports
 * Real data from EmployeeContext with RBAC
 */
import { useState, useMemo } from "react";
import { PieChartIcon as PieChartIcon, Inbox, Download, Brain } from "lucide-react";
import { AdvancedAnalyticsContent } from "./AdvancedAnalytics";
import PageTemplate from "@/components/layout/PageTemplate";
import { useEmployees } from "@/contexts/EmployeeContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { exportEmployees } from "@/lib/excelExport";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const peoplePrimary = "hsl(var(--primary))";
const COLORS = [peoplePrimary,"hsl(var(--accent))","#F59E0B","#8B5CF6","#3B82F6","#EF4444","#10B981","#F97316","#EC4899","#06B6D4","#84CC16","#A855F7"];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', padding: '8px 12px', fontFamily: 'Alexandria' }}>
        <p style={{ color: peoplePrimary, fontSize: '12px', fontWeight: 600 }}>{payload[0]?.name}: {payload[0]?.value}</p>
      </div>
    );
  }
  return null;
};

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Inbox size={28} color="#EF4444" />
      </div>
      <p style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '16px', color: 'hsl(0 0% 75%)' }}>لا تملك صلاحية عرض التقارير</p>
      <p style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(0 0% 45%)' }}>يمكن لمدير النظام ومديري الإدارات فقط الاطلاع على التحليلات</p>
    </div>
  );
}

export default function Analytics() {
  const [mainTab, setMainTab] = useState<"basic" | "advanced">("basic");
  const { employees, getDeptStats, canSeeData } = useEmployees();

  const deptStats = useMemo(() => getDeptStats(), [employees]);

  const genderStats = useMemo(() => [
    { name: 'ذكور', value: employees.filter(e => e.gender === 'ذكر').length },
    { name: 'إناث', value: employees.filter(e => e.gender === 'انثى').length },
  ], [employees]);

  const educationStats = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => { if (e.education) map[e.education] = (map[e.education] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [employees]);

  const ageGroups = useMemo(() => {
    const groups: Record<string, number> = { "أقل من 25": 0, "25-30": 0, "31-35": 0, "36-40": 0, "41-45": 0, "أكثر من 45": 0 };
    employees.forEach(e => {
      const age = e.age || 0;
      if (age < 25) groups["أقل من 25"]++;
      else if (age <= 30) groups["25-30"]++;
      else if (age <= 35) groups["31-35"]++;
      else if (age <= 40) groups["36-40"]++;
      else if (age <= 45) groups["41-45"]++;
      else groups["أكثر من 45"]++;
    });
    return Object.entries(groups).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const nationalityStats = useMemo(() => {
    const saudiCount = employees.filter(e => e.nationality === 'المملكة العربية السعودية').length;
    const nonSaudiCount = employees.length - saudiCount;
    return [
      { name: 'سعودي', value: saudiCount },
      { name: 'غير سعودي', value: nonSaudiCount },
    ];
  }, [employees]);

  const maritalStats = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => { if (e.maritalStatus) map[e.maritalStatus] = (map[e.maritalStatus] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [employees]);

  const avgAge = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + (e.age || 0), 0) / employees.length) : 0;
  const saudiCount = employees.filter(e => e.nationality === 'المملكة العربية السعودية').length;

  return (
    <PageTemplate
      title="التقارير والتحليلات"
      subtitle="تحليلات شاملة لبيانات رأس المال البشري"
      icon={PieChartIcon}
      stats={[
        { label: "إجمالي الموظفين", value: canSeeData ? employees.length.toString() : "—", color: peoplePrimary },
        { label: "الإدارات", value: canSeeData ? deptStats.length.toString() : "—", color: "hsl(var(--accent))" },
        { label: "سعوديون", value: canSeeData ? saudiCount.toString() : "—", color: "#F59E0B" },
        { label: "متوسط العمر", value: canSeeData && avgAge > 0 ? `${avgAge} سنة` : "—", color: "#8B5CF6" },
      ]}
      actions={
        canSeeData ? (
          <button className="btn-brand flex items-center gap-2" onClick={() => { exportEmployees(employees); toast.success('جارٍ تحميل ملف Excel...'); }}>
            <Download size={14} /><span>تصدير Excel</span>
          </button>
        ) : undefined
      }
    >
      {/* Main Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg w-fit mb-5" style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
        {[{ key: "basic", label: "تحليلات أساسية" }, { key: "advanced", label: "تحليلات متقدمة (AI)" }].map(tab => (
          <button key={tab.key} onClick={() => setMainTab(tab.key as any)}
            className="px-4 py-2 rounded-md text-sm font-semibold transition-all"
            style={{ fontFamily: 'Alexandria', background: mainTab === tab.key ? peoplePrimary : 'transparent', color: mainTab === tab.key ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "advanced" && <AdvancedAnalyticsContent />}

      {mainTab === "basic" && !canSeeData ? (
        <AccessDenied />
      ) : (
        <div className="space-y-5">
          {/* Row 1: Dept bar + Gender pie */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-brand rounded-xl p-5 lg:col-span-2">
              <div className="section-title">توزيع الموظفين حسب الإدارة</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={deptStats} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(0 0% 55%)' }} />
                  <YAxis tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(0 0% 55%)' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="الموظفون" radius={[4, 4, 0, 0]}>
                    {deptStats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card-brand rounded-xl p-5">
              <div className="section-title">التوزيع حسب الجنس</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={genderStats} cx="50%" cy="50%" outerRadius={65} dataKey="value" nameKey="name">
                    <Cell fill={peoplePrimary} />
                    <Cell fill="#F59E0B" />
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {genderStats.map((g, i) => (
                  <div key={g.name} className="flex items-center gap-1.5">
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: i === 0 ? peoplePrimary : '#F59E0B' }} />
                    <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 65%)' }}>{g.name}: {g.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Education + Age groups */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-brand rounded-xl p-5">
              <div className="section-title">التوزيع حسب المستوى التعليمي</div>
              <div className="space-y-3 mt-3">
                {educationStats.map((edu, i) => (
                  <div key={edu.name} className="flex items-center gap-3">
                    <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 65%)', minWidth: '80px' }}>{edu.name}</span>
                    <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: 'hsl(0 0% 22%)' }}>
                      <div style={{
                        height: '100%', borderRadius: '999px',
                        background: COLORS[i % COLORS.length],
                        width: `${(edu.value / employees.length) * 100}%`,
                        transition: 'width 0.8s ease',
                        display: 'flex', alignItems: 'center', paddingRight: '8px',
                      }}>
                        <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'white', fontWeight: 700 }}>{edu.value}</span>
                      </div>
                    </div>
                    <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 50%)', minWidth: '35px' }}>
                      {Math.round((edu.value / employees.length) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-brand rounded-xl p-5">
              <div className="section-title">التوزيع حسب الفئة العمرية</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ageGroups} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(0 0% 55%)' }} />
                  <YAxis tick={{ fontFamily: 'Alexandria', fontSize: 10, fill: 'hsl(0 0% 55%)' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="الموظفون" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 3: Nationality + Marital */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-brand rounded-xl p-5">
              <div className="section-title">التوزيع حسب الجنسية</div>
              <div className="flex items-center justify-center gap-8 py-4">
                {nationalityStats.map((n, i) => (
                  <div key={n.name} className="flex flex-col items-center gap-2">
                    <div style={{
                      width: '70px', height: '70px', borderRadius: '50%',
                      border: `4px solid ${COLORS[i]}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: `${COLORS[i]}15`,
                    }}>
                      <span style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '18px', color: COLORS[i] }}>{n.value}</span>
                    </div>
                    <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 65%)' }}>{n.name}</span>
                    <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 50%)' }}>
                      {employees.length > 0 ? Math.round((n.value / employees.length) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-brand rounded-xl p-5">
              <div className="section-title">التوزيع حسب الحالة الاجتماعية</div>
              <div className="space-y-3 mt-3">
                {maritalStats.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-3">
                    <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 65%)', minWidth: '90px' }}>{m.name}</span>
                    <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: 'hsl(0 0% 22%)' }}>
                      <div style={{
                        height: '100%', borderRadius: '999px',
                        background: COLORS[(i + 3) % COLORS.length],
                        width: `${(m.value / employees.length) * 100}%`,
                        transition: 'width 0.8s ease',
                        display: 'flex', alignItems: 'center', paddingRight: '8px',
                      }}>
                        <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'white', fontWeight: 700 }}>{m.value}</span>
                      </div>
                    </div>
                    <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 50%)', minWidth: '35px' }}>
                      {Math.round((m.value / employees.length) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Dept detail table */}
          <div className="card-brand rounded-xl overflow-hidden">
            <div className="p-4" style={{ borderBottom: '1px solid hsl(0 0% 26%)' }}>
              <div className="section-title" style={{ marginBottom: 0 }}>تفاصيل الإدارات</div>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الإدارة</th>
                    <th>عدد الموظفين</th>
                    <th>النسبة</th>
                    <th>ذكور</th>
                    <th>إناث</th>
                  </tr>
                </thead>
                <tbody>
                  {deptStats.map((dept, i) => {
                    const deptEmps = employees.filter(e => e.departmentEn === dept.nameEn || (dept.nameEn === 'P.R. Dep.' && e.departmentEn === 'P.R Dep.'));
                    const males = deptEmps.filter(e => e.gender === 'ذكر').length;
                    const females = deptEmps.filter(e => e.gender === 'انثى').length;
                    return (
                      <tr key={dept.nameEn}>
                        <td style={{ color: 'hsl(0 0% 45%)', fontSize: '11px' }}>{i + 1}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                            <span style={{ fontFamily: 'Alexandria', fontWeight: 600, fontSize: '13px', color: 'hsl(0 0% 88%)' }}>{dept.name}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: COLORS[i % COLORS.length] }}>{dept.count}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'hsl(0 0% 22%)', maxWidth: '80px' }}>
                              <div style={{ height: '100%', borderRadius: '999px', background: COLORS[i % COLORS.length], width: `${(dept.count / employees.length) * 100}%` }} />
                            </div>
                            <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 60%)' }}>{Math.round((dept.count / employees.length) * 100)}%</span>
                          </div>
                        </td>
                        <td style={{ fontFamily: 'Alexandria', fontSize: '12px', color: peoplePrimary, fontWeight: 600 }}>{males}</td>
                        <td style={{ fontFamily: 'Alexandria', fontSize: '12px', color: '#F59E0B', fontWeight: 600 }}>{females}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </PageTemplate>
  );
}
