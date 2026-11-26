'use strict';
// 把第三方 API 密钥加密后再存进数据库（AES-256-GCM）。
// 加密用的主密钥是服务器上的一个文件（第一次需要时自动生成，权限 600），不在数据库里，也不在每日备份里：
// 所以只拿到数据库或备份文件，看不到明文密钥。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

let cached = null;

function masterKey() {
  if (cached) return cached;
  const file = config.masterKeyPath;
  try {
    const raw = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (raw.length === 32) { cached = raw; return cached; }
  } catch (e) { /* 不存在则生成 */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  cached = key;
  return cached;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(stored) {
  const [v, iv, tag, data] = String(stored).split(':');
  if (v !== 'v1') throw new Error('unknown format');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
