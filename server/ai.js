'use strict';
// 调用 Anthropic（Claude）Messages API：判分、连通性测试。
// 只在服务器端调用；API 密钥只在这里使用，不会写进日志、错误信息或返回给页面。
// 为了保持“没有运行时 npm 依赖”，直接用 Node 自带的 fetch 发 HTTPS 请求（官方 SDK 需要额外安装依赖）。
const fs = require('fs');
const config = require('./config');
const files = require('./files');

const API_VERSION = '2026-10-21';
const MAX_TOKENS = 16000; // 包含模型思考用的 token，给足以免被截断
const MAX_TOTAL_BYTES = 24 * 1024 * 1024; // 一次请求里 PDF 的总大小上限（接口整个请求上限是 32MB，base64 会变大约 1/3）

class AiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status || 502; }
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    feedback: { type: 'string' }
  },
  required: ['score', 'feedback'],
  additionalProperties: false
};

// 把接口返回的错误翻成给人看的话（不含密钥）
function explain(status, apiMessage) {
  const detail = apiMessage ? `（${String(apiMessage).slice(0, 300)}）` : '';
  if (status === 401) return new AiError('AI_AUTH_FAILED', `AI 服务拒绝了 API 密钥，请管理员在“AI 评分设置”里检查密钥${detail}`, 502);
  if (status === 403) return new AiError('AI_FORBIDDEN', `这个 API 密钥没有权限使用该模型或功能${detail}`, 502);
  if (status === 404) return new AiError('AI_MODEL_NOT_FOUND', `找不到这个模型，请管理员检查模型名称${detail}`, 502);
  if (status === 413) return new AiError('AI_TOO_LARGE', `提交的文件太大，AI 服务无法处理${detail}`, 413);
  if (status === 429) return new AiError('AI_RATE_LIMITED', `AI 服务繁忙或额度不足，请稍后再试${detail}`, 502);
  if (status === 400) return new AiError('AI_BAD_REQUEST', `AI 服务不接受这次请求${detail}`, 502);
  if (status >= 500) return new AiError('AI_UNAVAILABLE', `AI 服务暂时不可用（${status}），请稍后再试`, 502);
  return new AiError('AI_ERROR', `AI 服务返回了错误（${status}）${detail}`, 502);
}

async function post(apiKey, body) {
  let res;
  try {
    res = await fetch(`${config.aiApiBase}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.aiTimeoutMs)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('AI_TIMEOUT', 'AI 服务响应超时，请稍后再试。', 504);
    throw new AiError('AI_UNREACHABLE', '无法连接 AI 服务，请检查服务器的网络（出站 HTTPS 是否放行）。', 502);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 不是 JSON */ }
  if (!res.ok) throw Object.assign(explain(res.status, data && data.error && data.error.message), { apiMessage: data && data.error && data.error.message, httpStatus: res.status });
  if (!data || !Array.isArray(data.content)) throw new AiError('AI_BAD_RESPONSE', 'AI 服务返回的内容无法识别。');
  return data;
}

function textOf(data) {
  return data.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim();
}

// 连通性测试：很小的一次请求
async function test({ apiKey, model }) {
  const started = Date.now();
  const data = await post(apiKey, {
    model, max_tokens: 1024,
    messages: [{ role: 'user', content: '请只回复一个词：OK' }]
  });
  if (data.stop_reason === 'refusal') throw new AiError('AI_REFUSED', 'AI 拒绝了测试请求。');
  return { latencyMs: Date.now() - started, model: data.model || model, reply: textOf(data).slice(0, 200) };
}

function pdfBlock(file) {
  const buf = fs.readFileSync(files.pathFor(file.stored_name));
  return { buf, block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } };
}

// 解析模型返回的评分 JSON
function parseGrade(text) {
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') throw new AiError('AI_BAD_RESPONSE', 'AI 的回答格式不对，无法读出评分。请重试。');
  const score = obj.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new AiError('AI_BAD_SCORE', 'AI 返回的评分不是 1–5 的整数，已丢弃。请重试。');
  const feedback = typeof obj.feedback === 'string' ? obj.feedback.trim() : '';
  return { score, feedback: feedback.slice(0, 8000) };
}

// 判分：只发送三样东西 —— 题目 PDF、学生回答（文字或 PDF 二选一）、判分标准 PDF
// input: { questionFile, rubricFile, answerText?, answerFile? }（文件是 files 表的行）
async function grade({ apiKey, model, systemPrompt }, input) {
  const hasText = typeof input.answerText === 'string';
  const hasFile = !!input.answerFile;
  if (hasText === hasFile) throw new AiError('AI_BAD_INPUT', '学生回答必须二选一：文字或 PDF。', 422);

  const q = pdfBlock(input.questionFile), r = pdfBlock(input.rubricFile);
  const parts = [
    { type: 'text', text: '【1. 题目（PDF）】' }, q.block,
    { type: 'text', text: '【2. 学生的回答' + (hasFile ? '（PDF）】' : '（文字）】') }
  ];
  let total = q.buf.length + r.buf.length;
  if (hasFile) { const a = pdfBlock(input.answerFile); total += a.buf.length; parts.push(a.block); }
  else parts.push({ type: 'text', text: '<student_answer>\n' + input.answerText + '\n</student_answer>' });
  parts.push({ type: 'text', text: '【3. 判分标准（PDF）】' }, r.block);
  parts.push({ type: 'text', text: '请依据判分标准，给这道题的学生回答打分（1–5 的整数），并给出简明的反馈。' });
  if (total > MAX_TOTAL_BYTES) throw new AiError('AI_TOO_LARGE', 'PDF 文件加起来太大，AI 服务无法处理（总共不能超过约 24MB）。', 413);

  const base = { model, max_tokens: MAX_TOKENS, system: systemPrompt, messages: [{ role: 'user', content: parts }] };
  let data;
  try {
    data = await post(apiKey, Object.assign({ output_config: { format: { type: 'json_schema', schema: GRADE_SCHEMA } } }, base));
  } catch (e) {
    // 个别模型不支持结构化输出：去掉它再试一次，改为从文字里读 JSON
    if (e && e.httpStatus === 400 && /output_config|structured|json_schema|format/i.test(e.apiMessage || '')) {
      data = await post(apiKey, Object.assign({}, base, { system: systemPrompt + '\n\n只输出一个 JSON 对象：{"score": 1-5 的整数, "feedback": "中文反馈"}，不要输出其他内容。' }));
    } else throw e;
  }
  if (data.stop_reason === 'refusal') throw new AiError('AI_REFUSED', 'AI 拒绝处理这次内容，没有给出评分。请检查文件，或稍后重试。');
  if (data.stop_reason === 'max_tokens') throw new AiError('AI_TRUNCATED', 'AI 的回答被截断了，没有得到评分。请重试。');
  const res = parseGrade(textOf(data));
  res.model = data.model || model;
  res.inputTokens = data.usage && data.usage.input_tokens;
  res.outputTokens = data.usage && data.usage.output_tokens;
  return res;
}

module.exports = { AiError, GRADE_SCHEMA, test, grade };
