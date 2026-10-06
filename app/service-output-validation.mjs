import { refuse } from './refusal.mjs';
import { moneyMinor } from './validation.mjs';
import { riyadhToday } from './payroll-rules.mjs';

export function validateOutputRecordState(db, request, code, source, record) {
  const reject = why => refuse(409, 'output_record_not_ready', {
    what: 'السجل موجود، لكنه لا يثبت تسليم هذه الخدمة لهذا الطلب',
    missing: [{ document: 'مخرج صحيح مرتبط بالطلب', why, owner: 'منفذ الطلب', owner_role: 'handler' }],
    next: 'صحّح المخرج في وحدته، ثم سجّل المرجع الصحيح في الطلب', link: `#request/${request.id}`
  });
  if (source === 'employee_changes') {
    if (record.user_id !== request.requester_id) reject('الحركة تخص موظفًا غير صاحب الطلب');
    if (record.request_id !== request.id) reject('الحركة غير مرتبطة بهذا الطلب');
    if (record.cancelled_at) reject('الحركة ملغاة');
  }
  if (source === 'employee_bank_accounts') {
    if (record.user_id !== request.requester_id) reject('الحساب البنكي يخص موظفًا غير صاحب الطلب');
    if (record.status !== 'verified') reject('الحساب البنكي لم يُتحقق منه بقرار مستقل');
  }
  if (source === 'campaigns') {
    if (record.status === 'cancelled') reject('الحملة ملغاة');
    if (code === 'DIG-CAMPAIGN-CLOSE' && record.status !== 'completed') reject('الحملة لم تُقفل بنتائجها ودروسها بعد');
  }
  if (source === 'lifecycle_bundles') {
    if (code !== 'IT-NEW-ACCOUNT' && record.employee_id !== request.requester_id) reject('الحزمة تخص موظفًا غير صاحب الطلب');
    const kind = code === 'IT-NEW-ACCOUNT' ? 'onboarding' : 'offboarding';
    if (record.kind !== kind) reject('نوع الحزمة لا يطابق خدمة الانضمام أو المغادرة المطلوبة');
    if (record.status === 'cancelled') reject('الحزمة ملغاة');
  }
  if (source === 'commercial_cases') {
    if (code === 'CRM-PRICING' && !['quote_approved','contracted','project_active'].includes(record.status)) reject('تسعير الفرصة لم يُعتمد');
    if (['CRM-HANDOVER','PMO-NEW-PROJECT'].includes(code) && (record.status !== 'project_active' || !record.project_id)) reject('الفرصة لم تُسلّم إلى مشروع تشغيل مرتبط بها');
  }
  if (source === 'salary_advances') {
    if (record.user_id !== request.requester_id) reject('السلفة تخص موظفًا غير صاحب الطلب');
    if (record.status !== 'approved') reject('السلفة لم تُعتمد بقرار مستقل');
    const payload = JSON.parse(request.payload);
    if (payload.amount != null && moneyMinor(String(payload.amount), 'مبلغ السلفة المطلوب') !== record.amount_minor) reject('مبلغ السلفة لا يطابق الطلب');
    if (payload.installments != null && Number(payload.installments) !== record.installments) reject('أقساط السلفة لا تطابق خطة السداد المطلوبة');
  }
  if (source === 'employee_documents') {
    if (record.user_id !== request.requester_id) reject('الوثيقة تخص موظفًا غير صاحب الطلب');
    if (record.replaced_by) reject('الوثيقة استُبدلت بنسخة أخرى');
    if (record.expires_on <= riyadhToday()) reject('الوثيقة منتهية ولا تثبت اكتمال التجديد');
    const payload = JSON.parse(request.payload);
    const expectedType = { 'الإقامة': 'iqama', 'رخصة العمل': 'work_permit' }[payload.document];
    if (expectedType && record.doc_type !== expectedType) reject('نوع الوثيقة لا يطابق طلب التجديد');
    if (payload.expiry_date && record.expires_on <= payload.expiry_date) reject('تاريخ انتهاء الوثيقة لا يثبت تجديد المدة المطلوبة');
  }
}
