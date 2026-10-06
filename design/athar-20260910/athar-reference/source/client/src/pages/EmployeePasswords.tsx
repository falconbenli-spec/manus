/**
 * EmployeePasswords - إدارة كلمات مرور بوابة الموظف
 * Admin page to set/reset employee portal passwords
 */
import React, { useState, useEffect, useMemo } from "react";
import { KeyRound, Search, Eye, EyeOff, CheckCircle, XCircle, RefreshCw, Lock } from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";

interface Employee {
  id: number;
  employeeId: string;
  nameAr: string;
  department: string;
  jobTitle: string;
}

interface EmployeeWithPassword {
  employeeId: string;
  hasPassword: boolean;
}

const peoplePrimary = "hsl(var(--primary))";

export default function EmployeePasswords() {
  const [search, setSearch] = useState("");
  const [employeesWithPasswords, setEmployeesWithPasswords] = useState<EmployeeWithPassword[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingPassword, setSettingPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  
  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hcm/employees", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        // Map snake_case to camelCase
        const mappedData = d.map((item: any) => ({
          ...item,
          employeeId: item.employee_id,
          nameAr: item.name_ar,
          jobTitle: item.job_title,
          department: item.department_en, // Assuming department_en is used for department
          birthDate: item.birth_date,
          contractStart: item.contract_start,
          contractEnd: item.contract_end,
          nationalId: item.national_id,
          maritalStatus: item.marital_status,
          cvLink: item.cv_link,
          basicSalary: item.basic_salary,
          housingAllowance: item.housing_allowance,
          transportAllowance: item.transport_allowance,
          totalSalary: item.total_salary,
          bankName: item.bank_name,
          ibanNumber: item.iban_number
        }));
        setEmployeesData(mappedData);
        setEmployeesLoading(false);
      })
      .catch(() => setEmployeesLoading(false));
  }, []);

  const employees = useMemo(() =>
    (employeesData as Employee[]).filter(e => e.employeeId),
    [employeesData]
  );

  const loadPasswords = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/employee-passwords", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setEmployeesWithPasswords(data.employees || []);
      }
    } catch (e) {
      toast.error("تعذّر تحميل بيانات كلمات المرور");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPasswords(); }, []);

  const passwordSet = useMemo(() => {
    const set = new Set<string>();
    employeesWithPasswords.forEach(e => { if (e.hasPassword) set.add(String(e.employeeId)); });
    return set;
  }, [employeesWithPasswords]);

  const filtered = useMemo(() =>
    employees.filter(e =>
      !search ||
      e.nameAr?.includes(search) ||
      String(e.employeeId).includes(search) ||
      e.department?.includes(search)
    ),
    [employees, search]
  );

  const handleSetPassword = async (employeeId: string) => {
    if (!passwordInput || passwordInput.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setSavingId(employeeId);
    try {
      const res = await fetch("/api/admin/employee-passwords", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, password: passwordInput }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("تم تعيين كلمة المرور بنجاح");
        setSettingPassword(null);
        setPasswordInput("");
        await loadPasswords();
      } else {
        toast.error(data.error || "حدث خطأ");
      }
    } catch (e) {
      toast.error("تعذّر حفظ كلمة المرور");
    } finally {
      setSavingId(null);
    }
  };

  const withPassword = employees.filter(e => passwordSet.has(String(e.employeeId))).length;
  const withoutPassword = employees.length - withPassword;

  return (
    <PageTemplate
      title="كلمات مرور الموظفين"
      subtitle="إدارة كلمات مرور بوابة الموظف الذاتية"
      icon={KeyRound}
    >
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '14px', padding: '16px 20px' }}>
          <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}>إجمالي الموظفين</div>
          <div style={{ fontFamily: 'Alexandria', fontSize: '28px', fontWeight: 900, color: 'hsl(var(--foreground))' }}>{employees.length}</div>
        </div>
        <div style={{ background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.30)', borderRadius: '14px', padding: '16px 20px' }}>
          <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}>لديهم كلمة مرور</div>
          <div style={{ fontFamily: 'Alexandria', fontSize: '28px', fontWeight: 900, color: peoplePrimary }}>{withPassword}</div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '14px', padding: '16px 20px' }}>
          <div style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}>بدون كلمة مرور</div>
          <div style={{ fontFamily: 'Alexandria', fontSize: '28px', fontWeight: 900, color: '#EF4444' }}>{withoutPassword}</div>
        </div>
      </div>

      {/* Init Defaults Button */}
      {withoutPassword > 0 && (
        <div className="mb-4">
          <button
            onClick={async () => {
              if (!confirm(`هل تريد تعيين كلمة مرور افتراضية (رقم الموظف@360360) لكل الموظفين الذين ليس لديهم كلمة مرور؟ (${withoutPassword} موظف)`)) return;
              try {
                const res = await fetch("/api/admin/employee-passwords/init-defaults", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                });
                const data = await res.json();
                if (data.success) {
                  toast.success(`تم تعيين كلمات المرور الافتراضية لـ ${data.count} موظف`);
                  await loadPasswords();
                } else {
                  toast.error(data.error || "حدث خطأ");
                }
              } catch (e) {
                toast.error("تعذّر تعيين كلمات المرور");
              }
            }}
            style={{
              width: '100%', padding: '12px 20px',
              background: peoplePrimary,
              border: 'none', borderRadius: '10px',
              color: '#fff', fontFamily: 'Alexandria', fontSize: '14px', fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <Lock size={16} />
            تعيين كلمات المرور الافتراضية ({withoutPassword} موظف)
          </button>
          <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', marginTop: '6px', textAlign: 'center' }}>
            سيتم تعيين كلمة المرور: رقم الموظف@360360 وسيُطلب من الموظف تغييرها عند أول تسجيل دخول
          </p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={15} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو رقم الموظف أو الإدارة..."
          style={{
            width: '100%', padding: '10px 38px 10px 14px',
            background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
            borderRadius: '10px', color: '#fff', fontFamily: 'Alexandria', fontSize: '13px',
            outline: 'none', direction: 'rtl',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
            <thead>
              <tr style={{ background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }}>
                {['رقم الموظف', 'الاسم', 'الإدارة', 'المسمى الوظيفي', 'حالة كلمة المرور', 'إجراء'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '12px', fontWeight: 700, color: 'hsl(var(--muted-foreground))', textAlign: 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading || employeesLoading ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', fontFamily: 'Alexandria', color: 'hsl(var(--muted-foreground))' }}>
                  <RefreshCw size={20} style={{ display: 'inline', animation: 'spin 1s linear infinite', marginLeft: '8px' }} />
                  جاري التحميل...
                </td></tr>
              ) : filtered.map(emp => {
                const hasPass = passwordSet.has(String(emp.employeeId));
                const isEditing = settingPassword === String(emp.employeeId);
                return (
                  <tr key={emp.id} style={{ borderBottom: '1px solid hsl(var(--muted))', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--card))')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '13px', color: peoplePrimary, fontWeight: 700 }}>{emp.employeeId}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--foreground))', fontWeight: 600 }}>{emp.nameAr}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>{emp.department}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>{emp.jobTitle}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {hasPass ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: peoplePrimary, background: 'hsl(var(--primary) / 0.12)', padding: '4px 10px', borderRadius: '20px', border: '1px solid hsl(var(--primary) / 0.30)' }}>
                          <CheckCircle size={11} /> مُعيَّنة
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 700, color: '#EF4444', background: 'rgba(239,68,68,0.12)', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(239,68,68,0.3)' }}>
                          <XCircle size={11} /> غير مُعيَّنة
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ position: 'relative' }}>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={passwordInput}
                              onChange={e => setPasswordInput(e.target.value)}
                              placeholder="كلمة المرور الجديدة"
                              style={{ padding: '6px 32px 6px 10px', background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: '#fff', fontFamily: 'Alexandria', fontSize: '12px', outline: 'none', width: '160px', direction: 'rtl' }}
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') handleSetPassword(String(emp.employeeId)); if (e.key === 'Escape') { setSettingPassword(null); setPasswordInput(""); } }}
                            />
                            <button onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))' }}>
                              {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          </div>
                          <button
                            onClick={() => handleSetPassword(String(emp.employeeId))}
                            disabled={savingId === String(emp.employeeId)}
                            style={{ padding: '6px 12px', background: peoplePrimary, color: 'hsl(var(--primary-foreground))', border: 'none', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', cursor: 'pointer', fontWeight: 700 }}
                          >
                            {savingId === String(emp.employeeId) ? '...' : 'حفظ'}
                          </button>
                          <button
                            onClick={() => { setSettingPassword(null); setPasswordInput(""); }}
                            style={{ padding: '6px 10px', background: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))', border: 'none', borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', cursor: 'pointer' }}
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setSettingPassword(String(emp.employeeId)); setPasswordInput(""); setShowPassword(false); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', background: hasPass ? 'hsl(var(--input))' : 'hsl(var(--primary) / 0.15)', color: hasPass ? 'hsl(var(--muted-foreground))' : peoplePrimary, border: `1px solid ${hasPass ? 'hsl(var(--border))' : 'hsl(var(--primary) / 0.40)'}`, borderRadius: '8px', fontFamily: 'Alexandria', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          <Lock size={12} />
                          {hasPass ? 'تغيير كلمة المرور' : 'تعيين كلمة المرور'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PageTemplate>
  );
}
