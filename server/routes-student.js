'use strict';
// 学生页数据：这个学生自己的科目，以及排期最近的一个待测试（只返回一个）。
const { db } = require('./db');
const { sendJson } = require('./http');

function overview(res, ctx) {
  const stu = ctx.account;
  const nowIso = new Date().toISOString();
  // 优先取“将来最近的待测试”；没有的话取“时间已过但还没评分的最近一个”（页面显示为已结束）
  let a = db.prepare("SELECT * FROM assessments WHERE student_id = ? AND status = 'scheduled' AND scheduled_at > ? ORDER BY scheduled_at ASC, id ASC LIMIT 1").get(stu.id, nowIso);
  if (!a) a = db.prepare("SELECT * FROM assessments WHERE student_id = ? AND status = 'scheduled' ORDER BY scheduled_at DESC, id DESC LIMIT 1").get(stu.id);
  sendJson(res, 200, {
    username: stu.username,
    subject: stu.subject || null,
    next: a ? {
      id: a.id, subject: a.subject, unit: a.unit,
      scheduledWall: a.scheduled_wall, scheduledAt: a.scheduled_at, timezone: a.timezone,
      unitStartDate: a.unit_start_date, unitStartAt: a.unit_start_at
    } : null
  });
}

module.exports = async function studentApi(req, res, pathname, ctx) {
  if (pathname === '/api/student/overview' && req.method === 'GET') return overview(res, ctx);
  const { httpError } = require('./http');
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
