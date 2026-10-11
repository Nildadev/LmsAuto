'use strict';
/**
 * Test offline cho flow.js — KHÔNG mở browser, KHÔNG gọi mạng.
 * Tiêm (inject) deps giả để kiểm tra điều phối: login→scan→solve→report.
 * Chạy: node tests/flow.test.js
 */
const assert = require('assert');
const { runFlow, solveItem, deps } = require('../src/core/flow');

let passed = 0, failed = 0;
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Frame giả tối thiểu cho solveItem (không chạm Playwright). */
const fakePage = { goto: async () => {}, mouse: { click: async () => {} } };
const fakeFrame = {
  locator: () => ({ first: () => ({ boundingBox: async () => null }) }),
};

/** Deps giả: ghi lại các lời gọi để kiểm tra thứ tự/đối số. */
function fakeDeps(over = {}) {
  const calls = { launch: 0, scan: 0, solveBook: 0, solveVideo: 0 };
  const base = {
    launch: async (o) => { calls.launch++; calls.launchOpts = o; return { browser: { close: async () => {} }, context: { close: async () => {} }, page: fakePage, token: o.token || 'TOK' }; },
    sleep: async () => {},
    scanAll: async (token, o) => { calls.scan++; calls.scanOpts = o; return { items: [], todo: over.todo || [], summary: { overdue: { total: 0 } }, studentName: 'HS Test' }; },
    videoUrl: (it) => `https://x/${it.contentId}`,
    dismissAll: async () => {},
    findPlayerFrame: async () => fakeFrame,
    detectKind: async () => ({ kind: over.kind || 'book', library: 'H5P.CoursePresentation 1.25' }),
    solveBook: async () => { calls.solveBook++; return { solved: 2, slides: 2, finalScore: { bar: '100%' } }; },
    solveVideo: async () => { calls.solveVideo++; return { solved: 1, finalScore: { bar: '100%' } }; },
    DEFAULT_BLACKLIST: /NEVER/i,
  };
  return { d: { ...base, ...over.deps }, calls };
}

(async () => {
  console.log('flow.js');

  await checkAsync('runFlow: dry-run chỉ liệt kê, KHÔNG solve', async () => {
    const { d, calls } = fakeDeps({ todo: [{ title: 'A', subject: 'Toán', contentId: 'c1' }, { title: 'B', subject: 'Lý', contentId: 'c2' }] });
    const rep = await runFlow({ token: 'T', dryRun: true, logger: () => {}, deps: d });
    assert.strictEqual(rep.total, 2);
    assert.strictEqual(rep.items.length, 2);
    assert.ok(rep.items.every((i) => i.dryRun));
    assert.strictEqual(calls.solveBook, 0, 'dry-run không được solve');
    assert.strictEqual(calls.launch, 1);
  });

  await checkAsync('runFlow: limit cắt danh sách', async () => {
    const { d } = fakeDeps({ todo: [{ title: 'A', contentId: 'c1' }, { title: 'B', contentId: 'c2' }, { title: 'C', contentId: 'c3' }] });
    const rep = await runFlow({ token: 'T', dryRun: true, limit: 2, logger: () => {}, deps: d });
    assert.strictEqual(rep.total, 2);
  });

  await checkAsync('runFlow: giải hết, report solved + studentName', async () => {
    const { d, calls } = fakeDeps({ todo: [{ title: 'A', subject: 'Toán', contentId: 'c1' }, { title: 'B', subject: 'Lý', contentId: 'c2' }] });
    const rep = await runFlow({ token: 'T', logger: () => {}, deps: d });
    assert.strictEqual(rep.solved, 2);
    assert.strictEqual(rep.failed, 0);
    assert.strictEqual(rep.studentName, 'HS Test');
    assert.strictEqual(calls.solveBook, 2);
  });

  await checkAsync('runFlow: lỗi 1 bài không dừng cả flow', async () => {
    let n = 0;
    const { d } = fakeDeps({ todo: [{ title: 'A', contentId: 'c1' }, { title: 'B', contentId: 'c2' }] });
    d.solveBook = async () => { n++; if (n === 1) throw new Error('boom'); return { solved: 1, finalScore: { bar: '100%' } }; };
    const rep = await runFlow({ token: 'T', logger: () => {}, deps: d });
    assert.strictEqual(rep.solved, 1);
    assert.strictEqual(rep.failed, 1);
    assert.strictEqual(rep.items[0].kind, 'error');
  });

  await checkAsync('runFlow: blacklist mặc định khi opts.blacklist undefined', async () => {
    const { d, calls } = fakeDeps({ todo: [] });
    await runFlow({ token: 'T', dryRun: true, logger: () => {}, deps: d });
    assert.strictEqual(calls.scanOpts.blacklist, d.DEFAULT_BLACKLIST);
  });

  await checkAsync('runFlow: blacklist=null được tôn trọng', async () => {
    const { d, calls } = fakeDeps({ todo: [] });
    await runFlow({ token: 'T', dryRun: true, blacklist: null, logger: () => {}, deps: d });
    assert.strictEqual(calls.scanOpts.blacklist, null);
  });

  await checkAsync('runFlow: onProgress gọi cho từng bài', async () => {
    const { d } = fakeDeps({ todo: [{ title: 'A', contentId: 'c1' }, { title: 'B', contentId: 'c2' }] });
    const seen = [];
    await runFlow({ token: 'T', logger: () => {}, deps: d, onProgress: (i, total) => seen.push([i, total]) });
    assert.deepStrictEqual(seen, [[0, 2], [1, 2]]);
  });

  await checkAsync('solveItem: kind=book -> gọi solveBook', async () => {
    const { d, calls } = fakeDeps({ kind: 'book' });
    const r = await solveItem(fakePage, { contentId: 'c1' }, () => {}, {}, d);
    assert.strictEqual(calls.solveBook, 1);
    assert.strictEqual(calls.solveVideo, 0);
    assert.strictEqual(r.kind, 'book');
    assert.strictEqual(r.ok, true);
  });

  await checkAsync('solveItem: kind=iv -> gọi solveVideo', async () => {
    const { d, calls } = fakeDeps({ kind: 'iv' });
    const r = await solveItem(fakePage, { contentId: 'c1' }, () => {}, {}, d);
    assert.strictEqual(calls.solveVideo, 1);
    assert.strictEqual(calls.solveBook, 0);
    assert.strictEqual(r.kind, 'iv');
  });

  await checkAsync('solveItem: không có frame -> ok=false', async () => {
    const { d } = fakeDeps();
    d.findPlayerFrame = async () => null;
    const r = await solveItem(fakePage, { contentId: 'c1' }, () => {}, {}, d);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.kind, 'unknown');
  });

  await checkAsync('solveItem: không solved, không 100% -> ok=false', async () => {
    const { d } = fakeDeps({ kind: 'book' });
    d.solveBook = async () => ({ solved: 0, finalScore: { bar: '50%' } });
    const r = await solveItem(fakePage, { contentId: 'c1' }, () => {}, {}, d);
    assert.strictEqual(r.ok, false);
  });

  await checkAsync('deps(): override thắng giá trị mặc định', async () => {
    const merged = deps({ solveBook: async () => 'X' });
    assert.strictEqual(await merged.solveBook(), 'X');
    assert.ok(typeof merged.launch === 'function');
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} flow: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();

