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
  timezone TEXT NOT NULL DEFAULT 'America/Vancouver',
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
-- 每道题的权重（没有记录就是默认的 1）
CREATE TABLE IF NOT EXISTS question_weights (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 100),
  PRIMARY KEY (assessment_id, question_file_id)
);
-- 设置（键值）：AI 模型、加密后的 API 密钥、判分系统提示语等
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
-- 每道题的判分标准 PDF（只有督导者和 AI 判分能用，学生看不到）
CREATE TABLE IF NOT EXISTS question_rubrics (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (assessment_id, question_file_id)
);
-- AI 判分记录（成功和失败都记录；不含学生姓名等身份信息）
CREATE TABLE IF NOT EXISTS ai_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('text','pdf')),
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  feedback TEXT,
  model TEXT,
  error_code TEXT,
  error_message TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_grades_q ON ai_grades (assessment_id, question_file_id, id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_name TEXT,
  detail TEXT
);
`);

// 4 = 账号增加时区字段（旧账号默认温哥华）
if (!db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'timezone')) {
  db.exec("ALTER TABLE accounts ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Vancouver'");
}
if (!db.prepare('PRAGMA table_info(ai_grades)').all().some((c) => c.name === 'provider')) {
  db.exec('ALTER TABLE ai_grades ADD COLUMN provider TEXT'); // 6 = AI 服务商（Anthropic / OpenAI / DeepSeek / 自定义）
}
if (startVersion < 6) db.exec('PRAGMA user_version = 6'); // 4 = 账号时区；5 = AI 判分（设置、判分标准、判分记录）；6 = AI 服务商

// 7 = 学习科目固定列表（每个科目对应一个学习板块：apdemo 或 writing）。旧账号里已有的科目全部登记为 apdemo 板块
db.exec(`CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  direction TEXT NOT NULL CHECK (direction IN ('apdemo', 'writing')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`);
if (startVersion < 7) {
  const now = new Date().toISOString();
  const ins = db.prepare("INSERT OR IGNORE INTO subjects (name, direction, created_at) VALUES (?, ?, ?)");
  ins.run('AP Biology', 'apdemo', now);
  ins.run('Writing', 'writing', now);
  for (const r of db.prepare("SELECT DISTINCT subject FROM accounts WHERE type = 'student' AND subject IS NOT NULL AND subject != ''").all()) ins.run(r.subject, 'apdemo', now);
  db.exec('PRAGMA user_version = 7');
}

// 8 = 写作板块：学生的年级、监护人同意记录，以及写作日程、题目库、每天一篇的作文、每一轮建议、最终评分、安全标记
for (const [col, ddl] of [['grade', 'TEXT'], ['consent_at', 'TEXT'], ['consent_by', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE accounts ADD COLUMN ${col} ${ddl}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS writing_schedules (
  student_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  time_of_day TEXT NOT NULL,              -- 'HH:MM'，学生所在时区的当地时间
  days INTEGER NOT NULL DEFAULT 127,      -- 星期位图：bit0=周一 … bit6=周日
  paused INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,               -- 生效起始日（学生当地日期）
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS writing_prompts (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  hint TEXT,
  used_at TEXT,                           -- 孩子选写这个题目的时间；已用的题目不能再修改或删除
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_prompts_student ON writing_prompts(student_id);
CREATE TABLE IF NOT EXISTS writing_sessions (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                      -- 学生当地日期，每天一篇
  prompt_id INTEGER REFERENCES writing_prompts(id) ON DELETE SET NULL,
  prompt_title TEXT NOT NULL,
  grade TEXT,                             -- 当天的年级快照
  status TEXT NOT NULL DEFAULT 'writing' CHECK (status IN ('writing', 'done')),
  draft TEXT NOT NULL DEFAULT '',
  final_text TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (student_id, day)
);
CREATE TABLE IF NOT EXISTS writing_turns (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES writing_sessions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  essay TEXT NOT NULL,                    -- 这一轮开始时的作文快照
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  feedback TEXT,
  questions TEXT,                         -- JSON：[{type, text, quote}]
  answers TEXT,                           -- JSON：孩子的回答
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, round)
);
CREATE TABLE IF NOT EXISTS writing_grades (
  session_id INTEGER PRIMARY KEY REFERENCES writing_sessions(id) ON DELETE CASCADE,
  ai_score INTEGER CHECK (ai_score BETWEEN 1 AND 5),
  supervisor_score INTEGER CHECK (supervisor_score BETWEEN 1 AND 5),
  supervisor_comment TEXT,
  model TEXT,
  provider TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS writing_flags (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES writing_sessions(id) ON DELETE CASCADE,
  reason TEXT,
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);
if (startVersion < 8) db.exec('PRAGMA user_version = 8');
 // 2 = 加入每题回答 PDF 与评分；3 = 加入每题权重（都只是新增表，不改旧数据）

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
