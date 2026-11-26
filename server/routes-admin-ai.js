'use strict';
// 管理员的 AI 判分设置：模型、API 密钥（加密保存，页面上只显示末 4 位）、判分系统提示语、连通性测试。
const config = require('./config');
const { audit } = require('./db');
const settings = require('./settings');
const ai = require('./ai');
const { httpError, readJson, sendJson } = require('./http');

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,99}$/;
const KEY_RE = /^[\x21-\x7e]{8,500}$/;
const PROMPT_MAX = 20000;
const testTimes = new Map(); // 管理员 -> 最近的测试时间（限流）

function view() {
  const c = settings.getAi();
  return {
    provider: 'anthropic',
    apiBase: config.aiApiBase,
    model: c.model,
    defaultModel: settings.DEFAULT_MODEL,
    suggestedModels: settings.SUGGESTED_MODELS,
    hasKey: !!c.apiKey,
    keyHint: settings.keyHint(c.apiKey),
    systemPrompt: c.systemPrompt,
    isDefaultPrompt: !c.customPrompt,
    defaultSystemPrompt: settings.DEFAULT_SYSTEM_PROMPT,
    updatedAt: c.updatedAt
  };
}

function cleanModel(v) {
  if (typeof v !== 'string' || !MODEL_RE.test(v.trim())) throw httpError(422, 'INVALID_MODEL', '模型名称格式不对（例如 claude-opus-5-5）。');
  return v.trim();
}
function cleanKey(v) {
  if (typeof v !== 'string' || !KEY_RE.test(v.trim())) throw httpError(422, 'INVALID_KEY', 'API 密钥格式不对（不能有空格或中文，至少 8 个字符）。');
  return v.trim();
}

async function save(req, res, ctx) {
  const body = await readJson(req);
  const changed = [];
  const model = 'model' in body ? cleanModel(body.model) : null;
  const key = 'apiKey' in body && body.apiKey !== '' && body.apiKey !== null ? cleanKey(body.apiKey) : null;
  let prompt;
  if ('systemPrompt' in body) {
    if (typeof body.systemPrompt !== 'string') throw httpError(422, 'INVALID_PROMPT', '系统提示语必须是文字。');
    if (body.systemPrompt.length > PROMPT_MAX) throw httpError(422, 'INVALID_PROMPT', `系统提示语不能超过 ${PROMPT_MAX} 个字符。`);
    prompt = body.systemPrompt.trim();
  }
  if (model !== null) { settings.set('ai_model', model, ctx.account.username); changed.push('model'); }
  if (key !== null) { settings.setApiKey(key, ctx.account.username); changed.push('apiKey'); }
  if (body.clearKey === true) { settings.remove('ai_api_key'); changed.push('clearKey'); }
  if (prompt !== undefined) {
    if (prompt === '' || prompt === settings.DEFAULT_SYSTEM_PROMPT) settings.remove('ai_system_prompt'); // 空或与默认相同 = 恢复默认
    else settings.set('ai_system_prompt', prompt, ctx.account.username);
    changed.push('systemPrompt');
  }
  if (!changed.length) throw httpError(400, 'NOTHING_TO_UPDATE', '没有要修改的内容。');
  audit(ctx.account.username, 'update_ai_settings', null, changed.join(',')); // 只记录改了哪几项，不记录内容
  sendJson(res, 200, view());
}

// 连通性测试：用页面上填的模型/密钥（没填密钥就用已保存的）发一个很小的请求
async function testConnection(req, res, ctx) {
  const body = await readJson(req);
  const last = testTimes.get(ctx.account.id) || 0;
  if (Date.now() - last < config.aiTestMinIntervalMs) throw httpError(429, 'TOO_FAST', '请稍等几秒再测试。');
  testTimes.set(ctx.account.id, Date.now());
  const saved = settings.getAi();
  const model = 'model' in body && body.model ? cleanModel(body.model) : saved.model;
  const apiKey = 'apiKey' in body && body.apiKey ? cleanKey(body.apiKey) : saved.apiKey;
  if (!apiKey) throw httpError(422, 'NO_KEY', '还没有 API 密钥：请先填写密钥再测试。');
  try {
    const r = await ai.test({ apiKey, model });
    audit(ctx.account.username, 'test_ai', null, 'ok ' + r.model);
    sendJson(res, 200, { ok: true, latencyMs: r.latencyMs, model: r.model, reply: r.reply, usedSavedKey: !(body.apiKey) });
  } catch (e) {
    const code = e && e.code ? e.code : 'AI_ERROR';
    audit(ctx.account.username, 'test_ai', null, 'failed ' + code);
    sendJson(res, 200, { ok: false, code, message: e instanceof ai.AiError ? e.message : '测试失败，请稍后再试。' });
  }
}

module.exports = async function adminAiApi(req, res, pathname, ctx) {
  if (pathname === '/api/admin/ai' && req.method === 'GET') return sendJson(res, 200, view());
  if (pathname === '/api/admin/ai' && req.method === 'PUT') return save(req, res, ctx);
  if (pathname === '/api/admin/ai/test' && req.method === 'POST') return testConnection(req, res, ctx);
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
