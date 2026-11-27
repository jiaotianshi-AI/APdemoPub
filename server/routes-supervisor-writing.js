'use strict';
// 督导者管理写作学生：写作日程（每天几点、哪几天、暂停）和题目库（每个孩子一份）。
// 只能管理已关联、且属于写作板块的学生。
const { db, audit } = require('./db');
const { httpError, readJson, sendJson } = require('./http');
const tzs = require('./timezones');
const subjects = require('./subjects');
const grades = require('./grades');

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
    lowThreshold: LOW_PROMPTS
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

module.exports = { LOW_PROMPTS, promptsLeft, async handle(req, res, pathname, ctx) {
  let r;
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)$/.exec(pathname)) && req.method === 'GET') return view(res, requireWritingStudent(ctx, r[1]));
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)\/schedule$/.exec(pathname)) && req.method === 'PUT') return saveSchedule(req, res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/students\/([^/]+)\/prompts$/.exec(pathname)) && req.method === 'POST') return addPrompt(req, res, ctx, r[1]);
  if ((r = /^\/api\/supervisor\/writing\/prompts\/([^/]+)$/.exec(pathname))) {
    if (req.method === 'PATCH') return updatePrompt(req, res, ctx, r[1]);
    if (req.method === 'DELETE') return deletePrompt(res, ctx, r[1]);
  }
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
} };
