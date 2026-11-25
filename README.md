# APdemo —— AP 自学网站演示首页（第一阶段）

纯静态（HTML/CSS/JS）、中英双语。进度测试为核心主模块，自学视频 / AP 问答机器人为辅助模块，页面底部为“关联网站”链接，另有一个演示用登录入口。
**演示版：没有后台、没有真实登录、没有真实机器人。** 最终报告见 `REPORT.md`。

## 目录
```
index.html
assets/css/style.css
assets/js/config.js   品牌名、dataSource、apiBase
assets/js/i18n.js     中英词典
assets/js/api.js      数据访问层（页面唯一取数入口）
assets/js/app.js      页面逻辑
assets/img/chatbot.svg
data/                 内容数据 + schema/
docs/                 DATA_MODEL.md、API.md
tests/                Playwright 测试与截图
```

## 本地预览
页面用 `fetch` 读取 `data/*.json`，浏览器不允许 `file://` 下的 fetch，因此**不能双击打开 index.html**，必须起本地服务器，并且最好从上一级目录起，以验证 `/APdemo/` 子路径：
```bash
cd ..            # 进入包含 APdemo/ 文件夹的目录
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/APdemo/
```
URL 参数 `?lang=zh` / `?lang=en` 可指定语言。

## 修改内容
- **`assets/js/config.js`**：`brandName`（品牌名，占位名）、`dataSource`（`"static"` 为本阶段唯一实现；`"remote"` 仅预留，调用会报 `NOT_IMPLEMENTED`，不发请求）、`apiBase`（预留）。
- **`data/sites.json`**：站点列表（`url`、`name`、`description`、`order`、`enabled`）。`logo` 字段保留但页面目前不显示（关联网站只显示网站名），`description` 同样暂不显示。
- **`data/videos.json`**：视频 ID 与标题；三个视频已填入原标题（英文原题，中文界面也显示原题，未翻译）；`title` 为 null 时显示“AP 视频 N”占位，填 `{ "zh": "...", "en": "..." }` 即可显示标题。
- **`data/progress.sample.json`**：课程、单元、进度百分比（0–100 整数）。
- **`data/assessment.sample.json`**：测试时间（`scheduledAt` 带时区偏移，`timezone` 为 IANA 名）。未到时间显示倒计时，已过显示“已结束 / Ended”。
- **`data/qa.sample.json`**：示例问答。
- 修改数据后可运行测试，校验是否仍符合 `data/schema/`。

## 部署
把 `APdemo/` 整个文件夹上传到 locprof.com 网站根目录下，使 `index.html` 位于 `/APdemo/index.html`（目标地址 https://www.locprof.com/APdemo/）。`/APdemo` 与 `/APdemo/` 的跳转取决于服务器，如不自动跳转请联系主机商。所有资源均为相对路径。上传时无需 `tests/`、`node_modules/`、`package.json`、`playwright.config.js`。

## 运行测试
需要 Node.js。测试依赖只在开发时用，运行时无依赖。
```bash
npm install
npx playwright install webkit      # 首次需要；Linux 上缺系统库时再运行 npx playwright install-deps webkit
npx playwright test                # Chromium + WebKit 两个项目
npx playwright test --project=chromium   # 只跑 Chromium
```
测试会自动起本地服务器（通过 `/APdemo/` 子路径）。WebKit 项目用来近似 iPad Safari，**不等于真机**。截图输出到 `tests/screenshots/`（Chromium）和 `tests/screenshots/webkit/`，供人工审阅外观。

## 人工验收清单（需求方在真机上做）
1. 真实 iPad（横屏）Safari：版面、点击大小、底部三个关联网站链接（新标签页打开）、视频模态窗口
2. 真实安卓平板（横屏）Chrome：同上
3. 笔记本 Chrome / Edge / Safari：同上
4. 视频是否真的能播放（未核实这三个视频是否允许嵌入）
5. 三个视频的标题是否正确、是否与 AP 相关
6. 复核两处宣传文案：“AP相关全知道”“精选/自选名师AP视频”

## 许可证与商标
代码以 MIT 许可证发布（见 `LICENSE`）。AP® 是 College Board 的注册商标；Khan Academy、Google Classroom 为各自所有者的商标。本项目与上述机构无关，也未获得其认可。
