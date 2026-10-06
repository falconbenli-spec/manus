/**
 * Onboarding - HCM Platform
 * Design: Dark theme, teal #1FA98C, Alexandria font, RTL
 * Data: protected /api/hcm/onboarding records scoped by the active session
 */
import { useEffect, useState, useMemo } from "react";
import { UserCheck, Search, CheckCircle, Clock, Users, AlertCircle, Download, Map, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { OnboardingJourneyContent } from "./OnboardingJourney";
import { exportOnboarding } from "@/lib/excelExport";
import PageTemplate from "@/components/layout/PageTemplate";
const peoplePrimary = "hsl(var(--primary))";
interface OnboardingTask { task: string; completed: boolean; dueDate: string; }
interface OnboardingRecord {
  employeeId: string; nameAr: string; department: string; jobTitle: string;
  contractStart: string; tasks: OnboardingTask[]; completionPct: number;
}

const categoryColors: Record<string, string> = {
  "مستندات": peoplePrimary, "تقنية": "#3B82F6", "تدريب": "#F59E0B",
  "اجتماعي": "#8B5CF6", "مالية": "#10B981",
};

function pctColor(pct: number) {
  if (pct >= 80) return peoplePrimary;
  if (pct >= 50) return "#F59E0B";
  return "#EF4444";
}

const thS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"hsl(0 0% 50%)",whiteSpace:"nowrap",borderBottom:"1px solid hsl(0 0% 26%)",background:"hsl(0 0% 18%)" };
const tdS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(0 0% 80%)",borderBottom:"1px solid hsl(0 0% 20%)" };

export default function Onboarding() {
  const [data, setData] = useState<OnboardingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hcm/onboarding", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const mappedData = d.map((item: any) => ({
          employeeId: item.employee_id || item.employeeId,
          nameAr: item.name_ar || item.nameAr,
          department: item.department_en || item.department,
          jobTitle: item.job_title || item.jobTitle,
          contractStart: item.contract_start || item.contractStart,
          tasks: item.tasks || [],
          completionPct: item.completion_pct || item.completionPct || 0
        }));
        setData(mappedData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OnboardingRecord|null>(null);
  const [mainTab, setMainTab] = useState<"list" | "journey">("list");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ employeeId: "" });

  const handleAddEmployee = async () => {
    if (!newEmployee.employeeId.trim()) {
      toast.error("يرجى إدخال الرقم الوظيفي للموظف");
      return;
    }
    try {
      const response = await fetch("/api/hcm/onboarding", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: newEmployee.employeeId.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "تعذر حفظ الموظف الجديد");
      setData(prev => [result.onboarding as OnboardingRecord, ...prev.filter(item => item.employeeId !== result.onboarding.employeeId)]);
      setNewEmployee({ employeeId: "" });
      setShowAddForm(false);
      toast.success("تم إضافة الموظف الجديد بنجاح");
    } catch (error: any) {
      toast.error(error.message || "تعذر حفظ الموظف الجديد");
    }
  };

  async function toggleTask(employeeId: string, taskIdx: number) {
    try {
      const response = await fetch("/api/hcm/onboarding/tasks", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, taskIndex: taskIdx }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "تعذر حفظ حالة المهمة");
      const updated = result.onboarding as OnboardingRecord;
      setData(prev => prev.map(record => record.employeeId === employeeId ? updated : record));
      if (selected?.employeeId === employeeId) setSelected(updated);
    } catch (error: any) {
      toast.error(error.message || "تعذر حفظ حالة المهمة. لم يتم إجراء تعديل محلي.");
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter(r => r.nameAr.includes(q) || r.department.includes(q));
  }, [search, data]);

  const kpis = useMemo(()=>({
    total: data.length,
    completed: data.filter(r=>r.completionPct===100).length,
    inProgress: data.filter(r=>r.completionPct>0 && r.completionPct<100).length,
    notStarted: data.filter(r=>r.completionPct===0).length,
    avgPct: data.length ? Math.round(data.reduce((s,r)=>s+r.completionPct,0)/data.length) : 0,
  }),[data]);

  return (
    <PageTemplate title="الإعداد والتأهيل" subtitle={`${data.length} موظف جديد قيد الإعداد`} icon={UserCheck}
      stats={[
        {label:"إجمالي الموظفين الجدد",value:String(kpis.total),color:peoplePrimary},
        {label:"مكتمل الإعداد",value:String(kpis.completed),color:"#10B981"},
        {label:"قيد الإعداد",value:String(kpis.inProgress),color:"#F59E0B"},
        {label:"متوسط الإنجاز",value:`${kpis.avgPct}%`,color:"#8B5CF6"},
      ]}
      actions={<div className="flex items-center gap-2"><button className="btn-brand flex items-center gap-2" onClick={() => setShowAddForm(true)}><Plus size={14}/><span>إضافة موظف</span></button><button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold" style={{fontFamily:'Alexandria',background:'hsl(var(--primary) / 0.15)',color:peoplePrimary,border:'1px solid hsl(var(--primary) / 0.30)'}} onClick={() => { exportOnboarding(data); }}><Download size={14}/><span>تصدير</span></button></div>}
    >
      {/* Main Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg w-fit mb-5" style={{ background: 'hsl(0 0% 18%)', border: '1px solid hsl(0 0% 24%)' }}>
        {[{ key: "list", label: "قائمة الإعداد" }, { key: "journey", label: "رحلة التهيئة" }].map(tab => (
          <button key={tab.key} onClick={() => setMainTab(tab.key as any)}
            className="px-4 py-2 rounded-md text-sm font-semibold transition-all"
            style={{ fontFamily: 'Alexandria', background: mainTab === tab.key ? peoplePrimary : 'transparent', color: mainTab === tab.key ? 'white' : 'hsl(0 0% 60%)' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "journey" && <OnboardingJourneyContent />}
      {mainTab === "list" && data.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 20px",color:"hsl(0 0% 50%)",fontFamily:"Alexandria"}}>
          <UserCheck size={48} style={{margin:"0 auto 16px",opacity:0.3}} />
          <div style={{fontSize:"16px",fontWeight:700,marginBottom:"8px"}}>لا يوجد موظفون جدد بعد</div>
          <div style={{fontSize:"13px"}}>سيتم عرض بيانات الإعداد والتأهيل هنا بعد إدخال البيانات</div>
        </div>
      )}
      {mainTab === "list" && data.length > 0 && <>
      <div style={{display:"flex",gap:"10px",marginBottom:"16px",direction:"rtl"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",background:"hsl(0 0% 18%)",border:"1px solid hsl(0 0% 24%)",borderRadius:"8px",padding:"6px 12px",flex:1,minWidth:"200px"}}>
          <Search size={14} color="hsl(0 0% 45%)"/>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو القسم..."
            style={{background:"none",border:"none",outline:"none",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(0 0% 75%)",direction:"rtl",width:"100%"}}/>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:selected?"1fr 380px":"1fr",gap:"16px",direction:"rtl"}}>
        {/* Table */}
        <div className="card-brand rounded-xl overflow-hidden">
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",direction:"rtl"}}>
              <thead><tr>{["الرقم","الاسم","القسم","المسمى","تاريخ الانضمام","التقدم","المهام المكتملة","الإجراء"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((r,idx)=>{
                  const completedCount = r.tasks.filter(t=>t.completed).length;
                  const color = pctColor(r.completionPct);
                  const isSelected = selected?.employeeId===r.employeeId;
                  return(
                    <tr key={r.employeeId} style={{background:isSelected?"hsl(0 0% 21%)":idx%2===0?"transparent":"hsl(0 0% 18%)",cursor:"pointer"}}
                      onClick={()=>setSelected(isSelected?null:r)}>
                      <td style={{...tdS,color:peoplePrimary,fontWeight:700}}>{r.employeeId}</td>
                      <td style={{...tdS,fontWeight:600,whiteSpace:"nowrap"}}>{r.nameAr}</td>
                      <td style={{...tdS,fontSize:"11px",color:"hsl(0 0% 60%)"}}>{r.department}</td>
                      <td style={{...tdS,fontSize:"11px",color:"hsl(0 0% 60%)",maxWidth:"150px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.jobTitle}</td>
                      <td style={{...tdS,fontSize:"11px"}}>{r.contractStart}</td>
                      <td style={tdS}>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <div style={{flex:1,height:"6px",borderRadius:"3px",background:"hsl(0 0% 26%)",overflow:"hidden",minWidth:"60px"}}>
                            <div style={{width:`${r.completionPct}%`,height:"100%",borderRadius:"3px",background:color,transition:"width 0.6s ease"}}/>
                          </div>
                          <span style={{color,fontSize:"11px",fontWeight:700,minWidth:"35px"}}>{r.completionPct}%</span>
                        </div>
                      </td>
                      <td style={{...tdS,textAlign:"center"}}>
                        <span style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"#1FA98C"}}>{completedCount}</span>
                        <span style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(0 0% 45%)"}}> / {r.tasks.length}</span>
                      </td>
                      <td style={tdS}>
                        <button style={{fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"#1FA98C",background:"hsl(165 69% 39% / 0.12)",padding:"3px 10px",borderRadius:"20px",border:"none",cursor:"pointer"}}>
                          {isSelected?"إغلاق":"عرض المهام"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Task Detail Panel */}
        {selected && (
          <div className="card-brand rounded-xl p-5" style={{direction:"rtl",minWidth:"340px"}}>
            <div style={{marginBottom:"16px"}}>
              <div style={{fontFamily:"Alexandria",fontWeight:800,fontSize:"15px",color:"hsl(0 0% 90%)"}}>{selected.nameAr}</div>
              <div style={{fontFamily:"Alexandria",fontSize:"11px",color:"hsl(0 0% 55%)",marginTop:"2px"}}>{selected.jobTitle} — {selected.department}</div>
              <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"10px"}}>
                <div style={{flex:1,height:"8px",borderRadius:"4px",background:"hsl(0 0% 26%)",overflow:"hidden"}}>
                  <div style={{width:`${selected.completionPct}%`,height:"100%",borderRadius:"4px",background:pctColor(selected.completionPct),transition:"width 0.6s ease"}}/>
                </div>
                <span style={{fontFamily:"Alexandria",fontSize:"12px",fontWeight:800,color:pctColor(selected.completionPct)}}>{selected.completionPct}%</span>
              </div>
            </div>
            <div className="section-title">قائمة المهام</div>
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {selected.tasks.map((t,i)=>(
                <div key={i} onClick={() => toggleTask(selected.employeeId, i)} style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 10px",borderRadius:"8px",background:t.completed?"hsl(165 69% 39% / 0.08)":"hsl(0 0% 22%)",border:`1px solid ${t.completed?"hsl(165 69% 39% / 0.20)":"hsl(0 0% 26%)"}`,cursor:"pointer",transition:"all 0.15s"}}>
                  {t.completed
                    ? <CheckCircle size={15} color="#1FA98C" style={{flexShrink:0}}/>
                    : <Clock size={15} color="hsl(0 0% 45%)" style={{flexShrink:0}}/>}
                  <span style={{fontFamily:"Alexandria",fontSize:"12px",color:t.completed?"#1FA98C":"hsl(0 0% 70%)",flex:1,textDecoration:t.completed?"line-through":"none"}}>{t.task}</span>
                  <span style={{fontFamily:"Alexandria",fontSize:"10px",color:"hsl(0 0% 45%)"}}>{t.completed?"✓ مكتمل":"انقر للإتمام"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </>}
      {/* Add Employee Modal */}
      {showAddForm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div className="card-brand rounded-xl p-6" style={{width:'90%',maxWidth:'480px',direction:'rtl'}}>
            <div className="flex items-center justify-between mb-5">
              <h3 style={{fontFamily:'Alexandria',fontWeight:800,fontSize:'16px',color:'hsl(0 0% 90%)'}}>إضافة موظف جديد للتهيئة</h3>
              <button onClick={() => setShowAddForm(false)}><X size={18} color="hsl(0 0% 55%)"/></button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              <div>
                <label style={{fontFamily:'Alexandria',fontSize:'12px',fontWeight:700,color:'hsl(0 0% 65%)',marginBottom:'4px',display:'block'}}>الرقم الوظيفي *</label>
                <input value={newEmployee.employeeId} onChange={e=>setNewEmployee({ employeeId: e.target.value })} placeholder="مثال: 2353" className="input-brand w-full" inputMode="numeric"/>
                <p style={{fontFamily:'Alexandria',fontSize:'11px',color:'hsl(0 0% 55%)',marginTop:'6px'}}>سيتم جلب الاسم والإدارة والمسمى وتاريخ الانضمام من سجل الموظف المعتمد.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-brand flex-1" onClick={handleAddEmployee}>إضافة</button>
              <button onClick={() => setShowAddForm(false)} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{fontFamily:'Alexandria',background:'hsl(0 0% 26%)',border:'1px solid hsl(0 0% 33%)',color:'hsl(0 0% 70%)'}}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </PageTemplate>
  );
}
