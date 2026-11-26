/* 界面文案中英文词典 + 语言解析。两种语言的键必须完全一致。 */
(function () {
  "use strict";

  var dict = {
    zh: {
      "meta.title": "AP 自学演示首页",
      "meta.description": "AP 自学演示页：进度和测试、自学视频、AP 问答机器人与关联网站入口（演示版）。",
      "a11y.langGroup": "语言切换",
      "login.btn": "登录",
      "login.title": "登录",
      "login.message": "演示版：登录与用户管理功能将在后续阶段开放。",
      "modal.close": "关闭",
      "hero.title": "AP 自学演示首页",
      "hero.subtitle": "跟踪学习进度、参加定时测试，并快速找到学习视频、问答入口和关联网站。",
      "common.loading": "加载中…",
      "error.module": "该模块暂时无法加载，请稍后刷新页面重试。",

      "mod.progress.title": "进度和测试",
      "mod.progress.tagline": "持续跟踪和推进当前学习进度，定时测试学习成果",
      "progress.current": "当前学习内容",
      "progress.percent": "学习进度",
      "progress.assessmentTime": "阶段测试时间",
      "progress.courseUnit": "{course} Unit {number}：{unit}",
      "progress.tz.America/Vancouver": "温哥华时间",
      "progress.countdown.dh": "还有 {d} 天 {h} 小时",
      "progress.countdown.hm": "还有 {h} 小时 {m} 分钟",
      "progress.countdown.m": "还有 {m} 分钟",
      "progress.ended": "已结束",
      "progress.noAssessment": "暂无已安排的测试",


      "refs.title": "关联网站",

      "mod.videos.title": "自学视频",
      "mod.videos.tagline": "精选/自选名师AP视频",
      "videos.placeholderTitle": "AP 视频 {n}",
      "videos.play": "播放：{title}",
      "videos.openYoutube": "在 YouTube 打开",
      "videos.hint": "点击封面后在窗口内播放，不会自动播放。",

      "mod.qa.title": "AP 问答机器人",
      "mod.qa.tagline": "AP相关全知道",
      "qa.illustrationLabel": "示意图：学生提问，机器人查询资料后回答",
      "qa.caption": "学生可以针对 AP 学习提问，机器人查询 AP 学习资料后给出回答（示意图，功能尚未上线）",
      "qa.demoTag": "演示示例",
      "qa.q": "问",
      "qa.a": "答",

      "footer.disclaimer": "AP® 是 College Board 的注册商标。本站为非官方演示版，与 College Board、Khan Academy、Google Classroom 均无关联，也未获其认可。"
    },
    en: {
      "meta.title": "AP Self-Study Demo",
      "meta.description": "AP self-study demo page: progress and tests, study videos, an AP Q&A bot, and related sites (demo version).",
      "a11y.langGroup": "Language",
      "login.btn": "Log in",
      "login.title": "Log in",
      "login.message": "Demo: sign-in and account management will be available in a later phase.",
      "modal.close": "Close",
      "hero.title": "AP Self-Study Demo",
      "hero.subtitle": "Track your progress, take scheduled tests, and quickly find study videos, Q&A and related sites.",
      "common.loading": "Loading…",
      "error.module": "This section could not be loaded right now. Please refresh the page and try again.",

      "mod.progress.title": "Progress and Tests",
      "mod.progress.tagline": "Track and move your current study progress forward, with scheduled tests of what you've learned",
      "progress.current": "Current study",
      "progress.percent": "Study progress",
      "progress.assessmentTime": "Unit test time",
      "progress.courseUnit": "{course} Unit {number}: {unit}",
      "progress.tz.America/Vancouver": "Vancouver time",
      "progress.countdown.dh": "{d} d {h} h left",
      "progress.countdown.hm": "{h} h {m} min left",
      "progress.countdown.m": "{m} min left",
      "progress.ended": "Ended",
      "progress.noAssessment": "No test scheduled",


      "refs.title": "References",

      "mod.videos.title": "Study Videos",
      "mod.videos.tagline": "Curated and self-picked AP videos from top teachers",
      "videos.placeholderTitle": "AP Video {n}",
      "videos.play": "Play: {title}",
      "videos.openYoutube": "Open on YouTube",
      "videos.hint": "Tap a cover to watch in a window. Videos never autoplay.",

      "mod.qa.title": "AP Q&A Bot",
      "mod.qa.tagline": "Everything AP, answered",
      "qa.illustrationLabel": "Illustration: a student asks, the bot looks up materials and answers",
      "qa.caption": "Students can ask AP study questions; the bot looks up AP study materials and answers (illustration only, not yet available)",
      "qa.demoTag": "Demo example",
      "qa.q": "Q",
      "qa.a": "A",

      "footer.disclaimer": "AP® is a registered trademark of the College Board. This is an unofficial demo, not affiliated with or endorsed by the College Board, Khan Academy or Google Classroom."
    }
  };

  var STORAGE_KEY = "ap_lang";

  function safeGet() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function safeSet(v) {
    try { window.localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* 存储不可用时忽略 */ }
  }
  function isLang(v) { return v === "zh" || v === "en"; }

  // 优先级：URL ?lang= → localStorage → 浏览器语言
  function resolveLang() {
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(window.location.search).get("lang"); } catch (e) { /* ignore */ }
    if (isLang(fromUrl)) return fromUrl;
    var stored = safeGet();
    if (isLang(stored)) return stored;
    var nav = (navigator.language || "").toLowerCase();
    return nav.indexOf("zh") === 0 ? "zh" : "en";
  }

  var current = "zh";

  function t(key, vars) {
    var s = dict[current][key];
    if (s === undefined) s = key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
    }
    return s;
  }

  // 内容数据里的 {zh,en} 字段
  function pick(obj) {
    if (!obj) return "";
    return obj[current] || obj.en || obj.zh || "";
  }

  // 应用到静态 DOM：data-i18n（文字）、data-i18n-aria-label、data-i18n-alt、data-i18n-content
  function applyStatic() {
    document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
    document.title = t("meta.title");
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    ["aria-label", "alt", "content"].forEach(function (attr) {
      var sel = "[data-i18n-" + attr + "]";
      var list = document.querySelectorAll(sel);
      for (var j = 0; j < list.length; j++) list[j].setAttribute(attr, t(list[j].getAttribute("data-i18n-" + attr)));
    });
  }

  function setLang(lang, persist) {
    if (!isLang(lang)) return;
    current = lang;
    if (persist) safeSet(lang);
    applyStatic();
    document.dispatchEvent(new CustomEvent("ap:langchange", { detail: { lang: lang } }));
  }

  window.APi18n = {
    dict: dict,
    resolveLang: resolveLang,
    init: function () { current = resolveLang(); applyStatic(); return current; },
    setLang: setLang,
    getLang: function () { return current; },
    t: t,
    pick: pick
  };
})();
