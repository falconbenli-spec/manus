import test from 'node:test';
import assert from 'node:assert/strict';
import { requestLauncher } from '../app/static/request-picker.mjs';
test('عداد إنشاء الطلب يحسب البطاقات المعروضة بعد دمج خيارات الخدمة', () => {
  const services=['HR-A','HR-B','HR-C','HR-D'].map(code=>({id:code,code,department_id:'hr',name_ar:code,section:'خدمات',description:'خدمة تجريبية',fields:[],approval_policy:{steps:[]}}));
  const variants=[{code:'HR-GROUP',department_id:'hr',name_ar:'تحديث بياناتي',section:'خدمات',description:'خياران في بطاقة واحدة',options:[{code:'a',name_ar:'تواصل',service_code:'HR-A'},{code:'b',name_ar:'مؤهل',service_code:'HR-B'}]}];
  const html=requestLauncher({departments:[{id:'hr',name:'الموارد البشرية'}],services,variants,me:{department_id:'hr',can:[]},e:String});
  assert.match(html,/<p>3 خدمات من إدارة واحدة/);
  assert.match(html,/<span>كل الخدمات<\/span><small>3<\/small>/);
});
