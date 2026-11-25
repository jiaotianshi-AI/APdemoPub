// T20 后台预留接口
const { test, expect } = require("@playwright/test");

const RESERVED = ["startAssessment", "submitAttempt", "getAttemptResult", "getWeeklyReport", "askQuestion", "login", "logout"];
const IMPLEMENTED = ["getSites", "getVideos", "getProgress", "getNextAssessment", "getQaDemo", "getCurrentUser"];

test("T20 APApi 函数齐全，预留函数 reject NOT_IMPLEMENTED，getCurrentUser 为 null", async ({ page }) => {
  await page.goto("index.html");
  const r = await page.evaluate(async ({ RESERVED, IMPLEMENTED }) => {
    const out = { missing: [], codes: {}, user: undefined };
    for (const n of [...RESERVED, ...IMPLEMENTED]) if (typeof window.APApi[n] !== "function") out.missing.push(n);
    for (const n of RESERVED) {
      try { await window.APApi[n](); out.codes[n] = "resolved"; } catch (e) { out.codes[n] = e && e.code; }
    }
    out.user = await window.APApi.getCurrentUser();
    return out;
  }, { RESERVED, IMPLEMENTED });
  expect(r.missing).toEqual([]);
  for (const n of RESERVED) expect(r.codes[n]).toBe("NOT_IMPLEMENTED");
  expect(r.user).toBeNull();
});

test("T20 remote 模式下调用不产生任何网络请求", async ({ page }) => {
  await page.route("**/assets/js/config.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: 'window.APConfig={brandName:{zh:"x",en:"x"},dataSource:"remote",apiBase:"https://example.invalid"};' })
  );
  await page.goto("index.html");
  const requests = [];
  page.on("request", (req) => requests.push(req.url()));
  const codes = await page.evaluate(async () => {
    const names = Object.keys(window.APApi).filter((k) => typeof window.APApi[k] === "function");
    const out = {};
    for (const n of names) {
      try { await window.APApi[n](); out[n] = "resolved"; } catch (e) { out[n] = e && e.code; }
    }
    return out;
  });
  expect(requests).toEqual([]);
  for (const n of ["getSites", "getVideos", "getProgress", "getNextAssessment", "getQaDemo", "startAssessment", "login"]) expect(codes[n]).toBe("NOT_IMPLEMENTED");
  expect(codes.getCurrentUser).toBe("resolved");
});

test("static 模式取数返回预期结构", async ({ page }) => {
  await page.goto("index.html");
  const r = await page.evaluate(async () => ({
    sites: (await window.APApi.getSites()).map((s) => s.url),
    videos: (await window.APApi.getVideos()).map((v) => v.videoId),
    progress: (await window.APApi.getProgress()).percent,
    asm: (await window.APApi.getNextAssessment()).scheduledAt
  }));
  expect(r.sites).toEqual(["https://myap.collegeboard.org/", "https://www.khanacademy.org/", "https://classroom.google.com/"]);
  expect(r.videos).toEqual(["gjswMPTXYk4", "t21f03JfGPk", "KSAPc5NwLYU"]);
  expect(r.progress).toBe(10);
  expect(r.asm).toBe("2026-11-28T15:00:00-07:00");
});
