'use strict';
const fs = require('fs');
const path = require('path');

const MAX_BODY = 64 * 1024;

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'TOO_LARGE', '请求内容过大。')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size === 0) return resolve({});
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return reject(httpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求格式不正确。'));
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
        resolve(v);
      } catch (e) {
        reject(httpError(400, 'BAD_JSON', '请求内容不是有效的 JSON。'));
      }
    });
  });
}

function sendJson(res, status, data, headers) {
  const body = JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}

function sendText(res, status, text, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(text);
}

function redirect(res, location, headers) {
  res.writeHead(302, Object.assign({ Location: location, 'Cache-Control': 'no-store' }, headers || {}));
  res.end();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// 只发送白名单扩展名的文件；调用方已保证路径在允许的目录内
function sendFile(req, res, filePath, extraHeaders) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext];
  if (!type) return sendText(res, 404, 'Not found');
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, 'Not found');
    const isHtml = ext === '.html';
    res.writeHead(200, Object.assign({
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': isHtml ? 'no-store' : 'no-cache'
    }, extraHeaders || {}));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { httpError, readJson, sendJson, sendText, redirect, sendFile };
