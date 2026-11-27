// 登录与权限：未登录不能访问任何页面；各角色进入各自页面
const { test, expect } = require("@playwright/test");
const { state, ANON, PASSWORD, H, uid } = require("./helpers");

test.describe("未登录", () => {
  test.use({ storageState: ANON });

  for (const p of ["/", "/index.html", "/admin", "/supervisor", "/pending", "/change-password", "/data/sites.json", "/assets/js/app.js", "/assets/js/admin.js"]) {
    test(`未登录访问 ${p} 被拒绝或跳转登录`, async ({ request }) => {
      const res = await request.get(p, { maxRedirects: 0 });
      if (p.startsWith("/assets/") || p.startsWith("/data/")) expect(res.status()).toBe(401);
      else {
        expect(res.status()).toBe(302);
        expect(res.headers()["location"]).toBe("/login");
      }
    });
  }

  test("未登录访问 API 返回 401", async ({ request }) => {
    for (const p of ["/api/me", "/api/admin/accounts"]) expect((await request.get(p)).status()).toBe(401);
  });

  test("登录页与它的资源可以访问；服务器源码、数据库不可访问", async ({ request }) => {
    expect((await request.get("/login")).status()).toBe(200);
    expect((await request.get("/assets/css/auth.css")).status()).toBe(200);
    expect((await request.get("/assets/js/login.js")).status()).toBe(200);
    for (const p of ["/server/index.js", "/var/apdemo.db", "/package.json", "/tests/auth.spec.js", "/.git/config", "/pages/admin.html"]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect([302, 401, 404], p).toContain(res.status());
    }
  });

  test("登录失败：错误信息不区分账号是否存在", async ({ request }) => {
    const a = await request.post("/api/login", { headers: H, data: { username: "e2e_student", password: "wrong-password" } });
    const b = await request.post("/api/login", { headers: H, data: { username: "no_such_user_" + uid("x"), password: "wrong-password" } });
    expect(a.status()).toBe(401);
    expect(b.status()).toBe(401);
    expect((await a.json()).message).toBe((await b.json()).message);
  });

  test("连续输错密码后临时锁定，且锁定只针对该账号", async ({ request }) => {
    const name = uid("lock");
    // 用一个不存在的账号名也会被限流（不泄露账号是否存在）
    let last;
    for (let i = 0; i < 6; i++) last = await request.post("/api/login", { headers: H, data: { username: name, password: "bad-password-" + i } });
    expect(last.status()).toBe(429);
    const ok = await request.post("/api/login", { headers: H, data: { username: "e2e_student", password: PASSWORD } });
    expect(ok.status()).toBe(200);
  });

  test("登录页界面：用账号名和密码登录后进入学生页", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.fill("#username", "e2e_student");
    await page.fill("#password", PASSWORD);
    await page.click("#submit");
    await expect(page).toHaveURL(/\/apdemo$/);
    await expect(page.locator("#mod-progress")).toBeVisible();
  });

  test("登录页：错误密码显示错误提示", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#username", "e2e_student");
    await page.fill("#password", "wrong-password");
    await page.click("#submit");
    await expect(page.locator("#error")).toContainText("账号或密码错误");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("跨站写请求被拒绝（Origin 不一致 / 缺少标识头）", async ({ request }) => {
    const r1 = await request.post("/api/login", { headers: { ...H, Origin: "https://evil.example" }, data: { username: "e2e_student", password: PASSWORD } });
    expect(r1.status()).toBe(403);
    const r2 = await request.post("/api/login", { data: { username: "e2e_student", password: PASSWORD } });
    expect(r2.status()).toBe(403);
  });
});

test.describe("各角色进入各自页面", () => {
  const cases = [
    ["student", "/apdemo", "/admin"],
    ["supervisor", "/supervisor", "/apdemo"],
    ["admin", "/admin", "/apdemo"],
    ["support", "/pending", "/admin"]
  ];
  for (const [role, home, forbidden] of cases) {
    test.describe(role, () => {
      test.use({ storageState: state(role) });
      test(`${role}：自己的页面可访问，别人的页面跳回自己的页面`, async ({ request }) => {
        expect((await request.get(home, { maxRedirects: 0 })).status()).toBe(200);
        const res = await request.get(forbidden, { maxRedirects: 0 });
        expect(res.status()).toBe(302);
        expect(res.headers()["location"]).toBe(home);
      });
      test(`${role}：访问登录页会跳到自己的页面`, async ({ request }) => {
        const res = await request.get("/login", { maxRedirects: 0 });
        expect(res.status()).toBe(302);
        expect(res.headers()["location"]).toBe(home);
      });
    });
  }

  test.describe("非管理员不能用管理接口、不能取后台脚本", () => {
    test.use({ storageState: state("student") });
    test("学生访问管理接口 403", async ({ request }) => {
      expect((await request.get("/api/admin/accounts")).status()).toBe(403);
      expect((await request.get("/assets/js/admin.js")).status()).toBe(403);
    });
  });
});

test.describe("首次登录必须改密码", () => {
  test.use({ storageState: ANON });

  test("初始密码登录后只能去修改密码页，改完后进入自己的页面", async ({ request }) => {
    const { db } = require("../server/db");
    const auth = require("../server/auth");
    const name = uid("first");
    const temp = "Temp-Passw0rd";
    db.prepare("INSERT INTO accounts (username, username_key, type, password_hash, must_change_password, created_at) VALUES (?, ?, 'student', ?, 1, ?)")
      .run(name, name.toLowerCase(), await auth.hashPassword(temp), new Date().toISOString());

    const login = await request.post("/api/login", { headers: H, data: { username: name, password: temp } });
    expect(login.status()).toBe(200);
    const info = await login.json();
    expect(info.mustChangePassword).toBe(true);
    expect(info.redirect).toBe("/change-password");

    // 改密码之前：其他页面和接口都被挡住
    const home = await request.get("/", { maxRedirects: 0 });
    expect(home.status()).toBe(302);
    expect(home.headers()["location"]).toBe("/change-password");
    expect((await request.get("/data/sites.json", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get("/api/admin/accounts")).status()).toBe(403);

    // 弱密码、同密码、旧密码错误
    expect((await request.post("/api/change-password", { headers: H, data: { oldPassword: temp, newPassword: "short" } })).status()).toBe(422);
    expect((await request.post("/api/change-password", { headers: H, data: { oldPassword: temp, newPassword: temp } })).status()).toBe(422);
    expect((await request.post("/api/change-password", { headers: H, data: { oldPassword: "nope-nope-nope", newPassword: "A-new-passw0rd" } })).status()).toBe(403);

    const ok = await request.post("/api/change-password", { headers: H, data: { oldPassword: temp, newPassword: "A-new-passw0rd" } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).redirect).toBe("/apdemo");
    expect((await request.get("/apdemo", { maxRedirects: 0 })).status()).toBe(200);

    // 旧密码不能再登录，新密码可以
    const again = await request.post("/api/login", { headers: H, data: { username: name, password: temp } });
    expect(again.status()).toBe(401);
    const fresh = await request.post("/api/login", { headers: H, data: { username: name, password: "A-new-passw0rd" } });
    expect((await fresh.json()).mustChangePassword).toBe(false);
  });
});

test.describe("退出登录与会话", () => {
  test.use({ storageState: ANON });
  test("退出后会话失效；会话 cookie 带 HttpOnly 和 SameSite", async ({ request }) => {
    const login = await request.post("/api/login", { headers: H, data: { username: "e2e_student", password: PASSWORD } });
    const cookie = login.headers()["set-cookie"];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect((await request.get("/api/me")).status()).toBe(200);
    expect((await request.post("/api/logout", { headers: H })).status()).toBe(200);
    expect((await request.get("/api/me")).status()).toBe(401);
  });
});
