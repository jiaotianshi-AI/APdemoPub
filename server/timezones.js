'use strict';
// 账号可选的时区（IANA 名 + 中英文城市名）。默认温哥华。要增减可选时区，改这个列表即可。
const { offsetMinutes } = require('./timeutil');

const DEFAULT_TZ = 'America/Vancouver';

const LIST = [
  { id: 'America/Vancouver', zh: '温哥华', en: 'Vancouver' },
  { id: 'America/Edmonton', zh: '埃德蒙顿', en: 'Edmonton' },
  { id: 'America/Winnipeg', zh: '温尼伯', en: 'Winnipeg' },
  { id: 'America/Toronto', zh: '多伦多', en: 'Toronto' },
  { id: 'America/Halifax', zh: '哈利法克斯', en: 'Halifax' },
  { id: 'America/Los_Angeles', zh: '洛杉矶', en: 'Los Angeles' },
  { id: 'America/Denver', zh: '丹佛', en: 'Denver' },
  { id: 'America/Chicago', zh: '芝加哥', en: 'Chicago' },
  { id: 'America/New_York', zh: '纽约', en: 'New York' },
  { id: 'Europe/London', zh: '伦敦', en: 'London' },
  { id: 'Europe/Paris', zh: '巴黎', en: 'Paris' },
  { id: 'Europe/Berlin', zh: '柏林', en: 'Berlin' },
  { id: 'Asia/Dubai', zh: '迪拜', en: 'Dubai' },
  { id: 'Asia/Kolkata', zh: '新德里', en: 'New Delhi' },
  { id: 'Asia/Bangkok', zh: '曼谷', en: 'Bangkok' },
  { id: 'Asia/Shanghai', zh: '北京', en: 'Beijing' },
  { id: 'Asia/Hong_Kong', zh: '香港', en: 'Hong Kong' },
  { id: 'Asia/Singapore', zh: '新加坡', en: 'Singapore' },
  { id: 'Asia/Taipei', zh: '台北', en: 'Taipei' },
  { id: 'Asia/Tokyo', zh: '东京', en: 'Tokyo' },
  { id: 'Asia/Seoul', zh: '首尔', en: 'Seoul' },
  { id: 'Australia/Sydney', zh: '悉尼', en: 'Sydney' },
  { id: 'Pacific/Auckland', zh: '奥克兰', en: 'Auckland' }
];
const BY_ID = new Map(LIST.map((z) => [z.id, z]));

function isValid(id) { return typeof id === 'string' && BY_ID.has(id); }

// 当前的 UTC 偏移，写成 -7、+8、+5:30 这样的短格式
function offsetText(id, atMs) {
  const min = offsetMinutes(atMs === undefined ? Date.now() : atMs, id);
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  const h = Math.floor(a / 60), m = a % 60;
  return sign + h + (m ? ':' + String(m).padStart(2, '0') : '');
}

// 例：{ zh: '温哥华，-7', en: 'Vancouver, -7' }
function label(id) {
  const z = BY_ID.get(id) || BY_ID.get(DEFAULT_TZ);
  const off = offsetText(z.id);
  return { zh: `${z.zh}，${off}`, en: `${z.en}, ${off}` };
}

function publicList() { return LIST.map((z) => Object.assign({}, z, { label: label(z.id) })); }

module.exports = { DEFAULT_TZ, LIST, isValid, offsetText, label, publicList };
