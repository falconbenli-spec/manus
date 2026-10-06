// مؤشرات محسوبة من نموذج مملوء. لا تُكتب يدويًا ولا تُخزَّن: تُحسب عند القراءة من قيم النموذج نفسه.
//
// معدل التفاعل في MOD-PR-06 = التفاعل ÷ الوصول. الوصول صفر أو فارغ يعني «غير محسوب»، لا صفرًا ولا نجاحًا.
// والمؤشر لا يُقدَّم مؤشر أداء معتمدًا حتى يعتمد المالك تعريف KPI (الصيغة وحد النجاح)، فيُعرض «مؤشر غير معتمد».

export const ENGAGEMENT_KPI_PENDING='تعريف KPI لمعدل التفاعل غير معتمد بعد — يحتاج قرار مالك (الصيغة وحد النجاح)';
const count=value=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
};

// يعيد {computed:false} مع السبب متى تعذّر الحساب، ولا يعيد 0 بديلًا عن «لا نعرف».
export function engagementRate({engagement,reach},{kpiApproved=false}={}){
  const e=count(engagement),r=count(reach);
  const base={kpi:'engagement_rate',label:'معدل التفاعل %',formula:'التفاعل ÷ الوصول',approved:kpiApproved===true,
    ...(kpiApproved===true?{}:{approval_note:ENGAGEMENT_KPI_PENDING})};
  if(r===null)return {...base,computed:false,value:null,display:'غير محسوب',reason:'الوصول غير مُدخل'};
  if(r===0)return {...base,computed:false,value:null,display:'غير محسوب',reason:'الوصول صفر: لا يُقسم عليه ولا يُعرض صفرًا'};
  if(e===null)return {...base,computed:false,value:null,display:'غير محسوب',reason:'التفاعل غير مُدخل'};
  // نسبة مئوية بمنزلتين، بلا تقريب يرفع النتيجة فوق حقيقتها.
  const value=Math.floor(e/r*10000)/100;
  return {...base,computed:true,value,display:`${value.toFixed(2)}%`,reason:''};
}

// المؤشرات المحسوبة لكل نموذج بمعرّفه الداخلي. نموذج بلا مؤشرات يعيد قائمة فارغة.
export function derivedKpis(formKey,payload,options={}){
  if(formKey==='FORM-PR-PERFORMANCE')
    return [engagementRate({engagement:payload?.total_engagement,reach:payload?.total_reach},options)];
  return [];
}
