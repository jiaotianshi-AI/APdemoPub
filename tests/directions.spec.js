// 学习板块：/apdemo（AP 自学）和 /writing（写作）；学生按账号的学习科目进入自己的板块；旧网址自动跳转
const { test, expect } = require("@playwright/test");
const { state, ANON, H, PASSWORD, uid, makeUser, linkSupervisor, loginCtx } = require("./helpers");

test("旧网址 / 、/index.html、/exam 自动跳到 /apdemo（保留查询参数）；未登录仍去登录页", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  for (const p of ["/", "/index.html", "/exam?id=3", "/apdemo", "/writing"]) {
    const r = await anon.get(p, { maxRedirects: 0 });
    expect([r.status(), r.headers().location], p).toEqual([302, "/login"]);
  }
  const stu = await playwright.request.newContext({ baseURL, storageState: state("student") });
  const loc = async (p) => (await stu.get(p, { maxRedirects: 0 })).headers().location;
  expect(await loc("/")).toBe("/apdemo");
  expect(await loc("/index.html")).toBe("/apdemo");
  expect(await loc("/exam?id=3&early=1")).toBe("/apdemo/exam?id=3&early=1");
  expect(await loc("/apdemo/")).toBe("/apdemo"); // 结尾斜杠统一去掉
  expect((await stu.get("/apdemo", { maxRedirects: 0 })).status()).toBe(200);
  expect((await stu.get("/apdemo/exam", { maxRedirects: 0 })).status()).toBe(200);
  // 非学生访问旧网址：回到自己的首页
  const sup = await playwright.request.newContext({ baseURL, storageState: state("supervisor") });
  expect(await (async () => (await sup.get("/", { maxRedirects: 0 })).headers().location)()).toBe("/supervisor");
  expect((await sup.get("/apdemo", { maxRedirects: 0 })).headers().location).toBe("/supervisor");
  expect((await sup.get("/writing", { maxRedirects: 0 })).headers().location).toBe("/supervisor");
  await anon.dispose(); await stu.dispose(); await sup.dispose();
});

test("写作板块的学生：登录后进入 /writing；进不了 /apdemo，也不能调用 AP 学生接口；AP 学生进不了 /writing", async ({ playwright, baseURL }) => {
  const w = await makeUser("student", "wri", "Writing");
  const wctx = await loginCtx(playwright, baseURL, w.username);
  const login = await playwright.request.newContext({ baseURL, storageState: ANON });
  const r = await login.post("/api/login", { headers: H, data: { username: w.username, password: PASSWORD } });
  const info = await r.json();
  expect([info.redirect, info.direction]).toEqual(["/writing", "writing"]);
  expect((await wctx.get("/writing", { maxRedirects: 0 })).status()).toBe(200);
  expect((await wctx.get("/writing")).headers()["content-security-policy"]).toContain("default-src 'self'");
  for (const p of ["/", "/apdemo", "/apdemo/exam", "/exam?id=1", "/login"]) expect((await wctx.get(p, { maxRedirects: 0 })).headers().location, p).toBe("/writing");
  for (const p of ["/api/student/overview", "/api/student/assessments"]) {
    const x = await wctx.get(p);
    expect([x.status(), (await x.json()).error], p).toEqual([403, "WRONG_DIRECTION"]);
  }
  const a = await loginCtx(playwright, baseURL, (await makeUser("student", "apd", "AP Biology")).username);
  expect((await a.get("/writing", { maxRedirects: 0 })).headers().location).toBe("/apdemo");
  expect((await a.get("/api/me")).status()).toBe(200);
  expect((await (await a.get("/api/me")).json()).direction).toBe("apdemo");
  await wctx.dispose(); await login.dispose(); await a.dispose();
});

test("没有设置科目的旧学生账号按 AP 自学处理；不能给写作学生安排 AP 测试", async ({ playwright, baseURL }) => {
  const old = await makeUser("student", "oldstu");
  const octx = await loginCtx(playwright, baseURL, old.username);
  expect((await (await octx.get("/api/me")).json()).direction).toBe("apdemo");
  expect((await octx.get("/apdemo", { maxRedirects: 0 })).status()).toBe(200);

  const sup = await makeUser("supervisor", "dirsup");
  const w = await makeUser("student", "dirwri", "Writing");
  linkSupervisor(sup.id, w.id);
  const sctx = await loginCtx(playwright, baseURL, sup.username);
  const list = (await (await sctx.get("/api/supervisor/students")).json()).students;
  expect(list.find((s) => s.id === w.id)).toMatchObject({ subject: "Writing", direction: "writing" });
  const up = await sctx.post("/api/supervisor/files", { headers: { ...H, "Content-Type": "application/pdf", "X-File-Name": "q.pdf" }, data: Buffer.from("%PDF-1.4\n%x\n") });
  const file = (await up.json()).file;
  const res = await sctx.post("/api/supervisor/assessments", { headers: H, data: { studentIds: [w.id], scheduledWall: "2031-03-15T15:00", subject: "AP Biology", unit: "U1", unitStartDate: "2031-03-01", questionFileIds: [file.id] } });
  expect([res.status(), (await res.json()).error]).toEqual([422, "WRONG_DIRECTION"]);
  await octx.dispose(); await sctx.dispose();
});

test("督导者页：学生列表标明板块；写作学生不显示 AP 测试管理；新建测试的目标学生里没有写作学生", async ({ page, playwright, baseURL }) => {
  const sup = await makeUser("supervisor", "dsup");
  const ap = await makeUser("student", "dap", "AP Biology");
  const wr = await makeUser("student", "dwr", "Writing");
  linkSupervisor(sup.id, ap.id); linkSupervisor(sup.id, wr.id);
  await page.request.post("/api/login", { headers: H, data: { username: sup.username, password: PASSWORD } });
  await page.goto("/supervisor");
  await expect(page.locator(".student-btn", { hasText: ap.username })).toContainText("AP 自学");
  await expect(page.locator(".student-btn", { hasText: wr.username })).toContainText("写作");
  await page.locator(".student-btn", { hasText: wr.username }).click();
  await expect(page.locator("#lists")).toContainText("写作板块");
  await expect(page.locator("#new-btn")).toBeHidden();
  await page.locator(".student-btn", { hasText: ap.username }).click();
  await expect(page.locator("#new-btn")).toBeVisible();
  await page.click("#new-btn");
  await expect(page.locator("#target-box")).toContainText(ap.username);
  await expect(page.locator("#target-box")).not.toContainText(wr.username);
});

test("写作页（占位）与品牌：显示 Focus 和副标题 Focus. Steps. Progress.", async ({ page, playwright, baseURL }) => {
  const w = await makeUser("student", "brand", "Writing");
  await page.request.post("/api/login", { headers: H, data: { username: w.username, password: PASSWORD } });
  await page.goto("/writing");
  await expect(page.locator("h1")).toHaveText("Writing");
  await expect(page.locator(".brand")).toHaveText("Focus");
  await expect(page.locator(".slogan")).toHaveText("Focus. Steps. Progress.");
  await page.click("#logout-btn");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".brand")).toHaveText("Focus");
  await expect(page.locator(".slogan")).toHaveText("Focus. Steps. Progress.");
  await expect(page.locator("body")).not.toContainText("AP 专注学习");
});

test("学生 AP 页：品牌是 Focus + 副标题；中英文一致", async ({ page }) => {
  await page.goto("/apdemo");
  await expect(page.locator("#brand")).toContainText("Focus");
  await expect(page.locator("#brand .slogan")).toHaveText("Focus. Steps. Progress.");
  await expect(page).toHaveTitle("Focus");
  await page.goto("/apdemo?lang=en");
  await expect(page.locator("#brand .slogan")).toHaveText("Focus. Steps. Progress.");
  await expect(page.locator("body")).not.toContainText("AP 专注学习");
  await expect(page.locator("body")).not.toContainText("AP Focus");
});
