/**
 * AddEmployeeModal
 * Design: Dark theme, teal accent (#1FA98C), Cairo/Alexandria font, RTL
 * Multi-section form for adding a new employee with full validation.
 * Sections: البيانات الشخصية | بيانات العمل | بيانات العقد
 */
import { useState, useEffect, useRef } from "react";
import {
  X, User, Briefcase, FileText, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, UserPlus
} from "lucide-react";
import type { Employee } from "@/contexts/EmployeeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/contexts/ActivityLogContext";

interface AddEmployeeModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (emp: Employee) => void;
  existingIds: string[];
  departments: string[];
}

type Step = 1 | 2 | 3;

interface FormData {
  employeeId: string;
  nameAr: string;
  birthDate: string;
  gender: string;
  maritalStatus: string;
  nationality: string;
  nationalId: string;
  jobTitle: string;
  department: string;
  education: string;
  specialization: string;
  contractStart: string;
  contractEnd: string;
  experienceAt360: string;
  experienceBefore: string;
  totalExperience: string;
  insurance: string;
}

const EMPTY: FormData = {
  employeeId: "",
  nameAr: "",
  birthDate: "",
  gender: "",
  maritalStatus: "",
  nationality: "المملكة العربية السعودية",
  nationalId: "",
  jobTitle: "",
  department: "",
  education: "",
  specialization: "",
  contractStart: "",
  contractEnd: "",
  experienceAt360: "",
  experienceBefore: "",
  totalExperience: "",
  insurance: "التعاونية",
};

const DEPT_OPTIONS = [
  "الإنتاج",
  "التسويق الرقمي",
  "العلاقات العامة",
  "الإبداعي",
  "الأعمال",
  "رأس المال البشري",
  "التسويق",
  "التنفيذي",
  "الرئيس التنفيذي",
];

const EDUCATION_OPTIONS = ["بكالوريوس", "دبلوم", "ماجستير", "دكتوراه", "ثانوية", "أخرى"];
const GENDER_OPTIONS = ["ذكر", "انثى"];
const MARITAL_OPTIONS = ["أعزب/ـة", "متزوج/ـة", "مطلق/ـة", "أرمل/ـة"];
const NATIONALITY_OPTIONS = [
  "المملكة العربية السعودية", "مصر", "الأردن", "سوريا", "لبنان",
  "العراق", "اليمن", "السودان", "المغرب", "تونس", "الجزائر", "أخرى",
];
const INSURANCE_OPTIONS = ["التعاونية", "بوبا", "ميدغلف", "أخرى"];

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 55%)', display: 'block', marginBottom: '5px' }}>
      {label}{required && <span style={{ color: '#EF4444', marginRight: '2px' }}>*</span>}
    </label>
  );
}

const inputStyle = (error?: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '9px 12px',
  borderRadius: '9px',
  background: 'hsl(0 0% 22%)',
  border: `1px solid ${error ? '#EF4444' : 'hsl(0 0% 28%)'}`,
  color: 'hsl(0 0% 88%)',
  fontSize: '13px',
  fontFamily: 'Alexandria',
  direction: 'rtl',
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
});

function InputField({
  label, value, onChange, placeholder, required, error, type = "text"
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; error?: string; type?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle(!!error)}
        onFocus={e => { if (!error) e.target.style.borderColor = '#1FA98C'; }}
        onBlur={e => { if (!error) e.target.style.borderColor = 'hsl(0 0% 28%)'; }}
      />
      {error && <p style={{ fontFamily: 'Alexandria', fontSize: '10px', color: '#EF4444', marginTop: '3px' }}>{error}</p>}
    </div>
  );
}

function SelectField({
  label, value, onChange, options, required, error, placeholder
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; required?: boolean; error?: string; placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle(!!error), cursor: 'pointer' }}
        onFocus={e => { if (!error) e.target.style.borderColor = '#1FA98C'; }}
        onBlur={e => { if (!error) e.target.style.borderColor = 'hsl(0 0% 28%)'; }}
      >
        <option value="">{placeholder || `-- اختر ${label} --`}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <p style={{ fontFamily: 'Alexandria', fontSize: '10px', color: '#EF4444', marginTop: '3px' }}>{error}</p>}
    </div>
  );
}

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: 1, label: "البيانات الشخصية", icon: User },
  { id: 2, label: "بيانات العمل", icon: Briefcase },
  { id: 3, label: "بيانات العقد", icon: FileText },
];

export default function AddEmployeeModal({ open, onClose, onSave, existingIds, departments }: AddEmployeeModalProps) {
  const { user } = useAuth();
  const { logActivity } = useActivityLog();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setErrors({});
      setStep(1);
      setSubmitted(false);
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  const set = (field: keyof FormData) => (value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  function validateStep(s: Step): Partial<FormData> {
    const e: Partial<FormData> = {};
    if (s === 1) {
      if (!form.employeeId.trim()) e.employeeId = "الرقم الوظيفي مطلوب";
      else if (existingIds.includes(form.employeeId.trim())) e.employeeId = "هذا الرقم الوظيفي مستخدم مسبقاً";
      if (!form.nameAr.trim()) e.nameAr = "الاسم مطلوب";
      if (!form.gender) e.gender = "الجنس مطلوب";
      if (!form.nationality) e.nationality = "الجنسية مطلوبة";
    }
    if (s === 2) {
      if (!form.jobTitle.trim()) e.jobTitle = "المسمى الوظيفي مطلوب";
      if (!form.department) e.department = "الإدارة مطلوبة";
      if (!form.education) e.education = "المستوى التعليمي مطلوب";
    }
    if (s === 3) {
      if (!form.contractStart) e.contractStart = "تاريخ بداية العقد مطلوب";
      if (!form.contractEnd) e.contractEnd = "تاريخ نهاية العقد مطلوب";
    }
    return e;
  }

  function handleNext() {
    const e = validateStep(step);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setStep(prev => (prev < 3 ? (prev + 1) as Step : prev));
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleBack() {
    setStep(prev => (prev > 1 ? (prev - 1) as Step : prev));
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSubmit() {
    const e3 = validateStep(3);
    if (Object.keys(e3).length > 0) { setErrors(e3); return; }

    // Calculate age from birthDate
    let age: number | null = null;
    if (form.birthDate) {
      const bd = new Date(form.birthDate);
      const now = new Date();
      age = now.getFullYear() - bd.getFullYear();
    }

    const newEmp: Employee = {
      id: Date.now(),
      employeeId: form.employeeId.trim(),
      nameAr: form.nameAr.trim(),
      birthDate: form.birthDate,
      age,
      gender: form.gender,
      maritalStatus: form.maritalStatus,
      nationality: form.nationality,
      nationalId: form.nationalId.trim(),
      jobTitle: form.jobTitle.trim(),
      education: form.education,
      specialization: form.specialization.trim(),
      contractStart: form.contractStart,
      contractEnd: form.contractEnd,
      experienceAt360: form.experienceAt360.trim(),
      experienceBefore: form.experienceBefore.trim(),
      totalExperience: form.totalExperience.trim(),
      cvLink: "",
      departmentEn: form.department,
      department: form.department,
      insurance: form.insurance,
    };

    setSubmitted(true);
    setTimeout(() => {
      onSave(newEmp);
      if (user) {
        logActivity({
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          category: "employee",
          action: "إضافة موظف",
          details: `تم إضافة الموظف ${newEmp.nameAr} (رقم وظيفي: ${newEmp.employeeId}) إلى قسم ${newEmp.department}`,
          severity: "success",
          metadata: { employeeId: newEmp.employeeId, department: newEmp.department, jobTitle: newEmp.jobTitle },
        });
      }
      onClose();
    }, 1200);
  }

  if (!open) return null;

  const allDepts = Array.from(new Set([...DEPT_OPTIONS, ...departments]));

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
          width: '100%', maxWidth: '680px',
          background: 'hsl(0 0% 18%)',
          border: '1px solid hsl(0 0% 24%)',
          borderRadius: '16px',
          overflow: 'hidden',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.97)',
          transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.55)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          background: 'hsl(var(--card))',
          borderBottom: '1px solid hsl(var(--border))',
          padding: '20px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          direction: 'rtl',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'hsl(165 69% 39% / 0.20)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UserPlus size={18} color="#1FA98C" />
            </div>
            <div>
              <h2 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: 'hsl(0 0% 96%)', margin: 0 }}>
                إضافة موظف جديد
              </h2>
              <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 50%)', margin: 0 }}>
                أدخل بيانات الموظف في الخطوات الثلاث
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '30px', height: '30px', borderRadius: '8px',
              background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 28%)',
              color: 'hsl(0 0% 60%)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Step Indicator ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px 24px', gap: '0',
          background: 'hsl(0 0% 18%)',
          borderBottom: '1px solid hsl(0 0% 26%)',
          direction: 'rtl',
        }}>
          {STEPS.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div style={{
                    width: '34px', height: '34px', borderRadius: '50%',
                    background: done ? '#1FA98C' : active ? 'hsl(165 69% 39% / 0.20)' : 'hsl(0 0% 26%)',
                    border: `2px solid ${done || active ? '#1FA98C' : 'hsl(0 0% 28%)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.25s',
                  }}>
                    {done
                      ? <CheckCircle2 size={16} color="white" />
                      : <s.icon size={15} color={active ? '#1FA98C' : 'hsl(0 0% 45%)'} />
                    }
                  </div>
                  <span style={{
                    fontFamily: 'Alexandria', fontSize: '10px', fontWeight: 700,
                    color: done || active ? '#1FA98C' : 'hsl(0 0% 40%)',
                    whiteSpace: 'nowrap',
                  }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{
                    flex: 1, height: '2px', margin: '0 8px', marginBottom: '16px',
                    background: done ? '#1FA98C' : 'hsl(0 0% 24%)',
                    transition: 'background 0.25s',
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Form Content ── */}
        <div ref={scrollRef} style={{ overflowY: 'auto', padding: '20px 24px', flex: 1, direction: 'rtl' }}>

          {/* Success animation */}
          {submitted && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '12px', padding: '40px 0',
            }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: 'hsl(165 69% 39% / 0.15)', border: '2px solid #1FA98C',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pulse 1s ease-in-out infinite',
              }}>
                <CheckCircle2 size={32} color="#1FA98C" />
              </div>
              <p style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '16px', color: '#1FA98C' }}>
                تمت إضافة الموظف بنجاح!
              </p>
              <p style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(0 0% 55%)' }}>
                {form.nameAr} — {form.jobTitle}
              </p>
            </div>
          )}

          {/* Step 1: Personal Info */}
          {!submitted && step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', marginBottom: '4px' }}>
                البيانات الشخصية الأساسية
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <InputField
                  label="الرقم الوظيفي" value={form.employeeId} onChange={set('employeeId')}
                  placeholder="مثال: 2100" required error={errors.employeeId}
                />
                <InputField
                  label="الاسم الكامل بالعربي" value={form.nameAr} onChange={set('nameAr')}
                  placeholder="الاسم الرباعي" required error={errors.nameAr}
                />
                <SelectField
                  label="الجنس" value={form.gender} onChange={set('gender')}
                  options={GENDER_OPTIONS} required error={errors.gender}
                />
                <SelectField
                  label="الحالة الاجتماعية" value={form.maritalStatus} onChange={set('maritalStatus')}
                  options={MARITAL_OPTIONS}
                />
                <SelectField
                  label="الجنسية" value={form.nationality} onChange={set('nationality')}
                  options={NATIONALITY_OPTIONS} required error={errors.nationality}
                />
                <InputField
                  label="رقم الهوية الوطنية" value={form.nationalId} onChange={set('nationalId')}
                  placeholder="10 أرقام"
                />
                <InputField
                  label="تاريخ الميلاد" value={form.birthDate} onChange={set('birthDate')}
                  type="date"
                />
              </div>
            </div>
          )}

          {/* Step 2: Work Info */}
          {!submitted && step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', marginBottom: '4px' }}>
                بيانات العمل والمؤهلات
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <InputField
                    label="المسمى الوظيفي" value={form.jobTitle} onChange={set('jobTitle')}
                    placeholder="مثال: مدير تسويق رقمي" required error={errors.jobTitle}
                  />
                </div>
                <SelectField
                  label="الإدارة" value={form.department} onChange={set('department')}
                  options={allDepts} required error={errors.department}
                />
                <SelectField
                  label="التأمين الصحي" value={form.insurance} onChange={set('insurance')}
                  options={INSURANCE_OPTIONS}
                />
                <SelectField
                  label="المستوى التعليمي" value={form.education} onChange={set('education')}
                  options={EDUCATION_OPTIONS} required error={errors.education}
                />
                <InputField
                  label="التخصص" value={form.specialization} onChange={set('specialization')}
                  placeholder="مثال: إدارة الأعمال"
                />
              </div>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', marginTop: '8px', marginBottom: '4px' }}>
                الخبرات المهنية
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <InputField
                  label="الخبرة في 3.6T" value={form.experienceAt360} onChange={set('experienceAt360')}
                  placeholder="مثال: 1 Year and 3 Months"
                />
                <InputField
                  label="الخبرة السابقة" value={form.experienceBefore} onChange={set('experienceBefore')}
                  placeholder="مثال: 5 Years"
                />
                <div style={{ gridColumn: '1 / -1' }}>
                  <InputField
                    label="إجمالي الخبرة" value={form.totalExperience} onChange={set('totalExperience')}
                    placeholder="مثال: 6 Years and 3 Months"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Contract Info */}
          {!submitted && step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: 'hsl(0 0% 45%)', marginBottom: '4px' }}>
                تفاصيل العقد
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <InputField
                  label="تاريخ بداية العقد" value={form.contractStart} onChange={set('contractStart')}
                  type="date" required error={errors.contractStart}
                />
                <InputField
                  label="تاريخ نهاية العقد" value={form.contractEnd} onChange={set('contractEnd')}
                  type="date" required error={errors.contractEnd}
                />
              </div>

              {/* Preview card */}
              {form.nameAr && (
                <div style={{
                  marginTop: '8px',
                  background: 'hsl(0 0% 22%)',
                  border: '1px solid hsl(165 69% 39% / 0.25)',
                  borderRadius: '12px',
                  padding: '16px',
                }}>
                  <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: '#1FA98C', marginBottom: '12px' }}>
                    معاينة بيانات الموظف
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '50%', flexShrink: 0,
                      background: 'hsl(165 69% 39% / 0.20)', color: '#1FA98C',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'Alexandria', fontWeight: 800, fontSize: '18px',
                    }}>
                      {form.nameAr.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '14px', color: 'hsl(0 0% 92%)' }}>{form.nameAr}</div>
                      <div style={{ fontFamily: 'Alexandria', fontSize: '12px', color: '#1FA98C' }}>{form.jobTitle}</div>
                    </div>
                    <div style={{ marginRight: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {form.department && (
                        <span style={{ fontFamily: 'Alexandria', fontSize: '10px', background: 'hsl(165 69% 39% / 0.12)', color: '#1FA98C', padding: '2px 10px', borderRadius: '20px', border: '1px solid hsl(165 69% 39% / 0.25)' }}>
                          {form.department}
                        </span>
                      )}
                      <span style={{ fontFamily: 'Alexandria', fontSize: '10px', background: 'hsl(0 0% 24%)', color: 'hsl(0 0% 60%)', padding: '2px 10px', borderRadius: '20px' }}>
                        #{form.employeeId}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {[
                      { label: "الجنس", value: form.gender },
                      { label: "الجنسية", value: form.nationality },
                      { label: "التعليم", value: form.education },
                      { label: "التأمين", value: form.insurance },
                      { label: "بداية العقد", value: form.contractStart },
                      { label: "نهاية العقد", value: form.contractEnd },
                    ].map(f => f.value ? (
                      <div key={f.label} style={{ background: 'hsl(0 0% 18%)', borderRadius: '8px', padding: '8px 10px' }}>
                        <div style={{ fontFamily: 'Alexandria', fontSize: '9px', color: 'hsl(0 0% 45%)', marginBottom: '2px' }}>{f.label}</div>
                        <div style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 600, color: 'hsl(0 0% 80%)' }}>{f.value}</div>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {!submitted && (
          <div style={{
            borderTop: '1px solid hsl(0 0% 26%)',
            padding: '14px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'hsl(0 0% 16%)',
            direction: 'rtl',
            gap: '10px',
          }}>
            <span style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(0 0% 38%)' }}>
              الخطوة {step} من 3
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {step > 1 && (
                <button
                  onClick={handleBack}
                  style={{
                    fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 600,
                    padding: '8px 18px', borderRadius: '8px',
                    background: 'hsl(0 0% 26%)', border: '1px solid hsl(0 0% 28%)',
                    color: 'hsl(0 0% 70%)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px',
                  }}
                >
                  <ChevronRight size={13} />
                  السابق
                </button>
              )}
              {step < 3 ? (
                <button
                  onClick={handleNext}
                  style={{
                    fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 700,
                    padding: '8px 22px', borderRadius: '8px',
                    background: '#1FA98C', border: 'none',
                    color: 'white', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px',
                  }}
                >
                  التالي
                  <ChevronLeft size={13} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  style={{
                    fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 700,
                    padding: '8px 22px', borderRadius: '8px',
                    background: 'hsl(var(--primary))',
                    border: 'none', color: 'white', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    boxShadow: '0 4px 12px hsl(165 69% 39% / 0.35)',
                  }}
                >
                  <CheckCircle2 size={14} />
                  حفظ الموظف
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
