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
  // 密钥主文件：用来加密保存在数据库里的第三方 API 密钥。放在数据库同一目录，但不在每日备份的范围内（备份只含数据库和上传文件）
  masterKeyPath: process.env.APDEMO_MASTER_KEY_FILE || path.join(path.dirname(process.env.APDEMO_DB || path.join(root, 'var', 'apdemo.db')), 'master.key'),
  // AI 判分：只通过服务器调用，地址固定（只有测试时通过环境变量指向本地模拟服务）
  // 各服务商的接口地址（只有测试时会通过环境变量指向本地模拟服务）。自定义服务商的地址由管理员填写，见 server/ai.js 的 validateBaseUrl
  aiBases: {
    anthropic: (process.env.AI_API_BASE_ANTHROPIC || process.env.AI_API_BASE || 'https://api.anthropic.com').replace(/\/+$/, ''),
    openai: (process.env.AI_API_BASE_OPENAI || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    deepseek: (process.env.AI_API_BASE_DEEPSEEK || 'https://api.deepseek.com').replace(/\/+$/, '')
  },
  aiAllowPrivateBase: process.env.AI_ALLOW_PRIVATE_BASE === '1', // 允许自定义服务商地址指向本机/内网（只在测试里打开）
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 180000),
  aiTestMinIntervalMs: Number(process.env.AI_TEST_MIN_INTERVAL_MS || 2000), // 管理员连通性测试的最小间隔
  writingMinIntervalMs: Number(process.env.WRITING_MIN_INTERVAL_MS || 4000), // 写作“请提建议”的最小间隔
  aiMaxPerHour: Number(process.env.AI_MAX_PER_HOUR || 60), // 每个督导者每小时最多提交的 AI 评分次数
  cookieSecure: process.env.COOKIE_SECURE !== '0', // 正式环境为 HTTPS；仅本地测试时设为 0
  cookieName: 'apdemo_sid',
  sessionDays: 7,
  loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES || 5), // 同一账号名+IP 连续失败次数
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  ipMaxFailures: Number(process.env.IP_MAX_FAILURES || 40) // 同一 IP 的失败总次数
};
