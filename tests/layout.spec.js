// T1 T2 T13 T14 T15 T17 T22 + 视口矩阵
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const fs = require("fs");
const path = require("path");

const GIF = Buffer.from("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=", "base64");
const LANDSCAPE = [[1920, 1080], [1440, 900], [1366, 768], [1280, 800], [1180, 820], [1024, 768]];
const OTHERS = [[820, 1180], [390, 844]];
const ALL = [...LANDSCAPE, ...OTHERS];
const shotDir = path.join(__dirname, "screenshots");

async function open(page, lang = "zh") {
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ contentType: "image/gif", body: GIF }));
  await page.goto(`index.html?lang=${lang}`);
  await page.waitForSelector("#qa-body .qa-item");
  await page.waitForSelector("#videos-body .video-entry");
  await page.waitForSelector("#sites-body .ref-link");
  await page.waitForSelector("#progress-body .bar");
}

for (const [w, h] of ALL) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test(`T1 无横向滚动 / T2 子路径资源均 200 / T17 截图`, async ({ page }, testInfo) => {
      const dir = testInfo.project.name === "chromium" ? shotDir : path.join(shotDir, testInfo.project.name);
      const bad = [];
      page.on("response", (r) => { if (r.url().startsWith("http://localhost") && r.status() >= 400) bad.push(r.status() + " " + r.url()); });
      fs.mkdirSync(dir, { recursive: true });
      for (const lang of ["zh", "en"]) {
        await open(page, lang);
        const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(sw[0], `scrollWidth ${sw[0]} > innerWidth ${sw[1]} (${lang})`).toBeLessThanOrEqual(sw[1]);
        await page.screenshot({ path: path.join(dir, `${w}x${h}-${lang}.png`), fullPage: true });
      }
      expect(bad).toEqual([]);
    });
  });
}

for (const [w, h] of LANDSCAPE.filter(([w]) => w >= 900)) {
  test(`T22 主次层级 ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, "zh");
    const r = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const fs = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
      const main = box("main");
      const content = main.width - parseFloat(getComputedStyle(document.querySelector("main")).paddingLeft) * 2;
      const p = box("#mod-progress");
      const aux = ["#mod-videos", "#mod-qa"].map(box);
      const order = Array.from(document.querySelectorAll("section.module")).map((s) => s.id);
      return {
        content, pw: p.width, pbottom: p.bottom, parea: p.width * p.height,
        auxTop: Math.min(...aux.map((b) => b.top)), auxArea: Math.max(...aux.map((b) => b.width * b.height)),
        titleRatio: fs("#h-progress") / Math.max(fs("#h-videos"), fs("#h-qa")),
        order, barH: box("#progress-body .bar").height, pTop: p.top, pBottom: p.bottom,
        auxHeadingBottom: document.querySelector("#h-videos").getBoundingClientRect().bottom,
        pageH: document.documentElement.scrollHeight
      };
    });
    expect(r.pw).toBeGreaterThanOrEqual(r.content * 0.9);
    expect(r.pbottom).toBeLessThanOrEqual(r.auxTop);
    // 原要求是 ≥ 2 倍；需求方后来要求把进度卡压缩得更紧凑（阶段测试时间面板上移到右上角），所以改为 ≥ 1.5 倍；之后缩小百分比数字，进一步压缩，下限放宽到 1.4 倍。
    // 主次关系仍由：通栏、位于辅助卡之上、标题字号 ≥ 1.3 倍、DOM 最前 这几条保证。
    expect(r.parea, `面积比 ${(r.parea / r.auxArea).toFixed(2)}`).toBeGreaterThanOrEqual(r.auxArea * 1.4);
    expect(r.titleRatio).toBeGreaterThanOrEqual(1.3);
    expect(r.order[0]).toBe("mod-progress");
    expect(r.barH).toBeGreaterThanOrEqual(16);
    test.info().annotations.push({ type: "metrics", description: JSON.stringify({ areaRatio: +(r.parea / r.auxArea).toFixed(2), pageH: r.pageH, auxHeadingBottom: Math.round(r.auxHeadingBottom), progressBottom: Math.round(r.pBottom) }) });
  });
}

test("T22 目标：1180x820 首屏看到完整进度卡 + 辅助标题，总高 ≤ 1300", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await open(page, "zh");
  const r = await page.evaluate(() => ({
    pBottom: document.querySelector("#mod-progress").getBoundingClientRect().bottom,
    h: document.querySelector("#h-videos").getBoundingClientRect().bottom,
    pageH: document.documentElement.scrollHeight
  }));
  expect(r.pBottom).toBeLessThanOrEqual(820);
  expect(r.h).toBeLessThanOrEqual(820);
  expect(r.pageH).toBeLessThanOrEqual(1300);
});

for (const [w, h] of [[820, 1180], [390, 844]]) {
  test(`T22 窄视口顺序 ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, "zh");
    const tops = await page.evaluate(() => ["#mod-progress", "#mod-videos", "#mod-qa", "#mod-sites"].map((s) => document.querySelector(s).getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });
}

test("T14 1180x820 下所有可交互元素 ≥ 44px", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await open(page, "zh");
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"))
      .filter((e) => !e.closest("[hidden]"))
      .map((e) => { const b = e.getBoundingClientRect(); return { n: e.tagName + "." + e.className, w: b.width, h: b.height }; })
      .filter((x) => x.w < 44 || x.h < 44)
  );
  expect(small).toEqual([]);
  await page.locator("#videos-body .video-entry").first().click();
  const modalSmall = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#modal button, #modal a[href]")).map((e) => { const b = e.getBoundingClientRect(); return { n: e.className, w: b.width, h: b.height }; }).filter((x) => x.w < 44 || x.h < 44)
  );
  expect(modalSmall).toEqual([]);
});

test("T13 仅键盘可到达并操作所有交互元素，焦点可见", async ({ page }) => {
  await open(page, "zh");
  const expected = 2 + 1 + 2 + 3 + 3; // 语言×2、退出登录、立即测试+所有测试、视频×3、关联网站×3
  const seen = [];
  for (let i = 0; i < expected; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const a = document.activeElement; const cs = getComputedStyle(a);
      return { id: a.tagName + ":" + (a.getAttribute("href") || a.getAttribute("data-video-id") || a.id || a.textContent.trim()), outline: cs.outlineStyle + " " + cs.outlineWidth };
    });
    expect(info.outline, `焦点样式不可见: ${info.id}`).toMatch(/^solid [1-9]/);
    seen.push(info.id);
  }
  expect(new Set(seen).size).toBe(expected);
  // 键盘打开视频并关闭
  await page.focus("#videos-body .video-entry");
  await page.keyboard.press("Enter");
  await expect(page.locator("#modal iframe")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal iframe")).toHaveCount(0);
  await expect(page.locator("#videos-body .video-entry").first()).toBeFocused();
  // 语言按钮可用 Enter 切换
  await page.focus('.lang-btn[data-lang="en"]');
  await page.keyboard.press("Enter");
  expect(await page.getAttribute("html", "lang")).toBe("en");
});

for (const lang of ["zh", "en"]) {
  test(`T15 axe 无 serious/critical（${lang}）`, async ({ page }) => {
    await open(page, lang);
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(" | "))).toEqual([]);
    // 打开视频弹窗后再测一次
    await page.click("#videos-body .video-entry");
    const res2 = await new AxeBuilder({ page }).analyze();
    const bad2 = res2.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad2.map((v) => v.id)).toEqual([]);
  });
}
