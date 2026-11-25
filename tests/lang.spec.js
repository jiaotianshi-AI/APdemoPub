// T12 语言切换；T16 存储不可用
const { test, expect } = require("@playwright/test");

async function snapshot(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-i18n]")).map((e) => e.textContent));
}

test("T12 切换语言：data-i18n 文字全部改变、html lang 更新、刷新保持、?lang=en 生效", async ({ page }) => {
  await page.goto("index.html?lang=zh");
  expect(await page.getAttribute("html", "lang")).toBe("zh-CN");
  const zh = await snapshot(page);
  await page.click('.lang-btn[data-lang="en"]');
  expect(await page.getAttribute("html", "lang")).toBe("en");
  const en = await snapshot(page);
  expect(en.length).toBe(zh.length);
  zh.forEach((t, i) => expect(en[i], `第 ${i} 项未改变: ${t}`).not.toBe(t));
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/\b(hero|mod|footer|common|error|login|modal|progress|sites|videos|qa)\.[a-zA-Z.]+/);
  await page.goto("index.html"); // 无参数：应读 localStorage
  expect(await page.getAttribute("html", "lang")).toBe("en");
  await page.goto("index.html?lang=zh");
  expect(await page.getAttribute("html", "lang")).toBe("zh-CN");
});

test("T16 localStorage 抛异常时页面仍可加载并切换语言", async ({ page }) => {
  await page.addInitScript(() => {
    const boom = () => { throw new Error("blocked"); };
    Object.defineProperty(window, "localStorage", { get: boom, configurable: true });
  });
  // 沙箱无法访问 i.ytimg.com，用桩响应避免与本测试无关的网络错误
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=", "base64") }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("index.html?lang=zh");
  await page.click('.lang-btn[data-lang="en"]');
  expect(await page.getAttribute("html", "lang")).toBe("en");
  expect(errors).toEqual([]);
});
