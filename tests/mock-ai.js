// 测试用的“假 Anthropic 服务”：模拟 POST /v1/messages，并记录收到的请求供测试检查。只用于测试，不联网。
const http = require("http");
const PORT = Number(process.env.MOCK_AI_PORT || 8766);
const VALID_KEYS = new Set(["sk-ant-test-valid-key-0001", "sk-ant-test-valid-key-0002"]);
let requests = [];

function summarize(req, body) {
  const blocks = [];
  const msgs = (body && body.messages) || [];
  for (const m of msgs) {
    if (typeof m.content === "string") blocks.push({ type: "text", text: m.content });
    else for (const b of m.content || []) {
      if (b.type === "text") blocks.push({ type: "text", text: b.text });
      else if (b.type === "document") {
        const raw = Buffer.from((b.source && b.source.data) || "", "base64");
        blocks.push({ type: "document", media_type: b.source && b.source.media_type, bytes: raw.length, head: raw.subarray(0, 5).toString("latin1"), text: raw.toString("latin1").slice(0, 200) });
      } else blocks.push({ type: b.type });
    }
  }
  return {
    path: req.url, key: req.headers["x-api-key"], version: req.headers["anthropic-version"],
    model: body && body.model, system: body && body.system, max_tokens: body && body.max_tokens,
    hasOutputConfig: !!(body && body.output_config), outputConfig: body && body.output_config,
    hasTemperature: !!(body && ("temperature" in body || "top_p" in body || "top_k" in body)),
    hasThinkingDisabled: !!(body && body.thinking && body.thinking.type === "disabled"),
    blocks, raw: JSON.stringify(body || {}).length
  };
}

function reply(res, status, obj, delay) {
  setTimeout(() => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }, delay || 0);
}
const err = (type, message) => ({ type: "error", error: { type, message } });

http.createServer((req, res) => {
  if (req.url === "/__health") return reply(res, 200, { ok: true });
  if (req.url === "/__requests" && req.method === "GET") return reply(res, 200, requests);
  if (req.url === "/__reset" && req.method === "POST") { requests = []; return reply(res, 200, { ok: true }); }
  if (req.url !== "/v1/messages" || req.method !== "POST") return reply(res, 404, err("not_found_error", "not found"));
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return reply(res, 400, err("invalid_request_error", "bad json")); }
    const sum = summarize(req, body);
    requests.push(sum);
    if (requests.length > 400) requests = requests.slice(-200);
    if (!VALID_KEYS.has(req.headers["x-api-key"])) return reply(res, 401, err("authentication_error", "invalid x-api-key"));
    if (body.model === "no-such-model") return reply(res, 404, err("not_found_error", "model: no-such-model"));
    if (body.model === "model-no-structured" && body.output_config) return reply(res, 400, err("invalid_request_error", "output_config.format is not supported for this model"));

    const allText = sum.blocks.map((b) => b.text || "").join("\n");
    if (/请只回复一个词/.test(allText)) return reply(res, 200, { id: "msg_test", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } });

    const marker = (name) => allText.includes(name);
    if (marker("HTTP429")) return reply(res, 429, err("rate_limit_error", "rate limited"));
    if (marker("HTTP500")) return reply(res, 500, err("api_error", "internal"));
    const delay = marker("SLOW") ? 1500 : 0;
    const base = { id: "msg_test", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 300 } };
    if (marker("REFUSE")) return reply(res, 200, Object.assign(base, { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } }), delay);
    if (marker("TRUNC")) return reply(res, 200, Object.assign(base, { content: [{ type: "text", text: '{"score": 4, "feedb' }], stop_reason: "max_tokens" }), delay);
    if (marker("MALFORMED")) return reply(res, 200, Object.assign(base, { content: [{ type: "text", text: "我觉得大概是 4 分" }] }), delay);
    if (marker("BADSCORE")) return reply(res, 200, Object.assign(base, { content: [{ type: "text", text: JSON.stringify({ score: 9, feedback: "太高了" }) }] }), delay);
    const m = /SCORE=([1-5])/.exec(allText);
    const score = m ? Number(m[1]) : 3;
    const fenced = marker("FENCED"); // 模型把 JSON 包在 ``` 里的情况
    const text = JSON.stringify({ score, feedback: `得分点：要点齐全。失分点：略。（模拟反馈，评分 ${score}）` });
    return reply(res, 200, Object.assign(base, { content: [{ type: "text", text: fenced ? "```json\n" + text + "\n```" : text }] }), delay);
  });
}).listen(PORT, "127.0.0.1", () => console.log("mock AI on " + PORT));
