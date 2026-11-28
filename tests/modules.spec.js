// 模块功能：T3 T4 T5 T6 T7 T8 T9 T10 T11 T18 T21 T23
const { test, expect } = require("@playwright/test");

const SITE_URLS = ["https://myap.collegeboard.org/", "https://www.khanacademy.org/", "https://classroom.google.com/"];
const VIDEO_IDS = ["gjswMPTXYk4", "t21f03JfGPk", "KSAPc5NwLYU"];

function watch(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return errors;
}
// 沙箱网络无法访问 i.ytimg.com；用 1x1 GIF 代替，仍可验证请求确实发往该主机
const GIF = Buffer.from("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=", "base64");
async function stubThumbs(page) {
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ contentType: "image/gif", body: GIF }));
}
async function ready(page, lang = "zh") {
  if (!page.__thumbStubbed) { page.__thumbStubbed = true; await stubThumbs(page).catch(() => {}); }
  await page.goto(`index.html?lang=${lang}`);
  await page.waitForSelector("#progress-body .bar");
  await page.waitForSelector("#sites-body .ref-link");
  await page.waitForSelector("#videos-body .video-entry");
  await page.waitForSelector("#qa-body .qa-item");
}

test("T3/T4 无控制台错误；加载时只有同源请求和 i.ytimg.com", async ({ page, baseURL }) => {
  const errors = watch(page);
  const hosts = new Set();
  page.on("request", (r) => { const u = new URL(r.url()); if (u.protocol.startsWith("http")) hosts.add(u.host); });
  await ready(page);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  const own = new URL(baseURL).host;
  for (const h of hosts) expect([own, "i.ytimg.com"]).toContain(h);
  expect([...hosts].some((h) => h.includes("youtube-nocookie.com"))).toBe(false);
});

test("T5 关联网站链接（页面底部）", async ({ page, context }) => {
  await ready(page);
  const links = page.locator("#mod-sites a");
  await expect(links).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(links.nth(i)).toHaveAttribute("href", SITE_URLS[i]);
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    expect(await links.nth(i).getAttribute("rel")).toContain("noopener");
    expect(await links.nth(i).getAttribute("rel")).toContain("noreferrer");
  }
  await context.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith("http://localhost")) return r.continue();
    return r.fulfill({ contentType: "text/html", body: "<html><body>stub</body></html>" });
  });
  for (let i = 0; i < 3; i++) {
    const [popup] = await Promise.all([page.waitForEvent("popup"), links.nth(i).click()]);
    await popup.waitForLoadState("commit").catch(() => {});
    expect(popup.url().startsWith(SITE_URLS[i])).toBe(true);
    await popup.close();
  }
});

test("T6 视频入口与模态窗口", async ({ page }) => {
  await ready(page);
  const items = page.locator("#videos-body .video-entry");
  await expect(items).toHaveCount(3);
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<html><body>stub</body></html>" }));
  for (let i = 0; i < 3; i++) {
    await items.nth(i).click();
    const iframe = page.locator("#modal iframe");
    const src = await iframe.getAttribute("src");
    expect(src.startsWith(`https://www.youtube-nocookie.com/embed/${VIDEO_IDS[i]}`)).toBe(true);
    expect(src).not.toContain("autoplay");
    await expect(page.locator("#modal .yt-link")).toHaveAttribute("href", `https://www.youtube.com/watch?v=${VIDEO_IDS[i]}`);
    await page.keyboard.press("Escape");
    await expect(page.locator("#modal")).toBeHidden();
    expect(await page.locator("#modal iframe").count()).toBe(0);
    await expect(items.nth(i)).toBeFocused();
  }
  // 点击遮罩关闭 + 焦点陷阱
  await items.nth(0).click();
  for (let k = 0; k < 6; k++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => { const a = document.activeElement; return [!!a.closest("#modal-dialog") || a === document.body /* 焦点在 iframe 内时顶层文档报告 BODY */, a.tagName + "." + a.className]; });
    expect(info[0], "第" + k + "次 Tab 后焦点在 " + info[1]).toBe(true);
  }
  await page.mouse.click(5, 5);
  await expect(page.locator("#modal")).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains("modal-open"))).toBe(false);
});

test("T7 封面加载失败显示占位", async ({ page }) => {
  page.__thumbStubbed = true;
  await page.route("https://i.ytimg.com/**", (r) => r.abort());
  await ready(page);
  await expect(page.locator("#videos-body .thumb-failed")).toHaveCount(3);
  expect(await page.locator("#videos-body img").count()).toBe(0);
  await page.locator("#videos-body .video-entry").first().click();
  await expect(page.locator("#modal")).toBeVisible();
});

// 测试学生固定的测试：2030-06-15 15:00（温哥华 UTC-7），本单元从 2030-06-01 00:00 开始（见 tests/global-setup.js）
const START_MS = Date.parse("2030-06-01T00:00:00-07:00");
const TEST_MS = Date.parse("2030-06-15T15:00:00-07:00");
const atFraction = (f) => new Date(START_MS + f * (TEST_MS - START_MS));

test("T8 进度块：进度 = 本单元开始日到测试时间已走过的比例", async ({ page }) => {
  await page.clock.install({ time: atFraction(0.105) }); // 10.5% → 向下取整为 10%
  await ready(page);
  const bar = page.locator("#progress-body [role=progressbar]");
  await expect(bar).toHaveAttribute("aria-valuenow", "10");
  await expect(bar).toHaveAttribute("aria-valuemin", "0");
  await expect(bar).toHaveAttribute("aria-valuemax", "100");
  await expect(page.locator("#mod-progress")).toContainText("10%");
  const [bw, fw] = await page.evaluate(() => {
    const b = document.querySelector("#progress-body [role=progressbar]");
    return [b.getBoundingClientRect().width, b.firstElementChild.getBoundingClientRect().width];
  });
  expect(Math.abs(fw / bw - 0.1)).toBeLessThanOrEqual(0.005);
  expect(await page.locator("#mod-progress input, #mod-progress textarea, #mod-progress select").count()).toBe(0); // 卡片里有按钮（所有测试、马上测试），但没有任何输入框
  await expect(page.locator("#progress-body")).toContainText("AP Biology · Unit 2");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#progress-body")).toContainText("AP Biology · Unit 2");
  await expect(page.locator("#progress-body")).toContainText("Due time for stage test");
});

test("T8 进度的边界：开始前为 0%，测试时间之后为 100%", async ({ page }) => {
  await page.clock.install({ time: new Date(START_MS - 5 * 86400000) });
  await ready(page);
  await expect(page.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "0");
  const p2 = await page.context().newPage();
  await p2.clock.install({ time: new Date(TEST_MS + 3600000) });
  await p2.goto("index.html?lang=zh");
  await p2.waitForSelector("[role=progressbar]");
  await expect(p2.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "100");
});

test("T9 测试时间与倒计时/到点后显示“可以开始测试”", async ({ page }) => {
  await page.clock.install({ time: new Date("2030-06-14T07:30:00-07:00") });
  await ready(page, "zh");
  await expect(page.locator("#progress-body")).toContainText("2030年6月15日 3:00 PM");
  await expect(page.locator(".status-badge")).toHaveText("你还有 1 天 7 小时");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#progress-body")).toContainText("Jun 15, 2030, 3:00 PM");
  await expect(page.locator(".status-badge")).toHaveText("You have 1 d 7 h left");

  const page2 = await page.context().newPage();
  await page2.clock.install({ time: new Date("2030-06-16T08:00:00-07:00") });
  await page2.goto("index.html?lang=zh");
  await page2.waitForSelector(".status-badge");
  await expect(page2.locator(".status-badge")).toHaveText("可以开始测试");
  await page2.goto("index.html?lang=en");
  await page2.waitForSelector(".status-badge");
  await expect(page2.locator(".status-badge")).toHaveText("Ready to start");
});

test("T10 机器人模块", async ({ page }) => {
  await ready(page, "zh");
  const img = page.locator("#qa-body img.qa-illustration");
  await expect(img).toHaveAttribute("role", "img");
  expect((await img.getAttribute("aria-label")).length).toBeGreaterThan(0);
  expect(await img.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
  await expect(page.locator("#qa-body")).toContainText("细胞膜是如何控制物质进出细胞的？");
  await expect(page.locator("#qa-body")).toContainText("细胞膜具有选择透过性");
  await expect(page.locator("#qa-body")).toContainText("演示示例");
  await expect(page.locator("#qa-body")).toContainText("学生可以针对 AP 学习提问，机器人查询 AP 学习资料后给出回答（示意图，功能尚未上线）");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#qa-body")).toContainText("How does the cell membrane control what enters and leaves the cell?");
  await expect(page.locator("#qa-body")).toContainText("The membrane is selectively permeable");
  await expect(page.locator("#qa-body")).toContainText("Demo example");
  expect(await page.locator("#mod-qa input, #mod-qa textarea").count()).toBe(0);
});

test("T11 用户区：右上角显示当前账号和“退出登录”，点击后回到登录页并结束会话", async ({ page }) => {
  // 用独立的新会话测试退出，避免结束其他用例共用的学生登录状态
  const login = await page.request.post("/api/login", { headers: { "X-Requested-With": "apdemo" }, data: { username: "e2e_student", password: "E2e-Passw0rd!" } });
  expect(login.status()).toBe(200);
  await ready(page);
  await expect(page.locator("#user-name")).toHaveText("e2e_student（温哥华，时区：-7）"); // 账号名和所在时区一起显示
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#user-name")).toHaveText("e2e_student (Vancouver, time zone: -7)");
  const btn = page.locator("#logout-btn");
  const box = await btn.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThan(vw / 2);
  expect(box.y).toBeLessThan(100);
  expect(await page.locator("#modal input, #modal form, form, input").count()).toBe(0);
  await btn.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("index.html");
  await expect(page).toHaveURL(/\/login$/);
});

test("T18 数据驱动：页面内容来自后台接口，不是写死的", async ({ page }) => {
  const s0 = Date.parse("2030-01-01T00:00:00-08:00"), e0 = Date.parse("2030-01-11T14:30:00-08:00");
  await page.clock.install({ time: new Date(s0 + 0.405 * (e0 - s0)) }); // 走过约 40.5% → 向下取整为 40%
  await page.route("**/api/student/overview", async (route) => {
    const j = await (await route.fetch()).json();
    j.next = { ...j.next, subject: "AP Chemistry", unit: "Unit 7", unitStartAt: "2030-01-01T00:00:00-08:00", unitStartDate: "2030-01-01",
      scheduledAt: "2030-01-11T14:30:00-08:00", scheduledWall: "2030-01-11T14:30", timezone: "America/Vancouver" };
    route.fulfill({ json: j });
  });
  await page.route("**/data/sites.json", async (route) => {
    const j = await (await route.fetch()).json();
    j.items.pop();
    route.fulfill({ json: j });
  });
  await ready(page, "en");
  await expect(page.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "40");
  const [bw, fw] = await page.evaluate(() => {
    const b = document.querySelector("[role=progressbar]");
    return [b.getBoundingClientRect().width, b.firstElementChild.getBoundingClientRect().width];
  });
  expect(Math.abs(fw / bw - 0.4)).toBeLessThanOrEqual(0.01);
  await expect(page.locator("#sites-body a")).toHaveCount(2);
  await expect(page.locator("#progress-body")).toContainText("AP Chemistry · Unit 7");
  await expect(page.locator("#progress-body")).toContainText("Jan 11, 2030, 2:30 PM");
});

test("没有安排测试时：显示科目和“暂无已安排的测试”，没有进度条", async ({ page }) => {
  await page.route("**/api/student/overview", (route) => route.fulfill({ json: { username: "e2e_student", subject: "AP Biology", next: null } }));
  await page.goto("index.html?lang=zh");
  await expect(page.locator("#progress-body")).toContainText("AP Biology");
  await expect(page.locator("#progress-body")).toContainText("暂无已安排的测试");
  await expect(page.locator("[role=progressbar]")).toHaveCount(0);
  await page.route("**/api/student/overview", (route) => route.fulfill({ json: { username: "e2e_student", subject: null, next: null } }));
  await page.reload();
  await expect(page.locator("#progress-body")).toContainText("尚未设置学习科目");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#progress-body")).toContainText("No study subject set yet");
  await expect(page.locator("#progress-body")).toContainText("No test scheduled");
});

test("学生有多个未来测试时，只显示排期最近的一个；已评分的不显示", async ({ page }) => {
  const { makeUser, linkSupervisor } = require("./helpers");
  const { db } = require("../server/db");
  const stu = await makeUser("student", "multi");
  const ins = (unit, wall, iso, status) => db.prepare(`INSERT INTO assessments (student_id, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, attempt_no, created_at, updated_at)
    VALUES (?, 'AP Biology', ?, '2031-01-01', '2031-01-01T00:00:00-08:00', ?, ?, 'America/Vancouver', ?, 1, ?, ?)`).run(stu.id, unit, wall, iso, status, new Date().toISOString(), new Date().toISOString());
  ins("Later", "2031-09-01T10:00", "2031-09-01T10:00:00-07:00", "scheduled");
  ins("Nearest", "2031-03-10T10:00", "2031-03-10T10:00:00-07:00", "scheduled");
  ins("GradedEarlier", "2031-02-01T10:00", "2031-02-01T10:00:00-08:00", "graded");
  await page.request.post("/api/login", { headers: { "X-Requested-With": "apdemo" }, data: { username: stu.username, password: "E2e-Passw0rd!" } });
  await page.goto("index.html?lang=en");
  await expect(page.locator("#progress-body")).toContainText("Unit: ".slice(0, 0) + "AP Biology · Nearest");
  await expect(page.locator("#progress-body")).toContainText("Mar 10, 2031, 10:00 AM");
  await expect(page.locator("#progress-body")).not.toContainText("Later");
  await expect(page.locator("#progress-body")).not.toContainText("GradedEarlier");
});

test("学生只能看到自己的数据：别的角色不能调用学生接口，未登录跳转登录页", async ({ playwright, baseURL }) => {
  const { state, ANON } = require("./helpers");
  for (const role of ["supervisor", "admin", "support"]) {
    const c = await playwright.request.newContext({ baseURL, storageState: state(role) });
    expect((await c.get("/api/student/overview")).status(), role).toBe(403);
    await c.dispose();
  }
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  expect((await anon.get("/api/student/overview")).status()).toBe(401);
  await anon.dispose();
});

test("T21 数据取不到时只影响对应模块", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/data/sites.json", (r) => r.abort());
  await page.goto("index.html?lang=zh");
  await page.waitForSelector("#progress-body .bar");
  await page.waitForSelector("#videos-body .video-entry");
  await page.waitForSelector("#qa-body .qa-item");
  await expect(page.locator("#sites-body .module-error")).toHaveText("该模块暂时无法加载，请稍后刷新页面重试。");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#sites-body .module-error")).toContainText("could not be loaded");
  await expect(page.locator("#videos-body .video-entry")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("T23 模块副标题（进度、视频、问答；关联网站已无副标题）", async ({ page }) => {
  const exp = {
    zh: { progress: "本阶段学习进度和测试安排", videos: "精选/自选名师AP视频", qa: "AP相关全知道" },
    en: {
      progress: "Study progress and test schedule for this stage",
      videos: "Curated and self-picked AP videos from top teachers",
      qa: "Everything AP, answered"
    }
  };
  for (const lang of ["zh", "en"]) {
    await ready(page, lang);
    for (const m of ["progress", "videos", "qa"]) {
      await expect(page.locator(`#mod-${m} .tagline`)).toHaveText(exp[lang][m]);
    }
  }
});

test("视频标题来自 data/videos.json", async ({ page }) => {
  await ready(page, "zh");
  const names = await page.locator("#videos-body .entry-name").allTextContents();
  expect(names).toEqual([
    "The Ultimate AP Biology Unit 1 Review (Score a 5 on the Exam!)",
    "1.1 Structure of Water and Hydrogen Bonding - AP Biology (Updated 2025-2026)",
    "AP Bio Speed Review - ALL 8 Units in Under 15 Minutes!"
  ]);
});

test("关联网站：位于页面底部，只有网站名，没有图标、网址和说明；页脚为精简版声明", async ({ page }) => {
  await ready(page, "zh");
  const r = await page.evaluate(() => {
    const refs = document.querySelector("#mod-sites").getBoundingClientRect();
    const vids = document.querySelector("#mod-videos").getBoundingClientRect();
    const qa = document.querySelector("#mod-qa").getBoundingClientRect();
    return { refsTop: refs.top, below: Math.max(vids.bottom, qa.bottom), inFooter: !!document.querySelector("footer #mod-sites"), icons: document.querySelectorAll("#mod-sites .entry-icon, #mod-sites img").length };
  });
  expect(r.inFooter).toBe(true);
  expect(r.refsTop).toBeGreaterThanOrEqual(r.below);
  expect(r.icons).toBe(0);
  await expect(page.locator("#h-sites")).toHaveText("关联网站");
  await expect(page.locator("#mod-sites .ref-link")).toHaveText(["My AP", "Khan Academy", "Google Classroom"]);
  await expect(page.locator(".disclaimer")).toContainText("非官方演示版");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#h-sites")).toHaveText("References");
  await expect(page.locator(".disclaimer")).toContainText("unofficial demo");
});

test("学生页不再显示“AP 自学演示首页”标题和说明文字（只保留给读屏软件的隐藏标题）", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#progress-body")).toBeVisible();
  const visibleText = () => page.locator("main").evaluate((m) => { const c = m.cloneNode(true); c.querySelectorAll(".sr-only").forEach((e) => e.remove()); return c.innerText || c.textContent; });
  const body = await visibleText();
  expect(body).not.toContain("AP 自学演示首页");
  expect(body).not.toContain("跟踪学习进度");
  await page.goto("/?lang=en");
  await expect(page.locator("#progress-body")).toBeVisible();
  const en = await visibleText();
  expect(en).not.toContain("AP Self-Study Demo");
  expect(en).not.toContain("Track your progress");
  await expect(page.locator("h1")).toHaveCount(1);
});
