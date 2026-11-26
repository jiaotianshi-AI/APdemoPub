'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('./config');
const { db } = require('./db');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------- 账号名 ---------- */
const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,32}$/u;

function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').trim();
  return USERNAME_RE.test(name) ? name : null;
}
function usernameKey(name) { return name.toLowerCase(); }

/* ---------- 密码 ---------- */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// 去掉容易看错的字符（0/O、1/l/I）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function validateNewPassword(pw) {
  if (typeof pw !== 'string') return '请输入新密码。';
  if (pw.length < 8) return '新密码至少需要 8 个字符。';
  if (pw.length > 128) return '新密码不能超过 128 个字符。';
  return null;
}

// 账号名不存在时也做一次同样耗时的校验，避免通过响应时间猜账号
let dummyHash = null;
async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
}

/* ---------- 会话 ---------- */
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionDays * 86400 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), accountId, now.toISOString(), expires.toISOString());
  return { token, expires };
}

function getAccountBySession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND a.disabled = 0`)
    .get(sha256(token), new Date().toISOString());
  return row || null;
}

function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}
function deleteAccountSessions(accountId) {
  db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
}
function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

/* ---------- Cookie ---------- */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionCookie(token, expires) {
  const attrs = [`${config.cookieName}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (expires) attrs.push(`Expires=${expires.toUTCString()}`);
  if (config.cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
}
function clearCookie() {
  const attrs = [`${config.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (config.cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
}

/* ---------- 登录失败限流（内存） ---------- */
const fails = new Map(); // key -> { count, lockedUntil }

function throttleState(key) {
  const s = fails.get(key);
  if (!s) return { locked: false };
  if (s.lockedUntil && s.lockedUntil > Date.now()) return { locked: true, until: s.lockedUntil };
  if (s.lockedUntil) fails.delete(key); // 锁定已过期
  return { locked: false };
}
function registerFailure(key, max) {
  const s = fails.get(key) || { count: 0, lockedUntil: 0 };
  s.count += 1;
  if (s.count >= max) { s.lockedUntil = Date.now() + config.loginLockMinutes * 60 * 1000; s.count = 0; }
  fails.set(key, s);
}
function clearFailures(key) { fails.delete(key); }

module.exports = {
  normalizeUsername, usernameKey, hashPassword, verifyPassword, generatePassword, validateNewPassword, dummyVerify,
  createSession, getAccountBySession, deleteSession, deleteAccountSessions, purgeExpiredSessions,
  parseCookies, sessionCookie, clearCookie, throttleState, registerFailure, clearFailures
};
