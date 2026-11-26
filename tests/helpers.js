const path = require("path");
const PASSWORD = "E2e-Passw0rd!";
const state = (role) => path.join(__dirname, ".auth", role + ".json");
const ANON = { cookies: [], origins: [] };
// API 请求默认头（服务器要求写操作带 X-Requested-With）
const H = { "X-Requested-With": "apdemo" };
let counter = 0;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
module.exports = { PASSWORD, state, ANON, H, uid };
