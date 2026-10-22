'use strict';
/**
 * Test offline cho extract.js — dùng dữ liệu THẬT đã dump từ lms360.vn
 * (docs/sample-questionset-answers.json: 1 QuestionSet gồm 12 câu con).
 * Chạy: node tests/extract.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractAnswers, stripHtml } = require('../src/h5p/extract');

const SAMPLE = path.join(__dirname, '..', 'docs', 'sample-questionset-answers.json');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

// ── Test 1: parse QuestionSet thật, đếm sub-question theo library ──
check('QuestionSet sample: parse + 12 câu con', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  assert.strictEqual(Array.isArray(raw), true, 'outer phải là array');
  const qs = JSON.parse(raw[0]); // jsonContent là string JSON
  assert.ok(qs.questions, 'phải có questions[]');
  assert.strictEqual(qs.questions.length, 12, 'phải có 12 câu con');
  assert.strictEqual(qs.passPercentage, 50);
});

check('MultiChoice: tìm đúng đáp án correct=true', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const qs = JSON.parse(raw[0]);
  const mc = qs.questions.find(q => /MultiChoice/.test(q.library));
  assert.ok(mc, 'phải có ít nhất 1 MultiChoice');
  const r = extractAnswers(mc.library, { params: mc.params });
  assert.strictEqual(r.kind, 'choice');
  assert.ok(r.correctIndexes.length >= 1, 'phải có ít nhất 1 đáp án đúng');
  // đáp án correct phải khớp với correctIndexes
  r.correctIndexes.forEach(i => assert.strictEqual(mc.params.answers[i].correct, true));
});

check('Blanks: trích được đáp án từ token *...*', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const qs = JSON.parse(raw[0]);
  const bl = qs.questions.find(q => /Blanks/.test(q.library));
  assert.ok(bl, 'phải có Blanks');
  const r = extractAnswers(bl.library, { params: bl.params });
  assert.strictEqual(r.kind, 'blanks');
  assert.ok(r.answers.length >= 1, 'phải trích được ít nhất 1 đáp án');
  // đáp án đầu phải là số (hệ số a) — dữ liệu thật có -3, 4, 2, 0...
  assert.ok(r.answers.every(a => a.length > 0), 'đáp án không rỗng');
});

check('DragQuestion: map dropZone -> element text', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const qs = JSON.parse(raw[0]);
  const dq = qs.questions.find(q => /DragQuestion/.test(q.library));
  assert.ok(dq, 'phải có DragQuestion');
  const r = extractAnswers(dq.library, { params: dq.params });
  assert.strictEqual(r.kind, 'dragquestion');
  assert.ok(r.elements.length >= 2, 'phải có >=2 elements');
  assert.ok(r.zones.length >= 1, 'phải có >=1 dropZone');
  assert.ok(r.zones.some(z => z.correctTexts.length >= 1), 'mỗi zone phải map được text đúng');
});

// ── Test đơn vị cho từng dạng (synthetic, để chắc chắn router đúng) ──
check('TrueFalse: answers[].correct', () => {
  const r = extractAnswers('H5P.TrueFalse 1.8', { params: { answers: [
    { text: 'Đúng', correct: false }, { text: 'Sai', correct: true }] } });
  assert.deepStrictEqual(r.correctIndexes, [1]);
  assert.deepStrictEqual(r.correctTexts, ['Sai']);
});

check('jsonContent dạng string cũng parse được', () => {
  const r = extractAnswers('H5P.MultiChoice 1.16', JSON.stringify({ params: { answers: [
    { text: 'A', correct: true }, { text: 'B', correct: false }] } }));
  assert.strictEqual(r.kind, 'choice');
  assert.deepStrictEqual(r.correctTexts, ['A']);
});

check('Library không hỗ trợ -> null', () => {
  const r = extractAnswers('H5P.UnknownLib 1.0', { params: {} });
  assert.strictEqual(r, null);
});

check('DragText: đáp án từ params.textField (token *...*)', () => {
  const r = extractAnswers('H5P.DragText 1.9', { params: { textField: 'Tôi *yêu* màu *xanh*.' } });
  assert.strictEqual(r.kind, 'blanks');
  assert.deepStrictEqual(r.answers, ['yêu', 'xanh']);
});

check('Blanks: đáp án dấu sao PHẢI stripHtml (entity + tag)', () => {
  // Nếu không strip, solver sẽ gõ nguyên văn "a&amp;b" / "<b>x</b>" -> H5P chấm SAI.
  const r1 = extractAnswers('H5P.Blanks 1.14', { params: { text: 'Dòng *a&amp;b* và *x&nbsp;y*.' } });
  assert.strictEqual(r1.kind, 'blanks');
  assert.deepStrictEqual(r1.answers, ['a&b', 'x y']);
  const r2 = extractAnswers('H5P.Blanks 1.14', { params: { text: 'Chọn *<b>đúng</b>* nhé.' } });
  assert.deepStrictEqual(r2.answers, ['đúng']);
});

check('Blanks: nhiều đáp án trong 1 cặp sao -> lấy đáp án ĐẦU (đã strip)', () => {
  const r = extractAnswers('H5P.Blanks 1.14', { params: { text: 'Điền *một/hai/ba* vào ô.' } });
  assert.deepStrictEqual(r.answers, ['một']);
});

check('SingleChoiceSet: correctTexts từ choices[].answers[].correct', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
    { question: 'Q1', answers: [{ text: 'A', correct: false }, { text: 'B', correct: true }] },
    { question: 'Q2', answers: [{ text: 'C', correct: true }, { text: 'D', correct: false }] },
  ] } });
  assert.strictEqual(r.kind, 'choice');
  assert.deepStrictEqual(r.correctTexts, ['B', 'C']);
});

check('stripHtml: tag NỘI DONG (sub/sup/span) không được chèn dấu cách', () => {
  // Debug live 22/10/2026: JSON "u = u<sub>1</sub> = u<sub>2</sub>" bị strip thành
  // "u = u 1 = u 2" trong khi DOM innerText là "u = u1 = u2" -> khớp text THẤT BẠI,
  // solver click 0 đáp án, bài QuestionSet toàn bộ sai. Tag inline phải xoá KHÔNG chèn space.
  assert.strictEqual(stripHtml('<p>u = u<sub>1</sub> = u<sub>2</sub></p>'), 'u = u1 = u2');
  assert.strictEqual(stripHtml('<p>Cường độ <i>I<sub>1</sub></i> = 3A</p>'), 'Cường độ I1 = 3A');
  assert.strictEqual(stripHtml('hai điểm<br>nối chung'), 'hai điểm nối chung');
  // Tag khối vẫn phải thành dấu cách (không dính liền 2 câu).
  assert.strictEqual(stripHtml('<p>câu một</p><p>câu hai</p>'), 'câu một câu hai');
});

check('MultiChoice: correctTexts từ đáp án có chỉ số dưới (không space hóa)', () => {
  const r = extractAnswers('H5P.MultiChoice 1.16', { params: { question: 'Q?', answers: [
    { text: '<p>u = u<sub>1</sub> + u<sub>2</sub></p>', correct: false },
    { text: '<p>u = u<sub>1</sub> = u<sub>2</sub></p>', correct: true },
  ] } });
  assert.deepStrictEqual(r.correctTexts, ['u = u1 = u2']);
});

// ── SingleChoiceSet dạng THẬT trên lms360: answers là MẢNG CHUỖI HTML ──
// Dump live 22/10/2026 (bài IV "CỦNG CỐ… SONG THẤT LỤC BÁT"): params.choices[].answers
// không có field correct; H5P quy ước phần tử ĐẦU TIÊN là đáp án đúng.
check('SingleChoiceSet thật: answers là mảng chuỗi -> phần tử ĐẦU là đáp án đúng', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [{
    question: '<p>Câu 1: Văn bản "Nỗi niềm chinh phụ" được viết theo thể thơ nào?</p><div class="table-overflow-protection"></div>',
    answers: [
      '<p>B. Thơ song thất lục bát</p><div class="table-overflow-protection"></div>',
      '<p>A. Thơ lục bát</p><div class="table-overflow-protection"></div>',
      '<p>C. Thơ 7 chữ</p><div class="table-overflow-protection"></div>',
      '<p>D. Thơ thất ngôn bát cú luật Đường</p><div class="table-overflow-protection"></div>',
    ],
  }] } });
  assert.strictEqual(r.kind, 'choice');
  assert.deepStrictEqual(r.correctTexts, ['B. Thơ song thất lục bát']);
  assert.strictEqual(r.choices[0].answers.filter((a) => a.correct).length, 1);
  assert.strictEqual(r.choices[0].answers[0].correct, true);
  assert.strictEqual(r.choices[0].answers[1].correct, false);
  // Câu hỏi không được dính chữ của khối div phía sau.
  assert.ok(!/table-overflow/.test(r.choices[0].question), 'question phải sạch HTML');
});

check('SingleChoiceSet thật: nhiều slide -> mỗi slide lấy đáp án ĐẦU của nó', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
    { question: '<p>Câu 2?</p>', answers: ['<p>Đúng 2</p>', '<p>Sai</p>'] },
    { question: '<p>Câu 3?</p>', answers: ['<p>Đúng 3</p>', '<p>Sai</p>', '<p>Sai nữa</p>'] },
  ] } });
  assert.deepStrictEqual(r.correctTexts, ['Đúng 2', 'Đúng 3']);
});

check('SingleChoiceSet: answers rỗng/không có -> correctTexts rỗng, không ném lỗi', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [{ question: 'Q', answers: [] }] } });
  assert.deepStrictEqual(r.correctTexts, []);
});

// ── Đáp án là ẢNH (dữ liệu THẬT của bài "Bài tập trắc nghiệm" KHTN 9) ──
// 4 đáp án câu 2 đều là <img> -> stripHtml ra rỗng; nếu chỉ khớp text thì solver
// không click được đáp án đúng (image_846.png) và bài không bao giờ hoàn thành.
check('MultiChoice: đáp án là <img> -> trích correctImages, text rỗng không bị đoán', () => {
  const r = extractAnswers('H5P.MultiChoice 1.16', { params: { question: '<p>Công thức?</p>', answers: [
    { text: '<p><img src="https://tech12h.com/sites/default/files/image_846.png"></p>', correct: true },
    { text: '<p><img src="https://tech12h.com/sites/default/files/image_847.png"></p>', correct: false },
    { text: '<p><img src="/sites/default/files/image_848.png" alt="x"></p>', correct: false },
    { text: '<p><img src="image_849.png"></p>', correct: false },
  ] } });
  assert.deepStrictEqual(r.correctTexts, []);
  assert.deepStrictEqual(r.correctImages, ['https://tech12h.com/sites/default/files/image_846.png']);
  assert.deepStrictEqual(r.images[0], ['https://tech12h.com/sites/default/files/image_846.png']);
  assert.deepStrictEqual(r.images[3], ['image_849.png']);
});

check('MultiChoice: trộn text + ảnh -> giữ cả correctTexts lẫn correctImages', () => {
  const r = extractAnswers('H5P.MultiChoice 1.16', { params: { question: 'Q?', answers: [
    { text: '<p>Đáp án chữ</p>', correct: true },
    { text: "<p><img src='a/b/anh.png'></p>", correct: true },
    { text: '<p>Sai</p>', correct: false },
  ] } });
  assert.deepStrictEqual(r.correctTexts, ['Đáp án chữ']);
  assert.deepStrictEqual(r.correctImages, ['a/b/anh.png']);
});

check('SingleChoiceSet: answers chuỗi có <img> -> mỗi answer có images, đúng lấy ảnh phần tử đầu', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [{
    question: '<p>Chọn hình đúng</p>',
    answers: ['<p><img src="img/dung.png"></p>', '<p><img src="img/sai.png"></p>'],
  }] } });
  assert.deepStrictEqual(r.correctTexts, []);
  assert.deepStrictEqual(r.correctImages, ['img/dung.png']);
  assert.deepStrictEqual(r.choices[0].answers[0].images, ['img/dung.png']);
});

// ── Summary dạng THẬT trên lms360 (dump 22/10/2026 từ sách KHTN) ──
// params.summaries[].summary là MẢNG CHUỖI HTML, phần tử ĐẦU là câu đúng
// (giống SingleChoiceSet). Extractor cũ chỉ đọc subContents[].correctText nên
// trả rows rỗng -> summary thật không bao giờ được giải.
check('Summary thật: summaries[].summary[] -> rows phẳng, phần tử ĐẦU đúng', () => {
  const r = extractAnswers('H5P.Summary 1.10', { params: { summaries: [{
    subContentId: '6132be3b-0a62-4b04-ba87-8e0e32e9ecdf',
    summary: [
      '<p>Hiện tượng tán sắc ánh sáng.</p><div class="table-overflow-protection"></div>',
      '<p>Hiện tượng phản xạ ánh sáng.</p><div class="table-overflow-protection"></div>',
      '<p>Hiện tượng khúc xạ ánh sáng.</p><div class="table-overflow-protection"></div>',
      '<p>Hiện tượng hấp thụ ánh sáng.</p><div class="table-overflow-protection"></div>',
    ],
    tip: '<p>mẹo</p>',
  }] } });
  assert.strictEqual(r.kind, 'summary');
  assert.strictEqual(r.rows.length, 4);
  assert.deepStrictEqual(r.rows.map((x) => x.text), [
    'Hiện tượng tán sắc ánh sáng.',
    'Hiện tượng phản xạ ánh sáng.',
    'Hiện tượng khúc xạ ánh sáng.',
    'Hiện tượng hấp thụ ánh sáng.',
  ]);
  assert.deepStrictEqual(r.rows.map((x) => x.correct), [true, false, false, false]);
  assert.strictEqual(r.rows[0].subContentId, '6132be3b-0a62-4b04-ba87-8e0e32e9ecdf');
});

check('Summary nhiều bộ: mỗi bộ lấy câu ĐẦU của nó làm đúng', () => {
  const r = extractAnswers('H5P.Summary 1.10', { params: { summaries: [
    { subContentId: 'a', summary: ['<p>Đúng A</p>', '<p>Sai A</p>'] },
    { subContentId: 'b', summary: ['<p>Đúng B</p>', '<p>Sai B1</p>', '<p>Sai B2</p>'] },
  ] } });
  assert.deepStrictEqual(r.rows.map((x) => [x.text, x.correct]), [
    ['Đúng A', true], ['Sai A', false],
    ['Đúng B', true], ['Sai B1', false], ['Sai B2', false],
  ]);
});

check('Summary dạng CŨ (subContents) vẫn đọc được để không hồi quy', () => {
  const r = extractAnswers('H5P.Summary 1.10', { params: { summaries: [{
    subContents: [{ subContentId: 'old', correctText: '<p>đúng</p>', incorrectText: '<p>sai</p>' }],
  }] } });
  assert.deepStrictEqual(r.rows.map((x) => [x.text, x.correct]), [['đúng', true], ['sai', false]]);
});

check('Summary: summaries rỗng/không có -> rows rỗng, không ném lỗi', () => {
  const r = extractAnswers('H5P.Summary 1.10', { params: {} });
  assert.deepStrictEqual(r.rows, []);
});

// Hồi quy trên dump THẬT: docs/sample-interactivebook.json (sách KHTN) có 1 Summary.
check('Summary: dump thật sample-interactivebook.json -> 4 rows, câu đầu đúng', () => {
  const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sample-interactivebook.json'), 'utf8'));
  let found = null;
  (function walk(o) {
    if (!o || typeof o !== 'object' || found) return;
    if (o.library && /Summary/.test(o.library)) { found = extractAnswers(o.library, o.params); return; }
    for (const k of Object.keys(o)) walk(o[k]);
  })(book);
  assert.ok(found, 'phải tìm thấy H5P.Summary trong dump');
  assert.strictEqual(found.rows.length, 4);
  assert.strictEqual(found.rows[0].text, 'Hiện tượng tán sắc ánh sáng.');
  assert.strictEqual(found.rows[0].correct, true);
  assert.strictEqual(found.rows.filter((r) => r.correct).length, 1);
});

// ── MathML: phân số 25/f và đáp án nhiễu "25f" có cùng text sau stripHtml ──
// Dữ liệu THẬT (sách KHTN "Bài 10. Kính lúp", dump 22/10/2026): đáp án đúng là
// <mfrac>25/f</mfrac> -> stripHtml "G = 25f", trùng đáp án nhiễu "G = 25f.".
// randomAnswers=true -> không thể dùng index; phải phân biệt bằng cấu trúc MathML.
const FRAC_25_F = '<p>G =&nbsp;<math display="inline" style="font-size:1em;"><mfrac><mrow><mn>25</mn></mrow><mrow><mi>f</mi></mrow></mfrac></math></p><div class="table-overflow-protection"></div>';
const FRAC_F_25 = '<p>G = <math display="inline"><mfrac><mrow><mi>f</mi></mrow><mrow><mn>2</mn><mn>5</mn></mrow></mfrac></math> .</p>';

check('MultiChoice: MathML phân số -> correctMath tách tử/mẫu, text vẫn như cũ', () => {
  const r = extractAnswers('H5P.MultiChoice 1.16', { params: { question: '<p>Câu 3?</p>', answers: [
    { text: FRAC_25_F, correct: true },
    { text: '<p>G = 25f.</p>', correct: false },
    { text: FRAC_F_25, correct: false },
    { text: '<p>G = 25 – f.</p>', correct: false },
  ] } });
  assert.deepStrictEqual(r.correctTexts, ['G = 25f']);
  assert.deepStrictEqual(r.correctMath, ['25/f']);
  assert.deepStrictEqual(r.math, ['25/f', '', 'f/25', '']);
});

check('SingleChoiceSet: MathML -> correctMath song song correctTexts', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [{
    question: '<p>Hệ thức?</p>',
    answers: [FRAC_25_F, '<p>G = 25f.</p>', '<p>G = 25 – f.</p>'],
  }] } });
  assert.deepStrictEqual(r.correctTexts, ['G = 25f']);
  assert.deepStrictEqual(r.correctMath, ['25/f']);
  assert.deepStrictEqual(r.choices[0].answers.map((a) => a.math), ['25/f', '', '']);
});

console.log(`\nKết quả: ${passed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
