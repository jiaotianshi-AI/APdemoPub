/* 界面文案中英文词典 + 语言解析。两种语言的键必须完全一致。 */
(function () {
  "use strict";

  var dict = {
    zh: {
      "meta.title": "FocusGo",
      "meta.description": "AP 自学演示页：进度和测试、自学视频、AP 问答机器人与关联网站入口（演示版）。",
      "a11y.langGroup": "语言切换",
      "account.logout": "退出登录",
      "modal.close": "关闭",
      "common.loading": "加载中…",
      "error.module": "该模块暂时无法加载，请稍后刷新页面重试。",

      "mod.progress.title": "进度和测试",
      "mod.progress.tagline": "本阶段学习进度和测试安排",
      "progress.current": "当前学习阶段",
      "progress.subjectUnit": "{subject} · {unit}",
      "progress.noSubject": "尚未设置学习科目",
      "progress.percent": "学习进度",
      "progress.assessmentTime": "阶段测试最迟完成时间",
      "progress.countdown.dh": "你还有 {d} 天 {h} 小时",
      "progress.countdown.hm": "你还有 {h} 小时 {m} 分钟",
      "progress.countdown.m": "你还有 {m} 分钟",
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

      "common.confirm": "确认",
      "common.cancel": "取消",

      "status.scheduled": "待测试",
      "status.in_progress": "测试中",
      "status.submitted": "已提交，待评分",
      "status.graded": "已评分",

      "tests.open": "所有测试",
      "tests.title": "所有测试",
      "tests.empty": "还没有测试。",
      "tests.expandAll": "全部展开",
      "tests.collapseAll": "全部收起",
      "tests.loadError": "测试列表暂时无法加载，请稍后再试。",
      "tests.group.upcoming": "待测试",
      "tests.group.active": "进行中与待评分",
      "tests.group.past": "已评分的测试",
      "tests.time": "测试时间",
      "tests.duration": "测试时长",
      "tests.durationValue": "{m} 分钟",
      "tests.score": "测试分数",
      "tests.scoreValue": "{s} / 5",
      "tests.attempt": "第 {n} 次（重测）",
      "tests.questionsHidden": "题目会在测试开始后显示。",
      "tests.startNow": "马上测试",
      "tests.start": "开始测试",
      "tests.resume": "继续测试",
      "tests.review": "查看题目和我的答案",
      "tests.confirmEarly": "距离测试时间还有 {left}，你确认要提前测试吗？本次测试预计需要 {m} 分钟左右，测试期间，联网及 QA bot 功能将被禁用。",
      "tests.confirmReady": "现在可以开始测试了。本次测试预计需要 {m} 分钟左右，测试期间，联网及 QA bot 功能将被禁用。确认开始？",
      "tests.left.dh": "{d} 天 {h} 小时",
      "tests.left.hm": "{h} 小时 {m} 分钟",
      "tests.left.m": "{m} 分钟",

      "progress.ready": "可以开始测试",
      "progress.inProgress": "测试进行中",
      "exam.banner": "你有一场测试正在进行，联网相关功能和 QA bot 已关闭。",

      "exam.title": "测试",
      "exam.home": "返回首页",
      "exam.loading": "正在加载测试…",
      "exam.pre.heading": "准备开始测试",
      "exam.pre.duration": "测试时长：{m} 分钟",
      "exam.pre.rules": "开始后：① 系统开始倒计时，时间到会自动提交你已经写下的答案；② 联网相关功能和 QA bot 被禁用，请不要离开本页面，离开页面的次数和时间会被记录并告诉家长/老师；③ 点击“提交全部答案”后不能再修改。",
      "exam.pre.early": "还没到预定的测试时间（还有 {left}）。",
      "exam.pre.earlyConfirm": "我确认提前测试",
      "exam.method.title": "请选择提交解答的方式",
      "exam.method.typed": "在屏幕上输入文字",
      "exam.method.typed.hint": "用键盘（包括外接或蓝牙键盘）输入；也可以点平板键盘上的听写（麦克风）按钮，由系统把说话转成文字。",
      "exam.method.paper": "写在纸上",
      "exam.method.paper.hint": "每道题写一张纸，写上题号，交给家长/老师扫描上传。",
      "exam.method.typedShort": "屏幕输入",
      "exam.method.paperShort": "纸质作答",
      "exam.start": "开始计时",
      "exam.timeLeft": "剩余时间",
      "exam.timeUp": "时间到",
      "exam.q": "第 {n} 题 / 共 {total} 题",
      "exam.prev": "上一题",
      "exam.next": "下一题",
      "exam.goto": "第 {n} 题",
      "exam.submit": "提交全部答案",
      "exam.answer.label": "你的答案",
      "exam.saving": "保存中…",
      "exam.saved": "已保存",
      "exam.saveFailed": "保存失败，请检查网络。内容还在本页面中，会自动重试。",
      "exam.paper.note": "你选择的是纸质作答：请把每道题的解答写在纸上（每题一张，写上题号），交给家长/老师扫描上传。全部写完后点击“提交全部答案”。",
      "exam.openPdf": "在新标签页打开本题 PDF",
      "exam.pdf.fallback": "如果上面没有显示题目，请点击下面的链接在新标签页打开。",
      "exam.pdf.title": "第 {n} 题的题目",
      "exam.confirmSubmit": "确认提交全部答案？提交后不能再修改。",
      "exam.confirmSubmitUnanswered": "还有 {n} 道题没有填写答案。确认提交全部答案？提交后不能再修改。",
      "exam.done.heading": "已提交",
      "exam.done.text": "你的答案已经提交，等待家长/老师评分。",
      "exam.done.auto": "测试时间已到，系统已自动提交你写下的答案。",
      "exam.review.heading": "测试回顾",
      "exam.review.myAnswer": "我的答案",
      "exam.review.noAnswer": "（没有填写）",
      "exam.review.paper": "纸质答卷（扫描件）",
      "exam.review.paperOther": "其他答题文件",
      "exam.review.qScore": "评分 {s} / 5",
      "exam.review.weight": "权重 {w}",
      "exam.review.answerPdf": "回答 PDF：{name}",
      "exam.review.score": "汇总评分：{s} / 5",
      "exam.review.pending": "等待评分",
      "exam.review.questions": "题目",
      "exam.err.default": "无法完成操作，请返回首页后重试。",
      "exam.err.NOT_FOUND": "没有找到这场测试。",
      "exam.err.ANOTHER_IN_PROGRESS": "你有另一场测试正在进行，请先完成它。",
      "exam.err.NOT_STARTABLE": "这场测试现在不能开始。",
      "exam.err.NO_QUESTIONS": "这场测试还没有题目，请联系家长/老师。",
      "exam.err.TEST_ENDED": "测试时间已到，答案已自动提交。",
      "exam.err.NETWORK": "网络出错，请检查网络后重试。",

      "footer.disclaimer": "AP® 是 College Board 的注册商标。本站为非官方演示版，与 College Board、Khan Academy、Google Classroom 均无关联，也未获其认可。"
    },
    en: {
      "meta.title": "FocusGo",
      "meta.description": "AP self-study demo page: progress and tests, study videos, an AP Q&A bot, and related sites (demo version).",
      "a11y.langGroup": "Language",
      "account.logout": "Log out",
      "modal.close": "Close",
      "common.loading": "Loading…",
      "error.module": "This section could not be loaded right now. Please refresh the page and try again.",

      "mod.progress.title": "Progress and Tests",
      "mod.progress.tagline": "Study progress and test schedule for this stage",
      "progress.current": "Current stage",
      "progress.subjectUnit": "{subject} · {unit}",
      "progress.noSubject": "No study subject set yet",
      "progress.percent": "Study progress",
      "progress.assessmentTime": "Due time for stage test",
      "progress.countdown.dh": "You have {d} d {h} h left",
      "progress.countdown.hm": "You have {h} h {m} min left",
      "progress.countdown.m": "You have {m} min left",
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

      "common.confirm": "Confirm",
      "common.cancel": "Cancel",

      "status.scheduled": "Not taken yet",
      "status.in_progress": "In progress",
      "status.submitted": "Submitted, awaiting grading",
      "status.graded": "Graded",

      "tests.open": "All tests",
      "tests.title": "All tests",
      "tests.empty": "No tests yet.",
      "tests.expandAll": "Expand all",
      "tests.collapseAll": "Collapse all",
      "tests.loadError": "The test list could not be loaded right now. Please try again later.",
      "tests.group.upcoming": "To take",
      "tests.group.active": "In progress and awaiting grading",
      "tests.group.past": "Graded tests",
      "tests.time": "Test time",
      "tests.duration": "Duration",
      "tests.durationValue": "{m} min",
      "tests.score": "Score",
      "tests.scoreValue": "{s} / 5",
      "tests.attempt": "Attempt {n} (retake)",
      "tests.questionsHidden": "The questions are shown once the test starts.",
      "tests.startNow": "Test now",
      "tests.start": "Start test",
      "tests.resume": "Resume test",
      "tests.review": "View questions and my answers",
      "tests.confirmEarly": "There are {left} until the scheduled time. Do you want to take the test early? It will take about {m} minutes. During the test, internet access and the QA bot are disabled.",
      "tests.confirmReady": "You can start the test now. It will take about {m} minutes. During the test, internet access and the QA bot are disabled. Start now?",
      "tests.left.dh": "{d} d {h} h",
      "tests.left.hm": "{h} h {m} min",
      "tests.left.m": "{m} min",

      "progress.ready": "Ready to start",
      "progress.inProgress": "Test in progress",
      "exam.banner": "A test is in progress. Internet-related features and the QA bot are turned off.",

      "exam.title": "Test",
      "exam.home": "Back to home",
      "exam.loading": "Loading the test…",
      "exam.pre.heading": "Get ready to start",
      "exam.pre.duration": "Duration: {m} minutes",
      "exam.pre.rules": "Once you start: (1) the countdown begins, and your written answers are submitted automatically when time is up; (2) internet-related features and the QA bot are disabled — please stay on this page, because how often and how long you leave it is recorded and shown to your parent/teacher; (3) after you press “Submit all answers” you cannot change them.",
      "exam.pre.early": "The scheduled time has not arrived yet ({left} to go).",
      "exam.pre.earlyConfirm": "I confirm I want to take the test early",
      "exam.method.title": "Choose how you will submit your answers",
      "exam.method.typed": "Type on the screen",
      "exam.method.typed.hint": "Type with a keyboard (including an external or Bluetooth keyboard), or tap the dictation (microphone) button on the tablet keyboard so the system turns speech into text.",
      "exam.method.paper": "Write on paper",
      "exam.method.paper.hint": "Use one sheet per question, write the question number, and hand the sheets to your parent/teacher to scan and upload.",
      "exam.method.typedShort": "Typed",
      "exam.method.paperShort": "On paper",
      "exam.start": "Start the timer",
      "exam.timeLeft": "Time left",
      "exam.timeUp": "Time is up",
      "exam.q": "Question {n} of {total}",
      "exam.prev": "Previous",
      "exam.next": "Next",
      "exam.goto": "Question {n}",
      "exam.submit": "Submit all answers",
      "exam.answer.label": "Your answer",
      "exam.saving": "Saving…",
      "exam.saved": "Saved",
      "exam.saveFailed": "Could not save. Please check your connection. Your text is still on this page and will be retried automatically.",
      "exam.paper.note": "You chose to write on paper: write each answer on paper (one sheet per question, with the question number) and hand them to your parent/teacher to scan and upload. When you are done, press “Submit all answers”.",
      "exam.openPdf": "Open this question’s PDF in a new tab",
      "exam.pdf.fallback": "If the question is not shown above, open it in a new tab with the link below.",
      "exam.pdf.title": "Question {n}",
      "exam.confirmSubmit": "Submit all answers? You cannot change them afterwards.",
      "exam.confirmSubmitUnanswered": "{n} question(s) have no answer yet. Submit all answers? You cannot change them afterwards.",
      "exam.done.heading": "Submitted",
      "exam.done.text": "Your answers have been submitted and are waiting to be graded by your parent/teacher.",
      "exam.done.auto": "Time was up, so your written answers were submitted automatically.",
      "exam.review.heading": "Test review",
      "exam.review.myAnswer": "My answer",
      "exam.review.noAnswer": "(no answer)",
      "exam.review.paper": "Paper answers (scans)",
      "exam.review.paperOther": "Other answer files",
      "exam.review.qScore": "Score {s} / 5",
      "exam.review.weight": "Weight {w}",
      "exam.review.answerPdf": "Answer PDF: {name}",
      "exam.review.score": "Overall score: {s} / 5",
      "exam.review.pending": "Awaiting grading",
      "exam.review.questions": "Questions",
      "exam.err.default": "Something went wrong. Please go back to the home page and try again.",
      "exam.err.NOT_FOUND": "This test could not be found.",
      "exam.err.ANOTHER_IN_PROGRESS": "Another test is already in progress. Please finish it first.",
      "exam.err.NOT_STARTABLE": "This test cannot be started right now.",
      "exam.err.NO_QUESTIONS": "This test has no questions yet. Please contact your parent/teacher.",
      "exam.err.TEST_ENDED": "Time is up and your answers were submitted automatically.",
      "exam.err.NETWORK": "Network error. Please check your connection and try again.",

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
    pick: pick,
    // 右上角账号旁的时区：温哥华，时区：-7 / Vancouver, time zone: -7
    tzTitle: function (obj) { var t = pick(obj); return current === "zh" ? t.replace("，", "，时区：") : t.replace(", ", ", time zone: "); }
  };
})();
