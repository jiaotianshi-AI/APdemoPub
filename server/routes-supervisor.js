'use strict';
// 督导者（家长/老师）接口：只能操作自己关联的学生。
const config = require('./config');
const { db, transaction, audit } = require('./db');
const { httpError, readJson, sendJson } = require('./http');
const files = require('./files');
const attempts = require('./attempts');
const { wallToIso, dateToIso, isoToWall } = require('./timeutil');
const tzs = require('./timezones');
const scoring = require('./scoring');
const settings = require('./settings');
const ai = require('./ai');

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
  const stu = Number.isInteger(id) ? db.prepare("SELECT id, username, timezone FROM accounts WHERE id = ? AND type = 'student'").get(id) : null;
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
function cleanWeights(value, count) {
  if (value === undefined || value === null) return new Array(count).fill(scoring.DEFAULT_WEIGHT);
  if (!Array.isArray(value) || value.length !== count) throw httpError(422, 'INVALID_WEIGHTS', '每道题都需要设置权重。');
  for (const w of value) if (!scoring.isValidWeight(w)) throw httpError(422, 'INVALID_WEIGHT', `每题的权重必须是 ${scoring.MIN_WEIGHT}–${scoring.MAX_WEIGHT} 的整数。`);
  return value;
}
function cleanWall(value, tz, { future }) {
  const t = wallToIso(value, tz);
  if (!t) throw httpError(422, 'INVALID_TIME', '请选择有效的测试日期和时间。');
  if (future && t.ms <= Date.now()) throw httpError(422, 'TIME_IN_PAST', '测试时间必须晚于现在。');
  return { wall: value, iso: t.iso, ms: t.ms };
}
function cleanStartDate(value, wall, tz) {
  const t = dateToIso(value, tz);
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
  const usedBy = db.prepare(`SELECT a.student_id FROM assessment_files af JOIN assessments a ON a.id = af.assessment_id WHERE af.file_id = ?
    UNION SELECT a.student_id FROM question_rubrics qr JOIN assessments a ON a.id = qr.assessment_id WHERE qr.file_id = ?`);
  for (const id of ids) {
    const f = get.get(id);
    if (!f) throw httpError(422, 'INVALID_FILES', '有文件不存在，请重新上传。');
    const mine = f.uploaded_by === ctx.account.id;
    const visible = usedBy.all(id, id).some((r) => isLinked(ctx.account.id, r.student_id));
    if (!mine && !visible) throw httpError(422, 'INVALID_FILES', '有文件不存在，请重新上传。');
  }
  return ids;
}

/* ---------- 输出 ---------- */
// 答卷信息：精确时刻 + 按这场测试的时区（学生所在时区）换算的“当地时间”
function withWalls(att, tz) {
  const info = Object.assign(attempts.publicAttempt(att), attempts.summary(att));
  info.startedWall = isoToWall(att.started_at, tz);
  info.deadlineWall = isoToWall(att.deadline_at, tz);
  info.submittedWall = att.submitted_at ? isoToWall(att.submitted_at, tz) : null;
  return info;
}
function attemptInfo(assessmentId, tz) {
  const att = attempts.getAttempt(assessmentId);
  return att ? withWalls(att, tz) : null;
}
function serialize(a) {
  const qs = attempts.questionRows(a.id, { text: true, supervisor: true });
  const sum = scoring.summarize(qs.map((q) => q.score), qs.map((q) => q.weight));
  return {
    id: a.id, studentId: a.student_id, subject: a.subject, unit: a.unit,
    unitStartDate: a.unit_start_date, scheduledWall: a.scheduled_wall, scheduledAt: a.scheduled_at, timezone: a.timezone,
    durationMinutes: a.duration_minutes,
    status: a.status, attemptNo: a.attempt_no, retakeOf: a.retake_of, createdAt: a.created_at, gradedAt: a.graded_at,
    // 汇总评分（按 server/scoring.js 的公式由各题评分算出）；旧数据没有逐题评分时保留原来的分数
    score: a.score,
    scoredCount: sum.scoredCount, questionCount: sum.questionCount, scoreAverage: sum.average, totalWeight: sum.totalWeight,
    // 每道题：题号、题目 PDF、回答 PDF（可为空）、评分（可为空）
    questionFiles: qs,
    // 旧版本一次性上传、没有对应到具体题目的答题文件
    answerFiles: attempts.answerFiles(a.id),
    attempt: attemptInfo(a.id, a.timezone)
  };
}
function respond(res, status, ids) {
  const rows = db.prepare(`SELECT * FROM assessments WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  const list = rows.map(serialize);
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
  const rows = db.prepare(`SELECT a.id, a.username, a.subject, a.disabled, a.timezone FROM supervisor_students s
    JOIN accounts a ON a.id = s.student_id WHERE s.supervisor_id = ? ORDER BY a.username`).all(ctx.account.id);
  sendJson(res, 200, { students: rows.map((r) => ({ id: r.id, username: r.username, subject: r.subject || '', disabled: !!r.disabled, timezone: r.timezone, tzLabel: tzs.label(r.timezone) })) });
}

function listAssessments(res, ctx, studentId) {
  attempts.finalizeOverdue();
  const stu = requireLinkedStudent(ctx, studentId);
  const rows = db.prepare('SELECT * FROM assessments WHERE student_id = ? ORDER BY scheduled_at DESC, id DESC').all(stu.id);
  sendJson(res, 200, { student: { id: stu.id, username: stu.username }, assessments: rows.map(serialize) });
}

async function createAssessments(req, res, ctx) {
  const body = await readJson(req);
  if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) throw httpError(422, 'NO_STUDENTS', '请至少选择一个学生。');
  const studentIds = [];
  for (const v of body.studentIds) {
    if (!Number.isInteger(v)) throw httpError(422, 'INVALID_STUDENTS', '学生列表格式不正确。');
    if (!studentIds.includes(v)) studentIds.push(v);
  }
  const studs = studentIds.map((id) => requireLinkedStudent(ctx, id));
  const subject = cleanText(body.subject, '测试科目');
  const unit = cleanText(body.unit, '测试单元');
  // 测试日期和时间按“每个学生自己所在的时区”解释（所选学生时区不同时，同一个当地时间会分别按各自时区生效）
  const per = studs.map((stu) => {
    const when = cleanWall(body.scheduledWall, stu.timezone, { future: true });
    const start = cleanStartDate(body.unitStartDate, when.wall, stu.timezone);
    return { stu, when, start };
  });
  const questionIds = cleanFileIds(body.questionFileIds, ctx, 'question', { min: 1 });
  const duration = cleanDuration(body.durationMinutes);
  const weights = cleanWeights(body.questionWeights, questionIds.length);

  const now = new Date().toISOString();
  const created = transaction(() => {
    const ins = db.prepare(`INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, duration_minutes, status, attempt_no, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 1, ?, ?)`);
    const ids = [];
    for (const { stu, when, start } of per) {
      const id = Number(ins.run(stu.id, ctx.account.id, subject, unit, start.date, start.iso, when.wall, when.iso, stu.timezone, duration, now, now).lastInsertRowid);
      setFiles(id, 'question', questionIds);
      questionIds.forEach((qid, i) => db.prepare('INSERT INTO question_weights (assessment_id, question_file_id, weight) VALUES (?, ?, ?)').run(id, qid, weights[i]));
      ids.push(id);
    }
    return ids;
  });
  audit(ctx.account.username, 'create_assessments', `${created.length} 个学生`, `${subject} ${unit} ${body.scheduledWall}`);
  respond(res, 201, created);
}

// 评分结果落到测试记录上：每道题都有评分 → 算出汇总评分、状态变为“已评分”；
// 否则汇总为空，已经是“已评分”的退回“已提交”（学生交过答卷）或“待测试”
function recomputeGrade(assessmentId, nowIso) {
  const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId);
  if (a.status === 'in_progress') return;
  const rowsNow = attempts.questionRows(assessmentId);
  const sum = scoring.summarize(rowsNow.map((q) => q.score), rowsNow.map((q) => q.weight));
  if (sum.overall !== null) {
    db.prepare("UPDATE assessments SET status = 'graded', score = ?, graded_at = ?, graded_by = 'supervisor', updated_at = ? WHERE id = ?")
      .run(sum.overall, a.status === 'graded' && a.graded_at ? a.graded_at : nowIso, nowIso, assessmentId);
  } else if (a.status === 'graded') {
    const att = attempts.getAttempt(assessmentId);
    db.prepare('UPDATE assessments SET status = ?, score = NULL, graded_at = NULL, graded_by = NULL, updated_at = ? WHERE id = ?')
      .run(att && att.submitted_at ? 'submitted' : 'scheduled', nowIso, assessmentId);
  }
}

function cleanQuestionUpdates(value, validQuestionIds, ctx) {
  if (!Array.isArray(value) || value.length === 0 || value.length > config.maxFilesPerRole) throw httpError(422, 'INVALID_QUESTIONS', '题目评分/回答的格式不正确。');
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError(422, 'INVALID_QUESTIONS', '题目评分/回答的格式不正确。');
    const bad = Object.keys(item).filter((k) => !['questionFileId', 'answerFileId', 'score', 'weight', 'rubricFileId'].includes(k));
    if (bad.length) throw httpError(422, 'INVALID_QUESTIONS', '题目评分/回答里有不支持的内容。');
    const qid = item.questionFileId;
    if (!Number.isInteger(qid) || !validQuestionIds.includes(qid)) throw httpError(422, 'INVALID_QUESTION', '有题目不属于这场测试。');
    if (seen.has(qid)) throw httpError(422, 'INVALID_QUESTIONS', '同一道题重复出现了。');
    seen.add(qid);
    const u = { questionFileId: qid };
    if ('score' in item) {
      if (item.score !== null && !scoring.isValidScore(item.score)) throw httpError(422, 'INVALID_SCORE', `每题的评分必须是 ${scoring.MIN_SCORE}–${scoring.MAX_SCORE} 的整数，或留空。`);
      u.score = item.score;
    }
    if ('weight' in item) {
      if (!scoring.isValidWeight(item.weight)) throw httpError(422, 'INVALID_WEIGHT', `每题的权重必须是 ${scoring.MIN_WEIGHT}–${scoring.MAX_WEIGHT} 的整数。`);
      u.weight = item.weight;
    }
    if ('rubricFileId' in item) {
      if (item.rubricFileId !== null) cleanFileIds([item.rubricFileId], ctx, 'rubric', { min: 1 });
      u.rubricFileId = item.rubricFileId;
    }
    if ('answerFileId' in item) {
      if (item.answerFileId !== null) cleanFileIds([item.answerFileId], ctx, 'answer', { min: 1 });
      u.answerFileId = item.answerFileId;
    }
    out.push(u);
  }
  return out;
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
    ? ['scheduledWall', 'subject', 'unit', 'unitStartDate', 'durationMinutes', 'questionFileIds', 'questionWeights', 'questions']
    : ['questions'];
  const bad = keys.filter((k) => !allowed.includes(k));
  if (bad.length) throw httpError(409, 'NOT_EDITABLE', fresh.status === 'scheduled' ? '不支持修改这个内容。' : '已提交或已评分的测试只能修改每题的回答文件、评分和权重，需要改时间请使用“重测”。');

  const stuTz = db.prepare('SELECT timezone FROM accounts WHERE id = ?').get(a.student_id).timezone; // 学生当前所在时区
  let { subject, unit, unit_start_date: startDate, unit_start_at: startAt, scheduled_wall: wall, scheduled_at: at } = a;
  let tzForRow = a.timezone;
  if ('subject' in body) subject = cleanText(body.subject, '测试科目');
  if ('unit' in body) unit = cleanText(body.unit, '测试单元');
  if ('scheduledWall' in body && body.scheduledWall !== a.scheduled_wall) {
    const w = cleanWall(body.scheduledWall, stuTz, { future: true });
    wall = w.wall; at = w.iso; tzForRow = stuTz;
  }
  if ('unitStartDate' in body || wall !== a.scheduled_wall) {
    const s = cleanStartDate('unitStartDate' in body ? body.unitStartDate : startDate, wall, stuTz);
    startDate = s.date; startAt = s.iso; tzForRow = stuTz;
  }
  const duration = 'durationMinutes' in body ? cleanDuration(body.durationMinutes) : a.duration_minutes;
  const questionIds = 'questionFileIds' in body ? cleanFileIds(body.questionFileIds, ctx, 'question', { min: 1 }) : null;
  if ('questionWeights' in body && !questionIds) throw httpError(422, 'INVALID_WEIGHTS', '修改题目权重时需要同时提供题目文件列表（questionFileIds），或改用 questions 里的 weight。');
  const newWeights = 'questionWeights' in body ? cleanWeights(body.questionWeights, questionIds.length) : null;
  const currentQuestionIds = attempts.questionFiles(a.id).map((q) => q.id);
  const updates = 'questions' in body ? cleanQuestionUpdates(body.questions, questionIds || currentQuestionIds, ctx) : null;

  const now = new Date().toISOString();
  const removed = transaction(() => {
    db.prepare('UPDATE assessments SET subject = ?, unit = ?, unit_start_date = ?, unit_start_at = ?, scheduled_wall = ?, scheduled_at = ?, timezone = ?, duration_minutes = ?, updated_at = ? WHERE id = ?')
      .run(subject, unit, startDate, startAt, wall, at, tzForRow, duration, now, a.id);
    let gone = [];
    if (questionIds) {
      gone = gone.concat(setFiles(a.id, 'question', questionIds));
      // 被移除的题目：它的回答 PDF 和评分一并清除
      const dropped = currentQuestionIds.filter((q) => !questionIds.includes(q));
      for (const q of dropped) {
        const m = db.prepare('SELECT file_id FROM question_answers WHERE assessment_id = ? AND question_file_id = ?').get(a.id, q);
        if (m) {
          db.prepare("DELETE FROM assessment_files WHERE assessment_id = ? AND file_id = ? AND role = 'answer'").run(a.id, m.file_id);
          gone.push(m.file_id);
        }
        db.prepare('DELETE FROM question_answers WHERE assessment_id = ? AND question_file_id = ?').run(a.id, q);
        db.prepare('DELETE FROM question_scores WHERE assessment_id = ? AND question_file_id = ?').run(a.id, q);
        db.prepare('DELETE FROM question_weights WHERE assessment_id = ? AND question_file_id = ?').run(a.id, q);
        const rb = db.prepare('SELECT file_id FROM question_rubrics WHERE assessment_id = ? AND question_file_id = ?').get(a.id, q);
        if (rb) gone.push(rb.file_id);
        db.prepare('DELETE FROM question_rubrics WHERE assessment_id = ? AND question_file_id = ?').run(a.id, q);
      }
      // 新加入的题目默认权重 1（没有记录即为 1），按需要由 questionWeights 设置
    }
    if (newWeights) questionIds.forEach((qid, i) => db.prepare('INSERT OR REPLACE INTO question_weights (assessment_id, question_file_id, weight) VALUES (?, ?, ?)').run(a.id, qid, newWeights[i]));
    if (updates) {
      for (const u of updates) {
        if ('answerFileId' in u) {
          const old = db.prepare('SELECT file_id FROM question_answers WHERE assessment_id = ? AND question_file_id = ?').get(a.id, u.questionFileId);
          if (old && old.file_id !== u.answerFileId) {
            db.prepare("DELETE FROM assessment_files WHERE assessment_id = ? AND file_id = ? AND role = 'answer'").run(a.id, old.file_id);
            db.prepare('DELETE FROM question_answers WHERE assessment_id = ? AND question_file_id = ?').run(a.id, u.questionFileId);
            gone.push(old.file_id);
          }
          if (u.answerFileId !== null) {
            const used = db.prepare('SELECT question_file_id FROM question_answers WHERE assessment_id = ? AND file_id = ? AND question_file_id != ?').get(a.id, u.answerFileId, u.questionFileId);
            if (used) throw httpError(422, 'DUPLICATE_ANSWER_FILE', '同一个文件不能作为两道题的回答。');
            db.prepare("INSERT OR IGNORE INTO assessment_files (assessment_id, file_id, role, position) VALUES (?, ?, 'answer', 0)").run(a.id, u.answerFileId);
            db.prepare('INSERT OR REPLACE INTO question_answers (assessment_id, question_file_id, file_id) VALUES (?, ?, ?)').run(a.id, u.questionFileId, u.answerFileId);
          }
        }
        if ('rubricFileId' in u) {
          const old = db.prepare('SELECT file_id FROM question_rubrics WHERE assessment_id = ? AND question_file_id = ?').get(a.id, u.questionFileId);
          if (old && old.file_id !== u.rubricFileId) { db.prepare('DELETE FROM question_rubrics WHERE assessment_id = ? AND question_file_id = ?').run(a.id, u.questionFileId); gone.push(old.file_id); }
          if (u.rubricFileId !== null) db.prepare('INSERT OR REPLACE INTO question_rubrics (assessment_id, question_file_id, file_id) VALUES (?, ?, ?)').run(a.id, u.questionFileId, u.rubricFileId);
        }
        if ('weight' in u) db.prepare('INSERT OR REPLACE INTO question_weights (assessment_id, question_file_id, weight) VALUES (?, ?, ?)').run(a.id, u.questionFileId, u.weight);
        if ('score' in u) {
          if (u.score === null) db.prepare('DELETE FROM question_scores WHERE assessment_id = ? AND question_file_id = ?').run(a.id, u.questionFileId);
          else db.prepare('INSERT OR REPLACE INTO question_scores (assessment_id, question_file_id, score) VALUES (?, ?, ?)').run(a.id, u.questionFileId, u.score);
        }
      }
    }
    // 只有评分或题目发生变化时才重新计算（只传回答 PDF 不会动旧数据里的分数）
    if (questionIds || newWeights || (updates && updates.some((u) => 'score' in u || 'weight' in u))) recomputeGrade(a.id, now);
    return gone;
  });
  files.deleteIfUnreferenced(removed);
  audit(ctx.account.username, updates ? 'grade_assessment' : 'update_assessment', String(a.id), keys.join(','));
  respond(res, 200, [a.id]);
}

// 学生这次测试的回答详情：每道题的文字答案、开始/提交时间、离开页面的情况
function viewAttempt(res, ctx, idText) {
  attempts.finalizeOverdue();
  const a = requireAssessment(ctx, idText);
  const att = attempts.getAttempt(a.id);
  const rows = attempts.questionRows(a.id, { text: true, supervisor: true });
  if (!att) return sendJson(res, 200, { attempt: null, questions: rows.map((q) => Object.assign(q, { answer: null })) });
  const answers = attempts.answersOf(att.id);
  const questions = rows.map((q) => Object.assign(q, { answer: Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : null }));
  sendJson(res, 200, { attempt: withWalls(att, a.timezone), questions });
}

// AI 判分：把 3 样东西发给管理员设定的 AI —— ① 题目 PDF ② 学生回答（文字或 PDF，二选一）③ 判分标准 PDF。
// 结果（评分 1–5 + 反馈）返回给督导者，由督导者决定是否采用；这里不会自动写入每题评分。
const aiBusy = new Set();

function aiFile(ctx, id, what) {
  if (!Number.isInteger(id)) throw httpError(422, 'INVALID_FILE', `请先上传${what}。`);
  cleanFileIds([id], ctx, 'ai', { min: 1 }); // 只能用自己上传的、或关联学生测试里的文件
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}

async function requestAiScore(req, res, ctx, idText) {
  const a = requireAssessment(ctx, idText);
  const body = await readJson(req);
  attempts.finalizeOverdue();
  const fresh = db.prepare('SELECT * FROM assessments WHERE id = ?').get(a.id);
  if (fresh.status === 'in_progress') throw httpError(409, 'IN_PROGRESS', '学生正在测试，完成后才能请求 AI 评分。');

  const qid = body.questionFileId;
  const qrow = attempts.questionRows(a.id, { text: true }).find((q) => q.id === qid);
  if (!qrow) throw httpError(422, 'INVALID_QUESTION', '请选择这场测试里的一道题。');
  if (!['text', 'pdf'].includes(body.answerSource)) throw httpError(422, 'INVALID_SOURCE', '学生回答请二选一：文字，或回答 PDF。');
  const rubric = aiFile(ctx, body.rubricFileId, '这道题的判分标准 PDF');
  const input = { questionFile: db.prepare('SELECT * FROM files WHERE id = ?').get(qid), rubricFile: rubric };
  if (body.answerSource === 'text') {
    if (qrow.answerText === null || qrow.answerText === undefined || !qrow.answerText.trim()) throw httpError(422, 'NO_ANSWER_TEXT', '学生没有为这道题输入回答文字（纸质作答或没有填写）。请改用回答 PDF。');
    input.answerText = qrow.answerText;
  } else {
    input.answerFile = aiFile(ctx, body.answerFileId, '这道题的回答 PDF');
    if (input.answerFile.id === rubric.id) throw httpError(422, 'SAME_FILE', '回答 PDF 和判分标准不能是同一个文件。');
  }

  const provider = settings.activeProvider();
  const pc = settings.getProvider(provider);
  const def = ai.PROVIDERS[provider];
  const cfg = { provider, model: pc.model || def.defaultModel, apiKey: pc.apiKey, baseUrl: pc.baseUrl, pdfNative: pc.pdfNative, systemPrompt: settings.getPrompt().systemPrompt };
  if (!cfg.apiKey || !cfg.model || (provider === 'custom' && !cfg.baseUrl)) throw httpError(409, 'AI_NOT_CONFIGURED', 'AI 评分还没有配置：请管理员在“AI 评分设置”里选择服务商并填写模型和 API 密钥。');
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  if (db.prepare('SELECT COUNT(*) AS n FROM ai_grades WHERE requested_by = ? AND created_at > ?').get(ctx.account.id, since).n >= config.aiMaxPerHour) {
    throw httpError(429, 'AI_RATE_LIMIT', `一小时内最多请求 ${config.aiMaxPerHour} 次 AI 评分，请稍后再试。`);
  }
  const key = a.id + ':' + qid;
  if (aiBusy.has(key)) throw httpError(409, 'AI_BUSY', '这道题正在评分中，请稍等。');
  aiBusy.add(key);
  const now = () => new Date().toISOString();
  try {
    let result;
    try {
      result = await ai.grade(cfg, input);
    } catch (e) {
      const code = e && e.code ? e.code : 'AI_ERROR';
      const message = e instanceof ai.AiError ? e.message : 'AI 评分出错了，请稍后再试。';
      db.prepare('INSERT INTO ai_grades (assessment_id, question_file_id, requested_by, source, status, model, provider, error_code, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(a.id, qid, ctx.account.id, body.answerSource, 'error', cfg.model, provider, code, message.slice(0, 500), now());
      audit(ctx.account.username, 'ai_score_failed', String(a.id), code);
      throw httpError(e instanceof ai.AiError ? e.status : 502, code, message);
    }
    const at = now();
    db.prepare('INSERT INTO ai_grades (assessment_id, question_file_id, requested_by, source, status, score, feedback, model, provider, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, qid, ctx.account.id, body.answerSource, 'ok', result.score, result.feedback, result.model, provider, result.inputTokens || null, result.outputTokens || null, at);
    audit(ctx.account.username, 'ai_score', String(a.id), `Q${qrow.no} ${body.answerSource} → ${result.score}`);
    sendJson(res, 200, { result: { questionFileId: qid, score: result.score, feedback: result.feedback, model: result.model, source: body.answerSource, createdAt: at } });
  } finally { aiBusy.delete(key); }
}

function deleteAssessment(res, ctx, idText) {
  const a = requireAssessment(ctx, idText);
  if (a.status !== 'scheduled') throw httpError(409, 'NOT_DELETABLE', '只有还没开始的待测试才能删除。');
  const fileIds = db.prepare('SELECT file_id FROM assessment_files WHERE assessment_id = ? UNION SELECT file_id FROM question_rubrics WHERE assessment_id = ?').all(a.id, a.id).map((r) => r.file_id);
  db.prepare('DELETE FROM assessments WHERE id = ?').run(a.id);
  files.deleteIfUnreferenced(fileIds);
  audit(ctx.account.username, 'delete_assessment', String(a.id));
  sendJson(res, 200, { ok: true });
}

async function retake(req, res, ctx, idText) {
  const a = requireAssessment(ctx, idText);
  if (a.status !== 'graded') throw httpError(409, 'NOT_GRADED', '只有已评分的测试才能重测。');
  const body = await readJson(req);
  const stuTz = db.prepare('SELECT timezone FROM accounts WHERE id = ?').get(a.student_id).timezone;
  const when = cleanWall(body.scheduledWall, stuTz, { future: true });
  const start = cleanStartDate(a.unit_start_date, when.wall, stuTz);
  const now = new Date().toISOString();
  const newId = transaction(() => {
    const id = Number(db.prepare(`INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, duration_minutes, status, attempt_no, retake_of, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`)
      .run(a.student_id, ctx.account.id, a.subject, a.unit, start.date, start.iso, when.wall, when.iso, stuTz, a.duration_minutes, a.attempt_no + 1, a.id, now, now).lastInsertRowid);
    db.prepare(`INSERT INTO assessment_files (assessment_id, file_id, role, position)
      SELECT ?, file_id, role, position FROM assessment_files WHERE assessment_id = ? AND role = 'question'`).run(id, a.id);
    db.prepare(`INSERT INTO question_weights (assessment_id, question_file_id, weight)
      SELECT ?, question_file_id, weight FROM question_weights WHERE assessment_id = ?`).run(id, a.id);
    db.prepare(`INSERT INTO question_rubrics (assessment_id, question_file_id, file_id)
      SELECT ?, question_file_id, file_id FROM question_rubrics WHERE assessment_id = ?`).run(id, a.id); // 判分标准属于题目设计，重测时一并复制
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
    const users = db.prepare('SELECT a.student_id FROM assessment_files af JOIN assessments a ON a.id = af.assessment_id WHERE af.file_id = ? UNION SELECT a.student_id FROM question_rubrics qr JOIN assessments a ON a.id = qr.assessment_id WHERE qr.file_id = ?').all(f.id, f.id);
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
