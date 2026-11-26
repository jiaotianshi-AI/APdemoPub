const path = require("path");
const PASSWORD = "E2e-Passw0rd!";
const state = (role) => path.join(__dirname, ".auth", role + ".json");
const ANON = { cookies: [], origins: [] };
// API 请求默认头（服务器要求写操作带 X-Requested-With）
const H = { "X-Requested-With": "apdemo" };
let counter = 0;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
module.exports = { PASSWORD, state, ANON, H, uid };

// ---- 直接往测试数据库里建账号（只用于测试）----
async function makeUser(type, prefix) {
  const { db } = require("../server/db");
  const auth = require("../server/auth");
  const name = uid(prefix || type.slice(0, 3));
  const hash = await auth.hashPassword(PASSWORD);
  const info = db.prepare("INSERT INTO accounts (username, username_key, type, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(name, name.toLowerCase(), type, hash, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), username: name };
}
function linkSupervisor(supId, studentId) {
  const { db } = require("../server/db");
  db.prepare("INSERT OR IGNORE INTO supervisor_students (supervisor_id, student_id) VALUES (?, ?)").run(supId, studentId);
}
async function loginCtx(playwright, baseURL, username) {
  const ctx = await playwright.request.newContext({ baseURL, storageState: ANON });
  const res = await ctx.post("/api/login", { headers: H, data: { username, password: PASSWORD } });
  if (!res.ok()) throw new Error("登录失败 " + username + " " + res.status());
  return ctx;
}
// 最小的 PDF（只需要以 %PDF- 开头；内容不同便于区分）
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
async function uploadPdf(ctx, name, text) {
  const res = await ctx.post("/api/supervisor/files", {
    headers: { ...H, "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(name) },
    data: pdf(text || name)
  });
  if (res.status() !== 201) throw new Error("上传失败 " + res.status() + " " + (await res.text()));
  return (await res.json()).file;
}
// 给一场测试的每道题都打分（scores 按题号顺序），返回 PATCH 的响应
async function gradeAll(ctx, assessment, scores, extra) {
  const questions = assessment.questionFiles.map((q, i) => ({ questionFileId: q.id, score: scores[i], ...(extra && extra[i] ? extra[i] : {}) }));
  return ctx.patch(`/api/supervisor/assessments/${assessment.id}`, { headers: H, data: { questions } });
}
module.exports = Object.assign(module.exports, { makeUser, linkSupervisor, loginCtx, pdf, uploadPdf, gradeAll });
