'use strict';
const config = require('./config');
const { db, audit } = require('./db');
const auth = require('./auth');
const { httpError, readJson, sendJson } = require('./http');
const tzs = require('./timezones');
const subjects = require('./subjects');

const HOME = { supervisor: '/supervisor', support: '/pending', admin: '/admin' };
// 登录后的首页：学生按所属学习板块（/apdemo 或 /writing），其他角色各有固定首页
function roleHome(account) { return account.type === 'student' ? subjects.studentHome(account) : HOME[account.type]; }
function homeFor(account) { return account.must_change_password ? '/change-password' : roleHome(account); }

function clientIp(req) {
  // 服务只监听本机，由 Caddy 转发；Caddy 会把真实客户端 IP 追加在 X-Forwarded-For 末尾
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || 'unknown';
}

function me(account) {
  return {
    id: account.id, username: account.username, type: account.type, mustChangePassword: !!account.must_change_password,
    timezone: account.timezone, tzLabel: tzs.label(account.timezone),
    direction: subjects.directionOf(account)
  };
}

async function login(req, res) {
  const body = await readJson(req);
  const username = auth.normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = clientIp(req);
  const userKey = (username ? auth.usernameKey(username) : '') + '|' + ip;
  const ipKey = 'ip|' + ip;

  if (auth.throttleState(userKey).locked || auth.throttleState(ipKey).locked) {
    throw httpError(429, 'TOO_MANY_ATTEMPTS', `尝试次数过多，请 ${config.loginLockMinutes} 分钟后再试。`);
  }

  const account = username ? db.prepare('SELECT * FROM accounts WHERE username_key = ?').get(auth.usernameKey(username)) : null;
  let ok = false;
  if (account) ok = await auth.verifyPassword(password, account.password_hash);
  else await auth.dummyVerify(password);

  if (!account || !ok || account.disabled) {
    auth.registerFailure(userKey, config.loginMaxFailures);
    auth.registerFailure(ipKey, config.ipMaxFailures);
    throw httpError(401, 'INVALID_CREDENTIALS', '账号或密码错误。');
  }

  auth.clearFailures(userKey);
  db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), account.id);
  const { token, expires } = auth.createSession(account.id, account.type);
  sendJson(res, 200, Object.assign(me(account), { redirect: homeFor(account) }), { 'Set-Cookie': auth.sessionCookie(token, expires) });
}

function logout(req, res, ctx) {
  auth.deleteSession(ctx.token);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
}

async function changePassword(req, res, ctx) {
  const body = await readJson(req);
  const account = ctx.account;
  const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
  const newPassword = body.newPassword;
  const problem = auth.validateNewPassword(newPassword);
  if (problem) throw httpError(422, 'WEAK_PASSWORD', problem);
  if (!(await auth.verifyPassword(oldPassword, account.password_hash))) throw httpError(403, 'WRONG_PASSWORD', '当前密码不正确。');
  if (newPassword === oldPassword) throw httpError(422, 'SAME_PASSWORD', '新密码不能与当前密码相同。');

  const hash = await auth.hashPassword(newPassword);
  db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, account.id);
  auth.deleteAccountSessions(account.id); // 旧会话全部作废，重新签发
  const { token, expires } = auth.createSession(account.id, account.type);
  audit(account.username, 'change_password', account.username);
  sendJson(res, 200, { ok: true, redirect: roleHome(account) }, { 'Set-Cookie': auth.sessionCookie(token, expires) });
}

module.exports = { HOME, roleHome, homeFor, login, logout, changePassword, me };
