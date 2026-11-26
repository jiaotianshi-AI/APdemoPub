'use strict';
// 账号管理接口（第 2 步实现）
const { httpError } = require('./http');
module.exports = async function adminApi() { throw httpError(404, 'NOT_FOUND', '接口不存在。'); };
