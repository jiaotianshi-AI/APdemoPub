'use strict';
// 督导者管理写作学生：写作日程（每天几点、哪几天、暂停）和题目库（每个孩子一份）。
// 只能管理已关联、且属于写作板块的学生。
const { db, audit } = require('./db');
const { httpError, readJson, sendJson } = require('./http');
const tzs = require('./timezones');
const subjects = require('./subjects');
const grades = require('./grades');
const student = require('./routes-writing');

const LOW_PROMPTS = 3;       // 剩余题目少于这个数时提醒督导者追加
const MAX_PROMPTS = 500;
const TITLE_MAX = 120;
const HINT_MAX = 300;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function requireWritingStudent(ctx, idText) {
  const id = Number(idText);
  const stu = Number.isInteger(id) ? db.prepare("SELECT * FROM accounts WHERE id = ? AND type = 'student'").get(id) : null;
  const linked = stu && db.prepare('SELECT 1 FROM supervisor_students WHERE supervisor_id = ? AND student_id = ?').get(ctx.account.id, stu.id);
  if (!stu || !linked) throw httpError(404, 'NOT_FOUND', '没有找到这个学生。');
  if (subjects.directionOf(stu) !== 'writing') throw httpError(422, 'NOT_WRITING', '这位学生不属于写作板块。');
  return stu;
}
function requirePrompt(ctx, idText) {
  const id = Number(idText);
  const p = Number.isInteger(id) ? db.prepare('SELECT * FROM writing_prompts WHERE id = ?').get(id) : null;
  const linked = p && db.prepare('SELECT 1 FROM supervisor_students WHERE supervisor_id = ? AND student_id = ?').get(ctx.account.id, p.student_id);
  if (!p || !linked) throw httpError(404, 'NOT_FOUND', '没有找到这个题目。');
  return p;
}

// 学生所在时区的今天（YYYY-MM-DD），用作日程的生效起始日
function todayIn(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function promptRow(p) { return { id: p.id, title: p.title, hint: p.hint || '', used: !!p.used_at, usedAt: p.used_at || null, createdAt: p.created_at }; }
function promptsLeft(studentId) { return db.prepare('SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ? AND used_at IS NULL').get(studentId).n; }

function flagsOf(studentId) {
  return db.prepare('SELECT COUNT(*) AS n FROM writing_flags f JOIN writing_sessions s ON s.id = f.session_id WHERE s.student_id = ? AND f.reviewed = 0').get(studentId).n;
}

function view(res, stu) {
  const sch = db.prepare('SELECT * FROM writing_schedules WHERE student_id = ?').get(stu.id);
  const prompts = db.prepare('SELECT * FROM writing_prompts WHERE student_id = ? ORDER BY used_at IS NOT NULL, id').all(stu.id);
  const left = prompts.filter((p) => !p.used_at).length;
  sendJson(res, 200, {
    student: { id: stu.id, username: stu.username, grade: stu.grade || '', gradeLabel: stu.grade ? grades.label(stu.grade) : null, timezone: stu.timezone, tzLabel: tzs.label(stu.timezone) },
    schedule: sch ? { configured: true, time: sch.time_of_day, days: sch.days, paused: !!sch.paused, startDate: sch.start_date } : { configured: false, time: '', days: 127, paused: false, startDate: null },
    prompts: prompts.map(promptRow),
    remaining: left,
    low: left < LOW_PROMPTS,
    lowThreshold: LOW_PROMPTS,
    unreviewedFlags: flagsOf(stu.id),
    missedStreak: student.missedStreak(stu.id, stu.timezone)
  });
}

async function saveSchedule(req, res, ctx, idText) {
  const stu = requireWritingStudent(ctx, idText);
  const body = await readJson(req);
  if (typeof body.time !== 'string' || !TIME_RE.test(body.time)) throw httpError(422, 'INVALID_TIME', '请选择每天写作的时间（例如 16:30）。');
  if (!Number.isInteger(body.days) || body.days < 1 || body.days > 127) throw httpError(422, 'INVALID_DAYS', '请至少选择一周中的一天。');
  if (typeof body.paused !== 'boolean') throw httpError(422, 'INVALID_PAUSED', '“暂停”必须是是或否。');
  const now = new Date().toISOString();
  const old = db.prepare('SELECT start_date FROM writing_schedules WHERE student_id = ?').get(stu.id);
  db.prepare(`INSERT INTO writing_schedules (student_id, time_of_day, days, paused, start_date, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id) DO UPDATE SET time_of_day = excluded.time_of_day, days = excluded.days, paused = excluded.paused, updated_at = excluded.updated_at`)
    .run(stu.id, body.time, body.days, body.paused ? 1 : 0, old ? old.start_date : todayIn(stu.timezone), now);
  audit(ctx.account.username, 'save_writing_schedule', stu.username, `${body.time} days=${body.days}${body.paused ? ' paused' : ''}`);
  view(res, stu);
}

function cleanText(v, max, field, required) {
  if (v === undefined || v === null || v === '') { if (required) throw httpError(422, 'INVALID_PROMPT', `请填写${field}。`); return ''; }
  if (typeof v !== 'string') throw httpError(422, 'INVALID_PROMPT', `${field}必须是文字。`);
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !t) throw httpError(422, 'INVALID_PROMPT', `请填写${field}。`);
  if ([...t].length > max) throw httpError(422, 'INVALID_PROMPT', `${field}不能超过 ${max} 个字符。`);
  return t;
}

async function addPrompt(req, res, ctx, idText) {
  const stu = requireWritingStudent(ctx, idText);
  const body = await readJson(req);
  const title = cleanText(body.title, TITLE_MAX, '题目', true);
  const hint = cleanText(body.hint, HINT_MAX, '提示语', false);
  if (db.prepare('SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ?').get(stu.id).n >= MAX_PROMPTS) throw httpError(409, 'TOO_MANY_PROMPTS', `每个学生的题目库最多 ${MAX_PROMPTS} 个题目。`);
  if (db.prepare('SELECT 1 FROM writing_prompts WHERE student_id = ? AND title = ? COLLATE NOCASE AND used_at IS NULL').get(stu.id, title)) throw httpError(409, 'PROMPT_EXISTS', '题目库里已经有这个题目了。');
  db.prepare('INSERT INTO writing_prompts (student_id, title, hint, created_at) VALUES (?, ?, ?, ?)').run(stu.id, title, hint || null, new Date().toISOString());
  audit(ctx.account.username, 'add_writing_prompt', stu.username);
  view(res, stu);
}

async function updatePrompt(req, res, ctx, idText) {
  const p = requirePrompt(ctx, idText);
  if (p.used_at) throw httpError(409, 'PROMPT_USED', '这个题目已经被孩子写过，不能再修改或删除（保留历史记录）。');
  const body = await readJson(req);
  if (!('title' in body) && !('hint' in body)) throw httpError(400, 'NOTHING_TO_UPDATE', '没有要修改的内容。');
  const title = 'title' in body ? cleanText(body.title, TITLE_MAX, '题目', true) : p.title;
  const hint = 'hint' in body ? cleanText(body.hint, HINT_MAX, '提示语', false) : (p.hint || '');
  db.prepare('UPDATE writing_prompts SET title = ?, hint = ? WHERE id = ?').run(title, hint || null, p.id);
  const stu = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.student_id);
  audit(ctx.account.username, 'update_writing_prompt', stu.username);
  view(res, stu);
}

function deletePrompt(res, ctx, idText) {
  const p = requirePrompt(ctx, idText);
  if (p.used_at) throw httpError(409, 'PROMPT_USED', '这个题目已经被孩子写过，不能再修改或删除（保留历史记录）。');
  db.prepare('DELETE FROM writing_prompts WHERE id = ?').run(p.id);
  const stu = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.student_id);
  audit(ctx.account.username, 'delete_writing_prompt', stu.username);
  view(res, stu);
}

/* ---------- 写作记录：回看每一轮、修改评分、安全标记 ---------- */
function requireSession(ctx, idText) {
  const id = Number(idText);
  const s = Number.isInteger(id) ? db.prepare('SELECT * FROM writing_sessions WHERE id = ?').get(id) : null;
  const linked = s && db.prepare('SELECT 1 FROM supervisor_students WHERE supervisor_id = ? AND student_id = ?').get(ctx.account.id, s.student_id);
  if (!s || !linked) throw httpError(404, 'NOT_FOUND', '没有找到这篇作文。');
  return s;
}
const parseJson = (t, f) => { try { return t ? JSON.parse(t) : f; } catch (e) { return f; } };

function sessionSummary(s) {
  const turns = db.prepare('SELECT round, score, done, flag FROM writing_turns WHERE session_id = ? ORDER BY round').all(s.id);
  const g = db.prepare('SELECT * FROM writing_grades WHERE session_id = ?').get(s.id);
  const flags = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(reviewed = 0), 0) AS open FROM writing_flags WHERE session_id = ?').get(s.id);
  const done = s.status === 'done';
  const ai = done && turns.length ? turns[turns.length - 1].score : null;
  return {
    id: s.id, day: s.day, promptTitle: s.prompt_title, status: done ? 'done' : 'unfinished', grade: s.grade || '',
    rounds: turns.length, scores: turns.map((t) => t.score), aiScore: ai,
    supervisorScore: g && g.supervisor_score ? g.supervisor_score : null, supervisorComment: (g && g.supervisor_comment) || '',
    finalScore: done ? ((g && g.supervisor_score) || ai) : null,
    flags: flags.total, openFlags: flags.open
  };
}

function listSessions(res, ctx, idText) {
  const stu = requireWritingStudent(ctx, idText);
  const rows = db.prepare('SELECT * FROM writing_sessions WHERE student_id = ? ORDER BY day DESC, id DESC LIMIT 200').all(stu.id);
  sendJson(res, 200, { sessions: rows.map(sessionSummary), unreviewedFlags: flagsOf(stu.id), missedStreak: student.missedStreak(stu.id, stu.timezone) });
}

function sessionDetail(res, ctx, idText) {
  const s = requireSession(ctx, idText);
  const turns = db.prepare('SELECT * FROM writing_turns WHERE session_id = ? ORDER BY round').all(s.id).map((t) => ({
    round: t.round, essay: t.essay, score: t.score, feedback: t.feedback, questions: parseJson(t.questions, []), answers: parseJson(t.answers, []), done: !!t.done, flag: !!t.flag, createdAt: t.created_at
  }));
  const g = db.prepare('SELECT model, provider FROM writing_grades WHERE session_id = ?').get(s.id);
  sendJson(res, 200, Object.assign(sessionSummary(s), { draft: s.draft, finalText: s.final_text, turns, model: g ? g.model : null, provider: g ? g.provider : null }));
}

// 修改评分：只有写完的作文才能改；score 为 null = 取消修改（恢复为 AI 的分数）；AI 的原始分数始终保留
async function saveGrade(req, res, ctx, idText) {
  const s = requireSession(ctx, idText);
  if (s.status !== 'done') throw httpError(409, 'NOT_DONE', '这篇作文还没有写完，不能评分。');
  const body = await readJson(req);
  const score = body.score === null ? null : body.score;
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) throw httpError(422, 'INVALID_SCORE', '评分必须是 1–5 的整数。');
  let comment = '';
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string') throw httpError(422, 'INVALID_COMMENT', '评语必须是文字。');
    comment = body.comment.replace(/\u0000/g, '').trim();
    if ([...comment].length > 1000) throw httpError(422, 'INVALID_COMMENT', '评语不能超过 1000 个字符。');
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO writing_grades (session_id, supervisor_score, supervisor_comment, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET supervisor_score = excluded.supervisor_score, supervisor_comment = excluded.supervisor_comment, updated_at = excluded.updated_at`)
    .run(s.id, score, comment || null, now);
  const stu = db.prepare('SELECT username FROM accounts WHERE id = ?').get(s.student_id);
  audit(ctx.account.username, 'writing_supervisor_grade', stu.username, `${s.day} ${score === null ? 'cleared' : score}`);
  sessionDetail(res, ctx, String(s.id));
}

function reviewFlags(res, ctx, idText) {
  const s = requireSession(ctx, idText);
  db.prepare('UPDATE writing_flags SET reviewed = 1 WHERE session_id = ?').run(s.id);
  const stu = db.prepare('SELECT username FROM accounts WHERE id = ?').get(s.student_id);
  audit(ctx.account.username, 'writing_review_flags', stu.username, s.day);
  sessionDetail(res, ctx, String(s.id));
}

module.exports = { LOW_PROMPTS, promptsLeft, flagsOf, async handle(req, res, pathname, ctx) {
  let r;
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)$/.exec(pathname)) && req.method === 'GET') return view(res, requireWritingStudent(ctx, r[1]));
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)\/schedule$/.exec(pathname)) && req.method === 'PUT') return saveSchedule(req, res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)\/prompts$/.exec(pathname)) && req.method === 'POST') return addPrompt(req, res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)\/sessions$/.exec(pathname)) && req.method === 'GET') return listSessions(res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/sessions\/([^/]+)$/.exec(pathname)) && req.method === 'GET') return sessionDetail(res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/sessions\/([^/]+)\/grade$/.exec(pathname)) && req.method === 'PUT') return saveGrade(req, res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/sessions\/([^/]+)\/review-flags$/.exec(pathname)) && req.method === 'POST') return reviewFlags(res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/prompts\/([^/]+)$/.exec(pathname))) {
    if (req.method === 'PATCH') return updatePrompt(req, res, ctx, r[1]);
    if (req.method === 'DELETE') return deletePrompt(res, ctx, r[1]);
  }
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
} };
