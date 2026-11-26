// 管理员账号管理接口
const { test, expect } = require("@playwright/test");
const { state, ANON, PASSWORD, H, uid } = require("./helpers");

test.use({ storageState: state("admin") });

async function create(request, type, name) {
  const username = name || uid(type.slice(0, 3));
  const res = await request.post("/api/admin/accounts", { headers: H, data: { username, type } });
  expect(res.status(), await res.text()).toBe(201);
  return { ...(await res.json()), username };
}
const patch = (request, id, data) => request.patch(`/api/admin/accounts/${id}`, { headers: H, data });

test("新建三种账号：返回一次性初始密码，列表里看不到密码", async ({ request }) => {
  for (const type of ["student", "supervisor", "support"]) {
    const r = await create(request, type);
    expect(r.account.type).toBe(type);
    expect(r.account.mustChangePassword).toBe(true);
    expect(r.initialPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    const list = await (await request.get("/api/admin/accounts")).json();
    const text = JSON.stringify(list);
    expect(text).not.toContain(r.initialPassword);
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("scrypt$");
  }
});

test("账号名校验与不分大小写的唯一性；类型必须是三种之一", async ({ request }) => {
  const name = uid("dup");
  await create(request, "student", name);
  const same = await request.post("/api/admin/accounts", { headers: H, data: { username: name.toUpperCase(), type: "student" } });
  expect(same.status()).toBe(409);
  for (const bad of ["a", "有 空格", "x".repeat(33), "<b>x</b>", "a/b"]) {
    const r = await request.post("/api/admin/accounts", { headers: H, data: { username: bad, type: "student" } });
    expect(r.status(), bad).toBe(422);
  }
  for (const type of ["admin", "parent", "", undefined]) {
    const r = await request.post("/api/admin/accounts", { headers: H, data: { username: uid("t"), type } });
    expect(r.status(), String(type)).toBe(422);
  }
});

test("账号名和类型创建后不能修改", async ({ request }) => {
  const { account } = await create(request, "student");
  for (const data of [{ username: "renamed_" + uid("x") }, { type: "supervisor" }, { username: "x1234", subject: "AP Biology" }]) {
    const r = await patch(request, account.id, data);
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBe("FIELD_NOT_EDITABLE");
  }
  const list = (await (await request.get("/api/admin/accounts")).json()).accounts;
  const same = list.find((a) => a.id === account.id);
  expect(same.username).toBe(account.username);
  expect(same.type).toBe("student");
});

test("学生：设置/修改/清空学习科目（允许为空）", async ({ request }) => {
  const { account } = await create(request, "student");
  expect(account.subject).toBe("");
  let r = await patch(request, account.id, { subject: "  AP   Biology " });
  expect((await r.json()).account.subject).toBe("AP Biology");
  r = await patch(request, account.id, { subject: "AP Chemistry" });
  expect((await r.json()).account.subject).toBe("AP Chemistry");
  r = await patch(request, account.id, { subject: "" });
  expect((await r.json()).account.subject).toBe("");
  r = await patch(request, account.id, { subject: null });
  expect(r.status()).toBe(200);
  r = await patch(request, account.id, { subject: "x".repeat(65) });
  expect(r.status()).toBe(422);
  r = await patch(request, account.id, { subject: 123 });
  expect(r.status()).toBe(422);
  r = await patch(request, account.id, { studentIds: [] }); // 学生不能设置别的字段
  expect(r.status()).toBe(400);
});

test("督导者：关联多个学生，可修改、可清空；只能关联学生", async ({ request }) => {
  const s1 = (await create(request, "student")).account;
  const s2 = (await create(request, "student")).account;
  const s3 = (await create(request, "student")).account;
  const sup = (await create(request, "supervisor")).account;
  expect(sup.studentIds).toEqual([]);

  let r = await patch(request, sup.id, { studentIds: [s1.id, s2.id, s2.id] });
  expect((await r.json()).account.studentIds.sort()).toEqual([s1.id, s2.id].sort());
  r = await patch(request, sup.id, { studentIds: [s3.id] });
  expect((await r.json()).account.studentIds).toEqual([s3.id]);

  const other = (await create(request, "supervisor")).account;
  expect((await patch(request, sup.id, { studentIds: [other.id] })).status()).toBe(422); // 不是学生
  expect((await patch(request, sup.id, { studentIds: [999999] })).status()).toBe(422);
  expect((await patch(request, sup.id, { studentIds: "1" })).status()).toBe(422);
  expect((await patch(request, sup.id, { subject: "AP Biology" })).status()).toBe(400);

  r = await patch(request, sup.id, { studentIds: [] });
  expect((await r.json()).account.studentIds).toEqual([]);
});

test("一个学生可以被多个督导者关联", async ({ request }) => {
  const s = (await create(request, "student")).account;
  const a = (await create(request, "supervisor")).account;
  const b = (await create(request, "supervisor")).account;
  await patch(request, a.id, { studentIds: [s.id] });
  await patch(request, b.id, { studentIds: [s.id] });
  const list = (await (await request.get("/api/admin/accounts")).json()).accounts;
  expect(list.find((x) => x.id === a.id).studentIds).toEqual([s.id]);
  expect(list.find((x) => x.id === b.id).studentIds).toEqual([s.id]);
});

test("客服：关联多个督导者；只能关联督导者", async ({ request }) => {
  const sup1 = (await create(request, "supervisor")).account;
  const sup2 = (await create(request, "supervisor")).account;
  const stu = (await create(request, "student")).account;
  const cs = (await create(request, "support")).account;
  expect(cs.supervisorIds).toEqual([]);
  let r = await patch(request, cs.id, { supervisorIds: [sup1.id, sup2.id] });
  expect((await r.json()).account.supervisorIds.sort()).toEqual([sup1.id, sup2.id].sort());
  expect((await patch(request, cs.id, { supervisorIds: [stu.id] })).status()).toBe(422);
  expect((await patch(request, cs.id, { studentIds: [stu.id] })).status()).toBe(400);
  r = await patch(request, cs.id, { supervisorIds: [sup2.id] });
  expect((await r.json()).account.supervisorIds).toEqual([sup2.id]);
});

test("停用后不能登录、会话失效；启用后可再登录；删除必须先停用，并清除关联", async ({ request, playwright, baseURL }) => {
  const stu = (await create(request, "student")).account;
  const sup = (await create(request, "supervisor")).account;
  const cs = (await create(request, "support")).account;
  await patch(request, sup.id, { studentIds: [stu.id] });
  await patch(request, cs.id, { supervisorIds: [sup.id] });

  // 给学生一个可用密码并登录，拿到会话
  const reset = await (await request.post(`/api/admin/accounts/${stu.id}/reset-password`, { headers: H })).json();
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  const login = await anon.post("/api/login", { headers: H, data: { username: stu.username, password: reset.initialPassword } });
  expect(login.status()).toBe(200);
  expect((await anon.get("/api/me")).status()).toBe(200);

  expect((await request.delete(`/api/admin/accounts/${stu.id}`, { headers: H })).status()).toBe(409); // 未停用不能删
  const off = await request.post(`/api/admin/accounts/${stu.id}/disable`, { headers: H });
  expect((await off.json()).account.disabled).toBe(true);
  expect((await anon.get("/api/me")).status()).toBe(401);
  const denied = await anon.post("/api/login", { headers: H, data: { username: stu.username, password: reset.initialPassword } });
  expect(denied.status()).toBe(401);
  expect((await denied.json()).message).toBe("账号或密码错误。");

  const on = await request.post(`/api/admin/accounts/${stu.id}/enable`, { headers: H });
  expect((await on.json()).account.disabled).toBe(false);
  expect((await anon.post("/api/login", { headers: H, data: { username: stu.username, password: reset.initialPassword } })).status()).toBe(200);

  await request.post(`/api/admin/accounts/${stu.id}/disable`, { headers: H });
  expect((await request.delete(`/api/admin/accounts/${stu.id}`, { headers: H })).status()).toBe(200);
  const list = (await (await request.get("/api/admin/accounts")).json()).accounts;
  expect(list.find((a) => a.id === stu.id)).toBeUndefined();
  expect(list.find((a) => a.id === sup.id).studentIds).toEqual([]); // 关联已清除

  // 删除督导者后，客服的关联也被清除
  await request.post(`/api/admin/accounts/${sup.id}/disable`, { headers: H });
  expect((await request.delete(`/api/admin/accounts/${sup.id}`, { headers: H })).status()).toBe(200);
  const list2 = (await (await request.get("/api/admin/accounts")).json()).accounts;
  expect(list2.find((a) => a.id === cs.id).supervisorIds).toEqual([]);
  await anon.dispose();
});

test("重置密码：生成新的初始密码，旧密码失效，需重新改密码", async ({ request, playwright, baseURL }) => {
  const { account, initialPassword } = await create(request, "student");
  const r = await (await request.post(`/api/admin/accounts/${account.id}/reset-password`, { headers: H })).json();
  expect(r.initialPassword).not.toBe(initialPassword);
  expect(r.account.mustChangePassword).toBe(true);
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  expect((await anon.post("/api/login", { headers: H, data: { username: account.username, password: initialPassword } })).status()).toBe(401);
  const ok = await anon.post("/api/login", { headers: H, data: { username: account.username, password: r.initialPassword } });
  expect((await ok.json()).redirect).toBe("/change-password");
  await anon.dispose();
});

test("管理员账号看不到、改不了、删不了；不存在的账号 404", async ({ request }) => {
  const list = (await (await request.get("/api/admin/accounts")).json()).accounts;
  expect(list.every((a) => ["student", "supervisor", "support"].includes(a.type))).toBe(true);
  expect(list.find((a) => a.username === "e2e_admin")).toBeUndefined();
  const { db } = require("../server/db");
  const adminId = db.prepare("SELECT id FROM accounts WHERE username_key = 'e2e_admin'").get().id;
  for (const call of [
    () => request.delete(`/api/admin/accounts/${adminId}`, { headers: H }),
    () => request.post(`/api/admin/accounts/${adminId}/disable`, { headers: H }),
    () => request.post(`/api/admin/accounts/${adminId}/reset-password`, { headers: H }),
    () => patch(request, adminId, { subject: "x" }),
    () => request.delete("/api/admin/accounts/99999999", { headers: H }),
    () => request.delete("/api/admin/accounts/abc", { headers: H })
  ]) expect((await call()).status()).toBe(404);
});

test("非管理员（学生/督导者/客服）都不能调用管理接口", async ({ playwright, baseURL }) => {
  for (const role of ["student", "supervisor", "support"]) {
    const ctx = await playwright.request.newContext({ baseURL, storageState: state(role) });
    expect((await ctx.get("/api/admin/accounts")).status(), role).toBe(403);
    expect((await ctx.post("/api/admin/accounts", { headers: H, data: { username: uid("hack"), type: "student" } })).status(), role).toBe(403);
    await ctx.dispose();
  }
});

test("管理操作写入审计日志，日志里没有密码", async ({ request }) => {
  const { account, initialPassword } = await create(request, "student");
  await request.post(`/api/admin/accounts/${account.id}/disable`, { headers: H });
  const { db } = require("../server/db");
  const rows = db.prepare("SELECT action, target_name, detail FROM audit_log WHERE target_name = ?").all(account.username);
  expect(rows.map((r) => r.action)).toEqual(["create_account", "disable_account"]);
  expect(JSON.stringify(rows)).not.toContain(initialPassword);
});
