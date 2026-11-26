'use strict';
// 服务器配置：全部来自环境变量，默认值适合本地开发。不在代码里存放任何密钥。
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  root,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1', // 只监听本机，由 Caddy 反向代理对外
  dbPath: process.env.APDEMO_DB || path.join(root, 'var', 'apdemo.db'),
  uploadDir: process.env.APDEMO_UPLOADS || path.join(root, 'var', 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024), // 单个 PDF 上限 20MB
  maxFilesPerRole: 10, // 每条测试的题目 / 答题 PDF 各最多 10 个
  maxPendingUploads: 40, // 每个督导者已上传但还没关联到测试的文件上限
  timezone: 'America/Vancouver',
  cookieSecure: process.env.COOKIE_SECURE !== '0', // 正式环境为 HTTPS；仅本地测试时设为 0
  cookieName: 'apdemo_sid',
  sessionDays: 7,
  loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES || 5), // 同一账号名+IP 连续失败次数
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  ipMaxFailures: Number(process.env.IP_MAX_FAILURES || 40) // 同一 IP 的失败总次数
};
