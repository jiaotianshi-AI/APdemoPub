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

test("T8 进度块", async ({ page }) => {
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
  expect(await page.locator("#mod-progress button, #mod-progress input, #mod-progress a").count()).toBe(0);
  await expect(page.locator("#progress-body")).toContainText("AP 生物学 Unit 2：细胞结构与功能");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#progress-body")).toContainText("AP Biology Unit 2: Cell Structure and Function");
});

test("T9 测试时间与倒计时/已结束", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-27T07:30:00-07:00") });
  await ready(page, "zh");
  await expect(page.locator("#progress-body")).toContainText("2026年11月28日 3:00 PM（温哥华时间）");
  await expect(page.locator(".status-badge")).toHaveText("还有 1 天 7 小时");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#progress-body")).toContainText("Nov 28, 2026, 3:00 PM (Vancouver time)");
  await expect(page.locator(".status-badge")).toHaveText("1 d 7 h left");

  const page2 = await page.context().newPage();
  await page2.clock.install({ time: new Date("2026-11-29T08:00:00-07:00") });
  await page2.goto("index.html?lang=zh");
  await page2.waitForSelector(".status-badge");
  await expect(page2.locator(".status-badge")).toHaveText("已结束");
  await page2.goto("index.html?lang=en");
  await page2.waitForSelector(".status-badge");
  await expect(page2.locator(".status-badge")).toHaveText("Ended");
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

test("T11 用户入口", async ({ page }) => {
  await ready(page);
  const btn = page.locator("#login-btn");
  const box = await btn.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThan(vw / 2);
  expect(box.y).toBeLessThan(100);
  await btn.click();
  await expect(page.locator("#modal")).toBeVisible();
  await expect(page.locator("#modal")).toContainText("演示版：登录与用户管理功能将在后续阶段开放。");
  expect(await page.locator("#modal input, #modal form, form, input").count()).toBe(0);
  await page.locator("#modal-close").click();
  await expect(page.locator("#modal")).toBeHidden();
  await expect(btn).toBeFocused();
});

test("T18 数据驱动", async ({ page }) => {
  await page.route("**/data/progress.sample.json", async (route) => {
    const j = await (await route.fetch()).json();
    j.percent = 40;
    route.fulfill({ json: j });
  });
  await page.route("**/data/sites.json", async (route) => {
    const j = await (await route.fetch()).json();
    j.items.pop();
    route.fulfill({ json: j });
  });
  await page.route("**/data/assessment.sample.json", async (route) => {
    const j = await (await route.fetch()).json();
    j.scheduledAt = "2026-12-12T14:30:00-07:00";
    route.fulfill({ json: j });
  });
  await ready(page, "en");
  await expect(page.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "40");
  const [bw, fw] = await page.evaluate(() => {
    const b = document.querySelector("[role=progressbar]");
    return [b.getBoundingClientRect().width, b.firstElementChild.getBoundingClientRect().width];
  });
  expect(Math.abs(fw / bw - 0.4)).toBeLessThanOrEqual(0.005);
  await expect(page.locator("#sites-body a")).toHaveCount(2);
  await expect(page.locator("#progress-body")).toContainText("Dec 12, 2026, 2:30 PM (Vancouver time)");
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
    zh: { progress: "持续跟踪和推进当前学习进度，定时测试学习成果", videos: "精选/自选名师AP视频", qa: "AP相关全知道" },
    en: {
      progress: "Track and move your current study progress forward, with scheduled tests of what you've learned",
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

test("关联网站：位于页面底部，只有网站名与网址，没有图标和说明；页脚为精简版声明", async ({ page }) => {
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
  await expect(page.locator("#mod-sites .ref-link").first()).toContainText("myap.collegeboard.org");
  await expect(page.locator(".disclaimer")).toContainText("非官方演示版");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#h-sites")).toHaveText("References");
  await expect(page.locator(".disclaimer")).toContainText("unofficial demo");
});
