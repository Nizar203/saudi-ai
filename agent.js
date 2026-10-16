// وكيل البناء: بدل أن يكتب النموذج التطبيق كله دفعة واحدة، يعمل خطوة بخطوة بأدوات:
// يكتب الملف على أجزاء، يعدّل مواضع محددة، يقرأ ما يحتاجه، ويفحص الكود ويصلح أخطاءه قبل التسليم.
// النتيجة النهائية تُرسل للمتصفح بنفس صيغة المحرك القديم (رسالة + ملف المشروع + ملف HTML).
import vm from 'vm';

const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS || 24);
const MAX_OUTPUT_TOKENS = Number(process.env.AGENT_MAX_OUTPUT_TOKENS || 140000); // سقف التكلفة لكل طلب
const MAX_FILE = 400_000;

const TOOLS = [
  {
    name: 'write_file',
    description: 'Replace the whole app file (index.html) with new content. For a long new app, write the first part here and continue with append_file.',
    input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  },
  {
    name: 'append_file',
    description: 'Append the next part of the app file to the end of what was written so far. Use it to write a long file in parts of about 12,000 characters.',
    input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  },
  {
    name: 'edit_file',
    description: 'Replace one exact snippet of the app file. old_str must match exactly once (include surrounding lines to make it unique). Prefer this over rewriting the file for any change to an existing app.',
    input_schema: {
      type: 'object',
      properties: { old_str: { type: 'string' }, new_str: { type: 'string' } },
      required: ['old_str', 'new_str'],
    },
  },
  {
    name: 'read_file',
    description: 'Read lines of the current app file with line numbers, to see exact text before editing.',
    input_schema: {
      type: 'object',
      properties: { start_line: { type: 'integer' }, end_line: { type: 'integer' } },
    },
  },
  {
    name: 'check_app',
    description: 'Check the app file: complete document, JavaScript syntax errors in every inline script, duplicate element ids, forbidden direct storage use. Always run it before finish, and fix every error it reports.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'finish',
    description: 'Finish the task after check_app passes. message: 1-2 plain sentences to the user in their language (no Markdown, no technical terms). brief: the updated project brief (Markdown, at most 25 short lines, headings: الهدف, التصميم, الشاشات والميزات, البيانات المحفوظة, قرارات المستخدم).',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string' }, brief: { type: 'string' } },
      required: ['message', 'brief'],
    },
  },
];

export const AGENT_RULES = [
  'You work as an agent with tools on one file: index.html, the complete app. You never print code in chat; you only change the file through tools.',
  'NEW APP: plan briefly, then write_file with the first part and append_file for the rest, in order, until the file ends with </html>.',
  'CHANGE REQUEST: the current file is already loaded. Use read_file to see exact lines, then edit_file for each change. Rewrite with write_file only if most of the file must change.',
  'Then call check_app. If it reports errors, fix them with edit_file and run check_app again. When it passes, call finish.',
  'Keep tool inputs focused; do not repeat unchanged code.',
].join(' ');

// ---------- فحص التطبيق ----------
export function checkApp(html) {
  const errors = [];
  const warnings = [];
  if (!html.trim()) return { ok: false, report: 'ERROR: the file is empty.' };
  if (!/<html[\s>]/i.test(html) || !/<\/html>\s*$/i.test(html.trim())) errors.push('The file must start a full HTML document and end with </html> (it may be unfinished: continue with append_file).');
  if (!/<meta[^>]+viewport/i.test(html)) warnings.push('Missing <meta name="viewport">, the app will not be responsive on phones.');
  if (/[؀-ۿ]/.test(html) && !/<html[^>]*dir=["']?rtl/i.test(html)) warnings.push('Arabic text found but <html> has no dir="rtl".');

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((m, i) => {
    const attrs = m[1] || '';
    if (/\bsrc=/i.test(attrs) || /type=["']?(application\/json|text\/template|importmap)/i.test(attrs)) return;
    const code = m[2];
    const startLine = html.slice(0, m.index).split('\n').length;
    try {
      new vm.Script(code, { filename: `script${i + 1}` });
    } catch (e) {
      const ln = /:(\d+)/.exec(String(e.stack || ''))?.[1];
      errors.push(`JavaScript syntax error in <script> #${i + 1}${ln ? ` near file line ${startLine + Number(ln) - 1}` : ''}: ${e.message}`);
    }
    if (/\blocalStorage\b/.test(code) && !/appDB/.test(code)) errors.push(`<script> #${i + 1} uses localStorage directly; use window.appDB.get/set for app data.`);
  });

  const ids = {};
  for (const m of html.matchAll(/\sid=["']([^"']+)["']/g)) ids[m[1]] = (ids[m[1]] || 0) + 1;
  const dup = Object.keys(ids).filter((k) => ids[k] > 1 && !/[${]/.test(k));
  if (dup.length) warnings.push('Duplicate element ids: ' + dup.slice(0, 10).join(', '));

  // دوال مستدعاة من onclick وغيرها لكنها غير معرّفة في أي سكربت
  const allJs = scripts.map((m) => m[2]).join('\n');
  const handlers = new Set([...html.matchAll(/\son\w+=["']\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const builtins = new Set(['alert', 'confirm', 'prompt', 'print', 'window', 'document', 'event', 'this', 'history', 'location', 'setTimeout', 'navigator', 'console', 'Number', 'String']);
  const missing = [...handlers].filter((f) => {
    if (builtins.has(f)) return false;
    const q = f.replace(/\$/g, '\\$');
    return !new RegExp(`(function\\s*\\*?\\s*${q}\\b|\\b${q}\\s*=|\\b${q}\\s*\\([^)]*\\)\\s*\\{|window\\.${q}\\b|\\b${q}\\s*:)`).test(allJs);
  });
  if (missing.length) errors.push('Inline event handlers call undefined functions: ' + missing.slice(0, 10).join(', '));

  const kb = Math.round(html.length / 1000);
  const report = (errors.length ? 'ERRORS (fix all, then run check_app again):\n- ' + errors.join('\n- ') : 'PASSED: no errors found.') +
    (warnings.length ? '\nWARNINGS:\n- ' + warnings.join('\n- ') : '') + `\nFile size: ${kb}k characters, ${html.split('\n').length} lines.`;
  return { ok: !errors.length, report };
}

function numbered(html, a, b) {
  const lines = html.split('\n');
  const s = Math.max(1, a || 1);
  const e = Math.min(lines.length, b || Math.min(lines.length, s + 249));
  if (!lines.length || s > lines.length) return `The file has ${lines.length} lines.`;
  return lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join('\n') + (e < lines.length ? `\n... (${lines.length} lines in total)` : '');
}

// ---------- طلب متدفق واحد للنموذج، يعيد الرسالة كاملة بكل كتلها ----------
async function streamTurn({ apiKey, body, onEvent }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!r.ok || !r.body) {
    let detail = '';
    try { detail = (await r.json()).error?.message || ''; } catch { /* ignore */ }
    const err = new Error(detail || `Anthropic API returned ${r.status}`);
    err.code = 'upstream_error';
    err.status = r.status;
    throw err;
  }
  const blocks = [];
  const partial = {};
  let stop = null;
  let outTokens = 0;
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'content_block_start') {
        blocks[ev.index] = { ...ev.content_block };
        if (ev.content_block.type === 'tool_use') { partial[ev.index] = ''; blocks[ev.index].input = {}; }
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index];
        const d = ev.delta || {};
        if (!b) continue;
        if (d.type === 'text_delta') b.text = (b.text || '') + d.text;
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') partial[ev.index] += d.partial_json || '';
        else if (d.type === 'citations_delta') (b.citations ||= []).push(d.citation);
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b?.type === 'tool_use') {
          try { b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : {}; } catch { b.input = { __bad_json: true }; }
        }
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        if (ev.usage?.output_tokens) outTokens = ev.usage.output_tokens;
      } else if (ev.type === 'error') {
        const err = new Error(ev.error?.message || 'stream_error');
        err.code = 'upstream_error';
        throw err;
      }
      onEvent(ev, blocks, partial);
    }
  }
  return { content: blocks.filter(Boolean), stop, outTokens };
}

// ---------- حلقة الوكيل ----------
// progress(text): يعرض حالة للمستخدم. beat(): نبضة تبقي الاتصال حياً.
export async function runAgent({ apiKey, model, effort, system, userMsg, currentHtml, isAborted, progress, beat }) {
  let html = currentHtml || '';
  const messages = [{ role: 'user', content: [{ type: 'text', text: userMsg }] }];
  let finished = null;
  let totalOut = 0;
  let checkedSinceChange = false;
  let lastCheck = null;

  const say = (t) => progress && progress(t);
  say(html ? '🔎 يقرأ تطبيقك الحالي…' : '🧠 يخطط للتطبيق…');

  for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
    if (isAborted()) throw Object.assign(new Error('aborted'), { code: 'aborted' });
    // نقطة تخزين مؤقت متحركة على آخر رسالة: كل دورة تعيد استخدام ما قبلها بتكلفة أقل بكثير
    messages.forEach((m) => m.content.forEach((c) => { if (c.cache_control) delete c.cache_control; }));
    const last = messages[messages.length - 1].content;
    last[last.length - 1].cache_control = { type: 'ephemeral' };

    const body = {
      model,
      max_tokens: 32000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    };
    if (effort) body.output_config = { effort };

    let lastShown = 0;
    const res = await streamTurn({
      apiKey,
      body,
      onEvent: (ev, blocks, partial) => {
        beat && beat();
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          const n = ev.content_block.name;
          say({ write_file: '✍️ يكتب التطبيق…', append_file: '✍️ يكمل كتابة التطبيق…', edit_file: '🛠️ يعدّل…',
            read_file: '🔎 يقرأ الكود…', check_app: '🧪 يفحص التطبيق…', finish: '📦 يجهّز النتيجة…' }[n] || '…');
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
          const b = blocks[ev.index];
          const len = partial[ev.index].length;
          if ((b?.name === 'write_file' || b?.name === 'append_file') && len - lastShown > 1500) {
            lastShown = len;
            say(`✍️ يكتب التطبيق… ${(html.length + len).toLocaleString('ar')} حرف`);
          }
        }
      },
    });
    totalOut += res.outTokens || 0;
    messages.push({ role: 'assistant', content: res.content });

    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) {
      if (res.stop === 'max_tokens' || res.stop === 'end_turn' || res.stop === 'pause_turn') {
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Continue using the tools. When the file is complete and check_app passes, call finish.' }] });
        continue;
      }
      break;
    }

    const results = [];
    for (const u of uses) {
      const inp = u.input || {};
      let out = '';
      let isError = false;
      if (inp.__bad_json) {
        out = 'Your tool input was cut off or invalid JSON (probably too long). Send smaller parts: use append_file with about 12,000 characters at a time.';
        isError = true;
      } else if (u.name === 'write_file') {
        html = String(inp.content || '');
        checkedSinceChange = false;
        out = `Written: ${html.length} characters, ${html.split('\n').length} lines.` + (/<\/html>\s*$/i.test(html.trim()) ? '' : ' Not finished yet: continue with append_file.');
      } else if (u.name === 'append_file') {
        html += String(inp.content || '');
        checkedSinceChange = false;
        out = `Appended. File is now ${html.length} characters, ${html.split('\n').length} lines.` + (/<\/html>\s*$/i.test(html.trim()) ? ' The document is closed.' : ' Continue with append_file.');
      } else if (u.name === 'edit_file') {
        const o = String(inp.old_str ?? '');
        const n = String(inp.new_str ?? '');
        const count = o ? html.split(o).length - 1 : 0;
        if (!o) { out = 'old_str is empty.'; isError = true; }
        else if (count === 0) { out = 'old_str was not found. Use read_file to copy the exact current text (spaces and line breaks included).'; isError = true; }
        else if (count > 1) { out = `old_str matches ${count} places. Include more surrounding text so it matches exactly once.`; isError = true; }
        else { html = html.replace(o, () => n); checkedSinceChange = false; out = 'Edited.'; }
      } else if (u.name === 'read_file') {
        out = numbered(html, inp.start_line, inp.end_line);
      } else if (u.name === 'check_app') {
        lastCheck = checkApp(html);
        checkedSinceChange = true;
        out = lastCheck.report;
        if (!lastCheck.ok) say('🛠️ وجد أخطاء ويصلحها…');
      } else if (u.name === 'finish') {
        if (!checkedSinceChange) { lastCheck = checkApp(html); checkedSinceChange = true; }
        if (!lastCheck.ok) { out = 'Cannot finish yet:\n' + lastCheck.report; isError = true; }
        else finished = { message: String(inp.message || ''), brief: String(inp.brief || '') };
        if (finished) out = 'Done.';
      } else {
        out = 'Unknown tool.';
        isError = true;
      }
      if (html.length > MAX_FILE) { out += '\nThe file is too large; make it more compact.'; isError = true; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });

    if (totalOut > MAX_OUTPUT_TOKENS) break;
  }

  if (!finished) {
    // انتهت الدورات أو الميزانية: نسلّم أفضل ما وصل إليه إن كان ملفاً مكتملاً
    const c = checkApp(html);
    if (!/<\/html>\s*$/i.test(html.trim())) {
      const err = new Error('لم يكتمل بناء التطبيق ضمن الحد المسموح. جرّب طلباً أصغر أو على خطوات.');
      err.code = 'agent_incomplete';
      throw err;
    }
    finished = { message: c.ok ? 'تم تنفيذ طلبك.' : 'تم تنفيذ معظم طلبك، وقد تبقى بعض الأخطاء. اطلب «أصلح الأخطاء» إن لاحظت مشكلة.', brief: '' };
  }
  return { html, message: finished.message, brief: finished.brief };
}
