import {LoadingState,ErrorState} from "@/components/feedback/AsyncState";
/**
 * CoreHRM - Employee Management
 * Real data from EmployeeContext with RBAC
 * Employee names are clickable → opens EmployeeProfileModal
 */
import { useState, useMemo } from "react";
import { Users, UserPlus, Search, Download, Inbox } from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import { useEmployees } from "@/contexts/EmployeeContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import EmployeeProfileModal from "@/components/EmployeeProfileModal";
import AddEmployeeModal from "@/components/AddEmployeeModal";
import type { Employee } from "@/contexts/EmployeeContext";
import { exportEmployees } from "@/lib/excelExport";

const peoplePrimary = "hsl(var(--primary))";

const GENDER_COLORS: Record<string, string> = {
  "ذكر": peoplePrimary,
  "انثى": "#F59E0B",
};

const EDU_COLORS: Record<string, string> = {
  "بكالوريوس": peoplePrimary,
  "دبلوم": "#F59E0B",
  "ماجستير": "#8B5CF6",
  "دكتوراه": "#EF4444",
  "ثانوية": "#3B82F6",
};

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Inbox size={28} color="#EF4444" />
      </div>
      <p style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '16px', color: 'hsl(var(--foreground))' }}>لا تملك صلاحية عرض هذه البيانات</p>
      <p style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>يمكن لمدير النظام ومديري الإدارات فقط الاطلاع على بيانات الموظفين</p>
    </div>
  );
}

export default function CoreHRM() {
  const { employees, departments, canSeeData, addEmployee, loading, error, refresh } = useEmployees();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("الكل");
  const [filterGender, setFilterGender] = useState("الكل");
  const [profileEmp, setProfileEmp] = useState<Employee | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    return employees.filter(e => {
      const matchSearch = !search || e.nameAr.includes(search) || e.employeeId.includes(search) || e.jobTitle.includes(search);
      const matchDept = filterDept === "الكل" || e.department === filterDept;
      const matchGender = filterGender === "الكل" || e.gender === filterGender;
      return matchSearch && matchDept && matchGender;
    });
  }, [employees, search, filterDept, filterGender]);


  if(loading||error)return <PageTemplate title="إدارة رأس المال البشري الأساسية" subtitle="سجلات الموظفين والبيانات الأساسية" icon={Users}>{loading?<LoadingState title="جارٍ تحميل بيانات الفريق"/>:<ErrorState message={error||"تعذّر تحميل البيانات"} onRetry={refresh}/>}</PageTemplate>;

  return (
    <PageTemplate
      title="إدارة رأس المال البشري الأساسية"
      subtitle="سجلات الموظفين والبيانات الأساسية"
      icon={Users}
      stats={[
        { label: "إجمالي الموظفين", value: canSeeData ? employees.length.toString() : "—", color: peoplePrimary },
        { label: "ذكور", value: canSeeData ? employees.filter(e => e.gender === 'ذكر').length.toString() : "—", color: peoplePrimary },
        { label: "إناث", value: canSeeData ? employees.filter(e => e.gender === 'انثى').length.toString() : "—", color: "#F59E0B" },
        { label: "الإدارات", value: canSeeData ? departments.length.toString() : "—", color: "#8B5CF6" },
      ]}
      actions={
        canSeeData ? (
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
              style={{ fontFamily: 'Alexandria', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              onClick={() => { if (!canSeeData) { toast.error('ليس لديك صلاحية لتصدير البيانات'); return; } exportEmployees(filtered); toast.success('جارٍ تحميل ملف Excel...'); }}
            >
              <Download size={14} /><span>تصدير</span>
            </button>
            <button className="btn-brand flex items-center gap-2" onClick={() => setShowAdd(true)}>
              <UserPlus size={14} /><span>إضافة موظف</span>
            </button>
          </div>
        ) : undefined
      }
    >
      {!canSeeData ? (
        <AccessDenied />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1" style={{ minWidth: '200px' }}>
              <Search size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
              <input
                type="text"
                placeholder="بحث بالاسم أو الرقم الوظيفي أو المسمى..."
                value={search}
                onChange={e => { setSearch(e.target.value); }}
                style={{
                  width: '100%', padding: '9px 36px 9px 14px', borderRadius: '10px',
                  background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                  color: 'hsl(var(--foreground))', fontSize: '13px', fontFamily: 'Alexandria', direction: 'rtl', outline: 'none',
                }}
                onFocus={e => (e.target as HTMLElement).style.borderColor = peoplePrimary}
                onBlur={e => (e.target as HTMLElement).style.borderColor = 'hsl(var(--border))'}
              />
            </div>
            {(user?.role === "admin" || user?.role === "owner") && (
              <select
                value={filterDept}
                onChange={e => { setFilterDept(e.target.value); }}
                style={{ padding: '9px 14px', borderRadius: '10px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))', fontSize: '13px', fontFamily: 'Alexandria', direction: 'rtl', outline: 'none' }}
              >
                <option value="الكل">كل الإدارات</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select
              value={filterGender}
              onChange={e => { setFilterGender(e.target.value); }}
              style={{ padding: '9px 14px', borderRadius: '10px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))', fontSize: '13px', fontFamily: 'Alexandria', direction: 'rtl', outline: 'none' }}
            >
              <option value="الكل">الجنس: الكل</option>
              <option value="ذكر">ذكور</option>
              <option value="انثى">إناث</option>
            </select>
            <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>
              {filtered.length} نتيجة
            </span>
          </div>

          {/* Table */}
          <div className="card-brand rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الرقم الوظيفي</th>
                    <th>الاسم</th>
                    <th>المسمى الوظيفي</th>
                    <th>الإدارة</th>
                    <th>الجنس</th>
                    <th>الجنسية</th>
                    <th>المستوى التعليمي</th>
                    <th>بداية العقد</th>
                    <th>نهاية العقد</th>
                    <th>إجمالي الخبرة</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11}>
                        <div className="flex flex-col items-center justify-center py-10 gap-2">
                          <Inbox size={24} color={peoplePrimary} />
                          <p style={{ fontFamily: 'Alexandria', fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>لا توجد نتائج</p>
                        </div>
                      </td>
                    </tr>
                  ) : filtered.map((emp, i) => (
                    <tr
                      key={emp.id || i}

                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(var(--primary) / .06)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    >
                      <td style={{ color: 'hsl(var(--muted-foreground))', fontSize: '11px' }}>{i + 1}</td>
                      <td>
                        <span style={{ fontFamily: 'Alexandria', fontWeight: 700, fontSize: '12px', color: peoplePrimary }}>{emp.employeeId}</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div style={{
                            width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                            background: 'hsl(var(--primary) / .15)', color: peoplePrimary,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: 'Alexandria', fontWeight: 700, fontSize: '11px',
                          }}>
                            {emp.nameAr.charAt(0)}
                          </div>
                          <button type="button" aria-label={`فتح ملف ${emp.nameAr}`} onClick={() => setProfileEmp(emp)}
                            style={{
                              fontFamily: 'Alexandria', fontWeight: 700, fontSize: '13px',
                              color: peoplePrimary,
                              textDecoration: 'underline',
                              textDecorationStyle: 'dotted',
                              textUnderlineOffset: '3px',
                              cursor: 'pointer',
                            }}
                          >
                            {emp.nameAr}
                          </button>
                        </div>
                      </td>
                      <td style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', maxWidth: '160px' }}>{emp.jobTitle}</td>
                      <td>
                        <span className="badge-teal" style={{ fontFamily: 'Alexandria', fontSize: '10px' }}>{emp.department}</span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 600, color: GENDER_COLORS[emp.gender] || 'hsl(var(--muted-foreground))' }}>{emp.gender}</span>
                      </td>
                      <td style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>
                        {emp.nationality === 'المملكة العربية السعودية' ? '🇸🇦 سعودي' : emp.nationality}
                      </td>
                      <td>
                        <span style={{ fontFamily: 'Alexandria', fontSize: '11px', fontWeight: 600, color: EDU_COLORS[emp.education] || 'hsl(var(--muted-foreground))' }}>{emp.education}</span>
                      </td>
                      <td style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{emp.contractStart}</td>
                      <td style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{emp.contractEnd}</td>
                      <td style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{emp.totalExperience}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total count footer */}
            <div className="flex items-center justify-end px-4 py-2" style={{ borderTop: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>
              <span style={{ fontFamily: 'Alexandria', fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>
                إجمالي: {filtered.length} موظف
              </span>
            </div>
          </div>

          {/* Hint */}
          <p style={{ fontFamily: 'Alexandria', fontSize: '11px', color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>
            اختر اسم الموظف لعرض ملفه الشخصي الكامل
          </p>
        </>
      )}

      {/* Employee Profile Modal */}
      <EmployeeProfileModal employee={profileEmp} onClose={() => setProfileEmp(null)} />

      {/* Add Employee Modal */}
      <AddEmployeeModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={(emp) => {
          addEmployee(emp);
          toast.success(`تمت إضافة ${emp.nameAr} بنجاح!`);
        }}
        existingIds={employees.map(e => e.employeeId)}
        departments={departments}
      />
    </PageTemplate>
  );
}
