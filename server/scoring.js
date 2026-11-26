'use strict';
// 评分规则（集中放在这里，方便以后修改公式）。
//
// 每道题评分：1–5 的整数，可以为空（还没评）。
// 每道题有权重：1–100 的整数，默认 1，由家长/老师设定；权重越大，这道题对汇总评分的影响越大。
// 汇总评分 = 各题评分的加权平均值，四舍五入到整数（x.5 进位），范围 1–5：
//     加权平均 = Σ(权重 × 评分) ÷ Σ权重
//   · 只有每一道题都有评分时才计算汇总评分，并且这场测试的状态变为“已评分”；
//   · 只要有任何一道题评分为空，汇总评分为空，状态不是“已评分”。
//   · 所有题权重相同（例如都是默认的 1）时，就是普通的平均值。
// 例：Q1=5(权重 1)、Q2=3(权重 2)、Q3=4(权重 1) → (5×1+3×2+4×1) ÷ 4 = 3.75 → 汇总 4。
//
// 要改公式（例如去掉最低分、按其他方式取整）只需要改 summarize() 里的这一处，
// 页面上的说明文字在 assets/js/supervisor.js 的 FORMULA_TEXT，预览在同文件的 summarizeScores()。

const MIN_SCORE = 1;
const MAX_SCORE = 5;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 100;
const DEFAULT_WEIGHT = 1;

function isValidScore(v) {
  return Number.isInteger(v) && v >= MIN_SCORE && v <= MAX_SCORE;
}
function isValidWeight(v) {
  return Number.isInteger(v) && v >= MIN_WEIGHT && v <= MAX_WEIGHT;
}

// scores：按题号顺序排列的每道题评分（整数或 null）；weights：对应的权重（不传则都按 1）
// 返回：{ questionCount, scoredCount, average（已评分的题目的加权平均值，没有则 null）, overall（汇总评分，未评完则 null） }
function summarize(scores, weights) {
  const n = scores.length;
  let num = 0, den = 0, scored = 0, totalWeight = 0;
  scores.forEach((s, i) => {
    const w = weights && isValidWeight(weights[i]) ? weights[i] : DEFAULT_WEIGHT;
    totalWeight += w;
    if (isValidScore(s)) { num += w * s; den += w; scored += 1; }
  });
  const average = den > 0 ? num / den : null;
  const complete = n > 0 && scored === n;
  // 用整数运算做四舍五入（x.5 进位），避免浮点误差
  const overall = complete ? Math.floor((2 * num + den) / (2 * den)) : null;
  return { questionCount: n, scoredCount: scored, average, overall, totalWeight };
}

module.exports = { MIN_SCORE, MAX_SCORE, MIN_WEIGHT, MAX_WEIGHT, DEFAULT_WEIGHT, isValidScore, isValidWeight, summarize };
