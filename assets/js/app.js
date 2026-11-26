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
    var tzLabel = t("progress.tz." + tz);
    if (tzLabel === "progress.tz." + tz) tzLabel = tz;
    var h12 = w.hour24 % 12 === 0 ? 12 : w.hour24 % 12;
    var clock = h12 + ":" + w.minute + " " + (w.hour24 < 12 ? "AM" : "PM");
    if (lang === "zh") {
      return w.year + "年" + w.month + "月" + w.day + "日 " + clock + "（" + tzLabel + "）";
    }
    return MONTHS[w.month - 1] + " " + w.day + ", " + w.year + ", " + clock + " (" + tzLabel + ")";
  }

  function statusText(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    if (!(diff > 0)) return { ended: true, text: t("progress.ended") };
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
      var pct = Math.max(0, Math.min(100, Math.round(Number(prog.percent) || 0)));
      var wrap = el("div", "progress-layout");

      var left = el("div", "progress-main");
      var cur = el("div", "kv");
      cur.appendChild(el("div", "kv-label", t("progress.current")));
      cur.appendChild(el("div", "kv-value current-text", t("progress.courseUnit", {
        course: pick(prog.course.name), number: prog.currentUnit.number, unit: pick(prog.currentUnit.name)
      })));
      left.appendChild(cur);

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
      wrap.appendChild(left);

      var right = el("div", "assessment");
      right.appendChild(el("div", "kv-label", t("progress.assessmentTime")));
      if (asm) {
        right.appendChild(el("div", "assessment-time", formatDate(asm.scheduledAt, asm.timezone, i18n.getLang())));
        var st = statusText(asm.scheduledAt);
        right.appendChild(el("div", "status-badge " + (st.ended ? "is-ended" : "is-upcoming"), st.text));
      } else {
        right.appendChild(el("div", "assessment-time", t("progress.noAssessment")));
      }
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
  var modal = { open: false, kind: null, restore: null, trigger: null, rebuild: null };

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
    m.title.textContent = opts.title;
    clear(m.content);
    m.content.appendChild(opts.content);
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

  /* ---------- 其他 ---------- */
  function renderBrand() {
    var node = body("brand");
    if (node) node.textContent = pick(window.APConfig.brandName);
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
  }

  function openLogin() {
    var p = el("p", "login-message", t("login.message"));
    openModal({
      kind: "login",
      title: t("login.title"),
      content: p,
      restore: "#login-btn",
      rebuild: function () {
        modalEls().title.textContent = t("login.title");
        var msg = modalEls().content.querySelector(".login-message");
        if (msg) msg.textContent = t("login.message");
      }
    });
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
    body("login-btn").addEventListener("click", openLogin);
    body("modal-close").addEventListener("click", closeModal);
    body("modal-backdrop").addEventListener("click", closeModal);
    document.addEventListener("ap:langchange", function () {
      renderAll();
      if (modal.open && modal.rebuild) modal.rebuild();
    });
    renderAll();

    load("progress", Promise.all([api.getProgress(), api.getNextAssessment()]), function (r) {
      return { progress: r[0], assessment: r[1] };
    });
    load("sites", api.getSites());
    load("videos", api.getVideos());
    load("qa", api.getQaDemo());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
