// 督导者管理写作学生：写作日程和题目库（每个孩子一份）
const { test, expect } = require("@playwright/test");
const { H, makeUser, linkSupervisor, loginCtx } = require("./helpers");

async function setup(playwright, baseURL) {
  const sup = await makeUser("supervisor", "wsup");
  const stu = await makeUser("student", "wstu", "Writing");
  const ap = await makeUser("student", "wap", "AP Biology");
  linkSupervisor(sup.id, stu.id); linkSupervisor(sup.id, ap.id);
  const ctx = await loginCtx(playwright, baseURL, sup.username);
  return { sup, stu, ap, ctx };
}
const base = (id) => `/api/supervisor/writing/students/${id}`;

test("初始状态：没有日程、题目库为空且提示追加", async ({ playwright, baseURL }) => {
  const { stu, ctx } = await setup(playwright, baseURL);
  const v = await (await ctx.get(base(stu.id))).json();
  expect(v.schedule).toMatchObject({ configured: false, time: "", days: 127, paused: false });
  expect([v.prompts, v.remaining, v.low, v.lowThreshold]).toEqual([[], 0, true, 3]);
  expect(v.student.username).toBe(stu.username);
  await ctx.dispose();
});

test("写作日程：时间、星期位图、暂停；校验；起始日按学生时区；再次保存不改起始日", async ({ playwright, baseURL }) => {
  const { stu, ctx } = await setup(playwright, baseURL);
  const put = (data) => ctx.put(`${base(stu.id)}/schedule`, { headers: H, data });
  for (const bad of [{}, { time: "25:00", days: 127, paused: false }, { time: "9:00", days: 127, paused: false }, { time: "16:30", days: 0, paused: false }, { time: "16:30", days: 128, paused: false }, { time: "16:30", days: 1.5, paused: false }, { time: "16:30", days: 127, paused: "no" }]) {
    expect((await put(bad)).status(), JSON.stringify(bad)).toBe(422);
  }
  let r = await put({ time: "16:30", days: 31, paused: false });
  expect(r.status()).toBe(200);
  const s1 = (await r.json()).schedule;
  expect(s1).toMatchObject({ configured: true, time: "16:30", days: 31, paused: false });
  expect(s1.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  r = await put({ time: "07:05", days: 127, paused: true });
  const s2 = (await r.json()).schedule;
  expect([s2.time, s2.days, s2.paused, s2.startDate]).toEqual(["07:05", 127, true, s1.startDate]);
  await ctx.dispose();
});

test("题目库：添加、修改、删除；剩余数量和“少于 3 个”提醒；重复题目；长度校验", async ({ playwright, baseURL }) => {
  const { stu, ctx } = await setup(playwright, baseURL);
  const add = (data) => ctx.post(`${base(stu.id)}/prompts`, { headers: H, data });
  for (const bad of [{}, { title: "" }, { title: "  " }, { title: 5 }, { title: "x".repeat(121) }, { title: "ok", hint: "y".repeat(301) }, { title: "ok", hint: 5 }]) expect((await add(bad)).status(), JSON.stringify(bad)).toBe(422);
  let v = await (await add({ title: "My best day", hint: "Who, where, why?" })).json();
  expect([v.remaining, v.low]).toEqual([1, true]);
  expect(v.prompts[0]).toMatchObject({ title: "My best day", hint: "Who, where, why?", used: false });
  expect((await add({ title: "my BEST day" })).status()).toBe(409); // 不分大小写重复
  await add({ title: "A trip I remember" });
  v = await (await add({ title: "My pet" })).json();
  expect([v.remaining, v.low]).toEqual([3, false]);
  const id = v.prompts.find((p) => p.title === "My pet").id;
  // 修改
  let r = await ctx.patch(`/api/supervisor/writing/prompts/${id}`, { headers: H, data: { title: "My favorite pet", hint: "" } });
  expect(r.status()).toBe(200);
  expect((await r.json()).prompts.find((p) => p.id === id)).toMatchObject({ title: "My favorite pet", hint: "" });
  expect((await ctx.patch(`/api/supervisor/writing/prompts/${id}`, { headers: H, data: {} })).status()).toBe(400);
  expect((await ctx.patch(`/api/supervisor/writing/prompts/${id}`, { headers: H, data: { title: "" } })).status()).toBe(422);
  // 删除
  v = await (await ctx.delete(`/api/supervisor/writing/prompts/${id}`, { headers: H })).json();
  expect([v.remaining, v.low]).toEqual([2, true]);
  // 已被孩子写过的题目：保留历史，不能修改或删除，也不算“剩余”
  const { db } = require("../server/db");
  const used = v.prompts[0].id;
  db.prepare("UPDATE writing_prompts SET used_at = ? WHERE id = ?").run(new Date().toISOString(), used);
  for (const [method, data] of [["patch", { title: "new" }], ["delete", undefined]]) {
    const x = await ctx[method](`/api/supervisor/writing/prompts/${used}`, { headers: H, data });
    expect([x.status(), (await x.json()).error], method).toEqual([409, "PROMPT_USED"]);
  }
  v = await (await ctx.get(base(stu.id))).json();
  expect([v.remaining, v.prompts.at(-1).used]).toEqual([1, true]); // 已用的排在后面
  await ctx.dispose();
});

test("权限：只能管理自己关联的写作学生；AP 学生、别人的学生、非督导者都不行；未选的学生互不影响", async ({ playwright, baseURL }) => {
  const { stu, ap, ctx } = await setup(playwright, baseURL);
  const other = await makeUser("supervisor", "wother");
  const octx = await loginCtx(playwright, baseURL, other.username);
  // AP 学生不是写作学生
  let r = await ctx.get(base(ap.id));
  expect([r.status(), (await r.json()).error]).toEqual([422, "NOT_WRITING"]);
  expect((await ctx.put(`${base(ap.id)}/schedule`, { headers: H, data: { time: "16:00", days: 1, paused: false } })).status()).toBe(422);
  expect((await ctx.post(`${base(ap.id)}/prompts`, { headers: H, data: { title: "x" } })).status()).toBe(422);
  // 别的督导者看不到
  for (const [m, p, data] of [["get", base(stu.id)], ["put", `${base(stu.id)}/schedule`, { time: "16:00", days: 1, paused: false }], ["post", `${base(stu.id)}/prompts`, { title: "x" }]]) {
    const x = await octx[m](p, { headers: H, data });
    expect(x.status(), m + " " + p).toBe(404);
  }
  const mine = await (await ctx.post(`${base(stu.id)}/prompts`, { headers: H, data: { title: "Mine" } })).json();
  const pid = mine.prompts[0].id;
  expect((await octx.patch(`/api/supervisor/writing/prompts/${pid}`, { headers: H, data: { title: "hacked" } })).status()).toBe(404);
  expect((await octx.delete(`/api/supervisor/writing/prompts/${pid}`, { headers: H })).status()).toBe(404);
  expect((await octx.get(base(999999))).status()).toBe(404);
  // 学生、管理员不能用督导者接口
  const w = await loginCtx(playwright, baseURL, stu.username);
  expect((await w.get(base(stu.id))).status()).toBe(403);
  // 学生列表里带上“剩余题目”提示
  const list = (await (await ctx.get("/api/supervisor/students")).json()).students;
  expect(list.find((s) => s.id === stu.id)).toMatchObject({ direction: "writing", promptsLeft: 1, lowPrompts: 3 });
  expect(list.find((s) => s.id === ap.id).promptsLeft).toBeNull();
  await ctx.dispose(); await octx.dispose(); await w.dispose();
});

test("每个孩子一份题目库：同一督导者的两个写作学生互不影响；删除账号时一并删除", async ({ playwright, baseURL }) => {
  const { sup, stu, ctx } = await setup(playwright, baseURL);
  const stu2 = await makeUser("student", "wstu2", "Writing");
  linkSupervisor(sup.id, stu2.id);
  await ctx.post(`${base(stu.id)}/prompts`, { headers: H, data: { title: "Shared title" } });
  await ctx.post(`${base(stu2.id)}/prompts`, { headers: H, data: { title: "Shared title" } }); // 另一个孩子可以有同名题目
  expect((await (await ctx.get(base(stu.id))).json()).remaining).toBe(1);
  expect((await (await ctx.get(base(stu2.id))).json()).remaining).toBe(1);
  const { db } = require("../server/db");
  db.prepare("DELETE FROM accounts WHERE id = ?").run(stu2.id);
  expect(db.prepare("SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ?").get(stu2.id).n).toBe(0);
  expect(db.prepare("SELECT COUNT(*) AS n FROM writing_prompts WHERE student_id = ?").get(stu.id).n).toBe(1);
  await ctx.dispose();
});
