// Writing 首页：每日作文（坚持天数、评分曲线、下一次写作时间、马上开写/过往写作）、自学视频、写作精灵
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { ANON, H, PASSWORD, makeUser, makeWritingStudent, loginCtx } = require("./helpers");

test.use({ storageState: ANON });

// 学生所在时区（默认温哥华）的日期：n 天前（负数 = n 天后）
const iso = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - n * 86400000));
const now = () => new Date().toISOString();

// 给学生写入“已完成”的作文：scores = { 距今天数: 分数 }
function seedDone(stu, scores) {
  const { db } = require("../server/db");
  for (const [n, sc] of Object.entries(scores)) {
    const sid = Number(db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, final_text, started_at, finished_at) VALUES (?, ?, ?, '4', 'done', 'x', ?, ?, ?)")
      .run(stu.id, iso(Number(n)), "Topic " + n, "My essay " + n, now(), now()).lastInsertRowid);
    db.prepare("INSERT INTO writing_turns (session_id, round, essay, score, feedback, questions, answers, done, flag, created_at) VALUES (?, 1, ?, ?, 'Nice work!', '[]', null, 1, 0, ?)").run(sid, "My essay " + n, sc, now());
  }
}
const home = async (ctx) => (await (await ctx.get("/api/writing/home")).json());

test("首页接口：坚持天数（今天没写就从昨天算；非写作日不打断；漏写一天就断）和最近 30 天评分", async ({ playwright, baseURL }) => {
  const stu = await makeWritingStudent({ startDate: iso(40), time: "00:00" });
  seedDone(stu, { 1: 4, 2: 3, 3: 5, 5: 2 }); // 昨天、前天、大前天写了；4 天前漏写；5 天前写了
  const ctx = await loginCtx(playwright, baseURL, stu.username);
  let h = await home(ctx);
  expect([h.streak, h.totalDone]).toEqual([3, 4]);
  expect(h.series.map((x) => [x.day, x.score])).toEqual([[iso(5), 2], [iso(3), 5], [iso(2), 3], [iso(1), 4]]);
  expect(h.series.every((x) => x.score >= 1 && x.score <= 5)).toBe(true);
  // 今天也写完：算进去
  seedDone(stu, { 0: 4 });
  h = await home(ctx);
  expect(h.streak).toBe(4);
  // 只在周一到周五写作：周末不打断（这里直接检查 30 天窗口外的不出现）
  seedDone(stu, { 35: 3 });
  h = await home(ctx);
  expect(h.series.find((x) => x.day === iso(35))).toBeUndefined();
  expect(h.totalDone).toBe(6);
  // 别的角色不能用
  const sup = await loginCtx(playwright, baseURL, (await makeUser("supervisor", "whsup")).username);
  expect((await sup.get("/api/writing/home")).status()).toBe(403);
  const ap = await loginCtx(playwright, baseURL, (await makeUser("student", "whap", "AP Biology")).username);
  expect((await ap.get("/api/writing/home")).status()).toBe(403);
  expect((await (await playwright.request.newContext({ baseURL })).get("/api/writing/home")).status()).toBe(401);
  await ctx.dispose(); await sup.dispose(); await ap.dispose();
});

test("首页接口：没有写过 → 0 天；日程不在写作日不打断连续天数", async ({ playwright, baseURL }) => {
  const stu = await makeWritingStudent({ startDate: iso(40), days: 31, time: "00:00" }); // 只有周一到周五
  const ctx = await loginCtx(playwright, baseURL, stu.username);
  let h = await home(ctx);
  expect([h.streak, h.totalDone, h.series]).toEqual([0, 0, []]);
  // 把最近 10 天里所有工作日都写完：周末不打断
  const dow = (n) => (new Date(Date.now() - n * 86400000).getUTCDay() + 6) % 7;
  const scores = {};
  for (let n = 1; n <= 10; n++) {
    const d = new Date(iso(n) + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7;
    if (w <= 4) scores[n] = 3;
  }
  void dow;
  seedDone(stu, scores);
  h = await home(ctx);
  expect(h.streak).toBe(Object.keys(scores).length);
  await ctx.dispose();
});

test("首页接口：下一次写作时间（没设置 / 暂停 / 现在可写 / 写作中 / 今天已写完 → 下一个写作日）", async ({ playwright, baseURL }) => {
  const { db } = require("../server/db");
  // 没有日程
  let stu = await makeWritingStudent({ schedule: false });
  let ctx = await loginCtx(playwright, baseURL, stu.username);
  expect((await home(ctx)).next).toEqual({ kind: "none" });
  await ctx.dispose();
  // 暂停
  stu = await makeWritingStudent({ time: "00:00" });
  db.prepare("UPDATE writing_schedules SET paused = 1 WHERE student_id = ?").run(stu.id);
  ctx = await loginCtx(playwright, baseURL, stu.username);
  expect((await home(ctx)).next).toEqual({ kind: "paused" });
  await ctx.dispose();
  // 现在可写（每天 00:00）
  stu = await makeWritingStudent({ time: "00:00" });
  ctx = await loginCtx(playwright, baseURL, stu.username);
  let n = (await home(ctx)).next;
  expect([n.kind, n.time, !!n.continuing]).toEqual(["now", "00:00", false]);
  // 选了题、还没写完：写作中
  const p = db.prepare("SELECT id, title FROM writing_prompts WHERE student_id = ? ORDER BY id").get(stu.id);
  expect((await ctx.post("/api/writing/start", { headers: H, data: { promptId: p.id } })).status()).toBe(200);
  n = (await home(ctx)).next;
  expect([n.kind, !!n.continuing]).toEqual(["now", true]);
  // 写完：下一个写作日（每天 → 明天）
  db.prepare("UPDATE writing_sessions SET status = 'done', final_text = 'x' WHERE student_id = ?").run(stu.id);
  n = (await home(ctx)).next;
  expect([n.kind, n.offset, n.doneToday, n.day, n.time]).toEqual(["later", 1, true, iso(-1), "00:00"]);
  await ctx.dispose();
  // 还没到日程时间：今天 23:59（接近午夜时已经是 now，这里不强求）
  stu = await makeWritingStudent({ time: "23:59" });
  ctx = await loginCtx(playwright, baseURL, stu.username);
  n = (await home(ctx)).next;
  expect(["today", "now"]).toContain(n.kind);
  if (n.kind === "today") expect([n.day, n.time, n.offset]).toEqual([iso(0), "23:59", 0]);
  // 没到时间也能开始：选题、开始都成功
  const pr = db.prepare("SELECT id FROM writing_prompts WHERE student_id = ? ORDER BY id").get(stu.id);
  expect((await ctx.post("/api/writing/start", { headers: H, data: { promptId: pr.id } })).status()).toBe(200);
  await ctx.dispose();
});

async function login(page, username) {
  await page.context().clearCookies();
  const res = await page.request.post("/api/login", { headers: H, data: { username, password: PASSWORD } });
  expect(res.status()).toBe(200);
}
async function stubThumbs(page) {
  const GIF = Buffer.from("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=", "base64");
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ contentType: "image/gif", body: GIF }));
}

test("首页（中文）：每日作文方框、自学视频、写作精灵；文案和布局", async ({ page }) => {
  const stu = await makeWritingStudent({ startDate: iso(30), time: "00:00" });
  seedDone(stu, { 1: 4, 2: 3, 3: 3, 5: 2 });
  await login(page, stu.username);
  await stubThumbs(page);
  await page.goto("/writing?lang=zh");
  await expect(page.locator("#h-daily")).toHaveText("每日作文");
  await expect(page.locator("#mod-daily .streak")).toContainText("恭喜！你已坚持每天作文");
  await expect(page.locator("#mod-daily .streak-num")).toHaveText("3");
  await expect(page.locator("#mod-daily .streak")).toContainText("天");
  await expect(page.locator("#mod-daily")).toContainText("作文成绩趋势");
  await expect(page.locator("#next-box .kv-label")).toHaveText("下次写作");
  await expect(page.locator("#last-box .kv-label")).toHaveText("上次写作");
  await expect(page.locator("#mod-daily .status-badge")).toHaveText("现在可以写作了");
  // 上次写作：日期、状态、评分、题目、每轮分数；“过往写作”在上次写作框里，“马上开写”在下次写作框里
  await expect(page.locator("#last-box")).toContainText("上次写作");
  await expect(page.locator("#last-box .last-day")).toHaveText(new RegExp("^\\d+月\\d+日$"));
  await expect(page.locator("#last-box")).toContainText("已完成");
  await expect(page.locator("#last-box .score-badge")).toHaveText("评分 4 / 5");
  await expect(page.locator("#last-box .last-title")).toHaveText("Topic 1");
  await expect(page.locator("#last-box .last-steps")).toHaveCount(0); // 上次写作里不显示每轮分数
  await expect(page.locator("#last-box").getByRole("button", { name: "过往写作" })).toBeVisible();
  await expect(page.locator("#next-box").getByRole("link", { name: "马上开写" })).toBeVisible();
  expect(await page.locator("#last-box").evaluate((a) => a.getBoundingClientRect().bottom <= document.querySelector("#next-box").getBoundingClientRect().top)).toBe(true); // 上次写作在上，下次写作在下
  await expect(page.getByRole("link", { name: "马上开写" })).toHaveAttribute("href", "/writing/write");
  await expect(page.getByRole("button", { name: "过往写作" })).toBeVisible();
  // 曲线：默认近 7 天，可切换近 30 天
  await expect(page.getByRole("button", { name: "近 7 天" })).toHaveAttribute("aria-pressed", "true");
  const svg = page.locator("#chart svg");
  await expect(svg).toHaveAttribute("aria-label", /作文成绩趋势，近 7 天/);
  await expect(svg.locator("circle")).toHaveCount(4);
  await page.getByRole("button", { name: "近 30 天" }).click();
  await expect(page.getByRole("button", { name: "近 30 天" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#chart svg circle")).toHaveCount(4);
  // 其他两个模块
  await expect(page.locator("#h-videos")).toHaveText("自学视频");
  await expect(page.locator("#mod-videos .tagline")).toHaveText("精选名师讲作文");
  await expect(page.locator("#videos-body .video-entry")).toHaveCount(3);
  await expect(page.locator("#h-qa")).toHaveText("写作精灵");
  await expect(page.locator("#mod-qa .tagline")).toHaveText("跟我学，写好文章");
  await expect(page.locator("#qa-body .qa-item")).toHaveCount(1);
  // 不再出现 AP 的内容
  await expect(page.locator("body")).not.toContainText("进度和测试");
  await expect(page.locator("body")).not.toContainText("AP 问答机器人");
  await expect(page.locator("body")).not.toContainText("College Board");
  // 顺序：每日作文在最前
  expect(await page.locator("section.module").evaluateAll((a) => a.map((s) => s.id))).toEqual(["mod-daily", "mod-videos", "mod-qa"]);
});

test("首页（英文）：切换语言；没写过时的鼓励语和空曲线", async ({ page }) => {
  const stu = await makeWritingStudent({ startDate: iso(3), time: "00:00" });
  await login(page, stu.username);
  await stubThumbs(page);
  await page.goto("/writing?lang=en");
  await expect(page.locator("#h-daily")).toHaveText("Daily Writing");
  await expect(page.locator("#mod-daily .streak")).toHaveText("Start your writing streak today!");
  await expect(page.locator("#chart")).toContainText("Your score curve will appear after your first essay.");
  await expect(page.locator("#last-box")).toContainText("No writing yet.");
  await expect(page.locator("#last-box .kv-label")).toHaveText("Last writing");
  await expect(page.locator("#next-box .kv-label")).toHaveText("Next writing");
  await expect(page.getByRole("link", { name: "Start writing" })).toBeVisible();
  await expect(page.locator("#mod-videos .tagline")).toHaveText("Writing lessons from top teachers");
  await expect(page.locator("#h-qa")).toHaveText("Writing Genie");
  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.locator("#h-daily")).toHaveText("每日作文");
  await expect(page.locator("#mod-daily .streak")).toHaveText("今天就开始你的作文记录吧！");
  await expect(page).toHaveTitle("FocusGo · 写作");
});

test("首页：按钮状态——暂停/没设置/今天已写完时“马上开写”不可点；英文 1 天用单数", async ({ page }) => {
  const { db } = require("../server/db");
  const stu = await makeWritingStudent({ startDate: iso(3), time: "00:00" });
  seedDone(stu, { 0: 3 });
  await login(page, stu.username);
  await stubThumbs(page);
  await page.goto("/writing?lang=en");
  await expect(page.locator("#mod-daily .streak")).toContainText("1 day");
  await expect(page.locator("#mod-daily .streak")).not.toContainText("1 days");
  await expect(page.locator("#mod-daily .status-badge")).toHaveText("Done for today");
  await expect(page.locator("#mod-daily")).toContainText("Tomorrow 12:00 AM");
  await expect(page.locator("#start-btn")).toBeDisabled();
  await expect(page.locator("#past-btn")).toBeEnabled();
  db.prepare("UPDATE writing_schedules SET paused = 1 WHERE student_id = ?").run(stu.id);
  await page.reload();
  await expect(page.locator("#mod-daily")).toContainText("Writing is paused");
  await expect(page.locator("#start-btn")).toBeDisabled();
});

test("首页：过往写作弹窗——已完成（可展开看作文和评语）、没写完、漏写；Esc 关闭并回到按钮", async ({ page }) => {
  const { db } = require("../server/db");
  const stu = await makeWritingStudent({ startDate: iso(6), time: "00:00" });
  seedDone(stu, { 1: 4, 3: 2 });
  const sid = db.prepare("SELECT id FROM writing_sessions WHERE student_id = ? AND day = ?").get(stu.id, iso(1)).id;
  db.prepare("INSERT INTO writing_grades (session_id, ai_score, supervisor_score, supervisor_comment, updated_at) VALUES (?, 4, 5, 'So proud of you!', ?)").run(sid, now());
  await login(page, stu.username);
  await stubThumbs(page);
  await page.goto("/writing?lang=en");
  await page.locator("#past-btn").click();
  const dialog = page.locator("#modal-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#modal-title")).toHaveText("Past writing");
  await expect(dialog.locator(".wp-item")).not.toHaveCount(0);
  const first = dialog.locator(".wp-item", { hasText: "Topic 1" });
  await expect(first).toContainText("Finished");
  await expect(first).toContainText("Score 5 / 5"); // 家长/老师改过分，以改后的为准
  await expect(first.locator(".wp-detail")).toBeHidden();
  await first.getByRole("button", { name: "Show" }).click();
  await expect(first.locator(".wp-essay")).toHaveText("My essay 1");
  await expect(first).toContainText("So proud of you!");
  await expect(dialog.locator(".wp-missed").first()).toContainText("Missed");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#past-btn")).toBeFocused();
  // 中文
  await page.goto("/writing?lang=zh");
  await page.locator("#past-btn").click();
  await expect(page.locator("#modal-title")).toHaveText("过往写作");
  await expect(page.locator(".wp-item", { hasText: "Topic 1" })).toContainText("评分 5 / 5");
});

test("首页：手机竖屏无横向滚动；无障碍（axe）；触控目标 ≥ 44px", async ({ page }) => {
  const stu = await makeWritingStudent({ startDate: iso(30), time: "00:00" });
  seedDone(stu, { 1: 4, 2: 3, 3: 3, 5: 2, 9: 1 });
  await login(page, stu.username);
  await stubThumbs(page);
  for (const lang of ["zh", "en"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/writing?lang=" + lang);
    await expect(page.locator("#chart svg")).toBeVisible();
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw[0], lang).toBeLessThanOrEqual(sw[1]);
    const res = await new AxeBuilder({ page }).analyze();
    expect(res.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => lang + " " + v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(" | "))).toEqual([]);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("button, a[href], input, select")).filter((e) => e.offsetParent !== null)
      .map((e) => { const b = e.getBoundingClientRect(); return { n: e.tagName + "#" + (e.id || e.textContent.trim().slice(0, 12)), w: Math.round(b.width), h: Math.round(b.height) }; })
      .filter((x) => x.h < 44 || x.w < 44));
    expect(small, lang).toEqual([]);
  }
});

test("首页：点“马上开写”进入写作页，写作页有“返回首页”", async ({ page }) => {
  const stu = await makeWritingStudent({ startDate: iso(3), time: "00:00" });
  await login(page, stu.username);
  await stubThumbs(page);
  await page.goto("/writing?lang=en");
  await page.getByRole("link", { name: "Start writing" }).click();
  await expect(page).toHaveURL(/\/writing\/write$/);
  await expect(page.getByRole("heading", { name: "Pick a topic for today" })).toBeVisible();
  await page.getByRole("link", { name: /Back to home/ }).click();
  await expect(page).toHaveURL(/\/writing$/);
});

test("权限：/writing/write 只有写作学生能进；AP 学生、督导者回到各自首页", async ({ playwright, baseURL }) => {
  const w = await loginCtx(playwright, baseURL, (await makeWritingStudent()).username);
  expect((await w.get("/writing/write", { maxRedirects: 0 })).status()).toBe(200);
  const ap = await loginCtx(playwright, baseURL, (await makeUser("student", "wwap", "AP Biology")).username);
  expect((await ap.get("/writing/write", { maxRedirects: 0 })).headers().location).toBe("/apdemo");
  const sup = await loginCtx(playwright, baseURL, (await makeUser("supervisor", "wwsup")).username);
  expect((await sup.get("/writing/write", { maxRedirects: 0 })).headers().location).toBe("/supervisor");
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.get("/writing/write", { maxRedirects: 0 })).status()).toBe(302);
  expect((await anon.get("/assets/js/writing-home.js", { maxRedirects: 0 })).status()).toBe(401);
  expect((await ap.get("/assets/js/writing-home.js")).status()).toBe(200);
  await w.dispose(); await ap.dispose(); await sup.dispose(); await anon.dispose();
});

test("首页接口：上次写作（最近一篇；今天还没写完的不算）", async ({ playwright, baseURL }) => {
  const { db } = require("../server/db");
  const stu = await makeWritingStudent({ startDate: iso(10), time: "00:00" });
  const ctx = await loginCtx(playwright, baseURL, stu.username);
  expect((await home(ctx)).last).toBeNull();
  seedDone(stu, { 3: 2, 1: 4 });
  let h = await home(ctx);
  expect(h.last).toEqual({ day: iso(1), kind: "done", promptTitle: "Topic 1", finalScore: 4, scores: [4] });
  // 今天正在写、还没写完的不算“上次”（它是“下次写作”里的“继续写作”）
  db.prepare("INSERT INTO writing_sessions (student_id, day, prompt_title, grade, status, draft, started_at) VALUES (?, ?, 'Half', '4', 'writing', 'x', ?)").run(stu.id, iso(0), now());
  h = await home(ctx);
  expect(h.last.day).toBe(iso(1));
  // 督导者改过分：以改后的为准
  const sid = db.prepare("SELECT id FROM writing_sessions WHERE student_id = ? AND day = ?").get(stu.id, iso(1)).id;
  db.prepare("INSERT INTO writing_grades (session_id, ai_score, supervisor_score, updated_at) VALUES (?, 4, 5, ?)").run(sid, now());
  h = await home(ctx);
  expect(h.last.finalScore).toBe(5);
  await ctx.dispose();
});

test("今天不是写作日：“马上开写”不能点，并说明原因（今天不是写作日）；暂停/已完成也各有说明", async ({ page }) => {
  const { db } = require("../server/db");
  const stu = await makeWritingStudent({ startDate: iso(10), time: "00:00" });
  const dowToday = (new Date(iso(0) + "T12:00:00Z").getUTCDay() + 6) % 7; // 周一 = 0
  db.prepare("UPDATE writing_schedules SET days = ? WHERE student_id = ?").run(127 & ~(1 << dowToday), stu.id);
  await login(page, stu.username);
  await stubThumbs(page);
  await page.goto("/writing?lang=zh");
  await expect(page.locator("#next-box .status-badge")).toHaveText("今天不是写作日");
  await expect(page.locator("#start-btn")).toBeDisabled();
  await page.goto("/writing?lang=en");
  await expect(page.locator("#next-box .status-badge")).toHaveText("Not a writing day today");
  // 是写作日：可以点（没到日程时间也行）
  db.prepare("UPDATE writing_schedules SET days = 127, time_of_day = '23:59' WHERE student_id = ?").run(stu.id);
  await page.reload();
  await expect(page.locator("#start-btn")).toBeEnabled();
  await expect(page.locator("#start-btn")).toHaveAttribute("href", "/writing/write");
});
