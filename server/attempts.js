'use strict';
// 学生的一次答卷（测试流程）：开始、到时自动提交、统计离开页面的情况。时间一律以服务器为准。
const { db, transaction } = require('./db');

const GRACE_MS = 5000; // 到点后 5 秒内的保存仍接受（网络延迟）

function nowIso() { return new Date().toISOString(); }

function getAttempt(assessmentId) {
  return db.prepare('SELECT * FROM attempts WHERE assessment_id = ?').get(assessmentId) || null;
}

function questionFiles(assessmentId) {
  return db.prepare(`SELECT f.id, f.original_name AS name, f.size FROM assessment_files af JOIN files f ON f.id = af.file_id
    WHERE af.assessment_id = ? AND af.role = 'question' ORDER BY af.position, f.id`).all(assessmentId)
    .map((r, i) => ({ id: r.id, no: i + 1, name: r.name, size: r.size }));
}

function answerFiles(assessmentId) {
  return db.prepare(`SELECT f.id, f.original_name AS name, f.size FROM assessment_files af JOIN files f ON f.id = af.file_id
    WHERE af.assessment_id = ? AND af.role = 'answer' ORDER BY af.position, f.id`).all(assessmentId);
}

function answersOf(attemptId) {
  const out = {};
  for (const r of db.prepare('SELECT file_id, text FROM answers WHERE attempt_id = ?').all(attemptId)) out[r.file_id] = r.text;
  return out;
}

// 提交：把状态改为“已提交，待评分”。deadlineSubmit=true 表示到时自动提交（提交时刻记为截止时刻）
function finalize(attempt, { auto }) {
  const at = auto ? attempt.deadline_at : nowIso();
  transaction(() => {
    db.prepare('UPDATE attempts SET submitted_at = ?, auto_submitted = ? WHERE id = ? AND submitted_at IS NULL').run(at, auto ? 1 : 0, attempt.id);
    db.prepare("UPDATE assessments SET status = 'submitted', updated_at = ? WHERE id = ? AND status = 'in_progress'").run(nowIso(), attempt.assessment_id);
  });
}

// 把所有已过截止时间、还没提交的答卷自动提交。返回处理的数量
function finalizeOverdue() {
  const rows = db.prepare('SELECT * FROM attempts WHERE submitted_at IS NULL AND deadline_at <= ?').all(nowIso());
  rows.forEach((r) => finalize(r, { auto: true }));
  return rows.length;
}

// 离开页面的统计：leaveCount（不含为了打开题目 PDF 而离开的）、pdfLeaves、awaySeconds
function summary(attempt) {
  const events = db.prepare('SELECT ts, type, reason FROM attempt_events WHERE attempt_id = ? ORDER BY id').all(attempt.id);
  const endMs = attempt.submitted_at ? Date.parse(attempt.submitted_at) : Date.now();
  let leaveCount = 0, pdfLeaves = 0, away = 0, openSince = null;
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (e.type === 'leave') {
      if (openSince === null) { openSince = t; if (e.reason === 'pdf') pdfLeaves += 1; else leaveCount += 1; }
    } else if (openSince !== null) {
      away += Math.max(0, t - openSince);
      openSince = null;
    }
  }
  if (openSince !== null) away += Math.max(0, endMs - openSince);
  return { leaveCount, pdfLeaves, awaySeconds: Math.round(away / 1000) };
}

function publicAttempt(a) {
  if (!a) return null;
  return {
    startedAt: a.started_at, deadlineAt: a.deadline_at, submittedAt: a.submitted_at,
    autoSubmitted: !!a.auto_submitted, method: a.method, early: !!a.early
  };
}

module.exports = { GRACE_MS, nowIso, getAttempt, questionFiles, answerFiles, answersOf, finalize, finalizeOverdue, summary, publicAttempt };
