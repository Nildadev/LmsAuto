'use strict';
/**
 * _creds.js — đọc credentials cho script debug mà KHÔNG in giá trị.
 * Thứ tự: biến môi trường LMS_USERNAME/LMS_PASSWORD → file secrets (2 dòng user/pass
 * hoặc dạng key: value). File mặc định usersecret.txt (đã .gitignore).
 */
const fs = require('fs');
const path = require('path');

function readCreds(opts = {}) {
  if (process.env.LMS_USERNAME && process.env.LMS_PASSWORD) {
    return { username: process.env.LMS_USERNAME, password: process.env.LMS_PASSWORD, from: 'env' };
  }
  const file = opts.secretFile || process.env.LMS_SECRET_FILE || 'usersecret.txt';
  const p = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(p)) throw new Error(`Không tìm thấy file secrets: ${p}`);
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let username;
  let password;
  if (lines.length >= 2) [username, password] = lines;
  else {
    const one = lines[0] || '';
    const m = one.match(/^(.*?):(.*)$/) || one.match(/^(.*?)=(.*)$/);
    if (!m) throw new Error('Định dạng file secrets không nhận diện được (cần 2 dòng user/pass).');
    [, username, password] = m;
  }
  username = String(username || '').trim();
  password = String(password || '').trim();
  if (!username || !password) throw new Error('Thiếu tài khoản hoặc mật khẩu trong file secrets.');
  return { username, password, from: path.basename(p) };
}

const mask = (u) => (u.length <= 2 ? '*' : `${u[0]}***${u.slice(-1)}`);

module.exports = { readCreds, mask };
