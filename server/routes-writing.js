'use strict';
// 写作板块的学生接口（/api/writing/*）：今天的任务、选题、草稿自动保存、“请提建议”循环、“我写完了”、过往记录。
// 每次“请提建议” = 一轮：AI 给当前作文打分并用 5W 提问；孩子回答后自己改写作文，再请提建议。
// 轮次：最少 2 轮、最多 6 轮；第 1 轮不会结束，从第 2 轮起 AI 判定 OK 就结束，第 6 轮一定结束。
const config = require('./config');
const { db, transaction, audit } = require('./db');
const { httpError, readJson, sendJson } = require('./http');
const tzs = require('./timezones');
const grades = require('./grades');
const settings = require('./settings');
const ai = require('./ai');
const writingAi = require('./writing-ai');

const MIN_ROUNDS = 2, MAX_ROUNDS = 6;
const MAX_DRAFT = 20000, MAX_ANSWER = 1000;
const DOWS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const busy = new Set();
const lastAdvice = new Map(); // session id → 上次“请提建议”的时间（防连点）

// 学生所在时区的 日期 / 时间 / 星期（周一 = 0）
function localParts(tz, date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}`, dow: DOWS[g('weekday')] };
}
function dowOfDay(day) { const d = new Date(day + 'T12:00:00Z'); return (d.getUTCDay() + 6) % 7; }
function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

const words = (t) => (String(t).toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
const sentences = (t) => String(t).split(/[.!?。！？]+/).filter((s) => s.trim()).length;
// 作文比上一轮“有实质变化”：多了一句话，或多了至少 5 个词，或增删改的词合计至少 8 个
function meaningfulChange(prev, cur) {
  const a = words(prev), b = words(cur);
  if (b.length - a.length >= 5 || sentences(cur) - sentences(prev) >= 1) return true;
  const count = (arr) => arr.reduce((m, w) => (m.set(w, (m.get(w) || 0) + 1), m), new Map());
  const ca = count(a), cb = count(b);
  let diff = 0;
  for (const k of new Set([...ca.keys(), ...cb.keys()])) diff += Math.abs((ca.get(k) || 0) - (cb.get(k) || 0));
  return diff >= 8;
}
const normText = (t) => String(t).replace(/\s+/g, ' ').trim();

function parseJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }
function turnView(t) { return { round: t.round, score: t.score, feedback: t.feedback, questions: parseJson(t.questions, []), answers: parseJson(t.answers, []), done: !!t.done, createdAt: t.created_at }; }
function sessionView(s) {
  const turns = db.prepare('SELECT * FROM writing_turns WHERE session_id = ? ORDER BY round').all(s.id).map(turnView);
  const p = s.prompt_id ? db.prepare('SELECT hint FROM writing_prompts WHERE id = ?').get(s.prompt_id) : null;
  const last = turns[turns.length - 1] || null;
  const done = s.status === 'done';
  return {
    id: s.id, day: s.day, promptTitle: s.prompt_title, hint: (p && p.hint) || '', status: s.status, draft: s.draft,
    finalText: s.final_text, rounds: turns.length, minRounds: MIN_ROUNDS, maxRounds: MAX_ROUNDS, turns,
    finalScore: done && last ? last.score : null,
    canAdvice: !done && turns.length < MAX_ROUNDS,
    canFinish: !done && turns.length >= MIN_ROUNDS
  };
}

function me(account) { return db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id); }
function todaySession(stu, day) { return db.prepare('SELECT * FROM writing_sessions WHERE student_id = ? AND day = ?').get(stu.id, day); }

function today(res, ctx) {
  const stu = me(ctx.account);
  const now = new Date();
  const lp = localParts(stu.timezone, now);
  const sch = db.prepare('SELECT * FROM writing_schedules WHERE student_id = ?').get(stu.id);
  const sess = todaySession(stu, lp.day);
  const out = {
    grade: stu.grade || '', gradeLabel: stu.grade ? grades.label(stu.grade) : null,
    timezone: stu.timezone, tzLabel: tzs.label(stu.timezone), day: lp.day, serverNow: now.toISOString(),
    schedule: sch ? { time: sch.time_of_day, days: sch.days, paused: !!sch.paused } : null
  };
  if (sess) { out.state = sess.status === 'done' ? 'done' : 'writing'; out.session = sessionView(sess); return sendJson(res, 200, out); }
  if (!sch) out.state = 'no_schedule';
  else if (sch.paused) out.state = 'paused';
  else if (!(sch.days & (1 << lp.dow))) out.state = 'not_day';
  else if (lp.hm < sch.time_of_day) out.state = 'not_yet';
  else {
    const prompts = db.prepare('SELECT id, title, hint FROM writing_prompts WHERE student_id = ? AND used_at IS NULL ORDER BY id').all(stu.id);
    out.state = prompts.length ? 'choose' : 'no_prompts';
    out.prompts = prompts.map((p) => ({ id: p.id, title: p.title, hint: p.hint || '' }));
  }
  sendJson(res, 200, out);
}

async function start(req, res, ctx) {
  const stu = me(ctx.account);
  const body = await readJson(req);
  const lp = localParts(stu.timezone, new Date());
  const sch = db.prepare('SELECT * FROM writing_schedules WHERE student_id = ?').get(stu.id);
  if (todaySession(stu, lp.day)) throw httpError(409, 'ALREADY_STARTED', '今天已经选过题目了。');
  if (!sch || sch.paused || !(sch.days & (1 << lp.dow)) || lp.hm < sch.time_of_day) throw httpError(409, 'NOT_AVAILABLE', '现在还不能开始写作。');
  if (!stu.grade) throw httpError(409, 'NO_GRADE', '管理员还没有设置你的年级，请联系管理员。');
  const p = Number.isInteger(body.promptId) ? db.prepare('SELECT * FROM writing_prompts WHERE id = ? AND student_id = ?').get(body.promptId, stu.id) : null;
  if (!p) throw httpError(404, 'NOT_FOUND', '没有这个题目。');
  if (p.used_at) throw httpError(409, 'PROMPT_USED', '这个题目已经写过了。');
  const now = new Date().toISOString();
  try {
    transaction(() => {
      db.prepare('INSERT INTO writing_sessions (student_id, day, prompt_id, prompt_title, grade, status, draft, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(stu.id, lp.day, p.id, p.title, stu.grade, 'writing', '', now);
      db.prepare('UPDATE writing_prompts SET used_at = ? WHERE id = ?').run(now, p.id);
    });
  } catch (e) { throw httpError(409, 'ALREADY_STARTED', '今天已经选过题目了。'); }
  return today(res, ctx);
}

function requireWriting(ctx) {
  const stu = me(ctx.account);
  const lp = localParts(stu.timezone, new Date());
  const s = todaySession(stu, lp.day);
  if (!s) throw httpError(409, 'NO_SESSION', '今天还没有开始写作。');
  if (s.status === 'done') throw httpError(409, 'ALREADY_DONE', '今天的作文已经完成，不能再修改。');
  return { stu, s, lp };
}

function cleanText(v) {
  if (typeof v !== 'string') throw httpError(422, 'INVALID_TEXT', '作文必须是文字。');
  if (v.length > MAX_DRAFT) throw httpError(422, 'TOO_LONG', `作文太长了（最多 ${MAX_DRAFT} 个字符）。`);
  return v.replace(/\u0000/g, '');
}
function cleanAnswers(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 3 || v.some((a) => typeof a !== 'string')) throw httpError(422, 'INVALID_ANSWERS', '回答格式不对。');
  return v.map((a) => a.replace(/\u0000/g, '').slice(0, MAX_ANSWER));
}
// 保存草稿；回答保存到最近一轮
function saveDraft(s, text, answers) {
  db.prepare('UPDATE writing_sessions SET draft = ? WHERE id = ?').run(text, s.id);
  if (answers !== undefined) {
    const t = db.prepare('SELECT * FROM writing_turns WHERE session_id = ? ORDER BY round DESC LIMIT 1').get(s.id);
    if (t) db.prepare('UPDATE writing_turns SET answers = ? WHERE id = ?').run(JSON.stringify(answers), t.id);
  }
}

async function autosave(req, res, ctx) {
  const { s } = requireWriting(ctx);
  const body = await readJson(req);
  saveDraft(s, cleanText(body.text), cleanAnswers(body.answers));
  sendJson(res, 200, { ok: true });
}

// 一轮：校验 → 调用 AI → 保存这一轮；AI 判定 OK（或最后一轮）则结束
async function round(req, res, ctx, { force }) {
  const { stu, s } = requireWriting(ctx);
  const body = await readJson(req);
  const text = cleanText(body.text);
  const answers = cleanAnswers(body.answers);
  saveDraft(s, text, answers); // 先保存，后面任何一步失败都不会丢内容
  const turns = db.prepare('SELECT * FROM writing_turns WHERE session_id = ? ORDER BY round').all(s.id);
  const prev = turns[turns.length - 1] || null;

  if (force) {
    if (turns.length < MIN_ROUNDS) throw httpError(409, 'TOO_EARLY', `至少要完成 ${MIN_ROUNDS} 轮之后才能结束。`);
    if (prev && normText(prev.essay) === normText(text)) return finishWithLast(res, ctx, s, prev); // 没有改动：直接用上一轮的分数结束
  }
  if (turns.length >= MAX_ROUNDS) throw httpError(409, 'MAX_ROUNDS', `最多 ${MAX_ROUNDS} 轮。`);
  if (words(text).length < 3) throw httpError(422, 'TOO_SHORT', '请先写几句话，再请提建议。');
  if (prev) {
    const prevAnswers = parseJson(prev.answers, []);
    if (parseJson(prev.questions, []).length && !prevAnswers.some((a) => a && a.trim())) throw httpError(422, 'NEED_ANSWER', '请先回答至少一个问题，再改写作文。');
    if (!force && !meaningfulChange(prev.essay, text)) throw httpError(422, 'NO_CHANGE', '请先把你的回答加入到作文中去，再请提建议。');
  }
  const cfg = settings.activeConfig();
  if (!cfg) throw httpError(409, 'AI_NOT_CONFIGURED', 'AI 还没有配置，请联系管理员。');
  const last = lastAdvice.get(s.id) || 0;
  if (new Date().getTime() - last < config.writingMinIntervalMs) throw httpError(429, 'TOO_FAST', '请稍等几秒再试。');
  if (busy.has(s.id)) throw httpError(409, 'AI_BUSY', '正在处理中，请稍等。');
  busy.add(s.id);
  lastAdvice.set(s.id, new Date().getTime());
  try {
    const roundNo = turns.length + 1;
    let r;
    try {
      r = await writingAi.advice(cfg, {
        gradeCode: s.grade, topic: s.prompt_title, round: roundNo, maxRounds: MAX_ROUNDS, minRounds: MIN_ROUNDS, essay: text,
        previous: prev ? { round: prev.round, score: prev.score, essay: prev.essay } : null, finish: force
      });
    } catch (e) {
      audit(stu.username, 'writing_advice_failed', null, e && e.code ? e.code : 'ERROR');
      throw httpError(e instanceof ai.AiError ? e.status : 502, (e && e.code) || 'AI_ERROR', e instanceof ai.AiError ? e.message : 'AI 出错了，请稍后再试。');
    }
    const now = new Date().toISOString();
    transaction(() => {
      db.prepare('INSERT INTO writing_turns (session_id, round, essay, score, feedback, questions, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.id, roundNo, text, r.score, r.feedback, JSON.stringify(r.questions), r.done ? 1 : 0, now);
      if (r.done) {
        db.prepare("UPDATE writing_sessions SET status = 'done', final_text = ?, finished_at = ? WHERE id = ?").run(text, now, s.id);
        db.prepare(`INSERT INTO writing_grades (session_id, ai_score, model, provider, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET ai_score = excluded.ai_score, model = excluded.model, provider = excluded.provider, updated_at = excluded.updated_at`)
          .run(s.id, r.score, r.model, r.provider, now);
      }
      if (r.safety) db.prepare('INSERT INTO writing_flags (session_id, reason, created_at) VALUES (?, ?, ?)').run(s.id, 'AI flagged round ' + roundNo, now);
    });
    audit(stu.username, 'writing_round', null, `round ${roundNo} score ${r.score}${r.done ? ' done' : ''}`);
  } finally { busy.delete(s.id); }
  return today(res, ctx);
}

function finishWithLast(res, ctx, s, last) {
  const now = new Date().toISOString();
  transaction(() => {
    db.prepare('UPDATE writing_turns SET done = 1 WHERE id = ?').run(last.id);
    db.prepare("UPDATE writing_sessions SET status = 'done', final_text = ?, finished_at = ? WHERE id = ?").run(last.essay, now, s.id);
    db.prepare(`INSERT INTO writing_grades (session_id, ai_score, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET ai_score = excluded.ai_score, updated_at = excluded.updated_at`).run(s.id, last.score, now);
  });
  return today(res, ctx);
}

// 过往记录：已完成的、没写完的（最多 60 条），以及最近 14 天内漏写的（按日程推算）
function history(res, ctx) {
  const stu = me(ctx.account);
  const lp = localParts(stu.timezone, new Date());
  const sessions = db.prepare("SELECT * FROM writing_sessions WHERE student_id = ? AND day < ? ORDER BY day DESC LIMIT 60").all(stu.id, lp.day);
  const items = sessions.map((s) => {
    const v = sessionView(s);
    return { day: s.day, kind: s.status === 'done' ? 'done' : 'unfinished', promptTitle: s.prompt_title, finalScore: v.finalScore, rounds: v.rounds, scores: v.turns.map((t) => t.score), essay: s.status === 'done' ? s.final_text : null, feedback: s.status === 'done' && v.turns.length ? v.turns[v.turns.length - 1].feedback : null };
  });
  const sch = db.prepare('SELECT * FROM writing_schedules WHERE student_id = ?').get(stu.id);
  if (sch) {
    const have = new Set(sessions.map((s) => s.day));
    // 只推算日程生效以来、最近 14 天内的日子；今天不算漏写（还可以写）
    for (let d = addDays(lp.day, -1), n = 0; d >= sch.start_date && n < 14; d = addDays(d, -1), n++) {
      if ((sch.days & (1 << dowOfDay(d))) && !have.has(d) && !db.prepare('SELECT 1 FROM writing_sessions WHERE student_id = ? AND day = ?').get(stu.id, d)) items.push({ day: d, kind: 'missed', promptTitle: null, finalScore: null, rounds: 0, scores: [], essay: null, feedback: null });
    }
  }
  items.sort((a, b) => (a.day < b.day ? 1 : -1));
  sendJson(res, 200, { items: items.slice(0, 60) });
}

module.exports = async function writingApi(req, res, pathname, ctx) {
  if (pathname === '/api/writing/today' && req.method === 'GET') return today(res, ctx);
  if (pathname === '/api/writing/start' && req.method === 'POST') return start(req, res, ctx);
  if (pathname === '/api/writing/draft' && req.method === 'PUT') return autosave(req, res, ctx);
  if (pathname === '/api/writing/advice' && req.method === 'POST') return round(req, res, ctx, { force: false });
  if (pathname === '/api/writing/finish' && req.method === 'POST') return round(req, res, ctx, { force: true });
  if (pathname === '/api/writing/history' && req.method === 'GET') return history(res, ctx);
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
module.exports.meaningfulChange = meaningfulChange;
module.exports.localParts = localParts;
