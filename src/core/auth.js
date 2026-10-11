'use strict';
/**
 * auth.js — Đăng nhập LMS360 qua API (không cần DOM/SSO redirect).
 *
 * Reverse-engineered (docs/H5P-ANSWER-MAP.md):
 *   POST https://lms360.vn/api/gd/v3/hcm_login_v3
 *        { username, password, loai: 'hoc_sinh' }
 *   -> { data: { access_token: <JWT> } }
 *
 * Token sau đó được inject vào localStorage['AccessToken'] + cookie
 * 'access_token' (xem stealth.injectTokenScript) trước khi mở browser.
 *
 * Lợi ích so với flow DOM cũ: nhanh, ổn định, không phụ thuộc selector SSO,
 * và phát hiện sai tài khoản rõ ràng (throw INVALID_CREDENTIALS).
 */
const API_BASE = 'https://lms360.vn/api/gd/v3';

/** Lỗi đăng nhập sai tài khoản/mật khẩu (dùng để phân biệt với lỗi mạng). */
class InvalidCredentialsError extends Error {
  constructor(msg) { super(msg || 'INVALID_CREDENTIALS'); this.name = 'InvalidCredentialsError'; this.code = 'INVALID_CREDENTIALS'; }
}

/** Trích token từ response login (nhiều version trả ở vị trí khác nhau). */
function pickToken(body) {
  const d = body && body.data;
  return (
    (d && (d.token || d.access_token)) ||
    (d && d.data && d.data.token) ||
    (body && body.token) ||
    ''
  );
}

/**
 * Đăng nhập và trả về JWT.
 * @param {string} username
 * @param {string} password
 * @param {object} [opts] { fetchImpl, apiBase, timeoutMs, logger }
 * @returns {Promise<string>} access_token (JWT)
 * @throws {InvalidCredentialsError} khi sai tài khoản
 */
async function login(username, password, opts = {}) {
  const logger = opts.logger || (() => {});
  const apiBase = opts.apiBase || API_BASE;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch không khả dụng (cần Node 18+ hoặc truyền fetchImpl)');
  if (!username || !password) throw new InvalidCredentialsError('Thiếu tài khoản hoặc mật khẩu');

  const ac = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ac.abort(), opts.timeoutMs) : null;
  let res, body;
  try {
    logger(`🔑 Đăng nhập API: ${apiBase}/hcm_login_v3`);
    res = await fetchImpl(`${apiBase}/hcm_login_v3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, loai: 'hoc_sinh' }),
      signal: ac.signal,
    });
    body = await res.json().catch(() => ({}));
  } finally {
    if (timer) clearTimeout(timer);
  }

  const token = pickToken(body);
  // H5P API: sai tài khoản -> 200 kèm errors[], hoặc 4xx. Chỉ chấp nhận khi có token.
  if (!res.ok || !token) {
    const msg = (body && (body.errors || body.message)) || `HTTP ${res.status}`;
    logger(`❌ Đăng nhập thất bại: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    throw new InvalidCredentialsError();
  }
  logger(`✅ Đăng nhập OK (token ${String(token).length} ký tự)`);
  return token;
}

module.exports = { login, pickToken, InvalidCredentialsError, API_BASE };
