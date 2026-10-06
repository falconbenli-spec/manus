import { BlockList, isIP } from 'node:net';

const proxyPeers = new BlockList();
proxyPeers.addSubnet('127.0.0.0', 8, 'ipv4');
proxyPeers.addAddress('::1', 'ipv6');

export function overHttps(req, { previewOrigin = null, trustProxy = false } = {}) {
  if (req.socket?.encrypted || previewOrigin) return true;
  const peer = req.socket?.remoteAddress;
  const family = typeof peer === 'string' ? isIP(peer) : 0;
  // الوكيل المحلي وحده مخول بوصف النقل؛ عنوان العميل وترويساته لا يمنحانه هذه الثقة.
  if (!trustProxy || !family || !proxyPeers.check(peer, family === 6 ? 'ipv6' : 'ipv4')) return false;
  const proto = req.headers?.['x-forwarded-proto'];
  // الترويسة المفردة هي عقد الوكيل المحلي؛ قائمة متعارضة لا تثبت اتصالًا مشفرًا.
  return typeof proto === 'string' && proto.trim().toLowerCase() === 'https';
}
