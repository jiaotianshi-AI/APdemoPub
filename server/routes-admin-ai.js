'use strict';
// 管理员的 AI 判分设置：选择服务商（Claude / GPT / DeepSeek / 自定义）、各服务商的模型和 API 密钥（加密保存，页面上只显示末 4 位）、判分系统提示语、连通性测试。
const config = require('./config');
const { audit } = require('./db');
const settings = require('./settings');
const ai = require('./ai');
const { httpError, readJson, sendJson } = require('./http');

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,99}$/;
const KEY_RE = /^[\x21-\x7e]{8,500}$/;
const PROMPT_MAX = 20000;
const testTimes = new Map(); // 管理员 -> 最近的测试时间（限流）

function providerView(id) {
  const def = ai.PROVIDERS[id];
  const c = settings.getProvider(id);
  const base = id === 'custom' ? c.baseUrl : config.aiBases[id];
  let host = '';
  try { host = base ? new URL(base).host : ''; } catch (e) { host = ''; }
  return {
    id, label: def.label, custom: !!def.custom,
    pdfMode: def.pdf, // native 能直接读 PDF；files 按模型（DeepSeek：deepseek-flash 走文件接口读 PDF，其他模型提取文字）；text 先提取文字；configurable 由管理员勾选
    nativePattern: def.pdf === 'files' ? def.filesModelPattern : null,
    pdfNative: def.pdf === 'native' ? true : def.pdf === 'files' ? new RegExp(def.filesModelPattern).test(c.model || def.defaultModel) : def.pdf === 'configurable' ? c.pdfNative : false,
    defaultModel: def.defaultModel, suggestedModels: def.models,
    model: c.model || def.defaultModel,
    hasKey: !!c.apiKey, keyHint: settings.keyHint(c.apiKey),
    baseUrl: def.custom ? c.baseUrl : '', host
  };
}

function view() {
  const p = settings.getPrompt();
  return {
    provider: settings.activeProvider(),
    providers: settings.PROVIDER_IDS.map(providerView),
    systemPrompt: p.systemPrompt, isDefaultPrompt: !p.customPrompt,
    defaultSystemPrompt: settings.DEFAULT_SYSTEM_PROMPT,
    updatedAt: settings.lastUpdated()
  };
}

function cleanProvider(v) {
  if (typeof v !== 'string' || !settings.PROVIDER_IDS.includes(v)) throw httpError(422, 'INVALID_PROVIDER', '不支持这个 AI 服务商。');
  return v;
}
function cleanModel(v) {
  if (typeof v !== 'string' || !MODEL_RE.test(v.trim())) throw httpError(422, 'INVALID_MODEL', '模型名称格式不对（例如 claude-opus-5-5、gpt-4.1、deepseek-chat）。');
  return v.trim();
}
function cleanKey(v) {
  if (typeof v !== 'string' || !KEY_RE.test(v.trim())) throw httpError(422, 'INVALID_KEY', 'API 密钥格式不对（不能有空格或中文，至少 8 个字符）。');
  return v.trim();
}
function cleanBase(v) {
  try { return ai.validateBaseUrl(v); } catch (e) { throw httpError(422, 'INVALID_BASE_URL', e.message); }
}

async function save(req, res, ctx) {
  const body = await readJson(req);
  const by = ctx.account.username;
  const changed = [];
  const hasProviderFields = ['model', 'apiKey', 'clearKey', 'baseUrl', 'pdfNative'].some((k) => k in body);
  if (hasProviderFields || 'provider' in body) {
    const p = cleanProvider('provider' in body ? body.provider : settings.activeProvider());
    const model = 'model' in body ? cleanModel(body.model) : null;
    const key = 'apiKey' in body && body.apiKey !== '' && body.apiKey !== null ? cleanKey(body.apiKey) : null;
    const base = ai.PROVIDERS[p].custom && 'baseUrl' in body ? cleanBase(body.baseUrl) : null;
    if (model !== null) { settings.setProviderModel(p, model, by); changed.push('model'); }
    if (key !== null) { settings.setProviderKey(p, key, by); changed.push('apiKey'); }
    if (body.clearKey === true) { settings.clearProviderKey(p); changed.push('clearKey'); }
    if (base !== null) { settings.setProviderBase(p, base, by); changed.push('baseUrl'); }
    if (ai.PROVIDERS[p].pdf === 'configurable' && typeof body.pdfNative === 'boolean') { settings.setProviderPdfNative(p, body.pdfNative, by); changed.push('pdfNative'); }
    if (settings.activeProvider() !== p) { settings.setActiveProvider(p, by); changed.push('provider:' + p); }
  }
  if ('systemPrompt' in body) {
    if (typeof body.systemPrompt !== 'string') throw httpError(422, 'INVALID_PROMPT', '系统提示语必须是文字。');
    if (body.systemPrompt.length > PROMPT_MAX) throw httpError(422, 'INVALID_PROMPT', `系统提示语不能超过 ${PROMPT_MAX} 个字符。`);
    const prompt = body.systemPrompt.trim();
    if (prompt === '' || prompt === settings.DEFAULT_SYSTEM_PROMPT) settings.remove('ai_system_prompt'); // 空或与默认相同 = 恢复默认
    else settings.set('ai_system_prompt', prompt, by);
    changed.push('systemPrompt');
  }
  if (!changed.length) throw httpError(400, 'NOTHING_TO_UPDATE', '没有要修改的内容。');
  audit(by, 'update_ai_settings', null, changed.join(',')); // 只记录改了哪几项，不记录内容
  sendJson(res, 200, view());
}

// 连通性测试：用页面上填的内容（没填密钥就用该服务商已保存的）发一个很小的请求
async function testConnection(req, res, ctx) {
  const body = await readJson(req);
  const last = testTimes.get(ctx.account.id) || 0;
  if (Date.now() - last < config.aiTestMinIntervalMs) throw httpError(429, 'TOO_FAST', '请稍等几秒再测试。');
  testTimes.set(ctx.account.id, Date.now());
  const provider = cleanProvider('provider' in body ? body.provider : settings.activeProvider());
  const def = ai.PROVIDERS[provider];
  const saved = settings.getProvider(provider);
  const model = body.model ? cleanModel(body.model) : (saved.model || def.defaultModel);
  const apiKey = body.apiKey ? cleanKey(body.apiKey) : saved.apiKey;
  const baseUrl = def.custom ? (body.baseUrl ? cleanBase(body.baseUrl) : saved.baseUrl) : '';
  if (!apiKey) throw httpError(422, 'NO_KEY', '还没有 API 密钥：请先填写密钥再测试。');
  if (!model) throw httpError(422, 'INVALID_MODEL', '请先填写模型名称。');
  if (def.custom && !baseUrl) throw httpError(422, 'INVALID_BASE_URL', '请先填写接口地址。');
  try {
    const r = await ai.test({ provider, apiKey, model, baseUrl });
    audit(ctx.account.username, 'test_ai', null, `ok ${provider} ${r.model}`);
    sendJson(res, 200, { ok: true, provider, latencyMs: r.latencyMs, model: r.model, reply: r.reply, usedSavedKey: !body.apiKey });
  } catch (e) {
    const code = e && e.code ? e.code : 'AI_ERROR';
    audit(ctx.account.username, 'test_ai', null, `failed ${provider} ${code}`);
    sendJson(res, 200, { ok: false, provider, code, message: e instanceof ai.AiError ? e.message : '测试失败，请稍后再试。' });
  }
}

module.exports = async function adminAiApi(req, res, pathname, ctx) {
  if (pathname === '/api/admin/ai' && req.method === 'GET') return sendJson(res, 200, view());
  if (pathname === '/api/admin/ai' && req.method === 'PUT') return save(req, res, ctx);
  if (pathname === '/api/admin/ai/test' && req.method === 'POST') return testConnection(req, res, ctx);
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
