'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

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
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_name TEXT,
  detail TEXT
);
`);

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
