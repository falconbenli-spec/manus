import { qrSvg } from './qr.mjs';
import { PAY_COMPONENTS } from './hr-contracts.mjs';
import { hijri } from './dates.mjs';
import { documentFooter, SYNTHETIC } from './tenant-identity.mjs';

// نسخ للطباعة من مستندات المنصة. المستخدم يحفظها PDF من المتصفح؛ لا مولّد PDF داخل المنصة.
// صفحة الفاتورة تعرض حالها كما هو: صادرة داخليًا، ولم تُبلَّغ لمنصة «فاتورة» ما دام الربط غير متصل.
// والذيل يقرأ tenants.demo_data (الترحيل 137) بدل أن يكتب بحرفه أن البيانات مصطنعة. الوسيط الأخير اختياري وافتراضه
// الحالة المصطنعة: موضع نداء لم يُحدَّث يبقى يطبع التحذير، ولا يسقط صامتًا عن مستند صار حقيقيًا.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=minor=>{const n=Number(minor),abs=Math.abs(n);return `${n<0?'-':''}${Math.floor(abs/100).toLocaleString('en-US')}.${String(abs%100).padStart(2,'0')}`;};
const page=(title,body,demoData)=>`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/report-print.css"></head><body class="doc">${body}<footer>${esc(documentFooter(demoData))}</footer></body></html>`;
const address=a=>!a?'':typeof a==='string'?a:[a.building,a.street,a.district,a.city,a.postal_code,a.country].filter(Boolean).join('، ');
const party=(title,p)=>`<section class="party"><h2>${esc(title)}</h2><p><strong>${esc(p.legal_name)}</strong></p><p>الرقم الضريبي: <bdi dir="ltr">${esc(p.vat_number||'غير مسجل ضريبيًا')}</bdi></p>${p.cr_number?`<p>السجل التجاري: <bdi dir="ltr">${esc(p.cr_number)}</bdi></p>`:''}<p>${esc(address(p.address))}</p></section>`;

// علامة ظاهرة على كل نسخة مطبوعة من الفاتورة (الحزمة 3): الفوترة الرسمية محاكاة محلية حتى يوجد ربط معتمد بمنصة «فاتورة»
// (app/integration-readiness.mjs)، فالنسخة تقول ذلك رسمًا قبل أي سطر. SVG بسماته لا بأنماط مضمّنة، ولونه لون النص (currentColor)
// فيتبع السمة ولا يخترع لونًا خارج الدليل، ويسمّيه قارئ الشاشة بـaria-label.
const WATERMARK='<svg class="watermark" role="img" aria-label="داخلية — ما تبلّغت لمنصة «فاتورة»" viewBox="0 0 640 84" width="100%" height="84" xmlns="http://www.w3.org/2000/svg">'
  +'<rect x="3" y="3" width="634" height="78" rx="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="12 7" opacity="0.55"/>'
  +'<text x="320" y="54" text-anchor="middle" font-size="32" font-weight="700" fill="currentColor" opacity="0.6">داخلية — ما تبلّغت</text></svg>';
export function invoicePrintable(d,demoData=SYNTHETIC){
  const title=d.kind==='invoice'?'فاتورة ضريبية':'إشعار دائن',issued=d.status==='issued';
  return page(`${title} ${d.number??''}`,`${WATERMARK}<header><p class="brand">3,6T</p><h1>${esc(title)}${d.number?` <bdi dir="ltr">${esc(d.number)}</bdi>`:''}</h1><p class="meta">${issued?`تاريخ الإصدار <bdi dir="ltr">${esc(d.issued_at)}</bdi> · `:''}تاريخ التوريد ${esc(d.supply_date)} (${esc(hijri(d.supply_date))})${d.original_number?` · على الفاتورة <bdi dir="ltr">${esc(d.original_number)}</bdi>`:''}${d.lines?.[0]?.client_po_number?` · أمر شراء العميل <bdi dir="ltr">${esc(d.lines[0].client_po_number)}</bdi>`:''}</p></header>
    <p class="notice">${issued?'صادرة داخليًا من المنصة. لم تُبلَّغ لمنصة «فاتورة» لدى هيئة الزكاة والضريبة والجمارك؛ الربط غير متصل.':`${esc(d.status_name)} — ليست مستندًا ضريبيًا: لا رقم قبل الإصدار.`}</p>
    <div class="parties">${party('البائع',d.seller)}${party('المشتري',d.buyer)}</div>
    <table><thead><tr><th>البيان</th><th>الكمية</th><th>الصافي</th><th>الضريبة ${esc(d.vat_basis_points/100)}%</th><th>الإجمالي</th></tr></thead><tbody>${d.lines.map(l=>`<tr><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${money(l.net_minor)}</td><td class="num">${money(l.vat_minor)}</td><td class="num">${money(l.total_minor)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th colspan="2">الإجمالي (${esc(d.currency)})</th><th class="num">${money(d.net_minor)}</th><th class="num">${money(d.vat_minor)}</th><th class="num">${money(d.total_minor)}</th></tr></tfoot></table>
    ${d.vat_reason?`<p class="meta">سبب عدم تطبيق النسبة الأساسية: ${esc(d.vat_reason)}</p>`:''}${d.reason?`<p class="meta">سبب الإشعار: ${esc(d.reason)}</p>`:''}
    ${issued&&d.qr_tlv?`<section class="qr">${qrSvg(d.qr_tlv,{scale:3})}<div><p><strong>رمز الاستجابة السريعة</strong></p><p class="meta">يحمل اسم البائع ورقمه الضريبي ووقت الإصدار والإجمالي والضريبة بترميز TLV.</p><p class="meta">بصمة السلسلة: <bdi dir="ltr">${esc(d.hash.slice(0,24))}</bdi></p></div></section>`:''}
    <p class="meta">أعدها ${esc(d.prepared_by_name)}${d.issued_by_name?` · أصدرها ${esc(d.issued_by_name)}`:''}</p>`,demoData);
}
export function payslipPrintable(s,employee,demoData=SYNTHETIC){
  const component=key=>PAY_COMPONENTS.find(c=>c.key===key)?.name??key,row=(label,amount,sign='')=>`<tr><td>${esc(label)}</td><td class="num">${sign}${money(amount)}</td></tr>`;
  const deductions=s.unpaid_absence_minor+s.social_insurance_minor+s.advance_minor+s.other_deductions_minor;
  return page(`قسيمة راتب ${s.month}`,`<header><p class="brand">3,6T</p><h1>قسيمة راتب <bdi dir="ltr">${esc(s.month)}</bdi></h1><p class="meta">${esc(employee.name)}${employee.department?` · ${esc(employee.department)}`:''}</p></header>
    <p class="notice">سرية: هذه القسيمة لصاحبها فقط، وكل فتح لها مسجل.</p>
    <table><thead><tr><th>الاستحقاقات</th><th>المبلغ (ريال)</th></tr></thead><tbody>${s.earnings.map(l=>row(component(l.component),l.amount_minor)).join('')}${s.adjustments.filter(a=>!['deduction','advance_installment'].includes(a.kind)).map(a=>row(`${a.kind_name} — ${a.reason}`,a.amount_minor)).join('')}</tbody><tfoot><tr><th>إجمالي الاستحقاقات</th><th class="num">${money(s.gross_minor+s.additions_minor)}</th></tr></tfoot></table>
    <table><thead><tr><th>الاستقطاعات</th><th>المبلغ (ريال)</th></tr></thead><tbody>${row('غياب غير مدفوع معتمد',s.unpaid_absence_minor)}${row('استقطاع التأمينات الاجتماعية (حصة الموظف)',s.social_insurance_minor)}${s.adjustments.filter(a=>['deduction','advance_installment'].includes(a.kind)).map(a=>row(`${a.kind_name} — ${a.reason}`,a.amount_minor)).join('')}</tbody><tfoot><tr><th>إجمالي الاستقطاعات</th><th class="num">${money(deductions)}</th></tr></tfoot></table>
    <p class="total">صافي الراتب: <bdi dir="ltr">${money(s.net_minor)}</bdi> ريال</p>
    <p class="meta">${esc(s.basis.parts[0].rule)}</p>`,demoData);
}
