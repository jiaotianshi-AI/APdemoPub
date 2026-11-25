/*
 * 数据访问层：页面取数的唯一入口（window.APApi）。
 * static：同源 fetch data/*.json。remote：仅预留，调用抛 NOT_IMPLEMENTED，不发任何网络请求。
 */
(function () {
  "use strict";

  var DEMO_STUDENT = "stu_demo"; // 本阶段忽略传入的 studentId

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

  window.APApi = {
    ROUTES: ROUTES,
    getSites: function () { return listItems("sites.json", "getSites"); },
    getVideos: function () { return listItems("videos.json", "getVideos", function (v) { return v.provider === "youtube"; }); },
    getProgress: function (/* studentId */) { return load("progress.sample.json", "getProgress"); },
    getNextAssessment: function (/* studentId */) {
      return load("assessment.sample.json", "getNextAssessment").then(function (a) { return a || null; });
    },
    getQaDemo: function () { return listItems("qa.sample.json", "getQaDemo"); },
    getCurrentUser: function () { return Promise.resolve(null); },

    // 以下仅预留
    startAssessment: notImplemented("startAssessment"),
    submitAttempt: notImplemented("submitAttempt"),
    getAttemptResult: notImplemented("getAttemptResult"),
    getWeeklyReport: notImplemented("getWeeklyReport"),
    askQuestion: notImplemented("askQuestion"),
    login: notImplemented("login"),
    logout: notImplemented("logout"),
    _demoStudentId: DEMO_STUDENT
  };
})();
