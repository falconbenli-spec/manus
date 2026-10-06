-- دمج 20260919: ترحيل 097 (الانضباط) سجّل في files.mjs نوع السجل discipline_case لأدلة القضية، لكنه لم يغيّر stored_files،
-- فكان قيد CHECK المغلق في 035 يرفض رفع أي دليل. ترحيل 098 استبدل القيد بسجل الأنواع stored_file_entity_types
-- ولم يُدرج فيه discipline_case لأن الفرعين بُنيا متوازيين. هذا الترحيل يضيف السطر وحده، ولا يعيد بناء أي جدول.
INSERT INTO stored_file_entity_types(entity_type,added_in) VALUES('discipline_case',104);
