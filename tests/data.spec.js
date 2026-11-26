// T19 数据文件与 schema；T12 词典键一致（单元测试）
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

const pairs = [
  ["data/sites.json", "data/schema/site.schema.json"],
  ["data/videos.json", "data/schema/video.schema.json"],
  ["data/qa.sample.json", "data/schema/qa.schema.json"]
];

function walk(node, fn, key = "") {
  fn(node, key);
  if (Array.isArray(node)) node.forEach((v) => walk(v, fn, key));
  else if (node && typeof node === "object") Object.entries(node).forEach(([k, v]) => walk(v, fn, k));
}

for (const [dataFile, schemaFile] of pairs) {
  test(`T19 ${dataFile} 通过 schema 校验`, () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(read(schemaFile));
    const ok = validate(read(dataFile));
    expect(validate.errors, JSON.stringify(validate.errors)).toBeNull();
    expect(ok).toBe(true);
  });

  test(`T19 ${dataFile} 内容约定（双语非空、无邮箱、ID 前缀、时间带时区）`, () => {
    const data = read(dataFile);
    const idPrefix = {};
    walk(data, (node, key) => {
      if (node && typeof node === "object" && !Array.isArray(node) && ("zh" in node || "en" in node)) {
        expect(typeof node.zh === "string" && node.zh.trim().length > 0, `${dataFile} zh 为空`).toBe(true);
        expect(typeof node.en === "string" && node.en.trim().length > 0, `${dataFile} en 为空`).toBe(true);
      }
      if (typeof node === "string") {
        expect(/[^\s@]+@[^\s@]+\.[^\s@]+/.test(node), `出现邮箱格式字符串: ${node}`).toBe(false);
        if (idPrefix[key]) expect(node.startsWith(idPrefix[key])).toBe(true);
        if (key === "scheduledAt" || key === "gradedAt") expect(/(Z|[+-]\d{2}:\d{2})$/.test(node)).toBe(true);
      }
    });
    // 条目 id 前缀
    const want = { "data/sites.json": "site_", "data/videos.json": "vid_", "data/qa.sample.json": "qa_" }[dataFile];
    if (want) for (const it of data.items) expect(it.id.startsWith(want)).toBe(true);
  });
}

test("T12 中英文词典键集合完全相同", () => {
  const sandbox = { window: {}, document: { documentElement: {}, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} }, navigator: { language: "en" }, CustomEvent: function () {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js/i18n.js"), "utf8"), sandbox);
  const { zh, en } = sandbox.APi18n.dict;
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  for (const k of Object.keys(zh)) {
    expect(zh[k].trim().length, `zh ${k}`).toBeGreaterThan(0);
    expect(en[k].trim().length, `en ${k}`).toBeGreaterThan(0);
  }
});
