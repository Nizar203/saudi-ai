// سعودي AI — خادم مستقل بسيط.
// يخدم واجهة الأداة (public/) ويمرّر طلبات الذكاء الاصطناعي إلى Anthropic API
// باستخدام مفتاحك الخاص، بحيث لا يظهر المفتاح أبدًا في المتصفح.

import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 20);
const PORT = process.env.PORT || 3000;

if (!API_KEY) {
  console.warn('[تحذير] لم يتم ضبط ANTHROPIC_API_KEY — طلبات البناء والمحادثة ستفشل حتى تضيفه.');
}

app.use(express.json({ limit: '2mb' }));
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
    max_tokens: 8192,
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
    accessProtected: !!ACCESS_CODE,
    rateLimitPerHour: RATE_LIMIT_PER_HOUR,
  });
});

app.listen(PORT, () => {
  console.log(`سعودي AI يعمل على المنفذ ${PORT}`);
});
