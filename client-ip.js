// معرفة الزائر الحقيقي لحدود الاستخدام، بطريقة لا يستطيع الزائر تزويرها.
// المشكلة: الترويسة X-Forwarded-For يكتبها المتصفح نفسه، فيستطيع المسيء تغييرها مع كل طلب
// ليتجاوز الحد ويستهلك رصيدك. لذلك نعتمد بالترتيب على:
// 1) المستخدم المسجّل (من الكوكي الموقّعة) — الأقوى، ولا يتأثر بمشاركة عدة أشخاص نفس الشبكة.
// 2) ترويسة Cloudflare التي تكتبها الشبكة نفسها وتمسح أي قيمة أرسلها الزائر.
// 3) X-Forwarded-For محسوبة من اليمين بعدد البروكسيات الموثوقة (TRUST_PROXY_HOPS).
import net from 'net';

const HOPS = Math.max(1, Number(process.env.TRUST_PROXY_HOPS || 3));
let source = 'unknown';

// عناوين IPv6 تُجمع حسب أول 64 بت، لأن المسيء يملك عادة ملايين العناوين داخل نفس الشبكة
function normalize(ip) {
  ip = String(ip || '').trim().replace(/^::ffff:/, '');
  if (net.isIPv6(ip)) {
    const [head, tail = ''] = ip.split('::');
    const a = head ? head.split(':') : [];
    const b = tail ? tail.split(':') : [];
    const full = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
    return full.slice(0, 4).join(':') + '::/64';
  }
  return ip;
}

export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'] || req.headers['true-client-ip'];
  if (cf && net.isIP(String(cf).trim())) { source = 'cloudflare'; return normalize(cf); }
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter((s) => net.isIP(s));
  if (xff.length) { source = 'x-forwarded-for'; return normalize(xff[Math.max(0, xff.length - HOPS)]); }
  source = 'socket';
  return normalize(req.socket?.remoteAddress);
}

export const ipSource = () => source;

// مفتاح حدود الاستخدام: المستخدم المسجّل أولاً، وإلا عنوان الزائر
export function rateKey(getEmail) {
  return (req) => {
    const email = req.userEmail || (getEmail && getEmail(req));
    return email ? 'u:' + String(email).toLowerCase() : 'ip:' + clientIp(req);
  };
}
