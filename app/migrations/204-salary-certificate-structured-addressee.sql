-- تنشر نسخة جديدة من خدمة تعريف الراتب عند ترقية قاعدة تحمل النموذج النصي القديم.
-- القوائم تُبنى من الدليل النشط بعد ترحيل 203؛ الطلبات السابقة تظل مرتبطة بنسختها القديمة.
INSERT INTO services(
  id,tenant_id,code,name_ar,name_en,department_id,description,fields,approval_policy,version,active
)
SELECT
  lower(hex(randomblob(16))),
  current.tenant_id,
  current.code,
  current.name_ar,
  current.name_en,
  current.department_id,
  current.description,
  json_array(
    json_object('key','recipient_kind','label','نوع الجهة','type','select','required',json('true'),'options',json('["بنك","سفارة","جهة حكومية","لمن يهمه الأمر","جهة أخرى"]')),
    json_object('key','recipient_bank','label','البنك','type','select','required',json('true'),'options',json((SELECT json_group_array(name_ar) FROM (SELECT name_ar FROM letter_addressees WHERE kind='bank' AND active=1 ORDER BY name_ar))),'show_when',json('{"field":"recipient_kind","equals":["بنك"]}')),
    json_object('key','recipient_embassy','label','السفارة','type','select','required',json('true'),'options',json((SELECT json_group_array(name_ar) FROM (SELECT name_ar FROM letter_addressees WHERE kind='embassy' AND active=1 ORDER BY name_ar))),'show_when',json('{"field":"recipient_kind","equals":["سفارة"]}')),
    json_object('key','recipient_government','label','الجهة الحكومية','type','select','required',json('true'),'options',json((SELECT json_group_array(name_ar) FROM (SELECT name_ar FROM letter_addressees WHERE kind='government' AND active=1 ORDER BY name_ar))),'show_when',json('{"field":"recipient_kind","equals":["جهة حكومية"]}')),
    json_object('key','recipient_other','label','اسم الجهة','type','text','required',json('true'),'show_when',json('{"field":"recipient_kind","equals":["جهة أخرى"]}')),
    json_extract(current.fields,'$[1]'),
    json_extract(current.fields,'$[2]'),
    json_extract(current.fields,'$[3]')
  ),
  current.approval_policy,
  current.version+1,
  current.active
FROM services current
WHERE current.code='HR-SALARY-CERT'
  AND current.version=(SELECT MAX(latest.version) FROM services latest WHERE latest.tenant_id=current.tenant_id AND latest.code=current.code)
  AND json_extract(current.fields,'$[0].key')='recipient';
