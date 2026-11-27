// /admin 页面界面测试
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { state, ANON, H, uid, PASSWORD } = require("./helpers");

test.use({ storageState: state("admin"), viewport: { width: 1180, height: 820 } });

const LABEL = { student: "学生", supervisor: "督导者", support: "客服" };

async function createViaUi(page, name, type, subject = "AP Biology") {
  await page.click("#new-btn");
  await page.fill("#new-username", name);
  await page.selectOption("#new-type", type);
  if (type === "student") await page.selectOption("#new-subject", subject);
  if (subject === "Writing") { await page.selectOption("#new-grade", "4"); await page.check("#new-consent"); }
  await page.click("#create-submit");
  await expect(page.locator("#secret-dialog")).toBeVisible();
  const password = await page.locator("#secret-password").textContent();
  await expect(page.locator("#secret-username")).toHaveText(name);
  await page.click("#secret-dialog [data-close]");
  await expect(page.locator("#secret-dialog")).toBeHidden();
  return password;
}
const row = (page, name) => page.locator("#rows tr", { hasText: name });
async function open(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/admin");
  await expect(page.locator("#whoami")).toContainText("e2e_admin");
  return errors;
}

test("新建账号：只需账号名和类型；初始密码只显示一次；新账号第一次登录必须改密码", async ({ page, playwright, baseURL }) => {
  const errors = await open(page);
  const name = uid("ui");
  const password = await createViaUi(page, name, "student");
  expect(password).toMatch(/^[A-Za-z0-9]{12}$/);
  await expect(page.locator("#secret-password")).toHaveText(""); // 关闭后页面里不再保留密码
  await expect(page.locator("body")).not.toContainText(password);
  await page.fill("#search", name);
  const r = row(page, name);
  await expect(r).toContainText("学生");
  await expect(r).toContainText("正常");
  await expect(r).toContainText("未改初始密码");
  await expect(r).toContainText("学习科目：AP Biology（AP 自学）");

  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  const login = await anon.post("/api/login", { headers: H, data: { username: name, password } });
  expect((await login.json()).redirect).toBe("/change-password");
  await anon.dispose();
  expect(errors).toEqual([]);
});

test("新建账号的校验提示：缺账号名、缺类型、重复账号名（不分大小写）", async ({ page }) => {
  await open(page);
  const name = uid("dup");
  await createViaUi(page, name, "supervisor");

  await page.click("#new-btn");
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("请输入账号名");
  await page.fill("#new-username", "valid_" + uid("n"));
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("请选择账号类型");
  await page.fill("#new-username", name.toUpperCase());
  await page.selectOption("#new-type", "student");
  await page.selectOption("#new-subject", "AP Biology");
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("已经被使用");
  await page.fill("#new-username", "bad name!");
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("2–32");
  await page.keyboard.press("Escape");
  await expect(page.locator("#create-dialog")).toBeHidden();
  await expect(page.locator("#new-btn")).toBeFocused(); // 关闭后焦点回到按钮
});

test("编辑：账号名、类型、学习科目都是只读的（科目建立后不能修改）；只能改时区", async ({ page }) => {
  await open(page);
  const name = uid("stu");
  await createViaUi(page, name, "student");
  await page.fill("#search", name);
  await row(page, name).getByRole("button", { name: "编辑 " + name }).click();
  await expect(page.locator("#edit-dialog")).toBeVisible();
  await expect(page.locator("#edit-username")).toHaveText(name);
  await expect(page.locator("#edit-type")).toHaveText("学生");
  await expect(page.locator("#edit-dialog")).toContainText("AP Biology（AP 自学）");
  await expect(page.locator("#edit-dialog")).toContainText("学习科目建立后不能修改");
  expect(await page.locator("#edit-dialog input, #edit-dialog select, #edit-dialog textarea").count()).toBe(1); // 只有时区
  await expect(page.locator("#edit-subject")).toHaveCount(0);
  await page.click("#edit-submit");
  await expect(page.locator("#edit-dialog")).toBeHidden();
  await expect(row(page, name)).toContainText("学习科目：AP Biology（AP 自学）");
});

test("新建学生必须选学习科目；选写作科目的学生归入写作板块；科目管理可添加和停用", async ({ page }) => {
  await open(page);
  // 科目只在选择“学生”时出现；不选科目不能创建
  await page.click("#new-btn");
  await expect(page.locator("#new-subject-field")).toBeHidden();
  await page.selectOption("#new-type", "student");
  await expect(page.locator("#new-subject-field")).toBeVisible();
  await page.fill("#new-username", uid("nosub"));
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("请为学生选择学习科目");
  await page.selectOption("#new-type", "supervisor");
  await expect(page.locator("#new-subject-field")).toBeHidden();
  await page.click("#create-dialog [data-close]");

  // 写作科目
  const wname = uid("wri");
  await createViaUi(page, wname, "student", "Writing");
  await page.fill("#search", wname);
  await expect(row(page, wname)).toContainText("学习科目：Writing（写作）");

  // 科目管理：添加一个 AP 科目，随后能在新建账号里选到；停用后选不到
  const sname = "AP Test " + uid("m");
  await page.fill("#subject-name", sname);
  await page.selectOption("#subject-direction", "apdemo");
  await page.click("#subject-add");
  await expect(page.locator("#subject-msg")).toContainText("已添加科目");
  await expect(page.locator("#subject-rows tr", { hasText: sname })).toContainText("AP 自学");
  await page.click("#new-btn");
  await page.selectOption("#new-type", "student");
  await expect(page.locator("#new-subject option", { hasText: sname })).toHaveCount(1);
  await page.click("#create-dialog [data-close]");
  await page.getByRole("button", { name: "停用科目 " + sname }).click();
  await expect(page.locator("#subject-rows tr", { hasText: sname })).toContainText("已停用");
  await page.click("#new-btn");
  await page.selectOption("#new-type", "student");
  await expect(page.locator("#new-subject option", { hasText: sname })).toHaveCount(0);
  await page.click("#create-dialog [data-close]");
  // 重复添加
  await page.fill("#subject-name", sname.toUpperCase());
  await page.click("#subject-add");
  await expect(page.locator("#subject-msg")).toContainText("已经有这个科目");
});

test("督导者可多选关联学生；客服可多选关联督导者", async ({ page }) => {
  await open(page);
  const s1 = uid("sa"), s2 = uid("sb"), sup = uid("sup"), cs = uid("cs");
  await createViaUi(page, s1, "student");
  await createViaUi(page, s2, "student");
  await createViaUi(page, sup, "supervisor");
  await createViaUi(page, cs, "support");

  await page.fill("#search", sup);
  await row(page, sup).getByRole("button", { name: "编辑 " + sup }).click();
  await expect(page.locator("#edit-type")).toHaveText("督导者");
  await page.locator("#edit-fields .check", { hasText: s1 }).locator("input").check();
  await page.locator("#edit-fields .check", { hasText: s2 }).locator("input").check();
  await page.click("#edit-submit");
  await expect(page.locator("#edit-dialog")).toBeHidden();
  await expect(row(page, sup)).toContainText("关联学生：" + s1 + "、" + s2);

  // 再改成只剩一个
  await row(page, sup).getByRole("button", { name: "编辑 " + sup }).click();
  await page.locator("#edit-fields .check", { hasText: s1 }).locator("input").uncheck();
  await page.click("#edit-submit");
  await expect(row(page, sup)).toContainText("关联学生：" + s2);
  await expect(row(page, sup)).not.toContainText(s1);

  await page.fill("#search", cs);
  await row(page, cs).getByRole("button", { name: "编辑 " + cs }).click();
  await page.locator("#edit-fields .check", { hasText: sup }).locator("input").check();
  await page.click("#edit-submit");
  await expect(row(page, cs)).toContainText("服务督导者：" + sup);

  // 列表里只出现对应类型：督导者的列表里没有学生以外的账号
  await page.fill("#search", sup);
  await row(page, sup).getByRole("button", { name: "编辑 " + sup }).click();
  await expect(page.locator("#edit-fields .check", { hasText: cs })).toHaveCount(0);
  await expect(page.locator("#edit-fields .check", { hasText: sup })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("停用 → 启用 → 停用 → 彻底删除（删除前必须先停用，并有确认）", async ({ page }) => {
  await open(page);
  const name = uid("life");
  await createViaUi(page, name, "student");
  await page.fill("#search", name);
  const r = row(page, name);
  await expect(r.getByRole("button", { name: "删除 " + name })).toHaveCount(0); // 未停用没有删除按钮

  await r.getByRole("button", { name: "停用 " + name }).click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page.click("#confirm-ok");
  await expect(r).toContainText("已停用");
  await r.getByRole("button", { name: "启用 " + name }).click();
  await expect(r).toContainText("正常");

  await r.getByRole("button", { name: "停用 " + name }).click();
  await page.click("#confirm-ok");
  await expect(r).toContainText("已停用");
  await r.getByRole("button", { name: "删除 " + name }).click();
  await page.click("#confirm-dialog [data-close]"); // 取消
  await expect(r).toBeVisible();
  await r.getByRole("button", { name: "删除 " + name }).click();
  await page.click("#confirm-ok");
  await expect(r).toHaveCount(0);
});

test("重置密码：显示新的初始密码", async ({ page }) => {
  await open(page);
  const name = uid("rst");
  const first = await createViaUi(page, name, "supervisor");
  await page.fill("#search", name);
  await row(page, name).getByRole("button", { name: "重置密码 " + name }).click();
  await page.click("#confirm-ok");
  await expect(page.locator("#secret-dialog")).toBeVisible();
  const second = await page.locator("#secret-password").textContent();
  expect(second).toMatch(/^[A-Za-z0-9]{12}$/);
  expect(second).not.toBe(first);
});

test("按类型筛选与搜索", async ({ page }) => {
  await open(page);
  const stu = uid("fs"), sup = uid("fp");
  await createViaUi(page, stu, "student");
  await createViaUi(page, sup, "supervisor");
  await page.click('.tab[data-filter="supervisor"]');
  await expect(page.locator('.tab[data-filter="supervisor"]')).toHaveAttribute("aria-pressed", "true");
  await page.fill("#search", "f");
  await expect(row(page, sup)).toBeVisible();
  await expect(row(page, stu)).toHaveCount(0);
  await page.click('.tab[data-filter="student"]');
  await expect(row(page, stu)).toBeVisible();
  await page.fill("#search", "zzz_no_such_" + uid("q"));
  await expect(page.locator("#rows .empty")).toContainText("没有符合条件的账号");
  await page.click('.tab[data-filter=""]');
});

test("触控目标 ≥ 44px；axe 无 serious/critical（页面与各对话框）", async ({ page }) => {
  await open(page);
  const name = uid("a11y");
  await createViaUi(page, name, "student");
  await page.fill("#search", name);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href], input, select"))
      .filter((e) => e.offsetParent !== null && !e.closest("dialog:not([open])"))
      .map((e) => { const b = e.getBoundingClientRect(); return { n: e.tagName + "#" + (e.id || e.textContent.trim().slice(0, 8)), w: Math.round(b.width), h: Math.round(b.height) }; })
      .filter((x) => x.h < 44 || x.w < 44 || x.w === 0)
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
  await row(page, name).getByRole("button", { name: "编辑 " + name }).click();
  await check("编辑对话框");
  await page.keyboard.press("Escape");
});

test("窄屏（手机宽度）没有横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw[0]).toBeLessThanOrEqual(sw[1]);
});

test("退出登录后回到登录页，再访问 /admin 需要重新登录", async ({ page }) => {
  // 先用独立的新会话登录，退出时只会结束这一个会话，不影响其他用例共用的管理员登录状态
  const login = await page.request.post("/api/login", { headers: H, data: { username: "e2e_admin", password: PASSWORD } });
  expect(login.status()).toBe(200);
  await open(page);
  await page.click("#logout-btn");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});

test("截图归档：后台列表、新建、编辑对话框（供人工审阅外观）", async ({ page, request }, testInfo) => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "screenshots", "admin" + (testInfo.project.name === "chromium" ? "" : "-" + testInfo.project.name));
  fs.mkdirSync(dir, { recursive: true });
  const mk = async (type, name) => (await (await request.post("/api/admin/accounts", { headers: H, data: { username: name, type, ...(type === "student" ? { subject: "AP Biology" } : {}) } })).json()).account;
  const s1 = await mk("student", uid("demo_student"));
  const s2 = await mk("student", uid("demo_student"));
  const sup = await mk("supervisor", uid("demo_supervisor"));
  await mk("support", uid("demo_support"));
  await request.patch(`/api/admin/accounts/${sup.id}`, { headers: H, data: { studentIds: [s1.id, s2.id] } });
  await page.goto("/admin");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await page.fill("#search", "demo_");
  await page.screenshot({ path: path.join(dir, "admin-list.png") });
  await page.click("#new-btn");
  await page.screenshot({ path: path.join(dir, "admin-create.png") });
  await page.keyboard.press("Escape");
  await row(page, sup.username).getByRole("button", { name: "编辑 " + sup.username }).click();
  await page.screenshot({ path: path.join(dir, "admin-edit.png") });
});

test("新建写作学生：选 Writing 科目后出现年级和监护人同意；缺一不可；列表显示年级；编辑里可改年级", async ({ page }) => {
  await open(page);
  const name = uid("wui");
  await page.click("#new-btn");
  await page.fill("#new-username", name);
  await page.selectOption("#new-type", "student");
  // AP 科目：没有年级和同意
  await expect(page.locator("#new-grade-field")).toBeHidden();
  await page.selectOption("#new-subject", "AP Biology");
  await expect(page.locator("#new-consent-field")).toBeHidden();
  // Writing 科目：出现年级和同意
  await page.selectOption("#new-subject", "Writing");
  await expect(page.locator("#new-grade-field")).toBeVisible();
  await expect(page.locator("#new-consent-field")).toBeVisible();
  await expect(page.locator("#new-grade option")).toHaveCount(15); // “请选择”+ Pre-K、Kindergarten、Grade 1–12
  await expect(page.locator("#new-grade option").nth(1)).toHaveText("Pre-K（学前）");
  await expect(page.locator("#new-grade option").last()).toHaveText("Grade 12");
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("请选择学生的年级");
  await page.selectOption("#new-grade", "5");
  await page.click("#create-submit");
  await expect(page.locator("#create-error")).toContainText("监护人同意");
  await page.check("#new-consent");
  await page.click("#create-submit");
  await expect(page.locator("#secret-dialog")).toBeVisible();
  await page.click("#secret-dialog [data-close]");
  await page.fill("#search", name);
  const r = row(page, name);
  await expect(r).toContainText("学习科目：Writing（写作）");
  await expect(r).toContainText("年级：Grade 5");
  // 编辑：年级可以改，监护人同意只读
  await r.getByRole("button", { name: "编辑 " + name }).click();
  await expect(page.locator("#edit-grade")).toHaveValue("5");
  await expect(page.locator("#edit-dialog")).toContainText("监护人同意：已确认");
  await page.selectOption("#edit-grade", "6");
  await page.click("#edit-submit");
  await expect(page.locator("#edit-dialog")).toBeHidden();
  await expect(r).toContainText("年级：Grade 6");
  // AP 学生的编辑里没有年级
  const ap = uid("apu");
  await createViaUi(page, ap, "student");
  await page.fill("#search", ap);
  await row(page, ap).getByRole("button", { name: "编辑 " + ap }).click();
  await expect(page.locator("#edit-grade")).toHaveCount(0);
});
