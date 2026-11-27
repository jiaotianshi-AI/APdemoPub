/* 站点级配置。主品牌名暂用 Focus（未最终定稿），副标题（slogan）为 Focus. Steps. Progress.（专注每一步，持续前进）。 */
window.APConfig = {
  brandName: { zh: "Focus", en: "Focus" },
  slogan: { zh: "Focus. Steps. Progress.", en: "Focus. Steps. Progress." },
  // "static"：读取 data/*.json（本阶段唯一实现）；"remote"：预留，调用会抛 NOT_IMPLEMENTED
  dataSource: "static",
  apiBase: "" // 预留，本阶段不使用
};
