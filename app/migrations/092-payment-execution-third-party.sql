-- من يوثّق تنفيذ الدفعة في البنك شخص ثالث: لا من أعدّ أمر الدفع ولا من اعتمده.
-- القاعدة في الكود أيضًا، وهنا تُفرض في قاعدة البيانات حتى لا يتجاوزها أي مسار كتابة آخر.
CREATE TRIGGER payment_orders_execution_third_party BEFORE UPDATE OF execution_recorded_by ON payment_orders
WHEN NEW.execution_recorded_by IS NOT NULL AND NEW.execution_recorded_by IN (NEW.prepared_by,NEW.approved_by)
BEGIN SELECT RAISE(ABORT,'payment execution is recorded by a third person, not the preparer or the approver'); END;
