// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");

// 从"上一级目录"起服务：临时目录里放一个指向本仓库的 APdemo 链接，通过 /APdemo/ 子路径访问
const root = path.join(os.tmpdir(), "apdemo-serve");
fs.mkdirSync(root, { recursive: true });
const link = path.join(root, "APdemo");
try { fs.rmSync(link, { force: true }); } catch (e) { /* ignore */ }
fs.symlinkSync(__dirname, link, "dir");

const PORT = 8765;
const chromiumPath = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}/APdemo/`,
    trace: "off"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumPath ? { executablePath: chromiumPath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
      }
    },
    // WebKit 用来近似 iPad Safari（不等于真机）。仅在已安装 WebKit 时才有意义：npx playwright install webkit
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory "${root}"`,
    url: `http://localhost:${PORT}/APdemo/index.html`,
    reuseExistingServer: true,
    timeout: 20000
  }
});
