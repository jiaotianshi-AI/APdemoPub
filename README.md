# APdemo —— AP 自学网站（演示版）

中英双语的 AP 自学网站。进度和测试为核心主模块，自学视频 / AP 问答机器人为辅助模块，页面底部为“关联网站”链接。
**现在需要登录才能访问任何页面**，有三类页面：

| 地址 | 谁用 | 说明 |
|---|---|---|
| `/` | 学生 | 学生页：显示自己最近一场测试的科目、单元、时间、倒计时和学习进度 |
| `/supervisor` | 督导者（家长/老师） | 为关联的学生新建测试（可多选学生）、上传题目 PDF、修改/删除待测试、上传答题 PDF 与录入分数、重测 |
| `/admin` | 管理员 | 账号管理：新建、编辑关联、停用/启用、重置密码、删除 |

账号类型：学生、督导者、客服、管理员。客服登录后暂时只看到“暂未开放”。最终报告见 `REPORT.md`。

## 目录
```
index.html            学生页
pages/                登录、修改密码、管理员、督导者、客服占位页
assets/css, js, img   前端资源（auth.css / admin.css / admin.js 等为账号相关页面）
data/                 内容数据 + schema/（学生页使用，登录后才能读取）
server/               Node.js 后台（登录、会话、账号管理接口、命令行工具）
deploy/               Caddy 配置、systemd 服务、安装/更新/备份脚本
docs/                 DATA_MODEL.md、API.md
tests/                Playwright 测试与截图
```
后台只用 Node.js 自带功能（`node:sqlite`、`crypto`、`http`），**没有运行时 npm 依赖**；需要 Node.js 22.13 或更高。

## 本地运行
```bash
export COOKIE_SECURE=0                 # 本地是 http，不是 https，需要关掉 cookie 的 Secure 属性（仅本地）
node --disable-warning=ExperimentalWarning server/cli.js create-admin 你的管理员账号名   # 会打印一次性初始密码
npm start                              # 然后访问 http://localhost:3000/
```
数据库默认在 `var/apdemo.db`（已加入 `.gitignore`，不会被提交）。用 `APDEMO_DB=路径` 指定别处。
首次用管理员登录会要求先修改初始密码，然后进入 `/admin`。

## 测试规则（督导者页面）
- **新建测试**：目标学生（可多选，含“所有学生”）、测试日期和时间（温哥华时间）、本单元开始学习日期、测试科目、测试单元、题目 PDF（可多个）。每个被选中的学生各生成一条独立的测试记录。
- **学生页**只显示该学生**排期最近的一个**未来测试；学习进度 = 从“本单元开始学习日期”到测试时间已走过的比例。
- **待测试**：可以修改、删除、上传答题 PDF、录入分数。录入分数（1–5 的整数）后状态变为**已评分**。AI 自动评分以后再做，到时会写入同一个分数字段。
- **已评分**：可以修改分数和答题文件，或**重测**（复制科目、单元和题目文件，重新设定时间，生成一条新的“待测试”记录；原记录和分数保留）。已评分的测试不能删除。
- 督导者只能看到和操作自己关联的学生；PDF 文件不能通过网址直接访问，每次打开都检查登录和权限。

## 账号规则
- 新建账号只需**账号名**和**账号类型**（学生 / 督导者 / 客服），这两项创建后**不能修改**。
- 学生：可设置学习科目（如 AP Biology，可为空）。
- 督导者：可关联多个学生。
- 客服：可关联多个督导者。
- 初始密码由系统生成，只显示一次，用户第一次登录必须自己改密码；管理员也看不到之后的密码。
- 删除账号需要先“停用”，停用的账号可恢复；彻底删除会一并清除它的关联关系。
- 管理员账号只能在服务器上用命令行创建（`deploy/create-admin.sh`），网页上不能创建。

## 修改学生页内容
- **`assets/js/config.js`**：`brandName`（品牌名，占位名）、`dataSource`（`"static"` 为本阶段唯一实现；`"remote"` 仅预留，调用会报 `NOT_IMPLEMENTED`，不发请求）、`apiBase`（预留）。
- **`data/sites.json`**：站点列表（`url`、`name`、`description`、`order`、`enabled`）。`logo` 字段保留但页面目前不显示（关联网站只显示网站名），`description` 同样暂不显示。
- **`data/videos.json`**：视频 ID 与标题；三个视频已填入原标题（英文原题，中文界面也显示原题，未翻译）；`title` 为 null 时显示“AP 视频 N”占位，填 `{ "zh": "...", "en": "..." }` 即可显示标题。
- **`data/progress.sample.json`**：课程、单元、进度百分比（0–100 整数）。
- **`data/assessment.sample.json`**：测试时间（`scheduledAt` 带时区偏移，`timezone` 为 IANA 名）。未到时间显示倒计时，已过显示“已结束 / Ended”。
- **`data/qa.sample.json`**：示例问答。
- 修改数据后可运行测试，校验是否仍符合 `data/schema/`。

## 部署
见 `deploy/DEPLOY.md`（腾讯云轻量服务器 + Caddy + Node.js + systemd）。

## 运行测试
需要 Node.js。测试依赖只在开发时用，运行时无依赖。
```bash
npm install
npx playwright install webkit      # 首次需要；Linux 上缺系统库时再运行 npx playwright install-deps webkit
npx playwright test                # Chromium + WebKit 两个项目
npx playwright test --project=chromium   # 只跑 Chromium
```
测试会自动用一个临时数据库启动后台，并用测试账号登录（不涉及任何真实数据）。WebKit 项目用来近似 iPad Safari，**不等于真机**。截图输出到 `tests/screenshots/`（Chromium）和 `tests/screenshots/webkit/`，供人工审阅外观。

## 人工验收清单（需求方在真机上做）
1. 真实 iPad（横屏）Safari：版面、点击大小、底部三个关联网站链接（新标签页打开）、视频模态窗口
2. 真实安卓平板（横屏）Chrome：同上
3. 笔记本 Chrome / Edge / Safari：同上
4. 视频是否真的能播放（未核实这三个视频是否允许嵌入）
5. 三个视频的标题是否正确、是否与 AP 相关
6. 复核两处宣传文案：“AP相关全知道”“精选/自选名师AP视频”

## 许可证与商标
代码以 MIT 许可证发布（见 `LICENSE`）。AP® 是 College Board 的注册商标；Khan Academy、Google Classroom 为各自所有者的商标。本项目与上述机构无关，也未获得其认可。
