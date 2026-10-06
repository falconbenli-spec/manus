import React, { createContext, useContext, useMemo, useState, useEffect, useCallback, ReactNode } from "react";
import { useAuth } from "./AuthContext";

export interface Employee {
  id: number | null;
  employeeId: string;
  nameAr: string;
  birthDate: string;
  age: number | null;
  gender: string;
  maritalStatus: string;
  nationality: string;
  nationalId: string;
  jobTitle: string;
  education: string;
  specialization: string;
  contractStart: string;
  contractEnd: string;
  experienceAt360: string;
  experienceBefore: string;
  totalExperience: string;
  cvLink: string;
  departmentEn: string;
  department: string;
  insurance: string;
}

interface EmployeeContextType {
  employees: Employee[];
  allEmployees: Employee[];
  departments: string[];
  departmentsEn: string[];
  totalCount: number;
  canSeeData: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  getByDepartment: (deptEn: string) => Employee[];
  getDeptStats: () => { name: string; nameEn: string; count: number }[];
  addEmployee: (emp: Employee) => void;
}

const EmployeeContext = createContext<EmployeeContextType | undefined>(undefined);

// Map DB row fields to frontend Employee interface
function mapDbRow(row: any): Employee {
  return {
    id: row.id ?? null,
    employeeId: row.employee_id || row.employeeId || "",
    nameAr: row.name_ar || row.nameAr || "",
    birthDate: row.birth_date || row.birthDate || "",
    age: row.age ?? null,
    gender: row.gender || "",
    maritalStatus: row.marital_status || row.maritalStatus || "",
    nationality: row.nationality || "",
    nationalId: row.national_id || row.nationalId || "",
    jobTitle: row.job_title || row.jobTitle || "",
    education: row.education || "",
    specialization: row.specialization || "",
    contractStart: row.contract_start || row.contractStart || "",
    contractEnd: row.contract_end || row.contractEnd || "",
    experienceAt360: row.experience_at_360 || row.experienceAt360 || "",
    experienceBefore: row.experience_before || row.experienceBefore || "",
    totalExperience: row.total_experience || row.totalExperience || "",
    cvLink: row.cv_link || row.cvLink || "",
    departmentEn: row.department_en || row.departmentEn || "",
    department: row.department || "",
    insurance: row.insurance || "",
  };
}

export function EmployeeProvider({ children }: { children: ReactNode }) {
  const { user, getDepartmentFilter } = useAuth();
  const [added, setAdded] = useState<Employee[]>([]);
  const [apiEmployees, setApiEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [error,setError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);

  // Fetch employees from protected API
  useEffect(() => {
    if (!user) {
      setApiEmployees([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/hcm/employees", { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error(res.status===401?"انتهت الجلسة. سجّل الدخول مجددًا.":res.status===403?"لا تتوفر لك صلاحية لعرض هذه البيانات.":"تعذّر تحميل بيانات الموظفين. أعد المحاولة.");
        return res.json();
      })
      .then(data => {
        if (!cancelled) {
          if(!Array.isArray(data))throw new Error("تعذّر قراءة بيانات الموظفين.");
          setApiEmployees(data.map(mapDbRow));
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setApiEmployees([]);
          setError(reason instanceof Error?reason.message:"تعذّر تحميل بيانات الموظفين.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [user,revision]);

  const allEmployees = useMemo(() => {
    return [...apiEmployees, ...added];
  }, [apiEmployees, added]);

  const canSeeData = useMemo(() => {
    if (!user) return false;
    return user.role === "admin" || user.role === "owner" || user.role === "manager";
  }, [user]);

  const employees = useMemo(() => {
    if (!user) return [];
    if (user.role === "admin" || user.role === "owner") return allEmployees;
    if (user.role === "manager" && user.departmentEn) {
      const deptEn = user.departmentEn;
      return allEmployees.filter(e => {
        if (deptEn === "P.R. Dep.") {
          return e.departmentEn === "P.R. Dep." || e.departmentEn === "P.R Dep.";
        }
        return e.departmentEn === deptEn;
      });
    }
    return [];
  }, [user, allEmployees]);

  const departments = useMemo(() => {
    const seen = new Set<string>();
    const depts: string[] = [];
    for (const e of employees) {
      if (e.department && !seen.has(e.department)) {
        seen.add(e.department);
        depts.push(e.department);
      }
    }
    return depts.sort();
  }, [employees]);

  const departmentsEn = useMemo(() => {
    const seen = new Set<string>();
    const depts: string[] = [];
    for (const e of employees) {
      if (e.departmentEn && !seen.has(e.departmentEn)) {
        seen.add(e.departmentEn);
        depts.push(e.departmentEn);
      }
    }
    return depts.sort();
  }, [employees]);

  const getByDepartment = (deptEn: string) => {
    return employees.filter(e => e.departmentEn === deptEn ||
      (deptEn === "P.R. Dep." && e.departmentEn === "P.R Dep."));
  };

  const getDeptStats = () => {
    const map = new Map<string, { name: string; nameEn: string; count: number }>();
    for (const emp of employees) {
      const key = emp.departmentEn;
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, { name: emp.department, nameEn: key, count: 0 });
      }
      map.get(key)!.count++;
    }
    const result: { name: string; nameEn: string; count: number }[] = [];
    map.forEach(v => result.push(v));
    return result.sort((a, b) => b.count - a.count);
  };

  const addEmployee = (emp: Employee) => {
    setAdded(prev => [emp, ...prev]);
  };

  return (
    <EmployeeContext.Provider value={{
      employees,
      allEmployees,
      departments,
      departmentsEn,
      totalCount: employees.length,
      canSeeData,
      loading,
      error,
      refresh,
      getByDepartment,
      getDeptStats,
      addEmployee,
    }}>
      {children}
    </EmployeeContext.Provider>
  );
}

export function useEmployees() {
  const ctx = useContext(EmployeeContext);
  if (!ctx) throw new Error("useEmployees must be used within EmployeeProvider");
  return ctx;
}
