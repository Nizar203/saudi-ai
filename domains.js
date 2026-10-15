// وحدة بيع الدومينات لـ "سعودي AI" — تعمل فوق واجهة Porkbun البرمجية
// الاستخدام في server.js:
//   import domainsRouter from './domains.js';
//   app.use('/api/domains', express.json(), domainsRouter);
import express from 'express';
import crypto from 'node:crypto';

const router = express.Router();

const API = process.env.PORKBUN_BASE || 'https://api.porkbun.com/api/json/v3';
const KEY = process.env.PORKBUN_API_KEY;
const SECRET = process.env.PORKBUN_SECRET_KEY;
const ADMIN_TOKEN = process.env.DOMAINS_ADMIN_TOKEN;          // رمز سري لك وحدك
const USD_TO_SAR = Number(process.env.USD_TO_SAR || 3.75);
const MARKUP_SAR = Number(process.env.DOMAIN_MARKUP_SAR || 25); // ربحك الثابت على كل دومين
const WHATSAPP = process.env.DOMAINS_WHATSAPP || '966538612401';
const TLDS = (process.env.DOMAIN_TLDS || 'com,net,org,co,store,online,shop,app')
  .split(',').map(s => s.trim()).filter(Boolean);

async function pb(path, body = {}, headers = {}) {
  if (!KEY || !SECRET) throw new Error('مفاتيح Porkbun غير مضبوطة في متغيرات البيئة');
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY, 'X-Secret-API-Key': SECRET, ...headers },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (data.status !== 'SUCCESS') {
    const e = new Error(data.message || `خطأ من Porkbun (${r.status})`);
    e.code = data.code; e.data = data; throw e;
  }
  return data;
}

const toSar = usd => Math.ceil(Number(usd) * USD_TO_SAR + MARKUP_SAR);
const clean = s => String(s || '').toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

// كاش بسيط لتقليل الطلبات (حد Porkbun: 200 دومين في الدقيقة للفحص الجماعي)
const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

// فحص التوفر والسعر: GET /api/domains/check?q=myshop
router.get('/check', async (req, res) => {
  try {
    const q = clean(req.query.q);
    const base = q.includes('.') ? q.split('.')[0] : q;
    if (!/^[a-z0-9-]{2,63}$/.test(base) || base.startsWith('-') || base.endsWith('-'))
      return res.status(400).json({ error: 'اكتب اسماً بالحروف الإنجليزية والأرقام فقط (2-63 حرف)' });

    const list = q.includes('.') ? [q, ...TLDS.map(t => `${base}.${t}`).filter(d => d !== q)] : TLDS.map(t => `${base}.${t}`);
    const key = list.join(',');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < CACHE_MS) return res.json(hit.v);

    const data = await pb('/domain/checkDomain', { domains: list.slice(0, 25) });
    const results = list.map(domain => {
      const r = data.domains?.[domain];
      if (!r) return { domain, status: (data.unresolved || []).includes(domain) ? 'retry' : 'invalid' };
      const avail = r.avail === 'yes' || r.avail === true || r.available === true;
      const premium = r.premium === 'yes' || r.premium === true;
      if (!avail) return { domain, status: 'taken' };
      if (premium) return { domain, status: 'premium' };   // لا تُشترى عبر الواجهة
      return { domain, status: 'available', priceSar: toSar(r.price), renewSar: r.additional?.renewal?.price ? toSar(r.additional.renewal.price) : null };
    });
    const v = { query: base, results };
    cache.set(key, { t: Date.now(), v });
    res.json(v);
  } catch (e) {
    console.error('domains/check', e.code, e.message);
    res.status(502).json({ error: 'تعذّر فحص الدومين الآن، حاول بعد قليل' });
  }
});

// طلب شراء: يُنشئ رابط واتساب جاهز (المرحلة الأولى بلا بوابة دفع)
router.post('/order', (req, res) => {
  const domain = clean(req.body?.domain);
  const name = String(req.body?.name || '').slice(0, 80);
  const priceSar = Number(req.body?.priceSar) || '';
  if (!/^[a-z0-9-]+\.[a-z.]+$/.test(domain)) return res.status(400).json({ error: 'دومين غير صالح' });
  const ref = crypto.randomBytes(3).toString('hex').toUpperCase();
  const msg = `طلب دومين #${ref}\nالدومين: ${domain}\nالسعر المعروض: ${priceSar} ريال/سنة\nالاسم: ${name}\nأرجو تأكيد طريقة الدفع.`;
  res.json({ ref, whatsapp: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}` });
});

// ===== لوحة المدير (محمية برمز سري) =====
function admin(req, res, next) {
  const t = req.get('x-admin-token');
  if (!ADMIN_TOKEN || !t || t.length !== ADMIN_TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN)))
    return res.status(401).json({ error: 'غير مصرّح' });
  next();
}

router.get('/admin/balance', admin, async (_req, res) => {
  try { res.json(await pb('/account/balance')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// تسجيل فعلي بعد استلام المبلغ من العميل.
// confirm=false (الافتراضي) = تجربة جافة بلا خصم، تُظهر التكلفة والرصيد.
router.post('/admin/register', admin, async (req, res) => {
  const domain = clean(req.body?.domain);
  const confirm = req.body?.confirm === true;
  try {
    const quote = await pb(`/domain/create/${domain}`, { cost: 0, agreeToTerms: 'yes', dryRun: true });
    if (!confirm) return res.json({ step: 'preview', ...quote });
    if (!quote.wouldSucceed) return res.status(409).json({ error: quote.message, ...quote });
    const done = await pb(`/domain/create/${domain}`,
      { cost: quote.cost, agreeToTerms: 'yes' },
      { 'Idempotency-Key': `reg-${domain}-${new Date().toISOString().slice(0, 10)}` });
    res.json({ step: 'registered', ...done });
  } catch (e) {
    res.status(502).json({ error: e.message, code: e.code, details: e.data });
  }
});

// توجيه الدومين إلى موقع العميل (مثلاً تطبيق مستضاف على Render)
router.post('/admin/point', admin, async (req, res) => {
  const domain = clean(req.body?.domain);
  const target = clean(req.body?.target); // مثل: my-app.onrender.com
  if (!target) return res.status(400).json({ error: 'حدد الهدف' });
  try {
    const out = await pb(`/dns/create/${domain}`, { name: 'www', type: 'CNAME', content: target, ttl: '600' });
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

export default router;
