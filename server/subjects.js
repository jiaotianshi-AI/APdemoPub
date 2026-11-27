'use strict';
// 学习科目固定列表，以及“学习板块”（direction）：每个科目属于一个板块，学生账号登录后进入所属板块。
//   apdemo  = AP 自学（/apdemo/）    writing = 写作（/writing/）
const { db } = require('./db');

const DIRECTIONS = ['apdemo', 'writing'];
const HOME_OF = { apdemo: '/apdemo', writing: '/writing' }; // 不带结尾斜杠（服务器会把结尾斜杠的网址重定向到不带的）

function list() {
  return db.prepare('SELECT id, name, direction, disabled FROM subjects ORDER BY direction, name COLLATE NOCASE').all()
    .map((r) => ({ id: r.id, name: r.name, direction: r.direction, disabled: !!r.disabled }));
}
function byName(name) {
  return typeof name === 'string' && name ? db.prepare('SELECT * FROM subjects WHERE name = ?').get(name) || null : null;
}
// 学生所在板块。没有设置科目、或科目不在列表里的旧账号，按 apdemo 处理（保持原有行为）
function directionOf(account) {
  if (!account || account.type !== 'student') return null;
  const s = byName(account.subject);
  return s ? s.direction : 'apdemo';
}
function studentHome(account) { return HOME_OF[directionOf(account)]; }

module.exports = { DIRECTIONS, HOME_OF, list, byName, directionOf, studentHome };
