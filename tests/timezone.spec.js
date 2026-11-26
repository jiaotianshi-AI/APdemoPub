// 时区与账号绑定：账号的时区、测试时间按学生所在时区设定、界面不再出现“（温哥华时间）”
const { test, expect } = require("@playwright/test");
const { state, ANON, H, uid, makeUser, linkSupervisor, loginCtx, uploadPdf, PASSWORD } = require("./helpers");

const adminCtx = (playwright, baseURL) => playwright.request.newContext({ baseURL, storageState: state("admin") });
const setTz = (id, tz) => require("../server/db").db.prepare("UPDATE accounts SET timezone = ? WHERE id = ?").run(tz, id);

test("管理员新建账号可选时区，默认温哥华（-7）；时区可修改；无效时区被拒绝；列表带标签", async ({ playwright, baseURL }) => {
  const admin = await adminCtx(playwright, baseURL);
  const create = (data) => admin.post("/api/admin/accounts", { headers: H, data });
  const dflt = await create({ username: uid("tzd"), type: "student" });
  expect(dflt.status()).toBe(201);
  let acc = (await dflt.json()).account;
  expect([acc.timezone, acc.tzLabel.zh, acc.tzLabel.en]).toEqual(["America/Vancouver", "温哥华，-7", "Vancouver, -7"]);

  const sh = await create({ username: uid("tzs"), type: "supervisor", timezone: "Asia/Shanghai" });
  acc = (await sh.json()).account;
  expect([acc.timezone, acc.tzLabel.zh]).toEqual(["Asia/Shanghai", "北京，+8"]);
  for (const bad of ["Mars/Base", "", 5, null, "america/vancouver"]) {
    expect((await create({ username: uid("tzb"), type: "student", timezone: bad })).status(), String(bad)).toBe(422);
  }
  // 修改时区（可单独改，也可和关联一起改）
  let r = await admin.patch(`/api/admin/accounts/${acc.id}`, { headers: H, data: { timezone: "Asia/Tokyo" } });
  expect((await r.json()).account.tzLabel.zh).toBe("东京，+9");
  const stu = (await (await create({ username: uid("tzst"), type: "student" })).json()).account;
  r = await admin.patch(`/api/admin/accounts/${acc.id}`, { headers: H, data: { timezone: "Europe/London", studentIds: [stu.id] } });
  const u = (await r.json()).account;
  expect([u.timezone, u.studentIds]).toEqual(["Europe/London", [stu.id]]);
  expect((await admin.patch(`/api/admin/accounts/${acc.id}`, { headers: H, data: { timezone: "nope" } })).status()).toBe(422);
  // 校验失败时不会只改一半：非法的学生列表 + 合法时区 → 整体拒绝，时区不变
  expect((await admin.patch(`/api/admin/accounts/${acc.id}`, { headers: H, data: { timezone: "Asia/Seoul", studentIds: [99999999] } })).status()).toBe(422);
  const list = await (await admin.get("/api/admin/accounts")).json();
  expect(list.accounts.find((a) => a.id === acc.id).timezone).toBe("Europe/London");
  expect(list.timezones.length).toBeGreaterThan(10);
  expect(list.timezones[0].id).toBe("America/Vancouver");
  expect(list.defaultTimezone).toBe("America/Vancouver");
  // 账号名与类型仍然不可改
  expect((await admin.patch(`/api/admin/accounts/${acc.id}`, { headers: H, data: { type: "student" } })).status()).toBe(400);
  await admin.dispose();
});

test("登录后 /api/me 带时区；学生的概览也带时区；旧账号默认温哥华", async ({ playwright, baseURL }) => {
  const stu = await makeUser("student", "tzme");
  setTz(stu.id, "America/New_York");
  const ctx = await loginCtx(playwright, baseURL, stu.username);
  const me = await (await ctx.get("/api/me")).json();
  expect([me.timezone, me.tzLabel.zh, me.tzLabel.en]).toEqual(["America/New_York", "纽约，-5", "New York, -5"]);
  const ov = await (await ctx.get("/api/student/overview")).json();
  expect([ov.timezone, ov.tzLabel.zh]).toEqual(["America/New_York", "纽约，-5"]);
  const other = await makeUser("supervisor", "tzold"); // makeUser 没指定时区 → 默认
  expect((await (await (await loginCtx(playwright, baseURL, other.username)).get("/api/me")).json()).timezone).toBe("America/Vancouver");
  await ctx.dispose();
});

async function scenario(playwright, baseURL, { supTz, stuTz }) {
  const sup = await makeUser("supervisor", "tzsup");
  const stu = await makeUser("student", "tzstu");
  setTz(sup.id, supTz); setTz(stu.id, stuTz);
  linkSupervisor(sup.id, stu.id);
  const sctx = await loginCtx(playwright, baseURL, sup.username);
  const q = await uploadPdf(sctx, "q.pdf");
  return { sup, stu, sctx, q };
}
const body = (stuIds, q, extra) => ({ studentIds: stuIds, scheduledWall: "2031-03-15T15:00", subject: "AP Biology", unit: "Unit 2", unitStartDate: "2031-03-01", questionFileIds: [q.id], ...extra });

test("测试时间按学生所在时区：同一个“当地下午 3 点”在不同时区对应不同的精确时刻；与家长时区无关", async ({ playwright, baseURL }) => {
  // 家长在温哥华，学生在北京：家长填 15:00，是学生那边的 15:00（北京时间，+08:00）
  const a = await scenario(playwright, baseURL, { supTz: "America/Vancouver", stuTz: "Asia/Shanghai" });
  const made = (await (await a.sctx.post("/api/supervisor/assessments", { headers: H, data: body([a.stu.id], a.q) })).json()).assessments[0];
  expect([made.scheduledWall, made.timezone]).toEqual(["2031-03-15T15:00", "Asia/Shanghai"]);
  expect(made.scheduledAt).toBe("2031-03-15T15:00:00+08:00");
  expect(made.unitStartDate).toBe("2031-03-01");
  // 同样的输入，学生在温哥华：2031-03-15 是夏令时（-7）
  const b = await scenario(playwright, baseURL, { supTz: "Asia/Shanghai", stuTz: "America/Vancouver" });
  const m2 = (await (await b.sctx.post("/api/supervisor/assessments", { headers: H, data: body([b.stu.id], b.q) })).json()).assessments[0];
  expect([m2.timezone, m2.scheduledAt]).toEqual(["America/Vancouver", "2031-03-15T15:00:00-07:00"]);
  expect(Date.parse(made.scheduledAt)).not.toBe(Date.parse(m2.scheduledAt));
  // 学生页显示的也是“当地时间”（学生概览里 scheduledWall 与 timezone）
  const sctx = await loginCtx(playwright, baseURL, a.stu.username);
  const ov = (await (await sctx.get("/api/student/overview")).json()).next;
  expect([ov.scheduledWall, ov.timezone, ov.scheduledAt]).toEqual(["2031-03-15T15:00", "Asia/Shanghai", "2031-03-15T15:00:00+08:00"]);
  await sctx.dispose(); await a.sctx.dispose(); await b.sctx.dispose();
});

test("“必须晚于现在”按学生的时区判断；多个学生时区不同时，各按各自的时区生效", async ({ playwright, baseURL }) => {
  const sup = await makeUser("supervisor", "tzmix");
  const s1 = await makeUser("student", "tzm1"), s2 = await makeUser("student", "tzm2");
  setTz(s1.id, "Asia/Shanghai"); setTz(s2.id, "America/Vancouver");
  linkSupervisor(sup.id, s1.id); linkSupervisor(sup.id, s2.id);
  const sctx = await loginCtx(playwright, baseURL, sup.username);
  const q = await uploadPdf(sctx, "q.pdf");
  const res = await sctx.post("/api/supervisor/assessments", { headers: H, data: body([s1.id, s2.id], q) });
  const list = (await res.json()).assessments;
  const byStu = Object.fromEntries(list.map((x) => [x.studentId, x]));
  expect(byStu[s1.id].scheduledAt).toBe("2031-03-15T15:00:00+08:00");
  expect(byStu[s2.id].scheduledAt).toBe("2031-03-15T15:00:00-07:00");
  expect([byStu[s1.id].timezone, byStu[s2.id].timezone]).toEqual(["Asia/Shanghai", "America/Vancouver"]);
  // 修改时间同样按学生时区
  const up = await sctx.patch(`/api/supervisor/assessments/${byStu[s1.id].id}`, { headers: H, data: { scheduledWall: "2031-04-01T09:30" } });
  expect((await up.json()).assessment.scheduledAt).toBe("2031-04-01T09:30:00+08:00");
  // 过去的时间：2020 年任何时区都已经过去
  expect((await sctx.post("/api/supervisor/assessments", { headers: H, data: body([s1.id], q, { scheduledWall: "2020-01-01T10:00" }) })).status()).toBe(422);
  await sctx.dispose();
});

test("答卷的开始/提交时间按学生所在时区换算成当地时间（督导者看到的是学生那边的时间）", async ({ playwright, baseURL }) => {
  const a = await scenario(playwright, baseURL, { supTz: "America/Vancouver", stuTz: "Asia/Tokyo" });
  const asm = (await (await a.sctx.post("/api/supervisor/assessments", { headers: H, data: body([a.stu.id], a.q) })).json()).assessments[0];
  const tctx = await loginCtx(playwright, baseURL, a.stu.username);
  await tctx.post(`/api/student/assessments/${asm.id}/start`, { headers: H, data: { method: "paper", confirmEarly: true } });
  const { isoToWall } = require("../server/timeutil");
  const v = await (await a.sctx.get(`/api/supervisor/assessments/${asm.id}/attempt`)).json();
  expect(v.attempt.startedWall).toBe(isoToWall(v.attempt.startedAt, "Asia/Tokyo"));
  expect(v.attempt.deadlineWall).toBe(isoToWall(v.attempt.deadlineAt, "Asia/Tokyo"));
  expect(v.attempt.startedWall).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  await tctx.post(`/api/student/assessments/${asm.id}/submit`, { headers: H, data: {} });
  const v2 = await (await a.sctx.get(`/api/supervisor/assessments/${asm.id}/attempt`)).json();
  expect(v2.attempt.submittedWall).toBe(isoToWall(v2.attempt.submittedAt, "Asia/Tokyo"));
  await tctx.dispose(); await a.sctx.dispose();
});

test("管理员修改学生时区：还没开始的测试保持“当地时间”不变、精确时刻随之改变；已完成的不变；重测用学生当前时区", async ({ playwright, baseURL }) => {
  const a = await scenario(playwright, baseURL, { supTz: "America/Vancouver", stuTz: "America/Vancouver" });
  const mk = async (wall) => (await (await a.sctx.post("/api/supervisor/assessments", { headers: H, data: body([a.stu.id], a.q, { scheduledWall: wall }) })).json()).assessments[0];
  const pending = await mk("2031-03-15T15:00");
  const done = await mk("2031-05-01T10:00");
  await a.sctx.patch(`/api/supervisor/assessments/${done.id}`, { headers: H, data: { questions: [{ questionFileId: a.q.id, score: 4 }] } }); // 已评分
  expect(pending.scheduledAt).toBe("2031-03-15T15:00:00-07:00");

  const admin = await adminCtx(playwright, baseURL);
  expect((await admin.patch(`/api/admin/accounts/${a.stu.id}`, { headers: H, data: { timezone: "Asia/Shanghai" } })).status()).toBe(200);
  const list = (await (await a.sctx.get(`/api/supervisor/students/${a.stu.id}/assessments`)).json()).assessments;
  const p = list.find((x) => x.id === pending.id), d = list.find((x) => x.id === done.id);
  expect([p.scheduledWall, p.timezone, p.scheduledAt, p.unitStartDate]).toEqual(["2031-03-15T15:00", "Asia/Shanghai", "2031-03-15T15:00:00+08:00", "2031-03-01"]);
  expect([d.status, d.timezone, d.scheduledAt]).toEqual(["graded", "America/Vancouver", "2031-05-01T10:00:00-07:00"]); // 已完成的保持原样
  // 重测：按学生当前所在时区
  const re = (await (await a.sctx.post(`/api/supervisor/assessments/${done.id}/retake`, { headers: H, data: { scheduledWall: "2031-06-01T08:00" } })).json()).assessments[0];
  expect([re.timezone, re.scheduledAt]).toEqual(["Asia/Shanghai", "2031-06-01T08:00:00+08:00"]);
  await admin.dispose(); await a.sctx.dispose();
});

test("学生页右上角显示“账号名（时区）”，时间不再带“（温哥华时间）”；中英文", async ({ page, playwright, baseURL }) => {
  const stu = await makeUser("student", "tzui");
  setTz(stu.id, "Asia/Shanghai");
  const sup = await makeUser("supervisor", "tzuis");
  linkSupervisor(sup.id, stu.id);
  const sctx = await loginCtx(playwright, baseURL, sup.username);
  const q = await uploadPdf(sctx, "q.pdf");
  await sctx.post("/api/supervisor/assessments", { headers: H, data: body([stu.id], q) });
  await page.context().clearCookies();
  await page.request.post("/api/login", { headers: H, data: { username: stu.username, password: PASSWORD } });
  await page.goto("/?lang=zh");
  await expect(page.locator("#user-name")).toHaveText(`${stu.username}（北京，+8）`);
  await expect(page.locator("#progress-body")).toContainText("2031年3月15日 3:00 PM");
  await expect(page.locator("body")).not.toContainText("温哥华时间");
  await expect(page.locator("body")).not.toContainText("Vancouver time");
  await page.click('.lang-btn[data-lang="en"]');
  await expect(page.locator("#user-name")).toHaveText(`${stu.username} (Beijing, +8)`);
  await expect(page.locator("#progress-body")).toContainText("Mar 15, 2031, 3:00 PM");
  await expect(page.locator("#progress-body")).not.toContainText("Vancouver time");
  await page.click("#all-tests-btn");
  await expect(page.locator(".t-card").first()).toContainText("Mar 15, 2031, 3:00 PM");
  await expect(page.locator("#modal")).not.toContainText("time)");
  await page.keyboard.press("Escape");
  // 测试页的右上角也显示
  const list = (await (await page.request.get("/api/student/assessments")).json()).assessments;
  await page.goto(`/exam?id=${list[0].id}&early=1&lang=zh`);
  await expect(page.locator("#user-name")).toHaveText(`${stu.username}（北京，+8）`);
  await expect(page.locator("#exam-root")).toContainText("2031年3月15日 3:00 PM");
  await expect(page.locator("body")).not.toContainText("温哥华时间");
  await sctx.dispose();
});

test("督导者页：右上角“账号（时区）”；侧边栏显示学生时区；按学生时区设定的提醒（时区相同/不同/多个不同）", async ({ page, playwright, baseURL }) => {
  const sup = await makeUser("supervisor", "tzp");
  setTz(sup.id, "America/Vancouver");
  const sv = await makeUser("student", "tzsv"), sb = await makeUser("student", "tzsb"), sc = await makeUser("student", "tzsc");
  setTz(sv.id, "America/Vancouver"); setTz(sb.id, "Asia/Shanghai"); setTz(sc.id, "Asia/Tokyo");
  [sv, sb, sc].forEach((s) => linkSupervisor(sup.id, s.id));
  await page.context().clearCookies();
  await page.request.post("/api/login", { headers: H, data: { username: sup.username, password: PASSWORD } });
  await page.goto("/supervisor");
  await expect(page.locator("#whoami")).toHaveText(`当前账号：${sup.username}（温哥华，-7）`);
  await expect(page.locator("#student-list")).toContainText("时区：北京，+8");
  await expect(page.locator("#student-list")).toContainText("时区：东京，+9");
  await expect(page.locator("body")).not.toContainText("温哥华时间");

  await page.click("#new-btn");
  const check = (name) => page.locator("#target-box .check", { hasText: name }).locator("input");
  // 未选学生
  for (const c of await page.locator("#target-box .check:not(.all) input").all()) await c.uncheck();
  await expect(page.locator("#tz-hint")).toContainText("请先选择学生");
  // 学生与家长同一时区：只有提示，没有警告
  await check(sv.username).check();
  await expect(page.locator("#tz-hint")).toHaveText("日期和时间按学生所在时区设定：温哥华，-7。");
  await expect(page.locator("#tz-warn")).toBeHidden();
  // 学生时区不同：警告，要求按学生的时区填写
  await check(sv.username).uncheck();
  await check(sb.username).check();
  await expect(page.locator("#tz-hint")).toHaveText("日期和时间按学生所在时区设定：北京，+8。");
  await expect(page.locator("#tz-warn")).toBeVisible();
  await expect(page.locator("#tz-warn")).toContainText("你的时区是 温哥华，-7，学生的时区是 北京，+8。请按学生所在时区（北京，+8）填写测试日期和时间，不要按你自己的时区。");
  // 选了时区不同的多个学生
  await check(sc.username).check();
  await expect(page.locator("#tz-hint")).toContainText("按每个学生自己所在的时区设定");
  await expect(page.locator("#tz-warn")).toContainText("所选学生的时区不同");
  await expect(page.locator("#tz-warn")).toContainText("北京，+8：1 人");
  await expect(page.locator("#tz-warn")).toContainText("东京，+9：1 人");
  await check(sc.username).uncheck();
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "screenshots", "supervisor");
  if (test.info().project.name === "chromium") { fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, "supervisor-timezone.png") }); }
  await page.keyboard.press("Escape");
});

test("管理页：新建/编辑账号时可选时区（默认温哥华），列表和右上角显示时区", async ({ page }) => {
  await page.context().clearCookies();
  await page.request.post("/api/login", { headers: H, data: { username: "e2e_admin", password: PASSWORD } });
  await page.goto("/admin");
  await expect(page.locator("#whoami")).toContainText("e2e_admin（温哥华，-7）");
  const name = uid("tzadm");
  await page.click("#new-btn");
  await expect(page.locator("#new-tz")).toHaveValue("America/Vancouver");
  await page.fill("#new-username", name);
  await page.selectOption("#new-type", "student");
  await page.selectOption("#new-tz", "Asia/Shanghai");
  await page.click("#create-submit");
  await page.click("#secret-dialog [data-close]");
  await page.fill("#search", name);
  const row = page.locator("#rows tr", { hasText: name });
  await expect(row).toContainText("北京，+8");
  await row.getByRole("button", { name: "编辑 " + name }).click();
  await expect(page.locator("#edit-tz")).toHaveValue("Asia/Shanghai");
  await expect(page.locator("#edit-tz-hint")).toContainText("保持“当地时间”不变");
  await page.selectOption("#edit-tz", "Europe/London");
  await page.click("#edit-submit");
  await expect(row).toContainText("伦敦");
});
