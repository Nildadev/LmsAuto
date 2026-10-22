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
check('schema: Column lồng Column -> đệ quy giữ lại câu hỏi cấp 2', () => {
  const nested = {
    presentation: { slides: [{ elements: [{ action: {
      library: 'H5P.Column 1.18', params: { content: [{ content: {
        library: 'H5P.Column 1.18', params: { content: [{ content: {
          library: 'H5P.MultiChoice 1.16', params: { question: 'Q', answers: [{ text: 'Đúng', correct: true }] },
        } }] },
      } }] },
    } }] }] },
  };
  const m = parseBook(nested);
  assert.strictEqual(m.pages[0].elements.length, 1);
  assert.strictEqual(m.pages[0].elements[0].base, 'H5P.MultiChoice');
  assert.deepStrictEqual(m.pages[0].elements[0].extracted.correctTexts, ['Đúng']);
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
const { solveSingleChoiceSet, solveChoice } = require('../src/h5p/book/question');
const { solvePage } = require('../src/h5p/book/index');

async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Container SC giả tối thiểu cho solveSingleChoiceSet. */
function fakeScContainer(altsDef, qText = 'Câu hỏi 1') {
  const alts = altsDef.map((def) => {
    let cls = def.correct ? 'h5p-sc-alternative h5p-sc-is-correct' : 'h5p-sc-alternative';
    const fake = {
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => {
        fake.clicks = (fake.clicks || 0) + 1;
        // H5P chấm ngay khi click -> gắn reveal lên đúng alternative vừa chọn.
        cls += def.correct ? ' h5p-sc-selected h5p-sc-reveal-correct' : ' h5p-sc-selected h5p-sc-reveal-wrong';
      },
      innerText: async () => def.text,
      evaluate: async (fn) => fn({ className: cls }),
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

/**
 * Container SCS ĐỘNG: sau khi click, slide hiện tại giữ nguyên `advanceMs`
 * (mô phỏng autoContinue ~2000ms của H5P) rồi mới chuyển slide / hiện kết quả.
 * Đủ để phát hiện vòng lặp click LẶP khi sleep cứng ngắn hơn thời gian chuyển.
 */
/**
 * Container SCS "flicker": sau click, H5P GỠ `.h5p-sc-current-slide` khỏi mọi
 * slide trong lúc animate (~hideMs) rồi mới gắn lại cho slide kế. Mô phỏng đúng
 * live 22/10/2026 — solver cũ thấy count=0 là kết luận 'empty' và dừng giữa set.
 */
function fakeScFlicker(slides, hideMs = 300) {
  const state = { i: 0, hideUntil: 0 };
  const clicks = slides.map((s) => s.alts.map(() => 0));
  const revealed = slides.map((s) => s.alts.map(() => ''));
  const visibleNow = () => Date.now() >= state.hideUntil;
  const elOf = (si, ai) => {
    const def = slides[si].alts[ai];
    return {
      className: (def.correct ? 'h5p-sc-alternative h5p-sc-is-correct' : 'h5p-sc-alternative') + revealed[si][ai],
      innerText: def.text || '',
      querySelectorAll: () => [],
      click: () => {
        clicks[si][ai]++;
        if (state.i !== si) return;
        const ok = !!(def.markCorrect || def.correct);
        revealed[si][ai] = ok ? ' h5p-sc-selected h5p-sc-reveal-correct' : ' h5p-sc-selected h5p-sc-reveal-wrong';
        state.hideUntil = Date.now() + hideMs;
        setTimeout(() => { state.i++; }, hideMs);
      },
    };
  };
  const altLoc = (si) => ({
    count: async () => (slides[si] ? slides[si].alts.length : 0),
    nth: (ai) => ({
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => elOf(si, ai).click(),
      innerText: async () => slides[si].alts[ai].text || '',
      evaluate: async (fn) => fn(elOf(si, ai)),
      evaluateAll: async (fn) => fn(slides[si].alts.map((_, ai) => elOf(si, ai))),
    }),
    evaluateAll: async (fn) => fn((slides[si] ? slides[si].alts : []).map((_, ai) => elOf(si, ai))),
  });
  const cur = () => ({
    count: async () => (state.i < slides.length && visibleNow() ? 1 : 0),
    locator: (sel) => {
      if (sel === '.h5p-sc-alternative') return altLoc(state.i);
      if (sel === '.h5p-sc-question') return { first: () => ({ innerText: async () => (slides[state.i] || {}).q || '' }) };
      return { count: async () => 0 };
    },
  });
  const container = {
    locator: (sel) => {
      if (/h5p-sc-set-results|h5p-sc-finished/.test(sel)) {
        return { count: async () => (state.i >= slides.length && visibleNow() ? 1 : 0) };
      }
      if (sel === '.h5p-sc-current-slide') return cur();
      if (sel === '.h5p-sc-current-slide .h5p-sc-alternative') {
        return { count: async () => (state.i < slides.length && visibleNow() ? slides[state.i].alts.length : 0) };
      }
      return { count: async () => 0 };
    },
  };
  return { container, clicks };
}

function fakeScSlides(slides, advanceMs = 1500) {
  const state = { i: 0, timer: null };
  const clicks = slides.map((s) => s.alts.map(() => 0));
  const revealed = slides.map((s) => s.alts.map(() => ''));
  const elOf = (si, ai) => {
    const def = slides[si].alts[ai];
    const el = {
      className: (def.correct ? 'h5p-sc-alternative h5p-sc-is-correct' : 'h5p-sc-alternative') + revealed[si][ai],
      innerText: def.text || '',
      querySelectorAll: (sel) => (sel === 'img' ? (def.imgs || []).map((s) => ({ getAttribute: () => s, src: s })) : []),
      click: () => {
        clicks[si][ai]++;
        if (state.i !== si) return;
        // markCorrect: H5P chấm đúng dù không có class nội dung (đáp án ảnh).
        const ok = !!(def.markCorrect || def.correct);
        revealed[si][ai] = ok ? ' h5p-sc-selected h5p-sc-reveal-correct' : ' h5p-sc-selected h5p-sc-reveal-wrong';
        clearTimeout(state.timer);
        state.timer = setTimeout(() => { state.i++; }, advanceMs);
      },
    };
    return el;
  };
  const altLoc = (si) => ({
    count: async () => (slides[si] ? slides[si].alts.length : 0),
    nth: (ai) => ({
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => elOf(si, ai).click(),
      innerText: async () => slides[si].alts[ai].text || '',
      evaluate: async (fn) => fn(elOf(si, ai)),
      evaluateAll: async (fn) => fn(slides[si].alts.map((_, ai) => elOf(si, ai))),
    }),
    evaluateAll: async (fn) => fn((slides[si] ? slides[si].alts : []).map((_, ai) => elOf(si, ai))),
  });
  const cur = () => ({
    count: async () => (state.i < slides.length ? 1 : 0),
    locator: (sel) => {
      if (sel === '.h5p-sc-alternative') return altLoc(state.i);
      if (sel === '.h5p-sc-question') return { first: () => ({ innerText: async () => (slides[state.i] || {}).q || '' }) };
      return { count: async () => 0 };
    },
  });
  const container = {
    locator: (sel) => {
      if (/h5p-sc-set-results|h5p-sc-finished/.test(sel)) return { count: async () => (state.i >= slides.length ? 1 : 0) };
      if (sel === '.h5p-sc-current-slide') return cur();
      if (sel === '.h5p-sc-current-slide .h5p-sc-alternative') return { count: async () => (state.i < slides.length ? slides[state.i].alts.length : 0) };
      return { count: async () => 0 };
    },
  };
  return { container, clicks };
}

/** Container MultiChoice giả cho solveChoice trong sách (có MathML). */
function fakeChoiceContainer(els) {
  const clicked = [];
  const mk = (sel) => {
    const per = /#\d+$/.test(sel);
    const idx = Number((sel.match(/#(\d+)$/) || [])[1] || 0);
    return {
      count: async () => (sel.includes('h5p-sc-alternative') ? 0 : (per ? 1 : els.length)),
      nth: (i) => mk(`${sel.replace(/#\d+$/, '')}#${i}`),
      isVisible: async () => !!(els[idx] && els[idx].visible !== false),
      innerText: async () => ((els[idx] || {}).inner == null ? (els[idx] || {}).t || '' : els[idx].inner),
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => clicked.push(idx),
      evaluateAll: async (fn) => fn(els.map((e) => ({
        innerText: e.inner == null ? e.t : e.inner, textContent: e.t,
        offsetWidth: 10, offsetHeight: 10, getClientRects: () => [{}],
        querySelector: (s) => (s === 'math' && e.math ? {
          querySelectorAll: (q) => (q === 'mfrac'
            ? e.math.split('|').map((part) => ({ children: part.split('/').map((x) => ({ textContent: x })) }))
            : []),
          textContent: e.math.replace(/[/|]/g, ''),
        } : null),
        querySelectorAll: (s) => (s === 'img'
          ? (e.imgs || []).map((src) => ({ getAttribute: () => src, src }))
          : []),
      }))),
    };
  };
  return { container: { locator: mk }, clicked };
}

(async () => {
  console.log('\nsolveSingleChoiceSet — không click bừa khi thiếu đáp án');

  await checkAsync('solveChoice (sách): MathML trùng text -> chọn phân số, không chọn nhiễu', async () => {
    // Dữ liệu THẬT bài "Kính lúp": randomAnswers=true, nhiễu "G = 25f." và đáp án
    // đúng (phân số 25/f) cùng normalize thành "g25f" -> trước đây click nhầm.
    const { container, clicked } = fakeChoiceContainer([
      { t: 'G = 25f', math: '' },
      { t: 'G = 25f', math: '25/f' },
      { t: 'G = f25', math: 'f/25' },
      { t: 'G = 25 – f', math: '' },
    ]);
    const r = await solveChoice({}, container, { data: { correctTexts: ['G = 25f'], correctMath: ['25/f'] } }, null);
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [1], 'phải click node phân số 25/f');
  });

  await checkAsync('solveChoice (sách): innerText MathML trả 𝑓 -> khớp bằng textContent + mathSig', async () => {
    // Live 22/10/2026: innerText của <mi>f</mi> là "𝑓" (U+1D453), khác textContent
    // "f" -> nếu chỉ đọc innerText thì đáp án phân số không khớp và click nhầm nhiễu.
    const { container, clicked } = fakeChoiceContainer([
      { t: 'G = 25f.', inner: 'G = 25f.' },
      { t: 'G = 25f', inner: 'G = 25 𝑓', math: '25/f' },
      { t: 'G = f25 .', inner: 'G = 𝑓25 .', math: 'f/25' },
      { t: 'G = 25 – f.', inner: 'G = 25 – f.' },
    ]);
    const r = await solveChoice({}, container, { data: { correctTexts: ['G = 25f'], correctMath: ['25/f'] } }, null);
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [1], 'phải click phân số 25/f, không click nhiễu "G = 25f."');
  });

  await checkAsync('solveChoice (sách): đáp án là ẢNH -> khớp correctImages theo src', async () => {
    const { container, clicked } = fakeChoiceContainer([
      { t: '', imgs: ['https://cdn.x/a/sai.png'] },
      { t: '', imgs: ['https://cdn.x/b/dung.png'] },
    ]);
    const r = await solveChoice({}, container, { data: { correctTexts: [], correctImages: ['https://khac.y/z/dung.png'] } }, null);
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [1], 'chỉ click ảnh khớp basename');
  });

  await checkAsync('solveChoice (sách): câu TRỘN đáp án chữ + ảnh -> chọn CẢ HAI', async () => {
    // Trước đây `else if` khiến câu có đáp án chữ bỏ qua toàn bộ đáp án ảnh.
    const { container, clicked } = fakeChoiceContainer([
      { t: 'Đáp án chữ', imgs: [] },
      { t: '', imgs: ['https://cdn.x/b/dung.png'] },
      { t: '', imgs: ['https://cdn.x/c/sai.png'] },
    ]);
    const r = await solveChoice({}, container, {
      data: { correctTexts: ['Đáp án chữ'], correctImages: ['https://khac.y/z/dung.png'] },
    }, null);
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [0, 1], 'phải chọn cả đáp án chữ lẫn đáp án ảnh đúng');
  });

  await checkAsync('solveChoice (sách): ảnh không khớp -> KHÔNG click', async () => {
    const { container, clicked } = fakeChoiceContainer([
      { t: '', imgs: ['https://cdn.x/a/sai.png'] },
      { t: '', imgs: ['https://cdn.x/b/khac.png'] },
    ]);
    const r = await solveChoice({}, container, { data: { correctTexts: [], correctImages: ['https://cdn.x/b/dung.png'] } }, null);
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(clicked, []);
  });

  await checkAsync('solveChoice (sách): text trùng, không chữ ký MathML -> KHÔNG click (nhập nhằng)', async () => {
    const { container, clicked } = fakeChoiceContainer([{ t: 'A' }, { t: 'A' }, { t: 'B' }]);
    const r = await solveChoice({}, container, { data: { correctTexts: ['A'] } }, null);
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(clicked, [], 'không được đoán giữa 2 đáp án giống nhau');
  });

  await checkAsync('SCS (sách): H5P gỡ current-slide lúc chuyển slide -> KHÔNG dừng sớm', async () => {
    const { container, clicks } = fakeScFlicker([
      { q: 'Câu 1', alts: [{ text: 'đúng 1', correct: true }, { text: 'sai' }] },
      { q: 'Câu 2', alts: [{ text: 'sai' }, { text: 'đúng 2', correct: true }] },
    ], 300);
    const r = await solveSingleChoiceSet({}, container, { data: { correctTexts: [] } }, null);
    assert.strictEqual(r.clicked, 2, 'phải giải đủ 2 slide dù current-slide biến mất tạm thời');
    assert.deepStrictEqual(clicks, [[1, 0], [0, 1]], 'mỗi đáp án đúng click 1 lần');
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.correct, 2, 'reveal-correct của cả 2 slide phải được đếm');
    assert.strictEqual(r.solved, true);
  });

  await checkAsync('chờ autoContinue chuyển slide -> mỗi đáp án chỉ click 1 lần', async () => {
    const { container, clicks } = fakeScSlides([
      { q: 'Câu 1', alts: [{ text: 'đúng 1', correct: true }, { text: 'sai', correct: false }] },
      { q: 'Câu 2', alts: [{ text: 'sai', correct: false }, { text: 'đúng 2', correct: true }] },
    ], 1500);
    const r = await solveSingleChoiceSet({}, container, { data: { correctTexts: [] } }, null);
    assert.strictEqual(r.clicked, 2, 'phải giải đủ 2 slide');
    assert.deepStrictEqual(clicks, [[1, 0], [0, 1]], 'mỗi đáp án đúng chỉ được click 1 lần');
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.solved, true);
  });

  await checkAsync('SCS: đáp án là ẢNH (không class, không text) -> khớp correctImages', async () => {
    const { container, clicks } = fakeScSlides([
      { q: 'Chọn hình đúng', alts: [{ imgs: ['https://x/a/sai.png'] }, { imgs: ['img/dung.png'], markCorrect: true }] },
    ], 10);
    const r = await solveSingleChoiceSet({}, container, { data: { correctTexts: [], correctImages: ['https://y/z/dung.png'] } }, null);
    assert.strictEqual(r.clicked, 1, 'phải click đáp án ảnh đúng');
    assert.deepStrictEqual(clicks, [[0, 1]]);
    assert.strictEqual(r.solved, true);
  });

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

  // Review 2: SCS không có nút Kiểm tra/Làm lại và feedback không phải
  // .h5p-correct -> answerWithRetry luôn trả 0/0 khiến trang bị unverified oan.
  // solvePage phải route SCS sang solver riêng.
  await checkAsync('solvePage: SCS đúng hết -> good=2, unverified=0 (không qua answerWithRetry)', async () => {
    const { container } = fakeScSlides([
      { q: 'Câu 1', alts: [{ text: 'đúng 1', correct: true }, { text: 'sai' }] },
      { q: 'Câu 2', alts: [{ text: 'sai' }, { text: 'đúng 2', correct: true }] },
    ], 10);
    container.evaluate = async () => ({ correct: 0, wrong: 0, bar: null });
    const frame = {
      evaluate: async (fn, arg) => {
        // visibleContainersWithTexts truyền CONTAINER_SEL dạng chuỗi.
        if (typeof arg === 'string' && arg.includes('h5p-single-choice-set')) {
          return [{ v: true, t: 'Câu 1 đúng 1 sai Câu 2 sai đúng 2' }];
        }
        return { correct: 0, wrong: 0, bar: null };
      },
      locator: (sel) => {
        if (/h5p-course-presentation:visible/.test(sel)) {
          return { last: () => ({ locator: () => ({ count: async () => 0 }) }) };
        }
        if (sel.includes('h5p-single-choice-set') && sel.includes('h5p-summary')) {
          return { nth: () => container };
        }
        return { count: async () => 0 };
      },
      page: () => ({ keyboard: { press: async () => {} }, mouse: {} }),
    };
    const el = {
      kind: 'choice', base: 'H5P.SingleChoiceSet 1.11',
      extracted: { correctTexts: [] },
      params: { question: 'Câu 1' },
    };
    const r = await solvePage(frame, [el], () => {});
    assert.strictEqual(r.unverified, 0, `SCS đúng hết không được unverified (nhận ${r.unverified})`);
    assert.strictEqual(r.wrong, 0);
    assert.strictEqual(r.good, 2, 'phải cộng đủ 2 câu đúng vào good');
    assert.strictEqual(r.filled, 1);
  });

  console.log(`\nKết quả: ${passed} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
