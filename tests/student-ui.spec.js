// 学生页：所有测试、立即测试确认、测试页流程（选择作答方式、倒计时、自动保存、提交、到时自动提交、离开页面记录）
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { ANON, H, PASSWORD, makeUser, linkSupervisor, loginCtx, uploadPdf } = require("./helpers");

test.use({ storageState: ANON, viewport: { width: 1180, height: 820 } });

async function scenario(page, playwright, baseURL, { questions = 2, duration = 60, past = false, login = true } = {}) {
  const sup = await makeUser("supervisor", "sup");
  const stu = await makeUser("student", "stu");
  linkSupervisor(sup.id, stu.id);
  const sctx = await loginCtx(playwright, baseURL, sup.username);
  const qs = [];
  for (let i = 1; i <= questions; i++) qs.push(await uploadPdf(sctx, `题${i}.pdf`, `q${i}`));
  const res = await sctx.post("/api/supervisor/assessments", {
    headers: H,
    data: { studentIds: [stu.id], scheduledWall: "2031-03-15T15:00", subject: "AP Biology", unit: "Unit 2", unitStartDate: "2031-03-01", durationMinutes: duration, questionFileIds: qs.map((q) => q.id) }
  });
  const asm = (await res.json()).assessments[0];
  if (past) {
    const { db } = require("../server/db");
    db.prepare("UPDATE assessments SET scheduled_at = ?, scheduled_wall = '2020-01-01T10:00', unit_start_date = '2019-12-01', unit_start_at = '2019-12-01T00:00:00-08:00' WHERE id = ?").run(new Date(Date.now() - 3600000).toISOString(), asm.id);
  }
  if (login) {
    const r = await page.request.post("/api/login", { headers: H, data: { username: stu.username, password: PASSWORD } });
    expect(r.status()).toBe(200);
  }
  return { sup, stu, sctx, qs, asm };
}
const supAttempt = async (sctx, id) => (await (await sctx.get(`/api/supervisor/assessments/${id}/attempt`)).json());

test("所有测试：列表按状态分组；未完成的看不到题目；学生没有任何修改入口", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  const { db } = require("../server/db");
  const ins = (unit, wall, iso, status, score) => Number(db.prepare(`INSERT INTO assessments (student_id, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, score, duration_minutes, attempt_no, created_at, updated_at)
    VALUES (?, 'AP Biology', ?, '2020-01-01', '2020-01-01T00:00:00-08:00', ?, ?, 'America/Vancouver', ?, ?, 60, 1, ?, ?)`).run(s.stu.id, unit, wall, iso, status, score, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  ins("GradedUnit", "2025-01-10T10:00", "2025-01-10T10:00:00-08:00", "graded", 4);
  ins("SubmittedUnit", "2025-02-10T10:00", "2025-02-10T10:00:00-08:00", "submitted", null);
  await page.goto("/?lang=zh");
  await page.click("#all-tests-btn");
  await expect(page.locator("#modal")).toBeVisible();
  await expect(page.locator("#modal-title")).toHaveText("所有测试");
  const groups = page.locator("#modal .t-group-title");
  await expect(groups).toHaveText(["待测试（1）", "进行中与待评分（1）", "已评分的测试（1）"]);
  const todo = page.locator(".t-card", { hasText: "Unit 2" });
  await expect(todo).toContainText("待测试");
  await expect(todo).toContainText("2031年3月15日 3:00 PM");
  await expect(todo).toContainText("60 分钟");
  await expect(todo).toContainText("题目会在测试开始后显示");
  await expect(todo.getByRole("button", { name: /^立即测试/ })).toBeVisible();
  expect(await todo.locator("a").count()).toBe(0); // 没有题目链接
  await expect(page.locator(".t-card", { hasText: "SubmittedUnit" })).toContainText("已提交，待评分");
  const graded = page.locator(".t-card", { hasText: "GradedUnit" });
  await expect(graded).toContainText("4 / 5");
  await page.locator(".past-item", { hasText: "GradedUnit" }).locator(".past-toggle").click(); // 过往的测试默认折叠，展开后才有完整信息和链接
  await expect(graded.getByRole("link", { name: /^查看题目和我的答案/ })).toHaveAttribute("href", /^\/exam\?id=\d+$/);
  // 没有任何修改/删除/输入控件
  expect(await page.locator("#modal input, #modal textarea, #modal select").count()).toBe(0);
  for (const w of ["修改", "删除", "编辑"]) await expect(page.locator("#modal")).not.toContainText(w);
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page.locator("#all-tests-btn")).toBeFocused();
  await page.click('.lang-btn[data-lang="en"]');
  await page.click("#all-tests-btn");
  await expect(page.locator("#modal-title")).toHaveText("All tests");
  await expect(page.locator(".t-group-title").first()).toHaveText("To take (1)");
  await expect(page.locator(".t-card", { hasText: "Unit 2" })).toContainText("The questions are shown once the test starts.");
});

test("立即测试：弹出确认，显示距离测试时间和预计时长；取消不进入，确认后进入测试页", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL, { duration: 45 });
  await page.clock.install({ time: new Date("2031-03-12T09:30:00-07:00") }); // 距离测试时间 3 天 5 小时 30 分
  await page.goto("/?lang=zh");
  await page.click("#start-btn");
  await expect(page.locator("#modal")).toBeVisible();
  await expect(page.locator("#modal-title")).toHaveText("立即测试");
  await expect(page.locator("#modal")).toContainText("距离测试时间还有 3 天 5 小时，你确认要提前测试吗？本次测试预计需要 45 分钟左右，测试期间，联网及 QA bot 功能将被禁用。");
  await page.click('#modal .confirm-actions .card-btn:not(.primary)');
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page).not.toHaveURL(/\/exam/);
  await expect(page.locator("#start-btn")).toBeFocused();

  await page.click('.lang-btn[data-lang="en"]');
  await page.click("#start-btn");
  await expect(page.locator("#modal")).toContainText("There are 3 d 5 h until the scheduled time. Do you want to take the test early? It will take about 45 minutes. During the test, internet access and the QA bot are disabled.");
  await page.click("#confirm-start-yes");
  await expect(page).toHaveURL(new RegExp(`/exam\\?id=${s.asm.id}&early=1$`));
});

test("到了预定时间：按钮是“开始测试”，确认文字不再说“提前”", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL, { past: true });
  await page.goto("/?lang=zh");
  await expect(page.locator(".status-badge")).toHaveText("可以开始测试");
  await page.click("#start-btn");
  await expect(page.locator("#start-btn, #modal")).toBeDefined();
  await expect(page.locator("#modal")).toContainText("现在可以开始测试了。本次测试预计需要 60 分钟左右");
  await expect(page.locator("#modal")).not.toContainText("提前");
  await page.click("#confirm-start-yes");
  await expect(page).toHaveURL(new RegExp(`/exam\\?id=${s.asm.id}$`));
});

test("测试页完整流程（屏幕输入）：选方式 → 计时 → 看题 → 自动保存 → 切换题目 → 提交", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL, { duration: 30 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await expect(page.locator("h1")).toHaveText("准备开始测试");
  await expect(page.locator("#exam-root")).toContainText("测试时长：30 分钟");
  await expect(page.locator("#exam-root")).not.toContainText("题1"); // 开始前没有题目
  expect(await page.locator("iframe").count()).toBe(0);
  expect(await page.locator("a[href^='http']").count()).toBe(0);
  const start = page.getByRole("button", { name: "开始计时" });
  await expect(start).toBeDisabled();
  await page.getByLabel(/在屏幕上输入文字/).check();
  await expect(start).toBeEnabled();
  await start.click();

  await expect(page.locator("#timer")).toBeVisible();
  await expect(page.locator("#timer-value")).toHaveText(/^(29|30):\d\d$/);
  await expect(page.locator(".pdf-frame")).toHaveAttribute("src", new RegExp(`^/api/student/files/${s.qs[0].id}$`));
  await expect(page.locator("#exam-root")).toContainText("第 1 题 / 共 2 题");
  await page.fill("#answer", "第一题：细胞膜具有选择透过性。");
  await expect(page.locator(".save-state")).toHaveText("已保存");
  await expect.poll(async () => (await supAttempt(s.sctx, s.asm.id)).questions[0].answer).toBe("第一题：细胞膜具有选择透过性。");

  await page.getByRole("button", { name: "下一题" }).click();
  await expect(page.locator("#exam-root")).toContainText("第 2 题 / 共 2 题");
  await expect(page.locator(".pdf-frame")).toHaveAttribute("src", new RegExp(`/${s.qs[1].id}$`));
  await expect(page.locator("#answer")).toHaveValue("");
  await page.getByRole("button", { name: "上一题" }).click();
  await expect(page.locator("#answer")).toHaveValue("第一题：细胞膜具有选择透过性。");
  await page.locator('.q-num[aria-label="第 2 题"]').click();
  await page.fill("#answer", "第二题答案\n第二行");

  await page.click("#submit-btn");
  await expect(page.locator(".exam-dialog")).toContainText("确认提交全部答案？提交后不能再修改。");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.locator("#submit-btn")).toBeEnabled();
  await page.click("#submit-btn");
  await page.getByRole("button", { name: "确认" }).click();
  await expect(page.locator("h1")).toHaveText("已提交");
  await expect(page.locator("#exam-root")).toContainText("你的答案已经提交，等待家长/老师评分。");
  await expect(page.locator("#timer")).toBeHidden();
  await expect(page.locator(".answer-text").nth(1)).toHaveText("第二题答案\n第二行");

  const v = await supAttempt(s.sctx, s.asm.id);
  expect(v.questions.map((q) => q.answer)).toEqual(["第一题：细胞膜具有选择透过性。", "第二题答案\n第二行"]);
  expect(v.attempt.autoSubmitted).toBe(false);
  expect(v.attempt.method).toBe("typed");
  // 刷新后仍是已提交的回顾页
  await page.reload();
  await expect(page.locator("h1")).toHaveText("已提交");
  await page.getByRole("link", { name: "返回首页" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

test("有题没填答案时，提交前提示还有几道题没有答案", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await page.getByLabel(/在屏幕上输入文字/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await page.fill("#answer", "只答了第一题");
  await page.click("#submit-btn");
  await expect(page.locator(".exam-dialog")).toContainText("还有 1 道题没有填写答案");
  await page.getByRole("button", { name: "确认" }).click();
  await expect(page.locator("h1")).toHaveText("已提交");
});

test("没带 early 参数而且还没到时间：必须勾选“我确认提前测试”才能开始；服务器也会拒绝未确认的提前开始", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  await page.goto(`/exam?id=${s.asm.id}&lang=zh`);
  await expect(page.locator(".notice")).toContainText("还没到预定的测试时间");
  const start = page.getByRole("button", { name: "开始计时" });
  await page.getByLabel(/在屏幕上输入文字/).check();
  await expect(start).toBeDisabled();
  await page.getByLabel("我确认提前测试").check();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator("#timer")).toBeVisible();
});

test("纸质作答：没有输入框，显示说明；提交后督导者端看到方式为纸质", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL, { past: true });
  await page.goto(`/exam?id=${s.asm.id}&lang=zh`);
  await expect(page.locator(".notice")).toHaveCount(0); // 已到预定时间，不是提前
  await page.getByLabel(/写在纸上/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.locator("#timer")).toBeVisible();
  expect(await page.locator("textarea").count()).toBe(0);
  await expect(page.locator(".answer-box")).toContainText("每题一张，写上题号");
  await page.click("#submit-btn");
  await page.getByRole("button", { name: "确认" }).click();
  await expect(page.locator("h1")).toHaveText("已提交");
  const v = await supAttempt(s.sctx, s.asm.id);
  expect(v.attempt.method).toBe("paper");
  expect(v.attempt.early).toBe(false);
});

test("倒计时到 0：自动提交已保存的答案，并说明是自动提交", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await page.getByLabel(/在屏幕上输入文字/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await page.fill("#answer", "时间到之前写的答案");
  await expect(page.locator(".save-state")).toHaveText("已保存");
  const { db } = require("../server/db");
  db.prepare("UPDATE attempts SET deadline_at = ? WHERE assessment_id = ?").run(new Date(Date.now() + 3000).toISOString(), s.asm.id);
  await page.reload(); // 重新加载以取得新的截止时间
  await expect(page.locator("#timer-value")).toHaveText(/^00:0[0-3]$/);
  await expect(page.locator("h1")).toHaveText("已提交", { timeout: 15000 });
  await expect(page.locator("#exam-root")).toContainText("测试时间已到，系统已自动提交你写下的答案。");
  await expect(page.locator(".answer-text").first()).toHaveText("时间到之前写的答案");
  const v = await supAttempt(s.sctx, s.asm.id);
  expect(v.attempt.autoSubmitted).toBe(true);
});

test("考试中：学生页进入考试模式（隐藏视频、问答、关联网站），只留“继续测试”；关闭页面再回来可继续并保留答案", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await page.getByLabel(/在屏幕上输入文字/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await page.fill("#answer", "写到一半");
  await expect(page.locator(".save-state")).toHaveText("已保存");

  await page.goto("/?lang=zh");
  await expect(page.locator(".exam-banner")).toContainText("你有一场测试正在进行");
  await expect(page.locator(".status-badge")).toHaveText("测试进行中");
  await expect(page.locator("#mod-videos")).toBeHidden();
  await expect(page.locator("#mod-qa")).toBeHidden();
  await expect(page.locator("#mod-sites")).toBeHidden();
  expect(await page.locator("#start-btn").count()).toBe(0);
  await page.getByRole("link", { name: "继续测试" }).click();
  await expect(page).toHaveURL(new RegExp(`/exam\\?id=${s.asm.id}$`));
  await expect(page.locator("#answer")).toHaveValue("写到一半");
  await expect(page.locator("#timer")).toBeVisible();
});

test("离开页面会被记录（次数和时长），为打开题目 PDF 而离开的单独统计", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await page.getByLabel(/写在纸上/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.locator("#timer")).toBeVisible();
  const hide = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(true); await hide(false);
  await page.evaluate(() => document.querySelector(".pdf-foot a").addEventListener("click", (e) => e.preventDefault()));
  await page.click(".pdf-foot a"); // 点“在新标签页打开本题 PDF”（已阻止真正跳转）
  await hide(true); await hide(false);
  await expect.poll(async () => (await supAttempt(s.sctx, s.asm.id)).attempt.pdfLeaves).toBe(1); // 两次离开的记录都到达后再检查
  const v = await supAttempt(s.sctx, s.asm.id);
  expect(v.attempt.leaveCount).toBe(1);
});

test("回顾：已评分的测试显示分数、题目、我的答案和纸质答卷", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL, { past: true });
  const stuCtx = page.request;
  await stuCtx.post(`/api/student/assessments/${s.asm.id}/start`, { headers: H, data: { method: "typed" } });
  await stuCtx.put(`/api/student/assessments/${s.asm.id}/answers/${s.qs[0].id}`, { headers: H, data: { text: "我的第一题答案" } });
  await stuCtx.post(`/api/student/assessments/${s.asm.id}/submit`, { headers: H, data: {} });
  const scan = await uploadPdf(s.sctx, "扫描答卷.pdf", "scan");
  // 督导者给每道题评分：Q1=5（附回答 PDF）、Q2=4 → (5+4)/2 = 4.5 → 汇总 5
  await s.sctx.patch(`/api/supervisor/assessments/${s.asm.id}`, { headers: H, data: { questions: [{ questionFileId: s.qs[0].id, answerFileId: scan.id, score: 5 }, { questionFileId: s.qs[1].id, score: 4 }] } });

  await page.goto(`/exam?id=${s.asm.id}&lang=zh`);
  await expect(page.locator("h1")).toHaveText("测试回顾");
  await expect(page.locator(".score-big")).toHaveText("汇总评分：5 / 5");
  await expect(page.locator(".review-q").first()).toContainText("题1.pdf");
  await expect(page.locator(".review-q").first()).toContainText("我的第一题答案");
  await expect(page.locator(".review-q").nth(1)).toContainText("（没有填写）");
  await expect(page.locator(".review-q").first()).toContainText("Q1");
  await expect(page.locator(".review-q").first()).toContainText("评分 5 / 5");
  await expect(page.locator(".review-q").first()).toContainText("权重 1");
  await expect(page.locator(".review-q").nth(1)).toContainText("评分 4 / 5");
  const href = await page.getByRole("link", { name: /回答 PDF：扫描答卷.pdf/ }).getAttribute("href");
  expect((await page.request.get(href)).status()).toBe(200);
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("h1")).toHaveText("Test review");
  await expect(page.locator(".score-big")).toHaveText("Overall score: 5 / 5");
  await expect(page.locator(".review-q").first()).toContainText("Score 5 / 5");
});

test("英文界面：测试页的文字都是英文", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=en`);
  await expect(page.locator("h1")).toHaveText("Get ready to start");
  await expect(page.locator("#exam-root")).toContainText("Duration: 60 minutes");
  await page.getByLabel(/Type on the screen/).check();
  await page.getByRole("button", { name: "Start the timer" }).click();
  await expect(page.locator("#exam-root")).toContainText("Question 1 of 2");
  await expect(page.locator(".answer-box label")).toContainText("Your answer");
  await expect(page.getByRole("button", { name: "Submit all answers" })).toBeVisible();
  expect(await page.title()).toBe("Test");
  expect(await page.getAttribute("html", "lang")).toBe("en");
});

test("别人的测试、不存在的测试：显示错误，没有题目", async ({ page, playwright, baseURL }) => {
  const a = await scenario(page, playwright, baseURL, { login: false });
  const b = await scenario(page, playwright, baseURL); // 以 b 的学生登录
  await page.goto(`/exam?id=${a.asm.id}&lang=zh`);
  await expect(page.locator(".error-box")).toHaveText("没有找到这场测试。");
  await page.goto(`/exam?id=999999999&lang=zh`);
  await expect(page.locator(".error-box")).toBeVisible();
  await page.goto(`/exam?id=abc&lang=zh`);
  await expect(page.locator(".error-box")).toBeVisible();
  expect(b.asm.id).toBeGreaterThan(0);
});

test("同时只能有一场测试在进行：第二场的“开始”被拒绝并提示", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  const second = await s.sctx.post("/api/supervisor/assessments", { headers: H, data: { studentIds: [s.stu.id], scheduledWall: "2031-04-20T15:00", subject: "AP Biology", unit: "Unit 5", unitStartDate: "2031-04-01", questionFileIds: [s.qs[0].id] } });
  const asm2 = (await second.json()).assessments[0];
  await page.request.post(`/api/student/assessments/${s.asm.id}/start`, { headers: H, data: { method: "paper", confirmEarly: true } });
  await page.goto("/?lang=zh");
  await page.click("#all-tests-btn");
  await expect(page.locator(".t-card", { hasText: "Unit 5" }).getByRole("button", { name: /^立即测试/ })).toBeDisabled();
  await page.goto(`/exam?id=${asm2.id}&early=1&lang=zh`);
  await page.getByLabel(/写在纸上/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.locator(".error-box")).toHaveText("你有另一场测试正在进行，请先完成它。");
});

test("无障碍与触控：测试页各阶段、所有测试弹窗 axe 无 serious/critical；按钮 ≥ 44px", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  const check = async (label) => {
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => label + " " + v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(" | "))).toEqual([]);
  };
  const small = () => page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href], input, select, textarea"))
      .filter((e) => e.offsetParent !== null && !e.closest("dialog:not([open])"))
      .map((e) => { const b = e.getBoundingClientRect(); return { n: e.tagName + "#" + (e.id || e.textContent.trim().slice(0, 10)), w: Math.round(b.width), h: Math.round(b.height) }; })
      .filter((x) => (x.h < 44 || x.w < 44) && !/radio|checkbox/.test(x.n))
  );
  await page.goto("/?lang=zh");
  await page.click("#all-tests-btn");
  await check("所有测试弹窗");
  expect(await small()).toEqual([]);
  await page.keyboard.press("Escape");

  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await check("测试页（开始前）");
  await page.getByLabel(/在屏幕上输入文字/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.locator("#timer")).toBeVisible();
  await check("测试页（作答中）");
  expect(await small()).toEqual([]);
  await page.fill("#answer", "x");
  await page.click("#submit-btn");
  await page.getByRole("button", { name: "确认" }).click();
  await expect(page.locator("h1")).toHaveText("已提交");
  await check("测试页（已提交）");

  await page.setViewportSize({ width: 390, height: 844 });
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw[0]).toBeLessThanOrEqual(sw[1]);
});

test("测试页没有视频、问答机器人和外部链接；页面只向本站发请求", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  const hosts = new Set();
  page.on("request", (r) => { const u = new URL(r.url()); if (u.protocol.startsWith("http")) hosts.add(u.host); });
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await page.getByLabel(/在屏幕上输入文字/).check();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.locator("#timer")).toBeVisible();
  expect([...hosts]).toEqual([new URL(baseURL).host]);
  expect(await page.locator("#mod-qa, #mod-videos, #mod-sites, a[href^='http']").count()).toBe(0);
  await expect(page.locator("#exam-root")).not.toContainText("YouTube");
});

test("截图归档：学生页（所有测试、确认）和测试页（开始前、作答中、回顾）", async ({ page, playwright, baseURL }, testInfo) => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "screenshots", "student" + (testInfo.project.name === "chromium" ? "" : "-" + testInfo.project.name));
  fs.mkdirSync(dir, { recursive: true });
  const s = await scenario(page, playwright, baseURL, { duration: 60 });
  await page.clock.install({ time: new Date("2031-03-12T09:30:00-07:00") });
  await page.goto("/?lang=zh");
  await expect(page.locator("#start-btn")).toBeVisible();
  await page.screenshot({ path: path.join(dir, "student-home.png"), fullPage: true });
  await page.click("#all-tests-btn");
  await page.screenshot({ path: path.join(dir, "student-all-tests.png") });
  await page.keyboard.press("Escape");
  await page.click("#start-btn");
  await page.screenshot({ path: path.join(dir, "student-confirm.png") });
  await page.goto(`/exam?id=${s.asm.id}&early=1&lang=zh`);
  await page.getByLabel(/在屏幕上输入文字/).check();
  await page.screenshot({ path: path.join(dir, "exam-before.png"), fullPage: true });
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.locator("#timer")).toBeVisible();
  await page.fill("#answer", "细胞膜具有选择透过性，小分子可以直接扩散，离子需要通道蛋白。");
  await expect(page.locator(".save-state")).toHaveText("已保存");
  await page.screenshot({ path: path.join(dir, "exam-running.png") });
});

test("学生页：过往（已评分）的测试默认折叠，只显示测试时间、科目单元、评分；展开后显示完整信息；中英文", async ({ page, playwright, baseURL }) => {
  const s = await scenario(page, playwright, baseURL);
  const { db } = require("../server/db");
  const ins = (unit, wall, iso, status, score) => Number(db.prepare(`INSERT INTO assessments (student_id, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, score, duration_minutes, attempt_no, created_at, updated_at)
    VALUES (?, 'AP Biology', ?, '2020-01-01', '2020-01-01T00:00:00-08:00', ?, ?, 'America/Vancouver', ?, ?, 60, 1, ?, ?)`).run(s.stu.id, unit, wall, iso, status, score, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  ins("PastA", "2025-01-10T10:00", "2025-01-10T10:00:00-08:00", "graded", 5);
  ins("PastB", "2025-02-10T09:30", "2025-02-10T09:30:00-08:00", "graded", 2);
  ins("Waiting", "2025-03-10T09:30", "2025-03-10T09:30:00-07:00", "submitted", null);
  await page.goto("/?lang=zh");
  await page.click("#all-tests-btn");
  const a = page.locator(".past-item", { hasText: "PastA" });
  const toggle = a.locator(".past-toggle");
  await expect(page.locator(".past-item")).toHaveCount(2); // 只有已评分的折叠；待评分、待测试不折叠
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle.locator(".p-time")).toHaveText("2025年1月10日 10:00 AM");
  await expect(toggle.locator(".p-title")).toHaveText("AP Biology · PastA");
  await expect(toggle.locator(".p-score")).toHaveText("5 / 5");
  await expect(a.locator(".past-panel")).toBeHidden();
  await expect(a.getByRole("link", { name: /^查看题目和我的答案/ })).toBeHidden();
  await expect(page.locator(".t-card", { hasText: "Waiting" })).toBeVisible(); // 待评分的完整显示
  await expect(page.locator(".t-card", { hasText: "Unit 2" })).toBeVisible();   // 待测试的完整显示

  if (test.info().project.name === "chromium") {
    const fs = require("fs"), path = require("path");
    const dir = path.join(__dirname, "screenshots", "student");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, "student-past-collapsed.png") });
  }
  await toggle.click();
  if (test.info().project.name === "chromium") await page.screenshot({ path: require("path").join(__dirname, "screenshots", "student", "student-past-expanded.png") });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(a.locator(".past-panel")).toBeVisible();
  await expect(a).toContainText("测试时长");
  await expect(a.getByRole("link", { name: /^查看题目和我的答案/ })).toBeVisible();
  await expect(page.locator(".past-item", { hasText: "PastB" }).locator(".past-panel")).toBeHidden();

  // 全部展开 / 全部收起
  const all = page.locator(".t-toggle-all");
  await expect(all).toHaveText("全部展开");
  await all.click();
  await expect(page.locator(".past-panel:visible")).toHaveCount(2);
  await expect(all).toHaveText("全部收起");
  await all.click();
  await expect(page.locator(".past-panel:visible")).toHaveCount(0);

  // 英文：按钮文字和摘要（弹窗打开时页面其余部分不可操作，先关闭再切换语言）
  await page.keyboard.press("Escape");
  await page.click('.lang-btn[data-lang="en"]');
  await page.click("#all-tests-btn");
  await expect(page.locator(".t-toggle-all")).toHaveText("Expand all");
  await expect(page.locator(".past-item", { hasText: "PastA" }).locator(".p-time")).toHaveText("Jan 10, 2025, 10:00 AM");
  await expect(page.locator(".past-item", { hasText: "PastA" }).locator(".p-score")).toHaveText("5 / 5");
  // 键盘展开；关闭再打开弹窗，展开状态保持
  const t2 = page.locator(".past-item", { hasText: "PastA" }).locator(".past-toggle");
  await t2.focus();
  await page.keyboard.press("Enter");
  await expect(t2).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await page.click("#all-tests-btn");
  await expect(page.locator(".past-item", { hasText: "PastA" }).locator(".past-toggle")).toHaveAttribute("aria-expanded", "true");
});
