/* 后台：AI 评分设置。API 密钥只能写入，页面上永远不会显示已保存的密钥（只显示末 4 位）。 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = null;

  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        if (res.status === 401) window.location.href = "/login";
        var err = new Error(data.message || "操作失败，请稍后再试。");
        err.code = data.error;
        throw err;
      });
    }, function () { throw new Error("网络出错，请稍后再试。"); });
  }
  function show(id, text, kind) {
    var m = $(id);
    m.textContent = text || "";
    m.className = "msg" + (kind ? " " + kind : "");
    m.hidden = !text;
  }

  function cur() {
    var id = $("ai-provider").value;
    return state.providers.filter(function (p) { return p.id === id; })[0];
  }
  function fillProvider() {
    var p = cur();
    $("ai-model").value = p.model;
    var dl = $("model-list");
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    p.suggestedModels.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.id;
      o.label = m.note;
      dl.appendChild(o);
    });
    $("base-field").hidden = !p.custom;
    $("pdf-field").hidden = p.pdfMode !== "configurable";
    $("ai-base").value = p.baseUrl || "";
    $("ai-pdf-native").checked = !!p.pdfNative;
    $("provider-hint").textContent = (p.custom ? "数据将发往你填写的接口地址。" : "数据将发往 " + p.host + "。") + (state.provider === p.id ? "（当前使用的服务商）" : "（保存后将改用它判分）");
    $("pdf-note").textContent = p.pdfNative
      ? "PDF 处理：这个模型能直接读取 PDF，系统会把 PDF 原样发给它。"
      : "PDF 处理：这个模型只能读文字，系统会先在服务器上提取 PDF 里的文字再发给它；扫描图片的 PDF 提取不出文字，会提示失败（可改用 Claude 或 GPT，或提供含文字的 PDF）。";
    $("ai-key").value = "";
    $("ai-key").placeholder = p.hasKey ? "已保存（" + p.keyHint + "）；不修改请留空" : "粘贴 API 密钥";
    $("key-hint").textContent = p.hasKey
      ? "已保存一个密钥（末 4 位 " + p.keyHint + "），加密存放在服务器上，页面不会再显示它。要更换就在这里填新的，不修改请留空。"
      : "还没有保存密钥。密钥加密后存放在服务器上，保存后页面不会再显示它。";
    $("clear-key-btn").hidden = !p.hasKey;
  }
  function render(data) {
    state = data;
    var sel = $("ai-provider");
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    data.providers.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.label;
      sel.appendChild(o);
    });
    sel.value = data.provider;
    fillProvider();
    $("ai-prompt").value = data.systemPrompt;
    $("prompt-hint").textContent = (data.isDefaultPrompt ? "当前使用的是默认提示语。" : "当前使用的是自定义提示语。") + " 每次判分都会带上这段提示语。AI 的输出格式（评分 1–5 的整数 + 反馈）由系统固定，不需要在这里写格式要求。";
  }
  $("ai-provider").addEventListener("change", function () { show("test-result", ""); fillProvider(); });
  $("ai-pdf-native").addEventListener("change", function () {
    $("pdf-note").textContent = $("ai-pdf-native").checked ? "PDF 处理：系统会把 PDF 原样发给模型。" : "PDF 处理：系统会先提取 PDF 里的文字再发给模型；扫描图片的 PDF 会提示失败。";
  });

  function providerBody() {
    var p = cur();
    var body = { provider: p.id, model: $("ai-model").value.trim() };
    var key = $("ai-key").value.trim();
    if (key) body.apiKey = key;
    if (p.custom) body.baseUrl = $("ai-base").value.trim();
    return body;
  }

  $("ai-form").addEventListener("submit", function (e) {
    e.preventDefault();
    show("save-msg", "");
    var body = providerBody();
    body.systemPrompt = $("ai-prompt").value;
    if (cur().pdfMode === "configurable") body.pdfNative = $("ai-pdf-native").checked;
    if (!body.model) return show("save-msg", "请填写模型名称。", "error");
    $("save-btn").disabled = true;
    api("PUT", "/api/admin/ai", body).then(function (data) {
      render(data);
      show("save-msg", "已保存。", "ok");
    }).catch(function (err) { show("save-msg", err.message, "error"); })
      .then(function () { $("save-btn").disabled = false; });
  });

  $("test-btn").addEventListener("click", function () {
    show("test-result", "");
    var body = providerBody();
    $("test-btn").disabled = true;
    show("test-result", "正在测试…（最多等几十秒）", "");
    api("POST", "/api/admin/ai/test", body).then(function (r) {
      if (r.ok) show("test-result", "连通成功：模型 " + r.model + "，用时 " + (r.latencyMs / 1000).toFixed(1) + " 秒，AI 回复：“" + r.reply + "”。" + (r.usedSavedKey ? "（使用的是已保存的密钥）" : "（使用的是你刚填的密钥，还没有保存）"), "ok");
      else show("test-result", "连通失败：" + r.message, "error");
    }).catch(function (err) { show("test-result", "连通失败：" + err.message, "error"); })
      .then(function () { $("test-btn").disabled = false; });
  });

  $("clear-key-btn").addEventListener("click", function () {
    if (!window.confirm("删除“" + cur().label + "”已保存的 API 密钥？删除后 AI 评分将不可用，直到重新填写。")) return;
    api("PUT", "/api/admin/ai", { provider: cur().id, clearKey: true }).then(function (data) { render(data); show("save-msg", "已删除保存的密钥。", "ok"); })
      .catch(function (err) { show("save-msg", err.message, "error"); });
  });

  $("reset-prompt-btn").addEventListener("click", function () {
    if (state) $("ai-prompt").value = state.defaultSystemPrompt;
    show("save-msg", "已把默认提示语填入编辑框，点“保存设置”后生效。", "");
  });

  api("GET", "/api/me").then(function (me) { $("whoami").textContent = "当前管理员：" + me.username + "（" + me.tzLabel.zh.replace("，", "，时区：") + "）"; }).catch(function () { /* 忽略 */ });
  api("GET", "/api/admin/ai").then(render).catch(function (err) { show("save-msg", err.message, "error"); });
})();
