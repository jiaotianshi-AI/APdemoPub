// /supervisor 页面界面测试
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { ANON, H, uid, PASSWORD, makeUser, linkSupervisor, pdf } = require("./helpers");

test.use({ storageState: ANON, viewport: { width: 1180, height: 820 } });

async function loginAs(page, username) {
  const res = await page.request.post("/api/login", { headers: H, data: { username, password: PASSWORD } });
  expect(res.status()).toBe(200);
}
async function setup(page, nStudents = 2) {
  const sup = await makeUser("supervisor", "supui");
  const students = [];
  for (let i = 0; i < nStudents; i++) {
    const s = await makeUser("student", "stuui" + i);
    linkSupervisor(sup.id, s.id);
    students.push(s);
  }
  await loginAs(page, sup.username);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/supervisor");
  await page.waitForFunction(() => document.querySelector("#student-list .student-btn") || !document.getElementById("no-students").hidden);
  return { sup, students, errors };
}
// 页面上的文件名缩略规则：超过 8 个字符时，前 3 个 + * + 后 5 个
const shortName = (n) => { const c = Array.from(n); return c.length <= 8 ? n : c.slice(0, 3).join("") + "*" + c.slice(-5).join(""); };
const file = (name) => ({ name, mimeType: "application/pdf", buffer: pdf(name) });
async function fillTest(page, { date = "2031-03-15", time = "15:00", start = "2031-03-01", subject = "AP Biology", unit, files = ["题目1.pdf"] }) {
  await page.fill("#t-date", date);
  await page.fill("#t-time", time);
  await page.fill("#t-start", start);
  await page.fill("#t-subject", subject);
  await page.fill("#t-unit", unit);
  if (files.length) {
    await page.locator("#q-files input[type=file]").setInputFiles(files.map(file));
    for (const f of files) await expect(page.locator("#q-files .file-item", { hasText: shortName(f) })).toBeVisible();
  }
}
const card = (page, unit) => page.locator(".test-card", { hasText: unit });
// 过往（已评分）的测试默认折叠；需要操作里面的按钮时先展开
async function expand(page, unit) {
  const toggle = page.locator(".past-item", { hasText: unit }).locator(".past-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
async function createVia(page, unit, opts = {}) {
  await page.click("#new-btn");
  if (opts.all) await page.locator("#target-box .check.all input").check();
  await fillTest(page, { unit, ...opts });
  await page.click("#test-submit");
  await expect(page.locator("#test-dialog")).toBeHidden();
}

test("只显示自己关联的学生；点击切换学生", async ({ page }) => {
  const { students } = await setup(page, 2);
  const stranger = await makeUser("student", "stranger");
  await page.reload();
  const buttons = page.locator("#student-list .student-btn");
  await expect(buttons).toHaveCount(2);
  await expect(page.locator("#student-list")).not.toContainText(stranger.username);
  await expect(page.locator("#student-title")).toHaveText(students.map((s) => s.username).sort()[0]);
  await buttons.nth(1).click();
  await expect(page.locator("#student-title")).toHaveText(students.map((s) => s.username).sort()[1]);
  await expect(buttons.nth(1)).toHaveAttribute("aria-current", "true");
});

test("没有关联学生时的提示", async ({ page }) => {
  await setup(page, 0);
  await expect(page.locator("#no-students")).toBeVisible();
  await expect(page.locator("#new-btn")).toBeDisabled();
});

test("新建测试：选“所有学生”，每个学生各得一条；字段显示正确；题目 PDF 可打开", async ({ page }) => {
  const { students } = await setup(page, 2);
  const unit = "Unit " + uid("u");
  await page.click("#new-btn");
  await expect(page.locator("#test-dialog")).toBeVisible();
  await page.locator("#target-box .check.all input").check();
  for (const c of await page.locator("#target-box .check:not(.all) input").all()) await expect(c).toBeChecked();
  await fillTest(page, { unit, files: ["题目1.pdf", "题目2.pdf"] });
  await page.click("#test-submit");
  await expect(page.locator("#test-dialog")).toBeHidden();
  await expect(page.locator("#status")).toContainText("已为 2 个学生新建测试");

  const c = card(page, unit);
  await expect(c).toHaveCount(1);
  await expect(c).toContainText("AP Biology · " + unit);
  await expect(c).toContainText("待测试");
  await expect(c).toContainText("2031年3月15日 3:00 PM");
  await expect(c).toContainText("2031年3月1日");
  await expect(c).toContainText("题目1.pdf");
  await expect(c).toContainText("题目2.pdf");
  const href = await c.locator("a.file-link").first().getAttribute("href");
  expect(href).toMatch(/^\/api\/supervisor\/files\/\d+$/);
  expect(await c.locator("a.file-link").first().getAttribute("rel")).toContain("noopener");
  const pdfRes = await page.request.get(href);
  expect(pdfRes.status()).toBe(200);
  expect(pdfRes.headers()["content-type"]).toBe("application/pdf");

  // 另一个学生也有这条
  const other = page.locator("#student-list .student-btn").nth(1);
  await other.click();
  await expect(card(page, unit)).toHaveCount(1);
});

test("新建测试的校验提示；只接受 PDF", async ({ page }) => {
  await setup(page, 1);
  await page.click("#new-btn");
  await page.locator("#target-box .check:not(.all) input").uncheck();
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("请至少选择一个学生");
  await page.locator("#target-box .check:not(.all) input").check();
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("测试日期和时间");
  await page.fill("#t-date", "2031-03-15"); await page.fill("#t-time", "15:00");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("开始学习日期");
  await page.fill("#t-start", "2031-03-01");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("测试科目");
  await page.fill("#t-subject", "AP Biology");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("测试单元");
  await page.fill("#t-unit", "Unit 1");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("至少上传一个题目 PDF");

  await page.locator("#q-files input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("#q-files .upload-note")).toContainText("不是 PDF");
  await page.locator("#q-files input[type=file]").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await expect(page.locator("#q-files .upload-note")).toContainText("不是有效的 PDF");
  await page.fill("#t-start", "2031-04-01"); // 晚于测试日
  await page.locator("#q-files input[type=file]").setInputFiles(file("ok.pdf"));
  await expect(page.locator("#q-files .file-item")).toHaveCount(1);
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("不能晚于测试日期");
  await page.fill("#t-date", "2020-01-01"); await page.fill("#t-start", "2019-12-01");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("必须晚于现在");
  await page.keyboard.press("Escape");
  await expect(page.locator("#new-btn")).toBeFocused();
});

test("修改待测试：改时间、单元，增删题目文件；删除要确认", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("e");
  await createVia(page, unit, { files: ["a.pdf"] });
  const c = card(page, unit);
  await c.getByRole("button", { name: /^修改：/ }).click();
  await expect(page.locator("#test-title")).toHaveText("修改测试");
  await expect(page.locator("#t-date")).toHaveValue("2031-03-15");
  await expect(page.locator("#target-box")).toContainText("学生：");
  await page.fill("#t-date", "2031-03-22");
  await page.fill("#t-time", "10:30");
  await page.fill("#t-unit", unit + "b");
  await page.locator("#q-files input[type=file]").setInputFiles(file("b.pdf"));
  await expect(page.locator("#q-files .file-item")).toHaveCount(2);
  await page.getByRole("button", { name: "移除 a.pdf" }).click();
  await page.click("#test-submit");
  await expect(page.locator("#test-dialog")).toBeHidden();
  const c2 = card(page, unit + "b");
  await expect(c2).toContainText("2031年3月22日 10:30 AM");
  await expect(c2).toContainText("b.pdf");
  await expect(c2).not.toContainText("a.pdf");

  await c2.getByRole("button", { name: /^删除：/ }).click();
  await page.click("#confirm-dialog [data-close]");
  await expect(c2).toBeVisible();
  await c2.getByRole("button", { name: /^删除：/ }).click();
  await page.click("#confirm-ok");
  await expect(card(page, unit + "b")).toHaveCount(0);
});

test("每题的回答 PDF 与评分：每题可单独上传回答、评分；评完所有题后自动算出汇总评分并变为已评分；公式有说明", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("s");
  await createVia(page, unit, { files: ["问题1.pdf", "问题2.pdf", "问题3.pdf"] });
  const c = card(page, unit);
  // 列表里每道题一行：题号、问题 PDF、回答 PDF（可为空）、评分（可为空）
  await expect(c.locator(".q-row:not(.q-head)")).toHaveCount(3);
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("Q1");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("问题1.pdf");
  await expect(c).toContainText("汇总评分");
  await expect(c).toContainText("已评 0 / 3 题");

  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await expect(page.locator("#score-dialog")).not.toContainText("加权平均值，四舍五入到整数"); // 不再显示评分规则说明
  await expect(page.locator("#grade-rows .grade-row")).toHaveCount(3);
  await expect(page.locator("#grade-overall")).toContainText("还不能计算（已评 0 / 3 题）");
  // Q1：上传回答 PDF + 评分 5；Q2：只评分 3；Q3 暂不评
  await page.locator("#grade-rows .grade-row").nth(0).locator("input[type=file][aria-label*='回答 PDF']").setInputFiles(file("回答Q1.pdf"));
  await expect(page.locator("#grade-rows .grade-row").nth(0)).toContainText("回答Q1.pdf");
  await page.selectOption("#score-" + (await page.locator("#grade-rows .grade-row select").nth(0).getAttribute("id")).replace("score-", ""), "5");
  await page.locator("#grade-rows .grade-row select").nth(1).selectOption("3");
  await expect(page.locator("#grade-overall")).toContainText("已评 2 / 3 题");
  await page.click("#score-submit");
  await expect(page.locator("#score-dialog")).toBeHidden();
  await expect(c).toContainText("已评 2 / 3 题");
  await expect(c).not.toContainText("已评分");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("回答Q1.pdf");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("5 / 5");
  await expect(c.locator(".q-row:not(.q-head)").nth(1)).toContainText("—"); // Q2 没有回答 PDF（可为空）
  await expect(c.locator(".q-row:not(.q-head)").nth(1)).toContainText("3 / 5");

  // 评完 Q3 = 4：(5+3+4)/3 = 4 → 汇总 4，状态变为已评分
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await page.locator("#grade-rows .grade-row select").nth(2).selectOption("4");
  await expect(page.locator("#grade-overall")).toContainText("汇总评分：4 / 5（加权平均 4）");
  await page.click("#score-submit");
  await expect(page.locator("#score-dialog")).toBeHidden();
  await expect(c).toContainText("已评分");
  await expect(c).toContainText("4 / 5（加权平均 4）");
  await expect(c.getByRole("button", { name: /^修改：/ })).toHaveCount(0);
  await expect(c.getByRole("button", { name: /^删除：/ })).toHaveCount(0);
  await expand(page, unit);
  await expect(c.getByRole("button", { name: /^修改评分：/ })).toBeVisible();
  await expect(c.getByRole("button", { name: /^重测：/ })).toBeVisible();

  // 修改某题评分：Q3 改成 5 → (5+3+5)/3 = 4.33 → 4；清空 Q2 的评分 → 汇总回到空，状态退回
  await c.getByRole("button", { name: /^修改评分：/ }).click();
  await expect(page.locator("#grade-rows .grade-row select").nth(0)).toHaveValue("5");
  await page.locator("#grade-rows .grade-row select").nth(1).selectOption("");
  await expect(page.locator("#grade-overall")).toContainText("还不能计算");
  await page.click("#score-submit");
  await expect(c).toContainText("已评 2 / 3 题");
  await expect(c.getByRole("button", { name: /^重测：/ })).toHaveCount(0);
});

test("回答 PDF 的替换与移除；不是 PDF 的文件被拒绝", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("p");
  await createVia(page, unit, { files: ["问题1.pdf"] });
  const c = card(page, unit);
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  const row = page.locator("#grade-rows .grade-row").first();
  await row.locator("input[type=file][aria-label*='回答 PDF']").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(row).toContainText("不是 PDF");
  await row.locator("input[type=file][aria-label*='回答 PDF']").setInputFiles(file("第一版.pdf"));
  await expect(row.locator(".fname").first()).toContainText("第一版.pdf");
  await page.click("#score-submit");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("第一版.pdf");
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await row.locator("input[type=file][aria-label*='回答 PDF']").setInputFiles(file("第二版.pdf")); // 替换
  await expect(row.locator(".fname").first()).toContainText("第二版.pdf");
  await page.click("#score-submit");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("第二版.pdf");
  await expect(c).not.toContainText("第一版.pdf");
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await row.getByRole("button", { name: /^移除/ }).click();
  await page.click("#score-submit");
  await expect(c).not.toContainText("第二版.pdf");
});

test("重测：生成一条新的待测试记录，原记录保留", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("r");
  await createVia(page, unit);
  await card(page, unit).getByRole("button", { name: /^答题与评分：/ }).click();
  await page.locator("#grade-rows .grade-row select").first().selectOption("2");
  await page.click("#score-submit");
  await expect(page.locator("#score-dialog")).toBeHidden();

  await expand(page, unit);
  await card(page, unit).getByRole("button", { name: /^重测：/ }).click();
  await expect(page.locator("#retake-summary")).toContainText("汇总评分 2 / 5");
  await page.click("#retake-submit");
  await expect(page.locator("#retake-error")).toContainText("新的测试日期和时间");
  await page.fill("#r-date", "2020-01-01"); await page.fill("#r-time", "10:00");
  await page.click("#retake-submit");
  await expect(page.locator("#retake-error")).toContainText("必须晚于现在");
  await page.fill("#r-date", "2031-04-12"); await page.fill("#r-time", "15:00");
  await page.click("#retake-submit");
  await expect(page.locator("#retake-dialog")).toBeHidden();

  const cards = card(page, unit);
  await expect(cards).toHaveCount(2);
  const fresh = cards.filter({ hasText: "第 2 次" });
  await expect(fresh).toContainText("待测试");
  await expect(fresh).toContainText("2031年4月12日 3:00 PM");
  await expect(fresh).toContainText("题目1.pdf");
  await expect(fresh).toContainText("—"); // 无分数
  const old = cards.filter({ hasText: "2 / 5" });
  await expect(old).toContainText("已评分");
});

test("分组：时间已过或已评分的在“过往”，将来的待测试在“将来”", async ({ page }) => {
  const { students } = await setup(page, 1);
  const { db } = require("../server/db");
  const mk = (unit, wall, iso, status, score) => db.prepare(`INSERT INTO assessments (student_id, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, score, attempt_no, created_at, updated_at)
    VALUES (?, 'AP Biology', ?, '2020-01-01', '2020-01-01T00:00:00-08:00', ?, ?, 'America/Vancouver', ?, ?, 1, ?, ?)`).run(students[0].id, unit, wall, iso, status, score, new Date().toISOString(), new Date().toISOString());
  mk("OldGraded", "2020-02-01T10:00", "2020-02-01T10:00:00-08:00", "graded", 3);
  mk("OldPending", "2020-03-01T10:00", "2020-03-01T10:00:00-08:00", "scheduled", null);
  mk("FutureOne", "2031-05-01T10:00", "2031-05-01T10:00:00-07:00", "scheduled", null);
  await page.reload();
  await expect(page.locator("#lists .group-title").first()).toContainText("将来的测试（1）");
  await expect(page.locator("#lists .group-title").nth(1)).toContainText("过往的测试（2）");
  const sections = page.locator("#lists section");
  await expect(sections.nth(0)).toContainText("FutureOne");
  await expect(sections.nth(1)).toContainText("OldGraded");
  await expect(sections.nth(1)).toContainText("OldPending");
  await expect(sections.nth(0)).not.toContainText("OldPending");
});

test("触控目标 ≥ 44px；axe 无 serious/critical（页面与各对话框）；窄屏无横向滚动", async ({ page }) => {
  await setup(page, 2);
  const unit = "Unit " + uid("a");
  await createVia(page, unit);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href], input, select"))
      .filter((e) => e.offsetParent !== null)
      .map((e) => { const b = e.getBoundingClientRect(); return { n: e.tagName + "#" + (e.id || e.textContent.trim().slice(0, 10)), w: Math.round(b.width), h: Math.round(b.height) }; })
      .filter((x) => x.h < 44 || x.w < 44)
  );
  expect(small).toEqual([]);

  const check = async (label) => {
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => label + " " + v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(" | "))).toEqual([]);
  };
  await check("列表");
  await page.click("#new-btn");
  await check("新建对话框");
  await page.keyboard.press("Escape");
  await card(page, unit).getByRole("button", { name: /^修改：/ }).click();
  await check("修改对话框");
  await page.keyboard.press("Escape");
  await card(page, unit).getByRole("button", { name: /^答题与评分：/ }).click();
  await check("答题与评分对话框");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw[0]).toBeLessThanOrEqual(sw[1]);
});

test("没有控制台错误；退出登录回到登录页", async ({ page }) => {
  const { errors } = await setup(page, 1);
  await createVia(page, "Unit " + uid("c"));
  expect(errors).toEqual([]);
  await page.click("#logout-btn");
  await expect(page).toHaveURL(/\/login$/);
});

test("截图归档：督导者页面（供人工审阅外观）", async ({ page }, testInfo) => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "screenshots", "supervisor" + (testInfo.project.name === "chromium" ? "" : "-" + testInfo.project.name));
  fs.mkdirSync(dir, { recursive: true });
  const { students } = await setup(page, 2);
  await createVia(page, "Unit 2", { all: true, subject: "AP Biology", files: ["Unit2-题目A.pdf", "Unit2-题目B.pdf"] });
  const c = card(page, "Unit 2").first();
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await page.locator("#grade-rows .grade-row input[type=file][aria-label*='回答 PDF']").first().setInputFiles(file("答题.pdf"));
  await page.locator("#grade-rows .grade-row select").first().selectOption("4");
  await page.click("#score-submit");
  await expect(page.locator("#score-dialog")).toBeHidden();
  await createVia(page, "Unit 3", { subject: "AP Biology", date: "2031-04-05", start: "2031-03-20" });
  await page.screenshot({ path: path.join(dir, "supervisor-list.png"), fullPage: true });
  await page.click("#new-btn");
  await page.screenshot({ path: path.join(dir, "supervisor-create.png") });
  expect(students.length).toBe(2);
});

// ---- 测试流程相关：时长、新状态、查看学生答题、AI 评分预留 ----
const { uploadPdf: uploadPdfApi, loginCtx } = require("./helpers");

test("新建测试可以设置测试时长（默认 60 分钟），并显示在列表里；时长校验", async ({ page, playwright, baseURL }) => {
  await setup(page, 1);
  await page.click("#new-btn");
  await expect(page.locator("#t-duration")).toHaveValue("60");
  const unit = "Unit " + uid("d");
  await fillTest(page, { unit });
  await page.fill("#t-duration", "3");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("5–300 分钟");
  await page.fill("#t-duration", "90");
  await page.click("#test-submit");
  await expect(page.locator("#test-dialog")).toBeHidden();
  await expect(card(page, unit)).toContainText("测试时长");
  await expect(card(page, unit)).toContainText("90 分钟");

  await card(page, unit).getByRole("button", { name: /^修改：/ }).click();
  await expect(page.locator("#t-duration")).toHaveValue("90");
  await page.fill("#t-duration", "45");
  await page.click("#test-submit");
  await expect(card(page, unit)).toContainText("45 分钟");
});

test("学生测试中/已提交：显示状态和作答信息；查看学生答题", async ({ page, playwright, baseURL }) => {
  const { sup, students } = await setup(page, 1);
  const unit = "Unit " + uid("v");
  await createVia(page, unit, { files: ["题目A.pdf", "题目B.pdf"] });
  // 学生开始作答
  const stuCtx = await loginCtx(playwright, baseURL, students[0].username);
  const list = (await (await page.request.get(`/api/supervisor/students/${students[0].id}/assessments`)).json()).assessments;
  const asm = list.find((a) => a.unit === unit);
  const started = await stuCtx.post(`/api/student/assessments/${asm.id}/start`, { headers: H, data: { method: "typed", confirmEarly: true } });
  expect(started.status()).toBe(200);
  const qs = (await started.json()).questions;
  await stuCtx.put(`/api/student/assessments/${asm.id}/answers/${qs[0].id}`, { headers: H, data: { text: "学生写的第一题答案\n第二行" } });

  await page.reload();
  await expect(page.locator("#lists .group-title").nth(1)).toContainText("进行中与待评分（1）");
  const c = card(page, unit);
  await expect(c).toContainText("测试中");
  await expect(c).toContainText("学生正在测试，完成后才能修改");
  await expect(c).toContainText("作答方式：屏幕输入");
  await expect(c.getByRole("button", { name: /^修改：/ })).toHaveCount(0);
  await expect(c.getByRole("button", { name: /^删除：/ })).toHaveCount(0);

  await stuCtx.post(`/api/student/assessments/${asm.id}/submit`, { headers: H, data: {} });
  await page.reload();
  await expect(c).toContainText("已提交，待评分");
  await expect(c).toContainText("离开页面 0 次");
  await c.getByRole("button", { name: /^查看学生答题：/ }).click();
  await expect(page.locator("#view-dialog")).toBeVisible();
  await expect(page.locator("#view-questions .view-q")).toHaveCount(2);
  await expect(page.locator("#view-questions .view-q").first()).toContainText("题目A.pdf");
  await expect(page.locator("#view-questions .answer-text").first()).toHaveText("学生写的第一题答案\n第二行");
  await expect(page.locator("#view-questions .answer-text").nth(1)).toHaveText("（没有填写）");
  // 列表里每道题都有“回答文字”一栏（屏幕输入作答时显示学生写的文字）
  await page.keyboard.press("Escape");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("学生写的第一题答案");
  await expect(c.locator(".q-row:not(.q-head)").nth(1)).toContainText("（没有填写）");
  await c.getByRole("button", { name: /^查看学生答题：/ }).click();
  // 查看答题窗口里不再有 AI 按钮（AI 评分在“答题与评分”里，见 tests/ai.spec.js），只有一句说明
  await expect(page.locator("#view-dialog")).toContainText("答题与评分");
  await expect(page.locator("#view-dialog").getByRole("button", { name: /AI/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#view-dialog")).toBeHidden();

  // 提交后可以上传扫描件并评分
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await page.locator("#grade-rows .grade-row").first().locator("input[type=file][aria-label*='回答 PDF']").setInputFiles(file("扫描.pdf"));
  await expect(page.locator("#grade-rows .grade-row").first()).toContainText("扫描.pdf");
  await page.locator("#grade-rows .grade-row select").nth(0).selectOption("3");
  await page.locator("#grade-rows .grade-row select").nth(1).selectOption("3");
  await page.click("#score-submit");
  await expect(c).toContainText("已评分");
  await expect(c).toContainText("3 / 5");
  expect(sup.id).toBeGreaterThan(0);
  await stuCtx.dispose();
});

test("查看答题的对话框通过 axe；还没开始的测试提示“学生还没有开始”", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("x");
  await createVia(page, unit);
  const c = card(page, unit);
  // 待测试没有“查看”按钮；用已评分的无答卷记录检查提示
  const { db } = require("../server/db");
  db.prepare("UPDATE assessments SET status = 'graded', score = 4 WHERE unit = ?").run(unit);
  await page.reload();
  await expand(page, unit);
  await card(page, unit).getByRole("button", { name: /^查看学生答题：/ }).click();
  await expect(page.locator("#view-info")).toContainText("学生还没有开始这场测试");
  const res = await new AxeBuilder({ page }).analyze();
  expect(res.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id)).toEqual([]);
  expect(c).toBeTruthy();
});

test("截图归档：每题回答与评分（供人工审阅外观）", async ({ page, playwright, baseURL }, testInfo) => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "screenshots", "supervisor" + (testInfo.project.name === "chromium" ? "" : "-" + testInfo.project.name));
  fs.mkdirSync(dir, { recursive: true });
  const { students } = await setup(page, 1);
  await createVia(page, "Unit 2", { files: ["Q1-细胞膜.pdf", "Q2-渗透.pdf", "Q3-酶.pdf"] });
  const list = (await (await page.request.get(`/api/supervisor/students/${students[0].id}/assessments`)).json()).assessments;
  const asm = list.find((a) => a.unit === "Unit 2");
  const stuCtx = await loginCtx(playwright, baseURL, students[0].username);
  const started = await stuCtx.post(`/api/student/assessments/${asm.id}/start`, { headers: H, data: { method: "typed", confirmEarly: true } });
  const qs = (await started.json()).questions;
  await stuCtx.put(`/api/student/assessments/${asm.id}/answers/${qs[0].id}`, { headers: H, data: { text: "细胞膜具有选择透过性，小分子可以直接扩散。" } });
  await stuCtx.put(`/api/student/assessments/${asm.id}/answers/${qs[1].id}`, { headers: H, data: { text: "水分子通过渗透作用从低浓度向高浓度移动。" } });
  await stuCtx.post(`/api/student/assessments/${asm.id}/submit`, { headers: H, data: {} });
  const f = await uploadPdfApi(await loginCtx(playwright, baseURL, (await (await page.request.get("/api/me")).json()).username), "Q2-回答.pdf", "a");
  await page.request.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data: { questions: [{ questionFileId: qs[0].id, score: 5 }, { questionFileId: qs[1].id, answerFileId: f.id, score: 3 }] } });
  await page.reload();
  await page.screenshot({ path: path.join(dir, "supervisor-questions.png"), fullPage: true });
  await card(page, "Unit 2").getByRole("button", { name: /^答题与评分：/ }).click();
  await page.screenshot({ path: path.join(dir, "supervisor-grade.png") });
  await stuCtx.dispose();
});

// ---- 每题权重 ----
test("新建测试：每个题目 PDF 旁边可以设置权重（默认 1）；列表显示权重；评分预览按加权平均计算", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("w");
  await page.click("#new-btn");
  await fillTest(page, { unit, files: ["题A.pdf", "题B.pdf", "题C.pdf"] });
  const weights = page.locator("#q-files .weight-input");
  await expect(weights).toHaveCount(3);
  await expect(weights.nth(0)).toHaveValue("1");
  await expect(page.locator("#q-files .file-item").first()).toContainText("Q1");
  // 无效权重
  await weights.nth(1).fill("0");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("权重必须是 1–100 的整数");
  await weights.nth(1).fill("");
  await page.click("#test-submit");
  await expect(page.locator("#test-error")).toContainText("权重必须是 1–100 的整数");
  await weights.nth(1).fill("2");
  await page.click("#test-submit");
  await expect(page.locator("#test-dialog")).toBeHidden();

  const c = card(page, unit);
  const rows = c.locator(".q-row:not(.q-head)");
  await expect(rows.nth(0)).toContainText("×1");
  await expect(rows.nth(1)).toContainText("×2");
  await expect(rows.nth(2)).toContainText("×1");

  // 评分对话框：不显示规则说明，也不能改权重（权重在“修改测试”里设定）；预览仍按加权平均：Q1=5, Q2=1, Q3=5 → (5+2+5)/4 = 3
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await expect(page.locator("#score-dialog")).not.toContainText("加权平均 =");
  await expect(page.locator("#score-dialog")).not.toContainText("权重");
  await expect(page.locator("#grade-rows .grade-row input[type=number]")).toHaveCount(0);
  const selects = page.locator("#grade-rows .grade-row select");
  await selects.nth(0).selectOption("5");
  await selects.nth(1).selectOption("1");
  await selects.nth(2).selectOption("5");
  await expect(page.locator("#grade-overall")).toContainText("汇总评分：3 / 5（加权平均 3）");
  await page.click("#score-submit");
  await expect(page.locator("#score-dialog")).toBeHidden();
  await expect(c).toContainText("已评分");
  await expect(c).toContainText("3 / 5（加权平均 3）");
  await expect(rows.nth(1)).toContainText("×2"); // 保存评分不会改动权重
});

test("修改待测试：能改每个题目的权重", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("we");
  await createVia(page, unit, { files: ["题A.pdf", "题B.pdf"] });
  const c = card(page, unit);
  await c.getByRole("button", { name: /^修改：/ }).click();
  const weights = page.locator("#q-files .weight-input");
  await expect(weights).toHaveCount(2);
  await weights.nth(1).fill("5");
  await page.click("#test-submit");
  await expect(page.locator("#test-dialog")).toBeHidden();
  await expect(c.locator(".q-row:not(.q-head)").nth(1)).toContainText("×5");
  await c.getByRole("button", { name: /^修改：/ }).click();
  await expect(page.locator("#q-files .weight-input").nth(1)).toHaveValue("5");
  await page.keyboard.press("Escape");
});

// ---- 过往测试折叠 ----
async function seedPast(page) {
  const sup = await makeUser("supervisor", "pastsup");
  const stu = await makeUser("student", "paststu");
  linkSupervisor(sup.id, stu.id);
  const { db } = require("../server/db");
  const ins = (unit, wall, iso, status, score) => Number(db.prepare(`INSERT INTO assessments (student_id, created_by, subject, unit, unit_start_date, unit_start_at, scheduled_wall, scheduled_at, timezone, status, score, duration_minutes, attempt_no, created_at, updated_at)
    VALUES (?, ?, 'AP Biology', ?, '2024-01-01', '2024-01-01T00:00:00-08:00', ?, ?, 'America/Vancouver', ?, ?, 60, 1, ?, ?)`).run(stu.id, sup.id, unit, wall, iso, status, score, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  const a = ins("PastOne", "2025-01-10T10:00", "2025-01-10T10:00:00-08:00", "graded", 4);
  // 给 PastOne 一道题（只在数据库里放一条文件记录，评分对话框需要至少一道题）
  const fid = Number(db.prepare("INSERT INTO files (stored_name, original_name, size, uploaded_by, created_at) VALUES (?, 'q.pdf', 10, ?, ?)").run(require("crypto").randomBytes(16).toString("hex") + ".pdf", sup.id, new Date().toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO assessment_files (assessment_id, file_id, role, position) VALUES (?, ?, 'question', 0)").run(a, fid);
  const b = ins("PastTwo", "2025-02-10T09:30", "2025-02-10T09:30:00-08:00", "graded", 2);
  const c = ins("PastUnscored", "2025-03-10T09:30", "2025-03-10T09:30:00-07:00", "scheduled", null); // 时间已过但没有评分
  return { sup, stu, ids: { a, b, c } };
}

test("督导者页：过往的测试默认折叠，只显示测试时间、科目单元、评分；展开后显示完整信息；可全部展开/收起", async ({ page }) => {
  const { sup } = await seedPast(page);
  await page.context().clearCookies();
  await page.request.post("/api/login", { headers: H, data: { username: sup.username, password: PASSWORD } });
  await page.goto("/supervisor");
  await expect(page.locator(".past-item")).toHaveCount(3);
  const one = page.locator(".past-item", { hasText: "PastOne" });
  const toggle = one.locator(".past-toggle");
  // 折叠：摘要行只有三项（时间、科目单元、评分），完整信息不可见
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle.locator(".p-time")).toHaveText("2025年1月10日 10:00 AM");
  await expect(toggle.locator(".p-title")).toHaveText("AP Biology · PastOne");
  await expect(toggle.locator(".p-score")).toHaveText("4 / 5");
  await expect(one.locator(".past-panel")).toBeHidden();
  await expect(one.getByRole("button", { name: /^重测：/ })).toBeHidden();
  await expect(one.locator(".q-table")).toBeHidden();
  await expect(page.locator(".past-item", { hasText: "PastUnscored" }).locator(".p-score")).toHaveText("—");
  // 将来/进行中的测试不折叠（这里没有，所以“将来的测试”为空）
  await expect(page.locator("#lists .group-title").first()).toContainText("将来的测试（0）");

  if (test.info().project.name === "chromium") {
    const fs = require("fs"), path = require("path");
    const dir = path.join(__dirname, "screenshots", "supervisor");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, "supervisor-past-collapsed.png"), fullPage: true });
  }
  // 展开：完整信息（题目表、时长、按钮等）
  await toggle.click();
  if (test.info().project.name === "chromium") await page.screenshot({ path: require("path").join(__dirname, "screenshots", "supervisor", "supervisor-past-expanded.png"), fullPage: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(one.locator(".past-panel")).toBeVisible();
  await expect(one.locator(".q-table")).toBeVisible();
  await expect(one).toContainText("测试时长");
  await expect(one.getByRole("button", { name: /^重测：/ })).toBeVisible();
  await expect(page.locator(".past-item", { hasText: "PastTwo" }).locator(".past-panel")).toBeHidden(); // 其他的仍折叠
  // 再点收起
  await toggle.click();
  await expect(one.locator(".past-panel")).toBeHidden();

  // 全部展开 / 全部收起
  const all = page.locator(".group-toggle");
  await expect(all).toHaveText("全部展开");
  await all.click();
  await expect(page.locator(".past-panel:visible")).toHaveCount(3);
  await expect(all).toHaveText("全部收起");
  await all.click();
  await expect(page.locator(".past-panel:visible")).toHaveCount(0);
  await expect(all).toHaveText("全部展开");
  // 单个展开后，按钮文字同步；全部展开后收起一个，按钮回到“全部展开”
  await all.click();
  await page.locator(".past-item", { hasText: "PastTwo" }).locator(".past-toggle").click();
  await expect(all).toHaveText("全部展开");
});

test("督导者页：折叠的展开状态在重新加载列表（如保存评分）后保持；键盘可展开/收起", async ({ page }) => {
  const { sup } = await seedPast(page);
  await page.context().clearCookies();
  await page.request.post("/api/login", { headers: H, data: { username: sup.username, password: PASSWORD } });
  await page.goto("/supervisor");
  const one = page.locator(".past-item", { hasText: "PastOne" });
  const toggle = one.locator(".past-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await one.getByRole("button", { name: /^修改评分：/ }).click();
  await page.locator("#grade-rows .grade-row select").first().selectOption("3");
  await page.click("#score-submit");
  await expect(page.locator("#score-dialog")).toBeHidden();
  await expect(one.locator(".p-score")).toHaveText("3 / 5"); // 摘要里的评分随之更新
  await expect(toggle).toHaveAttribute("aria-expanded", "true"); // 仍然展开
  await page.keyboard.press("Escape");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("修改测试页：题目清单的文件名缩略为“前 3 个字符 + * + 后 5 个字符”，不显示文件大小", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("n");
  await page.click("#new-btn");
  await fillTest(page, { unit, files: ["AP_Bio_2021_FRQ_Q1.pdf", "短名.pdf"] });
  const items = page.locator("#q-files .file-item .fname");
  await expect(items.nth(0)).toHaveText("Q1　AP_*1.pdf");
  await expect(items.nth(1)).toHaveText("Q2　短名.pdf"); // 不超过 8 个字符：完整显示
  await expect(items.nth(0)).toHaveAttribute("title", /^AP_Bio_2021_FRQ_Q1\.pdf（\d+ KB）$/); // 鼠标悬停可看全名
  await expect(page.locator("#q-files")).not.toContainText("KB");
});

test("答题与评分页：回答 PDF / 判分标准 / 题目的文件名也缩略显示", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("sn");
  await createVia(page, unit, { files: ["AP_Bio_2021_FRQ_Q1.pdf"] });
  const c = card(page, unit);
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  const row = page.locator("#grade-rows .grade-row").first();
  await expect(row.locator(".grade-head .file-link")).toHaveText("AP_*1.pdf");
  await row.locator("input[type=file][aria-label*='回答 PDF']").setInputFiles(file("Student_Answer_Scan_final.pdf"));
  await expect(row.locator(".fname").first()).toHaveText("Stu*l.pdf");
});

test("家长端主页面：测试卡片里的题目、回答 PDF 文件名缩略显示，悬停显示全名", async ({ page }) => {
  await setup(page, 1);
  const unit = "Unit " + uid("mn");
  await createVia(page, unit, { files: ["AP_Bio_2021_FRQ_Q1.pdf"] });
  const c = card(page, unit);
  const link = c.locator(".q-row:not(.q-head) .file-link").first();
  await expect(link).toHaveText("AP_*1.pdf");
  await expect(link).toHaveAttribute("title", "AP_Bio_2021_FRQ_Q1.pdf");
  await expect(c).not.toContainText("AP_Bio_2021_FRQ_Q1.pdf");
  await c.getByRole("button", { name: /^答题与评分：/ }).click();
  await page.locator("#grade-rows input[type=file][aria-label*='回答 PDF']").setInputFiles(file("Student_Answer_Scan_final.pdf"));
  await page.click("#score-submit");
  await expect(c.locator(".q-row:not(.q-head)").first()).toContainText("Stu*l.pdf");
});
