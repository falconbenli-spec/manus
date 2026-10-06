import test from 'node:test';
import assert from 'node:assert/strict';
import { invoicePrintable, payslipPrintable } from '../app/print-documents.mjs';

const seller={legal_name:'شركة مصطنعة <للتسويق>',vat_number:'300000000000003',cr_number:'1010000000',address:{building:'1234',street:'طريق مصطنع',district:'حي مصطنع',city:'الرياض',postal_code:'12345',country:'SA'}};
const invoice={kind:'invoice',number:'INV-2026-000001',status:'issued',status_name:'صادرة',issued_at:'2026-09-17T10:00:00.000Z',supply_date:'2026-09-15',seller,buyer:{legal_name:'عميل مصطنع',vat_number:'',address:'الرياض'},
  lines:[{description:'تصميم هوية مصطنع',quantity:'1',net_minor:100000,vat_minor:15000,total_minor:115000}],vat_basis_points:1500,currency:'SAR',net_minor:100000,vat_minor:15000,total_minor:115000,qr_tlv:'AQ1TeW50aGV0aWM=',hash:'a'.repeat(64),prepared_by_name:'محاسب مصطنع',issued_by_name:'معتمد مصطنع',original_number:null,vat_reason:'',reason:''};

test('printable invoice: an issued invoice carries its QR symbol and says plainly it was not reported to Fatoora; a draft carries neither number nor QR',()=>{
  const html=invoicePrintable(invoice);
  assert.match(html,/<svg [^>]*role="img"/);assert.match(html,/لم تُبلَّغ لمنصة «فاتورة»/);assert.match(html,/1,150\.00/);
  assert.match(html,/شركة مصطنعة &lt;للتسويق&gt;/,'names are escaped');assert.doesNotMatch(html,/style=|<script/);
  const draft=invoicePrintable({...invoice,status:'draft',status_name:'مسودة',number:null,issued_at:null,qr_tlv:null,issued_by_name:null});
  // الحزمة 3: علامة «داخلية — ما تبلّغت» رسمٌ SVG على كل نسخة؛ الرمز QR وحده ما يحمله المسودة.
  assert.doesNotMatch(draft,/رمز الاستجابة السريعة/);assert.match(draft,/class="watermark"/);assert.match(draft,/ليست مستندًا ضريبيًا/);
});

test('printable payslip: earnings, additions and deductions reconcile to the net shown',()=>{
  const slip={month:'2026-08',earnings:[{component:'basic',monthly_minor:800000,amount_minor:800000},{component:'housing',monthly_minor:200000,amount_minor:200000}],adjustments:[{kind:'bonus',kind_name:'مكافأة',reason:'مكافأة مصطنعة',amount_minor:50000},{kind:'advance_installment',kind_name:'قسط سلفة',reason:'قسط 1 من 3',amount_minor:33334}],
    gross_minor:1000000,additions_minor:50000,advance_minor:33334,other_deductions_minor:0,unpaid_absence_minor:0,social_insurance_minor:100000,net_minor:916666,basis:{parts:[{rule:'قاعدة مصطنعة للاحتساب'}]}};
  const html=payslipPrintable(slip,{name:'الموظفة التجريبية',department:'الفريق الإبداعي'});
  assert.match(html,/10,500\.00/,'gross plus additions');assert.match(html,/1,333\.34/,'all deductions');assert.match(html,/9,166\.66/);assert.match(html,/سرية/);
  assert.equal(slip.gross_minor+slip.additions_minor-(slip.unpaid_absence_minor+slip.social_insurance_minor+slip.advance_minor+slip.other_deductions_minor),slip.net_minor);
});
