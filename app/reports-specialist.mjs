import { can } from './access.mjs';
import { memberClients } from './agency.mjs';
import { STATES as PRODUCTION_STATES } from './production.mjs';
import { CONTENT_KINDS, ENGAGEMENT_STATES } from './influencers.mjs';
import { OUTLET_TYPES, TONES } from './pr.mjs';
import { ROUTE_STATUS } from './review-rounds.mjs';
import { riyadhDateOf, riyadhToday } from './riyadh-time.mjs';

// التقارير المتخصصة (الحزمة 4، DOMAIN-4): الإنتاج والمعدات، وتسليم المؤثرين ومدفوعاتهم، والتغطية الإعلامية، وجولات المراجعة.
// كل تقرير يقرأ سجل وحدته لحظة الطلب بصلاحية الوحدة نفسها ونطاقها؛ فلا يفتح تقريرٌ ما لا تفتحه شاشة وحدته.
// وما يأخذه تقرير العميل منها (تسليم المؤثرين والتغطية) يُقرأ بالدالتين نفسيهما أدناه، فرقم العميل هو رقم التقرير.
// الأرقام أعداد وسجلات أدخلها موظفون بمصادرها: لا متابعين ولا مشاهدات ولا وصول، ولا «قيمة إعلانية» للتغطية.
const sar=minor=>Math.round(Number(minor))/100;
const marks=list=>list.map(()=>'?').join(',');
const label=(list,key)=>list.find(x=>x.key===key)?.name??key;
const days=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const clientName=c=>c?c.trade_name||c.legal_name:'';
function accounts(db,u){try{return memberClients(db,u);}catch(error){if(error.status===403)return [];throw error;}}
const KIND_FIELD={post:'posts_count',story:'stories_count',video:'videos_count'};

/* ───── القراءات المشتركة ───── */
// تسليم المؤثرين لعملاء بعينهم: الارتباطات السارية والمقفلة والملغاة التي تقاطعت مدتها مع الفترة، بمخرجاتها المتعاقد عليها،
// وما نُشر منها لين نهاية الفترة (إثبات نشر مسجل) وما تحقق منه إنسان، وأتعابها، وأوامر الدفع المربوطة بها في مسار المدفوعات.
export function influencerDelivery(db,tenantId,clientIds,{from,to}){
  if(!clientIds.length)return [];
  return db.prepare(`SELECT g.*,i.stage_name,c.name AS campaign_name FROM influencer_engagements g JOIN influencers i ON i.id=g.influencer_id LEFT JOIN campaigns c ON c.id=g.campaign_id
      WHERE g.tenant_id=? AND g.client_id IN (${marks(clientIds)}) AND g.status IN ('active','completed','cancelled') AND g.starts_on<=? AND g.ends_on>=? ORDER BY g.starts_on,g.id`)
    .all(tenantId,...clientIds,to,from).map(g=>{
      const proofs=db.prepare(`SELECT x.kind,x.title,f.post_url,f.published_on,f.verified_by IS NOT NULL AS verified FROM influencer_proofs f JOIN influencer_content x ON x.id=f.content_id
        WHERE x.engagement_id=? AND f.published_on<=? ORDER BY f.published_on,f.id`).all(g.id,to).map(p=>({...p,verified:!!p.verified}));
      const kinds=CONTENT_KINDS.map(k=>({key:k.key,name:k.name,promised:g[KIND_FIELD[k.key]],proofs:proofs.filter(p=>p.kind===k.key)}))
        .filter(k=>k.promised>0||k.proofs.length).map(k=>({...k,published:k.proofs.length,verified:k.proofs.filter(p=>p.verified).length}));
      const orders=db.prepare(`SELECT p.proof_state,o.status,o.amount_minor,EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id) AS returned
        FROM influencer_payments p JOIN payment_orders o ON o.id=p.payment_order_id WHERE p.engagement_id=?`).all(g.id);
      const live=orders.filter(o=>['pending','approved','executed'].includes(o.status)),sum=list=>list.reduce((n,o)=>n+o.amount_minor,0);
      return {id:g.id,client_id:g.client_id,title:g.title,influencer_name:g.stage_name,campaign_name:g.campaign_name??'',status:g.status,status_name:ENGAGEMENT_STATES[g.status],
        starts_on:g.starts_on,ends_on:g.ends_on,kinds,promised:kinds.reduce((n,k)=>n+k.promised,0),published:proofs.length,verified:proofs.filter(p=>p.verified).length,
        fee_minor:g.fee_minor,linked_minor:sum(live),paid_minor:sum(live.filter(o=>o.status==='executed'&&!o.returned)),paid_before_proof:live.filter(o=>o.proof_state==='written_exception').length};
    });
}
// التغطية الإعلامية المنشورة في الفترة (تاريخ النشر يوم رياض كما أدخله من سجّلها)، لعميل بعينه أو للكيان كله. بلا بيانات جهات الإعلام الشخصية.
export function prCoverage(db,tenantId,{from,to,clientId=null}){
  return db.prepare(`SELECT v.id,v.client_id,v.outlet,v.outlet_type,v.title,v.url,v.published_on,v.tone,v.highlight,k.trade_name,k.legal_name,c.name AS campaign_name
      FROM pr_coverage v LEFT JOIN clients k ON k.id=v.client_id LEFT JOIN campaigns c ON c.id=v.campaign_id
      WHERE v.tenant_id=? AND v.published_on BETWEEN ? AND ? ${clientId?'AND v.client_id=?':''} ORDER BY v.published_on,v.id`)
    .all(tenantId,from,to,...(clientId?[clientId]:[]))
    .map(r=>({id:r.id,client_id:r.client_id,client_name:r.client_id?clientName(r):'',campaign_name:r.campaign_name??'',outlet:r.outlet,outlet_type:r.outlet_type,outlet_type_name:label(OUTLET_TYPES,r.outlet_type),
      title:r.title,url:r.url,published_on:r.published_on,tone:r.tone,tone_name:TONES[r.tone],highlight:!!r.highlight}));
}
export const toneCounts=rows=>Object.fromEntries(Object.keys(TONES).map(t=>[t,rows.filter(r=>r.tone===t).length]));

/* ───── التقارير ───── */
export const SPECIALIST_REPORTS=[
  {key:'R42',group:'الحملات والإبداع',title:'الإنتاج والمعدات',definition:'كل إنتاج تقاطعت أيام تصويره مع الفترة: طاقمه، وتصاريح الصورة والمواقع الناقصة، ولقطاته، والمعدات المحجوزة له أو الطالعة عليه وما رجع منها بضرر — بلا أي أجر أو تكلفة.',
    source:'productions + production_crew (العدد فقط) + production_talent + production_locations + shot_list + equipment_bookings + equipment_movements',allowed:(db,u)=>can(db,u,'production.manage'),
    run(db,u,{from,to}){
      const n=(sql,...args)=>db.prepare(sql).get(...args).n;
      // لا يُقرأ هنا day_rate_minor ولا cost_minor ولا أي مبلغ: الأعداد وحدها.
      const rows=db.prepare('SELECT id,code,title,status,shoot_from,shoot_to FROM productions WHERE tenant_id=? AND shoot_from<=? AND shoot_to>=? ORDER BY shoot_from,code').all(u.tenant_id,to,from).map(p=>({
        code:p.code,title:p.title,status:PRODUCTION_STATES[p.status],shoot_from:p.shoot_from,shoot_to:p.shoot_to,
        crew:n('SELECT COUNT(*) AS n FROM production_crew WHERE production_id=? AND active=1',p.id),
        external_crew:n("SELECT COUNT(*) AS n FROM production_crew WHERE production_id=? AND active=1 AND source='external'",p.id),
        releases_missing:n("SELECT COUNT(*) AS n FROM production_talent WHERE production_id=? AND active=1 AND (release_status<>'signed' OR (release_valid_until IS NOT NULL AND release_valid_until<?))",p.id,to),
        permits_missing:n("SELECT COUNT(*) AS n FROM production_locations WHERE production_id=? AND active=1 AND permit_required=1 AND (permit_status<>'obtained' OR (permit_expires_on IS NOT NULL AND permit_expires_on<?))",p.id,to),
        shots_done:n("SELECT COUNT(*) AS n FROM shot_list WHERE production_id=? AND status='shot'",p.id),
        shots_total:n('SELECT COUNT(*) AS n FROM shot_list WHERE production_id=?',p.id),
        equipment_live:n("SELECT COUNT(*) AS n FROM equipment_bookings WHERE production_id=? AND tenant_id=? AND status IN ('reserved','out')",p.id,u.tenant_id),
        equipment_damaged:n("SELECT COUNT(*) AS n FROM equipment_movements m JOIN equipment_bookings b ON b.id=m.booking_id WHERE b.production_id=? AND b.tenant_id=? AND m.kind='in' AND m.condition_state<>'good'",p.id,u.tenant_id)}));
      return {columns:[['code','الرمز','text'],['title','الإنتاج','text'],['status','الحالة','text'],['shoot_from','يبدأ التصوير','text'],['shoot_to','ينتهي التصوير','text'],['crew','الطاقم','number'],['external_crew','منهم مستقلون','number'],
          ['releases_missing','تصريح صورة ناقص','number'],['permits_missing','تصريح موقع ناقص','number'],['shots_done','لقطات صُوّرت','number'],['shots_total','اللقطات','number'],['equipment_live','معدات محجوزة أو طالعة','number'],['equipment_damaged','رجعت بضرر أو نقص','number']],
        rows,notes:['ما فيه أجر ولا تكلفة: معدل يوم المستقل وأجر الموظف وتكلفة صيانة المعدات ما تطلع هنا؛ ومستحق المستقل يمشي في المشتريات والمدفوعات.',
          'الإنتاج يدخل إذا تقاطعت أيام تصويره مع الفترة. الطاقم والمشاركون والمواقع النشطة وحدها.',
          'تصريح الصورة الناقص: مشارك ما وقّع تصريحه، أو انتهت مدته قبل نهاية الفترة. وتصريح الموقع الناقص: موقع يحتاج تصريح ما صدر، أو صدر وانتهى قبل نهاية الفترة.',
          'المعدات من الحجوزات المربوطة بالإنتاج نفسه؛ و«رجعت بضرر أو نقص» من محضر الاستلام وقت رجوعها. والمحجوزة أو الطالعة حالها الحين.']};
    }},
  {key:'R43',group:'الحملات والإبداع',title:'تسليم المؤثرين ومدفوعاتهم',definition:'كل ارتباط مؤثر تقاطعت مدته مع الفترة: مخرجاته المتعاقد عليها، وما نُشر منها وما تحقق منه إنسان، وأتعابه وأوامر الدفع المربوطة به وما تحوّل منها، والدفعات اللي سبقت إثبات النشر.',
    source:'influencer_engagements + influencer_content + influencer_proofs + influencer_payments + payment_orders + payment_returns',
    // كشاشة ارتباطات المؤثرين: التصريح يفتحه وعضوية فريق الحساب تحدد صفوفه؛ ومن يحمل التصريح خارج فرق الحسابات يفتحه فارغًا.
    allowed:(db,u)=>can(db,u,'influencers.manage'),
    run(db,u,{from,to}){
      const clients=accounts(db,u),byId=new Map(clients.map(c=>[c.id,c])),sum={fee:0,linked:0,paid:0};
      const rows=influencerDelivery(db,u.tenant_id,clients.map(c=>c.id),{from,to}).map(g=>{
        sum.fee+=g.fee_minor;sum.linked+=g.linked_minor;sum.paid+=g.paid_minor;
        return {client:clientName(byId.get(g.client_id)),campaign:g.campaign_name,influencer:g.influencer_name,status:g.status_name,promised:g.promised,published:g.published,verified:g.verified,
          fee:sar(g.fee_minor),linked:sar(g.linked_minor),paid:sar(g.paid_minor),paid_before_proof:g.paid_before_proof};
      });
      return {columns:[['client','العميل','text'],['campaign','الحملة','text'],['influencer','المؤثر','text'],['status','حالة الارتباط','text'],['promised','المخرجات المتعاقد عليها','number'],
          ['published','نُشر لين نهاية الفترة','number'],['verified','منها إثبات متحقق منه','number'],['fee','الأتعاب','money'],['linked','أوامر دفع مربوطة','money'],['paid','المحوَّل وما رجع','money'],['paid_before_proof','دفعات قبل إثبات النشر','number']],
        rows,totals:Object.fromEntries(Object.entries(sum).map(([k,n])=>[k,sar(n)])),
        notes:['المخرجات والمنشور والإثبات من سجل الارتباط نفسه لين نهاية الفترة. الإثبات المتحقق منه فتح رابطه إنسان ووقّع باسمه؛ المنصة ما تزور منصات التواصل.',
          '«أوامر دفع مربوطة» ما ارتبط بالارتباط في مسار المدفوعات وما انرفض ولا انلغى؛ و«المحوَّل» المنفّذ اللي ما رجع. ما فيه دفع من شاشة المؤثرين.',
          '«دفعات قبل إثبات النشر» ربطٌ بقرار استثناء مكتوب من غير صاحب الارتباط.',
          'ما فيه متابعين ولا مشاهدات ولا تفاعل: كل رقم هنا سجل أدخله موظف.',
          'النطاق: حسابات العملاء اللي أنت في فريقها.']};
    }},
  {key:'R44',group:'الحملات والإبداع',title:'التغطية الإعلامية',definition:'كل تغطية منشورة في الفترة بوسيلتها ونوعها ونبرتها كما قدّرها من سجّلها، وأبرزها، وعميلها وحملتها؛ ومعها المراسلات المرسلة ونتائجها. عدٌّ لما سجّله الفريق، بلا قيمة إعلانية ولا وصول.',
    source:'pr_coverage + pr_pitches',allowed:(db,u)=>can(db,u,'pr.manage'),
    run(db,u,{from,to}){
      const coverage=prCoverage(db,u.tenant_id,{from,to}),tones=toneCounts(coverage);
      const pitches=db.prepare('SELECT status FROM pr_pitches WHERE tenant_id=? AND sent_on BETWEEN ? AND ?').all(u.tenant_id,from,to),count=s=>pitches.filter(p=>p.status===s).length;
      return {columns:[['published_on','تاريخ النشر','text'],['outlet','الوسيلة','text'],['outlet_type','نوعها','text'],['title','العنوان','text'],['tone','النبرة كما قدّرها من سجّلها','text'],['highlight','من الأبرز','text'],['client','العميل','text'],['campaign','الحملة','text']],
        rows:coverage.map(r=>({published_on:r.published_on,outlet:r.outlet,outlet_type:r.outlet_type_name,title:r.title,tone:r.tone_name,highlight:r.highlight?'نعم':'',client:r.client_name,campaign:r.campaign_name})),
        notes:[`في الفترة ${coverage.length} تغطية: ${tones.positive} إيجابية، و${tones.neutral} محايدة، و${tones.negative} سلبية. النبرة تقدير من سجّل التغطية، مو تحليل آلي.`,
          `المراسلات المرسلة في الفترة ${pitches.length}: رُدّ على ${count('replied')}، ورُفضت ${count('declined')}، ونُشرت ${count('published')}.`,
          'كل تغطية برابط واحد ما يتكرر، فالخبر نفسه ما يرفع العدد مرتين.',
          'ما فيه «قيمة إعلانية» للتغطية ولا حصة صوت ولا وصول: تحويل الخبر إلى سعر إعلان ما انشرى مقياس غير معتمد، والرصد الإعلامي مو موصول.']};
    }},
  {key:'R45',group:'الحملات والإبداع',title:'جولات المراجعة',definition:'كل جولة مراجعة انفتحت في الفترة على نسخة مخرج في مشاريعك: حالتها ومدتها، ومراحلها وما صدر قراره منها، وقرارات «تعديلات مطلوبة»، والمراحل اللي فات موعدها، والتعليقات المفتوحة.',
    source:'review_routes + review_stages + review_decisions + review_annotations (مشاريع القارئ)',allowed:(db,u)=>can(db,u,'review.manage'),
    run(db,u,{from,to}){
      // العزل عزل شاشة جولات المراجعة نفسها: التصريح وحده لا يكفي، والجولة تُرى من مشاريع القارئ وحدها.
      // «فات موعدها» لا تَعِد بموعد لم يأت: المقارنة بأقرب اليومين، نهاية الفترة أو اليوم.
      const n=(sql,...args)=>db.prepare(sql).get(...args).n,late=[to,riyadhToday()].sort()[0];
      const rows=db.prepare(`SELECT r.id,r.name,r.output_revision,r.status,r.opened_at,r.closed_at,w.title AS workspace,p.name AS project FROM review_routes r
          JOIN studio_workspaces w ON w.id=r.studio_id JOIN projects p ON p.id=w.project_id JOIN project_members m ON m.project_id=p.id AND m.user_id=?
          WHERE r.tenant_id=? AND date(r.opened_at,'+3 hours') BETWEEN ? AND ? ORDER BY r.opened_at,r.id`).all(u.id,u.tenant_id,from,to).map(r=>{
        const opened=riyadhDateOf(r.opened_at),closed=r.closed_at?riyadhDateOf(r.closed_at):'';
        return {project:r.project,workspace:r.workspace,round:r.name,revision:r.output_revision,status:ROUTE_STATUS[r.status],opened,closed,days:closed?days(opened,closed):null,
          stages_decided:n("SELECT COUNT(*) AS n FROM review_stages WHERE route_id=? AND status='decided'",r.id),stages_total:n('SELECT COUNT(*) AS n FROM review_stages WHERE route_id=?',r.id),
          changes_required:n("SELECT COUNT(*) AS n FROM review_decisions WHERE route_id=? AND decision='changes_required'",r.id),
          overdue:n("SELECT COUNT(*) AS n FROM review_stages WHERE route_id=? AND status='open' AND due_on IS NOT NULL AND due_on<?",r.id,late),
          open_comments:n("SELECT COUNT(*) AS n FROM review_annotations a JOIN review_media x ON x.id=a.media_id WHERE x.route_id=? AND a.status='open'",r.id)};
      });
      return {columns:[['project','المشروع','text'],['workspace','مساحة العمل','text'],['round','الجولة','text'],['revision','النسخة','number'],['status','الحالة','text'],['opened','انفتحت','text'],['closed','انقفلت','text'],
          ['days','أيام المراجعة','number'],['stages_decided','مراحل صدر قرارها','number'],['stages_total','المراحل','number'],['changes_required','قرارات «تعديلات مطلوبة»','number'],['overdue','مراحل فات موعدها','number'],['open_comments','تعليقات مفتوحة','number']],
        rows,notes:['الجولة مسار مراجعة على نسخة واحدة من المخرج، والنسخة الجديدة جولة جديدة. تدخل الجولة إذا انفتحت في الفترة.',
          'المرحلة المتأخرة: مفتوحة الحين وموعدها فات قبل نهاية الفترة (أو قبل اليوم إن كانت الفترة ما خلصت)؛ والمرحلة اللي بلا مدة ما لها موعد.',
          '«أيام المراجعة» تقويمية من فتح الجولة لين قفلها، وفاضية للجارية.',
          'التعليقات المفتوحة الداخلية والمشتركة معًا، ونصها ما يطلع هنا.',
          'النطاق: المشاريع اللي أنت عضو فيها، مثل شاشة جولات المراجعة.']};
    }}
];
