/**
 * EmployeeProfileModal
 * Design: Dark theme, teal accent (#1FA98C), Alexandria/Cairo font, RTL
 * A rich, professional employee profile modal with all mastersheet fields,
 * organized into tabbed sections: Overview, Contract, Experience.
 */
import DetailPanel from '@/components/experience/DetailPanel';
import {ErrorState,LoadingState} from '@/components/feedback/AsyncState';
import { useState, useEffect, useRef } from "react";
import {
  X, User, Briefcase, GraduationCap, FileText, Shield,
  Calendar, Clock, Building2, BadgeCheck, Heart, Globe,
  Phone, Hash, Award, ChevronRight, ShieldOff, Edit2
} from "lucide-react";
import { toast } from "sonner";
import type { Employee } from "@/contexts/EmployeeContext";
import { calculateCompanyExperience, combineExperience, formatExperienceArabic, parseExperienceDuration } from "@/lib/experience";

interface EmployeeProfileModalProps {
  employee: Employee | null;
  onClose: () => void;
}

const DEPT_COLORS: Record<string, string> = {
  "الإنتاج": "#1FA98C",
  "التسويق الرقمي": "#3B82F6",
  "العلاقات العامة": "#8B5CF6",
  "الإبداعي": "#F59E0B",
  "الأعمال": "#EF4444",
  "رأس المال البشري": "#10B981",
  "التسويق": "#EC4899",
  "التنفيذي": "#6366F1",
  "الرئيس التنفيذي": "#F97316",
};

function getDeptColor(dept: string): string {
  return DEPT_COLORS[dept] || "#1FA98C";
}

/**
 * Converts English experience strings like "1 Year and 4 Months" or "7 Years"
 * into proper Arabic: "سنة و4 أشهر" or "7 سنوات"
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return parts[0].charAt(0) + parts[1].charAt(0);
  return parts[0].charAt(0);
}

function InfoCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType;
  label: string;
  value: string | number | null | undefined;
  accent?: string;
}) {
  return <div className="athar-info-card"><Icon size={17} aria-hidden="true"/><div><small>{label}</small><strong>{value === '' || value == null ? '—' : value}</strong></div></div>;
}

type Tab = "overview" | "contract" | "experience" | "benefits";

interface BenefitStatus {
  id: string;
  employeeId: string;
  benefitId: string;
  status: string;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: number;
}

const BENEFITS_LIST = [
  { id: 'parents_insurance', label: 'تأمين الوالدين', labelEn: 'Parents Insurance', icon: '❤️' },
  { id: 'children_education', label: 'دراسة الأبناء', labelEn: 'Children Education', icon: '🎓' },
  { id: 'health_clubs', label: 'الأندية الصحية', labelEn: 'Health Clubs', icon: '💪' },
];

export default function EmployeeProfileModal({ employee, onClose }: EmployeeProfileModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const benefitRequest=useRef<AbortController|null>(null);
  const [benefitFetching,setBenefitFetching]=useState(false);
  const [isExempt, setIsExempt] = useState(false);
  const [benefitStatuses, setBenefitStatuses] = useState<BenefitStatus[]>([]);
  const [benefitLoading, setBenefitLoading] = useState(false);
  const [benefitError,setBenefitError]=useState(false);

  const fetchBenefits = (empId:string) => {
    benefitRequest.current?.abort();const controller=new AbortController();benefitRequest.current=controller;
    setBenefitFetching(true);setBenefitError(false);
    fetch(`/api/services/benefits?employeeId=${encodeURIComponent(empId)}`,{credentials:'include',signal:controller.signal})
      .then(r=>{if(!r.ok)throw Error();return r.json()})
      .then(data=>{if(!Array.isArray(data))throw Error();if(!controller.signal.aborted)setBenefitStatuses(data)})
      .catch(()=>{if(!controller.signal.aborted)setBenefitError(true)})
      .finally(()=>{if(!controller.signal.aborted)setBenefitFetching(false)});
  };

  const toggleBenefitStatus = async (benefitId: string, currentStatus: string) => {
    if (!employee) return;
    setBenefitLoading(true);
    const newStatus = currentStatus === 'used' ? 'not_used' : 'used';
    try {
      const res = await fetch('/api/services/benefits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employeeId: employee.employeeId,
          benefitId,
          status: newStatus,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      if (res.ok) {
        fetchBenefits(employee.employeeId);
        toast.success(newStatus === 'used' ? 'تم تحديث الحالة: استفاد' : 'تم تحديث الحالة: لم يستفد');
      }
    } catch (e) {
      toast.error('حدث خطأ في تحديث الحالة');
    }
    setBenefitLoading(false);
  };

  useEffect(() => {
    let active=true;
    if (employee) {
      setActiveTab("overview");
      setBenefitStatuses([]);setIsExempt(false);
      // Check if this employee is exempt from geo-fencing
      fetch('/api/attendance/exemptions', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then((data: Array<{employeeId?: string; employee_id?: string}>) => {
          if (active && Array.isArray(data)) {
            setIsExempt(data.some(e => String(e.employeeId || e.employee_id || '') === String(employee.employeeId)));
          }
        })
        .catch(() => {});
      // Fetch benefit statuses
      fetchBenefits(employee.employeeId);
    } else {

      setIsExempt(false);
      setBenefitStatuses([]);
    }
    return()=>{active=false;benefitRequest.current?.abort()};
  }, [employee]);

  if (!employee) return null;

  const deptColor = getDeptColor(employee.department);
  const initials = getInitials(employee.nameAr);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "نظرة عامة", icon: User },
    { id: "contract", label: "العقد", icon: FileText },
    { id: "experience", label: "الخبرة", icon: Award },
    { id: "benefits", label: "المزايا", icon: Heart },
  ];

  return (
    <DetailPanel returnFocusLabel={`فتح ملف ${employee.nameAr}`} open={!!employee} onClose={onClose} title={`ملف ${employee.nameAr}`} side className="athar-profile">
      <header className="athar-profile-header"><div className="athar-profile-header__identity"><div className="athar-profile-header__avatar" aria-hidden="true">{initials}</div><div><h2>{employee.nameAr}</h2><p>{employee.jobTitle}</p></div></div><div className="athar-profile-meta"><span>{employee.department}</span><span>الرقم الوظيفي <bdi>{employee.employeeId}</bdi></span>{isExempt&&<span>مستثنى من البصمة</span>}</div></header>
        {/* ── Tabs ── */}
        <div className="athar-profile-tabs" style={{
          display: 'flex', borderBottom: '1px solid hsl(var(--border))',
          background: 'hsl(var(--card))', direction: 'rtl',
          padding: '0 20px',
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)} aria-pressed={activeTab === tab.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                color: activeTab === tab.id ? '#1FA98C' : 'hsl(var(--muted-foreground))',
                borderBottom: activeTab === tab.id ? '2px solid #1FA98C' : '2px solid transparent',
                marginBottom: '-1px',
                transition: 'background-color 150ms ease, color 150ms ease',
              }}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ overflowY: 'auto', minHeight: 0, padding: '20px 24px', flex: 1, direction: 'rtl' }}>

          {/* ─ Overview Tab ─ */}
          {activeTab === "overview" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginBottom: '4px' }}>
                البيانات الشخصية
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px' }}>
                <InfoCard icon={Hash} label="الرقم الوظيفي" value={employee.employeeId} accent="#1FA98C" />
                <InfoCard icon={Globe} label="الجنسية" value={employee.nationality === 'المملكة العربية السعودية' ? '🇸🇦 سعودي/ة' : employee.nationality} />
                <InfoCard icon={Calendar} label="تاريخ الميلاد" value={employee.birthDate} />
                <InfoCard icon={User} label="العمر" value={employee.age ? `${employee.age} سنة` : null} />
                <InfoCard icon={Heart} label="الحالة الاجتماعية" value={employee.maritalStatus} />
                <InfoCard icon={BadgeCheck} label="رقم الهوية الوطنية" value={employee.nationalId} />
              </div>

              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginTop: '8px', marginBottom: '4px' }}>
                بيانات العمل
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px' }}>
                <InfoCard icon={Building2} label="الإدارة" value={employee.department} accent={deptColor} />
                <InfoCard icon={Briefcase} label="المسمى الوظيفي" value={employee.jobTitle} />
                <InfoCard icon={GraduationCap} label="المستوى التعليمي" value={employee.education} accent="#8B5CF6" />
                <InfoCard icon={Award} label="التخصص" value={employee.specialization} />
                <InfoCard icon={Shield} label="التأمين الصحي" value={employee.insurance} accent="#10B981" />
              </div>
            </div>
          )}

          {/* ─ Contract Tab ─ */}
          {activeTab === "contract" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginBottom: '4px' }}>
                تفاصيل العقد
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px' }}>
                <InfoCard icon={Calendar} label="تاريخ بداية العقد" value={employee.contractStart} accent="#1FA98C" />
                <InfoCard icon={Calendar} label="تاريخ نهاية العقد" value={employee.contractEnd} accent="#F59E0B" />
              </div>

              {/* Contract timeline */}
              {employee.contractStart && employee.contractEnd && (() => {
                const start = new Date(employee.contractStart);
                const end = new Date(employee.contractEnd.includes('/') ? employee.contractEnd.split('/').reverse().join('-') : employee.contractEnd);
                const now = new Date();
                const total = end.getTime() - start.getTime();
                const elapsed = Math.min(now.getTime() - start.getTime(), total);
                const pct = total > 0 ? Math.max(0, Math.min(100, (elapsed / total) * 100)) : 0;
                const remaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
                const isActive = now >= start && now <= end;
                const isExpired = now > end;
                return (
                  <div style={{
                    background: 'hsl(var(--muted))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px', padding: '16px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', direction: 'rtl' }}>
                      <span style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>مدة العقد</span>
                      <span style={{
                        fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700,
                        padding: '2px 10px', borderRadius: '20px',
                        background: isExpired ? 'rgba(239,68,68,0.12)' : isActive ? 'hsl(165 69% 39% / 0.12)' : 'rgba(245,158,11,0.12)',
                        color: isExpired ? '#EF4444' : isActive ? '#1FA98C' : '#F59E0B',
                        border: `1px solid ${isExpired ? 'rgba(239,68,68,0.25)' : isActive ? 'hsl(165 69% 39% / 0.25)' : 'rgba(245,158,11,0.25)'}`,
                      }}>
                        {isExpired ? 'منتهي' : isActive ? 'ساري' : 'مجدول'}
                      </span>
                    </div>
                    <div style={{ height: '6px', background: 'hsl(var(--border))', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                      <div style={{
                        height: '100%', borderRadius: '3px',
                        width: `${pct}%`,
                        background: isExpired ? '#EF4444' : 'hsl(var(--primary))',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', direction: 'rtl' }}>
                      <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))' }}>{Math.round(pct)}% مكتمل</span>
                      {!isExpired && (
                        <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: '#F59E0B', fontWeight: 600 }}>
                          {remaining} يوم متبقي
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginTop: '8px', marginBottom: '4px' }}>
                بيانات إضافية
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px' }}>
                <InfoCard icon={Shield} label="التأمين الصحي" value={employee.insurance} accent="#10B981" />
                <InfoCard icon={Building2} label="الإدارة" value={employee.department} accent={deptColor} />
              </div>
            </div>
          )}

          {/* ─ Experience Tab ─ */}
          {activeTab === "experience" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginBottom: '4px' }}>
                الخبرة المهنية
              </div>

              {/* Experience cards */}
              {[
                { label: "الخبرة في 3.6T", value: formatExperienceArabic(calculateCompanyExperience(employee.contractStart)), color: "#1FA98C", icon: Building2 },
                { label: "الخبرة السابقة", value: formatExperienceArabic(parseExperienceDuration(employee.experienceBefore)), color: "#3B82F6", icon: Briefcase },
                { label: "إجمالي الخبرة", value: formatExperienceArabic(combineExperience(calculateCompanyExperience(employee.contractStart), parseExperienceDuration(employee.experienceBefore))), color: "#8B5CF6", icon: Clock },
              ].map(item => (
                <div key={item.label} style={{
                  background: 'hsl(var(--muted))',
                  border: `1px solid ${item.color}30`,
                  borderRight: `3px solid ${item.color}`,
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  direction: 'rtl',
                }}>
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                    background: `${item.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <item.icon size={17} color={item.color} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))', marginBottom: '3px' }}>{item.label}</div>
                    <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: item.color }}>{item.value || '—'}</div>
                  </div>
                </div>
              ))}

              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginTop: '8px', marginBottom: '4px' }}>
                التعليم
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px' }}>
                <InfoCard icon={GraduationCap} label="المستوى التعليمي" value={employee.education} accent="#8B5CF6" />
                <InfoCard icon={Award} label="التخصص" value={employee.specialization} />
              </div>
            </div>
          )}

          {/* ─ Benefits Tab ─ */}
          {activeTab === "benefits" && benefitFetching && <LoadingState title="جارٍ تحميل المزايا"/>}
          {activeTab === "benefits" && benefitError && <ErrorState title="تعذّر تحميل المزايا" onRetry={()=>fetchBenefits(employee.employeeId)}/>}
          {activeTab === "benefits" && !benefitError && !benefitFetching && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: 0, marginBottom: '4px' }}>
                إدارة حالة المزايا
              </div>
              <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', margin: '0 0 8px 0' }}>
                يمكنك تغيير حالة استفادة الموظف من كل ميزة بالضغط على الزر
              </p>
              {BENEFITS_LIST.map(benefit => {
                const found = benefitStatuses.find(b => b.benefitId === benefit.id);
                const isUsed = found?.status === 'used';
                return (
                  <div key={benefit.id} style={{
                    background: isUsed ? 'hsl(165 60% 20% / 0.15)' : 'hsl(var(--muted))',
                    border: isUsed ? '1px solid hsl(165 69% 39% / 0.4)' : '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    direction: 'rtl',
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '24px' }}>{benefit.icon}</span>
                      <div>
                        <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(var(--foreground))' }}>{benefit.label}</div>
                        <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(var(--muted-foreground))', marginTop: '2px' }}>
                          {isUsed ? `✅ استفاد — بواسطة: ${found?.updatedBy || 'HR'}` : '⚪ لم يستفد بعد'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleBenefitStatus(benefit.id, isUsed ? 'used' : 'not_used')}
                      disabled={benefitLoading}
                      style={{
                        fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700,
                        padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
                        border: 'none', transition: 'background-color 150ms ease, color 150ms ease',
                        background: isUsed ? 'hsl(0 70% 50% / 0.2)' : 'hsl(165 69% 39% / 0.2)',
                        color: isUsed ? '#ef4444' : '#1FA98C',
                        opacity: benefitLoading ? 0.5 : 1,
                      }}
                    >
                      {isUsed ? 'إلغاء الاستفادة' : 'تأكيد الاستفادة'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      <footer className="flex items-center justify-between gap-3 border-t px-6 py-4 text-xs text-muted-foreground"><span>البيانات المتاحة ضمن صلاحيتك</span><button type="button" className="btn-secondary" onClick={onClose}>إغلاق الملف</button></footer>
    </DetailPanel>
  );
}
