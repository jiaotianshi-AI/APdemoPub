/* Writing 首页：每日作文（坚持天数 + 评分曲线 + 下一次写作时间）、自学视频、写作精灵。
   中英文切换沿用 AP 首页的 APi18n；所有来自服务器的文字都用 textContent 显示，不拼接 HTML。 */
(function () {
  "use strict";
  var i18n = window.APi18n;
  var api = window.APApi;

  /* ---------- 文案（在 APi18n 词典上追加） ---------- */
  var ADD = {
    zh: {
      "meta.title": "FocusGo · 写作",
      "w.daily.title": "每日作文",
      "w.daily.tagline": "每天一篇，看见进步",
      "w.videos.tagline": "精选名师讲作文",
      "w.qa.title": "写作精灵",
      "w.qa.tagline": "跟我学，写好文章",
      "w.streak.pre": "恭喜！你已坚持每天作文",
      "w.streak.unit": "天",
      "w.streak.none": "今天就开始你的作文记录吧！",
      "w.chart.week": "近 7 天",
      "w.chart.month": "近 30 天",
      "w.chart.range": "时间范围",
      "w.chart.label": "作文成绩趋势",
      "w.chart.empty": "写完第一篇作文后，这里会出现你的评分曲线。",
      "w.chart.aria": "作文成绩趋势，{range}：{list}",
      "w.chart.ariaNone": "作文成绩趋势，{range}：还没有评分",
      "w.chart.score": "{day} 评分 {s} / 5",
      "w.next.label": "下次写作",
      "w.last.label": "上次写作",
      "w.last.none": "还没有写作记录。",
      "w.last.date": "{m}月{d}日",
      "w.last.dateY": "{y}年{m}月{d}日",
      "w.next.today": "今天 {time}",
      "w.next.tomorrow": "明天 {time}",
      "w.next.date": "{m}月{d}日 周{w} {time}",
      "w.next.now": "现在可以写作了",
      "w.next.continue": "写作进行中",
      "w.next.doneToday": "今天已完成",
      "w.next.notDay": "今天不是写作日",
      "w.next.paused": "写作已暂停",
      "w.next.none": "还没有设置写作时间，请联系家长或老师。",
      "w.btn.start": "马上开写",
      "w.btn.continue": "继续写作",
      "w.btn.past": "过往写作",
      "w.past.title": "过往写作",
      "w.past.empty": "还没有过往的写作记录。",
      "w.past.done": "已完成",
      "w.past.unfinished": "没写完",
      "w.past.missed": "漏写",
      "w.past.score": "评分 {s} / 5",
      "w.past.round": "第 {n} 轮",
      "w.past.show": "展开",
      "w.past.hide": "收起",
      "w.past.comment": "家长/老师的评语",
      "w.past.error": "过往写作暂时无法加载，请稍后再试。"
    },
    en: {
      "meta.title": "FocusGo · Writing",
      "w.daily.title": "Daily Writing",
      "w.daily.tagline": "One essay a day, one step at a time",
      "w.videos.tagline": "Writing lessons from top teachers",
      "w.qa.title": "Writing Genie",
      "w.qa.tagline": "Learn with me, write great essays",
      "w.streak.pre": "Congratulations! You have written every day for",
      "w.streak.unit": "days",
      "w.streak.unit1": "day",
      "w.streak.none": "Start your writing streak today!",
      "w.chart.week": "Past 7 days",
      "w.chart.month": "Past 30 days",
      "w.chart.range": "Time range",
      "w.chart.label": "Essay score trend",
      "w.chart.empty": "Your score curve will appear after your first essay.",
      "w.chart.aria": "Essay score trend, {range}: {list}",
      "w.chart.ariaNone": "No essay scores yet, {range}",
      "w.chart.score": "{day}: score {s} / 5",
      "w.next.label": "Next writing",
      "w.last.label": "Last writing",
      "w.last.none": "No writing yet.",
      "w.last.date": "{m} {d}",
      "w.last.dateY": "{m} {d}, {y}",
      "w.next.today": "Today {time}",
      "w.next.tomorrow": "Tomorrow {time}",
      "w.next.date": "{w}, {m} {d} · {time}",
      "w.next.now": "Ready to write",
      "w.next.continue": "Writing in progress",
      "w.next.doneToday": "Done for today",
      "w.next.notDay": "Not a writing day today",
      "w.next.paused": "Writing is paused",
      "w.next.none": "Your writing time is not set up yet. Please ask your parent or teacher.",
      "w.btn.start": "Start writing",
      "w.btn.continue": "Continue writing",
      "w.btn.past": "Past writing",
      "w.past.title": "Past writing",
      "w.past.empty": "No past writing yet.",
      "w.past.done": "Finished",
      "w.past.unfinished": "Not finished",
      "w.past.missed": "Missed",
      "w.past.score": "Score {s} / 5",
      "w.past.round": "Round {n}",
      "w.past.show": "Show",
      "w.past.hide": "Hide",
      "w.past.comment": "Comment from your parent or teacher",
      "w.past.error": "Past writing could not be loaded right now. Please try again later."
    }
  };
  ["zh", "en"].forEach(function (l) { Object.keys(ADD[l]).forEach(function (k) { i18n.dict[l][k] = ADD[l][k]; }); });
  var t = i18n.t;
  var pick = i18n.pick;

  var YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var EN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var ZH_DAYS = ["一", "二", "三", "四", "五", "六", "日"];

  var state = { home: { status: "loading" }, videos: { status: "loading" }, qa: { status: "loading" }, user: null, range: 7 };

  /* ---------- 小工具 ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function body(id) { return document.getElementById(id); }
  function errorNode() {
    var p = el("p", "module-error", t("error.module"));
    p.setAttribute("role", "status");
    return p;
  }
  function request(path) {
    return fetch(path, { credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } }).then(function (res) {
      if (res.status === 401) { window.location.href = "/login"; throw new Error("401"); }
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
  }
  function safeRender(id, key, fn) {
    var host = body(id);
    if (!host) return;
    try {
      clear(host);
      var s = state[key];
      if (s.status === "loading") host.appendChild(el("p", "muted", t("common.loading")));
      else if (s.status === "error") host.appendChild(errorNode());
      else fn(host, s.data);
    } catch (e) {
      clear(host);
      host.appendChild(errorNode());
    }
  }

  /* ---------- 日期时间 ---------- */
  function parseDay(day) { var p = day.split("-"); return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) }; }
  function addDays(day, n) { var d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(day) { return (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7; } // 周一 = 0
  function fmtTime(hm) {
    var h = Number(hm.slice(0, 2));
    return (h % 12 === 0 ? 12 : h % 12) + ":" + hm.slice(3, 5) + " " + (h < 12 ? "AM" : "PM");
  }
  function fmtShort(day) { var p = parseDay(day); return p.m + "/" + p.d; }
  function fmtLong(day) {
    var p = parseDay(day);
    return i18n.getLang() === "zh" ? p.m + "月" + p.d + "日" : EN_MONTHS[p.m - 1] + " " + p.d + ", " + p.y;
  }

  /* ---------- 每日作文（主模块） ---------- */
  function nextInfo(next) {
    // 返回 { text, badge, badgeCls }
    var time = next.time ? fmtTime(next.time) : "";
    if (next.kind === "none") return { text: t("w.next.none"), plain: true };
    if (next.kind === "paused") return { text: t("w.next.paused"), plain: true };
    var when = "";
    if (next.kind === "now" || next.kind === "today") when = t("w.next.today", { time: time });
    else if (next.offset === 1) when = t("w.next.tomorrow", { time: time });
    else {
      var p = parseDay(next.day), w = dow(next.day);
      when = t("w.next.date", { m: i18n.getLang() === "zh" ? p.m : EN_MONTHS[p.m - 1], d: p.d, w: i18n.getLang() === "zh" ? ZH_DAYS[w] : EN_DAYS[w], time: time });
    }
    var out = { text: when };
    if (next.kind === "now") { out.badge = next.continuing ? t("w.next.continue") : t("w.next.now"); out.badgeCls = "is-ready"; }
    else if (next.doneToday) { out.badge = t("w.next.doneToday"); out.badgeCls = "is-done"; }
    else if (next.notDay) { out.badge = t("w.next.notDay"); out.badgeCls = "is-done"; }
    return out;
  }

  function lastDate(day, today) {
    var p = parseDay(day), cur = parseDay(today);
    var zh = i18n.getLang() === "zh";
    var key = p.y === cur.y ? "w.last.date" : "w.last.dateY";
    return t(key, { y: p.y, m: zh ? p.m : EN_MONTHS[p.m - 1], d: p.d });
  }
  // 上次写作：日期、状态、评分、题目
  function lastContent(h) {
    var box = el("div", "last-content");
    var it = h.last;
    if (!it) { box.appendChild(el("p", "next-plain", t("w.last.none"))); return box; }
    var head = el("div", "last-head");
    head.appendChild(el("span", "last-day", lastDate(it.day, h.day)));
    head.appendChild(el("span", "last-kind", t(it.kind === "done" ? "w.past.done" : "w.past.unfinished")));
    if (it.kind === "done" && it.finalScore) head.appendChild(el("span", "score-badge", t("w.past.score", { s: it.finalScore })));
    box.appendChild(head);
    if (it.promptTitle) box.appendChild(el("p", "last-title", it.promptTitle));
    return box;
  }

  function renderDaily() {
    safeRender("daily-body", "home", function (host, h) {
      var wrap = el("div", "progress-layout");

      /* 左：坚持天数 + 评分曲线 */
      var left = el("div", "progress-main daily-main");
      var cong = el("p", "streak");
      if (h.streak > 0) {
        // 各段之间放一个空格（屏幕上的间距由 CSS gap 控制），读屏软件才不会把词连在一起
        cong.appendChild(el("span", "streak-pre", t("w.streak.pre")));
        cong.appendChild(document.createTextNode(" "));
        cong.appendChild(el("span", "streak-num", String(h.streak)));
        cong.appendChild(document.createTextNode(" "));
        cong.appendChild(el("span", "streak-unit", i18n.getLang() === "en" && h.streak === 1 ? t("w.streak.unit1") : t("w.streak.unit")));
      } else cong.appendChild(el("span", "streak-pre", t("w.streak.none")));
      left.appendChild(cong);
      left.appendChild(chartBlock(h));
      wrap.appendChild(left);

      /* 右：上次写作（过往写作按钮）+ 下次写作（马上开写按钮） */
      var side = el("div", "daily-side");

      var lastBox = el("div", "assessment last-box");
      lastBox.id = "last-box";
      lastBox.appendChild(el("div", "kv-label", t("w.last.label")));
      lastBox.appendChild(lastContent(h));
      var lacts = el("div", "card-actions");
      var past = el("button", "card-btn", t("w.btn.past"));
      past.type = "button";
      past.id = "past-btn";
      past.addEventListener("click", openPast);
      lacts.appendChild(past);
      lastBox.appendChild(lacts);
      side.appendChild(lastBox);

      var nextBox = el("div", "assessment next-box");
      nextBox.id = "next-box";
      nextBox.appendChild(el("div", "kv-label", t("w.next.label")));
      var info = nextInfo(h.next);
      nextBox.appendChild(el("div", info.plain ? "next-plain" : "assessment-time", info.text));
      if (info.badge) nextBox.appendChild(el("div", "status-badge " + info.badgeCls, info.badge));
      var nacts = el("div", "card-actions");
      // 写作日里不管有没有到日程时间，都可以马上开始（日程时间只是提醒）
      var can = h.next.kind === "now" || h.next.kind === "today";
      var go = el(can ? "a" : "button", "card-btn primary", h.next.continuing ? t("w.btn.continue") : t("w.btn.start"));
      go.id = "start-btn";
      if (can) go.href = "/writing/write";
      else { go.type = "button"; go.disabled = true; }
      nacts.appendChild(go);
      nextBox.appendChild(nacts);
      side.appendChild(nextBox);

      wrap.appendChild(side);
      host.appendChild(wrap);
      drawChart();
    });
  }

  /* ---------- 评分曲线（SVG） ---------- */
  function chartBlock(h) {
    var box = el("div", "chart-box");
    var head = el("div", "chart-head");
    head.appendChild(el("span", "kv-label", t("w.chart.label")));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("w.chart.range"));
    [[7, "w.chart.week"], [30, "w.chart.month"]].forEach(function (r) {
      var b = el("button", "seg-btn", t(r[1]));
      b.type = "button";
      b.setAttribute("data-range", String(r[0]));
      b.setAttribute("aria-pressed", state.range === r[0] ? "true" : "false");
      b.addEventListener("click", function () { state.range = r[0]; renderDaily(); });
      seg.appendChild(b);
    });
    head.appendChild(seg);
    box.appendChild(head);
    var holder = el("div", "chart");
    holder.id = "chart";
    box.appendChild(holder);
    return box;
  }

  function drawChart() {
    var holder = body("chart");
    if (!holder || state.home.status !== "ok") return;
    var h = state.home.data;
    clear(holder);
    var n = state.range;
    var days = [];
    for (var i = n - 1; i >= 0; i--) days.push(addDays(h.day, -i));
    var byDay = {};
    h.series.forEach(function (s) { byDay[s.day] = s.score; });
    var pts = [];
    days.forEach(function (d, idx) { if (byDay[d]) pts.push({ day: d, i: idx, s: byDay[d] }); });
    var rangeLabel = t(n === 7 ? "w.chart.week" : "w.chart.month");
    if (!pts.length) {
      holder.appendChild(el("p", "chart-empty", t("w.chart.empty")));
      holder.setAttribute("role", "img");
      holder.setAttribute("aria-label", t("w.chart.ariaNone", { range: rangeLabel }));
      return;
    }
    holder.removeAttribute("role");
    holder.removeAttribute("aria-label");

    var W = Math.max(260, holder.clientWidth || 520), H = 190;
    var L = 26, R = 12, T = 12, B = 28;
    var pw = W - L - R, ph = H - T - B;
    function x(i) { return L + (n === 1 ? pw / 2 : (pw * i) / (n - 1)); }
    function y(s) { return T + ph - (ph * (s - 1)) / 4; }

    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, width: String(W), height: String(H), class: "chart-svg" });
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", t("w.chart.aria", { range: rangeLabel, list: pts.map(function (p) { return fmtShort(p.day) + " " + p.s; }).join(", ") }));
    // 横向格线和纵轴刻度（1–5）
    for (var s = 1; s <= 5; s++) {
      root.appendChild(svg("line", { x1: L, x2: W - R, y1: y(s), y2: y(s), class: "chart-grid" }));
      var lab = svg("text", { x: L - 8, y: y(s) + 4, class: "chart-tick", "text-anchor": "end" });
      lab.textContent = String(s);
      root.appendChild(lab);
    }
    // 横轴：7 天每天标一个；30 天每 5 天标一个
    days.forEach(function (d, idx) {
      var show = n === 7 || idx === n - 1 || (n - 1 - idx) % 5 === 0;
      if (!show) return;
      var tx = svg("text", { x: x(idx), y: H - 8, class: "chart-tick", "text-anchor": idx === 0 ? "start" : idx === n - 1 ? "end" : "middle" });
      tx.textContent = n === 7 ? (i18n.getLang() === "zh" ? "周" + ZH_DAYS[dow(d)] : EN_DAYS[dow(d)]) : fmtShort(d);
      root.appendChild(tx);
    });
    // 折线：只连接相邻的两天；中间有漏写的天，线断开
    var seg = [];
    function flush() {
      if (seg.length > 1) root.appendChild(svg("polyline", { points: seg.map(function (p) { return x(p.i) + "," + y(p.s); }).join(" "), class: "chart-line" }));
      seg = [];
    }
    pts.forEach(function (p) {
      if (seg.length && p.i !== seg[seg.length - 1].i + 1) flush();
      seg.push(p);
    });
    flush();
    pts.forEach(function (p) {
      var c = svg("circle", { cx: x(p.i), cy: y(p.s), r: n === 7 ? 5 : 4, class: "chart-dot" });
      var ti = svg("title", {});
      ti.textContent = t("w.chart.score", { day: fmtLong(p.day), s: p.s });
      c.appendChild(ti);
      root.appendChild(c);
    });
    holder.appendChild(root);
  }
  var resizeTimer = null;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 150); });

  /* ---------- 模态窗口（视频、过往写作） ---------- */
  var modal = { open: false, trigger: null, build: null };
  function modalEls() {
    return { root: body("modal"), dialog: body("modal-dialog"), title: body("modal-title"), close: body("modal-close"), content: body("modal-body") };
  }
  function focusables() {
    return Array.prototype.filter.call(modalEls().dialog.querySelectorAll('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'), function (n) { return !n.hidden; });
  }
  function openModal(opts) {
    var m = modalEls();
    modal.trigger = document.activeElement;
    modal.build = opts.build;
    var built = opts.build();
    m.dialog.classList.toggle("modal-wide", !!opts.wide);
    m.title.textContent = built.title;
    clear(m.content);
    m.content.appendChild(built.content);
    m.root.hidden = false;
    body("page").inert = true;
    body("page").setAttribute("aria-hidden", "true");
    document.body.classList.add("modal-open");
    modal.open = true;
    m.close.focus();
  }
  function closeModal() {
    if (!modal.open) return;
    var m = modalEls();
    clear(m.content); // 移除 iframe，停止播放
    m.root.hidden = true;
    body("page").inert = false;
    body("page").removeAttribute("aria-hidden");
    document.body.classList.remove("modal-open");
    modal.open = false;
    var target = modal.trigger;
    if (target && document.contains(target) && target !== document.body && typeof target.focus === "function") target.focus();
    modal.build = null;
  }
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
      var first = list[0], last = list[list.length - 1], active = document.activeElement;
      if (!modalEls().dialog.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener("focusin", function (e) {
    if (modal.open && !modalEls().dialog.contains(e.target)) modalEls().close.focus();
  });

  /* ---------- 过往写作 ---------- */
  var pastState = { status: "idle", items: [], open: {} };
  function openPast() {
    pastState.status = "loading";
    openModal({ wide: true, build: buildPast });
    request("/api/writing/history").then(function (d) { pastState = { status: "ok", items: d.items, open: pastState.open }; rebuildModal(); },
      function () { pastState.status = "error"; rebuildModal(); });
  }
  function buildPast() {
    var c = el("div", "wp-box");
    if (pastState.status === "loading") c.appendChild(el("p", "muted", t("common.loading")));
    else if (pastState.status === "error") { var e = el("p", "module-error", t("w.past.error")); e.setAttribute("role", "status"); c.appendChild(e); }
    else if (!pastState.items.length) c.appendChild(el("p", "muted", t("w.past.empty")));
    else {
      var ul = el("ul", "wp-list");
      pastState.items.forEach(function (it, idx) {
        var li = el("li", "wp-item wp-" + it.kind);
        var head = el("div", "wp-head");
        head.appendChild(el("span", "wp-day", fmtLong(it.day)));
        head.appendChild(el("span", "wp-kind", t(it.kind === "done" ? "w.past.done" : it.kind === "unfinished" ? "w.past.unfinished" : "w.past.missed")));
        if (it.kind === "done" && it.finalScore) head.appendChild(el("span", "score-badge", t("w.past.score", { s: it.finalScore })));
        li.appendChild(head);
        if (it.promptTitle) li.appendChild(el("p", "wp-title", it.promptTitle));
        if (it.scores && it.scores.length) li.appendChild(el("p", "wp-steps", it.scores.map(function (s, i) { return t("w.past.round", { n: i + 1 }) + ": " + s; }).join(" → ")));
        if (it.kind === "done") {
          var det = el("div", "wp-detail");
          var open = !!pastState.open[idx];
          det.hidden = !open;
          if (it.supervisorComment) { det.appendChild(el("p", "wp-comment-label", t("w.past.comment"))); det.appendChild(el("p", "wp-feedback", it.supervisorComment)); }
          if (it.feedback) det.appendChild(el("p", "wp-feedback", it.feedback));
          det.appendChild(el("div", "wp-essay", it.essay || ""));
          var tg = el("button", "card-btn", t(open ? "w.past.hide" : "w.past.show"));
          tg.type = "button";
          tg.setAttribute("aria-expanded", open ? "true" : "false");
          tg.addEventListener("click", function () {
            pastState.open[idx] = det.hidden;
            det.hidden = !det.hidden;
            tg.textContent = t(det.hidden ? "w.past.show" : "w.past.hide");
            tg.setAttribute("aria-expanded", det.hidden ? "false" : "true");
          });
          li.appendChild(tg);
          li.appendChild(det);
        }
        ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    return { title: t("w.past.title"), content: c };
  }

  /* ---------- 自学视频（和 AP 首页一样，暂时不变） ---------- */
  function videoTitle(v, idx) { return v.title ? pick(v.title) : t("videos.placeholderTitle", { n: idx + 1 }); }
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
    safeRender("videos-body", "videos", function (host, items) {
      var ul = el("ul", "entry-list");
      var idx = 0;
      items.forEach(function (v) {
        if (!YT_ID.test(String(v.videoId))) return;
        var n = idx++;
        var li = el("li");
        var btn = el("button", "entry video-entry");
        btn.type = "button";
        btn.setAttribute("data-video-id", v.videoId);
        btn.setAttribute("aria-label", t("videos.play", { title: videoTitle(v, n) }));
        var thumb = el("span", "thumb");
        thumb.setAttribute("aria-hidden", "true");
        var img = el("img");
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", function () { img.remove(); thumb.classList.add("thumb-failed"); });
        img.src = "https://i.ytimg.com/vi/" + encodeURIComponent(v.videoId) + "/hqdefault.jpg";
        thumb.appendChild(img);
        thumb.appendChild(el("span", "play-icon"));
        var txt = el("span", "entry-text");
        txt.appendChild(el("span", "entry-name", videoTitle(v, n)));
        btn.appendChild(thumb);
        btn.appendChild(txt);
        btn.addEventListener("click", function () {
          openModal({ build: function () { return { title: videoTitle(v, n), content: buildVideoModal(v, n) }; } });
        });
        li.appendChild(btn);
        ul.appendChild(li);
      });
      host.appendChild(ul);
      host.appendChild(el("p", "note", t("videos.hint")));
    });
  }

  /* ---------- 写作精灵（仅示意，内容暂时不变） ---------- */
  function renderQa() {
    var host = body("qa-body");
    if (!host) return;
    clear(host);
    var layout = el("div", "qa-layout");
    var left = el("div", "qa-left");
    var fig = el("div", "qa-figure");
    var img = el("img", "qa-illustration");
    img.src = "/assets/img/chatbot.svg";
    img.setAttribute("role", "img");
    img.alt = t("qa.illustrationLabel");
    fig.appendChild(img);
    left.appendChild(fig);
    left.appendChild(el("p", "note qa-caption", t("qa.caption")));
    layout.appendChild(left);
    var s = state.qa;
    var box = el("div", "qa-demo");
    try {
      if (s.status === "loading") box.appendChild(el("p", "muted", t("common.loading")));
      else if (s.status === "error") box.appendChild(errorNode());
      else s.data.forEach(function (item) {
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
    } catch (e) { clear(box); box.appendChild(errorNode()); }
    layout.appendChild(box);
    host.appendChild(layout);
  }

  /* ---------- 顶栏、启动 ---------- */
  function renderBrand() {
    var node = body("brand");
    if (!node) return;
    node.textContent = "";
    var logo = document.createElement("span");
    logo.className = "logo";
    logo.textContent = pick(window.APConfig.brandName);
    node.appendChild(logo);
    var sl = document.createElement("span");
    sl.className = "slogan";
    sl.textContent = pick(window.APConfig.slogan);
    node.appendChild(sl);
  }
  function renderUser() {
    var u = state.user, n = body("user-name");
    if (!n) return;
    var label = u && u.tzLabel ? i18n.tzTitle(u.tzLabel) : "";
    n.textContent = u ? (label ? (i18n.getLang() === "zh" ? u.username + "（" + label + "）" : u.username + " (" + label + ")") : u.username) : "";
  }
  function markLangButtons() {
    var cur = i18n.getLang();
    document.querySelectorAll(".lang-btn").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-lang") === cur ? "true" : "false"); });
  }
  function renderAll() {
    renderBrand();
    markLangButtons();
    renderDaily();
    renderVideos();
    renderQa();
    renderUser();
  }
  function load(key, promise, map) {
    return promise.then(function (data) { state[key] = { status: "ok", data: map ? map(data) : data }; }, function () { state[key] = { status: "error" }; })
      .then(function () { renderAll(); });
  }
  function init() {
    i18n.init();
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.addEventListener("click", function () { i18n.setLang(b.getAttribute("data-lang"), true); });
    });
    body("logout-btn").addEventListener("click", function () {
      var b = body("logout-btn");
      b.disabled = true;
      api.logout().then(null, function () { /* 网络错误时仍回到登录页 */ }).then(function () { window.location.href = "/login"; });
    });
    body("modal-close").addEventListener("click", closeModal);
    body("modal-backdrop").addEventListener("click", closeModal);
    document.addEventListener("ap:langchange", function () { renderAll(); rebuildModal(); });
    renderAll();
    load("home", request("/api/writing/home"));
    api.getCurrentUser().then(function (u) { state.user = u; renderUser(); });
    load("videos", api.getVideos());
    load("qa", api.getQaDemo());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
