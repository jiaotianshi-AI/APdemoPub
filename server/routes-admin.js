'use strict';
// 管理员的账号管理接口。账号名和类型创建后不能修改；管理员账号只能通过服务器命令行创建，这里看不到也改不了。
const { db, transaction, audit } = require('./db');
const auth = require('./auth');
const { httpError, readJson, sendJson } = require('./http');
const files = require('./files');
const tzs = require('./timezones');
const { wallToIso, dateToIso } = require('./timeutil');

const MANAGED_TYPES = ['student', 'supervisor', 'support'];
const EDITABLE = { student: ['subject', 'timezone'], supervisor: ['studentIds', 'timezone'], support: ['supervisorIds', 'timezone'] };
const LINK_TARGET_TYPE = { studentIds: 'student', supervisorIds: 'supervisor' };
const SUBJECT_MAX = 64;

function serialize(a, links) {
  const out = {
    id: a.id,
    username: a.username,
    type: a.type,
    disabled: !!a.disabled,
    mustChangePassword: !!a.must_change_password,
    timezone: a.timezone,
    tzLabel: tzs.label(a.timezone),
    createdAt: a.created_at,
    lastLoginAt: a.last_login_at || null
  };
  if (a.type === 'student') out.subject = a.subject || '';
  if (a.type === 'supervisor') out.studentIds = links.studentIds.get(a.id) || [];
  if (a.type === 'support') out.supervisorIds = links.supervisorIds.get(a.id) || [];
  return out;
}

function loadLinks() {
  const studentIds = new Map();
  for (const r of db.prepare('SELECT supervisor_id, student_id FROM supervisor_students ORDER BY student_id').all()) {
    if (!studentIds.has(r.supervisor_id)) studentIds.set(r.supervisor_id, []);
    studentIds.get(r.supervisor_id).push(r.student_id);
  }
  const supervisorIds = new Map();
  for (const r of db.prepare('SELECT support_id, supervisor_id FROM support_supervisors ORDER BY supervisor_id').all()) {
    if (!supervisorIds.has(r.support_id)) supervisorIds.set(r.support_id, []);
    supervisorIds.get(r.support_id).push(r.supervisor_id);
  }
  return { studentIds, supervisorIds };
}

function getManaged(idText) {
  const id = Number(idText);
  const row = Number.isInteger(id) ? db.prepare("SELECT * FROM accounts WHERE id = ? AND type != 'admin'").get(id) : null;
  if (!row) throw httpError(404, 'NOT_FOUND', '没有这个账号。');
  return row;
}

function cleanSubject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw httpError(422, 'INVALID_SUBJECT', '学习科目必须是文字。');
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...text].length > SUBJECT_MAX) throw httpError(422, 'INVALID_SUBJECT', `学习科目不能超过 ${SUBJECT_MAX} 个字符。`);
  return text === '' ? null : text;
}

function cleanIds(value, targetType) {
  if (!Array.isArray(value) || value.length > 1000) throw httpError(422, 'INVALID_LINKS', '关联列表格式不正确。');
  const ids = [];
  for (const v of value) {
    if (!Number.isInteger(v) || v <= 0) throw httpError(422, 'INVALID_LINKS', '关联列表格式不正确。');
    if (!ids.includes(v)) ids.push(v);
  }
  const check = db.prepare('SELECT type FROM accounts WHERE id = ?');
  for (const id of ids) {
    const row = check.get(id);
    if (!row || row.type !== targetType) throw httpError(422, 'INVALID_LINKS', '关联的账号不存在或类型不对。');
  }
  return ids;
}

function respondAccount(res, status, id, extra) {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  sendJson(res, status, Object.assign({ account: serialize(row, loadLinks()) }, extra || {}));
}

async function listAccounts(req, res, url) {
  const type = url.searchParams.get('type');
  if (type && !MANAGED_TYPES.includes(type)) throw httpError(422, 'INVALID_TYPE', '账号类型不正确。');
  const rows = type
    ? db.prepare('SELECT * FROM accounts WHERE type = ? ORDER BY id').all(type)
    : db.prepare("SELECT * FROM accounts WHERE type != 'admin' ORDER BY id").all();
  const links = loadLinks();
  sendJson(res, 200, { accounts: rows.map((r) => serialize(r, links)), timezones: tzs.publicList(), defaultTimezone: tzs.DEFAULT_TZ });
}

async function createAccount(req, res, ctx) {
  const body = await readJson(req);
  const username = auth.normalizeUsername(body.username);
  if (!username) throw httpError(422, 'INVALID_USERNAME', '账号名为 2–32 个字符，只能包含字母、数字、下划线、点和短横线。');
  if (!MANAGED_TYPES.includes(body.type)) throw httpError(422, 'INVALID_TYPE', '请选择账号类型：学生、督导者或客服。');
  const timezone = body.timezone === undefined ? tzs.DEFAULT_TZ : body.timezone;
  if (!tzs.isValid(timezone)) throw httpError(422, 'INVALID_TIMEZONE', '请选择有效的时区。');
  const key = auth.usernameKey(username);
  if (db.prepare('SELECT 1 FROM accounts WHERE username_key = ?').get(key)) throw httpError(409, 'USERNAME_TAKEN', '这个账号名已经被使用。');

  const initialPassword = auth.generatePassword(12);
  const hash = await auth.hashPassword(initialPassword);
  let id;
  try {
    id = db.prepare('INSERT INTO accounts (username, username_key, type, password_hash, must_change_password, timezone, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(username, key, body.type, hash, timezone, new Date().toISOString()).lastInsertRowid;
  } catch (e) {
    throw httpError(409, 'USERNAME_TAKEN', '这个账号名已经被使用。');
  }
  audit(ctx.account.username, 'create_account', username, body.type + ' ' + timezone);
  respondAccount(res, 201, Number(id), { initialPassword });
}

async function updateAccount(req, res, ctx, idText) {
  const target = getManaged(idText);
  const body = await readJson(req);
  const keys = Object.keys(body);
  if (keys.some((k) => k === 'username' || k === 'type')) throw httpError(400, 'FIELD_NOT_EDITABLE', '账号名和类型创建后不能修改。');
  if (keys.length === 0) throw httpError(400, 'NOTHING_TO_UPDATE', '没有要修改的内容。');
  const allowed = EDITABLE[target.type];
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length) throw httpError(400, 'FIELD_NOT_EDITABLE', '这类账号不支持修改这个内容。');

  // 先全部校验，再写入（避免只改了一半）
  if ('timezone' in body && !tzs.isValid(body.timezone)) throw httpError(422, 'INVALID_TIMEZONE', '请选择有效的时区。');
  const subjectValue = target.type === 'student' && 'subject' in body ? cleanSubject(body.subject) : undefined;
  const studentIds = target.type === 'supervisor' && 'studentIds' in body ? cleanIds(body.studentIds, 'student') : null;
  const supervisorIds = target.type === 'support' && 'supervisorIds' in body ? cleanIds(body.supervisorIds, 'supervisor') : null;

  if ('timezone' in body) {
    if (!tzs.isValid(body.timezone)) throw httpError(422, 'INVALID_TIMEZONE', '请选择有效的时区。');
    if (body.timezone !== target.timezone) {
      transaction(() => {
        db.prepare('UPDATE accounts SET timezone = ? WHERE id = ?').run(body.timezone, target.id);
        // 学生换时区：还没开始的测试保持“当地时间”不变（例如当地下午 3 点），对应的精确时刻随之改变；已开始或已完成的测试保持原样
        if (target.type === 'student') {
          const rows = db.prepare("SELECT id, scheduled_wall, unit_start_date FROM assessments WHERE student_id = ? AND status = 'scheduled'").all(target.id);
          for (const r of rows) {
            const at = wallToIso(r.scheduled_wall, body.timezone), st = dateToIso(r.unit_start_date, body.timezone);
            if (at && st) db.prepare('UPDATE assessments SET timezone = ?, scheduled_at = ?, unit_start_at = ?, updated_at = ? WHERE id = ?').run(body.timezone, at.iso, st.iso, new Date().toISOString(), r.id);
          }
        }
      });
      audit(ctx.account.username, 'update_timezone', target.username, target.timezone + ' → ' + body.timezone);
    }
    if (Object.keys(body).length === 1) return respondAccount(res, 200, target.id);
  }
  if (subjectValue !== undefined) {
    db.prepare('UPDATE accounts SET subject = ? WHERE id = ?').run(subjectValue, target.id);
    audit(ctx.account.username, 'update_subject', target.username, subjectValue || '(空)');
  } else if (studentIds) {
    const ids = studentIds;
    transaction(() => {
      db.prepare('DELETE FROM supervisor_students WHERE supervisor_id = ?').run(target.id);
      const ins = db.prepare('INSERT INTO supervisor_students (supervisor_id, student_id) VALUES (?, ?)');
      for (const sid of ids) ins.run(target.id, sid);
    });
    audit(ctx.account.username, 'update_students', target.username, `${ids.length} 个学生`);
  } else if (supervisorIds) {
    const ids = supervisorIds;
    transaction(() => {
      db.prepare('DELETE FROM support_supervisors WHERE support_id = ?').run(target.id);
      const ins = db.prepare('INSERT INTO support_supervisors (support_id, supervisor_id) VALUES (?, ?)');
      for (const sid of ids) ins.run(target.id, sid);
    });
    audit(ctx.account.username, 'update_supervisors', target.username, `${ids.length} 个督导者`);
  }
  respondAccount(res, 200, target.id);
}

async function resetPassword(req, res, ctx, idText) {
  const target = getManaged(idText);
  const initialPassword = auth.generatePassword(12);
  const hash = await auth.hashPassword(initialPassword);
  db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, target.id);
  auth.deleteAccountSessions(target.id);
  audit(ctx.account.username, 'reset_password', target.username);
  respondAccount(res, 200, target.id, { initialPassword });
}

function setDisabled(res, ctx, idText, disabled) {
  const target = getManaged(idText);
  db.prepare('UPDATE accounts SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, target.id);
  if (disabled) auth.deleteAccountSessions(target.id);
  audit(ctx.account.username, disabled ? 'disable_account' : 'enable_account', target.username);
  respondAccount(res, 200, target.id);
}

function deleteAccount(res, ctx, idText) {
  const target = getManaged(idText);
  if (!target.disabled) throw httpError(409, 'MUST_DISABLE_FIRST', '请先停用这个账号，再彻底删除。');
  db.prepare('DELETE FROM accounts WHERE id = ?').run(target.id); // 会话、关联关系、测试记录随之级联删除
  files.gcFiles(10); // 顺带清掉不再被任何测试使用的 PDF（刚上传 10 分钟内的先保留）
  audit(ctx.account.username, 'delete_account', target.username, target.type);
  sendJson(res, 200, { ok: true });
}

module.exports = async function adminApi(req, res, pathname, ctx) {
  if (pathname === '/api/admin/ai' || pathname.startsWith('/api/admin/ai/')) return require('./routes-admin-ai')(req, res, pathname, ctx);
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/admin/accounts') {
    if (req.method === 'GET') return listAccounts(req, res, url);
    if (req.method === 'POST') return createAccount(req, res, ctx);
    throw httpError(405, 'METHOD_NOT_ALLOWED', '不支持这个请求方式。');
  }
  const m = /^\/api\/admin\/accounts\/([^/]+)(?:\/(reset-password|disable|enable))?$/.exec(pathname);
  if (m) {
    const [, id, action] = m;
    if (!action && req.method === 'PATCH') return updateAccount(req, res, ctx, id);
    if (!action && req.method === 'DELETE') return deleteAccount(res, ctx, id);
    if (action === 'reset-password' && req.method === 'POST') return resetPassword(req, res, ctx, id);
    if (action === 'disable' && req.method === 'POST') return setDisabled(res, ctx, id, true);
    if (action === 'enable' && req.method === 'POST') return setDisabled(res, ctx, id, false);
    throw httpError(405, 'METHOD_NOT_ALLOWED', '不支持这个请求方式。');
  }
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
};
