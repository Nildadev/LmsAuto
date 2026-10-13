'use strict';
/**
 * Test offline cho solver.js — phần GỘP TRUY VẤN DOM (P2).
 * Dùng Frame giả tối thiểu: mô phỏng locator/allInnerTexts để (a) kiểm tra logic
 * chọn đáp án KHÔNG đổi, (b) chứng minh không còn N+1 round-trip mỗi node.
 * Chạy: node tests/solver-dom.test.js
 */
const assert = require('assert');
const { solveChoice, pressCheck, pressNext, retryAvailable } = require('../src/h5p/solver');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/**
 * Frame giả: `els` = [{cls, t, visible}] (cls giống class attribute thật).
 * Đếm số lượt gọi để phát hiện N+1 round-trip.
 */
function fakeFrame(els = []) {
  const calls = { count: 0, allInnerTexts: 0, innerText: 0, isVisible: 0, click: 0, evaluate: 0 };
  const clicked = [];
  const base = (sel) => sel.replace(/:visible/g, '').replace(/:is\(([^)]*)\)/g, '$1')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const matched = (sel) => els.filter((e) => (
    base(sel).some((b) => e.cls.split(/\s+/).includes(b.replace(/^\./, '')))
    && (!sel.includes(':visible') || e.visible !== false)
  ));
  const mkEl = (sel) => ({
    boundingBox: async () => null, // -> humanClick rơi vào locator.click()
    count: async () => { calls.count++; return 1; },
    click: async () => { calls.click++; clicked.push(sel); },
    isVisible: async () => { calls.isVisible++; return true; },
    innerText: async () => { calls.innerText++; return ''; },
    waitFor: async () => {},
    locator: () => mkEl(sel),
  });
  const loc = (sel) => ({
    count: async () => { calls.count++; return matched(sel).length; },
    allInnerTexts: async () => { calls.allInnerTexts++; return matched(sel).map((e) => e.t); },
    nth: (i) => { const m = matched(sel); return mkEl(`${sel}@${i}:${(m[i] || {}).t || ''}`); },
    first: () => mkEl(sel),
    click: async () => { calls.click++; clicked.push(sel); },
    waitFor: async () => {},
    boundingBox: async () => null,
    isVisible: async () => { calls.isVisible++; return true; },
    innerText: async () => { calls.innerText++; return ''; },
  });
  return {
    calls, clicked, locator: loc,
    evaluate: async () => { calls.evaluate++; return null; },
    page: () => ({
      mouse: { move: async () => {}, down: async () => {}, up: async () => {}, click: async () => {} },
      keyboard: { press: async () => {} },
    }),
  };
}

(async () => {
  console.log('solver.js — gộp truy vấn DOM');

  await check('solveChoice: chọn ĐÚNG đáp án exact match', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'Sai rồi', visible: true },
      { cls: 'h5p-answer', t: 'Đáp án đúng', visible: true },
      { cls: 'h5p-answer', t: 'Cũng sai', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: ['Đáp án đúng'] } }, () => {});
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(r.clicked, [1]);
    assert.ok(f.clicked[0].includes('@1:Đáp án đúng'), `click đúng node visible #1 (nhận ${f.clicked[0]})`);
  });

  await check('solveChoice: 1 lượt allInnerTexts, KHÔNG innerText/isVisible từng node', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'A', visible: true },
      { cls: 'h5p-answer', t: 'B', visible: true },
      { cls: 'h5p-answer', t: 'C', visible: true },
      { cls: 'h5p-answer', t: 'D', visible: true },
    ]);
    await solveChoice(f, { data: { correctTexts: ['C'] } }, () => {});
    assert.strictEqual(f.calls.allInnerTexts, 1, 'text đọc 1 lượt cho cả 4 đáp án');
    assert.strictEqual(f.calls.innerText, 0, 'không innerText từng node');
    assert.strictEqual(f.calls.isVisible, 0, 'không isVisible từng node');
  });

  await check('solveChoice: bỏ qua node ẩn, index theo tập :visible', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'Bản ẩn', visible: false },
      { cls: 'h5p-answer', t: 'Bản hiện', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: ['Bản hiện'] } }, () => {});
    assert.strictEqual(r.solved, true);
    assert.ok(f.clicked[0].includes('@0:Bản hiện'), 'index tính trên tập visible');
  });

  await check('solveChoice: không có đáp án trích được -> KHÔNG đoán, không click', async () => {
    const f = fakeFrame([{ cls: 'h5p-answer', t: 'A', visible: true }]);
    const r = await solveChoice(f, { data: { correctTexts: [] } }, () => {});
    assert.strictEqual(r.solved, false);
    assert.strictEqual(r.reason, 'no-answers');
    assert.strictEqual(f.clicked.length, 0, 'không được click bừa');
  });

  await check('solveChoice: không có node đáp án -> no-answer-nodes', async () => {
    const f = fakeFrame([]);
    const r = await solveChoice(f, { data: { correctTexts: ['X'] } }, () => {});
    assert.strictEqual(r.solved, false);
    assert.strictEqual(r.reason, 'no-answer-nodes');
  });

  await check('pressCheck: tìm "Kiểm tra" và bấm ĐÚNG nút', async () => {
    const f = fakeFrame([
      { cls: 'button', t: 'Hủy', visible: true },
      { cls: 'button', t: 'Kiểm tra', visible: true },
    ]);
    const ok = await pressCheck(f, () => {});
    assert.strictEqual(ok, true);
    assert.ok(f.clicked[0].includes('@1:Kiểm tra'), `bấm nút "Kiểm tra" (nhận ${f.clicked[0]})`);
  });

  await check('pressCheck: không có nút text -> dùng fallback selector (ít lượt)', async () => {
    const f = fakeFrame([{ cls: 'h5p-question-check-answer', t: '', visible: true }]);
    const ok = await pressCheck(f, () => {});
    assert.strictEqual(ok, true);
    assert.strictEqual(f.calls.allInnerTexts, 1, 'đọc nhãn button 1 lượt');
    assert.ok(f.calls.count <= 3, `số lượt count nhỏ (nhận ${f.calls.count})`);
  });

  await check('pressNext: fallback .h5p-question-next khi không có nhãn text', async () => {
    const f = fakeFrame([{ cls: 'h5p-question-next', t: '', visible: true }]);
    assert.strictEqual(await pressNext(f, () => {}), true);
  });

  await check('retryAvailable: nhận "Thử lại" trong 1 lượt đọc nhãn', async () => {
    const f = fakeFrame([{ cls: 'button', t: 'Thử lại', visible: true }]);
    assert.strictEqual(await retryAvailable(f), true);
    assert.strictEqual(f.calls.allInnerTexts, 1);
  });

  await check('retryAvailable: không có nút nào -> false, không click', async () => {
    const f = fakeFrame([{ cls: 'button', t: 'Gửi', visible: true }]);
    assert.strictEqual(await retryAvailable(f), false);
    assert.strictEqual(f.clicked.length, 0);
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} solver-dom: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
