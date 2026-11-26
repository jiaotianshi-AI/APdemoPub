'use strict';
// 上传文件（PDF）的保存、读取、清理。文件存在 uploadDir 里，用随机文件名，不能通过网址直接访问。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');
const { httpError } = require('./http');

fs.mkdirSync(config.uploadDir, { recursive: true });

function pathFor(storedName) {
  if (!/^[a-f0-9]{32}\.pdf$/.test(storedName)) throw new Error('bad stored name');
  return path.join(config.uploadDir, storedName);
}

function cleanName(raw) {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch (e) { name = String(raw || ''); }
  name = name.normalize('NFKC').replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) name = '文件';
  if ([...name].length > 120) name = [...name].slice(0, 120).join('');
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  return name;
}

// 接收请求体并保存为 PDF；检查大小上限和文件头（%PDF-）
function saveUpload(req, uploaderId) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/pdf') return reject(httpError(415, 'NOT_PDF', '只能上传 PDF 文件。'));
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > config.maxUploadBytes) return reject(httpError(413, 'FILE_TOO_LARGE', `文件不能超过 ${Math.round(config.maxUploadBytes / 1048576)}MB。`));

    const pending = db.prepare(`SELECT COUNT(*) AS n FROM files f WHERE f.uploaded_by = ?
      AND NOT EXISTS (SELECT 1 FROM assessment_files af WHERE af.file_id = f.id)`).get(uploaderId).n;
    if (pending >= config.maxPendingUploads) return reject(httpError(429, 'TOO_MANY_PENDING', '有太多还没使用的文件，请先提交或删除后再上传。'));

    const storedName = crypto.randomBytes(16).toString('hex') + '.pdf';
    const full = pathFor(storedName);
    const out = fs.createWriteStream(full, { flags: 'wx', mode: 0o600 });
    let size = 0;
    let head = Buffer.alloc(0);
    let failed = false;

    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.unlink(full, () => {});
      req.resume();
      reject(err);
    };

    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (head.length < 5) head = Buffer.concat([head, chunk.subarray(0, 5 - head.length)]);
      if (size > config.maxUploadBytes) return fail(httpError(413, 'FILE_TOO_LARGE', `文件不能超过 ${Math.round(config.maxUploadBytes / 1048576)}MB。`));
      if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('error', () => fail(httpError(400, 'UPLOAD_FAILED', '上传中断，请重试。')));
    req.on('aborted', () => fail(httpError(400, 'UPLOAD_FAILED', '上传中断，请重试。')));
    req.on('end', () => {
      if (failed) return;
      out.end(() => {
        if (size === 0 || head.toString('latin1') !== '%PDF-') {
          fs.unlink(full, () => {});
          return reject(httpError(422, 'NOT_PDF', '这个文件不是有效的 PDF。'));
        }
        const info = db.prepare('INSERT INTO files (stored_name, original_name, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(storedName, cleanName(req.headers['x-file-name']), size, uploaderId, new Date().toISOString());
        resolve({ id: Number(info.lastInsertRowid), name: db.prepare('SELECT original_name FROM files WHERE id = ?').get(info.lastInsertRowid).original_name, size });
      });
    });
  });
}

function removeFileRow(row) {
  db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
  fs.unlink(pathFor(row.stored_name), () => {});
}

// 关联被移除后调用：没有任何测试再用这个文件时，立即删除
function deleteIfUnreferenced(fileIds) {
  const q = db.prepare('SELECT * FROM files WHERE id = ? AND NOT EXISTS (SELECT 1 FROM assessment_files WHERE file_id = ?)');
  for (const id of fileIds) {
    const row = q.get(id, id);
    if (row) removeFileRow(row);
  }
}

// 清理没有被任何测试使用的文件（上传后一直没提交，或所属测试已被删除）；graceMinutes 内上传的先保留
function gcFiles(graceMinutes) {
  const cutoff = new Date(Date.now() - graceMinutes * 60000).toISOString();
  const rows = db.prepare(`SELECT * FROM files f WHERE f.created_at < ?
    AND NOT EXISTS (SELECT 1 FROM assessment_files af WHERE af.file_id = f.id)`).all(cutoff);
  rows.forEach(removeFileRow);
  return rows.length;
}

// 发送 PDF：内联显示。不用 CSP sandbox（会让浏览器内置的 PDF 查看器无法显示），改为禁止一切其他资源，并只允许本站页面嵌入
function sendPdf(req, res, f) {
  fs.stat(pathFor(f.stored_name), (err, st) => {
    if (err) return require('./http').sendJson(res, 404, { error: 'NOT_FOUND', message: '没有找到这个文件。' });
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': st.size,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
      'Cache-Control': 'private, no-store'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(pathFor(f.stored_name)).pipe(res);
  });
}

module.exports = { saveUpload, deleteIfUnreferenced, gcFiles, pathFor, sendPdf };
