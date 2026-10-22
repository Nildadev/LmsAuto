'use strict';
/**
 * Test offline cho tính TRUNG THỰC của sách online (IB/CP).
 * Lỗi live 22/10/2026: bài "Kính lúp" có 1 câu SAI nhưng solveBook chỉ trả
 * { solved, slides } -> flow thấy wrong=0, unverified=0 nên vẫn mark_complete.
 * Test này khóa hành vi: mọi câu chưa xác nhận đúng -> wrong/unverified > 0.
 *
 * Stub các module I/O (navigate/question/interactiveVideo) trước khi nạp
 * book/index để chạy thuần logic điều phối + đọc feedback.
 * Chạy: node tests/book-honesty.test.js
 */
const assert = require('assert');
const path = require('path');

let solveElementMode = 'correct'; // correct | wrong | unverified
let ivResult = { solved: 1, total: 2, wrong: 0, unverified: 0 };
const navState = { total: 2, i: 0, nextResult: true, submit: true, gotoFail: [] };

function stub(rel, exports) {
  const id = require.resolve(path.join(__dirname, '..', 'src', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stub('h5p/book/question', {
  solveElement: async () => ({
    solved: solveElementMode === 'correct',
    clicked: solveElementMode === 'correct' ? 1 : 0,
  }),
});
stub('h5p/book/navigate', {
  openInteractiveBook: async () => {},
  ibPageState: async () => ({ total: navState.total }),
  ibNext: async () => { if (!navState.nextResult) return false; navState.i++; return true; },
  ibSubmit: async () => navState.submit,
  cpPartCount: async () => navState.total,
  cpGoto: async (frame, i) => {
    if (navState.gotoFail.includes(i)) return false;
    navState.i = i;
    return true;
  },
});
stub('h5p/interactiveVideo', {
  solveVideo: async () => ivResult,
});

const { solveInteractiveBook, solveCoursePresentation } = require('../src/h5p/book/index');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/**
 * Frame giả: mỗi trang có danh sách container; đọc feedback theo `fb`.
 * solvePage gọi evaluate() để dò container visible và locator().nth() để giải.
 */
function makeFrame(pages) {
  const pgAt = () => pages[navState.i] || { containers: [] };
  const zeroLoc = () => {
    const z = {
      count: async () => 0, first: () => z, last: () => z, nth: () => z,
      allInnerTexts: async () => [], waitFor: async () => {},
      isVisible: async () => false, evaluateAll: async () => [],
      evaluate: async () => ({ correct: 0, wrong: 0, bar: null }),
      locator: () => z, click: async () => {},
      scrollIntoViewIfNeeded: async () => {}, boundingBox: async () => null,
      innerText: async () => '',
    };
    return z;
  };
  const fakeEl = (fb) => ({
    offsetWidth: 5, offsetHeight: 5,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    innerText: 'Q', textContent: 'Q', querySelector: () => null,
    querySelectorAll: (sel) => {
      const arr = (n) => Array.from({ length: n }, () => ({ getBoundingClientRect: () => ({ width: 5, height: 5 }) }));
      if (/h5p-correct|h5p-question-plus-one|true-false-answer\.correct/.test(sel)) return arr(fb.correct || 0);
      if (/h5p-wrong|h5p-question-minus-one|true-false-answer\.incorrect/.test(sel)) return arr(fb.wrong || 0);
      return [];
    },
  });
  const contLoc = (fb) => {
    const loc = {
      count: async () => 1, first: () => loc, last: () => loc, nth: () => loc,
      allInnerTexts: async () => [], waitFor: async () => {},
      isVisible: async () => true, evaluate: async (fn) => fn(fakeEl(fb)),
      evaluateAll: async () => [], locator: () => zeroLoc(), click: async () => {},
      scrollIntoViewIfNeeded: async () => {}, boundingBox: async () => null,
      innerText: async () => 'Q',
    };
    return loc;
  };
  const contsLoc = () => {
    const pg = pgAt();
    return {
      count: async () => pg.containers.length,
      nth: (i) => contLoc((pg.containers[i] || {}).fb || {}),
      first: () => contLoc((pg.containers[0] || {}).fb || {}),
      last: () => contLoc((pg.containers[pg.containers.length - 1] || {}).fb || {}),
    };
  };
  const frame = {
    evaluate: async () => (pgAt().containers || []).map(() => ({ v: true, t: 'Q' })),
    locator: (sel) => {
      if (sel.includes('.h5p-interactive-video')) {
        const z = zeroLoc();
        return pgAt().iv ? { ...z, count: async () => 1 } : z;
      }
      if (/h5p-question|h5p-single-choice-set|h5p-drag-text|h5p-summary/.test(sel)) return contsLoc();
      return zeroLoc();
    },
    page: () => ({ keyboard: { press: async () => {} }, mouse: {} }),
  };
  return { frame };
}

const qEl = (title) => ({ kind: 'choice', base: 'H5P.MultiChoice', extracted: { correctTexts: ['x'] }, params: { question: title }, title });

(async () => {
  console.log('\nbook honesty — wrong/unverified phải chảy lên kết quả');

  await check('IB: 1 câu SAI -> wrong=1 (không đếm trùng unverified)', async () => {
    solveElementMode = 'wrong';
    navState.total = 1; navState.i = 0; navState.nextResult = true; navState.gotoFail = [];
    const { frame } = makeFrame([{ containers: [{ fb: { correct: 0, wrong: 1 } }] }]);
    const r = await solveInteractiveBook({}, frame, { kind: 'interactivebook', pages: [{ title: 'T1', elements: [qEl('Q1')] }] }, () => {});
    assert.strictEqual(r.wrong, 1, `wrong phải = 1 (nhận ${r.wrong})`);
    assert.strictEqual(r.unverified, 0, `câu đã có feedback SAI không tính unverified (nhận ${r.unverified})`);
  });

  await check('IB: mọi câu ĐÚNG -> wrong=0, unverified=0', async () => {
    solveElementMode = 'correct';
    navState.total = 1; navState.i = 0;
    const { frame } = makeFrame([{ containers: [{ fb: { correct: 1, wrong: 0 } }] }]);
    const r = await solveInteractiveBook({}, frame, { kind: 'interactivebook', pages: [{ title: 'T1', elements: [qEl('Q1')] }] }, () => {});
    assert.strictEqual(r.wrong, 0);
    assert.strictEqual(r.unverified, 0);
    assert.strictEqual(r.solved, 1);
  });

  await check('IB: không điều hướng tiếp -> câu trang sau bị tính unverified', async () => {
    solveElementMode = 'correct';
    navState.total = 2; navState.i = 0; navState.nextResult = false;
    const { frame } = makeFrame([
      { containers: [{ fb: { correct: 1, wrong: 0 } }] },
      { containers: [{ fb: { correct: 1, wrong: 0 } }] },
    ]);
    const r = await solveInteractiveBook({}, frame, {
      kind: 'interactivebook',
      pages: [{ title: 'T1', elements: [qEl('Q1')] }, { title: 'T2', elements: [qEl('Q2')] }],
    }, () => {});
    assert.strictEqual(r.wrong, 0);
    assert.strictEqual(r.unverified, 1, `trang 2 chưa tới được -> unverified=1 (nhận ${r.unverified})`);
  });

  await check('IB: IV lồng sai -> wrong/unverified của IV chảy lên', async () => {
    navState.total = 1; navState.i = 0; navState.nextResult = true;
    ivResult = { solved: 1, total: 2, wrong: 1, unverified: 0 };
    const { frame } = makeFrame([{ containers: [], iv: true }]);
    const r = await solveInteractiveBook({}, frame, {
      kind: 'interactivebook',
      pages: [{ title: 'T1', elements: [{ kind: 'iv', base: 'H5P.InteractiveVideo', params: {} }] }],
    }, () => {});
    assert.strictEqual(r.wrong, 1);
    ivResult = { solved: 1, total: 2, wrong: 0, unverified: 0 };
  });

  await check('CP: slide 2 SAI -> wrong>0; slide không tới được -> unverified', async () => {
    solveElementMode = 'wrong';
    navState.total = 3; navState.i = 0; navState.gotoFail = [2];
    const { frame } = makeFrame([
      { containers: [{ fb: { correct: 0, wrong: 1 } }] },
      { containers: [{ fb: { correct: 0, wrong: 1 } }] },
      { containers: [{ fb: { correct: 1, wrong: 0 } }] },
    ]);
    const model = {
      kind: 'coursepresentation',
      pages: [
        { title: 'S1', elements: [qEl('Q1')] },
        { title: 'S2', elements: [qEl('Q2')] },
        { title: 'S3', elements: [qEl('Q3')] },
      ],
    };
    const r = await solveCoursePresentation({}, frame, model, () => {});
    assert.ok(r.wrong >= 2, `wrong phải >= 2 (nhận ${r.wrong})`);
    assert.ok(r.unverified >= 1, `slide goto-failed vẫn phải tính unverified (nhận ${r.unverified})`);
    navState.gotoFail = [];
  });

  console.log(`\nKết quả: ${passed} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
