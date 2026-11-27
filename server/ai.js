'use strict';
// AI 判分：支持多个服务商 —— Anthropic（Claude）、OpenAI（GPT）、DeepSeek，以及任何“OpenAI 兼容”的自定义服务商（通义千问、Kimi、智谱等）。
// 只在服务器端调用；API 密钥只在这里使用，不会写进日志、错误信息或返回给页面。
// 直接用 Node 自带的 fetch 发 HTTPS 请求，不装各家的 SDK。
//
// PDF 的处理：
//   · 能直接读 PDF 的（Claude、GPT，或自定义服务商勾选了“能直接读 PDF”）：把 PDF 原样发过去；
//   · 只能收文字的（DeepSeek，或自定义服务商没有勾选）：服务器先用 unpdf 把 PDF 里的文字提取出来，再把文字发过去。
//     纯扫描图片的 PDF 提取不出文字，会给出明确的提示。
const fs = require('fs');
const config = require('./config');
const files = require('./files');

const ANTHROPIC_VERSION = '2026-10-21';
const MAX_TOKENS_CLAUDE = 16000; // 包含模型思考用的 token，给足以免被截断
const MAX_TOKENS_OPENAI = 16000;
const MAX_TOKENS_DEEPSEEK = 16000; // DeepSeek 默认开启“思考”，思考的内容也占输出 token，给足以免被截断
const MAX_TOTAL_BYTES = 24 * 1024 * 1024; // 一次请求里 PDF 的总大小上限
const MAX_PDF_TEXT_CHARS = 100000; // 单个 PDF 提取出的文字上限
const MIN_PDF_TEXT_CHARS = 20; // 少于这个字数，认为是扫描件

const PROVIDERS = {
  anthropic: {
    id: 'anthropic', label: 'Anthropic（Claude）', kind: 'anthropic', pdf: 'native',
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', note: '推荐：判分准确度高' },
      { id: 'claude-sonnet-5-5', note: '更快、更便宜' },
      { id: 'claude-haiku-5-5', note: '最便宜，适合简单题目' },
      { id: 'claude-fable-5-2', note: '能力最强，价格也最高' }
    ]
  },
  openai: {
    id: 'openai', label: 'OpenAI（GPT）', kind: 'openai', pdf: 'native', json: 'schema',
    defaultModel: 'gpt-4.1',
    models: [
      { id: 'gpt-4.1', note: '能直接读 PDF' },
      { id: 'gpt-5', note: '能力更强' },
      { id: 'gpt-5-mini', note: '更快、更便宜' },
      { id: 'gpt-4o', note: '能直接读 PDF' }
    ]
  },
  deepseek: {
    // deepseek-flash 可以通过 DeepSeek 的“文件接口”读 PDF（先上传解析，再用 file_id 引用）；其他模型（如 deepseek-v4-pro）只读文字
    id: 'deepseek', label: 'DeepSeek', kind: 'openai', pdf: 'files', json: 'object', maxTokens: MAX_TOKENS_DEEPSEEK,
    filesModelPattern: '^deepseek-(v4-)?flash',
    defaultModel: 'deepseek-flash',
    models: [
      { id: 'deepseek-flash', note: '推荐：能读 PDF（含扫描的文字）、便宜' },
      { id: 'deepseek-v4-pro', note: '更强，但只读文字（PDF 先提取文字）' }
    ]
  },
  custom: {
    id: 'custom', label: '自定义（OpenAI 兼容）', kind: 'openai', pdf: 'configurable', json: 'prompt', custom: true,
    defaultModel: '', models: []
  }
};

class AiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status || 502; }
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: { score: { type: 'integer', enum: [1, 2, 3, 4, 5] }, feedback: { type: 'string' } },
  required: ['score', 'feedback'],
  additionalProperties: false
};
const JSON_ONLY = '\n\n只输出一个 JSON 对象：{"score": 1-5 的整数, "feedback": "中文反馈"}，不要输出其他任何内容。';

/* ---------- 自定义服务商的地址检查 ---------- */
// 必须是 https；不能带用户名密码；默认不允许指向本机或内网地址（防止被用来探测服务器所在的内网）。
// allowPrivate 只在测试里打开。注意：这里只检查地址写法，不做 DNS 解析。
function validateBaseUrl(raw, { allowPrivate = config.aiAllowPrivateBase } = {}) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) throw new AiError('INVALID_BASE_URL', '请填写服务商的接口地址（例如 https://api.example.com/v1）。', 422);
  let u;
  try { u = new URL(raw.trim()); } catch (e) { throw new AiError('INVALID_BASE_URL', '接口地址格式不对，需要以 https:// 开头。', 422); }
  if (u.username || u.password) throw new AiError('INVALID_BASE_URL', '接口地址里不能包含用户名或密码。', 422);
  if (u.search || u.hash) throw new AiError('INVALID_BASE_URL', '接口地址里不要带问号参数。', 422);
  if (!allowPrivate) {
    if (u.protocol !== 'https:') throw new AiError('INVALID_BASE_URL', '接口地址必须以 https:// 开头。', 422);
    const h = u.hostname.toLowerCase();
    const isIp4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
    const privateV4 = isIp4 && (/^(10|127|0)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h));
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || privateV4 || h.includes(':') || h === '[::1]' || !h.includes('.')) {
      throw new AiError('INVALID_BASE_URL', '接口地址不能指向本机或内网，请填写服务商的公网地址。', 422);
    }
  } else if (!['https:', 'http:'].includes(u.protocol)) throw new AiError('INVALID_BASE_URL', '接口地址必须以 https:// 开头。', 422);
  return u.toString().replace(/\/+$/, '');
}

/* ---------- 共用：错误翻译与请求 ---------- */
function explain(label, status, apiMessage) {
  const detail = apiMessage ? `（${String(apiMessage).slice(0, 300)}）` : '';
  if (status === 401) return new AiError('AI_AUTH_FAILED', `${label} 拒绝了 API 密钥，请管理员在“AI 评分设置”里检查密钥${detail}`, 502);
  if (status === 403) return new AiError('AI_FORBIDDEN', `这个 API 密钥没有权限使用该模型或功能${detail}`, 502);
  if (status === 404) return new AiError('AI_MODEL_NOT_FOUND', `找不到这个模型或接口地址不对，请管理员检查模型名称和地址${detail}`, 502);
  if (status === 413) return new AiError('AI_TOO_LARGE', `提交的内容太大，${label} 无法处理${detail}`, 413);
  if (status === 402) return new AiError('AI_PAYMENT', `${label} 的账户余额不足或未开通付费${detail}`, 502);
  if (status === 429) return new AiError('AI_RATE_LIMITED', `${label} 繁忙或额度不足，请稍后再试${detail}`, 502);
  if (status === 400 || status === 422) return new AiError('AI_BAD_REQUEST', `${label} 不接受这次请求${detail}`, 502);
  if (status >= 500) return new AiError('AI_UNAVAILABLE', `${label} 暂时不可用（${status}），请稍后再试`, 502);
  return new AiError('AI_ERROR', `${label} 返回了错误（${status}）${detail}`, 502);
}

async function postJson(label, url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(config.aiTimeoutMs) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('AI_TIMEOUT', `${label} 响应超时，请稍后再试。`, 504);
    throw new AiError('AI_UNREACHABLE', `无法连接 ${label}，请检查服务器的网络（出站 HTTPS 是否放行）。`, 502);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 不是 JSON */ }
  if (!res.ok) {
    const msg = data && data.error && (data.error.message || (typeof data.error === 'string' ? data.error : null));
    throw Object.assign(explain(label, res.status, msg), { apiMessage: msg || '', httpStatus: res.status });
  }
  if (!data) throw new AiError('AI_BAD_RESPONSE', `${label} 返回的内容无法识别。`);
  return data;
}

/* ---------- 解析一个“已选定的服务商配置” ---------- */
// cfg: { provider, model, apiKey, baseUrl?, pdfNative? }
function resolve(cfg) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new AiError('AI_BAD_PROVIDER', '不支持这个 AI 服务商。', 422);
  let base;
  if (p.custom) base = validateBaseUrl(cfg.baseUrl);
  else base = config.aiBases[p.id];
  const pdfNative = p.pdf === 'native' ? true : p.pdf === 'configurable' ? !!cfg.pdfNative : false;
  const pdfFiles = p.pdf === 'files' && new RegExp(p.filesModelPattern).test(String(cfg.model || '')); // 走 DeepSeek 文件接口
  return { p, base, pdfNative, pdfFiles, label: p.custom ? `${p.label}（${new URL(base).host}）` : p.label };
}

/* ---------- Anthropic ---------- */
function anthropicText(data) { return data.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim(); }
async function anthropicCall(r, apiKey, body) {
  const data = await postJson(r.label, `${r.base}/v1/messages`, { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }, body);
  if (!Array.isArray(data.content)) throw new AiError('AI_BAD_RESPONSE', `${r.label} 返回的内容无法识别。`);
  return data;
}

/* ---------- OpenAI 兼容（OpenAI / DeepSeek / 自定义） ---------- */
async function openaiCall(r, apiKey, body) {
  const data = await postJson(r.label, `${r.base}/chat/completions`, { authorization: `Bearer ${apiKey}` }, body);
  if (!Array.isArray(data.choices) || !data.choices[0]) throw new AiError('AI_BAD_RESPONSE', `${r.label} 返回的内容无法识别。`);
  return data;
}
function openaiText(data) {
  const m = data.choices[0].message || {};
  if (typeof m.content === 'string') return m.content.trim();
  if (Array.isArray(m.content)) return m.content.map((b) => (b && b.text) || '').join('\n').trim();
  return '';
}

/* ---------- DeepSeek 文件接口：上传 PDF（解析后得到 file_id），聊天里用 file_id 引用，用完删除 ---------- */
async function deepseekUpload(r, apiKey, buf, filename) {
  const form = new FormData();
  form.append('purpose', 'text_recognition'); // 必须在 file 之前；只取文字（含扫描件的文字识别），不取图表
  form.append('file', new Blob([buf], { type: 'application/pdf' }), filename);
  let res;
  try { res = await fetch(`${r.base}/files`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(config.aiTimeoutMs) }); } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('AI_TIMEOUT', `${r.label} 解析 PDF 超时，请稍后再试。`, 504);
    throw new AiError('AI_UNREACHABLE', `无法连接 ${r.label}，请检查服务器的网络（出站 HTTPS 是否放行）。`, 502);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 不是 JSON */ }
  if (!res.ok) {
    const msg = data && data.error && (data.error.message || (typeof data.error === 'string' ? data.error : null));
    if (res.status === 400) throw new AiError('AI_PDF_UNREADABLE', `${r.label} 无法解析这个 PDF（文件可能损坏、有密码或格式不支持）${msg ? '：' + String(msg).slice(0, 200) : ''}`, 422);
    if (res.status === 408 || res.status === 504) throw new AiError('AI_TIMEOUT', `${r.label} 解析 PDF 超时，请稍后再试。`, 504);
    throw explain(r.label, res.status, msg);
  }
  if (!data || typeof data.id !== 'string') throw new AiError('AI_BAD_RESPONSE', `${r.label} 返回的内容无法识别。`);
  return data.id;
}
async function deepseekDelete(r, apiKey, ids) { // 尽力而为：失败不影响结果（文件也会占用账号的存储，所以用完就删）
  await Promise.all(ids.map((id) => fetch(`${r.base}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) }).catch(() => null)));
}

/* ---------- PDF ---------- */
function readPdf(file) { return fs.readFileSync(files.pathFor(file.stored_name)); }
function pdfPart(buf) { return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }; }

let unpdfPromise = null;
async function extractPdfText(buf, what) {
  let mod;
  try { unpdfPromise = unpdfPromise || import('unpdf'); mod = await unpdfPromise; } catch (e) {
    unpdfPromise = null;
    throw new AiError('AI_PDF_TEXT_UNAVAILABLE', '服务器上没有安装“PDF 文字提取”组件（unpdf），无法把 PDF 转成文字交给这个模型。请管理员运行部署更新脚本，或改用能直接读 PDF 的模型（Claude、GPT）。', 500);
  }
  let text;
  try {
    const pdf = await mod.getDocumentProxy(new Uint8Array(buf));
    const out = await mod.extractText(pdf, { mergePages: true });
    text = String(out.text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    throw new AiError('AI_PDF_UNREADABLE', `${what} 无法读取（文件可能损坏或有密码）。`, 422);
  }
  if (text.replace(/\s/g, '').length < MIN_PDF_TEXT_CHARS) {
    throw new AiError('AI_PDF_NO_TEXT', `${what} 里提取不到文字（可能是扫描的图片）。这个模型只能读文字：请换成含文字的 PDF，或改用能直接读 PDF 的模型（Claude、GPT）。`, 422);
  }
  if (text.length > MAX_PDF_TEXT_CHARS) throw new AiError('AI_TOO_LARGE', `${what} 里的文字太长（超过 ${MAX_PDF_TEXT_CHARS} 字），请精简后再试。`, 413);
  return text;
}

/* ---------- 解析模型返回的评分 ---------- */
function parseGrade(text) {
  let t = String(text || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  let obj = null;
  try { obj = JSON.parse(t); } catch (e) {
    const m = /\{[\s\S]*\}/.exec(t);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') throw new AiError('AI_BAD_RESPONSE', 'AI 的回答格式不对，无法读出评分。请重试。');
  const score = obj.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new AiError('AI_BAD_SCORE', 'AI 返回的评分不是 1–5 的整数，已丢弃。请重试。');
  const feedback = typeof obj.feedback === 'string' ? obj.feedback.trim() : '';
  return { score, feedback: feedback.slice(0, 8000) };
}

/* ---------- 连通性测试 ---------- */
async function test(cfg) {
  const r = resolve(cfg);
  const started = Date.now();
  const q = '请只回复一个词：OK';
  let reply, model;
  if (r.p.kind === 'anthropic') {
    const data = await anthropicCall(r, cfg.apiKey, { model: cfg.model, max_tokens: 1024, messages: [{ role: 'user', content: q }] });
    if (data.stop_reason === 'refusal') throw new AiError('AI_REFUSED', 'AI 拒绝了测试请求。');
    reply = anthropicText(data); model = data.model;
  } else {
    const body = Object.assign({ model: cfg.model, messages: [{ role: 'user', content: q }] }, tokenLimit(r.p, 1024));
    if (r.p.id === 'deepseek') body.thinking = { type: 'disabled' };
    const data = await openaiCall(r, cfg.apiKey, body);
    reply = openaiText(data); model = data.model;
  }
  return { latencyMs: Date.now() - started, model: model || cfg.model, reply: reply.slice(0, 200) };
}
// OpenAI 新模型要用 max_completion_tokens；DeepSeek 和多数兼容服务用 max_tokens
function tokenLimit(p, n) { return p.id === 'openai' ? { max_completion_tokens: n } : { max_tokens: Math.min(n, p.maxTokens || n) }; }

/* ---------- 判分 ---------- */
// cfg: { provider, model, apiKey, baseUrl?, pdfNative?, systemPrompt }
// input: { questionFile, rubricFile, answerText?, answerFile? }（文件是 files 表的行）
// 只发送三样东西：题目 PDF、学生回答（文字或 PDF 二选一）、判分标准 PDF
async function grade(cfg, input) {
  const hasText = typeof input.answerText === 'string';
  const hasFile = !!input.answerFile;
  if (hasText === hasFile) throw new AiError('AI_BAD_INPUT', '学生回答必须二选一：文字或 PDF。', 422);
  const r = resolve(cfg);

  const bufs = { q: readPdf(input.questionFile), r: readPdf(input.rubricFile), a: hasFile ? readPdf(input.answerFile) : null };
  const total = bufs.q.length + bufs.r.length + (bufs.a ? bufs.a.length : 0);
  if (total > MAX_TOTAL_BYTES) throw new AiError('AI_TOO_LARGE', 'PDF 文件加起来太大，AI 服务无法处理（总共不能超过约 24MB）。', 413);

  let result;
  if (r.p.kind === 'anthropic') result = await gradeAnthropic(r, cfg, input, bufs);
  else result = await gradeOpenAi(r, cfg, input, bufs);
  result.provider = r.p.id;
  return result;
}

async function gradeAnthropic(r, cfg, input, bufs) {
  const parts = [{ type: 'text', text: '【1. 题目（PDF）】' }, pdfPart(bufs.q), { type: 'text', text: '【2. 学生的回答' + (bufs.a ? '（PDF）】' : '（文字）】') }];
  if (bufs.a) parts.push(pdfPart(bufs.a)); else parts.push({ type: 'text', text: '<student_answer>\n' + input.answerText + '\n</student_answer>' });
  parts.push({ type: 'text', text: '【3. 判分标准（PDF）】' }, pdfPart(bufs.r), { type: 'text', text: '请依据判分标准，给这道题的学生回答打分（1–5 的整数），并给出简明的反馈。' });
  const base = { model: cfg.model, max_tokens: MAX_TOKENS_CLAUDE, system: cfg.systemPrompt, messages: [{ role: 'user', content: parts }] };
  let data;
  try {
    data = await anthropicCall(r, cfg.apiKey, Object.assign({ output_config: { format: { type: 'json_schema', schema: GRADE_SCHEMA } } }, base));
  } catch (e) {
    // 个别模型不支持结构化输出：去掉它再试一次，改为从文字里读 JSON
    if (e && e.httpStatus === 400 && /output_config|structured|json_schema|format/i.test(e.apiMessage || '')) data = await anthropicCall(r, cfg.apiKey, Object.assign({}, base, { system: cfg.systemPrompt + JSON_ONLY }));
    else throw e;
  }
  if (data.stop_reason === 'refusal') throw new AiError('AI_REFUSED', 'AI 拒绝处理这次内容，没有给出评分。请检查文件，或稍后重试。');
  if (data.stop_reason === 'max_tokens') throw new AiError('AI_TRUNCATED', 'AI 的回答被截断了，没有得到评分。请重试。');
  const res = parseGrade(anthropicText(data));
  res.model = data.model || cfg.model;
  res.inputTokens = data.usage && data.usage.input_tokens;
  res.outputTokens = data.usage && data.usage.output_tokens;
  return res;
}

async function gradeOpenAi(r, cfg, input, bufs) {
  const tail = '请依据判分标准，给这道题的学生回答打分（1–5 的整数），并给出简明的反馈。';
  let content;
  const uploaded = [];
  try {
  if (r.pdfFiles) {
    // DeepSeek：先逐个上传解析，再用 file_id 引用（file_id 只在本次请求里用，结束后删除）
    const up = async (buf, name) => { const id = await deepseekUpload(r, cfg.apiKey, buf, name); uploaded.push(id); return { type: 'file', file_id: id }; };
    const q = await up(bufs.q, 'question.pdf');
    const a = bufs.a ? await up(bufs.a, 'answer.pdf') : null;
    const rub = await up(bufs.r, 'rubric.pdf');
    content = [{ type: 'text', text: '【1. 题目（PDF）】' }, q, { type: 'text', text: '【2. 学生的回答' + (a ? '（PDF）】' : '（文字）】') }];
    if (a) content.push(a); else content.push({ type: 'text', text: '<student_answer>\n' + input.answerText + '\n</student_answer>' });
    content.push({ type: 'text', text: '【3. 判分标准（PDF）】' }, rub, { type: 'text', text: tail });
  } else if (r.pdfNative) {
    // 能直接读 PDF：用 file 内容块（OpenAI Chat Completions 的文件输入）
    const file = (buf, name) => ({ type: 'file', file: { filename: name, file_data: 'data:application/pdf;base64,' + buf.toString('base64') } });
    content = [{ type: 'text', text: '【1. 题目（PDF）】' }, file(bufs.q, 'question.pdf'), { type: 'text', text: '【2. 学生的回答' + (bufs.a ? '（PDF）】' : '（文字）】') }];
    if (bufs.a) content.push(file(bufs.a, 'answer.pdf')); else content.push({ type: 'text', text: '<student_answer>\n' + input.answerText + '\n</student_answer>' });
    content.push({ type: 'text', text: '【3. 判分标准（PDF）】' }, file(bufs.r, 'rubric.pdf'), { type: 'text', text: tail });
  } else {
    // 只能收文字：先把 PDF 里的文字提取出来
    const qText = await extractPdfText(bufs.q, '题目 PDF');
    const rText = await extractPdfText(bufs.r, '判分标准 PDF');
    const aText = bufs.a ? await extractPdfText(bufs.a, '回答 PDF') : input.answerText;
    content = `【1. 题目（PDF 里的文字）】\n<question>\n${qText}\n</question>\n\n【2. 学生的回答${bufs.a ? '（PDF 里的文字）' : '（文字）'}】\n<student_answer>\n${aText}\n</student_answer>\n\n【3. 判分标准（PDF 里的文字）】\n<rubric>\n${rText}\n</rubric>\n\n${tail}`;
  }
  const wantSchema = r.p.json === 'schema';
  const system = wantSchema ? cfg.systemPrompt : cfg.systemPrompt + JSON_ONLY;
  const base = Object.assign({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: content }] }, tokenLimit(r.p, MAX_TOKENS_OPENAI));
  const data = await openaiJson(r, cfg, base, GRADE_SCHEMA, 'grade', cfg.systemPrompt + JSON_ONLY);
  const ch = data.choices[0];
  if ((ch.message && ch.message.refusal) || ch.finish_reason === 'content_filter') throw new AiError('AI_REFUSED', 'AI 拒绝处理这次内容，没有给出评分。请检查文件，或稍后重试。');
  if (ch.finish_reason === 'length') throw new AiError('AI_TRUNCATED', 'AI 的回答被截断了，没有得到评分。请重试。');
  const res = parseGrade(openaiText(data));
  res.model = data.model || cfg.model;
  res.inputTokens = data.usage && data.usage.prompt_tokens;
  res.outputTokens = data.usage && data.usage.completion_tokens;
  return res;
  } finally { if (uploaded.length) await deepseekDelete(r, cfg.apiKey, uploaded); }
}

// 发一次 OpenAI 兼容的请求并要求 JSON：schema 模式（OpenAI）、json_object 模式（DeepSeek）或只靠提示语；
// 模型/服务不支持 response_format 时去掉它重试一次；json_object 模式下返回空内容也重试一次（DeepSeek 文档说明的情形）
async function openaiJson(r, cfg, base, schema, name, textModeSystem) {
  const mode = r.p.json;
  const withFormat = mode === 'schema' ? Object.assign({ response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }, base)
    : mode === 'object' ? Object.assign({ response_format: { type: 'json_object' } }, base) : base;
  const plain = () => Object.assign({}, base, { messages: [{ role: 'system', content: textModeSystem }, base.messages[1]] });
  let data;
  try { data = await openaiCall(r, cfg.apiKey, withFormat); } catch (e) {
    if (mode !== 'prompt' && e && e.httpStatus === 400 && /response_format|json_schema|json_object|structured/i.test(e.apiMessage || '')) data = await openaiCall(r, cfg.apiKey, plain());
    else throw e;
  }
  if (mode === 'object' && !openaiText(data).trim() && data.choices[0].finish_reason === 'stop') data = await openaiCall(r, cfg.apiKey, plain());
  return data;
}

/* ---------- 通用：发一段文字，要求返回一个 JSON 对象（写作板块用） ---------- */
function extractJson(text) {
  let t = String(text || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  try { const o = JSON.parse(t); if (o && typeof o === 'object') return o; } catch (e) { /* 再试 */ }
  const m = /\{[\s\S]*\}/.exec(t);
  if (m) { try { const o = JSON.parse(m[0]); if (o && typeof o === 'object') return o; } catch (e) { /* 放弃 */ } }
  throw new AiError('AI_BAD_RESPONSE', 'AI 的回答格式不对，无法读出结果。请重试。');
}
// cfg: { provider, model, apiKey, baseUrl?, pdfNative? }；返回 { json, model, inputTokens, outputTokens }
async function askJson(cfg, { system, user, schema, maxTokens }) {
  const r = resolve(cfg);
  const textMode = system + '\n\nReply with ONLY one JSON object (no other text) that matches this JSON schema:\n' + JSON.stringify(schema);
  const limit = maxTokens || 6000;
  let text, model, usage;
  if (r.p.kind === 'anthropic') {
    const base = { model: cfg.model, max_tokens: limit, system, messages: [{ role: 'user', content: user }] };
    let data;
    try { data = await anthropicCall(r, cfg.apiKey, Object.assign({ output_config: { format: { type: 'json_schema', schema } } }, base)); } catch (e) {
      if (e && e.httpStatus === 400 && /output_config|structured|json_schema|format/i.test(e.apiMessage || '')) data = await anthropicCall(r, cfg.apiKey, Object.assign({}, base, { system: textMode }));
      else throw e;
    }
    if (data.stop_reason === 'refusal') throw new AiError('AI_REFUSED', 'AI 拒绝处理这次内容。请稍后重试。');
    if (data.stop_reason === 'max_tokens') throw new AiError('AI_TRUNCATED', 'AI 的回答被截断了。请重试。');
    text = anthropicText(data); model = data.model; usage = { i: data.usage && data.usage.input_tokens, o: data.usage && data.usage.output_tokens };
  } else {
    const wantSchema = r.p.json === 'schema';
    const base = Object.assign({ model: cfg.model, messages: [{ role: 'system', content: wantSchema ? system : textMode }, { role: 'user', content: user }] }, tokenLimit(r.p, limit));
    if (r.p.id === 'deepseek') base.thinking = { type: 'disabled' }; // 写作建议要快：不开“思考”
    const data = await openaiJson(r, cfg, base, schema, 'result', textMode);
    const ch = data.choices[0];
    if ((ch.message && ch.message.refusal) || ch.finish_reason === 'content_filter') throw new AiError('AI_REFUSED', 'AI 拒绝处理这次内容。请稍后重试。');
    if (ch.finish_reason === 'length') throw new AiError('AI_TRUNCATED', 'AI 的回答被截断了。请重试。');
    text = openaiText(data); model = data.model; usage = { i: data.usage && data.usage.prompt_tokens, o: data.usage && data.usage.completion_tokens };
  }
  return { json: extractJson(text), model: model || cfg.model, provider: r.p.id, inputTokens: usage.i, outputTokens: usage.o };
}

module.exports = { askJson, AiError, PROVIDERS, GRADE_SCHEMA, validateBaseUrl, resolve, test, grade, extractPdfText };
