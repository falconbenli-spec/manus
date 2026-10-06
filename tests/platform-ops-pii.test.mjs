import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, restore, redactionReport, normaliseDigits, withRedaction } from '../app/pii.mjs';

// كل القيم مصطنعة: أرقام بصيغة صحيحة لا تعود لأحد.
const ID='1098765432',IQAMA='2123456789',IBAN='SA0380000000608010167519',IBAN_SPACED='SA03 8000 0000 6080 1016 7519';

test('pii: national ids, iqamas, Saudi IBANs, mobiles and emails are replaced, with or without spaces',()=>{
  const text=`الموظف التجريبي هويته ${ID} وإقامة زميله ${IQAMA}، الآيبان ${IBAN_SPACED} ومرة ${IBAN}، جواله 0551234567 أو +966 55 123 4567 أو 00966551234567، بريده test.user@example.com`;
  const {text:out,map}=redact(text);
  for(const raw of [ID,IQAMA,IBAN,IBAN_SPACED,'0551234567','+966 55 123 4567','00966551234567','test.user@example.com'])assert.ok(!out.includes(raw),raw);
  assert.match(out,/\[\[NID_1\]\].*\[\[NID_2\]\]/);
  assert.equal((out.match(/\[\[MOBILE_1\]\]/g)??[]).length,3,'one number in three formats is one placeholder');
  assert.equal((out.match(/\[\[IBAN_1\]\]/g)??[]).length,2);
  const back=restore(out,map);
  assert.ok(!/\[\[/.test(back),'every placeholder is restored');
  for(const raw of [ID,IQAMA,IBAN_SPACED,'0551234567','test.user@example.com'])assert.ok(back.includes(raw),raw);
  assert.equal(restore(redact(`هوية ${ID} وبريد test.user@example.com`).text,redact(`هوية ${ID} وبريد test.user@example.com`).map),`هوية ${ID} وبريد test.user@example.com`);
});

test('pii: Arabic-Indic and Persian digits are normalised before scanning, and the original digits come back',()=>{
  const text='رقم الهوية ١٠٩٨٧٦٥٤٣٢ والجوال ۰۵۵۱۲۳۴۵۶۷';
  assert.equal(normaliseDigits('١٢٣۴۵'),'12345');
  const {text:out,map}=redact(text);
  assert.equal(out,'رقم الهوية [[NID_1]] والجوال [[MOBILE_1]]');
  assert.equal(restore(out,map),text);
});

test('pii: numbers that only look similar are left alone',()=>{
  const text='الفاتورة 3098765432 والمبلغ 12345 والرقم 109876543210 والتاريخ 2026-09-20 وSA12 قصير';
  assert.equal(redact(text).text,text);
  assert.equal(redactionReport(text).total,0);
});

test('pii: the report says what and how many, never the values, and admits names are not detected',()=>{
  const text=`سارة التجريبية هويتها ${ID} وجوالها 0551234567 و0551234567 مرة أخرى`;
  const report=redactionReport(text);
  assert.equal(report.total,3);assert.equal(report.counts.national_id,1);assert.equal(report.counts.mobile,2);
  assert.ok(!JSON.stringify(report).includes(ID));
  assert.match(report.not_covered,/الأسماء/);
  assert.ok(redact(text).text.includes('سارة التجريبية'),'names pass through: pattern redaction is partial by design');
});

test('pii: the substitution map lives in memory only and refuses to be serialised',()=>{
  const {map}=redact(`هوية ${ID}`);
  assert.equal(map.size,1);
  assert.throws(()=>JSON.stringify({map}),/memory only/);
});

test('pii: the provider hook sends redacted text and restores the answer for its owner',async()=>{
  let sent='';
  const fake={name:'fake',async complete({user}){sent=user;return {text:`تم استلام ${user.match(/\[\[NID_1\]\]/)[0]}`,input_tokens:1,output_tokens:1,model:'fake'};}};
  const wrapped=withRedaction(fake),result=await wrapped.complete({system:'تعليمات',user:`<بيانات>هوية ${ID}</بيانات>`,maxTokens:10});
  assert.ok(!sent.includes(ID));assert.match(sent,/\[\[NID_1\]\]/);
  assert.equal(result.text,`تم استلام ${ID}`);assert.equal(result.redacted.national_id,1);
});
