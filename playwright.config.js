// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 8765;
const MOCK_AI_PORT = 8766;
// 每次运行用全新的临时数据库（只用于测试，不含真实数据）
const DB = path.join(os.tmpdir(), "apdemo-e2e", "e2e.db");
process.env.APDEMO_DB = DB;
process.env.E2E_PORT = String(PORT);
process.env.MOCK_AI_PORT = String(MOCK_AI_PORT);
process.env.AI_MAX_PER_HOUR = "12"; // 与服务器一致（测试进程里的 config 也读它）

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
  webServer: [
    {
      // 假的 AI 服务（模拟 Anthropic 的 /v1/messages），测试不会访问真实的 AI 服务
      command: "node tests/mock-ai.js",
      url: `http://127.0.0.1:${MOCK_AI_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 20000,
      env: { ...process.env, MOCK_AI_PORT: String(MOCK_AI_PORT) }
    },
    {
      command: `sh -c 'mkdir -p "${path.dirname(DB)}" && rm -f "${DB}" "${DB}-wal" "${DB}-shm" "${path.dirname(DB)}/master.key" && exec node --disable-warning=ExperimentalWarning server/index.js'`,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: false,
      timeout: 20000,
      env: {
        ...process.env, PORT: String(PORT), HOST: "127.0.0.1", APDEMO_DB: DB, COOKIE_SECURE: "0",
        AI_API_BASE: `http://127.0.0.1:${MOCK_AI_PORT}`, AI_MAX_PER_HOUR: "12", AI_TEST_MIN_INTERVAL_MS: "0"
      }
    }
  ]
});
