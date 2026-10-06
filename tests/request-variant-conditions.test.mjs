import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogServices } from '../app/service-catalog.mjs';
import { requestComposer } from '../app/static/request-picker.mjs';
test('الخيار المحدد مسبقًا يخفي تاريخ انتهاء المؤهل ويظهره للهوية والجواز', () => {
  const service=catalogServices.find(s=>s.code==='HR-PROFILE-UPDATE');
  const render=type=>requestComposer({service,departments:[{id:'hr',name:'الموارد البشرية'}],projects:[],request:null,edit:false,e:String,fieldInput:f=>`<input name="field:${f.key}">`,variant:{group:{code:'profile',name_ar:'تعديل بيانات'},option:{code:'test',name_ar:type,preset:{change_type:type}},picker:'',docs:''}});
  assert.doesNotMatch(render('المؤهل العلمي'),/name="field:document_expiry"/);
  assert.match(render('الهوية أو الإقامة'),/name="field:document_expiry"/);
  assert.match(render('جواز السفر'),/name="field:document_expiry"/);
});
