'use strict';
// 管理员的写作板块设置：建议提示语（可编辑）、各年级的写作期望、AI 用量。
const { db, audit } = require('./db');
const settings = require('./settings');
const grades = require('./grades');
const { httpError, readJson, sendJson } = require('./http');

const PROMPT_MAX = 20000;
const STANDARD_MAX = 1000;

function usage() {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const totals = db.prepare('SELECT COUNT(*) AS rounds, COALESCE(SUM(input_tokens), 0) AS inTok, COALESCE(SUM(output_tokens), 0) AS outTok, COALESCE(SUM(flag), 0) AS flags FROM writing_turns WHERE created_at >= ?').get(since);
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM writing_sessions WHERE started_at >= ?').get(since).n;
  const byDay = db.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS rounds, COALESCE(SUM(input_tokens), 0) AS inTok, COALESCE(SUM(output_tokens), 0) AS outTok FROM writing_turns WHERE created_at >= ? GROUP BY day ORDER BY day DESC').all(since);
  const byStudent = db.prepare(`SELECT a.username, COUNT(*) AS rounds, COALESCE(SUM(t.input_tokens), 0) AS inTok, COALESCE(SUM(t.output_tokens), 0) AS outTok
    FROM writing_turns t JOIN writing_sessions s ON s.id = t.session_id JOIN accounts a ON a.id = s.student_id
    WHERE t.created_at >= ? GROUP BY a.id ORDER BY rounds DESC, a.username LIMIT 20`).all(since);
  const unreviewed = db.prepare('SELECT COUNT(*) AS n FROM writing_flags WHERE reviewed = 0').get().n;
  const failed = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'writing_advice_failed' AND ts >= ?").get(since).n;
  return {
    days: 30, sessions, rounds: totals.rounds, inputTokens: totals.inTok, outputTokens: totals.outTok, flaggedRounds: totals.flags, unreviewedFlags: unreviewed, failedCalls: failed,
    byDay: byDay.map((r) => ({ day: r.day, rounds: r.rounds, inputTokens: r.inTok, outputTokens: r.outTok })),
    byStudent: byStudent.map((r) => ({ username: r.username, rounds: r.rounds, inputTokens: r.inTok, outputTokens: r.outTok }))
  };
}

function view() {
  const p = settings.getWritingPrompt();
  const st = settings.getGradeStandards();
  return {
    prompt: p.prompt, isDefaultPrompt: !p.custom, defaultPrompt: settings.DEFAULT_WRITING_PROMPT,
    standards: grades.LIST.map((g) => ({ code: g.code, label: g.label, text: st[g.code].text, isDefault: !st[g.code].custom, defaultText: settings.DEFAULT_GRADE_STANDARDS[g.code] })),
    usage: usage()
  };
}

async function save(req, res, ctx) {
  const body = await readJson(req);
  const by = ctx.account.username;
  const changed = [];
  if ('prompt' in body) {
    if (typeof body.prompt !== 'string') throw httpError(422, 'INVALID_PROMPT', '提示语必须是文字。');
    if (body.prompt.length > PROMPT_MAX) throw httpError(422, 'INVALID_PROMPT', `提示语不能超过 ${PROMPT_MAX} 个字符。`);
    const t = body.prompt.trim();
    if (t === '' || t === settings.DEFAULT_WRITING_PROMPT) settings.remove('writing_system_prompt');
    else settings.set('writing_system_prompt', t, by);
    changed.push('prompt');
  }
  if ('standards' in body) {
    const m = body.standards;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw httpError(422, 'INVALID_STANDARDS', '年级期望的格式不对。');
    const clean = {};
    for (const [code, text] of Object.entries(m)) {
      if (!grades.isValid(code)) throw httpError(422, 'INVALID_GRADE', '年级不对。');
      if (typeof text !== 'string') throw httpError(422, 'INVALID_STANDARDS', '年级期望必须是文字。');
      if (text.length > STANDARD_MAX) throw httpError(422, 'INVALID_STANDARDS', `每个年级的期望不能超过 ${STANDARD_MAX} 个字符。`);
      clean[code] = text === settings.DEFAULT_GRADE_STANDARDS[code] ? '' : text; // 与默认相同 = 恢复默认
    }
    settings.setGradeStandards(clean, by);
    changed.push('standards');
  }
  if (!changed.length) throw httpError(400, 'NOTHING_TO_UPDATE', '没有要修改的内容。');
  audit(by, 'update_writing_settings', null, changed.join(',')); // 只记录改了哪几项，不记录内容
  sendJson(res, 200, view());
}

// 删除某个孩子的全部写作记录：作文、每一轮、评分、安全标记，以及已经写过的题目（保留还没写过的题目、日程和账号）
function deleteRecords(res, ctx, idText) {
  const id = Number(idText);
  const stu = Number.isInteger(id) ? db.prepare("SELECT * FROM accounts WHERE id = ? AND type = 'student'").get(id) : null;
  if (!stu) throw httpError(404, 'NOT_FOUND', '没有这个学生。');
  if (require('./subjects').directionOf(stu) !== 'writing') throw httpError(422, 'NOT_WRITING', '这位学生不属于写作板块。');
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM writing_sessions WHERE student_id = ?').get(stu.id).n;
  const prompts = db.prepare('SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ? AND used_at IS NOT NULL').get(stu.id).n;
  require('./db').transaction(() => {
    db.prepare('DELETE FROM writing_sessions WHERE student_id = ?').run(stu.id); // 每一轮、评分、安全标记随之级联删除
    db.prepare('DELETE FROM writing_prompts WHERE student_id = ? AND used_at IS NOT NULL').run(stu.id);
  });
  audit(ctx.account.username, 'delete_writing_records', stu.username, `${sessions} 篇作文，${prompts} 个已用题目`);
  sendJson(res, 200, { ok: true, deletedSessions: sessions, deletedPrompts: prompts });
}

module.exports = async function adminWritingApi(req, res, pathname, ctx) {
  let m;
  if ((m = /^\/api\/admin\/writing\/students\/([^/]+)\/records$/.exec(pathname)) && req.method === 'DELETE') return deleteRecords(res, ctx, m[1]);
  if (pathname === '/api/admin/writing' && req.method === 'GET') return sendJson(res, 200, view());
  if (pathname === '/api/admin/writing' && req.method === 'PUT') return save(req, res, ctx);
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
