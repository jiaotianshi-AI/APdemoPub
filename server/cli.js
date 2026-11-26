'use strict';
// 服务器命令行工具（只能在服务器上运行，不对外提供）
//   node server/cli.js create-admin <账号名>
//   node server/cli.js reset-admin-password <账号名>
// 会生成一次性初始密码并打印；该管理员第一次登录时必须修改。
const auth = require('./auth');
const { db, audit } = require('./db');

async function main() {
  const [cmd, rawName] = process.argv.slice(2);
  const name = auth.normalizeUsername(rawName);
  if (!['create-admin', 'reset-admin-password'].includes(cmd) || !name) {
    console.error('用法：node server/cli.js create-admin <账号名>\n      node server/cli.js reset-admin-password <账号名>\n账号名为 2–32 个字符：字母、数字、下划线、点、短横线。');
    process.exit(2);
  }
  const password = auth.generatePassword(16);
  const hash = await auth.hashPassword(password);
  const key = auth.usernameKey(name);
  const existing = db.prepare('SELECT * FROM accounts WHERE username_key = ?').get(key);

  if (cmd === 'create-admin') {
    if (existing) { console.error('该账号名已存在。'); process.exit(1); }
    db.prepare('INSERT INTO accounts (username, username_key, type, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run(name, key, 'admin', hash, new Date().toISOString());
    audit('cli', 'create_admin', name);
  } else {
    if (!existing || existing.type !== 'admin') { console.error('没有这个管理员账号。'); process.exit(1); }
    db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, existing.id);
    auth.deleteAccountSessions(existing.id);
    audit('cli', 'reset_admin_password', name);
  }
  console.log(`管理员账号：${name}\n初始密码：${password}\n（只显示这一次；第一次登录时必须修改密码）`);
}
main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
