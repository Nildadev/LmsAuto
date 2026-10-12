'use strict';
/**
 * Test offline cho doc.js — KHÔNG gọi mạng. Inject fetch giả để kiểm tra:
 *   - viewH5pContent: gọi đúng endpoint view_h5p_content + body.
 *   - markComplete  : gọi đúng learn_status với status=3 (endpoint hoàn thành).
 *   - solveDoc      : thiếu id -> fail mềm; có id -> gọi cả 2 rồi trả solved.
 * Chạy: node tests/doc.test.js
 */
const assert = require('assert');
const { viewH5pContent, markComplete, solveDoc } = require('../src/h5p/doc');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Thay global.fetch bằng bản ghi lại các call, trả {ok:true,status:200,text}. */
function fakeFetch(responder) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    return responder(calls.length, calls[calls.length - 1]);
  };
  const ok = () => ({ ok: true, status: 200, text: async () => '{"data":{"status":"success"}}' });
  return { calls, ok };
}

(async () => {
  console.log('doc.js');

  await check('viewH5pContent: POST view_h5p_content, body {h5p_content_id, content_id}', async () => {
    const f = fakeFetch(() => f.ok());
    await viewH5pContent('TOK', 'P1', 'C1', () => {}, { apiBase: 'http://x/gd/v3' });
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, 'http://x/gd/v3/h5p/view_h5p_content');
    assert.strictEqual(f.calls[0].method, 'POST');
    assert.deepStrictEqual(f.calls[0].body, { h5p_content_id: 'P1', content_id: 'C1' });
    assert.strictEqual(f.calls[0].headers.authorization, 'TOK');
  });

  await check('viewH5pContent: content_id rỗng vẫn gửi ""', async () => {
    const f = fakeFetch(() => f.ok());
    await viewH5pContent('TOK', 'P1', undefined, () => {}, { apiBase: 'http://x' });
    assert.strictEqual(f.calls[0].body.content_id, '');
  });

  await check('markComplete: POST learn_status voi status=3 (ENDPOINT HOAN THANH)', async () => {
    const f = fakeFetch(() => f.ok());
    await markComplete('TOK', 'P1', 'CS1', () => {}, { apiBase: 'http://x/gd/v3' });
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, 'http://x/gd/v3/h5p/contents/learn_status');
    assert.strictEqual(f.calls[0].method, 'POST');
    assert.deepStrictEqual(f.calls[0].body, { h5p_content_id: 'P1', status: 3, h5p_course_id: 'CS1' });
  });

  await check('markComplete: fetch nem loi -> ok=false (khong throw)', async () => {
    fakeFetch(() => { throw new Error('network down'); });
    const r = await markComplete('TOK', 'P1', 'CS1', () => {}, { apiBase: 'http://x' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 0);
  });

  await check('solveDoc: thieu id -> fail mem, KHONG goi mang', async () => {
    const f = fakeFetch(() => f.ok());
    const r = await solveDoc({}, 'TOK', () => {}, { apiBase: 'http://x' });
    assert.strictEqual(f.calls.length, 0, 'khong duoc goi fetch khi thieu id');
    assert.strictEqual(r.solved, false);
    assert.strictEqual(r.reason, 'doc-missing-id');
  });

  await check('solveDoc: co id -> goi view roi markComplete (2 calls, dung thu tu)', async () => {
    const f = fakeFetch(() => f.ok());
    const r = await solveDoc({ p: 'P1', c: 'C1', cs: 'CS1' }, 'TOK', () => {}, { apiBase: 'http://x/gd/v3' });
    assert.strictEqual(f.calls.length, 2);
    assert.ok(/view_h5p_content$/.test(f.calls[0].url), 'call 1 = view');
    assert.ok(/learn_status$/.test(f.calls[1].url), 'call 2 = learn_status(complete)');
    assert.strictEqual(f.calls[1].body.status, 3);
    assert.strictEqual(r.solved, true);
    assert.strictEqual(r.kind, 'doc');
    assert.strictEqual(r.status, 200);
  });

  await check('solveDoc: opts.view=false -> bo qua view, chi markComplete', async () => {
    const f = fakeFetch(() => f.ok());
    await solveDoc({ p: 'P1', c: 'C1', cs: 'CS1' }, 'TOK', () => {}, { apiBase: 'http://x/gd/v3', view: false });
    assert.strictEqual(f.calls.length, 1);
    assert.ok(/learn_status$/.test(f.calls[0].url));
    assert.strictEqual(f.calls[0].body.status, 3);
  });

  await check('solveDoc: markComplete fail -> solved=false', async () => {
    fakeFetch((n) => (n === 1 ? { ok: true, status: 200, text: async () => '{}' } : { ok: false, status: 500, text: async () => 'err' }));
    const r = await solveDoc({ p: 'P1', c: '', cs: 'CS1' }, 'TOK', () => {}, { apiBase: 'http://x' });
    assert.strictEqual(r.solved, false);
    assert.strictEqual(r.status, 500);
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} doc: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
