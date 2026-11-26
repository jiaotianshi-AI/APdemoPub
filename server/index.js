'use strict';
const http = require('http');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const authRoutes = require('./routes-auth');
const adminApi = require('./routes-admin');
const supervisorApi = require('./routes-supervisor');
const files = require('./files');
const { httpError, sendJson, sendText, redirect, sendFile } = require('./http');

const PAGES = path.join(config.root, 'pages');
const PAGE_CSP = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

// 未登录也能访问的文件（登录页本身需要）
const PUBLIC_FILES = new Set(['/assets/css/auth.css', '/assets/js/login.js']);
// 修改初始密码前允许访问的文件
const CHANGE_PW_FILES = new Set(['/assets/css/auth.css', '/assets/js/change-password.js']);
// 仅特定角色可取的文件
const ROLE_FILES = {
  '/assets/css/admin.css': 'admin', '/assets/js/admin.js': 'admin',
  '/assets/css/supervisor.css': 'supervisor', '/assets/js/supervisor.js': 'supervisor'
};

const PAGE_ROUTES = {
  '/': { role: 'student', file: path.join(config.root, 'index.html'), ownCsp: true }, // 学生页自带 meta CSP（需允许 YouTube）
  '/index.html': { role: 'student', file: path.join(config.root, 'index.html'), ownCsp: true },
  '/supervisor': { role: 'supervisor', file: path.join(PAGES, 'supervisor.html') },
  '/pending': { role: 'support', file: path.join(PAGES, 'pending.html') },
  '/admin': { role: 'admin', file: path.join(PAGES, 'admin.html') },
  '/change-password': { role: null, file: path.join(PAGES, 'change-password.html') }
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Robots-Tag', 'noindex');
}

function currentAuth(req) {
  const token = auth.parseCookies(req.headers.cookie)[config.cookieName];
  return { token, account: auth.getAccountBySession(token) };
}

// 防跨站请求：带 Origin 时必须与本站一致；写操作必须带自定义请求头
function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch (e) { /* ignore */ }
    if (host !== req.headers.host) throw httpError(403, 'BAD_ORIGIN', '请求来源不被允许。');
  }
  if (req.headers['x-requested-with'] !== 'apdemo') throw httpError(403, 'BAD_REQUEST_HEADER', '请求缺少必要的标识。');
}

async function handleApi(req, res, pathname) {
  checkCsrf(req);
  const ctx = currentAuth(req);

  if (req.method === 'POST' && pathname === '/api/login') return authRoutes.login(req, res);
  if (!ctx.account) throw httpError(401, 'UNAUTHENTICATED', '请先登录。');

  if (req.method === 'GET' && pathname === '/api/me') return sendJson(res, 200, authRoutes.me(ctx.account));
  if (req.method === 'POST' && pathname === '/api/logout') return authRoutes.logout(req, res, ctx);
  if (req.method === 'POST' && pathname === '/api/change-password') return authRoutes.changePassword(req, res, ctx);

  if (ctx.account.must_change_password) throw httpError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改初始密码。');

  if (pathname.startsWith('/api/admin/')) {
    if (ctx.account.type !== 'admin') throw httpError(403, 'FORBIDDEN', '没有权限。');
    return adminApi(req, res, pathname, ctx);
  }
  if (pathname.startsWith('/api/supervisor/')) {
    if (ctx.account.type !== 'supervisor') throw httpError(403, 'FORBIDDEN', '没有权限。');
    return supervisorApi(req, res, pathname, ctx);
  }
  throw httpError(404, 'NOT_FOUND', '接口不存在。');
}

function safeJoin(base, rel) {
  const full = path.resolve(base, '.' + path.sep + rel);
  return full.startsWith(base + path.sep) ? full : null;
}

function handlePage(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  if (pathname.length > 1 && pathname.endsWith('/')) return redirect(res, pathname.replace(/\/+$/, '') || '/');

  const { account } = currentAuth(req);
  const pageHeaders = { 'Content-Security-Policy': PAGE_CSP };

  if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

  if (pathname === '/login') {
    if (account) return redirect(res, authRoutes.homeFor(account));
    return sendFile(req, res, path.join(PAGES, 'login.html'), pageHeaders);
  }
  if (PUBLIC_FILES.has(pathname)) return sendFile(req, res, safeJoin(config.root, pathname.slice(1)));

  if (!account) {
    if (pathname.startsWith('/assets/') || pathname.startsWith('/data/')) return sendText(res, 401, 'Unauthorized');
    return redirect(res, '/login');
  }

  if (account.must_change_password) {
    if (pathname === '/change-password') return sendFile(req, res, PAGE_ROUTES[pathname].file, pageHeaders);
    if (CHANGE_PW_FILES.has(pathname)) return sendFile(req, res, safeJoin(config.root, pathname.slice(1)));
    return redirect(res, '/change-password');
  }

  const route = PAGE_ROUTES[pathname];
  if (route) {
    if (route.role && route.role !== account.type) return redirect(res, authRoutes.homeFor(account));
    return sendFile(req, res, route.file, route.ownCsp ? {} : pageHeaders);
  }

  if (pathname.startsWith('/assets/') || pathname.startsWith('/data/')) {
    if (ROLE_FILES[pathname] && ROLE_FILES[pathname] !== account.type) return sendText(res, 403, 'Forbidden');
    const file = safeJoin(config.root, pathname.slice(1));
    return file ? sendFile(req, res, file) : sendText(res, 404, 'Not found');
  }
  return sendText(res, 404, 'Not found');
}

async function handle(req, res) {
  securityHeaders(res);
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { return sendText(res, 400, 'Bad request'); }
  if (pathname.includes('\0')) return sendText(res, 400, 'Bad request');
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return handlePage(req, res, pathname);
  } catch (err) {
    if (err && err.status) {
      return pathname.startsWith('/api/')
        ? sendJson(res, err.status, { error: err.code, message: err.message })
        : sendText(res, err.status, err.message);
    }
    console.error('[error]', req.method, pathname, err && err.stack ? err.stack.split('\n')[0] : err);
    return pathname.startsWith('/api/')
      ? sendJson(res, 500, { error: 'INTERNAL', message: '服务器出错了，请稍后再试。' })
      : sendText(res, 500, 'Internal Server Error');
  }
}

auth.purgeExpiredSessions();
files.gcFiles(24 * 60);
setInterval(() => { auth.purgeExpiredSessions(); files.gcFiles(24 * 60); }, 3600 * 1000).unref();

http.createServer(handle).listen(config.port, config.host, () => {
  console.log(`APdemo server listening on http://${config.host}:${config.port}`);
});
