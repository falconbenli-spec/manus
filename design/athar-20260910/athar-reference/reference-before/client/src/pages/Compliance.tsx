/**
 * Compliance & Legal - HCM Platform
 * Design: People36t theme tokens, Alexandria font, RTL
 * Data: protected employee roster API — contract expiry data from the server
 */
import { useState, useMemo, useEffect } from "react";
import { Shield, Search, AlertTriangle, CheckCircle, Clock, FileText, Download, Plus, X, RefreshCw } from "lucide-react";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";
import { exportComplianceContracts } from "@/lib/excelExport";

interface Employee {
  employeeId: string;
  nameAr: string;
  department: string;
  jobTitle?: string;
  contractEnd?: string;
  [key: string]: unknown;
}

// Parse various date formats used in employees.json
function parseContractDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Try MM/DD/YYYY (e.g. 04/12/2026)
  let m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  // Try DD-MM-YYYY (e.g. 13-04-2026)
  m = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  // Try D-M-YYYY (e.g. 15-1-2026)
  m = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  // Try YYYY-MM-DD
  m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Try DD/MM/YYYY
  m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ar-SA-u-ca-gregory", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function getDaysLeft(d: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = d.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getStatus(days: number): string {
  if (days < 0) return "منتهي";
  if (days <= 30) return "عاجل";
  if (days <= 60) return "قريب";
  if (days <= 100) return "تنبيه";
  return "ملتزم";
}

function getRisk(days: number): string {
  if (days < 0) return "منتهي";
  if (days <= 14) return "عالي جداً";
  if (days <= 30) return "عالي";
  if (days <= 60) return "متوسط";
  return "منخفض";
}

const statusColors: Record<string, { color: string; bg: string }> = {
  "منتهي":   { color: "#7C3AED", bg: "rgba(124,58,237,0.12)" },
  "عاجل":    { color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  "قريب":    { color: "#F97316", bg: "rgba(249,115,22,0.12)" },
  "تنبيه":   { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  "ملتزم":   { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.12)" },
};

const riskColors: Record<string, string> = {
  "منتهي":    "#7C3AED",
  "عالي جداً": "#EF4444",
  "عالي":     "#F97316",
  "متوسط":    "#F59E0B",
  "منخفض":    "hsl(var(--primary))",
};

const thS: React.CSSProperties = {
  padding: "10px 12px", textAlign: "right", fontFamily: "Alexandria",
  fontSize: "11px", fontWeight: 700, color: "hsl(0 0% 50%)",
  whiteSpace: "nowrap", borderBottom: "1px solid hsl(0 0% 26%)",
  background: "hsl(0 0% 18%)"
};
const tdS: React.CSSProperties = {
  padding: "10px 12px", textAlign: "right", fontFamily: "Alexandria",
  fontSize: "12px", color: "hsl(0 0% 80%)",
  borderBottom: "1px solid hsl(0 0% 20%)"
};

export default function Compliance() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("الكل");
  const [filterRisk, setFilterRisk] = useState("الكل");
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewTarget, setRenewTarget] = useState<{employeeId:string;nameAr:string}|null>(null);
  const [newEndDate, setNewEndDate] = useState("");

  useEffect(() => {
    fetch("/api/hcm/employees", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const mapped = d.map((item: any) => ({
          ...item,
          employeeId: item.employee_id || item.employeeId,
          nameAr: item.name_ar || item.nameAr,
          department: item.department_en || item.department,
          jobTitle: item.job_title || item.jobTitle,
          contractEnd: item.contract_end || item.contractEnd,
        }));
        setEmployees(mapped);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleRenew = () => {
    if (!newEndDate) { toast.error("يرجى تحديد تاريخ انتهاء العقد الجديد"); return; }
    toast.error("تجديد العقود يحتاج مسار تعديل خادمي محمي. لم يتم تغيير أي عقد.");
  };

  // Build contract expiry list from employees.json — only those within 100 days
  const contractData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: {
      employeeId: string;
      nameAr: string;
      department: string;
      jobTitle: string;
      contractEnd: string;
      contractEndDate: Date;
      daysLeft: number;
      status: string;
      riskLevel: string;
    }[] = [];

    for (const emp of employees) {
      const ce = emp.contractEnd;
      if (!ce) continue;
      const d = parseContractDate(ce);
      if (!d) continue;
      const days = getDaysLeft(d);
      // Show contracts expiring within 100 days (including already expired)
      if (days <= 100) {
        result.push({
          employeeId: emp.employeeId,
          nameAr: emp.nameAr,
          department: emp.department || "",
          jobTitle: (emp.jobTitle as string) || "",
          contractEnd: ce,
          contractEndDate: d,
          daysLeft: days,
          status: getStatus(days),
          riskLevel: getRisk(days),
        });
      }
    }
    return result.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [employees]);

  const filtered = useMemo(() => {
    let rows = [...contractData];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => r.nameAr.includes(q) || r.department.includes(q) || r.employeeId.includes(q));
    }
    if (filterStatus !== "الكل") rows = rows.filter(r => r.status === filterStatus);
    if (filterRisk !== "الكل") rows = rows.filter(r => r.riskLevel === filterRisk);
    return rows;
  }, [contractData, search, filterStatus, filterRisk]);

  const kpis = useMemo(() => ({
    total: contractData.length,
    expired: contractData.filter(r => r.daysLeft < 0).length,
    urgent: contractData.filter(r => r.daysLeft >= 0 && r.daysLeft <= 30).length,
    near: contractData.filter(r => r.daysLeft > 30 && r.daysLeft <= 60).length,
    warning: contractData.filter(r => r.daysLeft > 60 && r.daysLeft <= 100).length,
  }), [contractData]);

  function handleExport() {
    exportComplianceContracts(filtered);
    toast.success("جارٍ تحميل تقرير Excel");
  }

  if (loading) {
    return (
      <PageTemplate title="الامتثال والشؤون القانونية" icon={Shield}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh", color: "hsl(0 0% 50%)" }}>
          جاري تحميل البيانات...
        </div>
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      title="الامتثال والشؤون القانونية"
      subtitle={`${contractData.length} عقد ينتهي خلال 100 يوم — بيانات حقيقية من سجلات الموظفين`}
      icon={Shield}
      actions={
        <div className="flex items-center gap-2">
          <button className="btn-brand flex items-center gap-2" onClick={() => { setRenewTarget(null); setShowRenewModal(true); }}><RefreshCw size={14}/><span>تجديد عقد</span></button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold" style={{fontFamily:'Alexandria',background:'hsl(var(--primary) / 0.15)',color:'hsl(var(--primary))',border:'1px solid hsl(var(--primary) / 0.30)'}} onClick={handleExport}><Download size={14}/><span>تصدير Excel</span></button>
        </div>
      }
    >
      {/* Alert Banner */}
      {kpis.expired > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderRadius: "10px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.30)", marginBottom: "12px", direction: "rtl" }}>
          <AlertTriangle size={18} color="#7C3AED" style={{ flexShrink: 0 }} />
          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#7C3AED" }}>
            {kpis.expired} عقد منتهي بالفعل — يتطلب إجراءً فورياً
          </span>
        </div>
      )}
      {kpis.urgent > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderRadius: "10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", marginBottom: "16px", direction: "rtl" }}>
          <AlertTriangle size={18} color="#EF4444" style={{ flexShrink: 0 }} />
          <span style={{ fontFamily: "Alexandria", fontSize: "13px", fontWeight: 700, color: "#EF4444" }}>
            {kpis.urgent} عقد ينتهي خلال 30 يوماً — يتطلب مراجعة عاجلة
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: "إجمالي العقود المنتهية", value: String(kpis.total), icon: FileText, color: "hsl(var(--primary))" },
          { label: "منتهي / عاجل (< 30 يوم)", value: String(kpis.expired + kpis.urgent), icon: AlertTriangle, color: "#EF4444" },
          { label: "قريب (31–60 يوم)", value: String(kpis.near), icon: Clock, color: "#F59E0B" },
          { label: "تنبيه (61–100 يوم)", value: String(kpis.warning), icon: CheckCircle, color: "#10B981" },
        ].map((k, i) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="stat-card animate-fade-in-up" style={{ animationDelay: `${i * 60}ms`, opacity: 0 }}>
              <div className="flex items-start justify-between mb-2">
                <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: `${k.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={17} color={k.color} />
                </div>
              </div>
              <div style={{ fontFamily: "Alexandria", fontWeight: 800, fontSize: "22px", color: k.color }}>{k.value}</div>
              <div style={{ fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 50%)", marginTop: "2px" }}>{k.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", direction: "rtl" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 24%)", borderRadius: "8px", padding: "6px 12px", flex: 1, minWidth: "200px" }}>
          <Search size={14} color="hsl(0 0% 45%)" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الرقم أو القسم..."
            style={{ background: "none", border: "none", outline: "none", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 75%)", direction: "rtl", width: "100%" }} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 24%)", borderRadius: "8px", padding: "6px 12px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 75%)", direction: "rtl" }}>
          {["الكل", "منتهي", "عاجل", "قريب", "تنبيه"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)}
          style={{ background: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 24%)", borderRadius: "8px", padding: "6px 12px", fontFamily: "Alexandria", fontSize: "12px", color: "hsl(0 0% 75%)", direction: "rtl" }}>
          {["الكل", "منتهي", "عالي جداً", "عالي", "متوسط", "منخفض"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      {contractData.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(0 0% 50%)", fontFamily: "Alexandria" }}>
          <Shield size={48} style={{ margin: "0 auto 16px", opacity: 0.3 }} />
          <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>لا توجد عقود تنتهي خلال 100 يوم</div>
          <div style={{ fontSize: "13px" }}>جميع العقود بعيدة عن الانتهاء</div>
        </div>
      ) : (
        <div className="card-brand rounded-xl overflow-hidden">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", direction: "rtl" }}>
              <thead>
                <tr>
                  {["الرقم الوظيفي", "الاسم", "القسم", "المسمى الوظيفي", "تاريخ انتهاء العقد", "الأيام المتبقية", "مستوى المخاطر", "الحالة", "إجراء"].map(h => (
                    <th key={h} style={thS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ ...tdS, textAlign: "center", padding: "40px", color: "hsl(0 0% 45%)" }}>
                      لا توجد نتائج مطابقة للبحث
                    </td>
                  </tr>
                ) : filtered.map((r, idx) => {
                  const sc = statusColors[r.status] || { color: "#888", bg: "rgba(128,128,128,0.1)" };
                  const rc = riskColors[r.riskLevel] || "#888";
                  const daysColor = r.daysLeft < 0 ? "#7C3AED" : r.daysLeft <= 14 ? "#EF4444" : r.daysLeft <= 30 ? "#F97316" : r.daysLeft <= 60 ? "#F59E0B" : "hsl(var(--primary))";
                  const daysLabel = r.daysLeft < 0 ? `منتهي منذ ${Math.abs(r.daysLeft)} يوم` : `${r.daysLeft} يوم`;
                  return (
                    <tr key={r.employeeId + r.contractEnd} style={{ background: idx % 2 === 0 ? "transparent" : "hsl(0 0% 18%)" }}>
                      <td style={{ ...tdS, color: "hsl(var(--primary))", fontWeight: 700 }}>{r.employeeId}</td>
                      <td style={{ ...tdS, fontWeight: 600, whiteSpace: "nowrap" }}>{r.nameAr}</td>
                      <td style={{ ...tdS, fontSize: "11px", color: "hsl(0 0% 60%)" }}>{r.department}</td>
                      <td style={{ ...tdS, fontSize: "11px", color: "hsl(0 0% 60%)" }}>{r.jobTitle || "—"}</td>
                      <td style={{ ...tdS, fontFamily: "Alexandria", direction: "ltr", textAlign: "left" }}>{r.contractEnd}</td>
                      <td style={{ ...tdS, fontWeight: 800, color: daysColor }}>{daysLabel}</td>
                      <td style={tdS}>
                        <span style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: rc, background: `${rc}20`, padding: "3px 10px", borderRadius: "20px" }}>
                          {r.riskLevel}
                        </span>
                      </td>
                      <td style={tdS}>
                        <span style={{ fontFamily: "Alexandria", fontSize: "11px", fontWeight: 700, color: sc.color, background: sc.bg, padding: "3px 10px", borderRadius: "20px" }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={tdS}>
                        <button onClick={(e) => { e.stopPropagation(); setRenewTarget({employeeId:r.employeeId,nameAr:r.nameAr}); setShowRenewModal(true); }} style={{fontFamily:'Alexandria',fontSize:'11px',fontWeight:700,color:'hsl(var(--primary))',background:'hsl(var(--primary) / 0.12)',padding:'3px 10px',borderRadius:'20px',border:'none',cursor:'pointer'}}>تجديد</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 16px", borderTop: "1px solid hsl(0 0% 26%)", fontFamily: "Alexandria", fontSize: "11px", color: "hsl(0 0% 45%)", direction: "rtl" }}>
            يعرض {filtered.length} من {contractData.length} عقد
          </div>
        </div>
      )}
      {/* Renew Contract Modal */}
      {showRenewModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div className="card-brand rounded-xl p-6" style={{width:'90%',maxWidth:'420px',direction:'rtl'}}>
            <div className="flex items-center justify-between mb-5">
              <h3 style={{fontFamily:'Alexandria',fontWeight:800,fontSize:'16px',color:'hsl(0 0% 90%)'}}>{renewTarget ? `تجديد عقد: ${renewTarget.nameAr}` : 'تجديد عقد موظف'}</h3>
              <button onClick={() => setShowRenewModal(false)}><X size={18} color="hsl(0 0% 55%)"/></button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{fontFamily:'Alexandria',fontSize:'12px',lineHeight:1.7,color:'#F59E0B',background:'rgba(245,158,11,0.10)',border:'1px solid rgba(245,158,11,0.25)',padding:'10px 12px',borderRadius:'8px'}}>
                لا يُحفظ التجديد من هذه الواجهة حالياً. يلزم مسار خادمي إداري محمي قبل تعديل بيانات العقود.
              </div>
              <div>
                <label style={{fontFamily:'Alexandria',fontSize:'12px',fontWeight:700,color:'hsl(0 0% 65%)',marginBottom:'4px',display:'block'}}>تاريخ انتهاء العقد الجديد *</label>
                <input type="date" value={newEndDate} onChange={e=>setNewEndDate(e.target.value)} className="input-brand w-full"/>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-brand flex-1" onClick={handleRenew}>تجديد العقد</button>
              <button onClick={() => setShowRenewModal(false)} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{fontFamily:'Alexandria',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 70%)'}}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </PageTemplate>
  );
}
