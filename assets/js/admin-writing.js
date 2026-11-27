/* 后台：写作设置（建议提示语、各年级的写作期望、AI 用量）。 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = null;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        if (res.status === 401) window.location.href = "/login";
        throw new Error(data.message || "操作失败，请稍后再试。");
      });
    }, function () { throw new Error("网络出错，请稍后再试。"); });
  }
  function show(text, kind) { var m = $("w-save-msg"); m.textContent = text || ""; m.className = "msg" + (kind ? " " + kind : ""); m.hidden = !text; }

  function render(d) {
    state = d;
    $("w-prompt").value = d.prompt;
    $("w-prompt-hint").textContent = d.isDefaultPrompt ? "当前使用的是默认提示语。" : "当前使用的是自定义提示语。";
    var host = $("w-standards");
    clear(host);
    d.standards.forEach(function (s) {
      var f = el("div", "field");
      var l = el("label", "", s.label.zh + (s.isDefault ? "" : "（已自定义）"));
      l.htmlFor = "std-" + s.code;
      var t = el("textarea");
      t.id = "std-" + s.code;
      t.rows = 3;
      t.maxLength = 1000;
      t.value = s.text;
      t.setAttribute("data-code", s.code);
      f.appendChild(l);
      f.appendChild(t);
      host.appendChild(f);
    });
    var u = d.usage;
    $("u-summary").textContent = "最近 " + u.days + " 天：" + u.sessions + " 篇作文，" + u.rounds + " 次调用，输入 " + u.inputTokens + " token，输出 " + u.outputTokens + " token；AI 标记的安全内容 " + u.flaggedRounds + " 次（其中未查看 " + u.unreviewedFlags + " 条）；失败 " + u.failedCalls + " 次。";
    var body = $("u-students");
    clear(body);
    if (!u.byStudent.length) { var tr = el("tr"); var td = el("td", "empty", "最近 30 天还没有调用。"); td.colSpan = 4; tr.appendChild(td); body.appendChild(tr); }
    u.byStudent.forEach(function (r) {
      var tr = el("tr");
      [r.username, String(r.rounds), String(r.inputTokens), String(r.outputTokens)].forEach(function (v, i) { tr.appendChild(el("td", i === 0 ? "name" : "", v)); });
      body.appendChild(tr);
    });
  }

  $("w-prompt-reset").addEventListener("click", function () {
    if (state) $("w-prompt").value = state.defaultPrompt;
    show("已把默认提示语填入编辑框，点“保存设置”后生效。", "");
  });

  $("writing-form").addEventListener("submit", function (e) {
    e.preventDefault();
    show("");
    var standards = {};
    document.querySelectorAll("#w-standards textarea").forEach(function (t) { standards[t.getAttribute("data-code")] = t.value; });
    $("w-save").disabled = true;
    api("PUT", "/api/admin/writing", { prompt: $("w-prompt").value, standards: standards }).then(function (d) {
      render(d);
      show("已保存。", "ok");
    }).catch(function (err) { show(err.message, "error"); })
      .then(function () { $("w-save").disabled = false; });
  });

  api("GET", "/api/me").then(function (me) { $("whoami").textContent = "当前管理员：" + me.username + "（" + me.tzLabel.zh.replace("，", "，时区：") + "）"; }).catch(function () { /* 忽略 */ });
  api("GET", "/api/admin/writing").then(render).catch(function (err) { show(err.message, "error"); });
})();
