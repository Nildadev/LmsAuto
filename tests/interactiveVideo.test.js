'use strict';
/**
 * Test offline cho interactiveVideo.readInteractions — tập trung vào VIỆC NHẬN DIỆN
 * bài KHOÁ TUA vs CHO TUA (preventSkippingMode). Dữ liệu mô phỏng đúng cấu trúc H5P:
 *   - Đứng riêng: { interactiveVideo:{...}, override:{...}, l10n:{...} }
 *   - Lồng IB/CP: caller truyền { params: <IV params> } -> override NGANG HÀNG.
 * Chạy: node tests/interactiveVideo.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readInteractions } = require('../src/h5p/interactiveVideo');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

// jsonOverride cung cấp sẵn -> readInteractions KHÔNG gọi frame.evaluate.
const NO_FRAME = {};

function standalone(mode, extraIv) {
  return {
    interactiveVideo: { video: {}, assets: { interactions: [] }, ...(extraIv || {}) },
    override: { preventSkippingMode: mode },
    l10n: {},
  };
}

(async () => {
  console.log('interactiveVideo.readInteractions — nhận diện khoá tua');

  await check('standalone: preventSkippingMode="none" -> KHÔNG khoá', async () => {
    const r = await readInteractions(NO_FRAME, standalone('none'));
    assert.strictEqual(r.seekLocked, false);
    assert.strictEqual(r.preventSkippingMode, 'none');
  });

  await check('standalone: "forward" -> KHOÁ (không tua tới được)', async () => {
    const r = await readInteractions(NO_FRAME, standalone('forward'));
    assert.strictEqual(r.seekLocked, true);
    assert.strictEqual(r.preventSkippingMode, 'forward');
  });

  await check('standalone: "both" -> KHOÁ', async () => {
    const r = await readInteractions(NO_FRAME, standalone('both'));
    assert.strictEqual(r.seekLocked, true);
  });

  await check('standalone: thiếu override -> mặc định none (không khoá)', async () => {
    const r = await readInteractions(NO_FRAME, { interactiveVideo: { assets: {} } });
    assert.strictEqual(r.seekLocked, false);
    assert.strictEqual(r.preventSkippingMode, 'none');
  });

  await check('standalone: hoa/thường lẫn lộn "BOTH" -> KHOÁ', async () => {
    const r = await readInteractions(NO_FRAME, standalone('BOTH'));
    assert.strictEqual(r.seekLocked, true);
  });

  await check('lồng IB/CP: { params } + override NGANG HÀNG -> KHOÁ (đúng vị trí thật)', async () => {
    const params = {
      interactiveVideo: { assets: { interactions: [] } },
      override: { preventSkippingMode: 'both' },
      l10n: {},
    };
    const r = await readInteractions(NO_FRAME, { params });
    assert.strictEqual(r.seekLocked, true, 'override ngang hàng phải được nhận diện');
    assert.strictEqual(r.preventSkippingMode, 'both');
  });

  await check('lồng IB/CP: { params } mode none -> KHÔNG khoá', async () => {
    const params = {
      interactiveVideo: { assets: { interactions: [] } },
      override: { preventSkippingMode: 'none' },
    };
    const r = await readInteractions(NO_FRAME, { params });
    assert.strictEqual(r.seekLocked, false);
  });

  await check('biến thể: override LỒNG trong interactiveVideo -> vẫn KHOÁ', async () => {
    const r = await readInteractions(NO_FRAME, {
      interactiveVideo: { assets: {}, override: { preventSkippingMode: 'forward' } },
    });
    assert.strictEqual(r.seekLocked, true);
  });

  await check('đọc đúng interactions + summary từ assets', async () => {
    const r = await readInteractions(NO_FRAME, {
      interactiveVideo: {
        assets: { interactions: [{ duration: { from: 3, to: 8 }, action: { library: 'H5P.MultiChoice 1.16', params: {} } }] },
        summary: { displayAt: 30, task: { library: 'H5P.Summary 1.10', params: {} } },
      },
      override: { preventSkippingMode: 'none' },
    });
    assert.strictEqual(r.items.length, 2, '1 interaction + 1 summary');
    assert.strictEqual(r.items[0].from, 3);
    assert.strictEqual(r.items[1].isSummary, true);
    assert.strictEqual(r.summaryDisplayAt, 30);
  });

  await check('DỮ LIỆU THẬT (sample-interactivebook.json): IV lồng -> đọc đúng override', async () => {
    const f = path.join(__dirname, '..', 'docs', 'sample-interactivebook.json');
    const book = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ivParams = book.chapters[1].params.content[0].content.params;
    assert.ok(ivParams.override, 'sample phải có override ở cấp params');
    assert.strictEqual(ivParams.interactiveVideo.override, undefined, 'override KHÔNG lồng trong interactiveVideo');
    const r = await readInteractions(NO_FRAME, { params: ivParams });
    assert.strictEqual(r.seekLocked, false);
    assert.strictEqual(r.preventSkippingMode, 'none');
    assert.ok(r.items.length >= 1, 'phải đọc được interaction/summary thật');
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
