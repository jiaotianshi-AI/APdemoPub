# 数据结构说明（DATA_MODEL）

> 本文档面向将来接后台的开发者。本阶段（演示版）只用到“静态模式”下的 5 个数据文件；其余实体为**预留**，没有样例文件，也没有实现。
> 以下不是法律意见；涉及儿童隐私与版权的部分，需需求方另行确认。

## 1. 通用约定
- 每个数据文件顶层有 `"schemaVersion": 1`。
- 多语言文字：`{ "zh": "...", "en": "..." }`，两个值都不得为空。
- ID 为字符串，带前缀：`stu_`（学生）、`crs_`（课程）、`unit_`（单元）、`asm_`（测试安排）、`att_`（一次答题）、`site_`、`vid_`、`qa_`。
- 时间为带时区偏移的 ISO 8601（如 `2026-11-28T15:00:00-07:00`），并另存 IANA 时区名（如 `America/Vancouver`）。
- 进度百分比为 0–100 的整数。
- 示例数据只用虚构 ID，不含真实姓名、邮箱、学校。
- JSON Schema（draft 2020-12）在 `data/schema/`。

## 2. 本阶段已使用的实体（static 模式）
| 文件 | 实体 | 关键字段 | 页面用途 |
|---|---|---|---|
| `data/sites.json` | Site | id、order、enabled、url、name、description、logo | 自学网站入口 |
| `data/videos.json` | Video | id、order、enabled、provider(`youtube`/`bilibili`)、videoId、title(null 或双语) | 自学视频入口（本阶段只实现 youtube） |
| `data/progress.sample.json` | Progress | studentId、course、currentUnit(id/number/name)、percent | 进度条与当前学习内容 |
| `data/assessment.sample.json` | Assessment | id、studentId、unitId、scheduledAt、timezone、durationMinutes、attemptNo、status、result | 测试时间与状态标签 |
| `data/qa.sample.json` | QaSample | id、question、answer | 机器人示例问答 |

说明：`durationMinutes`、`attemptNo` 本阶段页面不显示，但必须存在于数据里。`status` 取值：`scheduled | in_progress | graded | retake_scheduled | missed`。将来 `result` 为 `{ "score": 1-5, "gradedAt": "..." }`，未评分为 null。

## 3. 将来实体（预留，本阶段不做样例文件）
| 实体 | 关键字段 | 为什么需要 |
|---|---|---|
| Student | id、nickname（昵称）、grade（年级） | 区分进度与测试归属；只用昵称，不要真实姓名 |
| Guardian | id、与 Student 的多对多关系（guardianId ↔ studentId） | 家长查看周报、管理白名单 |
| Course / Unit | Course: id、name；Unit: id、courseId、number、name、order | 组织学习内容与进度 |
| Question（题库） | id、unitId、type（题型）、difficulty、referenceAnswer（标准答案）、rubric（评分细则） | 生成测试、AI 评分依据。**题库内容的版权归属需需求方另行确认，尤其要核对 College Board 对其内容的使用限制。** |
| Assessment | 见第 2 节 | 测试安排 |
| Attempt | id（`att_`）、assessmentId、startedAt、submittedAt、answers、aiScore(1–5)、feedback（评语）、isRetake（是否补考） | 记录一次答题与评分 |
| WeeklyReport | id、studentId、week（`YYYY-Www`）、lastResult（上期测试结果）、retakeThisWeek（本期是否补考）、contentAndProgress（本期内容与进度） | 家长周报 |
| Whitelist | id、studentId、scope、pattern、enabled | 家长为孩子设置的允许访问 URL 名单 |

### 关系图（文字）
```
Guardian *──* Student 1──* Assessment 1──* Attempt
                  │             │
                  │             └── unitId ──> Unit *──1 Course
                  ├──1 Progress (course, currentUnit, percent)
                  ├──* WeeklyReport
                  └──* Whitelist
Unit 1──* Question
```

## 4. 数据最小化与儿童隐私（最低要求建议）
- **只收集完成功能必需的字段。** 每个字段的理由见上表；没有理由的字段不要加。
- **默认不收集：** 真实姓名、邮箱（学生侧）、学校名、精确位置、设备指纹、第三方广告/统计标识、浏览行为明细。
- **昵称代替姓名；** 年级只需区间即可。
- **答案与评语只用于评分和家长周报，** 不用于画像或营销。
- 将来后台应满足的最低要求：
  1. 家长可查看孩子的全部数据，并可申请删除；
  2. 数据传输加密、访问需身份验证（方式待定）；
  3. 设定保留期限，超期自动删除；
  4. 第三方服务（如 AI 评分）接收的数据需最小化、去标识；
  5. 记录谁在何时访问了孩子的数据。
- 具体合规要求（如所在地区对未成年人数据的规定）需要由需求方咨询专业人士确认。

## 5. 字段使用状态一览
- **static 模式已用：** 第 2 节全部字段。
- **预留未用：** `Progress` 之外的 Student/Guardian/Course/Unit/Question/Attempt/WeeklyReport/Whitelist；`Assessment.result` 的评分内容；`Video.provider = "bilibili"`；`Site.logo`（有值时页面会使用，默认为 null）。
