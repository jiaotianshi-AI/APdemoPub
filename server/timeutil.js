'use strict';
// 把“某时区的当地时间”转成带偏移的 ISO 时间。偏移取自服务器的时区数据；
// 页面显示用当地时间本身，倒计时用这里算出的精确时刻。

function offsetMinutes(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(utcMs));
  const p = {};
  parts.forEach((x) => { p[x.type] = x.value; });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

function validDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function fmtOffset(min) {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
}

// wall: 'YYYY-MM-DDTHH:MM'；返回 { iso: '...T..:..:00-07:00', ms } 或 null（格式或日期无效）
function wallToIso(wall, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(wall));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (!validDate(y, mo, d) || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetMinutes(guess, tz);
  let instant = guess - off * 60000;
  const off2 = offsetMinutes(instant, tz);
  if (off2 !== off) { off = off2; instant = guess - off * 60000; }
  return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${fmtOffset(off)}`, ms: instant };
}

function dateToIso(date, tz) { // 'YYYY-MM-DD' → 当天 00:00
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  return wallToIso(date + 'T00:00', tz);
}

module.exports = { wallToIso, dateToIso, validDate };
