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
const { readInteractions, verdictOf, answerSingleChoiceSet, answerChoiceInPopup, answerSummaryInPopup, isEmptyBlanksOnly, isEmptyBlanksStop, classifyBlanksProbe, pressCheckIn, settleVideoCounts, DIALOG_CONTENT_SELECTOR, FB_CORRECT_SEL, FB_WRONG_SEL } = require('../src/h5p/interactiveVideo');
const { extractAnswers } = require('../src/h5p/extract');

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

  await check('không đọc được H5PIntegration (json null) -> readable=false, không crash', async () => {
    // jsonOverride=null -> buộc đi nhánh frame.evaluate (mô phỏng trang không có H5PIntegration).
    const r = await readInteractions({ evaluate: async () => null }, null);
    assert.strictEqual(r.readable, false);
    assert.strictEqual(r.items.length, 0);
    assert.strictEqual(r.seekLocked, false);
  });

  await check('frame.evaluate lỗi -> không crash, readable=false', async () => {
    const r = await readInteractions({ evaluate: async () => { throw new Error('detached'); } }, null);
    assert.strictEqual(r.readable, false);
    assert.strictEqual(r.items.length, 0);
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

  console.log('\ninteractiveVideo.verdictOf — không tính "đã giải" khi còn SAI / bỏ trắng');

  await check('có câu SAI (bad>0) -> "wrong" (dù cũng có ok)', async () => {
    assert.strictEqual(verdictOf({ ok: 2, bad: 1, handled: 1 }), 'wrong');
  });

  await check('trả lời & không sai (ok>0) -> "solved"', async () => {
    assert.strictEqual(verdictOf({ ok: 3, bad: 0, handled: 1 }), 'solved');
  });

  await check('không có feedback nhưng CÓ thao tác (handled) -> "solved"', async () => {
    assert.strictEqual(verdictOf({ ok: 0, bad: 0, handled: 1 }), 'solved');
  });

  await check('dialog mở nhưng bỏ trắng (ok=bad=handled=0) -> "unverified"', async () => {
    assert.strictEqual(verdictOf({ ok: 0, bad: 0, handled: 0 }), 'unverified');
  });

  await check('thiếu hẳn field feedback -> "unverified" (không crash)', async () => {
    assert.strictEqual(verdictOf({}), 'unverified');
    assert.strictEqual(verdictOf(null), 'unverified');
    assert.strictEqual(verdictOf(undefined), 'unverified');
  });

  // ── answerSingleChoiceSet: DOM thật của H5P.SingleChoiceSet 1.11 ──
  // Đặc điểm đã verify live 22/10/2026:
  //   • Mỗi slide là `.h5p-sc-slide`; slide hiện tại có `.h5p-sc-current-slide`.
  //   • Mọi alternative có SẴN class nội dung `h5p-sc-is-correct` / `h5p-sc-is-wrong`
  //     NGAY TỪ ĐẦU (không phải feedback) -> phải chọn theo class này.
  //   • Click xong H5P gắn `h5p-sc-selected` + `h5p-sc-reveal-correct|wrong`, rồi
  //     autoContinue ~2s mới sang slide kế; cuối cùng là slide `.h5p-sc-set-results`.
  // Fake mô phỏng cả độ trễ chuyển slide (advanceAfterReads) để bắt lỗi cũ
  // "đọc lại sau 350ms vẫn thấy slide cũ -> tưởng hết bài".
  function scsFrame(slides, opts = {}) {
    const state = {
      cur: 0, clicks: [], done: false,
      advanceIn: 0, reads: 0, flicker: 0,
      slides: slides.map((s) => ({ ...s, answers: (s.answers || []).map((a) => ({ ...a })) })),
    };
    // Slide kết quả luôn tồn tại sau slide cuối.
    state.slides.push({ q: '', answers: [], result: true });
    const elOf = (a) => ({
      className: a.cls || (a.correct ? 'h5p-sc-alternative h5p-sc-is-correct' : 'h5p-sc-alternative h5p-sc-is-wrong'),
      innerText: a.t || '',
      textContent: a.t || '',
      querySelector: () => null,
    });
    const slideEl = (s, i) => ({
      className: 'h5p-sc-slide h5p-sc'
        + (s.result ? ' h5p-sc-set-results' : '')
        + (i === state.cur && !state.flicker ? ' h5p-sc-current-slide' : ''),
      querySelector: (sel) => (sel === '.h5p-sc-question'
        ? { innerText: s.q || '', textContent: s.q || '' } : null),
      querySelectorAll: (sel) => (sel === '.h5p-sc-alternative' ? (s.answers || []).map(elOf) : []),
    });
    // Mỗi lần đọc state = 1 nhịp; hết advanceIn thì H5P sang slide kế.
    const tick = () => {
      state.reads++;
      // Live: H5P gỡ `h5p-sc-current-slide` khỏi MỌI slide trong lúc animate
      // chuyển slide (vài nhịp đọc liên tiếp không có current).
      if (state.flicker > 0) {
        state.flicker--;
        if (state.flicker === 0) state.cur++;
        return;
      }
      if (state.advanceIn > 0) {
        state.advanceIn--;
        if (state.advanceIn === 0) {
          // Live IV 1.27/SCS 1.11 (22/10/2026): sau slide CUỐI, màn kết quả
          // không nhận class `h5p-sc-current-slide` -> slide cuối đứng yên.
          if (opts.stuckAtLast && state.cur === state.slides.length - 2) return;
          if (opts.transitionFlicker) { state.flicker = opts.transitionFlicker; return; }
          state.cur++;
        }
      }
    };
    const slidesLoc = {
      evaluateAll: async (fn) => { tick(); return fn(state.slides.map(slideEl)); },
      nth: (i) => ({
        locator: () => ({
          nth: (j) => ({
            boundingBox: async () => null,
            click: async () => {
              const idx = state.cur;
              const s = state.slides[idx];
              const a = s && !s.result && (s.answers || [])[j];
              if (!a) return;
              state.clicks.push(a.t);
              // opts.markedWrong: mô phỏng H5P chấm SAI dù class nội dung nói đúng
              const ok = opts.markedWrong ? false : !!a.correct;
              a.cls = ok
                ? 'h5p-sc-alternative h5p-sc-is-correct h5p-sc-selected h5p-sc-reveal-correct'
                : 'h5p-sc-alternative h5p-sc-is-wrong h5p-sc-selected h5p-sc-reveal-wrong';
              state.advanceIn = opts.advanceAfterReads || 1;
              if (state.cur === state.slides.length - 2) state.done = true;
            },
            evaluate: async (fn) => fn(elOf((state.slides[state.cur].answers || [])[j] || {})),
          }),
        }),
      }),
    };
    const seenSels = [];
    return {
      _state: state,
      _sels: seenSels,
      page: () => ({ mouse: {} }),
      locator: (sel) => {
        seenSels.push(sel);
        if (sel.includes('h5p-sc-slide')) return slidesLoc;
        return { count: async () => 0, first: () => ({ count: async () => 0, innerText: async () => '' }) };
      },
      evaluate: async () => ({}),
    };
  }

  // Review 2: H5P giữ DOM của các dialog SCS đã đóng. Locator toàn frame
  // `.h5p-sc-slide` sẽ đọc/click cả slide ẩn của mốc trước -> trả lời nhầm.
  await check('SCS: chỉ đọc slide trong SCS ĐANG MỞ (không đụng dialog ẩn)', async () => {
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1?</p>', answers: ['<p>Đúng 1</p>', '<p>Sai 1</p>'] },
    ] } });
    const f = scsFrame([{ q: 'Câu 1?', answers: [{ t: 'Đúng 1', correct: true }, { t: 'Sai 1' }] }]);
    const r = await answerSingleChoiceSet(f, extracted);
    assert.strictEqual(r.solved, true);
    assert.ok(f._sels.some((s) => s.includes('.h5p-single-choice-set:visible') && s.includes('.h5p-sc-slide')),
      `locator slide phải scope trong SCS đang mở (nhận ${JSON.stringify(f._sels)})`);
  });

  await check('SCS: chờ autoContinue (~2s) mới sang slide -> trả lời HẾT các slide', async () => {
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1: thể thơ?</p>', answers: ['<p>B. song thất lục bát</p>', '<p>A. lục bát</p>'] },
      { question: '<p>Câu 2: tác giả?</p>', answers: ['<p>Đáp án đúng 2</p>', '<p>B. song thất lục bát</p>'] },
    ] } });
    const f = scsFrame([
      { q: 'Câu 1: thể thơ?', answers: [{ t: 'B. song thất lục bát', correct: true }, { t: 'A. lục bát' }] },
      { q: 'Câu 2: tác giả?', answers: [{ t: 'B. song thất lục bát' }, { t: 'Đáp án đúng 2', correct: true }] },
    ], { advanceAfterReads: 8 });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.deepStrictEqual(f._state.clicks, ['B. song thất lục bát', 'Đáp án đúng 2']);
    assert.strictEqual(r.clicked, 2);
    assert.strictEqual(r.wrong, 0);
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.solved, true);
  });

  await check('SCS: 6 slide, mỗi slide tốn 2 vòng (click + chờ chuyển) -> không bị cắt bởi maxSteps', async () => {
    const six = [1, 2, 3, 4, 5, 6];
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices:
      six.map((n) => ({ question: `<p>Câu ${n}?</p>`, answers: [`<p>Đúng ${n}</p>`, `<p>Sai ${n}</p>`] })) } });
    const f = scsFrame(six.map((n) => ({ q: `Câu ${n}?`, answers: [{ t: `Đúng ${n}`, correct: true }, { t: `Sai ${n}` }] })),
      { advanceAfterReads: 3 });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.strictEqual(r.clicked, 6, 'phải trả lời đủ 6 slide');
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.solved, true);
  });

  await check('SCS: H5P gỡ current-slide trong lúc chuyển slide -> CHỜ, không dừng sớm (live 22/10/2026)', async () => {
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1?</p>', answers: ['<p>Đúng 1</p>', '<p>Sai 1</p>'] },
      { question: '<p>Câu 2?</p>', answers: ['<p>Sai 2</p>', '<p>Đúng 2</p>'] },
    ] } });
    const f = scsFrame([
      { q: 'Câu 1?', answers: [{ t: 'Đúng 1', correct: true }, { t: 'Sai 1' }] },
      { q: 'Câu 2?', answers: [{ t: 'Sai 2' }, { t: 'Đúng 2', correct: true }] },
    ], { advanceAfterReads: 1, transitionFlicker: 3 });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.deepStrictEqual(f._state.clicks, ['Đúng 1', 'Đúng 2'], 'không được bỏ slide 2');
    assert.strictEqual(r.clicked, 2);
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.solved, true);
  });

  await check('SCS: trả lời đủ slide nhưng màn kết quả KHÔNG nhận current-slide -> vẫn done (live 22/10/2026)', async () => {
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1?</p>', answers: ['<p>Đúng 1</p>', '<p>Sai 1</p>'] },
      { question: '<p>Câu 2?</p>', answers: ['<p>Sai 2</p>', '<p>Đúng 2</p>'] },
    ] } });
    const f = scsFrame([
      { q: 'Câu 1?', answers: [{ t: 'Đúng 1', correct: true }, { t: 'Sai 1' }] },
      { q: 'Câu 2?', answers: [{ t: 'Sai 2' }, { t: 'Đúng 2', correct: true }] },
    ], { advanceAfterReads: 1, stuckAtLast: true });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.strictEqual(r.clicked, 2);
    assert.strictEqual(r.correct, 2);
    assert.strictEqual(r.wrong, 0);
    assert.strictEqual(r.done, true, 'đã trả lời đủ 2/2 slide thì phải coi là xong');
    assert.strictEqual(r.solved, true);
  });

  await check('SCS: slide RỖNG thật (question + 2 đáp án trống) -> bấm đáp án đúng theo class, không bỏ dở', async () => {    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1?</p>', answers: ['<p>Đúng 1</p>', '<p>Sai 1</p>'] },
      { question: '', answers: ['', ''] },
    ] } });
    const f = scsFrame([
      { q: 'Câu 1?', answers: [{ t: 'Đúng 1', correct: true }, { t: 'Sai 1' }] },
      { q: '', answers: [{ t: '', correct: true }, { t: '' }] },
    ], { advanceAfterReads: 4 });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.deepStrictEqual(f._state.clicks, ['Đúng 1', '']);
    assert.strictEqual(r.done, true);
    assert.strictEqual(r.solved, true);
  });

  await check('SCS: chọn theo class nội dung, KHÔNG theo text trùng ở slide khác', async () => {
    // Đáp án đúng của slide 1 trùng chữ với nhiễu của slide 2 -> phải dùng class.
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Q1</p>', answers: ['<p>Giống nhau</p>'] },
      { question: '<p>Q2</p>', answers: ['<p>Đúng 2</p>'] },
    ] } });
    const f = scsFrame([
      { q: 'Q1', answers: [{ t: 'Giống nhau' }, { t: 'Giống nhau', correct: true }] },
      { q: 'Q2', answers: [{ t: 'Giống nhau' }, { t: 'Đúng 2', correct: true }] },
    ], { advanceAfterReads: 2 });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.deepStrictEqual(f._state.clicks, ['Giống nhau', 'Đúng 2']);
    assert.strictEqual(r.solved, true);
  });

  await check('SCS: H5P chấm SAI dù đã chọn -> wrong>0, KHÔNG báo solved', async () => {
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1?</p>', answers: ['<p>Đúng</p>'] },
    ] } });
    const f = scsFrame([{ q: 'Câu 1?', answers: [{ t: 'Đúng', correct: true }] }], { markedWrong: true });
    const r = await answerSingleChoiceSet(f, extracted);
    assert.strictEqual(r.clicked, 1);
    assert.strictEqual(r.wrong, 1);
    assert.strictEqual(r.solved, false);
  });

  await check('SCS: không có class đúng & text không khớp -> KHÔNG click bừa', async () => {
    const extracted = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
      { question: '<p>Câu 1?</p>', answers: ['<p>Đáp án đúng</p>', '<p>Sai</p>'] },
    ] } });
    const f = scsFrame([{ q: 'Câu 1?', answers: [{ t: 'X' }, { t: 'Y' }] }]);
    const r = await answerSingleChoiceSet(f, extracted);
    assert.deepStrictEqual(f._state.clicks, []);
    assert.strictEqual(r.solved, false);
  });

  await check('Feedback: SCS không dùng class reveal để đếm (reveal-wrong gắn cho MỌI đáp án sai)', async () => {
    assert.ok(!FB_WRONG_SEL.includes('h5p-sc-is-wrong'),
      'h5p-sc-is-wrong là metadata nội dung (có sẵn trước khi trả lời) — đếm nó sẽ báo sai oan');
    assert.ok(!FB_CORRECT_SEL.includes('h5p-sc-is-correct'), 'tương tự với h5p-sc-is-correct');
    // Live 22/10/2026 (SCS 1.11 trong IV 1.27): sau khi trả lời, H5P gắn
    // `h5p-sc-reveal-wrong` cho MỌI đáp án sai của slide — kể cả đáp án KHÔNG
    // được chọn. Đếm chúng biến 5/5 câu đúng thành bad=1 (báo sai oan). Kết quả
    // đúng/sai của SCS lấy từ answerSingleChoiceSet (chỉ xét đáp án ĐÃ CHỌN).
    assert.ok(!FB_CORRECT_SEL.includes('h5p-sc-reveal-correct'), 'SCS: reveal-correct cũng là feedback của cả slide, không phải đếm toàn cục');
    assert.ok(!FB_WRONG_SEL.includes('h5p-sc-reveal-wrong'), 'SCS: reveal-wrong gắn cho cả đáp án không chọn -> không đếm');
    // Vẫn phải giữ tín hiệu feedback thật của MultiChoice/TrueFalse.
    assert.ok(FB_CORRECT_SEL.includes('.h5p-correct'), 'MultiChoice đúng vẫn dùng .h5p-correct');
    assert.ok(FB_WRONG_SEL.includes('.h5p-wrong'), 'MultiChoice sai vẫn dùng .h5p-wrong');
  });

  // ── MultiChoice popup trong IV: phân biệt đáp án trùng text bằng MathML ──
  function fakeMcPopup(els, sel = '.h5p-answer') {
    const clicked = [];
    const mathNode = (spec) => {
      const fracs = spec.split('|').map((p) => p.split('/'));
      return {
        textContent: spec.replace(/[/|]/g, ''),
        querySelectorAll: (s) => (s === 'mfrac' ? fracs.map((p) => ({ children: p.map((x) => ({ textContent: x })) })) : []),
      };
    };
    const mkAns = (i) => ({
      boundingBox: async () => null,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => { clicked.push(i); els[i].selected = true; },
      locator: () => ({ count: async () => 0, first() { return this; } }),
      evaluate: async (fn) => fn({
        className: (sel === '.h5p-answer' ? 'h5p-answer' : 'h5p-true-false-answer')
          + (els[i].selected ? ' h5p-selected' : ''),
        getAttribute: () => null,
        querySelector: () => null,
      }),
    });
    const answers = {
      count: async () => els.length,
      nth: (i) => mkAns(i),
      evaluateAll: async (fn) => fn(els.map((e) => ({
        offsetWidth: 1, offsetHeight: 1,
        // `inner` cho phép mô phỏng MathML thật: innerText trả ký tự toán học
        // (𝑓 U+1D453) trong khi textContent vẫn là chữ thường "f".
        innerText: e.inner == null ? e.t : e.inner, textContent: e.t,
        querySelector: (s) => (s === 'math' && e.math ? mathNode(e.math) : null),
        querySelectorAll: (s) => (s === 'img'
          ? (e.imgs || []).map((src) => ({ getAttribute: () => src, src }))
          : []),
      }))),
    };
    return {
      qc: { locator: (s) => (s === sel ? answers : { count: async () => 0 }) },
      clicked,
    };
  }

  await check('MC popup: MathML trùng text -> chọn phân số đúng, không chọn nhiễu', async () => {
    const { qc, clicked } = fakeMcPopup([
      { t: 'G = 25f', math: '' },
      { t: 'G = 25f', math: '25/f' },
      { t: 'G = f25', math: 'f/25' },
    ]);
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc,
      { correctTexts: ['G = 25f'], correctMath: ['25/f'] }, null, 'H5P.MultiChoice 1.16');
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [1], 'phải click node phân số 25/f');
  });

  await check('MC popup: innerText MathML trả 𝑓 (U+1D453) -> khớp bằng textContent, không click nhiễu', async () => {
    const { qc, clicked } = fakeMcPopup([
      { t: 'G = 25f', inner: 'G = 25f', math: '' },
      // Đúng như DOM thật: <mi>f</mi> -> innerText "𝑓", textContent "f".
      { t: 'G = 25f', inner: 'G = 25\u{1D453}', math: '25/f' },
      { t: 'G = f25', inner: 'G = \u{1D453}25', math: 'f/25' },
    ]);
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc,
      { correctTexts: ['G = 25f'], correctMath: ['25/f'] }, null, 'H5P.MultiChoice 1.16');
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [1], 'textContent phải được ưu tiên để không khớp nhầm nhiễu');
  });

  await check('MC popup: text trùng, không chữ ký MathML -> KHÔNG click (nhập nhằng)', async () => {
    const { qc, clicked } = fakeMcPopup([{ t: 'A' }, { t: 'A' }, { t: 'B' }]);
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc,
      { correctTexts: ['A'] }, null, 'H5P.MultiChoice 1.16');
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(clicked, [], 'không được đoán giữa 2 đáp án giống nhau');
  });

  await check('MC popup: TrueFalse (.h5p-true-false-answer) -> chọn đúng Đúng/Sai, không bỏ qua', async () => {
    const { qc, clicked } = fakeMcPopup([{ t: 'Đúng' }, { t: 'Sai' }], '.h5p-true-false-answer');
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc,
      { correctTexts: ['Đúng'] }, null, 'H5P.TrueFalse 1.8');
    assert.strictEqual(r.solved, true, 'TrueFalse phải được nhận diện & trả lời');
    assert.deepStrictEqual(clicked, [0]);
  });

  // Đáp án ảnh: text rỗng nên correctTexts rỗng. Trước đây nhánh "không có
  // correctTexts" click cái đầu (single) -> ghi câu SAI. Phải khớp src ảnh.
  await check('MC popup: đáp án là ẢNH -> khớp correctImages theo src, không click bừa', async () => {
    const { qc, clicked } = fakeMcPopup([
      { t: '', imgs: ['https://cdn.x/a/sai.png'] },
      { t: '', imgs: ['https://cdn.x/b/dung.png'] },
    ]);
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc,
      { correctTexts: [], correctImages: ['https://khac.y/z/dung.png'] }, null, 'H5P.MultiChoice 1.16');
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(clicked, [1], 'chỉ click ảnh khớp basename');
  });

  await check('MC popup: không text, ảnh không khớp -> KHÔNG click (no-answers)', async () => {
    const { qc, clicked } = fakeMcPopup([
      { t: '', imgs: ['https://cdn.x/a/sai.png'] },
      { t: '', imgs: ['https://cdn.x/b/khac.png'] },
    ]);
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc,
      { correctTexts: [], correctImages: ['https://cdn.x/b/dung.png'] }, null, 'H5P.MultiChoice 1.16');
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(clicked, [], 'không được đoán khi không khớp ảnh');
  });

  await check('MC popup: correctTexts rỗng, không có ảnh -> KHÔNG click (no-answers)', async () => {
    const { qc, clicked } = fakeMcPopup([{ t: 'A' }, { t: 'B' }]);
    const r = await answerChoiceInPopup({ page: () => ({ mouse: {} }) }, qc, {}, null, 'H5P.MultiChoice 1.16');
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(clicked, []);
    assert.strictEqual(r.reason, 'no-answers');
  });

  // Feedback không xác nhận được KHÔNG được coi là solved: nếu nút Kiểm tra bấm
  // trượt (checkFailed) hoặc Summary còn dòng chưa xác định -> unverified.
  await check('verdictOf: handled nhưng nút Kiểm tra bấm trượt -> unverified', async () => {
    assert.strictEqual(verdictOf({ ok: 0, bad: 0, handled: 1, checkFailed: 1 }), 'unverified');
  });
  await check('verdictOf: còn dòng Summary chưa xác định -> unverified dù đã click dòng khác', async () => {
    assert.strictEqual(verdictOf({ ok: 1, bad: 0, handled: 1, unverified: 1 }), 'unverified');
  });

  function fakeSummaryQc(rows) {
    const clicks = rows.map(() => 0);
    const qc = {
      locator: () => ({
        nth: (i) => ({
          boundingBox: async () => null,
          click: async () => { clicks[i]++; },
        }),
      }),
      evaluate: async (fn) => fn({
        querySelectorAll: () => rows.map((r) => ({
          innerText: r.txt, textContent: r.txt, getAttribute: () => r.bit,
        })),
      }),
    };
    return { qc, clicks };
  }

  await check('Summary popup: dòng không xác định -> KHÔNG click, trả unverified=1', async () => {
    const { qc, clicks } = fakeSummaryQc([{ txt: 'câu lạ', bit: null }]);
    const r = await answerSummaryInPopup({}, qc, { rows: [{ text: 'khác', correct: true }] }, null);
    assert.strictEqual(r.clicked, 0);
    assert.strictEqual(r.unverified, 1);
    assert.deepStrictEqual(clicks, [0], 'không được đoán trạng thái đúng/sai');
  });

  await check('Summary popup: data-bit đầy đủ -> click đúng 1/2 lần, unverified=0', async () => {
    const { qc, clicks } = fakeSummaryQc([{ txt: 'a', bit: '1' }, { txt: 'b', bit: '0' }]);
    const r = await answerSummaryInPopup({}, qc, { rows: [] }, null);
    assert.strictEqual(r.clicked, 2);
    assert.strictEqual(r.unverified, 0);
    assert.deepStrictEqual(clicks, [1, 2], 'đúng click 1 lần, sai click 2 lần');
  });

  await check('isEmptyBlanksOnly: Blanks 0 ô trống, 0 đáp án -> true (bỏ qua, không tính câu hỏi)', async () => {
    const group = [{ kind: 'blanks', library: 'H5P.Blanks 1.14', extracted: { answers: [] } }];
    assert.strictEqual(isEmptyBlanksOnly(group, 0), true);
    // Có ô trống -> KHÔNG rỗng (phải giải thật).
    assert.strictEqual(isEmptyBlanksOnly(group, 2), false);
    // Có đáp án trích được dù DOM chưa thấy input -> KHÔNG rỗng (tránh bỏ sót).
    assert.strictEqual(isEmptyBlanksOnly([{ kind: 'blanks', extracted: { answers: ['Sóng điện từ'] } }], 0), false);
    // Dialog trộn nhiều interaction -> KHÔNG bỏ qua.
    assert.strictEqual(isEmptyBlanksOnly([...group, { kind: 'choice', extracted: {} }], 0), false);
    // Không phải blanks -> false.
    assert.strictEqual(isEmptyBlanksOnly([{ kind: 'choice', extracted: {} }], 0), false);
  });

  // Live 22/10/2026 (Tin B3, TrueFalse 1.8): humanClick theo toạ độ trượt nút
  // "Kiểm tra" (nút nằm ngoài viewport) -> click không có hiệu lực, không có
  // feedback, mốc bị coi là "chưa xác minh". Playwright click tự cuộn + hit-test.
  function fakeCheckQc(opts = {}) {
    const clicks = { pw: 0, dom: 0 };
    const btn = {
      count: async () => 1,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => { if (opts.pwFail) throw new Error('element is outside of the viewport'); clicks.pw++; },
      evaluate: async (fn) => {
        if (/click/.test(String(fn))) { clicks.dom++; return null; }
        return { d: false, a: null }; // trạng thái disabled của nút
      },
    };
    return { qc: { locator: () => ({ first: () => btn }) }, clicks };
  }

  await check('pressCheckIn: Playwright click được -> bấm đúng 1 lần, không cần DOM click', async () => {
    const { qc, clicks } = fakeCheckQc();
    const ok = await pressCheckIn(qc, null);
    assert.strictEqual(ok, true);
    assert.strictEqual(clicks.pw, 1, 'phải bấm bằng Playwright click');
    assert.strictEqual(clicks.dom, 0, 'không fallback khi click thành công');
  });

  await check('pressCheckIn: Playwright click trượt (ngoài viewport) -> fallback DOM click', async () => {
    const { qc, clicks } = fakeCheckQc({ pwFail: true });
    const ok = await pressCheckIn(qc, null);
    assert.strictEqual(ok, true);
    assert.strictEqual(clicks.dom, 1, 'phải fallback DOM click để không bỏ trắng mốc');
  });

  // Live 22/10/2026: mốc không mở được dialog / hết deadline trước đây chỉ
  // `continue` mà không tăng unverified -> wrong=0, unverified=0 dù solved<total
  // -> flow.js markComplete dù còn mốc bỏ trắng. Mọi job chưa xử lý phải thành
  // unverified để cổng trung thực chặn.
  await check('settleVideoCounts: mốc chưa xử lý -> unverified (chặn markComplete)', async () => {
    const r = settleVideoCounts({ jobCount: 3, doneCount: 2, skippedEmpty: 0, solved: 2, wrong: 0, unverified: 0 });
    assert.deepStrictEqual(r, { solved: 2, total: 3, wrong: 0, unverified: 1 });
  });

  await check('settleVideoCounts: Blanks rỗng -> giảm total, KHÔNG thành unverified', async () => {
    const r = settleVideoCounts({ jobCount: 3, doneCount: 2, skippedEmpty: 1, solved: 2, wrong: 0, unverified: 0 });
    assert.deepStrictEqual(r, { solved: 2, total: 2, wrong: 0, unverified: 0 });
  });

  await check('settleVideoCounts: giữ nguyên wrong/unverified đã có + job lỗi', async () => {
    const r = settleVideoCounts({ jobCount: 4, doneCount: 3, skippedEmpty: 0, solved: 1, wrong: 1, unverified: 1 });
    assert.deepStrictEqual(r, { solved: 1, total: 4, wrong: 1, unverified: 2 });
  });

  // Live 22/10/2026 (Tin B3 mốc 1086s): vỏ TrueFalse render nút "Kiểm tra" trước
  // khi 2 đáp án xuất hiện. waitDialog chỉ được chờ NỘI DUNG TRẢ LỜI; nếu chờ nút
  // thì trả về sớm, inventory thấy 0 đáp án -> bỏ trắng mốc oan.
  await check('DIALOG_CONTENT_SELECTOR: chờ đáp án thật, KHÔNG chờ nút Kiểm tra/Tiếp tục', async () => {
    for (const sel of ['.h5p-answer', '.h5p-true-false-answer', '.h5p-sc-alternative',
      'input.h5p-text-input', '.h5p-summary li[data-bit]',
      '.h5p-mark-the-words span[role=option]', '.h5p-draggable',
      // DragText không có .h5p-answer/.h5p-draggable -> phải nhận diện từ/ô thả,
      // nếu không dialog DragText bị coi là rỗng và mốc bị bỏ trắng.
      '.h5p-drag-text .ui-draggable', '.h5p-drag-text .ui-droppable']) {
      assert.ok(DIALOG_CONTENT_SELECTOR.includes(sel), `phải chờ ${sel}`);
    }
    assert.ok(!DIALOG_CONTENT_SELECTOR.includes('h5p-question-check-answer'), 'không được chờ nút Kiểm tra');
    assert.ok(!DIALOG_CONTENT_SELECTOR.includes('h5p-question-iv-continue'), 'không được chờ nút Tiếp tục');
  });

  // Critical (review 2): "không thấy nội dung sau 1.5s" chỉ được coi là Blanks
  // RỖNG khi dialog ĐÃ MỞ. Nếu nút/marker không mở được dialog thì không có gì
  // chứng minh mốc rỗng -> phải để mốc thành unverified, không trừ khỏi tổng.
  await check('classifyBlanksProbe: chỉ skip khi dialog mở thật + 0 nội dung', async () => {
    assert.strictEqual(classifyBlanksProbe({ hasQ: 1, hasDialog: 1 }), 'content');
    assert.strictEqual(classifyBlanksProbe({ hasQ: 0, hasDialog: 1 }), 'empty');
    assert.strictEqual(classifyBlanksProbe({ hasQ: 0, hasDialog: 0 }), 'missed');
    assert.strictEqual(classifyBlanksProbe(null), 'missed', 'không đọc được DOM -> không được coi là rỗng');
  });

  // Live Tin B3 mốc 0s: Blanks rỗng không render nội dung nào -> waitDialog chờ
  // đáp án sẽ timeout 10s, để dialog treo và chặn luôn mốc kế. Phải nhận diện
  // TRƯỚC khi mở dialog và bỏ qua (không tính câu hỏi).
  await check('isEmptyBlanksStop: nhận diện mốc chỉ có Blanks rỗng (mở ngắn xác nhận)', async () => {
    const items = [
      { isSummary: false, from: 0, kind: 'blanks', extracted: { answers: [] } },
      { isSummary: false, from: 100, kind: 'choice', extracted: { correctTexts: ['A'] } },
      { isSummary: true, from: 3, kind: 'summary', extracted: { rows: [{}] } },
    ];
    assert.strictEqual(isEmptyBlanksStop(items, 0), true);
    assert.strictEqual(isEmptyBlanksStop(items, 100), false);
    assert.strictEqual(isEmptyBlanksStop([{ from: 5, kind: 'blanks', extracted: { answers: ['x'] } }], 5), false);
    assert.strictEqual(isEmptyBlanksStop([
      ...items.filter((x) => x.from === 0),
      { isSummary: false, from: 0, kind: 'choice', extracted: {} },
    ], 0), false);
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
