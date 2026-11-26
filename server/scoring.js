'use strict';
// 评分规则（集中放在这里，方便以后修改公式）。
//
// 每道题评分：1–5 的整数，可以为空（还没评）。
// 汇总评分 = 所有题目评分的平均值，四舍五入到整数（x.5 进位），范围 1–5。
//   · 只有每一道题都有评分时才计算汇总评分，并且这场测试的状态变为“已评分”；
//   · 只要有任何一道题评分为空，汇总评分为空，状态不是“已评分”。
// 例：Q1=5, Q2=3, Q3=4 → 平均 4.0 → 汇总 4；Q1=5, Q2=4 → 平均 4.5 → 汇总 5。
//
// 要改公式（例如按题目权重加权、去掉最低分）只需要改 summarize() 里的这一处，
// 页面上的说明文字在 assets/js/supervisor.js 的 FORMULA_TEXT。

const MIN_SCORE = 1;
const MAX_SCORE = 5;

function isValidScore(v) {
  return Number.isInteger(v) && v >= MIN_SCORE && v <= MAX_SCORE;
}

// scores：按题号顺序排列的每道题评分（整数或 null）
// 返回：{ questionCount, scoredCount, average（已评分的题目的平均值，没有则 null）, overall（汇总评分，未评完则 null） }
function summarize(scores) {
  const n = scores.length;
  const have = scores.filter(isValidScore);
  const sum = have.reduce((a, b) => a + b, 0);
  const average = have.length ? sum / have.length : null;
  const complete = n > 0 && have.length === n;
  // 用整数运算做四舍五入（x.5 进位），避免浮点误差
  const overall = complete ? Math.floor((2 * sum + n) / (2 * n)) : null;
  return { questionCount: n, scoredCount: have.length, average, overall };
}

module.exports = { MIN_SCORE, MAX_SCORE, isValidScore, summarize };
