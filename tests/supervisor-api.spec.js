// 督导者接口：测试记录、PDF 上传下载、权限
const { test, expect } = require("@playwright/test");
const { H, uid, makeUser, linkSupervisor, loginCtx, uploadPdf, pdf, state, ANON, gradeAll } = require("./helpers");

const WALL = "2031-03-15T15:00";
const START = "2031-03-01";

async function setup(playwright, baseURL, nStudents = 2) {
  const sup = await makeUser("supervisor", "sup");
  const students = [];
  for (let i = 0; i < nStudents; i++) {
    const s = await makeUser("student", "stu");
    linkSupervisor(sup.id, s.id);
    students.push(s);
  }
  const ctx = await loginCtx(playwright, baseURL, sup.username);
  return { sup, students, ctx };
}
const createBody = (studentIds, fileIds, extra) => ({ studentIds, scheduledWall: WALL, subject: "AP Biology", unit: "Unit 2", unitStartDate: START, questionFileIds: fileIds, ...extra });
async function create(ctx, studentIds, fileIds, extra) {
  const res = await ctx.post("/api/supervisor/assessments", { headers: H, data: createBody(studentIds, fileIds, extra) });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).assessments;
}

test("新建测试：选多个学生就为每个学生各生成一条；共用同一批题目 PDF", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 3);
  const f1 = await uploadPdf(ctx, "题目 一.pdf");
  const f2 = await uploadPdf(ctx, "q2.pdf");
  const made = await create(ctx, students.map((s) => s.id), [f1.id, f2.id]);
  expect(made).toHaveLength(3);
  for (const a of made) {
    expect(a.status).toBe("scheduled");
    expect(a.score).toBeNull();
    expect(a.attemptNo).toBe(1);
    expect(a.subject).toBe("AP Biology");
    expect(a.unit).toBe("Unit 2");
    expect(a.scheduledWall).toBe(WALL);
    expect(a.scheduledAt).toMatch(/^2031-03-15T15:00:00[+-]\d\d:\d\d$/);
    expect(a.unitStartDate).toBe(START);
    expect(a.questionFiles.map((f) => f.id)).toEqual([f1.id, f2.id]);
    expect(a.questionFiles[0].name).toBe("题目 一.pdf");
    expect(a.questionFiles.map((f) => f.label)).toEqual(["Q1", "Q2"]);
    expect(a.questionFiles.map((f) => [f.answerFile, f.score])).toEqual([[null, null], [null, null]]);
    expect([a.scoredCount, a.questionCount, a.scoreAverage]).toEqual([0, 2, null]);
    expect(a.answerFiles).toEqual([]);
  }
  expect(new Set(made.map((a) => a.studentId))).toEqual(new Set(students.map((s) => s.id)));
  const list = await (await ctx.get(`/api/supervisor/students/${students[0].id}/assessments`)).json();
  expect(list.assessments).toHaveLength(1);
  await ctx.dispose();
});

test("新建测试的校验", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const stranger = await makeUser("student", "stranger"); // 没关联的学生
  const f = await uploadPdf(ctx, "q.pdf");
  const post = (data) => ctx.post("/api/supervisor/assessments", { headers: H, data });
  const ok = createBody([students[0].id], [f.id]);

  expect((await post({ ...ok, studentIds: [] })).status()).toBe(422);
  expect((await post({ ...ok, studentIds: [stranger.id] })).status()).toBe(404);
  expect((await post({ ...ok, studentIds: [students[0].id, stranger.id] })).status()).toBe(404); // 有一个不能用就整体拒绝
  expect((await post({ ...ok, subject: "  " })).status()).toBe(422);
  expect((await post({ ...ok, unit: "x".repeat(65) })).status()).toBe(422);
  expect((await post({ ...ok, scheduledWall: "2020-01-01T10:00" })).status()).toBe(422); // 过去的时间
  expect((await post({ ...ok, scheduledWall: "2031-02-30T10:00" })).status()).toBe(422); // 不存在的日期
  expect((await post({ ...ok, scheduledWall: "tomorrow" })).status()).toBe(422);
  expect((await post({ ...ok, unitStartDate: "2031-03-20" })).status()).toBe(422); // 开始日晚于测试日
  expect((await post({ ...ok, unitStartDate: "x" })).status()).toBe(422);
  expect((await post({ ...ok, questionFileIds: [] })).status()).toBe(422);
  expect((await post({ ...ok, questionFileIds: [99999999] })).status()).toBe(422);
  expect((await post({ ...ok, questionFileIds: "1" })).status()).toBe(422);
  // 没有任何记录被创建
  const list = await (await ctx.get(`/api/supervisor/students/${students[0].id}/assessments`)).json();
  expect(list.assessments).toHaveLength(0);
  await ctx.dispose();
});

test("上传：只接受真正的 PDF，限制大小，文件名被清理", async ({ playwright, baseURL }) => {
  const { ctx } = await setup(playwright, baseURL, 1);
  const up = (data, headers) => ctx.post("/api/supervisor/files", { headers: { ...H, ...headers }, data });
  expect((await up(Buffer.from("not a pdf at all"), { "Content-Type": "application/pdf" })).status()).toBe(422);
  expect((await up(Buffer.alloc(0), { "Content-Type": "application/pdf" })).status()).toBe(422);
  expect((await up(pdf("x"), { "Content-Type": "text/plain" })).status()).toBe(415);
  const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(21 * 1024 * 1024, 1)]);
  expect((await up(big, { "Content-Type": "application/pdf" })).status()).toBe(413);

  const res = await up(pdf("n"), { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent("../../etc/pass<wd>?.txt") });
  expect(res.status()).toBe(201);
  const name = (await res.json()).file.name;
  expect(name).not.toMatch(/[\\/<>?]/);
  expect(name.endsWith(".pdf")).toBe(true);
  await ctx.dispose();
});

test("下载：关联的督导者可以打开；其他人、其他角色、未登录都不行；响应头安全", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const f = await uploadPdf(ctx, "文件.pdf", "secret-content");
  // 未关联到测试之前，只有上传者自己能看
  const own = await ctx.get(`/api/supervisor/files/${f.id}`);
  expect(own.status()).toBe(200);
  const other = await setup(playwright, baseURL, 1);
  expect((await other.ctx.get(`/api/supervisor/files/${f.id}`)).status()).toBe(404);

  await create(ctx, [students[0].id], [f.id]);
  const res = await ctx.get(`/api/supervisor/files/${f.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["content-disposition"]).toContain("inline");
  expect(res.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await res.body()).toString()).toContain("secret-content");

  expect((await other.ctx.get(`/api/supervisor/files/${f.id}`)).status()).toBe(404); // 别的督导者仍然不行
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  expect((await anon.get(`/api/supervisor/files/${f.id}`)).status()).toBe(401);
  for (const role of ["student", "admin", "support"]) {
    const c = await playwright.request.newContext({ baseURL, storageState: state(role) });
    expect((await c.get(`/api/supervisor/files/${f.id}`)).status(), role).toBe(403);
    await c.dispose();
  }
  await anon.dispose(); await ctx.dispose(); await other.ctx.dispose();
});

test("修改待测试：时间、科目、单元、开始日期、题目文件；校验规则", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const f1 = await uploadPdf(ctx, "a.pdf");
  const f2 = await uploadPdf(ctx, "b.pdf");
  const [a] = await create(ctx, [students[0].id], [f1.id]);
  const patch = (data) => ctx.patch(`/api/supervisor/assessments/${a.id}`, { headers: H, data });

  let res = await patch({ scheduledWall: "2031-03-22T10:30", subject: "AP Chemistry", unit: "Unit 3", unitStartDate: "2031-03-05", questionFileIds: [f1.id, f2.id] });
  expect(res.status(), await res.text()).toBe(200);
  const u = (await res.json()).assessment;
  expect([u.scheduledWall, u.subject, u.unit, u.unitStartDate]).toEqual(["2031-03-22T10:30", "AP Chemistry", "Unit 3", "2031-03-05"]);
  expect(u.scheduledAt).toMatch(/^2031-03-22T10:30:00[+-]/);
  expect(u.questionFiles.map((f) => f.id)).toEqual([f1.id, f2.id]);

  expect((await patch({ scheduledWall: "2020-01-01T10:00" })).status()).toBe(422);
  expect((await patch({ unitStartDate: "2031-04-01" })).status()).toBe(422);
  expect((await patch({ scheduledWall: "2031-03-02T10:00" })).status()).toBe(422); // 新测试日早于现有开始日
  expect((await patch({ questionFileIds: [] })).status()).toBe(422);
  expect((await patch({})).status()).toBe(400);
  expect((await patch({ status: "graded" })).status()).toBe(409);
  expect((await patch({ studentId: 1 })).status()).toBe(409);
  // 被移除且不再被使用的题目文件会被删除
  res = await patch({ questionFileIds: [f2.id] });
  expect(res.status()).toBe(200);
  expect((await ctx.get(`/api/supervisor/files/${f1.id}`)).status()).toBe(404);
  expect((await ctx.get(`/api/supervisor/files/${f2.id}`)).status()).toBe(200);
  await ctx.dispose();
});

test("每题回答 PDF 与评分：每题都评完才算出汇总评分并变为已评分；清空任一题的评分会退回", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const q1 = await uploadPdf(ctx, "q1.pdf"), q2 = await uploadPdf(ctx, "q2.pdf"), q3 = await uploadPdf(ctx, "q3.pdf");
  const ans1 = await uploadPdf(ctx, "回答Q1.pdf"), ans3 = await uploadPdf(ctx, "回答Q3.pdf");
  const [a] = await create(ctx, [students[0].id], [q1.id, q2.id, q3.id]);
  const patch = (data) => ctx.patch(`/api/supervisor/assessments/${a.id}`, { headers: H, data });
  const body = async (r) => (await r.json()).assessment;

  // 回答 PDF 可以为空：只给 Q1、Q3 上传
  let u = await body(await patch({ questions: [{ questionFileId: q1.id, answerFileId: ans1.id }, { questionFileId: q3.id, answerFileId: ans3.id }] }));
  expect(u.questionFiles.map((q) => [q.label, q.answerFile && q.answerFile.name, q.score])).toEqual([["Q1", "回答Q1.pdf", null], ["Q2", null, null], ["Q3", "回答Q3.pdf", null]]);
  expect(u.status).toBe("scheduled");

  // 评分校验：每题 1–5 的整数或 null
  for (const bad of [0, 6, 3.5, "4", true]) expect((await patch({ questions: [{ questionFileId: q1.id, score: bad }] })).status(), String(bad)).toBe(422);

  // 只评一部分：汇总为空，状态不变
  u = await body(await patch({ questions: [{ questionFileId: q1.id, score: 5 }, { questionFileId: q2.id, score: 3 }] }));
  expect([u.status, u.score, u.scoredCount, u.questionCount, u.scoreAverage]).toEqual(["scheduled", null, 2, 3, 4]);
  // 评完最后一题：汇总评分 = 平均值四舍五入；(5+3+4)/3 = 4.0 → 4
  u = await body(await patch({ questions: [{ questionFileId: q3.id, score: 4 }] }));
  expect([u.status, u.score, u.scoredCount, u.scoreAverage]).toEqual(["graded", 4, 3, 4]);
  expect(u.gradedAt).toBeTruthy();
  // 修改单题评分，汇总随之重新计算：(5+3+5)/3 = 4.33 → 4；(5+5+5)/3 → 5
  u = await body(await patch({ questions: [{ questionFileId: q3.id, score: 5 }] }));
  expect([u.status, u.score]).toEqual(["graded", 4]);
  u = await body(await patch({ questions: [{ questionFileId: q2.id, score: 5 }] }));
  expect([u.status, u.score]).toEqual(["graded", 5]);
  // 已评分后仍可改每题的回答文件；同一个文件不能给两道题
  expect((await patch({ questions: [{ questionFileId: q2.id, answerFileId: ans1.id }] })).status()).toBe(422);
  const ans2 = await uploadPdf(ctx, "回答Q2.pdf");
  u = await body(await patch({ questions: [{ questionFileId: q2.id, answerFileId: ans2.id }] }));
  expect([u.status, u.score, u.questionFiles[1].answerFile.name]).toEqual(["graded", 5, "回答Q2.pdf"]);
  await ctx.dispose();
});

test("汇总评分公式：平均值四舍五入（x.5 进位）", async ({ playwright, baseURL }) => {
  const { summarize } = require("../server/scoring");
  const cases = [
    [[5, 5, 5], 5], [[1, 1, 1], 1], [[5, 3, 4], 4], [[5, 4], 5], [[4, 4, 5], 4], [[4, 5, 5], 5], [[1, 2], 2], [[2, 3, 3, 3], 3], [[1, 2, 2, 2], 2], [[3], 3]
  ];
  for (const [scores, expected] of cases) expect(summarize(scores).overall, JSON.stringify(scores)).toBe(expected);
  expect(summarize([5, null, 3]).overall).toBeNull();
  expect(summarize([5, null, 3]).average).toBe(4);
  expect(summarize([null, null]).average).toBeNull();
  expect(summarize([]).overall).toBeNull();
  expect(summarize([2, 3]).overall).toBe(3); // 2.5 → 3
});

test("评分的撤销、校验和边界：清空评分退回状态；同一文件不能给两道题；不属于这场测试的题目被拒绝", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const q1 = await uploadPdf(ctx, "q1.pdf"), q2 = await uploadPdf(ctx, "q2.pdf"), other = await uploadPdf(ctx, "other.pdf");
  const ans = await uploadPdf(ctx, "ans.pdf");
  const [a] = await create(ctx, [students[0].id], [q1.id, q2.id]);
  const patch = (data) => ctx.patch(`/api/supervisor/assessments/${a.id}`, { headers: H, data });
  expect((await gradeAll(ctx, a, [4, 4])).status()).toBe(200);
  let cur = (await (await ctx.get(`/api/supervisor/students/${students[0].id}/assessments`)).json()).assessments[0];
  expect([cur.status, cur.score]).toEqual(["graded", 4]);
  // 清空一题的评分 → 汇总为空，退回“待测试”（没有学生答卷）
  let res = await patch({ questions: [{ questionFileId: q2.id, score: null }] });
  cur = (await res.json()).assessment;
  expect([cur.status, cur.score, cur.gradedAt, cur.scoredCount]).toEqual(["scheduled", null, null, 1]);
  // 再评完 → 已评分
  cur = (await (await patch({ questions: [{ questionFileId: q2.id, score: 5 }] })).json()).assessment;
  expect([cur.status, cur.score]).toEqual(["graded", 5]); // (4+5)/2 = 4.5 → 5

  expect((await patch({ questions: [{ questionFileId: other.id, score: 3 }] })).status()).toBe(422); // 不是这场测试的题
  expect((await patch({ questions: [{ questionFileId: q1.id, score: 3 }, { questionFileId: q1.id, score: 4 }] })).status()).toBe(422); // 重复
  expect((await patch({ questions: [] })).status()).toBe(422);
  expect((await patch({ questions: "x" })).status()).toBe(422);
  expect((await patch({ questions: [{ questionFileId: q1.id, bogus: 1 }] })).status()).toBe(422);
  expect((await patch({ questions: [{ questionFileId: q1.id, answerFileId: 99999999 }] })).status()).toBe(422);
  // 同一个文件不能同时给两道题
  expect((await patch({ questions: [{ questionFileId: q1.id, answerFileId: ans.id }, { questionFileId: q2.id, answerFileId: ans.id }] })).status()).toBe(422);
  // 旧的整体评分、整体答题文件的字段已经不再支持
  expect((await patch({ score: 4 })).status()).toBe(409);
  expect((await patch({ answerFileIds: [ans.id] })).status()).toBe(409);
  // 换掉回答文件：旧文件没有别处使用就被删除
  await patch({ questions: [{ questionFileId: q1.id, answerFileId: ans.id }] });
  const ans2 = await uploadPdf(ctx, "ans2.pdf");
  await patch({ questions: [{ questionFileId: q1.id, answerFileId: ans2.id }] });
  expect((await ctx.get(`/api/supervisor/files/${ans.id}`)).status()).toBe(404);
  cur = (await (await patch({ questions: [{ questionFileId: q1.id, answerFileId: null }] })).json()).assessment;
  expect(cur.questionFiles[0].answerFile).toBeNull();
  expect((await ctx.get(`/api/supervisor/files/${ans2.id}`)).status()).toBe(404);
  await ctx.dispose();
});

test("修改待测试时移除某道题：它的回答文件和评分一并清除", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const q1 = await uploadPdf(ctx, "q1.pdf"), q2 = await uploadPdf(ctx, "q2.pdf");
  const ans2 = await uploadPdf(ctx, "ans2.pdf");
  const [a] = await create(ctx, [students[0].id], [q1.id, q2.id]);
  const patch = (data) => ctx.patch(`/api/supervisor/assessments/${a.id}`, { headers: H, data });
  await patch({ questions: [{ questionFileId: q2.id, answerFileId: ans2.id, score: 3 }] });
  const res = await patch({ questionFileIds: [q1.id] });
  const u = (await res.json()).assessment;
  expect(u.questionFiles.map((q) => q.id)).toEqual([q1.id]);
  expect(u.scoredCount).toBe(0);
  expect((await ctx.get(`/api/supervisor/files/${ans2.id}`)).status()).toBe(404);
  const { db } = require("../server/db");
  expect(db.prepare("SELECT COUNT(*) AS n FROM question_scores WHERE assessment_id = ?").get(a.id).n).toBe(0);
  expect(db.prepare("SELECT COUNT(*) AS n FROM question_answers WHERE assessment_id = ?").get(a.id).n).toBe(0);
  await ctx.dispose();
});

test("旧数据：只有整体分数、没有逐题评分的已评分测试，原分数保留；只改回答文件不会动它", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const q = await uploadPdf(ctx, "q.pdf");
  const [a] = await create(ctx, [students[0].id], [q.id]);
  const { db } = require("../server/db");
  db.prepare("UPDATE assessments SET status = 'graded', score = 4, graded_at = ? WHERE id = ?").run(new Date().toISOString(), a.id);
  const cur = (await (await ctx.get(`/api/supervisor/students/${students[0].id}/assessments`)).json()).assessments[0];
  expect([cur.status, cur.score, cur.scoredCount]).toEqual(["graded", 4, 0]);
  const ans = await uploadPdf(ctx, "补传.pdf");
  const res = await ctx.patch(`/api/supervisor/assessments/${a.id}`, { headers: H, data: { questions: [{ questionFileId: q.id, answerFileId: ans.id }] } });
  const u = (await res.json()).assessment;
  expect([u.status, u.score]).toEqual(["graded", 4]);
  expect(u.questionFiles[0].answerFile.name).toBe("补传.pdf");
  await ctx.dispose();
});

test("删除：只有待测试能删；共用的题目文件在别的学生还在用时保留", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 2);
  const q = await uploadPdf(ctx, "shared.pdf");
  const [a1, a2] = await create(ctx, students.map((s) => s.id), [q.id]);
  expect((await ctx.delete(`/api/supervisor/assessments/${a1.id}`, { headers: H })).status()).toBe(200);
  expect((await ctx.get(`/api/supervisor/files/${q.id}`)).status()).toBe(200); // 另一条还在用
  await gradeAll(ctx, a2, [3]);
  expect((await ctx.delete(`/api/supervisor/assessments/${a2.id}`, { headers: H })).status()).toBe(409); // 已评分不能删
  const list = await (await ctx.get(`/api/supervisor/students/${students[1].id}/assessments`)).json();
  expect(list.assessments).toHaveLength(1);

  const [a3] = await create(ctx, [students[0].id], [q.id]);
  expect((await ctx.delete(`/api/supervisor/assessments/${a3.id}`, { headers: H })).status()).toBe(200);
  expect((await ctx.get(`/api/supervisor/files/${q.id}`)).status()).toBe(200); // 学生2 的已评分测试仍在用
  expect((await ctx.delete(`/api/supervisor/assessments/99999999`, { headers: H })).status()).toBe(404);
  await ctx.dispose();
});

test("重测：复制科目、单元和题目文件，生成新的待测试记录；原记录与分数保留", async ({ playwright, baseURL }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const q = await uploadPdf(ctx, "q.pdf");
  const ans = await uploadPdf(ctx, "ans.pdf");
  const [a] = await create(ctx, [students[0].id], [q.id]);
  const retake = (id, data) => ctx.post(`/api/supervisor/assessments/${id}/retake`, { headers: H, data });

  expect((await retake(a.id, { scheduledWall: "2031-04-12T15:00" })).status()).toBe(409); // 待测试不能重测
  await gradeAll(ctx, a, [2], [{ answerFileId: ans.id }]);
  expect((await retake(a.id, { scheduledWall: "2020-01-01T10:00" })).status()).toBe(422);
  expect((await retake(a.id, {})).status()).toBe(422);

  const res = await retake(a.id, { scheduledWall: "2031-04-12T15:00" });
  expect(res.status(), await res.text()).toBe(201);
  const [n] = (await res.json()).assessments;
  expect(n.id).not.toBe(a.id);
  expect([n.status, n.score, n.attemptNo, n.retakeOf]).toEqual(["scheduled", null, 2, a.id]);
  expect([n.subject, n.unit, n.unitStartDate, n.scheduledWall]).toEqual(["AP Biology", "Unit 2", START, "2031-04-12T15:00"]);
  expect(n.questionFiles.map((f) => f.id)).toEqual([q.id]);
  expect(n.answerFiles).toEqual([]);
  expect(n.questionFiles.map((f) => [f.answerFile, f.score])).toEqual([[null, null]]); // 回答和评分都不复制

  const list = (await (await ctx.get(`/api/supervisor/students/${students[0].id}/assessments`)).json()).assessments;
  expect(list).toHaveLength(2);
  const old = list.find((x) => x.id === a.id);
  expect([old.status, old.score]).toEqual(["graded", 2]); // 原记录不变
  expect(old.questionFiles.map((f) => [f.answerFile && f.answerFile.id, f.score])).toEqual([[ans.id, 2]]);

  // 对重测记录评分后可以再重测，次数递增
  await gradeAll(ctx, n, [4]);
  const r2 = (await (await retake(n.id, { scheduledWall: "2031-05-10T15:00" })).json()).assessments[0];
  expect(r2.attemptNo).toBe(3);
  await ctx.dispose();
});

test("权限：只能看到和操作自己关联的学生；其他角色不能用", async ({ playwright, baseURL }) => {
  const a = await setup(playwright, baseURL, 1);
  const b = await setup(playwright, baseURL, 1);
  const f = await uploadPdf(a.ctx, "a.pdf");
  const [asm] = await create(a.ctx, [a.students[0].id], [f.id]);

  expect((await (await b.ctx.get("/api/supervisor/students")).json()).students.map((s) => s.id)).toEqual([b.students[0].id]);
  expect((await b.ctx.get(`/api/supervisor/students/${a.students[0].id}/assessments`)).status()).toBe(404);
  expect((await b.ctx.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data: { questions: [{ questionFileId: f.id, score: 1 }] } })).status()).toBe(404);
  expect((await b.ctx.delete(`/api/supervisor/assessments/${asm.id}`, { headers: H })).status()).toBe(404);
  expect((await b.ctx.post(`/api/supervisor/assessments/${asm.id}/retake`, { headers: H, data: { scheduledWall: WALL } })).status()).toBe(404);
  expect((await b.ctx.post("/api/supervisor/assessments", { headers: H, data: createBody([a.students[0].id], [f.id]) })).status()).toBe(404);
  // 不能拿别人上传的文件挂到自己的测试上
  expect((await b.ctx.post("/api/supervisor/assessments", { headers: H, data: createBody([b.students[0].id], [f.id]) })).status()).toBe(422);

  for (const role of ["student", "admin", "support"]) {
    const c = await playwright.request.newContext({ baseURL, storageState: state(role) });
    expect((await c.get("/api/supervisor/students")).status(), role).toBe(403);
    await c.dispose();
  }
  const anon = await playwright.request.newContext({ baseURL, storageState: ANON });
  expect((await anon.get("/api/supervisor/students")).status()).toBe(401);
  await anon.dispose(); await a.ctx.dispose(); await b.ctx.dispose();
});

test("一个学生被两个督导者关联：两人都能看到并管理同一批测试", async ({ playwright, baseURL }) => {
  const a = await setup(playwright, baseURL, 1);
  const b = await makeUser("supervisor", "sup2");
  linkSupervisor(b.id, a.students[0].id);
  const bctx = await loginCtx(playwright, baseURL, b.username);
  const f = await uploadPdf(a.ctx, "a.pdf");
  const [asm] = await create(a.ctx, [a.students[0].id], [f.id]);
  const seen = (await (await bctx.get(`/api/supervisor/students/${a.students[0].id}/assessments`)).json()).assessments;
  expect(seen.map((x) => x.id)).toEqual([asm.id]);
  expect((await bctx.get(`/api/supervisor/files/${f.id}`)).status()).toBe(200);
  expect((await bctx.patch(`/api/supervisor/assessments/${asm.id}`, { headers: H, data: { unit: "Unit 9" } })).status()).toBe(200);
  await a.ctx.dispose(); await bctx.dispose();
});

test("管理员删除学生账号后，他的测试记录和不再使用的 PDF 一并清除", async ({ playwright, baseURL, request }) => {
  const { students, ctx } = await setup(playwright, baseURL, 1);
  const f = await uploadPdf(ctx, "gone.pdf");
  await create(ctx, [students[0].id], [f.id]);
  const admin = await playwright.request.newContext({ baseURL, storageState: state("admin") });
  await admin.post(`/api/admin/accounts/${students[0].id}/disable`, { headers: H });
  expect((await admin.delete(`/api/admin/accounts/${students[0].id}`, { headers: H })).status()).toBe(200);
  const { db } = require("../server/db");
  expect(db.prepare("SELECT COUNT(*) AS n FROM assessments WHERE student_id = ?").get(students[0].id).n).toBe(0);
  // 文件是刚上传的（10 分钟宽限期内），不会被立刻清除，但已经没有任何人能打开
  expect((await ctx.get(`/api/supervisor/files/${f.id}`)).status()).toBe(200); // 上传者自己仍能打开未使用的文件
  const { gcFiles } = require("../server/files");
  expect(gcFiles(-1)).toBeGreaterThanOrEqual(1); // 强制清理：没有被任何测试使用的文件
  expect((await ctx.get(`/api/supervisor/files/${f.id}`)).status()).toBe(404);
  await admin.dispose(); await ctx.dispose();
});
