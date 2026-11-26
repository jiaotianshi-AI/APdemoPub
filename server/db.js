'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// 测试记录表的定义（迁移时也用它建临时表，保证两处一致）
// 状态：scheduled 待测试 / in_progress 测试中 / submitted 已提交待评分 / graded 已评分
function assessmentsDdl(name) {
  return `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_start_date TEXT NOT NULL,
  unit_start_at TEXT NOT NULL,
  scheduled_wall TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','submitted','graded')),
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  graded_at TEXT,
  graded_by TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  retake_of INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
}

// 数据库版本迁移。user_version：0 = 最初版本（status 只有 scheduled/graded，没有 duration_minutes）；1 = 加入测试流程；2 = 加入每题回答与评分
function migrate() {
  const hasAssessments = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assessments'").get();
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (hasAssessments && version < 1) {
    // 重建 assessments（SQLite 不能直接修改 CHECK 约束）。按官方推荐的步骤：先关外键，在事务里重建，再开外键
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(assessmentsDdl('assessments_new'));
      db.exec(`INSERT INTO assessments_new (id, student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, duration_minutes, status, score, graded_at, graded_by, attempt_no, retake_of, created_at, updated_at)
        SELECT id, student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, 60, status, score, graded_at, graded_by, attempt_no, retake_of, created_at, updated_at FROM assessments`);
      db.exec('DROP TABLE assessments');
      db.exec('ALTER TABLE assessments_new RENAME TO assessments');
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (e) { /* ignore */ }
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return version;
}
const startVersion = migrate();

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('student','supervisor','support','admin')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  subject TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supervisor_students (
  supervisor_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (supervisor_id, student_id)
);
CREATE TABLE IF NOT EXISTS support_supervisors (
  support_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  supervisor_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (support_id, supervisor_id)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
${assessmentsDdl("assessments")}
CREATE INDEX IF NOT EXISTS idx_assessments_student ON assessments (student_id, scheduled_at);
CREATE TABLE IF NOT EXISTS assessment_files (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('question','answer')),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (assessment_id, file_id, role)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  submitted_at TEXT,
  auto_submitted INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL CHECK (method IN ('typed','paper')),
  early INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS answers (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, file_id)
);
CREATE TABLE IF NOT EXISTS attempt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('leave','return')),
  reason TEXT
);
-- 每道题的回答 PDF（扫描件）和评分。question_file_id 是该测试里那道题的 PDF（assessment_files 里 role = 'question' 的文件）
CREATE TABLE IF NOT EXISTS question_answers (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (assessment_id, question_file_id)
);
CREATE TABLE IF NOT EXISTS question_scores (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (assessment_id, question_file_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_name TEXT,
  detail TEXT
);
`);

if (startVersion < 2) db.exec('PRAGMA user_version = 2'); // 2 = 加入每题回答 PDF 与评分（只新增表，不改旧数据）

// 事务辅助：fn 抛异常则回滚
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  }
}

function audit(actorName, action, targetName, detail) {
  db.prepare('INSERT INTO audit_log (ts, actor_name, action, target_name, detail) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), actorName || null, action, targetName || null, detail || null);
}

module.exports = { db, transaction, audit };
