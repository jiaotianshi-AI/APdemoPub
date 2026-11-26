/* 家长/老师端：为关联的学生新建、管理测试。所有来自服务器的文字都用 textContent 显示。 */
(function () {
  "use strict";

  var STATUS = { scheduled: "待测试", in_progress: "测试中", submitted: "已提交，待评分", graded: "已评分" };
  var MAX_FILES = 10;
  var MAX_BYTES = 20 * 1024 * 1024;
  var state = { students: [], currentId: null, assessments: [] };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------- 请求 ---------- */
  function request(method, path, body, extraHeaders, raw) {
    var headers = { "X-Requested-With": "apdemo" };
    var opts = { method: method, credentials: "same-origin", headers: headers };
    if (raw !== undefined) { opts.body = raw; }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });
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
  var api = function (method, path, body) { return request(method, path, body); };

  function setStatus(text, isError) {
    var s = $("status");
    s.textContent = text || "";
    s.className = "status" + (isError ? " error" : "");
  }
  function showMsg(id, text) { var m = $(id); m.textContent = text; m.hidden = !text; }

  /* ---------- 时间显示 ---------- */
  function fmtDate(d) { // 'YYYY-MM-DD'
    var p = d.split("-");
    return p[0] + "年" + Number(p[1]) + "月" + Number(p[2]) + "日";
  }
  function fmtWall(wall) { // 'YYYY-MM-DDTHH:MM'
    var h = Number(wall.slice(11, 13));
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return fmtDate(wall.slice(0, 10)) + " " + h12 + ":" + wall.slice(14, 16) + " " + (h < 12 ? "AM" : "PM") + "（温哥华时间）";
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  /* ---------- 对话框通用 ---------- */
  function openDialog(d) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
  function closeDialog(d) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  document.querySelectorAll("dialog [data-close]").forEach(function (b) {
    b.addEventListener("click", function () { closeDialog(b.closest("dialog")); });
  });
  var lastTrigger = null;
  function remember() { lastTrigger = document.activeElement; }
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("close", function () {
      if (lastTrigger && document.contains(lastTrigger) && typeof lastTrigger.focus === "function") lastTrigger.focus();
    });
  });
  function confirmDialog(message, okLabel, onOk) {
    $("confirm-message").textContent = message;
    var ok = $("confirm-ok");
    var fresh = ok.cloneNode(true);
    fresh.textContent = okLabel;
    ok.parentNode.replaceChild(fresh, ok);
    fresh.addEventListener("click", function () { closeDialog($("confirm-dialog")); onOk(); });
    openDialog($("confirm-dialog"));
  }

  /* ---------- 文件列表（上传 PDF） ---------- */
  function fileList(host, initial, label) {
    clear(host);
    var items = initial.map(function (f) { return { id: f.id, name: f.name, size: f.size }; });
    var uploading = 0;
    var ul = el("ul", "file-list");
    var picker = el("label", "picker-btn", "添加 PDF");
    var input = el("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = true;
    input.setAttribute("aria-label", "选择" + label);
    picker.appendChild(input);
    var wrap = el("div", "picker");
    wrap.appendChild(picker);
    var note = el("p", "upload-note");
    note.setAttribute("role", "status");

    function render() {
      clear(ul);
      if (!items.length) ul.appendChild(el("li", "muted", "还没有文件。"));
      items.forEach(function (f, i) {
        var li = el("li", "file-item");
        li.appendChild(el("span", "fname", f.name + "（" + fmtSize(f.size) + "）"));
        var rm = el("button", "btn", "移除");
        rm.type = "button";
        rm.setAttribute("aria-label", "移除 " + f.name);
        rm.addEventListener("click", function () { items.splice(i, 1); render(); });
        li.appendChild(rm);
        ul.appendChild(li);
      });
    }

    function uploadOne(file) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return Promise.reject(new Error("“" + file.name + "”不是 PDF 文件。"));
      if (file.size > MAX_BYTES) return Promise.reject(new Error("“" + file.name + "”超过 20MB。"));
      if (items.length >= MAX_FILES) return Promise.reject(new Error("最多 " + MAX_FILES + " 个文件。"));
      note.textContent = "正在上传 " + file.name + " …";
      return request("POST", "/api/supervisor/files", undefined, { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name) }, file)
        .then(function (data) { items.push(data.file); render(); });
    }

    input.addEventListener("change", function () {
      var list = Array.prototype.slice.call(input.files || []);
      input.value = "";
      if (!list.length) return;
      uploading += 1;
      var errors = [];
      list.reduce(function (p, f) {
        return p.then(function () { return uploadOne(f); }).catch(function (e) { errors.push(e.message); });
      }, Promise.resolve()).then(function () {
        uploading -= 1;
        note.textContent = errors.length ? errors.join(" ") : "";
        note.className = "upload-note" + (errors.length ? " msg error" : "");
      });
    });

    host.appendChild(ul);
    host.appendChild(wrap);
    host.appendChild(note);
    render();
    return { ids: function () { return items.map(function (f) { return f.id; }); }, busy: function () { return uploading > 0; } };
  }

  /* ---------- 学生列表 ---------- */
  function renderStudents() {
    var ul = $("student-list");
    clear(ul);
    $("no-students").hidden = state.students.length > 0;
    $("new-btn").disabled = state.students.length === 0;
    state.students.forEach(function (s) {
      var li = el("li");
      var b = el("button", "student-btn");
      b.type = "button";
      b.setAttribute("aria-current", s.id === state.currentId ? "true" : "false");
      b.appendChild(el("span", "name", s.username));
      b.appendChild(el("span", "sub", s.subject ? s.subject : "未设置学习科目"));
      b.addEventListener("click", function () { selectStudent(s.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function currentStudent() {
    for (var i = 0; i < state.students.length; i++) if (state.students[i].id === state.currentId) return state.students[i];
    return null;
  }

  function selectStudent(id) {
    state.currentId = id;
    renderStudents();
    var s = currentStudent();
    $("student-title").textContent = s ? s.username : "测试管理";
    $("student-sub").textContent = s ? (s.subject ? "学习科目：" + s.subject : "管理员还没有为这位学生设置学习科目") : "";
    return loadAssessments();
  }

  /* ---------- 测试列表 ---------- */
  function loadAssessments() {
    var host = $("lists");
    if (state.currentId === null) { clear(host); return Promise.resolve(); }
    var id = state.currentId;
    return api("GET", "/api/supervisor/students/" + id + "/assessments").then(function (data) {
      if (id !== state.currentId) return; // 已切换到别的学生
      state.assessments = data.assessments;
      setStatus("");
      renderLists();
    }).catch(function (e) { setStatus(e.message, true); });
  }

  function fileRow(label, files) {
    var row = el("div", "file-row");
    row.appendChild(el("span", "lbl", label));
    if (!files.length) { row.appendChild(el("span", "muted", "（暂无）")); return row; }
    files.forEach(function (f) {
      var a = el("a", "file-link", f.name);
      a.href = "/api/supervisor/files/" + f.id;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", label + "：" + f.name + "（在新标签页打开）");
      row.appendChild(a);
    });
    return row;
  }

  function btn(label, a, handler, cls) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.setAttribute("aria-label", label + "：" + a.subject + " " + a.unit + " " + fmtWall(a.scheduledWall));
    b.addEventListener("click", function () { remember(); handler(a); });
    return b;
  }

  function card(a) {
    var c = el("article", "test-card");
    var head = el("div", "test-head");
    head.appendChild(el("h3", "", a.subject + " · " + a.unit));
    head.appendChild(el("span", "badge " + a.status, STATUS[a.status] || a.status));
    if (a.attemptNo > 1) head.appendChild(el("span", "badge tag", "第 " + a.attemptNo + " 次（重测）"));
    c.appendChild(head);

    var meta = el("dl", "meta");
    function item(label, value, cls) {
      var d = el("div");
      d.appendChild(el("dt", "", label));
      d.appendChild(el("dd", cls || "", value));
      meta.appendChild(d);
    }
    item("测试时间", fmtWall(a.scheduledWall));
    item("测试时长", a.durationMinutes + " 分钟");
    item("本单元开始学习", fmtDate(a.unitStartDate));
    item("测试分数", a.score ? a.score + " / 5" : "—", a.score ? "score" : "");
    c.appendChild(meta);
    c.appendChild(fileRow("测试题目", a.questionFiles));
    c.appendChild(fileRow("学生答题（扫描件）", a.answerFiles));
    if (a.attempt) c.appendChild(el("p", "attempt-line", attemptLine(a.attempt)));

    var act = el("div", "card-actions");
    if (a.status === "scheduled") {
      act.appendChild(btn("修改", a, function (x) { openTestDialog("edit", x); }));
      act.appendChild(btn("答题与分数", a, openScoreDialog));
      act.appendChild(btn("删除", a, askDelete, "danger"));
    } else if (a.status === "in_progress") {
      act.appendChild(btn("查看答题", a, openView));
      act.appendChild(el("span", "muted", "学生正在测试，完成后才能修改。"));
    } else if (a.status === "submitted") {
      act.appendChild(btn("查看学生答题", a, openView));
      act.appendChild(btn("答题与分数", a, openScoreDialog));
    } else {
      act.appendChild(btn("查看学生答题", a, openView));
      act.appendChild(btn("修改分数", a, openScoreDialog));
      act.appendChild(btn("重测", a, openRetakeDialog));
    }
    c.appendChild(act);
    return c;
  }

  function renderLists() {
    var host = $("lists");
    clear(host);
    var now = Date.now();
    function newest(x, y) { return Date.parse(y.scheduledAt) - Date.parse(x.scheduledAt); }
    var upcoming = state.assessments.filter(function (a) { return a.status === "scheduled" && Date.parse(a.scheduledAt) > now; })
      .sort(function (x, y) { return Date.parse(x.scheduledAt) - Date.parse(y.scheduledAt); });
    var active = state.assessments.filter(function (a) { return a.status === "in_progress" || a.status === "submitted"; }).sort(newest);
    var past = state.assessments.filter(function (a) { return upcoming.indexOf(a) < 0 && active.indexOf(a) < 0; }).sort(newest);

    [["将来的测试", upcoming, "还没有安排将来的测试。", true], ["进行中与待评分", active, "", false], ["过往的测试", past, "还没有过往的测试。", true]].forEach(function (g) {
      if (!g[1].length && !g[3]) return; // “进行中与待评分”没有内容时不显示
      var sec = el("section");
      sec.appendChild(el("h2", "group-title", g[0] + "（" + g[1].length + "）"));
      if (!g[1].length) sec.appendChild(el("p", "empty-note", g[2]));
      g[1].forEach(function (a) { sec.appendChild(card(a)); });
      host.appendChild(sec);
    });
  }

  /* ---------- 查看学生答题 ---------- */
  function fmtInstant(iso) {
    try {
      return new Date(iso).toLocaleString("zh-CN", { timeZone: "America/Vancouver", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false }) + "（温哥华时间）";
    } catch (e) { return iso; }
  }
  function attemptLine(at) {
    var parts = ["作答方式：" + (at.method === "typed" ? "屏幕输入" : "纸质作答")];
    parts.push("开始于 " + fmtInstant(at.startedAt) + (at.early ? "（提前开始）" : ""));
    if (at.submittedAt) {
      var mins = Math.max(1, Math.round((Date.parse(at.submittedAt) - Date.parse(at.startedAt)) / 60000));
      parts.push((at.autoSubmitted ? "时间到自动提交" : "提交于 " + fmtInstant(at.submittedAt)) + "，用时约 " + mins + " 分钟");
    } else parts.push("正在作答，截止 " + fmtInstant(at.deadlineAt));
    var away = "离开页面 " + at.leaveCount + " 次";
    if (at.awaySeconds) away += "，共约 " + (at.awaySeconds >= 60 ? Math.round(at.awaySeconds / 60) + " 分钟" : at.awaySeconds + " 秒");
    if (at.pdfLeaves) away += "（另有 " + at.pdfLeaves + " 次是为了打开题目 PDF）";
    parts.push(away);
    return parts.join("；") + "。";
  }

  var viewing = null;
  function aiMessage(text, isErr) { var m = $("view-ai-msg"); m.textContent = text; m.className = "msg " + (isErr ? "error" : "ok"); m.hidden = !text; }
  function requestAi(body) {
    aiMessage("");
    api("POST", "/api/supervisor/assessments/" + viewing.id + "/ai-score", body).then(function () { aiMessage("已提交 AI 评分请求。"); })
      .catch(function (e) { aiMessage(e.code === "AI_SCORING_NOT_AVAILABLE" ? "AI 评分功能尚未开放（接口已预留）。" : e.message, true); });
  }
  $("view-ai-all").addEventListener("click", function () { requestAi({}); });

  function openView(a) {
    viewing = a;
    aiMessage("");
    $("view-summary").textContent = a.subject + " · " + a.unit + "　" + fmtWall(a.scheduledWall);
    var info = $("view-info"), qbox = $("view-questions");
    clear(info); clear(qbox);
    qbox.appendChild(el("p", "muted", "加载中…"));
    openDialog($("view-dialog"));
    api("GET", "/api/supervisor/assessments/" + a.id + "/attempt").then(function (data) {
      clear(qbox);
      if (data.attempt) info.appendChild(el("p", "attempt-line", attemptLine(data.attempt)));
      else info.appendChild(el("p", "muted", "学生还没有开始这场测试。"));
      var typed = data.attempt && data.attempt.method === "typed";
      data.questions.forEach(function (q) {
        var box = el("div", "view-q");
        box.appendChild(el("h3", "", "第 " + q.no + " 题"));
        var link = el("a", "file-link", q.name);
        link.href = "/api/supervisor/files/" + q.id;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        box.appendChild(link);
        if (data.attempt) {
          if (typed) {
            box.appendChild(el("p", "muted", "学生的答案"));
            box.appendChild(el("div", "answer-text", q.answer && q.answer.trim() ? q.answer : "（没有填写）"));
          } else box.appendChild(el("p", "muted", "学生选择纸质作答，请在“答题与分数”里上传扫描件。"));
        }
        var ai = el("button", "btn", "请求 AI 评分（本题）");
        ai.type = "button";
        ai.setAttribute("aria-label", "请求 AI 评分：第 " + q.no + " 题");
        ai.addEventListener("click", function () { requestAi({ questionFileId: q.id }); });
        box.appendChild(ai);
        qbox.appendChild(box);
      });
    }).catch(function (e) { clear(qbox); qbox.appendChild(el("p", "msg error", e.message)); });
  }

  /* ---------- 新建 / 修改测试 ---------- */
  var testForm = { mode: "create", assessment: null, files: null, checks: [] };

  function targetBox(preselect) {
    var box = $("target-box");
    clear(box);
    var fs = el("fieldset");
    fs.appendChild(el("legend", "", "目标学生（可多选）"));
    var list = el("div", "check-list");
    var allLabel = el("label", "check all");
    var all = el("input");
    all.type = "checkbox";
    allLabel.appendChild(all);
    allLabel.appendChild(el("span", "", "所有学生"));
    list.appendChild(allLabel);
    testForm.checks = state.students.map(function (s) {
      var l = el("label", "check");
      var c = el("input");
      c.type = "checkbox";
      c.value = String(s.id);
      c.checked = s.id === preselect;
      l.appendChild(c);
      l.appendChild(el("span", "", s.username));
      list.appendChild(l);
      c.addEventListener("change", sync);
      return c;
    });
    function sync() { all.checked = testForm.checks.length > 0 && testForm.checks.every(function (c) { return c.checked; }); }
    all.addEventListener("change", function () { testForm.checks.forEach(function (c) { c.checked = all.checked; }); });
    sync();
    fs.appendChild(list);
    box.appendChild(fs);
  }

  function openTestDialog(mode, a) {
    testForm.mode = mode;
    testForm.assessment = a || null;
    showMsg("test-error", "");
    $("test-form").reset();
    $("test-title").textContent = mode === "create" ? "新建测试" : "修改测试";
    $("test-submit").textContent = mode === "create" ? "提交" : "保存";
    var box = $("target-box");
    if (mode === "create") {
      targetBox(state.currentId);
      var cur = currentStudent();
      if (cur && cur.subject) $("t-subject").value = cur.subject;
      testForm.files = fileList($("q-files"), [], "题目 PDF");
    } else {
      clear(box);
      var s = currentStudent();
      box.appendChild(el("p", "readonly-line", "学生：" + (s ? s.username : "")));
      $("t-date").value = a.scheduledWall.slice(0, 10);
      $("t-time").value = a.scheduledWall.slice(11, 16);
      $("t-start").value = a.unitStartDate;
      $("t-duration").value = String(a.durationMinutes);
      $("t-subject").value = a.subject;
      $("t-unit").value = a.unit;
      testForm.files = fileList($("q-files"), a.questionFiles, "题目 PDF");
    }
    openDialog($("test-dialog"));
    var first = box.querySelector("input") || $("t-date");
    first.focus();
  }

  $("new-btn").addEventListener("click", function () { remember(); openTestDialog("create"); });

  $("test-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("test-error", "");
    var date = $("t-date").value, time = $("t-time").value, start = $("t-start").value;
    var subject = $("t-subject").value.trim(), unit = $("t-unit").value.trim();
    var studentIds = testForm.mode === "create"
      ? testForm.checks.filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); }) : null;
    if (studentIds && !studentIds.length) return showMsg("test-error", "请至少选择一个学生。");
    if (!date || !time) return showMsg("test-error", "请选择测试日期和时间。");
    if (!start) return showMsg("test-error", "请选择本单元开始学习日期。");
    if (!subject) return showMsg("test-error", "请填写测试科目。");
    if (!unit) return showMsg("test-error", "请填写测试单元。");
    if (testForm.files.busy()) return showMsg("test-error", "文件还在上传，请稍等。");
    var fileIds = testForm.files.ids();
    if (!fileIds.length) return showMsg("test-error", "请至少上传一个题目 PDF。");

    var duration = Number($("t-duration").value);
    if (!Number.isInteger(duration) || duration < 5 || duration > 300) return showMsg("test-error", "测试时长必须是 5–300 分钟的整数。");
    var body = { scheduledWall: date + "T" + time, subject: subject, unit: unit, unitStartDate: start, durationMinutes: duration, questionFileIds: fileIds };
    var req;
    if (testForm.mode === "create") { body.studentIds = studentIds; req = api("POST", "/api/supervisor/assessments", body); }
    else req = api("PATCH", "/api/supervisor/assessments/" + testForm.assessment.id, body);

    $("test-submit").disabled = true;
    req.then(function (data) {
      closeDialog($("test-dialog"));
      var n = data.assessments ? data.assessments.length : 1;
      return loadAssessments().then(function () { setStatus(testForm.mode === "create" ? "已为 " + n + " 个学生新建测试。" : "已保存。"); });
    }).catch(function (err) { showMsg("test-error", err.message); })
      .then(function () { $("test-submit").disabled = false; });
  });

  /* ---------- 答题与分数 ---------- */
  var scoreForm = { assessment: null, files: null };
  function openScoreDialog(a) {
    scoreForm.assessment = a;
    showMsg("score-error", "");
    $("score-summary").textContent = a.subject + " · " + a.unit + "　" + fmtWall(a.scheduledWall);
    $("s-score").value = a.score ? String(a.score) : "";
    scoreForm.files = fileList($("a-files"), a.answerFiles, "答题 PDF");
    openDialog($("score-dialog"));
    $("s-score").focus();
  }
  $("score-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("score-error", "");
    var a = scoreForm.assessment;
    if (scoreForm.files.busy()) return showMsg("score-error", "文件还在上传，请稍等。");
    var raw = $("s-score").value;
    if (a.status === "graded" && !raw) return showMsg("score-error", "已评分的测试不能清除分数，请选择 1–5。");
    var body = { answerFileIds: scoreForm.files.ids() };
    if (raw) body.score = Number(raw);
    $("score-submit").disabled = true;
    api("PATCH", "/api/supervisor/assessments/" + a.id, body).then(function () {
      closeDialog($("score-dialog"));
      return loadAssessments().then(function () { setStatus("已保存。"); });
    }).catch(function (err) { showMsg("score-error", err.message); })
      .then(function () { $("score-submit").disabled = false; });
  });

  /* ---------- 重测 ---------- */
  var retakeFor = null;
  function openRetakeDialog(a) {
    retakeFor = a;
    showMsg("retake-error", "");
    $("retake-form").reset();
    $("retake-summary").textContent = "原测试：" + a.subject + " · " + a.unit + "，" + fmtWall(a.scheduledWall) + "，分数 " + a.score + " / 5";
    openDialog($("retake-dialog"));
    $("r-date").focus();
  }
  $("retake-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("retake-error", "");
    var date = $("r-date").value, time = $("r-time").value;
    if (!date || !time) return showMsg("retake-error", "请选择新的测试日期和时间。");
    $("retake-submit").disabled = true;
    api("POST", "/api/supervisor/assessments/" + retakeFor.id + "/retake", { scheduledWall: date + "T" + time }).then(function () {
      closeDialog($("retake-dialog"));
      return loadAssessments().then(function () { setStatus("已生成重测记录（待测试）。"); });
    }).catch(function (err) { showMsg("retake-error", err.message); })
      .then(function () { $("retake-submit").disabled = false; });
  });

  /* ---------- 删除 ---------- */
  function askDelete(a) {
    confirmDialog("删除这条待测试记录（" + a.subject + " · " + a.unit + "，" + fmtWall(a.scheduledWall) + "）？删除后无法恢复。", "删除", function () {
      api("DELETE", "/api/supervisor/assessments/" + a.id).then(loadAssessments).then(function () { setStatus("已删除。"); })
        .catch(function (e) { setStatus(e.message, true); });
    });
  }

  /* ---------- 启动 ---------- */
  api("GET", "/api/me").then(function (me) { $("whoami").textContent = "当前账号：" + me.username; }).catch(function () { /* 忽略 */ });
  api("GET", "/api/supervisor/students").then(function (data) {
    state.students = data.students;
    renderStudents();
    if (state.students.length) return selectStudent(state.students[0].id);
    $("student-sub").textContent = "";
  }).catch(function (e) { setStatus(e.message, true); });
})();
