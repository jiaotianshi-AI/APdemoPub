// 写作记录：督导者回看每一轮、修改评分、安全标记、连续未完成；管理员删除某个孩子的全部写作记录。不依赖 AI（数据直接写入测试数据库）。
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { state, H, PASSWORD, makeUser, makeWritingStudent, linkSupervisor, loginCtx } = require("./helpers");

// 学生所在时区（默认温哥华）的日期：n 天前。服务器按学生当地日期算“昨天”，测试也要一致
const iso = (n) => { const d = new Date(Date.now() - n * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); };
const now = () => new Date().toISOString();

// 督导者 + 写作学生；day offset 1 = 昨天。done：写完（2 轮）；open：没写完（1 轮）
async function setup(playwright, baseURL, { flag = false, startDate } = {}) {
  const { db } = require("../server/db");
  const sup = await makeUser("supervisor", "wrsup");
  const stu = await makeWritingStudent({ startDate: startDate || iso(1) });
  linkSupervisor(sup.id, stu.id);
  const mkSession = (day, status, title) => Number(db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, final_text, started_at, finished_at) VALUES (?, ?, ?, '4', ?, ?, ?, ?, ?)")
    .run(stu.id, day, title, status, status === "done" ? "final text" : "half-written draft", status === "done" ? "final text" : null, now(), status === "done" ? now() : null).lastInsertRowid);
  const done = mkSession(iso(1), "done", "My best day");
  const open = mkSession(iso(2), "writing", "My pet");
  const turn = db.prepare("INSERT INTO writing_turns (session_id, round, essay, score, feedback, questions, answers, done, flag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  turn.run(done, 1, "I went to the park.", 2, "Good start!", JSON.stringify([{ type: "Who", text: "Who was with you?", quote: "I went to the park." }]), JSON.stringify(["my sister"]), 0, flag ? 1 : 0, now());
  turn.run(done, 2, "final text", 4, "Much better!", "[]", null, 1, 0, now());
  turn.run(open, 1, "half", 3, "Nice.", JSON.stringify([{ type: "Where", text: "Where was it?", quote: "half" }]), null, 0, 0, now());
  db.prepare("INSERT INTO writing_grades (session_id, ai_score, model, provider, updated_at) VALUES (?, 4, 'claude-opus-5-5', 'anthropic', ?)").run(done, now());
  if (flag) db.prepare("INSERT INTO writing_flags (session_id, reason, created_at) VALUES (?, 'AI flagged round 1', ?)").run(done, now());
  const ctx = await loginCtx(playwright, baseURL, sup.username);
  return { sup, stu, done, open, ctx };
}

test("写作记录列表和详情：每一轮的作文、分数、反馈、问题和回答；没写完的显示草稿；只能看自己关联的学生", async ({ playwright, baseURL }) => {
  const { stu, done, open, ctx } = await setup(playwright, baseURL);
  const list = await (await ctx.get(`/api/supervisor/writing/students/${stu.id}/sessions`)).json();
  expect(list.sessions.map((s) => [s.promptTitle, s.status, s.rounds, s.scores, s.aiScore, s.finalScore])).toEqual([
    ["My best day", "done", 2, [2, 4], 4, 4], ["My pet", "unfinished", 1, [3], null, null]]);
  const d = await (await ctx.get(`/api/supervisor/writing/sessions/${done}`)).json();
  expect(d.turns.map((t) => [t.round, t.essay, t.score, t.feedback, t.done])).toEqual([[1, "I went to the park.", 2, "Good start!", false], [2, "final text", 4, "Much better!", true]]);
  expect(d.turns[0].questions[0]).toMatchObject({ type: "Who", quote: "I went to the park." });
  expect(d.turns[0].answers).toEqual(["my sister"]);
  expect([d.finalText, d.model, d.provider]).toEqual(["final text", "claude-opus-5-5", "anthropic"]);
  const o = await (await ctx.get(`/api/supervisor/writing/sessions/${open}`)).json();
  expect([o.status, o.draft, o.finalText]).toEqual(["unfinished", "half-written draft", null]);
  // 别的督导者、学生、不存在的
  const other = await loginCtx(playwright, baseURL, (await makeUser("supervisor", "wrother")).username);
  expect((await other.get(`/api/supervisor/writing/sessions/${done}`)).status()).toBe(404);
  expect((await other.get(`/api/supervisor/writing/students/${stu.id}/sessions`)).status()).toBe(404);
  expect((await ctx.get("/api/supervisor/writing/sessions/99999999")).status()).toBe(404);
  const w = await loginCtx(playwright, baseURL, stu.username);
  expect((await w.get(`/api/supervisor/writing/sessions/${done}`)).status()).toBe(403);
  await ctx.dispose(); await other.dispose(); await w.dispose();
});

test("修改评分：1–5 + 评语；以督导者的为准，AI 原始分保留；可恢复；没写完不能评分；孩子能看到", async ({ playwright, baseURL }) => {
  const { stu, done, open, ctx } = await setup(playwright, baseURL);
  const put = (id, data) => ctx.put(`/api/supervisor/writing/sessions/${id}/grade`, { headers: H, data });
  for (const bad of [{ score: 0 }, { score: 6 }, { score: 2.5 }, { score: "3" }, { score: undefined }]) expect((await put(done, bad)).status(), JSON.stringify(bad)).toBe(422);
  expect((await put(done, { score: 3, comment: 5 })).status()).toBe(422);
  expect((await put(done, { score: 3, comment: "x".repeat(1001) })).status()).toBe(422);
  const nd = await put(open, { score: 3 });
  expect([nd.status(), (await nd.json()).error]).toEqual([409, "NOT_DONE"]);
  let r = await put(done, { score: 5, comment: "Wonderful progress!" });
  expect(r.status()).toBe(200);
  let d = await r.json();
  expect([d.aiScore, d.supervisorScore, d.finalScore, d.supervisorComment]).toEqual([4, 5, 5, "Wonderful progress!"]);
  // 列表里也是督导者的分数；AI 的分数仍在
  const list = await (await ctx.get(`/api/supervisor/writing/students/${stu.id}/sessions`)).json();
  expect(list.sessions[0]).toMatchObject({ aiScore: 4, supervisorScore: 5, finalScore: 5 });
  // 孩子看到：最终分数、督导者评语；历史里也是
  const w = await loginCtx(playwright, baseURL, stu.username);
  const hist = (await (await w.get("/api/writing/history")).json()).items.find((i) => i.promptTitle === "My best day");
  expect([hist.finalScore, hist.aiScore, hist.supervisorScore, hist.supervisorComment]).toEqual([5, 4, 5, "Wonderful progress!"]);
  // 恢复为 AI 的分数（评语可保留）
  d = await (await put(done, { score: null, comment: "" })).json();
  expect([d.supervisorScore, d.finalScore, d.supervisorComment]).toEqual([null, 4, ""]);
  // 只改评语不改分
  d = await (await put(done, { score: 3, comment: "Keep going" })).json();
  expect([d.finalScore, d.supervisorComment]).toEqual([3, "Keep going"]);
  // 审计日志不含评语内容
  const { db } = require("../server/db");
  const log = JSON.stringify(db.prepare("SELECT action, detail FROM audit_log WHERE action = 'writing_supervisor_grade'").all());
  expect(log).toContain("cleared");
  expect(log).not.toContain("Wonderful");
  // 别人不能改
  const other = await loginCtx(playwright, baseURL, (await makeUser("supervisor", "wrother2")).username);
  expect((await other.put(`/api/supervisor/writing/sessions/${done}/grade`, { headers: H, data: { score: 1 } })).status()).toBe(404);
  await ctx.dispose(); await w.dispose(); await other.dispose();
});

test("安全标记：未查看数量显示在学生列表和记录里；标记为已查看后清零；别人不能标记", async ({ playwright, baseURL }) => {
  const { stu, done, ctx } = await setup(playwright, baseURL, { flag: true });
  const students = async () => (await (await ctx.get("/api/supervisor/students")).json()).students.find((s) => s.id === stu.id);
  expect((await students()).writingFlags).toBe(1);
  let list = await (await ctx.get(`/api/supervisor/writing/students/${stu.id}/sessions`)).json();
  expect([list.unreviewedFlags, list.sessions[0].flags, list.sessions[0].openFlags]).toEqual([1, 1, 1]);
  expect((await (await ctx.get(`/api/supervisor/writing/students/${stu.id}`)).json()).unreviewedFlags).toBe(1);
  const other = await loginCtx(playwright, baseURL, (await makeUser("supervisor", "wrother3")).username);
  expect((await other.post(`/api/supervisor/writing/sessions/${done}/review-flags`, { headers: H })).status()).toBe(404);
  const r = await ctx.post(`/api/supervisor/writing/sessions/${done}/review-flags`, { headers: H });
  expect([r.status(), (await r.json()).openFlags, (await r.json()).flags]).toEqual([200, 0, 1]);
  expect((await students()).writingFlags).toBe(0);
  list = await (await ctx.get(`/api/supervisor/writing/students/${stu.id}/sessions`)).json();
  expect(list.unreviewedFlags).toBe(0);
  await ctx.dispose(); await other.dispose();
});

test("连续未完成：从昨天往前数日程里没写完的日子，遇到写完的就停；只数日程里的日子", async ({ playwright, baseURL }) => {
  const { db } = require("../server/db");
  const sup = await makeUser("supervisor", "wrstreak");
  const stu = await makeWritingStudent({ startDate: iso(10), days: 127 });
  linkSupervisor(sup.id, stu.id);
  const ctx = await loginCtx(playwright, baseURL, sup.username);
  const streak = async () => (await (await ctx.get("/api/supervisor/students")).json()).students.find((s) => s.id === stu.id).missedStreak;
  expect(await streak()).toBe(10);   // 起始日 10 天前，每天都没写
  // 3 天前写完了一篇：只数最近 2 天
  db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, final_text, started_at, finished_at) VALUES (?, ?, 'x', '4', 'done', 'a', 'a', ?, ?)").run(stu.id, iso(3), now(), now());
  expect(await streak()).toBe(2);
  // 昨天写完了：0
  db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, final_text, started_at, finished_at) VALUES (?, ?, 'y', '4', 'done', 'a', 'a', ?, ?)").run(stu.id, iso(1), now(), now());
  expect(await streak()).toBe(0);
  // 没有日程：0；AP 学生：null
  const ap = await makeUser("student", "wrstrap", "AP Biology");
  linkSupervisor(sup.id, ap.id);
  expect((await (await ctx.get("/api/supervisor/students")).json()).students.find((s) => s.id === ap.id).missedStreak).toBeNull();
  await ctx.dispose();
});

test("管理员删除某个孩子的全部写作记录：作文、每一轮、评分、标记和已用题目被删除；账号、日程、未用题目保留；权限和审计", async ({ playwright, baseURL }) => {
  const { db } = require("../server/db");
  const { stu, done, ctx } = await setup(playwright, baseURL, { flag: true });
  db.prepare("INSERT INTO writing_prompts (student_id, title, used_at, created_at) VALUES (?, 'Used one', ?, ?)").run(stu.id, now(), now());
  const keep = db.prepare("SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ? AND used_at IS NULL").get(stu.id).n;
  const other = await makeWritingStudent();
  db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, started_at) VALUES (?, ?, 'Other kid', '4', 'writing', 'z', ?)").run(other.id, iso(1), now());
  // 权限：督导者、学生、未登录不能删
  expect((await ctx.delete(`/api/admin/writing/students/${stu.id}/records`, { headers: H })).status()).toBe(403);
  const admin = await playwright.request.newContext({ baseURL, storageState: state("admin") });
  const url = `/api/admin/writing/students/${stu.id}/records`;
  expect((await admin.delete("/api/admin/writing/students/99999999/records", { headers: H })).status()).toBe(404);
  const ap = await makeUser("student", "wrdelap", "AP Biology");
  expect((await admin.delete(`/api/admin/writing/students/${ap.id}/records`, { headers: H })).status()).toBe(422);
  const r = await admin.delete(url, { headers: H });
  expect([r.status(), (await r.json())]).toEqual([200, { ok: true, deletedSessions: 2, deletedPrompts: 1 }]);
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  expect(n("SELECT COUNT(*) AS n FROM writing_sessions WHERE student_id = ?", stu.id)).toBe(0);
  expect(n("SELECT COUNT(*) AS n FROM writing_turns WHERE session_id = ?", done)).toBe(0);
  expect(n("SELECT COUNT(*) AS n FROM writing_grades WHERE session_id = ?", done)).toBe(0);
  expect(n("SELECT COUNT(*) AS n FROM writing_flags WHERE session_id = ?", done)).toBe(0);
  expect(n("SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ? AND used_at IS NOT NULL", stu.id)).toBe(0);
  expect(n("SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ? AND used_at IS NULL", stu.id)).toBe(keep); // 未用题目保留
  expect(n("SELECT COUNT(*) AS n FROM writing_schedules WHERE student_id = ?", stu.id)).toBe(1);               // 日程保留
  expect(n("SELECT COUNT(*) AS n FROM accounts WHERE id = ?", stu.id)).toBe(1);                              // 账号保留
  expect(n("SELECT COUNT(*) AS n FROM writing_sessions WHERE student_id = ?", other.id)).toBe(1);            // 别的孩子不受影响
  const log = db.prepare("SELECT detail FROM audit_log WHERE action = 'delete_writing_records' AND target_name = ?").get(stu.username);
  expect(log.detail).toBe("2 篇作文，1 个已用题目");
  expect(JSON.stringify(log)).not.toContain("final text");
  await ctx.dispose(); await admin.dispose();
});

/* ---------- 界面 ---------- */
async function login(page, username) { await page.request.post("/api/login", { headers: H, data: { username, password: PASSWORD } }); }

test("督导者页：写作记录——展开回看每一轮、修改评分并保存（孩子能看到）、恢复；安全提醒和连续未完成的提示", async ({ page, playwright, baseURL }) => {
  const { sup, stu } = await setup(playwright, baseURL, { flag: true, startDate: iso(8) });
  await login(page, sup.username);
  await page.goto("/supervisor");
  await expect(page.locator(".student-btn", { hasText: stu.username })).toContainText("安全提醒（1）");
  await page.locator(".student-btn", { hasText: stu.username }).click();
  await expect(page.locator("#w-flag-banner")).toContainText("1 条 AI 标记的安全内容还没查看");
  const items = page.locator("#w-records .rec-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("My best day");
  await expect(items.first()).toContainText("已完成");
  await expect(items.first()).toContainText("AI 4 / 5");
  await expect(items.first()).toContainText("第 1 轮 2 → 第 2 轮 4");
  await expect(items.first()).toContainText("安全提醒");
  await expect(items.nth(1)).toContainText("没写完");
  // 展开：每一轮
  await items.first().getByRole("button", { name: /^展开/ }).click();
  const rounds = items.first().locator(".rec-round");
  await expect(rounds).toHaveCount(2);
  await expect(rounds.first()).toContainText("第 1 轮　AI 评分 2 / 5");
  await expect(rounds.first().locator(".rec-essay")).toHaveText("I went to the park.");
  await expect(rounds.first()).toContainText("Who　Who was with you?");
  await expect(rounds.first()).toContainText("孩子的回答：my sister");
  await expect(rounds.nth(1)).toContainText("（结束）");
  // 修改评分
  await items.first().getByRole("radio", { name: /评分 5$/ }).check();
  await items.first().locator("textarea").fill("Wonderful progress!");
  await items.first().getByRole("button", { name: "保存评分" }).click();
  await expect(items.first().locator(".rec-grade .msg")).toHaveText("已保存。");
  await expect(items.first()).toContainText("你改为 5 / 5");
  await expect(items.first().getByRole("radio", { name: /评分 5$/ })).toBeChecked();
  // 恢复为 AI 的分数
  await items.first().getByRole("button", { name: "恢复为 AI 的分数" }).click();
  await expect(items.first().locator(".rec-grade .msg")).toHaveText("已恢复为 AI 的分数。");
  await expect(items.first()).not.toContainText("你改为");
  // 没选分数就保存
  await items.first().getByRole("button", { name: "保存评分" }).click();
  await expect(items.first().locator(".rec-grade .msg")).toHaveText("请先选择 1–5 的分数。");
  // 标记为已查看
  await items.first().getByRole("button", { name: /标记.*已查看/ }).click();
  await expect(page.locator("#w-flag-banner")).not.toContainText("安全内容还没查看");
  await expect(page.locator(".student-btn", { hasText: stu.username })).not.toContainText("安全提醒（");
  await expect(items.first()).toContainText("安全提醒（已查看）");
  // 没写完的一天：显示草稿，不能评分
  await items.nth(1).getByRole("button", { name: /^展开/ }).click();
  await expect(items.nth(1)).toContainText("这一天没有写完");
  await expect(items.nth(1).locator(".rec-essay").last()).toHaveText("half-written draft");
  await expect(items.nth(1).getByRole("button", { name: "保存评分" })).toHaveCount(0);
  const res = await new AxeBuilder({ page }).analyze();
  expect(res.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join("|"))).toEqual([]);
  if (test.info().project.name === "chromium") {
    const dir = require("path").join(__dirname, "screenshots", "writing");
    require("fs").mkdirSync(dir, { recursive: true });
    await items.first().getByRole("button", { name: /^收起/ }).click().catch(() => {});
    await items.first().getByRole("button", { name: /^展开/ }).click().catch(() => {});
    await page.screenshot({ path: require("path").join(dir, "supervisor-records.png"), fullPage: true });
  }
});

test("孩子页面：督导者改过分数后，看到最终分数、“督导者设定”的说明和评语", async ({ page, playwright, baseURL }) => {
  const { db } = require("../server/db");
  const u = await makeWritingStudent({ startDate: new Date().toISOString().slice(0, 10) });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const sid = Number(db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, final_text, started_at, finished_at) VALUES (?, ?, 'My pet', '4', 'done', 'fin', 'fin', ?, ?)").run(u.id, today, now(), now()).lastInsertRowid);
  db.prepare("INSERT INTO writing_turns (session_id, round, essay, score, feedback, questions, done, created_at) VALUES (?, 1, 'a', 2, 'ok', '[]', 0, ?), (?, 2, 'fin', 3, 'Nice!', '[]', 1, ?)").run(sid, now(), sid, now());
  db.prepare("INSERT INTO writing_grades (session_id, ai_score, supervisor_score, supervisor_comment, updated_at) VALUES (?, 3, 5, 'You worked so hard!', ?)").run(sid, now());
  await login(page, u.username);
  await page.goto("/writing");
  await expect(page.locator(".fs-num")).toHaveText("5 / 5");
  await expect(page.locator(".result-card")).toContainText("Your parent or teacher set this score. The AI coach suggested 3 / 5.");
  await expect(page.locator(".result-card")).toContainText("You worked so hard!");
});

test("管理页：写作学生的编辑对话框里“删除全部写作记录”（有确认）", async ({ page, playwright, baseURL }) => {
  const { db } = require("../server/db");
  const { stu } = await setup(playwright, baseURL);
  await page.request.post("/api/login", { headers: H, data: { username: "e2e_admin", password: PASSWORD } });
  await page.goto("/admin");
  await page.fill("#search", stu.username);
  const row = page.locator("#rows tr", { hasText: stu.username });
  await row.getByRole("button", { name: "编辑 " + stu.username }).click();
  await page.getByRole("button", { name: "删除 " + stu.username + " 的全部写作记录" }).click();
  await expect(page.locator("#confirm-message")).toContainText("不能撤销");
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#status")).toContainText("已删除 " + stu.username + " 的写作记录（2 篇作文");
  expect(db.prepare("SELECT COUNT(*) AS n FROM writing_sessions WHERE student_id = ?").get(stu.id).n).toBe(0);
});

test("督导者页：连续 3 天以上没写完时，学生列表和记录区提示“连续 N 天未完成”", async ({ page }) => {
  const sup = await makeUser("supervisor", "wrsup3");
  const stu = await makeWritingStudent({ startDate: iso(5) });
  linkSupervisor(sup.id, stu.id);
  await login(page, sup.username);
  await page.goto("/supervisor");
  await expect(page.locator(".student-btn", { hasText: stu.username })).toContainText("连续 5 天未完成");
  await page.locator(".student-btn", { hasText: stu.username }).click();
  await expect(page.locator("#w-flag-banner")).toContainText("连续 5 个写作日没有完成");
  await expect(page.locator("#w-records-empty")).toBeVisible();
});
