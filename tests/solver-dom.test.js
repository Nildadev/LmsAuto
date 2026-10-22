'use strict';
/**
 * Test offline cho solver.js — phần GỘP TRUY VẤN DOM (P2).
 * Dùng Frame giả tối thiểu: mô phỏng locator/allInnerTexts để (a) kiểm tra logic
 * chọn đáp án KHÔNG đổi, (b) chứng minh không còn N+1 round-trip mỗi node.
 * Chạy: node tests/solver-dom.test.js
 */
const assert = require('assert');
const { solveChoice, solveBlanks, solveDrag, pressCheck, pressNext, retryAvailable } = require('../src/h5p/solver');
const { stripHtml } = require('../src/h5p/extract');

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
  const fills = [];
  const base = (sel) => sel.replace(/:visible/g, '').replace(/:is\(([^)]*)\)/g, '$1')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const matched = (sel) => els.filter((e) => (
    base(sel).some((b) => e.cls.split(/\s+/).includes(b.replace(/^\./, '')))
    && (!sel.includes(':visible') || e.visible !== false)
  ));
  const mkEl = (sel) => ({
    boundingBox: async () => null, // -> humanClick rơi vào locator.click()
    // count phải phản ánh số node KHỚP thật (trước đây trả 1 cứng -> selector
    // không khớp nào cũng "tồn tại" -> giả lập sai hành vi Playwright)
    count: async () => { calls.count++; return matched(sel).length; },
    click: async () => { calls.click++; clicked.push(sel); },
    fill: async (v) => { fills.push(v); },
    type: async (v) => { fills.push(v); },
    isVisible: async () => { calls.isVisible++; return true; },
    innerText: async () => { calls.innerText++; return ''; },
    waitFor: async () => {},
    locator: () => mkEl(sel),
  });
  const loc = (sel) => ({
    count: async () => { calls.count++; return matched(sel).length; },
    allInnerTexts: async () => { calls.allInnerTexts++; return matched(sel).map((e) => (e.inner == null ? e.t : e.inner)); },
    evaluateAll: async (fn) => {
      calls.evaluate++;
      return fn(matched(sel).map((e) => ({
        innerText: e.inner == null ? e.t : e.inner, textContent: e.t,
        offsetWidth: 10, offsetHeight: 10, getClientRects: () => [{}],
        // MathML giả: e.math = "25/f" -> 1 <mfrac> với 2 con text "25" và "f".
        querySelector: (s) => (s === 'math' && e.math ? {
          querySelectorAll: (q) => (q === 'mfrac'
            ? e.math.split('|').map((part) => ({ children: part.split('/').map((x) => ({ textContent: x })) }))
            : []),
          textContent: e.math.replace(/[/|]/g, ''),
        } : null),
        querySelectorAll: (s) => (s === 'img' ? (e.imgs || []).map((src) => ({ getAttribute: () => src, src })) : []),
      })));
    },
    nth: (i) => { const m = matched(sel); return mkEl(`${sel}@${i}:${(m[i] || {}).t || ''}`); },
    first: () => mkEl(sel),
    click: async () => { calls.click++; clicked.push(sel); },
    waitFor: async () => {},
    boundingBox: async () => null,
    isVisible: async () => { calls.isVisible++; return true; },
    innerText: async () => { calls.innerText++; return ''; },
  });
  return {
    calls, clicked, fills, locator: loc,
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

  await check('solveChoice: 1 lượt evaluateAll, KHÔNG innerText/isVisible từng node', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'A', visible: true },
      { cls: 'h5p-answer', t: 'B', visible: true },
      { cls: 'h5p-answer', t: 'C', visible: true },
      { cls: 'h5p-answer', t: 'D', visible: true },
    ]);
    await solveChoice(f, { data: { correctTexts: ['C'] } }, () => {});
    assert.strictEqual(f.calls.evaluate, 1, 'text đọc 1 lượt cho cả 4 đáp án');
    assert.strictEqual(f.calls.allInnerTexts, 0, 'không đọc innerText riêng');
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

  await check('pressNext: KHÔNG bấm nút "Làm lại" (.h5p-question-try-again chỉ hiện sau câu SAI)', async () => {
    const f = fakeFrame([{ cls: 'h5p-question-try-again', t: '', visible: true }]);
    assert.strictEqual(await pressNext(f, () => {}), false, 'phải trả false');
    assert.strictEqual(f.clicked.length, 0, 'không được click nút try-again');
  });

  await check('solveBlanks: DOM 3 ô nhưng chỉ 2 đáp án -> KHÔNG điền lặp answers[0], solved=false', async () => {
    const f = fakeFrame([
      { cls: 'input.h5p-text-input', t: '', visible: true },
      { cls: 'input.h5p-text-input', t: '', visible: true },
      { cls: 'input.h5p-text-input', t: '', visible: true },
    ]);
    const r = await solveBlanks(f, { data: { answers: ['một', 'hai'] } }, () => {});
    assert.strictEqual(r.solved, false, 'thiếu đáp án -> không tính đã giải');
    assert.strictEqual(r.reason, 'answers-fewer-than-inputs');
    assert.deepStrictEqual(f.fills.filter(v => v !== ''), ['một', 'hai'], 'chỉ điền 2 ô có đáp án, không lặp answers[0] vào ô 3');
  });

  await check('solveBlanks: đủ đáp án -> solved=true', async () => {
    const f = fakeFrame([
      { cls: 'input.h5p-text-input', t: '', visible: true },
      { cls: 'input.h5p-text-input', t: '', visible: true },
    ]);
    const r = await solveBlanks(f, { data: { answers: ['một', 'hai'] } }, () => {});
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(f.fills.filter(v => v !== ''), ['một', 'hai']);
  });

  await check('solveDrag: số zone DOM ≠ json -> DỪNG trung thực (không kéo sai hàng loạt)', async () => {
    const f = fakeFrame([
      { cls: 'h5p-draggable', t: 'A', visible: true },
      { cls: 'h5p-draggable', t: 'B', visible: true },
      { cls: 'h5p-dropzone', t: '', visible: true },
      { cls: 'h5p-dropzone', t: '', visible: true },
    ]);
    // boundingBox của fake trả null -> dzInfo rỗng ≠ 2 json zone -> phải bail
    const r = await solveDrag(f, { data: { elements: ['A', 'B'], zones: [{ y: 0, x: 0 }, { y: 10, x: 0 }] } }, () => {});
    assert.strictEqual(r.solved, false);
    assert.strictEqual(r.reason, 'zone-count-mismatch');
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

  await check('solveChoice: khớp được đáp án có chỉ số dưới (u = u1 = u2)', async () => {
    // Regression debug live: JSON "u = u<sub>1</sub> = u<sub>2</sub>" từng bị tách
    // thành "u = u 1 = u 2" -> exact/loose match đều trượt -> clicked 0, sai cả bài.
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'u = u1 + u2', visible: true },
      { cls: 'h5p-answer', t: 'u = u1/u2', visible: true },
      { cls: 'h5p-answer', t: 'u = u1.u2', visible: true },
      { cls: 'h5p-answer', t: 'u = u1 = u2', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: [stripHtml('<p>u = u<sub>1</sub> = u<sub>2</sub></p>')] } }, () => {});
    assert.strictEqual(r.solved, true, 'phải click được đáp án đúng');
    assert.ok(f.clicked[0].includes('@3:u = u1 = u2'), `click đúng node #3 (nhận ${f.clicked[0]})`);
  });

  await check('solveChoice: đáp án là ẢNH -> khớp theo basename src (URL tuyệt đối vs tương đối)', async () => {
    // Regression live 22/10/2026: câu 2 bài "Bài tập trắc nghiệm" có 4 đáp án là
    // <img>; text rỗng nên solver cũ báo no-answers -> không click -> kẹt bài.
    const f = fakeFrame([
      { cls: 'h5p-answer', t: '', imgs: ['https://tech12h.com/sites/default/files/image_847.png'], visible: true },
      { cls: 'h5p-answer', t: '', imgs: ['https://tech12h.com/sites/default/files/image_846.png?itok=abc'], visible: true },
      { cls: 'h5p-answer', t: '', imgs: ['https://tech12h.com/sites/default/files/image_848.png'], visible: true },
      { cls: 'h5p-answer', t: '', imgs: ['https://tech12h.com/sites/default/files/image_849.png'], visible: true },
    ]);
    const r = await solveChoice(f, { data: {
      correctTexts: [],
      correctImages: ['sites/default/files/image_846.png'],
    } }, () => {});
    assert.strictEqual(r.solved, true, 'phải click được đáp án ảnh đúng');
    assert.deepStrictEqual(r.clicked, [1]);
    assert.ok(f.clicked[0].includes('@1'), `click đúng node ảnh #1 (nhận ${f.clicked[0]})`);
  });

  await check('solveChoice: trộn text + ảnh -> click đủ cả hai đáp án đúng', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'Đáp án chữ', visible: true },
      { cls: 'h5p-answer', t: '', imgs: ['img/anh_dung.png'], visible: true },
      { cls: 'h5p-answer', t: 'Sai', visible: true },
    ]);
    const r = await solveChoice(f, { data: {
      correctTexts: ['Đáp án chữ'],
      correctImages: ['https://cdn.example.com/img/anh_dung.png'],
    } }, () => {});
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(r.clicked, [0, 1]);
  });

  await check('solveChoice: ảnh đúng KHÔNG có trong DOM -> không click bừa', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: '', imgs: ['img/khac.png'], visible: true },
      { cls: 'h5p-answer', t: 'Sai', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: [], correctImages: ['img/dung.png'] } }, () => {});
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(r.clicked, []);
  });

  await check('solveChoice: MathML trùng text ("25f" vs phân số 25/f) -> chọn theo mathSig', async () => {
    // Regression live 22/10/2026 (sách KHTN "Kính lúp"): randomAnswers=true đảo
    // thứ tự; đáp án nhiễu "G = 25f." đứng trước phân số đúng 25/f -> khớp text
    // chọn nhầm nhiễu, H5P chấm 0 điểm dù clicked 1.
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'G = 25f', visible: true, math: '' },
      { cls: 'h5p-answer', t: 'G = 25f', visible: true, math: '25/f' },
      { cls: 'h5p-answer', t: 'G = f25', visible: true, math: 'f/25' },
      { cls: 'h5p-answer', t: 'G = 25 – f', visible: true, math: '' },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: ['G = 25f'], correctMath: ['25/f'] } }, () => {});
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(r.clicked, [1], 'phải click node phân số, không phải nhiễu đứng trước');
    assert.ok(f.clicked[0].includes('@1:G = 25f'), `click đúng node #1 (nhận ${f.clicked[0]})`);
  });

  await check('solveChoice: trùng text, KHÔNG có mathSig -> KHÔNG click (không đoán)', async () => {
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'A', visible: true },
      { cls: 'h5p-answer', t: 'A', visible: true },
      { cls: 'h5p-answer', t: 'B', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: ['A'] } }, () => {});
    assert.strictEqual(r.solved, false, '2 đáp án giống nhau = nhập nhằng, không được báo solved');
    assert.deepStrictEqual(r.clicked, [], 'không được chọn "đại" đáp án đầu');
  });

  await check('solveChoice: trùng text + mathSig KHÔNG khớp -> KHÔNG chọn "đại" node MathML', async () => {
    // Trước đây fallback `find(sig !== '')` chọn node MathML bất kỳ dù chữ ký khác.
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'A', visible: true, math: '1/2' },
      { cls: 'h5p-answer', t: 'A', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: ['A'], correctMath: ['3/4'] } }, () => {});
    assert.strictEqual(r.solved, false);
    assert.deepStrictEqual(r.clicked, []);
  });

  await check('solveChoice: innerText MathML trả 𝑓 (U+1D453) -> khớp bằng textContent', async () => {
    // Live 22/10/2026: innerText của <mi>f</mi> là ký tự toán học "𝑓" nên
    // normalize KHÔNG bằng "f" -> chỉ nhiễu "G = 25f." khớp và bị click.
    // textContent vẫn là "f" -> phải dùng textContent để khớp.
    const f = fakeFrame([
      { cls: 'h5p-answer', t: 'G = 25f.', inner: 'G = 25f.', visible: true },
      { cls: 'h5p-answer', t: 'G = 25f', inner: 'G = 25 𝑓', visible: true, math: '25/f' },
      { cls: 'h5p-answer', t: 'G = 25 – f.', inner: 'G = 25 – f.', visible: true },
    ]);
    const r = await solveChoice(f, { data: { correctTexts: ['G = 25f'], correctMath: ['25/f'] } }, () => {});
    assert.strictEqual(r.solved, true);
    assert.deepStrictEqual(r.clicked, [1], 'phải click phân số (textContent "G = 25f")');
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} solver-dom: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
