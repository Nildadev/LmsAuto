'use strict';
/**
 * Test offline cho H5P.QuestionSet ĐỨNG RIÊNG (không lồng trong sách).
 *
 * Bối cảnh (debug live 22/10/2026): bài "Bài tập trắc nghiệm" của KHTN có
 * library = "H5P.QuestionSet 1.20" ở mức top-level. flow.solveSingle goi
 * extractAnswers(lib) -> ROUTER không có QuestionSet -> null -> "unknown" ->
 * báo lỗi, KHÔNG giải (dù solver.solveQuestionSet đã tồn tại nhưng không nơi nào gọi).
 *
 * Test này phủ 2 lớp:
 *   1) solver.solveQuestionSet: bấm nút bắt đầu -> đi từng câu -> correctCount.
 *   2) flow.solveSingle: định tuyến QuestionSet -> solveQuestionSet + map kết quả
 *      theo chính sách trung thực (câu sai / chưa hết câu => KHÔNG ok).
 *
 * Chạy: node tests/questionset.test.js
 */
const assert = require('assert');
const { solveQuestionSet, pickSubIndex } = require('../src/h5p/solver');
const { solveSingle, solveItem, deps } = require('../src/core/flow');
const { extractAnswers } = require('../src/h5p/extract');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** 2 câu QuestionSet dạng dump thật (rút gọn, giữ đúng shape jsonContent). */
const QS_JSON = {
  introPage: { showIntroPage: false, startButtonText: 'Bắt đầu Đố vui' },
  progressType: 'dots',
  passPercentage: 50,
  questions: [
    {
      library: 'H5P.MultiChoice 1.16',
      params: { question: '<p>Câu 1?</p>', answers: [
        { text: '<p>đáp án đúng 1</p>', correct: true },
        { text: '<p>đáp án sai A</p>', correct: false },
      ] },
    },
    {
      library: 'H5P.MultiChoice 1.16',
      params: { question: '<p>Câu 2?</p>', answers: [
        { text: '<p>đáp án sai B</p>', correct: false },
        { text: '<p>đáp án đúng 2</p>', correct: true },
      ] },
    },
  ],
};

/** Danh sách câu con của QuestionSet mẫu (module-level cho fake frame dùng). */
const subs = QS_JSON.questions;

/**
 * Frame giả mô phỏng QuestionSet chạy thật:
 *   - DOM đổi theo state.q (câu hiện hành) + state.checked + state.started.
 *   - state.q KHÔNG nhất thiết là thứ tự trong json.questions (H5P xáo câu hỏi).
 *   - evaluate(fn, selString) = countVisible; evaluate(fn) = trả GỘP feedback +
 *     điểm cuối + text/answers hiện hành (mỗi call site chỉ đọc field nó cần).
 * @param {object} o { startButton:boolean, failAt:number|null, order:number[] }
 */
function fakeQsFrame(o = {}) {
  const startButton = o.startButton !== false;
  const failAt = o.failAt === undefined ? null : o.failAt;
  const order = o.order || subs.map((_, i) => i);
  const state = { q: 0, checked: false, selected: [], started: !startButton };
  const clicked = [];
  /** câu đang hiện trên DOM. */
  const cur = () => subs[order[Math.min(state.q, order.length - 1)]];

  /** Các node ĐANG HIỆN ở trạng thái hiện hành. */
  const nodes = () => {
    const out = [];
    if (startButton && !state.started) out.push({ cls: 'h5p-question-start', tag: 'button', t: 'Bắt đầu Đố vui' });
    if (state.started && state.q < subs.length) {
      const q = cur();
      if (!state.checked) {
        // MultiChoice thật: mỗi đáp án nằm trong .h5p-answer && .h5p-alternative-container
        (q.params.answers || []).forEach((a) => out.push({ cls: 'h5p-answer h5p-alternative-container', t: a.text.replace(/<[^>]*>/g, '').trim() }));
        out.push({ cls: 'h5p-question-check-answer', tag: 'button', t: 'Kiểm tra' });
      } else {
        const ok = failAt !== state.q;
        out.push({ cls: ok ? 'h5p-correct' : 'h5p-wrong', t: '' });
        if (ok && state.q < subs.length - 1) out.push({ cls: 'h5p-question-next', tag: 'button', t: 'Câu tiếp theo' });
      }
    }
    return out;
  };
  const match = (sel) => {
    const parts = String(sel).replace(/:visible/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    return nodes().filter((e) => parts.some((p) => {
      const tag = p.replace(/^\./, '');
      if (p.startsWith('.')) return e.cls.split(/\s+/).includes(tag);
      return e.tag === p || (p === 'button' && e.tag === 'button');
    }));
  };
  const mk = (sel) => {
    const self = {
      count: async () => match(sel).length,
      allInnerTexts: async () => match(sel).map((e) => e.t),
      first: () => mk(sel),
      nth: (i) => mk(`${sel}#${i}`),
      isVisible: async () => true,
      waitFor: async () => {},
      boundingBox: async () => null,
      innerText: async () => '',
      locator: (s) => mk(s),
      // Locator.evaluateAll có thật trong Playwright; solver dùng 1 lượt đọc
      // visible+text thay vì 2 round-trip/đáp án -> fake phải mô phỏng.
      evaluateAll: async (fn2) => fn2(match(sel).map((e) => ({
        offsetWidth: 1, offsetHeight: 1, innerText: e.t, textContent: e.t,
        getClientRects: () => [{}], querySelector: () => null,
      }))),
      click: async () => {
        const idx = Number((sel.match(/#(\d+)$/) || [])[1] || 0);
        const list = match(sel.replace(/#\d+$/, ''));
        const el = list[idx];
        clicked.push(sel);
        if (!el) return;
        if (el.cls === 'h5p-question-start') { state.started = true; return; }
        if (el.cls.split(/\s+/).includes('h5p-answer')) { state.selected.push(el.t); (state.pickedAll = state.pickedAll || []).push(el.t); return; }
        if (el.cls.includes('check-answer') || el.t === 'Kiểm tra') { state.checked = true; return; }
        if (el.cls.includes('question-next') || el.t === 'Câu tiếp theo') { state.q++; state.checked = false; state.selected = []; return; }
      },
    };
    return self;
  };
  return {
    state, clicked,
    locator: (sel) => mk(sel),
    evaluate: async (_fn, arg) => {
      if (typeof arg === 'string') return match(arg).length;
      const ok = !(failAt !== null && failAt === state.q);
      const allOk = failAt === null;
      const q = cur();
      return {
        wrong: state.checked && !ok ? 1 : 0,
        correct: state.checked && ok ? 1 : 0,
        ratio: { got: allOk ? subs.length : subs.length - 1, total: subs.length },
        barWidth: allOk ? '100%' : '50%',
        summary: '',
        // readCurrent() trong solveQuestionSet: text khối câu hỏi + đáp án hiện
        text: `${q.params.question.replace(/<[^>]*>/g, '')} ${(q.params.answers || []).map((a) => a.text.replace(/<[^>]*>/g, '')).join(' ')}`,
        answers: (q.params.answers || []).map((a) => a.text.replace(/<[^>]*>/g, '').trim()),
      };
    },
    page: () => ({ mouse: { move: async () => {}, down: async () => {}, up: async () => {}, click: async () => {} }, keyboard: { press: async () => {} } }),
  };
}

/** Frame giả cho câu chỉ có đáp án là ẢNH (innerText rỗng trên DOM). */
function fakeImgFrame(json) {
  const q = json.questions[0];
  const state = { started: true, checked: false };
  const fake = {
    state, answerClicks: 0,
    locator: (sel) => {
      const isAns = /h5p-answer|h5p-alternative-container/.test(sel);
      const nodes = isAns
        ? q.params.answers.map((a) => a.text.replace(/<[^>]*>/g, '').trim())
        : (state.checked ? [] : ['Kiểm tra']);
      const mk = () => ({
        count: async () => nodes.length,
        allInnerTexts: async () => nodes,
        first: mk, nth: () => mk(), isVisible: async () => true, waitFor: async () => {},
        boundingBox: async () => null, innerText: async () => '',
        locator: () => mk(),
        evaluateAll: async (fn2) => fn2(nodes.map((t) => ({
          offsetWidth: 1, offsetHeight: 1, innerText: t, textContent: t,
          getClientRects: () => [{}], querySelector: () => null,
        }))),
        click: async () => { if (isAns) fake.answerClicks++; else state.checked = true; },
      });
      return mk();
    },
    evaluate: async (_fn, arg) => {
      if (typeof arg === 'string') {
        if (/h5p-alternative-container|h5p-answer/.test(arg)) return q.params.answers.length;
        return 0;
      }
      return { wrong: 0, correct: 0, ratio: null, barWidth: '0%', summary: '', text: 'Xem hình và chọn đáp án', answers: ['', ''] };
    },
    page: () => ({ mouse: { move: async () => {}, down: async () => {}, up: async () => {}, click: async () => {} }, keyboard: { press: async () => {} } }),
  };
  return fake;
}

/** Frame giả cho flow.solveSingle: evaluate trả đúng jsonContent QuestionSet. */
function fakeSingleFrame(library) {
  const seen = [];
  return {
    seen,
    evaluate: async () => ({ library, json: JSON.parse(JSON.stringify(QS_JSON)) }),
    locator: () => ({ first: () => ({ boundingBox: async () => null }), count: async () => 0 }),
  };
}

(async () => {
  console.log('questionset (H5P.QuestionSet đứng riêng)');

  // ── 0. pickSubIndex: QuestionSet randomQuestions -> không chọn theo index ──
  const mkSub = (question, options) => ({ extracted: { question, options } });

  await check('pickSubIndex: khớp lời dẫn câu hỏi -> chọn đúng câu dù DOM xáo thứ tự', async () => {
    const list = [
      mkSub('Trái Đất quay quanh Mặt Trời', ['Đúng', 'Sai']),
      mkSub('Mặt Trăng là vệ tinh của Trái Đất', ['Đúng', 'Sai']),
    ];
    const cur = { text: 'Mặt Trăng là vệ tinh của Trái Đất Đúng Sai', answers: ['Đúng', 'Sai'] };
    assert.strictEqual(pickSubIndex(list, new Set(), cur), 1);
  });

  await check('pickSubIndex: nhãn đáp án chung chung khớp NHIỀU câu -> -1 (không đoán)', async () => {
    const list = [
      mkSub('Câu hỏi A dài hơn mười lăm ký tự', ['Đúng', 'Sai']),
      mkSub('Câu hỏi B dài hơn mười lăm ký tự', ['Đúng', 'Sai']),
    ];
    const cur = { text: 'nội dung khác hoàn toàn', answers: ['Đúng', 'Sai'] };
    assert.strictEqual(pickSubIndex(list, new Set(), cur), -1);
  });

  await check('pickSubIndex: chỉ còn 1 câu chưa dùng & nhãn khớp -> chọn (loại trừ)', async () => {
    const list = [
      mkSub('Câu hỏi A dài hơn mười lăm ký tự', ['Đúng', 'Sai']),
      mkSub('Câu hỏi B dài hơn mười lăm ký tự', ['Đúng', 'Sai']),
    ];
    const cur = { text: 'nội dung khác hoàn toàn', answers: ['Đúng', 'Sai'] };
    assert.strictEqual(pickSubIndex(list, new Set([0]), cur), 1);
  });

  // ── 1. solver.solveQuestionSet ───────────────────────────────────────────
  await check('solveQuestionSet: bấm nút "Bắt đầu" trước khi trả lời câu 1', async () => {
    const f = fakeQsFrame();
    const item = { kind: 'questionset', sub: subsFrom(QS_JSON) };
    const r = await solveQuestionSet(f, item, { logger: () => {} });
    assert.strictEqual(f.state.started, true, 'phải bấm nút bắt đầu');
    assert.ok(String(f.clicked[0]).includes('h5p-question-start'), `click đầu tiên là nút bắt đầu (nhận ${f.clicked[0]})`);
    assert.strictEqual(r.attempted, 2, `attempted=2 (nhận ${r.attempted})`);
    assert.strictEqual(r.correctCount, 2, `correctCount=2 (nhận ${r.correctCount})`);
  });

  await check('solveQuestionSet: correctCount giảm khi 1 câu sai', async () => {
    const f = fakeQsFrame({ failAt: 1 });
    const r = await solveQuestionSet(f, { kind: 'questionset', sub: subsFrom(QS_JSON) }, { logger: () => {} });
    assert.strictEqual(r.attempted, 2);
    assert.strictEqual(r.correctCount, 1, `correctCount=1 (nhận ${r.correctCount})`);
  });

  await check('solveQuestionSet: DOM xáo thứ tự câu -> vẫn khớp đúng câu theo nội dung', async () => {
    // Debug live 22/10/2026: QuestionSet có randomQuestions -> subs[step] theo
    // json KHÔNG trùng câu đang hiện -> click đáp án của câu khác -> sai dây.
    const f = fakeQsFrame({ order: [1, 0] });
    const r = await solveQuestionSet(f, { kind: 'questionset', sub: subsFrom(QS_JSON) }, { logger: () => {} });
    assert.strictEqual(r.attempted, 2, `attempted=2 (nhận ${r.attempted})`);
    assert.strictEqual(r.correctCount, 2, `cả 2 câu phải đúng (nhận ${r.correctCount})`);
    assert.deepStrictEqual(f.state.pickedAll, ['đáp án đúng 2', 'đáp án đúng 1'],
      'mỗi bước phải click đáp án đúng của CÂU ĐANG HIỆN, không phải câu theo index');
  });

  await check('solveQuestionSet: câu có đáp án là ẢNH (text rỗng) -> KHÔNG đoán mò', async () => {
    const imgJson = {
      questions: [{
        library: 'H5P.MultiChoice 1.16',
        params: { question: '<p>Xem hình và chọn đáp án</p>', answers: [
          { text: '<p></p>', correct: true }, { text: '<p></p>', correct: false },
        ] },
      }],
    };
    const f = fakeImgFrame(imgJson);
    const r = await solveQuestionSet(f, { kind: 'questionset', sub: subsFrom(imgJson) }, { logger: () => {} });
    assert.strictEqual(f.answerClicks, 0, 'không được click đáp án trống (đoán mò = ghi nhận câu SAI)');
    assert.strictEqual(r.correctCount, 0);
  });

  // ── 2. flow.solveSingle định tuyến ───────────────────────────────────────
  await check('solveSingle: lib=QuestionSet -> gọi solveQuestionSet với sub[] đã extract', async () => {
    let got = null;
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const d = deps({
      extractAnswers,
      solveQuestionSet: async (frame, item, opts) => { got = item; return { attempted: 2, correctCount: 2, total: 2, finalScore: { ratio: null, barWidth: '100%' } }; },
    });
    const r = await solveSingle(f, f, 'H5P.QuestionSet 1.20', () => {}, d);
    assert.ok(got, 'solveQuestionSet phải được gọi');
    assert.strictEqual(got.sub.length, 2);
    assert.deepStrictEqual(got.sub.map((s) => s.library), ['H5P.MultiChoice 1.16', 'H5P.MultiChoice 1.16']);
    assert.deepStrictEqual(got.sub.map((s) => s.extracted && s.extracted.kind), ['choice', 'choice'], 'mỗi câu con phải extract được đáp án');
    assert.deepStrictEqual(got.sub.map((s) => s.extracted.correctTexts), [['đáp án đúng 1'], ['đáp án đúng 2']], 'đáp án đúng trích theo text');
    assert.strictEqual(r.kind, 'single');
    assert.strictEqual(r.solved, 2, 'to bộ câu đúng -> solved=2');
    assert.strictEqual(r.wrong || 0, 0);
    assert.strictEqual(r.unverified || 0, 0);
  });

  await check('solveSingle: QuestionSet KHÔNG rơi vào nhánh single-unknown', async () => {
    const logs = [];
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const d = deps({ extractAnswers, solveQuestionSet: async () => ({ attempted: 2, correctCount: 2, total: 2, finalScore: { barWidth: '100%' } }) });
    await solveSingle(f, f, 'H5P.QuestionSet 1.20', (m) => logs.push(m), d);
    const all = logs.join('\n');
    assert.ok(!/single-unknown/.test(all), 'không được báo unknown');
    assert.ok(!/Không có câu hỏi/.test(all), 'không được coi là bài chỉ-có-xem');
  });

  await check('solveSingle: 1 câu sai -> wrong>0 (flow sẽ không markComplete)', async () => {
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const d = deps({ extractAnswers, solveQuestionSet: async () => ({ attempted: 2, correctCount: 1, total: 2, finalScore: { barWidth: '50%' } }) });
    const r = await solveSingle(f, f, 'H5P.QuestionSet 1.20', () => {}, d);
    assert.strictEqual(r.wrong, 1, `wrong=1 (nhận ${r.wrong})`);
  });

  await check('solveSingle: chưa đi hết câu (attempted<total) và bar<100% -> unverified>0', async () => {
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const d = deps({ extractAnswers, solveQuestionSet: async () => ({ attempted: 1, correctCount: 1, total: 2, finalScore: { barWidth: '50%' } }) });
    const r = await solveSingle(f, f, 'H5P.QuestionSet 1.20', () => {}, d);
    assert.strictEqual(r.unverified, 1, `unverified=1 (nhận ${r.unverified})`);
    assert.strictEqual(r.wrong, 0);
  });

  await check('solveSingle: bar 100% dù stopped sớm -> không phạt unverified', async () => {
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const d = deps({ extractAnswers, solveQuestionSet: async () => ({ attempted: 1, correctCount: 1, total: 2, finalScore: { barWidth: '100%' } }) });
    const r = await solveSingle(f, f, 'H5P.QuestionSet 1.20', () => {}, d);
    assert.strictEqual(r.unverified || 0, 0);
    assert.strictEqual(r.finalScore.bar, '100%');
  });

  await check('solveItem: QuestionSet đủ điều kiện -> ok=true, kind=single', async () => {
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const fakeTab = { goto: async () => {}, close: async () => {}, context: () => ({ newPage: async () => fakeTab }), mouse: { click: async () => {} } };
    const d = deps({
      extractAnswers,
      newTab: async () => fakeTab,
      findPlayerFrame: async () => f,
      detectKind: async () => ({ kind: 'single', library: 'H5P.QuestionSet 1.20' }),
      solveQuestionSet: async () => ({ attempted: 2, correctCount: 2, total: 2, finalScore: { barWidth: '100%' } }),
      videoUrl: () => 'https://x/1',
    });
    const r = await solveItem(fakeTab, { p: 'P', c: 'C', cs: 'CS' }, () => {}, {}, d);
    assert.strictEqual(r.ok, true, `ok phải true (nhận ${JSON.stringify(r)})`);
    assert.strictEqual(r.kind, 'single');
  });

  await check('solveItem: QuestionSet có câu sai -> ok=false', async () => {
    const f = fakeSingleFrame('H5P.QuestionSet 1.20');
    const fakeTab = { goto: async () => {}, close: async () => {}, context: () => ({ newPage: async () => fakeTab }), mouse: { click: async () => {} } };
    const d = deps({
      extractAnswers,
      newTab: async () => fakeTab,
      findPlayerFrame: async () => f,
      detectKind: async () => ({ kind: 'single', library: 'H5P.QuestionSet 1.20' }),
      solveQuestionSet: async () => ({ attempted: 2, correctCount: 1, total: 2, finalScore: { barWidth: '50%' } }),
      videoUrl: () => 'https://x/1',
    });
    const r = await solveItem(fakeTab, { p: 'P', c: 'C', cs: 'CS' }, () => {}, {}, d);
    assert.strictEqual(r.ok, false);
  });

  // ── 3. hồi quy: dạng khác không đổi hành vi ──────────────────────────────
  await check('hồi quy: H5P.Blanks đứng riêng vẫn đi đường extractAnswers cũ', async () => {
    const f = fakeSingleFrame('H5P.Blanks 1.15');
    f.evaluate = async () => ({ library: 'H5P.Blanks 1.15', json: { text: 'Hà Nội là *thủ đô*.' } });
    let qsCalled = 0;
    const d = deps({ extractAnswers, solveQuestionSet: async () => { qsCalled++; return {}; }, solveOne: async () => ({ solved: true }), pressCheck: async () => true });
    const r = await solveSingle(f, f, 'H5P.Blanks 1.15', () => {}, d);
    assert.strictEqual(qsCalled, 0, 'Blanks không được đi đường QuestionSet');
    assert.ok(r.solved, 'Blanks solved');
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} questionset: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();

/** Build sub[] từ jsonContent QuestionSet (đúng shape solveQuestionSet mong đợi). */
function subsFrom(json) {
  return (json.questions || []).map((q, i) => ({ index: i, library: q.library, extracted: extractAnswers(q.library, { params: q.params }) }));
}
