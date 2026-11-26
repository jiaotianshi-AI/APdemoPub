'use strict';
// 督导者（家长/老师）接口：只能操作自己关联的学生。
const config = require('./config');
const { db, transaction, audit } = require('./db');
const { httpError, readJson, sendJson } = require('./http');
const files = require('./files');
const attempts = require('./attempts');
const { wallToIso, dateToIso } = require('./timeutil');

const TEXT_MAX = 64;
const DURATION_MIN = 5;
const DURATION_MAX = 300;
const DURATION_DEFAULT = 60;

/* ---------- 权限 ---------- */
function isLinked(supervisorId, studentId) {
  return !!db.prepare('SELECT 1 FROM supervisor_students WHERE supervisor_id = ? AND student_id = ?').get(supervisorId, studentId);
}
function requireLinkedStudent(ctx, studentId) {
  const id = Number(studentId);
  const stu = Number.isInteger(id) ? db.prepare("SELECT id, username FROM accounts WHERE id = ? AND type = 'student'").get(id) : null;
  if (!stu || !isLinked(ctx.account.id, stu.id)) throw httpError(404, 'NOT_FOUND', '没有找到这个学生。');
  return stu;
}
function requireAssessment(ctx, idText) {
  const id = Number(idText);
  const a = Number.isInteger(id) ? db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) : null;
  if (!a || !isLinked(ctx.account.id, a.student_id)) throw httpError(404, 'NOT_FOUND', '没有找到这条测试。');
  return a;
}

/* ---------- 输入检查 ---------- */
function cleanText(value, label) {
  if (typeof value !== 'string') throw httpError(422, 'INVALID_FIELD', `请填写${label}。`);
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw httpError(422, 'INVALID_FIELD', `请填写${label}。`);
  if ([...text].length > TEXT_MAX) throw httpError(422, 'INVALID_FIELD', `${label}不能超过 ${TEXT_MAX} 个字符。`);
  return text;
}
function cleanDuration(value) {
  if (value === undefined || value === null) return DURATION_DEFAULT;
  if (!Number.isInteger(value) || value < DURATION_MIN || value > DURATION_MAX) throw httpError(422, 'INVALID_DURATION', `测试时长必须是 ${DURATION_MIN}–${DURATION_MAX} 分钟的整数。`);
  return value;
}
function cleanWall(value, { future }) {
  const t = wallToIso(value, config.timezone);
  if (!t) throw httpError(422, 'INVALID_TIME', '请选择有效的测试日期和时间。');
  if (future && t.ms <= Date.now()) throw httpError(422, 'TIME_IN_PAST', '测试时间必须晚于现在。');
  return { wall: value, iso: t.iso, ms: t.ms };
}
function cleanStartDate(value, wall) {
  const t = dateToIso(value, config.timezone);
  if (!t) throw httpError(422, 'INVALID_START_DATE', '请选择有效的“本单元开始学习日期”。');
  if (String(value) > String(wall).slice(0, 10)) throw httpError(422, 'START_AFTER_TEST', '“本单元开始学习日期”不能晚于测试日期。');
  return { date: value, iso: t.iso };
}
function cleanFileIds(value, ctx, role, { min }) {
  if (!Array.isArray(value)) throw httpError(422, 'INVALID_FILES', '文件列表格式不正确。');
  const ids = [];
  for (const v of value) {
    if (!Number.isInteger(v) || v <= 0) throw httpError(422, 'INVALID_FILES', '文件列表格式不正确。');
    if (!ids.includes(v)) ids.push(v);
  }
  if (ids.length > config.maxFilesPerRole) throw httpError(422, 'TOO_MANY_FILES', `每条测试的${role === 'question' ? '题目' : '答题'}文件最多 ${config.maxFilesPerRole} 个。`);
  if (ids.length < min) throw httpError(422, 'NO_FILES', '请至少上传一个题目 PDF。');
  const get = db.prepare('SELECT * FROM files WHERE id = ?');
  const usedBy = db.prepare(`SELECT a.student_id FROM assessment_files af JOIN assessments a ON a.id = af.assessment_id WHERE af.file_id = ?`);
  for (const id of ids) {
    const f = get.get(id);
    if (!f) throw httpError(422, 'INVALID_FILES', '有文件不存在，请重新上传。');
    const mine = f.uploaded_by === ctx.account.id;
    const visible = usedBy.all(id).some((r) => isLinked(ctx.account.id, r.student_id));
    if (!mine && !visible) throw httpError(422, 'INVALID_FILES', '有文件不存在，请重新上传。');
  }
  return ids;
}

/* ---------- 输出 ---------- */
function filesOf(assessmentIds) {
  const map = new Map();
  if (!assessmentIds.length) return map;
  const rows = db.prepare(`SELECT af.assessment_id, af.role, f.id, f.original_name, f.size
    FROM assessment_files af JOIN files f ON f.id = af.file_id
    WHERE af.assessment_id IN (${assessmentIds.map(() => '?').join(',')}) ORDER BY af.position, f.id`).all(...assessmentIds);
  for (const r of rows) {
    if (!map.has(r.assessment_id)) map.set(r.assessment_id, { question: [], answer: [] });
    map.get(r.assessment_id)[r.role].push({ id: r.id, name: r.original_name, size: r.size });
  }
  return map;
}
function attemptInfo(assessmentId) {
  const att = attempts.getAttempt(assessmentId);
  return att ? Object.assign(attempts.publicAttempt(att), attempts.summary(att)) : null;
}
function serialize(a, fmap) {
  const f = fmap.get(a.id) || { question: [], answer: [] };
  return {
    id: a.id, studentId: a.student_id, subject: a.subject, unit: a.unit,
    unitStartDate: a.unit_start_date, scheduledWall: a.scheduled_wall, scheduledAt: a.scheduled_at, timezone: a.timezone,
    durationMinutes: a.duration_minutes,
    status: a.status, score: a.score, gradedAt: a.graded_at, attemptNo: a.attempt_no, retakeOf: a.retake_of,
    createdAt: a.created_at, questionFiles: f.question, answerFiles: f.answer,
    attempt: attemptInfo(a.id)
  };
}
function respond(res, status, ids) {
  const rows = db.prepare(`SELECT * FROM assessments WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  const fmap = filesOf(ids);
  const list = rows.map((r) => serialize(r, fmap));
  sendJson(res, status, ids.length === 1 && status !== 201 ? { assessment: list[0] } : { assessments: list });
}

function setFiles(assessmentId, role, ids) {
  const old = db.prepare('SELECT file_id FROM assessment_files WHERE assessment_id = ? AND role = ?').all(assessmentId, role).map((r) => r.file_id);
  db.prepare('DELETE FROM assessment_files WHERE assessment_id = ? AND role = ?').run(assessmentId, role);
  const ins = db.prepare('INSERT INTO assessment_files (assessment_id, file_id, role, position) VALUES (?, ?, ?, ?)');
  ids.forEach((fid, i) => ins.run(assessmentId, fid, role, i));
  return old.filter((x) => !ids.includes(x)); // 被移除的文件
}

/* ---------- 接口 ---------- */
function listStudents(res, ctx) {
  const rows = db.prepare(`SELECT a.id, a.username, a.subject, a.disabled FROM supervisor_students s
    JOIN accounts a ON a.id = s.student_id WHERE s.supervisor_id = ? ORDER BY a.username`).all(ctx.account.id);
  sendJson(res, 200, { students: rows.map((r) => ({ id: r.id, username: r.username, subject: r.subject || '', disabled: !!r.disabled })) });
}

function listAssessments(res, ctx, studentId) {
  attempts.finalizeOverdue();
  const stu = requireLinkedStudent(ctx, studentId);
  const rows = db.prepare('SELECT * FROM assessments WHERE student_id = ? ORDER BY scheduled_at DESC, id DESC').all(stu.id);
  const fmap = filesOf(rows.map((r) => r.id));
  sendJson(res, 200, { student: { id: stu.id, username: stu.username }, assessments: rows.map((r) => serialize(r, fmap)) });
}

async function createAssessments(req, res, ctx) {
  const body = await readJson(req);
  if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) throw httpError(422, 'NO_STUDENTS', '请至少选择一个学生。');
  const studentIds = [];
  for (const v of body.studentIds) {
    if (!Number.isInteger(v)) throw httpError(422, 'INVALID_STUDENTS', '学生列表格式不正确。');
    if (!studentIds.includes(v)) studentIds.push(v);
  }
  studentIds.forEach((id) => requireLinkedStudent(ctx, id));
  const subject = cleanText(body.subject, '测试科目');
  const unit = cleanText(body.unit, '测试单元');
  const when = cleanWall(body.scheduledWall, { future: true });
  const start = cleanStartDate(body.unitStartDate, when.wall);
  const questionIds = cleanFileIds(body.questionFileIds, ctx, 'question', { min: 1 });
  const duration = cleanDuration(body.durationMinutes);

  const now = new Date().toISOString();
  const created = transaction(() => {
    const ins = db.prepare(`INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, duration_minutes, status, attempt_no, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 1, ?, ?)`);
    const ids = [];
    for (const sid of studentIds) {
      const id = Number(ins.run(sid, ctx.account.id, subject, unit, start.date, start.iso, when.wall, when.iso, config.timezone, duration, now, now).lastInsertRowid);
      setFiles(id, 'question', questionIds);
      ids.push(id);
    }
    return ids;
  });
  audit(ctx.account.username, 'create_assessments', `${created.length} 个学生`, `${subject} ${unit} ${when.wall}`);
  respond(res, 201, created);
}

async function updateAssessment(req, res, ctx, idText) {
  const a = requireAssessment(ctx, idText);
  const body = await readJson(req);
  const keys = Object.keys(body);
  if (!keys.length) throw httpError(400, 'NOTHING_TO_UPDATE', '没有要修改的内容。');
  attempts.finalizeOverdue();
  const fresh = db.prepare('SELECT * FROM assessments WHERE id = ?').get(a.id);
  if (fresh.status === 'in_progress') throw httpError(409, 'IN_PROGRESS', '学生正在测试，完成后才能修改。');
  const allowed = fresh.status === 'scheduled'
    ? ['scheduledWall', 'subject', 'unit', 'unitStartDate', 'durationMinutes', 'questionFileIds', 'answerFileIds', 'score']
    : ['score', 'answerFileIds'];
  const bad = keys.filter((k) => !allowed.includes(k));
  if (bad.length) throw httpError(409, 'NOT_EDITABLE', '已提交或已评分的测试只能修改分数和答题文件，需要改时间请使用“重测”。');

  let { subject, unit, unit_start_date: startDate, unit_start_at: startAt, scheduled_wall: wall, scheduled_at: at } = a;
  if ('subject' in body) subject = cleanText(body.subject, '测试科目');
  if ('unit' in body) unit = cleanText(body.unit, '测试单元');
  if ('scheduledWall' in body && body.scheduledWall !== a.scheduled_wall) {
    const w = cleanWall(body.scheduledWall, { future: true });
    wall = w.wall; at = w.iso;
  }
  if ('unitStartDate' in body || wall !== a.scheduled_wall) {
    const s = cleanStartDate('unitStartDate' in body ? body.unitStartDate : startDate, wall);
    startDate = s.date; startAt = s.iso;
  }
  const duration = 'durationMinutes' in body ? cleanDuration(body.durationMinutes) : a.duration_minutes;
  const questionIds = 'questionFileIds' in body ? cleanFileIds(body.questionFileIds, ctx, 'question', { min: 1 }) : null;
  const answerIds = 'answerFileIds' in body ? cleanFileIds(body.answerFileIds, ctx, 'answer', { min: 0 }) : null;
  let score = null;
  if ('score' in body) {
    if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5) throw httpError(422, 'INVALID_SCORE', '分数必须是 1–5 的整数。');
    score = body.score;
  }

  const now = new Date().toISOString();
  const removed = transaction(() => {
    db.prepare('UPDATE assessments SET subject = ?, unit = ?, unit_start_date = ?, unit_start_at = ?, scheduled_wall = ?, scheduled_at = ?, duration_minutes = ?, updated_at = ? WHERE id = ?')
      .run(subject, unit, startDate, startAt, wall, at, duration, now, a.id);
    if (score !== null) db.prepare("UPDATE assessments SET score = ?, status = 'graded', graded_at = ?, graded_by = 'supervisor' WHERE id = ?").run(score, now, a.id);
    let gone = [];
    if (questionIds) gone = gone.concat(setFiles(a.id, 'question', questionIds));
    if (answerIds) gone = gone.concat(setFiles(a.id, 'answer', answerIds));
    return gone;
  });
  files.deleteIfUnreferenced(removed);
  audit(ctx.account.username, score !== null ? 'score_assessment' : 'update_assessment', String(a.id), keys.join(','));
  respond(res, 200, [a.id]);
}

// 学生这次测试的回答详情：每道题的文字答案、开始/提交时间、离开页面的情况
function viewAttempt(res, ctx, idText) {
  attempts.finalizeOverdue();
  const a = requireAssessment(ctx, idText);
  const att = attempts.getAttempt(a.id);
  if (!att) return sendJson(res, 200, { attempt: null, questions: attempts.questionFiles(a.id).map((q) => Object.assign(q, { answer: null })) });
  const answers = attempts.answersOf(att.id);
  const questions = attempts.questionFiles(a.id).map((q) => Object.assign(q, { answer: Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : null }));
  sendJson(res, 200, { attempt: Object.assign(attempts.publicAttempt(att), attempts.summary(att)), questions });
}

// AI 评分：接口已预留，尚未开发。以后按题目（questionFileId）或整次测试请求评分。
async function requestAiScore(req, res, ctx, idText) {
  requireAssessment(ctx, idText);
  await readJson(req);
  throw httpError(501, 'AI_SCORING_NOT_AVAILABLE', 'AI 评分功能尚未开放，接口已预留。');
}

function deleteAssessment(res, ctx, idText) {
  const a = requireAssessment(ctx, idText);
  if (a.status !== 'scheduled') throw httpError(409, 'NOT_DELETABLE', '只有还没开始的待测试才能删除。');
  const fileIds = db.prepare('SELECT file_id FROM assessment_files WHERE assessment_id = ?').all(a.id).map((r) => r.file_id);
  db.prepare('DELETE FROM assessments WHERE id = ?').run(a.id);
  files.deleteIfUnreferenced(fileIds);
  audit(ctx.account.username, 'delete_assessment', String(a.id));
  sendJson(res, 200, { ok: true });
}

async function retake(req, res, ctx, idText) {
  const a = requireAssessment(ctx, idText);
  if (a.status !== 'graded') throw httpError(409, 'NOT_GRADED', '只有已评分的测试才能重测。');
  const body = await readJson(req);
  const when = cleanWall(body.scheduledWall, { future: true });
  const start = cleanStartDate(a.unit_start_date, when.wall);
  const now = new Date().toISOString();
  const newId = transaction(() => {
    const id = Number(db.prepare(`INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, duration_minutes, status, attempt_no, retake_of, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`)
      .run(a.student_id, ctx.account.id, a.subject, a.unit, start.date, start.iso, when.wall, when.iso, config.timezone, a.duration_minutes, a.attempt_no + 1, a.id, now, now).lastInsertRowid);
    db.prepare(`INSERT INTO assessment_files (assessment_id, file_id, role, position)
      SELECT ?, file_id, role, position FROM assessment_files WHERE assessment_id = ? AND role = 'question'`).run(id, a.id);
    return id;
  });
  audit(ctx.account.username, 'retake_assessment', String(a.id), `新记录 ${newId}`);
  respond(res, 201, [newId]);
}

async function uploadFile(req, res, ctx) {
  const f = await files.saveUpload(req, ctx.account.id);
  sendJson(res, 201, { file: f });
}

function downloadFile(req, res, ctx, idText) {
  const id = Number(idText);
  const f = Number.isInteger(id) ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : null;
  let ok = false;
  if (f) {
    const users = db.prepare('SELECT a.student_id FROM assessment_files af JOIN assessments a ON a.id = af.assessment_id WHERE af.file_id = ?').all(f.id);
    ok = users.length ? users.some((r) => isLinked(ctx.account.id, r.student_id)) : f.uploaded_by === ctx.account.id;
  }
  if (!ok) throw httpError(404, 'NOT_FOUND', '没有找到这个文件。');
  files.sendPdf(req, res, f);
}

module.exports = async function supervisorApi(req, res, pathname, ctx) {
  const m = (re) => re.exec(pathname);
  let r;
  if (pathname === '/api/supervisor/students' && req.method === 'GET') return listStudents(res, ctx);
  if ((r = m(/^\/api\/supervisor\/students\/([^/]+)\/assessments$/)) && req.method === 'GET') return listAssessments(res, ctx, r[1]);
  if (pathname === '/api/supervisor/assessments' && req.method === 'POST') return createAssessments(req, res, ctx);
  if ((r = m(/^\/api\/supervisor\/assessments\/([^/]+)$/))) {
    if (req.method === 'PATCH') return updateAssessment(req, res, ctx, r[1]);
    if (req.method === 'DELETE') return deleteAssessment(res, ctx, r[1]);
  }
  if ((r = m(/^\/api\/supervisor\/assessments\/([^/]+)\/retake$/)) && req.method === 'POST') return retake(req, res, ctx, r[1]);
  if ((r = m(/^\/api\/supervisor\/assessments\/([^/]+)\/attempt$/)) && req.method === 'GET') return viewAttempt(res, ctx, r[1]);
  if ((r = m(/^\/api\/supervisor\/assessments\/([^/]+)\/ai-score$/)) && req.method === 'POST') return requestAiScore(req, res, ctx, r[1]);
  if (pathname === '/api/supervisor/files' && req.method === 'POST') return uploadFile(req, res, ctx);
  if ((r = m(/^\/api\/supervisor\/files\/([^/]+)$/)) && ['GET', 'HEAD'].includes(req.method)) return downloadFile(req, res, ctx, r[1]);
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
