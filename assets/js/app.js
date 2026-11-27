/* 页面逻辑：只通过 window.APApi 取数；不使用 innerHTML 拼接数据。 */
(function () {
  "use strict";
  var i18n = window.APi18n;
  var api = window.APApi;
  var t = i18n.t;
  var pick = i18n.pick;

  var YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
  var state = {
    progress: { status: "loading" },
    sites: { status: "loading" },
    videos: { status: "loading" },
    qa: { status: "loading" }
  };
  state.user = null;

  /* ---------- 小工具 ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function body(id) { return document.getElementById(id); }
  function errorNode() {
    var p = el("p", "module-error", t("error.module"));
    p.setAttribute("role", "status");
    return p;
  }
  // 包一层：任何渲染异常只影响该模块
  function safeRender(id, fn) {
    var host = body(id);
    if (!host) return;
    try {
      clear(host);
      var s = state[id.replace("-body", "")];
      if (s.status === "loading") host.appendChild(el("p", "muted", t("common.loading")));
      else if (s.status === "error") host.appendChild(errorNode());
      else fn(host, s.data);
    } catch (e) {
      clear(host);
      host.appendChild(errorNode());
    }
  }

  /* ---------- 进度和测试（主模块，纯展示） ---------- */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // 取"数据里写明的当地时间"（ISO 字符串自带偏移）；若不是带偏移的格式，再用 Intl + 时区换算。
  // 原因：用户浏览器的时区库版本不一，直接换算可能与数据里写的当地时间差 1 小时（需求方确认温哥华当前为 UTC-07:00）。
  function wallClock(iso, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(iso);
    if (m && !/Z$/.test(iso)) {
      return { year: m[1], month: Number(m[2]), day: Number(m[3]), hour24: Number(m[4]), minute: m[5] };
    }
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(iso));
    var p = {};
    parts.forEach(function (x) { p[x.type] = x.value; });
    return { year: p.year, month: Number(p.month), day: Number(p.day), hour24: Number(p.hour) % 24, minute: p.minute };
  }

  function formatDate(iso, tz, lang) {
    var w = wallClock(iso, tz);
    var h12 = w.hour24 % 12 === 0 ? 12 : w.hour24 % 12;
    var clock = h12 + ":" + w.minute + " " + (w.hour24 < 12 ? "AM" : "PM");
    if (lang === "zh") {
      return w.year + "年" + w.month + "月" + w.day + "日 " + clock;
    }
    return MONTHS[w.month - 1] + " " + w.day + ", " + w.year + ", " + clock;
  }

  function statusText(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    if (!(diff > 0)) return { ended: true, text: t("progress.ready") };
    var mins = Math.floor(diff / 60000);
    var days = Math.floor(mins / 1440);
    var hours = Math.floor((mins % 1440) / 60);
    var m = mins % 60;
    if (days >= 1) return { ended: false, text: t("progress.countdown.dh", { d: days, h: hours }) };
    if (hours >= 1) return { ended: false, text: t("progress.countdown.hm", { h: hours, m: m }) };
    return { ended: false, text: t("progress.countdown.m", { m: Math.max(m, 1) }) };
  }

  function renderProgress() {
    safeRender("progress-body", function (host, d) {
      var prog = d.progress;
      var asm = d.assessment;
      var running0 = !!(asm && asm.status === "in_progress");
      document.body.classList.toggle("exam-active", running0);
      if (running0) { var banner = el("p", "exam-banner", t("exam.banner")); banner.setAttribute("role", "status"); host.appendChild(banner); }
      var wrap = el("div", "progress-layout");

      var left = el("div", "progress-main");
      var cur = el("div", "kv");
      cur.appendChild(el("div", "kv-label", t("progress.current")));
      var curText;
      if (prog.subject && prog.unit) curText = t("progress.subjectUnit", { subject: prog.subject, unit: prog.unit });
      else if (prog.subject) curText = prog.subject;
      else curText = t("progress.noSubject");
      cur.appendChild(el("div", "kv-value current-text", curText));
      left.appendChild(cur);

      if (prog.hasAssessment && prog.percent !== null) {
        var pct = Math.max(0, Math.min(100, Math.round(Number(prog.percent) || 0)));
        var pw = el("div", "percent-wrap");
        var head = el("div", "percent-head");
        head.appendChild(el("span", "kv-label", t("progress.percent")));
        head.appendChild(el("span", "percent-num", pct + "%"));
        pw.appendChild(head);
        var bar = el("div", "bar");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(pct));
        bar.setAttribute("aria-label", t("progress.percent"));
        var fill = el("div", "bar-fill");
        fill.style.width = pct + "%"; // CSSOM 赋值，不违反 style-src 'self'
        bar.appendChild(fill);
        pw.appendChild(bar);
        left.appendChild(pw);
      }
      wrap.appendChild(left);

      var right = el("div", "assessment");
      right.appendChild(el("div", "kv-label", t("progress.assessmentTime")));
      if (asm) {
        right.appendChild(el("div", "assessment-time", formatDate(asm.scheduledAt, asm.timezone, i18n.getLang())));
        var running = asm.status === "in_progress";
        var st = statusText(asm.scheduledAt);
        right.appendChild(el("div", "status-badge " + (running || st.ended ? "is-ready" : "is-upcoming"), running ? t("progress.inProgress") : st.text));
      } else {
        right.appendChild(el("div", "assessment-time", t("progress.noAssessment")));
      }
      var acts = el("div", "assessment-actions");
      if (asm && asm.status === "in_progress") {
        var cont = el("a", "card-btn primary", t("tests.resume"));
        cont.href = "/apdemo/exam?id=" + asm.id;
        acts.appendChild(cont);
      } else if (asm && asm.status === "scheduled") {
        var early = Date.now() < Date.parse(asm.scheduledAt);
        var go = el("button", "card-btn primary", t(early ? "tests.startNow" : "tests.start"));
        go.type = "button";
        go.id = "start-btn";
        go.addEventListener("click", function () { startFlow(asm); });
        acts.appendChild(go);
      }
      var all = el("button", "card-btn", t("tests.open"));
      all.type = "button";
      all.id = "all-tests-btn";
      all.addEventListener("click", openTests);
      acts.appendChild(all);
      right.appendChild(acts);
      wrap.appendChild(right);
      host.appendChild(wrap);
    });
  }

  /* ---------- 关联网站（页面底部，只显示网站名与链接） ---------- */
  function renderSites() {
    safeRender("sites-body", function (host, items) {
      var ul = el("ul", "refs-list");
      items.forEach(function (s) {
        var li = el("li");
        var a = el("a", "ref-link");
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("data-site-id", s.id);
        a.appendChild(el("span", "ref-name", pick(s.name)));
        li.appendChild(a);
        ul.appendChild(li);
      });
      host.appendChild(ul);
    });
  }

  /* ---------- 模态窗口（登录提示、视频） ---------- */
  var modal = { open: false, kind: null, restore: null, trigger: null, rebuild: null, build: null };

  function pageRoot() { return document.getElementById("page"); }
  function modalEls() {
    return {
      root: body("modal"), dialog: body("modal-dialog"), title: body("modal-title"),
      close: body("modal-close"), content: body("modal-body")
    };
  }
  function focusables() {
    var m = modalEls();
    return Array.prototype.filter.call(
      m.dialog.querySelectorAll('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.hidden; }
    );
  }

  function openModal(opts) {
    var m = modalEls();
    modal.kind = opts.kind;
    modal.restore = opts.restore;
    modal.trigger = document.activeElement;
    modal.rebuild = opts.rebuild;
    modal.build = opts.build || null;
    var built = opts.build ? opts.build() : { title: opts.title, content: opts.content };
    m.dialog.classList.toggle("modal-wide", !!opts.wide);
    m.title.textContent = built.title;
    clear(m.content);
    m.content.appendChild(built.content);
    m.root.hidden = false;
    pageRoot().inert = true;
    pageRoot().setAttribute("aria-hidden", "true");
    document.body.classList.add("modal-open");
    modal.open = true;
    m.close.focus();
  }

  function closeModal() {
    if (!modal.open) return;
    var m = modalEls();
    clear(m.content); // 移除 iframe，停止播放
    m.root.hidden = true;
    pageRoot().inert = false;
    pageRoot().removeAttribute("aria-hidden");
    document.body.classList.remove("modal-open");
    modal.open = false;
    var target = modal.trigger;
    if (!target || !document.contains(target) || target === document.body) {
      target = modal.restore ? document.querySelector(modal.restore) : null;
    }
    if (target && typeof target.focus === "function") target.focus();
    modal.kind = null;
    modal.rebuild = null;
    modal.build = null;
  }

  // 弹窗内容依赖数据或语言时，用它重新生成
  function rebuildModal() {
    if (!modal.open || !modal.build) return;
    var m = modalEls();
    var built = modal.build();
    m.title.textContent = built.title;
    clear(m.content);
    m.content.appendChild(built.content);
  }

  document.addEventListener("keydown", function (e) {
    if (!modal.open) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key === "Tab") {
      var list = focusables();
      if (!list.length) { e.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1];
      var active = document.activeElement;
      var dialog = modalEls().dialog;
      if (!dialog.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener("focusin", function (e) {
    if (!modal.open) return;
    var dialog = modalEls().dialog;
    if (!dialog.contains(e.target)) modalEls().close.focus();
  });

  /* ---------- 自学视频 ---------- */
  function videoTitle(v, idx) {
    return v.title ? pick(v.title) : t("videos.placeholderTitle", { n: idx + 1 });
  }

  function buildVideoModal(v, idx) {
    var content = el("div", "video-modal");
    var frameWrap = el("div", "video-frame");
    var iframe = el("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(v.videoId) + "?rel=0&playsinline=1";
    iframe.title = videoTitle(v, idx);
    iframe.setAttribute("allow", "encrypted-media; picture-in-picture; fullscreen");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frameWrap.appendChild(iframe);
    content.appendChild(frameWrap);
    var a = el("a", "yt-link", t("videos.openYoutube"));
    a.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.videoId);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    content.appendChild(a);
    return content;
  }

  function renderVideos() {
    safeRender("videos-body", function (host, items) {
      var ul = el("ul", "entry-list");
      var idx = 0;
      items.forEach(function (v) {
        if (!YT_ID.test(String(v.videoId))) return;
        var n = idx++;
        var li = el("li");
        var btn = el("button", "entry video-entry");
        btn.type = "button";
        btn.setAttribute("data-video-id", v.videoId);
        var title = videoTitle(v, n);
        btn.setAttribute("aria-label", t("videos.play", { title: title }));

        var thumb = el("span", "thumb");
        thumb.setAttribute("aria-hidden", "true");
        var img = el("img");
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", function () { img.remove(); thumb.classList.add("thumb-failed"); });
        img.src = "https://i.ytimg.com/vi/" + encodeURIComponent(v.videoId) + "/hqdefault.jpg";
        thumb.appendChild(img);
        var play = el("span", "play-icon");
        thumb.appendChild(play);

        var txt = el("span", "entry-text");
        txt.appendChild(el("span", "entry-name", title));
        btn.appendChild(thumb);
        btn.appendChild(txt);
        btn.addEventListener("click", function () {
          openModal({
            kind: "video",
            title: title,
            content: buildVideoModal(v, n),
            restore: '[data-video-id="' + v.videoId + '"]',
            rebuild: function () {
              var m = modalEls();
              m.title.textContent = videoTitle(v, n);
              var link = m.content.querySelector(".yt-link");
              if (link) link.textContent = t("videos.openYoutube");
              var f = m.content.querySelector("iframe");
              if (f) f.title = videoTitle(v, n);
            }
          });
        });
        li.appendChild(btn);
        ul.appendChild(li);
      });
      host.appendChild(ul);
      host.appendChild(el("p", "note", t("videos.hint")));
    });
  }

  /* ---------- AP 问答机器人（仅示意） ---------- */
  function renderQa() {
    var host = body("qa-body");
    if (!host) return;
    clear(host);
    var layout = el("div", "qa-layout");
    var left = el("div", "qa-left");
    var fig = el("div", "qa-figure");
    var img = el("img", "qa-illustration");
    img.src = "assets/img/chatbot.svg";
    img.setAttribute("role", "img");
    img.alt = t("qa.illustrationLabel");
    img.setAttribute("aria-label", t("qa.illustrationLabel"));
    fig.appendChild(img);
    left.appendChild(fig);
    left.appendChild(el("p", "note qa-caption", t("qa.caption")));
    layout.appendChild(left);

    var s = state.qa;
    var box = el("div", "qa-demo");
    try {
      if (s.status === "loading") {
        box.appendChild(el("p", "muted", t("common.loading")));
      } else if (s.status === "error") {
        box.appendChild(errorNode());
      } else {
        s.data.forEach(function (item) {
          var card = el("div", "qa-item");
          card.appendChild(el("span", "tag", t("qa.demoTag")));
          var q = el("p", "qa-q");
          q.appendChild(el("strong", "qa-label", t("qa.q") + "："));
          q.appendChild(document.createTextNode(pick(item.question)));
          var a = el("p", "qa-a");
          a.appendChild(el("strong", "qa-label", t("qa.a") + "："));
          a.appendChild(document.createTextNode(pick(item.answer)));
          card.appendChild(q);
          card.appendChild(a);
          box.appendChild(card);
        });
      }
    } catch (e) {
      clear(box);
      box.appendChild(errorNode());
    }
    layout.appendChild(box);
    host.appendChild(layout);
  }

  /* ---------- 所有测试、立即测试 ---------- */
  var testsState = { status: "loading", data: null, loadedAt: 0 };

  function leftText(ms) {
    var mins = Math.max(1, Math.floor(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d >= 1) return t("tests.left.dh", { d: d, h: h });
    if (h >= 1) return t("tests.left.hm", { h: h, m: m });
    return t("tests.left.m", { m: m });
  }

  function testsContent() {
    var wrap = el("div", "tests");
    if (testsState.status === "loading") { wrap.appendChild(el("p", "muted", t("common.loading"))); return wrap; }
    if (testsState.status === "error") { wrap.appendChild(errorTextNode("tests.loadError")); return wrap; }
    var list = testsState.data.assessments;
    var offsetMs = Date.parse(testsState.data.serverNow) - testsState.loadedAt;
    var hasActive = list.some(function (a) { return a.status === "in_progress"; });
    if (!list.length) { wrap.appendChild(el("p", "empty-note", t("tests.empty"))); return wrap; }

    function byTime(dir) { return function (x, y) { return dir * (Date.parse(x.scheduledAt) - Date.parse(y.scheduledAt)); }; }
    var groups = [
      ["tests.group.upcoming", list.filter(function (a) { return a.status === "scheduled"; }).sort(byTime(1))],
      ["tests.group.active", list.filter(function (a) { return a.status === "in_progress" || a.status === "submitted"; }).sort(byTime(-1))],
      ["tests.group.past", list.filter(function (a) { return a.status === "graded"; }).sort(byTime(-1))]
    ];
    groups.forEach(function (g, gi) {
      if (!g[1].length) return;
      var isPast = gi === 2; // 已评分的过往测试默认折叠，只显示：测试时间、科目单元、评分；展开后显示完整信息
      var sec = el("section", "t-group");
      var head = el("div", "t-group-head");
      head.appendChild(el("h3", "t-group-title", t(g[0]) + (i18n.getLang() === "zh" ? "（" + g[1].length + "）" : " (" + g[1].length + ")")));
      if (isPast) {
        var allOpen = g[1].every(function (a) { return openPast[a.id]; });
        var all = el("button", "card-btn t-toggle-all", t(allOpen ? "tests.collapseAll" : "tests.expandAll"));
        all.type = "button";
        all.addEventListener("click", function () { g[1].forEach(function (a) { openPast[a.id] = !allOpen; }); rebuildModal(); });
        head.appendChild(all);
      }
      sec.appendChild(head);
      g[1].forEach(function (a) { sec.appendChild(isPast ? pastItem(a, hasActive, offsetMs) : testCard(a, hasActive, offsetMs)); });
      wrap.appendChild(sec);
    });
    return wrap;
  }

  // 过往（已评分）的测试：折叠时只显示 测试时间、科目单元、评分；展开后显示完整信息
  var openPast = {};
  function pastItem(a, hasActive, offsetMs) {
    var open = !!openPast[a.id];
    var wrap = el("div", "past-item" + (open ? " is-open" : ""));
    var panelId = "past-panel-" + a.id;
    var btn = el("button", "past-toggle");
    btn.type = "button";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-controls", panelId);
    btn.setAttribute("data-test-id", String(a.id));
    btn.appendChild(el("span", "p-time", formatDate(a.scheduledAt, a.timezone, i18n.getLang())));
    btn.appendChild(el("span", "p-title", a.subject + " · " + a.unit));
    btn.appendChild(el("span", "p-score", a.score ? t("tests.scoreValue", { s: a.score }) : "—"));
    var chev = el("span", "p-chev");
    chev.setAttribute("aria-hidden", "true");
    btn.appendChild(chev);
    var panel = el("div", "past-panel");
    panel.id = panelId;
    panel.hidden = !open;
    panel.appendChild(testCard(a, hasActive, offsetMs));
    btn.addEventListener("click", function () {
      open = !open;
      openPast[a.id] = open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      wrap.classList.toggle("is-open", open);
    });
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    return wrap;
  }

  function errorTextNode(key) { var p = el("p", "module-error", t(key)); p.setAttribute("role", "status"); return p; }

  function testCard(a, hasActive, offsetMs) {
    var c = el("article", "t-card");
    var head = el("div", "t-head");
    head.appendChild(el("h4", "t-title", a.subject + " · " + a.unit));
    head.appendChild(el("span", "t-badge " + a.status, t("status." + a.status)));
    if (a.attemptNo > 1) head.appendChild(el("span", "t-badge tag", t("tests.attempt", { n: a.attemptNo })));
    c.appendChild(head);
    var meta = el("dl", "t-meta");
    function item(label, value) { var d = el("div"); d.appendChild(el("dt", "", label)); d.appendChild(el("dd", "", value)); meta.appendChild(d); }
    item(t("tests.time"), formatDate(a.scheduledAt, a.timezone, i18n.getLang()));
    item(t("tests.duration"), t("tests.durationValue", { m: a.durationMinutes }));
    if (a.status === "graded") item(t("tests.score"), t("tests.scoreValue", { s: a.score }));
    c.appendChild(meta);
    var act = el("div", "t-actions");
    if (a.status === "scheduled") {
      act.appendChild(el("span", "muted t-note", t("tests.questionsHidden")));
      var early = Date.now() + offsetMs < Date.parse(a.scheduledAt);
      var b = el("button", "card-btn primary", t(early ? "tests.startNow" : "tests.start"));
      b.type = "button";
      b.disabled = hasActive;
      b.setAttribute("aria-label", t(early ? "tests.startNow" : "tests.start") + "：" + a.subject + " · " + a.unit);
      b.addEventListener("click", function () { startFlow(a); });
      act.appendChild(b);
    } else if (a.status === "in_progress") {
      var r = el("a", "card-btn primary", t("tests.resume"));
      r.href = "/apdemo/exam?id=" + a.id;
      act.appendChild(r);
    } else {
      var v = el("a", "card-btn", t("tests.review"));
      v.href = "/apdemo/exam?id=" + a.id;
      v.setAttribute("aria-label", t("tests.review") + "：" + a.subject + " · " + a.unit);
      act.appendChild(v);
    }
    c.appendChild(act);
    return c;
  }

  function openTests() {
    testsState = { status: "loading", data: null, loadedAt: 0 };
    openModal({ kind: "tests", wide: true, restore: "#all-tests-btn", build: function () { return { title: t("tests.title"), content: testsContent() }; } });
    api.getAssessments().then(function (data) {
      testsState = { status: "ok", data: data, loadedAt: Date.now() };
      rebuildModal();
    }, function () { testsState = { status: "error", data: null, loadedAt: 0 }; rebuildModal(); });
  }

  // 点击“立即测试 / 开始测试”：先确认，确认后进入测试页（那里再选作答方式、开始计时）
  function startFlow(a) {
    if (modal.open) closeModal();
    var early = Date.now() < Date.parse(a.scheduledAt);
    openModal({
      kind: "confirm-start", restore: "#start-btn",
      build: function () {
        var wrap = el("div", "confirm-start");
        wrap.appendChild(el("p", "confirm-text", early
          ? t("tests.confirmEarly", { left: leftText(Date.parse(a.scheduledAt) - Date.now()), m: a.durationMinutes })
          : t("tests.confirmReady", { m: a.durationMinutes })));
        var row = el("div", "confirm-actions");
        var no = el("button", "card-btn", t("common.cancel"));
        no.type = "button";
        no.addEventListener("click", closeModal);
        var yes = el("button", "card-btn primary", t("common.confirm"));
        yes.type = "button";
        yes.id = "confirm-start-yes";
        yes.addEventListener("click", function () { window.location.href = "/apdemo/exam?id=" + a.id + (early ? "&early=1" : ""); });
        row.appendChild(no);
        row.appendChild(yes);
        wrap.appendChild(row);
        return { title: t(early ? "tests.startNow" : "tests.start"), content: wrap };
      }
    });
  }

  /* ---------- 其他 ---------- */
  function renderBrand() {
    var node = body("brand");
    if (!node) return;
    node.textContent = pick(window.APConfig.brandName);
    var sl = document.createElement("span");
    sl.className = "slogan";
    sl.textContent = pick(window.APConfig.slogan);
    node.appendChild(sl);
  }
  function markLangButtons() {
    var cur = i18n.getLang();
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-lang") === cur ? "true" : "false");
    });
  }
  function renderAll() {
    renderBrand();
    markLangButtons();
    renderProgress();
    renderSites();
    renderVideos();
    renderQa();
    renderUser();
  }

  function renderUser() {
    var u = state.user;
    var n = body("user-name");
    if (!n) return;
    // 账号名和所在时区一起显示，例如：Nathan（温哥华，时区：-7）
    var label = u && u.tzLabel ? i18n.tzTitle(u.tzLabel) : "";
    n.textContent = u ? (label ? (i18n.getLang() === "zh" ? u.username + "（" + label + "）" : u.username + " (" + label + ")") : u.username) : "";
  }

  function logout() {
    var b = body("logout-btn");
    b.disabled = true;
    api.logout().then(null, function () { /* 网络错误时仍回到登录页 */ }).then(function () { window.location.href = "/login"; });
  }

  function load(key, promise, map) {
    return promise.then(function (data) {
      state[key] = { status: "ok", data: map ? map(data) : data };
    }, function () {
      state[key] = { status: "error" };
    }).then(function () { renderAll(); });
  }

  function init() {
    i18n.init();
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.addEventListener("click", function () { i18n.setLang(b.getAttribute("data-lang"), true); });
    });
    body("logout-btn").addEventListener("click", logout);
    body("modal-close").addEventListener("click", closeModal);
    body("modal-backdrop").addEventListener("click", closeModal);
    document.addEventListener("ap:langchange", function () {
      renderAll();
      if (modal.open && modal.rebuild) modal.rebuild();
      rebuildModal();
    });
    renderAll();

    load("progress", Promise.all([api.getProgress(), api.getNextAssessment()]), function (r) {
      return { progress: r[0], assessment: r[1] };
    });
    api.getCurrentUser().then(function (u) { state.user = u; renderUser(); });
    load("sites", api.getSites());
    load("videos", api.getVideos());
    load("qa", api.getQaDemo());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
