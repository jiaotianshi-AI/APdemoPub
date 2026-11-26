// 学生测试流程接口：看不到题目 → 确认提前 → 开始计时 → 保存答案 → 提交 / 到时自动提交 → 离开页面记录
const { test, expect } = require("@playwright/test");
const { H, uid, makeUser, linkSupervisor, loginCtx, uploadPdf, state, ANON } = require("./helpers");

const WALL = "2031-03-15T15:00";

async function scenario(playwright, baseURL, { questions = 2, duration, wall } = {}) {
  const sup = await makeUser("supervisor", "sup");
  const stu = await makeUser("student", "stu");
  linkSupervisor(sup.id, stu.id);
  const sctx = await loginCtx(playwright, baseURL, sup.username);
  const tctx = await loginCtx(playwright, baseURL, stu.username);
  const qs = [];
  for (let i = 1; i <= questions; i++) qs.push(await uploadPdf(sctx, `题${i}.pdf`, `question-${i}-secret`));
  const res = await sctx.post("/api/supervisor/assessments", {
    headers: H,
    data: { studentIds: [stu.id], scheduledWall: wall || WALL, subject: "AP Biology", unit: "Unit 2", unitStartDate: "2031-03-01", questionFileIds: qs.map((q) => q.id), ...(duration ? { durationMinutes: duration } : {}) }
  });
  expect(res.status(), await res.text()).toBe(201);
  const asm = (await res.json()).assessments[0];
  return { sup, stu, sctx, tctx, qs, asm };
}
const start = (ctx, id, data) => ctx.post(`/api/student/assessments/${id}/start`, { headers: H, data });
const startOk = async (ctx, id, method = "typed") => {
  const res = await start(ctx, id, { method, confirmEarly: true });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
};
const save = (ctx, id, fileId, text) => ctx.put(`/api/student/assessments/${id}/answers/${fileId}`, { headers: H, data: { text } });
const submit = (ctx, id) => ctx.post(`/api/student/assessments/${id}/submit`, { headers: H, data: {} });
const supView = async (sctx, id) => (await (await sctx.get(`/api/supervisor/assessments/${id}/attempt`)).json());

test("开始之前：学生能看到测试安排，但看不到题目；打不开题目文件；默认时长 60 分钟", async ({ playwright, baseURL }) => {
  const { tctx, qs, asm } = await scenario(playwright, baseURL);
  expect(asm.durationMinutes).toBe(60);
  const list = (await (await tctx.get("/api/student/assessments")).json()).assessments;
  expect(list).toHaveLength(1);
  const item = list[0];
  expect([item.status, item.subject, item.unit, item.durationMinutes, item.scheduledWall]).toEqual(["scheduled", "AP Biology", "Unit 2", 60, WALL]);
  expect(item.questionFiles).toBeUndefined();
  expect(item.answerFiles).toBeUndefined();
  expect(JSON.stringify(list)).not.toContain("题1");
  const d = await (await tctx.get(`/api/student/assessments/${asm.id}`)).json();
  expect(d.questions).toBeNull();
  expect(d.attempt).toBeNull();
  expect(JSON.stringify(d)).not.toContain("题1");
  for (const q of qs) expect((await tctx.get(`/api/student/files/${q.id}`)).status()).toBe(404);
  // 学生没有任何修改测试的入口
  expect((await tctx.patch(`/api/student/assessments/${asm.id}`, { headers: H, data: { subject: "x" } })).status()).toBe(404);
  expect((await tctx.delete(`/api/student/assessments/${asm.id}`, { headers: H })).status()).toBe(404);
  expect((await tctx.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data: { subject: "x" } })).status()).toBe(403);
  await tctx.dispose();
});

test("提前开始需要确认；必须选择提交方式；开始后计时并显示题目", async ({ playwright, baseURL }) => {
  const { tctx, qs, asm } = await scenario(playwright, baseURL, { duration: 45 });
  expect((await start(tctx, asm.id, {})).status()).toBe(422);
  expect((await start(tctx, asm.id, { method: "voice" })).status()).toBe(422);
  const early = await start(tctx, asm.id, { method: "typed" });
  expect(early.status()).toBe(409);
  const body = await early.json();
  expect(body.error).toBe("EARLY_NOT_CONFIRMED");
  expect(body.secondsEarly).toBeGreaterThan(86400);

  const before = Date.now();
  const d = await startOk(tctx, asm.id, "typed");
  expect(d.assessment.status).toBe("in_progress");
  expect(d.attempt.method).toBe("typed");
  expect(d.attempt.early).toBe(true);
  const dl = Date.parse(d.attempt.deadlineAt) - Date.parse(d.attempt.startedAt);
  expect(dl).toBe(45 * 60000);
  expect(Math.abs(Date.parse(d.attempt.startedAt) - before)).toBeLessThan(10000);
  expect(d.questions.map((q) => [q.no, q.name])).toEqual([[1, "题1.pdf"], [2, "题2.pdf"]]);
  for (const q of qs) {
    const f = await tctx.get(`/api/student/files/${q.id}`);
    expect(f.status()).toBe(200);
    expect(f.headers()["content-type"]).toBe("application/pdf");
    expect(f.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  }
  // 再次开始：已经开始
  expect((await start(tctx, asm.id, { method: "typed", confirmEarly: true })).status()).toBe(409);
  await tctx.dispose();
});

test("同一个学生同一时间只能有一场测试在进行；别人的测试开不了", async ({ playwright, baseURL }) => {
  const a = await scenario(playwright, baseURL);
  const second = await a.sctx.post("/api/supervisor/assessments", { headers: H, data: { studentIds: [a.stu.id], scheduledWall: "2031-04-15T15:00", subject: "AP Biology", unit: "Unit 3", unitStartDate: "2031-04-01", questionFileIds: [a.qs[0].id] } });
  const asm2 = (await second.json()).assessments[0];
  await startOk(a.tctx, a.asm.id);
  const r = await start(a.tctx, asm2.id, { method: "typed", confirmEarly: true });
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toBe("ANOTHER_IN_PROGRESS");
  const b = await scenario(playwright, baseURL);
  expect((await start(b.tctx, a.asm.id, { method: "typed", confirmEarly: true })).status()).toBe(404);
  expect((await b.tctx.get(`/api/student/assessments/${a.asm.id}`)).status()).toBe(404);
  expect((await b.tctx.get(`/api/student/files/${a.qs[0].id}`)).status()).toBe(404);
  await a.tctx.dispose(); await b.tctx.dispose();
});

test("到了预定时间可以不经确认直接开始（不算提前）", async ({ playwright, baseURL }) => {
  const { tctx, asm } = await scenario(playwright, baseURL);
  const { db } = require("../server/db");
  db.prepare("UPDATE assessments SET scheduled_at = ? WHERE id = ?").run(new Date(Date.now() - 60000).toISOString(), asm.id); // 假装预定时间是一分钟前
  const res = await start(tctx, asm.id, { method: "paper" });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).attempt.early).toBe(false);
  await tctx.dispose();
});

test("打字作答：自动保存、覆盖、校验；纸质作答不能输入答案", async ({ playwright, baseURL }) => {
  const { tctx, sctx, qs, asm } = await scenario(playwright, baseURL);
  await startOk(tctx, asm.id, "typed");
  expect((await save(tctx, asm.id, qs[0].id, "第一版答案")).status()).toBe(200);
  expect((await save(tctx, asm.id, qs[0].id, "第二版答案\n含换行")).status()).toBe(200);
  expect((await save(tctx, asm.id, qs[1].id, "")).status()).toBe(200);
  expect((await save(tctx, asm.id, 99999999, "x")).status()).toBe(404);
  expect((await tctx.put(`/api/student/assessments/${asm.id}/answers/${qs[0].id}`, { headers: H, data: { text: 123 } })).status()).toBe(422);
  expect((await save(tctx, asm.id, qs[0].id, "x".repeat(20001))).status()).toBe(422);
  const d = await (await tctx.get(`/api/student/assessments/${asm.id}`)).json();
  expect(d.answers[qs[0].id]).toBe("第二版答案\n含换行");
  const v = await supView(sctx, asm.id);
  expect(v.questions.map((q) => q.answer)).toEqual(["第二版答案\n含换行", ""]);
  await tctx.dispose();

  const p = await scenario(playwright, baseURL);
  await startOk(p.tctx, p.asm.id, "paper");
  const r = await save(p.tctx, p.asm.id, p.qs[0].id, "不应该保存");
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toBe("METHOD_PAPER");
  await p.tctx.dispose();
});

test("提交：状态变为已提交；不能再改；学生能看到题目和自己的答案；分数评分前不显示", async ({ playwright, baseURL }) => {
  const { tctx, sctx, qs, asm } = await scenario(playwright, baseURL);
  await startOk(tctx, asm.id, "typed");
  await save(tctx, asm.id, qs[0].id, "我的答案一");
  const done = await submit(tctx, asm.id);
  expect(done.status()).toBe(200);
  const d = await done.json();
  expect(d.assessment.status).toBe("submitted");
  expect(d.attempt.submittedAt).toBeTruthy();
  expect(d.attempt.autoSubmitted).toBe(false);
  expect(d.assessment.score).toBeNull();
  expect(d.answers[qs[0].id]).toBe("我的答案一");

  const again = await submit(tctx, asm.id); // 重复提交没有影响
  expect((await again.json()).attempt.submittedAt).toBe(d.attempt.submittedAt);
  expect((await save(tctx, asm.id, qs[0].id, "提交后改答案")).status()).toBe(409);
  const list = (await (await tctx.get("/api/student/assessments")).json()).assessments[0];
  expect(list.status).toBe("submitted");
  expect(list.questionFiles.map((q) => q.name)).toEqual(["题1.pdf", "题2.pdf"]);
  expect((await tctx.get(`/api/student/files/${qs[0].id}`)).status()).toBe(200);

  // 督导者给每道题上传回答 PDF 并评分；没评完之前学生看不到任何分数，评完（已评分）后才看到每题评分和汇总评分
  const scan1 = await uploadPdfAs(sctx, "Q1回答.pdf");
  const part = await sctx.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data: { questions: [{ questionFileId: qs[0].id, answerFileId: scan1.id, score: 5 }] } });
  expect((await part.json()).assessment.status).toBe("submitted"); // 只评了一题
  let mid = (await (await tctx.get("/api/student/assessments")).json()).assessments[0];
  expect([mid.status, mid.score]).toEqual(["submitted", null]);
  expect(mid.questionFiles.map((q) => q.score)).toEqual([null, null]); // 评分还不可见
  expect(mid.questionFiles[0].answerFile.name).toBe("Q1回答.pdf"); // 回答 PDF 提交后即可见
  expect((await tctx.get(`/api/student/files/${scan1.id}`)).status()).toBe(200);

  const graded = await sctx.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data: { questions: [{ questionFileId: qs[1].id, score: 4 }] } });
  expect((await graded.json()).assessment.status).toBe("graded"); // (5+4)/2 = 4.5 → 5
  const after = (await (await tctx.get("/api/student/assessments")).json()).assessments[0];
  expect([after.status, after.score]).toEqual(["graded", 5]);
  expect(after.questionFiles.map((q) => [q.label, q.score])).toEqual([["Q1", 5], ["Q2", 4]]);
  expect(after.questionFiles[1].answerFile).toBeNull();
  const d2 = await (await tctx.get(`/api/student/assessments/${asm.id}`)).json();
  expect(d2.questions.map((q) => q.score)).toEqual([5, 4]);
  await tctx.dispose();
});
async function uploadPdfAs(ctx, name) { return uploadPdf(ctx, name, name); }

test("到时自动提交：服务器以截止时间为准，已保存的答案保留，之后不能再保存", async ({ playwright, baseURL }) => {
  const { tctx, sctx, qs, asm } = await scenario(playwright, baseURL, { duration: 5 });
  const d0 = await startOk(tctx, asm.id, "typed");
  await save(tctx, asm.id, qs[0].id, "时间到之前写的");
  const { db } = require("../server/db");
  const past = new Date(Date.now() - 60000).toISOString();
  db.prepare("UPDATE attempts SET deadline_at = ? WHERE assessment_id = ?").run(past, asm.id);

  const late = await save(tctx, asm.id, qs[0].id, "时间到之后写的");
  expect(late.status()).toBe(409);
  const d = await (await tctx.get(`/api/student/assessments/${asm.id}`)).json();
  expect(d.assessment.status).toBe("submitted");
  expect(d.attempt.autoSubmitted).toBe(true);
  expect(d.attempt.submittedAt).toBe(past); // 提交时刻记为截止时刻
  expect(d.answers[qs[0].id]).toBe("时间到之前写的");
  const v = await supView(sctx, asm.id);
  expect(v.attempt.autoSubmitted).toBe(true);
  expect(d0.attempt.deadlineAt).not.toBe(past);
  await tctx.dispose();
});

test("没人访问时，定时清理也会自动提交过期的答卷", async ({ playwright, baseURL }) => {
  const { tctx, asm } = await scenario(playwright, baseURL, { duration: 5 });
  await startOk(tctx, asm.id, "paper");
  const { db } = require("../server/db");
  db.prepare("UPDATE attempts SET deadline_at = ? WHERE assessment_id = ?").run(new Date(Date.now() - 1000).toISOString(), asm.id);
  const { finalizeOverdue } = require("../server/attempts");
  finalizeOverdue(); // 其他用例的请求也可能同时触发清理，所以不检查返回的数量，只检查结果
  expect(db.prepare("SELECT status FROM assessments WHERE id = ?").get(asm.id).status).toBe("submitted");
  await tctx.dispose();
});

test("离开页面的记录：督导者能看到次数和时长；为打开题目 PDF 而离开的单独统计", async ({ playwright, baseURL }) => {
  const { tctx, sctx, asm } = await scenario(playwright, baseURL);
  await startOk(tctx, asm.id, "typed");
  const ev = (type, reason) => tctx.post(`/api/student/assessments/${asm.id}/events`, { headers: H, data: { type, reason } });
  expect((await tctx.post(`/api/student/assessments/${asm.id}/events`, { headers: H, data: { type: "bad" } })).status()).toBe(422);
  await ev("leave"); await ev("return");
  await ev("leave", "pdf"); await ev("return");
  await ev("leave");
  // 把时间戳改成确定的值：第一次离开 30 秒，第二次（打开 PDF）10 秒，第三次一直没回来
  const { db } = require("../server/db");
  const att = db.prepare("SELECT id FROM attempts WHERE assessment_id = ?").get(asm.id);
  const evs = db.prepare("SELECT id FROM attempt_events WHERE attempt_id = ? ORDER BY id").all(att.id);
  const t0 = Date.now() - 600000;
  [0, 30, 100, 110, 400].forEach((sec, i) => db.prepare("UPDATE attempt_events SET ts = ? WHERE id = ?").run(new Date(t0 + sec * 1000).toISOString(), evs[i].id));
  db.prepare("UPDATE attempts SET started_at = ? WHERE id = ?").run(new Date(t0 - 1000).toISOString(), att.id);
  const v = await supView(sctx, asm.id);
  expect(v.attempt.leaveCount).toBe(2);
  expect(v.attempt.pdfLeaves).toBe(1);
  // 30 + 10 + （最后一次离开从 t0+400 到现在，约 200 秒）
  expect(v.attempt.awaySeconds).toBeGreaterThanOrEqual(235);
  expect(v.attempt.awaySeconds).toBeLessThan(260);
  // 提交后不再记录
  await submit(tctx, asm.id);
  expect((await (await ev("leave")).json()).ignored).toBe(true);
  await tctx.dispose();
});

test("督导者：测试进行中不能修改/删除；提交后只能改分数和答题文件；时长校验；AI 评分接口需要参数", async ({ playwright, baseURL }) => {
  const { tctx, sctx, qs, asm } = await scenario(playwright, baseURL);
  const patch = (data) => sctx.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data });
  for (const bad of [4, 301, 59.5, "60", 0]) expect((await patch({ durationMinutes: bad })).status(), String(bad)).toBe(422);
  expect(((await (await patch({ durationMinutes: 90 })).json()).assessment.durationMinutes)).toBe(90);

  await startOk(tctx, asm.id, "typed");
  const mid = await patch({ subject: "x" });
  expect(mid.status()).toBe(409);
  expect((await mid.json()).error).toBe("IN_PROGRESS");
  expect((await patch({ questions: [{ questionFileId: qs[0].id, score: 3 }] })).status()).toBe(409);
  expect((await sctx.delete(`/api/supervisor/assessments/${asm.id}`, { headers: H })).status()).toBe(409);
  const live = (await (await sctx.get(`/api/supervisor/students/${(await (await sctx.get("/api/supervisor/students")).json()).students[0].id}/assessments`)).json()).assessments[0];
  expect(live.status).toBe("in_progress");
  expect(live.attempt.method).toBe("typed");

  await submit(tctx, asm.id);
  expect((await patch({ subject: "x" })).status()).toBe(409);
  expect((await patch({ questionFileIds: [qs[0].id] })).status()).toBe(409);
  expect((await patch({ scheduledWall: "2031-05-05T10:00" })).status()).toBe(409);
  expect((await sctx.delete(`/api/supervisor/assessments/${asm.id}`, { headers: H })).status()).toBe(409);
  // AI 评分接口已实现（详见 tests/ai.spec.js）：缺少判分标准等参数时被拒绝
  const ai = await sctx.post(`/api/supervisor/assessments/${asm.id}/ai-score`, { headers: H, data: { questionFileId: qs[0].id } });
  expect(ai.status()).toBe(422);
  const g = await patch({ questions: qs.map((q) => ({ questionFileId: q.id, score: 5 })) });
  expect((await g.json()).assessment.status).toBe("graded");
  expect((await patch({ score: 5 })).status()).toBe(409); // 整体评分字段已不再支持

  // 重测复制时长
  const re = await sctx.post(`/api/supervisor/assessments/${asm.id}/retake`, { headers: H, data: { scheduledWall: "2031-06-01T10:00" } });
  expect((await re.json()).assessments[0].durationMinutes).toBe(90);
  await tctx.dispose();
});

test("角色与登录：其他角色不能调用学生接口；未登录 401", async ({ playwright, baseURL }) => {
  for (const role of ["supervisor", "admin", "support"]) {
    const c = await playwright.request.newContext({ baseURL, storageState: state(role) });
    for (const p of ["/api/student/assessments", "/api/student/overview", "/api/student/files/1"]) expect((await c.get(p)).status(), role + p).toBe(403);
    await c.dispose();
  }
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  expect((await anon.get("/api/student/assessments")).status()).toBe(401);
  await anon.dispose();
});

test("学生页的“当前测试”：测试中的优先；已过预定时间但没开始的仍可开始", async ({ playwright, baseURL }) => {
  const { tctx, asm } = await scenario(playwright, baseURL);
  const { db } = require("../server/db");
  let o = (await (await tctx.get("/api/student/overview")).json()).next;
  expect([o.id, o.status]).toEqual([asm.id, "scheduled"]);
  db.prepare("UPDATE assessments SET scheduled_at = ? WHERE id = ?").run(new Date(Date.now() - 3600000).toISOString(), asm.id);
  o = (await (await tctx.get("/api/student/overview")).json()).next;
  expect([o.id, o.status]).toEqual([asm.id, "scheduled"]); // 过了预定时间也还在，仍然可以开始
  await startOk(tctx, asm.id, "typed");
  o = (await (await tctx.get("/api/student/overview")).json()).next;
  expect(o.status).toBe("in_progress");
  expect(o.deadlineAt).toBeTruthy();
  await submit(tctx, asm.id);
  o = (await (await tctx.get("/api/student/overview")).json()).next;
  expect(o).toBeNull(); // 已提交的不再作为“下一场测试”
  await tctx.dispose();
});

test("回答文字：学生用屏幕输入作答时，督导者的每道题都带有回答文字；纸质作答为空", async ({ playwright, baseURL }) => {
  const { tctx, sctx, qs, asm, stu } = await scenario(playwright, baseURL);
  const list = async () => (await (await sctx.get(`/api/supervisor/students/${stu.id}/assessments`)).json()).assessments[0];
  expect((await list()).questionFiles.map((q) => q.answerText)).toEqual([null, null]); // 还没作答
  await startOk(tctx, asm.id, "typed");
  await save(tctx, asm.id, qs[0].id, "第一题的回答文字\n第二行");
  expect((await list()).questionFiles.map((q) => q.answerText)).toEqual(["第一题的回答文字\n第二行", ""]); // 第二题没填写
  await submit(tctx, asm.id);
  expect((await list()).questionFiles[0].answerText).toBe("第一题的回答文字\n第二行");
  await tctx.dispose();

  const p = await scenario(playwright, baseURL);
  await startOk(p.tctx, p.asm.id, "paper");
  const pl = (await (await p.sctx.get(`/api/supervisor/students/${p.stu.id}/assessments`)).json()).assessments[0];
  expect(pl.questionFiles.map((q) => q.answerText)).toEqual([null, null]); // 纸质作答没有回答文字
  await p.tctx.dispose();
});
