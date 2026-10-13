'use strict';
/**
 * Test offline cho module sách online (schema.js + extractTrueFalse).
 * Dùng dữ liệu THẬT đã dump từ lms360.vn:
 *  - docs/sample-coursepresentation.json (CP 4 slide: 3 Blanks)
 *  - docs/sample-interactivebook.json    (IB 6 chương: CP/MultiChoice/TrueFalse/IV/Image)
 * Chạy: node tests/book.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseBook, kindOf, libBase } = require('../src/h5p/book/schema');
const { extractAnswers, extractTrueFalse } = require('../src/h5p/extract');

const CP = path.join(__dirname, '..', 'docs', 'sample-coursepresentation.json');
const IB = path.join(__dirname, '..', 'docs', 'sample-interactivebook.json');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ── libBase / kindOf ──
check('libBase bỏ version', () => {
  assert.strictEqual(libBase('H5P.MultiChoice 1.16'), 'H5P.MultiChoice');
  assert.strictEqual(libBase('H5P.TrueFalse 1.8'), 'H5P.TrueFalse');
});
check('kindOf phân loại đúng', () => {
  assert.strictEqual(kindOf('H5P.MultiChoice 1.16'), 'choice');
  assert.strictEqual(kindOf('H5P.TrueFalse 1.8'), 'choice');
  assert.strictEqual(kindOf('H5P.Blanks 1.14'), 'blanks');
  assert.strictEqual(kindOf('H5P.Column 1.18'), 'column');
  assert.strictEqual(kindOf('H5P.CoursePresentation 1.26'), 'cp');
  assert.strictEqual(kindOf('H5P.InteractiveVideo 1.27'), 'iv');
});

// ── CoursePresentation fixture ──
check('CP: parse -> coursepresentation, 4 slide', () => {
  const m = parseBook(readJson(CP));
  assert.strictEqual(m.kind, 'coursepresentation');
  assert.strictEqual(m.pages.length, 4);
  assert.strictEqual(m.pages[0].title, 'Slide 1');
});
check('CP: slide1 có Blanks -> kind=blanks, có đáp án', () => {
  const m = parseBook(readJson(CP));
  const el = m.pages[1].elements.find((e) => e.base === 'H5P.Blanks');
  assert.ok(el, 'slide1 phải có Blanks');
  assert.strictEqual(el.kind, 'blanks');
  assert.ok(el.extracted && el.extracted.answers.length >= 1, 'phải trích được đáp án');
});
check('CP: mọi element đều có base/kind', () => {
  const m = parseBook(readJson(CP));
  m.pages.forEach((pg) => pg.elements.forEach((e) => {
    assert.ok(e.base, 'base không rỗng');
    assert.ok(e.kind, 'kind không rỗng');
  }));
});

// ── InteractiveBook fixture ──
check('IB: parse -> interactivebook, 6 chương', () => {
  const m = parseBook(readJson(IB));
  assert.strictEqual(m.kind, 'interactivebook');
  assert.strictEqual(m.pages.length, 6);
  assert.ok(m.pages[0].title.length > 0, 'chapter có title');
});
check('IB: Column được expand thành element con', () => {
  const m = parseBook(readJson(IB));
  const bases = m.pages[0].elements.map((e) => e.base);
  assert.ok(bases.includes('H5P.CoursePresentation'), 'ch0 phải có CP');
  assert.strictEqual(bases.filter((b) => b === 'H5P.MultiChoice').length, 2, 'ch0 có 2 MultiChoice');
});
check('IB: MultiChoice -> correctTexts không rỗng', () => {
  const m = parseBook(readJson(IB));
  const mc = m.pages[0].elements.find((e) => e.base === 'H5P.MultiChoice');
  assert.strictEqual(mc.kind, 'choice');
  assert.ok(mc.extracted.correctTexts.length >= 1, 'phải có đáp án đúng');
});
check('IB: TrueFalse (params.correct) -> correctTexts = Đúng/Sai', () => {
  const m = parseBook(readJson(IB));
  const tfs = m.pages.flatMap((p) => p.elements).filter((e) => e.base === 'H5P.TrueFalse');
  assert.ok(tfs.length >= 1, 'IB phải có TrueFalse');
  tfs.forEach((tf) => {
    assert.strictEqual(tf.kind, 'choice');
    assert.ok(['Đúng', 'Sai'].includes(tf.extracted.correctTexts[0]), 'đáp án phải là Đúng/Sai');
  });
});

// ── extractTrueFalse đơn vị ──
check('extractTrueFalse: correct=true -> Đúng', () => {
  const r = extractTrueFalse({ correct: 'true', l10n: { trueText: 'Đúng', falseText: 'Sai' } });
  assert.deepStrictEqual(r.correctTexts, ['Đúng']);
  assert.deepStrictEqual(r.correctIndexes, [0]);
});
check('extractTrueFalse: correct=false -> Sai', () => {
  const r = extractTrueFalse({ correct: 'false', l10n: { trueText: 'Đúng', falseText: 'Sai' } });
  assert.deepStrictEqual(r.correctTexts, ['Sai']);
  assert.deepStrictEqual(r.correctIndexes, [1]);
});
check('extractTrueFalse: fallback answers[] (dạng cũ)', () => {
  const r = extractTrueFalse({ answers: [{ text: 'A', correct: false }, { text: 'B', correct: true }] });
  assert.deepStrictEqual(r.correctTexts, ['B']);
});
check('extractAnswers route TrueFalse qua extractTrueFalse', () => {
  const r = extractAnswers('H5P.TrueFalse 1.8', { params: { correct: 'true' } });
  assert.strictEqual(r.kind, 'choice');
  assert.deepStrictEqual(r.correctTexts, ['Đúng']);
});

// ── solveSingleChoiceSet: KHÔNG click bừa khi không khớp được đáp án ──
const { solveSingleChoiceSet } = require('../src/h5p/book/question');

async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Container SC giả tối thiểu cho solveSingleChoiceSet. */
function fakeScContainer(altsDef, qText = 'Câu hỏi 1') {
  const alts = altsDef.map((def) => {
    const fake = {
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => { fake.clicks = (fake.clicks || 0) + 1; },
      innerText: async () => def.text,
      evaluate: async (fn) => fn({ className: def.correct ? 'h5p-sc-alternative h5p-sc-is-correct' : 'h5p-sc-alternative' }),
    };
    return fake;
  });
  const altLoc = { count: async () => alts.length, nth: (i) => alts[i] };
  const cur = {
    count: async () => 1,
    locator: (sel) => {
      if (sel === '.h5p-sc-alternative') return altLoc;
      if (sel === '.h5p-sc-question') return { first: () => ({ innerText: async () => qText }) };
      return { count: async () => 0 };
    },
  };
  const container = {
    locator: (sel) => {
      if (/h5p-sc-set-results|h5p-sc-finished/.test(sel)) return { count: async () => 0 };
      if (sel === '.h5p-sc-current-slide') return cur;
      return { count: async () => 0 }; // '.h5p-sc-current-slide .h5p-sc-alternative' -> 0 -> dừng
    },
  };
  return { container, alts };
}

(async () => {
  console.log('\nsolveSingleChoiceSet — không click bừa khi thiếu đáp án');

  await checkAsync('không có .h5p-sc-is-correct & không khớp text -> KHÔNG click (clicks=0)', async () => {
    const { container, alts } = fakeScContainer([
      { text: 'sai A', correct: false },
      { text: 'sai B', correct: false },
    ]);
    const r = await solveSingleChoiceSet({}, container, { data: { correctTexts: ['đáp án đúng'] } }, null);
    assert.strictEqual(r.solved, false, 'không được báo solved');
    assert.strictEqual(r.clicked, 0, 'KHÔNG được click đáp án nào');
    assert.ok(alts.every((a) => !a.clicks), 'không phần tử nào bị click');
  });

  await checkAsync('có .h5p-sc-is-correct -> click đúng đáp án đó', async () => {
    const { container, alts } = fakeScContainer([
      { text: 'sai', correct: false },
      { text: 'đúng', correct: true },
    ]);
    const r = await solveSingleChoiceSet({}, container, { data: { correctTexts: [] } }, null);
    assert.strictEqual(r.clicked, 1, 'click đúng 1 lần');
    assert.ok(alts[1].clicks, 'phần tử đúng (index 1) phải được click');
    assert.ok(!alts[0].clicks, 'phần tử sai KHÔNG được click');
  });

  console.log(`\nKết quả: ${passed} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
