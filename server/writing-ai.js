'use strict';
// 写作板块的 AI：每次“请提建议”只调用一次，同时完成打分和 5W 提问。只发文字，不发 PDF，所以所有服务商都能用。
// 发给 AI 的内容：年级（只发 “Grade 4” 这样的写法）、题目、轮次、当前作文、上一轮作文和分数。不含用户名等身份信息。
const ai = require('./ai');
const grades = require('./grades');
const settings = require('./settings');

const SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    feedback: { type: 'string' },
    done: { type: 'boolean' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['Who', 'What', 'When', 'Where', 'Why'] }, text: { type: 'string' }, quote: { type: 'string' } },
        required: ['type', 'text', 'quote'],
        additionalProperties: false
      }
    },
    safety_flag: { type: 'boolean' }
  },
  required: ['score', 'feedback', 'done', 'questions', 'safety_flag'],
  additionalProperties: false
};

function userMessage({ gradeCode, topic, round, maxRounds, minRounds, essay, previous, finish }) {
  const lines = [
    'WRITING_ROUND',
    `Grade: ${grades.forAi(gradeCode) || 'not set'}`,
    `Topic: ${topic}`,
    `Round: ${round} of at most ${maxRounds} (done may only be true from round ${minRounds} on${round >= maxRounds || finish ? '; this is the LAST round (the child chose to finish or the limit is reached), so set done = true and ask no questions' : ''})`
  ];
  if (previous) lines.push(`Previous essay (round ${previous.round}), score ${previous.score}/5:`, '<previous_essay>', previous.essay, '</previous_essay>');
  lines.push('Current essay:', '<student_essay>', essay, '</student_essay>');
  return lines.join('\n');
}

// 校验并整理 AI 的返回（程序规则优先：轮次不足不能结束，最后一轮必须结束）
function normalize(json, { round, minRounds, maxRounds, finish }) {
  const bad = (m) => new ai.AiError('AI_BAD_RESPONSE', m || 'AI 的回答格式不对，请重试。');
  if (!Number.isInteger(json.score) || json.score < 1 || json.score > 5) throw new ai.AiError('AI_BAD_SCORE', 'AI 返回的评分不是 1–5 的整数，已丢弃。请重试。');
  if (typeof json.feedback !== 'string' || !json.feedback.trim()) throw bad('AI 没有给出反馈，请重试。');
  let done = json.done === true;
  let questions = Array.isArray(json.questions) ? json.questions : [];
  questions = questions.filter((q) => q && typeof q.text === 'string' && q.text.trim()).slice(0, 3).map((q) => ({
    type: ['Who', 'What', 'When', 'Where', 'Why'].includes(q.type) ? q.type : 'What',
    text: q.text.trim().slice(0, 300),
    quote: typeof q.quote === 'string' ? q.quote.trim().slice(0, 300) : ''
  }));
  if (round < minRounds) done = false;
  if (round >= maxRounds || finish) done = true; // 最后一轮，或孩子点了“我写完了”：一定结束
  if (done) questions = [];
  else if (!questions.length) throw bad('AI 没有提出问题，请重试。');
  return { score: json.score, feedback: json.feedback.trim().slice(0, 2000), done, questions, safety: json.safety_flag === true };
}

async function advice(cfg, input) {
  const prompt = settings.getWritingPrompt().prompt;
  const r = await ai.askJson(cfg, { system: prompt, user: userMessage(input), schema: SCHEMA, maxTokens: 4000 });
  return Object.assign(normalize(r.json, input), { model: r.model, provider: r.provider, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
}

module.exports = { advice, normalize, userMessage, SCHEMA };
