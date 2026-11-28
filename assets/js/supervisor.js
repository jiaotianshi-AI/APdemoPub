/* 家长/老师端：为关联的学生新建、管理测试。所有来自服务器的文字都用 textContent 显示。 */
(function () {
  "use strict";

  var STATUS = { scheduled: "待测试", in_progress: "测试中", submitted: "已提交，待评分", graded: "已评分" };
  var MAX_FILES = 10;
  var MAX_BYTES = 20 * 1024 * 1024;
  var state = { students: [], currentId: null, assessments: [], me: null };

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
    return fmtDate(wall.slice(0, 10)) + " " + h12 + ":" + wall.slice(14, 16) + " " + (h < 12 ? "AM" : "PM");
  }
  // 文件名缩略：只留前 3 个和后 5 个字符，中间用 * 代替（名字不超过 8 个字符就完整显示）
  function shortName(name) {
    var c = Array.from(String(name));
    return c.length <= 8 ? name : c.slice(0, 3).join("") + "*" + c.slice(-5).join("");
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  /* ---------- 时区提醒 ----------
     测试时间一律按“学生所在时区”设定。家长/老师自己的时区与学生不同时，提醒按学生的时区填写。 */
  function tzNotice(students, hintEl, warnEl) {
    var mine = state.me ? state.me.tzLabel.zh : "";
    var myTz = state.me ? state.me.timezone : "";
    warnEl.hidden = true;
    warnEl.textContent = "";
    if (!students.length) { hintEl.textContent = "请先选择学生。日期和时间按学生所在时区设定。"; return; }
    var groups = {};
    students.forEach(function (s) { (groups[s.timezone] = groups[s.timezone] || { label: s.tzLabel.zh, n: 0 }).n += 1; });
    var tzs = Object.keys(groups);
    if (tzs.length === 1) {
      var g = groups[tzs[0]];
      hintEl.textContent = "日期和时间按学生所在时区设定：" + g.label + "。";
      if (tzs[0] !== myTz) {
        warnEl.textContent = "提醒：你的时区是 " + mine + "，学生的时区是 " + g.label + "。请按学生所在时区（" + g.label + "）填写测试日期和时间，不要按你自己的时区。";
        warnEl.hidden = false;
      }
    } else {
      hintEl.textContent = "日期和时间按每个学生自己所在的时区设定。";
      warnEl.textContent = "提醒：所选学生的时区不同（" + tzs.map(function (k) { return groups[k].label + "：" + groups[k].n + " 人"; }).join("；") + "），同一个日期和时间会分别按各自的时区生效。你的时区是 " + mine + "。";
      warnEl.hidden = false;
    }
  }
  function studentById(id) { for (var i = 0; i < state.students.length; i++) if (state.students[i].id === id) return state.students[i]; return null; }

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
    var items = initial.map(function (f) { return { id: f.id, name: f.name, size: f.size, weight: f.weight || 1 }; });
    var uploading = 0;
    var ul = el("ul", "file-list");
    var picker = el("label", "picker-btn", "＋");
    picker.title = "添加 PDF";
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
        var fn = el("span", "fname", "Q" + (i + 1) + "　" + shortName(f.name));
        fn.title = f.name + "（" + fmtSize(f.size) + "）";
        li.appendChild(fn);
        var wl = el("label", "weight-label", "权重");
        var wi = el("input");
        wi.type = "number";
        wi.min = "1";
        wi.max = "100";
        wi.step = "1";
        wi.value = String(f.weight);
        wi.className = "weight-input";
        wi.setAttribute("inputmode", "numeric");
        wi.setAttribute("aria-label", "Q" + (i + 1) + " " + f.name + " 的权重（1–100 的整数）");
        wi.addEventListener("input", function () { f.weight = wi.value === "" ? NaN : Number(wi.value); });
        wl.appendChild(wi);
        li.appendChild(wl);
        var rm = el("button", "btn", "－");
        rm.type = "button";
        rm.title = "移除";
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
        .then(function (data) { items.push({ id: data.file.id, name: data.file.name, size: data.file.size, weight: 1 }); render(); });
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
    return {
      ids: function () { return items.map(function (f) { return f.id; }); },
      weights: function () { return items.map(function (f) { return f.weight; }); },
      busy: function () { return uploading > 0; }
    };
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
      b.appendChild(el("span", "sub", (s.subject ? s.subject : "未设置学习科目") + "　·　" + (s.direction === "writing" ? "写作" : "AP 自学")));
      if (s.direction === "writing" && s.promptsLeft !== null && s.promptsLeft < s.lowPrompts) b.appendChild(el("span", "badge warn", "题目不足（剩 " + s.promptsLeft + "）"));
      if (s.direction === "writing" && s.writingFlags > 0) b.appendChild(el("span", "badge flag", "安全提醒（" + s.writingFlags + "）"));
      if (s.direction === "writing" && s.missedStreak >= 3) b.appendChild(el("span", "badge warn", "连续 " + s.missedStreak + " 天未完成"));
      b.appendChild(el("span", "sub", "时区：" + s.tzLabel.zh));
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
    $("student-sub").textContent = s ? (s.subject ? "学习科目：" + s.subject : "管理员还没有为这位学生设置学习科目") + "　·　学生所在时区：" + s.tzLabel.zh : "";
    // 写作板块的学生：这里还没有对应的内容（Writing 板块开发中），不显示 AP 测试管理
    var isWriting = !!s && s.direction === "writing";
    $("new-btn").hidden = isWriting;
    $("writing-area").hidden = !isWriting;
    if (isWriting) {
      clear($("lists"));
      state.assessments = [];
      setStatus("");
      return loadWriting(s.id);
    }
    return loadAssessments();
  }

  /* ---------- 写作板块：日程和题目库 ---------- */
  var DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  var wstate = { data: null, id: null };
  var dayBoxes = [];

  function drawDays(mask) {
    var host = $("w-days");
    clear(host);
    dayBoxes = DAY_NAMES.map(function (name, i) {
      var l = el("label", "day-opt");
      var c = el("input");
      c.type = "checkbox";
      c.checked = (mask & (1 << i)) !== 0;
      c.setAttribute("aria-label", name);
      l.appendChild(c);
      l.appendChild(el("span", "", name));
      host.appendChild(l);
      return c;
    });
  }
  function daysMask() { return dayBoxes.reduce(function (m, c, i) { return c.checked ? m | (1 << i) : m; }, 0); }
  function loadWriting(id) {
    wstate.id = id;
    return api("GET", "/api/supervisor/writing/students/" + id).then(function (data) {
      if (id !== state.currentId) return;
      wstate.data = data;
      renderWriting();
      return loadRecords(id);
    }).catch(function (e) { setStatus(e.message, true); });
  }

  /* ----- 写作记录：回看每一轮、修改评分、安全标记 ----- */
  function loadRecords(id) {
    return api("GET", "/api/supervisor/writing/students/" + id + "/sessions").then(function (d) {
      if (id !== state.currentId) return;
      wstate.sessions = d.sessions;
      wstate.unreviewedFlags = d.unreviewedFlags;
      wstate.missedStreak = d.missedStreak;
      renderRecords();
    }).catch(function (e) { showMsg("w-records-msg", e.message); });
  }
  function syncStudentFlags() {
    var s = currentStudent();
    if (s) { s.writingFlags = wstate.unreviewedFlags; s.missedStreak = wstate.missedStreak; renderStudents(); }
  }
  function renderRecords() {
    var ul = $("w-records");
    clear(ul);
    var notes = [];
    if (wstate.unreviewedFlags > 0) notes.push("有 " + wstate.unreviewedFlags + " 条 AI 标记的安全内容还没查看，请回看相关作文和对话。");
    if (wstate.missedStreak >= 3) notes.push("连续 " + wstate.missedStreak + " 个写作日没有完成。");
    $("w-flag-banner").hidden = !notes.length;
    $("w-flag-banner").textContent = notes.join(" ");
    $("w-records-empty").hidden = wstate.sessions.length > 0;
    wstate.sessions.forEach(function (r) { ul.appendChild(recordItem(r)); });
    syncStudentFlags();
    if (wstate.reopen) { // 保存评分/标记已查看后，列表刷新了：把刚才展开的那一篇重新展开
      var li = ul.querySelector('[data-id="' + wstate.reopen.id + '"]');
      var flash = wstate.reopen.flash;
      wstate.reopen = null;
      if (li) li._open(flash);
    }
  }
  function recordItem(r) {
    var li = el("li", "rec-item");
    var head = el("div", "rec-head");
    head.appendChild(el("span", "rec-day", fmtDate(r.day)));
    head.appendChild(el("span", "rec-title", r.promptTitle));
    head.appendChild(el("span", "badge" + (r.status === "done" ? " graded" : " tag"), r.status === "done" ? "已完成" : "没写完"));
    if (r.status === "done") {
      head.appendChild(el("span", "badge", r.aiScore ? "AI " + r.aiScore + " / 5" : "AI 没有评分"));
      if (r.supervisorScore) head.appendChild(el("span", "badge graded", "你改为 " + r.supervisorScore + " / 5"));
    }
    if (r.openFlags > 0) head.appendChild(el("span", "badge flag", "安全提醒"));
    else if (r.flags > 0) head.appendChild(el("span", "badge", "安全提醒（已查看）"));
    li.appendChild(head);
    if (r.scores.length) li.appendChild(el("p", "rec-steps", r.scores.map(function (s, i) { return "第 " + (i + 1) + " 轮 " + s; }).join(" → ")));
    var tg = el("button", "btn", "展开");
    tg.type = "button";
    tg.setAttribute("aria-expanded", "false");
    tg.setAttribute("aria-label", "展开 " + r.day + " 的写作记录");
    var box = el("div", "rec-detail");
    box.hidden = true;
    function open(flash) {
      tg.disabled = true;
      return api("GET", "/api/supervisor/writing/sessions/" + r.id).then(function (d) {
        drawDetail(box, d);
        box.hidden = false; tg.textContent = "收起"; tg.setAttribute("aria-expanded", "true"); tg.setAttribute("aria-label", "收起 " + r.day + " 的写作记录");
        if (flash) { var m = box.querySelector(".rec-grade .msg"); if (m) { m.hidden = false; m.textContent = flash; } }
      }).catch(function (e) { showMsg("w-records-msg", e.message); })
        .then(function () { tg.disabled = false; });
    }
    tg.addEventListener("click", function () {
      if (!box.hidden) { box.hidden = true; tg.textContent = "展开"; tg.setAttribute("aria-expanded", "false"); tg.setAttribute("aria-label", "展开 " + r.day + " 的写作记录"); return; }
      open();
    });
    li._open = open;
    li.setAttribute("data-id", String(r.id));
    li.appendChild(tg);
    li.appendChild(box);
    return li;
  }
  function drawDetail(box, d) {
    clear(box);
    d.turns.forEach(function (t) {
      var rd = el("div", "rec-round");
      rd.appendChild(el("h3", "", "第 " + t.round + " 轮　AI 评分 " + t.score + " / 5" + (t.done ? "（结束）" : "") + (t.flag ? "　· 安全提醒" : "")));
      rd.appendChild(el("p", "muted", "这一轮开始时的作文"));
      rd.appendChild(el("div", "rec-essay", t.essay));
      rd.appendChild(el("p", "muted", "AI 的反馈"));
      rd.appendChild(el("p", "", t.feedback));
      t.questions.forEach(function (q, i) {
        var p = el("p", "rec-q");
        p.appendChild(el("strong", "", q.type + "　"));
        p.appendChild(document.createTextNode(q.text));
        if (q.quote) p.appendChild(el("span", "quote", "　（“" + q.quote + "”）"));
        rd.appendChild(p);
        rd.appendChild(el("p", "rec-ans", "孩子的回答：" + (t.answers[i] && t.answers[i].trim() ? t.answers[i] : "（没有回答）")));
      });
      box.appendChild(rd);
    });
    if (d.status === "done") {
      box.appendChild(el("p", "muted", "最终作文"));
      box.appendChild(el("div", "rec-essay", d.finalText || d.draft));
      box.appendChild(recordGradeForm(d));
    } else {
      box.appendChild(el("p", "muted", "这一天没有写完。当前草稿："));
      box.appendChild(el("div", "rec-essay", d.draft || "（空）"));
    }
    if (d.openFlags > 0) {
      var rv = el("button", "btn", "标记为已查看");
      rv.type = "button";
      rv.setAttribute("aria-label", "标记 " + d.day + " 的安全提醒为已查看");
      rv.addEventListener("click", function () {
        api("POST", "/api/supervisor/writing/sessions/" + d.id + "/review-flags").then(function () { wstate.reopen = { id: d.id, flash: "" }; return loadRecords(wstate.id); })
          .catch(function (e) { showMsg("w-records-msg", e.message); });
      });
      box.appendChild(rv);
    }
  }
  // 修改评分：1–5 单选 + 评语；AI 的原始分数保留，孩子能看到最终的分数和评语
  function recordGradeForm(d) {
    var f = el("div", "rec-grade");
    f.appendChild(el("h3", "", "评分（孩子能看到）"));
    f.appendChild(el("p", "muted", (d.aiScore ? "AI 的建议分是 " + d.aiScore + " / 5" + (d.scoreFromEarlierVersion ? "（来自更早一版作文）" : "") + "。" : "AI 没有给这篇作文评分（孩子在评分前点了“我写完了”，或 AI 当时不可用）。") + "你可以给出分数并写一句评语；你给的分数以你的为准。"));
    var wrap = el("div", "score-radios");
    wrap.setAttribute("role", "radiogroup");
    wrap.setAttribute("aria-label", d.day + " 的评分");
    var radios = [];
    for (var i = 1; i <= 5; i++) {
      var l = el("label", "score-opt");
      var r = el("input");
      r.type = "radio";
      r.name = "w-score-" + d.id;
      r.value = String(i);
      r.checked = d.supervisorScore === i;
      r.setAttribute("aria-label", d.day + " 评分 " + i);
      l.appendChild(r);
      l.appendChild(el("span", "", String(i)));
      wrap.appendChild(l);
      radios.push(r);
    }
    f.appendChild(wrap);
    var lab = el("label", "", "评语（可选，孩子能看到）");
    var ta = el("textarea");
    ta.rows = 2;
    ta.maxLength = 1000;
    ta.id = "w-comment-" + d.id;
    lab.htmlFor = ta.id;
    ta.value = d.supervisorComment;
    f.appendChild(lab);
    f.appendChild(ta);
    var msg = el("p", "msg", "");
    msg.setAttribute("role", "status");
    msg.hidden = true;
    function save(score) {
      api("PUT", "/api/supervisor/writing/sessions/" + d.id + "/grade", { score: score, comment: ta.value }).then(function () {
        wstate.reopen = { id: d.id, flash: score === null ? "已恢复为 AI 的分数。" : "已保存。" };
        return loadRecords(wstate.id);
      }).catch(function (e) { msg.hidden = false; msg.textContent = e.message; });
    }
    var sv = el("button", "btn primary", "保存评分");
    sv.type = "button";
    sv.addEventListener("click", function () {
      var c = radios.filter(function (x) { return x.checked; })[0];
      if (!c) { msg.hidden = false; msg.textContent = "请先选择 1–5 的分数。"; return; }
      save(Number(c.value));
    });
    var rs = el("button", "btn", "恢复为 AI 的分数");
    rs.type = "button";
    rs.addEventListener("click", function () { save(null); });
    f.appendChild(sv);
    f.appendChild(rs);
    f.appendChild(msg);
    return f;
  }
  function renderWriting() {
    var d = wstate.data;
    var sch = d.schedule;
    $("w-sched-hint").textContent = (d.student.gradeLabel ? "年级：" + d.student.gradeLabel.zh + "　·　" : "") + "学生所在时区：" + d.student.tzLabel.zh + (sch.configured ? "" : "　·　还没有设置写作日程，请先设置每天的时间。");
    $("w-time").value = sch.time || "";
    drawDays(sch.days);
    $("w-paused").checked = sch.paused;
    showMsg("w-sched-msg", "");
    renderPrompts();
  }
  function renderPrompts() {
    var d = wstate.data;
    var rem = $("w-remaining");
    rem.textContent = "剩余 " + d.remaining + " 个还没写过的题目" + (d.low ? "　·　少于 " + d.lowThreshold + " 个，请追加题目" : "");
    rem.className = "remaining" + (d.low ? " low" : "");
    var ul = $("w-prompts");
    clear(ul);
    if (!d.prompts.length) ul.appendChild(el("li", "muted", "题目库还是空的，请在下面添加题目。"));
    d.prompts.forEach(function (p) {
      var li = el("li", "prompt-item" + (p.used ? " used" : ""));
      var t = el("div", "p-text", p.title);
      if (p.hint) t.appendChild(el("span", "p-hint", "提示：" + p.hint));
      li.appendChild(t);
      if (p.used) li.appendChild(el("span", "badge", "已写过"));
      else {
        var ed = el("button", "btn", "修改");
        ed.type = "button";
        ed.setAttribute("aria-label", "修改题目：" + p.title);
        ed.addEventListener("click", function () { editPrompt(p); });
        var rm = el("button", "btn danger", "删除");
        rm.type = "button";
        rm.setAttribute("aria-label", "删除题目：" + p.title);
        rm.addEventListener("click", function () {
          confirmDialog("删除题目“" + p.title + "”？", "删除", function () {
            api("DELETE", "/api/supervisor/writing/prompts/" + p.id).then(function (data) { wstate.data = data; renderPrompts(); refreshStudentFlags(data); })
              .catch(function (e) { showMsg("w-prompt-msg", e.message); });
          });
        });
        li.appendChild(ed);
        li.appendChild(rm);
      }
      ul.appendChild(li);
    });
  }
  function editPrompt(p) {
    $("w-prompt-title").value = p.title;
    $("w-prompt-hint").value = p.hint;
    wstate.editing = p.id;
    $("w-prompt-add").textContent = "保存修改";
    $("w-prompt-title").focus();
  }
  function refreshStudentFlags(data) {
    var s = currentStudent();
    if (s) { s.promptsLeft = data.remaining; renderStudents(); }
  }
  $("w-sched-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("w-sched-msg", "");
    var time = $("w-time").value;
    if (!time) return showMsg("w-sched-msg", "请选择每天写作的时间。");
    var mask = daysMask();
    if (!mask) return showMsg("w-sched-msg", "请至少选择一周中的一天。");
    api("PUT", "/api/supervisor/writing/students/" + wstate.id + "/schedule", { time: time, days: mask, paused: $("w-paused").checked }).then(function (data) {
      wstate.data = data;
      renderWriting();
      showMsg("w-sched-msg", "日程已保存。");
    }).catch(function (err) { showMsg("w-sched-msg", err.message); });
  });
  $("w-days-all").addEventListener("click", function () { dayBoxes.forEach(function (c) { c.checked = true; }); });
  $("w-days-weekdays").addEventListener("click", function () { dayBoxes.forEach(function (c, i) { c.checked = i < 5; }); });
  $("w-prompt-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("w-prompt-msg", "");
    var title = $("w-prompt-title").value.trim();
    if (!title) return showMsg("w-prompt-msg", "请填写题目。");
    var body = { title: title, hint: $("w-prompt-hint").value.trim() };
    var editing = wstate.editing;
    var req = editing ? api("PATCH", "/api/supervisor/writing/prompts/" + editing, body) : api("POST", "/api/supervisor/writing/students/" + wstate.id + "/prompts", body);
    req.then(function (data) {
      wstate.data = data;
      wstate.editing = null;
      $("w-prompt-title").value = "";
      $("w-prompt-hint").value = "";
      $("w-prompt-add").textContent = "添加题目";
      renderPrompts();
      refreshStudentFlags(data);
      showMsg("w-prompt-msg", editing ? "已保存修改。" : "已添加题目。");
    }).catch(function (err) { showMsg("w-prompt-msg", err.message); });
  });

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
      var a = el("a", "file-link", shortName(f.name));
      a.title = f.name;
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

  function overallText(a) {
    if (a.score) {
      var avg = a.scoreAverage !== null && a.scoreAverage !== undefined && a.scoredCount === a.questionCount ? "（加权平均 " + (Math.round(a.scoreAverage * 100) / 100) + "）" : "";
      return a.score + " / 5" + avg;
    }
    return a.questionCount ? "— （已评 " + a.scoredCount + " / " + a.questionCount + " 题）" : "—";
  }

  // 每道题一行：题号 · 问题 PDF · 回答 PDF（可为空）· 评分（可为空）
  function questionTable(a) {
    var wrap = el("div", "q-table");
    var head = el("div", "q-row q-head");
    ["题号", "问题 PDF", "权重", "回答文字", "回答 PDF", "评分"].forEach(function (h) { head.appendChild(el("span", "", h)); });
    wrap.appendChild(head);
    a.questionFiles.forEach(function (q) {
      var row = el("div", "q-row");
      row.appendChild(el("span", "q-label", q.label));
      var ql = el("a", "file-link", shortName(q.name));
      ql.title = q.name;
      ql.href = "/api/supervisor/files/" + q.id;
      ql.target = "_blank";
      ql.rel = "noopener noreferrer";
      ql.setAttribute("aria-label", q.label + " 问题：" + q.name + "（在新标签页打开）");
      row.appendChild(ql);
      row.appendChild(el("span", "q-weight", "×" + (q.weight || 1)));
      // 回答文字：学生用屏幕输入作答时才有；纸质作答或还没作答显示 —
      var tcell = el("span");
      if (q.answerText === null || q.answerText === undefined) tcell.appendChild(el("span", "muted", "—"));
      else if (q.answerText.trim() === "") tcell.appendChild(el("span", "muted", "（没有填写）"));
      else { var snip = el("div", "answer-snippet", q.answerText); snip.title = q.answerText; tcell.appendChild(snip); }
      row.appendChild(tcell);
      var cell = el("span");
      if (q.answerFile) {
        var al = el("a", "file-link", shortName(q.answerFile.name));
        al.title = q.answerFile.name;
        al.href = "/api/supervisor/files/" + q.answerFile.id;
        al.target = "_blank";
        al.rel = "noopener noreferrer";
        al.setAttribute("aria-label", q.label + " 回答：" + q.answerFile.name + "（在新标签页打开）");
        cell.appendChild(al);
      } else cell.appendChild(el("span", "muted", "—"));
      row.appendChild(cell);
      row.appendChild(el("span", q.score ? "q-score" : "muted", q.score ? q.score + " / 5" : "—"));
      wrap.appendChild(row);
    });
    return wrap;
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
    item("汇总评分", overallText(a), a.score ? "score" : "");
    c.appendChild(meta);
    c.appendChild(questionTable(a));
    if (a.answerFiles && a.answerFiles.length) c.appendChild(fileRow("其他答题文件（旧数据）", a.answerFiles));
    if (a.attempt) c.appendChild(el("p", "attempt-line", attemptLine(a.attempt)));

    var act = el("div", "card-actions");
    if (a.status === "scheduled") {
      act.appendChild(btn("修改", a, function (x) { openTestDialog("edit", x); }));
      act.appendChild(btn("答题与评分", a, openScoreDialog));
      act.appendChild(btn("删除", a, askDelete, "danger"));
    } else if (a.status === "in_progress") {
      act.appendChild(btn("查看答题", a, openView));
      act.appendChild(el("span", "muted", "学生正在测试，完成后才能修改。"));
    } else if (a.status === "submitted") {
      act.appendChild(btn("查看学生答题", a, openView));
      act.appendChild(btn("答题与评分", a, openScoreDialog));
    } else {
      act.appendChild(btn("查看学生答题", a, openView));
      act.appendChild(btn("修改评分", a, openScoreDialog));
      act.appendChild(btn("重测", a, openRetakeDialog));
    }
    c.appendChild(act);
    return c;
  }

  // 过往的测试：折叠时只显示 测试时间、科目单元、评分
  var openPast = {};
  function pastItem(a) {
    var open = !!openPast[a.id];
    var wrap = el("div", "past-item" + (open ? " is-open" : ""));
    var panelId = "past-panel-" + a.id;
    var btn = el("button", "past-toggle");
    btn.type = "button";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-controls", panelId);
    btn.setAttribute("data-test-id", String(a.id));
    btn.appendChild(el("span", "p-time", fmtWall(a.scheduledWall)));
    btn.appendChild(el("span", "p-title", a.subject + " · " + a.unit));
    btn.appendChild(el("span", "p-score", a.score ? a.score + " / 5" : "—"));
    var chev = el("span", "p-chev");
    chev.setAttribute("aria-hidden", "true");
    btn.appendChild(chev);
    var panel = el("div", "past-panel");
    panel.id = panelId;
    panel.hidden = !open;
    panel.appendChild(card(a));
    btn.addEventListener("click", function () {
      open = !open;
      openPast[a.id] = open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      wrap.classList.toggle("is-open", open);
      var sec = wrap.closest("section");
      if (sec) { // 同步“全部展开/全部收起”按钮的文字
        var items = sec.querySelectorAll(".past-toggle"), tg = sec.querySelector(".group-toggle");
        if (tg) tg.textContent = Array.prototype.every.call(items, function (b) { return b.getAttribute("aria-expanded") === "true"; }) ? "全部收起" : "全部展开";
      }
    });
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    return wrap;
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

    [["将来的测试", upcoming, "还没有安排将来的测试。", true, false], ["进行中与待评分", active, "", false, false], ["过往的测试", past, "还没有过往的测试。", true, true]].forEach(function (g) {
      if (!g[1].length && !g[3]) return; // “进行中与待评分”没有内容时不显示
      var sec = el("section");
      var head = el("div", "group-head");
      head.appendChild(el("h2", "group-title", g[0] + "（" + g[1].length + "）"));
      if (g[4] && g[1].length) {
        // 过往的测试默认折叠：只显示 测试时间、科目单元、评分；展开后显示完整信息
        var allOpen = g[1].every(function (a) { return openPast[a.id]; });
        var all = el("button", "btn group-toggle", allOpen ? "全部收起" : "全部展开");
        all.type = "button";
        all.addEventListener("click", function () { g[1].forEach(function (a) { openPast[a.id] = !allOpen; }); renderLists(); });
        head.appendChild(all);
      }
      sec.appendChild(head);
      if (!g[1].length) sec.appendChild(el("p", "empty-note", g[2]));
      g[1].forEach(function (a) { sec.appendChild(g[4] ? pastItem(a) : card(a)); });
      host.appendChild(sec);
    });
  }

  /* ---------- 查看学生答题 ---------- */
  function attemptLine(at) {
    var parts = ["作答方式：" + (at.method === "typed" ? "屏幕输入" : "纸质作答")];
    parts.push("开始于 " + fmtWall(at.startedWall) + (at.early ? "（提前开始）" : ""));
    if (at.submittedAt) {
      var mins = Math.max(1, Math.round((Date.parse(at.submittedAt) - Date.parse(at.startedAt)) / 60000));
      parts.push((at.autoSubmitted ? "时间到自动提交" : "提交于 " + fmtWall(at.submittedWall)) + "，用时约 " + mins + " 分钟");
    } else parts.push("正在作答，截止 " + fmtWall(at.deadlineWall));
    var away = "离开页面 " + at.leaveCount + " 次";
    if (at.awaySeconds) away += "，共约 " + (at.awaySeconds >= 60 ? Math.round(at.awaySeconds / 60) + " 分钟" : at.awaySeconds + " 秒");
    if (at.pdfLeaves) away += "（另有 " + at.pdfLeaves + " 次是为了打开题目 PDF）";
    parts.push(away);
    return parts.join("；") + "。";
  }

  var viewing = null;
  function openView(a) {
    viewing = a;
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
        box.appendChild(el("h3", "", q.label + (q.score ? "　评分 " + q.score + " / 5" : "")));
        var link = el("a", "file-link", shortName(q.name));
        link.title = q.name;
        link.href = "/api/supervisor/files/" + q.id;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        box.appendChild(link);
        if (data.attempt) {
          if (typed) {
            box.appendChild(el("p", "muted", "学生的答案"));
            box.appendChild(el("div", "answer-text", q.answer && q.answer.trim() ? q.answer : "（没有填写）"));
          } else box.appendChild(el("p", "muted", "学生选择纸质作答，请在“答题与评分”里为这道题上传回答 PDF。"));
          if (q.answerFile) {
            var al = el("a", "file-link", "回答 PDF：" + shortName(q.answerFile.name));
            al.title = q.answerFile.name;
            al.href = "/api/supervisor/files/" + q.answerFile.id;
            al.target = "_blank";
            al.rel = "noopener noreferrer";
            box.appendChild(al);
          }
        }
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
    testForm.checks = state.students.filter(function (s) { return s.direction !== "writing"; }).map(function (s) {
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
    function sync() {
      all.checked = testForm.checks.length > 0 && testForm.checks.every(function (c) { return c.checked; });
      refreshTzNotice();
    }
    all.addEventListener("change", function () { testForm.checks.forEach(function (c) { c.checked = all.checked; }); refreshTzNotice(); });
    sync();
    fs.appendChild(list);
    box.appendChild(fs);
  }

  function refreshTzNotice() {
    var chosen = testForm.mode === "create"
      ? testForm.checks.filter(function (c) { return c.checked; }).map(function (c) { return studentById(Number(c.value)); }).filter(Boolean)
      : [currentStudent()].filter(Boolean);
    tzNotice(chosen, $("tz-hint"), $("tz-warn"));
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
    refreshTzNotice();
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
    var weights = testForm.files.weights();
    if (weights.some(function (w) { return !Number.isInteger(w) || w < 1 || w > 100; })) return showMsg("test-error", "每道题的权重必须是 1–100 的整数。");

    var duration = Number($("t-duration").value);
    if (!Number.isInteger(duration) || duration < 5 || duration > 300) return showMsg("test-error", "测试时长必须是 5–300 分钟的整数。");
    var body = { scheduledWall: date + "T" + time, subject: subject, unit: unit, unitStartDate: start, durationMinutes: duration, questionFileIds: fileIds, questionWeights: weights };
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

  /* ---------- 每题的回答 PDF 与评分 ---------- */
  var gradeForm = { assessment: null, rows: [] };

  // 单个回答 PDF 的选择器：返回 { value(): 文件 id 或 null, busy() }
  function answerPicker(host, initial, qLabel, noun, onChange) {
    noun = noun || "回答 PDF";
    clear(host);
    var current = initial ? { id: initial.id, name: initial.name } : null;
    var busy = 0;
    var line = el("div", "ans-line");
    var nameEl = el("span", "fname");
    var rm = el("button", "btn", "－");
    rm.type = "button";
    rm.title = "移除";
    rm.setAttribute("aria-label", "移除 " + qLabel + " 的" + noun);
    var picker = el("label", "picker-btn", "＋");
    var input = el("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.setAttribute("aria-label", "选择 " + qLabel + " 的" + noun);
    picker.appendChild(input);
    var note = el("p", "upload-note");
    note.setAttribute("role", "status");
    function draw() {
      nameEl.textContent = current ? shortName(current.name) : "";
      nameEl.title = current ? current.name : "";
      if (onChange) onChange(current);
      nameEl.className = "fname";
      rm.hidden = !current;
      picker.title = (current ? "替换" : "上传") + noun;
    }
    rm.addEventListener("click", function () { current = null; draw(); });
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      input.value = "";
      if (!f) return;
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { note.textContent = "“" + f.name + "”不是 PDF 文件。"; return; }
      if (f.size > MAX_BYTES) { note.textContent = "“" + f.name + "”超过 20MB。"; return; }
      busy += 1;
      note.textContent = "正在上传 " + f.name + " …";
      request("POST", "/api/supervisor/files", undefined, { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(f.name) }, f)
        .then(function (data) { current = { id: data.file.id, name: data.file.name }; note.textContent = ""; draw(); })
        .catch(function (e) { note.textContent = e.message; })
        .then(function () { busy -= 1; });
    });
    line.appendChild(nameEl);
    line.appendChild(rm);
    line.appendChild(picker);
    host.appendChild(line);
    host.appendChild(note);
    draw();
    return { value: function () { return current ? current.id : null; }, busy: function () { return busy > 0; } };
  }

  /* ---------- AI 判分 ---------- */
  function aiErr(e) { return e && e.message ? e.message : "AI 评分失败，请稍后再试。"; }
  function fmtDateTime(iso) { try { return new Date(iso).toLocaleString("zh-CN", { hour12: false }); } catch (e) { return iso; } }

  function aiBlock(q, row) {
    var box = el("div", "ai-box");
    var line = el("div", "ai-line");
    var btn = el("button", "btn", "请求 AI 评分");
    btn.type = "button";
    btn.setAttribute("aria-label", "请求 AI 评分：" + q.label);
    var status = el("p", "ai-status");
    status.setAttribute("role", "status");
    line.appendChild(btn);
    box.appendChild(line);
    box.appendChild(status);
    var out = el("div", "ai-result");
    box.appendChild(out);

    function hasText() { return !!(q.answerText && q.answerText.trim()); }
    // 学生答案有两种形式时，优先提交文字答案
    function source() { return hasText() ? "text" : row.answer.value() ? "pdf" : null; }
    function bad(text) { status.textContent = text; status.className = "ai-status bad"; }
    function drawResult(r) {
      clear(out);
      if (!r) return;
      out.appendChild(el("p", "ai-score", "AI 建议评分：" + r.score + " / 5"));
      out.appendChild(el("p", "ai-meta", "模型 " + r.model + "　·　依据：" + (r.source === "pdf" ? "学生 PDF 答案" : "学生文字答案") + "　·　" + fmtDateTime(r.createdAt)));
      out.appendChild(el("div", "answer-text", r.feedback || "（AI 没有给出文字反馈）"));
      var adopt = el("button", "btn primary", "采用此评分（" + r.score + "）");
      adopt.type = "button";
      adopt.setAttribute("aria-label", "采用 " + q.label + " 的 AI 评分 " + r.score);
      adopt.addEventListener("click", function () { row.score.set(r.score); status.className = "ai-status"; status.textContent = "已填入 " + q.label + " 的人工评分 " + r.score + "，点下面的“保存”后生效。"; });
      out.appendChild(adopt);
    }
    var running = false;
    function submit() {
      var src = source();
      running = true;
      btn.disabled = true;
      status.className = "ai-status";
      status.textContent = "AI 评分中…（通常需要几十秒到一两分钟，请不要关闭页面）";
      return api("POST", "/api/supervisor/assessments/" + gradeForm.assessment.id + "/ai-score", {
        questionFileId: q.id, answerSource: src, answerFileId: src === "pdf" ? row.answer.value() : undefined, rubricFileId: row.rubric.value()
      }).then(function (d) {
        drawResult(d.result);
        status.textContent = "AI 已评分：" + d.result.score + " / 5（建议值，需要你确认采用）。";
        return d.result;
      }).catch(function (e) { bad(aiErr(e)); return null; })
        .then(function (r) { running = false; btn.disabled = false; return r; });
    }
    // 先检查材料是否齐备；齐备后（单题点击时）让督导者确认再提交。asBatch：批量请求时不再逐题确认
    function run(asBatch) {
      if (running) return Promise.resolve();
      status.className = "ai-status";
      status.textContent = "";
      var missing = [];
      if (!source()) missing.push("学生答案（文字答案或 PDF 答案）");
      if (!row.rubric.value()) missing.push("评分标准 PDF");
      if (missing.length) { bad("需要补充：" + missing.join("、") + "。"); return Promise.resolve(); }
      if (row.rubric.busy() || row.answer.busy()) { bad("文件还在上传，请稍等。"); return Promise.resolve(); }
      if (asBatch === true) return submit();
      confirmDialog("将把 " + q.label + " 的题目、学生" + (source() === "text" ? "文字答案" : "PDF 答案") + "和评分标准发送给 AI 评分，是否确认提交？", "确认提交", function () { submit(); });
      return Promise.resolve();
    }
    btn.addEventListener("click", function () { run(); });
    drawResult(q.ai);
    return { el: box, refresh: function () {}, run: function () { return run(true); }, canRun: function () { return !!row.rubric.value() && !!source(); } };
  }

  // 人工评分：横向的 1–5 标签（单选），可清除
  function scoreControl(q, onChange) {
    var wrap = el("div", "score-radios");
    wrap.setAttribute("role", "radiogroup");
    wrap.setAttribute("aria-label", q.label + " 人工评分");
    var radios = [];
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var l = el("label", "score-opt");
        var r = el("input");
        r.type = "radio";
        r.name = "score-" + q.id;
        r.value = String(n);
        r.setAttribute("aria-label", q.label + " 评分 " + n);
        r.addEventListener("change", function () { sync(); onChange(); });
        l.appendChild(r);
        l.appendChild(el("span", "", String(n)));
        wrap.appendChild(l);
        radios.push(r);
      })(i);
    }
    var clearBtn = el("button", "btn score-clear", "清除");
    clearBtn.type = "button";
    clearBtn.setAttribute("aria-label", "清除 " + q.label + " 的人工评分");
    clearBtn.addEventListener("click", function () { api_set(null); onChange(); });
    wrap.appendChild(clearBtn);
    function get() { var c = radios.filter(function (r) { return r.checked; })[0]; return c ? Number(c.value) : null; }
    function api_set(v) { radios.forEach(function (r) { r.checked = v !== null && Number(r.value) === v; }); sync(); }
    function sync() { clearBtn.hidden = get() === null; }
    api_set(q.score ? q.score : null);
    return { el: wrap, get: get, set: function (v) { api_set(v); onChange(); } };
  }

  function summarizeScores(scores, weights) { // 与服务器 server/scoring.js 的公式一致，只用于预览
    var num = 0, den = 0, scored = 0, n = scores.length;
    scores.forEach(function (s, i) {
      var w = Number.isInteger(weights[i]) && weights[i] >= 1 && weights[i] <= 100 ? weights[i] : 1;
      if (s !== null) { num += w * s; den += w; scored += 1; }
    });
    return { scored: scored, total: n, avg: den ? num / den : null, overall: n > 0 && scored === n ? Math.floor((2 * num + den) / (2 * den)) : null };
  }
  function updateOverall() {
    var scores = gradeForm.rows.map(function (r) { return r.score.get(); });
    var weights = gradeForm.rows.map(function (r) { return r.weightValue; });
    var s = summarizeScores(scores, weights);
    $("grade-overall").textContent = s.overall !== null
      ? "汇总评分：" + s.overall + " / 5（加权平均 " + (Math.round(s.avg * 100) / 100) + "）。保存后这场测试的状态为“已评分”。"
      : "汇总评分：还不能计算（已评 " + s.scored + " / " + s.total + " 题）。";
  }

  function openScoreDialog(a) {
    gradeForm.assessment = a;
    gradeForm.rows = [];
    showMsg("score-error", "");
    $("score-summary").textContent = a.subject + " · " + a.unit + "　" + fmtWall(a.scheduledWall);
    $("ai-all-msg").hidden = true;
    var host = $("grade-rows");
    clear(host);
    a.questionFiles.forEach(function (q) {
      var box = el("div", "grade-row");
      function section(title) {
        var sec = el("div", "grade-sec");
        sec.appendChild(el("div", "sec-title", title));
        var body = el("div", "sec-body");
        sec.appendChild(body);
        box.appendChild(sec);
        return body;
      }
      box.appendChild(el("strong", "q-label", q.label));
      var row = { q: q };
      var aiPart = null;
      var onFileChange = function () { if (aiPart) aiPart.refresh(); };

      // 1 问题
      var qb = section("问题");
      var ql = el("a", "file-link", shortName(q.name));
      ql.href = "/api/supervisor/files/" + q.id;
      ql.title = q.name;
      ql.target = "_blank";
      ql.rel = "noopener noreferrer";
      ql.setAttribute("aria-label", q.label + " 问题：" + q.name + "（在新标签页打开）");
      qb.appendChild(ql);

      // 2 学生文字答案（只读，显示最上面 3 行，可滚动）
      var tb = section("学生文字答案");
      var ta = el("textarea", "answer-ta");
      ta.readOnly = true;
      ta.rows = 3;
      ta.value = q.answerText || "";
      ta.setAttribute("aria-label", q.label + " 学生文字答案");
      tb.appendChild(ta);

      // 3 学生 PDF 答案
      var pb = section("学生 PDF 答案");
      var picker = answerPicker(pb, q.answerFile, q.label, "回答 PDF", onFileChange);

      // 4 评分标准
      var rb = section("评分标准");
      var rubric = answerPicker(rb, q.rubricFile, q.label, "判分标准 PDF", onFileChange);
      row.answer = picker;
      row.rubric = rubric;

      // 5 人工评分
      var mb = section("人工评分");
      row.score = scoreControl(q, updateOverall);
      mb.appendChild(row.score.el);

      row.picker = picker; row.weightValue = q.weight || 1;
      // 6 AI 评分
      var ab = section("AI 评分");
      aiPart = aiBlock(q, row);
      row.ai = aiPart;
      ab.appendChild(aiPart.el);
      host.appendChild(box);
      gradeForm.rows.push(row);
    });
    updateOverall();
    openDialog($("score-dialog"));
    var first = host.querySelector("input[type=radio]");
    if (first) first.focus();
  }

  $("ai-all-btn").addEventListener("click", function () {
    var msg = $("ai-all-msg");
    var todo = gradeForm.rows.filter(function (r) { return r.ai.canRun(); });
    var skipped = gradeForm.rows.length - todo.length;
    msg.hidden = false;
    msg.className = "msg";
    if (!todo.length) { msg.textContent = "没有可以请求 AI 评分的题目：每道题需要判分标准 PDF，以及学生的回答（文字或回答 PDF）。"; msg.className = "msg error"; return; }
    $("ai-all-btn").disabled = true;
    var done = 0, ok = 0;
    todo.reduce(function (p, r) {
      return p.then(function () {
        msg.textContent = "AI 评分中：第 " + (done + 1) + " / " + todo.length + " 题（" + r.q.label + "）…";
        return r.ai.run().then(function (res) { done += 1; if (res) ok += 1; });
      });
    }, Promise.resolve()).then(function () {
      msg.textContent = "完成：" + ok + " / " + todo.length + " 题已得到 AI 建议评分" + (skipped ? "；" + skipped + " 题缺少判分标准或学生回答，已跳过" : "") + "。请逐题查看并点“采用此评分”，再保存。";
      msg.className = ok === todo.length ? "msg ok" : "msg error";
      $("ai-all-btn").disabled = false;
    });
  });

  $("score-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("score-error", "");
    if (gradeForm.rows.some(function (r) { return r.picker.busy() || r.rubric.busy(); })) return showMsg("score-error", "文件还在上传，请稍等。");
    var a = gradeForm.assessment;
    var questions = gradeForm.rows.map(function (r) {
      return { questionFileId: r.q.id, answerFileId: r.picker.value(), rubricFileId: r.rubric.value(), score: r.score.get(), weight: r.weightValue };
    });
    $("score-submit").disabled = true;
    api("PATCH", "/api/supervisor/assessments/" + a.id, { questions: questions }).then(function (data) {
      closeDialog($("score-dialog"));
      return loadAssessments().then(function () { setStatus(data.assessment.status === "graded" ? "已保存，汇总评分 " + data.assessment.score + " / 5。" : "已保存。"); });
    }).catch(function (err) { showMsg("score-error", err.message); })
      .then(function () { $("score-submit").disabled = false; });
  });

  /* ---------- 重测 ---------- */
  var retakeFor = null;
  function openRetakeDialog(a) {
    retakeFor = a;
    showMsg("retake-error", "");
    $("retake-form").reset();
    tzNotice([currentStudent()].filter(Boolean), $("r-tz-hint"), $("r-tz-warn"));
    $("retake-summary").textContent = "原测试：" + a.subject + " · " + a.unit + "，" + fmtWall(a.scheduledWall) + "，汇总评分 " + a.score + " / 5";
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
  api("GET", "/api/me").then(function (me) {
    state.me = me;
    $("whoami").textContent = "当前账号：" + me.username + "（" + me.tzLabel.zh.replace("，", "，时区：") + "）";
    refreshTzNotice();
  }).catch(function () { /* 忽略 */ });
  api("GET", "/api/supervisor/students").then(function (data) {
    state.students = data.students;
    renderStudents();
    if (state.students.length) return selectStudent(state.students[0].id);
    $("student-sub").textContent = "";
  }).catch(function (e) { setStatus(e.message, true); });
})();
