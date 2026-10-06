import test from 'node:test';
import assert from 'node:assert/strict';
import { bindHost } from '../app/boot.mjs';

// عنوان الاستماع: محليٌّ افتراضًا، والفتح على الشبكة عنوانٌ بعينه لا بديلٌ مفتوح (قرار المالك، 25 سبتمبر 2026).
// وُجد LOCAL_BIND_HOST مضبوطًا على 0.0.0.0 على جهاز المالك شهرًا كاملًا، والتحذير في السجل لم يوقفه.
test('بلا متغير أو بقيمة فارغة: الاستماع على الاسترجاع وحده',()=>{
  assert.equal(bindHost(undefined),'127.0.0.1');
  // الفارغ إلغاءٌ لا فتحٌ: LOCAL_BIND_HOST= في .env طريقة طبيعية لإيقاف الفتح على الشبكة.
  assert.equal(bindHost(''),'127.0.0.1');
  assert.equal(bindHost('   '),'127.0.0.1');
});

test('العناوين المحلية تمر كما هي',()=>{
  for(const h of ['127.0.0.1','localhost','::1']) assert.equal(bindHost(h),h);
});

test('البديل المفتوح يُردّ إلى الاسترجاع ولا يُسقط المنصة، والخطأ يقول التصحيح',t=>{
  const errs=[];t.mock.method(console,'error',m=>errs.push(String(m)));
  for(const h of ['0.0.0.0','::','::0','*']) assert.equal(bindHost(h),'127.0.0.1',`${h} يُردّ`);
  assert.equal(errs.length,4,'كل واحدة تُطبع');
  assert.match(errs[0],/كل الواجهات/);
  assert.match(errs[0],/192\.168/,'الرسالة تعطي الشكل الصحيح');
});

test('عنوان غير صالح يُرفض، وعنوان الجهاز على شبكته يمر بتحذير',t=>{
  t.mock.method(console,'error',()=>{});
  assert.equal(bindHost('192.168.1.999'),'127.0.0.1');
  assert.equal(bindHost('example.com'),'127.0.0.1');
  const warned=[];t.mock.method(console,'warn',m=>warned.push(String(m)));
  assert.equal(bindHost('192.168.1.20'),'192.168.1.20');
  assert.equal(warned.length,1,'يُحذَّر مرة');
  assert.match(warned[0],/بلا تشفير/);
  assert.match(warned[0],/احذف LOCAL_BIND_HOST متى انتهيت/);
});
