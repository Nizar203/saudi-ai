// سعودي AI — خادم مستقل بسيط.
// يخدم واجهة الأداة (public/) ويمرّر طلبات الذكاء الاصطناعي إلى Anthropic API
// باستخدام مفتاحك الخاص، بحيث لا يظهر المفتاح أبدًا في المتصفح.
// يدعم أيضًا تسجيل الدخول عبر جوجل بدل رمز الدخول (اختياري — فعّله بإضافة GOOGLE_CLIENT_ID).

import express from 'express';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import domainsRouter from './domains.js';
import saudiRouter from './saudi-engine.js';
import { store, storageKind } from './store.js';
import { callGemini, generateImage, geminiEnabled, GEMINI_MODEL, IMAGE_MODEL } from './gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true); // عشان يعرف أن الاتصال https خلف خادم Render

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 20);
const PORT = process.env.PORT || 3000;

// --- ذكاء اصطناعي إضافي: OpenAI / ChatGPT (اختياري) ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS || 16000);
const OPENAI_ENABLED = !!OPENAI_API_KEY;

// --- تسجيل الدخول عبر جوجل (اختياري) ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ALLOWED_EMAILS = (process.env.ALLOWED_GOOGLE_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// سر الجلسات يجب أن يبقى ثابتاً بين التحديثات، وإلا يُطرد كل المستخدمين مع كل نشر.
// إن لم يُضبط SESSION_SECRET نشتقه من أسرار ثابتة موجودة أصلاً في الاستضافة.
const SESSION_SECRET = process.env.SESSION_SECRET ||
  ((process.env.GOOGLE_CLIENT_SECRET || process.env.ANTHROPIC_API_KEY)
    ? crypto.createHash('sha256').update('saudi-ai-session:' + (process.env.GOOGLE_CLIENT_SECRET || '') + (process.env.ANTHROPIC_API_KEY || '')).digest('hex')
    : crypto.randomBytes(32).toString('hex'));
const GOOGLE_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

if (!API_KEY) {
  console.warn('[تحذير] لم يتم ضبط ANTHROPIC_API_KEY — طلبات البناء والمحادثة عبر Claude ستفشل حتى تضيفه.');
}
if (!OPENAI_ENABLED) {
  console.warn('[معلومة] OPENAI_API_KEY غير مضبوط — خيار ChatGPT لن يظهر/يعمل حتى تضيفه.');
}
if (!geminiEnabled()) {
  console.warn('[معلومة] GEMINI_API_KEY غير مضبوط — Gemini وتوليد الصور (Nano Banana) لن يعملا حتى تضيفه.');
}
if (!GOOGLE_ENABLED) {
  console.warn('[معلومة] تسجيل الدخول بجوجل غير مفعّل (GOOGLE_CLIENT_ID/SECRET غير مضبوطين) — سيُستخدم ACCESS_CODE إن وُجد.');
} else if (!ALLOWED_EMAILS.length) {
  console.warn('[تحذير] تسجيل الدخول بجوجل مفعّل لكن ALLOWED_GOOGLE_EMAILS فارغ — أي حساب جوجل سيقدر يدخل الموقع.');
}

app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/') && compression.filter(req, res) }));
app.use(express.json({ limit: '12mb' }));

// ---------- أدوات الجلسة (كوكيز موقّعة، بدون قاعدة بيانات) ----------
function sign(value) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}
function unsign(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getSessionEmail(req) {
  const cookies = parseCookies(req);
  return unsign(cookies.session || '');
}
function isAllowed(email) {
  if (!email) return false;
  if (!ALLOWED_EMAILS.length) return true;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
function getOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ---------- مسارات تسجيل الدخول بجوجل ----------
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_ENABLED) return res.status(500).send('تسجيل الدخول بجوجل غير مفعّل على هذا الموقع.');
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${getOrigin(req)}/auth/google/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`);
  res.redirect(url.toString());
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!GOOGLE_ENABLED) return res.status(500).send('تسجيل الدخول بجوجل غير مفعّل على هذا الموقع.');
    const { code, state } = req.query;
    const cookies = parseCookies(req);
    if (!code || !state || state !== cookies.oauth_state) {
      return res.status(400).send('رابط تسجيل الدخول غير صالح أو منتهي الصلاحية. ارجع للموقع وحاول مرة أخرى.');
    }
    const redirectUri = `${getOrigin(req)}/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'token_exchange_failed');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();
    const email = (user.email || '').toLowerCase();
    if (!email || user.email_verified === false) {
      return res.status(403).send('تعذّر التحقق من بريدك الإلكتروني عبر جوجل.');
    }
    if (!isAllowed(email)) {
      return res.status(403).send('عذرًا، هذا البريد غير مصرّح له باستخدام هذا الموقع.');
    }
    const signed = sign(email);
    res.setHeader('Set-Cookie', [
      `session=${encodeURIComponent(signed)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
      'oauth_state=; Path=/; Max-Age=0',
    ]);
    res.redirect('/');
  } catch (e) {
    res.status(500).send('حدث خطأ أثناء تسجيل الدخول: ' + (e.message || String(e)));
  }
});

app.get('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
  res.redirect('/');
});

function forbiddenPageHtml(email) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>سعودي AI — غير مصرّح</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf9f5;color:#1f1e1d;
font:16px/1.7 system-ui,-apple-system,"Segoe UI",Tahoma,"Noto Sans Arabic",sans-serif;text-align:center}
.box{max-width:360px}a{color:#046a38}</style></head><body>
<div class="box"><h1>🇸🇦 سعودي AI</h1>
<p>البريد <b>${email || ''}</b> غير مصرّح له باستخدام هذا الموقع.</p>
<p><a href="/auth/logout">تسجيل الدخول بحساب آخر</a></p></div>
</body></html>`;
}

// ---------- الصفحات العامة + إعلانات Google AdSense ----------
// ADSENSE_CLIENT مثل: ca-pub-1234567890123456 (يُضاف في متغيرات البيئة بعد قبولك في AdSense)
const ADSENSE_CLIENT = (process.env.ADSENSE_CLIENT || 'ca-pub-1829540228262969').trim();
const ADSENSE_OK = /^ca-pub-\d{10,20}$/.test(ADSENSE_CLIENT);
if (ADSENSE_CLIENT && !ADSENSE_OK) console.warn('[تحذير] ADSENSE_CLIENT بصيغة غير صحيحة، يجب أن يكون مثل ca-pub-1234567890123456');
const ADSENSE_TAG = ADSENSE_OK
  ? `<meta name="google-adsense-account" content="${ADSENSE_CLIENT}">\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`
  : '';
const publicCache = new Map();
function sendPublic(res, file) {
  let html = publicCache.get(file);
  if (html === undefined) {
    try { html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8'); }
    catch { html = null; }
    publicCache.set(file, html);
  }
  if (html === null) return res.status(404).send('Not found');
  res.type('html').send(html.replace('<!--ADSENSE-->', ADSENSE_TAG));
}
const PUBLIC_PAGES = ['about.html', 'contact.html', 'privacy.html', 'guides.html',
  'guides/describe-app.html', 'guides/profit-margin.html', 'guides/choose-domain.html'];
for (const f of PUBLIC_PAGES) app.get('/' + f, (req, res) => sendPublic(res, f));
app.get('/ads.txt', (req, res) => {
  if (!ADSENSE_OK) return res.status(404).type('text').send('');
  res.type('text').send(`google.com, ${ADSENSE_CLIENT.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
});

// بوّابة الصفحة الرئيسية: الزائر غير المسجّل يرى الصفحة التعريفية العامة، والمسجّل يرى الأداة
app.get('/', (req, res, next) => {
  if (GOOGLE_ENABLED) {
    const email = getSessionEmail(req);
    if (!email) return sendPublic(res, 'landing.html');
    if (!isAllowed(email)) return res.status(403).send(forbiddenPageHtml(email));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    res.setHeader('Cache-Control', /\.(html?|js)$/.test(file) ? 'no-cache' : 'public, max-age=86400');
  },
}));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: RATE_LIMIT_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// بيع الدومينات: متاح للزوار بلا تسجيل دخول، وخارج حد الطلبات العام
// (البحث رخيص ومخزّن مؤقتاً، ولوحة المدير محمية برمز DOMAINS_ADMIN_TOKEN)
app.use('/api/domains', domainsRouter);

// ---------- مشاريع المستخدم على الخادم (تتطلب تسجيل الدخول بجوجل) ----------
const projectsLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 1500, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
function requireUser(req, res, next) {
  if (!GOOGLE_ENABLED) return res.status(409).json({ error: 'no_accounts', message: 'الحفظ على الخادم يتطلب تفعيل تسجيل الدخول بجوجل.' });
  const email = getSessionEmail(req);
  if (!email || !isAllowed(email)) return res.status(401).json({ error: 'unauthorized' });
  req.userEmail = email;
  next();
}
const ID_RE = /^[a-z0-9]{1,24}$/i;
const jsonSize = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
function cleanProject(b) {
  const p = {
    name: typeof b.name === 'string' ? b.name.slice(0, 80) : 'مشروع',
    html: typeof b.html === 'string' ? b.html : '',
    brief: typeof b.brief === 'string' ? b.brief.slice(0, 8000) : '',
    log: Array.isArray(b.log) ? b.log.slice(-400).filter((m) => m && typeof m.t === 'string').map((m) => ({ c: m.c === 'u' ? 'u' : 'a', t: m.t.slice(0, 20000) })) : [],
    data: b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : {},
  };
  if (p.html.length > 3_000_000 || jsonSize(p.data) > 2_000_000) return null;
  return p;
}
const storeErr = (res, e) => {
  if (e.code === 'limit') return res.status(403).json({ error: 'limit', message: e.message });
  console.error('[store]', e.message);
  res.status(503).json({ error: 'storage_error', message: 'تعذّر الوصول إلى قاعدة البيانات، حاول بعد قليل.' });
};

app.get('/api/me', (req, res) => {
  const email = GOOGLE_ENABLED ? getSessionEmail(req) : null;
  res.json({ email: email && isAllowed(email) ? email : null, storage: GOOGLE_ENABLED && email ? 'server' : 'local' });
});
const projects = express.Router();
projects.use(projectsLimiter, requireUser);
projects.get('/', async (req, res) => {
  try { res.json({ projects: await store.list(req.userEmail) }); } catch (e) { storeErr(res, e); }
});
projects.get('/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_request' });
  try {
    const p = await store.get(req.userEmail, req.params.id);
    p ? res.json(p) : res.status(404).json({ error: 'not_found' });
  } catch (e) { storeErr(res, e); }
});
projects.put('/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_request' });
  const p = cleanProject(req.body || {});
  if (!p) return res.status(413).json({ error: 'too_large', message: 'المشروع أكبر من الحد المسموح.' });
  try { await store.put(req.userEmail, req.params.id, p); res.json({ ok: true }); } catch (e) { storeErr(res, e); }
});
projects.delete('/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_request' });
  try { await store.del(req.userEmail, req.params.id); res.json({ ok: true }); } catch (e) { storeErr(res, e); }
});
projects.post('/:id/publish', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_request' });
  try {
    const slug = await store.publish(req.userEmail, req.params.id);
    if (!slug) return res.status(404).json({ error: 'not_found', message: 'احفظ المشروع أولاً.' });
    res.json({ slug, url: `${getOrigin(req)}/p/${slug}` });
  } catch (e) { storeErr(res, e); }
});
projects.delete('/:id/publish', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_request' });
  try { await store.unpublish(req.userEmail, req.params.id); res.json({ ok: true }); } catch (e) { storeErr(res, e); }
});
app.use('/api/projects', projects);

// ---------- التطبيقات المنشورة برابط عام ----------
// تُعرض في وضع "معزول" (sandbox) حتى لا يستطيع كود التطبيق المنشور الوصول لحسابات زوّار الموقع.
// لذلك بيانات التطبيق المنشور تبقى في ذاكرة الصفحة فقط حالياً.
const PUB_SHIM = '<script>window.appDB=window.appDB||(function(){var m={};function ls(){try{return window.localStorage}catch(e){return null}}' +
  'return{get:function(k,f){try{var s=ls(),v=s&&s.getItem("appdb:"+k);if(v!=null)return JSON.parse(v)}catch(e){}return k in m?m[k]:f},' +
  'set:function(k,v){m[k]=v;try{var s=ls();s&&s.setItem("appdb:"+k,JSON.stringify(v))}catch(e){}}}})()<\/script>';
const PUB_BADGE = '<a href="/" target="_blank" rel="noopener" style="position:fixed;bottom:10px;left:10px;z-index:2147483647;' +
  'font:600 12px system-ui,sans-serif;background:#006c35;color:#fff;padding:6px 10px;border-radius:99px;text-decoration:none;opacity:.9">صُنع بـ سعودي AI</a>';
app.get('/p/:slug', async (req, res) => {
  if (!/^[a-z0-9]{6,20}$/.test(req.params.slug)) return res.status(404).send('Not found');
  try {
    const p = await store.getPublished(req.params.slug);
    if (!p) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;text-align:center;margin-top:20vh">هذا التطبيق غير منشور أو أُلغي نشره.</p>');
    let html = p.html;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + PUB_SHIM) : PUB_SHIM + html;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, PUB_BADGE + '</body>') : html + PUB_BADGE;
    res.set({
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=60',
    }).type('html').send(html);
  } catch (e) {
    console.error('[publish]', e.message);
    res.status(503).send('تعذّر تحميل التطبيق، حاول بعد قليل.');
  }
});

app.use('/api/', limiter);

function checkAccess(req, res, next) {
  if (GOOGLE_ENABLED) {
    const email = getSessionEmail(req);
    if (!email || !isAllowed(email)) return res.status(401).json({ error: 'unauthorized' });
    req.userEmail = email;
    return next();
  }
  if (!ACCESS_CODE) return next();
  if (req.get('x-access-code') === ACCESS_CODE) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// المحرك الخاص (ALLaM): يتطلب تسجيل الدخول مثل بقية الأداة لأن كل رسالة تكلّف
app.use('/api/saudi', checkAccess, saudiRouter);

const BUILD_SYSTEM = [
  'You are an expert front-end engineer and designer acting as an AI app builder.',
  'Build the app the user asks for as ONE complete, self-contained HTML file: inline CSS and JS only,',
  'no external libraries, fonts, images or network calls (use emoji, inline SVG and CSS for visuals).',
  'Make it polished, responsive and fully working, with realistic sample data.',
  'If the request is in Arabic, use an Arabic RTL interface.',
  'Never use localStorage directly for app data. To persist user data use the global window.appDB',
  '(synchronous, saved automatically per project): appDB.get(key, fallback) and appDB.set(key, jsonValue);',
  'load saved data at startup and call set after every change.',
  'WhatsApp: when the app takes bookings, orders or inquiries and a WhatsApp number is known (brief or request), send each one through a',
  'https://wa.me/<number>?text=<encodeURIComponent(message)> link opened with window.open(url,"_blank") (fall back to location.href if it returns null),',
  'with a clear Arabic message listing every detail. Saudi numbers like 05XXXXXXXX become 9665XXXXXXXX. Keep any existing WhatsApp number unless asked.',
  'If the app has several screens or pages, build them as views inside the same file with in-app navigation (tabs or sidebar).',
  'REFERENCE PRODUCTS: when the user says the app should be "like" or "يشبه" a known product or website (e.g. an accounting, ERP, CRM, booking or',
  'delivery platform), first recall how that category of professional product is structured and reproduce that structure and level of polish:',
  'its navigation pattern, module list, page layouts, dense data tables, forms and workflows. Give it its own original name, logo and color palette;',
  'never copy the reference product\'s name, logo, trademarks or exact branding.',
  'BUSINESS / ADMIN APPS (accounting, invoices, inventory, CRM, HR, clinics, POS, dashboards): design desktop-first like real SaaS software.',
  'At widths of 1024px and above show a permanent sidebar (on the right in RTL) with grouped, collapsible sections and icons, plus a top bar with',
  'global search, a primary "إنشاء جديد" button, notifications and the user name. Only below 900px collapse the sidebar behind a menu button.',
  'Main screens use data tables with search, filters, sorting and colored status badges, quick-action buttons, and full create/edit forms in',
  'modals or side panels. Use a calm neutral background, white cards with subtle borders, compact spacing, and one accent color.',
  'Every module listed in the navigation must open a working screen, not a placeholder.',
  'NUMBERS AND CHARTS: use one digit style everywhere in the app (Western digits 0-9 by default; Arabic-Indic only if the user asks), with',
  'consistent money formatting such as 1,380.00 ر.س. Label every KPI precisely (e.g. "المحصّل" vs "إجمالي الفواتير") and make sure every',
  'total is actually computed from the stored data. In charts leave enough padding so value labels and axes are never clipped.',
  'Never mention internal or technical names (appDB, localStorage, HTML, JavaScript, sandbox) in the sentences you write to the user;',
  'describe features in plain Arabic.',
  'If a CURRENT APP is given, apply the change to it and return the full updated file.',
  'Change only what the request asks for; keep everything else (layout, colors, features, data keys) exactly as it is.',
  'PROJECT MEMORY: a PROJECT BRIEF may be given. It is the project\'s long-term memory: purpose, audience,',
  'design choices, screens, data keys, and decisions the user made. Follow it. Do not undo a decision listed in it',
  'unless the CHANGE REQUEST explicitly asks for that.',
  'After every build or change, return an updated brief: concise Markdown in the user\'s language, at most 25 short bullet lines,',
  'under these headings: الهدف, التصميم, الشاشات والميزات, البيانات المحفوظة, قرارات المستخدم.',
  'Keep earlier user decisions, add new ones, remove only what is no longer true. No code in the brief.',
  'Output format, in this exact order: 1-2 short sentences in the user\'s language describing what you built or changed;',
  'then the updated brief in a single ```brief fence; then the complete file in a single ```html fence; nothing after it.',
].join(' ');

// حد أعلى لحجم ملف المعرفة حتى لا يتضخم ويستهلك الرموز
const BRIEF_MAX = 4000;

async function callAnthropic(messages, system) {
  if (!API_KEY) {
    const err = new Error('missing_api_key');
    err.code = 'missing_api_key';
    throw err;
  }
  const body = {
    model: MODEL,
    max_tokens: 128000,
    messages,
  };
  if (system) body.system = system;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error?.message || ''; } catch (e) { /* ignore */ }
    const err = new Error(detail || `Anthropic API returned ${r.status}`);
    err.code = 'upstream_error';
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || '').join('');
  return text;
}

// نسخة متدفقة: ترسل النص للمتصفح أولاً بأول بدل الانتظار حتى نهاية الرد
async function streamAnthropic(messages, system, onText) {
  if (!API_KEY) {
    const err = new Error('missing_api_key');
    err.code = 'missing_api_key';
    throw err;
  }
  const body = { model: MODEL, max_tokens: 128000, messages, stream: true };
  if (system) body.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) {
    let detail = '';
    try { detail = (await r.json()).error?.message || ''; } catch (e) { /* ignore */ }
    const err = new Error(detail || `Anthropic API returned ${r.status}`);
    err.code = 'upstream_error';
    err.status = r.status;
    throw err;
  }
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onText(ev.delta.text);
      else if (ev.type === 'error') {
        const err = new Error(ev.error?.message || 'stream_error');
        err.code = 'upstream_error';
        throw err;
      }
    }
  }
}

async function callOpenAI(messages, system) {
  if (!OPENAI_API_KEY) {
    const err = new Error('missing_openai_key');
    err.code = 'missing_api_key';
    throw err;
  }
  const chatMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: chatMessages,
      max_completion_tokens: OPENAI_MAX_TOKENS,
    }),
  });

  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error?.message || ''; } catch (e) { /* ignore */ }
    const err = new Error(detail || `OpenAI API returned ${r.status}`);
    err.code = 'upstream_error';
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

// يختار محرك الذكاء الاصطناعي المطلوب (Claude افتراضيًا، أو ChatGPT إن طُلب ومتاح)
async function callAI(provider, messages, system) {
  if (provider === 'gemini') return callGemini(messages, system);
  if (provider === 'openai') {
    if (!OPENAI_ENABLED) {
      const err = new Error('openai_not_configured');
      err.code = 'missing_api_key';
      throw err;
    }
    return callOpenAI(messages, system);
  }
  return callAnthropic(messages, system);
}

// يرد إما دفعة واحدة (JSON) أو متدفقاً (نص عادي) إذا طلب المتصفح stream:true.
// في التدفق: أي خطأ بعد بدء الإرسال يُكتب بعد العلامة \u0000ERR:
async function respondAI(req, res, provider, messages, system) {
  const wantStream = req.body?.stream === true;
  if (!wantStream) {
    const text = await callAI(provider, messages, system);
    return res.json({ text });
  }
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    res.status(200).set({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
    res.flushHeaders();
  };
  try {
    if (!provider || provider === 'anthropic') {
      await streamAnthropic(messages, system, (t) => { start(); res.write(t); });
    } else {
      const text = await callAI(provider, messages, system);
      start();
      res.write(text);
    }
    start();
    res.end();
  } catch (e) {
    if (!started) throw e;
    res.end('\u0000ERR:' + (e.message || String(e)));
  }
}

app.post('/api/build', checkAccess, async (req, res) => {
  try {
    const { prompt, currentHtml, provider, brief } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }
    const briefText = typeof brief === 'string' ? brief.trim().slice(0, BRIEF_MAX) : '';
    const userMsg =
      (briefText ? `PROJECT BRIEF:\n${briefText}\n\n` : '') +
      (currentHtml && typeof currentHtml === 'string'
        ? `CURRENT APP:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nCHANGE REQUEST: `
        : 'APP REQUEST: ') + prompt;
    await respondAI(req, res, provider, [{ role: 'user', content: userMsg }], BUILD_SYSTEM);
  } catch (e) {
    res.status(e.code === 'missing_api_key' ? 500 : 502).json({
      error: e.code || 'server_error',
      message: e.message || String(e),
    });
  }
});

app.post('/api/chat', checkAccess, async (req, res) => {
  try {
    const { messages, provider } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'bad_request' });
    }
    await respondAI(req, res, provider, messages);
  } catch (e) {
    res.status(e.code === 'missing_api_key' ? 500 : 502).json({
      error: e.code || 'server_error',
      message: e.message || String(e),
    });
  }
});

// توليد وتعديل الصور عبر Nano Banana
const IMAGE_MIMES = /^image\/(png|jpeg|webp)$/;
app.post('/api/image', checkAccess, async (req, res) => {
  try {
    const { prompt, image, aspect } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) return res.status(400).json({ error: 'bad_request' });
    let img;
    if (image && typeof image === 'object') {
      if (!IMAGE_MIMES.test(image.mime || '') || typeof image.data !== 'string') {
        return res.status(400).json({ error: 'bad_image', message: 'الصورة يجب أن تكون PNG أو JPG أو WEBP.' });
      }
      img = { mime: image.mime, data: image.data };
    }
    const ratio = /^\d{1,2}:\d{1,2}$/.test(aspect || '') ? aspect : undefined;
    res.json(await generateImage({ prompt, image: img, aspect: ratio }));
  } catch (e) {
    res.status(e.code === 'missing_api_key' ? 500 : 502).json({ error: e.code || 'server_error', message: e.message || String(e) });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasApiKey: !!API_KEY,
    model: MODEL,
    hasOpenAIKey: OPENAI_ENABLED,
    openaiModel: OPENAI_MODEL,
    hasGeminiKey: geminiEnabled(),
    storage: storageKind,
    geminiModel: GEMINI_MODEL,
    imageModel: IMAGE_MODEL,
    accessProtected: !!ACCESS_CODE || GOOGLE_ENABLED,
    googleLoginEnabled: GOOGLE_ENABLED,
    rateLimitPerHour: RATE_LIMIT_PER_HOUR,
  });
});

if (storageKind === 'file') console.warn('[معلومة] DATABASE_URL غير مضبوط — المشاريع تُحفظ في ملف محلي، وقد تُمسح عند إعادة النشر على Render المجاني.');

app.listen(PORT, () => {
  console.log(`سعودي AI يعمل على المنفذ ${PORT}`);
});
