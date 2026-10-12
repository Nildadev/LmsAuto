'use strict';
/**
 * Test logic thuần cho answerWithRetry (src/h5p/solver.js) — KHÔNG chạm browser.
 * Tiêm attempt/check/feedback/retry giả để kiểm tra điều khiển vòng lặp.
 * Chạy: node tests/solver-retry.test.js
 */
const assert = require('assert');
const { answerWithRetry } = require('../src/h5p/solver');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

(async () => {
  console.log('solver retry');

  await check('đúng ngay lần 1 -> solved, KHÔNG bấm Làm lại', async () => {
    let retries = 0, checks = 0;
    const r = await answerWithRetry({
      attempt: async () => {},
      check: async () => { checks++; },
      feedback: async () => ({ correct: 1, wrong: 0 }),
      retry: async () => { retries++; return true; },
      maxAttempts: 3, logger: () => {},
    });
    assert.strictEqual(r.solved, true);
    assert.strictEqual(r.attempts, 1);
    assert.strictEqual(retries, 0);
    assert.strictEqual(checks, 1);
  });

  await check('sai lần 1, đúng lần 2 (sau khi Làm lại) -> solved', async () => {
    let n = 0, retries = 0;
    const r = await answerWithRetry({
      attempt: async () => { n++; },
      check: async () => {},
      feedback: async () => (n === 1 ? { correct: 0, wrong: 1 } : { correct: 1, wrong: 0 }),
      retry: async () => { retries++; return true; },
      maxAttempts: 3, logger: () => {},
    });
    assert.strictEqual(r.solved, true);
    assert.strictEqual(r.attempts, 2);
    assert.strictEqual(retries, 1);
  });

  await check('sai mãi, KHÔNG tiến triển -> dừng sớm, solved=false', async () => {
    let retries = 0;
    const r = await answerWithRetry({
      attempt: async () => {},
      check: async () => {},
      feedback: async () => ({ correct: 0, wrong: 2 }),
      retry: async () => { retries++; return true; },
      maxAttempts: 3, logger: () => {},
    });
    assert.strictEqual(r.solved, false);
    assert.strictEqual(r.reason, 'wrong');
    assert.strictEqual(r.attempts, 2, 'lần 2 thấy số sai không giảm -> dừng, không tới lần 3');
    assert.strictEqual(retries, 1);
  });

  await check('không có nút "Làm lại" -> dừng ngay, solved=false', async () => {
    let attempts = 0;
    const r = await answerWithRetry({
      attempt: async () => { attempts++; },
      check: async () => {},
      feedback: async () => ({ correct: 0, wrong: 1 }),
      retry: async () => false,
      maxAttempts: 3, logger: () => {},
    });
    assert.strictEqual(r.solved, false);
    assert.strictEqual(attempts, 1);
  });

  await check('correct=0 && wrong=0 -> KHÔNG tính solved', async () => {
    const r = await answerWithRetry({
      attempt: async () => {}, check: async () => {},
      feedback: async () => ({ correct: 0, wrong: 0 }),
      retry: async () => false, maxAttempts: 2, logger: () => {},
    });
    assert.strictEqual(r.solved, false);
  });

  await check('số câu sai GIẢM dần (2 -> 1) -> tiếp tục tới khi đúng', async () => {
    let n = 0;
    const r = await answerWithRetry({
      attempt: async () => { n++; }, check: async () => {},
      feedback: async () => (n < 3 ? { correct: 1, wrong: 3 - n } : { correct: 2, wrong: 0 }),
      retry: async () => true, maxAttempts: 5, logger: () => {},
    });
    assert.strictEqual(r.solved, true);
    assert.strictEqual(r.attempts, 3);
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} solver-retry: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
