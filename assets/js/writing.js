/* Writing 板块（学生页）。界面文字集中在 TEXT 里，以英文为主；将来增加语种只需要补一份词典。
   所有来自服务器的文字都用 textContent 显示。 */
(function () {
  "use strict";

  var TEXT = {
    en: {
      notice: "What you write is read by an AI coach, and your parents or teacher can see it too.",
      noSchedule: "Your writing time has not been set up yet. Please ask your parent or teacher.",
      paused: "Writing is paused for now.",
      notDay: "No writing today. Enjoy your day!",
      notYet: "Today's writing opens at ",
      careNote: "If anything is worrying you, please talk to a parent or a teacher you trust.",
      noPrompts: "There are no topics left. Please ask your parent or teacher to add more.",
      chooseTitle: "Pick a topic for today",
      chooseHelp: "You can write one essay a day. Choose the topic you like best.",
      topic: "Topic",
      yourEssay: "Your essay",
      words: " words",
      saved: "Saved",
      saving: "Saving…",
      advice: "Give me some advice",
      done: "I'm done",
      thinking: "The coach is reading your essay… this can take up to a minute.",
      firstHelp: "Write a first draft. One or two sentences is fine! Then press “Give me some advice”.",
      round: "Round ",
      score: "Score",
      outOf: " / 5",
      questionsTitle: "Questions to help you",
      answerLabel: "Your answer",
      addHint: "Please add your answers to your essay. Then change your essay and ask for advice again.",
      progress: "Your progress",
      finalTitle: "Great job! Your essay is finished.",
      finalScore: "Final score",
      teacherSet: "Your parent or teacher set this score. The AI coach suggested ",
      teacherComment: "Comment from your parent or teacher",
      feedback: "Feedback",
      finalEssay: "Your final essay",
      confirmFinish: "You will get your final score now. You cannot change this essay afterwards.",
      pastNone: "Nothing here yet.",
      kindDone: "Finished",
      kindUnfinished: "Not finished",
      kindMissed: "Missed",
      show: "Show",
      hide: "Hide",
      loadError: "Something went wrong. Please try again.",
      networkError: "Network problem. Please try again.",
      coachBusy: "The coach could not answer right now. Please try again in a minute.",
      errors: {
        TOO_SHORT: "Please write a few sentences first.",
        NEED_ANSWER: "Please answer at least one question first.",
        NO_CHANGE: "Please add your answers to your essay first, then ask for advice again.",
        AI_NOT_CONFIGURED: "The AI coach is not set up yet. Please ask your parent or teacher.",
        TOO_FAST: "Please wait a few seconds and try again.",
        AI_BUSY: "Please wait, the coach is still working.",
        MAX_ROUNDS: "You have used all the rounds.",
        TOO_EARLY: "Please finish at least two rounds first.",
        NOT_AVAILABLE: "Writing is not open right now.",
        ALREADY_STARTED: "You already picked a topic today.",
        NO_GRADE: "Your grade has not been set. Please ask your parent or teacher."
      }
    }
  };
  var LANG = "en";
  var T = TEXT[LANG];
  var MAX_ROUNDS_FALLBACK = 6;

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function request(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        if (res.status === 401) window.location.href = "/login";
        var err = new Error(T.errors[data.error] || (/^AI_/.test(data.error || "") ? T.coachBusy : T.loadError));
        err.code = data.error;
        throw err;
      });
    }, function () { throw new Error(T.networkError); });
  }

  var state = { today: null, saveTimer: null, saving: false, dirty: false, busy: false };
  var ui = {};

  function wordCount(t) { return (String(t).match(/\S+/g) || []).length; }
  function fmtDay(day) {
    var p = day.split("-");
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p[1]) - 1] + " " + Number(p[2]) + ", " + p[0];
  }
  function fmtTime(hm) {
    var h = Number(hm.slice(0, 2));
    return (h % 12 === 0 ? 12 : h % 12) + ":" + hm.slice(3, 5) + " " + (h < 12 ? "AM" : "PM");
  }

  /* ---------- 今天 ---------- */
  function load() {
    return request("GET", "/api/writing/today").then(function (d) { state.today = d; render(); })
      .catch(function (e) { clear($("today")); $("today").appendChild(el("p", "msg error", e.message)); });
  }

  function render() {
    var d = state.today;
    var host = $("today");
    clear(host);
    ui = {};
    var simple = { no_schedule: T.noSchedule, paused: T.paused, not_day: T.notDay, no_prompts: T.noPrompts };
    if (simple[d.state]) { host.appendChild(card(simple[d.state])); return; }
    if (d.state === "not_yet") { host.appendChild(card(T.notYet + fmtTime(d.schedule.time) + ".")); return; }
    if (d.state === "choose") return renderChoose(host, d);
    if (d.state === "writing") return renderWriting(host, d.session);
    if (d.state === "done") return renderDone(host, d.session);
  }
  function card(text) { var c = el("section", "card"); c.appendChild(el("p", "lead", text)); return c; }

  function renderChoose(host, d) {
    var c = el("section", "card");
    c.appendChild(el("h2", "", T.chooseTitle));
    c.appendChild(el("p", "muted", T.chooseHelp));
    var ul = el("ul", "topic-list");
    d.prompts.forEach(function (p) {
      var li = el("li");
      var b = el("button", "topic-btn");
      b.type = "button";
      b.appendChild(el("span", "t-title", p.title));
      if (p.hint) b.appendChild(el("span", "t-hint", p.hint));
      b.addEventListener("click", function () {
        b.disabled = true;
        request("POST", "/api/writing/start", { promptId: p.id }).then(function (nd) { state.today = nd; render(); })
          .catch(function (e) { b.disabled = false; flash(c, e.message); load(); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    c.appendChild(ul);
    host.appendChild(c);
  }
  function flash(parent, text) {
    var m = parent.querySelector(".msg.error");
    if (!m) { m = el("p", "msg error"); m.setAttribute("role", "alert"); parent.appendChild(m); }
    m.textContent = text;
  }

  /* ---------- 写作中 ---------- */
  function lastTurn(s) { return s.turns.length ? s.turns[s.turns.length - 1] : null; }

  function renderWriting(host, s) {
    var wrap = el("div", "write-grid");

    // 左：作文区
    var left = el("section", "card essay-card");
    left.appendChild(el("p", "topic-line", T.topic + ": " + s.promptTitle));
    if (s.hint) left.appendChild(el("p", "muted", s.hint));
    var lab = el("label", "essay-label", T.yourEssay);
    lab.htmlFor = "essay";
    var ta = el("textarea", "essay");
    ta.id = "essay";
    ta.rows = 12;
    ta.maxLength = 20000;
    ta.value = s.draft;
    ta.setAttribute("spellcheck", "true");
    var meta = el("div", "essay-meta");
    ui.count = el("span", "", wordCount(s.draft) + T.words);
    ui.saveState = el("span", "save-state", "");
    ui.saveState.setAttribute("role", "status");
    meta.appendChild(ui.count);
    meta.appendChild(ui.saveState);
    var actions = el("div", "essay-actions");
    ui.adviceBtn = el("button", "btn primary", T.advice);
    ui.adviceBtn.type = "button";
    ui.adviceBtn.disabled = !s.canAdvice;
    ui.adviceBtn.addEventListener("click", function () { ask(s, false); });
    actions.appendChild(ui.adviceBtn);
    if (s.canFinish) {
      ui.doneBtn = el("button", "btn", T.done);
      ui.doneBtn.type = "button";
      ui.doneBtn.addEventListener("click", function () { confirmFinish(s); });
      actions.appendChild(ui.doneBtn);
    }
    ui.msg = el("p", "msg", "");
    ui.msg.setAttribute("role", "alert");
    ui.msg.hidden = true;
    left.appendChild(lab); left.appendChild(ta); left.appendChild(meta); left.appendChild(actions); left.appendChild(ui.msg);
    ui.essay = ta;
    ta.addEventListener("input", function () { ui.count.textContent = wordCount(ta.value) + T.words; scheduleSave(); });

    // 右：建议区
    var right = el("section", "card advice-card");
    right.setAttribute("aria-label", "Advice");
    renderAdvice(right, s);
    wrap.appendChild(left);
    wrap.appendChild(right);
    host.appendChild(wrap);
  }

  function renderAdvice(host, s) {
    var t = lastTurn(s);
    ui.answers = [];
    if (!t) { host.appendChild(el("p", "lead", T.firstHelp)); return; }
    host.appendChild(roundHead(t));
    host.appendChild(el("p", "feedback", t.feedback));
    if (t.flag) host.appendChild(el("p", "care-note", T.careNote));
    if (t.questions.length) {
      host.appendChild(el("h3", "", T.questionsTitle));
      var ol = el("ol", "q-list");
      t.questions.forEach(function (q, i) {
        var li = el("li", "q-item");
        if (q.quote) li.appendChild(el("p", "q-quote", "“" + q.quote + "”"));
        var qt = el("p", "q-text");
        qt.appendChild(el("span", "q-type", q.type));
        qt.appendChild(document.createTextNode(" " + q.text));
        li.appendChild(qt);
        var id = "ans-" + i;
        var al = el("label", "sr-only", T.answerLabel + " " + (i + 1));
        al.htmlFor = id;
        var a = el("textarea", "answer");
        a.id = id;
        a.rows = 2;
        a.maxLength = 1000;
        a.value = (t.answers && t.answers[i]) || "";
        a.addEventListener("input", function () { updateHint(); scheduleSave(); });
        li.appendChild(al);
        li.appendChild(a);
        ol.appendChild(li);
        ui.answers.push(a);
      });
      host.appendChild(ol);
      ui.hint = el("p", "add-hint", T.addHint);
      ui.hint.hidden = true;
      host.appendChild(ui.hint);
      updateHint();
    }
    host.appendChild(progressBlock(s));
  }
  function updateHint() {
    if (!ui.hint) return;
    ui.hint.hidden = !ui.answers.some(function (a) { return a.value.trim(); });
  }
  function roundHead(t) {
    var h = el("div", "round-head");
    h.appendChild(el("span", "round-no", T.round + t.round));
    var b = el("span", "score-badge", T.score + " " + t.score + T.outOf);
    h.appendChild(b);
    return h;
  }
  function progressBlock(s) {
    var box = el("div", "progress");
    if (s.turns.length < 1) return box;
    box.appendChild(el("h3", "", T.progress));
    var ul = el("ul", "steps");
    s.turns.forEach(function (t) {
      var li = el("li");
      li.appendChild(el("span", "step-r", T.round + t.round));
      li.appendChild(el("span", "step-s", String(t.score)));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  /* ---------- 自动保存 ---------- */
  function currentAnswers() { return (ui.answers || []).map(function (a) { return a.value; }); }
  function scheduleSave() {
    state.dirty = true;
    if (ui.saveState) ui.saveState.textContent = T.saving;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 1200);
  }
  function save() {
    clearTimeout(state.saveTimer);
    if (!ui.essay || !state.dirty || state.busy) return Promise.resolve();
    state.dirty = false;
    return request("PUT", "/api/writing/draft", { text: ui.essay.value, answers: currentAnswers() }).then(function () {
      if (ui.saveState && !state.dirty) ui.saveState.textContent = T.saved;
    }).catch(function () { state.dirty = true; if (ui.saveState) ui.saveState.textContent = ""; });
  }

  /* ---------- 请提建议 / 我写完了 ---------- */
  function setBusy(on, s) {
    state.busy = on;
    ui.adviceBtn.disabled = on || !s.canAdvice;
    if (ui.doneBtn) ui.doneBtn.disabled = on;
    ui.essay.readOnly = on;
    ui.msg.hidden = false;
    ui.msg.className = "msg";
    ui.msg.textContent = on ? T.thinking : "";
    ui.msg.hidden = !on;
  }
  function ask(s, finish) {
    clearTimeout(state.saveTimer);
    setBusy(true, s);
    request("POST", finish ? "/api/writing/finish" : "/api/writing/advice", { text: ui.essay.value, answers: currentAnswers() }).then(function (nd) {
      state.busy = false;
      state.today = nd;
      render();
      var top = document.querySelector(".advice-card, .result-card");
      if (top && top.scrollIntoView) top.scrollIntoView({ block: "nearest" });
      loadHistory();
    }).catch(function (e) {
      setBusy(false, s);
      ui.msg.hidden = false;
      ui.msg.className = "msg error";
      ui.msg.textContent = e.message;
    });
  }
  function confirmFinish(s) {
    var d = $("confirm-dialog");
    $("confirm-message").textContent = T.confirmFinish;
    function close() { if (d.close) d.close(); else d.removeAttribute("open"); }
    $("confirm-cancel").onclick = close;
    $("confirm-ok").onclick = function () { close(); ask(s, true); };
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }

  /* ---------- 完成后 ---------- */
  function renderDone(host, s) {
    var c = el("section", "card result-card");
    c.appendChild(el("h2", "", T.finalTitle));
    c.appendChild(el("p", "topic-line", T.topic + ": " + s.promptTitle));
    var big = el("p", "final-score");
    big.appendChild(el("span", "fs-label", T.finalScore));
    big.appendChild(el("span", "fs-num", s.finalScore + T.outOf));
    c.appendChild(big);
    if (s.supervisorScore) c.appendChild(el("p", "muted", T.teacherSet + s.aiScore + T.outOf + "."));
    if (s.supervisorComment) { c.appendChild(el("h3", "", T.teacherComment)); c.appendChild(el("p", "feedback", s.supervisorComment)); }
    var last = lastTurn(s);
    if (last) { c.appendChild(el("h3", "", T.feedback)); c.appendChild(el("p", "feedback", last.feedback)); if (last.flag) c.appendChild(el("p", "care-note", T.careNote)); }
    c.appendChild(progressBlock(s));
    c.appendChild(el("h3", "", T.finalEssay));
    c.appendChild(el("div", "final-essay", s.finalText || s.draft));
    host.appendChild(c);
  }

  /* ---------- 过往记录 ---------- */
  function loadHistory() {
    return request("GET", "/api/writing/history").then(function (d) {
      var ul = $("history");
      clear(ul);
      $("history-empty").hidden = d.items.length > 0;
      d.items.forEach(function (it) {
        var li = el("li", "h-item h-" + it.kind);
        var head = el("div", "h-head");
        head.appendChild(el("span", "h-day", fmtDay(it.day)));
        head.appendChild(el("span", "h-kind", it.kind === "done" ? T.kindDone : it.kind === "unfinished" ? T.kindUnfinished : T.kindMissed));
        if (it.promptTitle) head.appendChild(el("span", "h-title", it.promptTitle));
        if (it.kind === "done") head.appendChild(el("span", "score-badge", T.score + " " + it.finalScore + T.outOf));
        li.appendChild(head);
        if (it.scores.length) li.appendChild(el("p", "h-steps", it.scores.map(function (s, i) { return T.round + (i + 1) + ": " + s; }).join(" → ")));
        if (it.kind === "done") {
          var det = el("div", "h-detail");
          det.hidden = true;
          if (it.supervisorComment) det.appendChild(el("p", "feedback", T.teacherComment + ": " + it.supervisorComment));
          if (it.feedback) det.appendChild(el("p", "feedback", it.feedback));
          det.appendChild(el("div", "final-essay", it.essay));
          var tg = el("button", "btn", T.show);
          tg.type = "button";
          tg.setAttribute("aria-expanded", "false");
          tg.addEventListener("click", function () {
            det.hidden = !det.hidden;
            tg.textContent = det.hidden ? T.show : T.hide;
            tg.setAttribute("aria-expanded", det.hidden ? "false" : "true");
          });
          li.appendChild(tg);
          li.appendChild(det);
        }
        ul.appendChild(li);
      });
    }).catch(function () { /* 过往记录加载失败不影响今天的写作 */ });
  }

  function init() {
    $("notice").textContent = T.notice;
    request("GET", "/api/me").then(function (me) {
      var tz = me.tzLabel ? me.tzLabel.en.replace(", ", ", time zone: ") : "";
      $("whoami").textContent = me.username + (tz ? " (" + tz + ")" : "");
    }).catch(function () { /* 忽略 */ });
    window.addEventListener("beforeunload", function () { if (state.dirty) save(); });
    load();
    loadHistory();
  }
  init();
})();
