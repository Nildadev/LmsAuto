'use strict';
// Test offline cho preview.js - controller Moonlight-style. Chay: node tests/preview.test.js
const assert = require('assert');
const { PreviewController, QUALITY_LEVELS, sampleHash } = require('../src/core/preview');
QUALITY_LEVELS.high.minMs = 0; QUALITY_LEVELS.balanced.minMs = 0;

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok -', name); }
  catch (e) { failed++; console.log('  FAIL -', name, '::', e.message); }
}
function fakeSession(frames) {
  const handlers = {};
  return {
    on: (ev, fn) => { handlers[ev] = fn; },
    send: async (m, a) => {
      if (m === 'Page.startScreencast') {
        for (const f of frames) await handlers['Page.screencastFrame'](f);
      }
    },
  };
}
(async () => {
  console.log('preview.js');
  await check('dedup: frame trung bi bo, frame doi duoc gui', async () => {
    const sent = [];
    const ctl = new PreviewController({
      getTarget: () => ({ id: 1 }),
      newSession: async () => fakeSession([
        { sessionId: 1, data: 'AAAA1111xxxx' },
        { sessionId: 2, data: 'AAAA1111xxxx' },
        { sessionId: 3, data: 'BBBB2222yyyyQQQQ1111zzzz2222wwww3333eeee4444rrrr5555tttt6666yyyy7777uuuu8888iiii9999oooo0000ppppaaaabbbbccccdddd' },
      ]),
      onFrame: (f) => { sent.push(f); return true; },
      auto: false, rebindMs: 60000, level: 'high',
    });
    ctl.lastSent = 0;
    const _origBind = ctl.bind.bind(ctl);
    await ctl.start({ id: 1 });
    await new Promise((r) => setTimeout(r, 50));
    await ctl.stop();
    assert.strictEqual(sent.length, 2, 'goi ' + sent.length + ' frame, muon 2');
    assert.strictEqual(ctl.stats().dupSkipped, 1);
  });
  await check('latest-only: seq tang dan, metadata day du', async () => {
    const sent = [];
    const ctl = new PreviewController({
      getTarget: () => null,
      newSession: async () => fakeSession([{ sessionId: 9, data: 'ZZZZ9999qqqq' }]),
      onFrame: (f) => { sent.push(f); return true; },
      auto: false, rebindMs: 60000,
    });
    await ctl.bind({ id: 2 });
    await new Promise((r) => setTimeout(r, 50));
    await ctl.stop();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].seq, 1);
    assert.ok(typeof sent[0].fps === 'number' && typeof sent[0].kbps === 'number');
  });
  await check('backpressure: onFrame=false dem dropped', async () => {
    const ctl = new PreviewController({
      getTarget: () => null,
      newSession: async () => fakeSession([{ sessionId: 5, data: 'QWER5678zxcv' }]),
      onFrame: () => false,
      auto: false, rebindMs: 60000,
    });
    await ctl.bind({ id: 3 });
    await new Promise((r) => setTimeout(r, 50));
    await ctl.stop();
    assert.strictEqual(ctl.stats().dropped, 1);
  });
  await check('QUALITY_LEVELS co 4 muc saver..high', async () => {
    assert.deepStrictEqual(Object.keys(QUALITY_LEVELS).sort(), ['balanced', 'high', 'low', 'saver']);
    assert.ok(QUALITY_LEVELS.saver.maxWidth <= QUALITY_LEVELS.low.maxWidth);
    assert.ok(QUALITY_LEVELS.low.maxWidth <= QUALITY_LEVELS.balanced.maxWidth);
    assert.ok(QUALITY_LEVELS.balanced.maxWidth <= QUALITY_LEVELS.high.maxWidth);
    assert.ok(sampleHash('abc') !== sampleHash('abd'));
  });
  console.log('\npreview: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
