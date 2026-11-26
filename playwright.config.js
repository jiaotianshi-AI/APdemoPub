// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 8765;
// 每次运行用全新的临时数据库（只用于测试，不含真实数据）
const DB = path.join(os.tmpdir(), "apdemo-e2e", "e2e.db");
process.env.APDEMO_DB = DB;
process.env.E2E_PORT = String(PORT);

const chromiumPath = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const authDir = path.join(__dirname, "tests", ".auth");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  globalSetup: require.resolve("./tests/global-setup.js"),
  use: {
    baseURL: `http://localhost:${PORT}/`,
    storageState: path.join(authDir, "student.json"), // 默认以测试学生身份登录；其他身份在用例里覆盖
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
    // WebKit 用来近似 iPad Safari（不等于真机）。需要先安装：npx playwright install webkit
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: `sh -c 'mkdir -p "${path.dirname(DB)}" && rm -f "${DB}" "${DB}-wal" "${DB}-shm" && exec node --disable-warning=ExperimentalWarning server/index.js'`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 20000,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", APDEMO_DB: DB, COOKIE_SECURE: "0" }
  }
});
