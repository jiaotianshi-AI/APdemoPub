/*
 * 数据访问层：页面取数的唯一入口（window.APApi）。
 * static：同源读取 data/*.json（站点、视频、示例问答）和后台的学生接口。remote：仅预留，调用抛 NOT_IMPLEMENTED，不发任何网络请求。
 */
(function () {
  "use strict";

  // remote 模式的接口路径常量（草案，见 docs/API.md）
  var ROUTES = {
    me: "/me",
    progress: "/students/{id}/progress",
    nextAssessment: "/students/{id}/assessments/next",
    startAssessment: "/assessments/{id}/start",
    submitAttempt: "/attempts/{id}/submit",
    getAttempt: "/attempts/{id}",
    weeklyReport: "/students/{id}/reports/weekly",
    sites: "/sites",
    videos: "/videos",
    qaAsk: "/qa/ask"
  };

  function cfg() { return window.APConfig || { dataSource: "static", apiBase: "" }; }

  function fail(code, message) { return Promise.reject({ code: code, message: message }); }

  function notImplemented(name) {
    return function () { return fail("NOT_IMPLEMENTED", name + " is not implemented in this phase."); };
  }

  function isRemote() { return cfg().dataSource === "remote"; }

  function loadStatic(file) {
    var url;
    try { url = new URL("data/" + file, document.baseURI).href; } catch (e) { return fail("BAD_REQUEST", "Invalid data path."); }
    return fetch(url, { cache: "no-cache", credentials: "same-origin" }).then(function (res) {
      if (!res.ok) return fail("HTTP_" + res.status, "Failed to load " + file);
      return res.json().catch(function () { return fail("BAD_DATA", "Invalid JSON in " + file); });
    }, function () { return fail("NETWORK", "Network error loading " + file); });
  }

  function load(file, name) {
    if (isRemote()) return notImplemented(name)();
    return loadStatic(file);
  }

  function listItems(file, name, extraFilter) {
    return load(file, name).then(function (doc) {
      if (!doc || !Array.isArray(doc.items)) return fail("BAD_DATA", file + " has no items array.");
      return doc.items
        .filter(function (it) { return it && it.enabled !== false && (!extraFilter || extraFilter(it)); })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    });
  }

  // ---- 学生自己的数据（来自后台，登录后才能取）----
  var overviewPromise = null;
  function overview() {
    if (isRemote()) return notImplemented("overview")();
    if (!overviewPromise) {
      overviewPromise = fetch(new URL("api/student/overview", document.baseURI).href, { cache: "no-store", credentials: "same-origin" })
        .then(function (res) {
          if (res.status === 401) { window.location.href = "/login"; return fail("UNAUTHENTICATED", "Please sign in."); }
          if (!res.ok) return fail("HTTP_" + res.status, "Failed to load overview");
          return res.json().catch(function () { return fail("BAD_DATA", "Invalid JSON"); });
        }, function () { return fail("NETWORK", "Network error"); })
        .catch(function (e) { overviewPromise = null; return Promise.reject(e); });
    }
    return overviewPromise;
  }

  // 学习进度 = 从“本单元开始学习”到测试时间，已经走过的比例（0–100 的整数）。在页面加载时按当前时间计算一次。
  function percentOf(next) {
    var start = Date.parse(next.unitStartAt), end = Date.parse(next.scheduledAt), now = Date.now();
    if (!(end > start)) return now >= end ? 100 : 0;
    return Math.max(0, Math.min(100, Math.floor(((now - start) / (end - start)) * 100)));
  }

  window.APApi = {
    ROUTES: ROUTES,
    getSites: function () { return listItems("sites.json", "getSites"); },
    getVideos: function () { return listItems("videos.json", "getVideos", function (v) { return v.provider === "youtube"; }); },
    getProgress: function (/* studentId：学生只能看自己的 */) {
      return overview().then(function (o) {
        var n = o.next;
        return { subject: n ? n.subject : (o.subject || null), unit: n ? n.unit : null, percent: n ? percentOf(n) : null, hasAssessment: !!n };
      });
    },
    getNextAssessment: function (/* studentId */) { return overview().then(function (o) { return o.next || null; }); },
    getQaDemo: function () { return listItems("qa.sample.json", "getQaDemo"); },
    getCurrentUser: function () {
      if (isRemote()) return Promise.resolve(null);
      return overview().then(function (o) { return { username: o.username, type: "student" }; }, function () { return null; });
    },
    logout: function () {
      if (isRemote()) return notImplemented("logout")();
      return fetch(new URL("api/logout", document.baseURI).href, { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } })
        .then(function () { return null; }, function () { return fail("NETWORK", "Network error"); });
    },

    // 以下仅预留
    startAssessment: notImplemented("startAssessment"),
    submitAttempt: notImplemented("submitAttempt"),
    getAttemptResult: notImplemented("getAttemptResult"),
    getWeeklyReport: notImplemented("getWeeklyReport"),
    askQuestion: notImplemented("askQuestion"),
    login: notImplemented("login")
  };
})();
