/**
 * Recruitment & Hiring - HCM Platform
 * Full CRUD: add/edit/delete jobs and candidates
 */
import { useState, useMemo } from "react";
import { UserPlus, Briefcase, Inbox, Plus, Trash2, Edit2, X, Check, Search, Download, Brain } from "lucide-react";
import { RecruitmentPipelineContent } from "./RecruitmentPipeline";
import { exportRecruitment } from "@/lib/excelExport";
import PageTemplate from "@/components/layout/PageTemplate";
import { toast } from "sonner";

const stages = ["مراجعة CV", "اختبار تقني", "مقابلة HR", "مقابلة تقنية", "عرض وظيفي", "مقبول"];
const peoplePrimary = "hsl(var(--primary))";
const stageColors: Record<string, string> = {
  "مراجعة CV": "#F59E0B", "اختبار تقني": "#8B5CF6",
  "مقابلة HR": "#3B82F6", "مقابلة تقنية": "#F97316",
  "عرض وظيفي": "hsl(165 60% 55%)", "مقبول": peoplePrimary,
};

interface Job {
  id: number; title: string; department: string; type: string;
  location: string; openDate: string; status: string; count: number;
}
interface Candidate {
  id: number; name: string; jobTitle: string; stage: string;
  rating: number; applyDate: string; phone: string; notes: string;
}

const thS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"11px",fontWeight:700,color:"hsl(var(--muted-foreground))",whiteSpace:"nowrap",borderBottom:"1px solid hsl(var(--border))",background:"hsl(var(--card))" };
const tdS: React.CSSProperties = { padding:"10px 12px",textAlign:"right",fontFamily:"Alexandria",fontSize:"12px",color:"hsl(var(--foreground))",borderBottom:"1px solid hsl(var(--card))" };

let nextJobId = 1;
let nextCandId = 1;

// Modal for adding/editing a job
function JobModal({ job, onSave, onClose }: { job?: Job; onSave: (j: Job) => void; onClose: () => void }) {
  const [form, setForm] = useState<Omit<Job,'id'>>({
    title: job?.title || '', department: job?.department || '',
    type: job?.type || 'دوام كامل', location: job?.location || 'الرياض',
    openDate: job?.openDate || new Date().toISOString().slice(0,10),
    status: job?.status || 'مفتوح', count: job?.count || 1,
  });
  const set = (k: keyof typeof form, v: string | number) => setForm(p => ({ ...p, [k]: v }));
  function save() {
    if (!form.title.trim() || !form.department.trim()) { toast.error("يرجى ملء الحقول المطلوبة"); return; }
    onSave({ id: job?.id ?? nextJobId++, ...form });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', direction: 'rtl' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: peoplePrimary }}>{job ? 'تعديل وظيفة' : 'إضافة وظيفة جديدة'}</h3>
          <button onClick={onClose}><X size={18} color="hsl(var(--muted-foreground))" /></button>
        </div>
        <div className="flex flex-col gap-3">
          {[['title','المسمى الوظيفي *'],['department','الإدارة *'],['location','الموقع']].map(([k,label]) => (
            <div key={k}>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>{label}</label>
              <input value={(form as any)[k]} onChange={e => set(k as any, e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>نوع الوظيفة</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }}>
                {['دوام كامل','دوام جزئي','عقد','تدريب'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>عدد الشواغر</label>
              <input type="number" min={1} value={form.count} onChange={e => set('count', Number(e.target.value))}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={save}><Check size={14}/><span>حفظ</span></button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ fontFamily:'Alexandria',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--muted-foreground))' }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal for adding/editing a candidate
function CandidateModal({ cand, jobs, onSave, onClose }: { cand?: Candidate; jobs: Job[]; onSave: (c: Candidate) => void; onClose: () => void }) {
  const [form, setForm] = useState<Omit<Candidate,'id'>>({
    name: cand?.name || '', jobTitle: cand?.jobTitle || jobs[0]?.title || '',
    stage: cand?.stage || 'مراجعة CV', rating: cand?.rating || 3,
    applyDate: cand?.applyDate || new Date().toISOString().slice(0,10),
    phone: cand?.phone || '', notes: cand?.notes || '',
  });
  const set = (k: keyof typeof form, v: string | number) => setForm(p => ({ ...p, [k]: v }));
  function save() {
    if (!form.name.trim()) { toast.error("يرجى إدخال اسم المرشح"); return; }
    onSave({ id: cand?.id ?? nextCandId++, ...form });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', direction: 'rtl' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ fontFamily: 'Alexandria', fontWeight: 800, fontSize: '16px', color: peoplePrimary }}>{cand ? 'تعديل مرشح' : 'إضافة مرشح جديد'}</h3>
          <button onClick={onClose}><X size={18} color="hsl(var(--muted-foreground))" /></button>
        </div>
        <div className="flex flex-col gap-3">
          {[['name','اسم المرشح *'],['phone','رقم الجوال']].map(([k,label]) => (
            <div key={k}>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>{label}</label>
              <input value={(form as any)[k]} onChange={e => set(k as any, e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none' }} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>الوظيفة</label>
              <select value={form.jobTitle} onChange={e => set('jobTitle', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'12px',outline:'none' }}>
                {jobs.map(j => <option key={j.id} value={j.title}>{j.title}</option>)}
                <option value="أخرى">أخرى</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>المرحلة</label>
              <select value={form.stage} onChange={e => set('stage', e.target.value)}
                style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'12px',outline:'none' }}>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>التقييم (1-5)</label>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => set('rating', n)}
                  style={{ width:'32px',height:'32px',borderRadius:'8px',fontFamily:'Alexandria',fontWeight:700,fontSize:'13px',
                    background: form.rating >= n ? peoplePrimary : 'hsl(var(--border))',
                    color: form.rating >= n ? 'white' : 'hsl(var(--muted-foreground))',
                    border: '1px solid hsl(var(--border))' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontFamily:'Alexandria',fontSize:'12px',color:'hsl(var(--muted-foreground))',display:'block',marginBottom:'4px' }}>ملاحظات</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              style={{ width:'100%',padding:'8px 12px',borderRadius:'8px',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontFamily:'Alexandria',fontSize:'13px',outline:'none',resize:'none' }} />
          </div>
          <div className="flex gap-3 mt-2">
            <button className="btn-brand flex-1 flex items-center justify-center gap-2" onClick={save}><Check size={14}/><span>حفظ</span></button>
            <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ fontFamily:'Alexandria',background:'hsl(var(--border))',border:'1px solid hsl(var(--border))',color:'hsl(var(--muted-foreground))' }}>إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Recruitment() {
  const [activeTab, setActiveTab] = useState<"jobs" | "pipeline" | "candidates" | "advanced-pipeline">("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [showJobModal, setShowJobModal] = useState(false);
  const [showCandModal, setShowCandModal] = useState(false);
  const [editJob, setEditJob] = useState<Job | undefined>();
  const [editCand, setEditCand] = useState<Candidate | undefined>();

  const filteredJobs = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.trim();
    return jobs.filter(j => j.title.includes(q) || j.department.includes(q));
  }, [jobs, search]);

  const filteredCands = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.trim();
    return candidates.filter(c => c.name.includes(q) || c.jobTitle.includes(q));
  }, [candidates, search]);

  function saveJob(j: Job) {
    setJobs(prev => prev.some(x => x.id === j.id) ? prev.map(x => x.id === j.id ? j : x) : [j, ...prev]);
    toast.success(editJob ? "تم تحديث الوظيفة" : "تمت إضافة الوظيفة بنجاح");
    setShowJobModal(false); setEditJob(undefined);
  }
  function deleteJob(id: number) {
    setJobs(prev => prev.filter(j => j.id !== id));
    toast.success("تم حذف الوظيفة");
  }
  function saveCand(c: Candidate) {
    setCandidates(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]);
    toast.success(editCand ? "تم تحديث بيانات المرشح" : "تمت إضافة المرشح بنجاح");
    setShowCandModal(false); setEditCand(undefined);
  }
  function deleteCand(id: number) {
    setCandidates(prev => prev.filter(c => c.id !== id));
    toast.success("تم حذف المرشح");
  }

  return (
    <PageTemplate
      title="الاستقطاب والتوظيف"
      subtitle="إدارة الوظائف الشاغرة والمرشحين وخط سير التوظيف"
      icon={UserPlus}
      stats={[
        { label: "وظائف مفتوحة", value: String(jobs.filter(j=>j.status==='مفتوح').length), color: peoplePrimary },
        { label: "إجمالي المرشحين", value: String(candidates.length), color: "hsl(165 60% 55%)" },
        { label: "في المقابلات", value: String(candidates.filter(c=>c.stage.includes('مقابلة')).length), color: "#F59E0B" },
        { label: "عروض مقدمة", value: String(candidates.filter(c=>c.stage==='عرض وظيفي'||c.stage==='مقبول').length), color: "#8B5CF6" },
      ]}
      actions={
        <div className="flex gap-2">
          <button className="btn-brand flex items-center gap-2" onClick={() => { setEditJob(undefined); setShowJobModal(true); }}>
            <Briefcase size={14} /><span>إضافة وظيفة</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ fontFamily: 'Alexandria', background: 'hsl(var(--border))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            onClick={() => { setEditCand(undefined); setShowCandModal(true); }}>
            <UserPlus size={14} /><span>إضافة مرشح</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ fontFamily: 'Alexandria', background: 'hsl(var(--border))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            onClick={() => { exportRecruitment(candidates); }}>
            <Download size={14} /><span>تصدير Excel</span>
          </button>
        </div>
      }
    >
      {/* Search */}
      <div className="relative" style={{ maxWidth: '320px' }}>
        <Search size={14} style={{ position:'absolute',right:'12px',top:'50%',transform:'translateY(-50%)',color:'hsl(var(--muted-foreground))' }} />
        <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ width:'100%',padding:'9px 36px 9px 14px',borderRadius:'10px',background:'hsl(var(--muted))',border:'1px solid hsl(var(--border))',color:'hsl(var(--foreground))',fontSize:'13px',fontFamily:'Alexandria',direction:'rtl',outline:'none' }} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg w-fit" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--muted))' }}>
        {[{ key: "jobs", label: "الوظائف الشاغرة" }, { key: "pipeline", label: "خط سير التوظيف" }, { key: "candidates", label: "المرشحون" }, { key: "advanced-pipeline", label: "أنابيب متقدم (AI)" }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className="px-4 py-2 rounded-md text-sm font-semibold transition-all"
            style={{ fontFamily: 'Alexandria', background: activeTab === tab.key ? peoplePrimary : 'transparent', color: activeTab === tab.key ? 'white' : 'hsl(var(--muted-foreground))' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Jobs tab */}
      {activeTab === "jobs" && (
        <div className="card-brand rounded-xl overflow-hidden">
          {filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Inbox size={32} color="#1FA98C" style={{ opacity: 0.5 }} />
              <p style={{ fontFamily:'Alexandria',fontWeight:700,fontSize:'14px',color:'hsl(var(--muted-foreground))' }}>لا توجد وظائف شاغرة بعد</p>
              <button className="btn-brand flex items-center gap-2 mt-2" onClick={() => { setEditJob(undefined); setShowJobModal(true); }}>
                <Plus size={14}/><span>إضافة وظيفة</span>
              </button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={thS}>المسمى الوظيفي</th>
                  <th style={thS}>الإدارة</th>
                  <th style={thS}>النوع</th>
                  <th style={thS}>الموقع</th>
                  <th style={thS}>الشواغر</th>
                  <th style={thS}>الحالة</th>
                  <th style={thS}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map(j => (
                  <tr key={j.id}>
                    <td style={{ ...tdS, fontWeight: 700, color: '#1FA98C' }}>{j.title}</td>
                    <td style={tdS}>{j.department}</td>
                    <td style={tdS}><span style={{ fontFamily:'Alexandria',fontSize:'11px',padding:'3px 10px',borderRadius:'20px',background:'hsl(165 69% 39% / 0.12)',color:'#1FA98C' }}>{j.type}</span></td>
                    <td style={tdS}>{j.location}</td>
                    <td style={{ ...tdS, textAlign: 'center' }}>{j.count}</td>
                    <td style={tdS}><span style={{ fontFamily:'Alexandria',fontSize:'11px',padding:'3px 10px',borderRadius:'20px',background:j.status==='مفتوح'?'hsl(165 69% 39% / 0.12)':'rgba(245,158,11,0.12)',color:j.status==='مفتوح'?'#1FA98C':'#F59E0B' }}>{j.status}</span></td>
                    <td style={tdS}>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditJob(j); setShowJobModal(true); }} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(59,130,246,0.12)',color:'#3B82F6',border:'none',cursor:'pointer' }}><Edit2 size={12}/></button>
                        <button onClick={() => deleteJob(j.id)} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'none',cursor:'pointer' }}><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pipeline tab */}
      {activeTab === "pipeline" && (
        <div className="card-brand rounded-xl p-5">
          <p className="section-title mb-4">خط سير التوظيف (Kanban)</p>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            {stages.map(stage => {
              const stageCands = candidates.filter(c => c.stage === stage);
              return (
                <div key={stage} className="rounded-lg p-3" style={{ background: 'hsl(var(--muted))', minWidth: '140px' }}>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontFamily:'Alexandria',fontWeight:700,fontSize:'12px',color:stageColors[stage] }}>{stage}</span>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background:`${stageColors[stage]}20`,color:stageColors[stage],fontFamily:'Alexandria' }}>{stageCands.length}</span>
                  </div>
                  {stageCands.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-4 gap-1">
                      <Inbox size={16} color="hsl(var(--border))" />
                      <span style={{ fontFamily:'Alexandria',fontSize:'10px',color:'hsl(var(--muted-foreground))' }}>فارغ</span>
                    </div>
                  ) : stageCands.map(c => (
                    <div key={c.id} className="rounded-lg p-2 mb-2" style={{ background:'hsl(var(--card))',border:'1px solid hsl(var(--muted))' }}>
                      <p style={{ fontFamily:'Alexandria',fontWeight:700,fontSize:'11px',color:'hsl(var(--foreground))' }}>{c.name}</p>
                      <p style={{ fontFamily:'Alexandria',fontSize:'10px',color:'hsl(var(--muted-foreground))',marginTop:'2px' }}>{c.jobTitle}</p>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Candidates tab */}
      {activeTab === "candidates" && (
        <div className="card-brand rounded-xl overflow-hidden">
          {filteredCands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Inbox size={32} color="#1FA98C" style={{ opacity: 0.5 }} />
              <p style={{ fontFamily:'Alexandria',fontWeight:700,fontSize:'14px',color:'hsl(var(--muted-foreground))' }}>لا يوجد مرشحون بعد</p>
              <button className="btn-brand flex items-center gap-2 mt-2" onClick={() => { setEditCand(undefined); setShowCandModal(true); }}>
                <Plus size={14}/><span>إضافة مرشح</span>
              </button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={thS}>المرشح</th>
                  <th style={thS}>الوظيفة</th>
                  <th style={thS}>المرحلة</th>
                  <th style={thS}>التقييم</th>
                  <th style={thS}>تاريخ التقديم</th>
                  <th style={thS}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredCands.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...tdS, fontWeight: 700 }}>{c.name}</td>
                    <td style={{ ...tdS, color:'hsl(var(--muted-foreground))' }}>{c.jobTitle}</td>
                    <td style={tdS}><span style={{ fontFamily:'Alexandria',fontSize:'11px',padding:'3px 10px',borderRadius:'20px',background:`${stageColors[c.stage] || '#888'}20`,color:stageColors[c.stage]||'#888' }}>{c.stage}</span></td>
                    <td style={tdS}><span style={{ fontFamily:'Alexandria',fontWeight:700,color:'#F59E0B' }}>{'★'.repeat(c.rating)}{'☆'.repeat(5-c.rating)}</span></td>
                    <td style={{ ...tdS, color:'hsl(var(--muted-foreground))' }}>{c.applyDate}</td>
                    <td style={tdS}>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditCand(c); setShowCandModal(true); }} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(59,130,246,0.12)',color:'#3B82F6',border:'none',cursor:'pointer' }}><Edit2 size={12}/></button>
                        <button onClick={() => deleteCand(c.id)} style={{ padding:'4px 8px',borderRadius:'6px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'none',cursor:'pointer' }}><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Advanced Pipeline tab */}
      {activeTab === "advanced-pipeline" && (
        <RecruitmentPipelineContent />
      )}

      {showJobModal && <JobModal job={editJob} onSave={saveJob} onClose={() => { setShowJobModal(false); setEditJob(undefined); }} />}
      {showCandModal && <CandidateModal cand={editCand} jobs={jobs} onSave={saveCand} onClose={() => { setShowCandModal(false); setEditCand(undefined); }} />}
    </PageTemplate>
  );
}
