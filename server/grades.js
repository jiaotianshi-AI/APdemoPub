'use strict';
// 年级：Pre-K 到 Grade 12（不含大学）。账号里只存代码，不存生日、年龄。
const LIST = [{ code: 'PK', label: { zh: 'Pre-K（学前）', en: 'Pre-K' } }, { code: 'K', label: { zh: 'Kindergarten（幼儿园）', en: 'Kindergarten' } }];
for (let n = 1; n <= 12; n++) LIST.push({ code: String(n), label: { zh: `Grade ${n}`, en: `Grade ${n}` } });

function isValid(code) { return typeof code === 'string' && LIST.some((g) => g.code === code); }
function label(code) { const g = LIST.find((x) => x.code === code); return g ? g.label : null; }
// 发给 AI 的写法，只含年级本身，例如 "Grade 4"、"Kindergarten"
function forAi(code) { const l = label(code); return l ? l.en : null; }

module.exports = { LIST, isValid, label, forAi };
