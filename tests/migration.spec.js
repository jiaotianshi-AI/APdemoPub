// 数据库迁移：旧版本（只有 scheduled/graded 状态、没有 duration_minutes）的数据库升级后，数据完整保留
const { test, expect } = require("@playwright/test");
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const OLD_SCHEMA = `
CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('student','supervisor','support','admin')), password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1, disabled INTEGER NOT NULL DEFAULT 0, subject TEXT, created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE supervisor_students (supervisor_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, student_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, PRIMARY KEY (supervisor_id, student_id));
CREATE TABLE support_supervisors (support_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, supervisor_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, PRIMARY KEY (support_id, supervisor_id));
CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, stored_name TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE TABLE assessments (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL, subject TEXT NOT NULL, unit TEXT NOT NULL, unit_start_date TEXT NOT NULL, unit_start_at TEXT NOT NULL,
  scheduled_wall TEXT NOT NULL, scheduled_at TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('scheduled','graded')),
  score INTEGER CHECK (score BETWEEN 1 AND 5), graded_at TEXT, graded_by TEXT, attempt_no INTEGER NOT NULL DEFAULT 1,
  retake_of INTEGER REFERENCES assessments(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_assessments_student ON assessments (student_id, scheduled_at);
CREATE TABLE assessment_files (assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('question','answer')), position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (assessment_id, file_id, role));
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor_name TEXT, action TEXT NOT NULL, target_name TEXT, detail TEXT);
`;

test("旧数据库升级：测试记录、文件关联、重测关系完整保留，新增时长默认 60 分钟，之后能写入新状态", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apdemo-mig-"));
  const dbPath = path.join(dir, "old.db");
  const root = path.join(__dirname, "..");
  const seed = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.env.DBP);
    db.exec(${JSON.stringify(OLD_SCHEMA)});
    const now = "2026-11-01T00:00:00.000Z";
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare("INSERT INTO accounts (username, username_key, type, password_hash, created_at) VALUES ('s1','s1','student','h',?)").run(now);
    db.prepare("INSERT INTO accounts (username, username_key, type, password_hash, created_at) VALUES ('p1','p1','supervisor','h',?)").run(now);
    db.prepare("INSERT INTO files (stored_name, original_name, size, uploaded_by, created_at) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf','q.pdf',10,2,?)").run(now);
    const ins = db.prepare("INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, score, attempt_no, retake_of, created_at, updated_at) VALUES (1,2,'AP Biology',?, '2026-11-01','2026-11-01T00:00:00-07:00','2026-11-28T15:00','2026-11-28T15:00:00-07:00','America/Vancouver',?,?,?,?,?,?)");
    ins.run('Unit 2','graded',4,1,null,now,now);
    ins.run('Unit 2','scheduled',null,2,1,now,now);
    db.prepare("INSERT INTO assessment_files (assessment_id, file_id, role, position) VALUES (1,1,'question',0),(2,1,'question',0)").run();
    db.close();`;
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", seed], { env: { ...process.env, DBP: dbPath } });

  const check = `
    const { db } = require(${JSON.stringify(path.join(root, "server", "db.js"))});
    const out = {
      version: db.prepare("PRAGMA user_version").get().user_version,
      rows: db.prepare("SELECT id, unit, status, score, attempt_no, retake_of, duration_minutes FROM assessments ORDER BY id").all().map((r) => ({ ...r })),
      files: db.prepare("SELECT assessment_id, file_id, role FROM assessment_files ORDER BY assessment_id").all().map((r) => ({ ...r })),
      fk: db.prepare("PRAGMA foreign_keys").get().foreign_keys,
      fkCheck: db.prepare("PRAGMA foreign_key_check").all().length,
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    };
    db.prepare("UPDATE assessments SET status = 'in_progress' WHERE id = 2").run(); // 新状态可以写入
    db.prepare("INSERT INTO attempts (assessment_id, started_at, deadline_at, method) VALUES (2, 'a', 'b', 'typed')").run();
    db.prepare("DELETE FROM assessments WHERE id = 2").run(); // 级联：答卷随之删除
    out.attemptsAfterDelete = db.prepare("SELECT COUNT(*) AS n FROM attempts").get().n;
    out.filesAfterDelete = db.prepare("SELECT COUNT(*) AS n FROM assessment_files").get().n;
    console.log(JSON.stringify(out));`;
  const run = () => JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", check], { env: { ...process.env, APDEMO_DB: dbPath } }).toString().trim().split("\n").pop());
  const out = run();
  expect(out.version).toBe(9);
  expect(out.rows).toEqual([
    { id: 1, unit: "Unit 2", status: "graded", score: 4, attempt_no: 1, retake_of: null, duration_minutes: 60 },
    { id: 2, unit: "Unit 2", status: "scheduled", score: null, attempt_no: 2, retake_of: 1, duration_minutes: 60 }
  ]);
  expect(out.files).toEqual([{ assessment_id: 1, file_id: 1, role: "question" }, { assessment_id: 2, file_id: 1, role: "question" }]);
  expect(out.fk).toBe(1);
  expect(out.fkCheck).toBe(0);
  for (const t of ["attempts", "answers", "attempt_events", "question_answers", "question_scores", "question_weights", "settings", "question_rubrics", "ai_grades", "subjects", "writing_schedules", "writing_prompts", "writing_sessions", "writing_turns", "writing_grades", "writing_flags"]) expect(out.tables).toContain(t);
  expect(out.attemptsAfterDelete).toBe(0);
  expect(out.filesAfterDelete).toBe(1);
  fs.rmSync(dir, { recursive: true, force: true });
});
