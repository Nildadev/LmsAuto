'use strict';
/**
 * _token.js — Nguồn token dùng chung cho các script debug/verify.
 * Thứ tự ưu tiên:
 *   1. biến môi trường LMS_TOKEN
 *   2. file token cũ (/tmp/token.txt) — để tương thích ngược
 *   3. đăng nhập qua API bằng LMS_USERNAME/LMS_PASSWORD
 * Trả '' nếu không tìm được (script tự xử lý).
 */
const fs = require('fs');
const { login } = require('../src/core/auth');

const TOKEN_FILE = process.env.LMS_TOKEN_FILE || '/tmp/token.txt';

/** @returns {Promise<string>} token hoặc '' */
async function resolveToken() {
  if (process.env.LMS_TOKEN) return process.env.LMS_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  }
  const username = process.env.LMS_USERNAME;
  const password = process.env.LMS_PASSWORD;
  if (username && password) {
    try { return await login(username, password); } catch (_) { return ''; }
  }
  return '';
}

module.exports = { resolveToken, TOKEN_FILE };
