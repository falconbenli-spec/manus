/**
 * EmployeeProfileModal
 * Design: Dark theme, teal accent (#1FA98C), Alexandria/Cairo font, RTL
 * A rich, professional employee profile modal with all mastersheet fields,
 * organized into tabbed sections: Overview, Contract, Experience.
 */
import { useState, useEffect } from "react";
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
  return (
    <div style={{
      background: 'hsl(0 0% 22%)',
      border: '1px solid hsl(0 0% 26%)',
      borderRadius: '10px',
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
    }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
        background: `${accent || '#1FA98C'}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} color={accent || '#1FA98C'} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 48%)', marginBottom: '2px' }}>{label}</div>
        <div style={{
          fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px',
          color: accent ? accent : 'hsl(0 0% 88%)',
          wordBreak: 'break-word',
        }}>
          {value || '—'}
        </div>
      </div>
    </div>
  );
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
  const [visible, setVisible] = useState(false);
  const [isExempt, setIsExempt] = useState(false);
  const [benefitStatuses, setBenefitStatuses] = useState<BenefitStatus[]>([]);
  const [benefitLoading, setBenefitLoading] = useState(false);

  const fetchBenefits = (empId: string) => {
    fetch(`/api/services/benefits?employeeId=${empId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: BenefitStatus[] | any) => {
        if (Array.isArray(data)) setBenefitStatuses(data);
        else if (data && Array.isArray(data)) setBenefitStatuses(data);
      })
      .catch(() => {});
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
    if (employee) {
      setActiveTab("overview");
      requestAnimationFrame(() => setVisible(true));
      // Check if this employee is exempt from geo-fencing
      fetch('/api/attendance/exemptions', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then((data: Array<{employeeId?: string; employee_id?: string}>) => {
          if (Array.isArray(data)) {
            setIsExempt(data.some(e => String(e.employeeId || e.employee_id || '') === String(employee.employeeId)));
          }
        })
        .catch(() => {});
      // Fetch benefit statuses
      fetchBenefits(employee.employeeId);
    } else {
      setVisible(false);
      setIsExempt(false);
      setBenefitStatuses([]);
    }
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
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'hsl(var(--background) / 0.94)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: '640px',
          background: 'hsl(0 0% 18%)',
          border: '1px solid hsl(0 0% 24%)',
          borderRadius: '16px',
          overflow: 'hidden',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
          transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header Banner ── */}
        <div style={{
          background: 'hsl(var(--card))',
          borderBottom: `1px solid ${deptColor}30`,
          padding: '24px 24px 20px',
          position: 'relative',
        }}>
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: '16px', left: '16px',
              width: '30px', height: '30px', borderRadius: '8px',
              background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 28%)',
              color: 'hsl(0 0% 60%)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 0% 26%)'; (e.currentTarget as HTMLElement).style.color = 'hsl(0 0% 88%)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 0% 26%)'; (e.currentTarget as HTMLElement).style.color = 'hsl(0 0% 60%)'; }}
          >
            <X size={14} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', direction: 'rtl' }}>
            {/* Avatar */}
            <div style={{
              width: '68px', height: '68px', borderRadius: '50%', flexShrink: 0,
              background: deptColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Alexandria', fontWeight: 800, fontSize: '22px', color: 'white',
              boxShadow: `0 0 0 3px ${deptColor}30, 0 0 0 6px ${deptColor}15`,
            }}>
              {initials}
            </div>

            {/* Name + title */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2 style={{
                  fontFamily: 'Alexandria', fontWeight: 800, fontSize: '18px',
                  color: 'hsl(0 0% 96%)', margin: 0, lineHeight: 1.3,
                }}>
                  {employee.nameAr}
                </h2>
                {isExempt && (
                  <span
                    title="مستثنى من البصمة الجغرافية"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      background: 'rgba(139,92,246,0.15)', color: '#8B5CF6',
                      border: '1px solid rgba(139,92,246,0.35)',
                      borderRadius: '20px', padding: '2px 10px',
                      fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700,
                      cursor: 'default',
                    }}
                  >
                    <ShieldOff size={11} />
                    <span>مستثنى من البصمة</span>
                  </span>
                )}
              </div>
              <p style={{
                fontFamily: 'Alexandria', fontSize: '12px', color: deptColor,
                fontWeight: 600, margin: '4px 0 6px',
              }}>
                {employee.jobTitle}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700,
                  background: `${deptColor}20`, color: deptColor,
                  padding: '2px 10px', borderRadius: '20px',
                  border: `1px solid ${deptColor}40`,
                }}>
                  {employee.department}
                </span>
                <span style={{
                  fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700,
                  background: 'hsl(165 69% 39% / 0.12)', color: '#1FA98C',
                  padding: '2px 10px', borderRadius: '20px',
                  border: '1px solid hsl(165 69% 39% / 0.25)',
                }}>
                  #{employee.employeeId}
                </span>
                {employee.gender && (
                  <span style={{
                    fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700,
                    background: employee.gender === 'ذكر' ? 'rgba(59,130,246,0.12)' : 'rgba(236,72,153,0.12)',
                    color: employee.gender === 'ذكر' ? '#3B82F6' : '#EC4899',
                    padding: '2px 10px', borderRadius: '20px',
                    border: `1px solid ${employee.gender === 'ذكر' ? 'rgba(59,130,246,0.25)' : 'rgba(236,72,153,0.25)'}`,
                  }}>
                    {employee.gender}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: 'flex', borderBottom: '1px solid hsl(0 0% 26%)',
          background: 'hsl(0 0% 18%)', direction: 'rtl',
          padding: '0 20px',
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                color: activeTab === tab.id ? '#1FA98C' : 'hsl(0 0% 50%)',
                borderBottom: activeTab === tab.id ? '2px solid #1FA98C' : '2px solid transparent',
                marginBottom: '-1px',
                transition: 'all 0.15s',
              }}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1, direction: 'rtl' }}>

          {/* ─ Overview Tab ─ */}
          {activeTab === "overview" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                البيانات الشخصية
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <InfoCard icon={Hash} label="الرقم الوظيفي" value={employee.employeeId} accent="#1FA98C" />
                <InfoCard icon={Globe} label="الجنسية" value={employee.nationality === 'المملكة العربية السعودية' ? '🇸🇦 سعودي/ة' : employee.nationality} />
                <InfoCard icon={Calendar} label="تاريخ الميلاد" value={employee.birthDate} />
                <InfoCard icon={User} label="العمر" value={employee.age ? `${employee.age} سنة` : null} />
                <InfoCard icon={Heart} label="الحالة الاجتماعية" value={employee.maritalStatus} />
                <InfoCard icon={BadgeCheck} label="رقم الهوية الوطنية" value={employee.nationalId} />
              </div>

              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '8px', marginBottom: '4px' }}>
                بيانات العمل
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                تفاصيل العقد
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
                    background: 'hsl(0 0% 22%)',
                    border: '1px solid hsl(0 0% 26%)',
                    borderRadius: '12px', padding: '16px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', direction: 'rtl' }}>
                      <span style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 65%)' }}>مدة العقد</span>
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
                    <div style={{ height: '6px', background: 'hsl(0 0% 26%)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                      <div style={{
                        height: '100%', borderRadius: '3px',
                        width: `${pct}%`,
                        background: isExpired ? '#EF4444' : 'hsl(var(--primary))',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', direction: 'rtl' }}>
                      <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 45%)' }}>{Math.round(pct)}% مكتمل</span>
                      {!isExpired && (
                        <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: '#F59E0B', fontWeight: 600 }}>
                          {remaining} يوم متبقي
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '8px', marginBottom: '4px' }}>
                بيانات إضافية
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <InfoCard icon={Shield} label="التأمين الصحي" value={employee.insurance} accent="#10B981" />
                <InfoCard icon={Building2} label="الإدارة" value={employee.department} accent={deptColor} />
              </div>
            </div>
          )}

          {/* ─ Experience Tab ─ */}
          {activeTab === "experience" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                الخبرة المهنية
              </div>

              {/* Experience cards */}
              {[
                { label: "الخبرة في 3.6T", value: formatExperienceArabic(calculateCompanyExperience(employee.contractStart)), color: "#1FA98C", icon: Building2 },
                { label: "الخبرة السابقة", value: formatExperienceArabic(parseExperienceDuration(employee.experienceBefore)), color: "#3B82F6", icon: Briefcase },
                { label: "إجمالي الخبرة", value: formatExperienceArabic(combineExperience(calculateCompanyExperience(employee.contractStart), parseExperienceDuration(employee.experienceBefore))), color: "#8B5CF6", icon: Clock },
              ].map(item => (
                <div key={item.label} style={{
                  background: 'hsl(0 0% 22%)',
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
                    <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 48%)', marginBottom: '3px' }}>{item.label}</div>
                    <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: item.color }}>{item.value || '—'}</div>
                  </div>
                </div>
              ))}

              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '8px', marginBottom: '4px' }}>
                التعليم
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <InfoCard icon={GraduationCap} label="المستوى التعليمي" value={employee.education} accent="#8B5CF6" />
                <InfoCard icon={Award} label="التخصص" value={employee.specialization} />
              </div>
            </div>
          )}

          {/* ─ Benefits Tab ─ */}
          {activeTab === "benefits" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                إدارة حالة المزايا
              </div>
              <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 55%)', margin: '0 0 8px 0' }}>
                يمكنك تغيير حالة استفادة الموظف من كل ميزة بالضغط على الزر
              </p>
              {BENEFITS_LIST.map(benefit => {
                const found = benefitStatuses.find(b => b.benefitId === benefit.id);
                const isUsed = found?.status === 'used';
                return (
                  <div key={benefit.id} style={{
                    background: isUsed ? 'hsl(165 60% 20% / 0.15)' : 'hsl(0 0% 22%)',
                    border: isUsed ? '1px solid hsl(165 69% 39% / 0.4)' : '1px solid hsl(0 0% 28%)',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    direction: 'rtl',
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '24px' }}>{benefit.icon}</span>
                      <div>
                        <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px', color: 'hsl(0 0% 90%)' }}>{benefit.label}</div>
                        <div style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 50%)', marginTop: '2px' }}>
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
                        border: 'none', transition: 'all 0.15s',
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

        {/* ── Footer ── */}
        <div style={{
          borderTop: '1px solid hsl(0 0% 26%)',
          padding: '12px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'hsl(0 0% 16%)',
          direction: 'rtl',
        }}>
          <span style={{ fontFamily: 'Alexandria', fontSize: '10px', color: 'hsl(0 0% 38%)' }}>
            آخر تحديث: 2026
          </span>
          <button
            onClick={() => toast.info('سيتم فتح نموذج تعديل بيانات الموظف')}
            style={{
              fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600,
              padding: '7px 18px', borderRadius: '8px',
              background: 'hsl(165 69% 39% / 0.15)', border: '1px solid hsl(165 69% 39% / 0.30)',
              color: '#1FA98C', cursor: 'pointer',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <Edit2 size={12}/> تعديل
          </button>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600,
              padding: '7px 18px', borderRadius: '8px',
              background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 28%)',
              color: 'hsl(0 0% 70%)', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 0% 26%)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 0% 26%)'; }}
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
