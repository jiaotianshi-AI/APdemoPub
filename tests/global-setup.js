// 在测试服务器启动后：往测试数据库里放几个固定账号，并为各角色保存登录状态（storageState）
const fs = require("fs");
const path = require("path");

const PASSWORD = "E2e-Passw0rd!";
const authDir = path.join(__dirname, ".auth");
// 测试学生固定的测试：2030-06-15 15:00（温哥华），本单元从 2030-06-01 开始
const SEED = { wall: "2030-06-15T15:00", startDate: "2030-06-01" };

module.exports = async () => {
  process.env.APDEMO_DB = process.env.APDEMO_DB; // 与服务器使用同一个库文件
  const auth = require("../server/auth");
  const { db } = require("../server/db");
  const base = `http://localhost:${process.env.E2E_PORT}`;
  const hash = await auth.hashPassword(PASSWORD);
  const now = new Date().toISOString();

  const seed = [
    ["e2e_admin", "admin"],
    ["e2e_student", "student"],
    ["e2e_supervisor", "supervisor"],
    ["e2e_support", "support"]
  ];
  for (const [name, type] of seed) {
    db.prepare("INSERT OR IGNORE INTO accounts (username, username_key, type, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run(name, name.toLowerCase(), type, hash, now);
  }

  // 给测试学生：学习科目、一个关联的督导者、一条固定的未来测试（学生页的测试读取它）
  const { wallToIso, dateToIso } = require("../server/timeutil");
  const id = (name) => db.prepare("SELECT id FROM accounts WHERE username_key = ?").get(name).id;
  db.prepare("UPDATE accounts SET subject = 'AP Biology' WHERE id = ?").run(id("e2e_student"));
  db.prepare("INSERT OR IGNORE INTO supervisor_students (supervisor_id, student_id) VALUES (?, ?)").run(id("e2e_supervisor"), id("e2e_student"));
  const wall = SEED.wall, when = wallToIso(wall, "America/Vancouver"), start = dateToIso(SEED.startDate, "America/Vancouver");
  db.prepare(`INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, attempt_no, created_at, updated_at)
    VALUES (?, ?, 'AP Biology', 'Unit 2', ?, ?, ?, ?, 'America/Vancouver', 'scheduled', 1, ?, ?)`)
    .run(id("e2e_student"), id("e2e_supervisor"), SEED.startDate, start.iso, wall, when.iso, now, now);

  fs.mkdirSync(authDir, { recursive: true });
  for (const [name] of seed) {
    const res = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "apdemo" },
      body: JSON.stringify({ username: name, password: PASSWORD })
    });
    if (!res.ok) throw new Error(`测试账号登录失败：${name} ${res.status}`);
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const [cname, cvalue] = [cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1)];
    const state = {
      cookies: [{ name: cname, value: cvalue, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 3600 * 24 }],
      origins: []
    };
    fs.writeFileSync(path.join(authDir, name.replace("e2e_", "") + ".json"), JSON.stringify(state));
  }
  db.close();
};

module.exports.PASSWORD = PASSWORD;
module.exports.SEED = SEED;
