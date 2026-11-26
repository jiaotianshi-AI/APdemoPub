'use strict';
// 学生接口：自己的测试列表、开始测试、答题自动保存、提交、离开页面记录、受控的 PDF 访问。
// 原则：测试开始之前，学生看不到题目；学生不能修改任何测试内容。
const fs = require('fs');
const { db, transaction } = require('./db');
const { httpError, readJson, sendJson } = require('./http');
const attempts = require('./attempts');
const files = require('./files');

const ANSWER_MAX = 20000;
const EVENT_MAX = 500;

function ownAssessment(ctx, idText) {
  const id = Number(idText);
  const a = Number.isInteger(id) ? db.prepare('SELECT * FROM assessments WHERE id = ? AND student_id = ?').get(id, ctx.account.id) : null;
  if (!a) throw httpError(404, 'NOT_FOUND', '没有找到这条测试。');
  return a;
}

function baseOf(a) {
  return {
    id: a.id, subject: a.subject, unit: a.unit, scheduledWall: a.scheduled_wall, scheduledAt: a.scheduled_at, timezone: a.timezone,
    unitStartDate: a.unit_start_date, unitStartAt: a.unit_start_at, durationMinutes: a.duration_minutes,
    status: a.status, attemptNo: a.attempt_no, score: a.status === 'graded' ? a.score : null
  };
}

// 学生页“进度和测试”卡片要显示的那一场：测试中的 > 将来最近的待测试 > 已过时间但还没开始的（仍可开始）
function overview(res, ctx) {
  attempts.finalizeOverdue();
  const stu = ctx.account;
  const nowIso = attempts.nowIso();
  let a = db.prepare("SELECT * FROM assessments WHERE student_id = ? AND status = 'in_progress' ORDER BY scheduled_at LIMIT 1").get(stu.id);
  if (!a) a = db.prepare("SELECT * FROM assessments WHERE student_id = ? AND status = 'scheduled' AND scheduled_at > ? ORDER BY scheduled_at ASC, id ASC LIMIT 1").get(stu.id, nowIso);
  if (!a) a = db.prepare("SELECT * FROM assessments WHERE student_id = ? AND status = 'scheduled' ORDER BY scheduled_at DESC, id DESC LIMIT 1").get(stu.id);
  const attempt = a && a.status === 'in_progress' ? attempts.getAttempt(a.id) : null;
  sendJson(res, 200, {
    username: stu.username,
    subject: stu.subject || null,
    serverNow: nowIso,
    next: a ? Object.assign(baseOf(a), { deadlineAt: attempt ? attempt.deadline_at : null }) : null
  });
}

// 列表：未完成的测试不含任何题目信息；已提交/已评分的才带题目和答题文件
function listAssessments(res, ctx) {
  attempts.finalizeOverdue();
  const rows = db.prepare('SELECT * FROM assessments WHERE student_id = ? ORDER BY scheduled_at DESC, id DESC').all(ctx.account.id);
  const list = rows.map((a) => {
    const item = baseOf(a);
    const att = attempts.getAttempt(a.id);
    item.attempt = att ? attempts.publicAttempt(att) : null;
    item.questionCount = null;
    if (a.status === 'submitted' || a.status === 'graded') {
      item.questionFiles = attempts.questionFiles(a.id);
      item.answerFiles = attempts.answerFiles(a.id);
    }
    return item;
  });
  sendJson(res, 200, { serverNow: attempts.nowIso(), assessments: list });
}

function detail(res, ctx, idText) {
  attempts.finalizeOverdue();
  const a = ownAssessment(ctx, idText);
  const att = attempts.getAttempt(a.id);
  const out = { serverNow: attempts.nowIso(), assessment: baseOf(a), attempt: attempts.publicAttempt(att), questions: null, answers: {}, answerFiles: [] };
  const completed = a.status === 'submitted' || a.status === 'graded';
  if (a.status === 'in_progress' || completed) {
    out.questions = attempts.questionFiles(a.id);
    if (att) out.answers = attempts.answersOf(att.id);
  } else {
    out.questionCount = null; // 开始之前不告诉学生有几道题
  }
  if (completed) out.answerFiles = attempts.answerFiles(a.id);
  sendJson(res, 200, out);
}

async function start(req, res, ctx, idText) {
  attempts.finalizeOverdue();
  const a = ownAssessment(ctx, idText);
  const body = await readJson(req);
  if (a.status !== 'scheduled') throw httpError(409, 'NOT_STARTABLE', a.status === 'in_progress' ? '这场测试已经开始了。' : '这场测试已经完成，不能再开始。');
  if (!['typed', 'paper'].includes(body.method)) throw httpError(422, 'INVALID_METHOD', '请选择提交解答的方式。');
  if (db.prepare("SELECT 1 FROM assessments WHERE student_id = ? AND status = 'in_progress'").get(ctx.account.id)) {
    throw httpError(409, 'ANOTHER_IN_PROGRESS', '你有另一场测试正在进行，请先完成它。');
  }
  const nowMs = Date.now();
  const early = nowMs < Date.parse(a.scheduled_at);
  if (early && body.confirmEarly !== true) {
    throw httpError(409, 'EARLY_NOT_CONFIRMED', '这场测试还没到预定时间，需要确认提前测试。', { secondsEarly: Math.ceil((Date.parse(a.scheduled_at) - nowMs) / 1000) });
  }
  if (attempts.questionFiles(a.id).length === 0) throw httpError(409, 'NO_QUESTIONS', '这场测试还没有题目，请联系老师或家长。');

  const started = new Date(nowMs).toISOString();
  const deadline = new Date(nowMs + a.duration_minutes * 60000).toISOString();
  transaction(() => {
    db.prepare('INSERT INTO attempts (assessment_id, started_at, deadline_at, method, early) VALUES (?, ?, ?, ?, ?)').run(a.id, started, deadline, body.method, early ? 1 : 0);
    db.prepare("UPDATE assessments SET status = 'in_progress', updated_at = ? WHERE id = ?").run(started, a.id);
  });
  detail(res, ctx, a.id);
}

function activeAttempt(a) {
  const att = attempts.getAttempt(a.id);
  if (!att || att.submitted_at) throw httpError(409, 'TEST_ENDED', '这场测试已经结束。');
  if (Date.now() > Date.parse(att.deadline_at) + attempts.GRACE_MS) {
    attempts.finalizeOverdue();
    throw httpError(409, 'TEST_ENDED', '测试时间已到，答案已自动提交。');
  }
  return att;
}

async function saveAnswer(req, res, ctx, idText, fileIdText) {
  const a = ownAssessment(ctx, idText);
  const body = await readJson(req);
  const att = activeAttempt(a);
  if (att.method !== 'typed') throw httpError(409, 'METHOD_PAPER', '你选择的是纸质作答，不需要在网页上输入答案。');
  const fileId = Number(fileIdText);
  if (!attempts.questionFiles(a.id).some((q) => q.id === fileId)) throw httpError(404, 'NOT_FOUND', '没有这道题。');
  if (typeof body.text !== 'string') throw httpError(422, 'INVALID_ANSWER', '答案必须是文字。');
  const text = body.text.replace(/\u0000/g, '');
  if ([...text].length > ANSWER_MAX) throw httpError(422, 'ANSWER_TOO_LONG', `一道题的答案不能超过 ${ANSWER_MAX} 个字符。`);
  db.prepare(`INSERT INTO answers (attempt_id, file_id, text, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(attempt_id, file_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(att.id, fileId, text, attempts.nowIso());
  sendJson(res, 200, { ok: true, savedAt: attempts.nowIso() });
}

async function submit(req, res, ctx, idText) {
  attempts.finalizeOverdue();
  const a = ownAssessment(ctx, idText);
  await readJson(req);
  if (a.status === 'scheduled') throw httpError(409, 'NOT_STARTED', '这场测试还没有开始。');
  const att = attempts.getAttempt(a.id);
  if (att && !att.submitted_at) attempts.finalize(att, { auto: false }); // 已经提交（包括到时自动提交）的再次提交没有影响
  detail(res, ctx, a.id);
}

async function recordEvent(req, res, ctx, idText) {
  const a = ownAssessment(ctx, idText);
  const body = await readJson(req);
  if (!['leave', 'return'].includes(body.type)) throw httpError(422, 'INVALID_EVENT', '事件类型不正确。');
  const att = attempts.getAttempt(a.id);
  if (!att || att.submitted_at) return sendJson(res, 200, { ok: true, ignored: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM attempt_events WHERE attempt_id = ?').get(att.id).n;
  if (n >= EVENT_MAX) return sendJson(res, 200, { ok: true, ignored: true });
  const reason = body.reason === 'pdf' ? 'pdf' : null;
  db.prepare('INSERT INTO attempt_events (attempt_id, ts, type, reason) VALUES (?, ?, ?, ?)').run(att.id, attempts.nowIso(), body.type, reason);
  sendJson(res, 200, { ok: true });
}

// 学生能打开的 PDF：测试中可以看题目；提交后可以看题目和答题 PDF；开始之前什么都不能看
function downloadFile(req, res, ctx, idText) {
  attempts.finalizeOverdue();
  const id = Number(idText);
  const f = Number.isInteger(id) ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : null;
  let ok = false;
  if (f) {
    const rows = db.prepare(`SELECT af.role, a.status FROM assessment_files af JOIN assessments a ON a.id = af.assessment_id
      WHERE af.file_id = ? AND a.student_id = ?`).all(f.id, ctx.account.id);
    ok = rows.some((r) => r.status === 'submitted' || r.status === 'graded' || (r.status === 'in_progress' && r.role === 'question'));
  }
  if (!ok) throw httpError(404, 'NOT_FOUND', '没有找到这个文件。');
  files.sendPdf(req, res, f);
}

module.exports = async function studentApi(req, res, pathname, ctx) {
  let m;
  if (pathname === '/api/student/overview' && req.method === 'GET') return overview(res, ctx);
  if (pathname === '/api/student/assessments' && req.method === 'GET') return listAssessments(res, ctx);
  if ((m = /^\/api\/student\/assessments\/([^/]+)$/.exec(pathname)) && req.method === 'GET') return detail(res, ctx, m[1]);
  if ((m = /^\/api\/student\/assessments\/([^/]+)\/start$/.exec(pathname)) && req.method === 'POST') return start(req, res, ctx, m[1]);
  if ((m = /^\/api\/student\/assessments\/([^/]+)\/answers\/([^/]+)$/.exec(pathname)) && req.method === 'PUT') return saveAnswer(req, res, ctx, m[1], m[2]);
  if ((m = /^\/api\/student\/assessments\/([^/]+)\/submit$/.exec(pathname)) && req.method === 'POST') return submit(req, res, ctx, m[1]);
  if ((m = /^\/api\/student\/assessments\/([^/]+)\/events$/.exec(pathname)) && req.method === 'POST') return recordEvent(req, res, ctx, m[1]);
  if ((m = /^\/api\/student\/files\/([^/]+)$/.exec(pathname)) && ['GET', 'HEAD'].includes(req.method)) return downloadFile(req, res, ctx, m[1]);
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
