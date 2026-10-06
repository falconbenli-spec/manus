import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, overHttps } from '../app/server.mjs';

const request = (peer, proto = 'https', encrypted = false) => ({
  socket: { remoteAddress: peer, encrypted }, headers: { 'x-forwarded-proto': proto },
});

test('SEC-PROXY-01: ترويسة HTTPS من عميل بعيد لا تغير حقيقة النقل', () => {
  for (const peer of ['192.168.1.20', '203.0.113.10', '2001:db8::1', '::ffff:192.168.1.20', undefined]) {
    assert.equal(overHttps(request(peer), { trustProxy: true }), false, String(peer));
  }
});

test('SEC-PROXY-02: ترويسة HTTPS تقبل من وكيل استرجاع مصرح فقط', () => {
  for (const peer of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(overHttps(request(peer), { trustProxy: true }), true, peer);
    assert.equal(overHttps(request(peer), { trustProxy: false }), false, peer);
    assert.equal(overHttps(request(peer)), false, peer);
  }
});

test('SEC-PROXY-03: عناوين الاسترجاع المشوهة لا تمنح الثقة', () => {
  for (const peer of ['127.999.0.1', '127.0.0.1.evil', '::ffff:127.999.0.1', '127.0.0.1:80', 'localhost', '']) {
    assert.equal(overHttps(request(peer), { trustProxy: true }), false, peer);
  }
});

test('SEC-PROXY-04: الترويسات المتعددة أو الغامضة لا تثبت HTTPS', () => {
  for (const proto of ['https,http', 'https,https', ['https'], 'http', '', null]) {
    assert.equal(overHttps(request('127.0.0.1', proto), { trustProxy: true }), false, String(proto));
  }
  assert.equal(overHttps(request('127.0.0.1', ' HTTPS '), { trustProxy: true }), true);
});

test('SEC-PROXY-05: التشفير الفعلي ومعاينة HTTPS الصريحة يبقيان موثوقين', () => {
  assert.equal(overHttps(request('203.0.113.10', 'http', true)), true);
  assert.equal(overHttps(request('203.0.113.10', 'http'), { previewOrigin: 'https://preview.example.test' }), true);
});

test('SEC-PROXY-06: استجابة الخادم لا ترسل HSTS بناء على ترويسة عميل بعيد', async () => {
  // المعالج الحقيقي مع عنوان طرف مضبوط؛ لا قراءة لقاعدة التشغيل ولا تغيير لحساباتها.
  const server = createApp(null, { trustProxy: true, allowedHost: null });
  const handler = server.listeners('request')[0];
  for (const [peer, proto, expected] of [
    ['203.0.113.10', 'https', false],
    ['127.0.0.1', 'https', true],
    ['127.0.0.1', 'https,http', false],
  ]) {
    const req = { ...request(peer, proto), method: 'GET', url: '/', headers: { host: 'localhost', 'x-forwarded-proto': proto } };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
    await handler(req, res);
    assert.equal(res.status, 200);
    assert.equal(Boolean(res.headers['Strict-Transport-Security']), expected, `${peer}: ${proto}`);
    assert.match(String(res.body), /<html/);
  }
});
