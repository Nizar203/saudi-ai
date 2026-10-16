// محرك Google Gemini + توليد وتعديل الصور (Nano Banana) — اختياري.
// يُفعَّل بإضافة GEMINI_API_KEY في متغيرات البيئة (من aistudio.google.com).
// يستخدم واجهة Interactions الحالية من جوجل، مع رجوع تلقائي لواجهة generateContent القديمة.

const KEY = process.env.GEMINI_API_KEY || '';
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
const TIMEOUT = Number(process.env.GEMINI_TIMEOUT_MS || 180000);

export const geminiEnabled = () => Boolean(KEY);

function fail(message, code = 'upstream_error', status) {
  const err = new Error(message);
  err.code = code;
  if (status) err.status = status;
  return err;
}

async function post(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    if (e.name === 'AbortError') throw fail('انتهت مهلة الرد من Gemini، حاول مرة أخرى.', 'timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const errMsg = (res, label) => res.data?.error?.message || `${label} returned ${res.status}`;

// يجمع النصوص من رد Gemini أياً كان شكله (Interactions أو generateContent)، ويتجاهل خطوات التفكير ومدخلات المستخدم
function extractText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.thought === true || n.type === 'thought' || n.type === 'user_input' || n.role === 'user') return;
    if (typeof n.text === 'string' && (n.type === 'text' || n.type === undefined)) out.push(n.text);
    for (const [k, v] of Object.entries(n)) if (k !== 'text' && k !== 'summary') walk(v);
  })(data);
  return out.join('');
}

// يستخرج الصور (base64) من الرد أياً كان شكله
function extractImages(data) {
  const out = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === 'user_input' || n.role === 'user' || n.thought === true || n.type === 'thought') return;
    const mime = n.mime_type || n.mimeType;
    if (typeof n.data === 'string' && n.data.length > 100 && (n.type === 'image' || (mime && /^image\//.test(mime)))) {
      if (!seen.has(n.data)) { seen.add(n.data); out.push({ mime: mime || 'image/png', data: n.data }); }
      return;
    }
    Object.values(n).forEach(walk);
  })(data);
  return out;
}

// محادثة / بناء: messages بصيغة [{role:'user'|'assistant', content:'...'}]
export async function callGemini(messages, system) {
  if (!KEY) throw fail('missing_gemini_key', 'missing_api_key');
  const input = messages.map((m) => ({
    type: m.role === 'assistant' ? 'model_output' : 'user_input',
    content: [{ type: 'text', text: String(m.content || '') }],
  }));
  const body = { model: GEMINI_MODEL, store: false, input };
  if (system) body.system_instruction = system;

  let res = await post(`${BASE}/interactions`, body);
  if (res.status === 404) {
    // رجوع لواجهة generateContent إن لم تتوفر Interactions
    const gc = {
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] })),
    };
    if (system) gc.systemInstruction = { parts: [{ text: system }] };
    res = await post(`${BASE}/models/${GEMINI_MODEL}:generateContent`, gc);
  }
  if (!res.ok) throw fail(errMsg(res, 'Gemini'), 'upstream_error', res.status);
  const text = extractText(res.data);
  if (!text) throw fail('رد فارغ من Gemini');
  return text;
}

// توليد صورة من وصف، أو تعديل صورة موجودة إذا أُرسلت image={mime,data}
export async function generateImage({ prompt, image, aspect }) {
  if (!KEY) throw fail('missing_gemini_key', 'missing_api_key');
  const input = [{ type: 'text', text: prompt }];
  if (image?.data) input.push({ type: 'image', mime_type: image.mime || 'image/png', data: image.data });
  const body = { model: IMAGE_MODEL, store: false, input };
  if (aspect) body.response_format = { type: 'image', aspect_ratio: aspect };

  let res = await post(`${BASE}/interactions`, body);
  if (res.status === 404 || (res.status === 400 && aspect)) {
    const parts = [{ text: prompt }];
    if (image?.data) parts.push({ inline_data: { mime_type: image.mime || 'image/png', data: image.data } });
    const gc = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
    if (aspect) gc.generationConfig.imageConfig = { aspectRatio: aspect };
    res = await post(`${BASE}/models/${IMAGE_MODEL}:generateContent`, gc);
  }
  if (!res.ok) throw fail(errMsg(res, 'Nano Banana'), 'upstream_error', res.status);
  const images = extractImages(res.data);
  const text = extractText(res.data).trim();
  if (!images.length) throw fail(text || 'لم يُرجع النموذج صورة. جرّب وصفاً أوضح.', 'no_image');
  return { images, text };
}

export const _test = { extractText, extractImages };
