/* 后台管理：账号管理。所有来自服务器的文字都用 textContent 显示，不拼接 HTML。 */
(function () {
  "use strict";

  var TYPE_LABEL = { student: "学生", supervisor: "督导者", support: "客服" };
  var state = { accounts: [], filter: "", search: "", timezones: [], defaultTz: "America/Vancouver" };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------- 请求 ---------- */
  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        if (res.status === 401) { window.location.href = "/login"; }
        var err = new Error(data.message || "操作失败，请稍后再试。");
        err.code = data.error;
        err.status = res.status;
        throw err;
      });
    }, function () { throw new Error("网络出错，请稍后再试。"); });
  }

  function setStatus(text, isError) {
    var s = $("status");
    s.textContent = text || "";
    s.className = "status" + (isError ? " error" : "");
  }
  function showMsg(id, text) { var m = $(id); m.textContent = text; m.hidden = !text; }

  /* ---------- 列表 ---------- */
  function nameOf(id) {
    for (var i = 0; i < state.accounts.length; i++) if (state.accounts[i].id === id) return state.accounts[i].username;
    return "（已删除）";
  }

  function linkText(a) {
    if (a.type === "student") {
      var t = a.subject ? "学习科目：" + a.subject + "（" + DIRECTION_LABEL[a.direction] + "）" : "学习科目：未设置";
      if (a.direction === "writing") t += "　年级：" + (a.gradeLabel ? a.gradeLabel.zh : "未设置");
      return t;
    }
    if (a.type === "supervisor") return a.studentIds.length ? "关联学生：" + a.studentIds.map(nameOf).join("、") : "未关联学生";
    return a.supervisorIds.length ? "服务督导者：" + a.supervisorIds.map(nameOf).join("、") : "未关联督导者";
  }

  function visible() {
    var q = state.search.trim().toLowerCase();
    return state.accounts.filter(function (a) {
      return (!state.filter || a.type === state.filter) && (!q || a.username.toLowerCase().indexOf(q) >= 0);
    });
  }

  var DIRECTION_LABEL = { apdemo: "AP 自学", writing: "写作" };

  /* ---------- 科目管理 ---------- */
  function renderSubjects() {
    var body = $("subject-rows");
    clear(body);
    (state.subjects || []).forEach(function (s) {
      var tr = el("tr", s.disabled ? "is-disabled" : "");
      tr.appendChild(el("td", "name", s.name));
      tr.appendChild(el("td", "", DIRECTION_LABEL[s.direction]));
      var st = el("td");
      st.appendChild(el("span", "badge" + (s.disabled ? " off" : ""), s.disabled ? "已停用" : "使用中"));
      tr.appendChild(st);
      var act = el("td", "actions");
      var b = el("button", "btn", s.disabled ? "启用" : "停用");
      b.type = "button";
      b.setAttribute("aria-label", (s.disabled ? "启用科目 " : "停用科目 ") + s.name);
      b.addEventListener("click", function () {
        api("POST", "/api/admin/subjects/" + s.id + "/" + (s.disabled ? "enable" : "disable")).then(function (d) { state.subjects = d.subjects; renderSubjects(); })
          .catch(function (err) { showMsg("subject-msg", err.message); });
      });
      act.appendChild(b);
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }
  $("subject-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("subject-msg", "");
    var name = $("subject-name").value.trim();
    if (!name) return showMsg("subject-msg", "请输入科目名称。");
    api("POST", "/api/admin/subjects", { name: name, direction: $("subject-direction").value }).then(function (d) {
      state.subjects = d.subjects;
      $("subject-name").value = "";
      renderSubjects();
      showMsg("subject-msg", "已添加科目：" + name + "。", "ok");
    }).catch(function (err) { showMsg("subject-msg", err.message); });
  });
  function fillGradeSelect(sel, current) {
    clear(sel);
    var blank = el("option", "", "请选择…");
    blank.value = "";
    sel.appendChild(blank);
    (state.grades || []).forEach(function (g) {
      var o = el("option", "", g.label.zh);
      o.value = g.code;
      sel.appendChild(o);
    });
    sel.value = current || "";
  }
  function isWritingSubject(name) {
    return (state.subjects || []).some(function (s) { return s.name === name && s.direction === "writing"; });
  }
  function syncCreateFields() {
    var student = $("new-type").value === "student";
    $("new-subject-field").hidden = !student;
    var writing = student && isWritingSubject($("new-subject").value);
    $("new-grade-field").hidden = !writing;
    $("new-consent-field").hidden = !writing;
  }
  function fillSubjectSelect(sel, current) {
    clear(sel);
    var blank = el("option", "", "请选择…");
    blank.value = "";
    sel.appendChild(blank);
    (state.subjects || []).filter(function (s) { return !s.disabled || s.name === current; }).forEach(function (s) {
      var o = el("option", "", s.name + "（" + DIRECTION_LABEL[s.direction] + "）");
      o.value = s.name;
      sel.appendChild(o);
    });
    sel.value = current || "";
  }

  function actionBtn(label, a, handler, cls) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.setAttribute("aria-label", label + " " + a.username);
    b.addEventListener("click", function () { handler(a, b); });
    return b;
  }

  function render() {
    var rows = $("rows");
    clear(rows);
    var list = visible();
    if (!list.length) {
      var tr = el("tr");
      var td = el("td", "empty", state.accounts.length ? "没有符合条件的账号。" : "还没有账号，点击“新建账号”开始。");
      td.colSpan = 6;
      tr.appendChild(td);
      rows.appendChild(tr);
      return;
    }
    list.forEach(function (a) {
      var tr = el("tr", a.disabled ? "is-disabled" : "");
      tr.appendChild(el("td", "name", a.username));
      tr.appendChild(el("td", "type", TYPE_LABEL[a.type]));
      tr.appendChild(el("td", "tz", a.tzLabel ? a.tzLabel.zh : a.timezone));
      var st = el("td");
      st.appendChild(el("span", "badge" + (a.disabled ? " off" : ""), a.disabled ? "已停用" : "正常"));
      if (a.mustChangePassword) st.appendChild(el("span", "badge warn", "未改初始密码"));
      tr.appendChild(st);
      tr.appendChild(el("td", "links", linkText(a)));
      var act = el("td", "actions");
      act.appendChild(actionBtn("编辑", a, openEdit));
      act.appendChild(actionBtn("重置密码", a, askReset));
      act.appendChild(actionBtn(a.disabled ? "启用" : "停用", a, a.disabled ? doEnable : askDisable));
      if (a.disabled) act.appendChild(actionBtn("删除", a, askDelete, "danger"));
      tr.appendChild(act);
      rows.appendChild(tr);
    });
  }

  function load() {
    return api("GET", "/api/admin/accounts").then(function (data) {
      state.accounts = data.accounts;
      state.timezones = data.timezones || [];
      state.defaultTz = data.defaultTimezone || state.defaultTz;
      state.subjects = data.subjects || [];
      state.grades = data.grades || [];
      renderSubjects();
      setStatus("共 " + data.accounts.length + " 个账号。");
      render();
    }).catch(function (e) { setStatus(e.message, true); });
  }

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
    $("confirm-ok").textContent = okLabel;
    var ok = $("confirm-ok");
    var fresh = ok.cloneNode(true);
    ok.parentNode.replaceChild(fresh, ok);
    fresh.addEventListener("click", function () { closeDialog($("confirm-dialog")); onOk(); });
    openDialog($("confirm-dialog"));
  }

  function showSecret(username, password) {
    $("secret-username").textContent = username;
    $("secret-password").textContent = password;
    $("copy-status").textContent = "";
    openDialog($("secret-dialog"));
  }
  $("copy-btn").addEventListener("click", function () {
    var text = $("secret-password").textContent;
    var done = function (ok) { $("copy-status").textContent = ok ? "已复制。" : "无法自动复制，请手动选中并复制上面的密码。"; };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    } catch (e) { done(false); }
  });
  // 关闭密码窗口后清掉页面里的密码
  $("secret-dialog").addEventListener("close", function () { $("secret-password").textContent = ""; });

  function fillTzSelect(sel, value) {
    clear(sel);
    state.timezones.forEach(function (z) {
      var o = el("option", "", z.label.zh + "　" + z.id);
      o.value = z.id;
      sel.appendChild(o);
    });
    sel.value = value;
    if (sel.value !== value && state.timezones.length) sel.value = state.timezones[0].id;
  }

  /* ---------- 新建 ---------- */
  $("new-btn").addEventListener("click", function () {
    remember();
    $("create-form").reset();
    fillTzSelect($("new-tz"), state.defaultTz);
    fillSubjectSelect($("new-subject"), "");
    fillGradeSelect($("new-grade"), "");
    $("new-consent").checked = false;
    syncCreateFields();
    showMsg("create-error", "");
    openDialog($("create-dialog"));
    $("new-username").focus();
  });
  $("new-type").addEventListener("change", syncCreateFields);
  $("new-subject").addEventListener("change", syncCreateFields);
  $("create-form").addEventListener("submit", function (e) {
    e.preventDefault();
    showMsg("create-error", "");
    var username = $("new-username").value.trim();
    var type = $("new-type").value;
    if (!username) return showMsg("create-error", "请输入账号名。");
    if (!type) return showMsg("create-error", "请选择账号类型。");
    var payload = { username: username, type: type, timezone: $("new-tz").value };
    if (type === "student") {
      if (!$("new-subject").value) return showMsg("create-error", "请为学生选择学习科目。");
      payload.subject = $("new-subject").value;
      if (isWritingSubject(payload.subject)) {
        if (!$("new-grade").value) return showMsg("create-error", "请选择学生的年级。");
        if (!$("new-consent").checked) return showMsg("create-error", "请确认已获得监护人同意。");
        payload.grade = $("new-grade").value;
        payload.consent = true;
      }
    }
    $("create-submit").disabled = true;
    api("POST", "/api/admin/accounts", payload).then(function (data) {
      closeDialog($("create-dialog"));
      lastTrigger = $("new-btn");
      showSecret(data.account.username, data.initialPassword);
      return load();
    }).catch(function (err) { showMsg("create-error", err.message); })
      .then(function () { $("create-submit").disabled = false; });
  });

  /* ---------- 编辑 ---------- */
  var editing = null;

  function checkList(options, selected, emptyText) {
    var wrap = el("div");
    var filter = el("input", "filter-input");
    filter.type = "search";
    filter.placeholder = "搜索";
    filter.setAttribute("aria-label", "在列表中搜索");
    wrap.appendChild(filter);
    var box = el("div", "check-list");
    var items = [];
    if (!options.length) box.appendChild(el("p", "empty muted", emptyText));
    options.forEach(function (o) {
      var label = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.value = String(o.id);
      cb.checked = selected.indexOf(o.id) >= 0;
      label.appendChild(cb);
      label.appendChild(el("span", "", o.username));
      if (o.disabled) label.appendChild(el("span", "badge off", "已停用"));
      box.appendChild(label);
      items.push({ label: label, name: o.username.toLowerCase() });
    });
    filter.addEventListener("input", function () {
      var q = filter.value.trim().toLowerCase();
      items.forEach(function (it) { it.label.hidden = q && it.name.indexOf(q) < 0; });
    });
    wrap.appendChild(box);
    return wrap;
  }

  function openEdit(a) {
    remember();
    editing = a;
    showMsg("edit-error", "");
    $("edit-username").textContent = a.username;
    $("edit-type").textContent = TYPE_LABEL[a.type];
    fillTzSelect($("edit-tz"), a.timezone);
    $("edit-tz-hint").textContent = a.type === "student" ? "修改学生的时区后，他还没开始的测试会保持“当地时间”不变（例如当地下午 3 点），对应的精确时刻随之改变；已开始或已完成的测试不变。" : "";
    var host = $("edit-fields");
    clear(host);
    if (a.type === "student") {
      var f = el("div", "field");
      if (a.subjectLocked) {
        f.appendChild(el("p", "label", "学习科目"));
        f.appendChild(el("p", "", a.subject + "（" + DIRECTION_LABEL[a.direction] + "）"));
        f.appendChild(el("span", "hint", "学习科目建立后不能修改。要学习其他科目，请新建一个学生账号。"));
      } else {
        var l = el("label", "", "学习科目");
        l.htmlFor = "edit-subject";
        var inp = el("select");
        inp.id = "edit-subject";
        fillSubjectSelect(inp, "");
        f.appendChild(l);
        f.appendChild(inp);
        f.appendChild(el("span", "hint", "这个学生还没有学习科目。设定后不能再修改。"));
      }
      host.appendChild(f);
      if (a.direction === "writing") {
        var gf = el("div", "field");
        var gl = el("label", "", "年级");
        gl.htmlFor = "edit-grade";
        var gs = el("select");
        gs.id = "edit-grade";
        fillGradeSelect(gs, a.grade);
        gf.appendChild(gl);
        gf.appendChild(gs);
        gf.appendChild(el("span", "hint", "升年级时在这里修改。已有作文记录里保存的是当天的年级，不受影响。"));
        host.appendChild(gf);
        host.appendChild(el("p", "hint", a.consentAt ? "监护人同意：已确认（" + a.consentAt.slice(0, 10) + "，由 " + a.consentBy + " 记录）。" : "监护人同意：没有记录。"));
      }
    } else {
      var isSup = a.type === "supervisor";
      var fs = el("fieldset");
      fs.appendChild(el("legend", "", isSup ? "关联的学生（可多选）" : "服务的督导者（可多选）"));
      var options = state.accounts.filter(function (x) { return x.type === (isSup ? "student" : "supervisor"); });
      fs.appendChild(checkList(options, isSup ? a.studentIds : a.supervisorIds, isSup ? "还没有学生账号。" : "还没有督导者账号。"));
      host.appendChild(fs);
    }
    openDialog($("edit-dialog"));
    var first = host.querySelector("input");
    if (first) first.focus();
  }

  $("edit-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!editing) return;
    showMsg("edit-error", "");
    var body;
    if (editing.type === "student") {
      body = $("edit-subject") && $("edit-subject").value ? { subject: $("edit-subject").value } : {};
      if ($("edit-grade")) {
        if (!$("edit-grade").value) return showMsg("edit-error", "请选择年级。");
        body.grade = $("edit-grade").value;
      }
    }
    else {
      var ids = Array.prototype.map.call($("edit-fields").querySelectorAll('input[type="checkbox"]:checked'), function (c) { return Number(c.value); });
      body = editing.type === "supervisor" ? { studentIds: ids } : { supervisorIds: ids };
    }
    body.timezone = $("edit-tz").value;
    $("edit-submit").disabled = true;
    api("PATCH", "/api/admin/accounts/" + editing.id, body).then(function () {
      closeDialog($("edit-dialog"));
      setStatus("已保存。");
      return load().then(function () { setStatus("已保存。"); });
    }).catch(function (err) { showMsg("edit-error", err.message); })
      .then(function () { $("edit-submit").disabled = false; });
  });

  /* ---------- 重置密码 / 停用 / 启用 / 删除 ---------- */
  function askReset(a) {
    remember();
    confirmDialog("重置“" + a.username + "”的密码？将生成新的初始密码，旧密码立即失效，对方需要重新登录并修改密码。", "重置密码", function () {
      api("POST", "/api/admin/accounts/" + a.id + "/reset-password").then(function (data) {
        showSecret(a.username, data.initialPassword);
        return load();
      }).catch(function (e) { setStatus(e.message, true); });
    });
  }
  function askDisable(a) {
    remember();
    confirmDialog("停用“" + a.username + "”？停用后该账号立即退出登录且不能再登录，可以随时重新启用。", "停用", function () {
      api("POST", "/api/admin/accounts/" + a.id + "/disable").then(load).then(function () { setStatus("已停用“" + a.username + "”。"); })
        .catch(function (e) { setStatus(e.message, true); });
    });
  }
  function doEnable(a) {
    api("POST", "/api/admin/accounts/" + a.id + "/enable").then(load).then(function () { setStatus("已启用“" + a.username + "”。"); })
      .catch(function (e) { setStatus(e.message, true); });
  }
  function askDelete(a) {
    remember();
    confirmDialog("彻底删除“" + a.username + "”？账号及它的所有关联关系都会被删除，无法恢复。", "彻底删除", function () {
      api("DELETE", "/api/admin/accounts/" + a.id).then(load).then(function () { setStatus("已删除“" + a.username + "”。"); })
        .catch(function (e) { setStatus(e.message, true); });
    });
  }

  /* ---------- 筛选、搜索、当前用户 ---------- */
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () {
      state.filter = b.getAttribute("data-filter");
      document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-pressed", t === b ? "true" : "false"); });
      render();
    });
  });
  $("search").addEventListener("input", function () { state.search = $("search").value; render(); });

  api("GET", "/api/me").then(function (me) { $("whoami").textContent = "当前管理员：" + me.username + "（" + me.tzLabel.zh.replace("，", "，时区：") + "）"; }).catch(function () { /* 忽略 */ });
  load();
})();
