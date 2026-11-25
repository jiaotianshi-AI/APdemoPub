# 后台接口草案（API）

> **草案，本阶段未实现，不得据此编写服务端。** 仅用于约定将来 `api.js` 的 `remote` 模式要对接的形态。
> 基础路径：`${apiBase}/v1`；格式：JSON；所有时间带时区偏移。
> 认证方式：**待定**（本草案不选型）。下表“身份”指调用者角色。
> 通用错误码：`UNAUTHENTICATED`(401)、`FORBIDDEN`(403)、`NOT_FOUND`(404)、`VALIDATION_FAILED`(422)、`RATE_LIMITED`(429)、`INTERNAL`(500)。
> 响应数据结构引用 `data/schema/` 中的 schema；本阶段没有 schema 的响应标注“待定”。

| 接口 | 用途 | 请求 | 响应 | 专有错误码 | 身份 |
|---|---|---|---|---|---|
| `GET /me` | 当前用户信息 | 无 | User（待定）或 401 | — | 学生 / 家长 |
| `GET /students/{id}/progress` | 学习进度 | 路径 `id` | `progress.schema.json` | NOT_FOUND | 学生（本人）/ 家长（其孩子） |
| `GET /students/{id}/assessments/next` | 下一次测试 | 路径 `id` | `assessment.schema.json` 或 `null` | NOT_FOUND | 同上 |
| `POST /assessments/{id}/start` | 开始测试，生成 Attempt | 无请求体 | Attempt（`att_` ID，待定 schema） | `ASSESSMENT_NOT_STARTABLE`（未到时间/已结束） | 学生 |
| `POST /attempts/{id}/submit` | 提交答案 | `{ "answers": [...] }` | Attempt（待定） | `ATTEMPT_CLOSED` | 学生 |
| `GET /attempts/{id}` | 查看答题与评分结果 | 路径 `id` | Attempt（含 AI 评分 1–5、评语，待定） | NOT_FOUND | 学生 / 家长 |
| `GET /students/{id}/reports/weekly?week=YYYY-Www` | 家长周报 | 查询 `week` | WeeklyReport（待定） | VALIDATION_FAILED（week 格式） | 家长 |
| `GET /sites` | 站点列表 | 无 | `site.schema.json` 的 `items`（仅 enabled，按 order） | — | 公开 / 登录用户 |
| `GET /videos` | 视频列表 | 无 | `video.schema.json` 的 `items`（同上） | — | 公开 / 登录用户 |
| `POST /qa/ask` | 向 AP 问答机器人提问 | `{ "question": "..." }` | `{ "answer": {zh,en 或单语}, "sources": [...] }`（待定） | RATE_LIMITED | 学生 |
| `PUT /students/{id}/whitelist` | （将来家长端）设置 URL 白名单 | `{ "items": [{ "scope", "pattern", "enabled" }] }` | Whitelist（待定） | VALIDATION_FAILED | 家长 |

## 与前端函数的对应
| `window.APApi` 函数 | 接口 |
|---|---|
| `getCurrentUser()` | `GET /me`（本阶段固定返回 null） |
| `getProgress(studentId)` | `GET /students/{id}/progress` |
| `getNextAssessment(studentId)` | `GET /students/{id}/assessments/next` |
| `startAssessment` / `submitAttempt` / `getAttemptResult` | `POST .../start` / `POST .../submit` / `GET /attempts/{id}` |
| `getWeeklyReport` | `GET /students/{id}/reports/weekly` |
| `getSites` / `getVideos` | `GET /sites` / `GET /videos` |
| `askQuestion` | `POST /qa/ask` |
| `login` / `logout` | 待定（认证方式未定） |

本阶段 `remote` 模式下，以上函数一律 reject `{ code: "NOT_IMPLEMENTED" }`，不发任何网络请求。
