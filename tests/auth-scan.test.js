'use strict';
/**
 * Test offline cho auth.js + scan.js — KHÔNG gọi mạng.
 * Dùng fetch giả để kiểm tra logic login, chuẩn hoá item, hex->UUID, filter.
 * Chạy: node tests/auth-scan.test.js
 */
const assert = require('assert');
const { login, pickToken, InvalidCredentialsError } = require('../src/core/auth');
const {
  hexToUuid, normalizeItem, videoUrl, filterTodo, listAssigned, scanAll, TODO_STATUSES,
} = require('../src/core/scan');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Tạo fetch giả: route -> { status, body }. */
function mockFetch(routes) {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error('no mock route for ' + url);
    const r = routes[key];
    const status = r.status || 200;
    const body = r.body !== undefined ? r.body : r;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    };
  };
}

// ── auth ──
check('pickToken: lấy từ data.access_token', () => {
  assert.strictEqual(pickToken({ data: { access_token: 'abc' } }), 'abc');
});
check('pickToken: lấy từ data.token', () => {
  assert.strictEqual(pickToken({ data: { token: 'xyz' } }), 'xyz');
});
check('pickToken: rỗng khi thiếu', () => {
  assert.strictEqual(pickToken({ data: {} }), '');
});

const LOGIN_OK = { data: { access_token: 'JWT_TOKEN_12345678901234567890' } };
const RAW_ITEM = {
  subject: 'Khoa học tự nhiên', title: 'Bài 7. Lăng kính', courseTitle: 'KHTN 9 - Bài 7. Lăng kính',
  courseId: '8B37E17414BD47129964DB87E23F44C8', contentId: '6ac4fb8274d2c735683f467c',
  h5pContentId: 'ba23684b-0414-4f18-81bf-ae9cf64847fb', status: 'in_progress', isEssay: false,
  group: 'due', isOverdue: true,
};
const ASSIGNED_BODY = {
  data: {
    studentName: 'Nguyễn Văn A',
    items: [RAW_ITEM, { ...RAW_ITEM, h5pContentId: 'x', status: 'completed' }],
    summary: { overdue: { total: 1 }, dueSoon: { total: 0 }, new: { total: 1 } },
  },
};

(async () => {
  await checkAsync('login: thành công trả token', async () => {
    const token = await login('u', 'p', { fetchImpl: mockFetch({ hcm_login_v3: { status: 200, body: LOGIN_OK } }) });
    assert.strictEqual(token, 'JWT_TOKEN_12345678901234567890');
  });
  await checkAsync('login: sai tài khoản -> InvalidCredentialsError', async () => {
    await assert.rejects(
      () => login('u', 'p', { fetchImpl: mockFetch({ hcm_login_v3: { status: 200, body: { errors: [{ message: 'sai' }] } } }) }),
      (e) => e instanceof InvalidCredentialsError,
    );
  });
  await checkAsync('login: HTTP 401 -> InvalidCredentialsError', async () => {
    await assert.rejects(
      () => login('u', 'p', { fetchImpl: mockFetch({ hcm_login_v3: { status: 401, body: {} } }) }),
      (e) => e instanceof InvalidCredentialsError,
    );
  });
  await checkAsync('login: thiếu input -> InvalidCredentialsError', async () => {
    await assert.rejects(() => login('', '', { fetchImpl: mockFetch({}) }), (e) => e instanceof InvalidCredentialsError);
  });
  await checkAsync('login: gửi đúng body {username,password,loai}', async () => {
    let seen;
    const f = async (url, opts) => { seen = JSON.parse(opts.body); return { ok: true, status: 200, text: async () => JSON.stringify(LOGIN_OK), json: async () => LOGIN_OK }; };
    await login('myuser', 'mypass', { fetchImpl: f });
    assert.deepStrictEqual(seen, { username: 'myuser', password: 'mypass', loai: 'hoc_sinh' });
  });

  // ── scan ──
  check('hexToUuid: 32 hex -> UUID chuẩn', () => {
    assert.strictEqual(hexToUuid('8B37E17414BD47129964DB87E23F44C8'), '8b37e174-14bd-4712-9964-db87e23f44c8');
  });
  check('hexToUuid: giữ nguyên nếu đã là UUID', () => {
    const u = '8b37e174-14bd-4712-9964-db87e23f44c8';
    assert.strictEqual(hexToUuid(u), u);
  });
  check('normalizeItem: map đúng p/c/cs', () => {
    const n = normalizeItem(RAW_ITEM);
    assert.strictEqual(n.p, 'ba23684b-0414-4f18-81bf-ae9cf64847fb');
    assert.strictEqual(n.c, '6ac4fb8274d2c735683f467c');
    assert.strictEqual(n.cs, '8b37e174-14bd-4712-9964-db87e23f44c8');
    assert.strictEqual(n.status, 'in_progress');
  });
  check('videoUrl: dựng đúng URL xem-video', () => {
    const url = videoUrl(normalizeItem(RAW_ITEM));
    assert.strictEqual(url, 'https://lms360.vn/xem-video?p=ba23684b-0414-4f18-81bf-ae9cf64847fb&c=6ac4fb8274d2c735683f467c&cs=8b37e174-14bd-4712-9964-db87e23f44c8');
  });
  check('videoUrl: nhận item thô (chưa normalize)', () => {
    assert.ok(videoUrl(RAW_ITEM).includes('cs=8b37e174-14bd-4712-9964-db87e23f44c8'));
  });
  check('filterTodo: giữ not_started/in_progress, bỏ completed', () => {
    const items = [
      normalizeItem({ ...RAW_ITEM, status: 'not_started' }),
      normalizeItem({ ...RAW_ITEM, status: 'in_progress' }),
      normalizeItem({ ...RAW_ITEM, status: 'completed' }),
    ];
    const out = filterTodo(items);
    assert.strictEqual(out.length, 2);
    assert.ok(out.every((x) => TODO_STATUSES.has(x.status)));
  });
  check('filterTodo: skipEssay loại bài tự luận', () => {
    const items = [normalizeItem({ ...RAW_ITEM, isEssay: true }), normalizeItem(RAW_ITEM)];
    assert.strictEqual(filterTodo(items, { skipEssay: true }).length, 1);
  });
  check('filterTodo: blacklist theo môn', () => {
    const items = [normalizeItem({ ...RAW_ITEM, subject: 'Giáo dục thể chất' }), normalizeItem(RAW_ITEM)];
    assert.strictEqual(filterTodo(items, { blacklist: /thể chất/i }).length, 1);
  });
  await checkAsync('listAssigned: parse items + summary', async () => {
    const { items, summary, studentName } = await listAssigned('tok', { fetchImpl: mockFetch({ my_assigned_pending: { status: 200, body: ASSIGNED_BODY } }) });
    assert.strictEqual(items.length, 2);
    assert.strictEqual(studentName, 'Nguyễn Văn A');
    assert.strictEqual(summary.overdue.total, 1);
  });
  await checkAsync('scanAll: lọc todo đúng', async () => {
    const logs = [];
    const { todo, items } = await scanAll('tok', { fetchImpl: mockFetch({ my_assigned_pending: { status: 200, body: ASSIGNED_BODY } }), logger: (m) => logs.push(m) });
    assert.strictEqual(items.length, 2);
    assert.strictEqual(todo.length, 1);
    assert.ok(logs.some((l) => l.includes('Nguyễn Văn A')));
  });
  await checkAsync('scanAll: 401 -> throw', async () => {
    await assert.rejects(
      () => scanAll('bad', { fetchImpl: mockFetch({ my_assigned_pending: { status: 401, body: { errors: [{ code: 'access_denied_exception' }] } } }) }),
      /HTTP 401/,
    );
  });
  await checkAsync('scan: chỉ gửi 1 header authorization (không Content-Type cho GET)', async () => {
    let headers;
    const f = async (url, opts) => { headers = opts.headers; return { ok: true, status: 200, text: async () => JSON.stringify(ASSIGNED_BODY), json: async () => ASSIGNED_BODY }; };
    await listAssigned('tok', { fetchImpl: f });
    assert.deepStrictEqual(Object.keys(headers), ['authorization']);
    assert.strictEqual(headers.authorization, 'tok');
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} auth-scan: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();

