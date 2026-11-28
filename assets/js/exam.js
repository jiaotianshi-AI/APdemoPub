/* 测试页：开始前选择作答方式 → 倒计时作答（题目 PDF + 答题区，自动保存）→ 提交 / 到时自动提交 → 回顾。
 * 页面只和本站通信；所有来自服务器的文字都用 textContent 显示。 */
(function () {
  "use strict";
  var i18n = window.APi18n;
  var t = i18n.t;

  var params = new URLSearchParams(window.location.search);
  var id = Number(params.get("id"));
  var earlyParam = params.get("early") === "1";

  var root = document.getElementById("exam-root");
  var timerBox = document.getElementById("timer");
  var timerValue = document.getElementById("timer-value");

  var detail = null;
  var offset = 0; // 服务器时间 - 本机时间（毫秒）
  var qIndex = 0;
  var answers = {};
  var dirty = {};
  var saveState = "saved";
  var timerId = null;
  var forceEarlyConfirm = false;
  var finishing = false;
  var pendingSaves = {};
  var expectPdfAt = 0;
  var tracking = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function nowMs() { return Date.now() + offset; }

  /* ---------- 请求 ---------- */
  function api(method, path, body, keepalive) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "apdemo" }, cache: "no-store" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    if (keepalive) opts.keepalive = true;
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        if (res.status === 401) window.location.href = "/login";
        var err = new Error(data.error || "ERROR");
        err.code = data.error || "ERROR";
        err.data = data;
        throw err;
      });
    }, function () { var e = new Error("NETWORK"); e.code = "NETWORK"; throw e; });
  }
  function errorText(err) {
    var key = "exam.err." + (err && err.code);
    var s = t(key);
    return s === key ? t("exam.err.default") : s;
  }
  function showError(message) {
    var box = root.querySelector(".error-box");
    if (!box) { box = el("p", "error-box"); box.setAttribute("role", "alert"); root.insertBefore(box, root.firstChild); }
    box.textContent = message;
  }

  /* ---------- 工具 ---------- */
  function fmtDate(d) { var p = d.split("-"); return i18n.getLang() === "zh" ? p[0] + "年" + Number(p[1]) + "月" + Number(p[2]) + "日" : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p[1]) - 1] + " " + Number(p[2]) + ", " + p[0]; }
  function fmtWall(wall) {
    var h = Number(wall.slice(11, 13)), h12 = h % 12 === 0 ? 12 : h % 12;
    var clock = h12 + ":" + wall.slice(14, 16) + " " + (h < 12 ? "AM" : "PM");
    return i18n.getLang() === "zh" ? fmtDate(wall.slice(0, 10)) + " " + clock : fmtDate(wall.slice(0, 10)) + ", " + clock;
  }
  function leftText(ms) {
    var mins = Math.max(1, Math.floor(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d >= 1) return t("tests.left.dh", { d: d, h: h });
    if (h >= 1) return t("tests.left.hm", { h: h, m: m });
    return t("tests.left.m", { m: m });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s % 60);
  }
  function homeLink(cls) {
    var a = el("a", "btn" + (cls ? " " + cls : ""), t("exam.home"));
    a.href = "/apdemo";
    return a;
  }
  function title(a) { return a.subject + " · " + a.unit; }

  /* ---------- 加载 ---------- */
  function adopt(data) {
    detail = data;
    offset = Date.parse(data.serverNow) - Date.now();
    var qs = data.questions || [];
    if (qIndex >= qs.length) qIndex = 0;
    if (data.answers) Object.keys(data.answers).forEach(function (k) { if (!dirty[k]) answers[k] = data.answers[k]; });
  }
  function load() {
    return api("GET", "/api/student/assessments/" + id).then(function (data) { adopt(data); render(); })
      .catch(function (e) {
        clear(root);
        root.appendChild(el("p", "error-box", errorText(e)));
        root.appendChild(el("div", "actions")).appendChild(homeLink());
      });
  }

  /* ---------- 渲染入口 ---------- */
  function render() {
    document.title = t("exam.title");
    stopTimer();
    setTracking(false);
    clear(root);
    timerBox.hidden = true;
    var st = detail.assessment.status;
    if (st === "scheduled") renderPre();
    else if (st === "in_progress") renderRun();
    else renderDone();
  }

  /* ---------- 开始之前 ---------- */
  function renderPre() {
    var a = detail.assessment;
    var early = nowMs() < Date.parse(a.scheduledAt);
    var needConfirm = (early && !earlyParam) || forceEarlyConfirm;

    root.appendChild(el("h1", "", t("exam.pre.heading")));
    root.appendChild(el("p", "sub", title(a) + "　" + fmtWall(a.scheduledWall)));
    var panel = el("div", "panel");
    panel.appendChild(el("p", "", t("exam.pre.duration", { m: a.durationMinutes })));
    panel.appendChild(el("p", "rules", t("exam.pre.rules")));
    if (early) panel.appendChild(el("p", "notice", t("exam.pre.early", { left: leftText(Date.parse(a.scheduledAt) - nowMs()) })));

    var confirmCb = null;
    if (needConfirm) {
      var lab = el("label", "confirm-early");
      confirmCb = el("input");
      confirmCb.type = "checkbox";
      lab.appendChild(confirmCb);
      lab.appendChild(el("span", "", t("exam.pre.earlyConfirm")));
      panel.appendChild(lab);
    }

    var fs = el("fieldset", "methods");
    fs.appendChild(el("legend", "", t("exam.method.title")));
    [["typed", "exam.method.typed", "exam.method.typed.hint"], ["paper", "exam.method.paper", "exam.method.paper.hint"]].forEach(function (m) {
      var l = el("label", "method");
      var r = el("input");
      r.type = "radio";
      r.name = "method";
      r.value = m[0];
      var box = el("span");
      box.appendChild(el("span", "m-title", t(m[1])));
      box.appendChild(el("span", "m-hint", t(m[2])));
      l.appendChild(r);
      l.appendChild(box);
      fs.appendChild(l);
      r.addEventListener("change", sync);
    });
    panel.appendChild(fs);

    var actions = el("div", "actions");
    var startBtn = el("button", "btn primary", t("exam.start"));
    startBtn.type = "button";
    startBtn.disabled = true;
    actions.appendChild(startBtn);
    actions.appendChild(homeLink());
    panel.appendChild(actions);
    root.appendChild(panel);

    function chosen() { var c = fs.querySelector("input:checked"); return c ? c.value : null; }
    function sync() { startBtn.disabled = !chosen() || (confirmCb && !confirmCb.checked); }
    if (confirmCb) confirmCb.addEventListener("change", sync);

    startBtn.addEventListener("click", function () {
      startBtn.disabled = true;
      api("POST", "/api/student/assessments/" + id + "/start", { method: chosen(), confirmEarly: early || forceEarlyConfirm })
        .then(function (data) { adopt(data); qIndex = 0; render(); })
        .catch(function (e) {
          if (e.code === "EARLY_NOT_CONFIRMED") { forceEarlyConfirm = true; render(); return; }
          showError(errorText(e));
          sync();
        });
    });
    var first = fs.querySelector("input");
    if (first) first.focus();
  }

  /* ---------- 作答 ---------- */
  function questions() { return detail.questions || []; }
  function isTyped() { return detail.attempt && detail.attempt.method === "typed"; }

  function markSaveState(state) {
    saveState = state;
    var s = root.querySelector(".save-state");
    if (!s) return;
    s.textContent = state === "saving" ? t("exam.saving") : state === "bad" ? t("exam.saveFailed") : t("exam.saved");
    s.className = "save-state" + (state === "bad" ? " bad" : "");
  }

  function saveOne(fid) {
    if (!dirty[fid]) return Promise.resolve();
    var text = answers[fid] || "";
    markSaveState("saving");
    return api("PUT", "/api/student/assessments/" + id + "/answers/" + fid, { text: text }).then(function () {
      if ((answers[fid] || "") === text) delete dirty[fid];
      if (!Object.keys(dirty).length) markSaveState("saved");
    }).catch(function (e) {
      if (e.code === "TEST_ENDED" || e.code === "NOT_STARTABLE") { finishing = false; load(); return; }
      markSaveState("bad");
      clearTimeout(pendingSaves["retry" + fid]);
      pendingSaves["retry" + fid] = setTimeout(function () { saveOne(fid); }, 5000); // 网络不好时自动重试
    });
  }
  function scheduleSave(fid) {
    dirty[fid] = true;
    markSaveState("saving");
    clearTimeout(pendingSaves[fid]);
    pendingSaves[fid] = setTimeout(function () { saveOne(fid); }, 800);
  }
  function flushAll() {
    return Promise.all(Object.keys(dirty).map(function (fid) { clearTimeout(pendingSaves[fid]); return saveOne(fid); }));
  }

  function renderRun() {
    var a = detail.assessment, qs = questions(), q = qs[qIndex];
    var typed = isTyped();
    timerBox.hidden = false;
    startTimer();
    setTracking(true);

    var head = el("div", "run-head");
    var left = el("div");
    left.appendChild(el("h1", "", title(a)));
    left.appendChild(el("p", "sub", t("exam.q", { n: qIndex + 1, total: qs.length }) + "　·　" + t(typed ? "exam.method.typedShort" : "exam.method.paperShort")));
    head.appendChild(left);
    root.appendChild(head);

    var grid = el("div", "run-grid");
    // 题目
    var box = el("div", "pdf-box");
    var frame = el("iframe", "pdf-frame");
    frame.src = "/api/student/files/" + q.id;
    frame.title = t("exam.pdf.title", { n: qIndex + 1 });
    box.appendChild(frame);
    var foot = el("div", "pdf-foot");
    foot.appendChild(el("div", "", t("exam.pdf.fallback")));
    var open = el("a", "", t("exam.openPdf"));
    open.href = "/api/student/files/" + q.id;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.addEventListener("click", function () { expectPdfAt = Date.now(); }); // 为看题目而离开页面，单独统计
    foot.appendChild(open);
    box.appendChild(foot);
    grid.appendChild(box);

    // 答题区
    var side = el("div", "answer-box");
    if (typed) {
      var lab = el("label", "", t("exam.answer.label") + "（" + t("exam.q", { n: qIndex + 1, total: qs.length }) + "）");
      lab.htmlFor = "answer";
      var ta = el("textarea");
      ta.id = "answer";
      ta.value = answers[q.id] || "";
      ta.setAttribute("autocomplete", "off");
      ta.setAttribute("autocapitalize", "sentences");
      ta.addEventListener("input", function () { answers[q.id] = ta.value; scheduleSave(q.id); updateNums(); });
      side.appendChild(lab);
      side.appendChild(ta);
      side.appendChild(el("p", "save-state", t("exam.saved")));
    } else {
      side.appendChild(el("p", "notice", t("exam.paper.note")));
    }
    grid.appendChild(side);
    root.appendChild(grid);

    // 题号与前后切换
    var nav = el("div", "nav");
    var prev = el("button", "btn", t("exam.prev"));
    prev.type = "button";
    prev.disabled = qIndex === 0;
    prev.addEventListener("click", function () { goto(qIndex - 1); });
    nav.appendChild(prev);
    var nums = el("div", "q-nums");
    nums.setAttribute("role", "group");
    nums.setAttribute("aria-label", t("exam.q", { n: qIndex + 1, total: qs.length }));
    qs.forEach(function (qq, i) {
      var b = el("button", "q-num", String(i + 1));
      b.type = "button";
      b.setAttribute("aria-label", t("exam.goto", { n: i + 1 }));
      b.setAttribute("aria-current", i === qIndex ? "true" : "false");
      b.setAttribute("data-fid", String(qq.id));
      b.addEventListener("click", function () { goto(i); });
      nums.appendChild(b);
    });
    nav.appendChild(nums);
    var next = el("button", "btn", t("exam.next"));
    next.type = "button";
    next.disabled = qIndex === qs.length - 1;
    next.addEventListener("click", function () { goto(qIndex + 1); });
    nav.appendChild(next);
    root.appendChild(nav);
    updateNums();

    var row = el("div", "submit-row");
    var sub = el("button", "btn primary", t("exam.submit"));
    sub.type = "button";
    sub.id = "submit-btn";
    sub.addEventListener("click", onSubmit);
    row.appendChild(sub);
    root.appendChild(row);
    markSaveState(saveState);
    if (typed) { var area = document.getElementById("answer"); if (area) area.focus(); }
  }

  function updateNums() {
    if (!isTyped()) return;
    root.querySelectorAll(".q-num").forEach(function (b) {
      var has = (answers[b.getAttribute("data-fid")] || "").trim() !== "";
      b.classList.toggle("answered", has);
    });
  }

  function goto(i) {
    if (i < 0 || i >= questions().length) return;
    flushAll().then(function () { qIndex = i; render(); });
  }

  /* ---------- 确认框 ---------- */
  function confirmBox(message) {
    return new Promise(function (resolve) {
      var d = el("dialog", "exam-dialog");
      d.setAttribute("aria-label", message);
      d.appendChild(el("p", "", message));
      var actions = el("div", "actions");
      var no = el("button", "btn", t("common.cancel"));
      no.type = "button";
      var yes = el("button", "btn primary", t("common.confirm"));
      yes.type = "button";
      actions.appendChild(no);
      actions.appendChild(yes);
      d.appendChild(actions);
      document.body.appendChild(d);
      function done(v) { try { d.close(); } catch (e) { /* ignore */ } d.remove(); resolve(v); }
      no.addEventListener("click", function () { done(false); });
      yes.addEventListener("click", function () { done(true); });
      d.addEventListener("cancel", function (e) { e.preventDefault(); done(false); });
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
      yes.focus();
    });
  }

  function unanswered() {
    if (!isTyped()) return 0;
    return questions().filter(function (q) { return (answers[q.id] || "").trim() === ""; }).length;
  }

  function onSubmit() {
    var btn = document.getElementById("submit-btn");
    if (btn) btn.disabled = true;
    flushAll().then(function () {
      var n = unanswered();
      return confirmBox(n ? t("exam.confirmSubmitUnanswered", { n: n }) : t("exam.confirmSubmit"));
    }).then(function (ok) {
      if (!ok) { if (btn) btn.disabled = false; return null; }
      return doSubmit();
    }).catch(function (e) { if (btn) btn.disabled = false; showError(errorText(e)); });
  }

  function doSubmit() {
    if (finishing) return Promise.resolve();
    finishing = true;
    return api("POST", "/api/student/assessments/" + id + "/submit", {}).then(function (data) {
      finishing = false;
      adopt(data);
      render();
    }, function (e) { finishing = false; throw e; });
  }

  /* ---------- 倒计时 ---------- */
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function startTimer() {
    stopTimer();
    var deadline = Date.parse(detail.attempt.deadlineAt);
    function tick() {
      var left = deadline - nowMs();
      timerValue.textContent = fmtClock(left);
      timerBox.classList.toggle("low", left <= 5 * 60000);
      if (left <= 0) {
        stopTimer();
        timerValue.textContent = t("exam.timeUp");
        if (finishing) return;
        finishing = true;
        flushAll().then(function () { return api("POST", "/api/student/assessments/" + id + "/submit", {}); })
          .then(function (data) { finishing = false; adopt(data); render(); }, function () { finishing = false; return load(); });
      }
    }
    tick();
    timerId = setInterval(tick, 500);
  }

  /* ---------- 离开页面的记录 ---------- */
  function sendEvent(type, reason) {
    api("POST", "/api/student/assessments/" + id + "/events", { type: type, reason: reason }, true).catch(function () { /* 忽略 */ });
  }
  function onVisibility() {
    if (document.visibilityState === "hidden") sendEvent("leave", Date.now() - expectPdfAt < 5000 ? "pdf" : undefined);
    else sendEvent("return");
  }
  function onBeforeUnload(e) { e.preventDefault(); e.returnValue = ""; }
  function setTracking(on) {
    if (on === tracking) return;
    tracking = on;
    if (on) {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("beforeunload", onBeforeUnload);
    } else {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    }
  }

  /* ---------- 提交之后 / 回顾 ---------- */
  function renderDone() {
    var a = detail.assessment, qs = questions();
    var graded = a.status === "graded";
    root.appendChild(el("h1", "", graded ? t("exam.review.heading") : t("exam.done.heading")));
    root.appendChild(el("p", "sub", title(a) + "　" + fmtWall(a.scheduledWall)));
    var panel = el("div", "panel");
    if (graded) panel.appendChild(el("p", "score-big", t("exam.review.score", { s: a.score })));
    else panel.appendChild(el("p", "ok-box", detail.attempt && detail.attempt.autoSubmitted ? t("exam.done.auto") : t("exam.done.text")));

    panel.appendChild(el("h2", "", t("exam.review.questions")));
    var typed = detail.attempt && detail.attempt.method === "typed";
    qs.forEach(function (q) {
      var box = el("div", "review-q");
      box.appendChild(el("h3", "", q.label + (graded && q.score ? "　" + t("exam.review.qScore", { s: q.score }) + "　" + t("exam.review.weight", { w: q.weight || 1 }) : "")));
      var link = el("a", "", q.name);
      link.href = "/api/student/files/" + q.id;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      box.appendChild(link);
      if (typed) {
        box.appendChild(el("p", "", t("exam.review.myAnswer")));
        var txt = answers[q.id];
        box.appendChild(el("div", "answer-text", txt && txt.trim() ? txt : t("exam.review.noAnswer")));
      }
      if (q.answerFile) {
        var sc = el("a", "", t("exam.review.answerPdf", { name: q.answerFile.name }));
        sc.href = "/api/student/files/" + q.answerFile.id;
        sc.target = "_blank";
        sc.rel = "noopener noreferrer";
        box.appendChild(sc);
      }
      panel.appendChild(box);
    });
    var af = detail.answerFiles || [];
    if (af.length) {
      var abox = el("div", "review-q");
      abox.appendChild(el("h3", "", t("exam.review.paper")));
      abox.querySelector("h3").textContent = t("exam.review.paperOther");
      af.forEach(function (f) {
        var l = el("a", "", f.name);
        l.href = "/api/student/files/" + f.id;
        l.target = "_blank";
        l.rel = "noopener noreferrer";
        abox.appendChild(l);
        abox.appendChild(document.createElement("br"));
      });
      panel.appendChild(abox);
    }
    var actions = el("div", "actions");
    actions.appendChild(homeLink("primary"));
    panel.appendChild(actions);
    root.appendChild(panel);
  }

  /* ---------- 启动 ---------- */
  function renderBrand() {
    var b = document.getElementById("brand");
    if (!b || !window.APConfig) return;
    b.textContent = "";
    var logo = document.createElement("span");
    logo.className = "logo";
    logo.textContent = i18n.pick(window.APConfig.brandName);
    b.appendChild(logo);
    var sl = document.createElement("span");
    sl.className = "slogan";
    sl.textContent = i18n.pick(window.APConfig.slogan);
    b.appendChild(sl);
  }
  function markLang() {
    document.querySelectorAll(".lang-btn").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-lang") === i18n.getLang() ? "true" : "false"); });
  }
  var me = null;
  function renderUser() {
    var n = document.getElementById("user-name");
    if (!n || !me) return;
    var label = me.tzLabel ? i18n.tzTitle(me.tzLabel) : "";
    n.textContent = label ? (i18n.getLang() === "zh" ? me.username + "（" + label + "）" : me.username + " (" + label + ")") : me.username;
  }
  function init() {
    i18n.init();
    renderBrand();
    api("GET", "/api/me").then(function (m) { me = m; renderUser(); }).catch(function () { /* 忽略 */ });
    markLang();
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.addEventListener("click", function () { i18n.setLang(b.getAttribute("data-lang"), true); });
    });
    document.addEventListener("ap:langchange", function () { renderBrand(); renderUser(); markLang(); if (detail) render(); });
    if (!Number.isInteger(id) || id <= 0) { clear(root); root.appendChild(el("p", "error-box", t("exam.err.NOT_FOUND"))); root.appendChild(homeLink()); return; }
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
