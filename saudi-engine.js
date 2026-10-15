// محرك "سعودي AI" الخاص — نموذج مفتوح (ALLaM) على RunPod أو أي خادم متوافق مع OpenAI
// يُركَّب في server.js بسطر واحد:
//   app.use('/api/saudi', express.json(), saudiRouter);
import express from 'express';

const URL_ = (process.env.SAUDI_ENGINE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SAUDI_ENGINE_KEY || '';
const MODEL = process.env.SAUDI_ENGINE_MODEL || 'ALLaM-AI/ALLaM-7B-Instruct-preview';
const TIMEOUT = Number(process.env.SAUDI_ENGINE_TIMEOUT_MS || 120000);
const PER_MIN = Number(process.env.SAUDI_ENGINE_RATE_PER_MIN || 15);
const SYSTEM = process.env.SAUDI_ENGINE_SYSTEM ||
  'أنت "سعودي AI"، مساعد عربي ودود ودقيق. أجب بالعربية الفصحى المبسطة ما لم يُطلب غير ذلك.';

export const saudiEngineEnabled = () => Boolean(URL_);

export async function callSaudiEngine(messages, { system = SYSTEM, maxTokens = 1024, temperature = 0.4 } = {}) {
  if (!URL_) throw new Error('المحرك غير مفعّل بعد');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`${URL_}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(KEY && { Authorization: `Bearer ${KEY}` }) },
      body: JSON.stringify({
        model: MODEL, max_tokens: maxTokens, temperature,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || `خطأ من المحرك (${r.status})`);
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('رد غير متوقع من المحرك');
    return text.trim();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('المحرك يستيقظ من السكون، أعد المحاولة بعد دقيقة');
    throw e;
  } finally { clearTimeout(timer); }
}

// حماية من الإساءة: كل زائر له عدد محدود من الرسائل في الدقيقة (لأن كل رسالة تكلّفك)
const hits = new Map();
function limit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= PER_MIN) return res.status(429).json({ error: 'رسائل كثيرة، انتظر دقيقة' });
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  next();
}

const router = express.Router();

router.get('/status', (_req, res) => res.json({ enabled: saudiEngineEnabled(), model: MODEL }));

// POST /api/saudi/chat  { messages: [{role, content}, ...] }
router.post('/chat', limit, async (req, res) => {
  try {
    const msgs = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const clean = msgs
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
    if (!clean.length || clean.at(-1).role !== 'user') return res.status(400).json({ error: 'رسالة فارغة' });
    res.json({ text: await callSaudiEngine(clean) });
  } catch (e) {
    console.error('saudi/chat', e.message);
    res.status(502).json({ error: e.message });
  }
});

export default router;
