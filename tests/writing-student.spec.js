// 写作板块（学生）：今天的任务状态、选题、草稿自动保存、过往记录、权限。不依赖 AI。
const { test, expect } = require("@playwright/test");
const { ANON, H, PASSWORD, makeUser, makeWritingStudent, linkSupervisor, loginCtx } = require("./helpers");

const today = (ctx) => ctx.get("/api/writing/today").then((r) => r.json());
const localDow = (tz = "America/Vancouver") => ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 })[new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date())];
const localHm = (tz = "America/Vancouver") => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

test("今天的任务：没有日程 / 暂停 / 今天不写 / 还没到时间 / 可以选题 / 没有题目", async ({ playwright, baseURL }) => {
  const { db } = require("../server/db");
  // 没有日程
  let u = await makeWritingStudent({ schedule: false });
  let ctx = await loginCtx(playwright, baseURL, u.username);
  expect((await today(ctx)).state).toBe("no_schedule");
  // 暂停
  db.prepare("INSERT INTO writing_schedules (student_id, time_of_day, days, paused, start_date, updated_at) VALUES (?, '00:00', 127, 1, '2000-01-01', ?)").run(u.id, new Date().toISOString());
  expect((await today(ctx)).state).toBe("paused");
  // 今天不是写作日
  db.prepare("UPDATE writing_schedules SET paused = 0, days = ? WHERE student_id = ?").run(127 & ~(1 << localDow()), u.id);
  expect((await today(ctx)).state).toBe("not_day");
  // 还没到时间（接近午夜时跳过这一项，避免越过 24:00）
  if (localHm() < "23:00") {
    db.prepare("UPDATE writing_schedules SET days = 127, time_of_day = '23:59' WHERE student_id = ?").run(u.id);
    const d = await today(ctx);
    expect([d.state, d.schedule.time]).toEqual(["not_yet", "23:59"]);
    const st = await ctx.post("/api/writing/start", { headers: H, data: { promptId: 1 } });
    expect([st.status(), (await st.json()).error]).toEqual([409, "NOT_AVAILABLE"]);
  }
  // 可以选题：列出还没写过的全部题目
  db.prepare("UPDATE writing_schedules SET days = 127, time_of_day = '00:00' WHERE student_id = ?").run(u.id);
  const d = await today(ctx);
  expect(d.state).toBe("choose");
  expect(d.prompts.map((p) => p.title)).toEqual(["My best day", "My pet", "A trip I remember"]);
  expect(d.prompts[0].hint).toBe("Who, where, why?");
  expect([d.grade, d.gradeLabel.en, d.tzLabel.en]).toEqual(["4", "Grade 4", "Vancouver, -7"]);
  // 没有题目
  db.prepare("DELETE FROM writing_prompts WHERE student_id = ?").run(u.id);
  expect((await today(ctx)).state).toBe("no_prompts");
  await ctx.dispose();
});

test("选题：写一个少一个；当天只能选一个；已用的题目不能再选；没有年级不能开始", async ({ playwright, baseURL }) => {
  const u = await makeWritingStudent();
  const ctx = await loginCtx(playwright, baseURL, u.username);
  const prompts = (await today(ctx)).prompts;
  const start = (promptId) => ctx.post("/api/writing/start", { headers: H, data: { promptId } });
  for (const bad of [undefined, "1", 99999999, null]) expect((await start(bad)).status(), String(bad)).toBe(404);
  // 别的孩子的题目不能选
  const other = await makeWritingStudent();
  const { db } = require("../server/db");
  const foreign = db.prepare("SELECT id FROM writing_prompts WHERE student_id = ?").get(other.id).id;
  expect((await start(foreign)).status()).toBe(404);
  const r = await start(prompts[1].id);
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(d.state).toBe("writing");
  expect(d.session).toMatchObject({ promptTitle: "My pet", draft: "", rounds: 0, status: "writing", minRounds: 2, maxRounds: 6, canAdvice: true, canFinish: true });
  expect((await start(prompts[0].id)).status()).toBe(409); // 当天只能选一个
  // 题目被标记为已用：督导者看到剩余 2 个，已用的不能改删
  expect(db.prepare("SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ? AND used_at IS NULL").get(u.id).n).toBe(2);
  expect((await today(ctx)).state).toBe("writing");
  // 没有年级
  const ng = await makeWritingStudent({ grade: null });
  db.prepare("UPDATE accounts SET grade = NULL WHERE id = ?").run(ng.id);
  const nctx = await loginCtx(playwright, baseURL, ng.username);
  const p2 = (await today(nctx)).prompts[0].id;
  const x = await nctx.post("/api/writing/start", { headers: H, data: { promptId: p2 } });
  expect([x.status(), (await x.json()).error]).toEqual([409, "NO_GRADE"]);
  await ctx.dispose(); await nctx.dispose();
});

test("草稿自动保存：保存后刷新还在；超长/类型错误被拒绝；没开始不能保存", async ({ playwright, baseURL }) => {
  const u = await makeWritingStudent();
  const ctx = await loginCtx(playwright, baseURL, u.username);
  const save = (data) => ctx.put("/api/writing/draft", { headers: H, data });
  let r = await save({ text: "x" });
  expect([r.status(), (await r.json()).error]).toEqual([409, "NO_SESSION"]);
  await ctx.post("/api/writing/start", { headers: H, data: { promptId: (await today(ctx)).prompts[0].id } });
  expect((await save({ text: "I went to the park." })).status()).toBe(200);
  expect((await today(ctx)).session.draft).toBe("I went to the park.");
  for (const bad of [{}, { text: 5 }, { text: "a".repeat(20001) }, { text: "ok", answers: "no" }, { text: "ok", answers: [1] }, { text: "ok", answers: ["a", "b", "c", "d"] }]) expect((await save(bad)).status(), JSON.stringify(bad)).toBe(422);
  await ctx.dispose();
});

test("权限：AP 学生、督导者、管理员不能用写作接口；写作学生不能用 AP 接口；未登录 401", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  expect((await anon.get("/api/writing/today")).status()).toBe(401);
  const ap = await loginCtx(playwright, baseURL, (await makeUser("student", "wap2", "AP Biology")).username);
  for (const [m, p] of [["get", "/api/writing/today"], ["get", "/api/writing/history"], ["post", "/api/writing/start"], ["put", "/api/writing/draft"], ["post", "/api/writing/advice"], ["post", "/api/writing/finish"]]) {
    const x = await ap[m](p, { headers: H, data: {} });
    expect([x.status(), (await x.json()).error], m + p).toEqual([403, "WRONG_DIRECTION"]);
  }
  const sup = await loginCtx(playwright, baseURL, (await makeUser("supervisor", "wsup2")).username);
  expect((await sup.get("/api/writing/today")).status()).toBe(403);
  const w = await loginCtx(playwright, baseURL, (await makeWritingStudent()).username);
  expect((await w.get("/api/student/overview")).status()).toBe(403);
  await anon.dispose(); await ap.dispose(); await sup.dispose(); await w.dispose();
});

test("每个孩子只能看到自己的写作（互不影响）", async ({ playwright, baseURL }) => {
  const a = await makeWritingStudent({ prompts: ["Only A"] });
  const b = await makeWritingStudent({ prompts: ["Only B"] });
  const ca = await loginCtx(playwright, baseURL, a.username), cb = await loginCtx(playwright, baseURL, b.username);
  expect((await today(ca)).prompts.map((p) => p.title)).toEqual(["Only A"]);
  expect((await today(cb)).prompts.map((p) => p.title)).toEqual(["Only B"]);
  await ca.post("/api/writing/start", { headers: H, data: { promptId: (await today(ca)).prompts[0].id } });
  await ca.put("/api/writing/draft", { headers: H, data: { text: "secret A" } });
  expect((await today(cb)).state).toBe("choose");
  expect(JSON.stringify(await today(cb))).not.toContain("secret A");
  await ca.dispose(); await cb.dispose();
});

test("过往记录：没写完的和漏写的日子（按日程推算，今天不算）", async ({ playwright, baseURL }) => {
  const { db } = require("../server/db");
  const u = await makeWritingStudent({ startDate: "2000-01-01" });
  const ctx = await loginCtx(playwright, baseURL, u.username);
  // 学生所在时区（默认温哥华）的日期：n 天前。服务器按学生当地日期算“昨天”和“今天”，测试也要一致
  const iso = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - n * 86400000));
  // 日程只在周一到周五；把起始日放在 6 天前
  db.prepare("UPDATE writing_schedules SET start_date = ?, days = 31 WHERE student_id = ?").run(iso(6), u.id);
  // 前天有一篇没写完的、昨天有一篇写完的
  db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, started_at) VALUES (?, ?, 'Old one', '4', 'writing', 'half', ?)").run(u.id, iso(2), new Date().toISOString());
  const sid = Number(db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, final_text, started_at, finished_at) VALUES (?, ?, 'Yesterday', '4', 'done', 'full', 'full essay', ?, ?)").run(u.id, iso(1), new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO writing_turns (session_id, round, essay, score, feedback, questions, done, created_at) VALUES (?, 1, 'e', 2, 'ok', '[]', 0, ?), (?, 2, 'full essay', 4, 'Great!', '[]', 1, ?)").run(sid, new Date().toISOString(), sid, new Date().toISOString());
  const items = (await (await ctx.get("/api/writing/history")).json()).items;
  const byDay = Object.fromEntries(items.map((i) => [i.day, i]));
  expect(byDay[iso(1)]).toMatchObject({ kind: "done", promptTitle: "Yesterday", finalScore: 4, rounds: 2, scores: [2, 4], essay: "full essay", feedback: "Great!" });
  expect(byDay[iso(2)]).toMatchObject({ kind: "unfinished", promptTitle: "Old one" });
  expect(byDay[iso(2)].essay).toBeNull(); // 没写完的不显示全文
  expect(byDay[iso(0)]).toBeUndefined(); // 今天不在过往记录里
  const missed = items.filter((i) => i.kind === "missed").map((i) => i.day);
  expect(missed.length).toBeLessThanOrEqual(14); // 漏写只推算最近 14 天
  for (const d of missed) expect(((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7)).toBeLessThan(5); // 只会漏写“日程里的日子”
  expect(missed).not.toContain(iso(1)); expect(missed).not.toContain(iso(2));
  await ctx.dispose();
});

/* ---------- 界面 ---------- */
async function login(page, username) { await page.request.post("/api/login", { headers: H, data: { username, password: PASSWORD } }); }

test("写作页：提示语、选题、写作区、自动保存、字数；不显示 AP 内容", async ({ page }) => {
  const u = await makeWritingStudent();
  await login(page, u.username);
  await page.goto("/writing/write");
  await expect(page.locator("#notice")).toContainText("read by an AI coach");
  await expect(page.locator("#whoami")).toContainText(u.username + " (Vancouver, time zone: -7)");
  await expect(page.getByRole("heading", { name: "Pick a topic for today" })).toBeVisible();
  await expect(page.locator(".topic-btn")).toHaveCount(3);
  await expect(page.locator(".topic-btn").first()).toContainText("Who, where, why?");
  await page.locator(".topic-btn", { hasText: "My pet" }).click();
  await expect(page.locator(".topic-line")).toHaveText("Topic: My pet");
  await expect(page.locator(".advice-card")).toContainText("Write a first draft");
  await expect(page.locator("#essay")).toBeVisible();
  await expect(page.getByRole("button", { name: "I'm done" })).toBeVisible(); // 任何时候都有“我写完了”
  await page.fill("#essay", "I have a little dog called Max.");
  await expect(page.locator(".essay-meta")).toContainText("7 words");
  await expect(page.locator(".save-state")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator("#essay")).toHaveValue("I have a little dog called Max.");
  await expect(page.locator("body")).not.toContainText("progress");
  // 其他状态
  const { db } = require("../server/db");
  const p = await makeWritingStudent({ schedule: false });
  await page.context().clearCookies();
  await login(page, p.username);
  await page.goto("/writing/write");
  await expect(page.locator("#today")).toContainText("Your writing time has not been set up yet");
  await expect(page.getByRole("link", { name: /Back to home/ })).toHaveAttribute("href", "/writing");
  void db;
});
