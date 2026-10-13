// سعودي AI — خادم مستقل بسيط.
// يخدم واجهة الأداة (public/) ويمرّر طلبات الذكاء الاصطناعي إلى Anthropic API
// باستخدام مفتاحك الخاص، بحيث لا يظهر المفتاح أبدًا في المتصفح.
// يدعم أيضًا تسجيل الدخول عبر جوجل بدل رمز الدخول (اختياري — فعّله بإضافة GOOGLE_CLIENT_ID).

import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true); // عشان يعرف أن الاتصال https خلف خادم Render

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 20);
const PORT = process.env.PORT || 3000;

// --- تسجيل الدخول عبر جوجل (اختياري) ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ALLOWED_EMAILS = (process.env.ALLOWED_GOOGLE_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const GOOGLE_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

if (!API_KEY) {
  console.warn('[تحذير] لم يتم ضبط ANTHROPIC_API_KEY — طلبات البناء والمحادثة ستفشل حتى تضيفه.');
}
if (!GOOGLE_ENABLED) {
  console.warn('[معلومة] تسجيل الدخول بجوجل غير مفعّل (GOOGLE_CLIENT_ID/SECRET غير مضبوطين) — سيُستخدم ACCESS_CODE إن وُجد.');
} else if (!ALLOWED_EMAILS.length) {
  console.warn('[تحذير] تسجيل الدخول بجوجل مفعّل لكن ALLOWED_GOOGLE_EMAILS فارغ — أي حساب جوجل سيقدر يدخل الموقع.');
}

app.use(express.json({ limit: '2mb' }));

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

// صفحة تسجيل دخول بسيطة تُعرض بدل الأداة لمن لم يسجّل دخوله بعد
function loginPageHtml() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>سعودي AI — تسجيل الدخول</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf9f5;color:#1f1e1d;
font:16px/1.7 system-ui,-apple-system,"Segoe UI",Tahoma,"Noto Sans Arabic",sans-serif}
.box{background:#fff;border:1px solid #e5e2da;border-radius:18px;padding:36px 30px;max-width:360px;text-align:center}
h1{font-size:22px;margin:0 0 10px}
p{color:#6b6a68;margin:0 0 22px;font-size:15px}
a.btn{display:inline-flex;align-items:center;gap:10px;background:#046a38;color:#fff;text-decoration:none;
font-weight:600;padding:12px 22px;border-radius:12px}
</style></head><body>
<div class="box">
<h1>🇸🇦 سعودي AI</h1>
<p>سجّل الدخول بحساب جوجل للمتابعة إلى الأداة.</p>
<a class="btn" href="/auth/google">تسجيل الدخول عبر جوجل</a>
</div>
</body></html>`;
}

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

// بوّابة الصفحة الرئيسية: تُعرض الأداة فقط لمن سجّل دخوله (إن كان جوجل مفعّلًا)
app.get('/', (req, res, next) => {
  if (GOOGLE_ENABLED) {
    const email = getSessionEmail(req);
    if (!email) return res.send(loginPageHtml());
    if (!isAllowed(email)) return res.status(403).send(forbiddenPageHtml(email));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: RATE_LIMIT_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
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

const BUILD_SYSTEM = [
  'You are an expert front-end engineer and designer acting as an AI app builder.',
  'Build the app the user asks for as ONE complete, self-contained HTML file: inline CSS and JS only,',
  'no external libraries, fonts, images or network calls (use emoji, inline SVG and CSS for visuals).',
  'Make it polished, responsive and fully working, with realistic sample data.',
  'If the request is in Arabic, use an Arabic RTL interface.',
  'Never use localStorage directly for app data. To persist user data use the global window.appDB',
  '(synchronous, saved automatically per project): appDB.get(key, fallback) and appDB.set(key, jsonValue);',
  'load saved data at startup and call set after every change.',
  'If the app has several screens or pages, build them as views inside the same file with in-app navigation (tabs or sidebar).',
  'If a CURRENT APP is given, apply the change to it and return the full updated file.',
  'Output format: 1-2 short sentences in the user\'s language describing what you built or changed,',
  'then the complete file in a single ```html fence, and nothing after it.',
].join(' ');

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

app.post('/api/build', checkAccess, async (req, res) => {
  try {
    const { prompt, currentHtml } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }
    const userMsg = (currentHtml && typeof currentHtml === 'string'
      ? `CURRENT APP:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nCHANGE REQUEST: `
      : 'APP REQUEST: ') + prompt;
    const text = await callAnthropic([{ role: 'user', content: userMsg }], BUILD_SYSTEM);
    res.json({ text });
  } catch (e) {
    res.status(e.code === 'missing_api_key' ? 500 : 502).json({
      error: e.code || 'server_error',
      message: e.message || String(e),
    });
  }
});

app.post('/api/chat', checkAccess, async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const text = await callAnthropic(messages);
    res.json({ text });
  } catch (e) {
    res.status(e.code === 'missing_api_key' ? 500 : 502).json({
      error: e.code || 'server_error',
      message: e.message || String(e),
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasApiKey: !!API_KEY,
    model: MODEL,
    accessProtected: !!ACCESS_CODE || GOOGLE_ENABLED,
    googleLoginEnabled: GOOGLE_ENABLED,
    rateLimitPerHour: RATE_LIMIT_PER_HOUR,
  });
});

app.listen(PORT, () => {
  console.log(`سعودي AI يعمل على المنفذ ${PORT}`);
});
